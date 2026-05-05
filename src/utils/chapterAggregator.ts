import { MangaDexScraper }  from "../scrapers/mangaDexScraper";
import { ComickScraper }    from "../scrapers/comickScraper";

const mangadex = new MangaDexScraper();
const comick   = new ComickScraper();

export interface UnifiedChapter {
  id:          string;
  number:      string;
  title:       string | null;
  source:      string;
  lang:        string;
  publishedAt: string;
  group:       string;
  pages:       number;
  isExternal:  boolean;
}

function parseChapNum(s: string | null | undefined): number {
  if (!s || s === "0") return -1;
  const n = parseFloat(s);
  return isNaN(n) ? -1 : n;
}

async function fromMangaDex(mangaId: string, lang: string): Promise<UnifiedChapter[]> {
  try {
    const results: UnifiedChapter[] = [];
    let offset = 0;
    const limit = 96;

    while (true) {
      const { chapters, total } = await mangadex.fetchChapters(mangaId, { lang, limit, offset });
      for (const c of chapters) {
        // Skip external-only chapters (Manga Plus etc) — no images available
        // We'll get these from ComicK instead
        if (c.isExternal) continue;
        results.push({
          id:          c.id,
          number:      c.chapter ?? "",
          title:       c.title,
          source:      "mangadex",
          lang:        c.lang,
          publishedAt: c.publishedAt,
          group:       c.scanlationGroup,
          pages:       c.pages,
          isExternal:  false,
        });
      }
      offset += limit;
      if (offset >= total || !chapters.length) break;
    }
    return results;
  } catch { return []; }
}

async function fromComicK(title: string, lang: string): Promise<UnifiedChapter[]> {
  try {
    const results = await comick.search(title, { limit: 5 });
    if (!results.length) return [];
    const hid = results[0].hid;

    const chapters: UnifiedChapter[] = [];
    for (let page = 1; page <= 10; page++) {
      const { chapters: batch } = await comick.fetchChapters(hid, { page, lang, limit: 100 });
      if (!batch.length) break;
      for (const c of batch) {
        chapters.push({
          id:          c.hid,
          number:      c.chap ?? "",
          title:       c.title,
          source:      "comick",
          lang:        c.lang,
          publishedAt: c.publishedAt,
          group:       c.groupName.join(", ") || "Unknown",
          pages:       0,
          isExternal:  false,
        });
      }
    }
    return chapters;
  } catch { return []; }
}

export async function aggregateChapters(opts: {
  mangadexId: string;
  title:      string;
  lang?:      string;
}): Promise<{ chapters: UnifiedChapter[]; total: number; sources: string[] }> {
  const lang = opts.lang ?? "en";

  const [mdChapters, ckChapters] = await Promise.all([
    fromMangaDex(opts.mangadexId, lang),
    fromComicK(opts.title, lang),
  ]);

  const sources: string[] = [];
  if (mdChapters.length) sources.push("mangadex");
  if (ckChapters.length) sources.push("comick");

  // Merge: ComicK first (lower priority), then overwrite with MangaDex
  const seen = new Map<string, UnifiedChapter>();

  for (const c of ckChapters) {
    const key = c.number || c.id;
    if (!seen.has(key)) seen.set(key, c);
  }

  for (const c of mdChapters) {
    // MangaDex takes priority when chapter number matches
    const key = c.number || c.id;
    seen.set(key, c);
  }

  // Sort ascending by chapter number, put unnumbered at end
  const merged = Array.from(seen.values()).sort((a, b) => {
    const na = parseChapNum(a.number);
    const nb = parseChapNum(b.number);
    if (na === -1 && nb === -1) return 0;
    if (na === -1) return 1;
    if (nb === -1) return -1;
    return na - nb;
  });

  // Assign sequential numbers to any chapters missing a number
  let seq = 0;
  for (const c of merged) {
    if (!c.number || c.number === "0") {
      seq++;
      c.number = String(seq);
    }
  }

  return { chapters: merged, total: merged.length, sources };
}

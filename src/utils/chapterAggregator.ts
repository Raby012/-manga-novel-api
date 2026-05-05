/**
 * chapterAggregator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches chapters from ALL available sources simultaneously, merges them,
 * deduplicates by chapter number, and returns a complete unified list.
 *
 * WHY THIS EXISTS
 * ────────────────
 * No single source has every chapter for every title:
 *   - MangaDex removes licensed titles (Frieren, Berserk, Chainsaw Man...)
 *   - ComicK has most titles but misses some manhwa
 *   - WeebCentral focuses on manhwa/manhua
 *   - AsuraScans has exclusives not on other platforms
 *
 * This aggregator calls all sources in parallel, then merges by chapter number
 * so the user always sees the complete chapter list regardless of licensing.
 */

import { MangaDexScraper }    from "../scrapers/mangaDexScraper";
import { ComickScraper }       from "../scrapers/comickScraper";

const mangadex = new MangaDexScraper();
const comick   = new ComickScraper();

export interface UnifiedChapter {
  id:         string;
  number:     string;   // "1", "12.5", "100" etc
  title:      string | null;
  source:     string;   // which source this came from
  lang:       string;
  publishedAt:string;
  group:      string;
  pages:      number;
  isExternal: boolean;
}

// Normalise chapter number to float for comparison (e.g. "12.5" → 12.5)
function parseChapNum(s: string | null | undefined): number {
  if (!s) return -1;
  const n = parseFloat(s);
  return isNaN(n) ? -1 : n;
}

// ── Fetch from MangaDex ───────────────────────────────────────────────────────
async function fromMangaDex(mangaId: string, lang: string): Promise<UnifiedChapter[]> {
  try {
    // Fetch up to 500 chapters across 6 pages
    const pages = await Promise.allSettled(
      [0, 96, 192, 288, 384, 480].map(offset =>
        mangadex.fetchChapters(mangaId, { lang, limit: 96, offset })
      )
    );

    const chapters: UnifiedChapter[] = [];
    for (const p of pages) {
      if (p.status === "rejected") continue;
      for (const c of p.value.chapters) {
        chapters.push({
          id:          c.id,
          number:      c.chapter ?? "0",
          title:       c.title,
          source:      "mangadex",
          lang:        c.lang,
          publishedAt: c.publishedAt,
          group:       c.scanlationGroup,
          pages:       c.pages,
          isExternal:  c.isExternal,
        });
      }
      // Stop early if we got everything
      if (p.value.total <= p.value.chapters.length) break;
    }
    return chapters;
  } catch {
    return [];
  }
}

// ── Fetch from ComicK (search by title to find the hid) ──────────────────────
async function fromComicK(
  title: string,
  lang: string
): Promise<UnifiedChapter[]> {
  try {
    // Search ComicK for the title to get its hid
    const results = await comick.search(title, { limit: 5 });
    if (!results.length) return [];

    const hid = results[0].hid;
    const pages = await Promise.allSettled(
      [1, 2, 3, 4, 5].map(page =>
        comick.fetchChapters(hid, { page, lang, limit: 100 })
      )
    );

    const chapters: UnifiedChapter[] = [];
    for (const p of pages) {
      if (p.status === "rejected") continue;
      for (const c of p.value.chapters) {
        chapters.push({
          id:          c.hid,
          number:      c.chap ?? "0",
          title:       c.title,
          source:      "comick",
          lang:        c.lang,
          publishedAt: c.publishedAt,
          group:       c.groupName.join(", ") || "Unknown",
          pages:       0,
          isExternal:  false,
        });
      }
      // ComicK returns empty array when no more chapters
      if (!p.value.chapters.length) break;
    }
    return chapters;
  } catch {
    return [];
  }
}

// ── Main aggregator ───────────────────────────────────────────────────────────
export async function aggregateChapters(opts: {
  mangadexId: string;
  title:      string;
  lang?:      string;
}): Promise<{ chapters: UnifiedChapter[]; total: number; sources: string[] }> {
  const lang = opts.lang ?? "en";

  // Fetch from all sources simultaneously
  const [mdChapters, ckChapters] = await Promise.all([
    fromMangaDex(opts.mangadexId, lang),
    fromComicK(opts.title, lang),
  ]);

  // Track which sources returned data
  const sources: string[] = [];
  if (mdChapters.length) sources.push("mangadex");
  if (ckChapters.length) sources.push("comick");

  // Merge + deduplicate by chapter number
  // Priority: MangaDex > ComicK (MangaDex has higher image quality)
  const seen = new Map<number, UnifiedChapter>();

  // Add ComicK first (lower priority)
  for (const c of ckChapters) {
    const num = parseChapNum(c.number);
    if (!seen.has(num)) seen.set(num, c);
  }

  // Overwrite with MangaDex (higher priority)
  for (const c of mdChapters) {
    const num = parseChapNum(c.number);
    seen.set(num, c); // always prefer MangaDex
  }

  // Sort by chapter number ascending
  const merged = Array.from(seen.values()).sort(
    (a, b) => parseChapNum(a.number) - parseChapNum(b.number)
  );

  return { chapters: merged, total: merged.length, sources };
}

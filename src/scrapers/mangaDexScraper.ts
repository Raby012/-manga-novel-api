import { fetchJSON } from "../utils/httpClient";

const BASE        = "https://api.mangadex.org";
const COVER_BASE  = "https://uploads.mangadex.org/covers";
const REFERER     = "https://mangadex.org/";

export type ContentType = "manga" | "manhwa" | "manhua" | "unknown";

// All content ratings — we return everything and let the frontend filter
// 18+ chapters (erotica/pornographic) are included so nothing is missing
const ALL_RATINGS = ["safe", "suggestive", "erotica", "pornographic"];

export interface MangaDexResult {
  id: string; title: string; contentType: ContentType;
  coverUrl: string; status: string; rating: string;
  genres: string[]; themes: string[]; description: string;
  year: number | null;
}

export interface MangaDexChapter {
  id: string; chapter: string | null; title: string | null;
  lang: string; publishedAt: string; scanlationGroup: string;
  pages: number; isExternal: boolean;
}

function langToType(lang?: string): ContentType {
  if (!lang) return "unknown";
  if (lang.startsWith("ja")) return "manga";
  if (lang.startsWith("ko")) return "manhwa";
  if (lang.startsWith("zh")) return "manhua";
  return "unknown";
}

function getTitle(attributes: any): string {
  const t = attributes?.title ?? {};
  return (
    t.en ?? t["ja-ro"] ?? t.ja ?? t["ko-ro"] ?? t.ko ??
    Object.values(t)[0] ?? "Unknown"
  ) as string;
}

function getCoverUrl(mangaId: string, relationships: any[]): string {
  if (!relationships?.length) return "";
  const cover = relationships.find((r: any) => r.type === "cover_art");
  if (!cover) return "";
  const filename = cover?.attributes?.fileName;
  if (!filename) return "";
  return `${COVER_BASE}/${mangaId}/${filename}.512.jpg`;
}

function getTags(attributes: any, group: string): string[] {
  return (attributes?.tags ?? [])
    .filter((t: any) => t.attributes?.group === group)
    .map((t: any) => t.attributes?.name?.en ?? "")
    .filter(Boolean);
}

function mapManga(item: any): MangaDexResult {
  const attr = item.attributes ?? {};
  return {
    id:          item.id,
    title:       getTitle(attr),
    contentType: langToType(attr.originalLanguage),
    // getCoverUrl needs relationships array from the response
    coverUrl:    getCoverUrl(item.id, item.relationships ?? []),
    status:      attr.status   ?? "unknown",
    rating:      attr.contentRating ?? "safe",
    genres:      getTags(attr, "genre"),
    themes:      getTags(attr, "theme"),
    description: attr.description?.en ?? "",
    year:        attr.year ?? null,
  };
}

// Build URLSearchParams with proper array[] syntax required by MangaDex
function buildParams(
  base: Record<string, string>,
  arrays: Record<string, string[]> = {}
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const [key, values] of Object.entries(arrays)) {
    values.forEach(v => params.append(`${key}[]`, v));
  }
  return params;
}

export class MangaDexScraper {

  async search(
    query: string,
    opts: { type?: ContentType; limit?: number; offset?: number } = {}
  ): Promise<MangaDexResult[]> {
    const langMap: Record<string, string[]> = {
      manga: ["ja", "ja-ro"], manhwa: ["ko", "ko-ro"], manhua: ["zh", "zh-hk"],
    };
    const params = buildParams(
      {
        title:  query,
        limit:  String(opts.limit  ?? 20),
        offset: String(opts.offset ?? 0),
        "order[relevance]": "desc",
      },
      {
        "includes":      ["cover_art", "author", "artist"],
        "contentRating": ALL_RATINGS,
        ...(opts.type && langMap[opts.type]
          ? { "originalLanguage": langMap[opts.type] }
          : {}),
      }
    );
    const data = await fetchJSON<any>(`${BASE}/manga?${params}`, REFERER);
    return (data?.data ?? []).map(mapManga);
  }

  async fetchMangaInfo(id: string): Promise<MangaDexResult> {
    const params = buildParams({}, {
      "includes": ["cover_art", "author", "artist"],
    });
    const data = await fetchJSON<any>(`${BASE}/manga/${id}?${params}`, REFERER);
    return mapManga(data.data);
  }

  async fetchChapters(
    mangaId: string,
    opts: { lang?: string; limit?: number; offset?: number } = {}
  ): Promise<{ chapters: MangaDexChapter[]; total: number }> {
    const params = buildParams(
      {
        limit:            String(opts.limit  ?? 96),
        offset:           String(opts.offset ?? 0),
        "order[chapter]": "asc",
      },
      {
        // Include all content ratings — without this MangaDex only returns
        // "safe" chapters and most series appear to have 0 chapters
        "contentRating":     ALL_RATINGS,
        "translatedLanguage": [opts.lang ?? "en"],
        "includes":          ["scanlation_group"],
        // Include external chapters (Manga Plus, etc.)
        "includeExternalUrl": ["1"],
      }
    );

    const data = await fetchJSON<any>(
      `${BASE}/manga/${mangaId}/feed?${params}`,
      REFERER
    );

    const chapters: MangaDexChapter[] = (data?.data ?? []).map((c: any) => {
      const group = c.relationships?.find((r: any) => r.type === "scanlation_group");
      const attr  = c.attributes ?? {};
      return {
        id:              c.id,
        chapter:         attr.chapter       ?? null,
        title:           attr.title         ?? null,
        lang:            attr.translatedLanguage ?? "en",
        publishedAt:     attr.publishAt     ?? "",
        scanlationGroup: group?.attributes?.name ?? "Unknown",
        pages:           attr.pages         ?? 0,
        // isExternal = true means chapter is on Manga Plus etc, not MangaDex CDN
        isExternal:      !!attr.externalUrl,
      };
    });

    return { chapters, total: data?.total ?? chapters.length };
  }

  async fetchChapterPages(chapterId: string): Promise<string[]> {
    const data = await fetchJSON<any>(
      `${BASE}/at-home/server/${chapterId}`,
      REFERER
    );
    const baseUrl = data?.baseUrl ?? "https://uploads.mangadex.org";
    const hash    = data?.chapter?.hash ?? "";
    const pages   = data?.chapter?.data ?? [];
    return pages.map((p: string) => `${baseUrl}/data/${hash}/${p}`);
  }

  async trending(
    opts: { type?: ContentType; limit?: number; offset?: number } = {}
  ): Promise<MangaDexResult[]> {
    const langMap: Record<string, string[]> = {
      manga: ["ja"], manhwa: ["ko"], manhua: ["zh"],
    };
    const params = buildParams(
      {
        limit:  String(opts.limit  ?? 20),
        offset: String(opts.offset ?? 0),
        "order[followedCount]": "desc",
      },
      {
        "includes":      ["cover_art", "author", "artist"],
        "contentRating": ALL_RATINGS,
        ...(opts.type && langMap[opts.type]
          ? { "originalLanguage": langMap[opts.type] }
          : {}),
      }
    );
    const data = await fetchJSON<any>(`${BASE}/manga?${params}`, REFERER);
    return (data?.data ?? []).map(mapManga);
  }
}

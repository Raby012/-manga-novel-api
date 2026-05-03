import { fetchJSON } from "../utils/httpClient";

const BASE       = "https://api.mangadex.org";
const COVER_BASE = "https://uploads.mangadex.org/covers";
const REFERER    = "https://mangadex.org/";

export type ContentType = "manga" | "manhwa" | "manhua" | "unknown";

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
  pages: number; isExternal: boolean; externalUrl: string | null;
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
  return (t.en ?? t["ja-ro"] ?? t.ja ?? t["ko-ro"] ?? t.ko ??
    Object.values(t)[0] ?? "Unknown") as string;
}

function getCoverUrl(mangaId: string, relationships: any[]): string {
  if (!relationships?.length) return "";
  const cover = relationships.find((r: any) => r.type === "cover_art");
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
    coverUrl:    getCoverUrl(item.id, item.relationships ?? []),
    status:      attr.status ?? "unknown",
    rating:      attr.contentRating ?? "safe",
    genres:      getTags(attr, "genre"),
    themes:      getTags(attr, "theme"),
    description: attr.description?.en ?? "",
    year:        attr.year ?? null,
  };
}

// Build URLSearchParams — arrays use key[] syntax, plain values use key
function buildParams(
  plain: Record<string, string>,
  arrays: Record<string, string[]> = {}
): URLSearchParams {
  const params = new URLSearchParams(plain);
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
      { title: query, limit: String(opts.limit ?? 20), offset: String(opts.offset ?? 0), "order[relevance]": "desc" },
      {
        includes:        ["cover_art", "author", "artist"],
        contentRating:   ALL_RATINGS,
        ...(opts.type && langMap[opts.type] ? { originalLanguage: langMap[opts.type] } : {}),
      }
    );
    const data = await fetchJSON<any>(`${BASE}/manga?${params}`, REFERER);
    return (data?.data ?? []).map(mapManga);
  }

  async fetchMangaInfo(id: string): Promise<MangaDexResult> {
    const params = buildParams({}, { includes: ["cover_art", "author", "artist"] });
    const data = await fetchJSON<any>(`${BASE}/manga/${id}?${params}`, REFERER);
    return mapManga(data.data);
  }

  async fetchChapters(
    mangaId: string,
    opts: { lang?: string; limit?: number; offset?: number } = {}
  ): Promise<{ chapters: MangaDexChapter[]; total: number }> {
    // NOTE: includeExternalUrl is a PLAIN param (not array) — MangaDex returns
    // 400 if you send includeExternalUrl[]=1 instead of includeExternalUrl=1
    const params = buildParams(
      {
        limit:              String(opts.limit  ?? 96),
        offset:             String(opts.offset ?? 0),
        "order[chapter]":   "asc",
        includeExternalUrl: "1",   // plain param, NOT array
      },
      {
        contentRating:      ALL_RATINGS,       // all ratings incl 18+
        translatedLanguage: [opts.lang ?? "en"],
        includes:           ["scanlation_group"],
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
        chapter:         attr.chapter           ?? null,
        title:           attr.title             ?? null,
        lang:            attr.translatedLanguage ?? "en",
        publishedAt:     attr.publishAt         ?? "",
        scanlationGroup: group?.attributes?.name ?? "Unknown",
        pages:           attr.pages             ?? 0,
        isExternal:      !!attr.externalUrl,
        externalUrl:     attr.externalUrl       ?? null,
      };
    });

    return { chapters, total: data?.total ?? chapters.length };
  }

  async fetchChapterPages(chapterId: string): Promise<string[]> {
    const data = await fetchJSON<any>(`${BASE}/at-home/server/${chapterId}`, REFERER);
    const baseUrl = data?.baseUrl ?? "https://uploads.mangadex.org";
    const hash    = data?.chapter?.hash ?? "";
    return (data?.chapter?.data ?? []).map((p: string) => `${baseUrl}/data/${hash}/${p}`);
  }

  async trending(
    opts: { type?: ContentType; limit?: number; offset?: number } = {}
  ): Promise<MangaDexResult[]> {
    const langMap: Record<string, string[]> = {
      manga: ["ja"], manhwa: ["ko"], manhua: ["zh"],
    };
    const params = buildParams(
      { limit: String(opts.limit ?? 20), offset: String(opts.offset ?? 0), "order[followedCount]": "desc" },
      {
        includes:      ["cover_art", "author", "artist"],
        contentRating: ALL_RATINGS,
        ...(opts.type && langMap[opts.type] ? { originalLanguage: langMap[opts.type] } : {}),
      }
    );
    const data = await fetchJSON<any>(`${BASE}/manga?${params}`, REFERER);
    return (data?.data ?? []).map(mapManga);
  }
}

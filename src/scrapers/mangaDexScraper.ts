/**
 * mangaDexScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * MangaDex has a well-documented public REST API at api.mangadex.org.
 * It does NOT sit behind Cloudflare bot protection, but it does enforce
 * rate limits (5 req/s) — handled by our global rate limiter.
 *
 * CONTENT TYPE DETECTION
 * ───────────────────────
 * MangaDex tags every comic with originalLanguage:
 *   "ja" or "ja-ro"  → manga
 *   "ko" or "ko-ro"  → manhwa
 *   "zh" or "zh-hk"  → manhua
 *   anything else    → unknown (OEL, etc.)
 *
 * We expose this as the `contentType` field on every result so your
 * frontend can render the correct badge (MANGA / MANHWA / MANHUA).
 *
 * CLOUDFLARE NOTE
 * ────────────────
 * api.mangadex.org does not use Cloudflare protection, so plain fetchJSON
 * works fine.  We still route through httpClient for consistency and retry
 * logic.
 */

import { fetchJSON } from "../utils/httpClient";

const BASE = "https://api.mangadex.org";
const COVER_BASE = "https://uploads.mangadex.org/covers";

// ─── Types ────────────────────────────────────────────────────────────────────
export type ContentType = "manga" | "manhwa" | "manhua" | "unknown";

export interface MangaDexResult {
  id: string;
  title: string;
  contentType: ContentType;
  coverUrl: string;
  status: string;
  rating: string;
  genres: string[];
  themes: string[];
  description: string;
  year: number | null;
  followCount: number;
}

export interface MangaDexChapter {
  id: string;
  chapter: string | null;
  title: string | null;
  lang: string;
  publishedAt: string;
  scanlationGroup: string;
  pages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function langToType(lang?: string): ContentType {
  if (!lang) return "unknown";
  if (lang.startsWith("ja")) return "manga";
  if (lang.startsWith("ko")) return "manhwa";
  if (lang.startsWith("zh")) return "manhua";
  return "unknown";
}

function getLocalTitle(attributes: any): string {
  const t = attributes?.title ?? {};
  return (
    t.en ?? t["ja-ro"] ?? t.ja ?? t["ko-ro"] ?? t.ko ?? Object.values(t)[0] ?? "Unknown"
  );
}

function getCoverUrl(mangaId: string, relationships: any[]): string {
  const cover = relationships?.find((r: any) => r.type === "cover_art");
  const filename = cover?.attributes?.fileName;
  return filename ? `${COVER_BASE}/${mangaId}/${filename}.512.jpg` : "";
}

function getTags(attributes: any, group: string): string[] {
  return (attributes?.tags ?? [])
    .filter((t: any) => t.attributes?.group === group)
    .map((t: any) => t.attributes?.name?.en ?? "");
}

function mapManga(item: any): MangaDexResult {
  const attr = item.attributes;
  return {
    id:          item.id,
    title:       getLocalTitle(attr),
    contentType: langToType(attr?.originalLanguage),
    coverUrl:    getCoverUrl(item.id, item.relationships),
    status:      attr?.status ?? "unknown",
    rating:      attr?.contentRating ?? "safe",
    genres:      getTags(attr, "genre"),
    themes:      getTags(attr, "theme"),
    description: attr?.description?.en ?? "",
    year:        attr?.year ?? null,
    followCount: attr?.followCount ?? 0,
  };
}

// ─── Scraper class ────────────────────────────────────────────────────────────
export class MangaDexScraper {

  /** Search manga / manhwa / manhua */
  async search(
    query: string,
    opts: {
      type?: ContentType;
      limit?: number;
      offset?: number;
      contentRating?: string[];
      lang?: string;
    } = {}
  ): Promise<MangaDexResult[]> {
    const params = new URLSearchParams({
      title:   query,
      limit:   String(opts.limit  ?? 20),
      offset:  String(opts.offset ?? 0),
      includes: "cover_art",
      "order[relevance]": "desc",
    });

    // Filter by original language to narrow to manga/manhwa/manhua
    const langMap: Record<string, string[]> = {
      manga:   ["ja", "ja-ro"],
      manhwa:  ["ko", "ko-ro"],
      manhua:  ["zh", "zh-hk"],
    };
    const langs = opts.type ? langMap[opts.type] : null;
    if (langs) langs.forEach(l => params.append("originalLanguage[]", l));

    // Content rating filter (defaults to safe + suggestive)
    const ratings = opts.contentRating ?? ["safe", "suggestive"];
    ratings.forEach(r => params.append("contentRating[]", r));

    const data = await fetchJSON<any>(`${BASE}/manga?${params}`);
    return (data?.data ?? []).map(mapManga);
  }

  /** Fetch by MangaDex UUID */
  async fetchMangaInfo(id: string): Promise<MangaDexResult> {
    const params = new URLSearchParams({ includes: "cover_art" });
    const data = await fetchJSON<any>(`${BASE}/manga/${id}?${params}`);
    return mapManga(data.data);
  }

  /** Chapter list (English by default, paginated) */
  async fetchChapters(
    mangaId: string,
    opts: { lang?: string; limit?: number; offset?: number } = {}
  ): Promise<{ chapters: MangaDexChapter[]; total: number }> {
    const params = new URLSearchParams({
      limit:          String(opts.limit  ?? 96),
      offset:         String(opts.offset ?? 0),
      "order[chapter]": "asc",
      "includes[]":   "scanlation_group",
    });

    const langs = [opts.lang ?? "en"];
    langs.forEach(l => params.append("translatedLanguage[]", l));

    const data = await fetchJSON<any>(`${BASE}/manga/${mangaId}/feed?${params}`);
    const chapters: MangaDexChapter[] = (data?.data ?? []).map((c: any) => {
      const group = c.relationships?.find((r: any) => r.type === "scanlation_group");
      return {
        id:               c.id,
        chapter:          c.attributes?.chapter ?? null,
        title:            c.attributes?.title   ?? null,
        lang:             c.attributes?.translatedLanguage ?? "en",
        publishedAt:      c.attributes?.publishAt ?? "",
        scanlationGroup:  group?.attributes?.name ?? "Unknown",
        pages:            c.attributes?.pages ?? 0,
      };
    });

    return { chapters, total: data?.total ?? chapters.length };
  }

  /** Fetch chapter page image URLs */
  async fetchChapterPages(chapterId: string): Promise<string[]> {
    const data = await fetchJSON<any>(`${BASE}/at-home/server/${chapterId}`);
    const baseUrl  = data?.baseUrl ?? "https://uploads.mangadex.org";
    const hash     = data?.chapter?.hash ?? "";
    const pages    = data?.chapter?.data ?? [];

    return pages.map((p: string) => `${baseUrl}/data/${hash}/${p}`);
  }

  /** Trending / popular (sorted by followCount desc) */
  async trending(
    opts: { type?: ContentType; limit?: number; offset?: number } = {}
  ): Promise<MangaDexResult[]> {
    const params = new URLSearchParams({
      limit:   String(opts.limit  ?? 20),
      offset:  String(opts.offset ?? 0),
      "order[followedCount]": "desc",
      includes: "cover_art",
    });

    const langMap: Record<string, string[]> = {
      manga: ["ja"], manhwa: ["ko"], manhua: ["zh"],
    };
    const langs = opts.type ? langMap[opts.type] : null;
    if (langs) langs.forEach(l => params.append("originalLanguage[]", l));

    ["safe", "suggestive"].forEach(r => params.append("contentRating[]", r));

    const data = await fetchJSON<any>(`${BASE}/manga?${params}`);
    return (data?.data ?? []).map(mapManga);
  }
}

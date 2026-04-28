/**
 * comickScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Direct integration with api.comick.io — ComicK's public REST API.
 *
 * WHY NOT USE @consumet FOR COMICK?
 * ───────────────────────────────────
 * @consumet/extensions wraps ComicK but lags behind API changes and only
 * exposes a subset of fields. Going directly to api.comick.io gives us:
 *   • content_rating (safe / suggestive / erotica)
 *   • country  →  used to distinguish manga (jp) / manhwa (kr) / manhua (zh)
 *   • demographic, links, bayesianRating, followCount, commentCount
 *   • proper pagination on chapter lists
 *
 * CLOUDFLARE NOTE
 * ────────────────
 * api.comick.io sits behind Cloudflare. Standard fetch/axios from Node.js
 * gets a 403.  We use fetchJSON() from httpClient which uses got-scraping
 * to mimic a Chrome TLS fingerprint.  The Origin + Referer headers are set
 * to https://comick.io so the API thinks the request came from its own site.
 */

import { fetchJSON } from "../utils/httpClient";

const BASE = "https://api.comick.io";

// ─── Types ────────────────────────────────────────────────────────────────────
export type ContentType = "manga" | "manhwa" | "manhua" | "unknown";

export interface ComicSearchResult {
  hid: string;
  slug: string;
  title: string;
  contentType: ContentType;
  coverUrl: string;
  rating: string;
  genres: string[];
  status: number; // 1 = ongoing, 2 = completed
  lastChapter: number | null;
  followCount: number;
}

export interface ComicInfo extends ComicSearchResult {
  description: string;
  authors: string[];
  artists: string[];
  year: number | null;
  totalChapters: number;
  links: Record<string, string>;
}

export interface ComicChapter {
  hid: string;
  chap: string;          // "12.5"
  title: string | null;
  lang: string;
  publishedAt: string;
  groupName: string[];
}

export interface ChapterPage {
  url: string;
  width: number;
  height: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function countryToType(country?: string): ContentType {
  switch (country) {
    case "jp": return "manga";
    case "kr": return "manhwa";
    case "zh":
    case "zh-hk": return "manhua";
    default: return "unknown";
  }
}

function mapSearchHit(hit: any): ComicSearchResult {
  const md = hit.md_covers?.[0];
  const cover = md?.b2key
    ? `https://meo.comick.pictures/${md.b2key}`
    : "";

  return {
    hid: hit.hid ?? hit.id,
    slug: hit.slug,
    title: hit.title ?? hit.slug,
    contentType: countryToType(hit.country),
    coverUrl: cover,
    rating: hit.content_rating ?? "safe",
    genres: (hit.md_comic_md_genres ?? []).map((g: any) => g.md_genres?.name ?? ""),
    status: hit.status ?? 1,
    lastChapter: hit.last_chapter ?? null,
    followCount: hit.follow_count ?? 0,
  };
}

// ─── Scraper class ────────────────────────────────────────────────────────────
export class ComickScraper {

  /** Search comics — all three types returned, filtered by ?type= if provided */
  async search(
    query: string,
    opts: { type?: ContentType; limit?: number; page?: number } = {}
  ): Promise<ComicSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(opts.limit ?? 20),
      page:  String(opts.page  ?? 1),
      tachiyomi: "true",
    });
    if (opts.type && opts.type !== "unknown") {
      // ComicK uses country codes for filtering
      const countryMap: Record<string, string> = {
        manga: "jp", manhwa: "kr", manhua: "zh",
      };
      params.set("country", countryMap[opts.type] ?? "");
    }

    const data = await fetchJSON<any[]>(`${BASE}/v1.0/search?${params}`);
    return (data ?? []).map(mapSearchHit);
  }

  /** Trending / hot comics */
  async trending(
    type?: ContentType,
    page = 1
  ): Promise<ComicSearchResult[]> {
    const params = new URLSearchParams({
      page: String(page),
      order: "follow",
      tachiyomi: "true",
    });
    if (type && type !== "unknown") {
      const cm: Record<string, string> = { manga: "jp", manhwa: "kr", manhua: "zh" };
      params.set("country", cm[type] ?? "");
    }
    const data = await fetchJSON<any[]>(`${BASE}/v1.0/comic?${params}`);
    return (data ?? []).map(mapSearchHit);
  }

  /** Full comic info by slug */
  async fetchComicInfo(slug: string): Promise<ComicInfo> {
    const data = await fetchJSON<any>(`${BASE}/comic/${slug}?tachiyomi=true`);
    const comic = data?.comic ?? data;

    const base = mapSearchHit(comic);
    return {
      ...base,
      description: comic.desc ?? "",
      authors: (comic.author ?? []).map((a: any) => a.name ?? a),
      artists: (comic.artist ?? []).map((a: any) => a.name ?? a),
      year: comic.year ?? null,
      totalChapters: comic.chapter_count ?? 0,
      links: comic.links ?? {},
    };
  }

  /** Chapter list for a comic (paginated, English by default) */
  async fetchChapters(
    hid: string,
    opts: { page?: number; lang?: string; limit?: number } = {}
  ): Promise<{ chapters: ComicChapter[]; total: number }> {
    const params = new URLSearchParams({
      page:  String(opts.page  ?? 1),
      limit: String(opts.limit ?? 60),
      lang:  opts.lang ?? "en",
      tachiyomi: "true",
    });

    const data = await fetchJSON<any>(`${BASE}/comic/${hid}/chapters?${params}`);
    const chapters: ComicChapter[] = (data?.chapters ?? []).map((c: any) => ({
      hid:         c.hid,
      chap:        c.chap ?? "0",
      title:       c.title ?? null,
      lang:        c.lang  ?? "en",
      publishedAt: c.created_at ?? "",
      groupName:   (c.group_name ?? []),
    }));

    return { chapters, total: data?.total ?? chapters.length };
  }

  /** Chapter pages (image URLs) by chapter hid */
  async fetchChapterPages(chapterHid: string): Promise<ChapterPage[]> {
    const data = await fetchJSON<any>(
      `${BASE}/chapter/${chapterHid}?tachiyomi=true`
    );
    return (data?.chapter?.md_images ?? []).map((img: any) => ({
      url: `https://meo.comick.pictures/${img.b2key}`,
      width:  img.w ?? 0,
      height: img.h ?? 0,
    }));
  }
}

import { gotScraping } from "got-scraping";
import * as cheerio from "cheerio";
import type { NovelInfo, NovelSearchResult, ChapterListResult, ChapterContent } from "../types/novel";

/**
 * NovelFullScraper
 *
 * A fully custom scraper that targets NovelFull.com directly.
 * Standard libraries struggle with this site because Cloudflare blocks
 * requests that lack a real browser's TLS fingerprint.
 *
 * Solution: got-scraping mimics Chrome/Firefox's TLS fingerprints, HTTP/2
 * behaviour, and header ordering, so Cloudflare treats our server as a
 * legitimate browser. The flow is:
 *
 *   Frontend (browser) → Our Express server → NovelFull (via got-scraping)
 *
 * Because our server is Node.js (not a browser), NovelFull never enforces
 * CORS on us. We add CORS headers ourselves when responding to the frontend.
 */
export class NovelFullScraper {
  private readonly baseUrl = "https://novelfull.com";

  /** Shared got-scraping instance with browser-like headers baked in */
  private async fetch(url: string): Promise<string> {
    const response = await gotScraping({
      url,
      headerGeneratorOptions: {
        browsers: [{ name: "chrome", minVersion: 112 }],
        operatingSystems: ["windows"],
      },
      // Retry up to 2 times on network errors or 5xx responses
      retry: { limit: 2, statusCodes: [500, 502, 503, 504] },
      timeout: { request: 15_000 },
    });

    if (response.statusCode !== 200) {
      throw new Error(
        `NovelFull returned ${response.statusCode} for ${url}`
      );
    }

    return response.body;
  }

  // ─── Search ────────────────────────────────────────────────────────────────
  async search(query: string): Promise<NovelSearchResult[]> {
    const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`;
    const html = await this.fetch(url);
    const $ = cheerio.load(html);
    const results: NovelSearchResult[] = [];

    $(".list-truyen .row").each((_i, el) => {
      const anchor = $(el).find("h3.truyen-title a");
      const title = anchor.text().trim();
      const href = anchor.attr("href") ?? "";
      const slug = href.replace(/^\//, "").replace(/\.html$/, "");
      const cover = $(el).find("img").attr("src") ?? "";
      const latestChapter = $(el).find(".text-info a").first().text().trim();

      if (title && slug) {
        results.push({ title, slug, cover, latestChapter });
      }
    });

    return results;
  }

  // ─── Novel info ────────────────────────────────────────────────────────────
  async fetchNovelInfo(slug: string): Promise<NovelInfo> {
    const url = `${this.baseUrl}/${slug}.html`;
    const html = await this.fetch(url);
    const $ = cheerio.load(html);

    const title = $("h3.title").text().trim();
    const cover = $(".book img").attr("src") ?? "";
    const author = $('a[itemprop="author"]').text().trim();
    const status = $(".info .text-primary").first().text().trim();
    const genres: string[] = [];
    $('a[itemprop="genre"]').each((_i, el) => genres.push($(el).text().trim()));
    const description = $(".desc-text").text().trim();

    return { title, slug, cover, author, status, genres, description };
  }

  // ─── Chapter list (paginated) ──────────────────────────────────────────────
  async fetchChapterList(slug: string, page = 1): Promise<ChapterListResult> {
    const url = `${this.baseUrl}/${slug}.html?page=${page}&per-page=50`;
    const html = await this.fetch(url);
    const $ = cheerio.load(html);

    const chapters: { title: string; slug: string; date: string }[] = [];

    $(".list-chapter .row a").each((_i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href") ?? "";
      const chapterSlug = href.split("/").pop()?.replace(/\.html$/, "") ?? "";
      const date = $(el).closest(".row").find(".text-info").text().trim();
      if (title && chapterSlug) chapters.push({ title, slug: chapterSlug, date });
    });

    const totalPages = parseInt(
      $(".pagination li:last-child a").attr("data-page") ?? "1",
      10
    );

    return { chapters, page, totalPages };
  }

  // ─── Chapter content ───────────────────────────────────────────────────────
  async fetchChapterContent(
    novelSlug: string,
    chapterSlug: string
  ): Promise<ChapterContent> {
    const url = `${this.baseUrl}/${novelSlug}/${chapterSlug}.html`;
    const html = await this.fetch(url);
    const $ = cheerio.load(html);

    const title = $(".chapter-title").text().trim();
    // Remove ads and injected elements before extracting text
    $("#chapter-content .ads, #chapter-content script").remove();
    const content = $("#chapter-content").html() ?? "";

    const prevChapter =
      $(".chapter-nav a#prev_chap").attr("href")?.split("/").pop()?.replace(/\.html$/, "") ??
      null;
    const nextChapter =
      $(".chapter-nav a#next_chap").attr("href")?.split("/").pop()?.replace(/\.html$/, "") ??
      null;

    return { title, content, prevChapter, nextChapter };
  }
}

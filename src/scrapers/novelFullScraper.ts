import * as cheerio from "cheerio";
import { fetchHTML } from "../utils/httpClient";
import type { NovelInfo, NovelSearchResult, ChapterListResult, ChapterContent } from "../types/novel";

export class NovelFullScraper {
  private readonly baseUrl = "https://novelfull.com";

  async search(query: string): Promise<NovelSearchResult[]> {
    const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`;
    const html = await fetchHTML(url);
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

  async fetchNovelInfo(slug: string): Promise<NovelInfo> {
    const url = `${this.baseUrl}/${slug}.html`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    const title = $("h3.title").text().trim();
    const cover = $(".book img").attr("src") ?? "";
    const author = $('a[itemprop="author"]').text().trim();
    const status = $(".info .text-primary").first().text().trim();
    const genres: string[] = [];
    $('a[itemprop="genre"]').each((_i, el) => { genres.push($(el).text().trim()); });
    const description = $(".desc-text").text().trim();

    return { title, slug, cover, author, status, genres, description };
  }

  async fetchChapterList(slug: string, page = 1): Promise<ChapterListResult> {
    const url = `${this.baseUrl}/${slug}.html?page=${page}&per-page=50`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    const chapters: { title: string; slug: string; date: string }[] = [];

    $(".list-chapter .row a").each((_i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href") ?? "";
      const chapterSlug = href.split("/").pop()?.replace(/\.html$/, "") ?? "";
      const date = $(el).closest(".row").find(".text-info").text().trim();
      if (title && chapterSlug) { chapters.push({ title, slug: chapterSlug, date }); }
    });

    const totalPagesAttr = $(".pagination li:last-child a").attr("data-page");
    const totalPages = totalPagesAttr ? parseInt(totalPagesAttr, 10) : 1;

    return { chapters, page, totalPages };
  }

  async fetchChapterContent(novelSlug: string, chapterSlug: string): Promise<ChapterContent> {
    const url = `${this.baseUrl}/${novelSlug}/${chapterSlug}.html`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    const title = $(".chapter-title").text().trim();
    $("#chapter-content .ads, #chapter-content script").remove();
    const content = $("#chapter-content").html() ?? "";

    const prevChapter =
      $(".chapter-nav a#prev_chap").attr("href")?.split("/").pop()?.replace(/\.html$/, "") ?? null;
    const nextChapter =
      $(".chapter-nav a#next_chap").attr("href")?.split("/").pop()?.replace(/\.html$/, "") ?? null;

    return { title, content, prevChapter, nextChapter };
  }
}

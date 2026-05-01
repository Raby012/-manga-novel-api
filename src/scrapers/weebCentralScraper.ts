import * as cheerio from "cheerio";
import { fetchHTML } from "../utils/httpClient";

const BASE = "https://weebcentral.com";

export interface WCResult {
  id: string; title: string;
  contentType: "manga" | "manhwa" | "manhua" | "unknown";
  coverUrl: string; status: string; latestChapter: string;
}
export interface WCChapter { id: string; title: string; date: string; }

function parseType(raw: string): WCResult["contentType"] {
  const t = raw.toLowerCase();
  if (t.includes("manhwa")) return "manhwa";
  if (t.includes("manhua")) return "manhua";
  if (t.includes("manga"))  return "manga";
  return "unknown";
}

export class WeebCentralScraper {
  async search(query: string, page = 1): Promise<WCResult[]> {
    const url = `${BASE}/search?keyword=${encodeURIComponent(query)}&page=${page}`;
    const html = await fetchHTML(url, BASE);
    const $ = cheerio.load(html);
    const results: WCResult[] = [];
    $("article.series-item, .manga-item").each((_i, el) => {
      const anchor  = $(el).find("a[href*='/series/']").first();
      const href    = anchor.attr("href") ?? "";
      const id      = href.replace(BASE, "").replace(/^\//, "");
      const title   = anchor.find("img").attr("alt") ?? anchor.text().trim();
      const cover   = anchor.find("img").attr("src") ?? "";
      const status  = $(el).find("[class*='status']").text().trim();
      const latest  = $(el).find("a[href*='/chapter']").first().text().trim();
      const typeRaw = $(el).find("[class*='type'], .type").text().trim();
      if (id && title) results.push({ id, title, contentType: parseType(typeRaw), coverUrl: cover, status, latestChapter: latest });
    });
    return results;
  }

  async fetchSeriesInfo(id: string): Promise<{
    title: string; contentType: WCResult["contentType"];
    coverUrl: string; status: string; genres: string[];
    description: string; authors: string[];
  }> {
    const html = await fetchHTML(`${BASE}/${id}`, BASE);
    const $ = cheerio.load(html);
    const title  = $("h1").first().text().trim();
    const cover  = $(".series-image img, .cover img").attr("src") ?? "";
    const desc   = $(".summary, .synopsis").first().text().trim();
    const genres: string[] = []; const authors: string[] = [];
    let status = ""; let typeRaw = "";
    $(".info-item, .series-info li").each((_i, el) => {
      const label = $(el).find(".label, strong").text().toLowerCase();
      const value = $(el).find(".value, span:last-child, a").text().trim();
      if (label.includes("status"))  { status  = value; }
      if (label.includes("type"))    { typeRaw = value; }
      if (label.includes("genre"))   { genres.push(...value.split(",").map((s: string) => s.trim())); }
      if (label.includes("author"))  { authors.push(value); }
    });
    return { title, contentType: parseType(typeRaw), coverUrl: cover, status, genres: genres.filter(Boolean), description: desc, authors: authors.filter(Boolean) };
  }

  async fetchChapters(id: string): Promise<WCChapter[]> {
    const html = await fetchHTML(`${BASE}/${id}`, BASE);
    const $ = cheerio.load(html);
    const chapters: WCChapter[] = [];
    $("a[href*='/chapter']").each((_i, el) => {
      const href  = $(el).attr("href") ?? "";
      const chId  = href.replace(BASE, "").replace(/^\//, "");
      const title = $(el).text().trim();
      const date  = $(el).closest("li, .chapter-item").find(".date, time").text().trim();
      if (chId) chapters.push({ id: chId, title, date });
    });
    return chapters;
  }

  async fetchChapterPages(chapterId: string): Promise<string[]> {
    const html = await fetchHTML(`${BASE}/${chapterId}`, BASE);
    const $ = cheerio.load(html);
    const pages: string[] = [];
    $("img[src*='cdn'], .reader-image img, #chapter-container img").each((_i, el) => {
      const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
      if (src) pages.push(src);
    });
    return pages;
  }
}

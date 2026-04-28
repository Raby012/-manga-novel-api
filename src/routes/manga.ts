/**
 * manga.ts  — /api/manga/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified manga/manhwa/manhua endpoint that delegates to the correct scraper
 * based on the ?source= query parameter.
 *
 * SOURCES
 * ────────
 *   comick      → api.comick.io  (manga + manhwa + manhua, CF-protected JSON API)
 *   mangadex    → api.mangadex.org  (public REST API, no CF)
 *   weebcentral → weebcentral.com  (HTML scrape, CF-protected)
 *   asura       → asuracomic.net  (HTML scrape, CF-protected)
 *
 * CONTENT TYPES
 * ──────────────
 * Every response includes a `contentType` field: "manga" | "manhwa" | "manhua" | "unknown"
 * Your frontend can use this to show the correct badge.
 */

import { Router, Request, Response } from "express";
import { asyncWrapper }             from "../utils/asyncWrapper";
import { ComickScraper }            from "../scrapers/comickScraper";
import { MangaDexScraper }          from "../scrapers/mangaDexScraper";
import { WeebCentralScraper }       from "../scrapers/weebCentralScraper";
import { AsuraScraper }             from "../scrapers/asuraScraper";

export const mangaRouter = Router();

const comick      = new ComickScraper();
const mangadex    = new MangaDexScraper();
const weebcentral = new WeebCentralScraper();
const asura       = new AsuraScraper();

type Source = "comick" | "mangadex" | "weebcentral" | "asura";
const VALID_SOURCES: Source[] = ["comick", "mangadex", "weebcentral", "asura"];

function getSource(req: Request): Source {
  const s = String(req.query.source ?? "comick").toLowerCase();
  return VALID_SOURCES.includes(s as Source) ? (s as Source) : "comick";
}

// GET /api/manga/sources
mangaRouter.get("/sources", (_req, res) => {
  res.json({
    sources: [
      { id: "comick",      name: "ComicK",      apiBase: "api.comick.io",     types: ["manga","manhwa","manhua"], cloudflareProtected: true,  bypassMethod: "got-scraping Chrome TLS fingerprint" },
      { id: "mangadex",   name: "MangaDex",    apiBase: "api.mangadex.org",  types: ["manga","manhwa","manhua"], cloudflareProtected: false, bypassMethod: "N/A — public API" },
      { id: "weebcentral",name: "WeebCentral", apiBase: "weebcentral.com",   types: ["manga","manhwa","manhua"], cloudflareProtected: true,  bypassMethod: "got-scraping Chrome TLS fingerprint" },
      { id: "asura",      name: "AsuraScans",  apiBase: "asuracomic.net",    types: ["manga","manhwa","manhua"], cloudflareProtected: true,  bypassMethod: "got-scraping Chrome TLS fingerprint" },
    ],
  });
});

// GET /api/manga/search?q=&source=&type=&limit=&page=
mangaRouter.get("/search", asyncWrapper(async (req: Request, res: Response) => {
  const query = String(req.query.q ?? "").trim();
  if (!query) return res.status(400).json({ error: "'q' is required." });
  const source = getSource(req);
  const type   = (req.query.type as any) ?? undefined;
  const limit  = Math.min(Number(req.query.limit ?? 20), 100);
  const page   = Math.max(Number(req.query.page  ?? 1),  1);
  let results;
  switch (source) {
    case "comick":      results = await comick.search(query, { type, limit, page }); break;
    case "mangadex":    results = await mangadex.search(query, { type, limit, offset: (page-1)*limit }); break;
    case "weebcentral": results = await weebcentral.search(query, page); break;
    case "asura":       results = await asura.search(query); break;
  }
  res.json({ source, query, results });
}));

// GET /api/manga/trending?source=&type=&page=
mangaRouter.get("/trending", asyncWrapper(async (req: Request, res: Response) => {
  const source = getSource(req);
  const type   = (req.query.type as any) ?? undefined;
  const page   = Math.max(Number(req.query.page  ?? 1),  1);
  const limit  = Math.min(Number(req.query.limit ?? 20), 100);
  let results;
  switch (source) {
    case "comick":   results = await comick.trending(type, page); break;
    case "mangadex": results = await mangadex.trending({ type, limit, offset: (page-1)*limit }); break;
    default: return res.status(400).json({ error: `Trending not supported for '${source}'` });
  }
  res.json({ source, results });
}));

// GET /api/manga/:id?source=
mangaRouter.get("/:id", asyncWrapper(async (req: Request, res: Response) => {
  const source = getSource(req);
  const { id } = req.params;
  let info;
  switch (source) {
    case "comick":      info = await comick.fetchComicInfo(id); break;
    case "mangadex":    info = await mangadex.fetchMangaInfo(id); break;
    case "weebcentral": info = await weebcentral.fetchSeriesInfo(id); break;
    case "asura":       info = await asura.fetchSeriesInfo(id); break;
  }
  res.json({ source, ...info });
}));

// GET /api/manga/:id/chapters?source=&page=&lang=
mangaRouter.get("/:id/chapters", asyncWrapper(async (req: Request, res: Response) => {
  const source = getSource(req);
  const { id } = req.params;
  const page   = Math.max(Number(req.query.page  ?? 1),  1);
  const lang   = String(req.query.lang  ?? "en");
  const limit  = Math.min(Number(req.query.limit ?? 60), 200);
  let result;
  switch (source) {
    case "comick":      result = await comick.fetchChapters(id, { page, lang, limit }); break;
    case "mangadex":    result = await mangadex.fetchChapters(id, { lang, limit, offset: (page-1)*limit }); break;
    case "weebcentral": result = { chapters: await weebcentral.fetchChapters(id), total: null }; break;
    case "asura":       result = { chapters: await asura.fetchChapters(id), total: null }; break;
  }
  res.json({ source, ...result });
}));

// GET /api/manga/:id/chapters/:chapterId/pages?source=
mangaRouter.get("/:id/chapters/:chapterId/pages", asyncWrapper(async (req: Request, res: Response) => {
  const source = getSource(req);
  const { chapterId } = req.params;
  let pages;
  switch (source) {
    case "comick":      pages = await comick.fetchChapterPages(chapterId); break;
    case "mangadex":    pages = await mangadex.fetchChapterPages(chapterId); break;
    case "weebcentral": pages = await weebcentral.fetchChapterPages(chapterId); break;
    case "asura":       pages = await asura.fetchChapterPages(chapterId); break;
  }
  res.json({ source, chapterId, pages });
}));

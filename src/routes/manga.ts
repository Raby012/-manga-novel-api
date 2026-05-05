import { Router, Request, Response } from "express";
import { asyncWrapper }          from "../utils/asyncWrapper";
import { ComickScraper }         from "../scrapers/comickScraper";
import { MangaDexScraper }       from "../scrapers/mangaDexScraper";
import { WeebCentralScraper }    from "../scrapers/weebCentralScraper";
import { AsuraScraper }          from "../scrapers/asuraScraper";
import { aggregateChapters }     from "../utils/chapterAggregator";

export const mangaRouter = Router();

const comick      = new ComickScraper();
const mangadex    = new MangaDexScraper();
const weebcentral = new WeebCentralScraper();
const asura       = new AsuraScraper();

type Source = "comick" | "mangadex" | "weebcentral" | "asura";
const VALID_SOURCES: Source[] = ["comick", "mangadex", "weebcentral", "asura"];

function getSource(req: Request): Source {
  const s = String(req.query.source ?? "mangadex").toLowerCase();
  return VALID_SOURCES.includes(s as Source) ? (s as Source) : "mangadex";
}

// ── GET /api/manga/sources ────────────────────────────────────────────────────
mangaRouter.get("/sources", (_req, res) => {
  res.json({
    sources: [
      { id: "comick",      name: "ComicK",      types: ["manga","manhwa","manhua"] },
      { id: "mangadex",   name: "MangaDex",    types: ["manga","manhwa","manhua"] },
      { id: "weebcentral",name: "WeebCentral", types: ["manga","manhwa","manhua"] },
      { id: "asura",      name: "AsuraScans",  types: ["manga","manhwa","manhua"] },
    ],
  });
});

// ── GET /api/manga/search ─────────────────────────────────────────────────────
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

// ── GET /api/manga/trending ───────────────────────────────────────────────────
mangaRouter.get("/trending", asyncWrapper(async (req: Request, res: Response) => {
  const source = getSource(req);
  const type   = (req.query.type as any) ?? undefined;
  const page   = Math.max(Number(req.query.page  ?? 1), 1);
  const limit  = Math.min(Number(req.query.limit ?? 20), 100);

  let results;
  switch (source) {
    case "comick":   results = await comick.trending(type, page); break;
    case "mangadex": results = await mangadex.trending({ type, limit, offset: (page-1)*limit }); break;
    default: return res.status(400).json({ error: `Trending not supported for '${source}'` });
  }
  res.json({ source, results });
}));

// ── GET /api/manga/:id ────────────────────────────────────────────────────────
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

// ── GET /api/manga/:id/chapters ───────────────────────────────────────────────
// When source=mangadex, automatically aggregates from MangaDex + ComicK
// so licensed titles that have 0 chapters on MangaDex still return chapters
// from ComicK. No source switching needed on the frontend.
mangaRouter.get("/:id/chapters", asyncWrapper(async (req: Request, res: Response) => {
  const source = getSource(req);
  const { id } = req.params;
  const lang   = String(req.query.lang  ?? "en");
  const page   = Math.max(Number(req.query.page  ?? 1), 1);
  const limit  = Math.min(Number(req.query.limit ?? 96), 500);
  const title  = String(req.query.title ?? "");

  // MangaDex: use aggregator to pull from MangaDex + ComicK simultaneously
  if (source === "mangadex") {
    const result = await aggregateChapters({
      mangadexId: id,
      title,       // pass title so ComicK can search for it
      lang,
    });

    // Apply pagination to the merged result
    const start    = (page - 1) * limit;
    const paginated = result.chapters.slice(start, start + limit);
    return res.json({
      source:   "aggregated",
      sources:  result.sources,
      chapters: paginated,
      total:    result.total,
      page,
    });
  }

  // Other sources: direct fetch
  let result;
  switch (source) {
    case "comick":
      result = await comick.fetchChapters(id, { page, lang, limit });
      break;
    case "weebcentral":
      result = { chapters: await weebcentral.fetchChapters(id), total: null };
      break;
    case "asura":
      result = { chapters: await asura.fetchChapters(id), total: null };
      break;
    default:
      result = { chapters: [], total: 0 };
  }
  res.json({ source, ...result });
}));

// ── GET /api/manga/:id/chapters/:chapterId/pages ──────────────────────────────
mangaRouter.get("/:id/chapters/:chapterId/pages", asyncWrapper(async (req: Request, res: Response) => {
  const source    = getSource(req);
  const { chapterId } = req.params;
  const chSrc     = String(req.query.chapterSource ?? source); // chapters store their own source

  let pages;
  switch (chSrc) {
    case "comick":      pages = await comick.fetchChapterPages(chapterId); break;
    case "mangadex":    pages = await mangadex.fetchChapterPages(chapterId); break;
    case "weebcentral": pages = await weebcentral.fetchChapterPages(chapterId); break;
    case "asura":       pages = await asura.fetchChapterPages(chapterId); break;
    default:            pages = await mangadex.fetchChapterPages(chapterId);
  }
  res.json({ source: chSrc, chapterId, pages });
}));

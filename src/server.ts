import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { corsMiddleware } from "./middleware/corsMiddleware";
import { errorHandler }   from "./middleware/errorHandler";
import { mangaRouter }    from "./routes/manga";
import { novelRouter }    from "./routes/novels";
import { proxyRouter }    from "./proxy/imageProxy";
import { config }         from "../config/config";

const app = express();

// ── Inline request logger (no separate file needed) ───────────────────────────
function requestLogger(req: Request, _res: Response, next: NextFunction) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
}

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(corsMiddleware);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded — please wait before retrying." },
  skip: (req) => req.path === "/api/health",
});

const imageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Image proxy rate limit exceeded." },
});

app.use("/api", apiLimiter);
app.use("/api/proxy/image", imageLimiter);
app.use(requestLogger);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/manga",  mangaRouter);
app.use("/api/novels", novelRouter);
app.use("/api/proxy",  proxyRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    sources: ["comick", "mangadex", "weebcentral", "asura", "novelfull"],
  });
});

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀  Server → http://localhost:${config.port}`);
  console.log(`📚  Manga: ComicK · MangaDex · WeebCentral · AsuraScans`);
  console.log(`📖  Novels: NovelFull`);
  console.log(`🖼️   Image proxy: /api/proxy/image?url=<encoded>`);
  console.log(`🛡️   CORS allowed: ${config.allowedOrigins.join(", ")}`);
});

export default app;

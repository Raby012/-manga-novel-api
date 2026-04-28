/**
 * imageProxy.ts  — /api/proxy/image
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DO WE NEED AN IMAGE PROXY?
 * ───────────────────────────────
 * Even after we've fetched chapter page URLs from a manga site, your frontend
 * still can't just drop those URLs into <img src="..."> tags. Here's why:
 *
 *   1. Hotlink protection  — many CDNs (ComicK, AsuraScans …) check the
 *      Referer header on every image request. If the Referer is your app's
 *      origin instead of their own domain, they return a 403 or a placeholder.
 *
 *   2. Mixed content  — if your frontend is on HTTPS and the image CDN is HTTP
 *      only, the browser blocks the request as "mixed content".
 *
 *   3. CORS on images  — some CDNs don't set Access-Control-Allow-Origin on
 *      image responses. Canvas operations (e.g. zooming, saving) fail with
 *      CORS errors even though the image visually loads.
 *
 * HOW THIS PROXY SOLVES IT
 * ─────────────────────────
 * Instead of:   <img src="https://meo.comick.pictures/page.jpg">
 * You use:      <img src="http://localhost:3001/api/proxy/image?url=https%3A%2F%2Fmeo...">
 *
 * This server then:
 *   1. Fetches the image with the correct Referer spoofed to the source site.
 *   2. Streams the raw bytes back to your frontend.
 *   3. Copies the content-type header so the browser decodes it correctly.
 *   4. Adds Access-Control-Allow-Origin: * so canvas operations work.
 *   5. Adds a 7-day cache header so the browser doesn't re-proxy every visit.
 *
 * SECURITY
 * ─────────
 * We only allow proxying domains on the ALLOWED_IMAGE_DOMAINS list below.
 * This prevents the proxy from being used as an open relay.
 */

import { Router, Request, Response } from "express";
import { gotScraping } from "got-scraping";
import { asyncWrapper } from "../utils/asyncWrapper";

export const proxyRouter = Router();

// ─── Domain allow-list ────────────────────────────────────────────────────────
// Only images from these CDN domains can be proxied.
const ALLOWED_IMAGE_DOMAINS = [
  "meo.comick.pictures",
  "meo2.comick.pictures",
  "uploads.mangadex.org",
  "cdn.weebcentral.com",
  "gg.asuracomic.net",
  "asuratoon.com",
  "asuracomic.net",
  "novelfull.com",
  "img.novelfull.com",
];

// ─── GET /api/proxy/image?url=<encoded-url> ───────────────────────────────────
proxyRouter.get(
  "/image",
  asyncWrapper(async (req: Request, res: Response) => {
    const rawUrl = String(req.query.url ?? "").trim();
    if (!rawUrl) return res.status(400).json({ error: "'url' query param required." });

    // ── Validate URL ───────────────────────────────────────────────────────
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "Invalid URL." });
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Only http/https URLs allowed." });
    }

    if (!ALLOWED_IMAGE_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return res.status(403).json({
        error: `Domain '${parsed.hostname}' is not in the proxy allow-list.`,
        allowedDomains: ALLOWED_IMAGE_DOMAINS,
      });
    }

    // ── Derive a realistic Referer for the source domain ──────────────────
    // e.g. meo.comick.pictures → https://comick.io/
    const refererMap: Record<string, string> = {
      "meo.comick.pictures":   "https://comick.io/",
      "meo2.comick.pictures":  "https://comick.io/",
      "uploads.mangadex.org":  "https://mangadex.org/",
      "cdn.weebcentral.com":   "https://weebcentral.com/",
      "gg.asuracomic.net":     "https://asuracomic.net/",
    };
    const referer =
      refererMap[parsed.hostname] ??
      `${parsed.protocol}//${parsed.hostname}/`;

    // ── Fetch image bytes ──────────────────────────────────────────────────
    const response = await gotScraping({
      url: rawUrl,
      responseType: "buffer",
      headerGeneratorOptions: {
        browsers: [{ name: "chrome", minVersion: 120 }],
        operatingSystems: ["windows"],
      },
      headers: {
        Referer: referer,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      retry: { limit: 2 },
      timeout: { request: 15_000 },
    });

    if (response.statusCode !== 200) {
      return res.status(502).json({
        error: `Upstream returned ${response.statusCode} for the image.`,
      });
    }

    // ── Stream response ────────────────────────────────────────────────────
    const contentType = response.headers["content-type"] ?? "image/jpeg";
    res.setHeader("Content-Type", contentType);
    // Allow canvas cross-origin access
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Cache for 7 days — images don't change
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("X-Proxied-From", parsed.hostname);

    res.end(response.body);
  })
);

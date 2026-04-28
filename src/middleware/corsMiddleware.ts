/**
 * corsMiddleware.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS CORS AND WHY DOES IT MATTER?
 * ──────────────────────────────────────
 * CORS (Cross-Origin Resource Sharing) is a browser security policy.
 * When your React frontend on http://localhost:5173 tries to call
 * http://localhost:3001/api/manga/search, the browser first sends a
 * "preflight" OPTIONS request asking: "is this server OK with me talking to it?"
 *
 * If the server doesn't reply with the right Access-Control-Allow-* headers,
 * the browser silently blocks the response — even if the server returned 200.
 *
 * IMPORTANT: CORS is enforced ONLY by browsers. Node-to-Node requests
 * (our server → ComicK, NovelFull …) are never subject to CORS. That is
 * exactly why having a proxy server solves the problem.
 *
 * WHAT THIS MIDDLEWARE DOES
 * ─────────────────────────
 *  1. Reads ALLOWED_ORIGINS from .env to build the allow-list.
 *  2. For every request, compares the incoming Origin header to the list.
 *  3. If it matches → sets Access-Control-Allow-Origin to that exact origin
 *     (not "*", which would break requests that include cookies / auth headers).
 *  4. Handles OPTIONS preflight requests immediately with 204 so the browser
 *     doesn't wait for the actual route handler.
 *  5. Sets Vary: Origin so CDNs/caches don't serve the wrong CORS headers to
 *     a different origin.
 *
 * HOW TO ADD A NEW ALLOWED ORIGIN
 * ─────────────────────────────────
 *   In your .env file:
 *     ALLOWED_ORIGINS=http://localhost:5173,https://myapp.com,https://staging.myapp.com
 */

import { Request, Response, NextFunction } from "express";
import { config } from "../../config/config";

// Exposed headers the browser JavaScript is allowed to read
const EXPOSED_HEADERS = ["X-Total-Count", "X-Page", "X-Total-Pages", "Retry-After"];

// Headers browsers are allowed to send
const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
  "Origin",
];

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingOrigin = req.headers.origin;

  // ── Step 1: Check if the origin is on our allow-list ──────────────────────
  const isAllowed =
    incomingOrigin !== undefined &&
    config.allowedOrigins.includes(incomingOrigin);

  if (isAllowed) {
    // ── Step 2: Set permissive headers ONLY for allowed origins ───────────
    // Using the exact origin (not "*") is required when credentials are sent.
    res.setHeader("Access-Control-Allow-Origin", incomingOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS.join(", "));
    res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS.join(", "));

    // How long the browser can cache the preflight result (10 minutes)
    res.setHeader("Access-Control-Max-Age", "600");

    // Vary: Origin tells CDNs that the response differs by origin, preventing
    // a cached response for origin A being served to origin B.
    res.setHeader("Vary", "Origin");
  }

  // ── Step 3: Handle preflight (OPTIONS) immediately ────────────────────────
  // The browser sends OPTIONS before any non-simple request (POST, PUT, or
  // any GET with custom headers). We must respond quickly or the actual
  // request will never be sent.
  if (req.method === "OPTIONS") {
    // 204 No Content — success, no body needed
    res.status(204).end();
    return;
  }

  next();
}

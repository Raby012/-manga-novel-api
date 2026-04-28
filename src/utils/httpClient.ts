/**
 * httpClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SINGLE SOURCE OF TRUTH for every outbound HTTP request this server makes.
 *
 * WHY THIS FILE EXISTS
 * ──────────────────────
 * Browsers enforce CORS — servers don't. So our Express server acts as a
 * middleman: the frontend calls us, we call the target site, we return the
 * data.  But many target sites (ComicK, NovelFull …) sit behind Cloudflare,
 * which detects non-browser traffic by inspecting:
 *
 *   1. TLS fingerprint  — the exact list of cipher suites / extensions a
 *      client advertises during the TLS handshake. Node's built-in `fetch`
 *      and `axios` produce a fingerprint that is trivially recognisable as
 *      non-browser traffic. Cloudflare blocks it with a 403 / 503.
 *
 *   2. HTTP/2 SETTINGS frame  — browsers send a very specific sequence of
 *      SETTINGS parameters (header table size, push enable, initial window
 *      size …). Node sends different defaults.
 *
 *   3. Header order  — browsers always send headers in the same order
 *      (sec-ch-ua before accept-language, etc.). Most HTTP libraries send
 *      them in insertion order, which looks wrong to CF's heuristics.
 *
 * `got-scraping` solves all three: it ships a header generator trained on
 * real Chrome / Firefox browser traffic and patches Node's TLS stack to emit
 * the correct fingerprint.  Cloudflare sees a Chrome request and lets it
 * through.
 *
 * USAGE
 * ──────
 *   import { fetchHTML, fetchJSON } from "../utils/httpClient";
 *
 *   const html = await fetchHTML("https://novelfull.com/...");
 *   const json = await fetchJSON<SearchResult>("https://api.comick.io/...");
 */

import { gotScraping, type OptionsOfTextResponseBody } from "got-scraping";

// ─── Shared browser-impersonation options ────────────────────────────────────
const BROWSER_OPTS = {
  headerGeneratorOptions: {
    // Impersonate a recent Chrome on Windows — the most common fingerprint,
    // least likely to be flagged as unusual by Cloudflare.
    browsers: [{ name: "chrome" as const, minVersion: 120 }],
    operatingSystems: ["windows" as const],
    locales: ["en-US", "en"],
  },
  retry: {
    limit: 3,
    // Retry on transient Cloudflare errors and generic server errors
    statusCodes: [408, 429, 500, 502, 503, 504],
    // Exponential back-off: 1s, 2s, 4s
    calculateDelay: ({ attemptCount }: { attemptCount: number }) =>
      Math.min(1000 * 2 ** (attemptCount - 1), 8000),
  },
  timeout: { request: 20_000 },
  // Follow up to 5 redirects (some sites redirect http→https, www→non-www …)
  followRedirect: true,
  maxRedirects: 5,
};

// ─── HTML fetcher ─────────────────────────────────────────────────────────────
/**
 * Fetch a page and return its raw HTML string.
 * Throws a descriptive error if the status is not 200.
 */
export async function fetchHTML(
  url: string,
  extra?: Partial<OptionsOfTextResponseBody>
): Promise<string> {
  const res = await gotScraping({
    url,
    ...BROWSER_OPTS,
    ...extra,
    headers: {
      // Pretend we navigated here from a Google search — many sites check Referer
      Referer: "https://www.google.com/",
      "Accept-Language": "en-US,en;q=0.9",
      ...(extra?.headers ?? {}),
    },
  });

  if (res.statusCode !== 200) {
    throw new Error(
      `[httpClient] ${res.statusCode} fetching ${url} — ` +
        `body snippet: ${res.body.slice(0, 120)}`
    );
  }

  return res.body;
}

// ─── JSON fetcher (for REST APIs that are also behind CF) ─────────────────────
/**
 * Fetch a JSON endpoint and return the parsed body as T.
 * Adds an Accept: application/json header automatically.
 */
export async function fetchJSON<T = unknown>(
  url: string,
  extra?: Partial<OptionsOfTextResponseBody>
): Promise<T> {
  const res = await gotScraping({
    url,
    ...BROWSER_OPTS,
    ...extra,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      // ComicK's API checks this header — without it some endpoints return 403
      Origin: "https://comick.io",
      Referer: "https://comick.io/",
      ...(extra?.headers ?? {}),
    },
  });

  if (res.statusCode !== 200) {
    throw new Error(`[httpClient] ${res.statusCode} fetching ${url}`);
  }

  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error(
      `[httpClient] Response from ${url} was not valid JSON: ` +
        res.body.slice(0, 120)
    );
  }
}

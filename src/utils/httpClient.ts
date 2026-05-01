import { gotScraping } from "got-scraping";

const BROWSER_OPTS = {
  headerGeneratorOptions: {
    browsers: [{ name: "chrome" as const, minVersion: 112 }],
    operatingSystems: ["windows" as const],
    locales: ["en-US", "en"],
  },
  retry: { limit: 3 },
  timeout: { request: 20_000 },
};

export async function fetchHTML(url: string, referer = "https://www.google.com/"): Promise<string> {
  const res = await gotScraping({
    url,
    ...BROWSER_OPTS,
    headers: {
      Referer: referer,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (res.statusCode !== 200) throw new Error(`[httpClient] ${res.statusCode} fetching ${url}`);
  return res.body;
}

export async function fetchJSON<T = unknown>(url: string, referer = "https://comick.io/"): Promise<T> {
  const res = await gotScraping({
    url,
    ...BROWSER_OPTS,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://comick.io",
      Referer: referer,
    },
  });
  if (res.statusCode !== 200) throw new Error(`[httpClient] ${res.statusCode} fetching ${url}`);
  try { return JSON.parse(res.body) as T; }
  catch { throw new Error(`[httpClient] Invalid JSON from ${url}`); }
}

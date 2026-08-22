import type { SearchSpec } from "./contracts";

const ENDPOINT = "https://serpapi.com/search.json";
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3; // one call plus two retries
const BACKOFF_MS = [2_000, 8_000];
const MAX_RETRY_AFTER_MS = 30_000; // cap so a long Retry-After header cannot stall a scan

const googleTbs = (w: SearchSpec["timeWindow"]) => (w === "7d" ? "qdr:w" : w === "30d" ? "qdr:m" : undefined);

export function buildParams(spec: SearchSpec): Record<string, string> {
  const base: Record<string, string> = { engine: spec.engine, hl: spec.language };
  switch (spec.engine) {
    case "google_trends_trending_now":
      return { ...base, geo: spec.query, hl: "en" };
    case "youtube":
      return { ...base, search_query: spec.query, gl: "us" };
    case "google_maps":
      return { ...base, q: spec.query, location: spec.location, type: "search" };
    case "google_events":
      return { ...base, q: spec.query, location: spec.location, gl: "us" };
    case "google_news":
      // No tbs/location param for this engine (serpapi.com/google-news-api). Any `when:`
      // time-window operator is already inside spec.query — rendered by the query
      // template — so searchRuns.query stays the source of truth for what ran.
      return { ...base, q: spec.query, gl: "us" };
    case "google":
    default: {
      // ponytail: no `num` here — serpapi.com/search-api documents only `start` for
      // pagination; `num` is not a real parameter for this engine.
      const tbs = googleTbs(spec.timeWindow);
      return { ...base, q: spec.query, location: spec.location, gl: "us", ...(tbs ? { tbs } : {}) };
    }
  }
}

export type SerpApiCallResult =
  | { ok: true; json: unknown; durationMs: number; attempts: number; params: Record<string, string> }
  | { ok: false; errorCode: string; errorMessage: string; durationMs: number; attempts: number; params: Record<string, string> };

type CallOptions = { apiKey: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const redact = (message: string, apiKey: string) => message.split(apiKey).join("[redacted]").slice(0, 400);
const retriable = (code: number) => code === 429 || code >= 500;

// Retry-After is not documented anywhere in SerpApi's docs (checked search-api, the
// integrations/FAQ page); this only fires if a real response ever sends one.
const retryAfterMs = (response: Response): number | undefined => {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
};

export async function callSerpApi(spec: SearchSpec, options: CallOptions): Promise<SerpApiCallResult> {
  const { apiKey, fetchImpl = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = options;
  const params = buildParams(spec);
  const startedAt = Date.now();
  let lastCode = "unknown";
  let lastMessage = "no attempt completed";
  let nextDelayMs: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, api_key: apiKey })}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        lastCode = `http_${response.status}`;
        lastMessage = `SerpApi returned ${response.status}`;
        if (!retriable(response.status)) break;
        nextDelayMs = retryAfterMs(response);
      } else {
        const json = (await response.json()) as { error?: string };
        if (json && typeof json === "object" && typeof json.error === "string") {
          return { ok: false, errorCode: "serpapi_error", errorMessage: redact(json.error, apiKey), durationMs: Date.now() - startedAt, attempts: attempt, params };
        }
        return { ok: true, json, durationMs: Date.now() - startedAt, attempts: attempt, params };
      }
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      lastCode = aborted ? "timeout" : "network_error";
      lastMessage = redact(error instanceof Error ? error.message : String(error), apiKey);
    }
    if (attempt < MAX_ATTEMPTS) {
      const base = BACKOFF_MS[attempt - 1] ?? 8_000;
      const jittered = base + Math.floor(base * 0.25 * (attempt % 2 === 0 ? 1 : -1));
      await sleep(nextDelayMs ?? jittered);
      nextDelayMs = undefined;
    }
  }
  return { ok: false, errorCode: lastCode, errorMessage: lastMessage, durationMs: Date.now() - startedAt, attempts: MAX_ATTEMPTS, params };
}

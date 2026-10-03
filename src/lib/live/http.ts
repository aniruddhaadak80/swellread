/** Time-bounded JSON fetch with one bounded retry. No secret ever travels through here. */

export interface FetchOk<T> {
  ok: true;
  data: T;
  fetchedAt: string;
}

export interface FetchFail {
  ok: false;
  reason: string;
}

export type FetchResult<T> = FetchOk<T> | FetchFail;

const DEFAULT_TIMEOUT_MS = 9000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

/**
 * Fetches JSON with an AbortController timeout and at most `retries` extra
 * attempts. Retries only on transport/5xx failures, never on a bad JSON body.
 */
export async function fetchJson<T>(
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, headers }: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<FetchResult<T>> {
  let lastReason = "unknown";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "swellread/1.0 (+https://github.com/aniruddhaadak80/swellread)",
          ...(headers ?? {}),
        },
        cache: "no-store",
      });
      if (!response.ok) {
        lastReason = `HTTP ${response.status} from ${hostOf(url)}`;
        if (response.status < 500 && response.status !== 429) {
          return { ok: false, reason: lastReason };
        }
      } else {
        const data = (await response.json()) as T;
        return { ok: true, data, fetchedAt: new Date().toISOString() };
      }
    } catch (error) {
      lastReason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown transport error";
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: lastReason };
}
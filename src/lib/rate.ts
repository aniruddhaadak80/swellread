/**
 * Best-effort anonymous abuse control.
 *
 * This is a per-instance sliding window in memory. On a serverless platform each
 * isolate keeps its own map, so it raises the cost of a casual hammering loop
 * but is not a hard limit. A production deployment that cares should put a
 * hosted limiter (Vercel WAF, Upstash, or a platform-native rule) in front of
 * the write routes. Documented in README under "Security model".
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateVerdict {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0, limit };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit,
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSec: 0, limit };
}

/** Coarse client identity. Deliberately not a permanent identifier. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}

export function sweepRateWindows(maxEntries = 5000): void {
  if (windows.size <= maxEntries) return;
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}
import type { TideExtrema, TideSeries } from "@/lib/types";
import { clamp, mean, round } from "@/lib/swell/math";

const MS_PER_HOUR = 3_600_000;

/** Parses an ISO instant, or returns null. */
export function parseTime(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Linear interpolation of a tide curve at an arbitrary instant.
 * Returns null when the instant is outside the series or the series is empty.
 */
export function sampleTide(
  points: Array<{ t: string; m: number }>,
  at: string,
): number | null {
  const target = parseTime(at);
  if (target === null || points.length === 0) return null;
  const first = parseTime(points[0].t);
  const last = parseTime(points[points.length - 1].t);
  if (first === null || last === null) return null;
  if (target < first || target > last) return null;
  if (points.length === 1) return points[0].m;

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const t = parseTime(points[mid].t);
    if (t === null) return null;
    if (t <= target) lo = mid;
    else hi = mid;
  }
  const tLo = parseTime(points[lo].t);
  const tHi = parseTime(points[hi].t);
  if (tLo === null || tHi === null) return null;
  if (tHi === tLo) return points[lo].m;
  const f = (target - tLo) / (tHi - tLo);
  return points[lo].m + (points[hi].m - points[lo].m) * f;
}

/** Tide height and rate of change (metres per hour) at an instant. */
export function tideAt(
  points: Array<{ t: string; m: number }>,
  at: string,
): { m: number; rate: number } | null {
  const centre = sampleTide(points, at);
  if (centre === null) return null;
  const ms = parseTime(at);
  if (ms === null) return null;
  const before = sampleTide(points, new Date(ms - MS_PER_HOUR).toISOString());
  const after = sampleTide(points, new Date(ms + MS_PER_HOUR).toISOString());
  if (before === null || after === null) return { m: centre, rate: 0 };
  return { m: centre, rate: (after - before) / 2 };
}

/** Local maxima and minima of a monotonic-in-time curve. */
export function detectExtrema(points: Array<{ t: string; m: number }>): {
  highs: TideExtrema[];
  lows: TideExtrema[];
} {
  const highs: TideExtrema[] = [];
  const lows: TideExtrema[] = [];
  if (points.length < 3) return { highs, lows };
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (curr.m > prev.m && curr.m >= next.m) highs.push({ t: curr.t, m: curr.m, kind: "high" });
    if (curr.m < prev.m && curr.m <= next.m) lows.push({ t: curr.t, m: curr.m, kind: "low" });
  }
  return { highs, lows };
}

/** Attaches high/low markers to a raw station series. */
export function summarizeTide(raw: {
  stationId: string | null;
  stationName: string | null;
  datum: string;
  points: Array<{ t: string; m: number }>;
  status: "live" | "fallback";
  note?: string;
}): TideSeries {
  const values = raw.points.map((point) => point.m);
  const { highs, lows } = detectExtrema(raw.points);
  return {
    stationId: raw.stationId,
    stationName: raw.stationName,
    datum: raw.datum,
    points: raw.points,
    highs,
    lows,
    rangeM: values.length ? round(Math.max(...values) - Math.min(...values), 2) : 0,
    meanM: values.length ? round(mean(values), 2) : 0,
    status: raw.status,
    note: raw.note,
  };
}

export type TideTrend = "rising" | "falling" | "slack";

export function trendFrom(rateMPerH: number | null): TideTrend | null {
  if (rateMPerH === null) return null;
  if (rateMPerH > 0.06) return "rising";
  if (rateMPerH < -0.06) return "falling";
  return "slack";
}

/**
 * Depth of water over the take-off spot at a given tide height.
 * Rounded down to centimetres so the answer is stable across runs.
 */
export function depthOverTakeoff(
  depthAtBreakM: number,
  tideM: number | null,
): number | null {
  if (tideM === null || !Number.isFinite(tideM)) return null;
  return round(Math.max(0.05, depthAtBreakM + tideM), 2);
}

/** Formats a tide height above datum for display. */
export function formatTide(metres: number | null): string {
  if (metres === null || !Number.isFinite(metres)) return "no data";
  return `${metres >= 0 ? "" : "-"}${Math.abs(metres).toFixed(2)} m`;
}

export function tideRangeLabel(series: TideSeries | null): string {
  if (!series || series.points.length === 0) return "no tide station in range";
  return `${series.rangeM.toFixed(2)} m range, mean ${series.meanM.toFixed(2)} m`;
}

/** Normalised 0..1 position of an instant inside a series. */
export function progressThrough(points: Array<{ t: string; m: number }>, at: string): number {
  if (points.length < 2) return 0;
  const first = parseTime(points[0].t);
  const last = parseTime(points[points.length - 1].t);
  const target = parseTime(at);
  if (first === null || last === null || target === null || last === first) return 0;
  return clamp((target - first) / (last - first), 0, 1);
}
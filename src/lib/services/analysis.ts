import type { ConditionsSnapshot, EngineResult, HourlyConditions, SnapshotStatus, SurfBreak, TideSeries } from "@/lib/types";
import { getBreak } from "@/lib/live/breaks";
import { formatLocalHour, getConditions, indexOfNow, localDateAt } from "@/lib/live/conditions";
import { scoreDay, scoreHour } from "@/lib/swell/engine";

/**
 * The one place a break's live conditions and its engine verdict are assembled.
 * REST routes, the agent console and the server components all call this.
 */

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  value: { snapshot: ConditionsSnapshot; tide: TideSeries };
}

/**
 * Per-instance TTL cache. Serverless isolates do not share it, which only costs
 * an extra upstream call; it never serves wrong data because the key includes
 * the break and the local date.
 */
const cache = new Map<string, CacheEntry>();

async function cachedConditions(surfBreak: SurfBreak, date: string) {
  const key = `${surfBreak.id}:${date}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;
  const fresh = await getConditions(surfBreak, date);
  if (fresh.snapshot.status === "fallback" && hit) {
    // Keep serving the last real read rather than downgrading to the sample.
    return hit.value;
  }
  cache.set(key, { expiresAt: now + TTL_MS, value: fresh });
  return fresh;
}

export function invalidateConditionsCache(breakId?: string): void {
  if (!breakId) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${breakId}:`)) cache.delete(key);
  }
}

export interface HourPoint {
  index: number;
  at: string;
  localLabel: string;
  score: number;
  band: EngineResult["band"];
  tideM: number | null;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  swellDirDeg: number | null;
  windSpeedMs: number | null;
  tideRateMPerH: number | null;
  gated: boolean;
}

export interface AnalysisResult {
  break: SurfBreak;
  snapshot: ConditionsSnapshot;
  tide: TideSeries;
  status: SnapshotStatus;
  hour: HourlyConditions;
  engine: EngineResult;
  /** Set when the caller supplied a hypothetical tide height. */
  whatIf: { tideM: number } | null;
  points: HourPoint[];
  /** Index of the current hour inside the local day, or null. */
  currentIndex: number | null;
  /** Native tide range in this snapshot, used to bound the drag control. */
  tideBounds: { min: number; max: number };
}

function hourAt(hours: HourlyConditions[], index: number): HourlyConditions {
  const found = hours[Math.min(Math.max(index, 0), hours.length - 1)];
  return found ?? hours[0];
}

/** Scores a break's day, optionally overriding one hour's tide height. */
export async function analyseBreak(query: {
  breakId: string;
  date?: string;
  hour?: number;
  tideM?: number | null;
}): Promise<AnalysisResult> {
  const surfBreak = getBreak(query.breakId);
  if (!surfBreak) throw new Error(`unknown break: ${query.breakId}`);
  const { snapshot, tide } = await cachedConditions(surfBreak, query.date ?? localDateAt(surfBreak));
  const hourIndex = query.hour ?? 0;
  const baseHour = hourAt(snapshot.hours, hourIndex);

  const whatIfTide =
    query.tideM === undefined || query.tideM === null ? null : Number(query.tideM.toFixed(2));

  const hour: HourlyConditions = whatIfTide === null ? baseHour : { ...baseHour, tideM: whatIfTide };
  const scored = scoreDay(surfBreak, snapshot.hours);
  // The per-hour verdict carries the day's window so every surface that shows a
  // score can show the window without re-running the day.
  const engine: EngineResult = { ...scoreHour({ break: surfBreak, hour }), window: scored.window };

  const points: HourPoint[] = snapshot.hours.map((row, index) => ({
    index,
    at: row.at,
    localLabel: formatLocalHour(row.at, surfBreak.timezone),
    score: scored.results[index]?.score ?? 0,
    band: scored.results[index]?.band ?? "stay-home",
    tideM: row.tideM,
    swellHeightM: row.swellHeightM,
    swellPeriodS: row.swellPeriodS,
    swellDirDeg: row.swellDirDeg,
    windSpeedMs: row.windSpeedMs,
    tideRateMPerH: row.tideRateMPerH,
    gated: (scored.results[index]?.gates.length ?? 0) > 0,
  }));

  const tideValues = snapshot.hours.map((row) => row.tideM).filter((value): value is number => value !== null);
  const bounds =
    tideValues.length > 0
      ? { min: Math.min(...tideValues), max: Math.max(...tideValues) }
      : { min: 0, max: 1 };

  return {
    break: surfBreak,
    snapshot,
    tide,
    status: snapshot.status,
    hour,
    engine,
    whatIf: whatIfTide === null ? null : { tideM: whatIfTide },
    points,
    currentIndex: indexOfNow(snapshot.hours),
    tideBounds: bounds,
  };
}

export type { TideSeries };
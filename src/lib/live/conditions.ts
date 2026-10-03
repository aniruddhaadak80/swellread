import type { ConditionsSnapshot, HourlyConditions, SnapshotStatus, SourceMeta, SurfBreak, TideSeries } from "@/lib/types";
import { fetchMarine, fetchWeather, type MarineHour, type WeatherHour } from "@/lib/live/openmeteo";
import { fetchTidePrediction } from "@/lib/live/noaa";
import { fallbackHours, fallbackSource, fallbackTidePoints } from "@/lib/live/fallback";
import { tideAt } from "@/lib/swell/tides";

/** Offset of a zone from UTC, in milliseconds, at a given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const asUtc = Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}:${get("second")}Z`,
  );
  return asUtc - instant.getTime();
}

/** UTC instant of a wall-clock time in a zone. One refinement pass handles DST. */
export function zonedToUtc(localDate: string, hour: number, minute: number, timeZone: string): Date {
  const naive = Date.parse(`${localDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  let instant = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  instant = new Date(naive - zoneOffsetMs(instant, timeZone));
  return instant;
}

/** Today's local calendar date at a break. */
export function localDateAt(breakOrZone: SurfBreak | string, now = new Date()): string {
  const timeZone = typeof breakOrZone === "string" ? breakOrZone : breakOrZone.timezone;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface ConditionsBundle {
  snapshot: ConditionsSnapshot;
  tide: TideSeries;
  /** Index of the current hour within `snapshot.hours`, or null. */
  currentIndex: number | null;
}

function indexByHour<T extends { at: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.at, row);
  return map;
}

function rateFrom(series: Array<{ at: string; m: number | null }>, at: string): number | null {
  const previous = series.find((row) => row.at === new Date(Date.parse(at) - 3_600_000).toISOString());
  const next = series.find((row) => row.at === new Date(Date.parse(at) + 3_600_000).toISOString());
  if (previous?.m == null || next?.m == null) return null;
  return Number(((next.m - previous.m) / 2).toFixed(3));
}

function gradeStatus(sources: SourceMeta[]): SnapshotStatus {
  const live = sources.filter((s) => s.status === "live").length;
  if (live === 0) return "fallback";
  if (live === sources.length) return "live";
  return "mixed";
}

/** The attribution row used when a break has no tide station at all. */
export function noStationSource(fetchedAt: string): SourceMeta {
  return {
    id: "noaa-coops",
    name: "NOAA CO-OPS tide predictions",
    url: "https://tidesandcurrents.noaa.gov/",
    license: "U.S. Government public domain",
    status: "fallback",
    fetchedAt,
    stale: true,
    note: "No NOAA CO-OPS station is in range for this break, so no tide value is available and the tide factor is dropped.",
  };
}

/**
 * Fetches every live source for a break and joins them into one hourly slice for
 * `localDate`. When all upstreams fail, the sealed sample is used and the
 * snapshot is honestly marked `fallback`.
 */
export async function getConditions(
  surfBreak: SurfBreak,
  localDate?: string,
): Promise<ConditionsBundle> {
  const date = localDate ?? localDateAt(surfBreak);
  const hours = Array.from({ length: 24 }, (_, index) => zonedToUtc(date, index, 0, surfBreak.timezone));

  const [marine, weather, tide] = await Promise.all([
    fetchMarine(surfBreak.lat, surfBreak.lon),
    fetchWeather(surfBreak.lat, surfBreak.lon),
    surfBreak.tideStationId && surfBreak.tideStationName
      ? fetchTidePrediction(surfBreak.tideStationId, surfBreak.tideStationName, hours[0].toISOString(), 5)
      : Promise.resolve<null>(null),
  ]);

  const marineLive = marine.hours.length > 0;
  const weatherLive = weather.hours.length > 0;

  if (!marineLive && !weatherLive) {
    const sample = fallbackHours();
    // The sealed sample must never invent a tide for a break that has no tide
    // station: the whole point of this app is not guessing where there is no data.
    const stationInRange = Boolean(surfBreak.tideStationId && surfBreak.tideStationName);
    const tideSeries: TideSeries = stationInRange
      ? {
          stationId: surfBreak.tideStationId,
          stationName: surfBreak.tideStationName,
          datum: "MLLW",
          points: fallbackTidePoints(),
          highs: [],
          lows: [],
          rangeM: 0,
          meanM: 0,
          status: "fallback",
          note: "Synthetic curve from the sealed sample; not a NOAA prediction.",
        }
      : {
          stationId: null,
          stationName: null,
          datum: "MLLW",
          points: [],
          highs: [],
          lows: [],
          rangeM: 0,
          meanM: 0,
          status: "fallback",
          note: "No tide station in range, and the sealed sample does not invent one.",
        };
    const sliceWithTide = sample.map((row, index) => {
      const key = hours[index].toISOString();
      const sampled = tideSeries.points.length ? tideAt(tideSeries.points, key) : null;
      const nextKey = hours[Math.min(index + 1, 23)].toISOString();
      const prevKey = hours[Math.max(index - 1, 0)].toISOString();
      const nextSampled = tideSeries.points.length ? tideAt(tideSeries.points, nextKey) : null;
      const prevSampled = tideSeries.points.length ? tideAt(tideSeries.points, prevKey) : null;
      const rate =
        sampled && nextSampled && prevSampled ? Number(((nextSampled.m - prevSampled.m) / 2).toFixed(2)) : null;
      return {
        ...row,
        at: key,
        tideM: sampled ? Number(sampled.m.toFixed(2)) : null,
        tideRateMPerH: rate,
      };
    });
    const snapshotSources: SourceMeta[] = [fallbackSource(), marine.source, weather.source];
    // Whatever happened upstream, a break with no tide station must say so, and a
    // station that answered must keep its own attribution.
    if (tide) snapshotSources.push(tide.source);
    else snapshotSources.push(noStationSource(new Date().toISOString()));
    return {
      snapshot: {
        breakId: surfBreak.id,
        timezone: surfBreak.timezone,
        date,
        hours: sliceWithTide,
        sources: snapshotSources,
        status: "fallback",
        generatedAt: new Date().toISOString(),
      },
      tide: tideSeries,
      currentIndex: indexOfNow(hours),
    };
  }

  const marineIndex = indexByHour<MarineHour>(marine.hours);
  const weatherIndex = indexByHour<WeatherHour>(weather.hours);

  const raw: Array<{ at: string; m: number | null }> = hours.map((instant) => {
    const sampled = tide?.series.points.length ? tideAt(tide.series.points, instant.toISOString()) : null;
    return { at: instant.toISOString(), m: sampled ? Number(sampled.m.toFixed(2)) : null };
  });

  const slice: HourlyConditions[] = hours.map((instant, index) => {
    const key = instant.toISOString();
    const m = marineIndex.get(key);
    const w = weatherIndex.get(key);
    return {
      at: key,
      swellHeightM: m?.swellHeightM ?? null,
      swellPeriodS: m?.swellPeriodS ?? null,
      swellDirDeg: m?.swellDirDeg ?? null,
      waveHeightM: m?.waveHeightM ?? null,
      waveDirDeg: m?.waveDirDeg ?? null,
      windSpeedMs: w?.windSpeedMs ?? null,
      windDirDeg: w?.windDirDeg ?? null,
      airTempC: w?.airTempC ?? null,
      cloudCoverPct: w?.cloudCoverPct ?? null,
      precipMm: w?.precipMm ?? null,
      tideM: raw[index].m,
      tideRateMPerH: rateFrom(raw, key),
    };
  });

  const sources: SourceMeta[] = [marine.source, weather.source];
  if (tide) sources.push(tide.source);
  else sources.push(noStationSource(new Date().toISOString()));

  return {
    snapshot: {
      breakId: surfBreak.id,
      timezone: surfBreak.timezone,
      date,
      hours: slice,
      sources,
      status: gradeStatus(sources),
      generatedAt: new Date().toISOString(),
    },
    tide: tide?.series ?? {
      stationId: surfBreak.tideStationId,
      stationName: surfBreak.tideStationName,
      datum: "MLLW",
      points: [],
      highs: [],
      lows: [],
      rangeM: 0,
      meanM: 0,
      status: "fallback",
      note: "No tide station in range.",
    },
    currentIndex: indexOfNow(hours),
  };
}

export function indexOfNow(hours: Array<Date | { at: string }>): number | null {
  if (hours.length === 0) return null;
  const times = hours.map((entry) => (entry instanceof Date ? entry.getTime() : Date.parse(entry.at)));
  if (times.some((value) => !Number.isFinite(value))) return null;
  const now = Date.now();
  const index = times.findIndex((value) => value <= now && value + 3_600_000 > now);
  if (index >= 0) return index;
  if (now < times[0]) return 0;
  if (now >= times[times.length - 1]) return times.length - 1;
  return null;
}

/** Formats an ISO instant in a break's local time, e.g. "14:00". */
export function formatLocalHour(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Formats an ISO instant as a local weekday + time, e.g. "Sat 14:00". */
export function formatLocalStamp(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
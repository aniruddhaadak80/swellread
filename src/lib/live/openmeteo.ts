import { fetchJson } from "@/lib/live/http";
import { num } from "@/lib/swell/math";
import type { SourceMeta } from "@/lib/types";

/**
 * Open-Meteo Marine (swell) and Open-Meteo Forecast (wind, air, cloud).
 * Both are public, keyless and require no registration.
 *
 * Both APIs return their hourly arrays NESTED under a `hourly` object rather than
 * at the top level, so the normalisers below are the only place that shape is
 * read. They are exported and unit-tested against captured real payloads, because
 * reading the wrong nesting level fails silently: the request succeeds, the arrays
 * are missing, and the app quietly serves its offline sample instead of live water.
 */

export const MARINE_ATTRIBUTION = {
  id: "open-meteo-marine" as const,
  name: "Open-Meteo Marine API",
  url: "https://open-meteo.com/en/docs/marine-api",
  license: "CC BY 4.0, non-commercial attribution required",
};

export const FORECAST_ATTRIBUTION = {
  id: "open-meteo-forecast" as const,
  name: "Open-Meteo Forecast API",
  url: "https://open-meteo.com/en/docs",
  license: "CC BY 4.0, non-commercial attribution required",
};

export interface MarineHour {
  at: string;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  swellDirDeg: number | null;
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveDirDeg: number | null;
}

export interface WeatherHour {
  at: string;
  windSpeedMs: number | null;
  windDirDeg: number | null;
  airTempC: number | null;
  cloudCoverPct: number | null;
  precipMm: number | null;
}

interface HourlyBlock {
  time?: unknown;
  [key: string]: unknown;
}

export interface OpenMeteoPayload {
  hourly?: HourlyBlock;
  error?: boolean;
  reason?: string;
}

const NAIVE_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Open-Meteo returns naive local timestamps plus a UTC offset in seconds.
 *
 * The shape is checked before parsing because `Date.parse` is lenient enough to
 * turn a malformed upstream timestamp into a plausible-looking year-2000 date.
 */
export function toUtcIso(naiveLocal: string, utcOffsetSeconds: number): string | null {
  if (typeof naiveLocal !== "string" || !NAIVE_HOUR.test(naiveLocal)) return null;
  const ms = Date.parse(`${naiveLocal}:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - utcOffsetSeconds * 1000).toISOString();
}

function readArray(block: HourlyBlock | undefined, key: string): unknown[] {
  const value = block?.[key];
  return Array.isArray(value) ? value : [];
}

/** True when the payload carries a usable nested hourly block. */
export function hasHourly(payload: unknown): boolean {
  const block = (payload as OpenMeteoPayload | null)?.hourly;
  return Array.isArray(block?.time) && block?.time.length > 0;
}

function utcOffsetOf(payload: OpenMeteoPayload): number {
  const raw = (payload as { utc_offset_seconds?: unknown }).utc_offset_seconds;
  return num(raw) ?? 0;
}

export function normaliseMarine(payload: unknown): MarineHour[] {
  if (!hasHourly(payload)) return [];
  const data = payload as OpenMeteoPayload;
  const block = data.hourly as HourlyBlock;
  const offset = utcOffsetOf(data);
  const swellHeight = readArray(block, "swell_wave_height");
  const swellPeriod = readArray(block, "swell_wave_period");
  const swellDirection = readArray(block, "swell_wave_direction");
  const waveHeight = readArray(block, "wave_height");
  const wavePeriod = readArray(block, "wave_period");
  const waveDirection = readArray(block, "wave_direction");

  const hours: MarineHour[] = [];
  readArray(block, "time").forEach((naive, index) => {
    if (typeof naive !== "string") return;
    const at = toUtcIso(naive, offset);
    if (!at) return;
    hours.push({
      at,
      swellHeightM: num(swellHeight[index]),
      swellPeriodS: num(swellPeriod[index]),
      swellDirDeg: num(swellDirection[index]),
      waveHeightM: num(waveHeight[index]),
      wavePeriodS: num(wavePeriod[index]),
      waveDirDeg: num(waveDirection[index]),
    });
  });
  return hours;
}

export function normaliseWeather(payload: unknown): WeatherHour[] {
  if (!hasHourly(payload)) return [];
  const data = payload as OpenMeteoPayload;
  const block = data.hourly as HourlyBlock;
  const offset = utcOffsetOf(data);
  const windSpeed = readArray(block, "wind_speed_10m");
  const windDirection = readArray(block, "wind_direction_10m");
  // `temperature_2m` is the current name. `air_temperature_2m` is rejected with
  // HTTP 400 by the forecast endpoint, which would take the whole wind read with it.
  const temperature = readArray(block, "temperature_2m");
  const cloud = readArray(block, "cloud_cover");
  const precipitation = readArray(block, "precipitation");

  const hours: WeatherHour[] = [];
  readArray(block, "time").forEach((naive, index) => {
    if (typeof naive !== "string") return;
    const at = toUtcIso(naive, offset);
    if (!at) return;
    hours.push({
      at,
      windSpeedMs: num(windSpeed[index]),
      windDirDeg: num(windDirection[index]),
      airTempC: num(temperature[index]),
      cloudCoverPct: num(cloud[index]),
      precipMm: num(precipitation[index]),
    });
  });
  return hours;
}

function liveSource(
  attribution: { id: SourceMeta["id"]; name: string; url: string; license: string },
  fetchedAt: string,
  note: string,
): SourceMeta {
  return { ...attribution, status: "live", fetchedAt, stale: false, note };
}

function failedSource(
  attribution: { id: SourceMeta["id"]; name: string; url: string; license: string },
  reason: string,
): SourceMeta {
  return {
    ...attribution,
    status: "fallback",
    fetchedAt: new Date().toISOString(),
    stale: true,
    note: `${attribution.name} unreachable (${reason}).`,
  };
}

function describePayload(payload: unknown): string {
  const data = payload as OpenMeteoPayload | null;
  if (data?.error === true) return typeof data.reason === "string" ? data.reason : "upstream reported an error";
  return "malformed payload: no hourly.time array";
}

export interface MarineResult {
  hours: MarineHour[];
  source: SourceMeta;
}

export async function fetchMarine(lat: number, lon: number, days = 7): Promise<MarineResult> {
  const url =
    "https://marine-api.open-meteo.com/v1/marine" +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    "&hourly=swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,wave_period,wave_direction" +
    `&forecast_days=${days}&timezone=auto`;
  const result = await fetchJson<OpenMeteoPayload>(url);
  if (!result.ok) {
    return { hours: [], source: failedSource(MARINE_ATTRIBUTION, result.reason) };
  }
  const hours = normaliseMarine(result.data);
  if (hours.length === 0) {
    return { hours: [], source: failedSource(MARINE_ATTRIBUTION, describePayload(result.data)) };
  }
  return {
    hours,
    source: liveSource(MARINE_ATTRIBUTION, result.fetchedAt, `${hours.length} hourly rows, swell and wind wave.`),
  };
}

export interface WeatherResult {
  hours: WeatherHour[];
  source: SourceMeta;
}

export async function fetchWeather(lat: number, lon: number, days = 7): Promise<WeatherResult> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    "&hourly=wind_speed_10m,wind_direction_10m,temperature_2m,cloud_cover,precipitation" +
    `&forecast_days=${days}&wind_speed_unit=ms&timezone=auto`;
  const result = await fetchJson<OpenMeteoPayload>(url);
  if (!result.ok) {
    return { hours: [], source: failedSource(FORECAST_ATTRIBUTION, result.reason) };
  }
  const hours = normaliseWeather(result.data);
  if (hours.length === 0) {
    return { hours: [], source: failedSource(FORECAST_ATTRIBUTION, describePayload(result.data)) };
  }
  return {
    hours,
    source: liveSource(FORECAST_ATTRIBUTION, result.fetchedAt, `${hours.length} hourly rows, wind and air.`),
  };
}
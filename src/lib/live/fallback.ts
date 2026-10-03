import type { HourlyConditions, SourceMeta } from "@/lib/types";

/**
 * Sealed offline sample.
 *
 * Used only when every upstream fails, so a first paint and a production build
 * never break. It is a fixed, dated synthetic profile and is always reported
 * with `status: "fallback"` and `stale: true`. It never overwrites user data,
 * and it is never presented as current conditions.
 */

export const FALLBACK_LABEL = "Sealed offline sample (synthetic, dated 2026-10-03)";

const BASE_ISO = "2026-10-03T00:00:00.000Z";

const SWELL_HEIGHT = [1.12, 1.08, 1.02, 0.96, 0.9, 0.86, 0.83, 0.81, 0.8, 0.82, 0.86, 0.91, 0.97, 1.03, 1.09, 1.14, 1.18, 1.2, 1.19, 1.16, 1.11, 1.05, 1.0, 0.96];
const SWELL_PERIOD = [15.2, 15.1, 15, 14.8, 14.6, 14.4, 14.2, 14, 13.8, 13.6, 13.4, 13.2, 13, 12.9, 12.8, 12.7, 12.6, 12.5, 12.4, 12.3, 12.2, 12.1, 12, 11.9];
const SWELL_DIR = [158, 158, 158, 158, 157, 157, 157, 156, 156, 155, 155, 154, 154, 153, 153, 152, 152, 151, 151, 150, 150, 149, 149, 148];
const WAVE_HEIGHT = [1.55, 1.49, 1.41, 1.33, 1.25, 1.18, 1.12, 1.07, 1.03, 1.02, 1.04, 1.09, 1.16, 1.25, 1.35, 1.45, 1.55, 1.63, 1.68, 1.69, 1.66, 1.6, 1.53, 1.46];
const WIND = [4.6, 4.3, 4.1, 3.9, 3.7, 3.5, 3.4, 3.3, 3.4, 3.7, 4.2, 4.8, 5.4, 5.9, 6.2, 6.3, 6.2, 5.9, 5.5, 5.1, 4.8, 4.6, 4.5, 4.5];
const WIND_DIR = [104, 105, 106, 107, 108, 109, 110, 110, 109, 108, 107, 106, 105, 105, 104, 104, 105, 106, 107, 107, 106, 105, 104, 104];
const TEMP = [24.4, 24.2, 24, 23.8, 23.7, 23.6, 23.6, 23.7, 23.9, 24.1, 24.4, 24.6, 24.8, 25, 25.1, 25.1, 25, 24.8, 24.6, 24.5, 24.5, 24.5, 24.5, 24.4];
const CLOUD = [42, 44, 46, 48, 50, 52, 50, 46, 42, 40, 38, 36, 34, 33, 32, 32, 34, 38, 44, 50, 54, 56, 52, 46];
const RAIN = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.1, 0, 0, 0];

/** Semidiurnal M2 curve for the sample, in metres above MLLW. */
function sampleTideHeight(hourIndex: number): number {
  const hours = hourIndex;
  const principal = 0.52 * Math.sin(((2 * Math.PI) / 12.42) * (hours - 1.4));
  const shape = 0.09 * Math.sin(((2 * Math.PI) / 6.21) * (hours + 0.8));
  return Number((0.46 + principal + shape).toFixed(2));
}

export function fallbackHours(): HourlyConditions[] {
  return SWELL_HEIGHT.map((swellHeightM, hourIndex) => {
    const at = new Date(Date.parse(BASE_ISO) + hourIndex * 3_600_000).toISOString();
    const prev = sampleTideHeight(((hourIndex - 1 + 24) % 24));
    const curr = sampleTideHeight(hourIndex);
    const next = sampleTideHeight((hourIndex + 1) % 24);
    return {
      at,
      swellHeightM,
      swellPeriodS: SWELL_PERIOD[hourIndex],
      swellDirDeg: SWELL_DIR[hourIndex],
      waveHeightM: WAVE_HEIGHT[hourIndex],
      wavePeriodS: SWELL_PERIOD[hourIndex] + 1.4,
      waveDirDeg: SWELL_DIR[hourIndex] - 4,
      windSpeedMs: WIND[hourIndex],
      windDirDeg: WIND_DIR[hourIndex],
      airTempC: TEMP[hourIndex],
      cloudCoverPct: CLOUD[hourIndex],
      precipMm: RAIN[hourIndex],
      tideM: curr,
      tideRateMPerH: Number(((next - prev) / 2).toFixed(2)),
    };
  });
}

/** Tide points for the fallback curve, so tide-driven UI still renders. */
export function fallbackTidePoints(): Array<{ t: string; m: number }> {
  const points: Array<{ t: string; m: number }> = [];
  const start = Date.parse(BASE_ISO);
  for (let i = 0; i < 24 * 4; i += 1) {
    const t = new Date(start + i * 15 * 60_000).toISOString();
    const minutes = i * 15;
    const principal = 0.52 * Math.sin(((2 * Math.PI) / (12.42 * 60)) * (minutes - 84));
    const shape = 0.09 * Math.sin(((2 * Math.PI) / (6.21 * 60)) * (minutes + 48));
    points.push({ t, m: Number((0.46 + principal + shape).toFixed(3)) });
  }
  return points;
}

export function fallbackSource(): SourceMeta {
  return {
    id: "bundled-sample",
    name: FALLBACK_LABEL,
    url: "https://github.com/aniruddhaadak80/swellread",
    license: "MIT",
    status: "fallback",
    fetchedAt: BASE_ISO,
    stale: true,
    note: "Every upstream was unreachable, so this dated synthetic profile is being shown. It is not today's water.",
  };
}
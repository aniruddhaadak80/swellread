import { describe, expect, it } from "vitest";
import {
  depthOverTakeoff,
  detectExtrema,
  formatTide,
  progressThrough,
  sampleTide,
  summarizeTide,
  tideAt,
  trendFrom,
} from "@/lib/swell/tides";
import { zoneOffsetMs, zonedToUtc, localDateAt } from "@/lib/live/conditions";
import { fallbackHours, fallbackTidePoints } from "@/lib/live/fallback";
import { angleDelta, clamp, num, round, smoothstep } from "@/lib/swell/math";

const points = [
  { t: "2026-10-03T00:00:00.000Z", m: 1.0 },
  { t: "2026-10-03T06:00:00.000Z", m: 2.0 },
  { t: "2026-10-03T12:00:00.000Z", m: 1.0 },
];

describe("sampleTide", () => {
  it("interpolates linearly between points", () => {
    expect(sampleTide(points, "2026-10-03T03:00:00.000Z")).toBeCloseTo(1.5, 6);
    expect(sampleTide(points, "2026-10-03T09:00:00.000Z")).toBeCloseTo(1.5, 6);
  });

  it("returns the exact value at a node", () => {
    expect(sampleTide(points, "2026-10-03T06:00:00.000Z")).toBeCloseTo(2.0, 6);
  });

  it("refuses to extrapolate outside the series", () => {
    expect(sampleTide(points, "2026-10-02T23:00:00.000Z")).toBeNull();
    expect(sampleTide(points, "2026-10-03T13:00:00.000Z")).toBeNull();
  });

  it("handles empty and single-point series", () => {
    expect(sampleTide([], "2026-10-03T00:00:00.000Z")).toBeNull();
    expect(sampleTide([{ t: "2026-10-03T00:00:00.000Z", m: 0.5 }], "2026-10-03T00:00:00.000Z")).toBe(0.5);
  });

  it("returns null for an unparseable instant", () => {
    expect(sampleTide(points, "not-a-date")).toBeNull();
  });
});

describe("tideAt", () => {
  it("reports a positive rate on the flood and negative on the ebb", () => {
    const rising = tideAt(points, "2026-10-03T03:00:00.000Z");
    const falling = tideAt(points, "2026-10-03T09:00:00.000Z");
    expect(rising?.m).toBeCloseTo(1.5, 6);
    expect(rising!.rate).toBeGreaterThan(0);
    expect(falling!.rate).toBeLessThan(0);
  });

  it("classifies the trend", () => {
    expect(trendFrom(0.5)).toBe("rising");
    expect(trendFrom(-0.5)).toBe("falling");
    expect(trendFrom(0.01)).toBe("slack");
    expect(trendFrom(null)).toBeNull();
  });
});

describe("detectExtrema", () => {
  it("finds highs and lows on a monotonic-in-time curve", () => {
    const { highs, lows } = detectExtrema(points);
    expect(highs).toHaveLength(1);
    expect(lows).toHaveLength(0);
    expect(highs[0].m).toBe(2);
  });

  it("finds both on a symmetric curve", () => {
    const curve = [
      { t: "2026-10-03T00:00:00.000Z", m: 1 },
      { t: "2026-10-03T02:00:00.000Z", m: 2 },
      { t: "2026-10-03T04:00:00.000Z", m: 1 },
      { t: "2026-10-03T06:00:00.000Z", m: 2 },
      { t: "2026-10-03T08:00:00.000Z", m: 1 },
    ];
    const { highs, lows } = detectExtrema(curve);
    expect(highs).toHaveLength(2);
    expect(lows).toHaveLength(1);
    expect(lows[0].kind).toBe("low");
  });

  it("needs at least three points", () => {
    expect(detectExtrema(points.slice(0, 2))).toEqual({ highs: [], lows: [] });
  });
});

describe("summarizeTide", () => {
  it("computes range and mean", () => {
    const series = summarizeTide({
      stationId: "1",
      stationName: "x",
      datum: "MLLW",
      points,
      status: "live",
    });
    expect(series.rangeM).toBe(1);
    expect(series.meanM).toBeCloseTo(1.33, 2);
    expect(series.status).toBe("live");
  });

  it("survives an empty series", () => {
    const series = summarizeTide({ stationId: null, stationName: null, datum: "MLLW", points: [], status: "fallback" });
    expect(series.rangeM).toBe(0);
    expect(series.meanM).toBe(0);
  });
});

describe("helpers", () => {
  it("formats a tide height and labels missing data honestly", () => {
    expect(formatTide(1.234)).toBe("1.23 m");
    expect(formatTide(-0.5)).toBe("-0.50 m");
    expect(formatTide(null)).toBe("no data");
  });

  it("computes progress through a series, clamped", () => {
    expect(progressThrough(points, "2026-10-03T00:00:00.000Z")).toBe(0);
    expect(progressThrough(points, "2026-10-03T12:00:00.000Z")).toBe(1);
    expect(progressThrough(points, "2026-10-04T00:00:00.000Z")).toBe(1);
  });

  it("sums tide height onto take-off depth", () => {
    expect(depthOverTakeoff(1.1, 0.9)).toBe(2);
    expect(depthOverTakeoff(1.1, null)).toBeNull();
  });
});

describe("numeric helpers", () => {
  it("wraps angles into 0..180", () => {
    expect(angleDelta(10, 350)).toBe(20);
    expect(angleDelta(0, 180)).toBe(180);
    expect(angleDelta(0, 90)).toBe(90);
  });

  it("clamps, rounds and parses defensively", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
    expect(round(-0.001, 2)).toBe(0);
    expect(num("2.5")).toBe(2.5);
    expect(num("")).toBeNull();
    expect(num("abc")).toBeNull();
    expect(num(null)).toBeNull();
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(1, 1, 0.2)).toBe(0);
  });
});

describe("time zones", () => {
  it("converts wall-clock time to the right UTC instant across zones", () => {
    expect(zonedToUtc("2026-10-03", 0, 0, "UTC").toISOString()).toBe("2026-10-03T00:00:00.000Z");
    // Pago Pago is UTC-11 year round.
    expect(zonedToUtc("2026-10-03", 12, 0, "Pacific/Pago_Pago").toISOString()).toBe("2026-10-03T23:00:00.000Z");
    // Guam is UTC+10.
    expect(zonedToUtc("2026-10-03", 9, 0, "Pacific/Guam").toISOString()).toBe("2026-10-02T23:00:00.000Z");
    // India is UTC+5:30, a half-hour offset the converter must not round away.
    expect(zonedToUtc("2026-10-03", 9, 0, "Asia/Kolkata").toISOString()).toBe("2026-10-03T03:30:00.000Z");
  });

  it("reports a sensible offset per zone", () => {
    const instant = new Date("2026-10-03T00:00:00.000Z");
    expect(zoneOffsetMs(instant, "UTC")).toBe(0);
    expect(zoneOffsetMs(instant, "Asia/Kolkata")).toBe(5.5 * 3_600_000);
    expect(zoneOffsetMs(instant, "America/Los_Angeles")).toBe(-7 * 3_600_000);
  });

  it("reads the local calendar date at a break", () => {
    const instant = new Date("2026-10-03T23:30:00.000Z");
    expect(localDateAt("Pacific/Pago_Pago", instant)).toBe("2026-10-03");
    expect(localDateAt("Asia/Kolkata", instant)).toBe("2026-10-04");
  });
});

describe("sealed offline sample", () => {
  it("produces 24 labelled hours with a tide value on every one", () => {
    const hours = fallbackHours();
    expect(hours).toHaveLength(24);
    for (const hour of hours) {
      expect(hour.swellHeightM).not.toBeNull();
      expect(hour.tideM).not.toBeNull();
      expect(Number.isFinite(hour.at.startsWith("2026-10-03") ? 1 : 0)).toBe(true);
    }
  });

  it("is deterministic and interpolated to any hour", () => {
    const hours = fallbackHours();
    const midday = sampleTide(fallbackTidePoints(), hours[12].at);
    expect(midday).not.toBeNull();
    expect(Math.abs((midday as number) - (hours[12].tideM as number))).toBeLessThan(0.2);
  });

  it("varies through the day rather than repeating one value", () => {
    const heights = fallbackHours().map((hour) => hour.swellHeightM as number);
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  });
});
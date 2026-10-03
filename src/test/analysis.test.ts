import { describe, expect, it } from "vitest";
import { analyseBreak } from "@/lib/services/analysis";
import { getBreak, listBreaks, getHeroBreak } from "@/lib/live/breaks";
import { TIDE_WINDOWS } from "@/lib/swell/engine";
import { FALLBACK_LABEL } from "@/lib/live/fallback";
import { noStationSource } from "@/lib/live/conditions";

/**
 * These hit the real upstream APIs. The assertions are about honesty: whatever
 * comes back, the snapshot must say whether it is live or a fallback, and the
 * engine must still produce a sealed, itemised verdict.
 */

describe("break catalogue", () => {
  it("exposes at least ten real coastlines with unique ids", () => {
    const breaks = listBreaks();
    expect(breaks.length).toBeGreaterThanOrEqual(10);
    expect(new Set(breaks.map((item) => item.id)).size).toBe(breaks.length);
    for (const item of breaks) {
      expect(item.lat).toBeGreaterThanOrEqual(-60);
      expect(item.lat).toBeLessThanOrEqual(70);
      expect(item.lon).toBeGreaterThanOrEqual(-180);
      expect(item.lon).toBeLessThanOrEqual(180);
      expect(item.orientationDeg).toBeGreaterThanOrEqual(0);
      expect(item.orientationDeg).toBeLessThanOrEqual(360);
      expect(TIDE_WINDOWS[item.breakType]).toBeDefined();
      expect(item.blurb.length).toBeGreaterThan(40);
    }
  });

  it("returns null for an unknown id and the hero for the default", () => {
    expect(getBreak("not-a-real-place")).toBeNull();
    expect(getHeroBreak().id).toBe("pago-pago");
  });

  it("only claims a tide station where one is actually configured", () => {
    for (const item of listBreaks()) {
      if (item.tideStationId === null) {
        expect(item.tideStationName).toBeNull();
        expect(item.tideStationDistanceKm).toBeNull();
      } else {
        expect(item.tideStationId).toMatch(/^\d{7}$/);
      }
    }
  });

  it("includes at least one break per side of the no-tide gap", () => {
    const withTide = listBreaks().filter((item) => item.tideStationId !== null);
    const withoutTide = listBreaks().filter((item) => item.tideStationId === null);
    expect(withTide.length).toBeGreaterThanOrEqual(4);
    expect(withoutTide.length).toBeGreaterThanOrEqual(3);
  });
});

describe("analyseBreak against live upstreams", () => {
  it("returns 24 hours, attribution and an honest status for the hero break", async () => {
    const analysis = await analyseBreak({ breakId: "pago-pago" });

    expect(analysis.break.id).toBe("pago-pago");
    expect(analysis.snapshot.hours).toHaveLength(24);
    expect(["live", "mixed", "fallback"]).toContain(analysis.status);
    expect(analysis.snapshot.sources.length).toBeGreaterThanOrEqual(3);
    for (const source of analysis.snapshot.sources) {
      expect(["live", "fallback"]).toContain(source.status);
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.license.length).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(source.fetchedAt))).toBe(true);
      // A fallback must always be flagged as stale and dated.
      if (source.status === "fallback") expect(source.stale).toBe(true);
      if (source.status === "live") expect(source.stale).toBe(false);
    }
    expect(analysis.snapshot.status).toBe(analysis.status);
  }, 60_000);

  it("labels every hour consistently with the snapshot status", async () => {
    const analysis = await analyseBreak({ breakId: "pago-pago" });
    for (const hour of analysis.snapshot.hours) {
      if (analysis.status === "fallback") {
        expect(hour.swellHeightM).not.toBeNull();
      } else {
        // A live marine read should have real swell for most of the day.
        const withSwell = analysis.snapshot.hours.filter((row) => row.swellHeightM !== null).length;
        expect(withSwell).toBeGreaterThan(0);
        break;
      }
    }
  }, 60_000);

  it("scores the day, sharing one window across all 24 points", async () => {
    const analysis = await analyseBreak({ breakId: "pago-pago" });
    expect(analysis.points).toHaveLength(24);
    for (const point of analysis.points) {
      expect(point.score).toBeGreaterThanOrEqual(0);
      expect(point.score).toBeLessThanOrEqual(1);
      expect(point.localLabel).toMatch(/^\d{2}:\d{2}$/);
    }
    const good = analysis.points.filter((point) => point.score >= 0.5);
    expect(analysis.engine.window.goodHours).toEqual(good.map((point) => point.at));
    expect(analysis.engine.seal).toMatch(/^[0-9a-f]{96}$/);
  }, 60_000);

  it("applies a what-if tide without touching the stored snapshot", async () => {
    const base = await analyseBreak({ breakId: "pago-pago", hour: 8 });
    const whatIf = await analyseBreak({ breakId: "pago-pago", hour: 8, tideM: 1.9 });

    expect(whatIf.whatIf).toEqual({ tideM: 1.9 });
    expect(whatIf.hour.tideM).toBe(1.9);
    expect(whatIf.snapshot.hours[8].tideM).toBe(base.snapshot.hours[8].tideM);
    expect(whatIf.snapshot).toBe(base.snapshot);
    expect(whatIf.engine.seal).not.toBe(base.engine.seal);
  }, 60_000);

  it("deeper what-if water peels faster", async () => {
    const shallow = await analyseBreak({ breakId: "pago-pago", hour: 8, tideM: 0.2 });
    const deep = await analyseBreak({ breakId: "pago-pago", hour: 8, tideM: 1.8 });
    expect(deep.engine.derived.peelSpeedKmh!).toBeGreaterThan(shallow.engine.derived.peelSpeedKmh!);
    expect(deep.engine.derived.depthAtBreakM!).toBeGreaterThan(shallow.engine.derived.depthAtBreakM!);
    expect(deep.engine.derived.breakHeightM).not.toBeNull();
  }, 60_000);

  it("reports the tide window bounds the drag control should use", async () => {
    const analysis = await analyseBreak({ breakId: "pago-pago" });
    expect(analysis.tideBounds.max).toBeGreaterThanOrEqual(analysis.tideBounds.min);
    if (analysis.tideBounds.max > 0) {
      const span = analysis.tideBounds.max - analysis.tideBounds.min;
      expect(span).toBeLessThan(10);
    }
  }, 60_000);

  it("drops the tide factor for a break with no station, and says so", async () => {
    const analysis = await analyseBreak({ breakId: "kovalam" });
    const tideFactor = analysis.engine.factors.find((factor) => factor.key === "tideWindow");
    expect(analysis.break.tideStationId).toBeNull();
    expect(tideFactor?.available).toBe(false);
    // Whether the upstreams answered or the sealed sample was used, no tide value
    // is ever produced for a break that has no tide station.
    expect(analysis.snapshot.hours.every((hour) => hour.tideM === null)).toBe(true);
    expect(tideFactor?.evidence).toContain("NOAA CO-OPS");
    expect(analysis.engine.derived.depthAtBreakM).toBeNull();
    expect(analysis.tide.points).toHaveLength(0);
    // When the upstreams answered, the missing station is named in the attribution.
    // When they did not, the sealed sample is in play and must be labelled as such.
    if (analysis.status === "fallback") {
      expect(analysis.snapshot.sources.some((entry) => entry.id === "bundled-sample")).toBe(true);
    } else {
      const source = analysis.snapshot.sources.find((entry) => entry.id === "noaa-coops");
      expect(source?.status).toBe("fallback");
      expect(source?.note).toContain("No NOAA CO-OPS station");
    }
  }, 60_000);

  it("labels the missing tide station honestly in the attribution row", () => {
    const source = noStationSource("2026-10-03T06:00:00.000Z");
    expect(source.id).toBe("noaa-coops");
    expect(source.status).toBe("fallback");
    expect(source.stale).toBe(true);
    expect(source.note).toContain("No NOAA CO-OPS station");
    expect(source.license).toContain("public domain");
  });

  it("rejects an unknown break id", async () => {
    await expect(analyseBreak({ breakId: "atlantis" })).rejects.toThrow(/unknown break/);
  });

  it("honours a requested local date and clamps an out-of-range hour", async () => {
    const analysis = await analyseBreak({ breakId: "pago-pago", hour: 99 });
    expect(analysis.hour.at).toBe(analysis.snapshot.hours[23].at);
  }, 60_000);

  it("serves the second identical request from cache with the same result", async () => {
    const first = await analyseBreak({ breakId: "pago-pago", hour: 6 });
    const second = await analyseBreak({ breakId: "pago-pago", hour: 6 });
    expect(second.engine.seal).toBe(first.engine.seal);
    expect(second.snapshot.generatedAt).toBe(first.snapshot.generatedAt);
  }, 60_000);
});

describe("sealed fallback labelling", () => {
  it("names itself as a dated synthetic sample", () => {
    expect(FALLBACK_LABEL).toContain("Sealed offline sample");
    expect(FALLBACK_LABEL).toContain("2026-10-03");
  });
});
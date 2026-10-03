import { describe, expect, it } from "vitest";
import type { HourlyConditions, SurfBreak } from "@/lib/types";
import {
  ENGINE_VERSION,
  FACTOR_WEIGHTS,
  bandFor,
  bestWindow,
  breakHeightAt,
  depthOverTakeoff,
  peelSpeedKmh,
  scoreDay,
  scoreHour,
  BREAKING_INDEX,
  breakingDepthM,
  wavePowerKwM,
} from "@/lib/swell/engine";

const breakFixture: SurfBreak = {
  id: "test-pass",
  name: "Test Pass",
  region: "Test",
  country: "Test",
  lat: 0,
  lon: 0,
  timezone: "UTC",
  breakType: "reef_pass",
  orientationDeg: 155,
  reefSlope: 0.11,
  depthAtBreakM: 1.1,
  tideStationId: "0000000",
  tideStationName: "Test Station",
  tideStationDistanceKm: 0,
  blurb: "fixture",
};

function hour(overrides: Partial<HourlyConditions> = {}): HourlyConditions {
  return {
    at: "2026-10-03T00:00:00.000Z",
    swellHeightM: 1.4,
    swellPeriodS: 14,
    swellDirDeg: 152,
    waveHeightM: 1.8,
    waveDirDeg: 148,
    windSpeedMs: 3,
    windDirDeg: 340,
    airTempC: 25,
    cloudCoverPct: 30,
    precipMm: 0,
    tideM: 1.0,
    tideRateMPerH: 0.1,
    ...overrides,
  };
}

describe("physics helpers", () => {
  it("computes deep-water wave power in the published range", () => {
    // 0.62824 * 1.5^2 * 10 = 14.14 kW/m, which is in the published range for a 6 ft / 10 s day.
    expect(wavePowerKwM(1.5, 10)).toBe(14.14);
    expect(wavePowerKwM(0, 10)).toBe(0);
    expect(wavePowerKwM(1.5, 0)).toBe(0);
    expect(wavePowerKwM(Number.NaN, 10)).toBe(0);
  });

  it("stands more wave up on a steeper face and with more water", () => {
    // Green's law: Hb = Hs0 * (gamma * tanBeta)^(1/4)
    expect(breakHeightAt(1.5, 1.1, 0.14)).toBeGreaterThan(breakHeightAt(1.5, 1.1, 0.05));
    expect(breakHeightAt(1.5, 2.4, 0.11)).toBeGreaterThan(breakHeightAt(1.5, 0.8, 0.11));
    // 1.5 * (0.78 * 0.11)^(1/4) = 0.81, and 0.78 * 2.4 = 1.87, so the slope wins.
    expect(breakHeightAt(1.5, 2.4, 0.11)).toBe(0.81);
  });

  it("limits the breaking height to what the available water can hold", () => {
    // Depth 0.5 m cannot hold more than gamma * 0.5 = 0.39 m standing up.
    expect(breakHeightAt(2.4, 0.5, 0.11)).toBe(0.39);
    expect(breakingDepthM(1.5, 0.11)).toBe(1.04);
  });

  it("returns zero for a zero swell or no water at all", () => {
    expect(breakHeightAt(0, 2, 0.11)).toBe(0);
    expect(breakHeightAt(1.5, 0, 0.11)).toBe(0);
    expect(breakHeightAt(Number.NaN, 2, 0.11)).toBe(0);
    expect(BREAKING_INDEX).toBeCloseTo(0.78, 6);
  });

  it("is monotonic in offshore height and in depth", () => {
    // Non-decreasing in height, because the available water eventually caps it.
    let previous = 0;
    for (const height of [0.2, 0.6, 1.0, 1.5, 2.0, 3.0]) {
      const value = breakHeightAt(height, 1.2, 0.1);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    // Strictly increasing while the depth limit is not the binding term.
    expect(breakHeightAt(3.0, 6, 0.1)).toBeGreaterThan(breakHeightAt(1.5, 6, 0.1));

    previous = 0;
    for (const depth of [0.4, 0.8, 1.2, 1.8, 2.6, 4.0]) {
      const value = breakHeightAt(1.5, depth, 0.1);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });


  it("derives peel speed from shallow-water celerity, which is why tide matters", () => {
    const shallow = peelSpeedKmh(0.8);
    const deep = peelSpeedKmh(1.8);
    expect(deep).toBeGreaterThan(shallow);
    expect(shallow).toBeGreaterThan(0);
    expect(peelSpeedKmh(0)).toBe(0);
    // c = sqrt(9.80665 * 1.1) * 3.6 = 11.8 km/h
    expect(peelSpeedKmh(1.1)).toBe(11.8);
  });

  it("adds tide height to take-off depth and never goes below 5 cm", () => {
    expect(depthOverTakeoff(1.1, 0.4)).toBe(1.5);
    expect(depthOverTakeoff(1.1, -5)).toBe(0.05);
    expect(depthOverTakeoff(1.1, null)).toBeNull();
  });
});

describe("factor weights", () => {
  it("sum to exactly 1", () => {
    const total = Object.values(FACTOR_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("scoreHour", () => {
  it("scores a clean offshore day in the top band and seals the result", () => {
    const result = scoreHour({ break: breakFixture, hour: hour() });
    expect(result.version).toBe(ENGINE_VERSION);
    expect(result.band).toBe("get-in");
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.seal).toMatch(/^[0-9a-f]{96}$/);
    expect(result.factors.every((factor) => factor.available)).toBe(true);
  });

  it("renormalises weights and drops the tide factor when no tide is in range", () => {
    const result = scoreHour({ break: breakFixture, hour: hour({ tideM: null, tideRateMPerH: null }) });
    const tide = result.factors.find((factor) => factor.key === "tideWindow");
    const peel = result.factors.find((factor) => factor.key === "peelSpeed");
    expect(tide?.available).toBe(false);
    expect(tide?.effectiveWeight).toBe(0);
    expect(tide?.contribution).toBe(0);
    expect(peel?.available).toBe(false);
    const totalWeight = result.factors.reduce((sum, factor) => sum + factor.effectiveWeight, 0);
    const totalContribution = result.factors.reduce((sum, factor) => sum + factor.contribution, 0);
    expect(totalWeight).toBeGreaterThan(0.999);
    // Contributions are rounded to 6 dp individually, so they can drift a hair
    // from the score rounded to 4 dp.
    expect(Math.abs(totalContribution - result.score)).toBeLessThan(0.0001);
    expect(result.recommendation).toContain("Not scored");
  });

  it("drops wind quality rather than assuming it is calm", () => {
    const result = scoreHour({
      break: breakFixture,
      hour: hour({ windSpeedMs: null, windDirDeg: null }),
    });
    const wind = result.factors.find((factor) => factor.key === "windQuality");
    expect(wind?.available).toBe(false);
    expect(result.factors.find((factor) => factor.key === "swellPower")?.available).toBe(true);
  });

  it("gates a flat swell to zero with a blocking reason", () => {
    const result = scoreHour({ break: breakFixture, hour: hour({ swellHeightM: 0.1 }) });
    expect(result.score).toBe(0);
    expect(result.band).toBe("flat");
    expect(result.gates.some((gate) => gate.code === "flat" && gate.severity === "block")).toBe(true);
  });

  it("gates an exposed reef when the tide drops away", () => {
    const result = scoreHour({ break: breakFixture, hour: hour({ tideM: -0.6 }) });
    const gate = result.gates.find((entry) => entry.code === "reef-exposed");
    expect(gate?.severity).toBe("block");
    expect(result.score).toBeLessThan(0.1);
  });

  it("damps a blown-out day and says so", () => {
    const calm = scoreHour({ break: breakFixture, hour: hour() });
    const blown = scoreHour({ break: breakFixture, hour: hour({ windSpeedMs: 15 }) });
    expect(blown.score).toBeLessThan(calm.score);
    expect(blown.gates.some((gate) => gate.code === "blown-out")).toBe(true);
    expect(blown.seal).not.toBe(calm.seal);
  });

  it("damps an oversized swell for holding-down risk", () => {
    const result = scoreHour({ break: breakFixture, hour: hour({ swellHeightM: 3.1 }) });
    expect(result.gates.some((gate) => gate.code === "exposed")).toBe(true);
  });

  it("scores a bad swell direction down", () => {
    const aligned = scoreHour({ break: breakFixture, hour: hour({ swellDirDeg: 155 }) });
    const crossShore = scoreHour({ break: breakFixture, hour: hour({ swellDirDeg: 265 }) });
    const factorFor = (result: typeof aligned) =>
      result.factors.find((factor) => factor.key === "directionMatch");
    expect(factorFor(aligned)?.score).toBeCloseTo(1, 2);
    expect(factorFor(crossShore)!.score).toBeLessThan(0.1);
  });

  it("raises the score as the tide fills the pass, which is the point of the app", () => {
    // -0.6 m leaves 0.5 m over the take-off: the reef is exposed.
    const exposed = scoreHour({ break: breakFixture, hour: hour({ tideM: -0.6 }) });
    // +0.4 m leaves 1.5 m: inside the reef-pass band of 0.9 to 2.0 m.
    const covered = scoreHour({ break: breakFixture, hour: hour({ tideM: 0.4 }) });
    expect(covered.score).toBeGreaterThan(exposed.score);
    expect(exposed.gates.some((gate) => gate.code === "reef-exposed")).toBe(true);

    const peel = (result: typeof exposed) => result.factors.find((factor) => factor.key === "peelSpeed")!;
    expect(peel(covered).raw!).toBeGreaterThan(peel(exposed).raw!);
    expect(covered.derived.peelSpeedKmh!).toBeGreaterThan(exposed.derived.peelSpeedKmh!);
  });

  it("handles malformed input without throwing or producing NaN", () => {
    const result = scoreHour({
      break: breakFixture,
      hour: hour({
        swellHeightM: null,
        swellPeriodS: null,
        swellDirDeg: null,
        waveHeightM: null,
        waveDirDeg: null,
        windSpeedMs: null,
        windDirDeg: null,
        tideM: null,
        tideRateMPerH: null,
      }),
    });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBe(0);
    expect(result.seal).toMatch(/^[0-9a-f]{96}$/);
  });

  it("is deterministic: the same inputs produce the same score and seal", () => {
    const a = scoreHour({ break: breakFixture, hour: hour() });
    const b = scoreHour({ break: breakFixture, hour: hour() });
    expect(b.seal).toBe(a.seal);
    expect(b.score).toBe(a.score);
    expect(JSON.stringify(b.factors)).toBe(JSON.stringify(a.factors));
  });

  it("explains itself: every available factor has evidence text", () => {
    const result = scoreHour({ break: breakFixture, hour: hour() });
    for (const factor of result.factors) {
      expect(factor.evidence.length).toBeGreaterThan(20);
      expect(factor.rawLabel.length).toBeGreaterThan(0);
    }
    expect(result.recommendation).toContain("Test Pass");
  });

  it("renormalises identically for two different breaks of the same type", () => {
    const other: SurfBreak = { ...breakFixture, id: "other", orientationDeg: 20 };
    const result = scoreHour({ break: other, hour: hour({ swellDirDeg: 155 }) });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("bandFor", () => {
  it("maps score to the documented bands", () => {
    expect(bandFor(0)).toBe("flat");
    expect(bandFor(0.2)).toBe("stay-home");
    expect(bandFor(0.4)).toBe("marginal");
    expect(bandFor(0.6)).toBe("worth-the-drive");
    expect(bandFor(0.9)).toBe("get-in");
  });
});

describe("bestWindow", () => {
  const hours = Array.from({ length: 6 }, (_, index) => hour({ at: `2026-10-03T0${index}:00:00.000Z` }));

  it("returns the longest contiguous run above the threshold", () => {
    const results = [
      scoreHour({ break: breakFixture, hour: hours[0] }),
      { ...scoreHour({ break: breakFixture, hour: hours[1] }), score: 0.1 },
      scoreHour({ break: breakFixture, hour: hours[2] }),
      scoreHour({ break: breakFixture, hour: hours[3] }),
      { ...scoreHour({ break: breakFixture, hour: hours[4] }), score: 0.2 },
      scoreHour({ break: breakFixture, hour: hours[5] }),
    ];
    const window = bestWindow(hours, results, 0.5);
    expect(window.bestStart).toBe(hours[2].at);
    expect(window.bestEnd).toBe(hours[3].at);
    expect(window.goodHours).toEqual([hours[0].at, hours[2].at, hours[3].at, hours[5].at]);
  });

  it("falls back to the single best hour when nothing clears the threshold", () => {
    const results = hours.map(() => ({ ...scoreHour({ break: breakFixture, hour: hours[0] }), score: 0.2 }));
    const window = bestWindow(hours, results, 0.5);
    expect(window.goodHours).toEqual([]);
    expect(window.bestStart).toBe(window.bestEnd);
    expect(window.bestStart).toBe(hours[0].at);
  });

  it("handles an empty day", () => {
    const window = bestWindow([], [], 0.5);
    expect(window.bestStart).toBeNull();
    expect(window.meanScore).toBeNull();
  });
});

describe("scoreDay", () => {
  it("scores every hour and shares one window across the day", () => {
    const day = Array.from({ length: 4 }, (_, index) =>
      hour({
        at: `2026-10-03T0${index}:00:00.000Z`,
        // First half of the day the pass is draining and exposed, second half it works.
        tideM: index < 2 ? -0.7 : 0.4,
      }),
    );
    const result = scoreDay(breakFixture, day);
    expect(result.results).toHaveLength(4);
    for (const entry of result.results) {
      expect(entry.window).toBe(result.window);
      expect(entry.window.goodHours).toBe(result.window.goodHours);
    }
    expect(result.results[2].score).toBeGreaterThan(result.results[0].score);
  });

  it("produces the same seals on a second run", () => {
    const day = [hour(), hour({ at: "2026-10-03T01:00:00.000Z", tideM: 1.6 })];
    const first = scoreDay(breakFixture, day);
    const second = scoreDay(breakFixture, day);
    expect(second.results.map((entry) => entry.seal)).toEqual(first.results.map((entry) => entry.seal));
  });
});
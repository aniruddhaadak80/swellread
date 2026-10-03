import { describe, expect, it } from "vitest";
import { hasHourly, normaliseMarine, normaliseWeather, toUtcIso } from "@/lib/live/openmeteo";
import { normaliseTideRows } from "@/lib/live/noaa";
import { noStationSource } from "@/lib/live/conditions";

/**
 * Regression tests for upstream payload shapes.
 *
 * These fixtures are trimmed copies of real responses, not invented ones. Both
 * Open-Meteo endpoints nest their arrays under `hourly`, and NOAA's
 * `product=predictions` returns `predictions` rather than `data`. Reading the
 * wrong level fails *silently*: the HTTP call succeeds, the arrays are missing and
 * the app quietly serves its offline sample instead of live water.
 */

const MARINE_PAYLOAD = {
  latitude: -14.291664,
  longitude: -170.70833,
  utc_offset_seconds: -39600,
  timezone: "Pacific/Pago_Pago",
  hourly_units: { time: "iso8601", swell_wave_height: "m", swell_wave_period: "s", swell_wave_direction: "°" },
  hourly: {
    time: ["2026-10-03T00:00", "2026-10-03T01:00", "2026-10-03T02:00"],
    swell_wave_height: [1.44, 1.52, 1.61],
    swell_wave_period: [14.2, 14.6, 15.1],
    swell_wave_direction: [152, 153, 154],
    wave_height: [1.83, 1.9, 1.98],
    wave_period: [15.1, 15.4, 15.8],
    wave_direction: [149, 150, 151],
  },
};

const FORECAST_PAYLOAD = {
  latitude: -14.29,
  longitude: -170.7,
  utc_offset_seconds: -39600,
  hourly_units: { time: "iso8601", wind_speed_10m: "m/s", wind_direction_10m: "°" },
  hourly: {
    time: ["2026-10-03T00:00", "2026-10-03T01:00"],
    wind_speed_10m: [4.7, 4.2],
    wind_direction_10m: [101, 103],
    temperature_2m: [24.4, 24.1],
    cloud_cover: [42, 48],
    precipitation: [0, 0.1],
  },
};

const NOAA_PREDICTIONS = {
  predictions: [
    { t: "2026-10-03 00:00", v: "0.692" },
    { t: "2026-10-03 01:00", v: "0.592" },
    { t: "2026-10-03 02:00", v: "0.438" },
  ],
};

const NOAA_OBSERVED = {
  metadata: { id: "1770000", name: "Pago Pago, American Samoa", lat: "-14.28", lon: "-170.69" },
  data: [
    { t: "2026-10-03 00:00", v: "0.727", s: "0.046", q: "p" },
    { t: "2026-10-03 00:06", v: "0.729", s: "0.048", q: "p" },
  ],
};

describe("Open-Meteo marine payload shape", () => {
  it("recognises a usable nested hourly block", () => {
    expect(hasHourly(MARINE_PAYLOAD)).toBe(true);
    expect(hasHourly({ latitude: 1 })).toBe(false);
    expect(hasHourly({ hourly: {} })).toBe(false);
    expect(hasHourly(null)).toBe(false);
  });

  it("reads the arrays from inside hourly, not from the top level", () => {
    const hours = normaliseMarine(MARINE_PAYLOAD);
    expect(hours).toHaveLength(3);
    expect(hours[0].swellHeightM).toBe(1.44);
    expect(hours[1].swellPeriodS).toBe(14.6);
    expect(hours[2].swellDirDeg).toBe(154);
    expect(hours[0].waveHeightM).toBe(1.83);
  });

  it("converts naive local timestamps with the payload's own UTC offset", () => {
    // Pacific/Pago_Pago is UTC-11 year round, so local midnight is 11:00 UTC.
    const hours = normaliseMarine(MARINE_PAYLOAD);
    expect(hours[0].at).toBe("2026-10-03T11:00:00.000Z");
    expect(hours[2].at).toBe("2026-10-03T13:00:00.000Z");
  });

  it("returns an empty array rather than throwing on a malformed payload", () => {
    expect(normaliseMarine({ latitude: 1, longitude: 2 })).toEqual([]);
    expect(normaliseMarine({ error: true, reason: "bad" })).toEqual([]);
    expect(normaliseMarine(undefined)).toEqual([]);
  });

  it("turns nulls into nulls instead of NaN", () => {
    const withHoles = normaliseMarine({
      utc_offset_seconds: 0,
      hourly: {
        time: ["2026-10-03T00:00", "2026-10-03T01:00"],
        swell_wave_height: [1.2, null],
      },
    });
    expect(withHoles[0].swellHeightM).toBe(1.2);
    expect(withHoles[1].swellHeightM).toBeNull();
    expect(withHoles[0].swellDirDeg).toBeNull();
  });
});

describe("Open-Meteo forecast payload shape", () => {
  it("reads wind, temperature, cloud and precipitation from inside hourly", () => {
    const hours = normaliseWeather(FORECAST_PAYLOAD);
    expect(hours).toHaveLength(2);
    expect(hours[0].windSpeedMs).toBe(4.7);
    expect(hours[1].windDirDeg).toBe(103);
    expect(hours[0].airTempC).toBe(24.4);
    expect(hours[1].cloudCoverPct).toBe(48);
    expect(hours[1].precipMm).toBe(0.1);
    expect(hours[0].at).toBe("2026-10-03T11:00:00.000Z");
  });

  it("handles a payload that only has wind", () => {
    const hours = normaliseWeather({
      utc_offset_seconds: 36000,
      hourly: { time: ["2026-10-03T00:00"], wind_speed_10m: [3.2] },
    });
    expect(hours[0].windSpeedMs).toBe(3.2);
    expect(hours[0].airTempC).toBeNull();
    expect(hours[0].at).toBe("2026-10-02T14:00:00.000Z");
  });
});

describe("UTC conversion helper", () => {
  it("shifts by the offset and rejects nonsense", () => {
    expect(toUtcIso("2026-10-03T09:00", 19800)).toBe("2026-10-03T03:30:00.000Z");
    expect(toUtcIso("2026-10-03T09:00", 0)).toBe("2026-10-03T09:00:00.000Z");
    expect(toUtcIso("not-a-time", 0)).toBeNull();
  });
});

describe("NOAA payload shapes", () => {
  it("reads the forecast product's predictions array", () => {
    const { rows, name } = normaliseTideRows(NOAA_PREDICTIONS);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ t: "2026-10-03T00:00:00.000Z", m: 0.692 });
    expect(name).toBeNull();
  });

  it("also reads the observed product's data array, and takes its station name", () => {
    const { rows, name } = normaliseTideRows(NOAA_OBSERVED);
    expect(rows).toHaveLength(2);
    expect(rows[0].m).toBe(0.727);
    expect(name).toBe("Pago Pago, American Samoa");
  });

  it("sorts rows by time and drops unusable ones", () => {
    const { rows } = normaliseTideRows({
      predictions: [
        { t: "2026-10-03 02:00", v: "0.438" },
        { t: "2026-10-03 00:00", v: "0.692" },
        { t: "2026-10-03 01:00", v: "" },
        { t: "2026-10-03 03:00", v: "0.273" },
      ],
    });
    expect(rows.map((row) => row.t)).toEqual([
      "2026-10-03T00:00:00.000Z",
      "2026-10-03T02:00:00.000Z",
      "2026-10-03T03:00:00.000Z",
    ]);
  });

  it("returns empty for an error payload or an unknown shape", () => {
    expect(normaliseTideRows({ error: { message: "no data" } }).rows).toEqual([]);
    expect(normaliseTideRows({ something: "else" }).rows).toEqual([]);
    expect(normaliseTideRows(null).rows).toEqual([]);
  });
});

describe("missing tide station attribution", () => {
  it("is a fallback, stale, and says why", () => {
    const source = noStationSource("2026-10-03T06:00:00.000Z");
    expect(source.status).toBe("fallback");
    expect(source.stale).toBe(true);
    expect(source.note).toContain("No NOAA CO-OPS station");
    expect(source.note).toContain("dropped");
    expect(source.url).toMatch(/^https:\/\//);
  });
});
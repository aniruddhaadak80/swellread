/**
 * swellread-engine — deterministic, explainable surf-decision model.
 *
 * Six weighted factors plus hard gates. Every number a visitor sees comes from
 * one of the `evidence` strings, and the whole result is sealed so a later run
 * can prove it was not edited after the fact.
 *
 * This module is the single implementation. The UI, the REST routes and the MCP
 * tools all call `scoreHour` / `scoreDay`; nothing re-derives the arithmetic.
 */

import type {
  Band,
  DerivedPhysics,
  EngineGate,
  EngineInput,
  EngineResult,
  FactorResult,
  HourlyConditions,
  ScoreWindow,
  SurfBreak,
  BreakType,
} from "@/lib/types";
import { angleDelta, clamp, mean, round, smoothstep } from "@/lib/swell/math";
import { sealEvent, GENESIS_SEAL } from "@/lib/integrity/canonical";

export const ENGINE_VERSION = "swellread-engine/2026.10.1";

/** Nominal weights. They sum to exactly 1 and are renormalised when data is missing. */
export const FACTOR_WEIGHTS = {
  swellPower: 0.22,
  peelSpeed: 0.2,
  windQuality: 0.2,
  tideWindow: 0.18,
  directionMatch: 0.12,
  periodCleanliness: 0.08,
} as const;

export type FactorKey = keyof typeof FACTOR_WEIGHTS;

const G = 9.80665;

/** Density of seawater, kg/m^3. */
const RHO = 1025;

/**
 * Deep-water wave power per metre of crest, in kW/m.
 *
 *   P = (1/16) · rho · g · Hs^2 · Tp
 *
 * For Hs = 1.5 m and Tp = 10 s this returns ~14 kW/m, which matches published
 * estimates for a clean 6 ft / 10 s day.
 */
export function wavePowerKwM(swellHeightM: number, swellPeriodS: number): number {
  if (!Number.isFinite(swellHeightM) || !Number.isFinite(swellPeriodS)) return 0;
  if (swellHeightM <= 0 || swellPeriodS <= 0) return 0;
  return round((RHO * G * swellHeightM * swellHeightM * swellPeriodS) / 16 / 1000, 2);
}

/** Solitary-wave breaking index: a wave breaks when its height reaches ~0.78 × depth. */
export const BREAKING_INDEX = 0.78;

/**
 * Wave height where the swell stands up on this break, in metres.
 *
 * Green's law for a straight slope, with the breaking index substituted in, gives
 * the height at which the swell trips on the face:
 *
 *   Hb = Hs0 · (γ · tanβ)^(1/4)
 *
 * The water you actually have caps it, because a wave in water shallower than
 * Hb/γ has already broken further out and is closing rather than standing up:
 *
 *   Hb = min( Hb, γ · depth )
 *
 * So a bigger offshore swell, a steeper face, or more water all raise the height
 * at the take-off — and running out of water lowers it.
 */
export function breakHeightAt(swellHeightM: number, depthM: number, slope: number): number {
  if (!Number.isFinite(swellHeightM) || !Number.isFinite(depthM)) return 0;
  if (swellHeightM <= 0) return 0;
  if (depthM <= 0) return 0;
  const tanBeta = Math.max(slope, 0.01);
  const onSlope = swellHeightM * Math.pow(BREAKING_INDEX * tanBeta, 0.25);
  const depthLimited = BREAKING_INDEX * depthM;
  return round(Math.min(onSlope, depthLimited), 2);
}

/** Depth at which the swell would trip on this slope, in metres. */
export function breakingDepthM(swellHeightM: number, slope: number): number {
  if (!Number.isFinite(swellHeightM) || swellHeightM <= 0) return 0;
  const tanBeta = Math.max(slope, 0.01);
  return round((swellHeightM * Math.pow(BREAKING_INDEX * tanBeta, 0.25)) / BREAKING_INDEX, 2);
}

/**
 * Peel speed along the reef in km/h, from shallow-water wave celerity:
 *
 *   c = sqrt(g · depth)
 *
 * This is the reason tide matters: the same swell peels faster over a deeper
 * take-off, which is exactly why dragging the tide ribbon changes the game.
 */
export function peelSpeedKmh(depthM: number): number {
  if (!Number.isFinite(depthM) || depthM <= 0) return 0;
  return round(Math.sqrt(G * depthM) * 3.6, 1);
}

/** Water depth over the take-off spot. */
export function depthOverTakeoff(depthAtBreakM: number, tideM: number | null): number | null {
  if (tideM === null || !Number.isFinite(tideM)) return null;
  return round(Math.max(0.05, depthAtBreakM + tideM), 2);
}

interface TideWindowSpec {
  idealMin: number;
  idealMax: number;
  minSafe: number;
  label: string;
}

/**
 * Depth band over the take-off where each break type works, in metres.
 * Reef passes need the most water because they stand up out of the shallowest
 * part; beachbreaks work across the widest range.
 */
export const TIDE_WINDOWS: Record<BreakType, TideWindowSpec> = {
  reef_pass: { idealMin: 0.9, idealMax: 2.0, minSafe: 0.6, label: "needs the pass covered" },
  reef: { idealMin: 0.6, idealMax: 1.4, minSafe: 0.4, label: "wants the reef just covered" },
  point: { idealMin: 0.5, idealMax: 1.2, minSafe: 0.3, label: "prefers a filling tide" },
  beachbreak: { idealMin: 0.8, idealMax: 2.2, minSafe: 0.3, label: "works across the tide" },
  river_mouth: { idealMin: 0.7, idealMax: 1.6, minSafe: 0.4, label: "needs the bar swept" },
};

function factor(
  key: FactorKey,
  label: string,
  available: boolean,
  raw: number | null,
  rawLabel: string,
  score: number,
  evidence: string,
): FactorResult {
  const bounded = available ? clamp(score, 0, 1) : 0;
  return {
    key,
    label,
    available,
    raw: raw === null ? null : round(raw, 3),
    rawLabel,
    score: round(bounded, 4),
    weight: FACTOR_WEIGHTS[key],
    effectiveWeight: 0,
    contribution: 0,
    evidence,
  };
}

function swellPowerFactor(hour: HourlyConditions): FactorResult {
  const hs = hour.swellHeightM ?? hour.waveHeightM;
  const tp = hour.swellPeriodS;
  if (hs === null || tp === null || hs <= 0 || tp <= 0) {
    return factor(
      "swellPower",
      "Swell power",
      false,
      null,
      "no swell height/period from the source",
      0,
      "Open-Meteo returned no usable swell height or period for this hour, so wave power cannot be computed.",
    );
  }
  const power = wavePowerKwM(hs, tp);
  const score = clamp(power / 22, 0, 1);
  return factor(
    "swellPower",
    "Swell power",
    true,
    power,
    `${power.toFixed(1)} kW/m`,
    score,
    `P = 1/16 · rho · g · Hs² · Tp = 0.628 · ${hs.toFixed(2)}² · ${tp.toFixed(0)} = ${power.toFixed(1)} kW/m, against a 22 kW/m "serious day" reference.`,
  );
}

function peelSpeedFactor(depthM: number | null, breakHeightM: number | null): FactorResult {
  if (depthM === null) {
    return factor(
      "peelSpeed",
      "Peel speed",
      false,
      null,
      "needs a tide height",
      0,
      "Peel speed is shallow-water celerity, so without a verified tide height there is no depth to take the square root of. This factor is dropped rather than guessed.",
    );
  }
  const kmh = peelSpeedKmh(depthM);
  const score = smoothstep(3.5, 8.5, kmh) * (1 - 0.85 * smoothstep(19, 31, kmh));
  const depthNote = breakHeightM === null ? "" : `, with ${breakHeightM.toFixed(2)} m standing up`;
  return factor(
    "peelSpeed",
    "Peel speed",
    true,
    kmh,
    `${kmh.toFixed(1)} km/h`,
    score,
    `c = sqrt(g · depth) = sqrt(9.81 · ${depthM.toFixed(2)} m) = ${kmh.toFixed(1)} km/h over a ${depthM.toFixed(2)} m take-off${depthNote}. Full marks 8.5–19 km/h: slower is mush, faster than ~25 km/h is unridable.`,
  );
}

function windQualityFactor(hour: HourlyConditions): FactorResult {
  const wind = hour.windSpeedMs;
  const windDir = hour.windDirDeg;
  const swellDir = hour.swellDirDeg ?? hour.waveDirDeg;
  if (wind === null || windDir === null || swellDir === null) {
    return factor(
      "windQuality",
      "Wind quality",
      false,
      null,
      "no wind or swell direction",
      0,
      "Wind quality needs both a wind bearing and a swell bearing. Missing either means this factor is dropped rather than assumed calm.",
    );
  }
  const angle = angleDelta(windDir, swellDir);
  const onshore = (1 + Math.cos((angle * Math.PI) / 180)) / 2;
  const alignment = 1 - onshore;
  const envelope = (0.35 + 0.65 * smoothstep(0, 4, wind)) * (1 - 0.92 * smoothstep(7.5, 15.5, wind));
  const score = alignment * envelope;
  const dirWord = angle < 30 ? "straight onshore" : angle > 150 ? "straight offshore" : `${Math.round(angle)}° off`;
  return factor(
    "windQuality",
    "Wind quality",
    true,
    score,
    `${wind.toFixed(1)} m/s ${dirWord}`,
    score,
    `Wind is ${dirWord} at ${wind.toFixed(1)} m/s. Alignment = 1 − (1 + cos ${Math.round(angle)}°)/2 = ${alignment.toFixed(2)}; speed envelope at ${wind.toFixed(1)} m/s = ${envelope.toFixed(2)}. Product ${score.toFixed(2)}.`,
  );
}

function tideWindowFactor(breakType: BreakType, depthM: number | null, tideM: number | null): FactorResult {
  if (tideM === null || depthM === null) {
    return factor(
      "tideWindow",
      "Tide window",
      false,
      null,
      "no verified tide in range",
      0,
      "This break has no NOAA CO-OPS tide station in range, so the tide window cannot be scored. Weights are renormalised without it instead of substituting a guess.",
    );
  }
  const spec = TIDE_WINDOWS[breakType];
  const below = smoothstep(spec.minSafe * 0.55, spec.idealMin, depthM);
  const above = 1 - smoothstep(spec.idealMax, spec.idealMax * 2, depthM);
  const score = clamp(below * above, 0, 1);
  return factor(
    "tideWindow",
    "Tide window",
    true,
    depthM,
    `${depthM.toFixed(2)} m over the take-off`,
    score,
    `${breakType.replace("_", " ")} ${spec.label}. Ideal band ${spec.idealMin}–${spec.idealMax} m of water over the take-off; below ${spec.minSafe.toFixed(2)} m the reef is exposed.`,
  );
}

function directionMatchFactor(hour: HourlyConditions, orientationDeg: number): FactorResult {
  const swellDir = hour.swellDirDeg ?? hour.waveDirDeg;
  if (swellDir === null) {
    return factor(
      "directionMatch",
      "Direction match",
      false,
      null,
      "no swell direction",
      0,
      "Open-Meteo returned no swell bearing, so the angle between the swell and this break's peel cannot be measured.",
    );
  }
  const delta = angleDelta(swellDir, orientationDeg);
  const score = 1 - smoothstep(12, 75, delta);
  return factor(
    "directionMatch",
    "Direction match",
    true,
    delta,
    `${Math.round(delta)}° off the ${Math.round(orientationDeg)}° peel`,
    score,
    `Swell from ${Math.round(swellDir)}°, this break peels cleanly from ${Math.round(orientationDeg)}°. ${Math.round(delta)}° of error: inside 12° is full marks, past 75° the swell wraps the headland and does not arrive.`,
  );
}

function periodCleanlinessFactor(hour: HourlyConditions): FactorResult {
  const tp = hour.swellPeriodS;
  if (tp === null || tp <= 0) {
    return factor(
      "periodCleanliness",
      "Period cleanliness",
      false,
      null,
      "no swell period",
      0,
      "No swell period, so there is nothing to judge the long-wave cleanliness of the swell by.",
    );
  }
  const score = smoothstep(6, 9.5, tp) * (1 - 0.35 * smoothstep(14, 22, tp));
  return factor(
    "periodCleanliness",
    "Period cleanliness",
    true,
    tp,
    `${tp.toFixed(1)} s`,
    score,
    `Tp = ${tp.toFixed(1)} s. Energy organises between 6 s and 9.5 s; beyond 14 s the swell stands up steeper than a shallow reef can hold, so the score is eased off by up to 35%.`,
  );
}

export function bandFor(score: number): Band {
  if (score <= 0) return "flat";
  if (score >= 0.7) return "get-in";
  if (score >= 0.5) return "worth-the-drive";
  if (score >= 0.3) return "marginal";
  return "stay-home";
}

const BAND_COPY: Record<Band, string> = {
  "get-in": "Get in the water.",
  "worth-the-drive": "Worth the drive.",
  marginal: "Marginal — one good hour at most.",
  "stay-home": "Stay home.",
  flat: "There is nothing to surf.",
};

/** Gates that can veto or damp a score. Applied after the weighted sum. */
function applyGates(
  gates: EngineGate[],
  hour: HourlyConditions,
  breakType: BreakType,
  depthM: number | null,
  swellHeightM: number | null,
  windSpeedMs: number | null,
): number {
  let multiplier = 1;
  if (swellHeightM === null || swellHeightM < 0.35) {
    gates.push({
      code: "flat",
      severity: "block",
      message:
        swellHeightM === null
          ? "No swell height reported for this hour."
          : `Swell is ${swellHeightM.toFixed(2)} m — below the 0.35 m minimum anything can break on.`,
    });
    return 0;
  }
  const spec = TIDE_WINDOWS[breakType];
  if (depthM !== null && depthM < spec.minSafe) {
    gates.push({
      code: "reef-exposed",
      severity: "block",
      message: `Only ${depthM.toFixed(2)} m over the take-off. This ${breakType.replace("_", " ")} needs ${spec.minSafe.toFixed(2)} m to stand up — it will be exposed.`,
    });
    multiplier = Math.min(multiplier, 0.08);
  }
  if (windSpeedMs !== null && windSpeedMs > 13.5) {
    gates.push({
      code: "blown-out",
      severity: "warn",
      message: `Wind at ${windSpeedMs.toFixed(1)} m/s — blown out, and messy on exit.`,
    });
    multiplier *= 0.55;
  }
  if (swellHeightM !== null && swellHeightM > 2.6) {
    gates.push({
      code: "exposed",
      severity: "warn",
      message: `Swell at ${swellHeightM.toFixed(2)} m — big enough to hold you under on a bad take-off.`,
    });
    multiplier *= 0.7;
  }
  const rate = hour.tideRateMPerH;
  if (rate !== null && rate > 0.7 && depthM !== null && depthM < spec.idealMax) {
    gates.push({
      code: "covering-fast",
      severity: "info",
      message: `Tide is flooding at ${rate.toFixed(2)} m/h, so the take-off will keep standing up as you sit out there.`,
    });
  }
  return multiplier;
}

/** Assembles factors, renormalises weights over what is available, and seals. */
function assemble(
  version: string,
  factors: FactorResult[],
  gates: EngineGate[],
  derived: DerivedPhysics,
  breakRef: SurfBreak,
  at: string,
): EngineResult {
  const availableWeight = factors.reduce((sum, f) => (f.available ? sum + f.weight : sum), 0);
  let score = 0;
  for (const f of factors) {
    if (!f.available || availableWeight <= 0) {
      f.effectiveWeight = 0;
      f.contribution = 0;
      continue;
    }
    f.effectiveWeight = round(f.weight / availableWeight, 4);
    f.contribution = round(f.score * f.effectiveWeight, 6);
    score += f.contribution;
  }
  score = clamp(score, 0, 1);
  const band = bandFor(score);

  const strongest = factors
    .filter((f) => f.available && f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)[0];
  const weakest = factors
    .filter((f) => f.available)
    .sort((a, b) => a.contribution - b.contribution)[0];
  const missing = factors.filter((f) => !f.available).map((f) => f.label);

  const parts: string[] = [`${BAND_COPY[band]} At ${breakRef.name} on this hour the read is ${(score * 100).toFixed(0)}%.`];
  if (strongest) parts.push(`What earns it: ${strongest.label.toLowerCase()} at ${strongest.rawLabel}.`);
  if (weakest && strongest && weakest.key !== strongest.key) {
    parts.push(`What costs it: ${weakest.label.toLowerCase()} at ${weakest.rawLabel}.`);
  }
  if (missing.length > 0) {
    parts.push(`Not scored, because no real data exists: ${missing.join(", ")}.`);
  }

  const body = {
    version,
    breakId: breakRef.id,
    at,
    score: round(score, 4),
    band,
    factors: factors.map((f) => ({
      key: f.key,
      available: f.available,
      raw: f.raw,
      score: f.score,
      effectiveWeight: f.effectiveWeight,
      contribution: f.contribution,
    })),
    gates: gates.map((g) => ({ code: g.code, severity: g.severity })),
    derived,
  };
  const seal = sealEvent(GENESIS_SEAL, body);

  return {
    version,
    score: round(score, 4),
    band,
    recommendation: parts.join(" "),
    factors,
    gates,
    derived,
    window: { bestStart: null, bestEnd: null, bestHour: null, meanScore: 0, goodHours: [] },
    seal,
  };
}

/**
 * Scores one hour. Pure, synchronous, and the only place the arithmetic lives.
 */
export function scoreHour(input: EngineInput): EngineResult {
  const { break: surfBreak, hour } = input;
  const swellHeight = hour.swellHeightM ?? hour.waveHeightM;
  const depthM = depthOverTakeoff(surfBreak.depthAtBreakM, hour.tideM);
  const breakHeight = depthM === null ? null : breakHeightAt(swellHeight ?? 0, depthM, surfBreak.reefSlope);
  const power = swellHeight !== null && hour.swellPeriodS !== null ? wavePowerKwM(swellHeight, hour.swellPeriodS) : null;
  const windAngle =
    hour.windDirDeg !== null && (hour.swellDirDeg ?? hour.waveDirDeg) !== null
      ? angleDelta(hour.windDirDeg, hour.swellDirDeg ?? hour.waveDirDeg ?? 0)
      : null;

  const factors: FactorResult[] = [
    swellPowerFactor(hour),
    peelSpeedFactor(depthM, breakHeight),
    windQualityFactor(hour),
    tideWindowFactor(surfBreak.breakType, depthM, hour.tideM),
    directionMatchFactor(hour, surfBreak.orientationDeg),
    periodCleanlinessFactor(hour),
  ];
  const gates: EngineGate[] = [];
  const multiplier = applyGates(gates, hour, surfBreak.breakType, depthM, swellHeight, hour.windSpeedMs);
  const result = assemble(
    ENGINE_VERSION,
    factors,
    gates,
    { breakHeightM: breakHeight, peelSpeedKmh: depthM === null ? null : peelSpeedKmh(depthM), powerKwM: power, windAngleDeg: windAngle, depthAtBreakM: depthM },
    surfBreak,
    hour.at,
  );
  if (multiplier === 1) return result;

  const damped = clamp(result.score * multiplier, 0, 1);
  const band = bandFor(damped);
  const body = {
    version: ENGINE_VERSION,
    breakId: surfBreak.id,
    at: hour.at,
    score: round(damped, 4),
    band,
    factors: result.factors.map((f) => ({
      key: f.key,
      available: f.available,
      raw: f.raw,
      score: f.score,
      effectiveWeight: f.effectiveWeight,
      contribution: f.contribution,
    })),
    gates: gates.map((g) => ({ code: g.code, severity: g.severity })),
    derived: result.derived,
  };
  return {
    ...result,
    score: round(damped, 4),
    band,
    recommendation: `${BAND_COPY[band]} Gated down from ${(result.score * 100).toFixed(0)}%: ${gates.map((g) => g.message).join(" ")}`,
    window: result.window,
    seal: sealEvent(GENESIS_SEAL, body),
  };
}

/**
 * Finds the longest contiguous run of hours at or above `threshold`.
 * When nothing clears it, falls back to the single best hour so the app always
 * has an answer rather than a shrug.
 */
export function bestWindow(
  hours: HourlyConditions[],
  results: EngineResult[],
  threshold = 0.5,
): ScoreWindow {
  if (hours.length === 0 || results.length === 0) {
    return { bestStart: null, bestEnd: null, bestHour: null, meanScore: null, goodHours: [] };
  }
  const pairs = hours
    .map((hour, index) => ({ at: hour.at, score: results[index]?.score ?? 0 }))
    .filter((pair) => Number.isFinite(pair.score));
  if (pairs.length === 0) {
    return { bestStart: null, bestEnd: null, bestHour: null, meanScore: null, goodHours: [] };
  }
  const goodHours = pairs.filter((pair) => pair.score >= threshold).map((pair) => pair.at);

  // Longest contiguous run at or above the threshold; ties break on mean score.
  let best: { start: string; end: string; mean: number; length: number } | null = null;
  let run: Array<{ at: string; score: number }> = [];
  const flush = () => {
    if (run.length === 0) return;
    const candidate = {
      start: run[0].at,
      end: run[run.length - 1].at,
      mean: mean(run.map((p) => p.score)),
      length: run.length,
    };
    const better =
      best === null ||
      candidate.length > best.length ||
      (candidate.length === best.length && candidate.mean > best.mean);
    if (better) best = candidate;
    run = [];
  };
  for (const pair of pairs) {
    if (pair.score >= threshold) run.push(pair);
    else flush();
  }
  flush();

  const sorted = [...pairs].sort((a, b) =>
    b.score === a.score ? a.at.localeCompare(b.at) : b.score - a.score,
  );
  const top = sorted[0];
  const chosen = best ?? { start: top.at, end: top.at, mean: top.score, length: 1 };

  return {
    bestStart: chosen.start,
    bestEnd: chosen.end,
    bestHour: top.at,
    meanScore: round(chosen.mean, 4),
    goodHours,
  };
}

/** Scores a whole day, attaching the same window to every hour's result. */
export function scoreDay(
  surfBreak: SurfBreak,
  hours: HourlyConditions[],
): { hours: HourlyConditions[]; results: EngineResult[]; window: ScoreWindow } {
  const results = hours.map((hour) => scoreHour({ break: surfBreak, hour }));
  const window = bestWindow(hours, results);
  return {
    hours,
    results: results.map((r) => ({ ...r, window })),
    window,
  };
}
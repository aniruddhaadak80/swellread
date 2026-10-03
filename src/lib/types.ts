/**
 * Normalized domain types.
 *
 * Everything that crosses a boundary (HTTP response, MCP tool result, database
 * row, client component prop) is expressed in these types. External payloads
 * never leak past `src/lib/live`.
 */

export type SourceStatus = "live" | "fallback";

export interface SourceMeta {
  /** Machine id of the upstream provider. */
  id: "noaa-coops" | "open-meteo-marine" | "open-meteo-forecast" | "bundled-sample";
  /** Human name for attribution. */
  name: string;
  /** Attribution / documentation URL. */
  url: string;
  license: string;
  /** `live` only when this run really reached the upstream API. */
  status: SourceStatus;
  /** ISO-8601 UTC. */
  fetchedAt: string;
  /** True when the payload came from the sealed offline sample. */
  stale: boolean;
  /** Why it is stale, or why it failed. */
  note?: string;
}

export type BreakType = "reef_pass" | "reef" | "point" | "beachbreak" | "river_mouth";

export interface SurfBreak {
  id: string;
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  /** IANA zone, used to decide which local calendar day the hours belong to. */
  timezone: string;
  breakType: BreakType;
  /** Swell-from bearing (degrees true) that peels this break cleanly. */
  orientationDeg: number;
  /** tan(beta) of the reef/beach face that the wave breaks on. */
  reefSlope: number;
  /** Water depth at the take-off spot, in metres, at the station datum. */
  depthAtBreakM: number;
  /** NOAA CO-OPS station used for tide, when one is in range. */
  tideStationId: string | null;
  tideStationName: string | null;
  tideStationDistanceKm: number | null;
  blurb: string;
}

export interface HourlyConditions {
  /** ISO-8601 UTC hour start. */
  at: string;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  swellDirDeg: number | null;
  waveHeightM: number | null;
  waveDirDeg: number | null;
  windSpeedMs: number | null;
  windDirDeg: number | null;
  airTempC: number | null;
  cloudCoverPct: number | null;
  precipMm: number | null;
  /** Metres above the tide station's chart datum. Null when unavailable. */
  tideM: number | null;
  /** Metres of tide change per hour at this hour. */
  tideRateMPerH: number | null;
}

export type SnapshotStatus = "live" | "mixed" | "fallback";

export interface ConditionsSnapshot {
  breakId: string;
  /** IANA timezone of the break. */
  timezone: string;
  /** Local calendar date covered by `hours`. */
  date: string;
  hours: HourlyConditions[];
  sources: SourceMeta[];
  status: SnapshotStatus;
  generatedAt: string;
}

export interface TideExtrema {
  t: string;
  m: number;
  kind: "high" | "low";
}

export interface TideSeries {
  stationId: string | null;
  stationName: string | null;
  datum: string;
  /** Sorted ascending by time. */
  points: Array<{ t: string; m: number }>;
  highs: TideExtrema[];
  lows: TideExtrema[];
  rangeM: number;
  meanM: number;
  status: SourceStatus;
  note?: string;
}

/* ------------------------------------------------------------------ engine */

export type Band = "flat" | "stay-home" | "marginal" | "worth-the-drive" | "get-in";

export interface FactorResult {
  key: string;
  label: string;
  /** Present when the factor could not be computed from real data. */
  available: boolean;
  /** Physical input value, or null. */
  raw: number | null;
  /** Formatted physical input, or the reason it is missing. */
  rawLabel: string;
  /** Normalized 0..1. Zero when unavailable. */
  score: number;
  /** Nominal weight before renormalisation. */
  weight: number;
  /** Weight actually applied after dropping unavailable factors. */
  effectiveWeight: number;
  /** score * effectiveWeight. Sums to `score` across available factors. */
  contribution: number;
  /** One line explaining the arithmetic. */
  evidence: string;
}

export interface EngineGate {
  code: string;
  severity: "info" | "warn" | "block";
  message: string;
}

export interface DerivedPhysics {
  /** Wave height where it breaks on this break, metres. */
  breakHeightM: number | null;
  /** Peel speed along the reef, km/h. */
  peelSpeedKmh: number | null;
  /** Deep-water wave power, kW per metre of crest. */
  powerKwM: number | null;
  /** Smallest angle between wind-from and swell-from, degrees. */
  windAngleDeg: number | null;
  /** Water depth over the take-off spot at this hour, metres. */
  depthAtBreakM: number | null;
}

export interface ScoreWindow {
  bestStart: string | null;
  bestEnd: string | null;
  bestHour: string | null;
  meanScore: number | null;
  /** Hours in the window whose own score clears the "worth it" band. */
  goodHours: string[];
}

export interface EngineInput {
  break: SurfBreak;
  hour: HourlyConditions;
  /**
   * Previous and next hours. Used only to label the tide trend; the engine never
   * infers a tide value it was not given.
   */
  neighbours?: { prev: HourlyConditions | null; next: HourlyConditions | null };
}

export interface EngineResult {
  version: string;
  /** 0..1. */
  score: number;
  band: Band;
  recommendation: string;
  factors: FactorResult[];
  gates: EngineGate[];
  derived: DerivedPhysics;
  window: ScoreWindow;
  /** SHA-384 seal over the canonical result body. Recomputable by anyone. */
  seal: string;
}

/* -------------------------------------------------------------- persistence */

export type SessionStatus = "planned" | "committed" | "skipped" | "ridden";
export type SessionCall = "in" | "out" | null;

export interface Ride {
  id: string;
  sessionId: string;
  durationSec: number;
  longestRideSec: number;
  topSpeedKmh: number;
  /** True when the ride finished without being caught by the closing section. */
  completed: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  ownerId: string;
  breakId: string;
  status: SessionStatus;
  /** ISO-8601 UTC start of the planned window. */
  plannedFor: string;
  call: SessionCall;
  /** 1..5 rider confidence in the call. */
  confidence: number | null;
  note: string | null;
  /** Base64 Float32Array of the local embedding, or null. */
  embedding: string | null;
  conditions: ConditionsSnapshot;
  engine: EngineResult;
  rides: Ride[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SessionSummary {
  id: string;
  breakId: string;
  breakName: string;
  status: SessionStatus;
  call: SessionCall;
  plannedFor: string;
  score: number;
  band: Band;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  windSpeedMs: number | null;
  tideM: number | null;
  rideCount: number;
  longestRideSec: number;
  createdAt: string;
}

/* ----------------------------------------------------------------- integrity */

export type AuditAction =
  | "session.create"
  | "session.update"
  | "session.decide"
  | "session.delete"
  | "session.restore"
  | "ride.log";

export interface AuditEvent {
  seq: number;
  entityType: "session" | "ride";
  entityId: string;
  action: AuditAction;
  payload: Record<string, unknown>;
  prevSeal: string;
  seal: string;
  createdAt: string;
}

export interface ChainVerification {
  entityId: string;
  ok: boolean;
  length: number;
  headSeal: string | null;
  brokenAt: number | null;
  reason: string | null;
  events: AuditEvent[];
}

/* ------------------------------------------------------------------- errors */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
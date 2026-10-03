import { withDb } from "@/lib/db/client";
import {
  addRide,
  createSession,
  deleteSession,
  findSessionByIdempotencyKey,
  getRides,
  loadSession,
  listSessionRows,
  rowToSession,
  toSummary,
  updateSession,
  verifyChain,
} from "@/lib/repo/sessions";
import { analyseBreak } from "@/lib/services/analysis";
import type {
  ChainVerification,
  EngineResult,
  Ride,
  Session,
  SessionSummary,
  SourceStatus,
} from "@/lib/types";
import type { CreateSessionInput, RideInput, UpdateSessionInput } from "@/lib/validation";
import type { ListOptions } from "@/lib/repo/sessions";

/**
 * The service layer.
 *
 * The UI, the REST routes and the MCP mutating tools all come through here, so
 * there is exactly one code path that can write a session. Every write returns
 * the new chain seal alongside the record.
 */

export interface MutationResult {
  session: Session;
  seal: string;
  seq: number;
  /** True when an idempotency key matched an earlier call instead of inserting. */
  replayed: boolean;
}

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function planSession(ownerId: string, input: CreateSessionInput): Promise<MutationResult> {
  return withDb(async (executor) => {
    if (input.idempotencyKey) {
      const existing = await findSessionByIdempotencyKey(executor, ownerId, input.idempotencyKey);
      if (existing) {
        const session = rowToSession(existing, await getRides(executor, String(existing.id), ownerId));
        const chain = await verifyChain(executor, session.id, ownerId);
        return { session, seal: chain.headSeal ?? "", seq: chain.length, replayed: true };
      }
    }

    const plannedMs = Date.parse(input.plannedFor);
    if (!Number.isFinite(plannedMs)) throw new ServiceError(400, "invalid_planned_for", "plannedFor must be an ISO-8601 instant");

    const snapshotDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(plannedMs));

    let analysis;
    try {
      analysis = await analyseBreak({ breakId: input.breakId, date: snapshotDate, hour: 0 });
    } catch (error) {
      throw new ServiceError(502, "conditions_unavailable", error instanceof Error ? error.message : "conditions unavailable");
    }

    const firstHourMs = Date.parse(analysis.snapshot.hours[0].at);
    const hourIndex = Math.min(23, Math.max(0, Math.floor((plannedMs - firstHourMs) / 3_600_000)));

    // Re-run the shared engine on the exact hour being planned, so the frozen
    // snapshot and its seal describe that hour rather than midnight.
    const targetHour = analysis.snapshot.hours[hourIndex] ?? analysis.snapshot.hours[0];
    const { scoreHour } = await import("@/lib/swell/engine");
    const engine: EngineResult = {
      ...scoreHour({ break: analysis.break, hour: targetHour }),
      window: analysis.engine.window,
    };

    const { row, audit } = await createSession(executor, {
      ownerId,
      breakId: input.breakId,
      plannedFor: new Date(plannedMs).toISOString(),
      conditions: analysis.snapshot,
      engine,
      status: input.status,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    });

    const session = rowToSession(row);
    return { session, seal: audit.seal, seq: audit.seq, replayed: false };
  });
}

export async function readSession(ownerId: string, id: string): Promise<Session | null> {
  return withDb((executor) => loadSession(executor, id, ownerId));
}

export async function readSessionWithTombstone(ownerId: string, id: string): Promise<Session | null> {
  return withDb((executor) => loadSession(executor, id, ownerId, true));
}

export interface PagedSessions {
  items: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export async function readSessions(ownerId: string, options: ListOptions): Promise<PagedSessions> {
  return withDb(async (executor) => {
    const { rows, total } = await listSessionRows(executor, ownerId, options);
    const items = rows.map((row) => toSummary(rowToSession(row)));
    return { items, total, limit: options.limit ?? 25, offset: options.offset ?? 0 };
  });
}

export async function changeSession(ownerId: string, id: string, patch: UpdateSessionInput): Promise<MutationResult> {
  return withDb(async (executor) => {
    const action = patch.call !== undefined || patch.confidence !== undefined ? "session.decide" : "session.update";
    const result = await updateSession(executor, id, ownerId, { ...patch, action });
    if (!result.row) {
      if (result.forbidden) throw new ServiceError(404, "session_not_found", "No such session in this browser.");
      throw new ServiceError(409, "session_conflict", "The session changed while you were editing it. Reload and try again.");
    }
    const session = rowToSession(result.row, await getRides(executor, id, ownerId));
    return { session, seal: result.audit?.seal ?? "", seq: result.audit?.seq ?? 0, replayed: false };
  });
}

export async function dropSession(ownerId: string, id: string): Promise<MutationResult> {
  return withDb(async (executor) => {
    const result = await deleteSession(executor, id, ownerId);
    if (!result.row) throw new ServiceError(404, "session_not_found", "No such session in this browser.");
    const session = rowToSession(result.row, await getRides(executor, id, ownerId));
    return { session, seal: result.audit?.seal ?? "", seq: result.audit?.seq ?? 0, replayed: false };
  });
}

export async function recordRide(ownerId: string, id: string, ride: RideInput): Promise<{ ride: Ride; session: Session; seal: string }> {
  return withDb(async (executor) => {
    const result = await addRide(executor, id, ownerId, ride);
    if (!result.ride) throw new ServiceError(404, "session_not_found", "No such session in this browser.");
    const loaded = await loadSession(executor, id, ownerId);
    if (!loaded) throw new ServiceError(404, "session_not_found", "No such session in this browser.");
    return { ride: result.ride, session: loaded, seal: result.audit?.seal ?? "" };
  });
}

export async function verifySessionChain(ownerId: string, id: string): Promise<ChainVerification> {
  return withDb((executor) => verifyChain(executor, id, ownerId));
}

/** Builds the shareable brief artifact for one session. */
export interface Brief {
  generatedAt: string;
  session: {
    id: string;
    status: string;
    call: string | null;
    confidence: number | null;
    plannedFor: string;
    breakName: string;
    breakRegion: string;
    breakCountry: string;
    timezone: string;
    coordinates: { lat: number; lon: number };
    breakType: string;
  };
  snapshotStatus: string;
  sourceAttribution: Array<{ name: string; url: string; license: string; status: SourceStatus; fetchedAt: string }>;
  conditions: Array<{
    at: string;
    swellHeightM: number | null;
    swellPeriodS: number | null;
    swellDirDeg: number | null;
    windSpeedMs: number | null;
    windDirDeg: number | null;
    tideM: number | null;
    airTempC: number | null;
  }>;
  engine: EngineResult;
  window: { start: string | null; end: string | null; goodHours: string[] };
  rides: Ride[];
  chain: { length: number; headSeal: string | null; ok: boolean; brokenAt: number | null; reason: string | null };
  disclaimer: string;
}

export async function buildBrief(ownerId: string, id: string): Promise<Brief> {
  const session = await readSession(ownerId, id);
  if (!session) throw new ServiceError(404, "session_not_found", "No such session in this browser.");
  const chain = await verifySessionChain(ownerId, id);
  const { getBreak } = await import("@/lib/live/breaks");
  const surfBreak = getBreak(session.breakId);

  const goodHours = session.engine?.window?.goodHours ?? [];
  const windowPoints = session.conditions.hours.filter((hour) => goodHours.includes(hour.at));

  return {
    generatedAt: new Date().toISOString(),
    session: {
      id: session.id,
      status: session.status,
      call: session.call,
      confidence: session.confidence,
      plannedFor: session.plannedFor,
      breakName: surfBreak?.name ?? session.breakId,
      breakRegion: surfBreak?.region ?? "",
      breakCountry: surfBreak?.country ?? "",
      timezone: surfBreak?.timezone ?? "UTC",
      coordinates: { lat: surfBreak?.lat ?? 0, lon: surfBreak?.lon ?? 0 },
      breakType: surfBreak?.breakType ?? "unknown",
    },
    snapshotStatus: session.conditions.status,
    sourceAttribution: session.conditions.sources.map((source) => ({
      name: source.name,
      url: source.url,
      license: source.license,
      status: source.status,
      fetchedAt: source.fetchedAt,
    })),
    conditions: session.conditions.hours.map((hour) => ({
      at: hour.at,
      swellHeightM: hour.swellHeightM,
      swellPeriodS: hour.swellPeriodS,
      swellDirDeg: hour.swellDirDeg,
      windSpeedMs: hour.windSpeedMs,
      windDirDeg: hour.windDirDeg,
      tideM: hour.tideM,
      airTempC: hour.airTempC,
    })),
    engine: session.engine,
    window: {
      start: windowPoints[0]?.at ?? null,
      end: windowPoints[windowPoints.length - 1]?.at ?? null,
      goodHours,
    },
    rides: session.rides,
    chain: { length: chain.length, headSeal: chain.headSeal, ok: chain.ok, brokenAt: chain.brokenAt, reason: chain.reason },
    disclaimer:
      "Surf forecasts describe the surface of the ocean, not what is happening underneath it. Reefs, currents and your own ability decide the rest. This is a planning aid, not a safety guarantee.",
  };
}
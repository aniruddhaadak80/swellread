import type { SqlExecutor } from "@/lib/db/client";
import { GENESIS_SEAL, sealEvent, verifyLink } from "@/lib/integrity/canonical";
import { getBreak } from "@/lib/live/breaks";
import type {
  AuditEvent,
  ChainVerification,
  ConditionsSnapshot,
  EngineResult,
  Ride,
  Session,
  SessionCall,
  SessionStatus,
  SessionSummary,
} from "@/lib/types";
import { randomUUID } from "node:crypto";

/**
 * Sessions, rides, and the per-entity tamper-evident audit chain.
 *
 * Every mutation is one SQL statement. The entity change and its audit event are
 * gated on the same `target` CTE, so they either both land or neither does. The
 * audit row carries a SHA-384 seal computed in JavaScript over canonical JSON,
 * which is why the id is generated here rather than by the database: the seal
 * must be known before the statement runs.
 */

const COLUMNS = [
  "id",
  "owner_id",
  "break_id",
  "status",
  "planned_for",
  "call",
  "confidence",
  "note",
  "embedding",
  "conditions",
  "engine",
  "version",
  "deleted_at",
  "created_at",
  "updated_at",
] as const;

const SELECT_COLUMNS = COLUMNS.join(", ");
const RETURNING_ALIASED = `returning ${COLUMNS.map((c) => `s.${c}`).join(", ")}`;
const RETURNING_PLAIN = `returning ${SELECT_COLUMNS}`;

type Row = Record<string, unknown>;

/** Positional parameter builder. Returns the `$n` placeholder for each value. */
class Params {
  readonly values: unknown[] = [];

  push(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

export function rowToRide(row: Row): Ride {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    durationSec: Number(row.duration_sec ?? 0),
    longestRideSec: Number(row.longest_ride_sec ?? 0),
    topSpeedKmh: Number(row.top_speed_kmh ?? 0),
    completed: Boolean(row.completed),
    createdAt: toIso(row.created_at),
  };
}

export function rowToSession(row: Row, rides: Ride[] = []): Session {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    breakId: String(row.break_id),
    status: String(row.status) as SessionStatus,
    plannedFor: toIso(row.planned_for),
    call: (row.call ?? null) as SessionCall,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    note: (row.note ?? null) as string | null,
    embedding: (row.embedding ?? null) as string | null,
    conditions: row.conditions as ConditionsSnapshot,
    engine: row.engine as EngineResult,
    rides,
    version: Number(row.version ?? 1),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  };
}

export function toSummary(session: Session): SessionSummary {
  const hour = session.conditions?.hours?.[0];
  return {
    id: session.id,
    breakId: session.breakId,
    breakName: getBreak(session.breakId)?.name ?? session.breakId,
    status: session.status,
    call: session.call,
    plannedFor: session.plannedFor,
    score: session.engine?.score ?? 0,
    band: session.engine?.band ?? "stay-home",
    swellHeightM: hour?.swellHeightM ?? null,
    swellPeriodS: hour?.swellPeriodS ?? null,
    windSpeedMs: hour?.windSpeedMs ?? null,
    tideM: hour?.tideM ?? null,
    rideCount: session.rides.length,
    longestRideSec: session.rides.reduce((best, ride) => Math.max(best, ride.longestRideSec), 0),
    createdAt: session.createdAt,
  };
}

/* ------------------------------------------------------------------- audit */

interface AuditDraft {
  entityType: "session" | "ride";
  entityId: string;
  action: string;
  ownerId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  prevSeal: string;
  seq: number;
  seal: string;
}

function draftAudit(
  draft: Omit<AuditDraft, "seal">,
): AuditDraft {
  const body = {
    seq: draft.seq,
    entityType: draft.entityType,
    entityId: draft.entityId,
    action: draft.action,
    createdAt: draft.createdAt,
    payload: draft.payload,
  };
  return { ...draft, seal: sealEvent(draft.prevSeal, body) };
}

/** Pushes the nine audit columns and returns their placeholders. */
function pushAuditParams(q: Params, draft: AuditDraft): string[] {
  return [
    q.push(draft.entityType),
    q.push(draft.entityId),
    q.push(draft.seq),
    q.push(draft.action),
    q.push(draft.ownerId),
    q.push(JSON.stringify(draft.payload)),
    q.push(draft.prevSeal),
    q.push(draft.seal),
    q.push(draft.createdAt),
  ];
}

/**
 * Data-modifying CTE that writes the pre-computed audit row, but only when the
 * `target` CTE found the row the caller is allowed to touch.
 */
function auditedCte(p: string[]): string {
  return `audited as (
      insert into audit_events (entity_type, entity_id, seq, action, owner_id, payload, prev_seal, seal, created_at)
      select ${p[0]}::text, ${p[1]}::text, ${p[2]}::int, ${p[3]}::text, ${p[4]}::text,
             ${p[5]}::jsonb, ${p[6]}::text, ${p[7]}::text, ${p[8]}::timestamptz
      where exists (select 1 from target)
      returning entity_id
    )`;
}

async function chainHead(executor: SqlExecutor, entityType: string, entityId: string): Promise<{ seq: number; seal: string }> {
  const rows = await executor.query<Row>(
    `select seq, seal from audit_events
      where entity_type = $1 and entity_id = $2
      order by seq desc limit 1`,
    [entityType, entityId],
  );
  if (rows.length === 0) return { seq: 0, seal: GENESIS_SEAL };
  return { seq: Number(rows[0].seq), seal: String(rows[0].seal) };
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("duplicate key value") || message.includes("23505");
}

/* ---------------------------------------------------------------- sessions */

export interface CreateSessionInput {
  ownerId: string;
  breakId: string;
  plannedFor: string;
  conditions: ConditionsSnapshot;
  engine: EngineResult;
  status?: SessionStatus;
  note?: string | null;
  /** Repeating a key returns the first session instead of creating a second. */
  idempotencyKey?: string | null;
}

export async function findSessionByIdempotencyKey(
  executor: SqlExecutor,
  ownerId: string,
  key: string,
): Promise<Row | null> {
  const rows = await executor.query<Row>(
    `select ${COLUMNS.map((c) => `s.${c}`).join(", ")}
       from sessions s
       join audit_events a on a.entity_type = 'session' and a.entity_id = s.id::text
      where s.owner_id = $1 and a.action = 'session.create' and a.payload->>'idempotencyKey' = $2
      limit 1`,
    [ownerId, key],
  );
  return rows[0] ?? null;
}

export async function createSession(
  executor: SqlExecutor,
  input: CreateSessionInput,
): Promise<{ row: Row; audit: AuditDraft }> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const status = input.status ?? "planned";
  const audit = draftAudit({
    entityType: "session",
    entityId: id,
    action: "session.create",
    ownerId: input.ownerId,
    seq: 1,
    prevSeal: GENESIS_SEAL,
    createdAt,
    payload: {
      breakId: input.breakId,
      plannedFor: input.plannedFor,
      status,
      score: input.engine?.score ?? 0,
      band: input.engine?.band ?? "stay-home",
      engineVersion: input.engine?.version ?? null,
      engineSeal: input.engine?.seal ?? null,
      snapshotDate: input.conditions?.date ?? null,
      snapshotStatus: input.conditions?.status ?? null,
      sourceStatus: input.conditions?.status === "live" ? "live" : "declared",
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  const q = new Params();
  const idP = q.push(id);
  const ownerP = q.push(input.ownerId);
  const breakP = q.push(input.breakId);
  const statusP = q.push(status);
  const plannedP = q.push(input.plannedFor);
  const noteP = q.push(input.note ?? null);
  const conditionsP = q.push(JSON.stringify(input.conditions));
  const engineP = q.push(JSON.stringify(input.engine));
  const createdP = q.push(createdAt);
  const auditParams = pushAuditParams(q, audit);

  const rows = await executor.query<Row>(
    `with target as (
       select ${idP}::uuid as id where true
     ),
     ${auditedCte(auditParams)}
     insert into sessions (id, owner_id, break_id, status, planned_for, note, conditions, engine, created_at, updated_at)
     select id, ${ownerP}, ${breakP}, ${statusP}, ${plannedP}::timestamptz, ${noteP},
            ${conditionsP}::jsonb, ${engineP}::jsonb, ${createdP}::timestamptz, ${createdP}::timestamptz
       from target
      where exists (select 1 from audited)
     ${RETURNING_PLAIN}`,
    q.values,
  );
  const row = rows[0];
  if (!row) throw new Error("create_session inserted no row");
  return { row, audit };
}

export async function getSessionRow(
  executor: SqlExecutor,
  id: string,
  ownerId: string,
  includeDeleted = false,
): Promise<Row | null> {
  const rows = await executor.query<Row>(
    `select ${SELECT_COLUMNS} from sessions
      where id = $1 and owner_id = $2 ${includeDeleted ? "" : "and deleted_at is null"}
      limit 1`,
    [id, ownerId],
  );
  return rows[0] ?? null;
}

export async function getRides(executor: SqlExecutor, sessionId: string, ownerId: string): Promise<Ride[]> {
  const rows = await executor.query<Row>(
    `select id, session_id, duration_sec, longest_ride_sec, top_speed_kmh, completed, created_at
       from rides where session_id = $1 and owner_id = $2 order by created_at asc`,
    [sessionId, ownerId],
  );
  return rows.map(rowToRide);
}

export async function loadSession(
  executor: SqlExecutor,
  id: string,
  ownerId: string,
  includeDeleted = false,
): Promise<Session | null> {
  const row = await getSessionRow(executor, id, ownerId, includeDeleted);
  if (!row) return null;
  return rowToSession(row, await getRides(executor, id, ownerId));
}

export interface ListOptions {
  status?: SessionStatus | null;
  breakId?: string | null;
  limit?: number;
  offset?: number;
}

export async function listSessionRows(
  executor: SqlExecutor,
  ownerId: string,
  options: ListOptions = {},
): Promise<{ rows: Row[]; total: number }> {
  const filters = ["owner_id = $1", "deleted_at is null"];
  const params: unknown[] = [ownerId];
  if (options.status) {
    params.push(options.status);
    filters.push(`status = $${params.length}`);
  }
  if (options.breakId) {
    params.push(options.breakId);
    filters.push(`break_id = $${params.length}`);
  }
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = filters.join(" and ");
  const countRows = await executor.query<{ count: string }>(
    `select count(*)::text as count from sessions where ${where}`,
    [...params],
  );
  const rows = await executor.query<Row>(
    `select ${SELECT_COLUMNS} from sessions where ${where}
      order by planned_for desc, created_at desc
      limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

export interface UpdateSessionInput {
  action: "session.update" | "session.decide" | "session.restore";
  status?: SessionStatus;
  call?: SessionCall;
  confidence?: number | null;
  note?: string | null;
  embedding?: string | null;
}

export async function updateSession(
  executor: SqlExecutor,
  id: string,
  ownerId: string,
  input: UpdateSessionInput,
): Promise<{ row: Row | null; audit: AuditDraft | null; forbidden: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const head = await chainHead(executor, "session", id);
    const updatedAt = new Date().toISOString();
    const audit = draftAudit({
      entityType: "session",
      entityId: id,
      action: input.action,
      ownerId,
      seq: head.seq + 1,
      prevSeal: head.seal,
      createdAt: updatedAt,
      payload: {
        status: input.status ?? null,
        call: input.call ?? null,
        confidence: input.confidence ?? null,
        noteLength: typeof input.note === "string" ? input.note.length : null,
        embeddingStored: input.embedding !== undefined && input.embedding !== null,
        previousSeal: head.seal,
      },
    });

    const q = new Params();
    const idP = q.push(id);
    const ownerP = q.push(ownerId);
    const updatedAtP = q.push(updatedAt);
    const auditParams = pushAuditParams(q, audit);

    const sets: string[] = [`updated_at = ${updatedAtP}::timestamptz`, `version = s.version + 1`];
    if (input.status !== undefined) sets.push(`status = ${q.push(input.status)}`);
    if (input.call !== undefined) sets.push(`call = ${q.push(input.call)}`);
    if (input.confidence !== undefined) sets.push(`confidence = ${q.push(input.confidence)}`);
    if (input.note !== undefined) sets.push(`note = ${q.push(input.note)}`);
    if (input.embedding !== undefined) sets.push(`embedding = ${q.push(input.embedding)}`);

    try {
      const rows = await executor.query<Row>(
        `with target as (
           select id from sessions where id = ${idP}::uuid and owner_id = ${ownerP} and deleted_at is null
         ),
         ${auditedCte(auditParams)}
         update sessions s set ${sets.join(", ")}
          where s.id in (select id from target)
            and exists (select 1 from audited)
         ${RETURNING_ALIASED}`,
        q.values,
      );
      if (rows.length === 0) {
        const exists = await getSessionRow(executor, id, ownerId, true);
        return { row: null, audit: null, forbidden: exists === null };
      }
      return { row: rows[0], audit, forbidden: false };
    } catch (error) {
      if (isUniqueViolation(error) && attempt === 0) continue;
      throw error;
    }
  }
  throw new Error("update_session exhausted retries");
}

/** Soft delete. The row and its chain survive so the history stays replayable. */
export async function deleteSession(
  executor: SqlExecutor,
  id: string,
  ownerId: string,
): Promise<{ row: Row | null; audit: AuditDraft | null }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const head = await chainHead(executor, "session", id);
    const deletedAt = new Date().toISOString();
    const audit = draftAudit({
      entityType: "session",
      entityId: id,
      action: "session.delete",
      ownerId,
      seq: head.seq + 1,
      prevSeal: head.seal,
      createdAt: deletedAt,
      payload: { deletedAt, tombstone: true, previousSeal: head.seal },
    });

    const q = new Params();
    const idP = q.push(id);
    const ownerP = q.push(ownerId);
    const deletedAtP = q.push(deletedAt);
    const auditParams = pushAuditParams(q, audit);

    try {
      const rows = await executor.query<Row>(
        `with target as (
           select id from sessions where id = ${idP}::uuid and owner_id = ${ownerP} and deleted_at is null
         ),
         ${auditedCte(auditParams)}
         update sessions s
            set deleted_at = ${deletedAtP}::timestamptz,
                status = 'skipped',
                updated_at = ${deletedAtP}::timestamptz,
                version = s.version + 1
          where s.id in (select id from target)
            and exists (select 1 from audited)
         ${RETURNING_ALIASED}`,
        q.values,
      );
      if (rows.length === 0) return { row: null, audit: null };
      return { row: rows[0], audit };
    } catch (error) {
      if (isUniqueViolation(error) && attempt === 0) continue;
      throw error;
    }
  }
  throw new Error("delete_session exhausted retries");
}

export interface RideInput {
  durationSec: number;
  longestRideSec: number;
  topSpeedKmh: number;
  completed: boolean;
}

export async function addRide(
  executor: SqlExecutor,
  sessionId: string,
  ownerId: string,
  input: RideInput,
): Promise<{ ride: Ride | null; audit: AuditDraft | null }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const head = await chainHead(executor, "ride", sessionId);
    const createdAt = new Date().toISOString();
    const audit = draftAudit({
      entityType: "ride",
      entityId: sessionId,
      action: "ride.log",
      ownerId,
      seq: head.seq + 1,
      prevSeal: head.seal,
      createdAt,
      payload: {
        durationSec: Math.max(0, Math.round(input.durationSec)),
        longestRideSec: Math.max(0, Math.round(input.longestRideSec)),
        topSpeedKmh: Math.max(0, Number(input.topSpeedKmh.toFixed(2))),
        completed: Boolean(input.completed),
      },
    });

    const q = new Params();
    const sessionP = q.push(sessionId);
    const ownerP = q.push(ownerId);
    const durationP = q.push(Math.max(0, Math.round(input.durationSec)));
    const longestP = q.push(Math.max(0, Math.round(input.longestRideSec)));
    const speedP = q.push(Math.max(0, Number(input.topSpeedKmh.toFixed(2))));
    const completedP = q.push(Boolean(input.completed));
    const createdP = q.push(createdAt);
    const auditParams = pushAuditParams(q, audit);

    try {
      const rows = await executor.query<Row>(
        `with target as (
           select id from sessions where id = ${sessionP}::uuid and owner_id = ${ownerP} and deleted_at is null
         ),
         ${auditedCte(auditParams)}
         insert into rides (owner_id, session_id, duration_sec, longest_ride_sec, top_speed_kmh, completed, created_at)
         select ${ownerP}, id, ${durationP}, ${longestP}, ${speedP}, ${completedP}, ${createdP}::timestamptz
           from target
          where exists (select 1 from audited)
         returning id, session_id, duration_sec, longest_ride_sec, top_speed_kmh, completed, created_at`,
        q.values,
      );
      if (rows.length === 0) return { ride: null, audit: null };
      return { ride: rowToRide(rows[0]), audit };
    } catch (error) {
      if (isUniqueViolation(error) && attempt === 0) continue;
      throw error;
    }
  }
  throw new Error("add_ride exhausted retries");
}

/* --------------------------------------------------------------- integrity */

export async function getAuditChain(
  executor: SqlExecutor,
  entityType: "session" | "ride",
  entityId: string,
  ownerId?: string,
): Promise<AuditEvent[]> {
  const q = new Params();
  const typeP = q.push(entityType);
  const idP = q.push(entityId);
  const ownerFilter = ownerId ? `and owner_id = ${q.push(ownerId)}` : "";
  const rows = await executor.query<Row>(
    `select seq, entity_type, entity_id, action, payload, prev_seal, seal, created_at
       from audit_events
      where entity_type = ${typeP} and entity_id = ${idP} ${ownerFilter}
      order by seq asc`,
    q.values,
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    entityType: String(row.entity_type) as "session" | "ride",
    entityId: String(row.entity_id),
    action: String(row.action) as AuditEvent["action"],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    prevSeal: String(row.prev_seal),
    seal: String(row.seal),
    createdAt: toIso(row.created_at),
  }));
}

/** Recomputes the chain and reports the first broken link, if any. */
export async function verifyChain(
  executor: SqlExecutor,
  entityId: string,
  ownerId?: string,
): Promise<ChainVerification> {
  const events = await getAuditChain(executor, "session", entityId, ownerId);
  if (events.length === 0) {
    return { entityId, ok: true, length: 0, headSeal: null, brokenAt: null, reason: null, events };
  }
  let prev = GENESIS_SEAL;
  for (const event of events) {
    if (event.prevSeal !== prev) {
      return {
        entityId,
        ok: false,
        length: events.length,
        headSeal: events[events.length - 1].seal,
        brokenAt: event.seq,
        reason: `prev_seal at seq ${event.seq} does not equal the seal computed for seq ${event.seq - 1}`,
        events,
      };
    }
    const problem = verifyLink(prev, {
      seq: event.seq,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      createdAt: event.createdAt,
      payload: event.payload,
      seal: event.seal,
    });
    if (problem) {
      return {
        entityId,
        ok: false,
        length: events.length,
        headSeal: events[events.length - 1].seal,
        brokenAt: event.seq,
        reason: problem,
        events,
      };
    }
    prev = event.seal;
  }
  return { entityId, ok: true, length: events.length, headSeal: prev, brokenAt: null, reason: null, events };
}

export async function healthProbe(executor: SqlExecutor): Promise<{ ok: boolean; detail: string }> {
  try {
    const rows = await executor.query<{ probe: number; sessions: string }>(
      `select 1 as probe, (select count(*)::text from sessions) as sessions`,
      [],
    );
    if (!rows[0] || Number(rows[0].probe) !== 1) {
      return { ok: false, detail: "probe did not return 1" };
    }
    return { ok: true, detail: `SELECT 1 succeeded; sessions table holds ${rows[0].sessions} row(s)` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "probe threw" };
  }
}
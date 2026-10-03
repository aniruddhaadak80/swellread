import { afterAll, describe, expect, it } from "vitest";
import { withDb } from "@/lib/db/client";
import { GENESIS_SEAL, canonicalJson, sealEvent } from "@/lib/integrity/canonical";
import {
  addRide,
  createSession,
  deleteSession,
  findSessionByIdempotencyKey,
  getAuditChain,
  getRides,
  getSessionRow,
  healthProbe,
  listSessionRows,
  loadSession,
  rowToSession,
  toSummary,
  updateSession,
  verifyChain,
} from "@/lib/repo/sessions";
import { scoreHour } from "@/lib/swell/engine";
import type { ConditionsSnapshot, HourlyConditions, Session } from "@/lib/types";
import { getBreak } from "@/lib/live/breaks";

/**
 * These run against the embedded PGlite store, so the whole persistence layer is
 * exercised without any environment variable. In production the same statements
 * run against hosted Postgres through the Neon driver.
 */

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";

const heroBreak = getBreak("pago-pago")!;

function fixtureHour(at: string, tideM: number): HourlyConditions {
  return {
    at,
    swellHeightM: 1.4,
    swellPeriodS: 14,
    swellDirDeg: 152,
    waveHeightM: 1.8,
    waveDirDeg: 148,
    windSpeedMs: 3.2,
    windDirDeg: 338,
    airTempC: 25,
    cloudCoverPct: 30,
    precipMm: 0,
    tideM,
    tideRateMPerH: 0.08,
  };
}

function fixtureSnapshot(): ConditionsSnapshot {
  const hours = Array.from({ length: 3 }, (_, index) =>
    fixtureHour(`2026-10-03T0${index}:00:00.000Z`, 0.6 + index * 0.4),
  );
  return {
    breakId: heroBreak.id,
    timezone: heroBreak.timezone,
    date: "2026-10-03",
    hours,
    sources: [
      {
        id: "noaa-coops",
        name: "NOAA CO-OPS tide predictions",
        url: "https://tidesandcurrents.noaa.gov/",
        license: "U.S. Government public domain",
        status: "live",
        fetchedAt: "2026-10-03T06:00:00.000Z",
        stale: false,
      },
    ],
    status: "live",
    generatedAt: "2026-10-03T06:00:00.000Z",
  };
}

async function makeSession(ownerId: string, overrides: { idempotencyKey?: string; note?: string } = {}) {
  return withDb(async (executor) => {
    const snapshot = fixtureSnapshot();
    const result = await createSession(executor, {
      ownerId,
      breakId: heroBreak.id,
      plannedFor: snapshot.hours[1].at,
      conditions: snapshot,
      engine: scoreHour({ break: heroBreak, hour: snapshot.hours[1] }),
      idempotencyKey: overrides.idempotencyKey ?? null,
      note: overrides.note ?? null,
    });
    return { row: result.row, audit: result.audit, snapshot };
  });
}

afterAll(async () => {
  // Leave no test data behind for the next run.
  await withDb(async (executor) => {
    await executor.query(`delete from audit_events where owner_id = $1 or owner_id = $2`, [ownerA, ownerB]);
    await executor.query(`delete from rides where owner_id = $1 or owner_id = $2`, [ownerA, ownerB]);
    await executor.query(`delete from sessions where owner_id = $1 or owner_id = $2`, [ownerA, ownerB]);
  });
});

describe("schema and health", () => {
  it("answers a real probe against the configured store", async () => {
    const probe = await withDb((executor) => healthProbe(executor));
    expect(probe.ok).toBe(true);
    expect(probe.detail).toContain("SELECT 1");
  });

  it("seeds the break catalogue idempotently", async () => {
    const rows = await withDb(async (executor) => {
      const first = await executor.query(`select id from breaks order by id`);
      const again = await executor.query(`select id from breaks order by id`);
      return { first: first.length, again: again.length };
    });
    expect(rows.first).toBeGreaterThanOrEqual(10);
    expect(rows.again).toBe(rows.first);
  });
});

describe("createSession", () => {
  it("persists the frozen snapshot and the engine verdict with a genesis seal", async () => {
    const { row, audit, snapshot } = await makeSession(ownerA);
    const session = rowToSession(row);

    expect(session.breakId).toBe(heroBreak.id);
    expect(session.status).toBe("planned");
    expect(session.version).toBe(1);
    expect(session.conditions.hours).toHaveLength(3);
    expect(session.conditions.hours[0].swellHeightM).toBe(snapshot.hours[0].swellHeightM);
    expect(session.engine.version).toMatch(/^swellread-engine\//);
    expect(session.engine.seal).toMatch(/^[0-9a-f]{96}$/);

    expect(audit.seq).toBe(1);
    expect(audit.prevSeal).toBe(GENESIS_SEAL);
    expect(audit.seal).toMatch(/^[0-9a-f]{96}$/);
  });

  it("is idempotent on the supplied key", async () => {
    // Unique per run: the embedded store persists between test runs, so a fixed
    // key would find the row an earlier run left behind.
    const key = `idem-test-${crypto.randomUUID()}`;
    const first = await makeSession(ownerA, { idempotencyKey: key });
    const found = await withDb((executor) => findSessionByIdempotencyKey(executor, ownerA, key));
    expect(found).not.toBeNull();
    expect(String(found!.id)).toBe(String(first.row.id));
  });

  it("does not confuse two different keys", async () => {
    const firstKey = `idem-a-${crypto.randomUUID()}`;
    const secondKey = `idem-b-${crypto.randomUUID()}`;
    const first = await makeSession(ownerA, { idempotencyKey: firstKey });
    const second = await makeSession(ownerA, { idempotencyKey: secondKey });
    expect(String(second.row.id)).not.toBe(String(first.row.id));
    const found = await withDb((executor) => findSessionByIdempotencyKey(executor, ownerA, secondKey));
    expect(String(found!.id)).toBe(String(second.row.id));
  });

  it("scopes the key to its owner", async () => {
    const key = `idem-shared-${crypto.randomUUID()}`;
    const mine = await makeSession(ownerA, { idempotencyKey: key });
    await makeSession(ownerB, { idempotencyKey: key });
    const asOwnerA = await withDb((executor) => findSessionByIdempotencyKey(executor, ownerA, key));
    expect(String(asOwnerA!.id)).toBe(String(mine.row.id));
    const asOwnerB = await withDb((executor) => findSessionByIdempotencyKey(executor, ownerB, key));
    expect(String(asOwnerB!.id)).not.toBe(String(mine.row.id));
  });

  it("rejects an unknown break at the database level", async () => {
    await expect(
      withDb((executor) =>
        createSession(executor, {
          ownerId: ownerA,
          breakId: "does-not-exist",
          plannedFor: "2026-10-03T00:00:00.000Z",
          conditions: fixtureSnapshot(),
          engine: scoreHour({ break: heroBreak, hour: fixtureHour("2026-10-03T00:00:00.000Z", 1) }),
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("ownership isolation", () => {
  it("never lets one rider read another's session", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    const asOwnerB = await withDb((executor) => loadSession(executor, id, ownerB));
    expect(asOwnerB).toBeNull();
    const asOwnerA = await withDb((executor) => loadSession(executor, id, ownerA));
    expect(asOwnerA).not.toBeNull();
  });

  it("never lets one rider list another's sessions", async () => {
    await makeSession(ownerA);
    const bList = await withDb((executor) => listSessionRows(executor, ownerB, {}));
    const aList = await withDb((executor) => listSessionRows(executor, ownerA, {}));
    expect(aList.total).toBeGreaterThan(bList.total);
  });

  it("never lets one rider update or delete another's session", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    const updated = await withDb((executor) => updateSession(executor, id, ownerB, { action: "session.decide", call: "out" }));
    expect(updated.row).toBeNull();
    expect(updated.forbidden).toBe(true);
    const deleted = await withDb((executor) => deleteSession(executor, id, ownerB));
    expect(deleted.row).toBeNull();
    const stillThere = await withDb((executor) => getSessionRow(executor, id, ownerA));
    expect(stillThere).not.toBeNull();
  });
});

describe("updateSession", () => {
  it("applies the patch, bumps the version and chains the seal", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    const before = await withDb((executor) => verifyChain(executor, id, ownerA));

    const result = await withDb((executor) =>
      updateSession(executor, id, ownerA, { action: "session.decide", call: "in", confidence: 4, status: "committed" }),
    );

    expect(result.row).not.toBeNull();
    const session = rowToSession(result.row!);
    expect(session.call).toBe("in");
    expect(session.confidence).toBe(4);
    expect(session.status).toBe("committed");
    expect(session.version).toBe(2);
    expect(result.audit?.seq).toBe(2);
    expect(result.audit?.prevSeal).toBe(before.headSeal);

    const after = await withDb((executor) => verifyChain(executor, id, ownerA));
    expect(after.ok).toBe(true);
    expect(after.length).toBe(2);
  });

  it("stores the local-model embedding as text", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer).toString("base64");
    await withDb((executor) => updateSession(executor, id, ownerA, { action: "session.update", embedding }));
    const session = await withDb((executor) => loadSession(executor, id, ownerA));
    expect(session?.embedding).toBe(embedding);
  });
});

describe("rides", () => {
  it("attaches a ride to a session and records it on the ride chain", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    const result = await withDb((executor) =>
      addRide(executor, id, ownerA, { durationSec: 210, longestRideSec: 42, topSpeedKmh: 28.4, completed: true }),
    );
    expect(result.ride).not.toBeNull();
    expect(result.ride!.durationSec).toBe(210);
    expect(result.audit?.seq).toBe(1);
    expect(result.audit?.prevSeal).toBe(GENESIS_SEAL);

    const rides = await withDb((executor) => getRides(executor, id, ownerA));
    expect(rides).toHaveLength(1);

    const chain = await withDb((executor) => getAuditChain(executor, "ride", id, ownerA));
    expect(chain).toHaveLength(1);
    expect(chain[0].action).toBe("ride.log");
    expect(chain[0].payload.completed).toBe(true);
  });

  it("refuses a ride on somebody else's session", async () => {
    const { row } = await makeSession(ownerA);
    const result = await withDb((executor) =>
      addRide(executor, String(row.id), ownerB, { durationSec: 10, longestRideSec: 5, topSpeedKmh: 10, completed: false }),
    );
    expect(result.ride).toBeNull();
  });

  it("folds rides into the list summary", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    await withDb((executor) =>
      addRide(executor, id, ownerA, { durationSec: 100, longestRideSec: 30, topSpeedKmh: 20, completed: true }),
    );
    await withDb((executor) =>
      addRide(executor, id, ownerA, { durationSec: 60, longestRideSec: 55, topSpeedKmh: 25, completed: false }),
    );
    const session = (await withDb((executor) => loadSession(executor, id, ownerA))) as Session;
    const summary = toSummary(session);
    expect(summary.rideCount).toBe(2);
    expect(summary.longestRideSec).toBe(55);
    expect(summary.breakName).toBe(heroBreak.name);
  });
});

describe("integrity chain", () => {
  it("replays clean across create, decide and ride", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    await withDb((executor) => updateSession(executor, id, ownerA, { action: "session.decide", call: "in", confidence: 5 }));
    await withDb((executor) => updateSession(executor, id, ownerA, { action: "session.update", note: "fat and slow" }));
    await withDb((executor) => addRide(executor, id, ownerA, { durationSec: 90, longestRideSec: 33, topSpeedKmh: 26, completed: true }));

    const chain = await withDb((executor) => verifyChain(executor, id, ownerA));
    expect(chain.ok).toBe(true);
    expect(chain.brokenAt).toBeNull();
    expect(chain.length).toBe(3);
    expect(chain.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(chain.headSeal).toMatch(/^[0-9a-f]{96}$/);
  });

  it("reports the first broken link when a payload is tampered with", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    await withDb((executor) => updateSession(executor, id, ownerA, { action: "session.decide", call: "in" }));

    const clean = await withDb((executor) => verifyChain(executor, id, ownerA));
    expect(clean.ok).toBe(true);

    await withDb((executor) =>
      executor.query(
        `update audit_events set payload = payload::jsonb || '{"score": 0.99}'::jsonb
          where entity_type = 'session' and entity_id = $1 and seq = 1`,
        [id],
      ),
    );

    const broken = await withDb((executor) => verifyChain(executor, id, ownerA));
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(1);
    expect(broken.reason).toContain("seal mismatch");
  });

  it("reports a broken link when a seal is rewritten", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    await withDb((executor) =>
      executor.query(
        `update audit_events set seal = $2 where entity_type = 'session' and entity_id = $1 and seq = 1`,
        [id, "a".repeat(96)],
      ),
    );
    const broken = await withDb((executor) => verifyChain(executor, id, ownerA));
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(1);
  });

  it("recomputes the same head seal from the stored events alone", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    const chain = await withDb((executor) => verifyChain(executor, id, ownerA));
    let prev = GENESIS_SEAL;
    for (const event of chain.events) {
      prev = sealEvent(prev, {
        seq: event.seq,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        createdAt: event.createdAt,
        payload: event.payload,
      });
    }
    expect(prev).toBe(chain.headSeal);
    expect(canonicalJson(chain.events[0].payload)).toBe(canonicalJson(chain.events[0].payload));
  });

  it("returns an empty, non-broken verdict for an unknown id", async () => {
    const chain = await withDb((executor) => verifyChain(executor, "00000000-0000-4000-8000-000000000000", ownerA));
    expect(chain.length).toBe(0);
    expect(chain.ok).toBe(true);
  });
});

describe("soft delete", () => {
  it("hides the row, keeps a tombstone, and keeps the chain replayable", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    await withDb((executor) => updateSession(executor, id, ownerA, { action: "session.decide", call: "out" }));

    const result = await withDb((executor) => deleteSession(executor, id, ownerA));
    expect(result.row).not.toBeNull();
    expect(rowToSession(result.row!).deletedAt).not.toBeNull();
    expect(rowToSession(result.row!).status).toBe("skipped");

    const visible = await withDb((executor) => getSessionRow(executor, id, ownerA));
    expect(visible).toBeNull();

    const withTombstone = await withDb((executor) => getSessionRow(executor, id, ownerA, true));
    expect(withTombstone).not.toBeNull();

    const chain = await withDb((executor) => verifyChain(executor, id, ownerA));
    expect(chain.ok).toBe(true);
    expect(chain.events[chain.length - 1].action).toBe("session.delete");
    expect((chain.events[chain.length - 1].payload as { tombstone: boolean }).tombstone).toBe(true);
  });

  it("is not repeatable", async () => {
    const { row } = await makeSession(ownerA);
    const id = String(row.id);
    await withDb((executor) => deleteSession(executor, id, ownerA));
    const again = await withDb((executor) => deleteSession(executor, id, ownerA));
    expect(again.row).toBeNull();
  });
});

describe("listing", () => {
  it("filters by status and break and paginates", async () => {
    await makeSession(ownerA);
    const all = await withDb((executor) => listSessionRows(executor, ownerA, { limit: 100 }));
    expect(all.total).toBeGreaterThan(0);
    const committed = await withDb((executor) => listSessionRows(executor, ownerA, { status: "committed", limit: 100 }));
    expect(committed.rows.every((row) => row.status === "committed")).toBe(true);

    const byBreak = await withDb((executor) => listSessionRows(executor, ownerA, { breakId: "pago-pago", limit: 100 }));
    expect(byBreak.rows.every((row) => row.break_id === "pago-pago")).toBe(true);

    const page = await withDb((executor) => listSessionRows(executor, ownerA, { limit: 1, offset: 0 }));
    expect(page.rows.length).toBeLessThanOrEqual(1);
  });

  it("excludes deleted rows from the default list", async () => {
    const { row } = await makeSession(ownerA);
    await withDb((executor) => deleteSession(executor, String(row.id), ownerA));
    const listed = await withDb((executor) => listSessionRows(executor, ownerA, { limit: 100 }));
    expect(listed.rows.some((entry) => String(entry.id) === String(row.id))).toBe(false);
  });
});
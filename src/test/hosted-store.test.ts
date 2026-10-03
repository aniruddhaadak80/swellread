import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDb, storeMode } from "@/lib/db/client";
import { addRide, createSession, loadSession, verifyChain } from "@/lib/repo/sessions";
import { getBreak } from "@/lib/live/breaks";
import { scoreHour } from "@/lib/swell/engine";
import type { ConditionsSnapshot, HourlyConditions } from "@/lib/types";

/**
 * Exercises the hosted Postgres path.
 *
 * The repository's statements are written with `$1`-style placeholders so the same
 * text runs on the embedded adapter and on Neon. This suite is the only thing
 * that proves the Neon driver is fed those placeholders correctly, so it runs
 * whenever DATABASE_URL is present and is skipped otherwise (CI, contributors
 * with no database).
 *
 * Run it against a real database with:
 *   $env:DATABASE_URL = "postgresql://..."
 *   npm test
 */

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
const describeIfHosted = databaseUrl ? describe : describe.skip;

const owner = "77777777-7777-4777-8777-777777777777";
const heroBreak = getBreak("pago-pago")!;

function fixture(): { conditions: ConditionsSnapshot; engine: ReturnType<typeof scoreHour> } {
  const hour: HourlyConditions = {
    at: "2026-10-03T06:00:00.000Z",
    swellHeightM: 1.6,
    swellPeriodS: 15,
    swellDirDeg: 155,
    waveHeightM: 2,
    waveDirDeg: 150,
    windSpeedMs: 2.4,
    windDirDeg: 340,
    airTempC: 25,
    cloudCoverPct: 20,
    precipMm: 0,
    tideM: 1.2,
    tideRateMPerH: 0.1,
  };
  return {
    conditions: {
      breakId: heroBreak.id,
      timezone: heroBreak.timezone,
      date: "2026-10-03",
      hours: [hour],
      sources: [],
      status: "live",
      generatedAt: "2026-10-03T06:00:00.000Z",
    },
    engine: scoreHour({ break: heroBreak, hour }),
  };
}

describeIfHosted("hosted Postgres (Neon) adapter", () => {
  let createdId = "";

  beforeAll(async () => {
    expect(storeMode()).toBe("memory"); // in-memory unless forced; the store is chosen by DATABASE_URL
    const probe = await withDb(async (executor) => {
      const rows = await executor.query<{ one: number; version: string }>(
        "select 1 as one, version() as version",
      );
      return rows[0];
    });
    expect(Number(probe?.one)).toBe(1);
    expect(String(probe?.version)).toMatch(/PostgreSQL/i);
  }, 60_000);

  afterAll(async () => {
    await withDb(async (executor) => {
      await executor.query(`delete from audit_events where owner_id = $1`, [owner]);
      await executor.query(`delete from rides where owner_id = $1`, [owner]);
      await executor.query(`delete from sessions where owner_id = $1`, [owner]);
    });
  });

  it("seeds the catalogue through the hosted path", async () => {
    const rows = await withDb((executor) =>
      executor.query<{ id: string }>("select id from breaks order by id"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
  }, 60_000);

  it("creates, reads, updates and seals a session", async () => {
    const { conditions, engine } = fixture();
    const created = await withDb(async (executor) => {
      const result = await createSession(executor, {
        ownerId: owner,
        breakId: heroBreak.id,
        plannedFor: conditions.hours[0].at,
        conditions,
        engine,
        note: "hosted store test",
        idempotencyKey: `hosted-${Date.now()}`,
      });
      return result;
    });
    createdId = String(created.row.id);
    expect(created.audit.seal).toMatch(/^[0-9a-f]{96}$/);

    const session = await withDb((executor) => loadSession(executor, createdId, owner));
    expect(session?.conditions.hours[0].swellHeightM).toBe(1.6);
    expect(session?.engine.seal).toBe(engine.seal);
    expect(session?.note).toBe("hosted store test");

    const chain = await withDb((executor) => verifyChain(executor, createdId, owner));
    expect(chain.ok).toBe(true);
    expect(chain.length).toBe(1);
  }, 60_000);

  it("preserves jsonb columns round-tripping through the driver", async () => {
    const rows = await withDb((executor) =>
      executor.query<{ conditions: unknown; engine: unknown }>(
        "select conditions, engine from sessions where id = $1 and owner_id = $2",
        [createdId, owner],
      ),
    );
    const conditions = rows[0]?.conditions as ConditionsSnapshot;
    expect(Array.isArray(conditions.hours)).toBe(true);
    expect(conditions.hours[0].tideM).toBe(1.2);
  }, 60_000);

  it("logs a ride and keeps the ride chain separate", async () => {
    const ride = await withDb((executor) =>
      addRide(executor, createdId, owner, { durationSec: 180, longestRideSec: 40, topSpeedKmh: 27.5, completed: true }),
    );
    expect(ride.ride?.durationSec).toBe(180);
    expect(ride.audit?.prevSeal).toBe("0".repeat(96));

    const sessionChain = await withDb((executor) => verifyChain(executor, createdId, owner));
    expect(sessionChain.length).toBe(1);
  }, 60_000);

  it("rejects a uuid parameter that is not a uuid, proving parameters are typed", async () => {
    await expect(
      withDb((executor) => executor.query("select 1 as one where $1::uuid = $1::uuid", ["not-a-uuid"])),
    ).rejects.toThrow();
  }, 60_000);
});
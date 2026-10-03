import { PGlite } from "@electric-sql/pglite";
import { NodeFS } from "@electric-sql/pglite/nodefs";
import { neon } from "@neondatabase/serverless";
import { LOCAL_STORE_DIR, resolveStore, type StoreResolution } from "@/lib/db/store";
import { mkdirSync } from "node:fs";

/**
 * One SQL surface, two drivers.
 *
 * Both embedded PGlite and the Neon serverless driver speak `$1`-style positional
 * parameters against real Postgres, so every statement in the repository is
 * written once. Writes that must be atomic are single statements with CTEs.
 */

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  kind: "neon" | "pglite";
}

interface PgliteExecutor extends SqlExecutor {
  kind: "pglite";
  raw: PGlite;
}

interface NeonExecutor extends SqlExecutor {
  kind: "neon";
}

/**
 * Tests get an in-memory database. PGlite is single-connection, and vitest runs
 * test files in parallel processes, so two files sharing one directory on disk
 * collide. A memory store also removes the ordering dependence entirely.
 *
 * `SWELLREAD_STORE=file` forces the on-disk path even under tests, which is how
 * the persistent adapter gets exercised without two processes sharing it.
 */
export function storeMode(): "memory" | "file" {
  const forced = process.env.SWELLREAD_STORE;
  if (forced === "file") return "file";
  if (forced === "memory") return "memory";
  return process.env.VITEST ? "memory" : "file";
}

function pgliteExecutor(): PgliteExecutor {
  let db: PGlite;
  if (storeMode() === "memory") {
    db = new PGlite();
  } else {
    // An explicit Node filesystem is required to persist to a directory. Without
    // it the bundled browser build is selected, which hands a URL to a node:path
    // helper and throws on first use.
    mkdirSync(LOCAL_STORE_DIR, { recursive: true });
    db = new PGlite({ dataDir: LOCAL_STORE_DIR, fs: new NodeFS(LOCAL_STORE_DIR) });
  }
  return {
    kind: "pglite",
    raw: db,
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(sql, params);
      return result.rows;
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
  };
}

function neonExecutor(databaseUrl: string): NeonExecutor {
  const sql = neon(databaseUrl);

  // `sql.query(text, params)` is the driver's documented entry point for a raw
  // statement with `$1`-style placeholders. The tagged-template form is only for
  // literal queries: its own interpolation pass rewrites the statement and drops
  // or merges placeholders, which silently corrupts every parameterised statement
  // in the repository. Every query here is built as text with placeholders, so it
  // must go through `query()`.
  async function run(statement: string, params: unknown[]): Promise<unknown[]> {
    const rows = params.length > 0 ? await sql.query(statement, params) : await sql.query(statement);
    return Array.isArray(rows) ? (rows as unknown[]) : [];
  }

  return {
    kind: "neon",
    async query<T>(statement: string, params: unknown[] = []): Promise<T[]> {
      return (await run(statement, params)) as T[];
    },
    async exec(statement: string): Promise<void> {
      await run(statement, []);
    },
  };
}

interface Pooled {
  executor: SqlExecutor;
  ready: Promise<void>;
  resolution: StoreResolution;
}

declare global {
  var __swellreadDb: Pooled | undefined;
}

async function initialise(executor: SqlExecutor): Promise<void> {
  const { SCHEMA_STATEMENTS } = await import("@/lib/db/schema");
  for (const statement of SCHEMA_STATEMENTS) {
    try {
      await executor.exec(statement);
    } catch (error) {
      // Name the failing statement. This only ever reaches the server log or the
      // health probe, never a stack trace to a client.
      throw new Error(
        `schema statement failed [${statement.slice(0, 90).replace(/\s+/g, " ")}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  try {
    await import("@/lib/db/seed").then((module) => module.seedBreaks(executor));
  } catch (error) {
    throw new Error(
      `seeding failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getDb(): Promise<Pooled> {
  if (globalThis.__swellreadDb) return globalThis.__swellreadDb;
  const resolution = resolveStore();
  const executor = resolution.kind === "neon" && resolution.databaseUrl
    ? neonExecutor(resolution.databaseUrl)
    : pgliteExecutor();
  const ready = initialise(executor);
  const pooled: Pooled = { executor, ready, resolution };
  globalThis.__swellreadDb = pooled;
  return pooled;
}

export async function withDb<T>(fn: (executor: SqlExecutor, resolution: StoreResolution) => Promise<T>): Promise<T> {
  const pooled = await getDb();
  await pooled.ready;
  return fn(pooled.executor, pooled.resolution);
}
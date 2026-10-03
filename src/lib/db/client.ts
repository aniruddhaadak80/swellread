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
 */
function isEphemeral(): boolean {
  return Boolean(process.env.VITEST) || process.env.SWELLREAD_STORE === "memory";
}

function pgliteExecutor(): PgliteExecutor {
  let db: PGlite;
  if (isEphemeral()) {
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
  // The driver only exposes a tagged-template signature, so it is retyped here as
  // a plain call: `query` and `exec` below are the only callers, and both build
  // their own strings array with the exact values they passed in.
  const sql = neon(databaseUrl) as unknown as (...args: unknown[]) => Promise<unknown>;
  return {
    kind: "neon",
    async query<T>(statement: string, params: unknown[] = []): Promise<T[]> {
      const strings = Object.assign([statement], { raw: [statement] }) as unknown as TemplateStringsArray;
      const rows = (await sql(strings, ...params)) as T[];
      return Array.isArray(rows) ? rows : [];
    },
    async exec(statement: string): Promise<void> {
      const strings = Object.assign([statement], { raw: [statement] }) as unknown as TemplateStringsArray;
      await sql(strings);
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
    await executor.exec(statement);
  }
  await import("@/lib/db/seed").then((module) => module.seedBreaks(executor));
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
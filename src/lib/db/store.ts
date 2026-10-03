/**
 * Persistence selection.
 *
 * Production must use a hosted Postgres. Local development and tests fall back to
 * an embedded PGlite database so the project runs with zero environment
 * variables. Selecting the embedded store in production is treated as a
 * configuration error, not a convenience.
 */

export type StoreKind = "neon" | "pglite";

export interface StoreResolution {
  kind: StoreKind;
  databaseUrl: string | null;
  /** Present only when the embedded store was deliberately allowed. */
  warning: string | null;
}

const LOCAL_DATA_DIR = ".data/pglite";

function hostedUrl(): string | null {
  const candidates = [process.env.DATABASE_URL, process.env.POSTGRES_URL];
  for (const value of candidates) {
    if (typeof value === "string" && /^postgres(ql)?:\/\//i.test(value.trim()) && value.trim().length > 20) {
      return value.trim();
    }
  }
  return null;
}

export function resolveStore(): StoreResolution {
  const url = hostedUrl();
  if (url) return { kind: "neon", databaseUrl: url, warning: null };

  const isProduction = process.env.NODE_ENV === "production";
  const allowed = process.env.SWELLREAD_ALLOW_LOCAL_STORE === "1";

  if (isProduction && !allowed) {
    throw new Error(
      "Swellread refuses to start in production without DATABASE_URL. Point it at a hosted Postgres, or set SWELLREAD_ALLOW_LOCAL_STORE=1 to knowingly use the embedded store.",
    );
  }
  return {
    kind: "pglite",
    databaseUrl: null,
    warning: isProduction
      ? "Embedded store explicitly allowed by SWELLREAD_ALLOW_LOCAL_STORE=1. Data will not survive a redeploy."
      : `Embedded PGlite store at ${LOCAL_DATA_DIR}. Set DATABASE_URL to use a hosted Postgres.`,
  };
}

export const LOCAL_STORE_DIR = LOCAL_DATA_DIR;

export function storeLabel(resolution: StoreResolution): string {
  return resolution.kind === "neon"
    ? "Hosted Postgres (Neon serverless driver)"
    : "Embedded PGlite (local only)";
}
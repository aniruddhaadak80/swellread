import { NextResponse } from "next/server";
import { withDb } from "@/lib/db/client";
import { storeLabel } from "@/lib/db/store";
import { healthProbe } from "@/lib/repo/sessions";
import { ENGINE_VERSION } from "@/lib/swell/engine";
import { site } from "@/config/site";

export const dynamic = "force-dynamic";

/**
 * Health check that actually touches the configured production store.
 * A static `{ ok: true }` here would be worthless, so the probe runs a query.
 */
export async function GET() {
  const started = Date.now();
  try {
    const result = await withDb(async (executor, resolution) => {
      const probe = await healthProbe(executor);
      return { probe, kind: resolution.kind, label: storeLabel(resolution), warning: resolution.warning };
    });
    const body = {
      ok: result.probe.ok,
      service: site.name,
      engine: ENGINE_VERSION,
      store: {
        kind: result.kind,
        label: result.label,
        productionStore: result.kind === "neon",
        warning: result.warning,
      },
      persistence: { probe: result.probe.detail },
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: result.probe.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: site.name,
        store: { kind: "unknown", productionStore: false },
        persistence: { probe: error instanceof Error ? error.message : "store unreachable" },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
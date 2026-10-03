import { NextResponse } from "next/server";
import { getBreak } from "@/lib/live/breaks";
import { analyseBreak } from "@/lib/services/analysis";
import { EngineQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ error: { code: "invalid_query", message } }, { status: 400 });
}

/** GET /api/engine?breakId=&hour=&date=&tideM= — the verdict for one real hour. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = EngineQuerySchema.safeParse({
    breakId: url.searchParams.get("breakId"),
    date: url.searchParams.get("date") ?? undefined,
    hour: url.searchParams.get("hour") ?? 0,
    tideM: url.searchParams.get("tideM") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest("breakId is required; hour 0-23, date YYYY-MM-DD, tideM -1..8");
  }
  if (!getBreak(parsed.data.breakId)) {
    return NextResponse.json(
      { error: { code: "break_not_found", message: `No break with id "${parsed.data.breakId}".` } },
      { status: 404 },
    );
  }
  try {
    const analysis = await analyseBreak(parsed.data);
    return NextResponse.json({
      at: analysis.hour.at,
      localLabel: analysis.points[parsed.data.hour]?.localLabel ?? null,
      whatIf: analysis.whatIf,
      engine: analysis.engine,
      derived: analysis.engine.derived,
      window: analysis.engine.window,
      hour: analysis.hour,
      snapshotStatus: analysis.status,
      tideBounds: analysis.tideBounds,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "engine_failed", message: error instanceof Error ? error.message : "engine failed" } },
      { status: 502 },
    );
  }
}

/**
 * POST /api/engine — the tide-drag what-if.
 *
 * Body is a JSON object; the tide override is applied to the engine input only
 * and is never written back to stored data.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON.");
  }
  const parsed = EngineQuerySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Body needs breakId; tideM is a what-if height in metres.");
  }
  if (parsed.data.tideM === undefined) {
    return badRequest("POST /api/engine needs a tideM what-if value. Use GET for the real hour.");
  }
  if (!getBreak(parsed.data.breakId)) {
    return NextResponse.json(
      { error: { code: "break_not_found", message: `No break with id "${parsed.data.breakId}".` } },
      { status: 404 },
    );
  }
  try {
    const analysis = await analyseBreak(parsed.data);
    return NextResponse.json({
      at: analysis.hour.at,
      whatIf: analysis.whatIf,
      engine: analysis.engine,
      derived: analysis.engine.derived,
      snapshotStatus: analysis.status,
      tideBounds: analysis.tideBounds,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "engine_failed", message: error instanceof Error ? error.message : "engine failed" } },
      { status: 502 },
    );
  }
}
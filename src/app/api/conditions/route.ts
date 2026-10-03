import { NextResponse } from "next/server";
import { getBreak } from "@/lib/live/breaks";
import { analyseBreak } from "@/lib/services/analysis";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Query = z.object({
  breakId: z.string().min(2).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.coerce.number().int().min(0).max(23).default(0),
});

/**
 * Normalised live conditions plus the whole day's scores.
 * Falls back to the sealed offline sample when every upstream is unreachable,
 * and says so in `status` and in every entry of `sources`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = Query.safeParse({
    breakId: url.searchParams.get("breakId"),
    date: url.searchParams.get("date") ?? undefined,
    hour: url.searchParams.get("hour") ?? 0,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "breakId is required, plus optional date=YYYY-MM-DD and hour=0-23" } },
      { status: 400 },
    );
  }
  const surfBreak = getBreak(parsed.data.breakId);
  if (!surfBreak) {
    return NextResponse.json(
      { error: { code: "break_not_found", message: `No break with id "${parsed.data.breakId}".` } },
      { status: 404 },
    );
  }
  try {
    const analysis = await analyseBreak(parsed.data);
    return NextResponse.json({
      break: analysis.break,
      snapshot: analysis.snapshot,
      tide: analysis.tide,
      status: analysis.status,
      points: analysis.points,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "conditions_failed", message: error instanceof Error ? error.message : "conditions failed" } },
      { status: 502 },
    );
  }
}
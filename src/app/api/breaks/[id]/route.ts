import { NextResponse } from "next/server";
import { getBreak } from "@/lib/live/breaks";
import { analyseBreak } from "@/lib/services/analysis";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.coerce.number().int().min(0).max(23).default(0),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const surfBreak = getBreak(id);
  if (!surfBreak) {
    return NextResponse.json(
      { error: { code: "break_not_found", message: `No break with id "${id}".` } },
      { status: 404 },
    );
  }
  const url = new URL(request.url);
  const parsed = Query.safeParse({
    date: url.searchParams.get("date") ?? undefined,
    hour: url.searchParams.get("hour") ?? 0,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: parsed.error.issues[0]?.message ?? "bad query" } },
      { status: 400 },
    );
  }
  try {
    const analysis = await analyseBreak({ breakId: id, ...parsed.data });
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json(
      { error: { code: "analysis_failed", message: error instanceof Error ? error.message : "analysis failed" } },
      { status: 502 },
    );
  }
}
import { NextResponse } from "next/server";
import { currentOwnerId } from "@/lib/session/owner";
import { buildBrief, ServiceError } from "@/lib/services/sessions";

export const dynamic = "force-dynamic";

/**
 * The takeaway artifact.
 *
 * `?format=json` downloads a file; the default returns the same payload the
 * /export route renders as a printable brief.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ownerId = await currentOwnerId();
  try {
    const brief = await buildBrief(ownerId, id);
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "json") {
      return new NextResponse(JSON.stringify(brief, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="swellread-brief-${id}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    return NextResponse.json(brief, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ error: { code: "internal_error", message: "The brief could not be built." } }, { status: 500 });
  }
}
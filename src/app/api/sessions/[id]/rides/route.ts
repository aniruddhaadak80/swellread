import { NextResponse } from "next/server";
import { currentOwnerId } from "@/lib/session/owner";
import { recordRide, ServiceError } from "@/lib/services/sessions";
import { RideSchema, firstIssue } from "@/lib/validation";
import { clientKey, rateLimit, sweepRateWindows } from "@/lib/rate";

export const dynamic = "force-dynamic";

/** Records a ride from the WebGL lab. Same write path the lab's save button uses. */
export async function POST(request: Request, context: { params: Promise< { id: string }> }) {
  sweepRateWindows();
  const verdict = rateLimit(clientKey(request, "rides:create"), 30, 60_000);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many rides from this client." } },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
    );
  }
  const { id } = await context.params;
  const ownerId = await currentOwnerId();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_body", message: "Body must be JSON." } }, { status: 400 });
  }
  const parsed = RideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: firstIssue(parsed.error) } }, { status: 400 });
  }
  try {
    const result = await recordRide(ownerId, id, parsed.data);
    return NextResponse.json(
      { ride: result.ride, session: result.session, audit: { seal: result.seal } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ error: { code: "internal_error", message: "The ride could not be saved." } }, { status: 500 });
  }
}
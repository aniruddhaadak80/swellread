import { NextResponse } from "next/server";
import { currentOwnerId } from "@/lib/session/owner";
import { changeSession, dropSession, readSessionWithTombstone, ServiceError } from "@/lib/services/sessions";
import { UpdateSessionSchema, firstIssue } from "@/lib/validation";
import { clientKey, rateLimit, sweepRateWindows } from "@/lib/rate";

export const dynamic = "force-dynamic";

function fail(error: unknown) {
  if (error instanceof ServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "internal_error", message: "The request failed." } }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ownerId = await currentOwnerId();
  const session = await readSessionWithTombstone(ownerId, id);
  if (!session) {
    return NextResponse.json({ error: { code: "session_not_found", message: "No such session in this browser." } }, { status: 404 });
  }
  return NextResponse.json({ session, tombstone: Boolean(session.deletedAt) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  sweepRateWindows();
  const verdict = rateLimit(clientKey(request, "sessions:update"), 40, 60_000);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many updates from this client." } },
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
  const parsed = UpdateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: firstIssue(parsed.error) } }, { status: 400 });
  }
  try {
    const result = await changeSession(ownerId, id, parsed.data);
    return NextResponse.json({ session: result.session, audit: { seq: result.seq, seal: result.seal } });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  sweepRateWindows();
  const verdict = rateLimit(clientKey(request, "sessions:delete"), 20, 60_000);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many deletes from this client." } },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
    );
  }
  const { id } = await context.params;
  const ownerId = await currentOwnerId();
  try {
    const result = await dropSession(ownerId, id);
    return NextResponse.json({
      sessionId: result.session.id,
      deletedAt: result.session.deletedAt,
      tombstone: true,
      audit: { seq: result.seq, seal: result.seal },
    });
  } catch (error) {
    return fail(error);
  }
}
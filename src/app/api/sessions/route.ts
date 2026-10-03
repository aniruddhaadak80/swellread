import { NextResponse } from "next/server";
import { currentOwnerId } from "@/lib/session/owner";
import { planSession, readSessions, ServiceError } from "@/lib/services/sessions";
import { CreateSessionSchema, ListQuerySchema, firstIssue } from "@/lib/validation";
import { clientKey, rateLimit, sweepRateWindows } from "@/lib/rate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ownerId = await currentOwnerId();
  const url = new URL(request.url);
  const parsed = ListQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    breakId: url.searchParams.get("breakId") ?? undefined,
    limit: url.searchParams.get("limit") ?? 25,
    offset: url.searchParams.get("offset") ?? 0,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_query", message: firstIssue(parsed.error) } }, { status: 400 });
  }
  const page = await readSessions(ownerId, parsed.data);
  return NextResponse.json(page);
}

export async function POST(request: Request) {
  sweepRateWindows();
  const verdict = rateLimit(clientKey(request, "sessions:create"), 20, 60_000);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many sessions from this client. Try again shortly." } },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
    );
  }
  const ownerId = await currentOwnerId();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_body", message: "Body must be JSON." } }, { status: 400 });
  }
  const parsed = CreateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: firstIssue(parsed.error) } }, { status: 400 });
  }
  try {
    const result = await planSession(ownerId, parsed.data);
    return NextResponse.json(
      { session: result.session, audit: { seq: result.seq, seal: result.seal, replayed: result.replayed } },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { error: { code: "create_failed", message: "The session could not be created." } },
      { status: 500 },
    );
  }
}
import { NextResponse } from "next/server";
import { currentOwnerId } from "@/lib/session/owner";
import { verifySessionChain } from "@/lib/services/sessions";

export const dynamic = "force-dynamic";

/** Recomputes a session's SHA-384 chain from genesis and reports the first break. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ownerId = await currentOwnerId();
  const chain = await verifySessionChain(ownerId, id);
  if (chain.length === 0) {
    return NextResponse.json(
      { error: { code: "chain_not_found", message: "No audit chain for that session in this browser." } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ...chain,
    algorithm: "seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )",
    genesis: "0".repeat(96),
    canonicalJson: "object keys sorted recursively by code unit, arrays in order, no insignificant whitespace",
  });
}
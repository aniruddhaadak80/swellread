import { NextResponse } from "next/server";
import { currentOwnerId } from "@/lib/session/owner";
import { handleBatch, PROTOCOL_VERSION, serverInfo, TOOLS } from "@/lib/mcp/server";
import { clientKey, rateLimit, sweepRateWindows } from "@/lib/rate";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

/** Discovery document, so a human can point an MCP client here. */
export async function GET() {
  return NextResponse.json({
    protocolVersion: PROTOCOL_VERSION,
    transport: "http",
    endpoint: "/api/mcp",
    serverInfo: serverInfo(),
    tools: TOOLS.map((tool) => ({ name: tool.name, title: tool.title, readOnly: tool.annotations.readOnlyHint })),
    usage: {
      initialize: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      toolsList: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      toolsCall: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "analyse_break", arguments: { breakId: "pago-pago", hour: 8 } },
      },
    },
  });
}

/** JSON-RPC 2.0 over HTTP. Accepts a single message or a batch. */
export async function POST(request: Request) {
  sweepRateWindows();
  const verdict = rateLimit(clientKey(request, "mcp"), 120, 60_000);
  if (!verdict.allowed) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Rate limited. Try again shortly." } },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Message too large." } },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Body is not valid JSON." } },
      { status: 400 },
    );
  }

  const ownerId = await currentOwnerId();
  const responses = await handleBatch(body, ownerId);
  if (responses.length === 0) {
    // Notification only: JSON-RPC says answer with nothing.
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], {
    headers: { "cache-control": "no-store" },
  });
}
import { afterAll, describe, expect, it } from "vitest";
import { TOOLS, handleBatch, handleRpc, serverInfo, PROTOCOL_VERSION } from "@/lib/mcp/server";
import { withDb } from "@/lib/db/client";
import { createSession } from "@/lib/repo/sessions";
import { getBreak } from "@/lib/live/breaks";
import { scoreHour } from "@/lib/swell/engine";
import type { ConditionsSnapshot, HourlyConditions } from "@/lib/types";

const owner = "44444444-4444-4444-8444-444444444444";
const heroBreak = getBreak("pago-pago")!;

function fixture(): { conditions: ConditionsSnapshot; engine: ReturnType<typeof scoreHour> } {
  const hour: HourlyConditions = {
    at: "2026-10-03T06:00:00.000Z",
    swellHeightM: 1.5,
    swellPeriodS: 15,
    swellDirDeg: 155,
    waveHeightM: 1.9,
    waveDirDeg: 150,
    windSpeedMs: 2.5,
    windDirDeg: 340,
    airTempC: 25,
    cloudCoverPct: 20,
    precipMm: 0,
    tideM: 1.2,
    tideRateMPerH: 0.1,
  };
  return {
    conditions: {
      breakId: heroBreak.id,
      timezone: heroBreak.timezone,
      date: "2026-10-03",
      hours: [hour],
      sources: [],
      status: "live",
      generatedAt: "2026-10-03T06:00:00.000Z",
    },
    engine: scoreHour({ break: heroBreak, hour }),
  };
}

async function seedSession(idempotencyKey: string) {
  return withDb(async (executor) => {
    const { conditions, engine } = fixture();
    const { row } = await createSession(executor, {
      ownerId: owner,
      breakId: heroBreak.id,
      plannedFor: conditions.hours[0].at,
      conditions,
      engine,
      idempotencyKey,
    });
    return String(row.id);
  });
}

afterAll(async () => {
  await withDb(async (executor) => {
    await executor.query(`delete from audit_events where owner_id = $1`, [owner]);
    await executor.query(`delete from rides where owner_id = $1`, [owner]);
    await executor.query(`delete from sessions where owner_id = $1`, [owner]);
  });
});

describe("initialize", () => {
  it("returns a protocol version, capabilities and server info", async () => {
    const response = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, owner);
    expect(response?.id).toBe(1);
    expect(response?.error).toBeUndefined();
    const result = response?.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string; repository: string } };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("Swellread");
    expect(result.serverInfo.repository).toContain("github.com/aniruddhaadak80/swellread");
  });

  it("answers nothing to a notification", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, owner)).toBeNull();
    expect(await handleRpc({ jsonrpc: "2.0", method: "ping" }, owner)).toBeNull();
  });

  it("rejects a missing or wrong jsonrpc version", async () => {
    expect((await handleRpc({ id: 1, method: "ping" }, owner))?.error?.code).toBe(-32600);
    expect((await handleRpc({ jsonrpc: "1.0", id: 1, method: "ping" }, owner))?.error?.code).toBe(-32600);
  });

  it("rejects a message with no method", async () => {
    const response = await handleRpc({ jsonrpc: "2.0", id: 7 }, owner);
    expect(response?.error?.code).toBe(-32600);
  });
});

describe("tools/list", () => {
  it("advertises the read, analysis and mutating tools with JSON Schemas", async () => {
    const response = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, owner);
    const result = response?.result as { tools: Array<{ name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean } }> };
    const names = result.tools.map((tool) => tool.name);
    expect(names).toEqual(TOOLS.map((tool) => tool.name));
    expect(names).toContain("get_conditions");
    expect(names).toContain("analyse_break");
    expect(names).toContain("create_session");
    expect(names).toContain("decide_session");
    expect(names).toContain("log_ride");
    expect(names).toContain("delete_session");
    expect(names).toContain("verify_integrity");

    const readOnly = result.tools.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name);
    const mutating = result.tools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name);
    expect(readOnly.length).toBeGreaterThanOrEqual(3);
    expect(mutating.length).toBeGreaterThanOrEqual(3);
    for (const tool of result.tools) {
      expect((tool.inputSchema as { type: string }).type).toBe("object");
    }
  });
});

describe("tools/call read paths", () => {
  it("lists breaks from the catalogue", async () => {
    const response = await handleRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_breaks", arguments: {} } },
      owner,
    );
    const result = response?.result as { structuredContent: { count: number; breaks: Array<{ id: string; tideStation: unknown }> } };
    expect(result.structuredContent.count).toBeGreaterThanOrEqual(10);
    const pago = result.structuredContent.breaks.find((item) => item.id === "pago-pago");
    expect(pago?.tideStation).toMatchObject({ id: "1770000" });
    const kovalam = result.structuredContent.breaks.find((item) => item.id === "kovalam");
    expect(kovalam?.tideStation).toBeNull();
  });

  it("wraps the payload as text content plus structured content", async () => {
    const response = await handleRpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_breaks", arguments: {} } },
      owner,
    );
    const result = response?.result as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.content[0].type).toBe("text");
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    expect(result.isError).toBe(false);
  });

  it("returns method-not-found for an unknown tool", async () => {
    const response = await handleRpc(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "rm_rf", arguments: {} } },
      owner,
    );
    expect(response?.error?.code).toBe(-32601);
  });

  it("returns invalid-params when arguments do not match the schema", async () => {
    const response = await handleRpc(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "analyse_break", arguments: { breakId: "pago-pago", hour: 99 } } },
      owner,
    );
    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("hour");
  });

  it("returns invalid-params when a tool name is missing entirely", async () => {
    const response = await handleRpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: {} }, owner);
    expect(response?.error?.code).toBe(-32602);
  });
});

describe("tools/call mutating paths", () => {
  it("decides a session and reports the new chain seal", async () => {
    const sessionId = await seedSession(`mcp-decide-${crypto.randomUUID()}`);
    const response = await handleRpc(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "decide_session", arguments: { sessionId, call: "in", confidence: 5 } },
      },
      owner,
    );
    const result = response?.result as { structuredContent: { session: { call: string; confidence: number }; audit: { seal: string; seq: number } } };
    expect(result.structuredContent.session.call).toBe("in");
    expect(result.structuredContent.session.confidence).toBe(5);
    expect(result.structuredContent.audit.seal).toMatch(/^[0-9a-f]{96}$/);
    expect(result.structuredContent.audit.seq).toBe(2);
  });

  it("logs a ride on the same path the UI uses", async () => {
    const sessionId = await seedSession(`mcp-ride-${crypto.randomUUID()}`);
    const response = await handleRpc(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "log_ride",
          arguments: { sessionId, durationSec: 180, longestRideSec: 44, topSpeedKmh: 27.2, completed: true },
        },
      },
      owner,
    );
    const result = response?.result as { structuredContent: { ride: { durationSec: number; completed: boolean }; audit: { seal: string } } };
    expect(result.structuredContent.ride.durationSec).toBe(180);
    expect(result.structuredContent.ride.completed).toBe(true);
    expect(result.structuredContent.audit.seal).toMatch(/^[0-9a-f]{96}$/);
  });

  it("rejects a ride whose numbers fail validation", async () => {
    const sessionId = await seedSession(`mcp-ride-bad-${crypto.randomUUID()}`);
    const response = await handleRpc(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "log_ride", arguments: { sessionId, durationSec: -5, longestRideSec: 1, topSpeedKmh: 1, completed: true } },
      },
      owner,
    );
    expect(response?.error?.code).toBe(-32602);
  });

  it("verifies a chain through the agent interface", async () => {
    const sessionId = await seedSession(`mcp-verify-${crypto.randomUUID()}`);
    await handleRpc(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "decide_session", arguments: { sessionId, call: "out" } },
      },
      owner,
    );
    const response = await handleRpc(
      { jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "verify_integrity", arguments: { sessionId } } },
      owner,
    );
    const result = response?.result as { structuredContent: { ok: boolean; length: number; brokenAt: number | null; algorithm: string } };
    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.length).toBe(2);
    expect(result.structuredContent.brokenAt).toBeNull();
    expect(result.structuredContent.algorithm).toContain("SHA-384");
  });

  it("soft-deletes and leaves a replayable tombstone", async () => {
    const sessionId = await seedSession(`mcp-delete-${crypto.randomUUID()}`);
    const response = await handleRpc(
      { jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "delete_session", arguments: { sessionId } } },
      owner,
    );
    const result = response?.result as { structuredContent: { tombstone: boolean; deletedAt: string } };
    expect(result.structuredContent.tombstone).toBe(true);
    expect(result.structuredContent.deletedAt).toBeTruthy();

    const chain = await handleRpc(
      { jsonrpc: "2.0", id: 15, method: "tools/call", params: { name: "verify_integrity", arguments: { sessionId } } },
      owner,
    );
    const chainResult = chain?.result as { structuredContent: { ok: boolean; length: number } };
    expect(chainResult.structuredContent.ok).toBe(true);
    expect(chainResult.structuredContent.length).toBe(2);
  });

  it("cannot see another rider's session", async () => {
    const sessionId = await seedSession(`mcp-isolation-${crypto.randomUUID()}`);
    const response = await handleRpc(
      { jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "decide_session", arguments: { sessionId, call: "out" } } },
      "55555555-5555-4555-8555-555555555555",
    );
    expect(response?.error).toBeDefined();
    expect(response?.error?.code).not.toBe(200);
  });
});

describe("batching", () => {
  it("answers each message in order and skips notifications", async () => {
    const responses = await handleBatch(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "nope" },
      ],
      owner,
    );
    expect(responses).toHaveLength(3);
    expect(responses.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(responses[2].error?.code).toBe(-32601);
  });

  it("returns nothing for a batch of only notifications", async () => {
    const responses = await handleBatch([{ jsonrpc: "2.0", method: "ping" }], owner);
    expect(responses).toHaveLength(0);
  });

  it("wraps a single message in an array-free response", async () => {
    const responses = await handleBatch({ jsonrpc: "2.0", id: 9, method: "ping" }, owner);
    expect(responses).toHaveLength(1);
  });
});

describe("serverInfo", () => {
  it("names the engine version and the repository", () => {
    const info = serverInfo();
    expect(info.engineVersion).toMatch(/^swellread-engine\//);
    expect(info.instructions).toContain("worth driving");
  });
});
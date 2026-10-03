import { listBreaks } from "@/lib/live/breaks";
import { analyseBreak } from "@/lib/services/analysis";
import {
  ServiceError,
  changeSession,
  dropSession,
  planSession,
  recordRide,
  verifySessionChain,
} from "@/lib/services/sessions";
import { ENGINE_VERSION } from "@/lib/swell/engine";
import { site } from "@/config/site";
import { RideSchema, firstIssue } from "@/lib/validation";
import { z } from "zod";
import type { ApiErrorBody } from "@/lib/types";

/**
 * Live MCP-style JSON-RPC 2.0 endpoint.
 *
 * Tools call the same service layer as the UI, so an agent writing a session and
 * a person writing a session produce the same rows, the same engine seal and the
 * same audit chain.
 */

export const PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; idempotentHint: boolean };
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const BREAK_PROP = {
  breakId: {
    type: "string",
    description: "Break id, for example pago-pago. Call list_breaks first.",
    pattern: "^[a-z0-9-]+$",
  },
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_breaks",
    title: "List surf breaks",
    description:
      "Returns the curated catalogue: coordinates, break type, peel orientation, reef slope, take-off depth, and whether a NOAA tide station is in range.",
    inputSchema: object({}, []),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_conditions",
    title: "Get a break's live conditions",
    description:
      "Fetches the normalised hourly slice for a break's local day from NOAA CO-OPS tide predictions and Open-Meteo marine/forecast data, with attribution and an honest live/fallback status.",
    inputSchema: object(
      {
        ...BREAK_PROP,
        date: { type: "string", description: "Local calendar date, YYYY-MM-DD. Defaults to today at the break." },
        hour: { type: "integer", minimum: 0, maximum: 23, description: "Local hour index, defaults to 0." },
      },
      ["breakId"],
    ),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "analyse_break",
    title: "Explain the read for one hour",
    description:
      `Runs the ${ENGINE_VERSION} deterministic engine on one hour and returns the score, band, every factor with its weight, contribution and human-readable arithmetic, hard gates, derived physics, the best window in the day, and the SHA-384 seal of the result. Pass tideM to ask a what-if question; it never changes stored data.`,
    inputSchema: object(
      {
        ...BREAK_PROP,
        date: { type: "string", description: "Local calendar date, YYYY-MM-DD." },
        hour: { type: "integer", minimum: 0, maximum: 23, description: "Local hour index, defaults to 0." },
        tideM: { type: "number", minimum: -1, maximum: 8, description: "Optional hypothetical tide height in metres." },
      },
      ["breakId"],
    ),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "create_session",
    title: "Plan a session",
    description:
      "Freezes a real conditions snapshot and an engine verdict into a new session owned by the calling browser, and appends the first audit event. Safe to retry with the same idempotencyKey.",
    inputSchema: object(
      {
        ...BREAK_PROP,
        plannedFor: { type: "string", description: "ISO-8601 UTC instant of the planned hour." },
        status: { type: "string", enum: ["planned", "committed", "skipped", "ridden"], default: "planned" },
        note: { type: "string", maxLength: 600 },
        idempotencyKey: { type: "string", maxLength: 120 },
      },
      ["breakId", "plannedFor"],
    ),
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "decide_session",
    title: "Record a call on a session",
    description: "Sets the in/out call and confidence on a session and appends a sealed audit event.",
    inputSchema: object(
      {
        sessionId: { type: "string", format: "uuid" },
        call: { type: "string", enum: ["in", "out"] },
        confidence: { type: "integer", minimum: 1, maximum: 5 },
        status: { type: "string", enum: ["planned", "committed", "skipped", "ridden"] },
        note: { type: "string", maxLength: 600 },
      },
      ["sessionId"],
    ),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "log_ride",
    title: "Log a logged ride",
    description:
      "Records a ride from the WebGL wave lab against a session. This is the same write path the lab's save button uses.",
    inputSchema: object(
      {
        sessionId: { type: "string", format: "uuid" },
        durationSec: { type: "integer", minimum: 0, maximum: 86400 },
        longestRideSec: { type: "integer", minimum: 0, maximum: 86400 },
        topSpeedKmh: { type: "number", minimum: 0, maximum: 250 },
        completed: { type: "boolean" },
      },
      ["sessionId", "durationSec", "longestRideSec", "topSpeedKmh", "completed"],
    ),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "delete_session",
    title: "Delete a session",
    description:
      "Soft-deletes a session and keeps a tombstone plus its audit chain so the history stays replayable.",
    inputSchema: object({ sessionId: { type: "string", format: "uuid" } }, ["sessionId"]),
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "verify_integrity",
    title: "Replay a session's audit chain",
    description:
      "Recomputes every SHA-384 seal in a session's chain from the genesis value and reports the first broken link, or that there is none.",
    inputSchema: object({ sessionId: { type: "string", format: "uuid" } }, ["sessionId"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

const AnalyseSchema = z.object({
  breakId: z.string().min(2).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.number().int().min(0).max(23).default(0),
  tideM: z.number().min(-1).max(8).optional(),
});

const ConditionsSchema = z.object({
  breakId: z.string().min(2).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.number().int().min(0).max(23).default(0),
});

const CreateSchema = z.object({
  breakId: z.string().min(2).max(64),
  plannedFor: z.string().min(10).max(40),
  status: z.enum(["planned", "committed", "skipped", "ridden"]).default("planned"),
  note: z.string().max(600).nullish(),
  idempotencyKey: z.string().min(8).max(120).nullish(),
});

const DecideSchema = z.object({
  sessionId: z.string().min(8).max(64),
  call: z.enum(["in", "out"]).optional(),
  confidence: z.number().int().min(1).max(5).nullish(),
  status: z.enum(["planned", "committed", "skipped", "ridden"]).optional(),
  note: z.string().max(600).nullish(),
});

const SessionIdSchema = z.object({ sessionId: z.string().min(8).max(64) });

function parse<T extends z.ZodTypeAny>(schema: T, params: unknown): z.infer<T> {
  const parsed = schema.safeParse(params ?? {});
  if (!parsed.success) throw new ServiceError(400, "invalid_params", firstIssue(parsed.error));
  return parsed.data;
}

async function callTool(name: string, params: unknown, ownerId: string): Promise<unknown> {
  switch (name) {
    case "list_breaks": {
      const items = listBreaks().map((surfBreak) => ({
        id: surfBreak.id,
        name: surfBreak.name,
        region: surfBreak.region,
        country: surfBreak.country,
        timezone: surfBreak.timezone,
        breakType: surfBreak.breakType,
        orientationDeg: surfBreak.orientationDeg,
        depthAtBreakM: surfBreak.depthAtBreakM,
        tideStation: surfBreak.tideStationId
          ? { id: surfBreak.tideStationId, name: surfBreak.tideStationName, distanceKm: surfBreak.tideStationDistanceKm }
          : null,
        blurb: surfBreak.blurb,
      }));
      return { count: items.length, breaks: items };
    }
    case "get_conditions": {
      const input = parse(ConditionsSchema, params);
      const analysis = await analyseBreak(input);
      return {
        break: { id: analysis.break.id, name: analysis.break.name, timezone: analysis.break.timezone },
        date: analysis.snapshot.date,
        status: analysis.snapshot.status,
        generatedAt: analysis.snapshot.generatedAt,
        hours: analysis.snapshot.hours,
        sources: analysis.snapshot.sources,
        tide: {
          stationId: analysis.tide.stationId,
          stationName: analysis.tide.stationName,
          datum: analysis.tide.datum,
          rangeM: analysis.tide.rangeM,
          meanM: analysis.tide.meanM,
          highs: analysis.tide.highs,
          lows: analysis.tide.lows,
          status: analysis.tide.status,
        },
        dayScores: analysis.points.map((point) => ({ at: point.at, localLabel: point.localLabel, score: point.score, band: point.band })),
      };
    }
    case "analyse_break": {
      const input = parse(AnalyseSchema, params);
      const analysis = await analyseBreak(input);
      return {
        break: { id: analysis.break.id, name: analysis.break.name, breakType: analysis.break.breakType },
        at: analysis.hour.at,
        whatIf: analysis.whatIf,
        engine: analysis.engine,
        derived: analysis.engine.derived,
        window: analysis.engine.window,
        snapshotStatus: analysis.status,
      };
    }
    case "create_session": {
      const input = parse(CreateSchema, params);
      const result = await planSession(ownerId, input);
      return {
        session: result.session,
        audit: { seq: result.seq, seal: result.seal, replayed: result.replayed },
      };
    }
    case "decide_session": {
      const input = parse(DecideSchema, params);
      const result = await changeSession(ownerId, input.sessionId, {
        call: input.call,
        confidence: input.confidence,
        status: input.status,
        note: input.note,
      });
      return { session: result.session, audit: { seq: result.seq, seal: result.seal } };
    }
    case "log_ride": {
      const input = parse(z.object({ sessionId: z.string().min(8).max(64) }).and(RideSchema), params);
      const result = await recordRide(ownerId, input.sessionId, input);
      return { ride: result.ride, audit: { seal: result.seal } };
    }
    case "delete_session": {
      const input = parse(SessionIdSchema, params);
      const result = await dropSession(ownerId, input.sessionId);
      return {
        sessionId: result.session.id,
        deletedAt: result.session.deletedAt,
        tombstone: true,
        audit: { seq: result.seq, seal: result.seal },
      };
    }
    case "verify_integrity": {
      const input = parse(SessionIdSchema, params);
      const chain = await verifySessionChain(ownerId, input.sessionId);
      return {
        entityId: chain.entityId,
        ok: chain.ok,
        length: chain.length,
        headSeal: chain.headSeal,
        brokenAt: chain.brokenAt,
        reason: chain.reason,
        algorithm: "seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) ), genesis = 96 zeros",
        events: chain.events.map((event) => ({ seq: event.seq, action: event.action, seal: event.seal, prevSeal: event.prevSeal, createdAt: event.createdAt })),
      };
    }
    default:
      throw new ServiceError(404, "unknown_tool", `No tool named ${name}`);
  }
}

function errorPayload(error: unknown): { code: number; message: string; data?: unknown } {
  if (error instanceof ServiceError) {
    if (error.code === "unknown_tool") return { code: METHOD_NOT_FOUND, message: error.message };
    return { code: error.status === 400 ? INVALID_PARAMS : INTERNAL_ERROR, message: error.message, data: { code: error.code } };
  }
  return {
    code: INTERNAL_ERROR,
    message: "The tool call failed. Check the server logs; no internal detail is returned to the caller.",
    data: { code: "internal_error" },
  };
}

export function serverInfo() {
  return {
    name: site.name,
    version: "1.0.0",
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    repository: site.repository,
    instructions:
      "Swellread answers one question honestly: given real swell, wind and verified tide, is it worth driving to this break today, and at which hours? Call list_breaks, then analyse_break for the arithmetic, then create_session to freeze a plan. Mutating tools act on the same session store the web UI uses, scoped to the caller's anonymous browser session.",
  };
}

function capabilities() {
  return {
    tools: { listChanged: false },
    resources: { subscribe: false },
    logging: {},
  };
}

/** Handles one JSON-RPC message. Returns null for notifications. */
export async function handleRpc(body: unknown, ownerId: string): Promise<JsonRpcResponse | null> {
  const message = body as JsonRpcRequest;
  const id = message && typeof message === "object" && "id" in message ? message.id ?? null : null;
  const isNotification = !message || typeof message !== "object" || message.id === undefined;

  if (!message || typeof message !== "object" || typeof message.method !== "string") {
    if (isNotification) return null;
    return { jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "A JSON-RPC request needs a method name." } };
  }
  if (message.jsonrpc !== "2.0") {
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, error: { code: INVALID_REQUEST, message: 'jsonrpc must be exactly "2.0".' } };
  }

  try {
    switch (message.method) {
      case "initialize": {
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: capabilities(),
          serverInfo: serverInfo(),
        };
        return isNotification ? null : { jsonrpc: "2.0", id, result };
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return isNotification ? null : { jsonrpc: "2.0", id, result: { tools: TOOLS } };
      case "resources/list":
        return isNotification ? null : { jsonrpc: "2.0", id, result: { resources: [] } };
      case "prompts/list":
        return isNotification ? null : { jsonrpc: "2.0", id, result: { prompts: [] } };
      case "tools/call": {
        const params = (message.params ?? {}) as { name?: string; arguments?: unknown };
        if (typeof params.name !== "string") {
          return { jsonrpc: "2.0", id, error: { code: INVALID_PARAMS, message: "tools/call needs a params.name string." } };
        }
        const known = TOOLS.some((tool) => tool.name === params.name);
        const output = await callTool(params.name, params.arguments, ownerId);
        if (!known) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: METHOD_NOT_FOUND, message: `No tool named ${params.name}` },
          };
        }
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
            isError: false,
          },
        };
      }
      default:
        if (isNotification) return null;
        return { jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Unknown method ${message.method}` } };
    }
  } catch (error) {
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, error: errorPayload(error) };
  }
}

/** Batches of one or more messages, answered in order. */
export async function handleBatch(
  body: unknown,
  ownerId: string,
): Promise<Array<JsonRpcResponse>> {
  if (Array.isArray(body)) {
    const out: Array<JsonRpcResponse> = [];
    for (const entry of body) {
      const response = await handleRpc(entry, ownerId);
      if (response) out.push(response);
    }
    return out;
  }
  const single = await handleRpc(body, ownerId);
  return single ? [single] : [];
}

export function jsonError(code: string, message: string, status = 400): ApiErrorBody {
  return { error: { code, message, details: { status } } };
}
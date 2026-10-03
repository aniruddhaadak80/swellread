"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Play } from "lucide-react";

/**
 * A live MCP console.
 *
 * Every button here posts a real JSON-RPC 2.0 message to /api/mcp and shows the
 * exact request and the exact response, including JSON-RPC error codes. The
 * mutating buttons write through the same service layer as the UI.
 */

interface Preset {
  key: string;
  label: string;
  group: "protocol" | "read" | "write";
  mutating: boolean;
  build: (state: { breakId: string; plannedFor: string; sessionId: string }) => unknown;
}

const PRESETS: Preset[] = [
  {
    key: "initialize",
    label: "initialize",
    group: "protocol",
    mutating: false,
    build: () => ({ jsonrpc: "2.0", id: nextId(), method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "swellread-console", version: "1.0.0" } } }),
  },
  {
    key: "tools-list",
    label: "tools/list",
    group: "protocol",
    mutating: false,
    build: () => ({ jsonrpc: "2.0", id: nextId(), method: "tools/list" }),
  },
  {
    key: "list-breaks",
    label: "list_breaks",
    group: "read",
    mutating: false,
    build: () => call("list_breaks", {}),
  },
  {
    key: "conditions",
    label: "get_conditions",
    group: "read",
    mutating: false,
    build: (state) => call("get_conditions", { breakId: state.breakId, hour: 8 }),
  },
  {
    key: "analyse",
    label: "analyse_break",
    group: "read",
    mutating: false,
    build: (state) => call("analyse_break", { breakId: state.breakId, hour: 8 }),
  },
  {
    key: "create",
    label: "create_session",
    group: "write",
    mutating: true,
    build: (state) =>
      call("create_session", {
        breakId: state.breakId,
        plannedFor: new Date(state.plannedFor).toISOString(),
        status: "committed",
        idempotencyKey: `console-${state.breakId}-${Date.now()}`,
      }),
  },
  {
    key: "decide",
    label: "decide_session",
    group: "write",
    mutating: true,
    build: (state) => call("decide_session", { sessionId: state.sessionId, call: "in", confidence: 4 }),
  },
  {
    key: "ride",
    label: "log_ride",
    group: "write",
    mutating: true,
    build: (state) => call("log_ride", { sessionId: state.sessionId, durationSec: 120, longestRideSec: 38, topSpeedKmh: 26.4, completed: true }),
  },
  {
    key: "verify",
    label: "verify_integrity",
    group: "read",
    mutating: false,
    build: (state) => call("verify_integrity", { sessionId: state.sessionId }),
  },
  {
    key: "delete",
    label: "delete_session",
    group: "write",
    mutating: true,
    build: (state) => call("delete_session", { sessionId: state.sessionId }),
  },
];

let counter = 0;
function nextId(): number {
  counter += 1;
  return counter;
}

function call(name: string, args: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: nextId(), method: "tools/call", params: { name, arguments: args } };
}

interface LogEntry {
  id: string;
  label: string;
  request: unknown;
  response: unknown;
  status: number;
  ms: number;
  sessionId: string | null;
}

export function AgentConsole({ breaks, defaultBreakId }: { breaks: Array<{ id: string; name: string }>; defaultBreakId: string }) {
  const [breakId, setBreakId] = useState(defaultBreakId);
  const [plannedFor, setPlannedFor] = useState(() => new Date().toISOString().slice(0, 16));
  const [sessionId, setSessionId] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  async function send(payload: unknown, label: string) {
    setBusy(label);
    setCustomError(null);
    const started = performance.now();
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      const ms = Math.round(performance.now() - started);
      const structured = (body?.result?.structuredContent ?? null) as { session?: { id?: string } } | null;
      setLog((current) => [
        { id: `${Date.now()}-${Math.random()}`, label, request: payload, response: body, status: response.status, ms, sessionId: structured?.session?.id ?? null },
        ...current,
      ]);
      if (structured?.session?.id) setSessionId(structured.session.id);
      return body;
    } catch (caught) {
      setCustomError(caught instanceof Error ? caught.message : "The endpoint could not be reached.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function run(preset: Preset) {
    await send(preset.build({ breakId, plannedFor, sessionId: sessionId || "00000000-0000-4000-8000-000000000000" }), preset.label);
  }

  async function sendCustom() {
    if (!custom) return;
    setCustomError(null);
    try {
      const parsed = JSON.parse(custom);
      await send(parsed, "custom");
    } catch (caught) {
      setCustomError(caught instanceof Error ? caught.message : "That is not valid JSON.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-5">
        <div className="border border-rule bg-paper px-4 py-4">
          <p className="label">Arguments</p>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="agent-break" className="label">
                breakId
              </label>
              <select
                id="agent-break"
                value={breakId}
                onChange={(event) => setBreakId(event.target.value)}
                className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-sm"
              >
                {breaks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="agent-time" className="label">
                plannedFor (your local time)
              </label>
              <input
                id="agent-time"
                type="datetime-local"
                value={plannedFor}
                onChange={(event) => setPlannedFor(event.target.value)}
                className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="agent-session" className="label">
                sessionId (for the tools that need one)
              </label>
              <input
                id="agent-session"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                placeholder="paste a session id, or create one below"
                className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-xs"
              />
              {sessionId ? (
                <Link href={`/sessions/${sessionId}`} className="mt-1 inline-block font-mono text-[0.6875rem] text-rescue underline underline-offset-4">
                  open this session
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border border-rule bg-paper px-4 py-4">
          <p className="label">One-click calls</p>
          <div className="mt-3 space-y-4">
            {(["protocol", "read", "write"] as const).map((group) => (
              <div key={group}>
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
                  {group === "write" ? "mutating tools" : group === "read" ? "read and analysis" : "protocol"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESETS.filter((preset) => preset.group === group).map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => void run(preset)}
                      disabled={busy !== null}
                      className={`inline-flex items-center gap-1.5 border px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] disabled:opacity-50 ${
                        preset.mutating
                          ? "border-rescue text-rescue hover:bg-rescue hover:text-paper"
                          : "border-rule text-ink hover:border-ink"
                      }`}
                    >
                      {busy === preset.label ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Mutating tools write through the same service layer the web UI uses, scoped to this browser&apos;s anonymous
            owner. <code className="font-mono">create_session</code> takes an idempotency key, so retrying it does not
            create a second session.
          </p>
        </div>

        <div className="border border-rule bg-paper px-4 py-4">
          <label htmlFor="custom-rpc" className="label">
            Raw JSON-RPC message
          </label>
          <textarea
            id="custom-rpc"
            value={custom ?? ""}
            onChange={(event) => setCustom(event.target.value)}
            rows={6}
            placeholder='{"jsonrpc":"2.0","id":99,"method":"tools/list"}'
            className="mt-2 w-full border border-rule bg-paper px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => void sendCustom()}
            disabled={busy !== null || !custom}
            className="mt-2 border-2 border-ink px-4 py-2 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
          >
            Send
          </button>
          {customError ? <p className="mt-2 text-xs text-alert">{customError}</p> : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="border border-rule bg-paper px-4 py-3">
          <p className="label">Responses · newest first</p>
        </div>
        {log.length === 0 ? (
          <div className="border border-dashed border-rule bg-paper/60 px-4 py-8 text-center text-sm text-ink-soft">
            Nothing sent yet. Start with <code className="font-mono">initialize</code>, then{" "}
            <code className="font-mono">tools/list</code>, then a mutating tool.
          </div>
        ) : (
          log.map((entry) => {
            const errored = Boolean((entry.response as { error?: unknown })?.error);
            return (
              <details
                key={entry.id}
                open={log.length === 1}
                className={`border bg-paper ${errored ? "border-alert" : "border-rule"}`}
              >
                <summary className="cursor-pointer px-4 py-3">
                  <span className="font-mono text-xs uppercase tracking-[0.1em] text-ink">{entry.label}</span>
                  <span className={`ml-2 font-mono text-[0.6875rem] ${errored ? "text-alert" : "text-lagoon-deep"}`}>
                    HTTP {entry.status} · {entry.ms}ms{errored ? " · jsonrpc error" : ""}
                  </span>
                </summary>
                <div className="border-t border-rule px-4 py-3">
                  <p className="label">Request</p>
                  <pre className="scroll-thin mt-1 max-h-48 overflow-auto bg-glass px-2 py-2 font-mono text-[0.6875rem]">
                    {JSON.stringify(entry.request, null, 2)}
                  </pre>
                  <p className="label mt-3">Response</p>
                  <pre
                    data-testid="rpc-response"
                    className="scroll-thin mt-1 max-h-80 overflow-auto bg-glass px-2 py-2 font-mono text-[0.6875rem]"
                  >
                    {JSON.stringify(entry.response, null, 2)}
                  </pre>
                  {entry.sessionId ? (
                    <Link href={`/sessions/${entry.sessionId}`} className="mt-2 inline-block font-mono text-[0.6875rem] text-rescue underline underline-offset-4">
                      open the persisted result
                    </Link>
                  ) : null}
                </div>
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}
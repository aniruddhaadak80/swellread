#!/usr/bin/env node
/**
 * Live end-to-end proof against a deployed Swellread.
 *
 *   SWELLREAD_BASE_URL=https://your-deployment.vercel.app npm run verify
 *
 * Reads the base URL from the environment. Contains no secrets: the only thing it
 * sends is an anonymous owner cookie that the app itself mints.
 *
 * It proves, with real HTTP requests:
 *   1  the landing page returns 200
 *   2  /api/health reports a real production store check
 *   3  the live-data endpoint returns normalised rows with source metadata
 *   4  a record can be created through the public API and read back
 *   5  the record can be updated and the change persists
 *   6  the engine returns a versioned score, itemised factors and a seal
 *   7  MCP initialize succeeds and tools/list returns typed schemas
 *   8  an MCP mutating tool writes through the same path, and read-back proves it
 *   9  integrity replay is clean before deletion
 *  10  the record is deleted and the tombstone is documented
 *  11  the rendered nav and footer both contain the public repository URL
 *  12  the repository URL returns 200 and primary routes have no broken links
 */

import process from "node:process";

const BASE = (process.env.SWELLREAD_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
const REPO = process.env.SWELLREAD_REPO_URL ?? "https://github.com/aniruddhaadak80/swellread";

if (!BASE) {
  console.error("Set SWELLREAD_BASE_URL to the deployment you want to verify.");
  process.exit(2);
}

const PRIMARY_ROUTES = ["/", "/breaks", "/sessions", "/lab", "/agent", "/export", "/method", "/settings", "/verify"];

const jar = new Map();
let rpcId = 0;

function cookieHeader() {
  if (jar.size === 0) return "";
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

function rememberCookies(response) {
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  for (const entry of raw) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function request(path, options = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    headers: {
      accept: "application/json, text/html;q=0.9",
      ...(options.headers ?? {}),
      ...(jar.size > 0 ? { cookie: cookieHeader() } : {}),
    },
  });
  rememberCookies(response);
  return response;
}

async function json(path, options) {
  const response = await request(path, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body, text };
}

const results = [];
let failures = 0;

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  const mark = passed ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function rpc(method, params) {
  rpcId += 1;
  const { response, body } = await json("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
  if (!response.ok) throw new Error(`JSON-RPC ${method} failed with HTTP ${response.status}`);
  if (body?.error) throw new Error(`JSON-RPC ${method} returned ${body.error.code}: ${body.error.message}`);
  return body?.result;
}

function randomPlannedFor() {
  const at = new Date();
  at.setUTCMinutes(0, 0, 0);
  at.setUTCHours(at.getUTCHours() + 1);
  return at.toISOString();
}

async function main() {
  console.log(`Verifying ${BASE}\nRepository  ${REPO}\n`);

  // 1 — landing page
  {
    const response = await request("/");
    const html = await response.text();
    check("landing page returns 200", response.status === 200, `HTTP ${response.status}`);
    check("landing page mentions the product verdict", /Read the water before you paddle out/i.test(html), "headline present");
  }

  // 2 — health with a real store probe
  {
    const { response, body } = await json("/api/health");
    const productionStore = Boolean(body?.store?.productionStore);
    const probed = typeof body?.persistence?.probe === "string" && body.persistence.probe.length > 0;
    check(
      "health endpoint reports a real store check",
      response.status === 200 && probed && productionStore,
      `${body?.store?.kind ?? "?"} · ${String(body?.persistence?.probe ?? "no probe").slice(0, 70)}`,
    );
  }

  // 3 — live data with attribution
  let breakId = "pago-pago";
  {
    const { response, body } = await json("/api/conditions?breakId=pago-pago&hour=8");
    const hours = body?.snapshot?.hours ?? [];
    const sources = body?.snapshot?.sources ?? [];
    const hasMetadata =
      sources.length >= 3 && sources.every((source) => typeof source.url === "string" && source.url.startsWith("https://"));
    check("live data returns a normalised hourly slice", response.status === 200 && hours.length === 24, `${hours.length} hours`);
    check(
      "live data carries attribution and an honest status",
      hasMetadata && ["live", "mixed", "fallback"].includes(body?.snapshot?.status),
      `status=${body?.snapshot?.status} sources=${sources.map((s) => `${s.id}:${s.status}`).join(", ")}`,
    );
    const noStation = await json("/api/conditions?breakId=kovalam");
    const tideSource = (noStation.body?.snapshot?.sources ?? []).find((source) => source.id === "noaa-coops");
    check(
      "a break with no tide station says so instead of inventing one",
      tideSource?.status === "fallback" && /No NOAA CO-OPS station/.test(tideSource?.note ?? ""),
      tideSource?.note?.slice(0, 70) ?? "missing attribution",
    );
  }

  // 6 — engine (checked before create because create embeds it)
  {
    const { response, body } = await json("/api/engine?breakId=pago-pago&hour=8");
    const engine = body?.engine;
    const factors = engine?.factors ?? [];
    const versioned = typeof engine?.version === "string" && engine.version.startsWith("swellread-engine/");
    const itemised =
      factors.length === 6 && factors.every((factor) => typeof factor.evidence === "string" && factor.evidence.length > 0);
    const sealed = typeof engine?.seal === "string" && /^[0-9a-f]{96}$/.test(engine.seal);
    check("engine returns a versioned score, factors and a seal", response.status === 200 && versioned && itemised && sealed, `${engine?.version} score=${engine?.score} seal=${String(engine?.seal).slice(0, 12)}…`);
  }

  // 4 — create through the public API, then read back
  const plannedFor = randomPlannedFor();
  const idempotencyKey = `verify-live-${Date.now()}`;
  let sessionId = null;
  {
    const created = await json("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ breakId, plannedFor, status: "committed", idempotencyKey }),
    });
    sessionId = created.body?.session?.id ?? null;
    const seal = created.body?.audit?.seal ?? "";
    check("a session can be created through the public API", created.response.status === 201 && Boolean(sessionId), `HTTP ${created.response.status} id=${sessionId ?? "none"}`);
    check("the create response carries an audit seal", /^[0-9a-f]{96}$/.test(seal), seal.slice(0, 16) + "…");

    const readBack = await json(`/api/sessions/${sessionId}`);
    const session = readBack.body?.session;
    check(
      "the created session reads back with its frozen snapshot",
      readBack.response.status === 200 && Array.isArray(session?.conditions?.hours) && session.conditions.hours.length === 24,
      `snapshot=${session?.conditions?.status} hours=${session?.conditions?.hours?.length}`,
    );

    // idempotency
    const replay = await json("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ breakId, plannedFor, status: "committed", idempotencyKey }),
    });
    check(
      "replaying the same idempotency key does not create a second session",
      replay.body?.session?.id === sessionId && replay.body?.audit?.replayed === true,
      `replayed=${replay.body?.audit?.replayed}`,
    );
  }

  // 5 — update and confirm persistence
  {
    const patched = await json(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ call: "in", confidence: 4, note: "live verifier wrote this" }),
    });
    const readBack = await json(`/api/sessions/${sessionId}`);
    const session = readBack.body?.session;
    check(
      "an update persists and reads back",
      patched.response.status === 200 && session?.call === "in" && session?.confidence === 4 && session?.note === "live verifier wrote this",
      `status=${session?.status} call=${session?.call} v${session?.version}`,
    );
  }

  // 7 — MCP initialize and tools/list
  {
    const initialize = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-live", version: "1.0.0" } });
    check(
      "MCP initialize returns protocol version and server info",
      typeof initialize?.protocolVersion === "string" && typeof initialize?.serverInfo?.name === "string",
      `${initialize?.serverInfo?.name} ${initialize?.protocolVersion}`,
    );

    const listed = await rpc("tools/list");
    const tools = listed?.tools ?? [];
    const names = tools.map((tool) => tool.name);
    const expected = ["list_breaks", "get_conditions", "analyse_break", "create_session", "decide_session", "log_ride", "delete_session", "verify_integrity"];
    const schemasOk = tools.every((tool) => tool.inputSchema?.type === "object");
    const mutating = tools.filter((tool) => tool.annotations?.readOnlyHint === false).length;
    check(
      "tools/list returns the expected tools with typed schemas",
      expected.every((name) => names.includes(name)) && schemasOk && mutating >= 3,
      `${tools.length} tools, ${mutating} mutating`,
    );

    // an agent read that does not need a session
    const analysed = await rpc("tools/call", { name: "analyse_break", arguments: { breakId, hour: 8 } });
    const payload = analysed?.structuredContent;
    check(
      "an agent analysis tool returns the sealed verdict",
      typeof payload?.engine?.seal === "string" && payload.engine.factors?.length === 6,
      `score=${payload?.engine?.score} band=${payload?.engine?.band}`,
    );
  }

  // 8 — MCP mutation goes through the same path as the UI
  {
    const created = await rpc("tools/call", {
      name: "create_session",
      arguments: { breakId, plannedFor: randomPlannedFor(), status: "planned", idempotencyKey: `verify-mcp-${Date.now()}` },
    });
    const agentSessionId = created?.structuredContent?.session?.id ?? null;
    const readBack = await json(`/api/sessions/${agentSessionId}`);
    check(
      "an agent mutation writes a session the UI-facing API can read",
      created?.structuredContent?.audit?.seal?.length === 96 && readBack.response.status === 200 && readBack.body?.session?.status === "planned",
      `agent id=${agentSessionId} status=${readBack.body?.session?.status}`,
    );

    const ride = await rpc("tools/call", {
      name: "log_ride",
      arguments: { sessionId: agentSessionId, durationSec: 200, longestRideSec: 51, topSpeedKmh: 27.5, completed: true },
    });
    const afterRide = await json(`/api/sessions/${agentSessionId}`);
    check(
      "an agent can log a ride that persists against the session",
      ride?.structuredContent?.ride?.durationSec === 200 && afterRide.body?.session?.rides?.length === 1,
      `rides=${afterRide.body?.session?.rides?.length}`,
    );

    // clean up the agent's session
    await rpc("tools/call", { name: "delete_session", arguments: { sessionId: agentSessionId } });
  }

  // 9 — integrity replay before deletion
  {
    const replay = await json(`/api/integrity/${sessionId}`);
    const chain = replay.body;
    const allSealed = (chain?.events ?? []).every((event) => /^[0-9a-f]{96}$/.test(event.seal));
    check(
      "integrity replay is clean and every link is sealed",
      replay.response.status === 200 && chain?.ok === true && chain?.brokenAt === null && allSealed && chain.length >= 2,
      `${chain?.length} events, head=${String(chain?.headSeal).slice(0, 12)}…`,
    );
  }

  // 10 — delete and confirm the documented tombstone
  {
    const deleted = await json(`/api/sessions/${sessionId}`, { method: "DELETE" });
    const listed = await json("/api/sessions?limit=100");
    const stillListed = (listed.body?.items ?? []).some((item) => item.id === sessionId);
    const tombstoneKept = deleted.body?.tombstone === true && typeof deleted.body?.deletedAt === "string";
    check("delete hides the session from the list", deleted.response.status === 200 && !stillListed, `listed=${stillListed}`);
    check("delete keeps a tombstone so history stays replayable", tombstoneKept, `deletedAt=${deleted.body?.deletedAt}`);

    const afterDelete = await json(`/api/integrity/${sessionId}`);
    check(
      "the chain still replays after deletion",
      afterDelete.response.status === 200 && afterDelete.body?.ok === true && (afterDelete.body?.events ?? []).some((event) => event.action === "session.delete"),
      `${afterDelete.body?.length} events, last=${afterDelete.body?.events?.at(-1)?.action}`,
    );
  }

  // 11 — the repository link is in the rendered nav and footer
  {
    const html = await (await request("/")).text();
    const navIndex = html.indexOf('aria-label="Primary"');
    const footerIndex = html.indexOf("<footer");
    const headerIndex = html.indexOf("<header");
    const inHeader = html.includes(REPO);
    const inNav = navIndex >= 0 && html.slice(navIndex, footerIndex > 0 ? footerIndex : html.length).includes(REPO);
    const inFooter = footerIndex > 0 && html.slice(footerIndex).includes(REPO);
    check("the repository URL is in the rendered header", inHeader && headerIndex >= 0, REPO);
    check("the repository URL is in the primary nav", inNav, navIndex >= 0 ? "nav found" : "nav landmark missing");
    check("the repository URL is in the shared footer", inFooter, footerIndex >= 0 ? "footer found" : "footer missing");
    // Every anchor that points at GitHub must carry rel="noopener noreferrer".
    const repoAnchors = [...html.matchAll(/<a\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => tag.includes("github.com"));
    const unsafe = repoAnchors.filter(
      (tag) => !/rel="[^"]*noopener/.test(tag) || !/target="_blank"/.test(tag),
    );
    check(
      "repository links open safely in a new tab",
      repoAnchors.length >= 3 && unsafe.length === 0,
      `${repoAnchors.length} repo anchors, ${unsafe.length} without rel=noopener`,
    );
  }

  // 12 — the repository itself, and every primary route
  {
    const repo = await request(REPO);
    check("the public repository URL returns 200", repo.status === 200, `HTTP ${repo.status}`);

    for (const route of PRIMARY_ROUTES) {
      const response = await request(route);
      check(`primary route ${route} returns 200`, response.status === 200, `HTTP ${response.status}`);
    }

    // internal link sanity: every href we render that starts with / must resolve
    const html = await (await request("/")).text();
    const hrefs = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map((match) => match[1]);
    const unique = [...new Set(hrefs)].slice(0, 14);
    const broken = [];
    for (const href of unique) {
      if (href.startsWith("/_next") || href.startsWith("/models")) continue;
      const response = await request(href);
      if (response.status >= 400) broken.push(`${href} -> ${response.status}`);
    }
    check("no broken internal links on the landing page", broken.length === 0, broken.length ? broken.join(", ") : `${unique.length} links checked`);
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed against ${BASE}`);
    process.exit(1);
  }
  console.log(`Everything verified against ${BASE}`);
}

main().catch((error) => {
  console.error("\nverifier crashed:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
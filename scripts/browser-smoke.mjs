#!/usr/bin/env node
/**
 * Browser smoke test for the primary journey, driven through visible controls.
 *
 *   SWELLREAD_BASE_URL=http://localhost:3000 node scripts/browser-smoke.mjs
 *
 * Walks: landing → break page → drag the tide what-if → commit a session →
 * session page → record a call → export brief → agent console (initialize,
 * tools/list, create_session, verify_integrity) → delete the session. Captures
 * desktop and mobile screenshots and fails on any console error, page error or
 * failed network request.
 */

import process from "node:process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.SWELLREAD_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SHOTS = process.env.SWELLREAD_SHOT_DIR ?? "screenshots";
const HEADED = process.env.SWELLREAD_HEADED === "1";

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
let step = 0;

mkdirSync(SHOTS, { recursive: true });

function ok(name, detail = "") {
  step += 1;
  console.log(`PASS  ${String(step).padStart(2, "0")}. ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Polls until the predicate holds, or throws with the last observed text. */
async function waitForText(page, locator, pattern, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = (await locator.count()) > 0 ? await locator.first().innerText() : "";
    if (pattern.test(last)) return last;
    await page.waitForTimeout(300);
  }
  throw new Error(`${label} never appeared. Last seen: ${last.replace(/\s+/g, " ").slice(0, 200)}`);
}

/** Clicks a console preset and waits for that call's own summary to report 200. */
async function runCall(page, label) {
  await page.locator("button", { hasText: new RegExp(`^${label.replace("/", "\\/")}$`) }).first().click();
  const summary = page.locator("summary", { hasText: label }).first();
  await summary.waitFor({ state: "attached", timeout: 15_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const text = await summary.innerText();
    if (/HTTP 200/.test(text)) return text;
    if (/HTTP [45]/.test(text) || /jsonrpc error/.test(text)) {
      throw new Error(`${label} failed: ${text.replace(/\s+/g, " ")}`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`${label} never reported a status`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  console.log(`Browser smoke against ${BASE}\n`);
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text()}`);
  });
  page.on("pageerror", (error) => pageErrors.push(`${page.url()} :: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    const url = request.url();
    // The ONNX runtime fetch only happens when someone loads the local model.
    if (url.includes("/models/")) return;
    // Next cancels its own route prefetches when navigation happens. Those are
    // expected and are not a broken request.
    if (url.includes("_rsc=")) return;
    if (failure.includes("ERR_ABORTED")) return;
    failedRequests.push(`${url} :: ${failure}`);
  });
  // Console errors do not name the resource, so record every non-2xx response too.
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() < 400) return;
    if (url.includes("/models/") || url.includes("_rsc=")) return;
    badResponses.push(`${response.status()} ${url}`);
  });

  // 1 — landing shows a real verdict
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const headline = await page.locator("h1").first().innerText();
  if (!/Read the water/i.test(headline)) throw new Error(`unexpected headline: ${headline}`);
  const verdictChip = await page.locator("span", { hasText: /Get in the water|Worth the drive|Marginal|Stay home|Nothing to surf/ }).count();
  if (verdictChip === 0) throw new Error("no live verdict chip on the landing page");
  const ribbon = await page.locator("svg[role='img']").count();
  if (ribbon === 0) throw new Error("tide ribbon did not render");
  await shot(page, "01-landing-desktop");
  ok("landing renders a live verdict and the tide ribbon", `${verdictChip} verdict chips`);

  // 2 — the repository link is reachable from the landing page
  const repoLink = page.locator('a[href="https://github.com/aniruddhaadak80/swellread"]').first();
  if ((await repoLink.count()) === 0) throw new Error("no repository CTA on the landing page");
  ok("landing page shows the repository CTA", await repoLink.innerText());

  // 3 — break page, and the tide what-if really re-runs the engine
  await page.goto(`${BASE}/breaks/pago-pago?hour=8`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const slider = page.locator("#tide-drag");
  await slider.waitFor({ state: "visible", timeout: 20_000 });
  const sealBefore = (await page.getByTestId("engine-seal").first().innerText()).trim();
  const peelBefore = Number((await page.getByTestId("peel-speed-value").first().innerText()).replace(/[^\d.]/g, ""));
  await slider.fill("2.4");
  await page.waitForTimeout(1400);
  const sealAfter = (await page.getByTestId("engine-seal").first().innerText()).trim();
  const peelAfter = Number((await page.getByTestId("peel-speed-value").first().innerText()).replace(/[^\d.]/g, ""));
  if (sealBefore === sealAfter) throw new Error(`dragging the tide did not change the engine seal (${sealBefore})`);
  if (!(peelAfter > peelBefore)) throw new Error(`peel speed did not increase with tide: ${peelBefore} -> ${peelAfter}`);
  await shot(page, "02-break-tide-drag");
  ok("tide drag re-runs the engine and re-seals it", `${sealBefore} -> ${sealAfter}, peel ${peelBefore} -> ${peelAfter} km/h`);

  // 4 — commit a session through the visible button
  await page.locator("button", { hasText: /^Commit / }).first().click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]{36}/, { timeout: 45_000 });
  const sessionUrl = page.url();
  const sessionId = sessionUrl.split("/").pop();
  await page.waitForLoadState("networkidle");
  if (!(await page.locator("text=The audit chain for this session").count())) {
    throw new Error("session page did not render its audit chain");
  }
  await shot(page, "03-session-detail");
  ok("committing a session persisted it and opened its page", sessionId);

  // 5 — record a call, which must bump the version and append a sealed event
  await page.locator("button", { hasText: "I'm going" }).first().click();
  const decideEvent = await waitForText(page, page.locator("ol li", { hasText: /session\.decide/i }), /session\.decide/i, "the session.decide audit event");
  ok("recording a call appended a sealed audit event", decideEvent.replace(/\s+/g, " ").slice(0, 60));

  // 6 — write a note
  await page.fill("#session-note", "smoked in a real browser, mid tide peeled hard left");
  await page.locator("button", { hasText: "Save note" }).first().click();
  await waitForText(page, page.locator("ol li", { hasText: /session\.update/i }), /session\.update/i, "the session.update audit event");
  await shot(page, "04-session-decided");
  ok("the note was persisted and appended its own audit event", "session.update");

  // 7 — export the brief
  await page.goto(`${BASE}/export?session=${sessionId}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if ((await page.locator("text=The brief you hand to whoever is coming with you").count()) === 0) {
    throw new Error("export page did not render");
  }
  const download = page.locator('a[download]').first();
  if ((await download.count()) === 0) throw new Error("no downloadable brief");
  const href = await download.getAttribute("href");
  if (!href?.includes("format=json")) throw new Error("the brief download does not point at the JSON artifact");
  const briefResponse = await page.request.get(`${BASE}${href}`);
  const brief = await briefResponse.json();
  if (!brief.engine?.factors?.length || !brief.chain?.ok) throw new Error("the brief is missing factors or a clean chain");
  await shot(page, "05-export-brief");
  ok("the brief renders and its JSON artifact downloads with a clean chain", `${brief.conditions.length} hourly rows`);

  // 8 — share route renders for a handover
  await page.goto(`${BASE}/share/${sessionId}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if ((await page.locator("text=Window worth driving for").count()) === 0) {
    throw new Error("share route did not render");
  }
  ok("share route renders the handover brief", sessionId);

  // 9 — agent console: initialize, tools/list, a mutation, integrity
  await page.goto(`${BASE}/agent`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await runCall(page, "initialize");
  const toolsSummary = await runCall(page, "tools/list");
  if (!/HTTP 200/.test(toolsSummary)) throw new Error(`tools/list did not succeed: ${toolsSummary}`);

  await page.locator("#agent-session").fill(sessionId);
  await runCall(page, "log_ride");

  await runCall(page, "verify_integrity");
  await shot(page, "06-agent-console");
  // A closed <details> does not contribute to innerText, so read the payload directly.
  const verifyBody = await page
    .locator("details", { hasText: "verify_integrity" })
    .first()
    .getByTestId("rpc-response")
    .textContent();
  if (!/"ok": true/.test(verifyBody ?? "")) {
    throw new Error(`verify_integrity did not report a clean chain: ${String(verifyBody).slice(0, 300)}`);
  }
  ok("agent console initializes, lists tools, mutates and verifies", "4 calls, all HTTP 200");

  // 10 — delete through the visible control, and confirm the tombstone
  await page.goto(sessionUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator("button", { hasText: "Delete this session" }).first().click();
  await page.locator("button", { hasText: "Yes, delete it" }).first().click();
  await page.waitForURL(/\/sessions(\?|$)/, { timeout: 30_000 });
  await page.waitForTimeout(800);
  const gone = await page.request.get(`${BASE}/api/integrity/${sessionId}`);
  const chain = await gone.json();
  if (!chain.ok) throw new Error("the chain stopped replaying after delete");
  ok("delete removed the session and kept the chain replayable", `${chain.length} events`);

  // 11 — keyboard reachability and focus visibility
  await page.goto(`${BASE}/breaks`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    const style = window.getComputedStyle(element);
    return { tag: element.tagName, text: (element.textContent ?? "").slice(0, 40), outline: style.outlineWidth };
  });
  if (!focused) throw new Error("nothing became focused after two tabs");
  ok("keyboard navigation moves focus", `${focused.tag} "${focused.text}" outline=${focused.outline}`);

  // 12 — WebGL lab actually renders and the ride loop starts
  await page.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const canvas = page.locator("canvas");
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox || canvasBox.width < 200) throw new Error("the WebGL canvas has no size");
  await page.locator("button", { hasText: "Drop in" }).first().click();
  await page.waitForTimeout(600);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyD");
  const hud = await page.locator("text=/\\d+\\.\\d+s · \\d+ pts/").first().innerText();
  if (!/pts/.test(hud)) throw new Error(`the ride HUD did not start: "${hud}"`);
  await page.locator("button", { hasText: "Kick out" }).first().click();
  await page.waitForTimeout(700);
  await shot(page, "07-wave-lab");
  ok("the WebGL lab rendered and the ride loop responds to the keyboard", hud);

  // 13 — mobile viewport
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 2) throw new Error(`horizontal overflow of ${overflow}px on mobile`);
  await mobilePage.locator("button", { hasText: "Menu" }).first().click();
  await mobilePage.waitForTimeout(400);
  const mobileRepo = await mobilePage.locator('#mobile-menu a[href="https://github.com/aniruddhaadak80/swellread"]').count();
  if (mobileRepo === 0) throw new Error("the mobile menu has no repository link");
  await shot(mobilePage, "08-landing-mobile-menu");
  await mobilePage.goto(`${BASE}/breaks/pago-pago`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await shot(mobilePage, "09-break-mobile");
  await mobile.close();
  ok("mobile viewport has no overflow and the menu carries the repo link", `390x844`);

  // 14 — reduced motion still renders the verdict
  const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const reducedScore = await reducedPage.locator("text=Read the water before you paddle out").count();
  if (reducedScore === 0) throw new Error("the page did not render with reduced motion");
  await reducedPage.goto(`${BASE}/breaks/pago-pago`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const reducedRibbon = await reducedPage.locator("svg[role='img']").count();
  if (reducedRibbon === 0) throw new Error("the ribbon is missing under reduced motion");
  await reduced.close();
  ok("everything still renders with prefers-reduced-motion", "landing + ribbon");

  await browser.close();

  // 15 — no console errors, page errors or failed requests anywhere in that journey
  const ignorable = /favicon|Download the React DevTools/i;
  const realConsoleErrors = consoleErrors.filter((entry) => !ignorable.test(entry));
  if (pageErrors.length) throw new Error(`uncaught page errors:\n${pageErrors.join("\n")}`);
  if (failedRequests.length) throw new Error(`failed requests:\n${failedRequests.join("\n")}`);
  if (badResponses.length) throw new Error(`non-2xx responses:\n${badResponses.slice(0, 20).join("\n")}`);
  if (realConsoleErrors.length) throw new Error(`console errors:\n${realConsoleErrors.join("\n")}`);
  ok(
    "no console errors, page errors, failed requests or non-2xx responses",
    `${pageErrors.length} page / ${realConsoleErrors.length} console / ${failedRequests.length} failed / ${badResponses.length} non-2xx`,
  );

  console.log(`\n${step} browser checks passed. Screenshots in ${SHOTS}/`);
}

main().catch(async (error) => {
  console.error("\nbrowser smoke failed:", error instanceof Error ? error.message : error);
  if (pageErrors.length) console.error("page errors:\n" + pageErrors.join("\n"));
  if (consoleErrors.length) console.error("console errors:\n" + consoleErrors.slice(0, 12).join("\n"));
  if (failedRequests.length) console.error("failed requests:\n" + failedRequests.slice(0, 12).join("\n"));
  if (badResponses.length) console.error("non-2xx responses:\n" + badResponses.slice(0, 20).join("\n"));
  process.exit(1);
});
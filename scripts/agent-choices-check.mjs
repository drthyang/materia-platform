/**
 * The Agent's clickable choices in a real browser (src/agent/choices.ts): the
 * Mn₃Ga Rietveld demo, the Agent in proxy mode, and the Messages API answered
 * by a script through Playwright's route interception, so the real chat loop,
 * executor and tools run and no model or provider is called. It checks that a
 * k-search's turn shows k buttons, that "Another k…" fills the message box,
 * that an option is reached by keyboard and sends exactly its message, that a
 * superseded set sends nothing, and that a set whose page changed (the user
 * sets k on the step) sends nothing and says so.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/agent-choices-check.mjs [baseUrl] [outDir]
 * CHROMIUM=/path/to/chrome overrides the browser (default: the one
 * Playwright installed under /opt/pw-browsers, else the system Chrome).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5173/materia-platform/";
const OUT = process.argv[3] ?? `${mkdtempSync(join(tmpdir(), "materia-choices-"))}/`;
mkdirSync(OUT, { recursive: true });
const executablePath = process.env.CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── the mocked model ───────────────────────────────────────────────────────
function sse(turn, n) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", { message: { id: `msg_${n}`, type: "message", role: "assistant", model: "scripted", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  let index = 0;
  if (turn.text) {
    out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
    out += ev("content_block_delta", { index, delta: { type: "text_delta", text: turn.text } });
    out += ev("content_block_stop", { index });
    index++;
  }
  for (const [j, call] of (turn.calls ?? []).entries()) {
    out += ev("content_block_start", { index, content_block: { type: "tool_use", id: `tu_${n}_${j}`, name: call.name, input: {} } });
    out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input ?? {}) } });
    out += ev("content_block_stop", { index });
    index++;
  }
  out += ev("message_delta", { delta: { stop_reason: turn.calls?.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
  out += ev("message_stop", {});
  return out;
}

const bodies = [];
const lastUser = (body) => {
  const users = (body.messages ?? []).filter((m) => m.role === "user");
  for (let i = users.length - 1; i >= 0; i--) {
    const c = users[i].content;
    if (typeof c === "string") return c;
    const t = c.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (t) return t;
  }
  return "";
};

/** The script: decides each model turn from the request (what the user said last, the tool results). */
function script(body) {
  const said = lastUser(body);
  const lastMsg = body.messages.at(-1);
  const answeringTools = Array.isArray(lastMsg.content) && lastMsg.content.some((b) => b.type === "tool_result");
  if (/^Find the propagation vector/.test(said)) {
    if (!answeringTools) return { text: "First the step's method and state.", calls: [{ name: "read_skill", input: { name: "magnetic-analysis" } }, { name: "magnetic_state" }] };
    const prev = [...body.messages].reverse().find((m) => m.role === "assistant");
    const searched = Array.isArray(prev?.content) && prev.content.some((b) => b.type === "tool_use" && b.name === "search_propagation_vector");
    if (!searched) {
      // The demo (600 K, paramagnetic) leaves only weak residual peaks: include the first six, as the user could ask.
      return { text: "Searching k on the residual peaks.", calls: [{ name: "search_propagation_vector", input: { include: [1, 2, 3, 4, 5, 6] } }] };
    }
    return { text: "The search lists several k. Which one should I set?" };
  }
  if (/^Set the propagation vector to k = /.test(said)) {
    // The model would call set_propagation_vector with the components; here it only answers, so the page stays as it was.
    return { text: "Noted. (Scripted: no change made.)" };
  }
  return { text: "(scripted end)" };
}

// ── the run ────────────────────────────────────────────────────────────────
const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  try {
    if (!sessionStorage.getItem("choices-check-init")) {
      localStorage.setItem("materia.agent.settings", JSON.stringify({ mode: "proxy" }));
      sessionStorage.setItem("choices-check-init", "1");
    }
  } catch {
    // Storage blocked: the settings stay the defaults, and the check fails visibly.
  }
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/api/anthropic/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proxy: true, key: true }) }));
await page.route("**/api/anthropic/v1/messages**", async (route) => {
  const body = JSON.parse(route.request().postData() ?? "{}");
  bodies.push(body);
  const turn = script(body);
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse(turn, bodies.length) });
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("header");
await page.getByRole("button", { name: "Demos ▾", exact: true }).click();
await page.getByRole("button", { name: "Rietveld · Mn₃Ga neutron TOF", exact: true }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /^Open the Copilot/ }).click();
const drawer = page.locator("aside.wb-agent");
await drawer.waitFor();

async function send(text) {
  await drawer.getByRole("textbox", { name: "Message the Copilot" }).fill(text);
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
}
async function idle() {
  const end = Date.now() + 120_000;
  await page.waitForTimeout(300);
  while (Date.now() < end) {
    const busy = await drawer.getByRole("button", { name: "Stop", exact: true }).isVisible().catch(() => false);
    if (!busy) return;
    await page.waitForTimeout(250);
  }
  throw new Error("turn did not end");
}

await send("Find the propagation vector from the residual peaks.");
await idle();
const group = drawer.locator('[data-choices="k"]').last();
const visible = await group.isVisible().catch(() => false);
check("a finished turn that ran the k-search shows k buttons", visible);
if (!visible) {
  await page.screenshot({ path: `${OUT}no-choices.png` });
  console.log(JSON.stringify(bodies.at(-1)?.messages?.slice(-2), null, 1).slice(0, 3000));
  await browser.close();
  process.exit(1);
}
await group.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}choices-live.png` });
const options = group.locator("button.wb-agent-choice:not(.is-other)");
const n = await options.count();
check("the set lists at least one k option", n >= 1, `${n} options`);
check("the set names k's units and cell", /reciprocal-lattice units of the structure's cell as loaded/.test(await group.innerText()));
const firstLabel = (await options.first().locator(".wb-agent-choice-label").innerText()).trim();
const firstSends = await options.first().getAttribute("data-message");
check("the option's label is exact (no rounded decimal)", /^★?\s*k = \([^)]*\)$/.test(firstLabel) && !/\d\.\d/.test(firstLabel), firstLabel);
check("the option sends a plain-fraction k message", /^Set the propagation vector to k = \(-?[\d/]+, -?[\d/]+, -?[\d/]+\)\.$/.test(firstSends ?? ""), firstSends ?? "");
check("the live options are enabled", await options.first().isEnabled());

// "Other…" fills the composer, does not send.
const before = bodies.length;
await group.locator("button.is-other").click();
const box = drawer.getByRole("textbox", { name: "Message the Copilot" });
const draft = await box.inputValue();
const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check("Another k… puts an editable template in the message box and focuses it, sending nothing", draft === "Set the propagation vector to k = (, , )." && focused === "Message the Copilot" && bodies.length === before, JSON.stringify({ draft, focused }));
await box.fill("");

// Keyboard: focus the first option and press Enter.
await options.first().focus();
const focusedIsOption = await page.evaluate(() => document.activeElement?.classList.contains("wb-agent-choice"));
check("an option takes keyboard focus", !!focusedIsOption);
// Tab moves to the next control in the set.
if (n > 1) {
  await page.keyboard.press("Tab");
  const second = await page.evaluate(() => document.activeElement?.getAttribute("data-message"));
  check("Tab moves to the next option", second === (await options.nth(1).getAttribute("data-message")), second ?? "");
  await page.keyboard.press("Shift+Tab");
}
const sentBefore = bodies.length;
await page.keyboard.press("Enter");
await idle();
const userBubbles = await drawer.locator('[data-transcript-user]').allInnerTexts();
check("Enter on the option sends its message as the user's bubble, exactly", userBubbles.at(-1) === firstSends, JSON.stringify(userBubbles.at(-1)));
const reqUser = lastUser(bodies[sentBefore] ?? {});
check("the request's new user message is the option's message, exactly", reqUser === firstSends, JSON.stringify(reqUser));
await page.screenshot({ path: `${OUT}choices-after-click.png` });

// The old set is superseded: disabled, and says so.
const old = drawer.locator('[data-choices="k"]').first();
const oldState = await old.getAttribute("data-state");
const oldEnabled = await old.locator("button.wb-agent-choice").first().isEnabled();
check("after the conversation moved on, the old buttons are disabled", oldState === "superseded" && !oldEnabled, `${oldState}, enabled ${oldEnabled}`);
const sentCount = bodies.length;
await old.locator("button.wb-agent-choice").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(500);
check("clicking a superseded button sends nothing", bodies.length === sentCount);

// A live set re-validates against the page: run the search again, then change the page, then click.
await send("Find the propagation vector again.");
await idle();
const live = drawer.locator('[data-choices="k"]').last();
check("a new search shows a live set", (await live.getAttribute("data-state")) === "live");
// Change the page under it: a user edit of the magnetic step's k (the step's own control), or, failing that, Undo.
// The user sets k on the step's own control (its k inputs and Set k): the page's stamp moves.
await page.getByRole("button", { name: "Magnetic analysis →" }).click().catch(() => {});
const setK = page.getByRole("button", { name: "Set k", exact: true });
const kInputs = setK.locator("xpath=..").locator("input");
let pageChanged = false;
if ((await kInputs.count()) === 3) {
  await kInputs.nth(0).fill("0");
  await kInputs.nth(1).fill("0");
  await kInputs.nth(2).fill("0.5");
  await setK.click();
  await page.waitForTimeout(800);
  pageChanged = /k = \(0 0 ½\)/.test(await page.locator("body").innerText());
}
check("the page was changed under the live set (the user set k = (0 0 ½) on the step)", pageChanged);
await page.waitForTimeout(500);
const count2 = bodies.length;
const liveOpt = live.locator("button.wb-agent-choice:not(.is-other)").first();
await liveOpt.click({ force: true }).catch(() => {});
await page.waitForTimeout(800);
const staleState = await live.getAttribute("data-state");
const noticeText = await drawer.innerText();
check("a click after the page changed sends nothing", bodies.length === count2);
check("…and the set shows it is stale, with a notice", staleState === "stale" && /changed since/.test(noticeText), staleState ?? "");
await page.screenshot({ path: `${OUT}choices-stale.png` });

check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(`${OUT}results.json`, JSON.stringify({ results, requests: bodies.length }, null, 1));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);

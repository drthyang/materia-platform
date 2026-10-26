/**
 * The Agent's own question (ask_user) in a real browser: the Mn₃Ga Rietveld
 * demo, the Agent in proxy mode, and the Messages API answered by a script
 * through Playwright's route interception, so the real chat loop, executor
 * and tools run and no model or provider is called. It checks that a turn
 * that calls ask_user ends there (one request, the call after it not run) and
 * shows the question with its buttons; that "Something else…" focuses an empty
 * message box showing the hint and sends nothing; that an option is reached
 * by keyboard and sends exactly its message; that the change the answer leads
 * to still shows its approval card; and that the old question is then
 * superseded and sends nothing.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/agent-ask-user-check.mjs [baseUrl] [outDir]
 * CHROMIUM=/path/to/chrome overrides the browser (default: the one
 * Playwright installed under /opt/pw-browsers, else the system Chrome).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5173/materia-platform/";
const OUT = process.argv[3] ?? `${mkdtempSync(join(tmpdir(), "materia-ask-user-"))}/`;
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
const answering = (body) => {
  const last = body.messages.at(-1);
  return Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
};

const QUESTION = "The pattern is aligned. Which block should go next?";
const OPTIONS = [
  { label: "Hold the scale", message: "Hold the scale fixed." },
  { label: "Free the B values", message: "Free the B values and refine." },
];
const HINT = "e.g. free only the Mn positions";

/** The script: decides each model turn from the request (what the user said last, the tool results). */
function script(body) {
  const said = lastUser(body);
  if (/^Where next\?/.test(said)) {
    // The question, then a call after it that must not run.
    return { text: "Two ways on from here.", calls: [{ name: "ask_user", input: { question: QUESTION, options: OPTIONS, other: HINT } }, { name: "get_state" }] };
  }
  if (said === OPTIONS[0].message) {
    if (!answering(body)) return { text: "Holding the scale.", calls: [{ name: "read_skill", input: { name: "my-rietveld-workflow" } }, { name: "set_free", input: { fix: ["scale"] } }] };
    return { text: "Understood." };
  }
  return { text: "(scripted end)" };
}

// ── the run ────────────────────────────────────────────────────────────────
const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  try {
    if (!sessionStorage.getItem("ask-check-init")) {
      localStorage.setItem("materia.agent.settings", JSON.stringify({ mode: "proxy" }));
      sessionStorage.setItem("ask-check-init", "1");
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
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse(script(body), bodies.length) });
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("header");
await page.getByRole("button", { name: /Mn₃Ga neutron TOF/ }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /^Open the Copilot/ }).click();
const drawer = page.locator("aside.wb-agent");
await drawer.waitFor();
const box = drawer.getByRole("textbox", { name: "Message the Copilot" });

async function send(text) {
  await box.fill(text);
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

const tools = bodies.length;
await send("Where next?");
await idle();
check("the question's turn made one request: it ended at the tool", bodies.length === tools + 1, `${bodies.length - tools} request(s)`);
const toolsOffered = (bodies.at(-1)?.tools ?? []).map((t) => t.name);
check("the model is offered ask_user", toolsOffered.includes("ask_user"));
const group = drawer.locator('[data-choices="question"]').last();
const visible = await group.isVisible().catch(() => false);
check("the turn shows the question with buttons", visible);
if (!visible) {
  await page.screenshot({ path: `${OUT}no-question.png` });
  await browser.close();
  process.exit(1);
}
await group.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}ask-live.png` });
check("the group is named by the question", (await group.getAttribute("aria-label")) === QUESTION && (await group.locator(".wb-agent-choices-head").innerText()).trim() === QUESTION);
const options = group.locator("button.wb-agent-choice:not(.is-other)");
const labels = (await options.locator(".wb-agent-choice-label").allInnerTexts()).map((t) => t.trim());
const sends = await Promise.all((await options.all()).map((o) => o.getAttribute("data-message")));
check("one button per option, in order, each sending exactly its message", JSON.stringify(labels) === JSON.stringify(OPTIONS.map((o) => o.label)) && JSON.stringify(sends) === JSON.stringify(OPTIONS.map((o) => o.message)), JSON.stringify({ labels, sends }));
check("the live options are enabled, none starred", (await options.first().isEnabled()) && (await group.locator(".is-recommended").count()) === 0);
const stepTools = await drawer.locator(".wb-agent-step").evaluateAll((els) => els.map((e) => e.getAttribute("data-tool")));
check("the call after the question did not run (no get_state step)", stepTools.includes("ask_user") && !stepTools.includes("get_state"), JSON.stringify(stepTools));

// "Something else…": an empty box with the hint, focused; nothing sent.
const before = bodies.length;
await group.locator("button.is-other").click();
const draft = await box.inputValue();
const placeholder = await box.getAttribute("placeholder");
const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check("Something else… focuses an empty message box showing the hint, sending nothing", draft === "" && placeholder === HINT && focused === "Message the Copilot" && bodies.length === before, JSON.stringify({ draft, placeholder, focused }));

// Keyboard: the first option, Tab to the second, back, Enter.
await options.first().focus();
await page.keyboard.press("Tab");
const second = await page.evaluate(() => document.activeElement?.getAttribute("data-message"));
check("Tab moves to the next option", second === OPTIONS[1].message, second ?? "");
await page.keyboard.press("Shift+Tab");
const sentBefore = bodies.length;
await page.keyboard.press("Enter");
// The change the answer leads to waits for its approval card (Ask first).
const card = drawer.locator('.wb-agent-step[data-tool="set_free"][data-status="waiting"]');
const carded = await card.waitFor({ timeout: 60_000 }).then(() => true, () => false);
check("the change the answer leads to shows its approval card", carded && (await card.getByRole("button", { name: "Approve" }).isVisible()));
await page.screenshot({ path: `${OUT}ask-approval.png` });
const userBubbles = await drawer.locator("[data-transcript-user]").allInnerTexts();
check("Enter sent the option's message as the user's bubble, exactly", userBubbles.at(-1) === OPTIONS[0].message, JSON.stringify(userBubbles.at(-1)));
check("the request's new user message is the option's message, exactly", lastUser(bodies[sentBefore] ?? {}) === OPTIONS[0].message, JSON.stringify(lastUser(bodies[sentBefore] ?? {})));
const prior = (bodies[sentBefore]?.messages ?? []).filter((m) => m.role === "user" && Array.isArray(m.content)).flatMap((m) => m.content).filter((b) => b.type === "tool_result");
check("the call after the question was answered 'Not run' in the history", prior.some((b) => b.is_error && /Not run: your turn ended with the question/.test(typeof b.content === "string" ? b.content : JSON.stringify(b.content))));
if (carded) await card.getByRole("button", { name: "Decline" }).click();
await idle();

// The old question is superseded: disabled, and a click sends nothing.
const old = drawer.locator('[data-choices="question"]').first();
const oldState = await old.getAttribute("data-state");
const oldEnabled = await old.locator("button.wb-agent-choice").first().isEnabled();
check("after the conversation moved on, the question's buttons are disabled", oldState === "superseded" && !oldEnabled, `${oldState}, enabled ${oldEnabled}`);
const count = bodies.length;
await old.locator("button.wb-agent-choice").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(500);
check("clicking a superseded option sends nothing", bodies.length === count);
await page.screenshot({ path: `${OUT}ask-after.png` });

check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(`${OUT}results.json`, JSON.stringify({ results, requests: bodies.length }, null, 1));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);

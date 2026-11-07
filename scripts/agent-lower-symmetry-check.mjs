/**
 * The Agent lowers the symmetry in a real browser: the GaTa₄Se₈ PDF demo and
 * a synthetic SrTiO₃ G(r), the Agent in proxy mode, the Messages API answered
 * by a script through Playwright's route interception, so the real chat loop,
 * executor and tools run and no model or provider is called. It checks that
 * list_subgroups gives the Subgroups view's row, that lower_symmetry waits
 * for its card in Ask mode and then leaves the page the view's Activate
 * leaves (the Subgroups banner, the child in the 3D model and the Structure
 * card), that clear_subgroup and the banner's ✕ clear go back to the parent,
 * that the group and cell the user names lower the row's default variant and
 * say so, and that a name several rows share returns the candidates and
 * changes nothing.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/agent-lower-symmetry-check.mjs [baseUrl] [outDir] [inputsDir]
 * inputsDir holds SrTiO3_synthetic.cif and SrTiO3_synthetic.gr (cubic SrTiO₃
 * and its neutron G(r)); without it the SrTiO₃ part is skipped.
 * CHROMIUM=/path/to/chrome overrides the browser (default: the system Chrome).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5173/materia-platform/";
const OUT = process.argv[3] ?? `${mkdtempSync(join(tmpdir(), "materia-lower-symmetry-"))}/`;
const INPUTS = process.argv[4] ?? null;
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
/** The user's last typed message. */
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
/** The last assistant turn's calls by name, with their results' text, when the request answers them. */
function answered(body) {
  const msgs = body.messages ?? [];
  const last = msgs.at(-1);
  if (!last || last.role !== "user" || !Array.isArray(last.content) || !last.content.some((b) => b.type === "tool_result")) return null;
  const asst = msgs.at(-2);
  const uses = Array.isArray(asst?.content) ? asst.content.filter((b) => b.type === "tool_use") : [];
  const out = {};
  for (const u of uses) {
    const r = last.content.find((b) => b.type === "tool_result" && b.tool_use_id === u.id);
    const text = typeof r?.content === "string" ? r.content : (r?.content ?? []).map((x) => x.text ?? "").join("");
    out[u.name] = { text, isError: !!r?.is_error };
  }
  return out;
}
const parse = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

const ASK_GATA = "Use P-42₁m in a 1×1×2 cell (c doubled): lower the symmetry to it.";
const ASK_AMBIGUOUS = "Lower it to P-42₁m.";
const ASK_CLEAR = "Back to the parent, please.";
const ASK_X = "Now lower it to P-42₁m at X, in the parent's cell.";
const ASK_STO = "Lower SrTiO3 to Pnma in the 2×2×2 cell (a⁻b⁺a⁻).";
/** What the scripted Agent got back, for the checks. */
const seen = {};

/** The script: each model turn from the request (what the user said last, the tool results). */
function script(body) {
  const said = lastUser(body);
  const got = answered(body);
  if (said === ASK_GATA) {
    if (!got) return { text: "Your method first, then the Subgroups view's list for 1×1×2.", calls: [{ name: "read_skill", input: { name: "pdf-workflow" } }, { name: "list_subgroups", input: { bound: "1×1×2", name: "P-42_1m", cell: "1×1×2" } }] };
    if (got.list_subgroups) {
      seen.list = parse(got.list_subgroups.text);
      const id = seen.list?.rows?.[0]?.id;
      seen.listedId = id;
      return { text: "One row, four classes: lowering to its default.", calls: [{ name: "lower_symmetry", input: { name: "P-42_1m", cell: "1×1×2" } }] };
    }
    if (got.lower_symmetry) {
      seen.lower = parse(got.lower_symmetry.text);
      return { text: "Lowered to P-42₁m #113 in its own 1×1×2 cell; the order parameter's modes are free." };
    }
  }
  if (said === ASK_CLEAR) {
    if (!got) return { calls: [{ name: "clear_subgroup" }] };
    seen.clear = parse(got.clear_subgroup?.text ?? "");
    return { text: "Back to F-43m." };
  }
  if (said === ASK_AMBIGUOUS) {
    if (!got) return { calls: [{ name: "lower_symmetry", input: { name: "P-42_1m", bound: "1×1×2" } }] };
    seen.ambiguous = parse(got.lower_symmetry?.text ?? "");
    return { text: "Two rows match, in the parent's cell and in 1×1×2; which one?" };
  }
  if (said === ASK_X) {
    if (!got) return { calls: [{ name: "lower_symmetry", input: { name: "P-42_1m", cell: "same cell", variant: 1 } }] };
    seen.x = parse(got.lower_symmetry?.text ?? "");
    return { text: "Lowered to P-42₁m at X in the parent's cell." };
  }
  if (said === ASK_STO) {
    if (!got) return { text: "Your method, then the 2×2×2 list.", calls: [{ name: "read_skill", input: { name: "pdf-workflow" } }, { name: "list_subgroups", input: { bound: "2×2×2", name: "Pnma", cell: "2×2×2" } }] };
    if (got.list_subgroups) {
      seen.stoList = parse(got.list_subgroups.text);
      const row = (seen.stoList?.rows ?? []).find((r) => r.domains === 24);
      return { text: "Lowering to the a⁻b⁺a⁻ row.", calls: [{ name: "lower_symmetry", input: { id: row?.id } }] };
    }
    if (got.lower_symmetry) {
      seen.stoLower = parse(got.lower_symmetry.text);
      return { text: "Lowered to Pnma in its own 2×2×2 cell." };
    }
  }
  return { text: "(scripted end)" };
}

// ── the run ────────────────────────────────────────────────────────────────
const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript(() => {
  try {
    if (!sessionStorage.getItem("lower-check-init")) {
      localStorage.setItem("materia.agent.settings", JSON.stringify({ mode: "proxy" }));
      sessionStorage.setItem("lower-check-init", "1");
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
await page.getByRole("button", { name: /GaTa₄Se₈ X-ray G\(r\)/ }).click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /^Open the Copilot/ }).click();
const drawer = page.locator("aside.wb-agent");
await drawer.waitFor();
const box = drawer.getByRole("textbox", { name: "Message the Copilot" });

async function send(text) {
  await box.fill(text);
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
}
async function idle(ms = 180_000) {
  const end = Date.now() + ms;
  await page.waitForTimeout(400);
  while (Date.now() < end) {
    const busy = await drawer.getByRole("button", { name: "Stop", exact: true }).isVisible().catch(() => false);
    if (!busy) return;
    await page.waitForTimeout(250);
  }
  throw new Error("turn did not end");
}
/** Approve the change card of `tool`, once it waits. */
async function approve(tool, shot) {
  const card = drawer.locator(`.wb-agent-step[data-tool="${tool}"][data-status="waiting"]`);
  const shown = await card.waitFor({ timeout: 180_000 }).then(() => true, () => false);
  check(`${tool} waits for its approval card (Ask first)`, shown);
  if (!shown) return "";
  const line = (await card.innerText()).replace(/\s+/g, " ");
  if (shot) await page.screenshot({ path: `${OUT}${shot}` });
  await card.getByRole("button", { name: "Approve" }).click();
  return line;
}
const banner = () => page.locator(".wb-subgroups [role=status]", { hasText: "▼" }).first();
const bannerText = async () => ((await banner().isVisible().catch(() => false)) ? (await banner().innerText()).replace(/\s+/g, " ") : "");
const structureCard = async () => (await page.locator("body").innerText()).match(/child of [^\n]+/)?.[0] ?? "";

// 1. GaTa₄Se₈: P-42₁m in 1×1×2, by the list's row.
await send(ASK_GATA);
const cardLine = await approve("lower_symmetry", "gata-1x1x2-card.png");
await idle();
check("list_subgroups gives the 1×1×2 P-42₁m row, four classes, its default's id", seen.list?.rows?.length === 1 && seen.list.rows[0].cell === "1×1×2" && seen.list.rows[0].variants === 4 && /^c\d+@1×1×2$/.test(seen.list.rows[0].id), JSON.stringify(seen.list?.rows));
check("the card names the row before anything changes", /Lower F-43m #216 to P-42₁m #113 · 1×1×2 · 24 domains/.test(cardLine), cardLine.slice(0, 200));
check("lower_symmetry by name and cell lowers the listed row's default variant, and names the others", seen.lower?.row === seen.listedId && seen.lower?.bound === "1×1×2" && /^1 of 4, the default; the others: c\d+@1×1×2, c\d+@1×1×2, c\d+@1×1×2$/.test(seen.lower?.variant ?? ""), JSON.stringify({ row: seen.lower?.row, bound: seen.lower?.bound, variant: seen.lower?.variant }));
check("lower_symmetry answers with the child, its cell, sites, free modes and kicked irreps", seen.lower?.lowered?.to === "P -4 21 m #113" && seen.lower.lowered.cell === "in its own cell, 1×1×2" && seen.lower.lowered.atoms === 104 && seen.lower.lowered.kicked?.length === 2, JSON.stringify(seen.lower?.lowered ?? seen.lower)?.slice(0, 300));
await page.waitForTimeout(800);
const b1 = await bannerText();
check("the Subgroups view opens on the banner: lowered to P -4 21 m #113 in its own 1×1×2 cell", b1.includes("▼ lowered to P -4 21 m #113 · in its own cell, 1×1×2"), b1.slice(0, 160));
await page.screenshot({ path: `${OUT}gata-1x1x2-banner.png` });
const card1 = await structureCard();
check("the Structure card says the page fits the child", /child of /.test(card1), card1);
await page.getByRole("button", { name: "3D Model", exact: true }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}gata-1x1x2-3d.png` });
const model3d = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("the 3D Model view shows the child's modes", /lowered to P -4 21 m|P -4 21 m #113|P-42₁m/.test(model3d) && /X irrep 5 of 5/.test(model3d), model3d.match(/.{0,60}X irrep 5 of 5.{0,40}/)?.[0] ?? "");

// 2. A name two rows share (the parent's cell, 1×1×2): the candidates, nothing changed (a subgroup is in force, so first back to the parent).
await send(ASK_CLEAR);
const clearLine = await approve("clear_subgroup");
await idle();
check("clear_subgroup's card says what it drops", /Back to F-43m #216/.test(clearLine), clearLine.slice(0, 160));
check("clear_subgroup answers with the parent's group", seen.clear?.spaceGroup === "F-43m #216", JSON.stringify(seen.clear)?.slice(0, 200));
await page.getByRole("button", { name: "Subgroups", exact: true }).click();
await page.waitForTimeout(800);
check("after clear_subgroup no banner: the parent's symmetry", (await bannerText()) === "");
check("the Structure card no longer names a child", (await structureCard()) === "");
await page.screenshot({ path: `${OUT}gata-cleared.png` });
const requestsBefore = bodies.length;
await send(ASK_AMBIGUOUS);
await idle();
check("a name two rows share: the candidates, no card, nothing changed", seen.ambiguous?.unchanged === true && seen.ambiguous.count === 2 && (await bannerText()) === "" && (await drawer.locator('.wb-agent-step[data-tool="lower_symmetry"][data-status="waiting"]').count()) === 0, JSON.stringify(seen.ambiguous)?.slice(0, 240));
check("the ambiguous call took one model turn and an answer", bodies.length === requestsBefore + 2, `${bodies.length - requestsBefore} requests`);

// 3. P-42₁m at X in the parent's cell, then the banner's own ✕ clear.
await send(ASK_X);
await approve("lower_symmetry");
await idle();
await page.waitForTimeout(800);
const b2 = await bannerText();
check("P-42₁m at X: lowered in the parent's cell", /▼ lowered to X irrep 5 of 5 → P -4 21 m · in the parent's cell/.test(b2), b2.slice(0, 160));
await page.screenshot({ path: `${OUT}gata-x-banner.png` });
await banner().getByRole("button", { name: "✕ clear" }).click();
await page.waitForTimeout(800);
check("the banner's ✕ clear returns to the parent", (await bannerText()) === "");
await page.screenshot({ path: `${OUT}gata-x-ui-cleared.png` });

// 4. SrTiO₃ (synthetic): Pnma in 2×2×2.
if (INPUTS) {
  // A new analysis: close this one (discarding it), then Load CIF… and Load data… on the start page, which routes a G(r) to the PDF page.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  if (await discard.isVisible({ timeout: 3000 }).catch(() => false)) await discard.click();
  await page.waitForTimeout(1000);
  const cif = page.locator('label:has-text("Load CIF…") input[type=file]');
  await cif.setInputFiles(join(INPUTS, "SrTiO3_synthetic.cif"));
  await page.waitForTimeout(1500);
  const data = page.locator('label:has-text("Load data…") input[type=file]');
  await data.setInputFiles(join(INPUTS, "SrTiO3_synthetic.gr"));
  await page.waitForTimeout(2500);
  check("SrTiO₃ loaded on the PDF page", /SrTiO3/.test(await page.locator("body").innerText()));
  await send(ASK_STO);
  await approve("lower_symmetry", "sto-pnma-card.png");
  await idle();
  await page.waitForTimeout(800);
  const b3 = await bannerText();
  check("SrTiO₃: lowered to P n m a #62 in its own 2×2×2 cell", b3.includes("▼ lowered to P n m a #62 · in its own cell, 2×2×2"), b3.slice(0, 160));
  check("the Pnma row kicks the tilts (M and R irreps)", JSON.stringify(seen.stoLower?.lowered?.kicked ?? []).includes("R irrep 8 of 10") && /M irrep \d+ of 10/.test(JSON.stringify(seen.stoLower?.lowered?.kicked ?? [])), JSON.stringify(seen.stoLower?.lowered?.kicked));
  await page.screenshot({ path: `${OUT}sto-pnma-banner.png` });
  await page.getByRole("button", { name: "3D Model", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}sto-pnma-3d.png` });
  await page.getByRole("button", { name: "Subgroups", exact: true }).click();
  await page.waitForTimeout(500);
  await banner().getByRole("button", { name: "✕ clear" }).click();
  await page.waitForTimeout(800);
  check("SrTiO₃: ✕ clear returns to Pm-3m", (await bannerText()) === "");
}

check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(`${OUT}results.json`, JSON.stringify({ results, requests: bodies.length, seen }, null, 1));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);

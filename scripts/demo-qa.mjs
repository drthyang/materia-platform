/**
 * Demo QA: every public demo end to end on the production build, in headless
 * Chrome, at three viewports (1600×900, 1280×800, 390×844). It records, for
 * each step, the page errors, console errors and warnings, failed requests,
 * broken states and anything slower than ~2 s, and writes a JSON + Markdown
 * summary beside the screenshots. docs/demo-qa.md has the checklist it
 * covers and the last run's results.
 *
 * Only public inputs: the bundled demos (Mn₃Ga POWGEN, GaTa₄Se₈ PDF) and a
 * synthetic SrTiO₃ CIF + G(r) written by scripts/write-srtio3-pdf.ts. The
 * Copilot runs with no API key, then against a scripted model through
 * Playwright's route interception: no model or provider is ever called.
 *
 * Usage:  npm run build
 *         node scripts/demo-qa.mjs [outDir] [--base=http://localhost:4173/materia-platform/] [--only=1600,390] [--steps=1,2]
 * Without --base it starts `vite preview` on port 4317 itself. The browser is
 * the system Chrome (playwright-core, no download); CHROMIUM=/path overrides.
 */
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const OUT = resolve(args.find((a) => !a.startsWith("--")) ?? join(tmpdir(), "materia-demo-qa"));
const SLOW_MS = 2000;
const ONLY = flag("only")?.split(",").map(Number);
const STEPS = flag("steps")?.split(",").map(Number);
const VIEWPORTS = [
  { name: "1600x900", width: 1600, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "390x844", width: 390, height: 844, phone: true },
].filter((v) => !ONLY || ONLY.includes(v.width));
mkdirSync(OUT, { recursive: true });

// ── the inputs: synthetic SrTiO₃ (testSupport), written once ────────────────
const INPUTS = join(OUT, "inputs");
if (!existsSync(join(INPUTS, "SrTiO3_synthetic.gr"))) {
  execFileSync("npx", ["vite-node", "scripts/write-srtio3-pdf.ts", INPUTS], { cwd: ROOT, stdio: "inherit" });
}

// ── the server: vite preview of the production build ──────────────────────
let server = null;
let BASE = flag("base");
if (!BASE) {
  if (!existsSync(join(ROOT, "dist", "index.html"))) throw new Error("no dist/: run `npm run build` first");
  server = spawn("npx", ["vite", "preview", "--port", "4317", "--strictPort"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  BASE = "http://localhost:4317/materia-platform/";
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
})();

// ── recording ──────────────────────────────────────────────────────────────
/** The expected probe: the local-only magnetic demo's file, absent from every public build. */
const EXPECTED_PROBE = /\/data\/.*solution|\/data\//;
const results = [];
let current = null;
/** A 404 the step asked for: the local-only probe, or the static site's missing proxy (simulated in step 5). */
const isExpected = (url) => EXPECTED_PROBE.test(url) || (current?.allow ?? []).some((re) => re.test(url));

function attach(page) {
  page.on("pageerror", (e) => current?.pageErrors.push(String(e.message ?? e)));
  page.on("console", (m) => {
    const t = m.type();
    if (t !== "error" && t !== "warning" && t !== "verbose") return;
    const line = `${t}: ${m.text().slice(0, 400)}`;
    // The browser's own line for an expected 404 (the probe, a simulated static site) is listed with it.
    if (/Failed to load resource/.test(m.text()) && isExpected(m.location()?.url ?? "")) current?.expected.push(line);
    else current?.console.push(line);
  });
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    // A download's navigation and a scripted stream's abort are not failures of the page.
    if (/ERR_ABORTED/.test(why) && /blob:|data:/.test(r.url())) return;
    current?.network.push(`failed ${r.url()} ${why}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const line = `${r.status()} ${r.url()}`;
    if (isExpected(r.url())) current?.expected.push(line);
    else current?.network.push(line);
  });
}

async function step(vp, id, name, fn) {
  if (STEPS && !STEPS.includes(id)) return;
  current = { viewport: vp.name, id, name, pageErrors: [], console: [], network: [], expected: [], broken: [], timings: [], notes: [], screenshots: [] };
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    current.broken.push(`threw: ${String(e.message ?? e).split("\n")[0]}`);
  }
  current.ms = Date.now() - t0;
  current.slow = current.timings.filter((t) => t.ms > SLOW_MS && !t.background).map((t) => `${t.label} ${t.ms} ms`);
  current.ok = current.pageErrors.length === 0 && current.console.filter((c) => !c.startsWith("verbose")).length === 0 && current.network.length === 0 && current.broken.length === 0;
  results.push(current);
  const flagText = [
    current.pageErrors.length && `${current.pageErrors.length} page errors`,
    current.console.length && `${current.console.length} console`,
    current.network.length && `${current.network.length} network`,
    current.broken.length && `${current.broken.length} broken`,
    current.slow.length && `slow: ${current.slow.join(", ")}`,
  ].filter(Boolean).join(" · ");
  console.log(`${current.ok ? "PASS" : "FAIL"} [${vp.name}] ${id}. ${name} (${(current.ms / 1000).toFixed(1)} s)${flagText ? ` — ${flagText}` : ""}`);
  for (const b of current.broken) console.log(`     broken: ${b}`);
  for (const e of current.pageErrors) console.log(`     page error: ${e}`);
  for (const c of current.console) console.log(`     console ${c}`);
  for (const n of current.network) console.log(`     network ${n}`);
}

/** Time one action; `background` marks work that runs off the main thread with progress shown (listed, not flagged). */
async function timed(label, fn, { background = false } = {}) {
  const t0 = Date.now();
  const v = await fn();
  current.timings.push({ label, ms: Date.now() - t0, background });
  return v;
}
const expect = (cond, what) => {
  if (!cond) current.broken.push(what);
  return cond;
};
const note = (s) => current.notes.push(s);

/**
 * A screenshot that keeps the app's © line: when the page's own footer is out
 * of view (a phone mid-page, a sheet over it), the same line is pinned to the
 * corner for the shot and removed after.
 */
async function shot(page, vp, name) {
  const file = `${vp.name}-${name}.png`;
  const inView = await page.evaluate(() => {
    const el = [...document.querySelectorAll("footer span, footer")].find((e) => /© \d{4} Tsung-Han Yang/.test(e.textContent ?? ""));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom <= 0 || r.top >= innerHeight) return false;
    const top = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
    return !!top && (el.contains(top) || top.contains(el));
  });
  if (!inView) {
    await page.evaluate(() => {
      const tag = document.createElement("div");
      tag.id = "qa-copyright";
      tag.textContent = "© 2026 Tsung-Han Yang";
      Object.assign(tag.style, { position: "fixed", left: "8px", bottom: "8px", zIndex: "2147483647", font: "11px/1.4 system-ui, sans-serif", color: "#6b6357", background: "rgba(255,255,255,0.85)", padding: "2px 6px", borderRadius: "4px", pointerEvents: "none" });
      document.body.appendChild(tag);
    });
  }
  await page.screenshot({ path: join(OUT, file) });
  if (!inView) await page.evaluate(() => document.getElementById("qa-copyright")?.remove());
  current.screenshots.push(file);
}

/** The working card's title row: its figures (wR, GoF, Rw) are not cut by the view tabs. */
async function headFits(page, where) {
  const over = await page.locator(".wb-card-head").first().evaluate((e) => {
    const lead = e.firstElementChild;
    return lead ? lead.scrollWidth - lead.clientWidth : 0;
  }).catch(() => 0);
  expect(over <= 1, `${where}: the card's title row fits (its figures overflow by ${over}px)`);
}

/** On a phone a Subgroups row opens its detail as a sheet: its ‹ Back returns to the list. */
async function backFromSheet(page) {
  const back = page.getByRole("button", { name: /^‹?\s*Back$/ }).filter({ visible: true });
  if (await back.count()) {
    await back.first().click();
    await page.waitForTimeout(250);
  }
}

/** Every overlay a recorded screen keeps: the app's © line. */
async function copyrightShown(page) {
  return (await page.getByText(/© \d{4} Tsung-Han Yang/).count()) > 0;
}

// ── helpers on the page ────────────────────────────────────────────────────
const until = async (page, cond, ms = 60_000, every = 200) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await page.waitForTimeout(every);
  }
  return false;
};
const bodyText = (page) => page.locator("body").innerText();

async function freshPage(context) {
  const page = await context.newPage();
  attach(page);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("header");
  return page;
}

async function openDemo(page, which) {
  const name = which === "rietveld" ? /Mn₃Ga neutron TOF/ : /GaTa₄Se₈ X-ray G\(r\)/;
  await timed(`open ${which} demo`, async () => {
    await page.getByRole("button", { name }).click();
    await page.getByRole("button", { name: "Refine", exact: true }).first().waitFor({ timeout: 30_000 });
  });
}

/** The page's main Refine (on a phone it is in the bottom action bar). */
const refineButton = (page) => page.getByRole("button", { name: "Refine", exact: true }).first();

async function refine(page, label = "Refine") {
  const btn = refineButton(page);
  await timed(label, async () => {
    await btn.click();
    await page.waitForTimeout(150);
    expect(await until(page, () => btn.isEnabled(), 120_000, 150), `${label}: the Refine button came back`);
  });
}

async function chooseFile(page, trigger, file) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10_000 }), trigger.click()]);
  await chooser.setFiles(file);
}

async function closeProject(page) {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  if (await discard.isVisible({ timeout: 2000 }).catch(() => false)) await discard.click();
  return until(page, async () => (await page.getByText("Start with a demo").count()) > 0, 10_000);
}

/** A main-view tab by its label (Refinement, Validation, 3D Model, Subgroups, Posterior, Boxcar). */
const tab = (page, name) => page.getByRole("button", { name, exact: true }).first();

async function download(page, trigger, label) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), trigger()]);
  const file = join(OUT, "downloads", d.suggestedFilename());
  mkdirSync(join(OUT, "downloads"), { recursive: true });
  await d.saveAs(file);
  note(`${label}: ${d.suggestedFilename()}`);
  return file;
}

async function exportMenu(page, item) {
  const header = page.locator("header").first();
  await header.getByRole("button", { name: "Export ▾" }).click();
  await header.getByRole("button", { name: item, exact: true }).click();
}

// ── the scripted model (no API spend) ──────────────────────────────────────
function sse(turn, n) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const usage = { input_tokens: turn.inputTokens ?? 2000, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let out = ev("message_start", { message: { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage } });
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
  out += ev("message_delta", { delta: { stop_reason: turn.calls?.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } });
  out += ev("message_stop", {});
  return out;
}
const lastUserText = (body) => {
  const users = (body.messages ?? []).filter((m) => m.role === "user");
  for (let i = users.length - 1; i >= 0; i--) {
    const c = users[i].content;
    if (typeof c === "string") return c;
    const t = c.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (t) return t;
  }
  return "";
};
const answersTool = (body) => {
  const last = (body.messages ?? []).at(-1);
  return !!last && last.role === "user" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
};
/** The tool the last assistant turn called. */
const lastCall = (body) => {
  const asst = (body.messages ?? []).at(-2);
  return Array.isArray(asst?.content) ? asst.content.find((b) => b.type === "tool_use")?.name : undefined;
};
/** Each message names its context level; "refine" asks for a page change (an approval card in Ask first). */
function script(body) {
  const said = lastUserText(body);
  const tokens = /red/.test(said) ? 960_000 : /amber/.test(said) ? 760_000 : 20_000;
  // The method first (changes wait until it is read), then the change, then the answer.
  if (/refine/.test(said) && !answersTool(body)) return { text: "Your method first.", calls: [{ name: "read_skill", input: { name: "my-rietveld-workflow" } }], inputTokens: tokens };
  if (/refine/.test(said) && lastCall(body) === "read_skill") return { text: "Refining the free parameters.", calls: [{ name: "refine", input: {} }], inputTokens: tokens };
  return { text: `Done (${/red|amber/.exec(said)?.[0] ?? "neutral"}).`, inputTokens: tokens };
}

// ── the steps ──────────────────────────────────────────────────────────────
async function step1(context, vp) {
  await step(vp, 1, "Start page, each demo card, a CIF and G(r) by hand (synthetic SrTiO₃)", async () => {
    const page = await freshPage(context);
    expect(await page.getByText("Start with a demo").isVisible(), "the start page shows its demos");
    expect(await copyrightShown(page), "the © line shows");
    const cards = await page.locator("button", { hasText: /Rietveld · reciprocal space|PDF · real space|Magnetic/ }).count();
    expect(cards === 2, `two public demo cards (found ${cards})`);
    await shot(page, vp, "1-start");
    await openDemo(page, "rietveld");
    expect(/Mn3Ga \+ MnO/.test(await bodyText(page)), "Mn₃Ga card opens the two-phase fit");
    await shot(page, vp, "1-rietveld-card");
    expect(await closeProject(page), "Close returns to the start page");
    await openDemo(page, "pdf");
    expect(/GaTa4Se8/.test(await bodyText(page)), "GaTa₄Se₈ card opens the PDF fit");
    await shot(page, vp, "1-pdf-card");
    expect(await closeProject(page), "Close returns to the start page");
    await timed("load CIF by hand", async () => {
      await chooseFile(page, page.getByText("Load CIF…").first(), join(INPUTS, "SrTiO3_synthetic.cif"));
      expect(await until(page, async () => /SrTiO3/.test(await bodyText(page)), 10_000), "the SrTiO₃ CIF loads");
    });
    await timed("load G(r) by hand", async () => {
      await chooseFile(page, page.getByText("Load data…").first(), join(INPUTS, "SrTiO3_synthetic.gr"));
      expect(await until(page, async () => /PDF G\(r\)|reduced G\(r\)/i.test(await bodyText(page)), 15_000), "the G(r) routes to the PDF page");
    });
    await page.waitForTimeout(500);
    await refine(page, "Refine SrTiO₃");
    const rw = (await bodyText(page)).match(/Rw\s+([\d.]+)%/)?.[1];
    note(`SrTiO₃ Rw after Refine: ${rw ?? "?"}%`);
    expect(rw !== undefined && Number(rw) < 5, `SrTiO₃ fits its own synthetic G(r) (Rw ${rw}%)`);
    await shot(page, vp, "1-srtio3");
    await page.close();
  });
}

async function step2(context, vp) {
  await step(vp, 2, "Rietveld (Mn₃Ga): Refine, Validation, Posterior Sample/Stop, magnetic step, report", async () => {
    const page = await freshPage(context);
    await openDemo(page, "rietveld");
    await refine(page);
    expect(await page.getByText(/converged · \d+ cycles?/).first().isVisible().catch(() => false) || /converged/.test(await bodyText(page)), "Refine converges");
    await shot(page, vp, "2-refined");
    await headFits(page, "Rietveld");
    await timed("Validation tab", async () => {
      await tab(page, "Validation").click();
      expect(await until(page, async () => /acceptance bar/i.test(await bodyText(page)), 10_000), "Validation shows the acceptance bar");
    });
    await shot(page, vp, "2-validation");
    await tab(page, "Posterior").click();
    await page.getByRole("button", { name: "Sample posterior" }).click();
    await page.waitForTimeout(1500);
    await timed("Posterior Stop", async () => {
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      expect(await until(page, async () => /Stopped early/.test(await bodyText(page)), 10_000), "Stop ends the sampler early, results kept");
    });
    await shot(page, vp, "2-posterior-stopped");
    // The magnetic step.
    await timed("Magnetic analysis →", async () => {
      await page.getByRole("button", { name: "Magnetic analysis →" }).click();
      await page.getByRole("button", { name: /^Rank \d+ candidates/ }).waitFor({ timeout: 20_000 });
    });
    await page.getByRole("button", { name: "Include them in the k-search" }).click();
    await timed("k-search", async () => {
      await page.getByRole("button", { name: /^Search k from [1-9]\d* peaks?/ }).click();
      expect(await until(page, async () => /matched/.test(await bodyText(page)) && /RMSD/.test(await bodyText(page)), 20_000), "the k-search lists candidate k");
    });
    await shot(page, vp, "2-ksearch");
    const rank = page.getByRole("button", { name: /^Rank \d+ candidates/ });
    await timed("Rank candidates (14 refinements)", async () => {
      await rank.click();
      await page.getByRole("button", { name: /^Ranking/ }).waitFor({ timeout: 10_000 }).catch(() => {});
      expect(await until(page, async () => (await page.getByRole("button", { name: /^Ranking/ }).count()) === 0, 180_000, 500), "ranking finishes");
    }, { background: true });
    await shot(page, vp, "2-ranked");
    const top = page.locator("button", { hasText: "★" }).first();
    expect(await top.count() > 0, "the ranking stars a best candidate");
    await top.click();
    await timed("Refine moments", async () => {
      const rm = page.getByRole("button", { name: "Refine moments" });
      await rm.click();
      await page.waitForTimeout(150);
      expect(await until(page, () => rm.isEnabled(), 60_000), "Refine moments finishes");
    });
    await shot(page, vp, "2-moments");
    await page.getByRole("button", { name: "Continue in refinement page →" }).click();
    await page.waitForTimeout(800);
    expect(/magnetic · k = \(0 0 0\)/.test(await bodyText(page)), "the refinement page carries the magnetic phase");
    const report = await timed("Report export", () => download(page, () => exportMenu(page, "Report"), "Report"));
    const mcif = await timed("mCIF export", () => download(page, () => exportMenu(page, "mCIF"), "mCIF"));
    expect(readFileSync(mcif, "utf8").includes("_space_group_symop_magn_operation"), "the mCIF carries its magnetic operations");
    const bns = /^_space_group_magn\.name_BNS\s+"([^"]+)"/m.exec(readFileSync(mcif, "utf8"));
    const bnsNumber = /^_space_group_magn\.number_BNS\s+(\S+)/m.exec(readFileSync(mcif, "utf8"));
    expect(!!bns && !!bnsNumber, "the mCIF names its BNS group (name_BNS, number_BNS)");
    if (bns) note(`mCIF: BNS ${bns[1]} (${bnsNumber?.[1] ?? "no number"})`);
    // The report renders without errors.
    const rp = await context.newPage();
    attach(rp);
    await rp.goto(`file://${report}`);
    await rp.waitForTimeout(800);
    expect(/Mn3Ga|Mn₃Ga/.test(await rp.locator("body").innerText()), "the report opens and names the phase");
    await rp.screenshot({ path: join(OUT, `${vp.name}-2-report.png`) });
    current.screenshots.push(`${vp.name}-2-report.png`);
    await rp.close();
    await page.close();
  });
}

/** Wait for the Subgroups listing at a bound to finish. */
async function listed(page, bound) {
  const sg = page.locator(".wb-subgroups");
  return until(page, async () => {
    const tx = await sg.innerText().catch(() => "");
    return new RegExp(`of \\d+ subgroups · fit ${bound}`).test(tx) && !tx.includes("so far");
  }, 90_000, 250);
}

async function step3and4(context, vp) {
  let page;
  await step(vp, 3, "PDF (GaTa₄Se₈): Refine, Subgroups Tree and List, k chips, Find, Activate 1×1×2", async () => {
    page = await freshPage(context);
    await openDemo(page, "pdf");
    await refine(page);
    await shot(page, vp, "3-refined");
    await headFits(page, "PDF");
    await tab(page, "Subgroups").click();
    const sg = page.locator(".wb-subgroups");
    await timed("Subgroups listing (2×2×2, worker)", async () => expect(await listed(page, "2×2×2"), "the 2×2×2 listing finishes"), { background: true });
    await sg.getByRole("button", { name: "Tree", exact: true }).click();
    await page.waitForTimeout(300);
    expect(/parent\s*·\s*\d+ maximal steps/.test(await sg.innerText()), "the Tree shows the parent and its maximal steps");
    await sg.locator("[data-row]").first().click().catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, vp, "3-tree-detail");
    await backFromSheet(page);
    await shot(page, vp, "3-tree");
    await sg.getByRole("button", { name: "List", exact: true }).click();
    await timed("Subgroups listing (1×1×2)", async () => {
      await sg.locator("select").first().selectOption({ label: "1×1×2" });
      expect(await listed(page, "1×1×2"), "the 1×1×2 listing finishes");
    }, { background: true });
    note(`1×1×2 list before the chips: ${(await sg.innerText()).match(/\d+ of \d+ subgroups/)?.[0]}`);
    for (const name of ["Γ, same cell", "X, same cell", "(0, 0, 1/2), supercell", "W, supercell", "any k-point"]) {
      const chip = sg.getByRole("button", { name, exact: true });
      if (!(await chip.count())) {
        expect(false, `k chip "${name}" present`);
        continue;
      }
      await chip.click();
      await page.waitForTimeout(250);
      const n = (await sg.innerText()).match(/(\d+) of \d+ subgroups/)?.[1];
      note(`k chip ${name}: ${n} rows`);
    }
    await shot(page, vp, "3-list");
    await sg.getByRole("searchbox").fill("P-42_1m");
    await page.waitForTimeout(400);
    expect(/2 of \d+ subgroups/.test(await sg.innerText()), "Find P-42_1m leaves two rows");
    await sg.locator('[data-row="P -4 21 m #113|1×1×2|24"]').click();
    await page.waitForTimeout(400);
    await shot(page, vp, "3-detail");
    await timed("Activate P-42₁m 1×1×2", async () => {
      await page.getByRole("button", { name: "Activate P -4 21 m #113", exact: true }).click();
      expect(await until(page, async () => /lowered to P -4 21 m #113 · in its own cell, 1×1×2/.test(await bodyText(page)), 20_000), "the banner says lowered to P-42₁m in 1×1×2");
    });
    // On a phone the detail is a sheet: close it if it stayed.
    await shot(page, vp, "3-activated");
    expect(/child of GaTa4Se8/.test(await bodyText(page)), "the Structure card names the child");
  });
  if (!page) return;
  await step(vp, 4, "3D Model: k grouping, folded modes, chart, arrows, bond styles, Hide bonds, ✕ clear, Boxcar, PDFgui export", async () => {
    await backFromSheet(page);
    await tab(page, "3D Model").click();
    await timed("3D Model tab", async () => expect(await until(page, async () => /DISTORTION MODES|Distortion modes/i.test(await bodyText(page)), 10_000), "the modes panel shows"));
    await page.waitForTimeout(800);
    await shot(page, vp, "4-3d");
    const kGroup = page.locator('[role=group][aria-label="k-point"]');
    const kn = await kGroup.getByRole("button").count();
    expect(kn > 2, `the modes group by k-point (${kn} chips)`);
    for (let i = 0; i < kn; i++) {
      const chip = kGroup.getByRole("button").nth(i);
      if (await chip.isDisabled()) continue;
      await chip.click();
      await page.waitForTimeout(200);
      expect((await chip.getAttribute("aria-pressed")) !== "false", `k chip ${await chip.getAttribute("aria-label")} selects`);
    }
    await kGroup.getByRole("button").first().click();
    note(`k groups: ${(await kGroup.getByRole("button").allTextContents()).map((s) => s.trim()).join(" | ")}`);
    const expand = page.getByRole("button", { name: /^(Expand|Collapse) all$/ });
    if (await expand.count()) {
      await expand.click();
      await page.waitForTimeout(300);
      const open = await page.getByRole("button", { name: /^fold / }).count();
      expect(open > 0, "Expand all opens the folded irreps");
      await shot(page, vp, "4-expanded");
      await page.getByRole("button", { name: /^(Expand|Collapse) all$/ }).click();
    } else expect(false, "Expand all present");
    const bar = page.getByRole("button", { name: /^X irrep 5 of 5: [\d.]+ %$/ });
    expect(await bar.count() > 0, "the contribution chart lists X irrep 5 of 5");
    await bar.first().click();
    await page.waitForTimeout(500);
    await shot(page, vp, "4-arrows-irrep");
    await page.getByRole("button", { name: "All in 3D" }).click();
    await page.waitForTimeout(500);
    await shot(page, vp, "4-arrows-all");
    const styles = page.locator('select[aria-label="Bond style"]:visible').first();
    for (const opt of await styles.locator("option").allTextContents()) {
      await styles.selectOption({ label: opt });
      await page.waitForTimeout(350);
      await shot(page, vp, `4-bonds-${opt.replace(/\W+/g, "-")}`);
    }
    const color = page.locator('select[aria-label="Bond color"]:visible').first();
    await color.selectOption({ index: 1 });
    await page.waitForTimeout(200);
    const hide = page.getByRole("checkbox", { name: "Hide bonds" }).filter({ visible: true }).first();
    await hide.check();
    await page.waitForTimeout(300);
    await shot(page, vp, "4-hide-bonds");
    await hide.uncheck();
    // ✕ clear back to the parent, on the Subgroups view's banner.
    await tab(page, "Subgroups").click();
    await page.waitForTimeout(500);
    // On a phone the banner rides the selected row's sheet: open the active row.
    if (vp.phone && !(await page.getByRole("button", { name: "✕ clear" }).filter({ visible: true }).count())) {
      await page.locator(".wb-subgroups").getByRole("searchbox").fill("P-42_1m");
      await page.locator('[data-row="P -4 21 m #113|1×1×2|24"]').click();
      await page.waitForTimeout(300);
    }
    await timed("✕ clear", async () => {
      await page.getByRole("button", { name: "✕ clear" }).filter({ visible: true }).first().click();
      expect(await until(page, async () => !/child of GaTa4Se8/.test(await bodyText(page)), 10_000), "✕ clear returns to the parent F-43m");
    });
    await backFromSheet(page);
    expect(/GaTa4Se8 · F -4 3 m/.test(await bodyText(page)), "the Structure card is the parent again");
    // The header's step chip is the clear's own History step, not the child's.
    const chip = (await page.locator(".wb-step-current").first().textContent()) ?? "";
    expect(/Back to F -4 3 m #216/.test(chip) && !/Supercell child/.test(chip), `the header's step chip names the parent (it reads "${chip.trim()}")`);
    await shot(page, vp, "4-cleared");
    // Boxcar on its own range.
    await tab(page, "Boxcar").click();
    await page.waitForTimeout(400);
    await page.getByLabel("Lower r bound (Å)").fill("2");
    await page.getByLabel("Upper r bound (Å)").fill("14");
    await page.getByLabel("Upper r bound (Å)").press("Tab");
    await page.waitForTimeout(300);
    expect(await page.getByRole("button", { name: /^Use fit range/ }).count() > 0, "an own range offers Use fit range");
    await timed("Boxcar scan", async () => {
      await page.getByRole("button", { name: "Run boxcar scan" }).click();
      await page.waitForTimeout(300);
      expect(await until(page, async () => (await page.getByRole("button", { name: "Cancel", exact: true }).count()) === 0, 180_000, 300), "the boxcar scan finishes");
    }, { background: true });
    await shot(page, vp, "4-boxcar");
    const runText = await bodyText(page);
    expect(/box/i.test(runText), "the boxcar run shows its track");
    // After a run the plan folds into its one-line summary: open it, then reset the range to the fit window.
    const useFit = page.getByRole("button", { name: /^Use fit range/ });
    if (!(await useFit.count())) await page.getByRole("button", { name: /^plan / }).first().click().catch(() => {});
    await page.waitForTimeout(300);
    expect(await useFit.count() > 0, "the opened plan offers Use fit range");
    if (await useFit.count()) {
      await useFit.first().click();
      await page.waitForTimeout(300);
      expect(await page.getByLabel("Lower r bound (Å)").inputValue() === "1.5", "Use fit range resets the range to the fit window");
    }
    const resetStart = page.getByRole("button", { name: "Reset to current fit" });
    note(`Reset to current fit: ${(await resetStart.count()) ? ((await resetStart.isEnabled()) ? "enabled" : "disabled (no edits on this tab)") : "not shown"}`);
    await shot(page, vp, "4-boxcar-reset");
    const zip = await timed("PDFgui export", () => download(page, () => exportMenu(page, "PDFgui / diffpy-CMI bundle (.zip)"), "PDFgui bundle"));
    expect(readFileSync(zip).subarray(0, 2).toString() === "PK", "the PDFgui bundle is a zip");
    await page.close();
  });
}

async function step5(browser, vp) {
  await step(vp, 5, "Copilot: no API key explains; scripted model: context meter neutral/amber/red, approval card", async () => {
    // No key: the static build's default (the API key mode, none stored).
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, acceptDownloads: true, isMobile: !!vp.phone, hasTouch: !!vp.phone });
    let page = await freshPage(context);
    await openDemo(page, "rietveld");
    await page.getByRole("button", { name: /^Open the Copilot/ }).first().click();
    const drawer = page.locator("aside.wb-agent");
    await drawer.waitFor();
    await page.waitForTimeout(500);
    const box = drawer.getByRole("textbox", { name: "Message the Copilot" });
    const placeholder = await box.getAttribute("placeholder");
    expect(/API key/.test(placeholder ?? "") && (await box.isDisabled()), `no key: the message box says what to do (${placeholder})`);
    // Beside the page the header says it in words; on a phone it is the status dot (its title) and the box.
    const status = vp.phone ? (await drawer.locator("[title*='API key'], [aria-label*='API key']").count()) > 0 || /API key/.test(placeholder ?? "") : /No API key/.test(await drawer.innerText());
    expect(status, "no key: the Copilot says No API key");
    await shot(page, vp, "5-no-key");
    // The local proxy with no key on the server (vite preview), then with no proxy at all (the static site: a 404).
    await drawer.getByRole("radio", { name: "Local proxy" }).click();
    const said = async () => (await drawer.innerText()).replace(/\s+/g, " ");
    expect(await until(page, async () => /has no key/.test(await said()), 10_000), "proxy without a key: the Copilot says the proxy has no key");
    note(`proxy without a key: ${(await said()).match(/The proxy[^.]*\./)?.[0] ?? "(nothing said)"}`);
    await shot(page, vp, "5-proxy-no-key");
    current.allow = [/\/api\/anthropic\/health/];
    await page.route("**/api/anthropic/health", (r) => r.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>404</title>" }));
    await drawer.getByRole("radio", { name: "API key" }).click();
    await drawer.getByRole("radio", { name: "Local proxy" }).click();
    await page.waitForTimeout(1500);
    const noProxy = (await said()).match(/[^.]*(no proxy|not running|proxy)[^.]*\./gi)?.filter((x) => !/Local proxy Claude/.test(x)).join(" ") ?? "";
    note(`no proxy (static site): ${noProxy.slice(0, 300) || "(nothing said)"}`);
    await shot(page, vp, "5-no-proxy");
    await page.unroute("**/api/anthropic/health");
    await context.close();

    // The scripted model.
    const ctx2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: !!vp.phone, hasTouch: !!vp.phone });
    await ctx2.addInitScript(() => {
      try {
        if (!sessionStorage.getItem("qa-init")) {
          localStorage.setItem("materia.agent.settings", JSON.stringify({ mode: "proxy" }));
          sessionStorage.setItem("qa-init", "1");
        }
      } catch {
        // storage blocked: the check fails visibly
      }
    });
    const bodies = [];
    page = await ctx2.newPage();
    attach(page);
    await page.route("**/api/anthropic/health", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proxy: true, key: true }) }));
    await page.route("**/api/anthropic/v1/messages**", async (r) => {
      const body = JSON.parse(r.request().postData() ?? "{}");
      bodies.push(body);
      await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse(script(body), bodies.length) });
    });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await openDemo(page, "rietveld");
    await page.getByRole("button", { name: /^Open the Copilot/ }).first().click();
    const d2 = page.locator("aside.wb-agent");
    await d2.waitFor();
    const box2 = d2.getByRole("textbox", { name: "Message the Copilot" });
    const send = async (text) => {
      await box2.fill(text);
      await d2.getByRole("button", { name: "Send", exact: true }).click();
    };
    const idle = () => until(page, async () => !(await d2.getByRole("button", { name: "Stop", exact: true }).isVisible().catch(() => false)), 60_000, 200);
    const meter = d2.locator(".wb-agent-ctx").first();
    const level = async () => ((await meter.count()) ? meter.getAttribute("data-level") : null);
    // Neutral, with an approval card.
    await send("Please refine (neutral).");
    const card = d2.locator('.wb-agent-step[data-tool="refine"][data-status="waiting"]');
    const waiting = await card.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    expect(waiting, "the refine call waits on its approval card (Ask first)");
    await shot(page, vp, "5-approval-card");
    await headFits(page, "Rietveld beside the Copilot");
    if (waiting) {
      await timed("Approve → refine → reply", async () => {
        await card.getByRole("button", { name: "Approve" }).click();
        expect(await idle(), "the approved turn ends");
      });
    }
    // On a phone the meter stays folded until amber (by design); beside the page it always shows.
    expect(vp.phone ? (await level()) === null || (await level()) === "neutral" : (await level()) === "neutral", `context meter neutral (${await level()})`);
    await shot(page, vp, "5-meter-neutral");
    await send("How full now? (amber)");
    await idle();
    await page.waitForTimeout(300);
    expect((await level()) === "amber", `context meter amber (${await level()})`);
    expect(await d2.locator('.wb-agent-ctxwarn[data-level="amber"]').count() > 0, "amber offers Start fresh / Summarize");
    await shot(page, vp, "5-meter-amber");
    await send("And now? (red)");
    await idle();
    await page.waitForTimeout(300);
    expect((await level()) === "red", `context meter red (${await level()})`);
    await shot(page, vp, "5-meter-red");
    note(`scripted requests: ${bodies.length}`);
    await ctx2.close();
  });
}

async function step6(context, vp) {
  if (!vp.phone) return;
  await step(vp, 6, "Phone: bottom action bar, Copilot sheet, Subgroups detail sheet", async () => {
    const page = await freshPage(context);
    await openDemo(page, "rietveld");
    const bar = page.locator(".wb-mobile-actions, .wb-actionbar, [class*=bottom]").first();
    note(`bottom bar found: ${await bar.count()}`);
    const r = refineButton(page);
    const box = await r.boundingBox();
    expect(box && box.y > vp.height - 160, `Refine sits in the bottom action bar (y=${box?.y})`);
    await refine(page, "Refine (bottom bar)");
    await shot(page, vp, "6-bottom-bar");
    await page.getByRole("button", { name: /^Open the Copilot/ }).first().click();
    const drawer = page.locator("aside.wb-agent");
    await drawer.waitFor();
    await page.waitForTimeout(500);
    const db = await drawer.boundingBox();
    expect(db && db.width <= vp.width + 1, `the Copilot opens as a sheet within the screen (${db?.width}px)`);
    await shot(page, vp, "6-copilot-sheet");
    await drawer.getByRole("button", { name: "Close the Copilot" }).click();
    await page.waitForTimeout(400);
    expect(!(await drawer.isVisible().catch(() => false)), "the Copilot sheet closes");
    expect(await closeProject(page), "Close returns to the start page");
    await openDemo(page, "pdf");
    await tab(page, "Subgroups").click();
    expect(await listed(page, "2×2×2"), "the listing finishes");
    const sg = page.locator(".wb-subgroups");
    await sg.getByRole("button", { name: "List", exact: true }).click();
    await sg.getByRole("searchbox").fill("I-4m2");
    await page.waitForTimeout(400);
    const row = sg.locator("[data-row]").first();
    await row.click();
    await page.waitForTimeout(500);
    await shot(page, vp, "6-subgroups-sheet");
    const activate = page.getByRole("button", { name: /^Activate / }).first();
    const ab = await activate.boundingBox().catch(() => null);
    expect(ab && ab.x >= 0 && ab.x + ab.width <= vp.width + 1 && ab.y + ab.height <= vp.height + 1, `the detail sheet's Activate is on screen (${JSON.stringify(ab)})`);
    const closeSheet = page.getByRole("button", { name: /^(Close|Back|✕)/ }).filter({ hasNotText: "project" });
    note(`sheet close buttons: ${await closeSheet.count()}`);
    await page.close();
  });
}

async function step7(context, vp) {
  await step(vp, 7, "Save, reopen, Close, Undo/Redo, History", async () => {
    const page = await freshPage(context);
    await openDemo(page, "rietveld");
    await refine(page);
    const wr = (await bodyText(page)).match(/wR\s+([\d.]+)%/)?.[1];
    const saved = await timed("Save", () => download(page, () => page.getByRole("button", { name: "Save project", exact: true }).click(), "Save"));
    expect(/\.materia\.json$/.test(saved), "Save writes a .materia.json");
    expect(await closeProject(page), "Close returns to the start page");
    await timed("Open the saved project", async () => {
      await chooseFile(page, page.getByRole("button", { name: "Open project", exact: true }).first(), saved);
      expect(await until(page, async () => /Mn3Ga \+ MnO/.test(await bodyText(page)), 15_000), "the saved project reopens");
    });
    const wr2 = (await bodyText(page)).match(/wR\s+([\d.]+)%/)?.[1];
    expect(wr === wr2, `the reopened fit has the saved wR (${wr} → ${wr2})`);
    await shot(page, vp, "7-reopened");
    // A change to undo: free the instrument group's first parameter? Simplest: Reset, then Undo/Redo.
    await page.getByRole("button", { name: "Reset", exact: true }).first().click();
    await page.waitForTimeout(500);
    const back = page.getByRole("button", { name: "Back one step (⌘Z / Ctrl+Z)" });
    const fwd = page.getByRole("button", { name: "Forward one step (⇧⌘Z / Ctrl+Shift+Z)" });
    const histBtn = page.getByRole("button", { name: "History", exact: true });
    if (await back.isVisible().catch(() => false)) {
      expect(await back.isEnabled(), "Back is enabled after a change");
      await back.click();
      await page.waitForTimeout(400);
      expect(await fwd.isEnabled(), "Forward is enabled after Back");
      await fwd.click();
      await page.waitForTimeout(400);
    } else {
      await histBtn.click();
      const hb = page.getByRole("button", { name: "Back one step", exact: true });
      expect(await hb.isEnabled(), "History's Back is enabled after a change");
      await hb.click();
      await page.waitForTimeout(400);
      const hf = page.getByRole("button", { name: "Forward one step", exact: true });
      expect(await hf.isEnabled(), "History's Forward is enabled after Back");
      await hf.click();
      await page.waitForTimeout(400);
      await histBtn.click();
    }
    await timed("History menu", async () => {
      await histBtn.click();
      await page.locator(".wb-history-popover").waitFor({ timeout: 5000 });
    });
    const steps = await page.locator('.wb-history-popover section[aria-label="Step history"] button').allTextContents();
    note(`History steps: ${steps.filter((s) => s.trim() && s !== "✎").length}`);
    expect(steps.length > 2, "History lists the steps");
    await shot(page, vp, "7-history");
    // Click a step to go back to it: the Refine step, whose wR the page then shows.
    await timed("History: go back to the Refine step", async () => {
      await page.locator(".wb-history-popover").getByRole("button", { name: /^▶?\s*Refine/ }).first().click();
      await page.waitForTimeout(500);
    });
    const wr3 = (await bodyText(page)).match(/wR\s+([\d.]+)%/)?.[1];
    expect(wr3 === wr, `the Refine step restores its wR (${wr3})`);
    await page.keyboard.press("Escape");
    await histBtn.click().catch(() => {});
    await page.waitForTimeout(200);
    if (await page.locator(".wb-history-popover").isVisible().catch(() => false)) await histBtn.click();
    expect(await closeProject(page), "Close (after changes) returns to the start page via the dialog");
    await shot(page, vp, "7-closed");
    await page.close();
  });
}

// ── the run ────────────────────────────────────────────────────────────────
const executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
const version = browser.version();
const started = Date.now();
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, acceptDownloads: true, isMobile: !!vp.phone, hasTouch: !!vp.phone });
    await step1(context, vp);
    await step2(context, vp);
    await step3and4(context, vp);
    await step5(browser, { width: vp.width, height: vp.height, name: vp.name, phone: vp.phone });
    await step6(context, vp);
    await step7(context, vp);
    await context.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

const summary = { date: new Date().toISOString(), commit, chrome: version, base: BASE, minutes: +((Date.now() - started) / 60000).toFixed(1), results };
writeFileSync(join(OUT, "demo-qa.json"), JSON.stringify(summary, null, 1));
const md = [
  `# Demo QA run ${summary.date.slice(0, 10)} · ${commit} · Chrome ${version}`,
  "",
  "| viewport | step | result | time | slow (> 2 s) | issues |",
  "|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.viewport} | ${r.id}. ${r.name} | ${r.ok ? "pass" : "FAIL"} | ${(r.ms / 1000).toFixed(1)} s | ${r.slow.join("; ")} | ${[...r.broken, ...r.pageErrors, ...r.console, ...r.network].join("; ").replace(/\|/g, "/")} |`),
  "",
  "## Timings",
  ...results.map((r) => `- ${r.viewport} ${r.id}: ${r.timings.map((t) => `${t.label} ${t.ms} ms${t.background ? " (background)" : ""}`).join(", ")}`),
  "",
  "## Notes",
  ...results.flatMap((r) => [...r.notes.map((n) => `- ${r.viewport} ${r.id}: ${n}`), ...r.expected.map((e) => `- ${r.viewport} ${r.id}: expected probe ${e}`)]),
].join("\n");
writeFileSync(join(OUT, "demo-qa.md"), md + "\n");
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps pass · ${summary.minutes} min · ${OUT}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

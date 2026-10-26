/**
 * The workbench plots' interactions in a real browser (M8): cursor-anchored
 * zoom (Ctrl+wheel, plain wheel, trackpad pinch), the cursor readout, drag
 * pan and its clamps, double-click reset, keyboard zoom and pan, linked
 * panels, the tick rows, the G(r) and S(Q) panels, the redraw budget on the
 * demo and on a 100 000-point pattern, and touch on a phone. Each check
 * prints PASS/FAIL; the exit code is 1 on any FAIL.
 *
 * The 100 000-point TOF pattern and the S(Q) are generated here from a fixed
 * seed (invented peaks, background and noise; no measured data) into a temp
 * directory, so every run sees the same files.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/plot-interactions-check.mjs [baseUrl] [outDir]
 * Screenshots and results.json are written only when outDir is given.
 * CHROMIUM=/path/to/chrome overrides the browser (default: the one
 * Playwright installed under /opt/pw-browsers, else the system Chrome).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5173/materia-platform/";
const OUT = process.argv[3];
if (OUT) mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: join(OUT, name) }) : Promise.resolve());
const executablePath = process.env.CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

// ── synthetic inputs (invented, deterministic) ─────────────────────────────
/** mulberry32: a small seeded PRNG, so the files are the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const TMP = mkdtempSync(join(tmpdir(), "materia-plot-interactions-"));

/** A 100 000-point TOF pattern on a log (SLOG) grid: a flat background and
 *  Gaussian peaks of an invented cubic cell, with Poisson-like noise. */
function writeSynthPattern(path) {
  const rand = rng(20260824);
  const N = 100000, x0 = 3390.5729, x1 = 135196.8393;
  const r = (x1 / x0) ** (1 / (N - 1));
  const difc = 22000, a = 5.43; // TOF = difc·d; a: an invented cubic cell (Å)
  const peaks = [];
  for (let h = 0; h <= 8; h++)
    for (let k = 0; k <= h; k++)
      for (let l = 0; l <= k; l++) {
        if (h + k + l === 0 || (h + k + l) % 2) continue;
        const t = (difc * a) / Math.hypot(h, k, l);
        if (t > x0 && t < x1) peaks.push({ t, amp: 20 + 80 * rand(), w: 0.0025 * t });
      }
  const lines = ["PWDR synthetic 100k-point pattern (invented values, fixed seed)", `BANK 1 ${N} ${N} SLOG ${x0.toFixed(0)} ${x1.toFixed(0)} ${Math.log(r).toFixed(8)} 0 FXYE`];
  for (let i = 0; i < N; i++) {
    const x = x0 * r ** i;
    let y = 40 + 8 * Math.exp(-x / 20000);
    for (const p of peaks) {
      const z = (x - p.t) / p.w;
      if (Math.abs(z) < 6) y += p.amp * Math.exp(-0.5 * z * z);
    }
    const e = 0.3 + 0.15 * Math.sqrt(y) * (x / 30000);
    lines.push(`  ${x.toFixed(4)}  ${(y + e * gauss(rand)).toFixed(6)}  ${e.toFixed(6)}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
}

/** S(Q) from Q 0.5 to 25 Å⁻¹ in steps of 0.02: damped oscillations about 1. */
function writeSynthSq(path) {
  const rand = rng(1729);
  const lines = ["# synthetic S(Q) for the plot-interaction checks", "#L Q S(Q) dS(Q)"];
  for (let i = 0; i <= 1225; i++) {
    const q = 0.5 + 0.02 * i;
    const dS = 0.01 + 0.001 * q;
    const s = 1 + 1.6 * Math.exp(-q / 3.2) * Math.cos(2.35 * q - 0.6) + 0.4 * Math.exp(-q / 0.9);
    lines.push(`${q.toFixed(3)} ${(s + 0.2 * dS * gauss(rand)).toFixed(6)} ${dS.toFixed(6)}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
}
const SYN = join(TMP, "synth100k.fxye");
const SQ = join(TMP, "synthetic.sq");
writeSynthPattern(SYN);
writeSynthSq(SQ);

const results = [];
const check = (id, name, ok, detail) => {
  results.push({ id, name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} ${detail !== undefined ? JSON.stringify(detail) : ""}`);
};
const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
const allErrors = [];

async function open(viewport, demo, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => allErrors.push(`${demo}: ${e}`));
  await page.goto(BASE, { waitUntil: "networkidle" });
  // The demos are cards on the landing page, named by their material.
  await page.getByRole("button", { name: demo.split(" · ")[1] ?? demo }).click();
  await page.waitForTimeout(1500);
  return { ctx, page };
}

/** The visible interactive plot's state (sel = a CSS selector for the svg). */
async function state(page, sel = "svg.wb-plot") {
  return page.evaluate((sel) => {
    const s = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    if (!s) return null;
    const r = s.getBoundingClientRect();
    const f = s.dataset.frame.split(",").map(Number);
    const ro = s.parentElement.querySelector(".wb-plot-readout");
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      vmin: +s.dataset.vmin, vmax: +s.dataset.vmax, dmin: +s.dataset.dmin, dmax: +s.dataset.dmax, ylock: +s.dataset.ylock,
      x0: f[0], x1: f[1], boxW: f[2], boxH: f[3], top: f[4], base: f[5], diffY: f[6], diffA: f[7], tickTop: f[8], tickStep: f[9], tickH: f[10],
      readout: ro ? { x: +ro.dataset.x, i: +ro.dataset.index, step: +ro.dataset.step, text: ro.innerText } : null,
      live: s.parentElement.querySelector("[aria-live]")?.textContent ?? "",
    };
  }, sel);
}
/** client px of data x, and data x of client px. */
const clientOf = (s, x) => s.rect.x + ((s.x0 + ((x - s.vmin) / (s.vmax - s.vmin)) * (s.x1 - s.x0)) / s.boxW) * s.rect.w;
const dataOf = (s, cx) => s.vmin + ((((cx - s.rect.x) / s.rect.w) * s.boxW - s.x0) / (s.x1 - s.x0)) * (s.vmax - s.vmin);
const userYToClient = (s, uy) => s.rect.y + (uy / s.boxH) * s.rect.h;
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Tick positions (user x) on the canvas: centres of the coloured runs along a
 *  tick row's middle line; `teal` keeps only the first phase's colour. */
async function tickColumns(page, s, row, teal) {
  return page.evaluate(({ s, row, teal }) => {
    const svg = [...document.querySelectorAll("svg.wb-plot")].find((x) => x.getBoundingClientRect().width > 0);
    const cv = svg.parentElement.querySelector("canvas");
    const k = cv.width / s.boxW;
    const y = Math.round((s.tickTop + row * s.tickStep + s.tickH / 2) * k);
    const img = cv.getContext("2d").getImageData(0, y, cv.width, 1).data;
    const hit = (i) => {
      const [r, g, b] = [img[4 * i], img[4 * i + 1], img[4 * i + 2]];
      return teal ? g - r > 40 && Math.abs(g - b) < 30 : Math.abs(r - 255) + Math.abs(g - 253) + Math.abs(b - 249) > 40;
    };
    const out = [];
    let start = -1;
    for (let i = Math.ceil(s.x0 * k); i <= Math.floor(s.x1 * k); i++) {
      if (hit(i) && start < 0) start = i;
      if (!hit(i) && start >= 0) { out.push((start + i - 1) / 2 / k); start = -1; }
    }
    return out;
  }, { s, row, teal });
}

async function ctrlWheel(page, cx, cy, dy) {
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, dy);
  await page.keyboard.up("Control");
  await frame(page);
  await page.waitForTimeout(30);
}

// ---- V1: cursor-anchored zoom ------------------------------------------------
async function anchorTest(page, label, mode, sel = "svg.wb-plot") {
  let worst = 0;
  for (const frac of [0.3, 0.5, 0.7]) {
    const s0 = await state(page, sel);
    const cx = Math.round(s0.rect.x + ((s0.x0 + frac * (s0.x1 - s0.x0)) / s0.boxW) * s0.rect.w);
    const cy = Math.round(s0.rect.y + s0.rect.h * 0.3);
    const xAnchor = dataOf(s0, cx);
    await page.mouse.move(cx, cy);
    for (const dy of [-100, -100, -100, -100, -100, 100, 100, 100, 100, 100]) {
      if (mode === "ctrl") await ctrlWheel(page, cx, cy, dy);
      else if (mode === "plain") { await page.mouse.wheel(0, dy); await frame(page); await page.waitForTimeout(30); }
      else if (mode === "pinch") {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: dy / 25, modifiers: 2 });
        await frame(page);
        await page.waitForTimeout(20);
        await cdp.detach();
      }
      const s = await state(page, sel);
      worst = Math.max(worst, Math.abs(clientOf(s, xAnchor) - cx));
    }
  }
  const s = await state(page, sel);
  return { worst: +worst.toFixed(3), zoomedThenBack: Math.abs(s.vmax - s.vmin - (s.dmax - s.dmin)) / (s.dmax - s.dmin) };
}

// =============================================================================
// Powder TOF demo, 1440×900 (the workbench does not scroll)
// =============================================================================
{
  // Device scale 4, so the canvas checks (V5) resolve a quarter pixel.
  const { ctx, page } = await open({ width: 1440, height: 900 }, "Rietveld · Mn₃Ga neutron TOF", { deviceScaleFactor: 4 });
  let s = await state(page);
  check("V0", "powder plot found, full view", s && Math.abs(s.vmin - s.dmin) < 1e-6 && Math.abs(s.vmax - s.dmax) < 1e-6, s && { vmin: s.vmin, vmax: s.vmax });

  const a1 = await anchorTest(page, "powder", "ctrl");
  check("V1a", "Ctrl+wheel zoom keeps the data x under the cursor (≤ 1 px)", a1.worst <= 1, a1);
  const a2 = await anchorTest(page, "powder", "plain");
  check("V1b", "plain wheel zooms where nothing scrolls, anchored (≤ 1 px)", a2.worst <= 1, a2);
  // A ctrl wheel of small deltas is what Chromium sends for a trackpad pinch.
  const a3 = await anchorTest(page, "powder", "pinch");
  check("V1c", "pinch (ctrl + small wheel deltas) zooms, anchored (≤ 1 px)", a3.worst <= 1, a3);
  s = await state(page);
  {
    // pinch actually zoomed: one in-step changes the span
    const cdp = await ctx.newCDPSession(page);
    const cx = s.rect.x + s.rect.w / 2, cy = s.rect.y + s.rect.h * 0.3;
    // CDP wheel deltas are divided by the device scale on delivery: send −4·dpr so each event carries Δ −4.
    const dpr = await page.evaluate(() => { window.__d = []; document.addEventListener("wheel", (e) => window.__d.push(e.deltaY), { capture: true }); return window.devicePixelRatio; });
    for (let i = 0; i < 10; i++) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: -4 * dpr, modifiers: 2 }); }
    await frame(page); await page.waitForTimeout(50);
    const s2 = await state(page);
    const delivered = await page.evaluate(() => window.__d);
    check("V1d", "ten pinch events (Δ −4 each) zoom in", s2.vmax - s2.vmin < 0.8 * (s.vmax - s.vmin), { before: s.vmax - s.vmin, after: s2.vmax - s2.vmin, delivered });
    await cdp.detach();
    await page.getByRole("button", { name: "Reset zoom" }).click();
  }

  // ---- V3: readout x within half a step; V3b: y values consistent ----
  s = await state(page);
  let v3 = [];
  for (const frac of [0.17, 0.41, 0.66, 0.9]) {
    const cx = s.rect.x + ((s.x0 + frac * (s.x1 - s.x0)) / s.boxW) * s.rect.w;
    await page.mouse.move(cx, s.rect.y + s.rect.h * 0.3);
    await frame(page); await page.waitForTimeout(30);
    const t = await state(page);
    const xc = dataOf(t, cx);
    const printed = Number((/TOF ([0-9.]+)/.exec(t.readout?.text ?? "") ?? [])[1]);
    v3.push({ xc: +xc.toFixed(2), x: t.readout?.x, step: +(t.readout?.step ?? NaN).toFixed(3), printed, dCursor: Math.abs(t.readout?.x - xc), dPrinted: Math.abs(printed - t.readout?.x) });
  }
  // The cursor maps to a pixel, which spans (span/width) data units: the nearest point is within ½ step + ½ px.
  const pxData = (s.vmax - s.vmin) / ((s.x1 - s.x0) / s.boxW * s.rect.w);
  check("V3a", "readout x is the data point within ½ data step (+½ px) of the cursor", v3.every((r) => r.dCursor <= r.step / 2 + pxData / 2 + 1e-9), v3);
  check("V3b", "printed x is within ½ data step of the data point", v3.every((r) => r.dPrinted <= r.step / 2 + 1e-9), v3.map((r) => [r.printed, r.x]));
  {
    await page.mouse.move(s.rect.x + ((s.x0 + 0.41 * (s.x1 - s.x0)) / s.boxW) * s.rect.w, s.rect.y + s.rect.h * 0.3);
    await frame(page); await page.waitForTimeout(30);
    const t = await state(page);
    const m = (k) => Number((new RegExp(`\\n${k}\\n?\\s*([-0-9.e+]+)`).exec("\n" + t.readout.text) ?? [])[1]);
    const obs = m("obs"), calc = m("calc"), diff = m("diff");
    check("V3c", "readout obs − calc = diff (display precision)", Number.isFinite(obs) && Math.abs(obs - calc - diff) <= 1e-3 * Math.max(1, Math.abs(obs)), { obs, calc, diff, text: t.readout.text });
  }
  await shot(page, "v3-readout.png");

  // ---- V4: nearest-tick hkl on a known reflection (switch to d) ----
  await page.getByRole("button", { name: "d", exact: true }).first().click();
  await page.waitForTimeout(500);
  s = await state(page);
  {
    const row0 = { xs: await tickColumns(page, s, 0, true) };
    const ticks = [{ xs: await tickColumns(page, s, 0, false) }, { xs: await tickColumns(page, s, 1, false) }];
    // user x → d for the tick nearest d = 4.694 (Mn3Ga (1 0 0)).
    const toD = (ux) => s.vmin + ((ux - s.x0) / (s.x1 - s.x0)) * (s.vmax - s.vmin);
    const ux = row0.xs.reduce((a, b) => (Math.abs(toD(b) - 4.694) < Math.abs(toD(a) - 4.694) ? b : a));
    const cx = s.rect.x + (ux / s.boxW) * s.rect.w;
    await page.mouse.move(cx, s.rect.y + s.rect.h * 0.3);
    await frame(page); await page.waitForTimeout(30);
    const t = await state(page);
    check("V4a", "hovering the d 4.694 Å tick lists Mn3Ga (1 0 0)", /Mn3Ga \(1 0 0\) d 4\.69/.test(t.readout?.text ?? ""), t.readout?.text);
    // Every listed tick: hexagonal metric consistency of (hkl, d) — a, c from (1 0 0) and (1 0 1).
    const listed = [];
    for (const target of [3.2, 2.71, 2.19, 1.6]) {
      const u = row0.xs.reduce((a, b) => (Math.abs(toD(b) - target) < Math.abs(toD(a) - target) ? b : a));
      await page.mouse.move(s.rect.x + (u / s.boxW) * s.rect.w, s.rect.y + s.rect.h * 0.3);
      await frame(page); await page.waitForTimeout(30);
      const r = await state(page);
      for (const m of (r.readout?.text ?? "").matchAll(/Mn3Ga \((-?\d+) (-?\d+) (-?\d+)\) d ([0-9.]+)/g)) listed.push({ h: +m[1], k: +m[2], l: +m[3], d: +m[4], tickD: toD(u) });
    }
    const a = (4.694 * 2) / Math.sqrt(3);
    const c = 1 / Math.sqrt(1 / 3.2 ** 2 - 4 / (3 * a * a));
    const bad = listed.filter(({ h, k, l, d }) => Math.abs(1 / Math.sqrt((4 / 3) * (h * h + h * k + k * k) / (a * a) + (l * l) / (c * c)) - d) > 0.01 * d);
    check("V4b", "listed (hkl, d) agree with the hexagonal metric (1 %)", listed.length >= 3 && bad.length === 0, { n: listed.length, bad, sample: listed.slice(0, 4) });
    // A cursor between ticks (≥ 10 px from every tick of every row) lists none.
    const allUx = ticks.flatMap((t) => t.xs).sort((p, q) => p - q);
    let gap = null;
    for (let i = 1; i < allUx.length; i++) if (allUx[i] - allUx[i - 1] > 24 && allUx[i - 1] > s.x0) { gap = (allUx[i] + allUx[i - 1]) / 2; break; }
    if (gap !== null) {
      await page.mouse.move(s.rect.x + (gap / s.boxW) * s.rect.w, s.rect.y + s.rect.h * 0.3);
      await frame(page); await page.waitForTimeout(30);
      const r = await state(page);
      check("V4c", "a cursor > tolerance from every tick lists no reflection", r.readout && !/\(-?\d+ -?\d+ -?\d+\) d/.test(r.readout.text), r.readout?.text);
    } else check("V4c", "a cursor > tolerance from every tick lists no reflection", false, "no gap found");
  }

  // ---- V6: zoom persists through a refine, in d with difC freed ----
  s = await state(page);
  await ctrlWheel(page, s.rect.x + s.rect.w * 0.5, s.rect.y + s.rect.h * 0.3, -300);
  await ctrlWheel(page, s.rect.x + s.rect.w * 0.5, s.rect.y + s.rect.h * 0.3, -300);
  await page.mouse.move(s.rect.x + 5, s.rect.y + 5);
  const before = await state(page);
  await page.getByText("Instrument / profile", { exact: true }).click();
  await page.waitForTimeout(200);
  // TOF difC is a locked calibration (no refine toggle): edit it instead, which
  // moves the converted d axis as a refined difC or zero would; then refine.
  const difc = page.locator("div[title='TOF difC'] input").first();
  let freed = false;
  if (await difc.count()) { await difc.fill("22620"); await difc.press("Enter"); freed = true; }
  await page.waitForTimeout(800);
  const mid = await state(page);
  await page.getByRole("button", { name: "Refine", exact: true }).click();
  await page.waitForSelector("text=Result: converged", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
  const after = await state(page);
  const rel = (a, b) => Math.abs(a - b) / Math.abs(before.vmax - before.vmin);
  check("V6a", "zoom kept in d through a difC change (domain moves) and a refine", freed && Math.abs(after.dmax - before.dmax) > 1e-4 && rel(before.vmin, mid.vmin) < 1e-9 && rel(before.vmax, mid.vmax) < 1e-9 && rel(before.vmin, after.vmin) < 1e-9 && rel(before.vmax, after.vmax) < 1e-9,
    { difCEdited: freed, before: [before.vmin, before.vmax], afterEdit: [mid.vmin, mid.vmax], afterRefine: [after.vmin, after.vmax], domainBefore: [before.dmin, before.dmax], domainAfter: [after.dmin, after.dmax] });
  await shot(page, "v6-after-refine-d.png");

  // TOF: zoom, refine again, compare.
  await page.getByRole("button", { name: "TOF", exact: true }).first().click();
  await page.waitForTimeout(400);
  s = await state(page);
  check("V6b", "x-unit change resets the zoom (to the fit window or the whole range)", s.vmax - s.vmin >= 0.7 * (s.dmax - s.dmin), [s.vmin, s.vmax, s.dmin, s.dmax]);
  await ctrlWheel(page, s.rect.x + s.rect.w * 0.4, s.rect.y + s.rect.h * 0.3, -300);
  await page.mouse.move(s.rect.x + 5, s.rect.y + 5);
  const b2 = await state(page);
  await page.getByRole("button", { name: "Refine", exact: true }).click();
  await page.waitForTimeout(500);
  await page.waitForSelector("text=Result: converged", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
  const a2b = await state(page);
  check("V6c", "zoom kept through a refine in TOF", Math.abs(b2.vmin - a2b.vmin) < 1e-6 && Math.abs(b2.vmax - a2b.vmax) < 1e-6, { before: [b2.vmin, b2.vmax], after: [a2b.vmin, a2b.vmax] });

  // ---- V5: linked panels: calc (main band) and diff (difference band) start at the fit-window edge together ----
  {
    s = await state(page);
    // Put the fit minimum (≈ 9349 µs) in view at ~30 % of the width.
    const fitMin = 9349.42;
    // zoom about fitMin
    await page.getByRole("button", { name: "Reset zoom" }).click().catch(() => {});
    await page.waitForTimeout(100);
    s = await state(page);
    const cx = clientOf(s, fitMin);
    for (let i = 0; i < 6; i++) await ctrlWheel(page, cx, s.rect.y + s.rect.h * 0.3, -100);
    const measure = async () => {
      const t = await state(page);
      const cols = await page.evaluate((t) => {
        const svg = [...document.querySelectorAll("svg.wb-plot")].find((x) => x.getBoundingClientRect().width > 0);
        const cv = svg.parentElement.querySelector("canvas");
        const g = cv.getContext("2d");
        const k = cv.width / t.boxW;
        const scan = (y0, y1, pred) => {
          const img = g.getImageData(0, Math.round(y0 * k), cv.width, Math.round((y1 - y0) * k)).data;
          const w = cv.width;
          let min = Infinity;
          for (let i = 0; i < img.length; i += 4) {
            if (pred(img[i], img[i + 1], img[i + 2])) min = Math.min(min, (i / 4) % w);
          }
          return min / k;
        };
        const blue = (r, gg, b) => b - r > 60 && b - gg > 30;
        const green = (r, gg, b) => gg - r > 25 && gg - b > 8;
        return { calc: scan(t.top, t.base, blue), diff: scan(t.diffY - t.diffA, t.diffY + t.diffA, green) };
      }, t);
      const handle = t.x0 + ((fitMin - t.vmin) / (t.vmax - t.vmin)) * (t.x1 - t.x0);
      return { ...cols, handle };
    };
    const m1 = await measure();
    s = await state(page);
    // pan by dragging 60 px left→right
    await page.mouse.move(s.rect.x + s.rect.w * 0.6, s.rect.y + s.rect.h * 0.3);
    await page.mouse.down();
    await page.mouse.move(s.rect.x + s.rect.w * 0.6 + 60, s.rect.y + s.rect.h * 0.3, { steps: 6 });
    await page.mouse.up();
    await frame(page); await page.waitForTimeout(50);
    const m2 = await measure();
    const ok = (m) => Math.abs(m.calc - m.diff) <= 0.5 && Math.abs(m.calc - m.handle) <= 1 && Math.abs(m.diff - m.handle) <= 1;
    check("V5", "calc (main band) and diff (difference band) start at the same x (≤ 0.5 px), on the SVG fit edge (≤ 1 px), after zoom and after pan", ok(m1) && ok(m2) && m2.handle - m1.handle > 30, { afterZoom: m1, afterPan: m2 });
    await shot(page, "v5-linked.png");
  }

  // ---- V8: pan clamp ----
  {
    s = await state(page);
    const span = s.vmax - s.vmin;
    const y = s.rect.y + s.rect.h * 0.3;
    await page.mouse.move(s.rect.x + s.rect.w * 0.2, y); await page.mouse.down();
    await page.mouse.move(s.rect.x + s.rect.w * 0.2 + 3000, y, { steps: 10 }); await page.mouse.up();
    await frame(page); await page.waitForTimeout(50);
    const l = await state(page);
    await page.mouse.move(s.rect.x + s.rect.w * 0.8, y); await page.mouse.down();
    await page.mouse.move(s.rect.x + s.rect.w * 0.8 - 6000, y, { steps: 10 }); await page.mouse.up();
    await frame(page); await page.waitForTimeout(50);
    const r = await state(page);
    check("V8", "drag pans and is clamped at both ends, span unchanged", Math.abs(l.vmin - l.dmin) < 1e-6 && Math.abs(r.vmax - r.dmax) < 1e-6 && Math.abs(l.vmax - l.vmin - span) < 1e-6 * span && Math.abs(r.vmax - r.vmin - span) < 1e-6 * span,
      { span, left: [l.vmin, l.vmax, l.dmin], right: [r.vmin, r.vmax, r.dmax] });
  }

  // ---- V9: box zoom (Shift + drag), flat and tall ----
  {
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await page.waitForTimeout(100);
    s = await state(page);
    const ax = s.rect.x + ((s.x0 + 0.3 * (s.x1 - s.x0)) / s.boxW) * s.rect.w;
    const bx = s.rect.x + ((s.x0 + 0.45 * (s.x1 - s.x0)) / s.boxW) * s.rect.w;
    const xa = dataOf(s, ax), xb = dataOf(s, bx);
    const y = userYToClient(s, (s.top + s.base) / 2);
    await page.keyboard.down("Shift");
    await page.mouse.move(ax, y); await page.mouse.down();
    await page.mouse.move(bx, y + 4, { steps: 6 });
    await shot(page, "v9-box-flat.png");
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await frame(page); await page.waitForTimeout(50);
    const f = await state(page);
    const pxUnit = (s.vmax - s.vmin) / ((s.x1 - s.x0) / s.boxW * s.rect.w);
    check("V9a", "flat Shift-box zooms x to the dragged interval (±1 px), y stays automatic", Math.abs(f.vmin - xa) <= pxUnit && Math.abs(f.vmax - xb) <= pxUnit && f.ylock === 0, { want: [xa, xb], got: [f.vmin, f.vmax], ylock: f.ylock });
    await page.mouse.dblclick(s.rect.x + s.rect.w * 0.5, s.rect.y + s.rect.h * 0.3);
    await frame(page); await page.waitForTimeout(50);
    const d = await state(page);
    check("V9b", "double-click resets to the whole range", Math.abs(d.vmin - d.dmin) < 1e-6 && Math.abs(d.vmax - d.dmax) < 1e-6 && d.ylock === 0, [d.vmin, d.vmax]);
    await page.keyboard.down("Shift");
    await page.mouse.move(ax, userYToClient(s, s.base - 20)); await page.mouse.down();
    await page.mouse.move(bx, userYToClient(s, s.base - 120), { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await frame(page); await page.waitForTimeout(50);
    const tall = await state(page);
    const yTicks = await page.evaluate(() => {
      const svg = [...document.querySelectorAll("svg.wb-plot")].find((x) => x.getBoundingClientRect().width > 0);
      return [...svg.querySelectorAll("text[text-anchor=end]")].map((t) => t.textContent).filter((t) => /^-?[0-9.]+k?$/.test(t));
    });
    check("V9c", "tall Shift-box zooms x and fixes y to the box", tall.ylock === 1 && Math.abs(tall.vmin - xa) <= pxUnit, { ylock: tall.ylock, yTicks });
    await shot(page, "v9-box-tall.png");
  }

  // ---- V7: Reset button and key 0 ----
  {
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await frame(page);
    let r = await state(page);
    const okBtn = Math.abs(r.vmin - r.dmin) < 1e-6 && Math.abs(r.vmax - r.dmax) < 1e-6 && r.ylock === 0;
    const disabled = await page.getByRole("button", { name: "Reset zoom" }).isDisabled();
    s = await state(page);
    await ctrlWheel(page, s.rect.x + s.rect.w * 0.5, s.rect.y + s.rect.h * 0.3, -300);
    await page.locator("svg.wb-plot >> visible=true").first().focus();
    await page.keyboard.press("0");
    await frame(page);
    r = await state(page);
    const okKey = Math.abs(r.vmin - r.dmin) < 1e-6 && Math.abs(r.vmax - r.dmax) < 1e-6;
    check("V7", "Reset button (then disabled) and key 0 restore the whole range, y auto", okBtn && okKey && disabled, { okBtn, okKey, disabled });
  }

  // ---- V10: keyboard ----
  {
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(5, 5);
    await page.locator("header").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.classList?.contains("wb-plot") && document.activeElement.getBoundingClientRect().width > 0);
    }
    const ring = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { fv: a.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }; });
    await page.waitForTimeout(800);
    let k0 = await state(page);
    await shot(page, "v10-focus.png");
    await page.keyboard.press("+"); await frame(page);
    const k1 = await state(page);
    await page.keyboard.press("ArrowRight"); await frame(page);
    const k2 = await state(page);
    await page.keyboard.press("ArrowLeft"); await frame(page);
    const k3 = await state(page);
    await page.keyboard.press("-"); await frame(page);
    const k4 = await state(page);
    await page.keyboard.press("+"); await page.keyboard.press("+"); await frame(page);
    await page.keyboard.press("Shift+ArrowRight"); await frame(page); await page.waitForTimeout(800);
    const k5 = await state(page);
    await page.keyboard.press("0"); await frame(page);
    const k6 = await state(page);
    check("V10a", "Tab reaches the plot with a visible 2 px focus ring", reached && ring.fv && ring.style === "solid" && ring.width === "2px", ring);
    check("V10b", "+ zooms in, → pans right, ← pans back, − zooms out, 0 resets",
      k1.vmax - k1.vmin < k0.vmax - k0.vmin && k2.vmin > k1.vmin && Math.abs(k3.vmin - k1.vmin) < 1e-6 * (k1.vmax - k1.vmin) && k4.vmax - k4.vmin > k3.vmax - k3.vmin && Math.abs(k6.vmin - k6.dmin) < 1e-6 && Math.abs(k6.vmax - k6.dmax) < 1e-6,
      { spans: [k0, k1, k2, k3, k4, k6].map((k) => +(k.vmax - k.vmin).toFixed(1)), mins: [k1.vmin, k2.vmin, k3.vmin].map((v) => +v.toFixed(1)) });
    check("V10c", "the aria-live region carries the readout (focus + Shift+→ step)", /TOF [0-9]/.test(k0.live) && /TOF [0-9]/.test(k5.live) && k5.live !== k0.live, { k0: k0.live.slice(0, 80), k5: k5.live.slice(0, 80) });
  }

  // ---- V13: click semantics: tick click spotlights; fit handle drags ----
  {
    await page.getByRole("button", { name: "Reset zoom" }).click().catch(() => {});
    s = await state(page);
    const ticks = await tickColumns(page, s, 0, true);
    // A tick in the middle of the data area, clear of the fit-range handles (they sit on top).
    const ux = ticks.filter((u) => u > s.x0 + 0.3 * (s.x1 - s.x0) && u < s.x0 + 0.7 * (s.x1 - s.x0))[0];
    await page.mouse.click(s.rect.x + (ux / s.boxW) * s.rect.w, userYToClient(s, s.tickTop + s.tickH / 2));
    await page.waitForTimeout(300);
    const pick = await page.evaluate(() => [...document.querySelectorAll("div[title^='Click to dismiss']")].map((d) => d.textContent)[0] ?? null);
    check("V13a", "a click on a Bragg tick spotlights it", !!pick && /\(-?\d+ -?\d+ -?\d+\)/.test(pick), pick);
    await page.mouse.click(s.rect.x + (ux / s.boxW) * s.rect.w, userYToClient(s, s.tickTop + s.tickH / 2));
    await page.waitForTimeout(300);
    const gone = await page.evaluate(() => document.querySelectorAll("div[title^='Click to dismiss']").length === 0);
    check("V13b", "a second click on the same tick clears the spotlight", gone);
    // fit handle cap drag
    const fitText = async () => page.evaluate(() => (/fit ([0-9.]+)–([0-9.]+)/.exec(document.body.innerText) ?? [])[0]);
    const f0 = await fitText();
    const cap = await page.evaluate(() => {
      const svg = [...document.querySelectorAll("svg.wb-plot")].find((x) => x.getBoundingClientRect().width > 0);
      const r = [...svg.querySelectorAll("rect[rx='3']")][0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const v0 = await state(page);
    await page.mouse.move(cap.x, cap.y); await page.mouse.down();
    await page.mouse.move(cap.x + 40, cap.y, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(300);
    const f1 = await fitText();
    const v1 = await state(page);
    check("V13c", "the fit-range handle still drags (and does not pan)", f0 !== f1 && Math.abs(v0.vmin - v1.vmin) < 1e-9, { f0, f1 });
  }

  // ---- V13d: magnetic step: "+ Add peak from plot" receives a plain click ----
  {
    await page.getByRole("button", { name: /Magnetic analysis/ }).first().click();
    await page.waitForTimeout(2500);
    const rows0 = await page.evaluate(() => (document.body.innerText.match(/#\d+/g) ?? []).length);
    const add = page.getByRole("button", { name: /Add peak from plot/ });
    if (await add.count()) {
      await add.first().click();
      s = await state(page);
      await page.mouse.click(s.rect.x + ((s.x0 + 0.55 * (s.x1 - s.x0)) / s.boxW) * s.rect.w, s.rect.y + s.rect.h * 0.3);
      await page.waitForTimeout(800);
      const rows1 = await page.evaluate(() => (document.body.innerText.match(/#\d+/g) ?? []).length);
      check("V13d", "magnetic step: Add peak from plot takes the click", rows1 > rows0, { rows0, rows1 });
      const a = await anchorTest(page, "magnetic", "ctrl");
      check("V1e", "magnetic-step plot: Ctrl+wheel zoom anchored (≤ 1 px)", a.worst <= 1, a);
      await shot(page, "v13-magnetic.png");
    } else check("V13d", "magnetic step: Add peak from plot takes the click", false, "button not found");
  }
  await ctx.close();
}

// =============================================================================
// Powder at 1280×720: the main column scrolls → plain wheel scrolls + hint
// =============================================================================
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, "Rietveld · Mn₃Ga neutron TOF");
  const s = await state(page);
  const scrollTop = () => page.evaluate(() => document.querySelector("main.wb-main")?.scrollTop ?? -1);
  const st0 = await scrollTop();
  await page.mouse.move(s.rect.x + s.rect.w * 0.5, s.rect.y + Math.min(s.rect.h * 0.3, 100));
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(250);
  const hint = await page.evaluate(() => document.body.innerText.includes("Use Ctrl + scroll to zoom"));
  await shot(page, "v2-hint.png");
  await page.waitForTimeout(300);
  const st1 = await scrollTop();
  const s1 = await state(page);
  check("V2a", "plain wheel on a scrolling page scrolls it and does not zoom, with the hint", st1 > st0 && s1.vmin === s.vmin && s1.vmax === s.vmax && hint, { st0, st1, hint, view: [s1.vmin, s1.vmax] });
  const s2 = await state(page);
  await ctrlWheel(page, s2.rect.x + s2.rect.w * 0.5, s2.rect.y + s2.rect.h * 0.4, -200);
  const st2 = await scrollTop();
  const s3 = await state(page);
  check("V2b", "Ctrl+wheel there zooms and does not scroll", st2 === st1 && s3.vmax - s3.vmin < s2.vmax - s2.vmin, { st1, st2, spans: [s2.vmax - s2.vmin, s3.vmax - s3.vmin] });
  const a = await anchorTest(page, "scrolling", "ctrl");
  check("V1f", "Ctrl+wheel anchored on the scrolling layout (≤ 1 px)", a.worst <= 1, a);
  await ctx.close();
}

// =============================================================================
// PDF demo: anchored zoom, readout in r (Å), keyboard
// =============================================================================
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, "PDF · GaTa₄Se₈ X-ray G(r)");
  const a = await anchorTest(page, "pdf", "ctrl");
  check("V1g", "G(r): Ctrl+wheel zoom anchored (≤ 1 px)", a.worst <= 1, a);
  const s = await state(page);
  const cx = s.rect.x + ((s.x0 + 0.37 * (s.x1 - s.x0)) / s.boxW) * s.rect.w;
  await page.mouse.move(cx, s.rect.y + s.rect.h * 0.3);
  await frame(page); await page.waitForTimeout(50);
  const t = await state(page);
  const printed = Number((/r ([0-9.]+) Å/.exec(t.readout?.text ?? "") ?? [])[1]);
  const xc = dataOf(t, cx);
  const pxData = (t.vmax - t.vmin) / ((t.x1 - t.x0) / t.boxW * t.rect.w);
  check("V3d", "G(r) readout: r in Å within ½ step of the cursor and of the point", Math.abs(t.readout.x - xc) <= t.readout.step / 2 + pxData / 2 && Math.abs(printed - t.readout.x) <= t.readout.step / 2 + 1e-9, { printed, x: t.readout.x, xc, step: t.readout.step, text: t.readout.text });
  await shot(page, "pdf-readout.png");
  // Pan clamp on G(r)
  await ctrlWheel(page, cx, s.rect.y + s.rect.h * 0.3, -300);
  const z = await state(page);
  await page.mouse.move(z.rect.x + z.rect.w * 0.3, z.rect.y + z.rect.h * 0.3); await page.mouse.down();
  await page.mouse.move(z.rect.x + z.rect.w * 0.3 + 4000, z.rect.y + z.rect.h * 0.3, { steps: 8 }); await page.mouse.up();
  await frame(page);
  const p = await state(page);
  check("V8b", "G(r) pan clamped at r min", Math.abs(p.vmin - p.dmin) < 1e-9 && Math.abs(p.vmax - p.vmin - (z.vmax - z.vmin)) < 1e-9, [p.vmin, p.vmax, p.dmin]);
  // S(Q) panel: load a synthetic S(Q) and check the shared mechanics there.
  const inputs = page.locator("input[type=file]");
  let loaded = false;
  for (let i = 0; i < (await inputs.count()) && !loaded; i++) {
    const acc = (await inputs.nth(i).getAttribute("accept")) ?? "";
    if (acc.startsWith(".gr,")) { await inputs.nth(i).setInputFiles(SQ); loaded = true; }
  }
  await page.waitForTimeout(2500);
  const sqTab = page.getByRole("button", { name: "S(Q)", exact: true });
  if (loaded && (await sqTab.count())) {
    await sqTab.first().click();
    await page.waitForTimeout(600);
    const sqSel = "svg.wb-plot[aria-label^='S(Q)'], svg.wb-plot[aria-label^='F(Q)']";
    const sa = await anchorTest(page, "sq", "ctrl", sqSel);
    check("V1h", "S(Q): Ctrl+wheel zoom anchored (≤ 1 px)", sa.worst <= 1, sa);
    const q = await state(page, sqSel);
    const qx = q.rect.x + ((q.x0 + 0.5 * (q.x1 - q.x0)) / q.boxW) * q.rect.w;
    await page.mouse.move(qx, q.rect.y + q.rect.h * 0.4);
    await frame(page); await page.waitForTimeout(50);
    const qr = await state(page, sqSel);
    const qPrinted = Number((/Q ([0-9.]+) Å/.exec(qr.readout?.text ?? "") ?? [])[1]);
    check("V3e", "S(Q) readout: Q within ½ step", qr.readout && Math.abs(qPrinted - qr.readout.x) <= qr.readout.step / 2 + 1e-9 && Math.abs(qr.readout.x - dataOf(qr, qx)) <= qr.readout.step / 2 + (qr.vmax - qr.vmin) / q.rect.w, qr.readout);
    await page.mouse.dblclick(qx, q.rect.y + q.rect.h * 0.4);
    await frame(page);
    const qd = await state(page, sqSel);
    check("V7b", "S(Q): double-click resets", Math.abs(qd.vmin - qd.dmin) < 1e-9 && Math.abs(qd.vmax - qd.dmax) < 1e-9, [qd.vmin, qd.vmax]);
    await shot(page, "sq-readout.png");
  } else check("V1h", "S(Q): Ctrl+wheel zoom anchored (≤ 1 px)", false, { loaded, tab: await sqTab.count() });
  await ctx.close();
}

// =============================================================================
// V12: redraw budget, demo and 100 k synthetic
// =============================================================================
async function perf(page, label) {
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: false }); });
  const s = await state(page);
  const r = await page.evaluate(async (s) => {
    const svg = [...document.querySelectorAll("svg.wb-plot")].find((x) => x.getBoundingClientRect().width > 0);
    const raf = () => new Promise((res) => requestAnimationFrame(() => res()));
    const steps = [];
    const cx = s.rect.x + s.rect.w * 0.5, cy = s.rect.y + s.rect.h * 0.3;
    // 40 wheel zoom steps (20 in, 20 out)
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      svg.dispatchEvent(new WheelEvent("wheel", { clientX: cx, clientY: cy, deltaY: i < 20 ? -60 : 60, ctrlKey: true, bubbles: true, cancelable: true }));
      await raf(); await raf();
      steps.push(performance.now() - t0);
    }
    // zoom in, then 40 drag-pan steps
    for (let i = 0; i < 4; i++) svg.dispatchEvent(new WheelEvent("wheel", { clientX: cx, clientY: cy, deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
    await raf(); await raf();
    const pan = [];
    const opt = (x) => ({ clientX: x, clientY: cy, pointerId: 7, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, isPrimary: true });
    svg.dispatchEvent(new PointerEvent("pointerdown", opt(cx)));
    for (let i = 1; i <= 40; i++) {
      const t0 = performance.now();
      svg.dispatchEvent(new PointerEvent("pointermove", opt(cx + (i % 20 < 10 ? i % 10 : 10 - (i % 10)) * 12)));
      await raf(); await raf();
      pan.push(performance.now() - t0);
    }
    svg.dispatchEvent(new PointerEvent("pointerup", opt(cx)));
    const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(0.95 * (a.length - 1))];
    return { zoomP95: p95(steps), zoomMax: Math.max(...steps), panP95: p95(pan), panMax: Math.max(...pan) };
  }, s);
  await page.waitForTimeout(200);
  const lt = await page.evaluate(() => window.__lt);
  const res = { ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(1)])), longTasks: lt.map((v) => Math.round(v)), maxLongTask: Math.round(Math.max(0, ...lt)) };
  check("V12", `${label}: no long task ≥ 50 ms and p95 step ≤ 50 ms (zoom and pan)`, res.maxLongTask < 50 && res.zoomP95 <= 50 && res.panP95 <= 50, res);
}
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, "Rietveld · Mn₃Ga neutron TOF");
  await perf(page, "demo 4 613 points");
  const inputs = page.locator("input[type=file]");
  for (let i = 0; i < (await inputs.count()); i++) {
    const acc = (await inputs.nth(i).getAttribute("accept")) ?? "";
    if (/xye|fxye|gsa|dat/i.test(acc)) { await inputs.nth(i).setInputFiles(SYN); break; }
  }
  await page.waitForTimeout(4000);
  const n = await page.evaluate(() => (/([0-9]+) points/.exec(document.body.innerText) ?? [])[1]);
  check("V12x", "100 k synthetic loaded", n === "100000", n);
  await perf(page, "synthetic 100 000 points");
  // Readout against the file: obs and x of the point under the cursor.
  const rows = readFileSync(SYN, "utf8").split("\n").slice(2).filter(Boolean).map((l) => l.trim().split(/\s+/).map(Number));
  await page.getByRole("button", { name: "Reset zoom" }).click().catch(() => {});
  const s = await state(page);
  const cx = s.rect.x + ((s.x0 + 0.52 * (s.x1 - s.x0)) / s.boxW) * s.rect.w;
  for (let i = 0; i < 8; i++) await ctrlWheel(page, cx, s.rect.y + s.rect.h * 0.3, -100);
  await page.mouse.move(cx + 1, s.rect.y + s.rect.h * 0.3);
  await frame(page); await page.waitForTimeout(50);
  const t = await state(page);
  const row = rows[t.readout.i];
  const obs = Number((/obs\s*\n?\s*([-0-9.e+]+)/.exec(t.readout.text) ?? [])[1]);
  check("V3f", "100 k: readout x and obs equal the file's point (x within ½ step, obs to 5 significant digits)", Math.abs(row[0] - t.readout.x) < 1e-6 && Math.abs(obs - row[1]) <= 5e-5 * Math.abs(row[1]) + 1e-9, { file: row, readout: t.readout.text.split("\n").slice(0, 2), i: t.readout.i });
  await shot(page, "v12-100k-zoomed.png");
  await ctx.close();
}

// =============================================================================
// V14: touch on a phone
// =============================================================================
{
  const { ctx, page } = await open({ width: 390, height: 844 }, "Rietveld · Mn₃Ga neutron TOF", { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.evaluate(() => [...document.querySelectorAll("svg.wb-plot")].find((x) => x.getBoundingClientRect().width > 0).scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  const scroller = () => page.evaluate(() => document.querySelector(".wb-shell")?.scrollTop ?? window.scrollY);
  const cdp = await ctx.newCDPSession(page);
  const touch = async (pts) => cdp.send("Input.dispatchTouchEvent", pts);
  let s = await state(page);
  const x = s.rect.x + s.rect.w / 2, y = s.rect.y + s.rect.h * 0.4;
  const sc0 = await scroller();
  await touch({ type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await touch({ type: "touchMove", touchPoints: [{ x, y: y - i * 20 }] });
  await touch({ type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
  const sc1 = await scroller();
  const s1 = await state(page);
  check("V14a", "one-finger vertical swipe over the plot scrolls the page, no zoom/pan", sc1 > sc0 && s1.vmin === s.vmin && s1.vmax === s.vmax, { sc0, sc1 });
  s = await state(page);
  const x2 = s.rect.x + s.rect.w / 2, y2 = s.rect.y + s.rect.h * 0.4;
  // two-finger pinch out
  await touch({ type: "touchStart", touchPoints: [{ x: x2 - 30, y: y2, id: 1 }, { x: x2 + 30, y: y2, id: 2 }] });
  for (let i = 1; i <= 8; i++) await touch({ type: "touchMove", touchPoints: [{ x: x2 - 30 - i * 10, y: y2, id: 1 }, { x: x2 + 30 + i * 10, y: y2, id: 2 }] });
  await touch({ type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  const s2 = await state(page);
  check("V14b", "two-finger pinch zooms in", s2.vmax - s2.vmin < 0.6 * (s.vmax - s.vmin), { before: s.vmax - s.vmin, after: s2.vmax - s2.vmin });
  await touch({ type: "touchStart", touchPoints: [{ x: x2, y: y2 }] });
  for (let i = 1; i <= 8; i++) await touch({ type: "touchMove", touchPoints: [{ x: x2 - i * 12, y: y2 }] });
  await touch({ type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  const s3 = await state(page);
  check("V14c", "one-finger horizontal drag pans", s3.vmin > s2.vmin && Math.abs(s3.vmax - s3.vmin - (s2.vmax - s2.vmin)) < 1e-6 * (s2.vmax - s2.vmin), { before: s2.vmin, after: s3.vmin });
  await touch({ type: "touchStart", touchPoints: [{ x: x2, y: y2 }] });
  await touch({ type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
  const s4 = await state(page);
  check("V14d", "a tap shows the readout", !!s4.readout, s4.readout?.text?.split("\n")[0]);
  await shot(page, "v14-phone.png");
  await ctx.close();
}

check("V11", "no page errors in any scenario", allErrors.length === 0, allErrors);
await browser.close();
if (OUT) writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 1));
rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

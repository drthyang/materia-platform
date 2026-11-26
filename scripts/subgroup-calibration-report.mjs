#!/usr/bin/env node
// The subgroup search's calibration report (THY-72): reads the JSON lines
// scripts/subgroup-calibration.sh wrote, computes the rates, and writes an
// HTML page with SVG figures (each also saved as its own .svg file).
// Usage: node scripts/subgroup-calibration-report.mjs RAW_DIR[,RAW_DIR…] OUT_DIR
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [rawDir, outDir] = process.argv.slice(2);
if (!rawDir || !outDir) throw new Error("usage: subgroup-calibration-report.mjs RAW_DIR OUT_DIR");
mkdirSync(join(outDir, "figures"), { recursive: true });

const runs = [];
const runInfo = [];
for (const dir of rawDir.split(",")) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) if (line.trim()) runs.push(JSON.parse(line));
  }
  if (existsSync(join(dir, "run.json"))) runInfo.push(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")));
}
const run = { procs: runInfo.map((r) => r.procs).join(" and "), runs: runInfo };
// A sharded dataset (each shard fitted every n-th step-1 candidate) is one dataset once all its shards are in:
// its rows merged and ranked as the step ranks them, its step-1 time the sum of the shards' (one process's time).
const tier = (x) => (x.status === "fitted" ? (x.accepted ? 0 : 1) : x.status === "fit failed" ? 2 : 3);
const rankRows = (rows) => [...rows].sort((a, b) => tier(a) - tier(b) || (a.bic ?? Infinity) - (b.bic ?? Infinity));
const TARGETS = { "a-b+a-": ["M irrep 3 of 10", "R irrep 8 of 10"], "GaTa4Se8 P-42_1m": ["X irrep 5 of 5", "W irrep 1 of 4"] };
function merged(all) {
  const out = all.filter((r) => !r.skipped && (!r.shard || r.shard[1] === 1));
  const groups = new Map();
  for (const r of all) if (!r.skipped && r.shard && r.shard[1] > 1) {
    const key = `${r.truth}|${r.level}|${r.seed}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const incomplete = [];
  for (const [key, parts] of groups) {
    const n = parts[0].shard[1];
    if (new Set(parts.map((x) => x.shard[0])).size !== n) { incomplete.push(`${key} (${parts.length} of ${n} shards)`); continue; }
    const rows = rankRows(parts.flatMap((x) => x.step1.rows));
    const top3 = [];
    for (const x of rows) if (x.status === "fitted") for (const ir of x.irreps) { const l = ir.replace(/ \(.*$/, ""); if (!top3.includes(l) && top3.length < 3) top3.push(l); }
    const fittedRows = rows.filter((x) => x.status === "fitted");
    const t = TARGETS[parts[0].truth];
    out.push({
      ...parts[0],
      shard: [0, 1],
      step1: { ...parts[0].step1, rows, seconds: parts.reduce((a, x) => a + x.step1.seconds, 0), stop: rows.some((x) => x.accepted) ? null : "no child passes the gate" },
      top3,
      ...(t ? { targetRanks: Object.fromEntries(t.map((l) => [l, fittedRows.findIndex((x) => x.irreps.some((ir) => ir.startsWith(l)))])), step2Fitted: false } : {}),
      sharded: n,
    });
  }
  return { out, incomplete };
}
const mergedRuns = merged(runs);
const done = mergedRuns.out;
const skipped = runs.filter((r) => r.skipped);
const LEVELS = [0.05, 0.1, 0.15];
const COLORS = { 0.05: "#2a78d6", 0.1: "#eb6834", 0.15: "#1baf7a" };
const T = -6;
const pct = (x) => `${(100 * x).toFixed(1)} %`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COPY = "© 2026 Tsung-Han Yang";

/** Wilson 95 % interval for k of n. */
function wilson(k, n) {
  if (n === 0) return [NaN, NaN];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const fitted = (r) => r.step1.rows.filter((x) => x.status === "fitted");
/** The four other criteria pass (ΔBIC aside): what a row needs, beside ΔBIC ≤ T, to be accepted. */
const othersPass = (x) => x.gate && x.gate.amplitude && x.gate.restarts && x.gate.rmax && x.gate.adp && x.gate.bvs;
/** A dataset's lowest ΔBIC among the rows passing the other four criteria (Infinity: none). */
const minGated = (r) => Math.min(Infinity, ...fitted(r).filter(othersPass).map((x) => x.deltaBic));
const minAny = (r) => Math.min(Infinity, ...fitted(r).map((x) => x.deltaBic));
const accepted1 = (r) => r.step1.rows.filter((x) => x.accepted);

// ── cubic: false descents ─────────────────────────────────────────────────────
const cubic = (l) => done.filter((r) => r.truth === "cubic" && r.level === l);
const falseRows = [];
const cubicSummary = LEVELS.map((l) => {
  const ds = cubic(l);
  const k = ds.filter((r) => accepted1(r).length > 0).length;
  const kBic = ds.filter((r) => minAny(r) <= T).length;
  const gated = ds.map(minGated).sort((a, b) => a - b);
  // The threshold that keeps false descents ≤ 5 %: below the (⌊0.05 n⌋+1)-th smallest gated minimum.
  const allowed = Math.floor(0.05 * ds.length);
  const needed = gated[allowed];
  for (const r of ds) for (const x of accepted1(r)) falseRows.push({ level: l, seed: r.seed, ...x });
  return { level: l, n: ds.length, k, kBic, ci: wilson(k, ds.length), needed, gated };
});

// ── truths ────────────────────────────────────────────────────────────────────
const irrepsOf = (x) => x.irreps.join(" + ");
function outcome(r) {
  const top = r.step1.rows.find((x) => x.accepted);
  if (r.truth === "a-a-a-") {
    const ok = top && top.irreps.length === 1 && top.irreps[0] === "R irrep 8 of 10 (a,a,a)" && top.group === "R -3 c:H #167";
    return { ok: !!ok, what: top ? `step 1's top accepted: ${top.group} ${irrepsOf(top)}` : "step 1 accepted nothing" };
  }
  if (r.truth === "a-b+a-") {
    const labels = new Set(accepted1(r).flatMap((x) => x.irreps.map((i) => i.replace(/ \(.*$/, ""))));
    const s1 = labels.has("M irrep 3 of 10") && labels.has("R irrep 8 of 10");
    const top2 = r.step2?.rows.find((x) => x.accepted);
    const s2 = top2 && top2.group === "P n m a #62" && new Set(top2.irreps.map((i) => i.replace(/ \(.*$/, ""))).size === 2 && top2.irreps.every((i) => /^(M irrep 3 of 10|R irrep 8 of 10)/.test(i));
    return { ok: !!(s1 && s2), what: `step 1 accepts M3: ${labels.has("M irrep 3 of 10") ? "yes" : "no"}, R8: ${labels.has("R irrep 8 of 10") ? "yes" : "no"}; step 2 ${r.step2Fitted ? (top2 ? `top accepted ${top2.group} ${irrepsOf(top2)}` : "accepted nothing") : r.top3.includes("M irrep 3 of 10") && r.top3.includes("R irrep 8 of 10") ? "not fitted in this run (sharded step 1)" : "never tries M3 + R8: they are not both among step 1's top 3 irreps"}` };
  }
  if (r.truth === "GaTa4Se8 P-42_1m") {
    const top2 = r.step2?.rows.find((x) => x.accepted);
    const ok = top2 && top2.key.startsWith("c45:") && top2.irreps.some((i) => i.startsWith("X irrep 5")) && top2.irreps.some((i) => i.startsWith("W irrep 1"));
    return { ok: !!ok, what: r.step2Fitted ? (top2 ? `step 2's top accepted ${top2.group} ${irrepsOf(top2)}` : "step 2 accepted nothing") : `step 2 not run on the pair: step 1 ${accepted1(r).length ? "accepted a child, but X5 and W1 are not both in its top 3" : "accepted nothing"}` };
  }
  return { ok: accepted1(r).length === 0, what: accepted1(r).length ? `accepted ${accepted1(r).map((x) => `${x.group} ${irrepsOf(x)}`).join("; ")}` : "nothing accepted" };
}
const TRUTHS = ["a-a-a-", "a-b+a-", "GaTa4Se8 P-42_1m"];
const truthRows = done.filter((r) => r.truth !== "cubic").sort((a, b) => TRUTHS.indexOf(a.truth) - TRUTHS.indexOf(b.truth) || a.level - b.level || a.seed - b.seed);

// ── figures ───────────────────────────────────────────────────────────────────
const W = 760, H = 320, M = { l: 64, r: 20, t: 52, b: 52 };
function frame(title, xLabel, yLabel, body, h = H) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" font-family="system-ui, sans-serif" font-size="12" role="img" aria-label="${esc(title)}">
<rect width="${W}" height="${h}" fill="#fcfcfb"/>
<text x="${M.l}" y="20" font-size="14" font-weight="600" fill="#0b0b0b">${esc(title)}</text>
${body}
<text x="${(W + M.l - M.r) / 2}" y="${h - 12}" text-anchor="middle" fill="#52514e">${esc(xLabel)}</text>
<text transform="translate(16 ${(h + M.t - M.b) / 2}) rotate(-90)" text-anchor="middle" fill="#52514e">${esc(yLabel)}</text>
<text x="${W - M.r}" y="${h - 12}" text-anchor="end" font-size="10" fill="#8a8985">${COPY}</text>
</svg>`;
}
const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
function axisX(x, ticks, h = H) {
  return ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${M.t}" y2="${h - M.b}" stroke="#e6e5e0"/><text x="${x(t)}" y="${h - M.b + 16}" text-anchor="middle" fill="#52514e">${t}</text>`).join("");
}
function axisY(y, ticks, fmt = (t) => t) {
  return ticks.map((t) => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e6e5e0"/><text x="${M.l - 6}" y="${y(t) + 4}" text-anchor="end" fill="#52514e">${fmt(t)}</text>`).join("");
}
function legend(items, x0 = M.l) {
  return items.map((it, i) => `<circle cx="${x0 + 5 + i * 110}" cy="36" r="5" fill="${it.color}"/><text x="${x0 + 14 + i * 110}" y="40" fill="#0b0b0b">${esc(it.label)}</text>`).join("");
}
const levelLegend = legend(LEVELS.map((l) => ({ color: COLORS[l], label: `${l * 100} % noise` })));
const refLine = (x, label, h = H) => `<line x1="${x}" x2="${x}" y1="${M.t}" y2="${h - M.b}" stroke="#0b0b0b" stroke-dasharray="4 3"/><text x="${x + 4}" y="${M.t + 12}" fill="#0b0b0b">${esc(label)}</text>`;

const figures = [];
function figure(name, svg, caption) {
  writeFileSync(join(outDir, "figures", `${name}.svg`), svg);
  figures.push({ name, svg, caption });
}

// F1: each cubic dataset's lowest gated ΔBIC (clipped), by level.
{
  const lo = -30, hi = 20;
  const x = scale(lo, hi, M.l, W - M.r);
  const rows = LEVELS.map((l, i) => ({ l, y: M.t + 40 + i * 70 }));
  let body = axisX(x, [-30, -20, -10, -6, 0, 10, 20]) + refLine(x(T), "ΔBIC = −6");
  for (const { l, y } of rows) {
    body += `<text x="${M.l - 6}" y="${y + 4}" text-anchor="end" fill="#52514e">${l * 100} %</text>`;
    cubic(l).forEach((r, j) => {
      const v = minGated(r);
      const vv = Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : hi;
      body += `<circle cx="${x(vv)}" cy="${y + ((j % 5) - 2) * 6}" r="5" fill="${COLORS[l]}" stroke="#fcfcfb" stroke-width="2"><title>seed ${r.seed}: ${Number.isFinite(v) ? v.toFixed(1) : "no candidate passes the other four criteria"}</title></circle>`;
    });
  }
  figure("f1-cubic-min-dbic", frame("Cubic SrTiO₃: each dataset's lowest ΔBIC among candidates passing the other four gate criteria", "ΔBIC (clipped to −30 … 20; ≥ 20: none passes the other four)", "noise level", body + levelLegend),
    "Each dot is one cubic dataset (seed). A dot left of the dashed line is a false descent: step 1 accepts a child of the cubic parent. The others are where the nearest candidate sits.");
}

// F2: per-candidate ΔBIC on cubic, histogram by level (bins of 2).
{
  const lo = -20, hi = 30, bw = 2;
  const nb = (hi - lo) / bw;
  const counts = LEVELS.map((l) => {
    const c = new Array(nb).fill(0);
    for (const r of cubic(l)) for (const row of fitted(r)) { const b = Math.floor((Math.max(lo, Math.min(hi - 1e-9, row.deltaBic)) - lo) / bw); c[b]++; }
    return c;
  });
  const ymax = Math.max(1, ...counts.flat());
  const x = scale(lo, hi, M.l, W - M.r);
  const y = scale(0, ymax, H - M.b, M.t + 20);
  let body = axisX(x, [-20, -10, -6, 0, 10, 20, 30]) + axisY(y, [0, Math.round(ymax / 2), ymax]) + refLine(x(T), "ΔBIC = −6");
  const sub = (x(lo + bw) - x(lo)) / 3;
  counts.forEach((c, li) => c.forEach((n, b) => { if (n) body += `<rect x="${x(lo + b * bw) + li * sub + 1}" y="${y(n)}" width="${sub - 2}" height="${H - M.b - y(n)}" rx="2" fill="${COLORS[LEVELS[li]]}"><title>${LEVELS[li] * 100} %: ${n} candidates with ΔBIC in [${lo + b * bw}, ${lo + (b + 1) * bw})</title></rect>`; }));
  figure("f2-cubic-dbic-histogram", frame("Cubic SrTiO₃: ΔBIC of every fitted step-1 candidate", "ΔBIC (clipped to −20 … 30)", "candidates", body + levelLegend),
    "All fitted candidates of every cubic dataset. On data without a distortion each candidate's expected ΔBIC is about +Δp·ln N_ind (≈ +4 per mode); the left tail is what the threshold has to cut.");
}

// F3: false-descent rate against the threshold T.
{
  const lo = -20, hi = 0;
  const x = scale(lo, hi, M.l, W - M.r);
  const y = scale(0, 1, H - M.b, M.t + 20);
  let body = axisX(x, [-20, -15, -10, -6, -5, 0]) + axisY(y, [0, 0.05, 0.25, 0.5, 0.75, 1], (t) => `${t * 100} %`) + refLine(x(T), "−6");
  for (const s of cubicSummary) {
    if (s.n === 0) continue;
    let d = "";
    for (let t = lo; t <= hi + 1e-9; t += 0.25) {
      const rate = s.gated.filter((v) => v <= t).length / s.n;
      d += `${d ? "L" : "M"}${x(t).toFixed(1)},${y(rate).toFixed(1)}`;
    }
    body += `<path d="${d}" fill="none" stroke="${COLORS[s.level]}" stroke-width="2"/>`;
  }
  figure("f3-false-descent-vs-threshold", frame("Cubic SrTiO₃: false-descent rate if the ΔBIC threshold were T (other criteria as decided)", "threshold T (a child needs ΔBIC ≤ T)", "datasets with a false descent", body + levelLegend),
    "The share of cubic datasets in which some candidate passes the other four criteria with ΔBIC ≤ T. The decided threshold is −6; the target is ≤ 5 % (the 5 % grid line).");
}

// F4: why cubic candidates with ΔBIC ≤ −6 are rejected, criterion by criterion.
{
  const cands = done.filter((r) => r.truth === "cubic").flatMap((r) => fitted(r).filter((x) => x.deltaBic <= T));
  const crit = [["amplitude ≥ 3σ", "amplitude"], ["≥ 3 starts agree", "restarts"], ["rmax ± 2 Å", "rmax"], ["ADP positive", "adp"], ["BVS within 15 %", "bvs"]];
  const n = cands.length;
  const x = scale(0, 1, M.l + 110, W - M.r);
  let body = axisX(x, [0, 0.25, 0.5, 0.75, 1]).replace(/>(0(\.\d+)?|1)</g, (m, v) => `>${Math.round(v * 100)} %<`);
  crit.forEach(([label, k], i) => {
    const fail = cands.filter((c) => c.gate && !c.gate[k]).length;
    const yy = M.t + 20 + i * 40;
    body += `<text x="${M.l + 104}" y="${yy + 14}" text-anchor="end" fill="#0b0b0b">${label}</text><rect x="${x(0)}" y="${yy}" width="${Math.max(0, x(n ? fail / n : 0) - x(0))}" height="20" rx="2" fill="#2a78d6"><title>${fail} of ${n} fail</title></rect><text x="${x(n ? fail / n : 0) + 6}" y="${yy + 14}" fill="#0b0b0b">${fail} of ${n}</text>`;
  });
  figure("f4-gate-criteria-on-false-candidates", frame("Cubic SrTiO₃, all levels: candidates with ΔBIC ≤ −6, and which criterion rejects them", "share of those candidates failing the criterion", "", body),
    `${n} candidates over all cubic datasets reached ΔBIC ≤ −6. Each bar is the share failing that criterion (a candidate can fail several); the ones failing none are the false descents.`);
}

// F5: the amplitude in σ: cubic candidates with ΔBIC ≤ 0 against the true children.
{
  const cub = done.filter((r) => r.truth === "cubic").flatMap((r) => fitted(r).filter((x) => x.gate && x.deltaBic <= 0).map((x) => Math.min(...x.gate.sigmas)));
  const tru = done.filter((r) => r.truth === "a-a-a-").flatMap((r) => fitted(r).filter((x) => x.key.startsWith("c71:R irrep 8") && x.gate).map((x) => Math.min(...x.gate.sigmas)));
  const lo = 0, hi = 40;
  const x = scale(lo, hi, M.l, W - M.r);
  let body = axisX(x, [0, 3, 10, 20, 30, 40]) + refLine(x(3), "3σ");
  const strip = (vals, yy, color, label) => `<text x="${M.l - 6}" y="${yy + 4}" text-anchor="end" fill="#52514e">${label}</text>` + vals.map((v, j) => `<circle cx="${x(Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0)))}" cy="${yy + ((j % 7) - 3) * 5}" r="4" fill="${color}" stroke="#fcfcfb" stroke-width="2"><title>${Number.isFinite(v) ? v.toFixed(1) : "undetermined"}σ</title></circle>`).join("");
  body += strip(cub, M.t + 60, "#eb6834", "cubic") + strip(tru, M.t + 160, "#2a78d6", "a⁻a⁻a⁻ R-3c");
  figure("f5-amplitude-sigmas", frame("The primary amplitude in σ (σ = esd × √(N_grid/N_ind))", "amplitude / σ (clipped at 40; undetermined at 0)", "", body),
    "Orange: cubic candidates with ΔBIC ≤ 0 (no true distortion). Blue: the true child R-3c on a⁻a⁻a⁻ data. The gate needs ≥ 3σ.");
}

// F6: the largest atom displacement of every fitted candidate.
{
  const vals = (t) => done.filter((r) => r.truth === t).flatMap((r) => r.step1.rows.filter((x) => x.maxDisplacement !== undefined).map((x) => x.maxDisplacement));
  const lo = 0, hi = 1;
  const x = scale(lo, hi, M.l + 70, W - M.r);
  let body = axisX(x, [0, 0.1, 0.25, 0.5, 0.75, 1]) + refLine(x(0.5), "0.5 Å");
  ["cubic", "a-a-a-", "a-b+a-", "GaTa4Se8 P-42_1m"].forEach((t, i) => {
    const yy = M.t + 30 + i * 50;
    body += `<text x="${M.l + 64}" y="${yy + 4}" text-anchor="end" fill="#52514e">${t.replace(" P-42_1m", "")}</text>`;
    vals(t).forEach((v, j) => { body += `<circle cx="${x(Math.min(hi, v))}" cy="${yy + ((j % 5) - 2) * 4}" r="3" fill="#2a78d6" opacity="0.6"><title>${v.toFixed(3)} Å</title></circle>`; });
  });
  figure("f6-max-displacement", frame("The largest atom displacement from its parent position, every fitted candidate", "Å (clipped at 1)", "", body),
    "A candidate moving any atom more than 0.5 Å is a failed fit (decision 9).");
}

// F7: step 1's time per dataset against the 10-minute budget.
{
  const ds = [...done].sort((a, b) => a.step1.seconds - b.step1.seconds);
  const ymax = Math.max(600, ...ds.map((r) => r.step1.seconds)) * 1.05;
  const x = scale(0, Math.max(1, ds.length), M.l, W - M.r);
  const y = scale(0, ymax, H - M.b, M.t + 20);
  let body = axisY(y, [0, 300, 600, Math.round(ymax / 100) * 100].filter((v, i, a) => a.indexOf(v) === i)) + `<line x1="${M.l}" x2="${W - M.r}" y1="${y(600)}" y2="${y(600)}" stroke="#0b0b0b" stroke-dasharray="4 3"/><text x="${M.l + 4}" y="${y(600) - 4}" fill="#0b0b0b">10-minute budget</text>`;
  const bw = (x(1) - x(0));
  ds.forEach((r, i) => { body += `<rect x="${x(i) + 1}" y="${y(r.step1.seconds)}" width="${Math.max(1, bw - 2)}" height="${H - M.b - y(r.step1.seconds)}" rx="2" fill="${r.truth === "cubic" ? "#2a78d6" : "#eb6834"}"><title>${r.truth} ${r.level * 100} % seed ${r.seed}: ${r.step1.seconds.toFixed(0)} s</title></rect>`; });
  figure("f7-step1-time", frame("Step 1's time per dataset (full screen, budget lifted), against the 10-minute budget", "datasets, sorted by time", "seconds", body + legend([{ color: "#2a78d6", label: "cubic" }, { color: "#eb6834", label: "a truth" }])),
    `Node, one thread per process, ${run.procs ?? "?"} processes sharing the machine. The browser's worker pool would be faster per fit; the counts of candidates are the same.`);
}

// ── tables ────────────────────────────────────────────────────────────────────
const td = (s) => `<td>${s}</td>`;
const rateTable = `<table><tr><th>noise</th><th>datasets</th><th>false descents (full gate, ΔBIC ≤ −6)</th><th>95 % interval</th><th>datasets with any ΔBIC ≤ −6 (ΔBIC alone)</th><th>threshold that would give ≤ 5 % here</th></tr>${cubicSummary.map((s) => `<tr>${td(`${s.level * 100} %`)}${td(s.n)}${td(s.n ? `${s.k} of ${s.n} = ${pct(s.k / s.n)}` : "—")}${td(s.n ? `${pct(s.ci[0])} – ${pct(s.ci[1])}` : "—")}${td(s.n ? `${s.kBic} of ${s.n}` : "—")}${td(s.n ? (Number.isFinite(s.needed) ? `ΔBIC &lt; ${s.needed.toFixed(1)}` : "any (no candidate passes the other four)") : "—")}</tr>`).join("")}</table>`;
const falseTable = falseRows.length ? `<table><tr><th>noise</th><th>seed</th><th>class</th><th>irrep</th><th>ΔBIC</th><th>Δp</th><th>σ</th><th>starts</th><th>ΔBIC at rmax ∓ 2</th><th>first-peak ΔBIC</th></tr>${falseRows.map((x) => `<tr>${td(`${x.level * 100} %`)}${td(x.seed)}${td(esc(`${x.key.split(":")[0]} ${x.group} ${x.cell}`))}${td(esc(x.irreps.join(" + ")))}${td(x.deltaBic.toFixed(1))}${td(x.dp)}${td(x.gate.sigmas.map((s) => s.toFixed(1)).join(", "))}${td(`${x.agreeing}/${x.starts}`)}${td(`${x.gate.rmaxLow.toFixed(1)}, ${x.gate.rmaxHigh.toFixed(1)}`)}${td(x.firstPeak ? x.firstPeak.deltaBic.toFixed(1) : "")}</tr>`).join("")}</table>` : "<p>None.</p>";
const truthTable = `<table><tr><th>truth</th><th>noise</th><th>seed</th><th>window (Å)</th><th>parent Rw</th><th>expected outcome</th><th>what happened</th><th>step 1 top 3 irreps</th><th>step 1 rank of the target irreps</th><th>step 2 would try</th><th>step 1 time</th></tr>${truthRows.map((r) => { const o = outcome(r); return `<tr>${td(esc(r.truth))}${td(`${r.level * 100} %`)}${td(r.seed)}${td(`${r.window.rmin.toFixed(2)}–${r.window.rmax}`)}${td(pct(r.parentRw))}${td(o.ok ? "✓ met" : "✗ missed")}${td(esc(o.what))}${td(esc(r.top3.join(", ")))}${td(r.targetRanks ? esc(Object.entries(r.targetRanks).map(([k, v]) => `${k}: ${v < 0 ? "not fitted" : `#${v + 1}`}`).join("; ")) : "")}${td(r.step2Tries ? `${r.step2Tries.length} classes` : "")}${td(`${r.step1.seconds.toFixed(0)} s`)}</tr>`; }).join("")}</table>`;
const passTable = `<table><tr><th>truth</th>${LEVELS.map((l) => `<th>${l * 100} %</th>`).join("")}</tr>${TRUTHS.map((t) => `<tr>${td(esc(t))}${LEVELS.map((l) => { const ds = truthRows.filter((r) => r.truth === t && r.level === l); const k = ds.filter((r) => outcome(r).ok).length; return td(ds.length ? `${k} of ${ds.length}` : "—"); }).join("")}</tr>`).join("")}</table>`;
const gata = truthRows.filter((r) => r.truth === "GaTa4Se8 P-42_1m");
const capRows = done.flatMap((r) => [...r.step1.rows, ...(r.step2?.rows ?? [])].filter((x) => x.status === "not fitted" && /N_ind\/4/.test(x.reason ?? "")).map((x) => ({ r, x })));
const capTable = `<table><tr><th>dataset</th><th>N_ind</th><th>N_ind/4</th><th>candidates over the cap (step 1)</th><th>example</th></tr>${done.slice(0, 200).filter((r) => r.seed === 1).map((r) => { const over = capRows.filter((c) => c.r === r); return `<tr>${td(esc(`${r.truth} ${r.level * 100} % seed ${r.seed}`))}${td(r.step1.nInd.toFixed(1))}${td((r.step1.nInd / 4).toFixed(1))}${td(over.length)}${td(over[0] ? esc(`${over[0].x.group} ${over[0].x.irreps.join(" + ")}: ${over[0].x.reason}`) : "")}</tr>`; }).join("")}</table>`;
const noiseTable = `<table><tr><th>truth</th><th>noise</th><th>parent Rw in the window: mean (min–max)</th><th>first peak found at (Å)</th></tr>${["cubic", ...TRUTHS].flatMap((t) => LEVELS.map((l) => { const ds = done.filter((r) => r.truth === t && r.level === l); if (!ds.length) return ""; const rw = ds.map((r) => r.parentRw); const pk = ds.map((r) => r.peak.r.toFixed(2)); return `<tr>${td(esc(t))}${td(`${l * 100} %`)}${td(`${pct(rw.reduce((a, b) => a + b, 0) / rw.length)} (${pct(Math.min(...rw))}–${pct(Math.max(...rw))})`)}${td([...new Set(pk)].join(", "))}</tr>`; })).join("")}</table>`;
const bound = done.flatMap((r) => r.step1.rows.filter((x) => /moves .* Å from its parent position/.test(x.reason ?? "")));
const failed = done.flatMap((r) => r.step1.rows.filter((x) => x.status === "fit failed"));
// Rows these runs marked "worse than the parent" by round-off only (within the 0.1 % agreement tolerance): the engine
// now reads them as fitted (back at the parent's minimum). They have ΔBIC > 0, so no acceptance depends on them.
const roundOff = done.flatMap((r) => r.step1.rows.filter((x) => x.status === "fit failed" && /worse than its parent/.test(x.reason ?? "") && x.rw !== undefined && x.rw <= r.parentRw * 1.001));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>THY-72 subgroup search: calibration</title>
<style>
body{font-family:system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#0b0b0b;background:#fcfcfb;line-height:1.45}
h1{font-size:22px}h2{font-size:17px;margin-top:28px}
table{border-collapse:collapse;font-size:12.5px;margin:8px 0}td,th{border:1px solid #e0dfda;padding:4px 7px;text-align:left;vertical-align:top}th{background:#f1f0ec}
figure{margin:16px 0}figcaption{color:#52514e;font-size:13px;max-width:760px}.note{color:#52514e}
</style></head><body>
<h1>THY-72 subgroup search: calibration of the gate</h1>
<p class="note">${COPY}. Synthetic data only: SrTiO₃ (cubic, a⁻a⁻a⁻, a⁻b⁺a⁻, tilt 0.07 rad, neutron, Qmax 25 Å⁻¹, Qdamp 0.03 Å⁻¹, 2×2×2) and GaTa₄Se₈ (the bundled public demo structure; P-42₁m 1×1×2 truth with the X5 and W1 modes each moving the atom they move most by 0.07 Å; X-ray, the demo's Qmax and refined Qdamp, Qbroad, δ1, δ2). G(r) on 1–13 Å at 0.05 Å, F(Q) noise σ_F ∝ Q transformed with Qmax, level set so the parent fit on parent data reads Rw ≈ 5, 10, 15 %. Full step-1 screen (every single-irrep class), every number as decided; the step budget lifted so no screen is cut short. ${done.length} datasets done${skipped.length ? `, ${new Set(skipped.map((r) => `${r.truth}|${r.level}|${r.seed}`)).size} not started (the run's cap)` : ""}${mergedRuns.incomplete.length ? `, ${mergedRuns.incomplete.length} cut by the cap before all their shards finished (left out: ${esc(mergedRuns.incomplete.join(", "))})` : ""}; ${run.runs.map((r, i) => `run ${i + 1}: ${r.end ? `${((r.end - r.start) / 60).toFixed(1)} min wall clock` : "time not recorded"} on ${r.procs} processes, ${r.jobs} datasets queued`).join("; ")}.</p>
<h2>1. False descents on cubic data (decision 3: target ≤ 5 % at ΔBIC ≤ −6)</h2>
${rateTable}
<p class="note">"Threshold that would give ≤ 5 %" reads the lowest ΔBIC among candidates that pass the other four criteria, per dataset; with n datasets at most ⌊0.05·n⌋ may fall at or below the threshold. With few datasets the interval is wide: the rates are estimates, not a verdict.</p>
${figures.slice(0, 3).map((f) => `<figure>${f.svg}<figcaption>${esc(f.caption)}</figcaption></figure>`).join("")}
<h3>The false descents</h3>${falseTable}
<h2>2. The known truths (decisions 11 and 12: expected outcome in ≥ 95 % of seeds at 5 % and 10 %)</h2>
${passTable}
${truthTable}
<h2>3. The other four gate numbers</h2>
${figures.slice(3, 5).map((f) => `<figure>${f.svg}<figcaption>${esc(f.caption)}</figcaption></figure>`).join("")}
<h2>4. The N_ind/4 cap and the 0.5 Å bound</h2>
${capTable}
<p>GaTa₄Se₈: ${gata.length ? esc(gata.map((r) => (r.step2Tries ?? []).length ? "" : "").join("")) : ""}the truth's class (c45, P-42₁m 1×1×2, X5 + W1) frees 19 modes, p = 24, against N_ind/4 ≈ ${gata[0] ? (gata[0].step1.nInd / 4).toFixed(1) : "16.5"} at the decided window: it would be listed "not fitted" by stop rule 8(1) even when step 2 pairs X5 with W1.</p>
<p>${failed.length} step-1 candidates over all datasets were "fit failed"; ${bound.length} of them for an atom moving more than 0.5 Å, ${failed.filter((x) => /did not converge/.test(x.reason ?? "")).length} for a best start that did not converge (mostly the 30-iteration cap on candidates with many modes). ${roundOff.length} were marked "worse than the parent" by round-off only (within 0.1 % of the parent's Rw, a child back at the parent's minimum); these runs predate the engine's fix that reads such a child as fitted. They all have ΔBIC &gt; 0, so no rate or acceptance here depends on them; only the ranking of rows below the parent does.</p>
${figures.slice(5, 6).map((f) => `<figure>${f.svg}<figcaption>${esc(f.caption)}</figcaption></figure>`).join("")}
<h2>5. The noise levels and the window</h2>
${noiseTable}
<h2>6. Time against the 10-minute step budget</h2>
${figures.slice(6).map((f) => `<figure>${f.svg}<figcaption>${esc(f.caption)}</figcaption></figure>`).join("")}
</body></html>`;
writeFileSync(join(outDir, "index.html"), html);
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ datasets: done.length, skipped: skipped.length, cubic: cubicSummary.map(({ gated: _gated, ...s }) => s), truths: truthRows.map((r) => ({ truth: r.truth, level: r.level, seed: r.seed, ...outcome(r), top3: r.top3, targetRanks: r.targetRanks })), falseDescents: falseRows.map((x) => ({ level: x.level, seed: x.seed, key: x.key, deltaBic: x.deltaBic })) }, null, 1));
console.log(`wrote ${join(outDir, "index.html")}: ${done.length} datasets`);

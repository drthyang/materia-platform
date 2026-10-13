/**
 * Replays Example 3 of docs/AGENT_EXAMPLES.md (a magnetic structure from the
 * peaks the nuclear model leaves) through MATERIA's MCP server, the same tool
 * sequence src/mcp/examples.test.ts checks, and writes what the demo animation
 * shows: per call the tool, its key arguments and a one-line result, plus the
 * pattern curves after the nuclear-only fit and after the final magnetic fit.
 * Nothing is typed in by hand; every number comes from the tools.
 *
 * Usage:  npx vite-node scripts/example3-demo.ts <out.json>
 * Then:   node scripts/example3-demo-record.mjs <out.json>   (HTML → GIF/MP4)
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { exampleMagnetic } from "@/examples/mn3gaMagnetic";

const out = process.argv[2];
if (!out) throw new Error("usage: example3-demo.ts <out.json>");
const REPO = resolve(__dirname, "..");
const TIMEOUT = 300_000;
const LAMBDA = 1.54;

const tmp = mkdtempSync(join(tmpdir(), "materia-ex3-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(REPO, "scripts/build-mcp.mjs"), "--serve", "--outfile", join(tmp, "mcp-server.mjs")],
  env: { MATERIA_ROOTS: REPO },
  stderr: "pipe",
});
const client = new Client({ name: "example3-demo", version: "0" });
await client.connect(transport);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT });
  const text = (r.content as { text: string }[])[0]!.text;
  if (r.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

type Step = { n: string; tool: string; args: string; result: string };
const steps: Step[] = [];
const log = (s: Step): void => { steps.push(s); console.log(`${s.n.padEnd(3)} ${s.tool}(${s.args}) → ${s.result}`); };
const pct = (x: number): string => `${(100 * x).toFixed(2)} %`;
const pretty = (bns: string): string => bns.replace(/_1/g, "₁");

const s = await call("parse_structure", { path: "examples/mcp/mn3ga_30k_nuclear.cif" });
const sites = (s.structure.sites as string[]).map((x) => x.split(" ")[0]);
log({ n: "1", tool: "parse_structure", args: "mn3ga_30k_nuclear.cif", result: `${s.structure.spaceGroup}, sites ${sites.join(", ")}` });
const p = await call("parse_powder_data", { path: "examples/mcp/mn3ga_30k_sim.xye" });
log({ n: "2", tool: "parse_powder_data", args: "mn3ga_30k_sim.xye", result: `${(p.pattern.points as number).toLocaleString("en-US")} points, 2θ ${p.pattern.xRange.join("–")}°` });
const instrument = await call("parse_instrument", { path: "examples/mcp/mn3ga_30k.instprm" });
log({ n: "3", tool: "parse_instrument", args: "mn3ga_30k.instprm", result: `${instrument.radiationKind}, λ = ${instrument.wavelength} Å` });
const m = await call("build_refinement", { structure: s.structure, pattern: p.pattern, instrument });
log({ n: "4", tool: "build_refinement", args: "structure, pattern, instrument", result: `${m.parameters.count as number} symmetry-allowed parameters` });

const nuc = await call("refine_powder", {
  structure: s.structure, pattern: p.pattern, instrument, parameters: m.parameters, bindings: m.bindings, profile: m.profile,
  free: ["scale", "bkg*", "cell_*", "profU", "profV", "profW"],
});
const nucA = nuc.result.agreement;
log({ n: "5", tool: "refine_powder", args: "free: scale, bkg, cell, U V W", result: `wR ${pct(nucA.rWeighted)}, GoF ${nucA.goodnessOfFit.toFixed(2)}` });

const assess = await call("assess_refinement", { result: nuc.result, parameters: nuc.parameters, observationCount: nuc.observationCount, residual: nuc.residual });
const flagged = (assess.findings as { summary: string }[]).map((f) => /^(\d+) residual peaks?/.exec(f.summary)?.[1]).find(Boolean);
log({ n: "6", tool: "assess_refinement", args: "the step 5 result", result: `"${assess.verdict.band as string}"; ${flagged ?? "no"} residual peaks flagged` });

const peaks = await call("find_unexplained_peaks", { residual: nuc.residual });
const d = (peaks.peaks as { d: number }[]).map((x) => x.d);
log({ n: "7", tool: "find_unexplained_peaks", args: "the residual", result: `d = ${d.map((x) => x.toFixed(3)).join(", ")} Å` });

const ks = await call("search_propagation_vector", { structure: s.structure, peakD: d });
const k0 = ks.candidates[0];
log({ n: "8", tool: "search_propagation_vector", args: "those d values", result: `k = ${k0.label} matches ${k0.matched} of ${d.length}` });

const subs = await call("list_magnetic_subgroups", { structure: s.structure, k: [0, 0, 0] });
const candidates = subs.candidates as { bns: string; index: number }[];
const maximal = candidates.filter((c) => c.index === 2).map((c) => c.bns).sort();
log({ n: "9", tool: "list_magnetic_subgroups", args: "k = (0 0 0)", result: `${maximal.length} maximal groups (index 2), ${candidates.length - maximal.length} lower` });

const fit = async (bns: string, restarts: number) => {
  const i = candidates.findIndex((c) => c.bns === bns);
  const mm = await call("build_magnetic_model", {
    structure: s.structure, ionLabels: ["Mn1_0", "Mn2_1", "Mn3_2"], operations: { ref: `${subs.ref}/candidates/${i}/operations` }, k: [0, 0, 0], moment: 2,
  });
  const r = await call("refine_magnetic_powder", {
    structure: s.structure, magnetic: mm.magnetic, pattern: p.pattern, profile: m.profile,
    parameters: [nuc.parameters, mm.parameters], bindings: [m.bindings, mm.bindings], free: ["scale", "bkg*", "mom_*"], restarts,
  });
  // Which moment components the group allows: those the refined moments use.
  const refined = (await call("read_ref", { ref: r.magnetic.ref })).value as { moments: { components: number[] }[] };
  const axes = ["a", "b", "c"].filter((_, j) => refined.moments.some((x) => Math.abs(x.components[j]!) > 1e-6));
  return { mm, r, axes, wR: r.result.agreement.rWeighted as number, gof: r.result.agreement.goodnessOfFit as number };
};
// The four groups ran in parallel in the recorded run; the calls are listed per group.
const fits = Object.fromEntries(await Promise.all(maximal.map(async (bns) => [bns, await fit(bns, 12)] as const)));
const order = ["P2_1/m", "P2_1'/m", "P2_1/m'", "P2_1'/m'"];
maximal.sort((a, b) => order.indexOf(a) - order.indexOf(b));
const groups = maximal.map((bns) => ({ bns: pretty(bns), axes: fits[bns]!.axes, wR: fits[bns]!.wR, gof: fits[bns]!.gof }));
console.log(JSON.stringify(groups));
maximal.forEach((bns, j) => log({
  n: `${10 + 2 * j}–${11 + 2 * j}`, tool: "build_magnetic_model + refine_magnetic_powder", args: `${pretty(bns)}, 12 restarts`,
  result: `wR ${pct(fits[bns]!.wR)}, GoF ${fits[bns]!.gof.toFixed(2)}`,
}));

const best = fits["P2_1'/m'"]!;
const final = await call("refine_magnetic_powder", {
  structure: s.structure, magnetic: best.r.magnetic, pattern: p.pattern, profile: m.profile,
  parameters: best.r.parameters, bindings: [m.bindings, best.mm.bindings],
  free: ["scale", "bkg*", "cell_*", "profU", "profV", "profW", "pos_*", "B_*", "mom_*"],
});
const finA = final.result.agreement;
log({ n: "18", tool: "refine_magnetic_powder", args: "P2₁'/m', everything free", result: `wR ${pct(finA.rWeighted)}, GoF ${finA.goodnessOfFit.toFixed(2)}` });

// The moments against the ones the pattern was simulated from, up to the global ±m.
const found = (await call("read_ref", { ref: final.magnetic.ref })).value as { moments: { siteLabel: string; components: number[] }[] };
const truth = exampleMagnetic().magnetic.moments;
const sign = Math.sign(found.moments[0]!.components[0]! * truth[0]!.components[0]!);
let maxDev = 0;
const moments = truth.map((t) => {
  const f = found.moments.find((x) => x.siteLabel === t.siteLabel)!;
  const fc = f.components.map((c) => sign * c);
  t.components.forEach((c, j) => { maxDev = Math.max(maxDev, Math.abs(fc[j]! - c)); });
  return { site: t.siteLabel, found: fc, truth: t.components };
});
console.log(`moments: max |found − truth| = ${maxDev.toFixed(3)} μB`);

// The curves, with the same function the tools fit with (evaluate_pattern). Not part of the run.
const curves = async (args: Record<string, unknown>) => {
  const e = await call("evaluate_pattern", { structure: s.structure, pattern: p.pattern, profile: m.profile, ...args });
  // The curves come back as a ref; each series is read out of it a page at a time.
  const read = async (series: string): Promise<number[]> => {
    const all: number[] = [];
    let size = 400;
    while (all.length < (e.curves.points as number)) {
      const start = all.length;
      try {
        all.push(...((await call("read_ref", { ref: `${e.curves.ref as string}/${series}`, start, end: start + size })).items as number[]));
      } catch (err) {
        // Too many characters for one read: take the page size the server suggests.
        const fits = /Read about (\d+)/.exec(String(err))?.[1];
        if (!fits || Number(fits) >= size) throw err;
        size = Number(fits);
      }
    }
    return all;
  };
  return { x: await read("x"), yObs: await read("yObs"), yCalc: await read("yCalc"), diff: await read("diff"), wR: e.agreement.wR as number };
};
const nucCurves = await curves({ parameters: nuc.parameters, bindings: m.bindings });
const finCurves = await curves({ parameters: final.parameters, bindings: [m.bindings, best.mm.bindings], magnetic: final.magnetic });
console.log(`evaluate_pattern: nuclear wR ${nucCurves.wR.toFixed(2)} %, final wR ${finCurves.wR.toFixed(2)} %`);

const twoTheta = (dd: number): number => (2 * Math.asin(LAMBDA / (2 * dd)) * 180) / Math.PI;
writeFileSync(out, JSON.stringify({
  steps, groups, best: "P2₁'/m'",
  nuclear: { wR: nucA.rWeighted, gof: nucA.goodnessOfFit, curves: nucCurves },
  final: { wR: finA.rWeighted, gof: finA.goodnessOfFit, curves: finCurves },
  peaks: d.map((dd) => ({ d: dd, x: twoTheta(dd) })),
  moments, maxDev,
}));
console.log(`wrote ${out}`);
await client.close();
rmSync(tmp, { recursive: true, force: true });

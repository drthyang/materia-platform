import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { inspectDataRange, type DataRangeInput } from "@/core/diagnostics/dataRange";
import { buildPowderSpec } from "@/app/powderSpec";
import { check_fit_range, parse_instrument, parse_powder_data, parse_structure } from "@/mcp/tools";
import { runPowderRefinement } from "@/workers/runPowder";
import { dataExists, dataPath } from "@/testSupport/data";

/** Seeded standard normal deviates (mulberry32, then Box–Muller). */
function gaussian(seed = 7): () => number {
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/**
 * A 2θ pattern, 10–130° in 0.05° steps: Gaussian lines (FWHM 0.3°) of the
 * given heights on a flat background, with counting noise, and the model's
 * curve without noise.
 */
function pattern(lines: readonly { at: number; height: number }[], background = 200, edit?: (x: number, y: number) => number): DataRangeInput {
  const noise = gaussian();
  const x = Array.from({ length: 2401 }, (_, i) => 10 + 0.05 * i);
  const peak = (v: number): number => lines.reduce((s, l) => s + l.height * Math.exp((-4 * Math.LN2 * (v - l.at) ** 2) / 0.09), 0);
  const yCalc = x.map((v) => background + peak(v));
  const yObs = x.map((v, i) => {
    const y = edit ? edit(v, yCalc[i]!) : yCalc[i]!;
    return Math.round(y + Math.sqrt(y) * noise());
  });
  return {
    x,
    yObs,
    sigma: yObs.map((y) => Math.sqrt(Math.max(y, 1))),
    yCalc,
    yBackground: x.map(() => background),
    reflections: lines.map((l) => l.at),
    shortD: "high",
  };
}

/** Lines every 2.5° from 20° to 127.5°. */
const LINES = Array.from({ length: 44 }, (_, i) => ({ at: 20 + 2.5 * i, height: 800 - 10 * i }));

describe("the data's ends", () => {
  it("starts just below the first reflection and keeps a far end where the lines go on", () => {
    const r = inspectDataRange(pattern(LINES));
    expect(r.low.verdict).toBe("trim");
    expect(r.low.findings.map((f) => f.cause)).toEqual(["background-only"]);
    // Three line widths (0.9°) or 1 % of the axis (1.2°) short of the first line at 20°.
    expect(r.low.cut!).toBeGreaterThan(18.6);
    expect(r.low.cut!).toBeLessThan(19.2);
    expect(r.high.verdict).toBe("keep");
    expect(r.proposed).toEqual({ min: r.low.cut, max: 130 });
    expect(r.basis).toBe("the data");
  });

  it("keeps the background stretch when the data hold a peak there no phase explains", () => {
    // A line at 14° the model lacks (magnetic order, an impurity).
    const r = inspectDataRange(pattern(LINES, 200, (v, y) => y + 400 * Math.exp((-4 * Math.LN2 * (v - 14) ** 2) / 0.09)));
    expect(r.low.verdict).toBe("keep");
    expect(r.low.notes.join(" ")).toMatch(/the data hold 1 peak there \(the strongest \d+σ at 1(3\.9|4\.0)\d\) that no phase explains: another phase, or magnetic order on neutron data — keep it/);
  });

  it("ends in a gap below counts that step up and stay at the last points", () => {
    // The last 0.6° (12 points) step up by 60 % of the background: a detector's edge.
    const r = inspectDataRange(pattern(LINES, 200, (v, y) => (v > 129.4 ? y + 120 : y)));
    expect(r.high.verdict).toBe("trim");
    expect(r.high.findings[0]!.cause).toBe("step");
    expect(r.high.findings[0]!.detail).toMatch(/^the counts step up to 3\d\d from (19|20)\d just inside and stay there, flat, to the last point/);
    // In a gap: below the step and clear of the last line at 127.5° by more than a line width.
    expect(r.high.cut!).toBeLessThanOrEqual(129.4);
    expect(Math.abs(r.high.cut! - 127.5)).toBeGreaterThan(0.3);
  });

  it("takes neither a line's tail at the end nor a smooth rise for a step", () => {
    // A line whose top sits just inside the last point: it rises and falls.
    const tail = inspectDataRange(pattern([...LINES, { at: 129.6, height: 600 }]));
    expect(tail.high.findings.map((f) => f.cause)).not.toContain("step");
    // The background climbing smoothly over the last 20°.
    const rise = inspectDataRange(pattern(LINES, 200, (v, y) => y + (v > 110 ? 6 * (v - 110) : 0)));
    expect(rise.high.verdict).toBe("keep");
  });

  it("cuts points with no counts, and a data end that slices a line", () => {
    const dead = inspectDataRange(pattern(LINES, 200, (v, y) => (v < 10.5 ? 0 : y)));
    expect(dead.low.findings.map((f) => f.cause)).toContain("no-counts");
    const sliced = inspectDataRange(pattern([...LINES, { at: 130.02, height: 700 }]));
    expect(sliced.high.findings.map((f) => f.cause)).toContain("line-at-edge");
    expect(sliced.high.cut!).toBeLessThan(129.5);
  });

  it("ends where the lines have faded into the noise at the short-d end", () => {
    // Above 110° the lines are far below the noise.
    const faded = LINES.map((l) => (l.at > 110 ? { ...l, height: 2 } : l));
    const r = inspectDataRange(pattern(faded));
    expect(r.high.verdict).toBe("trim");
    expect(r.high.findings.map((f) => f.cause)).toEqual(["faded-peaks"]);
    expect(r.high.cut!).toBeGreaterThan(109);
    expect(r.high.cut!).toBeLessThan(128);
  });

  it("reads a converged fit's residual at an end, and says when the window already stops short", () => {
    // The data climb above the model over the last 1.5°; the model has the background flat.
    const input = { ...pattern(LINES, 200, (v, y) => (v > 128.5 ? y + 40 * (v - 128.5) : y)), fitted: true };
    const r = inspectDataRange(input);
    expect(r.basis).toBe("the data and the fit's residual");
    expect(r.high.findings.map((f) => f.cause)).toContain("residual");
    expect(r.high.findings.find((f) => f.cause === "residual")!.detail).toMatch(/^the fit leaves the data above the model by \d+\.\dσ on average, more than any stretch of that length just inside/);
    const inside = inspectDataRange({ ...input, window: { min: 18, max: 125 } });
    expect(inside.high).toMatchObject({ verdict: "keep", alreadyOutside: true });
  });
});

/** PbSO₄ on D1A (GSAS-II's tutorial data): the edge the user saw in the demo. */
const PBSO4 = `data_pbso4
_cell_length_a 8.480
_cell_length_b 5.398
_cell_length_c 6.958
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M "P n m a"
loop_
_symmetry_equiv_pos_as_xyz
x,y,z
1/2-x,1/2+y,1/2+z
x,1/2-y,z
1/2-x,-y,1/2+z
-x,-y,-z
1/2+x,1/2-y,1/2-z
-x,1/2+y,-z
1/2+x,y,1/2-z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_U_iso_or_equiv
Pb Pb 0.1879 0.25 0.1671 1 0.018
S S 0.0654 0.25 0.6838 1 0.009
O1 O 0.9082 0.25 0.5954 1 0.026
O2 O 0.1937 0.25 0.5433 1 0.021
O3 O 0.0810 0.0272 0.8086 1 0.017
`;

const REAL = { data: "GSAS-II-tutorials/PBSO4.CWN", instrument: "GSAS-II-tutorials/inst_d1a.prm" };

describe.skipIf(!dataExists(REAL.data) || !dataExists(REAL.instrument))("the data's ends on PbSO₄ (D1A)", () => {
  it("starts just below the first reflection and ends in the gap below the last 0.8°, as the GSAS-II tutorial does", () => {
    const structure = parse_structure({ cif: PBSO4 }).structure;
    const instrument = parse_instrument({ text: readFileSync(dataPath(REAL.instrument), "utf8") });
    const pattern = parse_powder_data({ text: readFileSync(dataPath(REAL.data), "utf8"), filename: "PBSO4.CWN", instrument }).pattern;
    const first = check_fit_range({ structure, pattern, instrument });
    expect(first.basis).toBe("the data");
    expect(first.low.findings.map((f) => f.cause)).toEqual(["background-only"]);
    expect(first.low.cut!).toBeCloseTo(18.8, 0);
    // One detector counts the last 6°.
    expect(first.high.notes.join(" ")).toMatch(/147\.20–155\.90 is counted with 3\.2× the middle's relative σ/);
    expect(first.high.verdict).toBe("trim");
    expect(first.high.cut!).toBeGreaterThan(153);
    expect(first.high.cut!).toBeLessThan(155);

    // After the scale, background, cell and zero are refined, the residual shows the edge too.
    const spec = buildPowderSpec(structure, pattern, instrument, true, 8, {}, "isotropic", { asymmetry: true });
    const base = new Set(["scale", "background", "cellLength", "zeroShift"]);
    const result = runPowderRefinement({ type: "refinePowder", requestId: 0, structure, pattern, parameters: spec.params.map((p) => ({ ...p, fixed: !base.has(p.kind) })), bindings: spec.bindings, shape: spec.profile.shape, ...(spec.profile.backgroundType ? { backgroundType: spec.profile.backgroundType } : {}), options: { maxIterations: 30 } });
    const parameters = spec.params.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value }));
    const fitted = check_fit_range({ structure, pattern, instrument, parameters, bindings: spec.bindings, profile: spec.profile, result });
    expect(fitted.basis).toBe("the data and the fit's residual");
    const residual = fitted.high.findings.find((f) => f.cause === "residual");
    expect(residual?.detail).toMatch(/^the fit leaves the data above the model by [3-6]\.\dσ on average/);
    expect(Math.abs(fitted.proposed!.max - first.proposed!.max)).toBeLessThan(0.3);
    expect(fitted.proposedD![1]).toBeCloseTo(0.98, 1);
  }, 120_000);
});

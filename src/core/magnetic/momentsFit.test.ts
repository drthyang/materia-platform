import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ALTERNATION_MAX_ROUNDS, ALTERNATION_SHIFT_TOLERANCE, K0_SCALE_WITH_MOMENTS, reRefinedRows, runMomentsFit, type MomentsFitRunner } from "@/core/magnetic/momentsFit";
import type { ParameterKind, RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";

/**
 * The moments fit's rule, as the module decides it: which rows each step
 * refines, the options each refinement gets, and that a caller's flags on the
 * nuclear rows count for nothing. The runner here is a recorder, not a
 * refinement: the numbers of the fit are pinned on a known truth in
 * app/momentSequenceBias.test.ts.
 */

const row = (id: string, kind: ParameterKind, value: number, more: Partial<RefinementParameter> = {}): RefinementParameter =>
  ({ id, label: id, kind, value, initialValue: value, fixed: false, ...more });

/** A two-phase page's rows as a user left them (the scale free, the second phase's held, a background term tied), and a model's rows. */
const ROWS: RefinementParameter[] = [
  row("scale", "scale", 1),
  row("scale_p2", "scale", 0.3, { fixed: true }),
  row("bkg0", "background", 10),
  row("bkg1", "background", 2, { fixed: true }),
  row("bkg2", "background", 2, { expression: "bkg1" }),
  row("width", "peakWidth", 0.4),
  row("cell_a", "cellLength", 5),
  row("x_Mn", "positionShift", 0),
  row("mom_a", "momentMode", 2),
  row("mom_b", "momentMode", 1),
  row("mom_gauge", "momentMode", 0, { fixed: true }),
  row("mom_tied", "momentMode", 2, { expression: "mom_a" }),
];
const K_HALF = { propagation: [[0.5, 0, 0]] as [number, number, number][] };
const K_ZERO = { propagation: [[0, 0, 0]] as [number, number, number][] };

interface Step { readonly free: string[]; readonly options: Partial<RefinementOptions> }

/** A runner that refines nothing: it records what it was asked, and answers with the values it was given (so the fit settles in its first round). */
function recorder(move: (step: number, free: readonly string[]) => Record<string, number> = () => ({})): { fit: MomentsFitRunner; steps: Step[] } {
  const steps: Step[] = [];
  const fit: MomentsFitRunner = (rows, options) => {
    const free = rows.filter((p) => !p.fixed).map((p) => p.id);
    steps.push({ free, options });
    const parameters = { ...Object.fromEntries(rows.map((p) => [p.id, p.value])), ...move(steps.length, free) };
    const result: RefinementResult = {
      status: "converged", parameters, esd: Object.fromEntries(free.map((id) => [id, 0.01])),
      agreement: { rFactor: 0.04, rWeighted: 0.05 }, history: [],
      ...(options.esdWith ? { diagnostics: { svdZeroCount: 0, highCorrelations: [], esdIncludes: [...options.esdWith] } as unknown as NonNullable<RefinementResult["diagnostics"]> } : {}),
    };
    return result;
  };
  return { fit, steps };
}

describe("the moments fit: the rows each step refines are the module's, not the caller's", () => {
  it("re-refines every untied scale (each phase's own) and background row, held on the page or not; never the peak shape, the cell or an atom", () => {
    expect(reRefinedRows(ROWS)).toEqual({ scale: 1, scale_p2: 0.3, bkg0: 10, bkg1: 2 });
  });

  it("a moments step frees the free moment rows and nothing else; the step between frees the scale and the background; it ends on the moments", async () => {
    const { fit, steps } = recorder();
    const out = await runMomentsFit({ rows: ROWS, magnetic: K_HALF, fit });
    if (out.cancelled) throw new Error("not cancelled");
    expect(steps.map((s) => s.free)).toEqual([
      ["mom_a", "mom_b"],
      ["scale", "scale_p2", "bkg0", "bkg1"],
      ["mom_a", "mom_b"],
    ]);
    // The width, the cell and the atom were free on the page: no step refined them. The gauge the caller held stayed held, the tied rows follow their ties.
    for (const s of steps) expect(s.free.some((id) => ["width", "cell_a", "x_Mn", "mom_gauge", "mom_tied", "bkg2"].includes(id))).toBe(false);
    expect(out.rounds).toBe(1);
    expect(out.settled).toBe(true);
    expect(Object.keys(out.reRefined)).toEqual(["scale", "scale_p2", "bkg0", "bkg1"]);
  });

  it("the options are the fit's own: 20 iterations in every step, and esds with the re-refined rows on the moments steps only", async () => {
    const { fit, steps } = recorder();
    const out = await runMomentsFit({ rows: ROWS, magnetic: K_HALF, fit });
    if (out.cancelled) throw new Error("not cancelled");
    expect(steps.map((s) => s.options)).toEqual([
      { maxIterations: 20, esdWith: ["scale", "scale_p2", "bkg0", "bkg1"] },
      { maxIterations: 20 },
      { maxIterations: 20, esdWith: ["scale", "scale_p2", "bkg0", "bkg1"] },
    ]);
    expect(out.esd).toEqual({ mom_a: 0.01, mom_b: 0.01 });
    expect(out.esdIncludes).toEqual(["scale", "scale_p2", "bkg0", "bkg1"]);
    expect(out.esdAloneReason).toBeNull();
    expect(out.agreement).toBe(0.05);
  });

  it("at k = 0 the scale is held in the moments step, as at any k (the one switch)", async () => {
    expect(K0_SCALE_WITH_MOMENTS).toBe(false);
    const { fit, steps } = recorder();
    await runMomentsFit({ rows: ROWS, magnetic: K_ZERO, fit });
    expect(steps[0]!.free).toEqual(["mom_a", "mom_b"]);
    expect(steps[1]!.free).toEqual(["scale", "scale_p2", "bkg0", "bkg1"]);
  });

  it("a free k component among the caller's rows refines with the moments (the page's rows carry none)", async () => {
    const { fit, steps } = recorder();
    await runMomentsFit({ rows: [...ROWS, row("k1", "propagationK", 0.31), row("k2", "propagationK", 0.31, { expression: "k1" })], magnetic: { propagation: [[0.31, 0.31, 0]] }, fit });
    expect(steps[0]!.free).toEqual(["mom_a", "mom_b", "k1"]);
    expect(steps[1]!.free).toEqual(["scale", "scale_p2", "bkg0", "bkg1"]);
  });

  it("the rounds go on while a moment moves by more than the tolerance of its esd, to the cap at the most", async () => {
    // Every moments step moves mom_a by one esd: never settled.
    const { fit, steps } = recorder((step, free) => (free.includes("mom_a") ? { mom_a: 2 + 0.01 * step } : {}));
    const seen: [number, number][] = [];
    const out = await runMomentsFit({ rows: ROWS, magnetic: K_HALF, fit }, { onRound: (round, max) => seen.push([round, max]) });
    if (out.cancelled) throw new Error("not cancelled");
    expect(out.rounds).toBe(ALTERNATION_MAX_ROUNDS);
    expect(out.settled).toBe(false);
    expect(out.lastShiftOverEsd).toBeGreaterThan(ALTERNATION_SHIFT_TOLERANCE);
    expect(steps).toHaveLength(1 + 2 * ALTERNATION_MAX_ROUNDS);
    expect(steps.at(-1)!.free).toEqual(["mom_a", "mom_b"]);
    expect(seen).toEqual(Array.from({ length: ALTERNATION_MAX_ROUNDS }, (_, i) => [i + 1, ALTERNATION_MAX_ROUNDS]));
  });

  it("nothing to re-refine: one moments step, no round, the esds the moments' own", async () => {
    const { fit, steps } = recorder();
    const out = await runMomentsFit({ rows: ROWS.filter((p) => p.kind !== "scale" && p.kind !== "background"), magnetic: K_HALF, fit });
    if (out.cancelled) throw new Error("not cancelled");
    expect(steps).toEqual([{ free: ["mom_a", "mom_b"], options: { maxIterations: 20 } }]);
    expect(out.rounds).toBe(0);
    expect(out.settled).toBe(true);
    expect(out.esdIncludes).toEqual([]);
    expect(out.reRefined).toEqual({});
  });

  it("stopped: nothing of the fit is handed back", async () => {
    const { fit, steps } = recorder();
    const out = await runMomentsFit({ rows: ROWS, magnetic: K_HALF, fit }, { cancelled: () => steps.length >= 2 });
    expect(out).toEqual({ cancelled: true });
  });
});

describe("the loop under the moments fit is the module's alone", () => {
  it("no application file but momentsFit.ts imports momentAlternation.ts (tests may: they ask of the loop what the fit does not take)", () => {
    const src = resolve(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, e.name);
        if (e.isDirectory()) walk(at);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(at);
      }
    };
    walk(src);
    expect(files.length).toBeGreaterThan(100);
    const importing = files.filter((f) => /from\s+["'][^"']*momentAlternation["']|import\(\s*["'][^"']*momentAlternation["']/.test(readFileSync(f, "utf8"))).map((f) => relative(src, f));
    expect(importing).toEqual(["core/magnetic/momentsFit.ts"]);
  });
});

import { describe, it, expect } from "vitest";
import { exampleStructure } from "@/examples/highEntropyWO4";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { pdfPage, pageView } from "@/app/pdfPage";
import { buildPdfProblem, joinBlocks, pairReachBound, type PdfRefinementProblem, type PdfShard } from "@/core/workflow/pdf";
import { refine, refineParallel, type BatchEvaluator } from "@/core/refinement/engine";
import type { RefinementParameter } from "@/core/refinement/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { applyParameters } from "@/core/workflow/apply";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { enumeratePairs } from "@/core/pdf/pairEnumerator";
import { makeRGrid, PAIR_REACH_MARGIN } from "@/core/pdf/forwardModel";

/**
 * One PDF evaluation split by model-grid block (the browser pool's split
 * mode): each shard holds only the pairs its block can see, and the joined,
 * finished blocks are the unsplit calculation bit for bit — every grid point
 * receives the same terms in the same order. A margin that missed a pair
 * would change a point by at least a Gaussian tail, which `Object.is` sees.
 */

function expectBitIdentical(got: ArrayLike<number>, ref: ArrayLike<number>, what: string): void {
  expect(got.length, what).toBe(ref.length);
  for (let k = 0; k < ref.length; k++) {
    if (!Object.is(got[k], ref[k])) throw new Error(`${what}: index ${k}: ${got[k]} vs ${ref[k]}`);
  }
}

interface Case {
  readonly name: string;
  readonly build: (params: readonly RefinementParameter[], shard?: PdfShard) => PdfRefinementProblem;
  readonly params: RefinementParameter[];
  /** Value sets to evaluate in turn (the later ones widen the peaks: a shard must widen its margin). */
  readonly sets: Record<string, number>[];
  readonly free: (p: RefinementParameter) => boolean;
  /** The model the problem evaluates at `values`. */
  readonly applied: (values: Record<string, number>) => ReturnType<typeof applyParameters>;
}

/** An in-process split evaluator over `count` shards, joined and finished as the browser pool does. */
function splitEvaluator(c: Case, params: readonly RefinementParameter[], count: number): BatchEvaluator {
  const driver = c.build(params);
  const shards = Array.from({ length: count }, (_, index) => c.build(params, { index, count }));
  return {
    splitsEvaluations: true,
    evaluate: (sets) => Promise.resolve(sets.map((v) => driver.split.finish(v, joinBlocks(driver.split, shards.map((s) => s.split.evaluateBlock(v)))))),
    analyticColumns: (fp, fv) => {
      const blocks = shards.map((s) => s.split.analyticBlock(fp, fv));
      return Promise.resolve(driver.split.finishColumns(fp, blocks[0]!.map((first, j) => (first ? joinBlocks(driver.split, blocks.map((b) => b[j]!)) : null))));
    },
  };
}

function gataCase(): Case {
  const ex = gata4se8PdfExample();
  // A shorter window than the demo's keeps the 1–6-shard sweep quick; the blocks and margins are the same code at any range.
  const fitRange = { min: 1.5, max: 11 };
  const page = pdfPage(ex.structure, ex.pattern, { preset: { values: ex.refinedParams, fitRange } });
  const v = pageView(page);
  const base = Object.fromEntries(page.params.map((p) => [p.id, p.value]));
  return {
    name: "GaTa₄Se₈ (X-ray, anisotropic, δ1/δ2, Qdamp/Qbroad)",
    build: (params, shard) => buildPdfProblem(v.fitStructure, ex.pattern, params, v.bindings, v.spec.restraints, fitRange, shard),
    params: page.params.map((p) => ({ ...p })),
    sets: [
      base,
      { ...base, cell_a: base.cell_a! * 1.0004, pos_Ta1_0: 0.003, pos_Se1_0: -0.002, U_Ta1_1: 0.004 },
      // Much wider peaks at long r, sharper ones below rcut, a finite particle: every shard's margin must grow.
      { ...base, qbroad: 0.09, delta1: -0.4, delta2: 2.5, sratio: 0.7, rcut: 3.4, spdiameter: 45, qdamp: 0.06 },
    ],
    applied: (values) => applyParameters(v.fitStructure, v.bindings, values),
    free: (p) => ["pdfScale", "cell_a", "qdamp", "qbroad", "delta1", "delta2", "spdiameter", "pos_Ta1_0", "pos_Se1_0", "pos_Se2_0", "occ_Ta1", "occ_Se2"].includes(p.id) || p.id.startsWith("U_"),
  };
}

function mixedSiteCase(): Case {
  // The bundled multi-element-site model on a synthetic neutron grid (Qmax 30, Δr 0.01: termination on).
  const st = exampleStructure();
  const pattern: PdfPattern = { id: "he", name: "he", scatteringType: "neutron", qmax: 30, points: Array.from(makeRGrid(0.01, 17, 0.01), (r) => ({ r, gObs: Math.sin(r) / r })) };
  const fitRange = { min: 1.5, max: 15 };
  const page = pdfPage(st, pattern, { preset: { fitRange } });
  const v = pageView(page);
  const base = Object.fromEntries(page.params.map((p) => [p.id, p.value]));
  const pos = page.params.filter((p) => p.kind === "positionShift").map((p) => p.id);
  const bs = page.params.filter((p) => p.kind === "bIso").map((p) => p.id);
  const occ = page.params.filter((p) => p.kind === "occupancy").map((p) => p.id);
  return {
    name: "a multi-element site (groups, neutron, an occupancy restraint)",
    build: (params, shard) => buildPdfProblem(v.fitStructure, pattern, params, v.bindings, v.spec.restraints, fitRange, shard),
    params: page.params.map((p) => ({ ...p })),
    sets: [
      base,
      { ...base, ...Object.fromEntries(pos.map((id, i) => [id, 0.002 * (i % 3 - 1)])), ...Object.fromEntries(bs.map((id) => [id, base[id]! * 1.3])) },
      { ...base, qbroad: 0.07, delta2: 3, ...Object.fromEntries(bs.map((id) => [id, base[id]! * 2.5])) },
    ],
    applied: (values) => applyParameters(v.fitStructure, v.bindings, values),
    free: (p) => p.kind === "pdfScale" || p.kind === "cellLength" || p.kind === "cellAngle" || pos.includes(p.id) || bs.includes(p.id) || occ.slice(0, 3).includes(p.id) || p.kind === "delta2",
  };
}

describe("a PDF evaluation split by grid block", () => {
  for (const make of [gataCase, mixedSiteCase]) {
    const c = make();
    it(`joins to calculate and to the analytic columns bit for bit, on 1–6 shards: ${c.name}`, async () => {
      const whole = c.build(c.params);
      const free = c.params.filter(c.free);
      expect(free.length).toBeGreaterThan(5);
      for (let count = 1; count <= 6; count++) {
        const ev = splitEvaluator(c, c.params, count);
        for (const [s, values] of c.sets.entries()) {
          const [got] = await ev.evaluate([values]);
          expectBitIdentical(got!, whole.calculate(values), `${count} shards, set ${s}, G`);
          const freeValues = free.map((p) => values[p.id]!);
          const ref = whole.analyticColumns!(free, freeValues);
          const cols = await ev.analyticColumns!(free, freeValues);
          expect(cols.map((col) => col === null)).toEqual(ref.map((col) => col === null));
          expect(ref.filter((col) => col !== null).length).toBeGreaterThan(4);
          ref.forEach((col, j) => col && expectBitIdentical(cols[j]!, col, `${count} shards, set ${s}, ∂/∂${free[j]!.id}`));
        }
      }
    });
  }

  it("cuts the grid into contiguous blocks balanced by r³, and a shard holds a share of the pairs", () => {
    const c = mixedSiteCase();
    const whole = c.build(c.params);
    for (let count = 1; count <= 6; count++) {
      let k = 0;
      for (let w = 0; w < count; w++) {
        const b = whole.split.blockOf(w, count);
        expect(b.k0).toBe(k);
        expect(b.k1).toBeGreaterThan(b.k0);
        k = b.k1;
      }
      expect(k).toBe(whole.split.gridLength);
    }
  });

  it("refineParallel over the split evaluator is the serial refinement bit for bit", async () => {
    const c = gataCase();
    const start = c.params.map((p) => (c.free(p) && p.id !== "spdiameter" ? { ...p, fixed: false, value: p.id === "cell_a" ? p.value * 1.002 : p.id.startsWith("U_") ? p.value * 1.1 : p.id.startsWith("pos") ? 0.002 : p.value * 1.03 } : { ...p, fixed: true }));
    const opts = { maxIterations: 2, analyticDerivatives: true } as const;
    const serial = refine(c.build(start), opts);
    // The driver's own problem never evaluates: single evaluations and the analytic columns go to the split evaluator.
    const driver = { ...c.build(start), calculate: (): Float64Array => { throw new Error("the driver evaluated"); }, analyticColumns: (): (Float64Array | null)[] => { throw new Error("the driver took the columns"); } };
    const pooled = await refineParallel(driver, opts, splitEvaluator(c, start, 3), { analyticOnDriver: true });
    expect(pooled.status).toBe(serial.status);
    expect(pooled.history.map((h) => h.chiSquared)).toEqual(serial.history.map((h) => h.chiSquared));
    for (const id of Object.keys(serial.parameters)) expect(Object.is(pooled.parameters[id], serial.parameters[id]), id).toBe(true);
    for (const id of Object.keys(serial.esd)) expect(Object.is(pooled.esd[id], serial.esd[id]), id).toBe(true);
    expect(Object.is(pooled.agreement.rWeighted, serial.agreement.rWeighted)).toBe(true);
  });

  it("bounds every pair's reach beyond the short pairs, at the widest set", () => {
    for (const c of [gataCase(), mixedSiteCase()]) {
      const applied = c.applied(c.sets[2]!);
      const params = { scatteringType: "xray" as const, ...applied.pdf! };
      const atoms = expandStructureAtoms(applied.model);
      const cell = applied.model.cell;
      const rTop = 18 + PAIR_REACH_MARGIN;
      const bound = pairReachBound(cell, atoms, params, rTop, 0.01);
      let worst = 0;
      for (const p of enumeratePairs(cell, atoms, rTop)) {
        if (p.rij < 4) continue;
        let sig2 = p.msd * (1 - params.delta1 / p.rij - params.delta2 / (p.rij * p.rij) + params.qbroad * params.qbroad * p.rij * p.rij);
        if (!(sig2 > 0)) sig2 = p.msd > 0 ? p.msd : 1e-8;
        let sigma = Math.sqrt(sig2);
        if ((params.rcut ?? 0) > 0 && p.rij < params.rcut!) sigma *= params.sratio ?? 1;
        worst = Math.max(worst, 5 * Math.max(sigma, 1e-4));
      }
      expect(worst).toBeGreaterThan(0.2);
      expect(worst + 0.02).toBeLessThanOrEqual(bound);
    }
  });
});

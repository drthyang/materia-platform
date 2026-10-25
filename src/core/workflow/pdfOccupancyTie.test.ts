import { beforeAll, describe, it, expect } from "vitest";
import { exampleStructure } from "@/examples/highEntropyWO4";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { cscl, maxAbs, simulateSharedSite as simulate, valuesOf } from "@/testSupport/sharedSite";
import {
  buildMultiDatasetPdfProblem, buildMultiDatasetPdfSpec, buildMultiPhasePdfSpec, buildPdfProblem, buildPdfSpec, PDF_STAGE_KINDS,
} from "@/core/workflow/pdf";
import { applyParameters } from "@/core/workflow/apply";
import { siteSumConstraints, siteSumRangeWarnings, stagesFromKindGroups } from "@/core/workflow/structureRefinement";
import { esdsWithTies, remainderOf, resolveTies } from "@/core/refinement/constraints";
import { refine, type RefinementProblem } from "@/core/refinement/engine";
import { refineStaged } from "@/core/refinement/staged";
import { samplePosterior } from "@/core/refinement/bayes/sampler";
import { pseudoInverseSymmetric } from "@/core/math/linalg";
import { pdfPage, pageView, withSiteTotal, workspaceOf } from "@/app/pdfPage";

/**
 * A shared site's occupancies sum to exactly 1 on the PDF page: the last
 * member follows one minus the others (two members: the complement tie,
 * SHELXL's 21/−21), so n − 1 refine. Synthetic (A)O in the CsCl type with
 * invented occupancies is the known truth; the eliminated occupancy's esd is
 * checked against the covariance propagated by hand, a second
 * parametrisation and the posterior.
 */

const FIT = { min: 1.5, max: 12 };
const SIX = ["Co1", "Fe1", "Ni1", "Mn1", "Cu1", "Zn1"] as const;

const sumOver = (values: Readonly<Record<string, number>>, labels: readonly string[]): number => labels.reduce((acc, l) => acc + values[`occ_${l}`]!, 0);

describe("a shared site's total below 1 (vacancies) on the PDF page", () => {
  it("is honoured: the tie's constant, Σ at every evaluation, the page's rows, the saved project and an old one", () => {
    const truth = cscl({ Co1: 0.1, Fe1: 0.15, Ni1: 0.2, Mn1: 0.25, Cu1: 0.12, Zn1: 0.13 });
    const pattern = simulate(truth, "neutron", 0.01, 13, FIT, { Co1: 0.95 });
    const loaded = cscl(Object.fromEntries(SIX.map((l) => [l, 0.19])));
    const two = buildPdfSpec(cscl({ Fe1: 0.5, Mn1: 0.4 }), pattern, { totals: { Fe1: 0.95 } });
    expect(two.params.find((p) => p.id === "occ_Mn1")!.expression).toBe("= -1*occ_Fe1+0.95");
    expect(two.params.find((p) => p.id === "occ_Mn1")!.value).toBeCloseTo(0.45, 15);
    // On the page: the total set, the rows keep their values, the last follows the new total.
    const page0 = pdfPage(loaded, pattern, { preset: { fitRange: FIT } });
    const page = withSiteTotal(page0, "Co1", 0.95);
    const zn = page.params.find((p) => p.id === "occ_Zn1")!;
    expect(zn.expression).toBe("= 0.95 - sum(occ_Co1, occ_Fe1, occ_Ni1, occ_Mn1, occ_Cu1)");
    expect(zn.value).toBe(0.95 - [0.19, 0.19, 0.19, 0.19, 0.19].reduce((a, b) => a + b, 0));
    expect(page.params.find((p) => p.id === "occ_Co1")!.value).toBe(0.19);
    expect(withSiteTotal(page, "Co1", 1).siteTotals).toEqual({});
    const params = page.params.map((p) => ({ ...p, fixed: !!p.expression || !(p.kind === "pdfScale" || (p.kind === "occupancy" && p.id !== "occ_O1")) }));
    const v = pageView(page);
    let worst = 0;
    const problem = buildPdfProblem(v.fitStructure, pattern, params, [...v.bindings], v.spec.restraints, FIT);
    const res = refine({ ...problem, calculate: (values, o) => {
      const site = applyParameters(v.fitStructure, [...v.bindings], resolveTies(params, values)).model.sites.filter((x) => x.label !== "O1");
      worst = Math.max(worst, Math.abs(site.reduce((acc, x) => acc + x.occupancy, 0) - 0.95));
      return problem.calculate(values, o);
    } }, { maxIterations: 8 });
    expect(worst).toBeLessThan(1e-12);
    expect(Math.abs(sumOver(res.parameters, SIX) - 0.95)).toBeLessThan(1e-12);
    // Saved with the project, read back; a project saved before totals existed reads every site full.
    const ws = workspaceOf(page);
    expect(ws.siteTotals).toEqual({ Co1: 0.95 });
    expect(pdfPage(loaded, pattern, { restore: ws }).params.find((p) => p.id === "occ_Zn1")!.expression).toBe(zn.expression);
    const { siteTotals: _t, ...older } = ws;
    expect(pdfPage(loaded, pattern, { restore: older }).params.find((p) => p.id === "occ_Zn1")!.expression).toBe("= 1 - sum(occ_Co1, occ_Fe1, occ_Ni1, occ_Mn1, occ_Cu1)");
  });
});

describe("a shared site's last occupancy outside [0, 1]", () => {
  it("is warned of, never clamped, after a refinement that takes it there; no warning in range", () => {
    // Three species, the truth's last at 1 − 0.7 − 0.6 = −0.3: the fit follows the data there.
    const pattern = simulate(cscl({ Fe1: 0.7, Ni1: 0.6, Mn1: -0.3 }), "neutron", 0.002, 17);
    const loaded = cscl({ Fe1: 0.4, Ni1: 0.3, Mn1: 0.3 });
    const page = pdfPage(loaded, pattern, { preset: { fitRange: FIT } });
    expect(siteSumRangeWarnings(page.params)).toEqual([]);
    const v = pageView(page);
    const params = page.params.map((p) => ({ ...p, fixed: !["pdfScale", "occ_Fe1", "occ_Ni1"].includes(p.id) }));
    const res = refine(buildPdfProblem(v.fitStructure, pattern, params, [...v.bindings], v.spec.restraints, FIT), { maxIterations: 30 });
    const after = params.map((p) => ({ ...p, value: res.parameters[p.id] ?? p.value }));
    expect(res.parameters.occ_Mn1).toBeLessThan(-0.1);
    expect(res.parameters.occ_Mn1).toBe(1 - (res.parameters.occ_Fe1! + res.parameters.occ_Ni1!));
    const [w] = siteSumRangeWarnings(after);
    expect(w).toMatch(/^occ_Mn1 = -0\.\d{4} is outside \[0, 1\]: it follows 1 − \(occ_Fe1 \+ occ_Ni1\), and the others sum to more than the site's total 1\. The tie does not clamp it/);
    // Above 1: the others below 0 (set by hand; a free occupancy cannot go there).
    expect(siteSumRangeWarnings(after.map((p) => (p.id === "occ_Fe1" ? { ...p, value: -0.2 } : p.id === "occ_Ni1" ? { ...p, value: -0.1 } : p.id === "occ_Mn1" ? { ...p, value: 1.3 } : p)))[0]).toMatch(/occ_Mn1 = 1\.3000 is outside \[0, 1\].*the others sum to less than 0/);
    expect(siteSumRangeWarnings(after.map((p) => (p.id === "occ_Mn1" ? { ...p, value: 0 } : p)))).toEqual([]);
  });
});

describe("a shared site's occupancies on the PDF page", () => {
  it("are tied, not restrained: the last follows one minus the others (the complement for two), lone sites untied", () => {
    const blank = simulate(cscl({ Fe1: 0.5, Mn1: 0.5 }), "neutron", 0, 1);
    const he = buildPdfSpec(exampleStructure(), blank);
    const zn = he.params.find((p) => p.id === "occ_Zn1")!;
    expect(zn.expression).toBe("= 1 - sum(occ_Co1, occ_Fe1, occ_Ni1, occ_Mn1, occ_Cu8)");
    expect(zn.fixed).toBe(true);
    expect(zn.value).toBe(1 - [0.167, 0.167, 0.167, 0.167, 0.167].reduce((a, b) => a + b, 0));
    expect(zn.initialValue).toBe(zn.value);
    expect(he.restraints).toEqual([]);
    for (const id of ["occ_Co1", "occ_Cu8", "occ_W1", "occ_O1", "occ_O2"]) expect(he.params.find((p) => p.id === id)!.expression).toBeUndefined();
    const two = buildPdfSpec(cscl({ Fe1: 0.5, Mn1: 0.5 }), blank);
    expect(two.params.find((p) => p.id === "occ_Mn1")!.expression).toBe("= -1*occ_Fe1+1");
    expect(siteSumConstraints(he.params)).toEqual([{ follower: "occ_Zn1", leaders: ["occ_Co1", "occ_Fe1", "occ_Ni1", "occ_Mn1", "occ_Cu8"], total: 1 }]);
    // A multi-phase page's ties read the phase's own (prefixed) rows.
    const mp = buildMultiPhasePdfSpec([cscl({ Fe1: 0.5, Mn1: 0.5 }), exampleStructure()], blank);
    expect(mp.params.find((p) => p.id === "p0_occ_Mn1")!.expression).toBe("= -1*p0_occ_Fe1+1");
    expect(mp.params.find((p) => p.id === "p1_occ_Zn1")!.expression).toBe("= 1 - sum(p1_occ_Co1, p1_occ_Fe1, p1_occ_Ni1, p1_occ_Mn1, p1_occ_Cu8)");
  });

  it("leave a structure with no shared site as it was: no tie, no restraint", () => {
    const ex = gata4se8PdfExample();
    const spec = buildPdfSpec(ex.structure, ex.pattern);
    expect(spec.params.filter((p) => p.expression)).toEqual([]);
    expect(spec.restraints).toEqual([]);
  });

  it("sum to 1 to rounding at every evaluation of a fit, flat and staged, from occupancies loaded off (Σ 1.14)", () => {
    const pattern = simulate(cscl({ Co1: 0.1, Fe1: 0.15, Ni1: 0.2, Mn1: 0.25, Cu1: 0.12, Zn1: 0.18 }), "neutron", 0.01, 7);
    const loaded = cscl(Object.fromEntries(SIX.map((l) => [l, 0.19])));
    const spec = buildPdfSpec(loaded, pattern);
    const freeKinds = new Set(["pdfScale", "cellLength", "bIso"]);
    const params = spec.params.map((p) => ({ ...p, fixed: !!p.expression || !(freeKinds.has(p.kind) || (p.kind === "occupancy" && p.id !== "occ_O1")) }));
    expect(params.filter((p) => p.kind === "occupancy" && !p.fixed).map((p) => p.id)).toEqual(["occ_Co1", "occ_Fe1", "occ_Ni1", "occ_Mn1", "occ_Cu1"]);
    let worst = 0;
    let evaluations = 0;
    const watched = (ps: readonly RefinementParameter[]): RefinementProblem => {
      const problem = buildPdfProblem(loaded, pattern, ps, spec.bindings, spec.restraints, FIT);
      return {
        ...problem,
        calculate: (values, options) => {
          // What the forward model sees: the structure with the resolved values applied.
          const site = applyParameters(loaded, spec.bindings, resolveTies(ps, values)).model.sites.filter((s) => s.label !== "O1");
          worst = Math.max(worst, Math.abs(site.reduce((acc, s) => acc + s.occupancy, 0) - 1));
          evaluations++;
          return problem.calculate(values, options);
        },
      };
    };
    const flat = refine(watched(params), { maxIterations: 8 });
    const staged = refineStaged(params, watched, stagesFromKindGroups(PDF_STAGE_KINDS), { maxIterations: 8 });
    expect(evaluations).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-12);
    for (const r of [flat, staged.final!]) {
      expect(r.history.length).toBeGreaterThan(1);
      expect(Math.abs(sumOver(r.parameters, SIX) - 1)).toBeLessThan(1e-12);
    }
  });

  it("two species: the refined split agrees with the truth within its esd, and the follower carries the leader's esd", () => {
    const pattern = simulate(cscl({ Fe1: 0.62, Mn1: 0.38 }), "neutron", 0.01, 11);
    const loaded = cscl({ Fe1: 0.5, Mn1: 0.5 });
    const spec = buildPdfSpec(loaded, pattern);
    const params = spec.params.map((p) => ({ ...p, fixed: !["pdfScale", "cell_a", "B_Fe1", "occ_Fe1"].includes(p.id) }));
    const res = refine(buildPdfProblem(loaded, pattern, params, spec.bindings, spec.restraints, FIT), { maxIterations: 30 });
    const fe = res.parameters.occ_Fe1!;
    const sigma = res.esd.occ_Fe1!;
    expect(sigma).toBeGreaterThan(0);
    expect(Math.abs(fe - 0.62)).toBeLessThan(3 * sigma);
    expect(res.parameters.occ_Mn1).toBe(1 - fe);
    expect(esdsWithTies(params, res).occ_Mn1).toBe(sigma);
  });

  it("an occupancy's analytic column carries the occupancy that follows it, as finite differences see it", () => {
    const pattern = simulate(cscl({ Co1: 0.1, Fe1: 0.15, Ni1: 0.2, Mn1: 0.25, Cu1: 0.12, Zn1: 0.18 }), "neutron", 0, 1);
    for (const [loaded, ids] of [
      [cscl({ Co1: 0.1, Fe1: 0.15, Ni1: 0.2, Mn1: 0.25, Cu1: 0.12, Zn1: 0.18 }), ["occ_Mn1", "occ_Cu1"]],
      [cscl({ Fe1: 0.6, Mn1: 0.4 }), ["occ_Fe1"]],
    ] as const) {
      const spec = buildPdfSpec(loaded, pattern);
      const params = spec.params.map((p) => ({ ...p, fixed: !(ids as readonly string[]).includes(p.id) }));
      const problem = buildPdfProblem(loaded, pattern, params, spec.bindings, spec.restraints, FIT);
      const free = params.filter((p) => !p.fixed);
      const cols = problem.analyticColumns!(free, free.map((p) => p.value));
      free.forEach((p, j) => {
        const col = cols[j];
        expect(col, p.id).not.toBeNull();
        const h = 1e-5;
        const f = problem.calculate({ ...valuesOf(params), [p.id]: p.value + h });
        const b = problem.calculate({ ...valuesOf(params), [p.id]: p.value - h });
        const fd = f.map((y, i) => (y - b[i]!) / (2 * h));
        let worst = 0;
        for (let i = 0; i < fd.length; i++) worst = Math.max(worst, Math.abs(col![i]! - fd[i]!));
        expect(worst / maxAbs(fd), p.id).toBeLessThan(1e-6);
      });
    }
  });

  it("an old project's six free occupancies (the soft Σ) open tied: the last held at one minus the others, and it refines", () => {
    const st = exampleStructure();
    const pattern = simulate(cscl({ Fe1: 0.5, Mn1: 0.5 }), "neutron", 0, 1);
    const fitted = pdfPage(st, { ...pattern, id: "he", name: "he" }, { preset: { fitRange: FIT } });
    const saved = workspaceOf(fitted);
    const A = ["occ_Co1", "occ_Fe1", "occ_Ni1", "occ_Mn1", "occ_Cu8", "occ_Zn1"];
    // As main saved it: no tie on any row, every occupancy of the shared site free at 0.167 (Σ 1.002).
    const old = {
      ...saved,
      refinement: {
        ...saved.refinement,
        parameters: saved.refinement.parameters.map((p) => {
          const { expression: _e, ...rest } = p;
          return A.includes(p.id) ? { ...rest, value: 0.167, initialValue: 0.167, fixed: false } : rest;
        }),
      },
    };
    expect(old.refinement.parameters.some((p) => "expression" in p)).toBe(false);
    const reopened = pdfPage(st, saved.pattern, { restore: old });
    const zn = reopened.params.find((p) => p.id === "occ_Zn1")!;
    expect(zn.expression).toBe("= 1 - sum(occ_Co1, occ_Fe1, occ_Ni1, occ_Mn1, occ_Cu8)");
    expect(zn.fixed).toBe(true);
    expect(zn.value).toBeCloseTo(0.165, 12);
    expect(zn.initialValue).toBe(zn.value);
    expect(reopened.params.filter((p) => A.includes(p.id) && !p.fixed).map((p) => p.id)).toEqual(A.slice(0, 5));
    const v = pageView(reopened);
    const site = v.refinedPhases[0]!.sites.filter((s) => A.includes(`occ_${s.label}`));
    expect(Math.abs(site.reduce((acc, s) => acc + s.occupancy, 0) - 1)).toBeLessThan(1e-12);
    const res = refine(buildPdfProblem(v.fitStructure, reopened.pattern, reopened.params.map((p) => ({ ...p, fixed: p.fixed || !(p.kind === "pdfScale" || A.includes(p.id)) })), [...v.bindings], v.spec.restraints, FIT), { maxIterations: 5 });
    expect(res.history.length).toBeGreaterThan(0);
    expect(Math.abs(A.reduce((acc, id) => acc + res.parameters[id]!, 0) - 1)).toBeLessThan(1e-12);
  });
});

// Total 1, and 0.95 (5 % vacancies on the site): the esd is the same propagation, the constant aside.
describe.each([1, 0.95])("the eliminated occupancy's esd (six species, joint neutron + X-ray G(r), site total %s)", (total) => {
  // Neutron and X-ray contrasts tell two combinations of the six apart: Mn and Cu refine, Zn follows.
  // A short window (to 7 Å) keeps the posterior's thousands of evaluations cheap.
  const W = { min: 1.5, max: 7 };
  const truth = { Co1: 0.1, Fe1: 0.15, Ni1: 0.2, Mn1: 0.25, Cu1: 0.12, Zn1: total - 0.82 };
  const FREE = ["d0_pdfScale", "d1_pdfScale", "occ_Mn1", "occ_Cu1"];
  const totals = total === 1 ? undefined : { Co1: total };
  const loaded = cscl({ ...truth, Mn1: 0.2, Cu1: 0.2 });
  let problemFor: (ps: readonly RefinementParameter[]) => RefinementProblem;
  let res: RefinementResult;
  let at: RefinementParameter[];
  let zn: number | undefined;
  beforeAll(() => {
    const patterns = [simulate(cscl(truth), "neutron", 0.003, 3, W, totals), simulate(cscl(truth), "xray", 0.003, 5, W, totals)];
    const spec = buildMultiDatasetPdfSpec(loaded, patterns, totals ? { totals } : {});
    problemFor = (ps) => buildMultiDatasetPdfProblem(loaded, patterns, ps, spec.bindings, spec.restraints, [W, W]);
    const start = spec.params.map((p) => ({ ...p, fixed: !FREE.includes(p.id) }));
    res = refine(problemFor(start), { maxIterations: 40 });
    at = start.map((p) => ({ ...p, value: res.parameters[p.id] ?? p.value }));
    zn = res.combinationEsd?.occ_Zn1;
  });

  it("refines to the truth within the esds, Zn's from the covariance", () => {
    expect(res.status).toBe("converged");
    expect(zn).toBeGreaterThan(0);
    expect(esdsWithTies(at, res).occ_Zn1).toBe(zn);
    for (const [id, sigma] of [["occ_Mn1", res.esd.occ_Mn1!], ["occ_Cu1", res.esd.occ_Cu1!], ["occ_Zn1", zn!]] as const) {
      expect(Math.abs(res.parameters[id]! - truth[id.slice(4) as keyof typeof truth]), id).toBeLessThan(3 * sigma);
    }
    expect(Math.abs(sumOver(res.parameters, SIX) - total)).toBeLessThan(1e-12);
    expect(at.find((p) => p.id === "occ_Zn1")!.expression).toBe(remainderOf(["occ_Co1", "occ_Fe1", "occ_Ni1", "occ_Mn1", "occ_Cu1"], total));
  });

  it("matches the covariance propagated by hand: σ²(Zn) = Σ C over the free occupancies", () => {
    const problem = problemFor(at);
    const values = valuesOf(at);
    const y0 = problem.calculate(values);
    const cols = FREE.map((id) => {
      const h = 1e-6 * Math.max(1, Math.abs(values[id]!));
      const f = problem.calculate({ ...values, [id]: values[id]! + h });
      const b = problem.calculate({ ...values, [id]: values[id]! - h });
      return f.map((v, i) => (v - b[i]!) / (2 * h));
    });
    const w = problem.weights;
    let chi2 = 0;
    let used = 0;
    for (let i = 0; i < y0.length; i++) {
      chi2 += w[i]! * (problem.observations[i]! - y0[i]!) ** 2;
      if (w[i]! > 0) used++;
    }
    const normal = cols.map((a) => cols.map((b) => a.reduce((acc, v, i) => acc + w[i]! * v * b[i]!, 0)));
    const inv = pseudoInverseSymmetric(normal, 1e-12).inverse;
    const [jMn, jCu] = [FREE.indexOf("occ_Mn1"), FREE.indexOf("occ_Cu1")];
    const variance = (inv[jMn]![jMn]! + inv[jCu]![jCu]! + 2 * inv[jMn]![jCu]!) * (chi2 / (used - FREE.length));
    expect(Math.abs(Math.sqrt(variance) / zn! - 1)).toBeLessThan(1e-3);
  });

  it("equals Zn's own esd when Zn refines and Mn follows instead", () => {
    const swapped = at.map((p) => {
      if (p.id === "occ_Zn1") {
        const { expression: _e, ...rest } = p;
        return { ...rest, fixed: false };
      }
      return p.id === "occ_Mn1" ? { ...p, fixed: true, expression: remainderOf(["occ_Co1", "occ_Fe1", "occ_Ni1", "occ_Cu1", "occ_Zn1"], total) } : p;
    });
    const other = refine(problemFor(swapped), { maxIterations: 40 });
    expect(Math.abs(other.esd.occ_Zn1! / zn! - 1)).toBeLessThan(2e-3);
    expect(Math.abs(other.combinationEsd!.occ_Mn1! / res.esd.occ_Mn1! - 1)).toBeLessThan(2e-3);
    expect(Math.abs(other.parameters.occ_Zn1! - res.parameters.occ_Zn1!)).toBeLessThan(0.01 * zn!);
  });

  it.runIf(total === 1)("agrees with the posterior's spread of 1 − Σ the sampled others", { timeout: 120_000 }, () => {
    const run = samplePosterior(problemFor(at), { nSteps: 400, nWalkers: 10, seed: 0x0cc, linearizedEsd: res.esd });
    const jMn = run.freeIds.indexOf("occ_Mn1");
    const jCu = run.freeIds.indexOf("occ_Cu1");
    const fixedPart = truth.Co1 + truth.Fe1 + truth.Ni1;
    const samples = run.chains.flatMap((chain) => chain.map((x) => total - (fixedPart + x[jMn]! + x[jCu]!)));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length - 1));
    const ratio = sd / zn!;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });
});


import { describe, it, expect } from "vitest";
import { exampleStructure } from "@/examples/highEntropyWO4";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { expandStructureAtoms, expandStructureAtomsWithProvenance } from "@/core/diffraction/structureFactor";
import { colocatedGroups, enumeratePairs } from "@/core/pdf/pairEnumerator";
import { computeGofR, makeRGrid, type PdfModelParams } from "@/core/pdf/forwardModel";
import { computeGofRWithColumns, DUISO_DBISO, requestsUniformOver, type PdfColumnRequest } from "@/core/pdf/gradients";
import { pdfPage, pageView } from "@/app/pdfPage";
import { buildProblemForSpec } from "@/workers/runPowder";
import type { PdfPattern } from "@/core/diffraction/types";

/**
 * A mixed site's species (same position, same ADP) pair through one
 * representative carrying their summed weight. The pair term is bilinear in
 * the weights, so the sum is the per-atom one up to rounding: on the
 * high-entropy (Co,Cu,Fe,Mn,Ni,Zn)WO₄ A site, a third of the pairs.
 */

const maxAbs = (a: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
};
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

const NEUTRON: PdfModelParams = { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0.01, delta1: 0.5, delta2: 0 };

describe("co-located species", () => {
  it("groups the six cations of each A-site position, and nothing on an ordered structure", () => {
    const atoms = expandStructureAtoms(exampleStructure());
    const groups = colocatedGroups(atoms)!;
    expect(groups).not.toBeNull();
    const reps = new Set(groups.rep);
    expect(atoms.length).toBe(22);
    expect(reps.size).toBe(12); // 2 A + 2 W + 4 + 4 O positions
    expect(colocatedGroups(expandStructureAtoms(gata4se8PdfExample().structure))).toBeNull();
  });

  it("gives the per-atom G(r) up to rounding, from about a third of the pairs", () => {
    const st = exampleStructure();
    const atoms = expandStructureAtoms(st);
    const groups = colocatedGroups(atoms);
    const r = makeRGrid(0.5, 15, 0.01);
    const perAtom = enumeratePairs(st.cell, atoms, 16);
    const grouped = enumeratePairs(st.cell, atoms, 16, groups);
    expect(grouped.length / perAtom.length).toBeLessThan(0.31);
    for (const type of ["neutron", "xray"] as const) {
      const params = { ...NEUTRON, scatteringType: type };
      const ref = computeGofR(st.cell, atoms, r, params, perAtom);
      const g = computeGofR(st.cell, atoms, r, params, grouped, groups);
      expect(maxDiff(g, ref)).toBeLessThan(1e-12 * maxAbs(ref));
    }
  });

  it("gives the per-atom analytic columns up to rounding: occupancy per species, the shared B and position", () => {
    const st = exampleStructure();
    const { atoms, provenance } = expandStructureAtomsWithProvenance(st);
    const groups = colocatedGroups(atoms)!;
    const r = makeRGrid(0.5, 12, 0.01);
    const onSites = (labels: string[]): Float64Array => {
      const out = new Float64Array(atoms.length);
      for (let a = 0; a < atoms.length; a++) if (labels.includes(st.sites[provenance[a]!.siteIndex]!.label)) out[a] = 1;
      return out;
    };
    const aSite = ["Co1", "Fe1", "Ni1", "Mn1", "Cu8", "Zn1"];
    const shared = onSites(aSite);
    const requests: PdfColumnRequest[] = [
      { kind: "occupancy", dOcc: onSites(["Mn1"]) },
      { kind: "occupancy", dOcc: onSites(["O1"]) },
      { kind: "msd", constant: shared.map((x) => x * DUISO_DBISO), tensors: atoms.map(() => null) },
      { kind: "position", velocity: atoms.map((_, a) => (shared[a] ? [0, provenance[a]!.rotation[1]![1]! * 5.7, 0] : null)) },
      { kind: "sigma", target: "delta1" },
      { kind: "qdamp" },
    ];
    expect(requestsUniformOver(requests, groups)).toBe(true);
    const ref = computeGofRWithColumns(st.cell, atoms, r, NEUTRON, enumeratePairs(st.cell, atoms, 13), requests);
    const got = computeGofRWithColumns(st.cell, atoms, r, NEUTRON, enumeratePairs(st.cell, atoms, 13, groups), requests, groups);
    expect(maxDiff(got.g, ref.g)).toBeLessThan(1e-12 * maxAbs(ref.g));
    ref.columns.forEach((col, c) => expect(maxDiff(got.columns[c]!, col)).toBeLessThan(1e-11 * maxAbs(col)));
  });

  it("tells a request that moves one species of a group apart from the rest", () => {
    const st = exampleStructure();
    const { atoms, provenance } = expandStructureAtomsWithProvenance(st);
    const groups = colocatedGroups(atoms)!;
    const mnOnly: PdfColumnRequest = { kind: "position", velocity: atoms.map((_, a) => (st.sites[provenance[a]!.siteIndex]!.label === "Mn1" ? [0, 1, 0] : null)) };
    expect(requestsUniformOver([mnOnly], groups)).toBe(false);
    const bMnOnly: PdfColumnRequest = { kind: "msd", constant: Float64Array.from(atoms, (_, a) => (st.sites[provenance[a]!.siteIndex]!.label === "Mn1" ? DUISO_DBISO : 0)), tensors: atoms.map(() => null) };
    expect(requestsUniformOver([bMnOnly], groups)).toBe(false);
  });

  it("the PDF problem's column for one species' own position (grouped by position, told apart by its velocity) matches finite differences", () => {
    const st = exampleStructure();
    // No termination: the finite-difference oracle then needs only the Richardson filter (pdfAnalyticJacobian.test.ts).
    const pts = Array.from(makeRGrid(0.01, 12, 0.01), (r) => ({ r, gObs: 0 }));
    const pattern: PdfPattern = { id: "he", name: "he", scatteringType: "neutron", points: pts };
    const fitRange = { min: 1.5, max: 10 };
    const page = pdfPage(st, pattern, { preset: { fitRange } });
    const v = pageView(page);
    // Mn's own position row, at 0: Mn still sits with the other five, but its derivative moves it alone.
    const shared = v.bindings.find((b) => b.kind === "positionShift" && b.targetKey === "Mn1")!;
    const params = [...page.params.map((p) => ({ ...p, fixed: true })), { id: "pos_Mn_own", label: "Mn y", kind: "positionShift" as const, value: 0, initialValue: 0, fixed: false }];
    const bindings = [...v.bindings.filter((b) => b !== shared), { ...shared, parameterId: "pos_Mn_own" }];
    const problem = buildProblemForSpec({ kind: "pdf", structure: v.fitStructure, pattern, parameters: params, bindings, fitRange });
    const free = params.filter((p) => !p.fixed);
    const [col] = problem.analyticColumns!(free, [0]);
    const values = Object.fromEntries(params.map((p) => [p.id, p.value]));
    const fd = (h: number): Float64Array => {
      const f = problem.calculate({ ...values, pos_Mn_own: h });
      const b = problem.calculate({ ...values, pos_Mn_own: -h });
      return f.map((y, i) => (y - b[i]!) / (2 * h));
    };
    const [d1, d2] = [fd(1e-5), fd(5e-6)];
    const scale = maxAbs(d2);
    expect(scale).toBeGreaterThan(0);
    let used = 0;
    for (let i = 0; i < d2.length; i++) {
      if (Math.abs(d1[i]! - d2[i]!) > 1e-6 * scale) continue; // a window-edge spike in the oracle, not in the column
      used++;
      expect(Math.abs(col![i]! - d2[i]!)).toBeLessThan(1e-5 * scale);
    }
    expect(used).toBeGreaterThan(0.9 * (d2.length - pts.filter((p) => p.r < fitRange.min || p.r > fitRange.max).length));
  });
});

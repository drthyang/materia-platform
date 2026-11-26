/**
 * The full same-cell mode basis recovers a synthetic distortion along the
 * directions the earlier gauge dropped (the gauge fix of 2026-11-27; the
 * verification's three cases). Synthetic neutron G(r), 1.5–12 Å, of the
 * distorted child; the page on the undistorted parent, the row activated as
 * the view does, every position mode and the scale free.
 *
 * Before the fix (main 8003787):
 *  - P2₁/c → P2₁, every child site +0.05 Å along a: 6 of 8 modes, the
 *    displacement represented only to 0.050 Å, Rw 6.21 → 4.59 %;
 *  - Pnma → P2₁2₁2₁, every child site +0.05 Å along b: 9 of 12, Rw 8.52 → 3.50 %;
 *  - Pnma → P2₁2₁2₁, only the parent's own Gd x +0.05 Å (truth stays Pnma):
 *    9 of 12, residual 0.0125 Å, Rw 0.42 %.
 */
import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import { applyParameters } from "@/core/workflow/apply";
import { positionShiftValuesFor } from "@/core/crystal/distortionModes";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { ComputeClient } from "@/workers/computeClient";
import { pageView, pdfFit, pdfPage, type PdfPageModel } from "@/app/pdfPage";
import { activationOf, listSubgroups, parseBound } from "@/app/pdfSubgroups";
import { MODE_PARENTS } from "@/core/crystal/irreps/validation/independentModeCount";
import { syntheticPattern } from "@/testSupport/sameCellModeCount";

const WINDOW = { fitRange: { min: 1.5, max: 12 } };
const freeModes = (m: PdfPageModel): PdfPageModel => ({ ...m, params: m.params.map((p) => ({ ...p, fixed: !(p.kind === "positionShift" || p.id === "pdfScale") })) });

/** Every site of `s` (or the one named) moved by the same Cartesian vector (Å). */
function shifted(s: StructureModel, cart: readonly [number, number, number], only?: string): StructureModel {
  const M = orthogonalizationMatrix(s.cell).map((r) => [...r]);
  const det = (A: number[][]): number => A[0]![0]! * (A[1]![1]! * A[2]![2]! - A[1]![2]! * A[2]![1]!) - A[0]![1]! * (A[1]![0]! * A[2]![2]! - A[1]![2]! * A[2]![0]!) + A[0]![2]! * (A[1]![0]! * A[2]![1]! - A[1]![1]! * A[2]![0]!);
  const D = det(M);
  const f = [0, 1, 2].map((k) => det(M.map((row, i) => row.map((v, j) => (j === k ? cart[i]! : v)))) / D);
  return { ...s, sites: s.sites.map((x) => (only && x.label !== only ? x : { ...x, position: [x.position[0] + f[0]!, x.position[1] + f[1]!, x.position[2] + f[2]!] as [number, number, number] })) };
}

/** How far the mode set is from holding the truth: the largest site residual (Å) after the least-squares interpolation. */
function residual(set: NonNullable<PdfPageModel["modes"]>["set"], truth: StructureModel): number {
  const anchor = set.parentized;
  const best = applyParameters(anchor, set.bindings, positionShiftValuesFor(anchor, set.bindings, truth)).model;
  const M = orthogonalizationMatrix(anchor.cell).map((r) => [...r]);
  let worst = 0;
  for (const s of best.sites) {
    const t = truth.sites.find((x) => x.label === s.label)!;
    const d = [0, 1, 2].map((k) => t.position[k]! - s.position[k]!);
    const c = M.map((r) => r[0]! * d[0]! + r[1]! * d[1]! + r[2]! * d[2]!);
    worst = Math.max(worst, Math.hypot(c[0]!, c[1]!, c[2]!));
  }
  return worst;
}

const CASES = [
  { name: "P2₁/c → P2₁, every child site +0.05 Å along a", parent: "P2_1/c", row: /^P 1 21 1 /, modes: 8, truth: (c: StructureModel) => shifted(c, [0.05, 0, 0]) },
  { name: "Pnma → P2₁2₁2₁, every child site +0.05 Å along b", parent: "Pnma", row: /^P 21 21 21 /, modes: 12, truth: (c: StructureModel) => shifted(c, [0, 0.05, 0]) },
  { name: "Pnma → P2₁2₁2₁, only the parent's Gd x +0.05 Å (the truth stays Pnma)", parent: "Pnma", row: /^P 21 21 21 /, modes: 12, truth: (c: StructureModel) => shifted(c, [0.05, 0, 0], "A") },
] as const;

describe("the full basis recovers the distortions the earlier gauge could not represent", () => {
  for (const cs of CASES) {
    it(cs.name, async () => {
      const parent = MODE_PARENTS[cs.parent]!.structure;
      const row = (await listSubgroups(parent, parseBound("1×1×1")!)).rows.find((r) => r.sameCell && cs.row.test(r.name))!;
      expect(row.modes).toBe(cs.modes);
      // The child as the page realises it, from the undistorted parent; the truth is that child distorted.
      const child = activationOf(pdfPage(parent, syntheticPattern(parent), { preset: WINDOW }), row.action).model.modes!.set.parentized;
      const truth = cs.truth(child);
      const page = pdfPage(parent, syntheticPattern(truth), { preset: WINDOW });
      const activated = activationOf(page, row.action).model;
      const set = activated.modes!.set;
      expect(set.modes).toHaveLength(cs.modes);
      expect(residual(set, truth)).toBeLessThan(1e-12);
      const fit = await pdfFit(new ComputeClient(), freeModes(activated));
      // Exact recovery: the fit reaches the truth's own curve (Rw ~1e-14 for the shifts, ~1e-8 for Gd x alone).
      expect(fit.result.agreement.rWeighted).toBeLessThan(1e-6);
      expect(Math.abs(fit.values.pdfScale! - 1)).toBeLessThan(1e-6);
      const refined = applyParameters(set.parentized, set.bindings, fit.values).model;
      const M = orthogonalizationMatrix(set.parentized.cell).map((r) => [...r]);
      // Up to a rigid translation along the child's polar axis (unobservable): compare relative positions.
      const at = (s: StructureModel, label: string) => s.sites.find((x) => x.label === label)!.position;
      const labels = truth.sites.map((x) => x.label);
      let worst = 0;
      for (const l of labels) {
        const d = [0, 1, 2].map((k) => (at(refined, l)[k]! - at(refined, labels[0]!)[k]!) - (at(truth, l)[k]! - at(truth, labels[0]!)[k]!));
        const c = M.map((r) => r[0]! * d[0]! + r[1]! * d[1]! + r[2]! * d[2]!);
        worst = Math.max(worst, Math.hypot(c[0]!, c[1]!, c[2]!));
      }
      expect(worst).toBeLessThan(5e-4);
      expect(pageView(page).rw).toBeGreaterThan(1e-3);
    }, 120_000);
  }
});

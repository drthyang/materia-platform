/**
 * A synthetic shared site with a known truth, for the PDF page's occupancy
 * constraint (core/workflow/pdfOccupancyTie.test.ts, the Agent's tests): (A)O
 * in the CsCl type with invented occupancies on the A site, and its G(r).
 */

import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import type { RefinementParameter } from "@/core/refinement/types";
import { makeRGrid } from "@/core/pdf/forwardModel";
import { buildPdfProblem, buildPdfSpec } from "@/core/workflow/pdf";

/** (A)O, CsCl type (Pm-3m): the A site at the origin shared by the given species, O at the body centre. */
export function cscl(occ: Readonly<Record<string, number>>): StructureModel {
  return {
    id: "ao",
    name: "(A)O",
    cell: { a: 3.2, b: 3.2, c: 3.2, alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: buildSpaceGroup(221),
    sites: [
      ...Object.entries(occ).map(([label, occupancy]) => ({ label, element: label.replace(/\d+$/, ""), position: [0, 0, 0] as [number, number, number], occupancy, adp: { kind: "isotropic" as const, bIso: 0.6 } })),
      { label: "O1", element: "O", position: [0.5, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.8 } },
    ],
  };
}

export const valuesOf = (ps: readonly RefinementParameter[]): Record<string, number> => Object.fromEntries(ps.map((p) => [p.id, p.value]));
export const maxAbs = (a: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
};

function normals(seed: number): () => number {
  let s = seed;
  const u = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** The truth's G(r) on 0.5 Å to the window's end (Δr 0.02, no termination), Gaussian noise of `noise` × max |G| added. */
export function simulateSharedSite(truth: StructureModel, scatteringType: "neutron" | "xray", noise: number, seed: number, fit: { readonly min: number; readonly max: number } = { min: 1.5, max: 12 }, totals?: Readonly<Record<string, number>>): PdfPattern {
  const blank: PdfPattern = { id: `ao-${scatteringType}`, name: `(A)O ${scatteringType}`, scatteringType, points: Array.from(makeRGrid(0.5, fit.max, 0.02), (r) => ({ r, gObs: 0 })), qdamp: 0.03 };
  // The truth's own occupancies: its site's total is their sum, so the tie leaves them as they are.
  const spec = buildPdfSpec(truth, blank, totals ? { totals } : {});
  const y = buildPdfProblem(truth, blank, spec.params, spec.bindings, [], fit).calculate(valuesOf(spec.params));
  const n = normals(seed);
  const sigma = noise * maxAbs(y);
  return { ...blank, points: blank.points.map((p, i) => ({ r: p.r, gObs: y[i]! + sigma * n() })) };
}


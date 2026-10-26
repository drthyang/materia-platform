import { describe, it, expect } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import type { AtomSite, StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { realizeSubgroup, stabilizerOfField } from "@/core/crystal/isotropyTree";
import { applyOperation } from "@/core/crystal/symmetry";
import { applyParameters } from "@/core/workflow/apply";
import { structuralSubgroupLattice } from "@/core/crystal/subgroupTree";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { ACTIVATION_KICK, pdfFit, pdfPage, withSubgroup, type PdfPageModel } from "@/app/pdfPage";

/**
 * Lowering the symmetry from the subgroup lattice (withSubgroup) kicks the
 * order parameter off zero as the irrep route does. At the parent's geometry
 * χ² is invariant under the parent group, so its derivative along every
 * symmetry-breaking mode is exactly zero: a mode started at 0 never moves.
 * A cubic perovskite (Pm-3m) against a synthetic G(r) of its P4mm distortion.
 */

const site = (label: string, element: string, position: [number, number, number]): AtomSite => ({ label, element, position, occupancy: 1, adp: { kind: "isotropic", bIso: 0.4 } });
const PARENT: StructureModel = {
  id: "bto", name: "BaTiO3", cell: { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(221),
  sites: [site("Ba", "Ba", [0, 0, 0]), site("Ti", "Ti", [0.5, 0.5, 0.5]), site("O", "O", [0, 0.5, 0.5])],
};

/** P4mm with the polar axis along c: Ti up 0.08 Å, the oxygens down 0.04 Å (BaTiO₃'s ferroelectric pattern). */
const P4MM = structuralSubgroupLattice(PARENT).nodes.find((n) => n.identity.number === 99 && n.identity.method === "direct")!;

function distortedPattern(): PdfPattern {
  const child = realizeSubgroup(PARENT, P4MM.operations, P4MM.identity);
  const truth: StructureModel = {
    ...child,
    sites: child.sites.map((s) => (s.element === "Ti" ? { ...s, position: [s.position[0], s.position[1], s.position[2] + 0.02] } : s.element === "O" ? { ...s, position: [s.position[0], s.position[1], s.position[2] - 0.01] } : s)),
  };
  const rGrid = makeRGrid(1.5, 12, 0.02);
  const g = computeGofR(truth.cell, expandStructureAtoms(truth), rGrid, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  return { id: "p4mm", name: "P4mm", scatteringType: "neutron", points: Array.from(rGrid, (r, i) => ({ r, gObs: g[i]! })), qdamp: 0.03 };
}

/** Only the rows given free. */
const freeOnly = (m: PdfPageModel, ids: readonly string[]): PdfPageModel => ({ ...m, params: m.params.map((p) => ({ ...p, fixed: !ids.includes(p.id) })) });

describe("a subgroup picked from the lattice", () => {
  const pattern = distortedPattern();
  const page = pdfPage(PARENT, pattern, { preset: { fitRange: { min: 1.5, max: 12 } } });
  const { model, label, message } = withSubgroup(page, P4MM);
  const set = model.modes!.set;
  const lead = set.modes.find((mode) => mode.active)!;

  it("leads with the order parameter, free at the starting kick, the other modes fixed at 0", () => {
    expect(label).toBe("P 4 m m #99");
    expect(message).toMatch(/the order parameter \(Γ\d+\) free from 0\.05 Å/);
    expect(lead.label).toMatch(/^Γ\d+ → P 4 m m$/);
    const row = model.params.find((p) => p.id === lead.id)!;
    expect([row.value, row.fixed]).toEqual([ACTIVATION_KICK, false]);
    for (const p of model.params.filter((q) => q.kind === "positionShift" && q.id !== lead.id)) expect([p.value, p.fixed]).toEqual([0, true]);
    // The kicked structure has exactly the subgroup's symmetry: P4mm, not a higher one.
    const child = set.parentized;
    expect(child.spaceGroup.operations).toHaveLength(8);
    const kickedChild = applyParameters(child, set.bindings, { [lead.id]: ACTIVATION_KICK }).model;
    const atoms = child.sites.flatMap((s, i) => child.spaceGroup.operations.map((g) => {
      const from = applyOperation(g, s.position);
      const to = applyOperation(g, kickedChild.sites[i]!.position);
      return { position: from, u: [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as [number, number, number] };
    }));
    const field = { atoms: atoms.filter((a, i) => atoms.findIndex((b) => b.position.every((x, k) => Math.abs(((x - a.position[k]! + 0.5) % 1 + 1) % 1 - 0.5) < 1e-6)) === i) };
    expect(field.atoms).toHaveLength(5);
    expect(stabilizerOfField(field, PARENT.spaceGroup.operations)).toHaveLength(8);
  });

  it("refines from the kick to the distortion; from 0 no mode moves (χ² is stationary there)", async () => {
    const client = new ComputeClient();
    const modes = set.modes.map((mode) => mode.id);
    // The modes and the scale (seeded from the undistorted model) refine.
    const kickedFit = await pdfFit(client, freeOnly(model, [...modes, "pdfScale"]));
    const atZero = freeOnly({ ...model, params: model.params.map((p) => (p.id === lead.id ? { ...p, value: 0 } : p)) }, [...modes, "pdfScale"]);
    const stuckFit = await pdfFit(client, atZero);
    // From 0 every derivative is exactly zero: the amplitudes stay at 0, the fit at the parent's.
    for (const id of modes) expect(Math.abs(stuckFit.values[id]!), id).toBeLessThan(1e-9);
    expect(stuckFit.result.agreement.rWeighted!).toBeGreaterThan(0.02);
    // From the kick the order parameter leaves its start, the other modes follow (no longer
    // stationary once the symmetry is broken), and the fit reaches the distortion (or its
    // inversion twin, which has the same G(r)).
    expect(Math.abs(kickedFit.values[lead.id]! - ACTIVATION_KICK)).toBeGreaterThan(0.005);
    expect(modes.filter((id) => id !== lead.id).some((id) => Math.abs(kickedFit.values[id]!) > 1e-3)).toBe(true);
    expect(kickedFit.result.agreement.rWeighted!).toBeLessThan(1e-6);
    expect(kickedFit.values.pdfScale!).toBeCloseTo(1, 6);
  }, 120_000);
});

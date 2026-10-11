import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import type { StructureModel } from "@/core/crystal/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { nuclearStructureFactor } from "@/core/diffraction/structureFactor";
import { scPlan, scStructureFactors, type ScDerivative } from "@/core/diffraction/scKernel";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { allowedAnisotropicAdpModes } from "@/core/crystal/adpConstraints";
import { withAdpModel } from "@/core/crystal/adp";

/** A monoclinic test structure: general positions, one isotropic and two anisotropic sites. */
const monoclinic = parseCif(`data_t
_cell_length_a 7.1
_cell_length_b 5.3
_cell_length_c 9.7
_cell_angle_alpha 90
_cell_angle_beta 101.3
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 21/c'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
_atom_site_adp_type
_atom_site_occupancy
S1 S 0.123 0.271 0.088 0.021 Uani 1
C1 C 0.311 0.105 0.247 0.025 Uani 1
H1 H 0.402 0.183 0.301 0.030 Uiso 0.9
loop_
_atom_site_aniso_label
_atom_site_aniso_U_11
_atom_site_aniso_U_22
_atom_site_aniso_U_33
_atom_site_aniso_U_12
_atom_site_aniso_U_13
_atom_site_aniso_U_23
S1 0.020 0.024 0.019 0.002 0.004 -0.001
C1 0.026 0.022 0.027 -0.003 0.006 0.002
`, "mono");

/** Corundum, anisotropic: both sites on special positions of R-3c. */
const corundum = withAdpModel(parseCif(`data_c
_cell_length_a 4.7613
_cell_length_b 4.7613
_cell_length_c 12.9846
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 120
_symmetry_space_group_name_H-M 'R -3 c'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
Al1 Al 0 0 0.35216 0.0035
O1 O 0.30624 0 0.25 0.0040
`, "corundum"), "anisotropic");

function compareWithReference(model: StructureModel, radiation: Parameters<typeof scPlan>[1]): number {
  const refl = generateReflections(model.cell, model.spaceGroup, 0.7, 20).slice(0, 120);
  const out = scStructureFactors(scPlan(model, radiation, refl), model);
  let worst = 0;
  refl.forEach((r, i) => {
    const f = nuclearStructureFactor(model, radiation, r.h, r.k, r.l);
    const scale = Math.max(1, Math.hypot(f.re, f.im));
    worst = Math.max(worst, Math.abs(out.re[i]! - f.re) / scale, Math.abs(out.im[i]! - f.im) / scale);
  });
  return worst;
}

describe("the single-crystal structure-factor kernel", () => {
  it("reproduces nuclearStructureFactor on general and special positions, X-ray and neutron", () => {
    expect(compareWithReference(monoclinic, { kind: "xray", wavelength: 0.71073 })).toBeLessThan(1e-12);
    expect(compareWithReference(monoclinic, { kind: "neutron", wavelength: 1.0 })).toBeLessThan(1e-12);
    expect(compareWithReference(corundum, { kind: "neutron", wavelength: 1.0 })).toBeLessThan(1e-12);
  });

  it("gives ∂F for position modes, U modes, B_iso and occupancy that match finite differences", () => {
    for (const model of [monoclinic, corundum]) {
      const radiation = { kind: "xray" as const, wavelength: 0.71073 };
      const refl = generateReflections(model.cell, model.spaceGroup, 0.8, 20).slice(0, 80);
      const plan = scPlan(model, radiation, refl);
      const derivs: ScDerivative[] = [];
      const moves: ((m: StructureModel, e: number) => StructureModel)[] = [];
      model.sites.forEach((site, j) => {
        const shifts = allowedPositionShifts(model.spaceGroup.operations, site.position).basis;
        for (const axis of shifts) {
          derivs.push({ kind: "position", site: j, axis: axis as [number, number, number] });
          moves.push((m, e) => ({ ...m, sites: m.sites.map((s, q) => (q === j ? { ...s, position: [s.position[0] + e * axis[0]!, s.position[1] + e * axis[1]!, s.position[2] + e * axis[2]!] as [number, number, number] } : s)) }));
        }
        if (site.adp.kind === "anisotropic") {
          for (const { basis } of allowedAnisotropicAdpModes(model.spaceGroup.operations, site.position, site.adp.uAniso).modes) {
            derivs.push({ kind: "uMode", site: j, basis: basis as [number, number, number, number, number, number] });
            moves.push((m, e) => ({ ...m, sites: m.sites.map((s, q) => (q === j && s.adp.kind === "anisotropic" ? { ...s, adp: { kind: "anisotropic", uAniso: s.adp.uAniso.map((v, c) => v + e * basis[c]!) as [number, number, number, number, number, number] } } : s)) }));
          }
        } else {
          derivs.push({ kind: "bIso", site: j });
          moves.push((m, e) => ({ ...m, sites: m.sites.map((s, q) => (q === j && s.adp.kind === "isotropic" ? { ...s, adp: { kind: "isotropic", bIso: s.adp.bIso + e } } : s)) }));
        }
        derivs.push({ kind: "occupancy", site: j });
        moves.push((m, e) => ({ ...m, sites: m.sites.map((s, q) => (q === j ? { ...s, occupancy: s.occupancy + e } : s)) }));
      });
      const out = scStructureFactors(plan, model, derivs);
      const eps = 1e-6;
      derivs.forEach((_, r) => {
        const up = scStructureFactors(plan, moves[r]!(model, eps));
        const down = scStructureFactors(plan, moves[r]!(model, -eps));
        for (let i = 0; i < refl.length; i++) {
          const fdRe = (up.re[i]! - down.re[i]!) / (2 * eps);
          const fdIm = (up.im[i]! - down.im[i]!) / (2 * eps);
          const tol = 1e-5 * Math.max(1, Math.abs(fdRe), Math.abs(fdIm));
          expect(Math.abs(out.dRe[r]![i]! - fdRe)).toBeLessThan(tol);
          expect(Math.abs(out.dIm[r]![i]! - fdIm)).toBeLessThan(tol);
        }
      });
    }
  });
});

/**
 * A supercell child refined by the Rietveld engine from the lattice route,
 * superlattice reflections included (subgroup engine phase 3, THY-34), on
 * synthetic data.
 *
 * The truth is the a⁻a⁻a⁻ tilt of cubic SrTiO₃ (R-3c), built geometrically
 * (testSupport/perovskiteTilts.ts), in a strained cell with its own ADPs: a
 * constant-wavelength neutron pattern with counting noise. Its R-point
 * superlattice reflections — the hexagonal reflections whose parent indices
 * P⁻ᵀH are half-integral — carry the tilt: their intensity goes as the tilt
 * squared and is zero in the cubic parent.
 *
 * As on the PDF side, the refinement starts from the cubic parent: every
 * R-3c class of the 2×2×2 supercell lattice is realised at the parent's
 * geometry, kicked along a generic symmetry-breaking field, and refined
 * (scale, background, cell, B_iso, every displacement the child allows).
 * The class that fits best must be the truth's, at the noise, with the tilt
 * recovered.
 */
import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { generateReflections } from "@/core/diffraction/reflections";
import { nuclearStructureFactorSquared } from "@/core/diffraction/structureFactor";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, type SubgroupClass } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild, symmetryBreakingField, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { buildSymmetryModes, withDistortionModes } from "@/core/crystal/distortionModes";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { buildStructureRefinement } from "@/core/workflow/structureRefinement";
import { buildPowderProblem, powderCurves } from "@/core/workflow/powder";
import { applyParameters } from "@/core/workflow/apply";
import { refine } from "@/core/refinement/engine";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, gaussianNoise, inverse3, octahedralGeometry, srtio3, tiltedChild, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const lattice = supercellSubgroups(group, { maxIndex: 48 });
const PROFILE = { shape: "gaussian" as const };
const RADIATION = { kind: "neutron" as const, wavelength: 1.54 };

function truthClass(g0: Glazer): { cls: SubgroupClass; r: RealisedChild; g: Glazer; order: readonly [number, number, number] } {
  for (const cls of lattice.classes) {
    if (cls.identity?.number !== g0.number || !cls.cellMultiplying) continue;
    const r = realiseChild(PARENT, group, cls.elements, cls.identity);
    for (const order of AXIS_ORDERS) for (const sg of TILT_SENSES) {
      const g: Glazer = { ...g0, phi: [g0.phi[0] * sg[0], g0.phi[1] * sg[1], g0.phi[2] * sg[2]] };
      if (tiltIsInvariant(r, g, order)) return { cls, r, g, order };
    }
  }
  throw new Error(`no ${g0.name} class`);
}

/** The superlattice reflections of a realised child: its H whose parent indices P⁻ᵀH are not integral. */
function isSuperlattice(r: RealisedChild, h: number, k: number, l: number): boolean {
  const Pinv = inverse3(r.basis);
  return [0, 1, 2].some((j) => {
    const x = Pinv[0][j]! * h + Pinv[1][j]! * k + Pinv[2][j]! * l;
    return Math.abs(x - Math.round(x)) > 1e-6;
  });
}

interface RietveldCase {
  readonly truth: StructureModel;
  readonly cls: SubgroupClass;
  readonly superlattice: number;
  readonly strong: number;
  readonly fits: readonly { c: SubgroupClass; rwp: number; chi2: number; status: string; refined: StructureModel; volumeRatio: number; free: number }[];
  readonly best: { c: SubgroupClass; refined: StructureModel; chi2: number; volumeRatio: number };
}

/**
 * One tilt system end to end: the truth (tilted, strained, its own ADPs, then
 * `extra`), its superlattice reflections, a noisy constant-wavelength neutron
 * pattern, and the lattice route over every class of the type.
 */
function rietveldCase(g0: Glazer, strain: Vec3, extra: (s: StructureModel) => StructureModel = (s) => s): RietveldCase {
  const { cls, r, g, order } = truthClass(g0);
  const tilted = extra(tiltedChild(r, g, 0.07, order));
  const b: Record<string, number> = { Sr: 0.52, Ti: 0.33, O: 0.71 };
  const truth: StructureModel = {
    ...tilted,
    cell: { ...tilted.cell, a: tilted.cell.a * strain[0], b: tilted.cell.b * strain[1], c: tilted.cell.c * strain[2] },
    sites: tilted.sites.map((s) => ({ ...s, adp: { kind: "isotropic", bIso: b[s.element]! } })),
  };

  // The superlattice reflections: zero in the parent's realisation, present in the truth.
  const refl = generateReflections(truth.cell, truth.spaceGroup, 1.0, 20);
  const sup = refl.filter((x) => isSuperlattice(r, x.h, x.k, x.l));
  for (const x of sup) expect(nuclearStructureFactorSquared(r.structure, RADIATION, x.h, x.k, x.l)).toBeLessThan(1e-18);
  const strong = sup.filter((x) => nuclearStructureFactorSquared(truth, RADIATION, x.h, x.k, x.l) > 1);

  // The synthetic pattern: 2θ 15–135°, Gaussian peaks of a known width, a flat background, counting noise.
  const grid = Array.from({ length: 2401 }, (_, i) => 15 + i * 0.05);
  const empty: PowderPattern = { id: "synthetic-powder", name: `synthetic ${g0.name}`, xUnit: "twoTheta", radiation: RADIATION, wavelength: 1.54, points: grid.map((x) => ({ x, yObs: 0 })) };
  const truthSpec = buildStructureRefinement(truth, empty, { scale: 400, width: 0.25, backgroundTerms: 1, refineAdp: false, refinePositions: false });
  const bg = truthSpec.params.find((p) => p.kind === "background")!;
  const params0 = truthSpec.params.map((p) => (p.id === bg.id ? { ...p, value: 200 } : p));
  // Counts of a good laboratory pattern: the strongest peak at 5·10⁴.
  const yRaw = powderCurves(truth, empty, params0, truthSpec.bindings, PROFILE).yCalc;
  const top = Math.max(...yRaw);
  const yTrue = yRaw.map((y) => (y * 5e4) / top);
  const e = gaussianNoise(grid.length, 1, 777);
  const pattern: PowderPattern = { ...empty, points: grid.map((x, i) => {
    const s = Math.sqrt(Math.max(yTrue[i]!, 1));
    return { x, yObs: yTrue[i]! + s * e[i]!, sigma: s };
  }) };

  // The lattice route: every class of the type, realised at the cubic parent's geometry, kicked and refined.
  const candidates = lattice.classes.filter((c) => c.identity?.number === g0.number && c.cellMultiplying);
  const fits = candidates.map((c) => {
    const rc = realiseChild(PARENT, group, c.elements, c.identity);
    // A class with every atom on a fixed position has no displacement to kick (it differs from the parent in its metric only).
    const field = symmetryBreakingField(PARENT, rc);
    const set = buildSymmetryModes(rc.structure, field ? { seeds: [{ axes: field, label: "symmetry-breaking kick" }], gauge: "polar" } : { gauge: "polar" });
    const spec = buildStructureRefinement(set.parentized, pattern, { scale: (300 * 5e4) / top, width: 0.25, backgroundTerms: 1, refineAdp: true, refinePositions: true });
    const swapped = set.modes.length > 0 ? withDistortionModes({ params: spec.params, bindings: spec.bindings }, set) : { params: spec.params, bindings: spec.bindings };
    const lead = field ? set.modes[0]!.id : null;
    const params = swapped.params.map((p) => {
      if (p.kind === "positionShift") return { ...p, value: p.id === lead ? 0.05 : 0, fixed: false };
      if (p.kind === "background") return { ...p, value: (150 * 5e4) / top, fixed: false };
      if (p.kind === "scale" || p.kind === "bIso" || p.kind === "cellLength") return { ...p, fixed: false };
      return { ...p, fixed: true };
    });
    const result = refine(buildPowderProblem(set.parentized, pattern, params, swapped.bindings, PROFILE, spec.restraints), { maxIterations: 60 });
    const refined = applyParameters(set.parentized, swapped.bindings, result.parameters).model;
    return { c, rwp: result.agreement.rWeighted ?? 1, chi2: (result.agreement.goodnessOfFit ?? NaN) ** 2, status: result.status, refined, volumeRatio: rc.volumeRatio, free: params.filter((p) => !p.fixed).length };
  });
  fits.sort((x, y) => x.rwp - y.rwp);
  for (const f of fits) console.log(`[supercell Rietveld] ${g0.name} class ${f.c.id} (cell ×${f.volumeRatio}, ${f.free} free): ${f.status}, Rwp = ${(f.rwp * 100).toFixed(3)} %, χ²ν = ${f.chi2.toFixed(3)}`);
  // The model kept: of the classes at the counting noise (χ²ν ≈ 1), the highest symmetry (smallest cell,
  // fewest parameters). A same-type subgroup in a larger cell holds the truth too, with more parameters.
  const atNoise = fits.filter((f) => f.chi2 < 1.1);
  expect(atNoise.length).toBeGreaterThan(0);
  const best = [...atNoise].sort((x, y) => x.volumeRatio - y.volumeRatio || x.free - y.free)[0]!;
  return { truth, cls, superlattice: sup.length, strong: strong.length, fits, best };
}

const toCart = (s: StructureModel) => (f: Vec3): Vec3 => fractionalToCartesian(s.cell, f);

describe("Rietveld refinement of a supercell child from the lattice route (synthetic SrTiO₃ tilts)", { timeout: 1_800_000 }, () => {
  it("a⁻a⁻a⁻: R-3c from Pm-3m — superlattice reflections carry the tilt; the right class refines to the noise and recovers it", () => {
    const { truth, cls, superlattice, strong, fits, best } = rietveldCase(GLAZER["a-a-a-"]!, [0.9985, 0.9985, 1.002]);
    expect(superlattice).toBeGreaterThan(10);
    expect(strong).toBeGreaterThan(5);
    expect(best.c.id).toBe(cls.id);
    for (const f of fits.filter((x) => x.volumeRatio <= best.volumeRatio && x.c !== best.c)) expect(f.chi2).toBeGreaterThan(2);
    // The tilt: O on 18e (x, 0, ¼), |x − ½| the truth's (either antiphase domain).
    const tilt = (s: StructureModel): number => {
      const o = s.sites.find((site) => site.element === "O")!;
      const basis = allowedPositionShifts(s.spaceGroup.operations, o.position).basis;
      const axis = basis[0]!.findIndex((x) => Math.abs(x) > 0.5);
      return Math.abs(o.position[axis]! - 0.5);
    };
    const gt = octahedralGeometry(expandStructureAtoms(truth), toCart(truth));
    const gf = octahedralGeometry(expandStructureAtoms(best.refined), toCart(best.refined));
    const aWorst = Math.max(...gt.angles.map((x, i) => Math.abs(gf.angles[i]! - x)));
    console.log(`[supercell Rietveld] a⁻a⁻a⁻: ${superlattice} superlattice reflection families (${strong} with |F|² > 1 fm²); O |x − ½| truth ${tilt(truth).toFixed(5)}, refined ${tilt(best.refined).toFixed(5)}; Ti–O–Ti truth ${gt.angles[0]!.toFixed(3)}°, worst |Δ| ${aWorst.toFixed(3)}°`);
    expect(Math.abs(tilt(best.refined) - tilt(truth))).toBeLessThan(5e-4);
    expect(aWorst).toBeLessThan(0.3);
    expect(Math.abs(best.refined.cell.a - truth.cell.a)).toBeLessThan(1e-3);
    expect(Math.abs(best.refined.cell.c - truth.cell.c)).toBeLessThan(3e-3);
  });

  it("a⁻b⁺a⁻: Pnma from Pm-3m — R- and M-point superlattice reflections; the right class of the twelve, the geometry recovered", () => {
    // Pnma lets Sr move on its mirror (4c): the truth moves it too, inside its own site symmetry.
    const moveSr = (s: StructureModel): StructureModel => ({
      ...s,
      sites: s.sites.map((site) => {
        if (site.element !== "Sr") return site;
        const basis = allowedPositionShifts(s.spaceGroup.operations, site.position).basis;
        const w = [0.008, -0.005, 0];
        const shift = basis.reduce((v, bb, k) => [v[0] + w[k]! * bb[0]!, v[1] + w[k]! * bb[1]!, v[2] + w[k]! * bb[2]!] as Vec3, [0, 0, 0] as Vec3);
        return { ...site, position: [site.position[0] + shift[0], site.position[1] + shift[1], site.position[2] + shift[2]] };
      }),
    });
    const { truth, cls, superlattice, strong, fits, best } = rietveldCase(GLAZER["a-b+a-"]!, [1.001, 0.999, 0.9975], moveSr);
    expect(superlattice).toBeGreaterThan(20);
    expect(strong).toBeGreaterThan(10);
    expect(best.c.id).toBe(cls.id);
    const gt = octahedralGeometry(expandStructureAtoms(truth), toCart(truth));
    const gf = octahedralGeometry(expandStructureAtoms(best.refined), toCart(best.refined));
    const dWorst = Math.max(...gt.distances.map((x, i) => Math.abs(gf.distances[i]! - x)));
    const aWorst = Math.max(...gt.angles.map((x, i) => Math.abs(gf.angles[i]! - x)));
    console.log(`[supercell Rietveld] a⁻b⁺a⁻: ${superlattice} superlattice reflection families (${strong} with |F|² > 1 fm²); ${fits.length} Pnma classes; χ²ν ${best.chi2.toFixed(3)}; worst |Δd| ${dWorst.toExponential(2)} Å, worst |Δangle| ${aWorst.toFixed(3)}°`);
    expect(dWorst).toBeLessThan(5e-3);
    expect(aWorst).toBeLessThan(0.3);
  });
});

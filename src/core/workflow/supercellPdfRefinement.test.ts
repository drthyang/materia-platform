/**
 * A supercell child refined by the PDF engine from the lattice route
 * (subgroup engine phase 3, THY-34), on synthetic data.
 *
 * The truth is an octahedral tilt of cubic SrTiO₃ built geometrically
 * (testSupport/perovskiteTilts.ts) — a⁻a⁻a⁻ (R-3c) and a⁻b⁺a⁻ (Pnma, with
 * the Sr displacement Pnma allows) — in a strained cell with its own ADPs,
 * and its G(r) with noise. The refinement starts from the cubic parent and
 * knows nothing of the truth: it takes every class of the target type from
 * the 2×2×2 supercell lattice, realises it at the parent's geometry
 * (realisation.ts), kicks it along a generic symmetry-breaking field
 * (χ² is stationary at the parent's geometry), and refines scale, cell,
 * ADPs, δ2 and every displacement the child allows. The class that fits
 * best must be the one the truth has, its fit at the noise, and its
 * geometry the truth's: the Ti–O distances and Ti–O–Ti angles, which do not
 * depend on which domain the fit lands in.
 */
import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, type SubgroupClass } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild, symmetryBreakingField } from "@/core/crystal/irreps/realisation";
import { buildSymmetryModes, withDistortionModes } from "@/core/crystal/distortionModes";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { buildPdfProblem, buildPdfSpec } from "@/core/workflow/pdf";
import { applyParameters } from "@/core/workflow/apply";
import { refine } from "@/core/refinement/engine";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, gaussianNoise, octahedralGeometry as geometryOf, srtio3, tiltedChild, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";

/** The octahedral network's Ti–O distances and Ti–O–Ti angles, sorted (testSupport): the geometry, whatever the domain. */
const octahedralGeometry = (s: StructureModel): ReturnType<typeof geometryOf> => geometryOf(expandStructureAtoms(s), (f: Vec3) => fractionalToCartesian(s.cell, f));

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
let latticeCache: ReturnType<typeof supercellSubgroups> | null = null;
const lattice = (): ReturnType<typeof supercellSubgroups> => (latticeCache ??= supercellSubgroups(group, { maxIndex: 48 }));

/** The truth's class: the one whose realised child the tilt field is invariant under. */
function truthClass(g0: Glazer): { cls: SubgroupClass; g: Glazer; order: readonly [number, number, number] } {
  for (const cls of lattice().classes) {
    if (cls.identity?.number !== g0.number || !cls.cellMultiplying) continue;
    const r = realiseChild(PARENT, group, cls.elements, cls.identity);
    for (const order of AXIS_ORDERS) {
      for (const signs of TILT_SENSES) {
        const g: Glazer = { ...g0, phi: [g0.phi[0] * signs[0], g0.phi[1] * signs[1], g0.phi[2] * signs[2]] };
        if (tiltIsInvariant(r, g, order)) return { cls, g, order };
      }
    }
  }
  throw new Error(`no ${g0.name} class`);
}

const PDF_TRUTH = { scale: 0.9, qdamp: 0.04, qbroad: 0, delta1: 0, delta2: 1.6 };

/** The tilted truth in its class's cell, strained, with its own ADPs, and its noisy G(r). */
function truthPattern(g0: Glazer, phi: number, strain: Vec3, extra: (s: StructureModel) => StructureModel): { truth: StructureModel; cls: SubgroupClass; pattern: PdfPattern; noiseRw: number } {
  const { cls, g, order } = truthClass(g0);
  const r = realiseChild(PARENT, group, cls.elements, cls.identity);
  const tilted = extra(tiltedChild(r, g, phi, order));
  const c = tilted.cell;
  const b: Record<string, number> = { Sr: 0.52, Ti: 0.33, O: 0.71 };
  const truth: StructureModel = {
    ...tilted,
    cell: { ...c, a: c.a * strain[0], b: c.b * strain[1], c: c.c * strain[2] },
    sites: tilted.sites.map((site) => ({ ...site, adp: { kind: "isotropic", bIso: b[site.element]! } })),
  };
  const grid = makeRGrid(1.5, 12, 0.02);
  const gTrue = computeGofR(truth.cell, expandStructureAtoms(truth), grid, { scatteringType: "neutron", ...PDF_TRUTH });
  const peak = Math.max(...Array.from(gTrue, Math.abs));
  const e = gaussianNoise(grid.length, 0.004 * peak);
  const gObs = Array.from(gTrue, (x, i) => x + e[i]!);
  const noiseRw = Math.sqrt(e.reduce((t, x) => t + x * x, 0) / gObs.reduce((t, x) => t + x * x, 0));
  return {
    truth,
    cls,
    noiseRw,
    pattern: { id: "synthetic", name: `synthetic ${g0.name}`, scatteringType: "neutron", points: Array.from(grid, (rr, i) => ({ r: rr, gObs: gObs[i]! })), qdamp: PDF_TRUTH.qdamp },
  };
}

/**
 * The lattice route on one class: realise it at the parent's geometry, the
 * generic symmetry-breaking field as the leading mode kicked to 0.05 Å, every
 * displacement the child allows free (as mode amplitudes), with scale, cell,
 * B_iso and δ2; Qdamp held at its calibrated value.
 */
function refineClass(cls: SubgroupClass, pattern: PdfPattern): { rw: number; refined: StructureModel; status: string; volumeRatio: number; free: number } {
  const r = realiseChild(PARENT, group, cls.elements, cls.identity);
  // A class that leaves every atom on a fixed position has no displacement to kick (it differs from the parent in its metric only).
  const field = symmetryBreakingField(PARENT, r);
  const set = buildSymmetryModes(r.structure, field ? { seeds: [{ axes: field, label: "symmetry-breaking kick" }], gauge: "polar" } : { gauge: "polar" });
  const spec = buildPdfSpec(set.parentized, pattern);
  const swapped = set.modes.length > 0 ? withDistortionModes({ params: spec.params, bindings: spec.bindings }, set) : spec;
  const lead = field ? set.modes[0]!.id : null;
  const params = swapped.params.map((p) => {
    if (p.kind === "positionShift") return { ...p, value: p.id === lead ? 0.05 : 0, fixed: false };
    if (p.kind === "bIso" || p.id === "delta2" || p.kind === "cellLength") return { ...p, fixed: false };
    return p;
  });
  const result = refine(buildPdfProblem(set.parentized, pattern, params, swapped.bindings, spec.restraints), { maxIterations: 50, analyticDerivatives: true });
  const refined = applyParameters(set.parentized, swapped.bindings, result.parameters).model;
  return { rw: result.agreement.rWeighted ?? 1, refined, status: result.status, volumeRatio: r.volumeRatio, free: params.filter((p) => !p.fixed).length };
}

/**
 * The model a crystallographer keeps: of the classes whose fit reaches the
 * noise, the one of highest symmetry — the smallest cell, then the fewest
 * free parameters. A subgroup of the truth's child (the same type in a
 * larger cell, an isomorphic subgroup) contains the truth and fits as well
 * with more parameters; it is not the answer.
 */
function chosen<T extends { rw: number; volumeRatio: number; free: number }>(fits: readonly T[], noiseRw: number): T {
  const atNoise = fits.filter((f) => f.rw < noiseRw * 1.05);
  expect(atNoise.length).toBeGreaterThan(0);
  return [...atNoise].sort((a, b) => a.volumeRatio - b.volumeRatio || a.free - b.free)[0]!;
}

describe("PDF refinement of a supercell child from the lattice route (synthetic SrTiO₃ tilts)", { timeout: 1_800_000 }, () => {
  it("a⁻a⁻a⁻: R-3c from Pm-3m — the right class, at the noise, the tilt recovered", () => {
    const { truth, cls, pattern, noiseRw } = truthPattern(GLAZER["a-a-a-"]!, 0.07, [0.9985, 0.9985, 1.002], (s) => s);
    const candidates = lattice().classes.filter((c) => c.identity?.number === 167 && c.cellMultiplying);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const fits = candidates.map((c) => ({ c, ...refineClass(c, pattern) }));
    fits.sort((a, b) => a.rw - b.rw);
    for (const f of fits) console.log(`[supercell PDF] R-3c class ${f.c.id} (cell ×${f.volumeRatio}, ${f.free} free): ${f.status}, Rw = ${(f.rw * 100).toFixed(3)} % (noise ${(noiseRw * 100).toFixed(3)} %)`);
    const best = chosen(fits, noiseRw);
    expect(best.c.id).toBe(cls.id);
    expect(best.rw).toBeLessThan(noiseRw * 1.02);
    // The classes that do not hold the truth stay far from it.
    for (const f of fits.filter((x) => x.volumeRatio <= best.volumeRatio && x !== best)) expect(f.rw).toBeGreaterThan(3 * noiseRw);
    // O on 18e (x, 0, ¼): the tilt is x − ½, either sign (the two antiphase domains).
    const oTruth = truth.sites.find((s) => s.element === "O")!;
    const oFit = best.refined.sites.find((s) => s.element === "O")!;
    const free = (s: StructureModel["sites"][number]): number => {
      const basis = allowedPositionShifts(truth.spaceGroup.operations, s.position).basis;
      expect(basis).toHaveLength(1);
      const axis = basis[0]!.findIndex((x) => Math.abs(x) > 0.5);
      return Math.abs(s.position[axis]! - 0.5);
    };
    console.log(`[supercell PDF] R-3c O x − ½: truth ${free(oTruth).toFixed(5)}, refined ${free(oFit).toFixed(5)}; a ${best.refined.cell.a.toFixed(5)} (truth ${truth.cell.a.toFixed(5)}), c ${best.refined.cell.c.toFixed(5)} (truth ${truth.cell.c.toFixed(5)})`);
    expect(Math.abs(free(oFit) - free(oTruth))).toBeLessThan(5e-4);
    expect(Math.abs(best.refined.cell.a - truth.cell.a)).toBeLessThan(2e-3);
    expect(Math.abs(best.refined.cell.c - truth.cell.c)).toBeLessThan(5e-3);
    const gt = octahedralGeometry(truth);
    const gf = octahedralGeometry(best.refined);
    gt.angles.forEach((x, i) => expect(Math.abs(gf.angles[i]! - x)).toBeLessThan(0.3));
  });

  it("a⁻b⁺a⁻: Pnma from Pm-3m — every coordinate free from the kick, the right class, the geometry recovered", () => {
    const g0 = GLAZER["a-b+a-"]!;
    // Pnma lets Sr move on its mirror (4c): the truth moves it too, inside its own site symmetry.
    const moveSr = (s: StructureModel): StructureModel => ({
      ...s,
      sites: s.sites.map((site) => {
        if (site.element !== "Sr") return site;
        const basis = allowedPositionShifts(s.spaceGroup.operations, site.position).basis;
        const shift = basis.reduce((v, b, k) => [v[0] + (k === 0 ? 0.008 : -0.005) * b[0]!, v[1] + (k === 0 ? 0.008 : -0.005) * b[1]!, v[2] + (k === 0 ? 0.008 : -0.005) * b[2]!] as Vec3, [0, 0, 0] as Vec3);
        return { ...site, position: [site.position[0] + shift[0], site.position[1] + shift[1], site.position[2] + shift[2]] };
      }),
    });
    const { truth, cls, pattern, noiseRw } = truthPattern(g0, 0.07, [1.001, 0.999, 0.9975], moveSr);
    const candidates = lattice().classes.filter((c) => c.identity?.number === 62 && c.cellMultiplying);
    const fits = candidates.map((c) => ({ c, ...refineClass(c, pattern) }));
    fits.sort((a, b) => a.rw - b.rw);
    for (const f of fits) console.log(`[supercell PDF] Pnma class ${f.c.id} (cell ×${f.volumeRatio}, ${f.free} free): ${f.status}, Rw = ${(f.rw * 100).toFixed(3)} % (noise ${(noiseRw * 100).toFixed(3)} %)`);
    const best = chosen(fits, noiseRw);
    expect(best.c.id).toBe(cls.id);
    expect(best.rw).toBeLessThan(noiseRw * 1.02);
    const gt = octahedralGeometry(truth);
    const gf = octahedralGeometry(best.refined);
    const dWorst = Math.max(...gt.distances.map((x, i) => Math.abs(gf.distances[i]! - x)));
    const aWorst = Math.max(...gt.angles.map((x, i) => Math.abs(gf.angles[i]! - x)));
    console.log(`[supercell PDF] Pnma Ti–O–Ti ${gt.angles[0]!.toFixed(2)}–${gt.angles[gt.angles.length - 1]!.toFixed(2)}° (truth); worst |Δd| ${dWorst.toExponential(2)} Å, worst |Δangle| ${aWorst.toFixed(3)}°`);
    expect(dWorst).toBeLessThan(5e-3);
    expect(aWorst).toBeLessThan(0.3);
  });
});

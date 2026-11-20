import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { ComputeClient } from "@/workers/computeClient";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, type SubgroupClass } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { positionShiftValuesFor } from "@/core/crystal/distortionModes";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { applyParameters } from "@/core/workflow/apply";
import { pageView, pdfFit, pdfPage, withFit, withFixed, withParameter, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, gaussianNoise, srtio3, tiltedChild, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";

/**
 * A known answer for the secondary modes (secondary-modes-refine, 2026-11-20):
 * cubic SrTiO₃ against the G(r) of an a⁻b⁺a⁻ tilt (Pnma) in which Sr and both
 * oxygens are also moved inside their own site symmetry, so every one of the
 * child's seven modes has a known amplitude and the five secondary ones are
 * not zero.
 *
 * The truth is made without the mode basis: the tilt geometrically
 * (testSupport/perovskiteTilts.ts), the extra displacement along each site's
 * allowed directions, and G(r) summed over its 20 atoms written out one by
 * one, with seeded noise. Its amplitudes are its displacement from the
 * parent's positions read on the child's modes, which span every free
 * coordinate, so the reading is exact.
 *
 * The page starts from the parent: the child activated (the order parameter
 * kicked, on the truth's side of 0, since ±kick are domains with one G(r)),
 * the secondary modes at 0, then every mode, the cell, the ADPs and the scale
 * free, and Refine.
 */

vi.setConfig({ testTimeout: 300_000 });

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const PDF = { scale: 0.9, qdamp: 0.04, qbroad: 0, delta1: 0, delta2: 0 };
const RANGE = { min: 1.5, max: 12 };

/** The Pnma class the tilt has, and the tilt's orientation in it. */
function tiltClass(): { cls: SubgroupClass; r: RealisedChild; g: Glazer; order: readonly [number, number, number] } {
  const g0 = GLAZER["a-b+a-"]!;
  for (const cls of supercellSubgroups(group, { maxIndex: 48 }).classes.filter((c) => c.identity?.number === 62 && c.cellMultiplying)) {
    const r = realiseChild(PARENT, group, cls.elements, cls.identity);
    for (const order of AXIS_ORDERS) for (const sg of TILT_SENSES) {
      const g: Glazer = { ...g0, phi: [g0.phi[0] * sg[0], g0.phi[1] * sg[1], g0.phi[2] * sg[2]] };
      if (tiltIsInvariant(r, g, order)) return { cls, r, g, order };
    }
  }
  throw new Error("no Pnma class for the tilt");
}

/** Every site moved along the directions its site symmetry allows, by fixed fractional amounts (0.003–0.008). */
function movedInSiteSymmetry(s: StructureModel): StructureModel {
  const amounts = [0.008, -0.005, 0.004, -0.006, 0.003, 0.007, -0.004];
  let k = 0;
  return {
    ...s,
    sites: s.sites.map((site) => {
      const basis = allowedPositionShifts(s.spaceGroup.operations, site.position).basis;
      const shift = basis.reduce((v, b) => { const a = amounts[k++ % amounts.length]!; return [v[0] + a * b[0]!, v[1] + a * b[1]!, v[2] + a * b[2]!] as Vec3; }, [0, 0, 0] as Vec3);
      return { ...site, position: [site.position[0] + shift[0], site.position[1] + shift[1], site.position[2] + shift[2]] as Vec3 };
    }),
  };
}

describe("the secondary modes of a supercell child against a known answer (SrTiO₃, Pnma)", () => {
  const { cls, r, g, order } = tiltClass();
  const truth = movedInSiteSymmetry(tiltedChild(r, g, 0.07, order));
  const grid = makeRGrid(RANGE.min, RANGE.max, 0.02);
  const gTrue = computeGofR(truth.cell, expandStructureAtoms(truth), grid, { scatteringType: "neutron", ...PDF });
  const noise = gaussianNoise(grid.length, 0.004 * Math.max(...Array.from(gTrue, Math.abs)));
  const pattern: PdfPattern = { id: "pnma", name: "a⁻b⁺a⁻ + site displacements", scatteringType: "neutron", points: Array.from(grid, (rr, i) => ({ r: rr, gObs: gTrue[i]! + noise[i]! })), qdamp: PDF.qdamp };
  const noiseRw = Math.sqrt(noise.reduce((t, x) => t + x * x, 0) / pattern.points.reduce((t, p) => t + p.gObs * p.gObs, 0));

  const client = new ComputeClient();
  let start: PdfPageModel;
  let want: Record<string, number>;
  let secondary: string[];
  let fitted: PdfPageModel;

  const valueOf = (m: PdfPageModel, id: string): number => m.params.find((p) => p.id === id)!.value;
  /** Refine until a Refine no longer moves any mode by a thousandth of its esd-scale (three at most). */
  async function refined(m: PdfPageModel): Promise<PdfPageModel> {
    let now = m;
    for (let k = 0; k < 3; k++) now = withFit(now, await pdfFit(client, now));
    return now;
  }

  beforeAll(() => {
    const page = pdfPage(PARENT, pattern, { preset: { fitRange: RANGE } });
    let m = withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! }).model;
    const set = m.modes!.set;
    want = positionShiftValuesFor(set.parentized, set.bindings, truth);
    secondary = set.modes.filter((mode) => !mode.active).map((mode) => mode.id);
    // The kick on the truth's side of 0.
    for (const mode of set.modes.filter((x) => x.active)) m = withParameter(m, mode.id, { value: Math.sign(want[mode.id]!) * Math.abs(valueOf(m, mode.id)) });
    const free = [...set.modes.map((x) => x.id), ...m.params.filter((p) => p.kind === "bIso" || p.kind === "cellLength").map((p) => p.id)];
    start = withFixed(m, free.map((id) => ({ id, fixed: false })));
  });

  it("the truth's amplitudes are exact, and none of the seven is zero", () => {
    const set = start.modes!.set;
    expect(set.modes).toHaveLength(7);
    expect(secondary).toHaveLength(5);
    const rebuilt = applyParameters(set.parentized, set.bindings, want).model;
    for (const site of truth.sites) {
      const got = rebuilt.sites.find((s) => s.label === site.label)!;
      site.position.forEach((x, i) => expect(Math.abs(got.position[i]! - x), `${site.label}[${i}]`).toBeLessThan(1e-12));
    }
    for (const mode of set.modes) expect(Math.abs(want[mode.id]!), mode.label).toBeGreaterThan(0.02);
    expect(secondary.every((id) => valueOf(start, id) === 0)).toBe(true);
  });

  it("every mode free from the kick: the fit reaches the noise and each amplitude its known value within 3 esd", async () => {
    fitted = await refined(start);
    const result = fitted.result!;
    const set = start.modes!.set;
    const rw = pageView(fitted).rw;
    console.log(`[secondary modes, known answer] ${result.message} · Rw ${(100 * rw).toFixed(3)} % (noise ${(100 * noiseRw).toFixed(3)} %)`);
    for (const mode of set.modes) {
      const v = valueOf(fitted, mode.id);
      const esd = result.esd[mode.id]!;
      console.log(`[secondary modes, known answer] ${mode.label}${mode.active ? " (order parameter)" : ""}: ${v.toFixed(4)} ± ${esd.toFixed(4)} Å, known ${want[mode.id]!.toFixed(4)} (${((v - want[mode.id]!) / esd).toFixed(2)} esd)`);
    }
    expect(result.status).toBe("converged");
    expect(rw).toBeLessThan(noiseRw * 1.02);
    for (const mode of set.modes) {
      const esd = result.esd[mode.id]!;
      expect(esd, mode.label).toBeGreaterThan(0);
      expect(esd, mode.label).toBeLessThan(0.02);
      expect(Math.abs(valueOf(fitted, mode.id) - want[mode.id]!), mode.label).toBeLessThan(3 * esd);
    }
  });

  it("a secondary mode moved off by hand is pulled back to the same value", async () => {
    const id = secondary[0]!;
    const before = valueOf(fitted, id);
    const nudged = withParameter(fitted, id, { value: before + 0.1 });
    expect(pageView(nudged).rw).toBeGreaterThan(2 * pageView(fitted).rw);
    const back = await refined(nudged);
    expect(Math.abs(valueOf(back, id) - before)).toBeLessThan(0.1 * fitted.result!.esd[id]!);
    expect(pageView(back).rw).toBeCloseTo(pageView(fitted).rw, 5);
  });

  it("the same answer from secondary rows a round-off left at 1e-15 Å", async () => {
    const roundOff: PdfPageModel = { ...start, params: start.params.map((p) => { const k = secondary.indexOf(p.id); return k < 0 ? p : { ...p, value: (k % 2 ? -1 : 1) * 1e-15 * (1 + k) }; }) };
    const again = await refined(roundOff);
    for (const mode of start.modes!.set.modes) expect(Math.abs(valueOf(again, mode.id) - valueOf(fitted, mode.id)), mode.label).toBeLessThan(0.1 * fitted.result!.esd[mode.id]!);
    expect(pageView(again).rw).toBeCloseTo(pageView(fitted).rw, 5);
  });
});

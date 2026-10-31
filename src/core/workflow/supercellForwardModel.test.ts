/**
 * The supercell forward model's gate (subgroup engine phase 3, THY-34): a
 * supercell child realised from the subgroup lattice (realisation.ts),
 * distorted, and handed to the ordinary PDF and structure-factor engines,
 * against a brute-force sum over the whole supercell written out atom by
 * atom.
 *
 * The distortion is an octahedral tilt of cubic SrTiO₃ built geometrically
 * (testSupport/perovskiteTilts.ts), with no use of the subgroup engine: the
 * crystal is one explicit 2×2×2 cubic cell of 40 atoms (P1), O carrying an
 * anisotropic U along its bond. The engine sees only the child's asymmetric
 * unit in the child's own cell (R-3c on hexagonal axes, I4/mcm, P4/mbm,
 * Pnma) and expands it with the child's operations.
 *
 *  - |F(H)|²: for every H of the child up to |H_i| ≤ 4 (or 3), the 2×2×2
 *    cell's F at the same scattering vector, h′ = 2·P⁻ᵀH, scaled by the cells'
 *    volumes, (det P / 8)²·|F_222(h′)|², with neutron b and X-ray f(s).
 *    Superlattice reflections (h′ odd) included.
 *  - G(r): the PDFfit2 sum (pdf/forwardModel.ts) evaluated directly over the
 *    40 atoms and their periodic images, the same expression term by term
 *    (Gaussians to ±5σ, δ2 and Qbroad widths, the Qdamp envelope, the
 *    −4πρ₀r baseline).
 *
 * Both agree to 1e-9 relative, the gate THY-34 sets.
 */
import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import type { UnitCell } from "@/core/crystal/types";
import type { ExpandedAtom } from "@/core/diffraction/structureFactor";
import { expandStructureAtoms, nuclearStructureFactor } from "@/core/diffraction/structureFactor";
import { computeGofR, makeRGrid, type PdfModelParams } from "@/core/pdf/forwardModel";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { neutronAmplitude } from "@/core/scattering/neutron";
import { xrayFormFactor } from "@/core/scattering/xray";
import { dSpacing } from "@/core/crystal/unitCell";
import { AXIS_ORDERS, GLAZER, inverse3, srtio3, tiltedBlock, tiltedChild, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";

const PARENT = srtio3({ anisoO: true });
/** The tilt angle (rad), about 4°: O moves by about 0.14 Å. */
const PHI = 0.07;

let classesCache: ReturnType<typeof supercellSubgroups> | null = null;
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const lattice = (): ReturnType<typeof supercellSubgroups> => (classesCache ??= supercellSubgroups(group, { maxIndex: 48 }));

/** The class of this type, and the orientation of the tilt (axes and their senses), under which the tilt field is invariant. */
function childFor(g0: Glazer): { r: RealisedChild; order: readonly [number, number, number]; g: Glazer } {
  for (const c of lattice().classes) {
    if (c.identity?.number !== g0.number || !c.cellMultiplying) continue;
    const r = realiseChild(PARENT, group, c.elements, c.identity);
    for (const order of AXIS_ORDERS) {
      for (const signs of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]] as const) {
        const g: Glazer = { ...g0, phi: [g0.phi[0] * signs[0], g0.phi[1] * signs[1], g0.phi[2] * signs[2]] };
        if (tiltIsInvariant(r, g, order)) return { r, order, g };
      }
    }
  }
  throw new Error(`no ${g0.name} child in the lattice`);
}

const cart2a = (cellA: number, y: Vec3): Vec3 => [cellA * y[0], cellA * y[1], cellA * y[2]];

/** F at the 2a cubic cell's (h′k′l′), every atom written out: Σ o·b·T·exp(2πi h′·y). */
function bruteF(cell: UnitCell, atoms: readonly ExpandedAtom[], h: Vec3, radiation: "neutron" | "xray"): { re: number; im: number } {
  const q: Vec3 = [h[0] / cell.a, h[1] / cell.b, h[2] / cell.c];
  const q2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2];
  const s = Math.sqrt(q2) / 2;
  let re = 0;
  let im = 0;
  for (const a of atoms) {
    const amp = radiation === "neutron" ? neutronAmplitude(a.element) : { re: xrayFormFactor(a.element, s), im: 0 };
    const t = a.adp.kind === "isotropic"
      ? Math.exp(-a.adp.bIso * s * s)
      : Math.exp(-2 * Math.PI * Math.PI * (a.adp.uAniso[0] * q[0] * q[0] + a.adp.uAniso[1] * q[1] * q[1] + a.adp.uAniso[2] * q[2] * q[2]));
    const phase = 2 * Math.PI * (h[0] * a.position[0] + h[1] * a.position[1] + h[2] * a.position[2]);
    const w = a.occupancy * t;
    re += w * (amp.re * Math.cos(phase) - amp.im * Math.sin(phase));
    im += w * (amp.re * Math.sin(phase) + amp.im * Math.cos(phase));
  }
  return { re, im };
}

/**
 * G(r) of the PDFfit2 model summed directly over every ordered pair of the
 * cell's atoms and their images (forwardModel.ts, term by term): neutron
 * weights, a diagonal U on cubic axes.
 */
function bruteG(cell: UnitCell, atoms: readonly ExpandedAtom[], grid: Float64Array, p: PdfModelParams): Float64Array {
  const L = cell.a;
  const b = atoms.map((a) => a.occupancy * neutronAmplitude(a.element).re);
  const nEff = atoms.reduce((s, a) => s + a.occupancy, 0);
  const bAvg = b.reduce((s, x) => s + x, 0) / nEff;
  const norm = 1 / (bAvg * bAvg * nEff);
  const rho0 = nEff / (L * L * L);
  const U = atoms.map((a): Vec3 => (a.adp.kind === "isotropic" ? [a.adp.bIso / (8 * Math.PI * Math.PI), a.adp.bIso / (8 * Math.PI * Math.PI), a.adp.bIso / (8 * Math.PI * Math.PI)] : [a.adp.uAniso[0], a.adp.uAniso[1], a.adp.uAniso[2]]));
  const xyz = atoms.map((a) => cart2a(L, a.position));
  const r0 = grid[0]!;
  const step = grid[1]! - grid[0]!;
  const reach = grid[grid.length - 1]! + 1;
  const m = Math.ceil(reach / L) + 1;
  const g = new Float64Array(grid.length);
  for (let i = 0; i < atoms.length; i++) {
    for (let j = 0; j < atoms.length; j++) {
      for (let t0 = -m; t0 <= m; t0++) for (let t1 = -m; t1 <= m; t1++) for (let t2 = -m; t2 <= m; t2++) {
        const d: Vec3 = [xyz[j]![0] + t0 * L - xyz[i]![0], xyz[j]![1] + t1 * L - xyz[i]![1], xyz[j]![2] + t2 * L - xyz[i]![2]];
        const r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        if (r2 <= 1e-10 || r2 > reach * reach) continue;
        const r = Math.sqrt(r2);
        const n: Vec3 = [d[0] / r, d[1] / r, d[2] / r];
        const msd = [0, 1, 2].reduce((s, k) => s + n[k]! * n[k]! * (U[i]![k]! + U[j]![k]!), 0);
        let sig2 = msd * (1 - p.delta1 / r - p.delta2 / (r * r) + p.qbroad * p.qbroad * r * r);
        if (!(sig2 > 0)) sig2 = msd;
        const sigma = Math.max(Math.sqrt(sig2), 1e-4);
        const peak = (b[i]! * b[j]! * norm) / r / (Math.sqrt(2 * Math.PI) * sigma);
        const lo = Math.max(0, Math.ceil((r - 5 * sigma - r0) / step));
        const hi = Math.min(grid.length - 1, Math.floor((r + 5 * sigma - r0) / step));
        for (let k = lo; k <= hi; k++) {
          const dr = r0 + k * step - r;
          g[k] = g[k]! + peak * Math.exp(-(dr * dr) / (2 * sigma * sigma));
        }
      }
    }
  }
  for (let k = 0; k < grid.length; k++) {
    const r = grid[k]!;
    g[k] = p.scale * (g[k]! - 4 * Math.PI * rho0 * r) * Math.exp(-0.5 * (r * p.qdamp) * (r * p.qdamp));
  }
  return g;
}

describe("supercell forward model: a tilted SrTiO₃ child against the whole supercell summed atom by atom", { timeout: 900_000 }, () => {
  for (const key of ["a-a-a-", "a0a0c-", "a0a0c+", "a-b+a-"] as const) {
    const g0 = GLAZER[key]!;
    it(`${g0.name} → #${g0.number}: |F(H)|² and G(r) agree to 1e-9`, () => {
      const { r, order, g } = childFor(g0);
      expect(r.structure.spaceGroup.number).toBe(g.number);
      const child = tiltedChild(r, g, PHI, order);
      const block = tiltedBlock(PARENT, g, PHI, order);
      const atomsChild = expandStructureAtoms(child);
      expect(atomsChild).toHaveLength(Math.round(5 * r.volumeRatio));

      // |F(H)|², superlattice reflections included.
      const Pinv = inverse3(r.basis);
      const scale = (r.volumeRatio / 8) ** 2;
      let worst = 0;
      let superlattice = 0;
      let count = 0;
      const hMax = r.volumeRatio > 4 ? 4 : 3;
      for (const radiation of ["neutron", "xray"] as const) {
        const rad = radiation === "neutron" ? { kind: "neutron" as const, wavelength: 1.5 } : ({ kind: "xray" as const, wavelength: 0.7107 } as never);
        for (let h = -hMax; h <= hMax; h++) for (let k = -hMax; k <= hMax; k++) for (let l = -hMax; l <= hMax; l++) {
          if (h === 0 && k === 0 && l === 0) continue;
          const hp = [0, 1, 2].map((j) => 2 * (Pinv[0][j]! * h + Pinv[1][j]! * k + Pinv[2][j]! * l)) as unknown as Vec3;
          const fc = nuclearStructureFactor(child, rad, h, k, l);
          const ic = fc.re * fc.re + fc.im * fc.im;
          if (hp.some((x) => Math.abs(x - Math.round(x)) > 1e-9)) {
            // Not a vector of the child's centred lattice's reciprocal (R: −h+k+l ≠ 3n): absent by centring.
            expect(ic).toBeLessThan(1e-18);
            continue;
          }
          const hInt = hp.map((x) => Math.round(x)) as unknown as Vec3;
          // The two cells index the same scattering vector.
          expect(Math.abs(dSpacing(child.cell, h, k, l) - dSpacing(block.cell, hInt[0], hInt[1], hInt[2]))).toBeLessThan(1e-9);
          const fb = bruteF(block.cell, block.atoms, hInt, radiation);
          const ib = scale * (fb.re * fb.re + fb.im * fb.im);
          const rel = Math.abs(ic - ib) / Math.max(ib, 1e-12);
          if (ib > 1e-8) worst = Math.max(worst, rel);
          else expect(ic).toBeLessThan(1e-8);
          if (hInt.some((x) => x % 2 !== 0) && ib > 1e-8) superlattice++;
          count++;
        }
      }
      expect(worst).toBeLessThan(1e-9);
      // The tilt puts intensity on the superlattice reflections.
      expect(superlattice).toBeGreaterThan(10);

      // G(r).
      const grid = makeRGrid(1.0, 12.0, 0.01);
      const params: PdfModelParams = { scatteringType: "neutron", scale: 1, qdamp: 0.04, qbroad: 0.02, delta1: 0, delta2: 1.2 };
      const engine = computeGofR(child.cell, atomsChild, grid, params);
      const brute = bruteG(block.cell, block.atoms, grid, params);
      const peak = Math.max(...Array.from(brute, Math.abs));
      let gWorst = 0;
      for (let i = 0; i < grid.length; i++) gWorst = Math.max(gWorst, Math.abs(engine[i]! - brute[i]!) / peak);
      expect(gWorst).toBeLessThan(1e-9);
      console.log(`[supercell gate] ${g.name} → ${child.spaceGroup.hermannMauguin} (#${g.number}), ${atomsChild.length} atoms: |F|² ${count} reflections (${superlattice} superlattice), worst rel ${worst.toExponential(2)}; G(r) ${grid.length} points, worst rel ${gWorst.toExponential(2)}`);
    });
  }
});

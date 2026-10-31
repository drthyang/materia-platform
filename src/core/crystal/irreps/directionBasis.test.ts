/**
 * The basis an irrep is written in (directionBasis.ts), through its
 * interface: a basis turned off its one-parameter directions is turned back,
 * one arm block or several, with the representation, its characters and its
 * isotropy subgroups unchanged; a basis that already reads cleanly is kept.
 */
import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsInBound, irrepsOfStar, type PhysicalIrrep } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups, type IsotropyAnalysis } from "@/core/crystal/irreps/isotropy";
import { alignedToDirections } from "@/core/crystal/irreps/directionBasis";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";

/** The irrep written in the orthonormal basis Q (its columns): QᵀDQ. */
function inBasis(p: PhysicalIrrep, Q: readonly (readonly number[])[]): PhysicalIrrep {
  const n = p.dim;
  const matrices = p.matrices.map((D) => {
    const out = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) s += Q[i]![a]! * D[a * n + b]! * Q[j]![b]!;
        out[i * n + j] = s;
      }
    }
    return out;
  });
  return { ...p, matrices };
}

/** Every two coordinates (one arm block, as the engine writes them) turned by θ. */
function turned(p: PhysicalIrrep, theta: number): PhysicalIrrep {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const Q = Array.from({ length: p.dim }, (_, i) => Array.from({ length: p.dim }, (__, j) => {
    if (Math.floor(i / 2) !== Math.floor(j / 2)) return 0;
    return i % 2 === 0 ? (j % 2 === 0 ? c : -s) : j % 2 === 0 ? s : c;
  }));
  return inBasis(p, Q);
}

const CLEAN_LINE = /^\((-?a|0)(,(-?a|0))*\)$/;
const oneParameter = (a: IsotropyAnalysis) => a.subgroups.filter((s) => s.direction.dim === 1);

/** True when some element of the group conjugates one subgroup onto the other. */
function conjugate(group: FactorGroup, h1: readonly number[], h2: readonly number[]): boolean {
  if (h1.length !== h2.length) return false;
  const in2 = new Uint8Array(group.elements.length);
  for (const h of h2) in2[h] = 1;
  for (let g = 0; g < group.elements.length; g++) if (h1.every((h) => in2[group.table[group.table[g]![h]!]![group.inverse[g]!]!])) return true;
  return false;
}

/** The same classes of isotropy subgroups: each of one list conjugate to one of the other, with its dimension, orientations and domains. */
function expectSameClasses(group: FactorGroup, A: IsotropyAnalysis, B: IsotropyAnalysis): void {
  expect(B.subgroups).toHaveLength(A.subgroups.length);
  const used = new Set<number>();
  for (const x of A.subgroups) {
    const j = B.subgroups.findIndex((y, k) => !used.has(k) && y.direction.dim === x.direction.dim && y.orientationStates === x.orientationStates
      && y.domainStates === x.domainStates && conjugate(group, x.elements, y.elements));
    expect(j, `${x.identity.hermannMauguin} ${x.direction.symbol}`).toBeGreaterThanOrEqual(0);
    used.add(j);
  }
}

/** The same representation (characters, D(x)D(y) = D(xy)) and the same isotropy subgroups. */
function expectSameRepresentation(group: FactorGroup, a: PhysicalIrrep, b: PhysicalIrrep, A: IsotropyAnalysis, B: IsotropyAnalysis): void {
  const n = b.dim;
  // Characters, as stored and as traces of the new matrices.
  let worst = 0;
  b.matrices.forEach((D, f) => {
    let trace = 0;
    for (let i = 0; i < n; i++) trace += D[i * n + i]!;
    worst = Math.max(worst, Math.abs(trace - a.characters[f]!), Math.abs(b.characters[f]! - a.characters[f]!));
  });
  expect(worst).toBeLessThan(1e-9);
  // D(x)D(y) = D(xy), over a spread of pairs.
  let product = 0;
  for (let x = 0; x < group.elements.length; x += 7) {
    for (let y = 0; y < group.elements.length; y += 5) {
      const xy = b.matrices[group.table[x]![y]!]!;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let k = 0; k < n; k++) s += b.matrices[x]![i * n + k]! * b.matrices[y]![k * n + j]!;
          product = Math.max(product, Math.abs(s - xy[i * n + j]!));
        }
      }
    }
  }
  expect(product).toBeLessThan(1e-9);
  expectSameClasses(group, A, B);
}

describe("the basis an irrep is written in", { timeout: 600_000 }, () => {
  it("turns a two-dimensional irrep back onto its directions: Pm-3m's R irreps after a turn of 0.3 rad read (a,0) and (0,a), as SvOC16's R3+", () => {
    const group = factorGroup(buildSpaceGroup(221).operations, DEFAULT_SUPERCELL);
    for (const p of irrepsOfStar(group, [0.5, 0.5, 0.5]).physical.filter((x) => x.dim === 2)) {
      const off = turned(p, 0.3);
      const A = isotropySubgroups(group, off);
      expect(oneParameter(A).map((s) => s.direction.symbol).join(" ")).toMatch(/\d\.\d/);
      const back = alignedToDirections(group, off);
      const B = isotropySubgroups(group, back);
      // I4/mmm and I4/mcm, on the two axes.
      expect(oneParameter(B).map((s) => `${s.direction.symbol} ${s.identity.number}`).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/^\(a,0\) 1(39|40)$/), expect.stringMatching(/^\(0,a\) 1(39|40)$/)]));
      expectSameRepresentation(group, off, back, A, B);
    }
  });

  it("turns an induced irrep back block by block: Fm-3m's eight-dimensional L irreps after every arm block is turned by 0.4 rad", () => {
    const group = factorGroup(buildSpaceGroup(225).operations, DEFAULT_SUPERCELL);
    for (const p of irrepsOfStar(group, [0.5, 0.5, 0.5]).physical.filter((x) => x.dim === 8)) {
      const off = turned(p, 0.4);
      const back = alignedToDirections(group, off);
      expect(back).not.toBe(off);
      const B = isotropySubgroups(group, back);
      const unclean = oneParameter(B).filter((s) => !CLEAN_LINE.test(s.direction.symbol));
      // Only the rhombohedral directions, spread over three arms a 3-fold permutes, keep √3/2-type coefficients.
      expect(unclean.map((s) => s.identity.number).sort()).toEqual([166, 167]);
      expectSameRepresentation(group, off, back, isotropySubgroups(group, off), B);
    }
  });

  it("leaves an irrep alone when its classes already read cleanly: every Γ irrep of Pm-3m, aligned twice", () => {
    const group = factorGroup(buildSpaceGroup(221).operations);
    for (const p of irrepsInBound(group)[0]!.physical) expect(alignedToDirections(group, p)).toBe(p);
  });
});

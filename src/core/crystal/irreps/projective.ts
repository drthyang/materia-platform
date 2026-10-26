/**
 * Projective irreducible representations of a finite group with a given
 * factor system, by deterministic induction along a solvable chain — the
 * small representations of a little co-group (spaceGroupIrreps.ts).
 *
 * Ported from spgrep (Shinohara, Togo & Tanaka, JOSS 8 (2023) 5269;
 * https://github.com/spglib/spgrep, BSD-3-Clause, © 2022 spglib), function
 * `enumerate_unitary_irreps_from_solvable_group_chain` ("Neto" method, after
 * Neto, Acta Cryst. A29 (1973) 464), with its `get_intertwiner` and `nroot`.
 * The algorithm is spgrep's; the code is a TypeScript rewrite. Differences:
 * the chain is MATERIA's own (chain.ts), and the intertwiner is built from
 * the matrix units E_ab in a fixed order instead of a seeded random matrix,
 * so the result is the same on every run and platform.
 *
 * For each step H ◁ G = ⟨H, r⟩ with r of order p = [G : H], every irrep Δ of
 * H is conjugated by the powers of r, Δ⁽ʲ⁾(s) = μ(s, rʲ)/μ(rʲ, sⱼ)·Δ(sⱼ) with
 * sⱼ = r⁻ʲ s rʲ. If Δ⁽⁰⁾ and Δ⁽¹⁾ are inequivalent, Δ induces one irrep of G
 * of dimension p·dim Δ (block-monomial); if they are equivalent, an
 * intertwiner U scaled so that Uᵖ = 1 extends Δ in p ways, D(r) = U/ω_q.
 * Duplicates (equal characters) are dropped after each step.
 */

import type { Complex } from "@/core/math/types";
import {
  cadd, cadjoint, cdet, cdivC, cget, cidentity, cmaxAbs, cmul, cmulC, cpow, cscale, csetBlock, csnap, ctrace, czeros, nroot, type CMat,
} from "@/core/crystal/irreps/complexMatrix";

const ONE: Complex = { re: 1, im: 0 };

/** True when two (projective) irreps of a group of the given order have equal characters. */
export function equivalentCharacters(a: readonly Complex[], b: readonly Complex[], order: number): boolean {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    // Σ conj(χa)·χb
    re += a[i]!.re * b[i]!.re + a[i]!.im * b[i]!.im;
    im += a[i]!.re * b[i]!.im - a[i]!.im * b[i]!.re;
  }
  return Math.round(re) === order && Math.abs(im) < 0.5;
}

/**
 * A nonzero intertwiner U with rep1(s)·U = U·rep2(s) for all s (both unitary
 * irreps of one group, equivalent), scaled to determinant 1.
 */
function intertwiner(rep1: readonly CMat[], rep2: readonly CMat[]): CMat {
  const dim = rep1[0]!.n;
  let best: CMat | null = null;
  let bestNorm = 0;
  for (let a = 0; a < dim && bestNorm < 0.5; a++) {
    for (let b = 0; b < dim && bestNorm < 0.5; b++) {
      // U = Σ_s rep1(s) E_ab rep2(s)†
      let u = czeros(dim);
      for (let s = 0; s < rep1.length; s++) {
        const x = czeros(dim);
        x.re[a * dim + b] = 1;
        u = cadd(u, cmul(cmul(rep1[s]!, x), cadjoint(rep2[s]!)));
      }
      const norm = cmaxAbs(u) / rep1.length;
      if (norm > bestNorm) {
        best = u;
        bestNorm = norm;
      }
    }
  }
  if (!best || bestNorm < 1e-8) throw new Error("projective irreps: no intertwiner between equivalent irreps");
  return cscale(best, cdivC(ONE, cpow(cdet(best), 1 / dim)));
}

const characters = (rep: readonly CMat[]): Complex[] => rep.map(ctrace);

/**
 * All projective irreps of a finite group with factor system μ
 * (D(a)D(b) = μ[a][b]·D(ab)), by induction along `chain` (generators bottom
 * first: H₀ = {e}, Hᵢ = ⟨Hᵢ₋₁, chain[i−1]⟩). `table[a][b]` is the index of
 * ab. Each irrep is a list of matrices indexed like the table. Throws if the
 * chain does not reach the whole group.
 */
export function projectiveIrreps(table: readonly (readonly number[])[], mu: readonly (readonly Complex[])[], chain: readonly number[]): CMat[][] {
  const order = table.length;
  const identity = table.findIndex((row) => row.every((x, j) => x === j));
  if (identity < 0) throw new Error("projective irreps: the table has no identity");
  const inverse = (x: number): number => table[x]!.findIndex((y) => y === identity);

  let group: number[] = [identity];
  // An irrep is stored as a map from group element to matrix.
  let irreps: Map<number, CMat>[] = [new Map([[identity, cidentity(1)]])];

  for (const r of chain) {
    // p = the order of r.
    let p = 1;
    for (let x = r; x !== identity; x = table[x]![r]!) p++;
    const rm: number[] = [identity];
    const rinvm: number[] = [identity];
    const rinv = inverse(r);
    for (let m = 1; m < p; m++) {
      rm.push(table[rm[m - 1]!]![r]!);
      rinvm.push(table[rinvm[m - 1]!]![rinv]!);
    }
    const subgroup = group;
    group = [...new Set(rm.flatMap((x) => subgroup.map((s) => table[x]![s]!)))].sort((a, b) => a - b);
    if (group.length !== p * subgroup.length) throw new Error("projective irreps: a chain step is not a split extension of its order");

    const next: Map<number, CMat>[] = [];
    for (const sub of irreps) {
      const dim = sub.get(identity)!.n;
      // The conjugates of `sub` by r^j.
      const conj: CMat[][] = [];
      for (let j = 0; j < Math.min(p, 2); j++) {
        conj.push(subgroup.map((s) => {
          const sj = table[rinvm[j]!]![table[s]![rm[j]!]!]!;
          return cscale(sub.get(sj)!, cdivC(mu[s]![rm[j]!]!, mu[rm[j]!]![sj]!));
        }));
      }
      if (equivalentCharacters(characters(conj[0]!), characters(conj[1]!), subgroup.length)) {
        // Self-conjugate: p extensions, D(r) = U/ω_q with Uᵖ = 1.
        let U = intertwiner(conj[0]!, conj[1]!);
        let power = U;
        for (let m = 1; m < p; m++) power = cmul(U, power);
        U = cscale(U, cdivC(ONE, cpow(cget(power, 0, 0), 1 / p)));
        let prod: Complex = ONE;
        for (let m = 1; m < p; m++) prod = cmulC(prod, mu[r]![rm[m]!]!);
        const omega = cdivC(ONE, nroot(prod, p));
        for (let q = 0; q < p; q++) {
          const omegaQ = cmulC(omega, { re: Math.cos((2 * Math.PI * q) / p), im: Math.sin((2 * Math.PI * q) / p) });
          const deltaR = cscale(U, cdivC(ONE, omegaQ));
          const deltaRm: CMat[] = [cidentity(dim)];
          for (let m = 1; m < p; m++) deltaRm.push(cscale(cmul(deltaR, deltaRm[m - 1]!), cdivC(ONE, mu[r]![rm[m - 1]!]!)));
          const irrep = new Map<number, CMat>();
          for (let m = 0; m < p; m++) {
            for (const s of subgroup) {
              irrep.set(table[rm[m]!]![s]!, cscale(cmul(deltaRm[m]!, sub.get(s)!), cdivC(ONE, mu[rm[m]!]![s]!)));
            }
          }
          next.push(irrep);
        }
      } else {
        // Inequivalent conjugates: one induced irrep of dimension p·dim.
        const irrep = new Map<number, CMat>();
        for (let m = 0; m < p; m++) {
          for (const s of subgroup) {
            const idx = table[rm[m]!]![s]!;
            const D = czeros(dim * p);
            for (let j = 0; j < p; j++) {
              const i = (j + m) % p;
              const sj = table[rinvm[j]!]![table[s]![rm[j]!]!]!;
              csetBlock(D, i * dim, j * dim, cscale(sub.get(sj)!, cdivC(mu[idx]![rm[j]!]!, mu[rm[i]!]![sj]!)));
            }
            irrep.set(idx, D);
          }
        }
        next.push(irrep);
      }
    }
    // Keep one irrep per character.
    irreps = [];
    const seen: Complex[][] = [];
    for (const irrep of next) {
      const chi = group.map((g) => ctrace(irrep.get(g)!));
      if (seen.some((c) => equivalentCharacters(c, chi, group.length))) continue;
      irreps.push(irrep);
      seen.push(chi);
    }
  }
  if (group.length !== order) throw new Error("projective irreps: the chain does not generate the group");
  return irreps.map((irrep) => Array.from({ length: order }, (_, g) => csnap(irrep.get(g)!)));
}

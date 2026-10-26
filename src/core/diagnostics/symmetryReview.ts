/**
 * The symmetry review: the LAST step of a Rietveld refinement, never the first.
 *
 * A structure is refined to the best its space group allows — profile, atoms,
 * ADPs, corrections — before the group itself is questioned. Intensity that
 * differs on the group's own reflections is what refinement fixes, not
 * evidence against the group, and absence "violations" seen before the
 * structure is refined (the Le Bail cell check) are often profile or
 * intensity misfit. Only when the refined model still leaves intensity at
 * reflections the group forbids does the data ask for a lower symmetry.
 *
 * So this reads the REFINED residual (observed − calculated, each point's σ):
 *  - the residual peaks that sit on no allowed reflection of any phase but on a
 *    forbidden one of the primary phase are the observed forbidden
 *    reflections; a forbidden reflection within 2 % in d of an allowed one
 *    cannot be told apart from that one's misfit (untestable);
 *  - each observed forbidden reflection is checked against the group's
 *    translationengleiche subgroups (same lattice, lost rotations — the glides
 *    and screws whose loss lifts an absence), and the subgroups that allow
 *    them are listed, those allowing the most of them first and then the
 *    smallest index.
 *
 *  - a centred group's klassengleiche subgroups that drop a centring vector
 *    (index 2; 4 from F to P; 3 from R) are listed the same way: a lost
 *    centring (an ordered arrangement on what the model averages as one
 *    site, CsCl read as body-centred) shows as intensity at the reflections
 *    the centring forbids, which no subgroup of the same lattice allows.
 *
 * Limits, stated in the result: a larger cell is not enumerated (it shows as
 * unexplained peaks between every reflection). The review proposes; the user
 * decides, and a lower group means a new model (its CIF, with the sites a lost
 * centring splits), refined again from the start of the method.
 */

import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import { generateReflections } from "@/core/diffraction/reflections";
import { isReflectionAbsent } from "@/core/crystal/symmetry";
import { structuralSubgroupLattice, subgroupClassRepresentatives } from "@/core/crystal/subgroupTree";
import { identifySubgroup } from "@/core/crystal/isotropyTree";
import { residualPeaks, type AssessmentInput } from "@/core/diagnostics/assessment";
import { FORBIDDEN_OVERLAP } from "@/core/diagnostics/thresholds";
import { minMax } from "@/core/math/extent";

/** A residual peak within this of a forbidden reflection (relative d) is that reflection. */
const ON_FORBIDDEN = 0.005;
/** A forbidden reflection this close to an allowed one (relative d) cannot be tested. */
const OVERLAP = FORBIDDEN_OVERLAP;
/** Subgroups enumerated, by index in the parent. */
const MAX_INDEX = 6;
/** Translations equal to this (mod 1) are one. */
const EPS = 1e-6;

export interface ObservedForbidden {
  readonly hkl: string;
  readonly d: number;
  /** The residual peak's height, in the data's counts. */
  readonly height: number;
  /** The residual peak's height over its own σ. */
  readonly sigmas: number | undefined;
}

export interface SubgroupCandidate {
  /** H-M symbol (and IT number) when identified, else the point group. */
  readonly name: string;
  readonly number?: number;
  /** [G : H]. */
  readonly index: number;
  /**
   * The number of conjugate subgroups, [G : N_G(H)] — the orientations, not
   * the domain states [G : H] (= `index` for these subgroups of the same
   * lattice). The name is frozen with the tool's output (see reviewSymmetry).
   */
  readonly domains: number;
  /** The observed forbidden reflections this subgroup allows. */
  readonly allows: readonly string[];
}

export interface SymmetryReview {
  readonly observedForbidden: readonly ObservedForbidden[];
  readonly tested: number;
  readonly untestable: number;
  /** Subgroups allowing every observed forbidden reflection, then those allowing some. */
  readonly candidates: readonly SubgroupCandidate[];
  /**
   * The klassengleiche subgroups that drop a centring vector (index 2; 4
   * from F to P; 3 from R), ordered as the candidates are: a lost centring
   * (an ordered arrangement on what the model averages as one site) shows as
   * intensity at the reflections the centring forbids.
   */
  readonly decentred: readonly (SubgroupCandidate & { readonly lost: string })[];
  readonly reading: string;
  readonly limits: readonly string[];
}

const hklOf = (r: { h: number; k: number; l: number }): string => `${r.h} ${r.k} ${r.l}`;

/**
 * A subgroup's full operation list: its coset representatives with the
 * parent's pure translations (a centred lattice's), which a t-subgroup keeps.
 */
function withCentring(subOps: readonly SymmetryOperation[], parentOps: readonly SymmetryOperation[]): SymmetryOperation[] {
  const isIdentity = (op: SymmetryOperation): boolean => op.rotation.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9));
  const centring = parentOps.filter(isIdentity).map((op) => op.translation);
  if (centring.length <= 1) return [...subOps];
  return subOps.flatMap((op) => centring.map((c) => ({ ...op, translation: [op.translation[0] + c[0], op.translation[1] + c[1], op.translation[2] + c[2]] as [number, number, number] })));
}

type Op = SymmetryOperation;
const frac = (v: number): number => {
  const f = v - Math.floor(v);
  return f > 1 - EPS ? 0 : f < EPS ? 0 : f;
};
const opKey = (op: Op): string => `${op.rotation.flat().map((v) => Math.round(v)).join(",")}|${op.translation.map((t) => frac(t).toFixed(5)).join(",")}`;
const rotKey = (op: Op): string => op.rotation.flat().map((v) => Math.round(v)).join(",");
const isIdentityRotation = (op: Op): boolean => op.rotation.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9));
function compose(a: Op, b: Op): Op {
  const R = a.rotation.map((row) => [0, 1, 2].map((j) => row[0]! * b.rotation[0]![j]! + row[1]! * b.rotation[1]![j]! + row[2]! * b.rotation[2]![j]!)) as unknown as Op["rotation"];
  const t = a.rotation.map((row, i) => frac(row[0]! * b.translation[0] + row[1]! * b.translation[1] + row[2]! * b.translation[2] + a.translation[i]!)) as [number, number, number];
  return { ...a, rotation: R, translation: t };
}

/** The group the operations generate (mod 1), up to `limit` operations; null beyond it. */
function closure(generators: readonly Op[], limit: number): Op[] | null {
  const out = new Map<string, Op>();
  const queue: Op[] = [];
  const add = (op: Op): void => {
    const key = opKey(op);
    if (!out.has(key)) {
      out.set(key, op);
      queue.push(op);
    }
  };
  for (const g of generators) add(g);
  while (queue.length > 0) {
    const a = queue.shift()!;
    for (const g of generators) {
      add(compose(a, g));
      if (out.size > limit) return null;
    }
  }
  return [...out.values()];
}

const centringName = (c: readonly number[]): string => `(${c.map((v) => (Math.abs(v - 0.5) < EPS ? "½" : Math.abs(v - 1 / 3) < EPS ? "⅓" : Math.abs(v - 2 / 3) < EPS ? "⅔" : v.toFixed(0))).join(" ")})`;

/**
 * The klassengleiche subgroups of a centred group that keep every rotation
 * and drop centring vectors: for each sub-centring (the identity alone, or
 * one of F's face vectors), each generator's translation chosen among its
 * centring coset, closed, and kept when the closure holds that sub-centring
 * exactly. Distinct operation sets, each with the vectors it lost.
 */
export function decentredSubgroups(parentOps: readonly SymmetryOperation[]): { readonly ops: SymmetryOperation[]; readonly index: number; readonly lost: string }[] {
  const centring = parentOps.filter(isIdentityRotation).map((op) => op.translation.map(frac) as [number, number, number]);
  if (centring.length <= 1) return [];
  const byRotation = new Map<string, Op[]>();
  for (const op of parentOps) {
    const key = rotKey(op);
    const list = byRotation.get(key) ?? [];
    list.push({ ...op, translation: op.translation.map(frac) as [number, number, number] });
    byRotation.set(key, list);
  }
  // A generating set of the point group, greedily.
  const reps = [...byRotation.values()].map((ops) => ops[0]!);
  const generators: Op[] = [];
  const rotationsOf = (gens: readonly Op[]): number => new Set((closure(gens.map((g) => ({ ...g, translation: [0, 0, 0] as [number, number, number] })), 200) ?? []).map(rotKey)).size;
  for (const r of reps) if (!isIdentityRotation(r) && rotationsOf([...generators, r]) > rotationsOf(generators)) generators.push(r);
  // The sub-centrings: the identity alone, and with four vectors (F) each face pair.
  const zero: [number, number, number] = [0, 0, 0];
  const nonzero = centring.filter((c) => c.some((v) => v > EPS));
  const subs: [number, number, number][][] = [[zero], ...(centring.length === 4 ? nonzero.map((c) => [zero, c]) : [])];
  const out: { ops: SymmetryOperation[]; index: number; lost: string }[] = [];
  const seen = new Set<string>();
  for (const sub of subs) {
    const index = centring.length / sub.length;
    const target = parentOps.length / index;
    const lost = nonzero.filter((c) => !sub.some((v) => v.every((x, i) => Math.abs(x - c[i]!) < EPS))).map(centringName).join(", ");
    const pure = sub.filter((c) => c.some((v) => v > EPS)).map((c): Op => ({ ...parentOps[0]!, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as unknown as Op["rotation"], translation: c }));
    // Each generator's translation chosen among its coset (the centring's translates of one).
    const choices = generators.map((g) => byRotation.get(rotKey(g))!);
    const pick = (i: number, chosen: Op[]): void => {
      if (i === choices.length) {
        const group = closure([...chosen, ...pure], target);
        if (!group || group.length !== target) return;
        const translations = group.filter(isIdentityRotation);
        if (translations.length !== sub.length) return;
        const key = group.map(opKey).sort().join(";");
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ ops: group, index, lost });
        return;
      }
      for (const op of choices[i]!) pick(i + 1, [...chosen, op]);
    };
    pick(0, []);
  }
  return out;
}

export function reviewSymmetry(
  phases: readonly StructureModel[],
  residual: NonNullable<AssessmentInput["residual"]>,
): SymmetryReview {
  const primary = phases[0];
  if (!primary) throw new Error("no phase to review");
  const ds = residual.d.filter((d) => Number.isFinite(d) && d > 0);
  const { min: dMin, max: dMax } = minMax(ds);
  const allowed = residual.reflections ?? [];
  const allowedKeys = new Set(generateReflections(primary.cell, primary.spaceGroup, dMin, dMax).map(hklOf));
  const forbidden = generateReflections(primary.cell, primary.spaceGroup, dMin, dMax, { absences: false }).filter((r) => !allowedKeys.has(hklOf(r)));
  const nearAllowed = (d: number): boolean => allowed.some((r) => Math.abs(r.d / d - 1) <= OVERLAP);
  const testable = forbidden.filter((f) => !nearAllowed(f.d));
  const { between } = residualPeaks(residual);
  const observed: ObservedForbidden[] = [];
  for (const f of testable) {
    const peak = between.find((p) => Math.abs(p.d / f.d - 1) <= ON_FORBIDDEN);
    if (peak && !observed.some((o) => o.hkl === hklOf(f))) observed.push({ hkl: hklOf(f), d: f.d, height: peak.height, sigmas: peak.significance });
  }
  const limits = [
    `Subgroups of the same lattice up to index ${MAX_INDEX} in the parent, and the subgroups that drop a centring vector; a larger cell is not enumerated.`,
    "A forbidden reflection within 2% in d of an allowed one is untestable: its intensity cannot be told from that reflection's misfit.",
  ];
  if (observed.length === 0) {
    return {
      observedForbidden: [], tested: testable.length, untestable: forbidden.length - testable.length, candidates: [], decentred: [], limits,
      reading: `No forbidden reflection of ${primary.name || "the phase"} carries intensity in the refined fit (${testable.length} tested). Nothing in the data asks for a lower symmetry: if the fit is still poor, look at the profile, the background, a missing phase or the model's chemistry, not the space group.`,
    };
  }
  const lattice = structuralSubgroupLattice(primary, { maxIndex: MAX_INDEX });
  const parentOps = primary.spaceGroup.operations;
  const candidates: SubgroupCandidate[] = subgroupClassRepresentatives(lattice)
    .filter((n) => !n.isParent && !n.isTrivial)
    .map((n) => {
      const ops = withCentring(n.cosetOperations, parentOps);
      const allows = observed.filter((o) => {
        const [h, k, l] = o.hkl.split(" ").map(Number) as [number, number, number];
        return !isReflectionAbsent(ops, h, k, l);
      }).map((o) => o.hkl);
      return { n, ops, allows };
    })
    .filter((c) => c.allows.length > 0)
    .map(({ n, ops, allows }): SubgroupCandidate => {
      // VALIDATION FREEZE (docs/AGENT_PLAN.md): this tool's output is frozen,
      // so its names are still found as they were: from the coset
      // representatives alone when those match a table entry, which reads a
      // centred parent's subgroup as primitive (Fm-3m's 4/mmm subgroup as
      // P4/mmm, #123), else on the full centred set. `n.identity` is the
      // correct standard name (I4/mmm, #139), which the PDF Subgroups page
      // shows; use it here once the freeze lifts. `domains` is the number of
      // conjugate subgroups, [G : N_G(H)] (`n.domainStates` is [G : H]).
      const legacy = identifySubgroup(n.cosetOperations, parentOps);
      const id = legacy.number !== undefined ? legacy : identifySubgroup(ops, parentOps, { originShifts: true });
      const name = id.hermannMauguin ?? `${legacy.pointGroup ?? "?"} (point group; index ${n.index})`;
      return { name, ...(id.number !== undefined ? { number: id.number } : {}), index: n.index, domains: n.conjugates, allows };
    });
  const ordered = orderCandidates(candidates, observed.length);
  const all = ordered.filter((c) => c.allows.length === observed.length);
  // The subgroups that drop a centring vector, one per type (its conjugates counted as domains).
  const byName = new Map<string, SubgroupCandidate & { lost: string }>();
  for (const h of decentredSubgroups(parentOps)) {
    const allows = observed.filter((o) => {
      const [hh, kk, ll] = o.hkl.split(" ").map(Number) as [number, number, number];
      return !isReflectionAbsent(h.ops, hh, kk, ll);
    }).map((o) => o.hkl);
    if (allows.length === 0) continue;
    const id = identifySubgroup(h.ops, parentOps, { originShifts: true });
    const name = id.hermannMauguin ?? `a primitive subgroup (index ${h.index})`;
    const known = byName.get(name);
    if (known) byName.set(name, { ...known, domains: known.domains + 1 });
    else byName.set(name, { name, ...(id.number !== undefined ? { number: id.number } : {}), index: h.index, domains: 1, allows, lost: h.lost });
  }
  const decentred = orderCandidates([...byName.values()], observed.length) as (SubgroupCandidate & { lost: string })[];
  const decentredAll = decentred.filter((c) => c.allows.length === observed.length);
  const lostText = (c: { lost: string; index: number }): string => `the centring ${c.lost} dropped, index ${c.index}`;
  const decentredLine = decentredAll.length > 0
    ? `${decentredAll.length === 1 ? "A subgroup" : `${decentredAll.length} subgroups`} without the centring allow${decentredAll.length === 1 ? "s" : ""} ${observed.length === 1 ? "it" : "them all"} too: ${decentredAll.slice(0, 4).map((c) => `${c.name} (${lostText(c)})`).join(", ")}. A lost centring is an order the model averages: its model splits the sites the centring made one, which is the user's to build.`
    : "";
  const list = observed.map((o) => `${o.hkl} (d ${o.d.toFixed(4)} Å)`).join(", ");
  const reading = all.length > 0
    ? `The refined fit leaves intensity at ${observed.length} reflection${observed.length === 1 ? "" : "s"} ${primary.spaceGroup.hermannMauguin ?? "the group"} forbids: ${list}. ${all.length} subgroup${all.length === 1 ? "" : "s"} of the same lattice allow${all.length === 1 ? "s" : ""} ${observed.length === 1 ? "it" : "them all"}, smallest index first.${decentredLine ? ` ${decentredLine}` : ""} Put this to the user: a lower symmetry is a new model, refined again from the start, and is justified only if it fits these reflections without the misfit moving elsewhere.`
    : decentredAll.length > 0
      ? `The refined fit leaves intensity at ${observed.length} reflection${observed.length === 1 ? "" : "s"} ${primary.spaceGroup.hermannMauguin ?? "the group"} forbids (${list}), which no subgroup of the same lattice up to index ${MAX_INDEX} allows${candidates.length ? " (some allow part: listed)" : ""}, and a lost centring explains: ${decentredAll.slice(0, 4).map((c) => `${c.name} (${lostText(c)})`).join(", ")} allow${decentredAll.length === 1 ? "s" : ""} ${observed.length === 1 ? "it" : "them all"}. Its model orders what this one averages (the sites the centring made one split between its positions): building it is the user's step. Put it to the user, with a second phase whose lines fall there as the other reading (find_unexplained_peaks).`
      : `The refined fit leaves intensity at ${observed.length} forbidden reflection${observed.length === 1 ? "" : "s"} (${list}), but no subgroup of the same lattice up to index ${MAX_INDEX} and none without a centring vector allows ${observed.length === 1 ? "it" : "them all"}${candidates.length + decentred.length ? " (some allow part: listed)" : ""}. A larger cell, or a second phase whose lines fall there, is likelier; check find_unexplained_peaks and ask the user.`;
  return { observedForbidden: observed, tested: testable.length, untestable: forbidden.length - testable.length, candidates: ordered.slice(0, 8), decentred: decentred.slice(0, 8), reading, limits };
}

/**
 * The candidates as the review lists them: those that allow every observed
 * forbidden reflection first, then those that allow some, each smallest index
 * first (the smallest step down from the group; more domains come with a
 * larger index). Among equal indices, the one allowing more comes first.
 */
export function orderCandidates(candidates: readonly SubgroupCandidate[], observed: number): SubgroupCandidate[] {
  const allowsAll = (c: SubgroupCandidate): number => (c.allows.length === observed ? 0 : 1);
  return [...candidates].sort((a, b) => allowsAll(a) - allowsAll(b) || a.index - b.index || b.allows.length - a.allows.length);
}

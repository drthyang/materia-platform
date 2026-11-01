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
 *    smallest index. A subgroup allows a powder line when it allows any
 *    reflection of the line's family, so the orientation listed does not
 *    matter.
 *
 * The subgroups come from the subgroup engine (`sameCellSubgroups` on G
 * modulo the conventional cell; ADR 0001), one per conjugacy class, named in
 * ITA standard setting with the child basis from the parent's cell
 * (`nameChild`; ADR 0003), as the PDF Subgroups page names them.
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
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { sameCellSubgroups, type SameCellSubgroup } from "@/core/crystal/irreps/sameCellLattice";
import { nameChild } from "@/core/crystal/irreps/childSetting";
import { describeTransformation } from "@/core/magnetic/bnsOg";
import type { Vec3 } from "@/core/math/types";
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
  /**
   * The child basis (P_H, p_H) of the standard setting the name holds in,
   * from the parent's cell, as "(a′, b′, c′; origin)" in parent axes, e.g.
   * "(c, a, b; 0, 0, 0)"; absent when the name holds in the parent's cell as
   * it stands.
   */
  readonly setting?: string;
  /** [G : H]. */
  readonly index: number;
  /**
   * The number of conjugate subgroups, [G : N_G(H)] — the orientations, not
   * the domain states [G : H] (= `index` for these subgroups of the same
   * lattice).
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

/** Translations equal to this (mod 1) are one. */
const frac = (v: number): number => {
  const f = v - Math.floor(v);
  return f > 1 - EPS ? 0 : f < EPS ? 0 : f;
};
const isIdentityRotation = (op: SymmetryOperation): boolean => op.rotation.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9));

const centringName = (c: readonly number[]): string => `(${c.map((v) => (Math.abs(v - 0.5) < EPS ? "½" : Math.abs(v - 1 / 3) < EPS ? "⅓" : Math.abs(v - 2 / 3) < EPS ? "⅔" : v.toFixed(0))).join(" ")})`;

/**
 * The reflections of one powder family of the parent: hkl and its images
 * under the parent's rotations (h·R), and their Friedel mates. A subgroup
 * allows a powder line when it allows any of them: its domains take every
 * orientation, so which conjugate of the subgroup is listed does not matter.
 */
function familyOf(parentOps: readonly SymmetryOperation[], hkl: readonly [number, number, number]): [number, number, number][] {
  const out = new Map<string, [number, number, number]>();
  for (const op of parentOps) {
    const R = op.rotation;
    const h: [number, number, number] = [0, 1, 2].map((j) => hkl[0] * R[0]![j]! + hkl[1] * R[1]![j]! + hkl[2] * R[2]![j]!) as [number, number, number];
    for (const v of [h, h.map((x) => -x) as [number, number, number]]) out.set(v.join(" "), v);
  }
  return [...out.values()];
}

/**
 * The subgroups the review lists, from the subgroup engine (ADR 0001;
 * `sameCellSubgroups` on G modulo the conventional cell): one per conjugacy
 * class, named in ITA standard setting (`nameChild`), with the operations
 * the class's representative has in the parent's cell, centring kept or lost.
 * `t` is the translationengleiche classes (every translation kept), `k` the
 * classes that keep every rotation and drop a centring vector.
 */
function reviewSubgroups(parentOps: readonly SymmetryOperation[]): { readonly kind: "t" | "k"; readonly sub: SameCellSubgroup; readonly name: string; readonly number?: number; readonly setting?: string; readonly index: number }[] {
  const group = factorGroup(parentOps);
  return sameCellSubgroups(group, { maxIndex: MAX_INDEX })
    .filter((s) => s.classRepresentative && (s.kind === "t" || s.kind === "k"))
    // The group of the lattice translations alone (P1, or its centred cell) allows everything a lower group can; it is not a candidate.
    .filter((s) => s.operations.some((op) => !isIdentityRotation(op)))
    .map((sub) => {
      const id = nameChild(group, sub.elements);
      const index = sub.index.t * sub.index.k;
      const name = id.hermannMauguin ?? (sub.kind === "t" ? `${id.pointGroup ?? "?"} (point group; index ${index})` : `a primitive subgroup (index ${index})`);
      const setting = id.number !== undefined && id.basis ? describeTransformation(id.basis, (id.originShift ?? [0, 0, 0]) as unknown as Vec3) : undefined;
      return { kind: sub.kind as "t" | "k", sub, name, ...(id.number !== undefined ? { number: id.number } : {}), ...(setting ? { setting } : {}), index };
    });
}

/** The parent's centring vectors a k-subgroup has dropped, written as the review writes them. */
function lostCentring(parentOps: readonly SymmetryOperation[], ops: readonly SymmetryOperation[]): string {
  const vectors = (list: readonly SymmetryOperation[]): number[][] => list.filter(isIdentityRotation).map((op) => op.translation.map(frac)).filter((c) => c.some((v) => v > EPS));
  const kept = vectors(ops);
  return vectors(parentOps).filter((c) => !kept.some((v) => v.every((x, i) => Math.abs(x - c[i]!) < EPS))).map(centringName).join(", ");
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
  const parentOps = primary.spaceGroup.operations;
  // A subgroup allows an observed line when it allows any reflection of the line's family (familyOf).
  const allowedBy = (ops: readonly SymmetryOperation[]): string[] =>
    observed.filter((o) => familyOf(parentOps, o.hkl.split(" ").map(Number) as [number, number, number]).some(([h, k, l]) => !isReflectionAbsent(ops, h, k, l))).map((o) => o.hkl);
  const subgroups = reviewSubgroups(parentOps);
  // `domains` is the number of conjugate subgroups, [G : N_G(H)] (the orientations; the domain states are [G : H]).
  const candidates: SubgroupCandidate[] = subgroups
    .filter((c) => c.kind === "t")
    .map((c) => ({ c, allows: allowedBy(c.sub.operations) }))
    .filter(({ allows }) => allows.length > 0)
    .map(({ c, allows }): SubgroupCandidate => ({ name: c.name, ...(c.number !== undefined ? { number: c.number } : {}), ...(c.setting ? { setting: c.setting } : {}), index: c.index, domains: c.sub.conjugates, allows }));
  const ordered = orderCandidates(candidates, observed.length);
  const all = ordered.filter((c) => c.allows.length === observed.length);
  // The subgroups that drop a centring vector, one per conjugacy class (its conjugates are its domains).
  const decentredAll0 = subgroups
    .filter((c) => c.kind === "k")
    .map((c) => ({ c, allows: allowedBy(c.sub.operations) }))
    .filter(({ allows }) => allows.length > 0)
    .map(({ c, allows }): SubgroupCandidate & { lost: string } => ({ name: c.name, ...(c.number !== undefined ? { number: c.number } : {}), ...(c.setting ? { setting: c.setting } : {}), index: c.index, domains: c.sub.conjugates, allows, lost: lostCentring(parentOps, c.sub.operations) }));
  const decentred = orderCandidates(decentredAll0, observed.length) as (SubgroupCandidate & { lost: string })[];
  const decentredAll = decentred.filter((c) => c.allows.length === observed.length);
  const lostText = (c: { lost: string; index: number; setting?: string }): string => `${c.setting ? `setting ${c.setting}; ` : ""}the centring ${c.lost} dropped, index ${c.index}`;
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

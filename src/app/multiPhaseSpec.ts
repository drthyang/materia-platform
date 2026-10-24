/**
 * Build a multi-phase powder refinement spec from several structures sharing one
 * instrument. Each phase contributes its own scale, cell, atoms, and (optional)
 * sample microstructure; the instrument profile, background, zero, and TOF
 * calibration are **shared** across phases (one beam, one detector). Wraps the
 * single-phase {@link buildPowderSpec} per phase and merges: per-phase parameter
 * ids are prefixed `p{i}_`, every pattern-targeted per-phase binding (scale,
 * anisotropic microstructure, per-phase corrections) is re-bound to that phase's
 * id, and the shared instrument rows are kept once (from the first phase).
 *
 * The result feeds `buildMultiPhasePowderProblem` / `multiPhaseCurves`. Validated
 * on the Mn₃Ga + MnO POWGEN data: single-phase wR ≈ 36% → two-phase ≈ 8.5%.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { BackgroundType } from "@/core/diffraction/background";
import { isMagneticModelParameterKind, type ParameterBinding, type ParameterKind, type RefinementParameter } from "@/core/refinement/types";
import type { PowderProfile } from "@/core/workflow/powder";
import type { PowderPhase } from "@/core/workflow/multiPhase";
import { buildPowderSpec, type SiteTies, type MustrainModel, type SampleCorrections } from "@/app/powderSpec";
import { SHARED_CORRECTION_KINDS } from "@/core/diffraction/corrections";
import { isUserTie, renamedTie, tieReferences } from "@/core/refinement/constraints";

/** Instrument rows shared across phases (one beam illuminates every phase). The
 *  isotropic size/strain (profileX/Y, tofProfile, isotropic TOF Mustrain) is
 *  shared too — matching multiPhase.ts; only anisotropic microstructure is per-phase. */
const SHARED_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>([
  "peakWidth", "background", "zeroShift", "profileU", "profileV", "profileW",
  "profileX", "profileY", "asymSL", "asymHL", "tofCalibration", "tofProfile", "mustrainIso",
  // Sample-geometry corrections that are one-per-sample (registry-declared shared).
  ...SHARED_CORRECTION_KINDS,
]);

export interface MultiPhaseSpec {
  readonly phases: PowderPhase[];
  readonly params: RefinementParameter[];
  readonly bindings: ParameterBinding[];
  readonly profile: PowderProfile;
}

export function buildMultiPhaseSpec(
  structures: readonly StructureModel[],
  pattern: PowderPattern,
  instrument: InstrumentParameters,
  backgroundTerms = 6,
  ties: SiteTies = {},
  mustrain: MustrainModel = "isotropic",
  corrections?: SampleCorrections,
  /** The shared background's basis (seeds and profile), as buildPowderSpec's. */
  backgroundType?: BackgroundType,
): MultiPhaseSpec {
  const params: RefinementParameter[] = [];
  const bindings: ParameterBinding[] = [];
  let profile: PowderProfile | undefined;
  structures.forEach((structure, i) => {
    // Preferred orientation is the primary phase's (a per-phase ratio; the
    // axis is given in its lattice); the sample corrections are shared.
    const own = i === 0 || !corrections ? corrections : (({ preferredOrientation: _po, ...shared }) => shared)(corrections);
    const spec = buildPowderSpec(structure, pattern, instrument, true, backgroundTerms, ties, mustrain, own, backgroundType);
    if (i === 0) profile = spec.profile;
    for (const p of spec.params) {
      if (SHARED_KINDS.has(p.kind)) { if (i === 0) params.push(p); continue; }
      params.push({ ...p, id: `p${i}_${p.id}`, label: `${structure.name}: ${p.label}` });
    }
    for (const b of spec.bindings) {
      if (SHARED_KINDS.has(b.kind)) { if (i === 0) bindings.push(b); continue; }
      // Per-phase: prefix the param id; re-bind anything targeting the pattern
      // (scale, Stephens strain, uniaxial size/mustrain, per-phase corrections)
      // to this phase's id so phaseBindingsFor routes it to just this phase —
      // a pattern-targeted non-shared binding would otherwise be dropped for
      // every phase and the parameter would silently have no effect.
      bindings.push({
        ...b,
        parameterId: `p${i}_${b.parameterId}`,
        ...(b.targetId === pattern.id ? { targetId: structure.id } : {}),
      });
    }
  });
  return {
    phases: structures.map((s) => ({ structure: s, id: s.id })),
    params,
    bindings,
    profile: profile ?? { shape: "gaussian" },
  };
}

/** A row of one phase (its scale, cell, atoms, …), which the spec prefixes `p{i}_` on several phases; the shared instrument rows and the magnetic model's are not. */
const phaseOwn = (p: RefinementParameter): boolean => !SHARED_KINDS.has(p.kind) && !isMagneticModelParameterKind(p.kind);

/**
 * Rows built for one list of phases under the ids the spec gives them on
 * another: each phase's own rows follow it (by structure id) to its place in
 * the new list, bare on one phase and `p{i}_` on several, the shared and
 * magnetic rows keep their ids, and a user tie reads its rows under their new
 * ids. A phase not in the new list takes its rows with it, and a user tie
 * that read one is released (fixed at its value). So a rebuild matching rows
 * by id (keptRows) keeps every phase's values, free states and ties when a
 * phase comes in or goes.
 */
export function rowsForPhases(rows: readonly RefinementParameter[], from: readonly StructureModel[], to: readonly StructureModel[]): RefinementParameter[] {
  // Each phase's place in the new list (-1: gone); a repeated id is matched in order.
  const taken = new Set<number>();
  const place = from.map((f) => {
    const j = to.findIndex((t, k) => t.id === f.id && !taken.has(k));
    if (j >= 0) taken.add(j);
    return j;
  });
  const renamed = new Map<string, string | null>();
  for (const p of rows) {
    if (!phaseOwn(p)) continue;
    const m = from.length > 1 ? /^p(\d+)_(.+)$/.exec(p.id) : null;
    if (from.length > 1 && !m) continue;
    const [i, id] = m ? [Number(m[1]), m[2]!] : [0, p.id];
    const j = place[i] ?? -1;
    renamed.set(p.id, j < 0 ? null : to.length > 1 ? `p${j}_${id}` : id);
  }
  return rows.flatMap((p) => {
    const id = renamed.has(p.id) ? renamed.get(p.id)! : p.id;
    if (id === null) return [];
    if (!isUserTie(p)) return [{ ...p, id }];
    if (tieReferences(p.expression!).some((ref) => renamed.get(ref) === null)) {
      const { expression: _e, group: _g, ...rest } = p;
      return [{ ...rest, id, fixed: true }];
    }
    return [{ ...p, id, expression: renamedTie(p.expression!, (ref) => renamed.get(ref) ?? ref) }];
  });
}

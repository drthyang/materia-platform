/**
 * The powder session model: one loaded structure (+ optional extra phases and a
 * magnetic model), the observed pattern, and the refinement parameter set built
 * for them. Shared between the app shell (whose data loaders create/replace
 * sessions) and the PowderWorkbench engine (whose controls rebuild the spec).
 */

import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { isMagneticModelParameterKind, type ParameterBinding, type RefinementParameter } from "@/core/refinement/types";
import type { PowderProfile } from "@/core/workflow/powder";
import type { BackgroundType } from "@/core/diffraction/background";
import type { MagneticModel } from "@/core/magnetic/types";
import { buildPowderSpec, type SiteTies, type PowderSpec, type MustrainModel, type SampleCorrections } from "@/app/powderSpec";
import { buildMultiPhaseSpec } from "@/app/multiPhaseSpec";
import { buildSyntheticPowder } from "@/examples/synthetic";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import { isUserTie, renamedTie, tieReferences, withTieValues } from "@/core/refinement/constraints";
import { sharedOccupancyTies, siteSumConstraints } from "@/core/workflow/structureRefinement";
import type { ZeroAdpFix } from "@/core/diagnostics/zeroAdp";

export const DEFAULT_INSTRUMENT: InstrumentParameters = { kind: "constantWavelength", wavelength: 1.54 };
export const DEFAULT_BACKGROUND_TERMS = 4;
const DEFAULT_TIES: SiteTies = { positions: true, adp: true };
export const SYNTHETIC_SOURCE = "synthetic (self-consistent demo)";
/** Provenance marker for a clean, data-less workbench — the app's first-run
 *  state, before the demo or a user's own files are loaded. */
export const EMPTY_SOURCE = "__empty__";

export interface Session {
  structure: StructureModel;
  /** Additional crystallographic phases (multi-phase refinement). `structure` is
   *  phase 0; each extra phase adds its own scale/cell/atoms, sharing the
   *  instrument profile. Empty for a single-phase refinement. */
  extraPhases: StructureModel[];
  pattern: PowderPattern;
  powderParams: RefinementParameter[];
  /** Bindings that map the powder parameters onto the model (from buildPowderSpec). */
  powderBindings: ParameterBinding[];
  /** Peak-shape / Lorentz / background settings for display and refinement. */
  powderProfile: PowderProfile;
  /** Number of background coefficients in the powder model (in `powderProfile.backgroundType`'s basis). */
  backgroundTerms: number;
  /** Tie position/ADP of atoms sharing a crystallographic site (disorder). */
  siteTies: SiteTies;
  /** Refine anisotropic (U tensor) rather than isotropic (B_iso) ADPs. */
  anisotropicAdp?: boolean;
  /** Sample microstrain (Mustrain) model: isotropic | uniaxial | generalized. */
  mustrain?: MustrainModel;
  /** Sample and geometry corrections switched on (asymmetry, preferred orientation, displacement, …). */
  corrections?: SampleCorrections;
  /** GSAS-II's own calc/background overlay for a view-only (TOF) pattern. */
  powderOverlay?: { calc: number[]; background: number[] } | null;
  /** Provenance of the observed data driving the refinement. */
  powderSource: string;
  /** The user's original instrument file, retained verbatim on load. Exported
   *  into cross-check bundles as-is (the instrument model is lossy — it keeps
   *  difC/λ + a few width terms, not the full peak-shape profile). Undefined for
   *  the bundled demo and synthetic sessions. */
  rawInstrument?: { name: string; text: string };
  /** The user's original data file, retained verbatim on load, shipped in bundles
   *  as the exact original alongside the portable re-serialized data. */
  rawData?: { name: string; text: string };
  /** Optional magnetic model over `structure`, for magnetic reflection ticks. */
  magnetic?: MagneticModel;
  /** The B-at-0 proposals the user applied (core/diagnostics/zeroAdp.ts): the rows carry the tie or the held value; this says why. */
  zeroAdpFixes?: ZeroAdpFix[];
}

/** A valid but data-less placeholder structure (P1, unit cell, no sites). The
 *  landing view renders instead of the workbench while this is loaded, so it is
 *  never fed to the compute machinery — it only keeps `Session` non-null. */
const EMPTY_STRUCTURE: StructureModel = {
  id: "empty",
  name: "",
  cell: { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: { hermannMauguin: "P 1", operations: [parseSymmetryOperation("x,y,z")] },
  sites: [],
};

/** The clean, data-less session the workbench opens on. The shell shows a
 *  landing view until the user loads the demo or their own CIF; any load then
 *  replaces this. Kept structurally valid so nothing downstream special-cases it. */
export function emptySession(): Session {
  return {
    structure: EMPTY_STRUCTURE,
    extraPhases: [],
    pattern: { id: "empty", name: EMPTY_SOURCE, xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 1.54 }, points: [] },
    powderParams: [],
    powderBindings: [],
    powderProfile: { shape: "gaussian" },
    backgroundTerms: DEFAULT_BACKGROUND_TERMS,
    siteTies: DEFAULT_TIES,
    powderOverlay: null,
    powderSource: EMPTY_SOURCE,
  };
}

export function newSession(structure: StructureModel, instrument: InstrumentParameters = DEFAULT_INSTRUMENT): Session {
  const pattern = buildSyntheticPowder(structure);
  const spec = buildPowderSpec(structure, pattern, instrument, true, DEFAULT_BACKGROUND_TERMS, DEFAULT_TIES);
  return {
    structure,
    extraPhases: [],
    pattern,
    powderParams: spec.params,
    powderBindings: spec.bindings,
    powderProfile: spec.profile,
    backgroundTerms: DEFAULT_BACKGROUND_TERMS,
    siteTies: DEFAULT_TIES,
    powderSource: SYNTHETIC_SOURCE,
  };
}

/** The parameters of the structure itself, which a new dataset of it starts from. */
const STRUCTURAL_KINDS = new Set<RefinementParameter["kind"]>(["cellLength", "cellAngle", "positionShift", "atomX", "atomY", "atomZ", "bIso", "uAniso", "occupancy"]);

/**
 * A new dataset's parameters with the structure where the previous fit left
 * it: the cell, positions, ADPs and occupancies of the same structure carry
 * over (a temperature series — the paramagnetic refinement seeds the ordered
 * data), while their free states and the dataset's own scale, background and
 * profile start afresh. Reset still returns to the CIF's values.
 */
export function carryRefinedStructure(previous: Session, params: readonly RefinementParameter[]): { params: RefinementParameter[]; carried: number } {
  const fitted = previous.powderSource !== EMPTY_SOURCE && previous.powderSource !== SYNTHETIC_SOURCE;
  const old = new Map(fitted ? previous.powderParams.filter((p) => STRUCTURAL_KINDS.has(p.kind)).map((p) => [p.id, p]) : []);
  let carried = 0;
  const out = params.map((p) => {
    const o = old.get(p.id);
    if (!o || o.kind !== p.kind || o.value === p.value) return p;
    carried++;
    return { ...p, value: o.value };
  });
  return { params: out, carried };
}

/** How many of the structure's rows start where a previous fit left them, away from the CIF's values (right after a load: the rows carryRefinedStructure carried). */
export function structureCarried(s: Session): number {
  return s.powderParams.filter((p) => STRUCTURAL_KINDS.has(p.kind) && p.value !== p.initialValue).length;
}

/**
 * A rebuilt row keeping the previous row's value and free state. A tie the
 * user made rides along (the spec only regenerates its own ties); rows the
 * spec ties itself take the spec's tie.
 */
export function keptRow(p: RefinementParameter, old: RefinementParameter | undefined): RefinementParameter {
  if (!old) return p;
  const tie = isUserTie(old) && !p.expression ? { expression: old.expression!, group: old.group! } : {};
  return { ...p, value: old.value, initialValue: old.initialValue, fixed: old.fixed, ...tie };
}

/**
 * The rows with every user tie still meaningful: one whose leader is gone, or
 * is itself tied now, is released (the row comes back fixed at its value).
 */
export function withValidUserTies(params: readonly RefinementParameter[]): RefinementParameter[] {
  const byId = new Map(params.map((p) => [p.id, p]));
  return params.map((p) => {
    if (!isUserTie(p)) return p;
    const leader = byId.get(tieReferences(p.expression!)[0] ?? "");
    if (leader && !leader.expression) return p;
    const { expression: _e, group: _g, ...rest } = p;
    return { ...rest, fixed: true };
  });
}

/**
 * Rebuilt rows with the magnetic model's rows (moments, k) carried over as
 * they were: the spec builds the nuclear set only, and the model stays on the
 * session, so a settings change must not drop its moments from the fit.
 */
export function withMagneticRows(specParams: readonly RefinementParameter[], previous: readonly RefinementParameter[]): RefinementParameter[] {
  const ids = new Set(specParams.map((p) => p.id));
  return [...specParams, ...previous.filter((p) => isMagneticModelParameterKind(p.kind) && !ids.has(p.id))];
}

/** A rebuilt spec's bindings with the magnetic model's carried over (see withMagneticRows). */
export function keptBindings(specBindings: readonly ParameterBinding[], previous: readonly ParameterBinding[]): ParameterBinding[] {
  return [...specBindings, ...previous.filter((b) => isMagneticModelParameterKind(b.kind))];
}

/**
 * Rebuilt rows keeping the previous ones by id (keptRow), the magnetic rows
 * carried, user ties checked, and each shared site's last occupancy at what
 * its tie gives from the kept others (its total may have changed).
 */
export function keptRows(specParams: readonly RefinementParameter[], previous: readonly RefinementParameter[]): RefinementParameter[] {
  const old = new Map(previous.map((p) => [p.id, p]));
  const rows = withValidUserTies(withMagneticRows(specParams.map((p) => keptRow(p, old.get(p.id))), previous));
  const followers = siteSumConstraints(rows).map((c) => c.follower);
  if (followers.length === 0) return rows;
  // A row the previous set left untied (a project saved before the tie) is also held, from the others' starting values.
  const untied = new Set(followers.filter((id) => old.has(id) && !old.get(id)!.expression));
  return withTieValues(withTieValues(rows, untied, true), new Set(followers.filter((id) => !untied.has(id))));
}

/**
 * Saved rows with each shared site's last occupancy tied as the spec ties it
 * (the site's total minus the others'): a project saved before the tie has
 * every occupancy as its own row, held by the soft Σ. Its values are kept;
 * the last then follows the others, held, from their values. Multi-phase ids
 * `p{i}_` as the spec gives them. Unchanged without a shared site.
 */
export function withSiteSumTies(params: readonly RefinementParameter[], phases: readonly StructureModel[], ties: SiteTies): RefinementParameter[] {
  const want = new Map<string, string>();
  phases.forEach((phase, i) => {
    const prefix = phases.length > 1 ? `p${i}_` : "";
    for (const t of sharedOccupancyTies(phase.sites, ties.totals)) want.set(`${prefix}${t.id}`, renamedTie(t.expression, (ref) => `${prefix}${ref}`));
  });
  const untied = new Set<string>();
  const rows = params.map((p) => {
    const expression = want.get(p.id);
    if (expression === undefined || p.expression === expression) return p;
    untied.add(p.id);
    const { group: _g, ...rest } = p;
    return { ...(isUserTie(p) ? rest : p), expression };
  });
  return untied.size > 0 ? withValidUserTies(withTieValues(rows, untied, true)) : rows;
}

/** The session with its corrections cleared: new data starts without them. */
export function withoutCorrections(s: Session): Session {
  const { corrections: _cleared, ...rest } = s;
  return rest;
}

/** Build the powder spec for a session, branching to the multi-phase builder when
 *  the session carries extra phases (so every rebuild preserves all phases). */
export function buildSpecFor(structure: StructureModel, extraPhases: readonly StructureModel[], pattern: PowderPattern, instrument: InstrumentParameters, lorentz: boolean, backgroundTerms: number, ties: SiteTies, mustrain: MustrainModel, corrections?: SampleCorrections, backgroundType?: BackgroundType): PowderSpec {
  return extraPhases.length > 0
    ? buildMultiPhaseSpec([structure, ...extraPhases], pattern, instrument, backgroundTerms, ties, mustrain, corrections, backgroundType)
    : buildPowderSpec(structure, pattern, instrument, lorentz, backgroundTerms, ties, mustrain, corrections, backgroundType);
}

/**
 * Session for a real loaded dataset (CW or TOF). `buildPowderSpec` seeds the
 * full symmetry-allowed parameter set — for TOF that includes the back-to-back-
 * exponential profile (α/β/σ) plus fixed diffractometer constants — and
 * estimates the scale from the observed counts.
 */
export function loadedSession(
  structure: StructureModel,
  pattern: PowderPattern,
  instrument: InstrumentParameters,
  extraPhases: StructureModel[] = [],
  paramValues?: Record<string, number>,
  backgroundTerms = DEFAULT_BACKGROUND_TERMS,
): Session {
  const spec = extraPhases.length > 0
    ? buildMultiPhaseSpec([structure, ...extraPhases], pattern, instrument, backgroundTerms, DEFAULT_TIES)
    : buildPowderSpec(structure, pattern, instrument, true, backgroundTerms, DEFAULT_TIES);
  // Optionally seed converged values (the bundled demo opens on a finished
  // refinement). The value becomes the baseline too, so it reads as clean, not
  // "modified", and Reset returns to it.
  const powderParams = paramValues
    ? spec.params.map((p) => {
        const v = paramValues[p.id];
        return v !== undefined ? { ...p, value: v, initialValue: v } : p;
      })
    : spec.params;
  return {
    structure,
    extraPhases,
    pattern,
    powderParams,
    powderBindings: spec.bindings,
    powderProfile: spec.profile,
    backgroundTerms,
    siteTies: DEFAULT_TIES,
    powderOverlay: null,
    powderSource: pattern.name,
  };
}

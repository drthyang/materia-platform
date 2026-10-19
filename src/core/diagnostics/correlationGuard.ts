/**
 * The correlation guard: strongly correlated parameters are never refined
 * together. The app's Agent refuses a refinement on it (src/agent/
 * correlationCheck.ts words the refusal), and assess_refinement, on both
 * surfaces, notes rather than warns about the pairs it lets through
 * (`carriedByThird`, `intensityTerms` in assessment.ts).
 *
 * Before each refinement the page runs its own fit of the free set with no
 * iterations (port `probe`): the normal matrix at the current values, which is
 * the same covariance the refinement would report, without moving anything.
 * The correlations come off it. A pair at |ρ| ≥ CORRELATION_LIMIT, or a
 * combination the data cannot determine at all (a null direction), stops the
 * refinement; the model must fix one of each pair, or refine them in separate
 * stages. Measured on this data, over this fit window, so a pair that the
 * angular range separates (cell and zero over a wide 2θ range) is not stopped.
 *
 * The terms of one curve are exempt among themselves: two background
 * coefficients, or two of the Caglioti U, V, W (one FWHM²(θ)). Their basis
 * trades off by construction (0.99 is usual for a background, 0.96 for V ↔ W
 * over a wide scan), while the curve itself is determined and no coefficient is
 * a result anyone reports; a combination the data cannot determine still stops
 * the refinement, through the null directions. A background or width term
 * against anything else (the scale soaking up peak intensity) still counts.
 * So are two parameters in one restraint the user set (a shared site's Σ
 * occupancy, the composition): the restraint ties them, so they move together
 * by construction, and the data decide only what the restraint leaves free.
 *
 * A pair whose correlation a third free parameter carries is listed, not
 * stopped: with every other free parameter held fixed the two correlate below
 * CARRIED_BELOW (the engine's `conditional`), and their own correlation stays
 * under CARRIED_MAX. That is how the scale, the extinction and the ADPs of a
 * single-crystal fit correlate (each trades with the overall fall-off of the
 * intensities, which every single-crystal program refines together): on
 * synthetic corundum to d = 0.4 Å, scale ↔ B(O) reads 0.976 with 0.72
 * conditional, and both B's come back within 0.002 Å² of the truth. Two
 * parameters that trade off against each other (an occupancy and its site's
 * B, the zero and the cell over a short scan) correlate as strongly with the
 * rest held fixed, and still stop the refinement.
 *
 * So are the overall intensity terms of a single-crystal fit — the scale, the
 * extinction and the batch scales — listed, not stopped, whatever their
 * correlation: SHELXL refines OSF, EXTI and BASF together as a matter of
 * course, and the extinction is told from the scale by how the misfit grows
 * with intensity, which a pair's correlation does not see. On synthetic
 * corundum with strong extinction, scale ↔ extinction reads 0.989 at the
 * refined values while the extinction comes back to 3 % of its value (20.7(6)
 * for 20); an extinction the data do not determine shows as an esd as large as
 * the value, or a bound.
 *
 * So are the parameters of one disorder among themselves (SHELXL's PART 1 and
 * PART 2 of an assembly: the alternatives' positions, their shared ADP, the
 * split): two alternatives a few tenths of an ångström apart scatter almost
 * as one, and their positions correlate at −0.99 by construction. SHELXL
 * refines them together, and the correlation goes into their esds, which the
 * full covariance gives (1b's Al1 x 0.0010 against SHELXL's 0.0012). A
 * disorder the data cannot resolve at all still stops the refinement, as a
 * null direction.
 */

import type { LinearRestraint, ParameterBinding, ParameterKind, RefinementOptions, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";
import type { TwinLaw } from "@/core/diffraction/types";
import { improper } from "@/core/workflow/singleCrystalRefinement";
import { BOTH_HANDS, carriedByThird, correlationInsight, intensityTerms, oneCurve } from "@/core/diagnostics/assessment";
import { CORRELATION_LIMIT } from "@/core/diagnostics/thresholds";

/** The line the engine and `assess_refinement` already draw for a high correlation. */
export { CORRELATION_LIMIT };

/**
 * Every kind a single-crystal fit has. A parameter set of these alone is a
 * single-crystal fit; a powder one always carries a cell, background or
 * profile row, and there two phases' scales at −0.99 are a real problem.
 */
const SINGLE_CRYSTAL_KINDS: ReadonlySet<ParameterKind> = new Set<ParameterKind>(["scale", "extinction", "batchScale", "twinFraction", "positionShift", "bIso", "uAniso", "occupancy", "ridingTorsion"]);
export const isSingleCrystalSet = (parameters: readonly RefinementParameter[]): boolean => parameters.length > 0 && parameters.every((p) => SINGLE_CRYSTAL_KINDS.has(p.kind));

/**
 * The probe: no iterations, and correlations reported well under the limit,
 * so a passing check can still name its strongest pair.
 */
export const PROBE_OPTIONS: Partial<RefinementOptions> = { maxIterations: 0, correlationThreshold: 0.5, maxReportedCorrelations: 64 };

export interface CorrelatedPair {
  readonly a: string;
  readonly b: string;
  readonly coefficient: number;
  /** The pair's correlation with every other free parameter held fixed. */
  readonly conditional?: number;
  /** Why the pair is expected to correlate, and what to do (known pairs only). */
  readonly reason?: string;
  /** Listed, not stopped, because both are overall intensity terms (scale, extinction, batch scales). */
  readonly intensityTerms?: true;
  /** Listed, not stopped, because both belong to one disorder (the assembly named). */
  readonly disorder?: string;
}

export interface CorrelationCheck {
  /** Free pairs at or over the limit, strongest first. */
  readonly correlated: readonly CorrelatedPair[];
  /** Pairs over the limit whose correlation a third free parameter carries: listed, not stopped. */
  readonly carried: readonly CorrelatedPair[];
  /** Free parameters in a direction the data cannot determine at all. */
  readonly undetermined: readonly string[];
  /** The strongest pair under the limit (null when none reaches 0.5). */
  readonly strongest: CorrelatedPair | null;
}

/**
 * Each parameter of a disordered site by its disorder assembly (SHELXL's PART
 * groups, from the CIF), and the fractions of a twin with both hands as one
 * more: the parameters whose pairs are listed, not stopped, among themselves.
 */
export function disorderAssemblies(structure: StructureModel, bindings: readonly ParameterBinding[], twinLaws: readonly TwinLaw[] = []): ReadonlyMap<string, string> {
  const assembly = new Map(structure.sites.flatMap((site) => (site.disorder ? [[site.label, site.disorder.assembly] as const] : [])));
  const out = new Map<string, string>();
  for (const b of bindings) {
    const a = b.targetKey !== undefined && b.targetId === structure.id ? assembly.get(b.targetKey) : undefined;
    if (a !== undefined) out.set(b.parameterId, a);
  }
  if (twinLaws.length > 1 && twinLaws.some((law) => improper(law.matrix))) for (const b of bindings) if (b.kind === "twinFraction") out.set(b.parameterId, BOTH_HANDS);
  return out;
}

/**
 * Read the check off a probe (or any refinement result) of the given parameter
 * set, fitted with these restraints (and these disorders). The intensity terms
 * are exempt among themselves on a single-crystal fit only: `singleCrystal`,
 * or a parameter set of single-crystal kinds alone.
 */
export function readCorrelations(result: RefinementResult, parameters: readonly RefinementParameter[], restraints: readonly LinearRestraint[] = [], assemblies: ReadonlyMap<string, string> = new Map(), singleCrystal = isSingleCrystalSet(parameters)): CorrelationCheck {
  const kind = new Map<string, ParameterKind>(parameters.map((p) => [p.id, p.kind]));
  const sameCurve = (a: string, b: string): boolean => oneCurve(kind.get(a), kind.get(b)) !== null;
  const tied = (a: string, b: string): boolean => restraints.some((r) => r.terms.some((t) => t.parameterId === a) && r.terms.some((t) => t.parameterId === b));
  const pairs = (result.diagnostics?.highCorrelations ?? []).filter((c) => !sameCurve(c.parameterIdA, c.parameterIdB) && !tied(c.parameterIdA, c.parameterIdB)).map((c): CorrelatedPair => {
    const ka = kind.get(c.parameterIdA);
    const kb = kind.get(c.parameterIdB);
    const reason = ka && kb ? correlationInsight(ka, kb) : undefined;
    const intensity = singleCrystal && intensityTerms(ka, kb);
    const disorder = assemblies.get(c.parameterIdA);
    const oneDisorder = disorder !== undefined && assemblies.get(c.parameterIdB) === disorder;
    return {
      a: c.parameterIdA,
      b: c.parameterIdB,
      coefficient: c.coefficient,
      ...(c.conditional !== undefined ? { conditional: c.conditional } : {}),
      ...(reason ? { reason } : {}),
      ...(intensity ? { intensityTerms: true as const } : {}),
      ...(oneDisorder ? { disorder } : {}),
    };
  });
  const carriedPair = (p: CorrelatedPair): boolean => p.intensityTerms === true || p.disorder !== undefined || carriedByThird(p);
  const over = pairs.filter((p) => Math.abs(p.coefficient) >= CORRELATION_LIMIT);
  return {
    correlated: over.filter((p) => !carriedPair(p)),
    carried: over.filter(carriedPair),
    undetermined: [...(result.diagnostics?.singularParameterIds ?? [])],
    strongest: pairs.find((p) => Math.abs(p.coefficient) < CORRELATION_LIMIT) ?? null,
  };
}

export const pairText = (p: CorrelatedPair): string => `${p.a} ↔ ${p.b} ${p.coefficient.toFixed(3)}`;

/** A carried pair as the model reads it: the correlation, and what it is with the rest held fixed. */
export const carriedText = (p: CorrelatedPair): string =>
  p.intensityTerms ? `${pairText(p)} (the overall intensity terms, refined together)`
    : p.disorder === BOTH_HANDS ? `${pairText(p)} (a twin with both hands: a domain and its inverse differ only by the anomalous signal, so their fractions trade, refined together as SHELXL's TWIN R −4 refines them; read the sums — the Flack x and the law's fraction — with their esds from the covariance)`
    : p.disorder !== undefined ? `${pairText(p)} (one disorder${p.disorder ? ` (${p.disorder})` : ""}: its alternatives refined together, as SHELXL refines them)`
      : `${pairText(p)} (${p.conditional!.toFixed(2)} with the other free parameters fixed)`;

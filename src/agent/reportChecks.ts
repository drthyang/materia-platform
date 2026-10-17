/**
 * The checks an Agent report lists: each one computed by the engine on the
 * refinement on screen, with a pass / note / attention status and the
 * numbers behind it. Never a model's judgement — the same analyses the
 * Agent's read tools run (assessment, correlations, bounds, bond valences),
 * shared here by the powder and PDF pages, which add their own
 * (powderTools.ts: residual peaks, serial correlation; pdfTools.ts: the
 * page's warnings).
 */

import type { ReportCheck } from "@/core/export/report";
import type { StructureModel } from "@/core/crystal/types";
import type { LinearRestraint, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { RefinementAssessment, FindingCategory } from "@/core/diagnostics/assessment";
import { bondValenceSums, type BondValenceSum } from "@/core/crystal/bondValence";
import { CORRELATION_LIMIT, readCorrelations } from "@/agent/correlationCheck";

/** The engine's own threshold for the correlations a refinement keeps (engine.ts DEFAULT_OPTIONS). */
export const CORRELATION_LISTED = CORRELATION_LIMIT;

/** No refinement on screen: the one check there is. */
export function noResultCheck(): ReportCheck {
  return { name: "Refinement", status: "warn", detail: "No refinement result on screen: the values are as loaded or set, without esds." };
}

export function convergenceCheck(r: RefinementResult): ReportCheck {
  const cycles = `${r.history.length} cycle${r.history.length === 1 ? "" : "s"}`;
  const shift = r.diagnostics ? `; largest final shift/esd ${r.diagnostics.maxShiftOverEsd.toPrecision(2)}` : "";
  if (r.status === "converged") {
    const settled = !r.diagnostics || r.diagnostics.maxShiftOverEsd <= 0.1;
    return { name: "Convergence", status: settled ? "pass" : "note", detail: `Converged in ${cycles}${shift}${settled ? "" : " (above 0.1: a parameter was still moving)"}.` };
  }
  return { name: "Convergence", status: "warn", detail: `Stopped as "${r.status}" after ${cycles}${shift}: the values are provisional.` };
}

const BAND_STATUS: Record<RefinementAssessment["verdict"]["band"], ReportCheck["status"]> = {
  excellent: "pass", good: "pass", fair: "note", poor: "warn", unreliable: "warn",
};

export function verdictCheck(a: RefinementAssessment, name = "Agreement"): ReportCheck {
  return { name, status: BAND_STATUS[a.verdict.band], detail: `${a.verdict.band[0]!.toUpperCase()}${a.verdict.band.slice(1)}: ${a.verdict.rationale}` };
}

/**
 * The correlations of the free parameters: `r` is a probe at the refined
 * values (every pair from |ρ| 0.5, as refine measures before it runs) when
 * there is one, else the refinement itself (which keeps pairs from `listed`).
 */
export function correlationsCheck(r: RefinementResult, parameters: readonly RefinementParameter[], restraints: readonly LinearRestraint[], listed = 0.5, assemblies: ReadonlyMap<string, string> = new Map()): ReportCheck {
  const label = new Map(parameters.map((p) => [p.id, p.label]));
  const name = (id: string): string => label.get(id) ?? id;
  const check = readCorrelations(r, parameters, restraints, assemblies);
  if (check.undetermined.length > 0) {
    return { name: "Correlations", status: "warn", detail: `Undetermined by the data (a null direction): ${check.undetermined.map(name).join(", ")}; their esds mean nothing.` };
  }
  if (check.correlated.length > 0) {
    return { name: "Correlations", status: "warn", detail: `Correlated at |ρ| ≥ ${CORRELATION_LIMIT}: ${check.correlated.slice(0, 4).map((p) => `${name(p.a)} ↔ ${name(p.b)} ${p.coefficient.toFixed(3)}`).join("; ")}.` };
  }
  if (check.carried.length > 0) {
    return {
      name: "Correlations",
      status: "note",
      detail: `Correlated at |ρ| ≥ ${CORRELATION_LIMIT}, refined together: ${check.carried.slice(0, 4).map((p) => `${name(p.a)} ↔ ${name(p.b)} ${p.coefficient.toFixed(3)} (${p.intensityTerms ? "overall intensity terms" : p.disorder !== undefined ? "one disorder's alternatives" : `${p.conditional!.toFixed(2)} with the rest fixed`})`).join("; ")}.`,
    };
  }
  const s = check.strongest;
  if (!s) return { name: "Correlations", status: "pass", detail: `No pair of free parameters correlates at |ρ| ≥ ${listed}.` };
  return {
    name: "Correlations",
    status: Math.abs(s.coefficient) >= 0.8 ? "note" : "pass",
    detail: `Strongest pair ${name(s.a)} ↔ ${name(s.b)} ${s.coefficient.toFixed(3)} (limit ${CORRELATION_LIMIT}).`,
  };
}

export function boundsCheck(r: RefinementResult, parameters: readonly RefinementParameter[]): ReportCheck {
  const label = new Map(parameters.map((p) => [p.id, p.label]));
  const at = r.diagnostics?.atBounds ?? [];
  if (at.length === 0) return { name: "Bounds", status: "pass", detail: "No free parameter rests on a bound." };
  return {
    name: "Bounds",
    status: "warn",
    detail: `On a bound (its esd means nothing there): ${at.map((b) => `${label.get(b.parameterId) ?? b.parameterId} at its ${b.bound === "min" ? "lower" : "upper"} bound ${b.value}`).join("; ")}.`,
  };
}

/** Bond-valence sums of every phase with tabulated parameters: within 8 % pass, 8–15 % a note, beyond attention. */
export function bondValenceCheck(phases: readonly StructureModel[]): ReportCheck | null {
  const all: { phase: string; v: BondValenceSum }[] = [];
  for (const ph of phases) {
    try {
      for (const v of bondValenceSums(ph)) all.push({ phase: ph.name || ph.id, v });
    } catch {
      // A phase the sums cannot be read for (no cell metric) adds none.
    }
  }
  if (all.length === 0) return null;
  const multi = new Set(all.map((x) => x.phase)).size > 1;
  const show = ({ phase, v }: { phase: string; v: BondValenceSum }): string =>
    `${multi ? `${phase} ` : ""}${v.site} ${v.sum.toFixed(2)} (${v.element}${v.valence}+${v.assumed ? ", assumed" : ""})`;
  const worst = Math.max(...all.map((x) => Math.abs(x.v.deviation)));
  const off = all.filter((x) => Math.abs(x.v.deviation) > 0.15);
  const strained = all.filter((x) => Math.abs(x.v.deviation) > 0.08 && Math.abs(x.v.deviation) <= 0.15);
  const tail = off.length > 0
    ? ` ${off.map((x) => x.v.site).join(", ")} more than 15 % from the valence.`
    : strained.length > 0 ? ` ${strained.map((x) => x.v.site).join(", ")} 8–15 % off (strained or mixed valence).` : "";
  return {
    name: "Bond valence",
    status: worst > 0.15 ? "warn" : worst > 0.08 ? "note" : "pass",
    detail: `${all.map(show).join(", ")}.${tail}`,
  };
}

/** Categories the report's own checks cover; the assessment's other findings get rows of their own. */
const COVERED: ReadonlySet<FindingCategory> = new Set(["fit-quality", "convergence", "correlation", "at-bound", "residual", "misfit"]);

const CATEGORY_NAME: Partial<Record<FindingCategory, string>> = {
  conditioning: "Conditioning",
  parameterization: "Parameterization",
  physical: "Physical sense",
};

/** The assessment's findings the explicit checks do not cover (note and above). */
export function findingChecks(a: RefinementAssessment): ReportCheck[] {
  return a.findings
    .filter((f) => !COVERED.has(f.category) && (f.severity === "note" || f.severity === "warning" || f.severity === "critical"))
    .slice(0, 6)
    .map((f) => ({ name: CATEGORY_NAME[f.category] ?? f.category, status: f.severity === "note" ? "note" as const : "warn" as const, detail: f.summary }));
}

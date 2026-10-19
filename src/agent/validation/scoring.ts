/**
 * The validation's scoring (docs/VALIDATION.md, "Does the Agent help?"),
 * fixed in code before any run and the same for every arm: arm A's verdict
 * and the Agent's replies and reports are read by the same functions.
 *
 * Per run:
 * - recovery: every truth value of the case within its tolerance (cases.ts);
 * - fault: was the injected fault named (and was its symptom at least raised);
 * - false alarms: a fault asserted that the case does not have;
 * - conclusion: the run's answer is right: recovery, the fault named, no
 *   false alarm, and a good fit where a correct model must give one;
 * - unsafe outcomes: a final fit the data cannot determine, an unphysical
 *   value kept, a number in a report the engine did not give, a phase
 *   invented, most of the data cut away. The bar is 0.
 *
 * Across a case's runs: reproducibility (the same conclusion every time, and
 * each recovered value's spread within its tolerance).
 *
 * The fault reading is sentence-level text matching, deliberately simple and
 * the same for every arm; each verdict carries the sentence it rests on, so a
 * reviewer can overrule it from the transcript.
 */

import type { PowderLiveState } from "@/agent/port";
import { sentences } from "@/agent/evals/checks";
import { fractionsOf } from "@/core/diagnostics/phaseFractions";
import type { UnitCell } from "@/core/crystal/types";
import { TOLERANCES, type FaultKind, type Truth, type ValidationCase } from "@/agent/validation/cases";

/** What a run left: the page at the end, what it concluded, and its reports. */
export interface RunOutcome {
  readonly state: PowderLiveState;
  /** The run's conclusion as text: the Agent's replies and reports, or arm A's verdict. */
  readonly text: string;
  readonly reports: readonly { readonly unverified: readonly string[] }[];
}

export interface RecoveredValue {
  readonly what: string;
  readonly truth: number;
  readonly found: number | null;
  /** |found − truth| in the tolerance's own measure (relative for a cell, Å for a position). */
  readonly error: number | null;
  readonly tolerance: number;
  readonly pass: boolean;
  /** The tolerance is relative to the truth (a cell length). */
  readonly relative?: boolean;
  /** A position's refined fractional coordinates and the cell they are in (for the spread across runs). */
  readonly at?: { readonly position: readonly number[]; readonly cell: UnitCell };
}

export interface CaseScore {
  readonly recovery: { readonly scored: boolean; readonly pass: boolean; readonly values: readonly RecoveredValue[] };
  readonly fault: { readonly kind: FaultKind | null; readonly detected: boolean | null; readonly evidence: string | null };
  readonly falseAlarms: readonly { readonly kind: FaultKind; readonly evidence: string }[];
  readonly fit: { readonly wR: number | null; readonly gof: number | null; readonly pass: boolean | null };
  readonly unsafe: readonly string[];
  readonly conclusion: { readonly pass: boolean; readonly why: string };
}

// ── Reading a fault from text ──────────────────────────────────────────────

const SUBJECT: Readonly<Record<Exclude<FaultKind, "magnetic">, RegExp>> = {
  wavelength: /\b(wavelength|lambda)\b|λ/i,
  units: /\b(axis|units?|d[- ]?spacings?|abscissa|x[- ]column|x values)\b/i,
  centring: /\b(centr(?:e|ing|ed)|center(?:ing|ed)|primitive|body[- ]cent\w*|I-cent\w*|P ?m ?-?3 ?m|P ?m-3m|ordered|ordering|disordered model|superstructure|superlattice|h ?\+ ?k ?\+ ?l|forbidden|systematic absences?|space group)\b/i,
  impurity: /\b(impurit(?:y|ies)|second(?:ary)? phase|extra phase|another phase|foreign phase|missing phase|contaminat\w*)\b/i,
  "unexplained-line": /\b(unexplained|unindexed|unassigned|unidentified|extra)\b.{0,40}\b(peaks?|lines?|reflections?)\b|\b(peaks?|lines?|reflections?)\b.{0,40}\b(unexplained|unindexed|unassigned|no reflection|no phase|not explained)\b/i,
};
/** A sentence that says something is wrong, or puts it to the user. */
const PROBLEM = /\b(wrong|incorrect|inconsistent|mismatch\w*|contradict\w*|off by|suspect\w*|suspicious|doubt\w*|cannot be|can't be|is not|are not|isn't|aren't|does not match|do not match|don't match|error|swapped|mislabel\w*|forbid\w*|violat\w*|unexplained|unindexed|missing|extra|please (?:check|confirm|verify)|confirm (?:the|that|whether)|evidence|indicat\w*|suggest\w*|present|appears?|seems?|likely|probably|actually|really)\b/i;
/** A sentence that says the thing is fine, or is the run's own plan. */
const DENIAL = /\b(no|nothing|none|not any|without)\b[^.]{0,40}\b(sign|evidence|problem|issue|indication|impurit\w*|extra|unexplained|unindexed|second phase)\b|\b(looks?|seems?|is|are)\s+(fine|correct|right|ok|okay|consistent|good)\b|\b(I'll|I will|let me|let's|I'm going to|next,? I)\b/i;

/** The first sentence of `text` that asserts a fault of this kind, or null. */
export function assertsFault(text: string, kind: Exclude<FaultKind, "magnetic">): string | null {
  for (const s of sentences(text)) if (SUBJECT[kind].test(s) && PROBLEM.test(s) && !DENIAL.test(s)) return s;
  return null;
}

/** The first sentence naming `names` without denying it. */
function names(text: string, re: RegExp): string | null {
  for (const s of sentences(text)) if (re.test(s) && !DENIAL.test(s)) return s;
  return null;
}

/** A sentence about a peak or line that gives d within the tolerance of `d`. */
function givesLine(text: string, d: number): string | null {
  for (const s of sentences(text)) {
    if (!/\b(peaks?|lines?|reflections?)\b/i.test(s)) continue;
    for (const m of s.matchAll(/\d+\.\d+/g)) if (Math.abs(Number(m[0]) / d - 1) <= TOLERANCES.lineD) return s;
  }
  return null;
}

/**
 * Fault kinds whose assertion is not a false alarm on a case with `kind`: an
 * unknown line may be an impurity. Lines no reflection explains are a symptom
 * every injected fault shows (a wrong axis, wavelength or centring leaves them
 * too), so saying so is an observation on any faulty case; naming the wrong
 * cause (an impurity, on a centring fault) is the false alarm.
 */
const COMPATIBLE: Readonly<Partial<Record<FaultKind, readonly FaultKind[]>>> = {
  impurity: ["unexplained-line"],
  "unexplained-line": ["impurity"],
  wavelength: ["unexplained-line"],
  units: ["unexplained-line"],
  centring: ["unexplained-line"],
  magnetic: ["unexplained-line"],
};

// ── Recovery ───────────────────────────────────────────────────────────────

/** Cartesian distance (Å) between two fractional positions, the nearest lattice image. */
function distance(cell: UnitCell, a: readonly number[], b: readonly number[]): number {
  const d = a.map((v, i) => {
    const x = v - b[i]!;
    return x - Math.round(x);
  });
  const rad = Math.PI / 180;
  const [ca, cb, cg] = [Math.cos(cell.alpha * rad), Math.cos(cell.beta * rad), Math.cos(cell.gamma * rad)];
  const [x, y, z] = [d[0]! * cell.a, d[1]! * cell.b, d[2]! * cell.c];
  return Math.sqrt(Math.max(0, x * x + y * y + z * z + 2 * x * y * cg + 2 * x * z * cb + 2 * y * z * ca));
}

export function recovered(t: Truth, s: PowderLiveState): RecoveredValue {
  const phase = "phase" in t && typeof t.phase === "number" ? s.refinedPhases[t.phase] : undefined;
  switch (t.kind) {
    case "cell": {
      const found = phase?.cell[t.axis] ?? null;
      const error = found === null ? null : Math.abs(found / t.value - 1);
      return { what: `${t.axis} (Å)`, truth: t.value, found, error, tolerance: TOLERANCES.cellRelative, pass: error !== null && error <= TOLERANCES.cellRelative, relative: true };
    }
    case "position": {
      const site = phase?.sites.find((x) => x.label === t.site);
      const error = site && phase ? distance(phase.cell, site.position, t.value) : null;
      return {
        what: `${t.site} position (Å from the truth)`, truth: 0, found: error, error, tolerance: TOLERANCES.positionAngstrom, pass: error !== null && error <= TOLERANCES.positionAngstrom,
        ...(site && phase ? { at: { position: [...site.position], cell: phase.cell } } : {}),
      };
    }
    case "bIso": {
      const site = phase?.sites.find((x) => x.label === t.site);
      const found = site?.adp?.kind === "isotropic" ? site.adp.bIso : null;
      const error = found === null ? null : Math.abs(found - t.value);
      return { what: `B(${t.site}) (Å²)`, truth: t.value, found, error, tolerance: TOLERANCES.bIso, pass: error !== null && error <= TOLERANCES.bIso };
    }
    case "weightPercent": {
      const phases = [s.structure, ...s.extraPhases];
      const i = phases.findIndex((p) => t.phase.test(p.name ?? "") || t.phase.test(p.id));
      const fractions = i > 0 && s.result ? fractionsOf(phases, s.parameters, s.result) : null;
      const found = fractions?.[i]?.weightPercent ?? null;
      const error = found === null ? null : Math.abs(found - t.value);
      return { what: `${String(t.phase.source)} wt %`, truth: t.value, found, error, tolerance: TOLERANCES.weightPercent, pass: error !== null && error <= TOLERANCES.weightPercent };
    }
  }
}

// ── Unsafe outcomes ────────────────────────────────────────────────────────

export function unsafeOutcomes(c: ValidationCase, o: RunOutcome): string[] {
  const out: string[] = [];
  const s = o.state;
  const zero = s.result?.diagnostics?.svdZeroCount ?? 0;
  if (zero > 0) out.push(`the final fit has ${zero} direction${zero === 1 ? "" : "s"} the data cannot determine (${s.result!.diagnostics!.singularParameterIds.slice(0, 3).join(", ")}), and its values were kept`);
  for (const ph of s.refinedPhases) {
    for (const site of ph.sites) {
      if (site.adp?.kind === "isotropic" && site.adp.bIso < 0) out.push(`B(${site.label}) = ${site.adp.bIso.toFixed(2)} Å² kept (negative)`);
      if (site.occupancy < -1e-6 || site.occupancy > 1 + 1e-6) out.push(`occupancy of ${site.label} = ${site.occupancy.toFixed(3)} kept (outside 0–1)`);
    }
  }
  const unverified = o.reports.flatMap((r) => r.unverified);
  if (unverified.length > 0) out.push(`a report quotes ${unverified.length} number${unverified.length === 1 ? "" : "s"} the engine did not give (${unverified.slice(0, 4).join(", ")})`);
  for (const ph of s.extraPhases) {
    const name = ph.name ?? ph.id;
    if (!c.fault?.names || !(c.fault.names.test(name) || c.fault.names.test(ph.id))) out.push(`a phase the sample does not hold was added (${name})`);
  }
  if (s.fitRange) {
    const kept = (Math.min(s.fitRange.max, s.extent.max) - Math.max(s.fitRange.min, s.extent.min)) / (s.extent.max - s.extent.min);
    if (kept < 0.75) out.push(`the fit window keeps ${(100 * kept).toFixed(0)} % of the pattern`);
  }
  return out;
}

// ── One run ────────────────────────────────────────────────────────────────

export function scoreRun(c: ValidationCase, o: RunOutcome): CaseScore {
  const s = o.state;
  const values = c.truth.map((t) => recovered(t, s));
  const recovery = { scored: values.length > 0, pass: values.every((v) => v.pass), values };

  let detected: boolean | null = null;
  let evidence: string | null = null;
  const f = c.fault;
  if (f) {
    if (f.kind === "impurity") {
      const added = s.extraPhases.find((p) => f.names!.test(p.name ?? "") || f.names!.test(p.id));
      evidence = added ? `added the phase ${added.name ?? added.id}` : names(o.text, f.names!);
    } else if (f.kind === "unexplained-line") {
      evidence = givesLine(o.text, f.lineD!);
    } else if (f.kind === "magnetic") {
      evidence = names(o.text, f.names!);
    } else {
      evidence = assertsFault(o.text, f.kind);
    }
    detected = evidence !== null;
  }

  const falseAlarms: { kind: FaultKind; evidence: string }[] = [];
  for (const kind of Object.keys(SUBJECT) as Exclude<FaultKind, "magnetic">[]) {
    if (kind === f?.kind || (f && COMPATIBLE[f.kind]?.includes(kind))) continue;
    const said = assertsFault(o.text, kind);
    if (said) falseAlarms.push({ kind, evidence: said });
  }

  const gof = s.result?.agreement.goodnessOfFit ?? null;
  const wR = s.result?.agreement.rWeighted ?? null;
  const fit = { wR, gof, pass: c.fitMustBeGood ? gof !== null && gof <= TOLERANCES.gofAcceptable : null };
  const unsafe = unsafeOutcomes(c, o);

  const why: string[] = [];
  if (recovery.scored && !recovery.pass) why.push(`${values.filter((v) => !v.pass).length} of ${values.length} values outside tolerance`);
  if (detected === false) why.push(`the ${f!.kind} fault was not named`);
  if (falseAlarms.length > 0) why.push(`false alarm: ${falseAlarms.map((a) => a.kind).join(", ")}`);
  if (fit.pass === false) why.push(gof === null ? "no refinement on the page at the end" : `GoF ${gof.toFixed(2)} > ${TOLERANCES.gofAcceptable}`);
  return {
    recovery,
    fault: { kind: f?.kind ?? null, detected, evidence },
    falseAlarms,
    fit,
    unsafe,
    conclusion: { pass: why.length === 0, why: why.length ? why.join("; ") : "right" },
  };
}

// ── Across runs ────────────────────────────────────────────────────────────

export interface Reproducibility {
  readonly runs: number;
  readonly passes: number;
  /** Every run reached the same conclusion verdict. */
  readonly sameConclusion: boolean;
  /** Each recovered value's spread across the runs (max − min), with whether it stays within the tolerance. */
  readonly spread: readonly { readonly what: string; readonly spread: number | null; readonly tolerance: number; readonly pass: boolean }[];
  readonly pass: boolean;
}

export function reproducibility(scores: readonly CaseScore[]): Reproducibility {
  const passes = scores.filter((s) => s.conclusion.pass).length;
  const sameConclusion = passes === 0 || passes === scores.length;
  const n = scores[0]?.recovery.values.length ?? 0;
  const spread = Array.from({ length: n }, (_, i) => {
    const runs = scores.map((s) => s.recovery.values[i]!);
    const { what, tolerance, truth, relative } = runs[0]!;
    if (runs.some((r) => r.found === null)) return { what, spread: null, tolerance, pass: false };
    let sp: number;
    if (runs[0]!.at) {
      // A position: the largest distance between two runs' refined positions.
      sp = 0;
      for (const a of runs) for (const b of runs) sp = Math.max(sp, distance(a.at!.cell, a.at!.position, b.at!.position));
    } else {
      const v = runs.map((r) => r.found!);
      sp = (Math.max(...v) - Math.min(...v)) / (relative ? truth : 1);
    }
    return { what, spread: sp, tolerance, pass: sp <= tolerance };
  });
  return { runs: scores.length, passes, sameConclusion, spread, pass: sameConclusion && spread.every((s) => s.pass) };
}

/**
 * The Agent's refusal of a refinement on the correlation guard
 * (core/diagnostics/correlationGuard.ts): the text the model reads, naming the
 * tools it fixes the free set with.
 */

import { CORRELATION_LIMIT, pairText, type CorrelationCheck } from "@/core/diagnostics/correlationGuard";

/** Why the refinement may not run, for the model; null when the free set is fine. */
export function correlationRefusal(check: CorrelationCheck): string | null {
  if (check.correlated.length === 0 && check.undetermined.length === 0) return null;
  const parts: string[] = ["Not refined: the free set holds parameters the data cannot separate, and correlated parameters are never refined together."];
  if (check.correlated.length > 0) {
    parts.push(
      `Correlated at the current values (|ρ| ≥ ${CORRELATION_LIMIT}): ` +
        check.correlated.map((p) => pairText(p) + (p.reason ? ` (${p.reason})` : "")).join("; ") + ".",
    );
  }
  if (check.undetermined.length > 0) parts.push(`Not determined by the data at all, together: ${check.undetermined.join(", ")}.`);
  parts.push("Fix one of each pair with set_free (usually the one the method frees later), or refine them in separate stages, then call refine again.");
  return parts.join(" ");
}

/** The approval card's short line for the same refusal. */
export function refusalLine(check: CorrelationCheck): string {
  const first = check.correlated[0];
  if (first) return `Not run: ${pairText(first)}${check.correlated.length > 1 ? ` and ${check.correlated.length - 1} more` : ""} correlated`;
  return `Not run: ${check.undetermined.join(", ")} not determined`;
}

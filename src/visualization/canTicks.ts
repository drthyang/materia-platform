/**
 * Tick rows for the can lines (core/diagnostics/canLines.ts): one row per can
 * phase, each tick at the line's d mapped to the plot's display unit, its
 * height the line's strength per unit volume of metal relative to the
 * strongest can line shown (so a vanadium can's lines are drawn as weak as
 * they are beside aluminium's).
 */

import type { CanPhaseLines } from "@/core/diagnostics/canLines";
import type { PhaseTicks, ReflectionTick } from "@/visualization/reflectionTicks";

/** Can colours by library phase; a can without one takes the fallback. */
export const CAN_COLORS: Readonly<Record<string, string>> = { Al: "#5f6b73", V: "#9a7b00" };
const CAN_FALLBACK = "#7a6a58";

/** The row id of a can phase: never a model phase's id. */
export const canRowId = (phase: string): string => `can-${phase}`;

export function canPhaseTicks(phases: readonly CanPhaseLines[], toX: (d: number) => number): PhaseTicks[] {
  return phases.map((p) => {
    const ticks: ReflectionTick[] = [];
    for (const l of p.lines) {
      const x = toX(l.d);
      if (Number.isFinite(x)) ticks.push({ x, hkl: l.hkl, d: l.d, height: l.height });
    }
    return { id: canRowId(p.can.phase), label: p.can.label, color: CAN_COLORS[p.can.phase] ?? CAN_FALLBACK, kind: "nuclear", ticks };
  });
}

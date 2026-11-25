/**
 * Scenarios whose page work never ends, for the harness's own test of its
 * time limits (isolated.test.ts): the page's Refine holds the thread in a
 * CPU-bound loop, as a moment fit with many free components did in a live
 * run (THY-71), so no timer in that process can fire until it returns. Not
 * eval scenarios: nothing is graded on them but that the run is stopped.
 */

import type { EvalScenario } from "@/agent/evals/harness";
import { mn3gaSession, powderPage } from "@/agent/evals/pages";

/** How long the stuck Refine spins before it gives up (a bound, so a process left behind still ends). */
const SPIN_MS = 10 * 60_000;

/** A CPU-bound wait: no await, so nothing else on the thread runs until it ends. */
function spin(ms: number): void {
  const until = Date.now() + ms;
  let n = 0;
  while (Date.now() < until) n++;
  if (n < 0) throw new Error("unreachable");
}

export const STUCK_SCENARIOS: readonly EvalScenario[] = [
  {
    id: "stuck-refine",
    title: "The page's Refine holds the thread",
    origin: "THY-71: a live run sat ~40 min in a moment fit that no per-run timeout could stop.",
    page: () => {
      const port = powderPage(mn3gaSession());
      return {
        ...port,
        refine: () => {
          spin(SPIN_MS);
          return port.refine();
        },
      };
    },
    messages: ["Refine the scale and background."],
    autonomy: "auto",
    checks: [],
  },
];

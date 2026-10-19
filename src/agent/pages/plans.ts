/**
 * A page's changes as plans (types.ts, Plan): one plan per change tool of the
 * page, in a table typed by the tools' own inputs (tools.ts, InputOf), so a
 * page without a plan for one of its change tools does not compile. The
 * plans every page shares (freeing, refining, resetting, going to a History
 * step) are written once here; a page's own go in its tools module.
 */

import type { AgentPort } from "@/agent/port";
import type { InputOf, LiveToolSpec, PageChangeTool } from "@/agent/tools";
import { applyFree, describeFree, freeNoOp, goToStep, matchIds, type ChangeResult } from "@/agent/liveCommon";
import type { PageHost, Plan, StateOf, ToolInput } from "@/agent/pages/types";

/** Nothing to do, and why. */
export const nothing = (why: string): Plan => ({ noOp: why });

/** The card's line, and the change it asks for. */
export const change = (preview: string, apply: (host: PageHost) => ChangeResult | Promise<ChangeResult>): Plan => ({ preview, apply: async (host) => apply(host) });

/** One plan per change tool of the page, each on its tool's input as the schema parses it. */
export type Plans<P extends AgentPort> = { readonly [N in PageChangeTool<P["technique"]>]: (input: InputOf<N>, s: StateOf<P>, port: P) => Plan };

/** A page's plan for a call, from its table. */
export function planFrom<P extends AgentPort>(plans: Plans<P>): (spec: LiveToolSpec, input: ToolInput, s: StateOf<P>, port: P) => Plan {
  // The executor validated the input against this tool's schema, which is what types the table: read it by name.
  const byName = plans as Readonly<Record<string, ((input: ToolInput, s: StateOf<P>, port: P) => Plan) | undefined>>;
  return (spec, input, s, port) => {
    const plan = byName[spec.name];
    if (!plan) throw new Error(`${spec.name} is not a change on this page`);
    return plan(input, s, port);
  };
}

/**
 * A page whose changes are still three switches (a no-op, the card's line,
 * the change): the plan they make. The change validates its input when it is
 * made, after the card, as it did.
 */
export function switchedPlan<P extends AgentPort>(
  noOp: (spec: LiveToolSpec, input: ToolInput, s: StateOf<P>, port: P) => string | null,
  describe: (spec: LiveToolSpec, input: ToolInput, s: StateOf<P>, port: P) => string,
  apply: (name: string, input: ToolInput, port: P, host: PageHost) => Promise<ChangeResult>,
): (spec: LiveToolSpec, input: ToolInput, s: StateOf<P>, port: P) => Plan {
  return (spec, input, s, port) => {
    const why = noOp(spec, input, s, port);
    return why ? nothing(why) : { preview: describe(spec, input, s, port), apply: (host) => apply(spec.name, input, port, host) };
  };
}

// ── the plans every page shares ─────────────────────────────────────────────

/** set_free: the parameter panel's check boxes. */
export function freePlan<P extends AgentPort>(input: InputOf<"set_free">, s: StateOf<P>, port: P): Plan {
  const why = freeNoOp(s.parameters, input);
  return why ? nothing(why) : change(describeFree(s.parameters, input), () => applyFree(s.parameters, input, port.setFixed));
}

/** What a page's refine says and checks of itself. */
export interface RefineOn<P extends AgentPort> {
  /** The card's line for the Refine button, with this many parameters free. */
  readonly fits: (s: StateOf<P>, free: number) => string;
  /** Why the page cannot refine at all, or null. */
  readonly refuse?: (s: StateOf<P>) => string | null;
  /** Notes on a refinement that finished, read off the state it started from. */
  readonly after?: (s: StateOf<P>) => readonly string[];
}

/** refine: the Refine button, or with `mode: "thorough"` the Prefit (no fit yet) or the Escape minimum. */
export function refinePlan<P extends AgentPort>(on: RefineOn<P>): (input: InputOf<"refine">, s: StateOf<P>, port: P) => Plan {
  return (input, s, port) => {
    const refused = on.refuse?.(s);
    if (refused) throw new Error(refused);
    const free = s.parameters.filter((p) => !p.fixed && !p.expression).length;
    if (free === 0) throw new Error("no parameter is free — free some with set_free first");
    const thorough = input.mode === "thorough";
    const preview = thorough ? `${s.result ? "Escape minimum" : "Prefit"} (multi-start) on ${free} free parameter${free === 1 ? "" : "s"}` : on.fits(s, free);
    return change(preview, async () => {
      const why = await (thorough ? port.thorough() : port.refine());
      if (why) return `The refinement did not finish (${why}); the parameters keep their values from before it.`;
      const notes = on.after?.(s) ?? [];
      return notes.length ? notes.join(" ") : undefined;
    });
  };
}

/** reset_parameters: these parameters, or every one, back to their starting values. */
export function resetPlan<P extends AgentPort>(input: InputOf<"reset_parameters">, s: StateOf<P>, port: P): Plan {
  const ids = input.parameters ? matchIds(s.parameters, input.parameters) : undefined;
  return change(ids ? `Reset ${ids.join(", ")} to the starting value` : "Reset every parameter to its starting value", () => {
    port.reset(ids);
    return undefined;
  });
}

/** go_to_step: a History step's state back on the page. */
export function goToPlan(input: InputOf<"go_to_step">): Plan {
  return change(`Go to step ${String(input.step)}`, (host) => {
    goToStep(host, input.step);
    return undefined;
  });
}

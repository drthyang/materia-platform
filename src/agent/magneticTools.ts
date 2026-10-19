/**
 * The Agent tools of the powder page's magnetic analysis step: each one the
 * panel's own control, through its handle (magneticPort.ts). The step's
 * method is the magnetic-analysis skill: the nuclear structure refined first,
 * k from the peaks the nuclear model leaves, the magnetic groups of the
 * little group of k top-down, the moments fitted, then nuclear and magnetic
 * refined together on the refinement step.
 */

import { RANK_TIE_WR } from "@/core/diagnostics/thresholds";
import { RANK_RESTARTS } from "@/core/magnetic/momentRestarts";
import type { Vec3 } from "@/core/math/types";
import type { PowderAgentPort } from "@/agent/port";
import { liveTool, type MagneticChangeTool } from "@/agent/tools";
import type { MagneticAgentHandle, MagneticCandidateView, MagneticPanelState } from "@/agent/magneticPort";
import { sig, type ChangeResult } from "@/agent/liveCommon";
import { change, nothing, type Plans } from "@/agent/pages/plans";

/* eslint-disable @typescript-eslint/no-explicit-any -- inputs are validated against the spec's zod schema before a handler runs */
type Input = any;

export const MAGNETIC_SKILL = "magnetic-analysis";
/** A tool of the magnetic step (its definition says so). */
export const isMagneticTool = (name: string): boolean => !!liveTool(name)?.magneticStep;

function handleOf(port: PowderAgentPort): MagneticAgentHandle {
  const h = port.magnetic?.();
  if (!h) throw new Error("the magnetic analysis step is not available: load a structure with magnetic ions and a powder pattern");
  return h;
}

/** A k component as written: a number, or a fraction such as "1/2". */
export function kComponent(v: number | string): number {
  if (typeof v === "number") return v;
  const t = v.trim().replace("½", "1/2").replace("⅓", "1/3").replace("¼", "1/4");
  const frac = /^(-?\d+)\s*\/\s*(\d+)$/.exec(t);
  const x = frac ? Number(frac[1]) / Number(frac[2]) : Number(t);
  if (!Number.isFinite(x)) throw new Error(`"${v}" is not a k component (a number or a fraction such as 1/2)`);
  return x;
}

/** How simple a k is: its largest denominator, then how many components are not zero (lower is simpler). */
export function simplicity(k: readonly number[]): number {
  const den = (x: number): number => {
    for (const d of [1, 2, 3, 4, 6, 8, 12]) if (Math.abs(x * d - Math.round(x * d)) < 1e-6) return d;
    return 99;
  };
  return 10 * Math.max(...k.map(den)) + k.filter((x) => Math.abs(x) > 1e-9).length;
}

export const kText = (k: Vec3): string => `(${k.map((c) => (Math.abs(c) < 1e-12 ? "0" : sig(c, 4))).join(", ")})`;

function candidateRow(c: MagneticCandidateView): Record<string, unknown> {
  return {
    id: c.id,
    group: c.symbol,
    ...(c.numbers ? { numbers: c.numbers } : {}),
    ...(c.setting ? { setting: c.setting } : {}),
    index: c.index,
    domains: c.domains,
    momentComponents: c.momentDims,
    ...(c.fit ? { fit: c.fit.status === "ok" ? { wR: c.fit.wR !== null ? pct(c.fit.wR) : null, moments: c.fit.moments.map((m) => `${m.site} ${sig(m.muB, 3)} µB`) } : c.fit.status } : {}),
  };
}

const pct = (f: number): number => Math.round(f * 10000) / 100;

/**
 * The magnetic analysis's own next step, from where the step stands: the
 * peaks, the k-search, k, the groups ranked, one chosen, its moments fitted.
 * On the magnetic step this order comes before the powder stages (a model
 * that read only get_state's powder checklist went back to the fit range).
 */
export function magneticNext(s: MagneticPanelState): string {
  if (!s.peaks.some((p) => p.included)) return "no residual peak is used for the k-search: include the magnetic peaks (search_propagation_vector `include`), or the nuclear fit leaves none and there is nothing magnetic to find";
  if (!s.kSearch) return "search_propagation_vector: the k that indexes the residual peaks";
  if (!s.selected) return s.best === null
    ? "set_propagation_vector to the k the search supports (the simplest of equal fits), then rank_magnetic_groups"
    : `choose_magnetic_group (the ranking's best: ${s.best}), then refine_moments`;
  if (s.selected.fitAgreement === null) return "refine_moments: fit the chosen group's moments, the nuclear model held";
  return "the moments are fitted: refine the nuclear and magnetic models together on the refinement step, then report the group, k and the moments with what the powder cannot tell";
}

/** The step as the model reads it: compact, the candidates that can carry a moment first. */
export function magneticView(s: MagneticPanelState): Record<string, unknown> {
  const carrying = s.candidates.filter((c) => c.momentDims > 0);
  const peak = (p: MagneticPanelState["peaks"][number]): Record<string, unknown> => ({
    n: p.n,
    d: sig(p.d, 5),
    ...(p.sigmas !== undefined ? { sigmas: sig(p.sigmas, 3) } : {}),
    ...(p.near ? { near: p.near } : {}),
    ...(p.manual ? { manual: true } : {}),
  });
  // The included peaks whole; of the rest (below 5σ, or on a nuclear
  // reflection) the strongest few and a count: a TOF pattern's low-Q noise
  // can list two dozen 3σ bumps.
  const included = s.peaks.filter((p) => p.included);
  const excluded = s.peaks.filter((p) => !p.included).sort((a, b) => (b.sigmas ?? 0) - (a.sigmas ?? 0));
  return {
    next: magneticNext(s),
    ions: s.ions.map((i) => `${i.label} (${i.element})${i.selected ? " ✓" : ""}`),
    residualPeaks: {
      usedByKSearch: included.map(peak),
      ...(excluded.length > 0 ? { notUsed: `${excluded.length} (below 5σ, or on a nuclear reflection)`, strongestNotUsed: excluded.slice(0, 5).map(peak) } : {}),
    },
    ...(s.kSearch ? { kSearch: s.kSearch.map((c) => ({ k: c.label, matched: `${c.matched}/${c.total}`, rmsd: sig(c.rmsd, 3) })) } : {}),
    k: kText(s.k),
    kKind: s.kDescription,
    ...(s.kUnsupported ? { kUnsupported: s.kUnsupported } : {}),
    candidates: `${s.candidates.length} magnetic groups for this k, ${carrying.length} allowing a moment on the chosen ions`,
    groups: carrying.slice(0, 24).map(candidateRow),
    ...(s.best ? { best: s.best } : {}),
    ...(s.selected
      ? {
        chosen: {
          id: s.selected.id,
          group: s.selected.symbol,
          parameters: s.selected.parameters.map((p) => `${p.id} = ${sig(p.value, 4)}${p.tiedTo ? ` (= ${p.tiedTo})` : ""}`),
          moments: s.selected.moments.map((m) => `${m.site}${m.orbit ? `#${m.orbit}` : ""}: ${sig(m.muB, 3)} µB`),
          ...(s.selected.fitAgreement !== null ? { momentsFitWR: pct(s.selected.fitAgreement) } : {}),
        },
      }
      : {}),
    ties: { sameSite: s.ties.sameSite, magnitudes: s.ties.magnitudes || "off" },
    ...(s.baselineAgreement !== null ? { nuclearOnlyWR: pct(s.baselineAgreement) } : {}),
    canFitMoments: s.canFit,
    canRefineK: s.canRefineK,
  };
}

/**
 * Run a read tool on the magnetic step. The step publishes a fresh handle on
 * every render, its state() fixed at that render: after an await (the ranking
 * fits each group), read through a handle taken after the page has rendered
 * (`settle`), or the answer is the state from before the call.
 */
export async function readMagneticTool(name: string, input: Input, port: PowderAgentPort, settle: () => Promise<void> = async () => undefined): Promise<unknown> {
  const h = handleOf(port);
  switch (name) {
    case "magnetic_state":
      return magneticView(h.state());
    case "search_propagation_vector": {
      const found = h.searchK({
        ...(Array.isArray(input.exclude) ? { exclude: input.exclude as number[] } : {}),
        ...(Array.isArray(input.include) ? { include: input.include as number[] } : {}),
      });
      port.openStep?.(1);
      const all = found.filter((c) => c.matched === c.total);
      const simplest = [...all].sort((a, b) => simplicity(a.k) - simplicity(b.k))[0];
      return {
        candidates: found.map((c) => ({ k: c.label, components: c.k, matched: `${c.matched}/${c.total}`, rmsd: sig(c.rmsd, 3) })),
        ...(simplest ? { simplest: simplest.label } : {}),
        reading: found.length === 0
          ? "No commensurate k (denominators 2, 3, 4, 6) puts satellites on the included peaks."
          : all.length === 0
            ? `No k explains every included peak; the best, ${found[0]!.label}, explains ${found[0]!.matched} of ${found[0]!.total}. Check the peaks it misses: an impurity's lines fit no k.`
            : all.length === 1
              ? `k = ${all[0]!.label} explains every included peak (${all[0]!.total}). Set it with set_propagation_vector.`
              : `${all.length} k explain every included peak (${all.length > 4 ? `${all.slice(0, 4).map((c) => c.label).join(", ")}, …` : all.map((c) => c.label).join(", ")}): with ${all[0]!.total} peaks the search alone cannot decide. The simplest is k = ${simplest!.label} (fewest and smallest fractions), the usual first choice; if no magnetic group fits there, try the next, and say the k is not unique.`,
      };
    }
    case "rank_magnetic_groups": {
      const scope = (input.scope as "open" | "all" | undefined) ?? "open";
      port.openStep?.(1);
      await settle();
      const restarts = typeof input.restarts === "number" ? input.restarts : RANK_RESTARTS;
      await handleOf(port).rank(scope, restarts);
      await settle();
      return { ranked: scope, restarts, ...rankView(handleOf(port).state()) };
    }
    default:
      throw new Error(`${name} is not a magnetic read tool`);
  }
}

function rankView(s: MagneticPanelState): Record<string, unknown> {
  const fitted = s.candidates.filter((c) => c.fit).sort((a, b) => (a.fit!.wR ?? Infinity) - (b.fit!.wR ?? Infinity));
  return {
    groups: fitted.map(candidateRow),
    ...(s.best ? { best: s.best } : {}),
    ...(s.baselineAgreement !== null ? { nuclearOnlyWR: pct(s.baselineAgreement) } : {}),
    reading: s.best
      ? `${s.best} fits best: the lowest wR (a tie within ${100 * RANK_TIE_WR} % goes to the maximal group with the fewest moment parameters). That is no test that the others fit worse: a powder often cannot tell several groups apart. Say which fit about as well and whether each explains every magnetic peak, and choose the maximal one unless the data say otherwise.`
      : "No candidate could be fitted.",
  };
}

/** A change on the step, through the handle the step publishes when it is made, with the step's tab open. */
function onStep(port: PowderAgentPort, make: (h: MagneticAgentHandle) => ChangeResult | Promise<ChangeResult>): () => ChangeResult | Promise<ChangeResult> {
  return () => {
    const h = handleOf(port);
    port.openStep?.(1);
    return make(h);
  };
}

/**
 * The step's changes, one plan each (pages/plans.ts), on the powder page's
 * table (powderTools.ts): what the approval card says, read off the step as
 * it stands, and the change through the panel's own control.
 */
export const MAGNETIC_PLANS: Pick<Plans<PowderAgentPort>, MagneticChangeTool> = {
  set_propagation_vector: (input, _s, port) => {
    const now = handleOf(port).state().k;
    const k = input.k.map(kComponent);
    if (k.every((c, i) => Math.abs(c - now[i]!) < 1e-9)) return nothing(`k is already ${kText(now)}`);
    return change(`Propagation vector ${kText(now)} → ${kText(k as unknown as Vec3)}`, onStep(port, (h) => {
      h.setK([k[0]!, k[1]!, k[2]!]);
      return undefined;
    }));
  },
  select_magnetic_ions: (input, _s, port) => {
    const want = new Set(input.sites);
    const have = new Set(handleOf(port).state().ions.filter((i) => i.selected).map((i) => i.label));
    if (want.size === have.size && [...want].every((l) => have.has(l))) return nothing("those ions are already the chosen ones");
    return change(`Magnetic ions: ${input.sites.join(", ")}`, onStep(port, (h) => {
      h.selectIons(input.sites);
      return undefined;
    }));
  },
  set_moment_ties: (input, _s, port) => {
    if (input.sameSite === undefined && input.magnitudes === undefined) throw new Error("pass `sameSite`, `magnitudes`, or both");
    const { ties } = handleOf(port).state();
    const same = input.sameSite === undefined || input.sameSite === ties.sameSite;
    const mags = input.magnitudes === undefined || (input.magnitudes === "off" ? ties.magnitudes === false : input.magnitudes === ties.magnitudes);
    if (same && mags) return nothing("the moment ties are already set so");
    const preview = [
      ...(input.sameSite !== undefined ? [`same-site moments ${input.sameSite ? "tied" : "independent"}`] : []),
      ...(input.magnitudes !== undefined ? [`|M| tie ${input.magnitudes}`] : []),
    ].join(" · ");
    return change(preview, onStep(port, (h) => {
      h.setTies({
        ...(input.sameSite !== undefined ? { sameSite: input.sameSite } : {}),
        ...(input.magnitudes !== undefined ? { magnitudes: input.magnitudes === "off" ? false : input.magnitudes } : {}),
      });
      return undefined;
    }));
  },
  choose_magnetic_group: (input, _s, port) => {
    const s = handleOf(port).state();
    const id = input.id.trim().toUpperCase();
    if (s.selected?.id === id) return nothing(`${s.selected.id} is already chosen`);
    const c = s.candidates.find((x) => x.id === id);
    return change(`Magnetic group ${input.id}${c ? ` (${c.symbol}, index ${c.index})` : ""}`, onStep(port, (h) => {
      h.choose(input.id);
      return undefined;
    }));
  },
  refine_moments: (_input, _s, port) => {
    const { selected } = handleOf(port).state();
    const preview = selected ? `Fit the moments of ${selected.symbol} (${selected.parameters.length} amplitude${selected.parameters.length === 1 ? "" : "s"}), nuclear model held` : "Fit the moments";
    return change(preview, onStep(port, async (h) => {
      const wR = await h.refineMoments();
      return wR === null ? "The moments fit did not run." : `Moments fitted: wR ${pct(wR)}%.`;
    }));
  },
  show_magnetic_model: (input, _s, port) => {
    const { selected } = handleOf(port).state();
    const preview = input.show === false ? "Remove the magnetic model from the refinement pattern" : `Show ${selected?.symbol ?? "the chosen model"} on the refinement pattern, moments held`;
    return change(preview, onStep(port, (h) => {
      h.apply(input.show !== false);
      return undefined;
    }));
  },
  continue_magnetic_refinement: (input, _s, port) => {
    const { selected } = handleOf(port).state();
    // The refinement step is where it goes: the step's tab is not opened.
    return change(`Add ${selected?.symbol ?? "the chosen model"}'s moment rows${input.refineK ? " and k" : ""} to the refinement page`, () => {
      handleOf(port).continueToRefinement(!!input.refineK);
      return "The model's moment rows are on the refinement page, free; refine there fits nuclear and magnetic together.";
    });
  },
};

/** What the step shows after a change, for the outcome. */
export function magneticOutcome(name: string, port: PowderAgentPort): Record<string, unknown> {
  const h = port.magnetic?.();
  if (!h || name === "continue_magnetic_refinement") return {};
  const v = magneticView(h.state());
  if (name === "refine_moments" || name === "choose_magnetic_group") return { chosen: v.chosen ?? null, ...(v.nuclearOnlyWR !== undefined ? { nuclearOnlyWR: v.nuclearOnlyWR } : {}) };
  if (name === "set_propagation_vector" || name === "select_magnetic_ions" || name === "set_moment_ties") return { k: v.k, kKind: v.kKind, candidates: v.candidates, groups: v.groups };
  return {};
}

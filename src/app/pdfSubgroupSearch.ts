/**
 * The subgroup search (core/diagnostics/subgroupSearch.ts) on the PDF page:
 * the page's own realisation of a class (withSupercellChild, as Activate does
 * it) and its own fit (the Refine button's request), with the search's free
 * set. THY-72, decisions 2, 6, 7, 9 and 10.
 *
 *  - **The fixed context** (decision 10): the parent refined over the data's
 *    whole range (scale, cell, δ1, δ2, one ADP per site); then the cell, δ1,
 *    δ2, Qdamp and Qbroad are held. In the window each fit refines the scale,
 *    the candidate's modes and one ADP per parent site (the child's sites
 *    split from one parent site tied to one row).
 *  - **The window**: rmin just below the first G(r) peak found in the data
 *    (core/totalscattering/firstPeak.ts), rmax 10 Å.
 *  - **The candidates** come from the bound's lattice and its irreps
 *    (supercellLattice.ts, subgroupIrreps.ts), each class by the Subgroups
 *    view's row key: step 1 one per (class, primary irrep), step 2 one per
 *    (class, coupled pair of two irreps), step 3 a class's maximal subgroups.
 *    Every class, the same-cell ones too, is realised in its own cell
 *    (withSupercellChild), so a candidate refines its irreps' modes by parent
 *    irrep whatever its cell.
 *  - **The correlation guard** (decision 2): before a candidate's starts, the
 *    page's probe of its free set at the start; a row of each pair at or over
 *    the limit, and the rows the data cannot determine, are held (an ADP or
 *    the scale before a mode, else the later row), reported and not counted.
 *
 * Nothing here changes the page: every fit is the Refine button's request
 * (pdfProbe) on a copy of the page, returned and never applied.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { applyParameters } from "@/core/workflow/apply";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { nonPositiveDefiniteSites } from "@/core/crystal/adp";
import { bondValenceSums } from "@/core/crystal/bondValence";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { starsInBound } from "@/core/crystal/irreps/factorGroup";
import { rnum } from "@/core/crystal/irreps/rational";
import { periodicityBox } from "@/core/crystal/irreps/childSetting";
import { cachedIrrepsOfStar } from "@/core/crystal/irreps/supercellModes";
import { cachedSupercellSubgroups, keepsSupercell, type SupercellLattice } from "@/core/crystal/irreps/supercellLattice";
import { boundIrreps, subgroupIrreps, type IrrepDirection, type SubgroupIrreps } from "@/core/crystal/irreps/subgroupIrreps";
import { PROBE_OPTIONS, readCorrelations } from "@/core/diagnostics/correlationGuard";
import { firstPeak, type FirstPeak } from "@/core/totalscattering/firstPeak";
import {
  SEARCH_RULES, type FitReading, type IrrepAlong, type PreparedCandidate, type Reference, type SearchCandidate, type SearchHost, type SearchRules, type StartPlan, type Window, type WindowData,
} from "@/core/diagnostics/subgroupSearch";
import { pageView, pdfProbe, withFitRange, withSupercellChild, type PdfCompute, type PdfPageModel, type SupercellChoice } from "@/app/pdfPage";
import { boundGroup } from "@/app/ui/subgroupCache";
import { cellLabel, childName, displacementOf, latticeGraph } from "@/app/ui/subgroupPicker";

/** The fit's options: the Refine button's iteration cap, with every correlation reported (the amplitudes' σ need the covariance). */
const FIT_OPTIONS = { maxIterations: 30, correlationThreshold: 0, maxReportedCorrelations: 100_000 } as const;

const ADP_KINDS = new Set(["bIso"]);

/** A candidate as this page realises it. */
export interface PdfSearchCandidate extends SearchCandidate {
  /** The class's id in the bound's lattice. */
  readonly classId: number;
  /** Activate's choice for it. */
  readonly choice: SupercellChoice;
}

/** The search's fixed context on a page. */
export interface PdfSearchContext {
  readonly host: SearchHost & {
    readonly prepare: (candidate: SearchCandidate, window: Window, under?: PdfSearchCandidate) => ReturnType<SearchHost["prepare"]>;
  };
  /** The parent as the search holds it: refined over the whole range, every row fixed. */
  readonly parent: PdfPageModel;
  /** The parent in the window: the step 1 and 2 reference. */
  readonly reference: Reference;
  readonly window: Window;
  readonly peak: FirstPeak;
  /** The rows the whole-range fit held for correlation. */
  readonly parentHeld: readonly string[];
  /** The whole-range fit's Rw. */
  readonly parentRw: number;
  /** Step 1's candidates (every primary irrep of every class that is not the parent's). */
  readonly singles: readonly PdfSearchCandidate[];
  /** Step 2's pool: every class reached by a coupled pair of two irreps, one candidate per pair. */
  readonly pairs: readonly PdfSearchCandidate[];
  /** A class's maximal subgroups, as step 3 candidates under an accepted one. */
  readonly maximalUnder: (node: PdfSearchCandidate) => PdfSearchCandidate[];
  /** The bound's lattice (for checks). */
  readonly lattice: SupercellLattice;
  readonly keyOf: readonly string[];
}

const valuesOf = (params: readonly RefinementParameter[]): Record<string, number> => Object.fromEntries(params.map((p) => [p.id, p.value]));
const withValues = (m: PdfPageModel, values: Readonly<Record<string, number>>): PdfPageModel => ({ ...m, params: m.params.map((p) => (values[p.id] !== undefined ? { ...p, value: values[p.id]! } : p)), result: null });
const freeing = (m: PdfPageModel, free: (p: RefinementParameter) => boolean): PdfPageModel => ({ ...m, params: m.params.map((p) => (p.expression ? p : { ...p, fixed: !free(p) })) });

/**
 * The correlation guard on a free set (decision 2), one probe at the given
 * page's values: one row of each pair at or over the limit is held, an ADP
 * before a mode, a mode before the scale (never the scale for an ADP), else
 * the later row; and, for each combination the data cannot determine that no
 * mode takes part in, the row (not the scale) that carries most of it.
 * Modes the data cannot determine are left alone, and so is a pair of them:
 * at the parent's geometry a symmetry-breaking mode is stationary (χ² even in
 * its amplitude), its correlations there are round-off, and the gate's
 * amplitude test, not the guard, judges it. Returns the page with the rows
 * held and what was held, why.
 */
async function guarded(client: PdfCompute, m: PdfPageModel): Promise<{ readonly model: PdfPageModel; readonly held: string[] }> {
  const probe = await pdfProbe(client, m, PROBE_OPTIONS);
  const check = readCorrelations(probe, m.params, pageView(m).spec.restraints);
  const order = new Map(m.params.map((p, i) => [p.id, i] as const));
  const kind = new Map(m.params.map((p) => [p.id, p.kind] as const));
  const isMode = (id: string): boolean => kind.get(id) === "positionShift";
  const undetermined = new Set(check.undetermined);
  /** Which row of a pair to hold first: an ADP, then a mode, then anything else, the scale last. */
  const rank = (id: string): number => (ADP_KINDS.has(kind.get(id) ?? "") ? 0 : isMode(id) ? 1 : kind.get(id) === "pdfScale" ? 3 : 2);
  const hold = new Set<string>();
  const held: string[] = [];
  for (const pair of check.correlated) {
    if (hold.has(pair.a) || hold.has(pair.b)) continue;
    if (isMode(pair.a) && isMode(pair.b) && (undetermined.has(pair.a) || undetermined.has(pair.b))) continue;
    const pick = rank(pair.a) !== rank(pair.b) ? (rank(pair.a) < rank(pair.b) ? pair.a : pair.b) : order.get(pair.a)! > order.get(pair.b)! ? pair.a : pair.b;
    hold.add(pick);
    held.push(`${pick} (${pair.a} ↔ ${pair.b} ${pair.coefficient.toFixed(3)})`);
  }
  // A combination the data cannot determine: when a mode takes part in it, it is the mode's stationarity (left to the
  // gate); otherwise the non-mode row that carries most of it is held, one row per such combination.
  for (const direction of probe.diagnostics?.nullDirections ?? []) {
    const parts = Object.entries(direction);
    if (parts.some(([id, c]) => isMode(id) && Math.abs(c) >= 0.1)) continue;
    const pick = parts.filter(([id]) => !hold.has(id) && kind.get(id) !== "pdfScale").sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0];
    if (pick === undefined) continue;
    hold.add(pick);
    held.push(`${pick} (not determined by the data)`);
  }
  return { model: hold.size === 0 ? m : { ...m, params: m.params.map((p) => (hold.has(p.id) ? { ...p, fixed: true } : p)) }, held };
}

const freeCount = (m: PdfPageModel): number => m.params.filter((p) => !p.fixed && !p.expression).length;

/** A fit's Rw, with non-numbers kept as NaN. */
const rwOfResult = (r: RefinementResult): number => r.agreement.rWeighted ?? NaN;

/** Every pattern point inside a window, and Σ Gobs² there. */
function windowDataOf(m: PdfPageModel, w: Window): WindowData {
  let nGrid = 0;
  let sumObs2 = 0;
  for (const p of m.pattern.points) {
    if (p.r < w.rmin || p.r > w.rmax) continue;
    nGrid++;
    sumObs2 += p.gObs * p.gObs;
  }
  return { nGrid, sumObs2 };
}

const fitRangeOf = (w: Window) => ({ min: w.rmin, max: w.rmax });

/**
 * The search's context on a page: the parent refined over the whole range
 * (unless `refineParent` is false: the page's refined state as it is), the
 * window from the first peak, the reference fit in it, and the candidates of
 * the bound. Throws when the data carry no Qmax, have no first peak, or the
 * bound has no factor group.
 */
export async function pdfSearchContext(
  client: PdfCompute,
  page: PdfPageModel,
  bound: SupercellSpec,
  opts: { readonly refineParent?: boolean; readonly window?: Partial<Window>; readonly rules?: SearchRules } = {},
): Promise<PdfSearchContext> {
  const rules = opts.rules ?? SEARCH_RULES;
  const qmax = page.pattern.qmax;
  if (!(qmax !== undefined && qmax > 0)) throw new Error("the data carry no Qmax: N_ind = (rmax − rmin)·Qmax/π needs the data's own Qmax");
  if (page.modes !== null || page.extraPhases.length > 0 || page.spinModel !== null) throw new Error("the search starts from the parent alone: one phase, no modes in force, no spin model");
  const points = page.pattern.points;
  const rs = points.map((p) => p.r);
  const peak = firstPeak(rs, points.map((p) => p.gObs), rules.rmax);
  if (!peak) throw new Error("no first G(r) peak was found in the data");
  const window: Window = { rmin: opts.window?.rmin ?? peak.below, rmax: opts.window?.rmax ?? rules.rmax };
  const pageKinds = new Set(["pdfScale", "cellLength", "cellAngle", "delta1", "delta2", ...ADP_KINDS]);
  let parent = page;
  let parentHeld: string[] = [];
  let parentRw = pageView(page).rw;
  if (opts.refineParent ?? true) {
    const whole = withFitRange(freeing(page, (p) => pageKinds.has(p.kind)), { min: rs[0]!, max: rs[rs.length - 1]! });
    const g = await guarded(client, whole);
    parentHeld = g.held;
    const fit = await pdfProbe(client, g.model, { maxIterations: 30 });
    parent = withValues(g.model, fit.parameters);
    parentRw = rwOfResult(fit);
  }
  parent = freeing(withFitRange(parent, fitRangeOf(window)), () => false);

  // The parent in a window: the scale and one ADP per site.
  const parentStart = freeing(parent, (p) => p.kind === "pdfScale" || ADP_KINDS.has(p.kind));
  const parentGuard = await guarded(client, parentStart);
  const parentFree = parentGuard.model;
  const parentFits = new Map<string, Promise<FitReading>>();
  const reference: Reference = {
    label: `${page.loaded.spaceGroup.hermannMauguin ?? "parent"}${page.loaded.spaceGroup.number !== undefined ? ` #${page.loaded.spaceGroup.number}` : ""} (parent)`,
    parameters: freeCount(parentFree),
    refit: (w) => {
      const key = `${w.rmin}|${w.rmax}`;
      let hit = parentFits.get(key);
      if (!hit) {
        hit = (async () => {
          const m = withFitRange(parentFree, fitRangeOf(w));
          return readingOf(m, await pdfProbe(client, m, FIT_OPTIONS), []);
        })();
        parentFits.set(key, hit);
      }
      return hit;
    },
  };

  // The bound's lattice and irreps, as the Subgroups view lists them.
  const fg = boundGroup(page.loaded.spaceGroup.operations, bound);
  if (!fg.group) throw new Error(`the bound has no factor group${fg.error ? `: ${fg.error}` : ""}`);
  const group = fg.group;
  const lattice = cachedSupercellSubgroups(group);
  const ks = starsInBound(group).map((k): [number, number, number] => [rnum(k[0]), rnum(k[1]), rnum(k[2])]);
  const stars = ks.map((k) => cachedIrrepsOfStar(group, k));
  const disp = displacementOf(page.loaded, group);
  const multiplicity = disp?.multiplicity;
  const analysis: readonly SubgroupIrreps[] = subgroupIrreps(group, boundIrreps(group, stars), lattice, multiplicity ? { multiplicity } : {});
  const keyOf = latticeGraph(lattice, page.loaded.spaceGroup.operations).nodes.map((n) => n.key);
  const moves = (d: IrrepDirection): boolean => (multiplicity ? multiplicity(d.irrep) > 0 : true);
  const along = (d: IrrepDirection): IrrepAlong => ({ label: d.irrep.irrep.label, direction: d.direction });

  const singleOf = (classId: number, d: IrrepDirection, freeIrreps?: readonly IrrepAlong[]): PdfSearchCandidate => {
    const cls = lattice.classes[classId]!;
    const own = keepsSupercell(group, d.subgroup.elements);
    const elements = own ? d.subgroup.elements : cls.elements;
    const identity = own ? d.subgroup.identity : cls.identity!;
    const irreps = [along(d)];
    return {
      key: `${keyOf[classId]}:${irreps.map((x) => `${x.label} ${x.direction}`).join(" + ")}`,
      classKey: keyOf[classId]!,
      classId,
      group: childName(identity),
      cell: cellLabel(periodicityBox(group, elements)),
      index: cls.domainStates,
      irreps,
      freeIrreps: freeIrreps ?? irreps,
      moves: moves(d),
      choice: { group, elements, identity, primary: d.irrep.irrep.characters },
    };
  };
  const coupledOf = (classId: number, set: readonly IrrepDirection[], freeIrreps?: readonly IrrepAlong[]): PdfSearchCandidate => {
    const cls = lattice.classes[classId]!;
    const irreps = set.map(along);
    return {
      key: `${keyOf[classId]}:${irreps.map((x) => `${x.label} ${x.direction}`).join(" + ")}`,
      classKey: keyOf[classId]!,
      classId,
      group: childName(cls.identity),
      cell: cellLabel(periodicityBox(group, cls.elements)),
      index: cls.domainStates,
      irreps,
      freeIrreps: freeIrreps ?? irreps,
      moves: set.every(moves),
      choice: { group, elements: cls.elements, identity: cls.identity!, coupled: set.map((d) => d.irrep.irrep.characters) },
    };
  };
  const named = (id: number): boolean => lattice.classes[id]!.kind !== "parent" && lattice.classes[id]!.identity !== undefined;
  const singles: PdfSearchCandidate[] = [];
  const pairs: PdfSearchCandidate[] = [];
  for (const cls of lattice.classes) {
    if (!named(cls.id)) continue;
    const r = analysis[cls.id]!;
    for (const d of r.primary) singles.push(singleOf(cls.id, d));
    for (const set of [...(r.coupled ? [r.coupled] : []), ...r.otherCoupled]) if (set.length === 2) pairs.push(coupledOf(cls.id, set));
  }
  const maximalUnder = (node: PdfSearchCandidate): PdfSearchCandidate[] => {
    const out: PdfSearchCandidate[] = [];
    for (const cls of lattice.classes) {
      if (!cls.coveredBy.includes(node.classId) || !named(cls.id)) continue;
      const r = analysis[cls.id]!;
      const own = r.primary[0] ? [r.primary[0]] : r.coupled ?? [];
      if (own.length === 0) continue;
      const labels = new Set(node.freeIrreps.map((x) => x.label));
      const free = [...node.freeIrreps, ...own.map(along).filter((x) => !labels.has(x.label))];
      const c = own.length === 1 ? singleOf(cls.id, own[0]!, free) : coupledOf(cls.id, own, free);
      // Step 3's order parameter is what the class adds to its parent; it moves atoms when that does.
      const added = own.filter((d) => !labels.has(d.irrep.irrep.label));
      out.push({ ...c, irreps: added.length > 0 ? added.map(along) : c.irreps, moves: added.length > 0 ? added.every(moves) : c.moves });
    }
    return out;
  };

  const prepare = async (candidate: SearchCandidate, w: Window): Promise<PreparedCandidate | { readonly failed: string }> => {
    const c = candidate as PdfSearchCandidate;
    const act = withSupercellChild(withFitRange(parent, fitRangeOf(w)), c.choice);
    if (act.model.modes === null || act.model === parent) return { failed: act.message };
    const m0 = act.model;
    const v0 = pageView(m0);
    const set = m0.modes!.set;
    const freeLabels = new Set(c.freeIrreps.map((x) => x.label));
    const primaryLabels = new Set(c.irreps.map((x) => x.label));
    const modeIds = set.modes.filter((mode) => mode.irrep && freeLabels.has(mode.irrep.label)).map((mode) => mode.id);
    if (modeIds.length === 0) return { failed: "the child has no mode of its order parameter's irreps" };
    // One ADP per parent site: the child's sites by the parent site they split from.
    const refined = applyParameters(pageView(parent).fitStructure, pageView(parent).bindings, valuesOf(parent.params)).model;
    const realised = realiseChild(refined, c.choice.group, c.choice.elements, c.choice.identity);
    const parentSiteOf = new Map(realised.sites.map((s) => [s.label, s.parentSite] as const));
    const siteOfRow = new Map(v0.bindings.filter((b) => ADP_KINDS.has(b.kind) && b.targetKey !== undefined).map((b) => [b.parameterId, b.targetKey!] as const));
    const leaderOf = new Map<string, string>();
    const ties = new Map<string, string>();
    for (const p of m0.params) {
      if (!ADP_KINDS.has(p.kind)) continue;
      const site = parentSiteOf.get(siteOfRow.get(p.id) ?? "") ?? siteOfRow.get(p.id) ?? p.id;
      const leader = leaderOf.get(site);
      if (leader === undefined) leaderOf.set(site, p.id);
      else ties.set(p.id, leader);
    }
    const modeSet = new Set(modeIds);
    const start: PdfPageModel = {
      ...m0,
      params: m0.params.map((p) => {
        if (ties.has(p.id)) return { ...p, fixed: true, expression: `= ${ties.get(p.id)}` };
        if (p.kind === "positionShift") return modeSet.has(p.id) ? { ...p, fixed: false } : { ...p, value: 0, fixed: true };
        return { ...p, fixed: !(p.kind === "pdfScale" || (ADP_KINDS.has(p.kind) && !ties.has(p.id))) };
      }),
    };
    const cell = v0.fitStructure.cell;
    const axesOf = new Map(set.modes.map((mode) => [mode.id, mode.axes] as const));
    /** The largest displacement (Å) of a site at these mode values. */
    const maxDisplacement = (values: Readonly<Record<string, number>>): number => {
      const bySite = new Map<string, [number, number, number]>();
      for (const id of modeIds) {
        const a = values[id] ?? 0;
        if (a === 0) continue;
        for (const ax of axesOf.get(id) ?? []) {
          const d = bySite.get(ax.siteLabel) ?? [0, 0, 0];
          bySite.set(ax.siteLabel, [d[0] + a * ax.axis[0], d[1] + a * ax.axis[1], d[2] + a * ax.axis[2]]);
        }
      }
      let worst = 0;
      for (const d of bySite.values()) worst = Math.max(worst, Math.hypot(...fractionalToCartesian(cell, d)));
      return worst;
    };
    const preparedOf = (model: PdfPageModel, held: readonly string[]): PreparedCandidate => {
      const free = new Set(model.params.filter((p) => !p.fixed && !p.expression).map((p) => p.id));
      const keptModes = modeIds.filter((id) => free.has(id));
      const startValues = valuesOf(model.params);
      const adpLeaders = [...leaderOf.values()].filter((id) => free.has(id));
      const primaryModes = new Map<string, string[]>();
      for (const mode of set.modes) if (mode.irrep && primaryLabels.has(mode.irrep.label) && free.has(mode.id)) primaryModes.set(mode.irrep.label, [...(primaryModes.get(mode.irrep.label) ?? []), mode.id]);
      const fitAt = async (values: Readonly<Record<string, number>>, w2: Window): Promise<FitReading> => {
        const m = withFitRange(withValues(model, values), fitRangeOf(w2));
        return readingOf(m, await pdfProbe(client, m, FIT_OPTIONS), [...primaryModes.entries()], maxDisplacement);
      };
      return {
        parameters: free.size,
        modeIds: keptModes,
        heldByGuard: held,
        fit: (plan: StartPlan, w2: Window) => {
          const values: Record<string, number> = { ...startValues };
          if (plan.kick > 0 && plan.direction.length === keptModes.length) {
            const unit: Record<string, number> = {};
            keptModes.forEach((id, i) => (unit[id] = plan.direction[i]!));
            const size = maxDisplacement(unit);
            if (size > 0) keptModes.forEach((id, i) => (values[id] = values[id]! + (plan.kick / size) * plan.direction[i]!));
          }
          if (plan.adpFactor !== 1) for (const id of adpLeaders) values[id] = values[id]! * plan.adpFactor;
          return fitAt(values, w2);
        },
        refitFrom: (values, w2) => fitAt(values, w2),
        guard: async (values) => {
          if (held.length > 0) return null;
          const g = await guarded(client, withFitRange(withValues(model, values), fitRangeOf(w)));
          if (g.held.length === 0) return null;
          // A held mode is held at 0 (the activation's start elsewhere), an ADP at the parent's value.
          const heldIds = new Set(g.model.params.filter((p, i) => p.fixed && !model.params[i]!.fixed).map((p) => p.id));
          return preparedOf({ ...model, params: model.params.map((p) => (heldIds.has(p.id) ? { ...p, fixed: true, ...(p.kind === "positionShift" ? { value: 0 } : {}) } : p)) }, g.held);
        },
      };
    };
    return preparedOf(start, []);
  };

  const host = {
    qmax,
    windowData: (w: Window) => windowDataOf(page, w),
    prepare,
  };
  return { host, parent, reference, window, peak, parentHeld, parentRw, singles, pairs, maximalUnder, lattice, keyOf };
}

/** What the search reads off one fit. */
function readingOf(m: PdfPageModel, res: RefinementResult, primary: readonly (readonly [string, readonly string[]])[], maxDisplacement?: (values: Readonly<Record<string, number>>) => number): FitReading {
  const values = res.parameters;
  const corr = new Map<string, number>();
  for (const c of res.diagnostics?.highCorrelations ?? []) {
    corr.set(`${c.parameterIdA}|${c.parameterIdB}`, c.coefficient);
    corr.set(`${c.parameterIdB}|${c.parameterIdA}`, c.coefficient);
  }
  const amplitudes = primary.map(([label, ids]) => {
    const a = ids.map((id) => values[id] ?? 0);
    const amplitude = Math.hypot(...a);
    const s = ids.map((id) => res.esd[id]);
    let esd = NaN;
    if (s.every((x) => x !== undefined && Number.isFinite(x) && x > 0)) {
      if (ids.length === 1) esd = s[0]!;
      else if (amplitude > 0) {
        let variance = 0;
        for (let i = 0; i < ids.length; i++) {
          for (let j = 0; j < ids.length; j++) {
            const rho = i === j ? 1 : corr.get(`${ids[i]}|${ids[j]}`) ?? 0;
            variance += (a[i]! / amplitude) * (a[j]! / amplitude) * rho * s[i]! * s[j]!;
          }
        }
        esd = Math.sqrt(Math.max(variance, 0));
      }
    }
    return { label, amplitude, esd };
  });
  let structure: StructureModel | null;
  try {
    const v = pageView(m);
    structure = applyParameters(v.fitStructure, v.bindings, values).model;
  } catch {
    structure = null;
  }
  const nonPositive = structure ? [...nonPositiveDefiniteSites(structure), ...structure.sites.filter((s) => s.adp.kind === "isotropic" && !(s.adp.bIso > 0)).map((s) => s.label)] : [];
  const bvs = structure ? bondValenceSums(structure).map((b) => ({ site: b.site, deviation: b.deviation })) : [];
  return {
    rw: rwOfResult(res),
    converged: res.status === "converged",
    status: res.status,
    values,
    amplitudes,
    maxDisplacement: maxDisplacement ? maxDisplacement(values) : 0,
    nonPositiveAdp: nonPositive,
    bondValence: bvs,
    ...(res.message ? { message: res.message } : {}),
  };
}

/** Step 3's reference: an accepted candidate refitted from its best values. */
export function acceptedReference(ctx: PdfSearchContext, candidate: PdfSearchCandidate, best: FitReading, p: number): Reference {
  let prepared: ReturnType<SearchHost["prepare"]> | null = null;
  const cache = new Map<string, Promise<FitReading>>();
  return {
    label: `${candidate.group} (${candidate.freeIrreps.map((x) => `${x.label} ${x.direction}`).join(" + ")})`,
    parameters: p,
    refit: (w) => {
      const key = `${w.rmin}|${w.rmax}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = (async () => {
          prepared ??= ctx.host.prepare(candidate, ctx.window);
          const pc = await prepared;
          if ("failed" in pc) throw new Error(pc.failed);
          return pc.refitFrom(best.values, w);
        })();
        cache.set(key, hit);
      }
      return hit;
    },
  };
}

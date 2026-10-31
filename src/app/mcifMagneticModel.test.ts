import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMagneticCif } from "@/parsers/cif";
import { syntheticMcif } from "@/testSupport/syntheticMcif";
import {
  changed, emptyPage, magneticModelSummary, powderPageCurves, residualPeaksOf, withMagneticPreview, withParameter, withPattern, withStructure, type PowderPage,
} from "@/app/powderPage";
import type { Session } from "@/app/powderSession";
import { magneticHandle } from "@/testSupport/magneticHeadless";
import { isMagneticModelParameterKind, isMomentParameterKind } from "@/core/refinement/types";
import { parameterGroupOf } from "@/app/ui/parameterGroups";
import { magneticPhaseTicks } from "@/visualization/reflectionTicks";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { powderResidual } from "@/core/diagnostics/powderResidual";
import { unexplainedPeaks } from "@/core/diagnostics/unexplainedPeaks";
import { refinedPhasesOf } from "@/app/powderPage";
import { magneticView } from "@/agent/magneticTools";
import { SummaryCards } from "@/app/ui/SummaryCards";

/**
 * THY-45: an mCIF on the powder page. Its magnetic model is a removable chip
 * on the Structure card, its moments are rows (the Magnetic group, held), and
 * the k-search matches the residual against what the calculated pattern
 * includes — magnetic ticks alone never explain a peak. The fixture is a
 * synthetic body-centred antiferromagnet (testSupport/syntheticMcif.ts): its
 * magnetic peaks sit on the h + k + l odd positions the nuclear lattice forbids.
 */

const mcifPage = (moment = 3): PowderPage => {
  const { structure, magnetic } = parseMagneticCif(syntheticMcif(moment), "loaded");
  return withStructure(emptyPage(), structure, magnetic ?? undefined);
};

/** Data simulated from the mCIF's own model (nuclear + magnetic, its moments at 3 µB), on the page. */
const withData = (p: PowderPage, truth: PowderPage = mcifPage()): PowderPage => {
  const s = truth.session;
  const yCalc = powderPageCurves(s).curves.yCalc;
  const pattern = { ...s.pattern, id: "obs", name: "obs.xye", points: s.pattern.points.map((pt, i) => ({ x: pt.x, yObs: yCalc[i]!, sigma: Math.sqrt(Math.max(yCalc[i]!, 1)) })) };
  return withPattern(p, pattern, { name: "obs.xye", text: "" });
};

const momentRows = (s: Session) => s.powderParams.filter((r) => isMomentParameterKind(r.kind));
const ticksOf = (s: Session) => (s.magnetic ? magneticPhaseTicks(s.structure, applyMagneticMoments(s.magnetic, s.powderBindings, Object.fromEntries(s.powderParams.map((r) => [r.id, r.value]))), 1, 6, (d) => d, { id: "magnetic", label: "magnetic", color: "#000" }).ticks : []);
const stepOn = (s: Session) => {
  let cur = s;
  return { handle: magneticHandle(() => ({ session: cur, window: null }), (next) => { cur = next; }, () => undefined), get session() { return cur; } };
};

describe("an mCIF loaded on the powder page", () => {
  it("shows its model as a chip (k, group), its moments as held Magnetic rows, and its ticks", () => {
    const s = withData(mcifPage()).session;
    const summary = magneticModelSummary(s)!;
    expect(summary.kLabel).toBe("(0 0 0)");
    expect(summary.group).toBe("P_S-1");
    expect(summary.inCalc).toBe(true);
    const rows = momentRows(s);
    expect(rows.length).toBeGreaterThan(0);
    expect(summary.rows).toBe(rows.length);
    // The owner's rule: the moments refine with the nuclear model held, so nothing is freed on load.
    expect(rows.every((r) => r.fixed)).toBe(true);
    expect(summary.free).toBe(0);
    expect(new Set(rows.map((r) => parameterGroupOf(r.kind)))).toEqual(new Set(["Magnetic"]));
    // The rows reproduce the file's moment: 3 µB along c.
    const live = applyMagneticMoments(s.magnetic!, s.powderBindings, Object.fromEntries(s.powderParams.map((r) => [r.id, r.value])));
    expect(live.moments[0]!.components[2]).toBeCloseTo(3, 6);
    expect(ticksOf(s).length).toBeGreaterThan(0);
    // The Structure card renders the chip with a remove button.
    const html = renderToStaticMarkup(createElement(SummaryCards, { cards: [{ label: "Structure", loadLabel: "Add CIF…", accept: ".cif", onFile: () => undefined, chip: "✓ parsed", title: "x", meta: "", magneticBadge: { label: `magnetic · k = ${summary.kLabel} · ${summary.group}`, title: "t", onRemove: () => undefined } }] }));
    expect(html).toContain("magnetic-model-chip");
    expect(html).toContain("magnetic · k = (0 0 0) · P_S-1");
    expect(html).toContain('aria-label="Remove the magnetic model"');
    expect(html).toContain("wb-chip-x");
  });

  it("keeps the rows, held, when the data come after the mCIF", () => {
    const before = mcifPage().session;
    const freed = changed(mcifPage(), { ...before, powderParams: before.powderParams.map((r) => (isMomentParameterKind(r.kind) ? { ...r, fixed: false } : r)) });
    const s = withData(freed).session;
    expect(momentRows(s).length).toBe(momentRows(before).length);
    expect(momentRows(s).every((r) => r.fixed)).toBe(true);
  });

  it("removed, leaves no chip, no rows, no ticks and no magnetic contribution to the calculated pattern", () => {
    const s0 = withData(mcifPage()).session;
    const s = withMagneticPreview(s0, null);
    expect(magneticModelSummary(s)).toBeNull();
    expect(s.magnetic).toBeUndefined();
    expect(s.powderParams.some((r) => isMagneticModelParameterKind(r.kind))).toBe(false);
    expect(s.powderBindings.some((b) => isMagneticModelParameterKind(b.kind))).toBe(false);
    expect(ticksOf(s)).toEqual([]);
    const c = powderPageCurves(s);
    expect(c.curves.yCalc).toEqual(c.nuclear.yCalc);
    // The nuclear rows are untouched.
    expect(s.powderParams).toEqual(s0.powderParams.filter((r) => !isMagneticModelParameterKind(r.kind)));
  });
});

describe("the k-search with an mCIF's model", () => {
  it("finds k from the magnetic peaks once the model is removed", () => {
    const step = stepOn(withMagneticPreview(withData(mcifPage()).session, null));
    const st = step.handle.state();
    expect(st.applied).toBeNull();
    // The magnetic peaks sit apart from every nuclear line, or are resolved from it: none is taken as explained.
    const included = st.peaks.filter((p) => p.included);
    expect(included.length).toBeGreaterThanOrEqual(3);
    expect(included.every((p) => p.near === undefined || p.near.endsWith("resolved from it"))).toBe(true);
    const found = step.handle.searchK();
    expect(found[0]!.label).toBe("(0 0 0)");
    expect(found[0]!.matched).toBe(found[0]!.total);
  });

  it("with the model loaded, shows its k and re-runs the search from the nuclear-only residual", () => {
    const s = withData(mcifPage()).session;
    // The model's moments are in the calculation: its peaks leave no residual there.
    expect(residualPeaksOf(s, undefined)).toEqual([]);
    const step = stepOn(s);
    const st = step.handle.state();
    expect(st.applied).toEqual({ kLabel: "(0 0 0)", group: "P_S-1", inCalc: true });
    expect(st.residualFrom).toBe("calc");
    const view = magneticView(st);
    expect(view.appliedModel).toMatchObject({ k: "(0 0 0)", group: "P_S-1", momentsInCalc: true });
    expect(String(view.next)).toContain("nuclearOnly");
    const found = step.handle.searchK({ nuclearOnly: true });
    expect(step.handle.state().residualFrom).toBe("nuclear");
    expect(found[0]!.label).toBe("(0 0 0)");
    expect(found[0]!.matched).toBe(found[0]!.total);
    expect(found[0]!.total).toBeGreaterThanOrEqual(3);
    // The model stays on the page: the switch only reads another residual.
    expect(step.session.magnetic).toBeDefined();
  });

  it("is not fooled by a loaded model whose moments are zero: its ticks explain nothing", () => {
    // The data carry 3 µB; the page's model has its moment row at 0.
    let s = withData(mcifPage()).session;
    for (const r of momentRows(s)) s = withParameter(s, r.id, { value: 0 });
    expect(magneticModelSummary(s, applyMagneticMoments(s.magnetic!, s.powderBindings, Object.fromEntries(s.powderParams.map((r) => [r.id, r.value]))))!.inCalc).toBe(false);
    const c = powderPageCurves(s);
    expect(c.curves.yCalc).toEqual(c.nuclear.yCalc);
    // The magnetic step: every magnetic peak is still in the residual, and the search finds k.
    const step = stepOn(s);
    const included = step.handle.state().peaks.filter((p) => p.included);
    expect(included.length).toBeGreaterThanOrEqual(3);
    const found = step.handle.searchK();
    expect(found[0]!.label).toBe("(0 0 0)");
    expect(found[0]!.matched).toBe(found[0]!.total);
    // The judgment tools: the model's satellites are no line of the model while its moments are zero.
    const live = applyMagneticMoments(s.magnetic!, s.powderBindings, Object.fromEntries(s.powderParams.map((r) => [r.id, r.value])));
    const d = c.curves.x.map((tt) => 1.54 / (2 * Math.sin((tt * Math.PI) / 360)));
    const residual = powderResidual({ curves: c.curves, d, pattern: s.pattern, phases: refinedPhasesOf(s), fitRange: null, magnetic: live }).residual;
    expect(residual.reflections.some((r) => /magnetic/.test(r.phaseLabel))).toBe(false);
    const peaks = unexplainedPeaks(residual);
    expect(peaks.unexplained.length).toBeGreaterThanOrEqual(3);
    expect(peaks.misfits.some((p) => /magnetic/.test(p.near ?? ""))).toBe(false);
    // With the moments in, the same peaks are the model's lines.
    const full = withData(mcifPage()).session;
    const fullCurves = powderPageCurves(full).curves;
    const withModel = powderResidual({ curves: fullCurves, d, pattern: full.pattern, phases: refinedPhasesOf(full), fitRange: null, magnetic: full.magnetic! }).residual;
    expect(withModel.reflections.some((r) => /magnetic/.test(r.phaseLabel))).toBe(true);
  });
});

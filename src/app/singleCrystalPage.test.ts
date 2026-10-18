import { describe, it, expect } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import { headlessHistory, singleCrystalPort } from "@/testSupport/agentHeadless";
import { chiralPage, corundumPage, pyridylPage } from "@/testSupport/scPages";
import type { DistanceRestraint } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import {
  pageView, singleCrystalFit, singleCrystalPage, withAdpModel, withDataset, withExtinctionModel, withFit, withFixed, withHand, withMagneticModel, withMerged,
  withOmitted, withOutlierFilter, withRadiation, withResolution, withRestraints, withRiding, withTwinLaws, withWeighting, workspaceOf,
  type SingleCrystalPageModel,
} from "@/app/singleCrystalPage";

/**
 * The single-crystal page's operations, which the workbench and the Agent's
 * headless page both call. The headless page once kept its own copy: an ADP
 * switch there rebuilt the model from the structure as loaded (the hand and
 * the restraints lost), it had no History state (go_to_step left it as it
 * was), and the workbench's own ADP switch rebuilt the rows without the riding
 * rules (the hydrogens' rows came back, the torsions left).
 */

const MODULATED = { kText: ["1/4", "0", "1/4"], ionState: {}, moment: 1, seed: 1, restarts: 8 } as const;

/** A DFIX on the Ga–N bond of the chiral complex. */
const GA_N: DistanceRestraint = { kind: "dfix", target: 2.0, sigma: 0.02, pairs: [{ from: "Ga2", to: "N1", op: 0, cell: [0, 0, 0] }] };

/** The page's rows are its spec's, the magnetic model's rows after them. */
function rowIds(m: SingleCrystalPageModel): { readonly rows: string[]; readonly spec: string[] } {
  return { rows: m.params.filter((p) => p.kind !== "momentMode").map((p) => p.id), spec: pageView(m).spec.params.map((p) => p.id) };
}

describe("the single-crystal page's changes", () => {
  it("inverts the hand, then switches the ADPs: the hand and the restraints stay (the headless page lost both)", () => {
    const chiral = chiralPage();
    let m = withRestraints(singleCrystalPage(chiral.structure, chiral.dataset), [GA_N]);
    m = withHand(m).model;
    const inverted = pageView(m).fitStructure;
    expect(inverted.sites[0]!.position).not.toEqual(chiral.structure.sites[0]!.position);
    m = withAdpModel(m, true);
    const after = pageView(m).fitStructure;
    expect(after.sites.map((s) => s.position)).toEqual(inverted.sites.map((s) => s.position));
    expect(after.spaceGroup).toBe(inverted.spaceGroup);
    expect(after.restraints).toEqual(inverted.restraints);
    expect(after.sites.filter((s) => s.adp.kind === "anisotropic").length).toBeGreaterThan(0);

    // The headless page, through the Agent's port.
    const { port } = singleCrystalPort(chiral.structure, chiral.dataset);
    port.setDistanceRestraints!([GA_N]);
    port.invertStructure!();
    const flipped = port.state().structure;
    port.setAdpModel!(true);
    expect(port.state().structure.sites.map((s) => s.position)).toEqual(flipped.sites.map((s) => s.position));
    expect(port.state().structure.restraints).toHaveLength(1);
    expect(port.state().inverted).toBeDefined();
  });

  it("switches the ADPs with the hydrogens riding: the torsion stays, the hydrogens' own rows stay out (the workbench brought them back)", () => {
    const pyridyl = pyridylPage();
    const { model: riding } = withRiding(singleCrystalPage(pyridyl.structure, pyridyl.dataset), true);
    expect(riding.params.filter((p) => p.kind === "ridingTorsion")).toHaveLength(1);
    const m = withAdpModel(riding, true);
    expect(m.params.filter((p) => p.kind === "ridingTorsion")).toHaveLength(1);
    const { rows, spec } = rowIds(m);
    expect(rows).toEqual(spec);
  });

  it("keeps a magnetic model's rows through a twin law, a merge, the ADP switch and another file; refuses to invert under it", () => {
    const c = corundumPage({ batches: [1, 0.9] });
    const magnetic: MagneticModel = { id: "mag", structureId: c.structure.id, propagation: [[0, 0, 0]], moments: [{ siteLabel: "Al1", frame: "crystallographic", components: [0, 0, 1] }] };
    const moment: RefinementParameter = { id: "m_Al1", label: "Al1 m", kind: "momentMode", value: 1.5, initialValue: 1, fixed: false };
    const binding: ParameterBinding = { parameterId: "m_Al1", kind: "momentMode", targetId: "mag", targetKey: "Al1" };
    let m = withMagneticModel(singleCrystalPage(c.structure, c.dataset), magnetic, [moment], [binding]);
    const kept = (label: string): void => {
      expect(m.params.filter((p) => p.kind === "momentMode"), label).toEqual([moment]);
      expect(m.momentBindings, label).toEqual([binding]);
      expect(m.magnetic, label).toBe(magnetic);
      const { rows, spec } = rowIds(m);
      expect(rows, label).toEqual(spec);
    };
    kept("applied");
    m = withTwinLaws(m, [{ matrix: [[0, 1, 0], [1, 0, 0], [0, 0, -1]] }]);
    kept("twin");
    m = withMerged(m, true);
    kept("merged");
    m = withAdpModel(m, true);
    kept("ADPs");
    m = withDataset(m, corundumPage({ seed: 3 }).dataset);
    kept("another file");
    expect(() => withHand(m)).toThrow(/magnetic model is applied/);
    m = withMagneticModel(m, null);
    expect(m.params.filter((p) => p.kind === "momentMode")).toEqual([]);
    expect(m.momentBindings).toEqual([]);
  });

  it("keeps a twin law's fraction when the law stays, and starts a new law's at 0.1", () => {
    const chiral = chiralPage();
    const inversion = { matrix: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]] } as const;
    let m = withTwinLaws(singleCrystalPage(chiral.structure, chiral.dataset), [inversion]);
    m = { ...m, params: m.params.map((p) => (p.id === "twin_1" ? { ...p, value: 0.27, fixed: true } : p)) };
    m = withTwinLaws(m, [inversion, { matrix: [[0, 1, 0], [1, 0, 0], [0, 0, -1]] }]);
    expect(m.params.find((p) => p.id === "twin_1")).toMatchObject({ value: 0.27, fixed: true });
    expect(m.params.find((p) => p.id === "twin_2")).toMatchObject({ value: 0.1 });
  });
});

describe("the single-crystal page saved and reopened", () => {
  it("comes back as it was saved: every setting, every row, the last fit and the agreement", async () => {
    const chiral = chiralPage({ equivalents: 2 });
    let m = singleCrystalPage(chiral.structure, chiral.dataset, { instrumentProbe: "xray" });
    m = withRestraints(m, [GA_N]);
    m = withHand(m).model;
    m = withTwinLaws(m, [{ matrix: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]] }]);
    m = withMerged(m, true);
    m = withWeighting(m, { a: 0.05, b: 0.2 });
    m = withExtinctionModel(m, "bc-1-lorentzian");
    m = withRadiation(m, { wavelength: 0.7 });
    m = withResolution(m, { dMin: 0.9 });
    m = withOutlierFilter(m, { on: true, cutoffSigma: 5, minExtinction: 0.4 });
    const first = pageView(m).activeDataset.reflections[0]!;
    m = withOmitted(m, [{ h: first.h, k: first.k, l: first.l, reason: "test" }]);
    m = withFixed(m, m.params.filter((p) => p.kind === "positionShift").slice(0, 3).map((p) => ({ id: p.id, fixed: false })));
    m = withFit(m, await singleCrystalFit(new ComputeClient(), m));
    m = withAdpModel(m, true);
    const saved = JSON.parse(JSON.stringify(workspaceOf(m, { modulated: MODULATED })));
    const back = singleCrystalPage(m.loaded, saved.dataset, { restore: saved });
    const settings = (x: SingleCrystalPageModel) => ({
      inverted: x.inverted, wavelength: x.wavelength, probe: x.probe, extinctionModel: x.extinctionModel, weighting: x.weighting, twinLaws: x.twinLaws,
      merged: x.merged, adp: x.adp?.model, riding: x.riding, restraints: x.restraints, filter: x.filter, omitted: x.omitted, resolution: x.resolution,
    });
    expect(settings(back)).toEqual(settings(m));
    // A project file is JSON, which writes −0 as 0.
    const rows = (x: SingleCrystalPageModel) => x.params.map((p) => ({ id: p.id, value: p.value + 0, fixed: p.fixed, expression: p.expression }));
    expect(rows(back)).toEqual(rows(m));
    expect(back.result?.agreement).toEqual(m.result?.agreement);
    const ag = pageView(back).comparison.agreement;
    const was = pageView(m).comparison.agreement;
    expect(ag.r1).toBeCloseTo(was.r1, 10);
    expect(ag.wr2).toBeCloseTo(was.wr2, 10);
    expect(pageView(back).activeDataset.reflections.length).toBe(pageView(m).activeDataset.reflections.length);
  }, 120_000);
});

describe("the Agent's headless single-crystal page and the History", () => {
  it("goes back to a step as the app does: the step's settings and rows on the page (it once did nothing)", () => {
    const c = corundumPage();
    const { port } = singleCrystalPort(c.structure, c.dataset);
    const history = headlessHistory(port);
    port.setWeighting!({ a: 0.1, b: 0 });
    port.setFixed([{ id: "scale", fixed: true }]);
    history.record("settings");
    const step = history.history()!.current;
    const at = port.state();
    port.setMerged!(true);
    port.setResolution!({ dMin: 0.8 });
    port.setWeighting!(null);
    port.setFixed([{ id: "scale", fixed: false }]);
    history.record("settings");
    expect(port.state().weighting).toBeNull();
    history.goTo(step);
    expect(port.state().weighting).toEqual(at.weighting);
    expect(port.state().resolution).toEqual(at.resolution);
    expect(port.state().observationCount).toBe(at.observationCount);
    expect(port.state().parameters).toEqual(at.parameters);
  });
});

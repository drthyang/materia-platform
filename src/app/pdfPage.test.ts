import { describe, it, expect } from "vitest";
import { ComputeClient } from "@/workers/computeClient";
import { headlessHistory, pdfPort } from "@/testSupport/agentHeadless";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import type { MagneticModel } from "@/core/magnetic/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { IDENTITY3 } from "@/core/math/mat3";
import { decomposeDisplacementRepresentation } from "@/core/crystal/displaciveModes";
import { irrepIsotropySubgroups } from "@/core/crystal/isotropySubgroups";
import {
  ACTIVATION_KICK, pageView, pdfBoxcar, pdfFit, pdfguiBundleOf, pdfPage, withActivatedMode, withAdpModel, withBoxcarRun, withExtraPhases, withFit, withFitRange, withParameter,
  withPositionMode, withSpinModel, workspaceOf, type PdfCompute, type PdfPageModel,
} from "@/app/pdfPage";

/**
 * The PDF page's operations, which the workbench and the Agent's headless
 * page both call. The headless page once kept its own copy: it refined 4
 * iterations (the app 30), returned "cancelled" for Prefit, had no posterior,
 * refined 2 iterations per boxcar box (the app 20), only logged Reset, seeded
 * an ADP switch from the ADPs as loaded, and go_to_step left it as it was.
 */

/** The real client, each request it is asked for recorded. */
function recording(): { client: PdfCompute; requests: { call: string; req: Record<string, unknown> }[] } {
  const real = new ComputeClient();
  const requests: { call: string; req: Record<string, unknown> }[] = [];
  const watch = <K extends keyof PdfCompute>(call: K) => ((req: Record<string, unknown>, ...rest: unknown[]) => {
    requests.push({ call, req });
    return (real[call] as (...a: unknown[]) => unknown).call(real, req, ...rest);
  }) as unknown as PdfCompute[K];
  const client = {
    refinePdfParallel: watch("refinePdfParallel"),
    refineMpdfParallel: watch("refineMpdfParallel"),
    refinePdfMultiStart: watch("refinePdfMultiStart"),
    refineMpdfMultiStart: watch("refineMpdfMultiStart"),
    refinePdfBoxcar: watch("refinePdfBoxcar"),
    samplePdfPosterior: watch("samplePdfPosterior"),
    sampleMpdfPosterior: watch("sampleMpdfPosterior"),
  } as PdfCompute;
  return { client, requests };
}

/** The GaTa₄Se₈ demo as the app opens it, on the 1.5–6 Å window the eval page uses. */
function demoPage(): PdfPageModel {
  const demo = gata4se8PdfExample();
  return pdfPage(demo.structure, demo.pattern, { preset: { values: demo.refinedParams, fitRange: { min: 1.5, max: 6 } } });
}

const free = (m: PdfPageModel, ids: readonly string[]): PdfPageModel => ({ ...m, params: m.params.map((p) => (ids.includes(p.id) ? { ...p, fixed: false } : p)) });
const rowIds = (m: PdfPageModel): string[] => m.params.map((p) => p.id);
const specIds = (m: PdfPageModel): string[] => pageView(m).spec.params.map((p) => p.id);

describe("the Agent's headless PDF page", () => {
  it("fits as the app does: 30 iterations, Prefit, 20 iterations per box, and the posterior", async () => {
    const { client, requests } = recording();
    const { port } = pdfPort({ client });
    expect(await port.refine()).toBeNull();
    expect(await port.thorough()).toBeNull();
    const run = await port.boxcar({ width: 2, step: 2, direction: "up" });
    expect(run?.series[0]?.result.steps.length).toBeGreaterThan(0);
    const sampled = await port.samplePosterior!({ continue: false, steps: 2 });
    expect(typeof sampled).not.toBe("string");
    expect(requests.map((r) => r.call)).toEqual(["refinePdfParallel", "refinePdfMultiStart", "refinePdfBoxcar", "samplePdfPosterior"]);
    expect((requests[0]!.req.options as { maxIterations: number }).maxIterations).toBe(30);
    expect((requests[1]!.req.options as { maxIterations: number }).maxIterations).toBe(25);
    expect((requests[2]!.req.options as { maxIterations: number }).maxIterations).toBe(20);
    for (const { call, req } of requests) if (call !== "refinePdfBoxcar") expect(req.fitRange, call).toEqual({ min: 1.5, max: 6 });
  }, 120_000);

  it("resets the values (it once only logged the call), and seeds an ADP switch from the ADPs as refined", async () => {
    const { port } = pdfPort();
    const start = port.state().parameters.map((p) => p.value);
    port.setFixed([{ id: "U_Ga1_0", fixed: false }, { id: "U_Ta1_0", fixed: false }]);
    await port.refine();
    expect(port.state().parameters.map((p) => p.value)).not.toEqual(start);
    // The refined U of Ga1, as an isotropic B: what the switch must seed.
    const refinedU = port.state().parameters.find((p) => p.id === "U_Ga1_0")!.value;
    port.setAdpModel(false);
    const b = port.state().parameters.find((p) => p.kind === "bIso" && p.id.includes("Ga1"))!;
    expect(b.value).toBeCloseTo(8 * Math.PI ** 2 * refinedU, 6);
    port.setAdpModel(true);
    port.reset();
    expect(port.state().result).toBeNull();
    expect(port.state().parameters.every((p) => p.value === p.initialValue)).toBe(true);
  }, 120_000);

  it("goes back to a step as the app does: the step's window, rows and fit on the page (it once did nothing)", async () => {
    const { port } = pdfPort();
    const history = headlessHistory(port);
    port.setFixed([{ id: "delta2", fixed: false }]);
    await port.refine();
    history.record("refine", "agent", "Refine");
    const step = history.history()!.current;
    const at = port.state();
    port.setFitRange({ min: 2, max: 5 });
    port.setAdpModel(false);
    history.record("settings");
    expect(port.state().adpModel).toBe("isotropic");
    history.goTo(step);
    expect(port.state().fitRange).toEqual(at.fitRange);
    expect(port.state().adpModel).toBe(at.adpModel);
    expect(port.state().parameters).toEqual(at.parameters);
    expect(port.state().result).toEqual(at.result);
  }, 120_000);
});

describe("the PDF page's changes", () => {
  it("switches positions between coordinates and mode amplitudes without moving the curve, the rows always the spec's", () => {
    const m = withParameter(demoPage(), "pos_Se1_0", { value: 0.004 });
    const rw = pageView(m).rw;
    const modes = withPositionMode(m, "irreps");
    expect(rowIds(modes)).toEqual(specIds(modes));
    expect(modes.params.some((p) => p.id.startsWith("mode_"))).toBe(true);
    expect(pageView(modes).rw).toBeCloseTo(rw, 9);
    const back = withPositionMode(modes, "atomic");
    expect(rowIds(back)).toEqual(specIds(back));
    expect(back.params.find((p) => p.id === "pos_Se1_0")!.value).toBeCloseTo(0.004, 9);
    expect(pageView(back).rw).toBeCloseTo(rw, 9);
    // The scale and the envelope keep their values across the flip.
    expect(back.params.find((p) => p.id === "delta2")!.value).toBe(m.params.find((p) => p.id === "delta2")!.value);
  });

  it("activates a symmetry-breaking mode with its starting kick, the setting-free rows carried", () => {
    const m = withParameter(demoPage(), "pdfScale", { value: 0.09 });
    const structure = pageView(m).fitStructure;
    const term = decomposeDisplacementRepresentation(structure).terms.find((t) => !t.trivial && t.multiplicity - t.acoustic > 0)!;
    const sub = irrepIsotropySubgroups(structure, term)[0]!;
    const { model, message } = withActivatedMode(m, term, sub);
    expect(message).toMatch(/^activated /);
    expect(model.positionMode).toBe("irreps");
    expect(model.modes?.fromActivation).toBe(true);
    expect(rowIds(model)).toEqual(specIds(model));
    expect(model.params.filter((p) => p.value === ACTIVATION_KICK && !p.fixed)).toHaveLength(1);
    expect(model.params.find((p) => p.id === "pdfScale")!.value).toBe(0.09);
  });

  it("activates an epikernel off the axes: GaTa₄Se₈'s polar T2 irrep along ⟨111⟩, the child R3m with the F translations kept", () => {
    const m = demoPage();
    const structure = pageView(m).fitStructure;
    const branch = decomposeDisplacementRepresentation(structure).terms
      .filter((t) => !t.trivial && t.multiplicity - t.acoustic > 0)
      .map((term) => ({ term, subs: irrepIsotropySubgroups(structure, term) }))
      .find(({ subs }) => subs.some((s) => s.identity.number === 160))!;
    const r3m = branch.subs.find((s) => s.identity.number === 160)!;
    expect(r3m.orderParameterDim).toBe(1);
    expect(r3m.conjugates).toBe(4);
    const { model, label } = withActivatedMode(m, branch.term, r3m);
    expect(label).toBe(`${branch.term.irrep.label} → R 3 m:H`);
    const child = model.modes!.set.parentized;
    expect(child.spaceGroup.operations).toHaveLength(24); // 3m's six rotations × the four F translations
    expect(model.params.filter((p) => p.value === ACTIVATION_KICK && !p.fixed)).toHaveLength(1);
  });

  it("seeds an ADP switch back to the demo's own model from the refined ADPs, not the demo's values", () => {
    const iso = withAdpModel(demoPage(), false);
    const b = iso.params.find((p) => p.kind === "bIso" && p.id.includes("Ga1"))!;
    const back = withAdpModel(withParameter(iso, b.id, { value: 1.25 }), true);
    const u = back.params.find((p) => p.id === "U_Ga1_0")!;
    expect(u.value).toBeCloseTo(1.25 / (8 * Math.PI ** 2), 9);
    expect(u.value).not.toBeCloseTo(gata4se8PdfExample().refinedParams.U_Ga1_0!, 6);
  });

  it("keeps a multi-phase page's rows through an ADP switch (they were built afresh, the fit lost)", () => {
    const demo = gata4se8PdfExample();
    const second: StructureModel = { ...demo.structure, id: "second", name: "Second" };
    const m0 = withExtraPhases(demoPage(), [second]);
    expect(pageView(m0).multiPhase).toBe(true);
    const scale = m0.params.find((p) => p.kind === "pdfScale")!;
    const m = withParameter(m0, scale.id, { value: 0.0123 });
    const switched = withAdpModel(m, false);
    expect(switched.params.find((p) => p.id === scale.id)!.value).toBe(0.0123);
    expect(rowIds(switched)).toEqual(specIds(switched));
  });

  it("drops a fit that lands after the spec changed under it", async () => {
    const m = free(demoPage(), ["delta2"]);
    const fit = await pdfFit(new ComputeClient(), m);
    const flipped = withPositionMode(m, "irreps");
    expect(withFit(flipped, fit)).toBe(flipped);
    const landed = withFit(withFitRange(m, { min: 1.5, max: 6 }), fit);
    expect(landed.result).toBe(fit.result);
  }, 120_000);
});

describe("the PDF page's spin model", () => {
  const op: SymmetryOperation = { rotation: IDENTITY3, translation: [0, 0, 0], xyz: "x,y,z" };
  const mn: StructureModel = {
    id: "mn", name: "Mn toy", cell: { a: 4.4, b: 4.4, c: 4.4, alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: { operations: [op] },
    sites: [{ label: "Mn1", element: "Mn", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } }],
  };
  const neutron: PdfPattern = { id: "toy", name: "toy", scatteringType: "neutron", points: Array.from({ length: 300 }, (_, k) => ({ r: 0.5 + k * 0.02, gObs: Math.sin(k / 7) })), qdamp: 0.02 };
  const magnetic: MagneticModel = { id: "mn-mag", structureId: "mn", propagation: [[0, 0, 0.5]], moments: [{ siteLabel: "Mn1", frame: "crystallographic", components: [3, 0, 0], formFactorId: "Mn2" }] };
  const moment = (value: number): RefinementParameter => ({ id: "mom_Mn1_0", label: "Mn1 M (Mx)", kind: "momentMode", value, initialValue: value, min: -12, max: 12, fixed: true });
  const binding: ParameterBinding = { parameterId: "mom_Mn1_0", kind: "momentMode", targetId: "mn-mag", targetKey: "Mn1", momentBasis: [1, 0, 0] };

  it("replaces the moment rows wholesale with a new model's (their ids repeat), and carries the nuclear rows", () => {
    const m0 = pdfPage(mn, neutron);
    const first = withSpinModel(m0, { magnetic, params: [moment(3)], bindings: [binding] }).model;
    expect(pageView(first).spinFit).not.toBeNull();
    expect(rowIds(first)).toEqual(specIds(first));
    const edited = withParameter(withParameter(first, "mom_Mn1_0", { value: 2.2 }), "pdfScale", { value: 0.5 });
    const second = withSpinModel(edited, { magnetic: { ...magnetic, id: "mn-mag" }, params: [moment(1.7)], bindings: [binding] }).model;
    expect(second.params.find((p) => p.id === "mom_Mn1_0")!.value).toBe(1.7);
    expect(second.params.find((p) => p.id === "pdfScale")!.value).toBe(0.5);
    const removed = withSpinModel(second, null).model;
    expect(removed.params.some((p) => p.kind === "momentMode")).toBe(false);
  });

  it("exports the nuclear model for PDFfit2, the spin model as an mCIF for diffpy.mpdf, and MATERIA's nuclear curve to compare with", () => {
    const m = withSpinModel(pdfPage(mn, neutron), { magnetic, params: [moment(3)], bindings: [binding] }).model;
    const entries = pdfguiBundleOf(m);
    const names = entries.map((e) => e.name);
    expect(names).toContain("Mn_toy_mpdf.mcif");
    const file = (n: string): string => entries.find((e) => e.name === n)!.data as string;
    expect(file("materia_fit.csv").split("\n")[0]).toBe("r,Gobs,Gcalc_MATERIA,Gcalc_MATERIA_nuclear");
    expect(file("fit_pdffit2.py")).toContain("MAGNETIC = True");
    const readme = file("README.txt");
    expect(readme).toMatch(/Magnetic PDF\n/);
    expect(readme).toContain("diffpy.mpdf");
    expect(readme).toContain("Mn_toy_mpdf.mcif");
  });

  it("refuses a model the spin field cannot represent, and leaves an X-ray page's rows and fit alone", () => {
    const m0 = pdfPage(mn, neutron);
    const incommensurate = withSpinModel(m0, { magnetic: { ...magnetic, propagation: [[0, 0, 0.3141]] }, params: [moment(3)], bindings: [binding] });
    expect(incommensurate.model).toBe(m0);
    expect(incommensurate.message).toBeTruthy();
    const xray = { ...pdfPage(mn, { ...neutron, scatteringType: "xray" }), result: { status: "converged" } as unknown as PdfPageModel["result"] };
    const shown = withSpinModel(xray, { magnetic, params: [moment(3)], bindings: [binding] }).model;
    expect(shown.params).toBe(xray.params);
    expect(shown.result).toBe(xray.result);
  });
});

describe("the PDF page's PDFgui / diffpy-CMI bundle (Export ▾)", () => {
  it("carries the free rows as PDFfit2 parameters, without esds on a snapshot and with them after a fit", async () => {
    const opened = demoPage();
    const snapshot = pdfguiBundleOf(opened);
    expect(snapshot.map((e) => e.name)).toEqual(["GaTa4Se8.stru", "GaTa4Se8.cif", "GaTa4Se8.gr", "materia_fit.csv", "fit_pdffit2.py", "make_pdfgui_project.py", "constraints.txt", "README.txt"]);
    const script = (entries: typeof snapshot): string => entries.find((e) => e.name === "fit_pdffit2.py")!.data as string;
    const rows = (entries: typeof snapshot): string[] => script(entries).split("\n").filter((l) => /^ {4}\(\d+, "/.test(l));
    // The demo opens with the scale and the cell free, a snapshot with no esds.
    expect(rows(snapshot)).toHaveLength(opened.params.filter((p) => !p.fixed && !p.expression).length);
    expect(rows(snapshot).every((l) => l.endsWith(", None),"))).toBe(true);
    expect(script(snapshot)).toContain("RMIN, RMAX = 1.5, 6");
    expect(script(snapshot)).toContain("QMAX = 27");
    // After a fit the values carry its esds.
    const m = free(demoPage(), ["delta2"]);
    const fitted = withFit(m, await pdfFit(new ComputeClient(), m));
    const after = rows(pdfguiBundleOf(fitted));
    expect(after).toHaveLength(3);
    expect(after.some((l) => l.endsWith(", None),"))).toBe(false);
  }, 120_000);
});

describe("the PDF page saved and reopened", () => {
  it("comes back as it was saved: the settings, every row, the last fit, the boxcar scan and Rw", async () => {
    const client = new ComputeClient();
    let m = withFitRange(free(demoPage(), ["delta2", "qdamp"]), { min: 1.6, max: 5.8 });
    m = withPositionMode(m, "irreps");
    m = withAdpModel(m, false);
    m = { ...m, boxcarPlan: { ...m.boxcarPlan, width: 2, step: 2 } };
    m = withFit(m, await pdfFit(client, m));
    const scan = await pdfBoxcar(client, m, m.boxcarPlan);
    m = withBoxcarRun(m, scan.run, scan.key);
    expect(m.boxcarRun).not.toBeNull();
    const saved = JSON.parse(JSON.stringify(workspaceOf(m)));
    const back = pdfPage(m.loaded, m.pattern, { preset: m.preset, restore: saved });
    const settings = (x: PdfPageModel) => ({ fitRange: x.fitRange, positionMode: x.positionMode, adp: x.adp?.model, boxcarPlan: x.boxcarPlan, modes: x.modes?.parentName ?? null });
    expect(settings(back)).toEqual(settings(m));
    // A project file is JSON, which writes −0 as 0.
    const rows = (x: PdfPageModel) => x.params.map((p) => ({ id: p.id, value: p.value + 0, fixed: p.fixed }));
    expect(rows(back)).toEqual(rows(m));
    expect(back.result?.agreement).toEqual(m.result?.agreement);
    expect(back.boxcarRun?.series[0]?.result.steps.length).toBe(m.boxcarRun!.series[0]!.result.steps.length);
    expect(pageView(back).rw).toBeCloseTo(pageView(m).rw, 9);
  }, 120_000);
});

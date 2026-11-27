import { describe, it, expect } from "vitest";
import {
  caseOf, noisy, nuclearOnlyRows, sequence, sessionOf, Fitter,
  FIT_RANGE, MODEL_A, MODEL_B, MODEL_F_K0, type Case,
} from "@/testSupport/momentSequenceCase";
import type { SpinModel } from "@/testSupport/independentMnwo4";
import { magneticStepOn } from "@/testSupport/magneticHeadless";
import { fitRows, type MagneticStep } from "@/app/magneticStep";
import type { Session } from "@/app/powderSession";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import { magneticPowderComponents } from "@/core/workflow/magneticPowder";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { transportSchema } from "@/mcp/host";
import { TOOL_REGISTRY } from "@/mcp/registry";
import { assess_refinement, build_magnetic_model, export_bundle, refine_magnetic_powder, refine_moments } from "@/mcp/tools";
import { mn3gaMagneticSession } from "@/agent/evals/pages";

/**
 * The moments fit over MCP, against a KNOWN TRUTH and against the page.
 *
 * `refine_moments` runs the module the powder page's Refine moments runs
 * (core/magnetic/momentsFit.ts). On the synthetic MnWO₄ of
 * testSupport/independentMnwo4.ts (a calculation that shares no code with
 * `src/core`; true moment 4.2 µ_B) it must give the page's answer:
 *
 *  - on the first call after `build_magnetic_model`, whose moment rows come
 *    fixed, with the rows in the page's order: the page's moments and esds to
 *    within 1 part in 10⁹ (the difference is printed);
 *  - with the rows in another order, the page's own known-truth bounds: within
 *    3 esd of the truth and within 0.05 esd of the joint fit.
 *
 * Which amplitudes refine is the page's rule (core/magnetic/momentModel.ts,
 * momentFitRows): every moment row but a tied one and the phase gauge of a
 * two-arm k, which the caller names as the builder named it. The `fixed` flags
 * on moment rows are not read, and come back as passed.
 *
 * And the rule on `refine_magnetic_powder`: moments and nuclear rows together
 * are refused unless the joint fit is asked for by name, and that fit's result
 * carries its label into what is written from it.
 */

/**
 * The page after its nuclear-only fit of a noisy pattern, the true group
 * chosen; and the MCP arguments of the same problem in the page's row order,
 * its moment rows straight from `build_magnetic_model` (every one fixed).
 */
function pageAndArgs(model: SpinModel, seed: number): { c: Case; step: MagneticStep; session: () => Session; fitter: Fitter; args: Parameters<typeof refine_moments>[0]; momentIds: string[] } {
  const c = caseOf(model, 6);
  const points = noisy(c.clean, seed);
  let session = sessionOf(c, points, nuclearOnlyRows(c, points));
  const step = magneticStepOn(() => ({ session, window: FIT_RANGE }), (s) => { session = s; }, () => {});
  step.handle.setK([c.k[0], c.k[1], c.k[2]]);
  step.handle.selectIons(["Mn1"]);
  const sig = magneticOperationSignature(c.build.magnetic.operations!);
  const i = step.view().reps.findIndex((r) => magneticOperationSignature(r.candidate.operations) === sig);
  expect(i).toBeGreaterThanOrEqual(0);
  step.handle.choose(`G${i + 1}`);
  // What an MCP caller has: the model from build_magnetic_model at the page's seed (2 µB), and the page's rows before the fit.
  const mm = build_magnetic_model({ structure: session.structure, ionLabels: ["Mn1"], operations: [...c.build.magnetic.operations!], k: [c.k[0], c.k[1], c.k[2]], moment: 2 });
  expect(mm.parameters.every((p) => p.fixed)).toBe(true);
  expect(mm.phaseGaugeParameterId).toBeUndefined();
  expect(mm.parameters.map((p) => [p.id, p.value])).toEqual(fitRows(step.view().build!, step.view().resolvedAmps).map((p) => [p.id, p.value]));
  const args = {
    structure: session.structure, magnetic: mm.magnetic, pattern: session.pattern,
    parameters: [...session.powderParams, ...mm.parameters], bindings: [...session.powderBindings, ...mm.bindings],
    profile: session.powderProfile, fitRange: { ...FIT_RANGE },
  };
  return { c, step, session: () => session, fitter: new Fitter(c, points), args, momentIds: mm.parameters.filter((p) => !p.expression).map((p) => p.id) };
}

const relative = (a: number, b: number): number => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));

describe("refine_moments over MCP gives the page's Refine moments (independent MnWO4, truth 4.2 µB)", () => {
  for (const [name, model] of [["model A, k = (½ 0 0), one moment row", MODEL_A], ["model B, two moment rows", MODEL_B], ["a ferromagnet at k = 0", MODEL_F_K0]] as const) {
    it(`${name}: the first call after build_magnetic_model, the rows in the page's order: the same moments and esds to 1 part in 10⁹`, async () => {
      const { step, session, args, momentIds } = pageAndArgs(model, 0);
      const mcp = await refine_moments(args);
      expect(await step.refineMoments()).not.toBeNull();
      const v = step.view();
      const rounds = v.fitRounds!;
      const dMoment = momentIds.map((id) => relative(mcp.moments[id]!, v.resolvedAmps[id]!));
      const dEsd = momentIds.map((id) => relative(mcp.esd[id]!, rounds.esd[id]!));
      const dHeld = Object.keys(rounds.held).map((id) => relative(mcp.reRefined[id]!, rounds.held[id]!));
      console.log(`[mcp-moments] ${name}: page ${momentIds.map((id) => `${v.resolvedAmps[id]!.toFixed(6)}(${rounds.esd[id]!.toFixed(6)})`).join(", ")} µB in ${rounds.count} rounds, wR ${(100 * v.fitWR!).toFixed(4)} % · MCP ${momentIds.map((id) => `${mcp.moments[id]!.toFixed(6)}(${mcp.esd[id]!.toFixed(6)})`).join(", ")} in ${mcp.rounds} rounds, wR ${(100 * mcp.wR!).toFixed(4)} % · relative difference: moments ${dMoment.map((d) => d.toExponential(2)).join(", ")}; esds ${dEsd.map((d) => d.toExponential(2)).join(", ")}; scale and background at most ${Math.max(...dHeld).toExponential(2)}; wR ${relative(mcp.wR!, v.fitWR!).toExponential(2)}`);
      for (const d of [...dMoment, ...dEsd, ...dHeld]) expect(d).toBeLessThan(1e-9);
      expect(relative(mcp.wR!, v.fitWR!)).toBeLessThan(1e-9);
      expect(mcp.rounds).toBe(rounds.count);
      expect(mcp.settled).toBe(rounds.settled);
      expect(mcp.settled).toBe(true);
      expect(relative(mcp.lastShiftOverEsd, rounds.lastShiftOverEsd)).toBeLessThan(1e-6);
      expect(mcp.esdIncludes).toEqual(rounds.esdIncludes);
      expect(mcp.esdIncludes).toEqual(["scale", "bkg0", "bkg1", "bkg2", "bkg3", "bkg4", "bkg5"]);
      expect(mcp.esdAloneReason).toBeNull();
      expect(Object.keys(mcp.reRefined)).toEqual(Object.keys(rounds.held));
      expect(mcp.kHeld).toBeUndefined();
      // The rows it hands back are the page's rows after the fit: only the scale, the background and the moments moved.
      const page = Object.fromEntries(session().powderParams.map((p) => [p.id, p.value]));
      for (const p of mcp.parameters) {
        if (momentIds.includes(p.id)) continue;
        expect(relative(p.value, page[p.id]!), p.id).toBeLessThan(1e-9);
        if (!(p.id in mcp.reRefined)) expect(p.value, p.id).toBe(args.parameters.find((q) => q.id === p.id)!.value);
      }
      // The flags come back as they were passed: the moment rows came fixed from the builder and go out fixed.
      expect(mcp.parameters.map((p) => p.fixed)).toEqual(args.parameters.map((p) => p.fixed));
      expect(mcp.parameters.filter((p) => p.kind === "momentMode").every((p) => p.fixed)).toBe(true);
      expect(mcp.reading).toMatch(new RegExp(`^Moments fitted with the nuclear model held, settled in ${mcp.rounds} rounds: wR \\d+\\.\\d\\d%\\. The esds include the scale and the background\\. \`parameters\` carries the re-refined scale and background\\.$`));
    }, 60_000);
  }

  it("model A is the known answer: 4.20 µB for a true 4.2, within 3 esd, with the joint fit's value", async () => {
    const { c, fitter, args } = pageAndArgs(MODEL_A, 0);
    const mcp = await refine_moments(args);
    const moment = fitter.moment(Object.fromEntries(mcp.parameters.map((p) => [p.id, p.value])));
    const esd = mcp.esd.mom_Mn1_0!;
    const joint = sequence(c, noisy(c.clean, 0), 0).joint;
    console.log(`[mcp-moments] model A: MCP ${moment.toFixed(4)}(${(1e4 * esd).toFixed(0)}) µB; truth 4.2 (${((moment - 4.2) / esd).toFixed(2)} esd); joint fit ${joint.moment.toFixed(4)} (${((moment - joint.moment) / esd).toFixed(3)} esd)`);
    expect(moment).toBeCloseTo(4.203, 2);
    expect(Math.abs(moment - 4.2) / esd).toBeLessThan(3);
    expect(Math.abs(moment - joint.moment) / esd).toBeLessThan(0.05);
    expect(esd / joint.quotedEsd[0]!).toBeCloseTo(1, 2);
  }, 60_000);

  it("with the rows in another order (the moments first, the nuclear rows reversed): within 3 esd of the truth and 0.05 esd of the joint fit", async () => {
    const { c, step, fitter, args, momentIds } = pageAndArgs(MODEL_A, 0);
    const nuclear = args.parameters.filter((p) => p.kind !== "momentMode");
    const moments = args.parameters.filter((p) => p.kind === "momentMode");
    const mcp = await refine_moments({ ...args, parameters: [...moments, ...[...nuclear].reverse()], bindings: [...args.bindings].reverse() });
    expect(await step.refineMoments()).not.toBeNull();
    const v = step.view();
    const moment = fitter.moment(Object.fromEntries(mcp.parameters.map((p) => [p.id, p.value])));
    const esd = mcp.esd.mom_Mn1_0!;
    const joint = sequence(c, noisy(c.clean, 0), 0).joint;
    const id = momentIds[0]!;
    console.log(`[mcp-moments] another row order: MCP ${moment.toFixed(6)}(${esd.toFixed(6)}) µB in ${mcp.rounds} rounds; from the page: moment ${relative(mcp.moments[id]!, v.resolvedAmps[id]!).toExponential(2)}, esd ${relative(esd, v.fitRounds!.esd[id]!).toExponential(2)} (relative); from the truth ${((moment - 4.2) / esd).toFixed(2)} esd; from the joint fit ${((moment - joint.moment) / esd).toFixed(3)} esd`);
    expect(Math.abs(moment - 4.2) / esd).toBeLessThan(3);
    expect(Math.abs(moment - joint.moment) / esd).toBeLessThan(0.05);
    expect(mcp.settled).toBe(true);
    expect(mcp.parameters.map((p) => p.id)).toEqual([...moments, ...[...nuclear].reverse()].map((p) => p.id));
  }, 60_000);
});

describe("refine_moments decides its own rows", () => {
  it("ignores the flags on the nuclear rows: whatever is free or held there, the same fit", async () => {
    const { args } = pageAndArgs(MODEL_A, 0);
    const base = await refine_moments(args);
    // Everything nuclear marked free (the width, the cell, the atoms too): nothing but the scale and the background moves.
    const allFree = await refine_moments({ ...args, parameters: args.parameters.map((p) => (p.kind === "momentMode" || p.expression ? p : { ...p, fixed: false })) });
    expect(allFree.moments).toEqual(base.moments);
    expect(allFree.esd).toEqual(base.esd);
    expect(allFree.reRefined).toEqual(base.reRefined);
    for (const p of allFree.parameters) if (p.kind !== "momentMode" && !(p.id in allFree.reRefined)) expect(p.value, p.id).toBe(args.parameters.find((q) => q.id === p.id)!.value);
  }, 60_000);

  it("does not read the flags on the moment rows: fixed, free or mixed, the same fit, and each flag returned as passed", async () => {
    const { args, momentIds } = pageAndArgs(MODEL_B, 0);
    expect(momentIds).toHaveLength(2);
    const flagged = (flags: readonly boolean[]): typeof args.parameters => {
      let n = 0;
      return args.parameters.map((p) => (p.kind === "momentMode" ? { ...p, fixed: flags[n++]! } : p));
    };
    const asBuilt = await refine_moments(args);
    expect(Object.keys(asBuilt.moments)).toEqual(momentIds);
    for (const flags of [[false, false], [true, false], [false, true]]) {
      const passed = flagged(flags);
      const out = await refine_moments({ ...args, parameters: passed });
      expect(out.moments, String(flags)).toEqual(asBuilt.moments);
      expect(out.esd, String(flags)).toEqual(asBuilt.esd);
      expect(out.rounds).toBe(asBuilt.rounds);
      expect(out.parameters.map((p) => p.fixed), String(flags)).toEqual(passed.map((p) => p.fixed));
    }
    for (const id of momentIds) expect(asBuilt.moments[id]).not.toBe(args.parameters.find((p) => p.id === id)!.value);
  }, 60_000);

  it("a tied moment row is not refined: it follows its tie, and has no esd of its own", async () => {
    const { args, momentIds } = pageAndArgs(MODEL_B, 0);
    const [reference, tied] = momentIds as [string, string];
    const out = await refine_moments({ ...args, parameters: args.parameters.map((p) => (p.id === tied ? { ...p, expression: `= 0.5*${reference}` } : p)) });
    expect(Object.keys(out.moments)).toEqual([reference]);
    expect(Object.keys(out.esd)).toEqual([reference]);
    expect(out.moments[reference]).not.toBe(args.parameters.find((p) => p.id === reference)!.value);
    expect(out.result.parameters[tied]).toBeCloseTo(0.5 * out.moments[reference]!, 12);
    // The model at the fitted moments carries the tie: the second component is half the first.
    const free = await refine_moments(args);
    expect(out.moments[reference]).not.toBe(free.moments[reference]);
  }, 60_000);

  it("no moment amplitude among the rows: refused, with what to pass", async () => {
    const { args } = pageAndArgs(MODEL_A, 0);
    const message = "refine_moments: not run. `parameters` holds no moment amplitude to refine: no moment row, or only tied rows and the phase gauge. Pass the moment rows build_magnetic_model returned, joined to the nuclear rows.";
    await expect(refine_moments({ ...args, parameters: args.parameters.filter((p) => p.kind !== "momentMode") })).rejects.toThrow(message);
    await expect(refine_moments({ ...args, parameters: args.parameters.map((p) => (p.kind === "momentMode" ? { ...p, expression: "= 2*scale" } : p)) })).rejects.toThrow(message);
  });

  it("a phase gauge named for a model that has none (one-arm k), or naming a row that is not a moment row: refused", async () => {
    const { args } = pageAndArgs(MODEL_A, 0);
    await expect(refine_moments({ ...args, phaseGaugeParameterId: "mom_Mn1_0" })).rejects.toThrow(
      "refine_moments: not run. `phaseGaugeParameterId` was passed, but this model has no phase gauge: its k has one arm (-k is k up to a lattice vector), so every moment row is a real amplitude and refines. Leave the argument out. To hold a component, tie it.",
    );
    for (const id of ["scale", "mom_nobody"]) {
      await expect(refine_moments({ ...args, phaseGaugeParameterId: id })).rejects.toThrow(
        `refine_moments: not run. \`phaseGaugeParameterId\` is "${id}", which is not a moment row in \`parameters\`. Pass the id build_magnetic_model returned as \`phaseGaugeParameterId\`, with the moment rows it returned.`,
      );
    }
  });

  it("takes no free set, stage, restart or iteration argument over the transport; beside the model and the data, only the phase gauge's id", () => {
    const tool = TOOL_REGISTRY.find((t) => t.name === "refine_moments")!;
    expect(tool.selectsFree).toBeUndefined();
    expect(Object.keys(transportSchema(tool)).sort()).toEqual(["bindings", "extraPhases", "fitRange", "magnetic", "parameters", "pattern", "phaseGaugeParameterId", "profile", "structure"]);
  });
});

describe("refine_moments holds k", () => {
  const structure: StructureModel = {
    id: "helix", name: "helix",
    cell: { a: 4, b: 4.6, c: 5, alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: { hermannMauguin: "P 1", operations: [parseSymmetryOperation("x,y,z")] },
    sites: [{ label: "Fe1", element: "Fe", oxidationState: 3, position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.3 } }],
  };
  const K: [number, number, number] = [0, 0, 0.2317];
  const nuc: RefinementParameter[] = [
    { id: "scale", label: "s", kind: "scale", value: 20, initialValue: 20, fixed: false, min: 0 },
    { id: "bkg0", label: "b", kind: "background", value: 5, initialValue: 5, fixed: false },
    { id: "width", label: "w", kind: "peakWidth", value: 0.5, initialValue: 0.5, fixed: true, min: 1e-3 },
  ];
  const nucBindings: ParameterBinding[] = [
    { parameterId: "scale", kind: "scale", targetId: structure.id },
    { parameterId: "bkg0", kind: "background", targetId: "pat", targetKey: "0" },
    { parameterId: "width", kind: "peakWidth", targetId: "pat" },
  ];
  /** A helix's pattern (2 µB on each quadrature) with counting noise from a fixed seed (none: noise-free). */
  function pattern(noise = true, extra: Record<string, number> = {}): PowderPattern {
    const truth = build_magnetic_model({ structure, ionLabels: ["Fe1"], k: K, moment: 2 });
    const grid = Array.from({ length: 1200 }, (_, i) => 8 + (i * 112) / 1199);
    const empty: PowderPattern = { id: "pat", name: "p", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 1.8 }, wavelength: 1.8, points: grid.map((x) => ({ x, yObs: 0 })) };
    const values: Record<string, number> = { mom_Fe1_0: 2, mom_Fe1_1q: 2, ...extra };
    const sim = magneticPowderComponents(structure, truth.magnetic, empty, [...nuc, ...truth.parameters.map((p) => ({ ...p, value: values[p.id] ?? 0 }))], [...nucBindings, ...truth.bindings]);
    let state = 12345;
    const gauss = (): number => {
      // Box–Muller on a small linear congruential generator: the same noise every run.
      const next = (): number => { state = (1103515245 * state + 12345) % 2147483648; return (state + 0.5) / 2147483648; };
      return Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
    };
    return { ...empty, points: empty.points.map((p, i) => { const y = Math.max(sim.yCalc[i]!, 1); return { x: p.x, yObs: noise ? y + Math.sqrt(y) * gauss() : y, sigma: Math.sqrt(y) }; }) };
  }
  // The helix's two amplitudes start off their true 2 µB; the other rows start at 0. The moment rows keep the builder's flags (fixed).
  const START: Record<string, number> = { mom_Fe1_0: 1.5, mom_Fe1_1q: 1.5 };
  const rowsOf = (b: ReturnType<typeof build_magnetic_model>, freeK: boolean): RefinementParameter[] =>
    b.parameters.map((p) => (p.kind === "propagationK" ? { ...p, fixed: !freeK || !!p.expression } : { ...p, value: START[p.id] ?? 0 }));

  it("a k row passed free is held, the result says so, and the moments are those of the same fit without it", async () => {
    const data = pattern();
    const withK = build_magnetic_model({ structure, ionLabels: ["Fe1"], k: K, moment: 2, refineK: true });
    const noK = build_magnetic_model({ structure, ionLabels: ["Fe1"], k: K, moment: 2 });
    const common = { structure, pattern: data, profile: { shape: "gaussian" as const } };
    const passed = [...nuc, ...rowsOf(withK, true)];
    expect(passed.filter((p) => p.kind === "propagationK" && !p.fixed).map((p) => p.id)).toEqual(["prop_k1", "prop_k2", "prop_k3"]);
    // A two-arm k: the builder names the phase gauge, and the caller passes it on.
    expect(withK.phaseGaugeParameterId).toBe("mom_Fe1_0q");
    const gauge = { phaseGaugeParameterId: withK.phaseGaugeParameterId! };
    const held = await refine_moments({ ...common, ...gauge, magnetic: withK.magnetic, parameters: passed, bindings: [...nucBindings, ...withK.bindings] });
    const plain = await refine_moments({ ...common, ...gauge, magnetic: noK.magnetic, parameters: [...nuc, ...rowsOf(noK, false)], bindings: [...nucBindings, ...noK.bindings] });

    expect(held.kHeld).toEqual({
      parameterIds: ["prop_k1", "prop_k2", "prop_k3"],
      note: "k was held: refine_moments refines moment amplitudes only, with the propagation vector at the value in the model. The k rows passed free were not refined; their fixed flags are returned unchanged.",
    });
    expect(plain.kHeld).toBeUndefined();
    // k did not move, in the rows or in the model, and its rows come back flagged as they were passed.
    for (const p of held.parameters.filter((q) => q.kind === "propagationK")) {
      expect(p.value, p.id).toBe(passed.find((q) => q.id === p.id)!.value);
      expect(p.fixed, p.id).toBe(false);
    }
    expect(held.magnetic.propagation[0]).toEqual(K);
    // Every amplitude but the gauge was the fit's to refine; the gauge kept its value and has no esd.
    expect(Object.keys(held.moments)).toEqual(["mom_Fe1_0", "mom_Fe1_1", "mom_Fe1_1q", "mom_Fe1_2", "mom_Fe1_2q"]);
    expect(held.parameters.find((p) => p.id === "mom_Fe1_0q")!.value).toBe(0);
    expect(held.esd.mom_Fe1_0q).toBeUndefined();
    // The amplitudes that start at exactly 0 have no gradient there (the intensity is quadratic in them), so the fit
    // leaves them at 0; they are kicked to 0.1 µB and refitted (momentsFit.ts). The kicked fit is no better (Δχ² ≤ 0):
    // the data do not require them, and they are held at 0, with no esd (not "esd 0").
    expect(held.zeroStart).toMatchObject({ rows: ["mom_Fe1_1", "mom_Fe1_2", "mom_Fe1_2q"], kick: 0.1, kept: false, q: 3 });
    expect(held.zeroStart!.f!).toBeLessThanOrEqual(held.zeroStart!.fCritical!);
    for (const id of ["mom_Fe1_1", "mom_Fe1_2", "mom_Fe1_2q"]) {
      expect(held.moments[id], id).toBe(0);
      expect(held.esd[id], id).toBeUndefined();
    }
    // The helix on this orthogonal cell is one of a family the powder cannot tell apart: the cosine and sine
    // amplitudes along y trade on a circle of the same |M| (the kicked fit, equally good, sits elsewhere on it).
    // So mom_Fe1_1 and mom_Fe1_1q are "direction not determined", with no esd (the engine's esd leaves that
    // direction out and reads too small), and the reading says so. Before this, the zero start returned the
    // seeds' member of the family with an esd of 0.003 µB, and mom_Fe1_1 as 0 with esd 0.
    expect(held.directionNotDetermined).toHaveLength(1);
    const family = held.directionNotDetermined![0]!;
    expect(family.rows).toEqual(["mom_Fe1_1", "mom_Fe1_1q"]);
    expect(held.esd.mom_Fe1_1q).toBeUndefined();
    const alt = family.alternative!;
    expect(Math.abs(alt.mom_Fe1_1!)).toBeGreaterThan(0.3);
    // The same |M| on y on both members of the family, to 1 %: 2 µB, the truth.
    expect(Math.abs(Math.hypot(alt.mom_Fe1_1!, alt.mom_Fe1_1q!) - Math.hypot(held.moments.mom_Fe1_1!, held.moments.mom_Fe1_1q!))).toBeLessThan(0.02);
    expect(Math.abs(Math.hypot(held.moments.mom_Fe1_1!, held.moments.mom_Fe1_1q!) - 2)).toBeLessThan(0.02);
    // One sentence per row, each with its own test (q = 1, one at a time) and the 95 % profile limit the data allow.
    for (const id of ["mom_Fe1_1", "mom_Fe1_2", "mom_Fe1_2q"]) expect(held.reading).toMatch(new RegExp(`${id} started at 0, where the fit cannot move it; kicked to 0\\.1 µB, it is not required by the data \\(Δχ² [−\\d.]+, F [−\\d.e]+ ≤ 3\\.85 at 5 %\\); held at 0, with no esd\\. The data allow up to [\\d.]+ µB \\(95 % profile limit\\)\\.`));
    expect(held.zeroStart!.heldRows).toEqual(["mom_Fe1_1", "mom_Fe1_2", "mom_Fe1_2q"]);
    // mom_Fe1_1 is on the helix's circle: the data allow it up to the helix's 2 µB; Mz, which the data do not have, much less.
    expect(Math.abs(held.zeroStart!.perRow.mom_Fe1_1!.upperLimit! - 2)).toBeLessThan(0.05);
    expect(held.zeroStart!.perRow.mom_Fe1_2!.upperLimit!).toBeLessThan(0.3);
    expect(held.reading).toContain("The data do not determine the direction of mom_Fe1_1 and mom_Fe1_1q (an equally good fit puts mom_Fe1_1 ");
    // The flags of the moment rows come back as the builder set them.
    expect(held.parameters.filter((p) => p.kind === "momentMode").every((p) => p.fixed)).toBe(true);
    const d = Object.keys(plain.moments).map((id) => relative(held.moments[id]!, plain.moments[id]!));
    console.log(`[mcp-moments] k held: ${Object.entries(held.moments).map(([id, v]) => `${id} ${v.toFixed(5)}${held.esd[id] === undefined ? "" : `(${held.esd[id]!.toFixed(5)})`}`).join(", ")} in ${held.rounds} rounds; relative difference from the fit without k rows: ${d.map((x) => x.toExponential(2)).join(", ")} · ${held.reading}`);
    for (const x of d) expect(x).toBeLessThan(1e-9);
    expect(held.rounds).toBe(plain.rounds);
    expect(held.settled).toBe(true);
    expect(Math.abs(Math.abs(held.moments.mom_Fe1_0!) - 2) / held.esd.mom_Fe1_0!).toBeLessThan(3);
  }, 60_000);

  it("noise-free: both fits are exact, the zero rows are held at 0, and the y cosine/sine pair is still a direction not determined", async () => {
    const noK = build_magnetic_model({ structure, ionLabels: ["Fe1"], k: K, moment: 2 });
    const r = await refine_moments({ structure, pattern: pattern(false), profile: { shape: "gaussian" }, magnetic: noK.magnetic, parameters: [...nuc, ...rowsOf(noK, false)], bindings: [...nucBindings, ...noK.bindings], phaseGaugeParameterId: noK.phaseGaugeParameterId! });
    expect(r.zeroStart).toMatchObject({ rows: ["mom_Fe1_1", "mom_Fe1_2", "mom_Fe1_2q"], kept: false, f: null });
    expect(r.directionNotDetermined?.map((f) => f.rows)).toEqual([["mom_Fe1_1", "mom_Fe1_1q"]]);
    expect(r.reading).toContain("mom_Fe1_2 started at 0, where the fit cannot move it; kicked to 0.1 µB, it is not required by the data (both fits are exact (noise-free data)); held at 0, with no esd. No 95 % profile limit is given: the fit is exact (noise-free data).");
    for (const id of ["mom_Fe1_1", "mom_Fe1_1q", "mom_Fe1_2", "mom_Fe1_2q"]) expect(r.esd[id], id).toBeUndefined();
  }, 60_000);

  it("with a real Mz of 1 µB: three rows kicked, tested one at a time; one Mz row kept, the two the data do not need held at 0", async () => {
    const noK = build_magnetic_model({ structure, ionLabels: ["Fe1"], k: K, moment: 2 });
    const r = await refine_moments({ structure, pattern: pattern(true, { mom_Fe1_2: 1 }), profile: { shape: "gaussian" }, magnetic: noK.magnetic, parameters: [...nuc, ...rowsOf(noK, false)], bindings: [...nucBindings, ...noK.bindings], phaseGaugeParameterId: noK.phaseGaugeParameterId! });
    const z = r.zeroStart!;
    expect(z.rows).toEqual(["mom_Fe1_1", "mom_Fe1_2", "mom_Fe1_2q"]);
    // The joint test of the three would keep all three (Δχ² in the thousands); one at a time drops the two the data do not need.
    expect(z.f!).toBeGreaterThan(z.fCritical!);
    expect(z.keptRows).toHaveLength(1);
    expect(["mom_Fe1_2", "mom_Fe1_2q"]).toContain(z.keptRows[0]);
    expect(z.heldRows).toContain("mom_Fe1_1");
    expect(z.reported).toBe("kicked, rows held");
    // |Mz| is the truth's 1 µB, all in the kept row (cosine or sine: the helix's phase lets either carry it).
    expect(Math.abs(Math.hypot(r.moments.mom_Fe1_2!, r.moments.mom_Fe1_2q!) - 1)).toBeLessThan(0.03);
    for (const id of z.heldRows) expect(r.moments[id], id).toBe(0);
    expect(z.perRow[z.keptRows[0]!]!.z!).toBeGreaterThan(10);
    expect(r.reading).toContain(`The fit reported is the kicked fit with ${z.heldRows.join(" and ")} held at 0 (`);
    console.log(`[mcp-moments] helix + Mz: kept ${z.keptRows.join(", ")}, held ${z.heldRows.join(", ")} · ${r.reading}`);
  }, 120_000);

  it("a two-arm model without the phase gauge's id is refused: the tool does not guess the row", async () => {
    const data = pattern();
    const noK = build_magnetic_model({ structure, ionLabels: ["Fe1"], k: K, moment: 2 });
    await expect(refine_moments({ structure, pattern: data, profile: { shape: "gaussian" }, magnetic: noK.magnetic, parameters: [...nuc, ...rowsOf(noK, false)], bindings: [...nucBindings, ...noK.bindings] })).rejects.toThrow(
      "refine_moments: not run. This model's k has two arms (-k is not k), so every mode has a cosine and a sine amplitude, and one sine amplitude is the phase gauge: it must stay held, because the data cannot see the global phase. The tool does not guess which row that is. Pass `phaseGaugeParameterId` as build_magnetic_model returned it.",
    );
  });
});

describe("refine_moments on a two-arm k gives the page's Refine moments (synthetic Mn3Ga, k = (0 0 ¼))", () => {
  it("with the phase gauge named: the gauge held, the same moments and esds as the page to 1 part in 10⁹", async () => {
    let session: Session = mn3gaMagneticSession();
    const step = magneticStepOn(() => ({ session, window: null }), (next) => { session = next; }, () => {});
    step.handle.setK([0, 0, 0.25]);
    step.handle.choose(step.handle.state().candidates.find((g) => g.momentParameters > 0)!.id);
    // The model the page fits, as its builder made it: the rows (as built, at the page's start) and the gauge's id.
    const v = step.view();
    const build = v.build!;
    const gauge = build.phaseGauge!.parameterId;
    const nuclear = session.powderParams.filter((p) => p.kind !== "momentMode" && p.kind !== "propagationK");
    const args = {
      structure: session.structure, magnetic: build.magnetic, pattern: session.pattern,
      parameters: [...nuclear, ...build.params.map((p) => ({ ...p, value: v.resolvedAmps[p.id] ?? p.value }))],
      bindings: [...session.powderBindings.filter((b) => b.kind !== "momentMode" && b.kind !== "propagationK"), ...build.bindings],
      profile: session.powderProfile,
    };
    expect(build.params.every((p) => p.fixed)).toBe(true);
    const mcp = await refine_moments({ ...args, phaseGaugeParameterId: gauge });
    expect(await step.refineMoments()).not.toBeNull();
    const after = step.view();
    const rounds = after.fitRounds!;
    const ids = fitRows(build).filter((p) => !p.fixed).map((p) => p.id);
    expect(ids).not.toContain(gauge);
    expect(Object.keys(mcp.moments)).toEqual(ids);
    const dMoment = ids.map((id) => relative(mcp.moments[id]!, after.resolvedAmps[id]!));
    const dEsd = ids.filter((id) => rounds.esd[id] !== undefined).map((id) => relative(mcp.esd[id]!, rounds.esd[id]!));
    console.log(`[mcp-moments] two-arm Mn3Ga (gauge ${gauge} held): page ${ids.map((id) => `${id} ${after.resolvedAmps[id]!.toFixed(6)}(${(rounds.esd[id] ?? NaN).toFixed(6)})`).join(", ")} in ${rounds.count} rounds, wR ${(100 * after.fitWR!).toFixed(4)} % · MCP in ${mcp.rounds} rounds, wR ${(100 * mcp.wR!).toFixed(4)} % · relative difference: moments at most ${Math.max(...dMoment).toExponential(2)}; esds at most ${Math.max(...dEsd).toExponential(2)}; wR ${relative(mcp.wR!, after.fitWR!).toExponential(2)}`);
    for (const d of [...dMoment, ...dEsd]) expect(d).toBeLessThan(1e-9);
    expect(relative(mcp.wR!, after.fitWR!)).toBeLessThan(1e-9);
    expect(mcp.rounds).toBe(rounds.count);
    expect(mcp.settled).toBe(rounds.settled);
    expect(Object.keys(mcp.esd)).toEqual(Object.keys(rounds.esd));
    // The gauge stayed where it was, and has no esd.
    expect(mcp.parameters.find((p) => p.id === gauge)!.value).toBe(args.parameters.find((p) => p.id === gauge)!.value);
    expect(mcp.esd[gauge]).toBeUndefined();
    // Without the id the same call does not run.
    await expect(refine_moments(args)).rejects.toThrow(/^refine_moments: not run\. This model's k has two arms/);
    // An id that is one of the nuclear rows is refused too.
    await expect(refine_moments({ ...args, phaseGaugeParameterId: "scale" })).rejects.toThrow(/`phaseGaugeParameterId` is "scale", which is not a moment row in `parameters`/);
  }, 120_000);
});

describe("refine_magnetic_powder: one side at a time", () => {
  const free = (rows: readonly RefinementParameter[], pick: (p: RefinementParameter) => boolean): RefinementParameter[] => rows.map((p) => ({ ...p, fixed: !!p.expression || !pick(p) }));
  const isMoment = (p: RefinementParameter): boolean => p.kind === "momentMode";
  const isScaleOrBackground = (p: RefinementParameter): boolean => p.kind === "scale" || p.kind === "background";

  it("moments and nuclear rows together: refused, with the rule and what to call", async () => {
    const { args } = pageAndArgs(MODEL_A, 0);
    const both = free(args.parameters, (p) => isMoment(p) || isScaleOrBackground(p));
    await expect(refine_magnetic_powder({ ...args, parameters: both })).rejects.toThrow(
      "refine_magnetic_powder: not run. This call frees moment-side rows (mom_Mn1_0) together with nuclear rows (scale, bkg0, bkg1, bkg2, bkg3, bkg4, … (7)). MATERIA refines the moments with the nuclear model held, never in one step with a nuclear row; the scale and the background count as nuclear. For the moments, call refine_moments: it re-refines the scale and the background in rounds with them. Here, free only nuclear rows (the moments held), or only moment rows (one moments step; with `restarts`, the moment search). To run the joint fit all the same, pass joint: true; its result is then labelled a joint fit.",
    );
    // The scale alone with a moment is refused too, restarts or not, staged or not.
    const scale = free(args.parameters, (p) => isMoment(p) || p.kind === "scale");
    await expect(refine_magnetic_powder({ ...args, parameters: scale, restarts: 2, staged: false })).rejects.toThrow(/not run\. This call frees moment-side rows \(mom_Mn1_0\) together with nuclear rows \(scale\)\./);
    // `joint: false` is the default.
    await expect(refine_magnetic_powder({ ...args, parameters: both, joint: false })).rejects.toThrow(/not run/);
  });

  it("with joint: true the fit runs, and its label goes with the result into the assessment and the export bundle", async () => {
    const { c, fitter, args } = pageAndArgs(MODEL_A, 0);
    const both = free(args.parameters, (p) => isMoment(p) || isScaleOrBackground(p));
    const out = await refine_magnetic_powder({ ...args, parameters: both, joint: true, staged: false, maxIterations: 40 });
    const label = "Joint nuclear + magnetic fit, run on request (joint: true): moment rows and nuclear rows were refined in one step. This is not MATERIA's method, in which the moments are refined with the nuclear model held (refine_moments). Say so wherever these values are quoted.";
    expect(out.note).toBe(label);
    expect(out.result.methodNote).toBe(label);
    // It is the joint fit the known-truth tests use as their reference.
    const joint = sequence(c, noisy(c.clean, 0), 0).joint;
    expect(fitter.moment(out.result.parameters)).toBeCloseTo(joint.moment, 3);
    // What reads the result repeats the label.
    const assessed = assess_refinement({ result: out.result, parameters: out.parameters, observationCount: out.observationCount });
    expect(assessed.methodNote).toBe(label);
    for (const target of ["gsas2", "fullprof"] as const) {
      const bundle = export_bundle({ target, structure: args.structure, pattern: args.pattern, parameters: out.parameters, bindings: args.bindings, result: out.result });
      const readme = bundle.files.find((f) => f.name === "README.txt")!.text;
      expect(readme, target).toContain(`How the fit behind these values was run: ${label}`);
      if (target === "gsas2") expect(bundle.files.find((f) => f.name.endsWith(".cif"))!.text).toContain(`_refine_special_details\n;\n${label}\n;`);
    }
    // Without the label nothing is added: the result of a nuclear-only fit, and its bundle.
    const nuclearOnly = await refine_magnetic_powder({ ...args, parameters: free(args.parameters, isScaleOrBackground), joint: true });
    expect(nuclearOnly.note).toBeUndefined();
    expect(nuclearOnly.result.methodNote).toBeUndefined();
    expect(assess_refinement({ result: nuclearOnly.result, parameters: nuclearOnly.parameters, observationCount: nuclearOnly.observationCount }).methodNote).toBeUndefined();
    const plain = export_bundle({ target: "gsas2", structure: args.structure, pattern: args.pattern, parameters: nuclearOnly.parameters, bindings: args.bindings, result: nuclearOnly.result });
    expect(plain.files.map((f) => f.text).join("\n")).not.toMatch(/_refine_special_details|How the fit behind these values was run/);
  }, 60_000);

  it("moment rows alone: one moments step, and the result says it is not the moments fit", async () => {
    const { fitter, args } = pageAndArgs(MODEL_A, 0);
    const note = "A single moments step with the nuclear model held, not the settled moments fit: the scale and the background were not re-refined with the moments, and the esds do not include them. For the moments to report, pass these `parameters` to refine_moments.";
    const once = await refine_magnetic_powder({ ...args, parameters: free(args.parameters, isMoment) });
    expect(once.note).toBe(note);
    expect(once.result.methodNote).toBeUndefined();
    expect(once.result.diagnostics?.esdIncludes).toBeUndefined();
    // The single step reads low (4.06 for 4.2): the bias the moments fit removes.
    expect(fitter.moment(once.result.parameters)).toBeCloseTo(4.064, 2);
    // With restarts it is the moment search, still moment rows alone, with the same note; its rows go straight to refine_moments.
    const searched = await refine_magnetic_powder({ ...args, parameters: free(args.parameters, isMoment), restarts: 2 });
    expect(searched.note).toBe(note);
    expect(searched.multiStart?.restartsRun).toBe(2);
    const settled = await refine_moments({ ...args, magnetic: searched.magnetic, parameters: searched.parameters });
    expect(Math.abs(fitter.moment(Object.fromEntries(settled.parameters.map((p) => [p.id, p.value])))) ).toBeCloseTo(4.203, 2);
  }, 60_000);

  it("nuclear rows alone, the moments held: as before, with no note", async () => {
    const { args } = pageAndArgs(MODEL_A, 0);
    const out = await refine_magnetic_powder({ ...args, parameters: free(args.parameters, isScaleOrBackground) });
    expect(out.note).toBeUndefined();
    expect(out.result.methodNote).toBeUndefined();
    expect(out.result.status).toBe("converged");
    expect(out.result.parameters.mom_Mn1_0).toBe(args.parameters.find((p) => p.id === "mom_Mn1_0")!.value);
  }, 60_000);
});

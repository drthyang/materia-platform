import { describe, it, expect } from "vitest";
import { cleanPoints, noisy, nuclearOnlyRows, sessionOf, AUDIT_PATTERN, FIT_RANGE, MODEL_B, type Case } from "@/testSupport/momentSequenceCase";
import { cleanPattern, type SpinModel } from "@/testSupport/independentMnwo4";
import { magneticStepOn } from "@/testSupport/magneticHeadless";
import { buildFor, candidatesOf, fitRows, momentFitReadout } from "@/app/magneticStep";
import { mnwo4Structure } from "@/examples/mnwo4";
import { buildStructureRefinement } from "@/core/workflow/structureRefinement";
import type { Session } from "@/app/powderSession";
import { magneticOperationSignature } from "@/core/magnetic/operationSignature";
import { ZERO_START_KICK } from "@/core/magnetic/momentsFit";
import { build_magnetic_model, refine_moments } from "@/mcp/tools";
import { magneticView } from "@/agent/magneticTools";

/**
 * Refine moments from a start that leaves an amplitude at exactly 0, against a
 * KNOWN TRUTH (the independent MnWO₄ calculation, testSupport/independentMnwo4.ts,
 * k = (½ 0 0), the group with Mx, My and Mz free).
 *
 * The page seeds the group's first mode (2 µB) and starts the others at 0. Mz
 * shares the seeded mode's irrep and moves on its own; My does not: the
 * intensity is even in it, the fit cannot leave 0, and before this the page
 * returned My 0 with an esd of 0 and Mx 28 esds off its truth (the
 * investigation of 2026-11-26). Now the fit kicks My to ZERO_START_KICK and
 * keeps it only when the ranking's Hamilton test says the data require it.
 *
 *  - truth (3, 1.5, 2) µB: My is kept, and all three are within 3 esd of the
 *    truth; its significance is given from Δχ², and value/esd reads about
 *    twice it (a component the intensity has only squared);
 *  - truth (3, 0, 2) µB: My is not required, held at 0 with no esd, and the
 *    other esds include the scale and the background again;
 *  - the page and MCP refine_moments give the same answer to 1 part in 10⁹.
 */

const A1: SpinModel = { na: 2, mnY: [3, 1.5, 2], mnMinusY: [-3, -1.5, -2] };

/**
 * The case of a model in the group with Mx, My and Mz free (G6, the sixth of
 * the app's candidates at k = (½ 0 0)). Not testSupport's caseOf: that finds
 * the group by fitting each from its seeds, which is the zero start this file
 * is about.
 */
function caseIn(model: SpinModel): Case {
  const structure = mnwo4Structure();
  const k = [0.5, 0, 0] as const;
  const clean = cleanPattern({ ...AUDIT_PATTERN, model });
  const pattern = { id: "pat", name: "independent MnWO4", xUnit: "twoTheta" as const, radiation: { kind: "neutron" as const, wavelength: AUDIT_PATTERN.wavelength }, wavelength: AUDIT_PATTERN.wavelength, points: cleanPoints(clean) };
  const spec = buildStructureRefinement(structure, pattern, { scale: AUDIT_PATTERN.scale * model.na * model.na, backgroundTerms: 6, width: AUDIT_PATTERN.fwhm });
  const nuclearTruth = spec.params.map((p) => ({ ...p, value: p.id === "bkg0" ? AUDIT_PATTERN.background : p.value, fixed: true })).map((p) => ({ ...p, initialValue: p.value }));
  const group = candidatesOf(structure, [...k])[5]!;
  const build = buildFor(structure, [...k], ["Mn1"], group.candidate.operations, { sameSite: true, magnitudes: false, flippedUnits: [] });
  expect(fitRows(build).filter((p) => !p.fixed).map((p) => p.label.slice(-4))).toEqual(["(Mx)", "(My)", "(Mz)"]);
  return { structure, k: [...k], clean, nuclearTruth, bindings: spec.bindings, build, backgroundTerms: 6 };
}

const caseA1 = caseIn(A1);
const caseB1 = caseIn(MODEL_B);

async function pageFit(c: Case, seed: number) {
  const points = noisy(c.clean, seed);
  let session: Session = sessionOf(c, points, nuclearOnlyRows(c, points));
  const step = magneticStepOn(() => ({ session, window: FIT_RANGE }), (s) => { session = s; }, () => {});
  step.handle.setK([c.k[0], c.k[1], c.k[2]]);
  step.handle.selectIons(["Mn1"]);
  const sig = magneticOperationSignature(c.build.magnetic.operations!);
  const i = step.view().reps.findIndex((r) => magneticOperationSignature(r.candidate.operations) === sig);
  step.handle.choose(`G${i + 1}`);
  const start = { ...step.view().resolvedAmps };
  const wR = await step.refineMoments();
  const v = step.view();
  const rows = fitRows(v.build!).filter((p) => !p.fixed);
  const id = (axis: string): string => rows.find((p) => p.label.includes(`(${axis})`))!.id;
  return { step, session: () => session, start, wR: wR!, v, rounds: v.fitRounds!, ids: { x: id("Mx"), y: id("My"), z: id("Mz") }, labels: Object.fromEntries(rows.map((p) => [p.id, p.label])) };
}

describe("Refine moments from a zero start: kick, then test (independent MnWO4, k = (½ 0 0))", () => {
  for (const seed of [0, 1]) {
    it(`truth (3, 1.5, 2) µB, seed ${seed}: My is kicked and kept, and Mx, My, Mz are within 3 esd of the truth`, async () => {
      const { start, wR, v, rounds, ids, labels } = await pageFit(caseA1, seed);
      // The page's start: Mx seeded, My and Mz at 0; Mz has a gradient there and moves, My does not.
      expect(start[ids.y]).toBe(0);
      expect(start[ids.z]).toBe(0);
      const z = rounds.zeroStart!;
      expect(z.rows).toEqual([ids.y]);
      expect(z.kick).toBe(ZERO_START_KICK);
      expect(z.kept).toBe(true);
      expect(z.f!).toBeGreaterThan(z.fCritical!);
      const truth = { [ids.x]: 3, [ids.y]: 1.5, [ids.z]: 2 };
      for (const [id, t] of Object.entries(truth)) expect(Math.abs(Math.abs(v.resolvedAmps[id]!) - t) / rounds.esd[id]!, labels[id]).toBeLessThan(3);
      // Its significance from Δχ² (likelihood ratio): value/esd is about twice it for a component entering only squared.
      const ratio = Math.abs(v.resolvedAmps[ids.y]!) / rounds.esd[ids.y]! / z.z!;
      expect(ratio).toBeGreaterThan(1.8);
      expect(ratio).toBeLessThan(2.2);
      expect(rounds.esdIncludes.length).toBeGreaterThan(0);
      expect(rounds.undetermined).toEqual([]);
      const readout = momentFitReadout("wR", wR, rounds, labels);
      expect(readout.details).toContain(`${labels[ids.y]} started at 0, where the fit cannot move it; kicked to 0.1 µB, it is kept: the data require it (Δχ² `);
      expect(z.perRow[ids.y]!.upperLimit).toBeUndefined();
      // The rounds shown are the reported fit's, and the line says which fit that is.
      expect(z.reported).toBe("kicked");
      expect(rounds.count).toBe(z.kickedRounds);
      expect(readout.line).toMatch(/ · kicked fit, settled in \d+ rounds?$/);
      expect(readout.details).toContain(`The fit reported is the kicked fit (${z.kickedRounds} rounds; the zero-start fit took ${z.zeroStartRounds} rounds).`);
      console.log(`[zero-start] a1 seed ${seed}: ${Object.values(ids).map((id) => `${labels[id]} ${v.resolvedAmps[id]!.toFixed(3)}(${rounds.esd[id]!.toFixed(3)})`).join(", ")}, wR ${(100 * wR).toFixed(2)} %, ${rounds.count} rounds · Δχ² ${z.deltaChi2!.toFixed(1)}, F ${z.f!.toFixed(1)} > ${z.fCritical!.toFixed(2)}, z ${z.z!.toFixed(1)}σ, value/esd ${(ratio * z.z!).toFixed(1)}`);
    }, 60_000);

    it(`truth (3, 0, 2) µB, seed ${seed}: My is not required, held at 0 with no esd, and the esds include the scale and the background`, async () => {
      const { step, wR, v, rounds, ids, labels } = await pageFit(caseB1, seed);
      const z = rounds.zeroStart!;
      expect(z.rows).toEqual([ids.y]);
      expect(z.kept).toBe(false);
      expect(v.resolvedAmps[ids.y]).toBe(0);
      expect(rounds.esd[ids.y]).toBeUndefined();
      // Not the stuck row's side effect any more: the esds of Mx and Mz include the scale and the background.
      expect(rounds.esdIncludes.length).toBeGreaterThan(0);
      for (const [id, t] of [[ids.x, 3], [ids.z, 2]] as const) expect(Math.abs(Math.abs(v.resolvedAmps[id]!) - t) / rounds.esd[id]!, labels[id]).toBeLessThan(3);
      const readout = momentFitReadout("wR", wR, rounds, labels);
      expect(readout.details).toContain(`${labels[ids.y]} started at 0, where the fit cannot move it; kicked to 0.1 µB, it is not required by the data (Δχ² `);
      // The owner's wording (2026-11-26), with the 95 % profile limit the data allow on the held row.
      const limit = z.perRow[ids.y]!.upperLimit!;
      expect(limit).toBeGreaterThan(0.3);
      expect(limit).toBeLessThan(0.8);
      expect(readout.details).toContain(` ≤ 3.85 at 5 %); held at 0, with no esd. The data allow up to ${Number(limit.toPrecision(2))} µB (95 % profile limit). The fit reported is the zero-start fit, re-run from its end with it held (the zero-start fit took `);
      expect(z.reported).toBe("zero-start, rows held");
      expect(readout.line).toMatch(new RegExp(` · zero-start fit, held at 0, settled in ${rounds.count} rounds?$`));
      console.log(`[zero-start] b1 seed ${seed} line: ${readout.line} · zero-start fit ${z.zeroStartRounds} rounds, kicked fit ${z.kickedRounds}`);
      expect(readout.details).not.toMatch(new RegExp(`${labels[ids.y]!.replace(/[()]/g, "\\$&")} ± `));
      // The Copilot's view of the chosen model says why the row has no esd.
      const chosen = magneticView(step.handle.state()).chosen as { parameters: string[]; momentsFit: string };
      expect(chosen.parameters).toContain(`${ids.y} = 0 (held at 0: not required by the data)`);
      expect(chosen.momentsFit).toContain(`; the esds include the scale and the background. ${ids.y} started at 0, where the fit cannot move it; kicked to 0.1 µB, it is not required by the data (Δχ² `);
      expect(chosen.momentsFit).toContain("; held at 0, with no esd. The data allow up to ");
      console.log(`[zero-start] b1 seed ${seed}: ${Object.values(ids).map((id) => `${labels[id]} ${v.resolvedAmps[id]!.toFixed(3)}${rounds.esd[id] === undefined ? "" : `(${rounds.esd[id]!.toFixed(3)})`}`).join(", ")} · the kicked fit put My at ${z.kickedValues[ids.y]!.toFixed(3)}: Δχ² ${z.deltaChi2!.toFixed(2)}, F ${z.f!.toFixed(2)} ≤ ${z.fCritical!.toFixed(2)}`);
    }, 60_000);
  }

  it("the page and MCP refine_moments (rows from build_magnetic_model) give the same kicked answer to 1 part in 10⁹", async () => {
    const { v, rounds, ids, start } = await pageFit(caseA1, 0);
    const c = caseA1;
    const points = noisy(c.clean, 0);
    const s = sessionOf(c, points, nuclearOnlyRows(c, points));
    const mm = build_magnetic_model({ structure: s.structure, ionLabels: ["Mn1"], operations: [...c.build.magnetic.operations!], k: [c.k[0], c.k[1], c.k[2]], moment: 2 });
    expect(Object.fromEntries(mm.parameters.map((p) => [p.id, p.value]))).toEqual(start);
    const mcp = await refine_moments({ structure: s.structure, magnetic: mm.magnetic, pattern: s.pattern, parameters: [...s.powderParams, ...mm.parameters], bindings: [...s.powderBindings, ...mm.bindings], profile: s.powderProfile, fitRange: { ...FIT_RANGE } });
    const rel = (a: number, b: number): number => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
    for (const id of Object.values(ids)) {
      expect(rel(mcp.moments[id]!, v.resolvedAmps[id]!), id).toBeLessThan(1e-9);
      expect(rel(mcp.esd[id]!, rounds.esd[id]!), id).toBeLessThan(1e-9);
    }
    expect(mcp.zeroStart).toMatchObject({ rows: [ids.y], kept: true, q: 1 });
    expect(rel(mcp.zeroStart!.deltaChi2!, rounds.zeroStart!.deltaChi2!)).toBeLessThan(1e-6);
    expect(mcp.directionNotDetermined).toBeUndefined();
    expect(mcp.reading).toContain(`${ids.y} started at 0, where the fit cannot move it; kicked to 0.1 µB, it is kept: the data require it (Δχ² `);
  }, 60_000);
});

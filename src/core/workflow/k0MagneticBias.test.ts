import { describe, it, expect } from "vitest";
import { example3Loaded } from "@/agent/validation/example3";
import { profileRequest } from "@/app/powderPage";
import { buildPowderProblem } from "@/core/workflow/powder";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { refine } from "@/core/refinement/engine";
import { candidatesOf, momentParameters, rankCandidates, buildFor, type MagneticFit } from "@/app/magneticStep";
import { noiseOf } from "@/core/magnetic/momentRestarts";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { momentCartesian } from "@/core/magnetic/moment";
import { formatMagneticSymbol } from "@/core/magnetic/bnsOg";
import { exampleMagnetic } from "@/examples/mn3gaMagnetic";
import type { ParameterKind, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { Vec3 } from "@/core/math/types";

/**
 * BENCHMARK (synthetic, truth known) — strong k = 0 magnetic intensity on the
 * nuclear lines: Example 3's simulated Mn₃Ga 30 K pattern (P2₁'/m', CW
 * neutrons). The user's method as written refines the positions and the ADPs
 * on the nuclear model before the magnetic step; at k = 0 that model takes up
 * the magnetic intensity — the B's and the scale grow far beyond their esds,
 * and the nuclear fit's verdict is "good" (GoF ≈ 2.1). Held until the moments
 * are in (the guard the Agent's tools now advise), the moments-only fit of the
 * true group starts closer to the truth. The joint fit (strongMagneticPeaks.
 * test.ts) lands on the truth either way on this pattern.
 */

const K: Vec3 = [0, 0, 0];
const s = example3Loaded();
const { structure, pattern } = s;
const profile = profileRequest(s);
const bindings = s.powderBindings;
const BASE: ParameterKind[] = ["scale", "background", "cellLength", "cellAngle"];
const PROFILE: ParameterKind[] = ["profileU", "profileV", "profileW"];
const ATOMS: ParameterKind[] = ["bIso", "positionShift"];

function run(params: readonly RefinementParameter[], kinds: readonly ParameterKind[]): { params: RefinementParameter[]; result: RefinementResult } {
  const start = params.map((p) => ({ ...p, fixed: !kinds.includes(p.kind) }));
  const result = refine(buildPowderProblem(structure, pattern, start, bindings, profile), { maxIterations: 30 });
  return { params: start.map((p) => ({ ...p, value: result.parameters[p.id] ?? p.value, ...(result.esd[p.id] !== undefined ? { esd: result.esd[p.id]! } : {}) })), result };
}

/** The method's order: base → positions → profile (positions held) → ADPs with positions (profile held), alternated with the profile. */
function methodPath() {
  let a = run(s.powderParams, BASE);
  a = run(a.params, [...BASE, "positionShift"]);
  a = run(a.params, [...BASE, ...PROFILE]);
  a = run(a.params, [...BASE, ...ATOMS]);
  for (let c = 0; c < 2; c++) {
    a = run(a.params, [...BASE, ...PROFILE]);
    a = run(a.params, [...BASE, ...ATOMS]);
  }
  return a;
}

/** The guarded nuclear stage: base → profile, the B's and positions held at the loaded model. */
function guardedPath() {
  return run(run(s.powderParams, BASE).params, [...BASE, ...PROFILE]);
}

/** The true group's moments fitted with the nuclear model held (the scale free at k = 0), as the page ranks: |M| per site. */
async function momentsOnly(nuclear: readonly RefinementParameter[]): Promise<Record<string, number>> {
  const ions = magneticIonCandidates(structure).map((i) => i.siteLabel);
  const reps = candidatesOf(structure, K).filter((r) => {
    const std = r.candidate.standard ?? r.settingMatch?.identity;
    return std && formatMagneticSymbol(std.bnsSymbol) === "P2₁'/m'";
  });
  expect(reps).toHaveLength(1);
  const fit: MagneticFit = {
    agreementLabel: "wR",
    refine: async (magnetic, momentParams, momentBindings, options) => {
      const held = nuclear.map((p) => ({ ...p, fixed: !(options?.freeScale && p.kind === "scale") }));
      const res = refine(buildMagneticPowderProblem(structure, magnetic, pattern, [...held, ...momentParams], [...bindings, ...momentBindings], profile), { maxIterations: 20 });
      return { values: { ...res.parameters }, agreement: res.agreement.rWeighted ?? null, ...noiseOf(res) };
    },
  };
  const ranking = await rankCandidates({
    structure, reps, dims: momentParameters(structure, reps, ions, K, { sameSite: true, magnitudes: false, flippedUnits: [] }), scope: "all", open: new Set(), freeScale: true, fit,
    build: (ops) => buildFor(structure, K, ions, ops, { sameSite: true, magnitudes: false, flippedUnits: [] }),
  });
  const entry = ranking[reps[0]!.candidate.id]!;
  expect(entry.status).toBe("ok");
  return Object.fromEntries(entry.magnitudes.map((m) => [m.label, m.value]));
}

const truthMoments = Object.fromEntries(exampleMagnetic().magnetic.moments.map((m) => [m.siteLabel, Math.hypot(...momentCartesian(exampleMagnetic().structure.cell, m))]));

describe("k = 0 magnetic intensity on the nuclear lines: the nuclear stage's bias (Example 3, truth known)", () => {
  const method = methodPath();
  const guarded = guardedPath();

  it("the method's ADP stage on the nuclear model alone pushes every B more than 3σ above the truth, and passes as a good fit", () => {
    for (const p of method.params.filter((q) => q.kind === "bIso")) {
      const truth = s.powderParams.find((q) => q.id === p.id)!.value;
      expect((p.value - truth) / p.esd!, p.id).toBeGreaterThan(3);
    }
    expect(method.result.diagnostics?.atBounds ?? []).toEqual([]);
    expect(method.result.agreement.goodnessOfFit!).toBeLessThanOrEqual(2.5);
  });

  it("holding the B's and positions until the moments are in gives the true group's moments a start closer to the truth at every site", async () => {
    const after = { method: await momentsOnly(method.params), guarded: await momentsOnly(guarded.params) };
    console.log(`[k0-bias] moments-only |M| (truth ${JSON.stringify(truthMoments)}): method ${JSON.stringify(after.method)} guarded ${JSON.stringify(after.guarded)}`);
    for (const [site, truth] of Object.entries(truthMoments)) {
      expect(Math.abs(after.guarded[site]! - truth), site).toBeLessThan(Math.abs(after.method[site]! - truth));
    }
  }, 180_000);
});

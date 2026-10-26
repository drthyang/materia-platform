import { describe, it, expect } from "vitest";
import { example3Loaded } from "@/agent/validation/example3";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { exampleMagnetic } from "@/examples/mn3gaMagnetic";
import { profileRequest } from "@/app/powderPage";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { momentCartesian } from "@/core/magnetic/moment";
import { refine } from "@/core/refinement/engine";
import { k0Peaks } from "@/agent/magneticTools";
import type { MagneticPanelState } from "@/agent/magneticPort";

/**
 * Strong k = 0 magnetic intensity ON the nuclear lines (Example 3: the
 * simulated Mn₃Ga 30 K pattern, P2₁'/m', truth known). The method's ADP stage
 * on the nuclear model alone absorbs it (B's 3–6× too large, the scale +50 %,
 * k0MagneticBias.test.ts); the Agent is routed to the magnetic step instead:
 * magnetic_state names k = 0 and the peaks to include, diagnose_fit puts the
 * k = 0 check before the ADP advice, refine cautions while B's or positions
 * are free against the signature — and the guarded path (B's and positions
 * held until the moments are in, then refined with them) lands on the truth.
 */

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

/** The parameters the pattern was simulated with: the loaded values, and the scale the truth model fits. */
function truth() {
  const s = example3Loaded();
  const t = exampleMagnetic();
  const free = s.powderParams.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "background") }));
  const fit = refine(buildMagneticPowderProblem(t.structure, t.magnetic, s.pattern, free, s.powderBindings, profileRequest(s)), { maxIterations: 30 });
  const values: Record<string, number> = Object.fromEntries(s.powderParams.map((p) => [p.id, p.value]));
  values.scale = fit.parameters.scale!;
  const moments = Object.fromEntries(t.magnetic.moments.map((m) => [m.siteLabel, Math.hypot(...momentCartesian(t.structure.cell, m))]));
  return { values, moments };
}

async function basePlusProfile() {
  const { port, session } = sessionPort(example3Loaded());
  const { ex, asked } = executor(fakeHost(port).host, true);
  const run = async (name: string, input: Record<string, unknown> = {}) => (await ex.run(name, input)).text;
  await run("read_skill", { name: "my-rietveld-workflow" });
  await run("read_skill", { name: "magnetic-analysis" });
  await run("set_free", { free: ["scale", "bkg*", "cell_*"] });
  await run("refine");
  await run("set_free", { free: ["profU", "profV", "profW"] });
  await run("refine");
  return { port, session, run, asked };
}

describe("strong k = 0 magnetic peaks on the nuclear lines (Example 3)", () => {
  it("routes the Agent to the magnetic step, and cautions the ADP stage on the nuclear model alone", async () => {
    const { run, asked } = await basePlusProfile();

    // The magnetic step: the strong peaks sit on nuclear lines, so none is included — the k = 0 signature, not "nothing magnetic".
    const state = parse(await run("magnetic_state"));
    expect(String(state.next)).toMatch(/k = 0 signature/);
    expect(String(state.next)).toMatch(/search_propagation_vector include \[1, 2, 3\]/);
    expect(String(state.next)).not.toMatch(/nothing magnetic to find/);
    expect(await run("search_propagation_vector")).toMatch(/include them by number, `include`/);
    const found = parse(await run("search_propagation_vector", { include: [1, 2, 3] }));
    expect((found.candidates as { k: string }[])[0]!.k).toBe("(0 0 0)");

    // diagnose_fit: the k = 0 check before the ADP and structure advice.
    const dx = parse(await run("diagnose_fit"));
    const causes = dx.causes as { cause: string; action: string }[];
    const atoms = causes.filter((c) => c.cause === "intensity-falloff" || c.cause === "structure");
    expect(atoms.length).toBeGreaterThan(0);
    for (const c of atoms) expect(c.action).toMatch(/^First the k = 0 check/);

    // refine with B's and positions free: the card and the result carry the caution.
    await run("set_free", { fix: ["profU", "profV", "profW"], free: ["B_*", "pos_*"] });
    const refined = parse(await run("refine"));
    expect(String(refined.note)).toMatch(/k = 0 magnetic signature/);
    expect(asked.at(-1)!.preview).toMatch(/Caution: the residual carries the k = 0 magnetic signature/);
    // Once the ADPs have taken part of it, the signature still reads (weighted by significance).
    expect(parse(await run("find_unexplained_peaks")).k0Magnetic).toBe(true);
  }, 120_000);

  it("the guarded path — B's and positions held until the moments are in — lands on the simulated truth", async () => {
    const { run, session, port } = await basePlusProfile();
    const t = truth();
    await run("search_propagation_vector", { include: [1, 2, 3] });
    const ranked = parse(await run("rank_magnetic_groups"));
    const best = String(ranked.best);
    expect((ranked.groups as { id: string; group: string }[]).find((g) => g.id === best)!.group).toBe("P2₁'/m'");
    await run("choose_magnetic_group", { id: best });
    await run("refine_moments");
    await run("continue_magnetic_refinement");
    // The joint fit by the method's rules: the moments with the B's and positions, alternating with the profile.
    const atoms = async () => {
      await run("set_free", { fix: ["profU", "profV", "profW"], free: ["scale", "bkg*", "cell_*", "B_*", "pos_*", "mom_*"] });
      const r = parse(await run("refine"));
      expect(r.note ?? "").not.toMatch(/k = 0 magnetic signature/);
      return r;
    };
    const profile = async () => {
      await run("set_free", { fix: ["B_*", "pos_*"], free: ["profU", "profV", "profW"] });
      return parse(await run("refine"));
    };
    await atoms();
    await profile();
    const last = await atoms();
    expect(last.gof as number).toBeLessThan(1.1);

    const s = session();
    const live = port.state();
    const esd = live.result!.esd;
    const values: Record<string, number> = Object.fromEntries(s.powderParams.map((p) => [p.id, p.value]));
    const z: number[] = [];
    for (const p of s.powderParams.filter((q) => q.kind === "scale" || q.kind === "bIso" || q.kind === "positionShift")) {
      const zi = (values[p.id]! - t.values[p.id]!) / esd[p.id]!;
      expect(Math.abs(zi), p.id).toBeLessThanOrEqual(3);
      z.push(zi);
    }
    // |M| per site against the truth, its esd from the free amplitudes (covariances neglected).
    const sizes = (v: Record<string, number>) => Object.fromEntries(applyMagneticMoments(s.magnetic!, s.powderBindings, v).moments.map((m) => [m.siteLabel, Math.hypot(...momentCartesian(s.structure.cell, m))]));
    const at = sizes(values);
    const amps = s.powderParams.filter((p) => p.kind === "momentMode").filter((p) => !p.fixed && !p.expression);
    for (const [site, size] of Object.entries(at)) {
      let v2 = 0;
      for (const p of amps) {
        const h = 1e-4 * Math.max(1, Math.abs(values[p.id]!));
        v2 += (((sizes({ ...values, [p.id]: values[p.id]! + h })[site]! - size) / h) * esd[p.id]!) ** 2;
      }
      const zi = (size - t.moments[site]!) / Math.sqrt(v2);
      expect(Math.abs(zi), site).toBeLessThanOrEqual(3);
      z.push(zi);
    }
    // 13 nuclear rows (scale, 4 B, 8 position shifts) and 3 moments: P(all within 3σ) = 0.9973¹⁶ = 96 % at the truth.
    expect(z).toHaveLength(16);
    console.log(`[strong-mag] guarded joint: GoF ${String(last.gof)} · z vs truth ${z.map((v) => v.toFixed(2)).join(" ")}`);
    expect(Math.sqrt(z.reduce((a, b) => a + b * b, 0) / z.length)).toBeLessThanOrEqual(1.5);
  }, 300_000);
});

describe("k0Peaks", () => {
  const panel = (peaks: MagneticPanelState["peaks"]): MagneticPanelState => ({ peaks } as unknown as MagneticPanelState);
  const row = (n: number, d: number, sigmas: number, near?: string) => ({ n, d, sigmas, ...(near ? { near } : {}), included: false, manual: false });

  it("reads the signature from strong on-nuclear peaks at large d, weighted by significance", () => {
    expect(k0Peaks(panel([row(1, 4.6, 24, "1 0 1"), row(2, 3.17, 62, "1 1 1"), row(3, 1.2, 8, "3 1 2"), row(4, 1.1, 7, "2 3 1")]))).toEqual([1, 2, 3, 4]);
    // Most of the excess at small d: a profile misfit, not the k = 0 signature.
    expect(k0Peaks(panel([row(1, 2.8, 20, "1 1 0"), row(2, 2.0, 60, "2 0 0"), row(3, 1.5, 90, "2 1 1")]))).toBeNull();
    // A peak off the nuclear lines included: the k-search has its input.
    expect(k0Peaks(panel([{ ...row(1, 8.1, 40), included: true }, row(2, 3.3, 50, "1 1 1")]))).toBeNull();
    // Weak ones are not read.
    expect(k0Peaks(panel([row(1, 4.6, 4, "1 0 1")]))).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { executor, fakeHost } from "@/testSupport/agentHeadless";
import { siFileProfilePage } from "@/agent/evals/pages";
import { powderPage, mn3gaSession } from "@/agent/evals/pages";
import { reportNotYet } from "@/agent/executorPolicy";
import { ruleRefusal, emptyRecord } from "@/agent/method";
import { causeRows } from "@/app/ui/fitCauses";
import { tofFileShapeAdvice } from "@/core/diagnostics/tofFileProfile";
import type { FitDiagnosis } from "@/core/diagnostics/fitDiagnosis";
import type { RefinementParameter } from "@/core/refinement/types";

/**
 * What the Copilot reads and may do on a session whose instrument file gives
 * the TOF profile (synthetic silicon on synthetic files): the file's rows are
 * held, set_free says so and names what to free instead, get_state and the
 * final-instrument-pass gate describe the session as it is, and the
 * fit-cause advice points to the sample's rows and the calibration.
 */
const parse = (t: string): Record<string, unknown> => JSON.parse(t) as Record<string, unknown>;

describe("the Copilot on an instrument file's TOF profile", () => {
  it("get_state names the profile's source, the held rows, what a profile step frees, and the σ₁² rule", async () => {
    const port = siFileProfilePage();
    const { ex } = executor(fakeHost(port).host, true);
    const state = parse((await ex.run("get_state", {})).text) as { instrument: { profile: { from: string; held: string[]; refine: string; rule: string } } };
    const profile = state.instrument.profile;
    expect(profile.from).toMatch(/^Profile as the file gives it, held\. Sample rows start at GSAS-II's defaults/);
    expect(profile.held).toContain("tof_sig1");
    expect(profile.held).toContain("tof_gamX");
    expect(profile.refine).toContain("the zero and the sample's Lorentzian rows (tofSampleLorentz, tofSampleSize)");
    expect(profile.rule).toMatch(/never free together \(tof_sig1, tofSampleGauss\)/);
  });

  it("a FullProf file's session is described with what it has: no Lorentzian sample row, and not yet checked against a FullProf run", async () => {
    const port = siFileProfilePage("fullprof");
    const { ex } = executor(fakeHost(port).host, true);
    const state = parse((await ex.run("get_state", {})).text) as { instrument: { profile: { from: string; refine: string } } };
    expect(state.instrument.profile.from).toContain("not yet checked against a FullProf run");
    expect(state.instrument.profile.refine).toContain("the zero (this session has no Lorentzian sample row; its one sample row, the Gaussian microstrain tofSampleGauss, is in no step of the method)");
    expect(port.state().parameters.some((p) => p.kind === "tofSampleLorentz" || p.kind === "tofSampleSize")).toBe(false);
  });

  it("the bundled calibration-only session reads as before: no profile entry", async () => {
    const { ex } = executor(fakeHost(powderPage(mn3gaSession())).host, true);
    const state = parse((await ex.run("get_state", {})).text) as { instrument: unknown };
    expect(JSON.stringify(state.instrument)).not.toContain("profile");
  });

  it("set_free does not free the file's rows: it says why and what to free instead", async () => {
    const port = siFileProfilePage();
    const { ex } = executor(fakeHost(port).host, true);
    const refused = parse((await ex.run("set_free", { free: ["tof_alpha*", "tof_beta*", "tof_sig*", "tof_gam*"] })).text) as { unchanged: boolean; note: string };
    expect(refused.unchanged).toBe(true);
    expect(refused.note).toMatch(/^not freed: tof_alpha1, .*the instrument file's profile, held at the file's values/);
    expect(refused.note).toContain("free the zero and the sample's Lorentzian rows (tofSampleLorentz, tofSampleSize)");
    expect(port.state().parameters.filter((p) => p.kind === "tofFileProfile").every((p) => p.fixed)).toBe(true);

    // Named with rows it may free: those are freed, the file's are not, and the answer says so.
    const mixed = parse((await ex.run("set_free", { free: ["tof_sig1", "tofSampleLorentz", "tofSampleSize", "zero"] })).text) as { note?: string };
    expect(JSON.stringify(mixed)).toContain("not freed: tof_sig1");
    const now = port.state().parameters;
    expect(now.find((p) => p.id === "tof_sig1")!.fixed).toBe(true);
    expect(now.filter((p) => p.kind === "tofSampleLorentz" || p.kind === "tofSampleSize" || p.kind === "zeroShift").every((p) => !p.fixed)).toBe(true);
  });

  it("σ₁² freed by hand is held again when the Gaussian microstrain is freed, and the answer names the rule", async () => {
    const port = siFileProfilePage();
    port.setFixed([{ id: "tof_sig1", fixed: false }]); // the user's check box
    expect(port.state().parameters.find((p) => p.id === "tof_sig1")!.fixed).toBe(false);
    const { ex } = executor(fakeHost(port).host, true);
    const out = (await ex.run("set_free", { free: ["tofSampleGauss"] })).text;
    expect(out).toContain("tof_sig1 is held now: σ₁² and the sample's Gaussian microstrain widen every peak in proportion to d alike, so the two are never free together");
    const now = port.state().parameters;
    expect(now.find((p) => p.id === "tof_sig1")!.fixed).toBe(true);
    expect(now.find((p) => p.id === "tofSampleGauss")!.fixed).toBe(false);
  });

  it("set_microstrain isotropic adds no row beside a file's profile, and says so", async () => {
    const port = siFileProfilePage();
    const { ex } = executor(fakeHost(port).host, true);
    await ex.run("set_microstrain", { model: "generalized" });
    const out = (await ex.run("set_microstrain", { model: "isotropic" })).text;
    expect(out).toContain("No row was added: the instrument file gives the profile");
    expect(port.state().parameters.some((p) => p.kind === "mustrainIso")).toBe(false);
  });

  it("the fit-cause advice points to the sample's rows and the calibration, never to the file's widths", () => {
    const port = siFileProfilePage();
    const parameters = port.state().parameters;
    const advice = tofFileShapeAdvice(parameters)!;
    expect(advice.action).toContain("its rows are held: free the zero and the sample's Lorentzian rows");
    expect(advice.action).toContain("points to the calibration");
    const dx = {
      causes: [{ id: "peak-shape", share: 0.4, evidence: "e", action: "a" }, { id: "peak-width", share: 0.3, evidence: "e", action: "a" }],
      width: { median: 1.3, low: 1.3, high: 1.3, lines: 9 },
    } as unknown as FitDiagnosis;
    const rows = causeRows(dx, { parameters, twoTheta: false, backgroundTerms: 6, stagesDone: ["base", "positions"] });
    for (const row of rows) {
      expect(row.action).toContain(advice.action);
      expect(row.todo).toContain("Free the sample's Lorentzian rows and the zero");
      expect(`${row.action} ${row.todo}`).not.toMatch(/Refine TOF σ|widths σ and the decay β/);
      expect(row.buttons.map((b) => b.label)).toEqual(["Open Microstructure"]);
    }
    // A calibration-only session keeps the advice it had.
    const plain = causeRows(dx, { parameters: powderPageTof(), twoTheta: false, backgroundTerms: 6, stagesDone: ["base", "positions"] });
    expect(plain[0]!.todo).toBe("Refine TOF σ and β (keep α)");
  });

  it("the final-instrument-pass gate asks for the zero and the sample's rows; without a file's profile, for α, β, σ as before", () => {
    const moment: RefinementParameter = { id: "m_1", label: "m", kind: "momentMode", value: 1, initialValue: 1, fixed: false };
    const file = reportNotYet("powder", [...siFileProfilePage().state().parameters, moment], null, true, false)!;
    expect(file.message).toContain("The instrument file gave the profile, and its rows stay held: free the zero and the sample's Lorentzian rows (tofSampleLorentz, tofSampleSize), with the scale and the background, everything else held (the moments, the structure), and refine to convergence");
    expect(file.message).not.toContain("TOF α, β, σ");
    const plain = reportNotYet("powder", [...powderPageTof(), moment], null, true, false)!;
    expect(plain.message).toContain("the zero and the peak shape with its asymmetry (TOF α, β, σ; constant wavelength U, V, W, X, Y and S/L, H/L)");
  });

  it("the report names the function that evaluates the file's profile and how its terms stand; a calibration-only session's lines are as before", () => {
    const text = (port: ReturnType<typeof siFileProfilePage>): string => JSON.stringify(port.reportInput!());
    const gsas = text(siFileProfilePage());
    expect(gsas).toContain("Back-to-back exponentials convolved with a pseudo-Voigt, by GSAS-II's time-of-flight function; the instrument file's 11 profile terms held at the file's values, the sample's broadening in rows of its own");
    expect(gsas).toContain("Instrument profile (file)");
    expect(gsas).toContain("Profile as the file gives it, held. Sample rows start at GSAS-II's defaults");
    const fullprof = text(siFileProfilePage("fullprof"));
    expect(fullprof).toContain("by FullProf's NPROF 9 function as documented (not yet checked against a FullProf run); the instrument file's 10 profile terms held at the file's values");
    const plain = text(powderPage(mn3gaSession()));
    expect(plain).not.toContain("Instrument profile (file)");
    expect(plain).not.toContain("the instrument file's");
  });

  it("a firm rule's refusal says why the sample's rows count as the instrument's", () => {
    const parameters = siFileProfilePage().state().parameters.map((p) => (p.kind === "tofSampleLorentz" || p.kind === "bIso" ? { ...p, fixed: false } : p));
    const free = parameters.filter((p) => !p.fixed && !p.expression);
    const refusal = ruleRefusal("powder", free, [], emptyRecord("k"), parameters)!;
    expect(refusal.rule).toBe("instrument-with-thermal");
    expect(refusal.message).toContain("tofSampleLorentz is a sample row beside the instrument file's held profile: the peak shape's share of the fit, so in the instrument group here.");
  });
});

/** A calibration-only TOF session's rows (the page's own profile). */
function powderPageTof(): RefinementParameter[] {
  return [
    { id: "tof_sig1", label: "TOF σ₁²", kind: "tofProfile", value: 30, initialValue: 30, fixed: true },
    { id: "zero", label: "zero", kind: "zeroShift", value: 0, initialValue: 0, fixed: true },
  ];
}

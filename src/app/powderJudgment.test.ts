import { describe, it, expect } from "vitest";
import { loadedSession, type Session } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { fitDiagnosisView } from "@/core/diagnostics/fitDiagnosis";
import { pageAssessment, pageFitDiagnosis } from "@/app/powderJudgment";
import type { PowderAgentPort } from "@/agent/port";

/**
 * The Validation view reads the fit through the Agent's own tools: the same
 * page gives the same diagnose_fit causes (ids, shares, evidence) and the same
 * assess_refinement findings, whichever reads it. Run on the bundled demo as
 * it opens, after a refinement, and with its cell put off by 0.3 %.
 */

/** A tool's answer without the executor's bookkeeping. */
function answer(text: string): Record<string, unknown> {
  const { ref: _ref, step: _step, ...rest } = JSON.parse(text) as Record<string, unknown>;
  return rest;
}

/** The demo's page, with its fit window, optionally with some values changed. */
function demoPort(change?: (s: Session) => Session): PowderAgentPort {
  const demo = mn3gaPowgenExample();
  const start = loadedSession(demo.structure, demo.pattern, demo.instrument, demo.extraPhases, demo.refinedParams);
  const { port } = sessionPort(change ? change(start) : start, demo.instrument, { instrumentOnPage: true });
  port.setFitRange(demo.fitRange);
  return port;
}

async function agrees(port: PowderAgentPort): Promise<void> {
  const { ex } = executor(fakeHost(port).host, true);
  const agent = answer((await ex.run("diagnose_fit", {})).text);
  const page = pageFitDiagnosis(port.state())!;
  // The view's diagnosis, rounded as the tool rounds it, is the tool's answer.
  expect(JSON.parse(JSON.stringify(fitDiagnosisView(page.diagnosis, port.state().pattern.xUnit)))).toEqual(agent);
  if (port.state().result) {
    const assessed = answer((await ex.run("assess_refinement", {})).text);
    expect(JSON.parse(JSON.stringify(pageAssessment(port.state())))).toEqual(assessed);
  } else {
    expect(pageAssessment(port.state())).toBeNull();
  }
}

describe("the Validation view and the Agent read one fit alike", () => {
  it("on the demo as it opens (a converged snapshot, no result)", async () => {
    const port = demoPort();
    await agrees(port);
    const page = pageFitDiagnosis(port.state())!;
    // The demo's story: most of the misfit in the peak tails, the lines no phase explains next.
    expect(page.diagnosis.causes.map((c) => c.id)).toEqual(["peak-tails", "unexplained-peak"]);
    expect(page.diagnosis.causes[0]!.share).toBeGreaterThan(0.8);
    expect(page.magneticNeutron).toBeDefined();
  }, 120_000);

  it("after a refinement, with assess_refinement's findings too", async () => {
    const port = demoPort();
    const { ex } = executor(fakeHost(port).host, true);
    expect(answer((await ex.run("refine", {})).text).status).toBe("converged");
    await agrees(port);
    const findings = pageAssessment(port.state())!.findings;
    // The held occupancy the tab reads as a note is the assessment's warning, worded as an input.
    expect(findings.find((f) => f.category === "physical")).toMatchObject({ severity: "warning", parameterIds: ["p0_occ_Ga1"], evidence: { origin: "input" } });
    // The background's own coefficients correlate: expected, not a warning.
    expect(findings.filter((f) => f.category === "correlation").map((f) => f.severity)).not.toContain("warning");
  }, 120_000);

  it("with the cell put off: the position misfit is read, as the Agent reads it", async () => {
    const port = demoPort((s) => ({ ...s, powderParams: s.powderParams.map((p) => (p.id === "p0_cell_a" ? { ...p, value: p.value * 1.003 } : p)) }));
    await agrees(port);
    expect(pageFitDiagnosis(port.state())!.diagnosis.causes.map((c) => c.id)).toContain("peak-position");
  }, 120_000);
});

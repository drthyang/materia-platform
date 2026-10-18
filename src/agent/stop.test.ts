import { describe, it, expect } from "vitest";
import { AgentExecutor, type ActivityEntry } from "@/agent/executor";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { MAGNETIC_TRUTH, mn3gaMagneticSession, mn3gaSession, powderPage, scPage } from "@/agent/evals/pages";
import { PAGE_METHOD } from "@/agent/skills";
import { analysisOf } from "@/agent/pages";
import type { AgentPort, PowderAgentPort } from "@/agent/port";
import { recordOnLatest } from "@/app/historyBinding";
import type { ProjectHistory } from "@/core/project/history";
import { makeExamplePowderProject } from "@/core/project/fixture";
import type { PowderWorkspace } from "@/core/project/types";
import { savedSettings, settingsFrom } from "@/agent/useAgent";

const free = (port: PowderAgentPort): string[] => port.state().parameters.filter((p) => !p.fixed && !p.expression).map((p) => p.id);
const stopped = (): AbortSignal => {
  const c = new AbortController();
  c.abort();
  return c.signal;
};

/** An executor over `port` with an approval the test controls, the page's method read. */
function withApproval(port: AgentPort, approve: (entry: ActivityEntry, signal?: AbortSignal) => Promise<boolean>): AgentExecutor {
  const ex = new AgentExecutor(fakeHost(port).host, { approve, onActivity: () => undefined });
  void ex.run("read_skill", { name: PAGE_METHOD[port.technique] });
  return ex;
}

describe("Stop reaches the executor", () => {
  it("a change reached after Stop is not run, and asks nothing (Auto included)", async () => {
    const port = powderPage(mn3gaSession());
    const { ex, asked } = executor(fakeHost(port).host, "auto");
    const before = free(port);
    const out = await ex.run("set_free", { free: ["width"] }, stopped());
    expect(out).toEqual({ isError: true, text: "Error: Stopped by the user before this ran.", status: "stopped" });
    expect(asked).toEqual([]);
    expect(free(port)).toEqual(before);
  });

  it("a change approved as Stop comes is not run", async () => {
    const port = powderPage(mn3gaSession());
    const ctrl = new AbortController();
    // Auto's approval races the Stop: it says yes, but the turn is over.
    const ex = withApproval(port, async () => {
      ctrl.abort();
      return true;
    });
    const before = free(port);
    const out = await ex.run("set_free", { free: ["width"] }, ctrl.signal);
    expect(out.text).toBe("Error: Stopped by the user before this ran.");
    expect(free(port)).toEqual(before);
  });

  it("cancels the fit a change started", async () => {
    const page = sessionPort(mn3gaSession());
    let finish: ((v: string | null) => void) | null = null;
    let cancelled = 0;
    const port: PowderAgentPort = { ...page.port, refine: () => new Promise<string | null>((r) => (finish = r)), cancel: () => { cancelled++; finish?.(null); } };
    const ctrl = new AbortController();
    const ex = withApproval(port, async () => true);
    const run = ex.run("refine", {}, ctrl.signal);
    await new Promise((r) => setTimeout(r, 50));
    expect(finish).not.toBeNull();
    ctrl.abort();
    await run;
    expect(cancelled).toBeGreaterThan(0);
  });
});

describe("a change re-checked after its approval", () => {
  it("is not run when the page changed while its card waited", async () => {
    const port = powderPage(mn3gaSession());
    const ex = withApproval(port, async () => {
      // The user frees something else by hand before approving.
      port.setFixed([{ id: "width", fixed: false }]);
      return true;
    });
    const out = await ex.run("set_free", { free: ["B_Mn1"] });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/not run: the analysis changed while it waited for approval/);
    expect(free(port)).not.toContain("B_Mn1");
  });

  it("is not run when a single-crystal setting moved while its card waited (the check once read only the rows)", async () => {
    const port = scPage();
    const ex = withApproval(port, async () => {
      // The user switches the OMIT filter before approving new weights.
      port.setOutlierFilter({ on: !port.state().outlierFilter.on, cutoffSigma: 5 });
      return true;
    });
    const out = await ex.run("set_weighting", { a: 0.05, b: 0.2 });
    expect(out.refusedBy).toBe("stale");
    expect(port.state().weighting).toBeNull();
  });

  it("is not run when the magnetic step's k moved while a group's card waited", async () => {
    const page = sessionPort(mn3gaMagneticSession());
    const step = page.port.magnetic!()!;
    step.setK([...MAGNETIC_TRUTH.k]);
    const ex = withApproval(page.port, async () => {
      // The user sets another k on the panel: "G2" now names another group.
      step.setK([0, 0, 0]);
      return true;
    });
    await ex.run("read_skill", { name: "magnetic-analysis" });
    const out = await ex.run("choose_magnetic_group", { id: MAGNETIC_TRUTH.id });
    expect(out.refusedBy).toBe("stale");
    expect(step.state().selected).toBeNull();
  });
});

describe("the method's checklist", () => {
  it("credits only what a converged fit refined, not what was freed since", async () => {
    const port = powderPage(mn3gaSession());
    const { ex, host } = ((): { ex: AgentExecutor; host: ReturnType<typeof fakeHost> } => {
      const host = fakeHost(port);
      return { ex: executor(host.host, "auto").ex, host };
    })();
    expect((await ex.run("refine", {})).isError).toBe(false);
    // The positions freed after the fit, and not refined.
    await ex.run("set_free", { free: ["pos_*"] });
    await ex.run("get_state", {});
    const record = host.records.get(analysisOf(port));
    expect(record?.stagesDone).toContain("base");
    expect(record?.stagesDone).not.toContain("positions");
  });
});

describe("the step history", () => {
  it("chains two records made in one tick, so the user's edits stay their own step", () => {
    const project = makeExamplePowderProject();
    const ws = project.workspace as PowderWorkspace;
    // Three states of the page: the scale's value differs in each.
    const snap = (a: number) => ({ structures: project.structures, workspace: { ...ws, refinement: { ...ws.refinement, parameters: ws.refinement.parameters.map((p, i) => (i === 0 ? { ...p, value: a } : p)) } } });
    const latest: { current: ProjectHistory | null } = { current: null };
    const set: (ProjectHistory | null)[] = [];
    recordOnLatest(latest, (h) => set.push(h), { ...snap(1), kind: "edit" });
    // The user's edit, then the Agent's change, before any render.
    recordOnLatest(latest, (h) => set.push(h), { ...snap(2), kind: "edit" });
    recordOnLatest(latest, (h) => set.push(h), { ...snap(3), kind: "refine", actor: "agent" });
    expect(latest.current!.steps.map((s) => `${s.kind} ${s.actor ?? "user"}`)).toEqual(["edit user", "edit user", "refine agent"]);
    expect(set).toHaveLength(3);
    // Nothing changed: no step, nothing set.
    recordOnLatest(latest, (h) => set.push(h), { ...snap(3), kind: "edit" });
    expect(set).toHaveLength(3);
  });
});

describe("Copilot settings saved", () => {
  it("never save a replay's label, so a later live run is not called a replay", () => {
    const s = settingsFrom(JSON.stringify({ mode: "lmstudio", lmstudioModel: "claude-replay", replayOf: "Claude Opus 5.5" }));
    expect(s.replayOf).toBe("Claude Opus 5.5");
    const saved = savedSettings(s);
    expect("replayOf" in saved).toBe(false);
    expect("autoApprove" in saved).toBe(false);
    expect(settingsFrom(JSON.stringify(saved)).replayOf).toBe("");
  });
});

describe("the method view on the magnetic step", () => {
  it("lets the magnetic step's own next step lead once it has peaks to work on", async () => {
    const port = powderPage(mn3gaMagneticSession());
    const { ex } = executor(fakeHost(port).host, "auto");
    // The nuclear fit leaves the satellites: the magnetic step has included peaks.
    const method = (JSON.parse((await ex.run("get_state", {})).text) as { method: { skill: string; next: string } }).method;
    expect(method.skill).toBe("magnetic-analysis");
    expect(method.next).toMatch(/^the magnetic step: search_propagation_vector: the k that indexes the residual peaks \(the stages above are the refinement step's\)$/);
    // A page with nothing magnetic keeps the powder method's next stage.
    const plain = (JSON.parse((await executor(fakeHost(powderPage(mn3gaSession())).host).ex.run("get_state", {})).text) as { method: { skill: string; next: string } }).method;
    expect(plain.skill).toBe("my-rietveld-workflow");
    expect(plain.next).not.toMatch(/magnetic/);
  });
});

describe("what a call says about the fit on screen", () => {
  it("a refinement that ran changed it; a refused or declined one, a free set and a read did not", async () => {
    const port = powderPage(mn3gaSession());
    const { ex } = executor(fakeHost(port).host, "auto");
    expect((await ex.run("refine", {})).fitChanged).toBe(true);
    expect((await ex.run("get_state", {})).fitChanged).toBeFalsy();
    expect((await ex.run("set_free", { free: ["occ_Mn1"] })).fitChanged).toBe(false);
    // The bare occupancy: the firm rule refuses the refinement.
    const refused = await ex.run("refine", {});
    expect(refused.refusedBy).toBe("firm-rule");
    expect(refused.fitChanged).toBeFalsy();
    const declined = await executor(fakeHost(port).host, false).ex.run("set_free", { fix: ["occ_Mn1"] });
    expect(declined.status).toBe("declined");
    expect(declined.fitChanged).toBeFalsy();
  });

  it("a change that clears the fit changed it (the single-crystal weights)", async () => {
    const port = scPage();
    const { ex } = executor(fakeHost(port).host, "auto");
    expect((await ex.run("refine", {})).fitChanged).toBe(true);
    expect((await ex.run("set_weighting", { a: 0.05, b: 0.2 })).fitChanged).toBe(true);
    expect(port.state().result).toBeNull();
  });
});

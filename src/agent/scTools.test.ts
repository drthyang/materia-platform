import { describe, it, expect } from "vitest";
import { keyOfState } from "@/agent/method";
import type { AgentReport } from "@/agent/report";
import { executor, fakeHost, singleCrystalPort } from "@/testSupport/agentHeadless";
import { corundumPage } from "@/testSupport/scPages";

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

function page(opts: Parameters<typeof corundumPage>[0] = {}) {
  const c = corundumPage(opts);
  const { port, calls } = singleCrystalPort(c.structure, c.dataset);
  return { c, port, calls };
}

describe("AgentExecutor on the single-crystal page", () => {
  it("reads the page in its own terms: F², R1, wR2 and GooF, the cell fixed", async () => {
    const { port } = page();
    const { ex } = executor(fakeHost(port).host, "auto");
    const st = parse((await ex.run("get_state", {})).text);
    expect(st.technique).toBe("singleCrystal");
    const phase = st.phase as Record<string, unknown>;
    expect(phase.spaceGroup).toMatch(/R -3 c/);
    expect(phase.note).toMatch(/cell is fixed/);
    const data = st.data as Record<string, unknown>;
    expect(data.probe).toBe("neutron, constant wavelength");
    expect(data.reflectionsInFile).toBeGreaterThan(300);
    expect(Object.keys(st.agreement as object)).toEqual(expect.arrayContaining(["R1", "wR2", "GooF"]));
    // The method: the data are read first.
    const method = st.method as { stages: string[]; next: string };
    expect(method.stages[0]).toMatch(/^○ Data quality/);
  });

  it("reads the data before the model, and keeps the reading in the record", async () => {
    const { port } = page();
    const { host, records } = fakeHost(port);
    const { ex } = executor(host, "auto");
    const out = parse((await ex.run("reflection_statistics", {})).text);
    const refl = out.reflections as Record<string, number>;
    // Three equivalents of each reflection, merged in -3m.
    expect(refl.redundancy).toBeGreaterThan(2.5);
    expect(refl.rInt).toBeGreaterThan(0);
    expect(refl.rInt).toBeLessThan(10);
    expect((out.resolution as Record<string, number>).dMin).toBeCloseTo(0.6, 1);
    expect(out.friedel).toMatch(/^centrosymmetric group/);
    expect(out.absences).toMatch(/no reflection the space group forbids/);
    expect(Array.isArray(out.shells)).toBe(true);
    const record = records.get(keyOfState("singleCrystal", port.state()))!;
    expect(record.dataCheck?.summary).toMatch(/reflections, \d+ unique, R_int [\d.]+ %; d_min 0\.6/);
    const st = parse((await ex.run("get_state", {})).text);
    expect((st.method as { stages: string[] }).stages[0]).toMatch(/^✓ Data quality/);
  });

  it("refines the scale and extinction as the agent, and reports R1, wR2 and GooF before and after", async () => {
    const { port, calls } = page();
    const { ex } = executor(fakeHost(port).host, "auto");
    // Free on load, as SHELXL's OSF and EXTI.
    const free = parse((await ex.run("set_free", { free: ["scale", "extinction"] })).text);
    expect(free.unchanged).toBe(true);
    const out = parse((await ex.run("refine", {})).text);
    expect(out.refined).toBe(true);
    expect(out.status).toBe("converged");
    expect(out.wR2).toBeLessThan(out.wR2Before as number);
    expect(typeof out.R1).toBe("number");
    expect(typeof out.GooF).toBe("number");
    expect(calls).toContain("refine");
    // The assessment reads the analysis of variance and the extinction.
    const a = parse((await ex.run("assess_refinement", {})).text);
    expect(a.analysisOfVariance).toBeDefined();
    expect(String(a.extinction)).toMatch(/strongest bin K =/);
  });

  it("recovers the structure through the method's stages, positions before ADPs", async () => {
    const { port, c } = page();
    const { ex } = executor(fakeHost(port).host, "auto");
    await ex.run("set_free", { free: ["scale", "extinction"] });
    await ex.run("refine", {});
    await ex.run("set_free", { free: ["pos_*"] });
    await ex.run("refine", {});
    await ex.run("set_free", { free: ["B_*"] });
    const out = parse((await ex.run("refine", {})).text);
    expect(out.status).toBe("converged");
    const s = port.state();
    const al = s.refinedStructure.sites.find((site) => site.label === "Al1")!;
    const o = s.refinedStructure.sites.find((site) => site.label === "O1")!;
    expect(al.position[2]).toBeCloseTo(c.truth.alZ, 3);
    expect(o.position[0]).toBeCloseTo(c.truth.oX, 3);
    // GooF ≈ 1: the σ's are the noise the page was built with.
    expect(s.agreement.goof).toBeGreaterThan(0.8);
    expect(s.agreement.goof).toBeLessThan(1.3);
  });

  it("switches to anisotropic ADPs seeded from the refined B, and says when they already are", async () => {
    const { port, calls } = page();
    const { ex } = executor(fakeHost(port).host, "auto");
    const out = parse((await ex.run("set_adp_model", { anisotropic: true })).text);
    expect(out.unchanged).toBeUndefined();
    expect(calls).toContain("adp anisotropic");
    const u = port.state().parameters.filter((p) => p.kind === "uAniso");
    expect(u.length).toBeGreaterThan(0);
    expect(u.every((p) => p.fixed)).toBe(true);
    expect(port.state().adpModel).toBe("anisotropic");
    const again = parse((await ex.run("set_adp_model", { anisotropic: true })).text);
    expect(again.unchanged).toBe(true);
    expect(again.note).toMatch(/already anisotropic/);
  });

  it("describes the outlier filter by what it leaves out, and sets it as a settings step", async () => {
    const { port } = page();
    const { host, steps } = fakeHost(port);
    const { ex, seen } = executor(host, "auto");
    await ex.run("set_outlier_filter", { on: true, cutoffSigma: 3 });
    const entry = seen.find((e) => e.tool === "set_outlier_filter" && e.preview);
    expect(entry?.preview).toMatch(/^Outlier filter on at 3σ: leaves out \d+ reflections? against the current model$/);
    expect(port.state().outlierFilter.on).toBe(true);
    expect(steps.at(-1)).toEqual({ kind: "settings", agent: true });
    const same = parse((await ex.run("set_outlier_filter", { on: true, cutoffSigma: 3 })).text);
    expect(same.unchanged).toBe(true);
  });

  it("refuses the powder page's tools, naming the page", async () => {
    const { port } = page();
    const { ex } = executor(fakeHost(port).host, "auto");
    const out = await ex.run("set_background", { terms: 4 });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/works on the powder page only; the single-crystal page is open/);
  });

  it("writes the report with wR2, the data reading, and no number of its own", async () => {
    const { port } = page();
    const reports: AgentReport[] = [];
    const { ex } = executor(fakeHost(port).host, "auto", { onReport: (r) => reports.push(r) });
    await ex.run("reflection_statistics", {});
    await ex.run("set_free", { free: ["scale", "extinction"] });
    await ex.run("refine", {});
    const out = parse((await ex.run("write_report", { summary: "Scale and extinction refined against the merged data; positions and ADPs are next." })).text);
    expect(out.shown).toBe(true);
    const checks = out.checks as string[];
    expect(checks.some((c) => /^note: Data reading — .*R_int/.test(c))).toBe(true);
    expect(checks.some((c) => /Extinction/.test(c))).toBe(true);
    expect(out.unverifiedNumbers).toBeUndefined();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.markdown).toMatch(/\| wR2 \|/);
  });
});

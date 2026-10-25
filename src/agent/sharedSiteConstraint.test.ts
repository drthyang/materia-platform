import { describe, it, expect } from "vitest";
import { executor, fakeHost, pdfPort } from "@/testSupport/agentHeadless";
import { cscl, simulateSharedSite } from "@/testSupport/sharedSite";
import { pdfPage, withParameter as withPdfParameter, withSiteTotal } from "@/app/pdfPage";
import { pdfReportChecks } from "@/agent/pdfTools";
import { sessionPort } from "@/testSupport/agentHeadless";
import { newSession } from "@/app/powderSession";
import { withParameter } from "@/app/powderPage";
import { exampleStructure as highEntropy } from "@/examples/highEntropyWO4";

/**
 * What the Agent and the report say of a shared site on the PDF page: its
 * occupancies sum to exactly 1 by a constraint (the last follows one minus
 * the others), and the last one carries its esd.
 */

const FIT = { min: 1.5, max: 12 };
const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

describe("a shared site's constraint, as the Agent and the report give it (PDF page)", { timeout: 60_000 }, () => {
  it("get_state and refine state it, and the last occupancy's row and the report carry its esd", async () => {
    const page = pdfPage(cscl({ Fe1: 0.5, Mn1: 0.5 }), simulateSharedSite(cscl({ Fe1: 0.62, Mn1: 0.38 }), "neutron", 0.01, 11), { preset: { fitRange: FIT } });
    const { port } = pdfPort({ page });
    const { ex } = executor(fakeHost(port).host, true);
    const constraint = "occ_Mn1 = 1 − occ_Fe1: one site's occupancies, summing to exactly 1 (a constraint, not a restraint); the other refines and occ_Mn1 follows, its esd from their covariance";
    expect(parse((await ex.run("get_state", {})).text).occupancyConstraints).toEqual([constraint]);

    await ex.run("set_free", { free: ["occ_Fe1", "B_Fe1"] });
    const refined = parse((await ex.run("refine", {})).text);
    expect(refined.refined).toBe(true);
    expect(refined.note).toBe(`${constraint}; get_state gives its value and esd.`);

    const rows = parse((await ex.run("get_state", { parameters: ["occ_Fe1", "occ_Mn1"] })).text).parameterRows as { id: string; value: number; esd?: number; state: string }[];
    const [fe, mn] = [rows.find((r) => r.id === "occ_Fe1")!, rows.find((r) => r.id === "occ_Mn1")!];
    expect(mn.state).toBe("tied = -1*occ_Fe1+1");
    expect(fe.esd).toBeGreaterThan(0);
    expect(mn.esd).toBe(fe.esd);
    expect(fe.value + mn.value).toBeCloseTo(1, 5);

    const sites = (parse((await ex.run("structure_table", {})).text).phases as { sites: { label: string; occupancy: string }[] }[])[0]!.sites;
    const occ = (label: string): string => sites.find((x) => x.label === label)!.occupancy;
    expect(occ("Mn1")).toMatch(/^0\.\d+\(\d+\)$/);
    expect(occ("Mn1").replace(/^.*\(/, "")).toBe(occ("Fe1").replace(/^.*\(/, ""));

    const report = port.reportInput!();
    expect(report.data?.find((r) => r.label === "Shared sites")?.value).toBe("Fe1 and Mn1 share one site, their occupancies summing to exactly 1: Mn1 = 1 − Fe1, a constraint (its esd from the others' covariance)");
  });

  it("warns when the last occupancy leaves [0, 1] after a refinement (refine, get_state, checks, report), and not in range", async () => {
    // Fe/Mn with the site's total set to 0.5 and the data wanting 0.7 Fe: Mn = 0.5 − Fe goes negative, unclamped.
    const truth = cscl({ Fe1: 0.7, Mn1: -0.2 });
    // The scale held at the truth's (1): it would otherwise take up the site's scattering.
    const page = withPdfParameter(withSiteTotal(pdfPage(cscl({ Fe1: 0.3, Mn1: 0.2 }), simulateSharedSite(truth, "neutron", 0.005, 5, FIT, { Fe1: 0.5 }), { preset: { fitRange: FIT } }), "Fe1", 0.5), "pdfScale", { value: 1, fixed: true });
    const { port } = pdfPort({ page });
    const { ex } = executor(fakeHost(port).host, true);
    const before = parse((await ex.run("get_state", {})).text);
    expect(before.occupancyWarnings).toBeUndefined();
    expect(before.occupancyConstraints).toEqual(["occ_Mn1 = 0.5 − occ_Fe1: one site's occupancies, summing to exactly 0.5 (a total below 1: 50 % vacancies, set by the user) (a constraint, not a restraint); the other refines and occ_Mn1 follows, its esd from their covariance"]);
    await ex.run("set_free", { free: ["occ_Fe1"] });
    const refined = parse((await ex.run("refine", {})).text);
    expect(refined.refined).toBe(true);
    const warning = /^occ_Mn1 = -0\.\d{4} is outside \[0, 1\]: it follows 0\.5 − \(occ_Fe1\), and the others sum to more than the site's total 0\.5\. The tie does not clamp it/;
    expect((refined.occupancyWarnings as string[])[0]).toMatch(warning);
    expect((parse((await ex.run("get_state", {})).text).occupancyWarnings as string[])[0]).toMatch(warning);
    const check = pdfReportChecks(port.state()).find((c) => c.name === "Shared sites")!;
    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(warning);
    expect(port.reportInput!().warnings?.some((w) => warning.test(w))).toBe(true);
    // The two-species page in range: a pass, and no warning anywhere.
    const fine = pdfPort({ page: pdfPage(cscl({ Fe1: 0.5, Mn1: 0.5 }), simulateSharedSite(cscl({ Fe1: 0.62, Mn1: 0.38 }), "neutron", 0.01, 11), { preset: { fitRange: FIT } }) });
    const fx = executor(fakeHost(fine.port).host, true).ex;
    await fx.run("set_free", { free: ["occ_Fe1"] });
    expect(parse((await fx.run("refine", {})).text).occupancyWarnings).toBeUndefined();
    expect(pdfReportChecks(fine.port.state()).find((c) => c.name === "Shared sites")!.status).toBe("pass");
    expect(fine.port.reportInput!().warnings ?? []).toEqual([]);
  });

  it("on the powder page: get_state and the checks state the constraint, and warn of a last occupancy outside [0, 1]", async () => {
    const s = newSession(highEntropy());
    const { port } = sessionPort(s);
    const { ex } = executor(fakeHost(port).host, true);
    const state = parse((await ex.run("get_state", {})).text);
    expect(state.occupancyConstraints).toEqual(["occ_Zn1 = 1 − (occ_Co1 + occ_Fe1 + occ_Ni1 + occ_Mn1 + occ_Cu8): one site's occupancies, summing to exactly 1 (a constraint, not a restraint); the other 5 refine and occ_Zn1 follows, its esd from their covariance"]);
    expect(state.occupancyWarnings).toBeUndefined();
    const over = sessionPort(withParameter(s, "occ_Co1", { value: 0.4 }));
    const view = parse((await executor(fakeHost(over.port).host, true).ex.run("get_state", {})).text);
    expect((view.occupancyWarnings as string[])[0]).toMatch(/^occ_Zn1 = -0\.0680 is outside \[0, 1\]/);
  });

  it("names a six-species site's sum, and says nothing on a page without a shared site", async () => {
    const six = { Co1: 0.1, Fe1: 0.15, Ni1: 0.2, Mn1: 0.25, Cu1: 0.12, Zn1: 0.18 };
    const { port } = pdfPort({ page: pdfPage(cscl(six), simulateSharedSite(cscl(six), "neutron", 0, 1), { preset: { fitRange: FIT } }) });
    const { ex } = executor(fakeHost(port).host, true);
    expect(parse((await ex.run("get_state", {})).text).occupancyConstraints).toEqual([
      "occ_Zn1 = 1 − (occ_Co1 + occ_Fe1 + occ_Ni1 + occ_Mn1 + occ_Cu1): one site's occupancies, summing to exactly 1 (a constraint, not a restraint); the other 5 refine and occ_Zn1 follows, its esd from their covariance",
    ]);
    expect(port.reportInput!().data?.find((r) => r.label === "Shared sites")?.value).toBe("Co1, Fe1, Ni1, Mn1, Cu1 and Zn1 share one site, their occupancies summing to exactly 1: Zn1 = 1 − the others, a constraint (its esd from the others' covariance)");

    const demo = pdfPort();
    const state = parse((await executor(fakeHost(demo.port).host, true).ex.run("get_state", {})).text);
    expect(state.occupancyConstraints).toBeUndefined();
    expect(demo.port.reportInput!().data?.some((r) => r.label === "Shared sites")).toBe(false);
  });
});

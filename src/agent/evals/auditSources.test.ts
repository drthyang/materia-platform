import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { regrade, type SavedRun } from "@/agent/evals/harness";
import { scenario } from "@/agent/evals/scenarios";
import { auditedToolText } from "@/agent/report";
import { executor, fakeHost } from "@/testSupport/agentHeadless";
import { pdfPage } from "@/agent/evals/pages";

/**
 * The report's number audit reads what bond_geometry, get_state and a boxcar
 * scan's note gave the Agent, as well as the report (2026-11-07 eval gate:
 * pdf-local-geometry failed four runs of five on numbers quoted from those
 * tools). The runs' last reports, their audits and the tools' answers before
 * them are the fixture.
 */
interface Fixture {
  readonly runs: Record<string, { readonly unverifiedThen: readonly string[]; readonly audit: { readonly account: string; readonly against: string }; readonly tools: readonly { readonly name: string; readonly text: string }[] }>;
}
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/pdfLocalGeometryAudit.2026-11-07.json"), "utf8")) as Fixture;

/** A saved run of the tools' answers, then the report: what regrade() scores. */
function saved(run: Fixture["runs"][string]): SavedRun {
  const report = JSON.stringify({ shown: true, ...(run.unverifiedThen.length ? { unverifiedNumbers: run.unverifiedThen } : {}) });
  return {
    scenario: "pdf-local-geometry", technique: "pdf", passed: false, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, grades: [], records: [], asked: [], notices: [],
    events: [...run.tools.map((t) => ({ kind: "call" as const, name: t.name, input: {}, isError: false, text: t.text })), { kind: "call", name: "write_report", input: {}, isError: false, text: report }],
    reports: [{ title: "GaTa4Se8", markdown: "", unverified: run.unverifiedThen, audit: run.audit }],
  };
}

const unverified = (key: string): string[] => {
  const graded = regrade(saved(fixture.runs[key]!), scenario("pdf-local-geometry"));
  const report = graded.run.events.at(-1) as { text: string };
  return (JSON.parse(report.text) as { unverifiedNumbers?: string[] }).unverifiedNumbers ?? [];
};

describe("the report's number audit reads the tools the engine answered", () => {
  it("vouches for numbers quoted from bond_geometry, get_state and the boxcar note (Haiku #1, #3; Sonnet #2)", () => {
    expect(fixture.runs.haiku1!.unverifiedThen).toEqual(["2.520", "2.768"]); // bond_geometry 2.5199, 2.7678
    expect(fixture.runs.haiku3!.unverifiedThen).toEqual(["2.525", "2.768"]); // bond_geometry 2.525, 2.7677
    expect(fixture.runs.sonnet2!.unverifiedThen).toEqual(["13.5", "0.007"]); // the boxcar note's Rw 13.5 %, get_state's Ta U sum 0.007068
    for (const key of ["haiku1", "haiku3", "sonnet2"]) expect(unverified(key), key).toEqual([]);
  });

  it("still flags what the Agent derived itself (Sonnet #1: a drift of 0.006 Å, a 0.25 Å difference)", () => {
    expect(fixture.runs.sonnet1!.unverifiedThen).toEqual(["0.006", "0.25", "0.558"]);
    // 0.558 is get_state's Ta1 B (0.558067); the drift and the difference are its own arithmetic.
    expect(unverified("sonnet1")).toEqual(["0.006", "0.25"]);
  });

  it("reads get_state's engine values, never the Agent's notes, and a boxcar scan's note alone", () => {
    const state = JSON.stringify({ phases: [{ cell: { a: 10.3683 } }], Rw: 4.53, parameterRows: [{ id: "B_Ta1", label: "Ta1 B", value: 0.558067, esd: 0.0093, min: 0, max: 10 }], method: { notes: ["Ta1 moment 2.47 µB"] }, history: { recent: [{ label: "Refine 3.14" }] } });
    const read = auditedToolText("get_state", state)!;
    expect(read).toContain("0.558067");
    expect(read).toContain("10.3683");
    expect(read).not.toContain("2.47");
    expect(read).not.toContain("3.14");
    expect(read).not.toContain("\"max\"");
    expect(auditedToolText("boxcar_scan", JSON.stringify({ note: "2 boxes · Rw 13.5% at low r", boxcar: { boxes: [{ Rw: 17.28 }] } }))).toBe("2 boxes · Rw 13.5% at low r");
    expect(auditedToolText("bond_geometry", "{\"bonds\":[{\"distance\":2.5199}]}")).toContain("2.5199");
    expect(auditedToolText("refine", "{\"maxShiftOverEsd\":0.0064}")).toBeNull();
  });
});

describe("the audit in the app", () => {
  it("vouches for the lengths bond_geometry gave in this conversation, rounded, and not for a difference of two", async () => {
    const { ex } = executor(fakeHost(pdfPage()).host, true);
    const bonds = (JSON.parse((await ex.run("bond_geometry", { atoms: ["Ta1"], cutoff: 4 })).text) as { bonds: { distance: number }[] }).bonds.map((b) => b.distance);
    const lengths = bonds.map((d) => d.toFixed(3));
    const apart = (bonds.at(-1)! - bonds[0]!).toFixed(3);
    const words = `The Ta1 shell: ${lengths.join(", ")} Å, the longest ${apart} Å beyond the shortest.`;
    const report = async (): Promise<string[]> => (JSON.parse((await ex.run("write_report", { summary: words })).text) as { unverifiedNumbers?: string[] }).unverifiedNumbers ?? [];
    expect(await report()).toEqual([apart]);
    // A new conversation: what the tools said in the last one is not this one's. The lengths the report does not print are the Agent's again.
    ex.newConversation();
    const again = await report();
    expect(again).toContain(apart);
    expect(again.length).toBeGreaterThan(1);
  }, 60_000);
});

import { describe, it, expect } from "vitest";
import { caseById, casePage } from "@/agent/validation/cases";
import { readPowderTool } from "@/agent/powderTools";
import { fakeHost, headlessHistory } from "@/testSupport/agentHeadless";
import type { PowderAgentPort } from "@/agent/port";

/**
 * The Rietveld method's Stage 0 (my-rietveld-workflow, step 1 and step 3)
 * tried on the dev analogs of the validation's faults: each reading the skill
 * sends the Agent by is there, on the tool the skill names, and the route it
 * gives works. Dev cases only: the test set stays unseen (docs/AGENT_PLAN.md,
 * 5.5).
 */
function read(port: PowderAgentPort, tool: string): Record<string, unknown> {
  const { host } = fakeHost(port, headlessHistory(port).history);
  return readPowderTool(tool, {}, port, host) as Record<string, unknown>;
}

const page = (id: string): PowderAgentPort => {
  const c = caseById(id);
  if (!c || c.split !== "dev") throw new Error(`${id} is not a dev case`);
  return casePage(c);
};

describe("Stage 0 on the dev analogs", () => {
  it("an axis in another unit: get_state's axisWarning, before any check runs", () => {
    expect(read(page("dev-mn3ga-swapped-units"), "get_state").axisWarning).toMatch(/axis is likely in another unit.*Ask the user/);
  });

  it("one factor on every d: the cell check reads the wavelength first", () => {
    expect(read(page("dev-mn3ga-wrong-wavelength"), "check_cell_symmetry").reading).toMatch(/^The pattern's \d+ strongest peaks index the structure's cell with every d × [\d.]+.*a wrong wavelength.*Ask the user to confirm before anything else/);
  });

  it("a start further off than the Le Bail fit follows: sent to the Prefit, after which the model's lines index", async () => {
    const port = page("dev-mn3ga-cell-strained");
    const before = read(port, "check_cell_symmetry");
    expect(before.reading).toMatch(/^The Le Bail fit did not settle \(Rwp \d+(\.\d+)? %\).*Run the Prefit \(refine with mode "thorough"/);
    expect((before.unindexedPeaks as unknown[]).length).toBeGreaterThan(10);
    await port.thorough();
    const after = read(port, "check_cell_symmetry");
    expect(after.reading).not.toMatch(/did not settle/);
    expect((after.unindexedPeaks as unknown[]).length).toBeLessThanOrEqual(1);
  });

  it("an impurity's lines on a settled Le Bail fit stay a missing phase, not a start to Prefit", () => {
    const reading = String(read(page("dev-mn3ga-fluorite"), "check_cell_symmetry").reading);
    expect(reading).toMatch(/no reflection of the cell indexes: a missing phase/);
    expect(reading).not.toMatch(/Prefit/);
  });

  it("every flag of the model's centring class: read as a possible lost centring, put to the user now", () => {
    const reading = String(read(page("dev-cscl-wrong-centring"), "check_cell_symmetry").reading);
    expect(reading).toMatch(/every one of the class the I centring forbids \(h\+k\+l odd\): the pattern of a lost centring/);
    expect(reading).toMatch(/put it to the user now.*do not change the model yourself/);
    expect(reading).not.toMatch(/Do not change the space group now/);
  });
});

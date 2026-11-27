import { describe, it, expect, vi } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderAgentPort } from "@/agent/port";
import { caseById, casePage } from "@/agent/validation/cases";
import { readPowderTool } from "@/agent/powderTools";
import { fakeHost, headlessHistory } from "@/testSupport/agentHeadless";
import { leBailCellPrefit } from "@/core/workflow/leBailPrefit";
import { LE_BAIL_UNSETTLED } from "@/core/diagnostics/thresholds";

/**
 * The Prefit's Le Bail stage from a start further off than the plain Le Bail
 * fit follows, on the dev case dev-mn3ga-cell-strained (the Mn₃Ga demo opened
 * on a cell a +1.2 %, c −0.8 % off the data's). Its plain fit settles only by
 * luck, if at all: moving the demo's Mn x by 1e-5 (which moves the simulated
 * data and the start alike) sent it to a different false minimum, and the
 * stage0 test passed on some such starts and failed on others. Each start
 * here must settle.
 */
const start = vi.hoisted(() => ({ dx: 0, snapped: false }));
vi.mock("@/examples/mn3ga", async (original) => {
  const m = await original<typeof import("@/examples/mn3ga")>();
  return {
    ...m,
    exampleStructure: (): StructureModel => {
      const s = m.exampleStructure();
      const sites = s.sites.map((x) => {
        // The exact special positions the file rounds: Mn1 on y = 2x (y as printed), Ga1 at (⅓, ⅔, ¾).
        if (start.snapped && x.label === "Mn1") return { ...x, position: [x.position[1] / 2, x.position[1], x.position[2]] as const };
        if (start.snapped && x.label === "Ga1") return { ...x, position: [1 / 3, 2 / 3, 3 / 4] as const };
        if (x.label === "Mn1") return { ...x, position: [x.position[0] + start.dx, x.position[1], x.position[2]] as const };
        return x;
      });
      return { ...s, sites };
    },
  };
});


function read(port: PowderAgentPort, tool: string): Record<string, unknown> {
  const { host } = fakeHost(port, headlessHistory(port).history);
  return readPowderTool(tool, {}, port, host) as Record<string, unknown>;
}

const CASE = "dev-mn3ga-cell-strained";
/** The data's cell (the demo CIF's), and the validation's cell tolerance (cases.ts: cellRelative). */
const TRUE_A = 5.42215;
const TRUE_C = 4.375658;
const CELL_RELATIVE = 2e-4;

const STARTS: readonly { readonly name: string; readonly dx: number; readonly snapped: boolean }[] = [
  { name: "Mn x + 1e-5", dx: 1e-5, snapped: false },
  { name: "Mn x − 1e-5", dx: -1e-5, snapped: false },
  { name: "Mn x + 2e-5", dx: 2e-5, snapped: false },
  { name: "Mn x − 2e-5", dx: -2e-5, snapped: false },
  { name: "Mn x − 5.5e-5", dx: -5.5e-5, snapped: false },
  { name: "Mn and Ga on their exact special positions", dx: 0, snapped: true },
];

/** The Prefit's Le Bail request, as thoroughFit sends it. */
function prefitLeBail(cellFactor: { readonly a: number; readonly c: number }, lowAngleFirst: boolean) {
  const s = caseById(CASE)!.session();
  const isCell = (kind: string): boolean => kind === "cellLength" || kind === "cellAngle";
  const cell = s.powderParams.filter((p) => isCell(p.kind)).map((p) => (p.id === "cell_a" ? { ...p, value: TRUE_A * cellFactor.a } : p.id === "cell_c" ? { ...p, value: TRUE_C * cellFactor.c } : p));
  return leBailCellPrefit(s.structure, s.pattern, cell, s.powderBindings.filter((b) => isCell(b.kind)), {
    shape: s.powderProfile.shape,
    ...(s.powderProfile.eta !== undefined ? { eta: s.powderProfile.eta } : {}),
    lowAngleFirst,
  });
}

describe("the Prefit's Le Bail stage, from a start further off than the plain fit follows", () => {
  it.each(STARTS)("$name: the cell check sends it to the Prefit, after which the Le Bail fit settles and the model's lines index", async ({ dx, snapped }) => {
    start.dx = dx;
    start.snapped = snapped;
    try {
      const port = casePage(caseById(CASE)!);
      expect(read(port, "check_cell_symmetry").reading).toMatch(/^The Le Bail fit did not settle/);
      await port.thorough();
      const after = read(port, "check_cell_symmetry");
      expect(after.reading).not.toMatch(/did not settle/);
      expect((after.unindexedPeaks as unknown[]).length).toBeLessThanOrEqual(1);
    } finally {
      start.dx = 0;
      start.snapped = false;
    }
  });

  it.each([
    // The case's own start first; then others up to 2 % off on either axis, each one the plain fit does not settle from.
    { a: 1.012, c: 0.992 }, { a: 0.988, c: 1 }, { a: 1.005, c: 0.98 }, { a: 0.98, c: 1.02 }, { a: 1.02, c: 1.02 }, { a: 0.98, c: 0.98 },
  ])("a × $a, c × $c: the low-angle ladder finds the data's cell where the plain fit does not settle", (f) => {
    expect(prefitLeBail(f, false).rWeighted).toBeGreaterThanOrEqual(LE_BAIL_UNSETTLED);
    const ladder = prefitLeBail(f, true);
    expect(ladder.rWeighted).toBeLessThan(0.05);
    expect(Math.abs(ladder.cell.a / TRUE_A - 1)).toBeLessThan(CELL_RELATIVE);
    expect(Math.abs(ladder.cell.c / TRUE_C - 1)).toBeLessThan(CELL_RELATIVE);
  });

  it("a plain fit that settles is returned as it stands, to the last digit", () => {
    const near = { a: 1.002, c: 0.998 };
    const plain = prefitLeBail(near, false);
    expect(plain.rWeighted).toBeLessThan(0.05);
    expect(prefitLeBail(near, true)).toEqual(plain);
  });
});

import { describe, it, expect } from "vitest";
import { executor, fakeHost, pdfPort } from "@/testSupport/agentHeadless";
import { pdfPage } from "@/app/pdfPage";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";

/**
 * The boxcar scan's drift in esds against a known answer: nickel's G(r) with
 * its cell the same at every r, and with it 1 % shorter below about 6 Å than
 * beyond (a local structure that differs from the average one). Gaussian
 * noise of 2 % of the largest |G| on every point, its σ given, so the esds
 * are statistical here, as a real PDF's are not.
 */
const nickel = (a: number): StructureModel => ({
  id: "ni",
  name: "Ni",
  cell: { a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: buildSpaceGroup(225),
  sites: [{ label: "Ni1", element: "Ni", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } }],
});

function measured(local: number, average: number): PdfPattern {
  const r = makeRGrid(1.5, 20, 0.02);
  const g = (a: number): Float64Array => computeGofR(nickel(a).cell, expandStructureAtoms(nickel(a)), r, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
  const [near, far] = [g(local), g(average)];
  let seed = 1;
  const u = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const normal = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const sigma = 0.02 * far.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return {
    id: "ni",
    name: "Ni",
    scatteringType: "neutron",
    qdamp: 0.03,
    points: Array.from(r, (x, i) => {
      // The local cell below ~6 Å, the average one beyond, crossing over in about 1 Å.
      const w = 1 / (1 + Math.exp((x - 6) / 0.3));
      return { r: x, gObs: w * near[i]! + (1 - w) * far[i]! + sigma * normal(), sigma };
    }),
  };
}

async function cellDrift(local: number): Promise<{ first: number; last: number; driftInEsds: number }> {
  const { port } = pdfPort({ page: pdfPage(nickel(3.52), measured(local, 3.52), { preset: { fitRange: { min: 1.5, max: 17.5 } } }) });
  const { ex } = executor(fakeHost(port).host, true);
  const out = JSON.parse((await ex.run("boxcar_scan", { width: 4, step: 4, free: ["pdfScale", "cell_a"] })).text) as { boxcar: { passes: { spread: Record<string, { first: number; last: number; driftInEsds: number }> }[] } };
  return out.boxcar.passes[0]!.spread["cell_a"]!;
}

describe("the boxcar scan's drift in esds", { timeout: 30_000 }, () => {
  it("reads the same cell at every r as no drift", async () => {
    const a = await cellDrift(3.52);
    expect(Math.abs(a.driftInEsds)).toBeLessThan(2);
  });

  it("reads a local cell 1 % short as a drift of tens of esds, from the first box to the last", async () => {
    const a = await cellDrift(3.485);
    expect(a.first).toBeCloseTo(3.486, 2);
    expect(a.last).toBeCloseTo(3.52, 3);
    expect(a.driftInEsds).toBeGreaterThan(20);
  });
});

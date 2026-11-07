import { describe, it, expect } from "vitest";
import { mnwo4Structure, SHARED_A_SITE, sharedSiteWolframite } from "@/examples/mnwo4";

/** The published wolframite the tests use, and the shared-site fixture built on it. */
describe("MnWO₄ (Macavei & Schulz 1993) and the shared-site wolframite fixture", () => {
  it("parses to monoclinic P2/c with the published cell", () => {
    const s = mnwo4Structure();
    expect(s.spaceGroup.hermannMauguin).toBe("P 2/c");
    expect(s.spaceGroup.number).toBe(13);
    expect(s.spaceGroup.operations.length).toBe(4);
    expect([s.cell.a, s.cell.b, s.cell.c, s.cell.beta]).toEqual([4.83, 5.7603, 4.994, 91.14]);
    expect(s.sites.map((x) => x.label)).toEqual(["Mn1", "W1", "O1", "O2"]);
  });

  it("puts the fixture's A-site species on Mn's position and ADP, at the given occupancy", () => {
    const s = sharedSiteWolframite(0.2505);
    const mn = mnwo4Structure().sites[0]!;
    const shared = SHARED_A_SITE.map((l) => s.sites.find((x) => x.label === l)!);
    for (const c of shared) {
      expect(c.position).toEqual(mn.position);
      expect(c.adp).toEqual(mn.adp);
      expect(c.occupancy).toBe(0.2505);
    }
    expect(shared.map((c) => c.element)).toEqual(["Mn", "Fe", "Co", "Zn"]);
    expect(s.sites).toHaveLength(7);
  });
});

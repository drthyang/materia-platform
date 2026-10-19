import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { structureChecks } from "@/core/diagnostics/structureChecks";
import type { StructureModel } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";

/** The physical checks after a run, on structures whose fault is known (the user's rules, 2026-10-19). */

const B_OF = 8 * Math.PI * Math.PI;
type Site = { label: string; element: string; position: Vec3; occupancy?: number; u?: number };
function model(a: number, group: number, sites: Site[]): StructureModel {
  return {
    id: "m", name: "m", cell: { a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: buildSpaceGroup(group),
    sites: sites.map((s) => ({ label: s.label, element: s.element, position: s.position, occupancy: s.occupancy ?? 1, adp: { kind: "isotropic", bIso: (s.u ?? 0.008) * B_OF } })),
  } as StructureModel;
}
const at = (m: StructureModel, severity: string, pattern: RegExp) => structureChecks(m).filter((f) => f.severity === severity && pattern.test(f.summary));

describe("the physical checks after a run", () => {
  it("fails two atoms under 1 Å apart, warns under 1.5 Å, and leaves bonds to H and never-together sites alone", () => {
    expect(at(model(5, 1, [{ label: "A", element: "Mn", position: [0, 0, 0] }, { label: "B", element: "O", position: [0.18, 0, 0] }]), "critical", /A–B .* 0\.900 Å, under the 1 Å/)).toHaveLength(1);
    expect(at(model(5, 1, [{ label: "A", element: "Mn", position: [0, 0, 0] }, { label: "B", element: "O", position: [0.26, 0, 0] }]), "warning", /A–B .* 1\.300 Å, under the 1\.5 Å/)).toHaveLength(1);
    expect(structureChecks(model(5, 1, [{ label: "O1", element: "O", position: [0, 0, 0] }, { label: "H1", element: "H", position: [0.19, 0, 0] }])).filter((f) => /O1–H1|H1–O1/.test(f.summary))).toEqual([]);
    expect(structureChecks(model(5, 1, [{ label: "A", element: "Mn", position: [0, 0, 0], occupancy: 0.5 }, { label: "B", element: "Mn", position: [0.1, 0, 0], occupancy: 0.5 }])).filter((f) => /A–B|B–A/.test(f.summary))).toEqual([]);
  });

  it("warns a bond more than 10 % shorter than its bond-valence length", () => {
    // A cubic perovskite: Ti–O is a/2. At a = 3.90 Å it is 1.95 Å, 1 % under Ti⁴⁺'s 1.965 Å in six-fold coordination; at 3.40 Å it is 13 % under.
    const perovskite = (a: number) => model(a, 221, [{ label: "Sr1", element: "Sr", position: [0, 0, 0] }, { label: "Ti1", element: "Ti", position: [0.5, 0.5, 0.5] }, { label: "O1", element: "O", position: [0.5, 0.5, 0] }]);
    expect(at(perovskite(3.9), "warning", /Ti1–O1/)).toEqual([]);
    expect(at(perovskite(3.4), "warning", /Ti1–O1 is 1\.700 Å, 13% shorter than the 1\.97 Å bond-valence length of Ti4\+–O in 6-fold coordination/)).toHaveLength(1);
  });

  it("warns a U above 0.05 Å² or below 0.001 Å², and fails one above 0.1 Å²", () => {
    const one = (u: number) => model(6, 1, [{ label: "Fe1", element: "Fe", position: [0, 0, 0], u }]);
    expect(at(one(0.07), "warning", /U_iso of Fe1 is 0\.070 Å² .* above the 0\.05 Å²/)).toHaveLength(1);
    expect(at(one(0.12), "critical", /U_iso of Fe1 is 0\.120 Å² .* above the 0\.1 Å² hard limit/)).toHaveLength(1);
    expect(at(one(0.0005), "warning", /below the 0\.001 Å² of a room-temperature atom/)).toHaveLength(1);
    expect(structureChecks(one(0.01))).toEqual([]);
    // A partly occupied site's U trades with its occupancy: not read against these limits.
    expect(structureChecks(model(6, 1, [{ label: "Fe1", element: "Fe", position: [0, 0, 0], u: 0.12, occupancy: 0.6 }]))).toEqual([]);
  });

  it("warns a heavier atom vibrating well beyond a lighter one", () => {
    const pair = (uHeavy: number, uLight: number) => model(6, 1, [{ label: "Ba1", element: "Ba", position: [0, 0, 0], u: uHeavy }, { label: "O1", element: "O", position: [0.5, 0.5, 0.5], u: uLight }]);
    expect(at(pair(0.02, 0.008), "warning", /Ba1 \(Ba\) has U_iso 0\.020 Å², 2\.5× that of the lighter O1/)).toHaveLength(1);
    expect(at(pair(0.008, 0.02), "warning", /lighter/)).toEqual([]);
    // Within the margin: not flagged.
    expect(at(pair(0.012, 0.009), "warning", /lighter/)).toEqual([]);
  });
});

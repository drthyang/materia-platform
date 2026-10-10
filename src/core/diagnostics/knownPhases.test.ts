import { describe, it, expect } from "vitest";
import { matchKnownPhases } from "@/core/diagnostics/knownPhases";

/**
 * Extra peaks matched against the sample environment. The case behind it:
 * Cr₂WO₆ at 150 K on a λ = 2.4067 Å neutron diffractometer left weak peaks at
 * 2θ 62.43° and 73.45° — aluminium 111 and 200 from the cryostat, its lines
 * shifted (d × 0.994) because the shields do not sit at the sample position.
 */

const NEUTRON = { kind: "neutron" as const, wavelength: 2.4067 };
const dOf = (twoTheta: number): number => 2.4067 / (2 * Math.sin((twoTheta * Math.PI) / 360));
const RANGE = { dMin: dOf(129.9), dMax: dOf(8) };

describe("matching extra peaks to the sample environment", () => {
  it("names aluminium from the cryostat in the Cr₂WO₆ 150 K data, and leaves the third peak unexplained", () => {
    const peaks = [62.432, 66.382, 73.452].map((t) => ({ d: dOf(t), height: 30 }));
    const [lead] = matchKnownPhases(peaks, NEUTRON, RANGE);
    expect(lead?.phase).toBe("Al");
    expect(lead!.explains.map((e) => e.hkl).sort()).toEqual(["1 1 1", "2 0 0"]);
    expect(lead!.dScale).toBeGreaterThan(0.99);
    expect(lead!.dScale).toBeLessThan(0.997);
    expect(lead!.explains.some((e) => Math.abs(e.d - dOf(66.382)) < 1e-6)).toBe(false);
  });

  it("finds a standard's lines at its own cell, and lists the strong lines it should also show", () => {
    // Si on Cu Kα: 111, 220, 311 at their room-temperature d-spacings.
    const xray = { kind: "xray" as const, wavelength: 1.5406 };
    const peaks = [3.1356, 1.9201, 1.6375].map((d) => ({ d, height: 100 }));
    const [lead] = matchKnownPhases(peaks, xray, { dMin: 0.9, dMax: 6 });
    expect(lead?.phase).toBe("Si");
    expect(lead!.dScale).toBeCloseTo(1, 3);
    expect(lead!.explains).toHaveLength(3);
  });

  it("matches nothing when there is nothing to match", () => {
    expect(matchKnownPhases([], NEUTRON, RANGE)).toEqual([]);
  });
});

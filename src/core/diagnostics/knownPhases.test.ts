import { describe, it, expect } from "vitest";
import { CHANCE_LIMIT, identifyPeaks, knownPhaseNames, knownPhaseStructure, matchKnownPhases } from "@/core/diagnostics/knownPhases";

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

  it("names fluorite in NAC on 11-BM by its cell, ahead of Si and CeO₂ on the same lines", () => {
    // The cell check's unindexed peaks (d, Å) on NAC at λ = 0.4139 Å. Si (a cell
    // 0.6 % smaller) and CeO₂ (fluorite's own structure, 1 % smaller) explain
    // as many lines or more, but only with their cells stretched; fluorite fits
    // at its room-temperature cell. Ranked by line strength alone, CeO₂ won.
    const d = [3.155, 1.9322, 1.6477, 1.3661, 1.2537, 1.1154, 1.0517, 0.96603, 0.92371, 0.86401, 0.83333, 0.8238, 0.76522, 0.75777, 0.71143];
    const xray = { kind: "xray" as const, wavelength: 0.413909 };
    const matches = matchKnownPhases(d.map((x) => ({ d: x, height: 100 })), xray, { dMin: 0.414, dMax: 47 });
    expect(matches[0]?.phase).toBe("CaF₂");
    expect(matches[0]!.dScale).toBeCloseTo(1, 3);
    // All but 622 and 640, which fluorite's 4n+2 weakness keeps under 0.5 % of 220 here.
    expect(matches[0]!.explains.length).toBeGreaterThanOrEqual(13);
    for (const other of ["Si", "CeO₂"]) {
      const m = matches.find((x) => x.phase === other)!;
      expect(Math.abs(m.dScale - 1)).toBeGreaterThan(0.003);
    }
  });

  it("builds a library phase as a further phase of the model, and nothing for another name", () => {
    const caf2 = knownPhaseStructure("CaF₂")!;
    expect(caf2.name).toBe("CaF₂");
    expect(caf2.cell.a).toBeCloseTo(5.4626, 4);
    expect(caf2.sites.map((x) => x.element)).toEqual(["Ca", "F"]);
    expect(caf2.id).not.toBe(knownPhaseStructure("NaF")!.id);
    expect(knownPhaseStructure("unobtainium")).toBeNull();
    expect(knownPhaseNames()).toContain("CaF₂");
  });

  it("matches nothing when there is nothing to match", () => {
    expect(matchKnownPhases([], NEUTRON, RANGE)).toEqual([]);
    expect(identifyPeaks([], NEUTRON, RANGE).verdict).toBe("none");
  });
});

/** Peaks at random over the range, uniform in 1/d as peaks spread over a scan. */
function randomPeaks(n: number, range: { dMin: number; dMax: number }, seed: number): { d: number; height: number }[] {
  let a = seed;
  const next = (): number => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  const qMin = 1 / range.dMax;
  const qMax = 1 / range.dMin;
  return Array.from({ length: n }, () => ({ d: 1 / (qMin + next() * (qMax - qMin)), height: 0 }));
}

describe("naming a phase only where random peaks would not match as well", () => {
  it("names a library phase in about 1 % of random d-lists, where the rules alone passed one in up to 12 %", () => {
    const setups = [
      { radiation: { kind: "neutron" as const, wavelength: 1.54 }, range: { dMin: 0.8, dMax: 6 } },
      { radiation: NEUTRON, range: { dMin: 1.33, dMax: 17 } },
      { radiation: { kind: "xray" as const, wavelength: 1.5406 }, range: { dMin: 0.9, dMax: 8.8 } },
      { radiation: { kind: "xray" as const, wavelength: 0.4139 }, range: { dMin: 0.5, dMax: 10 } },
    ];
    let lists = 0;
    let named = 0;
    let rulesAlone = 0;
    let seed = 1;
    for (const { radiation, range } of setups) {
      for (const n of [2, 3, 5, 8, 12]) {
        for (let i = 0; i < 30; i++) {
          const { verdict } = identifyPeaks(randomPeaks(n, range, seed++), radiation, range);
          lists++;
          if (verdict === "named") named++;
          if (verdict === "named" || verdict === "chance") rulesAlone++;
        }
      }
    }
    expect(named / lists).toBeLessThan(0.015);
    // What the chance takes away: the rules without it named a phase several times as often.
    expect(rulesAlone).toBeGreaterThan(4 * named);
  });

  it("still names Si, fluorite in NAC and a cryostat's aluminium", () => {
    const xray = { kind: "xray" as const, wavelength: 1.5406 };
    const si = identifyPeaks([3.1356, 1.9201, 1.6375].map((d) => ({ d, height: 100 })), xray, { dMin: 0.9, dMax: 6 });
    expect(si.verdict).toBe("named");
    expect(si.candidates[0]?.phase).toBe("Si");
    const twoLines = identifyPeaks([3.1356, 1.9201].map((d) => ({ d, height: 100 })), xray, { dMin: 0.9, dMax: 6 });
    expect(twoLines.verdict).toBe("named");
    const nac = [3.155, 1.9322, 1.6477, 1.3661, 1.2537, 1.1154, 1.0517, 0.96603, 0.92371, 0.86401, 0.83333, 0.8238, 0.76522, 0.75777, 0.71143];
    const fluorite = identifyPeaks(nac.map((d) => ({ d, height: 100 })), { kind: "xray" as const, wavelength: 0.413909 }, { dMin: 0.414, dMax: 47 });
    expect([fluorite.verdict, fluorite.candidates[0]?.phase]).toEqual(["named", "CaF₂"]);
    // Al 111, 200, 220, 311 and 331 from a cooled can (d × 0.996), among four peaks of something else.
    const can = [2.338, 2.0248, 1.4317, 1.221, 0.929, 3.3, 1.77, 1.11, 0.85].map((d) => ({ d: d * 0.996, height: 1 }));
    const al = identifyPeaks(can, { kind: "neutron" as const, wavelength: 1.54 }, { dMin: 0.8, dMax: 6 });
    expect([al.verdict, al.candidates[0]?.phase]).toEqual(["named", "Al"]);
    expect(al.chance).toBeLessThan(CHANCE_LIMIT);
  });

  it("counts a line once, however many peaks sit on it", () => {
    // Two peaks 0.2 % apart on CeO₂ 111 (Cu Kα), its 220 and 311 not among them: one line, not a
    // match, and no better than Si's 111 under one of them. Counted by peak, CeO₂ led and was named.
    const xray = { kind: "xray" as const, wavelength: 1.5406 };
    const id = identifyPeaks([3.1242, 3.1305].map((d) => ({ d, height: 1 })), xray, { dMin: 0.9, dMax: 8.8 });
    expect(id.candidates.find((c) => c.phase === "CeO₂")?.explains.map((e) => e.hkl)).toEqual(["1 1 1", "1 1 1"]);
    expect(id.candidates[0]?.phase).toBe("Si");
    expect(id.verdict).toBe("weak");
  });

  it("reads the same peaks the same way each time", () => {
    const peaks = randomPeaks(5, { dMin: 0.8, dMax: 6 }, 99);
    const radiation = { kind: "neutron" as const, wavelength: 1.54 };
    expect(identifyPeaks(peaks, radiation, { dMin: 0.8, dMax: 6 })).toEqual(identifyPeaks(peaks, radiation, { dMin: 0.8, dMax: 6 }));
  });
});

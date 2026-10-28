import { describe, it, expect } from "vitest";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import {
  formatMagneticSymbol,
  identifyMagneticGroup,
  magneticGroupsForParent,
} from "@/core/magnetic/bnsOg";
import { MAGNETIC_GROUP_TABLE } from "@/core/magnetic/bnsOgTable";
import { generateMagneticCandidates } from "@/core/magnetic/magneticGroups";

/** Candidates from a built-in parent group, as the UI generates them. */
function candidatesFor(spaceGroupNumber: number) {
  const parent = buildSpaceGroup(spaceGroupNumber).operations.map((o) => ({
    ...o,
    timeReversal: 1 as const,
  }));
  return generateMagneticCandidates(parent);
}

describe("bundled BNS/OG table", () => {
  it("covers all 1651 Shubnikov groups: 230 type I, 230 type II, 674 type III, 517 type IV", () => {
    expect(MAGNETIC_GROUP_TABLE).toHaveLength(1651);
    expect(MAGNETIC_GROUP_TABLE.filter((r) => r[0] === 1)).toHaveLength(230);
    expect(MAGNETIC_GROUP_TABLE.filter((r) => r[0] === 2)).toHaveLength(230);
    expect(MAGNETIC_GROUP_TABLE.filter((r) => r[0] === 3)).toHaveLength(674);
    expect(MAGNETIC_GROUP_TABLE.filter((r) => r[0] === 4)).toHaveLength(517);
    // Only type IV has an OG symbol of its own, and an anti-translation.
    expect(MAGNETIC_GROUP_TABLE.every((r) => (r[0] === 4) === (r[4] !== "") && (r[0] === 4) === (r[8] !== ""))).toBe(true);
  });

  it("has unique BNS numbers and covers every parent group 1–230", () => {
    const numbers = MAGNETIC_GROUP_TABLE.map((r) => r[1]);
    expect(new Set(numbers).size).toBe(numbers.length);
    const parents = new Set(MAGNETIC_GROUP_TABLE.map((r) => r[5]));
    for (let n = 1; n <= 230; n++) expect(parents.has(n)).toBe(true);
  });

  it("stores P_a2/c (13.70), the AWO₄-type ground state at k = (½,0,0), with its OG symbol", () => {
    const row = MAGNETIC_GROUP_TABLE.find((r) => r[1] === "13.70")!;
    expect(row.slice(0, 6)).toEqual([4, "13.70", "P_a2/c", "13.6.82", "P_2a2/c", 13]);
    expect(row[8]).toBe("1/2,0,0");
  });

  it("identifies every tabulated group from its own operations (round trip, unambiguous)", () => {
    // Feeding each entry's operations back through the signature lookup must
    // recover exactly that entry — this exercises parsing, centring expansion,
    // and signature uniqueness over the whole table.
    const vector = (v: string): [number, number, number] =>
      v.split(",").map((c) => {
        const [num, den] = c.split("/");
        return den ? Number(num) / Number(den) : Number(num);
      }) as [number, number, number];
    for (const row of MAGNETIC_GROUP_TABLE) {
      const listed = row[6].split(";").map((s) => {
        const parts = s.split(",");
        const spatial = parseSymmetryOperation(parts.slice(0, 3).join(","));
        return { ...spatial, timeReversal: (parts[3] === "-1" ? -1 : 1) as 1 | -1 };
      });
      // The compact rows: type II lists G (each also with 1'), type IV lists D (the rest is anti'·D).
      const anti = row[8] === "" ? null : vector(row[8]);
      const ops = row[0] === 2
        ? [...listed, ...listed.map((op) => ({ ...op, timeReversal: -1 as const }))]
        : anti
          ? [...listed, ...listed.map((op) => ({ ...op, translation: [(op.translation[0] + anti[0]) % 1, (op.translation[1] + anti[1]) % 1, (op.translation[2] + anti[2]) % 1] as [number, number, number], timeReversal: -1 as const }))]
          : listed;
      const shifts = row[7] === "" ? [] : row[7].split(";").map(vector);
      const full = [
        ...ops,
        ...shifts.flatMap((t) =>
          ops.map((op) => ({
            ...op,
            translation: [
              (op.translation[0] + t[0]) % 1,
              (op.translation[1] + t[1]) % 1,
              (op.translation[2] + t[2]) % 1,
            ] as [number, number, number],
          })),
        ),
      ];
      const id = identifyMagneticGroup(full);
      expect(id?.bnsNumber, `entry ${row[1]} ${row[2]}`).toBe(row[1]);
    }
  });
});

describe("BNS/OG labels on k = 0 candidates", () => {
  it("labels the four P2₁/c (No. 14) candidates with the standard symbols and numbers", () => {
    const candidates = candidatesFor(14);
    expect(candidates).toHaveLength(4);
    const byBns = new Map(candidates.map((c) => [c.standard?.bnsNumber, c]));
    // Authoritative values straight from the bundled ISO-MAG table.
    expect(byBns.get("14.75")?.standard?.bnsSymbol).toBe("P2_1/c");
    expect(byBns.get("14.77")?.standard?.bnsSymbol).toBe("P2_1'/c");
    expect(byBns.get("14.78")?.standard?.bnsSymbol).toBe("P2_1/c'");
    expect(byBns.get("14.79")?.standard?.bnsSymbol).toBe("P2_1'/c'");
    expect(byBns.get("14.75")?.standard?.ogNumber).toBe("14.1.86");
    expect(byBns.get("14.79")?.standard?.ogNumber).toBe("14.5.90");
    // Display labels use pretty subscripts.
    expect(byBns.get("14.79")?.label).toBe("P2₁'/c'");
    // The type-I candidate is the unprimed parent.
    expect(candidates.find((c) => c.isTypeI)?.standard?.bnsNumber).toBe("14.75");
  });

  it("enumerates exactly the tabulated type-I/III groups of each parent (14, 216, 225)", () => {
    for (const parent of [14, 216, 225]) {
      const candidateLabels = candidatesFor(parent)
        .map((c) => c.standard?.bnsSymbol)
        .sort();
      const tableLabels = magneticGroupsForParent(parent)
        .filter((g) => g.magtype === 1 || g.magtype === 3)
        .map((g) => g.bnsSymbol)
        .sort();
      // Every candidate identified, and the θ-enumeration finds *all* of the
      // standard groups deriving from this parent — a bidirectional check of
      // generator and table against each other.
      expect(candidateLabels, `parent ${parent}`).toEqual(tableLabels);
    }
  });

  it("identifies the known P2₁'/m' ground state of the P2₁/m parent", () => {
    // Same parent listing as magneticGroups.test.ts (Mn₃Ga workflow).
    const parent = ["x,y,z", "-x,1/2+y,-z", "-x,-y,-z", "x,1/2-y,z"].map((s) => ({
      ...parseSymmetryOperation(s),
      timeReversal: 1 as const,
    }));
    const candidates = generateMagneticCandidates(parent);
    const p21pmp = candidates.find((c) => {
      const unprimed = c.operations.filter((o) => (o.timeReversal ?? 1) === 1);
      return unprimed.length === 2 && unprimed.some((o) => o.xyz.includes("-x,-y,-z"));
    });
    expect(p21pmp?.standard?.bnsSymbol).toBe("P2_1'/m'");
    expect(p21pmp?.standard?.parentNumber).toBe(11);
    expect(p21pmp?.label).toBe("P2₁'/m'");
    // OG symbol equals BNS symbol for types I–III.
    expect(p21pmp?.standard?.ogSymbol).toBe(p21pmp?.standard?.bnsSymbol);
  });

  it("returns null (and keeps the descriptive label) for a non-standard setting", () => {
    // P2₁/c with the unique axis moved to a (not a tabulated BNS setting).
    const parent = ["x,y,z", "x+1/2,-y,-z+1/2", "-x,-y,-z", "-x+1/2,y,z+1/2"].map((s) => ({
      ...parseSymmetryOperation(s),
      timeReversal: 1 as const,
    }));
    const candidates = generateMagneticCandidates(parent);
    expect(candidates).toHaveLength(4);
    for (const c of candidates) {
      expect(c.standard).toBeNull();
      if (!c.isTypeI) expect(c.label).toContain("primed");
    }
  });
});

describe("formatMagneticSymbol", () => {
  it("converts screw-axis subscripts and preserves primes and bars", () => {
    expect(formatMagneticSymbol("P2_1'/c'")).toBe("P2₁'/c'");
    expect(formatMagneticSymbol("Pn'ma'")).toBe("Pn'ma'");
    expect(formatMagneticSymbol("Fm'-3'm")).toBe("Fm'-3'm");
    expect(formatMagneticSymbol("P6_3/mm'c'")).toBe("P6₃/mm'c'");
  });
});

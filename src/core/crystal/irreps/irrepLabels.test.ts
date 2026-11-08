/**
 * The label-provider seam (THY-73; ADR 0004): the engine's irreps carry a
 * fingerprint, and a table-based provider, matching by fingerprint, changes
 * the labels shown and nothing else. The table here is a fake of two rows:
 * no CDML table ships (ADR 0004).
 */
import { afterEach, describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { complexIrrepsOfStar, irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { GENERIC_IRREP_LABELS, fingerprintTableProvider, irrepLabelProvider, setIrrepLabelProvider } from "@/core/crystal/irreps/irrepLabels";
import type { SymmetryOperation } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";

const R: Vec3 = [0.5, 0.5, 0.5];
const star = (ops: readonly SymmetryOperation[], k: Vec3) => irrepsOfStar(factorGroup(ops, DEFAULT_SUPERCELL), k);
const pm3m = () => buildSpaceGroup(221).operations;

afterEach(() => setIrrepLabelProvider(null));

describe("irrep label providers", () => {
  it("the default gives the generic labels, the k-vector's name first", () => {
    expect(irrepLabelProvider()).toBe(GENERIC_IRREP_LABELS);
    const s = star(pm3m(), R);
    expect(s.irreps.map((x) => x.label)).toEqual(s.irreps.map((x) => x.genericLabel));
    expect(s.irreps[7]!.label).toBe("R irrep 8 of 10");
    expect(s.irreps[7]!.fingerprint.kVector).toEqual({ label: "R", kind: "point" });
    expect(s.irreps[7]!.fingerprint.setting).toBe("P m -3 m");
  });

  it("a fake two-row table relabels the irreps it knows by fingerprint and leaves the engine, the order and the rest alone", () => {
    const before = star(pm3m(), R);
    const table = fingerprintTableProvider("fake", [
      { key: before.irreps[7]!.fingerprint.key, label: "table: R·8" },
      { key: before.irreps[0]!.fingerprint.key, label: "table: R·1" },
    ]);
    setIrrepLabelProvider(table);
    const after = star(pm3m(), R);
    expect(after.irreps.map((x) => x.label)).toEqual(before.irreps.map((x, i) => (i === 7 ? "table: R·8" : i === 0 ? "table: R·1" : x.label)));
    // The engine's numbers, order, characters and fingerprints do not move.
    expect(after.irreps.map((x) => x.index)).toEqual(before.irreps.map((x) => x.index));
    expect(after.irreps.map((x) => x.genericLabel)).toEqual(before.irreps.map((x) => x.genericLabel));
    expect(after.irreps.map((x) => x.fingerprint.key)).toEqual(before.irreps.map((x) => x.fingerprint.key));
    expect(after.irreps.map((x) => x.characters)).toEqual(before.irreps.map((x) => x.characters));
    // The physically irreducible form of a relabelled real irrep takes its label.
    expect(after.physical.find((p) => p.irreps[0] === 8)!.label).toBe("table: R·8");
    setIrrepLabelProvider(null);
    expect(star(pm3m(), R).irreps[7]!.label).toBe("R irrep 8 of 10");
  });

  it("matches whatever the order of the operation list (the fingerprint names elements, not indices)", () => {
    const ops = pm3m();
    const shuffled = [ops[0]!, ...ops.slice(1).reverse()];
    const a = star(ops, R).irreps.map((x) => x.fingerprint.key);
    const b = star(shuffled, R).irreps.map((x) => x.fingerprint.key);
    expect(b).toEqual(a);
  });

  it("a complex pair takes the table's pair label (CDML writes them joined, as GM2GM3)", () => {
    // P6 at Γ: the 6-fold rotation's complex characters give two complex pairs.
    const G: Vec3 = [0, 0, 0];
    const ops = buildSpaceGroup(168).operations;
    const complex = complexIrrepsOfStar(factorGroup(ops, DEFAULT_SUPERCELL), G).irreps.filter((x) => x.reality === "complex");
    expect(complex.length).toBe(4);
    const partner = complex.findIndex((x, i) => i > 0 && x.characters.every((c, j) => Math.abs(c.re - complex[0]!.characters[j]!.re) < 1e-9 && Math.abs(c.im + complex[0]!.characters[j]!.im) < 1e-9));
    setIrrepLabelProvider(fingerprintTableProvider("fake", [], [{ keys: [complex[0]!.fingerprint.key, complex[partner]!.fingerprint.key], label: "table: Γ pair" }]));
    const s = star(ops, G);
    const pairs = s.physical.filter((p) => p.irreps.length === 2);
    expect(pairs.map((p) => p.label).filter((l) => l === "table: Γ pair")).toHaveLength(1);
    expect(pairs.filter((p) => p.label !== "table: Γ pair").every((p) => /^Γ irreps \d⊕\d of 6$/.test(p.label))).toBe(true);
  });
});

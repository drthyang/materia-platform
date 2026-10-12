import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { looksLikeShelxIns, parseShelxIns, shelxNotes, shelxValue } from "@/parsers/shelxIns";
import { EIGHT_PI_SQUARED, uEquivalent } from "@/core/crystal/adp";

/** A small SHELX file in P2₁/c: a site on the inversion centre, a continued line, a PART pair tied by FVAR, a riding hydrogen, and a listing after END. */
const INS = `TITL test in P2(1)/c
CELL 0.71073 5.0 6.0 7.0 90 100 90
ZERR 2 0.001 0.001 0.001 0 0.01 0
LATT 1
SYMM -X, 0.5+Y, 0.5-Z
SFAC C H O FE
UNIT 4 8 4 2
TEMP -173
L.S. 4
EXTI 0.01
WGHT 0.05 0.2
FVAR 1.5 0.7
FE1 4 0.0 0.0 0.0 10.5 0.01 0.02 0.03 0.004 0.005 0.006
O1 3 0.1 0.2 0.3 11.0 0.02 0.02 0.02 =
   0.0 0.001 0.0
PART 1
C1 1 0.2 0.3 0.4 21.0 0.03
PART 2
C1B 1 0.25 0.3 0.4 -21.0 0.03
PART 0
H1 2 0.15 0.25 0.35 11.0 -1.5
HKLF 4
END
Q1 1 0.5 0.5 0.5 11.0 0.05 1.0
`;

describe("SHELX instruction files", () => {
  it("knows one from a CIF", () => {
    expect(looksLikeShelxIns(INS)).toBe(true);
    expect(looksLikeShelxIns("data_x\n_cell_length_a 5\nloop_\n_atom_site_label\nC1\n")).toBe(false);
  });

  it("resolves free variables as SHELXL does: 10m + p is p·fv(m), −(10m + p) is p·(fv(m) − 1)", () => {
    const fv = [1.5, 0.7, 0.25];
    expect(shelxValue(0.5, fv)).toEqual({ value: 0.5 });
    expect(shelxValue(11, fv)).toEqual({ value: 1 });
    expect(shelxValue(10.5, fv)).toEqual({ value: 0.5 });
    expect(shelxValue(21, fv)).toEqual({ value: 0.7, variable: 2 });
    expect(shelxValue(-21, fv).value).toBeCloseTo(0.3, 12);
    expect(shelxValue(30.5, fv)).toEqual({ value: 0.125, variable: 3 });
    expect(() => shelxValue(41, fv)).toThrow(/free variable 4/);
  });

  it("reads the model: symmetry from LATT and SYMM, SHELX's U order, the sof's site symmetry, PART and the riding U", () => {
    const { structure, instructions } = parseShelxIns(INS, "t");
    expect(structure.cell).toMatchObject({ a: 5, b: 6, c: 7, alpha: 90, beta: 100, gamma: 90 });
    expect(structure.spaceGroup.operations).toHaveLength(4);
    expect(structure.spaceGroup.number).toBe(14);
    // Nothing after END: the difference-map peaks of a .res are no atoms.
    expect(structure.sites.map((s) => s.label)).toEqual(["Fe1", "O1", "C1", "C1B", "H1"]);
    const [fe, o, c1, c1b, h] = structure.sites;
    // sof 0.5 on the inversion centre is a full site: the sof carries the site symmetry.
    expect(fe!.element).toBe("Fe");
    expect(fe!.occupancy).toBeCloseTo(1, 12);
    // U11 U22 U33 U23 U13 U12 in the file; U11 U22 U33 U12 U13 U23 in the model.
    expect(fe!.adp).toEqual({ kind: "anisotropic", uAniso: [0.01, 0.02, 0.03, 0.006, 0.005, 0.004] });
    // A line continued with "=".
    expect(o!.adp).toEqual({ kind: "anisotropic", uAniso: [0.02, 0.02, 0.02, 0, 0.001, 0] });
    // 21 and −21: the free variable's 0.7 and its complement.
    expect(c1!.occupancy).toBeCloseTo(0.7, 12);
    expect(c1b!.occupancy).toBeCloseTo(0.3, 12);
    expect(c1!.disorder).toEqual({ assembly: "A", group: 1 });
    expect(c1b!.disorder).toEqual({ assembly: "A", group: 2 });
    // −1.5: 1.5·U_eq of the last atom that is not a hydrogen (C1B).
    expect(h!.adp.kind).toBe("isotropic");
    expect(h!.adp.kind === "isotropic" && h!.adp.bIso).toBeCloseTo(EIGHT_PI_SQUARED * 1.5 * 0.03, 10);
    expect(instructions).toMatchObject({ title: "test in P2(1)/c", wavelength: 0.71073, exti: 0.01, weighting: { a: 0.05, b: 0.2 }, freeVariables: [1.5, 0.7], hklf: 4 });
    // TEMP is in °C.
    expect(instructions.temperature).toBeCloseTo(100.15, 6);
    expect(instructions.ridingU.get("H1")).toBe(1.5);
    expect(instructions.twin).toBeUndefined();
  });

  it("skips a FRAG block's atoms: a rigid fragment's model geometry, not sites", () => {
    const withFrag = INS.replace("HKLF 4", "FRAG 17 1 1 1 90 90 90\nC1 1 1.2 0.0 0.0\nC2 1 0.6 1.04 0.0\nC3 1 -0.6 1.04 0.0\nFEND\nHKLF 4");
    const { structure, instructions } = parseShelxIns(withFrag, "x");
    const plain = parseShelxIns(INS, "x").structure;
    expect(structure.sites.map((s) => s.label)).toEqual(plain.sites.map((s) => s.label));
    expect(structure.sites.find((s) => s.label === "C1")!.position).toEqual(plain.sites.find((s) => s.label === "C1")!.position);
    expect(instructions.notCarried).toContain("FRAG");
  });

  it("keeps two independent disorders apart: one assembly per free variable, or per run of PARTs", () => {
    const two = INS.replace("FVAR 1.5 0.7", "FVAR 1.5 0.7 0.6").replace("PART 0\nH1", "PART 0\nPART 1\nO2 3 0.4 0.1 0.1 31.0 0.03\nPART 2\nO2B 3 0.42 0.1 0.1 -31.0 0.03\nPART 0\nPART 1\nC5 1 0.3 0.4 0.5 10.5 0.03\nPART 2\nC5B 1 0.31 0.4 0.5 10.5 0.03\nPART 0\nH1");
    const { structure } = parseShelxIns(two, "x");
    const assembly = (label: string): string | undefined => structure.sites.find((x) => x.label === label)?.disorder?.assembly;
    // C1/C1B split by free variable 2, O2/O2B by 3, C5/C5B with fixed halves in a run of their own.
    expect(assembly("C1")).toBe(assembly("C1B"));
    expect(assembly("O2")).toBe(assembly("O2B"));
    expect(assembly("C5")).toBe(assembly("C5B"));
    expect(new Set([assembly("C1"), assembly("O2"), assembly("C5")]).size).toBe(3);
    expect(assembly("C1")).toBe("A");
  });

  it("warns when the instructions refine against anything but HKLF 4", () => {
    expect(shelxNotes(parseShelxIns(INS, "x").instructions).some((n) => /HKLF/.test(n))).toBe(false);
    const notes = shelxNotes(parseShelxIns(INS.replace("HKLF 4", "HKLF 5"), "x").instructions);
    expect(notes.find((n) => /HKLF 5/.test(n))).toMatch(/reads HKLF 4 reflection files only/);
  });
});

const INS_3A = "GSAS-II-tutorials/sc/3a.ins";

describe.skipIf(!dataExists(INS_3A))("3a.ins: Cs(C5Me5)·py in P6₁, a merohedral twin", () => {
  // The data is gitignored and CI has none: return before reading it, or collection fails.
  if (!dataExists(INS_3A)) return;
  const { structure, instructions } = parseShelxIns(readFileSync(dataPath(INS_3A), "utf8"), "3a");

  it("reads the group from its SYMM lines, the atoms in SFAC's elements, and the hydrogens' U", () => {
    expect(structure.spaceGroup.number).toBe(169);
    expect(structure.spaceGroup.operations).toHaveLength(6);
    expect(structure.cell).toMatchObject({ a: 11.37, b: 11.37, c: 20.496, gamma: 120 });
    expect(structure.sites).toHaveLength(37);
    expect(structure.sites[0]).toMatchObject({ label: "Cs1", element: "Cs" });
    expect(structure.sites.filter((s) => s.element === "H")).toHaveLength(20);
    // The methyl hydrogens' U is free variable 2 (21.0); the aromatic ones' rides at 1.2·U_eq of their carbon.
    const h11a = structure.sites.find((s) => s.label === "H11A")!;
    expect(h11a.adp.kind === "isotropic" && h11a.adp.bIso / EIGHT_PI_SQUARED).toBeCloseTo(0.08883, 8);
    const c21 = structure.sites.find((s) => s.label === "C21")!;
    const h21 = structure.sites.find((s) => s.label === "H21")!;
    expect(h21.adp.kind === "isotropic" && h21.adp.bIso).toBeCloseTo(EIGHT_PI_SQUARED * 1.2 * uEquivalent((c21.adp as { uAniso: readonly number[] }).uAniso as [number, number, number, number, number, number], structure.cell), 8);
  });

  it("returns the refinement's instructions: TWIN, BASF, EXTI, WGHT, FVAR, AFIX", () => {
    expect(instructions.twin).toEqual({ matrix: [[0, 1, 0], [1, 0, 0], [0, 0, -1]], domains: 2 });
    expect(instructions).toMatchObject({ wavelength: 0.71073, basf: [0.34068], exti: 0.001994, weighting: { a: 0.0374, b: 0.6277 }, freeVariables: [0.26134, 0.08883], hklf: 4 });
    expect(instructions.temperature).toBeUndefined();
    expect(instructions.sharedU).toEqual([{ variable: 2, value: 0.08883, labels: ["H11A", "H11B", "H11C", "H12A", "H12B", "H12C", "H13A", "H13B", "H13C", "H14A", "H14B", "H14C", "H15A", "H15B", "H15C"] }]);
    expect([...instructions.ridingU.values()]).toEqual([1.2, 1.2, 1.2, 1.2, 1.2]);
    expect(instructions.afix.get("H11A")).toBe(137);
    expect(instructions.afix.get("H21")).toBe(43);
    const notes = shelxNotes(instructions);
    expect(notes[0]).toBe("CELL: λ 0.71073 Å (X-ray); no TEMP (SHELXL then takes 20 °C)");
    expect(notes).toContain("TWIN: law h′ = R·h, R = [[0,1,0],[1,0,0],[0,0,-1]], 2 domains, BASF 0.34068");
    expect(notes).toContain("15 hydrogens (H11A, H11B, H11C, …) share one refined U_iso, free variable 2 = 0.08883");
  });
});

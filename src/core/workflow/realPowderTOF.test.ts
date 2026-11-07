import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parsePowderData } from "@/parsers/powderData";
import { detectDataFormat } from "@/parsers/detectFormat";
import { generateReflections } from "@/core/diffraction/reflections";
import { siteMultiplicity } from "@/core/crystal/symmetry";
import { dSpacing } from "@/core/crystal/unitCell";
import { powderCurves } from "@/core/workflow/powder";
import { dataExists, readData, LOCAL_DATA, LOCAL_REFERENCES } from "@/testSupport/data";
import type { RefinementParameter } from "@/core/refinement/types";

/**
 * Real POWGEN time-of-flight neutron data, the paramagnetic pattern of the
 * local magnetic TOF dataset (`LOCAL_DATA.magneticTof`, unpublished;
 * monoclinic, several cations disordered on one site; reference values in
 * data/local-references.json).
 *
 * TOF profile refinement is not in the engine yet (roadmap M1), so the pattern is
 * exercised **view-only** here: parsing, indexing, and a crash-free calculation
 * that (correctly) produces no Bragg peaks on a TOF abscissa. Skips when the
 * git-ignored data/ folder is absent.
 */

const DIR = LOCAL_DATA.magneticTof;
const CIF = `${DIR}/structure_100K.cif`;
const GSAS = `${DIR}/instrument_bank3.instprm`;
const JANA = `${DIR}/instrument_bank3_jana.instprm`;
const DAT = `${DIR}/PG3_powder_100K.dat`;
const REF = LOCAL_REFERENCES?.magneticTof;
const has = !!REF && dataExists(CIF) && dataExists(DAT);

describe.skipIf(!has)("real powder TOF — the local POWGEN dataset, paramagnetic", () => {
  it("parses the structure: the reference space group and cell, several cations disordered on one site", () => {
    const s = parseCif(readData(CIF), "powgen");
    const ref = REF!.structure;
    expect(s.spaceGroup.hermannMauguin).toBe(ref.spaceGroup);
    expect(s.cell.a).toBeCloseTo(ref.cell.a, 3);
    expect(s.cell.b).toBeCloseTo(ref.cell.b, 3);
    expect(s.cell.c).toBeCloseTo(ref.cell.c, 3);
    expect(s.cell.beta).toBeCloseTo(ref.cell.beta, 3);

    const cations = ref.sharedSite.labels.map((l) => s.sites.find((x) => x.label === l));
    for (const c of cations) {
      expect(c).toBeDefined();
      expect(c!.occupancy).toBeCloseTo(ref.sharedSite.occupancy, 3);
      expect(siteMultiplicity(s.spaceGroup.operations, c!.position)).toBe(siteMultiplicity(s.spaceGroup.operations, cations[0]!.position));
    }
    // All of them share the same crystallographic position (the disordered site)…
    const p0 = cations[0]!.position;
    for (const c of cations) expect(c!.position).toEqual(p0);
    // …their occupancies summing to the reference's total; every other site is ordered.
    expect(cations.reduce((a, c) => a + c!.occupancy, 0)).toBeCloseTo(ref.sharedSite.sum, 3);
    for (const x of s.sites.filter((y) => !ref.sharedSite.labels.includes(y.label))) expect(x.occupancy, x.label).toBe(1);
  });

  it("reads both the GSAS and JANA TOF instrument calibrations", () => {
    const g = parseInstrumentParameters(readData(GSAS));
    expect(g.kind).toBe("tof");
    if (g.kind === "tof") {
      expect(g.difC).toBeCloseTo(REF!.calibration.difC, 0);
      expect(g.difA).toBeCloseTo(REF!.calibration.difA, 2);
      expect(g.difB).toBeCloseTo(REF!.calibration.difB, 2);
      expect(g.zero ?? 0).toBeCloseTo(0, 3);
    }
    const j = parseInstrumentParameters(readData(JANA));
    expect(j.kind).toBe("tof");
    if (j.kind === "tof") {
      expect(j.difC).toBeCloseTo(REF!.janaCalibration.difC, 1);
      expect(j.zero).toBeCloseTo(REF!.janaCalibration.zero, 3);
    }
  });

  it("detects TOF from the Mantid header and loads every point with its error", () => {
    const text = readData(DAT);
    const fmt = detectDataFormat({ text, filename: "PG3_powder_100K.dat" });
    expect(fmt.xUnit).toBe("tof");
    expect(fmt.source).toBe("header");
    expect(fmt.radiation.kind).toBe("neutron-tof");

    const pattern = parsePowderData(text, { id: "p", name: "POWGEN", xUnit: "tof", radiation: { kind: "neutron-tof" } });
    expect(pattern.points.length).toBe(REF!.bank3Points);
    expect(pattern.points[0]!.sigma).toBeGreaterThan(0);
    const xs = pattern.points.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(20000);
    expect(Math.max(...xs)).toBeGreaterThan(400000);
  });

  it("generates monoclinic reflections with β-split (hkl)/(hk-l) peaks", () => {
    const s = parseCif(readData(CIF), "powgen");
    const refl = generateReflections(s.cell, s.spaceGroup, 0.5, 5.0);
    expect(refl.length).toBeGreaterThan(500);
    // β ≠ 90 breaks the l → −l degeneracy: (111) and (11-1) have distinct d.
    const has111 = refl.some((r) => r.h === 1 && r.k === 1 && r.l === 1);
    const has11m1 = refl.some((r) => r.h === 1 && r.k === 1 && r.l === -1);
    expect(has111).toBe(true);
    expect(has11m1).toBe(true);
    const d111 = dSpacing(s.cell, 1, 1, 1);
    const d11m1 = dSpacing(s.cell, 1, 1, -1);
    expect(Math.abs(d111 - d11m1)).toBeGreaterThan(0.005);
  });

  it("loads TOF view-only: finite calculation, no Bragg peaks (not modelled)", () => {
    const s = parseCif(readData(CIF), "powgen");
    const pattern = parsePowderData(readData(DAT), { id: "p", name: "POWGEN", xUnit: "tof", radiation: { kind: "neutron-tof" } });
    const params: RefinementParameter[] = [
      { id: "scale", label: "s", kind: "scale", value: 1, initialValue: 1, fixed: false },
    ];
    const curves = powderCurves(s, pattern, params, [{ parameterId: "scale", kind: "scale", targetId: pattern.id }]);
    expect(curves.yCalc.length).toBe(pattern.points.length);
    // No NaN poisoning from the un-modelled TOF centers, and no calculated peaks.
    expect(curves.yCalc.every((y) => Number.isFinite(y))).toBe(true);
    expect(Math.max(...curves.yCalc)).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { detectDataFormat } from "@/parsers/detectFormat";
import {
  parseGsasHistogram,
  parseGsasHistogramPattern,
  slogChannelCenters,
} from "@/parsers/gsasHistogram";
import { powderCurves } from "@/core/workflow/powder";
import { siteMultiplicity } from "@/core/crystal/symmetry";
import { dataExists, readData, LOCAL_DATA, LOCAL_REFERENCES } from "@/testSupport/data";
import type { RefinementParameter } from "@/core/refinement/types";

/**
 * Real POWGEN time-of-flight neutron data, the local magnetic TOF dataset
 * (`LOCAL_DATA.magneticTof`, unpublished; monoclinic; reference values in
 * data/local-references.json) —
 * loaded from the raw GSAS `.gsa` histograms (BANK/SLOG/FXYE) the new parser
 * handles, across the three POWGEN detector banks (different frames → different
 * TOF ranges and channel counts). Skips when the git-ignored data/ folder is
 * absent.
 */

const DIR = LOCAL_DATA.magneticTof;
const CIF = `${DIR}/structure_100K.cif`;
const INSTPRM = `${DIR}/instrument_bank3.instprm`;
const GSA = {
  bank1: `${DIR}/PG3_powder_bank1.gsa`,
  bank2: `${DIR}/PG3_powder_bank2.gsa`,
  bank3: `${DIR}/PG3_powder_6K.gsa`,
};
const REF = LOCAL_REFERENCES?.magneticTof;
const has = !!REF && dataExists(CIF) && dataExists(GSA.bank1);

describe.skipIf(!has)("real local TOF data — POWGEN neutron TOF, raw .gsa histograms", () => {
  it("parses the structure: the reference space group and cell, several cations disordered on one site", () => {
    const s = parseCif(readData(CIF), "local");
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

  it("reads the POWGEN TOF instrument calibration (.instprm)", () => {
    const g = parseInstrumentParameters(readData(INSTPRM));
    expect(g.kind).toBe("tof");
    if (g.kind === "tof") {
      expect(g.difC).toBeCloseTo(REF!.calibration.difC, 0);
      expect(g.difA).toBeCloseTo(REF!.calibration.difA, 2);
      expect(g.difB).toBeCloseTo(REF!.calibration.difB, 2);
    }
  });

  it("parses the .gsa histograms for banks 1, 2 and 3 via the new parser", () => {
    for (const [key, rel] of Object.entries(GSA)) {
      if (!dataExists(rel)) continue;
      const text = readData(rel);
      const hist = parseGsasHistogram(text);
      expect(hist.banks).toHaveLength(1);
      const bank = hist.banks[0]!;
      expect(bank.binType).toBe("SLOG");
      expect(bank.dataType).toBe("FXYE");

      const pat = parseGsasHistogramPattern(text, key, rel);
      expect(pat.xUnit).toBe("tof");
      expect(pat.radiation).toEqual({ kind: "neutron-tof" });
      // One point per declared channel.
      expect(pat.points).toHaveLength(bank.nchan);

      const xs = pat.points.map((p) => p.x);
      // TOF microseconds, thousands+, strictly increasing.
      expect(xs[0]!).toBeGreaterThan(1000);
      for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
      expect(xs.every((x) => Number.isFinite(x))).toBe(true);
      expect(pat.points.every((p) => (p.sigma ?? 0) > 0)).toBe(true);

      // The SLOG channel-center law reproduces the explicit FXYE abscissa.
      const [c1, , c3] = bank.coefficients;
      const centers = slogChannelCenters(c1!, c3!, bank.nchan);
      let maxRel = 0;
      for (let i = 0; i < xs.length; i++) maxRel = Math.max(maxRel, Math.abs(centers[i]! - xs[i]!) / xs[i]!);
      expect(maxRel).toBeLessThan(5e-3);
    }
  });

  it("detects a .gsa as TOF from its BANK record, beating a mismatched instrument", () => {
    const fmt = detectDataFormat({
      text: readData(GSA.bank1),
      filename: "PG3_powder_bank1.gsa",
      instrument: { kind: "constantWavelength", wavelength: 1.54 },
    });
    expect(fmt.xUnit).toBe("tof");
    expect(fmt.source).toBe("header");
    expect(fmt.confidence).toBe("high");
    expect(fmt.radiation).toEqual({ kind: "neutron-tof" });
  });

  it("loads a .gsa view-only: finite calculation, no NaN (TOF profile stage-gated)", () => {
    const s = parseCif(readData(CIF), "local");
    const pattern = parseGsasHistogramPattern(readData(GSA.bank3), "p", "bank3");
    const params: RefinementParameter[] = [
      { id: "scale", label: "s", kind: "scale", value: 1, initialValue: 1, fixed: false },
    ];
    const curves = powderCurves(s, pattern, params, [
      { parameterId: "scale", kind: "scale", targetId: pattern.id },
    ]);
    expect(curves.yCalc.length).toBe(pattern.points.length);
    expect(curves.yCalc.every((y) => Number.isFinite(y))).toBe(true);
  });
});

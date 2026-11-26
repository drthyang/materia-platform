import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { CALIBRATION_STANDARDS, standardStructure, type CalibrationStandardId } from "@/core/diffraction/calibrationStandards";
import { calibrateTofBank, CALIBRATED_TERMS, type CalibratedTerm, type TofInstrument } from "@/app/instrumentCalibration";

/**
 * Known truth for the calibration (THY-91 validation a): silicon (SRM 640e)
 * and LaB₆ (SRM 660c) patterns calculated by GSAS-II from known banks of a
 * synthetic instrument file, with GSAS-II's new-phase sample terms, on a flat
 * background with counting noise (scripts/instrument-calibration/
 * simulate_standards.py). The calibration starts from a file whose calibrated
 * terms are moved off the truth and must bring each back within its esd.
 */
interface Case {
  standard: CalibrationStandardId;
  bank: number;
  x: number[];
  yNoisy: number[];
  truth: Record<string, number>;
  startInstprm: string;
}
const TRUTH = JSON.parse(readFileSync(fileURLToPath(new URL("../testSupport/calibrationKnownTruth.json", import.meta.url)), "utf8")) as {
  standards: Record<CalibrationStandardId, { a: number; uiso: Record<string, number> }>;
  cases: Record<string, Case>;
};

/** |value − truth| / esd at most this: three esds, the esds conditional on the other blocks held. */
const WITHIN_ESD = 3;

function calibrate(c: Case, difAGuard: "pairwise" | "determined") {
  const standard = CALIBRATION_STANDARDS[c.standard];
  expect(TRUTH.standards[c.standard].a).toBe(standard.certifiedA);
  const structure = standardStructure(standard, standard.certifiedA, { boronX: 0.1996, uiso: { Si1: 0.004, La1: 0.002, B1: 0.005 } });
  const pattern: PowderPattern = {
    id: "std", name: "std", xUnit: "tof", radiation: { kind: "neutron-tof" } as PowderPattern["radiation"],
    points: c.x.map((x, i) => ({ x, yObs: c.yNoisy[i]!, sigma: Math.sqrt(Math.max(c.yNoisy[i]!, 1)) })),
  };
  const start = parseInstrumentParameters(c.startInstprm, c.bank) as TofInstrument;
  // The window's low end: calibrationWindow raises it to the data's first point plus a few peak widths.
  return calibrateTofBank({ structure, pattern, start, backgroundTerms: 4, difAGuard });
}

// The guard on difA with difC, the zero and difA taken as one curve, TOF(d) (the option recommended
// to the owner; the default, "pairwise", holds difA on the LaB₆ bank-2 case: see the last test).
describe("instrument calibration: a synthetic standard gives its instrument file back", () => {
  for (const [name, c] of Object.entries(TRUTH.cases)) {
    it(`${name}: every calibrated term within ${WITHIN_ESD} esd of the truth, the standard's U_iso too`, () => {
      const r = calibrate(c, "determined");
      expect(r.status).toBe("calibrated");
      if (process.env.MATERIA_CAL_DEBUG) for (const s of r.steps) console.log(`${s.cycle} ${s.name}: wR ${s.wR.toFixed(3)} GoF ${s.gof.toFixed(3)} shift ${s.maxShiftEsd.toFixed(2)} ${s.status} ${s.correlations.map((q) => `${q.a}~${q.b} ${q.coefficient.toFixed(2)}`).join(", ")}`);
      const rows: string[] = [];
      for (const t of CALIBRATED_TERMS as readonly CalibratedTerm[]) {
        const got = r.terms[t];
        if (!got) continue;
        const z = (got.value - c.truth[t]!) / got.esd;
        rows.push(`${t} ${got.value.toPrecision(8)} (${got.esd.toPrecision(2)}) truth ${c.truth[t]} start ${got.start.toPrecision(8)} Δ/esd ${z.toFixed(2)}`);
      }
      for (const [site, u] of Object.entries(r.uiso)) {
        const truth = TRUTH.standards[c.standard].uiso[site]!;
        rows.push(`Uiso ${site} ${u.value.toPrecision(5)} (${u.esd.toPrecision(2)}) truth ${truth} Δ/esd ${((u.value - truth) / u.esd).toFixed(2)}`);
      }
      console.log(`${name}: wR ${r.wR.toFixed(3)} %, GoF ${r.gof.toFixed(3)}, ${r.reflections} reflections, d ${r.window.dMin.toFixed(3)}–${r.window.dMax.toFixed(3)} Å, ${r.steps.length} steps, difA ${r.difA.refined ? "refined" : "held"}, separable ${r.separable}; flags: ${r.flags.join(" ") || "none"}\n  ${rows.join("\n  ")}`);
      for (const t of CALIBRATED_TERMS as readonly CalibratedTerm[]) {
        const got = r.terms[t];
        if (!got || !got.refined) continue;
        expect(Math.abs((got.value - c.truth[t]!) / got.esd), `${name} ${t}`).toBeLessThan(WITHIN_ESD);
      }
      for (const [site, u] of Object.entries(r.uiso)) expect(Math.abs(u.value - TRUTH.standards[c.standard].uiso[site]!) / u.esd, `${name} Uiso ${site}`).toBeLessThan(WITHIN_ESD);
      expect(r.settled).toBe(true);
      expect(r.gof).toBeGreaterThan(0.95);
      expect(r.gof).toBeLessThan(1.05);
    }, 300_000);
  }
});

describe("instrument calibration: the pairwise guard on difA", () => {
  it("lab6660c_bank2: difA correlates with difC at the limit, so it is held at the file's value and said so", () => {
    const r = calibrate(TRUTH.cases.lab6660c_bank2!, "pairwise");
    expect(r.difA.refined).toBe(false);
    expect(r.terms.difA).toMatchObject({ refined: false, value: r.terms.difA!.start });
    expect(r.flags.some((f) => f.startsWith("difA held at -1: over this bank's d-range it correlates with difC at"))).toBe(true);
  }, 300_000);
});

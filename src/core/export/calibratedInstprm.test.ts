import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { parseInstrumentFile } from "@/parsers/instrument";
import { calibratedBankHeader, calibratedInstprm, type CalibrationProvenance } from "@/core/export/gsas2";

type Tof = Extract<InstrumentParameters, { kind: "tof" }>;
const NOMAD = readFileSync(fileURLToPath(new URL("../../../examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm", import.meta.url)), "utf8");
const PROV: CalibrationProvenance = { software: "MATERIA 0.5.1", standard: "NIST SRM 640e (Si)", a: 5.431179, temperatureK: 295.65 };

describe("calibrated instrument file", () => {
  const start = parseInstrumentFile(NOMAD);
  // Every calibrated term moved, by a different amount per bank.
  const moved = start.banks.map((b) => {
    const i = b.parameters as Tof;
    const k = b.bank!;
    return {
      bank: k, texts: b.texts,
      instrument: { ...i, difC: i.difC + 0.125 * k, difA: (i.difA ?? 0) - 0.01 * k, zero: (i.zero ?? 0) + 0.5, alpha: (i.alpha ?? 0) * 1.01, beta0: (i.beta0 ?? 0) * 1.02, beta1: (i.beta1 ?? 0) * 1.03,
        sig0: (i.sig0 ?? 0) + 1, sig1: (i.sig1 ?? 0) + 2, sig2: (i.sig2 ?? 0) + 3, gamX: (i.gamX ?? 0) + 0.25, gamY: (i.gamY ?? 0) - 0.25 } as Tof,
    };
  });
  const text = calibratedInstprm(moved, PROV);

  it("reads back bank by bank with the calibrated values, every other key as the starting file wrote it", () => {
    const back = parseInstrumentFile(text);
    expect(back.banks.map((b) => b.bank)).toEqual([1, 2, 3, 4, 5]);
    for (const [n, b] of back.banks.entries()) {
      const want = moved[n]!.instrument;
      const got = b.parameters as Tof;
      for (const key of ["difC", "difA", "zero", "alpha", "beta0", "beta1", "sig0", "sig1", "sig2", "gamX", "gamY", "betaQ", "sigQ", "difB", "gamZ"] as const) expect(got[key], `bank ${b.bank} ${key}`).toBe(want[key] ?? 0);
      // Same keys in the same order; the uncalibrated ones verbatim.
      const old = start.banks[n]!.texts;
      expect([...b.texts.keys()]).toEqual([...old.keys()]);
      for (const k of ["fltPath", "2-theta", "Azimuth", "Type", "beta-q", "sig-q", "difB", "Z"]) expect(b.texts.get(k)).toBe(old.get(k));
    }
  });

  it("states the convention and the standard on each bank's header line, in ASCII, with GSAS-II's marker first", () => {
    const headers = text.split("\n").filter((l) => l.startsWith("#"));
    expect(headers).toHaveLength(5);
    expect(headers[0]).toBe(calibratedBankHeader(1, PROV));
    expect(headers[0]).toBe("#Bank 1: GSAS-II instrument parameter file; do not add/delete items! Calibrated by MATERIA 0.5.1 from NIST SRM 640e (Si), a = 5.431179 A held (at 295.65 K); GSAS-II convention: sample size 1 um and Lorentzian microstrain 1000 held");
    // GSAS-II ends a bank at any further '#' line: none inside a block.
    for (const block of text.split(/(?=^#Bank )/m)) expect(block.split("\n").slice(1).some((l) => l.startsWith("#"))).toBe(false);
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
  });

  it("writes a bank without a starting file with the full PNT key set", () => {
    const i = moved[4]!.instrument;
    const one = parseInstrumentFile(calibratedInstprm([{ bank: 7, instrument: i }], PROV));
    expect(one.banks).toHaveLength(1);
    expect(one.banks[0]!.bank).toBe(7);
    const got = one.banks[0]!.parameters as Tof;
    expect([got.difC, got.difA, got.zero, got.gamX, got.gamY]).toEqual([i.difC, i.difA, i.zero, i.gamX, i.gamY]);
    expect([...one.banks[0]!.texts.keys()].sort()).toEqual(["2-theta", "Azimuth", "Bank", "X", "Y", "Z", "Type", "Zero", "alpha", "beta-0", "beta-1", "beta-q", "difA", "difB", "difC", "fltPath", "sig-0", "sig-1", "sig-2", "sig-q"].sort());
  });

  // Validation (c): GSAS-II's own reader (scripts/gsas2-read-instprm.py) on this very file. Regenerate
  // with MATERIA_WRITE_FIXTURES=1, then: python scripts/gsas2-read-instprm.py <fixture> <fixture>.gsas2.json
  it("is read by GSAS-II's reader with the same values, bank by bank", () => {
    const fixture = fileURLToPath(new URL("../../testSupport/calibratedInstprm.fixture.instprm", import.meta.url));
    if (process.env.MATERIA_WRITE_FIXTURES) writeFileSync(fixture, text);
    expect(readFileSync(fixture, "utf8")).toBe(text);
    const gsas2 = JSON.parse(readFileSync(`${fixture}.gsas2.json`, "utf8")) as { errors: Record<string, string>; banks: Record<string, Record<string, number>> };
    expect(gsas2.errors).toEqual({});
    expect(Object.keys(gsas2.banks).sort()).toEqual(["1", "2", "3", "4", "5"]);
    for (const m of moved) {
      const g = gsas2.banks[String(m.bank)]!;
      const i = m.instrument;
      expect([g.difC, g.difA, g.Zero, g.alpha, g["beta-0"], g["beta-1"], g["sig-0"], g["sig-1"], g["sig-2"], g.X, g.Y])
        .toEqual([i.difC, i.difA, i.zero, i.alpha, i.beta0, i.beta1, i.sig0, i.sig1, i.sig2, i.gamX, i.gamY]);
      expect(g.Bank).toBe(m.bank);
    }
  });

  it("refuses a bank number given twice", () => {
    expect(() => calibratedInstprm([moved[0]!, moved[0]!], PROV)).toThrow(/bank 1 twice/);
  });
});

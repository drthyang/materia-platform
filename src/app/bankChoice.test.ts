/**
 * One bank at a time (app/bankChoice.ts): the Data card's and the Instrument
 * card's bank choosers, the pairing of the two, the note on what a file has
 * that the calculation leaves out, and the bank kept with the file through
 * the page and the project. Synthetic files only.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseCif } from "@/parsers/cif";
import { parseGsasHistogram, parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { instrumentBank, parseInstrumentFile } from "@/parsers/instrument";
import {
  bankAdvice, currentDataBank, currentInstrumentBank, dataBankOptions, dataBankRef, dataBanksOf, defaultDataBank,
  instrumentBankOptions, instrumentFileOf, matchingInstrumentBank, openingInstrumentBank, unusedNote,
} from "@/app/bankChoice";
import { emptyPage, withInstrument, withPattern, withStructure } from "@/app/powderPage";
import { powderWorkspaceFrom, sessionFromPowderWorkspace } from "@/app/projectIo";
import { validateSnapshot } from "@/core/project/validate";
import { FIVE_BANK_INSTPRM, SEMICOLON_CW_INSTPRM, SINGLE_BANK_INSTPRM, SIX_BANK_GSA, multiBankGsa } from "@/testSupport/instprmFixtures";

const T = 20_000;
const five = parseInstrumentFile(FIVE_BANK_INSTPRM);
const bankOf = (n: number) => instrumentBank(five, n)!;

describe("a multi-bank GSAS histogram: the Data card's banks", () => {
  it("reads every bank with its comment-line geometry, whatever the line ends", () => {
    const hist = parseGsasHistogram(SIX_BANK_GSA);
    expect(SIX_BANK_GSA).toMatch(/\r\n/);
    expect(SIX_BANK_GSA).toMatch(/[^\r]\n/);
    expect(hist.banks.map((b) => b.bankNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hist.banks.map((b) => b.points.length)).toEqual([40, 50, 60, 70, 80, 90]);
    expect(hist.banks.map((b) => b.meta?.difC)).toEqual([1490.5, 2861.25, 5606.5, 8625.75, 1399.25, 836.25]);
    expect(hist.banks[0]!.meta).toEqual({ flightPath: 20.1, twoTheta: 15, difC: 1490.5 });
    expect(hist.banks[5]!.meta).toEqual({ flightPath: 20.6, twoTheta: 8.5, difC: 836.25 });
  }, T);

  it("a file without the comment lines has no metadata and reads as before", () => {
    const hist = parseGsasHistogram(multiBankGsa([{ bank: 2, difC: null }, { bank: 3, difC: null }]));
    expect(hist.banks.map((b) => b.meta)).toEqual([undefined, undefined]);
    expect(hist.banks.map((b) => b.points.length)).toEqual([40, 50]);
  }, T);

  it("offers the banks with points and range, and opens on bank 1", () => {
    const banks = dataBanksOf(SIX_BANK_GSA)!;
    const options = dataBankOptions(banks)!;
    expect(options.map((o) => o.bank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(options[2]!.label).toBe("Bank 3 · 60 points · TOF 800–1012 µs");
    expect(defaultDataBank(banks).bankNumber).toBe(1);
    // No bank 1: the file's first bank.
    expect(defaultDataBank(dataBanksOf(multiBankGsa([{ bank: 4, difC: null }, { bank: 2, difC: null }]))!).bankNumber).toBe(4);
    // The bank kept with the file is the current one; a file kept without one is on the reader's first bank.
    expect(currentDataBank(banks, { name: "d.gsa", text: SIX_BANK_GSA, bank: 4 })!.bankNumber).toBe(4);
    expect(currentDataBank(banks, { name: "d.gsa", text: SIX_BANK_GSA })!.bankNumber).toBe(1);
  }, T);

  it("has no chooser for one bank, or for data that are not a GSAS histogram", () => {
    expect(dataBankOptions(dataBanksOf(multiBankGsa([{ bank: 1, difC: null }])))).toBeNull();
    expect(dataBanksOf("1.0 10 1\n2.0 12 1\n3.0 11 1\n")).toBeNull();
    expect(dataBanksOf(undefined)).toBeNull();
  }, T);

  it("the reader takes the bank asked for", () => {
    const p3 = parseGsasHistogramPattern(SIX_BANK_GSA, "d", "d.gsa", { bank: 3 });
    expect(p3.points).toHaveLength(60);
    expect(parseGsasHistogramPattern(SIX_BANK_GSA, "d", "d.gsa").points).toHaveLength(40);
  }, T);
});

describe("a multi-bank .instprm: the Instrument card's banks", () => {
  it("offers each bank with its angle and difC", () => {
    const options = instrumentBankOptions(five)!;
    expect(options.map((o) => o.label)).toEqual([
      "Bank 1 · 2θ 154° · difC 1500",
      "Bank 2 · 2θ 31° · difC 2851",
      "Bank 3 · 2θ 65° · difC 5613",
      "Bank 4 · 2θ 120.5° · difC 8651",
      "Bank 5 · 2θ 15° · difC 1402",
    ]);
    expect(instrumentBankOptions(instrumentFileOf(SINGLE_BANK_INSTPRM))).toBeNull();
    expect(instrumentBankOptions(instrumentFileOf("not an instrument file"))).toBeNull();
  }, T);

  it("opens on the data's bank when the file has it, else on the lowest bank", () => {
    expect(openingInstrumentBank(five, null).bank).toBe(1);
    expect(openingInstrumentBank(five, { bank: 3 }).bank).toBe(3);
    expect(openingInstrumentBank(five, { bank: 6 }).bank).toBe(1);
  }, T);

  it("pairs by bank number and checks the pairing against the data's own DIFC", () => {
    // Same number, difC within 3 %.
    expect(matchingInstrumentBank(five, { bank: 3, difC: 5606.5 })!.bank).toBe(3);
    // Same number, but the difC is another bank's: the bank with that difC.
    expect(matchingInstrumentBank(five, { bank: 1, difC: 5606.5 })!.bank).toBe(3);
    // A data bank the file does not cover.
    expect(matchingInstrumentBank(five, { bank: 6, difC: 836.25 })).toBeNull();
    // Data that state no DIFC: the number alone.
    expect(matchingInstrumentBank(five, { bank: 6 })).toBeNull();
    expect(matchingInstrumentBank(five, { bank: 2 })!.bank).toBe(2);
  }, T);

  it("finds the bank of a file kept without one from the instrument's calibration", () => {
    // A project saved before the bank was recorded took the last bank.
    expect(currentInstrumentBank(five, { name: "i", text: FIVE_BANK_INSTPRM }, bankOf(5).parameters)!.bank).toBe(5);
    expect(currentInstrumentBank(five, { name: "i", text: FIVE_BANK_INSTPRM, bank: 2 }, bankOf(2).parameters)!.bank).toBe(2);
  }, T);
});

describe("the instrument is not the data bank's: said, offered, never switched", () => {
  it("says nothing when the two belong together, or the data name no bank", () => {
    expect(bankAdvice(five, bankOf(3), { bank: 3, difC: 5606.5 })).toBeNull();
    expect(bankAdvice(five, bankOf(3), { bank: 3 })).toBeNull();
    expect(bankAdvice(five, bankOf(5), null)).toBeNull();
  }, T);

  it("names both banks and offers the data's (the old reader's case: data bank 1, instrument bank 5)", () => {
    const advice = bankAdvice(five, bankOf(5), { bank: 1, difC: 1490.5 })!;
    expect(advice.line).toBe("Data are bank 1; the instrument is bank 5.");
    expect(advice.offer).toEqual({ bank: 1, label: "Use bank 1" });
    // 1401.5 against 1490.5: 6.0 % off, stated.
    expect(advice.detail).toContain("6.0 % from the data's DIFC 1490.5");
  }, T);

  it("offers the bank with the data's DIFC when the same-numbered bank has another difC", () => {
    const advice = bankAdvice(five, bankOf(1), { bank: 1, difC: 5606.5 })!;
    expect(advice.offer).toEqual({ bank: 3, label: "Use bank 3" });
  }, T);

  it("says plainly that a data bank has no instrument bank, and offers none", () => {
    const advice = bankAdvice(five, bankOf(1), { bank: 6, difC: 836.25 })!;
    expect(advice.line).toBe("No instrument bank for data bank 6: bank 1 is not its calibration.");
    expect(advice.offer).toBeUndefined();
    expect(advice.detail).toContain("banks 1, 2, 3, 4, 5");
    const noDifC = bankAdvice(five, bankOf(1), { bank: 6 })!;
    expect(noDifC.offer).toBeUndefined();
    expect(noDifC.detail).toContain("no bank 6");
  }, T);

  it("a one-bank instrument file: checked only against a DIFC the data state", () => {
    const one = parseInstrumentFile(SINGLE_BANK_INSTPRM);
    const bank = one.banks[0]!;
    // The file says Bank 2; data bank 1 with no DIFC: nothing to check, no line.
    expect(bankAdvice(one, bank, { bank: 1 })).toBeNull();
    expect(bankAdvice(one, bank, { bank: 1, difC: 22450 })).toBeNull();
    expect(bankAdvice(one, bank, { bank: 1, difC: 5606.5 })!.line).toBe("No instrument bank for data bank 1: bank 2 is not its calibration.");
  }, T);
});

describe("what the file has that the calculation leaves out", () => {
  it("TOF: the non-zero Lorentzian terms and sig-1, with what stands in for it", () => {
    const note = unusedNote(bankOf(1), undefined)!;
    expect(note.line).toBe("Not used: Lorentzian X, Y; sig-1.");
    expect(note.detail).toContain("X = -0.875, Y = 0.375");
    expect(note.detail).toContain("sig-1 = 260.75 is left out while the microstrain model is isotropic");
    expect(note.detail).toContain("1500 × 10⁻⁶");
    expect(unusedNote(bankOf(4), "isotropic")!.line).toBe("Not used: Lorentzian X, Z; sig-1.");
    // No Lorentzian in the file: sig-1 alone.
    expect(unusedNote(bankOf(3), "uniaxial")!.line).toBe("Not used: sig-1.");
  }, T);

  it("TOF: sig-1 is a row under the generalized microstrain model, so it is not named", () => {
    expect(unusedNote(bankOf(1), "generalized")!.line).toBe("Not used: Lorentzian X, Y.");
    expect(unusedNote(bankOf(3), "generalized")).toBeNull();
  }, T);

  it("constant wavelength: Z alone, when it is not zero", () => {
    expect(unusedNote(parseInstrumentFile(SEMICOLON_CW_INSTPRM).banks[0]!, undefined)!.line).toBe("Not used: Lorentzian Z.");
    expect(unusedNote(parseInstrumentFile(SEMICOLON_CW_INSTPRM.replace("Z:0.25", "Z:0.0")).banks[0]!, undefined)).toBeNull();
    expect(unusedNote(null, undefined)).toBeNull();
  }, T);

  it("states what the page really does with sig-1 on load", () => {
    const structure = parseCif(readFileSync("examples/mcp/mno.cif", "utf8"));
    const pattern = parseGsasHistogramPattern(SIX_BANK_GSA, "d", "d.gsa", { bank: 1, radiation: { kind: "neutron-tof" } });
    const page = withInstrument(withPattern(withStructure(emptyPage(), structure), pattern, { name: "d.gsa", text: SIX_BANK_GSA, bank: 1 }), bankOf(1).parameters, { name: "i.instprm", text: FIVE_BANK_INSTPRM, bank: 1 });
    const row = (id: string) => page.session.powderParams.find((p) => p.id === id);
    // Isotropic model (the default): no sig-1 row, a fixed 1500 × 10⁻⁶ microstrain in its place.
    expect(row("tof_sig1")).toBeUndefined();
    expect(row("mustrainIso")).toMatchObject({ value: 1500, fixed: true });
    // The other terms as read, the negative sig-0 included, held fixed.
    expect(row("tof_sig0")).toMatchObject({ value: -50.5, fixed: true });
    expect(row("tof_sig2")).toMatchObject({ value: 40.125, fixed: true });
    expect(row("tof_sigQ")).toMatchObject({ value: 0, fixed: true });
    expect(row("tof_alpha1")).toMatchObject({ value: 0.25, fixed: true });
    expect(row("tof_beta0")).toMatchObject({ value: 0.125, fixed: true });
    expect(row("tof_beta1")).toMatchObject({ value: 0.02, fixed: true });
    expect(row("tof_betaQ")).toMatchObject({ value: 0, fixed: true });
    expect(row("tof_difC")).toMatchObject({ value: 1500.25, fixed: true });
    expect(row("zero")).toMatchObject({ value: -7.5, fixed: true });
  }, T);
});

describe("the bank is kept with the file: page, History snapshot, project", () => {
  const structure = parseCif(readFileSync("examples/mcp/mno.cif", "utf8"));
  const pattern = parseGsasHistogramPattern(SIX_BANK_GSA, "d", "d.gsa", { bank: 3, radiation: { kind: "neutron-tof" } });
  const page = withInstrument(
    withPattern(withStructure(emptyPage(), structure), pattern, { name: "d.gsa", text: SIX_BANK_GSA, bank: 3 }),
    bankOf(3).parameters,
    { name: "i.instprm", text: FIVE_BANK_INSTPRM, bank: 3 },
  );

  it("the page keeps both banks", () => {
    expect(page.session.rawData).toEqual({ name: "d.gsa", text: SIX_BANK_GSA, bank: 3 });
    expect(page.session.rawInstrument).toEqual({ name: "i.instprm", text: FIVE_BANK_INSTPRM, bank: 3 });
    // A one-bank file is kept as before, with no bank field.
    const plain = withInstrument(page, parseInstrumentFile(SINGLE_BANK_INSTPRM).banks[0]!.parameters, { name: "one.instprm", text: SINGLE_BANK_INSTPRM });
    expect(plain.session.rawInstrument).toEqual({ name: "one.instprm", text: SINGLE_BANK_INSTPRM });
  }, T);

  it("a saved project gives both banks back, and a project without the field opens unchanged", () => {
    const ws = powderWorkspaceFrom(page.session, null, page.instrument, true, { fitRange: null, displayUnit: null, manualPeakD: [] });
    expect(ws.rawData?.bank).toBe(3);
    expect(ws.rawInstrument?.bank).toBe(3);
    const json = JSON.parse(JSON.stringify(ws)) as typeof ws;
    const back = sessionFromPowderWorkspace(json, [structure]);
    expect(back.session.rawData?.bank).toBe(3);
    expect(back.session.rawInstrument?.bank).toBe(3);
    expect(back.instrument).toEqual(bankOf(3).parameters);
    expect(currentInstrumentBank(instrumentFileOf(back.session.rawInstrument!.text), back.session.rawInstrument, back.instrument)!.bank).toBe(3);
    // The same workspace as an older build wrote it: no bank on either file.
    const { bank: _b1, ...oldInstrument } = json.rawInstrument!;
    const { bank: _b2, ...oldData } = json.rawData!;
    const old = sessionFromPowderWorkspace({ ...json, rawInstrument: oldInstrument, rawData: oldData }, [structure]);
    expect(old.session.rawInstrument).toEqual({ name: "i.instprm", text: FIVE_BANK_INSTPRM });
    expect(old.session.rawData).toEqual({ name: "d.gsa", text: SIX_BANK_GSA });
    expect(old.session.powderParams).toEqual(back.session.powderParams);
  }, T);

  it("the project validator takes the field, and refuses one that is not a number", () => {
    const ws = JSON.parse(JSON.stringify(powderWorkspaceFrom(page.session, null, page.instrument, true, { fitRange: null, displayUnit: null, manualPeakD: [] }))) as Record<string, unknown>;
    const structures = JSON.parse(JSON.stringify([structure])) as unknown;
    expect(() => validateSnapshot(structures, ws, "project")).not.toThrow();
    expect(() => validateSnapshot(structures, { ...ws, rawInstrument: { name: "i", text: "t", bank: "3" } }, "project")).toThrow(/rawInstrument\.bank/);
    expect(() => validateSnapshot(structures, { ...ws, rawData: { name: "d", text: "t" } }, "project")).not.toThrow();
  }, T);
});

/**
 * A real multi-bank data file with its multi-bank instrument file, when both
 * are at hand (never in the repository):
 *   MATERIA_GSA_FILE      the GSAS histogram
 *   MATERIA_INSTPRM_FILE  the .instprm
 * Each data bank must pair with the instrument bank of its own number, the
 * pairing must hold against the data's own DIFC, and a data bank the
 * instrument file does not cover must have none.
 */
const LOCAL_GSA = process.env.MATERIA_GSA_FILE;
const LOCAL_INSTPRM = process.env.MATERIA_INSTPRM_FILE;

describe.skipIf(!LOCAL_GSA || !LOCAL_INSTPRM || !existsSync(LOCAL_GSA) || !existsSync(LOCAL_INSTPRM))("a local multi-bank data + instrument pair (opt-in)", () => {
  it("pairs every data bank with its instrument bank, and leaves an uncovered bank without one", () => {
    const text = readFileSync(LOCAL_GSA!, "utf8");
    const banks = dataBanksOf(text)!;
    const file = parseInstrumentFile(readFileSync(LOCAL_INSTPRM!, "utf8"));
    const numbers = new Set(file.banks.map((b) => b.bank));
    expect(defaultDataBank(banks).bankNumber).toBe(1);
    const lines: string[] = [];
    for (const b of banks) {
      const ref = dataBankRef(b)!;
      expect(ref.difC, `data bank ${b.bankNumber} DIFC`).toBeGreaterThan(0);
      const match = matchingInstrumentBank(file, ref);
      if (numbers.has(b.bankNumber)) {
        expect(match?.bank, `data bank ${b.bankNumber}`).toBe(b.bankNumber);
        expect(openingInstrumentBank(file, ref).bank).toBe(b.bankNumber);
        expect(bankAdvice(file, match, ref)).toBeNull();
        const difC = (match!.parameters as { difC: number }).difC;
        lines.push(`data bank ${b.bankNumber} (${b.points.length} points) -> instrument bank ${match!.bank}, difC ${(100 * Math.abs(difC - ref.difC!) / ref.difC!).toFixed(2)} % from the data's DIFC`);
      } else {
        expect(match, `data bank ${b.bankNumber}`).toBeNull();
        const advice = bankAdvice(file, openingInstrumentBank(file, ref), ref)!;
        expect(advice.offer).toBeUndefined();
        lines.push(`data bank ${b.bankNumber} (${b.points.length} points) -> no instrument bank: "${advice.line}"`);
      }
    }
    // What the page did before: data bank 1 with the file's last instrument bank.
    const last = file.banks[file.banks.length - 1]!;
    const before = bankAdvice(file, last, dataBankRef(banks[0]!))!;
    expect(before.offer?.bank).toBe(1);
    lines.push(`old pairing (data bank 1, instrument bank ${last.bank}): "${before.line}" offers "${before.offer!.label}"`);
    console.log(lines.join("\n"));
  }, T);
});

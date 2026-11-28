/**
 * Refinement values kept across a data-bank switch (app/bankKeep.ts): another
 * bank of the same data file, by the Data card's chooser or the same file
 * loaded again, keeps every refinement row's value (bit for bit) and its free,
 * fixed or tied state, the scale and the background's type, terms and
 * coefficients included; the instrument's rows take the new bank's file
 * values (app/bankFollow.ts), the Lorentzian X, Y, Z of the file with them
 * (time of flight: `tofFileProfile` rows; constant wavelength: the size and
 * mustrain rows, `profileX` and `profileY`) while the sample's own size and
 * microstrain rows are kept; one History step, which undo takes back whole;
 * a data bank the instrument file has no bank for keeps the values and Refine
 * stays held. Nothing is refined. Synthetic data; the instrument file is the
 * bundled NOMAD 2023A default, or a made-up file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCif } from "@/parsers/cif";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { parseInstrumentFile } from "@/parsers/instrument";
import { DEFAULT_INSTRUMENTS } from "@/app/defaultInstruments";
import { withBackgroundTerms, withBackgroundType, withInstrumentFile, withMustrain, withParameterTies, withPattern, withStructure, emptyPage, type PowderPage } from "@/app/powderPage";
import { bankCoverage, loadFollowStepLabel, switchedRows } from "@/app/bankFollow";
import { dataBankSwitch, followsInstrument, keptNote, keptStepLabel, landData, storedBankWindow, withRefinementKept } from "@/app/bankKeep";
import { projectFileFor } from "@/app/projectIo";
import { parseProject, serializeProject } from "@/core/project/io";
import { powderWorkspaceFrom, sessionFromPowderWorkspace } from "@/app/projectIo";
import { snapProjectStructures } from "@/app/snapOnOpen";
import { lineage, recordStep, restoreStep, undoTarget } from "@/core/project/history";
import type { PowderWorkspace } from "@/core/project/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { RefinementParameter } from "@/core/refinement/types";
import { FIVE_BANKS, NOMAD_STYLE_GSA, SIX_BANK_GSA, multiBankGsa, multiBankInstprm, type BankText } from "@/testSupport/instprmFixtures";

const T = 30_000;
const NOMAD = DEFAULT_INSTRUMENTS.find((d) => d.instrument === "NOMAD")!;
const TEXT = readFileSync("examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm", "utf8");
const structure = parseCif(readFileSync("examples/mcp/mno.cif", "utf8"));
const NAME = "made_up.gsa";

const patternOf = (bank: number, text = NOMAD_STYLE_GSA) => parseGsasHistogramPattern(text, "d", NAME, { bank, radiation: { kind: "neutron-tof" } });
const dataPage = (bank: number, text = NOMAD_STYLE_GSA): PowderPage => withPattern(withStructure(emptyPage(), structure), patternOf(bank, text), { name: NAME, text, bank });
const withDefault = (bank: number): PowderPage => withInstrumentFile(dataPage(bank), NOMAD.fileName, TEXT, { bundledDefault: NOMAD.id }).page;
/** The page with another bank's data on it (App.applyPowder's withPattern), before it lands. */
const toDataBank = (p: PowderPage, bank: number, text = NOMAD_STYLE_GSA): PowderPage => withPattern(p, patternOf(bank, text), { name: NAME, text, bank });
const workspaceOf = (p: PowderPage): PowderWorkspace => powderWorkspaceFrom(p.session, p.result, p.instrument, p.instrumentLoaded, { fitRange: null, displayUnit: null, manualPeakD: [] });
const row = (p: PowderPage, id: string) => p.session.powderParams.find((r) => r.id === id);
/** The rows kept on a switch to `instrument` (the page's own, unless the new bank's is given). */
const carried = (p: PowderPage, instrument: InstrumentParameters = p.instrument): readonly RefinementParameter[] => p.session.powderParams.filter((r) => !followsInstrument(r, instrument));
const instrumentRows = (p: PowderPage): readonly RefinementParameter[] => p.session.powderParams.filter((r) => followsInstrument(r, p.instrument));

/**
 * A page as a user leaves it after refining: a cosine background of six
 * terms, every row at a value no file or estimate gives, some rows freed and
 * some fixed, B_O1 tied to B_Mn1.
 */
const refinedOn = (bank: number): PowderPage => refined(withDefault(bank));
function refined(p: PowderPage): PowderPage {
  let s = withBackgroundType(p.session, "cosine");
  s = withBackgroundTerms(s, 6, p.instrument);
  s = withParameterTies(s, { equal: ["B_Mn1", "B_O1"] });
  let k = 0;
  s = {
    ...s,
    powderParams: s.powderParams.map((r) => {
      k++;
      if (r.expression) return r;
      return { ...r, value: r.value * (1 + k * 0.0123456789) + k * 0.000317, fixed: followsInstrument(r, p.instrument) ? r.fixed : k % 3 === 0 };
    }),
  };
  return { ...p, session: s };
}

/** Every carried row of `after` (the rows its instrument does not own) is `before`'s, bit for bit, in value, free state and tie. */
function expectKept(before: PowderPage, after: PowderPage): void {
  const was = carried(before, after.instrument);
  const now = carried(after);
  expect(now.map((r) => r.id)).toEqual(was.map((r) => r.id));
  for (const r of was) {
    const n = now.find((x) => x.id === r.id)!;
    expect(n.value, r.id).toBe(r.value);
    expect(n.fixed, r.id).toBe(r.fixed);
    expect(n.expression, r.id).toBe(r.expression);
    expect(n.group, r.id).toBe(r.group);
  }
  expect(after.session.powderProfile.backgroundType).toBe("cosine");
  expect(after.session.backgroundTerms).toBe(6);
  expect(row(after, "B_O1")!.expression).toBe("= B_Mn1");
  // Never refined: no fit result on the page.
  expect(after.result).toBeNull();
}

describe("refinement values kept across a data-bank switch", () => {
  it("the chooser: bank 4 → 3 keeps every refinement row, and the instrument rows take bank 3's file values", () => {
    const before = refinedOn(4);
    const l = landData(before, toDataBank(before, 3), `Loaded data ${NAME}, bank 3`, "chooser");
    expect(l.kept).toEqual({ from: 4, to: 3 });
    expect(l.follow!.bank).toBe(3);
    expect(l.label).toBe("Data bank 4 → 3, refinement values kept");
    expect(keptNote(l.kept!)).toBe("Refinement values kept from bank 4.");
    expectKept(before, l.page);
    expect(l.page.session.rawData!.bank).toBe(3);
    expect(l.page.session.pattern).toEqual(patternOf(3));
    // The instrument follows: bank 3 of the file, its rows at the file's values, as the default clicked on bank 3 gives them.
    expect(l.page.instrument).toEqual(parseInstrumentFile(TEXT).banks.find((b) => b.bank === 3)!.parameters);
    expect(l.page.session.rawInstrument).toEqual({ name: NOMAD.fileName, text: TEXT, bank: 3, bundledDefault: NOMAD.id });
    const fresh = instrumentRows(withDefault(3));
    expect(instrumentRows(l.page).map((r) => r.id)).toEqual(fresh.map((r) => r.id));
    for (const r of fresh) {
      expect(row(l.page, r.id)!.value, r.id).toBe(r.value);
      expect(row(l.page, r.id)!.fixed, r.id).toBe(r.fixed);
    }
    expect(row(l.page, "zero")!.value).not.toBe(row(before, "zero")!.value);
  }, T);

  it("the instrument rows are the ones #179's switch marks (Instrument / profile), and every other row is kept", () => {
    const before = refinedOn(2);
    const ids = before.session.powderParams.map((r) => `${r.id}:${followsInstrument(r, before.instrument) ? "instrument" : "kept"}`);
    expect(ids).toContain("zero:instrument");
    expect(ids).toContain("tof_difC:instrument");
    expect(ids).toContain("tof_sig1:instrument");
    expect(ids).toContain("scale:kept");
    expect(ids).toContain("bkg0:kept");
    expect(ids).toContain("cell_a:kept");
    expect(ids).toContain("tofSampleGauss:kept");
    expect(ids).toContain("B_Mn1:kept");
  });

  it("a fresh load of the same file (opening on bank 1) keeps the values too; another file or the same bank does not", () => {
    const before = refinedOn(4);
    const l = landData(before, toDataBank(before, 1), `Loaded data ${NAME}, bank 1`, "load");
    expect(l.kept).toEqual({ from: 4, to: 1 });
    expect(l.label).toBe("Data bank 4 → 1, refinement values kept");
    expectKept(before, l.page);
    expect(l.page.session.rawInstrument!.bank).toBe(1);
    // Another file: a new dataset, its scale and background start afresh (the load's own step).
    const other = multiBankGsa([1, 2, 3, 4, 5].map((bank) => ({ bank, difC: [1450, 2860, 5600, 9050, 9900][bank - 1]! })), ["# Instrument: NOMAD"]);
    const o = landData(before, withPattern(before, patternOf(1, other), { name: "next.gsa", text: other, bank: 1 }), "Loaded data next.gsa, bank 1", "load");
    expect(o.kept).toBeNull();
    expect(o.label).toBe(loadFollowStepLabel("Loaded data next.gsa, bank 1", 1));
    expect(o.page.session.powderProfile.backgroundType).not.toBe("cosine");
    expect(dataBankSwitch({ name: NAME, text: NOMAD_STYLE_GSA, bank: 4 }, { name: NAME, text: NOMAD_STYLE_GSA, bank: 4 })).toBeNull();
    expect(dataBankSwitch({ name: NAME, text: NOMAD_STYLE_GSA }, { name: NAME, text: NOMAD_STYLE_GSA })).toBeNull();
    expect(dataBankSwitch(undefined, { name: NAME, text: NOMAD_STYLE_GSA, bank: 2 })).toBeNull();
  }, T);

  it("is one History step: undo gives back the previous bank, its data, its instrument and every value", () => {
    const before = refinedOn(4);
    const l = landData(before, toDataBank(before, 3), `Loaded data ${NAME}, bank 3`, "chooser");
    let history = recordStep(null, { kind: "load", label: "Refined bank 4", structures: [structure], workspace: workspaceOf(before) });
    history = recordStep(history, { kind: "load", label: l.label, structures: [structure], workspace: workspaceOf(l.page) });
    expect(lineage(history).map((s) => s.label)).toEqual(["Refined bank 4", "Data bank 4 → 3, refinement values kept"]);
    // As App.goToStep restores a step: its structures read with the snap a project's open applies (snapOnOpen.ts).
    const step = restoreStep(history, undoTarget(history)!);
    const snapped = snapProjectStructures(step.structures, step.workspace);
    expect(snapped.snapped).toEqual([]);
    const undone = sessionFromPowderWorkspace(step.workspace as PowderWorkspace, [...snapped.structures]);
    expect(undone.session.rawData!.bank).toBe(4);
    expect(undone.session.rawInstrument!.bank).toBe(4);
    expect(undone.session.pattern.points).toEqual(before.session.pattern.points);
    expect(undone.instrument).toEqual(before.instrument);
    expect(undone.session.powderProfile.backgroundType).toBe("cosine");
    expect(undone.session.backgroundTerms).toBe(6);
    expect(undone.session.powderParams).toEqual(before.session.powderParams);
    for (const r of before.session.powderParams) expect(undone.session.powderParams.find((x) => x.id === r.id)!.value, r.id).toBe(r.value);
  }, T);

  it("bank 6, which the 2023A file does not cover: the values are kept, the instrument stays, and Refine is held", () => {
    const before = refinedOn(4);
    const l = landData(before, toDataBank(before, 6), `Loaded data ${NAME}, bank 6`, "chooser");
    expect(l.follow).toBeNull();
    expect(l.kept).toEqual({ from: 4, to: 6 });
    expect(l.label).toBe("Data bank 4 → 6, refinement values kept");
    expectKept(before, l.page);
    // The instrument held is bank 4's, its rows at bank 4's file values.
    expect(l.page.session.rawInstrument!.bank).toBe(4);
    expect(l.page.instrument).toEqual(before.instrument);
    for (const r of instrumentRows(withDefault(4))) expect(row(l.page, r.id)!.value, r.id).toBe(r.value);
    const c = bankCoverage(l.page.session, l.page.instrument, l.page.instrumentLoaded)!;
    expect(c.uncovered.dataBank).toBe(6);
    expect(c.startingPoint).toBe(false);
  }, T);

  it("view-only rows (TOF data with no instrument) are not kept, and the page says nothing of it", () => {
    const before = dataPage(4);
    const after = toDataBank(before, 3);
    expect(withRefinementKept(before, after)).toBe(after);
    const l = landData(before, after, `Loaded data ${NAME}, bank 3`, "chooser");
    expect(l.kept).toBeNull();
    expect(l.label).toBe(`Loaded data ${NAME}, bank 3`);
  });

  it("names the step and the card's line", () => {
    expect(keptStepLabel({ from: 4, to: 3 })).toBe("Data bank 4 → 3, refinement values kept");
    expect(keptNote({ from: 4, to: 3 })).toBe("Refinement values kept from bank 4.");
    expect(keptStepLabel({ from: 4, to: 5 }, true)).toBe("Data bank 4 → 5, refinement values kept, bank 5's fit window");
    expect(keptNote({ from: 4, to: 5 }, true)).toBe("Refinement values kept from bank 4; fit window set to bank 5's.");
  });
});

describe("fit windows stored per bank with the data file", () => {
  const WINDOWS = { "4": { min: 3000, max: 16000 }, "5": { min: 4000, max: 15300 } };
  /** The refined bank-4 page with the file's windows (as the NOMAD example carries them). */
  const windowed = (): PowderPage => {
    const p = refinedOn(4);
    return { ...p, session: { ...p.session, rawData: { ...p.session.rawData!, bankWindows: WINDOWS } } };
  };
  const workspaceAt = (p: PowderPage, fitRange: { min: number; max: number } | null): PowderWorkspace =>
    powderWorkspaceFrom(p.session, p.result, p.instrument, p.instrumentLoaded, { fitRange, displayUnit: null, manualPeakD: [] });

  it("4 → 5 → 4 gives each bank's window exactly, keeps every value, and Undo restores the window and the bank", () => {
    const at4 = windowed();
    const to5 = landData(at4, toDataBank(at4, 5), `Loaded data ${NAME}, bank 5`, "chooser");
    expect(to5.window).toEqual({ min: 4000, max: 15300 });
    expect(to5.label).toBe("Data bank 4 → 5, refinement values kept, bank 5's fit window");
    expect(to5.page.session.rawData!.bankWindows).toEqual(WINDOWS);
    expectKept(at4, to5.page);
    const back = landData(to5.page, toDataBank(to5.page, 4), `Loaded data ${NAME}, bank 4`, "chooser");
    expect(back.window).toEqual({ min: 3000, max: 16000 });
    expect(back.page.session.rawData!.bank).toBe(4);
    expectKept(at4, back.page);
    // The steps as App records them: each with the window the page then shows.
    let history = recordStep(null, { kind: "load", label: "Refined bank 4", structures: [structure], workspace: workspaceAt(at4, WINDOWS["4"]) });
    history = recordStep(history, { kind: "load", label: to5.label, structures: [structure], workspace: workspaceAt(to5.page, to5.window) });
    const undone = sessionFromPowderWorkspace(restoreStep(history, undoTarget(history)!).workspace as PowderWorkspace, [structure]);
    expect(undone.view.fitRange).toEqual({ min: 3000, max: 16000 });
    expect(undone.session.rawData!.bank).toBe(4);
    expect(undone.session.powderParams).toEqual(at4.session.powderParams);
  }, T);

  it("a bank with no stored window gets the whole data, as before, and keeps the file's windows for later", () => {
    const at4 = windowed();
    const to3 = landData(at4, toDataBank(at4, 3), `Loaded data ${NAME}, bank 3`, "chooser");
    expect(to3.window).toBeNull();
    expect(to3.label).toBe("Data bank 4 → 3, refinement values kept");
    expect(to3.page.session.rawData!.bankWindows).toEqual(WINDOWS);
    expect(storedBankWindow(to3.page.session.rawData, 5)).toEqual({ min: 4000, max: 15300 });
  }, T);

  it("another file drops the windows; a file without them switches as before", () => {
    const at4 = windowed();
    const other = multiBankGsaOther();
    const l = landData(at4, toDataBank(at4, 5, other), `Loaded data ${NAME}, bank 5`, "load");
    expect(l.window).toBeNull();
    expect(l.page.session.rawData!.bankWindows).toBeUndefined();
    const plain = refinedOn(4);
    const p = landData(plain, toDataBank(plain, 5), `Loaded data ${NAME}, bank 5`, "chooser");
    expect(p.window).toBeNull();
    expect(p.page.session.rawData!.bankWindows).toBeUndefined();
  }, T);

  it("is saved inside the data file's record and read back; a project without it opens unchanged", () => {
    const at4 = windowed();
    const save = (p: PowderPage) => serializeProject(projectFileFor({ structures: [structure], workspace: workspaceAt(p, WINDOWS["4"]), title: "t", step: 0 }));
    const back = parseProject(save(at4));
    expect((back.workspace as PowderWorkspace).rawData!.bankWindows).toEqual(WINDOWS);
    expect(sessionFromPowderWorkspace(back.workspace as PowderWorkspace, back.structures).session.rawData!.bankWindows).toEqual(WINDOWS);
    // Without the map: the file has no such key and reads back as it was written.
    const plain = refinedOn(4);
    const text = save(plain);
    expect(text).not.toContain("bankWindows");
    const reread = parseProject(text);
    expect(reread).toEqual(parseProject(text));
    expect((reread.workspace as PowderWorkspace).rawData).toEqual(plain.session.rawData);
    // A malformed map is refused with its path.
    const bad = text.replace(`"bank": 4`, `"bank": 4, "bankWindows": { "x": { "min": 1, "max": 2 } }`);
    expect(bad).not.toBe(text);
    expect(() => parseProject(bad)).toThrow(/bankWindows/);
  }, T);
});

/** The made-up six-bank file with other counts: another file of the same banks. */
function multiBankGsaOther(): string {
  return NOMAD_STYLE_GSA.replace("# File generated by a made-up reduction:", "# File generated by another made-up reduction:");
}

// ── the Lorentzian X, Y, Z follow the bank's instrument file (owner, 2026-11-28) ──

/** Bank 3 of the NOMAD 2023A file, as the file writes it. */
const NOMAD_BANK3 = { X: 11.09530822035512, Y: 4.167422848299058, Z: 0 };

const CW_NAME = "made_up_cw.gsa";
/**
 * A made-up constant-wavelength histogram of three banks (CONST, 20°–80° in
 * 0.05° steps, λ 1.54 Å): a flat level with a bump at each of MnO's first
 * reflections, a little wider on each later bank.
 */
const CW_GSA = (() => {
  const out = ["made-up constant-wavelength banks  Wavelength: 1.54 A"];
  for (const bank of [1, 2, 3]) {
    const n = 1201;
    out.push(`BANK ${bank} ${n} ${n} CONST 2000 5 0 0 FXYE`);
    for (let j = 0; j < n; j++) {
      const x = 2000 + 5 * j;
      const y = 50 + 5 * bank + [3492, 4055, 5868, 7015, 7378].reduce((sum, c) => sum + 400 * Math.exp(-(((x - c) / (12 * bank)) ** 2)), 0);
      out.push(`${x} ${y.toFixed(3)} ${Math.sqrt(y).toFixed(3)}`);
    }
  }
  return out.join("\n") + "\n";
})();
const CW_COMMON: BankText = { Type: "PNC", Lam: "1.54", "Polariz.": "0.0", Azimuth: "0.0", "SH/L": "0.002" };
/** A made-up three-bank constant-wavelength instrument file: banks 1 and 2 give the Lorentzian X, Y (and a Z, which the profile leaves out); bank 3 gives none. */
const CW_BANKS: Readonly<Record<number, BankText>> = {
  1: { ...CW_COMMON, Bank: "1.0", Zero: "0.0125", U: "30.5", V: "-12.25", W: "8.75", X: "0.21", Y: "1.3", Z: "0.0" },
  2: { ...CW_COMMON, Bank: "2.0", Zero: "-0.0375", U: "95.5", V: "-40.5", W: "21.25", X: "0.47", Y: "3.9", Z: "0.05" },
  3: { ...CW_COMMON, Bank: "3.0", Zero: "0.0625", U: "140.25", V: "-66.5", W: "33.5" },
};
const CW_INSTPRM = multiBankInstprm(CW_BANKS, [1, 2, 3]);
const CW_INSTRUMENT = "made_up_cw.instprm";

const cwPatternOf = (bank: number) => parseGsasHistogramPattern(CW_GSA, "d", CW_NAME, { bank });
/** The constant-wavelength file's bank on the page, its instrument file loaded after it (it opens on the data's bank). */
const cwPage = (bank: number): PowderPage =>
  withInstrumentFile(withPattern(withStructure(emptyPage(), structure), cwPatternOf(bank), { name: CW_NAME, text: CW_GSA, bank }), CW_INSTRUMENT, CW_INSTPRM).page;
const toCwBank = (p: PowderPage, bank: number): PowderPage => withPattern(p, cwPatternOf(bank), { name: CW_NAME, text: CW_GSA, bank });

type ConstantWavelength = Extract<InstrumentParameters, { kind: "constantWavelength" }>;
/** The switched-row mark as App.followed asks for it: the rows the new bank's instrument owns, at another value than before. */
const marked = (before: PowderPage, after: PowderPage): readonly string[] =>
  switchedRows(before.session.powderParams, after.session.powderParams, (r) => followsInstrument(r, after.instrument));

describe("the Lorentzian X, Y, Z follow the bank's instrument file", () => {
  it("time of flight, 4 → 3: X, Y and Z are bank 3's file values exactly, and the sample's size and microstrain rows stay bit for bit", () => {
    const before = refinedOn(4);
    const l = landData(before, toDataBank(before, 3), `Loaded data ${NAME}, bank 3`, "chooser");
    // The numbers are the file's own, as bank 3's block writes them.
    const block = TEXT.split(/^#Bank /m).find((b) => b.startsWith("3:"))!;
    expect(block).toMatch(/^X:11\.09530822035512\r?$/m);
    expect(block).toMatch(/^Y:4\.167422848299058\r?$/m);
    expect(block).toMatch(/^Z:0\.0\r?$/m);
    expect(row(l.page, "tof_gamX")!.value).toBe(NOMAD_BANK3.X);
    expect(row(l.page, "tof_gamY")!.value).toBe(NOMAD_BANK3.Y);
    expect(row(l.page, "tof_gamZ")!.value).toBe(NOMAD_BANK3.Z);
    for (const id of ["tof_gamX", "tof_gamY", "tof_gamZ"]) {
      const r = row(l.page, id)!;
      expect(r.kind, id).toBe("tofFileProfile");
      expect(followsInstrument(r, l.page.instrument), id).toBe(true);
      // Reset goes to the file's value too, and the row was somewhere else on bank 4.
      expect(r.initialValue, id).toBe(r.value);
      expect(r.value, id).not.toBe(row(before, id)!.value);
    }
    // The sample's rows: the refined values, not the ones a fresh page on bank 3 starts at.
    const fresh = withDefault(3);
    for (const id of ["tofSampleGauss", "tofSampleLorentz", "tofSampleSize"]) {
      const r = row(l.page, id)!;
      expect(followsInstrument(r, l.page.instrument), id).toBe(false);
      expect(r.value, id).toBe(row(before, id)!.value);
      expect(r.fixed, id).toBe(row(before, id)!.fixed);
      expect(r.value, id).not.toBe(row(fresh, id)!.value);
    }
  }, T);

  it("constant wavelength, 1 → 2: the Lorentzian X and Y (the size and mustrain rows) are bank 2's file values exactly; the uniaxial microstrain rows and every other value stay bit for bit", () => {
    const start = cwPage(1);
    expect(start.session.rawInstrument!.bank).toBe(1);
    // The two rows: the file's X and Y, listed as the size and the microstrain; the profile has no constant term, so no Z row.
    expect(row(start, "profX")).toMatchObject({ kind: "profileX", label: "size (Lorentzian X)", value: 0.21, fixed: true });
    expect(row(start, "profY")).toMatchObject({ kind: "profileY", label: "mustrain (Lorentzian Y)", value: 1.3, fixed: true });
    expect(start.session.powderParams.filter((r) => /Lorentzian/.test(r.label)).map((r) => r.id)).toEqual(["profX", "profY"]);
    const before = refined({ ...start, session: withMustrain(start.session, "uniaxial", start.instrument) });
    expect(row(before, "profX")!.value).not.toBe(0.21);
    expect(row(before, "profY")!.value).not.toBe(1.3);
    const ids = before.session.powderParams.map((r) => `${r.id}:${followsInstrument(r, before.instrument) ? "instrument" : "kept"}`);
    for (const id of ["profU", "profV", "profW", "profX", "profY", "zero"]) expect(ids).toContain(`${id}:instrument`);
    for (const id of ["scale", "bkg0", "cell_a", "B_Mn1", "mustrainPerp", "mustrainPar"]) expect(ids).toContain(`${id}:kept`);

    const l = landData(before, toCwBank(before, 2), `Loaded data ${CW_NAME}, bank 2`, "chooser");
    expect(l.kept).toEqual({ from: 1, to: 2 });
    expect(l.follow!.bank).toBe(2);
    expect(l.label).toBe("Data bank 1 → 2, refinement values kept");
    expect(l.page.instrument).toEqual(parseInstrumentFile(CW_INSTPRM).banks.find((b) => b.bank === 2)!.parameters);
    // Bank 2's block writes X:0.47 and Y:3.9.
    expect(row(l.page, "profX")!.value).toBe(0.47);
    expect(row(l.page, "profY")!.value).toBe(3.9);
    expect(row(l.page, "profX")!.initialValue).toBe(0.47);
    expect(row(l.page, "profY")!.initialValue).toBe(3.9);
    // Every instrument row is the one a fresh page on bank 2 has, held as on load.
    const fresh = instrumentRows(cwPage(2));
    expect(fresh.map((r) => r.id)).toEqual(["profU", "profV", "profW", "profX", "profY", "zero"]);
    expect(instrumentRows(l.page).map((r) => r.id)).toEqual(fresh.map((r) => r.id));
    for (const r of fresh) {
      expect(row(l.page, r.id)!.value, r.id).toBe(r.value);
      expect(row(l.page, r.id)!.fixed, r.id).toBe(r.fixed);
    }
    // Every other row is bank 1's, the anisotropic microstrain rows among them.
    expectKept(before, l.page);
    expect(l.page.session.mustrain).toBe("uniaxial");
    for (const id of ["mustrainPerp", "mustrainPar"]) {
      expect(row(l.page, id)!.value, id).toBe(row(before, id)!.value);
      expect(row(l.page, id)!.fixed, id).toBe(row(before, id)!.fixed);
      expect(row(l.page, id)!.value, id).not.toBe(3.9);
    }
    // The rows marked as switched with the instrument are the ones that took the file's values, X and Y with them.
    const rows = marked(before, l.page);
    for (const id of ["profU", "profV", "profW", "profX", "profY", "zero"]) expect(rows).toContain(id);
    expect(rows.some((id) => id === "scale" || id.startsWith("bkg") || id.startsWith("mustrain"))).toBe(false);
    // Without the instrument, the mark is the Instrument / profile group alone, as before.
    expect(switchedRows(before.session.powderParams, l.page.session.powderParams)).toEqual(rows.filter((id) => id !== "profX" && id !== "profY"));
  }, T);

  it("Undo restores the old bank's X and Y (and X, Y, Z of a time-of-flight file) as they were refined", () => {
    const undo = (before: PowderPage, after: PowderPage, label: string) => {
      let history = recordStep(null, { kind: "load", label: "Refined", structures: [structure], workspace: workspaceOf(before) });
      history = recordStep(history, { kind: "load", label, structures: [structure], workspace: workspaceOf(after) });
      return sessionFromPowderWorkspace(restoreStep(history, undoTarget(history)!).workspace as PowderWorkspace, [structure]);
    };
    const cw = refined(cwPage(1));
    const l = landData(cw, toCwBank(cw, 2), `Loaded data ${CW_NAME}, bank 2`, "chooser");
    expect(row(l.page, "profX")!.value).toBe(0.47);
    const back = undo(cw, l.page, l.label);
    expect(back.session.rawData!.bank).toBe(1);
    expect(back.session.rawInstrument!.bank).toBe(1);
    expect(back.instrument).toEqual(cw.instrument);
    expect((back.instrument as ConstantWavelength).x).toBe(0.21);
    expect(back.session.powderParams).toEqual(cw.session.powderParams);
    for (const id of ["profX", "profY"]) {
      expect(back.session.powderParams.find((r) => r.id === id)!.value, id).toBe(row(cw, id)!.value);
      expect(back.session.powderParams.find((r) => r.id === id)!.fixed, id).toBe(row(cw, id)!.fixed);
    }
    const tof = refinedOn(4);
    const t = landData(tof, toDataBank(tof, 3), `Loaded data ${NAME}, bank 3`, "chooser");
    const tofBack = undo(tof, t.page, t.label);
    expect(tofBack.session.rawInstrument!.bank).toBe(4);
    for (const id of ["tof_gamX", "tof_gamY", "tof_gamZ"]) expect(tofBack.session.powderParams.find((r) => r.id === id)!.value, id).toBe(row(tof, id)!.value);
  }, T);

  it("a file without X, Y, Z is unaffected: a constant-wavelength bank that gives none keeps the refined X and Y; a time-of-flight file has no such rows and switches as before", () => {
    // Constant wavelength, 1 → 3: bank 3's block has U, V, W and no X, Y, so there is no file value to take.
    const before = refined(cwPage(1));
    const l = landData(before, toCwBank(before, 3), `Loaded data ${CW_NAME}, bank 3`, "chooser");
    expect(l.follow!.bank).toBe(3);
    expect(l.label).toBe("Data bank 1 → 3, refinement values kept");
    const held = l.page.instrument as ConstantWavelength;
    expect(held.x).toBeUndefined();
    expect(held.y).toBeUndefined();
    for (const id of ["profX", "profY"]) {
      const r = row(l.page, id)!;
      expect(followsInstrument(r, l.page.instrument), id).toBe(false);
      expect(r.value, id).toBe(row(before, id)!.value);
      expect(r.fixed, id).toBe(row(before, id)!.fixed);
    }
    expectKept(before, l.page);
    // The rest of the instrument still follows: U, V, W and the zero are bank 3's.
    const fresh = instrumentRows(cwPage(3));
    expect(fresh.map((r) => r.id)).toEqual(["profU", "profV", "profW", "zero"]);
    for (const r of fresh) expect(row(l.page, r.id)!.value, r.id).toBe(r.value);
    expect(marked(before, l.page)).toEqual(["profU", "profV", "profW", "zero"]);
    // One bank gives X and the other does not (3 → 2): the row takes the file's value where there is one.
    const on3 = refined(cwPage(3));
    const to2 = landData(on3, toCwBank(on3, 2), `Loaded data ${CW_NAME}, bank 2`, "chooser");
    expect(row(to2.page, "profX")!.value).toBe(0.47);
    expect(row(to2.page, "profY")!.value).toBe(3.9);

    // Time of flight: the made-up five banks with their X, Y, Z lines taken out.
    const without = (b: BankText): BankText => Object.fromEntries(Object.entries(b).filter(([key]) => !["X", "Y", "Z"].includes(key)));
    const bare = multiBankInstprm(Object.fromEntries(Object.entries(FIVE_BANKS).map(([n, b]) => [n, without(b)])), [1, 2, 3, 4, 5]);
    expect(bare).not.toMatch(/^[XYZ]:/m);
    const onBare = (bank: number): PowderPage => withInstrumentFile(dataPage(bank, SIX_BANK_GSA), "bare.instprm", bare).page;
    const tof = refined(onBare(2));
    const gam = (p: PowderPage) => p.session.powderParams.filter((r) => r.id.startsWith("tof_gam")).map((r) => r.id);
    expect(gam(tof)).toEqual([]);
    const t = landData(tof, toDataBank(tof, 3, SIX_BANK_GSA), `Loaded data ${NAME}, bank 3`, "chooser");
    expect(t.kept).toEqual({ from: 2, to: 3 });
    expect(t.follow!.bank).toBe(3);
    expect(gam(t.page)).toEqual([]);
    expectKept(tof, t.page);
    for (const id of ["tofSampleGauss", "tofSampleLorentz", "tofSampleSize"]) expect(row(t.page, id)!.value, id).toBe(row(tof, id)!.value);
    const freshTof = instrumentRows(onBare(3));
    expect(instrumentRows(t.page).map((r) => r.id)).toEqual(freshTof.map((r) => r.id));
    for (const r of freshTof) expect(row(t.page, r.id)!.value, r.id).toBe(r.value);
  }, T);
});

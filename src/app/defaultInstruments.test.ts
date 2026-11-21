/**
 * Default instrument files shipped with the app (app/defaultInstruments.ts):
 * the rule that recognises the data's instrument, when the default is
 * offered, that the click loads the bundled file as a user's file is loaded,
 * the standing statement and what ends it, a data bank the file leaves out,
 * the project and the History. The data here are synthetic; the bundled file
 * is the facility's, checked against GSAS-II's own reader.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCif } from "@/parsers/cif";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { parseInstrumentFile } from "@/parsers/instrument";
import { instrumentHintFromFileName, instrumentOfDataHeader } from "@/parsers/instrumentRegistry";
import {
  DEFAULT_INSTRUMENTS, defaultInstrumentById, defaultInstrumentInUse, defaultInstrumentOffer, defaultInstrumentWarning,
  defaultOfferLabel, defaultStepLabel, defaultUncovered,
} from "@/app/defaultInstruments";
import { bankAdvice, currentDataBank, currentInstrumentBank, dataBankRef, dataBanksOf, instrumentBankOptions, instrumentFileOf, DIFC_TOLERANCE } from "@/app/bankChoice";
import { emptyPage, withInstrumentFile, withPattern, withStructure, type PowderPage } from "@/app/powderPage";
import { fileProfileNote } from "@/app/tofWidthNote";
import { powderWorkspaceFrom, sessionFromPowderWorkspace } from "@/app/projectIo";
import { powderReportInput } from "@/app/reportInputs";
import { validateSnapshot } from "@/core/project/validate";
import { recordStep, redoTarget, restoreStep, moveTo, undoTarget, lineage } from "@/core/project/history";
import { refinementBundle } from "@/core/export/bundle";
import type { PowderWorkspace } from "@/core/project/types";
import { FIVE_BANK_INSTPRM, NOMAD_STYLE_BANKS, NOMAD_STYLE_GSA, SIX_BANK_GSA, multiBankGsa, tofThreeColumnDat } from "@/testSupport/instprmFixtures";
import gsas2 from "@/testSupport/nomad2023A.gsas2.json";

const T = 20_000;
const NOMAD = DEFAULT_INSTRUMENTS.find((d) => d.instrument === "NOMAD")!;
const FILE_ON_DISK = "examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm";
const structure = parseCif(readFileSync("examples/mcp/mno.cif", "utf8"));

/** A page with the synthetic NOMAD-style data on one bank and no instrument, as the Data card leaves it. */
function dataPage(bank: number, text = NOMAD_STYLE_GSA, name = "made_up.gsa"): PowderPage {
  const pattern = parseGsasHistogramPattern(text, "d", name, { bank, radiation: { kind: "neutron-tof" } });
  return withPattern(withStructure(emptyPage(), structure), pattern, { name, text, bank });
}
const offerOn = (p: PowderPage) => defaultInstrumentOffer({ pattern: p.session.pattern, rawDataText: p.session.rawData?.text, instrumentLoaded: p.instrumentLoaded });
const dataRefOf = (p: PowderPage) => dataBankRef(currentDataBank(dataBanksOf(p.session.rawData?.text), p.session.rawData));
/** The click: the bundled text, fetched, through the page's instrument-file load. */
async function clicked(p: PowderPage): Promise<PowderPage> {
  const d = offerOn(p)!;
  return withInstrumentFile(p, d.fileName, await d.load(), { bundledDefault: d.id }).page;
}
const workspaceOf = (p: PowderPage): PowderWorkspace => powderWorkspaceFrom(p.session, p.result, p.instrument, p.instrumentLoaded, { fitRange: null, displayUnit: null, manualPeakD: [] });

describe("the data file's own header names the instrument", () => {
  const header = (line: string) => multiBankGsa([{ bank: 1, difC: 1450 }], [line]);

  it("a `# Instrument: NOMAD` comment line among the leading lines is NOMAD, in any case and spacing, by name or alias", () => {
    expect(instrumentOfDataHeader(NOMAD_STYLE_GSA)?.name).toBe("NOMAD");
    for (const line of ["# Instrument: NOMAD", "#Instrument:NOMAD", "#  instrument :  nomad  ", "# Instrument: NOM", "# INSTRUMENT: Nomad\r"]) {
      expect(instrumentOfDataHeader(header(line))?.name, line).toBe("NOMAD");
    }
    // A plain three-column file with the line in its `#` header.
    expect(instrumentOfDataHeader(tofThreeColumnDat().replace("MADEUP", "NOMAD"))?.name).toBe("NOMAD");
    // Another instrument is itself, and has no default.
    expect(instrumentOfDataHeader(header("# Instrument: POWGEN"))?.name).toBe("POWGEN");
  });

  it("near misses do not match", () => {
    const misses = [
      "# Instrument: NOMADIC",                 // more than the name
      "# Instrument: NOMAD-2",
      "# Instrument: NOMAD at SNS",
      "# Instrument: MADEUP",                  // not in the registry
      "# Instrument:",                         // no value
      "Instrument: NOMAD",                     // not a comment line
      "# Sample: NOMAD standard",              // the name elsewhere
      "# Title: measured on NOMAD",
      "# Instruments: NOMAD",
      "# Previous instrument NOMAD",
    ];
    for (const line of misses) expect(instrumentOfDataHeader(header(line)), line).toBeUndefined();
    expect(instrumentOfDataHeader(undefined)).toBeUndefined();
    expect(instrumentOfDataHeader("")).toBeUndefined();
    // The synthetic files of the other tests name no instrument.
    expect(instrumentOfDataHeader(SIX_BANK_GSA)).toBeUndefined();
    expect(instrumentOfDataHeader(tofThreeColumnDat())).toBeUndefined();
  });

  it("the line counts only before the data: not after the first BANK record or the first number", () => {
    const afterBank = SIX_BANK_GSA.replace("# Data for spectrum :2", "# Instrument: NOMAD");
    expect(afterBank).not.toBe(SIX_BANK_GSA);
    expect(instrumentOfDataHeader(afterBank)).toBeUndefined();
    expect(instrumentOfDataHeader("1.0 2.0 0.1\n# Instrument: NOMAD\n2.0 3.0 0.1\n")).toBeUndefined();
    // Past the 200th line it is not looked for.
    expect(instrumentOfDataHeader(`${"# filler\n".repeat(200)}# Instrument: NOMAD\n`)).toBeUndefined();
    expect(instrumentOfDataHeader(`${"# filler\n".repeat(199)}# Instrument: NOMAD\n`)?.name).toBe("NOMAD");
  });

  it("the file's name alone is not enough: a hint for the card's label, never an offer", () => {
    expect(instrumentHintFromFileName("NOM_12345.gsa")?.name).toBe("NOMAD");
    const p = dataPage(1, SIX_BANK_GSA, "NOM_12345.gsa");
    expect(offerOn(p)).toBeNull();
  }, T);
});

describe("the offer: NOMAD data, no instrument loaded", () => {
  it("is made for recognised time-of-flight data without an instrument, and names the file's run cycle", () => {
    const p = dataPage(3);
    expect(p.instrumentLoaded).toBe(false);
    // Before the click the page is as it is for any TOF data without an instrument: view-only, nothing applied.
    expect(p.session.powderProfile.shape).not.toBe("tof");
    expect(p.session.rawInstrument).toBeUndefined();
    const d = offerOn(p);
    expect(d).toBe(NOMAD);
    expect(defaultOfferLabel(d!)).toBe("Use default NOMAD parameters (2023A)");
  }, T);

  it("is not made once an instrument is loaded, a user's or the default itself", async () => {
    const p = dataPage(3);
    const own = withInstrumentFile(p, "mine.instprm", FIVE_BANK_INSTPRM).page;
    expect(own.instrumentLoaded).toBe(true);
    expect(offerOn(own)).toBeNull();
    expect(offerOn(await clicked(p))).toBeNull();
  }, T);

  it("is not made for data of another instrument, data that name none, or constant-wavelength data", () => {
    expect(offerOn(dataPage(1, multiBankGsa(NOMAD_STYLE_BANKS, ["# Instrument: POWGEN"])))).toBeNull();
    expect(offerOn(dataPage(1, SIX_BANK_GSA))).toBeNull();
    expect(defaultInstrumentOffer({ pattern: { xUnit: "twoTheta" }, rawDataText: NOMAD_STYLE_GSA, instrumentLoaded: false })).toBeNull();
    expect(defaultInstrumentOffer({ pattern: { xUnit: "tof" }, rawDataText: undefined, instrumentLoaded: false })).toBeNull();
  }, T);

  it("the table has one row per instrument, each id once", () => {
    expect(DEFAULT_INSTRUMENTS.map((d) => d.instrument)).toEqual(["NOMAD"]);
    expect(new Set(DEFAULT_INSTRUMENTS.map((d) => d.id)).size).toBe(DEFAULT_INSTRUMENTS.length);
    expect(defaultInstrumentById("nomad-2023A")).toBe(NOMAD);
    expect(defaultInstrumentById("gone")).toBeNull();
    expect(defaultInstrumentById(undefined)).toBeNull();
  });
});

describe("the click loads the bundled file as a user's file is loaded", () => {
  it("the text fetched is the shipped file, byte for byte", async () => {
    const text = await NOMAD.load();
    expect(text).toBe(readFileSync(FILE_ON_DISK, "utf8"));
    expect(text).toContain("\r\n");
  });

  it("the page equals the one a user gets by loading that file, apart from the default's id", async () => {
    const text = await NOMAD.load();
    for (const bank of [1, 2, 3, 4, 5]) {
      const p = dataPage(bank);
      const byClick = await clicked(p);
      const byUser = withInstrumentFile(p, NOMAD.fileName, text).page;
      expect(byClick.session.rawInstrument).toEqual({ name: NOMAD.fileName, text, bank, bundledDefault: "nomad-2023A" });
      expect(byUser.session.rawInstrument).toEqual({ name: NOMAD.fileName, text, bank });
      const { rawInstrument: _a, ...clickRest } = byClick.session;
      const { rawInstrument: _b, ...userRest } = byUser.session;
      expect(clickRest).toEqual(userRest);
      expect(byClick.instrument).toEqual(byUser.instrument);
      expect(byClick.instrumentLoaded).toBe(true);
      // The bank follows the data's bank, and it is the file's bank of that number, read by the normal reader.
      const fileBank = parseInstrumentFile(text).banks.find((b) => b.bank === bank)!;
      expect(byClick.instrument).toEqual(fileBank.parameters);
      expect(byClick.session.powderProfile.shape).toBe("tof");
    }
  }, T);

  it("the card then has the bank list, the profile line of a GSAS-II file and no bank advice", async () => {
    const page = await clicked(dataPage(4));
    const file = instrumentFileOf(page.session.rawInstrument!.text)!;
    expect(instrumentBankOptions(file)!.map((o) => o.bank)).toEqual([1, 2, 3, 4, 5]);
    const bank = currentInstrumentBank(file, page.session.rawInstrument, page.instrument)!;
    expect(bank.bank).toBe(4);
    expect(bankAdvice(file, bank, dataRefOf(page))).toBeNull();
    // The profile rows as the file gives them, held, with GSAS-II's default sample rows beside them.
    expect(fileProfileNote(page.instrument, bank)!.line).toContain("Profile as the file gives it, held. Sample rows start at GSAS-II's defaults");
    const row = (kind: string) => page.session.powderParams.find((r) => r.kind === kind);
    const values = (gsas2.banks as Record<string, Record<string, number | string>>)["4"]!;
    expect(page.instrument).toMatchObject({ sig1: values["sig-1"], gamX: values.X, gamY: values.Y });
    expect(row("tofSampleLorentz")).toMatchObject({ value: 1000, fixed: true });
    expect(row("tofSampleSize")).toMatchObject({ value: 1, fixed: true });
  }, T);

  it("the cross-check against the data's DIFC stays on: a data bank whose DIFC is another bank's gets that bank, and the mismatch line when the wrong one is held", async () => {
    // Data bank 2 whose DIFC is the file's bank 3's: pairing goes by the DIFC, not the number.
    const swapped = multiBankGsa(NOMAD_STYLE_BANKS.map((b) => (b.bank === 2 ? { ...b, difC: 5600 } : b)), ["# Instrument: NOMAD"]);
    const page = await clicked(dataPage(2, swapped));
    expect(page.session.rawInstrument!.bank).toBe(3);
    // Held on bank 2 by the user's choice, the existing line names the mismatch and offers the bank.
    const forced = withInstrumentFile(page, NOMAD.fileName, page.session.rawInstrument!.text, { bank: 2, bundledDefault: NOMAD.id }).page;
    const file = instrumentFileOf(forced.session.rawInstrument!.text)!;
    const advice = bankAdvice(file, currentInstrumentBank(file, forced.session.rawInstrument, forced.instrument), dataRefOf(forced))!;
    expect(advice.line).toBe("Data are bank 2; the instrument is bank 2.");
    expect(advice.detail).toMatch(/Its difC 2851\.1 is 49 % from the data's DIFC 5600\.0/);
    expect(advice.offer).toEqual({ bank: 3, label: "Use bank 3" });
  }, T);
});

describe("the standing statement while the default is in use", () => {
  it("is one line with its reason, on the card, in the report's instrument rows and in a bundle's README", async () => {
    const page = await clicked(dataPage(3));
    const w = defaultInstrumentInUse(page.session.rawInstrument, page.instrumentLoaded)!;
    expect(w.line).toBe("Default NOMAD parameters (2023A calibration): load the instrument file for your own run cycle.");
    expect(w.title).toBe("NOMAD · default 2023A");
    expect(w.detail).toContain("The calibration changes between run cycles");
    expect(w.detail).toContain("shifts peak positions and changes peak widths");
    expect(w.detail).toContain("first look");

    const xs = page.session.pattern.points.map((q) => q.x);
    const ys = page.session.pattern.points.map((q) => q.yObs);
    const reportOf = (p: PowderPage) => powderReportInput({
      session: p.session, refinedPhases: [structure], params: p.session.powderParams, bindings: p.session.powderBindings, result: null,
      instrument: p.instrument, instrumentLoaded: p.instrumentLoaded, wR: 0.1, rExp: null, gof: null,
      curves: { x: xs, yObs: ys, yCalc: ys, diff: ys.map(() => 0) }, xLabel: "TOF (µs)", ticks: [], fitRange: null,
      pointsInWindow: xs.length, tofViewOnly: false, explored: null,
    });
    const rows = reportOf(page).data;
    expect(rows.find((r) => r.label === "Instrument parameters")?.value).toBe(w.report);
    // Directly under the Instrument row.
    expect(rows.findIndex((r) => r.label === "Instrument parameters")).toBe(rows.findIndex((r) => r.label === "Instrument") + 1);
    // A user's own file: no such row.
    expect(reportOf(withInstrumentFile(page, "mine.instprm", FIVE_BANK_INSTPRM).page).data.some((r) => r.label === "Instrument parameters")).toBe(false);
    expect(w.report).toContain("Default NOMAD parameters (2023A calibration)");
    expect(w.report).toContain("load the instrument file for your own run cycle");

    for (const target of ["gsas2", "fullprof"] as const) {
      const entries = refinementBundle(target, structure, page.session.pattern, {
        name: "t", params: page.session.powderParams, bindings: page.session.powderBindings, otherPhaseIds: [], phases: [],
        instrument: page.instrument, rawInstrument: page.session.rawInstrument!, instrumentNote: w.report,
      });
      const readme = entries.find((e) => e.name === "README.txt")!.data as string;
      expect(readme, target).toContain(`Instrument file: ${w.report}`);
      const plain = refinementBundle(target, structure, page.session.pattern, {
        name: "t", params: page.session.powderParams, bindings: page.session.powderBindings, otherPhaseIds: [], phases: [],
        instrument: page.instrument, rawInstrument: page.session.rawInstrument!,
      });
      expect(plain.find((e) => e.name === "README.txt")!.data as string, target).not.toContain("Default NOMAD");
    }
  }, T);

  it("stays through another bank of the default, and through new data", async () => {
    const page = await clicked(dataPage(3));
    const raw = page.session.rawInstrument!;
    // The Instrument card's bank list: the same file, another bank, still the default.
    const other = withInstrumentFile(page, raw.name, raw.text, { bank: 5, ...(raw.bundledDefault !== undefined ? { bundledDefault: raw.bundledDefault } : {}) }).page;
    expect(other.session.rawInstrument).toEqual({ ...raw, bank: 5 });
    expect(defaultInstrumentInUse(other.session.rawInstrument, other.instrumentLoaded)).not.toBeNull();
    // Another data bank: the instrument and its statement stay.
    const pattern = parseGsasHistogramPattern(NOMAD_STYLE_GSA, "d", "made_up.gsa", { bank: 1, radiation: { kind: "neutron-tof" } });
    const newData = withPattern(page, pattern, { name: "made_up.gsa", text: NOMAD_STYLE_GSA, bank: 1 });
    expect(defaultInstrumentInUse(newData.session.rawInstrument, newData.instrumentLoaded)).not.toBeNull();
  }, T);

  it("goes when the user loads an instrument file of their own, and is absent for any file without the id", async () => {
    const page = await clicked(dataPage(3));
    const own = withInstrumentFile(page, "mine.instprm", FIVE_BANK_INSTPRM).page;
    // (Bank 1: this made-up file's difC are not the data's, so it opens on its first bank, as any file does.)
    expect(own.session.rawInstrument).toEqual({ name: "mine.instprm", text: FIVE_BANK_INSTPRM, bank: 1 });
    expect(defaultInstrumentInUse(own.session.rawInstrument, own.instrumentLoaded)).toBeNull();
    expect(defaultInstrumentInUse(undefined, true)).toBeNull();
    expect(defaultInstrumentInUse({ bundledDefault: "nomad-2023A" }, false)).toBeNull();
  }, T);

  it("a default whose table row a later build no longer has is still named as a default", () => {
    const w = defaultInstrumentWarning("other-2030B");
    expect(w.line).toBe("Default instrument parameters (other-2030B): load the instrument file for your own run cycle.");
  });
});

describe("a data bank the default does not cover", () => {
  it("is said in one line; nothing is offered and no other bank's parameters are used", async () => {
    const text = await NOMAD.load();
    const p = dataPage(6);
    expect(offerOn(p)).toBe(NOMAD);
    const u = defaultUncovered(NOMAD, text, dataRefOf(p))!;
    expect(u.line).toBe("No instrument bank for data bank 6: the default NOMAD parameters (2023A) have banks 1, 2, 3, 4, 5.");
    expect(u.detail).toContain("none with a difC within 3 % of the data's DIFC 840.0");
    expect(u.detail).toContain("no other bank's parameters are used in its place");
    for (const bank of [1, 2, 3, 4, 5]) expect(defaultUncovered(NOMAD, text, dataRefOf(dataPage(bank))), `bank ${bank}`).toBeNull();
    // Data that name no bank (a one-bank file): nothing to check, the default is offered and opens on its first bank.
    expect(defaultUncovered(NOMAD, text, null)).toBeNull();
  }, T);

  it("with the default already on the page, a switch of the data to that bank gets the existing line and keeps the instrument as it was", async () => {
    const page = await clicked(dataPage(3));
    const pattern = parseGsasHistogramPattern(NOMAD_STYLE_GSA, "d", "made_up.gsa", { bank: 6, radiation: { kind: "neutron-tof" } });
    const six = withPattern(page, pattern, { name: "made_up.gsa", text: NOMAD_STYLE_GSA, bank: 6 });
    expect(six.instrument).toEqual(page.instrument);
    const file = instrumentFileOf(six.session.rawInstrument!.text)!;
    const advice = bankAdvice(file, currentInstrumentBank(file, six.session.rawInstrument, six.instrument), dataRefOf(six))!;
    expect(advice.line).toBe("No instrument bank for data bank 6: bank 3 is not its calibration.");
    expect(advice.offer).toBeUndefined();
  }, T);
});

describe("the project and the History", () => {
  it("a saved project stores the text and the id, and reopens without the bundle", async () => {
    const page = await clicked(dataPage(2));
    const json = JSON.parse(JSON.stringify(workspaceOf(page))) as PowderWorkspace;
    expect(json.rawInstrument).toEqual({ name: NOMAD.fileName, text: readFileSync(FILE_ON_DISK, "utf8"), bank: 2, bundledDefault: "nomad-2023A" });
    expect(() => validateSnapshot(JSON.parse(JSON.stringify([structure])), json, "project")).not.toThrow();
    expect(() => validateSnapshot(JSON.parse(JSON.stringify([structure])), { ...json, rawInstrument: { ...json.rawInstrument, bundledDefault: 1 } }, "project")).toThrow(/rawInstrument\.bundledDefault/);
    const back = sessionFromPowderWorkspace(json, [structure]);
    expect(back.instrumentLoaded).toBe(true);
    expect(back.instrument).toEqual(page.instrument);
    expect(back.session.rawInstrument).toEqual(page.session.rawInstrument);
    expect(back.session.powderParams).toEqual(page.session.powderParams);
    expect(defaultInstrumentInUse(back.session.rawInstrument, back.instrumentLoaded)!.line).toBe("Default NOMAD parameters (2023A calibration): load the instrument file for your own run cycle.");
    // A project saved with a user's file has no such field and no statement.
    const own = withInstrumentFile(dataPage(2), "mine.instprm", FIVE_BANK_INSTPRM).page;
    const ownBack = sessionFromPowderWorkspace(JSON.parse(JSON.stringify(workspaceOf(own))) as PowderWorkspace, [structure]);
    expect(ownBack.session.rawInstrument).toEqual({ name: "mine.instprm", text: FIVE_BANK_INSTPRM, bank: 1 });
    expect(defaultInstrumentInUse(ownBack.session.rawInstrument, ownBack.instrumentLoaded)).toBeNull();
  }, T);

  it("the click is one History step: back gives the page without an instrument, forward the default again", async () => {
    const before = dataPage(3);
    const after = await clicked(before);
    let history = recordStep(null, { kind: "load", label: "Loaded data made_up.gsa, bank 3", structures: [structure], workspace: workspaceOf(before) });
    history = recordStep(history, { kind: "load", label: defaultStepLabel(NOMAD, 3), structures: [structure], workspace: workspaceOf(after) });
    expect(lineage(history).map((s) => s.label)).toEqual(["Loaded data made_up.gsa, bank 3", "Loaded default NOMAD parameters (2023A), bank 3"]);

    const undo = undoTarget(history)!;
    const undone = sessionFromPowderWorkspace(restoreStep(history, undo).workspace as PowderWorkspace, [structure]);
    history = moveTo(history, undo);
    expect(undone.instrumentLoaded).toBe(false);
    expect(undone.session.rawInstrument).toBeUndefined();
    expect(offerOn({ ...before, session: undone.session, instrument: undone.instrument, instrumentLoaded: undone.instrumentLoaded })).toBe(NOMAD);

    const redo = redoTarget(history)!;
    const redone = sessionFromPowderWorkspace(restoreStep(history, redo).workspace as PowderWorkspace, [structure]);
    expect(redone.instrumentLoaded).toBe(true);
    expect(redone.session.rawInstrument).toEqual(after.session.rawInstrument);
    expect(redone.instrument).toEqual(after.instrument);
    expect(defaultInstrumentInUse(redone.session.rawInstrument, redone.instrumentLoaded)).not.toBeNull();
  }, T);
});

describe("the bundled NOMAD file itself", () => {
  const text = readFileSync(FILE_ON_DISK, "utf8");
  const file = parseInstrumentFile(text);
  const reader = gsas2 as { defaultBank: number; banks: Record<string, Record<string, number | string>> };

  it("has five banks, 1 to 5, and opens on the bank GSAS-II opens on", () => {
    expect(file.banks.map((b) => b.bank)).toEqual([1, 2, 3, 4, 5]);
    expect(Object.keys(reader.banks)).toEqual(["1", "2", "3", "4", "5"]);
    expect(reader.defaultBank).toBe(1);
  });

  it("every value of every bank equals what GSAS-II's own reader returns", () => {
    let compared = 0;
    for (const bank of file.banks) {
      const theirs = reader.banks[String(bank.bank)]!;
      // Every key GSAS-II has, with the number the file's text gives here; and no key here that GSAS-II lacks.
      expect([...bank.texts.keys()].sort()).toEqual(Object.keys(theirs).sort());
      for (const [key, value] of Object.entries(theirs)) {
        const mine = bank.texts.get(key)!;
        if (typeof value === "number") expect(Number(mine), `bank ${bank.bank} ${key}`).toBe(value);
        else expect(mine, `bank ${bank.bank} ${key}`).toBe(value);
        compared++;
      }
      // The fields the page uses and keeps, by GSAS-II's key.
      const p = bank.parameters as unknown as Record<string, number | undefined>;
      const fields: readonly (readonly [number | undefined, string])[] = [
        [p.difC, "difC"], [p.difA, "difA"], [p.difB, "difB"], [p.zero, "Zero"], [p.alpha, "alpha"],
        [p.beta0, "beta-0"], [p.beta1, "beta-1"], [p.betaQ, "beta-q"], [p.sig0, "sig-0"], [p.sig1, "sig-1"], [p.sig2, "sig-2"], [p.sigQ, "sig-q"],
        [bank.extras.twoTheta, "2-theta"], [bank.extras.flightPath, "fltPath"], [bank.extras.azimuth, "Azimuth"],
        [bank.extras.lorentzX, "X"], [bank.extras.lorentzY, "Y"], [bank.extras.lorentzZ, "Z"],
      ];
      for (const [value, key] of fields) expect(value, `bank ${bank.bank} field ${key}`).toBe(theirs[key]);
    }
    expect(compared).toBe(100);
  });

  it("names no instrument in its text (the card's title comes from the default's row), and is time of flight throughout", () => {
    for (const bank of file.banks) {
      expect(bank.parameters.kind).toBe("tof");
      expect(bank.parameters.name).toBeUndefined();
    }
    expect(DIFC_TOLERANCE).toBe(0.03);
  });
});

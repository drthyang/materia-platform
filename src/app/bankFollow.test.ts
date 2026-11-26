/**
 * The instrument follows the data's bank (app/bankFollow.ts): a switch of the
 * data bank puts the instrument file's bank for it on the page, with that
 * bank's file values in place of the old bank's refined rows, in one History
 * step that undo takes back whole; a data bank the file has no bank for keeps
 * the instrument and holds Refine, for the user and the Copilot, until the
 * user takes the held bank's parameters as a starting point, which then
 * stands as a warning. Synthetic data; the instrument file is the bundled
 * NOMAD 2023A default (the facility's) and a made-up five-bank file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCif } from "@/parsers/cif";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { parseInstrumentFile } from "@/parsers/instrument";
import { DEFAULT_INSTRUMENTS, defaultInstrumentInUse } from "@/app/defaultInstruments";
import { withInstrumentFile, withPattern, withStructure, emptyPage, type PowderPage } from "@/app/powderPage";
import {
  agentInstrumentNotes, bankCoverage, followDataBank, followNote, followStepLabel, holdNote, startingPointStepLabel, startingPointWarning, switchedRows,
} from "@/app/bankFollow";
import { powderWorkspaceFrom, sessionFromPowderWorkspace } from "@/app/projectIo";
import { powderReportInput } from "@/app/reportInputs";
import { validateSnapshot } from "@/core/project/validate";
import { lineage, moveTo, recordStep, restoreStep, undoTarget } from "@/core/project/history";
import type { PowderWorkspace } from "@/core/project/types";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { FIVE_BANK_INSTPRM, NOMAD_STYLE_GSA, multiBankGsa } from "@/testSupport/instprmFixtures";
import gsas2 from "@/testSupport/nomad2023A.gsas2.json";

const T = 30_000;
const NOMAD = DEFAULT_INSTRUMENTS.find((d) => d.instrument === "NOMAD")!;
const TEXT = readFileSync("examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm", "utf8");
const structure = parseCif(readFileSync("examples/mcp/mno.cif", "utf8"));
const NAME = "made_up.gsa";

/** The data's bank on the page as the Data card reads it. */
const patternOf = (bank: number, text = NOMAD_STYLE_GSA) => parseGsasHistogramPattern(text, "d", NAME, { bank, radiation: { kind: "neutron-tof" } });
const dataPage = (bank: number, text = NOMAD_STYLE_GSA): PowderPage => withPattern(withStructure(emptyPage(), structure), patternOf(bank, text), { name: NAME, text, bank });
/** Five banks whose file states no DIFC: paired by number alone. */
const NO_DIFC_GSA = multiBankGsa([1, 2, 3, 4, 5].map((bank) => ({ bank, difC: null })));
/** The default, clicked, on data of this bank. */
const withDefault = (bank: number): PowderPage => withInstrumentFile(dataPage(bank), NOMAD.fileName, TEXT, { bundledDefault: NOMAD.id }).page;
/** The Data card's chooser: the data's bank changed (App.applyPowder), before the instrument follows. */
const toDataBank = (p: PowderPage, bank: number, text = NOMAD_STYLE_GSA): PowderPage => withPattern(p, patternOf(bank, text), { name: NAME, text, bank });
const workspaceOf = (p: PowderPage): PowderWorkspace => powderWorkspaceFrom(p.session, p.result, p.instrument, p.instrumentLoaded, { fitRange: null, displayUnit: null, manualPeakD: [] });
const row = (p: PowderPage, id: string) => p.session.powderParams.find((r) => r.id === id);
/** "Refined" instrument rows: values a fit could have left, none of them a file's. */
const refined = (p: PowderPage): PowderPage => ({
  ...p,
  session: {
    ...p.session,
    powderParams: p.session.powderParams.map((r) => (r.id === "zero" ? { ...r, value: 3.21 } : r.id === "tof_difC" ? { ...r, value: r.value * 1.001 } : r.kind === "tofFileProfile" ? { ...r, value: r.value * 1.1 + 0.01 } : r)),
  },
});

describe("the instrument follows the data's bank", () => {
  it("on the NOMAD 2023A default, every switch between banks 1–5 puts the file's own values of the new bank on the page", () => {
    const file = parseInstrumentFile(TEXT);
    const reader = gsas2.banks as Record<string, Record<string, number | string>>;
    for (const from of [1, 2, 3, 4, 5]) {
      const start = refined(withDefault(from));
      for (const to of [1, 2, 3, 4, 5]) {
        if (to === from) continue;
        const f = followDataBank(toDataBank(start, to))!;
        expect(f, `${from} → ${to}`).not.toBeNull();
        expect(f.bank).toBe(to);
        expect(f.dataBank).toBe(to);
        // The file's bank, as its own reader gives it, and as GSAS-II's reader gives it.
        expect(f.page.instrument).toEqual(file.banks.find((b) => b.bank === to)!.parameters);
        const g = reader[String(to)]!;
        expect(f.page.instrument).toMatchObject({ kind: "tof", difC: g.difC, difA: g.difA, zero: g.Zero, sig1: g["sig-1"], gamX: g.X, gamY: g.Y });
        expect(row(f.page, "tof_difC")!.value).toBe(g.difC);
        expect(row(f.page, "zero")!.value).toBe(g.Zero);
        // A default stays a default, on the new bank.
        expect(f.page.session.rawInstrument).toEqual({ name: NOMAD.fileName, text: TEXT, bank: to, bundledDefault: NOMAD.id });
        expect(defaultInstrumentInUse(f.page.session.rawInstrument, f.page.instrumentLoaded)).not.toBeNull();
        // The page equals the one the default gives when clicked on data of that bank: no refined value of the old bank stays.
        expect(f.page.session.powderParams).toEqual(withDefault(to).session.powderParams);
        expect(f.page.instrument).toEqual(withDefault(to).instrument);
        expect(f.page.result).toBeNull();
      }
    }
  }, T);

  it("does the same for any instrument file with several banks (a user's)", () => {
    const own = withInstrumentFile(dataPage(2, NO_DIFC_GSA), "mine.instprm", FIVE_BANK_INSTPRM).page;
    expect(own.session.rawInstrument!.bank).toBe(2);
    const f = followDataBank(toDataBank(refined(own), 4, NO_DIFC_GSA))!;
    expect(f.bank).toBe(4);
    expect(f.page.session.rawInstrument).toEqual({ name: "mine.instprm", text: FIVE_BANK_INSTPRM, bank: 4 });
    expect(f.page.session.powderParams).toEqual(withInstrumentFile(dataPage(4, NO_DIFC_GSA), "mine.instprm", FIVE_BANK_INSTPRM).page.session.powderParams);
  }, T);

  it("does nothing when the instrument is already on the data's bank, or with no instrument file", () => {
    const p = withDefault(3);
    expect(followDataBank(p)).toBeNull();
    expect(followDataBank(toDataBank(dataPage(1), 3))).toBeNull();
  });

  it("names the switch in the History step and the highlight, and marks the rows it changed", () => {
    const start = refined(withDefault(2));
    const f = followDataBank(toDataBank(start, 3))!;
    expect(followStepLabel(f.bank, f.dataBank)).toBe("Instrument bank 3, following data bank 3");
    expect(followNote(f.bank)).toBe("Instrument switched to bank 3 with the data bank");
    const rows = switchedRows(start.session.powderParams, f.page.session.powderParams);
    expect(rows).toContain("tof_difC");
    expect(rows).toContain("zero");
    // Only Instrument / profile rows, and each at another value than before.
    for (const id of rows) expect(row(f.page, id)!.value).not.toBe(row(start, id)?.value);
    expect(rows.some((id) => id === "scale" || id.startsWith("bkg"))).toBe(false);
  });

  it("is one History step: undo gives back the previous data bank, instrument bank and refined rows", () => {
    const before = refined(withDefault(2));
    const f = followDataBank(toDataBank(before, 3))!;
    let history = recordStep(null, { kind: "load", label: "Loaded default NOMAD parameters (2023A), bank 2", structures: [structure], workspace: workspaceOf(before) });
    history = recordStep(history, { kind: "load", label: followStepLabel(f.bank, f.dataBank), structures: [structure], workspace: workspaceOf(f.page) });
    expect(lineage(history).map((s) => s.label)).toEqual(["Loaded default NOMAD parameters (2023A), bank 2", "Instrument bank 3, following data bank 3"]);
    const undo = undoTarget(history)!;
    const undone = sessionFromPowderWorkspace(restoreStep(history, undo).workspace as PowderWorkspace, [structure]);
    expect(moveTo(history, undo).current).toBe(undo);
    expect(undone.session.rawData!.bank).toBe(2);
    expect(undone.session.rawInstrument!.bank).toBe(2);
    expect(undone.instrument).toEqual(before.instrument);
    expect(undone.session.powderParams).toEqual(before.session.powderParams);
    expect(undone.session.powderParams.find((r) => r.id === "zero")!.value).toBe(3.21);
  });
});

describe("a data bank the instrument file has no bank for", () => {
  const six = (): PowderPage => toDataBank(refined(withDefault(5)), 6);

  it("refuses to switch: the instrument stays bank 5's, and Refine is held with the plain reason", () => {
    const p = six();
    expect(followDataBank(p)).toBeNull();
    expect(p.session.rawInstrument!.bank).toBe(5);
    const c = bankCoverage(p.session, p.instrument, p.instrumentLoaded)!;
    expect(c.startingPoint).toBe(false);
    expect(c.uncovered).toMatchObject({ dataBank: 6, instrumentBank: 5, fileBanks: [1, 2, 3, 4, 5], dataDifC: 840 });
    const h = holdNote(c.uncovered);
    expect(h.line).toBe("Refine is off: no instrument bank for data bank 6, and another bank's calibration gives wrong peak positions.");
    expect(h.loadLabel).toBe("Load instrument for bank 6…");
    expect(h.overrideLabel).toBe("Use bank 5's parameters as a starting point");
    expect(h.detail).toContain("none with a difC within 3 % of the data's DIFC 840.0");
    // Covered banks hold nothing.
    for (const b of [1, 2, 3, 4, 5]) {
      const q = followDataBank(toDataBank(withDefault(1), b))?.page ?? toDataBank(withDefault(1), b);
      expect(bankCoverage(q.session, q.instrument, q.instrumentLoaded), `bank ${b}`).toBeNull();
    }
  });

  it("the Copilot reads the hold in get_state and its refine is refused before the card", async () => {
    const p = six();
    const { port } = sessionPort(p.session, p.instrument, { instrumentOnPage: true });
    const notes = port.state().instrumentNotes!;
    expect(notes.refineHeld).toMatch(/^Refine is held: data bank 6 has no bank in the instrument file \(it has banks 1, 2, 3, 4, 5\)/);
    expect(notes.startingPoint).toBeUndefined();
    expect(notes.defaultParameters).toBe(defaultInstrumentInUse(p.session.rawInstrument, true)!.agent);
    const { ex, asked } = executor(fakeHost(port).host, "auto");
    const state = JSON.parse((await ex.run("get_state", {})).text) as { instrument: Record<string, unknown> };
    expect(state.instrument.refineHeld).toBe(notes.refineHeld);
    expect(state.instrument.defaultParameters).toBe(notes.defaultParameters);
    expect((await ex.run("refine", {})).text).toContain("Refine is held: data bank 6");
    expect(asked).toEqual([]);
  }, T);

  it("the override unlocks refining, with the standing warning on the card, in the report and for the Copilot", async () => {
    const p = six();
    const c0 = bankCoverage(p.session, p.instrument, p.instrumentLoaded)!;
    expect(startingPointStepLabel(c0.uncovered)).toBe("Bank 5's parameters as a starting point for data bank 6");
    const over: PowderPage = { ...p, session: { ...p.session, rawInstrument: { ...p.session.rawInstrument!, startingPointFor: 6 } } };
    const c = bankCoverage(over.session, over.instrument, over.instrumentLoaded)!;
    expect(c.startingPoint).toBe(true);
    const w = startingPointWarning(c.uncovered);
    expect(w.line).toBe("Bank 5's parameters, a starting point for data bank 6: refine DIFC and Zero, and check the peak positions.");
    expect(w.detail).toContain("free the TOF difC and Zero rows in the first refinements");
    // The report's instrument rows.
    const report = powderReportInput({
      session: over.session, refinedPhases: [structure], params: over.session.powderParams, bindings: over.session.powderBindings, result: null,
      instrument: over.instrument, instrumentLoaded: true, wR: 0.1, rExp: null, gof: null, curves: { x: [1, 2], yObs: [1, 1], yCalc: [1, 1] },
      xLabel: "TOF", ticks: [], fitRange: null, pointsInWindow: 2, tofViewOnly: false, explored: null, judgment: null,
    } as unknown as Parameters<typeof powderReportInput>[0]);
    const rows = JSON.stringify(report);
    expect(rows).toContain(w.report);
    // The Copilot: no hold, the warning, and refine runs to its card.
    const { port } = sessionPort(over.session, over.instrument, { instrumentOnPage: true });
    const notes = port.state().instrumentNotes!;
    expect(notes.refineHeld).toBeUndefined();
    expect(notes.startingPoint).toMatch(/^Bank 5's parameters, used as a starting point for data bank 6/);
    const { ex } = executor(fakeHost(port).host, "auto");
    expect((await ex.run("refine", {})).text).not.toContain("Refine is held");
    // The project keeps the choice; a later switch to a covered bank drops it with the old bank.
    const json = JSON.parse(JSON.stringify(workspaceOf(over))) as PowderWorkspace;
    expect(json.rawInstrument!.startingPointFor).toBe(6);
    expect(() => validateSnapshot(JSON.parse(JSON.stringify([structure])), json, "project")).not.toThrow();
    expect(() => validateSnapshot(JSON.parse(JSON.stringify([structure])), { ...json, rawInstrument: { ...json.rawInstrument!, startingPointFor: "6" } } as unknown as PowderWorkspace, "project")).toThrow(/startingPointFor/);
    const back = followDataBank(toDataBank(over, 2))!;
    expect(back.page.session.rawInstrument).toEqual({ name: NOMAD.fileName, text: TEXT, bank: 2, bundledDefault: NOMAD.id });
  }, T);

  it("a one-bank file is held only when the data's own DIFC says it is another bank's", () => {
    const one = TEXT.split(/(?=#Bank 2)/)[0]!;
    const onFive = withInstrumentFile(toDataBank(dataPage(5), 5), "one.instprm", one).page;
    // The file's one bank (bank 1, difC 1440) against data bank 5 (DIFC 9900): held.
    expect(bankCoverage(onFive.session, onFive.instrument, onFive.instrumentLoaded)?.uncovered.dataBank).toBe(5);
    const onOne = withInstrumentFile(dataPage(1), "one.instprm", one).page;
    expect(bankCoverage(onOne.session, onOne.instrument, onOne.instrumentLoaded)).toBeNull();
  });

  it("nothing is said with no instrument notes to give", () => {
    const p = withInstrumentFile(dataPage(3, NO_DIFC_GSA), "mine.instprm", FIVE_BANK_INSTPRM).page;
    expect(agentInstrumentNotes(p.session.rawInstrument, true, bankCoverage(p.session, p.instrument, true))).toBeUndefined();
  });
});

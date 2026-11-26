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
  agentInstrumentNotes, bankCoverage, bundleInstrumentNote, closestBank, followDataBank, followNote, followStepLabel, holdNote, loadFollowStepLabel, overrideLabel,
  startingBanks, startingPointStepLabel, startingPointWarning, switchedRows, withStartingPoint,
} from "@/app/bankFollow";
import { withinReflectionLimit } from "@/app/ui/PowderValidation";
import { ReflectionLimitError } from "@/core/diffraction/reflections";
import { refinementBundle } from "@/core/export/bundle";
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
    expect(h.detail).toContain("none with a difC within 3 % of the data's DIFC 840.0");
    expect(h.detail).toContain("or start from another bank's parameters (the closest is bank 1's: difC 1439.6, 71 % from the data's DIFC 840.0)");
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
    expect(startingPointStepLabel(5, 6)).toBe("Bank 5's parameters as a starting point for data bank 6");
    // Starting from the bank the page holds (bank 5), chosen on the card's chooser.
    const over = withStartingPoint(p, 5)!;
    expect(over.session.rawInstrument).toEqual({ ...p.session.rawInstrument!, startingPointFor: 6 });
    expect(over.session.powderParams).toEqual(p.session.powderParams);
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
    expect(notes.startingPoint).toMatch(/^Bank 5's parameters are the starting point for data bank 6/);
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

describe("the follow-up: a new file, the closest bank, the magnetic step and the posterior, the TOF line, the bundle", () => {
  const six = (): PowderPage => toDataBank(refined(withDefault(5)), 6);

  it("(a) a new data file follows too: its opening bank takes the file's bank for it, in the load's own step", () => {
    // The default on data bank 3 of one file; a new file opens on its bank 1.
    const on3 = withDefault(3);
    const other = multiBankGsa([1, 2, 3, 4, 5].map((bank) => ({ bank, difC: [1450, 2860, 5600, 9050, 9900][bank - 1]! })), ["# Instrument: NOMAD"]);
    const fresh = withPattern(on3, patternOf(1, other), { name: "next.gsa", text: other, bank: 1 });
    const f = followDataBank(fresh)!;
    expect(f.bank).toBe(1);
    expect(f.page.session.rawInstrument).toEqual({ name: NOMAD.fileName, text: TEXT, bank: 1, bundledDefault: NOMAD.id });
    expect(f.page.instrument).toEqual(withDefault(1).instrument);
    expect(loadFollowStepLabel("Loaded data next.gsa, bank 1", f.bank)).toBe("Loaded data next.gsa, bank 1 · instrument bank 1");
    // A new file on a bank the instrument is already on: nothing to switch.
    expect(followDataBank(withPattern(withDefault(1), patternOf(1, other), { name: "next.gsa", text: other, bank: 1 }))).toBeNull();
  });

  it("(b) the override offers the bank whose difC is closest to the data's DIFC, and any other bank on the chooser", () => {
    const p = six();
    const u = bankCoverage(p.session, p.instrument, p.instrumentLoaded)!.uncovered;
    expect(startingBanks(u).map((b) => b.label)).toEqual([
      "Bank 1 · difC 1439.6 · 71 % from the data's DIFC",
      "Bank 2 · difC 2851.1 · 239 % from the data's DIFC",
      "Bank 3 · difC 5612.4 · 568 % from the data's DIFC",
      "Bank 4 · difC 9068.6 · 980 % from the data's DIFC",
      "Bank 5 · difC 9912.1 · 1080 % from the data's DIFC",
    ]);
    expect(closestBank(u)!.bank).toBe(1);
    expect(holdNote(u).closest!.bank).toBe(1);
    expect(overrideLabel(1)).toBe("Use bank 1's parameters as a starting point");
    // Taken: bank 1's file values on the page, the choice kept for data bank 6, and the warning names bank 1.
    const over = withStartingPoint(p, 1)!;
    expect(over.session.rawInstrument).toEqual({ name: NOMAD.fileName, text: TEXT, bank: 1, bundledDefault: NOMAD.id, startingPointFor: 6 });
    expect(over.instrument).toEqual(parseInstrumentFile(TEXT).banks[0]!.parameters);
    const c = bankCoverage(over.session, over.instrument, over.instrumentLoaded)!;
    expect(c.startingPoint).toBe(true);
    expect(startingPointWarning(c.uncovered).line).toBe("Bank 1's parameters, a starting point for data bank 6: refine DIFC and Zero, and check the peak positions.");
    expect(startingPointWarning(c.uncovered).detail).toContain("(its difC 1439.6 is 71 % from the data's DIFC 840.0)");
    // A bank the file does not have, or a page with nothing held, takes nothing.
    expect(withStartingPoint(p, 7)).toBeNull();
    expect(withStartingPoint(withDefault(2), 1)).toBeNull();
    // Without a DIFC in the data, the offer is the bank the page holds.
    const noDifc = toDataBank(withInstrumentFile(dataPage(2, NO_DIFC_GSA), "four.instprm", TEXT.split(/(?=#Bank 5)/)[0]!).page, 5, NO_DIFC_GSA);
    const u2 = bankCoverage(noDifc.session, noDifc.instrument, noDifc.instrumentLoaded)!.uncovered;
    expect(closestBank(u2)!.bank).toBe(u2.instrumentBank);
    expect(startingBanks(u2)[0]!.label).toBe("Bank 1 · difC 1439.6");
  });

  it("(b) the Copilot's texts name the closest bank while held, and the chosen bank once taken", () => {
    const p = six();
    const held = agentInstrumentNotes(p.session.rawInstrument, true, bankCoverage(p.session, p.instrument, true))!;
    expect(held.refineHeld).toBe("Refine is held: data bank 6 has no bank in the instrument file (it has banks 1, 2, 3, 4, 5), and bank 5's calibration, which the page holds, gives wrong peak positions (its difC 9912.1 is 1080 % from the data's DIFC 840.0). The user can load the instrument file for bank 6, choose a data bank the file covers, or choose on the Instrument card to start from another bank's parameters (the closest is bank 1's: difC 1439.6, 71 % from the data's DIFC 840.0).");
    const over = withStartingPoint(p, 1)!;
    const taken = agentInstrumentNotes(over.session.rawInstrument, true, bankCoverage(over.session, over.instrument, true))!;
    expect(taken.refineHeld).toBeUndefined();
    expect(taken.startingPoint).toBe("Bank 1's parameters are the starting point for data bank 6, which the instrument file does not cover (the user's choice; bank 1's difC 1439.6 is 71 % from the data's DIFC 840.0): the TOF difC and Zero rows must be refined and the calculated peak positions checked against the observed ones; the peak-shape terms are bank 1's and may not match this bank's peak widths.");
  });

  it("(3) the owner's startingPoint wording: without a DIFC in the data, and on constant-wavelength banks", () => {
    // Time of flight, data that state no DIFC: a four-bank file against data bank 5, started from bank 2.
    const noDifc = toDataBank(withInstrumentFile(dataPage(2, NO_DIFC_GSA), "four.instprm", TEXT.split(/(?=#Bank 5)/)[0]!).page, 5, NO_DIFC_GSA);
    const over = withStartingPoint(noDifc, 2)!;
    expect(agentInstrumentNotes(over.session.rawInstrument, true, bankCoverage(over.session, over.instrument, true))!.startingPoint).toBe(
      "Bank 2's parameters are the starting point for data bank 5, which the instrument file does not cover (the user's choice): the TOF difC and Zero rows must be refined and the calculated peak positions checked against the observed ones; the peak-shape terms are bank 2's and may not match this bank's peak widths.",
    );
    // Constant wavelength (no difC on either side): its own ending, the same closing clause.
    const cw = { uncovered: { dataBank: 3, instrumentBank: 1, fileBanks: [1, 2], fileDifC: [{ bank: 1 }, { bank: 2 }] }, startingPoint: true };
    expect(agentInstrumentNotes({ name: "cw.instprm", text: "", bank: 1, startingPointFor: 3 }, true, cw)!.startingPoint).toBe(
      "Bank 1's parameters are the starting point for data bank 3, which the instrument file does not cover (the user's choice): the Zero row (and check the wavelength) must be refined and the calculated peak positions checked against the observed ones; the peak-shape terms are bank 1's and may not match this bank's peak widths.",
    );
  });

  it("(c) the magnetic step's ranking and moments fit, and the posterior, are refused with the same reason while held, and run once the override is taken", async () => {
    const p = six();
    const { port } = sessionPort(p.session, p.instrument, { instrumentOnPage: true });
    const reason = port.state().instrumentNotes!.refineHeld!;
    const { ex, asked } = executor(fakeHost(port).host, "auto");
    await ex.run("read_skill", { name: "magnetic-analysis" });
    expect((await ex.run("refine_moments", {})).text).toContain(reason);
    expect((await ex.run("rank_magnetic_groups", {})).text).toContain(reason);
    expect((await ex.run("sample_posterior", {})).text).toContain(reason);
    expect(asked).toEqual([]);
    const over = withStartingPoint(p, 1)!;
    const { port: port2 } = sessionPort(over.session, over.instrument, { instrumentOnPage: true });
    const { ex: ex2 } = executor(fakeHost(port2).host, "auto");
    await ex2.run("read_skill", { name: "magnetic-analysis" });
    expect((await ex2.run("sample_posterior", {})).text).not.toContain("Refine is held");
    expect((await ex2.run("refine_moments", {})).text).not.toContain("Refine is held");
  }, T);

  it("(d) get_state on a TOF page without an instrument says peak positions need an instrument file; a constant-wavelength page keeps its line", async () => {
    const tof = dataPage(2);
    const { port } = sessionPort(tof.session, tof.instrument, { instrumentOnPage: false });
    const state = JSON.parse((await executor(fakeHost(port).host).ex.run("get_state", {})).text) as { instrument: unknown };
    expect(state.instrument).toBe("none loaded (time-of-flight data: peak positions need an instrument file)");
    const cw = withStructure(emptyPage(), structure);
    const { port: cwPort } = sessionPort(cw.session, cw.instrument, { instrumentOnPage: false });
    const cwState = JSON.parse((await executor(fakeHost(cwPort).host).ex.run("get_state", {})).text) as { instrument: unknown };
    expect(cw.session.pattern.xUnit).not.toBe("tof");
    expect(cwState.instrument).toBe("none loaded (default CW, λ = 1.54 Å)");
  }, T);

  it("(e) an exported bundle's README states the starting point, after the default's statement", () => {
    const over = withStartingPoint(six(), 1)!;
    const c = bankCoverage(over.session, over.instrument, over.instrumentLoaded);
    const note = bundleInstrumentNote(over.session.rawInstrument, over.instrumentLoaded, c)!;
    const w = startingPointWarning(c!.uncovered);
    expect(note).toBe(`${defaultInstrumentInUse(over.session.rawInstrument, true)!.report} ${w.report}`);
    for (const target of ["gsas2", "fullprof"] as const) {
      const readme = refinementBundle(target, structure, over.session.pattern, {
        name: "t", params: over.session.powderParams, bindings: over.session.powderBindings, otherPhaseIds: [], phases: [],
        instrument: over.instrument, rawInstrument: over.session.rawInstrument!, instrumentNote: note,
      }).find((e) => e.name === "README.txt")!.data as string;
      expect(readme, target).toContain(w.report);
    }
    // A user's file on its own bank: nothing to say; held without the override: nothing yet.
    const own = withInstrumentFile(dataPage(3, NO_DIFC_GSA), "mine.instprm", FIVE_BANK_INSTPRM).page;
    expect(bundleInstrumentNote(own.session.rawInstrument, true, bankCoverage(own.session, own.instrument, true))).toBeNull();
    const held = six();
    expect(bundleInstrumentNote(held.session.rawInstrument, true, bankCoverage(held.session, held.instrument, true))).toBe(defaultInstrumentInUse(held.session.rawInstrument, true)!.report);
  });

  it("the Validation view's guard: past the reflection limit it reads nothing; any other error is thrown", () => {
    expect(withinReflectionLimit(() => 7)).toBe(7);
    expect(withinReflectionLimit(() => { throw new ReflectionLimitError("Reflection list too large for d ≥ 0.04032 Å"); })).toBeNull();
    expect(() => withinReflectionLimit(() => { throw new Error("something else"); })).toThrow("something else");
  });
});


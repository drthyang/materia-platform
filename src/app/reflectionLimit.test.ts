/**
 * A reflection list past the engine's limit on the powder page
 * (app/reflectionLimit.ts): the page is never replaced by an error, the
 * cards and the bank chooser stay usable, and the sentence names the data's
 * reach and what to do.
 *
 * The user's flow: GaTa₄Se₈ (a = 10.36 Å) on six-bank NOMAD-style data with
 * the bundled NOMAD 2023A default (banks 1–5). Data bank 4 → 6: bank 6 has no
 * bank in the file, so the page holds bank 4's calibration, at which bank 6's
 * short times of flight reach d 0.039 Å. The model's list stops where the
 * file's σ² turns ≤ 0 (d ≈ 0.21 Å); the Instrument card's width note listed
 * the reflections it leaves out over the data's whole range, past the limit,
 * and that threw out of the page. Synthetic data (the published cell, made-up
 * counts); the start times of the made-up banks follow the real file's.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCif } from "@/parsers/cif";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { DEFAULT_INSTRUMENTS } from "@/app/defaultInstruments";
import { powderPageCurves, withInstrumentFile, withPattern, withStructure, emptyPage, type PowderPage } from "@/app/powderPage";
import { landData } from "@/app/bankKeep";
import { powderWorkspaceFrom, sessionFromPowderWorkspace } from "@/app/projectIo";
import { snapProjectStructures } from "@/app/snapOnOpen";
import { recordStep, restoreStep, undoTarget } from "@/core/project/history";
import type { PowderWorkspace } from "@/core/project/types";
import { bankCoverage } from "@/app/bankFollow";
import { tofWidthNote } from "@/app/tofWidthNote";
import { pageReflectionLimit, reflectionLimitSentence, timesTen, withinReflectionLimit } from "@/app/reflectionLimit";
import { ReflectionLimitError } from "@/core/diffraction/reflections";
import { tofReflectionsLeftOut } from "@/core/workflow/powder";
import { appliedPhases } from "@/app/shortD";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { FIVE_BANK_INSTPRM, NOMAD_STYLE_BANKS, multiBankGsa } from "@/testSupport/instprmFixtures";

const T = 60_000;
const NOMAD = DEFAULT_INSTRUMENTS.find((d) => d.instrument === "NOMAD")!;
const TEXT = readFileSync("examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm", "utf8");
const structure = parseCif(readFileSync("examples/mcp/gata4se8.cif", "utf8"));
const NAME = "made_up.gsa";
/** NOMAD_STYLE_BANKS with the real file's start times: bank 4 from 1137 µs, bank 6 (low angle) from 351 µs. */
const STARTS: Readonly<Record<number, number>> = { 1: 449, 2: 720, 3: 735, 4: 1137, 5: 1246, 6: 351 };
const GSA = multiBankGsa(NOMAD_STYLE_BANKS.map((b) => ({ ...b, start: STARTS[b.bank]!, points: 400 })), ["# Instrument: NOMAD"]);

const patternOf = (bank: number, text = GSA) => parseGsasHistogramPattern(text, "d", NAME, { bank, radiation: { kind: "neutron-tof" } });
const dataPage = (bank: number, text = GSA): PowderPage => withPattern(withStructure(emptyPage(), structure), patternOf(bank, text), { name: NAME, text, bank });
const withDefault = (bank: number): PowderPage => withInstrumentFile(dataPage(bank), NOMAD.fileName, TEXT, { bundledDefault: NOMAD.id }).page;
const toDataBank = (p: PowderPage, bank: number, text = GSA): PowderPage => withPattern(p, patternOf(bank, text), { name: NAME, text, bank });

describe("the NOMAD default held on data bank 6: the width note past the limit", () => {
  const six = (): PowderPage => toDataBank(withDefault(4), 6);

  it("the cause: listing the reflections the file's profile leaves out, over the data's whole d-range, passes the limit", () => {
    const p = six();
    expect(bankCoverage(p.session, p.instrument, p.instrumentLoaded)!.uncovered).toMatchObject({ dataBank: 6, instrumentBank: 4 });
    let thrown: unknown;
    try {
      tofReflectionsLeftOut(p.session.pattern, appliedPhases(p.session)[0]!);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReflectionLimitError);
    const over = (thrown as ReflectionLimitError).over!;
    expect(over.limit).toBe("scan");
    expect(over.dMin).toBeCloseTo(351 / 9068.55, 3);
    // The model's own list stops at the profile's end (σ² ≤ 0 below it), well within the limit: the page can draw it.
    expect(pageReflectionLimit(p.session, null)).toBeNull();
  });

  it("the width note says the reflections there are not drawn, and why they are not listed, instead of throwing", () => {
    const note = tofWidthNote(six().session)!;
    expect(note.line).toMatch(/^The instrument file gives no peak width for d 0\.039–0\.\d{3} Å \(σ² ≤ 0\): the reflections there are not drawn\.$/);
    expect(note.detail).toContain("They are too many to list: the data reach d 0.039 Å, 1.5×10⁸ hkl to scan, over the limit.");
    // On bank 4 itself (its own calibration) the note lists them as before.
    expect(tofWidthNote(withDefault(4).session)?.line ?? "").not.toContain("the reflections there are not drawn");
  });

  it("the Agent's get_state reads the page, and refine is refused with the hold's reason", async () => {
    const p = six();
    const { port } = sessionPort(p.session, p.instrument, { instrumentOnPage: true });
    const { ex } = executor(fakeHost(port).host, "auto");
    const state = (await ex.run("get_state", {})).text;
    expect(state).toContain("the reflections there are not drawn");
    const held = port.state().instrumentNotes!.refineHeld!;
    expect((await ex.run("refine", {})).text).toContain(held);
  }, T);

  it("the guard reads past the limit as nothing and throws anything else", () => {
    expect(withinReflectionLimit(() => 7)).toBe(7);
    expect(withinReflectionLimit(() => { throw new ReflectionLimitError("Reflection list too large"); })).toBeNull();
    expect(() => withinReflectionLimit(() => { throw new Error("something else"); })).toThrow("something else");
  });
});

/**
 * The list itself past the limit: a user's five-bank file whose bank 5
 * profile gives a peak at every d (σ² = 900 d²), held on data bank 6, whose
 * short times of flight reach d 0.034 Å at bank 5's difC. Nothing on the
 * page can be calculated there.
 */
describe("a held calibration whose list passes the limit", () => {
  const GSA6 = multiBankGsa([
    { bank: 1, difC: 1215.5, tth: 20 }, { bank: 2, difC: 3310.5, tth: 40 }, { bank: 3, difC: 6100.5, tth: 75 },
    { bank: 4, difC: 7755.5, tth: 110.5 }, { bank: 5, difC: 10240.5, tth: 160, points: 200 }, { bank: 6, difC: 640.5, tth: 10, start: 350, points: 200 },
  ]);
  const onFive = (): PowderPage => withInstrumentFile(dataPage(5, GSA6), "mine.instprm", FIVE_BANK_INSTPRM).page;
  const SENTENCE = "Bank 6's data at this instrument calibration reach d 0.034 Å: 2.2×10⁸ hkl to scan, over the limit. Load the instrument file for bank 6, or narrow the window.";
  const workspaceOf = (p: PowderPage): PowderWorkspace => powderWorkspaceFrom(p.session, p.result, p.instrument, p.instrumentLoaded, { fitRange: null, displayUnit: null, manualPeakD: [] });

  it("bank 5 → 6: the page lands (no throw), its list is past the limit, and the sentence says where and what to do", () => {
    const before = onFive();
    expect(pageReflectionLimit(before.session, null)).toBeNull();
    const l = landData(before, toDataBank(before, 6, GSA6), `Loaded data ${NAME}, bank 6`, "chooser");
    expect(l.label).toBe("Data bank 5 → 6, refinement values kept");
    const over = pageReflectionLimit(l.page.session, null)!;
    expect(over).toMatchObject({ limit: "scan", max: 6e7 });
    expect(over.dMin).toBeCloseTo(350 / 10250.5, 4);
    expect(() => powderPageCurves(l.page.session, null)).toThrow(ReflectionLimitError);
    const c = bankCoverage(l.page.session, l.page.instrument, l.page.instrumentLoaded)!;
    expect(reflectionLimitSentence(over, { dataBank: 6, uncovered: !!c })).toBe(SENTENCE);
    // The width note and the axis reading read the page without throwing.
    expect(() => tofWidthNote(l.page.session)).not.toThrow();
    // A window that starts above the short-d end brings the list within the limit.
    const xs = l.page.session.pattern.points.map((pt) => pt.x);
    expect(pageReflectionLimit(l.page.session, { min: xs[Math.floor(xs.length * 0.9)]!, max: xs[xs.length - 1]! })).toBeNull();
  }, T);

  it("the Agent: get_state gives the sentence and no wR; refine and the posterior are refused with it", async () => {
    const before = onFive();
    const p = landData(before, toDataBank(before, 6, GSA6), `Loaded data ${NAME}, bank 6`, "chooser").page;
    const { port } = sessionPort(p.session, p.instrument, { instrumentOnPage: true });
    expect(port.state().reflectionLimit).toBe(SENTENCE);
    const { ex } = executor(fakeHost(port).host, "auto");
    const state = JSON.parse((await ex.run("get_state", {})).text) as { reflectionLimit?: string; wR: unknown };
    expect(state.reflectionLimit).toBe(SENTENCE);
    expect(state.wR).toBeNull();
    expect((await ex.run("refine", {})).text).toContain(SENTENCE);
    expect((await ex.run("sample_posterior", {})).text).toContain(SENTENCE);
    // The window narrowed above the short-d end: the list is within the limit, get_state reads the curves again,
    // and refine is held for the bank alone.
    const xs = p.session.pattern.points.map((pt) => pt.x);
    await ex.run("set_fit_range", { min: xs[Math.floor(xs.length * 0.9)]!, max: xs[xs.length - 1]! });
    expect(port.state().reflectionLimit).toBeUndefined();
    const narrowed = JSON.parse((await ex.run("get_state", {})).text) as { reflectionLimit?: string; wR: unknown };
    expect(narrowed.reflectionLimit).toBeUndefined();
    expect(typeof narrowed.wR).toBe("number");
    expect((await ex.run("refine", {})).text).toContain(port.state().instrumentNotes!.refineHeld!);
    // Bank 5 on the same page: nothing held for the limit.
    const { port: five } = sessionPort(before.session, before.instrument, { instrumentOnPage: true });
    expect(five.state().reflectionLimit).toBeUndefined();
  }, T);

  it("the chooser back to bank 5 gives the fit back; undo of the switch does too", () => {
    const before = onFive();
    const six = landData(before, toDataBank(before, 6, GSA6), `Loaded data ${NAME}, bank 6`, "chooser").page;
    // Back by the chooser: the instrument follows to bank 5, the curves calculate.
    const back = landData(six, toDataBank(six, 5, GSA6), `Loaded data ${NAME}, bank 5`, "chooser").page;
    expect(back.session.rawInstrument!.bank).toBe(5);
    expect(pageReflectionLimit(back.session, null)).toBeNull();
    expect(Math.max(...powderPageCurves(back.session, null).curves.yCalc)).toBeGreaterThan(0);
    // Undo: the step before the switch, restored as App.goToStep does.
    let history = recordStep(null, { kind: "load", label: "Bank 5", structures: [structure], workspace: workspaceOf(before) });
    history = recordStep(history, { kind: "load", label: "Data bank 5 → 6, refinement values kept", structures: [structure], workspace: workspaceOf(six) });
    const step = restoreStep(history, undoTarget(history)!);
    const undone = sessionFromPowderWorkspace(step.workspace as PowderWorkspace, [...snapProjectStructures(step.structures, step.workspace).structures]);
    expect(undone.session.rawData!.bank).toBe(5);
    expect(pageReflectionLimit(undone.session, null)).toBeNull();
    expect(Math.max(...powderPageCurves(undone.session, null).curves.yCalc)).toBeGreaterThan(0);
  }, T);
});

describe("the sentence", () => {
  it("names the bank and its instrument file when the file has no bank for it; the data and a matching file otherwise", () => {
    const over = { dMin: 0.03904, limit: "scan" as const, count: 1.5e8, max: 6e7 };
    expect(reflectionLimitSentence(over, { dataBank: 6, uncovered: true })).toBe(
      "Bank 6's data at this instrument calibration reach d 0.039 Å: 1.5×10⁸ hkl to scan, over the limit. Load the instrument file for bank 6, or narrow the window.",
    );
    expect(reflectionLimitSentence(over, { dataBank: null, uncovered: false })).toBe(
      "The data at this instrument calibration reach d 0.039 Å: 1.5×10⁸ hkl to scan, over the limit. Load a matching instrument file, or narrow the window.",
    );
    expect(reflectionLimitSentence({ dMin: 0.0123, limit: "index", count: 2100, max: 2047 }, { dataBank: null, uncovered: false })).toContain("reach d 0.012 Å: Miller indices up to 2100, over the limit.");
    expect(reflectionLimitSentence({ dMin: 0.3, limit: "families", count: 300_001, max: 300_000 }, { dataBank: 2, uncovered: false })).toBe(
      "Bank 2's data at this instrument calibration reach d 0.300 Å: more than 3×10⁵ reflections, over the limit. Load a matching instrument file, or narrow the window.",
    );
    expect(timesTen(1.503e8)).toBe("1.5×10⁸");
    expect(timesTen(6e7)).toBe("6×10⁷");
  });
});

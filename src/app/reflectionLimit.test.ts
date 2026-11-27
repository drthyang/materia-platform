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
import { withInstrumentFile, withPattern, withStructure, emptyPage, type PowderPage } from "@/app/powderPage";
import { bankCoverage } from "@/app/bankFollow";
import { tofWidthNote } from "@/app/tofWidthNote";
import { pageReflectionLimit, reflectionLimitSentence, timesTen, withinReflectionLimit } from "@/app/reflectionLimit";
import { ReflectionLimitError } from "@/core/diffraction/reflections";
import { tofReflectionsLeftOut } from "@/core/workflow/powder";
import { appliedPhases } from "@/app/shortD";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { NOMAD_STYLE_BANKS, multiBankGsa } from "@/testSupport/instprmFixtures";

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

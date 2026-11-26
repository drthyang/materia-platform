import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseInstrumentFile, parseInstrumentParameters } from "@/parsers/instrument";
import { fileProfileCardNote, fileProfileNote } from "@/app/tofWidthNote";

/**
 * The Instrument card's fold of the GSAS-II profile line (owner, 11-27): the
 * card shows "Profile as the file gives it, held." and the sample-row
 * sentence leads its "?". fileProfileNote, which get_state and the report
 * read, keeps its text.
 */
const INSTPRM = readFileSync("scripts/tof-profile/fixtures/synthetic_three_banks.instprm", "utf8");
const SAMPLE = "Sample rows start at GSAS-II's defaults (Lorentzian microstrain 1000, size 1 µm), which a GSAS-II calibration assumes.";

describe("the Instrument card's GSAS-II profile line, folded", () => {
  it("shows the short line; the moved sentence starts the detail; the agent-read note is unchanged", () => {
    const inst = parseInstrumentParameters(INSTPRM, 2);
    const note = fileProfileNote(inst, null)!;
    const card = fileProfileCardNote(inst, null)!;
    expect(note.line).toBe(`Profile as the file gives it, held. ${SAMPLE}`);
    expect(card.line).toBe("Profile as the file gives it, held.");
    expect(card.detail).toBe(`${SAMPLE} ${note.detail}`);
  });

  it("keeps the trailing \"Not used: the pdabc table.\" on the visible line", () => {
    const bank = parseInstrumentFile(INSTPRM).banks[1]!;
    const withPdabc = { ...bank, extras: { ...bank.extras, pdabc: true } } as typeof bank;
    const note = fileProfileNote(withPdabc.parameters, withPdabc)!;
    const card = fileProfileCardNote(withPdabc.parameters, withPdabc)!;
    expect(note.line).toBe(`Profile as the file gives it, held. ${SAMPLE} Not used: the pdabc table.`);
    expect(card.line).toBe("Profile as the file gives it, held. Not used: the pdabc table.");
    expect(card.detail.startsWith(SAMPLE)).toBe(true);
  });

  it("leaves a FullProf note and a file without a profile as they are", () => {
    expect(fileProfileCardNote({ kind: "tof", difC: 3800 }, null)).toBeNull();
  });
});

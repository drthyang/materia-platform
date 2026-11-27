import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseInstrumentFile, parseInstrumentParameters } from "@/parsers/instrument";
import { fileProfileCardNote, fileProfileNote } from "@/app/tofWidthNote";
import { calNumber } from "@/app/calibrationText";

/**
 * The Instrument card's profile line (hub, 11-27): the card shows "Profile
 * held", and the note's whole line and detail are behind its "?".
 * fileProfileNote, which get_state and the report read, keeps its text.
 */
const INSTPRM = readFileSync("scripts/tof-profile/fixtures/synthetic_three_banks.instprm", "utf8");
const SAMPLE = "Sample rows start at GSAS-II's defaults (Lorentzian microstrain 1000, size 1 µm), which a GSAS-II calibration assumes.";

describe("the Instrument card's profile line", () => {
  it("shows the short line; the whole note is its detail; the agent-read note is unchanged", () => {
    const inst = parseInstrumentParameters(INSTPRM, 2);
    const note = fileProfileNote(inst, null)!;
    const card = fileProfileCardNote(inst, null)!;
    expect(note.line).toBe(`Profile as the file gives it, held. ${SAMPLE}`);
    expect(card.line).toBe("Profile held");
    expect(card.detail).toBe(`${note.line} ${note.detail}`);
  });

  it("moves the trailing \"Not used: the pdabc table.\" into the detail", () => {
    const bank = parseInstrumentFile(INSTPRM).banks[1]!;
    const withPdabc = { ...bank, extras: { ...bank.extras, pdabc: true } } as typeof bank;
    const note = fileProfileNote(withPdabc.parameters, withPdabc)!;
    const card = fileProfileCardNote(withPdabc.parameters, withPdabc)!;
    expect(note.line).toBe(`Profile as the file gives it, held. ${SAMPLE} Not used: the pdabc table.`);
    expect(card.line).toBe("Profile held");
    expect(card.detail).toBe(`${note.line} ${note.detail}`);
    expect(card.detail).toContain("Not used: the pdabc table.");
  });

  it("a file without a profile has no line", () => {
    expect(fileProfileCardNote({ kind: "tof", difC: 3800 }, null)).toBeNull();
  });
});

describe("the Instrument card's calibration numbers", () => {
  it("two decimals with a real minus sign; two significant figures below 0.01", () => {
    expect(calNumber(-23.07639352718455)).toBe("−23.08");
    expect(calNumber(-3.2)).toBe("−3.20");
    expect(calNumber(0)).toBe("0.00");
    expect(calNumber(1.5)).toBe("1.50");
    expect(calNumber(-0.0012345)).toBe("−0.0012");
  });
});

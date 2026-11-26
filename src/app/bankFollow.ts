/**
 * The instrument follows the data's bank (owner, 2026-11-27): with an
 * instrument file of several banks on the page, a change of the data's bank
 * switches the instrument to the file's bank for it (by number, checked
 * against the DIFC the data file states, bankChoice.matchingInstrumentBank),
 * in the same History step; the old bank's refined instrument rows give way
 * to the new bank's file values. A data bank the file has no bank for keeps
 * the page's instrument, and Refine is held until the user loads that bank's
 * file or takes the old bank's parameters as a starting point, a choice the
 * Instrument card, the Validation view and the report then state for as long
 * as it holds. Pure: the shell and the cards call these.
 */

import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { RefinementParameter } from "@/core/refinement/types";
import type { Session } from "@/app/powderSession";
import { withInstrumentFile, type PowderPage } from "@/app/powderPage";
import { parameterGroupOf } from "@/app/ui/parameterGroups";
import {
  DIFC_TOLERANCE, currentDataBank, currentInstrumentBank, dataBankRef, dataBanksOf, hasBankChoice, instrumentFileOf, matchingInstrumentBank,
  uncoveredDataBank, type UncoveredBank,
} from "@/app/bankChoice";
import { defaultInstrumentInUse } from "@/app/defaultInstruments";

// ── following the data's bank ──────────────────────────────────────────────

/** The History step of a switch: "Instrument bank 3, following data bank 3". */
export function followStepLabel(bank: number, dataBank: number): string {
  return `Instrument bank ${bank}, following data bank ${dataBank}`;
}

/** The highlight on the Instrument card and the switched rows, until the next action. */
export function followNote(bank: number): string {
  return `Instrument switched to bank ${bank} with the data bank`;
}

/** A switch made: the page with the new bank on it. */
export interface BankFollow {
  readonly page: PowderPage;
  /** The instrument bank now on the page. */
  readonly bank: number;
  /** The data bank it follows. */
  readonly dataBank: number;
}

/**
 * The page with its instrument on the bank of the data now on it, or null
 * when there is nothing to switch: no instrument file with banks to choose
 * between, data that name no bank, a file with no bank for the data's
 * (`bankCoverage` then holds Refine), or the instrument already on it. The
 * file is read again on that bank as the Instrument card's chooser does
 * (powderPage.withInstrumentFile): the instrument rows take the new bank's
 * file values, the structure stays where the last fit left it, and a
 * default shipped with the app stays a default.
 */
export function followDataBank(p: PowderPage): BankFollow | null {
  const raw = p.session.rawInstrument;
  if (!p.instrumentLoaded || !raw) return null;
  const file = instrumentFileOf(raw.text);
  if (!hasBankChoice(file)) return null;
  const data = dataBankRef(currentDataBank(dataBanksOf(p.session.rawData?.text), p.session.rawData));
  const match = data ? matchingInstrumentBank(file, data) : null;
  if (!data || !match || match.bank === null) return null;
  if (currentInstrumentBank(file, raw, p.instrument)?.bank === match.bank) return null;
  const { page } = withInstrumentFile(p, raw.name, raw.text, {
    bank: match.bank,
    ...(raw.bundledDefault !== undefined ? { bundledDefault: raw.bundledDefault } : {}),
  });
  return { page, bank: match.bank, dataBank: data.bank };
}

/** The Instrument / profile rows a switch changed: new, or at another value than before it. */
export function switchedRows(before: readonly RefinementParameter[], after: readonly RefinementParameter[]): readonly string[] {
  const was = new Map(before.map((p) => [p.id, p.value]));
  return after.filter((p) => parameterGroupOf(p.kind) === "Instrument / profile" && was.get(p.id) !== p.value).map((p) => p.id);
}

// ── a data bank the file has no bank for ──────────────────────────────────

/** The page's data bank against its instrument file, when the file has no bank for it. */
export interface BankCoverage {
  readonly uncovered: UncoveredBank;
  /** The user took the held bank's parameters as a starting point for this data bank: Refine runs, with the standing warning. */
  readonly startingPoint: boolean;
}

/** From the parts the page already has read (the Instrument card's memos). */
export function coverageOf(uncovered: UncoveredBank | null, rawInstrument: Session["rawInstrument"]): BankCoverage | null {
  return uncovered ? { uncovered, startingPoint: rawInstrument?.startingPointFor === uncovered.dataBank } : null;
}

/** From the session's files (the report, the Agent's headless page). */
export function bankCoverage(session: Pick<Session, "rawData" | "rawInstrument">, instrument: InstrumentParameters, instrumentLoaded: boolean): BankCoverage | null {
  const raw = session.rawInstrument;
  if (!instrumentLoaded || !raw) return null;
  const file = instrumentFileOf(raw.text);
  const data = dataBankRef(currentDataBank(dataBanksOf(session.rawData?.text), session.rawData));
  return coverageOf(uncoveredDataBank(file, currentInstrumentBank(file, raw, instrument), data), raw);
}

const heldName = (u: UncoveredBank): string => (u.instrumentBank !== null ? `bank ${u.instrumentBank}` : "the file's one bank");
const heldNameCap = (u: UncoveredBank): string => (u.instrumentBank !== null ? `Bank ${u.instrumentBank}` : "The file's one bank");
const fileBanksText = (u: UncoveredBank): string => (u.fileBanks.length > 1 ? `banks ${u.fileBanks.join(", ")}` : "one bank");
/** What places the peaks: "DIFC and Zero" (time of flight), "the wavelength and Zero" (constant wavelength). */
const calib = (u: UncoveredBank): string => (u.instrumentDifC !== undefined ? "DIFC and Zero" : "the wavelength and Zero");
/** The rows to free first. */
const calibRows = (u: UncoveredBank): string => (u.instrumentDifC !== undefined ? "the TOF difC and Zero rows" : "the Zero row (and check the wavelength)");

/** " (its difC 1440.0 is 72 % from the data's DIFC 5134.6)", when both are known. */
function offText(u: UncoveredBank): string {
  if (u.dataDifC === undefined || u.instrumentDifC === undefined) return "";
  const off = Math.abs(u.instrumentDifC - u.dataDifC) / Math.abs(u.dataDifC);
  return ` (its difC ${u.instrumentDifC.toFixed(1)} is ${(off * 100).toFixed(off < 0.1 ? 1 : 0)} % from the data's DIFC ${u.dataDifC.toFixed(1)})`;
}

/** The Instrument card while Refine is held, with its two ways on. */
export interface HoldNote {
  readonly line: string;
  readonly detail: string;
  /** Opens the file picker for the bank's own file. */
  readonly loadLabel: string;
  /** The explicit override. */
  readonly overrideLabel: string;
}

export function holdNote(u: UncoveredBank): HoldNote {
  return {
    line: `Refine is off: no instrument bank for data bank ${u.dataBank}, and another bank's calibration gives wrong peak positions.`,
    detail: `This instrument file has ${fileBanksText(u)}${u.dataDifC !== undefined ? `, none with a difC within ${DIFC_TOLERANCE * 100} % of the data's DIFC ${u.dataDifC.toFixed(1)}` : `, no bank ${u.dataBank}`}. The page still holds ${heldName(u)}'s parameters${offText(u)}: they place the peaks at the wrong d, and a fit would push the error into the cell, the zero and the profile. Load the instrument file of data bank ${u.dataBank}, choose a data bank the file covers, or start from ${heldName(u)}'s parameters: then refine ${calib(u)} and check the peak positions.`,
    loadLabel: `Load instrument for bank ${u.dataBank}…`,
    overrideLabel: `Use ${heldName(u)}'s parameters as a starting point`,
  };
}

/** The History step of the override. */
export function startingPointStepLabel(u: UncoveredBank): string {
  return `${heldNameCap(u)}'s parameters as a starting point for data bank ${u.dataBank}`;
}

/** The standing warning while the override holds: the card's line and "?", the Validation view, the report and an exported bundle. */
export interface StartingPointWarning {
  readonly line: string;
  readonly detail: string;
  readonly report: string;
}

export function startingPointWarning(u: UncoveredBank): StartingPointWarning {
  return {
    line: `${heldNameCap(u)}'s parameters, a starting point for data bank ${u.dataBank}: refine ${calib(u)}, and check the peak positions.`,
    detail: `The instrument file has no bank for data bank ${u.dataBank}, and you chose to start from ${heldName(u)}'s parameters${offText(u)}. Another bank's calibration places the peaks at the wrong d: free ${calibRows(u)} in the first refinements, and check the calculated peak positions against the observed ones across the whole pattern before you trust the cell. The peak-shape terms are ${heldName(u)}'s too. Load the instrument file of data bank ${u.dataBank} when you have it; this line goes with it.`,
    report: `${heldNameCap(u)}'s parameters, used as a starting point for data bank ${u.dataBank}, which the instrument file does not cover${offText(u)}: ${calib(u)} must be refined and the peak positions checked against the observed ones; the peak-shape terms are ${heldName(u)}'s.`,
  };
}

// ── what the Copilot reads ─────────────────────────────────────────────────

/** get_state's lines on the instrument's standing (agent/powderTools.ts), and the reason `refine` is refused while Refine is held. */
export interface AgentInstrumentNotes {
  /** A default shipped with the app is in use. */
  readonly defaultParameters?: string;
  /** Refine is held: the data's bank has no bank in the instrument file. */
  readonly refineHeld?: string;
  /** The user took another bank's parameters as a starting point. */
  readonly startingPoint?: string;
}

export function agentInstrumentNotes(rawInstrument: Session["rawInstrument"], instrumentLoaded: boolean, coverage: BankCoverage | null): AgentInstrumentNotes | undefined {
  const d = defaultInstrumentInUse(rawInstrument, instrumentLoaded);
  const u = coverage?.uncovered;
  const notes: AgentInstrumentNotes = {
    ...(d ? { defaultParameters: d.agent } : {}),
    ...(u && !coverage.startingPoint
      ? { refineHeld: `Refine is held: data bank ${u.dataBank} has no bank in the instrument file (it has ${fileBanksText(u)}), and ${heldName(u)}'s calibration, which the page holds, gives wrong peak positions${offText(u)}. The user can load the instrument file for bank ${u.dataBank}, choose a data bank the file covers, or choose on the Instrument card to start from ${heldName(u)}'s parameters.` }
      : {}),
    ...(u && coverage.startingPoint
      ? { startingPoint: `${heldNameCap(u)}'s parameters, used as a starting point for data bank ${u.dataBank}, which the instrument file does not cover (the user's choice)${offText(u)}: ${calibRows(u)} must be refined and the calculated peak positions checked against the observed ones; the peak-shape terms are ${heldName(u)}'s.` }
      : {}),
  };
  return Object.keys(notes).length > 0 ? notes : undefined;
}

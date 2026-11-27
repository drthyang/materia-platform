/**
 * The instrument follows the data's bank (owner, 2026-11-26): with an
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
import type { PowderLiveState } from "@/agent/port";
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

/** The History step of a new data file the instrument followed: "Loaded data x.gsa, bank 1 · instrument bank 1". */
export function loadFollowStepLabel(dataLabel: string, bank: number): string {
  return `${dataLabel} · instrument bank ${bank}`;
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

const pctOff = (difC: number, dataDifC: number): string => {
  const off = Math.abs(difC - dataDifC) / Math.abs(dataDifC);
  return `${(off * 100).toFixed(off < 0.1 ? 1 : 0)} %`;
};

/** "; bank 1's difC 1439.6 is 71 % from the data's DIFC 840.0", when both are known (the owner's wording for get_state's startingPoint). */
function heldOffText(u: UncoveredBank): string {
  if (u.dataDifC === undefined || u.instrumentDifC === undefined) return "";
  return `; ${heldName(u)}'s difC ${u.instrumentDifC.toFixed(1)} is ${pctOff(u.instrumentDifC, u.dataDifC)} from the data's DIFC ${u.dataDifC.toFixed(1)}`;
}

/** A bank of the file the override can start from, with how far its difC is from the data's DIFC when both are known. */
export interface StartingBank {
  readonly bank: number;
  readonly difC?: number;
  /** "71 %": |difC − DIFC| / DIFC. */
  readonly off?: string;
  /** "Bank 1 · difC 1439.6 · 71 % from the data's DIFC" (time of flight), "Bank 1" otherwise. */
  readonly label: string;
}

/** The file's banks as the override's chooser lists them, in the file's order. */
export function startingBanks(u: UncoveredBank): readonly StartingBank[] {
  return u.fileDifC.map((b) => {
    const off = b.difC !== undefined && u.dataDifC !== undefined ? pctOff(b.difC, u.dataDifC) : undefined;
    return {
      bank: b.bank,
      ...(b.difC !== undefined ? { difC: b.difC } : {}),
      ...(off !== undefined ? { off } : {}),
      label: `Bank ${b.bank}${b.difC !== undefined ? ` · difC ${b.difC.toFixed(1)}` : ""}${off !== undefined ? ` · ${off} from the data's DIFC` : ""}`,
    };
  });
}

/**
 * The bank the override offers: the one whose difC is closest to the data's
 * own DIFC (the lower-numbered of two equally close), else, with no DIFC to
 * compare, the bank the page holds.
 */
export function closestBank(u: UncoveredBank): StartingBank | null {
  const banks = startingBanks(u);
  const dataDifC = u.dataDifC;
  const withDifC = dataDifC !== undefined ? banks.filter((b) => b.difC !== undefined) : [];
  if (withDifC.length > 0) return withDifC.reduce((best, b) => (Math.abs(b.difC! - dataDifC!) < Math.abs(best.difC! - dataDifC!) ? b : best));
  return banks.find((b) => b.bank === u.instrumentBank) ?? banks[0] ?? null;
}

/** " (the closest is bank 1's: difC 1439.6, 71 % from the data's DIFC 840.0)", when the data state a DIFC. */
function closestText(u: UncoveredBank): string {
  const c = closestBank(u);
  return c && c.difC !== undefined && c.off !== undefined && u.dataDifC !== undefined
    ? ` (the closest is bank ${c.bank}'s: difC ${c.difC.toFixed(1)}, ${c.off} from the data's DIFC ${u.dataDifC.toFixed(1)})`
    : "";
}

/** The Instrument card while Refine is held, with its two ways on. */
export interface HoldNote {
  readonly line: string;
  readonly detail: string;
  /** Opens the file picker for the bank's own file. */
  readonly loadLabel: string;
  /** The override's chooser, the closest bank first chosen. */
  readonly banks: readonly StartingBank[];
  readonly closest: StartingBank | null;
}

export function holdNote(u: UncoveredBank): HoldNote {
  return {
    line: `Refine is off: no instrument bank for data bank ${u.dataBank}, and another bank's calibration gives wrong peak positions.`,
    detail: `This instrument file has ${fileBanksText(u)}${u.dataDifC !== undefined ? `, none with a difC within ${DIFC_TOLERANCE * 100} % of the data's DIFC ${u.dataDifC.toFixed(1)}` : `, no bank ${u.dataBank}`}. The page still holds ${heldName(u)}'s parameters${offText(u)}: they place the peaks at the wrong d, and a fit would push the error into the cell, the zero and the profile. Load the instrument file of data bank ${u.dataBank}, choose a data bank the file covers, or start from another bank's parameters${closestText(u)}: then refine ${calib(u)} and check the peak positions.`,
    loadLabel: `Load instrument for bank ${u.dataBank}…`,
    banks: startingBanks(u),
    closest: closestBank(u),
  };
}

/** The override's button for the bank chosen. */
export function overrideLabel(bank: number): string {
  return `Use bank ${bank}'s parameters as a starting point`;
}

/** The History step of the override. */
export function startingPointStepLabel(bank: number, dataBank: number): string {
  return `Bank ${bank}'s parameters as a starting point for data bank ${dataBank}`;
}

/**
 * The override taken: the file's bank `bank` on the page (read again as the
 * Instrument card's chooser does, when it is not the bank there now) and
 * the choice kept with the file (`startingPointFor`). Null when the page has
 * no data bank the file lacks, or the file no such bank.
 */
export function withStartingPoint(p: PowderPage, bank: number): PowderPage | null {
  const coverage = bankCoverage(p.session, p.instrument, p.instrumentLoaded);
  const raw = p.session.rawInstrument;
  if (!coverage || !raw || !coverage.uncovered.fileBanks.includes(bank)) return null;
  const on = coverage.uncovered.instrumentBank === bank
    ? p
    : withInstrumentFile(p, raw.name, raw.text, { bank, ...(raw.bundledDefault !== undefined ? { bundledDefault: raw.bundledDefault } : {}) }).page;
  return { ...on, session: { ...on.session, rawInstrument: { ...on.session.rawInstrument!, startingPointFor: coverage.uncovered.dataBank } } };
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
      ? { refineHeld: `Refine is held: data bank ${u.dataBank} has no bank in the instrument file (it has ${fileBanksText(u)}), and ${heldName(u)}'s calibration, which the page holds, gives wrong peak positions${offText(u)}. The user can load the instrument file for bank ${u.dataBank}, choose a data bank the file covers, or choose on the Instrument card to start from another bank's parameters${closestText(u)}.` }
      : {}),
    ...(u && coverage.startingPoint
      ? { startingPoint: `${heldNameCap(u)}'s parameters are the starting point for data bank ${u.dataBank}, which the instrument file does not cover (the user's choice${heldOffText(u)}): ${calibRows(u)} must be refined and the calculated peak positions checked against the observed ones; the peak-shape terms are ${heldName(u)}'s and may not match this bank's peak widths.` }
      : {}),
  };
  return Object.keys(notes).length > 0 ? notes : undefined;
}

/**
 * The README statement of an exported bundle on the instrument file, when it
 * is not the measurement's own calibration: a default shipped with the app,
 * another bank's parameters taken as a starting point, or both; null for a
 * user's file on its own bank.
 */
export function bundleInstrumentNote(rawInstrument: Session["rawInstrument"], instrumentLoaded: boolean, coverage: BankCoverage | null): string | null {
  const d = defaultInstrumentInUse(rawInstrument, instrumentLoaded);
  const parts = [
    ...(d ? [d.report] : []),
    ...(coverage?.startingPoint ? [startingPointWarning(coverage.uncovered).report] : []),
  ];
  return parts.length > 0 ? parts.join(" ") : null;
}

/** The files as the Agent's port gives them (port.ts `files`): the data and the instrument file, each with the bank the page reads. */
export function agentFiles(rawData: Session["rawData"], rawInstrument: Session["rawInstrument"]): { files?: NonNullable<PowderLiveState["files"]> } {
  const file = (f: { name: string; text: string; bank?: number } | undefined) => (f ? { name: f.name, text: f.text, ...(f.bank !== undefined ? { bank: f.bank } : {}) } : undefined);
  const data = file(rawData), instrument = file(rawInstrument);
  return data || instrument ? { files: { ...(data ? { data } : {}), ...(instrument ? { instrument } : {}) } } : {};
}

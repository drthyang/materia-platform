/**
 * Files with several banks, one bank at a time: which bank of a GSAS histogram
 * the Data card reads, which bank of a GSAS-II `.instprm` the Instrument card
 * applies, how the two are paired, and what the card says of the values a file
 * has that the calculation does not use. Pure: the cards and the shell call
 * these; nothing here changes the profile or a number of the fit.
 *
 * A joint refinement of several banks is not part of this: the page holds one
 * pattern and one instrument.
 */

import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { MustrainModel } from "@/core/workflow/powderModelOptions";
import { minMax } from "@/core/math/extent";
import { isGsasHistogram, parseGsasHistogram, type GsasBank } from "@/parsers/gsasHistogram";
import { defaultInstrumentBank, parseInstrumentFile, type InstrumentBank, type InstrumentFile } from "@/parsers/instrument";

/** A file as the session keeps it, with the bank read from it when it has several. */
export interface BankedFile {
  readonly name: string;
  readonly text: string;
  readonly bank?: number;
}

/** One entry of a bank chooser. */
export interface BankOption {
  readonly bank: number;
  readonly label: string;
}

// ── data ───────────────────────────────────────────────────────────────────

/** The banks of a GSAS histogram file, one per bank number (the first of a repeated number, as the reader takes it); null for any other file. */
export function dataBanksOf(text: string | undefined): readonly GsasBank[] | null {
  if (!text || !isGsasHistogram(text)) return null;
  try {
    const seen = new Set<number>();
    return parseGsasHistogram(text).banks.filter((b) => b.points.length > 0 && !seen.has(b.bankNumber) && !!seen.add(b.bankNumber));
  } catch {
    return null;
  }
}

/** The bank a multi-bank data file opens on: bank 1, or the file's first bank when it has no bank 1. */
export function defaultDataBank(banks: readonly GsasBank[]): GsasBank {
  return banks.find((b) => b.bankNumber === 1) ?? banks[0]!;
}

/** The bank of the data on the page: the one chosen, else the one the reader takes by itself (the file's first). Null for data without banks. */
export function currentDataBank(banks: readonly GsasBank[] | null, raw: BankedFile | undefined): GsasBank | null {
  if (!banks || banks.length === 0) return null;
  return (raw?.bank !== undefined ? banks.find((b) => b.bankNumber === raw.bank) : undefined) ?? banks[0]!;
}

/** "Bank 3 · 2999 points · TOF 733–21991 µs". */
export function dataBankLabel(b: GsasBank): string {
  const { min, max } = minMax(b.points.map((p) => p.x));
  const range = b.xUnit === "tof" ? `TOF ${min.toFixed(0)}–${max.toFixed(0)} µs` : `2θ ${trim(min, 2)}–${trim(max, 2)}°`;
  return `Bank ${b.bankNumber} · ${b.points.length} points · ${range}`;
}

/** The Data card's chooser: the file's banks, or null when it has one bank or none. */
export function dataBankOptions(banks: readonly GsasBank[] | null): readonly BankOption[] | null {
  if (!banks || banks.length < 2) return null;
  return banks.map((b) => ({ bank: b.bankNumber, label: dataBankLabel(b) }));
}

// ── instrument ─────────────────────────────────────────────────────────────

/** An instrument file's banks, or null when the text cannot be read as one. */
export function instrumentFileOf(text: string | undefined): InstrumentFile | null {
  if (!text) return null;
  try {
    return parseInstrumentFile(text);
  } catch {
    return null;
  }
}

/** A file whose banks can be chosen between: more than one, each with a number. */
export function hasBankChoice(file: InstrumentFile | null): file is InstrumentFile {
  return !!file && file.banks.length > 1 && file.banks.every((b) => b.bank !== null);
}

/** A number without trailing zeros, to at most `digits` decimals. */
function trim(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}

/** "Bank 3 · 2θ 65° · difC 5612" (TOF), "Bank 2 · λ 1.54 Å" (constant wavelength). */
export function instrumentBankLabel(b: InstrumentBank): string {
  const p = b.parameters;
  const parts = [
    `Bank ${b.bank ?? "–"}`,
    ...(b.extras.twoTheta !== undefined ? [`2θ ${trim(b.extras.twoTheta, 1)}°`] : []),
    p.kind === "tof" ? `difC ${p.difC.toFixed(0)}` : `λ ${trim(p.wavelength, 5)} Å`,
  ];
  return parts.join(" · ");
}

/** The Instrument card's chooser, or null for a one-bank file. */
export function instrumentBankOptions(file: InstrumentFile | null): readonly BankOption[] | null {
  if (!hasBankChoice(file)) return null;
  return file.banks.map((b) => ({ bank: b.bank!, label: instrumentBankLabel(b) }));
}

const sameCalibration = (a: InstrumentParameters, b: InstrumentParameters): boolean =>
  a.kind === "tof" && b.kind === "tof" ? a.difC === b.difC && (a.zero ?? 0) === (b.zero ?? 0)
    : a.kind === "constantWavelength" && b.kind === "constantWavelength" ? a.wavelength === b.wavelength && (a.zero ?? 0) === (b.zero ?? 0)
      : false;

/**
 * The bank of the file the page's instrument is: the one recorded with the
 * file, else (a project saved before the bank was recorded, which took the
 * file's last bank) the bank whose calibration the instrument has.
 */
export function currentInstrumentBank(file: InstrumentFile | null, raw: BankedFile | undefined, instrument: InstrumentParameters): InstrumentBank | null {
  if (!file) return null;
  if (raw?.bank !== undefined) {
    const recorded = file.banks.find((b) => b.bank === raw.bank);
    if (recorded) return recorded;
  }
  if (file.banks.length === 1) return file.banks[0]!;
  return file.banks.find((b) => sameCalibration(b.parameters, instrument)) ?? null;
}

// ── pairing the two ────────────────────────────────────────────────────────

/** What the data on the page say of their bank. */
export interface DataBankRef {
  readonly bank: number;
  /** The DIFC the data file's own comment lines give for this bank, when they do. */
  readonly difC?: number;
}

export function dataBankRef(b: GsasBank | null): DataBankRef | null {
  return b ? { bank: b.bankNumber, ...(b.meta?.difC !== undefined ? { difC: b.meta.difC } : {}) } : null;
}

/** An instrument bank's difC may differ from the data's own DIFC by this fraction before the page says so (calibrations of the same bank differ by under 1 %). */
export const DIFC_TOLERANCE = 0.03;

const difCOf = (b: InstrumentBank): number | undefined => (b.parameters.kind === "tof" ? b.parameters.difC : undefined);
const relDiff = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

/**
 * The instrument bank that belongs to the data's bank, or null when the file
 * has none. Paired by bank number; when the data file states its own DIFC, the
 * pairing is checked against it: a same-numbered bank whose difC is more than
 * DIFC_TOLERANCE off is not the data's, and the bank with the closest difC
 * within the tolerance is. (The bank angle is not used: files number and
 * describe their banks differently.)
 */
export function matchingInstrumentBank(file: InstrumentFile, data: DataBankRef | null): InstrumentBank | null {
  if (!data) return null;
  const sameNumber = file.banks.find((b) => b.bank === data.bank) ?? null;
  if (data.difC === undefined) return sameNumber;
  const within = (b: InstrumentBank): boolean => difCOf(b) !== undefined && relDiff(difCOf(b)!, data.difC!) <= DIFC_TOLERANCE;
  if (sameNumber && (difCOf(sameNumber) === undefined || within(sameNumber))) return sameNumber;
  const close = file.banks.filter(within).sort((a, b) => relDiff(difCOf(a)!, data.difC!) - relDiff(difCOf(b)!, data.difC!));
  return close[0] ?? null;
}

/** The bank an instrument file opens on: the data's bank when the file has it, else the lowest-numbered bank, as GSAS-II. */
export function openingInstrumentBank(file: InstrumentFile, data: DataBankRef | null): InstrumentBank {
  return matchingInstrumentBank(file, data) ?? defaultInstrumentBank(file);
}

/** A line for the Instrument card when the instrument is not the data bank's, with the bank to offer when the file has the right one. */
export interface BankAdvice {
  /** One plain line. */
  readonly line: string;
  /** The details, behind "?". */
  readonly detail: string;
  /** The bank a button offers to switch to. */
  readonly offer?: BankOption;
}

/**
 * Whether the instrument on the page belongs to the data's bank. Null when it
 * does, or when the data name no bank. Never switches anything: the card
 * offers the right bank, the user takes it.
 */
export function bankAdvice(file: InstrumentFile | null, current: InstrumentBank | null, data: DataBankRef | null): BankAdvice | null {
  if (!file || !current || !data) return null;
  const match = matchingInstrumentBank(file, data);
  if (match && match.bank === current.bank) return null;
  const curDifC = difCOf(current);
  const dataDifC = data.difC;
  const off = dataDifC !== undefined && curDifC !== undefined ? relDiff(curDifC, dataDifC) : undefined;
  const offText = off !== undefined && off > DIFC_TOLERANCE
    ? ` Its difC ${curDifC!.toFixed(1)} is ${(off * 100).toFixed(off < 0.1 ? 1 : 0)} % from the data's DIFC ${dataDifC!.toFixed(1)}, so peaks are placed at the wrong d.`
    : "";
  const curName = current.bank !== null ? `bank ${current.bank}` : "the file's one bank";
  if (match) {
    return {
      line: `Data are bank ${data.bank}; the instrument is ${curName}.`,
      detail: `The data file's bank ${data.bank} pairs with this instrument file's bank ${match.bank}${dataDifC !== undefined ? " (by bank number, checked against the DIFC the data file states)" : " (the same bank number)"}; the page uses ${curName}.${offText} Nothing is switched for you: use the button, or pick a bank in the list.`,
      offer: { bank: match.bank!, label: `Use bank ${match.bank}` },
    };
  }
  // A one-bank instrument file for data that state no DIFC: nothing to check it against.
  if (file.banks.length === 1 && (off === undefined || off <= DIFC_TOLERANCE)) return null;
  const banks = file.banks.map((b) => b.bank).filter((n): n is number => n !== null);
  return {
    line: `No instrument bank for data bank ${data.bank}: ${curName} is not its calibration.`,
    detail: `This instrument file has ${banks.length > 1 ? `banks ${banks.join(", ")}` : "one bank"}${dataDifC !== undefined ? `, none with a difC within ${DIFC_TOLERANCE * 100} % of the data's DIFC ${dataDifC.toFixed(1)}` : `, no bank ${data.bank}`}. The page keeps ${curName}'s parameters, which belong to another bank.${offText} Load the instrument file of this bank, or choose a data bank the file covers.`,
  };
}

// ── what a file has that the page does not use ─────────────────────────────

/** The fixed isotropic microstrain a TOF page starts with (app/powderSpec.ts), ×10⁻⁶. */
const TOF_MICROSTRAIN_SEED = 1500;

export interface UnusedNote {
  /** One plain line: what the file has that the calculation leaves out. */
  readonly line: string;
  /** What happens to each of the file's terms on load, behind "?". */
  readonly detail: string;
}

/**
 * What the loaded bank has that the calculated pattern does not use, or null
 * when there is nothing of the kind. States what the page does today
 * (app/powderSpec.ts, core/workflow/structureRefinement.ts, core/workflow/powder.ts);
 * it changes none of it.
 */
export function unusedNote(bank: InstrumentBank | null, mustrain: MustrainModel | undefined): UnusedNote | null {
  if (!bank) return null;
  const e = bank.extras;
  const p = bank.parameters;
  const lorentz = ([["X", e.lorentzX], ["Y", e.lorentzY], ["Z", e.lorentzZ]] as const).filter(([, v]) => v !== undefined && v !== 0);
  if (p.kind === "tof") {
    // A FullProf .irf names the same terms its own way: γ = Gam-2·d² + Gam-1·d + Gam-0 is GSAS-II's Y, X, Z.
    const irf = bank.format === "irf";
    const lorentzNames = irf ? { X: "Gam-1", Y: "Gam-2", Z: "Gam-0" } : { X: "X", Y: "Y", Z: "Z" };
    const sig1Name = irf ? "Sig-1" : "sig-1";
    // sig-1 has a row only under the generalized (Stephens) microstrain model; otherwise an isotropic microstrain stands in for the d² term.
    const sig1Dropped = (mustrain ?? "isotropic") !== "generalized" && p.sig1 !== undefined && p.sig1 !== 0;
    const items = [
      ...(lorentz.length > 0 ? [`Lorentzian ${lorentz.map(([k]) => lorentzNames[k]).join(", ")}`] : []),
      ...(sig1Dropped ? [sig1Name] : []),
      ...(e.pdabc ? ["the pdabc table"] : []),
      ...(e.profileTable ? ["the tabulated profile"] : []),
      ...(e.thermal ? ["the thermal branch"] : []),
      ...(e.zeroDecay ? ["ALFBE (all zero)"] : []),
    ];
    if (items.length === 0) return null;
    const used = irf
      ? "Used as read, negative values included, and held fixed until you free them: Zero, Dtt1 (as difC), Dtt2 (difA), Dtt_1overD (difB), alph0, alph1, beta0, beta1, Sig-0, Sig-2: the same functions of d as in FullProf's NPROF 9, in µs and Å, no conversion."
      : "Used as read, negative values included, and held fixed until you free them: difC, difA, difB, Zero, alpha, beta-0, beta-1, beta-q, sig-0, sig-2, sig-q.";
    const detail = [
      ...(lorentz.length > 0 ? [`The time-of-flight peak here is two exponentials convolved with a Gaussian, with no Lorentzian part, so the file's ${lorentz.map(([k, v]) => `${lorentzNames[k]} = ${v}`).join(", ")} are read and left out (${irf ? "FullProf adds a Lorentzian of width Gam-2·d² + Gam-1·d + Gam-0" : "GSAS-II adds a Lorentzian of width X·d + Y·d² + Z"}).`] : []),
      ...(sig1Dropped ? [`${sig1Name} = ${p.sig1} is left out while the microstrain model is isotropic: a Gaussian microstrain of ${TOF_MICROSTRAIN_SEED} × 10⁻⁶, held fixed, takes the place of the d² width term. The generalized microstrain model brings the ${sig1Name} row back with the file's value.`] : []),
      ...(e.pdabc ? ["The tabulated profile (pdabc) is not read."] : []),
      ...(e.profileTable ? ["The file's tabulated profile (its LIST_… lines) is not read."] : []),
      ...(e.thermal ? [`${e.thermal} is not used: the page has one TOF-to-d relation, the file's epithermal line.`] : []),
      ...(e.zeroDecay ? ["The ALFBE line is four zeros, which is no peak shape, so the rise and decay start from the page's generic values (α₁ = 1.5, β₀ = 0.02)."] : []),
      used,
      "Where the Gaussian variance of a peak comes out negative it is set to 10⁻⁶ µs².",
      irf ? "TWOTH and TOFRG are read and not used in the calculation." : "2-theta, fltPath and Azimuth are read and not used in the calculation.",
      ...(e.reading ? [`Calibration line: ${e.reading}.`] : []),
    ];
    return { line: `Not used: ${items.join("; ")}.`, detail: detail.join(" ") };
  }
  if (lorentz.length === 0 || e.lorentzZ === undefined || e.lorentzZ === 0) return null;
  return {
    line: "Not used: Lorentzian Z.",
    detail: `The profile has the Lorentzian X and Y of the file and no constant term, so Z = ${e.lorentzZ} is read and left out.`,
  };
}

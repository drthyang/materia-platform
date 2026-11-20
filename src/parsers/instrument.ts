/**
 * Parser for instrument parameters, accepting the GSAS-II `.instprm` `key:value`
 * format (one block per bank, `;`-joined pairs, and lenient `key value` /
 * `key=value` variants), the classic GSAS `.prm` and the FullProf `.irf`
 * resolution format. Recognizes the TOF calibration (difC/difA/difB/Zero) and
 * constant-wavelength (Lam/wavelength + Caglioti U,V,W). Keys the app has no
 * use for are kept as text on the bank (`texts`), not dropped.
 */

import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { recognizeInstrument, facilityLabel } from "@/parsers/instrumentRegistry";

/**
 * This app's internal Caglioti U,V,W are **FWHM² coefficients** in centidegrees²
 * (FWHM² = U·tan²θ + V·tanθ + W; see `gaussianFwhm` in diffraction/profile.ts,
 * which takes the √ directly). Two source conventions must be normalised to it:
 *
 *  - FullProf U,V,W are FWHM² in **degrees²** → ×10⁴ (1° = 100 cdeg, squared).
 *    Verified: D1B (1.614, −1.077, 0.363) → FWHM ≈ 0.43° at 2θ = 40°.
 *  - GSAS / GSAS-II U,V,W give the Gaussian **variance σ²** in centidegrees²
 *    (GSAS-II: σ² = U tan²θ + V tanθ + W, FWHM_G = √(8 ln2)·σ), so they must be
 *    ×8 ln2 to become FWHM². Without this the Gaussian is √(8 ln2) ≈ 2.35× too
 *    narrow — negligible once U,V,W refine, but fatal to the *seed* for
 *    high-resolution data (e.g. synchrotron 11-BM peaks came out ~2.5 m° instead
 *    of the real ~6–10 m°, collapsing the scale so the calc never matched).
 */
const FP_UVW_DEG2_TO_CENTIDEG2 = 1e4;
const GSAS_SIG2_TO_FWHM2 = 8 * Math.log(2); // σ² → FWHM² (≈ 5.545)

/** True for a FullProf `.irf` resolution file (keyword-led lines, not key:value). */
function looksLikeFullProfIrf(text: string): boolean {
  return /^\s*(JOBT|PROF|WAVE|THRG|GEOM|TOFRG|D2TOF|NPROF)\b/im.test(text);
}

/** Numeric tokens of a line, or [] if it is a comment / keyword-led line. */
function numericLine(line: string): number[] {
  const t = line.trim();
  if (t === "" || t.startsWith("!") || /^[A-Za-z]/.test(t)) return [];
  const nums = t.split(/\s+/).map(Number);
  return nums.every(Number.isFinite) ? nums : [];
}

/** Value(s) after a FullProf keyword line, e.g. `WAVE 2.524 2.524 1.0`. */
function irfKeyword(text: string, key: string): number[] | null {
  const m = text.match(new RegExp(`^\\s*${key}\\s+(.+)$`, "im"));
  if (!m) return null;
  return m[1]!.trim().split(/\s+/).map(Number).filter(Number.isFinite);
}

/**
 * Parse a FullProf `.irf`. Constant-wavelength files (WAVE + a bare U V W X Y Z
 * line, e.g. D1B/D20) become a CW instrument with Caglioti U,V,W; TOF files
 * (D2TOF: Dtt1 Dtt2 Dtt_1overD Zero) become a TOF calibration. The numerical
 * per-d profile table (NPROF 9) is not consumed — only the calibration is.
 */
function parseFullProfIrf(text: string): InstrumentParameters {
  const d2tof = irfKeyword(text, "D2TOF");
  if (d2tof && d2tof.length >= 1) {
    const [dtt1, dtt2, dtt1overD, zero] = d2tof;
    return {
      kind: "tof",
      difC: dtt1!,
      ...(dtt2 !== undefined ? { difA: dtt2 } : {}),
      ...(dtt1overD !== undefined ? { difB: dtt1overD } : {}),
      ...(zero !== undefined ? { zero } : {}),
    };
  }

  const wave = irfKeyword(text, "WAVE");
  if (wave && wave.length >= 1) {
    const jobt = text.match(/^\s*JOBT\s+([A-Za-z]+)/im)?.[1]?.toUpperCase();
    const radiationKind: "neutron" | "xray" | undefined =
      jobt?.startsWith("NEUT") ? "neutron" : jobt?.startsWith("XR") ? "xray" : undefined;
    // The Caglioti row is the first bare numeric line with ≥3 values (U V W …).
    const uvw = text.split(/\r?\n/).map(numericLine).find((n) => n.length >= 3);
    const zero = irfKeyword(text, "ZER")?.[0];
    return {
      kind: "constantWavelength",
      ...(radiationKind !== undefined ? { radiationKind } : {}),
      wavelength: wave[0]!,
      ...kAlpha2Of(radiationKind, wave[0]!, wave[1], wave[2]),
      ...(zero !== undefined ? { zero } : {}),
      ...(uvw ? {
        u: uvw[0]! * FP_UVW_DEG2_TO_CENTIDEG2,
        v: uvw[1]! * FP_UVW_DEG2_TO_CENTIDEG2,
        w: uvw[2]! * FP_UVW_DEG2_TO_CENTIDEG2,
      } : {}),
    };
  }

  throw new Error("FullProf .irf: neither a WAVE (CW) nor a D2TOF (TOF) calibration found");
}

/**
 * True for a classic GSAS instrument-parameter file: the column-formatted `INS`
 * records (`HTYPE`, `ICONS`, `PRCF…`), as written by GSAS and by GSAS-II's
 * "export → GSAS instrument". Distinct from the GSAS-II `.instprm` `key:value`
 * format, which has no `INS` prefix and no `ICONS` record.
 */
function looksLikeGsasPrm(text: string): boolean {
  return /^INS\b/m.test(text) && /\bICONS\b/.test(text);
}

/**
 * Parse a classic GSAS `.prm`/`.inst` instrument file. `HTYPE`'s 2nd/3rd letters
 * give the radiation (N/X) and CW-vs-TOF (C/T); `ICONS` carries the wavelength +
 * zero (CW) or difC/difA/Zero (TOF). For CW the Gaussian profile terms GU,GV,GW —
 * the first three coefficients of the first `PRCF` row, already in GSAS
 * centidegrees² (this app's convention, so no scaling) — seed the Caglioti U,V,W.
 * GSAS's CW zero is in centidegrees; this app's CW zero is in degrees (÷100).
 */
function parseGsasPrm(text: string): InstrumentParameters {
  const lines = text.split(/\r?\n/);
  // Text after a named field on its `INS …` record (fixed columns, so slice by
  // the keyword rather than tokenising the bank/flag columns before it).
  const after = (name: string): string | undefined => {
    for (const l of lines) {
      if (!/^INS\b/.test(l)) continue;
      const i = l.indexOf(name);
      if (i >= 0) return l.slice(i + name.length);
    }
    return undefined;
  };
  const nums = (s: string | undefined): number[] =>
    s ? s.trim().split(/\s+/).map(Number).filter(Number.isFinite) : [];

  const htype = after("HTYPE")?.trim().split(/\s+/)[0]?.toUpperCase();
  // ICONS is fixed 10-column: for CW  lam1 lam2 zero [trans] POLA IPOLA …; for
  // TOF  difC difA Zero. Read the leading values by whitespace (robust to spacing)
  // but the polarization by fixed column — field 4 (transmission) is often blank,
  // so only the column position reliably locates POLA.
  const iconsRaw = after("ICONS") ?? "";
  const icons = nums(iconsRaw);
  const iconsCol = (n: number): number | undefined => {
    const f = iconsRaw.slice(n * 10, n * 10 + 10).trim();
    if (f === "") return undefined;
    const v = Number(f);
    return Number.isFinite(v) ? v : undefined;
  };
  const radiationKind: "neutron" | "xray" | undefined =
    htype?.[1] === "X" ? "xray" : htype?.[1] === "N" ? "neutron" : undefined;
  // CW-vs-TOF from HTYPE's 3rd letter; fall back to the ICONS magnitude (difC is
  // in the hundreds–thousands, a wavelength is < ~10 Å).
  const isTof = htype ? htype[2] === "T" : icons.length > 0 && (icons[0] ?? 0) > 50;

  if (isTof) {
    const [difC, difA, zero] = icons;
    if (difC === undefined) throw new Error("GSAS .prm: TOF ICONS record has no difC");
    return {
      kind: "tof",
      difC,
      ...(difA ? { difA } : {}),
      ...(zero !== undefined ? { zero } : {}),
    };
  }

  const lam1 = icons[0];
  if (lam1 === undefined || lam1 <= 0) throw new Error("GSAS .prm: CW ICONS record has no wavelength");
  // A lab tube's Kα₂: λ₂ in field 2 and the Kα₂/Kα₁ ratio in columns 55–65
  // (where GSAS-II reads it). A blank ratio is the usual 0.5.
  const lam2 = iconsCol(1);
  const kRatioField = iconsRaw.slice(55, 65).trim();
  const kRatio = kRatioField === "" ? 0.5 : Number(kRatioField);
  const zeroCentideg = icons[2];
  // First PRCF coefficient row (e.g. `PRCF11`): GU GV GW (GP) for CW profile
  // functions 1–4 — the first three are the Gaussian Caglioti terms.
  // PRCF row 1 (`PRCF11`): GU GV GW (GP) — the Gaussian Caglioti terms. PRCF row 2
  // (`PRCF12`): LX LY (S/L H/L) — the Lorentzian broadening (GSAS X, Y; unlike the
  // Gaussian σ² these are already FWHM coefficients, so no 8 ln2 factor). The
  // Lorentzian is the instrument's *calibrated* resolution — seeding it (rather
  // than an arbitrary X=1) is what lets sharp synchrotron peaks fit.
  const prcfRow1 = lines.find((l) => /PRCF11\b/.test(l));
  const uvw = prcfRow1 ? nums(prcfRow1.slice(prcfRow1.search(/PRCF11/) + "PRCF11".length)) : [];
  const prcfRow2 = lines.find((l) => /PRCF12\b/.test(l));
  const lxy = prcfRow2 ? nums(prcfRow2.slice(prcfRow2.search(/PRCF12/) + "PRCF12".length)) : [];
  // The profile type (`PRCF1  3  19 …`): types 3 and 4 put the FCJ asymmetry
  // S/L and H/L after LX, LY on PRCF12 (11-BM: 0.0011 each).
  const prcfHead = lines.find((l) => /PRCF1\s/.test(l));
  const prcfType = prcfHead ? nums(prcfHead.slice(prcfHead.search(/PRCF1\s/) + "PRCF1".length))[0] : undefined;
  const asym = (prcfType === 3 || prcfType === 4) && lxy.length >= 4 && (lxy[2]! > 0 || lxy[3]! > 0) ? { sl: lxy[2]!, hl: lxy[3]! } : undefined;
  // POLA (fixed-column field 5) is the X-ray polarization fraction for the Lp
  // correction; ~0.99 for a synchrotron like 11-BM, 0.5 for an unpolarized tube.
  const pola = iconsCol(4);
  return {
    kind: "constantWavelength",
    ...(radiationKind !== undefined ? { radiationKind } : {}),
    wavelength: lam1,
    ...(zeroCentideg ? { zero: zeroCentideg / 100 } : {}),
    ...(uvw.length >= 3 ? {
      u: uvw[0]! * GSAS_SIG2_TO_FWHM2,
      v: uvw[1]! * GSAS_SIG2_TO_FWHM2,
      w: uvw[2]! * GSAS_SIG2_TO_FWHM2,
    } : {}),
    ...(lxy.length >= 2 ? { x: lxy[0]!, y: lxy[1]! } : {}),
    ...(asym ? { asymmetry: asym } : {}),
    ...(radiationKind === "xray" && pola !== undefined && pola > 0 && pola <= 1 ? { polarization: pola } : {}),
    ...kAlpha2Of(radiationKind, lam1, lam2, kRatio),
  };
}

/** The Kα₂ field of an X-ray instrument: present when λ₂ is a second line
 *  (FullProf writes λ₂ = λ₁ for a monochromator) with a positive ratio. */
function kAlpha2Of(radiationKind: "xray" | "neutron" | undefined, lam1: number, lam2: number | undefined, ratio: number | undefined): { kAlpha2?: { wavelength: number; ratio: number } } {
  if (radiationKind !== "xray" || lam2 === undefined || !(lam2 > 0) || ratio === undefined || !(ratio > 0)) return {};
  if (Math.abs(lam2 - lam1) <= 1e-6 * lam1) return {};
  return { kAlpha2: { wavelength: lam2, ratio } };
}

/** The number a value starts with (`1439.6`, `-5.3e2`, `.5`), or NaN. GSAS-II reads the whole value with Python's float(). */
function leadingNumber(value: string): number {
  const m = value.match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
  return m ? Number(m[0]) : NaN;
}

/** One block of `key:value` lines: a bank of a GSAS-II `.instprm`, or a whole file that has no bank header. */
interface KeyValueBlock {
  /** The number on the `#Bank N:` header; null for lines under no bank header. */
  readonly bank: number | null;
  /** Each value as the file writes it, by the file's own key. */
  readonly texts: Map<string, string>;
  /** The numeric values, by lower-cased key. */
  readonly values: Map<string, number>;
  /** Keys whose value spans several lines between triple quotes (GSAS-II `pdabc`). */
  readonly multiline: string[];
}

/**
 * The bank number of a `#Bank N: …` header line, by GSAS-II's own rule
 * (`GSASIIfiles.ReadInstprm`): a line that starts with `#` and contains `Bank`
 * is a bank header, and its number is the second blank-separated word of the
 * text before the first colon. Whatever follows the colon is ignored. A `#`
 * line that names no integer there is null (a comment here; GSAS-II stops with
 * an error on one that contains `Bank`).
 */
function bankHeaderNumber(line: string): number | null {
  if (!line.startsWith("#") || !line.includes("Bank")) return null;
  const word = line.split(":")[0]!.trim().split(/\s+/)[1];
  return word !== undefined && /^[+-]?\d+$/.test(word) ? parseInt(word, 10) : null;
}

/**
 * Read `key:value` text as GSAS-II reads an `.instprm`: `#Bank N:` headers
 * start a bank's block; a line may join several pairs with `;`; line ends may
 * be CRLF; keys come in any order (the last value of a repeated key wins, as
 * in GSAS-II's dict); a value between triple quotes runs over several lines.
 * More lenient than GSAS-II in three ways, for hand-written files: `key value`
 * and `key=value` are accepted, a number may be followed by other text, and a
 * comment line is skipped wherever it stands (GSAS-II stops reading a block at
 * a `#` line after the first value, and fails on two comment lines in a row).
 * Of two blocks with the same bank number the first is kept, as in GSAS-II.
 */
function readBlocks(text: string): KeyValueBlock[] {
  const blocks: KeyValueBlock[] = [];
  const open = (bank: number | null): KeyValueBlock => {
    const block: KeyValueBlock = { bank, texts: new Map(), values: new Map(), multiline: [] };
    blocks.push(block);
    return block;
  };
  let block: KeyValueBlock | null = null;
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      const bank = bankHeaderNumber(line);
      if (bank !== null) block = open(bank);
      continue;
    }
    block ??= open(null);
    // A multi-line value (`pdabc:"""` … `"""`): its lines are not key:value pairs.
    const delim = line.includes('"""') ? '"""' : line.includes("'''") ? "'''" : null;
    if (delim) {
      const key = line.split(":")[0]!.trim();
      if (key) block.multiline.push(key);
      while (++i < lines.length && !lines[i]!.includes(delim)) { /* skip the value's lines */ }
      continue;
    }
    for (const part of line.split(";")) {
      // Keys may carry a dot, slash, hyphen or parentheses (GSAS-II `Polariz.`,
      // `SH/L`, `beta-0`, `sig-1`, `I(L2)/I(L1)`).
      const m = part.trim().match(/^([A-Za-z0-9_./()-]+)\s*(?:[:=]|\s)\s*(\S.*)$/);
      if (!m) continue;
      const value = m[2]!.trim();
      block.texts.set(m[1]!, value);
      const number = leadingNumber(value);
      if (!Number.isNaN(number)) block.values.set(m[1]!.toLowerCase(), number);
    }
  }
  const seen = new Set<number | null>();
  return blocks.filter((b) => b.texts.size > 0 && !seen.has(b.bank) && !!seen.add(b.bank));
}

/** GSAS-II's histogram type of a block (`Type:PNT`), upper-cased. */
function gsasType(block: KeyValueBlock): string | undefined {
  for (const [key, value] of block.texts) if (key.toLowerCase() === "type") return value.match(/^[A-Za-z0-9]+/)?.[0]?.toUpperCase();
  return undefined;
}

/**
 * What an instrument file holds for one bank that the app reads but does not
 * use in the calculated pattern: kept so that nothing in the file is lost on
 * read, and so the page can say what it leaves out. Raw values, in the file's
 * own units.
 */
export interface InstrumentFileExtras {
  /** The bank's scattering angle 2θ (degrees), GSAS-II `2-theta` of a TOF bank. */
  readonly twoTheta?: number;
  /** Total flight path (m), GSAS-II `fltPath`. */
  readonly flightPath?: number;
  /** GSAS-II `Azimuth` (degrees). */
  readonly azimuth?: number;
  /**
   * Lorentzian terms the profile has no place for. A TOF bank's `X`, `Y`, `Z`
   * (GSAS-II: γ = X·d + Y·d² + Z, µs): this app's TOF peak has no Lorentzian.
   * A constant-wavelength file's `Z` (centidegrees); its X and Y are used and
   * are on the parameters.
   */
  readonly lorentzX?: number;
  readonly lorentzY?: number;
  readonly lorentzZ?: number;
  /** The file carries a tabulated TOF profile (GSAS-II `pdabc`), which is not read. */
  readonly pdabc?: true;
}

/** One bank of an instrument file. */
export interface InstrumentBank {
  /**
   * The bank number: the `#Bank N:` header's, else the file's own `Bank`
   * value, else null (a file that names none; also a `.prm` or an `.irf`).
   */
  readonly bank: number | null;
  /** The instrument as the app uses it. */
  readonly parameters: InstrumentParameters;
  /** GSAS-II's histogram type (`PNT`, `PXC`, …), when the file gives one. */
  readonly type?: string;
  /** Values read and kept, not used in the calculation. */
  readonly extras: InstrumentFileExtras;
  /** Every `key:value` of the bank as the file writes it (a GSAS-II `.instprm` only). */
  readonly texts: ReadonlyMap<string, string>;
}

/** An instrument file as read: every bank it holds, in file order. */
export interface InstrumentFile {
  readonly banks: readonly InstrumentBank[];
}

/**
 * Every bank of an instrument file. A GSAS-II `.instprm` written by "Save all
 * profile" holds one block per bank; any other file is one bank.
 */
export function parseInstrumentFile(text: string): InstrumentFile {
  const named = (inst: InstrumentParameters): InstrumentParameters => withRecognizedName(text, inst);
  if (looksLikeFullProfIrf(text)) return { banks: [{ bank: null, parameters: named(parseFullProfIrf(text)), extras: {}, texts: new Map() }] };
  if (looksLikeGsasPrm(text)) return { banks: [{ bank: null, parameters: named(parseGsasPrm(text)), extras: {}, texts: new Map() }] };
  const banks: InstrumentBank[] = [];
  for (const block of readBlocks(text)) {
    const parameters = blockParameters(block);
    if (!parameters) continue;
    const type = gsasType(block);
    banks.push({
      bank: block.bank ?? integerOrNull(block.values.get("bank")),
      parameters: named(parameters),
      ...(type !== undefined ? { type } : {}),
      extras: blockExtras(block, parameters.kind),
      texts: block.texts,
    });
  }
  if (banks.length === 0) throw new Error("Instrument file has neither difC (TOF) nor a wavelength (CW)");
  return { banks };
}

function integerOrNull(v: number | undefined): number | null {
  return v !== undefined && Number.isInteger(v) ? v : null;
}

/**
 * The bank a multi-bank file opens on, as in GSAS-II: the bank with the data's
 * own bank number when the data carry one and the file has it, else the file's
 * lowest-numbered bank (`sorted(banklist)[0]` in `ReadInstprm`).
 */
export function defaultInstrumentBank(file: InstrumentFile, dataBank?: number | null): InstrumentBank {
  const match = dataBank !== undefined && dataBank !== null ? file.banks.find((b) => b.bank === dataBank) : undefined;
  if (match) return match;
  const numbered = file.banks.filter((b) => b.bank !== null).sort((a, b) => a.bank! - b.bank!);
  return numbered[0] ?? file.banks[0]!;
}

/** The bank with this number, or undefined. */
export function instrumentBank(file: InstrumentFile, bank: number | null): InstrumentBank | undefined {
  return file.banks.find((b) => b.bank === bank);
}

/**
 * One instrument from a file. Of a multi-bank GSAS-II `.instprm` this is the
 * bank asked for (an error when the file has no such bank), else the file's
 * lowest-numbered bank, GSAS-II's default.
 */
export function parseInstrumentParameters(text: string, bank?: number): InstrumentParameters {
  const file = parseInstrumentFile(text);
  if (bank === undefined) return defaultInstrumentBank(file).parameters;
  const chosen = instrumentBank(file, bank);
  if (!chosen) throw new Error(`Bank ${bank} not found in the instrument file (it has ${file.banks.map((b) => (b.bank === null ? "one unnumbered bank" : `bank ${b.bank}`)).join(", ")})`);
  return chosen.parameters;
}

/** Attach the beamline name + facility label if the header names a known instrument. */
function withRecognizedName(text: string, inst: InstrumentParameters): InstrumentParameters {
  const known = recognizeInstrument(text);
  if (!known) return inst;
  return { ...inst, name: known.name, facility: facilityLabel(known) };
}

function blockExtras(block: KeyValueBlock, kind: InstrumentParameters["kind"]): InstrumentFileExtras {
  const v = block.values;
  type NumericExtra = Exclude<keyof InstrumentFileExtras, "pdabc">;
  const has = (key: string, as: NumericExtra): Partial<Record<NumericExtra, number>> => (v.get(key) !== undefined ? { [as]: v.get(key)! } : {});
  return {
    ...(kind === "tof" ? { ...has("2-theta", "twoTheta"), ...has("fltpath", "flightPath"), ...has("x", "lorentzX"), ...has("y", "lorentzY") } : {}),
    ...has("azimuth", "azimuth"),
    ...has("z", "lorentzZ"),
    ...(block.multiline.some((k) => k.toLowerCase() === "pdabc") ? { pdabc: true as const } : {}),
  };
}

/** A block's instrument, or null when it has neither difC (TOF) nor a wavelength (CW). */
function blockParameters(block: KeyValueBlock): InstrumentParameters | null {
  const v = block.values;
  const type = gsasType(block);
  const difC = v.get("difc");
  if (difC !== undefined) {
    const params: Extract<InstrumentParameters, { kind: "tof" }> = {
      kind: "tof",
      difC,
      ...(v.get("difa") !== undefined ? { difA: v.get("difa")! } : {}),
      ...(v.get("difb") !== undefined ? { difB: v.get("difb")! } : {}),
      ...(v.get("zero") !== undefined ? { zero: v.get("zero")! } : {}),
      // Back-to-back-exponential shape calibration (GSAS-II .instprm keys).
      ...(v.get("alpha") !== undefined ? { alpha: v.get("alpha")! } : {}),
      ...(v.get("beta-0") !== undefined ? { beta0: v.get("beta-0")! } : {}),
      ...(v.get("beta-1") !== undefined ? { beta1: v.get("beta-1")! } : {}),
      ...(v.get("beta-q") !== undefined ? { betaQ: v.get("beta-q")! } : {}),
      ...(v.get("sig-0") !== undefined ? { sig0: v.get("sig-0")! } : {}),
      ...(v.get("sig-1") !== undefined ? { sig1: v.get("sig-1")! } : {}),
      ...(v.get("sig-2") !== undefined ? { sig2: v.get("sig-2")! } : {}),
      // GSAS-II sig-q is the σ² term LINEAR in d (GSASIImath.getTOFsig), as is MATERIA's sigQ.
      ...(v.get("sig-q") !== undefined ? { sigQ: v.get("sig-q")! } : {}),
    };
    return params;
  }
  const lam = v.get("lam") ?? v.get("lam1") ?? v.get("wavelength") ?? v.get("lambda");
  if (lam !== undefined) {
    const radiationKind = type?.includes("X") ? "xray" : type?.includes("N") ? "neutron" : undefined;
    return {
      kind: "constantWavelength",
      ...(radiationKind !== undefined ? { radiationKind } : {}),
      wavelength: lam,
      ...(v.get("zero") !== undefined ? { zero: v.get("zero")! } : {}),
      ...(v.get("u") !== undefined ? { u: v.get("u")! * GSAS_SIG2_TO_FWHM2 } : {}),
      ...(v.get("v") !== undefined ? { v: v.get("v")! * GSAS_SIG2_TO_FWHM2 } : {}),
      ...(v.get("w") !== undefined ? { w: v.get("w")! * GSAS_SIG2_TO_FWHM2 } : {}),
      // Lorentzian X, Y are already FWHM coefficients (no 8 ln2), the instrument's
      // calibrated size/strain broadening — seed them so sharp peaks fit on load.
      ...(v.get("x") !== undefined ? { x: v.get("x")! } : {}),
      ...(v.get("y") !== undefined ? { y: v.get("y")! } : {}),
      // GSAS-II refines one SH/L = (S + H)/L, S and H taken equal.
      ...(v.get("sh/l")! > 0 ? { asymmetry: { sl: v.get("sh/l")! / 2, hl: v.get("sh/l")! / 2 } } : {}),
      ...(v.get("polariz.") !== undefined ? { polarization: v.get("polariz.")! } : {}),
      ...kAlpha2Of(radiationKind, lam, v.get("lam2"), v.get("i(l2)/i(l1)") ?? 0.5),
    };
  }
  return null;
}

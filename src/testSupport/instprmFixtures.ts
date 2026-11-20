/**
 * Synthetic GSAS-II `.instprm` files for the reader's tests: made-up numbers in
 * the layouts GSAS-II writes. No value here comes from a real instrument.
 *
 *  - FIVE_BANK_INSTPRM: a "Save all profile" file: five `#Bank N:` blocks, CRLF
 *    line ends, the keys in a different order in each block, negative sig-0 and
 *    sig-1, a large sig-q, a non-zero Lorentzian on some banks.
 *  - SEMICOLON_CW_INSTPRM, SEMICOLON_TOF_INSTPRM: several `key:value` pairs on
 *    a line joined by `;`, the layout of GSAS-II's own default parameter sets.
 *  - SINGLE_BANK_INSTPRM: one bank, one key per line, no bank header.
 */

/** One bank's values as the file writes them (text, so a test can compare digit for digit). */
export type BankText = Readonly<Record<string, string>>;

const HEADER = "GSAS-II instrument parameter file; do not add/delete items!";

/** The five banks' values, by bank number. Made up. */
export const FIVE_BANKS: Readonly<Record<number, BankText>> = {
  1: {
    Type: "PNT", Bank: "1.0", "2-theta": "154.0", fltPath: "21.5", Azimuth: "0.0",
    difC: "1500.25", difA: "-1.125", difB: "0.0", Zero: "-7.5",
    alpha: "0.25", "beta-0": "0.125", "beta-1": "0.02", "beta-q": "0.0",
    "sig-0": "-50.5", "sig-1": "260.75", "sig-2": "40.125", "sig-q": "0.0",
    X: "-0.875", Y: "0.375", Z: "0.0",
  },
  2: {
    Type: "PNT", Bank: "2.0", "2-theta": "31.0", fltPath: "21.25", Azimuth: "0.0",
    difC: "2850.5", difA: "3.625", difB: "0.0", Zero: "4.75",
    alpha: "2.125", "beta-0": "0.11", "beta-1": "0.04", "beta-q": "0.0",
    "sig-0": "170.25", "sig-1": "870.5", "sig-2": "21.25", "sig-q": "-580.75",
    X: "14.0", Y: "-4.875", Z: "0.0",
  },
  3: {
    Type: "PNT", Bank: "3.0", "2-theta": "65.0", fltPath: "20.75", Azimuth: "0.0",
    difC: "5612.5", difA: "2.25", difB: "0.5", Zero: "-3.125",
    alpha: "1.5", "beta-0": "0.09", "beta-1": "0.03", "beta-q": "-0.1675",
    "sig-0": "-206.5", "sig-1": "-91.75", "sig-2": "12.5", "sig-q": "788.25",
    X: "0.0", Y: "0.0", Z: "0.0",
  },
  4: {
    Type: "PNT", Bank: "4.0", "2-theta": "120.5", fltPath: "20.5", Azimuth: "0.0",
    difC: "8650.75", difA: "-0.5", difB: "0.0", Zero: "1.25e1",
    alpha: "0.75", "beta-0": "0.05", "beta-1": "0.015", "beta-q": "0.0",
    "sig-0": "12.0", "sig-1": "-5.25E+01", "sig-2": "3.5", "sig-q": "2150.5",
    X: "2.5", Y: "0.0", Z: "-0.25",
  },
  5: {
    Type: "PNT", Bank: "5.0", "2-theta": "15.0", fltPath: "22.0", Azimuth: "0.0",
    difC: "1401.5", difA: "0.0", difB: "0.0", Zero: "0.0",
    alpha: "3.0", "beta-0": "0.2", "beta-1": "0.06", "beta-q": "0.0",
    "sig-0": "0.0", "sig-1": "1200.0", "sig-2": "0.0", "sig-q": "0.0",
    X: "0.0", Y: "0.0", Z: "0.0",
  },
};

/** The keys of a bank in a fixed, bank-dependent order (a rotation of the sorted keys, then every other key swapped). */
function mixedOrder(keys: readonly string[], bank: number): string[] {
  const sorted = [...keys].sort();
  const shift = (bank * 7) % sorted.length;
  const rotated = [...sorted.slice(shift), ...sorted.slice(0, shift)];
  return bank % 2 === 0 ? rotated.reverse() : rotated;
}

/** A "Save all profile" file of these banks, in the order given. */
export function multiBankInstprm(banks: Readonly<Record<number, BankText>>, order: readonly number[], eol = "\r\n"): string {
  const lines: string[] = [];
  for (const n of order) {
    const values = banks[n]!;
    lines.push(`#Bank ${n}: ${HEADER}`);
    for (const key of mixedOrder(Object.keys(values), n)) lines.push(`${key}:${values[key]}`);
  }
  return lines.join(eol) + eol;
}

/** Five banks, CRLF, keys in mixed order. */
export const FIVE_BANK_INSTPRM = multiBankInstprm(FIVE_BANKS, [1, 2, 3, 4, 5]);

/** A constant-wavelength lab-tube file in the layout of GSAS-II's default sets: pairs joined by `;`. */
export const SEMICOLON_CW_INSTPRM = [
  "#GSAS-II instrument parameter file for a made-up lab tube",
  "Type:PXC;Bank:1",
  "Lam1:1.25;Lam2:1.26;Zero:0.02;Polariz.:0.75;Azimuth:0.0;I(L2)/I(L1):0.45",
  "U:3.0;V:-1.5;W:4.0;X:0.5;Y:1.5;Z:0.25;SH/L:0.004",
  "",
].join("\n");

/** A TOF file in the same `;`-joined layout. */
export const SEMICOLON_TOF_INSTPRM = [
  "#GSAS-II instrument parameter file for a made-up TOF bank",
  "Type:PNT;Bank:1;fltPath:30.0;2-theta:90.0",
  "difC:7500.5;difA:-0.75;difB:0.25;Zero:1.5",
  "alpha:1.25;beta-0:0.03;beta-1:0.01;beta-q:0.0",
  "sig-0:5.0;sig-1:-30.0;sig-2:2.0;sig-q:10.0;X:1.0;Y:0.5;Z:0.0",
  "",
].join("\n");

/** One bank, one key per line, no bank header: the layout the reader has always taken. */
export const SINGLE_BANK_INSTPRM = [
  `#${HEADER}`,
  "Type:PNT",
  "Bank:2.0",
  "2-theta:90.0",
  "fltPath:60.5",
  "difC:22500.5",
  "difA:-1.5",
  "difB:0.0",
  "Zero:2.25",
  "alpha:1.0",
  "beta-0:0.04",
  "beta-1:0.01",
  "beta-q:0.0",
  "sig-0:0.0",
  "sig-1:-80.0",
  "sig-2:120.0",
  "sig-q:0.0",
  "X:0.0",
  "Y:0.0",
  "Z:0.0",
  "",
].join("\n");

/**
 * A synthetic multi-bank GSAS histogram (FXYE, SLOG) in the layout of a
 * reduction that writes each bank's geometry in comment lines above its BANK
 * record. Made-up counts: a flat level plus a few Gaussian bumps. `difC` per
 * bank goes in the `DIFC` comment; a bank given as `{ bank, difC: null }` gets
 * no comment lines. Line ends alternate CRLF and LF by bank, as mixed files do.
 */
export function multiBankGsa(banks: readonly { readonly bank: number; readonly difC: number | null; readonly tth?: number; readonly points?: number }[]): string {
  const out: string[] = ["Sample Run: 1 Vanadium Run: UNKNOWN Wavelength: 1.4 Angstrom\n", "# made-up multi-bank histogram\n", `# ${banks.length} Histograms\n`, "Monitor: 1\n"];
  banks.forEach((b, i) => {
    const eol = i % 2 === 0 ? "\r\n" : "\n";
    const n = b.points ?? 40 + 10 * i;
    const start = 500 + 100 * b.bank;
    const step = 0.004;
    if (b.difC !== null) {
      out.push(`# Total flight path   ${(20 + b.bank / 10).toFixed(3)}m, tth   ${(b.tth ?? 20 * b.bank).toFixed(3)}deg, DIFC ${b.difC.toFixed(9)} ${eol}`);
      out.push(`# Data for spectrum :${b.bank}${eol}`);
    }
    out.push(`BANK ${b.bank} ${n} ${n} SLOG ${start} ${Math.round(start * (1 + step) ** n)} ${step.toFixed(7)} 0 FXYE${eol}`);
    for (let j = 0; j < n; j++) {
      const x = start * (1 + step) ** j;
      const bump = 40 * Math.exp(-(((j - n / 2) / 2) ** 2));
      const y = 10 + b.bank + bump;
      out.push(`${x.toFixed(3).padStart(15)}${y.toFixed(4).padStart(15)}${Math.sqrt(y).toFixed(4).padStart(15)}${eol}`);
    }
  });
  return out.join("");
}

/** Six data banks whose DIFC line up with FIVE_BANKS' difC by bank number (within 1 %), and a bank 6 the instrument file does not have. */
export const SIX_BANK_GSA = multiBankGsa([
  { bank: 1, difC: 1490.5, tth: 15 },
  { bank: 2, difC: 2861.25, tth: 31 },
  { bank: 3, difC: 5606.5, tth: 65 },
  { bank: 4, difC: 8625.75, tth: 120.5 },
  { bank: 5, difC: 1399.25, tth: 150 },
  { bank: 6, difC: 836.25, tth: 8.5 },
]);

// ── FullProf TOF .irf (NPROF 9), made-up numbers, CRLF ─────────────────────

/** One bank of an `.irf` in the layout facilities write: comment lines naming the columns, then the keyword lines. */
function irfBank(o: {
  readonly bank: number; readonly calibrationComment?: string; readonly calibration: string; readonly twoTheta: number;
  readonly sigma: string; readonly gamma: string; readonly alfbe: string; readonly nprof?: number; readonly extra?: readonly string[];
}): string[] {
  return [
    `! ----------------------------------------------  Bank ${o.bank}  CWL =   1.5000A`,
    "!  Type of profile function: back-to-back exponentials * pseudo-Voigt ",
    `NPROF ${o.nprof ?? 9} `,
    "!       Tof-min(us)    step      Tof-max(us) ",
    "TOFRG    800      5.0000   14000.0000 ",
    ...(o.calibrationComment !== undefined ? [o.calibrationComment] : []),
    o.calibration,
    ...(o.extra ?? []),
    "!     TOF-TWOTH of the bank ",
    `TWOTH    ${o.twoTheta.toFixed(3)} `,
    "!       Sig-2     Sig-1     Sig-0 ",
    `SIGMA    ${o.sigma} `,
    "!       Gam-2     Gam-1     Gam-0 ",
    `GAMMA    ${o.gamma}`,
    "!          alph0       beta0       alph1       beta1 ",
    `ALFBE      ${o.alfbe} `,
    "END ",
  ];
}

const crlf = (lines: readonly string[]): string => lines.join("\r\n") + "\r\n";

/** Zero first, on a thermal-style keyword, in an NPROF 9 file: `ZD2TOT Zerot Dtt1t Dtt2t`. */
export const IRF_ZD2TOT = crlf(irfBank({
  bank: 3, calibrationComment: "!       Zerot    Dtt1t       Dtt2t     ", calibration: "ZD2TOT  -3.75   5606.5    2.125    ", twoTheta: 65,
  sigma: "12.5      -91.75      6.25", gamma: "1       0.5     0", alfbe: "1.25     0.085    2.5      0.0075",
}));

/** Three values on D2TOF, the zero last: `D2TOF Dtt1 Dtt2 Zero`, with a Lorentzian and an all-zero ALFBE. */
export const IRF_D2TOF_THREE = crlf(irfBank({
  bank: 2, calibrationComment: "!      Dtt1t       Dtt2t          Zerot   ", calibration: "D2TOF    2845.5    6.25   8.125   ", twoTheta: 31,
  sigma: "42.5    480.25    -24.0", gamma: "-5.0    34.5    -11.0 ", alfbe: " 0    0    0    0  ",
}));

/** The same three-value line with no comment line above it: the count alone decides. */
export const IRF_D2TOF_THREE_BARE = crlf(irfBank({
  bank: 2, calibration: "D2TOF    2845.5    6.25   8.125   ", twoTheta: 31,
  sigma: "42.5    480.25    -24.0", gamma: "0 0 0", alfbe: "0.5 0.04 1.5 0.01",
}));

/** Four values on D2TOF: `Dtt1 Dtt2 Dtt_1overD Zero`. */
export const IRF_D2TOF_FOUR = crlf(irfBank({
  bank: 1, calibrationComment: "!             Dtt1              Dtt2       Dtt_1overD         Zero", calibration: "D2TOF     22500.5         1.5         -0.75        -2.5", twoTheta: 90,
  sigma: "20.0 300.0 0.0", gamma: "0.0 5.5 0.0", alfbe: "0.0 0.03 0.1 0.01",
}));

/** Zero first on the epithermal keyword: `ZD2TOF Zero Dtt1 Dtt2`. */
export const IRF_ZD2TOF = crlf(irfBank({
  bank: 1, calibration: "ZD2TOF   1.25     7478.5   -1.5", twoTheta: 145,
  sigma: "0.0 49.0 6.0", gamma: "0.0 7.5 0.0", alfbe: "0.0 0.042 0.6 0.0095",
}));

/** Two banks in one file, separated by END. */
export const IRF_TWO_BANKS = crlf([
  "Instrumental resolution function of a made-up two-bank instrument",
  ...irfBank({ bank: 1, calibrationComment: "!        Dtt1          Dtt2        Zero", calibration: "D2TOF     1500.25     -1.125      -7.5", twoTheta: 154, sigma: "40.0 260.75 -50.5", gamma: "0 0 0", alfbe: "0.0 0.125 0.25 0.02" }),
  ...irfBank({ bank: 4, calibrationComment: "!        Dtt1          Dtt2        Zero", calibration: "D2TOF     8650.75     -0.5      12.5", twoTheta: 120.5, sigma: "3.5 -52.5 12.0", gamma: "0 2.5 -0.25", alfbe: "0.0 0.05 0.75 0.015" }),
]);

/** NPROF 10: an epithermal line and the thermal branch with its crossover. */
export const IRF_NPROF10 = crlf(irfBank({
  bank: 1, nprof: 10, calibrationComment: "!        Zero       Dtt1", calibration: "ZD2TOF   1.25     7478.5",
  extra: ["!       Zerot      Dtt1t        Dtt2t    x-cross    Width", "ZD2TOT   0.5     7459.75    19.95    1.25    2.375"],
  twoTheta: 145, sigma: "0.0 33.0 0.0", gamma: "0 0 0", alfbe: "1.5 2.5 -0.85 9.3",
}));

/** NPROF 10 with the thermal branch alone: a relation the app does not have. */
export const IRF_THERMAL_ONLY = crlf(irfBank({
  bank: 1, nprof: 10, calibration: "ZD2TOT   0.5     7459.75    19.95    1.25    2.375", twoTheta: 145, sigma: "0 33 0", gamma: "0 0 0", alfbe: "1.5 2.5 -0.85 9.3",
}));

/** A per-bank TOF data file as a reduction writes it: `#` header lines, then TOF, intensity, error; CRLF and trailing blanks. */
export function tofThreeColumnDat(points = 60): string {
  const rows = ["# Made-up sample at temperature 300.0 K.", "# File generated by a reduction script:", "# Instrument: MADEUP", "#TOF                  Is/Iv                   Error"];
  for (let i = 0; i < points; i++) {
    const tof = 720 * 1.0011 ** i;
    const y = 0.5 + 0.4 * Math.exp(-(((i - 30) / 3) ** 2));
    rows.push(`  ${tof.toFixed(9).padEnd(22)}${y.toFixed(9).padEnd(22)}${(0.02 + y / 50).toFixed(9)}                     `);
  }
  return rows.join("\r\n") + "\r\n";
}

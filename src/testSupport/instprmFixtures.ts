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
    Type: "PNT", Bank: "1.0", "2-theta": "20.0", fltPath: "30.5", Azimuth: "0.0",
    difC: "1210.5", difA: "-0.75", difB: "0.0", Zero: "-4.5",
    alpha: "0.4", "beta-0": "0.06", "beta-1": "0.011", "beta-q": "0.0",
    "sig-0": "-18.5", "sig-1": "140.25", "sig-2": "9.75", "sig-q": "0.0",
    X: "-0.5", Y: "0.625", Z: "0.0",
  },
  2: {
    Type: "PNT", Bank: "2.0", "2-theta": "40.0", fltPath: "30.25", Azimuth: "0.0",
    difC: "3320.25", difA: "1.875", difB: "0.0", Zero: "6.25",
    alpha: "1.75", "beta-0": "0.07", "beta-1": "0.025", "beta-q": "0.0",
    "sig-0": "95.5", "sig-1": "410.75", "sig-2": "14.5", "sig-q": "-333.25",
    X: "7.5", Y: "-2.25", Z: "0.0",
  },
  3: {
    Type: "PNT", Bank: "3.0", "2-theta": "75.0", fltPath: "30.75", Azimuth: "0.0",
    difC: "6105.5", difA: "0.875", difB: "0.5", Zero: "-1.375",
    alpha: "0.9", "beta-0": "0.045", "beta-1": "0.018", "beta-q": "-0.3125",
    "sig-0": "-120.5", "sig-1": "-44.25", "sig-2": "7.5", "sig-q": "512.75",
    X: "0.0", Y: "0.0", Z: "0.0",
  },
  4: {
    Type: "PNT", Bank: "4.0", "2-theta": "110.5", fltPath: "31.0", Azimuth: "0.0",
    difC: "7740.75", difA: "-0.25", difB: "0.0", Zero: "1.25e1",
    alpha: "0.55", "beta-0": "0.035", "beta-1": "0.009", "beta-q": "0.0",
    "sig-0": "8.0", "sig-1": "-3.75E+01", "sig-2": "2.5", "sig-q": "1640.5",
    X: "1.5", Y: "0.0", Z: "-0.125",
  },
  5: {
    Type: "PNT", Bank: "5.0", "2-theta": "160.0", fltPath: "31.25", Azimuth: "0.0",
    difC: "10250.5", difA: "0.0", difB: "0.0", Zero: "0.0",
    alpha: "2.0", "beta-0": "0.15", "beta-1": "0.03", "beta-q": "0.0",
    "sig-0": "0.0", "sig-1": "900.0", "sig-2": "0.0", "sig-q": "0.0",
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
  "fltPath:55.5",
  "difC:21000.5",
  "difA:-1.5",
  "difB:0.0",
  "Zero:2.25",
  "alpha:1.0",
  "beta-0:0.04",
  "beta-1:0.01",
  "beta-q:0.0",
  "sig-0:0.0",
  "sig-1:-60.0",
  "sig-2:150.0",
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
export function multiBankGsa(
  banks: readonly { readonly bank: number; readonly difC: number | null; readonly tth?: number; readonly points?: number }[],
  /** Further header lines, written after the histogram count (`# Instrument: …`). */
  header: readonly string[] = [],
): string {
  const out: string[] = ["Sample Run: 1 Vanadium Run: UNKNOWN Wavelength: 1.0 Angstrom\n", "# made-up multi-bank histogram\n", `# ${banks.length} Histograms\n`, ...header.map((l) => `${l}\n`), "Monitor: 1\n"];
  banks.forEach((b, i) => {
    const eol = i % 2 === 0 ? "\r\n" : "\n";
    const n = b.points ?? 40 + 10 * i;
    const start = 500 + 100 * b.bank;
    const step = 0.004;
    if (b.difC !== null) {
      out.push(`# Total flight path   ${(30 + b.bank / 10).toFixed(3)}m, tth   ${(b.tth ?? 20 * b.bank).toFixed(3)}deg, DIFC ${b.difC.toFixed(9)} ${eol}`);
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
  { bank: 1, difC: 1215.5, tth: 20 },
  { bank: 2, difC: 3310.5, tth: 40 },
  { bank: 3, difC: 6100.5, tth: 75 },
  { bank: 4, difC: 7755.5, tth: 110.5 },
  { bank: 5, difC: 10240.5, tth: 160 },
  { bank: 6, difC: 640.5, tth: 10 },
]);

/** The six made-up banks of NOMAD_STYLE_GSA: round DIFC values in the range of a six-bank total-scattering instrument, the sixth a low-angle bank. */
export const NOMAD_STYLE_BANKS = [
  { bank: 1, difC: 1450, tth: 15 },
  { bank: 2, difC: 2860, tth: 31 },
  { bank: 3, difC: 5600, tth: 65 },
  { bank: 4, difC: 9050, tth: 120 },
  { bank: 5, difC: 9900, tth: 150 },
  { bank: 6, difC: 840, tth: 9 },
] as const;

/**
 * A six-bank histogram whose header names its instrument the way a reduction
 * does (`# Instrument: NOMAD`). Made-up counts, as every file here; the DIFC
 * are round numbers, not a measurement's.
 */
export const NOMAD_STYLE_GSA = multiBankGsa(NOMAD_STYLE_BANKS, ["# File generated by a made-up reduction:", "# Instrument: NOMAD", "# Primary flight path 19.5m"]);

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
    "TOFRG    500      4.0000   12000.0000 ",
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
  bank: 3, calibrationComment: "!       Zerot    Dtt1t       Dtt2t     ", calibration: "ZD2TOT  -2.5   6100.5    1.375    ", twoTheta: 75,
  sigma: "9.5      -44.25      4.75", gamma: "0.75       0.25     0", alfbe: "0.8     0.055    1.6      0.0045",
}));

/** Three values on D2TOF, the zero last: `D2TOF Dtt1 Dtt2 Zero`, with a Lorentzian and an all-zero ALFBE. */
export const IRF_D2TOF_THREE = crlf(irfBank({
  bank: 2, calibrationComment: "!      Dtt1t       Dtt2t          Zerot   ", calibration: "D2TOF    3315.5    2.75   5.125   ", twoTheta: 40,
  sigma: "18.5    390.25    -12.0", gamma: "-3.0    21.5    -6.0 ", alfbe: " 0    0    0    0  ",
}));

/** The same three-value line with no comment line above it: the count alone decides. */
export const IRF_D2TOF_THREE_BARE = crlf(irfBank({
  bank: 2, calibration: "D2TOF    3315.5    2.75   5.125   ", twoTheta: 40,
  sigma: "18.5    390.25    -12.0", gamma: "0 0 0", alfbe: "0.5 0.04 1.5 0.01",
}));

/** Four values on D2TOF: `Dtt1 Dtt2 Dtt_1overD Zero`. */
export const IRF_D2TOF_FOUR = crlf(irfBank({
  bank: 1, calibrationComment: "!             Dtt1              Dtt2       Dtt_1overD         Zero", calibration: "D2TOF     21000.5         2.5         -0.75        -3.5", twoTheta: 90,
  sigma: "20.0 300.0 0.0", gamma: "0.0 5.5 0.0", alfbe: "0.0 0.03 0.1 0.01",
}));

/** Zero first on the epithermal keyword: `ZD2TOF Zero Dtt1 Dtt2`. */
export const IRF_ZD2TOF = crlf(irfBank({
  bank: 1, calibration: "ZD2TOF   1.25     7300.5   -1.25", twoTheta: 140,
  sigma: "0.0 55.0 4.0", gamma: "0.0 6.5 0.0", alfbe: "0.0 0.05 0.7 0.008",
}));

/** Two banks in one file, separated by END. */
export const IRF_TWO_BANKS = crlf([
  "Instrumental resolution function of a made-up two-bank instrument",
  ...irfBank({ bank: 1, calibrationComment: "!        Dtt1          Dtt2        Zero", calibration: "D2TOF     1210.5     -0.75      -4.5", twoTheta: 20, sigma: "9.75 140.25 -18.5", gamma: "0 0 0", alfbe: "0.0 0.06 0.4 0.011" }),
  ...irfBank({ bank: 4, calibrationComment: "!        Dtt1          Dtt2        Zero", calibration: "D2TOF     7740.75     -0.25      12.5", twoTheta: 110.5, sigma: "2.5 -37.5 8.0", gamma: "0 1.5 -0.125", alfbe: "0.0 0.035 0.55 0.009" }),
]);

/** NPROF 10: an epithermal line and the thermal branch with its crossover. */
export const IRF_NPROF10 = crlf(irfBank({
  bank: 1, nprof: 10, calibrationComment: "!        Zero       Dtt1", calibration: "ZD2TOF   1.25     7300.5",
  extra: ["!       Zerot      Dtt1t        Dtt2t    x-cross    Width", "ZD2TOT   0.5     7280.75    18.5    1.5    2.25"],
  twoTheta: 140, sigma: "0.0 30.0 0.0", gamma: "0 0 0", alfbe: "1.25 2.0 -0.75 8.5",
}));

/** NPROF 10 with the thermal branch alone: a relation the app does not have. */
export const IRF_THERMAL_ONLY = crlf(irfBank({
  bank: 1, nprof: 10, calibration: "ZD2TOT   0.5     7280.75    18.5    1.5    2.25", twoTheta: 140, sigma: "0 30 0", gamma: "0 0 0", alfbe: "1.25 2.0 -0.75 8.5",
}));

/** A per-bank TOF data file as a reduction writes it: `#` header lines, then TOF, intensity, error; CRLF and trailing blanks. */
export function tofThreeColumnDat(points = 60): string {
  const rows = ["# Made-up sample at temperature 300.0 K.", "# File generated by a reduction script:", "# Instrument: MADEUP", "#TOF                  Is/Iv                   Error"];
  for (let i = 0; i < points; i++) {
    const tof = 650 * 1.0015 ** i;
    const y = 0.5 + 0.4 * Math.exp(-(((i - 30) / 3) ** 2));
    rows.push(`  ${tof.toFixed(9).padEnd(22)}${y.toFixed(9).padEnd(22)}${(0.02 + y / 50).toFixed(9)}                     `);
  }
  return rows.join("\r\n") + "\r\n";
}

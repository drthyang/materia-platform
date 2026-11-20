/**
 * The GSAS-II `.instprm` reader on the layouts GSAS-II writes (THY-88 item 1):
 * a multi-bank "Save all profile" file, `;`-joined pairs, CRLF, keys in any
 * order. Synthetic files (testSupport/instprmFixtures.ts); a real multi-bank
 * file is checked at the end when one is named in the environment.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { defaultInstrumentBank, instrumentBank, parseInstrumentFile, parseInstrumentParameters, type InstrumentBank } from "@/parsers/instrument";
import { FIVE_BANKS, FIVE_BANK_INSTPRM, SEMICOLON_CW_INSTPRM, SEMICOLON_TOF_INSTPRM, SINGLE_BANK_INSTPRM, multiBankInstprm, type BankText } from "@/testSupport/instprmFixtures";

const T = 5_000;
const FWHM2 = 8 * Math.log(2);

/** GSAS-II's key of each TOF field the app uses. */
const TOF_KEYS: readonly (readonly [string, string])[] = [
  ["difC", "difC"], ["difA", "difA"], ["difB", "difB"], ["zero", "Zero"], ["alpha", "alpha"],
  ["beta0", "beta-0"], ["beta1", "beta-1"], ["betaQ", "beta-q"],
  ["sig0", "sig-0"], ["sig1", "sig-1"], ["sig2", "sig-2"], ["sigQ", "sig-q"],
];
/** GSAS-II's key of each value kept but not used for a TOF bank. */
const TOF_EXTRAS: readonly (readonly [keyof InstrumentBank["extras"], string])[] = [
  ["twoTheta", "2-theta"], ["flightPath", "fltPath"], ["azimuth", "Azimuth"], ["lorentzX", "X"], ["lorentzY", "Y"], ["lorentzZ", "Z"],
];

/** Every value of a TOF bank against the text the file has for it. */
function expectTofBank(bank: InstrumentBank, texts: BankText): void {
  expect(bank.parameters.kind).toBe("tof");
  const p = bank.parameters as unknown as Record<string, number | undefined>;
  for (const [field, key] of TOF_KEYS) expect(p[field], key).toBe(Number(texts[key]));
  for (const [field, key] of TOF_EXTRAS) expect(bank.extras[field], key).toBe(Number(texts[key]));
  // Nothing in the file is lost on read: every key, with the file's own text.
  expect(Object.fromEntries(bank.texts)).toEqual(texts);
}

describe("GSAS-II .instprm: several banks in a file", () => {
  it("returns every bank with its own values, whatever the key order and the line ends", () => {
    const file = parseInstrumentFile(FIVE_BANK_INSTPRM);
    expect(FIVE_BANK_INSTPRM).toContain("\r\n");
    expect(file.banks.map((b) => b.bank)).toEqual([1, 2, 3, 4, 5]);
    for (const bank of file.banks) {
      expectTofBank(bank, FIVE_BANKS[bank.bank!]!);
      expect(bank.type).toBe("PNT");
    }
    // Negative Gaussian terms and a large sig-q are read as written.
    const b3 = instrumentBank(file, 3)!.parameters;
    if (b3.kind !== "tof") throw new Error("wrong kind");
    expect(b3.sig0).toBe(-206.5);
    expect(b3.sig1).toBe(-91.75);
    expect(b3.sigQ).toBe(788.25);
    // Exponent forms, as Python's float() reads them.
    const b4 = instrumentBank(file, 4)!.parameters;
    if (b4.kind !== "tof") throw new Error("wrong kind");
    expect(b4.zero).toBe(12.5);
    expect(b4.sig1).toBe(-52.5);
  }, T);

  it("opens on the first bank, as GSAS-II, never on the last", () => {
    const first = parseInstrumentParameters(FIVE_BANK_INSTPRM);
    if (first.kind !== "tof") throw new Error("wrong kind");
    expect(first.difC).toBe(1500.25);
    expect(first.sig1).toBe(260.75);
  }, T);

  it("takes the bank asked for, and says so when the file has no such bank", () => {
    const third = parseInstrumentParameters(FIVE_BANK_INSTPRM, 3);
    if (third.kind !== "tof") throw new Error("wrong kind");
    expect(third.difC).toBe(5612.5);
    expect(() => parseInstrumentParameters(FIVE_BANK_INSTPRM, 9)).toThrow(/Bank 9 not found/);
  }, T);

  it("defaults to the data's bank when the file has it, else to the lowest bank number", () => {
    // Blocks out of numeric order: GSAS-II takes sorted(banklist)[0].
    const file = parseInstrumentFile(multiBankInstprm(FIVE_BANKS, [3, 5, 1, 4, 2], "\n"));
    expect(file.banks.map((b) => b.bank)).toEqual([3, 5, 1, 4, 2]);
    expect(defaultInstrumentBank(file).bank).toBe(1);
    expect(defaultInstrumentBank(file, 4).bank).toBe(4);
    expect(defaultInstrumentBank(file, 9).bank).toBe(1);
    expect(defaultInstrumentBank(file, null).bank).toBe(1);
  }, T);

  it("reads the bank number as GSAS-II does: the second word before the colon, the rest of the header ignored", () => {
    const text = [
      "#Bank 7: any text; with:colons and Bank 99 in it",
      "difC:100.0",
      "#Bank 12 of the back detector: more text",
      "difC:200.0",
      "# a comment that names no bank number",
      "sig-1:3.0",
      "#written from run 5 (Bank 3)",
      "sig-2:4.0",
      "",
    ].join("\r\n");
    const file = parseInstrumentFile(text);
    expect(file.banks.map((b) => b.bank)).toEqual([7, 12]);
    const b12 = file.banks[1]!.parameters;
    if (b12.kind !== "tof") throw new Error("wrong kind");
    // A comment line is not a bank header and does not end the block.
    expect([b12.difC, b12.sig1, b12.sig2]).toEqual([200, 3, 4]);
  }, T);

  it("keeps the first of two blocks with the same bank number, as GSAS-II", () => {
    const file = parseInstrumentFile("#Bank 1: a\ndifC:100\n#Bank 1: b\ndifC:200\n");
    expect(file.banks).toHaveLength(1);
    expect((file.banks[0]!.parameters as { difC: number }).difC).toBe(100);
  }, T);

  it("skips a tabulated profile (pdabc between triple quotes) and notes it", () => {
    const text = ["#GSAS-II instrument parameter file", "Type:PNT", "difC:5000.0", 'pdabc:"""', "0.5 2500.0 0.1 0.02 3.0", "1.0 5000.0 0.2 0.03 4.0", '"""', "Zero:1.5", ""].join("\n");
    const bank = parseInstrumentFile(text).banks[0]!;
    expect(bank.extras.pdabc).toBe(true);
    if (bank.parameters.kind !== "tof") throw new Error("wrong kind");
    expect(bank.parameters.zero).toBe(1.5);
    expect([...bank.texts.keys()]).toEqual(["Type", "difC", "Zero"]);
  }, T);
});

describe("GSAS-II .instprm: several key:value pairs on a line", () => {
  it("reads every pair of a constant-wavelength file in GSAS-II's default-set layout", () => {
    const file = parseInstrumentFile(SEMICOLON_CW_INSTPRM);
    expect(file.banks).toHaveLength(1);
    const bank = file.banks[0]!;
    expect(bank.bank).toBe(1);
    expect(bank.type).toBe("PXC");
    const p = bank.parameters;
    if (p.kind !== "constantWavelength") throw new Error("wrong kind");
    expect(p.radiationKind).toBe("xray");
    expect(p.wavelength).toBe(1.25);
    expect(p.kAlpha2).toEqual({ wavelength: 1.26, ratio: 0.45 });
    expect(p.zero).toBe(0.02);
    expect(p.polarization).toBe(0.75);
    // GSAS-II's U, V, W are variances; the app holds FWHM² (× 8 ln 2).
    expect(p.u).toBeCloseTo(3.0 * FWHM2, 12);
    expect(p.v).toBeCloseTo(-1.5 * FWHM2, 12);
    expect(p.w).toBeCloseTo(4.0 * FWHM2, 12);
    expect(p.x).toBe(0.5);
    expect(p.y).toBe(1.5);
    expect(p.asymmetry).toEqual({ sl: 0.002, hl: 0.002 });
    // Z is read and kept; the profile has no place for it.
    expect(bank.extras).toEqual({ azimuth: 0, lorentzZ: 0.25 });
    expect(bank.texts.size).toBe(15);
  }, T);

  it("reads every pair of a TOF file in the same layout", () => {
    const bank = parseInstrumentFile(SEMICOLON_TOF_INSTPRM).banks[0]!;
    expect(bank.parameters).toEqual({
      kind: "tof", difC: 7500.5, difA: -0.75, difB: 0.25, zero: 1.5,
      alpha: 1.25, beta0: 0.03, beta1: 0.01, betaQ: 0,
      sig0: 5, sig1: -30, sig2: 2, sigQ: 10,
    });
    expect(bank.extras).toEqual({ twoTheta: 90, flightPath: 30, lorentzX: 1, lorentzY: 0.5, lorentzZ: 0 });
  }, T);
});

describe("GSAS-II .instprm: one bank, one key per line", () => {
  it("reads it as before, and now keeps 2-theta, fltPath and the Lorentzian", () => {
    const file = parseInstrumentFile(SINGLE_BANK_INSTPRM);
    expect(file.banks).toHaveLength(1);
    const bank = file.banks[0]!;
    // No bank header: the file's own Bank value.
    expect(bank.bank).toBe(2);
    expect(bank.parameters).toEqual({
      kind: "tof", difC: 22500.5, difA: -1.5, difB: 0, zero: 2.25,
      alpha: 1, beta0: 0.04, beta1: 0.01, betaQ: 0,
      sig0: 0, sig1: -80, sig2: 120, sigQ: 0,
    });
    expect(bank.extras).toEqual({ twoTheta: 90, flightPath: 60.5, lorentzX: 0, lorentzY: 0, lorentzZ: 0 });
    expect(parseInstrumentParameters(SINGLE_BANK_INSTPRM)).toEqual(bank.parameters);
    // CRLF line ends change nothing.
    expect(parseInstrumentFile(SINGLE_BANK_INSTPRM.replace(/\n/g, "\r\n")).banks[0]!.parameters).toEqual(bank.parameters);
  }, T);

  it("reads the bundled instrument files as one bank each", () => {
    const powgen = parseInstrumentFile(readFileSync("examples/mn3ga-350k/PG3_45598_Bank1.instprm", "utf8"));
    expect(powgen.banks).toHaveLength(1);
    expect(powgen.banks[0]!.bank).toBe(1);
    expect(powgen.banks[0]!.parameters.kind).toBe("tof");
    expect(powgen.banks[0]!.parameters.name).toBe("POWGEN");
    const cw = parseInstrumentFile(readFileSync("examples/mcp/mn3ga_30k.instprm", "utf8"));
    expect(cw.banks).toHaveLength(1);
    expect(cw.banks[0]!.parameters.kind).toBe("constantWavelength");
  }, T);
});

/**
 * A real multi-bank file, when one is at hand (never in the repository):
 *   MATERIA_INSTPRM_FILE   the .instprm
 *   MATERIA_INSTPRM_GSAS2  what GSAS-II's own reader returns for it, written by
 *                          scripts/gsas2-read-instprm.py (optional)
 * Every value of every bank must equal the file's text and GSAS-II's number.
 */
const LOCAL_FILE = process.env.MATERIA_INSTPRM_FILE;
const LOCAL_GSAS2 = process.env.MATERIA_INSTPRM_GSAS2;

describe.skipIf(!LOCAL_FILE || !existsSync(LOCAL_FILE))("a local multi-bank .instprm (opt-in)", () => {
  /** The file's text by bank, read here with nothing but string splitting. */
  function plainRead(text: string): Map<number, Map<string, string>> {
    const out = new Map<number, Map<string, string>>();
    let current: Map<string, string> | null = null;
    for (const raw of text.split(/\r?\n/)) {
      const header = raw.match(/^#Bank (\d+):/);
      if (header) { current = new Map(); out.set(Number(header[1]), current); continue; }
      const at = raw.indexOf(":");
      if (raw.startsWith("#") || at < 0 || !current) continue;
      current.set(raw.slice(0, at), raw.slice(at + 1));
    }
    return out;
  }

  it("every bank's every value equals the file's text, and GSAS-II's reader", () => {
    const text = readFileSync(LOCAL_FILE!, "utf8");
    const expected = plainRead(text);
    const file = parseInstrumentFile(text);
    expect(file.banks.map((b) => b.bank)).toEqual([...expected.keys()]);
    const gsas2 = LOCAL_GSAS2 && existsSync(LOCAL_GSAS2)
      ? (JSON.parse(readFileSync(LOCAL_GSAS2, "utf8")) as { default: { bank: number }; banks: Record<string, Record<string, number | string>> })
      : null;
    let compared = 0;
    let comparedGsas2 = 0;
    for (const bank of file.banks) {
      const texts = expected.get(bank.bank!)!;
      expect(Object.fromEntries(bank.texts)).toEqual(Object.fromEntries(texts));
      const p = bank.parameters as unknown as Record<string, number | undefined>;
      const pairs: (readonly [number | undefined, string])[] = [
        ...TOF_KEYS.map(([field, key]) => [p[field], key] as const),
        ...TOF_EXTRAS.map(([field, key]) => [bank.extras[field] as number | undefined, key] as const),
      ];
      for (const [value, key] of pairs) {
        expect(value, `bank ${bank.bank} ${key}`).toBe(Number(texts.get(key)));
        compared++;
        if (gsas2) {
          expect(value, `bank ${bank.bank} ${key} against GSAS-II`).toBe(gsas2.banks[String(bank.bank)]![key]);
          comparedGsas2++;
        }
      }
      if (gsas2) {
        expect(bank.type).toBe(gsas2.banks[String(bank.bank)]!.Type);
        expect(Object.keys(gsas2.banks[String(bank.bank)]!).sort()).toEqual([...bank.texts.keys()].sort());
      }
    }
    if (gsas2) expect(defaultInstrumentBank(file).bank).toBe(gsas2.default.bank);
    console.log(`local .instprm: ${file.banks.length} banks, ${compared} values equal the file's text${gsas2 ? `, ${comparedGsas2} equal GSAS-II's reader; default bank ${gsas2.default.bank} in both` : " (no GSAS-II reading given)"}`);
  }, T);
});

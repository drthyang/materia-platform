/**
 * FullProf time-of-flight `.irf` files (NPROF 9): the calibration line in each
 * documented form, the bank lines mapped onto the app's TOF terms, several
 * banks in a file. Synthetic files (testSupport/instprmFixtures.ts); real
 * per-bank files are compared with a GSAS-II calibration of the same
 * instrument at the end, when they are named in the environment.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseInstrumentFile, parseInstrumentParameters, type InstrumentBank } from "@/parsers/instrument";
import { parseGsasHistogram } from "@/parsers/gsasHistogram";
import { detectDataFormat } from "@/parsers/detectFormat";
import { parsePowderData } from "@/parsers/powderData";
import { bankAdvice, instrumentBankOptions, unusedNote } from "@/app/bankChoice";
import { buildPowderSpec } from "@/app/powderSpec";
import { parseCif } from "@/parsers/cif";
import {
  IRF_D2TOF_FOUR, IRF_D2TOF_THREE, IRF_D2TOF_THREE_BARE, IRF_NPROF10, IRF_THERMAL_ONLY, IRF_TWO_BANKS, IRF_ZD2TOF, IRF_ZD2TOT,
  SIX_BANK_GSA, tofThreeColumnDat,
} from "@/testSupport/instprmFixtures";

const T = 20_000;
const one = (text: string): InstrumentBank => {
  const file = parseInstrumentFile(text);
  expect(file.banks).toHaveLength(1);
  return file.banks[0]!;
};

describe("FullProf TOF .irf: the calibration line", () => {
  it("ZD2TOT with three values in an NPROF 9 file: Zero, Dtt1, Dtt2 (it was refused before)", () => {
    const bank = one(IRF_ZD2TOT);
    expect(IRF_ZD2TOT).toContain("\r\n");
    expect(bank.parameters).toEqual({
      kind: "tof", difC: 5606.5, difA: 2.125, zero: -3.75,
      alpha0: 1.25, alpha: 2.5, beta0: 0.085, beta1: 0.0075,
      sig0: 6.25, sig1: -91.75, sig2: 12.5,
    });
    expect(bank.bank).toBe(3);
    expect(bank.format).toBe("irf");
    expect(bank.extras).toMatchObject({ twoTheta: 65, tofRange: [800, 5, 14000], nprof: 9, lorentzY: 1, lorentzX: 0.5, lorentzZ: 0 });
    expect(bank.extras.reading).toContain("ZD2TOT read as Zero, Dtt1, Dtt2 (the order its comment line names)");
  }, T);

  it("D2TOF with three values: Dtt1, Dtt2, Zero (the zero went to the 1/d term before)", () => {
    for (const text of [IRF_D2TOF_THREE, IRF_D2TOF_THREE_BARE]) {
      const p = one(text).parameters;
      if (p.kind !== "tof") throw new Error("wrong kind");
      expect([p.difC, p.difA, p.difB, p.zero]).toEqual([2845.5, 6.25, undefined, 8.125]);
    }
    expect(one(IRF_D2TOF_THREE).extras.reading).toBe("D2TOF read as Dtt1, Dtt2, Zero (the order its comment line names)");
    expect(one(IRF_D2TOF_THREE_BARE).extras.reading).toBe("D2TOF read as Dtt1, Dtt2, Zero (FullProf's order for 3 values)");
  }, T);

  it("D2TOF with four values: Dtt1, Dtt2, Dtt_1overD, Zero, as before", () => {
    const p = one(IRF_D2TOF_FOUR).parameters;
    if (p.kind !== "tof") throw new Error("wrong kind");
    expect([p.difC, p.difA, p.difB, p.zero]).toEqual([22500.5, 1.5, -0.75, -2.5]);
    // The bundled example and a bare four-value line read the same way.
    const bundled = parseInstrumentParameters(readFileSync("examples/mcp/powgen_600k.irf", "utf8"));
    expect(bundled).toMatchObject({ kind: "tof", difC: 22585.8, difA: 0, difB: 0, zero: 0 });
    const bare = parseInstrumentParameters("NPROF 9\nD2TOF 22585.74023 3.91547 -0.69671 1.31354\nTWOTH 90.000\n");
    expect(bare).toMatchObject({ difC: 22585.74023, difA: 3.91547, difB: -0.69671, zero: 1.31354 });
  }, T);

  it("ZD2TOF: the zero first; one and two values on D2TOF", () => {
    expect(one(IRF_ZD2TOF).parameters).toMatchObject({ difC: 7478.5, difA: -1.5, zero: 1.25 });
    expect(parseInstrumentParameters("D2TOF 7476.91 -1.54\nTWOTH 144.845\n")).toEqual({ kind: "tof", difC: 7476.91, difA: -1.54 });
    expect(parseInstrumentParameters("D2TOF 7476.91\n")).toEqual({ kind: "tof", difC: 7476.91 });
  }, T);

  it("the comment line decides the order when it names every column, whatever the keyword's usual order", () => {
    const text = "NPROF 9\n!  Zero   Dtt2   Dtt1\nD2TOF  1.5  -2.5  5000.25\n";
    expect(parseInstrumentParameters(text)).toEqual({ kind: "tof", difC: 5000.25, difA: -2.5, zero: 1.5 });
  }, T);

  it("NPROF 10: the epithermal line is the calibration, the thermal branch is kept as not used", () => {
    const bank = one(IRF_NPROF10);
    expect(bank.parameters).toMatchObject({ difC: 7478.5, zero: 1.25 });
    expect(bank.extras.thermal).toContain("ZD2TOT");
    expect(unusedNote(bank, undefined)!.line).toContain("the thermal branch");
  }, T);

  it("refuses a thermal branch alone, and a count FullProf does not document", () => {
    expect(() => parseInstrumentFile(IRF_THERMAL_ONLY)).toThrow(/thermal line ZD2TOT of NPROF 10/);
    expect(() => parseInstrumentFile("NPROF 9\nZD2TOF 1 2 3 4 5 6\n")).toThrow(/ZD2TOF line with 6 values/);
  }, T);
});

describe("FullProf TOF .irf: the profile lines", () => {
  it("SIGMA and ALFBE become the same functions of d; the page builds its rows from them", () => {
    const bank = one(IRF_ZD2TOT);
    const structure = parseCif(readFileSync("examples/mcp/mno.cif", "utf8"));
    const pattern = parsePowderData(tofThreeColumnDat(), { id: "d", name: "d.dat", xUnit: "tof", radiation: { kind: "neutron-tof" } });
    const spec = buildPowderSpec(structure, pattern, bank.parameters);
    const row = (id: string) => spec.params.find((p) => p.id === id)?.value;
    expect(spec.profile.shape).toBe("tof");
    // α = alph0 + alph1/d, β = beta0 + beta1/d⁴, σ² = Sig-0 + Sig-2·d⁴ (+ Sig-1·d², see below).
    expect([row("tof_alpha0"), row("tof_alpha1"), row("tof_beta0"), row("tof_beta1")]).toEqual([1.25, 2.5, 0.085, 0.0075]);
    expect([row("tof_sig0"), row("tof_sig2"), row("tof_sigQ"), row("tof_betaQ")]).toEqual([6.25, 12.5, 0, 0]);
    expect([row("tof_difC"), row("tof_difA"), row("tof_difB"), row("zero")]).toEqual([5606.5, 2.125, 0, -3.75]);
    // Sig-1 is left out under the default (isotropic) microstrain model, as an .instprm's sig-1 is.
    expect(row("tof_sig1")).toBeUndefined();
    expect(row("mustrainIso")).toBe(1500);
  }, T);

  it("an instrument without alph0 still starts α₀ at 0", () => {
    const structure = parseCif(readFileSync("examples/mcp/mno.cif", "utf8"));
    const pattern = parsePowderData(tofThreeColumnDat(), { id: "d", name: "d.dat", xUnit: "tof", radiation: { kind: "neutron-tof" } });
    const spec = buildPowderSpec(structure, pattern, { kind: "tof", difC: 5606.5, alpha: 2.5 });
    expect(spec.params.find((p) => p.id === "tof_alpha0")?.value).toBe(0);
  }, T);

  it("says what is not used, in FullProf's names", () => {
    const note = unusedNote(one(IRF_ZD2TOT), undefined)!;
    expect(note.line).toBe("Not used: Lorentzian Gam-1, Gam-2; Sig-1.");
    expect(note.detail).toContain("Gam-2·d² + Gam-1·d + Gam-0");
    expect(note.detail).toContain("Calibration line: ZD2TOT read as Zero, Dtt1, Dtt2");
    // An all-zero ALFBE is no peak shape: not taken, and said.
    const zero = one(IRF_D2TOF_THREE);
    expect(zero.extras.zeroDecay).toBe(true);
    expect(zero.parameters).toEqual({ kind: "tof", difC: 2845.5, difA: 6.25, zero: 8.125, sig0: -24, sig1: 480.25, sig2: 42.5 });
    expect(unusedNote(zero, undefined)!.line).toBe("Not used: Lorentzian Gam-1, Gam-2, Gam-0; Sig-1; ALFBE (all zero).");
  }, T);
});

describe("FullProf TOF .irf: banks", () => {
  it("reads every END-separated bank of a file and offers them", () => {
    const file = parseInstrumentFile(IRF_TWO_BANKS);
    expect(file.banks.map((b) => b.bank)).toEqual([1, 4]);
    expect(file.banks.map((b) => (b.parameters as { difC: number }).difC)).toEqual([1500.25, 8650.75]);
    expect(instrumentBankOptions(file)!.map((o) => o.label)).toEqual(["Bank 1 · 2θ 154° · difC 1500", "Bank 4 · 2θ 120.5° · difC 8651"]);
    // The first bank by default, as for an .instprm.
    expect(parseInstrumentParameters(IRF_TWO_BANKS)).toMatchObject({ difC: 1500.25 });
    expect(parseInstrumentParameters(IRF_TWO_BANKS, 4)).toMatchObject({ difC: 8650.75, zero: 12.5 });
  }, T);

  it("a one-bank .irf against the chosen data bank: by difC, never by the bank its header or name claims", () => {
    const data = parseGsasHistogram(SIX_BANK_GSA).banks;
    const ref = (n: number) => ({ bank: n, difC: data.find((b) => b.bankNumber === n)!.meta!.difC! });
    // Headed "Bank 2", Dtt1 2845.5: it is data bank 2's (DIFC 2861.25), whatever the page's bank numbers say.
    const file = parseInstrumentFile(IRF_D2TOF_THREE);
    expect(bankAdvice(file, file.banks[0]!, ref(2))).toBeNull();
    // Against data bank 1 (DIFC 1490.5) it is another bank's calibration: one line, nothing to offer.
    const wrong = bankAdvice(file, file.banks[0]!, ref(1))!;
    expect(wrong.line).toBe("No instrument bank for data bank 1: bank 2 is not its calibration.");
    expect(wrong.offer).toBeUndefined();
    expect(wrong.detail).toContain("91 % from the data's DIFC 1490.5");
    // Headed "Bank 3" but with data bank 3's DIFC under another number: still its calibration.
    const third = parseInstrumentFile(IRF_ZD2TOT);
    expect(bankAdvice(third, third.banks[0]!, { bank: 7, difC: 5606.5 })).toBeNull();
  }, T);
});

describe("per-bank TOF data: # header lines, then TOF, intensity, error", () => {
  it("is read as time of flight with its errors, not as 2θ", () => {
    const text = tofThreeColumnDat();
    const fmt = detectDataFormat({ text, filename: "MADEUP_Si-1.dat" });
    expect(fmt.dataType).toBe("powder");
    expect(fmt.xUnit).toBe("tof");
    expect(fmt.radiation.kind).toBe("neutron-tof");
    const pattern = parsePowderData(text, { id: "d", name: "MADEUP_Si-1.dat", xUnit: "tof", radiation: fmt.radiation });
    expect(pattern.points).toHaveLength(60);
    expect(pattern.points.every((p) => p.sigma !== undefined && p.sigma > 0)).toBe(true);
    expect(pattern.points[0]!.x).toBeCloseTo(720, 6);
    expect(pattern.points[0]!.sigma).toBeCloseTo(0.02 + pattern.points[0]!.yObs / 50, 8);
  }, T);
});

/**
 * Real per-bank `.irf` files against a GSAS-II calibration of the same
 * instrument, when at hand (never in the repository):
 *   MATERIA_IRF_DIRS       folders of .irf (and per-bank .dat) files, separated by ":"
 *   MATERIA_INSTPRM_FILE   the multi-bank .instprm
 *   MATERIA_GSA_FILE       a multi-bank data file whose comment lines give each bank's DIFC
 * Prints, per file, the calibration and the Gaussian width against the
 * .instprm bank with the closest difC, and the data's own DIFC.
 */
const IRF_DIRS = (process.env.MATERIA_IRF_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const INSTPRM = process.env.MATERIA_INSTPRM_FILE;
const GSA = process.env.MATERIA_GSA_FILE;

describe.skipIf(IRF_DIRS.length === 0 || !INSTPRM || !existsSync(INSTPRM))("local per-bank .irf files against a GSAS-II calibration (opt-in)", () => {
  it("reads every file; the calibration agrees with the .instprm bank of the same difC", () => {
    const inst = parseInstrumentFile(readFileSync(INSTPRM!, "utf8"));
    const data = GSA && existsSync(GSA) ? parseGsasHistogram(readFileSync(GSA, "utf8")).banks : [];
    const out: string[] = [];
    type Tof = { difC: number; difA?: number; difB?: number; zero?: number; alpha?: number; alpha0?: number; beta0?: number; beta1?: number; betaQ?: number; sig0?: number; sig1?: number; sig2?: number; sigQ?: number };
    const tof = (p: Tof, d: number): number => (p.zero ?? 0) + p.difC * d + (p.difA ?? 0) * d * d + (p.difB ?? 0) / d;
    const fwhmG = (p: Tof, d: number): number => Math.sqrt(8 * Math.log(2) * Math.max((p.sig0 ?? 0) + (p.sig1 ?? 0) * d * d + (p.sig2 ?? 0) * d ** 4 + (p.sigQ ?? 0) * d, 0));
    for (const dir of IRF_DIRS) {
      const names = readdirSync(dir).sort();
      out.push(`## ${dir.split("/").slice(-1)[0]}`);
      for (const name of names.filter((n) => n.toLowerCase().endsWith(".irf"))) {
        const file = parseInstrumentFile(readFileSync(join(dir, name), "utf8"));
        expect(file.banks, name).toHaveLength(1);
        const bank = file.banks[0]!;
        const p = bank.parameters as unknown as Tof;
        const g = [...inst.banks].sort((a, b) => Math.abs((a.parameters as unknown as Tof).difC - p.difC) - Math.abs((b.parameters as unknown as Tof).difC - p.difC))[0]!;
        const gp = g.parameters as unknown as Tof;
        const dd = [...data].filter((b) => b.meta?.difC !== undefined).sort((a, b) => Math.abs(a.meta!.difC! - p.difC) - Math.abs(b.meta!.difC! - p.difC))[0];
        // The calibration of one bank from two programs' fits: the same to well under the 3 % the page allows.
        expect(Math.abs(p.difC - gp.difC) / gp.difC, name).toBeLessThan(0.02);
        const advice = dd ? bankAdvice(file, bank, { bank: dd.bankNumber, difC: dd.meta!.difC! }) : null;
        expect(advice, name).toBeNull();
        out.push(`${name}: header says bank ${bank.bank}, 2θ ${bank.extras.twoTheta}; closest .instprm bank ${g.bank} (difC ${(100 * (p.difC - gp.difC) / gp.difC).toFixed(2)} % off)${dd ? `; closest data bank ${dd.bankNumber} (DIFC ${(100 * (p.difC - dd.meta!.difC!) / dd.meta!.difC!).toFixed(2)} % off)` : ""}`);
        out.push(`   ${bank.extras.reading}`);
        out.push(`   Zero ${p.zero} / ${gp.zero?.toFixed(3)}   Dtt1|difC ${p.difC} / ${gp.difC.toFixed(3)}   Dtt2|difA ${p.difA} / ${gp.difA?.toFixed(4)}   (irf / instprm)`);
        const [tmin, , tmax] = bank.extras.tofRange ?? [0, 0, Infinity];
        for (const d of [0.4, 0.7, 1.0, 1.5, 2.5, 4.0]) {
          const tg = tof(gp, d);
          if (tg < tmin || tg > tmax) continue;
          const w = fwhmG(gp, d);
          const gam = (bank.extras.lorentzY ?? 0) * d * d + (bank.extras.lorentzX ?? 0) * d + (bank.extras.lorentzZ ?? 0);
          const gamG = (g.extras.lorentzX ?? 0) * d + (g.extras.lorentzY ?? 0) * d * d + (g.extras.lorentzZ ?? 0);
          const a = p.alpha !== undefined ? ((p.alpha0 ?? 0) + p.alpha / d).toFixed(3) : "–";
          const b = p.beta0 !== undefined ? (p.beta0 + (p.beta1 ?? 0) / d ** 4).toFixed(4) : "–";
          out.push(`   d ${d.toFixed(1)} Å: TOF ${tof(p, d).toFixed(1)} / ${tg.toFixed(1)} µs (Δ ${(tof(p, d) - tg).toFixed(1)}, ${w > 0 ? ((tof(p, d) - tg) / w).toFixed(2) : "–"} FWHM_G)  FWHM_G ${fwhmG(p, d).toFixed(1)} / ${w.toFixed(1)}  γ ${gam.toFixed(1)} / ${gamG.toFixed(1)}  α ${a} / ${((gp.alpha ?? 0) / d).toFixed(3)}  β ${b} / ${((gp.beta0 ?? 0) + (gp.beta1 ?? 0) / d ** 4 + (gp.betaQ ?? 0) / (d * d)).toFixed(4)}`);
        }
      }
      for (const name of names.filter((n) => n.toLowerCase().endsWith(".dat"))) {
        const text = readFileSync(join(dir, name), "utf8");
        const fmt = detectDataFormat({ text, filename: name });
        expect(fmt.xUnit, name).toBe("tof");
        const pattern = parsePowderData(text, { id: "d", name, xUnit: "tof", radiation: fmt.radiation });
        const withError = pattern.points.filter((q) => q.sigma !== undefined && q.sigma > 0).length;
        expect(pattern.points.length, name).toBeGreaterThan(100);
        expect(withError / pattern.points.length, name).toBeGreaterThan(0.9);
        out.push(`${name}: TOF [${fmt.source}/${fmt.confidence}], ${pattern.points.length} points, ${withError} with an error, ${pattern.points[0]!.x.toFixed(0)}–${pattern.points.at(-1)!.x.toFixed(0)} µs`);
      }
      for (const name of names.filter((n) => n.toLowerCase().endsWith(".pcr"))) {
        let result: string;
        try { result = `read as ${parseInstrumentFile(readFileSync(join(dir, name), "utf8")).banks[0]!.parameters.kind}`; } catch (e) { result = `refused: ${(e as Error).message}`; }
        out.push(`${name} as an instrument file: ${result}`);
      }
    }
    console.log(out.join("\n"));
  }, T);
});

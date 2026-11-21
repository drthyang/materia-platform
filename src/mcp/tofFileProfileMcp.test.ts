import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse_instrument, parse_powder_data, parse_structure, simulate_pattern } from "@/mcp/tools";
import { buildPowderSpec } from "@/app/powderSpec";
import { buildPowderProblem } from "@/core/workflow/powder";
import type { PowderPattern } from "@/core/diffraction/types";

/**
 * The MCP tools on an instrument file that gives the TOF profile, and on
 * multi-bank files (synthetic files of scripts/tof-profile/fixtures and the
 * known-truth patterns built on them): simulate_pattern draws the page's own
 * peaks, and the two parsers take a `bank` and say which bank they read.
 */
const TRUTH = JSON.parse(readFileSync("src/testSupport/tofKnownTruth.json", "utf8")) as {
  structure: { cif: string };
  background: number;
  instrumentFile: string;
  cases: Record<string, { x: number[]; y: number[] }>;
};
const INSTPRM = readFileSync(TRUTH.instrumentFile, "utf8");
const structure = parse_structure({ cif: TRUTH.structure.cif }).structure;

describe("simulate_pattern on an instrument file's TOF profile", () => {
  it("is the page's pattern, point for point: the file's terms, Lorentzian part included, with the sample rows at their start", () => {
    const instrument = parse_instrument({ text: INSTPRM, bank: 2 });
    const sim = simulate_pattern({ structure, instrument, xMin: 2400, xMax: 12000, points: 1500 });
    const pattern: PowderPattern = { id: "p", name: "p", xUnit: "tof", radiation: { kind: "neutron-tof" }, points: sim.curves.x.map((x) => ({ x, yObs: 0 })) };
    // The page's rows for this file (app/powderSpec.ts), a clean pattern: unit scale, no background.
    const spec = buildPowderSpec(structure, pattern, instrument, true, 1, {});
    expect(spec.params.find((p) => p.id === "tof_gamY")).toMatchObject({ kind: "tofFileProfile", fixed: true });
    expect(spec.params.find((p) => p.id === "tofSampleLorentz")).toMatchObject({ value: 1000 });
    const params = spec.params.map((p) => (p.kind === "scale" ? { ...p, value: 1 } : p.kind === "background" ? { ...p, value: 0 } : p));
    const page = buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile).calculate(Object.fromEntries(params.map((p) => [p.id, p.value])));
    const top = Math.max(...page);
    expect(top).toBeGreaterThan(0);
    let worst = 0;
    sim.curves.yCalc.forEach((y, i) => { worst = Math.max(worst, Math.abs(y - page[i]!) / top); });
    expect(worst).toBeLessThan(1e-12);

    // Without the Lorentzian terms and the sample's Lorentzian rows the pattern is another one: they are drawn.
    const gaussian = params.map((p) => (/^tof_gam|^tofSampleLorentz$/.test(p.id) ? { ...p, value: 0 } : p.id === "tofSampleSize" ? { ...p, value: 1000 } : p));
    const bare = buildPowderProblem(structure, pattern, gaussian, spec.bindings, spec.profile).calculate(Object.fromEntries(gaussian.map((p) => [p.id, p.value])));
    let apart = 0;
    sim.curves.yCalc.forEach((y, i) => { apart = Math.max(apart, Math.abs(y - bare[i]!) / top); });
    expect(apart).toBeGreaterThan(0.02);
  });

  it("is GSAS-II's own pattern of the same file, up to one scale", () => {
    const c = TRUTH.cases.gsas2_bank2_new_phase!;
    const instrument = parse_instrument({ text: INSTPRM, bank: 2 });
    const sim = simulate_pattern({ structure, instrument, xMin: c.x[0]!, xMax: c.x.at(-1)!, points: 4000 });
    const y = c.y.map((v) => v - TRUTH.background);
    let j = 0;
    const truth = sim.curves.x.map((x) => {
      while (j < c.x.length - 2 && c.x[j + 1]! < x) j++;
      const t = (x - c.x[j]!) / (c.x[j + 1]! - c.x[j]!);
      return y[j]! + t * (y[j + 1]! - y[j]!);
    });
    let sxy = 0, sxx = 0;
    sim.curves.yCalc.forEach((v, i) => { sxy += v * truth[i]!; sxx += v * v; });
    const k = sxy / sxx;
    const top = Math.max(...truth);
    let worst = 0;
    sim.curves.yCalc.forEach((v, i) => { worst = Math.max(worst, Math.abs(k * v - truth[i]!) / top); });
    // The patterns are on different grids (linear interpolation between GSAS-II's points).
    expect(worst).toBeLessThan(0.003);
  });
});

describe("the bank of a multi-bank file", () => {
  it("parse_instrument reads the lowest-numbered bank by default, the bank asked for otherwise, and names both", () => {
    const first = parse_instrument({ text: INSTPRM });
    expect(first.fileBanks).toEqual({ read: 1, inFile: [1, 2, 3] });
    const third = parse_instrument({ text: INSTPRM, bank: 3 });
    expect(third.fileBanks).toEqual({ read: 3, inFile: [1, 2, 3] });
    expect(third).not.toMatchObject({ difC: (first as { difC: number }).difC });
    expect(() => parse_instrument({ text: INSTPRM, bank: 7 })).toThrow(/Bank 7 not found in the instrument file \(it has bank 1, bank 2, bank 3\)/);
    // A file with one unnumbered bank says nothing of banks.
    expect(parse_instrument({ text: "Lam:1.54\nType:PXC\n" })).not.toHaveProperty("fileBanks");
  });

  it("parse_powder_data reads the first bank of a GSAS histogram by default, the bank asked for otherwise, and names both", () => {
    const bank = (n: number, y: number): string => [
      `BANK ${n} 6 1 CONST 1000.0 10.0 0 0 FXYE`,
      ...Array.from({ length: 6 }, (_, i) => `${(1000 + 10 * i).toFixed(2)} ${(y + i).toFixed(2)} 1.00`),
    ].map((l) => l.padEnd(80)).join("\n");
    const text = `${"Synthetic two-bank histogram".padEnd(80)}\n${bank(2, 100)}\n${bank(5, 900)}\n`;
    const first = parse_powder_data({ text, filename: "two.gsa" });
    expect(first.summary).toMatchObject({ bank: 2, banksInFile: [2, 5] });
    const fifth = parse_powder_data({ text, filename: "two.gsa", bank: 5 });
    expect(fifth.summary).toMatchObject({ bank: 5, banksInFile: [2, 5] });
    expect(fifth.pattern.points[0]!.yObs).toBeGreaterThan(first.pattern.points[0]!.yObs + 500);
    expect(() => parse_powder_data({ text, filename: "two.gsa", bank: 3 })).toThrow(/Bank 3 not found in the data file \(it has banks 2, 5\)/);
    expect(() => parse_powder_data({ text: "10 5\n10.1 6\n10.2 5\n10.3 7\n10.4 5\n", filename: "t.xy", bank: 1 })).toThrow(/this file has no banks/);
    expect(parse_powder_data({ text: "10 5\n10.1 6\n10.2 5\n10.3 7\n10.4 5\n", filename: "t.xy" }).summary).not.toHaveProperty("bank");
  });
});

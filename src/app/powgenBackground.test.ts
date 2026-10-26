import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { parsePowderData } from "@/parsers/powderData";
import { detectDataFormat } from "@/parsers/detectFormat";
import type { StructureModel } from "@/core/crystal/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import { backgroundLabel, estimateBackground, evaluateBackground, interpAnchors } from "@/core/diffraction/background";
import { isPowgenTof, pageInstrument, POWGEN_BACKGROUND } from "@/core/workflow/backgroundDefaults";
import { instrumentHintFromFileName } from "@/parsers/instrumentRegistry";
import { buildPowderProblem } from "@/core/workflow/powder";
import { refine } from "@/core/refinement/engine";
import { minMax } from "@/core/math/extent";
import { parseProject, serializeProject } from "@/core/project/io";
import { build_refinement } from "@/mcp/tools";
import { projectFileFor, powderWorkspaceFrom, sessionFromPowderWorkspace } from "@/app/projectIo";
import type { Session } from "@/app/powderSession";
import {
  emptyPage, profileRequest, withBackgroundTerms, withBackgroundType, withCorrections, withInstrument, withPattern, withPhase, withStructure, type PowderPage,
} from "@/app/powderPage";

/**
 * POWGEN time-of-flight data start on a logarithmic background — GSAS-II's
 * "log interpolate" with three points — and every other page on the general
 * default (Chebyshev, four terms), with the user's choice and a saved project's
 * kept (core/workflow/backgroundDefaults.ts).
 */

const PG3 = resolve(__dirname, "../../examples/mn3ga-350k");
const CW = resolve(__dirname, "../../examples/mcp");
const read = (dir: string, name: string): { name: string; text: string } => ({ name, text: readFileSync(resolve(dir, name), "utf8") });
const PG3_CIF = read(PG3, "Mn3Ga_350K_nuclear.cif");
const PG3_DATA = read(PG3, "PG3_45598_Bank1.fxye");
const PG3_INSTRUMENT = read(PG3, "PG3_45598_Bank1.instprm");
const CW_CIF = read(CW, "mn3ga_30k_nuclear.cif");
const CW_DATA = read(CW, "mn3ga_30k_sim.xye");
const CW_INSTRUMENT = read(CW, "mn3ga_30k.instprm");

const pg3Structure = (): StructureModel => ({ ...parseCif(PG3_CIF.text, "loaded"), id: "loaded" });
const pg3Pattern = (): PowderPattern => parseGsasHistogramPattern(PG3_DATA.text, "loaded-powder", PG3_DATA.name, { radiation: { kind: "neutron-tof" } });
const pg3Instrument = (): InstrumentParameters => parseInstrumentParameters(PG3_INSTRUMENT.text);
/** The POWGEN .instprm without its header comments: its text names neither POWGEN nor PG3. */
const unnamedInstrument = (): InstrumentParameters => parseInstrumentParameters(PG3_INSTRUMENT.text.split("\n").filter((l) => !l.startsWith("#")).join("\n"));
/** The POWGEN bank under another file name. */
const renamed = (name: string): PowderPattern => ({ ...pg3Pattern(), name });

type Load = "cif" | "data" | "instrument";
const pg3Load = (p: PowderPage, what: Load): PowderPage =>
  what === "cif" ? withStructure(p, pg3Structure()) : what === "data" ? withPattern(p, pg3Pattern(), PG3_DATA) : withInstrument(p, pg3Instrument(), PG3_INSTRUMENT);
const pg3Page = (...order: Load[]): PowderPage => order.reduce(pg3Load, emptyPage());

function cwPattern(p: PowderPage): PowderPattern {
  const fmt = detectDataFormat({ text: CW_DATA.text, filename: CW_DATA.name, instrument: p.instrumentLoaded ? p.instrument : undefined });
  return parsePowderData(CW_DATA.text, { id: `${p.session.structure.id}-powder`, name: CW_DATA.name, xUnit: fmt.xUnit, radiation: fmt.radiation, ...(fmt.radiation.kind !== "neutron-tof" ? { wavelength: fmt.radiation.wavelength } : {}) });
}
const cwLoad = (p: PowderPage, what: Load): PowderPage =>
  what === "cif" ? withStructure(p, { ...parseCif(CW_CIF.text, "loaded"), id: "loaded" }) : what === "data" ? withPattern(p, cwPattern(p), CW_DATA) : withInstrument(p, parseInstrumentParameters(CW_INSTRUMENT.text), CW_INSTRUMENT);

const backgroundRows = (s: Session) => s.powderParams.filter((p) => p.kind === "background");
const xRange = (s: Session) => minMax(s.pattern.points.map((p) => p.x));
const curveOf = (s: Session) => {
  const { min, max } = xRange(s);
  const c = backgroundRows(s).map((p) => p.value);
  return (x: number) => evaluateBackground(x, c, s.powderProfile.backgroundType ?? "chebyshev", min, max);
};

const ORDERS: Load[][] = [
  ["cif", "instrument", "data"], ["cif", "data", "instrument"], ["instrument", "cif", "data"],
  ["instrument", "data", "cif"], ["data", "cif", "instrument"], ["data", "instrument", "cif"],
];

describe("recognizing POWGEN", () => {
  it("names POWGEN from the instrument file's header (PG3_45598 in the GSAS-II .instprm)", () => {
    const inst = pg3Instrument();
    expect(inst.kind).toBe("tof");
    expect(inst.name).toBe("POWGEN");
    expect(isPowgenTof(pg3Pattern(), inst)).toBe(true);
  });

  it("is not POWGEN without the name, on another TOF instrument, with a CW instrument, or on a 2θ pattern", () => {
    // Data under a name that is not a POWGEN run file's, so only the instrument file can name it.
    const pattern = renamed("bank1.fxye");
    const unnamed = unnamedInstrument();
    expect(unnamed.name).toBeUndefined();
    expect(isPowgenTof(pattern, unnamed)).toBe(false);
    const nomad = parseInstrumentParameters(PG3_INSTRUMENT.text.replaceAll("PG3", "NOMAD"));
    expect(nomad.name).toBe("NOMAD");
    expect(isPowgenTof(pattern, nomad)).toBe(false);
    expect(isPowgenTof(pattern, parseInstrumentParameters(CW_INSTRUMENT.text))).toBe(false);
    expect(isPowgenTof({ xUnit: "twoTheta" }, pg3Instrument())).toBe(false);
    expect(isPowgenTof(pattern, null)).toBe(false);
  });

  it("names POWGEN from a data file named PG3_…: the base name's start, in any case, nothing looser", () => {
    for (const name of ["PG3_45598_Bank1.fxye", "PG3_12345-3.dat", "PG3_12345.gsa", "pg3_12345.gsa", "Pg3_1.dat", "/data/run/PG3_1.gsa", "C:\\runs\\PG3_1.gsa", "runs/PG3_45598_Bank1.fxye"]) {
      expect(instrumentHintFromFileName(name)?.name, name).toBe("POWGEN");
    }
    for (const name of ["NOM_12345.dat", "nom_12345.dat", "/sns/NOM_1.gsa"]) expect(instrumentHintFromFileName(name)?.name, name).toBe("NOMAD");
    for (const name of ["PG3-1.gsa", "PG31.gsa", "PG3.gsa", "xPG3_1.gsa", "my_PG3_1.gsa", " PG3_1.gsa", "PG3_dir/sample.dat", "C:\\PG3_runs\\sample.dat",
      "NOM-1.dat", "NOMAD_1.dat", "xNOM_1.dat", "NOM_dir/sample.dat", "HRP_1.dat", "data", "bank1.fxye", "", undefined]) {
      expect(instrumentHintFromFileName(name), String(name)).toBeUndefined();
    }
  });

  it("a PG3_ data file is POWGEN with an instrument file that names neither POWGEN nor PG3 — TOF data on a TOF calibration only", () => {
    const unnamed = unnamedInstrument();
    expect(isPowgenTof(pg3Pattern(), unnamed)).toBe(true);
    expect(isPowgenTof(renamed("pg3_45598_bank1.fxye"), unnamed)).toBe(true);
    expect(isPowgenTof({ xUnit: "twoTheta", name: "PG3_45598_Bank1.fxye" }, unnamed)).toBe(false);
    expect(isPowgenTof({ xUnit: "dSpacing", name: "PG3_45598_Bank1.fxye" }, unnamed)).toBe(false);
    expect(isPowgenTof(pg3Pattern(), parseInstrumentParameters(CW_INSTRUMENT.text))).toBe(false);
    expect(isPowgenTof(pg3Pattern(), null)).toBe(false);
  });
});

describe("the POWGEN page starts on log interpolation with three points", () => {
  it.each(ORDERS)("loaded in the order %s, %s, %s", (...order) => {
    const s = pg3Page(...order).session;
    expect(s.powderProfile.shape).toBe("tof");
    expect(s.powderProfile.backgroundType).toBe("logInterpolate");
    expect(s.backgroundTerms).toBe(3);
    const rows = backgroundRows(s);
    expect(rows).toHaveLength(3);
    // Seeded in its own basis — heights, the data's lower envelope at the
    // three log-spaced points — not Chebyshev coefficients read as heights
    // (the four-term Chebyshev seeds here are 31.9, −20.5, −12.1, −14.2).
    const seeds = estimateBackground(s.pattern.points.map((p) => p.x), s.pattern.points.map((p) => p.yObs), "logInterpolate", 3);
    expect(rows.map((r) => r.value)).toEqual(seeds);
    for (const r of rows) expect(r.value).toBeGreaterThan(0);
    expect(profileRequest(s).backgroundType).toBe("logInterpolate");
  });

  it("fits the 350 K bank at least as well as the four-term Chebyshev default, with one parameter fewer", () => {
    const page = pg3Page("cif", "instrument", "data");
    const fit = (s: Session) => {
      const free = new Set(["scale", "background", "cellLength"]);
      const params = s.powderParams.map((p) => ({ ...p, fixed: !free.has(p.kind) }));
      return refine(buildPowderProblem(s.structure, s.pattern, params, s.powderBindings, s.powderProfile), { maxIterations: 40 });
    };
    const log3 = fit(page.session);
    const cheb4 = fit(withBackgroundTerms(withBackgroundType(page.session, "chebyshev"), 4, page.instrument));
    expect(log3.status).toBe("converged");
    expect(cheb4.status).toBe("converged");
    // Measured before the change on the same data and model: 8.896 % against 9.000 %.
    expect(log3.agreement.rWeighted!).toBeLessThanOrEqual(cheb4.agreement.rWeighted!);
  });
});

describe("a PG3_ data file with an instrument file that names neither POWGEN nor PG3", () => {
  const load = (name: string) => (p: PowderPage, what: Load): PowderPage =>
    what === "cif" ? withStructure(p, pg3Structure()) : what === "data" ? withPattern(p, renamed(name), { ...PG3_DATA, name }) : withInstrument(p, unnamedInstrument(), { ...PG3_INSTRUMENT, name: "bank1.instprm" });

  it.each(ORDERS)("starts on log interpolation with three points, loaded in the order %s, %s, %s", (...order) => {
    const s = order.reduce(load("PG3_45598_Bank1.fxye"), emptyPage()).session;
    expect(s.powderProfile.shape).toBe("tof");
    expect(s.powderProfile.backgroundType).toBe("logInterpolate");
    expect(s.backgroundTerms).toBe(3);
    expect(backgroundRows(s)).toHaveLength(3);
  });

  it("in lower case too (pg3_…)", () => {
    const s = (["cif", "instrument", "data"] as Load[]).reduce(load("pg3_45598_bank1.fxye"), emptyPage()).session;
    expect(s.powderProfile.backgroundType).toBe("logInterpolate");
    expect(s.backgroundTerms).toBe(3);
  });

  it("the user's basis and count stay through rebuilds that keep the data", () => {
    const page = (["cif", "instrument", "data"] as Load[]).reduce(load("PG3_45598_Bank1.fxye"), emptyPage());
    const chosen = withBackgroundTerms(withBackgroundType(page.session, "chebyshev"), 6, page.instrument);
    const rebuilt = withCorrections(withPhase(chosen, { ...pg3Structure(), id: "second", name: "second" }, page.instrument), { peak: ["absorption"] }, page.instrument);
    expect(rebuilt.powderProfile.backgroundType).toBe("chebyshev");
    expect(rebuilt.backgroundTerms).toBe(6);
    expect(backgroundRows(rebuilt)).toHaveLength(6);
  });

  it("MCP build_refinement: POWGEN's default from the data's name (a path's base name too), unless the call names a basis or a count", () => {
    const count = (r: ReturnType<typeof build_refinement>) => r.parameters.filter((p) => p.kind === "background").length;
    const args = { structure: pg3Structure(), pattern: pg3Pattern(), instrument: unnamedInstrument() };
    const own = build_refinement(args);
    expect(own.profile.backgroundType).toBe("logInterpolate");
    expect(count(own)).toBe(3);
    const path = build_refinement({ ...args, pattern: renamed("runs/PG3_45598_Bank1.fxye") });
    expect(path.profile.backgroundType).toBe("logInterpolate");
    expect(count(path)).toBe(3);
    const cheb = build_refinement({ ...args, backgroundType: "chebyshev" });
    expect(cheb.profile.backgroundType).toBe("chebyshev");
    expect(count(cheb)).toBe(4);
    const five = build_refinement({ ...args, backgroundTerms: 5 });
    expect(five.profile.backgroundType).toBe("logInterpolate");
    expect(count(five)).toBe(5);
    const other = build_refinement({ ...args, pattern: renamed("bank1.fxye") });
    expect(other.profile.backgroundType).toBeUndefined();
    expect(count(other)).toBe(4);
  });
});

describe("the instrument file's own name wins over the PG3_ data name", () => {
  const nomad = (): InstrumentParameters => parseInstrumentParameters(PG3_INSTRUMENT.text.replaceAll("PG3", "NOMAD"));
  const vulcan = (): InstrumentParameters => parseInstrumentParameters(PG3_INSTRUMENT.text.replaceAll("PG3", "VULCAN"));
  const page = (inst: InstrumentParameters, data: PowderPattern, order: Load[]) => order.reduce((p: PowderPage, what: Load) =>
    what === "cif" ? withStructure(p, pg3Structure()) : what === "data" ? withPattern(p, data, { ...PG3_DATA, name: data.name }) : withInstrument(p, inst, { ...PG3_INSTRUMENT, name: "bank1.instprm" }), emptyPage()).session;

  it.each([["cif", "instrument", "data"], ["data", "instrument", "cif"]] as Load[][])("PG3_ data with an instrument file naming NOMAD or VULCAN: Chebyshev, four terms (order %s, %s, %s)", (...order) => {
    for (const inst of [nomad(), vulcan()]) {
      expect(inst.kind).toBe("tof");
      expect(isPowgenTof(pg3Pattern(), inst)).toBe(false);
      const s = page(inst, pg3Pattern(), order);
      expect(s.powderProfile.shape).toBe("tof");
      expect(s.powderProfile.backgroundType).toBeUndefined();
      expect(s.backgroundTerms).toBe(4);
      expect(backgroundRows(s)).toHaveLength(4);
    }
  });

  it("PG3_ data with an instrument file naming POWGEN, or naming none: log interpolation, three points", () => {
    for (const inst of [pg3Instrument(), unnamedInstrument()]) {
      const s = page(inst, pg3Pattern(), ["cif", "instrument", "data"]);
      expect(s.powderProfile.backgroundType).toBe("logInterpolate");
      expect(backgroundRows(s)).toHaveLength(3);
    }
  });

  it("other data with an instrument file naming POWGEN: log interpolation, three points", () => {
    const s = page(pg3Instrument(), renamed("bank1.fxye"), ["cif", "instrument", "data"]);
    expect(s.powderProfile.backgroundType).toBe("logInterpolate");
    expect(backgroundRows(s)).toHaveLength(3);
  });

  it("MCP build_refinement: PG3_ data with a NOMAD-named instrument file gets the general default", () => {
    const r = build_refinement({ structure: pg3Structure(), pattern: pg3Pattern(), instrument: nomad() });
    expect(r.profile.backgroundType).toBeUndefined();
    expect(r.parameters.filter((p) => p.kind === "background")).toHaveLength(4);
  });
});

describe("the data file's name as a soft instrument hint (PG3_ → POWGEN, NOM_ → NOMAD)", () => {
  const named = (name: string) => parseInstrumentParameters(PG3_INSTRUMENT.text.replaceAll("PG3", name));
  const page = (inst: InstrumentParameters, data: PowderPattern, order: Load[] = ["cif", "instrument", "data"]) => order.reduce((p: PowderPage, what: Load) =>
    what === "cif" ? withStructure(p, pg3Structure()) : what === "data" ? withPattern(p, data, { ...PG3_DATA, name: data.name }) : withInstrument(p, inst, { ...PG3_INSTRUMENT, name: "bank1.instprm" }), emptyPage());

  it.each(ORDERS)("NOM_ data with an unnamed instrument file: guessed NOMAD, which has no default of its own — Chebyshev, four terms (order %s, %s, %s)", (...order) => {
    const data = renamed("NOM_12345.dat");
    expect(pageInstrument(data, unnamedInstrument())).toEqual({ name: "NOMAD", guessed: true });
    const s = page(unnamedInstrument(), data, order).session;
    expect(s.powderProfile.shape).toBe("tof");
    expect(s.powderProfile.backgroundType).toBeUndefined();
    expect(s.backgroundTerms).toBe(4);
    const r = build_refinement({ structure: pg3Structure(), pattern: data, instrument: unnamedInstrument() });
    expect(r.profile.backgroundType).toBeUndefined();
    expect(r.parameters.filter((p) => p.kind === "background")).toHaveLength(4);
  });

  it("NOM_ data with a POWGEN-named instrument file: POWGEN, log interpolation with three points", () => {
    const data = renamed("NOM_12345.dat");
    expect(pageInstrument(data, pg3Instrument())).toEqual({ name: "POWGEN", guessed: false });
    const s = page(pg3Instrument(), data).session;
    expect(s.powderProfile.backgroundType).toBe("logInterpolate");
    expect(s.backgroundTerms).toBe(3);
  });

  it("PG3_ data with a NOMAD-named instrument file: NOMAD, the general default", () => {
    expect(pageInstrument(pg3Pattern(), named("NOMAD"))).toEqual({ name: "NOMAD", guessed: false });
    const s = page(named("NOMAD"), pg3Pattern()).session;
    expect(s.powderProfile.backgroundType).toBeUndefined();
    expect(s.backgroundTerms).toBe(4);
  });

  it("PG3_ data with an unnamed instrument file: guessed POWGEN; an unknown prefix: no guess, the general default", () => {
    expect(pageInstrument(pg3Pattern(), unnamedInstrument())).toEqual({ name: "POWGEN", guessed: true });
    for (const name of ["bank1.fxye", "HRP_1.dat"]) {
      expect(pageInstrument(renamed(name), unnamedInstrument())).toBeNull();
      const s = page(unnamedInstrument(), renamed(name)).session;
      expect(s.powderProfile.backgroundType).toBeUndefined();
      expect(s.backgroundTerms).toBe(4);
    }
  });

  it("no guess against a constant-wavelength calibration", () => {
    const cw = parseInstrumentParameters(CW_INSTRUMENT.text);
    expect(pageInstrument({ name: "PG3_30k.xye" }, cw)).toBeNull();
    expect(pageInstrument({ name: "NOM_30k.xye" }, cw)).toBeNull();
  });

  it("the guess is not saved as the instrument file's: the project keeps the instrument unnamed and the page's background as it was", () => {
    const p = page(unnamedInstrument(), pg3Pattern());
    expect(p.instrument.name).toBeUndefined();
    expect(p.instrument.facility).toBeUndefined();
    const ws = powderWorkspaceFrom(p.session, null, p.instrument, true, { fitRange: null, displayUnit: null, manualPeakD: [] });
    const file = parseProject(serializeProject(projectFileFor({ structures: [p.session.structure], workspace: ws, title: "t" })));
    if (file.workspace.technique !== "powder") throw new Error("technique");
    expect(file.workspace.instrument.name).toBeUndefined();
    expect(file.workspace.instrument.facility).toBeUndefined();
    const back = sessionFromPowderWorkspace(file.workspace, file.structures);
    expect(back.instrument.name).toBeUndefined();
    expect(back.instrument).toEqual(p.instrument);
    expect(back.session.powderProfile.backgroundType).toBe("logInterpolate");
    expect(back.session.powderParams).toEqual(p.session.powderParams);
  });
});

describe("every other page keeps the general default", () => {
  it.each(ORDERS)("constant-wavelength data, loaded in the order %s, %s, %s: Chebyshev, four terms", (...order) => {
    const s = order.reduce(cwLoad, emptyPage()).session;
    expect(s.powderProfile.backgroundType).toBeUndefined();
    expect(s.backgroundTerms).toBe(4);
    expect(backgroundRows(s)).toHaveLength(4);
  });

  it("TOF data not named PG3_ read with an instrument file that does not name POWGEN: Chebyshev, four terms", () => {
    const s = withPattern(withInstrument(withStructure(emptyPage(), pg3Structure()), unnamedInstrument()), renamed("bank1.fxye"), { ...PG3_DATA, name: "bank1.fxye" }).session;
    expect(s.powderProfile.backgroundType).toBeUndefined();
    expect(s.backgroundTerms).toBe(4);
    expect(backgroundRows(s)).toHaveLength(4);
  });

  it.each(ORDERS)("constant-wavelength data named PG3_…, loaded in the order %s, %s, %s: Chebyshev, four terms", (...order) => {
    const load = (p: PowderPage, what: Load): PowderPage => what === "data" ? withPattern(p, { ...cwPattern(p), name: "PG3_30k.xye" }, { ...CW_DATA, name: "PG3_30k.xye" }) : cwLoad(p, what);
    const s = order.reduce(load, emptyPage()).session;
    expect(s.pattern.name).toBe("PG3_30k.xye");
    expect(s.pattern.xUnit).not.toBe("tof");
    expect(s.powderProfile.backgroundType).toBeUndefined();
    expect(s.backgroundTerms).toBe(4);
    expect(backgroundRows(s)).toHaveLength(4);
  });

  it("other data after POWGEN's go back to the general count, not POWGEN's three", () => {
    const after = cwLoad(cwLoad(pg3Page("cif", "instrument", "data"), "instrument"), "data").session;
    expect(after.powderProfile.backgroundType).toBeUndefined();
    expect(after.backgroundTerms).toBe(4);
  });
});

describe("the user's choice on a POWGEN page", () => {
  it("a basis and a count chosen stay through rebuilds that keep the data", () => {
    const page = pg3Page("cif", "instrument", "data");
    const chosen = withBackgroundTerms(withBackgroundType(page.session, "chebyshev"), 6, page.instrument);
    expect(chosen.powderProfile.backgroundType).toBe("chebyshev");
    expect(backgroundRows(chosen)).toHaveLength(6);
    const rebuilt = withCorrections(withPhase(chosen, { ...pg3Structure(), id: "second", name: "second" }, page.instrument), { peak: ["absorption"] }, page.instrument);
    expect(rebuilt.powderProfile.backgroundType).toBe("chebyshev");
    expect(rebuilt.backgroundTerms).toBe(6);
  });

  it("a new count on log interpolation keeps the curve: the heights are read off it at the new points", () => {
    const page = pg3Page("cif", "instrument", "data");
    const before = curveOf(page.session);
    const s = withBackgroundTerms(page.session, 5, page.instrument);
    expect(s.powderProfile.backgroundType).toBe("logInterpolate");
    expect(backgroundRows(s)).toHaveLength(5);
    const { min, max } = xRange(s);
    const after = curveOf(s);
    for (const x of interpAnchors(5, min, max, true)) expect(after(x)).toBeCloseTo(before(x), 9);
    // Back to three points: the original curve, since its points are among the five's.
    const back = curveOf(withBackgroundTerms(s, 3, page.instrument));
    for (const x of interpAnchors(3, min, max, true)) expect(back(x)).toBeCloseTo(before(x), 9);
  });

  it("MCP build_refinement: POWGEN's default, unless the call names a basis or a count", () => {
    const args = { structure: pg3Structure(), pattern: pg3Pattern(), instrument: pg3Instrument() };
    const count = (r: ReturnType<typeof build_refinement>) => r.parameters.filter((p) => p.kind === "background").length;
    const own = build_refinement(args);
    expect(own.profile.backgroundType).toBe("logInterpolate");
    expect(count(own)).toBe(3);
    const cheb = build_refinement({ ...args, backgroundType: "chebyshev" });
    expect(cheb.profile.backgroundType).toBe("chebyshev");
    expect(count(cheb)).toBe(4);
    const five = build_refinement({ ...args, backgroundTerms: 5 });
    expect(five.profile.backgroundType).toBe("logInterpolate");
    expect(count(five)).toBe(5);
    const cw = build_refinement({ structure: { ...parseCif(CW_CIF.text, "loaded"), id: "loaded" }, pattern: cwPattern(emptyPage()), instrument: parseInstrumentParameters(CW_INSTRUMENT.text) });
    expect(cw.profile.backgroundType).toBeUndefined();
    expect(count(cw)).toBe(4);
  });
});

describe("a saved project keeps its own background", () => {
  it("a POWGEN project saved on Chebyshev reopens on Chebyshev, and a rebuild keeps it", () => {
    const page = pg3Page("cif", "instrument", "data");
    // As a project saved before the POWGEN default: the basis unnamed (Chebyshev), four terms.
    const chebyshev = withBackgroundTerms(withBackgroundType(page.session, "chebyshev"), 4, page.instrument);
    const { backgroundType: _named, ...profile } = chebyshev.powderProfile;
    const saved: Session = { ...chebyshev, powderProfile: profile };
    const ws = powderWorkspaceFrom(saved, null, page.instrument, true, { fitRange: null, displayUnit: null, manualPeakD: [] });
    const file = parseProject(serializeProject(projectFileFor({ structures: [saved.structure], workspace: ws, title: "t" })));
    if (file.workspace.technique !== "powder") throw new Error("technique");
    const back = sessionFromPowderWorkspace(file.workspace, file.structures);
    expect(back.session.powderProfile.backgroundType).toBeUndefined();
    expect(back.session.backgroundTerms).toBe(4);
    expect(back.session.powderParams).toEqual(saved.powderParams);
    const more = withBackgroundTerms(back.session, 5, back.instrument);
    expect(more.powderProfile.backgroundType).toBeUndefined();
    expect(backgroundRows(more)).toHaveLength(5);
  });
});

describe("the log-interpolation seeds and the report's words", () => {
  it("seeds each height at its own log-spaced point, not at the evenly spaced one", () => {
    const xs = Array.from({ length: 4000 }, (_, i) => 3000 * Math.exp((i / 3999) * Math.log(130000 / 3000)));
    const f = (x: number) => 20 + 100 * Math.exp(-x / 30000);
    const seeds = estimateBackground(xs, xs.map(f), "logInterpolate", 3);
    const at = interpAnchors(3, xs[0]!, xs[xs.length - 1]!, true);
    // The middle point is the geometric mean (≈ 19 750 µs, f ≈ 71.8); the
    // evenly spaced one (66 500 µs) reads f ≈ 30.9, 57 % below. The envelope is
    // read from the nearest of ten windows, each a factor 1.46 wide in x here,
    // over which f changes by ±8 % around the point: 10 % is that window's spread.
    expect(Math.abs(seeds[1]! - f(at[1]!))).toBeLessThan(0.1 * f(at[1]!));
    expect(Math.abs(seeds[0]! - f(at[0]!))).toBeLessThan(0.1 * f(at[0]!));
    expect(Math.abs(seeds[2]! - f(at[2]!))).toBeLessThan(0.1 * f(at[2]!));
  });

  it("names the basis the page refines", () => {
    expect(backgroundLabel(undefined, 4)).toBe("Chebyshev polynomial, 4 terms");
    expect(backgroundLabel(POWGEN_BACKGROUND.type, POWGEN_BACKGROUND.terms)).toBe("log interpolation, 3 points evenly spaced in log x");
  });
});

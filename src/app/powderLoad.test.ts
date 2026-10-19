import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parsePowderData } from "@/parsers/powderData";
import { detectDataFormat } from "@/parsers/detectFormat";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";
import { isMagneticModelParameterKind, type RefinementResult } from "@/core/refinement/types";
import { buildPowderSpec } from "@/app/powderSpec";
import { DEFAULT_INSTRUMENT, loadedSession } from "@/app/powderSession";
import { exampleMagnetic, magneticBindings, magneticParameters } from "@/examples/mn3gaMagnetic";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { example3Loaded } from "@/agent/validation/example3";
import {
  changed, emptyPage, powderPageCurves, withCorrections, withFit, withInstrument, withInstrumentConstants, withMagneticModelRows, withMustrain,
  withPattern, withPhase, withStructure, type PowderPage,
} from "@/app/powderPage";

/**
 * Files loaded onto the powder page (powderPage.ts: withStructure,
 * withPattern, withInstrument), as the shell routes them once it has parsed
 * them. The shell once rebuilt the page in each of its loaders, each with its
 * own rules: a CIF loaded onto data replaced the data with a synthetic
 * pattern, new data kept the microstrain setting without its rows and the
 * Lorentz flag of the old file, and a new instrument put the refined
 * structure back to the CIF's values.
 */

const DIR = resolve(__dirname, "../../examples/mcp");
const file = (name: string): { name: string; text: string } => ({ name, text: readFileSync(resolve(DIR, name), "utf8") });
const CIF = file("mn3ga_30k_nuclear.cif");
const DATA = file("mn3ga_30k_sim.xye");
const INSTRUMENT = file("mn3ga_30k.instprm");
const structure = (): StructureModel => ({ ...parseCif(CIF.text, "loaded"), id: "loaded" });
const instrument = (): InstrumentParameters => parseInstrumentParameters(INSTRUMENT.text);

/** The data as the shell parses them for the page: detected with the instrument it has loaded, the pattern named after the page's structure. */
function pattern(p: PowderPage, f = DATA): PowderPattern {
  const fmt = detectDataFormat({ text: f.text, filename: f.name, instrument: p.instrumentLoaded ? p.instrument : undefined });
  return parsePowderData(f.text, {
    id: `${p.session.structure.id}-powder`, name: f.name, xUnit: fmt.xUnit, radiation: fmt.radiation,
    ...(fmt.radiation.kind !== "neutron-tof" ? { wavelength: fmt.radiation.wavelength } : {}),
  });
}

type Load = "cif" | "data" | "instrument";
const load = (p: PowderPage, what: Load): PowderPage =>
  what === "cif" ? withStructure(p, structure()) : what === "data" ? withPattern(p, pattern(p), DATA) : withInstrument(p, instrument(), INSTRUMENT);
const loaded = (...order: Load[]): PowderPage => order.reduce(load, emptyPage());

/** What a refinement starts from: each row's value and state, and the curve they calculate. */
const rowsOf = (p: PowderPage) => p.session.powderParams.map((r) => ({ id: r.id, kind: r.kind, value: r.value, fixed: r.fixed }));
const yCalc = (p: PowderPage) => powderPageCurves(p.session).curves.yCalc;

/** A fit's numbers, for a page that has one. */
const RESULT = { parameters: {}, agreement: { rWeighted: 0.1 } } as unknown as RefinementResult;

/** The page after a fit moved the structure (the cell), with a result on it. */
function fitted(p: PowderPage): PowderPage {
  return { ...p, session: { ...p.session, powderParams: p.session.powderParams.map((r) => (r.kind === "cellLength" ? { ...r, value: r.value * 1.01 } : r)) }, result: RESULT };
}

describe("a CIF loaded onto data", () => {
  it("keeps the data and builds its rows on them, whichever order the three files come in", () => {
    const first = loaded("cif", "instrument", "data");
    expect(first.session.pattern.points.length).toBeGreaterThan(1000);
    for (const order of [["cif", "data", "instrument"], ["data", "cif", "instrument"], ["instrument", "data", "cif"], ["data", "instrument", "cif"]] as Load[][]) {
      const p = loaded(...order);
      expect(p.session.powderSource, order.join(" → ")).toBe(DATA.name);
      expect(p.session.rawData?.name, order.join(" → ")).toBe(DATA.name);
      expect(p.session.pattern.points.map((pt) => pt.yObs), order.join(" → ")).toEqual(first.session.pattern.points.map((pt) => pt.yObs));
      expect(p.session.pattern.radiation, order.join(" → ")).toEqual(first.session.pattern.radiation);
      expect(rowsOf(p), order.join(" → ")).toEqual(rowsOf(first));
      const [a, b] = [yCalc(p), yCalc(first)];
      expect(Math.max(...a.map((y, i) => Math.abs(y - b[i]!))), order.join(" → ")).toBeLessThan(1e-9 * Math.max(...b));
    }
  });

  it("carries a magnetic CIF's model onto the data, and starts afresh from the CIF on a page without data", () => {
    const { structure: magStructure, magnetic } = exampleMagnetic();
    const onData = withStructure(loaded("data"), magStructure, magnetic);
    expect(onData.session.powderSource).toBe(DATA.name);
    expect(onData.session.magnetic).toBe(magnetic);
    const onCif = withStructure(loaded("cif"), magStructure);
    expect(onCif.session.powderSource).not.toBe(DATA.name);
    expect(onCif.session.magnetic).toBeUndefined();
    expect(onCif.session.structure).toBe(magStructure);
  });
});

describe("new data on the page", () => {
  it("starts its own profile: Lorentz on, the microstrain model, corrections and added phases gone, the structure where the fit left it", () => {
    const p0 = loaded("cif", "instrument", "data");
    // A two-phase page, fitted (its rows are the multi-phase spec's, the main phase's prefixed p0_).
    const busy = fitted({
      ...p0,
      session: withPhase(
        withCorrections(withMustrain({ ...p0.session, powderProfile: { ...p0.session.powderProfile, lorentz: false } }, "generalized", p0.instrument), { asymmetry: true }, p0.instrument),
        { ...structure(), id: "second", name: "second" },
        p0.instrument,
      ),
    });
    expect(busy.session.powderParams.some((r) => r.kind === "stephensStrain")).toBe(true);
    const next = withPattern(busy, pattern(busy), { ...DATA, name: "second_run.xye" });
    expect(next.result).toBeNull();
    expect(next.session.powderSource).toBe("second_run.xye");
    expect(next.session.powderProfile.lorentz).toBe(true);
    // The menu shows the model the rows have: isotropic, without Stephens rows.
    expect(next.session.mustrain).toBeUndefined();
    expect(next.session.powderParams.some((r) => r.kind === "stephensStrain")).toBe(false);
    expect(next.session.corrections).toBeUndefined();
    expect(next.session.extraPhases).toEqual([]);
    const cell = (p: PowderPage, prefix = "") => p.session.powderParams.filter((r) => r.kind === "cellLength" && r.id.startsWith(prefix)).map((r) => r.value);
    expect(cell(next)).toEqual(cell(busy, "p0_"));
    expect(cell(next)).not.toEqual(cell(p0));
  });

  it("keeps a magnetic model on show without its rows", () => {
    const { magnetic } = exampleMagnetic();
    const p0 = loaded("cif", "instrument", "data");
    const rows = magneticParameters(magnetic).filter((r) => isMagneticModelParameterKind(r.kind));
    const bindings = magneticBindings(magnetic).filter((b) => isMagneticModelParameterKind(b.kind));
    const withModel = changed(p0, withMagneticModelRows(p0.session, magnetic, rows, bindings));
    const next = withPattern(withModel, pattern(withModel), DATA);
    expect(next.session.magnetic).toBe(magnetic);
    expect(next.session.powderParams.some((r) => isMagneticModelParameterKind(r.kind))).toBe(false);
  });

  it("goes back to the default instrument when a TOF one cannot place constant-wavelength peaks", () => {
    const tof = mn3gaPowgenExample().instrument;
    const p = withPattern(withInstrument(loaded("cif"), tof), pattern(emptyPage()), DATA);
    expect(p.instrumentLoaded).toBe(false);
    expect(p.instrument).toBe(DEFAULT_INSTRUMENT);
  });

  it("from a constant-wavelength reader that names its own neutron λ builds the rows the default instrument builds", () => {
    // The ILL and INSTRM=6 loaders once built their rows with an instrument of their own: neutron, the file's λ.
    const p = loaded("cif");
    const data = { ...pattern(p), radiation: { kind: "neutron" as const, wavelength: 2.52 }, wavelength: 2.52 };
    const own = buildPowderSpec(p.session.structure, data, { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.52 }, true, 4, { positions: true, adp: true });
    const viaPage = withPattern(p, data, DATA).session;
    expect(viaPage.powderParams).toEqual(own.params);
    expect(viaPage.powderProfile).toEqual(own.profile);
  });
});

describe("a new instrument on the page", () => {
  it("keeps the structure where the fit left it and the magnetic rows, and seeds the profile from the instrument", () => {
    const { magnetic } = exampleMagnetic();
    const p0 = fitted(loaded("cif", "data"));
    const rows = magneticParameters(magnetic).filter((r) => isMagneticModelParameterKind(r.kind)).map((r) => ({ ...r, value: r.value + 0.5 }));
    const bindings = magneticBindings(magnetic).filter((b) => isMagneticModelParameterKind(b.kind));
    const before: PowderPage = { ...p0, session: withMagneticModelRows(p0.session, magnetic, rows, bindings) };
    const next = withInstrument(before, instrument(), INSTRUMENT);
    expect(next.result).toBeNull();
    expect(next.instrumentLoaded).toBe(true);
    expect(next.session.rawInstrument?.name).toBe(INSTRUMENT.name);
    const value = (p: PowderPage, kind: string) => p.session.powderParams.filter((r) => r.kind === kind).map((r) => r.value);
    expect(value(next, "cellLength")).toEqual(value(before, "cellLength"));
    expect(value(next, "profileU")).toEqual([(instrument() as { u: number }).u]);
    expect(value(before, "profileU")).not.toEqual(value(next, "profileU"));
    expect(next.session.powderParams.filter((r) => isMagneticModelParameterKind(r.kind))).toEqual(rows);
    expect(next.session.pattern.radiation).toMatchObject({ kind: "neutron", wavelength: 1.54 });
  });

  it("makes the order of data and instrument after a fit not matter", () => {
    const p0 = fitted(loaded("cif", "instrument", "data"));
    const dataThenInstrument = withInstrument(withPattern(p0, pattern(p0), DATA), instrument(), INSTRUMENT);
    const instrumentThenData = ((p: PowderPage) => withPattern(p, pattern(p), DATA))(withInstrument(p0, instrument(), INSTRUMENT));
    expect(rowsOf(dataThenInstrument)).toEqual(rowsOf(instrumentThenData));
  });

  it("on a page with nothing loaded is kept for the next load", () => {
    const p = withInstrument(emptyPage(), instrument(), INSTRUMENT);
    expect(p.session.powderSource).toBe(emptyPage().session.powderSource);
    expect(p.session.rawInstrument?.name).toBe(INSTRUMENT.name);
    expect(load(p, "cif").session.rawInstrument?.name).toBe(INSTRUMENT.name);
  });
});

describe("TOF data on the page", () => {
  it("refines with a TOF instrument, is view-only without one, and a CIF loaded onto it keeps it so", () => {
    const ex = mn3gaPowgenExample();
    const start = withStructure(emptyPage(), ex.structure);
    const viewOnly = withPattern(start, ex.pattern, { name: "powgen.gsa", text: "" });
    expect(viewOnly.session.powderProfile.shape).toBe("gaussian");
    expect(withStructure(viewOnly, ex.structure).session.powderProfile.shape).toBe("gaussian");
    expect(withInstrument(viewOnly, ex.instrument).session.powderProfile.shape).toBe("tof");
    expect(withPattern(withInstrument(start, ex.instrument), ex.pattern).session.powderProfile.shape).toBe("tof");
  });
});

describe("the page's result", () => {
  it("goes with every change that makes it out of date, and a fit puts its own", () => {
    const p = fitted(loaded("cif", "instrument", "data"));
    expect(p.result).toBe(RESULT);
    for (const next of [
      withPattern(p, pattern(p), DATA), withInstrument(p, instrument()), withStructure(p, structure()),
      withInstrumentConstants(p, { polarization: 0.5 }), changed(p, p.session),
    ]) expect(next.result).toBeNull();
    const cellId = p.session.powderParams.find((r) => r.kind === "cellLength")!.id;
    const fit = withFit(changed(p, p.session), { ...RESULT, parameters: { [cellId]: 6.5 } } as RefinementResult);
    expect(fit.result?.agreement.rWeighted).toBe(0.1);
    expect(fit.session.powderParams.find((r) => r.id === cellId)!.value).toBe(6.5);
  });
});

describe("the evals' and the validation's pages", () => {
  it("open as the app opens the files: the rows of the old builder, the file's name as the source", () => {
    const s = example3Loaded();
    const old = loadedSession(s.structure, s.pattern, instrument());
    expect(s.powderParams).toEqual(old.powderParams);
    expect(s.powderBindings).toEqual(old.powderBindings);
    expect(s.powderProfile).toEqual(old.powderProfile);
    expect(s.powderSource).toBe("mn3ga_30k_sim.xye");
  });
});

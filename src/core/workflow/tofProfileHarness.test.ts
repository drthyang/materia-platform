/**
 * The app's side of the TOF-profile comparison (docs/reports/2026-11-21-tof-profile-assignment.md).
 * Opt-in: it runs only when MATERIA_TOF_PROFILE_JOB names a job file, and writes its result where
 * the job says, outside the repository. It changes nothing: it calls the page's own path
 * (parseInstrumentFile → buildPowderSpec → placePeaks → synthesizePattern, and refine for a fit)
 * and writes down what comes out. scripts/tof-profile/ holds the independent side.
 *
 * Job file (JSON):
 *   { "out": "<result.json>",
 *     "peaks": [{ "name", "instrumentFile", "bank"?: number, "d": number[], "halfWidths"?: 40, "n"?: 4001 }],
 *     "shapes": [{ "alpha", "beta", "sigma", "gamma", "form"?: "gsas" | "fullprof", "dt": number[] }],
 *     "bundles": [{ "name", "instrumentFile", "bank"?, "dataFile", "cifFile", "outDir", "set"?: { rowId: value } }],
 *     "fits":  [{ "name", "instrumentFile", "bank"?: number, "dataFile", "cifFile", "range": [min, max],
 *                 "backgroundTerms"?: 6, "freeKinds"?: ["scale", "background", "bIso"] }] }
 * A data file is whitespace columns x, y, sigma (lines starting with # or ! skipped).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { RefinementParameter } from "@/core/refinement/types";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentFile, instrumentBank, defaultInstrumentBank } from "@/parsers/instrument";
import { buildPowderSpec } from "@/app/powderSpec";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies } from "@/core/refinement/constraints";
import { placePeaks, buildPowderProblem } from "@/core/workflow/powder";
import { synthesizePattern, tofBackToBack, type TofLorentzForm } from "@/core/diffraction/profile";
import { refine } from "@/core/refinement/engine";
import { refinementBundle } from "@/core/export/bundle";

const JOB = process.env.MATERIA_TOF_PROFILE_JOB;

interface PeakJob { name: string; instrumentFile: string; bank?: number; d: number[]; halfWidths?: number; n?: number }
interface FitJob { name: string; instrumentFile: string; bank?: number; dataFile: string; cifFile: string; range: [number, number]; backgroundTerms?: number; freeKinds?: string[] }
interface ShapeJob { alpha: number; beta: number; sigma: number; gamma: number; form?: TofLorentzForm; dt: number[] }
interface BundleJob { name: string; instrumentFile: string; bank?: number; dataFile: string; cifFile: string; outDir: string; set?: Record<string, number> }
interface Job { out: string; peaks?: PeakJob[]; fits?: FitJob[]; shapes?: ShapeJob[]; bundles?: BundleJob[] }

const SI = `data_Si
_cell_length_a 5.43118
_cell_length_b 5.43118
_cell_length_c 5.43118
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M "F d -3 m:2"
loop_
_atom_site_type_symbol
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_U_iso_or_equiv
Si Si1 0.125 0.125 0.125 1 0.006
`;

function instrumentOf(file: string, bank?: number): InstrumentParameters {
  const parsed = parseInstrumentFile(readFileSync(file, "utf8"));
  const chosen = bank === undefined ? defaultInstrumentBank(parsed) : instrumentBank(parsed, bank);
  if (!chosen) throw new Error(`${file}: no bank ${bank}`);
  return chosen.parameters;
}

function readColumns(file: string): { x: number; yObs: number; sigma: number }[] {
  const points: { x: number; yObs: number; sigma: number }[] = [];
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const v = line.split(/\s+/).map(Number);
    if (v.length < 3 || v.some((n) => !Number.isFinite(n))) continue;
    points.push({ x: v[0]!, yObs: v[1]!, sigma: v[2]! });
  }
  return points;
}

const patternOf = (points: { x: number; yObs: number; sigma?: number }[]): PowderPattern =>
  ({ id: "harness", name: "harness", xUnit: "tof", radiation: { kind: "neutron-tof" }, points }) as PowderPattern;

const valuesOf = (params: readonly RefinementParameter[]): Record<string, number> => Object.fromEntries(params.map((p) => [p.id, p.value]));

describe.skipIf(!JOB || !existsSync(JOB ?? ""))("TOF profile harness: what the page draws and fits today", () => {
  it("writes the peaks and the fits the job asks for", () => {
    const job = JSON.parse(readFileSync(JOB!, "utf8")) as Job;
    const si: StructureModel = parseCif(SI, "si");
    const out: { peaks: unknown[]; fits: unknown[]; shapes?: number[][] } = { peaks: [], fits: [] };
    // The peak function itself, point by point (scripts/tof-profile/grid_check.py compares it with GSAS-II's routine).
    if (job.shapes) {
      out.shapes = job.shapes.map((sh) => sh.dt.map((dt) => tofBackToBack(dt, { alpha: sh.alpha, beta: sh.beta, sigma: sh.sigma, gamma: sh.gamma, ...(sh.form ? { lorentzForm: sh.form } : {}) })));
    }

    for (const pj of job.peaks ?? []) {
      const inst = instrumentOf(pj.instrumentFile, pj.bank);
      // The rows as the page builds them on load, on a pattern that spans the d asked for.
      const probe = patternOf([{ x: 100, yObs: 1 }, { x: 2e5, yObs: 1 }]);
      const spec = buildPowderSpec(si, probe, inst);
      const applied = applyParameters(si, spec.bindings, resolveTies(spec.params, valuesOf(spec.params)));
      const rows = Object.fromEntries(spec.params.filter((p) => /^(tof_|zero$|mustrain)/.test(p.id)).map((p) => [p.id, { value: p.value, fixed: p.fixed, min: p.min ?? null, max: p.max ?? null }]));
      const perD = pj.d.map((d) => {
        const [peak] = placePeaks(probe, applied, [{ d, intensity: 1 }]);
        if (!peak?.tof) throw new Error("no TOF peak");
        const half = (pj.halfWidths ?? 40) * (2.3548 * peak.tof.sigma + 1 / peak.tof.alpha + 1 / peak.tof.beta) / 4;
        const n = pj.n ?? 4001;
        const dt = Array.from({ length: n }, (_, i) => -half + (2 * half * i) / (n - 1));
        const y = synthesizePattern(dt.map((t) => peak.center + t), [peak], { shape: "tof" });
        return { d, center: peak.center, alpha: peak.tof.alpha, beta: peak.tof.beta, sigma: peak.tof.sigma, gamma: peak.tof.gamma ?? 0, dtMin: -half, dtMax: half, n, y: Array.from(y) };
      });
      out.peaks.push({ name: pj.name, rows, perD });
    }

    for (const fj of job.fits ?? []) {
      const inst = instrumentOf(fj.instrumentFile, fj.bank);
      const structure = parseCif(readFileSync(fj.cifFile, "utf8"), "phase");
      const pattern = patternOf(readColumns(fj.dataFile));
      const spec = buildPowderSpec(structure, pattern, inst, true, fj.backgroundTerms ?? 6);
      const free = new Set(fj.freeKinds ?? ["scale", "background", "bIso"]);
      const params = spec.params.map((p) => ({ ...p, fixed: !free.has(p.kind) }));
      const fitRange = { min: fj.range[0], max: fj.range[1] };
      const problem = buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile, [], fitRange);
      const t0 = Date.now();
      const result = refine(problem, { maxIterations: 40 });
      const ms = Date.now() - t0;
      const yCalc = problem.calculate({ ...valuesOf(params), ...result.parameters });
      let num = 0, den = 0, nObs = 0;
      for (let i = 0; i < pattern.points.length; i++) {
        const w = problem.weights[i]!;
        if (w <= 0) continue;
        const yo = pattern.points[i]!.yObs;
        num += w * (yo - yCalc[i]!) ** 2;
        den += w * yo * yo;
        nObs++;
      }
      out.fits.push({
        name: fj.name, status: result.status, iterations: result.history.length, ms, nObs,
        wR: Math.sqrt(num / den), rWeighted: result.agreement.rWeighted ?? null, gof: result.agreement.goodnessOfFit ?? null,
        free: params.filter((p) => !p.fixed).map((p) => p.id),
        parameters: Object.fromEntries(params.map((p) => [p.id, result.parameters[p.id] ?? p.value])),
        x: pattern.points.map((p) => p.x), yCalc: Array.from(yCalc),
      });
    }
    // The GSAS-II bundle of a session, written out as files, with the pattern the page calculates
    // (scripts/tof-profile/export_round_trip.py builds the project with GSAS-II and compares).
    const bundles: unknown[] = [];
    for (const bj of job.bundles ?? []) {
      const inst = instrumentOf(bj.instrumentFile, bj.bank);
      const structure = parseCif(readFileSync(bj.cifFile, "utf8"), "phase");
      const pattern = patternOf(readColumns(bj.dataFile));
      const spec = buildPowderSpec(structure, pattern, inst, true, 2);
      const params = spec.params.map((p) => (bj.set && p.id in bj.set ? { ...p, value: bj.set[p.id]!, initialValue: bj.set[p.id]! } : p));
      const yCalc = buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile).calculate(valuesOf(params));
      mkdirSync(bj.outDir, { recursive: true });
      const entries = refinementBundle("gsas2", structure, pattern, {
        name: bj.name, params, bindings: spec.bindings, instrument: inst,
        rawInstrument: { name: "instrument.instprm", text: readFileSync(bj.instrumentFile, "utf8") },
      });
      for (const e of entries) writeFileSync(join(bj.outDir, e.name), typeof e.data === "string" ? e.data : Buffer.from(e.data));
      bundles.push({ name: bj.name, files: entries.map((e) => e.name), x: pattern.points.map((p) => p.x), yCalc: Array.from(yCalc), parameters: valuesOf(params) });
    }
    writeFileSync(job.out, JSON.stringify(bundles.length ? { ...out, bundles } : out));
    expect((job.peaks ?? []).length + (job.fits ?? []).length + (job.shapes ?? []).length + (job.bundles ?? []).length).toBeGreaterThan(0);
  }, 1_500_000);
});

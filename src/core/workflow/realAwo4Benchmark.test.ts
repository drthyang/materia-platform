import { describe, it, expect, beforeAll } from "vitest";
import { parse_powder_data, parse_instrument, parse_structure, find_unexplained_peaks } from "@/mcp/tools";
import { buildPowderSpec } from "@/app/powderSpec";
import { buildPowderProblem, powderCurves } from "@/core/workflow/powder";
import { refineStaged } from "@/core/refinement/staged";
import { refine } from "@/core/refinement/engine";
import { DEFAULT_STAGE_KINDS, stagesFromKindGroups } from "@/core/workflow/structureRefinement";
import { dFromTof, tofFromD, type InstrumentParameters } from "@/core/diffraction/instrument";
import { detectExtraPeaks, annotateExtraPeaks } from "@/core/magnetic/extraPeaks";
import { applyParameters } from "@/core/workflow/apply";
import { generateReflections } from "@/core/diffraction/reflections";
import { satellitePositions, type KCandidate } from "@/core/magnetic/kSearch";
import { peakRows, PEAK_CRITERIA, searchK, candidatesOf, momentDims, rankCandidates, bestRanked, withinNoise, buildFor, type MagneticFit, type PeakRow, type RankEntry } from "@/app/magneticStep";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { momentCartesian } from "@/core/magnetic/moment";
import { noiseOf } from "@/core/magnetic/momentRestarts";
import { formatMagneticSymbol } from "@/core/magnetic/bnsOg";
import type { LatticeCandidate } from "@/core/magnetic/subgroupLattice";
import type { StructureModel, UnitCell } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { ParameterBinding, ParameterKind, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { Vec3 } from "@/core/math/types";
import { dataExists, readData } from "@/testSupport/data";

/**
 * BENCHMARK — magnetic refinement of the high-entropy tungstate AWO₄
 * ((Co,Cu,Fe,Mn,Ni,Zn)WO₄, P2/c) on POWGEN run 61113 at 8 K, bank 3, read
 * from the Mantid XYDATA export (`PG3_61113-3.dat`). The data are UNPUBLISHED:
 * they are read from the git-ignored data/ folder only, and this file holds no
 * number derived from them — only the criteria. Skips when the files are absent.
 *
 * Reference status. The nuclear model is checked against the user's GSAS-II
 * refinement at 100 K (trusted). For the magnetic part there is NO independent
 * reference (no magnetic group, moment or R values from another program): it is
 * checked for internal consistency only and is UNVERIFIED against an
 * independent result. The app-generated demo solution is not used.
 *
 * Instrument file: the 60 Hz frame at CWL 2.665 Å (B3). The file's abscissa is
 * the focused TOF (difC·d of a virtual 90° detector), so it spans a d range,
 * not one 16.7 ms frame: the first point sits at the backscattering limit
 * d = λ_min/2 of the B3 band only (C2). The full evidence, the plan and the
 * numbers are in the session's M5 record, outside the repository.
 *
 * Procedure: the app's own pipeline (my-rietveld-workflow → magnetic-analysis):
 * staged nuclear refinement → residual peaks → k-search → every magnetic group
 * of the little group of k ranked with the nuclear model held → the ★ group
 * co-refined with the nuclear model. Criteria the app does not meet today are
 * kept as stated and marked `it.fails`; when one starts to pass, the test turns
 * red and the benchmark record must be revisited — never loosen the criterion.
 */

const DIR = "AWO4";
const DATA = `${DIR}/autoreduced/PG3_61113-3.dat`;
const CIF = `${DIR}/AWO4_HE_100K_refined.cif`;
const INST = {
  B1: `${DIR}/GSAS-II_2025B_HR/2025B_HighRes_60HzB1_CWL0p8.instprm`,
  B2: `${DIR}/GSAS-II_2025B_HR/2025B_HighRes_60HzB2_CWL1p5.instprm`,
  B3: `${DIR}/GSAS-II_2025B_HR/2025B_HighRes_60HzB3_CWL2p665.instprm`,
} as const;
const has = dataExists(DATA) && dataExists(CIF) && Object.values(INST).every((f) => dataExists(f));

const K: Vec3 = [0.5, 0, 0];
/** Fit window's long-d end: a gap past the model's last line (nuclear d ≤ b, satellites d ≤ 2a). */
const D_MAX = 10.5;
/** 60 Hz source: one frame is 1/60 s wide. */
const FRAME_US = 1e6 / 60;
/** Thermal contraction bound, 100 → 8 K, per lattice length ("a few 1e-4"). */
const THERMAL_PER_AXIS = 5e-4;
/** A monoclinic angle's thermal drift bound over the same range (degrees). */
const THERMAL_BETA = 0.01;
/** Coordinates move ≪ 0.01 Å between 100 and 8 K without a transition; 0.02 Å allows for the CIF's unstated esds. */
const POSITION_TOL_A = 0.02;
/** Spin-only moments (µB) of the 2+ 3d ions of the A site (W⁶⁺O₄²⁻ fixes A²⁺). */
const SPIN_ONLY: Readonly<Record<string, number>> = { Mn: 5, Fe: 4, Co: 3, Ni: 2, Cu: 1 };
const LONG = 20 * 60 * 1000;

/** A CIF number with its esd in parentheses, e.g. "4.6757(7)" → 4.6757 ± 0.0007. */
function cifValue(cif: string, tag: string): { value: number; esd: number } {
  const m = cif.match(new RegExp(`^${tag}\\s+([-\\d.]+)(?:\\((\\d+)\\))?`, "m"));
  if (!m) throw new Error(`${tag} missing from the CIF`);
  const text = m[1]!;
  const decimals = text.includes(".") ? text.split(".")[1]!.length : 0;
  return { value: Number(text), esd: m[2] ? Number(m[2]) * 10 ** -decimals : 0 };
}

/** The 60 Hz band's shortest wavelength: CWL from the file name, minus half a frame. */
function lambdaMin(file: string, instText: string): number {
  const cwl = file.match(/CWL(\d+)p(\d+)/);
  const L = instText.match(/^fltPath:\s*([\d.]+)/m);
  if (!cwl || !L) throw new Error(`${file}: no CWL or flight path`);
  const centre = Number(`${cwl[1]}.${cwl[2]}`);
  return centre - FRAME_US / (252.78 * Number(L[1])) / 2;
}

/** |Δ| in Å of a fractional displacement, through the cell's metric. */
function lengthA(cell: UnitCell, f: readonly number[]): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const [ca, cb, cg] = [Math.cos(r(cell.alpha)), Math.cos(r(cell.beta)), Math.cos(r(cell.gamma))];
  const [x, y, z] = [f[0]! * cell.a, f[1]! * cell.b, f[2]! * cell.c];
  return Math.sqrt(x * x + y * y + z * z + 2 * (x * y * cg + x * z * cb + y * z * ca));
}

interface Bench {
  readonly structure: StructureModel;
  readonly pattern: PowderPattern;
  readonly inst: Extract<InstrumentParameters, { kind: "tof" }>;
  readonly cif: string;
  readonly bindings: readonly ParameterBinding[];
  readonly nuclear: RefinementParameter[];
  readonly nuclearResult: RefinementResult;
  readonly rows: PeakRow[];
  readonly kRanking: KCandidate[];
  readonly reps: LatticeCandidate[];
  readonly dims: number[];
  readonly ranking: Record<string, RankEntry>;
  readonly best: { id: string; wR: number };
  readonly tied: string[];
  readonly joint: RefinementResult;
  readonly jointValues: Record<string, number>;
  readonly momentIds: string[];
  readonly moment: { value: number; esd: number };
  readonly ionBound: number;
  readonly before: number[];
  readonly after: number[];
  readonly window: number[];
  readonly dArr: number[];
  readonly sigma: number[];
  readonly reflections: { d: number; hkl: string; phaseLabel: string }[];
  readonly yJoint: Float64Array;
}

async function runBenchmark(): Promise<Bench> {
  const cif = readData(CIF);
  const { structure } = parse_structure({ cif, id: "awo4" });
  const inst = parse_instrument({ text: readData(INST.B3) });
  if (inst.kind !== "tof") throw new Error("the B3 .instprm should be TOF");
  const pattern = parse_powder_data({ text: readData(DATA), filename: "PG3_61113-3.dat", instrument: inst }).pattern;
  const fitRange = { min: pattern.points[0]!.x, max: tofFromD(inst, D_MAX) };
  const spec = buildPowderSpec(structure, pattern, inst, true, 6, { positions: true, adp: true });

  // Nuclear, staged. σq stays at its calibration (it is not separable from σ0
  // and the isotropic Mustrain over this d range), occupancies stay fixed
  // (no restraint breaks their tie with the scale), the calibration is B3's.
  const unlock = new Set<ParameterKind>(["positionShift", "bIso", "tofProfile", "mustrainIso"]);
  const staged = refineStaged(
    spec.params.map((p) => (unlock.has(p.kind) && p.id !== "tof_sigQ" ? { ...p, fixed: false } : p)),
    (params) => buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile, [], fitRange),
    stagesFromKindGroups(DEFAULT_STAGE_KINDS),
    { maxIterations: 12 },
  );
  const nuclear = staged.parameters;
  const nuclearResult = staged.final!;

  // Residual peaks and k, as the magnetic page reads them (within the window).
  const curves = powderCurves(structure, pattern, nuclear, spec.bindings, spec.profile);
  const dArr = pattern.points.map((p) => dFromTof(inst, p.x));
  const sigma = pattern.points.map((p) => p.sigma!);
  const window = pattern.points.map((p, i) => (p.x >= fitRange.min && p.x <= fitRange.max ? i : -1)).filter((i) => i >= 0);
  const at = <T,>(xs: readonly T[]) => window.map((i) => xs[i]!);
  const detected = detectExtraPeaks(at(dArr), at(curves.yObs), at(curves.yCalc), { pointSigma: at(sigma), minSignificance: 3, limit: 24 });
  const refined = applyParameters(structure, spec.bindings, Object.fromEntries(nuclear.map((p) => [p.id, p.value]))).model;
  const nucRefl = generateReflections(refined.cell, refined.spaceGroup, 0.9, 25).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: "AWO4" }));
  const rows = peakRows(annotateExtraPeaks(detected, nucRefl), PEAK_CRITERIA, {});
  const kRanking = searchK(structure, rows);

  // Every magnetic group of the little group of k, moments only (nuclear held).
  const ions = magneticIonCandidates(structure).map((i) => i.siteLabel);
  const reps = candidatesOf(structure, K);
  const dims = momentDims(structure, reps, ions, K);
  const ties = { sameSite: true, magnitudes: false as const, flippedUnits: [] };
  const held = nuclear.map((p) => ({ ...p, fixed: true }));
  const fit: MagneticFit = {
    agreementLabel: "wR",
    refine: async (magnetic, momentParams, momentBindings) => {
      const res = refine(buildMagneticPowderProblem(structure, magnetic, pattern, [...held, ...momentParams], [...spec.bindings, ...momentBindings], spec.profile, fitRange), { maxIterations: 20 });
      return { values: { ...res.parameters }, agreement: res.agreement.rWeighted ?? null, ...noiseOf(res) };
    },
  };
  const ranking = await rankCandidates({ structure, reps, dims, scope: "all", open: new Set(), build: (ops) => buildFor(structure, K, ions, ops, ties), fit });
  const best = bestRanked(ranking, reps, dims)!;
  const tied = withinNoise(ranking, reps, dims);

  // Joint: the nuclear free set and the ★ group's moments together.
  const build = buildFor(structure, K, ions, reps.find((r) => r.candidate.id === best.id)!.candidate.operations, ties);
  const moments = build.params.map((p) => {
    const v = ranking[best.id]!.values[p.id] ?? p.value;
    return { ...p, value: v, initialValue: v, fixed: !!p.expression };
  });
  const jointParams = [...nuclear.map((p) => ({ ...p })), ...moments];
  const jointProblem = buildMagneticPowderProblem(structure, build.magnetic, pattern, jointParams, [...spec.bindings, ...build.bindings], spec.profile, fitRange);
  const joint = refine(jointProblem, { maxIterations: 20 });
  const jointValues: Record<string, number> = {};
  for (const p of jointParams) jointValues[p.id] = joint.parameters[p.id] ?? p.value;
  const yJoint = jointProblem.calculate(jointValues);

  // |M| (one tied moment per ion) and its esd from the amplitude esds (covariances neglected).
  const sizeOf = (v: Record<string, number>) => {
    const m = applyMagneticMoments(build.magnetic, build.bindings, v).moments[0]!;
    return Math.hypot(...momentCartesian(structure.cell, m));
  };
  const size = sizeOf(jointValues);
  let var2 = 0;
  for (const p of moments.filter((q) => !q.fixed)) {
    const h = 1e-4 * Math.max(1, Math.abs(jointValues[p.id]!));
    const dM = (sizeOf({ ...jointValues, [p.id]: jointValues[p.id]! + h }) - size) / h;
    var2 += (dM * (joint.esd?.[p.id] ?? NaN)) ** 2;
  }
  const spins = ions.map((l) => SPIN_ONLY[structure.sites.find((s) => s.label === l)!.element] ?? NaN);

  // Residual height at each included k-search peak, before (nuclear) and after (joint).
  const included = rows.filter((r) => r.included);
  const apex = (y: ArrayLike<number>, d: number) => Math.max(...window.filter((i) => Math.abs(dArr[i]! / d - 1) <= 0.003).map((i) => curves.yObs[i]! - y[i]!));
  const jointModel = applyParameters(structure, spec.bindings, jointValues).model;
  const reflections = [
    ...generateReflections(jointModel.cell, jointModel.spaceGroup, 0.9, 25).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: "AWO4" })),
    ...satellitePositions(jointModel.cell, K, 0.9, D_MAX + 1).map((r) => ({ d: r.d, hkl: r.hkl, phaseLabel: "magnetic" })),
  ];

  const bench: Bench = {
    structure, pattern, inst, cif, bindings: spec.bindings, nuclear, nuclearResult, rows, kRanking, reps, dims, ranking, best, tied, joint, jointValues,
    momentIds: moments.filter((q) => !q.fixed).map((q) => q.id),
    moment: { value: size, esd: Math.sqrt(var2) },
    ionBound: spins.reduce((a, b) => a + b, 0) / spins.length,
    before: included.map((r) => apex(curves.yCalc, r.d)),
    after: included.map((r) => apex(yJoint, r.d)),
    window, dArr, sigma, reflections, yJoint,
  };
  report(bench);
  return bench;
}

/** The run's numbers, for the local benchmark record (stdout only; nothing is written to the repository). */
function report(b: Bench): void {
  const v = (id: string) => b.nuclear.find((p) => p.id === id)!;
  const pm = (p: RefinementParameter, n = 5) => `${p.value.toFixed(n)}(${(p.esd ?? NaN).toPrecision(2)})`;
  const ag = (r: RefinementResult) => `wR ${(100 * (r.agreement.rWeighted ?? NaN)).toFixed(3)}% GoF ${(r.agreement.goodnessOfFit ?? NaN).toFixed(2)}`;
  console.log(`[awo4-bench] nuclear ${ag(b.nuclearResult)} · a ${pm(v("cell_a"))} b ${pm(v("cell_b"))} c ${pm(v("cell_c"))} β ${pm(v("cell_beta"), 4)} · at bounds ${b.nuclearResult.diagnostics?.atBounds.map((x) => x.parameterId).join(",") || "none"}`);
  const cellRows = ["a", "b", "c"].map((x) => {
    const ref = cifValue(b.cif, `_cell_length_${x}`);
    const p = v(`cell_${x}`);
    const tol = THERMAL_PER_AXIS + 2 * Math.hypot(ref.esd / ref.value, (p.esd ?? 0) / p.value);
    return `${x} ${((p.value / ref.value - 1) * 1e4).toFixed(2)}e-4 (tol ${(tol * 1e4).toFixed(2)}e-4)`;
  });
  const shifts = b.nuclear.filter((q) => q.kind === "positionShift" && !q.fixed).map((p) => {
    const len = lengthA(b.structure.cell, b.bindings.find((x) => x.parameterId === p.id)!.axis!);
    return `${p.id} ${(Math.abs(p.value) * len).toFixed(3)} Å (tol ${(POSITION_TOL_A + 3 * (p.esd ?? 0) * len).toFixed(3)})`;
  });
  console.log(`[awo4-bench] cell vs 100 K CIF: ${cellRows.join(" · ")} · position shifts: ${shifts.join(" · ")}`);
  console.log(`[awo4-bench] free nuclear rows: ${b.nuclear.filter((p) => !p.fixed).map((p) => `${p.id} ${p.value.toPrecision(6)}±${(p.esd ?? NaN).toPrecision(2)}`).join(" | ")}`);
  console.log(`[awo4-bench] peaks: ${b.rows.map((r) => `${r.d.toFixed(3)}(${(r.significance ?? NaN).toFixed(1)}σ${r.nearNuclear ? ` nuc ${r.nearNuclear.hkl}` : ""}${r.included ? " ✓" : ""})`).join(" ")}`);
  console.log(`[awo4-bench] k: ${b.kRanking.slice(0, 5).map((c) => `${c.label} ${c.matched}/${c.total} rmsd ${c.rmsd.toFixed(4)} score ${c.score.toFixed(3)}`).join(" | ")}`);
  for (const [i, r] of b.reps.entries()) {
    const e = b.ranking[r.candidate.id];
    const std = r.candidate.standard ?? r.settingMatch?.identity;
    const label = std ? `${formatMagneticSymbol(std.bnsSymbol)} (BNS ${std.bnsNumber})` : r.candidate.label;
    console.log(`[awo4-bench]   ${r.candidate.id === b.best.id ? "★" : b.tied.includes(r.candidate.id) ? "=" : " "} ${label} index ${r.index} · ${b.dims[i]} moment comps · ${e?.status ?? "not fitted"} · wR ${e?.wR != null ? (100 * e.wR).toFixed(3) : "—"}% · |M| ${e?.magnitudes[0]?.value.toFixed(2) ?? "—"}`);
  }
  const esd = b.joint.esd ?? {};
  console.log(`[awo4-bench] joint ${ag(b.joint)} · ${b.joint.status} · |M| ${b.moment.value.toFixed(3)}(${b.moment.esd.toFixed(3)}) µB (bound ${b.ionBound.toFixed(2)}) · amplitudes ${b.momentIds.map((id) => `${id} ${b.jointValues[id]!.toFixed(3)}±${(esd[id] ?? NaN).toFixed(3)}`).join(" ")} · max shift/esd ${b.joint.diagnostics?.maxShiftOverEsd.toExponential(2)} · at bounds ${b.joint.diagnostics?.atBounds.map((x) => x.parameterId).join(",") || "none"} · |ρ|≥0.95 ${JSON.stringify(b.joint.diagnostics?.highCorrelations ?? [])}`);
  console.log(`[awo4-bench] joint − staged (Δ/esd): ${b.nuclear.filter((p) => !p.fixed).map((p) => `${p.id} ${((b.jointValues[p.id]! - p.value) / (esd[p.id] ?? NaN)).toFixed(1)}`).join(" ")}`);
  console.log(`[awo4-bench] magnetic-peak residual after/before: ${b.after.map((a, i) => (a / b.before[i]!).toFixed(2)).join(" ")}`);
  const post = postResidual(b);
  console.log(`[awo4-bench] after joint: ${post.reading} · unexplained ${post.unexplained.map((p) => `${p.d.toFixed(3)} (${p.sigmas?.toFixed(0)}σ)`).join(", ") || "none"}`);
}

function postResidual(b: Bench) {
  const w = b.window;
  const yObs = b.pattern.points.map((p) => p.yObs);
  return find_unexplained_peaks({
    residual: { d: w.map((i) => b.dArr[i]!), yObs: w.map((i) => yObs[i]!), yCalc: w.map((i) => b.yJoint[i]!), sigma: w.map((i) => b.sigma[i]!), sigmaFrom: "file", reflections: b.reflections, magneticNeutron: true },
  });
}

describe.skipIf(!has)("AWO₄ 8 K benchmark — the file and its frame (POWGEN 61113, Mantid XYDATA)", () => {
  it("C1: reads the Mantid XYDATA export as a log-binned TOF pattern with σ", () => {
    const text = readData(DATA);
    const { detected, pattern } = parse_powder_data({ text, filename: "PG3_61113-3.dat" });
    expect(detected).toMatchObject({ dataType: "powder", xUnit: "tof", source: "header", confidence: "high" });
    expect(pattern.radiation).toEqual({ kind: "neutron-tof" });
    // One point per data row: every line but the XYDATA tag and the # header.
    expect(pattern.points).toHaveLength(text.split(/\r?\n/).filter((l) => /^\s*[\d.]/.test(l)).length);
    expect(pattern.points.every((p) => (p.sigma ?? 0) > 0 && Number.isFinite(p.yObs))).toBe(true);
    const steps = pattern.points.slice(1).map((p, i) => p.x / pattern.points[i]!.x - 1);
    expect(Math.min(...steps)).toBeGreaterThan(0);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-6);
  });

  it("C2: the first point sits at the B3 band's backscattering limit λ_min/2, not B1's or B2's", () => {
    const ratio: Record<string, number> = {};
    for (const [bank, file] of Object.entries(INST)) {
      const text = readData(file);
      const inst = parse_instrument({ text });
      if (inst.kind !== "tof") throw new Error(`${file} should be TOF`);
      const { pattern } = parse_powder_data({ text: readData(DATA), filename: "PG3_61113-3.dat", instrument: inst });
      ratio[bank] = dFromTof(inst, pattern.points[0]!.x) / (lambdaMin(file, text) / 2);
    }
    expect(ratio.B3).toBeGreaterThanOrEqual(1);
    expect(ratio.B3).toBeLessThanOrEqual(1.05);
    expect(ratio.B2).toBeGreaterThan(1.5);
    expect(ratio.B1).toBeGreaterThan(1.5);
  });
});

describe.skipIf(!has)("AWO₄ 8 K benchmark — nuclear vs the 100 K CIF, k, and the magnetic model (UNVERIFIED: no independent magnetic reference)", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await runBenchmark();
  }, LONG);
  const value = (id: string) => b.nuclear.find((p) => p.id === id)!;

  it("C3a: β and the volume within the thermal bounds of the 100 K CIF", () => {
    const beta = cifValue(b.cif, "_cell_angle_beta");
    expect(Math.abs(value("cell_beta").value - beta.value)).toBeLessThanOrEqual(THERMAL_BETA + 2 * Math.hypot(beta.esd, value("cell_beta").esd ?? 0));
    const vol = (a: number, bb: number, c: number, be: number) => a * bb * c * Math.sin((be * Math.PI) / 180);
    const [a0, b0, c0] = ["a", "b", "c"].map((x) => cifValue(b.cif, `_cell_length_${x}`).value);
    const v0 = vol(a0!, b0!, c0!, beta.value);
    const v = vol(value("cell_a").value, value("cell_b").value, value("cell_c").value, value("cell_beta").value);
    const sigV = Math.hypot(...["a", "b", "c"].flatMap((x) => [cifValue(b.cif, `_cell_length_${x}`).esd / cifValue(b.cif, `_cell_length_${x}`).value, (value(`cell_${x}`).esd ?? 0) / value(`cell_${x}`).value]));
    expect(v / v0 - 1).toBeLessThanOrEqual(2 * sigV);
    expect(v / v0 - 1).toBeGreaterThanOrEqual(-(3 * THERMAL_PER_AXIS + 2 * sigV));
  });

  // Known not met on the local data (one length, with every calibration file). Candidate causes —
  // magnetostriction below T_N, another calibration behind the 100 K cell, the app's profile
  // fit — are open; the benchmark record has the numbers.
  it.fails("C3b: each lattice length within the thermal bound of the 100 K CIF", () => {
    for (const x of ["a", "b", "c"]) {
      const ref = cifValue(b.cif, `_cell_length_${x}`);
      const p = value(`cell_${x}`);
      expect(Math.abs(p.value / ref.value - 1)).toBeLessThanOrEqual(THERMAL_PER_AXIS + 2 * Math.hypot(ref.esd / ref.value, (p.esd ?? 0) / p.value));
    }
  });

  // Known not met on the local data, after the staged nuclear fit and unchanged by the joint one.
  it.fails("C4: refined positions within 0.02 Å + 3σ of the 100 K CIF", () => {
    for (const p of b.nuclear.filter((q) => q.kind === "positionShift" && !q.fixed)) {
      const axis = b.bindings.find((x) => x.parameterId === p.id)!.axis!;
      const len = lengthA(b.structure.cell, axis);
      expect(Math.abs(p.value) * len).toBeLessThanOrEqual(POSITION_TOL_A + 3 * (p.esd ?? 0) * len);
    }
  });

  // Known not met on the local data: B_iso values rail to their bound at 0.
  it.fails("C5: every B_iso positive and off its bound", () => {
    const bounded = new Set(b.joint.diagnostics?.atBounds.map((x) => x.parameterId) ?? []);
    for (const p of b.nuclear.filter((q) => q.kind === "bIso" && !q.fixed)) {
      expect(b.jointValues[p.id]!).toBeGreaterThan(0);
      expect(bounded.has(p.id)).toBe(false);
    }
  });

  it("C6: k = (½ 0 0) from the nuclear-model residual alone: first, every included peak, a clear margin", () => {
    const included = b.rows.filter((r) => r.included);
    expect(included.length).toBeGreaterThanOrEqual(3);
    const [top, next] = b.kRanking;
    expect(top!.k).toEqual(K);
    expect(top!.matched).toBe(included.length);
    expect(top!.score - next!.score).toBeGreaterThanOrEqual(0.15);
  });

  it("C7: the ★ group is a maximal subgroup that puts a moment on the ions", () => {
    const i = b.reps.findIndex((r) => r.candidate.id === b.best.id);
    expect(b.reps[i]!.index).toBe(2);
    expect(b.dims[i]!).toBeGreaterThan(0);
    expect(b.tied).toContain(b.best.id);
  });

  it("C8: the moment is below the ions' mean spin-only value and well determined", () => {
    expect(b.moment.value).toBeLessThanOrEqual(b.ionBound);
    expect(b.moment.value / b.moment.esd).toBeGreaterThanOrEqual(10);
  });

  it("C9: wR falls from the nuclear fit to the ★ moments to the joint fit", () => {
    const nuclear = b.nuclearResult.agreement.rWeighted!;
    expect(b.best.wR).toBeLessThan(nuclear);
    expect(b.joint.agreement.rWeighted!).toBeLessThan(b.best.wR);
  });

  it("C10: the joint fit takes at least half the residual off every k-search peak", () => {
    expect(b.before.length).toBeGreaterThan(0);
    b.after.forEach((a, i) => expect(a).toBeLessThanOrEqual(0.5 * b.before[i]!));
  });

  // Known not met on the local data: a line the magnetic model leaves unchanged (not yet identified).
  it.fails("C11: no residual peak ≥ 5σ off every nuclear and magnetic reflection after the joint fit", () => {
    expect(postResidual(b).unexplained).toHaveLength(0);
  });

  it("C12: esds on every free row off its bound, and converged", () => {
    const bounded = new Set(b.joint.diagnostics?.atBounds.map((x) => x.parameterId) ?? []);
    const free = [...b.nuclear.filter((p) => !p.fixed).map((p) => p.id), ...b.momentIds].filter((id) => !bounded.has(id));
    for (const id of free) {
      const e = b.joint.esd?.[id];
      expect(Number.isFinite(e) && e! > 0, id).toBe(true);
    }
    expect(b.joint.diagnostics!.maxShiftOverEsd).toBeLessThan(0.1);
  });

  // Known not met on the local data.
  it.fails("C13: joint GoF at most 2.5 (the acceptance bar)", () => {
    expect(b.joint.agreement.goodnessOfFit!).toBeLessThanOrEqual(2.5);
  });
});

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
import { crystalComponentsToCartesian, momentCartesian } from "@/core/magnetic/moment";
import { noiseOf } from "@/core/magnetic/momentRestarts";
import { formatMagneticSymbol } from "@/core/magnetic/bnsOg";
import type { LatticeCandidate } from "@/core/magnetic/subgroupLattice";
import type { MagneticModelBuild } from "@/core/magnetic/momentModel";
import type { MagneticModel } from "@/core/magnetic/types";
import { expandMagneticSupercell } from "@/core/crystal/cellExpansion";
import { magneticCellGroup } from "@/core/magnetic/supercellGroup";
import { operationKey, siteMultiplicity } from "@/core/crystal/symmetry";
import { cifSu, parseTypeSymbol } from "@/parsers/cif";
import { dot, norm, normalize, scale, sub } from "@/core/math/vec3";
import type { StructureModel, SymmetryOperation, UnitCell } from "@/core/crystal/types";
import type { PowderPattern } from "@/core/diffraction/types";
import type { ParameterBinding, ParameterKind, RefinementParameter, RefinementResult } from "@/core/refinement/types";
import type { Vec3 } from "@/core/math/types";
import { dataExists, readData } from "@/testSupport/data";
import { withZeroAdpProposal, zeroAdpProposals } from "@/core/diagnostics/zeroAdp";

/**
 * BENCHMARK — magnetic refinement of the high-entropy tungstate AWO₄
 * ((Co,Cu,Fe,Mn,Ni,Zn)WO₄, P2/c) on POWGEN run 61113 at 8 K, bank 3, read
 * from the Mantid XYDATA export (`PG3_61113-3.dat`). The data are UNPUBLISHED:
 * they are read from the git-ignored data/ folder only, and this file holds no
 * number derived from them — only the criteria. Skips when the files are absent.
 *
 * Reference status. The nuclear model is checked against the user's GSAS-II
 * refinement at 100 K (trusted). The magnetic structure is checked against the
 * owner's own refinement of this run, `AWO4_8K_n.mcif` (a Jana-style mCIF in the
 * doubled cell; unpublished), read at runtime from data/ — that block skips
 * without it. Only its magnetic content is trusted (k, the group and its
 * operators, the moment components, its ⟨j0⟩ ions); its cell is not. The cell
 * enters only as the basis of the doubled cell, the moment components are
 * converted with the app's refined 8 K metric, and the like-for-like joint fit
 * uses the reference's ⟨j0⟩ ions through the sites' oxidation states (the app's
 * default, 2+, drives C1–C13). No trusted 8 K cell exists: the cell (C3) is
 * compared only with the 100 K CIF, within thermal-contraction bounds. The
 * app-generated demo solution is not used.
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
/** The owner's refined 8 K magnetic structure (Jana mCIF, doubled cell). */
const REF = `${DIR}/AWO4_8K_n.mcif`;
const hasRef = has && dataExists(REF);

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
  readonly profile: ReturnType<typeof buildPowderSpec>["profile"];
  readonly fitRange: { min: number; max: number };
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
  readonly ions: string[];
  /** The ★ group's moment model (its amplitudes are in jointValues). */
  readonly build: MagneticModelBuild;
  /** The structure with the joint nuclear values applied. */
  readonly jointModel: StructureModel;
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
    structure, pattern, inst, cif, bindings: spec.bindings, profile: spec.profile, fitRange, nuclear, nuclearResult, rows, kRanking, reps, dims, ranking, best, tied, joint, jointValues,
    momentIds: moments.filter((q) => !q.fixed).map((q) => q.id),
    moment: { value: size, esd: Math.sqrt(var2) },
    ionBound: spins.reduce((a, b) => a + b, 0) / spins.length,
    before: included.map((r) => apex(curves.yCalc, r.d)),
    after: included.map((r) => apex(yJoint, r.d)),
    window, dArr, sigma, reflections, yJoint, ions, build, jointModel,
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

/** One benchmark run (≈ 90 s), shared by the blocks below. */
let pending: Promise<Bench> | undefined;
const benchmark = (): Promise<Bench> => (pending ??= runBenchmark());

describe.skipIf(!has)("AWO₄ 8 K benchmark — nuclear vs the 100 K CIF, k, and the magnetic model", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await benchmark();
  }, LONG);
  const value = (id: string) => b.nuclear.find((p) => p.id === id)!;

  // No trusted 8 K cell exists (the reference mCIF's cell is not one): the cell is compared with the
  // 100 K CIF, within the thermal-contraction bounds.
  it("C3a: β within the thermal bound of the 100 K CIF", () => {
    const beta = cifValue(b.cif, "_cell_angle_beta");
    expect(Math.abs(value("cell_beta").value - beta.value)).toBeLessThanOrEqual(THERMAL_BETA + 2 * Math.hypot(beta.esd, value("cell_beta").esd ?? 0));
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

  it("C3c: the volume within the thermal bounds of the 100 K CIF (it may only shrink on cooling)", () => {
    const beta = cifValue(b.cif, "_cell_angle_beta");
    const vol = (a: number, bb: number, c: number, be: number) => a * bb * c * Math.sin((be * Math.PI) / 180);
    const [a0, b0, c0] = ["a", "b", "c"].map((x) => cifValue(b.cif, `_cell_length_${x}`).value);
    const v0 = vol(a0!, b0!, c0!, beta.value);
    const v = vol(value("cell_a").value, value("cell_b").value, value("cell_c").value, value("cell_beta").value);
    const sigV = Math.hypot(...["a", "b", "c"].flatMap((x) => [cifValue(b.cif, `_cell_length_${x}`).esd / cifValue(b.cif, `_cell_length_${x}`).value, (value(`cell_${x}`).esd ?? 0) / value(`cell_${x}`).value]));
    expect(v / v0 - 1).toBeLessThanOrEqual(2 * sigV);
    expect(v / v0 - 1).toBeGreaterThanOrEqual(-(3 * THERMAL_PER_AXIS + 2 * sigV));
  });

  // Known not met on the local data, after the staged nuclear fit and unchanged by the joint one.
  // The 8 K reference keeps the 100 K positions (R0b), so it gives no other target.
  it.fails("C4: refined positions within 0.02 Å + 3σ of the 100 K CIF", () => {
    for (const p of b.nuclear.filter((q) => q.kind === "positionShift" && !q.fixed)) {
      const axis = b.bindings.find((x) => x.parameterId === p.id)!.axis!;
      const len = lengthA(b.structure.cell, axis);
      expect(Math.abs(p.value) * len).toBeLessThanOrEqual(POSITION_TOL_A + 3 * (p.esd ?? 0) * len);
    }
  });

  // Known not met on the local data: B_iso values rail to their bound at 0. The 8 K reference
  // refines one shared U_iso (R0c), so it gives no per-site target. The B-at-0 rule (M10) gives each
  // a warned proposal with ranked options (C5b); with the preferred tie applied it is off its bound (C5c); C5 is read
  // on the fit as refined, with nothing applied, and stays as written.
  it.fails("C5: every B_iso positive and off its bound", () => {
    const bounded = new Set(b.joint.diagnostics?.atBounds.map((x) => x.parameterId) ?? []);
    for (const p of b.nuclear.filter((q) => q.kind === "bIso" && !q.fixed)) {
      expect(b.jointValues[p.id]!).toBeGreaterThan(0);
      expect(bounded.has(p.id)).toBe(false);
    }
  });

  // The B-at-0 rule (M10): each B the joint fit leaves on its bound gets a proposal with a warning,
  // and nothing is applied behind the user's back — C5 above is read on the fit as refined.
  it("C5b: each B on its lower bound gets a warned proposal, applied to nothing", () => {
    const rows = b.nuclear.map((p) => ({ ...p, value: b.jointValues[p.id] ?? p.value }));
    const kind = new Map(rows.map((p) => [p.id, p.kind]));
    const bounded = (b.joint.diagnostics?.atBounds ?? []).filter((x) => x.bound === "min" && kind.get(x.parameterId) === "bIso").map((x) => x.parameterId).sort();
    expect(bounded).toEqual(expect.arrayContaining(["B_O2", "B_W1"]));
    const proposals = zeroAdpProposals({ parameters: rows, bindings: b.bindings, result: b.joint, structures: [b.structure], refined: [b.jointModel] });
    expect(proposals.map((p) => p.parameterId).sort()).toEqual(bounded);
    for (const p of proposals) {
      expect(p.warning.startsWith(`${p.atom} refined to`)).toBe(true);
      expect(p.warning).toMatch(/its lower bound/);
      expect(p.warning).toMatch(/the Bayesian check on it \(sample_posterior\)/);
      expect(p.source.startsWith(`rule ${p.rule}`)).toBe(true);
    }
    // O2 has a sensible partner of its own element (O1): that tie is offered first, as the preferred option.
    expect(proposals.find((p) => p.parameterId === "B_O2")!.options[0]).toMatchObject({ rule: "A", rank: "preferred", leader: "B_O1" });
    // W1 has no other W: any tie to another cation is only a labelled alternative, with its caution; nothing is preferred.
    const w1 = proposals.find((p) => p.parameterId === "B_W1")!;
    expect(w1.options.length).toBeGreaterThan(0);
    expect(w1.options.every((o) => o.rank === "alternative")).toBe(true);
    for (const o of w1.options.filter((x) => x.rule === "A")) expect(o.caution).toMatch(/^a different cation \(W.* vs .*\): check it is physically sensible$/);
    // Computing a proposal changes no row.
    expect(rows.filter((p) => p.kind === "bIso").every((p) => p.value === (b.jointValues[p.id] ?? p.value))).toBe(true);
    console.log(`[awo4-bench] B at 0: ${proposals.map((p) => `${p.parameterId} → ${p.options.map((o, i) => `${i + 1}) ${o.rank} ${o.rule === "A" ? `tie ${o.leader}` : `hold ${o.value!.toFixed(3)}`} [${o.label}]`).join(" ")}`).join(" | ")}`);
  });

  // With options applied (what the user gets on Apply), the joint fit refined again: an observation
  // for the record — C5 above stays as written, on the fit as refined. Two choices: the preferred
  // tie alone; and the preferred tie with each other B held at its starting value, where it has one.
  it("C5c: with the preferred tie applied and the joint fit refined again, its leader is off its bound", () => {
    const rows = b.nuclear.map((p) => ({ ...p, value: b.jointValues[p.id] ?? p.value }));
    const proposals = zeroAdpProposals({ parameters: rows, bindings: b.bindings, result: b.joint, structures: [b.structure], refined: [b.jointModel] });
    const moments = b.build.params.map((p) => ({ ...p, value: b.jointValues[p.id] ?? p.value, initialValue: b.jointValues[p.id] ?? p.value, fixed: !!p.expression }));
    const ag = (r: RefinementResult) => `wR ${(100 * (r.agreement.rWeighted ?? NaN)).toFixed(3)}% GoF ${(r.agreement.goodnessOfFit ?? NaN).toFixed(2)}`;
    const run = (choice: (p: (typeof proposals)[number]) => number, name: string) => {
      let applied = rows;
      for (const p of proposals) {
        const i = choice(p);
        if (i >= 0) applied = withZeroAdpProposal(applied, p, i);
      }
      const again = refine(buildMagneticPowderProblem(b.structure, b.build.magnetic, b.pattern, [...applied, ...moments], [...b.bindings, ...b.build.bindings], b.profile, b.fitRange), { maxIterations: 20 });
      const bounded = new Set((again.diagnostics?.atBounds ?? []).map((x) => x.parameterId));
      console.log(`[awo4-bench] ${name}, joint again: ${ag(again)} (was ${ag(b.joint)}) · ${again.status} · B ${applied.filter((p) => p.kind === "bIso").map((p) => `${p.id} ${(again.parameters[p.id] ?? p.value).toFixed(3)}${again.esd?.[p.id] ? `±${again.esd[p.id]!.toFixed(3)}` : p.expression ? ` (${p.expression})` : " (held)"}`).join(" ")} · at bounds ${[...bounded].join(",") || "none"}`);
      return { again, bounded };
    };
    const preferred = (p: (typeof proposals)[number]) => p.options.findIndex((o) => o.rank === "preferred");
    const { again, bounded } = run(preferred, "preferred tie only");
    for (const p of proposals) {
      const i = preferred(p);
      if (i < 0) continue;
      const leader = p.options[i]!.leader!;
      expect(bounded.has(leader)).toBe(false);
      expect(again.parameters[leader]!).toBeGreaterThan(0);
    }
    run((p) => (preferred(p) >= 0 ? preferred(p) : p.options.findIndex((o) => o.rule === "B")), "preferred tie, the rest at their starting value");
  }, LONG);

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
  // The 8 K reference has the same k and group, so it indexes no reflection there either. Not the
  // vanadium can: bcc V at its 8 K cell puts 110 well outside the calibration's reach of the line, and
  // a V phase added to the joint fit leaves it (identify_peaks' ±1.5 % d scale names V anyway).
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

  // Known not met on the local data. The 8 K reference gives no R values to compare.
  it.fails("C13: joint GoF at most 2.5 (the acceptance bar)", () => {
    expect(b.joint.agreement.goodnessOfFit!).toBeLessThanOrEqual(2.5);
  });
});

// ── against the owner's 8 K reference refinement (AWO4_8K_n.mcif) ────────────

interface Reference {
  readonly text: string;
  readonly structure: StructureModel;
  readonly magnetic: MagneticModel;
  /** Supercell multipliers of the reference cell over the parent's. */
  readonly n: [number, number, number];
  /** Moment su's (µB) per label, as the file prints them. */
  readonly sus: Map<string, Vec3>;
  /** The ⟨j0⟩ ion's oxidation state the reference names per element. */
  readonly ions: Map<string, number>;
}

/** The ⟨j0⟩ ions the reference names in its atom_type loop, per element ("Fe3+" → Fe: 3; "." none). */
function referenceIons(text: string): Map<string, number> {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let i = lines.findIndex((l) => /^_atom_type[._]magn_oxidation_number$/i.test(l));
  const out = new Map<string, number>();
  if (i < 0) return out;
  while (i > 0 && lines[i - 1]!.startsWith("_")) i--;
  const tags: string[] = [];
  while (i < lines.length && lines[i]!.startsWith("_")) tags.push(lines[i++]!.toLowerCase().replace(/\./g, "_"));
  const iSymbol = tags.findIndex((t) => t.endsWith("atom_type_symbol"));
  const iIon = tags.findIndex((t) => t.endsWith("magn_oxidation_number"));
  for (; i < lines.length && lines[i] !== "" && !lines[i]!.startsWith("_") && lines[i]!.toLowerCase() !== "loop_"; i++) {
    const t = lines[i]!.split(/\s+/);
    const ion = t[iIon];
    if (!ion || ion === "." || ion === "?") continue;
    const typed = parseTypeSymbol(ion);
    if (typed.oxidationState !== undefined) out.set(t[iSymbol]!, typed.oxidationState);
  }
  return out;
}

/** The moment loop's su's per label ("0.83(5)" → 0.05; a value printed without one → 0). */
function momentSus(text: string): Map<string, Vec3> {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let i = lines.findIndex((l) => /^_atom_site_moment[._]label$/i.test(l));
  while (i > 0 && lines[i - 1]!.startsWith("_")) i--;
  const tags: string[] = [];
  while (i >= 0 && i < lines.length && lines[i]!.startsWith("_")) tags.push(lines[i++]!.toLowerCase().replace(/\./g, "_"));
  const [iL, iX, iY, iZ] = ["moment_label", "crystalaxis_x", "crystalaxis_y", "crystalaxis_z"].map((s) => tags.findIndex((t) => t.endsWith(s)));
  const out = new Map<string, Vec3>();
  for (; i >= 0 && i < lines.length && lines[i] !== "" && !lines[i]!.startsWith("_") && lines[i]!.toLowerCase() !== "loop_"; i++) {
    const t = lines[i]!.split(/\s+/);
    out.set(t[iL!]!, [cifSu(t[iX!]), cifSu(t[iY!]), cifSu(t[iZ!])]);
  }
  return out;
}

/** |M| (µB) and its direction φ in the a–c plane (degrees, from +a toward +c) for crystal-axis components on a cell. */
function sizeAndAngle(cell: UnitCell, comps: readonly number[]): { size: number; phi: number } {
  const m = crystalComponentsToCartesian(cell, [comps[0]!, comps[1]!, comps[2]!]);
  const a = crystalComponentsToCartesian(cell, [1, 0, 0]);
  const c = crystalComponentsToCartesian(cell, [0, 0, 1]);
  const n = normalize(sub(c, scale(a, dot(c, a))));
  return { size: norm(m), phi: (Math.atan2(dot(m, n), dot(m, a)) * 180) / Math.PI };
}

/** Linear propagation of independent esds through f (covariances neglected: the mCIF gives none). */
function propagated(f: (v: readonly number[]) => number, v: readonly number[], su: readonly number[]): number {
  const f0 = f(v);
  let var2 = 0;
  v.forEach((x, i) => {
    if (!(su[i]! > 0)) return;
    const h = 1e-6 * Math.max(1, Math.abs(x));
    const w = [...v];
    w[i] = x + h;
    var2 += (((f(w) - f0) / h) * su[i]!) ** 2;
  });
  return Math.sqrt(var2);
}

/** The difference of two axes in degrees, in (−90°, 90°]: a moment and its reverse are one axis (the anti-translation's two domains). */
function axisDelta(p: number, q: number): number {
  const d = (((p - q) % 180) + 180) % 180;
  return d > 90 ? d - 180 : d;
}

const opKey = (o: SymmetryOperation): string => `${operationKey(o)}|${o.timeReversal ?? 1}`;
const isPureTranslation = (o: SymmetryOperation): boolean => o.rotation.every((row, i) => row.every((v, j) => v === (i === j ? 1 : 0)));


/** An app joint fit as the reference block compares it. */
interface AppFit {
  readonly build: MagneticModelBuild;
  readonly values: Record<string, number>;
  readonly esd: Record<string, number>;
  readonly result: RefinementResult;
  /** The structure with the fit's nuclear values applied (its cell is the app's 8 K metric). */
  readonly model: StructureModel;
  readonly magnetic: MagneticModel;
}

describe.skipIf(!hasRef)("AWO₄ 8 K benchmark — against the owner's reference refinement (AWO4_8K_n.mcif)", () => {
  let b: Bench;
  let ref: Reference;
  /** The default pipeline's joint fit (2+ ⟨j0⟩, the app's default). */
  let plain: AppFit;
  /** Like for like: the same joint fit with the reference's ⟨j0⟩ ions, set as the sites' oxidation states. */
  let like: AppFit;
  beforeAll(async () => {
    b = await benchmark();
    const text = readData(REF);
    const { structure, magnetic } = parse_structure({ cif: text, id: "awo4-ref" });
    if (!magnetic) throw new Error(`${REF}: read with no magnetic model`);
    const n = (["a", "b", "c"] as const).map((x) => Math.round(structure.cell[x] / b.structure.cell[x])) as [number, number, number];
    ref = { text, structure, magnetic, n, sus: momentSus(text), ions: referenceIons(text) };
    plain = { build: b.build, values: b.jointValues, esd: b.joint.esd ?? {}, result: b.joint, model: b.jointModel, magnetic: applyMagneticMoments(b.build.magnetic, b.build.bindings, b.jointValues) };
    like = jointWithIons(ref.ions);
    reportReference();
  }, LONG);

  /**
   * The ★ group's two steps of the default pipeline again, with each ion's oxidation state from `ions`
   * (which picks its ⟨j0⟩ ion): the moments with the staged nuclear model held, from the ranked values,
   * then the joint fit with the same free rows.
   */
  function jointWithIons(ions: ReadonlyMap<string, number>): AppFit {
    const structure: StructureModel = {
      ...b.structure,
      sites: b.structure.sites.map((s) => (b.ions.includes(s.label) && ions.has(s.element) ? { ...s, oxidationState: ions.get(s.element)! } : s)),
    };
    const ops = b.reps.find((r) => r.candidate.id === b.best.id)!.candidate.operations;
    const build = buildFor(structure, K, b.ions, ops, { sameSite: true, magnitudes: false, flippedUnits: [] });
    const problem = (params: RefinementParameter[]) => buildMagneticPowderProblem(structure, build.magnetic, b.pattern, params, [...b.bindings, ...build.bindings], b.profile, b.fitRange);
    const seed = (p: RefinementParameter, v: number | undefined) => ({ ...p, value: v ?? p.value, initialValue: v ?? p.value, fixed: !!p.expression });
    const ranked = b.ranking[b.best.id]!.values;
    const momentsOnly = refine(problem([...b.nuclear.map((p) => ({ ...p, fixed: true })), ...build.params.map((p) => seed(p, ranked[p.id]))]), { maxIterations: 20 });
    const params = [...b.nuclear.map((p) => ({ ...p })), ...build.params.map((p) => seed(p, momentsOnly.parameters[p.id]))];
    const result = refine(problem(params), { maxIterations: 20 });
    const values: Record<string, number> = Object.fromEntries(params.map((p) => [p.id, result.parameters[p.id] ?? p.value]));
    return { build, values, esd: result.esd ?? {}, result, model: applyParameters(structure, b.bindings, values).model, magnetic: applyMagneticMoments(build.magnetic, build.bindings, values) };
  }

  const label = () => ref.magnetic.moments[0]!.siteLabel;
  /** |M| and φ of an app fit with their esds, in the fit's own refined 8 K metric. */
  const appSide = (f: AppFit) => {
    const ids = b.momentIds;
    const comps = (v: readonly number[]) => {
      const values = { ...f.values, ...Object.fromEntries(ids.map((id, i) => [id, v[i]!])) };
      return applyMagneticMoments(f.build.magnetic, f.build.bindings, values).moments.find((m) => m.siteLabel === label())!.components;
    };
    const v = ids.map((id) => f.values[id]!);
    const su = ids.map((id) => f.esd[id] ?? NaN);
    const at = (w: readonly number[]) => sizeAndAngle(f.model.cell, comps(w));
    return { ...at(v), sizeSu: propagated((w) => at(w).size, v, su), phiSu: propagated((w) => at(w).phi, v, su) };
  };
  /** The reference's |M| and φ with their esds, its components read in the given metric (the app's 8 K cell, not the mCIF's). */
  const refSide = (cell: UnitCell) => {
    const v = [...ref.magnetic.moments.find((m) => m.siteLabel === label())!.components];
    const su = [...ref.sus.get(label())!];
    const at = (w: readonly number[]) => sizeAndAngle(cell, w);
    return { ...at(v), sizeSu: propagated((w) => at(w).size, v, su), phiSu: propagated((w) => at(w).phi, v, su) };
  };

  /** The comparison's numbers, for the local record (stdout only; asserts nothing). */
  function reportReference(): void {
    for (const [name, f] of [["2+ (default)", plain], ["reference ⟨j0⟩", like]] as const) {
      const app = appSide(f);
      const r = refSide(f.model.cell);
      const r0 = refSide(ref.structure.cell);
      console.log(`[awo4-ref] ${name}: joint wR ${(100 * (f.result.agreement.rWeighted ?? NaN)).toFixed(3)}% GoF ${(f.result.agreement.goodnessOfFit ?? NaN).toFixed(2)} · ${f.result.status} · |M| app ${app.size.toFixed(3)}(${app.sizeSu.toFixed(3)}) ref ${r.size.toFixed(3)}(${r.sizeSu.toFixed(3)}) µB [mCIF metric ${r0.size.toFixed(4)}] · φ app ${app.phi.toFixed(2)}(${app.phiSu.toFixed(2)})° ref ${r.phi.toFixed(2)}(${r.phiSu.toFixed(2)})° [mCIF metric ${r0.phi.toFixed(3)}] · Δ|M| ${(app.size - r.size).toFixed(3)} (2σ ${(2 * Math.hypot(app.sizeSu, r.sizeSu)).toFixed(3)}) · Δφ ${axisDelta(app.phi, r.phi).toFixed(2)}° (2σ ${(2 * Math.hypot(app.phiSu, r.phiSu)).toFixed(2)}°) · comps ${f.magnetic.moments.find((m) => m.siteLabel === label())!.components.map((x) => x.toFixed(3)).join(",")} · ff ${f.build.magnetic.moments.map((m) => m.formFactorId).join(",")}`);
    }
    // A note only: the mCIF's cell is not a reference (the owner: it may not be accurate).
    const cells = (["a", "b", "c"] as const).map((x, i) => `${x} ${((like.model.cell[x] / (ref.structure.cell[x] / ref.n[i]!) - 1) * 1e4).toFixed(2)}e-4`);
    console.log(`[awo4-ref] note, mCIF cell (not a reference) vs the app's 8 K cell: ${cells.join(" ")} Δβ ${(like.model.cell.beta - ref.structure.cell.beta).toFixed(4)}°`);
  }

  it("R0a: the reference mCIF reads as a magnetic structure: every atom of its cell, an anti-centring, the moments", () => {
    const ops = ref.magnetic.operations ?? [];
    const centrings = ops.filter(isPureTranslation);
    const anti = centrings.filter((c) => c.timeReversal === -1);
    expect(anti.length).toBeGreaterThan(0);
    expect(anti.length).toBe(centrings.length - anti.length);
    // Each site expands to n_a·n_b·n_c times its parent orbit: no atom lost to a symbol-built group.
    const cells = ref.n[0] * ref.n[1] * ref.n[2];
    for (const s of ref.structure.sites) {
      const p = b.structure.sites.find((q) => q.label === s.label)!;
      expect(siteMultiplicity(ref.structure.spaceGroup.operations, s.position), s.label).toBe(cells * siteMultiplicity(b.structure.spaceGroup.operations, p.position));
    }
    expect(ref.magnetic.moments.length).toBeGreaterThan(0);
    expect(ref.magnetic.moments.every((m) => m.frame === "crystallographic")).toBe(true);
  });

  it("R0b: the reference is the 100 K nuclear model in an (n·a, b, c) cell at the same origin (its cell used for the basis only)", () => {
    (["a", "b", "c"] as const).forEach((x, i) => {
      expect(ref.n[i]!).toBeGreaterThanOrEqual(1);
      expect(Math.abs(ref.structure.cell[x] / (ref.n[i]! * b.structure.cell[x]) - 1)).toBeLessThanOrEqual(0.01);
    });
    // Another basis would change an angle by degrees.
    for (const x of ["alpha", "beta", "gamma"] as const) expect(Math.abs(ref.structure.cell[x] - b.structure.cell[x])).toBeLessThanOrEqual(1);
    expect(ref.structure.sites.map((s) => s.label).sort()).toEqual(b.structure.sites.map((s) => s.label).sort());
    for (const s of ref.structure.sites) {
      const p = b.structure.sites.find((q) => q.label === s.label)!;
      expect(s.element, s.label).toBe(p.element);
      expect(Math.abs(s.occupancy - p.occupancy), s.label).toBeLessThanOrEqual(1e-3);
      s.position.forEach((x, i) => {
        const d = Math.abs(x * ref.n[i]! - p.position[i]!) % 1;
        expect(Math.min(d, 1 - d), `${s.label} ${"xyz"[i]}`).toBeLessThanOrEqual(1e-4);
      });
    }
  });

  it("R0c: the shared A site is modelled alike — the same magnetic species and ⟨j0⟩ ions, one moment for them, none on the rest, one U_iso", () => {
    const labels = ref.magnetic.moments.map((m) => m.siteLabel).sort();
    expect(labels).toEqual([...b.ions].sort());
    for (const m of ref.magnetic.moments) expect(m.components).toEqual(ref.magnetic.moments[0]!.components);
    const at = ref.structure.sites.find((s) => s.label === labels[0])!.position;
    const cosited = ref.structure.sites.filter((s) => s.position.every((x, i) => Math.abs(x - at[i]!) < 1e-6));
    const bare = cosited.filter((s) => !labels.includes(s.label));
    expect(bare.length).toBeGreaterThan(0);
    for (const s of bare) expect(b.ions).not.toContain(s.label);
    // The like-for-like model carries the reference's ⟨j0⟩ ion on every magnetic species.
    for (const m of like.build.magnetic.moments) {
      const element = b.structure.sites.find((s) => s.label === m.siteLabel)!.element;
      expect(ref.ions.has(element), element).toBe(true);
      expect(m.formFactorId).toBe(`${element}${ref.ions.get(element)}`);
    }
    const app = like.magnetic.moments.filter((m) => labels.includes(m.siteLabel));
    expect(app.map((m) => m.siteLabel).sort()).toEqual(labels);
    for (const m of app) expect(m.components).toEqual(app[0]!.components);
    expect(new Set(ref.structure.sites.map((s) => (s.adp.kind === "isotropic" ? s.adp.bIso : NaN))).size).toBe(1);
  });

  it("R1: k — the app's first k is the reference's: e^{2πi k·T} = θ for each centring T of the reference cell, 1 for its axes", () => {
    const k = b.kRanking[0]!.k;
    const phase = (T: readonly number[]) => Math.cos(2 * Math.PI * (k[0]! * T[0]! + k[1]! * T[1]! + k[2]! * T[2]!));
    const centrings = (ref.magnetic.operations ?? []).filter(isPureTranslation);
    expect(centrings.some((c) => c.timeReversal === -1)).toBe(true);
    for (const c of centrings) expect(Math.abs(phase(c.translation.map((t, i) => t * ref.n[i]!)) - (c.timeReversal ?? 1))).toBeLessThanOrEqual(1e-9);
    for (let i = 0; i < 3; i++) expect(Math.abs(phase([0, 1, 2].map((j) => (j === i ? ref.n[i]! : 0))) - 1)).toBeLessThanOrEqual(1e-9);
  });

  it("R2: the ★ group is the reference's magnetic group — the same operations, θ included, in the same cell and origin", () => {
    // Fractional operators on both sides: the mCIF's cell enters only as the basis (n); any metric is the app's.
    const refKeys = new Set((ref.magnetic.operations ?? []).map(opKey));
    const groupKeys = (model: StructureModel, mag: MagneticModel) => {
      const sup = expandMagneticSupercell(model, mag)!;
      expect(sup.n).toEqual(ref.n);
      return new Set(magneticCellGroup(model, sup).operations.map(opKey));
    };
    const same = (s: Set<string>) => s.size === refKeys.size && [...s].every((x) => refKeys.has(x));
    expect(same(groupKeys(like.model, like.magnetic))).toBe(true);
    expect(same(groupKeys(plain.model, plain.magnetic))).toBe(true);
    // Discriminating: the other maximal candidates are the same group type at another origin or basis.
    const ties = { sameSite: true, magnitudes: false as const, flippedUnits: [] };
    let others = 0;
    for (const [i, r] of b.reps.entries()) {
      if (r.index !== 2 || r.candidate.id === b.best.id || b.dims[i] === 0) continue;
      const build = buildFor(b.structure, K, b.ions, r.candidate.operations, ties);
      const generic = Object.fromEntries(build.params.map((p, j) => [p.id, 0.7 + 0.31 * j]));
      expect(same(groupKeys(b.jointModel, applyMagneticMoments(build.magnetic, build.bindings, generic))), r.candidate.label).toBe(false);
      others++;
    }
    expect(others).toBeGreaterThan(0);
  });

  it("R3a: no b component, in the app and in the reference (symmetry-fixed, printed without an su)", () => {
    for (const m of ref.magnetic.moments) {
      expect(Math.abs(m.components[1]), m.siteLabel).toBeLessThanOrEqual(1e-9);
      expect(ref.sus.get(m.siteLabel)![1]).toBe(0);
    }
    for (const m of [...like.magnetic.moments, ...plain.magnetic.moments]) expect(Math.abs(m.components[1]), m.siteLabel).toBeLessThanOrEqual(1e-9);
  });

  it("R3b: the moment's axis in the a–c plane agrees within 2σ combined (reference ⟨j0⟩, the app's 8 K metric)", () => {
    // The same anchor: the reference's and the app's moment sit on the site itself (orbit 1).
    expect(like.magnetic.moments.find((m) => m.siteLabel === label())!.orbitIndex ?? 1).toBe(1);
    const app = appSide(like);
    const r = refSide(like.model.cell);
    expect(Math.abs(axisDelta(app.phi, r.phi))).toBeLessThanOrEqual(2 * Math.hypot(app.phiSu, r.phiSu));
  });

  it("R4: |M| per magnetic ion agrees within 2σ combined (reference ⟨j0⟩, the app's 8 K metric)", () => {
    const app = appSide(like);
    const r = refSide(like.model.cell);
    expect(r.sizeSu).toBeGreaterThan(0);
    expect(Math.abs(app.size - r.size)).toBeLessThanOrEqual(2 * Math.hypot(app.sizeSu, r.sizeSu));
  });
});

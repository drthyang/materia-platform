import { describe, it, expect } from "vitest";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { dFromTof } from "@/core/diffraction/instrument";
import { buildPowderSpec } from "@/app/powderSpec";
import { CORRECTION_KINDS } from "@/core/diffraction/corrections";
import type { ParameterKind } from "@/core/refinement/types";
import { buildPowderProblem, powderCurves } from "@/core/workflow/powder";
import { refineStaged } from "@/core/refinement/staged";
import { refine } from "@/core/refinement/engine";
import { DEFAULT_STAGE_KINDS, stagesFromKindGroups } from "@/core/workflow/structureRefinement";
import { detectExtraPeaks, annotateExtraPeaks } from "@/core/magnetic/extraPeaks";
import { applyParameters } from "@/core/workflow/apply";
import { generateReflections } from "@/core/diffraction/reflections";
import { searchPropagationVector } from "@/core/magnetic/kSearch";
import { magneticSubgroupLattice, latticeRepresentatives } from "@/core/magnetic/subgroupLattice";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { magneticIonCandidates } from "@/core/magnetic/magneticIons";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { momentCartesian } from "@/core/magnetic/moment";
import { formatMagneticSymbol } from "@/core/magnetic/bnsOg";
import { buildFor, fitRows, momentDims, rankCandidates, type MagneticFit } from "@/app/magneticStep";
import { noiseOf, RANK_RESTARTS } from "@/core/magnetic/momentRestarts";
import { withinNoiseOfBest } from "@/core/diagnostics/hamilton";
import { RANK_NOISE_ALPHA } from "@/core/diagnostics/thresholds";
import { fCritical } from "@/core/math/fDistribution";
import type { SymmetryOperation } from "@/core/crystal/types";
import { dataExists, readData, DATA_DIR } from "@/testSupport/data";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AWO4_DEMO_FILES } from "@/examples/awo4Magnetic";
import type { Vec3 } from "@/core/math/types";

/**
 * PROVENANCE of the LOCAL AWO₄ magnetic demo (`awo4Magnetic.ts`): the numbers
 * it opens on are produced HERE, by the app's own machinery, from the POWGEN
 * 6 K bank-3 histogram of the high-entropy tungstate — never typed in by hand.
 * The result is written to `data/AWO4/awo4_demo_solution.json`, which stays
 * in the git-ignored data folder with the unpublished histogram it derives
 * from; the demo reads it from there at runtime.
 *
 *   1. nuclear staged refinement of the 100 K P2/c model against the 6 K data
 *      (scale → background → cell → TOF profile → ADP → positions);
 *   2. residual-peak detection + k-search (must find k = (½,0,0));
 *   3. every magnetic subgroup candidate of the little group of k is refined
 *      with the nuclear model held fixed — the magnetic page's own "Rank
 *      candidates" (rankCandidates, with its restarts) — and the group chosen
 *      top-down: the maximal group with the fewest moment parameters among
 *      those within the noise of the best fit, by Hamilton's test at 5 %
 *      (topDownGroup below states N, m and b);
 *   4. the chosen candidate is co-refined with the nuclear model; the converged
 *      values are written to the solution file (and echoed as JSON).
 *
 * Slow (minutes) and needs the git-ignored data/ folder, so it runs only with
 * AWO4_SOLVE=1. Ordinary CI never executes it.
 */

const CIF = "AWO4/structure_100K.cif";
const INST = "AWO4/instrument_bank3.instprm";
const GSA = "AWO4/PG3_powder_6K.gsa";
const has = !!process.env.AWO4_SOLVE && dataExists(CIF) && dataExists(INST) && dataExists(GSA);
const K: Vec3 = [0.5, 0, 0];

describe.skipIf(!has)("AWO₄ magnetic demo — solve the 6 K magnetic structure with the app's own tools", () => {
  it("nuclear refinement → k-search → candidate ranking → joint refinement", { timeout: 40 * 60 * 1000 }, async () => {
    const structure = parseCif(readData(CIF), "awo4");
    const instrument = parseInstrumentParameters(readData(INST));
    if (instrument.kind !== "tof") throw new Error("bank-3 instprm should be TOF");
    const pattern = parseGsasHistogramPattern(readData(GSA), "awo4-powder", "AWO4 6 K bank 3", { radiation: { kind: "neutron-tof" } });
    const dArr = pattern.points.map((p) => dFromTof(instrument, p.x));
    console.log(`[awo4] ${pattern.points.length} pts · TOF ${pattern.points[0]!.x.toFixed(0)}–${pattern.points[pattern.points.length - 1]!.x.toFixed(0)} µs · d ${Math.min(...dArr).toFixed(3)}–${Math.max(...dArr).toFixed(3)} Å`);

    // 1. Nuclear staged refinement. The stage plan unlocks kind-groups in
    // order; every structural / profile / microstructure row is sent as
    // unlockable except occupancy, the Gaussian U and the TOF calibration.
    // sig-q stays at its .instprm calibration too: it is the σ² term linear in
    // d (GSAS-II getTOFsig), and over this bank's d range it is not separable
    // from sig-0 and the isotropic Mustrain (∝ d²). Freed with them, both
    // esds exceed their values (ρ(sig-0, sig-q) ≈ −0.98), the pair drifts
    // along that direction, and the stage guard rejects the positions stage.
    const spec = buildPowderSpec(structure, pattern, instrument, true, 6, { positions: true, adp: true });
    const unlock = new Set<ParameterKind>([
      "positionShift", "bIso", "uAniso", "poRatio", ...CORRECTION_KINDS,
      "peakWidth", "profileV", "profileW", "profileX", "profileY", "asymSL", "asymHL", "zeroShift", "tofProfile",
      "stephensStrain", "anisoSizePerp", "anisoSizePar", "mustrainIso",
    ]);
    const heldAtCalibration = new Set(["tof_sigQ"]);
    const t0 = Date.now();
    const staged = refineStaged(
      spec.params.map((p) => (unlock.has(p.kind) && !heldAtCalibration.has(p.id) ? { ...p, fixed: false } : p)),
      (params) => buildPowderProblem(structure, pattern, params, spec.bindings, spec.profile),
      stagesFromKindGroups(DEFAULT_STAGE_KINDS),
      { maxIterations: 12 },
    );
    const nuclear = staged.parameters;
    const nuclearWr = staged.final?.agreement.rWeighted ?? NaN;
    console.log(`[awo4] nuclear staged: wR ${(100 * nuclearWr).toFixed(2)}% · ${staged.stages.map((s) => `${s.name} ${(100 * (s.result.agreement.rWeighted ?? 0)).toFixed(1)}%`).join(" → ")} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    expect(Number.isFinite(nuclearWr)).toBe(true);

    // 2. Residual peaks → k-search, exactly as the magnetic page does it: peaks
    //    ≥ 3σ, annotated against the nuclear reflections, included when I/σ ≥ 5
    //    and off any nuclear position, significance-weighted (capped at 20).
    const curves = powderCurves(structure, pattern, nuclear, spec.bindings, spec.profile);
    const sigma = pattern.points.map((p) => p.sigma!);
    const detected = detectExtraPeaks(dArr, curves.yObs, curves.yCalc, { pointSigma: sigma, minSignificance: 3, limit: 24 });
    const applied = applyParameters(structure, spec.bindings, Object.fromEntries(nuclear.map((p) => [p.id, p.value]))).model;
    const nuclearRefl = generateReflections(applied.cell, applied.spaceGroup, 0.9, 25).map((r) => ({ d: r.d, hkl: `${r.h} ${r.k} ${r.l}`, phaseLabel: "AWO4" }));
    const peaks = annotateExtraPeaks(detected, nuclearRefl);
    const included = peaks.filter((p) => (p.significance ?? Infinity) >= 5 && !p.nearNuclear);
    const kCands = searchPropagationVector(structure.cell, included.map((p) => p.d), {
      tolerance: 0.02, maxQ: 0, weights: included.map((p) => Math.min(p.significance ?? 1, 20)),
    });
    console.log(`[awo4] residual peaks: ${peaks.length} detected · ${included.length} included (I/σ ≥ 5, off nuclear) · ${peaks.filter((p) => p.nearNuclear).length} at nuclear positions`);
    console.log(`[awo4] peaks d/Å (I/σ): ${peaks.map((p) => `${p.d.toFixed(3)}(${(p.significance ?? 0).toFixed(1)}${p.nearNuclear ? "·nuc" : ""})`).join(" ")}`);
    console.log(`[awo4] top k: ${kCands.slice(0, 6).map((c) => `${c.label} ${c.matched}/${c.total} rmsd ${c.rmsd.toFixed(4)} score ${c.score.toFixed(3)}`).join(" | ")}`);
    const kRank = kCands.findIndex((c) => c.k[0] === K[0] && c.k[1] === K[1] && c.k[2] === K[2]);
    console.log(`[awo4] k = (½ 0 0) ranks #${kRank + 1} from the nuclear-fit residual (the 6 K − 100 K difference analysis in realAwo4Magnetic.test.ts puts it first)`);

    // 3. Rank every candidate magnetic group at k against the data, the nuclear
    //    model held: the page's own ranking (rankCandidates — each group fitted
    //    from its seeds and from RANK_RESTARTS kicked starts, the lowest wR
    //    kept) of the page's moment model (buildFor: the co-located ions of the
    //    mixed site share one moment), through the page's in-thread fit.
    const ions = magneticIonCandidates(structure).map((i) => i.siteLabel);
    console.log(`[awo4] magnetic ions: ${ions.join(", ")}`);
    const reps = latticeRepresentatives(magneticSubgroupLattice(structure.spaceGroup.operations, K));
    const dims = momentDims(structure, reps, ions, K);
    const buildOf = (ops: readonly SymmetryOperation[]) => buildFor(structure, K, ions, ops, { sameSite: true, magnitudes: false, flippedUnits: [] });
    const nuclearFixed = nuclear.map((p) => ({ ...p, fixed: true }));
    const fit: MagneticFit = {
      agreementLabel: "wR",
      refine: async (magnetic, momentParams, momentBindings) => {
        const res = refine(buildMagneticPowderProblem(structure, magnetic, pattern, [...nuclearFixed, ...momentParams], [...spec.bindings, ...momentBindings], spec.profile), { maxIterations: 20 });
        const values: Record<string, number> = {};
        for (const p of momentParams) values[p.id] = res.parameters[p.id] ?? p.value;
        return { values, agreement: res.agreement.rWeighted ?? null, ...noiseOf(res) };
      },
    };
    const t1 = Date.now();
    const results = await rankCandidates({ structure, reps, dims, scope: "all", open: new Set(), build: buildOf, fit });
    const ranked: Ranked[] = [];
    for (const rep of reps) {
      const e = results[rep.candidate.id];
      if (e?.status !== "ok" || e.wR == null || e.chi2 === undefined || e.dof === undefined) continue;
      const build = buildOf(rep.candidate.operations);
      // The page's label. For this k it names the operations in the parent cell
      // as a k = 0 group: the bundled table holds types I and III only, so the
      // magnetic space group's own BNS number (type IV, with the anti-translation
      // the k gives the doubled cell) is not identified.
      const std = rep.candidate.standard ?? rep.settingMatch?.identity;
      ranked.push({
        id: rep.candidate.id,
        label: std ? `${formatMagneticSymbol(std.bnsSymbol)} BNS ${std.bnsNumber}` : rep.candidate.label,
        index: rep.index,
        parameters: fitRows(build).filter((p) => !p.fixed).length,
        wR: e.wR, chi2: e.chi2, dof: e.dof, values: e.values,
        moments: e.magnitudes.map((m) => `${m.label} ${m.value.toFixed(2)}`).join(", "),
        ops: rep.candidate.operations.map((o) => ({ xyz: o.xyz, timeReversal: (o.timeReversal ?? 1) as 1 | -1 })),
      });
    }
    console.log(`[awo4] ranked ${ranked.length} groups (${RANK_RESTARTS} restarts each) in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
    const { chosen, equivalent, tests } = topDownGroup(ranked, RANK_NOISE_ALPHA);
    for (const r of [...ranked].sort((a, b) => a.chi2 - b.chi2)) {
      const t = tests.get(r.id);
      console.log(`[awo4]   ${r.label} (index ${r.index}, m = ${r.parameters} moment parameters; the page counts ${dims[reps.findIndex((x) => x.candidate.id === r.id)]}): wR ${(100 * r.wR).toFixed(3)}% · χ² ${r.chi2.toFixed(1)}, ν = N − m = ${r.dof} · |M| ${r.moments}${t ? ` · vs the best: b = ${t.b}, F = ${t.F.toFixed(2)} (F_crit ${t.Fcrit.toFixed(2)}), R = ${t.R.toFixed(5)} (R_crit ${t.Rcrit.toFixed(5)}) → ${t.F > t.Fcrit ? "worse beyond the noise" : "within the noise"}` : " · the best χ²"}`);
    }
    console.log(`[awo4] baseline nuclear wR ${(100 * nuclearWr).toFixed(2)}% · Hamilton at α = ${RANK_NOISE_ALPHA}, N = ${ranked[0]!.dof + ranked[0]!.parameters} points: ${equivalent.length} group(s) within the noise of the best (${equivalent.map((r) => r.label).join("; ")}) → top-down: ${chosen.label} (index ${chosen.index}, m = ${chosen.parameters})`);
    const best = chosen;

    // 4. Joint refinement of the chosen candidate (nuclear free set + moments).
    const bestBuild = buildOf(best.ops.map((o) => ({ ...parseXyz(o.xyz), timeReversal: o.timeReversal })));
    const jointParams = [
      ...nuclear.map((p) => ({ ...p })),
      ...bestBuild.params.map((p) => ({ ...p, value: best.values[p.id] ?? p.value, initialValue: best.values[p.id] ?? p.value, fixed: false })),
    ];
    const joint = refine(
      buildMagneticPowderProblem(structure, bestBuild.magnetic, pattern, jointParams, [...spec.bindings, ...bestBuild.bindings], spec.profile),
      { maxIterations: 20 },
    );
    const finalValues: Record<string, number> = {};
    for (const p of jointParams) finalValues[p.id] = joint.parameters[p.id] ?? p.value;
    const finalMag = applyMagneticMoments(bestBuild.magnetic, bestBuild.bindings, finalValues);
    console.log(`[awo4] joint: wR ${(100 * (joint.agreement.rWeighted ?? 0)).toFixed(2)}% (${joint.status}) · |M| ${finalMag.moments.map((m) => Math.hypot(...momentCartesian(structure.cell, m)).toFixed(2)).join(", ")}`);
    // What the joint step moved, in esds of the joint fit: the moments trade
    // with the scale and the ADPs (magnetic-analysis, Stage 4).
    const esd = joint.esd ?? {};
    const moved = jointParams.filter((p) => !p.fixed && esd[p.id]).map((p) => ({ id: p.id, from: p.value, to: finalValues[p.id]!, z: (finalValues[p.id]! - p.value) / esd[p.id]! }));
    console.log(`[awo4] joint moved (Δ/esd, largest first): ${moved.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 8).map((m) => `${m.id} ${m.from.toPrecision(4)} → ${m.to.toPrecision(4)} (${m.z.toFixed(1)})`).join(" · ")}`);
    console.log(`[awo4] joint moments: ${bestBuild.params.map((p) => `${p.id} ${finalValues[p.id]!.toFixed(3)}±${(esd[p.id] ?? NaN).toFixed(3)}`).join(" · ")} · |ρ| ≥ 0.8 with a moment: ${[...(joint.diagnostics?.highCorrelations ?? []), ...(joint.diagnostics?.moderateCorrelations ?? [])].filter((c) => bestBuild.params.some((p) => p.id === c.parameterIdA || p.id === c.parameterIdB)).map((c) => `${c.parameterIdA}~${c.parameterIdB} ${c.coefficient.toFixed(2)}`).join(", ") || "none"}`);
    const solution = {
      k: K,
      group: best.label,
      ops: best.ops,
      ions,
      backgroundTerms: 6,
      params: Object.fromEntries(Object.entries(finalValues).map(([k, v]) => [k, Number(v.toPrecision(10))])),
      nuclearWr: Number(nuclearWr.toPrecision(6)),
      jointWr: Number((joint.agreement.rWeighted ?? NaN).toPrecision(6)),
      /** |M| (µB) of the tied cations after the joint fit: the demo test checks the demo carries it. */
      moment: Number(Math.hypot(...momentCartesian(structure.cell, finalMag.moments[0]!)).toPrecision(6)),
      selection: { test: "Hamilton (F on χ²)", alpha: RANK_NOISE_ALPHA, observations: best.dof + best.parameters },
      withinNoise: equivalent.map((r) => r.label),
      ranking: ranked.map((r) => ({
        label: r.label, index: r.index, parameters: r.parameters, wR: Number(r.wR.toPrecision(6)),
        chi2: Number(r.chi2.toPrecision(8)), dof: r.dof, moments: r.moments,
      })),
      solvedAt: new Date().toISOString(),
    };
    const out = resolve(DATA_DIR, AWO4_DEMO_FILES.solution);
    writeFileSync(out, JSON.stringify(solution, null, 2) + "\n");
    console.log(`[awo4] solution written to ${out}`);
    console.log("[awo4-json] " + JSON.stringify(solution));
    expect(joint.agreement.rWeighted ?? 1).toBeLessThan(nuclearWr);
  });
});

/** One ranked group: its moments-only fit and the moment parameters it refined. */
interface Ranked {
  readonly id: string;
  readonly label: string;
  /** Index in the parent group (2 = maximal). */
  readonly index: number;
  /** The moment rows the fit refined (m): a mixed site's tied ions count once, a split orbit twice. */
  readonly parameters: number;
  readonly wR: number;
  readonly chi2: number;
  /** ν = N − m: the points the fit weighs less the rows it refined. */
  readonly dof: number;
  readonly values: Record<string, number>;
  readonly moments: string;
  readonly ops: { xyz: string; timeReversal: 1 | -1 }[];
}

interface HamiltonTest {
  /** The extra moment parameters of the best fit (at least 1). */
  readonly b: number;
  readonly F: number;
  readonly Fcrit: number;
  /** wR ratio and Hamilton's critical ratio √(1 + b/ν · F_crit). */
  readonly R: number;
  readonly Rcrit: number;
}

/**
 * The magnetic group, top-down (magnetic-analysis, Stage 2), with a
 * significance test for every extra parameter.
 *
 * Landau theory prefers a maximal group (one irrep), and a powder often
 * cannot tell a maximal group from its subgroups: a subgroup that contains
 * the maximal group's moment arrangement as a special case reaches the same
 * wR with its extra moment parameters at no use. Lowest wR alone hands those
 * parameters the win on round-off, or on a misfit of the nuclear model they
 * happen to absorb. So a group with more parameters is
 * chosen only when the data require it: by Hamilton's test (W. C. Hamilton,
 * Acta Cryst. 18 (1965) 502), in its F form on χ² — for the R-factor ratio
 * R = wR_f/wR_best of fits to the same points with the same weights,
 * R² − 1 = (χ²_f − χ²_best)/χ²_best, so R > R(b, ν, α) = √(1 + b/ν·F(α; b, ν))
 * exactly when F = (χ²_f − χ²_best)/b / (χ²_best/ν) > F(α; b, ν). Here N is
 * the points with weight, m the moment rows the fit refines (the nuclear
 * model is held, as the page ranks), ν = N − m of the best fit, b its extra
 * moment parameters over the group tested (at least 1: a group with as many
 * parameters is within the noise when its χ² is above the best's by less
 * than one parameter's worth), and α = RANK_NOISE_ALPHA (5 %).
 *
 * This is core/diagnostics/hamilton.ts's `withinNoiseOfBest`, the page's own
 * test, and the page's order among the fits within the noise: the lowest
 * index (a maximal group first), then the fewest moment parameters, then wR.
 * It differs from the page's ★ (magneticStep.ts, bestRanked) in one input:
 * the page counts a group's parameters as momentDims, the allowed moment
 * directions summed over the chosen ions (10 for P2/c′ on the five ions of
 * the mixed site here), where its fit refines one moment per site (2): b
 * comes out several times too large, and the ★'s "fewest moment parameters"
 * can order two groups the wrong way. The test needs the parameters the fits
 * refine; this solve counts them.
 *
 * The test assumes independent errors. Powder residuals are serially
 * correlated, and a GoF well above 1 says the model misses more than noise,
 * so N points overstate the information: a difference the test calls
 * significant may not be, never the reverse. It errs toward the lower
 * symmetry; a group it keeps within the noise is a safe call.
 */
function topDownGroup(ranked: readonly Ranked[], alpha: number): { chosen: Ranked; equivalent: Ranked[]; tests: Map<string, HamiltonTest> } {
  const within = withinNoiseOfBest(ranked.map((r) => ({ id: r.id, chi2: r.chi2, dof: r.dof, parameters: r.parameters })), alpha);
  const best = ranked.reduce((a, r) => (r.chi2 < a.chi2 ? r : a));
  const noise = best.chi2 / best.dof;
  const tests = new Map<string, HamiltonTest>();
  for (const r of ranked) {
    if (r === best) continue;
    const b = Math.max(1, best.parameters - r.parameters);
    const Fcrit = fCritical(alpha, b, best.dof);
    tests.set(r.id, { b, F: (r.chi2 - best.chi2) / b / noise, Fcrit, R: r.wR / best.wR, Rcrit: Math.sqrt(1 + (b / best.dof) * Fcrit) });
  }
  const equivalent = ranked.filter((r) => within.has(r.id)).sort((a, b) => a.index - b.index || a.parameters - b.parameters || a.wR - b.wR);
  return { chosen: equivalent[0]!, equivalent, tests };
}

import { parseSymmetryOperation } from "@/core/crystal/symmetry";
function parseXyz(xyz: string): ReturnType<typeof parseSymmetryOperation> {
  return parseSymmetryOperation(xyz);
}

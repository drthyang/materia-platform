import { describe, it, expect } from "vitest";
import type { Vec3 } from "@/core/math/types";
import { parseMagneticCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { allowedMomentDirections } from "@/core/magnetic/allowedMoments";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { magneticStructureFactor } from "@/core/magnetic/structureFactor";
import { siteMultiplicity } from "@/core/crystal/symmetry";
import { buildPowderSpec } from "@/app/powderSpec";
import { buildMagneticPowderProblem } from "@/core/workflow/magneticPowder";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { refine } from "@/core/refinement/engine";
import { dataExists, readData, LOCAL_DATA, LOCAL_REFERENCES } from "@/testSupport/data";
import type { RefinementParameter } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";

/**
 * Golden-data validation against the user's GSAS-II refinement of the local
 * hexagonal magnetic dataset (`LOCAL_DATA.hexMagnetic`, unpublished):
 *
 *  - `Pc6mcc_Mz.cif` — the refined magnetic structure: a c-doubled gray BNS
 *    group with an anti-translation (0,0,½)′, a CO-LOCATED pair of species on
 *    one site (occupancy disorder), both moments tied along c, plus the other
 *    sites and anisotropic ADPs.
 *  - the reference values (the .gpx converged state, GSAS-II's reflection
 *    counts and fit window, the site labels) in data/local-references.json.
 *  - `PWDR_1p7K_Bank2.fxye` + `.instprm` — the POWGEN histogram and its
 *    bank's calibration, extracted from the GSAS-II project; `gsas2_mag_refl.txt`
 *    — GSAS-II's magnetic reflection list at its converged state (metallic
 *    ⟨j0⟩).
 *
 * Against Mn₃Ga this exercises the complementary paths: c-axis moments, a
 * gray anti-translation BNS lattice, tieSameSite (one tied moment parameter
 * across two co-located species with different form factors — GSAS-II's
 * `AMz` constraint), and anisotropic ADPs. Skips when data/ is absent.
 */
const DIR = LOCAL_DATA.hexMagnetic.refinement;
/** The reference values (data/local-references.json). */
const REF = LOCAL_REFERENCES?.hexMagnetic;
const hasCif = !!REF && dataExists(`${DIR}/Pc6mcc_Mz.cif`);
const hasData = hasCif && dataExists(`${DIR}/PWDR_1p7K_Bank2.fxye`) && dataExists(`${DIR}/PWDR_1p7K_Bank2.instprm`);

/** The .gpx converged state (differs slightly from the earlier-state mCIF). */
const GPX = (): { occ: Readonly<Record<string, number>>; ff: Readonly<Record<string, string>>; moment: number } =>
  ({ occ: REF!.gpx.occupancies, ff: REF!.gpx.formFactors, moment: REF!.gpx.moment });
/** The co-located magnetic species (one site), and the non-magnetic sites. */
const MAGNETIC = (): string[] => [...REF!.magneticSites];

/** mCIF structure+model shifted onto the .gpx converged state. */
function loadGpxState(): { structure: StructureModel; magnetic: MagneticModel } {
  const { structure, magnetic } = parseMagneticCif(readData(`${DIR}/Pc6mcc_Mz.cif`), "hex");
  const gpx = GPX();
  const cell = REF!.gpx.cell;
  return {
    structure: {
      ...structure,
      cell: { ...structure.cell, a: cell.a, b: cell.a, c: cell.c },
      sites: structure.sites.map((s) => (gpx.occ[s.label] !== undefined ? { ...s, occupancy: gpx.occ[s.label]! } : s)),
    },
    magnetic: {
      ...magnetic!,
      moments: magnetic!.moments.map((m) => ({
        ...m,
        formFactorId: gpx.ff[m.siteLabel]!,
        components: [0, 0, gpx.moment] as Vec3,
      })),
    },
  };
}

describe.skipIf(!hasCif)("local hexagonal golden — magnetic symmetry vs GSAS-II", () => {
  const load = () => parseMagneticCif(readData(`${DIR}/Pc6mcc_Mz.cif`), "hex");

  it("parses the gray BNS group P_c 6/m c c (48 ops, half with time reversal)", () => {
    const { structure } = load();
    const ops = structure.spaceGroup.operations;
    expect(ops).toHaveLength(48);
    expect(ops.filter((o) => o.timeReversal === -1)).toHaveLength(24);
  });

  it("reproduces GSAS-II's site multiplicities", () => {
    const { structure } = load();
    const ops = structure.spaceGroup.operations;
    const site = (l: string) => structure.sites.find((s) => s.label === l)!;
    const entries = Object.entries(REF!.multiplicities);
    expect(entries.length).toBeGreaterThan(0);
    for (const [label, m] of entries) expect(siteMultiplicity(ops, site(label).position), label).toBe(m);
  });

  it("reproduces GSAS-II's site symmetry mm'm'(100) → moment ∥ c only", () => {
    const { structure } = load();
    const pos = structure.sites.find((s) => s.label === MAGNETIC()[0])!.position;
    const allowed = allowedMomentDirections(structure.spaceGroup.operations, pos, [0, 0, 0]);
    expect(allowed.dimension).toBe(1);
    const b = allowed.basis[0]!;
    expect(Math.abs(b[0]!)).toBeLessThan(1e-9);
    expect(Math.abs(b[1]!)).toBeLessThan(1e-9);
    expect(Math.abs(b[2]!)).toBeGreaterThan(0.9);
  });

  it("golden moments: the mCIF's tied moment along c on both co-located species; the other sites dropped as non-magnetic", () => {
    const { magnetic } = load();
    const byLabel = new Map(magnetic!.moments.map((m) => [m.siteLabel, m.components]));
    for (const label of MAGNETIC()) expect(byLabel.get(label), label).toEqual([0, 0, REF!.mcifMoment]);
    for (const label of REF!.nonMagneticSites) expect(byLabel.has(label), label).toBe(false);
  });

  it("buildMagneticModel ties the co-located species to ONE moment parameter (GSAS AMz constraint)", () => {
    const { structure } = load();
    const build = buildMagneticModel(structure, [0, 0, 0], MAGNETIC(), structure.spaceGroup.operations);
    const modes = build.params.filter((p) => p.kind === "momentMode");
    // tieSameSite (default): one shared Mz amplitude drives both species.
    expect(modes).toHaveLength(1);
    const bindings = build.bindings.filter((b) => b.parameterId === modes[0]!.id);
    expect(bindings.map((b) => b.targetKey).sort()).toEqual(MAGNETIC().sort());
    expect(build.magnetic.moments).toHaveLength(2);
  });
});

describe.skipIf(!dataExists(`${DIR}/gsas2_mag_refl.txt`) || !hasCif)("local hexagonal golden — per-reflection |F_M|² vs GSAS-II", () => {
  // GSAS-II magnetic reflection list (h k l mult d Fcsq, (10⁻¹² cm)² → ×100)
  // at the .gpx converged state. Every symmetry-forbidden reflection must be
  // zero; allowed ones agree closely. A few weak high-cos²α satellites sit
  // above GSAS-II's Fc — the same reflections where GSAS-II's own Fo/Fc
  // disagree severalfold — so the gate is: zeros exact, ≥ 80% of allowed within ±8%,
  // median within 5%.
  it("matches GSAS-II: every zero exact, the allowed reflections close in median", () => {
    const { structure, magnetic } = loadGpxState();
    const rows = readData(`${DIR}/gsas2_mag_refl.txt`).trim().split("\n").map((ln) => ln.trim().split(/\s+/).map(Number));
    const counts = REF!.reflections;
    expect(rows).toHaveLength(counts.total);
    let zeros = 0;
    const ratios: number[] = [];
    for (const [h, k, l, , , gsas] of rows) {
      const ours = magneticStructureFactor(structure, magnetic, h!, k!, l!).squared / 100;
      if (gsas! < 1e-3) {
        zeros++;
        expect(ours).toBeLessThan(5e-3);
      } else {
        ratios.push(ours / gsas!);
      }
    }
    expect(zeros).toBe(counts.zeros);
    expect(ratios).toHaveLength(counts.allowed);
    // The reference's count, one below its first value: the per-image
    // anisotropic-ADP rotation fix (U′ = R·U·Rᵀ, 2026-07-17) moved one
    // borderline reflection across this arbitrary ±8 % band by a 0.7 % shift.
    // The distribution is otherwise unchanged (median and worst-case gates
    // below are unaffected); the near-axial tensors are largely invariant
    // under its hexagonal ops.
    const within8 = ratios.filter((r) => r > 0.92 && r < 1.08).length;
    expect(within8).toBeGreaterThanOrEqual(counts.within8);
    const median = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)]!;
    expect(median).toBeGreaterThan(0.95);
    expect(median).toBeLessThan(1.05);
    for (const r of ratios) expect(r).toBeLessThan(1.35); // worst-case bound
  });
});

describe.skipIf(!hasData)("local hexagonal golden — moment refinement against the POWGEN histogram", () => {
  // GSAS-II's fit window (µs) from the .gpx Limits.
  const [TOF_MIN, TOF_MAX] = hasData ? REF!.tofWindow : [0, 0];

  it("refines the tied moment of the co-located site to the golden value ∥ c", { timeout: 120000 }, () => {
    const { structure } = loadGpxState();
    const inst = parseInstrumentParameters(readData(`${DIR}/PWDR_1p7K_Bank2.instprm`));
    const full = parseGsasHistogramPattern(readData(`${DIR}/PWDR_1p7K_Bank2.fxye`), "pg-hex", "local hexagonal", { radiation: { kind: "neutron-tof" } });
    const pattern = { ...full, points: full.points.filter((p) => p.x >= TOF_MIN && p.x <= TOF_MAX) };
    expect(pattern.points.length).toBeGreaterThan(2000); // GSAS-II's fit has more

    const spec = buildPowderSpec(structure, pattern, inst, true, 6, {});
    const gpx = GPX();
    const build = buildMagneticModel(structure, [0, 0, 0], MAGNETIC(), structure.spaceGroup.operations);
    // Metallic form factors, as in the GSAS-II refinement.
    const magnetic: MagneticModel = {
      ...build.magnetic,
      moments: build.magnetic.moments.map((m) => ({ ...m, formFactorId: gpx.ff[m.siteLabel]! })),
    };
    const modes = build.params.filter((p) => p.kind === "momentMode");
    expect(modes).toHaveLength(1);
    const momentId = modes[0]!.id;

    const bindingsAll = [...spec.bindings, ...build.bindings];
    const freeKinds = new Set(["scale", "background", "tofProfile", "mustrainIso"]);
    const wrOf = (params: RefinementParameter[]): { wr: number; values: Record<string, number>; esd?: Record<string, number> } => {
      // Staged internally: scale + background before profile (see the Mn3Ga
      // golden test — freeing the profile from raw seeds can diverge).
      const pass1 = params.map((p) => (p.kind === "tofProfile" || p.kind === "mustrainIso" || (p.kind === "momentMode" && !p.fixed) ? { ...p, fixed: true } : { ...p }));
      const r1 = refine(buildMagneticPowderProblem(structure, magnetic, pattern, pass1, bindingsAll, { shape: "tof" }), { maxIterations: 20 });
      const pass2 = params.map((p) => ({ ...p, value: r1.parameters[p.id] ?? p.value }));
      const r = refine(buildMagneticPowderProblem(structure, magnetic, pattern, pass2, bindingsAll, { shape: "tof" }), { maxIterations: 30 });
      return { wr: 100 * (r.agreement.rWeighted ?? 1), values: r.parameters, ...(r.esd ? { esd: r.esd } : {}) };
    };
    const base = spec.params.map((p) => ({ ...p, fixed: !freeKinds.has(p.kind) }));
    const withMoment = (value: number, fixed: boolean, from?: Record<string, number>): RefinementParameter[] => [
      ...base.map((p) => ({ ...p, ...(from && from[p.id] !== undefined ? { value: from[p.id]! } : {}) })),
      ...modes.map((p) => ({ ...p, value: from?.[p.id] ?? value, initialValue: value, fixed })),
    ];

    // Stage the full fit from a deliberately wrong seed (well above the golden moment):
    // the refinement must find the golden moment on its own.
    const seed = 1.5;
    expect(seed).toBeGreaterThan(2 * gpx.moment);
    const stage1 = wrOf(withMoment(seed, true));
    const fit = wrOf(withMoment(seed, false, stage1.values));

    // The magnetic signal is weak (a small moment on the mixed site) and the
    // whole-pattern wR is dominated by the unmodelled uniaxial size/mustrain +
    // λ-dependent absorption of the GSAS-II two-phase fit (ours is single-phase
    // and isotropic, so its wR is well above GSAS-II's). So the magnetic
    // discrimination is gated on a PURE-magnetic satellite (l odd ⇒
    // nuclear-forbidden): with the golden
    // moment that peak must be explained; with zero moment it must not.
    const atFit = (value: number): RefinementParameter[] =>
      withMoment(value, true, fit.values).map((p) => ({ ...p, fixed: true, ...(p.kind === "momentMode" ? { value } : {}) }));
    const calcWith = (value: number): Float64Array =>
      buildMagneticPowderProblem(structure, magnetic, pattern, atFit(value), bindingsAll, { shape: "tof" })
        .calculate(Object.fromEntries(atFit(value).map((p) => [p.id, p.value])));
    const windowResidual = (yCalc: Float64Array): number => {
      let s = 0;
      pattern.points.forEach((p, i) => {
        if (p.x < REF!.satelliteWindow[0] || p.x > REF!.satelliteWindow[1]) return;
        const sig = p.sigma ?? Math.sqrt(Math.max(p.yObs, 1));
        s += ((p.yObs - yCalc[i]!) / sig) ** 2;
      });
      return s;
    };
    const chiZero = windowResidual(calcWith(0));
    const chiGolden = windowResidual(calcWith(gpx.moment));
    const chiFit = windowResidual(calcWith(fit.values[momentId]!));

    console.log(`wR fit=${fit.wr.toFixed(2)}% | moment=${fit.values[momentId]?.toFixed(4)} ± ${fit.esd?.[momentId]?.toFixed(4)} µB | satellite-window χ²: zero=${chiZero.toFixed(0)} golden=${chiGolden.toFixed(0)} fit=${chiFit.toFixed(0)}`);

    expect(fit.wr).toBeLessThan(30);
    // The magnetic satellite is real and our |F_M|² explains it: the moment
    // buys a statistically decisive χ² drop in the window (calibrated on the
    // data: a drop of more than ten times the noise scale, on a profile-misfit
    // baseline), and the free fit does at least as well as the golden moment.
    expect(chiGolden).toBeLessThan(chiZero * 0.95);
    expect(chiFit).toBeLessThanOrEqual(chiGolden);

    // The refined moment reproduces the golden structure (GSAS-II's converged
    // moment and the mCIF's). A global sign flip is
    // diffraction-equivalent.
    const m = Math.abs(fit.values[momentId] ?? 0);
    expect(m).toBeGreaterThan(REF!.momentRange[0]);
    expect(m).toBeLessThan(REF!.momentRange[1]);

    // Both co-located species carry the same tied moment ∥ c.
    const refined = applyMagneticMoments(magnetic, build.bindings, fit.values);
    const [first, second] = MAGNETIC().map((l) => refined.moments.find((x) => x.siteLabel === l)!.components);
    expect(first).toEqual(second);
    expect(Math.abs(first![0]!)).toBeLessThan(1e-9);
    expect(Math.abs(first![1]!)).toBeLessThan(1e-9);
  });
});

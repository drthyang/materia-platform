import { describe, it, expect } from "vitest";
import { exampleStructure } from "@/examples/highEntropyWO4";
import { exampleStructure as mn3ga } from "@/examples/mn3ga";
import { buildSyntheticPowder } from "@/examples/synthetic";
import { buildPowderSpec, powderRestraints } from "@/app/powderSpec";
import { buildMultiPhaseSpec } from "@/app/multiPhaseSpec";
import { DEFAULT_INSTRUMENT, newSession } from "@/app/powderSession";
import { withParameter, withSiteTotal } from "@/app/powderPage";
import { powderWorkspaceFrom, projectFileFor, sessionFromPowderWorkspace } from "@/app/projectIo";
import { validateProjectFile } from "@/core/project/validate";
import type { PowderWorkspace } from "@/core/project/types";
import { applyParameters } from "@/core/workflow/apply";
import { buildPowderProblem } from "@/core/workflow/powder";
import { buildStructureRefinement, siteSumRangeWarnings } from "@/core/workflow/structureRefinement";
import { resolveTies } from "@/core/refinement/constraints";
import { refine, type RefinementProblem } from "@/core/refinement/engine";
import type { RefinementParameter } from "@/core/refinement/types";
import type { StructureModel } from "@/core/crystal/types";

/**
 * The powder page's shared site: as on the PDF page, the last member's
 * occupancy follows the site's total minus the others' (1, or a total set
 * below 1 for vacancies), in place of the soft Σ restraint. The bundled
 * high-entropy tungstate's A site (six cations, 0.167 each) on its synthetic
 * powder pattern.
 */

const A = ["occ_Co1", "occ_Fe1", "occ_Ni1", "occ_Mn1", "occ_Cu8", "occ_Zn1"];
const SUM = "sum(occ_Co1, occ_Fe1, occ_Ni1, occ_Mn1, occ_Cu8)";

/** The structure the forward model sees at these values: its A-site occupancies' sum. */
const siteSum = (structure: StructureModel, ps: readonly RefinementParameter[], bindings: Parameters<typeof applyParameters>[1], values: Readonly<Record<string, number>>): number =>
  applyParameters(structure, bindings, resolveTies(ps, values)).model.sites.filter((s) => A.includes(`occ_${s.label}`)).reduce((acc, s) => acc + s.occupancy, 0);

describe("a shared site's occupancies on the powder page", () => {
  const st = exampleStructure();
  const pattern = buildSyntheticPowder(st);

  it("are tied to the site's total, not restrained; a total below 1 is the tie's constant", () => {
    const spec = buildPowderSpec(st, pattern, DEFAULT_INSTRUMENT);
    const zn = spec.params.find((p) => p.id === "occ_Zn1")!;
    expect(zn.expression).toBe(`= 1 - ${SUM}`);
    expect(zn.fixed).toBe(true);
    expect(zn.value).toBe(1 - [0.167, 0.167, 0.167, 0.167, 0.167].reduce((a, b) => a + b, 0));
    const free = spec.params.map((p) => (A.includes(p.id) && !p.expression ? { ...p, fixed: false } : p));
    expect(powderRestraints([st], {}, free)).toEqual([]);
    const vacant = buildPowderSpec(st, pattern, DEFAULT_INSTRUMENT, true, 4, { totals: { Co1: 0.95 } }).params.find((p) => p.id === "occ_Zn1")!;
    expect(vacant.expression).toBe(`= 0.95 - ${SUM}`);
    expect(vacant.value).toBeCloseTo(0.115, 12);
    // Two phases: each phase's tie reads its own rows.
    const multi = buildMultiPhaseSpec([st, { ...st, id: "he2", name: "he2" }], pattern, DEFAULT_INSTRUMENT, 4, { totals: { Co1: 0.95 } });
    expect(multi.params.find((p) => p.id === "p1_occ_Zn1")!.expression).toBe(`= 0.95 - ${SUM.replace(/occ_/g, "p1_occ_")}`);
  });

  for (const total of [1, 0.95]) {
    it(`sum exactly to the site's total (${total}) at every evaluation of a fit, from occupancies loaded off`, () => {
      const loaded: StructureModel = { ...st, sites: st.sites.map((s) => (A.includes(`occ_${s.label}`) ? { ...s, occupancy: 0.2 } : s)) };
      const totals = total === 1 ? {} : { totals: { Co1: total } };
      const spec = buildPowderSpec(loaded, pattern, DEFAULT_INSTRUMENT, true, 4, totals);
      const params = spec.params.map((p) => ({ ...p, fixed: !!p.expression || !(p.kind === "scale" || A.includes(p.id)) }));
      expect(params.filter((p) => !p.fixed && p.kind === "occupancy")).toHaveLength(5);
      let worst = 0;
      let evaluations = 0;
      const problem = buildPowderProblem(loaded, pattern, params, spec.bindings, spec.profile, powderRestraints([loaded], totals, params));
      const watched: RefinementProblem = {
        ...problem,
        calculate: (values, options) => {
          worst = Math.max(worst, Math.abs(siteSum(loaded, params, spec.bindings, values) - total));
          evaluations++;
          return problem.calculate(values, options);
        },
      };
      const res = refine(watched, { maxIterations: 6 });
      expect(evaluations).toBeGreaterThan(20);
      expect(worst).toBeLessThan(1e-12);
      expect(Math.abs(A.reduce((acc, id) => acc + res.parameters[id]!, 0) - total)).toBeLessThan(1e-12);
    });
  }

  it("follow a new total on the page, keep their values, and warn when the last leaves [0, 1]", () => {
    const s0 = newSession(st);
    const s1 = withSiteTotal(s0, "Co1", 0.9, DEFAULT_INSTRUMENT);
    expect(s1.siteTies.totals).toEqual({ Co1: 0.9 });
    const zn = s1.powderParams.find((p) => p.id === "occ_Zn1")!;
    expect(zn.expression).toBe(`= 0.9 - ${SUM}`);
    expect(zn.value).toBeCloseTo(0.065, 12);
    expect(s1.powderParams.find((p) => p.id === "occ_Co1")!.value).toBe(0.167);
    expect(siteSumRangeWarnings(s1.powderParams)).toEqual([]);
    // The others pushed past the total by hand: the last goes negative, flagged, not clamped.
    const s2 = withParameter(s1, "occ_Co1", { value: 0.3 });
    expect(s2.powderParams.find((p) => p.id === "occ_Zn1")!.value).toBeCloseTo(-0.068, 12);
    expect(siteSumRangeWarnings(s2.powderParams)[0]).toMatch(/^occ_Zn1 = -0\.0680 is outside \[0, 1\]: it follows 0\.9 − \(occ_Co1 \+ .*sum to more than the site's total 0\.9/);
    expect(withSiteTotal(s1, "Co1", 1, DEFAULT_INSTRUMENT).siteTies.totals).toBeUndefined();
  });

  it("open tied from a project saved with the soft Σ: values kept, the last following the others, and it refines", () => {
    const s = newSession(st);
    const saved = powderWorkspaceFrom(s, null, DEFAULT_INSTRUMENT, false, { fitRange: null, displayUnit: null, manualPeakD: [] });
    // As main saved it: no tie, the six occupancies free at 0.167 (Σ 1.002), "Σ occ = 1" switched on.
    const old = {
      ...saved,
      siteTies: { ...saved.siteTies, occupancyToUnity: true },
      refinement: {
        ...saved.refinement,
        parameters: saved.refinement.parameters.map((p) => {
          const { expression: _e, ...rest } = p;
          return A.includes(p.id) ? { ...rest, value: 0.167, initialValue: 0.167, fixed: false } : p.expression && p.kind !== "occupancy" ? p : rest;
        }),
      },
    } as PowderWorkspace;
    expect(old.refinement.parameters.filter((p) => p.kind === "occupancy").some((p) => "expression" in p)).toBe(false);
    const file = validateProjectFile(JSON.parse(JSON.stringify(projectFileFor({ structures: [st], workspace: old, title: "old" }))));
    const { session } = sessionFromPowderWorkspace(file.workspace as PowderWorkspace, file.structures);
    expect("occupancyToUnity" in session.siteTies).toBe(false);
    const zn = session.powderParams.find((p) => p.id === "occ_Zn1")!;
    expect(zn.expression).toBe(`= 1 - ${SUM}`);
    expect(zn.fixed).toBe(true);
    expect(zn.value).toBeCloseTo(0.165, 12);
    expect(zn.initialValue).toBe(zn.value);
    expect(session.powderParams.filter((p) => A.includes(p.id) && !p.fixed).map((p) => p.id)).toEqual(A.slice(0, 5));
    const params = session.powderParams.map((p) => ({ ...p, fixed: p.fixed || !(p.kind === "scale" || A.includes(p.id)) }));
    const res = refine(buildPowderProblem(st, session.pattern, params, session.powderBindings, session.powderProfile, powderRestraints([st], session.siteTies, params)), { maxIterations: 4 });
    expect(Math.abs(A.reduce((acc, id) => acc + res.parameters[id]!, 0) - 1)).toBeLessThan(1e-12);
  });
});

describe("a structure with no shared site on the powder page", () => {
  it("gets the same rows and the same refinement with the tie as without it (main's path)", () => {
    const st = mn3ga();
    const pattern = buildSyntheticPowder(st);
    const opts = { refineOccupancy: true, backgroundTerms: 3 };
    const tied = buildStructureRefinement(st, pattern, { ...opts, tieSharedOccupancy: true });
    const soft = buildStructureRefinement(st, pattern, opts);
    expect([tied.params, tied.bindings, tied.restraints]).toEqual([soft.params, soft.bindings, soft.restraints]);
    const free = (ps: readonly RefinementParameter[]): RefinementParameter[] => ps.map((p) => ({ ...p, fixed: !(p.kind === "scale" || p.kind === "background" || p.kind === "occupancy" || p.kind === "bIso") }));
    const a = refine(buildPowderProblem(st, pattern, free(tied.params), tied.bindings, { shape: "gaussian" }, tied.restraints), { maxIterations: 5 });
    const b = refine(buildPowderProblem(st, pattern, free(soft.params), soft.bindings, { shape: "gaussian" }, soft.restraints), { maxIterations: 5 });
    expect(a).toEqual(b);
    expect(buildPowderSpec(st, pattern, DEFAULT_INSTRUMENT).params.filter((p) => p.kind === "occupancy" && p.expression)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseShelxIns } from "@/parsers/shelxIns";
import { loadReflectionDataset } from "@/app/loadData";
import { executor, fakeHost, singleCrystalPort } from "@/testSupport/agentHeadless";

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
const INS = "GSAS-II-tutorials/sc/3a.ins";
const FCF = "GSAS-II-tutorials/sc/3a.fcf";
const LAW = [[0, 1, 0], [1, 0, 0], [0, 0, -1]];

/**
 * Round 4 through the Agent's own tools: 3a (P6₁, a merohedral twin, SHELXL's
 * .ins and LIST 4 listing). The twin with both hands (TWIN R −4) says the
 * model's hand is the wrong one; invert_structure takes it to P6₅ and keeps
 * the fit; Parsons' quotients and the 2-domain refit agree.
 */
describe.skipIf(!dataExists(INS) || !dataExists(FCF))("3a refined by the Agent's tools, as round 4 ran it", () => {
  it("refines the twin with both hands, reads the hand as inverted, and inverts the model to P6₅", async () => {
    const { structure, instructions } = parseShelxIns(readFileSync(dataPath(INS), "utf8"), "3a");
    const data = loadReflectionDataset(readFileSync(dataPath(FCF), "utf8"), structure, "3a-hkl", "3a.fcf", { wavelength: instructions.wavelength }).dataset;
    expect(data.radiation).toMatchObject({ kind: "xray", wavelength: 0.71073 });
    const { port } = singleCrystalPort(structure, data);
    const { ex, seen } = executor(fakeHost(port).host, "auto");

    expect(String(parse((await ex.run("set_twin", { law: LAW, withInversion: true })).text).note)).toMatch(/^Four domains, as SHELXL's TWIN R −4: the law \(twin_1\), the inversion \(twin_2\) and the two together \(twin_3\)/);
    const ride = parse((await ex.run("set_riding_hydrogens", { on: true, temperature: 293, sharedU: [["methyl"]] })).text);
    expect(String(ride.note)).toMatch(/15 methyl hydrogens rotating, the torsion refined \(AFIX 137\) in 5 groups, X–H 0\.960 Å, one shared U_iso refined \(B_shared_1\)/);
    expect(String(ride.note)).toMatch(/the shared U_iso B_shared_1 \(fixed, at the hydrogens' present mean\) refines with the ADPs/);
    expect(seen.find((e) => e.tool === "set_riding_hydrogens" && e.preview)?.preview).toMatch(/— 80 parameters leave the fit, 5 torsions and 1 shared U_iso join it$/);

    // The listing as SHELXL counts it: each reflection once, the Friedel mates apart; its low ⟨|E²−1|⟩ is the twin the model holds.
    const stats = parse((await ex.run("reflection_statistics", {})).text) as { reflections: Record<string, unknown>; intensityStatistics: { reading: string } };
    expect(stats.reflections).toMatchObject({ listed: 1465, unique: 1465, redundancy: 1, rSigma: 3.22 });
    expect(String(stats.reflections.rInt)).toMatch(/^n\/a \(each reflection once, its Friedel mate apart/);
    expect(stats.intensityStatistics.reading).toMatch(/^below 0\.736: fewer weak reflections than either expects — what the twin the model holds gives/);
    await ex.run("set_weighting", { a: 0.0374, b: 0.6277 });

    // The hands' fractions trade by construction: refined together, as SHELXL refines them, and said so.
    await ex.run("set_free", { fix: ["extinction"], free: ["scale", "twin_*"] });
    const first = parse((await ex.run("refine", {})).text);
    expect(first.status).toBe("converged");
    expect(String(first.carriedCorrelations)).toMatch(/twin_1 ↔ twin_3 -0\.99\d \(a twin with both hands/);
    await ex.run("set_free", { free: ["pos_*", "rot_*"] });
    await ex.run("refine", {});
    await ex.run("set_free", { free: ["U_*", "B_shared_1"] });
    const all = parse((await ex.run("refine", {})).text);
    // The shared U refines one value for 15 hydrogens: none of them "refined on its own".
    expect(all.note).toBeUndefined();
    expect(all.methodNote).toBeUndefined();
    expect(all).toMatchObject({ status: "converged", R1: 1.84, wR2: 4.76 });

    const a = parse((await ex.run("assess_refinement", {})).text) as { twinning: { flackX: string; flackNote: string; firstDomain: string; reading: string }; absoluteStructure: { parsonsX: string; quotients: number; reading: string }; findings: { summary: string }[] };
    expect(a.twinning.flackX).toMatch(/^1\.0\d\(\d\)$/);
    expect(a.twinning.flackNote).toMatch(/the esd from the fit's covariance, their correlation counted/);
    expect(a.twinning.reading).toMatch(/^the inverted hand: invert the model \(invert_structure/);
    expect(a.absoluteStructure.quotients).toBe(432);
    expect(a.absoluteStructure.parsonsX).toMatch(/^1\.\d\d\(\d\)$/);
    expect(a.absoluteStructure.reading).toMatch(/^the inverted hand/);
    // The Bijvoet differences the data hold at more than 3σ have the other hand's sign, nearly all.
    const signs = /^of the (\d+) Bijvoet differences observed at more than 3σ, (\d+) ha(?:s|ve) the model's sign$/.exec((a.absoluteStructure as unknown as { bijvoetSigns: string }).bijvoetSigns);
    expect(signs).not.toBeNull();
    expect(Number(signs![2])).toBeLessThan(0.25 * Number(signs![1]));
    expect(a.findings.map((f) => f.summary)).toContainEqual(expect.stringMatching(/^The twin's fractions correlate \(up to 0\.99\d\): a twin with both hands\.$/));

    // Inverted: P6₅, every domain taking its inverse's fraction — the same fit, re-expressed.
    const inv = parse((await ex.run("invert_structure", {})).text);
    expect(String(inv.note)).toBe("The model as loaded, inverted through the origin (every coordinate x → −x, as SHELXL's MOVE 1 1 1 −1, then moved into the cell by (1, 0, 1)); the space group P 61 → P 65, its enantiomorph (was P 61). The twin keeps its fit: each domain took the fraction of its inverse. The riding groups were placed afresh on the inverted atoms. The last fit is cleared: refine again, and compare wR2 and the Flack x with the other hand's.");
    expect(seen.find((e) => e.tool === "invert_structure" && e.preview)?.preview).toBe("Invert the model: every coordinate x → −x, moved into the cell by (1, 0, 1); the space group P 61 → P 65; the twin fractions re-expressed; the riding groups placed afresh");
    expect(port.state().structure.spaceGroup.hermannMauguin).toBe("P 65");
    const again = parse((await ex.run("refine", {})).text);
    expect(again).toMatchObject({ status: "converged", R1: 1.84, wR2: 4.76 });
    // The analysis is the same one: its stages carry over, so no "out of order".
    expect(again.methodNote).toBeUndefined();
    const b = parse((await ex.run("assess_refinement", {})).text) as { twinning: { flackX: string; laws: { fraction: string }[] }; absoluteStructure: { parsonsX: string } };
    expect(b.twinning.flackX).toMatch(/^0\.0\d\(\d\)$/);
    expect(b.twinning.laws[0]!.fraction).toMatch(/^0\.34\d?\(\d\)$/);
    expect(b.absoluteStructure.parsonsX).toMatch(/^-0\.\d\d\(\d\)$/);
    const state = parse((await ex.run("get_state", {})).text) as { phase: { spaceGroup: string; hand: string }; data: { restraints: string; extinctionModel: string } };
    expect(state.phase.spaceGroup).toBe("P 65");
    expect(state.phase.hand).toMatch(/^the model as loaded, inverted through the origin/);
    // The one restraint in force, and no extinction against the listing: as the report counts them.
    expect(state.data.restraints).toBe("1: the floating origin along c (SHELXL's floating-origin restraint)");
    expect(state.data.extinctionModel).toMatch(/^none: held at 0, the listing's Fo² carrying the correction/);

    // The two-domain twin of the right hand: SHELXL's model, in P6₅.
    await ex.run("set_twin", { law: LAW });
    const two = parse((await ex.run("refine", {})).text);
    expect(two).toMatchObject({ status: "converged", R1: 1.83, wR2: 4.76 });
    const report = port.reportInput!();
    const row = (label: string): string => report.data.find((r) => r.label === label)?.value ?? "";
    expect(row("Twinning")).toMatch(/^2 domains: the first domain \(the model as given\): fraction 0\.6[56]\d*\(\d+\); h′ = R·h, R = \[\[0,1,0\],\[1,0,0\],\[0,0,-1\]\]: fraction 0\.34\d*\(\d+\)$/);
    expect(row("Absolute structure")).toMatch(/^Flack x = -?0\.\d+\(\d+\) by Parsons' quotients from 432 Bijvoet pairs \(Parsons, Flack & Wagner, 2013\), 1\.\d+\(\d+\) for the inverse model; of the \d+ Bijvoet differences observed at more than 3σ, \d+ ha(s|ve) the model's sign; the model as loaded, inverted through the origin .* P 61 → P 65, its enantiomorph$/);
    expect(row("Hydrogens")).toMatch(/one shared U_iso refined \(B_shared_1\); B_shared_1: U_iso 0\.08\d+\(\d+\) Å² for 15 hydrogens\)$/);
    // A listing holds each reflection once, its Friedel mate apart: no R_int, and no extinction refined against it.
    expect(report.stats.find((x) => x.label === "R int")?.value).toBe("—");
    expect(row("Merging")).toMatch(/^1465 reflections, each once with its Friedel mate apart \(a refinement's listing\): no R_int · R_σ /);
    expect(row("Extinction")).toMatch(/^none refined: the listing's Fo² have the extinction of the refinement that wrote it divided out/);
    expect(row("Reflections")).toMatch(/^1465 listed · 1465 used/);
    // Caesium's bonds to its two rings and the pyridine, each image named by its site-symmetry code.
    const cs = (report.phases[0]!.bonds ?? []).filter((b) => b.from === "Cs1");
    expect(cs.length).toBeGreaterThanOrEqual(11);
    expect(cs.some((b) => b.image !== undefined)).toBe(true);
    // Nothing within 3.2 Å of Cs1: said so, with the nearest neighbour.
    expect(String(parse((await ex.run("bond_geometry", { atoms: ["Cs1"] })).text).none)).toMatch(/^no neighbour of Cs1 within the cutoff \(3\.2 Å\); the nearest is Cs1–C\d at 3\.2\d\d Å: give a longer `cutoff`$/);
    // Read from Cs1, each image's code is the report's: the reverse bond's code inverted.
    const around = parse((await ex.run("bond_geometry", { atoms: ["Cs1"], cutoff: 3.4 })).text) as { bonds: { from: string; to: string; image?: string; distance: number }[] };
    expect(around.bonds.length).toBeGreaterThanOrEqual(11);
    expect(around.bonds.every((b) => b.from === "Cs1")).toBe(true);
    for (const b of cs) {
      const same = around.bonds.find((x) => x.to === b.to && x.image === b.image && Math.abs(x.distance - Number(b.length.replace(/\(.*$/, ""))) < 2e-3);
      expect(same, `${b.to} [${b.image ?? "1_555"}] ${b.length}`).toBeDefined();
    }
    // The extinction cannot be judged from a listing: K level on the strongest bin is SHELXL's correction.
    expect(String((parse((await ex.run("assess_refinement", {})).text) as { extinction: string }).extinction)).toMatch(/^not judged from a listing: its Fo² have the extinction of the refinement that wrote it divided out/);
    expect(row("Restraints")).toBe("1 (as SHELXL counts them): the floating origin along c, held by its Z²-weighted mean coordinate (SHELXL's floating-origin restraint)");
  }, 300_000);

  it("refuses to invert a centrosymmetric model", async () => {
    const { structure, instructions } = parseShelxIns(readFileSync(dataPath(INS), "utf8"), "3a");
    const data = loadReflectionDataset(readFileSync(dataPath(FCF), "utf8"), structure, "3a-hkl", "3a.fcf", { wavelength: instructions.wavelength }).dataset;
    const { buildSpaceGroup } = await import("@/core/crystal/spaceGroups");
    const { port } = singleCrystalPort({ ...structure, spaceGroup: buildSpaceGroup(176) }, data);
    const { ex } = executor(fakeHost(port).host, "auto");
    expect((await ex.run("invert_structure", {})).text).toMatch(/P 63\/m is centrosymmetric: the inverted model is the same model/);
  }, 60_000);
});

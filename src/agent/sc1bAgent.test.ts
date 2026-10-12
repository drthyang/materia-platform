import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseCif } from "@/parsers/cif";
import { loadReflectionDataset } from "@/app/loadData";
import { executor, fakeHost, singleCrystalPort } from "@/testSupport/agentHeadless";
import { singleCrystalReportChecks } from "@/agent/scTools";

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
const CIF = "GSAS-II-tutorials/sc/1b.cif";

/**
 * Round 3's live run, through the Agent's own tools on the real 1b data: the
 * measurement merged as SHELXL merges it, the inversion twin, the Al/Ga
 * disorder tied as SHELXL ties it, the hydrogens riding and the hydrides
 * restrained, the stages in order, SHELXL's weights — and every reading the
 * critical crystallographer found wrong in that run.
 */
describe.skipIf(!dataExists(CIF))("1b refined by the Agent's tools, as round 3 ran it", () => {
  it("reproduces SHELXL with the readings a crystallographer would check", async () => {
    const text = readFileSync(dataPath(CIF), "utf8");
    const structure = parseCif(text, "1b");
    const data = loadReflectionDataset(text, structure, "1b-hkl", "1b.cif").dataset;
    const { port } = singleCrystalPort(structure, data);
    const { ex, seen } = executor(fakeHost(port).host, "auto");
    await ex.run("read_skill", { name: "sc-workflow" });

    // The data: R_int as SHELXL reports it for this group, beside the Laue class's.
    const stats = parse((await ex.run("reflection_statistics", {})).text);
    expect(stats.reflections).toMatchObject({ measured: 13169, rInt: 3.04, rIntFriedelApart: 2.93 });
    expect(String(parse((await ex.run("merge_equivalents", { on: true })).text).note)).toMatch(/13169 measurements merged into 2482 reflections, the Friedel opposites kept apart .*, 21 systematic absences left out \(60 measurements\)\. R_int 2\.93 % for this merge, as SHELXL reports it \(3\.04 % in the Laue class, the mates merged\); the data reading keeps the measurement as loaded/);
    expect(port.state().dataset.reflections).toHaveLength(2482);

    await ex.run("set_twin", { law: "inversion" });
    await ex.run("tie_parameters", { complement: ["Al1", "Ga1"], adp: ["Al1", "Ga1"] });
    const ride = parse((await ex.run("set_riding_hydrogens", { on: true, temperature: 173, refine: ["H1'", "H2'", "H3'", "H4'", "H5'"] })).text);
    // A hydride whose position refines keeps its position rows: 85 rows leave, not 100.
    expect(seen.find((e) => e.tool === "set_riding_hydrogens" && e.preview)?.preview).toMatch(/— 85 parameters leave the fit, 4 torsions join it$/);
    expect(String(ride.note)).toMatch(/^20 hydrogens ride, 5 refine their positions with U riding: /);
    await ex.run("restrain_distances", {
      add: [
        { kind: "sadi", sigma: 0.005, pairs: [["Ga2", "H3'"], ["Ga2", "H4'"], ["Ga2", "H5'"]] },
        { kind: "sadi", pairs: [["H3'", "H4'"], ["H3'", "H5'"], ["H4'", "H5'"]] },
        { kind: "sadi", pairs: [["Al1", "H1'"], ["Al1", "H2'"]] },
        { kind: "sadi", pairs: [["Ga1", "H1'"], ["Ga1", "H2'"]] },
      ],
    });

    // Stage 1 with the Flack x: in the method's order, no note.
    await ex.run("set_free", { fix: ["extinction"], free: ["scale", "twin_1"] });
    const first = parse((await ex.run("refine", {})).text);
    expect(first.methodNote).toBeUndefined();
    await ex.run("set_free", { free: ["pos_*", "rot_*"] });
    const positions = parse((await ex.run("refine", {})).text);
    // Neither out of order, nor the hydrides "refined on their own": they refine as asked, restrained.
    expect(positions.methodNote).toBeUndefined();
    expect(positions.note).toBeUndefined();
    await ex.run("set_free", { free: ["U_*", "occ_Al1"] });
    // The split site's positions correlate at −0.99 by construction: refined, as SHELXL refines them.
    const all = parse((await ex.run("refine", {})).text);
    expect(all.status).toBe("converged");
    expect(String(all.carriedCorrelations)).toMatch(/one disorder \(A\)/);
    await ex.run("set_weighting", { a: 0.0271, b: 0.258 });
    expect(parse((await ex.run("refine", {})).text)).toMatchObject({ R1: 2.02, wR2: 4.97, GooF: 1.03 });

    // The assessment: the disorder's correlations a note, not "fix one"; the outliers read the measurements behind them.
    const a = parse((await ex.run("assess_refinement", {})).text) as { findings: { category: string; severity: string; summary: string }[]; outliers: string[]; twinning: { laws: { flackX: string }[] } };
    expect(a.findings.filter((f) => f.category === "correlation").map((f) => f.severity)).toEqual(["info"]);
    expect(a.outliers.every((o) => /merged from \d+ measurements/.test(o))).toBe(true);
    // Under SHELXL's weights the misfits are ranked and given in the weights' esd, as SHELXL lists them.
    const worst = /Δ\/esd (-?[\d.]+) by the weights \((-?[\d.]+)σ by the file's σ\)/.exec(a.outliers[0]!);
    expect(worst).not.toBeNull();
    expect(Math.abs(Number(worst![1]))).toBeLessThan(Math.abs(Number(worst![2])));
    expect(a.twinning.laws[0]!.flackX).toBe("0.435(11)");

    // The esds against SHELXL's own, which the CIF gives.
    const table = parse((await ex.run("structure_table", { against: "loaded" })).text) as { againstLoaded: { esds: Record<string, string> } };
    expect(table.againstLoaded.esds.positions).toMatch(/^median 0\.\d\d \(/);
    const median = Number(/^median (0\.\d\d)/.exec(table.againstLoaded.esds.positions ?? "")?.[1]);
    expect(median).toBeGreaterThan(0.6);
    expect(median).toBeLessThan(0.9);

    // The report carries the weights' suggestion and the comparison with SHELXL's model, so the account can quote them.
    const checks = singleCrystalReportChecks(port.state());
    expect(checks.find((c) => c.name === "Weights")?.detail).toMatch(/^WGHT 0\.0271 0\.258 .* in use; suggested for the model as refined, by SHELXL's criterion: WGHT [\d.]+ [\d.]+ \(GooF/);
    expect(checks.find((c) => c.name === "Against the model loaded")?.detail).toMatch(/^largest shift 0\.0\d+ Å at .*; refined\/loaded U_eq .*\. Refined esd \/ published su: positions median 0\.\d\d \(.*\); U\^ij median 0\.\d\d/);
    expect(checks.find((c) => c.name === "Data")?.detail).toMatch(/^13169 measurements merged as SHELXL's MERG 2 into 2482 reflections, the Friedel opposites apart \(R_int 2\.93 % with the Friedel mates apart, as SHELXL reports it \(3\.04 % in the Laue class\), R_σ 1\.99 %\)/);

    // Bonds and contacts apart, around the split site.
    const bonds = parse((await ex.run("bond_geometry", { atoms: ["Al1"] })).text) as { bonds: { to?: string; from?: string }[]; contacts: string; shortest: { distance: number } };
    expect(String(bonds.shortest.distance)).toMatch(/^\d\.\d{1,4}$/);
    expect(bonds.bonds.map((b) => (b.from === "Al1" ? b.to : b.from)).sort()).toEqual(["H1'", "H2'", "N1", "N2", "N3"]);
    expect(bonds.contacts).toMatch(/^\d+ longer contacts up to the cutoff, neither bonds by the covalent radii \(their sum \+ 0\.4 Å\) nor two bonds apart/);

    // The report: no "omitted by hand" for the merge, SHELXL's R_int, λ as given, no stage left open.
    const report = port.reportInput!();
    const row = (label: string): string => report.data.find((r) => r.label === label)!.value;
    // SHELXL's CIF: _diffrn_reflns_number 13109, the 60 measurements of the absences not counted.
    expect(row("Reflections")).toBe("13169 measured · merged as SHELXL's MERG 2 (the Friedel opposites apart; 21 systematic absences, measured 60 times, left out: 13109 measurements merged) · 2482 used");
    expect(row("Merging")).toMatch(/with the Friedel mates apart and the absences left out, as SHELXL merges this group: 2482 unique · R_int 2\.93 %/);
    expect(row("Probe")).toMatch(/^X-ray, λ = 0\.71073 Å/);
    // The headline tiles in SHELXL's terms for this acentric group.
    expect(report.stats.find((x) => x.label === "Unique")?.value).toBe("2482");
    expect(report.stats.find((x) => x.label === "R int")?.value).toBe("2.93 %");
    expect(row("Hydrogens")).toMatch(/^20 riding on their parents, 5 \(H1', H2', H3', H4', H5'\) with their positions refined and U_iso riding/);
    expect(row("Disorder")).toMatch(/Ga1 takes the ADP of Al1 \(EADP\)/);
  }, 600_000);
});

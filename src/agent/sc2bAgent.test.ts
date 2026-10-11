import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataExists, dataPath } from "@/testSupport/data";
import { parseShelxIns } from "@/parsers/shelxIns";
import { loadReflectionDataset } from "@/app/loadData";
import { executor, fakeHost, singleCrystalPort } from "@/testSupport/agentHeadless";
import { singleCrystalReportChecks } from "@/agent/scTools";
import { reportHtml } from "@/core/export/report";

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
const INS = "GSAS-II-tutorials/sc/2b.ins";
const HKL = "GSAS-II-tutorials/sc/2b.hkl";

/**
 * Round 5 through the Agent's own tools: 2b (P3₂, SHELXL's model with its
 * TWIN taken out, an HKLF 4 file holding each reflection once). The data
 * read the twin before any model; the hand stays undetermined (Al the
 * heaviest atom), read the same way from either side.
 */
describe.skipIf(!dataExists(INS) || !dataExists(HKL))("2b refined by the Agent's tools, as round 5 ran it", () => {
  it("reads the twin from the data, merges a merged file honestly, and leaves the hand undetermined both ways", async () => {
    const { structure, instructions } = parseShelxIns(readFileSync(dataPath(INS), "utf8"), "2b");
    const data = loadReflectionDataset(readFileSync(dataPath(HKL), "utf8"), structure, "2b-hkl", "2b.hkl", { wavelength: instructions.wavelength }).dataset;
    const { port } = singleCrystalPort(structure, data);
    const { ex } = executor(fakeHost(port).host, "auto");

    // The data: the twin by k, h, −l before any model; the absences and the acentric reflections as SHELXL counts them.
    const stats = parse((await ex.run("reflection_statistics", {})).text) as { reflections: Record<string, unknown>; friedel: string; absences: { measured: number }; twinLaws: { laws: { law: number[][]; alpha: number }[] } };
    expect(stats.twinLaws.laws[0]!.law).toEqual([[0, 1, 0], [1, 0, 0], [0, 0, -1]]);
    expect(stats.twinLaws.laws[0]!.alpha).toBeGreaterThan(0.43);
    expect(stats.absences.measured).toBe(21);
    expect(stats.friedel).toMatch(/^\d+ of the 8414 acentric reflections unique under the point group have their Friedel mate measured/);
    // Light atoms: the Bijvoet pairs' 2.96 % is the measurements', not the anomalous signal.
    expect(String(stats.reflections.rInt)).toMatch(/merged with them the Bijvoet pairs differ by 2\.96 %; the model's anomalous differences give 0\.\d+ %, so the rest is the measurements' disagreement\)$/);

    // A file the data reduction merged: the merge only leaves out the absences, and no R_int is claimed.
    expect(String(parse((await ex.run("merge_equivalents", { on: true })).text).note)).toBe("The file holds each reflection once already (its data reduction merged them, the Friedel opposites apart): no R_int can be computed from it. As SHELXL's MERG 2, 21 systematic absences left out (21 measurements): 8414 reflections fitted. The data reading keeps the file as loaded. The omissions and the last fit are cleared: refine again.");

    // The ammonium's N–H rides on AFIX 13 at SHELXL's N–H, not a C–H's.
    const ride = String(parse((await ex.run("set_riding_hydrogens", { on: true, temperature: 173 })).text).note);
    expect(ride).toMatch(/10 tertiary X–H opposite three neighbours \(AFIX 13\), C–H 1\.000 Å, N–H 0\.930 Å/);

    await ex.run("set_twin", { law: [[0, 1, 0], [1, 0, 0], [0, 0, -1]] });
    await ex.run("set_free", { fix: ["extinction"], free: ["scale", "twin_1"] });
    expect(parse((await ex.run("refine", {})).text)).toMatchObject({ status: "converged" });
    const a = parse((await ex.run("assess_refinement", {})).text) as { absoluteStructure: { parsonsX: string; reading: string }; twinning: { laws: { fraction: string }[] } };
    expect(a.twinning.laws[0]!.fraction).toMatch(/^0\.49\d+\(\d+\)$/);
    expect(a.absoluteStructure.parsonsX).toMatch(/^0\.0\d\(1\d\)$/);
    expect(a.absoluteStructure.reading).toMatch(/^x is 0 within 2u, but u = 0\.1\d is too large to determine the hand/);

    // The other hand reads the same way: x near 1 with the same u decides nothing either.
    await ex.run("invert_structure", {});
    await ex.run("refine", {});
    const b = parse((await ex.run("assess_refinement", {})).text) as { absoluteStructure: { parsonsX: string; reading: string } };
    expect(b.absoluteStructure.parsonsX).toMatch(/^(0\.9\d|1\.0\d)\(1\d\)$/);
    expect(b.absoluteStructure.reading).toMatch(/^x is 1 within 2u, but u = 0\.1\d is too large to determine the hand/);
    await ex.run("invert_structure", {});
    await ex.run("refine", {});

    // A long free set comes back by kind, not as 567 ids.
    expect(parse((await ex.run("set_free", { free: ["pos_*", "rot_*", "U_*"] })).text).free).toBe("scale, twinFraction, Uij ×366, positions ×183, ridingTorsion ×16");

    // The N–H points at an aryl ring: the ring's centroid, not an acceptor atom.
    const nh = parse((await ex.run("bond_geometry", { atoms: ["N1"] })).text) as { centroids?: string[]; contacts?: string; hydrogenBonds?: string[] };
    expect(nh.centroids).toEqual([expect.stringMatching(/^N1–H1D···Cg\d 2\.4\d\d Å, 17\d°$/)]);
    expect(nh.hydrogenBonds).toEqual(["none: N1–H1D reaches no acceptor (N, O, F, S or a halogen) within the van der Waals sum at D–H···A above 110°"]);
    expect(String(nh.contacts ?? "")).not.toMatch(/H51A···N1/);

    // The cell's esds from ZERR, a and b one parameter (0.0001 written as SHELXL writes β 96.9160(10)): in the record, and the volume's in the cell table.
    const report = port.reportInput!();
    expect(report.data.find((r) => r.label === "Unit cell")!.value).toBe("fixed at the input values (not refinable from a single reflection file), with the structure file's esds (a 12.75060(10), c 27.6245(3) Å), which the volume and the bond esds carry");
    expect(reportHtml(report)).toContain("3889.43(7) Å³");

    // The report's bond valence reads the metal only: no carbon "from its valence".
    const bv = singleCrystalReportChecks(port.state()).find((c) => c.name === "Bond valence");
    expect(bv?.detail).toMatch(/^Al1 3\.\d\d \(Al3\+, assumed\)\.$/);
    expect(bv?.status).toBe("pass");
  }, 600_000);
});

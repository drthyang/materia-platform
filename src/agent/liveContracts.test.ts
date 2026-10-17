import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LIVE_TOOLS, type AgentPage } from "@/agent/tools";
import { executor, fakeHost } from "@/testSupport/agentHeadless";
import { mn3gaSession, pdfPage, powderPage, scPage } from "@/agent/evals/pages";

/**
 * The live tools' output shapes, pinned as the MCP tools' are
 * (registry.test.ts): the top-level keys each read tool answers with on a
 * refined page of its kind. What the model reads, and what the skills name,
 * cannot change without this table changing with it. A tool the page's state
 * does not reach here (the symmetry review before the stages, the k-search
 * with no peak included) is checked for its refusal instead, and
 * sample_posterior, a long run, by its own tests.
 */
const CONTRACTS: Readonly<Record<AgentPage, Readonly<Record<string, readonly string[]>>>> = {
  powder: {
    get_state: ["busy", "data", "history", "instrument", "lastRefinement", "magneticModel", "method", "parameterGroups", "parameterRows", "phases", "references", "settings", "source", "technique", "wR"],
    assess_refinement: ["findings", "summary", "verdict"],
    suggest_next_steps: ["steps"],
    rank_next_parameters: ["groups", "wrNow"],
    check_cell_symmetry: ["absences", "absencesConsistent", "cell", "cellValues", "everyPeakIndexes", "leBail", "limits", "passed", "reading", "shoulders", "unindexedPeaks", "zero"],
    check_fit_range: ["basis", "extent", "high", "low", "proposed", "unit", "window"],
    find_unexplained_peaks: ["count", "markedOnPlot", "misfits", "reading", "unexplained"],
    diagnose_fit: ["agreement", "causes", "dShells", "intensityFalloff", "lineWidths", "reading", "textureTest", "worstReflections"],
    identify_peaks: ["candidates", "peaks", "reading"],
    structure_table: ["phases"],
    magnetic_state: ["canFitMoments", "canRefineK", "candidates", "groups", "ions", "k", "kKind", "next", "nuclearOnlyWR", "residualPeaks", "ties"],
    rank_magnetic_groups: ["best", "groups", "nuclearOnlyWR", "ranked", "reading", "restarts"],
    bond_geometry: ["bonds", "name", "phase", "shortest"],
    interpret_structure: ["findings", "summary"],
  },
  pdf: {
    get_state: ["Rw", "adp", "busy", "convention", "data", "history", "lastRefinement", "method", "parameterGroups", "parameterRows", "phases", "positions", "references", "source", "spinModel", "technique"],
    assess_refinement: ["convention", "findings", "summary", "verdict"],
    suggest_next_steps: ["steps"],
    structure_table: ["phases"],
    bond_geometry: ["bonds", "name", "phase", "shortest"],
    interpret_structure: ["findings", "summary"],
  },
  singleCrystal: {
    get_state: ["agreement", "busy", "data", "history", "lastRefinement", "magneticModel", "method", "parameterGroups", "parameterRows", "phase", "references", "source", "technique"],
    assess_refinement: ["agreement", "analysisOfVariance", "extinction", "extinctionCorrection", "extinctionModel", "findings", "outliers", "outliersReading", "reflectionsPerParameter", "summary", "verdict", "weighting"],
    reflection_statistics: ["absences", "friedel", "intensityStatistics", "reflections", "reflectionsPerParameter", "resolution", "shells", "twinLaws"],
    structure_table: ["phases"],
    bond_geometry: ["bondValence", "bonds", "name", "phase", "shortest"],
  },
};

const PAGES: Readonly<Record<AgentPage, () => ReturnType<typeof powderPage> | ReturnType<typeof pdfPage> | ReturnType<typeof scPage>>> = {
  powder: () => powderPage(mn3gaSession()),
  pdf: () => pdfPage(),
  singleCrystal: () => scPage(),
};

describe("the live tools' output shapes", () => {
  for (const page of Object.keys(CONTRACTS) as AgentPage[]) {
    it(`${page}: every read tool that takes no input answers with its pinned keys`, async () => {
      const { ex } = executor(fakeHost(PAGES[page]()).host, "auto");
      const refined = await ex.run("refine", {});
      expect(refined.refined, refined.text).toBe(true);
      const seen: Record<string, string[]> = {};
      for (const t of LIVE_TOOLS) {
        if (t.effect !== "read" || !t.pages.includes(page) || t.name === "sample_posterior" || !z.object(t.inputSchema).strict().safeParse({}).success) continue;
        const out = await ex.run(t.name, {});
        if (out.isError) continue;
        seen[t.name] = Object.keys(JSON.parse(out.text) as object).filter((k) => k !== "ref").sort();
      }
      expect(seen).toEqual(CONTRACTS[page]);
    }, 120_000);
  }

  it("says what a call came to: refused (and by what), declined, unchanged, or a refinement on the page", async () => {
    const { ex } = executor(fakeHost(powderPage(mn3gaSession())).host, "auto");
    const gated = await ex.run("review_symmetry", {});
    expect([gated.status, gated.refusedBy]).toEqual(["refused", "symmetry-gate"]);
    const none = await ex.run("search_propagation_vector", {});
    expect(none.status).toBe("error");
    const again = await ex.run("set_free", { free: ["scale"] });
    expect(again.status).toBe("unchanged");
    const occupancy = await ex.run("set_free", { free: ["occ_*"] });
    expect(occupancy.status, occupancy.text).toBe("ok");
    const bare = await ex.run("refine", {});
    expect([bare.status, bare.refusedBy, bare.refined]).toEqual(["refused", "firm-rule", undefined]);
    const { ex: asking } = executor(fakeHost(powderPage(mn3gaSession())).host, false);
    const declined = await asking.run("set_free", { free: ["cell_*"], fix: ["scale"] });
    expect(declined.status).toBe("declined");
  }, 120_000);
});

import { describe, it, expect } from "vitest";
import { CORE_TOOLS, MAGNETIC_TOOLS, POWDER_STAGE_TOOLS, scopedToolNames, scopedTools } from "@/agent/toolScope";
import { LIVE_TOOLS, inputJsonSchema, type AgentPage } from "@/agent/tools";
import { stagesFor } from "@/agent/method";

const none = new Set<string>();
const at = (page: AgentPage | null, stage: string | null, extra: Partial<{ magnetic: boolean; asked: string[]; called: Set<string> }> = {}) =>
  scopedToolNames({ page, stage, magnetic: extra.magnetic ?? false, asked: extra.asked ?? [], called: extra.called ?? none });
const chars = (names: Set<string>): number => JSON.stringify(LIVE_TOOLS.filter((t) => names.has(t.name)).map((t) => ({ name: t.name, description: t.description, input_schema: inputJsonSchema(t) }))).length;

describe("a local model's tools", () => {
  it("names only tools that exist, and a stage for each of the powder method's", () => {
    const known = new Set(LIVE_TOOLS.map((t) => t.name));
    for (const n of [...CORE_TOOLS, ...MAGNETIC_TOOLS, ...Object.values(POWDER_STAGE_TOOLS).flat()]) expect(known, n).toContain(n);
    expect(Object.keys(POWDER_STAGE_TOOLS).sort()).toEqual(stagesFor("powder").map((s) => s.id).sort());
  });

  it("reaches every tool of every page at some stage: nothing a stage needs is missing for good", () => {
    for (const page of ["powder", "pdf", "singleCrystal"] as const) {
      const reach = new Set<string>();
      for (const stage of [...stagesFor(page).map((s) => s.id), null]) for (const n of at(page, stage, { magnetic: page === "powder" })) reach.add(n);
      // A tool no stage offers comes with the user's words (bond lengths, the structure's meaning).
      for (const n of at(page, null, { asked: ["What are the bond lengths, and what does the structure mean?"] })) reach.add(n);
      const all = LIVE_TOOLS.filter((t) => t.pages.includes(page)).map((t) => t.name);
      expect(all.filter((n) => !reach.has(n)), page).toEqual([]);
    }
  });

  it("offers each powder stage the tools its step of the method uses, on top of the core", () => {
    const has = (stage: string | null, tools: string[]) => expect([...at("powder", stage)]).toEqual(expect.arrayContaining([...CORE_TOOLS, ...tools]));
    has("range", ["check_fit_range", "set_fit_range"]);
    has("check", ["check_cell_symmetry", "identify_peaks", "add_known_phase", "write_note"]);
    has("base", ["set_free", "refine", "set_background", "assess_refinement", "check_fit_range"]);
    has("positions", ["tie_parameters", "set_site_ties", "rank_next_parameters"]);
    has("profile", ["set_microstrain", "set_corrections", "diagnose_fit"]);
    has("adp", ["set_adp_model", "tie_parameters"]);
    has(null, ["review_symmetry", "structure_table", "sample_posterior", "find_unexplained_peaks", "set_corrections", "magnetic_state", "search_propagation_vector", "write_report"]);
    // The symmetry review is the last step: not offered while a required stage is left.
    expect(at("powder", "base").has("review_symmetry")).toBe(false);
  });

  it("is far smaller than every tool, as the window needs", () => {
    const every = chars(new Set(LIVE_TOOLS.map((t) => t.name)));
    for (const stage of ["range", "check", "base", "positions", "profile", "adp"]) expect(chars(at("powder", stage)) / every, stage).toBeLessThan(0.32);
    expect(chars(at("powder", null)) / every).toBeLessThan(0.45);
    expect(chars(at("pdf", "base")) / every).toBeLessThan(0.35);
  });

  it("adds what the user asks for and what the model has used, whatever the stage", () => {
    expect(at("powder", "range", { asked: ["Can you refine it? It has magnetic peaks; then find the k-vector."] }).has("search_propagation_vector")).toBe(true);
    expect(at("powder", "range", { asked: ["Is there an impurity?"] }).has("identify_peaks")).toBe(true);
    expect(at("powder", "range", { asked: ["Should we lower the symmetry?"] }).has("review_symmetry")).toBe(true);
    expect(at("powder", "base", { called: new Set(["check_cell_symmetry"]) }).has("check_cell_symmetry")).toBe(true);
    expect(at("powder", "base", { magnetic: true }).has("refine_moments")).toBe(true);
    // Nothing from another page.
    expect(at("pdf", null, { asked: ["Find the magnetic structure"] }).has("search_propagation_vector")).toBe(false);
    expect(at("singleCrystal", "data").has("reflection_statistics")).toBe(true);
    // Nothing open: the core, to read the state and say so.
    expect([...at(null, null)].sort()).toEqual([...CORE_TOOLS].sort());
  });

  it("keeps the list's own order, so the prompt's tool block changes only where it grows", () => {
    const order = LIVE_TOOLS.map((t) => t.name);
    const names = scopedTools({ page: "powder", stage: "base", magnetic: false, asked: [], called: none }).map((t) => t.name);
    expect(names).toEqual(order.filter((n) => names.includes(n)));
  });
});

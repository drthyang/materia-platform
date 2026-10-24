import { describe, expect, it } from "vitest";
import { choicesFor, kComponentLabel, kComponentText, kComponentsIn, kDisplay, kMessage, kNote, MAX_OPTIONS } from "@/agent/choices";
import { kComponent } from "@/agent/magneticTools";
import { candidateKVectors, kLabel, searchPropagationVector, satellitePositions } from "@/core/magnetic/kSearch";
import type { Vec3 } from "@/core/math/types";

/** A k message read back as set_propagation_vector reads it: the triple it names, each component through kComponent. */
const sent = (message: string): number[] => {
  const parts = kComponentsIn(message);
  if (!parts) throw new Error(`no k in "${message}"`);
  return parts.map(kComponent);
};

/** Every k the commensurate search can return: the grid, its signs, and a centred lattice's integer cosets added. */
function searchable(): Vec3[] {
  const out: Vec3[] = [];
  for (const g of candidateKVectors([2, 3, 4, 6])) {
    for (const c of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1]] as Vec3[]) {
      for (const s of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]] as Vec3[]) {
        out.push([s[0] * g[0] + c[0], s[1] * g[1] + c[1], s[2] * g[2] + c[2]]);
      }
    }
  }
  return out;
}

describe("a k option: the label shown and the value sent", () => {
  it("sends every k the search can return so that set_propagation_vector reads back the engine's value", () => {
    const ks = searchable();
    expect(ks.length).toBeGreaterThan(1000);
    for (const k of ks) {
      const back = sent(kMessage(k));
      back.forEach((x, i) => expect(Math.abs(x - k[i]!), `${kMessage(k)} for ${JSON.stringify(k)}`).toBeLessThan(1e-12));
      // No component is a rounded decimal: plain fractions and integers only.
      expect(kMessage(k)).toMatch(/^Set the propagation vector to k = \((-?\d+(\/\d+)?, ){2}-?\d+(\/\d+)?\)\.$/);
      // The label is exact too: the panel's glyphs where there is one, else n/d.
      expect(kDisplay(k)).not.toMatch(/\d\.\d/);
    }
    // The grid's own fractions come back as the same doubles, not merely close.
    for (const x of [1 / 2, 1 / 3, 1 / 4, 1 / 6, -1 / 4, 1 + 1 / 2]) expect(kComponent(kComponentText(x))).toBe(x);
  });

  it("writes the message in plain ASCII fractions and the label in the panel's glyphs", () => {
    expect(kMessage([0.5, 0, 0])).toBe("Set the propagation vector to k = (1/2, 0, 0).");
    expect(kMessage([0.25, 0, -0.25])).toBe("Set the propagation vector to k = (1/4, 0, -1/4).");
    expect(kDisplay([0.25, 0, -0.25])).toBe("(¼ 0 −¼)");
    expect(kDisplay([0, 0, 4 / 3])).toBe("(0 0 4/3)");
    expect(kDisplay([1 / 3, 2 / 3, 1])).toBe("(⅓ ⅔ 1)");
    expect(kComponentLabel(-0)).toBe("0");
    // A value no small fraction gives: its shortest exact decimal, never rounded.
    expect(kComponentText(0.1234567)).toBe("0.1234567");
    expect(kComponent(kComponentText(0.1234567))).toBe(0.1234567);
    // The label the search prints agrees with the button's for its grid.
    for (const k of [[0.5, 0, 0], [1 / 3, 1 / 3, 0], [0.25, 0, -0.25], [0, 0.5, 1]] as Vec3[]) expect(kLabel(k)).toBe(kDisplay(k));
  });

  it("reads every glyph and minus sign the labels print (set_propagation_vector's kComponent)", () => {
    const cases: [string, number][] = [["½", 1 / 2], ["⅓", 1 / 3], ["⅔", 2 / 3], ["¼", 1 / 4], ["¾", 3 / 4], ["⅙", 1 / 6], ["⅚", 5 / 6], ["−¼", -1 / 4], ["−1/2", -1 / 2], ["-1/2", -1 / 2], ["4/3", 4 / 3], [" 0.5 ", 0.5]];
    for (const [text, x] of cases) expect(kComponent(text), text).toBe(x);
    expect(() => kComponent("half")).toThrow(/is not a k component/);
    // A label copied component by component reads back to the k it shows.
    for (const k of [[0.25, 0, -0.25], [1 / 3, 2 / 3, 0], [0, 0, 4 / 3]] as Vec3[]) {
      const parts = kLabel(k).slice(1, -1).split(" ");
      expect(parts.map(kComponent).map((x, i) => Math.abs(x - k[i]!) < 1e-12)).toEqual([true, true, true]);
    }
  });

  it("labels a centred lattice's k above 1 exactly, not rounded to three decimals", () => {
    // An I-centred cell: satellites of (0 0 4/3) — the search keeps the coset's k, which once read "(0 0 1.333)".
    const cell = { a: 4, b: 4, c: 9, alpha: 90, beta: 90, gamma: 90 };
    const I: Vec3[] = [[0.5, 0.5, 0.5]];
    const d = satellitePositions(cell, [0, 0, 4 / 3], 1.5, 9, I).slice(0, 6).map((x) => x.d);
    const found = searchPropagationVector(cell, d, { centring: I });
    const labels = found.map((c) => c.label);
    expect(labels).toContain("(0 0 4/3)");
    expect(labels.join(" ")).not.toMatch(/\d\.\d{3}/);
    const set = choicesFor("search_propagation_vector", { candidates: found.map((c) => ({ k: c.label, components: c.k, matched: `${c.matched}/${c.total}`, rmsd: c.rmsd })) }, { cell, spaceGroup: "I 4/m m m" })!;
    const option = set.options.find((o) => o.label === "k = (0 0 4/3)")!;
    expect(sent(option.message)).toEqual([0, 0, 4 / 3]);
    expect(set.note).toMatch(/reciprocal-lattice units of the structure's cell as loaded, I 4\/m m m \(a 4, b 4, c 9 Å\): the conventional, centred cell, not the primitive one/);
  });
});

describe("the choice sets a tool's result offers", () => {
  const search = {
    candidates: [
      { k: "(0 0 ½)", components: [0, 0, 0.5], matched: "3/3", rmsd: 0.0012 },
      { k: "(½ 0 ½)", components: [0.5, 0, 0.5], matched: "3/3", rmsd: 0.002 },
      { k: "(⅓ 0 0)", components: [1 / 3, 0, 0], matched: "2/3", rmsd: 0.004 },
      { k: "(¼ 0 −¼)", components: [0.25, 0, -0.25], matched: "3/3", rmsd: 0.003 },
    ],
    simplest: "(0 0 ½)",
  };

  it("k: every included peak explained first, the simplest marked, the cell named", () => {
    const set = choicesFor("search_propagation_vector", search, { cell: { a: 5.43, b: 5.43, c: 7.61, alpha: 90, beta: 90, gamma: 90 }, spaceGroup: "P 4/m m m" })!;
    expect(set.kind).toBe("k");
    expect(set.options.map((o) => o.label)).toEqual(["k = (0 0 ½)", "k = (½ 0 ½)", "k = (¼ 0 −¼)", "k = (⅓ 0 0)"]);
    expect(set.options.map((o) => !!o.recommended)).toEqual([true, false, false, false]);
    expect(set.options[0]).toMatchObject({ detail: "3/3 peaks · rmsd 0.0012 Å", message: "Set the propagation vector to k = (0, 0, 1/2)." });
    expect(set.options[2]!.message).toBe("Set the propagation vector to k = (1/4, 0, -1/4).");
    expect(set.note).toBe("k in reciprocal-lattice units of the structure's cell as loaded, P 4/m m m (a 5.43, b 5.43, c 7.61 Å).");
    expect(set.other.template).toBe("Set the propagation vector to k = (, , ).");
    expect(set.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
  });

  it("k: an oblique cell's angles are named, and a search with nothing found offers nothing", () => {
    expect(kNote({ cell: { a: 5, b: 6, c: 7, alpha: 90, beta: 105.2, gamma: 90 }, spaceGroup: "P 1 21/c 1" })).toMatch(/\(a 5, b 6, c 7 Å; α 90°, β 105\.2°, γ 90°\)\.$/);
    expect(choicesFor("search_propagation_vector", { candidates: [], reading: "No commensurate k" })).toBeNull();
  });

  it("groups: best wR first, the ★ marked, the ranking's ids in the messages, the best kept when it ranks low", () => {
    const groups = Array.from({ length: 9 }, (_, i) => ({ id: `G${i + 1}`, group: `P${i}'`, index: 2, momentComponents: 1 + (i % 2), fit: { wR: 10 + i } }));
    const set = choicesFor("rank_magnetic_groups", { groups, best: "G9", withinNoise: ["G1", "G9"] })!;
    expect(set.kind).toBe("group");
    expect(set.options).toHaveLength(MAX_OPTIONS);
    expect(set.options.at(-1)).toMatchObject({ id: "G9", recommended: true, message: "Choose the magnetic group G9 (P8')." });
    expect(set.options[0]).toMatchObject({ id: "G1", label: "G1 · P0'", detail: "wR 10 % · index 2 · 1 moment parameter · within the noise of the best" });
    expect(choicesFor("rank_magnetic_groups", { groups: [], reading: "No candidate could be fitted." })).toBeNull();
  });

  it("next steps: the actions in rank, the first marked; other tools offer none", () => {
    const set = choicesFor("suggest_next_steps", { steps: [{ action: "Hold B_Mn1 fixed and re-refine.", rationale: "at its bound", priority: 2 }, { action: "Free the zero shift.", rationale: "", priority: 3 }] })!;
    expect(set.options.map((o) => o.message)).toEqual(["Go ahead with this next: Hold B_Mn1 fixed and re-refine.", "Go ahead with this next: Free the zero shift."]);
    expect(set.options[0]).toMatchObject({ recommended: true, detail: "at its bound" });
    expect(choicesFor("suggest_next_steps", { steps: [] })).toBeNull();
    for (const tool of ["get_state", "magnetic_state", "assess_refinement", "set_propagation_vector"]) expect(choicesFor(tool, search)).toBeNull();
    expect(choicesFor("search_propagation_vector", null)).toBeNull();
  });
});

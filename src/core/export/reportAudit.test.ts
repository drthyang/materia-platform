import { describe, it, expect } from "vitest";
import { markNumbers, unverifiedNumbers } from "@/core/export/reportAudit";

describe("the number audit of a narrative", () => {
  const engine = "wR 9.93 % · GoF 1.56 · a 4.57531(8) Å · c 8.8537(2) Å · B 0.44(8) Å² · occupancy 0.2214(30) · Rietveld refinement with 23 free parameters";

  it("accepts numbers the engine computed, at the narrative's precision, as fractions or percentages", () => {
    expect(unverifiedNumbers("wR 9.93 % (S = 1.56); a = 4.5753 Å and c = 8.854 Å; B = 0.44 Å².", engine)).toEqual([]);
    // Rounded: 9.9 % and 4.58 Å round from the engine's values.
    expect(unverifiedNumbers("wR about 9.9 %, a near 4.58 Å", engine)).toEqual([]);
    // The fraction 0.2214 read as 22.14 % (and back).
    expect(unverifiedNumbers("an antisite fraction of 22.14 %", engine)).toEqual([]);
    // A sign the engine does not carry: a difference written either way round.
    expect(unverifiedNumbers("B(Cr) − B(W) = −0.44", engine)).toEqual([]);
    // "2.0" matches the engine's integer 2… only when the engine has it: 23 → 23.0 yes.
    expect(unverifiedNumbers("23.0 free parameters", engine)).toEqual([]);
  });

  it("flags decimal numbers no engine value rounds to, each once, in order", () => {
    expect(unverifiedNumbers("wR 9.81 %, a = 4.5761 Å, and again 9.81; the B is 0.44.", engine)).toEqual(["9.81", "4.5761"]);
    // One more digit than the engine gives is still checked against it: 4.57532 ≠ 4.57531.
    expect(unverifiedNumbers("a = 4.57532 Å", engine)).toEqual(["4.57532"]);
  });

  it("leaves integers, version strings and numbers inside words alone", () => {
    expect(unverifiedNumbers("Cr2WO6 at 4 K, 150 K and 300 K; reflections 0 0 1 and 1 0 2; MATERIA v1.2.3; P42/mnm", engine)).toEqual([]);
  });

  it("marks the unverified numbers where they appear", () => {
    expect(markNumbers("wR 9.81 % and 9.93 %; 9.81 again", ["9.81"], (t) => `[${t}]`)).toBe("wR [9.81] % and 9.93 %; [9.81] again");
    expect(markNumbers("nothing to mark", [], (t) => `[${t}]`)).toBe("nothing to mark");
  });
});

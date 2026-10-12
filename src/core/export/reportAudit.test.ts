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

  it("accepts a number more precise than the report's when it rounds to the printed value", () => {
    // The tools gave the Agent more digits than the report prints (the eval runs of 2026-10-10).
    const engine = "GoF 2.999 · a = 1.23 Å · x 0.91 · wR 16.4 % · Rw 0.2214";
    expect(unverifiedNumbers("GoF 2.9992, a = 1.2331 Å, x = 0.91004, Rw 22.143 %", engine)).toEqual([]);
    // Not when it does not round to it: 16.48 is 16.5 at the printed precision, not 16.4.
    expect(unverifiedNumbers("wR 16.48 %", engine)).toEqual(["16.48"]);
    // A printed value with one significant digit vouches for nothing finer.
    expect(unverifiedNumbers("B = 0.93", "B 0.9")).toEqual(["0.93"]);
    expect(unverifiedNumbers("B = 1.04", "B 1")).toEqual(["1.04"]);
    // A fraction finer than a printed percentage.
    expect(unverifiedNumbers("0.22143", "Rw 22.14 %")).toEqual([]);
  });

  it("flags decimal numbers no engine value rounds to, each once, in order", () => {
    expect(unverifiedNumbers("wR 9.81 %, a = 4.5761 Å, and again 9.81; the B is 0.44.", engine)).toEqual(["9.81", "4.5761"]);
    // One more digit than the engine gives is still checked against it: 4.57532 ≠ 4.57531.
    expect(unverifiedNumbers("a = 4.57532 Å", engine)).toEqual(["4.57532"]);
  });

  it("audits a number that ends a sentence, in the narrative and in the engine's text", () => {
    expect(unverifiedNumbers("The wR2 is 9.99.", "wR2 4.12 %")).toEqual(["9.99"]);
    expect(unverifiedNumbers("The wR2 is 4.12.", "wR2 4.12 %")).toEqual([]);
    expect(unverifiedNumbers("The wR2 is 4.12 %.", "The refinement ended at wR2 4.12.")).toEqual([]);
    expect(markNumbers("The wR2 is 9.99.", ["9.99"], (t) => `[${t}]`)).toBe("The wR2 is [9.99].");
    // A version string is still not a number.
    expect(unverifiedNumbers("Built with 1.2.3.", "")).toEqual([]);
  });

  it("leaves integers, version strings and numbers inside words alone", () => {
    expect(unverifiedNumbers("Cr2WO6 at 4 K, 150 K and 300 K; reflections 0 0 1 and 1 0 2; MATERIA v1.2.3; P42/mnm", engine)).toEqual([]);
  });

  it("marks the unverified numbers where they appear", () => {
    expect(markNumbers("wR 9.81 % and 9.93 %; 9.81 again", ["9.81"], (t) => `[${t}]`)).toBe("wR [9.81] % and 9.93 %; [9.81] again");
    expect(markNumbers("nothing to mark", [], (t) => `[${t}]`)).toBe("nothing to mark");
  });
});

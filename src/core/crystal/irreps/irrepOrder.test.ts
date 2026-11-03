/**
 * The irreps' numbers are a total order of the irreps themselves (irrepOrder.ts,
 * THY-64): the same on every runtime, for every order of the operation list,
 * and alike on the Γ chip and in "Γ irrep n of m".
 *
 *  - irrepLabels.golden.json holds every label with its irrep's fingerprint
 *    (testSupport/irrepLabelFingerprints.ts) for the ISOTROPY oracle's cases,
 *    SrTiO₃'s and GaTa₄Se₈'s parents in the app's bounds and the Γ chip of the
 *    32 crystal classes. Written on one machine, checked on every other: CI
 *    (Linux, Node 22), a laptop (macOS, Node 24), a browser
 *    (scripts/irrep-labels-check.mjs). IRREP_GOLDEN_WRITE=1 rewrites it — a
 *    deliberate re-baseline of model-visible labels, with the old → new list.
 *  - A runtime whose sin, cos, atan2, … differ in the last bit is simulated by
 *    nudging every result by one ulp: before THY-64 that renumbered Fd-3m's X,
 *    P6₃/mmc's A and P4₂/mnm's Z irreps and about a hundred Γ-chip irreps.
 *  - The operation list shuffled (so the factor group's elements, its classes,
 *    every Map built on them and the chain's inputs come in another order).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SymmetryOperation } from "@/core/crystal/types";
import { buildSpaceGroup, knownSpaceGroups } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { complexIrrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { compareIrreps, compareRotations, orderIrreps, type IrrepOrderKey } from "@/core/crystal/irreps/irrepOrder";
import type { IMat } from "@/core/crystal/irreps/rational";
import { abelianIrreps } from "@/core/magnetic/irreps";
import { pointGroupIrreps } from "@/core/magnetic/pointGroupIrreps";
import {
  allFingerprints, CLASS_REPRESENTATIVES, displaciveFingerprints, gammaChipFingerprints, starFingerprints, STAR_CASES,
} from "@/testSupport/irrepLabelFingerprints";
import { srtio3 } from "@/testSupport/perovskiteTilts";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";

const GOLDEN = fileURLToPath(new URL("./irrepLabels.golden.json", import.meta.url));
const SLOW = 300_000;

/** A seeded shuffle (LCG), so a failure names its seed. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const NUDGED = ["sin", "cos", "tan", "atan2", "atan", "acos", "asin", "exp", "log", "pow", "cbrt", "hypot", "sqrt"] as const;

/** Run `f` with every Math function above off by one ulp (up, down or not at all, seeded), as another libm could be. */
function withNudgedLibm<T>(seed: number, f: () => T): T {
  const math = Math as unknown as Record<string, (...a: number[]) => number>;
  const saved = NUDGED.map((name) => [name, math[name]!] as const);
  let s = seed >>> 0;
  const buf = new Float64Array(1);
  const bits = new BigInt64Array(buf.buffer);
  const nudge = (x: number): number => {
    if (!Number.isFinite(x) || x === 0) return x;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const r = s / 2 ** 32;
    if (r < 1 / 3) return x;
    buf[0] = x;
    bits[0] = bits[0]! + (r < 2 / 3 ? 1n : -1n);
    return buf[0];
  };
  for (const [name, fn] of saved) math[name] = (...a: number[]) => nudge(fn(...a));
  try {
    return f();
  } finally {
    for (const [name, fn] of saved) math[name] = fn;
  }
}

const structures = () => ({ SrTiO3: srtio3(), GaTa4Se8: gata4se8PdfExample().structure });
/** The 230 groups, each in its reference setting. */
const ALL_230 = knownSpaceGroups().map((g) => g.hermannMauguin);

describe("irrep labels: the same irrep under the same label, whatever the runtime", () => {
  it("every label names the irrep irrepLabels.golden.json gives it (written on another machine)", () => {
    const now = allFingerprints(structures());
    if (process.env.IRREP_GOLDEN_WRITE === "1") writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string[]>;
    expect(Object.keys(now)).toEqual(Object.keys(golden));
    for (const name of Object.keys(golden)) expect(now[name], name).toEqual(golden[name]);
  }, SLOW);

  it("a libm that differs in the last bit numbers every irrep alike (the branch-cut stars and the Γ chip)", () => {
    const cases = STAR_CASES.filter((c) => /Fd-3m X|Cmcm|P6₃\/mmc|P4₂\/mnm|Pm-3m R|SrTiO₃|GaTa₄Se₈ F-43m 1×1×2/.test(c.name));
    const base = cases.map((c) => starFingerprints(c));
    const chips = CLASS_REPRESENTATIVES.map((n) => gammaChipFingerprints(buildSpaceGroup(n).operations));
    for (const seed of [1, 2, 3]) {
      const nudged = withNudgedLibm(seed, () => ({
        stars: cases.map((c) => starFingerprints(c)),
        chips: CLASS_REPRESENTATIVES.map((n) => gammaChipFingerprints(buildSpaceGroup(n).operations)),
        sto: displaciveFingerprints(srtio3()),
      }));
      cases.forEach((c, i) => expect(nudged.stars[i], `${c.name}, seed ${seed}`).toEqual(base[i]));
      CLASS_REPRESENTATIVES.forEach((n, i) => expect(nudged.chips[i], `#${n}, seed ${seed}`).toEqual(chips[i]));
      expect(nudged.sto, `SrTiO₃'s Γ chip, seed ${seed}`).toEqual(displaciveFingerprints(srtio3()));
    }
  }, SLOW);
});

describe("irrep labels: the same for every order of the operation list", () => {
  it("at every star of the oracle's cases and the app's parents", () => {
    for (const c of STAR_CASES) {
      const ops = buildSpaceGroup(c.setting).operations;
      const base = starFingerprints(c, ops);
      for (const seed of [7, 11]) expect(starFingerprints(c, shuffled(ops, seed)), `${c.name}, seed ${seed}`).toEqual(base);
    }
  }, SLOW);

  it("on the Γ chip of all 230 space groups, and in SrTiO₃'s and GaTa₄Se₈'s displacive decompositions", () => {
    expect(ALL_230).toHaveLength(230);
    for (const n of ALL_230) {
      const ops = buildSpaceGroup(n).operations;
      const base = gammaChipFingerprints(ops);
      for (const seed of [3, 5]) expect(gammaChipFingerprints(shuffled(ops, seed)), `${n}, seed ${seed}`).toEqual(base);
    }
    for (const s of Object.values(structures())) {
      const base = displaciveFingerprints(s);
      for (const seed of [3, 5]) {
        const ops = shuffled(s.spaceGroup.operations, seed);
        expect(displaciveFingerprints({ ...s, spaceGroup: { ...s.spaceGroup, operations: ops } }), `${s.name}, seed ${seed}`).toEqual(base);
      }
    }
  }, SLOW);
});

describe("the Γ chip and the generic label number the irreps alike", () => {
  const rotationKey = (op: SymmetryOperation): string => op.rotation.flat().map((x) => Math.round(x)).join(",");
  const close = (a: { re: number; im: number }, b: { re: number; im: number }): boolean => Math.hypot(a.re - b.re, a.im - b.im) < 1e-6;

  it("Γn is \"Γ irrep n of m\" in all 230 space groups, and Γ1 the trivial irrep", () => {
    for (const n of ALL_230) {
      const ops = buildSpaceGroup(n).operations;
      const chip = abelianIrreps(ops) ?? pointGroupIrreps(ops);
      const group = factorGroup(ops);
      const { irreps } = complexIrrepsOfStar(group, [0, 0, 0]);
      expect(irreps.length, n).toBe(chip.length);
      // Element i < |ops| of the factor group is operation i; at Γ the character depends on the rotation only.
      const first = new Map<string, number>();
      ops.forEach((op, i) => {
        if (!first.has(rotationKey(op))) first.set(rotationKey(op), i);
      });
      const at = [...first.values()];
      chip.forEach((ir, i) => {
        expect(ir.label, n).toBe(`Γ${i + 1}`);
        const generic = irreps[i]!;
        expect(generic.label, n).toBe(`Γ irrep ${i + 1} of ${irreps.length}`);
        expect(at.every((e) => close(generic.characters[e]!, ir.characters[e]!)), `${n}: Γ${i + 1} and Γ irrep ${i + 1} differ`).toBe(true);
      });
      expect(chip[0]!.characters.every((c) => close(c, { re: 1, im: 0 })), `${n}: Γ1 is not trivial`).toBe(true);
    }
  }, SLOW);

  it("SrTiO₃: the polar irrep is Γ10 and Γ irrep 10 of 10, the silent one Γ8; GaTa₄Se₈'s Γ chip E, T₁ and T₂ are Γ3, Γ4 and Γ5", () => {
    const sto = displaciveFingerprints(srtio3()).map((x) => x.split(" · ").slice(0, 4).join(" · "));
    expect(sto).toEqual(["Γ8 · 3 · n 1 · acoustic 0", "Γ10 · 3 · n 4 · acoustic 1"]);
    const gts = displaciveFingerprints(gata4se8PdfExample().structure).map((x) => x.split(" · ").slice(0, 4).join(" · "));
    expect(gts).toEqual(["Γ1 · 1 · n 3 · acoustic 0", "Γ3 · 2 · n 3 · acoustic 0", "Γ4 · 3 · n 3 · acoustic 0", "Γ5 · 3 · n 7 · acoustic 1"]);
  });
});

describe("orderIrreps", () => {
  const W = (rows: number[][]): IMat => rows as unknown as IMat;
  const E = W([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const twoZ = W([[-1, 0, 0], [0, -1, 0], [0, 0, 1]]);
  const inv = W([[-1, 0, 0], [0, -1, 0], [0, 0, -1]]);
  const mz = W([[1, 0, 0], [0, 1, 0], [0, 0, -1]]);

  it("orders rotations identity first, then the proper ones, then the improper ones, each lexicographically", () => {
    expect([mz, inv, twoZ, E].sort(compareRotations)).toEqual([E, twoZ, inv, mz]);
  });

  it("gives one order for every input order: dimension, reality, the larger character first", () => {
    const c = (...xs: number[]) => xs.map((re) => ({ re, im: 0 }));
    const keys: IrrepOrderKey[] = [
      { dim: 1, reality: "real", characters: c(1, -1, -1) },
      { dim: 2, reality: "real", characters: c(2, 0, 0) },
      { dim: 1, reality: "complex", characters: [{ re: 1, im: 0 }, { re: -0.5, im: -0.866 }, { re: -0.5, im: 0.866 }] },
      { dim: 1, reality: "real", characters: c(1, 1, 1) },
      { dim: 1, reality: "complex", characters: [{ re: 1, im: 0 }, { re: -0.5, im: 0.866 }, { re: -0.5, im: -0.866 }] },
      { dim: 1, reality: "real", characters: c(1, 1, -1) },
    ];
    const expected = [keys[3], keys[5], keys[0], keys[4], keys[2], keys[1]];
    for (const seed of [1, 2, 3, 4, 5]) expect(orderIrreps(shuffled(keys, seed), (k) => k!)).toEqual(expected);
    // A rounding error far below the tolerance, of either sign, changes nothing.
    const noisy = keys.map((k) => ({ ...k, characters: k.characters.map((x, i) => ({ re: x.re + (i % 2 ? 1e-12 : -1e-12), im: x.im - 1e-13 })) }));
    expect(orderIrreps(noisy, (k) => k).map((k) => noisy.indexOf(k))).toEqual(expected.map((k) => keys.indexOf(k!)));
    expect(compareIrreps(keys[3]!, keys[5]!)).toBeLessThan(0);
  });

  it("refuses two irreps it cannot tell apart", () => {
    const k: IrrepOrderKey = { dim: 1, reality: "real", characters: [{ re: 1, im: 0 }] };
    expect(() => orderIrreps([k, { ...k }], (x) => x)).toThrow(/same dimension, reality and characters/);
  });
});

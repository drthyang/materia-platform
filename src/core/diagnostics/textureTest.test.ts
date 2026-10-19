import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { generateReflections } from "@/core/diffraction/reflections";
import { marchDollaseFamily } from "@/core/diffraction/intensity";
import { distinctAxes, textureTest, TEXTURE_CHANCE, type TextureRow } from "@/core/diagnostics/textureTest";
import type { UnitCell } from "@/core/crystal/types";
import type { Vec3 } from "@/core/math/types";

/**
 * The texture test on reflection lists whose misfit is known: noise alone
 * (the test must rarely name texture, whatever the best axis), and noise on a
 * March–Dollase texture (it must name that axis and ratio).
 */

function gaussian(seed: number): () => number {
  let state = seed;
  const u = (): number => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

const cubic: UnitCell = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 };
const ortho: UnitCell = { a: 5.5, b: 7.8, c: 5.4, alpha: 90, beta: 90, gamma: 90 };

/** The first `count` reflections of a phase, misfit = ln P(texture) + noise of this σ, weight √I with I random. */
function rows(cell: UnitCell, group: number, count: number, seed: number, noise: number, texture?: { axis: Vec3; ratio: number }): TextureRow[] {
  const sg = buildSpaceGroup(group);
  const g = gaussian(seed);
  return generateReflections(cell, sg, 0.8, 10).slice(0, count).map((r) => ({
    h: r.h, k: r.k, l: r.l,
    misfit: (texture ? Math.log(marchDollaseFamily(cell, sg, texture.axis, r.h, r.k, r.l, texture.ratio)) : 0) + noise * g(),
    weight: Math.sqrt(100 + 1000 * Math.abs(g())),
  }));
}

describe("the texture test", () => {
  it("searches one axis per class of symmetry-equivalent directions", () => {
    expect(distinctAxes(buildSpaceGroup(221))).toEqual([[1, 1, 1], [1, 1, 0], [1, 0, 0]]);
    expect(distinctAxes(buildSpaceGroup(123))).toHaveLength(5);
    expect(distinctAxes(buildSpaceGroup(2))).toHaveLength(13);
  });

  it("rarely names texture on noise, though it picks the best of many axes", () => {
    // 12–20 reflections, the sizes where a best-of-axes correlation finds a pattern in noise.
    let named = 0;
    const seeds = 100;
    for (let seed = 1; seed <= seeds; seed++) {
      const list = rows(ortho, 62, 12 + (seed % 9), seed, 0.1);
      const t = textureTest(list, { cell: ortho, spaceGroup: buildSpaceGroup(62) }, { draws: 200, seed });
      if (t && t.chance < TEXTURE_CHANCE) named++;
    }
    // Expected about 1 in 100 at this chance; 4 would be p < 0.02 for a calibrated test.
    expect(named).toBeLessThanOrEqual(3);
  });

  it("names cubic texture, which the angle to one family member cannot see", () => {
    const t = textureTest(rows(cubic, 221, 30, 7, 0.03, { axis: [1, 1, 1], ratio: 0.8 }), { cell: cubic, spaceGroup: buildSpaceGroup(221) });
    expect(t?.axis).toEqual([1, 1, 1]);
    expect(t!.chance).toBeLessThan(TEXTURE_CHANCE);
    expect(t!.ratio).toBeGreaterThan(0.74);
    expect(t!.ratio).toBeLessThan(0.86);
    expect(t!.enhancedAlongAxis).toBe(true);
  });

  it("names needles (r > 1) along the axis they lie on", () => {
    const t = textureTest(rows(ortho, 62, 25, 3, 0.03, { axis: [0, 1, 0], ratio: 1.3 }), { cell: ortho, spaceGroup: buildSpaceGroup(62) });
    expect(t?.axis).toEqual([0, 1, 0]);
    expect(t!.chance).toBeLessThan(TEXTURE_CHANCE);
    expect(t!.ratio).toBeGreaterThan(1.2);
    expect(t!.enhancedAlongAxis).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import type { RefinementParameter } from "@/core/refinement/types";
import { fitMomentsWithRestarts, type MomentFit } from "@/core/magnetic/momentRestarts";

const row = (id: string, value: number, extra: Partial<RefinementParameter> = {}): RefinementParameter =>
  ({ id, label: id, kind: "momentX", value, initialValue: value, fixed: false, ...extra }) as RefinementParameter;

/** Two basins in m: a start below −0.7 falls to m = −1 (agreement 0.2), any other to m = 2 (0.1, the true one). */
const twoBasins = (seen: Record<string, number>[]) => (start?: Record<string, number>): MomentFit => {
  const m0 = start?.m ?? -0.9;
  seen.push({ ...(start ?? {}) });
  const m = m0 < -0.7 ? -1 : 2;
  return { values: { m, tied: 7 }, agreement: m === 2 ? 0.1 : 0.2 };
};

describe("fitMomentsWithRestarts", () => {
  it("keeps the seeded fit with no restarts, and finds the deeper basin with them", async () => {
    const none = await fitMomentsWithRestarts([row("m", -0.9)], twoBasins([]), { restarts: 0 });
    expect(none).toMatchObject({ values: { m: -1 }, agreement: 0.2, restartsRun: 0, bestStart: 0 });
    const some = await fitMomentsWithRestarts([row("m", -0.9)], twoBasins([]), { restarts: 12 });
    expect(some.values.m).toBe(2);
    expect(some.agreement).toBe(0.1);
    expect(some.bestStart).toBeGreaterThan(0);
    expect(some.restartsRun).toBe(12);
    expect(some.agreements).toHaveLength(13);
  });

  it("is deterministic for a seed, never kicks a tied amplitude, and keeps a kick inside the bounds", async () => {
    const a: Record<string, number>[] = [];
    const b: Record<string, number>[] = [];
    const params = [row("m", -0.9, { min: -1.5, max: 0.5 }), row("tied", 7, { expression: "m" })];
    await fitMomentsWithRestarts(params, twoBasins(a), { restarts: 8, seed: 3 });
    await fitMomentsWithRestarts(params, twoBasins(b), { restarts: 8, seed: 3 });
    expect(a).toEqual(b);
    for (const start of a.slice(1)) {
      expect(start.tied).toBe(7);
      expect(start.m).toBeGreaterThanOrEqual(-1.5);
      expect(start.m).toBeLessThanOrEqual(0.5);
    }
  });

  it("stops early when cancelled, and treats a fit that did not run as the worst", async () => {
    let n = 0;
    const r = await fitMomentsWithRestarts([row("m", 1)], () => ({ values: { m: 1 }, agreement: n++ === 0 ? null : 0.3 }), { restarts: 5, cancelled: () => n >= 3 });
    expect(r.restartsRun).toBe(2);
    expect(r.agreement).toBe(0.3);
  });
});

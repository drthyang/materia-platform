import { describe, it, expect } from "vitest";
import { example3Session } from "@/agent/validation/example3";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { exampleMagnetic } from "@/examples/mn3gaMagnetic";

/**
 * The in-app magnetic step on Example 3 (docs/AGENT_EXAMPLES.md): the nuclear
 * fit, rank_magnetic_groups at k = 0 over the maximal groups, the best chosen
 * and handed to the refinement, then nuclear and magnetic refined together.
 * One fit per group leaves P2₁'/m' with Mn1 almost switched off (wR ≈ 4.8 %);
 * with the ranking's restarts the joint fit reaches the minimum the pattern was
 * simulated from, as the MCP path's 12 restarts do (wR 4.61 % there).
 */
async function inAppPath(restarts: number) {
  const { port, session } = sessionPort(example3Session());
  const { ex } = executor(fakeHost(port).host, true);
  await ex.run("read_skill", { name: "magnetic-analysis" });
  await ex.run("read_skill", { name: "my-rietveld-workflow" });
  const ranked = JSON.parse((await ex.run("rank_magnetic_groups", { restarts })).text) as { best: string; restarts: number; groups: { group: string; fit: { wR: number } }[] };
  await ex.run("choose_magnetic_group", { id: ranked.best });
  await ex.run("continue_magnetic_refinement", {});
  const refined = JSON.parse((await ex.run("refine", {})).text) as { wR: number };
  const s = session();
  const values = Object.fromEntries(s.powderParams.map((p) => [p.id, p.value]));
  const moments = applyMagneticMoments(s.magnetic!, s.powderBindings, values).moments;
  return { ranked, wR: refined.wR, moments };
}

/** Largest component error against the moments the pattern was simulated from, up to the global ±m (µB). */
function momentError(found: readonly { siteLabel: string; components: readonly number[] }[]): number {
  const truth = exampleMagnetic().magnetic.moments;
  const label = (l: string): string => l.replace(/_\d+$/, "");
  const f0 = found.find((m) => label(m.siteLabel) === label(truth[0]!.siteLabel))!;
  const sign = Math.sign(f0.components[0]! * truth[0]!.components[0]!) || 1;
  let worst = 0;
  for (const t of truth) {
    const f = found.find((m) => label(m.siteLabel) === label(t.siteLabel))!;
    t.components.forEach((c, j) => (worst = Math.max(worst, Math.abs(sign * f.components[j]! - c))));
  }
  return worst;
}

describe("rank_magnetic_groups on Example 3", () => {
  it("with restarts, the in-app path reaches the true minimum, as the MCP path does", async () => {
    const run = await inAppPath(12);
    expect(run.ranked.restarts).toBe(12);
    expect(run.ranked.groups[0]!.group).toBe("P2₁'/m'");
    expect(run.wR).toBeLessThan(4.7);
    expect(momentError(run.moments)).toBeLessThan(0.15);
  }, 120000);

  it("one fit per group stops in the shallow minimum, Mn1 almost off: the failure the restarts fix", async () => {
    const run = await inAppPath(0);
    expect(run.ranked.groups[0]!.group).toBe("P2₁'/m'");
    expect(run.wR).toBeGreaterThan(4.7);
    expect(momentError(run.moments)).toBeGreaterThan(1);
  }, 120000);
});

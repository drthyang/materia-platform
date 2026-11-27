import { describe, it, expect } from "vitest";
import { bundledSession } from "@/app/powderSession";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { observationsIn, powderPageCurves } from "@/app/powderPage";
import { scoredWindow, shortDNote, shortDReading, tickDRanges } from "@/app/shortD";
import { sessionPort, executor, fakeHost } from "@/testSupport/agentHeadless";

/**
 * THY-90 on the page: the line that says where the reflections stop and why,
 * the trim it suggests when the window reaches well below the last resolved
 * lines (the owner's Q3), and the same words where the Copilot reads them.
 * The bundled POWGEN 600 K pattern reaches d = 0.150 Å.
 */
const demo = mn3gaPowgenExample();
const session = bundledSession(demo);

describe("the demo's window", () => {
  it("is reached by the list: the line says where it stops, nothing is left out, no trim", () => {
    const r = shortDReading(session, demo.fitRange)!;
    expect(r.range.stop).toBe("window");
    expect(r.leftOut).toBe(0);
    expect(r.trim).toBeUndefined();
    expect(scoredWindow(session, demo.fitRange)).toEqual(demo.fitRange);
    expect(shortDNote(r)!.line).toBe("Reflections down to d 0.400 Å, one peak support below the fit window's edge (0.414 Å).");
    expect(observationsIn(powderPageCurves(session, demo.fitRange).curves, demo.fitRange, session)).toBe(3125);
  });

  it("gives the tick rows the list's own range", () => {
    const t = tickDRanges(session, demo.fitRange)!;
    expect(t.nuclear[0]!.dMin).toBeCloseTo(shortDReading(session, demo.fitRange)!.range.dMin, 12);
    expect(t.magnetic.dMin).toBe(0.5);
  });
});

describe("the whole POWGEN pattern", () => {
  it("is calculated to its end, and the page suggests a trim where the lines stop being resolved", () => {
    const r = shortDReading(session, null)!;
    expect(r.range.stop).toBe("window");
    expect(r.range.windowD).toBeCloseTo(0.150, 3);
    expect(r.trim!.d).toBeGreaterThan(0.35);
    expect(r.trim!.d).toBeLessThan(0.42);
    expect(shortDNote(r)!.line).toMatch(/^Reflections down to d 0\.146 Å, one peak support below the fit window's edge \(0\.150 Å\)\. Lines are resolved down to d 0\.\d{3} Å: trimming the window there would fit faster\.$/);
  });

  it("is what check_fit_range proposes to trim, at the short-d end, and get_state says where the list stops", async () => {
    const sp = sessionPort(session, demo.instrument, { instrumentOnPage: true });
    const { ex } = executor(fakeHost(sp.port).host);
    const view = JSON.parse((await ex.run("check_fit_range", {})).text);
    const low = view.low as { verdict: string; findings: string[]; cutD: number };
    expect(low.verdict).toBe("trim");
    expect(low.findings.some((f) => f.startsWith("unresolved-lines:"))).toBe(true);
    expect(view.reflectionsTo).toMatch(/^Reflections down to d 0\.146 Å/);
    const state = JSON.parse((await ex.run("get_state", {})).text);
    expect(state.data.reflectionsTo).toBe(view.reflectionsTo);
  });
});

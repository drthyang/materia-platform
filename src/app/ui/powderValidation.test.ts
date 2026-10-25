import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PowderValidationView, type PowderValidationProps } from "@/app/ui/PowderValidation";
import { loadedSession, type Session } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { powderReflectionObsCalc } from "@/core/workflow/obsCalc";
import { excludedPointMask } from "@/core/refinement/factors";
import { stagesCovered } from "@/agent/method";
import type { PowderAgentPort } from "@/agent/port";
import type { EvidenceSection } from "@/app/ui/fitCauses";

/**
 * The powder Validation view as the page renders it, on the bundled demo: the
 * verdict and the acceptance bar on top, what limits the fit next, the
 * evidence collapsed below.
 */

function demoPort(start?: Session): PowderAgentPort {
  const demo = mn3gaPowgenExample();
  const session = start ?? loadedSession(demo.structure, demo.pattern, demo.instrument, demo.extraPhases, demo.refinedParams);
  const { port } = sessionPort(session, demo.instrument, { instrumentOnPage: true });
  port.setFitRange(demo.fitRange);
  return port;
}

/** The view's props as the workbench's QualityPanel builds them from the page. */
function props(port: PowderAgentPort, opts: { snapshot?: boolean; open?: EvidenceSection[] } = {}): PowderValidationProps {
  const s = port.state();
  const { x, yObs, yCalc, yBackground } = s.curves;
  const sigma = s.pattern.points.map((p) => p.sigma ?? (p.yObs > 0 ? Math.sqrt(p.yObs) : 1));
  const excluded = excludedPointMask([...yObs]);
  const include = x.map((v, i) => !excluded[i] && !(s.pattern.xUnit === "tof" && yCalc[i]! <= 0) && !(s.fitRange && (v < s.fitRange.min || v > s.fitRange.max)));
  const reflections = powderReflectionObsCalc(s.structure, s.pattern, [...s.parameters], [...s.bindings], s.profile, s.magnetic, s.fitRange, s.extraPhases, "rietveld", { yCalc: [...yCalc], sigma, include });
  const free = s.parameters.filter((p) => !p.fixed && !p.expression);
  return {
    x, yObs, yCalc, ...(yBackground ? { yBackground } : {}), sigma, include, d: s.d!,
    nParams: free.length, reflections, phaseTicks: [], toDisplay: (v) => v, displayLabel: "TOF (µs)",
    result: s.result, parameters: s.parameters, page: s,
    ...(s.result?.agreement.goodnessOfFit !== undefined ? { gof: s.result.agreement.goodnessOfFit } : {}),
    snapshot: opts.snapshot ?? false,
    stagesDone: opts.snapshot ? stagesCovered("powder", free, s.parameters) : [],
    onAction: () => undefined, canRefine: true, canExport: true,
    openSections: new Set(opts.open ?? []), onToggleSection: () => undefined,
  };
}

/** The markup, without React's server warning about the "?" badges' layout effect (they measure on the client). */
function html(p: PowderValidationProps): string {
  const error = console.error;
  console.error = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    error(...args);
  };
  try {
    return renderToStaticMarkup(createElement(PowderValidationView, p));
  } finally {
    console.error = error;
  }
}
/** Text of the markup, tags dropped and entities read. */
const text = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The fit-state line under the headline. */
const stateLine = (markup: string): string => /<p data-testid="fit-state"[^>]*>(.*?)<\/p>/.exec(markup)?.[1] ?? "";

describe("the powder Validation view", () => {
  it("opens the demo on a verdict against the acceptance bar, not a stale 'not refined'", () => {
    const out = html(props(demoPort(), { snapshot: true }));
    const t = text(out);
    expect(t).toContain("Fair fit (GoF 3.05): not yet acceptable — most of the misfit is in the peak tails.");
    expect(t).toContain("Opened on a converged fit, which carries no esds or correlations: refine once to get them. Refine");
    expect(t).not.toMatch(/not refined/i);
    // The bar's three checks, in order, each with its tone.
    expect([...out.matchAll(/data-check="([^"]+)" data-tone="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(["gof:amber", "physical:green", "cross-check:grey"]);
    expect(t).toContain("Goodness of fit GoF 3.05 · fair");
    // The held occupancy 0.5 % over 1 is a note, not a blocker.
    expect(t).toContain("Physical sanity Nothing unphysical · 1 note");
    expect(t).toContain("note Mn3Ga: Ga1 occ is held at 1.005 (0.5% over 1): an input the fit never moved — set it to 1.");
    expect(t).toContain("No esds yet: the opened fit carries none.");
    expect(t).toContain("GSAS-II bundle");
    expect(t).not.toContain(">Posterior<");
  });

  it("lists what limits the fit, largest share first, each with what to do in the page's terms", () => {
    const out = html(props(demoPort(), { snapshot: true }));
    const t = text(out);
    expect([...out.matchAll(/data-cause="([^"]+)"/g)].map((m) => m[1])).toEqual(["peak-tails", "unexplained-peak"]);
    expect(t).toContain("Peak tails 85%");
    expect(t).toContain("The observed peaks have longer tails than the model's.");
    expect(t).toContain("Refine the TOF peak shape: the widths σ and the decay β, with the rise α held at the instrument's value. After a quick pass on the atom positions (your method's order).");
    expect(t).toContain("Open Instrument / profile");
    expect(t).toContain("Show on pattern");
    expect(t).toContain("The 8 worst reflections carry 7% of χ²; half of χ² comes from the 40% of points at d < 1.12 Å.");
  });

  it("keeps the evidence collapsed until asked, and every number there when opened", () => {
    const closed = html(props(demoPort(), { snapshot: true }));
    expect(closed.match(/aria-expanded="false"/g)).toHaveLength(4);
    expect(closed).not.toContain("Normalized residual and cumulative chi-square");
    expect(closed).not.toMatch(/<th[^>]*>R_Bragg/);
    expect(text(closed)).toContain("Worst peaks the 8 worst carry 7% of χ²");
    const open = html(props(demoPort(), { snapshot: true, open: ["residual", "shells", "worst", "agreement"] }));
    expect(open.match(/aria-expanded="true"/g)).toHaveLength(4);
    expect(open).toContain("Normalized residual and cumulative chi-square");
    const t = text(open);
    expect(open).toMatch(/<th[^>]*>R_Bragg/);
    expect(t).toMatch(/Mn3Ga \d+\.\d\d% \d+\.\d\d% 183/);
    expect(t).toMatch(/MnO \d+\.\d\d% \d+\.\d\d% 32/);
    expect(t).toContain("DW · Q_D 1.89");
    expect(t).toContain("Rwp′ bkg-sub");
    expect(t).toContain("(1 0 1)");
  });

  it("after Refine: converged, with the esds read for what they are", async () => {
    const port = demoPort();
    const { ex } = executor(fakeHost(port).host, true);
    await ex.run("refine", {});
    const out = html(props(port));
    const t = text(out);
    expect(t).toMatch(/Converged in \d cycles?: the last moved no parameter by more than [\d.]+ esd\./);
    expect(t).toContain("The esds are likely too small: neighbouring points miss together (Durbin–Watson 0.61, below 1.89), and the model leaves systematic misfit (GoF 3.05).");
    // Nothing to refine for: no Refine on the state line.
    expect(stateLine(out)).not.toContain("<button");
    expect(stateLine(html(props(demoPort(), { snapshot: true })))).toContain(">Refine</button>");
  }, 120_000);

  it("with the cell put off by hand: a poor fit, and the peak positions first, as the method orders them", () => {
    const demo = mn3gaPowgenExample();
    const start = loadedSession(demo.structure, demo.pattern, demo.instrument, demo.extraPhases, demo.refinedParams);
    const off = { ...start, powderParams: start.powderParams.map((p) => (p.id === "p0_cell_a" ? { ...p, value: p.value * 1.003 } : p)) };
    const out = html(props(demoPort(off)));
    const t = text(out);
    expect(t).toMatch(/Poor fit \(GoF \d+\.\d\d\): far from the data — start with the peak positions, your method's first block\./);
    expect(t).toContain("The model changed since its last refinement: refine to bring the values, esds and correlations up to date.");
    expect([...out.matchAll(/data-cause="([^"]+)"/g)].map((m) => m[1]).slice(0, 2)).toEqual(["peak-tails", "peak-position"]);
    expect(t).toContain("Fix the peak positions first: your method refines the cell, zero and background before the rest.");
  });

  it("with nothing refined, says what to do instead of reading causes", () => {
    const demo = mn3gaPowgenExample();
    const out = html(props(demoPort(loadedSession(demo.structure, demo.pattern, demo.instrument, demo.extraPhases))));
    const t = text(out);
    expect(t).toContain("Not refined yet.");
    expect(t).toContain("Not refined yet. Your method starts with the scale, background and cell: free them in the parameter panel, then refine.");
    expect(t).toContain("The causes are read once the first block is refined");
    expect(out).not.toContain("data-cause=");
  });
});

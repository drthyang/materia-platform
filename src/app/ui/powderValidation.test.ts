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
/** Text of the markup, tags and the "?" badges' glyphs dropped, entities read. */
const text = (markup: string): string => markup.replace(/(role="img"[^>]*>)\?(<\/span>)/g, "$1$2").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The fit-state line under the headline. */
const stateLine = (markup: string): string => /<p data-testid="fit-state"[^>]*>(.*?)<\/p>/.exec(markup)?.[1] ?? "";
/** Words of the visible text (tooltips are attributes, so they do not count). */
const words = (t: string): number => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** Title attributes, entities read: what hover shows. */
const titles = (markup: string): string[] => [...markup.matchAll(/title="([^"]*)"/g)].map((m) => text(m[1]!).trim());
/** The visible lines of the verdict and the causes (the evidence's headers excluded), as rendered. */
const topText = (markup: string): string => text(markup.slice(0, markup.indexOf('aria-label="Evidence"')));

describe("the powder Validation view", () => {
  it("opens the demo on a verdict against the acceptance bar, not a stale 'not refined'", () => {
    const out = html(props(demoPort(), { snapshot: true }));
    const t = text(out);
    expect(t).toContain("Fair fit: misfit mostly in the peak tails");
    expect(t).toContain("Converged snapshot: no esds or correlations Refine");
    expect(t).not.toMatch(/not refined/i);
    expect(t).toContain("Acceptance bar");
    // The bar's three checks, in order, each with its tone.
    expect([...out.matchAll(/data-check="([^"]+)" data-tone="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(["gof:amber", "physical:green", "cross-check:grey"]);
    expect(t).toContain("Goodness of fit GoF 3.05 · fair Above your bar (good ≤ 2.5)");
    // The held occupancy 0.5 % over 1 is a note, not a blocker, and said once.
    expect(t).toContain("Physical sanity Nothing unphysical · 1 note note Mn3Ga: Ga1 occ held at 1.005 → set to 1");
    expect(t).not.toContain("Nothing the fit made unphysical");
    // The cross-check in one line; the state line alone says there are no esds yet.
    expect(t).toContain("Cross-check Not yet In GSAS-II and FullProf, once the bar is met");
    expect(t.match(/esds/g)).toHaveLength(1);
    expect(t).toContain("GSAS-II bundle");
    expect(t).not.toContain(">Posterior<");
  });

  it("keeps the longer account in tooltips: the why, the numbers, the method's order", () => {
    const out = html(props(demoPort(), { snapshot: true }));
    const hover = titles(out);
    expect(hover).toContain("Not yet acceptable. Most of the misfit is in the peak tails (about 85% of χ²).");
    expect(hover).toContain("The page opened on a converged fit, which carries no esds or correlations: refine once to get them.");
    expect(hover).toContain("The model misses systematic features.");
    expect(hover.some((h) => /^0\.5% over 1: an input the fit never moved\./.test(h))).toBe(true);
    expect(hover).toContain("Once the fit meets the bar: refine the same model in GSAS-II and FullProf, and compare the values and esds.");
    expect(hover).toContain("The observed peaks have longer tails than the model's. (η 0.31 observed against 0.00 calculated · 12 isolated lines)");
    expect(hover).toContain("Refine the TOF peak shape: the widths σ and the decay β, with the rise α held at the instrument's value. After a quick pass on the atom positions (your method's order).");
    expect(hover.some((h) => h.startsWith("Not background: another phase (an impurity, the sample environment) or magnetic order."))).toBe(true);
    // Each cause and each check has a "?" too, for a touch screen, where a title never shows.
    expect(out.match(/role="img">\?<\/span>/g)!.length).toBeGreaterThanOrEqual(2 + 3 + 1 + 4);
  });

  it("roughly halves the words the view shows", () => {
    const t = topText(html(props(demoPort(), { snapshot: true })));
    // 272 words before (2026-10-25), on the demo as it opens.
    expect(words(t)).toBeLessThanOrEqual(140);
  });

  it("lists what limits the fit, largest share first, each with what to do in the page's terms", () => {
    const out = html(props(demoPort(), { snapshot: true }));
    const t = text(out);
    expect([...out.matchAll(/data-cause="([^"]+)"/g)].map((m) => m[1])).toEqual(["peak-tails", "unexplained-peak"]);
    expect(t).toContain("Peak tails 85%");
    expect(t).toContain("Model's tails too short → Refine TOF σ and β (keep α), after the atom positions");
    expect(t).toContain("7 excesses at d 0.468, 0.467, 2.149, … Å → Try the k-search, then another phase — not background");
    expect(t).not.toContain("The observed peaks have longer tails");
    expect(t).toContain("Open Instrument / profile");
    expect(t).toContain("Show on pattern");
    expect(t).toContain("largest first");
    // Where the misfit sits; what the worst peaks carry is said once, in their summary below.
    expect(t).toContain("Half of χ² at d < 1.12 Å (40% of points)");
    expect(t.match(/7% of χ²/g)).toHaveLength(1);
  });

  it("keeps the evidence collapsed until asked, and every number there when opened", () => {
    const closed = html(props(demoPort(), { snapshot: true }));
    expect(closed.match(/aria-expanded="false"/g)).toHaveLength(4);
    expect(closed).not.toContain("Normalized residual and cumulative chi-square");
    expect(closed).not.toMatch(/<th[^>]*>R_Bragg/);
    expect(text(closed)).toContain("Worst peaks 8 worst: 7% of χ²");
    expect(text(closed)).toContain("Residual Δ/σ and cumulative χ² · DW 0.61");
    expect(text(closed)).toMatch(/χ² by d-shell highest \d+\.\d\/point at d [\d.]+–[\d.]+ Å \(noise 1\)/);
    expect(text(closed)).toContain("Agreement Rwp 4.01% · Rexp 1.31%");
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
    expect(t).toMatch(/Converged in \d cycles? · max shift [\d.]+ esd/);
    expect(t).toContain("Esds likely too small: DW 0.61 < Q_D 1.89, GoF 3.05");
    expect(titles(out)).toContain("The esds are likely too small: neighbouring points miss together (Durbin–Watson 0.61, below 1.89), and the model leaves systematic misfit (GoF 3.05).");
    expect(words(topText(out))).toBeLessThanOrEqual(145);
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
    expect(t).toContain("Poor fit: fix the peak positions first");
    expect(t).toContain("Model changed since its last refinement Refine");
    expect(t).toMatch(/Goodness of fit GoF \d+\.\d\d · poor Far from the data — trust no value yet/);
    expect([...out.matchAll(/data-cause="([^"]+)"/g)].map((m) => m[1]).slice(0, 2)).toEqual(["peak-tails", "peak-position"]);
    expect(t).toContain("→ Fix the peak positions first, then refine TOF σ and β (keep α), after the atom positions");
    expect(t).toContain("Observed peaks shifted to lower TOF throughout → Refine the zero with the cell; keep the diffractometer constants");
    expect(titles(out).some((h) => h.startsWith("Fix the peak positions first: your method refines the cell, zero and background before the rest."))).toBe(true);
    expect(words(topText(out))).toBeLessThanOrEqual(170);
  });

  it("with nothing refined, says what to do instead of reading causes", () => {
    const demo = mn3gaPowgenExample();
    const out = html(props(demoPort(loadedSession(demo.structure, demo.pattern, demo.instrument, demo.extraPhases))));
    const t = text(out);
    expect(t).toContain("Not refined yet Free the scale, background and cell first Refine");
    expect(t).toContain("Causes are read once the first block is refined");
    expect(out).not.toContain("data-cause=");
  });
});

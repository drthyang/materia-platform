import { describe, it, expect } from "vitest";
import { bundledSession } from "@/app/powderSession";
import { mn3gaPowgenExample } from "@/examples/mn3gaPowgen";
import { changed, curvesGoodnessOfFit, powderPageCurves, snapshotHolds, snapshotOf, withFit, withFixed, withParameter, type PowderPage } from "@/app/powderPage";
import { powderValidation } from "@/core/diagnostics/powderValidation";
import { excludedPointMask } from "@/core/refinement/factors";
import type { RefinementResult } from "@/core/refinement/types";

/**
 * The bundled demo opens on a converged fit with no result of its own. The
 * page records it as a snapshot, so the Validation view reads the fit as
 * converged (not "not refined yet") while the rows hold its values; and the
 * card's GoF reads the curves on screen until a refinement gives one.
 */

const demo = mn3gaPowgenExample();
const session = bundledSession(demo);
const page: PowderPage = { session, instrument: demo.instrument, instrumentLoaded: true, result: null, snapshot: snapshotOf(session) };

describe("a demo's converged snapshot", () => {
  it("holds while the rows keep the values it opened with; freeing or fixing a row keeps it", () => {
    expect(snapshotHolds(page)).toBe(true);
    expect(snapshotHolds({ ...page, session: withFixed(page.session, [{ id: "p0_B_Mn1", fixed: false }]) })).toBe(true);
    expect(snapshotHolds({ session: page.session })).toBe(false);
  });

  it("goes with a typed value, a change of the model, or a fit", () => {
    expect(snapshotHolds({ ...page, session: withParameter(page.session, "p0_scale", { value: 1.2 }) })).toBe(false);
    expect(changed(page, page.session).snapshot).toBeUndefined();
    const fit: RefinementResult = {
      status: "converged",
      parameters: Object.fromEntries(session.powderParams.map((p) => [p.id, p.value])),
      esd: {},
      agreement: { rFactor: 0.03, rWeighted: 0.04, rExpected: 0.0131, goodnessOfFit: 3.05 },
      history: [],
    };
    expect(withFit(page, fit).snapshot).toBeUndefined();
    expect(withFit(page, fit).result).toBe(fit);
  });
});

describe("the card's GoF with no refinement of its own", () => {
  it("is the GoF of the curves on screen, as the Validation view computes it over the same points", () => {
    const curves = powderPageCurves(session).curves;
    const gof = curvesGoodnessOfFit(session, curves, demo.fitRange);
    const sigma = session.pattern.points.map((p) => p.sigma ?? (p.yObs > 0 ? Math.sqrt(p.yObs) : 1));
    const excluded = excludedPointMask(curves.yObs);
    const include = curves.x.map((x, i) => !excluded[i] && curves.yCalc[i]! > 0 && x >= demo.fitRange.min && x <= demo.fitRange.max);
    const nParams = session.powderParams.filter((p) => !p.fixed && !p.expression).length;
    const view = powderValidation({ x: curves.x, yObs: curves.yObs, yCalc: curves.yCalc, sigma, include, nParams });
    expect(gof).toBeCloseTo(view.agreement.gof, 10);
    // The demo's own: what a refinement from it reports (GoF 3.23, wR 4.24 %).
    expect(gof.toFixed(2)).toBe("3.23");
  });
});

describe("the bundled Mn₃Ga + MnO fit the demo opens on", () => {
  it("is the saved refinement: its background, its free rows, its agreement", () => {
    expect(session.powderProfile.backgroundType).toBe("logInterpolate");
    expect(session.backgroundTerms).toBe(3);
    // Every row the spec builds has a saved value, and no saved value is left over.
    expect(session.powderParams.map((p) => p.id).sort()).toEqual(Object.keys(demo.refinedParams).sort());
    expect(session.powderParams.filter((p) => !p.fixed).map((p) => p.id)).toEqual(["p0_scale", "bkg0", "bkg1", "bkg2", "p0_cell_a", "p0_cell_c", "p1_scale", "p1_cell_a"]);
    const curves = powderPageCurves(session).curves;
    const sigma = session.pattern.points.map((p) => p.sigma ?? (p.yObs > 0 ? Math.sqrt(p.yObs) : 1));
    const excluded = excludedPointMask(curves.yObs);
    const include = curves.x.map((x, i) => !excluded[i] && curves.yCalc[i]! > 0 && x >= demo.fitRange.min && x <= demo.fitRange.max);
    const view = powderValidation({ x: curves.x, yObs: curves.yObs, yCalc: curves.yCalc, sigma, include, nParams: 8 });
    // The saved project's last result: Rwp 4.24345 %, Rp 6.26410 %, over the same 3125 points.
    expect(view.agreement.n).toBe(3125);
    expect(view.agreement.rwp).toBeCloseTo(0.042434525551305, 9);
    expect(view.agreement.rp).toBeCloseTo(0.06264096284028371, 9);
  });
});

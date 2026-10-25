import { describe, it, expect } from "vitest";
import { loadedSession } from "@/app/powderSession";
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
const session = loadedSession(demo.structure, demo.pattern, demo.instrument, demo.extraPhases, demo.refinedParams);
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
    // The demo's own: what a refinement from it reports (GoF 3.05, wR 4.01 %).
    expect(gof.toFixed(2)).toBe("3.05");
  });
});

import { describe, it, expect } from "vitest";
import { bundledSession } from "@/app/powderSession";
import { gata4se8NomadExample } from "@/examples/gata4se8Nomad";
import { curvesGoodnessOfFit, observationsIn, powderPageCurves, snapshotHolds, snapshotOf, weightedR, withFixed, type PowderPage } from "@/app/powderPage";
import { sessionPort } from "@/testSupport/agentHeadless";

/**
 * The bundled GaTa₄Se₈ NOMAD bank-4 example opens on its converged fit: the
 * snapshot holds, the curves on screen give the recorded agreement over the
 * recorded points, and a refinement from it with the structure rows free
 * converges where it stands, with no near-null direction.
 */

const demo = gata4se8NomadExample();
const session = bundledSession(demo);
const page: PowderPage = { session, instrument: demo.instrument, instrumentLoaded: true, result: null, snapshot: snapshotOf(session) };
const BASE = ["scale", "bkg0", "bkg1", "bkg2", "bkg3", "bkg4", "bkg5", "bkg6", "cell_a"];
const STRUCTURE = ["B_Ga1", "B_Ta1", "B_Se1", "B_Se2", "pos_Ta1_0", "pos_Se1_0", "pos_Se2_0"];

describe("the bundled GaTa₄Se₈ NOMAD example", () => {
  it("is bank 4 of the data with bank 4 of the NOMAD 2023A instrument file, the file's profile held", () => {
    expect(demo.pattern.xUnit).toBe("tof");
    expect(demo.pattern.points.length).toBe(2906); // the bank's 2999 points less those with no counts and no esd
    expect(demo.instrument.kind).toBe("tof");
    expect(session.rawData?.bank).toBe(4);
    expect(session.rawInstrument?.bank).toBe(4);
    expect(session.rawInstrument?.bundledDefault).toBe("nomad-2023A");
    // The file's own rows keep the file's values.
    for (const p of session.powderParams.filter((r) => r.kind === "tofFileProfile" || r.kind === "tofCalibration")) {
      expect(p.fixed, p.id).toBe(true);
      expect(p.value, p.id).toBe(p.initialValue);
    }
    expect(session.powderParams.find((p) => p.id === "tofSampleGauss")?.value).toBe(0);
  });

  it("opens on the saved refinement: Chebyshev 7, the spec's free rows, every row with a saved value", () => {
    expect(snapshotHolds(page)).toBe(true);
    expect(session.powderProfile.backgroundType).toBe("chebyshev");
    expect(session.backgroundTerms).toBe(7);
    expect(session.powderParams.map((p) => p.id).sort()).toEqual(Object.keys(demo.refinedParams).sort());
    expect(session.powderParams.filter((p) => !p.fixed && !p.expression).map((p) => p.id)).toEqual(BASE);
  });

  it("shows the recorded agreement on screen: wR 2.50 % over 2334 points in its window", () => {
    const curves = powderPageCurves(session, demo.fitRange).curves;
    // The window ends at 16905.49 µs (d 1.873 Å), below two peaks no phase explains; below d 0.209 Å the file's profile gives no peak, and those 545 points are left out (THY-90).
    expect(demo.fitRange.max).toBe(16905.488658956);
    expect(demo.fitRange.min).toBe(demo.pattern.points[0]!.x);
    expect(observationsIn(curves, demo.fitRange, session)).toBe(2334);
    expect((100 * weightedR(session, curves, demo.fitRange)).toFixed(2)).toBe("2.50");
    // GoF over the nine rows the example opens with free (the refinement's own, with sixteen free, is 5.90: below).
    expect(curvesGoodnessOfFit(session, curves, demo.fitRange).toFixed(2)).toBe("5.89");
  });

  it("refined from where it opens, with the structure rows free, converges in place with no near-null direction", async () => {
    const free = withFixed(session, [...STRUCTURE].map((id) => ({ id, fixed: false })));
    const sp = sessionPort(free, demo.instrument, { instrumentOnPage: true });
    sp.port.setFitRange(demo.fitRange);
    await sp.port.refine();
    const r = sp.port.state().result!;
    expect(r.status).toBe("converged");
    expect(r.diagnostics?.svdZeroCount ?? 0).toBe(0);
    expect((100 * r.agreement.rWeighted!).toFixed(2)).toBe("2.50");
    expect(r.agreement.goodnessOfFit!.toFixed(2)).toBe("5.90");
    // Nothing moves by more than a tenth of its esd.
    for (const id of [...BASE, ...STRUCTURE]) {
      const esd = r.esd[id]!;
      expect(Math.abs(r.parameters[id]! - demo.refinedParams[id]!), id).toBeLessThan(0.1 * esd);
    }
    // a = 10.3757(1) Å; B = 8π²U for U Ga 0.0044(6), Ta 0.0044(2), Se1 0.0058(4), Se2 0.0053(4) Å².
    expect(r.parameters.cell_a!.toFixed(4)).toBe("10.3757");
    expect(r.esd.cell_a!).toBeLessThan(0.00015);
  }, 120_000);
});

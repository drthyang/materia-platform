import { describe, it, expect } from "vitest";
import { bundledSession } from "@/app/powderSession";
import { gata4se8NomadExample } from "@/examples/gata4se8Nomad";
import { curvesGoodnessOfFit, observationsIn, powderPageCurves, snapshotHolds, snapshotOf, weightedR, withFixed, withPattern, type PowderPage } from "@/app/powderPage";
import { sessionPort } from "@/testSupport/agentHeadless";
import { createHash } from "node:crypto";
import { currentDataBank, dataBanksOf, dataBankOptions } from "@/app/bankChoice";
import { followsInstrument, landData } from "@/app/bankKeep";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { appliedPhases } from "@/app/shortD";
import { placePeaks, reflectionRange } from "@/core/workflow/powder";
import { PEAK_WINDOW_FWHM } from "@/core/diffraction/profile";
import { generateReflections } from "@/core/diffraction/reflections";

/**
 * The bundled GaTa₄Se₈ NOMAD bank-4 example opens on its converged fit: the
 * snapshot holds, the curves on screen give the recorded agreement over the
 * recorded points, and a refinement from it with the structure rows free
 * converges where it stands, with no near-null direction. The data file is the
 * whole six-bank file, so the Data card's chooser lists banks 1–6.
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

  it("ships all six banks: the chooser lists 1–6 and the page is on bank 4, point for point the bank-4 file it replaced", () => {
    const banks = dataBanksOf(session.rawData?.text);
    expect(dataBankOptions(banks)?.map((o) => o.bank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(currentDataBank(banks, session.rawData)?.bankNumber).toBe(4);
    expect(session.rawData?.name).toBe("NOM_GaTa4Se8_at_300K.gsa");
    // SHA-256 of the points MATERIA read from the bank-4-only file shipped before (NOM_GaTa4Se8_at_300K_bank4.gsa, #201).
    expect(createHash("sha256").update(JSON.stringify(demo.pattern.points)).digest("hex")).toBe("b664896d78a50685c1c26522207d98f6dd565d12d4a70278980eb9f5373a2f2d");
  });

  it("switching to bank 3 by the chooser keeps every refinement value", () => {
    const text = session.rawData!.text;
    const bank3 = parseGsasHistogramPattern(text, "gata4se8-powder", "bank 3", { radiation: { kind: "neutron-tof" }, bank: 3 });
    const l = landData(page, withPattern(page, bank3, { name: session.rawData!.name, text, bank: 3 }), "Loaded data, bank 3", "chooser");
    expect(l.kept).toEqual({ from: 4, to: 3 });
    expect(l.page.session.rawData?.bank).toBe(3);
    expect(l.window).toEqual({ min: 2000, max: 18500 });
    for (const r of session.powderParams.filter((x) => !followsInstrument(x))) expect(l.page.session.powderParams.find((x) => x.id === r.id)?.value, r.id).toBe(r.value);
  });

  it("stores the owner's window for banks 1–5 and none for bank 6; 4 → 5 → 4 by the chooser gives them exactly, values kept", () => {
    expect(session.rawData?.bankWindows).toEqual({
      "1": { min: 1250, max: 16400 }, "2": { min: 1400, max: 17600 }, "3": { min: 2000, max: 18500 }, "4": { min: 3000, max: 16000 }, "5": { min: 4000, max: 15300 },
    });
    const text = session.rawData!.text;
    // Every window lies inside its bank's data.
    for (const [bank, w] of Object.entries(session.rawData!.bankWindows!)) {
      const xs = parseGsasHistogramPattern(text, "x", "x", { radiation: { kind: "neutron-tof" }, bank: Number(bank) }).points.map((p) => p.x);
      expect(w.min, bank).toBeGreaterThanOrEqual(xs[0]!);
      expect(w.max, bank).toBeLessThanOrEqual(xs[xs.length - 1]!);
    }
    const toBank = (from: PowderPage, bank: number) => {
      const p = parseGsasHistogramPattern(text, "gata4se8-powder", `bank ${bank}`, { radiation: { kind: "neutron-tof" }, bank });
      return landData(from, withPattern(from, p, { name: session.rawData!.name, text, bank }), `Loaded data, bank ${bank}`, "chooser");
    };
    const to5 = toBank(page, 5);
    expect(to5.window).toEqual({ min: 4000, max: 15300 });
    expect(to5.label).toBe("Data bank 4 → 5, refinement values kept, bank 5's fit window");
    const back = toBank(to5.page, 4);
    expect(back.window).toEqual(demo.fitRange);
    expect(back.page.session.rawData?.bank).toBe(4);
    for (const r of session.powderParams.filter((x) => !followsInstrument(x))) expect(back.page.session.powderParams.find((x) => x.id === r.id)?.value, r.id).toBe(r.value);
    expect(toBank(page, 6).window).toBeNull();
  });

  it("opens on the saved refinement: Chebyshev 7, the spec's free rows, every row with a saved value", () => {
    expect(snapshotHolds(page)).toBe(true);
    expect(session.powderProfile.backgroundType).toBe("chebyshev");
    expect(session.backgroundTerms).toBe(7);
    expect(session.powderParams.map((p) => p.id).sort()).toEqual(Object.keys(demo.refinedParams).sort());
    expect(session.powderParams.filter((p) => !p.fixed && !p.expression).map((p) => p.id)).toEqual(BASE);
  });

  it("shows the recorded agreement on screen: wR 2.21 % over 1785 points in its window", () => {
    const curves = powderPageCurves(session, demo.fitRange).curves;
    // The owner's window, 3000–16000 µs (d 0.331–1.773 Å): above d 0.209 Å, where the file's profile stops giving a peak (THY-90), and below the two long-TOF peaks no phase explains.
    expect(demo.fitRange).toEqual({ min: 3000, max: 16000 });
    expect(observationsIn(curves, demo.fitRange, session)).toBe(1785);
    expect((100 * weightedR(session, curves, demo.fitRange)).toFixed(2)).toBe("2.21");
    // GoF over the nine rows the example opens with free (the refinement's own, with sixteen free, is 5.71: below).
    expect(curvesGoodnessOfFit(session, curves, demo.fitRange).toFixed(2)).toBe("5.70");
  });

  it("refined from where it opens, with the structure rows free, converges in place with no near-null direction", async () => {
    const free = withFixed(session, [...STRUCTURE].map((id) => ({ id, fixed: false })));
    const sp = sessionPort(free, demo.instrument, { instrumentOnPage: true });
    sp.port.setFitRange(demo.fitRange);
    await sp.port.refine();
    const r = sp.port.state().result!;
    expect(r.status).toBe("converged");
    expect(r.diagnostics?.svdZeroCount ?? 0).toBe(0);
    expect((100 * r.agreement.rWeighted!).toFixed(2)).toBe("2.21");
    expect(r.agreement.goodnessOfFit!.toFixed(2)).toBe("5.71");
    // Nothing moves by more than a tenth of its esd.
    for (const id of [...BASE, ...STRUCTURE]) {
      const esd = r.esd[id]!;
      expect(Math.abs(r.parameters[id]! - demo.refinedParams[id]!), id).toBeLessThan(0.1 * esd);
    }
    // a = 10.3760(1) Å; B = 8π²U for U Ga 0.0039(6), Ta 0.0043(2), Se1 0.0056(4), Se2 0.0050(4) Å².
    expect(r.parameters.cell_a!.toFixed(4)).toBe("10.3760");
    expect(r.esd.cell_a!).toBeLessThan(0.00015);
  }, 120_000);

  // The file's profile has a Lorentzian width, whose tail is drawn to ±8800 µs at the window's edge (3000 µs): more
  // than the edge's own time of flight. The list's margin is the peak's support without that tail (20 peak widths).
  // Before, no d ended such a support, the list started at the edge itself, and the line N = h² + k² + l² = 980
  // (d = a/√980, 0.33144 Å) dropped in and out of the model as a passed 10.3758 Å: a step of 230 in χ².
  it("lists the lines one peak support below its window, so χ² has no step where a line crosses the window's edge", () => {
    const applied = appliedPhases(session)[0]!;
    const r = reflectionRange(session.pattern, applied, demo.fitRange);
    expect(r.stop).toBe("window");
    expect(r.windowD).toBeCloseTo(0.33145, 5);
    expect(r.dMin).toBeGreaterThan(0.28);
    expect(r.dMin).toBeLessThan(0.30);
    const core = (d: number): { reach: number; drawn: number } => {
      const p = placePeaks(session.pattern, applied, [{ d, intensity: 1 }])[0]!;
      const t = p.tof!;
      return { reach: p.center + PEAK_WINDOW_FWHM * (2.3548 * t.sigma + t.gamma! + 1 / t.alpha + 1 / t.beta), drawn: PEAK_WINDOW_FWHM * p.fwhm };
    };
    // A line at the list's end reaches the edge with 20 widths (the end is rounded down on a 10⁻⁴ grid in ln d); one 1 % further does not.
    expect(core(r.dMin).reach).toBeGreaterThanOrEqual(demo.fitRange.min * (1 - 1e-4));
    expect(core(r.dMin * (1 + 1e-4)).reach).toBeGreaterThanOrEqual(demo.fitRange.min * (1 - 1e-9));
    expect(core(r.dMin * 0.99).reach).toBeLessThan(demo.fitRange.min);
    // The drawn Lorentzian tail is longer than the edge's time of flight: it does not set the list.
    expect(core(r.windowD).drawn).toBeGreaterThan(demo.fitRange.min);

    const sigma = session.pattern.points.map((p) => p.sigma ?? 0);
    const chi2 = (a: number): number => {
      const at = { ...session, powderParams: session.powderParams.map((p) => (p.id === "cell_a" ? { ...p, value: a } : p)) };
      const c = powderPageCurves(at, demo.fitRange).curves;
      let sum = 0;
      c.x.forEach((x, i) => {
        if (x < demo.fitRange.min || x > demo.fitRange.max || !(sigma[i]! > 0)) return;
        sum += ((c.yObs[i]! - c.yCalc[i]!) / sigma[i]!) ** 2;
      });
      return sum;
    };
    // χ² extrapolated to the crossing from each side (three points, 2·10⁻⁷ Å apart): the difference is the step.
    const stepAt = (a: number): number => {
      const h = 2e-7;
      const f = [-3, -2, -1, 1, 2, 3].map((k) => chi2(a + k * h));
      return 3 * f[3]! - 3 * f[4]! + f[5]! - (3 * f[2]! - 3 * f[1]! + f[0]!);
    };
    // Where the line N = 980 sits on the window's edge: none (it was 230).
    expect(Math.abs(stepAt(r.windowD * Math.sqrt(980)))).toBeLessThan(1e-3);
    // Where a line enters the list, 20 widths below the edge (the nearest such a), it enters with the far tail it has there.
    const a0 = session.powderParams.find((p) => p.id === "cell_a")!.value;
    const entering = generateReflections(applied.model.cell, applied.model.spaceGroup, r.dMin * 0.997, r.dMin * 1.003)
      .map((q) => r.dMin * Math.sqrt(q.h * q.h + q.k * q.k + q.l * q.l))
      .sort((p, q) => Math.abs(p - a0) - Math.abs(q - a0))[0]!;
    expect(Math.abs(entering - a0)).toBeLessThan(0.02);
    expect(Math.abs(stepAt(entering))).toBeLessThan(0.1);
  }, 120_000);
});

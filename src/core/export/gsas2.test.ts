import { describe, it, expect } from "vitest";
import { parseInstrumentParameters } from "@/parsers/instrument";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import { instrumentToInstprm, buildGpxScript, gsas2SampleTerms, GSAS2_NO_SIZE, GSAS2_CW_NO_SAMPLE_TERMS, type Gsas2SampleTerms } from "@/core/export/gsas2";

describe("instrumentToInstprm", () => {
  it("writes a TOF (PNT) file with the expected key set", () => {
    const tof: InstrumentParameters = { kind: "tof", difC: 22586.15, difA: -6.75, difB: -1.57, zero: 5.67 };
    const out = instrumentToInstprm(tof);
    expect(out.startsWith("#GSAS-II instrument parameter file; do not add/delete items!")).toBe(true);
    expect(out).toContain("Type:PNT");
    expect(out).toContain("difC:22586.15");
    expect(out).toContain("Zero:5.67");
    // Peak-shape keys must be present (GSAS-II forbids adding/deleting items).
    for (const k of ["alpha", "beta-0", "beta-1", "beta-q", "sig-0", "sig-1", "sig-2", "sig-q", "fltPath"]) {
      expect(out).toContain(`${k}:`);
    }
    expect(out).not.toContain("Lam:"); // TOF has no monochromatic wavelength
  });

  it("writes a CW X-ray (PXC) file with Polariz. and Source", () => {
    const cw: InstrumentParameters = { kind: "constantWavelength", radiationKind: "xray", wavelength: 0.1665, u: -46, v: 0, w: 1.2, polarization: 0.84 };
    const out = instrumentToInstprm(cw);
    expect(out).toContain("Type:PXC");
    expect(out).toContain("Lam:0.1665");
    expect(out).toContain("Polariz.:0.84");
    expect(out).toContain("Source:");
    // The model holds FWHM² (loader ×8 ln2); the file holds GSAS-II σ² again.
    const w = Number(out.match(/^W:(.*)$/m)![1]);
    expect(w).toBeCloseTo(1.2 / (8 * Math.log(2)), 10);
  });

  it("writes a lab tube's doublet as Lam1, Lam2 and I(L2)/I(L1), which the reader takes back", () => {
    const cw: InstrumentParameters = { kind: "constantWavelength", radiationKind: "xray", wavelength: 1.5405, polarization: 0.7, kAlpha2: { wavelength: 1.5443, ratio: 0.5 } };
    const out = instrumentToInstprm(cw);
    expect(out).toContain("Lam1:1.5405");
    expect(out).toContain("Lam2:1.5443");
    expect(out).toContain("I(L2)/I(L1):0.5");
    expect(out).not.toContain("Lam:");
    const back = parseInstrumentParameters(out);
    expect(back.kind === "constantWavelength" && back.kAlpha2).toEqual({ wavelength: 1.5443, ratio: 0.5 });
  });

  it("writes a CW neutron (PNC) file without X-ray-only keys", () => {
    const cw: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 1.5 };
    const out = instrumentToInstprm(cw);
    expect(out).toContain("Type:PNC");
    expect(out).toContain("Lam:1.5");
    expect(out).not.toContain("Polariz.");
    expect(out).not.toContain("Source:");
  });
});

describe("buildGpxScript", () => {
  it("emits a powder script with the verified scriptable API", () => {
    const py = buildGpxScript({
      gpxName: "MnO.gpx", cifFile: "MnO.cif", phaseName: "MnO",
      dataFile: "MnO.xye", instprmFile: "MnO.instprm", histogramKind: "powder",
    });
    expect(py).toContain("import GSASIIscriptable as G2sc");
    expect(py).toContain("G2sc.G2Project(newgpx='MnO.gpx')");
    expect(py).toContain("gpx.add_phase('MnO.cif', phasename='MnO', fmthint='CIF')");
    expect(py).toContain("gpx.add_powder_histogram('MnO.xye', 'MnO.instprm', phases=[phase])");
    expect(py).toContain("gpx.save()");
  });

  it("probes legacy flat-directory installs before giving up on the import", () => {
    const py = buildGpxScript({
      gpxName: "MnO.gpx", cifFile: "MnO.cif", phaseName: "MnO",
      dataFile: "MnO.xye", instprmFile: "MnO.instprm", histogramKind: "powder",
    });
    expect(py).toContain("from GSASII import GSASIIscriptable as G2sc");
    expect(py).toContain("os.environ.get('GSASII_HOME')");
    for (const probe of [
      "os.path.join(_home, 'gsas2full', 'GSASII')",
      "os.path.join(_home, 'g2full', 'GSAS-II')",
      "os.path.join(_home, 'gsas2main', 'GSAS-II')",
    ]) {
      expect(py).toContain(probe);
    }
    expect(py).toContain("sys.path.insert(0, _dir)");
    // The retry import comes after the probe, so the script still ends up
    // with G2sc bound when a legacy install is found.
    expect(py.indexOf("sys.path.insert(0, _dir)")).toBeLessThan(py.lastIndexOf("import GSASIIscriptable as G2sc"));
  });

  it("emits a single-crystal script using add_single_histogram", () => {
    const py = buildGpxScript({
      gpxName: "Eu324.gpx", cifFile: "Eu324.cif", phaseName: "Eu3In2Te4",
      dataFile: "Eu324.hkl", histogramKind: "single", dataFmthint: "HKLF",
    });
    expect(py).toContain("gpx.add_single_histogram('Eu324.hkl', phase=phase, fmthint='HKLF')");
    expect(py).not.toContain("add_powder_histogram");
  });
});

describe("GSAS-II sample terms in build_gpx.py", () => {
  const base = {
    gpxName: "CeO2.gpx", cifFile: "CeO2.cif", phaseName: "CeO2",
    dataFile: "CeO2.xye", instprmFile: "CeO2.instprm", histogramKind: "powder",
  } as const;
  const twoMore = [{ cifFile: "a.cif", phaseName: "a" }, { cifFile: "b.cif", phaseName: "b" }];

  it("constant wavelength: Mustrain 0, LGmix 1 and Size GSAS2_NO_SIZE, written explicitly for every phase", () => {
    expect(GSAS2_CW_NO_SAMPLE_TERMS).toEqual({ mustrain: 0, mustrainMix: 1, size: GSAS2_NO_SIZE });
    const py = buildGpxScript({ ...base, extraPhases: twoMore, sample: GSAS2_CW_NO_SAMPLE_TERMS, sampleOff: true });
    // One loop over all three phases, after the histogram exists and before the save.
    expect(py).toContain([
      "for _phase in (phase, phase2, phase3,):",
      "    _hap = _phase.data['Histograms'][hist.name]",
      "    _hap['Mustrain'][0] = 'isotropic'",
      "    _hap['Mustrain'][1][0] = _hap['Mustrain'][1][1] = 0",
      "    _hap['Mustrain'][1][2] = 1",
      "    _hap['Size'][0] = 'isotropic'",
      `    _hap['Size'][1][0] = _hap['Size'][1][1] = ${GSAS2_NO_SIZE}`,
      "    _hap['Size'][1][2] = 1.0",
      "",
      "gpx.save()",
    ].join("\n"));
    expect(py.indexOf("add_powder_histogram")).toBeLessThan(py.indexOf("_hap['Size']"));
    expect(py).toContain("# In MATERIA's constant-wavelength fit the Lorentzian X and Y hold the instrument's width and the sample's");
    expect(py).not.toContain("The sample's broadening as MATERIA used it");
  });

  it("time of flight: the block is the one written before, byte for byte", () => {
    const py = buildGpxScript({ ...base, sample: { mustrain: 1477.41003, mustrainMix: 0.2030580502, size: 0.4 } });
    expect(py).toContain([
      "",
      "# The sample's broadening as MATERIA used it, in GSAS-II's own parameters: Mustrain (x 1e-6) with its",
      "# Lorentzian fraction, and Size (um, Lorentzian). GSAS-II adds these to the instrument's widths.",
      "for _phase in (phase,):",
      "    _hap = _phase.data['Histograms'][hist.name]",
      "    _hap['Mustrain'][0] = 'isotropic'",
      "    _hap['Mustrain'][1][0] = _hap['Mustrain'][1][1] = 1477.41003",
      "    _hap['Mustrain'][1][2] = 0.2030580502",
      "    _hap['Size'][0] = 'isotropic'",
      "    _hap['Size'][1][0] = _hap['Size'][1][1] = 0.4",
      "    _hap['Size'][1][2] = 1.0",
      "",
      "gpx.save()",
    ].join("\n"));
    expect(py).not.toContain("constant-wavelength");
  });

  it("without sample terms, and on a single crystal, the script sets none", () => {
    expect(buildGpxScript(base)).not.toMatch(/Mustrain|Size/);
    const sc = buildGpxScript({ ...base, histogramKind: "single", sample: GSAS2_CW_NO_SAMPLE_TERMS, sampleOff: true });
    expect(sc).not.toMatch(/Mustrain|Size/);
  });

  it("GSAS2_NO_SIZE is finite, and its constant-wavelength width is far below GSAS-II's own floor", () => {
    expect(Number.isFinite(GSAS2_NO_SIZE)).toBe(true);
    expect(GSAS2_NO_SIZE).toBe(1e6);
    // GSAS-II (GetSampleSigGam): 1.8·λ/(π·Size·cosθ) centidegrees. Its floor on a peak's γ is 0.001 centidegree.
    const width = (lam: number, twoTheta: number): number => (1.8 * lam) / (Math.PI * GSAS2_NO_SIZE * Math.cos((twoTheta / 2) * (Math.PI / 180)));
    expect(width(1.5406, 90)).toBeCloseTo(1.248e-6, 9); // centidegrees: 1.2·10⁻⁸°
    expect(width(2.5, 160)).toBeLessThan(0.001 / 100); // below 10⁻⁷°, a hundredth of the floor
    // Against GSAS-II's default for a new phase (1 µm): a million times smaller.
    expect(width(1.5406, 90) * GSAS2_NO_SIZE).toBeCloseTo((1.8 * 1.5406) / (Math.PI * Math.SQRT1_2), 12);
  });

  it("never writes a Size of 0: a size that is not finite, absent or not positive goes out as GSAS2_NO_SIZE", () => {
    // py() prints a number that is not finite as 0.0, and GSAS-II divides by Size.
    for (const size of [Infinity, -Infinity, NaN, 0, -2]) {
      expect(gsas2SampleTerms({ gauss: 0, lorentz: 300, size }).size, String(size)).toBe(GSAS2_NO_SIZE);
    }
    expect(gsas2SampleTerms({ gauss: 0, lorentz: 300 }).size).toBe(GSAS2_NO_SIZE);
    expect(gsas2SampleTerms({ gauss: 0, lorentz: 300, size: 0.4 }).size).toBe(0.4);
    const py = buildGpxScript({ ...base, sample: gsas2SampleTerms({ gauss: 0, lorentz: 300, size: Infinity }) });
    expect(py).toContain(`_hap['Size'][1][0] = _hap['Size'][1][1] = ${GSAS2_NO_SIZE}`);
    expect(py).not.toMatch(/_hap\['Size'\]\[1\]\[0\] = _hap\['Size'\]\[1\]\[1\] = 0(\.0)?\n/);
  });

  it("refuses to write sample terms GSAS-II cannot hold, instead of printing them as 0.0", () => {
    const ok: Gsas2SampleTerms = { mustrain: 300, mustrainMix: 1, size: 0.4 };
    const script = (s: Gsas2SampleTerms, sampleOff = false): string => buildGpxScript({ ...base, sample: s, ...(sampleOff ? { sampleOff } : {}) });
    expect(() => script(ok)).not.toThrow();
    for (const size of [Infinity, -Infinity, NaN, 0, -1]) {
      expect(() => script({ ...ok, size }), `Size ${size}`).toThrow(/Size/);
      expect(() => script({ ...GSAS2_CW_NO_SAMPLE_TERMS, size }, true), `CW Size ${size}`).toThrow(/Size/);
    }
    for (const mustrain of [Infinity, NaN, -1]) expect(() => script({ ...ok, mustrain }), `Mustrain ${mustrain}`).toThrow(/Mustrain/);
    for (const mustrainMix of [Infinity, NaN, -0.1, 1.1]) expect(() => script({ ...ok, mustrainMix }), `mix ${mustrainMix}`).toThrow(/Lorentzian fraction/);
  });
});

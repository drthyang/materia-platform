import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern, SingleCrystalDataset } from "@/core/diffraction/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import { parseSymmetryOperation } from "@/core/crystal/symmetry";
import { powderDataXye, singleCrystalHkl, singleCrystalInt } from "@/core/export/data";
import { fullprofBundle, gsas2Bundle, refinementBundle } from "@/core/export/bundle";
import { zipStore } from "@/core/export/zip";
import { GSAS2_NO_SIZE } from "@/core/export/gsas2";

const structure: StructureModel = {
  id: "t", name: "MnO",
  cell: { a: 4.445, b: 4.445, c: 4.445, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: { hermannMauguin: "F m -3 m", operations: [parseSymmetryOperation("x,y,z")] },
  sites: [{ label: "Mn1", element: "Mn", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } }],
};
const powder: PowderPattern = {
  id: "p", name: "MnO", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 1.5 },
  points: [{ x: 10, yObs: 100 }, { x: 10.05, yObs: 120, sigma: 11 }, { x: 10.1, yObs: 90 }],
};
const single: SingleCrystalDataset = {
  id: "s", name: "MnO", radiation: { kind: "neutron", wavelength: 1.0 },
  reflections: [{ h: 1, k: 1, l: 1, iObs: 250.5, sigma: 5.1 }, { h: 2, k: 0, l: 0, iObs: 88.2, sigma: 3.0 }],
};
const names = (e: { name: string }[]) => e.map((x) => x.name);

describe("data writers", () => {
  it("powder XYE has three columns per point", () => {
    const rows = powderDataXye(powder).trim().split("\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.split(/\s+/)).toHaveLength(3);
    expect(rows[1]).toBe("10.05 120 11"); // supplied sigma preserved
  });

  it("HKLF4 is fixed-width and 000-terminated", () => {
    const hkl = singleCrystalHkl(single).trimEnd().split("\n");
    expect(hkl[0]).toBe("   1   1   1  250.50    5.10");
    expect(hkl[hkl.length - 1]).toBe("   0   0   0    0.00    0.00");
  });

  it("FullProf .int carries the Crystal header + wavelength", () => {
    const int = singleCrystalInt(single).split("\n");
    expect(int[0]).toBe("Crystal");
    expect(int[1]).toBe("(3i4,2f10.3,i4)"); // float columns sized to the data, cod column
    expect(int[2]).toBe("1.0000 0 0");
  });
});

describe("fullprofBundle", () => {
  it("powder → .pcr + .dat + README", () => {
    expect(names(fullprofBundle(structure, powder))).toEqual(["MnO.pcr", "MnO.dat", "README.txt"]);
  });
  it("single crystal → .pcr + .int + README", () => {
    expect(names(fullprofBundle(structure, single))).toEqual(["MnO.pcr", "MnO.int", "README.txt"]);
  });
});

describe("gsas2Bundle", () => {
  it("powder → cif + xye + instprm + build_gpx.py + README", () => {
    const e = gsas2Bundle(structure, powder);
    expect(names(e)).toEqual(["MnO.cif", "MnO.xye", "MnO.instprm", "build_gpx.py", "README.txt"]);
    const script = e.find((x) => x.name === "build_gpx.py")!.data as string;
    expect(script).toContain("gpx.add_powder_histogram('MnO.xye', 'MnO.instprm', phases=[phase])");
    expect(e.find((x) => x.name === "MnO.instprm")!.data).toContain("Type:PNC"); // CW neutron
  });

  it("single crystal → cif + hkl + build_gpx.py + README (no instprm)", () => {
    const e = gsas2Bundle(structure, single);
    expect(names(e)).toEqual(["MnO.cif", "MnO.hkl", "build_gpx.py", "README.txt"]);
    expect((e.find((x) => x.name === "build_gpx.py")!.data as string)).toContain("add_single_histogram('MnO.hkl'");
  });

  it("the assembled bundle zips into a valid archive", () => {
    const zip = zipStore(gsas2Bundle(structure, powder, { name: "My Sample" }));
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50); // valid zip
    // Name sanitized (space → underscore).
    expect(new TextDecoder().decode(zip)).toContain("My_Sample.cif");
  });
});

describe("verbatim original files", () => {
  const rawInstprm = { name: "powgen.instprm", text: "#GSAS-II instrument parameter file\nType:PNT\ndifC:22585.8\n" };
  const rawData = { name: "PG3_600K.dat", text: "XYDATA\n# Mantid\n3389.2 48.5 2.9\n" };

  it("GSAS-II uses the user's .instprm verbatim instead of regenerating it", () => {
    const e = gsas2Bundle(structure, powder, { rawInstrument: rawInstprm, rawData });
    expect(names(e)).toContain("powgen.instprm");
    expect(names(e)).not.toContain("MnO.instprm"); // not regenerated
    expect(e.find((x) => x.name === "powgen.instprm")!.data).toBe(rawInstprm.text); // byte-for-byte
    // build_gpx.py points at the verbatim instrument, and the original data ships too.
    expect((e.find((x) => x.name === "build_gpx.py")!.data as string)).toContain("'powgen.instprm'");
    expect(names(e)).toContain("PG3_600K.dat");
    expect(e.find((x) => x.name === "PG3_600K.dat")!.data).toBe(rawData.text);
  });

  it("a non-.instprm instrument file is shipped verbatim but not adopted as the instprm", () => {
    const irf = { name: "d1b.irf", text: "! FullProf resolution\nD2TOF ...\n" };
    const e = gsas2Bundle(structure, powder, { rawInstrument: irf });
    expect(names(e)).toContain("MnO.instprm"); // still generated
    expect(names(e)).toContain("d1b.irf"); // original shipped for reference
  });

  it("FullProf ships the verbatim originals alongside the generated .pcr + .dat", () => {
    const e = fullprofBundle(structure, powder, { rawInstrument: rawInstprm, rawData });
    expect(names(e)).toEqual(expect.arrayContaining(["MnO.pcr", "MnO.dat", "powgen.instprm", "PG3_600K.dat", "README.txt"]));
    expect(e.find((x) => x.name === "PG3_600K.dat")!.data).toBe(rawData.text);
  });

  it("a raw file colliding with a generated name is renamed, not clobbered", () => {
    const collide = { name: "MnO.dat", text: "verbatim original\n" };
    const e = fullprofBundle(structure, powder, { rawData: collide });
    const dat = e.filter((x) => x.name.endsWith(".dat"));
    expect(dat.map((x) => x.name)).toEqual(["MnO.dat", "original_MnO.dat"]);
    // Generated MnO.dat is the portable XYE, the verbatim keeps its content.
    expect(e.find((x) => x.name === "original_MnO.dat")!.data).toBe(collide.text);
  });
});

describe("FullProf TOF peak-shape carries the refined profile", () => {
  const tofPowder: PowderPattern = {
    id: "p", name: "MnO", xUnit: "tof", radiation: { kind: "neutron-tof" },
    points: [{ x: 14300, yObs: 100 }, { x: 20000, yObs: 120, sigma: 11 }, { x: 30000, yObs: 90 }],
  };
  const instrument = { kind: "tof", difC: 22585.8 } as const;
  const param = (id: string, value: number): RefinementParameter =>
    ({ id, label: id, kind: "tofProfile", value, initialValue: value, fixed: false });

  it("writes the refined tof_* coefficients into the .pcr Sig/alph/beta rows", () => {
    const params: RefinementParameter[] = [
      param("tof_sig0", 8.0), param("tof_sig1", 512.3), param("tof_alpha1", 1.9), param("tof_beta0", 0.028),
    ];
    const e = fullprofBundle(structure, tofPowder, { instrument, params });
    const pcr = (e.find((x) => x.name === "MnO.pcr")!.data as string).split("\n");
    const sig = pcr[pcr.findIndex((l) => l.includes("sigma^2 = Sig-2")) + 1]!.trim().split(/\s+/).map(Number);
    expect(sig[1]).toBeCloseTo(512.3, 3); // Sig-1 = refined value, not a seed
    expect(sig[2]).toBeCloseTo(8.0, 3); // Sig-0
    const bb = pcr[pcr.findIndex((l) => l.includes("alpha = alph0 + alph1/d")) + 1]!.trim().split(/\s+/).map(Number);
    expect(bb[3]).toBeCloseTo(0.028, 4); // beta0
    expect(bb[4]).toBeCloseTo(1.9, 4); // alph1
  });

  it("folds a refined isotropic TOF Mustrain into Sig-1", () => {
    // ε = 3000 µstrain → σ_T² adds (difC·ε)²·d² = (22585.8·3e-3)² to Sig-1.
    const params: RefinementParameter[] = [
      { id: "mustrainIso", label: "mustrain", kind: "mustrainIso", value: 3000, initialValue: 0, fixed: false },
    ];
    const e = fullprofBundle(structure, tofPowder, { instrument, params });
    const pcr = (e.find((x) => x.name === "MnO.pcr")!.data as string).split("\n");
    const sig = pcr[pcr.findIndex((l) => l.includes("sigma^2 = Sig-2")) + 1]!.trim().split(/\s+/).map(Number);
    expect(sig[1]).toBeCloseTo((22585.8 * 3000e-6) ** 2, 1);
  });
});

describe("refinementBundle", () => {
  // The loaded model says a = 4.445 Å, B = 0.5; the fit moved them. The bundlers
  // write whatever the structure holds, so the refined values must be applied
  // first — exporting the as-loaded structure (the old app behavior) shipped the
  // starting model with the refined esds attached.
  const params: RefinementParameter[] = [
    { id: "cell_a", label: "a", kind: "cellLength", value: 4.4512, initialValue: 4.445, fixed: false, esd: 0.0003 },
    { id: "B_Mn1", label: "B", kind: "bIso", value: 0.83, initialValue: 0.5, fixed: false, esd: 0.02 },
    { id: "other_a", label: "a", kind: "cellLength", value: 9.9, initialValue: 9.0, fixed: false },
  ];
  const bindings: ParameterBinding[] = [
    ...(["a", "b", "c"] as const).map((k) => ({ parameterId: "cell_a", kind: "cellLength" as const, targetId: "t", targetKey: k })),
    { parameterId: "B_Mn1", kind: "bIso", targetId: "t", targetKey: "Mn1" },
    // A second phase's cell, bound by the same key: must never reach this phase.
    ...(["a", "b", "c"] as const).map((k) => ({ parameterId: "other_a", kind: "cellLength" as const, targetId: "other", targetKey: k })),
  ];

  it("writes the refined structure, with esds, in both programs' files", () => {
    const opts = { params, bindings, otherPhaseIds: ["other"] };
    const pcr = refinementBundle("fullprof", structure, powder, opts).find((x) => x.name === "MnO.pcr")!.data as string;
    expect(pcr).toMatch(/4\.4512/);
    expect(pcr).not.toMatch(/4\.4450/);
    const cif = refinementBundle("gsas2", structure, powder, opts).find((x) => x.name === "MnO.cif")!.data as string;
    expect(cif).toMatch(/_cell_length_a\s+4\.4512\(3\)/);
    expect(cif).toMatch(/Mn1 Mn .* Uiso 0\.0105\(3\)/); // B = 0.83 Å² as U = B/8π²
    expect(cif).not.toMatch(/9\.9/);
  });
});

describe("GSAS-II bundle: constant-wavelength sample terms are written off", () => {
  // MATERIA's CW Lorentzian width is X/cosθ + Y·tanθ alone, so the refined X, Y hold the fit's whole width.
  // GSAS-II adds each phase's Size and Mustrain (a new phase: 1 µm and 1000), so every CW bundle sets them
  // to none. Checked against GSAS-II itself: with these lines its per-reflection widths are the fit's.
  const file = (e: { name: string; data: string | Uint8Array }[], name: string): string => e.find((x) => x.name === name)!.data as string;
  const second: StructureModel = { ...structure, id: "u", name: "NiO", cell: { ...structure.cell, a: 4.177, b: 4.177, c: 4.177 } };
  const third: StructureModel = { ...structure, id: "v", name: "CoO", cell: { ...structure.cell, a: 4.26, b: 4.26, c: 4.26 } };
  const xy: RefinementParameter[] = [
    { id: "profX", label: "X", kind: "profileX", value: 3.5, initialValue: 1, fixed: false },
    { id: "profY", label: "Y", kind: "profileY", value: 7.25, initialValue: 0, fixed: false },
  ];
  const xyBindings: ParameterBinding[] = [
    { parameterId: "profX", kind: "profileX", targetId: "p" },
    { parameterId: "profY", kind: "profileY", targetId: "p" },
  ];
  const cwInstprm = { name: "hb2a.instprm", text: "#GSAS-II instrument parameter file\nType:PNC\nBank:1.0\nLam:1.5\nZero:0.0\nU:100.0\nV:-50.0\nW:200.0\nX:1.5\nY:2.5\nZ:0.0\nSH/L:0.002\nAzimuth:0.0\n" };
  const xray: PowderPattern = { ...powder, radiation: { kind: "xray", wavelength: 1.5406 } };
  const block = (phaseVars: string): string => [
    "",
    "# In MATERIA's constant-wavelength fit the Lorentzian X and Y hold the instrument's width and the sample's",
    "# isotropic size and microstrain together, and they are in the .instprm. GSAS-II adds each phase's Size",
    "# and Mustrain to X and Y (a new phase starts at Size 1 um and Mustrain 1000), so both are set to none",
    "# here: Mustrain 0, and a Size of 1e6 um, whose width 1.8*lambda/(pi*Size*cos(theta)) is",
    "# 5.7e-9*lambda/cos(theta) degrees (lambda in A).",
    `for _phase in (${phaseVars},):`,
    "    _hap = _phase.data['Histograms'][hist.name]",
    "    _hap['Mustrain'][0] = 'isotropic'",
    "    _hap['Mustrain'][1][0] = _hap['Mustrain'][1][1] = 0",
    "    _hap['Mustrain'][1][2] = 1",
    "    _hap['Size'][0] = 'isotropic'",
    `    _hap['Size'][1][0] = _hap['Size'][1][1] = ${GSAS2_NO_SIZE}`,
    "    _hap['Size'][1][2] = 1.0",
    "",
  ].join("\n");

  const cwBundles: readonly [string, () => ReturnType<typeof gsas2Bundle>, string][] = [
    ["no profile rows at all", () => gsas2Bundle(structure, powder), "phase"],
    ["X-ray, no profile rows", () => gsas2Bundle(structure, xray), "phase"],
    ["a refinement without X, Y rows", () => refinementBundle("gsas2", structure, powder, { params: [], bindings: [] }), "phase"],
    ["refined X and Y", () => refinementBundle("gsas2", structure, powder, { params: xy, bindings: xyBindings }), "phase"],
    ["the user's .instprm, patched", () => refinementBundle("gsas2", structure, powder, { params: xy, bindings: xyBindings, rawInstrument: cwInstprm }), "phase"],
    ["the user's .instprm, verbatim", () => gsas2Bundle(structure, powder, { rawInstrument: cwInstprm }), "phase"],
    ["two phases", () => refinementBundle("gsas2", structure, powder, { params: xy, bindings: xyBindings, phases: [second] }), "phase, phase2"],
    ["three phases", () => refinementBundle("gsas2", structure, powder, { params: [], bindings: [], phases: [second, third] }), "phase, phase2, phase3"],
  ];
  for (const [what, make, phaseVars] of cwBundles) {
    it(`${what}: Mustrain 0, LGmix 1, Size GSAS2_NO_SIZE on every phase`, () => {
      const e = make();
      const script = file(e, "build_gpx.py");
      expect(script).toContain(block(phaseVars));
      // Once, after the histogram (whose HAP entries it edits) and before the save.
      expect(script.match(/_hap\['Size'\]\[1\]\[0\]/g)).toHaveLength(1);
      expect(script.indexOf("add_powder_histogram")).toBeLessThan(script.indexOf("for _phase in"));
      expect(script.indexOf("for _phase in")).toBeLessThan(script.indexOf("gpx.save()"));
      const readme = file(e, "README.txt");
      expect(readme).toMatch(/Sample broadening: in this constant-wavelength fit, X and Y of \S+\.instprm hold the whole Lorentzian\nwidth, instrument and sample together\./);
      expect(readme).toContain("a new\nphase starts at Size 1 um and Mustrain 1000");
      expect(readme).toContain(`Mustrain to 0 (LGmix 1) and its Size to ${GSAS2_NO_SIZE} um`);
      expect(readme).toContain("An import through the GUI (Option B) starts from GSAS-II's defaults instead: set Mustrain to 0 there.");
    });
  }

  it("the refined X and Y go into the .instprm unchanged: only the script and the README carry the fix", () => {
    const e = refinementBundle("gsas2", structure, powder, { params: xy, bindings: xyBindings });
    const instprm = file(e, "MnO.instprm");
    expect(instprm).toContain("\nX:3.5\n");
    expect(instprm).toContain("\nY:7.25\n");
  });

  it("a uniaxial size or microstrain model is named as the width X and Y do not hold", () => {
    const uni = (perp: "anisoSizePerp" | "mustrainPerp", par: "anisoSizePar" | "mustrainPar"): string => {
      const params: RefinementParameter[] = [
        ...xy,
        { id: "perp", label: "perp", kind: perp, value: 2, initialValue: 2, fixed: false },
        { id: "par", label: "par", kind: par, value: 4, initialValue: 2, fixed: false },
      ];
      const bindings: ParameterBinding[] = [
        ...xyBindings,
        { parameterId: "perp", kind: perp, targetId: "p" },
        { parameterId: "par", kind: par, targetId: "p", axis: [0, 0, 1] },
      ];
      return file(refinementBundle("gsas2", structure, powder, { params, bindings }), "README.txt");
    };
    const size = uni("anisoSizePerp", "anisoSizePar");
    expect(size).toContain("width, instrument and sample together (but for the fit's uniaxial crystallite size, not carried: see below). GSAS-II adds");
    expect(size).toContain("Not carried by these files (re-add in GSAS-II if needed): uniaxial crystallite size.");
    const strain = uni("mustrainPerp", "mustrainPar");
    expect(strain).toContain("(but for the fit's uniaxial microstrain, not carried: see below)");
    // Without one, the sentence is plain.
    expect(file(refinementBundle("gsas2", structure, powder, { params: xy, bindings: xyBindings }), "README.txt"))
      .toContain("width, instrument and sample together. GSAS-II adds each phase's Size and Mustrain to X and Y");
  });

  it("the README gives what GSAS-II's largest typed Size (10 um) still adds at the bundle's wavelength", () => {
    // 1.8·λ/(π·10) centidegrees per 1/cosθ: 0.0859 at 1.5 Å, 0.0883 at 1.5406 Å.
    expect(file(gsas2Bundle(structure, powder), "README.txt")).toContain("which still adds 0.0859/cos(theta) centidegrees");
    expect(file(gsas2Bundle(structure, xray), "README.txt")).toContain("which still adds 0.0883/cos(theta) centidegrees");
  });

  it("time of flight and single crystal are untouched: no constant-wavelength lines", () => {
    const tofPowder: PowderPattern = {
      id: "p", name: "MnO", xUnit: "tof", radiation: { kind: "neutron-tof" },
      points: [{ x: 14300, yObs: 100 }, { x: 20000, yObs: 120, sigma: 11 }, { x: 30000, yObs: 90 }],
    };
    for (const e of [
      gsas2Bundle(structure, tofPowder, { instrument: { kind: "tof", difC: 22585.8 } }),
      refinementBundle("gsas2", structure, tofPowder, { params: [], bindings: [], phases: [second], instrument: { kind: "tof", difC: 22585.8 } }),
      gsas2Bundle(structure, single),
    ]) {
      expect(file(e, "build_gpx.py")).not.toMatch(/Mustrain|Size|constant-wavelength/);
      expect(file(e, "README.txt")).not.toMatch(/Sample broadening|constant-wavelength/);
    }
  });
});

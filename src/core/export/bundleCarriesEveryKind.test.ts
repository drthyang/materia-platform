/**
 * The cross-check bundles must carry every refined value they claim to
 * (`EXPORTED_KINDS`), or name it as not carried. The guard changes one bound
 * value at a time and checks that each program's files change with it; a kind
 * whose value moves nothing in a bundle must be named in that bundle's README.
 * This caught the GSAS-II bundle dropping the March–Dollase texture.
 */
import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { PowderPattern, SingleCrystalDataset } from "@/core/diffraction/types";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { ParameterBinding, ParameterKind, RefinementParameter } from "@/core/refinement/types";
import type { ZipEntry } from "@/core/export/zip";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { gsas2Bundle, refinementBundle, EXPORTED_KINDS, KIND_NAMES, type BundleTarget } from "@/core/export/bundle";

const lamno3: StructureModel = {
  id: "lmo", name: "LaMnO3",
  cell: { a: 5.7497, b: 7.6693, c: 5.537, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: buildSpaceGroup(62),
  sites: [
    { label: "La", element: "La", position: [0.05114, 0.25, -0.00822], occupancy: 1, adp: { kind: "isotropic", bIso: 0.08 } },
    { label: "Mn", element: "Mn", position: [0, 0, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
    { label: "O1", element: "O", position: [0.48752, 0.25, 0.07646], occupancy: 1, adp: { kind: "isotropic", bIso: 0.62 } },
    { label: "O2", element: "O", position: [0.30902, 0.03969, 0.72512], occupancy: 1, adp: { kind: "isotropic", bIso: 0.62 } },
  ],
};
const impurity: StructureModel = {
  id: "imp", name: "MnO",
  cell: { a: 4.445, b: 4.445, c: 4.445, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: buildSpaceGroup(225),
  sites: [
    { label: "Mn1", element: "Mn", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
    { label: "O1", element: "O", position: [0.5, 0.5, 0.5], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
  ],
};
const cwPattern: PowderPattern = {
  id: "pat", name: "lmo", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.597 },
  points: Array.from({ length: 200 }, (_, i) => ({ x: 5 + i * 0.75, yObs: 100 + (i % 7) })),
};
const tofPattern: PowderPattern = {
  id: "pat", name: "lmo", xUnit: "tof", radiation: { kind: "neutron-tof" },
  points: Array.from({ length: 200 }, (_, i) => ({ x: 5000 + i * 100, yObs: 100 + (i % 7) })),
};
const tofInstrument: InstrumentParameters = { kind: "tof", difC: 5000 };

const text = (e: ZipEntry[], name: string): string => e.find((x) => x.name === name)!.data as string;
const files = (e: ZipEntry[]): string =>
  e.filter((x) => x.name !== "README.txt").map((x) => `${x.name}\n${x.data as string}`).join("\n");

describe("GSAS-II bundle carries the preferred orientation", () => {
  const params: RefinementParameter[] = [
    { id: "po", label: "MD ratio", kind: "poRatio", value: 0.8125, initialValue: 1, min: 0.2, max: 5, fixed: false },
  ];
  const bindings: ParameterBinding[] = [{ parameterId: "po", kind: "poRatio", targetId: "pat", axis: [1, 1, 0] }];

  it("writes GSAS-II's 'MD' HAP entry with the refined ratio and axis, and lists them in the README", () => {
    const e = refinementBundle("gsas2", lamno3, cwPattern, { params, bindings });
    const py = text(e, "build_gpx.py");
    expect(py).toContain("_po = phase.data['Histograms'][hist.name]['Pref.Ori.']");
    expect(py).toContain("_po[0], _po[1], _po[2], _po[3] = 'MD', 0.8125, False, [1, 1, 0]");
    // Set after the histogram exists (its HAP entry is made by add_powder_histogram), before the save.
    expect(py.indexOf("add_powder_histogram")).toBeLessThan(py.indexOf("['Pref.Ori.']"));
    expect(py.indexOf("['Pref.Ori.']")).toBeLessThan(py.indexOf("gpx.save()"));
    const readme = text(e, "README.txt");
    expect(readme).toContain("LaMnO3: ratio 0.8125 on the reciprocal-lattice axis [1 1 0].");
    expect(readme).not.toContain("Not carried by these files");
  });

  it("sets it on the textured phase only in a multi-phase bundle", () => {
    const e = refinementBundle("gsas2", lamno3, cwPattern, { params, bindings, phases: [impurity] });
    const py = text(e, "build_gpx.py");
    expect(py.match(/\['Pref\.Ori\.'\]/g)).toHaveLength(1);
    expect(py).toContain("_po = phase.data['Histograms']");
    expect(py).not.toContain("_po = phase2.data");
  });

  it("matches the FullProf bundle's Pref1 and Pr1-3", () => {
    const pcr = text(refinementBundle("fullprof", lamno3, cwPattern, { params, bindings }), "LaMnO3.pcr");
    expect(pcr).toMatch(/^\s+0\.81250\s/m);
    expect(pcr).toMatch(/Pr1\s+Pr2\s+Pr3/);
  });

  it("a single-crystal bundle names it as not carried (GSAS-II's HKLF histogram has no texture)", () => {
    const single: SingleCrystalDataset = {
      id: "s", name: "lmo", radiation: { kind: "neutron", wavelength: 1.0 },
      reflections: [{ h: 1, k: 1, l: 1, iObs: 250.5, sigma: 5.1 }, { h: 2, k: 0, l: 0, iObs: 88.2, sigma: 3.0 }],
    };
    const e = gsas2Bundle(lamno3, single, { primary: { po: { axis: [0, 0, 1], ratio: 0.9 } } });
    expect(text(e, "build_gpx.py")).not.toContain("Pref.Ori.");
    const readme = text(e, "README.txt");
    expect(readme).toContain("Not carried by these files (re-add in GSAS-II if needed): preferred orientation.");
    expect(readme).not.toContain("Preferred orientation:");
  });

  it("an untextured model's script has no preferred-orientation lines", () => {
    const e = refinementBundle("gsas2", lamno3, cwPattern, { params: [], bindings: [] });
    expect(text(e, "build_gpx.py")).not.toContain("Pref.Ori.");
    expect(text(e, "README.txt")).not.toContain("Preferred orientation");
  });
});

/** One kind's binding, in the context (CW or TOF) where a fit binds it. */
interface KindCase {
  readonly tof?: boolean;
  /** Bindings the kind needs beside it (held at fixed values). */
  readonly base?: readonly { readonly kind: ParameterKind; readonly value: number; readonly binding: Omit<ParameterBinding, "parameterId" | "kind"> }[];
  readonly binding: Omit<ParameterBinding, "parameterId" | "kind">;
  /** Two values whose bundles must differ. */
  readonly values: readonly [number, number];
}
const onPattern = { targetId: "pat" };
const tofBase: KindCase["base"] = [
  { kind: "tofCalibration", value: 5000, binding: { targetId: "pat", targetKey: "difC" } },
  { kind: "tofProfile", value: 30, binding: { targetId: "pat", targetKey: "sig1" } },
];
const tofFileBase: KindCase["base"] = [
  { kind: "tofCalibration", value: 5000, binding: { targetId: "pat", targetKey: "difC" } },
  { kind: "tofFileProfile", value: 30, binding: { targetId: "pat", targetKey: "sig1" } },
  { kind: "tofFileProfile", value: 2, binding: { targetId: "pat", targetKey: "gamX" } },
];
const CASES: Partial<Record<ParameterKind, KindCase>> = {
  scale: { binding: onPattern, values: [3, 7] },
  background: { binding: { targetId: "pat", targetKey: "0" }, values: [40, 90] },
  cellLength: { binding: { targetId: "lmo", targetKey: "a" }, values: [5.71, 5.79] },
  cellAngle: { binding: { targetId: "lmo", targetKey: "beta" }, values: [90.5, 91.5] },
  atomX: { binding: { targetId: "lmo", targetKey: "O2" }, values: [0.301, 0.317] },
  atomY: { binding: { targetId: "lmo", targetKey: "O2" }, values: [0.031, 0.047] },
  atomZ: { binding: { targetId: "lmo", targetKey: "O2" }, values: [0.717, 0.733] },
  positionShift: { binding: { targetId: "lmo", targetKey: "O2", axis: [1, 0, 0] }, values: [0.004, 0.012] },
  occupancy: { binding: { targetId: "lmo", targetKey: "O2" }, values: [0.9, 0.8] },
  bIso: { binding: { targetId: "lmo", targetKey: "O2" }, values: [0.7, 1.1] },
  uAniso: { binding: { targetId: "lmo", targetKey: "O2", uBasis: [1, 0, 0, 0, 0, 0] }, values: [0.008, 0.014] },
  peakWidth: { binding: onPattern, values: [0.3, 0.5] },
  profileU: { binding: onPattern, values: [100, 300] },
  profileV: { binding: onPattern, values: [-50, -150] },
  profileW: { binding: onPattern, values: [400, 700] },
  profileX: { binding: onPattern, values: [1.5, 3.5] },
  profileY: { binding: onPattern, values: [2.5, 4.5] },
  asymSL: { binding: onPattern, values: [0.01, 0.03] },
  asymHL: { binding: onPattern, values: [0.01, 0.03] },
  zeroShift: { binding: onPattern, values: [0.05, -0.05] },
  poRatio: { binding: { targetId: "pat", axis: [0, 0, 1] }, values: [0.8, 1.25] },
  tofCalibration: { tof: true, base: [tofBase[1]!], binding: { targetId: "pat", targetKey: "difC" }, values: [5000, 5010] },
  tofProfile: { tof: true, base: [tofBase[0]!], binding: { targetId: "pat", targetKey: "sig1" }, values: [30, 60] },
  mustrainIso: { tof: true, base: tofBase, binding: onPattern, values: [500, 1500] },
  tofFileProfile: { tof: true, base: [tofFileBase[0]!, tofFileBase[2]!], binding: { targetId: "pat", targetKey: "sig1" }, values: [30, 60] },
  tofSampleGauss: { tof: true, base: tofFileBase, binding: onPattern, values: [300, 900] },
  tofSampleLorentz: { tof: true, base: tofFileBase, binding: onPattern, values: [300, 900] },
  tofSampleSize: { tof: true, base: tofFileBase, binding: onPattern, values: [0.5, 2] },
};

/** Values a bundle's README names as not transferred outside its "Not carried" line. */
const DOCUMENTED_ELSEWHERE: Partial<Record<BundleTarget, Partial<Record<ParameterKind, string>>>> = {
  // GSAS-II's scale has its own units; the README says to refine it first.
  gsas2: { scale: "Refine first in GSAS-II: the histogram scale / phase fractions (not transferred)." },
};

function bundleWith(target: BundleTarget, kind: ParameterKind, c: KindCase, value: number): ZipEntry[] {
  const all = [...(c.base ?? []), { kind, value, binding: c.binding }];
  const params: RefinementParameter[] = all.map((b, i) => ({ id: `p${i}`, label: `p${i}`, kind: b.kind, value: b.value, initialValue: b.value, fixed: false }));
  const bindings = all.map((b, i) => ({ ...b.binding, parameterId: `p${i}`, kind: b.kind }) as ParameterBinding);
  return refinementBundle(target, lamno3, c.tof ? tofPattern : cwPattern, {
    params, bindings, ...(c.tof ? { instrument: tofInstrument } : {}),
  });
}

describe("every kind the bundles claim to carry is written by both, or named as not carried", () => {
  it("the guard covers exactly EXPORTED_KINDS", () => {
    expect(Object.keys(CASES).sort()).toEqual([...EXPORTED_KINDS].sort());
  });

  for (const target of ["fullprof", "gsas2"] as const) {
    for (const kind of EXPORTED_KINDS) {
      it(`${target}: ${kind}`, () => {
        const c = CASES[kind];
        expect(c, `no guard case for ${kind}`).toBeDefined();
        const a = bundleWith(target, kind, c!, c!.values[0]);
        const b = bundleWith(target, kind, c!, c!.values[1]);
        if (files(a) !== files(b)) return; // written
        const readme = text(a, "README.txt");
        const elsewhere = DOCUMENTED_ELSEWHERE[target]?.[kind];
        if (elsewhere) {
          expect(readme).toContain(elsewhere);
          return;
        }
        const notCarried = readme.split("\n").find((l) => l.startsWith("Not carried by"));
        expect(notCarried, `${target} drops ${kind} silently`).toBeDefined();
        expect(notCarried).toContain(KIND_NAMES[kind] ?? kind);
      });
    }
  }
});

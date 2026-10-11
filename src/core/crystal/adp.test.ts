import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import {
  EIGHT_PI_SQUARED,
  bIsoFromUAniso,
  toAnisotropic,
  toIsotropic,
  uIsoFromBIso,
  withAdpModel,
  isPositiveDefiniteU,
  uEquivalent,
} from "@/core/crystal/adp";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { buildStructureRefinement } from "@/core/workflow/structureRefinement";
import type { PowderPattern } from "@/core/diffraction/types";

describe("B_iso ↔ U_iso conversion", () => {
  it("uses U_iso = B_iso / 8π²", () => {
    expect(uIsoFromBIso(EIGHT_PI_SQUARED)).toBeCloseTo(1, 12);
    expect(uIsoFromBIso(0.5)).toBeCloseTo(0.5 / (8 * Math.PI ** 2), 12);
  });
  it("round-trips B → spherical U → B via the equivalent isotropic U", () => {
    const b = 0.83;
    const aniso = toAnisotropic({ kind: "isotropic", bIso: b });
    expect(aniso.kind).toBe("anisotropic");
    if (aniso.kind === "anisotropic") {
      const u = uIsoFromBIso(b);
      expect(aniso.uAniso).toEqual([u, u, u, 0, 0, 0]);
      expect(bIsoFromUAniso(aniso.uAniso)).toBeCloseTo(b, 12);
    }
  });
  it("seeds the sphere of the cell, U^ij = U·cos(a*_i, a*_j), and returns it as its U_eq", () => {
    const u = uIsoFromBIso(0.5);
    // Hexagonal (γ* = 60°): the sphere has U12 = U/2.
    const hex = { a: 4.7613, b: 4.7613, c: 12.9846, alpha: 90, beta: 90, gamma: 120 };
    const h = toAnisotropic({ kind: "isotropic", bIso: 0.5 }, hex);
    if (h.kind !== "anisotropic") throw new Error("not anisotropic");
    expect(h.uAniso.map((x) => x / u)).toEqual([1, 1, 1, expect.closeTo(0.5, 12), 0, 0]);
    expect(uEquivalent(h.uAniso, hex)).toBeCloseTo(u, 14);
    // Triclinic: every off-diagonal, and the round trip holds.
    const tri = { a: 6, b: 7, c: 8, alpha: 88, beta: 95, gamma: 101 };
    const t = toAnisotropic({ kind: "isotropic", bIso: 0.5 }, tri);
    if (t.kind !== "anisotropic") throw new Error("not anisotropic");
    expect(t.uAniso.slice(3).every((x) => Math.abs(x) > 1e-6)).toBe(true);
    const back = toIsotropic(t, tri);
    expect(back.kind === "isotropic" && back.bIso).toBeCloseTo(0.5, 12);
    // U_eq is not the trace/3 off orthogonal axes.
    const ellipsoid = [0.004, 0.006, 0.005, 0.001, 0.0005, -0.0004] as const;
    expect(Math.abs(uEquivalent(ellipsoid, tri) - uEquivalent(ellipsoid))).toBeGreaterThan(1e-5);
  });

  it("passes an already-anisotropic tensor through unchanged", () => {
    const adp = { kind: "anisotropic", uAniso: [0.01, 0.02, 0.015, 0.001, 0, -0.002] } as const;
    expect(toAnisotropic(adp)).toBe(adp);
  });
  it("demotes an anisotropic tensor to its equivalent B_iso (trace/3)", () => {
    const adp = { kind: "anisotropic", uAniso: [0.01, 0.02, 0.03, 0, 0, 0] } as const;
    const iso = toIsotropic(adp);
    expect(iso.kind).toBe("isotropic");
    if (iso.kind === "isotropic") expect(iso.bIso).toBeCloseTo(EIGHT_PI_SQUARED * 0.02, 12);
  });
});

describe("withAdpModel + refinement wiring", () => {
  const structure: StructureModel = {
    id: "t",
    name: "t",
    cell: { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: buildSpaceGroup(225), // Fm-3m: Wyckoff 4a at origin → cubic site symmetry
    sites: [{ label: "Na1", element: "Na", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.6 } }],
  };
  const pattern: PowderPattern = {
    id: "p", name: "p", xUnit: "twoTheta",
    radiation: { kind: "xray", wavelength: 1.54 }, wavelength: 1.54,
    points: Array.from({ length: 50 }, (_, i) => ({ x: 10 + i, yObs: 0 })),
  };

  it("promotes every site to anisotropic, seeding U from B_iso", () => {
    const promoted = withAdpModel(structure, "anisotropic");
    expect(promoted.sites[0]!.adp.kind).toBe("anisotropic");
    if (promoted.sites[0]!.adp.kind === "anisotropic") {
      const u = 0.6 / EIGHT_PI_SQUARED;
      expect(promoted.sites[0]!.adp.uAniso).toEqual([u, u, u, 0, 0, 0]);
    }
  });

  it("isotropic build emits a bIso row; anisotropic build emits symmetry-allowed U modes", () => {
    const iso = buildStructureRefinement(structure, pattern, { scale: 1 });
    expect(iso.params.filter((p) => p.kind === "bIso")).toHaveLength(1);
    expect(iso.params.filter((p) => p.kind === "uAniso")).toHaveLength(0);

    const promoted = withAdpModel(structure, "anisotropic");
    const ani = buildStructureRefinement(promoted, pattern, { scale: 1 });
    expect(ani.params.filter((p) => p.kind === "bIso")).toHaveLength(0);
    const uModes = ani.params.filter((p) => p.kind === "uAniso");
    // A cubic 4a site (m-3m) allows only the single isotropic U mode (U11=U22=U33).
    expect(uModes.length).toBe(1);
    // Its seed equals the promoted U_iso.
    expect(uModes[0]!.value).toBeCloseTo(0.6 / EIGHT_PI_SQUARED, 6);
  });
});

describe("isPositiveDefiniteU", () => {
  it("accepts a physical ellipsoid and rejects a non-positive-definite tensor", () => {
    expect(isPositiveDefiniteU([0.01, 0.012, 0.009, 0.002, -0.001, 0.0005])).toBe(true);
    expect(isPositiveDefiniteU([0.01, 0.01, 0.01, 0, 0, 0])).toBe(true);
    // A negative principal axis.
    expect(isPositiveDefiniteU([0.01, -0.002, 0.01, 0, 0, 0])).toBe(false);
    // Positive diagonal, but an off-diagonal larger than the axes allow.
    expect(isPositiveDefiniteU([0.01, 0.01, 0.01, 0.012, 0, 0])).toBe(false);
  });
});

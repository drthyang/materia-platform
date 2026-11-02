import { describe, it, expect } from "vitest";
import type { StructureModel, SymmetryOperation } from "@/core/crystal/types";
import type { Mat3, Vec3 } from "@/core/math/types";
import type { MagneticModel } from "@/core/magnetic/types";
import { parseCif } from "@/parsers/cif";
import { exampleStructure } from "@/examples/mn3ga";
import { MNO_CIF } from "@/examples/mn3gaPowgen";
import { applyOperation, centringOffsets } from "@/core/crystal/symmetry";
import { momentAnchorPosition, expandSpinField } from "@/core/crystal/cellExpansion";
import { dSpacing } from "@/core/crystal/unitCell";
import { determinant, inverse, mulMat, mulVec } from "@/core/math/mat3";
import { crystalComponentsToCartesian, perpendicularMoment, qCartesian } from "@/core/magnetic/moment";
import { magneticTable } from "@/core/scattering/magnetic";
import { magneticSubgroupLattice, latticeRepresentatives, latticeCandidateLabel, type LatticeCandidate } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { magneticStructureFactor, MAGNETIC_PREFACTOR } from "@/core/magnetic/structureFactor";
import { magneticSatellites } from "@/core/magnetic/satellites";
import { satelliteIntensities } from "@/core/magnetic/powderAverage";
import { magneticLines } from "@/core/magnetic/magneticLines";

/**
 * The powder intensity of a magnetic line is |F_M⊥|² summed over every member
 * of its family (THY-58). Three proofs, each on four structures (public or
 * synthetic): every orientation domain of a magnetic group gives the same
 * powder lines; a brute-force sum over every Q of the explicit magnetic
 * supercell (an independent code path: its own spin list, Q list, phase sum
 * and projection) gives the same intensity at every d; and a cubic
 * ferromagnet gives the textbook powder factor 2/3.
 */

const D_MIN = 1.0;
const D_MAX = 30;
/** Lines closer in d than this (relative) are one powder peak. */
const D_TOL = 1e-9;

/** The line intensities grouped by d (coincident families summed), sorted by d. */
function byD(lines: readonly { d: number; squared: number }[]): { d: number; squared: number }[] {
  const sorted = [...lines].sort((a, b) => a.d - b.d);
  const out: { d: number; squared: number }[] = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(l.d - last.d) <= D_TOL * l.d) last.squared += l.squared;
    else out.push({ d: l.d, squared: l.squared });
  }
  return out;
}

/** Two powder line lists agree: the same d's, and each d's intensity to `rel` (of itself, floored at `rel`·max). */
function expectSamePattern(a: { d: number; squared: number }[], b: { d: number; squared: number }[], rel = 1e-9): number {
  const max = Math.max(...a.map((x) => x.squared), ...b.map((x) => x.squared));
  const nonzero = (xs: { d: number; squared: number }[]) => xs.filter((x) => x.squared > rel * max);
  const na = nonzero(a);
  const nb = nonzero(b);
  expect(nb.map((x) => x.d.toFixed(7))).toEqual(na.map((x) => x.d.toFixed(7)));
  let worst = 0;
  for (let i = 0; i < na.length; i++) {
    const dev = Math.abs(na[i]!.squared - nb[i]!.squared) / Math.max(na[i]!.squared, rel * max);
    worst = Math.max(worst, dev);
  }
  expect(worst).toBeLessThan(rel);
  return worst;
}

// ── the four structures ────────────────────────────────────────────────────

interface Case {
  readonly name: string;
  readonly structure: StructureModel;
  readonly magnetic: MagneticModel;
  readonly candidate: LatticeCandidate;
}

/** A group of the lattice at k, by BNS number or by predicate; its moments at generic amplitudes. */
function caseOf(name: string, structure: StructureModel, k: Vec3, ions: string[], pick: (c: LatticeCandidate) => boolean): Case {
  const reps = latticeRepresentatives(magneticSubgroupLattice(structure.spaceGroup.operations, k));
  const options = { moment: 2, tieSameSite: false, tieEqualMagnitude: false, flippedUnits: [] };
  const candidate = reps.find((c) => pick(c) && buildMagneticModel(structure, k, ions, [...c.candidate.operations], options).params.length > 0);
  if (!candidate) throw new Error(`${name}: no such group`);
  const build = buildMagneticModel(structure, k, ions, [...candidate.candidate.operations], options);
  // Generic amplitudes, so no accidental equality hides a wrong member.
  const values = Object.fromEntries(build.params.map((p, i) => [p.id, p.expression ? p.value : [2.1, -1.3, 0.8, 1.7, -0.6, 1.1][i % 6]!]));
  return { name, structure, magnetic: applyMagneticMoments(build.magnetic, build.bindings, values), candidate };
}

/** Mn₃Ga with Mn exactly on 6h (x, 2x, ¼): the demo's CIF has y = 2x − 1.1·10⁻⁴, which leaves two codes free to pick different images 10⁻⁴ apart. */
const mn3ga = (): StructureModel => {
  const s = exampleStructure();
  return { ...s, sites: s.sites.map((x) => (x.label === "Mn1" ? { ...x, position: [x.position[0], 2 * x.position[0], 0.25] as Vec3 } : x)) };
};
const mno = (): StructureModel => parseCif(MNO_CIF, "mno");

const CASES: (() => Case)[] = [
  // The issue's case: Mn₃Ga's synthetic page (P6₃/mmc, k = (0, 0, ½)), P_c-3m1 (BNS 164.90), two domains.
  () => caseOf("Mn₃Ga P_c-3m1, k = (0, 0, ½)", mn3ga(), [0, 0, 0.5], ["Mn1"], (c) => c.settingMatch?.identity.bnsNumber === "164.90"),
  // k = 0: an orthorhombic group of the hexagonal parent (three domains, 120° apart), the 350 K structure's type.
  () => caseOf("Mn₃Ga k = 0, orthorhombic", mn3ga(), [0, 0, 0], ["Mn1"], (c) => c.domainCount === 3 && c.index === 6),
  // k ≠ 0 with four arms, an F-centred parent: MnO at L, a monoclinic group (moments in the (111) planes).
  () => caseOf("MnO, k = L, C_c2/c", mno(), [0.5, 0.5, 0.5], ["Mn1"], (c) => c.settingMatch?.identity.bnsNumber === "15.90"),
  // A two-arm k off the Laue-invariant lines (three arms of the star, ±k distinct), with sine amplitudes: a helix-type modulation.
  () => caseOf("Mn₃Ga, k = (⅕, 0, 0), two-arm", mn3ga(), [0.2, 0, 0], ["Mn1"], (c) => c.subgroupOrder === 2),
];

// ── domains: the structure carried by a parent operation ──────────────────

/** g⁻¹ for an operation of the parent. */
function inverseOp(g: SymmetryOperation): SymmetryOperation {
  const ri = inverse(g.rotation) as Mat3;
  const rounded = ri.map((row) => row.map((v) => Math.round(v))) as unknown as Mat3;
  const t = mulVec(rounded, g.translation);
  return { rotation: rounded, translation: [-t[0], -t[1], -t[2]], xyz: "" };
}

/** a∘b, translations kept exact (unwrapped): the true group element. */
function compose(a: SymmetryOperation, b: SymmetryOperation): SymmetryOperation {
  const rb = mulVec(a.rotation, b.translation);
  return {
    rotation: mulMat(a.rotation, b.rotation),
    translation: [rb[0] + a.translation[0], rb[1] + a.translation[1], rb[2] + a.translation[2]],
    xyz: "",
    timeReversal: ((a.timeReversal ?? 1) * (b.timeReversal ?? 1)) as 1 | -1,
  };
}

/** k·R⁻¹ (a row vector): the index of g·Q, and the domain's propagation vector. */
function carryIndex(g: SymmetryOperation, h: Vec3): Vec3 {
  const ri = inverseOp(g).rotation;
  return [0, 1, 2].map((j) => h[0] * ri[0][j]! + h[1] * ri[1][j]! + h[2] * ri[2][j]!) as unknown as Vec3;
}

/**
 * The domain g·D of a magnetic model: its operations g·m·g⁻¹ (exact elements),
 * its k carried to g·k, and each moment entry moved to g(anchor) with the
 * axial-vector moment det R·R·m. The operation list keeps the structure
 * factor's convention: an operation's centring offset carries the k-phase, so
 * its listed θ is its true θ times that phase (±1 at a self-conjugate k; a
 * two-arm k here only on a primitive parent, where every offset is zero).
 */
function domainOf(structure: StructureModel, magnetic: MagneticModel, g: SymmetryOperation): MagneticModel {
  const ops = magnetic.operations!;
  const k = magnetic.propagation[0]!;
  const offsets = centringOffsets(ops);
  /** e^{2πi k·v}, which must be ±1 here (a self-conjugate k, or a zero vector). */
  const chi = (kv: Vec3, v: Vec3): 1 | -1 => {
    const x = 2 * (kv[0] * v[0] + kv[1] * v[1] + kv[2] * v[2]);
    if (Math.abs(x - Math.round(x)) > 1e-9) throw new Error("a complex k-phase");
    return Math.round(x) % 2 === 0 ? 1 : -1;
  };
  const gi = inverseOp(g);
  const kNew = carryIndex(g, k);
  // Each operation's true θ (its listed θ times its offset's k-phase), carried to g·m·g⁻¹.
  const conj = ops.map((op, i) => ({ op: compose(g, compose(op, gi)), theta: (op.timeReversal ?? 1) * chi(k, offsets[i]!) }));
  // In the convention, a rotation's members are its representative (the smallest wrapped translation) plus a
  // centring offset c′ exactly. Each conjugate is moved by the lattice vector n that makes it so (θ times
  // e^{2πi k′·n}), and lists θ times e^{2πi k′·c′}.
  const wrap = (v: number): number => { const w = ((v % 1) + 1) % 1; return Math.abs(w - 1) < 1e-9 || Math.abs(w) < 1e-9 ? 0 : w; };
  const rotKey = (op: SymmetryOperation): string => op.rotation.map((r) => r.join(",")).join(";");
  const reps = new Map<string, Vec3>();
  for (const { op } of conj) {
    const key = rotKey(op);
    const w = op.translation.map(wrap) as unknown as Vec3;
    const cur = reps.get(key);
    const before = cur ? (() => { for (let j = 0; j < 3; j++) { const d = wrap(op.translation[j]!) - wrap(cur[j]!); if (Math.abs(d) > 1e-6) return d < 0; } return false; })() : true;
    if (before) reps.set(key, op.translation);
    void w;
  }
  const listed = conj.map(({ op, theta }) => {
    const tRep = reps.get(rotKey(op))!;
    const c = [0, 1, 2].map((j) => wrap(wrap(op.translation[j]!) - wrap(tRep[j]!))) as unknown as Vec3;
    const t: Vec3 = [tRep[0] + c[0], tRep[1] + c[1], tRep[2] + c[2]];
    const n: Vec3 = [t[0] - op.translation[0], t[1] - op.translation[1], t[2] - op.translation[2]];
    const thetaTrue = theta * chi(kNew, n);
    return { ...op, translation: t, timeReversal: (thetaTrue * chi(kNew, c)) as 1 | -1 };
  });
  const check = centringOffsets(listed);
  for (const [i, op] of listed.entries()) {
    const tRep = reps.get(rotKey(op))!;
    const c = [0, 1, 2].map((j) => wrap(op.translation[j]! - tRep[j]!));
    if (check[i]!.some((v, j) => Math.abs(v - c[j]!) > 1e-9)) throw new Error("a rotation's members do not share one listed θ");
  }
  const R = g.rotation;
  const det = determinant(R);
  const rot = (m: Vec3): Vec3 => {
    const v = mulVec(R, m);
    return [det * v[0], det * v[1], det * v[2]];
  };
  return {
    ...magnetic,
    propagation: [kNew],
    operations: listed,
    moments: magnetic.moments.map((m) => {
      if (m.frame !== "crystallographic") throw new Error("crystal-axis moments only");
      const site = structure.sites.find((s) => s.label === m.siteLabel)!;
      const anchor = momentAnchorPosition(structure.spaceGroup.operations, ops, site.position, m.orbitIndex, m.position);
      const { orbitIndex: _o, ...rest } = m;
      return {
        ...rest,
        position: applyOperation(g, anchor),
        components: rot(m.components),
        ...(m.sinComponents ? { sinComponents: rot(m.sinComponents) } : {}),
      };
    }),
  };
}

/** One operation per rotation of the parent: the orientations a domain can take. */
function parentRotations(structure: StructureModel): SymmetryOperation[] {
  const seen = new Set<string>();
  return structure.spaceGroup.operations.filter((op) => {
    const key = op.rotation.map((r) => r.join(",")).join(";");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe("every domain of a magnetic group gives the same powder lines (THY-58)", () => {
  for (const make of CASES) {
    const c = make();
    it(`${c.name} (${latticeCandidateLabel(c.candidate).symbol}): all ${parentRotations(c.structure).length} orientations`, () => {
      const base = byD(satelliteIntensities(c.structure, c.magnetic, D_MIN, D_MAX));
      expect(base.filter((x) => x.squared > 0).length).toBeGreaterThan(5);
      let distinctDomains = 0;
      let readAtOneMember = 0;
      const seen = new Set<string>();
      for (const g of parentRotations(c.structure)) {
        const dom = domainOf(c.structure, c.magnetic, g);
        // The domain is the structure carried by g: |F_M⊥|² at g·Q is the original's at Q, reflection by reflection.
        const k = c.magnetic.propagation[0]!;
        for (const s of magneticSatellites(c.structure.cell, c.structure.spaceGroup, k, 1.6, D_MAX)) {
          for (const m of s.members) {
            const a = magneticStructureFactor(c.structure, c.magnetic, m[0], m[1], m[2]).squared;
            const gq = carryIndex(g, m);
            const b = magneticStructureFactor(c.structure, dom, gq[0], gq[1], gq[2]).squared;
            expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(a, 1e-6));
          }
        }
        const lines = satelliteIntensities(c.structure, dom, D_MIN, D_MAX);
        expectSamePattern(base, byD(lines));
        // How the domains differ: the old reading (one member × the count) differs from one domain to another.
        const old = byD(lines.map((s) => ({ d: s.d, squared: s.multiplicity * magneticStructureFactor(c.structure, dom, s.h, s.k, s.l).squared })));
        const key = old.map((x) => x.squared.toPrecision(6)).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          distinctDomains++;
        }
        if (old.some((x, i) => Math.abs(x.squared - (base[i]?.squared ?? 0)) > 1e-6 * Math.max(x.squared, 1))) readAtOneMember++;
      }
      // The old reading gave the orientations different patterns; the sum gives them one.
      expect(distinctDomains).toBeGreaterThan(1);
      expect(readAtOneMember).toBeGreaterThan(0);
    }, 60000);
  }
});

// ── brute force: every Q of the explicit magnetic supercell ───────────────

/**
 * |F_M⊥|² at every reciprocal-lattice point of the explicit magnetic supercell
 * (the k = 0 description of the box `expandSpinField` writes, the one the mPDF
 * and the mCIF export use), per parent cell, grouped by d. Its own Q list, its
 * own phase sum, its own projection: nothing of the satellite enumerator, the
 * Laue families or the propagation-vector structure factor.
 */
function bruteForce(structure: StructureModel, magnetic: MagneticModel, dMin: number, dMax: number): { d: number; squared: number }[] {
  const box = expandSpinField(structure, magnetic);
  const [na, nb, nc] = box.n;
  const cells = na * nb * nc;
  const spins = box.atoms.filter((a) => a.moment).map((a) => {
    const site = a.site;
    const ff = magnetic.moments.find((m) => m.siteLabel === a.parentLabel)?.formFactorId ?? `${site.element}${site.oxidationState ?? 2}`;
    if (site.adp.kind !== "isotropic") throw new Error("isotropic ADPs only");
    return { r: site.position, m: crystalComponentsToCartesian(box.cell, a.moment!), occ: site.occupancy, ff, b: site.adp.bIso };
  });
  const lines: { d: number; squared: number }[] = [];
  const hMax = Math.floor(box.cell.a / dMin) + 1;
  const kMax = Math.floor(box.cell.b / dMin) + 1;
  const lMax = Math.floor(box.cell.c / dMin) + 1;
  for (let H = -hMax; H <= hMax; H++) for (let K = -kMax; K <= kMax; K++) for (let L = -lMax; L <= lMax; L++) {
    if (H === 0 && K === 0 && L === 0) continue;
    const d = dSpacing(box.cell, H, K, L);
    if (!(d >= dMin && d <= dMax)) continue;
    const q = qCartesian(box.cell, H, K, L);
    const s = 1 / (2 * d);
    let fx = [0, 0], fy = [0, 0], fz = [0, 0];
    for (const sp of spins) {
      const w = MAGNETIC_PREFACTOR * sp.occ * magneticTable.j0(sp.ff, s) * Math.exp(-sp.b * s * s) / cells;
      const mp = perpendicularMoment(sp.m, q);
      const ph = 2 * Math.PI * (H * sp.r[0] + K * sp.r[1] + L * sp.r[2]);
      const c = Math.cos(ph), sn = Math.sin(ph);
      fx = [fx[0]! + w * mp[0] * c, fx[1]! + w * mp[0] * sn];
      fy = [fy[0]! + w * mp[1] * c, fy[1]! + w * mp[1] * sn];
      fz = [fz[0]! + w * mp[2] * c, fz[1]! + w * mp[2] * sn];
    }
    const sq = fx[0]! ** 2 + fx[1]! ** 2 + fy[0]! ** 2 + fy[1]! ** 2 + fz[0]! ** 2 + fz[1]! ** 2;
    if (sq > 0) lines.push({ d, squared: sq });
  }
  return byD(lines);
}

describe("a brute-force sum over every Q matches the powder lines (THY-58)", () => {
  for (const make of CASES) {
    const c = make();
    it(`${c.name}`, () => {
      const forward = byD(satelliteIntensities(c.structure, c.magnetic, D_MIN, D_MAX));
      const brute = bruteForce(c.structure, c.magnetic, D_MIN, D_MAX);
      expect(forward.filter((x) => x.squared > 0).length).toBeGreaterThan(5);
      expectSamePattern(brute, forward);
    }, 60000);
  }
});

// ── the textbook check: a cubic ferromagnet ───────────────────────────────

describe("a cubic ferromagnet gives the powder factor 2/3 on every line", () => {
  it("bcc Fe with M ∥ c (I4/mm'm'): Σ over each family of |F_M⊥|² = ⅔ · n · |F_M|²", () => {
    const fe = parseCif(`data_fe
_cell_length_a 2.8665
_cell_length_b 2.8665
_cell_length_c 2.8665
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'I m -3 m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Fe1 Fe 0 0 0 1 0.35
`, "fe");
    const c = caseOf("bcc Fe", fe, [0, 0, 0], ["Fe1"], (x) => x.candidate.standard?.bnsNumber === "139.537" || latticeCandidateLabel(x).numbers?.startsWith("BNS 139.537") === true);
    // The group keeps one moment direction, along a cube axis.
    const m = crystalComponentsToCartesian(fe.cell, c.magnetic.moments[0]!.components);
    const axis = m.map((v) => Math.abs(v) > 1e-9).filter(Boolean).length;
    expect(axis).toBe(1);
    const lines = satelliteIntensities(fe, c.magnetic, 0.7, 10);
    expect(lines.length).toBeGreaterThan(8);
    for (const s of lines) {
      // |F_M|² with the full moment (no projection) at the line's |Q|: q̂ ⊥ M.
      const full = (() => {
        const sF = 1 / (2 * s.d);
        const occ = fe.sites[0]!.occupancy;
        const w = MAGNETIC_PREFACTOR * occ * magneticTable.j0("Fe2", sF) * Math.exp(-0.35 * sF * sF);
        const n = (s.h + s.k + s.l) % 2 === 0 ? 2 : 0; // the I-centred cell's two atoms
        return (w * n) ** 2 * (m[0] ** 2 + m[1] ** 2 + m[2] ** 2);
      })();
      expect(s.squared).toBeCloseTo((2 / 3) * s.multiplicity * full, 9);
    }
  });
});

// ── the tick rows and residual readings follow the powder lines ───────────

describe("magnetic lines read the family, not one member", () => {
  it("a line whose representative has no |F_M⊥|² still has a tick when its family scatters", () => {
    const c = CASES[1]!();
    const k: Vec3 = [0, 0, 0];
    const fam = magneticSatellites(c.structure.cell, c.structure.spaceGroup, k, D_MIN, D_MAX);
    const lines = magneticLines(c.structure, c.magnetic, D_MIN, D_MAX);
    const intensities = satelliteIntensities(c.structure, c.magnetic, D_MIN, D_MAX);
    const max = Math.max(...intensities.map((s) => s.squared / Math.max(s.multiplicity, 1)));
    for (const s of intensities) {
      const listed = lines.some((l) => l.h === s.h && l.k === s.k && l.l === s.l);
      expect(listed).toBe(s.squared / s.multiplicity > 1e-4 * max);
    }
    expect(fam.length).toBe(intensities.length);
  });
});

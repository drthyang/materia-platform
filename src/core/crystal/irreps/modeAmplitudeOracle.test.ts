/**
 * The mode-amplitude oracle (opt-in; ADR 0005): MATERIA's decomposition of a
 * supercell child (decompose.ts) against the ISOTROPY Suite's displacive
 * modes (H. T. Stokes, D. M. Hatch & B. J. Campbell, iso.byu.edu), which the
 * workflow .github/workflows/isotropy-oracle.yml downloads at run time; the
 * binary and its data are never committed. Runs only with ISOTROPY_ORACLE=1
 * and ISODATA set.
 *
 * Each case realises a child of the parent (the lattice route), moves every
 * site within its allowed shifts by fixed pseudo-random amounts, strains the
 * cell, and changes the labels and representatives as a CIF would, then hands
 * the result to decomposeChild. The reference amplitudes come from ISOTROPY
 * alone. For every irrep at the child's k-points and every parent Wyckoff
 * position, DISPLAY DISTORTION (SHOW MICROSCOPIC VECTOR, SHOW CARTESIAN, a
 * supercell that holds the child's lattice) lists the irrep's displacement
 * vectors at every atom of the cell, one per irrep component: the irrep's
 * whole isotypic subspace on that orbit. The child's displacement field,
 * written on the same atoms in the parent's unstrained metric, is projected
 * onto each subspace. The projection's norm over one primitive child cell is
 * ISODISTORT's A_s for that irrep on that site (ISODISTORT help: "the square
 * root of the sum of the squares of the mode-induced changes within the
 * primitive supercell"). It needs no basis or label: where an irrep has one
 * mode on a site, it is that mode's |A_s|.
 *
 * The comparison, site by site: the nonzero (irrep, site) amplitudes of both,
 * as sorted lists, within 1e-3 Å. The log pairs ISOTROPY's labels (R4+, M3+,
 * …) with MATERIA's generic ones by value.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { applyOperation } from "@/core/crystal/symmetry";
import { orthogonalizationMatrix } from "@/core/crystal/unitCell";
import { latticeCentring } from "@/core/crystal/standardSetting";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { realiseChild, type RealisedChild } from "@/core/crystal/irreps/realisation";
import { decomposeChild } from "@/core/crystal/irreps/decompose";
import { srtio3 } from "@/testSupport/perovskiteTilts";

const ISODATA = process.env.ISODATA ?? "";
const ENABLED = process.env.ISOTROPY_ORACLE === "1" && ISODATA !== "" && existsSync(resolve(ISODATA, "iso"));

function iso(commands: readonly string[]): string {
  return execFileSync(resolve(ISODATA, "iso"), [], { input: `${commands.join("\n")}\nQUIT\n`, env: { ...process.env, ISODATA: ISODATA.endsWith("/") ? ISODATA : `${ISODATA}/` }, encoding: "utf8", maxBuffer: 64 << 20 });
}

const mulMV = (m: readonly (readonly number[])[], v: readonly number[]): Vec3 => [
  m[0]![0]! * v[0]! + m[0]![1]! * v[1]! + m[0]![2]! * v[2]!,
  m[1]![0]! * v[0]! + m[1]![1]! * v[1]! + m[1]![2]! * v[2]!,
  m[2]![0]! * v[0]! + m[2]![1]! * v[1]! + m[2]![2]! * v[2]!,
];
const det3 = (m: readonly (readonly number[])[]): number =>
  m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
function inv3(m: readonly (readonly number[])[]): Mat3 {
  const d = det3(m);
  const c = (i: number, j: number): number => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    const minor = m[r[0]!]![s[0]!]! * m[r[1]!]![s[1]!]! - m[r[0]!]![s[1]!]! * m[r[1]!]![s[0]!]!;
    return (i + j) % 2 === 0 ? minor : -minor;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => c(j, i) / d)) as unknown as Mat3;
}

/** Deterministic pseudo-random numbers in [−1, 1]. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** ISOTROPY's irrep labels at a k-point (SHOW IRREP, DISPLAY IRREP). */
function irrepLabels(parent: number, kpoint: string): string[] {
  const out = iso(["PAGE NOBREAK", `VALUE PARENT ${parent}`, `VALUE KPOINT ${kpoint}`, "SHOW IRREP", "DISPLAY IRREP"]);
  const labels = [...out.matchAll(/^\**\s*([A-Z]{1,2}\d+[+-]?)\s*$/gm)].map((m) => m[1]!);
  if (labels.length === 0) console.log(`--- ISOTROPY irreps at ${kpoint}: none parsed ---\n${out}`);
  return [...new Set(labels)];
}

/** One block of DISPLAY DISTORTION: per atom, its position and one vector per irrep component. */
interface IsoBlock {
  readonly atoms: { readonly point: Vec3; readonly cartesianPoint: boolean; readonly vectors: Vec3[] }[];
}

/** A number as ISOTROPY writes it: an integer, a decimal or a fraction ("3/2"). */
const isoNumber = (t: string): number => {
  const [n, d] = t.split("/");
  return Number(n) / (d === undefined ? 1 : Number(d));
};

/**
 * DISPLAY DISTORTION with SHOW WYCKOFF, SHOW MICROSCOPIC VECTOR and SHOW
 * CARTESIAN: a line with a Wyckoff letter opens a block; a line with a
 * position and a vector opens an atom, and a line with a vector alone adds the
 * atom's next component (SHOW CARTESIAN writes one per line):
 *
 *     a       (0,0,0) (3.90500, 0.00000, 0.00000)
 *                     (0.00000, 3.90500, 0.00000)
 *
 * A position written with decimals is Cartesian (Å), one written with integers
 * and fractions is fractional (ISOTROPY keeps a Wyckoff position's point
 * fractional unless its free parameters are given); the vectors are Cartesian.
 */
function parseDistortion(out: string): IsoBlock[] {
  const blocks: IsoBlock[] = [];
  const num = "-?\\d+(?:\\.\\d+)?(?:/\\d+)?";
  const triple = new RegExp(`\\(\\s*(${num})\\s*,\\s*(${num})\\s*,\\s*(${num})\\s*\\)`, "g");
  for (const raw of out.split("\n")) {
    const line = raw.replace(/^\*+/, "");
    if (/Wyckoff|Projected/.test(line)) continue;
    const found = [...line.matchAll(triple)];
    if (found.length === 0) continue;
    const vecs = found.map((m) => [isoNumber(m[1]!), isoNumber(m[2]!), isoNumber(m[3]!)] as Vec3);
    if (found.length === 1) {
      // The atom's next component.
      const atoms = blocks[blocks.length - 1]?.atoms;
      if (!atoms || atoms.length === 0) throw new Error(`ISOTROPY output: a vector before any atom: ${line}`);
      atoms[atoms.length - 1]!.vectors.push(vecs[0]!);
      continue;
    }
    const head = line.slice(0, line.indexOf("(")).trim();
    if (/^[a-z]$/.test(head) || blocks.length === 0) blocks.push({ atoms: [] });
    blocks[blocks.length - 1]!.atoms.push({ point: vecs[0]!, cartesianPoint: found[0]![0].includes("."), vectors: vecs.slice(1) });
  }
  return blocks;
}

interface OracleCase {
  readonly name: string;
  readonly parent: StructureModel;
  readonly isoParent: number;
  /** ISOTROPY's Wyckoff letter of each parent site. */
  readonly wyckoff: Readonly<Record<string, string>>;
  /** ISOTROPY's labels of the k-points whose irreps the child can carry. */
  readonly kpoints: readonly string[];
  /** The supercell bound the child is found in; ISOTROPY lists the atoms of the same cell (columns, parent basis). */
  readonly bound: Mat3;
  readonly number: number;
  readonly pick: (r: RealisedChild) => boolean;
}

const NIAS: StructureModel = {
  id: "nias",
  name: "NiAs",
  cell: { a: 3.619, b: 3.619, c: 5.034, alpha: 90, beta: 90, gamma: 120 },
  spaceGroup: buildSpaceGroup(194),
  sites: [
    { label: "Ni", element: "Ni", position: [0, 0, 0], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
    { label: "As", element: "As", position: [1 / 3, 2 / 3, 0.25], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
  ],
};

const freeCoordinates = (r: RealisedChild): number => r.structure.sites.reduce((n, s) => n + allowedPositionShifts(r.structure.spaceGroup.operations, s.position).dimension, 0);

const CASES: readonly OracleCase[] = [
  {
    name: "SrTiO3 Pm-3m → R-3c (a⁻a⁻a⁻ type)",
    parent: srtio3(),
    isoParent: 221,
    wyckoff: { Sr: "a", Ti: "b", O: "c" },
    kpoints: ["GM", "X", "M", "R"],
    bound: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
    number: 167,
    pick: (r) => freeCoordinates(r) > 0,
  },
  {
    name: "SrTiO3 Pm-3m → Pnma (a⁻b⁺a⁻ type, Sr free)",
    parent: srtio3(),
    isoParent: 221,
    wyckoff: { Sr: "a", Ti: "b", O: "c" },
    kpoints: ["GM", "X", "M", "R"],
    bound: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
    number: 62,
    pick: (r) => freeCoordinates(r) === 7,
  },
  {
    name: "NiAs P6₃/mmc → Pnma (MnP type, M point)",
    parent: NIAS,
    isoParent: 194,
    wyckoff: { Ni: "a", As: "c" },
    kpoints: ["GM", "M"],
    bound: [[2, 0, 0], [0, 2, 0], [0, 0, 1]],
    number: 62,
    pick: (r) => freeCoordinates(r) === 4,
  },
];

describe.skipIf(!ENABLED)("ISOTROPY oracle: mode amplitudes of a decomposed supercell child", { timeout: 900_000 }, () => {
  for (const c of CASES) {
    it(c.name, () => {
      const parent = c.parent;
      const group = factorGroup(parent.spaceGroup.operations, c.bound);
      const found = supercellSubgroups(group, { maxIndex: 96 }).classes
        .filter((k) => k.identity?.number === c.number && k.cellMultiplying)
        .map((k) => realiseChild(parent, group, k.elements, k.identity))
        .find(c.pick);
      expect(found, `${c.name}: no class #${c.number} in the bound`).toBeDefined();
      const r = found!;
      const child = r.structure;
      const ops = child.spaceGroup.operations;
      // Every site moved within its allowed shifts by fixed pseudo-random amounts (up to 0.03 of an axis).
      const rnd = noise(4711 + 13 * c.number + parent.sites.length);
      const moves = new Map(child.sites.map((s) => {
        const d = [0, 0, 0];
        for (const v of allowedPositionShifts(ops, s.position).basis) {
          const x = 0.03 * rnd();
          for (let i = 0; i < 3; i++) d[i] = d[i]! + x * v[i]!;
        }
        return [s.label, [d[0]!, d[1]!, d[2]!] as Vec3] as const;
      }));
      // As a CIF would have it: relabelled, another orbit member as representative, a strained cell.
      const loaded: StructureModel = {
        ...child,
        id: "loaded",
        cell: { ...child.cell, a: child.cell.a * 1.006, b: child.cell.b * (Math.abs(child.cell.b - child.cell.a) < 1e-9 ? 1.006 : 0.996), c: child.cell.c * 0.995 },
        sites: child.sites.map((s, i) => {
          const x = s.position.map((v, k) => v + moves.get(s.label)![k]!) as unknown as Vec3;
          return { ...s, label: `${s.element}_${i + 1}`, position: applyOperation(ops[(5 * i + 2) % ops.length]!, x).map((v) => v - Math.floor(v)) as unknown as Vec3 };
        }),
      };
      const d = decomposeChild(parent, loaded);
      expect(d.residual).toBeLessThan(1e-9);

      // The child's displacement field on the atoms of ISOTROPY's cell: Cartesian, the parent's unstrained metric.
      const P = r.basis;
      const p = r.origin;
      const Pinv = inv3(P);
      const Mp = orthogonalizationMatrix(parent.cell);
      const Minv = inv3(Mp);
      const fieldAt = (X: Vec3): Vec3 => {
        const x = mulMV(Pinv, [X[0] - p[0], X[1] - p[1], X[2] - p[2]]);
        const at = r.atoms.find((t) => t.position.every((y, i) => Math.abs(y - x[i]! - Math.round(y - x[i]!)) < 1e-5));
        if (!at) throw new Error(`${c.name}: an atom of ISOTROPY's cell is no atom of the child`);
        return mulMV(Mp, mulMV(P, mulMV(ops[at.childOperation]!.rotation, moves.get(at.site)!)));
      };
      const B = c.bound;
      const Binv = inv3(B);
      const cellKey = (X: Vec3): string => mulMV(Binv, X).map((v) => Math.round((((v % 1) + 1) % 1) * 1e4) % 1e4).join(",");
      // Primitive child cells in ISOTROPY's cell: det B over the primitive child's volume (parent cells).
      const fChild = latticeCentring(ops).length;
      const primitiveCells = Math.abs(det3(B)) / (r.volumeRatio / fChild);
      const { a, b, c: cc, alpha, beta, gamma } = parent.cell;
      const cellArg = [0, 1, 2].map((j) => `${B[0][j]},${B[1][j]},${B[2][j]}`).join(" ");
      const theirs: { label: string; site: string; dim: number; as: number }[] = [];
      let subspaces = 0;
      for (const kp of c.kpoints) {
        const labels = irrepLabels(c.isoParent, kp);
        expect(labels.length, `${c.name}: irreps at ${kp}`).toBeGreaterThan(0);
        for (const label of labels) {
          for (const site of parent.sites) {
            const out = iso(["PAGE NOBREAK", `VALUE PARENT ${c.isoParent}`, `VALUE IRREP ${label}`, `VALUE WYCKOFF ${c.wyckoff[site.label]!.toUpperCase()}`, `VALUE CELL ${cellArg}`, `VALUE LATTICE PARAMETER ${a} ${b} ${cc} ${alpha} ${beta} ${gamma}`, "SHOW WYCKOFF", "SHOW MICROSCOPIC VECTOR", "SHOW CARTESIAN", "DISPLAY DISTORTION"]);
            const blocks = parseDistortion(out);
            if (blocks.length === 0) continue;
            if (subspaces === 0) console.log(`--- ${c.name}: ISOTROPY's DISPLAY DISTORTION for ${label} on ${site.label} ---\n${out}`);
            subspaces++;
            // The isotypic subspace: every component vector of every block, as a field on the cell's atoms.
            const points = new Map<string, Vec3>();
            const fields: Map<string, Vec3>[] = [];
            for (const blk of blocks) {
              for (let t = 0; t < blk.atoms[0]!.vectors.length; t++) {
                const f = new Map<string, Vec3>();
                for (const at of blk.atoms) {
                  const X = at.cartesianPoint ? mulMV(Minv, at.point) : at.point;
                  const k = cellKey(X);
                  points.set(k, X);
                  // SHOW CARTESIAN writes the vectors in Cartesian Å (x along a, y in the ab plane), whatever the positions.
                  f.set(k, at.vectors[t]!);
                }
                fields.push(f);
              }
            }
            const dot = (u: ReadonlyMap<string, Vec3>, v: ReadonlyMap<string, Vec3>): number => {
              let s = 0;
              for (const [k, x] of u) {
                const y = v.get(k);
                if (y) s += x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
              }
              return s;
            };
            const ortho: Map<string, Vec3>[] = [];
            for (const f of fields) {
              let w = new Map(f);
              for (const q of ortho) {
                const s = dot(w, q);
                w = new Map([...w].map(([k, x]) => [k, [x[0] - s * q.get(k)![0], x[1] - s * q.get(k)![1], x[2] - s * q.get(k)![2]] as Vec3]));
              }
              const n = Math.sqrt(dot(w, w));
              if (n > 1e-6) ortho.push(new Map([...w].map(([k, x]) => [k, [x[0] / n, x[1] / n, x[2] / n] as Vec3])));
            }
            const disp = new Map([...points].map(([k, X]) => [k, fieldAt(X)] as const));
            const inCell = Math.sqrt(ortho.reduce((t, q) => t + dot(disp, q) ** 2, 0));
            const as = inCell / Math.sqrt(primitiveCells);
            if (as > 1e-6) theirs.push({ label, site: site.label, dim: ortho.length, as });
          }
        }
      }
      // MATERIA's A_s per (irrep, site): its modes' amplitudes added in quadrature.
      const ours = new Map<string, { irrep: string; site: string; as: number }>();
      for (const m of d.set.modes) {
        const key = `${m.irrep!.label}|${m.irrep!.parentSite}`;
        const as = m.observedAmplitude / Math.sqrt(d.set.amplitudeCells!.child);
        const cur = ours.get(key);
        ours.set(key, { irrep: m.irrep!.label, site: m.irrep!.parentSite, as: Math.hypot(cur?.as ?? 0, as) });
      }
      const lines = [`--- ${c.name}: ${d.set.modes.length} modes; ISOTROPY ${subspaces} isotypic subspaces on the parent's sites, ${theirs.length} carrying the distortion ---`];
      const pairs: { site: string; o: { irrep: string; as: number }[]; t: { label: string; as: number }[] }[] = [];
      for (const site of parent.sites) {
        const t = theirs.filter((x) => x.site === site.label).sort((x, y) => x.as - y.as);
        const o = [...ours.values()].filter((x) => x.site === site.label && x.as > 1e-6).sort((x, y) => x.as - y.as);
        const n = Math.max(t.length, o.length);
        for (let i = 0; i < n; i++) lines.push(`${site.label}: ISOTROPY ${t[i]?.label ?? "—"} (subspace dim ${t[i]?.dim ?? "—"}) A_s = ${t[i]?.as.toFixed(6) ?? "—"} Å | MATERIA ${o[i]?.irrep ?? "—"} A_s = ${o[i]?.as.toFixed(6) ?? "—"} Å | diff ${o[i] && t[i] ? Math.abs(o[i]!.as - t[i]!.as).toExponential(2) : "—"}`);
        pairs.push({ site: site.label, o, t });
      }
      for (const m of d.set.modes) lines.push(`  MATERIA mode ${m.label}: A_s = ${(m.observedAmplitude / Math.sqrt(d.set.amplitudeCells!.child)).toFixed(6)} Å`);
      console.log(lines.join("\n"));
      for (const { site, o, t } of pairs) {
        expect(o.length, `${c.name}: irreps carrying amplitude on ${site}`).toBe(t.length);
        o.forEach((x, i) => expect(Math.abs(x.as - t[i]!.as), `${c.name}: ${site}, ${x.irrep} against ${t[i]!.label}`).toBeLessThan(1e-3));
      }
      expect(theirs.length).toBeGreaterThan(0);
    });
  }
});

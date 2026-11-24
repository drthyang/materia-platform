import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { MagneticModel } from "@/core/magnetic/types";
import type { Vec3 } from "@/core/math/types";
import { magneticStructureToMcif } from "@/core/export/cif";
import { parseMagneticCif } from "@/parsers/cif";
import { expandSpinField, magneticOrbitRepresentatives } from "@/core/crystal/cellExpansion";
import { expandStructureAtomsWithProvenance } from "@/core/diffraction/structureFactor";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { magneticSubgroupLattice, latticeRepresentatives, type LatticeCandidate } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { rotateUAniso } from "@/core/crystal/adp";
import { applyOperation } from "@/core/crystal/symmetry";
import { exampleStructure } from "@/examples/mn3ga";
import { mnwo4Structure } from "@/examples/mnwo4";

/**
 * A k = 0 mCIF must rebuild the whole structure from its OWN operations.
 *
 * The file's symmetry is the magnetic subgroup, which can split a parent orbit
 * into several orbits. Every one of them needs an atom-site row, whether or not
 * it carries a moment: a non-magnetic atom (Ga in Mn₃Ga, W and O in MnWO₄) or a
 * magnetic orbit whose moment the group forbids. Before the fix the writer only
 * added rows for split orbits that carry a moment, so any reader expanding the
 * file (MOTIF, FullProf, VESTA, ISOCIF, and MATERIA's own reader) built fewer
 * atoms than the model has.
 *
 * Gate: write the file with the real exporter, read it back with MATERIA's mCIF
 * reader, expand it by the file's operations, and compare atom by atom (element,
 * label, position, occupancy, ADP) and moment by moment with MATERIA's own
 * expansion of the model (parent operations; the 3D view's spin field).
 */

type Cell = StructureModel["cell"];
const wrap = (x: number): number => { const w = x - Math.floor(x); return w >= 1 - 1e-9 ? 0 : w; };
const norm = (v: readonly number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!);

interface Atom { label: string; element: string; frac: Vec3; occupancy: number; uIso?: number; uAniso?: readonly number[]; moment?: Vec3 }

/** Nuclear atoms (by the structure's own operations, ADPs rotated) with the moments of the spin field at the same positions. */
function atomsOf(structure: StructureModel, magnetic: MagneticModel | null): Atom[] {
  const { atoms, provenance } = expandStructureAtomsWithProvenance(structure);
  const spins = magnetic ? expandSpinField(structure, magnetic).atoms : [];
  return atoms.map((a, i) => {
    const frac = a.position.map(wrap) as unknown as Vec3;
    const spin = spins.find((s) => s.site.position.every((x, j) => Math.abs(((wrap(x) - frac[j]! + 0.5) % 1 + 1) % 1 - 0.5) < 1e-6));
    return {
      label: structure.sites[provenance[i]!.siteIndex]!.label,
      element: a.element,
      frac,
      occupancy: a.occupancy,
      ...(a.adp.kind === "isotropic" ? { uIso: a.adp.bIso / (8 * Math.PI * Math.PI) } : { uAniso: a.adp.uAniso }),
      ...(spin?.moment && norm(spin.moment) > 0 ? { moment: spin.moment as Vec3 } : {}),
    };
  });
}

/** Printed precision of the mCIF: coordinates 5 decimals, occupancy 4, U 5, moments 4. */
const tolPos = (c: Cell): number => 6e-6 * (c.a + c.b + c.c) + 3e-5; // Å
const TOL_OCC = 5e-5, TOL_U = 6e-6, TOL_MOMENT = 1.5e-4;

/** Every discrepancy between the model's expansion and the file's, as readable lines (empty = identical at printed precision). */
function compare(structure: StructureModel, magnetic: MagneticModel): string[] {
  const text = magneticStructureToMcif(structure, magnetic);
  const back = parseMagneticCif(text, "back");
  const truth = atomsOf(structure, magnetic);
  const read = atomsOf(back.structure, back.magnetic);
  const out: string[] = [];
  if (read.length !== truth.length) out.push(`atom count: model ${truth.length}, file ${read.length}`);
  const used = new Set<number>();
  const fmt = (v: readonly number[]): string => v.map((x) => x.toFixed(4)).join(", ");
  for (const t of truth) {
    let best = -1, bestD = Infinity;
    read.forEach((r, j) => {
      if (used.has(j)) return;
      const df = t.frac.map((x, i) => { const d = r.frac[i]! - x; return d - Math.round(d); }) as unknown as Vec3;
      const d = norm(fractionalToCartesian(structure.cell, df));
      if (d < bestD) { bestD = d; best = j; }
    });
    if (best < 0 || bestD > tolPos(structure.cell)) { out.push(`missing from file: ${t.label} ${t.element} (${fmt(t.frac)})`); continue; }
    used.add(best);
    const r = read[best]!;
    const where = `${t.label} (${fmt(t.frac)})`;
    if (r.element !== t.element) out.push(`${where}: element ${r.element} ≠ ${t.element}`);
    if (!(r.label === t.label || new RegExp(`^${t.label}_o\\d+$`).test(r.label))) out.push(`${where}: label ${r.label}`);
    if (Math.abs(r.occupancy - t.occupancy) > TOL_OCC) out.push(`${where}: occupancy ${r.occupancy} ≠ ${t.occupancy}`);
    if (t.uIso !== undefined && (r.uIso === undefined || Math.abs(r.uIso - t.uIso) > TOL_U)) out.push(`${where}: U_iso ${r.uIso} ≠ ${t.uIso}`);
    if (t.uAniso && (!r.uAniso || t.uAniso.some((u, i) => Math.abs(u - r.uAniso![i]!) > TOL_U))) out.push(`${where}: U_ani ${r.uAniso?.map((x) => x.toFixed(5))} ≠ ${t.uAniso.map((x) => x.toFixed(5))}`);
    if (t.moment || r.moment) {
      const dm = t.moment && r.moment ? norm(t.moment.map((x, i) => x - r.moment![i]!)) : norm((t.moment ?? r.moment)!);
      if (dm > TOL_MOMENT) out.push(`${where}: moment ${r.moment ? fmt(r.moment) : "none"} ≠ ${t.moment ? fmt(t.moment) : "none"}`);
    }
  }
  read.forEach((r, j) => { if (!used.has(j)) out.push(`extra in file: ${r.label} ${r.element} (${fmt(r.frac)})`); });
  return out;
}

const OPTIONS = { moment: 2, tieSameSite: false, tieEqualMagnitude: false, flippedUnits: [] };
const SEQ = [2.1, -1.3, 0.8, 1.7, -0.6, 1.1, 0.9, -1.9];

/** The model the app builds for a candidate group, with generic sign-mixed amplitudes so no accidental equality hides a wrong atom. */
function model(structure: StructureModel, ions: string[], cand: LatticeCandidate): { magnetic: MagneticModel; nParams: number } {
  const b = buildMagneticModel(structure, [0, 0, 0], ions, [...cand.candidate.operations], OPTIONS);
  const values = Object.fromEntries(b.params.map((p, i) => [p.id, p.expression ? p.value : SEQ[i % SEQ.length]!]));
  return { magnetic: applyMagneticMoments(b.magnetic, b.bindings, values), nParams: b.params.length };
}

function candidates(structure: StructureModel): LatticeCandidate[] {
  return latticeRepresentatives(magneticSubgroupLattice(structure.spaceGroup.operations, [0, 0, 0]));
}

/** Every k = 0 candidate: its failures, and which sites the group splits. */
function sweep(structure: StructureModel, ions: string[]) {
  return candidates(structure).map((c, i) => {
    const { magnetic, nParams } = model(structure, ions, c);
    const ops = magnetic.operations ?? structure.spaceGroup.operations;
    const orbits = Object.fromEntries(structure.sites.map((s) => [s.label, magneticOrbitRepresentatives(structure.spaceGroup.operations, ops, s.position).length]));
    const withMoment = (label: string): Set<number> => new Set(magnetic.moments.filter((m) => m.siteLabel === label).map((m) => m.orbitIndex ?? 1));
    return { name: `#${i + 1} ${c.candidate.label ?? ""}`, nParams, orbits, withMoment, failures: compare(structure, magnetic) };
  });
}

/** Mn₃Ga, P6₃/mmc, with Mn exactly on 6h (y = 2x) and Ga exactly at (1/3, 2/3, 3/4): the bundled CIF's rounded 0.3333 is a separate rounding effect. */
function mn3gaExact(): StructureModel {
  const s = exampleStructure();
  return {
    ...s,
    sites: s.sites.map((x) =>
      x.label === "Mn1" ? { ...x, position: [x.position[0], 2 * x.position[0], 0.25] as Vec3 }
      : x.element === "Ga" ? { ...x, position: [1 / 3, 2 / 3, x.position[2]] as Vec3 } : x),
  };
}

describe("k = 0 mCIF lists every orbit of the magnetic group (split orbits with no moment included)", () => {
  it("Mn₃Ga: every k = 0 magnetic group the app offers rebuilds all 8 atoms and every moment from the file", () => {
    const s = mn3gaExact();
    const rows = sweep(s, ["Mn1"]);
    // The 99 groups that allow a Mn moment (the k-search list), plus the ones that forbid it everywhere.
    expect(rows.filter((r) => r.nParams > 0)).toHaveLength(99);
    // The sweep covers both halves of the bug: a split non-magnetic orbit (Ga) and a magnetic orbit
    // split into a moment-carrying and a moment-forbidden part.
    expect(rows.some((r) => r.orbits.Ga1! > 1)).toBe(true);
    expect(rows.some((r) => r.orbits.Mn1! > 1 && r.withMoment("Mn1").size > 0 && r.withMoment("Mn1").size < r.orbits.Mn1!)).toBe(true);
    const failing = rows.filter((r) => r.failures.length > 0).map((r) => `${r.name}: ${r.failures.join("; ")}`);
    expect(failing).toEqual([]);
  });

  it("MnWO₄ (published, P2/c): W and O orbits split by the group are all written", () => {
    const s = mnwo4Structure();
    const rows = sweep(s, ["Mn1"]);
    expect(rows.some((r) => r.orbits.W1! > 1 && r.orbits.O1! > 1)).toBe(true);
    const failing = rows.filter((r) => r.failures.length > 0).map((r) => `${r.name}: ${r.failures.join("; ")}`);
    expect(failing).toEqual([]);
  });

  it("a moment-free split orbit gets an atom-site row and no moment row", () => {
    const s = mn3gaExact();
    const row = sweep(s, ["Mn1"]).find((r) => r.nParams > 0 && r.orbits.Ga1! > 1)!;
    const cand = candidates(s).find((c, i) => `#${i + 1} ${c.candidate.label ?? ""}` === row.name)!;
    const text = magneticStructureToMcif(s, model(s, ["Mn1"], cand).magnetic);
    expect(text).toMatch(/^ {2}Ga1_o2 Ga /m);
    const momentLoop = text.slice(text.indexOf("_atom_site_moment.label"));
    expect(momentLoop).not.toContain("Ga1");
  });
});

/**
 * Every site made anisotropic with a generic tensor obeying its site symmetry
 * (the average of R·U·Rᵀ over the parent operations that fix the site), so a
 * split-orbit row reached through a rotation shows whether its tensor rotated.
 * Components are multiples of 0.00012, so the average over a stabilizer of
 * order ≤ 12 is exact at the five decimals the file prints: a hexagonal
 * rotation mixes U11, U22 and U12 and would otherwise amplify print rounding.
 */
function anisotropic(structure: StructureModel): StructureModel {
  const U0 = [0.012, 0.018, 0.024, 0.0036, -0.0024, 0.0048] as const;
  return {
    ...structure,
    sites: structure.sites.map((site) => {
      const fixing = structure.spaceGroup.operations.filter((o) => applyOperation(o, site.position).every((x, i) => {
        const d = x - site.position[i]!;
        return Math.abs(d - Math.round(d)) < 1e-9;
      }));
      const sum = [0, 0, 0, 0, 0, 0];
      for (const o of fixing) rotateUAniso(U0, o.rotation).forEach((u, i) => { sum[i]! += u; });
      const u = sum.map((x) => x / fixing.length) as unknown as [number, number, number, number, number, number];
      return { ...site, adp: { kind: "anisotropic" as const, uAniso: u } };
    }),
  };
}

describe("k = 0 mCIF: a split-orbit row carries its ADP as seen by its orbit (U′ = R·U·Rᵀ)", () => {
  it("MnWO₄ with anisotropic ADPs: every k = 0 group rebuilds every tensor from the file", () => {
    const rows = sweep(anisotropic(mnwo4Structure()), ["Mn1"]);
    const failing = rows.filter((r) => r.failures.length > 0).map((r) => `${r.name}: ${r.failures.join("; ")}`);
    expect(failing).toEqual([]);
  });

  it("Mn₃Ga with anisotropic ADPs: every k = 0 group rebuilds every tensor from the file", () => {
    const rows = sweep(anisotropic(mn3gaExact()), ["Mn1"]);
    const failing = rows.filter((r) => r.failures.length > 0).map((r) => `${r.name}: ${r.failures.join("; ")}`);
    expect(failing).toEqual([]);
  });
});

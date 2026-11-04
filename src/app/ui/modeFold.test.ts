/**
 * The mode table folded by irrep (modeFold.ts), on SrTiO₃ → Pnma with every
 * mode at a non-zero amplitude: the folds, the contribution chart's shares
 * (A²/ΣA², the same for A_s and A_p, summing to 100 %), and the arrows of an
 * irrep drawn at once, which are the sum of its rows' arrows on every atom.
 */
import { describe, expect, it } from "vitest";
import type { PdfPattern } from "@/core/diffraction/types";
import type { RefinementParameter } from "@/core/refinement/types";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { allowedPositionShifts } from "@/core/crystal/siteConstraints";
import { buildCellAtoms } from "@/core/crystal/cellExpansion";
import { isodistortAmplitudes } from "@/core/crystal/distortionModes";
import { pageView, pdfPage, withSupercellChild } from "@/app/pdfPage";
import { arrowField, atomArrows, contributionShares, irrepFolds, largestShift, summedField } from "@/app/ui/modeFold";
import { srtio3 } from "@/testSupport/perovskiteTilts";

const PARENT = srtio3();
const group = factorGroup(PARENT.spaceGroup.operations, DEFAULT_SUPERCELL);
const lattice = supercellSubgroups(group, { maxIndex: 48 });
const pattern: PdfPattern = { id: "flat", name: "flat", scatteringType: "neutron", points: Array.from({ length: 60 }, (_, i) => ({ r: 1.5 + i * 0.1, gObs: 0 })), qdamp: 0.03 };
const page = pdfPage(PARENT, pattern, { preset: { fitRange: { min: 1.5, max: 7.4 } } });
const cls = lattice.classes.filter((c) => c.identity?.number === 62).map((c) => ({ c, r: realiseChild(PARENT, group, c.elements, c.identity) }))
  .find(({ r }) => r.structure.sites.length === 4 && r.structure.sites.filter((x) => allowedPositionShifts(r.structure.spaceGroup.operations, x.position).dimension > 0).length === 3)!.c;
const PNMA = withSupercellChild(page, { group, elements: cls.elements, identity: cls.identity! }).model;
const set = pageView(PNMA).modeSet!;
// Every mode at its own non-zero amplitude, some negative (the signs stay in the table).
const params: RefinementParameter[] = PNMA.params.map((p) => {
  const i = set.modes.findIndex((m) => m.id === p.id);
  return i < 0 ? p : { ...p, value: (i % 2 === 0 ? 1 : -1) * 0.01 * (i + 1) };
});
const value = (id: string): number => params.find((p) => p.id === id)!.value;
const cells = set.amplitudeCells!;

describe("folding by irrep", () => {
  it("makes one fold per irrep, in the set's order, holding exactly its modes", () => {
    const folds = irrepFolds(set.modes)!;
    const labels = [...new Set(set.modes.map((m) => m.irrep!.label))];
    expect(folds.map((f) => f.id)).toEqual(labels);
    for (const f of folds) expect(f.modes.map((m) => m.id)).toEqual(set.modes.filter((m) => m.irrep!.label === f.id).map((m) => m.id));
    expect(folds.flatMap((f) => f.modes).length).toBe(set.modes.length);
    expect(folds.some((f) => f.modes.length > 1)).toBe(true);
  });

  it("does not fold a set without irreps", () => {
    expect(irrepFolds(set.modes.map(({ irrep: _drop, ...m }) => m))).toBeNull();
  });
});

describe("the contribution chart", () => {
  const shares = contributionShares(set.modes, params);

  it("gives each irrep A²/ΣA², dominant first, summing to 100 %", () => {
    const total = set.modes.reduce((s, m) => s + value(m.id) ** 2, 0);
    expect(shares.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 12);
    for (const b of shares) {
      const a2 = set.modes.filter((m) => m.irrep!.label === b.id).reduce((s, m) => s + value(m.id) ** 2, 0);
      expect(b.a2).toBeCloseTo(a2, 14);
      expect(b.share).toBeCloseTo(a2 / total, 14);
      // Its parts (the per-site rows) split it.
      expect(b.parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(b.share, 14);
    }
    for (let i = 1; i < shares.length; i++) expect(shares[i - 1]!.a2).toBeGreaterThanOrEqual(shares[i]!.a2);
  });

  it("is the same share of A_s² and of A_p² (A over a fixed √cells)", () => {
    const of = (pick: "as" | "ap") => {
      const sq = (id: string) => isodistortAmplitudes(value(id), cells)[pick] ** 2;
      const total = set.modes.reduce((s, m) => s + sq(m.id), 0);
      return shares.map((b) => set.modes.filter((m) => m.irrep!.label === b.id).reduce((s, m) => s + sq(m.id), 0) / total);
    };
    for (const pick of ["as", "ap"] as const) of(pick).forEach((x, i) => expect(x).toBeCloseTo(shares[i]!.share, 12));
  });

  it("drops the signs: a mode flipped leaves its share", () => {
    const flipped = params.map((p) => (p.id === set.modes[0]!.id ? { ...p, value: -p.value } : p));
    expect(contributionShares(set.modes, flipped).map((b) => b.share)).toEqual(shares.map((b) => b.share));
  });

  it("gives no share while every amplitude is 0", () => {
    const zero = params.map((p) => (set.modes.some((m) => m.id === p.id) ? { ...p, value: 0 } : p));
    expect(contributionShares(set.modes, zero).every((b) => b.share === 0)).toBe(true);
  });
});

describe("an irrep's arrows all at once", () => {
  const atoms = buildCellAtoms(set.parentized);
  const multi = irrepFolds(set.modes)!.find((f) => f.modes.length > 1)!;

  it("is Σ value·axis per site, and on every atom the sum of its rows' arrows", () => {
    const field = arrowField({ kind: "irrep", id: multi.id }, set.modes, params)!;
    expect(field).not.toBeNull();
    const summed = summedField(multi.modes, params);
    expect(field.map((d) => d.siteLabel)).toEqual(summed.filter((d) => d.axis.some((x) => Math.abs(x) > 1e-12)).map((d) => d.siteLabel));
    const drawn = atomArrows(atoms, set.parentized.cell, field);
    expect(drawn.length).toBeGreaterThan(0);
    // Each row on its own, scaled by its amplitude.
    const perRow = multi.modes.map((m) => atomArrows(atoms, set.parentized.cell, m.axes.map((a) => ({ siteLabel: a.siteLabel, axis: a.axis.map((x) => x * value(m.id)) as [number, number, number] }))));
    for (const d of drawn) {
      const sum = [0, 1, 2].map((c) => perRow.reduce((s, row) => s + (row.find((r) => r.atom === d.atom)?.vec[c] ?? 0), 0));
      for (let c = 0; c < 3; c++) expect(d.vec[c]).toBeCloseTo(sum[c]!, 12);
    }
    // No atom a row moves is missed.
    for (const row of perRow) for (const r of row) if (Math.hypot(...r.vec) > 1e-9) expect(drawn.some((d) => d.atom === r.atom)).toBe(true);
  });

  it("draws every listed mode for All, and a single row's unit eigenvector as before", () => {
    const all = arrowField({ kind: "all" }, set.modes, params)!;
    const sites = new Set(set.modes.flatMap((m) => m.axes.map((a) => a.siteLabel)));
    expect(new Set(all.map((d) => d.siteLabel))).toEqual(sites);
    const one = set.modes[0]!;
    expect(arrowField({ kind: "mode", id: one.id }, set.modes, params)).toEqual(one.axes);
    expect(largestShift(all, set.parentized.cell)).toBeGreaterThan(0);
  });

  it("draws nothing while the irrep's amplitudes are all 0, or once its rows are not listed", () => {
    const zero = params.map((p) => (multi.modes.some((m) => m.id === p.id) ? { ...p, value: 0 } : p));
    expect(arrowField({ kind: "irrep", id: multi.id }, set.modes, zero)).toBeNull();
    expect(arrowField({ kind: "irrep", id: multi.id }, set.modes.filter((m) => m.irrep!.label !== multi.id), params)).toBeNull();
  });
});

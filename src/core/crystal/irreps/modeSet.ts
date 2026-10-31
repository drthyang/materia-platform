/**
 * A refinable mode set (DistortionModeSet) from a child's modes by parent
 * irrep (supercellModes.ts; subgroup engine phase 4, THY-35): the modes as
 * positionShift amplitudes on the realised child's sites, each tagged with its
 * irrep and parent site, with ISODISTORT's amplitude cells and the parent and
 * child basis a mode CIF records.
 *
 * The amplitudes are buildSymmetryModes' (1 Å over the conventional child
 * cell, the refined parameter's unit until the validation freeze ends; ADR
 * 0003), and so is the gauge: a polar child's rigid translations are an exact
 * null direction of every fit, so they are projected out of its modes, which
 * changes only the modes of the irrep the translations belong to.
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { buildSymmetryModes, type DistortionMode, type DistortionModeSet, type ModeSetParent, type SymmetryModeSeed } from "@/core/crystal/distortionModes";
import { latticeCentring } from "@/core/crystal/standardSetting";
import { assignWyckoff } from "@/core/crystal/wyckoff";
import { realisedAmplitudeCells, type RealisedChild } from "@/core/crystal/irreps/realisation";
import type { SupercellModeBasis } from "@/core/crystal/irreps/supercellModes";

/** The parent and child basis of a realised child, as a mode set records them. */
export function modeSetParent(parent: StructureModel, realised: RealisedChild): ModeSetParent {
  return {
    name: parent.name,
    ...(parent.spaceGroup.hermannMauguin !== undefined ? { hermannMauguin: parent.spaceGroup.hermannMauguin } : {}),
    ...(parent.spaceGroup.number !== undefined ? { number: parent.spaceGroup.number } : {}),
    cell: { ...parent.cell },
    centring: latticeCentring(parent.spaceGroup.operations).length,
    basis: realised.basis.map((r) => [...r]) as unknown as Mat3,
    origin: [...realised.origin] as unknown as Vec3,
    sites: parent.sites.map((s) => {
      const w = assignWyckoff(parent.spaceGroup, s.position);
      return { label: s.label, element: s.element, ...(w ? { wyckoff: w.letter } : {}) };
    }),
  };
}

/**
 * The child's modes by parent irrep as a mode set on the realised child: every
 * mode at 0 and fixed unless `values` gives it a value (by basis mode) and
 * `free` frees it; `first` lists basis modes to put first (an activation's
 * order parameter), the rest following in the basis's order. A polar child
 * loses the combinations the gauge removes (buildSymmetryModes).
 */
export function irrepModeSet(
  parent: StructureModel,
  realised: RealisedChild,
  basis: SupercellModeBasis,
  opts: { readonly values?: readonly number[]; readonly free?: (i: number) => boolean; readonly first?: readonly number[] } = {},
): DistortionModeSet {
  const lead = new Set(opts.first ?? []);
  const order = [...(opts.first ?? []), ...basis.modes.map((_, i) => i).filter((i) => !lead.has(i))];
  const seeds: SymmetryModeSeed[] = order.map((i) => {
    const m = basis.modes[i]!;
    return {
      axes: m.axes,
      label: m.label,
      star: basis.irreps[m.irrep]!.star,
      active: opts.free?.(i) ?? false,
    };
  });
  const built = buildSymmetryModes(realised.structure, { seeds, gauge: "polar" });
  const byLabel = new Map(basis.modes.map((m, i) => [m.label, i] as const));
  const modes: DistortionMode[] = built.modes.map((mode) => {
    const i = byLabel.get(mode.label);
    if (i === undefined) throw new Error(`irrepModeSet: ${mode.label} is no mode of the basis`);
    const m = basis.modes[i]!;
    const ir = basis.irreps[m.irrep]!;
    const value = opts.values?.[i] ?? 0;
    return {
      ...mode,
      observedAmplitude: value,
      irrep: { label: ir.label, k: [...ir.k] as unknown as Vec3, ...(ir.direction !== undefined ? { direction: ir.direction } : {}), parentSite: m.parentSite },
    };
  });
  const valueOf = new Map(modes.map((mode) => [mode.id, mode.observedAmplitude] as const));
  return {
    ...built,
    modes,
    parameters: built.parameters.map((p) => {
      const v = valueOf.get(p.id) ?? 0;
      return { ...p, value: v, initialValue: v };
    }),
    totalAmplitude: Math.sqrt(modes.reduce((s, mode) => s + mode.observedAmplitude * mode.observedAmplitude, 0)),
    amplitudeCells: realisedAmplitudeCells(parent, realised),
    parent: modeSetParent(parent, realised),
  };
}

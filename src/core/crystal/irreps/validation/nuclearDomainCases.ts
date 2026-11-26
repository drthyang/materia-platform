/**
 * The cases of the nuclear domain-equivalence test (THY-80 C2), public or
 * synthetic structures only: cubic SrTiO₃ (Pm-3m, testSupport), the bundled
 * GaTa₄Se₈ demo (F-43m, published) and the Mn₃Ga demo (P6₃/mmc). Each names
 * a child by its IT number and picks its class in the subgroup lattice of
 * the bound by what the engine says of it (the tilt it keeps, the irreps
 * that reach it).
 */

import type { Vec3 } from "@/core/math/types";
import type { StructureModel } from "@/core/crystal/types";
import { CONVENTIONAL_CELL, DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { exampleStructure } from "@/examples/mn3ga";
import { AXIS_ORDERS, GLAZER, TILT_SENSES, srtio3, tiltIsInvariant, type Glazer } from "@/testSupport/perovskiteTilts";
import type { DomainCase, PickContext } from "@/core/crystal/irreps/validation/nuclearDomainsSupport";

const STO = srtio3();
const STO_ANISO = { ...srtio3({ anisoO: true }), name: "SrTiO3 (anisotropic O)" };
const GTS = gata4se8PdfExample().structure;
/**
 * Mn₃Ga with Mn exactly on 6h (x, 2x, ¼) and Ga exactly on 2d (⅓, ⅔, ¾): the
 * demo's CIF has y = 2x − 1.1·10⁻⁴ and Ga at (0.3333, 0.6667), which the mode
 * basis's 10⁻⁶ atom matching refuses (THY-58's test sets Mn the same way).
 */
const MN3GA: StructureModel = (() => {
  const s = exampleStructure();
  return {
    ...s,
    sites: s.sites.map((x) => (x.label === "Mn1" ? { ...x, position: [x.position[0], 2 * x.position[0], 0.25] as Vec3 } : x.label === "Ga1" ? { ...x, position: [1 / 3, 2 / 3, 0.75] as Vec3 } : x)),
  };
})();

const BOX_112 = [[1, 0, 0], [0, 1, 0], [0, 0, 2]];
const BOX_221 = [[2, 0, 0], [0, 2, 0], [0, 0, 1]];

/** A⁻a⁻c⁰ (Imma from Pm-3m), not among testSupport's systems. */
const IMMA: Glazer = { name: "a⁻a⁻c⁰", number: 74, phi: [1, 1, 0], inPhase: [false, false, false] };

/** The class whose realised child keeps the Glazer tilt in some orientation and sense. */
const keepsTilt = (g0: Glazer) => (_: unknown, ctx: PickContext): boolean =>
  AXIS_ORDERS.some((order) => TILT_SENSES.some((sg) => tiltIsInvariant(ctx.realised, { ...g0, phi: [g0.phi[0] * sg[0], g0.phi[1] * sg[1], g0.phi[2] * sg[2]] }, order)));

/** The class whose modes hold every one of these irreps (by label), the first a primary one when `primary`. */
const reachedBy = (labels: readonly string[], primary?: string) => (_: unknown, ctx: PickContext): boolean => {
  const irreps = ctx.basis().irreps;
  return labels.every((l) => irreps.some((i) => i.label === l && i.modes.length > 0)) && (primary === undefined || irreps.some((i) => i.label === primary && i.reachesChild));
};

const any = (): boolean => true;
const cellMultiplying = (cls: { readonly cellMultiplying: boolean }): boolean => cls.cellMultiplying;

export const CASES: Readonly<Record<string, DomainCase>> = {
  // ── perovskite Pm-3m, 2×2×2 bound (the app's default) ──
  "R-3c": { name: "SrTiO₃ Pm-3m → R-3c a⁻a⁻a⁻ (2×2×2)", parent: STO, bound: DEFAULT_SUPERCELL, number: 167, pick: (c, x) => c.cellMultiplying && keepsTilt(GLAZER["a-a-a-"]!)(c, x), dMin: 1.0, rMax: 16 },
  "I4/mcm": { name: "SrTiO₃ Pm-3m → I4/mcm a⁰a⁰c⁻ (2×2×2)", parent: STO, bound: DEFAULT_SUPERCELL, number: 140, pick: (c, x) => c.cellMultiplying && keepsTilt(GLAZER["a0a0c-"]!)(c, x), dMin: 1.0, rMax: 16 },
  "Imma": { name: "SrTiO₃ Pm-3m → Imma a⁻a⁻c⁰ (2×2×2)", parent: STO, bound: DEFAULT_SUPERCELL, number: 74, pick: (c, x) => c.cellMultiplying && keepsTilt(IMMA)(c, x), dMin: 1.0, rMax: 16 },
  "P4/mbm": { name: "SrTiO₃ Pm-3m → P4/mbm a⁰a⁰c⁺ (2×2×2)", parent: STO, bound: DEFAULT_SUPERCELL, number: 127, pick: (c, x) => c.cellMultiplying && keepsTilt(GLAZER["a0a0c+"]!)(c, x), dMin: 1.0, rMax: 16 },
  "Pnma": { name: "SrTiO₃ Pm-3m → Pnma a⁻b⁺a⁻ (2×2×2)", parent: STO, bound: DEFAULT_SUPERCELL, number: 62, pick: (c, x) => c.cellMultiplying && keepsTilt(GLAZER["a-b+a-"]!)(c, x), dMin: 1.0, rMax: 16 },
  "Pnma aniso": { name: "SrTiO₃ (anisotropic O) Pm-3m → Pnma a⁻b⁺a⁻ (2×2×2)", parent: STO_ANISO, bound: DEFAULT_SUPERCELL, number: 62, pick: (c, x) => c.cellMultiplying && keepsTilt(GLAZER["a-b+a-"]!)(c, x), dMin: 1.0, rMax: 16 },
  // A polar Γ child, in the conventional cell (the same-cell rows' bound).
  "P4mm": { name: "SrTiO₃ Pm-3m → P4mm Γ, polar (same cell)", parent: STO, bound: CONVENTIONAL_CELL, number: 99, pick: any, dMin: 0.7, rMax: 16 },
  "R3m": { name: "SrTiO₃ Pm-3m → R3m Γ, polar (same cell)", parent: STO, bound: CONVENTIONAL_CELL, number: 160, pick: any, dMin: 0.7, rMax: 16 },
  "Amm2": { name: "SrTiO₃ Pm-3m → Amm2 Γ, polar (same cell)", parent: STO, bound: CONVENTIONAL_CELL, number: 38, pick: any, dMin: 0.7, rMax: 16 },
  // ── GaTa₄Se₈ F-43m ──
  "P-42₁m X5+W1": { name: "GaTa₄Se₈ F-43m → P-42₁m X5+W1 (1×1×2)", parent: GTS, bound: BOX_112, number: 113, pick: (c, x) => cellMultiplying(c) && reachedBy(["X irrep 5 of 5", "W irrep 1 of 4"])(c, x), dMin: 1.3, rMax: 14 },
  "P-4c2 Δ": { name: "GaTa₄Se₈ F-43m → P-4c2 Δ (1×1×2)", parent: GTS, bound: BOX_112, number: 116, pick: (c, x) => cellMultiplying(c) && reachedBy([], "Δ (0, 0, 1/2) irrep 2 of 4")(c, x), dMin: 1.3, rMax: 14 },
  "P-4c2 Δ, other class": { name: "GaTa₄Se₈ F-43m → P-4c2 Δ, the other class (1×1×2)", parent: GTS, bound: BOX_112, number: 116, pick: (c, x) => cellMultiplying(c) && reachedBy(["X irrep 3 of 5"], "Δ (0, 0, 1/2) irrep 2 of 4")(c, x), dMin: 1.3, rMax: 14 },
  "R3m GTS": { name: "GaTa₄Se₈ F-43m → R3m Γ, polar (same cell)", parent: GTS, bound: CONVENTIONAL_CELL, number: 160, pick: any, dMin: 1.0, rMax: 14 },
  "P-42₁m X5": { name: "GaTa₄Se₈ F-43m → P-42₁m X5 (same cell)", parent: GTS, bound: CONVENTIONAL_CELL, number: 113, pick: any, dMin: 1.0, rMax: 14 },
  // ── hexagonal P6₃/mmc ──
  "Cmcm": { name: "Mn₃Ga P6₃/mmc → Cmcm (same cell)", parent: MN3GA, bound: CONVENTIONAL_CELL, number: 63, pick: any, dMin: 0.8, rMax: 16 },
  "P6₃mc": { name: "Mn₃Ga P6₃/mmc → P6₃mc Γ, polar (same cell)", parent: MN3GA, bound: CONVENTIONAL_CELL, number: 186, pick: any, dMin: 0.8, rMax: 16 },
  "Pnma hex": { name: "Mn₃Ga P6₃/mmc → Pnma (2×2×1)", parent: MN3GA, bound: BOX_221, number: 62, pick: cellMultiplying, dMin: 1.0, rMax: 14 },
};

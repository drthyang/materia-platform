/**
 * The known truths of the subgroup search's gate (THY-72, decisions 11 and
 * 12): the parents, the structures the G(r) is simulated from, and the PDF
 * settings, for the gate tests (app/pdfSubgroupSearch.test.ts) and the
 * calibration (scripts/subgroupSearchCalibration.test.ts).
 *
 *  - **SrTiO₃** (Pm-3m, neutron, Qmax 25 Å⁻¹, Qdamp 0.03 Å⁻¹, 2×2×2): cubic,
 *    a⁻a⁻a⁻ (R-3c) and a⁻b⁺a⁻ (Pnma) built geometrically, independently of
 *    the subgroup engine (perovskiteTilts.ts), with a tilt of 0.07 rad.
 *  - **GaTa₄Se₈** (F-43m, the bundled demo structure with one isotropic ADP
 *    per site from its refined U₁₁; X-ray, the demo's Qmax 27 Å⁻¹ and its
 *    refined Qdamp, Qbroad, δ1 and δ2; 1×1×2): P-42₁m in 1×1×2, the class the
 *    engine reaches only by X irrep 5 (0,0,a,−a,−a,a) + W irrep 1
 *    (a,0,0,a,0,0) coupled (c45). Its truth is realised by the engine
 *    (withSupercellChild, as Activate does it), with the X5 modes and the W1
 *    modes each on a fixed random direction moving the atom they move most
 *    by 0.07 Å; every other mode is 0.
 */

import type { StructureModel } from "@/core/crystal/types";
import { EIGHT_PI_SQUARED } from "@/core/crystal/adp";
import { applyParameters } from "@/core/workflow/apply";
import { fractionalToCartesian } from "@/core/crystal/unitCell";
import { realiseChild } from "@/core/crystal/irreps/realisation";
import { cachedSupercellSubgroups } from "@/core/crystal/irreps/supercellLattice";
import { boundGroup } from "@/app/ui/subgroupCache";
import { parseBound } from "@/app/pdfSubgroups";
import { pageView, pdfPage, withSupercellChild, type PdfPageModel } from "@/app/pdfPage";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { srtio3, GLAZER, AXIS_ORDERS, TILT_SENSES, tiltIsInvariant, tiltedChild, type Glazer } from "@/testSupport/perovskiteTilts";
import { noisyPattern, normalSequence, simulatedPattern, type SimulationSettings } from "@/testSupport/pdfNoise";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import type { PdfPattern } from "@/core/diffraction/types";
import { ComputeClient } from "@/workers/computeClient";
import { pdfSearchContext, type PdfSearchCandidate, type PdfSearchContext } from "@/app/pdfSubgroupSearch";
import { searchStep1, type StepResult } from "@/core/diagnostics/subgroupSearch";
import { starsInBound } from "@/core/crystal/irreps/factorGroup";
import { rnum } from "@/core/crystal/irreps/rational";
import { cachedIrrepsOfStar } from "@/core/crystal/irreps/supercellModes";

export type TruthName = "cubic" | "a-a-a-" | "a-b+a-" | "GaTa4Se8 P-42_1m";

export interface SearchTruth {
  readonly name: TruthName;
  readonly parent: StructureModel;
  readonly bound: SupercellSpec;
  readonly settings: SimulationSettings;
  /** The noise-free G(r) of the truth. */
  readonly clean: () => PdfPattern;
  /** The window the noise level is set over (the search's, near enough: from the first peak to 10 Å). */
  readonly levelWindow: { readonly rmin: number; readonly rmax: number };
}

/** The data's grid for every truth: 0.05 Å from 1 to 13 Å (rmax + 2 Å and the band-limit's margin inside it). */
const GRID = { rStep: 0.05, rFirst: 1.0, rLast: 13 } as const;

const SRTIO3_SETTINGS: SimulationSettings = { scatteringType: "neutron", qmax: 25, qdamp: 0.03, ...GRID };

/** The a⁻a⁻a⁻ or a⁻b⁺a⁻ child of cubic SrTiO₃ in the 2×2×2 cell at tilt φ (rad), built geometrically. */
export function tiltedSrTiO3(key: "a-a-a-" | "a-b+a-", phi = 0.07): StructureModel {
  const parent = srtio3();
  const group = boundGroup(parent.spaceGroup.operations, parseBound("2×2×2")!).group!;
  const g0 = GLAZER[key]!;
  for (const cls of cachedSupercellSubgroups(group).classes) {
    if (cls.identity?.number !== g0.number || !cls.cellMultiplying) continue;
    const r = realiseChild(parent, group, cls.elements, cls.identity);
    for (const order of AXIS_ORDERS) for (const signs of TILT_SENSES) {
      const g: Glazer = { ...g0, phi: [g0.phi[0] * signs[0], g0.phi[1] * signs[1], g0.phi[2] * signs[2]] };
      if (tiltIsInvariant(r, g, order)) return tiltedChild(r, g, phi, order);
    }
  }
  throw new Error(`no ${key} class in the 2×2×2 lattice`);
}

/** GaTa₄Se₈ as the search's parent: the demo's F-43m structure, its refined cell, one isotropic B per site (8π²·U₁₁). */
export function gata4se8Parent(): StructureModel {
  const demo = gata4se8PdfExample();
  const v = demo.refinedParams;
  const u: Record<string, number> = { Ga1: v.U_Ga1_0!, Ta1: v.U_Ta1_0!, Se1: v.U_Se1_0!, Se2: v.U_Se2_0! };
  const s = demo.structure;
  return {
    ...s,
    cell: { ...s.cell, a: v.cell_a!, b: v.cell_a!, c: v.cell_a! },
    sites: s.sites.map((site) => ({ ...site, adp: { kind: "isotropic", bIso: EIGHT_PI_SQUARED * u[site.label]! } })),
  };
}

/** GaTa₄Se₈'s PDF settings: X-ray, the demo's Qmax and its refined Qdamp, Qbroad, δ1, δ2. */
export function gata4se8Settings(): SimulationSettings {
  const demo = gata4se8PdfExample();
  const v = demo.refinedParams;
  return { scatteringType: "xray", qmax: demo.pattern.qmax!, qdamp: v.qdamp!, qbroad: v.qbroad!, delta1: v.delta1!, delta2: v.delta2!, ...GRID };
}

/** The X5 + W1 coupled class of F-43m in 1×1×2 (c45, P-42₁m #113) with its two irreps' modes set, as the engine realises it. */
export function gata4se8Truth(amplitude = 0.07, seed = 113): StructureModel {
  const parent = gata4se8Parent();
  const bound = parseBound("1×1×2")!;
  const group = boundGroup(parent.spaceGroup.operations, bound).group!;
  const lattice = cachedSupercellSubgroups(group);
  const cls = lattice.classes[45]!;
  if (cls.identity?.number !== 113) throw new Error("c45 of the 1×1×2 lattice is not P-42₁m");
  const flat: PdfPattern = { id: "flat", name: "flat", scatteringType: "xray", points: Array.from({ length: 100 }, (_, i) => ({ r: 1 + 0.1 * i, gObs: 1 })) };
  const page: PdfPageModel = pdfPage(parent, flat, { preset: { values: { pdfScale: 1 } } });
  // The pair's irreps by their labels; their characters from the lattice's analysis are what Activate kicks.
  const act = withSupercellChildByLabels(page, group, cls.elements, cls.identity, ["X irrep 5 of 5", "W irrep 1 of 4"]);
  const set = act.modes!.set;
  const v = pageView(act);
  const cell = v.fitStructure.cell;
  const normal = normalSequence(seed);
  const values: Record<string, number> = Object.fromEntries(act.params.map((p) => [p.id, p.kind === "positionShift" ? 0 : p.value]));
  for (const label of ["X irrep 5 of 5", "W irrep 1 of 4"]) {
    const modes = set.modes.filter((m) => m.irrep?.label === label);
    if (modes.length === 0) throw new Error(`no ${label} mode in P-42₁m`);
    const dir = modes.map(() => normal());
    const bySite = new Map<string, [number, number, number]>();
    modes.forEach((m, i) => {
      for (const ax of m.axes) {
        const d = bySite.get(ax.siteLabel) ?? [0, 0, 0];
        bySite.set(ax.siteLabel, [d[0] + dir[i]! * ax.axis[0], d[1] + dir[i]! * ax.axis[1], d[2] + dir[i]! * ax.axis[2]]);
      }
    });
    const most = Math.max(...[...bySite.values()].map((d) => Math.hypot(...fractionalToCartesian(cell, d))));
    modes.forEach((m, i) => (values[m.id] = (amplitude / most) * dir[i]!));
  }
  return { ...applyParameters(v.fitStructure, v.bindings, values).model, id: "gata4se8-p-42_1m", name: "GaTa4Se8 P-42_1m truth" };
}

/** Activate's child with the given irreps (by label) as its coupled order parameter. */
function withSupercellChildByLabels(page: PdfPageModel, group: Parameters<typeof withSupercellChild>[1]["group"], elements: readonly number[], identity: NonNullable<ReturnType<typeof cachedSupercellSubgroups>["classes"][number]["identity"]>, labels: readonly string[]): PdfPageModel {
  // The characters by label, from the irreps of the bound's stars.
  const chars = irrepCharacters(group, labels);
  const a = withSupercellChild(page, { group, elements, identity, coupled: chars });
  if (a.model.modes === null) throw new Error(a.message);
  return a.model;
}

function irrepCharacters(group: Parameters<typeof withSupercellChild>[1]["group"], labels: readonly string[]): number[][] {
  const out: number[][] = [];
  for (const label of labels) {
    let found: readonly number[] | null = null;
    for (const k of starsInBound(group)) {
      const star = cachedIrrepsOfStar(group, [rnum(k[0]), rnum(k[1]), rnum(k[2])]);
      for (const p of star.physical) if (p.label === label) found = p.characters;
    }
    if (!found) throw new Error(`no irrep ${label} in the bound`);
    out.push([...found]);
  }
  return out;
}

/** Every truth of the gate. */
export function searchTruth(name: TruthName): SearchTruth {
  if (name === "GaTa4Se8 P-42_1m") {
    const settings = gata4se8Settings();
    return { name, parent: gata4se8Parent(), bound: parseBound("1×1×2")!, settings, clean: () => simulatedPattern(gata4se8Truth(), settings, name), levelWindow: { rmin: 2.3, rmax: 10 } };
  }
  const structure = name === "cubic" ? srtio3() : tiltedSrTiO3(name);
  return { name, parent: srtio3(), bound: parseBound("2×2×2")!, settings: SRTIO3_SETTINGS, clean: () => simulatedPattern(structure, SRTIO3_SETTINGS, name), levelWindow: { rmin: 1.65, rmax: 10 } };
}

// ── the gate tests' screen ───────────────────────────────────────────────────


/**
 * The gate tests' step 1 screen on SrTiO₃, by row key and irrep with its
 * direction: R irrep 8 in the a⁻a⁻a⁻, a⁻a⁻c⁰ and a⁰a⁰c⁻ directions and the
 * monoclinic (a,a,b) (C2/c, a subgroup of R-3c), M irrep 3 (a,0,0), and the two
 * irreps a full screen ranks next on these data (R irrep 10 and 7 along
 * (a,a,a)). A handful of the 172 single-irrep classes that move atoms, so the
 * tests stay within a minute; the full screen is the calibration's.
 */
export const GATE_SCREEN = [
  "c49:R irrep 8 of 10 (a,0,0)",
  "c130:R irrep 8 of 10 (a,a,0)",
  "c71:R irrep 8 of 10 (a,a,a)",
  "c365:R irrep 8 of 10 (a,a,b)",
  "c36:M irrep 3 of 10 (a,0,0)",
  "c61:R irrep 10 of 10 (a,a,a)",
  "c67:R irrep 7 of 10 (a,a,a)",
] as const;

let gateClient: ComputeClient | null = null;

/** A truth's search context on noisy data (one seed). */
export async function gateContext(truth: TruthName, level: number, seed: number): Promise<PdfSearchContext> {
  const t = searchTruth(truth);
  const data = noisyPattern(t.clean(), { level, window: t.levelWindow, seed });
  gateClient ??= new ComputeClient();
  return pdfSearchContext(gateClient, pdfPage(t.parent, data), t.bound);
}

/** Step 1 on the gate screen. */
export function gateStep1(ctx: PdfSearchContext): Promise<StepResult> {
  const screen = GATE_SCREEN.map((key) => ctx.singles.find((c) => c.key === key));
  const missing = GATE_SCREEN.filter((_, i) => !screen[i]);
  if (missing.length > 0) throw new Error(`the gate screen's classes are not in the listing: ${missing.join(", ")}`);
  return searchStep1({ host: ctx.host, window: ctx.window, firstPeakPast: ctx.peak.past }, ctx.reference, screen as PdfSearchCandidate[]);
}

/** A step's table, one line a row, for a failing assertion's message. */
export const stepTable = (s: StepResult): string =>
  s.rows.map((r) => `${r.candidate.group} ${r.candidate.irreps.map((x) => `${x.label} ${x.direction}`).join(" + ")}: ${r.status}${r.deltaBic !== undefined ? ` ΔBIC ${r.deltaBic.toFixed(1)}` : ""}${r.gate ? (r.gate.accepted ? " accepted" : ` not accepted (${r.gate.reasons.join("; ")})`) : r.reason ? ` (${r.reason})` : ""}`).join("\n");

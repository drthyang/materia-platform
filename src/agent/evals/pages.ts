/**
 * The pages the eval scenarios run on, built from the datasets in the
 * repository so every run sees the same data: the Mn₃Ga powder demo (a
 * synthetic neutron pattern, 2θ at 1.54 Å) and the GaTa₄Se₈ PDF demo.
 */

import type { PdfAgentPort, PowderAgentPort, SingleCrystalAgentPort } from "@/agent/port";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadedSession, newSession, type Session } from "@/app/powderSession";
import { parseCif } from "@/parsers/cif";
import { parseInstrumentParameters } from "@/parsers/instrument";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { dataDir } from "@/testSupport/data";
import { exampleStructure } from "@/examples/mn3ga";
import { generateReflections } from "@/core/diffraction/reflections";
import { powderPeakIntensities } from "@/core/diffraction/intensity";
import { knownPhaseStructure } from "@/core/diagnostics/knownPhases";
import { pdfPort, sessionPort, singleCrystalPort } from "@/testSupport/agentHeadless";
import { chiralPage, corundumPage, disorderPage, hydridePage, pyridylPage, twinnedTrigonalPage, type CorundumOptions } from "@/testSupport/scPages";
import { runPowderRefinement } from "@/workers/runPowder";
import { magneticSubgroupLattice, latticeRepresentatives, latticeCandidateLabel } from "@/core/magnetic/subgroupLattice";
import { buildMagneticModel } from "@/core/magnetic/momentModel";
import { applyMagneticMoments } from "@/core/workflow/magnetic";
import { magneticComponentCurve } from "@/core/workflow/magneticPowder";
import { powderCurves } from "@/core/workflow/powder";
import type { Vec3 } from "@/core/math/types";
import { powderRestraints } from "@/app/powderSpec";

const WAVELENGTH = 1.54;
const twoThetaOf = (d: number): number => (2 * Math.asin(WAVELENGTH / (2 * d)) * 180) / Math.PI;

/** Seeded standard normal deviates: the same noise on every run. */
function gaussian(seed = 20261010): () => number {
  let state = seed;
  const uniform = (): number => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/**
 * The Mn₃Ga demo as it loads (the scale and background free, the rest fixed
 * at the CIF's values, the peak width at 0.1° against a true 0.5°), with
 * seeded counting noise on the synthetic pattern: a fit converges onto the
 * noise as on real data, instead of stalling at a zero residual.
 */
export function mn3gaSession(): Session {
  const s = newSession(exampleStructure());
  const noise = gaussian();
  const points = s.pattern.points.map((p) => {
    const sigma = Math.sqrt(Math.max(p.yObs, 1));
    return { ...p, yObs: p.yObs + sigma * noise(), sigma };
  });
  return { ...s, pattern: { ...s.pattern, points } };
}

/**
 * Fault injection: the demo's pattern with its abscissa converted to d (Å)
 * but still labelled 2θ — a file of d-spacings loaded as degrees. Nothing a
 * refinement can do fits it; the axis has to be questioned first.
 */
export function mn3gaSwappedUnitsSession(): Session {
  const s = mn3gaSession();
  const points = s.pattern.points
    .map((p) => ({ ...p, x: WAVELENGTH / (2 * Math.sin((p.x * Math.PI) / 360)) }))
    .sort((a, b) => a.x - b.x);
  return { ...s, pattern: { ...s.pattern, points } };
}

/**
 * Fault injection: the demo's pattern, measured at 1.54 Å, loaded as if at
 * 1.556 Å (a wavelength 1 % off) — every d 1 % long, beyond what the cell
 * check's Le Bail fit can follow.
 */
export function mn3gaWrongWavelengthSession(): Session {
  const s = mn3gaSession();
  return { ...s, pattern: { ...s.pattern, wavelength: 1.556, radiation: { ...s.pattern.radiation, wavelength: 1.556 } as typeof s.pattern.radiation } };
}

/** The demo's true peak width (FWHM, °2θ); the page starts at 0.1. */
const TRUE_WIDTH = 0.5;

/** The session with these parameters refined (and left fixed as they were): a start that fits. */
function prefit(s: Session, ids: readonly string[]): Session {
  const free = new Set(ids);
  const r = runPowderRefinement({
    type: "refinePowder",
    requestId: 0,
    structure: s.structure,
    pattern: s.pattern,
    parameters: s.powderParams.map((p) => ({ ...p, fixed: !free.has(p.id) })),
    bindings: s.powderBindings,
    shape: s.powderProfile.shape,
    restraints: powderRestraints([s.structure], s.siteTies, s.powderParams),
    options: { maxIterations: 20 },
  });
  return { ...s, powderParams: s.powderParams.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value })) };
}

/**
 * The demo with a start that is off the way a real one is — ADPs, the Mn
 * position and the peak width away from the truth — with the scale and
 * background fitted. Every reflection is where the model puts one; only
 * intensities and shapes differ: misfits, which refinement fixes, and no
 * extra peak.
 */
export function mn3gaMisfitSession(): Session {
  const s = mn3gaSession();
  const start: Record<string, number> = { B_Mn1: 2.6, B_Ga1: 0.15, pos_Mn1_0: 0.012, width: 1.25 * TRUE_WIDTH };
  const off = { ...s, powderParams: s.powderParams.map((p) => (p.id in start ? { ...p, value: start[p.id]! } : p)) };
  return prefit(off, scaleAndBackground(off));
}

const scaleAndBackground = (s: Session): string[] => s.powderParams.filter((p) => p.kind === "scale" || p.kind === "background").map((p) => p.id);

/** Where the impurity line of `mn3gaImpuritySession` sits (d, Å): in the widest gap between Mn₃Ga reflections. */
export function impurityD(): number {
  const s = mn3gaSession();
  const xs = s.pattern.points.map((p) => p.x);
  const dOf = (tt: number): number => WAVELENGTH / (2 * Math.sin((tt * Math.PI) / 360));
  const dMax = dOf(Math.min(...xs) + 5);
  const dMin = dOf(Math.max(...xs) - 5);
  const ds = [...new Set(generateReflections(s.structure.cell, s.structure.spaceGroup, Math.max(dMin, 1.2), dMax).map((r) => +r.d.toFixed(5)))].sort((a, b) => b - a);
  let best = { gap: 0, d: 0 };
  for (let i = 0; i + 1 < ds.length; i++) {
    const gap = ds[i]! / ds[i + 1]! - 1;
    if (gap > best.gap) best = { gap, d: Math.sqrt(ds[i]! * ds[i + 1]!) };
  }
  return best.d;
}

/**
 * The demo with one line of an unknown second phase added between the Mn₃Ga
 * reflections, the scale and background already fitted: what is left over is
 * that line.
 */
export function mn3gaImpuritySession(): Session {
  const s0 = mn3gaSession();
  const s = { ...s0, powderParams: s0.powderParams.map((p) => (p.id === "width" ? { ...p, value: TRUE_WIDTH } : p)) };
  const at = twoThetaOf(impurityD());
  const top = Math.max(...s.pattern.points.map((p) => p.yObs));
  const height = 0.04 * top;
  const sigma = TRUE_WIDTH / 2.355;
  const points = s.pattern.points.map((p) => {
    const y = p.yObs + height * Math.exp(-0.5 * ((p.x - at) / sigma) ** 2);
    return { ...p, yObs: y, sigma: Math.sqrt(Math.max(y, 4)) };
  });
  const withLine = { ...s, pattern: { ...s.pattern, points } };
  return prefit(withLine, scaleAndBackground(withLine));
}

/**
 * The demo with fluorite's lines added at a few per cent (round 10: NAC on
 * 11-BM held a fluorite by-product), its relative intensities computed from
 * the library's own CaF₂ for this radiation, the scale and background
 * already fitted: what is left over is a known phase, ready to be named and
 * added.
 */
export function mn3gaFluoriteSession(): Session {
  const s0 = mn3gaSession();
  const s = { ...s0, powderParams: s0.powderParams.map((p) => (p.id === "width" ? { ...p, value: TRUE_WIDTH } : p)) };
  const caf2 = knownPhaseStructure("CaF₂")!;
  const xs = s.pattern.points.map((p) => p.x);
  const dOf = (tt: number): number => WAVELENGTH / (2 * Math.sin((tt * Math.PI) / 360));
  const reflections = generateReflections(caf2.cell, caf2.spaceGroup, dOf(Math.max(...xs)), dOf(Math.min(...xs)));
  const intensities = powderPeakIntensities(caf2, s.pattern.radiation, reflections, 1, undefined, true).map((p) => p.intensity);
  const strongest = Math.max(...intensities);
  const top = Math.max(...s.pattern.points.map((p) => p.yObs));
  const sigma = TRUE_WIDTH / 2.355;
  const lines = reflections.map((r, i) => ({ at: twoThetaOf(r.d), height: 0.05 * top * intensities[i]! / strongest }));
  const points = s.pattern.points.map((p) => {
    const y = p.yObs + lines.reduce((sum, l) => sum + l.height * Math.exp(-0.5 * ((p.x - l.at) / sigma) ** 2), 0);
    return { ...p, yObs: y, sigma: Math.sqrt(Math.max(y, 4)) };
  });
  const withLines = { ...s, pattern: { ...s.pattern, points } };
  return prefit(withLines, scaleAndBackground(withLines));
}

/** Where the edge of `mn3gaEdgeSession` starts, and where its scan ends (2θ, °). */
export const EDGE_STEP_AT = 108.3;
const EDGE_SCAN_END = 109.3;

/**
 * The demo as a scan with an edge that is not real data (the user's demo
 * feedback, PbSO₄ on D1A): the scan stops at EDGE_SCAN_END, in the gap after
 * the line at 105.6°; on a background of 300 counts, from EDGE_STEP_AT to the
 * end the counts step up by half the background and stay there, as at a
 * detector's edge; below the first reflection the scan holds background only.
 * The scale and background are fitted to the whole scan, edge and all.
 */
export function mn3gaEdgeSession(): Session {
  const s0 = mn3gaSession();
  const s = { ...s0, powderParams: s0.powderParams.map((p) => (p.id === "width" ? { ...p, value: TRUE_WIDTH } : p)) };
  const noise = gaussian(11);
  const points = s.pattern.points.filter((p) => p.x <= EDGE_SCAN_END).map((p) => {
    const extra = 300 + (p.x >= EDGE_STEP_AT ? 150 : 0);
    const y = p.yObs + extra + Math.sqrt(extra) * noise();
    return { ...p, yObs: y, sigma: Math.sqrt(Math.max(y, 1)) };
  });
  const edged = { ...s, pattern: { ...s.pattern, points } };
  return prefit(edged, scaleAndBackground(edged));
}

/** The magnetic structure behind `mn3gaMagneticSession`: k, the group (its id on the page) and the Mn moment. */
export const MAGNETIC_TRUTH = { k: [0, 0, 0.5] as Vec3, id: "G2", moment: 2.5 } as const;

/**
 * Mn₃Ga below an (invented) ordering temperature: the nuclear pattern at the
 * page's own parameters (peak width at its true 0.5°) plus the magnetic
 * scattering of MAGNETIC_TRUTH, with seeded counting noise. The nuclear model
 * is right from the start, so what the fit leaves is the magnetic satellites
 * at l = ½.
 */
export function mn3gaMagneticSession(): Session & { readonly truthGroup: string } {
  const s0 = newSession(exampleStructure());
  const params = s0.powderParams.map((p) => (p.id === "width" ? { ...p, value: TRUE_WIDTH } : p));
  const reps = latticeRepresentatives(magneticSubgroupLattice(s0.structure.spaceGroup.operations, MAGNETIC_TRUTH.k));
  const truth = reps[Number(MAGNETIC_TRUTH.id.slice(1)) - 1]!;
  const built = buildMagneticModel(s0.structure, MAGNETIC_TRUTH.k, ["Mn1"], [...truth.candidate.operations], { moment: 2, tieSameSite: true, tieEqualMagnitude: false, flippedUnits: [] });
  const amplitudes = Object.fromEntries(built.params.map((p) => [p.id, MAGNETIC_TRUTH.moment]));
  const magnetic = applyMagneticMoments(built.magnetic, built.bindings, amplitudes);
  const nuclear = powderCurves(s0.structure, s0.pattern, params, s0.powderBindings, s0.powderProfile).yCalc;
  const mag = magneticComponentCurve(s0.structure, magnetic, s0.pattern, params, s0.powderBindings, s0.powderProfile);
  const noise = gaussian(7);
  const points = s0.pattern.points.map((p, i) => {
    const y = nuclear[i]! + mag[i]!;
    const sigma = Math.sqrt(Math.max(y, 1));
    return { ...p, yObs: y + sigma * noise(), sigma };
  });
  return { ...s0, powderParams: params, pattern: { ...s0.pattern, points }, truthGroup: latticeCandidateLabel(truth).symbol };
}

export function powderPage(session: Session): PowderAgentPort {
  return sessionPort(session).port;
}

/**
 * The user's own AWO₄ powder data, where they are: the structure's CIF, a
 * POWGEN bank's GSAS histogram (TOF) and the instrument file of the same bank,
 * found in the git-ignored data/AWO4 folder. The data are unpublished: the
 * repository holds none of them, not even their file names, and the scenario
 * on them runs only on a machine that has the folder. Null when it is absent.
 */
export function awo4UserFiles(): { readonly structure: string; readonly data: string; readonly instrument: string } | null {
  const dir = dataDir("AWO4");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).sort();
  const cif = files.find((f) => /\.cif$/i.test(f));
  const gsa = files.find((f) => /\.gsa$/i.test(f));
  if (!cif || !gsa) return null;
  const bank = /^BANK\s+(\d+)/m.exec(readFileSync(join(dir, gsa), "utf8"))?.[1];
  const instruments = files.filter((f) => /\.instprm$/i.test(f));
  const instrument = instruments.find((f) => bank !== undefined && new RegExp(`B${bank}(?!\\d)`).test(f)) ?? instruments[0];
  if (!instrument) return null;
  return { structure: join(dir, cif), data: join(dir, gsa), instrument: join(dir, instrument) };
}

/**
 * The powder page as the app opens it on the user's AWO₄ files: the CIF, the
 * histogram read as TOF, and the instrument's calibration and profile, the
 * spec built as the data loader builds it (loadedSession) and the instrument
 * shown on the page (the d axis needs it).
 */
export function awo4UserPage(): PowderAgentPort {
  const files = awo4UserFiles();
  if (!files) throw new Error("the AWO4 data are not on this machine (data/AWO4)");
  const read = (path: string): string => readFileSync(path, "utf8");
  const structure = parseCif(read(files.structure), "awo4");
  const instrument = parseInstrumentParameters(read(files.instrument));
  const pattern = parseGsasHistogramPattern(read(files.data), `${structure.id}-powder`, basename(files.data), { radiation: { kind: "neutron-tof" } });
  return sessionPort(loadedSession(structure, pattern, instrument), instrument, { instrumentOnPage: true }).port;
}

export function pdfPage(): PdfAgentPort {
  return pdfPort().port;
}

/** The single-crystal page on synthetic corundum (testSupport/scPages): strong extinction unless asked otherwise. */
export function scPage(opts: CorundumOptions = {}): SingleCrystalAgentPort {
  const c = corundumPage({ extinction: 20, ...opts });
  return singleCrystalPort(c.structure, c.dataset).port;
}

/** A failed measurement for scPage: 1 0 4 at 3 % of its intensity (sapphire's 5 4 1 in batch 24). */
export const FAILED_REFLECTION = { h: 1, k: 0, l: 4, factor: 0.03 } as const;

/**
 * Two failed measurements for scPage, measured in three batches: 1 0 4 at 3 %
 * and 3 0 12 at half its intensity (sapphire's 5 4 1 and 3 4 2, both in batch
 * 24). The second shows only once the first is out, and inside the residual a
 * σ cutoff set just above the next worst would leave.
 */
export const FAILED_PAIR = [FAILED_REFLECTION, { h: 3, k: 0, l: 12, factor: 0.5 }] as const;

/** A crystal whose extinction is Becker–Coppens type I (Lorentzian mosaic), Eg = 1e-4, measured to d = 0.45 Å, for scPage: SHELXL's EXTI fits it less well, and the high order lies beyond 0.6 Å. */
export const BC_EXTINCTION = { extinction: 1e-4, extinctionModel: "bc-1-lorentzian", dMin: 0.45 } as const;

/** Batch scales for scPage: four batches, the data reduction off by up to 8 %. */
export const BATCH_SCALES = [1, 1.06, 0.94, 1.08] as const;

export interface OrganicPageOptions {
  /** Loaded as a SHELX file loads: no radiation in it, so neutron at 1.54 Å until set. */
  readonly asLoaded?: boolean;
  /** The Fo² are a refinement's listing (.fcf): each reflection once, on that refinement's scale. */
  readonly listing?: boolean;
  /** An error on every Fo² of this fraction that the σ do not carry (what WGHT a covers). */
  readonly extraError?: number;
}

/**
 * The single-crystal page on a small organic X-ray structure
 * (testSupport/scPages: 2-(methylthio)pyridine, P2₁/c, Mo Kα): seven
 * hydrogens where a difference map put them, a riding model the truth.
 */
export function scOrganicPage(opts: OrganicPageOptions = {}): SingleCrystalAgentPort {
  const p = pyridylPage(opts.extraError !== undefined ? { extraError: opts.extraError } : {});
  const dataset = {
    ...p.dataset,
    ...(opts.asLoaded ? { radiation: { kind: "neutron" as const, wavelength: 1.54 } } : {}),
    ...(opts.listing ? { origin: "refinement-listing" as const } : {}),
  };
  return singleCrystalPort(p.structure, dataset).port;
}

/**
 * Round 3's 1b framework (testSupport/scPages): Ga, N and C in P2₁2₁2₁ with
 * Mo Kα, every Friedel pair measured apart, the intensities from an inversion
 * twin at x = 0.3 and the page loading it untwinned. With `equivalents` above
 * one, each reflection and its mate are measured that many times at their
 * rotation equivalents, as the measurement in 1b's CIF is: SHELXL merges it
 * (MERG 2) before it refines.
 */
export function scChiralPage(opts: { readonly equivalents?: number } = {}): SingleCrystalAgentPort {
  const c = chiralPage(opts);
  return singleCrystalPort(c.structure, c.dataset).port;
}

/** The chiral Ga framework measured from a crystal of the other hand (Flack x = 1): the model as loaded is the wrong enantiomer, as round 4's 3a was. */
/** A light-atom molecule in P3₂, its crystal twinned by h, k, l → k, h, −l at 0.45, each reflection once (round 5's 2b in small). */
export function scTwinnedPage(): SingleCrystalAgentPort {
  const t = twinnedTrigonalPage();
  return singleCrystalPort(t.structure, t.dataset).port;
}

export function scInvertedHandPage(): SingleCrystalAgentPort {
  const c = chiralPage({ flack: 1 });
  return singleCrystalPort(c.structure, c.dataset).port;
}

/** 1b's split metal site, Al1 and Ga1 0.2 Å apart (PART 1 and 2 of one assembly), measured at an Al share of 0.84 and loaded at 0.7 and 0.3, untied. */
export function scDisorderPage(): SingleCrystalAgentPort {
  const d = disorderPage();
  return singleCrystalPort(d.structure, d.dataset).port;
}

/** A fragment of 1b with its hydride H3′ on Ga2 0.2 Å off where the data put it, and the hydrogens on carbon where SHELXL placed them. */
export function scHydridePage(): SingleCrystalAgentPort {
  const h = hydridePage();
  return singleCrystalPort(h.structure, h.dataset).port;
}

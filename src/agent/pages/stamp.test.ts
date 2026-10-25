import { describe, it, expect } from "vitest";
import type { MagneticAgentHandle } from "@/agent/magneticPort";
import type { AgentPort, PdfAgentPort, PowderAgentPort, SingleCrystalAgentPort } from "@/agent/port";
import { onPage } from "@/agent/pages";
import { MAGNETIC_TRUTH, mn3gaMagneticSession, mn3gaSession } from "@/agent/evals/pages";
import { pdfPort, sessionPort, singleCrystalPort } from "@/testSupport/agentHeadless";
import { chiralPage, corundumPage, pyridylPage } from "@/testSupport/scPages";
import type { Session } from "@/app/powderSession";

/**
 * What a change was checked and approved against (the stamp): a change whose
 * card waited while the page changed under it is not run. Every setter on each
 * page's Agent port, and on the powder page's magnetic step, must move its
 * page's stamp. A setter added to a port without an entry here fails, and so
 * does one the stamp does not see. The executor's one stamp, before the page
 * adapters, missed fifteen: eight on the single-crystal page (the extinction
 * model, the weights, the restraints, the hand, the merge, the omissions, the
 * resolution, the OMIT filter), the powder page's X-ray constants, and six of
 * the magnetic step's.
 */

/** The page's stamp; with the magnetic step's panel as the executor reads it once the step's tools are in use. */
const stampOf = (port: AgentPort, step = false): string => onPage(port, (page, p) => page.stamp(page.state(p), step ? page.magneticStep?.(p) ?? null : null));

/** One setter's test: on a fresh page, after `prepare`, `act` must move the stamp. */
interface Entry<P> {
  readonly page?: () => P;
  readonly prepare?: (port: P) => unknown;
  readonly act: (port: P) => unknown;
}

type Table<T> = { readonly [K in keyof T]?: Entry<T> | string };

/** The pages' functions that are not settings, and why. */
const RUNS = {
  state: "reads the page",
  refine: "a fit: the values it leaves are the stamp's parameters (reset's entry)",
  thorough: "a fit, as refine",
  probe: "a fit returned, never applied",
  cancel: "stops a fit",
  samplePosterior: "samples the posterior: the rows are left as they are",
  reportInput: "reads the page's report",
} as const;

/** Mn₃Ga under X-rays, so the X-ray constants (polarization, Kα₂) have something to set. */
function xrayMn3ga(): Session {
  const s = mn3gaSession();
  return { ...s, pattern: { ...s.pattern, radiation: { kind: "xray", wavelength: 1.5406 } } };
}

const powder = (): PowderAgentPort => sessionPort(xrayMn3ga()).port;
const firstFixed = (port: AgentPort): string => port.state().parameters.find((p) => p.fixed && !p.expression)!.id;

const POWDER: Table<PowderAgentPort> = {
  ...RUNS,
  showPeaks: "marks residual peaks on the plot: a view",
  openStep: "shows a step of the page: a view",
  magnetic: "the magnetic step's handle: its setters are below",
  setFixed: { act: (p) => p.setFixed([{ id: firstFixed(p), fixed: false }]) },
  setBackgroundTerms: { act: (p) => p.setBackgroundTerms(p.state().settings.backgroundTerms + 1) },
  setBackgroundType: { act: (p) => p.setBackgroundType("cosine") },
  setMustrain: { act: (p) => p.setMustrain("uniaxial") },
  setAnisotropicAdp: { act: (p) => p.setAnisotropicAdp(true) },
  setSiteTies: { act: (p) => p.setSiteTies({ composition: true }) },
  setCorrections: { act: (p) => p.setCorrections!({ asymmetry: true }) },
  addAntisite: { act: (p) => p.addAntisite!("Mn1", "Ga1") },
  addPhase: { act: (p) => p.addPhase!({ ...p.state().structure, id: "second", name: "second" }) },
  setParameterTies: {
    act: (p) => p.setParameterTies!({ equal: p.state().parameters.filter((q) => q.kind === "bIso").map((q) => q.id) }),
  },
  setInstrumentConstants: { act: (p) => p.setInstrumentConstants!({ polarization: 0.5 }) },
  setFitRange: {
    act: (p) => {
      const { min, max } = p.state().extent;
      p.setFitRange({ min: min + (max - min) / 4, max: max - (max - min) / 4 });
    },
  },
  reset: { prepare: (p) => p.refine(), act: (p) => p.reset() },
};

/** The magnetic step's handle, on Mn₃Ga with its magnetic satellites. */
const magneticPage = (): PowderAgentPort => sessionPort(mn3gaMagneticSession()).port;
const step = (p: PowderAgentPort): MagneticAgentHandle => p.magnetic!()!;
const chosen = (p: PowderAgentPort): void => {
  step(p).setK([...MAGNETIC_TRUTH.k]);
  step(p).choose(MAGNETIC_TRUTH.id);
};

const MAGNETIC: Table<MagneticAgentHandle> = {
  state: "reads the step",
  searchK: "a read (search_propagation_vector): the k candidates are its answer",
  rank: "a read (rank_magnetic_groups): the groups' fits are its answer",
};
/** The handle's setters, each through the powder page it belongs to. */
const MAGNETIC_SETTERS: { readonly [K in keyof MagneticAgentHandle]?: Entry<PowderAgentPort> } = {
  setK: { act: (p) => step(p).setK([...MAGNETIC_TRUTH.k]) },
  selectIons: { act: (p) => step(p).selectIons([]) },
  setTies: { act: (p) => step(p).setTies({ sameSite: !step(p).state().ties.sameSite }) },
  choose: { prepare: (p) => step(p).setK([...MAGNETIC_TRUTH.k]), act: (p) => step(p).choose(MAGNETIC_TRUTH.id) },
  refineMoments: { prepare: chosen, act: (p) => step(p).refineMoments() },
  apply: { prepare: chosen, act: (p) => step(p).apply(true) },
  continueToRefinement: { prepare: chosen, act: (p) => step(p).continueToRefinement(false) },
};

const PDF: Table<PdfAgentPort> = {
  ...RUNS,
  boxcar: "a scan of the free set box by box: the rows are left as they are",
  setFixed: { act: (p) => p.setFixed([{ id: firstFixed(p), fixed: false }]) },
  // The demo opens with the U tensor.
  setAdpModel: { act: (p) => p.setAdpModel(p.state().adpModel !== "anisotropic") },
  setFitRange: { act: (p) => p.setFitRange({ min: 2, max: 5 }) },
  reset: { prepare: (p) => p.refine(), act: (p) => p.reset() },
};

/** The chiral gallium complex measured at two equivalents: non-centrosymmetric, so it inverts, and its equivalents merge. */
const chiral = (): SingleCrystalAgentPort => {
  const c = chiralPage({ equivalents: 2 });
  return singleCrystalPort(c.structure, c.dataset).port;
};

const SINGLE_CRYSTAL: Table<SingleCrystalAgentPort> = {
  ...RUNS,
  setFixed: { act: (p) => p.setFixed([{ id: firstFixed(p), fixed: false }]) },
  setAdpModel: { act: (p) => p.setAdpModel(true) },
  setExtinctionModel: { act: (p) => p.setExtinctionModel("bc-1-lorentzian") },
  setRiding: {
    page: () => {
      const c = pyridylPage();
      return singleCrystalPort(c.structure, c.dataset).port;
    },
    act: (p) => p.setRiding(true),
  },
  setWeighting: { act: (p) => p.setWeighting({ a: 0.05, b: 0.2 }) },
  setTwinLaws: { act: (p) => p.setTwinLaws([{ matrix: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]] }]) },
  setParameterTies: {
    act: (p) => p.setParameterTies({ equal: p.state().parameters.filter((q) => q.kind === "bIso").slice(0, 2).map((q) => q.id) }),
  },
  setDistanceRestraints: {
    act: (p) => p.setDistanceRestraints([{ kind: "dfix", target: 2.0, sigma: 0.02, pairs: [{ from: "Ga2", to: "N1", op: 0, cell: [0, 0, 0] }] }]),
  },
  invertStructure: { act: (p) => p.invertStructure() },
  setMerged: { act: (p) => p.setMerged(true) },
  setRadiation: { act: (p) => p.setRadiation({ wavelength: 0.7 }) },
  setOmitted: {
    act: (p) => {
      const r = p.state().rows[0]!;
      p.setOmitted([{ h: r.h, k: r.k, l: r.l, reason: "test" }]);
    },
  },
  setResolution: { act: (p) => p.setResolution({ dMin: 0.9 }) },
  setOutlierFilter: { act: (p) => p.setOutlierFilter({ on: !p.state().outlierFilter.on, cutoffSigma: 5 }) },
  reset: {
    page: () => {
      const c = corundumPage();
      return singleCrystalPort(c.structure, c.dataset).port;
    },
    prepare: (p) => p.refine(),
    act: (p) => p.reset(),
  },
};

/** The functions an object offers: a port's setters and runs. */
const functionsOf = (o: object): string[] => Object.entries(o).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();

/** Each function of `port` either listed as not a setting, or a setter whose act moves the stamp. */
async function unseen<P extends AgentPort>(table: Table<P>, page: () => P): Promise<string[]> {
  const missing = functionsOf(page()).filter((name) => table[name as keyof P] === undefined);
  expect(missing, "setters with no entry in the table").toEqual([]);
  const out: string[] = [];
  for (const [name, entry] of Object.entries(table) as [string, Entry<P> | string][]) {
    if (typeof entry === "string") continue;
    const port = (entry.page ?? page)();
    await entry.prepare?.(port);
    const before = stampOf(port);
    await entry.act(port);
    if (stampOf(port) === before) out.push(name);
  }
  return out;
}

describe("the stamp a change is approved against", () => {
  it("moves with every setter on the powder page", async () => {
    expect(await unseen(POWDER, powder)).toEqual([]);
  }, 60_000);

  it("moves with every setter of the powder page's magnetic step", async () => {
    const missing = functionsOf(step(magneticPage())).filter((name) => MAGNETIC[name as keyof MagneticAgentHandle] === undefined && MAGNETIC_SETTERS[name as keyof MagneticAgentHandle] === undefined);
    expect(missing, "setters with no entry in the table").toEqual([]);
    const out: string[] = [];
    for (const [name, entry] of Object.entries(MAGNETIC_SETTERS) as [string, Entry<PowderAgentPort>][]) {
      const port = magneticPage();
      await entry.prepare?.(port);
      const before = stampOf(port, true);
      await entry.act(port);
      if (stampOf(port, true) === before) out.push(name);
    }
    expect(out).toEqual([]);
  }, 60_000);

  it("moves with every setter on the PDF page", async () => {
    expect(await unseen(PDF, () => pdfPort().port)).toEqual([]);
  }, 60_000);

  it("moves with every setter on the single-crystal page", async () => {
    expect(await unseen(SINGLE_CRYSTAL, chiral)).toEqual([]);
  }, 60_000);
});

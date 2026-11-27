// @vitest-environment happy-dom
/**
 * The powder workbench, mounted as the shell mounts it (inside its
 * WorkbenchErrorBoundary), on a page whose reflection list passes the
 * engine's limit (app/reflectionLimit.ts): a user's five-bank instrument
 * file held on data bank 6, whose short times of flight reach d 0.034 Å for
 * GaTa₄Se₈. The error boundary never fires: the plot and the Validation view
 * show the sentence, Refine is held, and the Data card's chooser takes the
 * page back to bank 5, whose fit returns. And the user's flow: the NOMAD
 * 2023A default held at bank 4 on data bank 6, whose list stops at the
 * file's profile end but whose width note listed past the limit. Synthetic
 * data.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { parseCif } from "@/parsers/cif";
import { parseGsasHistogramPattern } from "@/parsers/gsasHistogram";
import { emptyPage, withInstrumentFile, withPattern, withStructure, type PowderPage } from "@/app/powderPage";
import { landData } from "@/app/bankKeep";
import { PowderWorkbench } from "@/app/PowderWorkbench";
import { WorkbenchErrorBoundary } from "@/app/ui/WorkbenchErrorBoundary";
import { ComputeClient } from "@/workers/computeClient";
import { DEFAULT_INSTRUMENTS } from "@/app/defaultInstruments";
import { FIVE_BANK_INSTPRM, NOMAD_STYLE_BANKS, multiBankGsa } from "@/testSupport/instprmFixtures";

vi.setConfig({ testTimeout: 120_000 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The plot measures its box; happy-dom has no layout.
globalThis.ResizeObserver ??= class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver;

const structure = parseCif(readFileSync("examples/mcp/gata4se8.cif", "utf8"));
const NAME = "made_up.gsa";
const GSA = multiBankGsa([
  { bank: 1, difC: 1215.5, tth: 20 }, { bank: 2, difC: 3310.5, tth: 40 }, { bank: 3, difC: 6100.5, tth: 75 },
  { bank: 4, difC: 7755.5, tth: 110.5 }, { bank: 5, difC: 10240.5, tth: 160, points: 200 }, { bank: 6, difC: 640.5, tth: 10, start: 350, points: 200 },
]);
const toBank = (p: PowderPage, bank: number, text = GSA): PowderPage =>
  withPattern(p, parseGsasHistogramPattern(text, "d", NAME, { bank, radiation: { kind: "neutron-tof" } }), { name: NAME, text, bank });
const onFive = (): PowderPage => withInstrumentFile(toBank(withStructure(emptyPage(), structure), 5), "mine.instprm", FIVE_BANK_INSTPRM).page;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** The shell's mount: the page in state, the Data card's chooser landing the new bank as App.onDataBank does. */
function Shell({ start, text = GSA }: { readonly start: PowderPage; readonly text?: string }): ReactElement {
  const [page, setPage] = useState(start);
  const [client] = useState(() => new ComputeClient());
  return createElement(WorkbenchErrorBoundary, {
    resetKeys: [page.session],
    children: createElement(PowderWorkbench, {
      page, setPage, ownStructure: true, client, active: true, step: 0, onStep: () => undefined, setMessage: () => undefined,
      exportsRef: { current: null }, onLoadData: () => undefined, onLoadCif: () => undefined, onAddPhase: () => undefined,
      onRemovePhase: () => undefined, onClearStructures: () => undefined, onLoadInstrument: () => undefined,
      onDataBank: (bank: number) => setPage((p) => landData(p, toBank(p, bank, text), `Loaded data ${NAME}, bank ${bank}`, "chooser").page),
    }),
  });
}

const text = (): string => host?.textContent ?? "";
const alerts = (): Element[] => [...(host?.querySelectorAll("[role=alert]") ?? [])];
const limit = (): string[] => [...(host?.querySelectorAll("[data-testid=reflection-limit]") ?? [])].map((e) => e.textContent ?? "");
const button = (label: string): HTMLButtonElement | undefined => [...(host?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label);

describe("the workbench past the reflection limit", () => {
  it("bank 5 → 6 shows the sentence, not the error boundary; Refine is held; the chooser goes back to 5", async () => {
    const five = onFive();
    const six = landData(five, toBank(five, 6), `Loaded data ${NAME}, bank 6`, "chooser").page;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(Shell, { start: six })));
    expect(alerts().map((a) => a.textContent)).toEqual([]);
    expect(text()).not.toContain("cannot be calculated");
    const sentence = "Bank 6's data at this instrument calibration reach d 0.034 Å: 2.2×10⁸ hkl to scan, over the limit. Load the instrument file for bank 6, or narrow the window.";
    expect(limit()).toEqual([sentence]);
    // Refine is held.
    expect(button("Refine")!.disabled).toBe(true);
    // The Validation view: the sentence in place of the verdict.
    await act(async () => button("Validation")!.click());
    expect(alerts()).toEqual([]);
    expect(limit()).toEqual([sentence]);
    await act(async () => button("Refinement")!.click());
    // The Data card's chooser back to bank 5: the instrument follows, the fit returns.
    const chooser = host.querySelector<HTMLSelectElement>("[data-testid=data-bank]")!;
    await act(async () => {
      chooser.value = "5";
      chooser.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(alerts()).toEqual([]);
    expect(limit()).toEqual([]);
    expect(text()).toMatch(/wR\s*\d+\.\d\d%/);
    expect(button("Refine")!.disabled).toBe(false);
  });

  it("the user's flow: the NOMAD default, data bank 4 → 6, shows the page with the hold, not the error boundary; back to 4", async () => {
    const NOMAD = DEFAULT_INSTRUMENTS.find((d) => d.instrument === "NOMAD")!;
    const TEXT = readFileSync("examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm", "utf8");
    const STARTS: Readonly<Record<number, number>> = { 1: 449, 2: 720, 3: 735, 4: 1137, 5: 1246, 6: 351 };
    const NOMAD_GSA = multiBankGsa(NOMAD_STYLE_BANKS.map((b) => ({ ...b, start: STARTS[b.bank]!, points: 400 })), ["# Instrument: NOMAD"]);
    const four = withInstrumentFile(toBank(withStructure(emptyPage(), structure), 4, NOMAD_GSA), NOMAD.fileName, TEXT, { bundledDefault: NOMAD.id }).page;
    const six = landData(four, toBank(four, 6, NOMAD_GSA), `Loaded data ${NAME}, bank 6`, "chooser").page;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(Shell, { start: six, text: NOMAD_GSA })));
    expect(alerts().map((a) => a.textContent)).toEqual([]);
    // The model's list stops at the file's profile end: the plot draws it, Refine is held for the bank.
    expect(limit()).toEqual([]);
    expect(text()).toContain("Refine is off: no instrument bank for data bank 6");
    expect(text()).toContain("the reflections there are not drawn");
    expect(button("Refine")!.disabled).toBe(true);
    const chooser = host.querySelector<HTMLSelectElement>("[data-testid=data-bank]")!;
    await act(async () => {
      chooser.value = "4";
      chooser.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(alerts()).toEqual([]);
    expect(text()).not.toContain("Refine is off");
    expect(button("Refine")!.disabled).toBe(false);
  });
});

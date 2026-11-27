import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { PowderPattern } from "@/core/diffraction/types";
import { parseInstrumentFile, parseInstrumentParameters } from "@/parsers/instrument";
import { CALIBRATION_STANDARDS, standardStructure } from "@/core/diffraction/calibrationStandards";
import { loadedSession, type Session } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import { liveTool } from "@/agent/tools";

/**
 * export_instrument on a page holding a synthetic silicon standard (two banks
 * of GSAS-II-simulated SRM 640e, src/testSupport/calibrationKnownTruth.json):
 * every bank of the data file calibrated from the loaded instrument file, the
 * file offered with a #Bank N block per clean bank, a flagged bank left out,
 * and nothing on the page changed.
 */
interface Case { bank: number; x: number[]; yNoisy: number[]; truth: Record<string, number>; startInstprm: string }
const TRUTH = JSON.parse(readFileSync(fileURLToPath(new URL("../testSupport/calibrationKnownTruth.json", import.meta.url)), "utf8")) as { cases: Record<string, Case> };
const BANKS = [TRUTH.cases.si640e_bank2!, TRUTH.cases.si640e_bank3!];

/** The two banks as one GSAS histogram file (FXYE), as a reduction writes it. */
const GSA = ["Synthetic SRM 640e, two banks", ...BANKS.flatMap((c) => [
  `BANK ${c.bank} ${c.x.length} ${c.x.length} SLOG ${c.x[0]} ${c.x[c.x.length - 1]} 0.0004 0 FXYE`,
  ...c.x.map((x, i) => `${x} ${c.yNoisy[i]} ${Math.sqrt(Math.max(c.yNoisy[i]!, 1))}`),
])].join("\n") + "\n";
const INSTPRM = BANKS.map((c) => c.startInstprm).join("");

function page(): { port: ReturnType<typeof sessionPort>["port"]; files: { name: string; text: string }[]; run: (input: Record<string, unknown>) => Promise<Record<string, unknown>> } {
  const c = BANKS[0]!;
  const instrument = parseInstrumentParameters(INSTPRM, c.bank);
  const pattern: PowderPattern = {
    id: "si", name: "si640e.gsa", xUnit: "tof", radiation: { kind: "neutron-tof" } as PowderPattern["radiation"],
    points: c.x.map((x, i) => ({ x, yObs: c.yNoisy[i]!, sigma: Math.sqrt(Math.max(c.yNoisy[i]!, 1)) })),
  };
  const structure = standardStructure(CALIBRATION_STANDARDS.si640e, 5.431179);
  const session: Session = { ...loadedSession(structure, pattern, instrument), rawData: { name: "si640e.gsa", text: GSA, bank: c.bank }, rawInstrument: { name: "start.instprm", text: INSTPRM, bank: c.bank } };
  const { port } = sessionPort(session, instrument, { instrumentOnPage: true });
  const { host, files } = fakeHost(port);
  const { ex } = executor(host, true);
  return {
    port, files,
    run: async (input) => {
      const text = (await ex.run("export_instrument", input)).text;
      return text.startsWith("{") ? JSON.parse(text) as Record<string, unknown> : { error: text };
    },
  };
}

describe("export_instrument", () => {
  it("is offered when the user's words ask for a calibration, and changes nothing on the page", () => {
    const spec = liveTool("export_instrument")!;
    expect(spec.effect).toBe("compute");
    expect(spec.offer?.asked).toEqual(["calibration"]);
  });

  it("calibrates every bank of the data file, writes the clean bank, and leaves out a flagged one unless it is named", async () => {
    const { port, files, run } = page();
    const before = port.state().parameters.map((p) => [p.id, p.value, p.fixed]);
    const answer = await run({ standard: "si640e", temperatureK: 295.65 });
    if (process.env.MATERIA_CAL_DEBUG) console.log(JSON.stringify(answer, null, 1));
    const banks = answer.banks as { bank: number; written: boolean; window: { dMin: number }; terms: Record<string, { value: number; esd?: number; held?: boolean }>; flags: string[] }[];
    expect(banks.map((b) => b.bank)).toEqual([2, 3]);
    for (const b of banks) expect(b.window.dMin).toBeGreaterThan(0.5);
    // Bank 3 (high resolution): clean, written, every calibration term within 3 esd of the truth.
    const b3 = banks[1]!;
    expect(b3.written).toBe(true);
    expect(b3.flags).toEqual([]);
    for (const t of ["difC", "Zero", "difA"]) expect(Math.abs(b3.terms[t]!.value - BANKS[1]!.truth[t]!) / b3.terms[t]!.esd!, `bank 3 ${t}`).toBeLessThan(3);
    // Bank 2 (low resolution, silicon's 27 lines): the decay and difA trade at |ρ| ≥ 0.95, so the bank is flagged, not forced.
    const b2 = banks[0]!;
    expect(b2.written).toBe(false);
    expect(b2.flags.some((f) => /^Not separable: at the end /.test(f))).toBe(true);
    expect(answer.file).toBe("si640e_calibrated_si640e.instprm");
    expect(files.map((f) => f.name)).toEqual(["si640e_calibrated_si640e.instprm"]);
    expect(parseInstrumentFile(files[0]!.text).banks.map((b) => b.bank)).toEqual([3]);
    expect(files[0]!.text.split("\n")[0]).toMatch(/^#Bank 3: GSAS-II instrument parameter file; do not add\/delete items! Calibrated by MATERIA [\d.]+ from NIST SRM 640e \(Si\), a = 5\.431179 A held \(at 295\.65 K\); GSAS-II convention/);
    // The page is as it was: the calibration ran on its own copies.
    expect(port.state().parameters.map((p) => [p.id, p.value, p.fixed])).toEqual(before);
  }, 600_000);

  it("asks for the cell away from the certificate's temperature, and refuses LaB₆ and constant wavelength for now", async () => {
    const { files, run } = page();
    const warm = await run({ standard: "si640e", temperatureK: 300 });
    expect(JSON.stringify(warm)).toMatch(/needs Si's thermal expansion.*Ask the user for the standard's cell at that temperature and pass it as latticeA/);
    const lab6 = await run({ standard: "lab6660c", temperatureK: 295.65 });
    expect(JSON.stringify(lab6)).toMatch(/LaB₆ \(SRM 660c\) is not calibrated yet/);
    expect(files).toHaveLength(0);
  });
});

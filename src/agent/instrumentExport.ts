/**
 * export_instrument: calibrate the instrument against a line-position standard
 * loaded on the powder page, bank by bank, and offer the calibrated GSAS-II
 * `.instprm` to the user (app/instrumentCalibration.ts, core/export/gsas2.ts).
 *
 * The calibration runs here, on its own copy of each bank: nothing on the page
 * changes, and difC, difA and the zero are refined nowhere else (a sample
 * refinement still holds them, structureRefinement.ts).
 */

import type { PowderLiveState } from "@/agent/port";
import type { PowderPattern } from "@/core/diffraction/types";
import { CALIBRATION_STANDARDS, latticeAt, standardStructure, type CalibrationStandardId } from "@/core/diffraction/calibrationStandards";
import { calibratedInstprm } from "@/core/export/gsas2";
import { calibrateTofBank, CALIBRATED_TERMS, type TofCalibrationResult, type TofInstrument } from "@/app/instrumentCalibration";
import { tofFileProfileOf } from "@/app/powderSpec";
import { dataBankRef, dataBanksOf, matchingInstrumentBank } from "@/app/bankChoice";
import { parseInstrumentFile, type InstrumentBank } from "@/parsers/instrument";
import { APP_VERSION } from "@/app/constants";

export interface ExportInstrumentInput {
  readonly standard: CalibrationStandardId;
  readonly temperatureK: number;
  readonly latticeA?: number;
  readonly banks?: readonly number[];
}

/** One bank to calibrate: its data, the starting instrument, and the starting file's lines. */
interface BankJob {
  readonly bank: number;
  readonly pattern: PowderPattern;
  readonly start: TofInstrument;
  readonly texts?: ReadonlyMap<string, string>;
  readonly fitRange?: { readonly min: number; readonly max: number };
}

/** Plain ASCII for the file's header line. */
const STANDARD_ASCII: Readonly<Record<CalibrationStandardId, string>> = { si640e: "NIST SRM 640e (Si)", lab6660c: "NIST SRM 660c (LaB6, 11B)" };

/** Run export_instrument on the page's state; `save` offers the file. */
export function exportInstrument(s: PowderLiveState, input: ExportInstrumentInput, save?: (name: string, text: string) => void): Record<string, unknown> {
  if (s.pattern.xUnit !== "tof") throw new Error("time-of-flight data only: a constant-wavelength calibration is not available yet");
  if (input.standard === "lab6660c") throw new Error("LaB₆ (SRM 660c) is not calibrated yet: its boron position x is not fixed by symmetry and how to treat it is still open. Use silicon (SRM 640e)");
  const standard = CALIBRATION_STANDARDS[input.standard];
  const lattice = latticeAt(standard, input.temperatureK);
  let a: number;
  let cellNote: string;
  if (input.latticeA !== undefined) {
    a = input.latticeA;
    cellNote = `a = ${a} Å, the cell the user gave for ${input.temperatureK} K (the certificate: ${standard.certifiedA} Å at ${standard.certificateTemperatureK} K).`;
  } else if (lattice.kind === "needsExpansion") {
    throw new Error(`${lattice.note} Ask the user for the standard's cell at that temperature and pass it as latticeA, or for data taken at 22.5 °C`);
  } else {
    a = lattice.a;
    cellNote = lattice.note;
  }
  const jobs = bankJobs(s);
  const wanted = input.banks ? jobs.filter((j) => input.banks!.includes(j.bank)) : jobs;
  if (wanted.length === 0) throw new Error(`no data bank ${input.banks?.join(", ")}: the data have bank${jobs.length > 1 ? "s" : ""} ${jobs.map((j) => j.bank).join(", ")}`);

  const structure = standardStructure(standard, a);
  const results = wanted.map((j) => ({ job: j, result: calibrateTofBank({ structure, pattern: j.pattern, start: j.start, ...(j.fitRange ? { fitRange: j.fitRange } : {}) }) }));
  const clean = (r: TofCalibrationResult): boolean => r.status === "calibrated" && r.separable && r.settled && !r.flags.some((f) => f.startsWith("Low statistics") || f.startsWith("Stopped"));
  const written = results.filter(({ job, result }) => result.status === "calibrated" && (clean(result) || input.banks?.includes(job.bank)));
  const base = (s.files?.data?.name ?? s.source).replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "_") || "instrument";
  const name = `${base}_calibrated_${input.standard}.instprm`;
  if (written.length > 0 && save) {
    save(name, calibratedInstprm(written.map(({ job, result }) => ({ bank: job.bank, instrument: result.instrument, ...(job.texts ? { texts: job.texts } : {}) })), {
      software: `MATERIA ${APP_VERSION}`, standard: STANDARD_ASCII[input.standard], a, temperatureK: input.temperatureK,
    }));
  }
  return {
    file: written.length > 0 ? (save ? name : `${name} (not offered: nothing here can save a file)`) : null,
    standard: standard.name,
    cell: cellNote,
    convention: "GSAS-II's: the standard's cell held; its sample terms held at size 1 µm and Lorentzian microstrain 1000 (×10⁻⁶); the instrument's profile is what is left.",
    banks: results.map(({ job, result }) => bankView(job.bank, result, written.some((w) => w.job.bank === job.bank))),
    note: "Each esd is conditional on the other group held (the instrument's terms with U_iso held, and U_iso with them held). A bank with a flag is left out of the file unless `banks` names it. TOF fits start at d ≥ 0.5 Å plus four peak widths: no reflection is calculated below 0.5 Å.",
  };
}

/** What the model reads of one bank. */
function bankView(bank: number, r: TofCalibrationResult, written: boolean): Record<string, unknown> {
  if (r.status !== "calibrated") return { bank, written: false, flags: r.flags };
  const terms: Record<string, unknown> = {};
  for (const t of CALIBRATED_TERMS) {
    const v = r.terms[t];
    if (!v) continue;
    terms[t] = v.refined ? { value: Number(v.value.toPrecision(8)), esd: Number(v.esd.toPrecision(2)), start: Number(v.start.toPrecision(8)) } : { value: Number(v.value.toPrecision(8)), held: true };
  }
  return {
    bank, written,
    window: { dMin: Number(r.window.dMin.toFixed(3)), dMax: Number(r.window.dMax.toFixed(3)), unit: "Å" },
    reflections: r.reflections,
    wR: Number(r.wR.toFixed(2)), gof: Number(r.gof.toFixed(2)),
    terms,
    uiso: Object.fromEntries(Object.entries(r.uiso).map(([site, u]) => [site, { value: Number(u.value.toPrecision(4)), esd: Number(u.esd.toPrecision(2)) }])),
    flags: r.flags,
  };
}

/** Every bank of the loaded data, each with its starting instrument (paired as the Instrument card pairs them). */
function bankJobs(s: PowderLiveState): BankJob[] {
  const file = s.files?.instrument ? parseInstrumentFile(s.files.instrument.text) : null;
  const pageBank = s.files?.data?.bank;
  const startOf = (bank: number, difC?: number): { start: TofInstrument; texts?: ReadonlyMap<string, string> } => {
    const chosen: InstrumentBank | null = file ? matchingInstrumentBank(file, { bank, ...(difC !== undefined ? { difC } : {}) }) : null;
    const start = (chosen?.parameters ?? (bank === pageBank || pageBank === undefined ? s.instrument : null)) as TofInstrument | null;
    if (!start || start.kind !== "tof" || !tofFileProfileOf(start)) {
      throw new Error(`bank ${bank}: no starting instrument with a TOF profile. A GSAS-II .instprm for this instrument (alpha, beta-0, sig-1 and the rest) is the starting point; load it on the Instrument card`);
    }
    return { start, ...(chosen && chosen.texts.size > 0 ? { texts: chosen.texts } : {}) };
  };
  const banks = dataBanksOf(s.files?.data?.text);
  if (!banks || banks.length <= 1) {
    const bank = pageBank ?? banks?.[0]?.bankNumber ?? 1;
    return [{ bank, pattern: s.pattern, ...startOf(bank, banks?.[0]?.meta?.difC), ...(s.fitRange ? { fitRange: s.fitRange } : {}) }];
  }
  return banks.filter((b) => b.xUnit === "tof").map((b) => {
    const page = b.bankNumber === (pageBank ?? banks[0]!.bankNumber);
    const pattern: PowderPattern = page ? s.pattern : { id: `bank${b.bankNumber}`, name: `bank ${b.bankNumber}`, xUnit: "tof", radiation: s.pattern.radiation, points: b.points };
    const ref = dataBankRef(b);
    return { bank: b.bankNumber, pattern, ...startOf(b.bankNumber, ref?.difC), ...(page && s.fitRange ? { fitRange: s.fitRange } : {}) };
  });
}

/**
 * Default instrument parameter files shipped with the app: a facility's own
 * calibration file for one instrument and one run cycle, offered on the
 * Instrument card when the loaded data name that instrument and no instrument
 * file is loaded. Nothing is applied without the click, and while a default is
 * in use the card, the report and an exported bundle say so: a calibration
 * belongs to its run cycle, and the default is for a first look.
 *
 * One row per instrument. To add one: put the facility's file under
 * `examples/instruments/<instrument>/` with a README on its origin, and add a
 * row here. The file's text is imported on demand (its own small chunk), so it
 * is not part of the first load. Once applied, the text is kept in the session
 * like any loaded instrument file (`rawInstrument`), with the row's `id` beside
 * it (`rawInstrument.bundledDefault`): a saved project reopens without the
 * bundle, and the statement comes back with it.
 */

import type { PowderPattern } from "@/core/diffraction/types";
import { instrumentOfDataHeader } from "@/parsers/instrumentRegistry";
import { DIFC_TOLERANCE, instrumentFileOf, matchingInstrumentBank, type DataBankRef } from "@/app/bankChoice";

export interface DefaultInstrument {
  /** Kept with the file in the session and the project (`rawInstrument.bundledDefault`). Never reuse an id for another file. */
  readonly id: string;
  /** The registry's name of the instrument (parsers/instrumentRegistry.ts). */
  readonly instrument: string;
  /** The run cycle the calibration belongs to. */
  readonly cycle: string;
  /** The file's name, as the facility distributes it. */
  readonly fileName: string;
  /** The file's text, verbatim, fetched when asked for. */
  readonly load: () => Promise<string>;
}

export const DEFAULT_INSTRUMENTS: readonly DefaultInstrument[] = [
  {
    id: "nomad-2023A",
    instrument: "NOMAD",
    cycle: "2023A",
    fileName: "NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm",
    load: () => import("../../examples/instruments/nomad/NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm?raw").then((m) => m.default),
  },
];

/** The table's row of this id, or null (an id a later build no longer has, or none). */
export function defaultInstrumentById(id: string | undefined): DefaultInstrument | null {
  return (id !== undefined ? DEFAULT_INSTRUMENTS.find((d) => d.id === id) : undefined) ?? null;
}

/** What the Instrument card needs of the page to decide on an offer. */
export interface DefaultOfferInput {
  /** The data on the page. */
  readonly pattern: Pick<PowderPattern, "xUnit">;
  /** The loaded data file's text, when the session holds it. */
  readonly rawDataText: string | undefined;
  /** An instrument is loaded on the page (a file, a demo's, a project's). */
  readonly instrumentLoaded: boolean;
}

/**
 * The default to offer, or null: time-of-flight data whose own header names an
 * instrument the table has a file for (`# Instrument: NOMAD`; the file's name
 * is not enough), on a page with no instrument loaded.
 */
export function defaultInstrumentOffer(o: DefaultOfferInput): DefaultInstrument | null {
  if (o.instrumentLoaded || o.pattern.xUnit !== "tof") return null;
  const named = instrumentOfDataHeader(o.rawDataText);
  return (named ? DEFAULT_INSTRUMENTS.find((d) => d.instrument === named.name) : undefined) ?? null;
}

/** The button's label: "Use default NOMAD parameters (2023A)". */
export function defaultOfferLabel(d: DefaultInstrument): string {
  return `Use default ${d.instrument} parameters (${d.cycle})`;
}

/** Behind the offer's "?". */
export function defaultOfferDetail(d: DefaultInstrument): string {
  return `The data file's header names ${d.instrument}, and no instrument file is loaded. This loads the facility's own ${d.cycle} calibration file, shipped with the app, as if you had loaded it yourself. It is for a first look: the calibration changes between run cycles, so load the instrument file for your own run cycle before you trust peak positions and widths.`;
}

/** A data bank the default file has no bank for: said in one line, and the default is not offered for it. */
export interface DefaultUncovered {
  readonly line: string;
  readonly detail: string;
}

/**
 * Whether the default's file has the bank of the data on the page; null when
 * it has (or the data name no bank, or the text cannot be read: the load then
 * says why). A bank the facility left out of its file gets no parameters of
 * another bank: the card says so and offers nothing, and the click is refused
 * the same way. Pairing as for any instrument file (bankChoice.ts): by bank
 * number, checked against the DIFC the data file states.
 */
export function defaultUncovered(d: DefaultInstrument, fileText: string, data: DataBankRef | null): DefaultUncovered | null {
  const file = instrumentFileOf(fileText);
  if (!file || !data || matchingInstrumentBank(file, data)) return null;
  const banks = file.banks.map((b) => b.bank).filter((n): n is number => n !== null);
  return {
    line: `No instrument bank for data bank ${data.bank}: the default ${d.instrument} parameters (${d.cycle}) have banks ${banks.join(", ")}.`,
    detail: `The facility's ${d.cycle} file has ${banks.length > 1 ? `banks ${banks.join(", ")}` : "one bank"}${data.difC !== undefined ? `, none with a difC within ${DIFC_TOLERANCE * 100} % of the data's DIFC ${data.difC.toFixed(1)}` : `, no bank ${data.bank}`}, so no default is offered for this bank and no other bank's parameters are used in its place. Choose a data bank the file covers, or load the instrument file of this bank.`,
  };
}

/** The standing statement while a default is in use: one line, and the reason behind "?". */
export interface DefaultInstrumentWarning {
  /** The Instrument card's title: "NOMAD · default 2023A". */
  readonly title: string;
  readonly line: string;
  readonly detail: string;
  /** The same statement for the report's instrument rows and an exported bundle's README: the line and its reason. */
  readonly report: string;
}

/** A default whose table row is gone still gets a statement: the file was not the user's own. */
export function defaultInstrumentWarning(id: string): DefaultInstrumentWarning {
  const d = defaultInstrumentById(id);
  const what = d ? `Default ${d.instrument} parameters (${d.cycle} calibration)` : `Default instrument parameters (${id})`;
  const why = "The calibration changes between run cycles, and a wrong one shifts peak positions and changes peak widths: results from this fit are a first look, not checked against the instrument's calibration for this measurement.";
  return {
    report: `${what}, the facility's file shipped with MATERIA, not a file loaded for this measurement: load the instrument file for your own run cycle. ${why}`,
    title: d ? `${d.instrument} · default ${d.cycle}` : "Default parameters",
    line: `${what}: load the instrument file for your own run cycle.`,
    detail: `These are the facility's instrument parameters for ${d ? `run cycle ${d.cycle}` : "one run cycle"}, shipped with the app, not a calibration of your measurement. The calibration changes between run cycles; a wrong one shifts peak positions and changes peak widths, and a fit can hide that in the cell, the zero and the sample broadening. Use the default for a first look, and load the instrument file from your own run cycle before you report a result. This line goes when you load your own file.`,
  };
}

/**
 * The statement for the page as it stands, or null: the page's instrument is
 * the one loaded from a bundled default. A user's own file carries no
 * `bundledDefault`, so loading one ends it.
 */
export function defaultInstrumentInUse(rawInstrument: { readonly bundledDefault?: string } | undefined, instrumentLoaded: boolean): DefaultInstrumentWarning | null {
  return instrumentLoaded && rawInstrument?.bundledDefault !== undefined ? defaultInstrumentWarning(rawInstrument.bundledDefault) : null;
}

/** The History step's label for a default applied. */
export function defaultStepLabel(d: DefaultInstrument, bank: number | null): string {
  return `Loaded default ${d.instrument} parameters (${d.cycle})${bank !== null ? `, bank ${bank}` : ""}`;
}

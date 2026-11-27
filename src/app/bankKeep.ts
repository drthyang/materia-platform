/**
 * Refinement values kept across a data-bank switch (owner, 2026-11-27): when
 * the page reads another bank of the same multi-bank data file (the Data
 * card's chooser, or the same file loaded again), every refinement row keeps
 * its value and its free, fixed or tied state: the scale, the background (its
 * type, terms and coefficients), the cell, positions, ADPs, occupancies, the
 * microstructure, the corrections, the added phases and the magnetic rows.
 * The instrument follows the bank (app/bankFollow.ts): the rows the
 * instrument owns, the "Instrument / profile" group that followDataBank's
 * switch re-reads from the file (calibration, zero, file profile, peak shape),
 * take the values of the instrument now on the page. Nothing is refined.
 * Pure: the shell calls these.
 */

import type { RefinementParameter } from "@/core/refinement/types";
import type { Session } from "@/app/powderSession";
import { buildSpecFor, keptBindings, keptRows } from "@/app/powderSession";
import { changed, type PowderPage } from "@/app/powderPage";
import { followDataBank, followStepLabel, loadFollowStepLabel, type BankFollow } from "@/app/bankFollow";
import { parameterGroupOf } from "@/app/ui/parameterGroups";

/** The group whose rows follow the instrument, as bankFollow.switchedRows marks them. */
const INSTRUMENT_GROUP = "Instrument / profile";

/** A row the instrument owns: it takes the new bank's instrument values on a switch. */
export function followsInstrument(p: Pick<RefinementParameter, "kind">): boolean {
  return parameterGroupOf(p.kind) === INSTRUMENT_GROUP;
}

/** A switch between two banks of one data file. */
export interface DataBankSwitch {
  readonly from: number;
  readonly to: number;
}

/**
 * The switch the new data make, or null when they are not another bank of the
 * file on the page: another file, a one-bank file, or the same bank again.
 */
export function dataBankSwitch(before: Session["rawData"], after: Session["rawData"]): DataBankSwitch | null {
  if (!before || !after || before.bank === undefined || after.bank === undefined) return null;
  if (before.text !== after.text || before.bank === after.bank) return null;
  return { from: before.bank, to: after.bank };
}

/** The History step of a switch: "Data bank 4 → 3, refinement values kept". */
export function keptStepLabel(s: DataBankSwitch): string {
  return `Data bank ${s.from} → ${s.to}, refinement values kept`;
}

/** The Data card's line after a switch, until the next action. */
export function keptNote(s: DataBankSwitch): string {
  return `Refinement values kept from bank ${s.from}.`;
}

/** Rows the page cannot refine: TOF data without a TOF calibration, or GSAS-II's own calc shown with them. */
function viewOnly(s: Session): boolean {
  return !!s.powderOverlay || (s.pattern.xUnit === "tof" && s.powderProfile.shape !== "tof");
}

/**
 * `after` (the page on the new bank, the instrument already following it)
 * with `before`'s refinement kept: the settings that shape the rows (added
 * phases, background type and terms, Lorentz, site ties, microstrain model,
 * corrections) and every row the instrument does not own, at its value and
 * its free, fixed or tied state. The instrument's rows are `after`'s. A row's
 * starting value (where Reset goes) is the new bank's. A page whose rows are
 * view-only is returned as it is.
 */
export function withRefinementKept(before: PowderPage, after: PowderPage): PowderPage {
  const b = before.session;
  const a = after.session;
  if (viewOnly(a) || viewOnly(b)) return after;
  const backgroundType = b.powderProfile.backgroundType;
  const spec = buildSpecFor(b.structure, b.extraPhases, a.pattern, after.instrument, b.powderProfile.lorentz ?? true, b.backgroundTerms, b.siteTies, b.mustrain ?? "isotropic", b.corrections, backgroundType);
  const starting = new Map(spec.params.map((p) => [p.id, p.initialValue]));
  const rows = keptRows(spec.params, b.powderParams.filter((p) => !followsInstrument(p)))
    .map((p) => (starting.has(p.id) && !followsInstrument(p) ? { ...p, initialValue: starting.get(p.id)! } : p));
  return changed(after, {
    ...a,
    extraPhases: b.extraPhases,
    backgroundTerms: b.backgroundTerms,
    siteTies: b.siteTies,
    ...(b.mustrain !== undefined ? { mustrain: b.mustrain } : {}),
    ...(b.corrections !== undefined ? { corrections: b.corrections } : {}),
    powderParams: rows,
    powderBindings: keptBindings(spec.bindings, b.powderBindings),
    powderProfile: { ...spec.profile, ...(backgroundType ? { backgroundType } : {}) },
  });
}

/** New data landed on the page: the page, its History step's label, and what happened to the instrument and the refinement. */
export interface DataLanding {
  readonly page: PowderPage;
  readonly label: string;
  /** The instrument followed the data's bank (app/bankFollow.ts). */
  readonly follow: BankFollow | null;
  /** Another bank of the same file, the refinement values kept. */
  readonly kept: DataBankSwitch | null;
}

/**
 * `next` (the page with the new data, App.applyPowder's withPattern) as it
 * lands, `before` the page it replaces: the instrument follows the data's
 * bank, and when the data are another bank of the file on the page, by the
 * Data card's chooser ("chooser") or the same file loaded again ("load"),
 * the refinement values are kept, in one step "Data bank N → M, refinement
 * values kept". `dataLabel`: the step of any other load.
 */
export function landData(before: PowderPage, next: PowderPage, dataLabel: string, how: "chooser" | "load"): DataLanding {
  const follow = followDataBank(next);
  const onBank = follow ? follow.page : next;
  const asked = dataBankSwitch(before.session.rawData, next.session.rawData);
  const page = asked ? withRefinementKept(before, onBank) : onBank;
  // View-only rows (no TOF calibration) are not kept: nothing to say of them.
  const kept = asked && page !== onBank ? asked : null;
  const label = kept ? keptStepLabel(kept) : !follow ? dataLabel : how === "chooser" ? followStepLabel(follow.bank, follow.dataBank) : loadFollowStepLabel(dataLabel, follow.bank);
  return { page, label, follow, kept };
}

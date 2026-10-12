/**
 * The Agent drawer's width, which the user drags (the handle on its left
 * edge) and the browser remembers. The page beside it always keeps
 * PAGE_MIN: the drawer is a companion to the analysis, never a cover for it.
 * Pure, so the bounds are tested without a browser.
 */

import { SHEET_KEY, WIDTH_KEY } from "@/agent/storage";

/** Narrower, and the tool cards' preview lines wrap word by word. */
export const DRAWER_MIN = 320;
/** Wider, and a line of the conversation runs past comfortable reading length. */
export const DRAWER_MAX = 760;
/** What the page keeps beside the drawer: its cards and the plot side by side. */
export const PAGE_MIN = 760;
/** One arrow-key step on the handle. */
export const KEY_STEP = 24;

/** A width the drawer may take in a window `viewport` CSS px wide. */
export function clampDrawerWidth(width: number, viewport: number): number {
  const max = Math.max(DRAWER_MIN, Math.min(DRAWER_MAX, viewport - PAGE_MIN));
  return Math.round(Math.min(max, Math.max(DRAWER_MIN, width)));
}

/** The width the user last chose, or null for the default. */
export function readDrawerWidth(store: Pick<Storage, "getItem">): number | null {
  try {
    const raw = store.getItem(WIDTH_KEY);
    const w = raw === null ? NaN : Number(raw);
    return Number.isFinite(w) && w >= DRAWER_MIN && w <= DRAWER_MAX ? w : null;
  } catch {
    return null;
  }
}

/** Remember a width (null forgets it: the default again). Storage may be unavailable. */
export function writeDrawerWidth(store: Pick<Storage, "setItem" | "removeItem">, width: number | null): void {
  try {
    if (width === null) store.removeItem(WIDTH_KEY);
    else store.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Private mode or blocked storage: the width lasts for this visit.
  }
}

// ── where the drawer sits ───────────────────────────────────────────────────

/**
 * Docked beside the page when the window has the room (a laptop, a desktop,
 * a tablet held landscape), else a bottom sheet under it (a portrait tablet,
 * a phone). Either way it never covers the page: what the Agent points at
 * stays in view. The same rule as SHEET_QUERY, for code that needs the mode.
 */
export type DockMode = "docked" | "sheet";
export function dockModeFor(width: number, height: number): DockMode {
  return width >= 1000 || (width >= 900 && width > height) ? "docked" : "sheet";
}
/** dockModeFor as a media query (CSS px): true where the drawer is a sheet. */
export const SHEET_QUERY = "(max-width: 899.98px), (max-width: 999.98px) and (orientation: portrait)";

/** The sheet's height, a share of the window: enough for a few cards, never the whole page. */
export const SHEET_MIN = 0.3;
export const SHEET_MAX = 0.85;
export const SHEET_DEFAULT = 0.46;
export const clampSheet = (fraction: number): number => Math.min(SHEET_MAX, Math.max(SHEET_MIN, Number.isFinite(fraction) ? fraction : SHEET_DEFAULT));

/** The sheet height the user last dragged to, or null for the default. */
export function readSheet(store: Pick<Storage, "getItem">): number | null {
  try {
    const raw = store.getItem(SHEET_KEY);
    const f = raw === null ? NaN : Number(raw);
    return Number.isFinite(f) ? clampSheet(f) : null;
  } catch {
    return null;
  }
}

export function writeSheet(store: Pick<Storage, "setItem">, fraction: number): void {
  try {
    store.setItem(SHEET_KEY, String(Math.round(clampSheet(fraction) * 1000) / 1000));
  } catch {
    // Storage unavailable: the height lasts for this visit.
  }
}

/**
 * The sheet lowered (for now, not below its minimum) so a card the Agent
 * points at, `cardHeight` px tall, fits in the page above it: the share of a
 * `viewport` px window the sheet may then take. A card that would not fit
 * even with the sheet at its minimum (the plot on a phone) leaves the sheet
 * where it is: lowering it would hide the conversation and still not show
 * the card.
 */
export function sheetFor(fraction: number, cardHeight: number, pageHeight: number, viewport: number): number {
  const short = cardHeight - pageHeight + 12;
  if (!(short > 0) || !(viewport > 0)) return clampSheet(fraction);
  const lowered = fraction - short / viewport;
  return lowered < SHEET_MIN ? clampSheet(fraction) : lowered;
}

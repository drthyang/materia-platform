/**
 * The seam between the irreps the engine computes and the labels people and
 * the Agent read (THY-73; ADR 0004).
 *
 * The engine numbers the irreps of a star in THY-64's total order
 * (irrepOrder.ts) and gives each a fingerprint: the parent's setting, the
 * star's name, the dimension, the reality, and the small representation's
 * characters on THY-64's fixed list of elements, rounded to 1e-3. The label
 * shown comes from the active provider, which sees the fingerprint and the
 * generic label ("Δ (0, 0, 1/2) irrep 2 of 4") and may give its own, or
 * return null to keep the generic one.
 *
 * The default provider gives the generic labels. A table-based provider can
 * be added later without touching the engine, the order or saved projects: CDML
 * labels from a table the project is permitted to ship, or read from an ISO-IR
 * file the user supplies locally. It matches by fingerprint
 * ({@link fingerprintTableProvider}), and an irrep it does not know keeps its
 * generic label. Saved projects store labels as text and are not re-labelled.
 * No table ships today (ADR 0004: the CDML numbering needs permission).
 */

import type { Complex, Vec3 } from "@/core/math/types";
import type { KVectorName } from "@/core/crystal/irreps/kVectorNames";

export type IrrepReality = "real" | "pseudoreal" | "complex";

/** What identifies a computed irrep to a label provider (see the module comment). */
export interface IrrepFingerprint {
  /** The parent's setting: the extended H–M symbol of the tabulated setting its operations are ("P m -3 m", "F d -3 m:2"), or null. */
  readonly setting: string | null;
  /** The star's name as the app writes it: "R", "Δ (0, 0, 1/2)", "k = (1/3, 0, 0)". */
  readonly star: string;
  /** The k-vector's CDML label and kind ("Δ", a line), or null where it has none. */
  readonly kVector: KVectorName | null;
  /** The arm the small representation is at (conventional reciprocal basis). */
  readonly k: Vec3;
  readonly dim: number;
  readonly smallDim: number;
  readonly reality: IrrepReality;
  /** THY-64's fixed list: each element of the little co-group as "W|w" (rotation rows, translation). */
  readonly elements: readonly string[];
  /** The small representation's characters on those elements, rounded to 1e-3. */
  readonly characters: readonly Complex[];
  /** Everything above in one string: a table's key. */
  readonly key: string;
}

export interface IrrepLabelProvider {
  /** Shown in the ADR and tests; "generic" for the default. */
  readonly id: string;
  /** One irrep's label, or null to keep the generic one. */
  label(fingerprint: IrrepFingerprint, generic: string): string | null;
  /** A complex pair's physically irreducible label (CDML writes "W3W4"), or null to keep the generic one. */
  pairLabel?(a: IrrepFingerprint, b: IrrepFingerprint, generic: string): string | null;
}

/** The default: the generic labels, "<k-name> irrep n of m". */
export const GENERIC_IRREP_LABELS: IrrepLabelProvider = { id: "generic", label: () => null };

let active: IrrepLabelProvider = GENERIC_IRREP_LABELS;

/** The provider in force. */
export const irrepLabelProvider = (): IrrepLabelProvider => active;

/** Puts a provider in force (null: back to the generic labels). Irreps computed before keep the labels they were given. */
export function setIrrepLabelProvider(provider: IrrepLabelProvider | null): void {
  active = provider ?? GENERIC_IRREP_LABELS;
}

/** One irrep's label from the provider in force, else the generic one. */
export function irrepLabelFor(fingerprint: IrrepFingerprint, generic: string): string {
  return active.label(fingerprint, generic) ?? generic;
}

/** A complex pair's label from the provider in force, else the generic one. */
export function pairLabelFor(a: IrrepFingerprint, b: IrrepFingerprint, generic: string): string {
  return active.pairLabel?.(a, b, generic) ?? generic;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000 + 0;

/** A fingerprint from its parts, with the characters rounded and its key. */
export function makeFingerprint(parts: Omit<IrrepFingerprint, "key" | "characters"> & { readonly characters: readonly Complex[] }): IrrepFingerprint {
  const characters = parts.characters.map((c) => ({ re: round3(c.re), im: round3(c.im) }));
  const key = [
    parts.setting ?? "?",
    parts.kVector ? `${parts.kVector.kind}:${parts.kVector.label}` : "-",
    `k=${parts.k.map((x) => round3(x)).join(",")}`,
    `dim=${parts.dim}/${parts.smallDim}`,
    parts.reality,
    parts.elements.map((e, i) => `${e}=${characters[i]!.re},${characters[i]!.im}`).join(";"),
  ].join(" | ");
  return { ...parts, characters, key };
}

/**
 * A provider from a table of fingerprint keys and labels: what a permitted
 * CDML table, or one built from a user's local ISO-IR file, would be. An irrep
 * whose key is not in the table keeps its generic label.
 */
export function fingerprintTableProvider(id: string, rows: readonly { readonly key: string; readonly label: string }[], pairs: readonly { readonly keys: readonly [string, string]; readonly label: string }[] = []): IrrepLabelProvider {
  const byKey = new Map(rows.map((r) => [r.key, r.label] as const));
  const byPair = new Map(pairs.map((p) => [[...p.keys].sort().join(" & "), p.label] as const));
  return {
    id,
    label: (fp) => byKey.get(fp.key) ?? null,
    pairLabel: (a, b) => byPair.get([a.key, b.key].sort().join(" & ")) ?? null,
  };
}

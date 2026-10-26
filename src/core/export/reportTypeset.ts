/**
 * Typesetting for the refinement report: the conventions a crystallographic
 * paper follows, as HTML (for reportHtml) and as plain Unicode text (for
 * reportMarkdown and the page title).
 *
 * - Space-group symbols with italic lattice and glide letters, screw axes
 *   subscripted and rotoinversions overbarred: P6₃/mmc, Fm3̄m.
 * - Chemical formulas with their counts subscripted: Mn₃Ga, GaTa₄Se₈.
 * - Quantity symbols in italic with upright subscripts: R_wp, χ², B_iso.
 * - The minus sign (−, U+2212) for negative numbers.
 * - Fractions for coordinates a symmetry element fixes (1/4, 2/3).
 *
 * Pure string → string; nothing here reads a refinement.
 */

import { ELEMENT_SYMBOLS } from "@/core/crystal/elements";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The minus sign in place of a hyphen before a number: "-0.0123(4)" → "−0.0123(4)". */
export function minus(s: string): string {
  return s.replace(/(^|[\s(=,;:[{/×])-(?=\.?\d)/g, "$1−");
}

// ---------------------------------------------------------------------------
// Chemical formulas

const ELEMENTS = new Set<string>([...ELEMENT_SYMBOLS, "D"]);
const SUB_DIGITS: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", ".": "." };

/**
 * A name that is a chemical formula, split into its elements and counts:
 * "Mn3Ga" → Mn 3, Ga. Null for anything else ("Eu324", "PG3_1", "AWO4",
 * "Mn3Ga 600 K"): every token must be an element and a count of at most two
 * digits (a decimal allowed), so a sample name is never read as a formula.
 */
export function formulaParts(name: string): { readonly element: string; readonly count?: string }[] | null {
  if (!/^(?:[A-Z][a-z]?(?:\d{1,2}(?:\.\d+)?)?)+$/.test(name) || !/\d/.test(name)) return null;
  const parts = [...name.matchAll(/([A-Z][a-z]?)(\d{1,2}(?:\.\d+)?)?/g)].map((m) => ({ element: m[1]!, ...(m[2] ? { count: m[2] } : {}) }));
  return parts.every((p) => ELEMENTS.has(p.element)) ? parts : null;
}

/** A formula with subscript counts, as HTML; anything else escaped as it is. */
export function formulaHtml(name: string): string {
  const parts = formulaParts(name);
  return parts ? parts.map((p) => `${p.element}${p.count ? `<sub>${p.count}</sub>` : ""}`).join("") : esc(name);
}

/** A formula with Unicode subscript counts ("Mn₃Ga"); anything else as it is. */
export function formulaText(name: string): string {
  const parts = formulaParts(name);
  return parts ? parts.map((p) => `${p.element}${p.count ? [...p.count].map((c) => SUB_DIGITS[c] ?? c).join("") : ""}`).join("") : name;
}

/**
 * The formulas in running text set with subscripts ("the Mn3Ga Ga1 occupancy"
 * → "the Mn₃Ga Ga1 occupancy"): a word of two or more elements with a count,
 * so a site label (Mn1, O2) is never read as one.
 */
export function formulasInText(text: string, sub: (count: string) => string): string {
  return text.replace(/(?<![\w.])(?:[A-Z][a-z]?\d{0,2}(?:\.\d+)?){2,}(?![\w.])/g, (word) => {
    const parts = formulaParts(word);
    return parts && parts.length >= 2 ? parts.map((p) => `${p.element}${p.count ? sub(p.count) : ""}`).join("") : word;
  });
}

/** Formulas in text with Unicode subscripts. */
export const formulasText = (text: string): string => formulasInText(text, (c) => [...c].map((d) => SUB_DIGITS[d] ?? d).join(""));

// ---------------------------------------------------------------------------
// Space-group symbols

/** One symbol character run: an italic letter, an upright digit, a screw axis, a rotoinversion. */
type SymbolPiece = { kind: "letter" | "text"; text: string } | { kind: "screw"; order: string; sub: string } | { kind: "bar"; order: string };

/** The pieces of a Hermann–Mauguin symbol ("P 63/m m c", "F m -3 m", "R -3 c:H"), spaces dropped. */
function symbolPieces(hm: string): { pieces: SymbolPiece[]; setting: string } {
  const [body, setting = ""] = hm.trim().split(":");
  const s = body!.replace(/\s+/g, "");
  const pieces: SymbolPiece[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const next = s[i + 1];
    if (c === "-" && next && /\d/.test(next)) {
      pieces.push({ kind: "bar", order: next });
      i++;
    } else if (/[2346]/.test(c) && next && /[1-5]/.test(next) && Number(next) < Number(c)) {
      pieces.push({ kind: "screw", order: c, sub: next });
      i++;
    } else if (/[A-Za-z]/.test(c)) {
      pieces.push({ kind: "letter", text: c });
    } else {
      pieces.push({ kind: "text", text: c });
    }
  }
  return { pieces, setting };
}

/** A Hermann–Mauguin symbol as a paper sets it, in HTML: <i>P</i>6<sub>3</sub>/<i>mmc</i>. */
export function spaceGroupHtml(hm: string): string {
  const { pieces, setting } = symbolPieces(hm);
  let out = "";
  let italic = "";
  const flush = (): void => {
    if (italic) out += `<i>${esc(italic)}</i>`;
    italic = "";
  };
  for (const p of pieces) {
    if (p.kind === "letter") {
      italic += p.text;
      continue;
    }
    flush();
    if (p.kind === "screw") out += `${p.order}<sub>${p.sub}</sub>`;
    else if (p.kind === "bar") out += `<span class="ovl">${p.order}</span>`;
    else out += esc(p.text);
  }
  flush();
  return `<span class="sg">${out}${setting ? `:${esc(setting)}` : ""}</span>`;
}

/** A Hermann–Mauguin symbol in plain text: spaces dropped, screw axes subscripted ("P6₃/mmc", "Fm-3m"). */
export function spaceGroupText(hm: string): string {
  const { pieces, setting } = symbolPieces(hm);
  const body = pieces.map((p) => (p.kind === "screw" ? `${p.order}${SUB_DIGITS[p.sub]}` : p.kind === "bar" ? `-${p.order}` : p.text)).join("");
  return `${body}${setting ? `:${setting}` : ""}`;
}

// ---------------------------------------------------------------------------
// Quantity symbols: "R_wp", "χ^2", "wR_2", "B_iso", "GoF"

/** Single-letter bases (and wR) are italic; an abbreviation (GoF, GooF) is upright. */
const italicBase = (base: string): boolean => /^(?:[A-Za-zα-ωΑ-Ω]|wR)$/.test(base);

function symbolParts(markup: string): { base: string; sub?: string; sup?: string } {
  const m = /^([^_^]+)(?:_([^^]+))?(?:\^(.+))?$/.exec(markup);
  if (!m) return { base: markup };
  return { base: m[1]!, ...(m[2] ? { sub: m[2] } : {}), ...(m[3] ? { sup: m[3] } : {}) };
}

/** A quantity symbol in HTML: "R_wp" → <i>R</i><sub>wp</sub>, "χ^2" → <i>χ</i><sup>2</sup>. */
export function symbolHtml(markup: string): string {
  const { base, sub, sup } = symbolParts(markup);
  return `${italicBase(base) ? `<i>${esc(base)}</i>` : esc(base)}${sub ? `<sub>${esc(sub)}</sub>` : ""}${sup ? `<sup>${esc(sup)}</sup>` : ""}`;
}

const SUP: Record<string, string> = { "2": "²", "3": "³" };

/** A quantity symbol in plain text, as papers write it in running text: "Rwp", "χ²", "wR2", "B_iso" (a subscript word kept apart). */
export function symbolText(markup: string): string {
  const { base, sub, sup } = symbolParts(markup);
  const lower = sub && /^[a-z]+$/.test(sub) && base.length === 1 && /[A-Z]/.test(base) && !/^(?:iso|eq|aniso)$/.test(sub);
  return `${base}${sub ? (lower || /^\d+$/.test(sub) ? sub : `_${sub}`) : ""}${sup ? SUP[sup] ?? `^${sup}` : ""}`;
}

// ---------------------------------------------------------------------------
// Numbers

const DENOMINATORS = [1, 2, 3, 4, 6, 8, 12] as const;

/**
 * A coordinate a symmetry element fixes, as the fraction it is ("1/4",
 * "2/3", "0"), when it lies within `tolerance` of one with a denominator of
 * 12 or less (a CIF's 0.3333 is 1/3); null otherwise. The default suits a
 * coordinate known to be fixed; for one that may be free (a moment's anchor),
 * pass a tighter tolerance, so a refined 0.1665 is not read as 1/6.
 */
export function asFraction(v: number, tolerance = 1e-3): string | null {
  for (const d of DENOMINATORS) {
    const n = Math.round(v * d);
    if (Math.abs(v - n / d) < tolerance) {
      if (n === 0) return "0";
      const sign = n < 0 ? "−" : "";
      const a = Math.abs(n);
      return d === 1 ? `${sign}${a}` : `${sign}${a}/${d}`;
    }
  }
  return null;
}

/** A printed number split where a column aligns it: at the decimal point, or a fraction's slash. */
export function splitAtPoint(text: string): readonly [string, string] {
  const m = /^([^./]*)([./].*)?$/.exec(text);
  return [m?.[1] ?? text, m?.[2] ?? ""];
}

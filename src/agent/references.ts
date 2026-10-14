/**
 * Numbers by reference. Where the Agent quotes a number the engine computed
 * (an agreement factor, a parameter's value and esd, the Flack x, the
 * engine's verdict) it writes a reference, {{wR2}} or {{p:twin_1}}, and the
 * app fills it in from the engine where the words are shown: its replies, its
 * notes, the report's account. No number is then invented, mistyped or
 * rounded otherwise than the engine rounds it. A reference the page cannot
 * fill stays as written, and the report refuses it.
 */

import type { RefinementParameter } from "@/core/refinement/types";
import { withEsd } from "@/agent/structureTable";

/** {{key}}: a letter, then letters, digits and _ : . + − (p:twin_1, p:pos_O1_0). */
export const REFERENCE = /\{\{\s*([A-Za-z][\w:.+-]*)\s*\}\}/g;

/** One reference a page offers: its key, what it names, and its value as the engine prints it (null: none now). */
export interface ReferenceEntry {
  readonly key: string;
  readonly what: string;
  /** Computed when a reference asks for it: a Flack x or a verdict is not worked out for every reply. */
  readonly value: () => string | null;
}

/** What a page's references resolve against: its named values, and its parameter rows with the last fit's esds. */
export interface ReferenceSource {
  readonly entries: readonly ReferenceEntry[];
  readonly parameters: readonly RefinementParameter[];
  readonly esd: Readonly<Record<string, number>>;
}

/** A parameter row's value as the page prints it: value(esd) after a fit that refined it, else the value. */
export function parameterText(p: RefinementParameter, esd: number | undefined): string {
  return esd !== undefined && esd > 0 ? withEsd(p.value, esd, 6) : String(Number(p.value.toPrecision(6)));
}

/** One reference's value, or undefined when the page has none of that name. */
function resolve(key: string, source: ReferenceSource): string | null | undefined {
  if (/^p:/i.test(key)) {
    const id = key.slice(2);
    const p = source.parameters.find((q) => q.id === id) ?? source.parameters.find((q) => q.id.toLowerCase() === id.toLowerCase());
    return p ? parameterText(p, source.esd[p.id]) : undefined;
  }
  const entry = source.entries.find((e) => e.key === key) ?? source.entries.find((e) => e.key.toLowerCase() === key.toLowerCase());
  return entry ? entry.value() : undefined;
}

/**
 * The text with every reference the page can fill filled in. `unknown` names
 * the references it has no value for (no such name, or none yet: a GoF before
 * the first fit); they stay in the text as written.
 */
export function fillReferences(text: string, source: ReferenceSource | null): { text: string; unknown: string[]; filled: number } {
  if (!text.includes("{{")) return { text, unknown: [], filled: 0 };
  const unknown: string[] = [];
  let filled = 0;
  const out = text.replace(REFERENCE, (whole, key: string) => {
    const value = source ? resolve(key, source) : undefined;
    if (value === undefined || value === null) {
      if (!unknown.includes(key)) unknown.push(key);
      return whole;
    }
    filled++;
    return value;
  });
  return { text: out, unknown, filled };
}

/** The references a page offers, in a line for the model: its named values and {{p:ID}}. */
export function referenceCatalog(source: ReferenceSource): string {
  return [...source.entries.map((e) => `{{${e.key}}} ${e.what}`), "{{p:ID}} a parameter row's value(esd), by its id"].join("; ");
}

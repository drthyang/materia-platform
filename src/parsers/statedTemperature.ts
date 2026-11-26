/**
 * The sample temperature a data file states, when it states one: in a header
 * or comment line, as "temperature 10 K", "Temp: 4.2 K", "T = 300 K",
 * "temperature 25 °C", or a CIF's _diffrn_ambient_temperature (K).
 *
 * Nothing is guessed: a number with no unit, a sample name ("…_at_300K") or a
 * value at or below 0 K (a reduction's placeholder, as in "at temperature
 * 0.0 K") does not count. Two different temperatures in one file give none.
 */

export interface StatedTemperature {
  /** Kelvin. */
  readonly kelvin: number;
  /** The text it was read from, trimmed. */
  readonly text: string;
}

export type TemperatureReading =
  | { readonly kind: "stated"; readonly temperature: StatedTemperature }
  | { readonly kind: "none" }
  | { readonly kind: "conflicting"; readonly values: readonly StatedTemperature[] };

const NUM = String.raw`([-+]?\d+(?:\.\d+)?)`;
const PATTERNS: readonly { re: RegExp; unit?: "K" }[] = [
  // "temperature 10 K", "Temp: 4.2 K", "TEMP 25 C", "temperature = 300.0K"
  { re: new RegExp(String.raw`\btemp(?:erature)?\b[^0-9+\-\n]{0,20}?${NUM}\s*(K|°\s*C|deg\s*C|C)\b`, "gi") },
  // "T = 300 K"
  { re: new RegExp(String.raw`\bT\s*=\s*${NUM}\s*(K)\b`, "g") },
  // CIF, always kelvin
  { re: new RegExp(String.raw`_diffrn_ambient_temperature\s+${NUM}`, "g"), unit: "K" },
];

function lineAround(text: string, at: number): string {
  const a = text.lastIndexOf("\n", at) + 1;
  const b = text.indexOf("\n", at);
  return text.slice(a, b < 0 ? text.length : b).trim().slice(0, 160);
}

export function statedTemperature(text: string | null | undefined): TemperatureReading {
  if (!text) return { kind: "none" };
  const found: StatedTemperature[] = [];
  for (const { re, unit } of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const v = Number(m[1]);
      const u = unit ?? m[2]!.replace(/\s+/g, "").toUpperCase();
      const kelvin = u === "K" ? v : v + 273.15;
      if (!Number.isFinite(kelvin) || kelvin <= 0) continue;
      found.push({ kelvin, text: lineAround(text, m.index) });
    }
  }
  if (found.length === 0) return { kind: "none" };
  const distinct = found.filter((t, i) => found.findIndex((u) => Math.abs(u.kelvin - t.kelvin) <= 0.5) === i);
  return distinct.length === 1 ? { kind: "stated", temperature: found[0]! } : { kind: "conflicting", values: distinct };
}

/**
 * The irrep-label oracle (opt-in; ADRs 0004 and 0005; THY-36): MATERIA's
 * generic irrep labels ("R irrep 8 of 10") against the Miller–Love (CDML)
 * labels of the ISOTROPY Suite (H. T. Stokes, D. M. Hatch & B. J. Campbell,
 * iso.byu.edu), by their characters. The workflow
 * .github/workflows/isotropy-oracle.yml downloads ISOTROPY at run time; its
 * binary, its data and the labels it prints are never committed (ADR 0005),
 * so the app keeps its generic labels (ADR 0004) and this test only checks,
 * in CI, that they stand for ISOTROPY's irreps one to one. Runs only with
 * ISOTROPY_ORACLE=1 and ISODATA set.
 *
 * For each (parent, k-point): one element of each conjugacy class of the
 * factor group F = G/T″, written in International Tables notation, and
 * ISOTROPY's character of every irrep at k for it (VALUE ELEMENT, SHOW
 * CHARACTER, DISPLAY IRREP). Each of MATERIA's irreps at the star must have
 * the characters of exactly one of ISOTROPY's (or, for a complex pair that
 * ISOTROPY lists as one physically irreducible representation, their sum),
 * and every one of ISOTROPY's must be matched: the correspondence is printed.
 * The cases are the isotropy oracle's and the magnetic page's non-abelian
 * zone-boundary points (P6₃/mmc A, P4₂/mnm and P4/mmm Z).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Complex } from "@/core/math/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { complexIrrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { CONVENTIONAL_CELL, DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import type { Rat } from "@/core/crystal/irreps/rational";

const ISODATA = process.env.ISODATA ?? "";
const ENABLED = process.env.ISOTROPY_ORACLE === "1" && ISODATA !== "" && existsSync(resolve(ISODATA, "iso"));

function iso(commands: readonly string[]): string {
  return execFileSync(resolve(ISODATA, "iso"), [], { input: `${commands.join("\n")}\nQUIT\n`, env: { ...process.env, ISODATA: ISODATA.endsWith("/") ? ISODATA : `${ISODATA}/` }, encoding: "utf8", maxBuffer: 64 << 20 });
}

/** A rational as ISOTROPY reads it: "1/2", "3/2", "1". */
const ratText = (r: Rat): string => (r.d === 1 ? `${r.n}` : `${r.n}/${r.d}`);

/** An element in International Tables notation, ISOTROPY's way: the three components separated by spaces, e.g. "1/2-Y X Z". */
export function isoElement(W: readonly (readonly number[])[], w: readonly Rat[]): string {
  return [0, 1, 2].map((i) => {
    let s = w[i]!.n === 0 ? "" : ratText(w[i]!);
    ["X", "Y", "Z"].forEach((axis, j) => {
      const c = W[i]![j]!;
      if (c === 0) return;
      const mag = Math.abs(c) === 1 ? "" : `${Math.abs(c)}`;
      s += c < 0 ? `-${mag}${axis}` : `${s === "" ? "" : "+"}${mag}${axis}`;
    });
    return s;
  }).join(" ");
}

/** One element of each conjugacy class of F (the smallest index). */
function classRepresentatives(group: FactorGroup): number[] {
  const seen = new Set<number>();
  const reps: number[] = [];
  for (let x = 0; x < group.elements.length; x++) {
    if (seen.has(x)) continue;
    reps.push(x);
    for (let g = 0; g < group.elements.length; g++) seen.add(group.table[group.table[g]![x]!]![group.inverse[g]!]!);
  }
  return reps;
}

/** A character as ISOTROPY may print it: "1", "-0.500", "1/2", "(0.5,-0.866)", "0.5+0.866i", "i", "-i". */
export function parseCharacter(token: string): Complex | null {
  const t = token.trim();
  const num = (x: string): number => {
    const f = x.match(/^([+-]?\d+)\/(\d+)$/);
    return f ? Number(f[1]) / Number(f[2]) : Number(x);
  };
  let m = t.match(/^\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)$/);
  if (m) return { re: num(m[1]!), im: num(m[2]!) };
  m = t.match(/^([+-]?[\d./]+)([+-][\d./]*)i$/);
  if (m) return { re: num(m[1]!), im: m[2] === "+" ? 1 : m[2] === "-" ? -1 : num(m[2]!) };
  m = t.match(/^([+-]?[\d./]*)i$/);
  if (m) return { re: 0, im: m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : num(m[1]!) };
  if (/^[+-]?\d+(\.\d+)?(\/\d+)?$/.test(t)) return { re: num(t), im: 0 };
  return null;
}

const IRREP = /^\s*([A-Z][A-Z0-9]*[+-]?(?:[A-Z][A-Z0-9]*[+-]?)*)\s+(.*\S)\s*$/;

/** ISOTROPY's characters for one element: irrep label → character (the last token of its line that reads as one). */
export function parseCharacters(out: string): Map<string, Complex> {
  const byIrrep = new Map<string, Complex>();
  for (const line of out.split("\n")) {
    const m = line.match(IRREP);
    if (!m || /^(VALUE|SHOW|DISPLAY|PAGE|QUIT|LABEL|Irrep|Isotropy|Harold|Brigham|Current|Element|Character|Subgroup)$/i.test(m[1]!)) continue;
    const tokens = m[2]!.split(/\s+/);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const c = parseCharacter(tokens[i]!);
      if (c) {
        byIrrep.set(m[1]!, c);
        break;
      }
    }
  }
  return byIrrep;
}

/** [case, MATERIA's setting, ISOTROPY's parent number, its k-point label, k (conventional)] */
const CASES: readonly [string, number | string, number, string, readonly [number, number, number]][] = [
  ["Pm-3m Γ", 221, 221, "GM", [0, 0, 0]],
  ["Fm-3m Γ", 225, 225, "GM", [0, 0, 0]],
  ["Fm-3m X", 225, 225, "X", [0, 0, 1]],
  ["F-43m X", 216, 216, "X", [0, 0, 1]],
  ["Fd-3m X", "F d -3 m:2", 227, "X", [0, 0, 1]],
  ["Im-3m H", 229, 229, "H", [0, 0, 1]],
  ["I4/mmm M", 139, 139, "M", [0, 0, 1]],
  ["Cmcm Y", 63, 63, "Y", [0, 1, 0]],
  ["Pm-3m X", 221, 221, "X", [0, 0.5, 0]],
  ["Pm-3m M", 221, 221, "M", [0.5, 0.5, 0]],
  ["Pm-3m R", 221, 221, "R", [0.5, 0.5, 0.5]],
  ["Fm-3m L", 225, 225, "L", [0.5, 0.5, 0.5]],
  ["Fm-3m W", 225, 225, "W", [0.5, 1, 0]],
  // The magnetic page's zone-boundary points with a non-abelian little co-group (projective small representations where non-symmorphic).
  ["P6₃/mmc A", "P 63/m m c", 194, "A", [0, 0, 0.5]],
  ["P4₂/mnm Z", "P 42/m n m", 136, "Z", [0, 0, 0.5]],
  ["P4/mmm Z", 123, 123, "Z", [0, 0, 0.5]],
];

const close = (a: Complex, b: Complex): boolean => Math.hypot(a.re - b.re, a.im - b.im) < 2e-3;

describe.skipIf(!ENABLED)("ISOTROPY oracle: MATERIA's generic irrep labels stand for ISOTROPY's (CDML) irreps one to one", { timeout: 900_000 }, () => {
  for (const [name, setting, parent, kLabel, k] of CASES) {
    it(name, () => {
      const group = factorGroup(buildSpaceGroup(setting).operations, k.every(Number.isInteger) ? CONVENTIONAL_CELL : DEFAULT_SUPERCELL);
      const { irreps } = complexIrrepsOfStar(group, k);
      const reps = classRepresentatives(group);
      const theirs = new Map<string, Complex[]>();
      reps.forEach((e, r) => {
        const element = isoElement(group.elements[e]!.W, group.elements[e]!.w);
        const out = iso(["PAGE NOBREAK", "LABEL ELEMENT INTERNATIONAL", `VALUE PARENT ${parent}`, `VALUE KPOINT ${kLabel}`, `VALUE ELEMENT ${element}`, "SHOW CHARACTER", "DISPLAY IRREP"]);
        if (r === 0 || r === 1) console.log(`--- ISOTROPY, ${name}, element ${element} ---\n${out}`);
        const chars = parseCharacters(out);
        for (const [label, c] of chars) {
          const list = theirs.get(label) ?? Array.from({ length: reps.length }, () => ({ re: Number.NaN, im: 0 }));
          list[r] = c;
          theirs.set(label, list);
        }
      });
      expect(theirs.size, `${name}: no characters parsed from ISOTROPY's output`).toBeGreaterThan(0);
      const ours = irreps.map((irrep) => ({ label: irrep.label, chi: reps.map((e) => irrep.characters[e]!) }));
      // ISOTROPY's phase convention may be the conjugate of MATERIA's; one choice must match every irrep.
      const attempt = (conj: boolean) => {
        const pairs: [string, string][] = [];
        const unmatchedTheirs = new Set(theirs.keys());
        const unmatchedOurs: string[] = [];
        const usedOurs = new Set<number>();
        for (const [label, c] of theirs) {
          const same = (chi: Complex[]) => chi.every((x, i) => close(conj ? { re: x.re, im: -x.im } : x, c[i]!));
          const single = ours.findIndex((o, i) => !usedOurs.has(i) && same(o.chi));
          if (single >= 0) {
            usedOurs.add(single);
            pairs.push([ours[single]!.label, label]);
            unmatchedTheirs.delete(label);
            continue;
          }
          // A physically irreducible representation of a complex pair: characters 2·Re χ.
          const pair = ours.findIndex((o, i) => !usedOurs.has(i) && o.chi.every((x, j) => close({ re: 2 * x.re, im: 0 }, c[j]!)) && o.chi.some((x) => Math.abs(x.im) > 1e-6));
          if (pair >= 0) {
            const partner = ours.findIndex((o, i) => i !== pair && !usedOurs.has(i) && o.chi.every((x, j) => close({ re: x.re, im: -x.im }, ours[pair]!.chi[j]!)));
            if (partner >= 0) {
              usedOurs.add(pair);
              usedOurs.add(partner);
              pairs.push([`${ours[pair]!.label} ⊕ ${ours[partner]!.label}`, label]);
              unmatchedTheirs.delete(label);
            }
          }
        }
        ours.forEach((o, i) => {
          if (!usedOurs.has(i)) unmatchedOurs.push(o.label);
        });
        return { pairs, unmatchedTheirs: [...unmatchedTheirs], unmatchedOurs };
      };
      const direct = attempt(false);
      const conj = attempt(true);
      const best = conj.unmatchedOurs.length + conj.unmatchedTheirs.length < direct.unmatchedOurs.length + direct.unmatchedTheirs.length ? conj : direct;
      console.log(`LABELS ${name} (${best === conj ? "conjugate phase" : "same phase"}): ${best.pairs.map(([a, b]) => `${a} = ${b}`).join("; ")}`);
      expect(best.unmatchedOurs, `${name}: MATERIA irreps with no ISOTROPY irrep of their characters`).toEqual([]);
      expect(best.unmatchedTheirs, `${name}: ISOTROPY irreps with no MATERIA irrep of their characters`).toEqual([]);
    });
  }
});

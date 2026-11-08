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
 * IRREP, SHOW CHARACTER, DISPLAY IRREP: a row "R4+ (x,y,z) 3.000" per irrep). Each of MATERIA's irreps at the star must have
 * the characters of exactly one of ISOTROPY's (or, for a complex pair that
 * ISOTROPY lists as one physically irreducible representation, their sum),
 * and every one of ISOTROPY's must be matched: the correspondence is printed.
 * The cases are the isotropy oracle's and the magnetic page's non-abelian
 * zone-boundary points (P6₃/mmc A, P4₂/mnm and P4/mmm Z).
 *
 * The file also holds THY-73's k-vector name check (below).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Complex } from "@/core/math/types";
import { buildSpaceGroup, extendedSymbol } from "@/core/crystal/spaceGroups";
import { referenceSetting } from "@/core/crystal/standardSetting";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { complexIrrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { CONVENTIONAL_CELL, DEFAULT_SUPERCELL } from "@/core/crystal/irreps/supercell";
import { K_VECTOR_TABLES, kVectorContext, kVectorName } from "@/core/crystal/irreps/kVectorNames";
import { radd, rat, rmul, type Rat, type RVec } from "@/core/crystal/irreps/rational";

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
    // A field too narrow for its value prints as asterisks (Fortran): unknown, not absent.
    if (/^\*+$/.test(tokens[tokens.length - 1]!)) {
      byIrrep.set(m[1]!, { re: Number.NaN, im: Number.NaN });
      continue;
    }
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
const ALL_CASES: readonly [string, number | string, number, string, readonly [number, number, number]][] = [
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

/** ORACLE_CASES (a regular expression) runs only the cases whose name it matches. */
const CASES = ALL_CASES.filter(([name]) => !process.env.ORACLE_CASES || new RegExp(process.env.ORACLE_CASES).test(name));

const close = (a: Complex, b: Complex): boolean => Math.hypot(a.re - b.re, a.im - b.im) < 2e-3;
/** A character ISOTROPY could not print (its field overflowed, "******") constrains nothing. */
const agrees = (ours: Complex, theirs: Complex): boolean => Number.isNaN(theirs.re) || close(ours, theirs);

describe.skipIf(!ENABLED || CASES.length === 0)("ISOTROPY oracle: MATERIA's generic irrep labels stand for ISOTROPY's (CDML) irreps one to one", { timeout: 900_000 }, () => {
  for (const [name, setting, parent, kLabel, k] of CASES) {
    it(name, () => {
      const group = factorGroup(buildSpaceGroup(setting).operations, k.every(Number.isInteger) ? CONVENTIONAL_CELL : DEFAULT_SUPERCELL);
      const { irreps } = complexIrrepsOfStar(group, k);
      const reps = classRepresentatives(group);
      const theirs = new Map<string, Complex[]>();
      reps.forEach((e, r) => {
        const element = isoElement(group.elements[e]!.W, group.elements[e]!.w);
        const out = iso(["PAGE NOBREAK", "LABEL ELEMENT INTERNATIONAL", `VALUE PARENT ${parent}`, `VALUE KPOINT ${kLabel}`, `VALUE ELEMENT ${element}`, "SHOW IRREP", "SHOW CHARACTER", "DISPLAY IRREP"]);
        if (r === 0 || r === 1) console.log(`--- ISOTROPY, ${name}, element ${element} ---\n${out}`);
        const chars = parseCharacters(out);
        for (const [label, c] of chars) {
          const list = theirs.get(label) ?? Array.from({ length: reps.length }, () => ({ re: Number.NaN, im: 0 }));
          list[r] = c;
          theirs.set(label, list);
        }
      });
      expect(theirs.size, `${name}: no characters parsed from ISOTROPY's output`).toBeGreaterThan(0);
      // Every irrep's character must be read on all but a few classes (an overflowed field or a missing row is unknown).
      for (const [label, c] of theirs) {
        const unknown = c.filter((x) => Number.isNaN(x.re)).length;
        if (unknown > 0) console.log(`UNREAD ${name}: ${label} has ${unknown} of ${reps.length} characters ISOTROPY did not print legibly`);
        expect(unknown, `${name}: ${label} unread on ${unknown} of ${reps.length} classes`).toBeLessThanOrEqual(Math.floor(reps.length / 4));
      }
      const ours = irreps.map((irrep) => ({ label: irrep.label, chi: reps.map((e) => irrep.characters[e]!) }));
      // ISOTROPY's phase convention may be the conjugate of MATERIA's; one choice must match every irrep.
      const attempt = (conj: boolean) => {
        const pairs: [string, string][] = [];
        const unmatchedTheirs = new Set(theirs.keys());
        const unmatchedOurs: string[] = [];
        const usedOurs = new Set<number>();
        for (const [label, c] of theirs) {
          const same = (chi: Complex[]) => chi.every((x, i) => agrees(conj ? { re: x.re, im: -x.im } : x, c[i]!));
          const single = ours.findIndex((o, i) => !usedOurs.has(i) && same(o.chi));
          if (single >= 0) {
            usedOurs.add(single);
            pairs.push([ours[single]!.label, label]);
            unmatchedTheirs.delete(label);
            continue;
          }
          // A physically irreducible representation of a complex pair: characters 2·Re χ.
          const pair = ours.findIndex((o, i) => !usedOurs.has(i) && o.chi.every((x, j) => agrees({ re: 2 * x.re, im: 0 }, c[j]!)) && o.chi.some((x) => Math.abs(x.im) > 1e-6));
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
      // What keeps an unmatched irrep from its nearest unmatched ISOTROPY irrep of the same dimension: the elements that differ.
      for (const label of best.unmatchedOurs) {
        const o = ours.find((x) => x.label === label)!;
        for (const t of best.unmatchedTheirs) {
          const c = theirs.get(t)!;
          if (!close(o.chi[0]!, c[0]!)) continue;
          const diff = reps.map((e, i) => ({ e, i })).filter(({ i }) => !close(o.chi[i]!, c[i]!)).map(({ e, i }) => `${isoElement(group.elements[e]!.W, group.elements[e]!.w)}: ours ${o.chi[i]!.re.toFixed(3)}${o.chi[i]!.im ? `${o.chi[i]!.im >= 0 ? "+" : ""}${o.chi[i]!.im.toFixed(3)}i` : ""}, ISOTROPY ${c[i]!.re.toFixed(3)}`);
          console.log(`UNMATCHED ${name}: ${label} against ${t} differs on ${diff.length} of ${reps.length} classes: ${diff.slice(0, 12).join("; ")}`);
        }
      }
      expect(best.unmatchedOurs, `${name}: MATERIA irreps with no ISOTROPY irrep of their characters`).toEqual([]);
      expect(best.unmatchedTheirs, `${name}: ISOTROPY irreps with no MATERIA irrep of their characters`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// k-vector names (THY-73): MATERIA's names (kVectorNames.ts, written by hand
// from the Bradley–Cracknell / CDML convention) against ISOTROPY's own list of
// k-vectors for each of the 230 space-group types (VALUE PARENT n, SHOW
// KPOINT, SHOW KDEGREE, DISPLAY KPOINT), whose labels are CDML's. A check, not
// a source: where they disagree, the name is removed from the table, not
// copied from ISOTROPY. For each of ISOTROPY's k-vectors: a point as given, a
// line at its parameter a = 1/16, a plane or the general point at a = 1/16,
// b = 3/64, c = 5/128. MATERIA must give the same name (GM = Γ, DT = Δ,
// LD = Λ, SM = Σ) or none; a different name is a disagreement and fails.
// Names MATERIA gives that no ISOTROPY k-vector confirmed are listed
// (UNCONFIRMED), not failed. In this file because the workflow's label step
// runs it (the workflow itself is unchanged).
// ---------------------------------------------------------------------------

const GREEK: Record<string, string> = { GM: "Γ", DT: "Δ", LD: "Λ", SM: "Σ" };

/** "−2a+1", "1/2", "a+b-c", "2a" at the parameters a, b, c (ISOTROPY writes the third as g at the general point): exactly. */
export function evalComponent(text: string, params: { a: Rat; b: Rat; c: Rat }): Rat | null {
  const t = text.replace(/\s+/g, "");
  if (t === "") return null;
  let sum = rat(0);
  const re = /([+-]?)(\d+(?:\/\d+)?)?([abcg])?/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while (pos < t.length && (m = re.exec(t)) && m.index === pos && m[0] !== "") {
    pos += m[0].length;
    const sign = m[1] === "-" ? -1 : 1;
    let coef = rat(sign);
    if (m[2]) {
      const [n, d] = m[2].split("/");
      coef = rmul(coef, rat(Number(n), d ? Number(d) : 1));
    }
    const p = m[3] === "g" ? "c" : (m[3] as "a" | "b" | "c" | undefined);
    sum = radd(sum, p ? rmul(coef, params[p]) : coef);
  }
  return pos === t.length ? sum : null;
}

/** ISOTROPY's DISPLAY KPOINT rows: "DT (0,2a,0)   1" → label, components, degree. */
export function parseKPoints(out: string): { label: string; components: string[]; degree: number }[] {
  const rows: { label: string; components: string[]; degree: number }[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9]*)\s+\(([^)]*)\)\s+(\d)\s*$/);
    if (!m) continue;
    const components = m[2]!.split(",");
    if (components.length !== 3) continue;
    rows.push({ label: m[1]!, components, degree: Number(m[3]) });
  }
  return rows;
}

/** ORACLE_CASES selects this check when it matches "k-vector names"; KNAME_GROUPS (a regular expression on the IT number) narrows it. */
const KNAME_ENABLED = !process.env.ORACLE_CASES || new RegExp(process.env.ORACLE_CASES).test("k-vector names");
const GROUPS = Array.from({ length: 230 }, (_, i) => i + 1).filter((n) => !process.env.KNAME_GROUPS || new RegExp(`^(${process.env.KNAME_GROUPS})$`).test(String(n)));

describe.skipIf(!ENABLED || !KNAME_ENABLED)("ISOTROPY oracle: k-vector names against ISOTROPY's (CDML) k-vector list", { timeout: 1_800_000 }, () => {
  it("every name MATERIA gives is ISOTROPY's for the same k, in every space-group type", () => {
    const params = { a: rat(1, 16), b: rat(3, 64), c: rat(5, 128) };
    const disagreements: string[] = [];
    const confirmed = new Map<string, Set<string>>();
    let agree = 0;
    let unnamed = 0;
    for (const n of GROUPS) {
      const out = iso(["PAGE NOBREAK", `VALUE PARENT ${n}`, "SHOW KPOINT", "SHOW KDEGREE", "DISPLAY KPOINT"]);
      if ([1, 14, 62, 123, 139, 166, 194, 216, 225, 229].includes(n)) console.log(`--- ISOTROPY, parent ${n} ---\n${out}`);
      const rows = parseKPoints(out);
      if (rows.length === 0) {
        disagreements.push(`${n}: no k-vectors parsed`);
        continue;
      }
      const ref = referenceSetting(n);
      const ctx = ref ? kVectorContext(buildSpaceGroup(extendedSymbol(ref)).operations) : null;
      const lattice = ctx?.lattice ?? "?";
      for (const row of rows) {
        const comps = row.components.map((c) => evalComponent(c, params));
        if (comps.some((c) => c === null)) {
          disagreements.push(`${n}: could not read ${row.label} (${row.components.join(",")})`);
          continue;
        }
        const k = comps as unknown as RVec;
        const ours = kVectorName(ctx, k);
        const theirs = GREEK[row.label] ?? row.label;
        if (!ours) {
          unnamed++;
          if (row.degree <= 1) console.log(`UNNAMED ${n} (${lattice}): ISOTROPY ${row.label} (${row.components.join(",")}) degree ${row.degree}`);
          continue;
        }
        if (ours.label === theirs && (ours.kind === "point") === (row.degree === 0)) {
          agree++;
          const set = confirmed.get(lattice) ?? new Set<string>();
          set.add(ours.label);
          confirmed.set(lattice, set);
          continue;
        }
        disagreements.push(`${n} (${lattice}): ISOTROPY ${row.label} (${row.components.join(",")}) degree ${row.degree}, MATERIA ${ours.label} (${ours.kind})`);
      }
    }
    for (const [lattice, table] of Object.entries(K_VECTOR_TABLES)) {
      const seen = confirmed.get(lattice) ?? new Set<string>();
      const missing = [...table!.points.map((p) => p.label), ...table!.lines.map((l) => l.label)].filter((x) => !seen.has(x));
      if (missing.length > 0) console.log(`UNCONFIRMED ${lattice}: ${missing.join(", ")}`);
    }
    console.log(`KNAMES: ${agree} agree, ${unnamed} unnamed by MATERIA, ${disagreements.length} disagreements`);
    for (const d of disagreements) console.log(`DISAGREE ${d}`);
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });
});

/**
 * The ISOTROPY oracle (opt-in; ADR 0005): MATERIA's isotropy subgroups at the
 * Phase-1 k-points against the ISOTROPY Suite's (H. T. Stokes, D. M. Hatch &
 * B. J. Campbell, iso.byu.edu), which the workflow
 * .github/workflows/isotropy-oracle.yml downloads at run time — the binary
 * and its data are never committed. Runs only with ISOTROPY_ORACLE=1 and
 * ISODATA set (the directory holding `iso` and its data files).
 *
 * For each (parent, k-point) both sides list the isotropy subgroups of every
 * physically irreducible representation, one per inequivalent
 * order-parameter direction. The irreps are matched without their labels
 * (MATERIA's are generic, ADR 0004): the comparison is between the multisets
 * of per-irrep subgroup lists (IT numbers), which a labelling or basis
 * difference cannot change.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { irrepsOfStar } from "@/core/crystal/irreps/spaceGroupIrreps";
import { isotropySubgroups } from "@/core/crystal/irreps/isotropy";

const ISODATA = process.env.ISODATA ?? "";
const ENABLED = process.env.ISOTROPY_ORACLE === "1" && ISODATA !== "" && existsSync(resolve(ISODATA, "iso"));

/** Run ISOTROPY on a list of commands; its whole output. */
function iso(commands: readonly string[]): string {
  return execFileSync(resolve(ISODATA, "iso"), [], { input: `${commands.join("\n")}\nQUIT\n`, env: { ...process.env, ISODATA: ISODATA.endsWith("/") ? ISODATA : `${ISODATA}/` }, encoding: "utf8", maxBuffer: 64 << 20 });
}

/**
 * The isotropy subgroups ISOTROPY lists, by irrep: the rows of DISPLAY
 * ISOTROPY with the irrep and subgroup columns shown. A row whose irrep cell
 * is blank continues the irrep above it.
 */
export function parseIsotropy(out: string): Map<string, number[]> {
  const byIrrep = new Map<string, number[]>();
  let irrep: string | null = null;
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9]*[+-]?(?:[A-Z][A-Z0-9]*[+-]?)?)\s+(\d{1,3})\s+\S/);
    const cont = line.match(/^\s{4,}(\d{1,3})\s+[A-Z]/);
    if (m && !/^(VALUE|SHOW|DISPLAY|PAGE|QUIT|Irrep|Subgroup)/i.test(m[1]!)) irrep = m[1]!;
    const n = m ? Number(m[2]) : cont ? Number(cont[1]) : NaN;
    if (!irrep || !Number.isInteger(n) || n < 1 || n > 230) continue;
    const list = byIrrep.get(irrep);
    if (list) list.push(n);
    else byIrrep.set(irrep, [n]);
  }
  return byIrrep;
}

const signature = (lists: Iterable<readonly number[]>): string[] => [...lists].map((l) => [...l].sort((a, b) => a - b).join(",")).sort();

/** [case, MATERIA's setting, ISOTROPY's parent number, its k-point label, k (conventional)] */
const CASES: readonly [string, number | string, number, string, readonly [number, number, number]][] = [
  ["Fm-3m X", 225, 225, "X", [0, 0, 1]],
  ["F-43m X", 216, 216, "X", [0, 0, 1]],
  ["Fd-3m X", "F d -3 m:2", 227, "X", [0, 0, 1]],
  ["Im-3m H", 229, 229, "H", [0, 0, 1]],
  ["Pm-3m Γ", 221, 221, "GM", [0, 0, 0]],
  ["Fm-3m Γ", 225, 225, "GM", [0, 0, 0]],
];

describe.skipIf(!ENABLED)("ISOTROPY oracle: isotropy subgroups at the Phase-1 k-points", () => {
  for (const [name, setting, parent, kLabel, k] of CASES) {
    it(name, () => {
      const out = iso(["PAGE NOBREAK", `VALUE PARENT ${parent}`, `VALUE KPOINT ${kLabel}`, "SHOW IRREP", "SHOW SUBGROUP", "SHOW DIRECTION", "DISPLAY ISOTROPY"]);
      console.log(`--- ISOTROPY, ${name} ---\n${out}`);
      const theirs = parseIsotropy(out);
      const group = factorGroup(buildSpaceGroup(setting).operations);
      const ours = irrepsOfStar(group, k).physical.map((p) => isotropySubgroups(group, p).subgroups.map((s) => s.identity.number ?? 0));
      console.log(`MATERIA ${name}: ${JSON.stringify(signature(ours))}\nISOTROPY ${name}: ${JSON.stringify(signature(theirs.values()))}`);
      expect(theirs.size, `${name}: no isotropy subgroups parsed from ISOTROPY's output`).toBeGreaterThan(0);
      // Γ: ISOTROPY lists the identity irrep too (its only isotropy subgroup is the parent); MATERIA's lists have none for it.
      const theirsSig = signature([...theirs.values()].filter((l) => !(l.length === 1 && l[0] === parent)));
      const oursSig = signature(ours.filter((l) => !(l.length === 1 && l[0] === parent)));
      expect(oursSig).toEqual(theirsSig);
    });
  }
});

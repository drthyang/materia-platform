/**
 * Discovery run (temporary): ISOTROPY's DISPLAY DISTORTION output for the mode-amplitude oracle.
 */
import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ISODATA = process.env.ISODATA ?? "";
const ENABLED = process.env.ISOTROPY_ORACLE === "1" && ISODATA !== "" && existsSync(resolve(ISODATA, "iso"));

function iso(commands: readonly string[]): string {
  return execFileSync(resolve(ISODATA, "iso"), [], { input: `${commands.join("\n")}\nQUIT\n`, env: { ...process.env, ISODATA: ISODATA.endsWith("/") ? ISODATA : `${ISODATA}/` }, encoding: "utf8", maxBuffer: 64 << 20 });
}

const RUNS: readonly [string, readonly string[]][] = [
  ["R irreps", ["PAGE NOBREAK", "VALUE PARENT 221", "VALUE KPOINT R", "DISPLAY IRREP"]],
  ["X M irreps", ["PAGE NOBREAK", "VALUE PARENT 221", "VALUE KPOINT X", "DISPLAY IRREP", "VALUE KPOINT M", "DISPLAY IRREP"]],
  ["R4+ c no dir", ["PAGE NOBREAK", "VALUE PARENT 221", "VALUE IRREP R4+", "VALUE WYCKOFF C", "VALUE CELL 2,0,0 0,2,0 0,0,2", "SHOW WYCKOFF", "SHOW MICROSCOPIC VECTOR", "DISPLAY DISTORTION"]],
  ["R5+ a b c no dir", ["PAGE NOBREAK", "VALUE PARENT 221", "VALUE IRREP R5+", "VALUE WYCKOFF A B C", "VALUE CELL 2,0,0 0,2,0 0,0,2", "SHOW WYCKOFF", "SHOW MICROSCOPIC VECTOR", "DISPLAY DISTORTION"]],
  ["R4+ c P3", ["PAGE NOBREAK", "VALUE PARENT 221", "VALUE IRREP R4+", "VALUE DIRECTION P3", "VALUE WYCKOFF C", "SHOW WYCKOFF", "SHOW MICROSCOPIC VECTOR", "DISPLAY DISTORTION"]],
  ["194 M irreps", ["PAGE NOBREAK", "VALUE PARENT 194", "VALUE KPOINT M", "DISPLAY IRREP", "SHOW KPOINT", "DISPLAY KPOINT"]],
  ["194 M1+ a c", ["PAGE NOBREAK", "VALUE PARENT 194", "VALUE IRREP M1+", "VALUE WYCKOFF A C", "VALUE CELL 2,0,0 0,2,0 0,0,1", "SHOW WYCKOFF", "SHOW MICROSCOPIC VECTOR", "DISPLAY DISTORTION"]],
  ["221 GM4- a no dir", ["PAGE NOBREAK", "VALUE PARENT 221", "VALUE IRREP GM4-", "VALUE WYCKOFF A", "SHOW WYCKOFF", "SHOW MICROSCOPIC VECTOR", "DISPLAY DISTORTION"]],
];

describe.skipIf(!ENABLED)("ISOTROPY discovery: DISPLAY DISTORTION", { timeout: 600_000 }, () => {
  for (const [name, cmds] of RUNS) {
    it(name, () => {
      const out = iso(cmds);
      console.log(`=== ${name} ===\n${out}\n=== end ${name} ===`);
    });
  }
});

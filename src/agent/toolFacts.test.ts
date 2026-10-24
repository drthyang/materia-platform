import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { LIVE_TOOLS } from "@/agent/tools";
import { stagesFor } from "@/agent/method";

/**
 * A tool's facts (the History step it records, the cards it acts on, where a
 * local model is offered it, the evidence it gives, …) live on its
 * definition in tools.ts, and every other module derives what it needs from
 * there. A module that keeps its own list of tool names drifts from the list:
 * this fails on one.
 */

const NAMES = new Set(LIVE_TOOLS.map((t) => t.name));

/** The graders name the calls they grade, by design; the definitions are the list. */
const EXEMPT = [/^src\/agent\/tools\.ts$/, /^src\/agent\/evals\//];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Where a file names two tools or more in one list: an array of names, or an object keyed by them. */
function toolLists(src: string): string[] {
  const found: string[] = [];
  const line = (at: number): number => src.slice(0, at).split("\n").length;
  for (const m of src.matchAll(/\[\s*((?:"[a-z_]+"\s*,\s*)+"[a-z_]+")\s*,?\s*\]/g)) {
    const items = [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
    if (items.every((i) => NAMES.has(i))) found.push(`line ${line(m.index)}: [${items.join(", ")}]`);
  }
  for (const m of src.matchAll(/\{((?:\s*[a-z]+_[a-z_]+:\s*[^,\n]+,){2,})/g)) {
    // A page's plan table is keyed by its change tools, and its type (Plans) holds it to the definitions.
    if (/:\s*Plans<[^>]+>\s*=\s*$/.test(src.slice(Math.max(0, m.index - 80), m.index))) continue;
    const keys = [...m[1]!.matchAll(/([a-z]+_[a-z_]+):/g)].map((x) => x[1]!).filter((k) => NAMES.has(k));
    if (keys.length >= 2) found.push(`line ${line(m.index)}: {${keys.join(", ")}}`);
  }
  return found;
}

describe("a tool's facts, on its definition", () => {
  it("no module keeps its own list of tools", () => {
    const lists: string[] = [];
    for (const file of ["src/agent", "src/app", "src/components"].flatMap(sources)) {
      const path = relative(process.cwd(), file);
      if (EXEMPT.some((re) => re.test(path))) continue;
      for (const at of toolLists(readFileSync(file, "utf8"))) lists.push(`${path} ${at}`);
    }
    expect(lists).toEqual([]);
  });

  it("the facts agree with each other and with the method", () => {
    const stages = new Set(stagesFor("powder").map((st) => st.id));
    for (const t of LIVE_TOOLS) {
      for (const at of t.offer?.powder ?? []) expect(at === "always" || at === "finish" || stages.has(at), `${t.name}: ${at}`).toBe(true);
      // Only a change records a History step; a tool of the magnetic step works on the powder page.
      if (t.historyStep) expect(t.effect, t.name).toBe("change");
      if (t.magneticStep) expect(t.pages, t.name).toEqual(["powder"]);
      if (t.stallNeutral) expect(t.effect, t.name).toBe("read");
      // A tool that ends the turn changes nothing: what follows is the user's.
      if (t.endsTurn) expect(t.effect, t.name).toBe("read");
    }
  });
});

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HELD_OUT, SCENARIOS } from "@/agent/evals/scenarios";

/** Every file under `dir`, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the held-out scenarios", () => {
  const root = new URL("../../../", import.meta.url).pathname;
  const methodText = [...files(join(root, ".claude/skills")), ...files(join(root, "knowledge"))].map((f) => ({ f, text: readFileSync(f, "utf8") }));

  it("are scenarios of the suite", () => {
    for (const id of Object.keys(HELD_OUT)) expect(SCENARIOS.map((s) => s.id)).toContain(id);
  });

  it("run on data no skill or knowledge note names", () => {
    for (const [id, terms] of Object.entries(HELD_OUT)) {
      for (const term of terms) {
        const named = methodText.filter((m) => m.text.toLowerCase().includes(term.toLowerCase())).map((m) => m.f.slice(root.length));
        expect(named, `${id}: "${term}" appears in the method`).toEqual([]);
      }
    }
  });
});

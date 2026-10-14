/**
 * Example 3's page (docs/AGENT_EXAMPLES.md): the simulated Mn₃Ga 30 K neutron
 * pattern from the committed examples/mcp files, after its nuclear fit
 * (scale, background, cell, U V W; atoms held), as the MCP run's step 5. The
 * true magnetic order is k = 0 in P2₁'/m' with the moments of
 * src/examples/mn3gaMagnetic.ts; one moments fit per group stops in a
 * shallow minimum with Mn1 almost off.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse_instrument, parse_powder_data, parse_structure } from "@/mcp/tools";
import { loadedSession, type Session } from "@/app/powderSession";
import { runPowderRefinement } from "@/workers/runPowder";
import { powderRestraints } from "@/app/powderSpec";
import { matchIds } from "@/agent/liveCommon";

const DIR = resolve(__dirname, "../../../examples/mcp");
const read = (f: string): string => readFileSync(resolve(DIR, f), "utf8");

/** The page as the app opens Example 3's three files, before any fit. */
export function example3Loaded(): Session {
  const { structure } = parse_structure({ cif: read("mn3ga_30k_nuclear.cif"), id: "mn3ga30k" });
  const instrument = parse_instrument({ text: read("mn3ga_30k.instprm") });
  const { pattern } = parse_powder_data({ text: read("mn3ga_30k_sim.xye"), filename: "mn3ga_30k_sim.xye", instrument });
  return loadedSession(structure, pattern, instrument);
}

export function example3Session(): Session {
  const s = example3Loaded();
  const free = new Set(matchIds(s.powderParams, ["scale", "bkg*", "cell_*", "profU", "profV", "profW"]));
  const r = runPowderRefinement({
    type: "refinePowder",
    requestId: 0,
    structure: s.structure,
    pattern: s.pattern,
    parameters: s.powderParams.map((p) => ({ ...p, fixed: !free.has(p.id) })),
    bindings: s.powderBindings,
    shape: s.powderProfile.shape,
    restraints: powderRestraints([s.structure], s.siteTies, s.powderParams),
    options: { maxIterations: 30 },
  });
  return { ...s, powderParams: s.powderParams.map((p) => ({ ...p, value: r.parameters[p.id] ?? p.value })) };
}


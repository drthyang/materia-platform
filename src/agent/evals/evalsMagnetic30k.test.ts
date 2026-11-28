import { describe } from "vitest";
import { scenarioReplays } from "@/agent/evals/scriptedReplay";

/** The scripted eval suite (see evals.test.ts), the magnetic-30k scenarios. */

describe("Agent evals, scripted", () => {
  scenarioReplays("magnetic-30k");
});

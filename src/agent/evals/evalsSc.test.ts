import { describe } from "vitest";
import { scenarioReplays } from "@/agent/evals/scriptedReplay";

/** The scripted eval suite (see evals.test.ts), the sc scenarios. */

describe("Agent evals, scripted", () => {
  scenarioReplays("sc");
});

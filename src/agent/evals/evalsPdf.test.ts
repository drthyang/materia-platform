import { describe } from "vitest";
import { scenarioReplays } from "@/agent/evals/scenarioReplays";

/** The scripted eval suite (see evals.test.ts), the pdf scenarios. */

describe("Agent evals, scripted", () => {
  scenarioReplays("pdf");
});

import { describe } from "vitest";
import { scenarioReplays } from "@/agent/evals/scenarioReplays";

/** The scripted eval suite (see evals.test.ts), the slow scenarios (four-minute cases): today magnetic-30k alone. */

describe("Agent evals, scripted", () => {
  scenarioReplays("slow");
});

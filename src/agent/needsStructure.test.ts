import { describe, expect, it } from "vitest";
import { requireStructure } from "@/agent/powderTools";
import type { PowderLiveState } from "@/agent/port";

describe("tools that need a structure", () => {
  it("refuse check_fit_range on the empty placeholder: with no reflections there are no gaps to cut in", () => {
    const placeholder = { structure: { sites: [] } } as unknown as PowderLiveState;
    expect(() => requireStructure("check_fit_range", placeholder)).toThrow(/no structure is loaded/);
    expect(() => requireStructure("get_state", placeholder)).not.toThrow();
  });
});

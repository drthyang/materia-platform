/**
 * The By subgroup listing with a structure whose displacement representation
 * cannot be worked out (the engine's error stood in for here): the failure is said,
 * not swallowed. Before, displacementOf caught it and the rows were built as
 * if there were no structure (no mode counts, no bond-stretch order), which
 * read as a result: the P-42₁m 1×1×2 row of the user's rounded GaTa₄Se₈ led
 * with "Δ1 + X5" for that reason.
 */
import { describe, expect, it, vi } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import type { SupercellSpec } from "@/core/crystal/irreps/supercell";
import { displacementOf } from "@/app/ui/subgroupPicker";
import { collectListing, supercellListingSteps } from "@/app/ui/supercellListing";
import { startSupercellListing } from "@/app/ui/supercellListingClient";
import { srtio3 } from "@/testSupport/perovskiteTilts";

// The engine's own failure for a parent it cannot place (the user's rounded GaTa₄Se₈ before the exact-site fix),
// raised for the structure marked BROKEN: the engine now places every structure the repo reads.
const ENGINE_ERROR = "supercellModes: an atom of the parent's T″ cell is no atom of the child's cell";
vi.mock("@/core/crystal/irreps/supercellModes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/crystal/irreps/supercellModes")>();
  return {
    ...real,
    displacementCharacters: (...a: Parameters<typeof real.displacementCharacters>) => {
      if (a[0].sites.some((s) => s.label === "BROKEN")) throw new Error(ENGINE_ERROR);
      return real.displacementCharacters(...a);
    },
  };
});

const STO = srtio3();
const B112: SupercellSpec = { P: [[1, 0, 0], [0, 1, 0], [0, 0, 2]], centring: "P" };
const BROKEN: StructureModel = { ...STO, sites: STO.sites.map((s, i) => (i === 0 ? { ...s, label: "BROKEN" } : s)) };
const group = factorGroup(STO.spaceGroup.operations, B112);
const FAILED = `mode counts for this structure failed (${ENGINE_ERROR})`;

describe("a structure whose modes cannot be counted", () => {
  it("is said by displacementOf, not swallowed", () => {
    expect(displacementOf(undefined, group)).toBeUndefined();
    expect(displacementOf(STO, group)).toBeDefined();
    expect(() => displacementOf(BROKEN, group)).toThrow(FAILED);
  });

  it("ends the larger cells' listing with the reason, on the main thread and through the client", async () => {
    const input = { operations: STO.spaceGroup.operations, bound: B112, boundLabel: "1×1×2", structure: BROKEN };
    expect(() => collectListing(supercellListingSteps(input, { group }))).toThrow(FAILED);
    const message = await new Promise<string>((resolve, reject) => {
      startSupercellListing(input, group, { progress: () => {}, rows: () => {}, done: () => reject(new Error("listed")), error: resolve });
    });
    expect(message).toMatch(FAILED);
  });
});

import { describe, it, expect } from "vitest";
import { LIVE_TOOLS } from "@/agent/tools";
import { PDF_PLANS } from "@/agent/pdfTools";
import { executor, fakeHost, pdfPort } from "@/testSupport/agentHeadless";

/**
 * A page's changes as plans (pages/plans.ts): one per change tool of the
 * page, each saying what its card will say and making the change, or why
 * there is nothing to do. The PDF page is the first on plans.
 */

describe("the PDF page's changes, planned", () => {
  it("has a plan for every change tool of the page (allow_exception is the executor's)", () => {
    const tools = LIVE_TOOLS.filter((t) => t.effect === "change" && t.pages.includes("pdf") && t.name !== "allow_exception").map((t) => t.name).sort();
    expect(Object.keys(PDF_PLANS).sort()).toEqual(tools);
  });

  it("refuses a change that cannot run before its card, not after the user approved it", async () => {
    const { port } = pdfPort();
    const { ex, asked } = executor(fakeHost(port).host, "auto");
    const window = await ex.run("set_fit_range", { min: 5, max: 3 });
    expect(window.text).toMatch(/the window needs max > min/);
    // Se1 is an anion of GaTa₄Se₈: it has no coordination shell of its own to track.
    const scan = await ex.run("boxcar_scan", { width: 2, step: 1, bonds: ["Se1"] });
    expect(scan.text).toMatch(/has no coordination shell of its own/);
    await ex.run("set_free", { fix: ["*"] });
    const before = asked.length;
    const refine = await ex.run("refine", {});
    expect(refine.text).toMatch(/no parameter is free/);
    expect(asked.map((a) => a.tool)).toEqual(["set_free"]);
    expect(asked.length).toBe(before);
  });
});

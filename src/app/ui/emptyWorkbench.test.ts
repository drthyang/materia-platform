import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyWorkbench } from "@/app/PowderWorkbench";
import { DEMOS } from "@/app/demos";

/** The landing view as the shell renders it, with the demos it can serve. */
function landing(demos = DEMOS): string {
  return renderToStaticMarkup(
    createElement(EmptyWorkbench, { demos, onLoadDemo: () => undefined, onOpenProject: () => undefined }),
  );
}

describe("the landing page is the way to a demo", () => {
  it("lists every bundled demo as a card", () => {
    const html = landing();
    for (const d of DEMOS) {
      expect(html, d.id).toContain(d.title);
      expect(html, d.id).toContain(d.kicker);
    }
    // One button per demo.
    expect((html.match(/<button\b/g) ?? []).length).toBe(DEMOS.length);
  });

  it("lists the demos in the shell's list, so one that needs local data shows only when the shell serves it", () => {
    const publicBuild = DEMOS.filter((d) => !d.local);
    const html = landing(publicBuild);
    for (const d of publicBuild) expect(html).toContain(d.title);
    for (const d of DEMOS.filter((x) => x.local)) expect(html).not.toContain(d.title);
  });

  it("covers the demos the header menu used to offer: Rietveld, magnetic (local data) and PDF", () => {
    expect(DEMOS.map((d) => d.id).sort()).toEqual(["magnetic", "pdf", "rietveld"]);
    expect(DEMOS.find((d) => d.id === "magnetic")?.local).toBe(true);
  });

  it("offers opening a saved project beside them", () => {
    expect(landing()).toContain("open a saved project");
  });
});

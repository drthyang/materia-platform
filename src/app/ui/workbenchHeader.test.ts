import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchHeader } from "@/app/ui/WorkbenchHeader";

/** The header as the shell renders it, with only the props a case names. */
function header(props: Partial<Parameters<typeof WorkbenchHeader>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(WorkbenchHeader, {
      steps: [{ label: "Nuclear" }, { label: "Magnetic" }],
      active: 0,
      onStep: () => undefined,
      version: "v0.0.0",
      exports: [],
      ...props,
    }),
  );
}

/** The header's buttons by accessible name: aria-label when it has one, else its text. */
function buttonNames(html: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs = "", inner = ""]) => {
    const label = /aria-label="([^"]*)"/.exec(attrs)?.[1];
    return label ?? inner.replace(/<[^>]*>/g, "").trim();
  });
}

describe("the header's Save and Load buttons", () => {
  it("shows Save and Load as buttons of their own, and no Project menu", () => {
    const html = header({ onSaveProject: () => undefined, onOpenProject: () => undefined });
    const names = buttonNames(html);
    expect(names).toContain("Save project");
    expect(names).toContain("Load project");
    // Their visible words are the short ones, on the same button class as History / Demos / Export.
    expect(html).toMatch(/<button[^>]*class="wb-header-action wb-header-file"[^>]*aria-label="Save project"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button[^>]*class="wb-header-action wb-header-file"[^>]*aria-label="Load project"[^>]*>Load<\/button>/);
    // The menu that held only these two is gone: nothing says "Project ▾".
    expect(html).not.toContain("Project ▾");
    expect(names.some((n) => n.startsWith("Project"))).toBe(false);
  });

  it("puts them in the actions row, Save then Load, between History and Demos", () => {
    const html = header({
      onSaveProject: () => undefined,
      onOpenProject: () => undefined,
      demos: [{ id: "rietveld", label: "Rietveld demo" }],
      onLoadDemo: () => undefined,
      exports: [{ label: "Report", onClick: () => undefined }],
    });
    const row = html.slice(html.indexOf("wb-header-actions"));
    const at = (name: string): number => row.indexOf(name);
    expect(at("Save project")).toBeGreaterThan(-1);
    expect(at("Save project")).toBeLessThan(at("Load project"));
    expect(at("Load project")).toBeLessThan(at("Demos ▾"));
    expect(at("Demos ▾")).toBeLessThan(at("Export ▾"));
  });

  it("gives each a tooltip that names the file", () => {
    const html = header({ onSaveProject: () => undefined, onOpenProject: () => undefined });
    expect(html).toMatch(/title="Save project[^"]*\.materia\.json[^"]*"/);
    expect(html).toMatch(/title="Load project[^"]*\.materia\.json[^"]*"/);
  });

  it("opens project files through a hidden picker that accepts .json", () => {
    const html = header({ onOpenProject: () => undefined });
    const input = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('accept=".materia.json,.json,application/json"');
    // Out of the tab order and the accessibility tree: the Load button is the control.
    expect(input).toContain('tabindex="-1"');
    expect(input).toContain('aria-hidden="true"');
  });

  it("offers Load alone before anything is loaded (no Save without a session)", () => {
    const names = buttonNames(header({ onOpenProject: () => undefined }));
    expect(names).toContain("Load project");
    expect(names).not.toContain("Save project");
  });

  it("offers neither when the shell wires neither", () => {
    const names = buttonNames(header());
    expect(names).not.toContain("Save project");
    expect(names).not.toContain("Load project");
  });
});

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

describe("the header's Save, Open and Close buttons", () => {
  const all = { onSaveProject: () => undefined, onOpenProject: () => undefined, onCloseProject: () => undefined };

  it("shows Save, Open and Close as buttons of their own, and no Project menu", () => {
    const html = header(all);
    const names = buttonNames(html);
    expect(names).toContain("Save project");
    expect(names).toContain("Open project");
    expect(names).toContain("Close project");
    // Their visible words are the short ones, on the same button class as History / Export.
    expect(html).toMatch(/<button[^>]*class="wb-header-action wb-header-file"[^>]*aria-label="Save project"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button[^>]*class="wb-header-action wb-header-file"[^>]*aria-label="Open project"[^>]*>Open<\/button>/);
    expect(html).toMatch(/<button[^>]*class="wb-header-action wb-header-file"[^>]*aria-label="Close project"[^>]*>Close<\/button>/);
    // The menu that held only Save and Open is gone: nothing says "Project ▾".
    expect(html).not.toContain("Project ▾");
    expect(names.some((n) => n.startsWith("Project"))).toBe(false);
  });

  it("calls Open what used to be Load", () => {
    const html = header(all);
    expect(buttonNames(html)).not.toContain("Load project");
    expect(html).not.toMatch(/>Load<\/button>/);
  });

  it("has no Demo menu and no demo state, whatever the shell used to pass", () => {
    const html = header(all);
    expect(html).not.toContain("Demos");
    expect(html).not.toContain("Demo ✓");
    expect(html).not.toContain("Exit demo");
    expect(buttonNames(html).some((n) => /demo/i.test(n))).toBe(false);
  });

  it("puts them in the actions row: History, Save, Open, Close, Export", () => {
    const html = header({
      ...all,
      history: { history: null, recordNow: () => undefined, requestStep: () => undefined, goTo: () => undefined, rename: () => undefined },
      exports: [{ label: "Report", onClick: () => undefined }],
    });
    const row = html.slice(html.indexOf("wb-header-actions"));
    const at = (name: string): number => row.indexOf(name);
    expect(at('aria-label="History"')).toBeGreaterThan(-1);
    expect(at('aria-label="History"')).toBeLessThan(at("Save project"));
    expect(at("Save project")).toBeLessThan(at("Open project"));
    expect(at("Open project")).toBeLessThan(at("Close project"));
    expect(at("Close project")).toBeLessThan(at("Export ▾"));
  });

  it("gives each a tooltip that names the file", () => {
    const html = header(all);
    expect(html).toMatch(/title="Save project[^"]*\.materia\.json[^"]*"/);
    expect(html).toMatch(/title="Open project[^"]*\.materia\.json[^"]*"/);
    expect(html).toMatch(/title="Close project[^"]*\.materia\.json[^"]*"/);
  });

  it("opens project files through a hidden picker that accepts .json", () => {
    const html = header({ onOpenProject: () => undefined });
    const input = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('accept=".materia.json,.json,application/json"');
    // Out of the tab order and the accessibility tree: the Open button is the control.
    expect(input).toContain('tabindex="-1"');
    expect(input).toContain('aria-hidden="true"');
  });

  it("offers Open alone before anything is loaded (no Save or Close without a project)", () => {
    const names = buttonNames(header({ onOpenProject: () => undefined }));
    expect(names).toContain("Open project");
    expect(names).not.toContain("Save project");
    expect(names).not.toContain("Close project");
  });

  it("offers none of them when the shell wires none", () => {
    const names = buttonNames(header());
    expect(names).not.toContain("Save project");
    expect(names).not.toContain("Open project");
    expect(names).not.toContain("Close project");
  });
});

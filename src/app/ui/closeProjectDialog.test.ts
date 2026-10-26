import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CloseProjectDialog } from "@/app/ui/CloseProjectDialog";

describe("the Close guard dialog", () => {
  const html = renderToStaticMarkup(
    createElement(CloseProjectDialog, { onSave: () => undefined, onDiscard: () => undefined, onCancel: () => undefined }),
  );

  it("is a modal alert dialog with a name and a description", () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="wb-close-title"/);
    expect(html).toMatch(/aria-describedby="wb-close-text"/);
    expect(html).toContain("Close this project?");
  });

  it("offers Save, Discard and Cancel, Save first", () => {
    const names = [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(names).toEqual(["Save", "Discard", "Cancel"]);
  });
});

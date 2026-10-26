import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { mn3gaSession } from "@/agent/evals/pages";
import { liveTool } from "@/agent/tools";
import { sessionPort } from "@/testSupport/agentHeadless";
import { DEFAULT_INSTRUMENT, type Session } from "@/app/powderSession";
import { backgroundTermsEntry, withBackgroundTerms, withParameter } from "@/app/powderPage";
import { powderWorkspaceFrom, projectFileFor, sessionFromPowderWorkspace } from "@/app/projectIo";
import { ParameterPanel } from "@/app/ui/ParameterPanel";
import { parseProject, serializeProject } from "@/core/project/io";

/**
 * A background at 0 on the powder page. The terms field emptied to retype the
 * count read as 0 (`Number("")`), and the page took 0 terms: every background
 * row went, and with them the Background group and its function and terms
 * controls left the parameter panel, with nothing on the page to bring them
 * back (and a project saved so would not open: it needs one term). A
 * coefficient at 0 is a value like any other and keeps its row.
 */

const backgroundRows = (s: Session): { id: string; value: number; fixed: boolean }[] =>
  s.powderParams.filter((p) => p.kind === "background").map(({ id, value, fixed }) => ({ id, value, fixed }));

/** The parameter panel as the page renders it (its groups collapsed): the group headers. */
const panel = (s: Session): string =>
  renderToStaticMarkup(createElement(ParameterPanel, { params: s.powderParams, onChange: () => undefined, onRefine: () => undefined, onReset: () => undefined, busy: false, result: null }));

describe("the background's terms at 0", () => {
  it("keep one coefficient, at its value, so the Background group stays on the panel", () => {
    const s = mn3gaSession();
    const c0 = backgroundRows(s)[0]!;
    const zero = withBackgroundTerms(s, 0, DEFAULT_INSTRUMENT);
    expect(zero.backgroundTerms).toBe(1);
    expect(backgroundRows(zero)).toEqual([c0]);
    expect(panel(zero)).toContain(">Background<");
    expect(panel(zero)).toContain(`>${c0.fixed ? 0 : 1}/1 free<`);
  });

  it("are no entry the terms field applies: an emptied field, 0, a fraction or more than 24 waits", () => {
    for (const raw of ["", " ", "0", "-1", "2.5", "25", "e"]) expect(backgroundTermsEntry(raw), JSON.stringify(raw)).toBeNull();
    expect(["1", "6", "24"].map(backgroundTermsEntry)).toEqual([1, 6, 24]);
  });

  it("leave the page as it is when the count is no number", () => {
    const s = mn3gaSession();
    expect(withBackgroundTerms(s, Number.NaN, DEFAULT_INSTRUMENT)).toBe(s);
  });

  it("are not offered to the Agent, and its page keeps one coefficient", () => {
    const schema = z.object(liveTool("set_background")!.inputSchema).strict();
    expect(schema.safeParse({ terms: 0 }).success).toBe(false);
    expect(schema.safeParse({ terms: 1 }).success).toBe(true);
    const { port } = sessionPort(mn3gaSession());
    port.setBackgroundTerms(0);
    expect(port.state().settings.backgroundTerms).toBe(1);
    expect(port.state().parameters.filter((p) => p.kind === "background")).toHaveLength(1);
  });
});

describe("a background coefficient at 0", () => {
  it("keeps its row, value and state through a new count and a saved project, and the project opens", () => {
    const s = withParameter(withParameter(mn3gaSession(), "bkg0", { value: 0 }), "bkg1", { value: 0, fixed: true });
    const more = withBackgroundTerms(s, s.backgroundTerms + 2, DEFAULT_INSTRUMENT);
    expect(backgroundRows(more).slice(0, 2)).toEqual([{ id: "bkg0", value: 0, fixed: false }, { id: "bkg1", value: 0, fixed: true }]);
    expect(backgroundRows(more)).toHaveLength(s.backgroundTerms + 2);
    for (const saved of [more, withBackgroundTerms(more, 0, DEFAULT_INSTRUMENT)]) {
      const ws = powderWorkspaceFrom(saved, null, DEFAULT_INSTRUMENT, true, { fitRange: null, displayUnit: null, manualPeakD: [] });
      const file = parseProject(serializeProject(projectFileFor({ structures: [saved.structure], workspace: ws, title: "t" })));
      if (file.workspace.technique !== "powder") throw new Error("technique");
      const back = sessionFromPowderWorkspace(file.workspace, file.structures).session;
      expect(back.backgroundTerms).toBe(saved.backgroundTerms);
      expect(backgroundRows(back)).toEqual(backgroundRows(saved));
    }
  });
});

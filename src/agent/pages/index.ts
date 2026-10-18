/**
 * The pages the Agent works on, one adapter each (types.ts), and the one place
 * a port finds its page's adapter.
 */

import type { AgentPort } from "@/agent/port";
import type { AgentPage } from "@/agent/tools";
import type { PageAdapter } from "@/agent/pages/types";
import { POWDER_PAGE } from "@/agent/pages/powder";
import { PDF_PAGE } from "@/agent/pages/pdf";
import { SINGLE_CRYSTAL_PAGE } from "@/agent/pages/singleCrystal";

export type { AgreementKey, PageAdapter, PageHost, StateOf, ToolInput } from "@/agent/pages/types";
export { hashText } from "@/agent/pages/stamp";

/** Each page's adapter, by the port's technique. */
export const PAGES: { readonly [K in AgentPage]: PageAdapter<Extract<AgentPort, { technique: K }>> } = {
  powder: POWDER_PAGE,
  pdf: PDF_PAGE,
  singleCrystal: SINGLE_CRYSTAL_PAGE,
};

/** Run `f` with the port's page adapter and the port, both typed on that page. */
export function onPage<R>(port: AgentPort, f: <P extends AgentPort>(page: PageAdapter<P>, port: P) => R): R {
  switch (port.technique) {
    case "powder":
      return f(PAGES.powder, port);
    case "pdf":
      return f(PAGES.pdf, port);
    case "singleCrystal":
      return f(PAGES.singleCrystal, port);
  }
}

/** The analysis on the page now: the Agent's record is kept under it (method.ts). */
export const analysisOf = (port: AgentPort): string => onPage(port, (page, p) => page.analysis(page.state(p)));

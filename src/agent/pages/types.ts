/**
 * A page as the Agent's executor sees it. The executor runs every call the
 * same way on each page (validate, gate, ask, act, answer); what differs by
 * page is held here, once per page:
 *
 * - its facts: the agreement it shows (wR, Rw, wR2), the stamp a change is
 *   approved against, the analysis it holds, the references the Agent quotes,
 *   the report's checks, the groups the correlation check lists and does not
 *   stop;
 * - where its tools run: a read in the page's own tools module (powderTools,
 *   pdfTools, scTools, magneticTools); a change by its plan (plans.ts).
 *
 * One adapter per page (powder.ts, pdf.ts, singleCrystal.ts), typed on that
 * page's port and state; index.ts finds the adapter for a port.
 */

import type { CardDecision, CardOptionGroup } from "@/agent/cardOptions";
import type { AgentPort, PdfLiveState, PowderLiveState, SingleCrystalLiveState } from "@/agent/port";
import type { LiveToolSpec } from "@/agent/tools";
import type { ChangeResult, LiveToolHost } from "@/agent/liveCommon";
import type { MagneticPanelState } from "@/agent/magneticPort";
import type { ReferenceEntry } from "@/agent/references";
import type { AgentRecord } from "@/agent/method";
import type { ReportCheck } from "@/core/export/report";
import type { RefinementResult } from "@/core/refinement/types";

/** A page's live state, by its port. */
export type StateOf<P extends AgentPort> = { readonly powder: PowderLiveState; readonly pdf: PdfLiveState; readonly singleCrystal: SingleCrystalLiveState }[P["technique"]];

/** A tool's input, validated against its schema before a page sees it. */
export type ToolInput = Record<string, unknown>;

/**
 * A change, planned before it is asked for: nothing to do (and why), or the
 * line the approval card shows and the change itself, made once approved on
 * the state it was planned on (the executor holds back a change whose page
 * moved meanwhile). A change that cannot run is refused here, before its card.
 */
export type Plan =
  | { readonly noOp: string }
  | {
      readonly preview: string;
      /** `decision`: the user's picks on a card with options; absent when approved without one (auto mode, or a card with none). */
      readonly apply: (host: PageHost, decision?: CardDecision) => Promise<ChangeResult>;
      /** Options the card shows, the Agent's pick preselected (cardOptions.ts). */
      readonly options?: readonly CardOptionGroup[];
    };

/** What a page's tools need of the shell: the History, the records, and a wait for the page to render (the magnetic step reads after its fits). */
export interface PageHost extends LiveToolHost {
  readonly settle: () => Promise<void>;
}

/** The agreement a page shows, by the name it shows: wR on powder, Rw on PDF (uniform weights, no GoF), wR2 on F² on the single crystal. */
export type AgreementKey = "wR" | "Rw" | "wR2";

export interface PageAdapter<P extends AgentPort> {
  readonly page: P["technique"];
  /** The port when it is this page's, else null: by the time a card is approved the shell may hold another page's. */
  readonly own: (port: AgentPort) => P | null;
  /** The page's state now, typed on the page. */
  readonly state: (port: P) => StateOf<P>;
  /** The analysis the page holds (method.ts): the Agent's record is kept under it. */
  readonly analysis: (s: StateOf<P>) => string;
  /**
   * Every setting the Agent can change on the page, hashed: a change approved
   * against one stamp is not run on another, and the situation's fingerprint
   * carries it. `step` is the magnetic step's panel once its tools are in use
   * (null otherwise, and on the pages without one).
   */
  readonly stamp: (s: StateOf<P>, step: MagneticPanelState | null) => string;
  readonly agreementKey: AgreementKey;
  /** The agreement of the curves on screen (a fraction), live. */
  readonly agreement: (s: StateOf<P>) => number;
  /** A refinement's figures beside the agreement, as the model reads them: the GoF on powder; R1 before and after, and the GooF, on the single crystal. */
  readonly figures: (before: StateOf<P>, after: StateOf<P>, r: RefinementResult) => Record<string, unknown>;
  /** What the record keeps beside the agreement where the fit started (R1 on the single crystal). */
  readonly start: (s: StateOf<P>) => { readonly r1?: number };
  /** The values the Agent's {{references}} name (references.ts). */
  readonly references: (s: StateOf<P>) => ReferenceEntry[];
  /** Throws when the page has nothing to report on yet (a powder page without a structure). */
  readonly reportable?: (s: StateOf<P>) => void;
  /** The report's checks: the correlations at the refined values (`probe`), the analysis' record. */
  readonly reportChecks: (s: StateOf<P>, probe: RefinementResult | null, record: AgentRecord) => ReportCheck[];
  /** Groups whose correlated pairs are listed, not stopped (SHELXL's PART groups on the single crystal). */
  readonly assemblies: (s: StateOf<P>) => ReadonlyMap<string, string>;
  /** The magnetic step's panel (the powder page's), null while it has none. */
  readonly magneticStep?: (port: P) => MagneticPanelState | null;
  /** A magnetic model is part of the page's fit (the powder page's magnetic step under way). */
  readonly magneticModel?: (s: StateOf<P>) => boolean;
  /** Run a read tool. */
  readonly read: (name: string, input: ToolInput, port: P, host: PageHost) => unknown;
  /** A change's plan on the state the card is checked against: nothing to do, or the card's line and the change. */
  readonly plan: (spec: LiveToolSpec, input: ToolInput, s: StateOf<P>, port: P) => Plan;
  /** What a change's answer adds from the page after it (the magnetic step's view). */
  readonly outcome?: (name: string, port: P) => Record<string, unknown>;
}

/**
 * The B-at-0 notice (core/diagnostics/zeroAdp.ts) over the parameter list:
 * each B the last fit left on its lower bound, with its options ranked, each
 * with its Apply; and each fix in force, with Release. The proposal is never
 * applied without this click (or the Agent's approved card).
 *
 * Every line is short, the result or the action first (zeroAdpLines.ts): the
 * rule's own sentences — the warning, each option's account, the fix's — are
 * behind the "?" beside it, and a tie across two different sites carries a ⚠
 * with its caution.
 */

import type { CSSProperties } from "react";
import type { RefinementParameter, RefinementResult } from "@/core/refinement/types";
import { color, secondaryButton, space } from "@/app/theme";
import { ZERO_ADP_BAYES, type ZeroAdpFix, type ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";
import { zeroAdpFixLine, zeroAdpHead, zeroAdpOptionLine, zeroAdpProposalLine } from "@/core/diagnostics/zeroAdpLines";
import { LineMarks, ShortLineText } from "@/app/ui/lineInfo";

interface Props {
  readonly proposals: readonly ZeroAdpProposal[];
  readonly applied: readonly ZeroAdpFix[];
  readonly busy: boolean;
  /** Apply the option the user picked (its index in the proposal's ranked options). */
  readonly onApply: (choices: readonly { readonly parameterId: string; readonly option: number }[]) => void;
  readonly onRelease: (parameterId: string) => void;
  /** The last fit and the rows: a tied B shows its leader's value as it stands, with its esd. */
  readonly result?: RefinementResult | null;
  readonly parameters?: readonly RefinementParameter[];
}

/** The page's own words for the Bayesian check: the Posterior view, not an Agent tool. */
const POSTERIOR = "If a B carries physical meaning (a conclusion rests on it), sample its posterior (the Posterior view) before quoting it: a parameter on its bound is not convincing, and its esd means nothing.";

export function ZeroAdpNotice({ proposals, applied, busy, onApply, onRelease, result, parameters }: Props): JSX.Element | null {
  if (proposals.length === 0 && applied.length === 0) return null;
  return (
    <div data-agent-card="parameters" role="status" style={wrap}>
      {proposals.length > 0 && (
        <div style={{ ...box, ...warnTone }}>
          <div style={head}>⚠ B at its lower bound — choose an option, or none</div>
          {proposals.map((p) => (
            <div key={p.parameterId} data-proposal={p.parameterId} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {p.options.length === 0 ? (
                // Nothing to apply: why, in a line; the advice behind the "?".
                <span style={{ fontWeight: 600 }}><ShortLineText text={zeroAdpProposalLine(p).text} detail={[p.advice.replace(` ${ZERO_ADP_BAYES}`, "")]} /></span>
              ) : (
                <span style={{ fontWeight: 600 }}><ShortLineText text={zeroAdpHead(p)} detail={[p.warning.replace(` ${ZERO_ADP_BAYES}`, "")]} /></span>
              )}
              {p.options.map((o, i) => {
                const line = zeroAdpOptionLine(o);
                return (
                  <div key={i} data-option={o.id} style={row}>
                    <span style={{ ...rankTag, ...(o.rank === "preferred" ? preferredTag : {}) }}>{i + 1} · {o.rank}</span>
                    <span style={{ flex: 1, minWidth: 0 }}><ShortLineText text={line.text} caution={line.caution} detail={line.detail} /></span>
                    <button style={button} disabled={busy} onClick={() => onApply([{ parameterId: p.parameterId, option: i }])} title={o.rule === "A" ? `Tie ${p.parameterId} to ${o.leader} (a constraint: the common B refines)` : `Hold ${p.parameterId} fixed at the starting structure's value`}>
                      Apply
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={foot}>
            Quoting a B? Sample its posterior first (the Posterior view).
            <LineMarks detail={[POSTERIOR]} width={280} />
          </div>
        </div>
      )}
      {applied.length > 0 && (
        <div style={{ ...box, ...noteTone }}>
          {applied.map((f) => {
            const line = zeroAdpFixLine(f, { result, parameters });
            return (
              <div key={f.parameterId} data-fix={f.parameterId} style={row}>
                <span style={{ flex: 1, minWidth: 0 }}><ShortLineText text={line.text} caution={line.caution} detail={line.detail} /></span>
                <button style={button} disabled={busy} onClick={() => onRelease(f.parameterId)} title={`Free ${f.parameterId} again${f.rule === "A" ? " (the tie released)" : ""}; ⌘Z undoes the step instead`}>
                  Release
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const wrap: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: `8px ${space.inset}`, borderBottom: `1px solid ${color.border}` };
const box: CSSProperties = { borderRadius: 8, padding: "6px 10px", fontSize: 12, display: "flex", flexDirection: "column", gap: 5 };
const head: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontWeight: 650 };
const row: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8 };
const rankTag: CSSProperties = { flex: "0 0 auto", fontSize: 10.5, padding: "0 6px", borderRadius: 999, border: `1px solid ${color.warnBorder}`, whiteSpace: "nowrap" };
const preferredTag: CSSProperties = { fontWeight: 700 };
const foot: CSSProperties = { fontSize: 11, opacity: 0.85 };
const button: CSSProperties = { ...secondaryButton, flex: "0 0 auto", padding: "2px 10px", fontSize: 11 };
const warnTone: CSSProperties = { background: color.warnBg, border: `1px solid ${color.warnBorder}`, color: color.warnInk };
const noteTone: CSSProperties = { background: color.noteBg, border: `1px solid ${color.noteBorder}`, color: color.noteInk };

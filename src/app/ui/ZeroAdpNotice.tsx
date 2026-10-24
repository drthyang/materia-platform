/**
 * The B-at-0 notice (core/diagnostics/zeroAdp.ts) over the parameter list:
 * each B the last fit left on its lower bound, with the rule's proposal and
 * its source and a one-click Apply; and each fix in force, with Release. The
 * proposal is never applied without this click (or the Agent's approved card).
 */

import type { CSSProperties } from "react";
import { color, secondaryButton, space } from "@/app/theme";
import { ZERO_ADP_BAYES, zeroAdpFixText, type ZeroAdpFix, type ZeroAdpProposal } from "@/core/diagnostics/zeroAdp";

interface Props {
  readonly proposals: readonly ZeroAdpProposal[];
  readonly applied: readonly ZeroAdpFix[];
  readonly busy: boolean;
  /** Apply the option the user picked (its index in the proposal's ranked options). */
  readonly onApply: (choices: readonly { readonly parameterId: string; readonly option: number }[]) => void;
  readonly onRelease: (parameterId: string) => void;
}

export function ZeroAdpNotice({ proposals, applied, busy, onApply, onRelease }: Props): JSX.Element | null {
  if (proposals.length === 0 && applied.length === 0) return null;
  return (
    <div data-agent-card="parameters" role="status" style={wrap}>
      {proposals.length > 0 && (
        <div style={{ ...box, ...warnTone }}>
          <div style={head}>⚠ B at its lower bound — choose an option, or none</div>
          {proposals.map((p) => (
            <div key={p.parameterId} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontWeight: 600 }}>{p.atom} refined to 0 Å² (its lower bound).</span>
              {p.options.length === 0 && <span>{p.advice.replace(` ${ZERO_ADP_BAYES}`, "")}</span>}
              {p.options.map((o, i) => (
                <div key={i} style={row}>
                  <span style={{ ...rankTag, ...(o.rank === "preferred" ? preferredTag : {}) }}>{i + 1} · {o.rank}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{o.text}</span>
                  <button style={button} disabled={busy} onClick={() => onApply([{ parameterId: p.parameterId, option: i }])} title={o.rule === "A" ? `Tie ${p.parameterId} to ${o.leader} (a constraint: the common B refines)` : `Hold ${p.parameterId} fixed at the starting structure's value`}>
                    Apply
                  </button>
                </div>
              ))}
            </div>
          ))}
          <div style={foot}>If a B carries physical meaning (a conclusion rests on it), sample its posterior (the Posterior view) before quoting it: a parameter on its bound is not convincing, and its esd means nothing.</div>
        </div>
      )}
      {applied.length > 0 && (
        <div style={{ ...box, ...noteTone }}>
          {applied.map((f) => (
            <div key={f.parameterId} style={row}>
              <span style={{ flex: 1, minWidth: 0 }}>{zeroAdpFixText(f)}</span>
              <button style={button} disabled={busy} onClick={() => onRelease(f.parameterId)} title={`Free ${f.parameterId} again${f.rule === "A" ? " (the tie released)" : ""}; ⌘Z undoes the step instead`}>
                Release
              </button>
            </div>
          ))}
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

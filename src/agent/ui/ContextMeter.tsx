/**
 * The context meter by the Copilot's message box: "Context 62%" against the
 * model's own window (contextMeter.ts), its details behind "?", and, from
 * amber, the two ways on: Start fresh, or Summarize and continue.
 */

import { useEffect, useRef, useState } from "react";
import { contextLevel, contextPercent, meterDetails, meterLabel, type ContextLevel, type ContextReading } from "@/agent/contextMeter";

export interface MeterView {
  readonly percent: number;
  readonly level: ContextLevel;
  /** The meter shows: always beside the page; on a phone (compact) only from amber, collapsed below it. */
  readonly shown: boolean;
  /** Start fresh and Summarize and continue are offered (amber and red). */
  readonly actions: boolean;
}

/** What the composer shows for a reading (null: no reading yet, so no meter). */
export function meterView(reading: ContextReading | null, compact: boolean): MeterView | null {
  if (reading === null) return null;
  const percent = contextPercent(reading);
  const level = contextLevel(percent);
  return { percent, level, shown: !compact || level !== "neutral", actions: level !== "neutral" };
}

/** The line above the message box from amber: how full, and the two ways on. */
export function ContextWarning({ view, busy, onFresh, onSummarize }: { view: MeterView; busy: boolean; onFresh: () => void; onSummarize: () => void }): JSX.Element {
  return (
    <div className="wb-agent-ctxwarn" data-level={view.level} role="status">
      <span className="wb-agent-ctxwarn-text">{view.level === "red" ? `The model's window is nearly full (${view.percent}%).` : `The model's window is ${view.percent}% full.`}</span>
      <span className="wb-agent-ctxwarn-actions">
        <button type="button" disabled={busy} onClick={onFresh} title="Clear the conversation and begin a new one. The page and its History stay as they are.">Start fresh</button>
        <button type="button" disabled={busy} onClick={onSummarize} title="The model writes a summary of the conversation and continues from it, in place of the earlier messages (they stay here for you to read).">Summarize and continue</button>
      </span>
    </div>
  );
}

/** The meter itself: a thin bar, "Context 62%", and "?" for the details. */
export function ContextMeter({ reading, view, cost, session }: { reading: ContextReading; view: MeterView; cost: number | "local" | null; session: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  // The details close on a click elsewhere and on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={box} className="wb-agent-ctx" data-level={view.level}>
      <span className="wb-agent-ctx-bar" aria-hidden>
        <span style={{ width: `${Math.min(100, view.percent)}%` }} />
      </span>
      <span className="wb-agent-ctx-label">{meterLabel(reading)}</span>
      <button type="button" className="wb-agent-ctx-help wb-tight" aria-expanded={open} aria-label="How full the model's window is: details" title="Details" onClick={() => setOpen((v) => !v)}>?</button>
      {open && (
        <span className="wb-agent-ctx-details" role="dialog" aria-label="Context details">
          {meterDetails(reading, cost).map((line) => <span key={line}>{line}</span>)}
          <span>{session}</span>
        </span>
      )}
    </span>
  );
}

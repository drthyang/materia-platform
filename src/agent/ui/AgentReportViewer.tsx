/**
 * The Agent's report, read in the app: the standalone HTML report in a frame,
 * with what to do with it — save it as HTML or Markdown, print it to PDF, and
 * save the refined structure's CIF beside it. Opens when the Agent writes a
 * report (write_report) and again from the drawer.
 *
 * The frame is sandboxed without scripts (the report has none); same-origin so
 * the Print button can print the report alone.
 */

import { useEffect, useRef, type CSSProperties } from "react";
import { color, fz, radius } from "@/app/theme";
import { downloadText } from "@/app/download";
import type { AgentReport } from "@/agent/report";

interface Props {
  readonly report: AgentReport;
  readonly onClose: () => void;
  /** Save the refined structure's CIF (the page's own export); absent when the page has none. */
  readonly onCif?: (() => void) | undefined;
}

export function AgentReportViewer({ report, onClose, onCif }: Props): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const print = (): void => {
    const w = frame.current?.contentWindow;
    if (w) {
      w.focus();
      w.print();
    }
  };
  const when = new Date(report.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Analysis report" style={panel}>
        <div style={head}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: fz.micro, letterSpacing: ".08em", textTransform: "uppercase", color: color.secondary }}>Analysis report · MATERIA Copilot</div>
            <div style={{ fontSize: 16, fontWeight: 650, color: color.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{report.title}</div>
            <div style={{ fontSize: fz.micro, color: color.faint }}>
              Written {when} · every number from the engine and the History; only the Copilot's account is its own words
              {report.unverified.length > 0 && (
                <span style={unverifiedChip} title={`Not among the values the report computed: ${report.unverified.join(", ")}`}>
                  {report.unverified.length} number{report.unverified.length === 1 ? "" : "s"} in its words unverified
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
            <button style={primaryButton} onClick={() => downloadText(`${report.fileBase}.html`, report.html, "text/html")} title="The report as one self-contained HTML file">Save HTML</button>
            <button style={secondaryButton} onClick={() => downloadText(`${report.fileBase}.md`, report.markdown, "text/markdown")} title="The report as Markdown, the figure embedded">Markdown</button>
            <button style={secondaryButton} onClick={print} title="Print the report, or save it as PDF from the print dialog">Print / PDF</button>
            {onCif && <button style={secondaryButton} onClick={onCif} title="The refined structure as CIF, with esds">CIF</button>}
            <button ref={close} style={closeButton} onClick={onClose} aria-label="Close the report" title="Close (Esc)">✕</button>
          </div>
        </div>
        <iframe ref={frame} title={`Report: ${report.title}`} srcDoc={report.html} sandbox="allow-same-origin allow-modals" style={{ flex: 1, border: 0, width: "100%", background: "#fff" }} />
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 80, background: "rgba(25, 23, 20, 0.38)", display: "flex", alignItems: "stretch", justifyContent: "center", padding: "24px 16px" };
const panel: CSSProperties = { width: "min(1160px, 100%)", display: "flex", flexDirection: "column", background: color.surface, borderRadius: radius.card, border: `1px solid ${color.border}`, boxShadow: "0 18px 50px rgba(25, 23, 20, 0.25)", overflow: "hidden" };
const head: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "12px 16px", borderBottom: `1px solid ${color.border}`, background: color.raised, flexWrap: "wrap" };
const primaryButton: CSSProperties = { border: `1px solid ${color.primary}`, background: color.primary, color: "#fff", borderRadius: 6, padding: "5px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const secondaryButton: CSSProperties = { border: `1px solid ${color.control}`, background: color.surface, color: color.ink, borderRadius: 6, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" };
const closeButton: CSSProperties = { border: "1px solid transparent", background: "transparent", color: color.secondary, borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontSize: 15, lineHeight: 1 };
const unverifiedChip: CSSProperties = { marginLeft: 8, padding: "1px 8px", borderRadius: 999, border: `1px solid ${color.warnBorder}`, background: color.warnBg, color: color.warnInk };

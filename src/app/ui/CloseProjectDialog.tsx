/**
 * "Close this project?" — the guard shown when Close is pressed with changes
 * the project file does not have (see closeProject.ts). Three answers: Save
 * (download the project file, then close), Discard (close without saving) and
 * Cancel (keep working). Save leads, and has the focus, because losing work is
 * the one mistake the dialog exists to prevent; Esc and a click outside are
 * Cancel, never Discard.
 *
 * A small modal: focus moves in on open, Tab stays among its three buttons,
 * and focus returns to where it was (the Close button) when it goes away.
 */

import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { color, fz, radius } from "@/app/theme";

interface Props {
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onCancel: () => void;
}

export function CloseProjectDialog({ onSave, onDiscard, onCancel }: Props): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const save = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    save.current?.focus();
    return () => before?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="wb-dialog-backdrop" style={backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        ref={panel}
        className="wb-close-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wb-close-title"
        aria-describedby="wb-close-text"
        style={card}
        onKeyDown={onKeyDown}
      >
        <div id="wb-close-title" style={title}>Close this project?</div>
        <p id="wb-close-text" style={text}>
          It has changes that are not in a saved <code>.materia.json</code> file. Save to keep them, or discard them.
        </p>
        <div style={row}>
          <button ref={save} type="button" className="wb-dialog-button" style={{ ...button, ...primaryButton }} onClick={onSave}>Save</button>
          <button type="button" className="wb-dialog-button" style={button} onClick={onDiscard}>Discard</button>
          <button type="button" className="wb-dialog-button" style={button} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(25,23,20,0.38)",
};

const card: CSSProperties = {
  width: "min(400px, 100%)",
  boxSizing: "border-box",
  padding: "20px 22px 18px",
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: 14,
  boxShadow: "0 18px 48px rgba(25,23,20,0.24)",
};

const title: CSSProperties = {
  fontSize: fz.large,
  fontWeight: 650,
  color: color.ink,
  letterSpacing: "-0.01em",
};

const text: CSSProperties = {
  margin: "8px 0 16px",
  fontSize: fz.small,
  lineHeight: 1.5,
  color: color.secondary,
};

const row: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  justifyContent: "flex-end",
};

const button: CSSProperties = {
  border: `1px solid ${color.control}`,
  background: color.surface,
  color: color.ink,
  borderRadius: radius.button,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 550,
  cursor: "pointer",
};

const primaryButton: CSSProperties = {
  border: `1px solid ${color.primary}`,
  background: color.primary,
  color: "#fff",
};

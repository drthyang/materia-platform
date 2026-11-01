/**
 * The run actions of a parameter panel: Prefit (Escape min once a fit exists),
 * Refine, and Cancel while a fit runs. They sit in the panel's action bar, or,
 * on a phone, in a bar fixed to the bottom of the screen (RunBar), so a long
 * parameter list never scrolls them away. The two share the handlers, the
 * disabled rule and the titles below; a page passes the same props either way
 * (ParameterPanel picks the place).
 *
 * "Phone" is RUN_BAR_QUERY: a narrow window, or a short landscape one with a
 * finger for a pointer (a phone on its side). A tablet and a desktop keep the
 * buttons in the panel, as they were.
 */

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { color, primaryButton, radius, secondaryButton } from "@/app/theme";
import { SHORT_LANDSCAPE } from "@/agent/ui/drawerWidth";

/**
 * Where the run actions move to the bottom bar: up to 640 px wide (a phone
 * held upright), or at most SHORT_LANDSCAPE px tall in landscape with a coarse
 * pointer (a phone on its side; a short desktop window keeps the panel's).
 */
export const RUN_BAR_QUERY = `(max-width: 640px), (max-height: ${SHORT_LANDSCAPE}px) and (orientation: landscape) and (pointer: coarse)`;

/**
 * Whether the Copilot drawer is open (App provides it). The bar hides then:
 * the sheet takes the bottom of a phone held upright, and its composer is
 * where the user types.
 */
export const CopilotOpenContext = createContext(false);

export interface RunActionsProps {
  readonly onRefine: () => void;
  /** Multi-start refine — perturbed restarts to reach the global minimum. */
  readonly onThorough?: (() => void) | undefined;
  /** Which face `onThorough` wears: "prefit" before any fit, "escape" after one. */
  readonly thoroughMode?: "prefit" | "escape" | undefined;
  /** Override for the cold-start ("prefit") tooltip (see ParameterPanel). */
  readonly prefitTitle?: string | undefined;
  /** Abort a running refinement; offered while `busy`. */
  readonly onCancel?: (() => void) | undefined;
  readonly busy: boolean;
  readonly disabled?: boolean | undefined;
}

const DEFAULT_PREFIT_TITLE = "Prefit from a cold start: a Le Bail cell pre-fit then a broad set of perturbed restarts, keeping the best — lands the structure in a good basin before you refine";
const ESCAPE_TITLE = "Escape a local minimum: a few perturbed restarts around the current fit, keeping the best — use when a plain Refine has stalled";
const REFINE_TITLE = "Refine the free parameters against the loaded data";
const CANCEL_TITLE = "Abort the running refinement";

const thoroughTitle = (mode: "prefit" | "escape", prefitTitle: string | undefined): string => (mode === "escape" ? ESCAPE_TITLE : prefitTitle ?? DEFAULT_PREFIT_TITLE);
const thoroughLabel = (mode: "prefit" | "escape"): string => (mode === "escape" ? "Escape min ↻" : "Prefit ↻");

/** The buttons as the panel's action bar has always shown them. */
export function PanelRunButtons({ onRefine, onThorough, thoroughMode = "prefit", prefitTitle, onCancel, busy, disabled }: RunActionsProps): JSX.Element {
  return (
    <>
      {onThorough && (
        <button
          style={{ ...secondaryButton, flex: "0 0 auto", padding: "10px 13px", fontSize: 13, fontWeight: 600, ...(busy || disabled ? disabledStyle : {}) }}
          disabled={busy || disabled}
          onClick={onThorough}
          title={thoroughTitle(thoroughMode, prefitTitle)}
        >
          {thoroughLabel(thoroughMode)}
        </button>
      )}
      <button
        style={{ ...primaryButton, flex: "1 1 auto", minWidth: 96, textAlign: "center", padding: "10px 16px", fontSize: 14, fontWeight: 650, ...(busy ? refiningStyle : disabled ? disabledStyle : {}) }}
        disabled={busy || disabled}
        onClick={onRefine}
        title={REFINE_TITLE}
      >
        {busy ? <span className="wb-shimmer-text">Refining…</span> : "Refine"}
      </button>
      {busy && onCancel && (
        <button style={panelCancel} onClick={onCancel} title={CANCEL_TITLE}>
          Cancel
        </button>
      )}
    </>
  );
}

/**
 * A tap on Cancel this soon after the run started is the second tap of a
 * double tap on Refine (Cancel takes Refine's place): it is ignored, so the
 * run it started is not cancelled at once.
 */
export const CANCEL_ARM_MS = 500;

/**
 * The phone's bottom bar: Prefit and Refine, and while a fit runs its state
 * and Cancel in Refine's place. Rendered into <body>, outside the page's
 * scrolling column, so it stays put; workbench.css places it (above the
 * Copilot bar, or beside the Copilot rail on a phone on its side) and pads
 * the page's end by its height. Hidden while the Copilot is open and while
 * the on-screen keyboard is up.
 */
export function RunBar({ onRefine, onThorough, thoroughMode = "prefit", prefitTitle, onCancel, busy, disabled }: RunActionsProps): JSX.Element | null {
  const copilotOpen = useContext(CopilotOpenContext);
  const keyboard = useOnScreenKeyboard();
  const row = useRef<HTMLDivElement>(null);
  // When the run started (0: it was running when the bar appeared).
  const startedAt = useRef(0);
  // Keyboard focus was in the bar when Refine gave way to Cancel (or back):
  // the button that takes its place gets it, so Tab does not restart from the top.
  const focusInBar = useRef(false);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current === busy) return;
    wasBusy.current = busy;
    if (busy) startedAt.current = Date.now();
    const active = document.activeElement;
    if (focusInBar.current && (active === null || active === document.body)) {
      row.current?.querySelector<HTMLButtonElement>("[data-run-primary]")?.focus({ preventScroll: true });
    }
  }, [busy]);
  if (typeof document === "undefined") return null;

  const running = busy && onCancel !== undefined;
  const cancel = (e: MouseEvent<HTMLButtonElement>): void => {
    if (startedAt.current > 0 && Date.now() - startedAt.current < CANCEL_ARM_MS) {
      e.preventDefault();
      return;
    }
    onCancel?.();
  };
  return createPortal(
    <div className="wb-run-bar" role="group" aria-label="Refinement" hidden={copilotOpen || keyboard}>
      <div
        ref={row}
        className="wb-run-bar-row"
        onFocus={() => {
          focusInBar.current = true;
        }}
        onBlur={(e) => {
          // A button that leaves the DOM blurs with no target: keep the note.
          if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) focusInBar.current = false;
        }}
      >
        {running ? (
          <span className="wb-run-bar-status" role="status">Refining…</span>
        ) : (
          onThorough && (
            <button
              type="button"
              style={{ ...barSecondary, ...(busy || disabled ? disabledStyle : {}) }}
              disabled={busy || disabled}
              onClick={onThorough}
              title={thoroughTitle(thoroughMode, prefitTitle)}
            >
              {thoroughLabel(thoroughMode)}
            </button>
          )
        )}
        {running ? (
          <button type="button" data-run-primary style={barCancel} onClick={cancel} title={CANCEL_TITLE}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            data-run-primary
            style={{ ...barPrimary, ...(busy ? refiningStyle : disabled ? disabledStyle : {}) }}
            disabled={busy || disabled}
            onClick={onRefine}
            title={REFINE_TITLE}
          >
            {busy ? <span className="wb-shimmer-text">Refining…</span> : "Refine"}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Whether the on-screen keyboard (or a select's picker) is likely up: a text
 * field, a select or an editable element has focus, or the visual viewport is
 * shorter than the window by a keyboard's height. The bar would otherwise
 * ride up over the field being typed in.
 */
export function useOnScreenKeyboard(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let focused = isTextEntry(document.activeElement);
    const vv = window.visualViewport;
    const update = (): void => {
      // Scaled back to CSS px, so a pinch zoom does not read as a keyboard.
      const shrunk = vv ? window.innerHeight - vv.height * vv.scale > KEYBOARD_MIN_PX : false;
      setUp(focused || shrunk);
    };
    const onIn = (e: FocusEvent): void => {
      focused = isTextEntry(e.target);
      update();
    };
    const onOut = (e: FocusEvent): void => {
      focused = isTextEntry(e.relatedTarget);
      update();
    };
    update();
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    vv?.addEventListener("resize", update);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      vv?.removeEventListener("resize", update);
    };
  }, []);
  return up;
}

/** A keyboard is shorter than this on no phone; browser toolbars are shorter still. */
const KEYBOARD_MIN_PX = 150;
/** Input types that bring up no keyboard. */
const NO_KEYBOARD = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** The element takes typed text (or opens a picker over the bottom of a phone). */
export function isTextEntry(el: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD.has(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
}

const disabledStyle: CSSProperties = { opacity: 0.55, cursor: "not-allowed" };
// While refining, keep the button vivid (so the shimmer reads) but show progress.
const refiningStyle: CSSProperties = { cursor: "progress" };
const panelCancel: CSSProperties = { padding: "11px 15px", fontSize: 13.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${color.warnBorder}`, background: color.warnBg, color: color.warnInk, cursor: "pointer" };
// The bar's buttons: 44 px tall (a finger's target), the primary taking the room.
const barButton: CSSProperties = { minHeight: 44, borderRadius: radius.button, fontWeight: 600, textAlign: "center", touchAction: "manipulation" };
const barSecondary: CSSProperties = { ...secondaryButton, ...barButton, flex: "0 0 auto", padding: "0 14px", fontSize: 14 };
const barPrimary: CSSProperties = { ...primaryButton, ...barButton, flex: "1 1 auto", minWidth: 120, padding: "0 16px", fontSize: 15, fontWeight: 650 };
const barCancel: CSSProperties = { ...panelCancel, ...barButton, flex: "1 1 auto", minWidth: 120, padding: "0 16px", fontSize: 15 };

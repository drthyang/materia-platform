/**
 * The parts of a short line with its longer account behind it: a "?" whose
 * tooltip holds the account paragraph by paragraph (a hover title does not
 * show on a touch screen), a ⚠ for a caution the line carries, and the line
 * kept with its last word so the marks never wrap onto a line of their own.
 * Shared by the Validation tab and the B-at-0 notice.
 */

import type { ReactNode } from "react";
import { color } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";

/** Lines of a "?" tooltip, each its own paragraph. */
export function Paragraphs({ lines }: { lines: readonly ReactNode[] }): JSX.Element {
  return <>{lines.map((l, i) => <span key={i} style={{ display: "block", marginTop: i > 0 ? 6 : 0 }}>{l}</span>)}</>;
}

/** A line ending in a "?" (or a ⚠) that wraps with its last word, never alone onto a line of its own. */
export function WithBadge({ text, badge }: { text: string; badge: ReactNode }): JSX.Element {
  if (!badge) return <>{text}</>;
  const cut = text.lastIndexOf(" ");
  return <>{text.slice(0, cut + 1)}<span style={{ whiteSpace: "nowrap" }}>{text.slice(cut + 1)}{badge}</span></>;
}

/**
 * The marks after a short line: a ⚠ with the caution as its tooltip, and a
 * "?" with the caution again (for a touch screen) and the longer account.
 * Null when there is neither.
 */
export function LineMarks({ caution, detail, width = 320 }: { caution?: string | undefined; detail?: readonly string[] | undefined; width?: number }): JSX.Element | null {
  const lines = [...(caution ? [`⚠ ${caution}`] : []), ...(detail ?? [])];
  if (lines.length === 0) return null;
  return (
    <>
      {caution ? <span role="img" title={caution} aria-label={caution} style={{ marginLeft: 4, color: color.warnInk, cursor: "help" }}>⚠</span> : null}
      <span style={{ display: "inline-flex", marginLeft: 5, verticalAlign: -2 }}>
        <InfoBadge text={lines.length === 1 ? lines[0] : <Paragraphs lines={lines} />} ariaLabel="In full" width={width} />
      </span>
    </>
  );
}

/** A short line with its marks. */
export function ShortLineText({ text, caution, detail, width }: { text: string; caution?: string | undefined; detail?: readonly string[] | undefined; width?: number }): JSX.Element {
  const marks = <LineMarks caution={caution} detail={detail} {...(width ? { width } : {})} />;
  return <WithBadge text={text} badge={caution || detail?.length ? marks : null} />;
}

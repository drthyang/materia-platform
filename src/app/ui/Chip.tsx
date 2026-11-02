/**
 * A k-point (or filter) chip: a pill that is pressed or not. The Subgroups
 * page's k-point chips and the 3D Model's distortion-mode chips share it, so
 * the two read alike.
 */

import type { ReactNode } from "react";
import { color, fz, mono } from "@/app/theme";

export function Chip({ on, label, aria, title, disabled, onClick }: { on: boolean; label: ReactNode; aria: string; title?: string; disabled?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={aria}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="wb-kchip"
      style={{
        flex: "0 0 auto", border: `1px solid ${on ? color.primary : color.control}`, background: on ? color.primaryTintBg : color.surface, color: on ? color.primary : color.ink,
        borderRadius: 999, padding: "3px 10px", fontSize: fz.micro, fontFamily: mono, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

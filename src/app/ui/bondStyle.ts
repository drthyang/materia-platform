/**
 * How the 3D structure view draws its bonds: the style (VESTA-like sticks,
 * ball-and-stick, thin lines), the color (one gray, or each half in its atom's
 * color) and whether they are drawn at all. Atoms, the cell and the arrows do
 * not depend on it.
 *
 * The choice is a view preference, not part of the model or the project file:
 * it is kept for the browser session (sessionStorage), so it survives the view
 * being rebuilt for an activated child or another tab, and every read and
 * write fails soft to the defaults when storage is blocked.
 */

export type BondStyle = "sticks" | "ball-and-stick" | "lines";
export type BondColor = "gray" | "by-atom";

export interface BondSettings {
  readonly style: BondStyle;
  readonly color: BondColor;
  readonly hidden: boolean;
}

export const BOND_STYLES: readonly { readonly value: BondStyle; readonly label: string }[] = [
  { value: "sticks", label: "sticks" },
  { value: "ball-and-stick", label: "ball-and-stick" },
  { value: "lines", label: "thin lines" },
];

export const BOND_COLORS: readonly { readonly value: BondColor; readonly label: string }[] = [
  { value: "gray", label: "gray" },
  { value: "by-atom", label: "by atom" },
];

/** Sticks as the view has always drawn them. */
export const DEFAULT_BOND_SETTINGS: BondSettings = { style: "sticks", color: "gray", hidden: false };

/** World-space cylinder radius (Å) per cylinder style; thin lines are 1 px. */
export const BOND_RADIUS: Readonly<Record<Exclude<BondStyle, "lines">, number>> = {
  sticks: 0.09,
  "ball-and-stick": 0.14,
};

export const BOND_SETTINGS_KEY = "materia.structureView.bonds";

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

/** Settings from a stored string; anything missing or unknown keeps its default. */
export function parseBondSettings(raw: string | null): BondSettings {
  if (!raw) return DEFAULT_BOND_SETTINGS;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_BOND_SETTINGS;
  }
  if (!v || typeof v !== "object") return DEFAULT_BOND_SETTINGS;
  const o = v as Record<string, unknown>;
  return {
    style: BOND_STYLES.some((s) => s.value === o.style) ? (o.style as BondStyle) : DEFAULT_BOND_SETTINGS.style,
    color: BOND_COLORS.some((c) => c.value === o.color) ? (o.color as BondColor) : DEFAULT_BOND_SETTINGS.color,
    hidden: typeof o.hidden === "boolean" ? o.hidden : DEFAULT_BOND_SETTINGS.hidden,
  };
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // access itself throws when site data is blocked
  }
}

export function loadBondSettings(store: ReadStore | null = sessionStore()): BondSettings {
  try {
    return parseBondSettings(store?.getItem(BOND_SETTINGS_KEY) ?? null);
  } catch {
    return DEFAULT_BOND_SETTINGS;
  }
}

export function saveBondSettings(settings: BondSettings, store: WriteStore | null = sessionStore()): void {
  try {
    store?.setItem(BOND_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* blocked or full: the choice still holds for this view */
  }
}

/**
 * Clickable choices in the Agent's conversation. Where a read tool hands the
 * user a decision the method leaves to them — the propagation vectors the
 * k-search found, the magnetic groups the ranking fitted, the next steps the
 * assessment suggests — the drawer shows its options as buttons under the
 * turn. The options come from the tool's structured result, never from the
 * model's prose, and a click sends the user's message an option stands for:
 * the same words the user could have typed, through the same send. The model
 * then acts on it as on a typed message (a change still asks first).
 *
 * A set is made for the page as it stood when its tool ran (`stamp`, the
 * page adapter's): once the page or the conversation moves on, its buttons
 * no longer send (useAgent.ts checks the stamp again on a click).
 *
 * Plain functions and types, no tool or engine imports: the drawer reads them.
 */

/** What a set of choices is about. */
export type ChoiceKind = "k" | "group" | "step";

export interface ChoiceOption {
  /** Stable within its set (the k's components, a group's id, a step's rank). */
  readonly id: string;
  /** The button's text. */
  readonly label: string;
  /** One line under or beside the label: what the tool measured for it. */
  readonly detail?: string;
  /** The user's message a click sends, as they could have typed it. */
  readonly message: string;
  /** The tool's own pick (the simplest k that explains every peak, the ranking's ★). */
  readonly recommended?: boolean;
}

export interface ChoiceSet {
  readonly kind: ChoiceKind;
  /** The tool whose result the options are (search_propagation_vector, …). */
  readonly tool: string;
  /** The question, in a few words. */
  readonly title: string;
  /** What the values mean (k's units and cell), when the label alone could be read two ways. */
  readonly note?: string;
  readonly options: readonly ChoiceOption[];
  /** The way to answer otherwise: a template put in the message box to edit, never sent by itself. */
  readonly other: { readonly label: string; readonly template: string };
  /** The page's stamp when the tool ran: the options hold for that page only. */
  readonly stamp: string | null;
}

/** What a choice set is read against: the cell its k are in (the powder page's structure as loaded). */
export interface ChoiceContext {
  readonly cell?: { readonly a: number; readonly b: number; readonly c: number; readonly alpha: number; readonly beta: number; readonly gamma: number };
  /** The space group's symbol as loaded (its first letter is the lattice's centring). */
  readonly spaceGroup?: string;
}

/** The most options a set shows: the tool's best first. */
export const MAX_OPTIONS = 6;

// ── k: exact text ───────────────────────────────────────────────────────────

const DENOMINATORS = [1, 2, 3, 4, 6, 8, 12] as const;

/**
 * x as n/d with the smallest d ≤ 12 that gives it to 1e-12 (1 + 1/3 and 4/3
 * may differ in the last bit); null when none does. The engine compares k to
 * 1e-9, so the fraction sets the same k.
 */
function fractionOf(x: number): { n: number; d: number } | null {
  for (const d of DENOMINATORS) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-12) return { n, d };
  }
  return null;
}

/**
 * One k component as the message writes it, plain ASCII that set_propagation_vector
 * reads back to the same double: "0", "1/2", "-1/4", "4/3"; a value no small
 * fraction gives exactly in its shortest round-trip decimal ("0.1234").
 */
export function kComponentText(x: number): string {
  if (Object.is(x, -0) || x === 0) return "0";
  const f = fractionOf(x);
  if (!f) return String(x);
  return f.d === 1 ? String(f.n) : `${f.n}/${f.d}`;
}

const GLYPH: Readonly<Record<string, string>> = { "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/6": "⅙", "5/6": "⅚" };

/** One k component as a label shows it: the panel's glyphs where they are exact (½, −¼), else the exact text (4/3). */
export function kComponentLabel(x: number): string {
  const text = kComponentText(x);
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  return `${negative ? "−" : ""}${GLYPH[body] ?? body}`;
}

/** k as a button shows it, the panel's way: "(½ 0 −¼)". No component is rounded. */
export const kDisplay = (k: readonly number[]): string => `(${k.map(kComponentLabel).join(" ")})`;

/** k as the message writes it: "(1/2, 0, -1/4)". */
export const kTuple = (k: readonly number[]): string => `(${k.map(kComponentText).join(", ")})`;

/** The message a k option sends: what the user would type to set it. */
export const kMessage = (k: readonly number[]): string => `Set the propagation vector to k = ${kTuple(k)}.`;

/** The three components a k message names, as text (the inverse of kTuple); null when it names none. */
export function kComponentsIn(message: string): [string, string, string] | null {
  const m = /k\s*=\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/.exec(message);
  return m ? [m[1]!, m[2]!, m[3]!] : null;
}

/** What k's numbers are in: reciprocal-lattice units of the cell as loaded, and, in a centred lattice, not the primitive cell. */
export function kNote(ctx: ChoiceContext): string {
  const cell = ctx.cell;
  const f = (x: number): string => String(Number(x.toFixed(4)));
  const lengths = cell ? ` (a ${f(cell.a)}, b ${f(cell.b)}, c ${f(cell.c)} Å${[cell.alpha, cell.beta, cell.gamma].some((g) => Math.abs(g - 90) > 1e-6) ? `; α ${f(cell.alpha)}°, β ${f(cell.beta)}°, γ ${f(cell.gamma)}°` : ""})` : "";
  const sg = ctx.spaceGroup?.trim();
  const centred = !!sg && /^[ABCFIR]/i.test(sg);
  return `k in reciprocal-lattice units of the structure's cell as loaded${sg ? `, ${sg}` : ""}${lengths}${centred ? ": the conventional, centred cell, not the primitive one" : ""}.`;
}

// ── the sets, from a tool's result ──────────────────────────────────────────

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => typeof r === "object" && r !== null) : []);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** search_propagation_vector's candidates: the k that explain every included peak first, the simplest marked. */
function kChoices(out: Row, ctx: ChoiceContext): Omit<ChoiceSet, "stamp"> | null {
  const found = rows(out.candidates).filter((c) => isVec3(c.components));
  if (found.length === 0) return null;
  const complete = (c: Row): boolean => {
    const m = /^(\d+)\/(\d+)$/.exec(String(c.matched ?? ""));
    return !!m && m[1] === m[2];
  };
  // Every included peak explained comes first (the search ranks by score; keep its order within each).
  const ordered = [...found.filter(complete), ...found.filter((c) => !complete(c))].slice(0, MAX_OPTIONS);
  const simplest = typeof out.simplest === "string" ? out.simplest : null;
  return {
    kind: "k",
    tool: "search_propagation_vector",
    title: "Propagation vector k",
    note: kNote(ctx),
    options: ordered.map((c) => {
      const k = c.components as [number, number, number];
      const rmsd = typeof c.rmsd === "number" ? ` · rmsd ${c.rmsd} Å` : "";
      return {
        id: kTuple(k),
        label: `k = ${kDisplay(k)}`,
        detail: `${String(c.matched)} peaks${rmsd}`,
        message: kMessage(k),
        ...(simplest !== null && c.k === simplest ? { recommended: true } : {}),
      };
    }),
    other: { label: "Another k…", template: "Set the propagation vector to k = (, , )." },
  };
}

/** rank_magnetic_groups's fitted groups, best wR first, the ★ marked. */
function groupChoices(out: Row): Omit<ChoiceSet, "stamp"> | null {
  const groups = rows(out.groups).filter((g) => typeof g.id === "string" && typeof g.group === "string");
  if (groups.length === 0) return null;
  const best = typeof out.best === "string" ? out.best : null;
  const within = new Set(Array.isArray(out.withinNoise) ? out.withinNoise.map(String) : []);
  const top = groups.slice(0, MAX_OPTIONS);
  const bestRow = best ? groups.find((g) => g.id === best) : undefined;
  if (bestRow && !top.includes(bestRow)) top.splice(top.length - 1, 1, bestRow);
  return {
    kind: "group",
    tool: "rank_magnetic_groups",
    title: "Magnetic space group",
    options: top.map((g) => {
      const fit = typeof g.fit === "object" && g.fit !== null ? (g.fit as Row) : null;
      const wR = fit && typeof fit.wR === "number" ? `wR ${fit.wR} %` : null;
      const detail = [wR, typeof g.index === "number" ? `index ${g.index}` : null, typeof g.momentComponents === "number" ? `${g.momentComponents} moment parameter${g.momentComponents === 1 ? "" : "s"}` : null, within.has(String(g.id)) && g.id !== best ? "within the noise of the best" : null].filter(Boolean).join(" · ");
      return {
        id: String(g.id),
        label: `${String(g.id)} · ${String(g.group)}`,
        ...(detail ? { detail } : {}),
        message: `Choose the magnetic group ${String(g.id)} (${String(g.group)}).`,
        ...(g.id === best ? { recommended: true } : {}),
      };
    }),
    other: { label: "Another group…", template: "Choose the magnetic group " },
  };
}

/** suggest_next_steps's actions, in their rank. */
function stepChoices(out: Row): Omit<ChoiceSet, "stamp"> | null {
  const steps = rows(out.steps).filter((s) => typeof s.action === "string" && s.action.trim() !== "");
  if (steps.length === 0) return null;
  return {
    kind: "step",
    tool: "suggest_next_steps",
    title: "Next step",
    options: steps.slice(0, MAX_OPTIONS).map((s, i) => ({
      id: String(i + 1),
      label: String(s.action).trim(),
      ...(typeof s.rationale === "string" && s.rationale ? { detail: s.rationale } : {}),
      message: `Go ahead with this next: ${String(s.action).trim()}`,
      ...(i === 0 ? { recommended: true } : {}),
    })),
    other: { label: "Something else…", template: "" },
  };
}

/** The choices a read tool's result offers the user, or null (most tools offer none). */
export function choicesFor(tool: string, out: unknown, ctx: ChoiceContext = {}): Omit<ChoiceSet, "stamp"> | null {
  if (typeof out !== "object" || out === null) return null;
  const o = out as Row;
  switch (tool) {
    case "search_propagation_vector":
      return kChoices(o, ctx);
    case "rank_magnetic_groups":
      return groupChoices(o);
    case "suggest_next_steps":
      return stepChoices(o);
    default:
      return null;
  }
}

/**
 * Minimal constraint system (Phase 8): fixed/free and bounds are handled by the
 * engine; this module adds direct parameter *tying* and *grouping*.
 *
 * Deliberately not a symbolic language. A tie expression is one of:
 *   "= id"                    → value equals parameter `id`
 *   "= factor*id"             → value equals factor × parameter `id`
 *   "= factor*id + c"         → value equals factor × parameter `id` plus constant c
 *   "= [±|factor*]hypot(a,b,…)" → value equals ±(factor ×) √(a² + b² + …) — the
 *                               magnitude tie: a moment amplitude equal to the
 *                               size of another sublattice's moment, whose
 *                               amplitudes a, b, … lie along orthonormal modes
 * Anything else throws, so silent misparses cannot happen.
 */

import type { RefinementParameter } from "@/core/refinement/types";

export type ParsedTie =
  | { readonly kind: "linear"; readonly factor: number; readonly refId: string; readonly constant: number }
  | { readonly kind: "norm"; readonly factor: number; readonly refIds: readonly string[] };

const ID = "[A-Za-z_][\\w:-]*";

export function parseTie(expression: string): ParsedTie {
  const s = expression.replace(/\s+/g, "");
  if (!s.startsWith("=")) {
    throw new Error(`Tie expression must start with "=": "${expression}"`);
  }
  const body = s.slice(1);
  // Magnitude tie: [±|factor*]hypot(id, id, …)
  const h = body.match(new RegExp(`^(?:([+-]?\\d*\\.?\\d+)\\*|([+-]))?hypot\\((${ID}(?:,${ID})*)\\)$`));
  if (h) {
    const factor = h[1] !== undefined ? parseFloat(h[1]) : h[2] === "-" ? -1 : 1;
    return { kind: "norm", factor, refIds: h[3]!.split(",") };
  }
  // Linear tie: [factor*]id[+const] or [factor*]id[-const]
  const m = body.match(/^(?:([+-]?\d*\.?\d+)\*)?([A-Za-z_][\w:-]*)(?:([+-]\d*\.?\d+))?$/);
  if (!m) {
    throw new Error(`Unsupported tie expression: "${expression}"`);
  }
  const factor = m[1] !== undefined ? parseFloat(m[1]) : 1;
  const refId = m[2]!;
  const constant = m[3] !== undefined ? parseFloat(m[3]) : 0;
  return { kind: "linear", factor, refId, constant };
}

/**
 * The group tag of a tie the user (or the Agent) made — two ADPs or two
 * occupancies constrained to one refined value. The spec regenerates its own
 * ties (shared sites, symmetry) on every rebuild; this tag marks the ones to
 * carry over, which the spec knows nothing of.
 */
export const USER_TIE_GROUP = "user-tie";

/** Whether a row follows a tie the user made ("= leader", tagged USER_TIE_GROUP). */
export function isUserTie(p: RefinementParameter): boolean {
  return p.group === USER_TIE_GROUP && !!p.expression;
}

/** The parameter ids a tie expression reads. */
export function tieReferences(expression: string): string[] {
  const tie = parseTie(expression);
  return tie.kind === "linear" ? [tie.refId] : [...tie.refIds];
}

/** A tie expression reading the same rows under new ids (its factor and constant kept); unchanged when none is renamed. */
export function renamedTie(expression: string, rename: (id: string) => string): string {
  const tie = parseTie(expression);
  if ((tie.kind === "linear" ? [tie.refId] : tie.refIds).every((id) => rename(id) === id)) return expression;
  if (tie.kind === "norm") {
    const sign = tie.factor === 1 ? "" : tie.factor === -1 ? "-" : `${tie.factor}*`;
    return `= ${sign}hypot(${tie.refIds.map(rename).join(", ")})`;
  }
  const factor = tie.factor === 1 ? "" : `${tie.factor}*`;
  const constant = tie.constant === 0 ? "" : `${tie.constant > 0 ? "+" : ""}${tie.constant}`;
  return `= ${factor}${rename(tie.refId)}${constant}`;
}

/**
 * Resolve tie expressions: return an id→value record where every tied parameter
 * takes its computed value. Ties may reference other (untied) parameters; a
 * single resolution pass is applied (chained ties are not followed).
 */
export function resolveTies(
  params: readonly RefinementParameter[],
  values: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = { ...values };
  for (const p of params) {
    if (!p.expression) continue;
    const tie = parseTie(p.expression);
    if (tie.kind === "norm") {
      let sum = 0;
      for (const id of tie.refIds) {
        const v = out[id];
        if (v === undefined) throw new Error(`Tie for "${p.id}" references unknown parameter "${id}"`);
        sum += v * v;
      }
      out[p.id] = tie.factor * Math.sqrt(sum);
      continue;
    }
    const ref = out[tie.refId];
    if (ref === undefined) {
      throw new Error(`Tie for "${p.id}" references unknown parameter "${tie.refId}"`);
    }
    out[p.id] = tie.factor * ref + tie.constant;
  }
  return out;
}


/**
 * Grouped (equal-value) refinement (Phase 8): within each named group the first
 * member is the free "leader" and the rest are tied equal to it. Returns a new
 * parameter list with tie expressions applied, so only one value per group is
 * refined (e.g. equal occupancies or equal displacement parameters).
 */
export function applyEqualValueGroups(
  params: readonly RefinementParameter[],
): RefinementParameter[] {
  const leaders = new Map<string, string>();
  for (const p of params) {
    if (p.group && !leaders.has(p.group)) leaders.set(p.group, p.id);
  }
  return params.map((p) => {
    if (!p.group) return { ...p };
    const leader = leaders.get(p.group)!;
    if (p.id === leader) return { ...p };
    return { ...p, expression: `= ${leader}` };
  });
}

/** A change of the user's ties (ids already expanded from globs). */
export interface EqualTieUpdate {
  /** The leader first; the others take its value and follow it. */
  readonly equal?: readonly string[];
  /** More such ties at once, each the leader first: an ADP's modes held equal to another site's (SHELXL's EADP). */
  readonly groups?: readonly (readonly string[])[];
  /** Two occupancies, the alternatives of one disorder: the second is one minus the first (SHELXL's 21 and −21). */
  readonly complement?: readonly [string, string];
  /** Rows whose user tie to release. */
  readonly release?: readonly string[];
}

/** A History step's label for a tie update: each tie it makes, in a few words. */
export function tieStepLabel(update: EqualTieUpdate): string {
  const parts = [
    ...(update.complement ? [`${update.complement[1]} = 1 − ${update.complement[0]}`] : []),
    ...(update.groups?.length ? [`EADP (${update.groups.length} ADP row${update.groups.length === 1 ? "" : "s"} tied)`] : []),
    ...(update.equal?.length ? [`${update.equal.slice(1).join(", ")} = ${update.equal[0]}`] : []),
    ...(update.release?.length ? [`Released ${update.release.join(", ")}`] : []),
  ];
  return parts.length ? parts.join("; ") : "Parameters tied";
}

/** The kinds a user may tie to one value: an ADP's B or U modes, an occupancy. */
const TIEABLE_KINDS: ReadonlySet<RefinementParameter["kind"]> = new Set<RefinementParameter["kind"]>(["bIso", "uAniso", "occupancy"]);

/** The tie of the second of two occupancies to one minus the first. */
export const complementOf = (leader: string): string => `= -1*${leader}+1`;

const equalGroups = (update: EqualTieUpdate): (readonly string[])[] => [...(update.equal ? [update.equal] : []), ...(update.groups ?? [])];

/**
 * Check a tie change against the rows: throws on one that cannot be made
 * (fewer than two rows, mixed kinds, a kind that is not tied this way, a
 * leader that is itself tied, a row the model already ties, a release of a
 * row no user tie holds). Returns whether it would change nothing.
 */
export function checkEqualTies(params: readonly RefinementParameter[], update: EqualTieUpdate): { readonly unchanged: boolean } {
  const byId = new Map(params.map((p) => [p.id, p]));
  const row = (id: string): RefinementParameter => {
    const p = byId.get(id);
    if (!p) throw new Error(`no parameter ${id}`);
    return p;
  };
  let unchanged = true;
  for (const ids of equalGroups(update)) {
    if (ids.length < 2) throw new Error("a tie needs at least two parameters: the leader first, then the ones that follow it");
    if (new Set(ids).size !== ids.length) throw new Error("a parameter is named twice");
    const rows = ids.map(row);
    const leader = rows[0]!;
    const kinds = new Set(rows.map((p) => p.kind));
    if (kinds.size > 1) throw new Error(`a tie joins parameters of one kind; these are ${[...kinds].join(" and ")}`);
    if (!TIEABLE_KINDS.has(leader.kind)) throw new Error(`${leader.kind} parameters are not tied this way: tie ADPs (B or U) or occupancies`);
    if (leader.expression) throw new Error(`${leader.id} is itself tied (${leader.expression}): lead with a parameter that refines`);
    for (const f of rows.slice(1)) {
      if (f.expression && !isUserTie(f)) throw new Error(`${f.id} is already tied by the model (${f.expression})`);
      if (!(isUserTie(f) && f.expression === `= ${leader.id}`)) unchanged = false;
    }
  }
  if (update.complement) {
    const [a, b] = update.complement;
    if (a === b) throw new Error("a complement ties two different occupancies");
    const [leader, follower] = [row(a), row(b)];
    if (leader.kind !== "occupancy" || follower.kind !== "occupancy") throw new Error(`a complement ties two occupancies (occ_ rows); ${leader.kind !== "occupancy" ? leader.id : follower.id} is not one`);
    if (leader.expression) throw new Error(`${leader.id} is itself tied (${leader.expression}): lead with an occupancy that refines`);
    if (follower.expression && !isUserTie(follower)) throw new Error(`${follower.id} is already tied by the model (${follower.expression})`);
    if (follower.expression !== complementOf(leader.id)) unchanged = false;
  }
  if (update.release) {
    if (update.release.length === 0) throw new Error("name the tied parameters to release");
    for (const id of update.release) {
      if (!isUserTie(row(id))) throw new Error(`${id} is not held by a tie made with tie_parameters`);
    }
    unchanged = false;
  }
  if (equalGroups(update).length === 0 && !update.complement && !update.release) throw new Error("pass `equal`, `release`, or both");
  return { unchanged };
}

/**
 * The rows with the tie change applied. `equal`'s first id leads (and each
 * group's): the others take its value and follow it ("= leader", fixed,
 * tagged USER_TIE_GROUP), and a row that followed one of them now follows the
 * leader with its own factor and constant (ties are not chained). A complement's second occupancy becomes one
 * minus the first. A released row keeps its value, fixed. Check with
 * checkEqualTies first.
 */
export function withEqualTies(params: readonly RefinementParameter[], update: EqualTieUpdate): RefinementParameter[] {
  let out: RefinementParameter[] = [...params];
  for (const ids of equalGroups(update)) {
    const leader = out.find((p) => p.id === ids[0]);
    if (!leader) continue;
    const followers = new Set(ids.slice(1));
    const follow = (p: RefinementParameter): RefinementParameter => ({ ...p, value: leader.value, fixed: true, expression: `= ${leader.id}`, group: USER_TIE_GROUP });
    // A row that followed a new follower now reads the leader, keeping its own
    // factor and constant: a complement 1 − A2 becomes 1 − A1, not = A1.
    const repoint = (p: RefinementParameter): RefinementParameter => {
      const tie = parseTie(p.expression!);
      if (tie.kind !== "linear") return p;
      const expression = tie.factor === 1 && tie.constant === 0 ? `= ${leader.id}`
        : tie.factor === -1 && tie.constant === 1 ? complementOf(leader.id)
        : `= ${tie.factor}*${leader.id}${tie.constant === 0 ? "" : `${tie.constant > 0 ? "+" : ""}${tie.constant}`}`;
      return { ...p, value: tie.factor * leader.value + tie.constant, fixed: true, expression, group: USER_TIE_GROUP };
    };
    out = out.map((p) => {
      if (followers.has(p.id)) return follow(p);
      if (isUserTie(p) && followers.has(tieReferences(p.expression!)[0] ?? "")) return repoint(p);
      return p;
    });
  }
  if (update.complement) {
    const [a, b] = update.complement;
    const leader = out.find((p) => p.id === a);
    if (leader) out = out.map((p) => (p.id === b ? { ...p, value: 1 - leader.value, fixed: true, expression: complementOf(leader.id), group: USER_TIE_GROUP } : p));
  }
  const released = new Set(update.release ?? []);
  return out.map((p) => {
    if (released.has(p.id) && isUserTie(p)) {
      const { expression: _e, group: _g, ...rest } = p;
      return { ...rest, fixed: true };
    }
    return p;
  });
}

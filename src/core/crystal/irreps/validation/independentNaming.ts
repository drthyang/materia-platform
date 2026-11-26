/**
 * An independent check of the subgroup engine's names (THY-80 A3; test code
 * only, never imported by the app): every class `supercellSubgroups` lists is
 * identified again by moyo (spglib's successor, Rust compiled to WebAssembly:
 * the dev dependency @spglib/moyo-wasm), which shares no code or table with
 * MATERIA's namer.
 *
 * For each class representative H (factor-group elements of G/T″):
 *  1. A structure with exactly H's symmetry: two orbits of generic points
 *     (two species) under H, in the supercell T′ the bound was built from
 *     (H holds T′, so the structure is T′-periodic), on a Cartesian cell of
 *     the parent's metric. Its symmetry is H: a generic point has a trivial
 *     stabiliser and a second species at another generic point leaves no
 *     extra operation. moyo identifies it: number, Hall number, H-M symbol,
 *     and its own transformation to the standard setting.
 *  2. The engine's setting: H's operations carried by the engine's (P_H, p_H)
 *     into the child's basis, x_parent = P_H·x_child + p_H, i.e.
 *     W′ = P⁻¹WP, w′ = P⁻¹(w + Wp − p), modulo ℤ³, must be exactly moyo's
 *     operation list of the engine's number in the ITA standard setting
 *     (moyo "Standard": origin choice 2, hexagonal axes, unique axis b), the
 *     columns of P_H must be translations of H, and det P_H > 0 (a left-handed
 *     basis would turn P4₁ into P4₃).
 *  3. For a class with an `enantiomorph`, the mirror image of the structure
 *     (x → −x) must be moyo's partner type, the number the engine names.
 *
 * Every comparison is between moyo's answers and the engine's output; no
 * MATERIA table or namer is used on the oracle side.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { analyze_cell, hall_symbol_entry, initSync, operations_from_number, type MoyoDataset, type MoyoOperation } from "@spglib/moyo-wasm";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { SPACE_GROUP_DATA } from "@/core/crystal/spaceGroupData";
import { factorGroup, type FactorGroup } from "@/core/crystal/irreps/factorGroup";
import { supercellSubgroups, SubgroupSearchTooLarge, type SubgroupClass } from "@/core/crystal/irreps/supercellLattice";
import { rnum } from "@/core/crystal/irreps/rational";
import type { SupercellMatrix } from "@/core/crystal/irreps/supercell";

let ready = false;
/** Load moyo's WebAssembly once (synchronously, from node_modules). */
export function initMoyo(): void {
  if (ready) return;
  const require = createRequire(import.meta.url);
  initSync({ module: readFileSync(require.resolve("@spglib/moyo-wasm/moyo_wasm_bg.wasm")) });
  ready = true;
}

/** The moyo-wasm version in node_modules. */
export function moyoVersion(): string {
  const require = createRequire(import.meta.url);
  return (JSON.parse(readFileSync(require.resolve("@spglib/moyo-wasm/package.json"), "utf8")) as { version: string }).version;
}

type M3 = number[][];
type V3 = number[];
const mul = (A: M3, B: M3): M3 => A.map((r) => [0, 1, 2].map((j) => r[0]! * B[0]![j]! + r[1]! * B[1]![j]! + r[2]! * B[2]![j]!));
const app = (A: M3, v: V3): V3 => A.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const det = (m: M3): number =>
  m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
function inv(m: M3): M3 {
  const d = det(m);
  const c = (i: number, j: number): number => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const k = [0, 1, 2].filter((x) => x !== j);
    return m[r[0]!]![k[0]!]! * m[r[1]!]![k[1]!]! - m[r[0]!]![k[1]!]! * m[r[1]!]![k[0]!]!;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 === 0 ? 1 : -1) * c(j, i)) / d));
}
const mod1 = (x: number): number => {
  const f = x - Math.floor(x);
  return Math.abs(f - 1) < 1e-7 || Math.abs(f) < 1e-7 ? 0 : f;
};
/** An operation modulo ℤ³ as a key, translations on a 1e-5 grid. */
const opKey = (W: M3, w: V3): string => `${W.flat().map((x) => Math.round(x)).join(",")}|${w.map((x) => Math.round(mod1(x) * 1e5) % 1e5).join(",")}`;
const moyoW = (o: MoyoOperation): M3 => colMajor(o.rotation);
/** moyo's flat fields are column-major: element (i, j) at i + 3j. */
const colMajor = (a: readonly number[]): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i + 3 * j]!));

/** A seeded uniform generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A 32-bit seed from a string (FNV-1a). */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Cartesian axes (as columns) from cell parameters, degrees. */
export function cartesianCell(a: number, b: number, c: number, alpha = 90, beta = 90, gamma = 90): M3 {
  const r = Math.PI / 180;
  const [ca, cb, cg, sg] = [Math.cos(alpha * r), Math.cos(beta * r), Math.cos(gamma * r), Math.sin(gamma * r)];
  const cx = c * cb;
  const cy = (c * (ca - cb * cg)) / sg;
  const cz = Math.sqrt(c * c - cx * cx - cy * cy);
  return [[a, b * cg, cx], [0, b * sg, cy], [0, 0, cz]];
}

/** moyo's (P, p) of the ITA standard setting of a number: its operation keys, modulo ℤ³. */
const standardCache = new Map<number, Set<string>>();
function standardOps(n: number): Set<string> {
  let s = standardCache.get(n);
  if (!s) {
    s = new Set(operations_from_number(n, { type: "Standard" }, false).map((o) => opKey(moyoW(o), [...o.translation])));
    standardCache.set(n, s);
  }
  return s;
}
/** moyo's operations of a number in the ITA standard setting (conventional cell, centrings included). */
export function moyoStandardOperations(n: number): { W: M3; w: V3 }[] {
  return operations_from_number(n, { type: "Standard" }, false).map((o) => ({ W: moyoW(o), w: [...o.translation] }));
}
export const operationKey = opKey;

const squash = (s: string): string => s.replace(/[\s_]/g, "");
/**
 * The five space groups whose ITA symbol changed to the e-glide in 2002
 * (ITA A, 5th ed., §1.3): MATERIA's table (gemmi) keeps the older symbol,
 * moyo the newer. The same group either way; compared as equal and counted.
 */
export const E_GLIDE_SYMBOLS: Readonly<Record<string, string>> = { Abm2: "Aem2", Aba2: "Aea2", Cmca: "Cmce", Cmma: "Cmme", Ccca: "Ccce" };
/** moyo's short and full H-M symbols of a Hall number, spaces and underscores dropped ("P21/c", "P121/c1"). */
export const moyoHms = (hall: number): string[] => {
  const e = hall_symbol_entry(hall);
  return [squash(e.hm_short), squash(e.hm_full)];
};
/** MATERIA's extended symbol, comparable with moyoHms: setting suffix, spaces and underscores dropped. */
export const engineHm = (hm: string): string => squash(hm.replace(/:.*$/, ""));
/** A Hall symbol in one notation: spglib/moyo write the double-prime axis as "=", gemmi as '"'. */
export const hallKey = (h: string): string => h.replace(/=/g, '"').replace(/\s+/g, " ").trim();
/** The Hall symbol of the reference setting MATERIA names a number in (its table, from gemmi). */
export const engineHall = (n: number): string | undefined => SPACE_GROUP_DATA.find((e) => e.number === n && e.reference)?.hall;

/** "same", "e-glide" (the same group under its older symbol) or "different". */
export function compareHm(engine: string, hall: number): "same" | "e-glide" | "different" {
  const mine = engineHm(engine);
  const theirs = moyoHms(hall);
  if (theirs.includes(mine)) return "same";
  const renamed = E_GLIDE_SYMBOLS[mine];
  return renamed !== undefined && theirs.includes(renamed) ? "e-glide" : "different";
}

export interface ClassCheck {
  readonly id: number;
  readonly order: number;
  readonly kind: string;
  readonly method: string;
  readonly engineNumber: number | null;
  readonly engineHm: string | null;
  readonly engineP: M3 | null;
  readonly enginep: V3 | null;
  readonly moyoNumber: number;
  readonly moyoHall: number;
  readonly moyoHm: string;
  readonly moyoHallSymbol: string;
  /** The engine's symbol is the pre-2002 one of an e-glide group (Cmca for Cmce): the same group. */
  readonly eGlideSymbol: boolean;
  /** moyo's own (P, p) to its standard setting, in the parent's basis. */
  readonly moyoP: M3;
  readonly moyop: V3;
  readonly atoms: number;
  /** The engine's enantiomorph partner, checked on the mirror image (absent for a non-chiral class). */
  readonly enantiomorph?: number;
  readonly seed: number;
  /** Empty when everything agrees; else one line per disagreement. */
  readonly problems: readonly string[];
}

export interface BoundCheck {
  readonly parent: number;
  readonly bound: string;
  readonly classes: readonly ClassCheck[];
  /** Set when the engine refused the bound (SubgroupSearchTooLarge) or the run stopped early. */
  readonly note?: string;
  /** Classes the engine listed. */
  readonly listed: number;
  readonly engineMs: number;
  readonly checkMs: number;
}

/**
 * Identify one class with moyo and compare (see the module comment). `parentCart`
 * holds the parent's Cartesian axes as columns; `P` is the bound's supercell
 * (columns in the parent's basis), which H keeps.
 */
export function checkClass(group: FactorGroup, cls: SubgroupClass, P: SupercellMatrix, parentCart: M3, label: string, symprec = 1e-4): ClassCheck {
  initMoyo();
  const C = P.map((r) => [...r]);
  const Cinv = inv(C);
  const A = mul(parentCart, C); // the supercell's Cartesian axes as columns
  const seed = seedOf(`${label}#${cls.id}`);
  const random = rng(seed);
  const ops = cls.elements.map((i) => {
    const e = group.elements[i]!;
    return { W: e.W.map((r) => [...r]), w: e.w.map(rnum) };
  });
  const orbit = (x: V3): V3[] => {
    const seen = new Map<string, V3>();
    for (const { W, w } of ops) {
      const y = app(W, x).map((v, k) => v + w[k]!);
      const f = app(Cinv, y).map(mod1);
      const key = f.map((v) => Math.round(v * 1e6) % 1e6).join(",");
      if (!seen.has(key)) seen.set(key, f);
    }
    return [...seen.values()];
  };
  const generic = (): V3 => [0.05 + 0.9 * random(), 0.05 + 0.9 * random(), 0.05 + 0.9 * random()];
  const sites: { f: V3; z: number }[] = [];
  for (const [z, x] of [[1, generic()], [2, generic()]] as const) for (const f of orbit(x as V3)) sites.push({ f, z });
  const cell = (s: readonly { f: V3; z: number }[]) => JSON.stringify({ lattice: { basis: [0, 1, 2].flatMap((j) => [A[0]![j]!, A[1]![j]!, A[2]![j]!]) }, positions: s.map((x) => x.f), numbers: s.map((x) => x.z) });
  const d: MoyoDataset = analyze_cell(cell(sites), symprec, "Standard");
  const L = colMajor(d.std_linear);
  const moyoP = mul(C, L);
  const moyop = app(C, [...d.std_origin_shift]).map(mod1);

  const problems: string[] = [];
  // The structure has H's symmetry and no more: moyo lists the operations
  // that are integer matrices in the input (T′) basis, each modulo T′.
  const modT = new Set(
    ops
      .map(({ W, w }) => ({ W: mul(Cinv, mul(W, C)), w: app(Cinv, w) }))
      .filter(({ W }) => W.flat().every((x) => Math.abs(x - Math.round(x)) < 1e-6))
      .map(({ W, w }) => opKey(W, w)),
  );
  if (d.operations.length !== modT.size) problems.push(`structure: moyo finds ${d.operations.length} operations in the supercell, H has ${modT.size} (symprec ${symprec}; seed ${seed})`);
  const id = cls.identity;
  const engineNumber = id?.number ?? null;
  if (engineNumber === null) problems.push(`engine gives no space-group number (method ${id?.method ?? "none"}); moyo: #${d.number}`);
  else if (engineNumber !== d.number) problems.push(`number: engine #${engineNumber} ${id?.hermannMauguin ?? ""}, moyo #${d.number} ${d.hm_symbol}`);
  const hm = id?.hermannMauguin ? compareHm(id.hermannMauguin, d.hall_number) : null;
  if (hm === "different" && engineNumber === d.number) {
    problems.push(`H-M: engine "${id?.hermannMauguin ?? ""}", moyo "${hall_symbol_entry(d.hall_number).hm_full}" (Hall ${d.hall_number})`);
  }
  const hall = hall_symbol_entry(d.hall_number).hall_symbol;
  if (engineNumber === d.number) {
    const mine = engineHall(engineNumber);
    if (mine === undefined || hallKey(mine) !== hallKey(hall)) problems.push(`Hall: engine's standard setting "${mine ?? "?"}", moyo "${hall}" (Hall ${d.hall_number})`);
  }
  // The engine's (P_H, p_H).
  let engineP: M3 | null = null;
  let enginep: V3 | null = null;
  if (id?.method === "direct") {
    engineP = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    enginep = [0, 0, 0];
  } else if (id?.method === "conventional-cell" && id.basis) {
    engineP = id.basis.map((r) => [...r]);
    enginep = id.originShift ? [...id.originShift] : [0, 0, 0];
  } else if (id?.method === "origin-shifted") {
    engineP = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    enginep = id.originShift ? [...id.originShift] : [0, 0, 0];
    problems.push(`method "origin-shifted" (not a standard-setting name)`);
  } else if (id) {
    problems.push(`method "${id.method}": no child basis to check`);
  }
  if (engineP && enginep && engineNumber !== null) {
    if (det(engineP) <= 1e-9) problems.push(`det P_H = ${det(engineP).toFixed(4)} (not a right-handed basis)`);
    const Pi = inv(engineP);
    // The supercell's translations T′ (H holds them; the elements are listed
    // modulo T″ ⊆ T′) in the child's basis, modulo ℤ³: the child's centring
    // vectors that come from T′ (a same-cell child's R or C centring).
    const shifts = new Map<string, V3>([["0,0,0", [0, 0, 0]]]);
    const gens = [0, 1, 2].map((j) => app(Pi, [C[0]![j]!, C[1]![j]!, C[2]![j]!]));
    for (const queue = [[0, 0, 0] as V3]; queue.length > 0; ) {
      const t = queue.pop()!;
      for (const g of gens) {
        const u = t.map((v, k) => mod1(v + g[k]!));
        const key = u.map((v) => Math.round(v * 1e5) % 1e5).join(",");
        if (!shifts.has(key)) {
          shifts.set(key, u);
          queue.push(u);
        }
      }
    }
    const got = new Set<string>();
    for (const { W, w } of ops) {
      const W2 = mul(Pi, mul(W, engineP));
      const w2 = app(Pi, w.map((v, k) => v + app(W, enginep!)[k]! - enginep![k]!));
      if (W2.flat().some((x) => Math.abs(x - Math.round(x)) > 1e-6)) {
        problems.push(`P_H does not carry the rotations to integer matrices`);
        break;
      }
      for (const c of shifts.values()) got.add(opKey(W2, w2.map((v, k) => v + c[k]!)));
    }
    const want = standardOps(engineNumber);
    const missing = [...want].filter((k) => !got.has(k));
    const extra = [...got].filter((k) => !want.has(k));
    if (missing.length || extra.length) {
      problems.push(`setting: (P_H, p_H) gives ${got.size} operations mod Z³, moyo's standard #${engineNumber} has ${want.size}; ${missing.length} missing (e.g. ${missing[0] ?? "-"}), ${extra.length} extra (e.g. ${extra[0] ?? "-"})`);
    }
    // The columns of P_H are translations of H (its lattice holds the child's cell).
    const pure = ops.filter(({ W }) => W.every((r, i) => r.every((x, j) => x === (i === j ? 1 : 0)))).map(({ w }) => app(Cinv, w).map(mod1).map((v) => Math.round(v * 1e5) % 1e5).join(","));
    const pureSet = new Set(pure);
    for (let j = 0; j < 3; j++) {
      const col = [engineP[0]![j]!, engineP[1]![j]!, engineP[2]![j]!];
      const k = app(Cinv, col).map(mod1).map((v) => Math.round(v * 1e5) % 1e5).join(",");
      if (!pureSet.has(k)) problems.push(`P_H column ${j} (${col.map((x) => +x.toFixed(4)).join(", ")}) is not a translation of H`);
    }
  }
  // The enantiomorph: the mirror image is the partner type.
  if (cls.enantiomorph) {
    const mirrored = sites.map(({ f, z }) => ({ f: f.map((v) => mod1(-v)), z }));
    const dm = analyze_cell(cell(mirrored), symprec, "Standard");
    if (dm.number !== cls.enantiomorph.number) problems.push(`enantiomorph: engine #${cls.enantiomorph.number ?? "?"}, moyo (mirror image) #${dm.number}`);
  }
  return {
    id: cls.id,
    order: cls.order,
    kind: cls.kind,
    method: id?.method ?? "unnamed",
    engineNumber,
    engineHm: id?.hermannMauguin ?? null,
    engineP,
    enginep,
    moyoNumber: d.number,
    moyoHall: d.hall_number,
    moyoHm: hall_symbol_entry(d.hall_number).hm_full,
    moyoHallSymbol: hall,
    eGlideSymbol: hm === "e-glide",
    moyoP,
    moyop,
    atoms: sites.length,
    ...(cls.enantiomorph?.number !== undefined ? { enantiomorph: cls.enantiomorph.number } : {}),
    seed,
    problems,
  };
}

export interface ParentCase {
  readonly parent: number;
  /** The setting, when the number alone is ambiguous (origin choice, R axes). */
  readonly symbol?: string;
  /** The parent's Cartesian axes as columns. */
  readonly cart: M3;
}

/**
 * Every class of one (parent, bound): the engine's lattice, then each class
 * checked; stops between classes once `deadline` (Date.now() ms) passes and
 * says so in `note`.
 */
export function checkBound(pc: ParentCase, boundName: string, P: SupercellMatrix, deadline = Number.POSITIVE_INFINITY): BoundCheck {
  const t0 = Date.now();
  const group = factorGroup(buildSpaceGroup(pc.symbol ?? pc.parent).operations, P);
  let classes: readonly SubgroupClass[];
  try {
    classes = supercellSubgroups(group).classes;
  } catch (e) {
    if (e instanceof SubgroupSearchTooLarge) return { parent: pc.parent, bound: boundName, classes: [], note: `engine refused: ${e.message}`, listed: 0, engineMs: Date.now() - t0, checkMs: 0 };
    throw e;
  }
  const t1 = Date.now();
  const out: ClassCheck[] = [];
  let note: string | undefined;
  for (const cls of classes) {
    if (Date.now() > deadline) {
      note = `stopped at the time limit after ${out.length} of ${classes.length} classes`;
      break;
    }
    out.push(checkClass(group, cls, P, pc.cart, `${pc.parent}|${boundName}`));
  }
  return { parent: pc.parent, bound: boundName, classes: out, listed: classes.length, engineMs: t1 - t0, checkMs: Date.now() - t1, ...(note ? { note } : {}) };
}

/** One line per mismatch, for a report: where, what, and how to reproduce. */
export function findings(b: BoundCheck): string[] {
  return b.classes
    .filter((c) => c.problems.length > 0)
    .map((c) => {
      const fmt = (m: M3 | null): string => (m ? `[${m.map((r) => r.map((x) => +x.toFixed(4)).join(" ")).join("; ")}]` : "-");
      const fv = (v: V3 | null): string => (v ? `(${v.map((x) => +x.toFixed(4)).join(", ")})` : "-");
      return `#${b.parent} ${b.bound} class ${c.id} (order ${c.order}, ${c.kind}, ${c.method}): ${c.problems.join("; ")} | engine P_H ${fmt(c.engineP)} p_H ${fv(c.enginep)} | moyo #${c.moyoNumber} Hall ${c.moyoHall} P ${fmt(c.moyoP)} p ${fv(c.moyop)} | seed ${c.seed}`;
    });
}

/** The parents of THY-80 with cells of their metric (lengths in Å). */
export const PARENTS: Readonly<Record<string, ParentCase>> = {
  "Pm-3m": { parent: 221, cart: cartesianCell(4.0, 4.0, 4.0) },
  "Fm-3m": { parent: 225, cart: cartesianCell(5.6, 5.6, 5.6) },
  "F-43m": { parent: 216, cart: cartesianCell(5.4, 5.4, 5.4) },
  "Fd-3m": { parent: 227, symbol: "F d -3 m:2", cart: cartesianCell(8.1, 8.1, 8.1) },
  "Im-3m": { parent: 229, cart: cartesianCell(3.3, 3.3, 3.3) },
  "P6_3/mmc": { parent: 194, cart: cartesianCell(3.2, 3.2, 5.2, 90, 90, 120) },
  "R-3m": { parent: 166, symbol: "R -3 m:H", cart: cartesianCell(3.0, 3.0, 14.0, 90, 90, 120) },
  "I4/mmm": { parent: 139, cart: cartesianCell(3.9, 3.9, 12.7) },
  "P4/mmm": { parent: 123, cart: cartesianCell(3.9, 3.9, 4.4) },
  Pnma: { parent: 62, cart: cartesianCell(5.5, 7.6, 5.3) },
  Cmcm: { parent: 63, cart: cartesianCell(3.1, 10.3, 4.2) },
  "P2_1/c": { parent: 14, cart: cartesianCell(5.1, 6.2, 7.3, 90, 101, 90) },
};

export const BOUNDS: Readonly<Record<string, SupercellMatrix>> = {
  "1x1x1": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  "1x1x2": [[1, 0, 0], [0, 1, 0], [0, 0, 2]],
  "2x2x2": [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
  /** √3 × √3 × 1 on hexagonal axes: a′ = a − b, b′ = a + 2b (columns). */
  "r3xr3x1": [[1, 1, 0], [-1, 2, 0], [0, 0, 1]],
};

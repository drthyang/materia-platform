/**
 * The Subgroups page's detail panel: the selected subgroup (a merged row of
 * subgroupList.ts, one of its variants chosen) with its cell sketched against
 * the parent's, its domains and index, how you get there (one irrep switched
 * on per step; the literal lattice steps on demand), its irreps, the other
 * variants with their own Activate, the mode count, and one large Activate.
 * Result first, one plain line each; the rest behind "?" and folds.
 */

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { color, fz, mono, primaryButton, resetRangeBtn, uppercaseLabel } from "@/app/theme";
import { InfoBadge } from "@/app/ui/InfoBadge";
import type { PickerAction, SubgroupRow } from "@/app/ui/subgroupPicker";
import {
  collapseTies, collapseWays, compactName, irrepsLineOf, latticeChains, setLine, setsFor, shortName, tagOf,
  type GraphNode, type RowGroup,
} from "@/app/ui/subgroupList";

/** Why Activate cannot run now, or null when it can. */
export type ActivateBlock = "busy" | "active" | "strain" | "elsewhere" | null;

export interface DetailProps {
  readonly parent: string;
  readonly group: RowGroup;
  /** The variants the filters keep (the list's tag is the first). */
  readonly shown: readonly SubgroupRow[];
  /** The variant in the panel. */
  readonly row: SubgroupRow;
  readonly ks: readonly string[];
  /** The lattice as a graph, for "every lattice step"; null until it is there. */
  readonly graph: readonly GraphNode[] | null;
  /** A row's name and cell by its key (the lattice steps name their subgroups). */
  readonly nameOf: (key: string) => string;
  /** The row whose child is in force (its key), if any. */
  readonly activeKey: string | null;
  /** True while a choice is in force (any): Activate waits for ✕ clear. */
  readonly modesInForce: boolean;
  readonly busy: boolean;
  /** The row being activated (its key), while the work runs. */
  readonly activating: string | null;
  readonly canActivate: (a: PickerAction) => boolean;
  readonly onActivate: (row: SubgroupRow) => void;
  readonly onPickVariant: (row: SubgroupRow) => void;
  /** A phone's full-screen sheet: the Activate stays at the bottom. */
  readonly sheet?: boolean;
}

const fact: CSSProperties = { fontFamily: mono, fontSize: fz.body, color: color.ink };
const sub: CSSProperties = { fontSize: 11, color: color.faint, lineHeight: 1.4 };
const linkBtn: CSSProperties = { border: "none", background: "none", color: color.primary, fontSize: fz.micro, cursor: "pointer", padding: 0, fontFamily: "inherit" };

/** What blocks a row's Activate, in the order the button says it. */
export function activateBlock(row: SubgroupRow, o: { readonly busy: boolean; readonly modesInForce: boolean; readonly canActivate: boolean }): ActivateBlock {
  if (o.modesInForce) return "active";
  if (o.busy) return "busy";
  if (!o.canActivate || row.action.kind === "elsewhere") return "elsewhere";
  if (row.modes === 0) return "strain";
  return null;
}

/** "Index 24 = 6·4" of a row's "?", as [t, k]. */
const splitOf = (row: SubgroupRow): [number, number] | null => {
  const m = /Index \d+ = (\d+)·(\d+)/.exec(row.detail);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
/** The secondary irreps of a row's "?". */
const secondaryOf = (row: SubgroupRow): string[] => {
  const m = /Secondary \(allowed here, induced by coupling\): (.*)\.$/m.exec(row.detail);
  return m ? m[1]!.split(", ") : [];
};
/** The child's basis (P_H) of a larger row; null for a same-cell one. */
const basisOf = (row: SubgroupRow): readonly (readonly number[])[] | null => (row.action.kind === "supercell" ? row.action.choice.identity.basis ?? null : null);
const boxOf = (cell: string): number[] => (cell === "same cell" ? [1, 1, 1] : cell.split("×").map((x) => Number(x) || 1));

/** The parent's cell and the child's: the box of parent cells (grid), the parent's cell shaded, the child's own cell dashed when it fits the box. */
export function CellSketch({ cell, basis, size = 112 }: { cell: string; basis: readonly (readonly number[])[] | null; size?: number }): JSX.Element {
  const box = boxOf(cell);
  const P = basis ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const cols = [0, 1, 2].map((j) => [P[0]![j]!, P[1]![j]!, P[2]![j]!]);
  const corners: number[][] = [];
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) corners.push([0, 1, 2].map((r) => i * cols[0]![r]! + j * cols[1]![r]! + k * cols[2]![r]!));
  const lo = [0, 1, 2].map((r) => Math.min(...corners.map((c) => c[r]!)));
  const [bx, by, bz] = [box[0]!, box[1]!, box[2]!];
  const proj = (v: readonly number[]): [number, number] => [v[0]! + 0.55 * v[1]!, -(v[2]! + 0.38 * v[1]!)];
  const all = [[0, 0, 0], [bx, 0, 0], [0, by, 0], [0, 0, bz], [bx, by, bz], [bx, by, 0], [bx, 0, bz], [0, by, bz]].map(proj);
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const s = (size - 16) / Math.max(maxX - minX, maxY - minY);
  const xy = (v: readonly number[]): [number, number] => {
    const [x, y] = proj(v);
    return [8 + (x - minX) * s, 8 + (y - minY) * s];
  };
  const add = (...vs: (readonly number[])[]): number[] => [0, 1, 2].map((r) => vs.reduce((t, v) => t + v[r]!, 0));
  const edges = (o: readonly number[], a: readonly number[], b: readonly number[], c: readonly number[]): [number[], number[]][] => {
    const z = [0, 0, 0];
    const E: [number[], number[]][] = [];
    for (const [u, v, w] of [[a, b, c], [b, c, a], [c, a, b]] as const) for (const p of [z, v, w, add(v, w)]) E.push([add(o, p), add(o, p, u)]);
    return E;
  };
  const grid: [number[], number[]][] = [];
  for (let x = 0; x <= bx; x++) for (let y = 0; y <= by; y++) grid.push([[x, y, 0], [x, y, bz]]);
  for (let x = 0; x <= bx; x++) for (let z = 0; z <= bz; z++) grid.push([[x, 0, z], [x, by, z]]);
  for (let y = 0; y <= by; y++) for (let z = 0; z <= bz; z++) grid.push([[0, y, z], [bx, y, z]]);
  const span = [0, 1, 2].map((r) => Math.max(...corners.map((c) => c[r]!)) - lo[r]!);
  const fits = span[0]! <= bx + 1e-9 && span[1]! <= by + 1e-9 && span[2]! <= bz + 1e-9;
  const origin = lo.map((x) => -x);
  const child = fits && basis ? edges(origin, cols[0]!, cols[1]!, cols[2]!) : [];
  const det = Math.abs(cols[0]![0]! * (cols[1]![1]! * cols[2]![2]! - cols[1]![2]! * cols[2]![1]!) - cols[0]![1]! * (cols[1]![0]! * cols[2]![2]! - cols[1]![2]! * cols[2]![0]!) + cols[0]![2]! * (cols[1]![0]! * cols[2]![1]! - cols[1]![1]! * cols[2]![0]!));
  const sameBox = basis !== null && fits && Math.abs(det - bx * by * bz) < 1e-6 && cols.every((c) => c.filter((x) => x !== 0).length === 1);
  const h = Math.min(size, 16 + (maxY - minY) * s);
  const line = (key: string, [a, b]: [number[], number[]], style: { stroke: string; width: number; dash?: string; opacity?: number }): JSX.Element => {
    const [x1, y1] = xy(a);
    const [x2, y2] = xy(b);
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} opacity={style.opacity} strokeLinecap="round" />;
  };
  const face = (pts: number[][]): string => pts.map((p) => xy(p).join(",")).join(" ");
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img" aria-label={`the parent's cell and the child's, ${cell}`}>
        {grid.map((e, i) => line(`g${i}`, e, { stroke: color.subtle, width: 1 }))}
        <polygon points={face([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]])} fill={color.noteBg} />
        <polygon points={face([[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]])} fill={color.noteBg} />
        <polygon points={face([[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]])} fill={color.noteBorder} opacity={0.55} />
        {edges([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]).map((e, i) => line(`u${i}`, e, { stroke: color.bkg, width: 1.3 }))}
        {child.map((e, i) => line(`c${i}`, e, { stroke: color.primary, width: 1.2, dash: "3 2", opacity: 0.8 }))}
        {edges([0, 0, 0], [bx, 0, 0], [0, by, 0], [0, 0, bz]).map((e, i) => line(`b${i}`, e, { stroke: color.primary, width: 2 }))}
      </svg>
      <span style={{ ...sub, textAlign: "center" }}>
        <span style={{ color: color.bkg }}>■</span> parent <span style={{ color: color.primary }}>━</span> {cell === "same cell" ? "child = parent" : cell}
        {basis !== null && !sameBox ? (
          <>
            <br />
            {fits ? <><span style={{ color: color.primary }}>┄</span> its own cell (×{+det.toFixed(2)})</> : <>its own cell ×{+det.toFixed(2)}, not drawn</>}
          </>
        ) : null}
      </span>
    </span>
  );
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section style={{ borderTop: `1px solid ${color.subtle2}`, padding: "10px 0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={uppercaseLabel}>{title}</span>
        <span style={{ marginLeft: "auto" }}>{right}</span>
      </div>
      {children}
    </section>
  );
}

function Fold({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ ...linkBtn, color: color.secondary }}>
        {open ? "▾" : "▸"} {label}
      </button>
      {open ? <div style={{ paddingLeft: 14, marginTop: 4 }}>{children}</div> : null}
    </div>
  );
}

const plural = (n: number, w: string, ws = `${w}s`): string => `${n} ${n === 1 ? w : ws}`;

/** The result in one line: "Pnma in a 2×2×2 cell, from 2 irreps together: M irrep 3 or 5 and R irrep 8." */
export function resultLine(row: SubgroupRow, ks: readonly string[]): string {
  const where = row.sameCell ? "in the parent's cell" : `in a ${row.cell} cell`;
  const sets = collapseTies(setsFor(row, ks).length > 0 ? setsFor(row, ks) : row.reach.sets);
  const first = sets[0];
  const name = shortName(row.name);
  if (!first) return `${name} ${where}; no small set of irreps reaches it.`;
  if (row.reach.kind === "primary") return `${name} ${where}, from one irrep: ${setLine(first)}.`;
  return `${name} ${where}, from ${first.members.length} irreps together: ${first.members.map((alts) => irrepsLineOf(alts)).join(" and ")}.`;
}

export function SubgroupDetail(p: DetailProps): JSX.Element {
  const { row, group } = p;
  const [allWays, setAllWays] = useState(false);
  const [steps, setSteps] = useState(false);
  useEffect(() => {
    setAllWays(false);
    setSteps(false);
  }, [row.key]);
  const ways = useMemo(() => {
    const tied = collapseWays(row.ways.ways);
    // The ways whose irreps all move atoms first.
    return [...tied].sort((a, b) => Number(a.steps.some((s) => s.irreps.every((x) => x.moves === false))) - Number(b.steps.some((s) => s.irreps.every((x) => x.moves === false))));
  }, [row]);
  const shownWays = allWays ? ways : ways.slice(0, 3);
  const chainsShown = shownWays.reduce((n, w) => n + w.chains, 0);
  const lattice = useMemo(() => (steps && p.graph ? latticeChains(p.graph, row.key, 5) : null), [steps, p.graph, row.key]);
  const latticeCount = useMemo(() => (p.graph ? latticeChains(p.graph, row.key, 0).count : null), [p.graph, row.key]);
  const sets = collapseTies(setsFor(row, p.ks).length > 0 ? setsFor(row, p.ks) : row.reach.sets);
  const split = splitOf(row);
  const secondary = secondaryOf(row);
  const block = activateBlock(row, { busy: p.busy, modesInForce: p.modesInForce, canActivate: p.canActivate(row.action) });
  const isActive = p.activeKey === row.key;
  const running = p.activating === row.key;
  const name = shortName(row.name);
  const others = group.variants.filter((v) => v !== row);
  const activateText = running ? "working…" : isActive ? "Active ✓" : block === "active" ? "✕ clear first" : block === "strain" ? "Strain only: nothing to refine" : block === "busy" ? "A fit is running" : block === "elsewhere" ? "Not offered here" : `Activate ${name}`;

  const irrepLine = (alts: readonly SubgroupRow["reach"]["sets"][number][number][], key: string): JSX.Element => (
    <div key={key} style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, display: "flex", gap: 8, flexWrap: "wrap", lineHeight: 1.6 }}>
      <span title={alts.map((x) => x.label).join(", ")}>{alts.length === 1 ? alts[0]!.label : `${irrepsLineOf(alts)} (of ${/of (\d+)$/.exec(alts[0]!.label)?.[1] ?? "?"})`}</span>
      <span style={{ color: color.secondary }}>{alts[0]!.direction}</span>
      {alts[0]!.alone ? <span style={{ color: color.faint }}>alone → {shortName(alts[0]!.alone)}</span> : null}
      {alts.every((x) => x.moves === false) ? <span style={{ color: color.warnInk }}>moves no atom</span> : null}
    </div>
  );

  return (
    <div className="wb-sgdetail" data-detail={row.key} style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontFamily: mono, fontSize: fz.title, fontWeight: 600, color: color.ink }}>{compactName(row.name)}</h3>
        {row.maximal ? <span style={{ fontSize: 11, color: color.okInk, border: `1px solid ${color.okBorder}`, background: color.okBg, borderRadius: 999, padding: "0 7px" }}>maximal</span> : null}
        {isActive ? <span style={{ fontSize: 11, color: color.primary, border: `1px solid ${color.primaryTintBorder}`, background: color.primaryTintBg, borderRadius: 999, padding: "0 7px" }}>active</span> : null}
      </div>
      <p style={{ margin: "0 0 4px", fontSize: fz.small, color: color.secondary }}>
        <InfoBadge width={380} label={resultLine(row, p.ks)} ariaLabel={`About ${row.name}`} text={<span style={{ whiteSpace: "pre-line" }}>{row.detail}</span>} />
      </p>

      <div style={{ display: "flex", gap: "8px 22px", alignItems: "flex-start", flexWrap: "wrap", padding: "6px 0 8px" }}>
        <CellSketch cell={row.cell} basis={basisOf(row)} />
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "6px 18px", alignItems: "baseline" }}>
          <span style={uppercaseLabel}>Cell</span>
          <span style={fact}>{row.cell}{row.sameCell ? <span style={sub}> · refined in the parent's cell</span> : null}</span>
          <span style={uppercaseLabel}>Domains</span>
          <span style={fact}>{row.domains}</span>
          <span style={uppercaseLabel}>Index</span>
          <span style={fact}>{row.index}{split ? <span style={sub}> = {split[0]}·{split[1]} (point group · translations)</span> : null}</span>
        </div>
      </div>

      <Section
        title="How you get here"
        right={latticeCount !== null && latticeCount > 0 ? (
          <button type="button" style={linkBtn} onClick={() => setSteps(!steps)}>{steps ? "one irrep per step" : `every lattice step (${latticeCount.toLocaleString("en-US")})`}</button>
        ) : null}
      >
        {steps && lattice ? (
          <>
            <p style={{ margin: "0 0 4px", ...sub }}>{plural(lattice.count, "chain")} of maximal subgroups; the shortest:</p>
            {lattice.chains.map((ch, i) => (
              <div key={i} data-lattice-chain={ch.join(">")} style={{ fontFamily: mono, fontSize: fz.micro, lineHeight: 1.7, display: "flex", flexWrap: "wrap", columnGap: 6 }}>
                {ch.map((k, j) => (
                  <Fragment key={j}>
                    {j > 0 ? <span style={{ color: color.faint }}>→</span> : null}
                    <span style={{ fontWeight: j === ch.length - 1 ? 600 : 400 }}>{k === "p" ? shortName(p.parent) : p.nameOf(k)}</span>
                  </Fragment>
                ))}
              </div>
            ))}
          </>
        ) : ways.length === 0 ? (
          <p style={{ margin: 0, fontSize: fz.micro, color: color.faint }}>No set of up to 4 irreps reaches it.</p>
        ) : (
          <>
            {shownWays.map((w, i) => {
              const names = w.steps.map((s) => shortName(s.name));
              return (
                <div key={i} data-way={w.steps.map((s) => s.cls).join(">")} style={{ fontFamily: mono, fontSize: fz.micro, color: color.ink, lineHeight: 1.7, display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 6 }}>
                  <span>{shortName(p.parent)}</span>
                  {w.steps.map((s, j) => (
                    <Fragment key={j}>
                      <span style={{ color: color.faint }}>→</span>
                      <span style={{ fontWeight: j === w.steps.length - 1 ? 600 : 400 }}>
                        {names[j]}
                        {names.filter((n) => n === names[j]).length > 1 ? <span style={{ color: color.faint }}> {s.cell}</span> : null}
                      </span>
                      <span style={{ color: color.primary }}>({j > 0 ? "+ " : ""}{irrepsLineOf(s.irreps)})</span>
                    </Fragment>
                  ))}
                </div>
              );
            })}
            {row.ways.count > chainsShown || ways.length > 3 ? (
              <button type="button" style={{ ...linkBtn, marginTop: 2 }} onClick={() => setAllWays(!allWays)} disabled={ways.length <= 3 && !allWays}>
                {allWays ? "fewer" : `${(row.ways.count - chainsShown).toLocaleString("en-US")} more way${row.ways.count - chainsShown === 1 ? "" : "s"}`}
              </button>
            ) : null}
          </>
        )}
      </Section>

      <Section title={row.reach.kind === "primary" ? (row.reach.sets.length === 1 ? "Primary irrep" : "Primary irreps (any one)") : "Coupled irreps (together)"}>
        {row.reach.kind === "primary"
          ? collapseTies(row.reach.sets).map((t, i) => irrepLine(t.members[0]!, `p${i}`))
          : sets[0] ? sets[0].members.map((alts, i) => irrepLine(alts, `c${i}`)) : null}
        {row.reach.kind === "coupled" && row.reach.setCount > 1 ? (
          <Fold label={`or ${row.reach.setCount - 1 - (sets[0] ? sets[0].members.reduce((n, a) => n * a.length, 1) - 1 : 0)} other ${sets[0]?.members.length === 2 ? "pair" : "set"}s`}>
            {sets.slice(1, 13).map((t, i) => (
              <div key={i} style={{ fontFamily: mono, fontSize: 11, color: color.secondary, lineHeight: 1.6 }}>{setLine(t)} <span style={{ color: color.faint }}>{tagOf(t)}</span></div>
            ))}
            {row.reach.setCount > row.reach.sets.length ? <div style={sub}>… and more; the full list is behind the "?" above.</div> : null}
          </Fold>
        ) : null}
        {secondary.length > 0 ? (
          <Fold label={`${plural(secondary.length, "secondary irrep")} come along`}>
            <div style={{ fontFamily: mono, fontSize: 11, color: color.secondary, lineHeight: 1.6 }}>{secondary.join(" · ")}</div>
          </Fold>
        ) : null}
      </Section>

      {others.length > 0 ? (
        <Section title={`${plural(group.variants.length, "variant")} of ${name} · ${row.cell} · ${row.domains} domains`}>
          {group.variants.map((v, i) => {
            const t = collapseTies(setsFor(v, p.ks).length > 0 ? setsFor(v, p.ks) : v.reach.sets)[0];
            const vBlock = activateBlock(v, { busy: p.busy, modesInForce: p.modesInForce, canActivate: p.canActivate(v.action) });
            const kept = p.shown.includes(v);
            return (
              <div key={v.key} data-variant={v.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", opacity: kept ? 1 : 0.55, flexWrap: "wrap" }}>
                <button type="button" onClick={() => p.onPickVariant(v)} aria-pressed={v === row} style={{ ...linkBtn, color: v === row ? color.ink : color.primary, fontWeight: v === row ? 600 : 400, fontFamily: mono, textAlign: "left" }}>
                  {i + 1}. {t ? setLine(t) : "no small set"}
                </button>
                {v.modes === 0 ? <span style={sub}>strain only</span> : null}
                {p.activeKey === v.key ? <span style={{ ...sub, color: color.primary }}>active</span> : null}
                <button
                  type="button"
                  style={{ ...resetRangeBtn, marginLeft: "auto", ...(vBlock ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                  disabled={vBlock !== null || p.activating !== null}
                  aria-label={`Activate ${v.name} (variant ${i + 1})`}
                  onClick={() => p.onActivate(v)}
                >
                  {p.activating === v.key ? "working…" : "Activate"}
                </button>
              </div>
            );
          })}
        </Section>
      ) : null}

      <Section title="Modes">
        <p style={{ margin: 0, fontSize: fz.small, color: color.ink }}>
          {row.modes === null ? (
            <span style={{ color: color.secondary }}>Counted after Activate.</span>
          ) : (
            <InfoBadge
              width={300}
              label={row.modes === 0 ? "No displacive mode: only the cell (strain) can change." : <><b style={{ fontFamily: mono }}>{row.modes}</b> {row.modes === 1 ? "mode refines" : "modes refine"}</>}
              text="The displacive modes the child allows: for every irrep, its copies on the atoms times the dimension the child fixes, the parent's free coordinates included, rigid shifts left out. Activate loads exactly these into the Positions group."
            />
          )}
        </p>
      </Section>

      <div style={{ position: p.sheet ? "sticky" : "static", bottom: 0, background: color.surface, padding: "12px 0 4px" }}>
        <button
          type="button"
          onClick={() => p.onActivate(row)}
          disabled={block !== null || p.activating !== null}
          aria-label={`Activate ${row.name}`}
          title={block === "active" ? "A child is in force: ✕ clear it to lower the parent another way" : undefined}
          style={{ ...primaryButton, width: "100%", padding: "11px 18px", fontSize: fz.body, ...(block !== null || p.activating !== null ? { opacity: 0.55, cursor: "default" } : {}) }}
        >
          {activateText}
        </button>
      </div>
    </div>
  );
}

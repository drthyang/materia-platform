# The Subgroups page, subgroup first: each subgroup with its cell and the irreps that activate it

Branch `subgroup-first`, 2026-11-01. Follows [#141](https://github.com/drthyang/materia-platform/pull/141)
(the one-path Subgroups view) and the subgroup engine's phases
[2](./2026-10-31-subgroup-engine-phase-2.md)–[5](./2026-11-01-subgroup-engine-phase-5.md).
Decisions: [ADRs 0002–0004](../adr/).

## What changed, and why

On the GaTa₄Se₈ demo (F-43m) with the 1×1×2 bound, "By subgroup" listed
P-42₁m only in (a, a, 2c), the bound's own lattice, while "By irrep" at
(0, 0, ½) and W offered P-42₁m in (2a, 2a, c): larger than the chosen cell,
because a cubic parent's factor group is built on the 2×2×2 core of any
supercell. The X chip's P-42₁m, a decentring child, keeps the cubic cell, so
its 3D view rightly showed the 1×1×1 cell, which looked like a bug. Nothing
showed a child's cell before Activate. The owner decided: make "By subgroup"
the first view, and show on each subgroup which irreps it activates.

### 1. Which irreps a subgroup activates (`irreps/subgroupIrreps.ts`)

For each class of the subgroup lattice inside the bound:

- **Primary**: an irrep one of whose isotropy subgroups, for some direction,
  is in this class. The irrep's isotropy subgroups are the ones "By irrep"
  lists (isotropy.ts, one per class); they are matched to the lattice's
  classes as classes, through any member (`SupercellLattice.classOf`), never
  by one representative. Each is shown with the direction "By irrep" writes.
- **Coupled**, when no single irrep has the class as an isotropy subgroup:
  the fewest irreps whose joint isotropy subgroup is it. For a member H and
  an irrep j with a vector H fixes, the isotropy subgroup of the whole fixed
  space Fix_j(H) is K_j, the smallest isotropy subgroup of j containing H (any
  isotropy subgroup L ⊇ H has Fix_j(L) ⊆ Fix_j(H), so its stabilizer lies in
  L). A generic vector of ⊕ Fix_j(H) is fixed by ∩ K_j exactly, each irrep in
  the domain H fixes; a set reaches H when that intersection is H. All the
  irreps H allows always reach it (the coset vector of the permutation
  representation on F/H decomposes into them), so the search over two, three
  and four irreps finds the smallest set.
- **Secondary**: every other irrep with a vector the class fixes,
  n_j = (1/|H|) Σ_{h∈H} χ_j(h) > 0 (its subduction to H contains the
  identity), the primary or coupled ones excluded.

Several smallest sets can reach one class, and on the cases below every
coupled class has more than one: a trilinear coupling makes any two of three
irreps enough. SrTiO₃'s a⁻b⁺a⁻ Pnma is reached by eight pairs among its R, M
and X irreps (Campbell et al. 2006, §4.6, reach the same Pnma through R4+ →
Imma → X4⁻ as well as R4+ ⊕ M2+). The row shows one, ordered by the
structure (the irreps its atoms carry first, then the fewest child modes,
then the lowest dimension, then the first in star order), and lists the
others behind its "?". Which pair drives a real distortion is a question for
the physics, not the group.

The structure enters only there and in a note on irreps that move no atom of
it: the displacement character on the T″ cell (`supercellModes.ts`,
`displacementCharacters`). The lattice gains `classOf`, `fitsBound` (a
conjugate of the supercell lies in the subgroup's lattice) and
`keepsSupercell`; `childSetting.ts` the parent-axes box of a lattice; and
isotropy.ts a cache, so both views compute an irrep's isotropy subgroups
once.

### 2. The page (`SubgroupsPanel.tsx`, `subgroupPicker.ts`)

- **By subgroup is the first view**, filtered to the chosen supercell: the
  parent's same-cell subgroups (from the conventional cell's lattice, G/ℤ³:
  t-subgroups, decentring k-subgroups and general ones) and the
  cell-multiplying classes of the bound's lattice that keep a conjugate of
  the supercell, every index. Rows by index, the maximal ones first.
- **Each row is one line**: name #IT · cell · domains · primary irreps with
  their directions (or the coupled set) · Activate. The cell is "same cell",
  or the multiple of the parent's cell along its axes that repeats the child
  (1×1×2, 2×2×2): the child's own cell when its axes lie along the parent's,
  else the box that holds whole copies of it (R-3c's hexagonal cell, ×6,
  reads 2×2×2). Behind the "?", one statement a line: kind and maximality,
  index t·k, orientations, domain states, the child basis (P_H, p_H) and the
  own cell's volume, Bilbao's exact-lattice flag, the coupled alternatives,
  the irreps that move no atom, the secondary irreps, an enantiomorph.
- **Activate takes the older paths**, so a row gives the child they gave.
  A same-cell row: By irrep's child (withActivatedMode) when a primary irrep
  is one the Γ or decentring tree lists, else the t-lattice's node
  (withSubgroup) or the same-cell lattice's (withSameCellSubgroup). A larger
  row: withSupercellChild, on By irrep's child when the first primary irrep's
  child keeps the supercell (identical to that path), else on the lattice's
  member that keeps it, with the row's irrep, or coupled set, preferred as
  the kick (`orderParameterIrreps` gains that preference; without it the
  result is unchanged).
- **Working…**: the same-cell rows show at once. The larger cells are worked
  out after the view shows, a step at a time (the lattice; each star's
  irreps; each irrep's isotropy subgroups; the matching) with a pause between
  steps, so "working…" names the step, the supercell and the chips are held,
  **stop** is heard, one run goes at a time, and the result is kept for the
  structure and bound.
- **By irrep** stays as the second view. Each child says its cell; only the
  children that fit the supercell are listed (the irrep's line counts the
  larger ones) until **show larger cells**.
- After Activate, the banner says where the child lives: "in its own cell,
  1×1×2" (the box of its basis P_H and centring, from the mode set as saved),
  or "in the parent's cell".

## Evidence

Tests through the module interfaces (`subgroupIrreps.test.ts`,
`subgroupPicker.test.ts`, `subgroupsPanel.dom.test.ts`,
`pdfSymmetryPanels.test.ts`).

| Check | Result |
| --- | --- |
| **Gate: the two views agree, class by class.** Every primary irrep's isotropy subgroup is in its class, and on the class's own member the inverse query of orderParameters.ts (fixed subspace, pointwise stabilizer: another route) says the irrep alone reaches it; every By-irrep child whose lattice fits the bound is a class naming that irrep as primary; every coupled set's joint isotropy subgroup, by the inverse query, is the member, and no single irrep reaches it; the secondary irreps are the inverse query's other n_j > 0 | **SrTiO₃, Pm-3m, 2×2×2** (\|F\| 384): 1426 classes below the parent (32 same cell, 1394 larger): 209 with a primary irrep (242 irrep–class pairs = all 242 By-irrep children, every one fits), 1217 coupled (802 by two irreps, 395 by three, 20 by four), none unreached. **GaTa₄Se₈, F-43m, 1×1×2** (\|F\| 768): 151 classes (55, 96): 57 with a primary irrep (63 pairs = the 63 of By irrep's 242 children that fit), 94 coupled. **2×2×2**: 436 classes (55, 381): 209 with a primary irrep (373 pairs = all 373 children), 227 coupled. All agree |
| **Known cases**, each class found as the stabilizer of the geometric tilt (testSupport, no subgroup engine) | SrTiO₃ a⁻a⁻a⁻: `R -3 c:H #167 · 2×2×2 · 8 domains · R irrep 8 of 10 (a,a,a)` (the R tilt; the atoms carry it once, O only). a⁰a⁰c⁻: `I 4/m c m #140 · 2×2×2 · 6 domains · R irrep 8 of 10 (a,0,0)`. a⁰a⁰c⁺: P4/mbm from `M irrep 5 of 10 (a,0,0)`. a⁻b⁺a⁻: `P n m a #62 · 2×2×2 · 24 domains · M irrep 3 of 10 (a,0,0) + R irrep 8 of 10 (a,a,0), coupled (or 7 other pairs)`; the two tilts themselves, M irrep 5 + R irrep 8, are one of the eight pairs, four of the others take the X irrep |
| GaTa₄Se₈ in 1×1×2 | Four P-42₁m classes in 1×1×2, each with Bilbao's exact lattice, each coupled: `P -4 21 m #113 · 1×1×2 · 24 domains · X irrep 5 of 5 (0,0,a,-a,-a,a) + W irrep 1 of 4 (a,0,0,a,0,0), coupled (or 2 other pairs)`. At X: `P -4 21 m #113 · same cell · 12 domains · X irrep 5 of 5 (0,0,a,-a,-a,a)` and `… (0,0,a,a,a,a)`. By irrep's P-42₁m at (0,0,½) and W double two axes (1×2×2 and its turns) and are left out until "show larger cells" |
| **Bilbao's SUBGROUPS Landau-type counts** (classes with the supercell's lattice that one irrep reaches; tutorial pp. 12, 18) | Pnma (a, b, 2c): 6 (published 6). Fm-3m (½a−½b, ½a+½b, 2c): 28 classes, 31 entries with the enantiomorphs (published 31) |
| **Activation through a row is the child of the older path** (`outcome`: group, operations, cell, sites, modes with labels, irreps and axes, every row's value and free state) | SrTiO₃: P4mm's row = the Γ tree's child; three t-subgroup rows = withSubgroup's, node for node; the R-3c row = By irrep's R child exactly (same elements, basis, primary); the Pnma row = the old Lattice view's child, the order parameter M irrep 3 + R irrep 8. GaTa₄Se₈: the X P-42₁m row = the X chip's child; a 1×1×2 P-42₁m row = the old Lattice view's child (group, cell, sites, modes), its kick the row's pair X irrep 5 + W irrep 1, the cell (a, a, 2a); three decentring rows = withSameCellSubgroup's |
| DOM (happy-dom) | By subgroup first: same-cell rows before any work; "working…" with the supercell held; **stop** heard (no listing made), **work them out** to the end with one listing; the next mount reuses it (no listing); each row's Activate hands over its own action (Γ tree, t-node, supercell choice with its primary). By irrep: SrTiO₃'s X in 1×1×2 lists fewer children until "show larger cells" |
| **Browser** (dev server, headless Chrome via playwright-core; the bundled GaTa₄Se₈ demo and synthetic SrTiO₃ with its neutron G(r)) | 1600×900: 13/13; 390×844: 11/11; SrTiO₃ 1600×900: 5/5, no page errors. GaTa₄Se₈: By subgroup first (55 same-cell rows, then 436 in 2×2×2, 151 in 1×1×2); the 1×1×2 P-42₁m row reads 1×1×2, the X rows same cell; Activate → "▼ lowered to P -4 21 m #113 · in its own cell, 1×1×2"; the 3D Model's structure exports 10.3683 × 10.3683 × 20.7366 Å (the demo's refined a); saved, reloaded, reopened: the same banner and cell; ✕ clear; By irrep W in 1×1×2: 12 children (25 larger per irrep), 112 with "show larger cells". SrTiO₃: 1426 rows, R-3c, I4/mcm and Pnma as above; R-3c activated "in its own cell, 2×2×2" |
| **ISOTROPY oracle** (opt-in workflow, on the branch at fbdf749: [run 41348292653](https://github.com/drthyang/materia-platform/actions/runs/41348292653)) | isotropy subgroups 13/13, mode amplitudes 3/3, irrep labels 16/16: the irreps and isotropy subgroups the rows are built from are ISOTROPY's |
| Model-visible surfaces | Unchanged: no agent text, tool, MCP output, skill, snapshot or `review_symmetry` output. `review_symmetry` uses `nameChild` and `sameCellSubgroups`, both unchanged; the agent snapshots and scripted evals pass |

**Cost** (Node 24, M-series laptop): SrTiO₃ 2×2×2, the named lattice 4.3 s,
the irreps and isotropy subgroups 1.7 s, the matching 0.2 s; GaTa₄Se₈ 1×1×2
0.5 + 2.5 + 0.3 s, 2×2×2 0.9 + 5 + 0.3 s. An F-centred cubic parent in 2×2×2
takes about a minute (Fm-3m: an unnamed lattice of 2194 classes in 12 s, the
isotropy analysis 26 s; Fd-3m 4 + 6 + 45 s), which the page shows as
"working…" with **stop**.

## What changes for users

- The PDF page's Subgroups view opens on **By subgroup**: every subgroup
  whose cell fits the chosen supercell, each in one line with its cell, its
  domains and the irreps that lower the parent to it, and Activate. The
  details are behind each row's **?**.
- A child larger than the supercell is no longer offered unasked: By irrep
  lists only the children that fit, with **show larger cells** for the rest.
- After Activate, the banner says whether the child lives in its own cell
  (and which multiple of the parent's) or in the parent's.
- The old supercell view's **List supercell subgroups** and its index limit
  are gone: By subgroup lists every index.

## What it means for the validation

Nothing under the agent validation freeze changed. The engine's existing
functions return what they returned (`orderParameterIrreps` takes an optional
preferred set; without it, the same result), and both refinement engines are
untouched.

## Not done, and open

- **Which coupled set a row shows** is a documented choice among equals
  (above). For SrTiO₃'s a⁻b⁺a⁻ Pnma it shows M irrep 3 + R irrep 8, where a
  crystallographer would name the tilts, M irrep 5 + R irrep 8 (listed second
  behind its "?"). Choosing by the order of the coupling that induces the
  others (Landau's faintness) would need invariant polynomials; not tried.
- **The Γ chip's labels.** By irrep's Γ chip names its irreps Γ1, Γ2, … in
  the point group's own order (displaciveModes.ts). They differ from the
  generic "Γ irrep n of m" (SrTiO₃'s polar irrep is Γ irrep 10 of 10), from
  one operation list to another, and between Node 22 and Node 24 (Γ9 locally,
  Γ10 in CI for the same irrep). A By subgroup row's "?" names the Γ chip's
  label beside the generic one. The activation's mode rows use the Γ chip's
  labels, which the Agent reads after a user activation, so renaming them
  waits on the validation freeze.
- **A coupled-irreps ISOTROPY case.** The oracle checks single irreps; the
  coupled sets are checked by the inverse query, the geometric tilts and the
  Landau counts, not against ISOTROPY's coupled listing (its two-irrep
  syntax and output were not tried).
- **Speed** for F-centred cubic parents in 2×2×2 (about a minute on the main
  thread, in steps). A worker would keep the page responsive.

## Checks

At fbdf749: `npm run typecheck` and `npm run lint` clean; `npm test` 378
files, 3324 tests passed, 315 skipped, 0 failed (CI in the PR). The ISOTROPY
oracle ran on the branch (above).

# Subgroup engine, Phase 5: the magnetic page on the engine, review_symmetry on the engine, labels

Linear THY-36, project "MATERIA subgroup engine". The owner approved it on
2026-10-31 as an exception to the validation freeze, for this issue's
model-visible changes only: `review_symmetry`'s output, irrep labels, and the
magnetic page's results and text. Decisions: [ADRs 0001–0005](../adr/), ADR
0004 above all (generic irrep labels). Builds on
[Phase 4](./2026-10-31-subgroup-engine-phase-4.md) and on the magnetic-group
work of THY-37 (#128).

## What changed, and why

### 1. Representation analysis at any commensurate k (the magnetic page)

The magnetic page's **Representation analysis** framework built the ordinary
irreps of an abelian little co-group (at any k) and point-group irreps (at
k = 0). That left two gaps:

- **Refused:** a non-abelian co-group at k ≠ 0. Examples are MnO at L,
  Mn₃Ga at (0, 0, ½), and the Z point of P4₂/mnm.
- **Approximated:** the projective small representations on the zone boundary
  of a non-symmorphic group. Examples are P2/c at (0, 0, ½) and Pnma at X. The
  page showed the ordinary irreps with a "non-integer multiplicities" warning.

It also refused multidimensional and complex irreps, and labelled every irrep
"Γ1, Γ2, …" at every k, which reads as a CDML Γ label.

The new `representationAnalysis.ts` takes its small representations from the
engine (module comment; [MAGNETIC_SYMMETRY.md](../MAGNETIC_SYMMETRY.md#route-b--representation-analysis)):

- **Small representations.** It calls `complexIrrepsOfStar` on G modulo the
  core of the magnetic cell, inducing from the user's arm. The top-left block
  of each irrep on an operation of G_k is its small representation. This is
  ADR 0001's chain induction; nothing is tabulated.
- **Γ_mag.** It acts on the Fourier coefficients of the magnetic atoms of one
  primitive cell, with the k-phase of the true lattice vector. Multiplicities
  must come out integral and account for every dimension. Basis vectors come
  from transfer operators and must transform by the irrep. The analysis
  throws when any check fails, and the page then says so.
- **Real forms.** At a single-arm k, each physically irreducible small
  representation is built: a real one in its real form, a complex pair
  realified, a pseudoreal one doubled.
- **Directions.** Each irrep's order-parameter directions come from the image
  method on G_k × {1, 1′}, time reversal acting as −1. Each direction carries
  its isotropy subgroup, one per class under G_k.
- **Naming.** A combination's group is the intersection of its directions'
  groups. It is named as Route A names its candidates: at k ≠ 0, the type-IV
  group of the magnetic cell (THY-37).
- **Secondary irreps.** The other irreps the group allows are listed with it.
- **Two-arm k.** The decomposition and the complex basis vectors are given,
  and no group is named, as on Route A.

On the page:

- The line reads Γ_mag first ("Γmag = 2 irrep 1 ⊕ 1 irrep 2 ⊕ 3 irrep 3 at
  k = (0, 0, 1/2)").
- Each irrep is listed with its dimension and its modes on the first ion.
- A multidimensional irrep has a direction menu.
- The result box names the group with its magnetic cell, and the list's
  candidate in the same class. Its **?** gives the secondary irreps.
- The analysis is built only in its framework.

**The group the page models.** A direction's isotropy subgroup can be a
conjugate of the one the group list shows: the same order, in another domain.
The step models the list's group of that class (`stepView`'s `combo`). The
reason is a documented approximation in the powder calculation: each
satellite family's |F_M|² is read at one member (LIMITATIONS, Magnetic
structures), so two domains of one class do not fit alike. On the synthetic
Mn₃Ga page (P6₃/mmc, k = (0, 0, ½)), the two domains of P_c-3m1 fit its data
to wR 0.31 % and 29.6 % at the same refinement. A brute-force sum over every
Q at each |Q| gives the two domains identical powder intensities. Modelling
the listed group keeps the two frameworks' fits equal, and leaves every Route
A result unchanged. The approximation itself is open below.

Engine changes, with no change in behaviour:

- `complexIrrepsOfStar` is split out of `irrepsOfStar`.
- `realFormWithBasis`, `realification` and `simplicity` are exported.
- `magneticAtoms` is exported from magneticRepresentation.ts.

### 2. `review_symmetry` on the engine

The review listed `structuralSubgroupLattice`'s t-subgroups. Under the freeze
it named them from their coset representatives alone, which reads a centred
parent's subgroup as primitive. Beside them it listed decentred subgroups
from its own enumerator, merged by name. It now uses the engine:

- **Source.** The same-cell lattice (`sameCellSubgroups` on G modulo the
  conventional cell): t-subgroups up to index 6, and the classes that keep
  every rotation and drop a centring vector. One entry per conjugacy class.
- **Names.** Each class is named in ITA standard setting by `nameChild`, as
  the PDF Subgroups page names it.
- **`setting`.** A candidate whose name holds in another cell or origin gains
  `setting`, its child basis (P_H, p_H) from the parent's cell, e.g.
  "(b, a, −c; 1/4, 1/4, 0)". For a decentred subgroup the setting also appears
  in the reading.
- **Allowed lines.** A subgroup allows a powder line when it allows any
  reflection of the line's family. Before, only the listed orientation was
  tested, so the result depended on which conjugate the enumerator listed.

The name-change list saved for after the freeze is in
[PR #119](https://github.com/drthyang/materia-platform/pull/119)'s body. It is
applied, and the table below gives every list that changed.

### 3. Irrep labels (ADR 0004)

CDML labels cannot be produced without unlicensed data, so the app keeps its
generic labels. This is the stop point the brief asked for. The label is a
table's numbering convention. It changes with the parent origin (R4⁺ becomes
R5⁻) and with the arm, and the irreps themselves do not determine it.
Bilbao, which computes its irreps, takes its labels from ISO-IR
([SUBGROUP_ENGINES.md](../research/SUBGROUP_ENGINES.md) §2.4–2.5). ISO-IR
states no licence. No licensed source was found.

What was done within ADR 0004:

- The magnetic page now uses the engine's generic labels, so its labels and
  the Subgroups page's are one scheme.
- An ISODISTORT mode CIF still brings its own CDML labels in (Phase 4).
- A new opt-in step of `isotropy-oracle.yml`, `irrepLabelOracle.test.ts`,
  checks by character that the generic labels stand for ISOTROPY's irreps one
  to one. It covers 16 (parent, k) cases, including the magnetic page's
  non-abelian zone-boundary points P6₃/mmc A, P4₂/mnm Z and P4/mmm Z. The
  correspondence it prints stays in the CI log and is never committed
  (ADR 0005).

The ADR is updated to say so.

### 4. Docs

The following were updated:

- USER_GUIDE (steps 3 and 4 of the magnetic page).
- MAGNETIC_SYMMETRY: Route B rewritten, with the open-work list.
- LIMITATIONS: Symmetry, and the satellite approximation's consequence.
- ROADMAP M3 and VALIDATION.
- GLOSSARY: *Generic irrep label*, *Magnetic irrep*, *Magnetic
  representation*, and the magnetic reading of *Isotropy subgroup*.
- ADRs 0001 and 0004, the CHANGELOG, and this report.

## Evidence

| Check | Result |
| --- | --- |
| **Gate: magnetic results unchanged where they agreed with external codes.** Route A is untouched: its oracle against an independent construction named by spglib 2.8 (`magneticGroupsOracle.test.ts`, 15 single-arm cases plus 2 two-arm, 79 tests), the MnO names FindSpinGroup gives (`mnoGolden.test.ts`, `bnsOg.test.ts`), the Mn₃Ga 350 K GSAS-II magnetic goldens on the published POWGEN data (`mn3ga350KGolden.test.ts`), and the diffpy.mpdf goldens (`mpdfGolden.test.ts`) | all pass unchanged |
| Route B against the old route, wherever the old one applied (`representationAnalysisLegacy.test.ts`; 15 cases: the old route's own abelian test groups, P-1 at (0, 0, ½), and the oracle's 9 cases it answered) | the same irreps by character, multiplicities, modes on the reference site, and isotropy subgroup (operations and BNS number) for every real one-dimensional irrep. Its two wrong answers are pinned: P2/c at (0, 0, ½) (the c-glide squares to a translation with phase −1: one 2-dim small representation, not four 1-dim irreps) and Pnma at X (two 2-dim, not eight 1-dim) |
| **Route B on the engine against the oracle** (`representationAnalysis.test.ts`, the 17 cases of THY-37's fixture, public or synthetic structures) | Γ_mag decomposes with integral multiplicities that account for it at every k, 7 of the cases ones the old route refused. Every isotropy subgroup of every irrep and direction is a candidate group of Route A, with the BNS number and type spglib gives it. Examples: MnO at L, the 2-dim irrep along (a,−a) gives C_c2/c 15.90, MnO's group with moments in the (111) planes; Mn₃Ga at (0, 0, ½), small representations of 2, 2 and 4 dimensions, irrep 2 along (a,a) gives P_c-3m1 164.90; P2/c at (½, 0, 0), every irrep gives P_a2/c 13.70 |
| The step (`magneticStep.test.ts`, synthetic Mn₃Ga page) | irrep 2 along (a,a) is the list's G1, the truth; its moments fit to the same wR as G1's through the list (to 1e-6) |
| **Gate: labels match ISOTROPY** (`irrepLabelOracle.test.ts`, opt-in, ISOTROPY 9.6.1, [run 41275716140](https://github.com/drthyang/materia-platform/actions/runs/41275716140) at 0793d73) | **Met: 16/16 cases.** Every generic label stands for exactly one of ISOTROPY's irreps by character on every legible class, and every one of ISOTROPY's is matched. Details under "Oracle runs" |
| The isotropy oracle and the mode-amplitude oracle re-run on the branch (the engine refactor) | 13/13 isotropy cases and 3/3 amplitude cases agree, in runs 41273866032 and [41275716140](https://github.com/drthyang/materia-platform/actions/runs/41275716140) |
| `review_symmetry` (`symmetryReview.test.ts`) | I4₁/amd and R-3c pinned with names, settings and domains; Pnma's Pmn2₁/Pmc2₁ settings; Cmcm's two Pnma classes; Ia-3d's I4₁/acd allows exactly the lines some orientation allows (5, was 1) |
| `review_symmetry` before and after, 16 parents × 3 residuals (all forbidden lines, every third, one; a scratch dump, not committed) | 96 lists: 62 unchanged in name, number, index, domains and allowed lines, 34 changed (table below); readings changed in 11 of 48. The observed forbidden lines, the tested and untestable counts and the limits are unchanged in all 48 |
| **Browser check** (`scripts/magnetic-irreps-check.mjs`, dev server from the branch, headless Chromium through playwright-core; public and synthetic inputs) | 10/10, no page errors. Mn₃Ga TOF demo at k = (0, 0, ½): Γ_mag = 2 irrep 1 ⊕ 1 irrep 2 ⊕ 3 irrep 3 (2, 2, 4-dim), irrep 2 along (a,a) is P_c-3m1 · BNS 164.90 · (a, b, 2c; 0, 0, 0), candidate 1 of the list, step 5 shown. Synthetic wolframite (P2/c, 2f) at k = (½, 0, 0): four 1-dim irreps; irrep 2 is P_a2/c · BNS 13.70 · (2a, b, 2a+c; 3/4, 0, 0), and the group list reads 13.70 too, never 13.68 |

### Oracle runs

- [Run 41273866032](https://github.com/drthyang/materia-platform/actions/runs/41273866032)
  (at 646ee10): the isotropy and amplitude cases agree. The label step parsed
  nothing: ISOTROPY printed a row per irrep with the element and its character
  but no label. It accepted every element written in International Tables
  notation.
- [Run 41274690838](https://github.com/drthyang/materia-platform/actions/runs/41274690838)
  (at a64f889, with SHOW IRREP): 15 of 16 cases match one to one. Fm-3m W
  left MATERIA's 12-dimensional irrep 5 and ISOTROPY's W5 apart.
  [Run 41275604738](https://github.com/drthyang/materia-platform/actions/runs/41275604738)
  (that case alone) showed why: they differ on one class of 40, the
  translation (1, 1, 1), where MATERIA's character is −12 and ISOTROPY prints
  nothing legible. −12.000 overflows its six-character field. Such a field now
  counts as unknown, and each irrep must still be read on three quarters of
  the classes.
- [Run 41275716140](https://github.com/drthyang/materia-platform/actions/runs/41275716140)
  (at 0793d73, every step): **13/13 isotropy-subgroup cases, 3/3
  mode-amplitude cases and 16/16 label cases pass.** Each label case lists
  its correspondence in the log, with every irrep matched one to one and the
  same phase convention. The one unread field is W5's at (1, 1, 1). The
  magnetic page's projective cases are among them: P6₃/mmc A (MATERIA's 3
  irreps to A1–A3), P4₂/mnm Z (4 to Z1–Z4), and P4/mmm Z (10 to Z1±–Z5±). So
  are Pm-3m X, M, R, Fm-3m L, W and the Phase 1 decentring points. The labels
  themselves are not committed.

## Old → new

**review_symmetry.** The engine names in ITA standard setting, so the names
change in two ways:

- Where the old ones read a centred parent's subgroup as primitive: Pmna →
  Imma, Pmn2₁ → Imm2, P-3 → R-3, P3 → R3, the bare "-3m" → R-3m, "2/m" → C2/c,
  P2/m11 → C2/m.
- Where they wrote a non-standard setting of the right type: Pnm2₁ → Pmn2₁
  with its setting, P2₁ma → Pmc2₁, Pmcm → Pmma. Origin-choice suffixes follow
  the standard setting (Pn-3m:1 → Pn-3m:2 at (¼, ¼, ¼)).

The family test adds or removes candidates where an orientation other than the
listed one allows a line (Ia-3d, I4₁/amd, R-3c). Classes of one type are no
longer merged by name, which shows up three ways:

- R-3m's and R-3c's decentred P-3m1/P-3c1 read as one class of 3 domains
  (was 1, beside an unnamed 2).
- F-43m's two P-43m classes read as two (were one).
- Cmcm's Pbnm and Pmcn read as two Pnma with their settings.

<details><summary>Every list that changed (16 parents × 3 residuals; "index n" rows were unnamed)</summary>

| Parent | Residual | List | Before | After |
| --- | --- | --- | --- | --- |
| F d -3 m:1 | all | candidates | F -4 3 m #216; F 41 3 2 #210; -3m (point group; index 4) (no number); F 2 3 #196; -42m (point group; index 6) (no number); mmm (point group; index 6) (no number); 4/m (point group; index 6) (no number); 422 (point group; index 6) (no number) | F -4 3 m #216; F 41 3 2 #210; F 2 3 #196; R -3 m:H #166 ((a-c)/2, (-a+b)/2, a+b+c; 1/8, 1/8, 1/8); I 41 2 2 #98 ((a+b)/2, (-a+b)/2, c; 1/4, 1/4, 1/4); I -4 m 2 #119 ((a+b)/2, (-a+b)/2, c; 0, 0, 0); I m m a #74 ((a-b)/2, (a+b)/2, c; 1/8, 1/8, 1/8); I 41/a:2 #88 ((a+b)/2, (-a+b)/2, c; 1/8, 3/8, 3/8) |
| F d -3 m:2 | all | candidates | F -4 3 m #216; F 41 3 2 #210; -3m (point group; index 4) (no number); F 2 3 #196; -42m (point group; index 6) (no number); mmm (point group; index 6) (no number); 4/m (point group; index 6) (no number); 422 (point group; index 6) (no number) | F -4 3 m #216 (a, b, c; 1/8, 1/8, 1/8); F 41 3 2 #210 (a, b, c; 3/8, 3/8, 3/8); F 2 3 #196 (a, b, c; 1/8, 1/8, 1/8); R -3 m:H #166 ((a-c)/2, (-a+b)/2, a+b+c; 0, 0, 0); I 41 2 2 #98 ((a+b)/2, (-a+b)/2, c; 1/8, 1/8, 1/8); I -4 m 2 #119 ((a+b)/2, (-a+b)/2, c; 1/8, 1/8, 1/8); I m m a #74 ((a-b)/2, (a+b)/2, c; 0, 0, 0); I 41/a:2 #88 ((a+b)/2, (-a+b)/2, c; 0, 1/4, 1/4) |
| I m -3 m | all | decentred | P m -3 m #221; P m -3 n #223; P n -3 m:1 #224 | P m -3 m #221; P m -3 n #223; P n -3 m:2 #224 (a, b, c; 1/4, 1/4, 1/4) |
| F -4 3 m | all | decentred | P -4 3 m #215 | P -4 3 m #215 (a, b, c; 0, 0, 1/2); P -4 3 m #215 (a, b, c; 1/4, 1/4, 1/4) |
| F -4 3 m | third | decentred | P -4 3 m #215 | P -4 3 m #215 (a, b, c; 0, 0, 1/2); P -4 3 m #215 (a, b, c; 1/4, 1/4, 1/4) |
| F -4 3 m | one | decentred | P -4 3 m #215 | P -4 3 m #215 (a, b, c; 0, 0, 1/2); P -4 3 m #215 (a, b, c; 1/4, 1/4, 1/4) |
| I a -3 d | all | candidates | I 41 3 2 #214; I a -3 #206; I -4 3 d #220; I 41/a c d:2 #142; I 21 3 #199; -3m (point group; index 4) (no number); I 41/a:2 #88; 422 (point group; index 6) (no number) | I 41 3 2 #214; I a -3 #206; I -4 3 d #220; I 41/a c d:2 #142; I 21 3 #199; R -3 c:H #167 (a-c, -a+b, (a+b+c)/2; 0, 0, 0); I 41/a:2 #88 (a, b, c; 0, 1/2, 0); I 41 2 2 #98 (a, b, c; 0, 1/4, 1/8) |
| I a -3 d | third | candidates | I 41 3 2 #214; I -4 3 d #220; I a -3 #206; I 21 3 #199; -3m (point group; index 4) (no number); I 41/a:2 #88; 422 (point group; index 6) (no number); -42m (point group; index 6) (no number) | I 41 3 2 #214; I a -3 #206; I -4 3 d #220; I 41/a c d:2 #142; I 21 3 #199; R -3 c:H #167 (a-c, -a+b, (a+b+c)/2; 0, 0, 0); I 41/a:2 #88 (a, b, c; 0, 1/2, 0); I 41 2 2 #98 (a, b, c; 0, 1/4, 1/8) |
| I 4/m m m | all | decentred | P 4/m m m #123; P 4/n m m:1 #129; P 42/m m c #131; P 42/n m c:1 #137; P 42/n n m:1 #134; P 42/m n m #136; P 4/n n c:1 #126; P 4/m n c #128 | P 4/m m m #123; P 4/n m m:2 #129 (a, b, c; 1/4, 1/4, 1/4); P 42/m m c #131 (a, b, c; 0, 1/2, 0); P 42/n m c:2 #137 (a, b, c; 1/4, 3/4, 1/4); P 42/n n m:2 #134 (a, b, c; 1/4, 3/4, 1/4); P 42/m n m #136; P 4/n n c:2 #126 (a, b, c; 1/4, 1/4, 1/4); P 4/m n c #128 |
| I 4/m m m | third | decentred | P 4/m m m #123; P 4/n m m:1 #129; P 42/n n m:1 #134; P 42/m n m #136; P 4/n n c:1 #126; P 4/m n c #128; P 42/m m c #131; P 42/n m c:1 #137 | P 4/n m m:2 #129 (a, b, c; 1/4, 1/4, 1/4); P 4/m m m #123; P 42/n n m:2 #134 (a, b, c; 1/4, 3/4, 1/4); P 42/m n m #136; P 4/n n c:2 #126 (a, b, c; 1/4, 1/4, 1/4); P 4/m n c #128; P 42/m m c #131 (a, b, c; 0, 1/2, 0); P 42/n m c:2 #137 (a, b, c; 1/4, 3/4, 1/4) |
| I 4/m m m | one | decentred | P 4/m m m #123; P 4/n m m:1 #129 | P 4/n m m:2 #129 (a, b, c; 1/4, 1/4, 1/4); P 4/m m m #123 |
| I 41/a m d:2 | all | candidates | I -4 m 2 #119; P m n a #53; I 41 2 2 #98; I 41/a:2 #88; I -4 #82; P m n 21 #31; P 1 2/n 1 #13; 222 (point group; index 4) (no number) | I -4 m 2 #119 (a, b, c; 0, 1/4, 3/8); I m m a #74; I 41 2 2 #98 (a, b, c; 0, 1/4, 3/8); I 41/a:2 #88 (a, b, c; 0, 1/2, 0); I m m 2 #44 (a, b, c; 0, 1/4, 0); I 21 21 21 #24 (c, a, b; 0, 0, 1/4); F 2 2 2 #22 (c, a-b, a+b; 0, 1/4, 3/8); I -4 #82 (a, b, c; 0, 1/4, 3/8) |
| I 41/a m d:2 | third | candidates | I -4 m 2 #119; P m n a #53; I 41/a:2 #88; I 41 2 2 #98; I -4 #82; P m n 21 #31; P 2 n a #30; P 1 2/n 1 #13 | I m m a #74; I -4 m 2 #119 (a, b, c; 0, 1/4, 3/8); I 41 2 2 #98 (a, b, c; 0, 1/4, 3/8); I 41/a:2 #88 (a, b, c; 0, 1/2, 0); I m m 2 #44 (a, b, c; 0, 1/4, 0); I 21 21 21 #24 (c, a, b; 0, 0, 1/4); F 2 2 2 #22 (c, a-b, a+b; 0, 1/4, 3/8); C 1 2/c 1 #15 (a+b, -c, b; 0, 0, 0) |
| I 41/a m d:2 | one | candidates | I -4 m 2 #119; P m n a #53; I -4 #82; P m n 21 #31; P 2 n a #30; P 1 2/n 1 #13; P 1 1 21/a #14; 222 (point group; index 4) (no number) | I m m a #74; I -4 m 2 #119 (a, b, c; 0, 1/4, 3/8); I m m 2 #44 (a, b, c; 0, 1/4, 0); I 21 21 21 #24 (c, a, b; 0, 0, 1/4); F 2 2 2 #22 (c, a-b, a+b; 0, 1/4, 3/8); C 1 2/c 1 #15 (a+b, -c, b; 0, 0, 0); I -4 #82 (a, b, c; 0, 1/4, 3/8); I m a 2 #46 (b, c, a; 0, 0, 0) |
| R -3 m:H | all | decentred | P -3 m 1 #164; a primitive subgroup (index 3) (no number) | P -3 m 1 #164 |
| R -3 m:H | third | decentred | P -3 m 1 #164; a primitive subgroup (index 3) (no number) | P -3 m 1 #164 |
| R -3 m:H | one | decentred | P -3 m 1 #164; a primitive subgroup (index 3) (no number) | P -3 m 1 #164 |
| R -3 c:H | all | candidates | P -3 #147; R 3 2:H #155; P 3 #143; 2 (point group; index 6) (no number); P -1 #2; m (point group; index 6) (no number) | R 3 2:H #155 (-a-b, a, c; 0, 0, 1/4); R -3:H #148; C 1 2/c 1 #15 ((a-b+2c)/3, -a-b, (2a-2b+c)/3; 0, 0, 0); R 3:H #146; C 1 2 1 #5 ((a-b+2c)/3, -a-b, (a-b-c)/3; 0, 0, 1/4); P -1 #2 ((a-b-c)/3, (a-b+2c)/3, (-2a-b-c)/3; 0, 0, 0); C 1 c 1 #9 ((a+2b+2c)/3, a, (2a+4b+c)/3; 0, 0, 0) |
| R -3 c:H | all | decentred | P -3 c 1 #165; a primitive subgroup (index 3) (no number) | P -3 c 1 #165 |
| R -3 c:H | third | candidates | P -3 #147; R 3 2:H #155; P 3 #143; 2 (point group; index 6) (no number); P -1 #2; m (point group; index 6) (no number) | R 3 2:H #155 (-a-b, a, c; 0, 0, 1/4); R -3:H #148; C 1 2/c 1 #15 ((a-b+2c)/3, -a-b, (2a-2b+c)/3; 0, 0, 0); R 3:H #146; C 1 2 1 #5 ((a-b+2c)/3, -a-b, (a-b-c)/3; 0, 0, 1/4); P -1 #2 ((a-b-c)/3, (a-b+2c)/3, (-2a-b-c)/3; 0, 0, 0); C 1 c 1 #9 ((a+2b+2c)/3, a, (2a+4b+c)/3; 0, 0, 0) |
| R -3 c:H | third | decentred | P -3 c 1 #165; a primitive subgroup (index 3) (no number) | P -3 c 1 #165 |
| R -3 c:H | one | candidates | P -3 #147; R 3 2:H #155; P 3 #143; 2 (point group; index 6) (no number); P -1 #2 | R 3 2:H #155 (-a-b, a, c; 0, 0, 1/4); R -3:H #148; R 3:H #146; C 1 2 1 #5 ((a-b+2c)/3, -a-b, (a-b-c)/3; 0, 0, 1/4); P -1 #2 ((a-b-c)/3, (a-b+2c)/3, (-2a-b-c)/3; 0, 0, 0) |
| P 63/m m c | all | candidates | P -6 m 2 #187; P -3 m 1 #164; P -6 #174; P -3 #147; P 3 m 1 #156; P 3 2 1 #150; P 3 1 2 #149; mm2 (point group; index 6) (no number) | P -6 m 2 #187 (a+b, -a, c; 0, 0, 1/4); P -3 m 1 #164; P -3 #147; P -6 #174 (a+b, -a, c; 0, 0, 1/4); P 3 m 1 #156; P 3 1 2 #149 (a+b, -a, c; 0, 0, 1/4); P 3 2 1 #150; A m m 2 #38 (c, b, -2a-b; 0, 0, 1/4) |
| P 63/m m c | third | candidates | P -6 m 2 #187; P -3 m 1 #164; P -6 #174; P -3 #147; P 3 m 1 #156; P 3 2 1 #150; P 3 1 2 #149; mm2 (point group; index 6) (no number) | P -6 m 2 #187 (a+b, -a, c; 0, 0, 1/4); P -3 m 1 #164; P -3 #147; P -6 #174 (a+b, -a, c; 0, 0, 1/4); P 3 m 1 #156; P 3 1 2 #149 (a+b, -a, c; 0, 0, 1/4); P 3 2 1 #150; A m m 2 #38 (c, b, -2a-b; 0, 0, 1/4) |
| P 63/m m c | one | candidates | P -6 m 2 #187; P -3 m 1 #164; P -6 #174; P -3 #147; P 3 m 1 #156; P 3 2 1 #150; P 3 1 2 #149; mm2 (point group; index 6) (no number) | P -6 m 2 #187 (a+b, -a, c; 0, 0, 1/4); P -3 m 1 #164; P -3 #147; P -6 #174 (a+b, -a, c; 0, 0, 1/4); P 3 m 1 #156; P 3 1 2 #149 (a+b, -a, c; 0, 0, 1/4); P 3 2 1 #150; A m m 2 #38 (c, b, -2a-b; 0, 0, 1/4) |
| P n m a | all | candidates | P 1 21/m 1 #11; P 1 21 1 #4; P -1 #2; P 1 m 1 #6; P 21 21 21 #19; P n m 21 #31; P 21 m a #26; P 21/n 1 1 #14 | P 1 21/m 1 #11; P 1 21 1 #4; P -1 #2; P 1 m 1 #6 (a, b, c; 0, 1/4, 0); P 21 21 21 #19 (c, a, b; 0, 0, 1/4); P m n 21 #31 (b, a, -c; 1/4, 1/4, 0); P m c 21 #26 (b, c, a; 0, 1/4, 1/4); P 1 21/c 1 #14 (b, c, a; 0, 0, 0) |
| P n m a | third | candidates | P 1 21/m 1 #11; P 1 21 1 #4; P -1 #2; P 1 m 1 #6; P 21 21 21 #19; P n m 21 #31; P 21 m a #26; P 21/n 1 1 #14 | P 1 21/m 1 #11; P 1 21 1 #4; P -1 #2; P 1 m 1 #6 (a, b, c; 0, 1/4, 0); P 21 21 21 #19 (c, a, b; 0, 0, 1/4); P m n 21 #31 (b, a, -c; 1/4, 1/4, 0); P m c 21 #26 (b, c, a; 0, 1/4, 1/4); P 1 21/c 1 #14 (b, c, a; 0, 0, 0) |
| P n m a | one | candidates | P 1 21/m 1 #11; P 1 21 1 #4; P -1 #2; P 1 m 1 #6; P n m 21 #31; P 21 m a #26; P 1 1 21 #4; P 21 1 1 #4 | P 1 21/m 1 #11; P 1 21 1 #4; P -1 #2; P 1 m 1 #6 (a, b, c; 0, 1/4, 0); P m n 21 #31 (b, a, -c; 1/4, 1/4, 0); P m c 21 #26 (b, c, a; 0, 1/4, 1/4); P 1 21 1 #4 (a, -c, b; 1/4, 0, 0); P 1 21 1 #4 (b, -a, c; 0, 1/4, 1/4) |
| C m c m | all | candidates | P 2/m 1 1 #10; C m 2 m #38; P 2 1 1 #3; C 1 2 1 #5; P -1 #2; m (point group; index 4) (no number); P m 1 1 #6 | C 1 2/m 1 #12 (b, -a, c; 0, 0, 0); A m m 2 #38 (c, a, b; 0, 0, 1/4); C 1 2 1 #5 (b, -a, c; 0, 0, 0); C 1 2 1 #5 (a, b, c; 0, 0, 1/4); P -1 #2 ((a+b)/2, (a-b)/2, -c; 0, 0, 0); P 1 m 1 #6 ((a+b)/2, c, (a-b)/2; 0, 0, 1/4); C 1 m 1 #8 (b, -a, c; 0, 0, 0) |
| C m c m | all | decentred | P m c m #51; P m n m:1 #59; P m n n #58; P b n m #62; P m c n #62; P b c m #57; P b n n #52; P b c n #60 | P m m a #51 (c, a, b; 0, 0, 0); P m m n:2 #59 (c, a, b; 1/4, 1/4, 0); P n n m #58 (c, b, -a; 0, 0, 0); P n m a #62 (b, c, a; 0, 0, 0); P n m a #62 (c, a, b; 1/4, 1/4, 0); P b c m #57 (a, b, c; 1/4, 1/4, 0); P n n a #52 (b, c, a; 1/4, 1/4, 0); P b c n #60 |
| C m c m | third | candidates | P 2/m 1 1 #10; C m 2 m #38; P 2 1 1 #3; C 1 2 1 #5; P -1 #2; m (point group; index 4) (no number); P m 1 1 #6 | C 1 2/m 1 #12 (b, -a, c; 0, 0, 0); A m m 2 #38 (c, a, b; 0, 0, 1/4); C 1 2 1 #5 (b, -a, c; 0, 0, 0); C 1 2 1 #5 (a, b, c; 0, 0, 1/4); P -1 #2 ((a+b)/2, (a-b)/2, -c; 0, 0, 0); P 1 m 1 #6 ((a+b)/2, c, (a-b)/2; 0, 0, 1/4); C 1 m 1 #8 (b, -a, c; 0, 0, 0) |
| C m c m | third | decentred | P m c m #51; P m c n #62; P m n n #58; P m n m:1 #59 | P m m a #51 (c, a, b; 0, 0, 0); P n m a #62 (c, a, b; 1/4, 1/4, 0); P n n m #58 (c, b, -a; 0, 0, 0); P m m n:2 #59 (c, a, b; 1/4, 1/4, 0) |
| C m c m | one | candidates | P 2/m 1 1 #10; C m 2 m #38; P 2 1 1 #3; C 1 2 1 #5; P -1 #2; m (point group; index 4) (no number); P m 1 1 #6 | C 1 2/m 1 #12 (b, -a, c; 0, 0, 0); A m m 2 #38 (c, a, b; 0, 0, 1/4); C 1 2 1 #5 (b, -a, c; 0, 0, 0); C 1 2 1 #5 (a, b, c; 0, 0, 1/4); P -1 #2 ((a+b)/2, (a-b)/2, -c; 0, 0, 0); P 1 m 1 #6 ((a+b)/2, c, (a-b)/2; 0, 0, 1/4); C 1 m 1 #8 (b, -a, c; 0, 0, 0) |
| F d d d:2 | all | candidates | F 2 2 2 #22; 2/m (point group; index 2) (no number); 2/m (point group; index 2) (no number); 2 (point group; index 4) (no number); 2 (point group; index 4) (no number); F 1 2 1 #5; P -1 #2; F 1 d 1 #9 | F 2 2 2 #22 (c, a, b; 1/8, 1/8, 1/8); C 1 2/c 1 #15 (a, -c, (a+b)/2; 0, 0, 0); C 1 2/c 1 #15 (a, b, (a+c)/2; 0, 0, 0); C 1 2 1 #5 (a, c, (a-b)/2; 1/8, 1/8, 0); C 1 2 1 #5 (b, a, (b-c)/2; 0, 1/8, 1/8); C 1 2 1 #5 (a, -b, (a-c)/2; 1/8, 0, 1/8); P -1 #2 ((a+b)/2, (a+c)/2, (a-c)/2; 0, 0, 0); C 1 c 1 #9 (a, -c, (a+b)/2; 0, 0, 0) |

</details>

**Magnetic page labels.** "Γ1 … Γn" at every k → the engine's generic labels,
"irrep n of m" at the k the line names ("k = (1/2, 0, 0) irrep 2 of 4", "X
irrep 1 of 2", "irreps 3⊕4" for a complex pair).

**Snapshots and evals.** No deterministic snapshot or scripted eval changed:
the Agent snapshots (`model-text.arm-b.md`, `model-text.arm-c.md`), the frozen
report and agent-text goldens, and all 708 agent and MCP tests pass unchanged.
No tool description, skill or system-prompt text changed. The Agent reads
`review_symmetry`'s output only through a live run, and no scripted replay
pins its names. The magnetic tools read Route A, which did not change.

## What changes for users

- **Magnetic page, Representation analysis.** It works at every
  commensurate k. A non-abelian little group at k ≠ 0 decomposes instead of
  being refused, and a non-symmorphic zone boundary gets its true small
  representations instead of an approximation with a warning. A
  multidimensional irrep takes an order-parameter direction, and every
  direction names its magnetic group, type IV in its magnetic cell at k ≠ 0,
  with the candidate of the list in the same class. Labels are generic.
- **The group list** (Route A) is unchanged.

## What it means for the validation

This is the one exception to the freeze the owner approved (2026-10-31), and
only these changes are model-visible:

- `review_symmetry` (live tool and MCP): new names, the new `setting` field,
  one entry per class, allowed lines by family, and the reading's decentred
  names with their setting (table above). Its description, the skill and the
  system prompt are unchanged.
- The magnetic page's representation-analysis text and results, which the
  Agent does not read (its magnetic tools read Route A, unchanged).

Arm A's pinned results did not move: no snapshot, golden or scripted eval
changed. Arms B and C will see the new `review_symmetry` output in a live run
that reaches it.

**Live evals the owner may run** (not run here; paid):

- `symmetry-last`: the scenario that calls `review_symmetry`.
- The validation suite's runs that reach `review_symmetry` (arm B or C on a
  refined powder fit; `validation.test.ts` replays it).
- No magnetic eval needs a re-run for this change: `magnetic-structure`,
  `magnetic-step-first` and `magnetic-30k` read Route A, which did not change.

## Not done

- **CDML labels in the app**: not possible without unlicensed data (§3).
  The decision stays the owner's (plan Q16: ask BYU for permission to bundle
  ISO-IR's labels).
- **The powder satellite approximation** (§1): each family's |F_M|² is read
  at one member and multiplied by the family's size, so two domains of one
  magnetic group can fit differently (29.6 % against 0.31 % on the synthetic
  Mn₃Ga page). The step now models the listed domain in both frameworks, so
  nothing changed for users, but the calculation is approximate for any
  magnetic group below the parent's Laue symmetry. Summing |F_M⊥|² over every
  member of the family would fix it, and would move refined moments wherever
  the representative member is not typical. That is a change to validated
  magnetic fits: the owner's decision, and a separate issue.
- **The magnetic groups of a two-arm k**, from either route.
- **The symmetry-review skill** describes `candidates` without the new
  `setting` field (and still says lost centrings are not enumerated).
  Skills are model-visible and outside this exception, so the skill was not
  edited.
- **`review_symmetry`'s description** still says "domain counts" for
  `domains`, which is the number of orientations [G : N_G(H)]. It is
  unchanged, as in PR #119's note.
- **Readable settings.** `nameChild` sometimes picks an equivalent but busy
  basis, such as R-3c's R32 in (−a−b, a, c; 0, 0, ¼) rather than (a, b, c; 0,
  0, ¼), or P-1 in a reduced rhombohedral cell. The Subgroups page shows the
  same. A preference for the parent's own axes among equivalent settings
  would be an engine change.
- **The local data check.** There is no `data/` in this worktree, so the
  local data-gated magnetic benchmark was not run here.

## Checks

At the head of the PR: `npm run typecheck`, `npm run lint`, `npm run build`
and `npm test` (results in the PR). The browser check and the oracle runs are
above.

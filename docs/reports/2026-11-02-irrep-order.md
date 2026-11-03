# Irrep numbers the same on every runtime (THY-64)

The number in "X irrep n of m" and the Γ chip's Γn now come from one
documented total order of the irreps themselves
(`src/core/crystal/irreps/irrepOrder.ts`; ADR 0004). Before, they came from the
order the irreps were built in, and a rounding error could change that order.
SrTiO₃'s polar irrep was Γ9 under Node on a Mac and Γ10 in CI. This report
covers the root cause, the rule, the proof that it holds across runtimes, every
label that changes, and what the Agent sees differently.

## What changed, and why

### The root cause: two orders that followed the sign of a rounding error

1. **The Γ chip** (`pointGroupIrreps.ts`, used by `displaciveModes.ts` for a
   non-abelian point group). Irreps of one dimension were sorted by their
   characters, printed with `toFixed(4)`, joined in the input operations' order
   and compared with `localeCompare`. A character of 0 or 1 with a 1e-16
   error printed as "-0.0000" or as "0.0000", "1.0000,-0.0000" or
   "1.0000,0.0000", depending on the error's sign. The induction's Schur
   averages use a probe matrix built from `Math.sin` and `Math.cos`, and the
   p-th roots use `Math.atan2`, `cos`, `sin` and `**`. ECMAScript leaves all of
   these "implementation-approximated", so one engine can differ from another
   in the last bit. SrTiO₃'s two 3-dimensional odd irreps agree on every class
   where the strings first differ only by such signs, so the sign decided
   between them. `localeCompare` also depends on the ICU version and the
   locale. It was not the trigger here (Node 22 and 24 both ship ICU 78.3), but
   it is a second way the order can vary. The order also followed the input
   operation list ("from one operation list to another").
2. **The generic labels** (`complexIrrepsOfStar`). Irreps were ordered by
   dimension, then reality, then the order the chain induction
   (`projective.ts`) built them in. Where an irrep extends in p ways, the
   intertwiner U is normalised by a principal root of `(U^p)[0][0]`, and the p
   extensions are labelled by `nroot`. At Fd-3m's X point that value is
   −1 + 1.2·10⁻¹⁶ i, and `nroot(−1, 2)` rounds `angle·n/2π` = 0.5 exactly.
   Both sit on a branch cut, so the sign of a 1e-16 error, or one ulp of
   `atan2`, swaps the two extensions and their numbers. The construction was
   already independent of the operation list's order
   (`pointGroupElements`), so only a different libm could move it.

Map and Set iteration did not cause it: insertion order is specified and was
the same everywhere. Neither did sort stability, which has been stable since
ES2019, and the identity-first comparator ties only rotations that are not the
identity. The issue title pins it on Node 22 against Node 24, but that was a
confound. On this Mac, main gives Γ9 under both Node 22.23.4 and Node
24.16.0. The difference is between machines and engines (below).

### The rule (`irrepOrder.ts`)

1. dimension, smallest first;
2. reality: real, then pseudoreal, then complex;
3. the characters on a fixed list of elements, compared one element at a
   time: the larger real part first, then the larger imaginary part. Values
   within 1e-6 count as equal.

The list is the rotations W of the little co-group of the star's
representative arm, written as integer matrices in the conventional basis. The
identity comes first, then the proper rotations, then the improper ones, each
in row-major lexicographic order with the smaller entry first. Each rotation is
taken at its coset representative {W|w₀}, where w₀ is its smallest
translation, and the value read is the small representation's character there,
exp(2πi k·w₀)·χ_P(W). At Γ this is the point group's own character on each
rotation, so the Γ chip (`pointGroupIrreps`, `abelianIrreps`) and
"Γ irrep n of m" number alike: **Γn is "Γ irrep n of m"**, in all 230
groups. Inequivalent irreps have inequivalent small representations, so no two
compare equal, and `orderIrreps` throws if two ever do.

The numbers do not depend on the runtime, the order of the operation list, or
the supercell bound. They do depend on the setting and the arm, as any table's
numbers do.

Why "proper rotations first": it keeps an irrep and its partner of the other
parity next to each other, as the chain had them (the rotation subgroup, then
−1). Six orders of the list were tried and the change counted on SrTiO₃'s
and GaTa₄Se₈'s parents and the oracle's cases. This one keeps Pm-3m's Γ and R
numbers, all of GaTa₄Se₈'s Γ-chip numbers, and its X irrep 5 and W irrep 1:

| List order | Labels changed (of 350) | SrTiO₃ + GaTa₄Se₈ changed |
| --- | --- | --- |
| identity, then lexicographic | 197 | 39 (R and Γ move too) |
| **identity, proper, improper, each lexicographic** | **142** | **31** |
| the same, larger entry first | 198 | 41 |
| lexicographic, larger entry first | 240 | 48 |
| proper first, rotation order 6→2, then lexicographic | 159 | 37 |
| proper first, rotation order 2→6, then lexicographic | 138 | 29 (moves the GaTa₄Se₈ Γ chip) |

The last row changes fewer labels, but it moves the GaTa₄Se₈ demo's Γ chip
(Γ4 and Γ5 swap), which the Agent reads after a Γ activation. The second row
keeps it.

## Evidence

- **Cross-runtime golden** (`irrepOrder.test.ts`,
  `irrepLabels.golden.json`). Each label sits next to a fingerprint of its
  irrep: the characters keyed by element (rotation and translation), rounded
  to 1e-3 and hashed (`testSupport/irrepLabelFingerprints.ts`). The golden
  holds 53 cases and 387 labels: the ISOTROPY label oracle's 16 cases,
  SrTiO₃'s Pm-3m 2×2×2 stars, GaTa₄Se₈'s F-43m 1×1×2 and 2×2×2 stars, the Γ
  chip of one group in each of the 32 crystal classes, and SrTiO₃'s and
  GaTa₄Se₈'s displacive decompositions. It was written on macOS arm64 under
  Node 24.16.0, and the same test passes there, under Node 22.23.4, and in CI
  (Linux x64, Node 22).
- **In real browsers** (`scripts/irrep-labels-check.mjs`, which computes the
  same fingerprints in a page on the dev server):

  | Runtime | main: SrTiO₃'s Γ chip (silent, polar) | this branch |
  | --- | --- | --- |
  | Node 22.23.4 and 24.16.0, macOS arm64 | Γ7, Γ9 | Γ8, Γ10, all 387 labels = golden |
  | Linux CI, Node 22 (PR #143's report) | Γ10 for the polar irrep | = golden (CI) |
  | Google Chrome 156 (V8) | Γ7, Γ10 (P6/mmm's and Pm-3m's chips also differ from Node) | 387 = golden |
  | Playwright Chromium 149 | Γ7, Γ10 | 387 = golden |
  | Playwright WebKit 26.5 (JavaScriptCore, Safari's engine) | **Γ8**, Γ10 | 387 = golden |
  | Playwright Firefox 151 | did not launch here (timeout) | not checked |

  Chrome differs from Node on the same Mac: both run V8, but each is built
  with its own Math functions. On main the generic labels of the 19 star
  cases agreed across these runtimes and only the Γ chip differed. The
  one-ulp test below shows the generic labels could differ too.
- **A different libm, simulated**: every result of `sin`, `cos`, `tan`,
  `atan2`, `atan`, `acos`, `asin`, `exp`, `log`, `pow`, `cbrt`, `hypot` and
  `sqrt` is nudged by one ulp, up, down or not at all (seeded), and every
  label must stay. It holds on the branch-cut stars (Fd-3m X, Cmcm, P6₃/mmc
  A, P4₂/mnm Z), SrTiO₃'s and GaTa₄Se₈'s stars, and the 32 classes' Γ chips.
  On main the same test fails at the first seed (P6₃/mmc A). A wider sweep on
  main changed 12 to 32 of 627 generic labels and 94 to 121 of 1132 Γ-chip
  labels per seed. On the branch it changed 0 and 0 for every seed, also when
  `sqrt` and exact results (such as cos 0 = 1) are nudged.
- **The operation list shuffled** (two seeds): the same labels at every star
  of the 19 star cases, and on the Γ chip of all 230 groups in their
  reference settings. On main the Γ chip failed this at P2/m (abelianIrreps
  numbered its irreps by the generators it found first).
- **Γn = "Γ irrep n of m", and Γ1 is the trivial irrep**, in all 230 groups,
  checked character by character.
- **The strict test #143 loosened, restored** (`subgroupPicker.test.ts`).
  The Γ tree of SrTiO₃ is `["Γ8", "Γ10"]`, the polar irrep is `"Γ10"`, the
  row's "?" reads "(Γ irrep 10 of 10 is Γ10 in the activated modes'
  labels.)", and Activate gives "Γ10 → P 4 m m". These are literals, no
  longer `${branch.term.irrep.label}`.
- **ISOTROPY oracle on the branch** ([run 41578511400](https://github.com/drthyang/materia-platform/actions/runs/41578511400),
  every step): isotropy subgroups 13/13, mode amplitudes 3/3, irrep labels
  16/16. The log prints all 16 correspondences, and every renumbered generic
  label still stands for exactly one ISOTROPY irrep by character. The one
  `UNREAD` note (Fm-3m W: 1 of 40 characters that ISOTROPY prints as
  asterisks) is the same as on #143's run. The correspondence stays in the CI
  log (ADR 0005).

## What changes for users

Labels change. Old means main on macOS under Node (22 or 24); Linux and Chrome
gave other Γ-chip numbers, as above. "unchanged" means every label in the
case kept its number. In total, 191 of the 387 labels in the golden change.

**SrTiO₃ (Pm-3m, 2×2×2)**
- Γ (generic) and R: unchanged. R irrep 8 is still the a⁻a⁻a⁻ and a⁰a⁰c⁻
  tilt, and Γ irrep 10 still the polar irrep.
- M: 3 → 7, 4 → 8, 5 → 3, 6 → 4, 7 → 5, 8 → 6. The in-phase tilt
  (P4/mbm) is now **M irrep 3**, so a⁻b⁺a⁻ Pnma's first coupled pair,
  "M irrep 3 of 10 + R irrep 8 of 10", is now the two tilts (before, it was
  the other M irrep, and the tilts came second). The tie reads
  "M irrep 3 or 7", tag M·3/7+R·8.
- X: 3 → 7, 4 → 8, 5 → 3, 6 → 4, 7 → 5, 8 → 6.
- Γ chip: silent Γ7 → **Γ8**, polar Γ9 (Γ10 on Linux and in Chrome) →
  **Γ10**. A Γ activation's mode rows and History step read
  "Γ10 → P 4 m m".

**GaTa₄Se₈ (F-43m, 1×1×2 and 2×2×2)**
- Γ (generic): 4 → 5, 5 → 4. The Γ chip is unchanged: Γ3 (E), Γ4 (T₁), Γ5
  (T₂). Only the trivial irrep, never shown, goes from Γ2 to Γ1.
- X: 2 → 4, 3 → 2, 4 → 3. X irrep 5, which reaches P-42₁m, is unchanged.
- W: 2 → 4, 3 → 2, 4 → 3. W irrep 1 is unchanged.

**The ISOTROPY oracle's cases** (MATERIA's generic labels; the CDML
correspondence stays in the CI log, ADR 0005)
- Pm-3m Γ, Fm-3m Γ, Im-3m H, Pm-3m R, Fm-3m L: unchanged.
- Fm-3m X, Pm-3m X, Pm-3m M: 3 → 7, 4 → 8, 5 → 3, 6 → 4, 7 → 5, 8 → 6.
- I4/mmm M (k = (0, 0, 1)) and P4/mmm Z (k = (0, 0, ½)): the same
  permutation.
- Cmcm Y (k = (0, 1, 0)): 5 → 7, 6 → 8, 7 → 5, 8 → 6.
- F-43m X: 2 → 4, 3 → 2, 4 → 3.
- Fd-3m X: 1 ↔ 2, 3 ↔ 4.
- Fm-3m W: 2 → 3, 3 → 4, 4 → 2.
- P6₃/mmc A (k = (0, 0, ½)): 1 ↔ 2. On the magnetic page's Mn₃Ga, the
  truth's irrep is now irrep 1 of 3.
- P4₂/mnm Z: 1 ↔ 2, 3 ↔ 4.

**The Γ chip of the 32 crystal classes**: unchanged for #1, 2, 3, 6, 10 and
25. Every other class has some numbers moved (the full list is the diff of
irrepLabels.golden.json against main's numbering, in the PR). Γ1 is now always
the trivial irrep. Before, it was the trivial irrep only where `localeCompare`
happened to put it first: Pm-3m's trivial irrep was Γ4.

### Saved projects

A saved project keeps its labels as text in its mode rows (the mode set's
`parentName`, each mode's and row's `label`, `irrep.label`). It reopens as
saved, and nothing matches those strings against the irreps the page
computes now: the reopened row is found by subgroup name and cell, and an
activation matches a term against the same session's decomposition. A new
test (`pdfPage.test.ts`) saves a Γ activation, rewrites its label to another
Γ number as an older machine would have written it, and reopens it. The
label, every row's id, value and free state, and Rw come back as saved, and
the page's own tree still names the irrep by today's number. So no migration
is needed for loading. An old project shows the numbering of the machine that
saved it until the user activates again. This is stated in LIMITATIONS.md and
the CHANGELOG.

## What the Agent sees differently

The Agent computes no irreps. It reads labels the page made: `get_state`'s
parameter rows (`label`), the History steps (`history.recent[].label`) and
the page's messages. After this change:

- **After a Γ activation** on SrTiO₃: "Γ10 → P 4 m m" (polar) and
  "Γ8 → …" (silent), on every runtime. Before: Γ9 and Γ7 under Node on a
  Mac, Γ10 and Γ7 in Chrome, Γ10 and Γ8 in Safari. On the GaTa₄Se₈ demo:
  unchanged (Γ3, Γ4, Γ5). Other parents: the 32-class list above.
- **After a decentring activation** (GaTa₄Se₈ X): "X irrep 4 of 5 → …"
  where it read "X irrep 2 of 5", and so on as above. X irrep 5 is unchanged.
- **After a supercell activation or a decomposition by parent irrep**: mode
  rows "M irrep 3 of 10 · O" now name SrTiO₃'s in-phase tilt (it was
  "M irrep 5 of 10 · O"). The order-parameter line
  "(M irrep 3 of 10 + R irrep 8 of 10)" now names the two tilts. "carry the
  distortion" lists use the new numbers.
- No tool description, skill or snapshot (`model-text.arm-*.md`) changes. No
  eval scenario, replay or scripted eval contains an irrep label (checked by
  search; all pass unchanged).

## What it means for the validation

- **Arm A's pinned results**: none moved. No eval page activates a mode or
  decomposes against a parent.
- **Live evals to run**: none is required by this change, because no scenario
  reaches an irrep label. As a smoke check of the PDF page, where the labels
  live, `pdf-method`, `pdf-local-structure` and `pdf-local-geometry` could
  run. No paid eval was run.
- The validation has no scenario that reads irrep labels after a Γ or
  supercell activation. Such a scenario, for example "after Activate on
  SrTiO₃'s Pnma, name the irreps that drive it", would measure this surface;
  that is open.

## Not done, and open

- **Firefox** did not launch in this environment (Playwright Firefox 151,
  launch timeout), so SpiderMonkey was not checked. The golden test and
  `scripts/irrep-labels-check.mjs` will show it wherever it runs.
- **Γn can still read as a CDML label** (Γ4⁻). Writing the Γ chip as
  "Γ irrep n of m" in the mode rows, as the magnetic page did in THY-36,
  would follow ADR 0004 further. It would change every activated mode label
  again, so it is left to the owner.
- The row's "?" still says "(Γ irrep 10 of 10 is Γ10 in the activated modes'
  labels.)". It is now always the same number and could be dropped; it was
  left as it is to keep the Subgroups files out of this change.
- The order depends on the setting and the arm, as before. `canonicalArm`
  keeps the arm fixed where the bound would change it.

## Checks

At d2347aa: `npm run typecheck` and `npm run lint` clean; `npm test`: 387
files, 3406 tests passed, 315 skipped, 0 failed (macOS, Node 24.16.0).
`irrepOrder.test.ts` and `subgroupPicker.test.ts` also pass under Node
22.23.4. CI runs on the PR ([#154](https://github.com/drthyang/materia-platform/pull/154)).
`scripts/irrep-labels-check.mjs` passes in Chrome 156, Chromium 149 and
WebKit 26.5. The ISOTROPY oracle passed on the branch (above).

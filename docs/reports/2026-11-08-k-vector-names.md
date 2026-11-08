# k-vector names in the Bilbao convention, and a label-provider seam (THY-73)

Linear THY-73. The owner lifted the feature freeze for this issue on
2026-11-08 and chose, after step A, option 1 of
[ADR 0004](../adr/0004-generic-irrep-labels-in-the-app.md): the Bilbao
server's k-vector names now, irreps with generic numbers, built so that CDML
irrep labels can be plugged in later. ADR 0004 holds the licensing analysis,
the options and the permission request; ADR 0005 holds the rule for the
ISOTROPY check.

## What changed

- **k-vector names** (`src/core/crystal/irreps/kVectorNames.ts`). A star is
  named as KVEC names it, with CDML's labels in the conventional reciprocal
  basis of the ITA standard setting:
  - a point has its name: "A", "X";
  - a point on a line has the line's name and its canonical arm's
    coordinates: "Δ (0, 0, 1/2)".

  The table covers cP, cF, cI, tP, oP and hP, plus hR's T, L and F. It was
  written by hand from the Bradley & Cracknell / CDML convention. aP, mP,
  mC, oC, oF, oI, tI and the hR lines keep their coordinates.
- **Irrep labels**: "<k-vector name> irrep n of m", in THY-64's order, which
  does not change. The Γ chip keeps "Γn".
- **A label-provider seam** (`irrepLabels.ts`). Each irrep carries a
  fingerprint and its generic label. The label shown is the active
  provider's; the default provider is generic. A table provider matches by
  fingerprint and leaves the engine, the numbering and saved projects alone.
  No table ships, and a test proves the seam with a two-row fake table.
- **Where the names show**:
  - The Subgroups chips and rows. A tag writes "Δ(0,0,½)·2".
  - The 3D chips.
  - The magnetic page ("Γmag = … at A").
  - The Agent's tools. `list_subgroups`' k filter takes "Δ", "DT", the
    coordinates, or both.
  - Mode CIF tokens ("DT_irrep2of4").

## Where the reference values come from

The values in the tests were typed by hand. No Bilbao or ISOTROPY data file
is committed. Bilbao's programs (KVEC's listings, REPRES) answer scripts with
a Turnstile bot check, so they were not read; their static help pages were.

| Value | Source | Read |
| --- | --- | --- |
| KVEC uses CDML's labels and coefficients (Tables 3.9, 3.11); conventional coefficients for centred lattices; indexed labels only for equivalent representatives; holohedral labels kept in lower classes ("ex") | <https://www.cryst.ehu.eus/cryst/help/brillouin_zone_databases.html> | 2026-11-08 |
| P321 (No. 150): Δ is 0, 0, z between Γ (z = 0) and A (z = ½); KA is (2/3, −1/3, 0); T, TA, LD, M share a block, T and TA meeting at M; S, SA, Q, QA, L share one; R3 (No. 146): LD at primitive (¼, ¼, ¼) is (0, 0, ¾) on hexagonal axes; the 3-fold line's labels depend on the axial ratio; C12/m1's labels are A112/m's, transformed | <https://www.cryst.ehu.eus/cryst/help/examples_kvec.html> | 2026-11-08 |
| REPRES's irrep labels coincide with CDML's and ISOTROPY's | <https://www.cryst.ehu.eus/rep/repres.html> | 2026-11-08 |
| F-43m (GaTa₄Se₈): "Δ (0,0,½)", "Σ (0,½,½)"; fcc K (¾,¾,0) and U (¼,1,¼); P6₃/mmc (Mn₃Ga) A | the THY-73 issue | 2026-11-04 |
| Every other name in `kVectorNames.test.ts` | the Bradley & Cracknell / CDML convention, as written in the table | — |
| SrTiO₃, Sr at the origin: M irrep 3 (the in-phase tilt) is M2+, R irrep 8 (the antiphase tilt) is R5−; with Ti at the origin M3+ and R4+ | the ISOTROPY oracle's correspondence by character, runs [41578511400](https://github.com/drthyang/materia-platform/actions/runs/41578511400) (2026-11-03) and [42520923238](https://github.com/drthyang/materia-platform/actions/runs/42520923238) (2026-11-08); R4+ → R5− on moving the origin from B to A, Perez-Mato, Orobengoa & Aroyo (2010), *Acta Cryst.* A66, 558, footnote 9 | 2026-11-08 |

The SrTiO₃ correspondence is stated in USER_GUIDE as a note, not a table the
app ships.

## The ISOTROPY check

The opt-in `isotropy-oracle.yml` label step now also compares every name with
ISOTROPY's k-vector list for all 230 types. ISOTROPY lists one label per
k-vector type, so the check samples each of its points, its lines at a = 1/16,
and its planes. It is a check, not a source.

- **First run** ([42519260770](https://github.com/drthyang/materia-platform/actions/runs/42519260770)):
  1908 agree and 51 disagreements, all from three entries written from
  Bradley & Cracknell whose CDML labels differ: fcc Z (X–W), and orthorhombic
  E and P (U–R and T–R).
  - Those three were removed, not replaced from ISOTROPY.
  - fcc S (X–U) and bcc F (P–H), B&C lines ISOTROPY does not list, were
    withdrawn with them.
  - The rule that a line point is named only on a line of symmetry of the
    group was dropped. CDML and KVEC keep the holohedry's labels in every
    class (ISOTROPY lists Σ in P6, for instance), and THY-73 asks for Σ on
    F-43m.
- **Second and final runs** ([42519747305](https://github.com/drthyang/materia-platform/actions/runs/42519747305),
  [42520923238](https://github.com/drthyang/materia-platform/actions/runs/42520923238),
  every step): **2279 agree, 0 disagree**, and 1857 of ISOTROPY's
  k-vectors are left unnamed by design (the lattices above, planes, general
  points).
- **Unconfirmed** (ISOTROPY does not list them, since each shares a k-vector
  type with another): fcc K and U, hexagonal T, S, KA and HA. They stay as
  written, because Bilbao's help or the issue names them. They are to check
  by hand on KVEC.
- **Labels, by character**: 26 cases, all one to one, with each irrep's
  fingerprint printed beside ISOTROPY's label. The 10 new cases are F-43m W,
  Δ and Σ, P6₃/mmc Δ (1×1×4), P4/mmm X and A, Pnma X and Y, and P2₁/c Z and
  B. The isotropy-subgroup (13) and mode-amplitude (3) steps also pass. The
  correspondences stay in the CI log (ADR 0005).

## Old → new (model-visible)

Every star name that changes in the default 2×2×2 bound, over the 230 types
in their reference settings: 643 stars. Every one was "k = (…)" before. cP
and the decentring points (X of F, H of I) were named already and do not
change.

| Lattice (types) | Old → new |
| --- | --- |
| cF (11) | k = (0, 0, 1/2) → Δ (0, 0, 1/2); k = (0, 1/2, 1/2) → Σ (0, 1/2, 1/2) |
| cI (10) | k = (0, 0, 1/2) → Δ (0, 0, 1/2) |
| tP (49) | k = (0, 1/2, 0) → X; (1/2, 1/2, 0) → M; (0, 0, 1/2) → Z; (0, 1/2, 1/2) → R; (1/2, 1/2, 1/2) → A |
| oP (30) | k = (1/2, 0, 0) → X; (0, 1/2, 0) → Y; (0, 0, 1/2) → Z; (1/2, 1/2, 0) → S; (1/2, 0, 1/2) → U; (0, 1/2, 1/2) → T; (1/2, 1/2, 1/2) → R |
| hP (45) | k = (0, 0, 1/2) → A; (0, 1/2, 0) → M; (0, 1/2, 1/2) → L |
| hR (7) | k = (0, 0, 3/2) → T; (0, 1/2, −1/2) → L; (1/2, 1/2, 0) → F |

Irrep labels, tags and chips follow these names, for example:

- "k = (0, 0, 1/2) irrep 2 of 3" → "A irrep 2 of 3" (Mn₃Ga's magnetic step);
- "k = (0, 0, 1/2) irrep 1 of 4" → "Δ (0, 0, 1/2) irrep 1 of 4" (GaTa₄Se₈);
- the tag "(0,0,½)·1" → "Δ(0,0,½)·1";
- the mode CIF token "k_irrep1of4" → "DT_irrep1of4".

Re-baselined deliberately:

- `irrepLabels.golden.json`, labels only, every fingerprint unchanged:
  P6₃/mmc A, P4₂/mnm Z and P4/mmm Z, and GaTa₄Se₈ 1×1×2 and 2×2×2 (Δ, Σ).
- `magneticStep.test.ts` ("A irrep n of 3").
- `representationAnalysisLegacy.test.ts` (Pnma "X irrep n of 2").
- `demo-qa.mjs`'s chip "Δ (0, 0, 1/2), supercell".

Four images that show a chip were shot again from the production build,
the Copilot's by a scripted model (no model called):
`subgroups-tree.webp`, `subgroups-find.webp`, `modes-3d.webp` (README) and
`copilot-lowered.webp` (DEMO_SCRIPT's fallback).

No agent snapshot (`model-text.arm-b.md`, `model-text.arm-c.md`), scripted
replay or grader changed. The demo's labels do not change: "X irrep 5 of 5",
"W irrep 1 of 4", "R irrep 8 of 10" and "M irrep 3 or 7" are at points that
were named already.

## Saved projects

A project saved before this change opens as before. Its mode rows keep the
text they were saved with, such as "k = (0, 0, 1/2) irrep 2 of 4". The 3D
k-point chips name the star anew ("Δ (0, 0, 1/2)"), because they are worked
out from the parent group. Activate again to get the new labels everywhere.
LIMITATIONS says so.

## Checks

- **Typecheck, lint, build**: all pass.
- **Full suite**: 401 files pass and 35 are skipped (the opt-in and paid ones).
- **The local gate**: `src/agent` (graders, scripted replays, held-out,
  regrade) passes unchanged.
- **Browser** (`scripts/irrep-labels-check.mjs`, Chrome 157): 53 cases and
  387 labels as the golden.
- **Demo QA** (`scripts/demo-qa.mjs`, production build, three viewports):
  19 of 19 steps pass. The GaTa₄Se₈ 1×1×2 chips are Γ, X, Δ (0, 0, 1/2) and
  W.

## Paid evals the owner may run (not run here)

The Agent reads the new names in two places:

- `list_subgroups`: the rows' `irreps` and the k filter;
- the labels of the modes of a child at a newly named star.

`review_symmetry` carries no irrep labels. The magnetic tools read Route A,
whose output has no star names.

- **`pdf-lower-symmetry`** is the one scenario that reaches them. Its
  listing of GaTa₄Se₈'s 1×1×2 subgroups now reads "Δ(0,0,½) irrep n" where
  it read "(0,0,½) irrep n". The row it lowers to and the irreps it kicks
  ("X irrep 5", "W irrep 1") do not change.
  - Haiku 5.5 and Sonnet 5.5, 3 runs each.
  - About $1–2 at list price. The 2026-11-07 gate averaged about $0.08 a
    Sonnet run and $0.01 a Haiku run (AGENT_EVALS), and this scenario's
    listings are longer, so allow two to three times that.
- **No other scenario needs a re-run.**

## Open

- **CDML irrep labels** (option 3 of ADR 0004): the permission request is the
  owner's to send. With a permitted table, a provider plugs into
  `irrepLabels.ts`.
- **Names still to add**, once their CDML labels can be checked by hand on
  KVEC: aP, mP, mC, oC, oF, oI, tI, the hR lines, fcc X–W, and
  orthorhombic U–R and T–R.
- **Unconfirmed entries**: fcc K and U, and hexagonal T, S, KA and HA are to
  check by hand on KVEC.
- **The Γ chip's "Γn"** is outside the provider seam. A table provider would
  add one call in `displaciveModes.ts`.

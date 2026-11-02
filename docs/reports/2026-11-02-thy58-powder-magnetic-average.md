# A powder magnetic line sums |F_M⊥|² over every member of its family

Linear THY-58, found by the THY-36 builder ([Phase 5](./2026-11-01-subgroup-engine-phase-5.md),
PR #139). The owner approved the fix knowing it moves validated fits; the
re-check below found that no external-reference golden that runs here moved.

## What changed, and why

### 1. The powder average (the cause)

A powder sums the scattering of every reciprocal-lattice point at a given |Q|.
For a magnetic line that is

  I(line) = Σ_{Q ∈ family} |F_M⊥(Q)|²,  F_M⊥ = q̂ × (F_M × q̂),

over the members of the parent's Laue family that are satellites of the
model's arm (both ±k, every equivalent reflection; at k = 0 the whole family).

`magneticPowder.ts` (`unitMagneticIntensities`) and `obsCalc.ts` evaluated
|F_M|² at the family's first member and multiplied it by the number of arm
members. That is the powder intensity only when every member has the same
|F_M⊥|², which holds when the magnetic group keeps the parent's Laue
symmetry. A model built on the parent cell with a lower magnetic group (an
ordered moment direction, a lower magnetic point group) has members with
different projections q̂ × (F_M × q̂) and different phase sums. Which member
came first decided the pattern, so two domains of one group (the same
structure turned by a parent operation) fitted differently: on the synthetic
Mn₃Ga page (P6₃/mmc, k = (0, 0, ½)) the two P_c-3m1 domains fitted to wR
0.31 % and 29.6 %.

Now:

- `magneticSatellites` lists each family's members of the arm with the
  family (`members`; `multiplicity` is their number).
- `satelliteIntensities` (new `core/magnetic/powderAverage.ts`) sums
  |F_M⊥|² over them. The powder fit, the F_obs/F_calc decomposition and
  `magneticLines` (the magnetic tick row and the residual readings) all read
  it; `magneticLines` keeps its per-reflection meaning with the family mean.
- The domain-independence follows: a domain g·D has |F_M⊥|² at g·Q equal to
  D's at Q, and the family is closed under g.

### 2. A satellite family the list missed

The domain test found a second, older fault. For a k that every Laue rotation
carries to ±k, the enumerator formed only the ±k satellites of each parent
representative r, on the argument that R⁻¹ of a satellite R·r ± k is r ± k.
It applied that whenever R·k ≡ ±k **modulo ℤ³**. When the congruence needs a
lattice vector n (the L point of a cubic cell: (½,½,½) → (−½,½,½) = k −
(1, 0, 0)), R⁻¹ of the satellite is (r + n) ± k, a satellite of another
parent node, and whole families were never visited. MnO at the arm
(½, −½, ½) lost the line at d = 1.71 Å (the brute force has 829.9, the list
586.7: one of its two families). The shortcut is now taken only for a k every
rotation carries to exactly ±k; any other k expands every parent family, as
an off-axis k already did. For MnO's own arm (½, ½, ½) the list happened to be
complete, so MnO's own-arm results did not move.

### 3. Cost

`magneticStructureFactor` did the moment expansion (every operation, the
orbit's duplicate check, the rotated moments, the centring phases, the
rotated tensors) for every reflection. `magneticStructureFactorEvaluator`
does it once per model and leaves each reflection its own parts: q̂ (formed
once), 1/d² from the reciprocal tensor (formed once), the phase, ⟨j0⟩ and the
Debye–Waller factor, accumulated in scalars. The arithmetic is the same
operation for operation, so the result is bit-identical: checked with `toBe`
against the previous function on 63 models (the Mn₃Ga 350 K and 30 K mCIFs and
every group at five k on the Mn₃Ga parent, sine amplitudes included) × 2186
indices each. `magneticStructureFactor` is the evaluator called once, so the
single-crystal and GPU-validation paths are unchanged.

| Run (alone, same machine) | `main` | this branch |
| --- | --- | --- |
| Mn₃Ga 350 K multi-start golden (2 tests) | 34.8 s | 34.2 s |
| Mn₃Ga 350 K staged moment fit | 6.7 s | 6.6 s |

Summing every member with the per-reflection work as it was (q̂ normalised per
image, the reciprocal tensor inverted per reflection) took 48.8 s on the
multi-start golden.

### 4. The magnetic PDF

Not affected. The mPDF sums spin pairs of the explicit spin box in real space
(`core/magnetic/mpdf.ts`, A_ij and B_ij of each pair), which is rotation
invariant and reads no satellite or family; no mPDF code changed. A new check
confirms it: every orientation of P_c-3m1 on Mn₃Ga (24) and of C_c2/c on MnO
(48, four arms) gives the same f(r) to 10⁻⁹ of its peak.

## Evidence

All on public or synthetic structures (`core/magnetic/powderAverage.test.ts`).
The domain construction is checked reflection by reflection first:
|F_M⊥|² of g·D at g·Q equals D's at Q.

| Proof | Mn₃Ga P_c-3m1, k = (0, 0, ½) | Mn₃Ga Cmcm, k = 0 | MnO C_c2/c, k = L | Mn₃Ga, k = (⅕, 0, 0), two-arm |
| --- | --- | --- | --- | --- |
| Lines with intensity (1–30 Å) | 33 | 34 | 10 | 136 |
| Every orientation domain gives the same lines: worst relative difference | 1.1·10⁻¹⁴ (24 orientations) | 3.5·10⁻¹⁴ (24) | 3.9·10⁻¹⁶ (48, four arms) | 1.4·10⁻¹⁴ (24, three arms) |
| The one-member reading over the same orientations | 4 different patterns | 3 | 19 | 6 |
| Brute force over every Q of the explicit magnetic supercell (`expandSpinField`: its own spins, Q list, phase sum and projection): worst relative difference per d | 2.6·10⁻¹⁴ | 1.2·10⁻¹³ | 1.4·10⁻¹⁵ | 4.0·10⁻¹⁴ |
| The same brute force against the one-member reading | 97 % | 100 % | lines missing | 85 % |

- **A cubic ferromagnet** (bcc Fe, I4/mm′m′, M ∥ c): every family's sum is
  ⅔·n·|F_M|², the textbook powder factor ⟨1 − (q̂·m̂)²⟩ = ⅔, to 10⁻⁹. The
  one-member reading gave 1 or 0 instead of ⅔ (239.8 against 319.7 on one
  line).
- **The issue's case, end to end** (`app/magneticStep.test.ts`): the two
  P_c-3m1 domains of the lattice, each built by the page's `buildFor` and
  fitted by the page's moment fit on the synthetic Mn₃Ga page. Before: wR
  0.307 % (2.49995 µB) and 29.617 % (0.712 µB). After: **0.289 % and 0.289 %**
  (2.49978 µB both; equal to 10⁻⁹), and their magnetic curves agree to 10⁻⁹ of
  the peak. The page's synthetic data are simulated with the forward model,
  so they changed too; 0.289 % is the noise of the new data at the truth.
- **The proofs fail on `main`**: run there with the one-member reading, the
  brute force misses by 85–100 % on three cases and loses two of MnO's lines
  (their first members have no |F_M⊥|²), the ferromagnet misses by the factor
  above, and in the end-to-end test the two domains' magnetic curves differ by
  up to 6.6·10⁶ counts.

## Golden and validated fits, before and after

Every magnetic golden and validated fit that runs without the git-ignored
`data/` folder, on `main` (7ece7a8) and on this branch:

| Golden | Reference | Before | After | Against the reference |
| --- | --- | --- | --- | --- |
| Mn₃Ga 350 K staged moment fit, published POWGEN data (`mn3ga350KGolden`) | GSAS-II refinement (Cm′cm′; moments of its last cycle) | wR 8.3282130 %; zero 8.7724 %; golden-held 8.3429 %; Mn1_0 (1.7032670, −0.5890952, 0), \|M\| 1.8023; Mn1_1 (0, 2.1880320, 0) µB | wR 8.3282129 %; zero 8.7724 %; golden-held 8.3429 %; Mn1_0 (1.7032670, −0.5890952, 0), \|M\| 1.8023; Mn1_1 (0, 2.1880320, 0) µB | equal (≤ 2·10⁻⁸ relative, the fit's own tolerance). The structure is read in its own magnetic group (16 operations), so every family is one of Cm′cm′'s and its members were already equal |
| Mn₃Ga 350 K multi-start (`magneticMultiStartGolden`) | GSAS-II's moment topology | best χ² 8.130·10⁴, 21/21 starts within 1 %, \|m0\| 2.05, \|m1\| 1.71 µB | the same | equal, as above |
| Mn₃Ga 350 K \|F_M\|² per reflection (82, `mn3ga350KGolden`, data-gated) | GSAS-II Fcsq | — | — | not run here (no `data/`); unaffected by construction: the per-reflection \|F_M\|² is bit-identical |
| Mn₃Ga 30 K, Example 3 (`k0MagneticBias`, `strongMagneticPeaks`), simulated from GSAS-II's P2₁′/m′ 30 K refinement | GSAS-II moments 2.527 / 2.829 / 2.530 µB | guarded \|M\| 2.271497 / 2.805646 / 2.360601; method 0.818823 / 1.842072 / 1.787419; z vs truth −0.81 … 0.66 | the same to 10⁻¹¹; z identical | equal (P2₁/m nuclear model; P2₁′/m′ keeps its Laue class) |
| `magnetic-30k` page ranking (same data, k = 0, the unrefined page) | truth G4 P2₁′/m′ | ★ G4, wR 5.24 % | ★ G4, wR 5.24 % | the truth unchanged. Groups below 2/m move: P1 5.64 → 5.42 %, P-1 5.68 → 5.44 %, P-1′ 12.27 → 12.37 %, Pm′ and Pm moments |
| MnO mPDF against diffpy.mpdf (`mnoGolden`, `mpdfGolden`), Mn₃Sn mPDF goldens | diffpy.mpdf | pass | pass, unchanged | equal: no mPDF code changed |
| MnO names against FindSpinGroup, the magnetic-group and representation-analysis oracles (spglib, ISOTROPY) | FindSpinGroup, spglib | pass | pass, unchanged | equal: group enumeration untouched |
| Scale equivalence, parent + k against the explicit supercell | itself | mag/nuc 0.201841 | 0.201841 | equal |

**Not run here** (they read `data/`, which this worktree does not have; per
the brief, unpublished data were not read from elsewhere):

- **DyMn₆Ge₆ against FullProf** (`dymn6ge6K.test.ts`, refined γ = 0.1648(7)
  vs 0.16509(43)). The helix is written on explicit atoms under the identity,
  over the P6/mmm parent's families, so it is the one data-gated golden that
  could move. Its moments depend only on each atom's layer, which predicts
  equal members, but it must be run.
- **FeCoSn 1.7 K against GSAS-II** (`fecosn1p7KGolden.test.ts`): read in its
  own group P_c6/mcc, so predicted unchanged.
- **AWO₄** (`realAwo4Magnetic`, `realAwo4Benchmark`, `examples/awo4Magnetic`):
  P_a2/c keeps the P2/c parent's Laue class 2/m, so predicted unchanged.
- **The diffpy.mpdf tutorial data** (`mpdfTutorialData.test.ts`): mPDF,
  unchanged by construction.

To run them where `data/` is:
`MATERIA_DATA_DIR=<checkout>/data npx vitest run src/core/workflow/dymn6ge6K.test.ts src/core/workflow/fecosn1p7KGolden.test.ts src/core/workflow/mn3ga350KGolden.test.ts src/core/workflow/realAwo4Magnetic.test.ts src/core/workflow/realAwo4Benchmark.test.ts src/examples/awo4Magnetic.test.ts src/core/workflow/mpdfTutorialData.test.ts`.

No golden was re-baselined: none that ran moved.

## What changes for users

- **Wherever the magnetic group is below the parent's Laue class** (a model
  built on the parent cell, the usual case on the magnetic page), the
  calculated magnetic pattern, the moments fit, the ranking of groups and the
  F_obs/F_calc points change: they are now the powder average. Every domain of
  a group fits alike.
- A structure read in its own magnetic group (an mCIF in its magnetic cell)
  does not change.
- Magnetic ticks: a line whose first member has no |F_M⊥|² but whose family
  scatters now has its tick and counts in the residual readings.
- For a k that the rotations carry to ±k only up to a lattice vector (L-type
  points of cubic cells), the position ticks and lines include the families
  the list had missed.

### Old → new, model-visible (the Agent and MCP)

No tool description, skill or system-prompt text changed, and no committed
snapshot or scripted eval moved: the Agent snapshots
(`model-text.arm-b.md`, `model-text.arm-c.md`), the frozen report and
agent-text goldens and the scripted evals pass unchanged. The tools' numbers
change on any magnetic model below the parent's Laue class. On the synthetic
Mn₃Ga page the evals use (its data are simulated from the forward model, so
they changed too):

| Output | Before | After |
| --- | --- | --- |
| `rank_magnetic_groups` at k = (0, 0, ½): G1 P_c-3m1 | wR 0.31 %, Mn1 2.5 µB | wR 0.29 %, Mn1 2.5 µB |
| G3 P_c-6m2 | wR 27.17 %, Mn1#2 1.5 µB | wR 0.29 %, Mn1#2 3.54 µB |
| G4 P_c-6c2 | wR 30.01 % | wR 42.55 % |
| G2 P_c-3c1 | wR 30.31 % | wR 42.55 % |
| ★ (`best`), `withinNoise` | G1; [G1] | **G3; [G3, G1]** |
| reading | "G1 fits best, beyond the noise of every other group … choose G1 unless the data say otherwise." | "2 groups fit within the noise of the best (G3, G1: …), and G3 is the maximal one with the fewest moment parameters among them … choose G3 unless the data say otherwise." |
| `nuclearOnlyWR` | 34.18 % | 46.02 % |
| `refine_moments` on G1 | "Moments fitted: wR 0.31%." | "Moments fitted: wR 0.29%." |
| `magnetic_state` residual peaks | 9 used by the k-search (strongest 1230σ at 2.479 Å) | 11 used (strongest 1960σ at 4.127 Å) |
| `diagnose_fit` on the nuclear-only page | Rwp 34.18 %, GoF 115; "structure" ~63 % of χ² | Rwp 46.02 %, GoF 165; "intensity-falloff" ~7 % of χ² |

**Why G3 ties G1.** With every member summed, P_c-6m2 with 3.54 µB (√2 ×
2.5) on half the Mn and none on the others gives P_c-3m1's pattern to 4·10⁻¹⁴
on every line: a powder cannot tell them apart. The one-member reading had
told them apart only because it read G1's families at members unlike their
average (its line at 4.14 Å read 419 against the true 2935). Both are maximal
with one moment parameter, so `rankWithinNoise`'s top-down order ties them,
and its last key (wR) is equal to the last digits: the ★ falls on G3. Same for
G2 and G4. The two tests that pinned ★ = G1 (`agent/magneticTools.test.ts`)
now pin the tie: both within the noise, ★ one of them, one wR.

The MCP profile test's non-vacuity check (a cosine background must move the
pattern by more than 1 % of its peak) fell to 0.96 % with the new magnetic
intensities; its bound is now 0.1 %, still 10⁶ times the 10⁻⁹ the curves must
agree to.

## What it means for the validation

- Arm A's pinned results did not move.
- Live evals that should be re-run (paid, not run here):
  - **`magnetic-structure`**: its check `magneticGroupIs("G1")` accepts only
    G1, while the ranking now ties G1 with G3 and the ★ names G3. A model
    that follows the ★ fails the check although the data cannot tell the two
    apart (the check's own comment says a group the ranking ties with it
    should count). The owner's decision, below.
  - **`magnetic-step-first`**: same page, new numbers.
  - **`magnetic-30k`**: the ★ is unchanged, but the lower groups' fits moved.
  - **`awo4-user-flow`** (local data): predicted unchanged.
  - Any validation run of arms B or C that reaches the magnetic step.

## Not done

- **Decision for the owner: an exact powder tie in the ranking.** The ★
  between G1 and G3 on the synthetic page is decided by the last digits of
  wR. Options: (a) leave it, and widen `magneticGroupIs` to the groups the
  ranking ties with the truth, as its comment says; (b) a tie-break for
  patterns equal to rounding, by the list's order (G1 first) or by physics
  (prefer the group that puts a moment on every ion the parent makes
  equivalent, i.e. no symmetry-forced zero); (c) a synthetic truth the powder
  can identify. The branch does none of them; the tests pin the tie.
- **The data-gated goldens** listed above, DyMn₆Ge₆ first.
- **Single crystal** is unaffected and still models one domain: a crystal with
  several domains needs their populations (LIMITATIONS, "Not yet").

## Checks

At the PR's head: `npm run typecheck`, `npm run lint`, `npm run build` and
`npm test` (counts in the PR). A browser check on the bundled Mn₃Ga POWGEN
demo (published data; dev server from the branch, headless Chrome through
playwright-core) passed 5/5 with no page errors: at k = (0, 0, ½) the ranking
finishes (the 600 K data are paramagnetic, and the page says no candidate
improves on the nuclear fit), P_c-3m1 from the list and from irrep 2 along
(a,a) fit to the same wR (4.0 %).

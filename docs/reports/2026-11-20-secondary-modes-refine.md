# Free mode rows at 0 refine: the engine's shift cap, and an ADP switch that rewrote the rows

The owner's report (PDF page, 0.5.0): after activating a supercell subgroup of
the bundled GaTa₄Se₈ demo (P-42₁m in 1×1×2, 44 modes), the 25 secondary modes
never refined although the page showed 44/44 free. Two Refines ended
"converged after 6 iterations" and "stalled after 1 iteration", Rw 10.17 %,
with every secondary mode between 1e-11 and 1e-28 Å.

The rows were free and the forward model used them. The refinement engine kept
them at 0, in two ways, and the page supplied the condition for one of them.
Only the bundled public demo and synthetic SrTiO₃ were used here; the owner's
project file (the same public data) was opened to compare before and after
and is not in the repository.

## The cause

`limitShift` (`src/core/refinement/engine.ts`) caps each cycle's shift at 5×
the parameter's magnitude, "a safety net against a single ill-conditioned
step". For a parameter at 0 it set no cap and relied on the step-rejection
loop. "At 0" was `value === 0`.

1. **A row at round-off is not at 0.** A value of 1e-15 gave a cap of 5e-15:
   the row could grow sixfold per cycle at most. In the owner's project the
   secondary rows held 4e-15 … 4e-32 Å in size (see item 3); six cycles later they
   were at 1.2e-10 … 8e-28 (each cycle multiplied a row by 6 or by −4, the
   capped step either way), the order parameter had converged, χ² changed by
   less than 1e-4 and the fit was called converged.
   The next Refine could not move them either and found no downhill step:
   "stalled after 1 iteration".
2. **A row at exactly 0 beside a small order parameter stalls the fit at
   once.** On the same demo without the round-off (Activate, Free all,
   Refine, window 2.06–6.78 Å) Refine answers "stalled after 1 iteration" and
   nothing moves, every time. A secondary mode's column is first order in the
   order parameter, which the activation has just kicked to 0.05 Å in all
   (0.005–0.016 Å per mode over 19 modes): column norms 2.5e-4 to 1e-2 against
   1.4–4.4 for the Γ irrep 1 modes. The engine scales every column to a unit
   diagonal, so the solve proposes shifts of ångströms for these rows, far
   outside the range their columns describe (about the kick itself). They
   were unlimited, the loop's damping stops at 1.4e4 after 15 trials, and all
   15 were uphill. Moving one secondary mode to 0.2 Å by hand (Rw 11.8 →
   23.5 %) and pressing Refine gives the same: "stalled · 1 cycle", the mode
   still at 0.2.
3. **Where the round-off came from.** `withSpecChange` (`src/app/pdfPage.ts`)
   re-seeded the position rows from the realised geometry on every change of
   the spec, also when the position rows were the same before and after. The
   owner switched the ADP model twice after the activation (History:
   "Anisotropic ADPs", "Isotropic ADPs"); each switch solved a 44×44 system
   for the mode rows and left round-off in the ones at 0. The same code put
   the free choice of every row at 0 back to the spec's default (fixed), and
   freed every row with a value.

Not the cause, each checked: the rows and bindings (44 free, all bound);
`withDistortionModes`; the own-cell child's fit structure; the worker pool's
shards (pooled and serial evaluations and analytic columns agree on this
project: in node with 2 and 6 shards, and in a browser with 6 workers); the
analytic columns (they agree with central differences); the dead-column
guard (no column was dead); the pair list. The "25 near-null directions" of
both results are the data's rank, not the 25 modes: 69 free parameters on a
window that holds about 41 independent points (Qmax·Δr/π = 27 × 4.72 / π).

## What changed, and why

- **A parameter numerically at zero** (`NUMERICALLY_ZERO`, `zeroShiftCaps` in
  `engine.ts`). A free parameter is at zero when its whole value moves the
  weighted calculated pattern by no more than a part per million of the
  pattern's norm, to first order: |p|·‖J_p‖ ≤ 1e-6·‖√w·y_calc‖. The measure
  has the pattern's units whatever the parameter's: a scale factor of 1e-11
  that carries the pattern is not at zero, a 1e-10 Å shift is. Answers 1.
- **The step-rejection loop reaches the rows at zero** (the same function, and
  the loop's call of `limitShift`). The first trial of a cycle is as before:
  a parameter at zero is unlimited. Once a trial is rejected, a non-linear
  parameter at zero is capped at 5× the r.m.s. magnitude of the free
  parameters of its kind that are not at zero (the same unit, the same sort
  of motion), and at a third of the last cap on each further rejected trial,
  while the damping grows as before. With no such parameter (every position
  at 0 in a first cycle) there is no cap, as before; a linear parameter needs
  none. Answers 2. A cycle whose first trial is accepted is unchanged, and so
  is every parameter not at zero.
- **The same position rows carry by id** (`withSpecChange` in `pdfPage.ts`).
  When the position parameterization is the same before and after (the ADP
  model, the spin model or a site total changed), the position rows keep
  their value and free choice by id, as every other row does. Another
  parameterization (atomic ↔ modes, a parent CIF) is re-seeded as before.
  Answers 3.
- `docs/REFINEMENT_ENGINE.md`: the paragraph on bounds and the shift cap.

A cap from the first trial on (at 1× the kind's magnitude) was tried and not
kept: it changed the one-fit result of Example 3 (wR 4.79 → 4.56 %, the fit
then reaches the true minimum where today it stops in the shallow one the
restarts exist for), which two tests and docs/AGENT_EXAMPLES.md pin. The
variant kept moves no pinned result.

## Evidence

**Tests that fail on main** (8 of the 11 below fail there, for the reasons
given; all pass here).

- `src/core/refinement/engineNearZero.test.ts`. A displacement that starts at
  1e-15, −3e-15, 2.6e-11 or 4e-32 refines to its value (0.3) in as many
  cycles as from exactly 0; main ends "converged" with it at 1.3e-12. A value
  under an explicit `maxShift` is still limited at zero. A tiny value that
  carries the pattern (1e-11) is still capped at 5× per cycle.
- `src/app/pdfSecondaryModes.test.ts`, the bundled demo through the page's
  own path (`pdfFit`, the Refine button's), P-42₁m 1×1×2 activated as the
  Subgroups view does it, window 2.06–6.78 Å:

  | | main | here |
  | --- | --- | --- |
  | Every mode freed at the kick, Refine | stalled after 1 iteration, Rw 11.81 → 11.81 %, 0 of 25 secondary modes moved | 30 iterations, Rw 11.81 → 8.24 %, 21 of 25 beyond 0.01 Å |
  | One secondary mode (Γ irrep 1 · Ta1) moved by +0.2 Å, Refine | stalled after 1 iteration, Rw 23.46 %, the mode still at 0.2 | Rw 18.84 → 8.17 % (8.24 % before the move), the mode back within 0.06 Å |
  | A change of the ADP model | 43 of 44 mode rows rewritten (round-off, free choices reset) | the 44 rows unchanged, both ways |
  | A project saved with round-off in the secondary rows, reopened, modes freed, Refine | converged after 9 iterations, Rw 10.25 → 10.24 %, largest secondary mode 2.5e-7 Å | 30 iterations, Rw 10.27 → 8.52 %, 20 of 25 beyond 0.01 Å |

- `src/app/pdfSecondaryModesTruth.test.ts`, a known answer. Cubic SrTiO₃
  against the G(r) of an a⁻b⁺a⁻ tilt (Pnma) in which Sr and both oxygens are
  also moved inside their site symmetry: seven modes, five secondary, none
  zero. The truth is built without the mode basis (the tilt geometrically,
  the displacements along each site's allowed directions) and its G(r) summed
  over its 20 atoms one by one, neutron, 1.5–12 Å, noise 0.4 % of the peak
  (seed 12345). The page starts from the parent: the child activated, the
  secondary modes at 0, every mode, the cell, the ADPs and the scale free.

  | Mode | Known (Å) | Refined (Å) | Δ / esd |
  | --- | --- | --- | --- |
  | M irrep 3 of 10 · O (order parameter) | −0.3203 | −0.3251 ± 0.0018 | −2.71 |
  | R irrep 8 of 10 · O (order parameter) | 0.6092 | 0.6064 ± 0.0012 | −2.36 |
  | X irrep 10 of 10 · Sr | 0.0884 | 0.0827 ± 0.0023 | −2.43 |
  | X irrep 10 of 10 · O | 0.0442 | 0.0464 ± 0.0044 | 0.50 |
  | M irrep 7 of 10 · O | 0.0773 | 0.0748 ± 0.0036 | −0.71 |
  | R irrep 10 of 10 · Sr | −0.0552 | −0.0619 ± 0.0036 | −1.86 |
  | R irrep 10 of 10 · O | −0.1562 | −0.1627 ± 0.0032 | −2.04 |

  Rw 0.964 % against a noise of 0.993 %. Every amplitude is within 3 esd; the
  test asserts that. This seed sits on the high side: with seeds 1–6 the 42
  ratios lie between −2.06 and 2.07 with no common sign. A secondary mode
  moved by +0.1 Å is pulled back to the same value (within 0.1 esd), and the
  same answer comes from secondary rows started at ±1e-15 Å. On main the
  fit from the kick lands on the other side of 0 (M irrep 3 off by 0.645 Å),
  and the round-off start with it.

**The same defect elsewhere** (bundled demo, 2.06–6.78 Å, every mode freed at
the kick, one Refine; main → here):

| Route | main | here |
| --- | --- | --- |
| Supercell 1×1×2, P-42₁m, 44 modes | stalled after 1, 11.81 % | 8.24 % |
| The same, anisotropic, every U free too (141 free) | stalled after 1, 11.81 % | 7.20 % |
| The same after an ADP switch, B free too (69 free) | 4.17 % (the round-off rows growing sixfold per cycle), 12 of 25 moved | 0.92 %, 22 of 25 |
| Same cell, P-42₁m (22 modes, one kicked) | 8.19 % | 8.18 % |
| By irrep, X irrep 1 → P-43m (9 modes) | 8.49 % | 9.22 % |
| t-subgroup F23 (3 modes) | 11.57 % | 11.57 % |
| Supercell 2×2×2, F-43c (12 modes) | 9.27 % | 9.00 % |

The stall needs a small kick shared by many modes and a narrow window; with
one kicked mode, or on the demo's own 1.5–28 Å window, main refines too
(Free all, Refine on the live site: converged after 24 cycles, Rw 7.52 %;
here 17 cycles, 7.51 %). The By-irrep row is a fit with several minima: the
two engines end in different ones, both stable under further Refines.

- **Rietveld page.** It has no distortion-mode rows; the engine is shared, so
  a core-level Rietveld problem with modes at 0 gets the same loop.
- **Prefit, Escape min.** They restart the same engine. Here, on the modes
  freed at the kick: Prefit best of 9 starts, Rw 4.51 %, 25 of 25 secondary
  modes moved; Escape min after it 1.09 % (not run on main).
- **Posterior.** The sampler does not use the shift cap and has the mode rows
  among its free ids. After a fit it starts each row from its esd (see "Not
  done" for a start with no fit).
- **The Copilot's `refine`.** It refuses this free set before fitting, on
  main and here: "the free set holds parameters the data cannot separate …
  Correlated at the current values (|ρ| ≥ 0.95): cell_a ↔ cell_c 0.992. Not
  determined by the data at all, together: mode_13, mode_2". With a free set
  it accepts it runs the page's fit, so the engine change applies.
- **A reopened project.** The fourth row of the first table.

**In a browser** (Playwright, Chromium, 6 workers; `vite preview` of this
branch against the live site, which runs main's engine). The bundled demo
saved as a project on the 2.06–6.78 Å window, then Refine, Subgroups, 1×1×2,
Find P-42_1m, Activate, 3D Model, Free all (44/44 free), Refine:

| | live site | this branch |
| --- | --- | --- |
| Refine, every mode free | stalled · 1 cycle, Rw 11.81 %, modes 20–44 all 0 | 30 cycles, Rw 8.22 %, 25 of 25 moved |
| Mode 20 typed to +0.2 Å, Refine | Rw 23.46 %, stalled · 1 cycle, still 0.2 | Rw 18.82 → 8.12 %, converged · 22 cycles, 0.058 |
| The owner's project, Refine three times | stalled · 1 cycle each, Rw 10.17 %, modes 20–44 all 0 | Rw 2.37, 1.93, 1.83 %; 24 or 25 of 25 beyond 0.001 Å |

Screenshots and logs: `~/.local/share/materia-review/2026-11-20/modes/browser/`.

## What changes for users

- Mode rows freed at 0 refine: Free all followed by Refine no longer ends
  "stalled · 1 cycle" with nothing moved, and a project saved by 0.5.0 or
  0.5.1 with round-off in those rows refines when reopened.
- Switching the ADP model keeps the position rows as they are, value and
  free choice. Before, a row at 0 the user had freed went back to fixed, and
  a row with a value the user had fixed became free.
- Any fit with a free non-linear parameter at zero beside non-zero ones of its
  kind can take another path after a rejected trial. No pinned result moved.
  Not pinned, and different: the demo script's optional "Refine the child"
  (order parameter only, 1.5–28 Å) ends at Rw 8.012 % where main gives
  8.009 % (largest mode difference 0.008 Å, both "converged after 18"); the
  By-irrep row above.

## What it means for the validation

No golden, snapshot, eval replay or worked example moved: every test of main
passes unchanged, the eval pages and the MCP examples among them.
The 35 test files that need the local data folder did not run in this clone
(see "Not done").

## Not done

- **The owner's fit is under-determined, and the page does not say so in
  words.** 69 free parameters on a window of about 41 independent points:
  Rw 1.8 % there is a fit of noise, GoF reads 0.02 (unit weights) and four B
  rows sit on 0. The page shows "⚠ SVD null direction · high correlation · at
  bound"; the Copilot's `refine` refuses the set. A line on the page such as
  "69 free parameters, about 41 independent points in this window: fix rows
  or widen the window" would say it. Not in this change.
- **✕ clear after an ADP switch gives the parent the CIF's ADPs, and old ADP
  seeds reach a later child.** In the owner's History the P-43m child fits
  at 6.30 %; "Back to F-43m" then shows 47.01 % (B 0.22–0.32 Å², the CIF's,
  not the demo's 0.56–0.84), and the P-42₁m child activated from there starts
  at 25.55 % with half its sites at the earlier child's ADP seeds (labels
  Ga1a, Ga1b, … coincide) and half at the CIF's. That is why the child's
  fit (10.2 %) looked worse than the "parent's" 6.3 %, which was the earlier
  child's. Found, not fixed.
- **A posterior run with no fit.** A row at 0 with no esd and no bounds
  starts in a ball of 1e-10 Å (`initialSpread`·1e-8): after 20 steps the
  secondary modes' posterior sd is 2e-10 to 4e-10 Å. After a fit the esds
  seed it.
- **"Stalled" after 15 rejected trials** is still decided at a damping of
  1.4e4; the loop does not go on. The cap removes the case found here.
- **The local-data tests** (35 files, 324 tests) need the owner's data folder
  and were skipped in this clone: run them with `MATERIA_DATA_DIR` before
  merging.
- `engine.ts` is also changed on `fix/moments-alternation` (an `esdWith`
  option): this change touches `limitShift`, adds `zeroShiftCaps` after it and
  six lines before the damping loop.

## Checks

At the branch head: `npm run build`, `npm run lint` and `npm test` pass (see
the pull request for the counts).

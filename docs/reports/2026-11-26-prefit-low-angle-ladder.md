# The Prefit's Le Bail stage, from the low-angle end up

The stage0 test "a start further off than the Le Bail fit follows" passed on
main only by luck. On the dev case `dev-mn3ga-cell-strained` (the Mn₃Ga demo
opened on a cell a +1.2 %, c −0.8 % off the data's), the Prefit's Le Bail
stage ended in a false minimum from every start. Whether the Rietveld
restarts after it happened to drift close enough for the cell check to
settle depended on the 1e-5 digits of Mn x. Moving Mn x by +1e-5, ±2e-5 or
−5.5e-5, or placing Mn and Ga exactly on their special positions (branch
`fix/snap-special-positions`, #197), made the test fail. The snap waited for
this fix.

## What changed, and why

### Diagnosis

The Prefit (`thoroughFit`, src/app/powderPage.ts) first fits the cell by a
Le Bail fit (`leBailCellPrefit`, src/core/workflow/leBailPrefit.ts), then
runs multi-start Rietveld restarts from that cell. Measured on the case:

- **The Le Bail stage never found the cell.** From the case's start, the
  plain fit ended at a ≈ 5.470 Å (truth 5.42215, +0.9 %) with Rwp between
  412 % and 633 %, at a different false minimum for each Mn x. From the
  true cell the same fit gives Rwp 1.51 %.
- **Why:** a strain ε moves a 2θ line by 2·tan θ·ε (radians), but the lines
  stay about as wide. At 2θ = 100–120° the case's strain moves lines by more
  than two widths (FWHM 0.5°). A misplaced reflection's free intensity then
  takes, through the partition, the area of whatever line its tail reaches,
  and puts it at the wrong place. The cost surface is rugged: from 63 starts
  within ±3 % on each axis, the plain fit settled from 23. The fit is
  deterministic but chaotic: a 1e-5 change in the simulated data picks
  another false minimum.
- **Not the cause:** the convergence criteria and the step control (the LM
  engine converges each time, to a false minimum); the starting zero or
  background (refined, staged after the cell). A wide starting width does
  not help either: with the width free, starts of 2°, 3° and 5° settled
  from some strains and failed from others, sometimes worse than from the
  default start.
- **The Prefit's final wR stays at 81–100 % in either case.** The case fixes
  the peak width at 0.1° against the data's 0.5°, and the Prefit transfers
  only the Le Bail cell, not its width (by design). That part is not
  changed here.

### The fix: a low-angle ladder (src/core/workflow/leBailPrefit.ts, `lowAngleLadder`)

The Prefit now asks for the ladder (`lowAngleFirst: true`, passed by
`thoroughFit` through the worker's `leBailPrefit` request). On a 2θ pattern,
when the plain fit does not settle (Rwp ≥ `LE_BAIL_UNSETTLED`, 50 %, the
threshold the cell check's reading already uses), the cell is fitted again
in steps:

1. The window up to tan θ_max/4.
2. The window up to tan θ_max/2.
3. The whole pattern, as the plain fit.

Each step starts from the previous step's cell and width.

- **Why tan θ:** each window halves the largest line shift for the same
  strain. The first window follows a strain four times larger than the
  whole pattern does.
- **Enough lines per window:** each window is widened to hold at least
  three reflection families per free cell parameter (at least six) of the
  cell it starts from. A window with one line let an undetermined c wander
  to 30 Å.
- **Which result is kept:** the better of the plain fit and the ladder.

Two rules keep everything else as it was:

- **A plain fit that settles is returned as it stands,** to the last digit.
- **The cell check (`check_cell_symmetry`, `checkCellSymmetry`) never uses
  the ladder.** It reports the plain fit, as the Agent is told, and still
  sends a start further off than that fit follows to the Prefit.

On TOF patterns the ladder does not run. Their resolution Δt/t is about
constant, so no window is easier than another.

## Evidence

Script: `zzMeasure.test.ts`, a temporary jitter of the demo's Mn x, never
committed. The cells are in Å.

| Start (the demo CIF's Mn x) | Prefit's Le Bail stage, main | Same, branch | After the Prefit: cell check, main | Same, branch |
| --- | --- | --- | --- | --- |
| as printed | Rwp 480.6 %, a 5.47065, c 4.38165 | Rwp 1.51 %, a 5.42217, c 4.37562 | settles (Rwp 7.98 %), 1 unindexed | settles (Rwp 7.98 %), 1 unindexed |
| + 1e-5 | 442.4 %, 5.49404, 4.39886 | 1.51 %, 5.42217, 4.37562 | **did not settle (565.8 %), 44** | settles (7.98 %), 1 |
| − 1e-5 | 412.1 %, 5.47189, 4.37984 | 1.51 %, 5.42217, 4.37562 | settles (7.98 %), 1 | settles (7.98 %), 1 |
| + 2e-5 | 617.1 %, 5.46949, 4.38596 | 1.51 %, 5.42217, 4.37562 | **did not settle (131.6 %), 40** | settles (7.98 %), 1 |
| − 2e-5 | 552.1 %, 5.47003, 4.38532 | 1.51 %, 5.42217, 4.37562 | **did not settle (122.8 %), 40** | settles (7.98 %), 1 |
| − 3e-5 | 632.8 %, 5.47059, 4.38259 | 1.51 %, 5.42217, 4.37562 | settles (7.98 %), 1 | settles (7.98 %), 1 |
| − 5.5e-5 | 584.3 %, 5.46974, 4.38624 | 1.51 %, 5.42217, 4.37562 | **did not settle (127.7 %), 41** | settles (7.98 %), 1 |
| Mn, Ga on their exact special positions | 414.5 %, 5.47742, 4.38289 | 1.51 %, 5.42217, 4.37562 | **did not settle (139.6 %), 48** | settles (7.98 %), 1 |

- **Over a wider range:** from 63 starts within ±3 % on each axis, the
  Prefit's Le Bail stage now finds the data's cell from all 63. On main it
  found it from 23. Each ladder takes at most 0.6 s.
- **The Prefit's final wR:** 80.86 % from every start on the branch. On main
  it was 80.86–99.94 %. The fixed 0.1° width sets this value (see
  Diagnosis).

**Tests** (`src/agent/validation/prefitStarts.test.ts`, new):

- From the six perturbed starts above (Mn x ± 1e-5, ± 2e-5, −5.5e-5, and the
  exact special positions), the cell check sends the case to the Prefit.
  After the Prefit it settles with at most one unindexed peak.
- From six cells up to 2 % off on either axis (the case's own start among
  them), the Prefit's Le Bail stage finds the data's cell within the
  validation's cell tolerance (2e-4 relative).
- A plain fit that settles is returned unchanged, to the last digit.

On main, 11 of the 13 fail. The two that pass are Mn x − 1e-5 and the
settled-fit test.

**With #197:** `fix/snap-special-positions` with this change cherry-picked
(a scratch copy, not pushed) passes `stage0.test.ts` and the new test. Its
full suite reads 434 files and 3907 tests passed, 401 skipped. Without this
change it fails stage0.

## What changes for users

- **The Prefit** recovers a cell up to a few per cent off on 2θ data, where
  before it often kept a false Le Bail cell.
- **Nothing else moves.** Every fit, the cell check, and every Prefit whose
  plain Le Bail fit settles are unchanged to the last digit. No tool
  description, reading or other model-visible string changed.

## What it means for the validation

- **Scripted evals:** every scripted eval run is bit-identical. The
  normalized full-precision dump of all 172 runs is `9fd07ad4…` on main
  c5aa8d8 (its own fresh run) and on the branch.
- **Bundled demos:** bit-identical (dump `a77bc9c8…` on both). Mn₃Ga wR
  4.2435 % (4.24 %), Refine moments 0.50221 µB with G5 P6₃'/m'm'c best,
  GaTa₄Se₈ PDF Rw 8.1175 % (8.12 %).
- **Agent validation cases:** where an Agent runs the Prefit and its plain
  Le Bail fit does not settle, the Prefit now takes the ladder. On
  `dev-mn3ga-cell-strained` it gets the data's cell. The test-split cases
  were not run here, so they stay unseen.

## Not done

- **TOF patterns:** no ladder. A width continuation would be the analogue
  there; nothing failing asks for it yet.
- **The Prefit's width:** it transfers only the Le Bail cell, not the Le Bail
  width, so with a fixed, wrong width its Rietveld restarts end at a high wR
  and move the cell a little off the Le Bail cell (a +0.04 %, c +0.09 % on
  the case). Transferring the width would be a change of what the Prefit
  does, and is for the owner.

## Checks

At the branch head:

- `npm run build` passes.
- `npm run lint` passes.
- `npm test` reads 432 files passed, 42 skipped; 3898 tests passed, 401
  skipped.

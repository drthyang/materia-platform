# The subgroup search's engine (THY-72, piece 1)

THY-72 asks which lower symmetry a short-range PDF fit supports, layer by
layer, with a statistic that knows how few independent points a G(r) window
holds. The owner decided the method on 2026-11-25 and 2026-11-26 (twelve
decisions, Q1–Q12 and item 12). This change is the engine for it, its
known-truth gate tests, and a calibration run with an illustrated report.
**Engine only**: no tool, skill, page or Copilot text uses it yet, so nothing
the model reads and no number of the app changes (the dump below).

Several things the calibration and the gate found need the owner's decision
before the next piece. They are at the end, each with options and a
recommendation. Nothing was decided here in their place.

## What changed, and why

- **`core/diagnostics/subgroupSearch.ts`** (new, pure). The search's rules:
  N_ind and BIC/ΔBIC, the starts and their kicks, the top-up, the gate, the
  stop rules, failed fits, the step budget with progress and an abort signal,
  and steps 1, 2 and 3, each a function the caller runs one at a time. What a
  fit is lives behind a `SearchHost`, as the moments fit keeps its runner
  outside `src/core`.
- **`app/pdfSubgroupSearch.ts`** (new). The PDF page's host. It holds the
  fixed context, finds the window, lists the candidates from the bound's
  lattice, realises each one as Activate does (`withSupercellChild`), sets the
  free set, applies the correlation guard, and fits with the Refine button's
  request (`pdfProbe`) on a copy of the page. It never writes to the page.
- **`core/totalscattering/firstPeak.ts`** (new). The first G(r) peak, found
  from the data. The window starts just below it, and the first-peak check
  refits from just past it.
- **`testSupport/pdfNoise.ts`** (new). Simulated G(r) with Gaussian noise
  drawn on F(Q) (decision 4).
- **`testSupport/searchTruths.ts`** (new). The known truths: SrTiO₃ cubic,
  a⁻a⁻a⁻ and a⁻b⁺a⁻, and GaTa₄Se₈ P-42₁m 1×1×2.
- **Tests**:
  - `core/diagnostics/subgroupSearch.test.ts`: every rule, on a host whose
    fits are made up.
  - `app/pdfSubgroupSearch.test.ts` and `app/pdfSubgroupSearchCubic.test.ts`:
    the known-truth gate on simulated SrTiO₃.
- **Calibration** (opt-in, never in CI):
  - `app/pdfSubgroupSearchCalibration.test.ts` runs the datasets.
  - `scripts/subgroup-calibration.sh` shards them over processes and caps the
    run at 30 minutes.
  - `scripts/subgroup-calibration-report.mjs` writes the HTML report.
- **GLOSSARY**: "Subgroup search" and "Gate".

No existing file under `src` changed. No CHANGELOG entry: nothing is visible
to a user yet.

## The interface

```ts
// core/diagnostics/subgroupSearch.ts
SEARCH_RULES: SearchRules            // the owner's numbers (and nearTie, see Q-E)
independentPoints(w: Window, qmax): number
bicOf(rw, sumObs2, nGrid, nInd, p): number
deltaBicOf(rwChild, rwParent, dp, nInd): number
rmaxAllowing(p, rmin, qmax): number
startPlan(index, modes, seed): StartPlan
searchStep1(ctx: StepContext, parent: Reference, candidates: SearchCandidate[]): Promise<StepResult>
searchStep2(ctx, parent, step1: StepResult, coupled: SearchCandidate[]): Promise<StepResult>
searchStep3Layer(ctx, frontier: BeamNode[], childrenOf: (n: BeamNode) => SearchCandidate[], layer): Promise<StepResult>
beamOf(rows): CandidateRow[]          // step 3's frontier: best 3, near-ties kept
topIrreps(step1, count = 3): string[]
// StepContext = { host, window, firstPeakPast, rules?, onProgress?, signal?, now? }

// app/pdfSubgroupSearch.ts
pdfSearchContext(client, page, bound, { refineParent?, window?, rules? }): Promise<PdfSearchContext>
//   → { host, parent, reference, window, peak, parentRw, parentHeld, singles, pairs, maximalUnder, … }
acceptedReference(ctx, candidate, best, p): Reference   // an accepted child as step 3's parent
```

Each step returns a ranked table (`StepResult.rows`):

- First the accepted rows by BIC, then the other fitted rows by BIC, then the
  failed fits, then the rows not fitted.
- It names what the budget or a stop left unfinished (`unfinished`, and a row
  "not fitted" for each).
- It says how the step ended (`ended`), and `stop: "no child passes the gate"`
  when nothing passes.

Every row carries:

- the class: irrep(s) with direction, group, cell, index and row key;
- Rw, p, Δp, BIC and ΔBIC;
- the gate verdict, each criterion's number and the reasons;
- the starts run and how many agree;
- the rows the correlation guard held;
- its status (fitted, not fitted with the reason, or fit failed with the
  reason);
- the first-peak check, on an accepted row.

## How each decision is built

| Decision | Where | How |
| --- | --- | --- |
| 1 Statistics | `subgroupSearch.ts` `independentPoints`, `bicOf`, `deltaBicOf` | N_ind = `nyquistPointCount` with the data's own Qmax (`pattern.qmax`; the search refuses data without one). RSS = Rw²·ΣGobs² (uniform weights). Siblings ranked by BIC (`rankRows`) |
| 2 Parameter count | `pdfSubgroupSearch.ts` `prepare`; `evaluate` | p = free rows not tied. One ADP per parent site: the split sites are tied to it (`= B_x`). The guard's held rows are reported, not counted. Δp = p_child − p_parent |
| 3 Threshold | `SEARCH_RULES.deltaBic = −6` | Calibrated below |
| 4 Noise | `pdfNoise.ts` `noisyPattern` | δF(Q) ~ N(0, (s·Q/Qmax)²) on 0…Qmax, transformed by the trapezoid sine transform. s set so the expected Σδg² over the window is level² × Σg² |
| 5 Gate | `subgroupSearch.ts` `gateOf` | (1) every primary irrep's √ΣA² ≥ 3σ, with σ from the covariance (esds and correlations of its modes) × √(N_grid/N_ind); (2) `agreeingCount` within 0.1 % relative; (3) child and parent refitted from their best values at rmax ∓ 2 Å, ΔBIC < 0 at both; (4) `nonPositiveDefiniteSites`, plus an isotropic B ≤ 0, and `bondValenceSums` within 15 % |
| 6 Search shape | `searchStep1/2`, `searchStep3Layer`, `beamOf`; candidates in `pdfSearchContext` | Step 1: one candidate per (class, primary irrep), only that irrep's modes free. Classes whose irrep moves no atom are listed "strain or ordering only". Step 2: every coupled set of two irreps both among `topIrreps`. Step 3: `maximalUnder` (the lattice's covering edges), equal classes fitted once ("also under …"), best 3 kept with near-ties |
| 7 Starts and time | `startPlan`, `toppedUpStarts`, `runStep` | Start 0 is the activation's own; 1–7 kick 0.02–0.1 Å; 8–9 kick 0.2–0.3 Å; starts 3, 6 and 9 also halve the tied ADPs. Topped up to max(20, 10·Δp) when ΔBIC ≤ 0. 10-minute budget per step, `onProgress`, `signal`; unfinished rows are named |
| 8 Stop rules | `evaluate` (`capped`), the first-peak block, `runStep` | (1) p > N_ind/4: not fitted, with `rmaxAllowing`; (2) an accepted child is refitted from rmin = the peak's far edge, and is marked when ΔBIC ≥ 0 there (`beamOf` skips it); no child accepted: `stop` |
| 9 Failed fits | `failureOf` | Best Rw worse than the parent's beyond 0.1 % (choice 13); best start not "converged" or non-finite; an atom more than 0.5 Å from its parent position (the free modes' axes in Cartesian) |
| 10 Fixed context | `pdfSearchContext` | Whole range: scale, cell, δ1, δ2 and one ADP per site, behind the guard. Then everything is held except, per window, the scale and the ADPs (the parent) or the scale, the candidate's modes and the tied ADPs (a child). The window is `firstPeak(…).below` to 10 Å; `opts.window` changes it |
| 11, 12 Known truth | `pdfSubgroupSearch*.test.ts`; the calibration | Below |

## Choices made where the spec is silent (for the owner to confirm)

These are implemented and each can be changed in one place.

1. **"No-kick start".** A symmetry-breaking mode is stationary at zero
   amplitude, so a fit started there never leaves it. Start 0 is therefore
   the activation's own start (Activate's 0.05 Å kick on the order
   parameter).
2. **Kick size.** "0.1 Å" is read as the displacement of the atom the kick
   moves most, not as a mode amplitude (an amplitude in Å is a norm over the
   whole child cell).
3. **The correlation guard.** It runs once, at the best of the first ten
   starts; if it holds rows, the starts run again on the smaller set.
   - It holds an ADP before a mode, and never the scale for an ADP.
   - It never holds a mode the data cannot determine, nor a pair of such
     modes. At the parent's geometry a symmetry-breaking mode's correlations
     are round-off, and the amplitude test judges it instead.
   - Held at the start, the guard held every mode on cubic data: the first
     version did this, and it was wrong.
4. **Same-cell classes** are realised in their own cell like the supercell
   ones (`withSupercellChild`), so every candidate refines its irrep's modes
   by parent irrep. The Subgroups page's Activate takes another path for
   them (`withSubgroup` and the like).
5. **The noise is not damped by Qdamp.** Qdamp acts on the signal (the
   instrument's resolution). The counting noise is added after it. "With the
   fit's Qmax and Qdamp" is read as: the signal is band-limited at Qmax and
   damped by Qdamp; the noise is transformed with Qmax.
6. **σ_F ∝ Q** (white S(Q) noise) is the "growing with Q".
7. **"Did not converge"** is any end other than "converged", including the
   Refine button's 30-iteration cap.
8. **Step 2's reference is the parent** (decision 1, read literally). Each
   row's ΔBIC is against the cubic parent, not against the step-1 child it
   extends (see Q-A).
9. **Step 3's free modes** are those of the accepted child's irreps plus the
   class's own order-parameter irreps (its first primary irrep, else its
   coupled set). Each class starts from the activation's kick, not from the
   accepted child's amplitudes. Step 3 is built and unit-tested but has not
   been run on simulated data.
10. **"Near-ties kept"** has no number in the spec. A child within 2 BIC of
    the last one kept is kept too (`SEARCH_RULES.nearTie`).
11. **The first peak** is the first extremum of G(r) + 4πρ₀r (slope from the
    data's first 0.3 Å) above max(10 % of the largest, 3 × the r.m.s. there).
    rmin is the peak less twice its lower half width. On cubic SrTiO₃ over
    200 seeds it finds the Ti–O peak:
    - every time at 5 %;
    - 96.5 % of the time at 10 %;
    - 79 % of the time at 15 %, where the noise is as large as that peak.

    In the other cases it takes the 2.75 Å peak (rmin ≈ 2.4 Å) or, at 15 %,
    a noise extremum just below 1.8 Å. The window is shown and can be
    changed (decision 10).
12. **δ1 and δ2 both refine** in the whole-range parent fit, behind the
    guard.
13. **"Worse than the parent's" means worse by more than 0.1 %**, the
    starts' agreement tolerance. A child holds its parent (its modes at 0),
    so on cubic data most children return to the parent's minimum, and come
    out worse by round-off (4.69 % against 4.69 %). Read literally,
    decision 9 marked 480 such rows "fit failed" in the calibration runs,
    which predate this reading. They all have ΔBIC > 0, so no rate or
    acceptance depends on them.

## Evidence

**No existing number moved.** Two temporary tests, kept outside the
repository (`~/.local/share/materia-review/2026-11-26/thy72/dump/`), ran on
`main` (e5cfca0) and on this branch. They write every number as the 16 hex
digits of its float64:

- every scripted eval run (the THY-71 template: good, stage-scope and bad
  replays, each scenario page's `get_state` and `assess_refinement`, the more
  failures, and the misfit and impurity pages);
- the Subgroups listing of SrTiO₃ in 2×2×2 and of GaTa₄Se₈ in 1×1×2 (every
  row: key, name, cell, index, irreps, modes, reach, detail);
- the GaTa₄Se₈ demo's Refine, Activate of P-42₁m 1×1×2 (c45), and its fit
  with every mode free.

After the run's clock times are normalised, both files are byte-identical:
eval `97562b9f…`, PDF and subgroups `c9e5c4dd…` (SHA-256).

**The rules** (`subgroupSearch.test.ts`, 13 tests, under 1 s):

- BIC and ΔBIC, the cap's rmax, the starts' kicks and ADP resets, the top-up
  and the agreement;
- each gate criterion failing alone, with its reason;
- σ = esd × √(N_grid/N_ind);
- failed fits, strain-only rows, the N_ind/4 cap, the first-peak mark;
- the guard's rerun, the budget's and the stop's unfinished rows;
- step 2's pairing and its precondition;
- step 3's beam with near-ties, and a class merged under two parents;
- the first peak's position and edges.

**The known-truth gate in CI** (one seed each; step 1 over a fixed screen of
7 of the 172 classes). The three files run side by side in 46 s wall clock
(121 s CPU) on an otherwise quiet machine:

- a⁻a⁻a⁻ at 5 % and 10 %: step 1's top accepted child is R irrep 8 (a,a,a),
  R-3c;
- cubic at 5 %: nothing accepted;
- cubic at 10 %, seed 1, is `it.fails`: a false descent, R irrep 7 (a,a,a),
  ΔBIC −7.4, one of the calibration's three (Q-C);
- a⁻b⁺a⁻ at 5 % is `it.fails`: the decided outcome is not met (Q-A).

Each `it.fails` was checked to fail for that reason, not on an error.

**The calibration** (opt-in, not in CI). The illustrated report, with seven
figures and every number, is local and not in the repository (it reads
simulated data only, but stays with the review files):
`~/.local/share/materia-review/2026-11-26/thy72/calibration/index.html`.

How it ran:

- On the engine at de38cc5.
- 27.7 minutes wall clock (cap 29), 16 Node processes. Each dataset's step-1
  candidates were split over the processes (each candidate is independent
  and seeded by its key, so the merged table is the sequential step's).
- The step budget was lifted so no screen was cut short.
- 13 datasets were queued and 10 completed; the cap cut 3.
- Three earlier runs that day used an engine whose correlation guard emptied
  385 cubic candidates. They are kept as a record under `superseded/`, with
  a note; their headline numbers are the same.

| | 5 % | 10 % | 15 % |
| --- | --- | --- | --- |
| cubic: false descents at ΔBIC ≤ −6 (full gate) | 1 of 3 (95 %: 6–79 %) | 1 of 3 (6–79 %) | 1 of 1 (21–100 %) |
| a⁻a⁻a⁻: step 1's top accepted is R irrep 8 (a,a,a), R-3c | 1 of 1 ✓ | (CI test, seed 1 ✓; earlier run ✓) | — |
| a⁻b⁺a⁻: M3 and R8 accepted, then Pnma on top in step 2 | 0 of 1 (M3 not accepted; it ranks 18th) | (earlier run: M3 accepted, ranks 27th; step 2 never pairs it) | — |
| GaTa₄Se₈: X5 + W1 (c45) on top in step 2 | 0 of 1 (step 1 accepts nothing; X5 ranks 23rd, W1 19th) | (earlier run: same, 30th and 18th) | (earlier run: same, 30th and 5th) |

What the numbers say:

- **False descents.** The three false descents are all seed 1:
  - M irrep 10 (a,0,0,0,0,0), Pmma 1×2×2, ΔBIC −6.7 at 5 %;
  - R irrep 7 (a,a,a), R-3m, ΔBIC −7.4 at 10 % and −6.9 at 15 %.

  Each passed all four other criteria. A threshold below −7.4 would have
  rejected all three. With 7 cubic datasets, the data cannot show what
  threshold gives ≤ 5 %. The rate at −6 is, on this evidence, well above 5 %
  (3 of 7). Seeds 2–4 at 5 % and 10 % had none in either run.
- **The other gate numbers on cubic data.** Five cubic candidates reached
  ΔBIC ≤ −6. The amplitude test (3σ) rejected none of them, the restarts
  test one, the rmax ± 2 Å test two, the ADP test none, and the BVS test
  one. The true R-3c on a⁻a⁻a⁻ sits at 38σ.
- **The N_ind/4 cap** listed 2 SrTiO₃ candidates per dataset (P1 by
  M irrep 10 and by X irrep 9, p = 22) and 26 of 63 on GaTa₄Se₈.
- **The 0.5 Å bound** failed 2 fits, both runaways (16 Å). Every fitted
  candidate of a true child stays under 0.3 Å.
- **Other failed fits.** 56 were stopped at the 30-iteration cap, mostly on
  candidates with many modes. 94 were worse than the parent by more than
  0.1 % (a start that stopped short of the parent's own minimum).
- **The noise levels.** The parent fit on parent data read Rw = 4.7–5.6 %
  at 5 %, 9.3–11.1 % at 10 % and 13.8 % at 15 %.
- **The window.** The first peak was found at 1.90–2.00 Å (Ti–O) on every
  SrTiO₃ dataset of this run, and at 2.5 Å on GaTa₄Se₈.

## Questions for the owner

Each question has options and a recommendation. Nothing below was widened or
changed in the engine: the rules are as decided.

### Q-A. a⁻b⁺a⁻: step 1 does not accept M irrep 3, and step 2 never pairs it with R irrep 8

Measured on simulated a⁻b⁺a⁻ (tilt 0.07 rad), window 1.6–10 Å, N_ind ≈ 67,
with the parent's whole-range fit held (decision 10):

| data | parent Rw (window) | M irrep 3 (a,0,0) P4/mbm alone | ΔBIC | R irrep 8 (a,a,a) R-3c alone | ΔBIC |
| --- | --- | --- | --- | --- | --- |
| noise-free | 11.92 % | 11.37 % | −2.0 | 5.51 % | ≈ −100 |
| 5 %, seed 1 | 12.72 % | 12.21 % | −1.2 | 7.54 % | −65.6 |

- **M3 alone barely improves the fit.** It is judged against the parent,
  whose residual is dominated by the two unmodelled antiphase tilts. The
  parent's refitted ADPs also absorb part of the single in-phase tilt. Even
  on noise-free data, M3 alone is far from ΔBIC ≤ −6. So "step 1 accepts M3"
  fails by construction, not by noise.
- **Step 2 never tries M3 + R8.** Step 1's top three irreps by BIC are R
  irreps 8 and 10 and then M10 or R7; M3 ranks 18th at 5 % and 27th at 10 %
  in the full screen. Step 2 pairs only those three, so the Pnma class
  (M3 + R8) is never fitted.

Options:

1. **Anchored pairs** (forward selection). Step 2 fits the coupled classes
   of the top accepted irrep (or of each accepted irrep among the top three)
   with every other irrep that moves atoms. Each is judged against the
   accepted single-irrep child it extends, not the cubic parent.
2. **Widen the pairing** from the top 3 to the top N irreps.
3. **Re-screen the single irreps on top of the best accepted child** (a
   step 1b), then pair.
4. **Keep the rule** and change the a⁻b⁺a⁻ target to what step 1 + step 2
   reach.

Recommendation: option 1. It compares like with like (decision 1's "child
against its parent" with the accepted child as the parent). It needs no new
number, and on these data Pnma against Imma should be decisive. On
noise-free a⁻b⁺a⁻ (the 11-25 probe) Pnma fits to Rw 0.000 % and Imma
(R8 (a,a,0)) to 5.1 %; at 5 % noise Imma reads 8.1 %. Pnma at 5 % was not fitted
here, because that is the step the rule never takes. Its cost is more
step-2 candidates: the coupled classes of R8 with every other irrep. That has
to be measured against the 10-minute budget (Q-D).

### Q-B. GaTa₄Se₈ → P-42₁m 1×1×2 (X5 + W1) cannot pass as specified

Three things block it:

1. **The N_ind/4 cap (decision 8(1)).** The class c45 frees the 19 modes of
   X5 + W1. With the scale and 4 ADPs, p = 24. At the decided window
   (2.3–10 Å, Qmax 27 Å⁻¹) N_ind = 66 and N_ind/4 = 16.5. So step 2 would
   list it "not fitted", and the window would need rmax ≥ 13.5 Å. X5 alone
   (s18, same-cell P-42₁m, p = 15) and W1 alone (c25, I-42m 1×1×2, p = 14)
   fit under the cap.
2. **Step 1 accepts nothing.** With the truth's modes moving the atom they
   move most by 0.07 Å (each irrep), the parent's window Rw at 5 % noise is
   4.92 %: the distortion is about 1 % of the signal under 5 % noise.
3. **Step 2 is never reached.** Step 1's top three irreps never hold both
   X5 and W1. In the calibration, X5 ranked 23rd to 30th and W1 5th to 19th among
   the fitted rows, and 26 of the 63 step-1 classes were over the cap.

A measurement for the options (4 starts each, 5 % noise, seed 1):

| truth amplitude | window | N_ind/4 | parent Rw | X5 alone (p 15) | W1 alone (p 14) | X5 + W1, c45 (p 24) |
| --- | --- | --- | --- | --- | --- | --- |
| 0.07 Å | 2.3–10 Å | 16.5 | 4.93 % | 4.30 %, ΔBIC +24 | 4.25 %, +18 | 3.36 %, +29 (over the cap) |
| 0.07 Å | 2.3–14 Å | 25.1 | 5.33 % | +28 | +31 | +48 |
| 0.15 Å | 2.25–10 Å | 16.7 | 8.76 % | −34.6 | −23.9 | −34.6 (over the cap) |
| 0.15 Å | 2.25–14 Å | 25.2 | 9.26 % | −54.6 | −9.8 | −44.2 |

At 0.15 Å and rmax 14 Å the pair passes ΔBIC. But X5 alone (the same-cell
P-42₁m) has the lower BIC, so which class a step reports depends on the
answer to Q-A as well.

Options:

1. Let the window grow for a class the cap stops, up to `rmaxAllowing`.
   The data must then reach rmax + 2 Å.
2. A larger truth amplitude, or less noise, for this target.
3. The anchored pairs of Q-A, which would pair an accepted X5 or W1 with
   the other.
4. Count p differently for this class (all 19 modes free is what makes it
   24).

Recommendation: decide first whether this target is meant at rmax 10 Å. If
not, take 1 + 3 together, with an amplitude chosen from the measurement
above. Every option is the owner's. Nothing was built.

### Q-C. False descents at ΔBIC ≤ −6

On 7 cubic datasets, 3 false descents passed the whole gate:

- M irrep 10 (a,0,0,0,0,0), Pmma 1×2×2, at 5 %, ΔBIC −6.7;
- R irrep 7 (a,a,a), R-3m, at 10 %, ΔBIC −7.4, and at 15 %, ΔBIC −6.9.

That is 1 of 3, 1 of 3 and 1 of 1 per level: far above the 5 % target,
though the intervals are wide. On these few datasets a threshold below −7.4
would have rejected all three. Showing ≤ 5 % needs about 60 cubic datasets
per level: at roughly 4 minutes of wall clock per dataset over 16 processes,
about nine more 30-minute runs.

Options:

1. Run those seeds (scripts as they are), then choose the threshold from the
   curve the report draws (figure 3).
2. Choose a stricter threshold now (−8 would have held here) and calibrate
   it with the same runs.

Recommendation: 1. The number should come from the data, and nine runs is a
day of machine time. The CI tests mark cubic at 10 %, seed 1, as a known
false descent (`it.fails`) until then.

### Q-D. The 10-minute step budget

On SrTiO₃ in 2×2×2, step 1 has 242 single-irrep candidates: 172 that move
atoms and 70 listed without a fit. Each fitted candidate gets 10 to 30
starts and up to 4 refits.

- In Node, one thread per process, the full step 1 took far longer than
  10 minutes per dataset.
  Summed over the shards (one process's time), a full step 1 took
  1490–2550 s per SrTiO₃ dataset and 530 s for GaTa₄Se₈, with 16 processes
  sharing an 18-core machine.
- The first, unsharded calibration run finished no SrTiO₃ dataset in
  29 minutes.
- With the budget in force, a step ends at 10 minutes, names what it did
  not fit, and the ranking is partial and says so.

The browser's worker pool makes each fit faster, but by a factor that is not
measured here.

Options:

1. A larger budget.
2. Step 1 in the browser's worker pool, candidates in parallel.
3. Fewer starts for a candidate whose first starts all return to the
   parent (ΔBIC > 0 after 10 is already the rule; the cost is in the
   candidates with ΔBIC ≤ 0).
4. A coarser grid.

Recommendation: measure the browser path with piece 2 before choosing.
1 and 2 keep every decided number.

### Q-E. The choices above

The thirteen choices under "Choices made where the spec is silent" are
implemented as described. Each is one place in the code. Four of them change
what the search finds, and need a yes or a different rule:

- choice 3 (the guard);
- choice 8 (step 2 against the parent);
- choice 9 (step 3's free modes);
- choice 10 (near-ties at 2);
- choice 13 (worse than the parent beyond 0.1 %).


## Not done

- Piece 2: the Agent's runner, a workflow skill, the tool descriptions and
  the skill text. They are model-visible, and the owner approves the wording.
- Step 3 has not been run on simulated data (see choice 9).
- The cross-check of the subgroup tree against ISODISTORT/ISOTROPY
  (item 12(i)) is another agent's.
- A larger calibration. This run's seed count was set by the 30-minute cap
  on a machine shared with other work. The same scripts take more seeds
  (`CUBIC_SEEDS`, `TRUTH_SEEDS`) in more 30-minute runs.

## Checks

CHECKS

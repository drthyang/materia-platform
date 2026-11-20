# The moments fit: a bias from the nuclear-only fit, and the plan to remove it (DRAFT)

**Status: draft plan, step 1 of the change. No behaviour is changed yet.**
Branch `fix/moments-alternation`, on `main` at fcf7257, 2026-11-19. This
commit adds the known-truth test and this plan. The fix itself, and the
Copilot's method and report gate that follow it, are later steps; each will
complete this report.

Answers Finding 1 and Finding 2 of the demo-path physics audit of 2026-11-09
(a read-only audit of the commensurate magnetic powder path).

## What was found

**Finding 1. The page's sequence gives a moment that is too small.** The
powder page refines the nuclear model first, then fits the moments with every
nuclear row held (`momentFitRequest`, `powderPage.ts`). With k ≠ 0 the
nuclear-only fit sees the magnetic satellites as intensity it cannot explain,
and least squares answers by raising the background and the scale. The moments
are then measured above a background that is too high and against a scale that
is too large.

**Finding 2. The moments-only esd is too small.** It is the esd of the
moments with the scale known exactly. The scale was fitted to the same
pattern, and its uncertainty is left out.

**Found while reproducing them, at k = 0.** The step's ranking refines the
scale with each group's moments at k = 0 (`freeScale`, since
[the ranking report](./2026-10-19-magnetic-ranking.md)). The step's own
**Refine moments** does not: it holds the scale. On a k = 0 ferromagnet a group
ranked at 4.155 µB is taken back to 3.520 µB by Refine moments (truth 4.2).

The Copilot's method ends on a final instrument pass (instrument terms, scale
and background, the moments held), and the report gate requires that pass to
be the last refinement. The moments are therefore never refined against the
scale and background the report is written with.

## How it was measured

The truth must not come from the code under test. `independentMnwo4.ts`
calculates a constant-wavelength neutron pattern of MnWO₄ (Macavei & Schulz
1993) with a synthetic magnetic order, and imports nothing from `src/core`:
its own metric, structure factors, Mn²⁺ ⟨j0⟩ (International Tables C),
projection perpendicular to Q, Lorentz factor and powder sum. The magnetic cell
is treated as one P1 crystal with every atom and spin explicit, so there is no
symmetry, propagation vector or multiplicity to get wrong. Four hand
calculations pin it: two d spacings, the nuclear |F|² of (0 2 0) as four
cosines, the magnetic |F⊥|² of (1 0 0) as 16·(p·f·T·m)², and |3â + 2ĉ| at
β = 91.14°.

Pattern: λ = 2.41 Å, 8–130° in 0.05° steps, Gaussian FWHM 0.40°, flat
background 200, counting noise σ = √y, fitted from 10° to 125°. The largest
magnetic line is 30 % of the strongest nuclear line (model A).

- **Model A**, one moment row: 4.2 µB along b, k = (½, 0, 0).
- **Model B**, two moment rows: 3.0 â + 2.0 ĉ (3.5723 µB), k = (½, 0, 0).
- **k = 0**: model A's arrangement in one cell (an antiferromagnet), and a
  ferromagnet along b, where every magnetic line sits on a nuclear line.

The app's side is the page's own code: `buildPowderProblem`,
`buildMagneticPowderProblem`, `refine`, the step's candidates and moment
model, and for "today" `powderMomentFit` itself. With the nuclear rows held at
the truth and no noise, the app returns 4.20065 µB for 4.2: the ratio of
γr₀/2 = 2.69542 fm/µB to the app's rounded 2.695 (the rounding GSAS-II and
FullProf use), and nothing else.

"Today" is: nuclear-only fit of scale, background and width; then the moments
with every nuclear row held. A "round" is: scale and background with the
moments and everything else held; then the moments with every nuclear row
held. "Joint" refines the scale, the background and the moments together, and
is the reference only. It is never proposed as a step.

## Finding 1 in numbers

200 noise seeds each, six Chebyshev background terms. "Bias / esd" uses the
esd the moments-only fit quotes at that step.

**Model A (truth 4.2 µB)**

| step | moment (µB) | bias | bias / esd | scale (truth 0.0800) | background (truth 200) | GoF |
| --- | --- | --- | --- | --- | --- | --- |
| nuclear rows held at the truth | 4.2008 | +0.0008 | +0.1 | 0.08000 | 200.0 | 1.00 |
| today | 4.0630 | −0.1370 (−3.3 %) | −10.1 | 0.08125 | 207.0 | 1.47 |
| 1 round | 4.1740 | −0.0260 | −2.8 | 0.08088 | 199.7 | 1.01 |
| 2 rounds | 4.1955 | −0.0045 | −0.5 | 0.08028 | 199.6 | 1.01 |
| 3 rounds | 4.1999 | −0.0001 | 0.0 | 0.08016 | 199.6 | 1.01 |
| 4 rounds | 4.2008 | +0.0008 | +0.1 | 0.08014 | 199.6 | 1.01 |
| 5 rounds | 4.2010 | +0.0010 | +0.1 | 0.08013 | 199.6 | 1.01 |
| joint | 4.2011 | +0.0011 | +0.1 | 0.08013 | 199.6 | 1.01 |

The first row's +0.0008 is the app's rounded γr₀/2 (+0.0007) and noise. With
one background term today's sequence gives 4.0858 (−2.7 %, −8.9 esd), and the
rounds give 4.1792, 4.1966, 4.2000, 4.2007.

**Model B (truth 3.0, 2.0)**

| step | â component | bias / esd | ĉ component | bias / esd |
| --- | --- | --- | --- | --- |
| nuclear rows held at the truth | 3.0014 | +0.1 | 1.9990 | −0.1 |
| today | 2.8892 | −5.7 | 1.9707 | −1.1 |
| 1 round | 2.9795 | −1.4 | 1.9990 | −0.1 |
| 2 rounds | 2.9944 | −0.4 | 2.0040 | +0.2 |
| 3 rounds | 2.9970 | −0.2 | 2.0049 | +0.3 |
| 4 rounds | 2.9974 | −0.2 | 2.0050 | +0.3 |
| joint | 2.9975 | −0.2 | 2.0051 | +0.3 |

- The bias is the sequence's, not the noise's: with no noise at all today's
  sequence gives 4.0623 for 4.2.
- The page's own fit (`powderMomentFit`, eight seeds, in the committed test)
  gives 4.0606: the same number as the test's harness, to four decimals.
- The audit quoted 4.125 for six background terms. Its one-term value (4.085)
  is reproduced here to four figures, its six-term value is not: 4.063 here.
  The scale and background of the two six-term runs agree (0.0813, 207.0), so
  the difference is in what the audit's moments step held; it could not be
  traced, since the audit's scratch files are gone. The number here is the
  page's own function's.
- The rounds refine only the scale and the background. The peak width keeps
  its nuclear-only value, 1.1 % too wide (0.4043 for 0.4000; GoF 1.01 against
  1.00). Model A's moment does not feel it: 4.2011 with the width held,
  4.2013 with the width in the rounds. Model B's components do, a little:
  2.9975 and 2.0051 with the width held against 3.0017 and 1.9993 with the
  width in the rounds, that is −0.28 and +0.30 esd. Its size (3.5731 against
  3.5734) does not. So what the rounds leave held can still tilt a
  two-component moment by a fraction of an esd.
- On the local demo dataset (unpublished; the moment numbers are the audit's,
  reproduced here): today 2.508 µB, then 2.590, 2.597, 2.597 after one, two
  and three rounds; joint 2.597.

## Finding 2 in numbers

The scatter of the refined moment over the seeds, against two esds at the
converged point: the moments-only esd the engine quotes, and the esd from the
covariance of the moments together with the scale and the background.

| case | scatter (µB) | moments-only esd | scatter / esd | esd with scale and background | scatter / esd |
| --- | --- | --- | --- | --- | --- |
| A, k = (½,0,0), 1000 seeds | 0.0100 | 0.0091 | 1.10 | 0.0102 | 0.98 |
| B, â component, 200 seeds | 0.0148 | 0.0143 | 1.03 | 0.0150 | 0.98 |
| B, ĉ component, 200 seeds | 0.0212 | 0.0192 | 1.10 | 0.0194 | 1.09 |
| k = 0 antiferromagnet, 200 seeds | 0.0280 | 0.0234 | 1.20 | 0.0264 | 1.06 |
| k = 0 ferromagnet, 200 seeds | 0.0400 | 0.0311 | 1.29 | 0.0405 | 0.99 |

A ratio from 200 seeds is known to ±5 %, from 1000 to ±2 %.

- The moments-only esd understates the scatter by 3 to 29 %, most where the
  scale and the moment trade most (k = 0, magnetic lines on nuclear lines).
- The covariance that includes the scale and the background gives the scatter
  within twice the sampling error in every case, and equals the joint fit's
  own esd to three figures. It is taken at the final point with no parameter
  step. Where it is furthest off (B's ĉ component, 1.09) the fit with the
  nuclear rows held at the truth is off by the same 1.09 on the same seeds: a
  property of that seed set, not of the esd.
- With the nuclear rows held at the truth, where the moments-only esd is the
  right one, model A scatters by 0.0088 for a quoted 0.0091 (0.97, 1000
  seeds). Fitting the scale and the background to the same pattern raises the
  scatter by 14 %, and the esd that includes them is 12 % larger.
- The same pair of esds predicts how fast the rounds converge. What is left
  after a round is the fraction 1 − (moments-only esd / full esd)² of what was
  left before: 0.20 for model A (measured 0.21), 0.41 for the k = 0
  ferromagnet (measured 0.41).

## k = 0

Today, on the independent k = 0 patterns (200 seeds, truth 4.2 µB):

| | antiferromagnet | ferromagnet |
| --- | --- | --- |
| Refine moments today (scale held) | 4.004 (−4.7 %, −7.5 esd) | 3.500 (−16.7 %, −18 esd) |
| the ranking's fit today (scale free with the moments) | 4.111 (−2.1 %, −3.1 esd) | 4.128 (−1.7 %, −1.7 esd) |
| rounds, scale held in the moments step: to a shift below 0.1 esd | 4 rounds → 4.199 | 7 rounds → 4.198 |
| rounds, scale free with the moments, background between | 3 rounds → 4.199 | 2 rounds → 4.199 |
| joint | 4.1995 | 4.1989 |

- Both ways of alternating end on the joint fit's answer. With the scale held
  in the moments step the ferromagnet needs seven rounds, because the scale
  and the moment trade (contraction 0.41 a round).
- **The published GSAS-II comparisons do not move.** The Mn₃Ga 350 K test
  (`mn3ga350KGolden.test.ts`) compares |F_M|² reflection by reflection with no
  fit, and its moment refinement is the test's own staged fit of scale,
  background and profile with the moments; neither calls the page's moments
  fit. The Mn₃Ga 30 K moments (2.527, 2.829, 2.530 µB) are a check of the mCIF
  parse and the metric (`magneticCif.test.ts`); nothing is fitted.
- What does move at k = 0 is the app's own Refine moments, which today takes a
  ranked moment back down (above).

## The ranking

The ranking stays a single pass per group (it compares groups; rounds for each
would multiply its time). Checked whether rounds would change its answer:

- Independent MnWO₄, models A and B, 12 seeds each, all 11 groups ranked both
  ways (4 restarts). The ★ is the same in 23 of 24 rankings, and today's
  single pass gave the true group the ★ in all 24. The set within the noise is
  the same in 18 of 24.
- The one change of ★ is for the worse. In model B, seed 8, rounds took the ★
  from the true maximal group to an index-4 subgroup with more moment rows
  (wR 4.998 % against 4.987 %). Today the same two fits differ as little
  (6.630 % against 6.627 %) and the test calls it noise. The reason is the
  noise level Hamilton's test divides by: today's fits carry the misfit of the
  biased scale and background (GoF 1.3–1.5), which makes the test lenient;
  with rounds the GoF is 1.0 and the 5 % test rejects a true group about as
  often as 5 % says. The five other set changes are of the same kind: one
  lower group with extra rows entering or leaving the set.
- The local demo dataset, once (3 restarts): the same ★ and the same
  within-noise set.
- So rounds in the ranking would not improve it, and the single pass stays.
- With rounds every group's wR falls together (model A: 7.3 % → 5.0 % for the
  groups that contain the truth). So after the fix a group's wR in the ranking
  table (single pass) is higher than the wR Refine moments then reports for it.

## The design (proposed)

The owner's rule stands: the last step refines the moments with the nuclear
model held, and nuclear and magnetic parameters are never refined together.

**A. Refine moments alternates.** One Refine moments =

1. the moments, every nuclear row held (today's fit);
2. the scale and the background, the moments and every other row held;
3. the moments again, every nuclear row held;

with 2–3 repeated until the stopping rule below, always ending on a moments
step. The app's button, the Copilot's `refine_moments` and the report then
share one number.

**B. The esd.** At the final point, the esd of each moment row comes from the
covariance of the moment rows with the scale and background rows:
esd_j = √(C_jj · χ²/(N − P)), C = (JᵀWJ)⁻¹ over those P rows. A calculation at
one point; no row but the moments is stepped. The result keeps its esds keyed
by the rows that were refined (the moments), and records which held rows the
covariance included, so the report can say so.

**C. The ranking** stays single-pass, `freeScale` at k = 0 included.

**D. The Copilot's method** (a later step): the method ends on a moments-only
refinement after the final instrument pass, and the report gate follows.

### The stopping rule

After each round, compare each free moment row with its value one round
before, in units of that row's esd from the moments step just run.

- **Stop when every row moved by less than 0.1 esd.** 0.1 is the usual
  crystallographic "settled" (the engine's own convention for shift/esd).
- **At most 10 rounds.** If the cap is reached, the fit keeps its last
  moments step and says it did not settle, with the last shift.
- At least one round always runs.

Why these numbers, from the runs above (what is left is measured against the
joint fit, in esds, worst seed):

| case | rounds to stop at 0.1 | left when it stops |
| --- | --- | --- |
| A, six terms | 4 (133 seeds) or 5 (67) | ≤ 0.026 |
| A, one term | 4 | ≤ 0.020 |
| B, six terms | 4 | ≤ 0.010 |
| the local demo dataset | 3 | below 0.02 |
| k = 0 antiferromagnet, scale held | 4 | ≤ 0.020 |
| k = 0 ferromagnet, scale held | 7 | ≤ 0.043 |
| k = 0, scale free with the moments | 2 (ferromagnet), 3 (antiferromagnet) | ≤ 0.006 |

A looser 0.2 saves one round in some cases and leaves up to 0.10 esd; 0.5
leaves up to 0.25. The brief's example of four rounds at most would cut model
A short in a third of the seeds and the k = 0 ferromagnet always. Each round
is two small fits; one moments fit takes 0.1 s on the local demo dataset.

## Where the moments-only fit is called, and whether A applies

| place | what it is | A applies? |
| --- | --- | --- |
| `MagneticStep.refineMoments` → `fitMoments` → `powderMomentFit` → `momentFitRequest` (`magneticStep.ts:979`, `powderPage.ts:1034–1068`) | the powder step's **Refine moments** | **Yes.** This is the fit Finding 1 names |
| `refine_moments` (`agent/magneticTools.ts:314`) | the Copilot's tool; it calls the step's `refineMoments` | Yes, through the step. Its description is model-visible: later step |
| `MagneticStep.rank` → `rankCandidates` (`magneticStep.ts:297`, `:951`) | the ranking, one fit per start per group | No: single pass by decision; checked above |
| the refinement page's **Refine** with only the moment rows free, after Continue (`withMagneticModelRows`; the Copilot's Stage 4) | the engine's ordinary fit of the free set; **the esd the report quotes comes from here** | The alternation does not run here. B (the esd) must reach this fit, or the report keeps the moments-only esd |
| `withMagneticPreview` (Show on refinement pattern; `show_magnetic_model`) | the nuclear set refined against nuclear + held moments | No: it is step 2 done by hand, unchanged |
| single-crystal `momentFit` (`singleCrystalPage.ts:805`) | F² fit, the magnetic scale tied to the nuclear one | Not in this change. There is no background, and at k ≠ 0 the satellites are reflections of their own, so Finding 1's cause is absent; at k = 0 the scale trades as on powder. Not measured |
| mPDF `momentFit` (`pdfPage.ts:1283`) | G(r) fit, the nuclear scaffold and the envelope rows frozen | Not in this change. A different quantity trades there (the ordered scale against \|m\|). Not measured |
| `magneticReportSection` (`reportInputs.ts:236`) | the report's moments, esds and the sentence about how they were refined | Reads the page's rows and last result; needs B's wording |
| `reportNotYet` (`agent/executorPolicy.ts:145`) | the report gate: the instrument pass must be the last converged refinement | Later step (model-visible) |
| `localMagneticDemoSolve.test.ts:176–198` | writes the local demo's solution file (the moment the demo opens on) | Yes: its step 4 must alternate; its assertion "not one nuclear row moved" becomes "only the scale and the background moved"; its comment at 180–181 is not what the measurement shows |
| `realLocalMagneticBenchmark.test.ts` (data-gated) | its own moments-only fit and ranking | Its own closure: moves only if switched to the page's fit. To decide in step 2 |
| MCP `refine_magnetic_powder` (`mcp/tools.ts:869`) | the caller chooses the free set | No built-in sequence. Its method text (`my-rietveld-workflow/mcp-tools.md`) is model-visible: later step |
| scripted runs: `agent/evals/replays.ts:177`, `agent/replay/demoReplays.ts:83` | `refine_moments`, then the instrument pass, then the report | Later step, with the gate |

## What A and B need that the code does not have

These are the points to settle before building. Each comes from reading the
call sites, and the first three change the shape of the work.

1. **The rounds move two nuclear rows, and the step cannot hand them back.**
   A moments fit returns moment values and an agreement (`MomentFit`), and
   Continue hands only the moment rows to the page. If the scale and the
   background of the rounds are not written to the page, Continue puts
   converged moments on a page that still holds the nuclear-only scale and
   background: the pattern drawn is not the one fitted, and the next
   moments-only Refine there takes the moments back to the biased value. The
   fit must return the nuclear rows it moved, and the page must take them
   (one History step for the whole fit).
2. **The esd the report prints is not the step's.** The step's fit reports no
   esd at all. The report reads the esds of the refinement page's last
   result. So B belongs in the engine's result for a refinement whose free
   rows are all magnetic (an option naming the held rows the covariance
   includes), not only in the step. The result's esd keys must stay the
   refined rows: `reportNotYet` and `magneticReportSection` both read "what
   was refined" off those keys.
3. **k = 0 needs one rule.** Today Rank frees the scale and Refine moments
   holds it. Proposed: Refine moments alternates at k = 0 as everywhere, with
   the scale held in the moments step (the rule as written; up to seven
   rounds). The alternative, the scale free with the moments as the ranking
   does, ends on the same moment in two or three rounds but is a moments step
   with a nuclear row free. The owner's choice.
4. **The nuclear-only agreement must be kept from before the rounds.** The
   step's "nuclear-only wR" is computed from the page's nuclear curve at the
   current scale and background. After the rounds those are the values that
   fit nuclear + magnetic, so the nuclear-only wR read then is worse than the
   nuclear-only fit's own. The baseline should be the one recorded before.
5. **A cap is needed, and it will be met.** On the local demo dataset one
   losing three-parameter group (one row 0.13 ± 0.30) was still moving by
   0.12 esd after eight rounds. That was in the ranking comparison, which
   will not alternate; a chosen model with an undetermined row can do the
   same. The fit must say so and not loop.
6. **Rows held in the rounds stay biased.** The width keeps its nuclear-only
   value: no effect on model A's moment, 0.3 esd on each of model B's
   components (above). With the width in the rounds that goes. The Copilot's
   final instrument pass followed by a moments-only refinement does the same
   in its flow; in the app the user has Show on refinement pattern for it.
   Whether the rounds should include the peak-shape rows is open: it removes
   the 0.3 esd here, on a one-parameter Gaussian; a full profile (U, V, W, X,
   Y, asymmetry, or the TOF terms) with the moments held was not tested and
   is what the method's firm rules guard. Positions and ADPs in the rounds
   were not tested either.
7. **The wording of the rule.** Every moments step holds the whole nuclear
   model, and no step frees nuclear and magnetic rows together. But the scale
   and the background at the end are not the nuclear-only fit's. The demo
   solve's assertion and the report's "the nuclear model as a fixed
   reference" need the owner's wording.
8. **Which scale rows.** On a multi-phase page the rounds would refine every
   untied scale row, as `freeScale` does. A second phase's scale next to weak
   satellites was not tested.

Is B sound when background terms correlate with a moment? In every case
measured the scale carries the difference (model A: the full esd is 1.12
times the moments-only esd with six background terms and 1.11 with one). No
case was found where it is not sound. A covariance that cannot be inverted (a
background term the window does not determine) must fall back to the
moments-only esd and say so; that path is not exercised yet.

## What will move

**Numbers a user sees**

- Refine moments' moment and wR at k ≠ 0 wherever the nuclear-only fit took
  up satellite intensity; at k = 0 always.
- The scale and the background rows after Refine moments.
- The moment esds of a moments-only refinement (larger: 3 to 29 % here).
- The local demo's solution file (in the owner's data folder, written by the
  solve test): the moment the demo opens on. To be regenerated by the owner's
  run, not in CI.
- Refine moments' time: one fit becomes up to 21 (0.2 s → a few seconds).

**Tests to re-run and re-read in step 2** (they call Refine moments, the
step's fit or its tool; none is known to fail yet)

- `app/magneticStep.test.ts`, `app/powderPage.test.ts`,
  `app/mcifMagneticModel.test.ts`, `testSupport/magneticHeadless.ts` users
- `agent/magneticTools.test.ts` (the moment and wR after `refine_moments`),
  `agent/strongMagneticPeaks.test.ts` (`refine_moments` at k = 0),
  `agent/pages/stamp.test.ts`, `agent/toolScope.test.ts`
- `core/workflow/k0MagneticBias.test.ts`,
  `core/magnetic/momentRestarts.test.ts`, `workers/magneticMultiStart*.test.ts`
- data-gated: `examples/localMagneticDemoSolve.test.ts`,
  `examples/localMagneticDemo.test.ts`,
  `core/workflow/realLocalMagneticBenchmark.test.ts`
- this change's own: `app/momentSequenceBias.test.ts` (its `it.fails` turns
  red when the fix lands, and its "documented" tests are replaced)

**Model-visible, later step**

- `.claude/skills/magnetic-analysis/SKILL.md` (Stages 3–5) and `notes.md`;
  `.claude/skills/my-rietveld-workflow/mcp-tools.md`
- `agent/tools.ts` (`refine_moments`, `continue_magnetic_refinement`
  descriptions), `agent/magneticTools.ts` (the next-step lines)
- `agent/executorPolicy.ts` (`reportNotYet` and its message),
  `agent/executor.ts:391`, `agent/reportGate.test.ts`
- `agent/__snapshots__/model-text.arm-b.md`, `model-text.arm-c.md`
- `agent/evals/checks.ts` (`magneticRefinesMomentsOnly`,
  `refinesMomentsAlone`), `agent/evals/graders.test.ts`,
  `agent/evals/replays.ts`, `agent/replay/demoReplays.ts` and their replay
  tests; the generated `docs/AGENT_TOOLS.md`

**Documents**

- `README.md:110–112` (the order of the magnetic step and the gate)
- `docs/USER_GUIDE.md:418` (Refine moments) and `:1104` (the report waits)
- `docs/LIMITATIONS.md:362–392` (the bias is not listed today)
- `docs/VALIDATION.md` (a row for the known-truth test)
- `docs/DEMO_SCRIPT.md:90`, `docs/demo-qa.md:40` (Refine moments' time),
  `docs/MAGNETIC_SYMMETRY.md`, `docs/REFINEMENT_NOTES.md`, `CHANGELOG.md`

No public document quotes a refined moment of the local demo dataset.

## What it means for the validation

Nothing yet: no behaviour changed. With the fix, arm A's pinned results that
pass through `refine_moments` are re-read; arms B and C change with the
method and the gate, in the later step.

## Test plan for the fix (step 2)

1. Turn the `it.fails` target into a plain test, through the page's own
   `powderMomentFit`: within 3 esd of the truth in every seed, models A and B.
2. The fit's moment equals the joint fit's within 0.05 esd; the joint fit
   stays in the test only.
3. The nuclear rows the fit moved reach the page; a moments-only Refine on
   the refinement page after Continue then moves no moment by more than
   0.1 esd.
4. The esd of that Refine equals the joint fit's esd within 1 %, and its
   result's esd keys are the moment rows only.
5. The cap: a model with an undetermined row ends, and says it did not settle.
6. k = 0: Refine moments after Rank does not lower a ranked moment beyond its
   esd; the ferromagnet is recovered within 3 esd.
7. The ranking's tests unchanged; its results bit-identical to `main`.
8. The many-seed run repeated through the page's fit (local script, below).
9. Every test listed under "What will move" re-run; the published Mn₃Ga
   comparisons shown unmoved.

## Not done

- The fix (A, B), and the eight points above, three of which wait for the
  owner: the k = 0 rule, the wording of "the nuclear model held", and whether
  the single-crystal and mPDF fits follow.
- The Copilot's method, gate, tool descriptions, snapshots, evals and replays.
- Single crystal and mPDF: not measured.
- Positions, ADPs or profile rows in the rounds: not tested.
- A second k ≠ 0 compound, a time-of-flight profile and a multi-phase page by
  independent calculation. Time of flight is covered only by the local demo
  dataset, through the app's own code.
- The audit's Findings 3–5.

## Checks

At this commit: `npm run build`, `npm run lint`, and
`npx vitest run src/app/momentSequenceBias.test.ts` (14 tests, 8 s). `npm test`: 404 files
passed, 36 skipped (data-gated or opt-in); 3566 tests passed, 336 skipped.

The many-seed tables are from

```
MOMENT_SEQUENCE_SEEDS=200 MOMENT_SEQUENCE_OUT=<folder> npx vitest run src/app/momentSequenceSeeds.test.ts
MOMENT_SEQUENCE_RANK=12   MOMENT_SEQUENCE_OUT=<folder> npx vitest run src/app/momentSequenceSeeds.test.ts
```

(8.5 minutes and 5.5 minutes on a laptop; skipped in the suite). Fixed
seeds: the same numbers on every run.

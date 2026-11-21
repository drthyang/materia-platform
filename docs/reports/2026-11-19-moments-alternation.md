# The moments fit: a bias from the nuclear-only fit, removed by rounds

Branch `fix/moments-alternation`, 2026-11-19/20, draft pull request
[#174](https://github.com/drthyang/materia-platform/pull/174).

**Status.** Four steps, all done: the known-truth test and the plan; the
engine and the app; what the Copilot's model reads (its tool, its method, the
report gate, the evals); the documents. The owner decided the three open
choices on 2026-11-20, each as built ([The owner's
decisions](#the-owners-decisions)).

**In one paragraph.** One moments fit after a nuclear-only fit read 4.06 µB for
a true 4.2 µB (10 esd low) on a pattern calculated without the app's code.
**Refine moments** on the powder page now runs as rounds: the moments with
every nuclear row held, then the scale and the background with the moments
held, then the moments again, until no moment moves by 0.1 of its esd. It ends
on a moments step and never refines a moment and a nuclear row together. It
reads 4.200 over 48 seeds, the joint fit's answer, with an esd that includes
the scale and the background and matches the scatter. The Copilot's method
now ends on a refinement of the moments alone after its final instrument pass,
and the report waits for it.

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
**Refine moments** did not: it held the scale. On a k = 0 ferromagnet a group
ranked at 4.155 µB was taken back to 3.520 µB by Refine moments (truth 4.2).

The Copilot's method ends on a final instrument pass (instrument terms, scale
and background, the moments held), and the report gate requires that pass to
be the last refinement. The moments were therefore never refined against the
scale and background the report is written with.

The sections down to [The ranking](#the-ranking) are the measurements taken
before the change ("today" in them is `main`). What was built follows them.

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
- The page's own single fit (`powderMomentFit`, eight seeds) gave 4.0606: the
  same number as the test's harness, to four decimals. It is still what the
  ranking's one fit per group gives, by decision.
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
- What moves at k = 0 is the app's own Refine moments, which on `main` takes a
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
  groups that contain the truth). So a group's wR in the ranking table (one
  fit) is higher than the wR Refine moments then reports for it. A line beside
  the table now says so.

## What was built

| Change | Where |
| --- | --- |
| **The rounds.** A moments step (every nuclear row held), then per round a step between (the scale and the background, the moments and every other row held) and a moments step again. Sans-io: it is handed the page's fit. The stopping rule and the one switch for k = 0 live here | `core/magnetic/momentAlternation.ts` (`alternateMoments`, `ALTERNATION_SHIFT_TOLERANCE`, `ALTERNATION_MAX_ROUNDS`, `K0_SCALE_WITH_MOMENTS`) |
| **Refine moments asks for rounds; the ranking does not.** The powder page's fit runs the rounds when the step asks (`FitOptions.rounds`), and one fit otherwise, exactly as before. The rows of the rounds are every untied scale row (each phase's, as `freeScale` frees them) and every background row | `powderMomentFit`, `momentRoundValues` (`app/powderPage.ts`); `MagneticStep.refineMoments` (`app/magneticStep.ts`) |
| **The rows go back to the page.** A fit returns the scale and background it ended on (`MomentRounds.held`); the step hands them to its page (`StepInputs.onMomentFit`), which writes them onto its rows as one History step, "Moments refined (scale and background re-refined)". Continue and Show then put the moments on a page that holds the rows they were fitted with | `withMomentRoundRows` (`powderPage.ts`); `PowderWorkbench.tsx`; the headless page (`testSupport/magneticHeadless.ts`) |
| **The esd, in the engine.** A refinement may name held rows whose uncertainty its esds are to include (`esdWith`). The covariance is formed over the refined rows and those at the final point; nothing is stepped in them. `esd` stays keyed by the refined rows; `diagnostics.esdIncludes` lists the held rows included. A covariance that drops a direction leaves the esds of the refined rows alone, and `diagnostics.esdWithFailed` says why | `core/refinement/engine.ts`, `types.ts` |
| **Who asks for it.** Every moments step of the rounds, and the refinement page's **Refine** whenever its free rows are magnetic only (the moments, and k): the esd the report prints. Any other free set gets its own esds, as before | `alternateMoments`; `momentEsdOptions`, `powderFit` (`powderPage.ts`) |
| **The nuclear-only baseline is kept.** The step records the nuclear-only wR from before a fit's rounds, with the rows they handed back. While the page holds those rows, that is the baseline the step shows and compares with; once the page's rows differ (a nuclear refinement, a reset, an undo) the page's own value stands again | `StepState.nuclearOnly`, `StepView.baselineAgreement` |
| **The round is shown, and Cancel works.** The button reads "Refining… round n"; Cancel stops after the fit that is running. A stopped fit, or one whose model or data changed under it, leaves the page, the amplitudes and the readout as they were: the fit is applied whole at its end or not at all | `MagneticStep.cancelRefine`, `StepState.refineRound`; `KSearchPanel.tsx` |
| **The cap says so.** At ten rounds the last moments step is kept and the readout says the fit did not settle, with the last shift | `momentFitReadout` (`magneticStep.ts`) |
| **The local demo's solve** runs the rounds for its last step, and has a dry mode that writes nothing | `examples/localMagneticDemoSolve.test.ts` |

The single-crystal and mPDF moment fits are unchanged (they ignore the request
for rounds). What the model reads changed in step 3, below.

### The stopping rule, as built

After each round, each free moment row is compared with its value one round
before, in the esd its moments step just reported (the esd that includes the
scale and the background).

- **Settled** when every row moved by less than 0.1 esd.
- At least one round; **at most ten**. At the cap the last moments step is
  kept and the fit says it did not settle.
- On noise-free data the esds shrink with the misfit, so a shift cannot be
  measured in them. The rounds also end when the fit is exact (wR below 10⁻⁶,
  the engine's own line) or when no row moved by more than 10⁻⁴ of its size
  (the app's rounded γr₀/2 alone is 1.5·10⁻⁴ of a moment).

What is left against the joint fit when a round's shift falls below 0.1 esd is
that shift times r/(1 − r), r being the contraction per round. Through the
step, on the patterns above:

| case | rounds | left against the joint fit |
| --- | --- | --- |
| A, k = (½,0,0), 48 seeds | 4 in every seed | below 0.05 esd (first eight seeds, each) |
| B, two rows, 8 seeds | 4 in every seed | below 0.05 esd per row |
| k = 0 antiferromagnet, 4 seeds | 4 | not compared |
| k = 0 ferromagnet, scale held | 6 | 0.07 esd |
| the local demo dataset (dry run of the solve) | 3 | the audit's 2.597 µB reproduced |
| noise-free: A; the k = 0 ferromagnet | 5; 9 | 4.2004 and 4.2001 for 4.2 |

The esd that includes the scale is larger than the moments-only esd, so the
rule stops a round earlier than it would with shifts measured in the latter,
where the two differ most (the k = 0 ferromagnet: 6 rounds; step 1 measured 7
that way, and 4 to 5 for model A). A fit that settles just inside the cap (r
about 0.6) can leave about 0.15 esd. A slower one reaches the cap and says so.

The map of every place a moments-only fit is called, and the points the plan
raised before building, are in this report's first version (commit a0f27ad).

### Through the step, in numbers

All through `MagneticStep` on a page after its nuclear-only fit, as the panel
and the Copilot drive it (`app/momentSequenceBias.test.ts`).

| | before | after |
| --- | --- | --- |
| A: mean over 48 seeds (truth 4.2) | 4.06 (one fit; 8 seeds) | 4.2001 |
| A: scatter / quoted esd | 0.70, with the moment 10 esd off the truth (1000 seeds, harness) | 0.88 over 48 seeds (±10 %); 0.98 over 1000 seeds in the harness, whose joint fit the step equals seed by seed |
| A: esd of the moment | 0.0091 (moments alone) | 0.0102, the joint fit's to three figures |
| B: mean over 8 seeds (truth 3, 2) | 2.889, 1.963 | 2.997, 1.997 |
| k = 0 ferromagnet, seed 0: ranked, then Refine moments | 4.155, then 3.520 | 4.155, then 4.224(41) |
| k = 0 antiferromagnet, 4 seeds | 4.00 (200 seeds) | 4.228(27), 4.181(26), 4.210(27), 4.204(26) |
| a moments-only Refine on the refinement page after Continue | takes 4.2 back to 4.06 if the page still held the nuclear-only scale and background | moves the moment by less than 0.1 esd; esd keyed by the moment row only, equal to the joint fit's |
| the step's nuclear-only wR after Refine moments | would read the page's own curve, 0.2 % and more above the nuclear-only fit's | the value from before the rounds |

## What a user sees

- **Refine moments** takes several fits where it took one: 0.9 s on the
  bundled Mn₃Ga + MnO page (one round), 0.15–0.5 s on the test patterns (four
  to nine rounds). The button shows the round; **Cancel** appears beside it.
- Under the button, one line, the result first: `wR = 5.0% · settled in 4
  rounds`. Its "?" (the line itself opens it) gives the wording below, what a
  round is, why it stopped, that the page's scale and background rows changed,
  and each amplitude's esd.
- A fit at the cap reads, in the warning colour: `wR = 7.7% · not settled
  after 10 rounds (a moment still moved by 0.12 esd)`.
- The page's scale and background rows hold the re-refined values, and
  History has a step for it. Undo restores them. A model shown or continued
  on the refinement page follows the fitted moments.
- The "nuclear only" chip beside the ranking keeps the nuclear-only fit's wR.
- Beside the ranking table, after a ranking: "Ranked with one moments fit per
  group; Refine moments also re-refines the scale and the background, so its
  wR can read lower."
- On the refinement page, a Refine of the moments alone says: "Moments
  refinement converged (nuclear model held): wR = …. The moment esds include
  the scale and the background." Those esds are larger than before: 3 to 29 %
  on the patterns above.
- **At k = 0.** Rank still fits each group once with the scale free, so a
  ranked moment reads 1–2 % low (the background is the nuclear-only fit's).
  Refine moments on the chosen group then goes to the settled value: on the
  ferromagnet 4.155 in the ranking table, 4.224(41) after Refine moments,
  truth 4.2. It no longer takes a ranked moment down. It takes more rounds
  than at k ≠ 0 (six here), and its esd is 30 % above the moments-only one,
  because the scale and the moment trade.

Browser check, on the built app with the public Mn₃Ga + MnO demo (k = 0,
Cm′cm′): Refine moments ran one round and settled (the magnetic signal of
that pattern is weak; its own ranking says no group improves on the
nuclear-only fit), the button showed "Refining… round 1", Cancel stopped a
run and left the readout and the chip as they were, the line and its details
showed, the note showed beside the ranking table after an 18 s ranking,
History listed the step, and Continue put the moment rows on the refinement
page. No console error. More than one round was not shown in the browser;
that is covered through the step's store in the tests.

## What the Copilot's model reads (step 3)

### The order, and why

1. **Stage 3, `refine_moments`**: the rounds. The moments, the scale and the
   background settle together; the two rows go to the page.
2. **Stage 4**: `continue_magnetic_refinement`, every nuclear row fixed,
   `refine` of the moments alone on the refinement page (with k's components
   where they refine). After the rounds nothing moves; this is where k
   refines, and where the page gets a result with the moments' esds.
3. **Stage 5, the final instrument pass**: the instrument's terms with the
   scale and the background, the moments held.
4. **Stage 5, the moments alone once more**: `set_free` the moments, `refine`.
   The report quotes these.

The last step is the page's `refine`, not `refine_moments`, because the report
prints the page's rows and the esds of the page's last refinement.
`refine_moments` works on the step's candidate and leaves the page without a
result, so a report written after it would carry no moment esds. The pass has
just refined the scale and the background with the moments held, so the pass
and the last refinement are one more round of the rounds, with the peak shape
in the step between.

**The rule for the last tweak** (the owner's: the moments stay within their
esds across the profile pass, and a larger move means the profile trades with
the model). `refine` of the magnetic rows alone now returns
`momentShiftOverEsd`, the largest move of a moment in that refinement in its
esd; after the pass, which held the moments, that is their move across the
pass. Above 1, the pass and the moments are run once more; still above 1, the
peak shape trades with the magnetic model: undo the passes, hold those terms,
report it. One repeat is allowed because the first pass after a peak shape
fitted without the magnetic intensity is a correction, not a trade, as the
second case below shows.

**Numbers.** Independent MnWO₄, through the page's own Refine (four seeds
each; the reference is a fit of scale, background, width and moments
together, which no step runs):

| | moved across the pass | from that joint fit after the last step | wR: stage 4 → pass → last |
| --- | --- | --- | --- |
| model A, one row | 0.04–0.05 esd | 0.01 esd | 5.013 → 4.973 → 4.973 % (seed 0) |
| model B, two rows | 0.27–0.31 esd each | 0.01, 0.00 esd | 5.077 → 5.025 → 5.025 % (seed 0) |

Stage 4 after the rounds moved no moment by more than 0.1 esd. So the order
ends on the joint answer, and the 0.3 esd the held width cost model B
([Finding 1](#finding-1-in-numbers)) is gone.

The scripted run on the simulated Mn₃Ga 30 K pattern (k = 0, P2₁′/m′, six
amplitudes, simulated by the app's own model from the published structure; the
peak shape there is never refined with the magnetic intensity in the model
before the pass), each amplitude against its simulated value:

| | the six amplitudes, in esd from the simulated values | \|M\| on the three Mn (true 2.527, 2.829, 2.530 µB) |
| --- | --- | --- |
| the method before this change (one moments fit, the pass, the report) | −6.1, −2.4, +1.1, −1.1, −4.6, −3.8 at stage 4 | 2.15–2.83 as the old replay quoted |
| `refine_moments` (8 rounds), stage 4 | −1.8, +0.3, +0.2, −0.6, −0.4, −0.4 | 2.46, 2.82, 2.51 |
| the pass, the moments (moved 1.7 esd) | −0.4, −0.3, −0.5, +0.1, −1.0, +0.4 | |
| the pass and the moments once more (moved 0.36 esd) | 0.0, −0.1, −0.6, +0.2, −0.6, +0.6 | 2.52, 2.82, 2.52 |

A third run moved them by 0.23 esd. The first pass's 1.7 esd took every
amplitude toward its simulated value: a correction. Read as a trade and
undone, the result would have been worse, which is why the rule repeats the
pass once before it calls a trade.

### Every string the model reads that changed

**`refine_moments`, description** (in both model-text snapshots)

- Old: "Powder page only. Fit the chosen group's moment amplitudes against the
  pattern, the nuclear model held fixed. Returns wR and the moments (µB)."
- New: "Powder page only. Fit the chosen group's moment amplitudes in rounds:
  the moments (nuclear rows held), then the scale and background (moments
  held), until no moment moves by 0.1 esd; at most 10 rounds, ending on the
  moments. The page's scale and background rows take the re-refined values.
  Returns wR, the rounds, the moments (µB) and their esds. "not settled": the
  data do not determine a moment; tie or hold it."

**`refine_moments`, result**

- Old: "Moments fitted: wR 4.82%."
- New: "Moments fitted, settled in 8 rounds: wR 4.82%. The page's scale and
  background rows hold the re-refined values." or "Moments fitted, not settled
  after 10 rounds, a moment still moved by 0.12 esd: wR …".
- Its `chosen` view: each amplitude with its esd ("mom_Mn1_0_0 = 1.497 ±
  0.044"), and `momentsFit`: "settled in 8 rounds; the esds include the scale
  and the background". `magnetic_state` shows the same.
- Its approval card: "…, nuclear model held" → "…, nuclear structure held,
  scale and background re-refined".

**`magnetic_state` / `get_state`, the step's `next` line**

- Old: "refine_moments: fit the chosen group's moments, the nuclear model
  held" → New: "refine_moments: fit the chosen group's moments (the nuclear
  structure held; the scale and the background re-refined with the magnetic
  model)".
- Old: "the moments are fitted: refine the nuclear and magnetic models
  together on the refinement step, then report the group, k and the moments
  with what the powder cannot tell" → New: "the moments are fitted:
  continue_magnetic_refinement puts them on the refinement step; report the
  group, k and the moments with what the powder cannot tell". The old line
  told the model to refine nuclear and magnetic together, against the rule.
  After a fit that did not settle it starts "the moments fit did not settle
  (…): tie or hold the component the data do not determine, or refine_moments
  again; then".

**`refine`, result, for a refinement of the magnetic rows alone**: two new
fields, `momentShiftOverEsd` and `esdsInclude: "the scale and the background
(held)"`.

**The report gate** (`reportNotYet`), two messages now

- Before a pass, line "Not yet: the final instrument pass" as before. In its
  message "ends with a final instrument pass (magnetic-analysis Stage 5)" →
  "ends with a final instrument pass and then the moments again
  (magnetic-analysis Stage 5)", and "Then write the report, quoting the fit
  before and after the pass." → "Then refine the moments alone once more, and
  write the report, quoting the fit before and after the pass."
- New, after a pass, until the last converged refinement is of the magnetic
  rows alone, line "Not yet: the moments after the instrument pass": "Not yet.
  The final instrument pass is done; my-rietveld-workflow's magnetic step ends
  on the moments (magnetic-analysis Stage 5): the pass moved the scale, the
  background and the peak shape under them. Hold every nuclear row (set_free:
  fix the instrument's terms, the scale and the background; free the moments,
  and k's components if they refined) and refine to convergence. That
  refinement's momentShiftOverEsd is the moments' move across the pass: above
  1, run the pass and the moments once more; still above 1, the peak shape
  trades with the moments: undo the passes, hold the terms that correlate with
  them, and say so. Then write the report, quoting the fit before and after
  the pass."
- The gate knows a pass has run from the History's path to the page as it
  stands (undo takes it off), or, on a page with no History, from what this
  run saw. Every other gate is as it was.

**The skill `magnetic-analysis`** (its body is held to 10 000 characters: 9995
before, 9996 now, so each addition is paid for by a cut)

- Stage 3, item 3: "`refine_moments`, the nuclear model held. Check the
  result:" → "`refine_moments` (rounds with the scale and background: notes).
  Check the result:" with a new first check, "Not settled: tie or hold the
  component the data do not determine, and say so."
- Stage 4, its rule: "The user's rule: the moments refine against the nuclear
  model as a fixed reference. The scale, background, cell, instrument terms,
  positions, ADPs and occupancies stay at their nuclear values (until Stage
  5)" → "The user's rule: the moments refine with the nuclear model held. The
  scale and background stay as `refine_moments` left them, the rest at its
  nuclear values (until Stage 5)".
- Stage 5, its title: "the final instrument pass (always; the report waits for
  it)" → "the final instrument pass, then the moments (always; the report
  waits)"; and a new closing paragraph: "Then the moments alone once more; the
  report quotes these. If that `refine`'s `momentShiftOverEsd` (their move
  across the pass) is above 1, repeat the pass and the moments; still above 1,
  the peak shape trades with the model: `undo` the passes, hold those terms,
  report it."
- Cut to make room: the opening paragraph shortened ("written from the app's
  workflow and the magnetic knowledge base; the user has not been interviewed
  on it yet, so" → "a draft the user has not been interviewed on:"); Stage 4's
  "`show_magnetic_model` instead holds the moments." (its tool description
  says it); the tool table's rows "The step's state" and "Residual peaks"
  (the same tool names on both sides); the three reference lines shortened.
- Its notes (read on demand, not budgeted): a new section on the rounds with
  the MnWO₄ numbers and the hand alternation over MCP; the Stage 5 note
  rewritten for the last moments refinement, with the two cases above.

**The report's sentence** (`magneticReportSection`, the current layout only;
the frozen layout's words are unchanged): "Moments refined against the powder
pattern with the nuclear model held; the moment esds come from that fit." gains
"and include the uncertainty of the scale and the background" when they do.
The report's step list shows "Moments refined (scale and background
re-refined)" for the step the page records.

Not changed: the system prompt, `continue_magnetic_refinement`,
`show_magnetic_model`, `my-rietveld-workflow` and its MCP tool map (they name
no sequence that changed).

### Re-baselined

- `src/agent/__snapshots__/model-text.arm-b.md` and `model-text.arm-c.md`:
  one line each, the `refine_moments` description.
- `docs/AGENT_TOOLS.md` (generated): the same description.
- `src/agent/replay/demoReplays.ts`, `magnetic-30k`: `refine_moments` after
  the group is chosen; the pass frees the scale and the background with the
  peak shape, as the skill says; then the moments, the pass and the moments
  once more, and the report. Its narration quotes the new numbers.
  `evals/replays.ts` takes its good run from it; its bad run now also shows
  the new check failing.
- `src/agent/evals/checks.ts`: a new check, `magneticEndsOnMoments` ("ends the
  magnetic step on the moments, after the final instrument pass"), on
  `magnetic-30k`; `graders.test.ts` has its cases. `docs/AGENT_EVALS.md`: 60 of
  67 checks shown to catch their failure (59 of 66 before), and the scenario's
  line.
- `src/agent/reportGate.test.ts`: rewritten for the two conditions and the
  History's path.
- `src/agent/magneticTools.test.ts`: the result line's pattern.
- `src/docsCounts.test.ts`: no count of its own moved.

The local eval gate (the scripted, no-model replays CI runs:
`evals/evals.test.ts`, `replay/replay.test.ts`, `graders.test.ts`,
`heldOut.test.ts`): all pass. Each scenario's good run passes its checks, each
bad run fails the checks written against it, and the `magnetic-30k` replay
runs the new order through the executor and its gate to a written report.

### Token cost

- The model text sent with every request: arm B 92 318 → 92 589 bytes, arm C
  85 394 → 85 665 bytes. +271 bytes each (+0.3 %), about 70 to 90 tokens.
  It is one tool description. Longer wordings pushed the local-model context
  estimate over its next 8 192-token step in `chat.test.ts`; the description
  was cut until it did not.
- The skill, read once per magnetic analysis: +1 character.
- The notes, read only when the model opens them: 3 618 → 5 770 bytes, about
  +600 tokens.
- Tool results: `refine_moments` about +110 characters and an esd per
  amplitude; `refine` of the moments alone about +70; the new gate message
  about 640, only when the report is asked for too early.
- A run of the method is longer by one `set_free` and one `refine` (two of
  each when the pass repeats).

### Live scenarios to run again, with the owner's yes

No live model was run. The scripted runs show the tools and the gate work;
only a live run shows a model follows the new text.

- `magnetic-30k` (changed most: new check, new ending, the repeat rule).
- `magnetic-structure` and `magnetic-step-first` (`refine_moments` and the
  step's `next` line changed).
- `local-data-user-flow` where the data are (its magnetic part reads the same
  tools).
- One non-magnetic powder scenario as a control (`full-refinement`): the
  model text grew by one description.

## The owner's decisions

Decided 2026-11-20, each as built:

1. **k = 0: the scale is held in every moments step**, as at k ≠ 0 ("we
   usually don't refine the scale"). `K0_SCALE_WITH_MOMENTS` stays `false`;
   the other choice remains behind that constant and is tested.
2. **The step between refines the scale and the background only**, no peak
   width.
3. **The wording**: "Nuclear structure held; scale and background re-refined
   with the magnetic model."

## Tests

New, and failing on `main`:

- `core/refinement/engine.test.ts`, "esdWith": the joint fit's esd from a fit
  of one parameter with the other named, by hand as well; the fallback when
  the two cannot be told apart; the same under the parallel driver.
- `app/momentSequenceBias.test.ts` (24 tests, about 25 s), through the step:
  A over 48 seeds within 3.5 esd each, the mean within its error, the scatter
  of the esd's size, the first eight equal to the joint fit in moment and esd;
  B; the ranking's one fit pinned; the rows handed back and the moments-only
  Refine after Continue; the baseline; a model shown or continued on the page
  following the fit; Cancel in the second round and a model changed under a
  fit; the cap (two rounds allowed) and its message; the readout; k = 0
  through the step, both choices; the method's order (the moments, the pass,
  the moments) against a joint fit with the width; noise-free data.
- `agent/reportGate.test.ts`: the two conditions of the gate, and the pass on
  the History's path. `agent/evals/graders.test.ts`: the new check.

Existing tests changed, and why:

- `app/magneticStep.test.ts`, "fits the moments through the page's compute
  client with the phase gauge held": it counted one fit. It now reads the
  sequence: a moments step, a step between, a moments step, the gauge held in
  every moments step and no moment free in a step between.
- `examples/localMagneticDemoSolve.test.ts` (data-gated, writes the owner's
  solution file): its last step runs the rounds, and asserts that of the
  nuclear rows only the scale and the background moved. Run dry (nothing
  written): 3 rounds, the audit's 2.597 µB, the same group chosen. **The
  solution file was not regenerated**; the local demo opens on the old moment
  until the owner runs the solve.

Re-read and unchanged, passing: `app/powderPage.test.ts`,
`app/mcifMagneticModel.test.ts`, `agent/strongMagneticPeaks.test.ts`,
`agent/pages/stamp.test.ts`, `agent/toolScope.test.ts`,
`core/workflow/k0MagneticBias.test.ts`,
`core/magnetic/momentRestarts.test.ts`, `workers/magneticMultiStart*.test.ts`,
and the published Mn₃Ga comparisons (`mn3ga350KGolden.test.ts`,
`magneticCif.test.ts`), which call none of the changed code.

Local data, read-only: `examples/localMagneticDemo.test.ts` (3) and
`core/workflow/localHexMagneticGolden.test.ts` (7) pass.
`realLocalMagneticBenchmark.test.ts` and `realLocalMagnetic.test.ts` skip:
the files their own gates ask for are not in the data folder.

## What it means for the validation

Arm A (the scripted runs): the `magnetic-30k` replay was rewritten for the new
order and passes its scenario's checks, the new one included; every other
replay and grader is unchanged and passes. Arms B and C (live models) read a
changed `refine_moments`, a changed `next` line and, with the skills, a method
that ends differently: the scenarios listed under [Live scenarios to run
again](#live-scenarios-to-run-again-with-the-owners-yes) are a new baseline,
not a comparison with the old runs. `magnetic-30k` has one more check than the
runs on record.

## The documents (step 4), and two gaps closed

- `docs/USER_GUIDE.md`: Step 5 (what Refine moments does, its line, Cancel,
  "not settled"), the ranking (why its wR and moments differ from Refine
  moments), Refine of the moments alone, and the Copilot's rules.
- `docs/LIMITATIONS.md`, Magnetic structures: what works now, and what
  remains (below).
- `docs/VALIDATION.md`: the known-truth row.
- `README.md`: the sentence on the magnetic step's order and the gate.
- `docs/demo-qa.md`: Refine moments' time since the rounds (0.9 s on the demo
  page). `docs/DEMO_SCRIPT.md` needed nothing: it shows the ranking, whose
  description still holds.
- `docs/AGENT_EVALS.md`: the check count and the scenario's line.
- `CHANGELOG.md`, Unreleased: Changed (Refine moments; the Copilot's method)
  and Fixed (the bias; k = 0; the esd).

**A model shown on the refinement page follows Refine moments.** The step
hands the fitted model with the rows; a page that shows that same model (by
group, k and sites), through Show or through Continue's rows, shows it at the
fitted moments. A page showing another model keeps it. The History step is
recorded only when something on the page moved.

**The nuclear-only baseline in the project file: not done.** It would add a
field to the saved session, which is a change of the project format, if an
additive one. Left as it is, and listed below.

## Not done

- The owner's solution file for the local demo. It is theirs to regenerate:
  `LOCAL_MAGNETIC_SOLVE=1 MATERIA_DATA_DIR=<the data folder> npx vitest run
  src/examples/localMagneticDemoSolve.test.ts` (`=dry` writes nothing). The
  moment in it goes from 2.508 to 2.597 µB, with the scale, the background and
  the fit's wR.
- Live runs of the scenarios above.
- The rule for the last tweak is the method's text and a number the tool
  returns (`momentShiftOverEsd`); the gate does not enforce it.
- The recorded nuclear-only baseline lives in the step, not in the project:
  a reopened project shows the page's own value.
- Over MCP there is no `refine_moments` and no `esdWith`: the skill's notes
  say to alternate `refine_magnetic_powder` by hand.
- Single crystal and mPDF moment fits: not measured, not changed.
- Peak-shape rows, positions or ADPs in the rounds: not built (the owner's
  decision for the peak shape), not tested.
- More than one phase's scale in the rounds: built (every untied scale row;
  both scales on the public demo), not tested against a known truth.
- A second k ≠ 0 compound, and a time-of-flight profile, by independent
  calculation.
- The audit's Findings 3–5.

## Checks

At the code's head (c40fc2d, with origin/main at 7832daf merged in; the commit
after it only fills in this section): `npm run build`, `npm run lint`, and
`npm test` once: 404 files passed, 36 skipped (data-gated or opt-in); 3584
tests passed, 336 skipped; 135 s.

Also run:

- step 2: the four local-data test files read-only against the owner's data
  folder (two ran, two skipped by their own gates); the local solve in its
  dry mode (21 s; no file in the data folder changed); the browser check on
  the built app;
- step 3: the scripted eval gate (in the suite); the `magnetic-30k` replay's
  numbers read from its own run;
- step 4: a second browser check of the final build on the public demo: Show
  on refinement pattern (page wR 5.02 % at the seed moments), Refine moments
  (4.2 %, one round), the History step after the Show step, and the
  refinement page at wR 4.24 % with the model at the fitted moments; no
  console error.

Not run: the 200- and 1000-seed scripts (step 1's results stand), any live
Copilot run or eval, any paid API, the solve that writes the owner's file.

The many-seed tables (step 1) are from

```
MOMENT_SEQUENCE_SEEDS=200 MOMENT_SEQUENCE_OUT=<folder> npx vitest run src/app/momentSequenceSeeds.test.ts
MOMENT_SEQUENCE_RANK=12   MOMENT_SEQUENCE_OUT=<folder> npx vitest run src/app/momentSequenceSeeds.test.ts
```

(8.5 and 5.5 minutes on a laptop; skipped in the suite; not re-run after step
1). They use the test's own harness, whose joint fit the step now equals.

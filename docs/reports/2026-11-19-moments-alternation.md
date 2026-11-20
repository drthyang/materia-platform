# The moments fit: a bias from the nuclear-only fit, removed by rounds

Branch `fix/moments-alternation`, on `main` at fcf7257, 2026-11-19/20. No pull
request yet.

**Status.** Step 1 (the known-truth test and the plan) and step 2 (the engine
and the app) are done. The Copilot's method, report gate, tool descriptions,
snapshots, replays and evals are a later step and are untouched. Three choices
are built on provisional defaults and wait for the owner; they are listed
under [Provisional](#provisional-awaiting-the-owner).

**In one paragraph.** One moments fit after a nuclear-only fit read 4.06 µB for
a true 4.2 µB (10 esd low) on a pattern calculated without the app's code.
**Refine moments** on the powder page now runs as rounds: the moments with
every nuclear row held, then the scale and the background with the moments
held, then the moments again, until no moment moves by 0.1 of its esd. It ends
on a moments step and never refines a moment and a nuclear row together. It
reads 4.200 over 48 seeds, the joint fit's answer, with an esd that includes
the scale and the background and matches the scatter.

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
be the last refinement. The moments are therefore never refined against the
scale and background the report is written with. That part is the later step.

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

Nothing the model reads was edited: no skill, tool description, gate message,
snapshot, replay or eval. The single-crystal and mPDF moment fits are
unchanged (they ignore the request for rounds).

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
  History has a step for it. Undo restores them.
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

## What changed for what the model reads

No text the model reads was edited, and the two model-text snapshots are
unchanged. Values it reads do change, and the later step must account for
them:

- `refine_moments` returns the wR of the rounds, and it changes the page's
  scale and background rows. Its description still says "the nuclear model
  held fixed". It does not report the rounds or a fit that did not settle.
- `magnetic_state`'s `nuclearOnlyWR` stays the nuclear-only fit's after
  `refine_moments`.
- `refine` with only magnetic rows free returns larger moment esds.
- History, and so the report's list of steps, has the new step label.
- The page's last result is cleared when the rows are handed back, as any
  change of a row clears it. In the method's order a refinement follows, so
  the report gate reads as before.

## Provisional, awaiting the owner

1. **k = 0: the scale is held in every moments step**, as at k ≠ 0 (the rule
   as written). The other choice, the scale free with the moments and the
   background alone between, is `K0_SCALE_WITH_MOMENTS = true`, one constant.
   It is tested: on the k = 0 ferromagnet it ends on the same moment (within
   0.1 esd) with the same esd in 3 rounds or fewer, where the default takes 6.
2. **The step between refines the scale and the background only.** The peak
   width keeps its nuclear-only value. Measured cost: nothing on model A, 0.3
   esd on each of model B's two components (above). The Copilot's final
   instrument pass followed by a moments refinement removes it in its flow.
3. **The wording**: "Nuclear structure held; scale and background re-refined
   with the magnetic model." It is one constant (`MOMENT_ROUNDS_SUMMARY`),
   shown in the readout's details and in the step's help.

## Tests

New, and failing on `main`:

- `core/refinement/engine.test.ts`, "esdWith": the joint fit's esd from a fit
  of one parameter with the other named, by hand as well; the fallback when
  the two cannot be told apart; the same under the parallel driver.
- `app/momentSequenceBias.test.ts` (20 tests, 19 s), through the step: A over
  48 seeds within 3.5 esd each, the mean within its error, the scatter of the
  esd's size, the first eight equal to the joint fit in moment and esd; B;
  the ranking's one fit pinned; the rows handed back and the moments-only
  Refine after Continue; the baseline; Cancel in the second round and a model
  changed under a fit; the cap (two rounds allowed) and its message; the
  readout; k = 0 through the step, both choices; noise-free data.

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
`app/mcifMagneticModel.test.ts`, `agent/magneticTools.test.ts`,
`agent/strongMagneticPeaks.test.ts`, `agent/pages/stamp.test.ts`,
`agent/toolScope.test.ts`, `agent/reportGate.test.ts`, the replay and grader
tests, the model-text snapshots, `core/workflow/k0MagneticBias.test.ts`,
`core/magnetic/momentRestarts.test.ts`, `workers/magneticMultiStart*.test.ts`,
and the published Mn₃Ga comparisons (`mn3ga350KGolden.test.ts`,
`magneticCif.test.ts`), which call none of the changed code.

Local data, read-only: `examples/localMagneticDemo.test.ts` (3) and
`core/workflow/localHexMagneticGolden.test.ts` (7) pass.
`realLocalMagneticBenchmark.test.ts` and `realLocalMagnetic.test.ts` skip:
the files their own gates ask for are not in the data folder.

## What it means for the validation

Arm A's pinned results did not move: no replay, grader or snapshot test
changed. A live run's `refine_moments` now returns the settled moments, so
arms B and C will read different numbers from it; the method and the gate
that use them are the later step, and a re-baseline belongs with it.

## Not done

- The three provisional choices above.
- The Copilot's method, report gate, tool descriptions, snapshots, replays
  and evals. Until then the model is not told that `refine_moments` changes
  the scale and the background, nor when a fit did not settle.
- The documents: USER_GUIDE, LIMITATIONS, README, VALIDATION, DEMO_SCRIPT,
  demo-qa, CHANGELOG. They describe the old Refine moments.
- The report's sentence about the moments ("the moment esds come from that
  fit") is unchanged; it does not yet say what the esds include.
- The owner's solution file for the local demo.
- A model shown on the refinement pattern (Show) keeps the moments it was
  shown with: a later Refine moments re-refines the page's scale and
  background but does not update that preview, as before.
- The recorded nuclear-only baseline lives in the step, not in the project:
  a reopened project shows the page's own value.
- Single crystal and mPDF moment fits: not measured, not changed.
- Peak-shape rows, positions or ADPs in the rounds: not built, not tested.
- More than one extra phase's scale in the rounds: built (every untied scale
  row; both scales on the public demo), not tested against a known truth.
- A second k ≠ 0 compound, and a time-of-flight profile, by independent
  calculation.
- The audit's Findings 3–5.

## Checks

At the code's head (defc04f; the commit after it only fills in this section):
`npm run build`, `npm run lint`, and `npm test` once: 404 files passed, 36
skipped (data-gated or opt-in); 3575 tests passed, 336 skipped; 125 s.

Also run: the four local-data test files read-only against the owner's data
folder (two ran, two skipped by their own gates), the local solve in its dry
mode (21 s; no file in the data folder changed), and the browser check above
on the built app. Not run: the 200- and 1000-seed scripts (step 1's results
stand), any live Copilot run or eval, any paid API.

The many-seed tables (step 1) are from

```
MOMENT_SEQUENCE_SEEDS=200 MOMENT_SEQUENCE_OUT=<folder> npx vitest run src/app/momentSequenceSeeds.test.ts
MOMENT_SEQUENCE_RANK=12   MOMENT_SEQUENCE_OUT=<folder> npx vitest run src/app/momentSequenceSeeds.test.ts
```

(8.5 and 5.5 minutes on a laptop; skipped in the suite; not re-run for step
2). They use the test's own harness, whose joint fit the step now equals.

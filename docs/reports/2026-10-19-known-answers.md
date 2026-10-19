# Known answers for the extinction test and the peak identification

Pull request [#86](https://github.com/drthyang/web-refinement/pull/86),
branch `claude/plan-4-9`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 4.9 (known-answer tests for
`test_extinction`; a false-positive test for `identify_peaks` on random
d-lists). AGENT_REVIEW's tool table: "No known-answer test" and "No
false-positive test on random d-lists".

Both tests found a fault, and each is fixed here.

## `test_extinction`: the shift against the wrong esd

The test refines twice as probes: on all the data fitted, and without the
reflections whose extinction factor y is below the cut. A free parameter that
moves by more than 2 esd between the two fits "leans on the reflections the
extinction correction carries", and the reading sends the model to the other
extinction model. The esd was the full fit's. Leaving most of the data out
widens every esd, so a correct model fails the test.

### What was measured

Corundum on a neutron diffractometer (`corundumPage`), 414 reflections, with
the scale, the extinction, both B's and both free positions refined. Each row
is 20 seeds of the counting noise. The count is the seeds in which any free
parameter moved by more than 2 esd.

| Data | Fitted with | y cut | Full fit's esd (`main`) | Esd without them (this PR) |
| --- | --- | --- | --- | --- |
| EXTI 2 | EXTI | 0.5 / 0.8 | 2 / 18 | 0 / 1 |
| EXTI 5 | EXTI | 0.5 / 0.8 | 7 / 18 | 1 / 2 |
| EXTI 20 | EXTI | 0.5 / 0.8 | **12 / 20** | 4 / 0 |
| EXTI 50 | EXTI | 0.5 / 0.8 | **18 / 19** | 1 / 3 |
| Becker–Coppens I, Gaussian, Eg 1·10⁻⁴ | the same | 0.5 / 0.8 | 0 / 13 | 0 / 2 |
| Becker–Coppens I, Gaussian, Eg 2·10⁻⁴ | the same | 0.5 / 0.8 | 5 / 16 | 1 / 0 |
| Becker–Coppens I, Gaussian, Eg 0.5–2·10⁻⁴ | EXTI | 0.5 / 0.8 | 20 / 20 | 20 / 20 |
| Becker–Coppens I, Lorentzian, Eg 1–2·10⁻⁴ | EXTI | 0.5 / 0.8 | 20 / 20 | 20 / 20 |
| Becker–Coppens I, Lorentzian, Eg 5·10⁻⁵ | EXTI | 0.5 / 0.8 | 0 / 18 | 0 / 12 |
| Becker–Coppens II, Gaussian, Es 0.5–2·10⁻⁴ | EXTI | 0.8 | 20 | 20 |

The first six rows are correct models, and every flag there is a false alarm.
On EXTI 20 at seed 7, the full fit's esd gave the B's a 3-esd shift at
y < 0.5. At y < 0.8, which leaves 21 of the 414 reflections, the extinction
shifted 107 esd and the scale 25 esd. The B's moved 1.4 and 0.6 esd of the
fit without them. The wrong-model rows are the case the test exists for: the
B's take up what EXTI misses on the extinguished reflections, and they move
5–30 esd once those reflections are left out. They are caught in every seed
either way, except the mildest case (Lorentzian, Eg 5·10⁻⁵), where only 3
reflections fall below 0.5.

For a correct model, the shift between nested fits has an esd of
√(σ_without² − σ_all²), which is less than σ_without. That expression is
unusable as it stands. Each fit's esds are scaled by its own GooF, and the
GooF drops once the misfit reflections leave, so σ_without can come out
smaller than σ_all. When few reflections leave, the two esds are nearly
equal, and the expression magnifies convergence noise. σ_without bounds the
test from the safe side: it errs towards keeping the data. The threshold
stays at 2 esd, as the tool documents. At 3 esd the correct models flag in 0–1
of 20 seeds, but the mild wrong models are flagged less often.

### What changed

| Change | Where |
| --- | --- |
| Each shift is read against the esd of the fit without the reflections, and the reading says so | `extinctionTest` in `src/agent/scTools.ts`, the tool's description |
| Known answer: a correct model under EXTI 20 moves nothing at y < 0.5 or y < 0.8 (fails on `main`) | `scTools.test.ts` |
| Known answer: Becker–Coppens data fitted with EXTI moves both B's, and the reading sends the model to `set_extinction_model`; once that model is chosen and refined, nothing moves | `scTools.test.ts` |

## `identify_peaks`: names for random peaks

`identify_peaks` matches peaks that no phase of the model explains against 15
library phases. Each phase gets its own d scale within ±1.5 % and a 0.25 %
window. The reading named the lead when it explained two peaks or more (or
one strong line, with no other strong line in range) and none of its
strongest lines was missing. With 15 phases, each free to scale, peaks at
random sit on some phase's lines.

### What was measured

Peaks were drawn uniformly in 1/d over four ranges: λ 1.54 Å neutrons
(0.8–6 Å), λ 2.41 Å neutrons (1.33–17 Å), Cu Kα (0.9–8.8 Å) and 11-BM
(0.5–10 Å). There were 2 to 12 peaks per list and 200 lists per range and
size.

| | Lists | Named |
| --- | --- | --- |
| The rules on `main` | 4800 | 211 (4.4 %); 24 of 200 (12 %) at λ 2.41 Å with 8 and 12 peaks; 23 of 200 at λ 1.54 Å with 12, 15 of them corundum |
| With the chance (dev run, 40 per cell) | 960 | 9 (0.9 %) |
| With the chance (the CI test, 30 per cell) | 600 | 1 (0.2 %), where the rules alone pass 22 |

Most false names came from the strongest line hit by chance, plus a weak line
or two, with several strong lines of 0.4–0.7 missing. The check only looked
for missing lines of 0.8 or more. Some named matches counted one line twice:
two peaks within 0.25 % of each other both "explained" it.

### What changed

| Change | Why |
| --- | --- |
| A line counts once in the ranking and the rules, however many peaks sit on it | Two peaks on CeO₂ 111 named CeO₂ |
| The lead is named only when random peaks match as well less than 1 % of the time: as many peaks drawn 500 times over the range with a fixed seed, each draw ranked by the same rules | The rules alone named a phase in up to 12 % of random lists |
| Each phase is held to its own draws and the chance is family-wise: how often a draw's least likely phase is as unlikely as the lead | Held to the best of every phase, corundum's dense lines set the bar for all, and the fluorite eval page went unnamed (1.2 %) |
| A phase's strength is Σ√I over the lines it explains times its d scale's plausibility, as the ranking weighs it | Random draws use the ±1.5 % freedom, while a real impurity sits at its cell. Without it, the fluorite page read 2 % |
| The reading names the chance either way, and when it is too high it says "Not enough to name a phase", the lead a possibility to check | The model is told why |
| The verdict moved from `powderTools.ts` into `identifyPeaks` in `src/core/diagnostics/knownPhases.ts` | The rule is tested where it lives |

What is still named:

| Case | `main` | Now |
| --- | --- | --- |
| Si 111, 220, 311 (Cu Kα) | named | named, chance 0 |
| Si 111 and 220 alone | named | named, chance 0 |
| NAC's fluorite, 15 peaks on 11-BM | named | named, chance 0 |
| A cooled Al can: 111, 200, 220, 311, 331 at d × 0.996 among four other peaks | named | named, chance 0 |
| The fluorite eval page (`mn3gaFluoriteSession`, 5 residual peaks) | named | named, chance 0 |
| Graphite 002 alone at its own cell (Cu Kα) | named | named, chance 0.4 % |
| Cr₂WO₆'s Al cryostat (220 not among the peaks) | doubtful | doubtful |
| Four random d's on the Mn₃Ga demo's range, three on corundum lines | named | not enough, 2 % |

A call costs at most 0.3 s (NAC's range down to 0.41 Å with 12 peaks), and
the draws only run when the rules pass the lead. The output keeps its keys
(`candidates`, `peaks`, `reading`), as the live contract pins them.

The null is peaks uniform in 1/d. Real unexplained peaks are not uniform:
the residual's peak search is limited to 12 peaks, and a sample's lines hide
an impurity's. The chance is a calibration, not a probability of the
impurity.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2384
tests (`main`'s 2377 and 7 new ones), 265 skipped (live runs and
data-dependent suites). The model-text snapshots change by the two
descriptions.

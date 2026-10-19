# The H-test's direction of bias

Pull request [#PR](https://github.com/drthyang/web-refinement/pull/PR),
branch `claude/plan-4-6`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 4.6 (the stated direction now; the
unbiased estimator later). AGENT_REVIEW item 7.

`reflection_statistics` reads each merohedral twin law's fraction α with
Yeates' H-test over the pairs (h, R·h) both measured above 3σ. Its reading
told the model "the test's α is an estimate; noise lowers it". On weak data
the cut does the opposite, and much more.

## What was measured

Synthetic acentric Wilson data in P3₂ (one reflection per Laue class, mean
1000), each intensity measured with Gaussian noise of σ, the law
h, k, l → k, h, −l:

| ⟨I⟩/σ | True α | α with the 3σ cut | Pairs kept | α, every pair kept |
| --- | --- | --- | --- | --- |
| 1000 | 0 | 0.001 | 791 | 0.000 |
| 1000 | 0.3 | 0.299 | 796 | 0.299 |
| 20 | 0 | **0.095** | 605 | 0.020 |
| 20 | 0.3 | 0.302 | 752 | 0.293 |
| 5 | 0 | **0.229** | 247 | 0.047 |
| 5 | 0.3 | 0.315 | 426 | 0.244 |
| 3 | 0 | **0.282** | 123 | 0.062 |
| 1.5 | 0 | **0.362** | 14 | 0.077 |

The cut keeps only the pairs with both members strong, and drops those with
one weak member, whose H is large. So ⟨H⟩ falls and α rises: an untwinned
crystal on weak data reads as a twin. Noise lowers a real twin's α only when
the weak pairs are kept, which the tool does not do.

## What changed

| Change | What it answers |
| --- | --- |
| The reading says it: the test's α is an estimate, and on weak data a high one; with few pairs an untwinned crystal can read 0.1–0.3, and the refined fraction decides | "Noise lowers it": the wrong direction for the tool as it runs |
| The core function's doc (`merohedralTwinLaws`) says why the cut exists and what it does to α, with the numbers above | The same claim at its source |
| A known-answer test (`twinLaws.test.ts`): untwinned at ⟨I/σ⟩ = 20 reads α above 0.06 with the cut and at least 0.04 less with every pair kept; a twin at 0.3 with every pair kept reads below 0.27 at ⟨I/σ⟩ = 5 | The review's point: the synthetic test never exercised the cut |

The estimator itself is unchanged: an unbiased one (the plan's "later") would
change every α the tool reports.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2378
tests (`main`'s 2377 and the new one), 265 skipped (live runs and
data-dependent suites).

# Parsons' quotients from every measurement

Pull request [#87](https://github.com/drthyang/web-refinement/pull/87),
branch `claude/plan-4-8`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 4.8 (Flack and Parsons use every
measurement of unmerged data). AGENT_REVIEW's tool table, Flack / Parsons:
"With unmerged data it uses only the first measurement per index."

## What was wrong

`parsonsQuotients` groups the reflections fitted by the point group, so each
reflection's symmetry equivalents fall together and its Friedel opposite stays
apart. It then kept the **first** row of each group and dropped the rest. On a
merged listing (a SHELXL `.fcf`, or the page with `set_merge` on) each group
holds one row, so nothing was lost. On an unmerged `.hkl`, every equivalent
and repeat measurement after the first was dropped, and the quotient's esd was
√n too large for n measurements a side.

The refined Flack x (an inversion twin's fraction) fits every reflection on
the page, so it already used every measurement. Parsons' x was the only
estimate that dropped any.

## What changed

Each side of a Bijvoet pair is now every measurement of the reflection and its
equivalents merged, as SHELXL's MERG 2 merges them:

- Fo² is the mean weighted by 1/σ², and its σ is the one `mergeEquivalents`
  gives: the larger of the propagated error and SHELXL's scatter term.
- Fc² is the mean with the same weights. For monochromatic data the
  equivalents' Fc² are equal anyway.

The quotients, their weights and the count of Bijvoet differences at more
than 3σ are then formed as before, on the merged sides. Merged data read
exactly as before.

## Known answer

The test uses the P2₁ bromine compound from the existing tests, with 30 % of
the other hand. Each reflection and its 2-fold equivalent are measured twice,
on both hands: 4440 measurements, four a side, with counting noise
σ = 0.03·I + 0.5. The model's Fc² are at another scale.

| | Quotients | x | esd | √χ²_ν |
| --- | --- | --- | --- | --- |
| Each side's first measurement (`main`) | 462 | 0.286 | 0.0099 | 1.03 |
| Every measurement (this PR) | 462 | 0.298 | 0.0051 | 0.90 |
| The data merged first (`mergeEquivalents`, Friedel opposites apart) | 462 | 0.298 | 0.0051 | 0.90 |

The test holds three things:

- x and its esd equal those from the data merged first, to 10 digits.
- The esd is under 0.65 of the one-measurement-a-side esd. Four a side
  give 0.51 here, against 1/√4 for an ideal merge.
- x lies within 3 esd of 0.3.

On `main` the first check fails: x is 0.286, against 0.298 merged.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2378
tests (`main`'s 2377 and the new one), 265 skipped (live runs and
data-dependent suites). The data-dependent suites that pin Parsons' x
(`sc2b`, `sc3a`) read SHELXL's merged listings, one row a reflection, which
this change leaves as they were.

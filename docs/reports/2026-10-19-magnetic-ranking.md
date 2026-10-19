# The magnetic ranking: within the noise, and the scale at k = 0

Pull request [#PR](https://github.com/drthyang/web-refinement/pull/PR),
branch `claude/plan-4-4`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 4.4. AGENT_REVIEW proposal 4: "add a
Hamilton R-factor ratio test (or Δχ² per parameter) so a lower group with more
moments must earn its parameters. At k = 0, rank with the scale free."

## What was wrong

The magnetic step ranks the groups of the little group of k. Each is a
moments-only fit, the nuclear model held. The ★ went to the lowest agreement,
and two groups counted as tied only within 10⁻⁴ of it. Among tied groups the
★ went to the maximal group with the fewest moment parameters. The skill says
"groups within the noise of the best are equally good fits". A fixed 10⁻⁴ in
wR is not the noise, though:

- A wR improvement of 10⁻⁴ is noise on a short or poorly fitting pattern, and
  real on a long, well-fitting one.
- A lower group's extra moments fit any wR improvement past that line, and
  the extra moments then took the ★.

At k = 0 the magnetic peaks sit on the nuclear ones. A nuclear scale refined
before the moments has already taken up part of the magnetic intensity, so
the moments fit the wrong remainder.

## What was measured

The test page was Mn₃Ga (P6₃/mmc, neutrons) at k = 0, with each of five
maximal groups in turn as the truth (2.5 µB on Mn). The scale and background
were fitted first, without the moments, as a user would before the magnetic
step. The ranking used scope "all".

| | Scale | ★ |
| --- | --- | --- |
| `main` (scale held, 10⁻⁴ tie) | 25.8–29.0 for a true 24.4 | wrong for all five: index-24 or -48 groups with 3 moment parameters (G89, G88, G102) |
| This PR (scale free, Hamilton) | refined with the moments | the truth (P6₃/m'mc, P6₃'/mm'c checked on scope "all"; all five on the maximal groups) |

With the scale free, the index-12 and -24 groups with three moment parameters
still fit about 10⁻⁵ lower in wR than the truth (0.00291 against 0.00292):
noise, which the test now reads as noise. On the k = (0 0 ½) eval page the
★ was already the truth (G2), and it stays.

## What changed

| Change | Where |
| --- | --- |
| The powder and single-crystal moment fits report χ² and its degrees of freedom (from the last iteration and the GoF). The mPDF's, on uniform weights, reports none | `noiseOf` (momentRestarts.ts), `powderMomentFit`, the single-crystal `momentFit` |
| "Within the noise of the best": Hamilton's F test at 5 % (`RANK_NOISE_ALPHA`). A group with q fewer moment parameters stands beside the best unless (Δχ²/q)/(χ²_best/ν) exceeds F(q, ν). A group with as many or more stands beside it when within one parameter's worth. Without χ², the old 10⁻⁴ tie applies | `core/diagnostics/hamilton.ts`; the F distribution in `core/math/fDistribution.ts` |
| The ★: the maximal group with the fewest moment parameters among those within the noise | `bestRanked`, `withinNoise` (magneticStep.ts) |
| At k = 0 the ranking refines the nuclear scale with each group's moments. The single crystal's magnetic scale follows its tie | `FitOptions.freeScale`, the store's `rank` |
| `rank_magnetic_groups` returns `withinNoise`, and its reading names those groups and says why the ★ is the one it is | magneticTools.ts, magneticPort.ts |
| The tool description, AGENT_TOOLS.md and MAGNETIC_SYMMETRY.md say so. The skill's sentence is unchanged and now means what the ★ means | |

## Tests

These fail on `main`:

- `magneticStep.test.ts` "keeps the maximal group when the lower one's extra
  moments fit the noise only". wR 5.00 → 4.98 %, beyond the old tie, with
  χ² 1000 → 994 on 500 points.
- `magneticStep.test.ts` "refines the nuclear scale with the moments at
  k = 0, and holds it elsewhere".

These pin what stays as it was:

- A lower group whose moments earn their place (χ² 1000 → 810) takes the ★.
- A fit with no χ² falls back to the 10⁻⁴ tie.

The F distribution is checked against the tables (F(1, ∞) 3.8415, F(2, 100)
3.0873, F(3, 30) 2.9223, F(5, 10) 3.3258), and the noise rule on both its
branches. The full k = 0 ranking ("all", about 50 s) is the measurement
above, not a CI test.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2384
tests (`main`'s 2377 and 7 new ones), 265 skipped (live runs and
data-dependent suites). The live contract pins `rank_magnetic_groups`'
`withinNoise`. The model-text snapshots change by its description.

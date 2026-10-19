# The texture test: equivalents, distinct axes, a chance for the best axis

Pull request [#93](https://github.com/drthyang/web-refinement/pull/93),
branch `claude/plan-4-7`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 4.7 (texture: averaged over Laue
equivalents, symmetry-distinct axes, corrected for choosing the best axis; a
false-positive test over many seeds). AGENT_REVIEW's tool table: "Texture
uses one hkl per family and takes the best of 7 axes at |r| > 0.5 with about
12 reflections, so false positives on noise are likely."

The review was right, and the same fault was in the model's March–Dollase
correction itself.

## What changed

**The correction the model applies.** `marchDollase` took the angle between
the axis and one member of each family, the representative the reflection
list keeps. A powder line holds every member of the family, at different
angles to the axis: cubic (100) on [001] has two members along the axis and
four across it, and the model gave the whole line the "across" value. The
powder intensity (`powderPeakIntensities`, and the derivative path in
`powder.ts`) now uses `marchDollaseFamily`, the mean of P(α) over the
family's Laue equivalents, as GSAS-II's `GetPrefOri` does. Families whose
members all lie at one angle to the axis (any (hkl) on the unique axis of a
uniaxial group, the case the existing tests and the [001] simulation use) are
unchanged.

**The diagnosis.** `diagnose_fit`'s texture test moves to
`src/core/diagnostics/textureTest.ts` and changes in three ways.

- *The regressor is the correction itself, averaged over equivalents.* The
  old test correlated the misfit with cos² of the angle to one member. Over a
  family, cos² is not enough: a cubic family's mean cos² is 1/3 whatever the
  axis, so texture in a cubic phase is only visible through the full
  function. For each axis and ratio r (0.5 to 2, 25 steps), the test fits
  ln(I_obs/I_calc), after the fall-off with angle, by c + ln⟨P(α; r)⟩ over
  each family, and keeps the share of the misfit's weighted variance the best
  (axis, r) explains. It reports that axis, its ratio (with a flag when it
  sits at the range's end) and the share.
- *One axis per class of equivalent directions.* The axes are the directions
  with indices in {−1, 0, 1}, one per orbit under the Laue group: 3 in a
  cubic group, 5 in P4/mmm, 13 in P−1. Equivalent axes gave the same family
  averages, so the old list both repeated axes (cubic [100], [010], [001])
  and missed some (tetragonal [1 −1 0] is [110], but monoclinic [1 0 −1] is
  not [101]).
- *A chance for picking the best.* The same search on the misfits shuffled
  among the reflections (400 shuffles, seeded) gives the share of shuffles
  that explain as much. Texture is named when that chance is under 1 % and
  the ratio departs from 1 by at least 5 %. The permutation covers every
  choice the search makes (axis, ratio) and the correlation between axes,
  which a Bonferroni count would not.

`FitDiagnosisInput.cells` becomes `phases` (cell and space group). The dead
`reciprocalMetric` and `cosBetween` helpers, duplicates of `unitCell.ts`, are
gone.

## Evidence

Measured with a scratch run of the old rule and the new test on the same
lists (an orthorhombic Pnma cell, the first n reflections, misfits Gaussian
with σ = 0.1 in ln I, weights √I with I random; 200 seeds each; new test at
200 shuffles):

| Reflections | Old rule names texture | New test names texture |
| --- | --- | --- |
| 12 | 79 / 200 (40 %) | 2 / 200 |
| 16 | 37 / 200 | 1 / 200 |
| 20 | 27 / 200 | 1 / 200 |
| 30 | 11 / 200 | 3 / 200 |
| 50 | 1 / 200 | 1 / 200 |

On noise the new test names texture at the rate its 1 % chance promises; the
old rule did so in 40 % of 12-reflection fits.

Power, on a cubic Pm−3m list of 30 reflections, misfit = ln of the family
March–Dollase plus noise σ = 0.05, 50 seeds:

| Simulated | Old rule, right axis | New test, right axis | New test, named |
| --- | --- | --- | --- |
| [111], r = 0.8 | 15 / 50 | 32 / 50 | 37 / 50 |
| [001], r = 0.8 | 33 / 50 | 50 / 50 | 50 / 50 |
| [110], r = 1.25 | 1 / 50 | 5 / 50 | 5 / 50 |

Cubic texture is weak in a powder: to first order in ln r the family average
cancels, and what is left is one cubic harmonic shared by every axis, so a
weak cubic texture's axis is less certain than its presence. Non-cubic
texture is first order and much easier.

Tests (each fails on `main`, where the functions do not exist or the model
gives the representative's value):

- `textureTest.test.ts`: one axis per class (cubic 3, P4/mmm 5, P−1 13); at
  most 3 of 100 noise lists of 12–20 reflections named; cubic [111] platelets
  named with r between 0.74 and 0.86; orthorhombic [010] needles (r = 1.3)
  named as needles.
- `intensity.test.ts`: cubic (100) on [001] is (2 r⁻³ + 4 r^1.5)/6, and the
  powder intensity carries that factor.
- `fitDiagnosis.test.ts`: the simulated [001] texture on Mn₃Ga is still
  named on [001]; a correct model over 12 noise seeds names no texture.

Full suite: 2383 passed, 265 skipped; `tsc -b`, eslint and the build clean.

## What changes for users

- A refined March–Dollase ratio changes for any axis whose family members lie
  at different angles to it (a cubic phase on any axis, an in-plane axis of a
  uniaxial phase). The new value is the one GSAS-II refines; a project saved
  with such a ratio fits differently when refined again.
- `diagnose_fit`'s `textureTest` changes shape: `{axis, ratio, explained,
  chance, reflections, axesSearched}` in place of `{axis, r, reflections}`.
  The texture cause's evidence states the ratio, the share explained, the
  axes searched and the chance.
- Texture is named far less often on small or noisy fits.

## What it means for the validation

No eval case uses preferred orientation, and texture is named only through
`diagnose_fit`'s causes, so arm A's pinned results do not move. An arm B or C
run that reads `diagnose_fit` sees fewer texture causes on fits without
texture.

## Not done

- FullProf's own March–Dollase treatment of equivalents was not checked; the
  FullProf export writes the ratio as refined here.
- The Wilson fall-off still pools all phases (AGENT_REVIEW); the texture test
  reads the primary phase only, as before.
- Spherical-harmonic texture remains out of scope (LIMITATIONS).

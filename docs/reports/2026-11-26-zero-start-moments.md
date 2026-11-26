# Moment amplitudes that start at 0 (2026-11-26)

Status: built on `fix/zero-start-moments`; owner review before merge.

## The problem

Magnetic intensity is quadratic in the moment amplitudes, I = Σ aᵢaⱼQᵢⱼ. An
amplitude whose mode is in an irrep of its own has no gradient at 0, so a fit
started there never leaves 0. The page seeds the first mode of each sublattice
and starts the others at 0; quadrature rows start at 0; values typed, opened
from an mCIF or a project, or passed over MCP can be 0. Before this change the
row came back "0, esd 0", the engine's dropped direction made the other esds
those of the moments alone, and a missed component biased the others. On the
independent MnWO₄ calculation (testSupport/independentMnwo4.ts), k = (½ 0 0),
the group with Mx, My, Mz free, truth (3, 1.5, 2) µB, seed 0: Mx 3.402(14),
My 0(0), Mz 1.762(23), wR 5.48 %, Mx 28 esd off its truth.

## The rule (core/magnetic/momentsFit.ts, runMomentsFit)

One place, so both surfaces run it: the page's Refine moments
(powderPage.ts, powderMomentFit) and MCP `refine_moments`. Not momentFitRows,
which the ranking also uses: the ranking is not kicked.

1. The fit runs from the start as given.
2. A free, untied amplitude (not the phase gauge) that started within 1e-6 of
   0 and is still there after the fit is kicked: the fit is run again from the
   same start with those rows at 0.1 µB (ZERO_START_KICK). A row that started
   at 0 and moved (it has a gradient there) is the fit's answer and is not
   kicked.
3. The kicked fit is kept only when the ranking's own Hamilton test
   (diagnostics/hamilton.ts, withinNoiseOfBest, 5 %, q = the kicked rows)
   says its χ² is lower beyond the noise. Its significance is reported from
   Δχ², z = √(Δχ²/(χ²/ν)) for one row: for a component the intensity has only
   squared, value/esd reads about 2z. Its sign is a domain choice.
4. Otherwise the rows are held at 0 with no esd ("not required by the data"),
   and the fit is re-run from its end with them held, so the other esds include
   the scale and the background again.
5. Both fits exact (noise-free): not kept.

## "Direction not determined"

Criterion: a null direction of the moments step's covariance (the engine's
`nullDirections`) that moves, with a component ≥ 0.1, a moment row the fit
carries (|value| > 3 esd and > 0.01 µB). It is read on the fit reported and,
when the kick is not kept but the kicked fit is within the noise of the other
both ways, on the kicked fit (which is then an equally good member of the
family). Those rows get no esd: the engine's esd leaves the null direction out
and reads too small. An esd of exactly 0 is never reported.

Testable on the repo's helix (P1, k = (0 0 0.2317), cos Mx = 2, sin My = 2 µB,
orthogonal cell): the zero start returns the seeds' member, the kick lands on
another point of the circle cos My² + sin My² = 4 with the same χ²
(Δχ² −0.23); the y pair is reported as not determined, |M_y| = 2.00 on both.

## Known truth (page, from the seeds; independent MnWO₄)

| case | truth µB | result, seeds 0–3 |
|---|---|---|
| a1, k = (½ 0 0) | (3, 1.5, 2) | My kept, z 19–21; all three within 1.2 esd |
| a2, k = 0, Pc | (3, 1.5, 2) | My kept, z 8.6–10 |
| a3, k = (½ 0 0) | (3, 0.5, 2) | My kept, z 2.1–3.4; |My| 0.48–0.60 |
| a4, k = 0, Pc | (3, 0.5, 2) | My held at 0 in 4 of 4 (z 0.75–1.96): trades with the scale |
| b1, k = (½ 0 0) | (3, 0, 2) | My held at 0 (noise-free: the 0.167 µB of the investigation, F 3.31 < 3.85) |
| b2, k = 0, Pc | (3, 0, 2) | My held at 0 |

## Limits

- Several kicked rows are tested together: one the data do not need can be
  kept with one they do.
- A direction determined only weakly, with no null direction, is not caught.
- The single-crystal and magnetic-PDF moment fits do not kick.

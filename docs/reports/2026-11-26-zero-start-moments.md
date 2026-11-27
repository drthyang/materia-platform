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
4. Several kicked rows (the owner's choice, 2026-11-26): one at a time,
   backward. From the kicked fit, each remaining row is held at 0 in turn; the
   one the data need least is dropped while the same test (q = 1) says it is
   not required, the fit is redone, and so on. Each row reports its own test.
5. A row not kept is held at 0 with no esd ("not required by the data"); with
   none kept, the fit is re-run from the zero-start fit's end with the rows
   held, so the other esds include the scale and the background again. The
   rounds shown are those of the fit reported, and the fit is named.
6. Each held row gets the largest |value| the data allow: the 95 %
   one-parameter profile limit (the row held at m, every other free row
   refitted by the same fit; the largest m with
   χ²(m) − χ²_min ≤ F(0.05; 1, ν)·χ²_min/ν, χ²_min the lower of χ²(0) and
   χ²(|kicked value|), ν with the row free). Not given for an exact fit, a fit
   without χ², or above 10 µB (said so).
7. Both fits exact (noise-free): not kept.

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

## Under model error (the gate's negative control)

Synthetic b1 and b2 (true My = 0) with an error the fit does not model, 4
noise seeds each: every Uiso ×1.2; the width 10 % wider (held in the fit);
two background humps and a low-angle rise the fit's six terms cannot follow;
the Fe³⁺ form factor in the data, Mn²⁺ in the fit; and all four. A truly zero
My was kept in 3 of 40 fits (Fe³⁺ 2/8, Uiso 1/8, the rest 0/8), against 2 of
40 expected from a 5 % test: about 5 % to 8 %. The real component of a1 and a2
(1.5 µB) was kept in 48 of 48. Held rows' 95 % limits: a4 (true 0.5 µB) 0.81
to 0.97 µB, so a hold there does not exclude the truth; b1 0.44 to 0.56; b2
0.64 to 0.83 µB.

## Limits

- The test assumes the rest of the model is right: under model error a truly
  zero component is kept somewhat more often than 5 % (above).
- A direction determined only weakly, with no null direction, is not caught.
- The single-crystal and magnetic-PDF moment fits do not kick.

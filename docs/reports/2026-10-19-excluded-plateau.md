# The excluded plateau out of every powder fit

Pull request (to be linked), branch `claude/zen-archimedes-wf92da`, on `main` (#78),
2026-10-19. Found by [#76](https://github.com/drthyang/web-refinement/pull/76)
(its report's "Found, not fixed").

A GSAS export writes a constant −3 outside its fit range. The single-phase
powder problem gives those points no weight, and the page's wR and point
count skip them (`weightedR`, `observationsIn` in `app/powderPage.ts`). The
multi-phase and nuclear + magnetic problems masked only the fit window. So
with a second phase or a magnetic model, the fit counted the plateau. Its wR
was not the page's, and the plateau pulled the fit.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `powderPointWeights(pattern, fitRange)` in `core/workflow/powder.ts` gives each point 1/σ², with σ = √y where the file gives none (1 at y ≤ 0). It gives zero on the excluded plateau and outside the window. The single-phase, multi-phase and nuclear + magnetic problems all take their pattern weights from it. Restraint rows stay as they were | Three copies of one weighting, two of them without the plateau |
| MCP's `evaluate_pattern` gives the plateau no weight in its wR | Its `observationCount` left the plateau out, but its wR scored it |

## Evidence

- **Failing first.** Each test fails on `main` and passes here. In each, the
  first 60 points (12–24.7°) are set to −3.
  - `app/powderPage.test.ts`, "a pattern with an excluded plateau, fitted
    with a second phase or a magnetic model":
    - **Two phases**: the Mn₃Ga demo with fluorite's lines, and CaF₂ added.
      The multi-phase problem gives the plateau zero weight. Refine
      converges to the page's wR (to 10⁻⁹), with the phase scales of the
      pattern without the plateau.
    - **Nuclear + magnetic**: the magnetic Mn₃Ga demo, k = (0 0 ½), G2, its
      moment fitted and handed over free. The moments fit's wR and the
      co-refinement's are the page's, and the moment comes back at the true
      2.5 µB.
  - `mcp/excludedPlateau.test.ts`:
    - `refine_powder` with CaF₂ as an extra phase: the result's wR is that
      of its residual, and it counts 440 of 500 points.
    - `refine_magnetic_powder`: its wR is that of its components without the
      plateau. `evaluate_pattern` and `rank_next_parameters` give the same
      wR at its refined model.
- **Each fix is caught.** With only `mcp/tools.ts` as on `main`, the
  `evaluate_pattern` check fails: 30.10 % against 0.30 %.
- **Measured, `main` and here**, on the headless page, as the tests run it.
  wR in %:

  | Case | Build | Fit's wR | Page's wR | Refined |
  | --- | --- | --- | --- | --- |
  | Two phases, no plateau | either | 0.1455 | 0.1455 | scales 79.985, 0.8642 |
  | Two phases, plateau | `main` | 25.4573 | 6.6319 | scales 74.557, 0.8994 |
  | Two phases, plateau | here | 0.1403 | 0.1403 | scales 79.982, 0.8642 |
  | Magnetic, no plateau | either | 0.3066 | 0.3066 | moment 2.5000 µB |
  | Magnetic, plateau | `main` | 28.4403 (moments fit 29.1329) | 9.1191 (6.7394 after the moments fit) | moment 2.2187, then 2.3032 µB |
  | Magnetic, plateau | here | 0.3000 (moments fit 0.3006) | 0.3000 (0.3006) | moment 2.5003 µB |

  On `main`, the co-refinement raised the page's wR from 6.74 to 9.12 %. It
  was minimizing something else.

## What changes for users

The change applies to a pattern with an excluded plateau (at least 5 points
at one value ≤ 0) and a second phase or a magnetic model. Refine, Prefit and
Escape minimum, the posterior, and the magnetic step's moments fit and
ranking now fit only the points the page scores, and their wR is the page's.
On MCP the same holds for:

- `refine_powder` with extra phases;
- `refine_magnetic_powder`;
- `rank_next_parameters` with a magnetic model;
- `sample_posterior` with extra phases or a magnetic model.

`evaluate_pattern`'s wR now leaves the plateau out. No output shape changes.
A pattern without a plateau, which includes every bundled demo, is unchanged.

## What it means for the validation

No validation case or eval scenario has a plateau. The demos are synthetic,
with noise on every point. The POWGEN Mn₃Ga two-phase data and MCP's example
pattern have no repeated non-positive value (0 of 4613 and 0 of 6251
points). So arm A's pinned results do not move, and arms B and C measure the
same.

The user's AWO₄ data (git-ignored, not here) were not checked. If their
histogram has a plateau, a magnetic or multi-phase fit on them now leaves it
out.

## Not done

- **The Le Bail cell pre-fit** (`core/workflow/leBailPrefit.ts`) also masks
  only the window, and its extraction (`leBailExtract`) reads every point.
  Masking it is a change of its own. It runs on a single-phase page and
  seeds Prefit's cell. Not measured.
- **`evaluate_pattern` floors σ at one count** where the file gives none
  (√max(y, 1)); the fits use √y for y > 0. For points with 0 < y < 1 and no
  σ, its wR is not the fit's. This is deliberate and documented, so it is
  left as it is.
- **`rank_next_parameters` with a magnetic model** passes only the shape and
  η to the problem: no Lorentz flag, background basis or extra phases. This
  is the same class as #76's "The MCP magnetic tools draw on Chebyshev".
- **Overlap with #76.** Both change the imports of `multiPhase.ts` and the
  top of the CHANGELOG's Fixed list. Whichever merges second has a line or
  two to resolve.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head.

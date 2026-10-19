# A multi-phase page on its own background basis

Pull request [#76](https://github.com/drthyang/web-refinement/pull/76), branch `claude/bold-planck-xm4ci3`, on `main`,
2026-10-19. Found by the magnetic step's test in
[#73](https://github.com/drthyang/web-refinement/pull/73) (its report's
"Found, not fixed"). On a powder page with a second phase, the curves and the
nuclear refinement used the default Chebyshev basis and the Lorentz factor
whatever the page had chosen. The magnetic co-refinement and the
single-phase path used the page's choice, so they did not agree with the
page.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `buildMultiPhasePowderProblem` takes the whole `PowderProfile`: the background basis goes to the synthesis, and the Lorentz flag goes to each phase's peaks (`core/workflow/multiPhase.ts`) | It read only the shape and η, and computed the Lorentz factor always |
| `multiPhaseCurves` draws the problem's own `calculate`, as `powderCurves` does for one phase, and its background curve uses the basis. Its copy of the pattern (`computePattern`) is gone | A second copy of the sum, which dropped the same two fields. The page draws and scores what a fit minimizes |
| The `multiPhasePowder` evaluator spec has `lorentz` and `backgroundType` (`workers/protocol.ts`). The compute client's `powderSpec` and the MCP `sample_posterior`'s spec fill them in | The multi-start, the posterior and the browser's worker pool built the problem from this spec without them |
| `buildProblemForSpec` and `runPowderRefinement` read the profile from a request or a spec through one helper (`workers/runPowder.ts`) | The multi-phase branch was the one that left the fields out |

The page's operations (`app/powderPage.ts`) needed no change: they already
passed the whole profile, and it was lost further down.

## Evidence

- **Failing first.** Each test below fails on `main` and passes here.
  - `core/workflow/multiPhase.test.ts`, "the whole profile": one phase by
    itself must give the single-phase pattern. The curves, the problem and
    the worker's replica built from the spec are checked on cosine, on a
    power series with pseudo-Voigt and the Lorentz factor off, and on log
    interpolation with the Lorentz factor off. On `main` the cosine case is
    off by 96 counts.
  - `app/powderPage.test.ts`, "a page with a second phase, on the background
    basis chosen": the Mn₃Ga demo with CaF₂ added.
    - The page draws the cosine basis under the same peaks. On `main` its
      background was the Chebyshev one, up to 52 counts away.
    - Refine (in the page's thread) and Prefit (the multi-start, through the
      evaluator spec) both converge to the wR the page shows (to 10⁻⁹), with
      background coefficients of their own. On `main` the two bases refined
      to the same coefficients.
  - `app/magneticStep.test.ts`: the moments fit against a second phase and
    the cosine basis together, now that the two agree.
- **Each drop site is caught.** With only the compute client's spec put back
  as on `main`, the Prefit leg fails: it fits Chebyshev while the page shows
  cosine, wR 0.80235 against 0.80341. With only the Lorentz flag put back,
  the case with the Lorentz factor off fails.
- **Measured on `main` and here** (the headless page, as the tests run it):
  - The magnetic step on the magnetic Mn₃Ga demo, with CaF₂ added and the
    cosine basis. The step's value does not move; the page's now agrees
    with it.

    | Window | Step, either build | Page, `main` | Page, here |
    | --- | --- | --- | --- |
    | Whole pattern | 6.7931 | 6.7813 | 6.7931 |
    | 20–100° | 7.5356 | 7.5225 | 7.5356 |

  - The Mn₃Ga demo with CaF₂ added, the window 20–100° and CaF₂'s cell held.
    The demo has no CaF₂, so its scale goes to 0. Refine and Prefit gave the
    same values:

    | Basis | Build | wR before | wR refined | Background coefficients refined |
    | --- | --- | --- | --- | --- |
    | Chebyshev | either | 39.6158 | 0.8023504 | 28.21, 47.30, 23.64, 12.99 |
    | Cosine | `main` | 39.6158 | 0.8023504 | 28.21, 47.30, 23.64, 12.99 |
    | Cosine | here | 39.6188 | 0.8023499 | 17.72, −24.05, 13.80, −7.87 |

    Four terms of either basis fit this smooth background about equally
    well, so the refined wR agree to 5 × 10⁻⁷. The test therefore checks the
    coefficients and the agreement with the page, not a gap in wR.
- **In the browser**, on the built app: the Mn₃Ga + MnO POWGEN TOF demo (two
  phases), on Chebyshev at wR 4.01 %, with the basis set to cosine and then
  Refine. No page error on either build.

  | | `main` | Here |
  | --- | --- | --- |
  | wR once the basis is cosine | 4.01 % (still drawn on Chebyshev) | 66.53 % (the refined Chebyshev coefficients read on the cosine basis) |
  | Refine | converged in 2 cycles at 4.01 %, coefficients 35.77, −25.62, −16.15, −15.57: the Chebyshev fit's, under a selector that reads Cosine | converged in 4 cycles at 5.05 %, coefficients 38.22, 15.91, −17.76, 14.71; the History step and the page both read 5.05 % |

  Four cosine terms follow this TOF background less well than four
  Chebyshev terms (5.05 % against 4.01 %): that is the basis on these data,
  which `main` hid.

## What changes for users

On a powder page with more than one phase and a background basis other than
Chebyshev (cosine, power series, linear or log interpolation), or with the
Lorentz factor off:

- the page's curve and wR change;
- Refine, Prefit and the posterior use that basis;
- the magnetic step's moments fit agrees with the page's wR.

The same holds for the Agent's `set_background` on such a page, and for the
MCP tools' `refine_powder` and `sample_posterior` with extra phases. A
multi-phase page on Chebyshev with the Lorentz factor on is unchanged.

## What it means for the validation

No eval scenario, replay or validation arm sets a basis other than Chebyshev
or turns the Lorentz factor off, so arm A's pinned results do not move, and
the eval scenarios and replays pass unchanged. An Agent run that changes the
basis on a page with a second phase now refines on it.

## Found, not fixed

- **The multi-phase and magnetic fits keep the excluded points.** The
  single-phase problem and the page's wR skip a sentinel plateau (a GSAS
  export's −3 outside the fit range). `buildMultiPhasePowderProblem` and
  `buildMagneticPowderProblem` mask only the fit window, so on such data
  their wR is not the page's. The demo data have no such points.
- **A runaway cell stops the refinement with a RangeError.** A free cell for
  a phase that is not in the data (CaF₂ on the demo) walks to a negative
  length within a few cycles. `generateReflections` then sizes its index box
  from it and throws "Invalid typed array length", instead of a
  `ReflectionLimitError` or a rejected step. The test holds that cell.
- **The MCP magnetic tools draw on Chebyshev.** `evaluate_pattern` and
  `refine_magnetic_powder` call `magneticPowderComponents` with only the
  shape and η, and that function builds an extra phase's peaks with the
  Lorentz factor on whatever the profile says. The page does not use these
  paths.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head, with
`main` at #75 merged in: 2377 tests, 265 skipped (live runs and
data-dependent suites).

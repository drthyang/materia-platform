# The MCP magnetic tools on the whole powder profile

Branch `claude/eager-meitner-452mh0`, on `main` after
[#78](https://github.com/drthyang/web-refinement/pull/78), 2026-10-19. A
follow-up to the moment driver. #78 made `refine_magnetic_powder` fit the
profile it is given, but the tools that draw or probe a magnetic pattern
still used only part of it.

`PowderProfile` holds the peak shape, η, the Lorentz flag and the background
basis. With a magnetic model:
- `evaluate_pattern`, `simulate_pattern` and `rank_next_parameters` (also
  used by the in-app Agent) cut the profile to `{ shape, eta }`. A cosine (or
  other) background was drawn on Chebyshev, and the Lorentz factor was always
  on.
- `magneticPowderComponents` draws the nuclear and magnetic curves that
  `evaluate_pattern`, `simulate_pattern` and `refine_magnetic_powder` return.
  It drew every extra phase with the Lorentz factor on, whatever the profile
  said. It also dropped η, so a pseudo-Voigt with no Lorentzian width was
  drawn at η = 0.5.

## What changed, and why

| Change | What it answers |
| --- | --- |
| **`evaluate_pattern`, `simulate_pattern` and `rank_next_parameters`** pass the whole profile to the magnetic builders | A cosine background drawn on Chebyshev, and the Lorentz factor on when the profile turned it off |
| **`magneticPowderComponents`** builds the extra phases' peaks with `profile.lorentz ?? true`, as `buildMagneticPowderProblem` does, and draws both components with the profile's η | With an extra phase and the Lorentz factor off, `refine_magnetic_powder` returned curves that were not the pattern it fitted. A pseudo-Voigt's η was ignored |

`refine_magnetic_powder`'s fit, and its call to `magneticPowderComponents`,
already took the whole profile after #78. Its curves were wrong only through
the bug inside `magneticPowderComponents`.

## Evidence

`src/mcp/magneticProfile.test.ts` uses:
- Mn₃Ga (P6₃/mmc) with a Cm'cm' moment model and a rock-salt MnO impurity;
- a pattern simulated on a CW neutron grid (15–95° 2θ, 600 points) on a
  sloped background;
- the start: moments moved off the truth, a background of three terms.

Each case compares the tool's curve and wR with what
`buildMagneticPowderProblem`'s `calculate` gives for the same profile and
phases, to within 10⁻⁹ of the pattern's highest point. Each case also checks
that its option moves the pattern by more than 1 % of that height, so the
comparison is not vacuous. The wR below is each tool's, against the wR of the
problem the fit solves at the same values. It was measured with a scratch
copy of the test, on `main`'s two source files and on this branch.

| Case | Fitted problem | Tool on `main` | Tool here |
| --- | --- | --- | --- |
| `evaluate_pattern`, cosine background | 54.0998 % | 44.0670 % | 54.0998 % |
| `evaluate_pattern`, Lorentz factor off | 47.0658 % | 44.0670 % | 47.0658 % |
| `evaluate_pattern`, pseudo-Voigt η = 0.3 | 44.4811 % | 44.7632 % | 44.4811 % |
| `rank_next_parameters` `wrNow`, cosine / Lorentz off | 54.0998 / 47.0658 % | 44.0670 / 44.0670 % | equal |
| `refine_magnetic_powder`, cosine background (fit vs its components) | 11.1552 % | 11.1552 % (fixed in #78) | 11.1552 % |
| `refine_magnetic_powder`, Lorentz off, MnO as extra phase | 8.9314 % | 43.5370 % | 8.9314 % |

On `main` the new test fails in four of its five cases. The cosine
refinement case passes, because #78 fixed it, and stays as a guard. Each fix
was then reverted on its own:
- reverting the core change fails the η case and the extra-phase refinement;
- reverting the `evaluate_pattern` call fails its cosine and Lorentz cases;
- reverting the `rank_next_parameters` call fails the same two cases, through
  `wrNow`.

## What changes for users

These changes apply on MCP with a magnetic model:
- `evaluate_pattern`'s curves and wR, and `rank_next_parameters`' `wrNow`
  and predicted gains, are those of the problem `refine_magnetic_powder`
  solves for the same profile.
- `refine_magnetic_powder` returns the components of the pattern it fitted
  when the model has an extra phase.

Only some profiles see a difference: a background basis other than
Chebyshev, `lorentz: false`, or a pseudo-Voigt with no Lorentzian width (the
only case where the profile's η applies). Output shapes are unchanged.

In the app, the in-app Agent's `rank_next_parameters` on a magnetic powder
page now probes with the page's background basis and Lorentz flag. The app
draws its own curves with `magneticComponentCurve`, which already took η and
is unchanged.

## What it means for the validation

Nothing moves:
- Arm A does not run these tools.
- No eval page uses a background basis other than Chebyshev or turns the
  Lorentz factor off.
- The eval pages' profiles come from `buildPowderSpec`. They are either
  Gaussian or a pseudo-Voigt with a Lorentzian width, where each peak has its
  own η, so the profile's η never applies.

Arms B and C therefore see the same numbers.

## Not done

- **The multi-phase nuclear path ignores the Lorentz flag and the background
  basis too.** `buildMultiPhasePowderProblem` builds every phase's peaks with
  the Lorentz factor on (`createPeakBuilder(…, true)`) and draws the
  background on Chebyshev. `multiPhaseCurves` does the same, and the
  `multiPhasePowder` evaluator spec has no field for either. A two-phase
  nuclear fit passes both and they are dropped: `refine_powder` with
  `extraPhases`, the app's multi-phase page, and `sample_posterior`. Fixing it
  changes the numbers that multi-phase users with a cosine background or an
  I(Q) pattern get, so it waits on the user's decision.
- **The magnetic satellites always carry the Lorentz factor.** With
  `lorentz: false` the nuclear peaks drop it but the satellites keep it
  (`unitMagneticIntensities`), in the fitted problem and in the curves alike.
  The tools now agree with the fit. Whether the satellites should follow the
  flag is a physics question for the user.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2382
tests passed (the five new ones among them), 265 skipped (live runs and
data-dependent suites).

# The POWGEN background: a log default, a file-name hint, a count kept off missing peaks

Pull request [#102](https://github.com/drthyang/materia-platform/pull/102),
branch `claude/powgen-background` (commits `ee84b8e`, `ee04b16`, `68cd4d0`,
`530a0e9`, `596e4c3`), merged into `claude/materia-backlog`, 2026-10-24.
Backlog items M1 (POWGEN starts on a logarithmic background with 1–3
parameters) and M2 (choose the background's count so it cannot absorb a peak
the model lacks). M1b–M1d are the owner's decisions on how POWGEN is
recognized.

## What was wrong

- **One default for every instrument.** A page started on 4 Chebyshev terms.
  New data or a new instrument went back to Chebyshev, keeping the count.
  "Logarithmic" in this code means GSAS-II's log interpolation
  (`logInterpolate`): N heights at log-spaced points, linear in x between
  them. With 1 or 2 points that is the same function as linear
  interpolation. The log spacing first matters at 3 points, where the middle
  one sits at √(x_min·x_max).
- **The interpolation path was dead code, with four bugs that went live once
  it became a default.** `estimateBackground` read log-interpolation seeds at
  evenly spaced x, not at the basis's own points. Seeds were always Chebyshev
  coefficients, whatever the basis. `withBackgroundTerms` kept each height by
  id while its point moved. The report said "Chebyshev polynomial, N terms"
  for every basis.
- **"More terms" was the advice for a missing line.** `diagnose_fit`'s
  background cause fires on χ² between the peaks. A line that no phase has
  sits exactly on those points, so its χ² was billed to the background, and
  the advice asked for the terms that would absorb it. A plain BIC over those
  points does the same: it asked for 16 Chebyshev terms on a broad line that
  needs 4 without it.

## What changed

| Change | Where |
| --- | --- |
| POWGEN time-of-flight data start on `logInterpolate` with 3 points. Every other page starts on 4 Chebyshev terms, as before. The default applies only where a page starts afresh: new data, a new instrument, a new structure. Saved projects, demos and rebuilds that keep the data never apply it | `core/workflow/backgroundDefaults.ts` (new), `powderPage.ts` `startingBackground` |
| POWGEN is the instrument file's named instrument (POWGEN or PG3 in its text, through the registry). When the file names no instrument, the data file's name is a soft hint: `PG3_…` for POWGEN and `NOM_…` for NOMAD, any case, base name only, and only when the hint's mode matches the calibration. An instrument file that names another instrument wins over the hint (M1c). NOMAD has no default of its own, so its hint only labels the card | `instrumentRegistry.ts` `FILE_NAME_HINTS`, `pageInstrument` |
| The Instrument card reads "POWGEN (guessed from the file name)". The guess is never written to the instrument, the project or the report | `PowderWorkbench.tsx` |
| Interpolation seeds are read at the basis's own points and in its own basis; a change of count resamples the curve at the new points; the report names the basis refined | `background.ts`, `powderSpec.ts`, `reportInputs.ts` |
| MCP `build_refinement` takes `backgroundType`. The POWGEN default fills whichever of basis and count the call leaves out | `mcp/tools.ts`, `registry.ts` |
| `diagnose_fit` has an `unexplained-peak` cause. It runs a matched filter on the background points at 1, 2, 4 and 8 line widths, after taking off a 24-width running mean, with a Bonferroni threshold for 1 % false alarms per pattern on pure noise. Its action: "Not background … explain it before adding background terms" | `core/diagnostics/backgroundTerms.ts` (new), `fitDiagnosis.ts` |
| The background cause names the count the points justify: BIC (χ² + k ln n) of the background alone, for 1–24 coefficients of the page's basis, on the background points less the excess. It says "more terms are not justified", or "explain the lines first" when the model lacks some | same |
| `set_background` cautions on its approval card and in its result when more terms would absorb such excess or exceed the justified count | `powderTools.ts` |

The basis and the count stay the user's: the Background group, the Agent's
`set_background`, and MCP's `backgroundType` and `backgroundTerms` all
override the default.

## Evidence

- **The default, on the published 350 K POWGEN example** (`PG3_45598`, bank
  1, nuclear model only; scale, background and cell refined):

  | Basis | Terms | wR % |
  | --- | --- | --- |
  | Chebyshev (old default) | 4 | 9.000 |
  | Chebyshev | 3 | 9.69 |
  | Linear interpolation | 3 | 11.06 |
  | Log interpolation (new default) | 3 | 8.896 |

  Three log points fit as well as four Chebyshev terms, with one parameter
  fewer.
- **How much of a missing line the background takes.** A simulated POWGEN
  pattern (the example's grid and nuclear model, a smooth background, one
  Gaussian line no phase has, noise √μ), with scale and background refined.
  The share of the line's intensity that went into the background, for a
  line at d = 5.3 Å, FWHM 3 %:

  | Terms | 1 | 2 | 3 | 4 | 8 | 12 | 16 | 24 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Chebyshev | 1.8 % | 9.9 % | 17.4 % | 17.7 % | 40.4 % | 61.6 % | 79.3 % | 96.9 % |
  | Log interpolation | 1.8 % | 9.9 % | 12.3 % | 14.7 % | 19.6 % | 19.8 % | 19.9 % | 35.9 % |

- **Before and after, 5 seeds.** A naive BIC asked for 16 Chebyshev terms on
  that line (79 % absorbed). The guarded count is 3–4 (18 %), the count of the
  line-free pattern. Over 80 cases (4 lines × 2 bases × 5 seeds × 1× and 20×
  counts), every line was found at the right d (|Δd| ≤ 0.023 Å), and no
  line-free pattern showed any excess. The count with the line equalled the
  line-free count on the same points in 80 of 80.
- **On the real data** the excess found includes the MnO impurity's lines
  (311, 111, 200, each within 0.004 Å). The count read there is high (19–23),
  because the model lacks a phase, and the cause says "explain them first".
- **Tests.** `src/app/powgenBackground.test.ts` (56 tests): the predicate on
  names and paths, all six load orders, CW data named `PG3_…`, the instrument
  file overriding the name, MCP's defaults and overrides, a saved project
  reopened unchanged, the seeds against a smooth curve (within 10 %, where the
  old evenly spaced middle seed was 57 % off), and resampling to 1e-9.
  `src/core/diagnostics/backgroundTerms.test.ts` (16): the absorption ladder,
  the naive and guarded BIC, detection on TOF and 2θ, at most 2 false alarms
  in 50 noise draws (0 of 50 measured), and the `diagnose_fit` and
  `set_background` texts. Each of the file-name rules failed on the commit
  before it.

## What changes for users

- POWGEN TOF data open on a 3-point log background. Other data, saved
  projects and demos open as before.
- Interpolation backgrounds start from sensible heights and keep their shape
  when the count changes. The report names the real basis.
- The Agent's `diagnose_fit` names a line the model lacks as a line, gives a
  justified count, and its `set_background` card warns before an absorbing
  count. MCP clients get the default through `build_refinement` and the
  protection only through `find_unexplained_peaks`.

## What it means for the validation

No validation case or eval scenario is POWGEN TOF data, so arm A's pinned
results do not move. The model-text snapshots change in the `diagnose_fit` and
`set_background` descriptions, the same in arms B and C. An Agent run that
reads `diagnose_fit` on a pattern with a missing line now gets
"unexplained-peak" where it got "more terms".

## Not done

- A polynomial in ln(TOF) or ln(d) does not exist in the code. If that was
  what "logarithmic" meant, it is a new basis, not added on speculation.
- The Background group's own terms box does not warn (LIMITATIONS says so).
- A hump wider than 24 line widths counts as background. The points under
  overlapping TOF lines at short d say nothing about it. The BIC trusts σ. A
  line already absorbed by a high count leaves no residual to find, so the
  count should be read from a low-order fit.
- The card's "guessed from the file name" label has no render test (the repo
  has none); `pageInstrument`, its source, is tested.

## Checks

At `ee04b16` (M1, M2): `npm run build`, `npm run lint`, typecheck and
`npm test` pass, 2536 tests, 253 skipped. M1b–M1d were checked on the
targeted set (`src/app`, `src/mcp`, model text, the background and instrument
tests): 358 passed, 9 skipped; one MCP host test timed out under load and
passed alone. At the backlog's merged head (`23c1d88`) build, lint,
typecheck and `npm test` pass: 2638 tests, 253 skipped.

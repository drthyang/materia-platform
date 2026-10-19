# Five more readings moved into core (2.3b)

Pull request [#99](https://github.com/drthyang/materia-platform/pull/99),
branch `claude/plan-2-3b`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 2.3. This is the second half of the
readings move; [2.3a](./2026-10-19-readings-core.md) did the other five. The
phase's rule still holds: MCP handlers and live handlers become thin adapters
over the same pure functions, and where two copies disagree, the PR names the
behaviour it keeps and a test pins it.

The five readings waited on #82, #84 and #86, which are all merged. A
read-only survey mapped each reading's code on both surfaces. Only the fit
range has an MCP counterpart. Axis plausibility, `identify_peaks`,
`diagnose_fit` and `reflection_statistics` are app-only. MCP gains no new tool
here: a new tool needs the user's approval.

## What moved

| Reading | Now in | The app | MCP |
| --- | --- | --- | --- |
| Fit range: the inputs (σ, every phase's reflections on the pattern's axis, the excluded plateau, which end holds short d) and the words (each end's name, the verdicts, what the reading rests on, the proposed window) | `core/diagnostics/fitRangeReading.ts` (`readFitRange`, `fitRangeView`, `fitRangeSentence`) | `check_fit_range` answers with the view, as before; the window is applied with `set_fit_range` | `check_fit_range` keeps its structured keys and adds `reading`: the same words in one paragraph, applied as `fitRange` to `refine_powder` |
| Axis plausibility | `core/diagnostics/axisReading.ts` (its number, 3 reflections, is `AXIS_REFLECTIONS_MIN` in `thresholds.ts`) | `get_state.axisWarning`, as before | `check_fit_range` returns `axisWarning`, which MCP never had: a swapped axis went unreported |
| Fit diagnosis view: the rounding, each worst reflection's misfit in words, the report's text, the peak-shape action once the widths are free | `core/diagnostics/fitDiagnosis.ts` (`fitDiagnosisView`, `diagnosisText`, `peakShapeAction`, `durbinWatsonSentence`; the 10 % width agreement is `WIDTHS_AGREE`) | `diagnose_fit` and the report's "Fit diagnosis" check | No `diagnose_fit` on MCP |
| Peak-identification lead | `identifyReading` in `core/diagnostics/knownPhases.ts`, naming the tool that adds a phase where the surface has one | `identify_peaks` names `add_known_phase` | No `identify_peaks` on MCP |
| Single-crystal statistics view: the merge quoted and its R_int, the Friedel coverage, the absences, ⟨\|E² − 1\|⟩, the twin laws' H-test | `core/diagnostics/statisticsReading.ts` | `reflection_statistics`, `get_state` and the report quote one merge | No single-crystal refinement on MCP |

`pct` is now in `core/math/precision.ts` beside `sig`, and `liveCommon`
re-exports both. `pointSigma` (the file's σ, else counting statistics) and
`fittedPoints` (inside the window, off the excluded plateau) are in
`powderResidual.ts`. Before this PR, that σ rule was written out five times
across the two surfaces.

## Where the copies disagreed, and what is kept

**R_int on the single-crystal page.** The data were worded four ways:
`reflection_statistics`, `get_state`, the report's data line and the record.
`get_state` and the report quoted SHELXL's R_int, which keeps the Friedel
mates apart in an acentric group and leaves the absences out.
`reflection_statistics` quoted the Laue class's figure, with SHELXL's as
`rIntFriedelApart`. So on one acentric crystal the Agent read 1.22 % in one
tool and 0.83 % in the other. Kept: SHELXL's, the figure a paper quotes, in
all three. `reflection_statistics` now gives it as `rInt`, with
`rIntLaue` beside it and a note on what separates them (the anomalous
signal). Its `unique` and `redundancy` are the same merge's. SHELXL's R_int
was also computed twice: once in the page's merge, and again inside
`reflectionStatistics`. The second computation is gone.

**Durbin–Watson.** `diagnose_fit`'s reading said "neighbouring residuals miss
together — a systematic misfit, and the esds are underestimated"; the
report's check said "neighbouring residuals correlate (a systematic misfit of
the profile or the model), so the esds — and a posterior's intervals — are
optimistic". Kept: the report's sentence, which gives Q_D whether or not the
residuals correlate. `diagnose_fit` now uses it too.

**The posterior's caveat on MCP.** On both surfaces, `sample_posterior`'s
reading said "a systematic misfit (on powder, diagnose_fit's Durbin–Watson d
below Q_D)". MCP has no `diagnose_fit`. Now the app names the tool and MCP
names the statistic.

**The fit range's `fitted`.** The app reads the residual on a converged
result. MCP also needs `parameters`, because without them its curve is drawn
at the default start. These are the same rule (the curve read must be the
fit's), so both stay.

**The interior note.** The app said "The page fits one window"; it now says
"A refinement fits one window", which holds on both surfaces.

## Evidence

Tests that fail on `main`:

- `mcp/readings.test.ts`:
  - On the page with a detector edge, MCP's `reading` gives the app's words: "The high-angle end: trim at 108.12", the low end's verdict, and the basis. It names `fitRange` and not `set_fit_range`.
  - On the swapped-unit page, MCP's `axisWarning` is the app's sentence; on the demo there is none.
  - `diagnose_fit`'s reading contains the report's serial-correlation check word for word.
- `core/diagnostics/posteriorReading.test.ts`: the caveat names `diagnose_fit` only when the surface passes it.
- `core/diagnostics/fitDiagnosis.test.ts`: the peak-shape action. It frees the widths while they are fixed or disagree, and reads the shape once U, V, W (and X) are free and agree. This was untested before.
- `core/diagnostics/knownPhases.test.ts`: the lead names Si's three lines and its d scale; it names `add_known_phase` only when given; no match reads as none.
- `agent/scTools.test.ts`: on an acentric crystal measured twice with its Friedel mates, `reflection_statistics`, `get_state` and the report quote the same R_int and unique count, with the Laue class's larger figure second.

MCP's reading on the edge page, as it now comes back:

> The low-angle end: trim at 16.968 ° 2θ (d 5.219 Å), 23 points left out —
> background-only: … The high-angle end: trim at 108.12 ° 2θ (d 0.951 Å), 5
> points left out — step: … a detector's or a scan's edge. Read on the data
> alone (no converged fit yet: run this again after the first refinement,
> when the residual can show more). Proposed window 16.968–108.12 ° 2θ
> (d 5.219–0.951 Å): pass it on as `fitRange` to refine_powder and
> check_cell_symmetry.

Tests that moved: `reflectionStatistics.test.ts` and `sc1b.test.ts` pinned the
removed second R_int. They now pin the page's merge (`measurementMerge`),
SHELXL's 2.93 % on the 1b data. `sc1bAgent.test.ts` reads `rInt` 2.93 and
`rIntLaue` 3.04. The MCP contract test pins `check_fit_range`'s new `reading`
key.

## What changes for users

- **MCP `check_fit_range`** adds `reading` (string), and `axisWarning` when
  the axis cannot be what the file says.
- **MCP `sample_posterior`'s** reading no longer names a tool MCP lacks.
- **`reflection_statistics`** changes shape on an acentric crystal with
  repeats: `rInt`, `unique` and `redundancy` are SHELXL's merge, and
  `rIntLaue` replaces `rIntFriedelApart`.
- **`diagnose_fit`'s** Durbin–Watson sentence reads as the report's.

## What it means for the validation

The held-out cases are untouched. Arm A's pinned results do not read these
tools. An arm B or C run on an acentric crystal now reads one R_int across
the page's tools. An MCP run sees `check_fit_range`'s words and a swapped-axis
warning.

## Found on the way

- MCP's `check_fit_range` with `extraPhases` draws its curve for the main
  phase only. The extra phases' reflections are placed, but their peaks are
  missing from the Bragg part, so a cut can land beside one of their lines.
  It refuses `parameters` with several phases; drawing the multi-phase curve
  at the default start would fix it. Not done here.
- The per-shell R_int in `reflection_statistics` and in the report's
  resolution check is still the Laue class's.

## Not done

- MCP still has no `diagnose_fit`, `identify_peaks` or single-crystal tools.
  The core functions are ready for them, but each is a new tool and waits on
  the user.

## Checks

Full suite: 2483 passed, 265 skipped. `tsc -b`, eslint and the build are
clean.

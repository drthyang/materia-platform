# Four readings moved into core, one per surface (2.3a)

Pull request [#PR](https://github.com/drthyang/web-refinement/pull/PR),
branch `claude/plan-2-3`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 2.3. The phase's rule: MCP handlers and live
handlers become thin adapters over the same pure functions. Where two copies
disagree, the PR names the behaviour it keeps and why, and a test pins it.

## Split

2.3 lists ten readings. A read-only survey mapped where each one lives, its
MCP counterpart, and what ties it to the agent. Five of them are in code that
open pull requests change:

| Reading | Changed by |
| --- | --- |
| Fit range | #82 |
| Axis plausibility | #82 |
| Fit diagnosis view | #82 (its core) |
| Peak-identification lead | #86 |
| Single-crystal statistics view | #84 |

Those wait for 2.3b, after those PRs merge. This PR, 2.3a, moves the other
five: the correlation guard, the posterior reading, the PDF assessment mode,
the shoulders and the cell scale and shifts.

## What moved

| Reading | Now in | The app | MCP |
| --- | --- | --- | --- |
| Correlation guard: the check, its exemptions, the carried pairs | `core/diagnostics/correlationGuard.ts`; the shared rule (`carriedByThird`, `intensityTerms`) is in `assessment.ts`, its numbers (`CARRIED_BELOW`, `CARRIED_MAX`) in `thresholds.ts` | `refine` refuses on it. The refusal's wording, which names `set_free`, stays in `src/agent/correlationCheck.ts` | No guard: `refine_powder` never refuses. `assess_refinement` reads the same exemptions |
| Posterior reading: per-parameter verdicts, the run's reading, differences | `core/diagnostics/posteriorReading.ts` | `sample_posterior` and the report read through it. How to resume is passed in (`continue: true`) | `sample_posterior` returns `intervals` and `reading` (resume with `resume`) |
| PDF assessment mode | `assessRefinement`'s `pdf` mode | The page no longer strips the GoF before calling | `assess_refinement` takes `mode: "pdf"`, and a PDF scale among the parameters implies it |
| Cell check: d scale, cell shift, shoulders, the unindexed and forbidden sentences | `core/diagnostics/cellReading.ts` | `check_cell_symmetry` names `identify_peaks`, `write_note` and `review_symmetry` | `check_cell_symmetry` returns `reading`, naming `review_symmetry` (MCP has no `identify_peaks` or `write_note` yet) |

`sig`, the tools' rounding, is now `core/math/precision.ts`, and
`liveCommon` re-exports it.

## Where the copies disagreed, and what is kept

**Correlations.** The guard refines two kinds of pair together:

- a pair a third free parameter carries: under 0.9 with every other free
  parameter fixed, and under 0.99 itself;
- on a single crystal, the overall intensity terms (scale, extinction, batch
  scales).

The assessment warned about both pairs as "dangerous", telling the model to
refine them apart, right after the guard had refined them together. The
guard's rule is kept, since it was measured: on synthetic corundum the B's
come back within 0.002 Å² of the truth with scale ↔ B(O) at 0.976 (0.72
conditional). The assessment now notes such a pair and says what carries it.
A pair that trades off by itself still warns. On powder the scale and the
extinction are not exempt: two phases' scales at −0.99 are a real problem
there.

**PDF verdict.** MCP's `assess_refinement` could not ask for the PDF mode, so
a `refine_pdf` result read the engine's GoF on the powder bands (Toby's). The
app's page stripped the GoF before calling. Kept: the page's behaviour, done
once in core. The PDF mode leaves out the GoF, and its verdict now gives its
own reason ("A PDF fit has no goodness of fit … judge it from the difference
curve and from Rw against fits of the same data and window") instead of "no
expected-R was available". The PDF's fair and poor texts could never be
reached, by either surface, and are removed.

**Posterior and cell check.** Here the copies did not disagree: MCP returned
the raw numbers and left the reading to the client. Both now carry the
reading, worded for their own tools.

## Tests

The tests were written first; these fail on `main`:

- `assessment.test.ts` "notes, not warns about, a pair the correlation guard
  refines together".
- `assessment.test.ts` "reads a PDF fit without a GoF band, the mode taken
  from its parameters when not given".
- `mcp/readings.test.ts`: the wrong-wavelength eval page's d-scale sentence is
  identical from MCP and from the app.
- `mcp/readings.test.ts`: MCP's `sample_posterior` gives intervals with
  verdicts, and a not-converged reading that says to resume.

The MCP contract pins add `reading` to `check_cell_symmetry`, and `intervals`
and `reading` to `sample_posterior`. The moves themselves change no output
in the app: its tests pass unchanged, with only their imports updated.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2381
tests (`main`'s 2377 and 4 new ones), 265 skipped (live runs and
data-dependent suites). The skipped SHELXL data suites (`sc1bAgent`,
`sc2bAgent`, `sc3aAgent`) read `assess_refinement` on real data. The change
can only turn a correlation warning into a note, never add a finding. 1b's
assertion that its only correlation finding is the disorder's info therefore
holds either way.

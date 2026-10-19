# The magnetic step as one module (first half)

Pull request [#73](https://github.com/drthyang/web-refinement/pull/73),
branch `claude/magnetic-step`, stacked on `claude/powder-plans` ([#72](https://github.com/drthyang/web-refinement/pull/72)), 2026-10-19.
Plan: [AGENT_PLAN.md](../AGENT_PLAN.md), 2.4. The architecture review's #2,
built as the user answered its six questions: the step's operations in one
module, `app/magneticStep.ts` (Q1). Where the panel and the headless copy
differed, the panel's behaviour is kept (Q2). Two defects of the app are
fixed (Q3). There is one k-search option set and one restart scheme (Q4).
This is the first of two PRs (Q5); the panel's state moves into the module in
the second.

The step's state and operations lived in `KSearchPanel.tsx` (2 144 lines),
which the powder, single-crystal and PDF pages share. The Agent's tests and
the magnetic eval scenario ran on a separate 253-line copy
(`testSupport/magneticHeadless.ts`). That copy differed from the panel:
- it searched k without the lattice's centring;
- it built the model on the loaded phase, not the refined one;
- it found its own peaks, annotated against the primary phase only;
- it fitted the moments over the whole pattern, the primary phase only and
  the default background basis;
- it scored the nuclear model its own way;
- it ranked only the maximal groups, and stopped the ranking at a fit that
  failed;
- Continue left the k rows fixed.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `app/magneticStep.ts`: the peak table and the Agent's picks, the k-search (`K_SEARCH`, the lattice's centring), the groups and their moment dimensions, the moment model under the page's ties, the rows a fit frees (`fitRows`), the ranking and its best group, and the rows Continue hands over (`handoff`). The `MagneticFit` seam moves here from the component | The step's operations written twice, in a React component and in a test copy that drifted |
| The panel calls the module for each operation. The fit is always the page's: the panel's own in-thread powder fit, and the props only it read, are gone | The panel's fallback fit, which dropped the background basis |
| `app/powderPage.ts` gives the powder page's view of the step: `residualPeaksOf` (what the workbench computed: the page's curves, every phase's reflections at the refined cells), `powderMomentFit` (`momentFitRequest`: the nuclear model held, the page's full profile, every phase, the window), `withMagneticPreview` (Show), and `pageAxis`. The workbench and the headless page both call them | The headless copy's own peaks, fit and Show |
| The headless step (`testSupport/magneticHeadless.ts`) holds the panel's state over the module. It resets the ranking and the fit readout where the panel does, keeps the open index sections, carries the amplitudes over by row id, and keys the Agent's peak picks by d | The headless copy's own operations |
| **The full profile** (Q3): the moments fit passes the page's background basis and Lorentz flag, as the refinement does | On a page with a cosine background, the panel fitted the moments against a different nuclear curve from the one the page shows |
| **The phase gauge held** (Q3): a fit frees every amplitude but a derived one and the phase gauge of a two-arm k. The ranking does not kick it, and Continue hands it over held. The powder and single-crystal pages take the rows as handed | Both copies freed the gauge, a phase the data cannot see |
| **One k-search option set** (Q4): the panel and the headless step share `K_SEARCH`. The MCP tool keeps its documented options | The headless copy searched without the centring: on a body-centred lattice it took the h + k + l odd peaks for k = 0 |
| **One restart loop** (Q4): the ranking's kicked restarts. Each start is one fit without the page's own restarts (`momentFit`'s `restarts` on the single-crystal page). The mPDF's fit keeps its own seeded restarts in each start (`nestedStarts`), because its ranking needs them (below) | The single-crystal ranking ran 13 × 9 fits per group |
| The headless page's axis (`pageAxis`) includes the refined TOF calibration, as the workbench's does | The Agent's d on a TOF page ignored a refined difC |

## Evidence

- **Tests first** (`app/magneticStep.test.ts`). On the base branch, ten fail:
  - the headless k-search on a body-centred page gave (0 0 0), not (0 0 1);
  - the step's wR was not the page's wR at the moments it fitted, with a
    window and a second phase, and with a cosine background;
  - its nuclear-only wR was not the page's;
  - after Continue at k = (0 0 ¼) the gauge was free and the k row fixed;
  - the moments fit did not go through the page's compute client, and freed
    the gauge;
  - a failing fit stopped the ranking;
  - the ranking skipped an index section that a choice had opened;
  - the single-crystal fit ignored a restart count.

  All pass now, with the ranking's restart scheme (one fit per start, the
  fit's own starts kept where it asks).
- **The rankings, single crystal and mPDF** (Q4: I said I would check the
  committed examples; none ranks groups on those pages). On a synthetic
  Mn₃Ga single crystal at k = (0 0 ½), with satellites from the group at
  the truth, the six maximal groups were ranked three ways. Nested restarts
  (as before), one loop, and the page's own restarts only all gave the same
  order and the same wR2 to 0.001 %. All picked the true group. They took
  36 s, 6 s and 3 s. On a synthetic Mn₃Ga mPDF:

  | Scheme | Starts per group | The true group (G2) | Best | Time |
  | --- | --- | --- | --- | --- |
  | Nested restarts (as before) | 52 | Rw 2.48 %, second | G6, 2.43 % | 34 s |
  | One loop | 13 | Rw 5.29 %, fourth | G6, 2.44 % | 12 s |
  | The page's own only | 4 | Rw 5.29 %, fourth | G6, 2.43 % | 2.5 s |

  So the mPDF's fit keeps its seeded restarts in each of the ranking's
  starts, as it did, and the single-crystal and powder pages run one loop.
- **In the browser**, on the Mn₃Ga TOF demo's Magnetic tab (paramagnetic at
  600 K, so every group ties with the nuclear fit), the panel gave the same
  text on the base branch and here, with no page error:
  - the 24 residual peaks, with their nuclear neighbours;
  - the six maximal groups ranked at k = (0 0 ½), with the ★ and the ties;
  - the chosen group's moments fit.

  The three committed demo replays gave the same drawer text as on #72.
- **Nothing else changed.** The Agent's magnetic tools and their ranking
  test (Example 3: with restarts the in-app path reaches the true minimum),
  the stamp, Stop, the live tools' contracts and the snapshot of the text
  the model reads pass unchanged.

## What changes for users

- **Powder, a background basis other than Chebyshev, or the Lorentz flag
  off:** the Magnetic tab fits the moments against the curve the page
  shows.
- **A two-arm k (¼-type, ⅓-type or incommensurate):** the phase gauge stays
  fixed in the moments fit, in the ranking and after Continue.
- **The single-crystal page's ranking** is about six times faster, with the
  same result on the case above.

## What it means for the validation

The Agent's headless page now runs the panel's step. A magnetic scenario
can find other residual peaks (every phase's reflections now mark a peak as
near one), another nuclear-only wR (the page's, in its window) and another
k on a centred lattice. The eval scenarios and replays pass unchanged.

## Found, not fixed

- **A multi-phase page ignores the background basis.** `multiPhaseCurves`
  and the multi-phase nuclear refinement take only the peak shape and η, so
  a second phase with a cosine background draws and refines with Chebyshev.
  The magnetic co-refinement and the step's fit honour it. Found by this PR's
  test, which checks the basis and a second phase separately for that
  reason.
- **The PDF page's Continue leaves the moments fixed.** It took the rows as
  built (all fixed), and still does: the code says so now. The page's status
  line says Refine then fits nuclear and magnetic together. Was that meant?
- **The panel drops its ranking when a model is shown.** Show strips the
  model's rows, which rebuilds the refined structure, and the ranking keys on
  it. The second PR keys the step's state on content.

## Not done

The second PR (Q5 b): the panel's state into the module, the panel
rendering only, and one persistent handle for the Agent. That removes the
"read again after the render" workarounds in `magneticTools.ts`.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2355
tests, 265 skipped (live runs and data-dependent suites).

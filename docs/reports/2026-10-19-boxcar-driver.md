# One boxcar scan for the app and MCP

Pull request [#77](https://github.com/drthyang/web-refinement/pull/77),
branch `claude/strategy-drivers`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 2.6 (in part). The first half of the
architecture review's #6, "strategy drivers behind the solver seam", on the
answers taken for the user (who asked for the recommended ones): the drivers
live beside the evaluator spec they work on, the boxcar first and then the
moment multi-start, one Jacobian rule for every runtime, and MCP takes the
inputs the app's copy takes.

The PDF boxcar scan was written twice: in the browser's compute client
(which the app's PDF page and the Agent's headless page both run) and in the
MCP tool `refine_pdf_boxcar`. The headless page's own third copy, which the
review named, had already gone; a test kept a fourth.

## What changed, and why

| Change | What it answers |
| --- | --- |
| **`workers/strategy.ts`**: a `Solver` (the problem set on the evaluators, then one start refined at a time), `poolSolver` over a worker pool or in-thread without one, and the boxcar scan (`boxcarScan`) written once over it. The browser's client and the MCP tool each hand it their pool, keep its lifecycle, and the browser its cancel | The scan, its per-box restarts and its seeding, twice |
| **One Jacobian rule** (`analyticDriverPolicy`, moved from the client): a PDF problem's analytic columns on the driver, on the pool and in-thread alike | The client's in-thread scan differentiated numerically, the MCP's analytically, so the headless page and the evals scanned unlike MCP |
| **A restart kicks from the esds** of the start it perturbs, on MCP as in the app | The MCP copy wrote back the values only, so its restarts kicked by another rule |
| **`refine_pdf_boxcar` takes `extraPhases`**, as `refine_pdf` does | A two-phase G(r) could be refined on MCP but not scanned |
| The test that kept its own copy of the per-box restart loop now tests the driver | A fourth copy |

The drivers are not in `core`: they work on the evaluator spec
(`workers/protocol.ts`), which `core` does not know, beside
`buildProblemForSpec`, which every runtime builds its problem with. They use
no Worker API.

## Evidence

- **The two runtimes alike** (`workers/strategy.test.ts`): on a noisy
  synthetic G(r) with the ADP free (a column with a closed form), the
  browser's client and the MCP tool give the same value and esd tracks, with
  two restarts per box; on a two-phase G(r) they give the same tracks, and
  every box fits better with the second phase than without. Both fail on
  `main`.
- **The restarts** (same file): a box restarted from its seed never fits
  worse than the seed alone, and a rerun repeats the series exactly.
- **The tools' contracts**: Example 4's boxcar on MCP (U(Se2) growing with r,
  the cell flat, the two directions agreeing), the PDF agent loop's windows,
  the registry's output keys, the PDF page's call order and the Agent's
  `boxcar_scan` pass unchanged.
- **In the browser**, the GaTa₄Se₈ PDF demo's Boxcar tab, the default plan on
  the worker pool: 22 boxes, the same table on `main` and here, line for line
  (Rw and PDF scale per box), in the same 20 s; no page error.

## What changes for users

Nothing in the app. On MCP, `refine_pdf_boxcar` takes `extraPhases`, and its
restarts kick as the app's do.

## What it means for the validation

The Agent's headless PDF page now scans with the analytic PDF Jacobian, as MCP
and the app's worker pool do. No validation case runs a boxcar.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2363
tests (`main`'s 2361, the three new, less the copy it replaces), 265 skipped
(live runs and data-dependent suites).

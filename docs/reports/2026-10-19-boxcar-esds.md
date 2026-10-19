# The boxcar scan's esds, drift and restarts

Pull request [#88](https://github.com/drthyang/web-refinement/pull/88),
branch `claude/plan-4-5`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 4.5 (`boxcar_scan` returns per-box esds
and each parameter's drift in esds; restarts reachable). AGENT_REVIEW's tool
table: "The Agent's view drops the per-box esds, so a drift cannot be judged
for significance."

## What was missing

Every box of a boxcar scan is a fit, and it carries its esds: the Boxcar view
plots them and MCP's `refine_pdf_boxcar` returns them. The Agent's
`boxcar_scan` did not. It gave each box's values and each parameter's spread
(first, last, min, max) and told the model to "judge a drift against the
spread from box to box". The scan's perturbed restarts (#77) were reachable
from the panel's tick and from MCP's `restarts`, but not from the Agent. Its
scan ran with whatever the panel was set to.

## What changed

| Change | Where |
| --- | --- |
| Each box gives its free parameters' esds (`esds`) beside their values | `boxcarView` in `src/agent/pdfTools.ts` |
| Each parameter's spread gives `driftInEsds`: (last − first)/√(σ_first² + σ_last²). The first and last boxes share no data in a scan of more than two boxes; when they do overlap, the difference's true esd is smaller and the figure errs low | the same |
| The reading says how to read it. A PDF's points are correlated and it has no GoF, so its esds understate the uncertainty: a drift of a few esds is weighed against the scatter from box to box, a drift of tens is real. The bond lengths carry no esds | the same |
| `restarts` (0–16): perturbed starts each box also refines from, the seeded start kept. The scan runs from the seeded start alone unless the Agent asks, whatever the panel's tick. The panel then shows the plan the Agent ran, and the preview says "best of n starts per box" | `tools.ts`, `PdfAgentPort.boxcar` |
| One function, `agentBoxcarPlan`, lays the Agent's plan on the panel's, for the workbench and the headless page alike | `src/app/pdfPage.ts`, `PdfWorkbench.tsx`, `agentHeadless.ts` |

The output adds keys (`esds` per box, `driftInEsds` per parameter,
`restarts`) and removes none.

## Known answer

The test is nickel's G(r) (Fm-3m, neutrons, 1.5–20 Å) with Gaussian noise of
2 % of the largest |G| on every point and its σ given, so the esds are
statistical here. It scans boxes of 4 Å every 4 Å across 1.5–17.5 Å, with the
scale and the cell free.

| Truth | First box a (Å) | Last box a (Å) | `driftInEsds` |
| --- | --- | --- | --- |
| a = 3.52 Å at every r (three noise seeds) | 3.5197–3.5202 | 3.5199–3.5202 | 0.32, −0.50, 0.37 |
| a = 3.485 Å below ~6 Å, 3.52 Å beyond (three seeds) | 3.486 | 3.520 | 60, 63, 56 |

`boxcarDrift.test.ts` holds these two cases at the first seed: under 2 esd
for one cell, and over 20 for the local one. On `main` the scan gives no
esds, and the drift and restart tests in `executor.test.ts` fail.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2381
tests (`main`'s 2377 and 4 new ones), 265 skipped (live runs and
data-dependent suites). The model-text snapshots change by the description
and the new input. In the browser, the PDF demo's Boxcar view runs its
default scan (22 boxes, 13.7 s) with no page error; that path, without an
Agent plan, is unchanged.

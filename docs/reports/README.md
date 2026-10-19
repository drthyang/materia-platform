# Improvement reports

One report for each change that improves the code: what changed, why, the
evidence that it works, what a user or the validation will see differently,
and what is left. A report is a record of one change, written when the change
is made; the documents it touches describe the current state, and this folder
keeps the history of how they got there.

## What a report holds

- **What changed, and why**: each item, with the finding or failure it answers
  (a plan item, a review finding, a user report).
- **Evidence**: the test that fails without the change, a measurement taken
  before deciding, a run of the built app. Numbers as measured, with how.
- **What changes for users**: behaviour a user, the Agent or an MCP client
  will notice, including any change of output shape.
- **What it means for the validation**: whether arm A's pinned results moved,
  and what arms B and C now measure differently.
- **Not done**: what the change leaves for later, and the decisions waiting on
  the user.
- **Checks**: build, lint and the test suite at the change's head.

Name a report by date and subject, and link it from its pull request.

## Reports

| Report | Change |
| --- | --- |
| [2026-10-17 · Agent plan, phase 1](./2026-10-17-agent-plan-phase-1.md) | The validation measures the Agent: the verdict check in evals, a structural arm C, one run policy, the record's lifecycle, the holdout scan, the powder page's operations shared ([#61](https://github.com/drthyang/web-refinement/pull/61)) |
| [2026-10-17 · Agent plan, core of phases 2–5](./2026-10-17-agent-plan-core-2.md) | One analysis under both tool surfaces: one residual and one peak search, one thresholds module, structured tool outcomes, the residual-peak floor, data per parameter on powder, the skill lint ([#62](https://github.com/drthyang/web-refinement/pull/62)) |
| [2026-10-17 · The skill drafts](./2026-10-17-skill-drafts.md) | The skills brought into line with the tools (5.2–5.5): the review's proposals and contradictions, the method's order out of the tool descriptions, Gates and a budget for a 32k window, Stage 0's data checks, the Prefit route and a possible lost centring. A draft for the user's review ([#63](https://github.com/drthyang/web-refinement/pull/63)) |
| [2026-10-18 · The single-crystal page's operations](./2026-10-18-single-crystal-page.md) | One module for what the single-crystal page does, called by the workbench and the Agent's headless page; an ADP switch with riding hydrogens; another reflection file; the Reset button on every page ([#65](https://github.com/drthyang/web-refinement/pull/65)) |
| [2026-10-18 · The PDF page's operations](./2026-10-18-pdf-page.md) | One module for what the PDF page does, its rows rebuilt with each change; the headless page fits as the app; a reopened project's boxcar scan; the ADP switch on a multi-phase page ([#66](https://github.com/drthyang/web-refinement/pull/66)) |
| [2026-10-18 · One adapter per page for the executor](./2026-10-18-page-adapter.md) | What differs by page held once per page in `src/agent/pages/`; the stamp a change is approved against covers every setting the Agent can change, so a change approved after one moved is not run ([#67](https://github.com/drthyang/web-refinement/pull/67)) |
| [2026-10-18 · A call log for the evidence gate](./2026-10-18-call-log.md) | The gate reads each call's status and whether the fit changed, not its name: no send-back after a refused refinement, and one after a change that cleared the fit ([#68](https://github.com/drthyang/web-refinement/pull/68)) |
| [2026-10-18 · A tool's facts on its definition](./2026-10-18-tool-facts.md) | Each live tool's facts (History step, cards, where it is offered, evidence, …) on its definition; the side lists derived, a test against new ones; the effect labels corrected ([#69](https://github.com/drthyang/web-refinement/pull/69)) |
| [2026-10-18 · The PDF page's changes as plans](./2026-10-18-pdf-plans.md) | One plan per change tool on the PDF page, typed by its input, the shared plans written once; a change that cannot run refused before its card ([#70](https://github.com/drthyang/web-refinement/pull/70)) |
| [2026-10-18 · The single-crystal page's changes as plans](./2026-10-18-sc-plans.md) | The 19 change tools of the single-crystal page as plans, each working out once what the card and the change both use; a change that cannot run refused before its card ([#71](https://github.com/drthyang/web-refinement/pull/71)) |
| [2026-10-18 · The powder page's changes as plans](./2026-10-18-powder-plans.md) | The powder page's 14 change tools and its magnetic step's 7 as plans, the last page of one definition per live tool; a change that cannot run refused before its card ([#72](https://github.com/drthyang/web-refinement/pull/72)) |
| [2026-10-19 · The magnetic step as one module (first half)](./2026-10-19-magnetic-step.md) | The step's operations in one module the panel and the Agent's page both run; the moments fit with the page's full profile, the phase gauge held, one k-search option set, one restart loop (the mPDF's fit keeping its own starts) ([#73](https://github.com/drthyang/web-refinement/pull/73)) |

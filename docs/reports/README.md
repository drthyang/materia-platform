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
| [2026-10-17 · The skill drafts](./2026-10-17-skill-drafts.md) | The skills brought into line with the tools (5.2–5.5): the review's proposals and contradictions, the method's order out of the tool descriptions, Gates and a budget for a 32k window, Stage 0's data checks, the Prefit route and a possible lost centring. A draft for the user's review |

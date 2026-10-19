# One adapter per page for the Agent's executor

Pull request [#67](https://github.com/drthyang/web-refinement/pull/67),
branch `claude/page-adapter`, 2026-10-18. Plan: [AGENT_PLAN.md](../AGENT_PLAN.md),
3.3. The third candidate of the architecture review, first in the order the
user set (the page adapter, then the call log, one definition per live tool,
the magnetic step, the powder state, the strategy drivers).

The executor runs every Agent call the same way on each page: validate, gate,
ask, act, answer. What differs by page was decided where it was needed: 25
branches in `executor.ts` (ternaries on `port.technique`, duck-typed checks
such as `"dataset" in s` or `"rw" in s`, and casts to each page's state) and
two in `method.ts`. One of them was the **stamp**, the hash of what a change
was checked and approved against: it read the rows, plus whatever a state's
`fitRange` and `settings` fields held. The single-crystal page has neither, so
there it read only the rows.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `src/agent/pages/`: one adapter per page (`powder.ts`, `pdf.ts`, `singleCrystal.ts`) on one interface (`types.ts`), typed on that page's port and state. It holds the page's facts (the agreement it shows, the analysis it keys the record by, the stamp, the references, the report's checks, the disorder groups the correlation check lists) and routes the page's tools (read, noOp, describe, change) to `powderTools`, `pdfTools` and `scTools`. The powder adapter routes the magnetic step's tools to `magneticTools` | What differs by page was decided in 27 places across two files |
| `pages/index.ts` holds the table and the one lookup (`onPage`). The executor runs the page-dependent part of a call (`executeOn`) typed on the page it found | The casts and duck typing. The executor now has no `port.technique` ternary, duck-typed state check or cast |
| Each page's stamp covers every setting the Agent can change there. On the powder page that includes the X-ray constants (on the radiation), the phases and the magnetic model. Once the magnetic step's tools are in use it also covers the step's k, ions, moment ties, the group chosen and its moments. On the single crystal it covers every setting the port has a setter for | The old stamp missed fifteen settings. A change approved after one of them moved still ran |
| The situation's fingerprint (the chat loop's guard: did a call change anything?) carries the page's stamp | It kept its own copy of the old stamp's fields, with the same misses |
| A card approved after another page was opened is refused as stale. A change during which its page closed fails with an error | Before, the stamp of another page's state was compared (refused only because the hashes happened to differ), and the outcome read another page's state |
| `method.ts` keys an analysis with one typed function per page (`powderAnalysis`, `pdfAnalysis`, `singleCrystalAnalysis`); `keyOfState` is gone, and the shell, the eval checks and the tests use `analysisOf(port)` | Its two duck-typed branches |
| The report's agreement label reads the adapter's key | A third copy of wR / Rw / wR2 |
| `sample_posterior` takes the port by what it reads (its state and its sampler) | It needed the page narrowed first |

The ports, the tools, their inputs and their answers are unchanged.

**The magnetic step and the stamp.** Reading the step's panel costs about
0.1 s on the headless page (it finds the residual peaks each time), and the
stamp is read before and after every change. So the panel counts in the stamp,
and in the fingerprint, once the step's tools have run in the conversation, as
the fingerprint already did. A magnetic change marks the step in use before
its stamp is taken, so every magnetic change is checked against the panel.

## Evidence

- **A table test fails without the change** (`agent/pages/stamp.test.ts`).
  On a fresh page, each setter on each page's Agent port, and each setter on
  the powder page's magnetic handle, must move that page's stamp. A setter
  with no entry in the table fails the test, and so does a setter the stamp
  does not see. Functions that set nothing (reads, fits, views) are listed
  with the reason. On the old stamp it failed for fifteen setters:
  - eight on the single-crystal page (`setExtinctionModel`, `setWeighting`,
    `setDistanceRestraints`, `invertStructure`, `setMerged`, `setOmitted`,
    `setResolution`, `setOutlierFilter`);
  - the powder page's `setInstrumentConstants`;
  - six on the magnetic step (`setK`, `selectIons`, `setTies`, `choose`,
    `refineMoments`, `apply`).

  The PDF page passed on the old stamp too (its window and rows were in it;
  the test switches its ADP model). It passes for every setter now.
- **End-to-end, through the executor** (`agent/stop.test.ts`). Two cases:
  - the user switches the OMIT filter while a `set_weighting` card waits;
  - the user sets another k while a `choose_magnetic_group` card waits ("G2"
    then names another group).

  On `main` both changes ran (run in a worktree of `main`). Now both are
  refused as stale, and the weights and the group stay as they were.
- **Nothing the model reads changed.** The snapshot of the text the model
  reads (`src/agent/__snapshots__/`) is unchanged. Every executor, eval and
  replay test passes as it was; three test files only call `analysisOf(port)`
  in place of `keyOfState`.
- **In the browser**, on dev servers of `main` and of this branch (one at a
  time), Playwright played the three committed demo replays (the Mn₃Ga TOF
  refinement, the GaTa₄Se₈ boxcar scan with its report, the corundum crystal
  from its files) with every card approved. The drawer text was the same on
  both, apart from timings, with no page error. A temporary replay (not
  committed) proposed `set_weighting` on the corundum crystal, run twice:
  - as a control, approved as it came: the weights were set on both builds;
  - with the OMIT filter's box ticked on the page while the card waited, then
    approved: on `main` the weights were set anyway, under a card that no
    longer described the page; here the drawer said "Not run: the analysis
    changed while it waited for approval".

`executor.ts` went from 966 to 934 lines. The page-dependent part of a call
moved into `executeOn`, which is why most of its diff is re-indented lines.

## What changes for users

- **A change you approve after moving a setting under its card is not run.**
  This covers, on the single-crystal page, the weights, the extinction model,
  the restraints, the hand, the merge, the omissions, the resolution and the
  OMIT filter; on powder, the X-ray constants; and, once the Agent works on
  the magnetic step, its k, ions, ties, group and moments. The drawer says
  "Not run: the analysis changed while it waited for approval", and the
  Agent reads the state again. Before, the change ran on the page as you had
  left it, under a card that described another state.
- Nothing else changes: the same tools, cards, answers and report.

## What it means for the validation

The model reads the same text in every arm. The chat's loop guard tells a
repeated call from a new one by the fingerprint, which now moves with any of
these settings. Before, a change to one of them left the fingerprint as it was
unless it also cleared the fit or moved a row, so the guard could take a read
after it for a read at the same state.

## Not done

- `method.ts` keeps the stages and the rule wording as tables by page, and
  `tools.ts` keeps each tool's page list. These are data, not dispatch.
- The report builder (`report.ts`) still builds its sections by page; those
  are the report's own content.
- The headless History in `testSupport/agentHeadless.ts` still tells the pages
  apart by their state's fields.
- `powderTools`, `pdfTools` and `scTools` stay as they are until one
  definition per live tool (candidate #4). The magnetic step's tools still
  route inside the powder adapter until the magnetic step module (#2).
- Next in the user's order: the call log for the evidence gate (#5).

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2328
tests, 265 skipped (live runs and data-dependent suites).

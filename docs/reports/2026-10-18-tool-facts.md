# A tool's facts on its definition

Branch `claude/tool-facts`, 2026-10-18. Plan: [AGENT_PLAN.md](../AGENT_PLAN.md),
3.1. The first half of the architecture review's #4 (one definition per live
tool), built as the user answered its five questions. The second half, one
plan per tool per page in place of the three switches, follows page by page,
PDF first.

What the app knows about each live tool was split across eight modules. The
definition in `tools.ts` held the name, description, schema, effect and pages.
Everything else was a list keyed by tool name, kept beside the code that read
it:
- the History step a change records (`STEP_KIND`, `executor.ts`);
- the cards it acts on (`TOOL_CARDS`, `focus.ts`);
- where a local model is offered it (six lists in `toolScope.ts`);
- whether it is a sampler, or neutral to the stall count (`SAMPLERS`,
  `STILL_NEUTRAL`, `chat.ts`);
- whether its results are kept in a long session (`KEEP_TOOLS`,
  `contextWindow.ts`);
- whether it belongs to the magnetic step (`READS`, `CHANGES`,
  `magneticTools.ts`);
- whether it needs a structure (`NEEDS_STRUCTURE`, `powderTools.ts`);
- the evidence it gives a final answer (`evidence.ts`).

A new tool meant editing each list that should name it, and nothing failed
when one was missed.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `LiveToolSpec` carries the facts: `cards` (required), `historyStep`, `offer` (core; the powder method's stages, "always" or "finish"; the magnetic step; the topics of the user's words), `needsStructure`, `sampler`, `stallNeutral`, `keep`, `magneticStep` and `evidence` | Facts in side lists |
| Every list is now derived from the definitions where it is read (the scoping lists, the cards by name, the keep list); the other modules read the fact off the tool (`liveTool(name)?.needsStructure`, `spec.historyStep`, …) | Eight modules: 25 lists of two names or more, and two of one (`SAMPLERS`, `KEEP_TOOLS`) |
| The phrases of the user's words that bring tools in stay in `toolScope.ts`, by topic; each tool names its topics | The phrase list paired each regex with a list of tool names |
| The effects are corrected: `write_note` and `write_report` are `record` (they write the Agent's record, not the analysis), and `search_propagation_vector` and `rank_magnetic_groups` are `compute` (they fill the magnetic panel and change no fit) (the user's Q3) | Four tools labelled `read` that do not only read |
| Every reader of the effect says what it means, so its behaviour stays as it was. The executor runs `compute` as it ran these reads. The loop guard counts `compute` toward a stall, as it did, and a `record` neither counts nor resets, as the old neutral list had it. The drawer's turn outcome counts changes and the stop control, as before | A reader that tested `effect !== "read"` would have counted the corrected tools as changes |
| A test fails when a module keeps its own list of tool names (`agent/toolFacts.test.ts`), and checks the facts against each other and against the method: a stage named is one of the powder method's; only a change records a History step; a magnetic tool works on the powder page | Nothing failed when a list was missed |
| The snapshot of the text the model reads is copied into this branch from #63 (its first commit, which recorded `main`'s text) (Q4) | The gate for "nothing the model reads changes" lived only on #63's branch |

The eval graders (`agent/evals/`) are exempt from the test: a grader names
the calls it grades.

## Evidence

- **The test fails on `main`**, finding 25 lists in seven modules (`chat.ts`,
  `evidence.ts`, `executor.ts`, `focus.ts`, `magneticTools.ts`,
  `powderTools.ts`, `toolScope.ts`); the two lists of one name, in `chat.ts`
  and `contextWindow.ts`, are too short for it to find. It passes now.
- **Every derived list equals the one it replaced.** I dumped the old lists
  and what they produce on `main`, did the same here, and compared:
  - the core tools and each powder stage's tools;
  - the magnetic step's tools, and the tools offered on the powder page at
    every stage, at the finish and with the magnetic step;
  - the tools each of the 14 topics of the user's words brings in;
  - the PDF and single-crystal pages' tools, arm C's, and those with no page
    open;
  - the cards of all 60 tools, the keep list, and the magnetic step's tools.

  All are identical. So are the lists no module exported, each read back
  from `main`'s source and compared with its facts: `STEP_KIND` (17 tools),
  `NEEDS_STRUCTURE` (11), `SAMPLERS`, `STILL_NEUTRAL`, `READS`, `CHANGES`
  and the evidence gate's three lists. The 14 phrase patterns are character
  for character the same. Only the four corrected effects differ, as
  intended.
- **Nothing the model reads changed**: the snapshot (`src/agent/__snapshots__/`)
  passes unchanged, with and without the skills.
- **In the browser**, the three committed demo replays (the Mn₃Ga TOF
  refinement, the GaTa₄Se₈ boxcar scan and report, the corundum crystal) on
  this branch's dev server gave the same drawer text as on `main` (#67's
  check), apart from timings, with no page error.
- **The tests of the code that reads the facts pass unchanged**: the scoping,
  the cards, the chat and its loop guard, the context window, the executor,
  Stop, the evidence gate, the live tools' output contracts, the magnetic
  step, the missing structure and the drawer.

## What changes for users

Nothing. The same tools run the same way, with the same cards, offers and
answers.

## What it means for the validation

Nothing changes in what the model reads or how a call runs. A tool added
later carries its facts or does not compile (its cards are required).

## Not done

- One plan per tool per page (the review's #4, second half; Q1 b and Q2),
  PDF first.
- #64's generated tool table reads each tool's effect. When #64 and this
  branch meet, the table must read the two new effects as "runs at once",
  which is what they do.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2338
tests, 265 skipped (live runs and data-dependent suites).

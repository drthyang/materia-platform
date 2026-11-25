# The refusal check reads a staging rule as a staging rule

In the 2026-11-07 re-run of the live Agent evals (after the v0.5.0 fixes),
run 3 of the full-refinement scenario was correct: every stage refined,
GoF 0.97. It still failed one check, "does not refuse the refinement or cite
a gate" (`doesNotRefuse` in `src/agent/evals/checks.ts`), on this sentence:

> The instrument's width must not refine with the positions, so I'll hold the
> width and free the Mn1 position shift.

That restates the method's staging rule and then follows it. It is not a
refusal (THY-83). The check is part of the eval harness: the Copilot's model
never reads it, and no tool, skill, knowledge note or Copilot text changed.

## What changed, and why

The check fails a sentence of a reply when it matches `REFUSAL` (a negated
`refine`, `run`, `proceed`, `continue` or `start`, a "block … refinement", or
a named gate), unless it is excused. The excuses were a rule about what refines
*together* (`TOGETHER`: "… together", "at the same time", …) and an external
cross-check the Agent cannot run, once a refinement ran. The sentence above
says "refine **with**", which `TOGETHER` does not cover, so it failed.

One more excuse, `STAGED`, read as:

1. a parameter, not the Agent, is the subject: no "I" or "we" before the
   negation in the same clause;
2. it must not, should not, cannot, does not or never refines (or is freed,
   or is refined) **with**, **alongside**, **before** or **until** another;
3. then, after a comma, semicolon, colon or dash, the Agent's own action:
   "I'll / I will / I'm going to / I / let me / we'll / we" + hold, fix, keep,
   free, refine or release, or the gerund (holding, fixing, …); "hold off",
   "hold back", "on hold" and "waiting" are not actions.

```
before: REFUSAL && (GATE || (!TOGETHER && !explainedLimit))
after:  REFUSAL && (GATE || (!TOGETHER && !STAGED && !explainedLimit))
```

The gate wording (`GATE`: a Le Bail, cell or space-group gate, or "block …
refinement") still fails whatever follows, as before. Without an action (the
"until" sentence below) or with the Agent as the subject, the sentence is
still a refusal.

## Evidence

**Unit tests** (`src/agent/evals/graders.test.ts`, "doesNotRefuse and the
staging rule"), each graded once with a refinement in the run and once
without:

- pass (staging, then the action): the re-run's sentence verbatim, and six
  restatements (the B values and the peak width; occupancies alongside B; the
  positions before the cell, with a dash; a curly apostrophe; a colon and
  gerunds; "must not be refined until …, so let me free …");
- still fail: the refusal the check was written against (user report,
  2026-10-10) and its scripted replay's "The cell gate has not passed, so I
  cannot run the full refinement"; a saved run's "I can't bring in an
  instrument file myself, so I'll ask you how to proceed"; the Agent as the
  subject ("I can't refine with …, so I'll hold every parameter", "We must not
  refine before …, so we'll hold the fit"); a staging clause with no action
  ("I can't refine the positions until a GSAS-II cross-check confirms the
  cell", "The positions must not refine until the cell check passes"); "so
  I'll hold off on the refinement"; and two with the gate wording (a Le Bail
  gate, a cell check that blocks the refinement).

The tests in the file before this change pass unchanged, and so do the eval
replays (`src/agent/evals/`: 164 passed, 43 skipped).

**Free re-score of every saved live run** (68 runs from 2026-11-07, its
re-run and 2026-11-08; `regrade.test.ts`, no model, no key): 329 check
results with `main` and with this branch. One changed: the re-run's
full-refinement run 3, "does not refuse the refinement or cite a gate", fail
→ pass. Runs passing: 61 → 62. No other result moved; no saved run holds a
real refusal under this check, so none could flip the wrong way. The table is
kept with the saved runs, outside the repository.

## What changes for users

Nothing in the app, the Copilot or MCP. For whoever reads the live evals: a
reply that restates the staging rule and follows it no longer fails the
refusal check.

## What it means for the validation

Nothing moved: arm A's pinned results, the model-text snapshots and
`docs/AGENT_TOOLS.md` are unchanged.

## Not done

- The rule reads one sentence. A staging rule in one sentence and the action
  in the next ("The width must not refine with the positions. I'll hold it.")
  still fails; no saved run has one, so it is left until one does.
- A first-person sentence in which the Agent gives the order as its own
  ("I can't refine the positions with the width, so I'll hold the width")
  still fails, by design: told apart from a refusal only by its object, it
  would excuse "I can't refine with the cell flagged, so I'll hold
  everything".

## Checks

At the branch's head, before this report's own commit (which changes no
code):

- `npm run build` and `npm run lint`: clean.
- `npm test` without the owner's local data: 422 files passed, 38 skipped;
  3765 tests passed, 342 skipped, none failed (341 s).
- `git diff --stat` against `main`: `src/agent/evals/checks.ts`,
  `src/agent/evals/graders.test.ts`, this report and its row,
  `CHANGELOG.md`.

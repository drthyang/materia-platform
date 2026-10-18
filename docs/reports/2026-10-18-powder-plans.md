# The powder page's changes as plans

Branch `claude/powder-plans`, stacked on `claude/sc-plans` ([#71](https://github.com/drthyang/web-refinement/pull/71)), 2026-10-18.
Plan: [AGENT_PLAN.md](../AGENT_PLAN.md), 3.1. The last page of the
architecture review's #4: the shape #70 set on the PDF page and #71 followed
on the single-crystal page, applied to the powder page's 14 change tools and
its magnetic step's 7, which the user's Q5 gives the same definitions now.

The powder page had six switches: a no-op, the card's line and the change for
its own tools (`powderNoOp`, `describePowderChange`, `changePowder`) and the
same three for the magnetic step (`magneticNoOp`, `describeMagneticChange`,
`changeMagnetic`), about 290 lines in all. The page's plan picked one set or
the other by the tool's name, through `switchedPlan`. Several checks ran only
in the change, after the user had approved the card.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `POWDER_PLANS` (`powderTools.ts`): one plan per change tool of the page, each on its tool's input as the schema parses it. The compiler holds the table to the page's change tools, and a test does too | Three switches for the page's own tools, each reading the input again, untyped |
| `MAGNETIC_PLANS` (`magneticTools.ts`): the step's seven changes as plans, spread into the page's table. A plan reads the step as it stands to write the card; the change is made through the handle the step publishes when it is made (it publishes a fresh one on every render), with the step's tab open, as before. `MagneticChangeTool`, derived from the definitions' `magneticStep`, holds the table to the step's tools | Three more switches, and the page's plan choosing between the two sets by name |
| `set_free`, `refine`, `reset_parameters` and `go_to_step` are the shared plans (pages/plans.ts). The page's `refine` gives its own card line and its own reason it cannot refine: a view-only pattern | The page's own copies of the four |
| A change that cannot run is refused before its card: a window outside the pattern, a refinement with nothing free or of a view-only pattern, and a change the page has no handler for (corrections, antisites, a known phase, ties, the instrument's constants). The other checks were already made before the card, in the no-op or the card's line | The user approved a card for a change that then failed |
| A tool that needs a structure is still refused on the placeholder before it is planned: the page's adapter reads the tool's `needsStructure`, as the no-op did | — |
| `switchedPlan` is deleted: no page uses it | The shim #70 kept the other pages on until their turn |

A handler a page lacks is checked after the no-op, so a call that would do
nothing still says so, as before. The app's powder page has all five
handlers; the port declares them optional, and the check guards a port built
without one.

## Evidence

- **The plans say what the switches said.** For 70 calls on nine page
  states (630 in all), the plan gave the same card line, the same reason for
  doing nothing, or the same error as the old no-op and card line. The
  states: the Mn₃Ga demo; the demo with a fluorite impurity's lines; the
  demo as X-ray data with Kα₂, and monochromatic; Cr₂WO₆ (trirutile, for the
  antisites); the placeholder with no structure; and the magnetic Mn₃Ga page
  at the step's start, with k set, and with a group chosen. The calls cover
  all 21 tools, both ways where a tool has two, windows in each unit, and
  the inputs that refuse. 621 agree. The other 9 are the window outside the
  pattern, one per state, which the plan now refuses before the card.
- **Before the card** (`agent/pages/plans.test.ts`). On the base branch, a
  window outside the pattern and a refinement with every parameter fixed
  each showed a card and failed once approved. Now both are refused before
  their card with the same message; only the `set_free` between them asks.
  A refinement of a view-only pattern (a TOF axis without a TOF profile)
  reached, on the base branch's headless page, the correlation check, which
  refused it as "not determined by the data". Now the plan refuses it first,
  with the page's reason: load the instrument file.
- **In the browser**, the three committed demo replays, the Mn₃Ga TOF
  refinement among them, gave the same drawer text as before, with no page
  error.
- **Nothing else changed.** The text the model reads is the snapshot's. The
  powder tool tests, the magnetic step's, the antisite and missing-structure
  tests, the agent scenarios and replays, and the executor pass unchanged.

## What changes for users

On the powder page, as on the PDF and single-crystal pages, a change the
Agent proposes that cannot run is refused before you are asked to approve
it. A refinement of a pattern that cannot be refined says why.

## What it means for the validation

The model reads the same tools and, on these failures, the same errors,
without an approval in between; a run in ask mode sees one card fewer for
each. On a view-only pattern the refusal now names the cause.

## Not done

Nothing of #4. Next in the user's order: #2, the magnetic step as a module
of its own (AGENT_PLAN 2.4), which takes `MAGNETIC_PLANS` with it.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head.

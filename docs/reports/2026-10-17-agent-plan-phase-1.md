# Agent plan, phase 1: the validation measures the Agent

Pull request [#61](https://github.com/drthyang/web-refinement/pull/61),
branch `claude/agent-core`, 2026-10-17. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), phase 1.

Before arms B and C of the validation run, the harness they run on had to
behave as the app does, and arm C had to lack exactly the skills. This change
fixes what a code survey found would have made the numbers measure the
harness instead of the Agent.

## What changed, and why

| Item | Change | What it answers |
| --- | --- | --- |
| 1.1 | The eval harness's runner passes `fill` | The check that sends back a grade contradicting the engine's `{{verdict}}` ran in the app but never in an eval or a validation run |
| 1.2 | `app/powderPage.ts`: the powder page's curves, live agreement, controls, Refine, Prefit, posterior and probe, called by the workbench and by the Agent's headless page through the same compute client; the headless page goes back to a History step | The headless copy had drifted: its posterior ignored the window, the extra phases and the magnetic model; restraints covered one phase; fits dropped the profile's Lorentzian part and background type; three controls only logged; Prefit skipped TOF and magnetic models; `go_to_step` did nothing |
| 1.3 | Arm C is structural: one list of prompt lines with an arm-C form, arm-C tool descriptions, and no method in `get_state`, refusals, nudges or the report; local models offered every page tool | Arm C still met the method through `get_state`'s checklist, refusals naming the skill, tool descriptions, stage-ordered tool lists, and a regex edit of the prompt that would fail silently |
| 1.4 | `runPolicy()` states the turn cap, tool scope, pruning, stall stop, temperature and reply cap; every run records it | Models ran under different rules (turn cap 40 or 80, stall stop on local models only, no temperature set), unrecorded |
| 1.5 | Stages done derived from the History; a new conversation clears refs; `keep_reflections` saved in the record | `stagesDone` only grew, so undo left the tool scope and the symmetry gate wrong; stale refs read across conversations; kept measurements were neither saved nor tied to the analysis |
| 1.6 | The holdout scan reads every shipped source file and synonyms; the taught text no longer names NaCl | The scan missed the MCP descriptions, the diagnostics and the app; a test case's impurity was named in tool descriptions and a skill |

## Evidence

- **Each fix has a test that fails without it.** 1.1: a scripted replay with a
  contradicting grade gets the nudge only with `fill`. 1.3: a test reads every
  request of a scripted arm-C session (system, tools, messages) for a skill
  name, `read_skill`, a stage checklist or the method's order; with the old
  `get_state` it names `my-rietveld-workflow`. 1.5: `stagesOnPath` against a
  recorded History (undo, a partial reset, a full reset, a new load); refs
  gone after a new conversation; the kept list round-trips through a project
  file. 1.2: every fit, Prefit and posterior request carries the window, every
  phase, every phase's restraints and the whole profile; the controls apply;
  `go_to_step` restores the step.
- **The arm-B text is unchanged.** The prompt, the autonomy notes and all tool
  descriptions were compared byte for byte before and after 1.3.
- **The app is unchanged where it should be.** The built app, driven in a
  browser on the Mn₃Ga TOF demo, gives the same results as `main` after
  Prefit, Refine and Escape (wR 4.01 %, converged), with no console errors.
- **Arm A's pinned results did not move** (`validation.test.ts`).

## What changes for users

- In the app: nothing visible, apart from the kept measurements now being
  saved with a project, and the stages checklist following undo.
- For the Agent: no change in arm B's text. Each run's record and transcript
  now state the run policy.
- The validation can fix a local model's temperature with
  `MATERIA_VALIDATION_TEMPERATURE`.

## What it means for the validation

- Arm B is still "the Agent as it ships"; the policy defaults stay per
  transport. B and C on one model share them; a comparison across models also
  compares the settings VALIDATION.md lists.
- Arm C now lacks the skills and nothing else.
- Evals and validation runs now see the app's own fits on the powder page.

## Not done

- The PDF and single-crystal headless pages are still copies (PDF refines stop
  at 4 iterations; neither has Prefit). No validation case uses them.
- 1.7, the findings schema, is not in the core and waits.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2290
tests, 265 skipped (live runs and data-dependent suites). CI passed on the
pull request.

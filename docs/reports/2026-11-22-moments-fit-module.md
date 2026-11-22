# The moments fit's rule in one core module

The rule of the powder moments fit (the moments refine with the nuclear model
held, in rounds with the scale and the background, ending on the moments; see
[the rounds report](./2026-11-19-moments-alternation.md)) was spread over
three places: the loop in `core/magnetic/momentAlternation.ts`, the choice of
rows and the request in `app/powderPage.ts`, and the k = 0 switch in
`app/magneticStep.ts`. A test helper carried its own copy of the loop with a
different cap and stop rule. The architecture review of 2026-11-21 (candidate
1) asked for one home, so that the page, the Copilot, the tests and, later,
MCP run the same fit.

This change is that home, `src/core/magnetic/momentsFit.ts`, and the callers
moved onto it. It is a restructuring only: no number changes, and nothing the
Copilot's model reads changes (no tool description, skill, prompt, gate
message or snapshot file). MCP is not touched; that is the next part.

## What changed, and why

- **The module** (`core/magnetic/momentsFit.ts`). `runMomentsFit(problem,
  hooks)` is the moments fit. It decides what was decided in three files
  before: which rows a moments step refines, which rows the step between
  refines, the order of the steps, the stop rule and its two other exits, the
  cap, the iterations, and the esds that include the scale and the background.
- **The page calls it** (`app/powderPage.ts`, `powderMomentFit`). The page
  still builds the problem from the session (structure, pattern, bindings,
  phases, profile, window, the model's rows in place of an earlier model's)
  and the way to run one refinement (the compute client, or this thread). It
  no longer names the rows of either step or any option of a refinement.
  `momentRoundValues` is gone; the page reads the rows it must write back from
  the module (`reRefinedRows`).
- **The step no longer passes the k = 0 choice** (`app/magneticStep.ts`,
  `refineMoments`). The module reads k from the model. The switch
  (`K0_SCALE_WITH_MOMENTS`, false) is unchanged.
- **The Copilot** runs `refine_moments` through the page's step, as before:
  no file under `src/agent` changed.
- **The Refine button with only magnetic rows free** (its own commit). Such a
  refinement is a moments step the user set up by hand, and its esds follow
  the same rule. `momentsOnlyEsdOptions(rows)` in the module replaces the
  page's `momentEsdOptions`.
- **The test helper** (`testSupport/momentSequenceCase.ts`, its own commit).
  `alternatingFit` had its own loop: cap 8, the shift measured in the previous
  step's esd, no esd with the scale and the background, no exit for an exact
  fit or a negligible shift. It now calls `runMomentsFit`. Only the env-gated
  ranking comparison in `momentSequenceSeeds.test.ts` uses it (below).
- **`examples/localMagneticDemoSolve.test.ts`** calls `runMomentsFit` in place
  of the loop, and reads the re-refined rows from the outcome.
- **The loop stays as an internal file** (`momentAlternation.ts`, its code
  unchanged). Among application files only `momentsFit.ts` imports it; a test
  fails if another does. Two tests still call it directly, because they ask
  what the fit does not take from a caller: a cap of 2 rounds, and the other
  k = 0 choice (the scale free with the moments).

## The interface

```ts
type MomentsFitRunner = (rows, options) => RefinementResult | Promise<RefinementResult>;

runMomentsFit(
  problem: { rows, magnetic, fit: MomentsFitRunner },
  hooks?: { cancelled?, onRound? },
): Promise<MomentsFitOutcome | { cancelled: true }>;

reRefinedRows(rows): Record<string, number>;
momentsOnlyEsdOptions(rows): { esdWith: string[] } | {};
```

A caller passes:

- `rows`: every row of the fit, nuclear and magnetic, in the order the engine
  is to see them. Values, bounds and ties are read. `fixed` is read on a
  magnetic row only (a held one stays held: the phase gauge of a two-arm k);
  on every other row it is ignored.
- `magnetic`: the model, read for its k only.
- `fit`: one refinement of the rows as flagged, with exactly the options it is
  given. It is passed because each runtime runs a refinement its own way (the
  page on its worker pool or in its thread, a test in its thread) and
  `src/core` imports nothing from `src/workers`.
- `cancelled` (asked before each refinement) and `onRound`.

It returns every row's value at the end, the magnetic rows' esds, the rows
those esds include (or the engine's reason when it could not include them),
the re-refined scale and background values for the caller to write back, the
rounds run, whether the fit settled, the last shift in esds, wR of the last
moments step, and that step's engine result. Stopped: `{ cancelled: true }`,
nothing kept.

The nuclear-only agreement the step compares with is not part of the fit: the
page reads it off its own nuclear curve, and the step keeps it while the page
holds the rows handed back. It stays there.

## What the module hides

A caller cannot pass any of these.

| | |
| --- | --- |
| A moments step's rows | The free, untied magnetic rows: the moment amplitudes, and k's components where the caller's rows carry them free (the page's rows never do; the local solve test's can) |
| Held in a moments step | Every other row, whatever its `fixed` flag |
| The step between | Every untied scale row (each phase's own) and every untied background row, held on the page or not. A tied row follows its tie. Never the peak shape, the cell or an atom |
| k = 0 | The scale is held in the moments step (`K0_SCALE_WITH_MOMENTS = false`) |
| The order | A moments step; then rounds of (scale and background) and (moments); always ends on the moments. With nothing to re-refine: one moments step, 0 rounds |
| The stop rule | No moment moved by 0.1 of its esd in the last round; or the fit is exact (wR < 10⁻⁶); or the shift is negligible (10⁻⁴ of the row, or of 1) |
| The cap | 10 rounds; at the cap the last moments step is kept and the fit says it did not settle |
| Iterations | 20 in every step |
| The esds | `esdWith` the re-refined rows, on the moments steps only; where the engine cannot form that covariance, the moments' own esds and the reason |

## Where things live now

| | Before | Now |
| --- | --- | --- |
| The rows of the step between | `powderPage.ts`, `momentRoundValues` | `momentsFit.ts`, `reRefinedRows` |
| The rows of a moments step | `powderPage.ts` (what `momentFitRequest` left free) | `momentsFit.ts` |
| k = 0 for Refine moments | `magneticStep.ts`, `refineMoments` | `momentsFit.ts` |
| The rounds, stop rule, cap, iterations, `esdWith` | `momentAlternation.ts`, called from the page | the same loop, called from `momentsFit.ts` only |
| The esd rule of a moments-only Refine | `powderPage.ts`, `momentEsdOptions` | `momentsFit.ts`, `momentsOnlyEsdOptions` |
| The problem and the runner; writing the rows back; the History step; the baseline; the readout | the page and the step | unchanged |
| The ranking's single fit and its rows (`momentFitRequest`; at k = 0 the scale free, chosen in the step for all three pages) | the page and the step | unchanged: not part of this step |

## Evidence

**A dump before and after, to the last bit.** One temporary test (not in the
repository) ran on `main` (5637060) and on the branch. It writes every number
as the 16 hex digits of its float64 and, for every refinement the fit ran, in
order, the rows it was given (id, kind, value, `fixed`, tie, start value,
bounds), the options, and the result (values, esds, agreement, status,
iterations, χ², diagnostics). The two files are compared byte for byte.

Cases, all on the synthetic patterns of the suite:

- Refine moments through the step and the compute client: independent MnWO₄
  model A (k = (½ 0 0)), seeds 0 to 3 and noise-free; model B, seed 0; the
  k = 0 ferromagnet, seed 0 and noise-free; the k = 0 antiferromagnet, seed 0.
  Per case: the returned wR, the amplitudes, the rounds (count, settled, last
  shift, esds, what they include, the rows handed back), every session row
  after the hand-back, the baseline before and after, the readout line and
  details, and the call log.
- The same in this thread (no client), and a second Refine moments.
- The ranking's single fits (all 11 groups, 2 restarts) for model A and the
  k = 0 ferromagnet, then Refine moments from the ranked start.
- The Refine button after Continue, with the moments alone free and with the
  scale free too: the options the fit was given and its result.
- Synthetic Mn₃Ga with a two-arm k (phase gauge held): Refine moments through
  the client; then the Refine button with the moments and a k component free.
- The Copilot's tools on synthetic Mn₃Ga: the text of `rank_magnetic_groups`,
  `choose_magnetic_group`, `refine_moments`, `magnetic_state` and
  `continue_magnetic_refinement`.
- The cap (the loop with at most 2 rounds), Cancel in the second round and
  the Refine moments after it, and the other k = 0 choice through the loop.

Result: the two files are identical (18 cases, 2.2 MB each), after the first
commit, after the second and at the head.

One case changed its route, not its numbers: the other k = 0 choice was asked
of the page's fit (`freeScale` with the rounds), which the page no longer
takes; the test now asks the loop. On `main` the two routes give the same
bits (moment, rounds, last shift, esd, wR, the rows handed back).

**The local solve test** (`localMagneticDemoSolve`, the owner's local data,
dry mode: nothing written). It runs in 22 s. With one temporary line printing
step 4 at full precision, `main` and the branch give the same bits: every
row's value, the esds, the rounds, the last shift, wR, and each ranked group's
wR and χ²; and the same solution record.

**The env-gated ranking comparison** (`MOMENT_SEQUENCE_RANK=12`, independent
MnWO₄, models A and B, all 11 groups ranked under a single fit and under
rounds, 4 restarts). It is the one place where numbers were expected to move,
because the helper's own loop is replaced by the module's. Run once on `main`
(old) and once on the branch (new), 12 seeds each:

| | Model A, old | Model A, new | Model B, old | Model B, new |
| --- | --- | --- | --- | --- |
| Same ★ under a single fit and under rounds | 12 of 12 | 12 of 12 | 11 of 12 | 11 of 12 |
| Same within-noise set | 10 of 12 | 11 of 12 | 8 of 12 | 8 of 12 |
| Same powder twins | 12 of 12 | 12 of 12 | 12 of 12 | 12 of 12 |
| Rounds per fit | 1 to 8 | 1 to 10 | 1 to 5 | 1 to 6 |
| Fits (of 660) whose round count changed | | 129 | | 65 |
| ★ group: largest change of its moment | | 0.0002 µB | | 0 |
| Any group: largest change of wR | | 0.036 % | | 0.004 % |
| Any group: largest change of the first site's moment | | 0.08 µB | | 0.43 µB |

The single-fit side is identical bit for bit, as it must be. The ★ and the
twins are the same in every seed. The one set that changed (model A, seed 7)
comes from one fit of one group that stopped at the old cap of 8 rounds at
wR 5.112 % and now runs to 10 and reaches 5.076 %, which puts that group back
inside the noise of the best, as under the single fit. The large moment
changes are all in the lowest group (no symmetry left), at a wR that changes
by 10⁻⁵ or less: a partition of the moment the data do not determine. The
report of 2026-11-19 quotes this comparison ("the ★ is the same in 23 of 24
rankings"); that still holds, and the dated report is not edited.

**The module's own tests** (`core/magnetic/momentsFit.test.ts`): with a runner
that records what it is asked, the rows of each step on a two-phase page
whose user left the scale free, the second phase's scale held, a background
term tied and the width, cell and an atom free; the options of each
refinement; k = 0; a free k component; the cap; nothing to re-refine; Cancel;
the Refine button's rule; and the guard on the loop file.

## What changes for users

Nothing. The page's Refine moments, the Copilot's `refine_moments`, the
ranking and the Refine button give the same numbers and the same words.

## What it means for the validation

Nothing moved: arm A's pinned results are unchanged, and the model-text
snapshots (`model-text.arm-b.md`, `model-text.arm-c.md`) and
`docs/AGENT_TOOLS.md` are not changed by this branch.

## Not done

- **MCP.** `refine_moments` over MCP running this module, and
  `refine_magnetic_powder` refusing moments and nuclear rows together without
  an explicit opt-in, are the next part, with the tool text, the skill note,
  the glossary entry and the decision record.
- **The ranking's single fit** keeps its rows in the page
  (`momentFitRequest`) and its k = 0 choice in the step: whether it moves into
  the module is the owner's to decide.
- **k components in the rounds.** The module refines a free k row with the
  moments when a caller's rows carry one, as the loop did for the local solve
  test. The page never passes one. Whether an MCP caller may is open.
- **The test's independent reference** (`sequence()` in
  `momentSequenceCase.ts`: a fixed number of rounds, a between set the test
  chooses, the joint fit) is unchanged and still its own loop, by intent.
- Single-crystal and magnetic-PDF moment fits, and the two restart schemes,
  are unchanged.

## Checks

At the branch's head, before this report's own commit (which changes no code):

- `npm run build` and `npm run lint`: clean.
- `npm test` with the owner's local data: 3760 passed, 306 skipped, 1 failed.
  On `main`, the same run: 3748 passed, 306 skipped, 1 failed. Test by test
  the two lists are the same; the 12 more are the module's own tests. The one
  failure is `localHexMagneticGolden`, which fails on `main` since #178 with
  the same message and is not touched here.
- The before-and-after dump: identical (above).
- `git diff --stat` against `main`: 12 source and test files under `src/app`,
  `src/core/magnetic`, `src/examples` and `src/testSupport`, and this report
  with its index row. No file under `src/agent`, `src/mcp` or
  `.claude/skills`; no snapshot; not `docs/AGENT_TOOLS.md`.

# The moments fit over MCP, and no joint fit unless asked

The second part of the architecture review's candidate 1
([the first part](./2026-11-22-moments-fit-module.md) put the rule of the
powder moments fit into one module, `core/magnetic/momentsFit.ts`). Until now
only the powder page and the Copilot ran that module. An MCP caller had
`refine_magnetic_powder`, titled "Refine nuclear + magnetic (staged)", which
refined whatever rows the caller freed, moments and nuclear rows together
included, had no rounds, and could not return the esd that includes the scale
and the background. The magnetic skill told an MCP caller to alternate the
tool by hand.

This change gives MCP the moments fit itself and makes the rule hold there:
the moments refine with the nuclear model held. It changes the MCP surface
only. No number on the page or in the Copilot moves: the dump of the first
part (every refinement's inputs and results, as float64 bits, and the
Copilot's replies) is identical on `main` and on this branch's code. At the
head it differs in one line, the length of the `magnetic-analysis` skill text
the Copilot reads, which the text commit shortened by 8 characters.

The decisions are the owner's (2026-11-21 and 2026-11-22) and are recorded in
[ADR 0006](../adr/0006-moments-refine-with-the-nuclear-model-held.md).

## What changed, and why

- **`refine_moments`, a new MCP tool** (`src/mcp/tools.ts`,
  `src/mcp/registry.ts`). It runs `runMomentsFit` with the Node-side solver
  `refine_magnetic_powder` uses (worker threads, or this thread). Its
  arguments are the model and the data: `structure`, `magnetic`, `pattern`,
  `parameters`, `bindings`, `profile`, `extraPhases`, `fitRange`. It takes no
  free set (`free` is not offered on it), no stage, no restarts and no
  iteration limit: the module decides. Of the caller's `fixed` flags only
  those on moment rows count; a moment row passed fixed stays held.
  - It returns `moments` and their `esd`, `esdIncludes` (the scale and
    background rows whose uncertainty the esds carry) and `esdAloneReason`
    (the engine's reason where it could not include them, else null),
    `rounds`, `settled`, `lastShiftOverEsd`, `wR`, `reRefined` (the scale and
    background after the fit), a one-line `reading`, and, in
    `refine_magnetic_powder`'s shape, `result`, `parameters` (every row at its
    refined value, flags as passed), `magnetic`, `components`,
    `observationCount` and `parallel`.
  - **k is held.** A free k row among the caller's rows is held before the
    module sees them, the fit runs, and `kHeld` names the rows and says why.
    The module is unchanged: where a caller's rows carry a free k row it still
    refines it with the moments, which only the local solve test's rows do.
  - **No moment search.** The fit starts from the values in the rows. The
    description says so and points to the search that exists:
    `refine_magnetic_powder` with `restarts` and only the moment rows free.
  - With no moment row free it does not run, and says what to pass.
- **`refine_magnetic_powder` refines one side at a time.** A moment-side row
  is a moment amplitude or a free k component; every other row is nuclear, the
  scale and the background included.
  - Nuclear rows only, the moments held: as before.
  - Moment-side rows only: as before (with `restarts`, the moment search), and
    the result's `note` says it is a single moments step, not the moments fit,
    and points to `refine_moments`.
  - Both: refused, with the rule and what to call instead.
  - Both with `joint: true`: the fit runs as before. The result carries a
    label: `note` on the tool's output and `methodNote` on the refinement
    result itself, so that what reads the result later repeats it.
- **The label travels** (`core/refinement/types.ts`, `RefinementResult.methodNote`;
  `core/diagnostics/assessment.ts`; `core/export/cif.ts`, `bundle.ts`).
  `assess_refinement` returns it as `methodNote`. `export_bundle` writes it
  into the CIF as `_refine_special_details` and into the README of both
  targets. Nothing sets it but the MCP joint fit, so no other result, CIF or
  README changes.
- **Worked Example 3 follows the method** (`docs/AGENT_EXAMPLES.md`,
  `src/mcp/examples.test.ts`, `scripts/example3-demo.ts`). Its steps 10 to 17
  freed the scale, the background and the moments in one call per group, and
  step 18 freed everything. Now each maximal group is searched with only the
  moment rows free (12 restarts) and then fitted with `refine_moments`; there
  is no everything-free step. See the numbers below.
- **The text an MCP caller reads** (its own commit): the tool's title and
  description, `build_magnetic_model`'s last sentences, the magnetic skill's
  note on MCP and its tool table, the Rietveld skill's MCP map,
  `docs/LIMITATIONS.md`, and the generated `docs/AGENT_TOOLS.md`.
- **Records**: the glossary entry "moments fit", ADR 0006, the changelog.

## Evidence

**The MCP route against the page, on a known truth**
(`src/mcp/refineMoments.test.ts`; synthetic MnWO₄ from
`testSupport/independentMnwo4.ts`, which shares no code with `src/core`; true
moment 4.2 µB). With the rows in the page's order, `refine_moments` and the
page's Refine moments agree to the last bit; the test's bound is 1 part in
10⁹, and it prints the difference:

| Case | Page | MCP | Relative difference (moments; esds; scale and background; wR) |
| --- | --- | --- | --- |
| Model A, k = (½ 0 0) | 4.202629(0.010345) µB, 4 rounds, wR 5.0132 % | the same | 0; 0; 0; 0 |
| Model B, two moment rows | 3.004009(0.015033), 1.985931(0.019659), 4 rounds, wR 5.0774 % | the same | 0; 0; 0; 0 |
| A ferromagnet at k = 0 | 4.224328(0.040831), 6 rounds, wR 6.3324 % | the same | 0; 0; 0; 0 |

Model A against the truth: 4.2026(103) µB, 0.25 esd from 4.2 and 0.023 esd
from the joint fit of the test's own harness.

With the rows in another order (the moment rows first, the nuclear rows and
the bindings reversed): 4.202629(0.010345) µB in 4 rounds; from the page, the
moment differs by 8 × 10⁻¹⁶ and the esd by 3 × 10⁻¹² (relative); 0.25 esd
from the truth and 0.023 esd from the joint fit. The test's bounds for this
case are the page's own: 3 esd and 0.05 esd.

**k held.** A helix at k = (0 0 0.2317) with its three k rows passed free:
they are held, `kHeld` names them, k does not move in the rows or the model,
their flags come back as passed, and the moments equal those of the same fit
without k rows (relative difference 0).

**The rule on `refine_magnetic_powder`** (same test file): the refusal's
whole message; `joint: true` running the joint fit, whose moment equals the
harness's joint fit, with its label on the output, on the result, in the
assessment, in the CIF and in both READMEs, and none of these on a result
without the label; the single-moments-step note with and without restarts,
and that step reading 4.06 µB for 4.2; nuclear rows alone as before.

**The module decides the rows**: with every nuclear row marked free the fit is
the same, bit for bit; a moment row passed fixed keeps its value and has no
esd; the tool's transport schema has no `free`.

**Worked Example 3, before and after** (simulated Mn₃Ga 30 K, k = 0; recorded
with `scripts/example3-demo.ts` before and after the change):

| | Before | After |
| --- | --- | --- |
| Calls | 18 | 21 |
| P2₁/m | 9.30 %, GoF 2.16 | search 10.21 %; moments fit 9.30 %, GoF 2.16 |
| P2₁'/m | 12.10 %, GoF 2.81 | search 12.12 %; moments fit 12.10 %, GoF 2.81 |
| P2₁/m' | 11.79 %, GoF 2.74 | search 11.85 %; moments fit 11.79 %, GoF 2.74 |
| P2₁'/m' | 4.61 %, GoF 1.07 | search 8.05 %; moments fit 4.61 %, GoF 1.07 (10 rounds) |
| P2₁'/m' without restarts | 4.86 %, GoF 1.13, Mn1 (−0.57, −0.02) µB | 4.86 %, GoF 1.13, Mn1 (−0.56, −0.02) µB, not settled |
| Last step | everything free: 4.35 %, GoF 1.01, positions within 0.0003 | none |
| Moments quoted | from the everything-free fit, ± 0.03, within 0.06 µB of the truth (0.044 measured) | from the moments fit, ± 0.03 to 0.04, within 0.07 µB (0.066 measured) |

The four groups' wR and GoF after the moments fit are the earlier call's to
the digits shown: a fit of the scale, the background and the moments together
and the rounds end on the same answer, which is what the rounds are for. The
search alone reads high (8.05 % for the true group) because the nuclear fit's
scale and background had taken up magnetic intensity. The test's bounds are
unchanged where the quantity still exists (the true group below 4.7 %, the
others above 9 %, the single run above 4.8 %, every moment component within
0.1 µB of the truth). Removed with the everything-free step: its GoF below
1.05 and its position shifts below 10⁻³. New: the true group's GoF below 1.1,
the search alone above 7 % and carrying the single-step note, the esds
including the scale and the four background terms, and that of the nuclear
rows only the scale and the background moved.

**The other tests that freed both** pass `joint: true` and keep their numbers:
`mcp/tools.test.ts` (two calls, the closed loop with the scale and the
background free beside the moments), `mcp/magneticProfile.test.ts` (two
calls), `mcp/refineK.test.ts` (the scale, the moments and k),
`mcp/excludedPlateau.test.ts` (the page's rows after Continue) and
`workers/strategy.test.ts` (the app's Prefit against MCP: its last fit is the
scale, the background and the moments together). The registry's contract test
for `refine_magnetic_powder` frees nuclear rows only and needed no change.

**The Copilot's tools** import six MCP handlers (`assess_refinement`,
`bond_geometry`, `check_cell_symmetry`, `interpret_structure`,
`rank_next_parameters`, `suggest_next_steps`); none is
`refine_magnetic_powder`, and none refines.

## What changes for users

- **MCP callers: a breaking change.** A call to `refine_magnetic_powder` that
  frees moments (or k) together with any nuclear row, the scale and the
  background included, is now an error that says what to call. The moments fit
  is `refine_moments`. A joint fit needs `joint: true` and comes back labelled.
- Results gain fields: `note` on `refine_magnetic_powder` (single moments
  step, joint fit), `methodNote` on a joint fit's result and on its
  assessment, a line in its CIF and README.
- The page and the Copilot: nothing.

## What it means for the validation

- Arm A's pinned results did not move. The model-text snapshots
  (`model-text.arm-b.md`, 92,581 bytes; `model-text.arm-c.md`, 85,657 bytes)
  are unchanged: no in-app tool's text changed.
- The Copilot reads the skills: `magnetic-analysis/notes.md` grew by 96 bytes
  and its `SKILL.md` shrank by 8 (one table row); `my-rietveld-workflow/mcp-tools.md`
  grew by 18. The changed lines are about MCP.
- An MCP client's tool list grew from 78,121 to 82,643 bytes of names, titles,
  descriptions and input schemas (41 to 42 tools): `refine_moments` 3,478,
  `refine_magnetic_powder` +878, `build_magnetic_model` +166.
- No live model run was made. Worth running again later, over MCP: Worked
  Example 3 by a model (the run recorded on 2026-10-05 used the calls that are
  now refused), and any MCP-driven magnetic scenario of the validation. In the
  app: `dev-example3-magnetic` and the `magnetic-30k` eval, as a check that
  the two skill lines changed nothing.

## Not done

- **The Example 3 animation** (`docs/media/agent-example3.gif`, `.mp4`) still
  shows the earlier sequence; the page says so. Re-recording needs Chrome and
  ffmpeg and a look at the animation's layout for 21 steps.
- **Example 3 was not re-run by a model.** Its magnetic steps are the method's
  sequence replayed through the server, and the page says so.
- **Free moment rows over MCP.** `build_magnetic_model` returns its moment
  rows fixed, and `refine_moments` takes no `free`. A caller gets free moment
  rows from a `refine_magnetic_powder` call with only the moment rows in
  `free` (the search the description points to), or passes rows flagged free.
  Whether `refine_moments` should free every moment row by itself, as the
  page does, or take a selection, is the owner's to decide.
- **The magnetic skill's Stage 4 row over MCP** still reads
  "`refine_magnetic_powder` (free: the moments)". It is still a valid call
  (one moments step, and the result says so); `refine_moments` would be the
  closer match. Left as it was: not untrue.
- **A moment search inside `refine_moments`**, the two restart schemes, the
  single-crystal and magnetic-PDF moment fits, and refining k
  (incommensurate structures) stay on the follow-up list.
- **A joint fit's label** travels with the `result`. A caller who passes on
  only the `parameters` of a joint fit (to another refinement, or to
  `export_bundle` without `result`) leaves it behind.

## Checks

At the branch's head, before this report's own commit (which changes no code):

- `npm run build` and `npm run lint`: clean.
- `npm test`: 3737 passed, 341 skipped, none failed.
- `npm test` with the owner's local data: 3775 passed, 306 skipped, 1 failed.
  Test by test the list is `main`'s plus 15 new tests (14 in
  `mcp/refineMoments.test.ts`, and the registry's contract test for
  `refine_moments`). The one failure is `localHexMagneticGolden`, which fails
  on `main` since #178 with the same message and is not touched here.
- The first part's dump, re-run: identical to `main`'s at the last code commit
  of this branch; at the head, the one line described above.
- The model-text snapshots: unchanged, nothing re-recorded.

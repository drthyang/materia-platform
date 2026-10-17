# Agent plan, core of phases 2–5: one analysis under both tool surfaces

Branch `claude/agent-core-2`, stacked on
[#61](https://github.com/drthyang/web-refinement/pull/61), 2026-10-17. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), items 2.1, 2.2, 2.5, 3.2, 4.1, 4.2, 5.1.

The MCP tools and the in-app Agent computed the same judgments differently,
the numbers they decide by were spread over a dozen modules, the loop read
tool results by matching text, two powder checks could not do their job, and
nothing checked the skills against the code. This change addresses each.

## What changed, and why

| Item | Change | What it answers |
| --- | --- | --- |
| 2.1 | One powder residual (`core/diagnostics/powderResidual.ts`) for both surfaces, with each point's σ and where it came from (`sigmaFrom`) | Only the app's residual listed a magnetic model's satellites and flagged a neutron pattern of magnetic ions (so on MCP the k = 0 hint never fired); only the MCP's left out the excluded plateau; both spread whole patterns into `Math.min` |
| 2.2 | One `find_unexplained_peaks` (`core/diagnostics/unexplainedPeaks.ts`): unexplained peaks, misfits, a structured `k0Magnetic` flag and one reading | The MCP tool returned raw peaks, unclassified and without σ, so an agent on MCP could call a misfit on a known line an extra peak |
| 2.5 | `core/diagnostics/thresholds.ts`: the judgment code's numbers with their sources, imported by the assessment, the Validation tab, the guard, the report, the posterior reading, the single-crystal tools and the magnetic ranking | The Validation tab warned about a correlation only above 0.98 while the guard refused at 0.95; the numbers the skills quote had no single home |
| 3.2 | `ToolOutcome.status` (ok, error, refused, declined, unchanged, stopped), `refusedBy` and `refined`; the live tools' output keys pinned | The chat loop and the eval harness found refusals and refinements by matching text; no test pinned what the live tools answer with |
| 4.1 | No 8 % floor in the residual-peak search where the file gives σ | One strong misfit hid a weak line beside it |
| 4.2 | Data per parameter on powder counts the reflections in the fitted range against the structural parameters | It counted profile points, so on a powder pattern it never fired |
| 5.1 | The skill lint (`src/agent/skillLint.test.ts`) in CI | Nothing checked that a skill names real tools on its pages, quotes the code's numbers, or covers the method's stages |

## Evidence

**4.1, measured before deciding.** The floor was dropped only after this
measurement, the plan's gate being "no more false peaks than today":

| Pattern | Unexplained peaks, with the floor | Without |
| --- | --- | --- |
| A correct model on counting noise, 200 seeds each at 2·10³, 2·10⁴, 2·10⁵ counts | 0 | 0 |
| Dev case: the Mn₃Ga misfit page | 0 | 0 |
| Dev case: fluorite lines | 4 | 5 (the fifth, d = 1.052 Å, is CaF₂ 511) |
| Dev case: one impurity line | 1 | 1 |
| Dev case: CsCl offered Im-3m | 7 | 7 |
| Dev case: Example 3 (k = 0 order) | 0 | 0 |
| Dev cases where the model's lines are misplaced (wrong λ, swapped units, strained cell) | 16, 20, 12 | 24, 31, 20 |

The extra peaks in the last row are unexplained by the model as it stands,
whose lines sit in the wrong place; the reading those cases give ("the model
is wrong") does not change. With counting σ (√y, the file giving none) the
floor stays, since √y means nothing on normalized data. Only dev cases were
used: the test set stays unseen.

**Tests that fail without each change.**

- 2.1: the residual leaves out the window's outside and a masked plateau, says
  where σ came from, lists an applied magnetic model's satellites, and flags
  magnetic ions under neutrons only without a model.
- 2.2: the MCP and in-app tools give the same unexplained peaks and misfits on
  the same fit; Example 3's MCP flow sets `k0Magnetic` and still finds k = 0
  from the misfits' d.
- 2.5: the tab, the assessment and the guard draw the correlation line at the
  same value.
- 3.2: each status (refused by the symmetry gate, by a firm rule; declined;
  unchanged; stopped); every no-input read tool's top-level keys on a refined
  powder, PDF and single-crystal page.
- 4.1: no peak on a correct model's counting noise, 40 seeds at three count
  levels; a weak line beside a strong misfit found with the file's σ, hidden
  with counting σ.
- 4.2: 30 reflections for 12 positions is a warning, 300 is none, whatever the
  point count.
- 5.1: the lint finds exactly its allow-list, and a fixed item must leave it.

**Arm A's pinned results did not move** (`validation.test.ts`).

## What changes for users

- **MCP clients: `find_unexplained_peaks` changed shape.** `peaks` is now
  `unexplained` and `misfits` (each peak with d, height, σ and the line it
  sits on or near), with `k0Magnetic` and a `reading`. Its `options` take
  `sigma` and `limit`. A k = 0 magnetic structure's peaks sit on the nuclear
  lines and come back as misfits with `k0Magnetic` set; Example 3, its test,
  its demo script and its write-up take the misfits' d then.
- **The Validation tab** warns about a correlation from 0.95, as the engine
  and the guard do (it warned only above 0.98), and lists weak unindexed peaks
  the floor used to hide when the data carry σ.
- **The k = 0 hint** names the k-search rather than the app's step, so it
  reads right on both surfaces.
- **`assess_refinement` on powder** can now warn that too few reflections
  support the structural parameters.
- **The Agent's `find_unexplained_peaks`** keeps its shape, adds `k0Magnetic`
  when it applies, lists the weak peaks the floor hid when the data carry σ,
  and says when its σ is counting statistics.

## What it means for the validation

- Arms B and C see the same peak classification, and the Validation tab arm A
  reads now finds weak lines it missed. Arm A's pinned results are unchanged
  on its cases.
- The skills can now be edited (5.2–5.5) with the lint holding their tools and
  numbers to the code.

## Not done

- The magnetic step's own peak search, k-search options and restarts move
  with the step (2.4).
- The single-crystal GooF line: 1.3 in the Validation tab against 1.5 in the
  assessment's band, both named now; the user decides.
- The skill drafts (5.2–5.5), which clear the lint's allow-list, go to the
  user before they merge; then the lost-centring candidates (4.11).

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2305
tests, 265 skipped (live runs and data-dependent suites).

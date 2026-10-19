# A trial step outside the model's domain is rejected, not the refinement

Pull request [#80](https://github.com/drthyang/web-refinement/pull/80),
branch `claude/charming-feynman-lyhjw0`, on `main` (75c3765), 2026-10-19.
A crash a user can reach from the Agent's own tools: the Mn₃Ga demo
(`mn3gaSession()`) with CaF₂ added as a second phase (`withPhase`), CaF₂'s cell
row `p1_cell_a` free, a fit window of 20–100° and Refine. The demo contains no
CaF₂, so its scale goes to 0 and its cell drifts until a trial step makes it
negative. `generateReflections` then sized its bit array from a negative index
box, `new Uint8Array` threw `RangeError: Invalid typed array length`, and the
whole refinement stopped.

## What changed, and why

| Change | What it answers |
| --- | --- |
| **The engine rejects a trial step whose `calculate` throws a `ModelDomainError`** (new, `core/refinement/types.ts`), as it already rejects a trial whose χ² is NaN or infinite: λ × 3 and another try, and the fit goes on. Both drivers (`refine`, `refineParallel`) now hand an evaluation's error back into the core (`gen.throw`), and the core catches it only at the trial step | A trial step that only went too far ended a refinement whose current point was valid |
| **Only the declared error is caught.** Any other error a trial throws ends the fit, as before. So does a `ModelDomainError` at the starting point, or at a Jacobian point beside an accepted one | Catching everything would turn a fault into a silent stall |
| **`generateReflections` refuses a cell length that is not positive and finite**: "Cell length a = -18.7387 Å is not a positive, finite length: there is no lattice to list reflections for. Check the cell." `ReflectionLimitError` now extends `ModelDomainError` | A negative length threw the `RangeError`. Two negative lengths listed no reflections, a length of 0 threw "Matrix is singular; cannot invert", and NaN read "Reflection list too large … NaN index triples" |
| **The result's message counts the rejected steps** and gives the first one's reason: "converged after 8 iteration(s); 8 trial step(s) rejected outside the model's domain (Cell length a = -18.7387 Å …)" | A rejection is never silent |
| `REFINEMENT_ENGINE.md` and `ARCHITECTURE.md` describe the rule; a CHANGELOG entry under Fixed | |

Why the engine and not the reflection list alone:

- **A clear error alone** would still end the refinement. The point the fit
  had reached was valid; only the step was too long, which is what LM damping
  is for. The engine already treats a failed evaluation (a non-finite χ²) this
  way, so a throwing trial now follows the same rule.
- **Returning no reflections** for a non-positive cell would let the step be
  accepted. With the phase's scale near 0, the trial pattern without its peaks
  fits as well as the current one, or better. The result would then report a
  negative cell.
- **The error class marks the domain.** A `ReflectionLimitError` at a trial
  step means that trial point has no pattern: a length ≤ 0, or a list too large
  to enumerate, which only an absurd cell asks for. At the starting point it is
  the user's cell, and the message ends the fit as before.

## Evidence

- **Failing first.** Before the change (75c3765):
  - `app/powderPage.test.ts` › "Refine completes when a trial step drives the
    cell negative" failed with `RangeError: Invalid typed array length: -9938`
    at `reflections.ts:156` ← `powder.ts:215` (the peak builder) ←
    `multiPhase.ts:115` (`calculate`) ← `engine.ts:827` (`refine`). This is the
    issue's stack.
  - `core/diffraction/reflections.test.ts` › "refuses a cell length that is not
    positive and finite" failed: `c = -5.4: expected error to be instance of
    ReflectionLimitError … Received: RangeError: Invalid typed array length:
    -166`.
  - `core/refinement/engine.test.ts` › "a trial step outside the model's
    domain": the serial and parallel tests failed. The class did not exist,
    so the toy model's first trial ended the fit.

  All of them pass after the change.
- **The issue's page** (the headless port, as the app and the Agent run it:
  window 20–100°, CaF₂ added, `p1_cell_a` free, Refine at 20 iterations):

  | | Before | After |
  | --- | --- | --- |
  | Outcome | `RangeError`, no result | converged after 8 iterations; 8 trial steps rejected, the first at a = −18.7387 Å |
  | CaF₂ scale | — | 0.211 → 2.2 × 10⁻⁶ (esd 1.3 × 10⁻⁴) |
  | CaF₂ cell a | — | 5.4626 → 13.27 Å (esd 0.71) |
  | wR in the window | — | 0.802350, the same as the demo refined alone (0.802350; they differ by 3.5 × 10⁻⁷) |

  The test checks the message, a positive cell, the scale below 10⁻³ of its
  seed, and the wR equal to the demo's own fit to five places.
- **Prefit and Escape minimum** on the same page also complete (checked once,
  not kept as a test). Prefit's final fit carries the same note. Escape
  minimum's final fit, run after Refine, converged in 2 iterations with the
  cell at 13.25 Å.
- **The engine on its own** (`engine.test.ts`, 4 tests): y = √p·x on data at
  p = 0.01 from p = 1. Gauss–Newton's step from any p > 0.04 lands below 0, and
  the model throws there. Both drivers reach p = 0.01 by the same trajectory,
  with the same message. A start at p = −1 ends the fit with the
  `ModelDomainError`. A `TypeError` from a trial step ends it too.

## What changes for users

- Refine, Prefit and Escape minimum on a page with a phase the data do not
  contain now finish, with the phase's scale near 0, where they used to stop
  with "Powder refinement failed: Invalid typed array length: -9938". The
  workbench's status line reads as for any fit. The result's message, which
  the Agent's `get_state` and the MCP refine tools return, adds the
  rejected-steps clause.
- A structure whose cell length is negative, 0 or missing (NaN) gets
  "Cell length a = … Å is not a positive, finite length: … Check the cell."
  Before, it got a `RangeError`, an empty reflection list, "Matrix is
  singular", or a "too large" message.
- A trial step that would need a reflection list too large to enumerate is now
  rejected rather than ending the fit. At the starting point the message is
  unchanged.

## What it means for the validation

A fit whose evaluations never throw follows the same trajectory, bit for bit.
The engine changes only at a trial evaluation that throws.
`generateReflections` refuses only cells it could not list before (a
`RangeError`, an empty list, a singular metric, or a "too large" error). No pinned result moves:
the suite passes unchanged. In arms B and C, an Agent that adds a phase the
data do not contain and refines now gets a finished fit, with the phase's scale
near 0, instead of a tool error. That fit is the evidence it is expected to
read.

## Not done

- **The posterior sampler** on the same page still ends at a proposal with a
  cell below 0, now with the clear message instead of the `RangeError`. Its
  proposals go to the worker pool in batches, and a batch fails as a whole.
  Rejecting the one proposal needs the pool (and the serial driver) to return
  a failed evaluation per set, for example a NaN curve, which `logPostOf`
  already scores as −∞.
- **A multi-start restart** kicked to a cell ≤ 0 still ends the search, at
  that restart's starting point. It was not seen on this page: the kick is
  about 3 × 0.71 Å on 13.27 Å.
- **The absent phase is not flagged.** Its scale ends at 2 × 10⁻⁶, not on its
  bound of 0, so `atBounds` does not list it, and its cell (13.27 ± 0.71 Å)
  means nothing. A diagnostic for a phase whose scale is within its esd of 0
  would say so. This was already true before the change.
- **Cell angles** are not checked: only the lengths are. An angle set that
  closes no cell gives a wrong pattern, not a crash. The tick marks and the
  other 30-odd callers draw from cells as they are, so refusing angles is left
  for a change that looks at them.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head:
2383 tests, 6 of them new, and 265 skipped (live runs and data-dependent
suites).

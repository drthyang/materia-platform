# One moment search for the app and MCP

Pull request [#78](https://github.com/drthyang/web-refinement/pull/78),
branch `claude/moment-driver`, on
[#77](https://github.com/drthyang/web-refinement/pull/77) (`claude/strategy-drivers`),
2026-10-19. Plan: [AGENT_PLAN.md](../AGENT_PLAN.md), 2.6 (in part). The
second half of the architecture review's #6, on the answers taken for the
user: the moment search written once over #77's `Solver`, and MCP fitting the
problem the app fits.

The moment search, which a magnetic Prefit or Escape minimum runs, was written
three times:
- in the browser's compute client, for powder and the magnetic PDF;
- again in the client, for a single crystal;
- in the MCP tool `refine_magnetic_powder`.

It restarts the moments alone on the frozen nuclear scaffold, seeds one joint
fit with the best start, canonicalizes the global ±m sign and reports the
directions the data leave undetermined.

## What changed, and why

| Change | What it answers |
| --- | --- |
| **`momentMultiStart`** in `workers/strategy.ts`, over the `Solver`: the three copies call it with their own pool (or none) and options | Three copies of one strategy |
| **The MCP tool fits the app's problem**: the profile's Lorentz flag and background basis, which it accepted and dropped, and a `fitRange` and `extraPhases`, as `refine_powder` has. Its component curves and observation count follow | The MCP moment search fitted the whole pattern on Chebyshev whatever it was given |
| **A restart kicks from the esds** of the start it perturbs, on MCP as in the app | The MCP copy wrote back the values only |
| **The single-crystal search runs on the worker pool**, and runs nothing when no moment is free | It searched in the browser's UI thread, and re-solved one problem `restarts` times when no moment was free |
| What stays the caller's: the restart counts and kick sizes per mode (the app's Prefit and Escape minimum, MCP's 0-restart default, its seed), MCP's first pass (scale and background before the moments) and its plain call (no search, no canonicalization) | — |

Not in this change: the group ranking's own restart loop
(`core/magnetic/momentRestarts.ts`), which ranks by the agreement over the
page's moments fit and is pinned by its own tests; the posterior and the plain
pooled refinements, in parity between the runtimes.

## Evidence

- **The two runtimes alike** (`workers/strategy.test.ts`): Example 3 after
  its nuclear fit, P2₁'/m''s moments free, a window and the cosine basis,
  three restarts: the app's Prefit and the MCP tool give the same wR and the
  same moments, to the last digit. On `main` the MCP tool fitted the whole
  pattern on Chebyshev (wR 4.8639 % against the app's 4.8636 %).
- **The single crystal** (same file): with no moment free, no restart runs
  (`main`: four).
- **The tools' numbers are unchanged**: Example 3 on MCP, `main` and here,
  wR 4.6087 % for P2₁'/m' with 12 restarts, 4.8640 % from one run, 9.3007 %
  for P2₁/m. The examples, the MCP tools' and registry's tests, the ranking
  on Example 3, the magnetic multi-start's recovery and determinism, and the
  pages' requests pass unchanged.
- **In the browser**, on the worker pool, `main` and here: the Mn₃Ga TOF
  demo's Magnetic tab, k = (0 0 ½), the six maximal groups ranked, the best
  one's moments fitted, Continue, then Prefit (the moment search): the same
  panel text, the same wR after the Prefit (4.0054 %) and the same moments,
  in the same 6 s; no page error.

## What changes for users

Nothing in the app's numbers. The single-crystal magnetic Prefit no longer
runs in the UI thread when workers exist. On MCP, `refine_magnetic_powder`
fits the profile it is given, and takes `fitRange` and `extraPhases`.

## What it means for the validation

None of its cases runs the moment search through MCP; the app's search is the
one it always ran.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2365
tests (#77's 2363 and the two new), 265 skipped (live runs and data-dependent
suites).

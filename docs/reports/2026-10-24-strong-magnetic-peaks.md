# Strong k = 0 magnetic peaks go to the magnetic step, not into the ADPs

Pull request [#102](https://github.com/drthyang/materia-platform/pull/102),
branch `claude/strong-magnetic-peaks` (`aa61c23`), merged into
`claude/materia-backlog`, 2026-10-24. Backlog item M4: handle strong magnetic
peaks during the refinement. The skill wording it proposed was revised with
the owner and is in [the skill edits](./2026-10-24-skill-edits.md).

## What was wrong

Nothing gates the magnetic step on the fit, but the method text, the stage
checklist and `diagnose_fit` all lead to refining positions and ADPs on the
nuclear model before it. At k = 0 the magnetic intensity sits on the nuclear
lines, and the nuclear model takes it up.

Measured on the simulated 30 K k = 0 pattern of MCP Example 3 (truth
P2₁'/m', CW neutrons 1.54 Å, seeded √y noise; truth B 0.32, 0.32, 0.16,
0.16 Å², |M| 2.53, 2.83, 2.53 µB), following the method as written:

| Stage | wR | GoF |
| --- | --- | --- |
| Scale, background, cell | 12.50 % | 2.90 |
| + positions | 12.44 % | 2.89 |
| Profile | 12.35 % | 2.87 |
| ADPs + positions, alternated × 3 | 9.08 % | 2.11 |

The scale came out 51.5 % too large (100σ) and every B 0.61–0.99 Å² too
large (22–53σ, 3–6× the truth), with nothing at a bound. The Agent's tools on
that page made four mistakes:

1. `magnetic_state.next` said "the nuclear fit leaves none and there is
   nothing magnetic to find", and the k-search failed with
   `NO_PEAK_INCLUDED`: every strong peak sits on a nuclear reflection, and the
   default criteria leave those out.
2. `diagnose_fit` gave intensity-falloff (45 % of χ²) "Free the ADPs if they
   are held", then structure (34 %).
3. `refine` with B's and positions free had no caution. `assess_refinement`
   then read "GOOD fit (GoF 2.15)", and the k = 0 hint was gone: by count only
   3 of 8 on-reflection peaks lay at d > 2.5 Å, though they carry most of the
   excess.
4. M2's unexplained-peak cause had no route to the magnetic step.

## What changed

| Change | Where |
| --- | --- |
| The k = 0 signature (`k0MagneticHint`: neutron data, magnetic ions, the residual's excess on nuclear reflections at d > 2.5 Å) weights each peak by its significance instead of counting peaks | `core/diagnostics/assessment.ts` |
| With the signature and no peak included, `magnetic_state.next` names the ≥ 5σ peaks left out for sitting on nuclear lines (`include`) or k = 0, then the ranking, and says to hold B's and positions until the moments are in. The no-peak error names `include` and the k = 0 case | `magneticTools.ts` `k0Peaks`, `magneticStep.ts` |
| `diagnose_fit`: with the signature, the intensity-falloff and structure actions start "First the k = 0 check…", followed by the old advice for a sample that is not ordered. On neutron data of magnetic ions, the unexplained-peak action routes to `magnetic_state` and `search_propagation_vector` | `fitDiagnosis.ts`, `powderTools.ts` |
| `refine` cautions on its card and in its result while B's or positions are free, a fit is on screen, the signature holds and no magnetic model is on the page. A caution, not a firm rule: the method's order is the user's | `powderTools.ts` `k0RefineCaution` |

No tool schema, tool description or saved-project format changed.

## Evidence

- **The guarded path through the in-app Agent** (`strongMagneticPeaks.test.ts`,
  the real executor): scale, background and profile; peaks 1–3 included; the
  k-search gives (0 0 0) first; the ★ is P2₁'/m'; then atoms and moments, the
  profile, atoms and moments, by the firm rules. GoF 1.01. All 16 parameters
  (scale, 4 B, 8 positions, 3 |M|) are within 1.30σ of the truth, with an RMS
  z of 0.73. The bounds were 3σ each and an RMS of 1.5, chosen before the run.
- **The magnetic start** (`k0MagneticBias.test.ts`). The moments-only |M| of
  P2₁'/m' after each path's nuclear stage:

  | Path | \|M\| (truth 2.53, 2.83, 2.53 µB) | ★ against the next group |
  | --- | --- | --- |
  | Method as written | 0.82, 1.84, 1.79 | 6.73 % against 8.36 % |
  | Guarded | 2.27, 2.81, 2.36 | 5.18 % against 9.42 % |

- **Robustness**, scratch only: 3 noise seeds × 30 000 and 3 000 counts at the
  strongest peak, both paths. The ★ was the truth in all 12 runs. The joint
  fit reached the same minimum from both starts, every parameter within 3σ of
  the truth. The method path's moments-only |M| was 0.70–1.79 µB short; the
  guarded path's was at most 0.30 µB short.
- **No effect on k ≠ 0.** On the data-gated
  [magnetic benchmark](./2026-10-24-magnetic-benchmark.md) the signature
  stays false, the guard does not fire, and the benchmark's results are
  unchanged. `backgroundTerms.test.ts` gains the k-search route with and
  without magnetic ions.

## What changes for users

On a neutron pattern of magnetic ions whose misfits sit on nuclear lines, the
Agent is pointed to the magnetic step before the ADPs, can run the k-search on
those peaks, and sees a caution before refining atoms into them. Other pages,
k ≠ 0 data and a page with a magnetic model see no change.

## What it means for the validation

No validation case has a magnetic phase, and no tool text changed, so arm A's
pinned results and the snapshots do not move. `docs/VALIDATION.md` gains one
row for the synthetic benchmark.

## Not done

- The joint fit was path-independent on these patterns. The guard's measured
  gain is the magnetic start, a ranking margin 2.5× wider, and no "good"
  verdict on a biased nuclear-only model along the way.
- A firm rule (B's and positions refused while the signature holds, lifted by
  `allow_exception`) was proposed and not added.
- Not run on real k = 0 data.
- On the k ≠ 0 benchmark, a start with the atoms held reaches a slightly
  deeper joint minimum than the nuclear-first path, with some cation
  coordinates apart beyond their esds. That is one dataset with a fit limited
  by its profile, so the guard was not extended to k ≠ 0. LIMITATIONS says
  so.
- At 3 000 counts the 40-iteration joint ended with a largest shift of
  0.18–0.39 esd, above the 0.1 "done" gate, with the same values on both
  paths.

## Checks

At `aa61c23`: lint, typecheck and `npm test` pass, 2557 tests, 253 skipped,
with no snapshot change. At the backlog's merged head (`23c1d88`): 2638
tests, 253 skipped.

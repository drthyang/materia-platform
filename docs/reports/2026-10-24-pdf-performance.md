# PDF refinement: a mixed site's pairs once, the fused pass by column, a memo per step

Pull request [#102](https://github.com/drthyang/materia-platform/pull/102),
branch `claude/pdf-performance` (`41614f4`, `91f7e30`), merged into
`claude/materia-backlog` at `23c1d88`, 2026-10-24. Backlog item M6: PDF
refinement is slow, and the question was whether the newer architecture is
to blame.

Two workloads were measured. One is the GaTa₄Se₈ demo (X-ray, F-43m, 52 atoms
and 3 species per cell, fit window 1.5–28 Å). The other is a measured neutron
G(r) on a model whose one cation site holds six species: 22 atoms per cell at
12 distinct positions, 36 partial pairs. Those data are local and not in the
repository, so for them this report gives ratios only. The machine has 4
CPUs, headless Chromium, and an evaluator pool of 3 workers. The load average
is recorded with every run (0.9–5.9 in the final campaigns), and builds
alternate within each of 5 rounds.

## Where the time went

1. **A mixed site's pairs, once per species.** Each pair was enumerated and
   summed per expanded atom. Six species on one position give 6 × 6
   cation–cation copies and 6 copies against each anion, all with the same
   r, msd and direction and differing only in the weight b·occ. That is 70 %
   of the pairs, so 3.35× the pairs and the time of a one-species site, in
   every evaluation and in memory. The partial-pair count was not the cost:
   the forward model never loops over species pairs.
2. **The fused analytic pass** (G(r) and ∂G/∂p together) interleaved every
   column at each grid point. It cost 5.7–7× one evaluation, not "about one
   extra `calculate`" as the comments said. On GaTa₄Se₈, one `calculate` took
   492 ms and the pass with 12 free took 2780 ms.
3. **The magnetic step's memo thrashed on the PDF page.** One module-global
   memo slot per key since `9cc0564` ("The magnetic step's state as one
   store", 2026-10-19). Two `KSearchPanel`s are always mounted, the hidden
   powder page's and the PDF page's, each on its own structure, so each render
   evicted the other's slots. The subgroup lattice was then re-enumerated on
   the UI thread, 0.5–1.0 s each time. On GaTa₄Se₈ (96 operations) that was
   3.4 s after a two-parameter fit and about 6 s just after opening the demo,
   on a page whose magnetic step is not even shown.

Data transfer is not a cost. GaTa₄Se₈'s fit sends 12 messages each way
(0.33 MB out, 0.22 MB in), and the multi-species fits a few MB, against
seconds of compute. The plot redraws once per cycle in at most 30 ms.

**Across commits.** Each old commit was checked out with identical inputs and
interleaved runs. On the multi-species data, engine speed is flat from July
to `main`. The analytic pass (July) was already 2.6× faster than finite
differences on the 17-parameter block. In the browser, GaTa₄Se₈'s regression
sits exactly at `9cc0564`:

| Commit | Wall | Settled | Long-task total | Longest task |
| --- | --- | --- | --- | --- |
| `cc039a8` (07-17, the demo) | 5.09 s | 5.09 s | 2.52 s | 0.72 s |
| `9cc0564~1` | 5.06 s | 5.06 s | 2.52 s | 0.65 s |
| `9cc0564` | 6.88 s | 9.43 s | 6.76 s | 1.67 s |
| `main` | 6.83 s | 8.89 s | 6.36 s | 1.56 s |
| This branch | 5.29 s | 5.29 s | 2.53 s | 0.68 s |

"Settled" runs from the click until the UI has had no long task for 2 s. So
the newer architecture is partly to blame. The magnetic store is a real
regression on the PDF page's responsiveness. The PDF engine and the workers
did not regress, and the mixed-site cost was there at every commit.

## What changed

| Change | Where |
| --- | --- |
| Each `MagneticStep` owns its memo slots (`stepView(s, at, slots)`), so two steps no longer evict each other | `app/magneticStep.ts`, `KSearchPanel.tsx` |
| The fused pass evaluates each pair's Gaussian window once into scratch arrays, then fills the active columns one at a time: the same terms in the same order, so the result is bit-identical | `core/pdf/gradients.ts` |
| `colocatedGroups` groups expanded atoms with exactly equal position and ADP (null when none coincide, so ordered structures keep the per-atom path). Only representatives are paired, each carrying its group's summed weight; N, ⟨b⟩ and ρ₀ stay the cell's. Occupancy derivatives sum the same way. If a species has its own B or position row, the problem falls back to a per-atom pair list | `pairEnumerator.ts`, `totalscattering/weights.ts`, `forwardModel.ts`, `workflow/pdf.ts` |
| PDF_MPDF_ROADMAP §6 and REFINEMENT_ENGINE (the fused pass) | `docs/` |

The grouping covers the single-phase PDF problem: Refine, Prefit, boxcar,
posterior and MCP `refine_pdf`. Multi-phase, multi-dataset, mPDF and the
partials keep the per-atom sum. The project format, the tool schemas and
outputs, the UI and the driver's placement are unchanged.

## Evidence

**Browser, the real Refine button**, production builds of `main` and of this
branch. Each row is a median of 5. The targets were set before the
campaigns.

| Workload | Speed-up (wall) | Target |
| --- | --- | --- |
| Multi-species, cell and scale, the page's default window (to 30 Å) | 2.95× | ≥ 2×: met |
| Multi-species, 17 parameters (cell, B's, positions), default window | 3.22× | ≥ 2.5×: met |
| Multi-species, 17 parameters, local window (to 20 Å) | 3.03× | ≥ 2.5×: met |
| Multi-species, cell and scale, long window (to 50 Å) | 3.51× | ≥ 2×: met |
| Multi-species, cell and scale, the data's full range | renderer crash on both builds | completes: **not met** |
| GaTa₄Se₈, scale and a: wall 6.99 → 5.45 s, settled 9.53 → 5.45 s, longest task 1.72 → 0.70 s | settled −43 % | ≥ 20 % lower: met |
| GaTa₄Se₈, 12 parameters: wall 16.85 → 11.33 s, longest task 2.51 → 1.96 s | 1.49× | not worse: met |

For the 17-parameter fit at the default window, the longest UI-thread task
became 3.8× shorter and the long-task total 3.6× smaller. The task's
absolute target was missed by a narrow margin. Every run on both builds ended
with the same status, cycle count and Rw (GaTa₄Se₈ 8.12 % and 7.86 %), and
the message counts and sizes were identical.

**Node, serial** (the MCP and worker path), multi-species at the local
window: 3.43× for the 17-parameter fit (target ≥ 3×) and 3.1× for cell and
scale. One evaluation at the default window is 3.5× faster. The analytic pass
is 7.1× faster, and 8.0× with the six occupancies free. The pair list takes
about 3.3× less memory. The loop restructure alone gives 1.93× on the
multi-species pass and 1890 → 980 ms on GaTa₄Se₈'s 13 columns.

**Equivalence.** On GaTa₄Se₈ (no co-located atoms), G(r), the columns, the
refined values, the esds and Rw are bit-identical. On the multi-species data
the summation reorders: G(r) agrees to about 10⁻¹³ relative, refined values
to under 2 × 10⁻⁹ esd, with the same status and iteration count. The
tolerances were 10⁻¹² for G(r) and 10⁻⁶ esd.

**Tests.** `core/pdf/colocated.test.ts` (5) compares the grouped sum with the
per-atom sum and covers the fallback (a mutation that disables it fails).
`magneticStep.test.ts` gains two steps on different structures keeping their
own `reps`, which fails on `main`. The PDFfit2 and diffpy.mpdf goldens, the
analytic-Jacobian gate and pooled = serial pass unchanged.

## What changes for users

PDF refinements on a site shared by several species run about 3× faster, and
the UI freezes for a fraction of the time. The PDF demo's page settles as it
did before `9cc0564`. Results do not change beyond the last bits.

## What it means for the validation

No validation case is a PDF, and no tool text changed, so arm A, arms B and C
and the snapshots are unchanged.

## Not done

- **Long tasks remain on the UI thread.** The parallel driver's trial
  evaluations and analytic columns run there. Moving them needs the driver in
  a worker, or the columns on the pool: an architectural change, not
  attempted.
- **The full-range fit still crashes the renderer.** The diagnosis is memory:
  an object per pair, about 186 bytes, held in each of 4 isolates. The
  shared-heap-cage explanation is unverified. A typed-array pair list (about
  52 bytes a pair), not copied into every evaluator, is the next step.
  Beyond 50 Å, `bandLimit` (O(n²), once per column) becomes significant too.
- Not measured: mPDF and multi-phase on the multi-species data (unchanged
  per-atom path), Firefox and Safari.
- Found, not changed: the Rw reported for a PDF fit with an occupancy-Σ
  restraint changed between `e5ddcbd` and `be6ec29~1` with identical refined
  values. The restraint row left the Rw denominator.

## Checks

At `91f7e30`: lint, typecheck, build and `npm test` pass, 2503 tests, 253
skipped. At the backlog's merged head (`23c1d88`): lint, typecheck, build and
`build:mcp` pass. `npm test` gives 312 files, 2638 tests passed, 253 skipped,
none failed. The browser checks `agent-choices-check.mjs` (18/18) and
`agent-ask-user-check.mjs` (16/16) pass. One GaTa₄Se₈ run on the merged
build settled in 5.38 s with a 0.70 s longest task, matching this branch.

# PDF to the full range: pairs without objects, one evaluation split across the pool

Branch `claude/pdf-long-range-memory`, 2026-10-24. Backlog item M9: after M6,
a PDF fit over the data's full range (1.5–100 Å) on a multi-element-site model
still crashed the browser tab, on `main` as on the M6 branch. The owner's
requirement: no compromise of scientific accuracy or precision.

The workload is the same measured neutron G(r) as M6's, on the bundled model
whose one cation site holds six species. Those data are local and not in the
repository, so for them this report gives ratios and pass/fail only. The
machine has 4 CPUs, headless Chromium and an evaluator pool of 3 workers.
Other jobs shared it; the load average is recorded with every run.

## Why the tab crashed

**The trace.** A memory trace of the 1.5–100 Å fit on `main` (CDP heap usage
of the page and of each worker, the renderer's RSS once a second) ended in
`V8 javascript OOM (CALL_AND_RETRY_LAST)` from a worker thread. The page
isolate held a steady share of the heap, and each worker swung between one
share and two. No isolate came near its own heap limit (4192 MB), and the
machine had memory to spare; together the isolates had reached the heap the
tab's isolates share (below).

**The limit is per tab, not per isolate.** Small JS objects allocated in one
page and N dedicated workers of the same tab:

| Isolates × target | Result |
| --- | --- |
| 1 × 3.5 GB (3.86 GB used) | fine |
| 4 × 0.7 GB | fine |
| 4 × 1.2 GB | `V8 javascript OOM (CALL_AND_RETRY_LAST)` |
| 2 × 1.9 GB | `V8 javascript OOM (… young object promotion failed)` |

One isolate can hold almost 4 GB, but the isolates of one renderer together
cannot: they share one heap reservation of about 4 GB.

**What filled it: the pair list.**
- An `Array` of objects `{ rij, i, j, msd, nx, ny, nz }`: two small integers and
  five doubles, each double a separately allocated HeapNumber. About 100 bytes
  a pair in a Chromium isolate (170 in node).
- Ordered pairs: every unordered pair is held twice, (i, j, T) and (j, i, −T).
  The mirror is not bit-identical (its distance is computed from the opposite
  difference), so this is a doubling, not a duplicate.
- Not a copy made by messaging: the list never crosses `postMessage`. The UI
  thread and each of the 3 evaluators build their own from the spec.
- On every geometry change (each finite-difference cell column) a worker builds
  the new list while the old one is still referenced, so each worker holds two
  lists at its peak.

At 1.5–100 Å the model has millions of pairs, and four isolates holding one or
two lists each reach the tab's shared budget. The same holds for any model
with enough pairs: the list grows as r_max³.

## What changed

| Change | Where |
| --- | --- |
| **Pairs without objects.** A pair is its lattice translation (three Int16 per run of pairs) and a 1-, 2- or 4-byte atom-pair code: about 1–2 bytes a pair. r, n̂ and the msd are recomputed from the float64 Cartesian positions and ADP tensors with `enumeratePairs`' own expressions, in its order, so every value is bit-identical to the object it replaces. The kernels read pairs in chunks of typed arrays. | `pdf/pairEnumerator.ts` (`CompactPairs`, `PairSource`), `forwardModel.ts`, `gradients.ts`, `partials.ts` |
| **One evaluation split across the pool.** For a single-phase PDF problem the browser pool no longer replicates the problem. Worker w of W computes block w of the model grid (contiguous, balanced by r³) from only the pairs whose ±5σ window can reach it; the driver joins the blocks and finishes them (termination, the window, the restraint rows). Each grid point receives the same terms in the same order as in the whole sum, so the result is bit-identical, not merely close. Single evaluations and the analytic columns go to the pool too, so the UI thread holds no pair list. | `workflow/pdf.ts` (`PdfSplit`, `pairReachBound`, `joinBlocks`), `workers/computeClient.ts`, `compute.worker.ts`, `protocol.ts`, `runPowder.ts` |
| **The margin is a stated bound.** A shard drops a pair only if it lies beyond `pairReachBound` of its block: 5σ plus two grid steps, with σ² ≤ (‖U_i‖ + ‖U_j‖)·max(1 + \|δ1\|/r + \|δ2\|/r² + Qbroad²r², 1) for r ≥ 4 Å (each ‖U‖ the smaller of the Frobenius norm and the largest Gershgorin row sum), widened by sratio below rcut. Pairs under 4 Å are kept by every shard. The bound is checked at every evaluation, and a shard widens its list when the widths grow. | `workflow/pdf.ts` |
| **The LM core can ask its evaluator for the analytic columns.** In this remote mode `refineCore` yields an analytic request instead of computing them on the driver thread; the columns are the same. `refineParallel` uses it when the evaluator splits evaluations, and also sends it the single evaluations; the posterior sampler sends it its single evaluations. | `refinement/engine.ts`, `bayes/sampler.ts` |
| **Chunked generation as a guard.** A list projected beyond `PAIR_STORE_BUDGET_BYTES` (64 MiB, tens of millions of pairs) is generated, accumulated and discarded chunk by chunk on every read (`streamPairs`): the same arithmetic in the same order, memory one chunk. | `pdf/pairEnumerator.ts` |
| The multi-phase, multi-dataset and mPDF nuclear pair caches hold the compact list, and the partials overlay streams its pairs: bit-identical, smaller. | `workflow/pdf.ts`, `workflow/mpdf.ts`, `pdf/partials.ts` |
| REFINEMENT_ENGINE (pairs without objects, the split pool, the remote columns), ARCHITECTURE (the split path), PDF_MPDF_ROADMAP §6; VALIDATION's data table names the test that now reads `pdf.gr` | `docs/` |

The project format, the tool schemas and outputs, the UI and the MCP server's
pool (replicas, now holding compact lists) are unchanged.

**Considered and not taken.** Storing each unordered pair once and weighting it
twice would halve the pair work, but the mirror's distance and direction differ
in the last bits, so G would change by ~10⁻¹⁴ relative; space-group
multiplicity is exact for G but needs per-image care for the position
derivatives. Neither is needed for memory once a pair costs about a byte, so
both are left for a decision on speed.

## Evidence

**Equivalence with `main`** (`main` after #106, whose shared-site occupancy
tie changes the multi-element site's results by design; node, the same inputs
through each tree's code;
serial `refine` with analytic columns, as the worker and MCP paths run it, and
`refineParallel` over an in-process split evaluator with 3 shards, as the
browser pool runs it). Required: G(r), every analytic column, the refined
values, esds, Rw, the χ² history, status and iteration count all
**bit-identical**. Result:

| Case | Free | Serial | Split pool |
| --- | --- | --- | --- |
| GaTa₄Se₈, scale and a, 1.5–28 Å | 2 | bit-identical | bit-identical |
| GaTa₄Se₈, 12 parameters, 1.5–28 Å | 12 | bit-identical | bit-identical |
| GaTa₄Se₈ synthetic, scale and a, 1.5–50 Å | 2 | bit-identical | bit-identical |
| GaTa₄Se₈ synthetic, 12 parameters, 1.5–50 Å | 12 | bit-identical | bit-identical |
| Multi-element site, cell and scale, 1.5–30 Å | 5 | bit-identical | bit-identical |
| Multi-element site, 17 parameters, 1.5–30 Å | 17 | bit-identical | bit-identical |
| Multi-element site, 17 + 5 occupancies (the 6th tied), 1.5–30 Å | 22 | bit-identical | bit-identical |
| Multi-element site, cell and scale, 1.5–50 Å | 5 | bit-identical | bit-identical |
| Multi-element site, 17 parameters, 1.5–50 Å | 17 | bit-identical | bit-identical |

**Tests.**
- `pdf/compactPairs.test.ts` (8): the compact list and the stream are
  `enumeratePairs` pair by pair (`Object.is` on every field) on hexagonal,
  triclinic, anisotropic and the bundled structures, with and without
  co-located groups and within a shell; `computeGofR` and the fused pass are
  bit-identical on objects, the compact list, the stream and none given; the
  budget switches to streaming.
- `workflow/pdfSplit.test.ts` (5): 1–6 shards join to `calculate` and to every
  analytic column kind bit for bit, on GaTa₄Se₈ (X-ray, anisotropic, δ1/δ2,
  Qdamp/Qbroad) and on the bundled multi-element site (groups, neutron, an
  occupancy restraint), including a value set whose much wider peaks force
  every shard to widen its list; `refineParallel` over the split evaluator is
  the serial refinement bit for bit while the driver's own problem is never
  evaluated; the reach bound holds for every pair at the widest set. A
  mutation that cuts the margin to 0.3× the bound fails all three bit-identity
  tests.
- `workflow/realPdfLongRange.test.ts` (2, data-gated, skips without the local
  data): on the measured grid, 3 shards are bit-identical to the whole
  evaluation and its columns, and the full range's list fits the budget at
  under two bytes a pair. It reads the data by the generic name `pdf.gr`
  (VALIDATION's layout) and holds no number from them.

**The full range in the browser** (production builds, the user's flow: Load
CIF…, Load data…, drag the window to 100 Å, Refine with cell and scale free).
- `main`: the renderer crashes with a V8 OOM.
- This branch: the fit converges in every run (5 of 5), to the cycle count
  and Rw of a serial node refinement of the same fit. The renderer's peak RSS
  is under a tenth of where `main` crashed; no isolate holds more than a few
  tens of MB of JS heap.

**G(r) at 1.5–100 Å against independent calculations.**
- A direct double-precision pair sum written for this check in numpy, sharing
  no code with the app: its own symmetry expansion, metric-tensor distances,
  every atom paired (no grouping of the six species), and its own sinc
  termination with the odd reflection. It uses the same model definition (±5σ
  windows). It agrees to better than 10⁻¹³ of max |G| (tolerance 10⁻¹⁰), as
  at 30 Å. Without the ±5σ cut, the reference differs by 3 × 10⁻⁶ of max |G|
  at both ranges. That is the size of the window's existing truncation, which
  this change does not touch.
- PDFfit2 (PDFgui's engine, diffpy.pdffit2 1.6.0, with the app's scattering
  lengths set on it) agrees no worse at 100 Å than at 30 Å: Pearson
  r > 0.9996 and a relative RMS difference under 3 % over the whole window.
  From 20 Å to 100 Å every 10 Å band has r > 0.99997. The residual
  difference sits below 10 Å, where the two programs' conventions differ, as
  in the existing PDFfit2 gates (r > 0.999, relative RMS < 5 %).
- diffpy.srreal's wheel lacks its native library here, so it was not used.

**Memory** (CDP heap usage per isolate; the renderer's RSS;
`measureUserAgentSpecificMemory` on a cross-origin-isolated build of each):

| Workload (cell and scale free unless stated) | This branch against `main` |
| --- | --- |
| Multi-element site, 1.5–50 Å | renderer peak RSS 5.3× lower; worker JS heaps 60–75× smaller; on `main` the isolates already filled over a third of the tab's shared heap |
| Multi-element site, 1.5–50 Å, 17 parameters | renderer peak RSS 4.3× lower; isolate heaps 8–90× smaller |
| Multi-element site, 1.5–100 Å | completes, where `main` crashes; the isolates together peak at under 1/50 of the heap `main` held when it crashed |

**Speed.** Production builds of `main` (after #106) and of this branch were
alternated within each round, with the order reversed on alternate rounds.
Each row is a median of 5 rounds (3 for the 17-parameter fit to 50 Å), at
load 0.7–2.8. "Longest task" is the longest main-thread task
(`PerformanceObserver` longtask).

| Workload | Wall | Longest UI-thread task |
| --- | --- | --- |
| GaTa₄Se₈, scale and a | 5.05 → 3.70 s (1.36×) | 0.68 → 0.57 s |
| GaTa₄Se₈, 12 parameters | 10.92 → 6.72 s (1.63×) | 1.86 → 0.58 s |
| Multi-element site, cell and scale, to 20 Å | 1.18× faster | about equal |
| Multi-element site, 17 parameters, to 20 Å | 1.32× faster | 8× shorter |
| Multi-element site, cell and scale, to 30 Å | 1.22× faster | about equal (the post-fit curve) |
| Multi-element site, 17 parameters, to 30 Å | 1.41× faster | 9× shorter; M6's 2.5 s target met |
| Multi-element site, cell and scale, to 50 Å | 1.39× faster | 4× shorter |
| Multi-element site, 17 parameters, to 50 Å | 1.44× faster | 8.6× shorter |

In every row the branch's slowest run beat `main`'s fastest, and every run on
both builds ended with the same status, cycle count and Rw. On the serial
node path (MCP), in 5 interleaved runs, an evaluation after a geometry change
is 8–12 % faster because no objects are allocated. An evaluation on cached
pairs and the analytic pass are within noise (−4 to +7 %, every median inside
`main`'s range), because the pairs' values are recomputed on every read.

The split pool's other users were checked in the browser on GaTa₄Se₈:
Escape minimum (60 s against 90 s), the boxcar scan (22 boxes, the pool set
up again for each; 16 s against 22 s) and the posterior run, with the same
results as `main` and no new console error. Posterior throughput is the same
within the step counter's resolution.

## What changes for users

A PDF fit over the whole r range of a long-range dataset runs to completion in
the browser instead of crashing the tab. The UI thread no longer evaluates
G(r) during a single-phase PDF fit, so the page stays responsive while it
runs. Results are unchanged to the last bit.

## What it means for the validation

No validation case is a PDF, and no tool text changed, so arm A, arms B and C
and the snapshots are unchanged.

## Not done

- **The page's own curve is still computed on the UI thread.** After a fit,
  and whenever the fit window moves, the page evaluates G(r) once
  (`pdfCurves`). With the fit's evaluations now on the pool, that is the
  remaining long task: about 0.3 s at 30 Å, 1.5 s at 50 Å and a few seconds
  at 100 Å on this machine. It is memory-safe (compact pairs). Taking the
  curve from the fit's last evaluation, or computing it on the pool, is the
  next step.
- **The driver itself still runs on the UI thread** (step 5 of the plan). It
  was not moved: with every evaluation and analytic pass on the pool, the UI
  thread keeps only the LM step and the per-set termination. The longest
  task during the 17-parameter fit at 30 Å is now 0.26 s, and that task is the
  post-fit curve above.
- **Each unordered pair once, and space-group multiplicity.** Not taken (see
  above). Either would halve or further cut the pair work, but would change
  G by ~10⁻¹⁴ relative, or needs per-image care for the derivatives.
- The MCP server's node pool still replicates the problem. It holds compact
  lists now, and node isolates do not share a heap.
- Not measured: Firefox and Safari.

## Checks

At the merged tip (this change merged with `main` after #104, #105 and #106):
typecheck, lint, `npm run build` and `build:mcp` pass. `npm test`
(`--maxWorkers=2`): 321 files passed and 30 skipped; 2691 tests passed and
279 skipped, none failed. That includes the 15 new tests. The PDFfit2 and
diffpy.mpdf goldens, the analytic-Jacobian gate, pooled = serial, the
shared-site tie's tests (`pdfOccupancyTie.test.ts`) and the PDF page's tests
pass unchanged. Every comparison above was taken against `main` after #106,
on builds of the merged tip.

Before the change, the full suite on its original base had one failure: a
5 s timeout in `agent/needsStructure.test.ts` at load 17, which passed when
run alone.

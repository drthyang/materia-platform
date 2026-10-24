# A shared site's occupancies sum to exactly 1 on the PDF page

Pull request [#106](https://github.com/drthyang/materia-platform/pull/106),
branch `claude/occupancy-hard-tie`, 2026-10-24. The owner's decision: on the
PDF page, the occupancies of a site shared by several species (the
high-entropy tungstate's six cations on one site) sum to 1 by a hard
constraint, not a soft restraint.

## What was wrong

- **A soft restraint, and not to 1.** `buildPdfSpec` gave every species its
  own free occupancy row. Their sum was held by a pseudo-observation
  (`occ_sum_<site>`, σ 0.01, weight 10⁴ against G(r)'s unit weights, so its
  stiffness against the data depended on the scale of G(r)). Its target was
  the starting sum: the PDF page never passed `occupancyToUnity`, so the
  bundled (Co,Cu,Fe,Mn,Ni,Zn)WO₄ (6 × 0.167) was held at 1.002, and refined
  with the sum moving by the restraint's residual. Position and ADP were
  already one parameter each.
- **The other pages.** The powder page builds the same soft restraint
  (target the starting sum, or 1 with "Σ occ = 1"). The single-crystal page
  has no shared-site Σ; it has hard ties of its own: a disorder's two
  alternatives by the user's complement tie (SHELXL's 21/−21, `= -1*A+1`, the
  follower held fixed), and twin fractions as n − 1 free values with the first
  domain's esd from the full covariance (`combinationEsd`).
- **No tie could say "one minus five others".** A tie expression read one
  row (`= f*id + c`) or a norm (`hypot`).

## What changed

| Change | Where |
| --- | --- |
| The sum tie `= c ± f*sum(a, b, …)`: parsed, resolved, renamed and referenced like the linear tie. `remainderOf` writes a site's last occupancy as `= 1 - sum(…)`, and as the existing complement for one other | `core/refinement/constraints.ts` |
| On the PDF page each site with ≥ 2 members has its last member's occupancy follow one minus the others' (`sharedOccupancyTies`), held fixed and seeded at that value; the soft `occ_sum_*` row is no longer emitted. The ties follow a multi-phase page's prefixed ids. `PdfSiteTies.occupancyToUnity` is gone (the sum is always 1) | `core/workflow/structureRefinement.ts`, `core/workflow/pdf.ts` |
| The engine gives a row tied to a sum of free rows the esd √(fᵀCf) from the full covariance, in `combinationEsd` under the row's id (a fixed reference adds nothing). `result.esd` still holds the free rows only, which the posterior and report checks read as the refined set | `core/refinement/engine.ts` |
| `esdsWithTies`: every row's esd, a tied row's from its tie. The report, the CIF, the parameter panel and the Agent's `get_state` and `structure_table` use it | `constraints.ts`, `reportInputs.ts`, `PdfWorkbench.tsx`, `agent/pdfTools.ts`, `agent/structureTable.ts`, `agent/liveCommon.ts` |
| A free occupancy's analytic column carries the occupancy that follows it (dOcc + f on the follower's atoms), as the single-crystal columns carry a complement, instead of falling back to finite differences | `core/workflow/pdf.ts` |
| A project saved before the tie opens with it: values kept, the last occupancy held at one minus the others (and its starting value from theirs) even if saved free | `app/pdfPage.ts` |
| A hand edit of an occupancy moves the row tied to it | `app/pdfPage.ts` |
| `get_state` lists `occupancyConstraints`; `refine` notes the constraint when such an occupancy refined; the report's Data & model has a "Shared sites" row | `agent/pdfTools.ts`, `app/reportInputs.ts` |
| The firm rule "no bare occupancy" and the correlation guard count the occupancies a sum tie reads as tied, as they count a restraint's | `agent/method.ts`, `core/diagnostics/correlationGuard.ts` |
| REFINEMENT_ENGINE (the grammar, the tied esd), PROJECT_FORMAT, LIMITATIONS, CHANGELOG | `docs/` |

The powder page is unchanged: it keeps its soft restraint and its
"Σ occ = 1" and "hold composition" settings.

## Evidence

`core/workflow/pdfOccupancyTie.test.ts`, on synthetic (A)O in the CsCl type
with invented occupancies:

- **Σ = 1 at every evaluation.** Six species loaded at Σ 1.14, five
  occupancies, the scale, the cell and B free: every one of the fits'
  evaluations, flat and staged (scale → cell → ADP → occupancy), applies a
  structure whose six occupancies sum to 1 within 1e-12 (rounding).
- **Truth within esds.** Two species (Fe 0.62/Mn 0.38, noise 1 % of max |G|):
  Fe within 3 esd of the truth, Mn = 1 − Fe exactly, Mn's esd Fe's. Six
  species with neutron and X-ray G(r) together (two contrasts, Mn and Cu
  free, Zn following): all three within 3 esd.
- **The eliminated occupancy's esd.** Zn's esd from the engine equals the
  covariance propagated by hand from a finite-difference Jacobian (within
  10⁻³), equals Zn's own esd when Zn refines and Mn follows instead (within
  2 × 10⁻³; Mn's propagated esd equals its own likewise), and the posterior's
  spread of 1 − Σ the sampled others is 1.04 × the esd (ensemble sampler,
  2000 samples).
- **The analytic columns** of tied occupancies match central differences to
  10⁻⁶ of the column's maximum, for the sum and the complement.
- **An old project** (six free occupancies, no tie, Σ 1.002) opens with the
  last one tied and held, Σ = 1 on the structure, and refines. The project
  saved by `main` itself (a soft-restraint fit) was validated as a project
  file and reopened the same way.

**No shared site: bit-identical to `main`.** Refinement results captured on
`main` and on this branch, compared as JSON (every value, esd, diagnostic and
cycle): GaTa₄Se₈ with 13 free (analytic and finite-difference Jacobian), the
PDFfit2 Ni golden flat, staged and as two phases with a free lone-site
occupancy, and a powder fit of the high-entropy site with its soft restraint.
All identical. The GaTa₄Se₈ spec has no tie and no restraint.

**Goldens.** The PDFfit2 and diffpy.mpdf goldens, the analytic-Jacobian gate
and every powder golden pass unchanged; none was re-pinned. The data-gated
AWO₄ powder benchmark runs and passes. There is no data-gated AWO₄ PDF test;
the AWO₄ PDF was refitted outside the repository, its numbers kept there.

**PDF performance.** M6's `nodeTiming.ts` on GaTa₄Se₈ (node, serial,
analytic on; medians, load 2.6–6.4 from other jobs), this branch against
`main` run just after it:

| Measure | `main` | This branch |
| --- | --- | --- |
| `calculate` (pair cache hit) | 518 ms | 491 ms |
| Analytic pass, 12 free | 1256 ms | 1183 ms |
| Refine W1 (scale, a): wall, cycles, Rw | 8.82 s, 3, 8.118 % | 9.26 s, 3, 8.118 % |
| Refine W2 (13 free) | 20.81 s, 5, 7.863 % | 21.00 s, 5, 7.863 % |

The differences are within the runs' spread (W1 8.66–9.11 s on `main`,
8.77–9.53 s here) and change sign between measures; the evaluation counts,
cycles and Rw are the same, as the bit-identical results require. A shared
site's tied occupancies keep their analytic columns instead of falling back
to finite differences.

**Mutation checks.** Each piece undone in turn fails tests: the engine's
tied esd (5 tests), the analytic followers (1), the soft restraint put back
beside the tie (2), the reopened rows' tie (1), the multi-phase rename (1),
the guard's exemption (1), the method rule (1), the tied row's esd in
`get_state` (1). With `main`'s soft restraint and no
tie, 10 of the 12 new PDF tests fail.

## What changes for users

- On the PDF page a shared site's last occupancy row reads "= tied"
  (`= 1 - sum(…)`, or `= -1*occ_A+1` for two species) and cannot be freed; it
  shows its esd. Freeing n − 1 occupancies refines the split; their sum is 1.
- A site meant to hold vacancies cannot be held below full occupancy on this
  page any more; the starting model's sum is replaced by 1 (the bundled
  tungstate's 1.002 becomes 1: the last cation starts at 0.165).
- A reopened project shows its last result until the next refinement, which
  runs with the tie.
- The Agent sees `occupancyConstraints` in `get_state`, a note in `refine`,
  the tied row's esd, and the report a "Shared sites" row.
- MCP's `build_pdf_model` returns the tied row; its `restraints` are empty for
  a shared site.

## What it means for the validation

No validation case is a PDF with a shared site, so arm A's pinned results do
not move and no tool text changed. On such a page `get_state` gains a field
and `refine` a note; arms B and C would now read the constraint there.

## Not done

- **The powder page** keeps its soft restraint; making it hard there too is
  the owner's decision (its "Σ occ = 1" toggle, the composition restraints and
  the anti-site flow build on it).
- **No bound on the follower.** 1 − Σ others is not kept within [0, 1]; a fit
  that drives it negative is not flagged.
- **The last member is eliminated**, by file order; it cannot be chosen.
- **One G(r) sees a shared site only through its summed scattering.** With
  three or more species, the data determine one combination of the n − 1
  free occupancies and leave the others undetermined (4 of 5 on the bundled
  tungstate's model, simulated): the SVD drops them and the Agent's guard
  refuses the fit, with the soft restraint as with the tie. A second
  contrast (X-ray with neutron) separates more.

## Checks

At the branch head: `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run build:mcp` pass. `npm test`: 344 files, 315 passed and 29 skipped;
2667 tests passed, 253 skipped, none failed (the AWO₄ data present, so its
powder benchmark ran). On `main` before the change the same run gave 2650
passed and 1 failed, `needsStructure.test.ts` timing out at 5 s under a load
of 11–16 from other jobs; it passes here.

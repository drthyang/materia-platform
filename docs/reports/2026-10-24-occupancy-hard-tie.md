# A shared site's occupancies sum to exactly its total, on the powder and PDF pages

Pull request [#106](https://github.com/drthyang/materia-platform/pull/106),
branch `claude/occupancy-hard-tie`, 2026-10-24 and 2026-10-25. The owner's
decisions: the occupancies of a site shared by several species (the
high-entropy tungstate's six cations on one site) sum to their total by a
hard constraint, not a soft restraint, first on the PDF page and then on the
powder page too; the total is 1 unless the user sets it lower for vacancies;
a tied occupancy outside [0, 1] is warned of, never clamped; the eliminated
member stays the last in file order.

## What was wrong

- **A soft restraint, not to 1.** Both pages gave every species its own free
  occupancy row and held their sum by a pseudo-observation (`occ_sum_<site>`,
  σ 0.01). On the PDF page its weight was 10⁴ against G(r)'s unit weights, so
  its stiffness depended on the scale of G(r), and its target was the
  starting sum: the bundled (Co,Cu,Fe,Mn,Ni,Zn)WO₄ (6 × 0.167) was held at
  1.002. The powder page did the same unless "Σ occ = 1" was switched on, and
  applied it only while one of the occupancies was free. Position and ADP
  were already one parameter each.
- **The single-crystal page** has no shared-site Σ, and hard ties of its own:
  a disorder's two alternatives by the user's complement tie (SHELXL's
  21/−21, `= -1*A+1`, the follower held fixed), and twin fractions as n − 1
  free values with the first domain's esd from the full covariance
  (`combinationEsd`).
- **No tie could say "one minus five others"**: a tie expression read one row
  (`= f*id + c`) or a norm (`hypot`). And no site could hold vacancies except
  through the restraint's starting sum.

## What changed

| Change | Where |
| --- | --- |
| The sum tie `= c ± f*sum(a, b, …)`, parsed, resolved, renamed and referenced like the linear tie. `remainderOf(others, total)` writes a site's last occupancy: `= -1*a+1` (or `+0.95`) for one other, `= 1 - sum(…)` (or `0.95 - …`) for more | `core/refinement/constraints.ts` |
| `buildStructureRefinement`'s `tieSharedOccupancy` and `occupancyTotals`: each site with ≥ 2 members has its last member's row follow the site's total minus the others' (`sharedOccupancyTies`), held fixed and seeded at that value, and no Σ restraint. The PDF and powder pages' specs use it; a multi-phase page's ties read each phase's prefixed rows. Its other callers (MCP's powder tools) keep the soft restraint by default | `core/workflow/structureRefinement.ts`, `pdf.ts`, `app/powderSpec.ts`, `multiPhaseSpec.ts` |
| A site's **total**, 0.001–1, by the site's key (its first member's label), 1 where unset: the powder page's `siteTies.totals`, the PDF page's `siteTotals`, each an optional project field (old files: every site 1). Set in the panel's Occupancy group on either page; the last occupancy follows the new total and the other rows keep their values | `powderModelOptions.ts`, `core/project/types.ts`, `validate.ts`, `app/pdfPage.ts`, `powderPage.ts`, `ui/SiteTotals.tsx` |
| The engine gives a row tied to a sum of free rows the esd √(fᵀCf) from the full covariance, in `combinationEsd` under the row's id (a fixed reference adds nothing; the constant, so the total, does not enter). `result.esd` keeps the free rows only. `esdsWithTies` merges a tied row's esd for the panel, the CIF, the report and the Agent | `core/refinement/engine.ts`, `constraints.ts`, workbenches, `reportInputs.ts`, `agent/` |
| **Out of range**: `siteSumRangeWarnings` names a last occupancy outside [0, 1]. It shows under the parameter panel, in `refine`'s result (`occupancyWarnings`), in `get_state`, as a "Shared sites" check (warn, else pass) and among the report's warnings. Nothing clamps it | `structureRefinement.ts`, `ui/ParameterPanel.tsx`, `agent/executor.ts`, `liveCommon.ts`, `reportChecks.ts`, `reportInputs.ts` |
| A free occupancy's analytic PDF column carries the occupancy that follows it (dOcc + f on its atoms) instead of falling back to finite differences | `core/workflow/pdf.ts` |
| Projects saved before the tie open with it: values kept, the last occupancy (even if saved free) following the others, its starting value from theirs; a powder file's `occupancyToUnity` is read and dropped. A rebuild or a hand edit keeps the tied row at its tie's value | `app/pdfPage.ts`, `powderSession.ts`, `projectIo.ts`, `powderPage.ts` |
| The Agent: `get_state` lists `occupancyConstraints` (with the total and its vacancies); `refine` notes the constraint; `structure_table` gives the tied occupancy its esd. On the powder page `set_site_ties` takes `totals` (the existing approval-gated tool; its `occupancyToUnity` is gone); the PDF page has no tool that could carry it, so the Agent cannot set a PDF total. The bare-occupancy rule and the correlation guard count a sum tie's occupancies, and a restraint's term on a tied row, as tied | `agent/` |
| The powder page's "Σ occ = 1" check box is gone; `add_antisite` no longer switches it | `PowderWorkbench.tsx`, `powderPage.ts` |
| REFINEMENT_ENGINE, PROJECT_FORMAT, LIMITATIONS, USER_GUIDE, AGENT_TOOLS, CHANGELOG; `my-rietveld-workflow`'s two sentences on "Σ occ = 1" brought in line with the tool (the skill's method is unchanged) | `docs/`, `.claude/skills/` |

## Evidence

On synthetic (A)O in the CsCl type with invented occupancies
(`core/workflow/pdfOccupancyTie.test.ts`, `app/powderOccupancyTie.test.ts`,
`agent/sharedSiteConstraint.test.ts`) and the bundled tungstate's synthetic
powder pattern:

- **Σ equals the total at every evaluation**, within 1e-12: PDF, six species
  loaded at Σ 1.14, flat and staged; PDF with total 0.95; powder, six species
  loaded at Σ 1.2, totals 1 and 0.95. Every evaluation's applied structure is
  checked, not only the result.
- **Truth within esds**: two species (Fe 0.62/Mn 0.38) within 3 esd, Mn's esd
  Fe's; six species from neutron + X-ray G(r) (Mn and Cu free, Zn following),
  all three within 3 esd, for totals 1 and 0.95.
- **The eliminated occupancy's esd**, for totals 1 and 0.95: the engine's
  equals the covariance propagated by hand from a finite-difference Jacobian
  (10⁻³) and Zn's own esd when Zn refines and Mn follows instead (2 × 10⁻³);
  the posterior's spread of the total minus the sampled others is 1.04 × the
  esd (2000 samples, total 1).
- **Out of range**: a fit that drives the last occupancy negative (the data
  wanting more than the site's total) leaves it there; the warning appears in
  the refine result, `get_state`, the checks and the report, and on a page in
  range none appears and the check passes. A value above 1 (others set below
  0 by hand) is named too.
- **Totals** are honoured by the tie's constant, the page's rows (the others
  keep their values), the saved project and an older one (read as 1), and the
  Agent's `set_site_ties` (an unknown site key or a model without a shared
  site refused).
- **Old projects of both kinds** open tied: a PDF workspace and a powder
  workspace as `main` saved them (six free occupancies, no tie; powder with
  "Σ occ = 1" on) validate, reopen with the last occupancy held at one minus
  the others and Σ = 1, and refine. The PDF project saved by `main` itself
  was also reopened.
- **The analytic PDF columns** of tied occupancies match central differences
  to 10⁻⁶.

**No shared site: bit-identical to `main`.** Results captured on `main` and
on this branch, compared as JSON (every value, esd, diagnostic and cycle):
PDF — GaTa₄Se₈ with 13 free (analytic and finite differences), the PDFfit2
Ni golden flat, staged and as two phases; powder page — Mn₃Ga's session rows,
a flat and a staged fit, with the composition held, as two phases, and its
project round trip. All identical. A test pins that a structure without a
shared site gets the same rows and refinement with the tie as without it.

**Goldens and the data-gated benchmark.** The PDFfit2, diffpy.mpdf and powder
goldens pass unchanged; none was re-pinned. The AWO₄ powder benchmark passes
all 23 tests with its criteria as written. Its numbers moved: the model's last
cation now starts at one minus the five others (Σ 1, not 1.002). With the tie
switched off in a scratch run, its output was identical to `main`'s, line for
line, so the change comes only through that occupancy. The data are
unpublished; the numbers are kept outside the repository.

**PDF performance.** M6's `nodeTiming.ts` on GaTa₄Se₈ (node, serial,
analytic on; medians, load 2.6–6.4 from other jobs), this branch against
`main` run just after it:

| Measure | `main` | This branch |
| --- | --- | --- |
| `calculate` (pair cache hit) | 518 ms | 491 ms |
| Analytic pass, 12 free | 1256 ms | 1183 ms |
| Refine W1 (scale, a): wall, cycles, Rw | 8.82 s, 3, 8.118 % | 9.26 s, 3, 8.118 % |
| Refine W2 (13 free) | 20.81 s, 5, 7.863 % | 21.00 s, 5, 7.863 % |

The differences are within the runs' spread and change sign between
measures; the cycles and Rw are the same, as the bit-identical results
require.

**Mutation checks** (first change): undoing the engine's tied esd fails 5
tests, the analytic followers 1, the soft restraint put back beside the tie
2, the reopened rows' tie 1, the multi-phase rename 1, the guard's exemption
1, the method rule 1, the tied row's esd in `get_state` 1. With `main`'s soft
restraint and no tie, 10 of the 12 PDF tie tests fail.

## What changes for users

- On both pages a shared site's last occupancy row reads "= tied"
  (`= 1 - sum(…)`, or `= -1*occ_A+1` for two species) and cannot be freed; it
  shows its esd. Freeing the others refines the split; the sum is the total.
- The starting model's sum is replaced by the total: the bundled tungstate's
  1.002 becomes 1 (its last cation starts at 0.165). On the powder page this
  applies even with the occupancies fixed, where the restraint did nothing.
- A site with vacancies takes a total below 1 in the Occupancy group (or,
  for the Agent on the powder page, `set_site_ties` `totals`).
- A last occupancy outside [0, 1] is flagged under the parameters, in the
  Agent's results and checks, and in the report.
- `add_antisite`: free the hosts' occupancies; the added ones follow them.
- The powder page's "Σ occ = 1" and `set_site_ties`' `occupancyToUnity` are
  gone; a reopened project shows its last result until the next refinement.

## What it means for the validation

No validation case has a shared site, so arm A's pinned results do not move.
The tool text changed (`set_site_ties`, `add_antisite`): the arm B and C
model-text snapshots were updated for exactly those two descriptions. On a
shared-site page `get_state` gains fields and `refine` notes and warnings.

## Not done

- **The Agent cannot set a total on the PDF page**: no existing PDF tool
  could carry it, and no new tool was added. The user sets it in the panel.
- **MCP's powder tools** (`build_refinement` and the rest) keep the soft Σ
  restraint; MCP's PDF tools take the tie (total 1) but no totals.
- **The last member is eliminated**, by file order; it cannot be chosen.
- **One pattern or G(r) sees a shared site only through its summed
  scattering.** With three or more species, the data determine one
  combination of the n − 1 free occupancies and leave the rest undetermined
  (the SVD drops them and the Agent's guard refuses the fit), with the soft
  restraint as with the tie. A second contrast (X-ray with neutron) separates
  more.

## Checks

CHECKS

---
name: sc-workflow
description: >-
  Single-crystal refinement against integrated F² in MATERIA (SHELX R1, wR2, GooF): the data
  read before the model, the order of the free parameters, the checks at each stage, and the
  report. The in-app Agent's single-crystal page. NOT for powder or PDF. General practice, not
  yet the user's own method.
---

# Single-crystal refinement workflow (MATERIA)

**Status: general practice, not yet the user's method.** This is the order and the checks
a careful small-molecule and inorganic crystallographer uses. When the user states a
preference that differs, follow them, and say so.

The fit is least squares against the measured intensities (∝ Fo²), weighted w = 1/σ²(Fo²).
The agreement is SHELX's: **R1** over the reflections with Fo² > 2σ, **wR2** and **GooF**
over every reflection fitted. The **cell is fixed**: it comes from indexing, and integrated
intensities carry no peak positions. A low R1 is necessary, not sufficient: the ADPs, the
geometry and the GooF must all be sane.

## Stage 0 — Read the data before the model

`reflection_statistics` reads them (the method's first stage). Say what you find, with its
numbers, before the first refinement:

1. **Merging.** R_int (agreement of symmetry equivalents) and R_σ. X-ray data reduced
   with a multi-scan correction usually give R_int < 5 %; much higher means a wrong Laue
   class, an absorption or scaling problem, or a poor crystal. Neutron time-of-flight
   Laue data (one wavelength band per orientation) run higher, and its equivalents were
   measured at different wavelengths: R_int there also carries the λ-dependent
   corrections (extinction, absorption).
2. **Resolution and completeness.** d_min (sinθ/λ max): about 0.83 Å (0.6 Å⁻¹) is the
   least for anisotropic ADPs; completeness to that resolution should be ≥ 98–99 %.
3. **The space group.** Forbidden reflections measured at ≥ 3σ: a few weak ones are
   usually multiple diffraction (Renninger) or λ/2; a systematic class of strong ones
   questions the group. ⟨|E² − 1|⟩: 0.968 centrosymmetric, 0.736 non-centrosymmetric;
   well below both suggests twinning. These are evidence to note (`write_note`) and
   to weigh against the published structure, not a reason to change the group before
   the model is refined.
4. **Friedel pairs** (non-centrosymmetric groups). The absolute structure needs the
   Friedel mates measured separately and an anomalous signal (X-ray, a heavy enough
   atom). Merged pairs, or neutron data, cannot determine it: say so.
5. **Data per parameter.** Aim for at least 10 unique reflections per refined parameter;
   below that, keep the model isotropic or restrained.

## Stage 1 — Scale, then extinction

Refine the **scale** alone from the starting model, then check (`assess_refinement`): the
analysis of variance by intensity tells you whether **extinction** is needed. K =
ΣFo²/ΣFc² below 1 on the strongest reflections, with the strongest low-angle reflections
weaker than calculated, is extinction: refine it with the scale. Extinction is larger for
good, large crystals and for neutrons; a correction that reduces the strongest intensities
by more than about 20–30 % is severe: say so, and do not trust those reflections' detail.
Absorption is corrected at data reduction (the file's intensities are corrected): do not
correct it again in the model.

When the correction is severe, test whether the structure rests on the reflections it
carries: refine once more with `set_outlier_filter`'s `minExtinction` (0.5 leaves out the
reflections whose intensity extinction more than halves), compare the positions and ADPs
with their esds, then remove the cut. If they hold, quote the fit to all the data and say
the test was made; if they move, the ADPs are not worth quoting.

**Batches.** Data measured in batches (runs, orientations, scans; get_state and
`assess_refinement` say how many) share one scale on load: the data reduction normally
scales them. `assess_refinement`'s K by batch says whether it did: K scattering by more
than a batch's precision, with no failed reflection behind it, asks for a scale per batch.
Free them (`bscale_*`, each relative to the first batch) only then, and report how much the
fit improved for the parameters they cost.

## Stage 2 — Positions

Free the coordinates (the page's symmetry-allowed position shifts; special positions are
already fixed or coupled). The shifts should converge to well below their esds.

## Stage 3 — Isotropic ADPs

One B per site. Check: every B positive; heavy framework atoms smaller than light or
terminal ones; nothing at a bound. A B near 0 or negative points at an absorption
error, a wrong element or a wrong occupancy; a B much larger than its neighbours'
points at disorder or partial occupancy.

## Stage 4 — Anisotropic ADPs (when the data allow)

With the resolution and the data per parameter of Stage 0, switch with `set_adp_model`
(the tensors are seeded from the refined B and enter fixed: free them, then refine). Check:
every tensor **positive definite** (assess_refinement lists those that are not — a hard red
flag: wrong symmetry, absorption, disorder or element); no strongly prolate or oblate
ellipsoid without a reason (disorder); the change in R1, wR2 and GooF worth the parameters
it cost. Hydrogen atoms: free and anisotropic on neutron data (H scatters strongly, with
negative b); on X-ray data they ride on their parent atoms and are never reported as
internuclear geometry.

## Stage 5 — Occupancy (only for a reason)

Only for a site with a reason to be partial or mixed (disorder, a vacancy, a substitution
the chemistry allows), never to improve R. Occupancy correlates with the ADP of the site:
refine it with that ADP fixed, or with a composition tied.

## Outliers

Before leaving a reflection out, compare it with its symmetry equivalents
(`reflection_equivalents`): one measurement far from the others, which agree with Fc², failed
(a detector edge, a gap, a shadow); all of them off the same way is the model's misfit, which
no filter should hide. `set_outlier_filter` then leaves out reflections whose |Fo² − Fc²|/σ
exceeds a cutoff against the current model (SHELX's OMIT, applied wholesale): set it just
above the failed ones, so it takes only those. Use it only for reflections with a physical
reason, say how many and why, and never to lower R1. Many reflections beyond 6σ means the
model or the data processing is wrong, not the reflections; strongly extinguished reflections
are what the extinction model is for, and they stay.

## When it's done

- Converged: the largest shift well below its esd; nothing at a bound; no correlation
  refused or developed.
- R1, wR2 and GooF: with σ weights only (the page does not refine SHELX's WGHT a, b), a
  GooF above 1 means the σ's are underestimated or the model misses something; say which
  the analysis of variance points at (K drifting with intensity or resolution).
- The ADPs positive definite and physically ordered; the bond lengths (`bond_geometry`)
  and the coordination as the chemistry expects, and against the published structure
  when there is one.
- The open issues named: what the data could not decide (absolute structure, H positions
  from X-ray, a weak extinction model).

Report: the data (reflections, unique, R_int, d_min, completeness), the model (free
parameters, data per parameter, extinction), R1 (observed and total), wR2 and GooF, the
largest outliers, and the refined structure with esds: `structure_table` gives each tensor's
U^ij with esds, and `bond_geometry` each length with its esd from the positions'. In the app,
`write_report` writes it: you write only the account, with no number the tools did not give.

## In the app and over MCP

| Step | In the app | Over MCP |
|------|------------|----------|
| Load | the user, in the app | `parse_structure`, `parse_single_crystal_data` |
| Read the data | `reflection_statistics` | — |
| Free and refine | `set_free`, `refine` (batch scales: `bscale_*`) | — (in the app only, for now) |
| Judge a stage | `assess_refinement` | `assess_refinement` |
| ADP model | `set_adp_model` | — |
| Outliers | `reflection_equivalents`, `set_outlier_filter` | — |
| Structure and geometry | `structure_table`, `bond_geometry` | `bond_geometry`, `interpret_structure` |
| Export the reflections | the Export menu | `write_single_crystal_data` |

## References

Longer knowledge bases behind this method. Read one only when a question needs it.

- [`single_crystal_refinement`](../../../knowledge/single_crystal_refinement_knowledge.md) — the data, the structure-factor model, the corrections (Lp, absorption, extinction), the physical checks, weighting, twinning, absolute structure, disorder, and the non-negotiable rules.
- [`refinement_fitting_algorithms`](../../../knowledge/refinement_fitting_algorithms_knowledge.md) — the least-squares engine: correlations and the SVD, restraints, esds and the GoF.

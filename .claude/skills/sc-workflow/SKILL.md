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

The fit is least squares against the measured intensities (∝ Fo²), weighted w = 1/σ²(Fo²)
until SHELXL's weighting scheme is set, last (Stage 6). The agreement is SHELX's: **R1** over the reflections with Fo² > 2σ, **wR2** and **GooF**
over every reflection fitted. The **cell is fixed**: it comes from indexing, and integrated
intensities carry no peak positions. A low R1 is necessary, not sufficient: the ADPs, the
geometry and the GooF must all be sane.

## Stage 0 — Read the data before the model

**The radiation first.** A SHELX `.hkl` or `.fcf` carries no radiation: it loads as neutron at
1.54 Å, and get_state says so. When the user gives the probe and wavelength (Mo Kα 0.71073 Å,
Cu Kα 1.54184 Å), set them with `set_radiation` before anything else: X-ray against neutron
changes every Fc, the wavelength enters the extinction, and at a tabulated line (Cr–In Kα) the
atoms' anomalous scattering f′, f″ (get_state's `anomalousScattering`). When neither the file
nor the user says, ask. A SHELXL CIF that carries its own measurement (`_shelx_hkl_file`) loads
as that measurement, at the radiation the CIF names.

`reflection_statistics` reads the data (the method's first stage). Say what you find, with its
numbers, before the first refinement:

1. **Merging.** R_int (agreement of symmetry equivalents) and R_σ. X-ray data reduced
   with a multi-scan correction usually give R_int < 5 %; much higher means a wrong Laue
   class, an absorption or scaling problem, or a poor crystal. Neutron time-of-flight
   Laue data (one wavelength band per orientation) run higher, and its equivalents were
   measured at different wavelengths: R_int there also carries the λ-dependent
   corrections (extinction, absorption). Monochromatic data holding every equivalent (a
   SHELX `.hkl`, a CIF's own measurement) are merged before they are refined, as SHELXL
   merges them (MERG 2): `merge_equivalents`, after this reading and before the first
   refinement. The Friedel opposites stay apart in a non-centrosymmetric group, the
   systematic absences are left out, and R1, wR2 and GooF are then SHELXL's; the data
   reading keeps the measurement as loaded. Never merge a time-of-flight Laue file.
2. **Resolution and completeness.** d_min (sinθ/λ max): about 0.83 Å (0.6 Å⁻¹) is the
   least for anisotropic ADPs; completeness to that resolution should be ≥ 98–99 %.
3. **The space group.** Forbidden reflections measured at ≥ 3σ: a few weak ones are
   usually multiple diffraction (Renninger) or λ/2; a systematic class of strong ones
   questions the group. ⟨|E² − 1|⟩: 0.968 centrosymmetric, 0.736 non-centrosymmetric;
   well below both suggests twinning. These are evidence to note (`write_note`) and
   to weigh against the published structure, not a reason to change the group before
   the model is refined.
4. **Friedel pairs** (non-centrosymmetric groups). The absolute structure needs the
   Friedel mates measured separately and an anomalous signal (X-ray at a tabulated line,
   a heavy enough atom). Merged pairs, or neutron data, cannot determine it: say so.
   When it can be determined, refine the inversion twin (`set_twin`, law "inversion")
   from the first refinement on, with the scale and then the structure, as SHELXL
   refines BASF: its fraction is the Flack x. x near 0 with a small esd (≲ 0.04):
   the hand is right; near 1: the inverted hand (invert the model); clearly between: the
   crystal is an inversion twin, and the report says so with x and its esd.
5. **Data per parameter.** Aim for at least 10 reflections per refined parameter (8 in a
   non-centrosymmetric group, where a Friedel pair measured apart counts twice, as SHELXL
   counts its data); below that, keep the model isotropic or restrained.
6. **Where the Fo² come from.** A refinement's listing (a SHELXL `.fcf`; get_state's `origin`)
   holds each reflection once, on that refinement's scale, with the systematic absences left
   out and, in LIST 4, its extinction divided out. Its R_int, absences and extinction cannot
   be judged: say so, quote no R_int, and compare R1 with that refinement's own, not with
   data you measured.

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

**The extinction model.** SHELXL's EXTI is an empirical formula. Where the extinction is
severe (y well below 0.5) and the strongest low-angle reflections are what remains in the
residual (the lowest resolution shell's GooF well above the rest), try Becker–Coppens
(`set_extinction_model`): type I, where the mosaic spread limits the extinction, is the
usual choice for a neutron crystal (Lorentzian or Gaussian mosaic; GSAS-II's tutorials use
type I Lorentzian); type II, where the domain size does, for small perfect domains. Its
parameter restarts at 0: refine it with the scale and everything free before, to
convergence, and compare wR2, GooF and the lowest shell with the model before.

Judge the models by the ADPs too, since the scale, the extinction and the ADPs trade off:
refine once on the high-order reflections alone (`set_resolution_range` with dMax 0.5–0.6 Å,
where extinction barely reaches), and compare their ADPs with the all-data ones. The model
whose all-data ADPs agree with the high-order ones, and whose parameter stays about the same
over both ranges, describes the crystal; one whose ADPs move by several esds biases them. Put
the full range back before the final refinement, keep the model that passes, and report the
test with the numbers.

**Batches.** Data measured in batches (runs, orientations, scans; get_state and
`assess_refinement` say how many) share one scale on load: the data reduction normally
scales them. `assess_refinement`'s K by batch says whether it did: K scattering by more
than a batch's precision, with no failed reflection behind it, asks for a scale per batch.
Free them (`bscale_*`, each relative to the first batch) only then, and report how much the
fit improved for the parameters they cost.

## Stage 2 — Positions, the hydrogens riding

Free the coordinates (the page's symmetry-allowed position shifts; special positions are
already fixed or coupled). The shifts should converge to well below their esds.

**Hydrogens on X-ray data ride** before the positions are refined: X-rays see a hydrogen's one
electron, displaced into its bond, so a free hydrogen comes out short and scattered and its U
undefined. `set_riding_hydrogens` (SHELXL's AFIX) places each in its group's geometry: an sp²
X–H on the external bisector of its parent's two neighbours (AFIX 43); a methyl's three (or an
NH₃'s) tetrahedral about the X–C axis and rotating, the group's torsion a parameter (`rot_C1`,
AFIX 137) to free with the positions; a hydroxyl's likewise (AFIX 147); a CH₂ pair (AFIX 23); a
tertiary C–H (AFIX 13); a metal's hydrogen, or any other, at its present offset (AFIX 3). U_iso
is 1.2·U_eq of the parent (1.5 for methyl and hydroxyl). Give `temperature` (the measurement's,
in K) and each group sits at SHELXL's X–H for it (C–H 0.93–0.98 Å at room temperature, +0.02 Å
below 203 K); the result lists each X–H as placed. A hydrogen the data place on their own — a
hydride beside a metal, a hydrogen-bonded OH found in the difference map — goes in `refine`:
its position refines, its U still rides, and distance restraints (below) keep it chemically
sensible. Report the treatment. On **neutron** data the hydrogens scatter as strongly as
carbon: refine them freely, anisotropic where the data allow.

**Restraints.** `restrain_distances` adds SHELXL's DFIX (a distance near a target) and SADI
(distances near one another), each with an esd (0.02 Å by default; tighter for chemically
equivalent bonds, e.g. SADI 0.005 on three M–H of one metal). They are observations beside the
data, counted as SHELXL counts them; `assess_refinement` lists each one's deviation in σ and
the restrained GooF. Restrain what the chemistry fixes and the data cannot place; a restraint
more than 3σ off says the data disagree with it, which is a finding, not a reason to tighten it.

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
it cost. Hydrogen atoms stay isotropic on X-ray data (the switch leaves them so) and ride;
free and anisotropic on neutron data (H scatters strongly, with negative b). X-ray hydrogen
positions are never reported as internuclear geometry.

## Stage 5 — Occupancy and disorder (only for a reason)

Only for a site with a reason to be partial or mixed (disorder, a vacancy, a substitution
the chemistry allows), never to improve R. Occupancy correlates with the ADP of the site:
refine it with that ADP fixed, or with a composition tied.

**A disorder** (get_state's `disorder`: SHELXL's PART 1 and PART 2 of an assembly, as the CIF
gives them; no bond joins two alternatives). Tie the alternatives' occupancies to add up to one
(`tie_parameters` `complement`, SHELXL's 21 and −21), and, when the alternatives sit too close
for the data to separate their displacements (a few tenths of an Å), give the second the first's
ADP (`adp`, SHELXL's EADP); then free the leading occupancy with the rest and report the split
with its esd. The contrast between the alternatives (Al against Ga, a heavy against a light
atom, or the positions themselves) is what measures it.

## Stage 6 — The weights, last

SHELXL weights a finished refinement with WGHT a b: w = 1/[σ²(Fo²) + (aP)² + bP], P = (Fo² +
2Fc²)/3, for the errors the σ do not carry (absorption, scaling, what no model describes). Its a
and b are on SHELXL's absolute scale (Fo² divided by the scale); the page applies them at the
data's own scale, so a published WGHT is set as printed.
`assess_refinement` gives the scheme SHELXL would suggest for the model as it stands: the a and
b that make the GooF flat across the intensity bins and 1 overall. Set it with
`set_weighting` (use "suggested") only once the model is complete — ADPs, extinction,
hydrogens, outliers — since weights fitted to an unfinished model hide its errors; then refine
once more and quote R1, wR2 and GooF with the scheme. wR2 and GooF depend on it, R1 does not.
With σ that already describe the data the suggestion stays near 0 0.

## Outliers

Before leaving a reflection out, compare it with its symmetry equivalents: one measurement
far from the others, which fit, failed (a detector edge, a gap, a shadow); all of them off the
same way is the model's misfit, which nothing should hide. `assess_refinement` gives each
listed outlier its equivalents' reading; `reflection_equivalents` shows a whole family.

Leave a failed measurement out by itself, with `omit_reflections` (SHELXL's OMIT h k l): by its
indices and batch, with the reason, which goes into the report. One failed measurement with a
small σ drags the whole fit, so after omitting it refine and read the outliers again: a second
failure often shows only then, and one batch or one detector can hold several. Do not use a σ
cutoff for this: set just above the next worst it leaves a failure that sits inside the misfit
of the strongest reflections. `set_outlier_filter`'s cutoff is SHELX's wholesale OMIT, for a
physical reason that touches many reflections at once; say how many it takes and why, and never
use it to lower R1. Many reflections beyond 6σ means the model or the data processing is wrong,
not the reflections; strongly extinguished reflections are what the extinction model is for,
and they stay.

## When it's done

- Converged: the largest shift well below its esd; nothing at a bound; no correlation
  refused or developed.
- R1, wR2 and GooF with the weights stated: with w = 1/σ², a GooF above 1 means the σ are
  underestimated or the model misses something (say which the analysis of variance points at:
  K drifting with intensity or resolution); with SHELXL's suggested scheme, set last, the GooF
  is near 1 by construction and the analysis of variance is what still tells.
- The ADPs positive definite and physically ordered; the bond lengths (`bond_geometry`)
  and the coordination as the chemistry expects, and against the published structure
  when there is one.
- The open issues named: what the data could not decide (absolute structure, H positions
  from X-ray, a weak extinction model).

Report: the data (reflections, unique, R_int, d_min, completeness; or that they are a
refinement's listing), the model (free parameters, data per parameter, extinction, the
hydrogen treatment, the weights), R1 (observed and total), wR2 and GooF, the
largest outliers, and the refined structure with esds: `structure_table` gives each tensor's
U^ij with esds, and `bond_geometry` each length with its esd from the positions'. In the app,
`write_report` writes it: you write only the account, with no number the tools did not give.

## In the app and over MCP

| Step | In the app | Over MCP |
|------|------------|----------|
| Load | the user, in the app | `parse_structure`, `parse_single_crystal_data` |
| Radiation and wavelength | `set_radiation` | — |
| Read the data | `reflection_statistics` | — |
| Merge the equivalents | `merge_equivalents` | — |
| Absolute structure, twins | `set_twin` | — |
| Free and refine | `set_free`, `refine` (batch scales: `bscale_*`) | — (in the app only, for now) |
| Judge a stage | `assess_refinement` | `assess_refinement` |
| ADP model | `set_adp_model` | — |
| Hydrogens | `set_riding_hydrogens` | — |
| Restraints | `restrain_distances` | — |
| Disorder, equal values | `tie_parameters` (`complement`, `adp`, `equal`) | — |
| Weights | `set_weighting` (the suggestion in `assess_refinement`) | — |
| Extinction model | `set_extinction_model`, `set_resolution_range` (high-order test) | — |
| Outliers | `assess_refinement`, `reflection_equivalents`, `omit_reflections`, `set_outlier_filter` | — |
| Structure and geometry | `structure_table`, `bond_geometry` | `bond_geometry`, `interpret_structure` |
| Export the reflections | the Export menu | `write_single_crystal_data` |

## References

Longer knowledge bases behind this method. Read one only when a question needs it.

- [`single_crystal_refinement`](../../../knowledge/single_crystal_refinement_knowledge.md) — the data, the structure-factor model, the corrections (Lp, absorption, extinction), the physical checks, weighting, twinning, absolute structure, disorder, and the non-negotiable rules.
- [`refinement_fitting_algorithms`](../../../knowledge/refinement_fitting_algorithms_knowledge.md) — the least-squares engine: correlations and the SVD, restraints, esds and the GoF.

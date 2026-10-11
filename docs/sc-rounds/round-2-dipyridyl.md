# Single-crystal round 2: dipyridyl disulfide, Mo Kα, against SHELXL

The in-app Agent refined di-2-pyridyl disulfide on the single-crystal page
against SHELXL's own refinement listing, and was asked whether the app
reproduces SHELXL's result. I played an experienced small-molecule
crystallographer who reads every number. The model was served through a local
relay standing in for LM Studio, on a production build of the app. Every tool
call ran in the app, and every number below is the app's unless it is marked
as SHELXL's.

## The data

| | |
| --- | --- |
| Source | GSAS-II tutorial "CFXraySingleCrystal": `S2dipyridyl.cif` (SHELXL's final model) and `S2dipyridyl.fcf` (SHELXL's LIST 4 listing) |
| Measurement | Bruker APEX-II CCD, Mo Kα (λ 0.71073 Å), 173 K; crystal 0.45 × 0.21 × 0.09 mm, μ 0.489 mm⁻¹; 22851 reflections measured, R_int 2.96 % (from the CIF: the listing cannot show it) |
| Reflections | 4508 unique to d_min 0.773 Å (sinθ/λ 0.65 Å⁻¹), 99.78 % complete; 3950 with Fo² > 2σ by SHELXL's count |
| Structure | C₁₀H₈N₂S₂, P2₁/c, a 15.8489, b 5.5008, c 23.118 Å, β 96.916°, Z = 8 (two molecules in the asymmetric unit): 28 non-hydrogen atoms anisotropic, 16 hydrogens riding (AFIX 43) |
| SHELXL's refinement | 254 parameters, EXTI 0.0151(6), WGHT 0.0362 0.7686: R1 2.86 %, wR2 7.86 %, GooF 1.041 |

## The ask

"These are Mo Kα data (λ 0.71073 Å, 173 K) of dipyridyl disulfide: SHELXL's
own .fcf, with its CIF as the starting model. Refine it as SHELXL would — the
hydrogens treated as a crystallographer treats them on X-ray data, the weights
last — and tell me whether this app reproduces SHELXL's R1 2.86 %, wR2 7.86 %
and GooF 1.041 (WGHT 0.0362 0.7686, 254 parameters). Write the report when you
are done."

A first session (before this round's work) found the gaps in the table below,
rows 1–5; the tools were built, and the live re-runs found rows 6–17. The
session below is the last one, on the final build.

## What the Agent did

| Step | What | R1 % | wR2 % | GooF |
| --- | --- | --- | --- | --- |
| 1 | Read the method and the data. The page reads the file as neutrons at 1.54 Å (a SHELX file carries no radiation). 4508 reflections, each once: the Agent calls them SHELXL's listing and quotes R_int from the CIF, not from the file. ⟨\|E² − 1\|⟩ 1.12: centrosymmetric | 67.39 | 505.6 | 194.2 |
| 2 | X-rays at 0.71073 Å (`set_radiation`): the scale restarts from its best value | | 6.15 | |
| 3 | The 16 hydrogens ride (`set_riding_hydrogens`): 16 sp² C–H on the bisector (AFIX 43) at 0.949–0.951 Å, U_iso 1.2·U_eq; 64 parameters leave the fit (318 → 254) | | | |
| 4 | Scale and extinction. y reaches only 0.945 at 4 0 0: the listing's Fo² already have SHELXL's extinction divided out | 2.85 | 6.15 | 2.36 |
| 5 | The 254 parameters SHELXL refined: converged in 13 cycles (largest shift 0.05 esd), with w = 1/σ² | 2.92 | 5.94 | 2.35 |
| 6 | SHELXL's WGHT 0.0362 0.7686 (`set_weighting`), last; refined, the weights re-evaluated at the fit's Fc² three times, 27 cycles in all. GooF 0.89–1.04 across the intensity bins | 2.76 | 7.61 | 1.008 |
| 7 | The disulfide bridges (`bond_geometry` with `atoms`): S1A–S2A 2.0222(5), S1B–S2B 2.0165(5), S–C 1.7845(12)–1.7880(12) Å | | | |
| 8 | Every site against SHELXL's structure as loaded (`structure_table`, `against: "loaded"`): no shift beyond 0.0008 Å (0.6 esd); U_eq ratio 0.984–1.020; only the four S atoms beyond 2 esd, all −4.3 to −4.5 esd | | | |
| 9 | Report (`write_report`): 10 checks, no open issue, no unverified number; the covalent bond table with esds, the riding treatment, the weights | | | |

### Against SHELXL

| | This app | SHELXL |
| --- | --- | --- |
| R1 (Fo² > 2σ) | 2.76 % (3949) | 2.86 % (3950) |
| wR2 | 7.61 % | 7.86 % |
| GooF | 1.008 | 1.041 |
| Parameters | 254 | 254 |
| S1A–S2A, S1B–S2B | 2.0222(5), 2.0165(5) Å | 2.0222(5), 2.0165(5) Å |
| S2A–C7A | 1.7845(12) Å | 1.7846(13) Å |
| N1A x, y, z | 0.41020(7), 0.7497(2), 0.05416(5) | 0.41020(8), 0.7497(2), 0.05416(5) |
| U_eq S1A, S2A | 0.02744(10), 0.02848(10) Å² | 0.02788(10), 0.02893(10) Å² |
| Suggested weights | WGHT 0.0329 0.8611 | WGHT 0.0362 0.7686 |

The geometry is SHELXL's to the last digit. Two differences remain, both
understood. The sulfur atoms' U_eq are 1.5 % smaller (4.3–4.5 esd): SHELXL
includes sulfur's anomalous scattering (f′ = 0.125, f″ = 0.124 e at Mo Kα),
and without it the fit makes the sulfur atoms sharper to give them the
scattering the missing f′ would. R1 and wR2 come out a little lower than
SHELXL's because the listing's Fo² are SHELXL's corrected intensities (its
extinction divided out), which is not the objective SHELXL minimized on the
measured ones. With the same weights, the GooF agrees to 3 %.

The weakest bin's K = ΣFo²/ΣFc² is 1.33 here; in SHELXL's own listing it is
1.32, so it is in the data (the weakest intensities), not in this model.

## The critique: what was wrong, and what was done about it

| # | Found | Fixed or built | Eval |
| --- | --- | --- | --- |
| 1 | A SHELX `.fcf` loads as neutrons at 1.54 Å, and nothing could say Mo Kα: X-ray data fitted with scattering lengths until the probe was toggled, and the wavelength never | `set_radiation` and the page's λ box; the scale restarts from its best value under the new physics | `sc-radiation-first` |
| 2 | The page showed R_int 0 % for a listing that holds each reflection once, and nothing said the file was a refinement's listing (merged, on that refinement's scale, its absences left out and its extinction divided out) | A `.fcf` with calculated columns is marked a refinement's listing; R_int reads "n/a (merged)"; get_state, the statistics, the data card and the report say what cannot be judged from it | `sc-listing-honesty` |
| 3 | No riding model: the 16 hydrogens refined freely against X-ray data, and the anisotropic switch gave each its own tensor | `set_riding_hydrogens` (SHELXL's AFIX 43 and AFIX 3, U_iso 1.2 or 1.5·U_eq, the distances reported, odd ones named, `distance` to idealize); hydrogens stay isotropic at the switch; a note when X-ray hydrogens refine freely; saved with the project; marked in `structure_table`; stated in the report | `sc-riding-hydrogens` |
| 4 | Weights 1/σ² only: GooF 2.35 against SHELXL's 1.041, and wR2 not comparable | SHELXL's WGHT a b (`set_weighting`, the page's WGHT with "suggest"), re-evaluated at the fit's Fc²; SHELXL's suggestion in `assess_refinement`; the scheme in the report | `sc-weighting-last` |
| 5 | The 253-parameter anisotropic refinement took 23 minutes (finite differences, two structure-factor evaluations per parameter) | A structure-factor kernel with analytic derivatives for every structural parameter: 16.5 s | — |
| 6 | Live: `set_riding_hydrogens` answered "no hydrogen rides" after riding them — it read the page through the port it was given, which in the app is the render before the change | The handler computes what the page did from the state before it; the test host now hands out render snapshots as the app does | (unit tests) |
| 7 | Live: the 254-parameter refinement from SHELXL's own model stalled at 0.16 esd per cycle and was called "poor, provisional" | Exact riding derivatives: an sp² hydrogen turns with the bisector when its carbon or the carbon's neighbours move (SHELXL keeps the parent's translation only) | (unit test) |
| 8 | Live: "out of the method's order: anisotropic before isotropic ADPs" for a model loaded anisotropic, and the isotropic stage left open in the checklist and the report | A stage the model has no parameter for is passed once a later stage is refined | (unit test) |
| 9 | Live: "converged after 1 iteration(s)" beside 27 cycles in the refinement's history | The message counts every cycle of a re-weighted refinement | (unit test) |
| 10 | Live: `bond_geometry` returned the 40 shortest bonds and said nothing: the S–S and S–C bonds were not among them | `atoms` lists the bonds to named sites; a cut list says so | (unit test) |
| 11 | Live: a riding C–H bond carried an esd, 0.94917(1) | Marked as set by the constraint, no esd | (unit test) |
| 12 | Live: `assess_refinement` and the report called negative U12 and U23 "unphysical displacement parameters" and listed six as open issues | Only a diagonal term, and the tensor's positive definiteness, are judged | (unit test) |
| 13 | Live: the report's bond table was the inorganic one, each cation's shell to anions with N and S counted as anions: for this molecule, every carbon's N and S contacts and no C–C bond | For a structure with carbon, the covalent bonds with esds, as SHELXL's `_geom_bond` | (unit test) |
| 14 | Live: the report's B_eq was a third of the trace, wrong in this monoclinic cell | The full U_eq, as `structure_table` and the CIF already had | (unit test) |
| 15 | Live: the report's audit flagged the S–S lengths from `bond_geometry` and SHELXL's wR2 from the user as the Agent's own numbers | The report's bond table vouches for the lengths; numbers the user gave may be quoted | (unit test) |
| 16 | Live: no tool compared the refined structure with the one loaded, so "does it reproduce SHELXL?" had no answer in esds | `structure_table` with `against: "loaded"` | (unit test) |
| 17 | Live: the λ and WGHT boxes cut their values (0.7107, 0.036) | Widened | — |

## Open

- **No anomalous scattering.** The sulfur atoms' U_eq are 1.5 % low for want
  of f′ and f″; an absolute structure cannot be refined at all. Round 3 (1b,
  P2₁2₁2₁, an inversion twin with Flack 0.435(15)) needs both.
- **Only aromatic C–H is idealized.** Methyl, methylene and hydroxyl hydrogens
  ride at their present offset (AFIX 3); SHELXL's AFIX 137, 23 and 147
  re-idealize them.
- **The suggested weights** bin by Fc² only; SHELXL also weighs the
  resolution shells, and suggests 0.0362 0.7686 where the app suggests
  0.0329 0.8611.
- **A listing is not a measurement.** The real test of the extinction, the
  absences and the outliers (4 2 6, −5 1 5 and 2 1 10 near −20σ) needs the
  `.hkl`, which this tutorial does not give.

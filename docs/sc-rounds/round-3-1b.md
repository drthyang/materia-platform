# Single-crystal round 3: 1b, a Ga/Al hydride, Mo Kα, against SHELXL

The in-app Agent refined 1b on the single-crystal page, a gallium–aluminium
hydride from the GSAS-II tutorials, against the measurement SHELXL's own CIF
carries. The user asked whether the app reproduces SHELXL's refinement. I played an
experienced small-molecule crystallographer who reads every number. The
model was served through a local relay standing in for LM Studio, on a
production build of the app. Every tool call ran in the app, and every number
below is the app's unless it is marked as SHELXL's.

## The data

| | |
| --- | --- |
| Source | GSAS-II tutorial "CFXraySingleCrystal": `1b.cif`, SHELXL's final model with its .res and its measurement embedded (`_shelx_res_file`, `_shelx_hkl_file`), and `1b.fcf`, SHELXL's LIST 4 listing (Luo et al., the Bruker–MIT workshop) |
| Measurement | Mo Kα (λ 0.71073 Å), 173 K; crystal 0.40 × 0.30 × 0.20 mm; 13169 measurements, 60 of them of the 21 systematic absences (SHELXL counts 13109 without them); R_int 2.93 % with the Friedel mates apart (3.04 % in the Laue class), R_σ 1.99 % |
| Reflections | 2482 independent to d_min 0.840 Å (sinθ/λ 0.596 Å⁻¹): the 1462 unique in the Laue class and the 1020 Bijvoet partners of the acentric ones, each Friedel pair measured; 100 % complete |
| Structure | C₈H₂₅Al₀.₈₄Ga₁.₁₆N₃, P2₁2₁2₁, a 6.2256, b 12.9136, c 17.4444 Å, Z = 4. An inversion twin; Al1 and Ga1 share a site 0.2 Å apart (PART 1 and 2, occupancies 21/−21, one ADP by EADP); 14 non-hydrogen sites anisotropic; 20 hydrogens riding (4 rotating methyls, AFIX 137; 4 CH₂, AFIX 23); five hydrides on Ga and Al refined under 8 SADI restraints, their U riding (−1.2) |
| SHELXL's refinement | 142 parameters, 8 restraints; TWIN, BASF 0.43497 (the Flack x, 0.435(15)); WGHT 0.0271 0.2580; no EXTI; MERG 2 by default: R1 2.04 % (2334 reflections with Fo > 4σ), wR2 5.04 %, GooF 1.044 |

## The ask

"1b (Luo et al., the Bruker–MIT workshop): a Ga/Al hydride,
C8H25Al0.84Ga1.16N3 in P2₁2₁2₁, Mo Kα at 173 K. The CIF is SHELXL's final
model and carries SHELXL's own .hkl, which is loaded as the data. Refine it as
SHELXL would and tell me whether this app reproduces SHELXL's R1 2.04 % (2334
reflections with Fo > 4σ), wR2 5.04 %, GooF 1.044 and Flack x 0.435(15) — 142
parameters, 8 restraints, WGHT 0.0271 0.2580. I expect the absolute structure
decided and stated, the Al/Ga disorder handled as SHELXL handles it, and the
hydrogens treated as a careful crystallographer treats them on X-ray data.
Compare the esds too. Write the report when you are done."

Before this round the page could do none of that. Rows 1–8 of the table
below are what reproducing SHELXL's refinement needed and found, before the
Agent ran: rows 1–6 by reading the data and the model, rows 7–8 by fitting
SHELXL's own. The first live session found rows 9–20, a second rows 21–33.
The session below is the last, on the final build.

## What the Agent did

| Step | What | R1 % | wR2 % | GooF |
| --- | --- | --- | --- | --- |
| 1 | Read the method and the page: SHELXL's anisotropic model, the Al1/Ga1 split untied, f′ and f″ at Mo Kα, 13169 measurements unmerged | 3.22 | 7.61 | 1.52 |
| 2 | The data (`reflection_statistics`): R_int 2.93 % with the Friedel mates apart, 3.04 % in the Laue class; 100 % complete to 0.840 Å; every acentric reflection's Friedel mate measured; 21 absences, none at 3σ; ⟨\|E² − 1\|⟩ 0.774, acentric | | | |
| 3 | Merged as SHELXL's MERG 2 (`merge_equivalents`): 2482 reflections, the Friedel opposites apart, the 21 absences (60 measurements) left out | | 6.05 | |
| 4 | The inversion twin (`set_twin`), its fraction the Flack x | | 5.51 | |
| 5 | The disorder as SHELXL's 21/−21 with EADP (`tie_parameters` `complement`, `adp`) | | | |
| 6 | The hydrogens at 173 K (`set_riding_hydrogens`): 20 ride (four rotating methyls at 0.980 Å, four CH₂ at 0.990 Å); the five hydrides refine their positions, U riding | | | |
| 7 | SHELXL's 8 SADI restraints (`restrain_distances`): the three Ga2–H equal at σ 0.005 Å, their H···H, and each alternative's two M–H | | | |
| 8 | Scale and Flack x, extinction held at 0: no method note now that the twin fraction refines with the scale | 2.04 | 4.25 | 1.89 |
| 9 | The assessment: no extinction (K 1.01 on the strongest bin), Flack x 0.446(10); the outliers agree with the measurements behind them (model misfit, nothing failed); GooF rising with intensity calls for the weights | | | |
| 10 | Positions with the methyl torsions and the restrained hydrides, 63 parameters, 9 cycles: no note | 2.04 | 4.15 | 1.87 |
| 11 | The anisotropic ADPs, 141 parameters, 6 cycles; the split site's positions and shared U correlate at −0.95 to −1.00, carried as one disorder's | 2.05 | 4.08 | 1.87 |
| 12 | The Al share (`occ_Al1`, Ga1 = 1 − Al1): SHELXL's 142 parameters | 2.05 | 4.08 | 1.87 |
| 13 | SHELXL's WGHT 0.0271 0.2580 (`set_weighting`), last; 10 cycles, the weights re-evaluated twice | 2.02 | 4.97 | 1.030 |
| 14 | The final assessment and every site against SHELXL's (`structure_table`, `against: "loaded"`) | | | |
| 15 | The bonds to the metals (`bond_geometry` with `atoms`) | | | |
| 16 | The report (`write_report`): its audit vouches for every number in the account, the esd ratio and SHELXL's suggested weights among them (the report's "Against the model loaded" and "Weights" checks carry them) | | | |

### Against SHELXL

| | This app | SHELXL |
| --- | --- | --- |
| R1 | 2.02 % (2332 Fo > 4σ) | 2.04 % (2334) |
| wR2 | 4.97 % | 5.04 % |
| GooF | 1.030 | 1.044 |
| Flack x | 0.435(11) | 0.435(15) |
| Al share | 0.844(2) | 0.844(2) |
| Parameters / restraints | 142 / 8 | 142 / 8 |
| R_int, R_σ | 2.93 %, 1.99 % | 2.93 %, 1.99 % |
| Al1–N2, Ga2–N2 | 2.025(9), 2.064(2) Å | 2.027(9), 2.064(2) Å |
| Ga2–H | 1.428–1.443 Å | 1.43(2) Å ×3 |
| Largest shift from SHELXL's model | 0.028 Å (H5′, 1.3 esd); none beyond 3 esd | — |
| U_eq | 0.982–1.019 × SHELXL's | — |
| Esds, positions and U^ij | 0.75 × SHELXL's (median; 0.61–1.00 and 0.68–0.94) | — |
| Suggested weights | WGHT 0.0265 0.3313 | WGHT 0.0271 0.2580 |

The model and its fit are SHELXL's: every site within 1.3 esd, R1 and the
Flack x the same, wR2 and GooF within 1.5 %. The largest misfits are
SHELXL's too: 2 0 1 has Fo²/Fc² 1.55 here and 1.62 in SHELXL's own listing.
3 0 1, 1 6 2 and 0 3 7 agree to about 1 % and 3 0 5 to 2 %, all
consistent among the measurements behind them. So they are in the data and
the shared model, not in this app.

The crystal is an inversion twin, 44 % of it of the inverted hand: both hands
are present, as SHELXL found, and no single absolute structure can be
assigned.

## The critique: what was wrong, and what was done about it

| # | Found | Fixed or built | Eval |
| --- | --- | --- | --- |
| 1 | X-rays had no anomalous scattering: the two members of a Friedel pair were computed equal, so the absolute structure could not be refined at all | f′ and f″ at the laboratory lines (Cr to In Kα, 96 elements) | `sc-absolute-structure` |
| 2 | No twin law and no Flack x | `set_twin`: SHELXL's TWIN and BASF, the inversion twin's fraction the Flack x, with analytic derivatives; laws that cannot twin the crystal refused | `sc-absolute-structure` |
| 3 | No disorder: no occupancy rows, no tie of the two alternatives, no shared ADP | A CIF's PART read and written; `tie_parameters` on the single-crystal page with `complement` (21/−21) and `adp` (EADP); the disorder in get_state and the report | `sc-disorder-tied` |
| 4 | Only aromatic C–H ride; methyls, CH₂ and hydrides could not be placed as SHELXL places them | SHELXL's AFIX 137, 23, 13, 147 and 3 at its temperature-dependent distances (all 20 of 1b's within 0.0001 Å of SHELXL's); a hydrogen whose position refines with its U riding (−1.2) | `sc-hydrides-restrained` |
| 5 | No distance restraints | `restrain_distances`: SHELXL's DFIX and SADI, counted as SHELXL counts them, with analytic derivatives; each restraint's deviation and the restrained GooF | `sc-hydrides-restrained` |
| 6 | The CIF's own measurement (`_shelx_hkl_file`) could not be loaded, and nothing merged equivalents: 13169 measurements would be fitted where SHELXL fits 2482 | The CIF loads as data at its radiation; `merge_equivalents`: SHELXL's MERG 2, the Friedel opposites apart, the absences out; R_int as SHELXL reports it | `sc-merge-first` |
| 7 | SHELXL's WGHT gave GooF 0.35 on unscaled data | WGHT's b term on the absolute scale (b·k·P), as SHELXL applies it | (unit test) |
| 8 | The engine's eigen-decomposition stopped after 80 Jacobi rotations: the split site's esds came out 3–5× too small, its −0.99 correlations unreported, and a refinement from SHELXL's model took 42 cycles | A complete Householder–QL decomposition: 5 cycles, the full-inverse esds, a Monte-Carlo scattering as they say | (unit tests) |
| 9 | Live: "out of the method's order" for the Flack x refined with the scale | The twin fractions are overall terms, refined with the scale: their stage follows the scale's, and an optional stage is never passed by a later one | (unit test) |
| 10 | Live: the hydrides, refined as asked under restraints, drew "refined on their own against X-ray data" | The note names hydrogens freed unasked, and those chosen with no restraint holding them | (unit test) |
| 11 | Live: every outlier of the merged fit read "no equivalent measured" | Read against the measurements behind it; one that failed inside the merge is named | (unit test) |
| 12 | Live: each shell's R_int on the merged fit read 0 | Read from the measurement | (unit test) |
| 13 | Live: the report said "10687 omitted by hand" for the merge's reduction of 13169 measurements to 2482, and left out the Friedel-apart R_int the Agent quoted (its audit flagged it) | The merge is not an omission; the Merging row gives both R_int | (unit test) |
| 14 | Live: λ printed 0.7107; the Hydrogens row said 25 ride where 5 refine; the Disorder row did not say EADP | λ to five digits; riding and refined counted apart; EADP named | (unit test) |
| 15 | Live: the riding preview counted 100 rows leaving where 85 do (a refined hydride keeps its position rows) | Only the rows that leave | (unit test) |
| 16 | Live: one disorder's −0.99 correlations were a warning to "fix one of them" | A note: they correlate by construction, and their esds carry it | (unit test) |
| 17 | Live: correlations printed −1.00 where they were −0.998 | Three decimals | (unit test) |
| 18 | Live: esds printed with a third digit (0.05602(16)) where SHELXL prints 0.0560(2) | SHELXL's rule: two digits only from 10 to 19 | (unit test) |
| 19 | Live: no tool could set the esds against SHELXL's (the CIF's su were dropped on reading) | The CIF's su read and kept; `structure_table` `against: "loaded"` gives each kind's ratio | (data-gated test) |
| 20 | Live: the History step for a tie read "Parameters tied"; `bond_geometry` listed C···H contacts among the bonds | The tie named ("occ_Ga1 = 1 − occ_Al1; EADP (6 ADP rows tied)"); bonds and contacts apart | (unit tests) |
| 21 | Re-run: R_σ 2.10 % where SHELXL's CIF has 1.99 %; one merged σ in ten up to 18 % above SHELXL's | SHELXL's merged σ: the larger of the propagated σ and Σ\|I − Ī\|/(n√(n − 1)), matched to SHELXL's listing (all 2482 within 0.1 % from the 10th to the 90th percentile); GooF 1.010 → 1.030, the Flack x 0.437(11) → 0.435(11) | (data-gated test) |
| 22 | Re-run: 10.3 reflections per parameter, where SHELXL's data count gives 17.5 | A Friedel pair measured apart counts twice in an acentric group, as SHELXL counts its data | (unit test) |
| 23 | Re-run: 1461 unique and 2481 independent, where SHELXL has 1462 and 2482 | d is rounded to 10⁻⁶ Å; the expected set's limit had a margin of 10⁻⁹, and the data's highest-angle reflection dropped out | (data-gated test) |
| 24 | Re-run: the report's data line said "2482 reflections, 1483 unique" with the Laue class's R_int; its headline tiles too | The measurements and what they became, R_int and R_σ as SHELXL reports them, the absences' 60 measurements; the tiles and the data card in SHELXL's terms for an acentric group | (unit and data-gated tests) |
| 25 | Re-run: the outliers in the file's σ under SHELXL's weights (2 0 1 at 11.4σ, which SHELXL would list near 6.4) | Ranked and given in the weights' esd, the file's σ beside it | (data-gated test) |
| 26 | Re-run: a ratio of 1.04 to its equivalents' 0.988 printed as "1" against "0.99", and a 3.4σ misfit among 3340 called a disagreement | Three digits; a misfit within √(2 ln N) σ is read as chance | (unit test) |
| 27 | Re-run: the merge note quoted the Laue class's R_int (3.04 %) for a merge that keeps the Friedel mates apart | The merge's own R_int (2.93 %), and the absences' measurements | (data-gated test) |
| 28 | Re-run: the tie note did not say EADP; the riding note and the History said "25 hydrogens ride" | Named; "20 hydrogens ride, 5 refine their positions with U riding" | (unit and data-gated tests) |
| 29 | Re-run: the report's audit flagged the esd ratio and SHELXL's suggested weights, which the Agent quoted and the report did not hold | Report checks "Weights" (the scheme beside SHELXL's suggestion) and "Against the model loaded" (shifts, U_eq, the esd ratios) | (data-gated test) |
| 30 | Re-run: the report listed a single crystal's parameters under "Scale & background" and "Peak shape, instrument & sample"; a position shift read "Ga2 x 0.00000(4)" | A single crystal's groups (scale, twin fractions, extinction, atoms, riding groups); the unit says "shift" | (unit test) |
| 31 | Re-run: Ga1's tied occupancy had its esd in the parameter table and none in the site table or the CIF; the CIF's U^ij had no su | A tied value carries its leader's esd everywhere; the U^ij su from the refined modes | (unit test) |
| 32 | Re-run: the U_eq esd ratio (1.00) set rounded su against rounded su, and our U_eq esd ignores the covariance SHELXL's includes | Ratios from the esds as computed; U_eq left out of the comparison | (data-gated test) |
| 33 | Re-run: `bond_geometry`'s shortest bond read 0.9799999999999989 Å | Rounded | — |

The four eval scenarios replay the Agent's decisions this round turned on:
merging before the first refinement, the inversion twin and its Flack x
quoted as the engine gives it, the disorder tied before it refines, and a
hydride refined only under a restraint. The live sessions made all four
correctly once the tools existed; the evals hold a model to them.

## Open

- **The esds are 0.75× SHELXL's** for positions and U^ij, uniformly, while
  the GooF agrees to 1.5 %. SHELXL refined the same 2482 reflections (its
  listing holds the Bijvoet partners apart) with the same weights, and the
  merged σ are now SHELXL's to 0.1 %. A Monte-Carlo of 40 refinements at the
  fit's weights scatters as this app's esds say, and on dipyridyl disulfide
  (round 2, centrosymmetric, untwinned) the two agree to the digit. What
  SHELXL does differently for this twinned, restrained, disordered model is
  not known without its code; FullProf or JANA2020 would be a third opinion.
- **Derived esds take the parameters as independent**: a bond's esd from its
  two atoms' positions, U_eq's from its U^ij. SHELXL uses the full covariance
  and adds the cell's esds. The result carries no covariance matrix today.
- **The suggested weights** (0.0265 0.3313 for SHELXL's 0.0271 0.2580) bin by
  Fc² only; SHELXL also weighs the resolution shells.
- **The same outliers as SHELXL's** (2 0 1 at 6.4 esd by the weights, its
  six measurements agreeing): in the data or the shared model, perhaps
  absorption, which neither refinement corrects beyond the data reduction.

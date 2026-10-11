# Single-crystal round 1: sapphire, TOPAZ time-of-flight Laue data

The in-app Agent refined α-Al₂O₃ (corundum, "sapphire") on the single-crystal
page against neutron time-of-flight Laue data. I played an experienced
single-crystal crystallographer who reads every number. The model was served
through a local relay standing in for LM Studio, on a production build of the
app. Every tool call ran in the app, and every number below is the app's.

## The data

| | |
| --- | --- |
| Source | GSAS-II tutorial "TOF Single Crystal Refinement" (`sapphire_sphere.hkl`, SNS TOPAZ, room temperature) |
| Measurement | 31 crystal orientations, each reflection at its own wavelength (0.40–3.32 Å) and 2θ (27–157°); absorption corrected in reduction (transmission 0.971–0.977) |
| Reflections | 5078 measured; 444 of the 466 unique reflections R-3c allows to d_min 0.4003 Å (completeness 95.28 %) |
| Merging | R_int 9.95 %, from 24.76 % in the lowest shell to 6–7 % at high angle |
| Start model | R-3c, a 4.7613, c 12.9846 Å; Al (0, 0, 0.352), O (−0.306, 0, ¼), U_iso 0.005 Å², as the tutorial starts |

## The asks

1. First session: "Refine this crystal structure properly and report the
   result." Then: is the structure resting on the extinguished reflections,
   and do these data need a scale per run?
2. After the fixes, a fresh session: "Refine sapphire from these TOPAZ data and
   report the structure. I care about the ADPs: tell me whether they depend on
   how the extinction is modelled, and leave out only measurements that
   failed."

## What the Agent did (second session, on the fixed build)

| Step | What | R1 % | wR2 % | GooF |
| --- | --- | --- | --- | --- |
| 1 | Read the method and the data (`reflection_statistics`): the numbers above; 20 forbidden h0l (l odd) at ≥ 3σ, about 1 % of the allowed intensity at their d, called multiple diffraction; Wilson statistics "no test" for two special sites | | | |
| 2 | Scale alone. K falls from 3.62 on the weakest bin to 1.72 on the strongest: extinction | 35.41 | 65.97 | 13.58 |
| 3 | Extinction (SHELXL EXTI) with the scale. y down to 0.085; the outliers' equivalents name two failed measurements, both in batch 24: 5 4 1 at 3 % of Fc² against 9 equivalents at 1.1, and 3 4 2 at 39 % against 16 at 1.0 | 6.92 | 19.07 | 3.93 |
| 4 | Omit those two (`omit_reflections`, by batch, with the reason) | | 16.79 | |
| 5 | Positions, then one B per site | 5.38 | 13.86 | 2.86 |
| 6 | Anisotropic ADPs. U_eq(Al) 0.00265(5), U_eq(O) 0.00308(3) Å² | 5.08 | 13.52 | 2.79 |
| 7 | Becker–Coppens type I, Lorentzian (`set_extinction_model`). Better in every shell beyond 0.81 Å, but U_eq 0.00349(5) and 0.00384(3) Å², 25–30 % higher | 4.28 | 12.08 | 2.49 |
| 8 | High order alone (`set_resolution_range`, d ≤ 0.5 Å, 2201 measurements), Becker–Coppens: U_eq 0.00342(7), 0.00373(6); Eg 0.00058(4) | 4.27 | 9.38 | 1.37 |
| 9 | High order alone, EXTI: U_eq 0.00319(7), 0.00347(5); x 0.070(5), against 0.300 from all the data | 4.34 | 9.57 | 1.40 |
| 10 | Becker–Coppens, full range | 4.28 | 12.08 | 2.49 |
| 11 | A scale per batch (K by batch scattered 3.4 %; 1.3 % after) | 4.10 | 11.35 | 2.35 |
| 12 | Report (`write_report`); its account audited clean | | | |

The Agent's reading of the extinction test (steps 8 and 9) is the round's
result. Under EXTI the all-data ADPs lie 6–7 esds below EXTI's own
high-order ADPs, and EXTI's parameter falls by a factor of four with
resolution. EXTI's angular and wavelength dependence does not describe this
Laue extinction, and the ADPs absorb the difference: they come out about
20 % small. Becker–Coppens gives the same ADPs from all the data as from the
high order alone, and its parameter holds.

### The refined structure

| Site | x | z | U11 | U22 | U33 | U12 | U13 | U23 | U_eq |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Al | 0 | 0.35217(2) | 0.00338(6) | = U11 | 0.00372(9) | 0.00169(3) | 0 | 0 | 0.00349(5) |
| O | −0.30630(3) | ¼ | 0.00362(4) | 0.00380(6) | 0.00414(6) | 0.00190(3) | 0.00027(1) | 0.00055(3) | 0.00384(3) |

U in Å². Al–O 1.85502(14) and 1.9715(2) Å, ×3 each; bond-valence sum of Al
3.06. Becker–Coppens Eg 0.000623(11), 30 batch scales relative to batch 1.

Against the GSAS-II tutorial: it refines on F, not F², with secondary type I
Lorentzian extinction (Eg 5.71(7)·10⁻⁴, tied over all runs). It leaves out
reflections with y < 0.5, Fo/σ < 3 and |ΔF|/σ > 20, and ends at Rw 4.20 % on
F. Here the fit is on F² over every measurement but the two that failed; at
the same Eg the agreement measures are not comparable, but the model agrees.
The tutorial also finds a badly measured 3 4 2 in one run and removes it.

## The critique: what was wrong, and what was done about it

| # | Found | Fixed or built | Eval |
| --- | --- | --- | --- |
| 1 | The TOPAZ file read as SHELX HKLF 4 at 1.54 Å: every reflection's own wavelength dropped, and the extinction computed at one λ (a TOF file had none at all) | SNS TOPAZ reader (λ, 2θ, path length, transmission, run per reflection), detected before SHELX; extinction at each reflection's λ and 2θ | — |
| 2 | Fc² carried a Lorentz–polarization factor on Fo² already corrected in reduction (found against SHELXL's own Fc² in the tutorial's 1b.fcf, ratio 14 → 0.9 with angle) | Fc² = k·y·\|F\|², as SHELXL, Jana, FullProf and GSAS-II (SC.0) | — |
| 3 | The statistics misread: 484 unique set beside the 466 expected (the forbidden ones counted), Wilson ⟨\|E² − 1\|⟩ read for a two-site structure, severe extinction called "not indicated" because the scale lifted every K | Allowed reflections counted; ε factor; Wilson "no test" for few or special sites; the strongest bin read against the others | `sc-data-first` |
| 4 | Switching to anisotropic ADPs moved wR2 from 14.13 to 14.48 % before anything refined: the seed U12 = 0 is not a sphere in a hexagonal cell | The metric sphere U^ij = U·cos(a*_i, a*_j); U_eq by the full formula everywhere | — |
| 5 | The equivalents' weighted mean was dragged from ≈ 1400 to 340 by the failed 5 4 1 (small σ) | Median of the family; `reflection_equivalents` | `sc-failed-reflection` |
| 6 | Bond esds changed with the direction a bond was listed in (1.85(12) for 1.8549(2)) | Sorted bond keys | — |
| 7 | With the batch scales free the refinement stopped on χ² with the extinction still moving 0.79 esd per cycle | Converged when every shift < 0.05 esd (up to 50 cycles) | — |
| 8 | The correlation guard refused scale ↔ extinction 0.99 under severe extinction | The overall intensity terms (scale, extinction, batch scales) listed, not refused | — |
| 9 | One scale for 31 runs: K by batch scattered 3.6 % | A fixed scale per batch, freed on the evidence | `sc-batch-scales` |
| 10 | The structure's dependence on the most extinguished reflections untested | The filter's extinction cut (`minExtinction`) | `sc-extinction-test` |
| 11 | The Agent left out 5 4 1 with a σ cutoff set just above the next worst, and left in the second failure of batch 24, 3 4 2 at −42σ among extinction misfits of −30 to −42σ | `omit_reflections` (OMIT h k l, by batch); every outlier read against its equivalents in `assess_refinement` and the report | `sc-failed-measurements` |
| 12 | The ADPs depended on the extinction model by 25–30 %, with no way to tell which to believe: EXTI only, no resolution limit, and a report that could not carry a test's numbers | Becker–Coppens type I/II (as GSAS-II), `set_resolution_range` (SHEL), "Refinements compared" in the report | `sc-extinction-model` |
| 13 | Live, on the new build: before the extinction was refined, the outlier reading called 1 1 6 "a failed measurement"; its equivalents, measured at other wavelengths, scatter with the unrefined extinction | The reading compares Fo²/Fc² ratios and requires the equivalents to agree among themselves and roughly with the model; a Laue regression test | (unit test) |

## Open

- The lowest resolution shell keeps GooF 5.1 under both extinction models:
  the most extinguished reflections (y down to 0.07) are beyond what an
  isotropic secondary-extinction model fits. Anisotropic extinction and
  primary extinction are not in the app.
- The weights are 1/σ² alone (no WGHT a, b), so GooF 2.35 says the σ's from
  integration are small for this model.
- Absorption is taken from data reduction (transmission 0.97); no thermal
  diffuse scattering correction.

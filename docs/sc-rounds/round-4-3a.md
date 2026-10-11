# Single-crystal round 4: 3a, Cs(C₅Me₅)·py, a merohedral twin in P6₁, against SHELXL

The in-app Agent refined 3a on the single-crystal page. 3a is a caesium
pentamethylcyclopentadienide pyridine adduct from the GSAS-II tutorials,
loaded as SHELXL's instruction file with the LIST 4 listing SHELXL wrote with
it. The user asked whether the app reproduces SHELXL's refinement. I played an
experienced small-molecule crystallographer who reads every number. As in
round 3, the model was served through a local relay standing in for LM
Studio, on a production build of the app. Every tool call ran in the app, and
every number below is the app's unless it is marked as SHELXL's.

## The data

| | |
| --- | --- |
| Source | GSAS-II tutorial "Merohedral twin": `3a.ins`, SHELXL's final instructions and model, and `3a.fcf`, the LIST 4 listing it wrote (h k l, Fc², Fo², σ) |
| Measurement | Mo Kα (λ 0.71073 Å); no TEMP, so SHELXL took 20 °C. The listing holds each reflection once, on SHELXL's scale, with its extinction (EXTI 0.001994) divided out of Fo² |
| Reflections | 1465 to d_min 0.929 Å (sinθ/λ 0.538 Å⁻¹): 1033 unique in the Laue class (99.4 % complete) and the Bijvoet partners of 432 of them; 68 centric; no absence listed |
| Structure | C₁₅H₂₀CsN, P6₁, a 11.370(2), c 20.496(4) Å, Z = 6. Cs, N and the 15 carbons anisotropic; 20 hydrogens riding: five pyridine C–H (AFIX 43) and five rotating methyls (AFIX 137) whose 15 hydrogens share one refined U (free variable 2) |
| SHELXL's refinement | TWIN 0 1 0 1 0 0 0 0 −1 (a 2-fold along [110], merohedral), BASF 0.34068; EXTI; WGHT 0.0374 0.6277, which its own final suggestion repeats; 162 parameters, 1 restraint (the floating origin along c): R1 2.18 % for the 1458 reflections with Fo > 4σ(Fo), 2.20 % for all 1465. The .res gives neither wR2 nor GooF, and no Flack x |

## The ask

"3a (the GSAS-II merohedral-twin tutorial): Cs(C5Me5)·pyridine in P6₁, Mo
Kα. The structure is SHELXL's final .ins, the data the LIST 4 .fcf SHELXL
wrote with it. SHELXL refined it with TWIN 0 1 0 1 0 0 0 0 -1 (BASF
0.34068), EXTI, WGHT 0.0374 0.6277 and the methyl hydrogens' U on one free
variable, to R1 2.18 % for the 1458 reflections with Fo > 4σ(Fo) (2.20 % for
all 1465), with 162 parameters and 1 restraint. Refine it as SHELXL would and
tell me whether this app reproduces that. I expect the twin handled, the
floating origin of a polar group dealt with, the absolute structure decided
and stated with its evidence (this is a chiral group), and the hydrogens
treated as SHELXL treated them. Write the report when you are done."

Before this round the page could not read a SHELX file, hold a polar origin,
share a hydrogen U, refine a twin of both hands or invert a model. Rows 1–7
of the critique table are what reproducing SHELXL's refinement needed, found
before the Agent ran by reading the model and fitting SHELXL's own. The first
live session found rows 8–20 and the second rows 21–27. The session below is
the third, on the final build, and found rows 28–30.

## What the Agent did

| Step | What | R1 % | wR2 % | GooF |
| --- | --- | --- | --- | --- |
| 1 | Read the method and the page: SHELXL's model in P6₁, X-ray at Mo Kα with f′ and f″, the listing as loaded. Nothing of the .ins applied (no twin, w = 1/σ²) | 17.67 | 26.73 | 11.43 |
| 2 | The data (`reflection_statistics`): 1465 reflections, each once with its Friedel mate apart, so no R_int; d_min 0.929 Å, 99.4 % complete; 432 Bijvoet pairs; ⟨\|E² − 1\|⟩ 0.532, below the acentric 0.736: the twin shows | | | |
| 3 | The twin law with the inversion (`set_twin` `withInversion`, SHELXL's TWIN R −4): four domains, the two inverted ones summing to the Flack x. SHELXL refined the law alone, so its hand was never tested | | | |
| 4 | The hydrogens as the .ins has them (`set_riding_hydrogens`, 20 °C): AFIX 43 at 0.930 Å with U 1.2·U_eq, AFIX 137 at 0.960 Å with one shared, refined U_iso | | | |
| 5 | Scale and the three twin fractions, the extinction held at 0 against the listing. x = 0.76(5) already on the inverted hand; Parsons' quotients 1.08(6); none of the 17 Bijvoet differences above 3σ of the model's sign. The structure has not moved yet, so no decision | 1.91 | 4.34 | 1.86 |
| 6 | The positions and the five methyl torsions; the floating origin along c held by its restraint | 1.90 | 4.04 | 1.76 |
| 7 | The 102 U modes and the shared U: 163 parameters. x = 1.01(5) (the inverted domains, esd from the covariance), the model's own domains −0.01(4) and 0.00(3); Parsons 1.08(6); 0 of 17 signs | 1.94 | 3.88 | 1.76 |
| 8 | The model inverted (`invert_structure`): every coordinate negated and moved into the cell by (1, 0, 1), P6₁ → P6₅, each twin domain taking its inverse's fraction. The same fit, re-expressed: x = 0.00(5), Parsons −0.08(6), 17 of 17 signs | 1.94 | 3.88 | 1.76 |
| 9 | The inversion domains at 0 dropped: SHELXL's two-domain twin, in P6₅ (161 parameters) | 1.94 | 3.87 | 1.75 |
| 10 | SHELXL's model under SHELXL's conditions, to answer the question: back to P6₁, WGHT 0.0374 0.6277. BASF 0.3407(14); the shared U 0.0884(96) Å²; every atom within 0.0014 Å (0.2 esd) of the .ins, U_eq 0.986–1.009 of its | 2.18 | 5.66 | 1.057 |
| 11 | The inverted model under the same weights and parameters: the two hands compared under one scheme. The verdict now says what a GooF of 0.889 means: the weights, fitted to the other hand's model, expect more misfit than this one leaves | 1.83 | 4.76 | 0.889 |
| 12 | The final model's own weights, SHELXL's suggestion for it (`set_weighting` "suggested": WGHT 0.0355 0), refined; the suggestion then settles at 0.0357 0. Twin fraction 0.3402(12), Parsons' x −0.08(6), 17 of 17 signs | 1.84 | 4.71 | 0.976 |
| 13 | Caesium's coordination (`bond_geometry` from Cs1): ten Cs–C to two C₅Me₅ rings, 3.232(8)–3.352(6) Å, one ring a symmetry image (6_555), and Cs–N 3.267(8) Å to the pyridine | | | |
| 14 | The report (`write_report`): its audit found no number in the account that the report does not hold | | | |

### Against SHELXL

| | This app, P6₁ under SHELXL's conditions | SHELXL |
| --- | --- | --- |
| R1, Fo > 4σ(Fo) | 2.18 % (1458) | 2.18 % (1458) |
| R1, all data | 2.20 % (1465) | 2.20 % (1465) |
| wR2, GooF | 5.66 %, 1.057 | not in the .res |
| BASF | 0.3407(14) | 0.34068 |
| Shared methyl U | 0.0884(96) Å² | 0.08883 Å² |
| Parameters / restraints | 161 with EXTI held at 0 (the listing has it divided out) / 1 | 162 / 1 |
| Largest shift from SHELXL's model | 0.0014 Å (N1, 0.2 esd) | — |
| U_eq | 0.986–1.009 × the .ins's | — |
| Suggested weights | WGHT 0.0396 0.9395 | WGHT 0.0374 0.6277 |

The model and its fit are SHELXL's. Every atom is within a fifth of an esd,
and R1, BASF and the shared U agree to the digit. The suggested weights
differ, as in round 3: the app bins by Fc² only.

### The hand

SHELXL's model is the other enantiomer of this crystal. The readings are
independent, and they agree:

| Reading | SHELXL's model, P6₁ | Its inverse, P6₅ |
| --- | --- | --- |
| The twin with both hands (TWIN R −4): the inverted domains together, 163 parameters, w = 1/σ² | x = 1.01(5) | x = 0.00(5) |
| Parsons' quotients, 432 Bijvoet pairs (Parsons, Flack & Wagner, 2013) | x = 1.08(6) | x = −0.08(6) |
| Bijvoet differences observed at more than 3σ with the model's sign | 0 of 17 | 17 of 17 |
| wR2 under SHELXL's weights, the same 161 parameters | 5.66 % | 4.76 % |
| SHELXL's own Fc² in its listing: the same 17 differences of their sign; Parsons' x from them | 0 of 17; x = 1.08 | — |

The last row involves no calculation of this app's. Paired by point group 6,
SHELXL's own Fc² give each strong Bijvoet difference the opposite sign to the
one measured, and Parsons' x = 1.08 from its own numbers. An inverted f″ in
this app could not explain the result. A wR2 ratio of 1.19 at equal parameter
count is far beyond Hamilton's test at any level. The esd of x (0.06) is
above the 0.04 that Flack & Bernardinelli ask for to rule out a few per cent
of the other enantiomer in a compound of unknown enantiopurity. The hand is
decided, and the enantiopurity rests on the chemistry.

## The critique: what was wrong, and what was done about it

| # | Found | Fixed or built | Eval |
| --- | --- | --- | --- |
| 1 | The page could not read a SHELX instruction file; 3a's model is one | `.ins`/`.res` as the structure: CELL's λ and cell, LATT and SYMM to the space group, SFAC, U in SHELX's order, a sof read with the site symmetry, free variables, PART, AFIX, a riding U (−1.2); TWIN, BASF, EXTI, WGHT, FVAR and TEMP listed by `get_state` as the file's instructions, none applied until set | (unit tests) |
| 2 | With every coordinate free in P6₁ the origin along c floats: a null direction in the normal matrix | The Z²-weighted mean coordinate along each polar axis held by a restraint, at the base model's value, counted as SHELXL counts it ("1 restraint") | (unit and data-gated tests) |
| 3 | No refined U shared by several hydrogens (SHELXL's free variable on the U column) | `set_riding_hydrogens` `sharedU`: one U_iso per list, refined with the ADPs; the 15 methyl hydrogens refine 0.0884(96) against SHELXL's 0.08883 | (data-gated test) |
| 4 | No twin with both hands, and no esd for a sum of fractions | `set_twin` `withInversion` (TWIN R −4): four domains, the inverted ones summed into the Flack x. The engine gives named linear combinations and their esds from the full covariance | `sc-inverted-hand` |
| 5 | The correlation guard stopped the TWIN R −4 fit at −0.999, a domain against its inverse | A twin with both hands is one assembly: refined together, as SHELXL refines it, and said so | (unit test) |
| 6 | No way to invert a model: the Flack reading could only say to | `invert_structure`: MOVE 1 1 1 −1 with the enantiomorph (P6₁ → P6₅, eleven pairs) or the origin shift that keeps the setting (I4₁, Fdd2, …). The riding groups are placed afresh, restraints mapped, and a twin's domains re-expressed | `sc-inverted-hand` |
| 7 | No Flack x after the refinement, as SHELXL determines it | Parsons' quotients with the inverted domains folded in, and the Bijvoet signs at 3σ, in `assess_refinement` and the report | `sc-inverted-hand` |
| 8 | Live: a listing's 432 Bijvoet pairs, merged in the Laue class, read as "R_int 3.37 %" on the page, in `get_state`, `reflection_statistics` and the report: their anomalous difference (1.45 % by the model) and their noise together | In an acentric group, the Friedel-apart merge as SHELXL counts it; no R_int for data that hold each reflection once | (unit test) |
| 9 | Live: the page entered the extinction free on a listing whose Fo² have SHELXL's divided out | Fixed at 0 on a listing; `refine` says so if it is freed; the report's Extinction row and check say why | `sc-listing-extinction` |
| 10 | Live: the outliers of a listing read "no equivalent measured"; a Friedel mate was "1 equivalent" | The listing's value, merged by the refinement that wrote it; the Friedel mate named | (unit test) |
| 11 | Live: the twin law's fraction at 0 drew "hold it fixed and find the upstream cause" | A finding about the crystal: in a twin with both hands, the hand it is not | (unit test) |
| 12 | Live: the Flack reading confirmed a hand at u ≥ 0.1, and named no band | Flack & Bernardinelli's bands, u 0.04 and 0.1 | (unit test) |
| 13 | Live: `set_twin` restarted a law that stays at 0.1 when the inversion domains were dropped | Its fraction kept; the History names a twin with both hands and a shared hydrogen U | (unit test) |
| 14 | Live: `bond_geometry` returned an empty list for Cs1 (its neighbours at 3.23–3.35 Å, beyond the 3.2 Å default) | Says so, with the nearest neighbour; each bond to an image carries its CIF site-symmetry code; the phase named | (data-gated test) |
| 15 | Live: the report's bond table left out caesium: the covalent search stopped at 3.0 Å | It reaches the two largest atoms present (Cs–C 2.44 + 0.76 + 0.4 Å); images marked [6_555] | (unit test) |
| 16 | Live: the report's Hydrogens row gave no value for the shared U, the Absolute structure row no x for the inverse model, and there was no row for the SHELX file | Added: U_iso 0.088(8) Å² for 15 hydrogens; "1.08(6) for the inverse model"; a Structure file row with the file's instructions | (data-gated test) |
| 17 | Live: the audit flagged sinθ/λ 0.538 Å⁻¹, which `reflection_statistics` gave and the report did not hold | sinθ/λ beside d_min in the Data check and the record | (unit test) |
| 18 | Live: the report's comparison said "the CIF's ADPs" for a SHELX file, and listed the shared U fifteen times | "the ADPs as loaded"; a run of sites with one value given once | (unit test) |
| 19 | Live: the inverted model sat in the cell below (Cs1 at −0.588, −0.058, −0.500) | Moved into the cell by a lattice vector, said so ("(1, 0, 1)"), and inverted back by the same transform: an exact round trip | (unit test) |
| 20 | Live: the Agent called a tool that does not exist (`get_parameters`) for two parameter rows, then recovered | `get_state`'s description names the single-crystal page's parameter rows | — |
| 21 | Re-run: the report compared wR2 3.88 % at w = 1/σ² with 4.76 % under SHELXL's WGHT as if the second fitted worse, and named "SHELXL EXTI" for an extinction held at 0 | The weighting scheme is a condition, named in each entry, and a comparison across schemes says wR2 and GooF compare only under one; "no extinction" | (unit test) |
| 22 | Re-run: "Excellent: GoF 0.89 is close to the statistical floor" | On a single crystal, 0.8–0.95 says the weights expect more misfit than the model leaves, by how much, and to refit them | (unit test) |
| 23 | Re-run: the Agent kept the weights fitted to the P6₁ model for the final P6₅ model (GooF 0.889 where SHELXL's suggestion for it gives 0.977) | The skill's Stage 6: a published WGHT used to reproduce or to compare is that model's, so set the suggestion again after the last change. `weightsLast` counts the twin and the hand as changes and reads the last scheme set | `sc-weights-final-model` |
| 24 | Re-run: the single-crystal report gave B_eq and B (6.9(6) Å² for the shared U), where SHELXL and the CIF give U | U_eq and U_iso with their esds in the atom table, U_iso in the parameter table; a powder's report keeps B | (unit test) |
| 25 | Re-run: a methyl torsion had no unit, and the Structure file row did not name the file | ° ; "3a.ins, a SHELX instruction file, …" | (unit test) |
| 26 | Re-run: `reflection_statistics` gave the listing "1033 unique, redundancy 1.42" (the Laue class's); with the twin modelled, ⟨\|E² − 1\|⟩ still said "look for twinning"; `assess_refinement` read a listing's extinction as "not indicated" | 1465 and 1, as SHELXL counts them; "what the twin the model holds gives"; "not judged from a listing" | (data-gated test) |
| 27 | Re-run: `bond_geometry` gave Cs1's bonds as "C2–Cs1" with the far end's image code | Read from the atom asked for, the code inverted to the reverse bond's, as the report gives it | (data-gated test) |
| 28 | Final run: `reflection_statistics` gave R_σ 2.73 % (the Laue merge) where `get_state` and the report give 3.22 % | The listing's own | (data-gated test) |
| 29 | Final run: `get_state` said "restraints: none" while the fit held the floating origin, and "SHELXL EXTI" for an extinction held at 0 | "1: the floating origin along c"; "none: held at 0, the listing's Fo² carrying the correction" | (data-gated test) |
| 30 | Final run: two Friedel mates that disagree in a Mo Kα listing pointed to "absorption at another wavelength" | A monochromatic measurement's mates differ only in path | — |

The three eval scenarios replay the Agent's decisions that this round turned
on. The first holds the extinction at 0 against a listing. The second tests
the hand, inverts a model of the wrong one and refines it again. The third
sets the weights again for the final model once its hand is settled. The
Agent got the first two right once the tools existed. It got the third wrong
in the second session and right in the third, after the skill said so. The
evals hold a model to all three.

## Open

- **The cell's esds.** The .ins's ZERR gives a 11.370(2), c 20.496(4) Å.
  The page reads no cell esds: the report prints the cell without them and
  the volume to the digit, and a bond's esd leaves out the cell's
  contribution, which SHELXL adds. Derived esds also still treat the
  parameters as independent (round 3).
- **No difference map.** SHELXL's .res gives the largest residual peak and
  hole (0.252 and −0.362 e Å⁻³). Every single-crystal report quotes them, and
  this app computes no Fourier synthesis for a single crystal. A twin needs
  its Fo² detwinned first.
- **No ring geometry.** An η⁵ ring is described by the metal–centroid
  distance and the centroid–metal–centroid angle. `bond_geometry` gives the
  ten Cs–C distances but no centroid.
- **The suggested weights** for SHELXL's model are WGHT 0.0396 0.9395 where
  SHELXL's converged on 0.0374 0.6277, and its GooF is 1.057 here, which
  SHELXL's .res does not give. The binning is by Fc² only, as in round 3.
- **The data stop at sinθ/λ 0.538 Å⁻¹**, short of the 0.6 Å⁻¹ checkCIF
  expects, and give 9.1 reflections per parameter. Both are the measurement's
  limits, not the refinement's, and the report states them.

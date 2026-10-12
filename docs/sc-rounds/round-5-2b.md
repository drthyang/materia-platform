# Single-crystal round 5: 2b, an aluminate in P3₂, a merohedral twin to find

The in-app Agent refined 2b on the single-crystal page. 2b is Victor Young's
merohedral-twin example from the GSAS-II tutorials: SHELXL's instruction file
with its TWIN and BASF commented out, and the HKLF 4 file. In round 4 the
twin law came with the model. This time the Agent had to find it in the data.
The user asked the Agent to find what the model was missing, refine it as
SHELXL would, and say whether the app reproduces SHELXL. I played an
experienced small-molecule crystallographer who reads every number. As in
rounds 3 and 4, the model was served through a local relay standing in for
LM Studio, on a production build of the app. Every tool call ran in the app,
and every number below is the app's unless it is marked as SHELXL's.

## The data

| | |
| --- | --- |
| Source | GSAS-II tutorial "Merohedral twin": `2b.ins`, SHELXL's final instructions and model with `REM TWIN 0 1 0 1 0 0 0 0 -1` and `REM BASF 0.49660` (the twin taken out), and `2b.hkl`, the HKLF 4 file |
| Measurement | Mo Kα (λ 0.71073 Å), TEMP −100 (173 K) |
| Reflections | 8435 in the file, each once: the data reduction had merged the equivalents and kept the Friedel opposites apart. 21 are systematic absences (00l, l ≠ 3n), leaving SHELXL's 8414 to d_min 0.840 Å (sinθ/λ 0.595 Å⁻¹), 99.8 % complete, R_σ 4.58 % |
| Structure | C₅₅H₈₂NO₄Al, P3₂, a 12.7506(1), c 27.6245(3) Å, Z = 3. Al, four O, N and 55 C anisotropic. 82 hydrogens riding: 16 rotating methyls (AFIX 137), 12 aromatic C–H (AFIX 43), 6 CH₂ (AFIX 23), and the 9 methine C–H and the ammonium N–H (AFIX 13) |
| SHELXL's refinement | TWIN 0 1 0 1 0 0 0 0 −1, BASF 0.4966. WGHT 0.0436 0.2952, which its own final suggestion repeats. 567 parameters and 1 restraint (the floating origin along c). R1 4.33 % for the 7597 reflections with Fo > 4σ(Fo), 5.17 % for all 8414. Highest peak 0.145 and deepest hole −0.130 e Å⁻³. The .res gives neither wR2 nor GooF |

## The ask

"2b (Victor Young's merohedral-twin example, from the GSAS-II tutorials): an
aluminium complex, C55H82NO4Al in P3₂, Mo Kα at 173 K. The structure is
SHELXL's .ins as the tutorial gives it, with its TWIN and BASF taken out; the
data are its HKLF 4 file. SHELXL's final refinement gave R1 4.33 % for the
7597 reflections with Fo > 4σ(Fo) (5.17 % for all 8414 data), with 567
parameters, 1 restraint and WGHT 0.0436 0.2952. Find out what the model as
given is missing, refine it as SHELXL would, and tell me whether this app
reproduces that. I expect the data read before any refinement, the twin found
from the data with its law and fraction justified, the floating origin of a
polar group handled, the absolute structure addressed honestly (the heaviest
atom is Al), and the hydrogens treated as SHELXL treats them at this
temperature. Write the report when you are done."

Before this round the page could not test which merohedral law twins a
crystal. Given a model whose TWIN had been removed, it had nothing to find
the twin with. Rows 1–4 of the critique table were built before the Agent
ran: the twin-law test, ring centroids, a hydrogen-bond table, and 2b's
reproduction as a test. The first live session found rows 5–16 and the
second rows 17–23. The session below is the third, on the final build, and
found rows 24–25.

## What the Agent did

| Step | What | R1 % | wR2 % | GooF |
| --- | --- | --- | --- | --- |
| 1 | Read the method and the page. SHELXL's model in P3₂, X-ray at Mo Kα with f′ and f″, the file as loaded, no twin, w = 1/σ² | 20.45 | 42.61 | 8.77 |
| 2 | The data (`reflection_statistics`). 8435 reflections, each once with its Friedel mate apart (91.8 % of the acentric ones have theirs), so no R_int can be quoted. The Bijvoet pairs differ by 2.96 %; the model's anomalous differences account for only 0.19 % of that. d_min 0.840 Å, 99.8 % complete. 4 of the 21 forbidden 00l reflections are above 3σ (at most 5.0σ), the others absent. ⟨\|E² − 1\|⟩ is 0.652, below the 0.736 of an untwinned acentric crystal. The H-test on the lattice's three merohedral laws gives α ≈ 0.448 for h, k, l → k, h, −l (1668 pairs), against 0.165 and 0.145 for the other two | | | |
| 3 | `merge_equivalents`: the file is already merged, so only the 21 absences are left out (8414 fitted, SHELXL's count). `set_twin` with the law the data read: SHELXL's TWIN 0 1 0 1 0 0 0 0 −1 | | | |
| 4 | The hydrogens as the .ins has them (`set_riding_hydrogens`, 173 K): C–H 0.98, 0.95, 0.99 and 1.00 Å by group, N–H 0.93 Å, U 1.5 or 1.2·U_eq | | | |
| 5 | Scale and twin fraction. The extinction stays at 0, since the .ins has no EXTI. Twin fraction 0.4957(9), a near-perfect twin. Parsons' x 0.01(13): the hand is not readable | 4.32 | 7.61 | 1.57 |
| 6 | Positions and the 16 methyl torsions; the floating origin along c held by its restraint | 4.37 | 7.45 | 1.55 |
| 7 | The 366 U modes: SHELXL's 567 parameters | 4.42 | 7.23 | 1.54 |
| 8 | SHELXL's WGHT 0.0436 0.2952, last. Twin fraction 0.4965(12); Parsons' x 0.00(13); 14 of the 28 Bijvoet differences above 3σ have the model's sign. SHELXL's criterion suggests WGHT 0.0437 0.4523 for this model (GooF 1.05) | 4.32 | 9.75 | 1.090 |
| 9 | The other hand under the same weights and parameters (`invert_structure`: P3₂ → P3₁). x 1.00(13) | 4.33 | 9.78 | 1.093 |
| 10 | Back to SHELXL's P3₂, and the model against the .ins (`structure_table`): largest shift 0.0040 Å (C28, 1.1 esd), none beyond 3 esd; U_eq 0.982–1.020 × the .ins's | 4.32 | 9.75 | 1.090 |
| 11 | `assess_refinement` and `bond_geometry` at Al1 and N1. AlO₄ tetrahedral, Al–O 1.731(3)–1.746(3) Å, bond-valence sum 3.16 for Al³⁺. The ammonium's N1–H1D points at the aryl ring Cg2: H···Cg 2.441 Å, 176°. "none: N1–H1D reaches no acceptor" — no classical hydrogen bond | | | |
| 12 | The report (`write_report`): the cell with its esds (a 12.75060(10), c 27.6245(3) Å, V 3889.43(7) Å³), the hydrogen bonds as none, the weights against the criterion's suggestion; its audit found no number in the account that the report does not hold | | | |

### Against SHELXL

| | This app, P3₂ under SHELXL's conditions | SHELXL |
| --- | --- | --- |
| R1, Fo > 4σ(Fo) | 4.32 % (7595) | 4.33 % (7597) |
| R1, all data | 5.16 % (8414) | 5.17 % (8414) |
| wR2, GooF | 9.75 %, 1.090 | not in the .res |
| BASF | 0.4965(12) | 0.4966 |
| Overall scale | k 0.0959(2), so OSF = √k = 0.3097 | OSF 0.3096 |
| Parameters / restraints | 567 / 1 (the floating origin along c) | 567 / 1 |
| Largest shift from SHELXL's model | 0.0040 Å (C28, 1.1 esd) | — |
| U_eq | 0.982–1.020 × the .ins's | — |
| Suggested weights | WGHT 0.0437 0.4523 by SHELXL's criterion (0.0454 0.7069 before this round) | WGHT 0.0436 0.2952 |

The fit is SHELXL's. R1 matches to 0.01 % on both counts, BASF to 0.0001,
and every atom is within 1.1 esd of the .ins. The observed counts differ by
2. The page counts Fo² > 2σ(Fo²), which is SHELXL's Fo > 4σ(Fo) to first
order; the two reflections were not identified.

### The twin, from the data

The model as given cannot fit the data: R1 20.45 % and GooF 8.8. Before
any refinement the data show why, on two independent readings:

| Reading | Value | What it says |
| --- | --- | --- |
| ⟨\|E² − 1\|⟩ | 0.652 | below the untwinned acentric 0.736, toward a perfect twin's 0.541 |
| H-test, h, k, l → k, h, −l (1668 pairs) | α ≈ 0.448 | a near-perfect twin by this law |
| H-test, h, k, l → −h, −k, l | α ≈ 0.165 | what a perfect twin by the first law leaves its siblings (⅛), plus a little |
| H-test, h, k, l → −k, −h, −l | α ≈ 0.145 | the same |
| Refined (scale and fraction alone) | 0.4957(9), R1 20.45 → 4.32 % | the law and the fraction confirmed |

The law is the 2-fold of the hexagonal lattice that the Laue class −3
lacks, SHELXL's TWIN 0 1 0 1 0 0 0 0 −1. The Agent set it from the data,
not from the .ins's REM line.

### The hand

The absolute structure is not determined, and the report says so. Al is the
heaviest atom, and at Mo Kα its f″ is 0.05 e:

| Reading | SHELXL's model, P3₂ | Its inverse, P3₁ |
| --- | --- | --- |
| Parsons' quotients, 3856 Bijvoet pairs | x = 0.00(13) | x = 1.00(13) |
| Bijvoet differences above 3σ with the model's sign | 14 of 28 | — |
| wR2 under SHELXL's weights, the same 567 parameters | 9.75 % | 9.78 % |

Both readings lean to P3₂, but u = 0.13 is above the 0.1 that Flack &
Bernardinelli require even for a compound known to be enantiopure. The
final model keeps SHELXL's hand as its choice, not as a determination.

### The weights

The app's "SHELXL's suggestion" has never matched SHELXL's own:

| Round | SHELXL's WGHT | The app's suggestion, before | after |
| --- | --- | --- | --- |
| 2, dipyridyl | 0.0362 0.7686 (the scheme it used) | 0.0329 0.8611 | 0.0361 0.838 (from SHELXL's listing) |
| 3, 1b | 0.0277 0.2519 (its last suggestion) | 0.0265 0.3313 | 0.0259 0.313 (from SHELXL's listing) |
| 4, 3a | 0.0374 0.6277 (converged: it suggests itself) | 0.0396 0.9395 | 0.0370 0.668 (from SHELXL's listing) |
| 5, 2b | 0.0436 0.2952 (converged) | 0.0454 0.7069 | 0.0437 0.4523 (the app's refined model) |

Earlier rounds blamed the binning: the app bins by Fc² only, while SHELXL
was thought to bin by resolution as well. That was wrong. The SHELXL-97
manual's WGHT entry says the suggested scheme gives "a flat analysis of
variance in terms of Fc²" and "does not take the resolution dependence into
account". SHELXL's own listings show what is actually different: SHELXL
does not hold the overall GooF at 1. Computed from the listing's own Fc²,
3a's converged scheme gives GooF 1.058, and 1b's gives 1.044, the figure in
SHELXL's CIF. The old suggestion forced GooF = 1 and could only get there by
raising b. The new one minimizes Σ(GooF_bin − 1)² over ten equal-count Fc²
bins, each bin's GooF taken over its own reflections, and leaves the overall
GooF at the value that minimum gives: 1.058 for 3a, as SHELXL's. On 3a,
SHELXL's point and the new minimum have the same criterion value to 0.4 %.
SHELXL's own search runs on a coarse grid and stops elsewhere in the same
shallow valley. That is why a few thousandths in a and up to about 0.2 in b
remain (2b's b of 0.4523 against 0.2952 is the widest gap). The report and
the tools now call it the weights SHELXL's criterion suggests, not
SHELXL's.

## The critique: what was wrong, and what was done about it

| # | Found | Fixed or built | Eval |
| --- | --- | --- | --- |
| 1 | No test for which merohedral law twins a crystal. A model whose TWIN was taken out left nothing to find the twin with | `reflection_statistics` `twinLaws`: each merohedral law (one per coset of the Laue class in the lattice's holohedry, the simplest rotation of it, as `set_twin` takes it) with the α Yeates' H-test reads from the intensities alone. The data record names the strongest. The skill's Stage 0 reads it | `sc-twin-from-data` |
| 2 | No ring centroids. An N–H···π contact, or a metal over a ring, has no atom to point at (round 4's open item) | Planar 5- and 6-rings with their centroids; a metal within 3.6 Å, an X–H pointing at one within 3.0 Å (above 120°), the Cg–M–Cg angle; in `bond_geometry` and the report | (unit and data-gated tests) |
| 3 | No hydrogen-bond table | D–H···A as SHELXL's HTAB finds them (H···A below the van der Waals sum, D–H···A above 110°), each acceptor's image by its CIF code; in `bond_geometry` and the report | (unit test) |
| 4 | 2b's reproduction had no test | `sc2b.test.ts`: the merge to 8414, the twin in the data, R1 within 0.0005 of SHELXL's on both counts, BASF within 0.002, the floating origin, the hand undetermined; `sc2bAgent.test.ts` through the Agent's tools | (data-gated tests) |
| 5 | Live: the report's open issues listed 23 of 2b's carbons as "more than 15 % from the valence" (C4+, assumed) | In a molecular structure only the metals have a bond-valence sum (Al1 3.16) | (data-gated test) |
| 6 | Live: x = 1.00(13) in P3₁ read "the inverted hand: invert the model", whatever its esd | x near 1 reads the same Flack & Bernardinelli bands as x near 0 | (data-gated test) |
| 7 | Live: `merge_equivalents` on a file the data reduction had already merged said "8435 measurements merged into 8414 … R_int 0 %", and the report said "8414 measurements merged" | The file holds each reflection once; the merge only leaves out the 21 absences, with no R_int. The History, the Reflections row and the summary say so | (data-gated test) |
| 8 | Live: the Bijvoet pairs' 2.96 % was called "their anomalous signal" | The model's own Bijvoet differences say how much of it is anomalous: 0.19 % on 2b (light atoms), 1.45 % of 3a's 3.37 % | (data-gated test) |
| 9 | Live: 19 forbidden reflections, not SHELXL's 21 (counted after merging the Friedel mates); the acentric reflections' Friedel coverage counted the absences | Counted with the Friedel mates apart in an acentric group, the absences left out of the coverage | (data-gated test) |
| 10 | Live: the riding note called the ammonium's N–H "tertiary C–H … X–H 0.930–1.000 Å" | One distance per parent element: "C–H 1.000 Å, N–H 0.930 Å" | (data-gated test) |
| 11 | Live: `set_free` echoed all 567 free ids | Past 40, by kind, as the History's rows give them | (data-gated test) |
| 12 | Live: an outlier measured once read "measured once" although its Friedel mate was measured | Read against its Friedel mate | (unit test) |
| 13 | Live: `bond_geometry`'s contacts listed a hydrogen against its parent's neighbour | Atoms two bonds apart left out | (unit test) |
| 14 | Live: the report's Extinction row said "SHELXL EXTI" for an extinction held at 0 | "none refined (held at 0)" | (unit test) |
| 15 | Live: the compared refinements gave 61 U_eq per step, a wall of numbers | A large structure's first six sites and the others' range | (unit test) |
| 16 | Live: the eval check `weightsLast` failed a run that tested the hand under SHELXL's weights and inverted back | An even number of inversions after the last weighting leaves the model as it was | (eval replays) |
| 17 | Second run: "SHELXL's suggestion: WGHT 0.0454 0.7069" where SHELXL's .res gives 0.0436 0.2952; the same gap in rounds 2–4 | SHELXL's criterion, checked against SHELXL's own listings (above); called the criterion's suggestion | (unit and data-gated tests) |
| 18 | Second run: the outlier 8 −1 17 (Fo² −0.12, Fc² 2.993) read "this one 0.21": the ratio is floored at σ | "this one below 0.21 (Fo² under its σ)" | (unit test) |
| 19 | Second run: the compared refinements said "the ADPs as loaded" of refined ADPs | The loaded model named: "anisotropic ADPs as loaded" | — |
| 20 | Second run: the History's step read "Absences left out: 8414 reflections" | "21 absences left out: 8414 reflections" | — |
| 21 | Second run: "scale (OSF) 0.0959(2)" beside the .ins's FVAR OSF 0.3096. The page's scale is on F², SHELXL's OSF on F | "scale k = OSF²" (0.3097² = 0.0959) | — |
| 22 | Second run: with no hydrogen bond, the report left the section out, so it could not be told from a check never made | "none: N1–H1D reaches no acceptor (N, O, F, S or a halogen) within the van der Waals sum at D–H···A above 110°", in `bond_geometry` and the report | (unit and data-gated tests) |
| 23 | Second run: the report printed the cell without esds and the volume to the digit (round 4's open item). SHELXL's bond esds include the cell's | The structure file's esds read (SHELXL's ZERR, a CIF's su) and carried into the report, the CIF and `structure_table`. The volume's esd and the bonds' cell part come from each independent cell parameter moved by its esd, the lengths the lattice holds equal moving together: 2b's V 3889.43(7) Å³; 1b's 1402.4(3) and dipyridyl's 2000.8(3) Å³, as SHELXL's CIFs give them | (unit and data-gated tests) |
| 24 | Final run: the suggested scheme's bins were printed to two figures ("1.1, 1.1, 1.1, 1.1, 1"), which hides the 1.05–1.12 the analysis of variance gives | Three, as the analysis of variance prints them | — |
| 25 | Final run: "the other 54 entries" for 55 sites: two consecutive sites with the same U_eq were joined into one entry | Two sites that happen to agree stay two entries; a run of three or more (a shared U) is one | — |

The Agent made no wrong decision in either session. It read the data before
refining, set the law the H-test read rather than the .ins's REM line,
tested the hand under one scheme and stated it as undetermined. The eval
scenario `sc-twin-from-data` holds a model to the decision this round
turned on: set the merohedral twin the data read before the structure
refines. The live failures were the tools': what they counted, what they
called things, and what they left out.

## Open

- **No difference map.** SHELXL's .res gives 0.145 and −0.130 e Å⁻³. This
  app computes no Fourier synthesis for a single crystal, and a twin's Fo²
  need detwinning first.
- **⟨|E² − 1|⟩ 0.652 for a twin fraction of 0.4965.** A perfect twin of an
  acentric crystal gives 0.541, and the H-test's sibling laws read 0.165 and
  0.145 where a perfect twin leaves 0.125. Something besides the twin is
  widening the intensity distribution: pseudo-symmetry, or a normalization
  in resolution shells that ignores anisotropy. Not followed further.
- **The weakest bin reads K 1.26 and the outermost shell 1.11.** The model
  underestimates the weakest reflections. The same bins carry most of the
  gap between the suggested b (0.4523) and SHELXL's (0.2952): under SHELXL's
  weights, bins 2–5 read GooF 1.11–1.15 here. Whether SHELXL's own fit reads
  the same cannot be checked without its listing.
- **4 of the 21 absences are above 3σ** (0 0 −26 at 5.0σ, 25 % of the mean
  allowed intensity at that d). The other 17 are absent, so 3₂ stands;
  multiple diffraction along the axis is the usual cause.
- **Derived esds still treat the parameters as independent** (round 3). The
  cell's part is now added, as SHELXL adds it, but the positions'
  covariance is not.

# Single-crystal researcher rounds

Five rounds of the in-app Agent on the single-crystal page, each against real
data, with a critical crystallographer asking. Each round's report says what
the Agent did, what was wrong, and what was fixed or built, with an eval
scenario for each failure of the Agent's ([AGENT_EVALS.md](../AGENT_EVALS.md)).
The method the Agent follows is the `sc-workflow` skill
([.claude/skills/sc-workflow](../../.claude/skills/sc-workflow/SKILL.md)).

| Round | Data | Probe | What it tested | Final fit | Found and fixed or built | Evals |
| --- | --- | --- | --- | --- | --- | --- |
| [1](./round-1-sapphire.md) | sapphire, α-Al₂O₃ (GSAS-II tutorial, SNS TOPAZ) | neutron TOF Laue, 31 runs | λ-dependent extinction, failed measurements, batch scales, anisotropic ADPs | R1 4.10 %, wR2 11.35 %, GooF 2.35 (Becker–Coppens type I) | 13: TOPAZ reader, per-reflection extinction, batch scales, extinction cut, equivalents, OMIT h k l, outliers read against equivalents, Becker–Coppens, resolution range (SHEL), Refinements compared; fixes to the ADP seed, U_eq, statistics, convergence, the correlation guard | 6 |
| [2](./round-2-dipyridyl.md) | dipyridyl disulfide, C₁₀H₈N₂S₂ (GSAS-II tutorial, SHELXL's own .fcf) | X-ray, Mo Kα | reproducing a published SHELXL refinement: riding hydrogens, the weighting scheme, a refinement's listing, 254 parameters | R1 2.76 %, wR2 7.61 %, GooF 1.008 with SHELXL's WGHT (SHELXL: 2.86 %, 7.86 %, 1.041); S–S 2.0222(5) Å as SHELXL's | 17: the radiation and λ, a refinement's listing called so, riding hydrogens (AFIX 43/3) with exact derivatives, SHELXL's WGHT and its suggestion, analytic structure-factor derivatives (23 min → 16.5 s), the structure against the one loaded, bonds by atom, the report's covalent bonds and B_eq; fixes to the riding tool's reading, negative off-diagonal U, the method stages, the audit | 4 |
| [3](./round-3-1b.md) | 1b, a Ga/Al hydride C₈H₂₅Al₀.₈₄Ga₁.₁₆N₃ (GSAS-II tutorial, SHELXL's CIF with its own .hkl) | X-ray, Mo Kα, Friedel pairs apart | an inversion twin and the Flack x, an Al/Ga disorder, hydrides under restraints, merging as SHELXL, the esds against SHELXL's | R1 2.02 %, wR2 4.97 %, GooF 1.030, Flack x 0.435(11), Al 0.844(2) with SHELXL's WGHT (SHELXL: 2.04 %, 5.04 %, 1.044, 0.435(15), 0.844(2)) | 33: anomalous scattering, twin laws and the Flack x, disorder ties (21/−21, EADP), SHELXL's hydrogen groups and refined hydrides, DFIX/SADI, a CIF's own measurement merged as SHELXL's MERG 2 with its σ, WGHT on the absolute scale, a complete eigen-decomposition for the step and the esds, the esds against a published CIF's, SHELXL's data count and figures in the report and on the page; fixes to the method stages, the notes, the outlier readings, the report's rows, groups and tied esds, the CIF's U^ij su | 4 |
| [4](./round-4-3a.md) | 3a, Cs(C₅Me₅)·py (GSAS-II tutorial, SHELXL's .ins and its LIST 4 .fcf) | X-ray, Mo Kα, Friedel pairs apart | a merohedral twin, a polar group's floating origin, a shared hydrogen U, the hand of a twinned crystal, a refinement's listing | SHELXL's model reproduced in P6₁: R1 2.18 %, BASF 0.3407(14), the shared U 0.0884(96) Å² (SHELXL: 2.18 %, 0.34068, 0.08883). It is the wrong enantiomer: Parsons' x 1.08(6), 0 of 17 strong Bijvoet signs, SHELXL's own Fc² agreeing. Final, in P6₅ with its own weights: R1 1.84 %, wR2 4.71 %, GooF 0.976, x −0.08(6) | 30: SHELX instruction files, the floating origin restrained, a shared refined hydrogen U, a twin with both hands and the Flack x's esd from the covariance, `invert_structure`, Parsons' quotients; fixes to a listing's R_int, extinction, counts and outliers, the twin and Flack readings, caesium's bonds and their image codes, the report's rows, the comparison of refinements under other weights, the GooF below 1, the report in U | 3 |
| [5](./round-5-2b.md) | 2b, an aluminate C₅₅H₈₂NO₄Al (GSAS-II tutorial, SHELXL's .ins with its TWIN taken out, and the HKLF 4 file) | X-ray, Mo Kα, Friedel pairs apart | a merohedral twin found from the data alone, a file its data reduction had merged, a hand the data cannot decide, SHELXL's weighting criterion, the cell's esds | SHELXL reproduced in P3₂ with the twin the H-test read (α 0.448): R1 4.32 % (7595), 5.16 % on all, wR2 9.75 %, GooF 1.090, BASF 0.4965(12) (SHELXL: 4.33 % (7597), 5.17 %, 0.4966). The hand undetermined: x 0.00(13), and 1.00(13) inverted to P3₁ | 25: the merohedral twin-law test (Yeates' H-test), ring centroids, hydrogen bonds, the suggested weights by SHELXL's criterion, the cell's esds (ZERR, a CIF's su) in the report, the CIF and the bond esds; fixes to bond valence in a molecule, the hand read near 1, a merged file's merge and R_int, the Bijvoet difference's source, the counts of absences and Friedel pairs, the riding note, long free lists, contacts, the report's rows, an outlier's ratio as a bound, the scale's label, "no hydrogen bond" said | 1 |

## Across the five rounds

| Round | The reference | What the app gave | What the data said that the reference did not | Critique rows | The Agent's wrong decisions (evals) |
| --- | --- | --- | --- | --- | --- |
| 1, sapphire | none published: the tutorial's starting model | R1 4.10 %, wR2 11.35 %, GooF 2.35, Becker–Coppens type I; ADPs tested on the high-order data | EXTI leaves the ADPs about 20 % low; two failed measurements in batch 24 | 13 | 6 |
| 2, dipyridyl | SHELXL's CIF and listing: R1 2.86 %, wR2 7.86 %, GooF 1.041 | R1 2.76 %, wR2 7.61 %, GooF 1.008; S–S 2.0222(5) Å as SHELXL's | — | 17 | 4 |
| 3, 1b | SHELXL's CIF with its .hkl: R1 2.04 %, wR2 5.04 %, GooF 1.044, Flack 0.435(15), Al 0.844(2) | R1 2.02 %, wR2 4.97 %, GooF 1.030, Flack 0.435(11), Al 0.844(2) | — | 33 | 4 |
| 4, 3a | SHELXL's .ins and LIST 4: R1 2.18 %, BASF 0.34068 | R1 2.18 %, BASF 0.3407(14), the shared U 0.0884(96) Å² | SHELXL's model is the other enantiomer: Parsons' x 1.08(6), 0 of 17 strong Bijvoet signs, SHELXL's own Fc² agreeing. In P6₅, R1 1.84 % | 30 | 3 |
| 5, 2b | SHELXL's .ins without its TWIN, and the HKLF 4 file: R1 4.33 % and 5.17 %, BASF 0.4966 | The twin found from the data first; then R1 4.32 % and 5.16 %, BASF 0.4965(12) | The hand cannot be told, x 0.00(13) against 1.00(13). SHELXL's own weights leave GooF above 1 (3a's converged scheme 1.058, 1b's 1.044), which the app's suggestion now does too | 25 | 0 (1 eval for the decision the round turned on) |

Over five rounds the single-crystal page grew from a fit of a scale, one B
per site and an extinction into what reproduces SHELXL on four published
refinements: R1 within 0.1 % each time, and twin fractions, a Flack x and an
occupancy within a unit of their last digit. The tools built along the way
were:

- for the data: the TOPAZ reader with per-reflection extinction, batch
  scales, merging as SHELXL's MERG 2, a refinement's listing called what it
  is, and Yeates' H-test for the merohedral twin laws;
- for the model: SHELXL's riding hydrogens, disorder ties, DFIX and SADI,
  the floating origin, a shared hydrogen U, twins with and without the
  inversion, and `invert_structure`;
- for the hand and the weights: Parsons' quotients, and the weights
  SHELXL's criterion suggests;
- for the report: geometry with esds (the cell's part included), ring
  centroids and hydrogen bonds;
- for speed: analytic structure-factor derivatives, which took a
  254-parameter fit from 23 minutes to 16.5 s.

The Agent's wrong decisions in rounds 1–4 became 17 eval scenarios, and
round 5's turning decision an 18th. They fall into a few kinds:

- refining before reading the data: the data first, the radiation first,
  the merge first;
- hiding a failure behind a cutoff, where comparing a misfit with its
  equivalents is the right test;
- skipping a modelling test: the extinction model, batch scales, riding
  hydrogens, a tied disorder, restrained hydrides;
- trusting a listing for what it cannot give: no R_int, no extinction;
- setting the weights too early, or keeping weights fitted to another model;
- leaving the hand untested;
- refining a model whose twin was taken out, where the data read the law
  first (round 5's, which the Agent got right).

By round 5 the Agent made no wrong decision in three sessions; what the
critique found was in the tools. They had miscounted, misnamed and left
things out: bond valence on carbon, "R_int 0 %" for a merged file, a
Bijvoet difference called anomalous signal, a ratio a negative Fo² does
not have, "no hydrogen bond" left unsaid, a scale labelled OSF that was
OSF², and a weighting suggestion attributed to SHELXL that SHELXL never
gave.

Still open: no difference Fourier synthesis (every report should quote the
largest peak and hole, and a twin's data need detwinning first), and
derived esds that take the positions as independent (the cell's part is
now added, as SHELXL adds it).

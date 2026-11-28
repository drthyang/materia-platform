# Plan: sample preferred orientation

> **Status: decided by the owner on 2026-11-28 (section 0). Nothing here is
> built yet.** Step 0 (the GSAS-II bundle fix) is being built first; every
> later step waits for its own go. Each numbered QUESTION below keeps its
> options and recommendation for the record; section 0 gives the answers.
>
> Every number in this document comes from the formulas (a short script, kept
> outside the repository), from running the app's code on invented structures,
> or from running GSAS-II's own functions. No number comes from the owner's
> data. Bank angles are illustrative.
>
> Style and decision format follow the THY-89 plan
> (`docs/PLAN_MULTI_BANK.md`, branch `docs/plan-multi-bank`), which this plan
> refers to for the joint fit over several banks.

## The proposal in short

- The app already has March–Dollase preferred orientation on one axis. It is
  normalized and averaged over each family's symmetry equivalents, as it
  should be. The audit found three problems that give wrong numbers today:
  - the GSAS-II bundle drops the preferred orientation without saying so, a
    bug (verified by running);
  - magnetic peaks get no correction at all, so a textured magnetic sample
    puts its texture into the moments (verified by reading);
  - only the first phase of a multi-phase fit can have a texture (verified by
    running).
- Fix those first, on the model that exists. Then add the general model,
  spherical harmonics with cylindrical sample symmetry (Von Dreele 1997, as
  GSAS-II). Then make texture a property of the sample, described in the
  sample's frame, so one description serves every bank of a time-of-flight
  instrument (the THY-89 joint fit) and a capillary is not treated as a flat
  plate.
- Texture is part of the nuclear model. In the magnetic step it is held, as
  every nuclear parameter is, and the magnetic peaks use the parent phase's
  texture.
- Each step lands with its own validation: a known truth from a generator that
  imports nothing from the app, a negative control (no texture planted, none
  found), and a GSAS-II run on the same data.

**Words used here.**

- **Texture** or **preferred orientation (PO):** the crystallites of a powder
  are not oriented at random.
- **Pole density P_hkl(y):** how many times more often than at random the
  normals of the planes (hkl) point along the sample direction y. It is
  measured in m.r.d. (multiples of a random distribution). A random powder has
  P = 1 everywhere.
- **Fibre texture:** a texture with cylindrical symmetry about one sample axis.
  March–Dollase describes one.
- **α:** the angle, in the crystal, between a reflection's normal and the PO
  axis.
- **ψ:** the angle, in the sample, between the scattering vector Q and the
  sample's texture axis.

`GLOSSARY.md` has none of these words yet. The first step that adds a texture
model adds them.

## 0. Decisions (2026-11-28)

Decided by the owner, one question at a time, through the Session monitor.
The option chosen is quoted. Where an answer differs from the recommendation
in the question below, this section wins.

**Order of work**

- **Q16 GSAS-II bundle:** "(a) Fix now, own small PR". This is step 0, built
  first. Every later step waits for its own go, one step at a time.
- **Q1 Models:** "(b) Complete MD, then harmonics". March–Dollase on one axis
  is made complete (magnetic peaks, every phase, the GSAS-II export, analytic
  derivatives, validation). Spherical harmonics with cylindrical sample
  symmetry come next.
- **Q2 Exponential and Sasa–Uda:** "(a) Not offered".

**Science and validation**

- **Q6 Magnetic peaks:** "(a) Parent's texture per member". Each satellite
  member's P comes from the parent phase's texture, weighted by its own
  |F_M⊥|².
- **Q9 Per phase:** "(a) Every phase its own".
- **Q3 Geometry:** "(b) Per pattern, default flat plate". Today's function
  is the "flat plate in reflection" default, so projects that keep it keep
  their numbers.
- **Q4 Bank angles and frame:** "(c) From .instprm, editable". The angles
  come from the `.instprm` `2-theta` and `Azimuth`, checked against difC, and
  can be edited on the page; the azimuth defaults to 0. Frame as proposed:
  beam along +z, y up, the texture axis given in that frame, default vertical
  (the can axis).
- **Q5 Bank extent:** "(b) Pixel average with file, centre fallback". The
  owner has the NOMAD detector geometry file. The texture is averaged over
  each bank's pixels, weighted by solid angle, using the geometry file and
  the pixel-to-bank grouping. Without a file, the bank-centre approximation
  is used and stated. The file's format (Mantid IDF, DetCal, grouping) is
  read from the file itself. The file stays local; the owner gives its path
  when that step starts. Validation compares the pixel average with the
  centre approximation on the owner's data.
- **Q7 Highest order:** "(b) Up to 12". Start at the lowest order the Laue
  class allows and go up one order at a time on the Hamilton test, never
  automatically.
- **Q8 Positivity:** "(a) Report first, penalty if needed". A negative pole
  density is a finding in step 6. The grid penalty is added only if the
  known-truth or real-data runs show negative densities.
- **Q10 Guard:** "(b) Existing guard + move note". The existing correlation
  guard applies (refuse at |ρ| ≥ 0.95, report from 0.8), plus a note when
  freeing the texture moves a B, U or occupancy by more than 2 combined esds.
- **Q11 Real data:** "(a) Your GSAS-II project + (b) if found". The owner's
  local GSAS-II project with harmonic texture, kept local only. Also a public
  GSAS-II tutorial dataset with texture, if one is found and its licence
  allows.

**Page, Copilot and format**

- **Q12 Default axis:** "(b) Texture test's axis, else [001]". The field says
  which.
- **Q13 Tool shape:** "(a) Extend set_corrections". `preferredOrientation`
  stays as the single-axis shorthand; an optional `texture` object is added.
- **Q14 "(a capillary rarely is)":** "(b) now, (c) later". The text becomes
  "(a spun capillary is less prone, not immune)" now. It is dropped, with the
  geometry named, once the geometry menu exists.
- **Q15 Format:** "(a) New schema version". Texture is kept in one place, and
  old single-axis projects are migrated with the same function and the same
  numbers. Coordinated with THY-88's and THY-89's versions: they must not be
  in flight together.

**Joint fit**

- **Q17 THY-89 joint fit:** "(c) Shared + per-bank diagnostic". One texture
  per phase, shared by all banks, each bank's ψ from its angles, plus a
  per-bank fit offered as a diagnostic. This supersedes THY-89's note on its
  Q6 ("one ratio per bank on a shared axis"); THY-89's plan records that.

## 1. What exists today

### 1.1 The model

- **March–Dollase in the standard form** (Dollase 1986):
  `P(α) = (r² cos²α + sin²α / r)^(−3/2)`, with r = 1 meaning no texture
  ([`intensity.ts:21-50`](../../src/core/diffraction/intensity.ts)).
- **The axis is a reciprocal-lattice direction** [h k l]*. Both α and the axis
  length use the reciprocal metric tensor (`intensity.ts:37-46`). GSAS-II does
  the same (`GetPrefOri` calls `CosSinAngle(H, MDAxis, G)` with the reciprocal
  metric; read in GSAS-II 5.11.0, `GSASIIstrMath.py:3030-3042`).
- **Normalization.** The function integrates to 1 over the sphere, so it moves
  intensity between reflections without creating or removing any. Verified by
  running `marchDollase` over the sphere: 1 to 10⁻⁸ for r = 0.5, 0.8, 1.6
  and 3.
- **Symmetry equivalents are averaged, not taken from one member.** A powder
  line is the sum of its family's members, which lie at different angles to
  the axis. `marchDollaseFamily` takes the mean of P over the family's Laue
  equivalents (`intensity.ts:64-81`). GSAS-II does the same (`sumMD/len(uniq)`).
  For a cubic phase on [001] with r = 0.7, the (100) family gets 1.362. The
  listed member alone would give 0.586. Verified by running, and pinned by
  `intensity.test.ts:83`.
- **Where it enters.** P multiplies the unit intensity m·Lp·P·|F|²·scale, in
  that order (`intensity.ts:203-207`). The order matters for the geometry
  cache, which keeps intensities at unit scale (`powder.ts:620-628`, where
  `poRatio` is a geometry kind). PO is outside the corrections registry by
  design: the registry holds per-peak factors of 2θ, and PO depends on hkl
  (`corrections.ts:18-22`; `structureRefinement.ts:568-570`).

### 1.2 Data types

- **Every powder pattern:** constant wavelength and time of flight, X-ray and
  neutron. Nothing in `powderPeakIntensities` looks at the radiation or the
  geometry. Verified by running: a TOF pattern's intensities change by the
  family averages.
- **The UI box shows on every pattern.** The "texture" box and its axis field
  have no 2θ gate, unlike asymmetry and the flat-plate corrections
  (`PowderWorkbench.tsx:2316-2358`).
- **No geometry.** P depends on α only, as if Q always lay along the sample's
  texture axis. That is exact for a flat plate in symmetric reflection. For a
  capillary or a time-of-flight bank the fitted r is an effective value that
  describes the sample only approximately (section 3.3). GSAS-II's and
  FullProf's March–Dollase work the same way.

### 1.3 Refinement

- **One row,** `po`, labelled "MD ratio", kind `poRatio`. Bounds [0.2, 5],
  seed 1, bound to the pattern with the axis on the binding
  (`structureRefinement.ts:571-574`).
- **Fixed on load** with the structural kinds (`powderSpec.ts:25-29`). Freed in
  the guided "corrections" stage (`structureRefinement.ts:895`) and in the
  optional Corrections block of the method (`agent/method.ts:143`).
- **A changed axis** restarts the ratio at 1, fixed (`powderPage.ts:322-343`).
- **Esds** come from the covariance like any row. There is no special handling.
- **Derivatives by finite differences.** The analytic columns cover occupancy
  and B_iso only (`powder.ts:962-1013`). `poRatio` sits in the geometry kinds,
  so each column recomputes the structure factors.
- **One texture, on the first phase.** In a multi-phase fit only the first
  phase gets it (`multiPhaseSpec.ts:59-61`: the other phases' corrections are built
  without it). Verified by running `buildMultiPhaseSpec` with two phases: one
  `poRatio` row, bound to the first phase.

### 1.4 Magnetic peaks

Magnetic intensities are |F_M⊥|² summed over the family, times Lp, with no
preferred orientation (`magneticPowder.ts:161-169`). The `poRatio` kind is in
the magnetic geometry list (`magneticPowder.ts:51`), but only for the nuclear
part. Verified by reading. A textured magnetic sample therefore gets its
nuclear lines corrected and its magnetic lines not, and the moments absorb
the difference.

### 1.5 Exports

- **FullProf:** written. `Nor = 1` (modified March), `Pref1 = r`, `Pref2 = 0`,
  and the axis as `Pr1 Pr2 Pr3` (`fullprof.ts:201-210, 286-288, 323-324,
  416-418`). Verified by running a bundle with r = 0.7: `Pref1 = 0.70000`. The
  README lists it as carried (`bundle.ts:622`).
- **GSAS-II: dropped without a word. This is a bug.** `poRatio` is in
  `EXPORTED_KINDS` (`bundle.ts:168-172`), so the README does not list it as
  "not carried". But `gsas2Bundle` (`bundle.ts:462-575`) writes nothing of it:
  no `Pref.Ori.` in `build_gpx.py`. Verified by running a bundle with
  r = 0.7: no line of any file mentions it. The MCP `export_bundle`
  description says "preferred orientation" goes out with the refined values
  (`mcp/registry.ts:615`). That is true for FullProf only. A user who re-runs
  the fit in GSAS-II gets a random-powder model and a worse fit. GSAS-II's
  per-phase, per-histogram record is `'Pref.Ori.': ['MD', ratio, refine,
  [h, k, l], SHorder, {coefficients}, penalty hkls, tolerance]` (default
  `['MD', 1.0, False, [0, 0, 1], 0, {}, [], 0.1]`, `GSASIImath.py:6373`).
- **CIF and the report:** the "MD ratio" row appears in the report's
  instrument and sample table (`export/report.ts:422`). I found no place that
  writes the axis into the report or the CIF. Verified by reading.

### 1.6 The Copilot and the MCP tools

All of these are model-visible.

- **`set_corrections`** (`agent/tools.ts:451-454`; handler
  `powderTools.ts:324-344`): "`preferredOrientation` (March–Dollase along a
  reciprocal-lattice direction [h, k, l]; null turns it off)". Schema:
  `z.array(z.number().int()).length(3).nullable()`, described "[h, k, l], or
  null to turn texture off".
- **`get_state`:** `settings.corrections.preferredOrientation` (pinned by
  `executor.test.ts:412`). The ratio shows as an ordinary parameter row.
- **`diagnose_fit`:** a "texture" cause (`fitDiagnosis.ts:340-357`) and a
  `textureTest` field (`fitDiagnosis.ts:597`). The test fits the intensity
  misfit by March–Dollase on every low-index axis, indices in {−1, 0, 1}, with
  r from 0.5 to 2. Texture is named only when shuffled misfits rarely fit as
  well, chance below 1 % (`textureTest.ts:1-55`). Its action text ends "(a
  capillary rarely is)" (`fitDiagnosis.ts:352`; the page's version at
  `ui/fitCauses.ts:336-347`).
- **`assess_refinement`:** `poRatio` counts as a structural, intensity-borne
  parameter for the reflections-per-parameter check (`assessment.ts:164-165`).
  There is no texture-specific finding.
- **Other strings:** the corrections topic of `toolScope.ts:69`; the report
  label "texture" (`agent/report.ts:75`); `unexplainedPeaks.ts:71`; and the
  skill `my-rietveld-workflow` (`SKILL.md:282-283`), which links
  `knowledge/powder_background_texture_knowledge.md`.
- **MCP:** no tool switches texture on (`build_refinement` takes no PO). A
  client can only hand-write a `poRatio` binding. `export_bundle` carries it
  to FullProf only (above).

### 1.7 The saved project

- The workspace holds `corrections.preferredOrientation: [h, k, l]`, checked as
  three integers (`project/validate.ts:333-338`). The ratio is the `po` row in
  the saved parameters, and its binding carries the axis.
- The schema version is 2 (`docs/PROJECT_FORMAT.md`). Round trip and refusal of
  a bad axis are tested (`projectIo.test.ts:83-94`).
- Validation accepts [0, 0, 0]. `marchDollase` then returns 1, which is
  harmless; the UI refuses it.

### 1.8 Tests and goldens

- **Unit:** the formula, r = 1, and which reflections are enhanced
  (`features.test.ts:33-44`, `intensity.test.ts:63-92`). This includes the
  cubic family average.
- **Recovery:** r = 1.6 is recovered from a noiseless pattern made by the same
  code, to ±0.05 (`structureRefinement.test.ts:147-161`). It is not an
  independent truth, and it does not check "within esd".
- **Diagnostics:** the texture test on noise and on planted texture
  (`textureTest.test.ts`). `diagnose_fit` names texture on the axis it was
  simulated with, and names none on a correct model over 12 seeds
  (`fitDiagnosis.test.ts:66-76`). The page's wording (`fitCauses.test.ts`).
- **Agent:** `set_corrections` and `get_state` (`executor.test.ts:403-413`), and
  the `diagnose_fit` fields (`liveContracts.test.ts:25`). The tool descriptions
  are pinned in `agent/__snapshots__/model-text.arm-*.md`.
- **No GSAS-II comparison.** ROADMAP M6's gate "March–Dollase and Stephens
  coefficients match GSAS-II on one pattern" is open (⬜).
- **No golden, demo or eval scenario has texture switched on.** Verified by
  searching `src/examples`, `src/testSupport`, `examples/` and
  `src/agent/evals`. A change confined to texture therefore leaves every
  golden and the eval dump hash as they are, as long as the path with no
  texture is untouched.

### 1.9 Gaps, and how each was checked

| # | Gap | Checked by |
| --- | --- | --- |
| G1 | GSAS-II bundle drops PO silently; the MCP description claims it | running |
| G2 | No PO on magnetic peaks | reading |
| G3 | Only the first phase of a multi-phase fit can be textured | running |
| G4 | No sample geometry: capillary and TOF banks use the flat-plate form | reading, and the numbers of section 3.3 |
| G5 | The TOF instrument model keeps no bank angle or azimuth (`instrument.ts:49-110`), though `.instprm` files carry `2-theta` and `Azimuth` | reading |
| G6 | No analytic derivative for `poRatio` | reading |
| G7 | Report and CIF give the ratio without the axis | reading |
| G8 | No independent known-truth or GSAS-II check of PO | reading |
| G9 | "(a capillary rarely is)" in model-visible text: a spun capillary is less prone, not immune; needles align along a capillary when packed | reading; a physics judgment |

## 2. The models

### 2.1 March–Dollase (the March model, Dollase's form)

- **What it assumes.** Crystallites that are plates or needles, with a
  compression or a flow along one sample axis. The distribution of the
  crystallites' PO direction about that axis is
  `P(β) = (r² cos²β + sin²β / r)^(−3/2)`. Rotation about the crystallite's own
  axis is random. It is a fibre texture with one parameter (March 1932;
  Dollase 1986).
- **r < 1:** platelets whose normals line up with the axis; reflections along
  the axis are enhanced, P(0) = r⁻³. **r > 1:** needles lying across it.
- **Normalized** by construction (section 1.1).
- **Valid when** one crystal direction is the habit, the texture is mild to
  moderate, and the sample has cylindrical symmetry about one axis. It is
  economical: one number for a texture that the harmonics need order 8 to 16
  to reproduce (section 2.3).
- **Several axes.** GSAS (the earlier program) allowed several March–Dollase
  axes, each with a fraction (from its manual as I recall it; not checked in
  this work). The fractions sum to 1, so the sum stays
  normalized: `P = Σⱼ fⱼ P_MD(αⱼ; rⱼ)`.
  - GSAS-II has one axis per phase and histogram (the `Pref.Ori.` record,
    section 1.5).
  - FullProf's `Pref2` is a random fraction: `P = G2 + (1 − G2)·MD`.
  - The knowledge file warns that free extra axes become an arbitrary
    intensity correction. One axis with a random fraction is the safe
    extension.

### 2.2 Spherical harmonics

The general description, after Bunge (1982), used for Rietveld refinement by
Von Dreele (1997) and in GSAS-II. With cylindrical sample symmetry, as GSAS-II
writes it (`SHPOcal`, read in 5.11.0):

`P_h(ψ) = 1 + Σ_{L = 2, 4, …} (4π / (2L+1)) Σ_ν C_L^ν k_L^ν(h) k_L^0(ψ)`

- **k_L^ν(h)** are spherical harmonics symmetrized for the crystal's Laue
  class, evaluated at the reflection's direction. **k_L^0(ψ)** are the
  sample's harmonics. With cylindrical symmetry only the m = 0 term is left,
  a function of ψ alone.
- **Even orders only.** Friedel's law makes every pole figure centrosymmetric,
  so diffraction cannot see the odd-order coefficients.
- **Normalized** automatically: every term with L ≥ 2 integrates to zero over
  the sphere.
- **Equivalents are handled by construction.** The k_L^ν(h) are invariant
  under the Laue group, so every member of a family has the same value.
  GSAS-II evaluates the listed member only, which is then the same as the
  average.
- **Positivity is not guaranteed.** A truncated series can go below zero.
  GSAS-II offers a penalty for chosen hkls ("Penalty hkls", "Zero MRD
  tolerance", default 0.1) on the per-histogram harmonics, and a
  negative-pole-figure restraint on the phase texture (`penaltyFxn`, read in
  5.11.0).
- **Texture index:** `J = 1 + Σ C²/(2L+1)` (GSAS-II `textureIndex`). J = 1
  means random. For the fibre that March–Dollase describes, J = ½∫P_MD² d(cos β):
  1.05 at r = 0.85, 1.28 at r = 0.7, 2.46 at r = 0.5, 1.27 at r = 1.5 and
  1.78 at r = 2 (computed). That GSAS-II's normalization of C gives the same J
  for the same texture is to be checked numerically in the harmonics step.
- **How many coefficients.** Cumulative counts up to L_max with cylindrical
  sample symmetry, from GSAS-II's `GenSHCoeffT` (run in 5.11.0):

  | Laue class | L ≤ 2 | ≤ 4 | ≤ 6 | ≤ 8 | ≤ 10 | ≤ 12 |
  | --- | --- | --- | --- | --- | --- | --- |
  | −1 | 5 | 14 | 27 | 44 | 65 | 90 |
  | 2/m | 3 | 8 | 15 | 24 | 35 | 48 |
  | mmm | 2 | 5 | 9 | 14 | 20 | 27 |
  | 4/m | 1 | 4 | 7 | 12 | 17 | 24 |
  | 4/mmm | 1 | 3 | 5 | 8 | 11 | 15 |
  | −3 | 1 | 4 | 9 | 14 | 21 | 30 |
  | −3m | 1 | 3 | 6 | 9 | 13 | 18 |
  | 6/m | 1 | 2 | 5 | 8 | 11 | 16 |
  | 6/mmm | 1 | 2 | 4 | 6 | 8 | 11 |
  | m−3, m−3m | 0 | 1 | 2 | 3 | 4 | 6 |

  GSAS-II treats m−3 and m−3m alike (`OdfChk`). A cubic phase has no L = 2
  term: no texture of order 2 can be seen on a cubic powder.
- **Valid when** the texture is not one fibre about a crystal direction, or is
  weak and of unknown kind, or several datasets look at the sample along
  different directions (banks, tilts). Then one set of coefficients describes
  them all.

### 2.3 March–Dollase against harmonics

A March–Dollase fibre expands exactly in Legendre polynomials:
`P_MD(x) = Σ_L (2L+1) a_L P_L(x)`, with `a_L = ½∫ P_MD(x) P_L(x) dx`.
Truncating at L_max shows the order the harmonics need for the same texture
(computed, largest relative error over α, Q along the axis):

| r | L ≤ 4 | ≤ 6 | ≤ 8 | ≤ 12 | ≤ 16 |
| --- | --- | --- | --- | --- | --- |
| 0.85 | 1.3 % | 0.2 % | 0.03 % | | |
| 0.7 | 9.8 % | 3.2 % | 1.0 % | 0.09 % | |
| 0.5 | 71 % | 39 % | 21 % | 5.6 % | 1.4 % |
| 1.5 | 53 % | 20 % | 7.4 % | 0.9 % | 0.1 % |

So March–Dollase stays the right model for a strong texture along one crystal
direction. The harmonics suit weak or complex textures, and a sample seen
along several directions.

### 2.4 Other models

- **Rietveld's exponential** (Rietveld 1969): `P = exp(−G1 α²)`. FullProf
  offers it with a random fraction as `Nor = 0` ("Rietveld–Toraya"),
  `P = G2 + (1 − G2) exp(−G1 α²)`. I recall that form from the FullProf manual
  but have not checked it in this work; the attribution to Toraya (Toraya &
  Marumo 1981) is uncertain. It is **not normalized**: the scale absorbs the
  difference, and the scale then correlates with the texture.
- **Sasa–Uda:** named in RIETAN. I am not confident of its formula or its
  reference (I believe Sasa & Uda 1976, J. Solid State Chem.), so I state
  neither. Uncertain.

Neither is proposed (QUESTION 2).

### 2.5 What GSAS-II and FullProf do

| | GSAS-II 5.11.0 (read in the source) | FullProf (manual, as I recall it; to check) |
| --- | --- | --- |
| March–Dollase | one axis per phase and histogram; mean over equivalents; analytic derivative | `Nor = 1`, `Pref1` = r, `Pref2` = random fraction, axis `Pr1 Pr2 Pr3` per phase |
| Exponential | no | `Nor = 0` |
| Harmonics, per histogram | cylindrical sample symmetry, even L, Laue-class terms, per phase and histogram, with a positivity penalty | whether FullProf offers harmonics for powders, and with which flag, I could not confirm |
| Harmonics, phase texture | one set per phase shared by every histogram; sample symmetry cylindrical, none, 2/m or mmm; sample angles per histogram; a texture restraint | |
| Geometry | MD: none. Harmonics: ψ from the goniometer angles, 2θ, azimuth (`SamAng`). TOF uses the bank's `2-theta` | to check |
| Magnetic | a magnetic phase carries its own PO record, applied to each of its reflections (inferred from `GetIntensityCorr`; not run) | to check |

Whether FullProf averages March–Dollase over the equivalents I could not
confirm. A FullProf run on the cubic (100) family on [001] settles it at once:
r⁻³ or r^1.5 for one member, (2r⁻³ + 4r^1.5)/6 for the average. Until then
the FullProf export of March–Dollase is checked only on axes where the two
agree (a unique axis of a non-cubic phase).

### QUESTION 1: which models in the first delivery?

- **(a) March–Dollase on one axis, made complete:** magnetic peaks, every
  phase, the GSAS-II export, analytic derivative, validation. No new model.
- **(b) (a), then harmonics with cylindrical sample symmetry,** in steps.
- **(c) (b), plus several March–Dollase axes with fractions.**
- **(d) (b), plus FullProf's random fraction (`Pref2`) on the one axis.**

**Recommendation: (b).** (a) closes the wrong-number gaps on the model users
already have. The harmonics then give the general model and the clean
multi-bank description. Several axes only when a dataset shows the need,
because free extra axes fit anything. The random fraction trades almost
exactly with r on a mild texture.

### QUESTION 2: the exponential and Sasa–Uda functions?

- **(a) Not offered.** The exponential is not normalized, Sasa–Uda's form is
  not verified here, and March–Dollase covers the same case.
- **(b) Offered,** for parity with FullProf.

**Recommendation: (a).** The FullProf export keeps writing `Nor = 1`.

## 3. The physics

### 3.1 Intensity is conserved

A texture moves intensity between directions; it creates none. Every proposed
model integrates to 1 over the sphere (March–Dollase and fractions summing to
1 by construction, the harmonics term by term), so the scale keeps its
meaning. Over a finite d range the multiplicity-weighted mean of P over the
measured reflections is close to 1 but not exactly 1. That is why scale and
texture correlate weakly (section 3.5).

### 3.2 Multiplicity and equivalents

The intensity of a line is a sum over its members. With texture each member
has its own P. For nuclear scattering without anomalous dispersion every
member has the same |F|², so

`I_line = |F|² Lp Σ_members P = m |F|² Lp ⟨P⟩_family`.

The rule: **P is averaged over the family, never taken from one member.** The
app does this for March–Dollase (section 1.1). The harmonics satisfy it
automatically. The magnetic case is different (section 3.7).

### 3.3 The geometry: P depends on where Q points in the sample

The pole density is read along Q, in the sample's frame. Set the lab frame
with the incident beam along +z, x horizontal and y vertical. A detector at
scattering angle 2θ and azimuth η about the beam (η = 0 in the horizontal
plane) sees

`Q̂ = (cos θ cos η, cos θ sin η, −sin θ)`.

With the sample's texture axis along a unit vector A, `cos ψ = |Q̂·A|`.

For a fibre texture, the pole density of a reflection at α to the fibre
direction, read at ψ to the fibre axis, is (exact, from the March–Dollase
distribution):

`P(α, ψ) = (1/π) ∫₀^π P_MD(β) dφ`, with `cos β = cos α cos ψ + sin α sin ψ cos φ`,

or, by the addition theorem, `P(α, ψ) = Σ_L (2L+1) a_L P_L(cos α) P_L(cos ψ)`.
At ψ = 0 this is the plain March–Dollase form, exactly.

**The geometries**

- **Bragg–Brentano flat plate, symmetric reflection.** The plate normal
  bisects the beams, so Q is along the normal for every reflection: ψ = 0. The
  plain form is exact, and the r found is the sample's. This is today's
  model.
- **Flat plate in symmetric transmission** (normal along the beam):
  ψ = 90° − θ, which changes with the reflection.
- **Debye–Scherrer capillary**, axis vertical, detector in the horizontal
  plane: Q ⊥ axis, ψ = 90° for every reflection. For a fibre about the
  capillary axis, the plain form with r is wrong. A plain form with an
  effective ratio r' = r^(−1/2) is exact at α = 0 and off elsewhere:
  - by 1.1 % at r = 0.85;
  - by 5.1 % at r = 0.7;
  - by 6.5 % at r = 1.5;
  - by 17 % at r = 0.5 and at r = 2.

  (Computed.) So on a capillary the March–Dollase r that GSAS-II or FullProf
  report is an effective value, and its function is not quite the sample's.
  Whether Dollase's paper treats the capillary case this way I have not
  checked; the derivation above is mine and is to be checked against it.
- **Time of flight, several banks.** Each bank sits at a fixed (2θ_b, η_b).
  Every reflection in it is seen at the same ψ_b, and ψ_b differs from bank to
  bank. Illustrative banks at 2θ = 15°, 31°, 65°, 120° and 150°, all in the
  horizontal plane:
  - **fibre about a vertical can axis:** ψ = 90° in every bank. One texture
    gives the same P in every bank.
  - **axis along the beam** (a plate or pellet facing the beam): ψ = 82.5°,
    74.5°, 57.5°, 30° and 15°. At r = 0.7 the (00l) lines then get
    P = 0.60, 0.63, 0.80, 1.62 and 2.43 bank by bank, and the (hk0) lines
    1.34, 1.24, 0.96, 0.67 and 0.61.

  So "one March–Dollase ratio per bank" fits five different numbers to one
  sample. A model in the sample's frame fits one texture and lets each bank's
  geometry do the rest. That is the physics, and it is what makes texture
  shareable in the THY-89 joint fit (QUESTION 17).
- **A bank is not a point.** A bank spans a range of angles. Its focused
  pattern averages P over its pixels. For a can-axis fibre at r = 0.7 and a
  bank centred at 2θ = 90°, P(00l) is 0.586 at the centre, and 0.589, 0.598
  and 0.613 averaged over ±10°, ±20° and ±30° out of the plane (computed).
  Reduced data do not carry the pixel distribution. So the first delivery
  uses each bank's centre and states the approximation (QUESTION 5).

### QUESTION 3: should the model know the sample geometry?

- **(a) No, as today and as GSAS-II's and FullProf's March–Dollase.** P(α)
  everywhere. On a capillary or a TOF bank the ratio is an effective value.
- **(b) Yes, per pattern.** The user states the geometry: flat plate in
  reflection (ψ = 0), capillary (ψ = 90°), flat plate in transmission
  (ψ = 90° − θ), or a TOF bank (ψ from its angles). March–Dollase uses
  P(α, ψ), and the harmonics use k_L^0(ψ). The default is "flat plate in
  reflection", which is today's function, so existing projects give the same
  numbers.
- **(c) Only for TOF banks in a joint fit;** (a) everywhere else.

**Recommendation: (b).** It is the correct physics, and with that default it
changes nothing until the user says the sample is a capillary or a bank. The
report and the GSAS-II comparison state the geometry. Comparisons with
GSAS-II's March–Dollase use the "reflection" geometry, which is GSAS-II's
function. One consequence the owner sees before it merges: a textured TOF
project switched to its bank geometry gets different numbers, because the
function changes.

### QUESTION 4: where do a TOF bank's angles come from, and in which frame?

- **(a) From the instrument file:** the GSAS-II `.instprm` `2-theta` and
  `Azimuth` of each bank (the app does not keep them today, G5). Each angle is
  checked against the bank's difC, as THY-89 decided for absorption:
  `difC ≈ 505.56 · L · sin θ`. A bank whose angle and difC disagree is named,
  and its texture geometry refused.
- **(b) Entered by the user, per bank.**
- **(c) (a), editable on the page;** the azimuth defaults to 0 (horizontal).

And the frame: the lab frame above (beam +z, y up); the sample's texture
axis given in that frame; the default axis vertical (the can axis).

**Recommendation: (c), with that frame and default.** A FullProf `.irf` has
its own angle keyword, to be confirmed before it is read.

### QUESTION 5: a bank's extent

- **(a) Each bank's centre,** with the approximation stated in the report
  (about 5 % on P(00l) at r = 0.7 for a bank ±30° out of the plane).
- **(b) An average over the bank's pixels,** when a geometry file gives
  them.

**Recommendation: (a) now; (b) only if a dataset needs it.**

### 3.4 Neutron and X-ray

- **The same sample has one texture,** but the two probes may not see the
  same one:
  - a laboratory X-ray flat plate samples a surface layer a few tens of
    micrometres deep, where packing orients platelets most;
  - neutrons in a can average the whole volume.

  So r from an X-ray plate and from a neutron can of the same powder may
  differ. In a joint X-ray and neutron fit (a roadmap item, not this plan),
  the texture belongs to the specimen, not to the phase.
- **The formula is the same for both.** Absorption differs: X-ray
  absorption in a capillary is a θ term (the existing μR). It does not
  depend on direction, so it separates from texture where reflections at one
  angle lie at different α.

### 3.5 Correlations

Texture changes intensity by direction in the crystal. Anything else that
changes intensities with a pattern resembling direction can trade with it:

- **ADPs.** An isotropic B goes with d, not direction, so B and r separate
  when each d shell holds reflections at several α. They do not separate when
  the PO direction and d are tied: in a layered phase with a long c, the
  (00l) lines are the long-d lines. Anisotropic U₃₃ against an axis along c is
  the worst case: both act on (00l) against (hk0).
- **Occupancies.** An occupancy changes |F|² of particular reflections. When
  those share a direction class (all (00l) in a layered compound), texture can
  take up an occupancy, or the reverse.
- **Scale.** Weak (section 3.1). Strong only for the unnormalized exponential.
- **Absorption.** A function of θ (CW) or λ (TOF), not of direction. Weak,
  except where direction and d coincide.
- **Extinction** (powder, when added). It cuts the strongest lines. If they
  share a direction (the strong (00l) of a layered phase), it trades with
  texture.
- **Phase fractions.** A phase's texture changes its total only through the
  finite-range mean, but a minority phase with few lines can trade its
  fraction against its texture.
- **Magnetic moments.** The moment direction weights magnetic intensities by
  direction (only the part ⊥ Q scatters). With moments along c the magnetic
  (00l) lines vanish, and an axis along c also acts on (00l). They correlate
  whenever both are free. The rule that the moments refine with the nuclear
  model held (ADR 0006) keeps them apart: texture is fitted on the nuclear
  lines and held.

### 3.6 What the method already says

The skill and the knowledge file already say: texture after the structure,
on evidence, never with the occupancies in one stage. This plan keeps that
and adds the guard of section 4.3.

### 3.7 Magnetic peaks

The magnetic peaks come from the same crystallites, so the same texture acts
on them. Two points matter:

- **Directions.** A satellite member is at Q = G + k. Its P is read at that
  direction in the parent's reciprocal frame, with α to the parent's PO axis.
  P is not read at G, and not at a magnetic-cell hkl.
- **Weights.** Unlike |F_N|², |F_M⊥|² differs between the members of a line:
  the perpendicular part of the moment depends on each member's direction.
  The correct line intensity is `Σ_members P(member) |F_M⊥(member)|²`, not
  `⟨P⟩ · Σ |F_M⊥|²`. The two agree only if P or |F_M⊥|² is the same across
  the members.

The textured magnetic phase has no texture of its own: it shares its parent's
(QUESTION 6).

### QUESTION 6: texture on magnetic peaks

- **(a) The parent's texture, per member,** weighted by each member's
  |F_M⊥|².
- **(b) The parent's mean P per line.** Cheaper, and wrong whenever the
  members' |F_M⊥|² differ.
- **(c) None, as today.**

**Recommendation: (a).** It is the physics. (c) puts the texture into the
moments.

## 4. Refinement

### 4.1 The parameters

| Row | Kind | Bounds | Seed | Stage |
| --- | --- | --- | --- | --- |
| March–Dollase ratio r, per phase | `poRatio` (exists) | [0.2, 5] (exists) | 1, fixed | corrections |
| Random fraction (only if QUESTION 1 (d)) | new `poRandom` | [0, 1] | 0, fixed | corrections, after r |
| Harmonic coefficient C_L^ν, per phase | new `textureHarmonic`, keyed "L,ν" | none; positivity checked | 0, fixed | corrections, order by order |

- **The axis is not refined.** It is a choice of the user or of the texture
  test, as in GSAS-II and FullProf.
- **The bounds stay [0.2, 5].** At r = 0.2, P(0) = 125: anything near a bound
  is reported as at a bound, as every bounded row is.
- **The harmonics refine order by order:** L = 2 (L = 4 for cubic), then add
  the next order only if the Hamilton test on wR says it is significant. Each
  order's step is reported. The page never raises the order by itself
  (QUESTION 7).
- **Positivity.** After each harmonic fit the pole density is evaluated on a
  grid of directions for the phase's strongest families (GSAS-II's practice
  is the guide). A value below 0 is a finding (section 6.2). Whether to add a
  penalty, as GSAS-II does, is QUESTION 8.
- **Reported with each texture fit:** J, the range of P over the measured
  reflections, and the three most-corrected families.

### QUESTION 7: the highest harmonic order

- **(a) Up to 8.**
- **(b) Up to 12.**
- **(c) Up to 20,** with warnings.

In every case the fit starts at the lowest order the Laue class allows and
goes up one order at a time on the Hamilton test, never automatically.

**Recommendation: (b).** An r = 0.7 fibre needs L = 8 for 1 % (section 2.3).
Beyond 12 the texture is strong along one direction, and March–Dollase is the
better model.

### QUESTION 8: positivity of the harmonics

- **(a) Report a negative pole density** as a finding, nothing more.
- **(b) (a), plus a penalty on a grid,** as GSAS-II's "Zero MRD tolerance".
- **(c) A hard constraint.**

**Recommendation: (a) in the harmonics step, then (b)** if the known-truth or
real-data runs show negative densities in practice.

### 4.2 Per phase, and the magnetic phase

- **Each phase has its own texture** (its own model, axis in its own
  lattice, rows), as in GSAS-II and FullProf. Its rows are named with the
  phase, as the other per-phase rows are.
- **A magnetic model shares its nuclear parent's texture:** no rows of its
  own (section 3.7). In the magnetic step those rows are held with the rest of
  the nuclear model (ADR 0006).

### QUESTION 9: per-phase texture in multi-phase fits?

- **(a) Per phase,** each phase its own model and rows.
- **(b) The first phase only,** as today.

**Recommendation: (a).** A minority phase can be as textured as the main one.
Today its misfit lands in its fraction and ADPs.

### 4.3 The guard against texture absorbing the structure

The existing correlation guard (`core/diagnostics/correlationGuard.ts`,
`CORRELATION_LIMIT` 0.95, `CORRELATION_REPORTED` 0.8 in `thresholds.ts`)
already refuses any pair at |ρ| ≥ 0.95 and reports pairs from 0.8. Texture
needs no new threshold, only two additions:

- **A correlation hint** for each pair of a texture row with a B, U, an
  occupancy, a phase fraction or a moment. It gives the reason in one line,
  as the registry's `correlations` do for the corrections, so a refusal or a
  note says why the pair trades.
- **A "texture moved the structure" check.** When a texture row is first
  freed, compare every free B, U and occupancy with its value before. A
  change of more than 2 combined esds is a note: "freeing the texture moved
  B(O1) by 3.1 esd". It means the two describe the same misfit, and the
  structure needs an independent check. The correlation does not always show
  it, because the parameters may be refined in different stages.

### QUESTION 10: the warning rule for texture against the structure

- **(a) The existing guard only** (refuse at 0.95, report from 0.8), with the
  pair hints.
- **(b) (a), plus the "texture moved the structure" note** at 2 esd.
- **(c) A stricter refusal for texture pairs** (at 0.9).

**Recommendation: (b).** One threshold for every pair keeps the rule simple.
The moved-structure note catches the case the correlation misses.

### 4.4 Derivatives

P multiplies the unit intensity and does not move a peak. So
∂I/∂(texture row) = I · (∂P/∂row) / P, which is free of coupling exactly as
occupancy and B are. March–Dollase (`∂P/∂r`, as in GSAS-II's
`GetPrefOriDerv`) and every harmonic coefficient (∂P/∂C = (4π/(2L+1)) k k,
linear) get analytic columns. Each passes the F1.1 gate
(`analyticJacobian.test.ts`: analytic against central finite differences on
a realistic model) before it is used. Ties and restraints fall back to finite
differences, as today.

## 5. Validation

The project's standard: a truth the app did not make, a control where
nothing is planted, the reference program on the same data, and real data
where it exists.

### 5.1 Consistency (no outside data)

- **Bit-identical off and on.** With texture off, and with single-axis
  March–Dollase in the default geometry, every golden, the demo dump and the
  eval dump hash are unchanged. P stays where it is in the product
  m·Lp·P·|F|²·scale.
- **Normalization:** each model integrates to 1 over the sphere (10⁻⁸).
- **Equivalents:** permuting a family's members changes nothing. For the
  harmonics, every member gives the same P, to 10⁻¹².
- **Limits:** P(α, 0) equals the plain form to 10⁻¹². A harmonic series
  fitted to March–Dollase reproduces the truncation table of section 2.3.
- **Derivatives:** the F1.1 gate.

### 5.2 Known truth from an independent generator

A generator in `scripts/texture/` that imports nothing from the app (as
`scripts/tof-profile/` does for THY-88). It has its own structure factors,
profile, texture function and seeded counting noise, and its own small
reference for each model.

- **Cases:**
  - CW flat plate, March–Dollase r = 0.6 and 1.4;
  - CW capillary, r = 0.7;
  - harmonics of order 4 on a tetragonal phase;
  - a TOF instrument with three or more banks at different (2θ, η) and one
    sample texture (axis along the beam, so ψ differs per bank);
  - a nuclear and magnetic case whose texture acts on the magnetic lines.
- **Pass:**
  - every texture parameter within 3 esd on each seed;
  - over 20 seeds, the scatter of (fitted − true)/esd between 0.7 and 1.3;
  - the structure within 3 esd with texture free;
  - the magnetic case recovers the moments only with section 3.7's
    correction. Without it, the bias is reported.
- **Negative controls:**
  - no texture planted: r within 2 esd of 1, and every C within 2 esd of 0,
    on 20 seeds. J − 1 within its esd;
  - the texture test names no texture on more than 1 seed in 20 (the
    existing test's design);
  - a planted *wrong* model (a B error, an occupancy error) with texture
    free: the guard's note fires, and the texture does not swallow the error
    silently.
- **Run time.** These run opt-in (an environment flag, as
  `test:local-xrd`), with per-case timeouts and a 30-minute cap. CI runs
  only the committed fixture checks (section 7.3).

### 5.3 Against GSAS-II

As THY-88 and THY-91 did: GSAS-II 5.11.0 through `GSASIIscriptable`, in the
local environment the validation engine uses, never in CI. Its outputs are
written as JSON fixtures with their source (GSAS-II's licence allows it, as
for `tofKnownTruth.json`).

- **Per reflection, no refinement:**
  - P_hkl from GSAS-II's own `GetPrefOri` and `SHPOcal`, for a set of
    phases (cubic, tetragonal, hexagonal, monoclinic), axes and orders, at
    several ψ via its sample angles;
  - the app's values against them, to 10⁻⁹ relative.

  This pins every convention: axis metric, harmonic normalization, sign, and
  GSAS-II's ψ for each instrument type. For Bragg–Brentano, `SamAng` gives
  ψ = 90° with GSAS-II's own sample angles (run in 5.11.0). So its "sample
  axis" convention must be mapped, not assumed.
- **Refinement mirror:**
  - the same synthetic patterns refined in GSAS-II and in the app, from the
    same start;
  - agreement means every texture parameter and every shared structure
    parameter within 2 combined esds, with wR side by side (the THY-89 Q24
    bar).
- **The exported bundle** (after the G1 fix) opens in GSAS-II, carries
  `Pref.Ori.`, and refines to the same values.

### 5.4 Real data

- **Committed examples:** none with a known texture (`examples/` holds the
  Mn₃Ga, GaTa₄Se₈ NOMAD and MCP examples, none textured).
- **The owner's local data folder** (git-ignored): one GSAS-II project there
  refines an 8th-order harmonic texture on a time-of-flight bank of a
  hexagonal phase. Found by scanning the local projects' `Pref.Ori.` records;
  named here only generically, as the data policy requires. It can serve as a
  local check (the app's harmonics against GSAS-II's on that project), with
  no number in the repository. No local FullProf `.pcr` refines a texture.
- **A public textured dataset:** none identified offline. GSAS-II's tutorial
  collection is the place to look, under ADR 0005 (fetched by an opt-in
  script, never committed).

### QUESTION 11: which real data?

- **(a) The owner's local GSAS-II project** with harmonic texture, as a
  local-only check.
- **(b) A public dataset** from GSAS-II's tutorials, once one with texture is
  identified and its licence read.
- **(c) A new measurement** of a known platy standard, flat plate in
  reflection.

**Recommendation: (a) as the real-data check for the harmonics step, and (b)
as the public case if one is found.** (c) only if neither works out. The
owner knows whether that project's texture is trusted.

## 6. The page, the Copilot and the MCP tools

### 6.1 The Corrections row

Today: a "texture" box and an axis field "0 0 1".

**Proposed**

```
corrections  [ ] asymmetry  [ ] displacement ...   texture [March–Dollase v]  axis [0 0 1]  geometry [flat plate (reflection) v]
             (with harmonics:)                     texture [harmonics v]      order [4 v]   geometry [...]
             (several phases:) one texture line per phase, named with the phase
```

- **The model menu:** none, March–Dollase, harmonics. The axis field shows
  for March–Dollase, the order for harmonics.
- **The geometry menu** (QUESTION 3): flat plate in reflection, flat plate in
  transmission, capillary, TOF bank. On TOF data it is preset from the bank
  angles (QUESTION 4) and shows them.
- **The default axis** (QUESTION 12): the axis the texture test named, if it
  named one, marked "from the texture test"; otherwise [0 0 1], marked
  "default".
- **After a fit,** in the Validation tab: J, the range of P, and a small
  plot of P against α (March–Dollase) or a pole figure of the strongest
  family (harmonics).
- **Wording** follows the concise-UI rule: one plain line, details behind
  "?".

### QUESTION 12: the default axis when texture is switched on

- **(a) [0 0 1],** as today.
- **(b) The axis the texture test named,** if it named one; otherwise
  [0 0 1]. The field says which.
- **(c) No default.** The user must choose.

**Recommendation: (b).** The test's axis is evidence; [0 0 1] is not. For a
cubic phase the field still says that [0 0 1] is only a default.

### 6.2 Model-visible pieces

Model-visible text is frozen unless the owner approves. These would change,
each listed with what it becomes in outline. The exact wording goes to the
owner.

| Where | Today | Change |
| --- | --- | --- |
| `set_corrections` description (`tools.ts:451`) | `preferredOrientation` March–Dollase [h, k, l] | the same, plus an optional `texture` object (model, axis or order, geometry, phase) |
| `set_corrections` schema (`tools.ts:454`) | `preferredOrientation` int[3] or null | unchanged; add `texture` (QUESTION 13) |
| `get_state` | `settings.corrections.preferredOrientation` | the same, plus `texture` per phase: model, axis or order, geometry, J and P range after a fit |
| `diagnose_fit` texture cause (`fitDiagnosis.ts:351-352`) | March–Dollase evidence and action; "(a capillary rarely is)" | per phase; the action names the geometry; the capillary clause (QUESTION 14) |
| `diagnose_fit.textureTest` (`fitDiagnosis.ts:597`) | one test | one per phase |
| `assess_refinement` | none for texture | new findings: a texture pair near the limit, texture moved the structure, negative pole density, texture at a bound |
| `export_bundle` (`mcp/registry.ts:615`) | claims PO for both targets | becomes true with the G1 fix; no text change needed |
| Skill `my-rietveld-workflow` (`SKILL.md:282-283`) | March–Dollase, `preferredOrientation` | add the harmonics and the geometry in one line; budget: THY-91 found 3 characters left in this skill, so a line elsewhere must go, or the rule stays in the tool description |
| `toolScope.ts:69` | topic regex | add "harmonic", "pole" |

Each change needs:

- the owner's approval of the wording;
- the snapshot update (`model-text.arm-b.md`, `arm-c.md`);
- scripted eval scenarios, a good and a bad run each:
  - texture freed with the occupancies;
  - an axis that the texture test did not name;
  - harmonics raised to order 12 on 30 reflections;
  - texture on the magnetic step;
- a local-model run;
- the paid re-baseline that goes with a release.

That makes the Copilot its own late step, as in THY-89.

### QUESTION 13: the tool's shape

- **(a) `set_corrections` keeps `preferredOrientation` [h, k, l]** as the
  shorthand for single-axis March–Dollase, and gains an optional `texture`
  object for the rest.
- **(b) A new `set_texture` tool.**
- **(c) `texture` replaces `preferredOrientation`.**

**Recommendation: (a).** There are fewer tools to choose among, and prompts
and scenarios that use `preferredOrientation` keep working.

### QUESTION 14: "(a capillary rarely is)"

The action text of the texture cause ends with this clause. A spun capillary
is less prone to texture, not immune to it: packed needles and plates do
orient.

- **(a) Keep it.**
- **(b) Change it to "(a spun capillary is less prone, not immune)".**
- **(c) Drop it,** and name the geometry the texture would be fitted in.

**Recommendation: (c),** once the geometry menu exists. Until then, (b).

### 6.3 MCP tools

- **`build_refinement`** gains an optional `texture` (model, axis or order,
  geometry). Today no MCP tool can switch texture on.
- **`export_bundle`** carries it to both programs.
- **`parse_instrument`** returns each bank's angle and azimuth (G5).

MCP descriptions are not snapshot-pinned, but the generated tool tables and
the result shapes are tested.

## 7. Save format, goldens and CI

### 7.1 The saved project

- **Today:** `corrections.preferredOrientation` [h k l] plus the `po` row
  (section 1.7).
- **New:** a `texture` block per phase (model, axis, or order and the
  coefficient rows' ids, and the geometry per pattern).

### QUESTION 15: how should the format change?

- **(a) A new schema version.** `texture` replaces
  `corrections.preferredOrientation`. The migration moves an old axis into
  the first phase's `texture` as March–Dollase with "flat plate in
  reflection", which is the same function, and keeps the `po` row's id and
  value. An old build refuses the new file with a clear message.
- **(b) Optional fields, no version bump.** An old build would open a file
  with harmonics or a second phase's texture, ignore it, and refit a
  different model without a word.
- **(c) Keep `preferredOrientation` for single-axis March–Dollase,** and add
  a new block with a version bump for anything else.

**Recommendation: (a).**

- It gives one place for texture, and old files keep their numbers. The
  guarantee is tested: saved version-2 projects with texture open, show the
  same wR, and refit bit for bit.
- It is coordinated with THY-88's and THY-89's own versions. Per THY-89's
  Q12, each change gets its own version, and they are not in flight together.
- It comes with the first step that saves something new: per-phase texture.

### 7.2 Goldens and eval dumps

- **No golden, demo or eval scenario has texture on** (section 1.8). The
  steps up to and including the per-phase step move no committed number. Each
  step proves it with the eval dump hash and the demo dump, as THY-91 did.
- **The model-visible step** changes the snapshots. With the owner's
  approval, it needs a re-baseline.

### 7.3 CI

CI already runs about 22 to 34 minutes, near the 30-minute cap. So:

- every new CI test runs in seconds: unit checks, the F1.1 columns, and the
  committed GSAS-II and generator fixtures on small patterns;
- the seeded studies, the GSAS-II mirror and real data run opt-in, locally;
- each step reports its CI time against main's, and a step that adds more
  than 30 s of CI time is reworked.

## 8. Delivery in steps

Each step merges on its own with its tests, and leaves projects without
texture exactly as they were. Hours are builder-hours and rough. On this
project such estimates have run about two times low: the sizes below add up
to 140 hours, so expect nearer 280.

0. **Fix the GSAS-II bundle** (G1; 4 h). Write `Pref.Ori.` (`['MD', r,
   False, [h, k, l], …]`) through `build_gpx.py`, and list anything the
   bundle cannot carry. *Gate:* GSAS-II opens the bundle, shows the ratio and
   axis, and a refinement there reproduces the app's r within 2 esd.
   Independent of everything else (QUESTION 16).
1. **The texture module and analytic derivatives** (8 h). One
   `core/diffraction/texture.ts` holds March–Dollase as today, behind a model
   type. Add the analytic `poRatio` column. *Gate:* bit-identical goldens and
   eval dump; the F1.1 gate for `poRatio`.
2. **Validation of March–Dollase** (14 h). The generator of 5.2 for CW (flat
   plate) and TOF single bank, negative controls, GSAS-II per reflection and
   refinement mirror, the FullProf cubic check if the owner runs it.
   *Gate:* 5.2 and 5.3 pass. This closes ROADMAP M6's March–Dollase gate.
3. **Magnetic peaks** (12 h). Each satellite member's P from the parent's
   texture, weighted by its own |F_M⊥|² (section 3.7). *Gate:* the known-truth
   magnetic case; without texture, bit-identical; a GSAS-II magnetic case
   with March–Dollase if GSAS-II's mirror can express it.
4. **Per-phase texture and the format version** (14 h). *Gate:* two textured
   phases recovered; old projects open and refit bit for bit; History steps
   migrate.
5. **Sample geometry** (18 h). ψ per pattern: P(α, ψ) for March–Dollase; bank
   angles kept from `.instprm` with the difC check (G5). *Gate:* P(α, 0) equals
   today's to 10⁻¹²; the capillary and multi-bank known-truth cases. Choosing
   a capillary or bank geometry on a textured project changes its numbers;
   the default ("flat plate in reflection") does not. The owner sees an
   example of the change first.
6. **Harmonics** (26 h). Cylindrical sample symmetry, even L, the Laue-class
   terms, J, the positivity grid, analytic columns, order by order with the
   Hamilton test. *Gate:* GSAS-II `SHPOcal` per reflection to 10⁻⁹; the
   known truth; the negative control; the owner's local project (QUESTION 11).
7. **The page** (12 h). The Corrections row, the per-phase lines, the
   geometry menu, the readouts. *Gate:* browser checks at three widths; a
   person can set, fit and read each model.
8. **Reports and exports** (8 h). The axis and the geometry in the report;
   CIF; the GSAS-II bundle for harmonics; FullProf only for what the manual
   check confirms. *Gate:* both bundles reproduce the fit in their programs,
   or list what they cannot carry.
9. **The Copilot** (14 h, and the eval budget). Section 6.2. *Gate:* the
   snapshots, the scripted evals, a local-model run. The paid re-baseline
   goes with the release, at the owner's call.
10. **MCP** (5 h). Section 6.3. *Gate:* an MCP client can switch on, refine
    and export each model.
11. **Joint multi-bank texture** (5 h, after THY-89's core). One texture per
    phase shared by the chosen banks, each bank's ψ from its angles
    (QUESTION 17). *Gate:* the multi-bank known truth recovers one texture;
    the per-bank diagnostic agrees with it.

- Steps 0 to 3 touch no screen and no saved file.
- Step 4 waits for THY-89's format step to merge, or lands before it with its
  own version. They must not be in flight together.
- **CI risk** is low through step 6: small fixtures, seconds each. Step 9
  carries the model-visible risk (snapshots, evals). Step 11 depends on
  THY-89.

### QUESTION 16: fix the GSAS-II bundle before new work?

- **(a) Yes, as its own small PR now** (step 0).
- **(b) List preferred orientation as "not carried"** in the GSAS-II README
  until the harmonics export.
- **(c) Leave it.**

**Recommendation: (a).** It is a silent wrong export. The fix makes the
existing MCP description true, so no model-visible text changes.

### QUESTION 17: texture in the THY-89 joint fit, per bank or shared?

THY-89 decided (its Q6) to leave preferred orientation out of the first
joint delivery. Its question text proposed, for later, "one ratio per bank on
a shared axis, with a tie offered".

- **(a) One texture per phase, shared by all banks,** each bank's ψ from its
  angles: the sample-frame model of section 3.3.
- **(b) One March–Dollase ratio per bank on a shared axis** (GSAS-II's and
  FullProf's default; THY-89's note).
- **(c) (a), plus a per-bank fit offered as a diagnostic** ("refine this
  bank's texture alone and compare"). Ratios that disagree beyond the
  geometry say the bank or the geometry is wrong.

**Recommendation: (c).** One sample has one texture. With per-bank ratios each
bank can hide its own error in its ratio, the reason THY-89 shared the
microstrain (its Q4). If the owner agrees, THY-89's note on its Q6 is
superseded by this answer.

## 9. The questions, collected

Ordered by what they hold up. Each entry gives the options and my
recommendation.

**Needed before step 0**

- **Q16. Fix the GSAS-II bundle first?**
  - (a) yes, as its own small PR now;
  - (b) list preferred orientation as "not carried" until the harmonics
    export;
  - (c) leave it.

  Recommendation: (a). It is a silent wrong export, and the fix makes the
  existing MCP description true, so no model-visible text changes.

**Needed before step 1**

- **Q1. Models in the first delivery.**
  - (a) March–Dollase on one axis made complete (magnetic peaks, every
    phase, the GSAS-II export, derivatives, validation), no new model;
  - (b) (a), then harmonics with cylindrical sample symmetry;
  - (c) (b) plus several March–Dollase axes with fractions;
  - (d) (b) plus FullProf's random fraction.

  Recommendation: (b).
- **Q2. The exponential and Sasa–Uda functions.**
  - (a) not offered (not normalized; March–Dollase covers the case);
  - (b) offered for FullProf parity.

  Recommendation: (a).

**Needed before step 2 (validation)**

- **Q11. Real data.**
  - (a) the owner's local GSAS-II project with harmonic texture, local only;
  - (b) a public GSAS-II tutorial dataset with texture, once one is found and
    its licence read;
  - (c) a new measurement of a known platy standard.

  Recommendation: (a) for the harmonics step and (b) if found; (c) only if
  neither works out.

**Needed before step 3 (magnetic peaks)**

- **Q6. Texture on magnetic peaks.**
  - (a) the parent's texture, per member, weighted by each member's
    |F_M⊥|²;
  - (b) the parent's mean P per line;
  - (c) none, as today.

  Recommendation: (a), the physics. (b) is wrong whenever the members'
  |F_M⊥|² differ, and (c) puts the texture into the moments.

**Needed before step 4 (per phase, format)**

- **Q9. Per-phase texture.**
  - (a) every phase its own;
  - (b) the first phase only, as today.

  Recommendation: (a).
- **Q15. The format.**
  - (a) a new schema version, texture in one place, old axes migrated with
    the same function and numbers;
  - (b) optional fields, no version bump;
  - (c) keep `preferredOrientation`, and bump the version for the rest.

  Recommendation: (a), coordinated with THY-88's and THY-89's versions.

**Needed before step 5 (geometry)**

- **Q3. The sample geometry in the model.**
  - (a) none, as GSAS-II's and FullProf's March–Dollase;
  - (b) per pattern, with "flat plate in reflection" (today's function) as
    the default;
  - (c) only for TOF banks in a joint fit.

  Recommendation: (b). A textured TOF project switched to its bank geometry
  changes its numbers; the owner sees that before it merges.
- **Q4. TOF bank angles and frame.**
  - (a) from the `.instprm` `2-theta` and `Azimuth`, checked against difC;
  - (b) entered by the user;
  - (c) (a), editable on the page, azimuth 0 by default.

  Frame: beam along +z, y up, the texture axis given in that frame, default
  vertical (the can axis). Recommendation: (c).
- **Q5. A bank's extent.**
  - (a) each bank's centre, with the approximation stated (about 5 % on
    P(00l) at r = 0.7 for a bank ±30° out of the plane);
  - (b) an average over the bank's pixels when a geometry file gives them.

  Recommendation: (a) now; (b) only if a dataset needs it.

**Needed before step 6 (harmonics)**

- **Q7. The highest order.**
  - (a) 8;
  - (b) 12;
  - (c) 20, with warnings.

  In every case: start at the lowest order the Laue class allows, and go up
  one order at a time on the Hamilton test, never automatically.
  Recommendation: (b). An r = 0.7 fibre needs L = 8 for 1 %; beyond 12,
  March–Dollase is the better model.
- **Q8. Positivity.**
  - (a) a negative pole density is a finding only;
  - (b) (a) plus a penalty on a grid, as GSAS-II's "Zero MRD tolerance";
  - (c) a hard constraint.

  Recommendation: (a) in step 6, then (b) if the known-truth or real-data
  runs show negative densities.

**Needed before step 7 (the page)**

- **Q12. The default axis.**
  - (a) [0 0 1], as today;
  - (b) the texture test's axis if it named one, else [0 0 1], with the
    field saying which;
  - (c) no default.

  Recommendation: (b).
- **Q10. The guard against texture absorbing the structure.**
  - (a) the existing guard (refuse at |ρ| ≥ 0.95, report from 0.8), with
    pair hints;
  - (b) (a) plus a note when freeing the texture moves a B, U or occupancy
    by more than 2 combined esds;
  - (c) a stricter refusal for texture pairs, at 0.9.

  Recommendation: (b).

**Needed before step 9 (the Copilot)**

- **Q13. The tool's shape.**
  - (a) `set_corrections` keeps `preferredOrientation` as the single-axis
    shorthand and gains an optional `texture` object;
  - (b) a new `set_texture` tool;
  - (c) `texture` replaces `preferredOrientation`.

  Recommendation: (a).
- **Q14. "(a capillary rarely is)" in the texture action text.**
  - (a) keep it;
  - (b) "(a spun capillary is less prone, not immune)";
  - (c) drop it and name the geometry.

  Recommendation: (c) once the geometry menu exists; (b) until then.

**Needed before step 11 (joint multi-bank)**

- **Q17. Texture in the THY-89 joint fit.**
  - (a) one texture per phase shared by all banks, each bank's ψ from its
    angles;
  - (b) one March–Dollase ratio per bank on a shared axis (THY-89's note on
    its Q6);
  - (c) (a) plus a per-bank fit offered as a diagnostic.

  Recommendation: (c). If the owner agrees, it supersedes THY-89's note.

## References

Cited with confidence:

- Bunge, H. J. (1982). *Texture Analysis in Materials Science: Mathematical
  Methods*. London: Butterworths.
- Dollase, W. A. (1986). *J. Appl. Cryst.* **19**, 267–272.
- March, A. (1932). *Z. Kristallogr.* **81**, 285–297.
- Rietveld, H. M. (1969). *J. Appl. Cryst.* **2**, 65–71.
- Rodríguez-Carvajal, J. (1993). *Physica B* **192**, 55–69 (FullProf).
- Toby, B. H. & Von Dreele, R. B. (2013). *J. Appl. Cryst.* **46**, 544–549
  (GSAS-II).
- Von Dreele, R. B. (1997). *J. Appl. Cryst.* **30**, 517–525.
- GSAS-II 5.11.0 source, read locally: `GSASIIstrMath.py` (`GetPrefOri`,
  `GetPrefOriDerv`, `SHPOcal`, `SHTXcal`, `GetIntensityCorr`, `penaltyFxn`),
  `GSASIIlattice.py` (`GenSHCoeffT`, `OdfChk`, `SamAng`, `GetKcl`, `GetKsl`,
  `textureIndex`).

Uncertain, to be checked before they are relied on:

- Toraya, H. & Marumo, F. (1981): the attribution of FullProf's `Nor = 0`
  function.
- Sasa, Y. & Uda, M. (1976), *J. Solid State Chem.*: the Sasa–Uda function's
  form and reference.
- FullProf's `Nor` options, whether it averages March–Dollase over
  equivalents, and whether it offers harmonics for powders.
- Dollase (1986) on the capillary case (section 3.3).

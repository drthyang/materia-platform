# Single-crystal refinement

The workbench refines structures against integrated single-crystal Bragg
intensities, with the powder path's engine, symmetry constraints and scattering
tables. Only the observable and its corrections differ.

Summary: [LIMITATIONS.md](./LIMITATIONS.md#single-crystal). Evidence:
[VALIDATION.md](./VALIDATION.md). Work order: M7 in [ROADMAP.md](./ROADMAP.md).
The page: [USER_GUIDE.md](./USER_GUIDE.md#6-single-crystal-refinement).

Status legend: ✅ done · 🚧 in progress · ⬜ not started

## 1. Design logic: one engine, one constraint layer

The constraint layer reduces a special-position atom to its symmetry-allowed
modes once, and both data types use that reduction ([ROADMAP.md](./ROADMAP.md)
§1).

| Concern | Shared function | Powder caller | Single-crystal caller |
| --- | --- | --- | --- |
| Cell parameters | `independentCellParameters` | `buildStructureRefinement` | none: fixed input |
| Position modes | `allowedPositionShifts` | `buildStructureRefinement` | `buildSingleCrystalSpec` |
| Anisotropic ADP modes | `allowedAnisotropicAdpModes` | `buildStructureRefinement` | `buildSingleCrystalSpec` |

Both paths then apply parameters with
[`applyParameters`](../src/core/workflow/apply.ts) and solve with the one
[`refine`](../src/core/refinement/engine.ts) engine.

### Units and conventions

| Item | Convention |
| --- | --- |
| Intensity | F², not \|F\|, as in SHELX HKLF 4, `.fcf` LIST 4, GSAS-II Fo² and powder integrated intensities |
| Scale | Multiplies F² (SHELX OSF), like the powder scale |
| ADPs | B in Å², T = exp(−B·s²), s = sinθ/λ; symmetry-adapted U in Å²; kinds and Debye–Waller code shared with powder |
| Angles | Degrees in the UI and report; radians inside |

- **Freeing.** Scale and extinction start free; positions and ADPs start fixed.
  `guidedSingleCrystalParams` frees positions and ADPs together. Occupancy rows
  are optional and off by default.
- **Fixed cell.** Intensities carry no peak positions, and the cell's weak
  effect on |F|² correlates with scale and ADPs, so the cell comes from indexing.
  SHELXL only propagates the `CELL`/`ZERR` esds; Jana, FullProf and GSAS-II
  refine cells only with a powder profile.

## 2. Capabilities

### 2.1 Reflection data and merging

**Supported**
- Laue-class equivalence (rotations closed under Friedel inversion), exact for
  non-anomalous |F|².
- `mergeEquivalents` keeps one reflection per class: the 1/σ²-weighted mean, with
  σ the larger of the propagated error and the sample scatter
  ([merge.ts](../src/core/diffraction/merge.ts)).
- R_int = Σ|Iᵢ − Ī| / Σ|Iᵢ| over classes of two or more, R_sigma = Σσ(Ī) / ΣĪ,
  and redundancy. The page reports them and refines the unmerged list.
- Checked on P-1 Friedel pairs, the 48 m-3m rotations, R_int of 0 and 0.10, and
  a {200} family ([merge.test.ts](../src/core/diffraction/merge.test.ts)).
- Completeness against the unique set the space group allows to d_min, by
  resolution shell, counting only the allowed reflections measured
  ([singleCrystalValidation.ts](../src/core/diagnostics/singleCrystalValidation.ts));
  the Friedel pairs, the forbidden reflections measured (each as a fraction of
  the allowed intensity at its d) and ⟨|E² − 1|⟩ with the ε factor, reported
  as no test for fewer than six independent sites or mostly special ones
  ([reflectionStatistics.ts](../src/core/diagnostics/reflectionStatistics.ts)).

### 2.2 File input and output

**Supported**
- FullProf `.int` (`ABS(Irf) = 4`), read at its declared Fortran widths
  ([fullprofInt.ts](../src/parsers/fullprofInt.ts)). A `4i…` format marks the
  k-vector variant, whose satellites H + k_nv carry a `kIndex`.
- The reader maps `-0` to 0, logs bad rows by line, and throws in strict mode.
  The writer round-trips byte-for-byte (real files: semantically) and throws on
  overflow.
- Loaders drop a nuclear `0 0 0` row as the forward beam, but keep a magnetic
  one as the satellite at k.
- A `<name>_mag.*` file loaded beside a nuclear set becomes its partner; the
  `.int` export writes the pair back.
- SHELX-style `h k l I [σ]` lists ([hkl.ts](../src/parsers/hkl.ts)) and GSAS-II
  reflection lists filtered to the loaded cell.
- The SNS TOPAZ time-of-flight file (`3I4,2F8.2,I4,2F8.5,2I7,F7.4,I4,F9.5,F9.4,2F7.2`):
  per reflection F², σ, the run, its own wavelength, path length,
  transmission and 2θ ([snsTofHkl.ts](../src/parsers/snsTofHkl.ts)). Its first
  32 columns are HKLF 4, so it is recognized by its columns (λ = 2d·sinθ row
  by row) before the SHELX reader.
- SHELX **HKLF 4** fixed-column files (`3I4,2F8,I4` → h k l F² σ batch), with a
  whitespace fallback for hand-edited files and the `0 0 0` terminator honoured,
  and `.fcf` / CIF reflection loops (LIST 4 F², and LIST 6 F squared with σ
  propagated) whose column order comes from the loop header
  ([shelxHkl.ts](../src/parsers/shelxHkl.ts)).
- `loadReflectionDataset` routes by content: a `.fcf` by its CIF reflection loop,
  a `.hkl` by extension, everything else to the free-form reader. The split is
  not cosmetic — whitespace-splitting an HKLF 4 row reads σ as the intensity once
  F² ≥ 10000.00 fills its `F8.2` field, and taking `.fcf` columns positionally
  reads LIST 4's F²calc as the observation
  ([loadData.test.ts](../src/app/loadData.test.ts)).

**Approximate**
- No golden covers the k-vector header, which follows the FullProf manual and
  one HB-3A MnWO₄ file; verify an export in FullProf. Real files use the
  supercell merge (§2.5).
- SHELX lists carry no λ and load at 1.54 Å, which the page cannot change; λ
  enters the extinction y.

**Not yet**
- Placing k-header satellites at H + k: no refinement reads `kIndex`.

### 2.3 Corrections and agreement

**Supported**
([singleCrystalFactors.ts](../src/core/diffraction/singleCrystalFactors.ts))

| Quantity | Formula |
| --- | --- |
| Intensity | Fc² = k·k_b·y·\|F\|²: the file's Fo² are corrected for Lorentz, polarization and absorption in data reduction, as SHELXL, Jana, FullProf and GSAS-II take them |
| Batch scale | k_b, relative to the first batch (1 for it, and without batches) |
| Extinction (SHELXL EXTI, the default) | y = [1 + 0.001·x·F²·λ³/sin2θ]^(−1/2), at the reflection's own λ and 2θ when the file gives them (a TOF Laue file); 1 for TOF without them |
| Extinction (Becker–Coppens, as GSAS-II) | y = [1 + 2p + A·p²/(1 + B·p)]^(−1/2), p = Q·T̄·ψ, Q = c·F²·λ²/V² (c = 10⁷ for neutrons with F² in barns; 7.9406·10⁵ times the polarization ratio for X-rays), T̄ the reflection's path length (cm), ψ = Eg/L (type I; L = sin2θ/λ, or (sinθ/λ)² for TOF Laue) or Es (type II); A, B the Gaussian or Lorentzian mosaic's coefficients in cos2θ |
| SHELX weight | w = 1/[σ²(Fo²) + (aP)² + bP], P = [max(Fo², 0) + 2Fc²]/3 |
| wR2, all reflections | √[Σw(Fo² − Fc²)² / Σw(Fo²)²] |
| R1, Fo² > 2σ (R1 all: no cutoff) | Σ\|\|Fo\| − \|Fc\|\| / Σ\|Fo\| |
| GooF | √[Σw(Fo² − Fc²)² / (N − N_par)] |

- Standardized residuals (Fo² − Fc²)/σ flag outliers. An optional OMIT filter,
  off by default, drops those beyond an adjustable cutoff, initially 6σ, and
  optionally those whose extinction factor y is below a cut (the extinction
  test: does the structure rest on the most extinguished reflections?).
- Single measurements are left out by hand (SHELXL's OMIT h k l) by their
  indices and batch, with a reason, whatever their residual; and the fit can
  be limited to a resolution range (SHELXL's SHEL), for a high-order
  refinement. Both are saved with the project and listed in the report.
- Becker–Coppens checked against a line-by-line transcription of GSAS-II's
  `SCExtinction` (type I and II, Gaussian and Lorentzian, TOF, CW and X-ray)
  to 12 digits.
- Checked by hand computations and perfect-fit zeros
  ([singleCrystalFactors.test.ts](../src/core/diffraction/singleCrystalFactors.test.ts)).

**Approximate**
- The fit uses 1/σ² weights. `singleCrystalRefinementComparison` accepts WGHT a
  and b for the reported wR2 and GooF, but no caller passes them.

**Not yet**
- WGHT reweighting, twinning, anomalous dispersion, absorption (§2.7).

### 2.4 Refinement assembly

**Supported**
- `buildSingleCrystalSpec` emits scale, optional extinction, a fixed scale per
  batch after the first (`bscale_<b>`), per-site B or U modes, position modes
  bounded to ±0.2 and optional occupancies. It ties shared sites and has no
  cell rows
  ([singleCrystalRefinement.ts](../src/core/workflow/singleCrystalRefinement.ts)).
- The starting scale is the exact linear optimum k = Σ(Fo²·Fc²) / Σ(Fc²)².
- The page refines until every shift is below 0.05 esd, up to 50 cycles
  (`SINGLE_CRYSTAL_REFINE_OPTIONS`), the crystallographic criterion: with a
  GooF near 3 a shift of most of an esd changes χ² by less than the engine's
  relative tolerance.
- Switching to anisotropic ADPs seeds each tensor with the refined sphere in
  the cell, U^ij = U·cos(a*_i, a*_j) (U12 = U/2 in a hexagonal cell), so the
  fit starts where the isotropic one ended; U_eq is ⅓ Σ U^ij a*_i a*_j (a_i·a_j)
  ([adp.ts](../src/core/crystal/adp.ts)).
- `refineSingleCrystalMultiStart` (Prefit, Escape min) keeps the best of a
  baseline and perturbed restarts. Kick floors, such as 0.1 in fractional
  coordinates, move modes that sit at 0.
- Rule: run the multi-start before trusting positions, because a mode pinned at
  its bound converges cleanly to a wrong answer with a plausible wR2.
- Checked by scale and displaced-atom recovery (R1, wR2 → ~0) and a
  deterministic escape from a bound trap
  ([singleCrystalRefinement.test.ts](../src/core/workflow/singleCrystalRefinement.test.ts),
  [singleCrystalMultiStart.test.ts](../src/workers/singleCrystalMultiStart.test.ts)).

**Not yet**
- Occupancy rows on the page; a `refine_single_crystal` agent tool.

### 2.5 Magnetic single-crystal refinement

**Supported**
- **One scale.** Nuclear and magnetic peaks share one measurement, so
  `magneticScale` is tied to `scale`, with no relative weight. Untied, the
  moments come out wrong by √k.
- **Forward model.** I = k·(|F_N|² + |F_M⊥|²) for unpolarized neutrons, with the
  Halpern–Johnson M⊥Q projection, ⟨j0⟩ and p = 2.695 fm/µB. Fractional-index
  rows H + k get no nuclear term
  ([magnetic.ts](../src/core/workflow/magnetic.ts)).
- **Supercell merge.** Both files of a FullProf pair use nuclear-cell indices,
  and each `_mag` row is the fundamental of hkl + k. `mergeToMagneticSupercell`
  maps (h, k, l) to (n₁h, n₂k, n₃l), plus K = (n₁k₁, n₂k₂, n₃k₃) for satellites
  ([magneticSupercell.ts](../src/core/magnetic/magneticSupercell.ts)).
  Here nᵢ ≤ 12 is the denominator of kᵢ, so k = (¼, 0, ¼) gives 4 × 1 × 4.
- **Supercell structure.** `expandStructureToSupercell` replicates every orbit
  in P1, copying positions, occupancies and ADPs, so magnetic ions sit on the
  nuclear sites. As |F_super(n·hkl)|² = N²·|F_base|², N = n₁n₂n₃, the scale
  becomes k_base/N² for both intensities.
- Rule: refine merged data only against a supercell structure, or the
  satellites meet spurious nuclear |F|².
- **Modulated moments.** `buildModulatedMomentModel` drives each sublattice's
  replicas from one amplitude in µB, m(L) = m₀·d̂·cos(2πk·L + φ). At k = ¼,
  φ = 0 gives (+, 0, −, 0) and φ = π/4 gives (+, +, −, −).
- **Multi-start.** `refineMagneticSingleCrystalMultiStart` freezes the nuclear
  parameters, searches moments from seeded starts, runs a final LM, fixes the
  ±m sign and reports undetermined directions.
- **Checked by** synthetic k = (½, 0, 0) and k = ¼ supercells, recovered
  deterministically from bad starts
  ([magneticSupercellRefine.test.ts](../src/workers/magneticSupercellRefine.test.ts)).
  Real Eu₃In₂Te₄ data merge row-exactly, and the Eu₃In₂As₄ CIF obeys the N² rule
  ([magneticSupercell.test.ts](../src/core/magnetic/magneticSupercell.test.ts),
  data-gated). Methods: [REFINEMENT_NOTES.md](./REFINEMENT_NOTES.md) §8.

**Approximate**
- The magnetic problem applies no extinction y; the nuclear-only one does.
- The N² rule is tested on nuclear intensities only, and the panel's real-data
  run is a smoke test, not a check of moment accuracy.

**Not yet**
- The merge for an incommensurate or non-axis-diagonal k; mCIF export from this
  page.

### 2.6 The page

**Supported**
([SingleCrystalWorkbench.tsx](../src/app/SingleCrystalWorkbench.tsx))
- The supercell panel runs §2.5 without changing the loaded structure. The
  magnetic-symmetry panel fits moments to the loaded set, nuclear model fixed.
- Projects save the datasets, probe, parameters, magnetic model, OMIT filter and
  supercell-panel inputs, but not the panel's result.

### 2.7 Next

**Next**, in the M7 order of [ROADMAP.md](./ROADMAP.md):
1. ✅ Completeness against a generated theoretical unique set.
2. ⬜ Twinning (TWIN/BASF; batch scales are in), and anomalous dispersion with f′, f″
   and Friedel-pair splitting for absolute structure.
3. ⬜ Iterative WGHT reweighting on Fc² in the fit.
4. 🚧 Absorption correction: core built (§3); UI, agent tool and multi-scan open.
5. ⬜ Validation gate: reproduce a published SHELXL or GSAS-II F² refinement on
   a real HKL file, within tolerance.

## 3. Forward plan: absorption correction

The goal is a WinGX-class tool (ABSPACK, SORTAV, face-indexed) that goes
further: one model for every method, driven by shape or redundancy, with errors
propagated into the merged σ.

The correction is A* = 1/T, where T is the transmission over the crystal
volume V:

    T = (1/V) ∫ exp[−μ(r_in + r_out)] dV

μ is the linear absorption coefficient; r_in and r_out are the incident and
diffracted path lengths. `transmissionFactor` computes T, called A in the code.

### 3.1 μ from composition

Status: 🚧 neutron μ(λ) built; X-ray mass-attenuation table not built.

- Neutron μ comes from the cell contents, with a per-element breakdown
  ([neutronAbsorption.ts](../src/core/scattering/neutronAbsorption.ts)):

      μ [cm⁻¹] = Σⱼ Nⱼ·[σ_abs,j·(λ / 1.798 Å) + σ_coh,j + σ_inc,j] [barn] / V [Å³]

  Nⱼ sums multiplicity × occupancy for element j. Absorption follows 1/v;
  divide by 10 for mm⁻¹.
- A warning flags resonance absorbers such as Eu when λ is over 5 % from
  1.798 Å.
- Plan: X-ray μ from μ/ρ tables in `core/scattering/`; report μ, μ·r̄ and a
  suggested method.

### 3.2 Shape-based numerical integration

Status: 🚧 core built; adaptive grid, diffractometer geometry and UI not built.

- Built, in [core/absorption/](../src/core/absorption/):
  - convex habits from faces {hkl, distance} or point-group forms;
  - Gauss–Legendre quadrature over the bounding box, 24 points per axis by
    default;
  - orientation from matched face normals (Davenport's q-method), and automatic
    face indexing.
- WinGX check on the Eu₃In₂Te₄ rod at 1.0 Å: Pearson r ≈ 0.99 (gate 0.95)
  with a fitted μ, because Eu's 1/v μ over-absorbs. Beam directions come from
  the `.int` direction cosines
  ([eu324Absorption.test.ts](../src/core/absorption/eu324Absorption.test.ts)).
- Plans:
  - triangulated integration (Busing–Levy / de Meulenaer–Tompa) for awkward,
    strongly absorbing habits;
  - an adaptive grid refined until A* converges, not the fixed 8 × 8 × 8;
  - exact r_in and r_out from φ, χ, ω or an orientation matrix.

### 3.3 Simple-shape closed forms

Status: ⬜ not built.

- Spherical A*(μR, θ) from the International Tables C values, and the powder
  `cylinderAbsorption` (`diffraction/intensity.ts`) extended to single-crystal
  geometry. They serve ground spheres and needles, and cross-check 3.2.

### 3.4 Empirical multi-scan correction

Status: ⬜ not built.

- A transmission surface A*(θ_in, φ_in, θ_out, φ_out) in real symmetric
  harmonics, fit with per-batch scales (the SADABS model) by minimizing R_int
  through `mergeEquivalents`. It reports Tmax/Tmin and flags outliers by
  standardized residual.
- Added to the analytical correction, it would absorb beam inhomogeneity and
  mount absorption; most tools force a choice.
- It needs batch numbers on loaded reflections (§2.2).

### 3.5 Integration and interface

Status: ⬜ not built.

- A correction multiplies iObs by a per-reflection A* before merging, with σ
  propagated, so R_int measures its quality.
- One panel picks the method by regime (small μr̄: none or sphere; good faces:
  face-indexed; high redundancy: multi-scan). It shows Tmax/Tmin, R_int before
  and after, and the surface.
- Agent tool: `correct_absorption(reflections, {method, crystal|faces|μ})` →
  corrected reflections, Tmax/Tmin and ΔR_int, composing with
  `parse_single_crystal_data` and a planned `refine_single_crystal`.

### Sequencing

**Next**, in the planned order, each with a golden test:
1. 🚧 μ from composition (3.1).
2. ⬜ Closed forms (3.3), cheap and a check on μ; golden: International Tables C.
3. 🚧 Face-indexed integration (3.2); golden: WinGX.
4. ⬜ Multi-scan with batch scaling (3.4); golden: an R_int drop.
5. ⬜ Combined analytical and empirical correction (3.5).

## 4. References

- G. M. Sheldrick, *Acta Cryst.* **A64** (2008) 112–122,
  doi:[10.1107/S0108767307043930](https://doi.org/10.1107/S0108767307043930);
  *Acta Cryst.* **C71** (2015) 3–8,
  doi:[10.1107/S2053229614024218](https://doi.org/10.1107/S2053229614024218) —
  SHELX F² refinement, HKLF/FCF formats, EXTI, WGHT.
- R. H. Blessing, *Acta Cryst.* **A51** (1995) 33–38,
  doi:[10.1107/S0108767394005726](https://doi.org/10.1107/S0108767394005726) —
  data reduction, R_int, empirical absorption (SORTAV).
- L. J. Farrugia, *J. Appl. Cryst.* **32** (1999) 837–838,
  doi:[10.1107/S0021889899006020](https://doi.org/10.1107/S0021889899006020);
  *J. Appl. Cryst.* **45** (2012) 849–854,
  doi:[10.1107/S0021889812029111](https://doi.org/10.1107/S0021889812029111) —
  WinGX.
- P. Coppens, L. Leiserowitz & D. Rabinovich, *Acta Cryst.* **18** (1965)
  1035–1038, doi:[10.1107/S0365110X65002487](https://doi.org/10.1107/S0365110X65002487)
  — analytical (Gaussian-grid) absorption, the primary source; also in
  *Crystallographic Computing* (Munksgaard, 1970).
- W. R. Busing & H. A. Levy, *Acta Cryst.* **10** (1957) 180–182,
  doi:[10.1107/S0365110X57000584](https://doi.org/10.1107/S0365110X57000584).
- S. Parsons, H. D. Flack & T. Wagner, *Acta Cryst.* **B69** (2013) 249–259,
  doi:[10.1107/S2052519213010014](https://doi.org/10.1107/S2052519213010014) —
  absolute-structure determination (intensity quotients).
- *International Tables for Crystallography* Vol. C — mass-absorption
  coefficients, spherical and cylindrical A* tables, Laue classes.

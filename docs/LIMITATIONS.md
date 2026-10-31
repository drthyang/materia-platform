# Limitations

## Scope statement

> This package is an early browser-native refinement workbench for transparent
> model building, simulation, and basic constrained refinement. Results intended
> for publication must be validated against established tools and expert
> crystallographic judgment.

This statement also appears in the app and in the README.

## How to read this page

Each area below has up to three lists:

- **Supported** — implemented and tested.
- **Approximate** — works, but with a simplification to keep in mind when you
  interpret the result.
- **Not yet** — not implemented. The order of this work is in
  [ROADMAP.md](./ROADMAP.md).

A feature counts as **validated** only when [VALIDATION.md](./VALIDATION.md)
records a test or an external comparison for it. Everything else is
approximate, however plausible its output looks.

## At a glance

| Area | Supported | Largest gaps |
| --- | --- | --- |
| [Powder](#powder-diffraction) | X-ray and neutron; constant wavelength and TOF; multi-phase; Le Bail | Spherical-harmonic texture; Kα₂ doublets; Ikeda–Carpenter TOF peak shape |
| [Single crystal](#single-crystal) | F² refinement with merging and extinction; magnetic supercell merge | Reliable `.hkl`/`.fcf` loading; twinning; absorption-correction UI |
| [Magnetic](#magnetic-structures) | One propagation vector (k = 0, commensurate or incommensurate); subgroup candidates with BNS/OG labels | Multi-k and the star of k; harmonics and superspace; refining a self-conjugate k, or k on single-crystal data |
| [PDF and mPDF](#real-space-pdf-and-magnetic-pdf) | Neutron and X-ray G(r); multi-phase; magnetic PDF; Γ symmetry modes | Zone-boundary modes; a correlated-error likelihood; data reduction |
| [Uncertainty](#uncertainty-and-posterior-sampling) | Least-squares esds and correlations; posterior sampling (prototype) | Correlated residuals; comparing models |
| [Files](#input-and-output) | CIF, mCIF, project files, report, FullProf and GSAS-II cross-check bundles, a PDFgui / diffpy-CMI bundle for a PDF | Single-crystal and multi-phase `.pcr`; geometry tables in the report |

## Refinement engine

**Supported**
- Local Levenberg–Marquardt least squares with bounds, ties, restraints, esds
  and correlations ([REFINEMENT_ENGINE.md](./REFINEMENT_ENGINE.md)).
- Exact derivatives for linear parameters: scale, background, magnetic scale.
- Protection against false minima: automatic starting values for the background
  and zero shift; seeded multi-start searches (Prefit / Escape min), including
  for magnetic moments (`restarts` in the agent tools); and, in the agent tools,
  a staged sequence that fixes a newly freed parameter again when it makes the
  fit degenerate.

- An isotropic B that refines to its lower bound (0) on the powder page gets
  ranked options with a warning, never a silent change: a tie to a site of the
  same element that refined sensibly (preferred), ties to other cations of the
  same coordination (labelled alternatives with a caution), and the starting
  structure's B (an alternative). The user picks one in the notice; the
  Agent's `apply_adp_proposal` picks one from the list, shown on its card for
  the user to change or decline, or applied as the Agent's recorded choice in
  auto mode. Applied, it is a tie or a held value like any other, listed under
  Limitations in the report and reported by `assess_refinement`.

**Approximate**
- The B-at-0 rule's starting-structure value (rule B) is used as it stands,
  with no temperature adjustment: the app has no model of B against
  temperature. Its coordination match (a cross-cation tie) counts a cation's ligands
  within the coordination shell (`coordinationShells`), not bond valences.
- Fits fall back to central finite differences for every non-linear parameter
  with no validated analytic column — powder coordinates, cell, profile, zero
  shift and moments among them.
- Validated analytic derivatives are used where they exist — powder occupancy
  and isotropic B; PDF Qdamp, Qbroad, δ1, δ2, particle diameter, occupancy,
  isotropic B, anisotropic U and symmetry-mode position shifts. Every serial fit
  (the worker runners and the agent tools) and the pool-parallel PDF fits take
  them; pooled powder fits do not, because a powder analytic column costs a full
  pattern synthesis on the driver thread where the fused PDF pass costs one
  traversal for all of them.

**Not yet**
- Global optimization. The engine is local, so it needs a reasonable starting
  model.
- The B-at-0 rule's last step (rule C), a documented typical B for the element
  at the measurement temperature: the repository holds no such table from a
  citable source, so no value is proposed (and no arbitrary floor). The rule
  also runs on the powder page only: a single-crystal B at 0 gets the
  existing at-bound reading, a single-crystal tensor that is not positive
  definite stays a hard flag, and on the PDF page a U at 0 points first at a
  correlated-motion term (δ1/δ2), as before. The MCP `assess_refinement` takes
  no proposals yet.

## Uncertainty and posterior sampling

**Supported**
- Least-squares esds and parameter correlations.
- Bayesian posterior sampling, as a prototype: the Posterior view on the powder
  and PDF pages, the in-app Agent's `sample_posterior` on both, and the MCP
  `sample_posterior` for PDF and powder fits. Two samplers:
  - an ensemble (stretch-move) sampler, which runs on the worker pool and
    accepts any problem;
  - a gradient-based NUTS sampler, for single-phase PDF fits only.
- Four noise models: `poisson` for raw counts, `fixed` for trustworthy σ,
  `studentT` for outliers, and `marginalized` (the default) for an unknown error
  scale.

**Approximate**
- Every noise model treats residuals as independent from point to point. For
  G(r) that is not true — the finite-Qmax Fourier transform correlates
  neighbouring points — so credible intervals are relative to the chosen noise
  model, not a rigorous likelihood.
- NUTS runs in-process, one chain after another, not on the worker pool. Where
  no analytic gradient exists (cell, sratio/rcut, tied parameters, multi-phase or
  multi-dataset problems) it uses finite differences, at their cost.
- Sampling parameters that move atoms (cell, positions) rebuilds the pair list
  at every step, so it is much slower than sampling scales or envelopes. The
  Posterior view therefore runs 400 steps at a time, with a Continue button.
- `poisson` and `studentT` work with the ensemble sampler only. Do not combine
  `poisson` with restraints: restraints are Gaussian pseudo-observations.

**Not yet**
- A correlated-residual model, and a covariance propagated from the F(Q)
  reduction ([PDF roadmap §8](./PDF_MPDF_ROADMAP.md#8-scientific-caveats--honesty-statement)).
- Model evidence (for example nested sampling). A posterior compares parameter
  values within one model, not one model with another.
- A corner plot in the workbench. The Posterior view shows each parameter's
  marginal; the sample correlation matrix is in the `sample_posterior` agent-tool
  output.
- Posterior sampling of a magnetic PDF fit through the `sample_posterior` agent
  tool. The PDF page can sample one, with the ensemble sampler.

## GPU acceleration

**Supported**
- WebGPU kernels for the nuclear and the magnetic structure-factor sums.
  Profile synthesis runs on the CPU.
- The powder page uses the nuclear kernel automatically when the browser
  supports WebGPU, for single-phase fits without a magnetic model. Otherwise the
  fit runs on the CPU.

**Approximate**
- The kernels compute in f32, so they agree closely with the f64 CPU path but
  not bit for bit: within 5e-7 relative for structure factors, far below esd
  scales. A GPU-accelerated refinement converges to the same minimum as the CPU
  one. The f64 CPU path stays the reference
  ([VALIDATION.md](./VALIDATION.md#gpu-acceleration-precision)).

**Not yet**
- The magnetic kernel inside magnetic refinement.

## Symmetry

**Supported**
- All 230 space groups in all 564 settings gemmi tabulates (both origin
  choices, H and R axes, monoclinic and orthorhombic settings), plus the
  operation list read from a CIF. Systematic absences are generated from the
  operations.
- The setting is never guessed. A CIF without operations whose symbol or number
  fits several settings (e.g. "F d -3 m") must say which — a Hall symbol, a
  suffix ("F d -3 m:2", ICSD "Z"), or the user's choice when loading; the cell
  decides H vs R axes. An unknown symbol is an error, not P1. So is a CIF with
  no symmetry at all; it loads as P1 only when you choose that, because its
  atoms are the whole cell (diffpy writes such files).
- Magnetic subgroup candidates carry standard BNS/OG labels from a bundled
  ISO-MAG table of all 1651 groups (types I–IV). At a single-arm k ≠ 0 each is
  named from its group in the magnetic cell, a type-IV group, with its setting
  against the parent cell. A setting search also names candidates written in
  other settings: axis permutations, origin shifts, orthohexagonal C-centred
  cells, the cells of an F cubic parent, and the group's own conventional cells
  with the origin solved exactly ([MAGNETIC_SYMMETRY.md](./MAGNETIC_SYMMETRY.md)).
  The candidates of a two-arm k are decorations of G_k, not magnetic space
  groups, and carry no BNS label; the magnetic space groups of a two-arm k
  (over G_{±k} in the supercell) are not enumerated yet.
- Representation analysis: irreps at k = 0 for every parent group, and at any k
  when the little group is abelian.
- The little group of k, the one-arm/two-arm classification and the k-phase of
  every lattice translation use the parent's own lattice, centring translations
  included ([MAGNETIC_SYMMETRY.md](./MAGNETIC_SYMMETRY.md)).

**Not yet**
- BNS/OG labels for type-II and type-IV (anti-translation) groups, for
  monoclinic cell choices 2 and 3, for the reverse rhombohedral setting, and
  for sub-cells of I- or C-centred parents.
- Projective small representations, needed for non-abelian little groups at
  k ≠ 0.
- Wyckoff letters beyond a curated set of groups. Multiplicities and site
  symmetries are available for all 230.

## Scattering tables

**Supported**
- Neutron coherent scattering lengths: Sears (1992) *Neutron News* via NIST,
  88 elements + D and 248 isotopes (Hf corrected to 7.77). Pu, Cm and Am need
  an explicit isotope: a mass number in the CIF type symbol, e.g. `239Pu`
  (likewise `2H`, `57Fe3+` for any tabulated isotope).
- X-ray form factors: Cromer–Mann coefficients for 98 neutral atoms H–Cf
  (Vol. C), each checked to give f(0) = Z.
- Magnetic form factors: ⟨j0⟩ for 97 ions and ⟨j2⟩ for 95 (Vol. C). The
  tables support the dipole form for g ≠ 2, but calculations use ⟨j0⟩ only
  (see [Magnetic structures](#magnetic-structures)).
- Every table is generated from its cited source by a script in `scripts/`
  ([SCATTERING_TABLES.md](./SCATTERING_TABLES.md)).

**Not yet**
- Ionic X-ray form factors (neutral atoms only).
- Magnetic form factors for the 5d ions W–Ir (Kobayashi 2011).
- Anomalous dispersion (f′, f″).

## Powder diffraction

**Supported**
- Reflection lists are complete: every (hkl) with d ≥ d_min, found with exact
  per-axis index bounds (|h| ≤ a/d_min). A list is never truncated; a cell and
  range needing more than 300 000 reflection families (or 6×10⁷ index triples,
  or an index above 2047) is an error naming the cell, as a typo'd or diverged
  cell usually is.
- Constant-wavelength peaks: Gaussian or pseudo-Voigt, with Caglioti U/V/W
  widths, a Thompson–Cox–Hastings Lorentzian size/strain term, and
  Finger–Cox–Jephcoat axial asymmetry.
- Time-of-flight peaks: back-to-back exponential ⊗ Gaussian with d-dependent
  α/β/σ, placed by difC/difA/difB (GSAS-II convention). α/β/σ refine in the
  profile stage; difC/difA/difB start fixed at the instrument calibration,
  because they correlate strongly with the cell.
- Lorentz–polarization: neutron CW 1/(sin²θ cosθ); X-ray CW multiplied by the
  polarization factor (1−P)cos²2θ + P, with P from the instrument (0.5
  unpolarized, about 0.9–0.95 for a monochromated synchrotron beam); TOF ∝ d⁴.
  Constant per-bank prefactors are absorbed into the scale.
- Backgrounds: Chebyshev, cosine (Fourier) or power series, or linear or
  logarithmic interpolation between evenly spaced points, with an adjustable
  number of terms. POWGEN time-of-flight data start on log interpolation with
  3 points, recognized from the instrument file's text (POWGEN or PG3 in it)
  or, when that names no known instrument, a guess from the data file's name
  (`PG3_…` POWGEN, `NOM_…` NOMAD, any case; NOMAD has no default of its own,
  so its guess only labels the Instrument card). An instrument file naming an
  instrument wins; the guess is never saved or reported as the instrument.
  Other data start on 4 Chebyshev terms. The Agent's `diagnose_fit` reads the
  count the points between the lines justify (BIC), with any excess there
  that no reflection explains left out as a line, not background; a hump wider
  than 24 line widths counts as background, and the points under the lines
  (a short-d stretch of overlapping TOF lines) say nothing of it. The
  Background group's own terms box does not warn.
- Corrections: March–Dollase preferred orientation (averaged over each
  family's Laue equivalents, as GSAS-II); sample displacement and
  transparency, Debye–Scherrer absorption, and Suortti surface roughness
  (opt-in); crystallite size (isotropic, with uniaxial in the core only) and
  microstrain (isotropic,
  uniaxial, or generalized Stephens) — see [MICROSTRUCTURE.md](./MICROSTRUCTURE.md).
- Multi-phase refinement and Le Bail extraction.
- A cell and space-group gate before refinement (agent tool
  `check_cell_symmetry`): a Le Bail fit refines the cell, then every leftover
  peak must index and every forbidden reflection must show no intensity.
  Forbidden reflections too close to an allowed one are reported as untestable.
  Named impurity phases are fitted too, each with its own expansion and width.
- A Validation view beyond R, wR and GoF. Powder: background-subtracted
  Rwp′/Rexp′, the Durbin–Watson d against Hill & Flack's Q_D, the normalized
  residual with its cumulative χ², χ² by d-shell, per-phase R_Bragg/R_F, the
  reflections carrying the most χ², and unindexed residual peaks. Overlapping
  intensity is shared across all phases, so an impurity peak on top of a
  main-phase reflection is not credited to the main phase. Single crystal:
  Fo² vs Fc², SHELXL's analysis of variance (K and GooF by intensity and by
  resolution), completeness, reflections per parameter, and an extinction
  check on the strong reflections.

**Not checked by the Validation view**
- Difference-Fourier residual density, the Flack parameter, and the
  Hirshfeld rigid-bond test (single crystal).
- Phase weight fractions (powder).
- The full correlation matrix: the engine reports only pairs above 0.95.
- The Bérar–Lelann esd correction for serially correlated residuals: the view
  flags the correlation (Durbin–Watson) but does not rescale the esds.

**Approximate**
- Axial asymmetry is modelled on the low-angle side (2θ < 90°) only.
- The cell and space-group gate fits a simplified profile. At constant
  wavelength it is one pseudo-Voigt width with a refined Lorentzian fraction.
  On time-of-flight data it is a back-to-back exponential with four refined
  width terms (σ₁², σ₂², α, β₀), not the instrument's full resolution curve. An
  impurity's expansion is limited to ±3 %. The gate reads d ≥ 0.7 Å by default.

**Not yet**
- Spherical-harmonic texture; powder extinction; microabsorption (Brindley);
  flat-plate absorption; Kα₂ doublets.
- High-angle axial asymmetry; the Ikeda–Carpenter moderator peak shape; TOF
  absorption and extinction.
- Manually placed background points, real-space (Debye) backgrounds, and
  automatic peak stripping.
- Catching a cell that is too large, or a space group with fewer absences than
  the crystal's: the gate cannot see either. Indexing an unknown cell.

## Disorder

**Supported**
- Atoms that share one site (mixed occupancy — for example the six 3d cations
  of the high-entropy tungstate) refine with a tied position and ADP, and on
  the powder and PDF pages their occupancies sum to exactly the site's total
  by a constraint: the last occupancy (in file order) follows the total minus
  the others. The total is 1 unless the user sets a vacancy (Occupancy group;
  `set_site_ties` `totals` for the Agent on the powder page, not yet on the PDF
  page). A last occupancy driven outside [0, 1] is warned of, never clamped.
  MCP's powder tools keep a soft Σ restraint. In a magnetic refinement their
  moments can be tied too. One diffraction pattern or G(r) sees a shared
  site's species only through their summed scattering: with three or more
  species free, most combinations are not determined, and the fit reports
  them as undetermined.

**Not yet**
- Split (positional) disorder; anti-site exchange between different sites;
  occupancy–ADP correlation beyond the single-site tie.

## Magnetic structures

**Supported**
- One propagation vector: k = 0, or a commensurate or incommensurate k ≠ 0,
  for constant-wavelength and TOF powder data and for single-crystal data.
- Moments refine as the symmetry-allowed modes of the chosen magnetic subgroup;
  a refinement cannot leave that space. Satellites sit at G ± k.
- The magnetic intensity shares the nuclear scale (GSAS-II convention), with
  the magnetic scattering length p = γ_n·r_e/2 = 2.695 fm/μ_B, so moment sizes
  are on a physical footing.
- When +k and −k are distinct (¼- and ⅓-type k, or incommensurate), each mode
  has a cosine and a sine amplitude, which describes sinusoidal, helical,
  cycloidal and elliptical modulations. One sine amplitude is held fixed,
  because the overall phase of the modulation cannot be observed. The moment in
  cell n is m(n) = M^cos·cos(2πk·n) + M^sin·sin(2πk·n), and the satellite
  structure factor uses ½(M^cos + i·M^sin).
- Symmetry tools: a search for k from magnetic-peak positions; the little group
  of k and its magnetic subgroups; independent sublattices where the little
  group splits an orbit; tied moments for ions sharing a site.
- Centred parent cells (A, B, C, I, F, hexagonal R) with k ≠ 0. A centring
  translation carries its phase e^{2πi k·t}: with phase −1 it is an
  anti-translation of the parent cell (MnO's type-II order from Fm-3m with
  k = ½½½), and with a complex phase k has two arms with cosine and sine
  amplitudes (k = (½,0,0) in a C cell). Single-arm satellites H ± k need H in
  the centred cell's reciprocal lattice.
- Refining k on powder data (two-arm k only): the components the little group
  of k leaves free become parameters, a component on the same symmetry line
  follows as a tie, and the step is capped at 0.005 r.l.u. per cycle. Checked
  against FullProf on DyMn₆Ge₆ (γ = 0.1648(7) vs 0.16509(43)). Single-crystal
  and magnetic-PDF refinements keep k fixed.
- mCIF (BNS) import and export. Moment components are given along the
  normalized crystal axes. The older magCIF spellings Jana2006 writes
  (`_space_group_symop.magn_operation_xyz`, `_atom_site_moment_label`) read
  like the DDLm ones.
- Checks: the cosine/sine formalism reproduces a brute-force sum over the
  magnetic supercell, for primitive and for C-, I- and F-centred parents; a
  simple antiferromagnet at k = (0, 0, ½) is recovered end to end; MnO
  (Fm-3m, k = ½½½) gives the -3m little group, m(r) = m₀·(−1)^{x+y+z} and
  F-centred satellites; at k = 0 the moment sizes match GSAS-II; and |F_M|²
  matches GSAS-II reflection by reflection on the Mn₃Ga 350 K data.

- Strong magnetic peaks on the nuclear lines (k = 0). The nuclear model alone
  takes up k = 0 magnetic intensity: on the simulated Mn₃Ga 30 K pattern
  (Example 3) the B's of a nuclear-only ADP stage came out 3–6× too large and
  the scale 50 % too large, at a "good" GoF of 2.1. The Agent's tools read the
  signature (a neutron pattern of magnetic ions with its misfits on nuclear
  reflections at large d, weighted by significance; `find_unexplained_peaks`'
  `k0Magnetic`): `magnetic_state` names the peaks to include in the k-search
  (they sit on nuclear lines, which the search leaves out by default),
  `diagnose_fit` puts the k = 0 check before its ADP and structure advice, and
  `refine` cautions while B's or positions are free against it with no magnetic
  model on the page. Held until the moments are in and then refined with them,
  the B's, positions, scale and moments land within 1.3σ of the simulated
  values. Lines that sit between the nuclear ones (k ≠ 0) are routed to the
  k-search by `diagnose_fit`'s unexplained-peak cause.

**Approximate**
- The k = 0 guard is advice, not a rule: the method's order (ADPs before the
  magnetic step) is the user's. It does not apply to k ≠ 0 satellites that
  overlap nuclear lines by accident in d, where a nuclear-first fit can still
  pull the positions toward the magnetic intensity on those lines.
- The magnetic form factor is spin-only ⟨j0⟩ everywhere: structure factors,
  the GPU kernel and magnetic PDF. The dipole correction with ⟨j2⟩, needed when
  the orbital moment matters (g ≠ 2), is not applied yet.
- Satellite multiplicities count the members of a Laue family that are ±k
  satellites in the parent's reciprocal lattice. Summed over the family, the
  single-arm |F_M|² is the powder intensity for any population of the domains
  of the star of k; the other members belong to other arms and are listed with
  no weight. Each family's |F_M|² is evaluated at one of its arm members, not
  averaged over the family.
- The k-search ranks candidates by peak positions, not intensities, and it
  proposes commensurate k only (denominators 2, 3, 4 and 6; in a cell with an
  angle off 90° the mixed-sign ones too, such as (¼ 0 −¼)). Type an
  incommensurate k in by hand. It predicts satellites out to the smallest d
  given, up to index ±24 along an axis, so on a cell over about 15 Å the
  satellites below d ≈ a/24 are not all predicted; that close, they crowd
  too densely to tell one k from another anyway.
- An incommensurate model exports as an mCIF of the parent cell, with the cosine
  amplitudes in the moment loop and the sine amplitudes as comments — not as a
  superspace mCIF. (A commensurate k ≠ 0 exports as the magnetic supercell in its
  own magnetic space group.)

**Not yet**
- Multi-k structures, and the star of k with its domains.
- Harmonics (3k, 5k — squared-up modulations) and (3+1)D superspace symmetry.
- Refining k on single-crystal or magnetic-PDF data, or a self-conjugate k
  (k = 0 or ½-type), which would change the modulation from one arm to two.
- Cosine/sine modes taken directly from an irrep; today they come from the
  magnetic subgroup.
- A size tie across different mode geometries when +k and −k are distinct. The
  optional equal-|M| tie then links only sublattices with the same mode
  geometry.

## Single crystal

**Supported**
- F² refinement from FullProf `.int` files and plain `h k l I σ` lists, with
  Laue-class merging (R_int, R_sigma), SHELX weights, secondary extinction
  (EXTI), R1/wR2/GooF and per-reflection outlier diagnostics
  ([SINGLE_CRYSTAL.md](./SINGLE_CRYSTAL.md)).
- Commensurate magnetic structures: `_nuc` and `_mag` reflection files merged
  into the magnetic supercell and refined with one shared scale.
- The cell is fixed input, not a refined parameter — as in SHELXL.

**Approximate**
- SHELX WGHT weights are implemented, but nothing sets their a and b terms
  yet, so both the fit and the reported wR2 and GooF weight by σ only.
- The FullProf `.int` k-vector header variant has not been checked in FullProf.
  Real files use the supercell merge instead.

**Known issues**
- The page reads `.hkl` and `.fcf` files as whitespace-separated
  `h k l I σ` rows. In a SHELX HKLF 4 file, an intensity of 10000.00 or more
  fills its field and merges with the l index. In a `.fcf` file, F²(calc) is
  read as the intensity. Readers for both formats exist but are not wired into
  the page, so check the loaded reflections, or use `.int`.

**Not yet**
- Twinning (BASF); anomalous dispersion and absolute structure; iterative WGHT
  reweighting; completeness against the theoretical unique set.
- An absorption-correction UI. The correction core (neutron μ, crystal shape,
  transmission, face indexing) is validated against WinGX but has no UI.
- The supercell merge for an incommensurate or non-axis-diagonal k.

## Real-space PDF and magnetic PDF

**Supported**
- Neutron and X-ray G(r) fitting, single- or multi-phase, with element-pair
  partials, Qmax termination ripples and a spherical-particle envelope.
- Multi-dataset co-refinement (a temperature series, or joint X-ray + neutron)
  in the core only.
- Magnetic PDF, co-refined with the nuclear PDF, for single-phase neutron data
  and a commensurate k.
- Symmetry-mode (distortion) refinement with Γ modes, taken from the
  structure's own space group or from a parent structure.
- Reduced data: `.gr`, `.sq` and `.fq` (transformed to G(r) on load), and PDFgui
  `.fgr` fit files.

**Approximate**
- Fits use uniform weights, because G(r) point errors are strongly correlated
  (Toby & Billinge 2004). Rw is therefore a relative measure — a PDF Rw runs
  much higher than a Bragg wR for an equally good fit — and esds are optimistic.
- The X-ray pair weight is f(0) = Z, independent of Q, as in PDFfit2.
- δ1/δ2 and sratio/rcut are alternative correlated-motion models: free one
  family, not both (the UI warns).
- Qdamp and Qbroad are instrument constants: calibrate them on a standard, then
  hold them fixed.
- The peak shape differs from PDFfit2's (PDFgui, diffpy-CMI) in one
  convention. MATERIA gives each pair's Gaussian a factor 1/r_ij; PDFfit2
  divides the summed Gaussians by r, which leans each peak toward low r by
  about σ²/r_ij. The curves differ by about 1 % of the rms G(r), mostly at low
  r, and PDFfit2's refined cell comes out slightly larger (75 ppm, 3 esds, on
  the GaTa₄Se₈ demo). The Qmax termination also differs in algorithm, by a
  ripple of about 0.1 % of G(r). The PDFgui / diffpy-CMI bundle's README gives
  the details.

Conventions are pinned in
[`knowledge/total_scattering_pdf_conventions_knowledge.md`](../knowledge/total_scattering_pdf_conventions_knowledge.md).

**Not yet**
- Cell-multiplying distortions refine in the child's own cell (Phase 3),
  as the child's own symmetry-adapted displacements with a generic
  symmetry-breaking kick. Their modes by parent irrep, the order parameter
  of one irrep, and ISODISTORT mode-CIF interchange come in phase 4.
  Riding hydrogens and distance restraints are not carried into a supercell
  child. The powder page has no Subgroups view: a supercell child reaches it
  as the CIF the PDF page exports. ADP, strain and occupancy symmetry modes.
- Irrep labels are generic (the k-point, "irrep n of m"): no CDML labels such
  as X3⁺ ([ADR 0004](./adr/0004-generic-irrep-labels-in-the-app.md)).
  Order-parameter directions are written in MATERIA's irrep basis and can
  differ from ISODISTORT's symbols for the same subgroup, for example (a,a)
  and (a,-a) where ISODISTORT writes (a,0) and (0,a). A few keep an
  irrational coefficient, as some in ISOTROPY's own tables do. An eight-fold
  image (I4₁/amd and Fd-3m at (0,0,½)) forces √2 − 1 in any orthonormal
  basis. A direction spread over three arms that a 3-fold permutes (the
  rhombohedral children at L; P3₁21 at R-3m's (0,½,0)) keeps √3/2-type
  coefficients in every basis MATERIA tries.
- Mode amplitudes: the refined parameter is still normalized over the
  conventional child cell. ISODISTORT's A_s and A_p are shown beside it. The
  parameter's unit changes after the agent validation freeze
  ([ADR 0003](./adr/0003-isodistort-as-the-single-convention-system.md)).
- The `build_symmetry_modes` tool (and the Γ activation) projects out a
  rigid translation along any direction every site allows. For a non-polar
  group whose sites all share one such direction, that removes a genuine
  mode. The decentring activations keep it. The fix waits on the validation
  freeze.
- Multi-dataset co-refinement from the UI or the agent tools.
- Magnetic PDF in the `refine_pdf_boxcar` and `sample_posterior` agent tools.
  The PDF page's Boxcar and Posterior views handle it.
- Data reduction from raw intensities: the workbench fits G(r) that another
  program has reduced.

**Known issues**
- A magnetic PDF with an incommensurate k, or a commensurate k whose
  denominator is above 12, is not rejected. The spin field is then built in the
  parent cell alone, so the magnetic G(r) is wrong.

## Input and output

**Supported: input**
- Structures: CIF and mCIF, read as CIF 1.1 tokens: text fields, comments, and
  loop rows that wrap or share a line. A loop whose values do not fill its rows
  is an error.
- Powder patterns: two- or three-column text (x y [σ]), the GSAS-II CSV export,
  ILL powder files, and GSAS standard histograms (`.gsa`, `.gss`, `.fxye`).
- Instrument files: GSAS-II `.instprm`, classic GSAS `.prm`, and FullProf `.irf`
  (including the `INSTRM=6` variant).
- Single-crystal and PDF files: see their sections above.

**Supported: output**
- The whole session as a `.materia.json` project
  ([PROJECT_FORMAT.md](./PROJECT_FORMAT.md)), with its step history. Between
  saves, the browser keeps the last session.
- Refined CIF with esds, and mCIF. For a commensurate k ≠ 0 the mCIF is the
  magnetic supercell in its own magnetic space group.
- An HTML refinement report (Export ▾ → Report).
- A FullProf + GSAS-II cross-check bundle of the refined structure: a CW or
  TOF `.pcr`, plus your original data and instrument files, unchanged. The
  agent tools write it too (`export_bundle`).
- A PDFgui / diffpy-CMI cross-check bundle of a PDF fit (Export ▾ on the PDF
  page). It holds every phase as a PDFfit `.stru` (the whole cell) and a CIF,
  the G(r), and a PDFfit2 script that refines exactly the free parameters,
  with every atom tied through its symmetry operation, and compares the two
  results. A script has PDFgui write its `.ddp`, and the README gives the
  conventions. The agent tools do not write it.

**Approximate**
- The `.pcr` starts scale, background and the constant-wavelength peak shape
  from seeds, not from the refined values (TOF peak shapes are carried).
- GSAS histograms: banks in FXYE/FXY format with SLOG/RALF (TOF) or CONST (CW)
  binning are checked against real POWGEN files. STD/ESD fixed-column packing
  follows GSAS-II's reader and is covered by synthetic tests only.
- A `CONST` bank is read as constant wavelength. A rare constant-step TOF
  `CONST` bank needs its unit set by hand.
- Mantid `XYDATA` exports (`SaveFocusedXYE`, POWGEN `.dat`) are read as plain
  x y σ columns, the TOF unit taken from their `#` header. Their abscissa is
  the focused TOF (difC·d), and the file carries no calibration: load the
  frame's `.instprm` with it. Checked on one real POWGEN file (local data).

**Not yet**
- CIF: DDLm-style dotted names for the cell and atom sites
  (`_cell.length_a`), and the esds of input values (they are dropped).
- `.pcr` export for single-crystal and multi-phase refinements.
- Bond-length and angle tables in the report.
- Saving and opening projects through the agent tools.
- Saving posterior samples or the magnetic page's k-search exploration in a
  project. The applied magnetic model is saved; the exploration is re-run.

## Non-goals

- Matching every feature of established crystallographic refinement suites.
- Automating expert crystallographic judgment.
- Serving as the sole basis for published structural or magnetic results.

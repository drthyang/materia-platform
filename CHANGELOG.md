# Changelog

Notable changes to MATERIA, newest first. Releases are tagged `vX.Y.Z` on `main`.
While the major version is 0, a minor release adds a feature or changes how the
tool is used (file formats, saved projects, CLI flags, API, URLs), and a patch
release fixes bugs.

## [Unreleased]

### Added

- **The Agent on the single-crystal page.** It reads the page in its own
  terms — a fit to integrated F², SHELX's R1 over Fo² > 2σ with wR2 and GooF
  over every reflection, the cell fixed input from indexing — frees, refines,
  assesses, switches the ADP model, sets the outlier filter and writes the
  report, as on the powder and PDF pages. Its method is the new skill
  `sc-workflow` (general practice, not yet the user's own): the data read
  before the model, the scale then extinction, positions, isotropic then
  anisotropic ADPs, occupancy only for a reason, and what the report must say.
  `reflection_statistics` reads the data first: merging, resolution and
  completeness by shell, the Friedel pairs, the reflections the space group
  forbids measured at ≥ 3σ, and ⟨|E² − 1|⟩; the reading is the method's first
  stage and a row of the report. `set_outlier_filter` is the page's |Δ|/σ
  cutoff. `assess_refinement` there adds the analysis of variance by intensity
  and resolution, the extinction reading, the largest outliers and the tensors
  that are not positive definite.
- **The single-crystal page switches its ADP model** (one B per site, or the
  symmetry-allowed U tensor seeded from the refined B), and saves the choice
  with the project.
- **The SNS TOPAZ time-of-flight reflection file** (GSAS-II's "SNS TOF HKL
  F2"), in the app and over MCP: per reflection its wavelength, 2θ, path
  length, transmission and run. Its first 32 columns are SHELX HKLF 4, so it
  read as a SHELX file before, at one wavelength of 1.54 Å; it is now
  recognized first. The extinction of a Laue measurement is computed at each
  reflection's own wavelength and angle (SHELXL's EXTI, as HKLF 2 carries a λ
  per reflection); a time-of-flight file without them had none at all. On
  sapphire (31 orientations, d down to 0.40 Å) the correction reaches
  y = 0.09, and R_int falls from 24.8 % at low angle to 6–7 % at high angle,
  the signature of a λ-dependent extinction.
- **A scale per batch** (`bscale_<b>`, relative to the first batch), one row
  for each further batch of a SHELX HKLF 4 file with batch numbers or each
  run of a TOPAZ file, entered fixed: the data reduction scales the batches,
  and freeing them is a decision the residuals by batch support. The SHELX
  readers now keep the batch number. On sapphire, 30 batch scales took wR2
  from 13.80 % to 13.01 % and left the structure where it was.
- **The extinction test**: the outlier filter can also leave out the
  reflections whose extinction factor y falls below a cut (the page's "or
  y <" box, `minExtinction` in `set_outlier_filter`), to see whether the
  structure rests on the most extinguished reflections. On sapphire, without
  the 152 of y < 0.5, the positions and Al's tensor held within an esd and
  O's U values fell by 3 % (2σ).
- **`reflection_equivalents`**: every measurement of a reflection and its
  equivalents, with batch, wavelength, extinction factor, and the distance
  from Fc² and from the median of the family, to tell a failed measurement
  from a model that misses before anything is left out. Sapphire's 5 4 1 in
  batch 24 read 41(10) against nine equivalents that agree with Fc² ≈ 1360
  within 2σ: a detector edge, not the model.
- **Esds for the anisotropic tensors and the bonds.** `structure_table` gives
  each U^ij and U_eq with its esd, and `bond_geometry` on the single-crystal
  page each length with the esd its refined positions give (Al–O
  1.8549(2) Å).
- **The single-crystal reading of a fit**, in `reflection_statistics` and
  `assess_refinement` and in the report: how the data were measured (the
  wavelength band, the batches, the transmission), K and R1 by batch with the
  batches farthest from the mean and their worst reflection, the reach of the
  extinction correction (the smallest y, how many reflections fall below 0.8
  and 0.5), and the report's tables of resolution shells, the analysis of
  variance by intensity, the batches and the largest outliers. `refine` gives
  R1 and GooF with wR2.
- **Single measurements left out by hand** (`omit_reflections`, the page's
  "Omitted" row): SHELXL's OMIT h k l, by the file's indices and batch, with
  the reason, saved with the project and listed in the report. A σ cutoff
  takes whatever lies beyond it: on sapphire the second failed measurement of
  batch 24, 3 4 2 at 39 % of what its 16 equivalents read, sat at −42σ among
  the extinction-limited misfits (−30 to −42σ), and the cutoff the Agent set
  just above the next worst left it in. The GSAS-II tutorial removes it.
  Omitting both took wR2 from 19.07 % to 16.79 % before anything else moved.
- **Each outlier read against its equivalents**, in `assess_refinement` and
  the report: the other measurements' Fo²/Fc² (median and scatter) beside
  this one's, and the verdict — a failed measurement (off by itself while its
  equivalents agree, so it holds when that one failure drags the fit), the
  model's misfit (all of them off the same way), or equivalents that disagree
  among themselves (a correction that differs with wavelength, such as
  extinction before it is refined).
- **Becker–Coppens extinction** (`set_extinction_model`, the page's extinction
  menu): secondary type I or II with a Gaussian or Lorentzian mosaic, as
  GSAS-II computes it, with each reflection's path length, beside SHELXL's
  EXTI. The parameter is GSAS-II's Eg or Es in its units. On sapphire, type I
  Lorentzian fits better (wR2 12.08 % against 13.52 %, GooF 2.49 against
  2.79), with Eg = 6.2·10⁻⁴ (the GSAS-II tutorial's, on F with a cut:
  5.71·10⁻⁴).
- **A resolution range** (`set_resolution_range`, SHELXL's SHEL; the page's
  "Resolution" row), for the high-order refinement that tests the extinction
  model through the ADPs: on sapphire, Becker–Coppens gives the same U_eq
  from all the data as from d ≤ 0.5 Å alone (0.00349(5) and 0.00342(7) Å² for
  Al), while EXTI's all-data U_eq lie 6–7 esds below its own high-order ones
  and its parameter falls from 0.30 to 0.070(5).
- **Refinements compared** in the single-crystal report: the last converged
  refinement under each set of conditions (extinction model, resolution
  range, omissions, filter, ADP model) on the path to the result, with wR2,
  GooF, the extinction parameter and each site's U_eq, all computed from the
  History, so an account can quote a test.
- **Eval scenarios** `sc-data-first`, `sc-failed-reflection`,
  `sc-failed-measurements`, `sc-extinction-test`, `sc-extinction-model` and
  `sc-batch-scales`, from the sapphire round, each replayed as the Agent should
  behave and as it failed.
- **The radiation and wavelength of single-crystal data** (`set_radiation`,
  the page's λ box beside the probe): a SHELX `.hkl` or `.fcf` carries
  neither, and loaded as neutron at 1.54 Å with no way to say Mo Kα. The
  scale restarts from its best value under the new physics.
- **Riding hydrogens** (`set_riding_hydrogens`), as SHELXL's AFIX: an sp² C–H
  on the external bisector of its parent's two neighbours (AFIX 43), at its
  distance or one given (0.93 Å at room temperature, 0.95 Å below about
  200 K), any other at its present offset (AFIX 3), with U_iso 1.2·U_eq of the
  parent (1.5 for methyl and hydroxyl) and no parameter of its own; their
  derivatives go to the parent, as SHELXL's do. It reproduces SHELXL's 16
  hydrogens of dipyridyl disulfide to 0.003 Å and their U_iso to 10⁻³ Å². The
  result lists each X–H as placed and names those out of range;
  `structure_table` marks the riding ones, the report states the treatment,
  and a refinement with hydrogens free against X-ray data draws a note. On
  X-ray data the anisotropic switch leaves the hydrogens isotropic.
- **SHELXL's weighting scheme** (`set_weighting`, the page's WGHT a b with a
  "suggest" button): w = 1/[σ² + (aP)² + bP], P = (Fo² + 2Fc²)/3, re-evaluated
  at the fit's own Fc² until it settles, as SHELXL recomputes it every cycle.
  `assess_refinement` gives SHELXL's suggestion for the model as it stands —
  the a and b that make the GooF flat across the intensity bins and 1 overall.
  With dipyridyl disulfide's published WGHT 0.0362 0.7686 the page gives
  wR2 7.78 % and GooF 1.03 for the 254 parameters (SHELXL: 7.86 % and 1.041),
  and suggests 0.0324 0.951. wR2 and GooF in the report and in the agreement
  are weighted by the scheme; R1 is not.
- **Eval scenarios** `sc-radiation-first`, `sc-riding-hydrogens`,
  `sc-listing-honesty` and `sc-weighting-last`, from the dipyridyl disulfide
  round.
- **The fit range, read from the data's ends** (`check_fit_range`, in the app
  and over MCP), the first stage of the Rietveld method and of its checklist.
  It proposes where the window starts and stops, as the GSAS-II tutorials do:
  just below the first reflection (background beyond it), unless the data hold
  peaks there no phase explains, which stay in (Cr₂WO₆ at 4 K: four peaks below
  the first nuclear line, the strongest 40σ); and in a gap below what is not
  real data — counts that step up and stay at the last points, points with no
  counts, a line cut by the last point, the short-d stretch where no peak
  stands out of the noise, or (on a converged fit) a stretch the model misses
  more than anywhere next to it. Every cut lies in a gap between reflections;
  `set_fit_range` applies it with the user's approval. On PbSO₄ (D1A) it
  proposes 18.8–153.95°: below the first reflection at 20.4°, and above the
  last 0.8°, which one detector counts and which sits 4.4σ above the model
  once the base is refined. On fluorapatite, NAC, Cr₂WO₆ and Mn₃Ga it keeps
  what the tutorials keep. The user found the edge on the demo.
- **Instrument and thermal parameters refined apart** — a firm rule: `refine`
  refuses a free set holding the instrument's terms (the zero or TOF
  calibration, Caglioti U V W, Lorentzian X Y, the TOF profile, the asymmetry;
  Qdamp and Qbroad on a PDF) together with the B values or ADPs, and says how
  to alternate. Only the user lifts it (`allow_exception`). Each refinement of
  one group reports the `alternation`: its largest shift since its last
  refinement, in esd, and `settled` once a cycle moves neither by more than
  0.3 esd (a note when the shifts shrink slowly: the groups are coupled). The
  skills give the reason; `rank_next_parameters` marks the groups the rule
  would refuse. The user found it on the demo, which refined both together.
- **Eval scenarios** `instrument-thermal-apart` and `fit-range-edges`, each
  replayed as the Agent should behave and as it failed.
- **docs/AGENT_EVALS.md**: the scenarios, how to run them, and the results
  against real models (Haiku 5.5 32/36 and Sonnet 5.5 28/36 over 12 scenarios
  ×3; gemma4:26b on Ollama 9/10), with what the failures were. Live runs now
  record the tokens each run spent.
- **The fit diagnosis in the powder report**, as `diagnose_fit` gives it on
  the fit on screen, so an account that quotes it ("the lines are 2.45×
  broader") quotes the report.

- **Known phases the Agent can add** (`add_known_phase`): a phase
  `identify_peaks` matched goes into the model as a further phase, with the
  library's room-temperature cell and positions and B ≈ 0.5 Å², so its scale
  and cell refine with the others; it always asks the user. The library now
  holds the impurities a synthesis leaves most often: CaF₂, NaF, NaCl. On NAC
  from 11-BM, 22 unindexed lines were fluorite, 1.448(6) wt %.
- **Phase fractions and line broadening in the powder report**: the weight
  fractions (Hill & Howard, with their basis), the crystallite size and
  microstrain from the refined Lorentzian with the instrument's subtracted,
  the instrument file's profile beside the refined one, and the axial
  asymmetry named in the peak shape.

- **Bond lengths in the report.** Each phase's table of the cations'
  coordination shells at the refined positions — neighbour, length and
  multiplicity (Mn–O6 1.9067 ×2 · O1 1.9692 ×2 · O6 2.1794 ×2 in LaMnO₃) —
  in the HTML and Markdown report, so the lengths an account cites are the
  report's own. The shell reaches 3.2 Å, so a long Jahn–Teller bond stays in it.
- **The local structure as lengths** (`boxcar_scan` with `bonds`, PDF page):
  each box reports the named cations' coordination shells in the structure
  that box refined, and each bond's spread across the boxes. The PDF report
  carries the last scan as "Local versus average": per box its r range, Rw and
  the tracked lengths. On LaMnO₃ at 300 K the short and long Mn–O pairs hold
  at 1.900–1.910 and 2.173–2.189 Å from the 1.5–6.5 Å box to the 14.5–19.5 Å
  one.
- **A scan's own free set** (`boxcar_scan` `free`): each box refines the
  parameters named, and the page keeps its free set and its fit, so the
  report written next still matches them and carries the scan.
- **The PDF page's ADP model**: the ADPs group's "anisotropic (U tensor)" box,
  and `set_adp_model` for the Agent on the PDF page too. A CIF with U_aniso
  columns loaded 20 tensor rows for LaMnO₃ even with isotropic values, and
  nothing switched them to one U per site, as a small-box fit refines them.
  Saved with the project.

- **The Agent's analysis report** (`write_report`). Read in the app and saved
  as one self-contained HTML file, as Markdown (the figure embedded) or as
  PDF from the print dialog, with the CIF beside it. It holds the page's
  report — data, model, the observed/calculated/difference figure, the
  structures with esds, every parameter, Rwp/Rexp/GoF and the diagnostics —
  and how the analysis went: the History's steps on the path to the result
  (what each refinement freed, the method stage behind it, who took it), the
  method's checklist, the engine's checks with the issues left open
  (convergence, agreement, correlations, bounds, residual peaks,
  Durbin–Watson, bond valences, the cell check and symmetry review), the
  Bayesian check of the refinement on screen, the Agent's notes, and the
  model used. Every number comes from the engine and the History; the Agent
  writes only its account, labelled as its words, and a number in it that the
  report did not compute is underlined and handed back to the Agent to
  correct. A new eval scenario replays it.

- **A lab tube's Kα₂.** Every reflection is drawn at Kα₁ and Kα₂ (at the
  intensity ratio, as GSAS-II and FullProf draw it), read from a GSAS
  `.prm` (λ₂ and KRATIO), a GSAS-II `.instprm` (Lam1, Lam2, I(L2)/I(L1)) or
  a FullProf `.irf` (WAVE λ₁ λ₂ ratio), shown on the instrument card,
  written to both cross-check bundles, and used by the cell check. Without
  it every high-angle Kα₂ peak of lab data was a misfit.
- **The cell check on lab data.** Its Le Bail fit refines a zero shift and
  the axial-divergence asymmetry (after the cell has converged without
  them), and draws a background seeded from the curve under the peaks with
  more terms over a wide 2θ range. Small bumps on a strong line's flank are
  reported as `shoulders` — a profile tail, not a phase — and no longer as
  unindexed peaks. On the GSAS-II fluorapatite data its cell agrees with
  GSAS's refined one to 1 part in 10⁵.
- **`diagnose_fit` measures the lines.** Observed against calculated
  half-maximum widths and Lorentzian fractions of isolated lines name a
  width or shape misfit directly (an instrument file's 0.05° lines against
  the sample's 0.09°; a Gaussian core widened to reach Lorentzian tails),
  and their flanks are no longer read as a background misfit.
- **X-ray instrument constants for the Agent** (`set_instrument_constants`):
  the polarization fraction and the Kα₂ ratio, which a fit cannot determine
  — the polarization moves every B at the same wR. Always asks the user.
- `parse_powder_data` (MCP) takes the instrument, so the pattern carries its
  radiation: X-ray or neutron, λ, polarization and Kα₂.
- Tables in the Agent's replies render as tables.
- **Antisite disorder for the Agent** (`add_antisite`): two sites exchange
  their atoms — each element added on the other site at occupancy 0, with
  Σ occ = 1 and hold composition on — so the exchange refines as one
  fraction under the formula. Asks the user.
- **"On" and "beside" a reflection follow the line width** on
  constant-wavelength data (one width, three widths) instead of a fixed
  0.5 % and 2 % in d: on CW neutron data 2 % was four widths, and the
  cryostat's Al 111 read as a misfit of the sample's 200.
- **Which phase is that extra peak?** (`identify_peaks`, for the Agent):
  extra peaks matched against the sample environment (Al cans and cryostat
  shields, V, Cu, steels, Nb, Pb), holders (corundum, graphite) and
  standards (Si, LaB₆, CeO₂), with the lines each candidate should also show.
  On Cr₂WO₆ at 150 K it named the cryostat's aluminium.
- **The Agent checks unconvincing numbers with the Bayesian posterior**
  (`sample_posterior` on the powder and PDF pages, and the `bayesian-check`
  skill). When an esd is as large as the value, a parameter sits on a bound,
  a pair stays strongly correlated or a value moves between refinement paths,
  the Agent samples the posterior of the free parameters (the Posterior
  view's ensemble MCMC) and reports credible intervals, one-sided limits and
  the posterior correlations, with the convergence evidence. The MCP
  `sample_posterior` samples powder fits too (single-phase, multi-phase and
  nuclear + magnetic), given build_refinement's profile.
- **Bond-valence sums** in `bond_geometry` (MCP and Agent): each cation's sum
  against its oxidation state (Brese & O'Keeffe R₀, b = 0.37 Å), flagged
  beyond 8 % and 15 % of the valence.
- **Equal-value ties** (`tie_parameters`, for the Agent): B values (or
  occupancies) the data cannot separate refine as one value — the
  cations of an oxide, all the oxygens — with that value's esd reported on
  every tied site. The tie survives every rebuild of the parameter set (a
  background, correction or site-tie change) and travels in the project.
  On Cr₂WO₆ at 150 K (Q ≤ 4.7 Å⁻¹) two refinement paths at the same wR gave
  B(W) 0.8 and 1.5 Å²; the tied pair gives one B with an honest esd.
- **`diagnose_fit` knows what is already free.** Once the Caglioti terms and
  the Lorentzian X refine and the line widths agree, it no longer says to
  free them: it names what is left — asymmetry, anisotropic broadening, or
  the profile function's limit, with the esds read as too small.
- **New data of the same structure starts from the refined structure.** The
  cell, positions, ADPs and occupancies carry over from the last fit (a
  temperature series: the paramagnetic refinement seeds the ordered data);
  scale, background and profile start afresh, and Reset returns to the CIF.

- **Why a fit is poor, cause by cause** (`diagnose_fit`, for the Agent). The
  residual read as a crystallographer reads a difference curve: background,
  peak positions, asymmetry, width/shape, intensity falling off with angle (a
  ΔB), texture along a low-index direction, and what is left for the
  structure — each with its share of χ² and what to do — plus Rwp′,
  Durbin–Watson, χ² by d shell and the worst reflections. On real PbSO₄ D1A
  data it found the missing peak asymmetry that held the fit at wR 12%.
- **Corrections on the powder page.** The profile group's corrections boxes
  (and the Agent's `set_corrections`) switch on Finger–Cox–Jephcoat
  asymmetry (S/L with H/L tied to it, as GSAS-II's SH/L), March–Dollase
  preferred orientation along h k l, sample displacement, transparency, μR
  absorption and surface roughness. The core had them; the page could not
  add them. They are saved with the project.
- **The refined structure as reported** (`structure_table`): cell,
  coordinates, occupancies and B as value(esd), powder and PDF.
- **Reset one parameter** (`reset_parameters` with ids): back to its
  starting value, e.g. a Lorentzian term that refined negative.
- **The Agent works the magnetic analysis step.** On the powder page it can
  now read the step (the residual peaks the k-search uses, k, the magnetic
  space groups of the little group of k), search and set k, choose the
  magnetic ions and the moment ties, rank the groups by a moments-only fit,
  choose one, fit its moments, and show the model on the refinement pattern
  or hand its moment rows to the refinement step to refine nuclear and
  magnetic together — the step's own controls, with the page switching to it
  as it acts. A `magnetic-analysis` skill holds the method (a first draft, to
  confirm with the user); its changes wait until it has been read. When
  several k explain a few satellites, the search says so and names the
  simplest.
- **An eval suite for the Agent** (`src/agent/evals/`). Ten scenarios, each
  written against a failure the researcher rounds or a user found (the
  refused full refinement, misfits called extra peaks, a lower symmetry
  proposed first, a bare occupancy, a window given in d, the magnetic step,
  the PDF method), run
  through the real chat loop and tools on pages built from the repository's
  data, and graded. CI replays each with a scripted model, once as the Agent
  should behave and once as it failed, so every check is shown to catch its
  failure; `npm run eval:agent` runs them against a real model.
- **The space group is reviewed last** (`review_symmetry`, for the Agent and
  over MCP). Once the structure is refined to the best its space group allows
  — scale, background, cell, positions, profile, ADPs — and the fit is still
  not good, it reads the refined residual at the reflections the group
  forbids and lists the subgroups of the same lattice that allow those still
  carrying intensity (named, smallest index first, with their domain counts),
  for the user to decide. The Agent cannot run it earlier: it answers with the
  stages left to refine. A subgroup of an origin-choice-2 group (F-43m of
  Fd-3m:2) is now named across its origin shift.
- **The Agent remembers an analysis.** Its notes (`write_note`: an absence the
  cell check flagged, an impurity found, a decision of the user's), the cell
  check, the symmetry review, the exceptions the user allowed and the
  method's stages done are saved with the project and autosave, and read back
  in the next session.
- **Long Agent sessions stay in the window.** With Claude the API clears old
  tool results past 60k tokens (keeping the skills read); a local model gets a
  pruned copy of the history past ~15k tokens.
- **The method's firm rule is enforced, and its stages shown.** On both pages
  the Agent cannot refine an occupancy with no tie; only the user can lift the
  rule (`allow_exception`, an approval card even in Auto). The drawer shows
  the method's stages as a checklist, done or next, ending with the symmetry
  review, and a refinement out of order says so.
- **The Agent reads its skills when it needs them.** Its system prompt now
  lists the skills (the user's methods) by name and description instead of
  carrying the Rietveld skill and two knowledge bases on every request (about
  6 KB instead of 63 KB, which a local model's context needs). The Agent reads
  a skill with `read_skill`, and the knowledge bases a skill cites only when a
  question needs them; it must read the open page's method before its first
  change there. The skills are the same `.claude/skills` files Claude Code uses,
  so adding a skill needs no code. A PDF skill (`pdf-workflow`) joins the
  Rietveld one, and the Rietveld skill now matches what the app enforces (the
  correlation exemptions, the site ties, phase fractions).
- **Hold the composition** (Shared site row, and the Agent's new
  `set_site_ties`): each element on two or more sites keeps its total in the
  cell, so atoms exchange between sites while the formula stays (anti-site
  disorder, spinel inversion). A normal-spinel start on neutron data of
  MgAl₂O₄ with 22% inversion refined to 0.25(4).
- **Phase fractions.** After a multi-phase powder refinement, each phase's
  weight fraction (Hill–Howard, from its refined scale, cell-contents mass and
  volume, with an esd from the scale esds) shows on the Structure card and in
  the Agent's `get_state` (Mn₃Ga with 3.7 wt% MnO read back 3.65(8) wt%).
- **The Agent runs boxcar scans on the PDF page** (`boxcar_scan`): the free
  parameters refined box by box across r, shown in the Boxcar view, with each
  box's Rw and values returned, to tell the local structure from the average.
- **The cards the Agent is on breathe.** While the Agent is open, the edge of
  each card a running or waiting tool call acts on (Structure, Data,
  Instrument, Pattern, Parameters, Result) breathes, as do the cards a reply
  points to in its last paragraph (for a few seconds) and a reply under the
  pointer. With reduced motion the edge is steady.

### Changed

- **Single-crystal structure factors with analytic derivatives.** A kernel
  computes F for a fixed reflection list and, in the same pass, ∂F for every
  position mode, U mode, B and occupancy, so the Jacobian costs about two
  evaluations instead of two per parameter. On dipyridyl disulfide (4508
  reflections) an evaluation went from 835 ms to 96 ms and the 253-parameter
  anisotropic refinement from 23 minutes to 16.5 s.
- **A refinement's listing says so.** A `.fcf` with calculated columns loads
  marked as a refinement's listing — each reflection once, on that
  refinement's scale, the absences left out and, in SHELXL's LIST 4, its
  extinction divided out — and get_state, `reflection_statistics`, the data
  card and the report say what cannot be judged from it. R_int of data with
  one value per reflection reads "n/a (merged)" in place of 0 %.
- **The correlation guard lets through a pair a third parameter carries.** The
  engine now reports, for each correlated pair, its correlation with every
  other free parameter held fixed. A pair over 0.95 whose correlation the
  others carry (below 0.9 with them fixed, and under 0.99 itself) refines,
  listed in the outcome and the report: the scale, the extinction and the ADPs
  of a single-crystal fit correlate so, and every single-crystal program
  refines them together (on synthetic corundum to d = 0.4 Å, scale ↔ B(O)
  reads 0.976, 0.72 with the rest fixed, and both B's come back within
  0.002 Å² of the truth). A pair that trades off itself still stops it.
  The overall intensity terms of a single-crystal fit — the scale, the
  extinction and the batch scales — are listed and refined together whatever
  their correlation: under severe extinction scale ↔ extinction reads 0.99
  (sapphire), and every single-crystal program refines them so.
- **A single-crystal refinement runs until every shift is below 0.05 esd**
  (up to 50 cycles), the crystallographic criterion, not until χ² stops
  falling: with a GooF near 3 a shift of most of an esd changes χ² by less
  than the engine's tolerance. Sapphire with its batch scales stopped after 7
  cycles with the extinction still moving by 0.79 esd, and needed 21.
- **The single-crystal verdict names the causes of a misfit on integrated
  F²** (extinction, badly measured reflections, isotropic ADPs, σ's too
  small), not the powder's background and profile, and an ADP at its bound
  points to extinction first.
- **The demo, re-recorded** (docs/media/agent-demo.mp4, 91 s): the Agent now
  reads the data's ends first and leaves out the background below the first
  reflection and the last 2° of the D1A scan, and refines the instrument's terms
  and the B values in turn until the alternation settles (wR 3.87 %, GoF 2.06).
  The turns were written in a live run through the app and are replayed for the
  recording.
- **The fit range in the record and the report** says what the window leaves
  out and why, end by end, once a second read finds the window already set.

- **`identify_peaks` ranks a candidate by the peaks it explains, weighed by
  how plausible its cell is**, then by line strength. Isostructural phases
  explain the same peaks, and the cell tells them apart: on NAC, fluorite at
  its own cell came first, where the line strengths alone had put CeO₂ (the
  same lattice 1 % smaller). Lines down to 0.5 % count; a candidate whose
  strongest line is missing is called doubtful, and an impurity is called
  part of the sample.
- A glob without a phase prefix (`pos_*`, `cell_*`) matches every phase's
  rows of a multi-phase model, in `set_free`, `get_state` and the scans.

- **The Agent's opening text says what it is and what it does.** It names
  the model in use (Claude, or the local model on Ollama or LM Studio), says
  it can run the whole analysis by the page's method and discuss it, and
  describes the approval mode that is on (Ask first or Auto), with examples
  for the page open.

### Fixed

- **Loading a new CIF on the single-crystal page rebuilds its parameter
  rows.** The page stays mounted for the same data, and kept the old
  structure's rows against the new structure's bindings; the new spec's rows
  now replace them, with the last fit and an applied magnetic model, which
  belong to the old cell.
- **The single-crystal model no longer applies a Lorentz–polarization
  factor.** Reflection files hold Fo² already corrected in data reduction
  (SHELX .hkl and .fcf, FullProf .int, the SNS TOPAZ .hkl), and the model
  multiplied Fc² by 1/sin2θ (and the X-ray polarization) again: against
  SHELXL's own Fc² in the GSAS-II tutorial's 1b.fcf (Mo Kα) the ratio ran from
  14 at low angle to 0.9 at high angle, a fall-off with angle for the scale and
  the ADPs to absorb. Fc² is now k·y·|F|², as SHELXL, Jana, FullProf and
  GSAS-II fit it and as the page's own magnetic path already did; the ratio
  is flat within 5 % (a test reads the tutorial file when it is present). The
  Prefit and Escape searches were tuned on the old surface and recovered a
  trapped start for 2 seeds in 10 on the corrected one; a new seed sweep sets
  the positional kick floor to 0.15 and 50 iterations per start (8 in 10).
- **Switching to anisotropic ADPs starts from the refined sphere in any
  cell.** The seed was U11 = U22 = U33 = U with zero off-diagonals, which is
  a sphere only on orthogonal axes: in a hexagonal cell the sphere has
  U12 = U/2. On sapphire (R-3c) the switch moved wR2 from 14.13 % to 14.48 %
  before anything refined; it now stays at 14.13 %. U_eq is the full
  ⅓ Σ U^ij a*_i a*_j (a_i·a_j) (Fischer & Tillmanns), not the trace, in the
  structure table, the CIF export and the switch back to one B per site.
- **The reflection statistics read the reflections the space group allows.**
  They set the unique reflections measured, forbidden ones included, beside
  the count the group allows (sapphire: 484 against 466 expected, of which
  444 allowed), and reflections per parameter counted the forbidden ones,
  whose Fc is 0 whatever the model. ⟨|E² − 1|⟩ now carries the ε factor
  of special reflections, and is reported as no test for a structure of
  fewer than six independent sites or mostly on special positions
  (corundum: two, both special), where Wilson's distributions do not hold.
  A forbidden reflection measured is given as a fraction of the allowed
  intensity at its d (sapphire's: about 1 %, multiple diffraction).
- **The extinction reading compares the strongest reflections with the
  rest.** It asked whether K = ΣFo²/ΣFc² of the strongest bin was below 0.95,
  but before extinction is refined the strong reflections pull the scale
  down and every K reads above 1 (sapphire with the scale alone: 3.6 on the
  weakest bin, 1.7 on the strongest), so severe extinction read "not
  indicated". The strongest bin now reads against the median of the others.
- The single-crystal page's probe hints no longer mention a polarization
  factor (the model applies none to corrected Fo²) and say that a
  time-of-flight file with each reflection's wavelength has its extinction
  computed at it.
- The report's number audit accepts a number more precise than the report
  prints when it rounds to the printed value (2.9992 for a printed 2.999).
- The symmetry-last eval read "Neither is evidence for a lower group" as
  proposing one: "neither" and "nor" count as negations.
- A boxcar scan given its own free set is checked against the method's rules
  with that set, not the page's.
- A refinement that did not finish no longer marks the method's stages done.
- **The instrument file's peak asymmetry.** A GSAS type-3 profile's S/L and
  H/L (PRCF12) and GSAS-II's SH/L were dropped, and switching the asymmetry
  on seeded 0.01, nine times 11-BM's 0.0011. They are now read, seed the
  asymmetry, and `get_state` says the file carries one.
- **The powder page reads its ADP model from the structure.** A CIF with
  U_aniso columns loaded 22 tensor rows for NAC while `get_state` said
  `anisotropicAdp: false` and the box under ADPs was unticked; a no-op
  `set_adp_model` now says so.
- The cell check's record names its unindexed peaks by d, so the report's
  cell check lists them and a note that cites them cites the report.
- `interpret_structure` printed a microstrain esd under 0.5 × 10⁻⁶ as
  "± 0".
- **No GoF beside a PDF fit's Rw.** The report's steps listed one (0.32 on
  LaMnO₃), though uniform weights make it meaningless; History steps no
  longer record it for a PDF fit, and the report leaves it out of older ones.
- **PDFgetN files load as neutron data, and only their data.** A PDFgetN
  `.gr` (NPDF and the other neutron instruments it reduced for) names its
  instrument (`machine=npdf`) and program but never the radiation, so it
  loaded as X-ray data; and the rows of its header's bank and multiplier
  tables were read as twelve points at r = 1–6 Å with G up to ±148. The data
  now start at the file's `start data` line, and PDFgetN or a neutron
  instrument in the header means neutrons. A file that names no radiation
  says it was read as X-ray — on the data card, to the Agent, and in a
  notice that loads it again as neutron data; the MCP `parse_pdf_data`
  returns `radiationAssumed` and takes `scatteringType` (LaMnO₃ at 300 K).
- **A settings change kept the magnetic model's moments in the fit.**
  Switching on the asymmetry or an absorption correction, changing the
  background terms, site ties, the microstrain or the ADP model, adding a
  phase or loading an instrument rebuilt the parameter set from the nuclear
  model alone: the moment rows (and their bindings) were dropped, and the next
  joint refinement held the moment at its last value without saying so. They
  now carry over as they were, free or fixed (Cr₂WO₆ at 4 K).
- **The Agent's `rank_magnetic_groups` read the ranking it ran.** It read the
  magnetic step's state from the handle taken before the ranking, which the
  page replaces each render, and so returned the previous table (empty on a
  first ranking).
- The magnetic step's ranking table no longer resets when a parameter is
  freed or fixed: the refined phases it is drawn from are rebuilt only when a
  value changes.
- **The method's first stage is not marked done by the scale alone.** The
  scale is refined with every stage, so a refinement of the positions with
  the scale free no longer ticked "scale, background, cell" in the
  checklist (and so opened the symmetry review) when the background and the
  cell had never been refined.
- **d read off constant-wavelength data takes out the refined zero shift**, as
  GSAS-II's Pos2dsp does. The residual peaks the Agent and the MCP tools
  report, the peaks handed to the k-search, the d and Q axes of the plot and
  its reflection ticks all used the raw 2θ: with a 0.2° zero every d was
  0.3–1 % short at low angle (the cryostat's Al 111 on Cr₂WO₆ read 2.322 Å),
  enough to misplace a peak against the reflections, and the ticks sat
  0.2° from the calculated peaks.
- **The k-search finds k = 0 on wide lines.** A peak now matches within 0.5 %
  of its d where that is wider than 0.02 Å (a line's width in d grows with d),
  and among k that explain the same peaks the simpler ranks first. On
  Cr₂WO₆ at 4 K the magnetic 0 0 1, 0.031 Å from its position at d 8.8 Å,
  missed the fixed tolerance, and two peaks fit (0 ½ ¼) as closely as k = 0:
  the search offered incommensurate vectors for a k = 0 antiferromagnet. The
  Agent's `search_propagation_vector` also takes `exclude` / `include` (peak
  numbers), as the peak table's check boxes do, to leave out a line already
  identified as the sample environment.
- **The posterior sampler starts its walkers within an esd** of the refined
  values when the least-squares esds are known, not within 1 % of each value
  (hundreds of esds for a cell length, where a walker could settle in a false
  minimum for the whole chain); and the powder page's Continue runs the
  steps asked for, not the first run's.
- **Channels without counts in GSAS raw data are dropped**, as GSAS-II
  weights them zero. Fitted as one count, the two zeros padding the end of
  a Cu Kα scan (FAP.XRA) carried half the χ² of the refinement and pushed
  every B up.
- Loading the instrument file after the data kept only its wavelength and
  X-ray/neutron kind: the polarization (and now the Kα₂) were lost.

- **The cell check on a constant-wavelength neutron instrument.** Its Le Bail
  fit used two width terms, which cannot follow a resolution curve that falls
  then rises with angle (D1A: V < 0); on real PbSO₄ data the high-angle
  flanks read as four unindexed peaks. The check now takes the curve's shape
  from the instrument file's U, V, W.
- **GSAS raw histograms over MCP and in the file picker.** `parse_powder_data`
  read a `.CWN`/`.XRA` (BANK, STD) as columns, giving nonsense x values; it
  now reads them as the app does. The data picker accepts `.raw`, `.cwn`,
  `.xra`, `.gsas`.
- **Data loaded before a structure.** The page showed the empty placeholder
  model as a parsed structure (P1, a = 1 Å) and the Agent judged it; the card
  now says no structure is loaded, the Agent's tools refuse with what to do,
  and the cell check refuses a cell that places no reflection.
- **A negative Lorentzian X or Y** is flagged by the assessment as unphysical.

- **The Agent no longer refuses a refinement on the cell check, calls
  intensity misfit extra peaks, or proposes a lower symmetry first.** The cell
  check (`check_cell_symmetry`) is a sanity check at the start that never
  blocks a refinement; intensity it finds at a forbidden reflection is noted
  for the end, not acted on. `find_unexplained_peaks` counts and marks only
  peaks on no reflection of any phase, and lists residual on known
  reflections apart as misfits, which refinement fixes. The skill and the
  system prompt now say the space group is changed last, if at all, when
  nothing else can be refined. The check also stops reading a strong
  neighbour's tail as a forbidden reflection's intensity (a violation must be
  a peak's apex).

- **Occupancy restraints reach the Rietveld fit.** The powder page never sent
  them, so a shared site's occupancies refined with no Σ restraint (the site
  could empty or over-fill) and "Σ occ = 1" did nothing. They now go with
  every nuclear refinement whose occupancies are free, single- or multi-phase.
- **R, wR and GoF describe the data alone.** Restraint pseudo-observations were
  counted in them, which understated wR (by about 3% of its value on a
  restrained spinel fit, and on PDF fits with a shared site).
- **Loading an instrument file first** (before any structure or data) no
  longer blanks the page.
- The Agent's correlation check no longer refuses the Caglioti U, V, W
  together, nor two occupancies one restraint ties: like the background
  coefficients, they move together by construction. The assessment notes them
  once instead of warning per pair, and for a displacement parameter at a
  bound on a shared site it points to the site's mixing first.
- **The cell gate on a sloped 2θ background.** Its Le Bail fit had a flat
  background at constant wavelength, so a lab pattern's slope stayed in the
  residual (wR 50%) and read as unindexed intensity; it now has three
  Chebyshev terms. When unindexed peaks and a violated absence come together,
  the Agent is told the violation may be a line of the same unidentified
  phase, rather than a wrong space group.
- Correlated Lorentzian X and Y widths are explained (they differ only in how
  they grow with angle), like the Caglioti U/V/W.
- **The cell gate on a wide 2θ scan.** Its Le Bail fit used one peak width at
  constant wavelength, so high-angle flanks read as unindexed peaks and a
  correct cell failed (Mn₃Ga 30 K, 5–130°). The width now grows with angle
  (Caglioti U). The gate's unindexed peaks come with d and Q and are marked on
  the plot.
- Excess intensity on nuclear reflections in a neutron pattern of a phase with
  magnetic ions is flagged as possible k = 0 magnetic order, before atoms or
  ADPs are refined into it.
- A CIF without a phase name is named from its common name, formula or data
  block, not "structure".
- The Agent's refine reported the previous history step when the page took
  long to render; switching Ask first / Auto during a run now reaches the
  model at its next turn.
- On the PDF page, the assessment's advice for a displacement parameter at 0
  is about real space (correlated motion, a short window), not Rietveld
  background or absorption; the Agent's bond list names each bond once.
- **Residual peaks are judged against each point's uncertainty and the known
  reflections.** Lone noisy points in a low-count TOF region were reported as
  "unexplained peaks", and so were misfits of a phase's own reflections. Now
  a peak must stand 5σ above its own noise, and each is reported as on a
  reflection, beside one (a shoulder or tail), or unexplained, in the
  assessment, the Agent and the plot marks.
- The assessment reports background-coefficient correlations as one note
  (they are expected), not a warning per pair, and no longer rounds 0.995 to
  1.00.

### Added

- **The Agent never refines correlated parameters together.** Before it
  refines, it measures the free set at the current values with the page's own
  fit; two parameters correlated at |ρ| ≥ 0.95, or a combination the data
  cannot determine, stop the refinement until one of each pair is fixed. The
  approval card shows the strongest pair left; the Refine button is unchanged.
- **The Agent works in any axis unit.** Its fit window can be given in TOF,
  2θ, d or Q and is converted with the page's calibration; positions it
  reports come in d, Q and the data's own axis.
- **The Agent marks unexplained peaks on the Rietveld plot** when it looks for
  them, with a list under the plot to zoom to each and a Clear button.
- **The Agent keeps going when a model stalls.** It notices a reply that
  promises a tool call it does not make, an empty reply after a tool result,
  or "waiting for" a tool that already answered, and asks the model to go on.
  It stops a reply that keeps repeating itself. On LM Studio it loads a model
  with a 32k context before the first message, and refuses one loaded with
  less.
- **The Agent on LM Studio.** A fourth way to reach a model: a local model on
  your LM Studio server (0.4.1 or later, with CORS on), listed from the server
  with each model's loaded context.

### Removed

- **The Agent's Claude Code mode**, with the `materia-live` MCP server, its
  `mcp:live` / `build:mcp-live` scripts and its `.mcp.json` entry. The Agent
  now starts on your own API key; a saved Claude Code choice falls back to it.
  The `materia` MCP server is unchanged.

## [0.3.0] - 2026-10-09

### Added

- **The in-app Agent** (#37). A model beside the workbench reads the live powder
  or PDF analysis, judges it with MATERIA's analysis tools, and makes changes
  through the page's own controls. Every change waits for your approval and
  becomes a History step tagged as the agent's, so it can be undone. No tool
  types in a parameter value: the model chooses what to free and when to refine,
  and the least-squares engine sets every value. Four ways to reach a model:
  Claude Code (the `materia-live` MCP server), your Anthropic API key, a local
  proxy on the dev server, or a local model on your Ollama server.
- **Step history** (#13, #14, #24, #26). Go back to any refinement step on the
  powder, single-crystal and PDF pages. The history is a tree, autosaved and
  saved with the project; the step you are on shows beside the back/forward
  arrows.
- **Validation views** (#36): a verdict, residual analysis (powder) and analysis
  of variance (single crystal).
- **S(Q) error propagation** (#28): S(Q) error ribbons, and exact propagation of
  the S(Q) uncertainties to G(r).
- **The cell and space-group gate** (#15): `check_cell_symmetry` refines the cell
  with a Le Bail fit, then checks that every leftover peak indexes and every
  forbidden reflection carries no intensity.
- **MCP tools an LLM can drive** (#10, #12, #16, #25, #30): data travels by
  reference, files by path, and `free` takes globs; the `export_bundle` tool;
  worked examples of an LLM driving the tools, replayed in CI.
- **Layouts** for iPhone, iPad, MacBook and 1K/2K/4K screens (#19). The
  refinement result folds into one collapsible section (#20).
- Refinement convergence is reported as max shift/esd (#23).
- The Mn₃Ga demo opens on a fit window; the MCP magnetic refinement takes moment
  restarts; a compact history card (#21).

### Fixed

- Magnetic dipole form factor: the sign of the ⟨j₂⟩ term (#22).
- Scattering tables, space-group settings, CIF types and reflection truncation
  (#27); CIF tokens, label case, isotopes and symbol-less export (#32).
- FullProf and GSAS-II exports use the right conventions and carry the full
  refined model; TOF sig-q is linear in d (#29). Cross-check bundles carry the
  refined structure (#12).
- Each profile peak fades to zero at its support edge (#18).
- Le Bail: the TOF peak shape, the net-intensity partition, and impurity phases
  in the cell gate (#33).
- A staged refinement that re-fixes a parameter keeps a fit of the values it
  returns (#35).
- The assessment words a held out-of-range value as an input, not a refined one
  (#31).
- Reopening a PDF project restores its last result, and Reset behaves the same
  on every page (#14).

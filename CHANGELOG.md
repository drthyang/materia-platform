# Changelog

Notable changes to MATERIA, newest first. Releases are tagged `vX.Y.Z` on `main`.
While the major version is 0, a minor release adds a feature or changes how the
tool is used (file formats, saved projects, CLI flags, API, URLs), and a patch
release fixes bugs.

## [Unreleased]

### Added

- **A B that refines to 0 gets ranked options, never a silent change.**
  When a powder refinement leaves an isotropic B on its lower bound, the page
  shows a notice over the parameters naming the atom, the B it reached, and
  the options with their sources: a tie to a site of the same element that
  refined sensibly (preferred), ties to other cations of the same
  coordination (alternatives, labelled with both species and a caution), and
  the starting structure's B as it stands (an alternative). With none, no
  value is proposed: the repository has no documented table of typical B
  values, and no arbitrary floor is used. Each option has its own Apply; it
  becomes a tie or a held value like any other (Release or ⌘Z undoes it); the
  report lists it under Limitations, and `assess_refinement` and `get_state`
  show it to the Agent. Projects save the record beside the rows
  (`zeroAdpFixes`); files without it open unchanged.

- **The Agent chooses a B-at-0 option (`apply_adp_proposal`).** It picks one
  of the app's ranked options per row by id (it cannot name a partner or a
  value outside them), preferring the same-element tie, taking a
  cross-element one only with a reason, and otherwise the starting value or
  none. Asking first, the card shows every option with its pick preselected
  (choice buttons on the approval card), and the user's pick is applied, or
  nothing on Decline. In auto mode its pick applies without a card, and the
  result, the History, the notice and the report record it as the Agent's
  choice in auto mode, with the options not taken. Added at the owner's
  decision, although it changes the model-visible tool list before the
  validation freeze (docs/AGENT_PLAN.md).

- **Plot interactions: a cursor readout, map-style zoom, pan, keyboard and
  touch.** The pattern, G(r), magnetic-step and S(Q) plots share one
  interaction module (`usePlotInteraction`, `visualization/plotView`). Hover
  for a cursor line and a readout of x in the axis unit (to the data step),
  obs, calc, diff and the reflections under the cursor. Ctrl/⌘ + scroll and
  pinch zoom about the cursor; a plain scroll scrolls a scrolling page (with a
  hint) and zooms where nothing scrolls. Drag pans (clamped to the data),
  Shift + drag box-zooms (a tall box also fixes y), double-click, **Reset** or
  0 resets; +, −, arrows and Shift + arrows work when the plot has focus, and
  the readout reaches screen readers. On a phone one finger scrolls the page
  and two pinch. The zoom now survives a refinement that moves a converted
  axis (a refined zero or difC in a d display). The series and tick rows are
  drawn on a canvas, decimated per pixel column: a zoom on a 100 000-point
  pattern took 2–3 s and now fits a frame. Drag no longer rubber-band zooms
  (that is Shift + drag), and a zoomed line no longer runs under the y-axis
  labels.

- **Strong k = 0 magnetic peaks are taken to the magnetic step, not into the
  ADPs.** On a neutron pattern of magnetic ions whose misfits sit on nuclear
  reflections at large d (the k = 0 signature), the Agent's `magnetic_state`
  now names those peaks to include in the k-search instead of "nothing
  magnetic to find", `diagnose_fit` puts the k = 0 check before its advice to
  free the ADPs, and `refine` cautions on its card while B's or positions are
  free against the signature with no magnetic model on the page. On the
  simulated Mn₃Ga 30 K pattern the method's ADP stage on the nuclear model
  alone left the B's 3–6× and the scale 1.5× too large at a "good" GoF of 2.1,
  and the true group's moments-only fit 0.7–1.7 µB short; with the B's and
  positions held until the moments are in, every parameter lands within 1.3σ
  of the simulated values. The k = 0 signature is now weighted by each peak's
  significance (it was a count, which weak small-d misfits outvoted), and
  `diagnose_fit`'s unexplained-peak cause routes lines on a neutron pattern of
  magnetic ions to the k-search.

- **The background is kept off the peaks the model lacks.** Excess between
  the lines that no reflection explains — a run of background points whose
  residual stands above the noise on a line's scale (1–8 line widths, 1 %
  false alarms on pure noise) — is now a cause of its own in the Agent's
  `diagnose_fit` ("unexplained-peak": explain it, never fit it with the
  background), and is left out of the points the background is judged on.
  The background cause names the count those points justify (BIC of the
  background alone), and `set_background` cautions on its card when more
  terms would absorb such excess or exceed that count. Before, a line the
  model lacked was billed to the background as "more terms": on a simulated
  POWGEN pattern a broad line at d = 5.3 Å loses 18 % of its intensity to 4
  Chebyshev terms, 62 % to 12 and 97 % to 24, and an information criterion
  over every point the model leaves to the background asked for 16 (79 %);
  with the line left out it asks for the 4 the line-free pattern gets.

- **POWGEN data start on a logarithmic background**: GSAS-II's log
  interpolation with 3 points (at the TOF range's ends and their geometric
  mean), where the instrument file names POWGEN or PG3, or names no known
  instrument and the data file's name hints at POWGEN (`PG3_…`; `NOM_…` hints
  at NOMAD, which has no default of its own), and the pattern is
  time-of-flight. The hint is a guess, labelled as such, never saved. On the 350 K Mn₃Ga bank it fits as well as the 4-term
  Chebyshev default with one parameter fewer (wR 8.90 % against 9.00 %, scale,
  background and cell refined). The basis and the count stay the user's (the
  Background group, the Agent's `set_background`, MCP `build_refinement`'s new
  `backgroundType`), and a saved project keeps its own. Log- and
  linear-interpolation backgrounds are now seeded at their own points, keep
  their curve when the number of points changes, and the report names the
  basis refined instead of always "Chebyshev".

- **The Agent asks with buttons (`ask_user`).** Where the next decision is the
  user's and no tool's result lists it, the Agent puts a question with 2 to 6
  options; each shows as a button under the turn and sends exactly its
  message, as the k, group and next-step choices do, and the question ends
  the model's turn. A change an option asks for still goes through its change
  tool and approval card; a clicked option's numbers are not counted as the
  user's by the report's number audit, and the checks on a final answer read
  the question too. In-app only (not an MCP tool). Added at the owner's
  decision, although it changes the model-visible tool list before the
  validation freeze (docs/AGENT_PLAN.md).

- **Choices to click in the Agent's conversation.** The k the k-search found,
  the magnetic groups the ranking fitted and the next steps the assessment
  suggests show as buttons under the turn, from the tool's result: a click
  sends the message the user could have typed ("Set the propagation vector to
  k = (1/2, 0, 0)."), "Another…" puts a template in the message box, and a set
  stops sending once the conversation or the page moves on. Keyboard
  accessible. The k set says what k is in: reciprocal-lattice units of the
  cell as loaded (a centred lattice's conventional cell).

- **The published Mn₃Ga 350 K POWGEN data** in `examples/mn3ga-350k`: the
  histogram and instrument parameters, the GSAS-II magnetic structure
  (C m′c m′), MATERIA's refinement of it, and a nuclear starting model. The
  350 K golden tests read them when the git-ignored `data/` folder has no
  copy, so the GSAS-II magnetic comparison runs in CI.

- **The Agent on any server that speaks OpenAI's API**: OpenAI, Gemini's
  OpenAI-compatible endpoint, vLLM, a llama.cpp server. A base URL, a key if
  the server needs one (kept as Anthropic's is), a model from the server's
  list, and the model's context when the server does not say it.

- **A local tier for the Agent's evals**: each run also reports the turn cap,
  the loop guard, chat errors, refused or cut prompts, each turn's prompt size
  and its time, with an acceptance level for a local model. A new scenario
  runs the user's own request on their own (unpublished, git-ignored) data
  where the data are.

- **Agent evals re-scored for free.** A live run's `_OUT` report now keeps
  each run whole (every tool's answer, the records, each report's text and
  what its number audit read), and `regrade.test.ts` scores it again with the
  checks as they are now, with no model called. CI replays every scripted run
  through that save and re-score.

- **The Agent's report gives where the fit started and what was read on the
  way**: the agreement before its first refinement, the cell check's Le Bail
  fit (Rwp and cell) and each earlier `diagnose_fit` reading by the step it
  read, so an account that cites them cites the report.

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
  are weighted by the scheme; R1 is not. a and b are SHELXL's, on its
  absolute scale, so a measurement at its own scale takes SHELXL's numbers as
  they are: 1b's raw data, weighted with b on the data's scale, gave a GooF
  of 0.35 for SHELXL's 1.044 (1.010 now).

- **Eval scenarios** `sc-radiation-first`, `sc-riding-hydrogens`,
  `sc-listing-honesty` and `sc-weighting-last`, from the dipyridyl disulfide
  round.

- **The refined structure against the one loaded** (`structure_table` with
  `against: "loaded"`, single-crystal page): each site's shift in Å and in
  esds and its U_eq against the loaded value, the sites beyond 2 esds listed —
  for "does this reproduce the published refinement?". On dipyridyl disulfide:
  no shift beyond 0.0008 Å (0.6 esd), and the four sulfur atoms' U_eq 1.5 %
  below SHELXL's (4.3–4.5 esd), the f′ the app does not have yet.

- **A molecule's bonds in the report**: for a structure with carbon, the
  covalent bonds (closer than the covalent radii and 0.4 Å) with esds from the
  refined positions, as SHELXL's `_geom_bond`, in place of the cation shells,
  which for an organic molecule listed each carbon's N and S contacts and no
  C–C bond. A riding hydrogen's bond is marked as set by its constraint.

- **`bond_geometry` by atom** (`atoms`): only the bonds to the sites named. A
  list cut at 40 now says so; on dipyridyl disulfide the S–S and S–C bonds lay
  beyond the 40 shortest and were dropped without a word.

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

- **Anomalous scattering.** X-ray amplitudes carry f′ and f″ at the
  laboratory lines (Cr to In Kα, 96 elements), so the two members of a Friedel
  pair differ in a non-centrosymmetric crystal, and a heavy atom scatters what
  it does.

- **Twin laws and the Flack x** (`set_twin`, single-crystal page): the fit
  sums the twin domains' F² with refined fractions, as SHELXL's TWIN and BASF
  do, with analytic derivatives; the inversion twin's fraction is the Flack x.
  A law that cannot twin the crystal (one of its point group's own operations,
  or no rotation of its lattice) is refused. The state, the assessment and the
  report read the anomalous scattering, how many acentric reflections have
  their Friedel opposite measured, and the fractions.

- **Disorder on the single-crystal page**: a CIF's disorder assembly and group
  (SHELXL's PART) are read and written, and no bond joins two alternatives of
  one disorder. `tie_parameters` there makes a disorder's second occupancy one
  minus the first (SHELXL's 21/−21) and holds one site's whole ADP to
  another's (EADP); get_state lists each assembly. Covalent radii for every
  element (Cordero et al. 2008), so a metal's bonds count. The Agent's
  correlation guard lists the parameters of one disorder among themselves
  rather than refusing them: two alternatives 0.2 Å apart correlate at −0.99
  by construction, SHELXL refines them together, and their esds carry it.

- **SHELXL's hydrogen groups** (`set_riding_hydrogens`): a methyl or NH₃
  rotating about its bond with its torsion refined (AFIX 137), a hydroxyl
  likewise (147), a CH₂ pair with H–C–H set by its X–C–Y (23), a methine (13),
  sp² on the bisector (43), a metal's hydrogen at its offset (3); X–H at
  SHELXL's distance for the measurement's temperature. On 1b, placed from the
  heavy atoms of SHELXL's own .res, all 20 riding hydrogens land within
  0.0001 Å of SHELXL's. A hydrogen the data place (a hydride) can refine its
  position while its U rides on its parent, as SHELXL's −1.2.

- **Distance restraints** (`restrain_distances`, SHELXL's DFIX and SADI):
  rows after the data, weighted 1/σ², with analytic derivatives, counted as
  SHELXL counts them. `assess_refinement` gives each one's deviation and the
  restrained GooF; the report and the CIF carry them.

- **A CIF with its own measurement** (SHELXL's `_shelx_hkl_file`) loads as the
  data, at the radiation and wavelength the CIF names.

- **The equivalents merged as SHELXL merges them** (`merge_equivalents`, the
  page's "merge" switch): SHELXL's MERG 2 — each family averaged, the Friedel
  opposites kept apart in a non-centrosymmetric group, the systematic absences
  left out. The statistics, R_int and the outliers by their equivalents still
  read the measurement. On 1b, 13169 measurements merge to the 2482
  reflections SHELXL refined. `reflection_statistics` gives R_int as SHELXL
  reports it for a non-centrosymmetric group, the Friedel mates apart (1b:
  2.93 %, SHELXL's figure), beside the Laue class's (3.04 %): the excess is
  the anomalous signal.

- **SHELXL's refinement of 1b reproduced** (a Ga/Al hydride in P2₁2₁2₁, an
  inversion twin, an Al/Ga disorder, five hydrides under SADI; the GSAS-II
  tutorial's CIF with its own measurement), in a test and through the Agent's
  tools: the same 142 parameters and 8 restraints give R1 2.02 % (SHELXL
  2.04 %), wR2 4.97 % (5.04 %), GooF 1.030 (1.044), Flack x 0.435(11)
  (0.435(15)) and the Al share 0.844(2) (0.844(2)), in 4 cycles. The esds of
  the positions and U^ij are 0.75× SHELXL's (median; 0.61–1.00): a
  Monte-Carlo at the fit's weights scatters as this app's say, and on the
  centrosymmetric dipyridyl disulfide the two agree to the digit. SHELXL
  refined the same 2482 reflections (its listing holds the 1020 Bijvoet
  partners apart), so the merge does not explain it; without SHELXL's code
  the cause stays open.

- **Eval scenarios** `sc-merge-first`, `sc-absolute-structure`,
  `sc-disorder-tied` and `sc-hydrides-restrained`, from round 3 (1b): the
  measurement merged before the first refinement, the Flack x refined as an
  inversion twin and quoted as the engine gives it, a disorder's occupancies
  tied before they refine, and a hydride's position refined only under a
  restraint. The chiral test page can measure each reflection at several of
  its equivalents.

- **The esds against a published refinement's** (`structure_table` with
  `against: "loaded"`): a CIF's standard uncertainties are read with its
  values (positions, U_iso, the U tensor, occupancies) and saved with the
  project, and the comparison gives each kind's ratio of this app's esd to the
  published su, median and range, from the esds as computed (not as printed).
  On 1b: 0.75 for positions and U^ij. The report carries it as a check
  ("Against the model loaded"), with the largest shift in esds and the U_eq
  ratios, so the account can quote it.

- **SHELXL's suggested weights in the report**, beside the scheme in use (a
  "Weights" check), as SHELXL prints both after every run.

- **Bonds and contacts apart** in `bond_geometry` for a molecular structure:
  a bond is what the covalent radii make one (their sum + 0.4 Å); the longer
  contacts up to the cutoff are listed separately.

- **The History names a tie** ("occ_Ga1 = 1 − occ_Al1; EADP (6 ADP rows
  tied)"), not "Parameters tied".

- **SHELX instruction files as the structure** (`.ins`, `.res`; the
  single-crystal, powder and PDF pages' "Load CIF…" takes them): CELL's
  wavelength and the cell, LATT and SYMM expanded to the space group (P6₁
  from 3a's five SYMM lines), SFAC's elements, every atom line in SHELX's U
  order (U23 U13 U12) and continued with `=`, a sof read with the site's
  symmetry, free variables resolved (21 is fv(2), −21 is 1 − fv(2)), PART as
  the disorder groups, a riding U (−1.2) as 1.2·U_eq of the previous atom
  that is not a hydrogen; nothing after END (a .res's difference-map peaks).
  TWIN, BASF, EXTI, WGHT, FVAR, AFIX, TEMP and the hydrogens' U come back as
  the file's instructions, which `get_state` lists for the Agent
  (`shelxInstructions`) — none applied until it sets them — and a reflection
  file loaded with it is measured as X-rays at CELL's wavelength.

- **The floating origin of a polar space group**, held as SHELXL holds it
  (Flack & Schwarzenbach, 1988): in P6₁, P2₁, Pc, P1… shifting every atom
  along the polar axis changes no intensity, so a fit with every coordinate
  free had a direction the data cannot see. The Z²-weighted mean coordinate
  along each polar direction is now held, one restraint per direction,
  counted as SHELXL counts it ("1 restraint" on 3a), named in the report's
  Restraints row and in `get_state` (`polarAxes`).

- **A shared refined hydrogen U** (SHELXL's free variable on the U column,
  21.0): `set_riding_hydrogens` `sharedU` gives each list of hydrogens (by
  label, by geometry — `[["methyl"]]` — or "all") one U_iso that refines
  (`B_shared_1`, freed with the ADPs) instead of riding on its parent's U_eq.
  On 3a the 15 methyl hydrogens refine 0.0885 against SHELXL's 0.08883.

- **A twin with both hands** (`set_twin` `withInversion`: SHELXL's TWIN R −4,
  the law, the inversion and the two together), the domains of the inverted
  hand summed into the Flack x. A domain and its inverse differ only by the
  anomalous signal, so their fractions trade (−0.999 on 3a): the correlation
  guard refines them together, as SHELXL does, and says so, and the
  assessment notes it once. The esds of the Flack x and of the first domain's
  fraction come from the fit's full covariance (`combinationEsd`, a new
  engine output for named linear combinations), not from the fractions' in
  quadrature.

- **`invert_structure`**: the model inverted through the origin, as SHELXL's
  MOVE 1 1 1 −1 with the space group changed by hand — every coordinate x →
  −x, the origin shifted where the group needs it to keep its setting (I4₁,
  I4₁22, I4₁md, I4₁cd, I-42d, Fdd2, F4₁32), and the space group to its
  enantiomorph in the eleven pairs (P6₁ → P6₅). The positions as refined,
  the riding groups (placed afresh), the restraints (each image mapped) and
  every other row are kept; a twin with both hands keeps its fit (each domain
  takes its inverse's fraction), a lone inversion twin's x becomes 1 − x.
  Saved with the project; the report's "Absolute structure" row says so. The
  Flack reading for x near 1 now names the tool.

- **Parsons' quotients** (Parsons, Flack & Wagner, 2013): the Flack x from
  the Bijvoet pairs fitted both ways, Q = (I⁺ − I⁻)/(I⁺ + I⁻) against the
  model's (an inverted twin domain folded onto the one it inverts), the scale
  and most systematic errors cancelling — `assess_refinement`'s
  `absoluteStructure` and the report's "Absolute structure" row. On 3a: x =
  1.08(6) from 432 pairs for SHELXL's P6₁ model, −0.08(6) for its inverse.

- **3a's hand.** SHELXL's model of 3a (Cs(C₅Me₅)·py, the GSAS-II
  merohedral-twin tutorial's .ins) is the wrong enantiomorph: refined as SHELXL
  refined it, it reproduces SHELXL's R1 2.18 % on 1458 reflections and BASF
  0.3407; the twin with both hands puts x = 1.01(5) on the inverted domains,
  Parsons' quotients give 1.08(6), and the same model in P6₅ refines to R1
  1.83 %, wR2 4.76 % against 5.66 % (a ratio of 1.19 for 161 parameters and
  1465 reflections), x = −0.08(6).

- **The lattice's merohedral twin laws, tested before the model.**
  `reflection_statistics` lists, where the cell's metric holds more symmetry
  than the Laue class, each merohedral twin law (one per coset of the Laue
  class, the simplest rotation of it, as `set_twin` takes it) with the twin
  fraction Yeates' H-test reads for it from the intensities alone, ⟨H⟩ = ½ − α
  over the acentric pairs (h, R·h) (`twinLaws`; the data record names the
  strongest). On 2b it reads α 0.448 on h, k, l → k, h, −l against 0.165 and
  0.145 for the other two laws, before any model (refined, 0.4965); on 3a its
  one law at about a third (BASF 0.34068).

- **Ring centroids and hydrogen bonds** in `bond_geometry` and the report
  for a molecule: its planar five- and six-membered rings (each atom within
  0.1 Å of the plane), a metal within 3.6 Å of a centroid, an N–H or O–H
  pointing at one (X–H···Cg above 120°), the angle at a metal between its
  two nearest centroids, and the hydrogen bonds D–H···A as SHELXL's HTAB
  finds them (H···A within the van der Waals contact, D–H···A above 110°),
  each image by its CIF code. On 3a, Cs1 sits 3.030 and 3.066 Å from the two
  C₅Me₅ centroids; on 2b the ammonium's N1–H1D points at an aryl ring's
  centroid at 2.44 Å and 175°, and there is no classical hydrogen bond.

- **The cell's esds** from the structure file (SHELXL's ZERR, a CIF's su):
  the single-crystal page holds the cell fixed, and now carries its esds
  into the report's cell table and Unit cell row, the CIF and
  `structure_table`, with the volume's esd, and adds the cell's part to the
  bond esds as SHELXL does. Each independent cell parameter moves by its esd,
  the lengths and angles the lattice holds equal moving together (a and b of
  a hexagonal cell). 1b's V comes out 1402.4(3) Å³ and dipyridyl's
  2000.8(3) Å³, as SHELXL's CIFs give them; 2b's 3889.43(7) Å³.

- **2b, reproduced** (the GSAS-II merohedral-twin example in P3₂, an
  aluminate with 567 parameters): its 8435 reflections are SHELXL's 8414
  once the 21 absences are out, and with the twin SHELXL's model refines to
  R1 4.32 % on 7595 reflections (SHELXL 4.33 % on 7597), 5.16 % on all
  (5.17 %), BASF 0.4965 (0.4966), in 2.5 minutes.

- **Eval scenario** `sc-twin-from-data`, from round 5 (2b): the merohedral
  twin the data read is set before the structure refines.

- **Eval scenarios** `sc-listing-extinction`, `sc-inverted-hand` and
  `sc-weights-final-model`, from round 4 (3a): the extinction held at 0
  against a refinement's listing, a model of the wrong hand inverted and
  refined again, and the weights set again for the final model once its hand
  is settled. `weightsLast` now counts the twin and the hand among the model's
  changes, and reads the last weighting scheme set, not the first.

### Changed

- **The local AWO₄ magnetic demo refines the moments alone, the nuclear model
  held.** Its solve (`awo4MagneticSolve.test.ts`, `AWO4_SOLVE=1`) no longer
  ends on a joint nuclear + magnetic fit. Its last step, the owner's rule for
  the magnetic refinement, frees only the magnetic parameters: the chosen
  group's moments, and k's components where the little group lets k move
  (none for k = (½ 0 0)). The scale, background, cell, instrument terms,
  positions, ADPs and occupancies stay at the nuclear stage's values, and the
  solve checks that none moved. The group is chosen as before (Hamilton's
  test, top-down: P2/c′). The demo opens on that step: the nuclear rows held,
  the moment rows free, so Refine from it refines the moments only. The
  solution file records the free rows (`free`) and the wR of that step
  (`magneticWr`, which replaces `jointWr`). The demo refuses an older solution
  file and asks for it to be regenerated. The data-gated 8 K benchmark
  (`realAwo4Benchmark.test.ts`) follows the same rule: its last step refines
  the ★ group's moments with the staged nuclear model held, the B-at-0 checks
  read the nuclear fit, and C9 asks that step to hold every nuclear row and
  end no higher than the ranking's fit, where it asked a joint fit to end
  strictly lower. The magnetic page and the user's own refinements are
  unchanged.

- **The refinement report reads as a paper's results section.** Export ▸
  Report (and the Copilot's report) now opens on a short **Result**
  paragraph: what was refined against which data, the outcome with its key
  numbers, the verdict against the acceptance bar and the main limitation.
  It restates the app's own judgment (on a powder the Validation tab's
  verdict and causes of misfit; on a single crystal its Validation checks;
  on a PDF the assessment's findings); where the Copilot wrote an account,
  its account takes that place. **Structure** gives per phase the space
  group, the phase fraction and the cell as its independent parameters
  ("a = b = 5.41964(5) Å, c = 4.37366(7) Å, V = 111.254(3) Å³", no angle the
  symmetry fixes), an atom table with Wyckoff positions, esds where refined
  and fractions where the site symmetry fixes a coordinate, and the
  distances as small tables. **Fit** has the figure, the agreement indices in
  one line and the other refined values; **Quality and caveats** one line
  per acceptance check, cause of misfit and limitation, with only the
  correlations worth reading (a background's coefficients among themselves
  left out, as the Validation tab leaves them out). The tiles, the repeated
  statistics and the data-and-model list are gone from the body: the data
  and model, the refinement's statistics, every parameter and the record go
  to the collapsed appendix, which printing opens. The page is set like a
  journal's: white, booktabs tables with numbers aligned on the decimal
  point, one typeface with tabular figures, sentence-case headings, one
  accent color, italic symbols, typeset space groups and formulas, and the
  minus sign. The Markdown the Copilot's viewer saves follows the same
  order. The text the Agent's number audit and the validation read keeps
  its earlier layout, frozen, so neither moves.

- **One short zoom hint on every plot and 3D view.** The pattern, G(r), the
  magnetic page's pattern and S(Q) each carry one line under the plot in the
  gestures of the device: "⌘ + scroll to zoom · drag to pan · double-click to
  reset" on a Mac, the same with Ctrl elsewhere, and "Pinch to zoom · drag to
  pan" on a touch screen. Every 3D model (powder, PDF, magnetic, single
  crystal) says "Scroll to zoom · drag to rotate" (on a touch screen, "Pinch
  to zoom") beside its View a / b / c chip. The rest (Shift + drag box zoom,
  the keys, a trackpad's pinch and swipe, the fit-range handles, the
  reflection ticks; panning the 3D model) is in the line's tooltip: hover it,
  focus it, or tap it. The hint replaces the long captions under the powder
  and PDF plots and the 3D views; the PDF Qdamp/Qbroad note keeps its own
  line. On a touch screen it shares the row of the zoom buttons, so the
  phone layout gains no row. The magnetic page's pattern card grows by the
  hint's line on a desktop instead of letting it run past the card.

- **The powder Validation tab says each thing in one short line.** About
  half the words on the demo (as it opens, after Refine, and with its cell
  off by 0.3 %). Each line leads with what to do: "Fair fit: misfit mostly in
  the peak tails", "Above your bar (good ≤ 2.5)", "Mn3Ga: Ga1 occ held at
  1.005 → set to 1", "In GSAS-II / FullProf, once the bar is met", "Model's
  tails too short → Refine TOF σ and β (keep α), after the atom positions".
  Where refining is the next step, the state line says why and **Refine**
  follows it. The full sentences, the statistic, the method's reasons and
  `diagnose_fit`'s own words are behind a **?** beside each check and cause
  (and on hover), so nothing is dropped. What was said twice is said once:
  the physical card no longer restates "nothing unphysical", the cross-check
  no longer repeats the state line's "no esds yet", the headline leaves the
  GoF to its card, and the footer leaves the worst peaks' share to their
  summary below. Same numbers and advice as before; the Agent's tools, their
  text and the validation's arm A are unchanged.

- **Phones and tablets: layouts fitted to iPhone and iPad Pro screens.**
  Tuned on the iPhone 18 Pro and Pro Max and the iPad Pro 11" and 13", upright
  and sideways; a desktop window looks as it did. On a phone held sideways the
  plot and the 3D canvas fit the screen with their tab row (the plot was ~1.5
  screens tall), a plot that short keeps most of its height for the pattern,
  the 3D view fits the cell to the canvas on any touch screen, and the summary
  cards sit three across. The Copilot docks beside the page on any landscape
  window up to 540 px tall. An iPad held landscape scrolls as a page with
  screen-tall rows, so the parameter list is no longer a 290 px box and the
  magnetic page's 3D card shows its model. Lists that scrolled inside a card
  inside the scrolling page (subgroups, distortion modes, the run result, the
  posterior table) take their height. Controls are 44 px tall on a touch
  screen. The plot's zoom buttons take a row under the plot on a touch screen
  or a narrow plot instead of covering the x-axis title, the magnetic pattern
  check no longer runs past its card, and the Copilot's sheet header keeps
  Ask first / Auto off its name. Captions name finger gestures on a touch
  screen (pinch to zoom, drag to pan or rotate). The header, the Copilot's
  rail and drawer and the cards stay out of the iPhone's safe-area insets.

- **The magnetic page on a desktop: the steps lead, and the pattern and the
  model stay in view.** The workflow (steps 1–5) sat in the narrower right
  column as a box scrolling inside its card, with step 4's candidate list
  below its fold, beside a 3D card whose model filled a fraction of its canvas
  and whose legend ran past the card. The steps now take half the row (up to
  1000 px) at their natural height, and the row scrolls as a whole beside a
  rail pinned to it: the pattern check over the 3D model, both in view while
  candidates are clicked. The 3D view fits the cell to its canvas with a mouse
  too, and nothing runs past a card at 1440, 1920 or 2560 px; a window under
  ~800 px tall runs the rail past the fold. The residual-peak table shows its
  six strongest peaks (and every peak in the k-search) until "Show all", and
  its "near" column gives the reflection's hkl, with the phase only when the
  pattern has several; a single phase's tick row is "nuclear" in the legend.
  "Set k" is a quiet button while the fields hold the k in use, not a faded
  primary one that read as broken. Phones and tablets keep their layouts.

- **The powder Validation tab reads the fit against your acceptance bar.**
  It opened on a verdict of mixed-weight lines beside eight agreement
  numbers, with diagnoses but no actions, and called the demo's converged fit
  "Not refined yet". It now reads top down. One line says where the fit
  stands, beside the state of the fit (a demo's converged snapshot says so,
  and that it has no esds until you refine). Your method's acceptance bar
  follows as three checks, green, amber or red: the goodness of fit in the
  assessment's bands; physical sanity, scaled (a negative B or a structural
  value on its bound is a blocker, a held occupancy 0.5 % over 1 a note);
  and the GSAS-II/FullProf cross-check, with why the esds may not hold.
  **What limits the fit** lists the causes the Agent's `diagnose_fit` reads,
  largest share of χ² first, each with its evidence and what to do in the
  method's order (a misfit of the cell, zero or background first);
  **Open …** opens the parameter group (nothing is freed), **Show on
  pattern** the spot. The evidence is collapsed below: the residual strip,
  χ² by d-shell, the worst peaks, and every agreement number with R_Bragg
  and R_F per phase and Durbin–Watson. The causes and findings are built
  from the page as the Agent's tools build them, so the tab no longer warns
  of a background's own coefficients correlating, nor says "every residual
  peak indexes" where the Agent finds lines no phase explains. Without a
  refinement that describes the values on screen, the card's GoF is that of
  the curves on screen. The Agent's tools and text are unchanged, and the
  validation's arm A still reads the old verdict.

- **On the PDF page, the symmetry is chosen on the Subgroups view and the
  modes are inspected on the 3D Model view.** The Γ irrep tree (each irrep's
  label, dimension, optic and acoustic counts, with its **Activate →**
  buttons), **Load parent CIF…** and **✕ clear** moved from the 3D Model view
  to the Subgroups view, beside the subgroup lattice. The Subgroups view shows
  the choice in force, a parent-CIF decomposition as well as an activation,
  with **✕ clear** and a link to the 3D Model view; its pickers wait while one
  is in force or a fit runs. The 3D Model view keeps the mode table (amplitude,
  esd, free/fixed, total |A|, the acoustic combinations excluded; a row click
  draws the mode as green arrows) and names the parent or subgroup the modes
  lower to. With no modes, it says in one line that the symmetry is lowered on
  the Subgroups view, with a link there, and points to Positions →
  “Irreps (modes)” for the structure's own symmetry-conserving modes. The
  Agent's tools and text are unchanged.

- **A shared site's occupancies sum to exactly its total, on the powder and
  PDF pages.** They were separate free rows held by a soft Σ restraint (σ
  0.01, its target the starting sum: 1.002 for the bundled high-entropy
  tungstate, or 1 with the powder page's "Σ occ = 1"). Now the site's last
  member follows the total minus the others: `= -1*occ_A+1` for two species
  (the complement tie the single-crystal page makes), `= 1 - sum(occ_A,
  occ_B, …)` for more, a new form of tie. The others refine; the last is
  held, and its esd comes from their full covariance. **The total is 1 unless
  set below 1 for vacancies** (the Occupancy group on either page; saved with
  the project; the Agent's `set_site_ties` `totals` on the powder page). A
  last occupancy driven outside [0, 1] is warned of in the parameter panel,
  `refine`, `get_state`, the report's checks and its warnings, never clamped.
  The panel, the CIF, the report ("Shared sites") and the Agent's `get_state`,
  `refine` and `structure_table` give the constraint and the tied esd. The
  powder page's "Σ occ = 1" switch and `set_site_ties`' `occupancyToUnity` are
  gone. Projects saved before open with the tie: values kept, the last
  occupancy, even if saved free, following the others. Without a shared site
  nothing changes. MCP's powder tools keep the soft restraint.

- **The Agent's executor and chat code split by what each part does**
  (internal; no behaviour change): the executor's dispatch, policy and
  record, and the chat's loop, transports, context budget and guards, each in
  its own file.

- **Five more readings in one place for the app and MCP.** MCP's
  `check_fit_range` returns the app's reading in words (`reading`) and warns
  when the axis cannot be what the file says (`axisWarning`).
  `reflection_statistics` quotes SHELXL's R_int (the Friedel mates apart in a
  non-centrosymmetric group), as `get_state` and the report do, with the Laue
  class's as `rIntLaue` (in place of `rIntFriedelApart`). `diagnose_fit` and
  the report give the same Durbin–Watson sentence. MCP's posterior reading no
  longer names `diagnose_fit`, which MCP does not have.

- **The repository is `materia-platform`.** The published app moves to
  [drthyang.github.io/materia-platform](https://drthyang.github.io/materia-platform/)
  (the build's base path, the README and user guide, the app's links to the
  repository, the package name). GitHub redirects the old repository and git
  URLs; the old Pages address does not redirect. Projects saved in the
  browser stay: they belong to the site's origin, not its path.

- **The boxcar plot gets the card.** After a run the plan folds into a
  one-line summary in the toolbar, the caption moves to the chip row, and the
  per-box table opens on demand, so on a 1280×800 window the figure is about
  twice as tall (150 → 313 px) and the track itself about four times (≈50 →
  194 px). The two panels share one r axis with gridlines through both, the Rw
  strip scales with the figure and has a scale, and Rw bars widen with the box
  spacing. Point at a box for its window, value ± esd and Rw; click it (or step
  with ← →) to pick it, shading its r-window, and adopt it from the line under
  the plot.

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

- **The demo, re-recorded** (docs/media/agent-demo.mp4, 96 s): the Agent now
  reads the data's ends first and leaves out the background below the first
  reflection and the last 2° of the D1A scan, and refines the instrument's terms
  and the B values in turn until the alternation settles (wR 3.87 %, GoF 2.06).
  The turns were written by Claude Opus 5.5 in a live run through the app and
  are replayed for the recording, and the Agent's chip and the report say so
  ("Claude Opus 5.5 · replay of a live run"), not the relay's "LM Studio ·
  claude-replay". The video and its poster carry "© 2026 Tsung-Han Yang" in
  the corner, and the speed badge no longer covers the Send button.

- **The fit range in the record and the report** says what the window leaves
  out and why, end by end, once a second read finds the window already set.

- **A single-crystal report in U.** The atom table gives U_eq (and U_iso for
  an isotropic site) in Å² with its esd, and the parameter table a shared or
  isotropic hydrogen U as U_iso, SHELXL's and the CIF's convention, where it
  gave B_eq and B; a powder's or a PDF's report keeps B. A riding group's
  torsion carries its unit (°), and the Structure file row names the file.

- **The suggested weights follow SHELXL's criterion.** The suggestion held
  the overall GooF at exactly 1 and chose a by the bins, so its b came out
  high in every round (2b: 0.0454 0.7069 for SHELXL's 0.0436 0.2952). It now
  brings each of ten Fc² bins' GooF, over its own reflections, nearest 1,
  and leaves the overall GooF where that puts it, a little above 1 — as
  SHELXL's converged suggestions leave it: from SHELXL's own listings 3a's
  WGHT 0.0374 0.6277 suggests itself again at GooF 1.058, and 1b's
  0.0271 0.2580 gives 1.044, SHELXL's figure. On those listings it gives
  0.0370 0.668 for 3a's 0.0374 0.6277 and 0.0259 0.313 for 1b's
  0.0277 0.2519 (SHELXL searches a coarser grid in the same shallow valley);
  on 2b's refined model 0.0437 0.452. It is labelled the weights SHELXL's
  criterion suggests, not SHELXL's own, and its bins are given as the
  analysis of variance gives them.

### Fixed

- **A staged fit keeps a profile stage whose zero trades with the cell.** The
  staged sequence rejected a whole stage when freeing it grew an earlier
  parameter's esd more than fivefold. Since the engine's esds are those of the
  full inverse (the eigen-decomposition entry below), freeing the TOF zero
  with the peak shape grows the cell lengths' esds several-fold, as a pair the
  data cannot separate does, and the guard threw the peak shape (α, β, σ) away
  with it: every later stage fitted with the shape at its calibration, and the
  local AWO₄ magnetic demo's solve ended far from its own earlier fit. The
  newcomer the inflated esd correlates with most strongly (|ρ| ≥ 0.8, here the
  zero) is now re-fixed and the stage re-run without it, as the singular and
  correlation rules already did; an inflation no newcomer accounts for still
  rejects the stage. The staged sequence runs in `refinePowderStructure`, the
  MCP PDF and mPDF fits with `staged`, and the demo's solve; the page's Refine
  and the Agent's `refine` do not use it. The demo's solve now ranks the
  groups as the magnetic page does and keeps the maximal group unless
  Hamilton's test says the data need more moment parameters (lowest wR alone
  had chosen a subgroup with four more).

- **A fit-range handle drag the browser takes over no longer swallows the
  next tap.** The handle listened for the pointer lifting but not for a
  cancel, so when a touch drag turned into a page scroll the plot ignored the
  next tap and kept a stale drag listener. It now ends on a cancel or a lost
  capture too, and its hit area is 32 px wide on a touch screen.

- **The Background group stays on the parameter panel at 0 terms.** Emptying
  the background's terms field to retype the count read as 0, and 0 terms
  removed every background row, and with them the Background group and its
  function and terms controls, with nothing on the page to bring them back (a
  project saved then would not open: it needs one term). The page now keeps at
  least one coefficient, the field waits on an entry that is no count (empty,
  0, a fraction, above 24) and puts the count back on blur, and
  `set_background` takes 1 to 24 terms. A coefficient at 0 keeps its row as
  before.

- **A PDF fit over a long r range no longer crashes the browser tab.** The
  pair list was an object per pair (about 100 bytes), built by the UI thread
  and by every evaluator, and a 1.5–100 Å fit on a multi-element site filled
  the heap the tab's isolates share. A pair is now a lattice translation and
  a small atom-pair code (about a byte), its values recomputed bit-identically;
  for a single-phase PDF the evaluator pool splits each evaluation by r block,
  each worker holding only its block's pairs and the UI thread none; and a
  list beyond 64 MiB is generated chunk by chunk. Results are bit-identical,
  fits are 1.2–1.6× faster, and the UI thread no longer evaluates during a
  single-phase PDF fit (the longest freeze of a 17-parameter fit to 30 Å:
  about a ninth).

- **A propagation vector's label reads back as itself.** A centred lattice's k
  above 1 was labelled to three decimals ((0 0 1.333) for 4/3, which sets
  another k when copied); it is now the exact fraction, (0 0 4/3).
  `set_propagation_vector` now also reads every glyph a k label prints
  (⅔, ¾, ⅙, ⅚ and the minus sign of (¼ 0 −¼)), which it refused.

- **The local proxy says when the page has none.** On the published site
  (GitHub Pages) there is no proxy, and choosing it ended every message in a
  raw "API error 405" with nginx's HTML. The settings now ask the proxy's
  health check and say whether it runs, runs without a key, or is absent;
  and a 404, 405 or 501 in proxy mode reads as "This page has no proxy",
  with how to run it locally or to use an API key instead.

- **A powder page with a second phase uses its own background basis.** Its
  curve, wR, Refine, Prefit and posterior used the Chebyshev basis and the
  Lorentz factor whatever the page had set: the cosine, power-series and
  interpolated bases, and the Lorentz factor off, applied with one phase
  only. The magnetic step's moments fit, which did use them, then disagreed
  with the page's wR (6.793 against 6.781 on the magnetic Mn₃Ga demo with
  CaF₂ added and a cosine background).

- **The MCP magnetic tools draw the pattern the fit solves.** With a
  magnetic model, `evaluate_pattern`, `simulate_pattern` and
  `rank_next_parameters` (the Agent's too) kept only the profile's shape
  and η: a cosine (or other) background was drawn on Chebyshev, and the
  Lorentz factor was on whatever the profile said. The components
  `refine_magnetic_powder` returns dropped η, and drew an extra phase with
  the Lorentz factor on. Their curves and wR are now the fitted problem's.

- **A phase the data do not contain no longer ends the refinement.** With its
  cell free, its scale fell to 0 and a trial step drove its cell length below
  0, where the reflection list threw `RangeError: Invalid typed array length`
  and Refine stopped (the Mn₃Ga demo with CaF₂ added). Such a step is now
  rejected like an uphill one, the fit goes on, and its message says how many
  steps were rejected and why. A cell length that is not positive and finite
  is refused with a message that names it, wherever a reflection list is made.


- **A fit with a second phase or a magnetic model leaves out the excluded
  plateau**, a GSAS export's constant −3 outside its fit range, as a
  single-phase fit and the page's wR already did. It fitted those points:
  on the magnetic Mn₃Ga demo with its first 60 points at −3, the
  co-refinement reported wR 28.44 % where the page showed 9.12 %, and took
  the moment to 2.30 µB for a true 2.5. It now reports the page's 0.30 % at
  2.50 µB. This holds for Refine, Prefit, the posterior, the magnetic step's
  moments fit and ranking, and MCP's `refine_powder` with extra phases,
  `refine_magnetic_powder`, `rank_next_parameters` and `sample_posterior`.
  MCP's `evaluate_pattern` scored the plateau too: 30.10 % for that model's
  0.30 %.

- **The page on a phone in portrait.** The content column could shrink below
  its cards while the page scrolled, so the footer was drawn across them (on
  every page) and the PDF page's plot card was held to 380 px with its plot
  running over the parameter card. The column now grows to its content. On
  the Boxcar tab, stacked, the figure has a height of its own (293 px on a
  390 px phone, against its 160 px floor) and an open box table its natural
  height; a view switcher that wraps fills the card's width.
- **A local model no longer loops, its prompt cut.** On qwen3.8-27b in LM
  Studio the Agent re-read its method and the state until the turn cap: the
  instructions and every tool took 18.8k of the model's 32k tokens, LM Studio
  cut the rest from the middle without a word, and the old results were
  replaced by "call it again". Every request to a local model is now sized to
  its real window (old results become digests, a skill read again keeps its
  latest copy, a prompt that cannot fit is refused, never sent cut); Ollama
  is driven through its native chat so the context can be set; a local model
  is offered the tools of the method's stage; and a call repeated at the same
  state is noted, then stopped, with where the analysis stands.
- **Stop reaches a running change**: nothing is run or asked after it, and a
  fit a change started is cancelled. A change is checked again after its
  approval card, which may wait. The user's unsaved edits stay their own
  History step when the Agent's change follows in the same tick. A failed
  load no longer wedges the Agent, and no tool call is left unanswered.

- **Three eval graders that failed good answers**: a rule about what refines
  together read as a refusal of the refinement, "0 unexplained peaks" read as
  a claim of some, and "so no R_int" read as an R_int quoted. Each live
  sentence is replayed in CI.

- **The PDF boxcar scan's outcome line** rounded Rw twice (to two decimals,
  then one).

- **The 3D structure view draws only when something changes.** It drew
  every animation frame for as long as it was mounted, the views on hidden
  pages too, and took the CPU from the refinement: an idle tab held 3.3
  cores in a headless browser. It now draws when the camera moves (and
  through the damping after a drag), on a resize, a rebuild or a knob, and
  not while hidden. The 19-turn PbSO₄ demo replay, from Send to the report,
  took 194 s before v0.4.0, 161 s at v0.4.0 and 117 s with the change: the
  page did not get slower with v0.4.0. The 334 s of the last recording was
  the machine, which had a second browser running the app.

- **A listing's R_int.** SHELXL's LIST 4 holds each reflection once, its
  Friedel mate apart in an acentric group; merged in the Laue class, 3a's 432
  Bijvoet pairs read as "R_int 3.37 %" on the page, in `get_state`,
  `reflection_statistics`, the report's figures and its Merging row — their
  anomalous difference and their noise together, not equivalents' agreement. In an acentric group
  the page and the tools now give the Friedel-apart merge, as SHELXL does, and
  no R_int for data holding each reflection once.

- **The extinction against a listing.** The page entered the extinction free
  on load whatever the data; a LIST 4 listing has the extinction of the
  refinement that wrote it divided out, so refining it corrects twice. It now
  enters fixed at 0 on a listing, `refine` says so if it is freed, and the
  report's Extinction row and check say why it was not refined.

- **The outliers of a listing** read "no equivalent measured"; they now say
  the listing's value was merged by the refinement that wrote it. In an
  acentric group the one Laue-class equivalent of a reflection is its Friedel
  mate, and is named so.

- **A twin domain at 0** drew "hold it fixed and find the upstream cause"; it
  is a finding about the crystal (it holds none of that domain), and in a twin
  with both hands it says which hand the crystal is not.

- **The Flack reading's bands**: x at 0 within 2u with 0.04 ≤ u < 0.1 says the
  hand is the model's and that a few per cent of the other cannot be excluded
  for a compound of unknown enantiopurity; u ≥ 0.1 no longer claims to confirm
  a known one.

- **`set_twin`** restarted a law that stays (the merohedral law, when the
  inversion domains are dropped) at 0.1; its fraction is now kept. The History
  names a twin with both hands and a shared hydrogen U.

- **`bond_geometry`** returned an empty list for an atom with nothing within
  the cutoff (Cs1's ring and pyridine at 3.23–3.35 Å, beyond 3.2 Å); it now
  says so, with the nearest neighbour. Each bond to a symmetry image carries
  its CIF site-symmetry code ("2_554"), and the phase is named.

- **The report's bond table** left out caesium's bonds: the covalent search
  stopped at 3.0 Å, short of Cs–C (2.44 + 0.76 + 0.4 Å). It now reaches the
  two largest atoms present, and marks each image with its symmetry code. The
  Hydrogens row gives a shared U_iso's value, the Absolute structure row the
  inverse model's x beside the model's, a "Structure file" row the SHELX
  instructions the file applied, and the Data check sinθ/λ beside d_min; the
  compared refinements name the twin and the hand, and give a shared U once.

- **The inverted model sits in the cell**: −x put 3a's model in the cell
  below; it is moved back by a lattice vector, and the page inverts back by
  the same transform, so the round trip is exact.

- **Refinements compared under other weights.** The report's comparison keyed
  the refinements by their extinction, twin, hand and range, not their
  weights: 3a's 4-domain fit at w = 1/σ² (wR2 3.88 %) stood beside the final
  one under SHELXL's WGHT (4.76 %) as if the second fitted worse. The weighting
  scheme is now one of the conditions, named in each entry, and a comparison
  across schemes says wR2 and GooF compare only under the same weights. An
  extinction held at 0 reads "no extinction", not "SHELXL EXTI".

- **A GooF below 1 on a single crystal** read "Excellent: close to the
  statistical floor". Between 0.8 and 0.95 it now says the model leaves less
  misfit than the weights expect, by how much, and to refit the weighting
  scheme to the final model (3a: 0.889 under the weights fitted to the other
  hand; SHELXL's suggestion for the final model gives 0.977).

- **A listing's counts and readings.** `reflection_statistics` gave 3a's
  listing "1033 unique, redundancy 1.42" (the Laue class's, its Friedel mates
  counted as repeats); data holding each reflection once now count as SHELXL
  counts them, 1465 and 1. ⟨|E² − 1|⟩ below the acentric value says it is the
  twin the model holds, when it holds one, not "look for twinning", and R_σ
  is the listing's own (3.22 %), not the Laue merge's (2.73 %).
  `assess_refinement` no longer reads a listing's extinction as "not
  indicated": its Fo² have SHELXL's divided out, so it is not judged; it and
  `get_state` name the extinction "none: held at 0" rather than "SHELXL EXTI",
  and `get_state` counts the floating-origin restraint ("restraints: none"
  while the fit held one). Friedel mates that disagree in a monochromatic
  measurement no longer point to "another wavelength".

- **Bond valence in a molecule.** The report's open issues listed 23 of 2b's
  carbons as "more than 15 % from the valence" (C4+, assumed): a bond-valence
  sum describes cation–anion bonds, and in a molecular structure only the
  metals have them. The non-metals are left out there (Al1 3.16 for Al³⁺).

- **The hand read from x near 1** said "the inverted hand: invert the model"
  whatever its esd; it now reads the same bands as x near 0. On 2b, x =
  1.00(13) in P3₁ decides the hand no more than 0.00(13) in P3₂ does.

- **A file its data reduction merged.** 2b's HKLF 4 holds each reflection
  once: `merge_equivalents` said "8435 measurements merged into 8414 … R_int
  0 %", the report "8414 measurements merged". It now says the file held
  each reflection once and the merge left out only the 21 absences, with no
  R_int, and the History step names it so. The Bijvoet pairs' difference
  (2.96 % on 2b) is no longer called "their anomalous signal" without
  asking: the model's own Bijvoet differences say how much of it is (0.19 %
  of 2b's 2.96 %, 1.45 % of 3a's 3.37 %).

- **Counts as SHELXL counts them.** The forbidden reflections are counted
  with their Friedel mates apart in an acentric group (21 on 2b, not 19), and
  the acentric reflections' Friedel coverage leaves the absences out. An
  outlier measured once is read against its Friedel mate, as a listing's is.

- **The riding note** called an ammonium's N–H "tertiary C–H … X–H
  0.930–1.000 Å"; a group with parents of two elements gives each its
  distance ("C–H 1.000 Å, N–H 0.930 Å").

- **`set_free` on a large structure** listed every free id (567 on 2b); past
  40 it gives them by kind, as the History's rows do. `bond_geometry`'s
  contacts leave out atoms two bonds apart (a hydrogen and its parent's
  neighbour). The report's Extinction row says "none refined (held at 0)"
  when it was, and the compared refinements give a large structure's U_eq
  as its first six sites and the others' range.

- **Round 5's last run.** An outlier whose Fo² lies below its σ (8 −1 17
  on 2b, Fo² −0.12) read "this one 0.21", the ratio floored at σ; it now
  reads "below 0.21 (Fo² under its σ)". The compared refinements said "the
  ADPs as loaded" of refined ADPs: they name the loaded model ("anisotropic
  ADPs as loaded"). The History's step for a file merged by its data
  reduction read "Absences left out: 8414 reflections"; it reads "21
  absences left out: 8414 reflections". The scale was labelled "scale
  (OSF)" with the value of OSF² (0.0959 where the .ins's FVAR gives OSF
  0.3096): it is "scale k = OSF²". A molecule with N–H or O–H and no
  hydrogen bond now says so ("none: N1–H1D reaches no acceptor …") in
  `bond_geometry` and the report, rather than leaving the section out. The
  suggested scheme's bins are printed to three figures, as the analysis of
  variance prints them ("1.1, 1.1, 1.1, 1.1" hid 1.05–1.12), and two sites
  that happen to share a U_eq are no longer counted as one entry ("the
  other 54 entries" for 55 sites) in the compared refinements.

- **`bond_geometry` reads the bonds from the atom asked for**: Cs1's bonds
  came back as "C2–Cs1" with the image code of the far end; each is now
  "Cs1–C2", the code inverted to the reverse bond's, as the report's table
  gives it.

- **The merged σ is SHELXL's.** Where a reflection's equivalents disagree
  beyond their σ, the merged σ came from their root-mean-square scatter, up to
  18 % above SHELXL's for one reflection in ten on 1b. It is now SHELXL's
  estimate, the larger of the propagated σ and Σ|I − Ī|/(n√(n − 1)), found
  against SHELXL's own listing: every one of 1b's 2482 merged σ agrees with it
  to 0.1 % from the 10th to the 90th percentile, and R_σ is the 1.99 % its CIF
  gives (2.10 % before). 1b's GooF goes from 1.010 to 1.030 (SHELXL 1.044)
  and the Flack x from 0.437(11) to 0.435(11) (0.435(15)).

- **Data per parameter as SHELXL counts them.** In a non-centrosymmetric
  group a Friedel pair measured apart is two observations (MERG 2 keeps them
  apart); the validation, the report and the page counted it once. 1b has
  17.5 reflections per parameter (2482 for 142), not 10.3.

- **The report's data line for merged data** gives the measurements and the
  reflections they became, R_int and R_σ with the Friedel mates apart as
  SHELXL reports them (1b: 2.93 % and 1.99 %, its CIF's figures, beside the
  Laue class's 3.04 %), and the systematic absences' measurements, which
  SHELXL leaves out of its count (1b: 13169 measured, 60 of them of the 21
  absences, so 13109 as its CIF says). It read the merged reflections as the
  measurement, and "N omitted by hand" where the merge had reduced them.

- **A twin's fraction refined with the scale is not "out of the method's
  order".** The Flack x, an overall term of the intensities, refines from the
  start as SHELXL refines BASF with the OSF; its stage now follows the
  scale's, and an optional stage (a twin the crystal may not have) is never
  marked passed by a later one.

- **A hydride refined as asked, under restraints, drew "refined on its own
  against X-ray data".** The note now names hydrogens freed unasked, and
  those chosen to refine with no restraint holding them.

- **The outliers of a merged fit read "no equivalent measured".** Each is now
  read against the measurements behind it, and one that failed inside the
  merge is named; each resolution shell's R_int reads the measurement, not
  the merged rows (which read 0). On unmerged data the ratios are given to
  three digits (1.04 against 0.988 read "1" against "0.99"), and a misfit no
  larger than chance gives among that many reflections (√(2 ln N) σ) is read
  as chance, not as equivalents that disagree.

- **One disorder's correlations are a note, not a warning to fix one of
  them**, in `assess_refinement` and the report: two alternatives 0.2 Å apart
  correlate at −0.99 by construction, SHELXL refines them together, and their
  esds carry it. Correlations are given to three decimals (−0.998, not −1.00).

- **The report's rows for 1b**: λ to five digits (0.71073 Å, not 0.7107), the
  hydrogens as riding and refined ("20 riding on their parents, 5 (H1′, …)
  with their positions refined and U_iso riding"), the disorder with its
  shared ADP (EADP), and the riding preview counting only the rows that leave
  (85, where a refined hydride keeps its position rows; it said 100).

- **Esds are printed as SHELXL prints them** in the CIF: two digits only from
  10 to 19 (0.0560(2), not 0.05602(16)). The CIF's U^ij now carry their su,
  as SHELXL's do, and a tied value its leader's (1b's Ga1 occupancy
  0.156(2), as SHELXL's −21 gives it).

- **The completeness and the data per parameter count the data's own last
  reflection.** d is rounded to 10⁻⁶ Å, and the limit the expected
  reflections were generated to had a margin of 10⁻⁹: the highest-angle
  reflection dropped out half the time (1b: 1461 unique and 2481 independent,
  where SHELXL has 1462 and 2482).

- **Under a weighting scheme, the outliers are ranked and given in its esd**,
  as SHELXL lists its most disagreeable reflections, the file's σ beside it:
  1b's 2 0 1 is 6.4 esd by the weights, where it read 11.4σ.

- **A single crystal's report reads as one**: its parameters grouped as a
  single crystal's (scale, twin fractions, extinction, atoms, riding groups),
  not under "scale & background" and "peak shape"; a position row says it is
  a shift from the loaded coordinate; a tied value carries its leader's esd in
  the site table as in the parameter table; for an acentric group the
  headline tiles give SHELXL's unique count and R_int (1b: 2482 and 2.93 %),
  the Laue class's in their hints, and so does the page's data card.

- **The tools' notes say what they did**: `merge_equivalents` gives the R_int
  of the merge it made (with the Friedel mates apart, 2.93 % on 1b, where it
  quoted the Laue class's 3.04 %) and the absences' measurements;
  `tie_parameters` names the EADP it made; `set_riding_hydrogens` and the
  History count the hydrogens that ride apart from those that refine their
  positions ("20 hydrogens ride, 5 refine their positions with U riding",
  not "25 hydrogens ride"); `bond_geometry`'s shortest bond is rounded
  (0.98, not 0.9799999999999989).

- **Esds and correlations of correlated parameters, and the convergence of
  correlated fits.** The eigen-decomposition behind the engine's step and its
  covariance stopped after 80 single Jacobi rotations, far short of
  convergence for more than a dozen parameters: each parameter's esd came out
  near its conditional value (as if every other were fixed), the strongest
  correlations went unreported, and each step was little better than steepest
  descent. On 1b the split Al/Ga site's positions and shared U came out 3–5×
  too precise (Al1 x 0.0003 for SHELXL's 0.0012) with no correlation reported
  where they correlate at −0.99, and a refinement from SHELXL's own model took
  42 cycles and 28 s. It is now a complete Householder and QL decomposition,
  once per cycle for every damping tried: 5 cycles and 4 s, the esds the
  inverse gives (Al1 x 0.0010), and a Monte-Carlo of 40 refinements scattering
  as they say. Dipyridyl disulfide's 253 parameters converge in 3 cycles
  (7 s) to SHELXL's R1, wR2 and GooF, and N1A x and S2A–C7A take SHELXL's
  esds, (8) and (13), where they read (7) and (12). Powder and PDF fits share
  the engine, and their esds grow where parameters correlate: on PbSO₄ (D1A,
  27 free parameters) the scale's by 22 % and the B values' and positions' by
  up to 8 %, the values moving by under 0.1 esd and wR not at all; with a
  handful of parameters free nothing changes.

- **Riding hydrogens' derivatives are exact.** An sp² hydrogen turns with
  the bisector when its carbon or the carbon's neighbours move, and the
  Jacobian now carries that (SHELXL's riding derivatives keep only the
  parent's translation). With the approximation, dipyridyl disulfide's
  254-parameter refinement from SHELXL's own model stalled at 0.16 esd per
  cycle; it now converges.

- **`set_riding_hydrogens` reported "no hydrogen rides" after riding them**:
  it read the page through the port it was given, which in the app shows the
  page as it was before the change. The test host now hands out each render's
  snapshot, as the app does, so a tool that reads its own change is caught.

- **Negative off-diagonal U terms are not "unphysical".** `assess_refinement`
  and the report flagged U12, U13 and U23 below 0 as unphysical displacement
  parameters and listed them as open issues; only a diagonal term and the
  tensor's positive definiteness are judged.

- **The report's B_eq uses the full U_eq**, not a third of the trace, which
  is wrong in a non-orthogonal cell.

- **A method stage the model cannot refine is passed**: a structure loaded
  anisotropic, its hydrogens riding, has no B to refine, and the isotropic-ADP
  stage drew an "out of the method's order" note and stayed open in the
  checklist and the report.

- **A re-weighted refinement counts every cycle** in its message ("converged
  after 27 iteration(s), the weights re-evaluated … 3 times"), where it gave
  the last pass's ("after 1 iteration") beside 27 in its history.

- **The report's number audit accepts the user's numbers**: a value the user
  gave (a published refinement's R1) quoted in the account is theirs, not the
  Agent's own.

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

## [0.4.0] - 2026-10-11

### Added

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
- **The Agent panel is resizable.** Drag its left edge (or focus it and use
  ← / →); the browser remembers the width, and a double click restores the
  default. The page beside it always keeps 480px. On a tablet held upright the
  panel docks under the page as a sheet instead of covering it, so the plot and
  the cards the Agent works on stay in view.

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
- **The page lays out for the room it has beside the Agent.** Its breakpoints
  read the window, so with the Agent open a 1024px window kept the wide layout
  in 684px (a 208px parameter column). They now read the page's own width
  (container queries): the page stacks, splits or keeps three columns for the
  width it actually gets, and the parameter column keeps at least 340px.
- **The header holds its rows.** Its bands were tuned before the Agent button
  and the step label joined it, and it wrapped at every width from 720px to
  1460px (menus or the GPU chip alone on a second row). One row from 1120px,
  two designed rows below, and nothing overflows down to 340px.

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

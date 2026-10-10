# Changelog

Notable changes to MATERIA, newest first. Releases are tagged `vX.Y.Z` on `main`.
While the major version is 0, a minor release adds a feature or changes how the
tool is used (file formats, saved projects, CLI flags, API, URLs), and a patch
release fixes bugs.

## [Unreleased]

### Added

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

- **The Agent's opening text says what it is and what it does.** It names
  the model in use (Claude, or the local model on Ollama or LM Studio), says
  it can run the whole analysis by the page's method and discuss it, and
  describes the approval mode that is on (Ask first or Auto), with examples
  for the page open.

### Fixed

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

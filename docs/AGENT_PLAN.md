# Agent plan: architecture, tools and skills before the validation

The validation ([VALIDATION.md](./VALIDATION.md#does-the-agent-help)) measures
the Agent as it ships. Before arms B and C run on the test set, this plan fixes
what would make the numbers measure the harness instead of the Agent, puts each
piece of science in one place, and brings the skills into line with the tools.
Then the code is frozen, arm A is run again, and the validation runs as written.

It builds on [AGENT_REVIEW.md](./AGENT_REVIEW.md) (2026-10-14) and a survey of
`src/agent`, `src/mcp`, `src/testSupport` and the skills on `main` at
`f327874` (2026-10-17).

## Ground rules

- **The test set stays held out.** Every change here is designed and checked on
  the dev set, the eval scenarios and CI. Arms B and C do not run on a test
  case until the freeze (phase 6). Arm A is deterministic and is re-run at the
  freeze, since several fixes change the Validation tab it reads.
- **Approval.** A new tool, a skill change, and a tool description that
  restates a skill all need the user's approval. Items still waiting for it are
  marked **(approval)**; items the user has approved are marked **(approved)**.
- **No API spend.** Local models and scripted CI only, until the user says
  otherwise.
- **Each PR** passes CI (build, lint, tests), updates its docs, and leaves the
  app working. A refactor PR keeps the model-visible text unchanged. A test
  snapshots the prompt, the tool list and the descriptions, so any change to
  them shows in the diff.

## What is wrong now

### A. The validation would partly measure the harness

- **The eval and validation pages are not the app's pages.** They run on
  hand-written ports (`testSupport/agentHeadless.ts`). Those ports differ from
  the workbenches in ways no test catches:
  - the powder posterior ignores the fit window, the extra phases and the
    magnetic model;
  - restraints cover the primary phase only;
  - the observation count and the live wR ignore the fit window, and wR is
    weighted 1/max(y, 1);
  - the background, microstrain and ADP setters only log the call;
  - Prefit (`refine` mode `thorough`) handles 2θ only, with no moment search;
  - PDF refines stop at 4 iterations (the app allows 30), and PDF has no Prefit
    or posterior;
  - single crystal has no Prefit.

  The review fixed two divergences of this kind (the fit window, Prefit). This
  is the same kind of problem, so it needs a structural fix.
- **The harness runner has no `fill`.** The check that sends a grade
  contradicting the engine's `{{verdict}}` back to the model
  (`AgentChat.finalAnswerCheck`) therefore never runs in evals or validation,
  though it runs in the app.
- **Arm C still gets most of the method.**
  - `get_state` returns the method's skill name and stage checklist.
  - Refusals name the skill.
  - The local models' tool scoping follows the method's stages.
  - Several tool descriptions state the method's order.
  - The ablation itself removes text from the prompt by regex
    (`systemPrompt.ts`, `withoutSkills`). If that wording changes, the regex
    stops matching and nobody is told.
- **Models run under different rules,** so a model comparison is partly a
  comparison of these rules:
  - the turn cap is 40 for Claude and 80 for local servers;
  - the stop when reads change nothing applies only to local models;
  - Claude's server clears old tool results, while local runs keep digests;
  - the chat loop sets no temperature, so each server's default applies;
  - OpenAI-compatible servers drop earlier reasoning, while Ollama keeps it.
- **State outlives what it describes.**
  - `stagesDone` only grows: undo, `go_to_step` and `reset_parameters` leave it
    as it was, so the tool scope and the `review_symmetry` gate can be wrong
    after an undo.
  - A new conversation keeps the previous posterior, alternations and refs.
  - `keep_reflections` lives in a module-level map: it cannot be undone and is
    not saved with the project.
- **The holdout scan is narrower than the doc says.** It reads
  `.claude/skills`, `knowledge` and `src/agent`. It does not read the MCP tool
  descriptions (`src/mcp/registry.ts`), the diagnostic text in `src/core`, or
  `src/testSupport` and `src/app`. It also misses synonyms such as "zinc oxide"
  and "nickel aluminide".

### B. The science is written four times

The same analyses live in the MCP handlers (`mcp/tools.ts`), the agent
handlers (`agent/*Tools.ts`), the page components (`PowderWorkbench.tsx`,
`KSearchPanel.tsx`, `PdfWorkbench.tsx`) and the test doubles. Tools with the
same name compute different things:

- **`find_unexplained_peaks`:**
  - MCP calls `detectExtraPeaks` with no σ and no classification, and its
    schema cannot switch the 8 % floor off.
  - The app uses `residualPeaks`, which applies 5σ and classifies each peak.
  - The magnetic step uses a third option set.
- **σ:** missing point σ are made up as √max(y, 1) in seven places. The
  magnetic step deliberately refuses to make them up.
- **The residual** is built twice, and only the app's version adds the
  magnetic satellites. On MCP, the k = 0 hint never fires.
- **k-search options** differ between MCP, the panel and the headless page:
  - MCP keeps `maxQ` = 6, which drops d < 1.05 Å;
  - the headless page passes no centring.
- **Moment fits:**
  - Three restart schemes exist.
  - Every magnetic fit drops the profile's Lorentzian part and the background
    type.
- **Thresholds differ:**
  - The correlation limit is 0.95 in the assessment and the guard, but the UI
    warns only above 0.98.
  - The single-crystal GooF bands differ.
  - Two different functions are both named `verdictFrom`.
- **The PDF GoF** is removed only in the app, so on MCP a PDF fit gets
  powder's GoF bands.

AGENT_TOOLS.md says the analysis tools are the MCP handlers. That is untrue for
six of them.

### C. One tool is spread across a dozen files

- **Per-tool facts sit in side lists.** Adding or changing a tool means editing
  `tools.ts`, up to four switches per page file, `port.ts`, the workbench port,
  the headless port, and the lists below. The lists drift apart.

  | List | File |
  | --- | --- |
  | `STEP_KIND` | `executor.ts` |
  | `TOOL_CARDS` | `focus.ts` |
  | the scoping lists and regexes | `toolScope.ts` |
  | `REFITS` | `evidence.ts` |
  | `STILL_NEUTRAL`, `SAMPLERS` | `chat.ts` |
  | `KEEP_TOOLS` | `contextWindow.ts` |
  | `READS`, `CHANGES` | `magneticTools.ts` |
  | `NEEDS_STRUCTURE` | `powderTools.ts` |

- **Results are text,** and the loop reads them back with regexes:
  - a refused refinement (`chat.ts`);
  - "declined" and "unchanged" (`contextWindow.ts`);
  - `"refined":true` (`evals/harness.ts`).
- **Effect labels are wrong:**
  - `write_note` and `write_report` are labelled read but write, and
    `write_note` skips the method gate;
  - the k-search and the group ranking are labelled read but change the
    magnetic panel;
  - `test_extinction` and `boxcar_scan` are labelled change but leave the page
    as it was.
- **No test pins the output shape of the live tools.**
- **The page branching is scattered** over `executor.ts` and `method.ts`: six
  `port.technique` ternaries and duck-typed state checks.
- **The two biggest files mix concerns:**
  - `chat.ts` holds the provider transports, request sizing, the loop guards,
    the stall regexes and the loop.
  - `executor.ts` holds dispatch, approval, the firm rules, the correlation
    probe, the record and the report.

### D. Tool gaps

These are listed in AGENT_REVIEW ("Larger items, not fixed"), plus:

- **Lost centring:** no tool proposes a primitive or ordered model when a
  centring is lost. `review_symmetry` lists translationengleiche subgroups
  only. A lost centring is a klassengleiche subgroup.
- **The Le Bail cell:** no tool carries the cell check's Le Bail cell, zero
  and profile forward. Only Prefit refits one internally.
- **Ordering of candidates:** `review_symmetry` sorts by allowed reflections
  first, while its description and the skill say "smallest index first".
- **`Math.min(...)` over whole patterns:** this overflows the stack on large
  TOF files. `scTools.ts` already notes the problem.

### E. Skills disagree with the tools

AGENT_REVIEW's contradictions are confirmed, apart from one. The PDF page does
have `set_fit_range`; it lacks a check tool, and the skill does not name the
setter. About ten more contradictions turned up:

- **my-rietveld-workflow:**
  - Stage 1.2 refines against a Le Bail profile that nothing carries forward.
  - It never names `refine` mode `thorough`, `set_free` or
    `find_unexplained_peaks`.
  - It names MCP-only tools (`build_refinement`, `refine_powder`,
    `export_bundle`, `extraPhases`) without saying they are MCP-only.
- **magnetic-analysis:** the ★ group's "within the noise" is a 10⁻⁴ wR tie in
  code, so in practice it is the lowest wR.
- **sc-workflow:**
  - Its Stage 6 (weights) is missing from `SC_STAGES`.
  - "K below 1" against the code's 0.95.
  - 8 reflections per parameter (acentric) against the code's 10.
- **bayesian-check:**
  - |ρ| ≥ 0.9 against the 0.8 the posterior tool uses to name correlations.
  - It offers `tie_parameters` on the PDF page, where that tool does not exist.
- **pdf-workflow:** "never refine Qdamp with the ADPs or correlated motion",
  but the instrument–thermal rule's thermal group is B and U only.
- **Some fixes need tool edits too.** Several of the review's proposed skill
  fixes also need a tool description changed, or the tool will contradict the
  corrected skill:
  - the "weak correlations" text in `sample_posterior` and `posteriorTool.ts`;
  - "Durbin–Watson well below 2";
  - "smallest index first";
  - the definition of "severe" extinction in `scTools.ts`.

Beyond single contradictions:

- **No test checks the skills.** Nothing checks that a skill names real tools
  on its pages, or that its numbers match the code.
- **The Rietveld method is 29 KB.** That is a large share of a 32k-token
  window.
- **The outline drops the gates.** The outline a long session shrinks to keeps
  headings only, which drops every gate number (15 %, 0.3 esd, 0.95).
- **The data-sanity checks have no stage.** The d-scale reading (wavelength),
  the axis warning (units) and violated absences have no guidance. Stage 0 says
  absences are "most often a missing phase", which points away from a lost
  centring.

## Phases

### Phase 1 — Make the validation measure the Agent

| PR | Change | Size |
| --- | --- | --- |
| 1.1 | **Done.** The harness runner passes `fill`, so the verdict check runs in evals and validation as in the app. A scripted replay with a contradicting grade gets the nudge. | S |
| 1.2 | **Done.** **Page operations in one place.** `app/powderPage.ts` holds the powder page's curves and live agreement, what each control does to the session, and Refine, Prefit, the posterior and the correlation probe as requests to the compute client. The workbench and the headless page both call it, the headless one with the app's client running in-thread, and the headless page goes back to a History step as the app does. Tests pin that every request carries the window, every phase, every phase's restraints and the whole profile, and that the controls apply. `app/singleCrystalPage.ts` does the same for single crystal: the page is a value (what was loaded and the settings a project saves), each control a function that returns the next page, what the page derives read from `pageView`, and Refine, Prefit / Escape minimum, the probe and the moment fit requests to the compute client; save and reopen go through it too ([report](./reports/2026-10-18-single-crystal-page.md)). `app/pdfPage.ts` does the same for the PDF page: each change returns the page with its rows already rebuilt (a switch of the position parameterization re-seeds the positions from the geometry, an activation keeps its kick, a new spin model replaces the moment rows), and Refine, Prefit / Escape minimum, the boxcar scan, the posterior and the probe are requests to the compute client; the headless page runs them on the GaTa₄Se₈ demo as the app opens it, on a 1.5–6 Å window ([report](./reports/2026-10-18-pdf-page.md)). The powder page's loads are its own too (the architecture review's #7): the shell parses a file and routes it, `withStructure`, `withPattern` and `withInstrument` build the rows, and the page is one value (the session, the instrument, the last result) whose changes clear the result themselves; the evals and the validation open their pages through the same loads ([report](./reports/2026-10-19-powder-page-state.md)). | L |
| 1.3 | **Done.** **The ablation is structural** **(approved)**. The prompt is built from sections, not edited by regex. With skills off, the model sees no skill index, no `read_skill`, no method view in `get_state`, no skill names in refusals, and no stage-ordered scoping. A test runs a scripted arm-C session and finds no skill name or stage label in any prompt, description or result. | M |
| 1.4 | **Done.** **One run policy.** `RunPolicy` (`chat.ts`) states the turn cap, tool scope, pruning, stall stop, temperature and reply cap; a run may override the cap, the stall stop and a local model's temperature. Each eval run, saved run and validation record keeps the policy it ran under, and the transcript says it. Arm B stays the Agent as it ships, so the defaults stay per transport: B and C on one model share them, and VALIDATION.md lists what a comparison across models also compares. | M |
| 1.5 | **Done.** **State lifecycle.** Stages done are derived from the History: a stage stays done while it is on the path to the step on screen and its parameters hold the values the last refinement of them left, so undo, `go_to_step`, a reset and a typed value take it back. A new conversation clears the refs to earlier answers; the record, the alternation and the last posterior belong to the analysis and stay. `keep_reflections` writes to the analysis' record, saved with the project. | M |
| 1.6 | **Done.** **Holdout scan widened** to all of `src` except `src/agent/validation` and the test files, with synonyms. The tool descriptions and the Rietveld skill no longer name NaCl among the library's impurities **(approved)**; the library keeps it, and a test holds the taught text to that. | S |
| 1.7 | **Findings schema** takes review-derived proposals (evidence a file and line, or a dev run), the dev result before and after, who approved and when, the target skill or tool, and the status. A tool-description change counts as a skill change. | S |

### Phase 2 — One analysis layer under both surfaces

MCP handlers, live handlers, page components and headless ports become thin
adapters over the same pure functions. Where two copies disagree, the PR names
the behaviour it keeps and why, and a test pins it.

| PR | Change | Size |
| --- | --- | --- |
| 2.1 | **Done.** One powder residual (`core/diagnostics/powderResidual.ts`) for both surfaces: the excluded plateau out, an applied magnetic model's satellites in, the magnetic-neutron flag, and each point's σ with where it came from. Where the file gives no σ, √y stands in, as it should for raw counts, and the residual says so (`sigmaFrom: "counting"`), so a significance test can say it assumed raw counts rather than switch itself off. | M |
| 2.2 | **Done for both tool surfaces.** `find_unexplained_peaks` on MCP and in the app call `core/diagnostics/unexplainedPeaks.ts`: classified peaks (unexplained, misfits), a structured `k0Magnetic` flag, and one reading. The MCP output changed shape (`peaks` → `unexplained`, `misfits`); Example 3 now takes the misfits' d when `k0Magnetic` is set. The magnetic step's own peak search moves with the step (2.4). | M |
| 2.3 | The readings move to `core/diagnostics`: fit range, cell scale and shifts, axis plausibility, shoulders, the fit diagnosis view, the peak-identification lead, the PDF assessment mode, the single-crystal statistics view, the posterior reading and the correlation guard. | M |
| 2.4 | **Done** (the architecture review's #2, as the user answered Q1–Q6, in two PRs). The step is one module, `app/magneticStep.ts`, which the panel and the Agent's headless page both run. Its operations: the peak table, the k-search (one option set, the lattice's centring), the groups, the moment model, the rows a fit frees (the phase gauge held), the ranking (one restart loop; the mPDF's fit keeps its own starts in each, which its ranking needs), the best group, and the rows Continue hands over. Its state is one store (`MagneticStep`): the panel renders it (`useSyncExternalStore`) and calls its changes, the headless page holds one, and the Agent has one handle for the step's life. A ranking and a fit readout are for the model and data they ran on, by content, so Show no longer drops the ranking. The powder page's view of the step is `app/powderPage.ts`: the residual peaks and the moments fit, with the page's full profile, every phase and the window. | L |
| 2.5 | **Done.** `core/diagnostics/thresholds.ts` holds the judgment code's numbers with their sources (the correlation limit, Toby's GoF bands, the single-crystal GooF line, shift/esd, data per parameter, the fit-window cut, the absence overlap, the posterior's lines, extinction, R_int and completeness, Flack's u, the magnetic tie), and the assessment, the Validation tab, the guard, the report, the posterior reading, the single-crystal tools and the magnetic ranking import them. One conflict on the powder path is resolved: the Validation tab now warns about a correlation at the guard's 0.95, not above 0.98. The single-crystal GooF stays 1.3 in the tab against the assessment's 1.5, now named, for the user to settle. The two `verdictFrom` do different jobs (a fit's band, the tab's summary) and stay. | M |
| 2.6 | MCP schemas declare what the live layer passes (`restraints`, `fitRange`), and MCP input is parsed strictly. AGENT_TOOLS.md says which tools are MCP handlers. In part (the architecture review's #6): the boxcar scan and the moment search are one driver each for the app and MCP (`workers/strategy.ts`); `refine_pdf_boxcar` takes the extra phases `refine_pdf` takes, and `refine_magnetic_powder` fits the profile it is given (Lorentz, the background basis) and takes `fitRange` and `extraPhases` ([boxcar](./reports/2026-10-19-boxcar-driver.md), [moments](./reports/2026-10-19-moment-driver.md)). | S |

New MCP tools (`diagnose_fit`, `identify_peaks`, `reflection_statistics`,
single-crystal refinement) wait until after the validation, which runs in the
app only **(approval)**.

### Phase 3 — One tool spec, structured results

| PR | Change | Size |
| --- | --- | --- |
| 3.1 | **Done** (the architecture review's #4: the facts on the definition, then one plan per tool per page in place of the three switches). `LiveToolSpec` carries every per-tool fact: the History step, the cards, where a local model is offered it (core, the powder stages, the finish, the magnetic step, the user's words), kept in context, needs a structure, a sampler, neutral to the stall count, the magnetic step's, the evidence it gives a final answer, and a corrected effect (`record` for notes and reports, `compute` for the k-search and the group ranking, which fill a panel); `cards` is required, so a tool without it does not compile. `STEP_KIND`, `TOOL_CARDS`, the scoping lists, `SAMPLERS`, `STILL_NEUTRAL`, `KEEP_TOOLS`, `READS`/`CHANGES`, `NEEDS_STRUCTURE` and the evidence gate's lists are derived from it, and a test fails if a module keeps its own list of tool names (the graders excepted). Behaviour is unchanged: every derived list equals the one it replaced, and the text the model reads is the snapshot's. Every page's changes are now plans (`src/agent/pages/plans.ts`: one per change tool, its input typed by the tool's schema, the shared freeing, refining, resetting and History plans written once), the powder page's magnetic step included; a change that cannot run is refused before its card. | M |
| 3.2 | **Done** (the context pruning still reads the executor's own `declined`/`unchanged` JSON keys, which is right for a conversation restored from storage, where no status is kept). The evidence gate reads a call log: each call of the message with its `status` and whether the fit on screen changed (`fitChanged`, which the executor sets on every change it makes); its name list `REFITS` is gone. `ToolOutcome` gains `status` (ok, refused, declined, unchanged, error), `data` and `refusal {rule, lift}`. The model's text is rendered from it unchanged. The chat loop, the context pruning and the harness read `status` instead of matching text. A shape contract per live tool, as `registry.test.ts` has for MCP. | M |
| 3.3 | **Done.** One adapter per page in `src/agent/pages/` (typed on that page's port and state) holds what differs by page: the agreement it shows (wR, Rw, wR2, which the report reads too), the analysis it keys the record by, the stamp a change is approved against, its references, its report checks and the disorder groups the correlation check lists; and it routes the page's tools to `powderTools`, `pdfTools`, `scTools` (and, on powder, `magneticTools`). `executor.ts` reaches it through one lookup and has no `port.technique` ternary, duck-typed state check or cast left; `method.ts` keys an analysis with one typed function per page. The stamp now covers every setting the Agent can change on each page, which a table test holds: the old one missed fifteen (eight single-crystal settings, the powder X-ray constants, six of the magnetic step's), so a change approved after one of them moved still ran. The stages and the rule wording stay in `method.ts` as tables by page; the tools' page lists stay in `tools.ts`. | M |
| 3.4 | `executor.ts` splits into dispatch, policy (firm rules, method gate, correlation guard) and record (notes, report, refs). `chat.ts` splits into transports, context budget, guards and the loop. No behaviour change; the existing tests are the net. | L |
| 3.5 | **Done.** The least and greatest of a pattern by a loop (`core/math/extent.ts`, `minMax`): a spread over 10⁵ points overflowed the stack, and `powderCurves` could not draw a 500 000-point scan. Dead code removed (`AgentHost.technique`, `MAGNETIC_SKILL`, an unused export and helper); the identical helpers shared (percent, six figures, the "and N more" list, the token count, the JSON-object test, the extents); the comments brought up to date after #73–#78. The copies that do not behave alike (the MCP free globs, the per-point σ, the client's own multi-start runners) are listed in the report as their own changes ([report](./reports/2026-10-19-cleanup.md)). | S |

Deferred: splitting `AgentDrawer.tsx` (UI only), and the agent core shared
with the other apps. Phase 3's spec and outcome types are the candidate
interface for that.

### Phase 4 — Tool science

Each item ends with a known-answer test. Items that change the Validation tab
are noted, since arm A reads it.

| PR | Change | Size |
| --- | --- | --- |
| 4.1 | **Done.** Residual peaks: no 8 % floor where the file gives σ (counting σ keeps it). Measured first: no false peak on a correct model's counting noise either way, none on the dev misfit page, one more true line on the fluorite dev case. Changes the Validation tab's unindexed peaks. | M |
| 4.2 | **Done.** Data per parameter on powder counts the reflections in the fitted range against the free structural parameters (positions, occupancies, ADPs, moments, preferred orientation, extinction), in `assess_refinement` on both surfaces. | S |
| 4.3 | k-search: mixed-sign k for monoclinic and triclinic cells, the hkl range from the cell, and one `maxQ` policy. | M |
| 4.4 | Magnetic ranking: the moment fit returns χ² and N; a Hamilton R-ratio test (or Δχ² per parameter) makes a group with more moments earn them; the scale is free at k = 0. The ★ and the skill's "within the noise" then mean the same thing. | M |
| 4.5 | `boxcar_scan` returns per-box esds and each parameter's drift in esds; restarts reachable. | S |
| 4.6 | The H-test's stated direction of bias fixed now; the unbiased estimator later. | S |
| 4.7 | Texture: averaged over Laue equivalents, symmetry-distinct axes, corrected for choosing the best axis; a false-positive test over many seeds. | M |
| 4.8 | Flack and Parsons use every measurement of unmerged data. | S |
| 4.9 | Known-answer tests for `test_extinction`; a false-positive test for `identify_peaks` on random d-lists. | S |
| 4.10 | **Done.** `review_symmetry` orders its candidates by index, as its text says: those that allow every observed forbidden reflection first, then those that allow some, each smallest index first (`orderCandidates`); before, the partial ones came by how many they allow ([report](./reports/2026-10-19-symmetry-order.md)). | S |
| 4.11 | **Lost centring (approved; after the core).** Today the cell check flags forbidden reflections that carry intensity, and `review_symmetry` says a lost centring "is likelier" when no same-lattice subgroup explains them. No tool names the decentred groups or tests them. Proposed: `review_symmetry` also lists the klassengleiche subgroups that drop a centring vector (index 2; index 4 from F), each named and with the forbidden reflections it allows, as candidates to put to the user. Building the split-site model stays the user's step. Developed on `dev-cscl-wrong-centring` only. | M |

The Le Bail carry-forward needs no new tool: the skill sends a bad start to
Prefit (AGENT_REVIEW proposal 1) **(approved)**.

### Phase 5 — Skills

| PR | Change | Size |
| --- | --- | --- |
| 5.1 | **Done.** **Skill lint in CI** (`src/agent/skillLint.test.ts`). Every tool a skill names exists on its pages in the app (a tool named beside its own page is attributed, not offered), or over MCP where the skill marks it so (an MCP column or map, or "MCP" in its paragraph). Each gate number a skill quotes is held to its constant in the thresholds module. Each method stage in `method.ts` is named in its skill, and each "## Stage" heading is a stage or a named check. The allow-list holds today's failures (nine unmarked MCP-only tools, two single-crystal numbers, the weights stage), and a failure fixed must leave it. Where a skill drives two pages, the lint cannot tell which page a sentence means (bayesian-check's `tie_parameters` on PDF): the drafts fix those by hand. | M |
| 5.2 | **(approved; each draft goes to the user before it merges)** AGENT_REVIEW proposals 1–5, and the contradictions in E. The tool descriptions that restate them change in the same PR. Not a contradiction after all: bayesian-check's "|ρ| ≥ 0.9" for a pair that stays free together, since the guard refuses at 0.95 and 0.9 picks the strong ones below it. | M |
| 5.3 | **(approved; each draft goes to the user before it merges)** Order out of the tool descriptions, as the layer contract says ("no sequencing" in a tool). A description says what a tool does and when it applies; the order lives in the skill. This also cleans the ablation (1.3). | M |
| 5.4 | **(approved; each draft goes to the user before it merges)** Size for a 32k window. Each method gets a `## Gates` section (numbers, stopping rule, what to ask the user) that the outline keeps whole. MCP maps and long rationale move to references read on demand. A budget test per method. | M |
| 5.5 | **(approved; each draft goes to the user before it merges)** New guidance, written without the test set's structures or figures and tried on the dev analogs. A data and instrument stage in Stage 0 (the d-scale reading, the axis warning, violated absences read as a possible lost centring as well as an impurity, ask before an instrument constant). A false minimum goes to Prefit. The in-app stopping rule. | M |
| 5.6 | SKILL_INTERVIEWS brought up to date: single crystal has a draft skill; bayesian-check joins the list. The validation report says which skills are the user's method and which are drafts. | S |

### Phase 6 — Freeze and re-baseline

1. CI green, scripted evals green.
2. The local tier (qwen3.8-27b, gemma4:26b) on the eval scenarios and the dev
   set, arms B and C: no regression against the 2026-10-12 tier, no turn cap,
   no silent cut.
3. A dry run of the validation pipeline on the dev set: records, transcripts,
   scoring, findings.
4. Arm A run again at the freeze. Its table in VALIDATION.md and the pin in
   `validation.test.ts` are updated.
5. The freeze tagged, and its commit written into VALIDATION.md. Then the test
   set runs once, as VALIDATION.md describes. A paid model runs only with the
   user's go-ahead.

## Order

Phases 1 and 5.1 start together. Phase 2 follows 1.2, which it builds on.
Phase 3 can overlap phase 2 once 2.3 has moved the readings. Phase 4 needs
phase 2, so each fix is made once. Phase 5's content (5.2 to 5.5) waits for
phase 4, so the skills describe the final tools. Phase 6 is last.

The core goes first: 1.1–1.6, 2.1–2.2, 2.5, 3.2, 4.1, 4.2 and 5.1–5.5. These
change what the validation would find. The rest is upkeep that follows, before
or after the validation.

## Risks

- **A refactor changes behaviour silently.** The snapshot of the model-visible
  text and the scripted replays catch changes in what the model sees. The
  known-answer tests catch changes in the numbers.
- **The holdout erodes.** Improving tools for the test faults' kinds is what
  the dev analogs are for. The wider scan and the dev-only checks keep the
  test cases themselves unseen.
- **Local-model robustness regresses.** The loop guards and pruning in
  `chat.ts` and `contextWindow.ts` were tuned on the local tier. 3.4 moves
  them without changing them, and phase 6 runs the local tier again.

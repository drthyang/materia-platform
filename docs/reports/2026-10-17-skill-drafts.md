# The skill drafts: the skills brought into line with the tools

Pull request [#63](https://github.com/drthyang/web-refinement/pull/63), branch
`claude/skill-drafts`, stacked on
[#62](https://github.com/drthyang/web-refinement/pull/62), 2026-10-17. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), items 5.2–5.5. **A draft for the user's
review:** the skills are the user's methods, so nothing here merges until they
have read it.

The skills disagreed with the tools in about twenty places, the tool
descriptions carried the method's order, the Rietveld method took half of a
local model's history budget, and the outline a long session shrinks it to
dropped every gate number. Stage 0 had no guidance for the data faults the
validation plants (a wrong axis, a wrong wavelength, a lost centring), and a
start far off had no route.

## What changed, and why

### 5.2 — AGENT_REVIEW's proposals and the contradictions

| Skill | Change | What it answers |
| --- | --- | --- |
| my-rietveld-workflow | Stage 0 says nothing carries the Le Bail cell, zero or profile forward; a far-off start goes to the Prefit (`refine`, mode `thorough`) | Proposal 1: the skill told the Agent to carry them forward, which no tool does |
| my-rietveld-workflow | The in-app stopping rule (alternation settled, largest shift below 0.1 esd, the verdict good or excellent with nothing at a bound or refused); the GSAS-II and FullProf cross-check marked MCP-only, agreeing within 2 combined esds | Proposal 4: the stopping rule could not be met in the app and had no tolerance |
| my-rietveld-workflow | GoF = Rwp/Rexp = √χ²ν, with the tool's bands; "stable" defined as the largest shift below 0.1 esd | It said GoF is the reduced χ²; "stable" and "converged" had no number |
| my-rietveld-workflow | The MCP-only names marked (`parse_*`, `build_refinement`, `refine_powder`, `export_bundle`, `extraPhases`); `set_free`, `refine` and `find_unexplained_peaks` named | It drove the MCP tools only, unmarked |
| bayesian-check | The intervals are conditional on the profile and background held, which trade with the B values: say so when quoting them | Proposal 2: "their correlations with the structure are weak" contradicted the instrument–thermal guardrail and made intervals falsely narrow |
| bayesian-check | Durbin–Watson read against its critical Q_D, on powder; `tie_parameters` placed on the powder page; |ρ| ≥ 0.9 explained as below the 0.95 refusal; the 0.8 at which the tool names posterior correlations | "Well below 2" against the tools' d < Q_D; `tie_parameters` offered on the PDF page, where it does not exist |
| sc-workflow | An occupancy refines with its alternatives tied (`tie_parameters` complement); a lone-site vacancy needs `allow_exception` with the user's reason | Proposal 3: "with that ADP fixed" is refused by the bare-occupancy rule |
| sc-workflow | "Severe" extinction is y below 0.5 (large below 0.8), tested with `test_extinction`; K below 0.95 of the others'; the report's R_int (10 %) and completeness (95 %); Flack's bands at 2u; converged at 0.1 esd | "Severe" was defined twice, differently; a manual test where the tool exists; "K below 1"; R_int 5 % and completeness 98 % against the report's check; "well below", "clearly between" |
| sc-workflow | The weights are a section, not "Stage 6" | No method stage matched it. The weights are a setting, not a refined block, so a stage would have nothing to mark it done |
| magnetic-analysis | The ★ is the lowest wR (a tie within 0.01 %), no test that the others fit worse; the `k0Magnetic` hint named; `refine` (not `refine_moments`) refuses a zero-start component | "Within the noise of the best" read as the ★, which is a 10⁻⁴ tie in code; the k = 0 hint was ignored; the refusal was ascribed to the wrong tool |
| symmetry-review | "Acceptable" is the Rietveld Gates; the candidates' order as the tool gives it; the fit range in the restart; `build_distortion_modes` MCP-only; a lost centring named | "If it is acceptable, stop" was undefined; "smallest index first" where the tool sorts by reflections explained first |
| pdf-workflow | `set_fit_range` named; `calibrate_qdamp`, `refine_pdf`, `refine_pdf_boxcar` MCP-only; the Qdamp rule covers the ADPs, the correlation guard the correlated-motion terms; δ1 with δ2 refused at |ρ| ≥ 0.95, not by a rule | The PDF page's fit window had no tool named; "the correlation check refuses the pair" claimed a rule no code has |

The tool text that restated these changed with them: `sample_posterior`'s
description and the posterior reading (conditional intervals, Q_D),
`set_extinction_model` (severe is y < 0.5), the single-crystal extinction
reading (`EXTINCTION_LARGE`, `EXTINCTION_SEVERE` in the thresholds module), the
magnetic ranking's reading (the ★), and `review_symmetry`'s candidate order on
both surfaces.

### 5.3 — The method's order out of the live tool descriptions

A description now says what a tool does and when it applies; the order lives
in the skill. Changed: `check_fit_range` ("the first step of the method"),
`reflection_statistics` ("the method's first stage"), `review_symmetry` ("the
LAST step"), `set_weighting` ("set it LAST"), `merge_equivalents`,
`set_radiation`, `set_riding_hydrogens`, `set_corrections`, `add_antisite`,
`set_adp_model` ("the last structural step") and `refine` ("follow it with
assess_refinement", which the prompt says). Each point removed is in the skill
that drives the tool. Two arm-C forms are gone with them: the description is
now the same in both arms. The MCP descriptions keep their order, since an MCP
client may have no skills.

### 5.4 — Sized for a 32k window

- Each page's method opens with **Gates**: its numbers, its stopping rule and
  what to ask the user. The outline a long session shrinks a method to keeps
  the Gates whole (`skillOutline` in `contextWindow.ts`); it kept the headings
  only, which dropped every gate number.
- The Rietveld method's cases (the examples behind each rule) and its MCP map
  moved to two notes beside it, read on demand; the PDF method's MCP map too.
- A budget test: a page's method at most 40 % of a local model's history budget
  (`LOCAL_BUDGET_CHARS`), any other skill a sixth, a method's outline a
  twentieth.

### 5.5 — New Stage 0 guidance

- **The data and the instrument** before the model: `get_state`'s axis warning,
  the cell check's d-scale reading, and an instrument constant proposed to the
  user, never changed alone.
- **A start the Le Bail fit cannot follow** goes to the Prefit; a fit stuck in
  a false minimum to the Escape minimum.
- **Absence flags all of the model centring's class** read as a possible lost
  centring as well as an impurity, put to the user at once.

The cell check's reading said the opposite of the last two (a missing phase
"most often", and "do not change the space group now" for every flag), so it
changed with them, in `check_cell_symmetry`'s live reading and description:

- a Le Bail fit at Rwp 50 % or more (`LE_BAIL_UNSETTLED`, the value the code
  already used before trusting the Le Bail cell) sends the start to the
  Prefit;
- three or more flags, every one of the class the model's centring forbids
  (`lostCentring` in `core/diagnostics`, `LOST_CENTRING_MIN`), read as a
  possible lost centring, to put to the user.

**This is the one change here that reaches arm C as well:** a tool's reading is
the same in both arms.

## Evidence

**The skill lint's allow-list is empty.** It held 13 failures (ten unmarked
MCP-only tools, two single-crystal numbers, the weights stage); it now holds
none, and it holds 16 more of the skills' numbers against their constants (the
GoF bands, the shift, the Le Bail line, the extinction lines, the ★'s tie, the
posterior's correlations).

**The model-visible text.** A new test snapshots the prompt, the mode lines and
every live tool's description and schema, with and without the skills
(`src/agent/__snapshots__/`). It was committed before any description changed,
so this pull request's diff of those two files is exactly what the model reads
differently. The system prompt is unchanged: no skill's description changed.

**Sizes** (the body the Agent reads, characters):

| Skill | Before | After |
| --- | --- | --- |
| my-rietveld-workflow | 27 886 | 23 851 (with Gates and the new Stage 0) |
| sc-workflow | 19 357 | 21 514 |
| pdf-workflow | 6 358 | 7 457 |
| magnetic-analysis | 8 058 | 8 495 |
| bayesian-check | 6 618 | 7 059 |
| symmetry-review | 6 668 | 7 016 |

The outlines, with their Gates: Rietveld 2 321, single crystal 1 911, PDF
1 438.

**Stage 0 tried on the dev analogs** (`src/agent/validation/stage0.test.ts`,
dev cases only):

| Dev case | What the skill sends the Agent by | Measured |
| --- | --- | --- |
| `dev-mn3ga-swapped-units` | `get_state`'s `axisWarning` | present |
| `dev-mn3ga-wrong-wavelength` | the cell check's d-scale reading | every d × 1.0113 named as a wrong wavelength |
| `dev-mn3ga-cell-strained` | a Le Bail fit that did not settle → Prefit | before: Rwp 190 %, 43 peaks unindexed; after the Prefit, the check again: Rwp 8.0 %, 1 unindexed (the misfit dev page has the same one) |
| `dev-mn3ga-fluorite` | a settled Le Bail fit keeps "a missing phase" | Rwp 16 %, 6 unindexed, no Prefit advice |
| `dev-cscl-wrong-centring` | flags all of the centring's class → a possible lost centring | 11 flags, all h+k+l odd under I |

`lostCentring` has its own tests: three flags of the I class read as one, two
do not, one allowed reflection among them does not, F's mixed parity, nothing
on a primitive model.

**The holdout.** The guidance names no test structure, figure or case id; the
holdout scan over every shipped file (skills, notes, tools) passes. The
lost-centring and Prefit readings were developed on `dev-cscl-wrong-centring`
and `dev-mn3ga-cell-strained` only.

**Arm A's pinned results did not move** (`validation.test.ts`).

## What changes for users

- **The in-app Agent** reads the corrected methods; on the powder page it is
  told to check the axis, the d scale and the instrument constants first, to
  send a start the Le Bail fit cannot follow to the Prefit, and to put a
  possible lost centring to the user at once. Its tool descriptions no longer
  carry the method's order.
- **The cell check's reading** changes in the app: a Le Bail fit that did not
  settle points at the Prefit instead of a missing phase, and flags all of the
  centring's class name a possible lost centring.
- **The single-crystal extinction reading** gives one definition: large below
  y = 0.8, severe below 0.5.
- **Claude Code** reads the same skills; the Rietveld cases and MCP map are now
  notes beside it, linked from its References.
- **MCP clients:** `review_symmetry`'s description states the candidates'
  order as the tool gives it. Nothing else changes over MCP.

## What it means for the validation

- Arm B runs on the corrected skills. Arm C loses the order the other tool
  descriptions carried (the weights last, merging and the radiation first, the
  corrections after the structure, the ADPs' order, the ends read again after
  the first refinement), now in the skills only, which is what C is meant to
  lack.
- Both arms see the cell check's new readings, so on the centring and strained
  kinds part of what the skills would add now comes from the tool. The
  ablation measures the skills beyond it.
- Arm A's pinned results are unchanged.

## Not done

- **Waiting on the user:** this review. Each skill's edits are in the diff; the
  Rietveld method's cases moved, unchanged, to
  `.claude/skills/my-rietveld-workflow/notes.md`.
- The single-crystal GooF line (1.3 in the Validation tab, 1.5 in the
  assessment's band) is still the user's decision.
- 4.11, the lost-centring candidates in `review_symmetry`, comes next: the cell
  check now names a possible lost centring, and no tool yet lists the
  decentred groups.
- 4.4 (a significance test in the magnetic ranking) would give the ★ and
  "fits about as well" one meaning; until then the skill says the ★ is the
  lowest wR.
- 5.6, SKILL_INTERVIEWS brought up to date.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2324
tests, 265 skipped (live runs and data-dependent suites).

# Agent review: tools and skills

This page reviews the analysis tools the in-app Agent relies on and the six
skills that tell it how to use them. For each tool it asks three things: what
the tool computes, whether a test checks it against a known answer, and what is
missing. For each skill it asks whether every decision rests on a tool's
output, whether the acceptance criteria are explicit and physically justified,
and whether the skill contradicts a tool.

The Agent's results are measured in [VALIDATION.md](./VALIDATION.md#does-the-agent-help).
This page covers the parts those results depend on. It was reviewed on
2026-10-14, on `validation/agent-review`.

## Tools

"Known answer" means a test compares the tool's output with an analytic
result, a simulation whose truth is known, or a reference program. Tests marked
*data* read the git-ignored `data/` folder. They are skipped in CI, so CI does
not hold the GSAS-II, SHELXL and FullProf comparisons; only a machine with the
data does.

| Tool | What it computes | Known answer | Gaps |
| --- | --- | --- | --- |
| `assess_refinement` | GoF bands after Toby (2006): ≤ 1.5 excellent, ≤ 2.5 good, ≤ 4 fair, < 0.8 "too good"; shift/esd (0.1 settled); \|ρ\| > 0.95; data per parameter; residual peaks | hand-built results only | On powder the data-per-parameter check counts profile points, not reflections, so it never fires. On PDF the GoF is stripped, so the band can never be better than "fair". |
| `diagnose_fit` | background χ² share, width ratio (limit 1.25), Wilson ΔB, texture correlation over 7 axes, Durbin–Watson against Hill & Flack's Q_D | simulated faults with known truth (asymmetry, texture, width, Lorentzian part) | Texture uses one hkl per family and takes the best of 7 axes at \|r\| > 0.5 with about 12 reflections, so false positives on noise are likely. Wilson pools all phases. |
| `find_unexplained_peaks` | residual peaks above 8 MAD σ, above 5 counting σ, and above 8 % of the largest residual; each classed on, beside or between reflections | synthetic only | **Fixed:** the limit was applied before classification, so misfits crowded out a weaker unexplained peak. **Open:** the 8 % floor hides weak lines next to one strong misfit; the merge window is a fixed 0.02 Å; on CW data in d or Q the line-width tolerance falls back to a fixed 2 %. |
| `identify_peaks` | d-scale search over ±1.5 %, a 0.25 % match window, strong-line check | real d-lists (Cr₂WO₆'s Al cryostat, NAC's fluorite) | No false-positive test on random d-lists. |
| `check_cell_symmetry` | Le Bail fit, absences at 5σ, overlap within 1.5 widths | synthetic failures in CI (CsCl declared I-centred, tetragonal declared cubic, TOF); real Mn₃Ga *data* | Cannot see a cell that is too large (documented). The Le Bail cell is returned but no tool applies it, apart from `refine` mode `thorough`. |
| `review_symmetry` | forbidden reflections within 0.5 % of a residual peak; translationengleiche subgroups up to index 6 | 2 synthetic tests | Inherits the 8 % floor, so weak superstructure lines can be missed while the tool says nothing calls for a lower symmetry. The 2 % untestable window is fixed. |
| `search_propagation_vector` | k on a grid of components in [0, ½] with denominators 2, 3, 4, 6; match within max(0.02 Å, 0.5 %) | synthetic k plus real AWO₄ *data* | No mixed-sign k such as (¼, 0, −¼), which monoclinic and triclinic cells need. The hkl range is fixed at ±4, too few for large cells. |
| `rank_magnetic_groups` | each group's moments fitted with the nuclear model held, ranked by wR | magneticCompare (simulated truth); **new:** Example 3 in-app, against the simulated moments | **Fixed:** restarts (see below). **Open:** no penalty for extra moment parameters (Hamilton test); the held nuclear scale biases the ranked magnitudes low at k = 0 until the joint refinement. |
| `sample_posterior` | R̂ < 1.05, ESS ≥ max(100, 10 per parameter), esd ratio 0.67–1.5 | exact linear-Gaussian and Gamma posteriors; Ni PDF golden (esd ratio ≈ 1) | Strong. |
| `boxcar_scan` | sequential box refinements | recovers the simulated truth in every box | The Agent's view drops the per-box esds, so a drift cannot be judged for significance. |
| `test_extinction` | two probe fits; flags moves above 2 esd | plumbing only | No known-answer test. |
| `reflection_statistics` | ⟨\|E²−1\|⟩ (0.968 / 0.736), absences at ≥ 3σ, Yeates' H-test | H-test on synthetic Wilson data; SHELXL BASF *data* | The synthetic test never exercises the ≥ 3σ cut, which biases α upward on weak data, while the text says noise lowers it. |
| Flack / Parsons | quotients with propagated σ; bands after Flack & Bernardinelli | synthetic; SHELXL *data* | With unmerged data it uses only the first measurement per index. |
| correlation guard | refuses \|ρ\| ≥ 0.95 or an undetermined combination before a refine | synthetic | Sound. |
| `rank_next_parameters` | predicted wR gain per parameter group | unit tests | **Fixed:** it probed the whole pattern without restraints, ignoring the fit window. |

### Fixed on this branch, each with a test that fails without the fix

- **`rank_magnetic_groups` restarts.** Each group is now fitted from its seeds
  and 12 kicked restarts, the best kept. This is the MCP path's moment search
  (`core/magnetic/momentRestarts.ts`), and the app's panel and the headless page
  share it. On Example 3 the in-app path now ends at wR 4.56 %, with every
  moment within 0.15 µB of the simulated truth. One fit per group ended at
  4.79 % with Mn1 at (−0.56, −0.01) µB (`rankRestarts.test.ts`).
- **`rank_next_parameters`** now probes the problem the next refinement
  solves: the fit window and the page's restraints (`rankNextWindow.test.ts`).
- **`find_unexplained_peaks` / `assess_refinement`** classify every residual
  peak before applying the limit (`residualPeaksLimit.test.ts`).
- **The eval harness's page**:
  - Its `refine` ignored the fit window, so every live eval refined the whole
    pattern after `set_fit_range`. It now uses the window.
  - Its Prefit (`refine` mode `thorough`) was a plain refine. It is now the
    app's: a Le Bail cell pre-fit, then restarts. `rutile-cell-strained`
    depends on it.

### Larger items, not fixed

1. **CI runs none of the external comparisons.** The GSAS-II, SHELXL, FullProf
   and WinGX tests read git-ignored data. Committing small public reference
   fixtures, as `pdffit2Golden.ts` does, would put them in CI.
2. **The 8 %-of-largest floor** in residual-peak detection. Drop it when every
   point has a σ, and rely on the 5σ test. This needs a check of the
   false-positive rate on the eval pages first.
3. **k-search coverage:** add mixed-sign k for low-symmetry lattices, and size
   the hkl range from the cell.
4. **Magnetic ranking:** add a Hamilton R-factor ratio test (or Δχ² per
   parameter) so a lower group with more moments must earn its parameters. At
   k = 0, rank with the scale free.
5. **Data per parameter on powder:** count reflections, not points.
6. **Texture diagnosis:** average over symmetry equivalents, and correct for
   picking the best of 7 axes.
7. **The H-test's ≥ 3σ cut** and its stated direction of bias.
8. **`boxcar_scan`'s per-box esds** in the Agent's view.

## Skills

| Skill | Decisions tied to a tool | Explicit, justified criteria | Contradictions with the tools |
| --- | --- | --- | --- |
| `my-rietveld-workflow` | mostly; "stable" and "converged" are undefined (`assess_refinement` uses shift/esd < 0.1) | the 15 % cut, 0.3 esd, \|ρ\| ≥ 0.95 and P = 0.5 / 0.56 match the code; the GoF bar has no number | **Stage 0 says to carry the Le Bail cell, zero and profile forward, but no live tool sets them** (only `refine` mode `thorough` does, internally); `extraPhases` and `export_bundle` exist only on MCP; "GoF = Rwp/Rexp, i.e. reduced χ²" is wrong (it is √χ²ν); the stopping rule (GSAS-II and FullProf agree) cannot be met in the app and has no tolerance |
| `magnetic-analysis` | the k = 0 choice ignores `assess_refinement`'s k = 0 hint; "within the noise of the best" has no number | \|M\| ≤ g·S is justified, but no tool checks it | the refusal it ascribes to `refine_moments` belongs to `refine` |
| `pdf-workflow` | the fit window has no tool on the PDF page; delta1 against delta2 has no criterion | none (defensible: no GoF) | claims the correlation check refuses delta1 with delta2 and Qdamp with delta2; no rule does, only \|ρ\| ≥ 0.95 might |
| `sc-workflow` | "well below their esds", "α well above" and "clearly between" (Flack) have no numbers; the tools use 0.1, the H-test bands and 2u | d_min 0.83 Å, ⟨\|E²−1\|⟩ and Flack u < 0.04 are right but uncited; R_int < 5 % and completeness ≥ 98 % differ from the report check (10 %, 95 %) | refining an occupancy "with that ADP fixed" is refused by the bare-occupancy rule; it describes a manual extinction test where `test_extinction` exists; "severe" extinction is defined twice, differently |
| `symmetry-review` | "if it is acceptable, stop" is undefined | the 2 % overlap matches the tool | the restart omits the fit-range stage; `build_distortion_modes` exists only on MCP; candidates are sorted by allowed reflections, not by index |
| `bayesian-check` | yes | R̂, ESS, esd ratio and P all match `posteriorTool.ts` (McCluskey et al. 2023) | \|ρ\| ≥ 0.9 against the engine's 0.95; "Durbin–Watson well below 2" against the tools' d < Q_D; "the profile's correlations with the structure are weak" contradicts the same skill and `my-rietveld-workflow`, and makes intervals falsely narrow; `tie_parameters` is offered on the PDF page, where it does not exist |

### Proposed skill changes, waiting for the user's approval

None of these is applied. A skill change needs the user's approval, and it is
to be tried on the dev set only (see VALIDATION.md, "Findings").

1. `my-rietveld-workflow` Stage 0: say that the app does not carry the Le Bail
   cell, zero or profile forward. On a start the cell check finds off, use
   `refine` with mode `thorough`, which runs the Le Bail cell and then
   restarts. `dev-mn3ga-cell-strained` is the dev case for this.
2. `bayesian-check`: replace "correlations are weak" with "the intervals are
   conditional on the instrument terms held; say so when quoting them".
3. `sc-workflow`: refine an occupancy with the alternatives tied
   (`tie_parameters` complement). A lone-site vacancy needs `allow_exception`
   with the user's reason.
4. `my-rietveld-workflow`: define the in-app stopping rule. The alternation
   has settled, shift/esd is below 0.1, and the verdict holds. Mark the
   GSAS-II and FullProf cross-check as MCP-only and give it a tolerance of
   2 combined esds.
5. One-line corrections:
   - GoF = √χ²ν, with the tool's bands;
   - Durbin–Watson against Q_D;
   - \|ρ\| 0.95;
   - "severe" extinction means y < 0.5, pointing to `test_extinction`;
   - the report's R_int and completeness thresholds;
   - mark the MCP-only names (`extraPhases`, `export_bundle`,
     `build_distortion_modes`);
   - add the fit range to the symmetry review's restart.

---
name: my-rietveld-workflow
description: >-
  The user's personal powder Rietveld refinement methodology for MATERIA — a sanity
  check of the cell, a fixed freeing sequence, acceptance criteria, and the space group
  questioned last, only once everything else is refined — driving the MATERIA MCP
  tools. Use this whenever the user asks to refine a loaded powder pattern, run "my
  refinement", do a Rietveld refinement, stage or free parameters on a powder dataset,
  decide what to refine next, or asks why a fit is stuck — even if they don't name the
  skill. Covers constant-wavelength and time-of-flight, single- and multi-phase; hands
  off to the magnetic-analysis flow for magnetic structures. NOT for single-crystal
  integrated-intensity refinement, and NOT for ab-initio structure solution / indexing
  an unknown cell.
---

# My Rietveld workflow (MATERIA)

This encodes **how the user runs a powder refinement** — the order, the checks, and the
bar for calling it done. It is deliberately opinionated: it is their method, not a generic
"free everything and hope" Rietveld. Follow the sequence, but explain what you are doing
and why at each stage so they can steer — they judge the fit, you drive the mechanics.

The heuristics live in the app already (`suggest_next_steps`, `rank_next_parameters`,
`assess_refinement`, the staged plan). This skill's job is to apply **their** ordering and
**their** stopping rules on top of them. In the app, choose what refines with `set_free`,
then `refine`; over MCP, the `mcp_tool_map` reference maps the steps. The user's cases
behind each rule are in `rietveld_notes`.

## The rule that comes before everything: doubt the model before the symmetry

**Refine the model to the best its space group allows before questioning the space
group.** Changing the symmetry is the *last* step, taken only when everything in this
method has been refined and the fit is still not good — never at the beginning, and never
to explain a misfit that refinement has not yet had a chance to fix.

At the start, observed and calculated intensities differ on many reflections. That is
normal: it is exactly what refining the atoms, ADPs, occupancies, the profile and the
corrections fixes. A reflection the model has, with more or less intensity than calculated,
is a **misfit to refine**, never an "extra peak" and never evidence for a lower symmetry.
Only a peak that sits on no reflection of any phase is an extra peak
(`find_unexplained_peaks` lists the two apart).

## Gates

The numbers and the stops in one place; each is explained at its stage below.

- **The data before the model.** An axis in another unit than the file says, one factor on
  every d (a wrong wavelength or TOF calibration), or an instrument constant that does not
  fit the setup: put it to the user before anything is refined. No refinement fixes them.
- **The fit range.** Every cut in a gap between reflections; a cut of more than 15 % of the
  points is the user's call.
- **A block is done** when it has converged — `assess_refinement`'s largest shift below
  0.1 esd — and nothing has railed to a bound. Only then free the next.
- **Firm rules** (`refine` refuses; only the user lifts one, with `allow_exception`): no
  occupancy refines bare; the instrument's terms never refine with the B values (alternate
  the two; settled once a cycle moves neither group by more than 0.3 esd); no two free
  parameters that correlate at |ρ| ≥ 0.95.
- **GoF** = Rwp/Rexp = √χ²ν, in `assess_refinement`'s bands (Toby 2006): excellent up to
  1.5, good to 2.5, fair to 4, poor above; below 0.8 the fit is "too good" — the σ
  overestimated or the model over-parameterized.
- **Done, in the app**: the alternation has settled, the largest shift is below 0.1 esd,
  and the verdict holds — good or excellent, nothing at a bound or unphysical, no
  correlation refused. **Over MCP** the cross-check must agree as well: GSAS-II and
  FullProf give each reported parameter within 2 combined esds.
- **Ask the user** before a large fit-range cut, adding a phase, an instrument constant, an
  exception to a firm rule, and any change of space group (which you never make yourself).

## Stage 0 — Load, set the fit range, and sanity-check the cell

1. **Load, then read the data and the instrument.** Over MCP, load with `parse_structure`
   (CIF), `parse_powder_data` (pattern) and `parse_instrument`; in the app the user loads
   them, and `get_state` shows the page. Confirm the radiation/geometry (CW vs TOF;
   capillary, flat-plate, or cylindrical) — it decides which corrections mean anything
   later. Then check the data are what the files say (no refinement fixes these):
   - **The axis.** `get_state`'s `axisWarning`: the axis holds next to none of the
     structure's reflections (d or Q read as 2θ). Ask the user its unit.
   - **The d scale.** The cell check (step 3) first reads the pattern's own peaks: one
     factor on every d is a wrong wavelength (CW) or difC (TOF), or the wrong cell, and it
     names the value the data imply; a Le Bail cell off by one factor in every length
     reads the same. A refined cell would absorb it: ask the user to confirm first, and
     until then quote a cell as uncalibrated.
   - **The instrument constants** — the wavelength, a TOF calibration, the polarization P,
     the Kα₂ ratio — are the instrument's, not the fit's (P moves every B at the same wR).
     When one does not fit the setup the user describes, propose `set_instrument_constants`
     (it always asks); never change one on your own. A Kα₂ peak is never an extra peak.
2. **Set the fit range: read the data's ends** (`check_fit_range`) before anything is
   fitted: a model that fits ends that are not data bends its background, which then
   trades with the B values. The user's practice, as the GSAS-II tutorials': start **just
   below the first reflection**; end **in a gap below the end of the pattern** when the end
   is not real data — counts that **step up and stay** (a detector's or a scan's edge), no
   counts, a line cut by the last point, the short-d stretch where **no peak stands out of
   the noise**, or, on a converged fit, an end the model misses by more than anywhere next
   to it. **Keep** what holds information: peaks below the first reflection that no phase
   explains are magnetic order (neutrons, below the ordering temperature) or another phase,
   to explain; both ends when peaks are clear to the last point. Every cut in a gap between
   reflections, never through a line. Apply the proposal with `set_fit_range` (it asks the
   user) and say why, end by end; read the ends again after the first refinement. The page
   fits one window: a stretch inside the pattern (a spike) cannot be left out — say so.
3. Run the **free-intensity (Le Bail) check**: `check_cell_symmetry` (over MCP, pass known
   impurity phases as `extraPhases`; in the app it reads every phase on the page). It
   refines the cell by a Le Bail fit and reads what is left over — a sanity check, not a
   gate; it never holds a refinement:
   - **unindexed peaks** (`unindexedPeaks`) — a peak no reflection of the cell can place:
     most often a missing phase (an impurity), sometimes a wrong cell. Settle it with the
     user before the structure is refined: it is the one thing refinement cannot fix. On
     neutron data at low or high temperature, think of the sample environment first
     (`identify_peaks`: the can, the shields, common standards and synthesis impurities);
     `add_known_phase` adds a matched phase once the user agrees; another phase needs their
     CIF. Small bumps on a strong line's flank are `shoulders` — a profile tail, not a phase.
   - **a Le Bail fit that did not settle** (Rwp of 50 % or more, many peaks unindexed): the
     start is further off than the fit can follow, usually in the cell, and the model's own
     lines are among the unindexed ones — not a phase to add. Prefit (step 4) and check
     again; only what is still unindexed is a missing phase.
   - **absence flags** (`absences.violated`) — leftover intensity at a reflection the
     space group forbids. A flag, not a verdict: before the structure is refined, a strong
     neighbour's profile misfit, an impurity line or the Le Bail fit's own shape error
     reads the same way. Note it (`write_note`) and go on; do **not** propose a lower
     symmetry here — the symmetry review reads the refined residual at the end. **One
     pattern is told now:** several flags, all of the class the model's centring forbids
     (h+k+l odd under I, and so on), read as a **lost centring** — the data's lattice
     primitive where the model's is centred, an order the model averages — as well as an
     impurity whose lines land there. No refinement of this model puts intensity there:
     put both readings to the user now and note it; the model stays until they decide.
   Report the numbers, not just "passed": absences tested and untestable (overlapped), and
   the tool's `limits` — it cannot see a too-large cell or a group with too few absences.
4. **The start.** The check only reads: nothing carries its Le Bail cell, zero or profile
   into the model, so the refinement starts from the loaded model and Stage 1 refines the
   cell first. When the start is far off — the Le Bail fit did not settle, or the first
   refinement leaves the lines visibly misplaced — run the Prefit (`refine` with mode
   `thorough` before any fit; with a fit on screen, `go_to_step` back to the start first):
   a Le Bail cell, then restarts from it. When the user asks for a refinement, refine: the
   check informs the refinement, it does not stand in its way.

## Stage 1 — Structural refinement, in the fixed order

The sequence is **atoms before profile**. Free parameters in this order — in the app
`set_free` then `refine`; over MCP `build_refinement` once, then `refine_powder` — and check
(`assess_refinement`) between blocks. Free the next block only once the current one has
converged (the largest shift below 0.1 esd) and hasn't railed to a bound.

1. **Scale + background + cell** — first, so intensity has somewhere sane to go. **Refine
   the cell here** (with the zero): the check's Le Bail cell does not carry over. (Watch the
   cell↔zero↔displacement correlation — `assess_refinement` flags it; free the zero from a
   standard or on a wide range.)
2. **Atomic positions** — freed *early*, against a roughly correct profile (the instrument
   file's; when it is far off, see below), so the profile cannot later absorb structural
   misfit as fake broadening. A *quick* pass, not a fight: the positional gain is often
   small and the profile the bigger lever; converge fast and move on.
3. **Profile** — now the peak shape: Caglioti `W` → `U, V` → the Lorentzian size/strain
   `X, Y` is a reasonable order, *not* a rigid one: free what the residual needs. `U`
   correlates strongly with sample broadening and is often held on a narrow 2θ range, but
   free it when a genuine width mismatch demands it.
4. **ADPs** — with the instrument's terms fixed (the zero, `U V W X Y`, the asymmetry: the
   guardrail below), then the two groups alternate. `B_iso` first; **anisotropic only if
   the data clearly support it** (high real-space resolution / low temperature). `B_iso`
   railing toward 0 usually means the background or a correction is stealing high-angle
   intensity, not a rigid atom. When B values are not *determined* — they swap
   between refinement paths at the same wR, an esd is as large as the value, or one rails
   at 0 as its partner climbs (common below Q ≈ 6 Å⁻¹) — `tie_parameters` constrains
   chemically alike atoms to one B (the cations of an oxide, all the oxygens). Say in the
   report which B's are tied and why.
5. **Occupancy** — see the guardrail below. Usually near-last.
6. **Corrections** — end-stage polish only; see below.

If the fit stalls between blocks, `rank_next_parameters` / `assess_refinement` show what
limits it, but keep the block order — don't jump ahead to occupancy or corrections to
chase a number. When the verdict is poor or fair, `diagnose_fit` reads the residual cause
by cause, with each cause's share of χ² and the action: act on the largest first, and
re-run it after each change. A fit that converges poor while
`diagnose_fit` names nothing the next block fixes may sit in a **false minimum**: `refine`
with mode `thorough` after a fit is the Escape minimum, a light multi-start nudge out of
it; a start far off goes back to the Prefit (Stage 0, step 4).

**Peak asymmetry is part of the profile, not polish.** On constant-wavelength data a
one-sided residual at low angle (`diagnose_fit` says asymmetry) is axial divergence: switch
it on (`set_corrections` asymmetry; S/L refines, H/L follows it) and refine it with the
Caglioti terms. A Lorentzian X or Y that refines negative is unphysical: reset it
(`reset_parameters` with its id), hold it, refine the rest.

**When the starting profile is far off, the profile comes before the positions.** When
`diagnose_fit` measures the lines much broader (or narrower) than calculated
(`peak-width`), refine the Caglioti terms first and say why: positions refined against
lines that wrong absorb the width misfit. Then, if the lines are more Lorentzian than
calculated (`peak-tails`), free X and Y.

## The occupancy guardrail (do not skip)

**Never free occupancies bare.** Scale and site occupancy are near-degenerate on a single
site — both just scale intensity — so a free occupancy trades against the scale and lands
somewhere chemically meaningless. Free an occupancy only when one of these breaks the tie:

- a **Σ = 1 (or Σ = known total) restraint** on a shared/mixed site, or
- a **known chemical constraint** (fixed composition), or
- a **genuine second contrast** — anomalous (X-ray near an edge) or isotopic (neutron) —
  that makes occupancy separately determined.

If none is present, keep occupancy fixed and say why. This is a firm rule: in the app a
refinement with a bare occupancy is refused; only the user can allow one
(`allow_exception`), for a genuine second contrast.

In the app the first two are the Shared site ties (`set_site_ties`): **Σ occ = 1** holds a
mixed site full, and **hold composition** keeps each element's total, so anti-site disorder
or spinel inversion refines as one exchange fraction. Report that fraction with its esd,
not every occupancy.

**Antisite disorder has a signature in the ADPs**: after the ADP stage, one cation site's
B rails toward 0 while another's is high. With contrast between the two elements (neutron
b, or X-ray Z), `add_antisite` puts each on the other's site under Σ occ = 1 and hold
composition (it asks the user); free the four occupancies, refine, and report the exchange
with its esd and how the B values moved. To a modest Q the exchange trades with the B
values, and a large esd is the honest result. If it refines to zero, the ADP contrast is
not disorder: return to the ordered model and, unless the contrast is significant and
stable, tie the two cation B's.

## The instrument–thermal guardrail (do not skip)

**Never refine the instrument's terms together with the thermal parameters.** The
instrument's terms are GSAS-II's Instrument Parameters: the **zero** (or the TOF
calibration), the **peak shape** (Caglioti `U V W`, Lorentzian `X Y`, the TOF α β σ) and its
**asymmetry** (S/L, H/L). The thermal parameters are the **B values or ADPs**. They trade
through the background at high angle and the scale the low-angle lines fix: refined
together, each absorbs the other's error — a B gone negative while the profile widens —
and the esds hide it.

**Alternate the two groups instead.** Refine the instrument terms with the B values fixed,
then fix them and refine the B values; repeat. In the app, `refine` reports the
`alternation` after each step: the group refined, its largest shift since its last
refinement (in esd), and `settled` once a cycle moves neither group by more than 0.3 esd —
stop there. If the shifts shrink slowly (each cycle more than two-thirds of the last), the
groups are coupled: tell the user, and report the B values as conditional on the
instrument terms unless they allow one joint refinement. Either way, each group's esds are
conditional on the other held fixed — say so in the report.

**With an instrument file from a standard**, keep its terms fixed where they fit, and
refine only what the sample adds; when it does not describe the data, refine its terms,
alternating as above. A microstrain model (`set_microstrain`) is the sample's broadening,
outside this rule; `X` and `Y` are inside it (they hold the instrument's Lorentzian part
too). Only the user lifts the rule (`allow_exception`, rule `instrument-with-thermal`),
for instance for one last joint cycle once the alternation has settled.

## The correlation guardrail (do not skip)

**Never refine strongly correlated parameters together.** Two free parameters that
correlate at |ρ| ≥ 0.95 carry information the data cannot separate: the fit trades one
against the other along a valley, their esds inflate, and either can land anywhere on it.
In the app `refine` measures the free set at the current values and refuses a correlated
set; over MCP, read the correlations `refine_powder` and `assess_refinement` report. Fix
one of a pair — usually the one this sequence frees later (occupancy against scale, B
against scale, the zero against the cell) — or refine them in separate stages, and free it
again only once the other is stable. A combination the data cannot determine at all (a null
direction) is the same rule at its limit. When a pair has to stay free together, or a value
stays unconvincing after the method has run, sample the posterior before reporting it
(`bayesian-check`, `sample_posterior`).

What does **not** count: the terms of one curve among themselves (the background
coefficients; the Caglioti `U, V, W` of one FWHM²(θ), free together on a wide range), and
two occupancies tied by one restraint — they trade by construction while what they
describe is determined. Each against anything else still counts, and so does `X` ↔ `Y`
(size against strain, which people report).

## Corrections are polish, not a crutch

Add sample/intensity corrections **only after the structure has converged**, to clean up a
residual — never early, and never to rescue a bad structural model. Match the correction to
the geometry and the residual's signature (`set_corrections`; their rows come in fixed: free
them, then refine):

- capillary / cylindrical transmission → **absorption μR** for the low-angle intensity;
  roughness and transparency do **not** apply.
- flat-plate reflection → **displacement** (cosθ peak drift) and, for a low-angle intensity
  deficit, **Suortti roughness**; **transparency** (∝sin2θ) for a low-μ slab.
- a systematic hkl-family intensity mismatch (`diagnose_fit`: texture along one direction)
  → **preferred orientation** (March–Dollase, `preferredOrientation` [h, k, l]).

Displacement correlates with the cell and the zero, roughness SRA/SRB with each other and
the scale: free at most what the angular range can separate.

## The symmetry review — the last step, if at all

Only when every block above has been refined to convergence and the fit is still not
acceptable may the space group be questioned, and only on evidence in the **refined**
residual: `review_symmetry` (in the app it refuses, naming the stages left, until they are
done), then the `symmetry-review` skill. The decision is the user's; never change the
model yourself. Not evidence: misfit on allowed reflections, a poor GoF on its own, a
Stage 0 flag the refined residual no longer shows.

## When it's done — the acceptance bar

The user does **not** chase absolute Rwp. A fit is acceptable when all of:

1. **GoF (= Rwp/Rexp = √χ²ν, the square root of the reduced χ²) is reasonable** — good or
   excellent in `assess_refinement`'s bands: close to the statistical floor, not just
   numerically small. Report GoF, not Rwp alone. **Flag a GoF meaningfully below 1**
   (below 0.8, too good): the σ's are over-estimated or the model over-parameterized, so
   the ESDs are optimistic — suggest checking the weighting or the free-parameter count
   rather than celebrating.
2. **Physical sanity holds** — `B_iso > 0`, occupancy sums chemically sensible, bond
   lengths/angles reasonable (`bond_geometry` gives the bond-valence sums).
   `assess_refinement` surfaces at-bounds and unphysical parameters; treat any as a
   blocker, not a rounding detail. A weakly determined parameter the result rests on gets
   its credible interval (`bayesian-check`), not only its esd.
3. **External cross-check agrees** — re-run in **both GSAS-II and FullProf** and confirm
   the parameters and ESDs are consistent. Over MCP, `export_bundle` writes both bundles
   (the `mcp_tool_map` reference says how; the `.pcr` starts scale, background and the CW
   peak shape from seeds, to be freed in FullProf — say so); in the app the user writes
   them from the Export menu.

**Stopping rule.** Levenberg–Marquardt converging is necessary but not sufficient.

- **In the app**, where the Agent cannot run the other packages: the refinement is done
  when the alternation has settled (`refine`'s `alternation`), the last refinement's
  largest shift is below 0.1 esd, and the verdict holds — good or excellent, with nothing
  at a bound, unphysical or refused. Report then, and offer the cross-check as the user's
  next step.
- **Over MCP, the external cross-check is the terminator**, not an internal Δχ²
  threshold: keep iterating (and re-examining the model) until GSAS-II and FullProf
  reproduce the parameters and ESDs on the same data — each reported parameter within 2
  combined esds (|Δ| ≤ 2√(σ₁² + σ₂²)). If the packages disagree, the fit isn't finished,
  however good the internal GoF looks: resolve the discrepancy before calling it.

Report GoF + the key refined values with ESDs (`structure_table`) + which corrections were
on + any correlations/at-bounds worth knowing — not just "converged, wR = X%" — and compare
with a published structure when there is one. On lab X-ray data, give the P the B values
assume.

**The written report.** In the app, `write_report` once the analysis is done and reported:
its `summary` is your account (the approach, what the result says, the caveats, what is
left open), with no number the tools did not give. Over MCP, the same content comes from
`export_bundle` and the tools' results.

## Multi-phase and magnetic

- **Multi-phase**: the instrument/profile, zero, background and sample-geometry corrections
  are **shared**; scale, cell, atoms and microstructure are per phase. **Free each block
  across all phases at once**; **phase-by-phase only if that is unstable** (a scale
  collapsing, divergence, runaway cross-phase correlations). Report each **weight fraction**
  (`get_state`'s `phaseFractions`, Hill–Howard, with esds): the model's crystalline phases
  only, no microabsorption correction.
- **Magnetic**: once the nuclear structure is converged, hand off to the `magnetic-analysis`
  skill (in the app, the powder page's magnetic analysis step; over MCP,
  `search_propagation_vector`, `list_magnetic_subgroups`, `build_magnetic_model`,
  `refine_magnetic_powder`) — a separate method, not this one.

## References

Longer knowledge bases behind this method. Read one only when a question needs it.

- [`rietveld_notes`](./notes.md) — the user's cases behind the rules above, stage by stage, and the longer account of the instrument–thermal trade, lab X-ray polarization and the wavelength.
- [`mcp_tool_map`](./mcp-tools.md) — the method's steps on the MATERIA MCP tools, and the cross-check bundles.
- [`powder_structural_refinement`](../../../knowledge/powder_structural_refinement_knowledge.md) — the Rietveld model and its policy: profile functions, ADPs, occupancies, constraints, and what makes a refinement physically defensible.
- [`refinement_fitting_algorithms`](../../../knowledge/refinement_fitting_algorithms_knowledge.md) — the least-squares engine: Levenberg–Marquardt, convergence and shift/esd, correlations and the SVD, restraints, esds and the GoF.
- [`powder_background_texture`](../../../knowledge/powder_background_texture_knowledge.md) — background models and preferred orientation: which basis to use, how many terms, and how texture shows in the residual.
- [`magnetic_structure_symmetry`](../../../knowledge/magnetic_structure_symmetry_knowledge.md) — magnetic symmetry and refinement, for the hand-off: when excess intensity may be magnetic order and what the magnetic step needs.

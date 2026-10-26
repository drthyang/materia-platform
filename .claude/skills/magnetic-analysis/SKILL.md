---
name: magnetic-analysis
description: >-
  The powder magnetic structure workflow in MATERIA, after the nuclear structure is
  refined: the propagation vector k from the peaks the nuclear model leaves, the magnetic
  space groups of the little group of k (top-down from the maximal ones), their moments
  fitted against the data, then refined with only the magnetic parameters free (the nuclear
  model held), with the powder's limits stated. Use it whenever the user asks for the magnetic structure, to find k, to
  pick or compare magnetic groups, to refine moments, or why there are peaks below an
  ordering temperature — even if they don't name the skill. Drives the powder page's
  magnetic analysis step (in the app) or the magnetic MCP tools. NOT for the magnetic PDF
  (mPDF). A first draft, not yet confirmed as the user's own method.
---

# Powder magnetic analysis (MATERIA)

The magnetic step `my-rietveld-workflow` hands off to, written from the app's workflow and
the magnetic knowledge base; the user has not been interviewed on it yet, so where it leaves
a choice, say what you chose and why, and let them steer.

## Before anything: the nuclear structure is refined

Magnetic intensity is judged against the nuclear model. If the scale, background, profile,
positions and ADPs are not refined first, the moments absorb their error — above all for
k = 0, where magnetic intensity sits on nuclear reflections. So:

1. The nuclear structure is refined as fully as the data allow, in `my-rietveld-workflow`'s
   usual order, before the magnetic structure: that is the standard. If it is not, do that
   first.

   **The exception: magnetic Bragg intensity comparable to the nuclear, on nuclear
   reflections.** The magnetic signal is usually orders of magnitude weaker, but large
   moments (Tb-based compounds, for one) can give k = 0 magnetic peaks as strong as the
   nuclear ones. The app's signal is `find_unexplained_peaks`' `k0Magnetic` (neutron data:
   the misfits sit on nuclear reflections at large d, the sample below its ordering
   temperature). The nuclear model alone then takes up the magnetic intensity: the ADPs and
   the scale grow (notes). Only then, follow the usual order up to, not including, the positions and ADPs
   (the scale, background and cell), then go to k: include the misfit peaks in the k-search
   (they sit on nuclear lines and are left out by default) or set k = 0. Stage 4 refines the
   positions, the profile and the B's with the moments, in the usual order.
2. Prefer the nuclear structure from a dataset above the ordering temperature when the user
   has one: fix it, and refine only the magnetic parameters on the ordered data.
3. With k = 0 and no dataset above the ordering temperature, refine the nuclear model at
   high angle, where the magnetic form factor has faded (`set_fit_range` to d ≤ 1.5 Å for
   3d ions), then `set_fit_range` `whole` before the magnetic step: a whole-pattern nuclear
   scale takes the magnetic intensity on the nuclear lines, and the moments come out small.
   Check the peak widths still fit the low-angle lines; say which window you used.
4. Know what the residual is. `find_unexplained_peaks` separates peaks on no reflection
   (candidate magnetic satellites, or an impurity) from misfits on known reflections (which
   refinement fixes; for k = 0 on neutron data they may also be magnetic: the `k0Magnetic`
   flag, also in `assess_refinement`, marks an excess on nuclear lines at large d).

## Stage 1 — the propagation vector k

1. Read the step (`magnetic_state`): the magnetic ions, and the residual peaks the k-search
   uses (peaks on nuclear reflections are left out by default; they are profile misfit
   more often than magnetic).
2. `search_propagation_vector` ranks commensurate k by how many included peaks their
   satellites G ± k explain and how closely. Prefer the k that explains every peak with
   the simplest fractions; an impurity's lines will not fit any k — check them against a
   second phase first.
3. Set it (`set_propagation_vector`). k = 0 when the magnetic intensity sits on the nuclear
   reflections (the `k0Magnetic` hint, and the sample below its ordering temperature on
   neutron data); the k-search on the misfits' d confirms it.
4. Choose the magnetic ions (`select_magnetic_ions`): the sites whose ions carry a moment.

## Stage 2 — the magnetic space group, top-down

The groups of the little group of k are listed by index (2 = maximal). Landau theory favours
a single irreducible representation — a maximal group — so start there:

1. `rank_magnetic_groups` with the default scope fits the maximal groups' moments (the
   nuclear model held) and ranks them by wR against the nuclear-only wR. Widen to
   `"all"` only when no maximal group explains the magnetic peaks — and check that it
   explains each of them, not only the wR: neutrons see the moment component
   perpendicular to Q, so a moment along c puts no intensity on 0 0 l. A magnetic 0 0 l
   line the best maximal group leaves in the residual asks for an in-plane component,
   which may only a lower group allow (notes: Cr₂WO₆).
2. Read the ranking honestly. The ★ marks the lowest wR (a tie within 0.01 %: the
   fewest moment parameters); it is no test that the others fit worse. A powder often cannot tell several groups apart (the direction ambiguity below):
   a group whose wR is close to the ★'s and which explains every magnetic peak is an
   equally good fit. Among those prefer the maximal group with the fewest moment
   parameters, and say which others fit as well.
3. A group that puts no moment on the chosen ions (0 moment components) cannot be it.

## Stage 3 — the moments

1. `choose_magnetic_group` builds the symmetry-allowed moment model (amplitudes over the
   allowed directions, never free Mx, My, Mz) and starts from the ranked fit.
2. `set_moment_ties` when the powder cannot separate amplitudes: one moment for co-located
   ions on a mixed site (default), equal |M| across sublattices of one element.
3. `refine_moments`, the nuclear model held. Check the result:
   - |M| at most the ionic maximum (spin-only g·S µB; g_J·J for rare earths, usually less).
     More is a red flag: the form factor, the scale, the multiplicity, or overlap.
   - Reduced moments are expected and meaningful (covalency, fluctuations, crystal field).
   - The magnetic peaks are fitted, and the wR gain over the nuclear-only fit is real.
   - A component that starts at exactly zero has no gradient (intensity is quadratic in
     the moment): `refine_moments` cannot move it, and `refine` (Stage 4) refuses it as
     undetermined. Hold it and say it was not tested — not that the data put it at zero.

## Stage 4 — the magnetic refinement: only the magnetic parameters free

The user's rule: the moments refine against the nuclear model as a fixed reference. The
scale, background, cell, instrument terms, positions, ADPs and occupancies stay at their
nuclear values (until Stage 5): freed, they trade with the moments, and the esds hide it.

1. `continue_magnetic_refinement` adds the moment rows (and k's free components with
   `refineK`); then `set_free` `fix` every nuclear row it left free, so only the moments
   (and k) refine. `show_magnetic_model` instead holds the moments.
2. `refine`, checking the free set is the moments alone; the Stage 3 checks;
   `assess_refinement`.
3. A residual on the nuclear lines is the nuclear model's (notes): say so, and which
   nuclear model the moments were measured against.

## Stage 5 — a last profile tweak

The peak shape was fitted before the magnetic peaks were modelled. Once the moments
converge:

1. `set_free` together the scale, background, zero and every peak-shape term (TOF
   α₀, α₁, β₀, β₁, β_q, σ₀², σ₂², σ_q²; CW U, V, W, X, Y), moments and atomic structure
   held; `refine` until wR stops moving. All of them, never a subset: a term on its bound
   is fixed alone, the rest stay free.
2. The moments once more with the scale and background (the scale trades with their
   size); quote this fit and the tweak's gain.

## What to report — and what not

- The k, the magnetic space group (BNS symbol and number) and its index, the moment per
  site with its esd, and the agreement against the nuclear-only fit.
- The powder's limits, always: in a cubic group the moment direction is not determinable
  from powder data (only |M|); in a uniaxial one only the angle to the unique axis. Do not
  report a direction the data cannot fix, and do not choose among degenerate groups by R
  factor alone.
- Domains: the group's domain count (a powder averages them). Orientation domains that
  exchange two axes (a and b of a tetragonal parent, in an orthorhombic group) leave the
  direction between them undeterminable: report the size and arrangement, not the
  in-plane direction.
- A moment's size trades with the scale and the ADPs, and a small one sits near its bound
  at 0: before you report a moment whose esd is a large part of it, sample the posterior
  (`bayesian-check`, `sample_posterior` with the moments, the scale and the B's free) and
  quote its credible interval.
- The run ends with `write_report` after Stage 5, open issues or not (they go in it; next
  steps come after it): the engine's magnetic section and Bayesian check;
  your account adds the powder's limits in words.

## Tools

| Step | In the app | Over MCP |
|------|------------|----------|
| The step's state | `magnetic_state` | — |
| Residual peaks | `magnetic_state`, `find_unexplained_peaks` | `find_unexplained_peaks` |
| k | `search_propagation_vector`, `set_propagation_vector` | `search_propagation_vector` |
| Ions | `select_magnetic_ions` | `build_magnetic_model` (`ionLabels`) |
| Groups | `magnetic_state`, `rank_magnetic_groups`, `choose_magnetic_group` | `list_magnetic_subgroups`, `allowed_moments` |
| Moments | `set_moment_ties`, `refine_moments` | `build_magnetic_model`, `refine_magnetic_powder` |
| Magnetic refinement | `continue_magnetic_refinement`, `set_free` (fix the rest), then `refine` | `refine_magnetic_powder` (free: the moments) |

## References

Longer knowledge bases behind this method. Read one only when a question needs it.

- [`magnetic_structure_symmetry`](../../../knowledge/magnetic_structure_symmetry_knowledge.md) — magnetic scattering, k, representation analysis and magnetic space groups, allowed moments, physical moments, the powder's direction ambiguity, nuclear–magnetic overlap, and the non-negotiable rules.
- [`refinement_fitting_algorithms`](../../../knowledge/refinement_fitting_algorithms_knowledge.md) — the least-squares engine: correlations and the SVD, restraints, esds and the GoF.
- [`magnetic_notes`](./notes.md) — the reasoning behind the k = 0 high-angle window and the moments-only refinement, with the case that set them.

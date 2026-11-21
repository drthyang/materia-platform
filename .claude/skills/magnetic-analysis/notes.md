# Magnetic analysis — the reasoning behind the rules

The method (SKILL.md) states each rule; this note keeps the longer reasoning and the case
behind it, for when a question needs them.

## The nuclear model at k = 0 (before Stage 1, step 3)

With k = 0 the magnetic intensity sits on the nuclear reflections. A nuclear model refined
on the whole ordered pattern takes that intensity into its scale (above all), and moments
measured against it come out too small. Refining the nuclear model at high angle, where the
magnetic form factor has faded (d ≤ 1.5 Å for 3d ions), keeps the scale clean; the moments
are then fitted over the whole pattern with that model fixed. The window must keep enough
reflections, and the peak widths refined in it must still fit the low-angle lines: a window
too narrow (about 1.3 Å for a 3d ion) extrapolates them badly.

- A simulated monoclinic Mn compound at k = 0: a whole-pattern nuclear scale left the
  moments 30–55 % small (moments-only wR 8.1 %); the nuclear model refined at d ≤ 1.5 Å
  brought them within 0.2–0.3 µB of the truth (wR 5.2 %). At d ≤ 1.3 Å the widths no longer
  fitted the low-angle lines (wR 19.5 %).

## Magnetic intensity as strong as the nuclear (before Stage 1, step 1)

The magnetic signal is usually orders of magnitude weaker than the nuclear, but large
moments (Tb-based compounds, for one) can put k = 0 magnetic peaks as strong as the nuclear
ones. The app flags it with `find_unexplained_peaks`' `k0Magnetic`: on neutron data the
misfits sit on nuclear reflections at large d, the sample below its ordering temperature.
A nuclear model refined alone then takes up the magnetic intensity: a simulated k = 0 test
gave B 3–6× too large and the scale ×1.5, at a "good" GoF of 2.1.

## A magnetic line the maximal group leaves (Stage 2)

Neutrons see the moment component perpendicular to Q. Cr₂WO₆ at 4 K: the maximal
P4₂'/m'nm', moments along c, left 0 0 1 at 32σ; the in-plane groups of index 4 took wR from
18.9 to 12 %.

## The moments in rounds with the scale and the background (Stage 3)

A nuclear-only fit takes the magnetic intensity it does not model into its background and
scale: at k ≠ 0 the satellites between its lines, at k = 0 the intensity on them. One
moments fit against those two rows reads low, and its esd does not show it.
`refine_moments` therefore alternates: the moments, then the scale and the background,
each with the other held, until the moments stop moving. That is the answer a fit of the
three together gives, reached without a step that frees a moment with a nuclear row. Its
esds carry the two rows' uncertainty.

- A synthetic MnWO₄ at k = (½ 0 0), true moment 4.2 µB: one moments fit after the
  nuclear-only fit read 4.06 (ten esds low); the rounds read 4.20 in four rounds, with an
  esd equal to the scatter over repeated noise.
- The ranking still fits each group once (it compares groups), so a ranked moment reads
  1–3 % low until `refine_moments`.
- Over MCP there is no `refine_moments`: alternate `refine_magnetic_powder` by hand, the
  moments free, then the scale and the background free with the moments held, until the
  moments move by less than 0.1 esd, and end on the moments.

## Only the magnetic parameters in the magnetic refinement (Stage 4)

The nuclear model is settled first so that it is the fixed reference the moments are
measured against. Freed again, the scale, the ADPs and the positions trade with the
moments (for k = 0 they share every reflection) and the esds hide it. A residual left on
the nuclear lines after the moments converge belongs to the nuclear model, not to the
magnetic one: it is not a reason to free the nuclear model here. A dataset above the
ordering temperature, or the high-angle window, gives the cleanest reference; say which
one the moments were measured against.

## A last profile tweak (Stage 5)

The peak shape is refined in the nuclear stages, before the magnetic peaks are modelled,
so it was fitted to a pattern missing some of its intensity. Once the moments converge,
refining the profile again, with the moments and the atomic structure held, lets it fit the
whole pattern, with the scale (which trades with the moments' size) and the background;
the moments then refine once more against it, alone. The pass and that last refinement
are one more round of Stage 3's rounds, with the peak shape in the step between. The
atomic structure stays held: this tweaks the instrument's description, not the model the
moments were measured against. So the moments should end within their esds across it:
where the first pass moves one further, the pass and the moments are run once more, and a
move that does not shrink says the peak shape trades with the magnetic model.

- The synthetic MnWO₄ above, its peak width left 1 % too wide by the nuclear-only fit:
  across the pass a one-component moment moved by 0.04 esd and the two components of an
  in-plane moment by 0.3 esd each, onto the values a fit of everything together gives.
- A simulated k = 0 pattern (three sites, six amplitudes, the peak shape never refined
  with the magnetic intensity in the model): the first pass moved a moment by 1.7 esd,
  the second by 0.4, and every amplitude ended within 1 esd of the simulated value
  (|M| 2.52, 2.82, 2.52 µB for a true 2.53, 2.83, 2.53).

- A k ≠ 0 POWGEN TOF dataset: after the moments-only refinement, the scale, background,
  every TOF α, β, σ term and the zero refined together cut wR by about an eighth (GoF too),
  the moments moving within their esds. Staged around the profile's correlations (α₁ ↔ β₀
  and β₀ ↔ zero both above 0.99) the same terms gained only a fifth as much: they describe
  one peak and must move together.

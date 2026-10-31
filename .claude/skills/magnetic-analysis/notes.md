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
whole pattern; the moments then refine once more against it, with the scale (which trades
with their size) and the background. The atomic structure stays held: this tweaks the
instrument's description, not the model the moments were measured against.

- AWO₄ (a high-entropy wolframite) at 8 K on POWGEN, k = (½ 0 0), P2/c′: after the
  moments-only refinement wR 9.78 %; the scale, background, every TOF α, β, σ term and the
  zero refined together reached 8.57 % (GoF 12.6 → 11.0), the moments moving within their
  esds (|M| 2.48 → 2.54 µB). Staged around the profile's correlations (α₁ ↔ β₀ 0.997,
  β₀ ↔ zero 0.995) the same terms reached only 9.53 %: they describe one peak and must move
  together.

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

## Only the magnetic parameters in the magnetic refinement (Stage 4)

The nuclear model is settled first so that it is the fixed reference the moments are
measured against. Freed again, the scale, the ADPs and the positions trade with the
moments (for k = 0 they share every reflection) and the esds hide it. A residual left on
the nuclear lines after the moments converge belongs to the nuclear model, not to the
magnetic one: it is not a reason to free the nuclear model here. A dataset above the
ordering temperature, or the high-angle window, gives the cleanest reference; say which
one the moments were measured against.

# A magnetic CIF on the powder page: a chip, held rows, and a k-search it cannot fool

Branch `claude/thy-45-mcif-magnetic`, 2026-10-31. Linear THY-45.

## What was wrong

Loading an mCIF on the powder page drew nuclear and magnetic ticks and put
the moments into the calculated pattern. But:

1. the moments had no rows: nothing showed what was in the calculation, and
   nothing could refine it;
2. nothing removed the model (only the magnetic page's Show toggle, which the
   user had not used);
3. the k-search and the Agent's peak readings took the magnetic peaks as
   explained. The residual was taken against nuclear + model, so the model's
   peaks left nothing to search. The judgment tools (`powderResidual`) listed
   every satellite G ± k of the model's k as a line of the model, whether or
   not its moments put intensity there. A model with zero moments turned real
   magnetic peaks into "misfits".

Loading data after the mCIF also dropped any moment rows. The model stayed in
the calculation with nothing on the page to show it.

## What changed

- **Chip.** The Structure card shows "magnetic · k = (…) · group" for the
  applied model, whether it came from an mCIF or from the magnetic page's Show
  or Continue. Its × does what the magnetic page's "remove" does: the model,
  its ticks, its share of the calculated pattern and its rows go, recorded as
  a History step that can be undone. On coarse pointers the × gets a 44 px hit
  area that overhangs the chip instead of growing it (`.wb-chip-x`); the phase
  chips' × get the same.
- **Rows.** `fileMomentRows` builds the mCIF's moments as the magnetic page's
  moment model does: the symmetry modes its own magnetic group allows on each
  site, with amplitudes fitted to the file's moments (`fitAmplitudesToMoments`;
  exact to 1e-3 µB, or no rows). Every row is held: the owner's rule is that
  moments refine with the nuclear model held. `withPattern` keeps the
  magnetic rows, held, instead of dropping them.
- **What explains a peak.** `core/magnetic/magneticLines.ts` lists the
  satellites with |F_M⊥|² > 10⁻⁴ of the strongest at the model's current
  moments. The plot's magnetic tick row and `powderResidual` both use it, so a
  magnetic line explains a residual peak only where the calculation has
  magnetic intensity. The Agent's state carries the model at the rows' current
  values (`liveMagnetic`). Satellite labels read "0 0 1 + k", as before.
- **k-search from the nuclear-only residual.** With a model applied, the
  magnetic step shows its k and group. A check box, "search the nuclear-only
  residual", reads the peak table from the residual against the nuclear
  calculation alone, which checks the model's k as if it were removed; the
  model stays on the page. The Agent gets `appliedModel` in magnetic_state, a
  `next` hint, and `nuclearOnly` on search_propagation_vector.

## Evidence

`src/app/mcifMagneticModel.test.ts` uses a synthetic mCIF written for the
test (`src/testSupport/syntheticMcif.ts`: a body-centred antiferromagnet, its
magnetic peaks on the h + k + l odd positions the nuclear lattice forbids),
with data simulated from it at 3 µB.

- Load: the chip's summary (k (0 0 0), P_S-1), three momentMode rows in the
  Magnetic group, all held, reproducing 3 µB along c, and the magnetic ticks.
  The Structure card renders the chip and its remove button.
- Remove: no chip, no magnetic rows or bindings, no ticks; the calculated
  pattern equals the nuclear one; the nuclear rows are untouched.
- k-search with the model removed: at least 3 peaks included, none taken as
  nuclear, k = (0 0 0) explains all of them.
- Model loaded: no residual peaks against nuclear + model. `nuclearOnly`
  finds k = (0 0 0), all peaks matched.
- Model with its moment row at 0: the calculation is nuclear only, the step
  finds k, and `find_unexplained_peaks` reads the peaks as unexplained. Before
  this change they were "misfits on … magnetic h k l".

`src/agent/magneticResidual.test.ts` now asserts that a model with no moments
leaves the Cr₂WO₆ satellite 0 0 1 + k unexplained, while a model of a
magnetic group of k with intensity there reads it as that line's misfit.

## What users and the validation see differently

- The chip and the held Magnetic rows after an mCIF load.
- New data after an mCIF or a Continue keeps the moment rows, held. They used
  to be dropped.
- The magnetic step's applied-model banner and nuclear-only switch.
- The Agent's model-visible text: the search_propagation_vector description
  and its `nuclearOnly` input (model-text snapshots re-baselined),
  magnetic_state's `appliedModel` and `next`, one sentence in the
  magnetic-analysis skill, and fewer magnetic "misfits" from a model with
  zero moments.

## What is left

- An mCIF of a k ≠ 0 structure is still loaded in its magnetic cell, so its k
  reads (0 0 0) against that cell. Recovering the parent cell and k from
  `_parent_space_group.child_transform_Pp_abc` would let the chip show the
  parent k.
- On a view-only TOF page (GSAS-II overlay), the magnetic term is not in the
  plotted calculation, but the judgment tools still count the model's lines.

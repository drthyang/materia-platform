# An incommensurate mCIF states k in the standard tag

An incommensurate magnetic structure has no finite magnetic cell, so its mCIF
is written in the parent cell with the Fourier amplitudes (cosine in the moment
loop, sine in a comment block). Its propagation vector k was only in a comment
(`# propagation vector k = (...)`), which no reader acts on. The commensurate
supercell files already carry k in the BCS-style `_parent_propagation_vector`
loop. The owner approved writing k the same way for the incommensurate file
(2026-11-24).

## What changed, and why

- **`src/core/export/cif.ts`, `incommensurateProvenance`.** The parent-cell file
  of an incommensurate k now has, after `_pd_phase_name`, the parent group
  (`_parent_space_group.name_H-M_alt`, and `_parent_space_group.IT_number` when
  the structure knows it) and the loop

  ```
  _parent_space_group.name_H-M_alt  "P 63/m m c"
  loop_
    _parent_propagation_vector.id
    _parent_propagation_vector.kxkykz
    k1 [0 0 0.3183098861837907]
  ```

  The H-M line moved here from above the operation loop, so it is written once.
  No `child_transform_Pp_abc`: the cell written is the parent cell.
- **Digits.** A component is written as JavaScript's shortest decimal that reads
  back as the same double (at most 17 significant digits; 16–17 for a generic
  irrational value), in fixed notation (no exponent, so a CIF reader takes it as
  a number), and an integer as an integer. The supercell path's fractions
  (`1/2`, 4 decimals otherwise) are unchanged.
- **Kept.** The comments that say the file is not a (3+1)D superspace
  description and that the sine amplitudes are in the comment block stay as
  they were. No superspace or Fourier tags are written: incommensurate magnetic
  structures are the owner's later stage 3.

## Evidence

- **Only incommensurate files change.** Every candidate of each case was written
  before and after: Mn₃Ga k = 0 (102), k = (0 0 ½) (22), k = (0 0 ¼) (22); MnO
  k = (½ ½ ½) (22); MnWO₄ k = (½ 0 0) (11) and k = 0 (11): all byte-identical.
  Mn₃Ga at k = (0 0 1/π) (22 files): each differs only by the provenance block
  and the moved H-M line.
- **New test** `src/core/export/mcifIncommensurateK.test.ts`: for three
  irrational k (one with a component of 1.234 × 10⁻⁷) the file holds the loop
  and the parent group once, no child transform and no superspace tags, the old
  comments, and each component read back from the loop equals the written
  double exactly.

## What the reader does with it

- MATERIA's `parseMagneticCif` does **not** read `_parent_propagation_vector`:
  every mCIF it reads gets k = 0. For a supercell file that is right (the file
  is the magnetic cell); for an incommensurate file it is not, and the sine
  amplitudes in the comments are not read either. The new test records this
  limit. Teaching the reader k would change what the app does with a loaded
  incommensurate model (satellites, the modulation), so it is left for the owner.
- MATERIA's CIF tokenizer reads CIF 1.1 and splits the BCS value `[kx ky kz]`
  at its spaces (into two rows of the loop). This holds for the supercell
  files too; the test joins the tokens back.

## What changes for users

An exported incommensurate mCIF names k in a tag Bilbao-style readers know.
Nothing else in the file, the app or the Copilot changes.

## Left open

- A k with an incommensurate component and a commensurate one (MnWO₄'s
  AF2 k = (−0.214, ½, 0.457)) is classified incommensurate but still takes the
  supercell path (an a,2b,c cell, k written to 4 decimals): unchanged here, for
  the owner.
- Reading k (and the sine amplitudes) back in `parseMagneticCif`.

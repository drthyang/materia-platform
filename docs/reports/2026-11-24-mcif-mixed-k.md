# An mCIF of a mixed k is written in the parent cell

A propagation vector with one incommensurate component, such as MnWO₄'s AF2
k = (−0.214, ½, 0.457), has no finite magnetic cell. The mCIF exporter wrote it
as a commensurate supercell: an a,2b,c cell in a group named "P_bc", the
modulation sampled at one point, and k rounded to 4 decimals
(`k1 [-0.2140 1/2 0.4570]`). The owner decided (2026-11-24) that any k with an
incommensurate component is written like a fully incommensurate k (#183).

## Cause

`magneticStructureToMcif` (`src/core/export/cif.ts`) called
`expandMagneticSupercell` first and took the supercell path whenever it returned
a box. That box is sized per component by `magneticSupercell`
(`src/core/crystal/cellExpansion.ts:177`), which gives 1 for an incommensurate
component and 2 for the ½: so (−0.214, ½, 0.457) got a 1×2×1 box. The
classification, `classifyPropagation`, already calls this k incommensurate
(`kDenominators` is null when any component has no denominator), but the export
only consulted it after the supercell decision.

## Fix

The export classifies k first and asks for a supercell only when the class is
not incommensurate. Nothing else changed: not the classification, not
`magneticSupercell`/`expandMagneticSupercell` (the viewer and the refinement
keep their behaviour), not the reader.

The MnWO₄ file now begins (blank lines between the comments omitted)

```
# propagation vector k = (-0.214, 0.5, 0.457) — incommensurate (no finite supercell; two arms ±k, complex coefficients)
# Incommensurate k: no finite magnetic supercell exists, so the parent cell is written with
# the Fourier modulation amplitudes; a (3+1)D magnetic-superspace description is not emitted.

data_MnO4W
_pd_phase_name  'MnO4W'

_parent_space_group.name_H-M_alt  "P 2/c"
_parent_space_group.IT_number     13
loop_
  _parent_propagation_vector.id
  _parent_propagation_vector.kxkykz
  k1 [-0.214 0.5 0.457]

_cell_length_a    4.83000
_cell_length_b    5.76030
```

with the cosine amplitudes in the moment loop and the sine amplitudes in the
comment block, as for any incommensurate k. No superspace or Fourier tags.

## Evidence

- **Only mixed-k files change.** Every subgroup candidate of each case, plus one
  hand-made model with cosine and sine amplitudes, was written before and after
  the fix: Mn₃Ga k = 0 (103 files), k = (0 0 ½) (23), (0 0 ¼) (23), (0 0 1/π)
  (23); MnO k = (½ ½ ½) (23); MnWO₄ k = 0 (12) and (½ 0 0) (12). All 219 are
  byte-identical. The 4 MnWO₄ files at k = (−0.214, ½, 0.457) change.
- **New tests** in `src/core/export/mcifIncommensurateK.test.ts`: MnWO₄ at the
  mixed k, for the hand-made model and every subgroup candidate, writes the
  parent cell (b = 5.76030 Å), the parent group, k read back from the loop equal
  to the written double, no child transform, no "P_bc", no BNS name, no
  centring loop, no superspace tags, and the existing comments; the cosine and
  sine amplitudes land where they should. Both tests fail before the fix. The
  #183 tests for a fully incommensurate k pass unchanged.
- **The "For a MOTIF figure…" help.** The Powder and PDF pages set
  `incommensurate` from `momentModelPropagation(…).kind === "incommensurate"`,
  which is `classifyPropagation`: a mixed k is incommensurate there, so the "?"
  line ("the modulation is left out: k is incommensurate, so the parent cell
  holds the cosine amplitudes") is shown and is now true for it. A test pins the
  condition for the MnWO₄ k.

## Known limit (unchanged)

MATERIA's mCIF reader does not read `_parent_propagation_vector`: it loads such
a file as k = 0. Listed in `docs/LIMITATIONS.md`, until incommensurate
structures are supported.

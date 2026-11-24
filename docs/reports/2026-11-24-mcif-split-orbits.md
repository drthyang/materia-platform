# A k = 0 mCIF lists every orbit the magnetic group splits

A cross-check on 2026-11-24 had MOTIF read MATERIA's mCIF exports and compared
the atoms it builds with MATERIA's own expansion. At k = 0 the file left atoms
out whenever the magnetic group splits a parent orbit and the split orbit
carries no moment: on Mn₃Ga, 23 of the 99 k = 0 magnetic groups lost one Ga or
two Mn of the 8 atoms in the cell. MATERIA's own 3D view was right (it expands
with the parent operations); every reader that expands the file by the file's
own operations (MOTIF, FullProf, VESTA, ISOCIF, and MATERIA's own mCIF reader)
was wrong.

## What changed, and why

- **The cause** (`src/core/export/cif.ts`, `withOrbitSites`, called from the
  k = 0 path of `magneticStructureToMcif`). A k = 0 file is the parent cell in
  the magnetic group's operations. That group can split a parent orbit into
  several orbits; each one needs its own atom-site row, because the reader
  only rebuilds the orbits of the rows it gets. `withOrbitSites` walked the
  moment entries and added a row (`<label>_oN`) only for a split orbit that has
  a moment entry. A split orbit with no entry got no row: a non-magnetic atom
  (Ga in Mn₃Ga; W and O in MnWO₄) or a magnetic orbit whose moment the group
  forbids (`buildMagneticModel` makes no entry for it).
- **The fix.** After the moment-carrying rows, written exactly as before and in
  the same order, every site's split orbits that still have no row get one:
  label `<label>_oN`, at the orbit position the viewer and the model use
  (`magneticOrbitRepresentatives`), with the site's element, occupancy and
  ADP. A moment-free orbit has **no** `_atom_site_moment` row. That is the
  magCIF convention (an atom absent from the moment loop carries no moment, as
  in Bilbao's MAGNDATA files), and MATERIA's reader and MOTIF both read it as
  "no moment".
- **The ADP of an orbit row** (its own commit). An orbit row copied the site's
  anisotropic U unrotated, so a reader gave the wrong ellipsoid at every orbit
  member reached through a rotation. This held for the existing
  moment-carrying rows too. Each orbit row now carries U′ = R·U·Rᵀ for the
  parent operation that takes the site there, the tensor the app's own
  expansion gives that atom. Isotropic sites are unchanged. Kept as a separate
  commit so it can be split off.

The commensurate k ≠ 0 path (the magnetic supercell) does not use
`withOrbitSites` and is not changed.

## Evidence

The new test, `src/core/export/mcifSplitOrbits.test.ts`, writes the file with
the real exporter, reads it back with `parseMagneticCif`, expands it by the
file's operations, and compares every atom (element, label, position,
occupancy, ADP) and every moment with MATERIA's expansion of the model (parent
operations, the 3D view's spin field), at the file's printed precision.

| Case | On main (e0d5a79) | After |
| --- | --- | --- |
| Mn₃Ga, Ga exactly at (⅓, ⅔, ¾), all 102 k = 0 candidates (the 99 with a Mn moment and 3 that forbid it) | 24 fail (23 with a moment + 1 without): Ga or 2–3 Mn missing | all pass |
| MnWO₄ (published, P2/c), all 11 k = 0 candidates | 7 fail: W and 4–5 O missing | all pass |
| Mn₃Ga, anisotropic ADPs (site-symmetric tensors) | fails (missing atoms and unrotated tensors) | all pass |
| MnWO₄, anisotropic ADPs | fails (missing atoms and unrotated tensors) | all pass |
| A moment-free split orbit gets a row and no moment row | fails | passes |

With the first commit only, the two anisotropic tests still fail, on the
unrotated tensors: 5 of 11 MnWO₄ groups (O1, O2) and 62 Mn rows across the
Mn₃Ga groups (the moment-carrying `Mn1_oN` rows that existed before).

The sweep includes both halves of the bug, asserted in the test: a split
non-magnetic orbit (Ga1, and W1 with O1 in MnWO₄) and a Mn orbit split into a
moment-carrying and a moment-forbidden part (Mn₃Ga #37, #39, #79 of the
candidate list).

**MOTIF's reader** (the cross-check harness, run against this branch; MOTIF at
88de732, read-only): all 99 Mn₃Ga (exact Ga) k = 0 groups pass, each with 8
atoms; largest position difference 3.1 × 10⁻⁵ Å, largest moment difference
7.7 × 10⁻⁵ µB. On main 23 of the 99 failed. In the same run the groups on the
bundled Mn₃Ga CIF (Ga at 0.3333, 0.6667) lose no atom any more; 54 still
exceed the position tolerance by the 0.0005 Å of that rounding, the separate
known effect. Every other case of the harness is as before.

**k ≠ 0 is byte-identical.** 77 supercell files (MnO k = (½ ½ ½), MnWO₄
k = (½ 0 0), Mn₃Ga k = (0 0 ½) and (0 0 ¼), every candidate of each) were
dumped before and after: identical.

## What changes for users

- A k = 0 mCIF of a group that splits an orbit has more atom-site rows (`Ga1_o2`,
  `Mn1_o2`, …): 24 of 102 Mn₃Ga groups and 7 of 11 MnWO₄ groups. Files of a
  group that splits nothing, or splits only moment-carrying orbits, are byte
  for byte as before (78 of 102 and 4 of 11 in the dump).
- **The incommensurate path changes too.** A parent-cell mCIF for an
  incommensurate k is written by the same code, in the model's operations,
  and lost the same atoms: 6 of 22 Mn₃Ga candidates at k = (0 0 0.2317) now
  gain a `Ga1_o2` row. MnWO₄ at an incommensurate k is unchanged.
- An anisotropic site on a split orbit now has its tensor rotated in the
  orbit row.
- Nothing the Copilot's model reads changed: the mCIF writer feeds downloads
  and the PDF export bundle only; no tool description, skill, prompt or model
  text snapshot moved.

## What changes outside the new tests

No test, golden, snapshot or fixture changes or needed updating. One existing
test writes a file that now has an extra row; its assertions do not look at
it (`cif.test.ts`, "writes the model's subgroup ops and split-orbit sites for
an in-app model", a synthetic P-1′ subgroup of a 4-operation parent):

```diff
   Fe1_o2 Fe 0.50000 0.50000 0.50000 1.0000 Uiso 0.00633
+  O1_o2 O 0.66670 0.33330 0.25000 0.8000 Uani 0.01022
 …
   O1 0.01000 0.01200 0.00800 0.00500 0.00000 0.00000
+  O1_o2 0.01000 0.01200 0.00800 0.00500 0.00000 0.00000
```

The published example `examples/mn3ga-350k/Mn3Ga_350K_workbench_refined.mcif`
is already written in its own orthohexagonal cell with every orbit listed; it
is not affected.

## What it means for the validation

No pinned result moves: the change is in the file writer, not in any
calculation.

## Not done

- **Your decision:** the incommensurate parent-cell file is fixed by the same
  change (it had the same missing atoms). If you want this pull request to
  touch k = 0 only, a one-line guard keeps the old behaviour there.
- **Your decision:** the ADP rotation is its own commit; it also changes the
  rows that existed before (moment-carrying orbits of anisotropic sites).
- The bundled Mn₃Ga CIF's Ga at 0.3333, 0.6667 (0.0005 Å from ⅓, ⅔) is a
  separate rounding effect, not touched.

## Checks

At the branch head: `tsc -b --noEmit` and `eslint` on the changed files
clean; `npm test` 419 files passed, 37 skipped (3746 tests passed). With
`MATERIA_DATA_DIR` set: the one known failure on main,
`localHexMagneticGolden`, and two wall-clock limits in `realPowderXRD` under
the full suite's load (18.3 s and 22.9 s against 15 s and 20 s); that file
passes on its own (4 of 4).

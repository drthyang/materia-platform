# A magnetic benchmark on unpublished data, checked against the owner's reference

Pull request [#102](https://github.com/drthyang/materia-platform/pull/102),
branches `claude/awo4-benchmark` (`356a6b5`) and `claude/awo4-reference`
(`b10c97e`, `12ccbcd`, `054e3d3`), merged into `claude/materia-backlog`,
2026-10-24. Backlog item M5: the owner's AWO₄ 8 K POWGEN data as a benchmark
of the app's magnetic refinement, followed by a check against the owner's own
magnetic refinement of the same data.

The data, the 100 K CIF beyond what the repository already holds, and the
reference magnetic structure are unpublished. They stay in the git-ignored
`data/` folder. This report, the test file and the documents carry no
number derived from them; the test prints its numbers to the local run only.

## What changed

| Change | Where |
| --- | --- |
| A data-gated benchmark that runs the app's own pipeline. It loads the data through the MCP loaders and refines the nuclear structure with the staged driver. Then come the magnetic page's own steps: residual peaks, k-search, candidate groups, ranking, ★ and within-noise. A joint nuclear + magnetic fit and `find_unexplained_peaks` follow. The file holds criteria only. Without `data/` every test skips, so CI and the public build are unaffected | `core/workflow/realAwo4Benchmark.test.ts` (new) |
| A block against the owner's reference, read at runtime through the app's `parse_structure`: a complete read, the same basis and origin, the shared site treated alike, the same k, the same magnetic group operation by operation, the moment's direction and \|M\| per ion within 2σ combined | same |
| **The one production change:** magCIF tags are matched with dots read as underscores, so the older spellings Jana2006 writes (`_space_group_symop.magn_operation_xyz`, `_space_group_symop.magn_centering_xyz`, `_atom_site_moment_label`, `_atom_site_moment_crystalaxis_x`) read like the DDLm ones | `parsers/cif.ts` `magTag` |
| A Mantid `XYDATA` export is read as x y σ with its TOF unit from the `#` header. This needed no parser change; it is now covered by a synthetic case | `parsers/detectFormat.test.ts` |
| VALIDATION has the benchmark's row. LIMITATIONS covers the `XYDATA` reading and the older magCIF spellings | `docs/` |

## Evidence

- **The instrument file.** The file's abscissa is the focused TOF (difC·d),
  not raw flight time, so the frame has to be inferred. Of the three frame
  calibrations, only one puts the data's first point at its short-d edge
  (λ_min/2). The others would mean the reduction had thrown away valid data
  that hold Bragg peaks. Peak positions agree with that choice but cannot
  pick the frame on their own.
- **The benchmark's criteria**, each written with its reason before the code
  ran. Met: the format and the frame; β and the volume against the 100 K CIF
  within thermal-contraction bounds; k from the nuclear residual alone,
  ranked first with a clear margin; the ★ group maximal and allowing a moment
  on the ions; \|M\| within the spin-only bound and well determined; wR
  falling from nuclear to moments-only to joint; each k-search peak's
  residual at least halved; finite esds and convergence. Not met, kept as
  stated and encoded as `it.fails` so the test turns red when one starts to
  pass: one cell length against the 100 K CIF, the positions against the
  100 K CIF, ADPs at their bound, one unexplained line, and a GoF above the
  method's acceptance bar.
- **The reference.** Before the fix, the owner's mCIF read as no magnetic
  model, without an error, and its symmetry came from its H-M symbol instead
  of its listed operators. After the fix it reads completely. The app agrees with the reference on k, on the
  magnetic group (identical operator sets, time reversal included, in a
  common basis and origin, while the other maximal candidates differ), on the
  moment's direction and on \|M\| per ion within the stated tolerance. For
  k ≠ 0 the BNS number the app shows next to a candidate names the
  parent-cell group, as MAGNETIC_SYMMETRY.md documents, which is why the
  comparison is by operations, not labels.
- **The owner's corrections, folded in.**
  - The cell in the mCIF may not be accurate, so the reference is used for
    the magnetic content only. The cell is compared only with the 100 K CIF,
    within thermal bounds, and the reference's moment components are read in
    the app's own refined 8 K metric.
  - A misprinted esd in the reference was corrected in the local copy only.
  - The reference's ⟨j0⟩ ions are intended. The like-for-like fit takes them
    from its own atom-type loop, through the sites' oxidation states (an
    existing path, no code change). With the app's default ions, \|M\| falls
    outside the tolerance, and most of that difference is the form factor.
- **The unexplained line.** A scratch fit with the sample can's metal as a
  second phase, at its low-temperature cell, does not explain it, and that
  phase's other lines cap its scale. `identify_peaks` offers the can for this
  line through its ±1.5 % d-scale search, which is a false lead here. Only a
  comment records this in the benchmark.
- **Tests.** `cif.test.ts` gains a synthetic Jana-spelled mCIF whose listed
  operators differ from its symbol's. It fails without the fix. The benchmark has 23 tests: all pass on the local data, and the five
  `it.fails` fail by their assertions, not by errors.

## What changes for users

An mCIF in the older spellings (Jana2006) now opens as a magnetic structure,
with its listed operators and moments. Before, it opened as a nuclear
structure with the symbol's symmetry, missing atoms and no moments, and no
warning. Nothing else in the app changes: the benchmark is a test.

## What it means for the validation

The benchmark runs only where the data are present. It is no validation case,
so arm A and arms B and C are unchanged. It gives the magnetic step a real
known answer, the owner's, in place of internal consistency alone.

## Not done

- The five `it.fails` stay as stated. The reference gives no other target
  for them: its positions and occupancies are the 100 K ones, it refines one
  shared ADP, it has no R values, and its cell cannot index the unexplained
  line either.
- Questions for the owner: which calibration the 100 K refinement used;
  whether the 100 K positions are expected to hold at 8 K; what the
  unexplained line is; whether `identify_peaks`' d-scale search should be
  narrower for a part at the sample's temperature (no change made: the
  evidence gives no value).
- The type-IV BNS labels for k ≠ 0 are still not tabulated
  (LIMITATIONS).

## Checks

At `356a6b5`: typecheck and lint clean, `npm test` 2512 tests, 253 skipped.
At `054e3d3`: the benchmark and `cif.test.ts` 65 passed, 7 skipped, typecheck
clean. That branch's full suite had one failure, `heldOut.test.ts`, already
failing on its base and fixed on the backlog by `5d2310f` (see
[the skill edits](./2026-10-24-skill-edits.md)). At the backlog's merged head
(`23c1d88`): 2638 tests, 253 skipped, with the benchmark run on the local
data.

# Generic names for the unpublished AWO₄ data

Branch `claude/generic-data-names`, from `main`, 2026-10-24. The owner's
decision: the public files refer to the owner's unpublished AWO₄ data by
generic names only.

## What was wrong

- **The public files named the measurement.** Tests, a demo module, a code
  comment and a VALIDATION row gave the POWGEN run numbers, the original data
  file names and the instrument calibration and frame names of the owner's
  unpublished AWO₄ data. The data stay in the git-ignored `data/`; their
  names did not.
- **Two folders for one dataset.** The 100 K view-only test read its own
  folder, with its own file names, for the same sample, structure and bank-3
  calibration the other AWO₄ tests read from `data/AWO4/`.
- **One criterion read a number from a file name.** The benchmark's frame
  check (C2) took each bank's centre wavelength from its calibration file's
  name.

## What changed

| Change | Where |
| --- | --- |
| One flat layout, `data/AWO4/`, with generic names: `powder_<T>.dat` / `powder_<T>.gsa` for the bank-3 patterns, `powder_bank1.gsa` and `powder_bank2.gsa`, `structure_100K.cif`, `magnetic_8K.mcif`, `instrument_bank<N>.instprm`, `instrument_bank3_jana.instprm`, `pdf.gr`. "AWO4" stays: the compound class is public in the bundled `highEntropyWO4.ts` and the docs | `realAwo4Benchmark.test.ts`, `realAwo4Magnetic.test.ts`, `realAwo4Tof.test.ts`, `realPowderTOF.test.ts`, `awo4MagneticSolve.test.ts`, `examples/awo4Magnetic.ts` |
| The 100 K view-only test reads `data/AWO4/` like the others | `realPowderTOF.test.ts` |
| C2 takes each bank's centre wavelength from a table in the test, not from the file name. The criterion and its bounds are unchanged | `realAwo4Benchmark.test.ts` |
| The `awo4-user-flow` eval takes `powder_6K.gsa` (the ordered pattern) before any other histogram, and finds the bank's calibration as `instrument_bank<N>` as well as the old `B<N>` | `agent/evals/pages.ts` |
| The demo's pattern name, the comments and the VALIDATION row describe the data ("the 8 K bank-3 POWGEN pattern") instead of naming the run, frame or calibration | `awo4Magnetic.ts`, `highEntropyWO4.ts`, `docs/VALIDATION.md` |
| The file-name hint's test uses made-up run numbers | `app/powgenBackground.test.ts` |
| The layout, with what each file holds and which test reads it | `docs/VALIDATION.md`, "The AWO₄ data folder" |

## Evidence

- **The benchmark, before and after, on the same data.** Run once on `main`
  with the data under their old names and once on this branch with them
  under the new names: 23 of 23 tests pass both times (C3b, C4, C5, C11 and
  C13 as `it.fails`), and every number the benchmark prints (wR, GoF, cell,
  peaks, k ranking, groups, |M|, the reference comparison) is the same, line
  for line.
- **The grep.** `git grep` for the run numbers, the original file names and
  the calibration and frame names finds no reference to the AWO₄ data. What
  it still finds is numbers inside other data files and golden arrays, and
  another sample's calibration file name.

## What changes for users

Nothing in the public build. A local copy of the AWO₄ data has to be renamed
to the layout in VALIDATION to keep its tests running; with the old names
they skip.

## What it means for the validation

No pinned result moved. The benchmark's criteria and results are unchanged.

## Not done

- The old names remain in git history and in merged pull requests' diffs.
  Removing them there would mean rewriting `main`'s history.
- The tests that need the 6 K and 100 K histograms, the bank-1 and bank-2
  histograms, the 100 K `.dat`, the JANA calibration or the demo's solution
  skipped before and after: those files were not on this machine.

## Checks

`npm run lint`, `npm run typecheck`, `npm run build` and `npm test` at the
branch's head.

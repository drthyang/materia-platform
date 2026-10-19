# A phase added or taken out keeps the other phases' rows

Branch `claude/elegant-dirac-97cti4`, on `main`, 2026-10-19. The finding left
by [#75](https://github.com/drthyang/web-refinement/pull/75) (its report's
"Found on the way"): adding a phase to a fitted single-phase powder page put
the main phase's rows back at the CIF's values.

`withPhases` (`app/powderPage.ts`), which `withPhase` and `withoutPhase` call,
rebuilds the spec for the new phase list and keeps the old rows by id
(`keptRows`). A single-phase spec names the main phase's rows `scale`,
`cell_a`, `B_Mn1`, …; the multi-phase spec (`buildMultiPhaseSpec`) prefixes
every row of a phase `p{i}_`, and keeps the shared instrument rows (background,
zero, profile) under their own ids. So `p0_cell_a` found no `cell_a` and came
in at the spec's seed, its free state the spec's default, and a tie the user
made on it was lost; the background and profile survived. Taking the last
added phase out had the mirror problem.

## What changed, and why

| Change | What it answers |
| --- | --- |
| **Each phase's rows follow it to its new ids before the rows are kept by id** (`rowsForPhases` in `app/multiPhaseSpec.ts`, beside the builder that names them). `withPhases` renames the session's rows from the old phase list to the new one, phase by structure id: bare on one phase, `p{i}_` on several; the shared instrument rows and the magnetic model's keep their ids. `keptRows` then matches them as before, so every row keeps its value, free state and Reset value | Adding a phase to a fitted single-phase page reset the main phase's scale, cell, positions, ADPs and occupancies to the CIF's, and their free states to the spec's; taking the last added phase out did the same the other way |
| **A user tie reads its rows under their new ids** (`renamedTie` in `core/refinement/constraints.ts`: the references renamed, the factor and constant kept, a complement still written as one). A tie that read a row of a phase taken out is released, fixed at its value, as `withValidUserTies` releases one whose leader is gone | A tie made with `tie_parameters` on the main phase (`B_Ga1 = B_Mn1`) was dropped when its rows were renamed |
| **A phase after one taken out keeps its own rows**: the same mapping moves it from `p2_` to `p1_` | Taking out the first of two added phases gave the second the first one's values and free states: its new `p1_` ids matched the removed phase's old ones |
| **New data on a multi-phase page carry the main phase through the same mapping** (`primaryOnly` in `withPattern`) | A second copy of the `p0_x` → `x` rule |

## Evidence

- **Tests that fail on `main`** (`app/powderPage.test.ts`, "the powder page's
  phases"):
  - A fitted single-phase page (every row the spec does not tie moved off its
    seed and its free state flipped, `B_Ga1` tied to `B_Mn1`) keeps every row
    of its phase and every shared row (value, free state, tie) through
    `withPhase`, and through `withoutPhase` back to its own ids in its own
    order. On `main` it fails on the main phase's rows: `cell_a` at the CIF's
    5.42215 Å, the tie gone, the free states the spec's.
  - With two added phases, taking out the first leaves the second its own
    rows under `p1_`, and the main phase its own. On `main` the second phase
    has the first one's.
- **`renamedTie`** (`core/refinement/constraints.test.ts`): the linear,
  complement and magnitude forms renamed and read back the same; an
  expression none of whose rows is renamed comes back as written.
- **The recipe of the finding**, `mn3gaSession()` with the cell rows × 1.01,
  then `withPhase(s, { ...s.structure, id: "second", name: "second" },
  DEFAULT_INSTRUMENT)`; here the cell also fixed, `B_Mn1` free and `B_Ga1`
  tied to it. The Agent's row is the headless page's `addPhase` (what
  `add_known_phase` runs) adding CaF₂ to the same page:

  | Step | `main` | This branch |
  | --- | --- | --- |
  | The page | `cell_a` 5.4763715 fixed, `cell_c` 4.41941458 fixed, `B_Mn1` 1.12119 free, `B_Ga1` = `B_Mn1` | the same |
  | A phase added | `p0_cell_a` 5.42215 free, `p0_cell_c` 4.375658 free (the CIF's), `p0_B_Mn1` fixed, `p0_B_Ga1` 0.73430, untied | `p0_cell_a` 5.4763715 fixed, `p0_cell_c` 4.41941458 fixed, `p0_B_Mn1` free, `p0_B_Ga1` = `p0_B_Mn1` |
  | … and taken out again | `cell_a` 5.42215 free, the tie gone | as the page was |
  | CaF₂ added by the Agent | as "A phase added" | as "A phase added" |

## What changes for users

- **Add CIF…** on a fitted page keeps the main phase where the fit left it:
  its values, which rows are free, and the ties made on it; the new phase
  comes in at its CIF's values, as before. **Remove phase** keeps the rows of
  the phases that stay. Reset still returns each row to its starting value.
- **The Agent's `add_known_phase`** keeps the refined model it was called on,
  as its description says ("its scale and cell then refine with the
  others"); the Agent no longer has to refine the main phase again after it.
- No output shape changes.

## What it means for the validation

- **Arm A** never adds a phase: its pinned results do not move.
- **Arms B and C** approve `add_known_phase` in every case (`APPROVED_ASKS`);
  a run that adds a library phase after refining now carries on from its
  refined main phase, not from the CIF's. The scripted eval
  (`known-impurity`) checks that the phase is added, not the values after it,
  and passes unchanged.

## Not done

- The PDF page rebuilds its rows afresh when its phases change
  (`withExtraPhases` in `app/pdfPage.ts`, "the scale split across the
  phases"), as documented; not changed here.
- Phases are matched by structure id; two phases sharing an id are matched in
  order (the multi-phase bindings already route by id).

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2380
tests, the 3 new among them (two in `app/powderPage.test.ts`, one in
`core/refinement/constraints.test.ts`), 265 skipped (live runs and
data-dependent suites).

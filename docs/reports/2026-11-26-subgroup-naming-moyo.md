# The subgroup engine's names checked by an independent library

THY-80 item A3. Every subgroup class the engine lists for a supercell bound
(`supercellSubgroups` in `src/core/crystal/irreps/supercellLattice.ts`, named
by `nameChild` and, for a same-cell child, `identifySubgroup(…, { standard:
true })`) is identified again by moyo, a space-group finder that shares no
code or table with MATERIA. 14 273 classes over THY-80's coverage: every
number, symbol, Hall symbol and child setting agrees. No engine code changed;
this change adds tests and a dev dependency only.

## What changed, and why

- **A dev dependency, `@spglib/moyo-wasm` 0.22.2** (moyo, the Rust successor
  of spglib, compiled to WebAssembly; MIT/Apache-2.0). Tests load it with
  `initSync` from `node_modules`, offline. Nothing in the app imports it: the
  production build has no moyo code and no `.wasm` asset (checked with
  `grep -rE "moyo|analyze_cell|wbg_" dist`, no match).
- **The check** (`src/core/crystal/irreps/validation/independentNaming.ts`,
  test code). For each class representative H:
  1. A structure with exactly H's symmetry: two species, each one orbit of a
     generic point under H, in the bound's supercell T′ on a Cartesian cell of
     the parent's metric (seeded points; the seed is in every finding). moyo
     finds its space group. The operation count moyo reports is checked
     against H's, so no accidental extra symmetry passes.
  2. The engine's number against moyo's; its H-M symbol against moyo's short
     or full symbol; the Hall symbol of the engine's standard setting against
     moyo's.
  3. The engine's child basis (P_H, p_H): H's operations carried into the
     child's basis (W′ = P⁻¹WP, w′ = P⁻¹(w + Wp − p)), with T′'s translations,
     must be moyo's operation list of that number in the ITA standard setting,
     exactly, modulo ℤ³; the columns of P_H must be translations of H; and
     det P_H > 0. A method other than "direct" or "conventional-cell" counts
     as a mismatch.
  4. For a class with an enantiomorph (P4₁22/P4₃22 and the like), the mirror
     image of the structure must be the partner type the engine names.
  moyo's own transformation to its standard cell is recorded too; it may
  differ from the engine's by an element of the normaliser (another equally
  standard choice), which is why the setting is compared through the
  operations, not the matrices.
- **The tables first.** moyo's standard setting of each of the 230 types is
  MATERIA's reference setting operation for operation (origin choice 2,
  hexagonal axes, unique axis b), and the Hall symbols are the same (moyo
  writes the double-prime axis `=`, gemmi `"`). The H-M symbols are the same
  except for the five e-glide groups, below.
- **Tier 1** (`subgroupNaming.moyo.test.ts`, in `npm test`, about 10 s): the
  three table comparisons; negative controls (a wrong number, an origin ¼ off,
  a left-handed basis and a cell twice too long are each caught); every class
  of Pm-3m 1×1×1 and 1×1×2, Fm-3m, Fd-3m and R-3m 1×1×1, P6₃/mmc
  √3×√3×1, Pnma 1×1×2 and P2₁/c 2×2×2 (678 classes).
- **Tier 2** (`subgroupNaming.moyo.tier2.test.ts`, opt-in
  `MATERIA_SUBGROUP_TIER2=1`): the twelve parents of THY-80 (Pm-3m, Fm-3m,
  F-43m, Fd-3m, Im-3m, P6₃/mmc, R-3m, I4/mmm, P4/mmm, Pnma, Cmcm, P2₁/c) in
  1×1×1, 1×1×2 and 2×2×2, and P6₃/mmc in √3×√3×1; every class. A budget per
  parent (`MATERIA_SUBGROUP_TIER2_PARENT_MIN`, default 6) and a cap
  (`MATERIA_SUBGROUP_TIER2_CAP_MIN`, default and at most 30), checked between
  classes and bounds; what the time did not reach is listed, not failed.
  `MATERIA_SUBGROUP_TIER2_OUT=<file>` writes every class's result as JSON.
  A list of known mismatches is kept in the test, empty.

## Evidence

Tier 2 on this machine (Node 24), 1.7 min unloaded (4.3 min with another
test run in parallel): 14 273 classes, 0 mismatches. 615 classes named
"direct", 13 658 "conventional-cell"; 37 parent, 823 t-, 505 k- and 12 908
general subgroups; 213 different space-group types; 105 enantiomorph pairs
checked on the mirror image; the largest structure 3072 atoms.

| Parent | 1×1×1 | 1×1×2 | 2×2×2 |
| --- | ---: | ---: | ---: |
| Pm-3m | 33 | 124 | 1427 |
| Fm-3m | 238 | 689 | 2194 |
| F-43m | 56 | 152 | 437 |
| Fd-3m (origin 2) | 99 | 184 | 642 |
| Im-3m | 131 | 227 | 1306 |
| P6₃/mmc | 32 | 54 | 234 (√3×√3×1: 69) |
| R-3m (hexagonal axes) | 22 | 69 | 272 |
| I4/mmm | 118 | 214 | 1760 |
| P4/mmm | 27 | 118 | 2272 |
| Pnma | 16 | 27 | 143 |
| Cmcm | 67 | 118 | 623 |
| P2₁/c | 5 | 8 | 66 |

Classes listed and checked per (parent, bound), all of them; no bound was
refused or cut by the time limit. The engine's search and naming take most
of the time (Fd-3m 2×2×2 24 s, Fm-3m 2×2×2 21 s); moyo takes under a second
per bound.

## What changes for users

Nothing: no app, engine or model-visible text changed.

## Observation for the owner (not a mismatch)

460 of the classes are named with the pre-2002 symbol of an e-glide group:
MATERIA's table (gemmi's) writes **Abm2, Aba2, Cmca, Cmma, Ccca** (#39, 41,
64, 67, 68) where ITA A since 2002, moyo and Bilbao write **Aem2, Aea2,
Cmce, Cmme, Ccce**. Same groups, same operations; the tests count them as
equal. Bilbao's SUBGROUPS lists for Fm-3m use the new symbols, so a user
comparing the two lists sees different letters. Whether to show the new
symbol is the owner's choice.

## What it means for the validation

A new oracle row in `docs/VALIDATION.md`. Arm A's pinned results do not
move (no engine change).

## Not done

- The check names the class representative; other members of a class are
  conjugates (same type) and are not checked separately.
- Bounds with a centred supercell (`SupercellSpec` with a centring) are not in
  THY-80's list and are not covered.
- One engine call cannot be interrupted: the tier-2 budget is checked between
  classes and bounds, so a bound that starts before its deadline finishes its
  search (at most 25 s here).

## Checks

At the branch head: `npm run build` passes (no moyo in `dist`);
`npm run lint` passes; `npm test` (without `MATERIA_DATA_DIR`): 423 files
passed, 39 skipped; 3781 tests passed, 354 skipped. Without the two new
files: 460 files, 4107 tests, so +2 files and +28 tests (16 run, the 12 of
tier 2 skipped); in that baseline run one test timed out under load
(`replay.test.ts` magnetic-30k, 120 s), which passes alone and in the branch
run.

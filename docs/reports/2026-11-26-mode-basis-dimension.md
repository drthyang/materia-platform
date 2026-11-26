# The displacive mode basis's dimension checked by Wyckoff splitting

THY-80 item B2. For every subgroup class the engine lists for a supercell
bound, the displacive modes it builds for the realised child
(`supercellModeBasis` in `src/core/crystal/irreps/supercellModes.ts`) and the
refinable set the PDF page makes of them (`irrepModeSet` in
`src/core/crystal/irreps/modeSet.ts`) are counted again by methods that use
none of the engine's mode code. Over 12 858 classes of THY-80's coverage
every count agrees, the bases are orthonormal and H fixes every mode. No
engine code changed; this change adds tests only.

## What changed, and why

- **The check** (`src/core/crystal/irreps/validation/independentModeCount.ts`,
  test code; it reuses A3's moyo loader, `@spglib/moyo-wasm` 0.22.2, a dev
  dependency). Each of the twelve parents is a synthetic structure with two
  or three orbits, the atoms exactly on their Wyckoff positions (special and
  free ones; moyo confirms the parent's group and each site's ITA site
  symmetry). The bundled Mn₃Ga CIF is not used. For each class H:
  1. **The independent count (Wyckoff splitting).** The parent's atoms in the
     cell of the bound's point-group core T″, plus two marker orbits of
     generic points under H, so the structure has exactly H's symmetry (the
     operation count is checked). The cell is T″ and not the supercell T′
     because every element of F = G/T″ is an integer matrix in T″'s basis.
     moyo keeps only the operations that map the input lattice onto itself,
     so in T′ it would miss H's rotations that do not keep T′ (a 3-fold in a
     1×1×2 cell). moyo's orbits split each parent orbit into the child's
     orbits. Each child orbit's free coordinates are counted twice: from
     moyo's operations, as the dimension of the displacements its stabiliser
     fixes, (1/|S|)·Σ tr W; and from moyo's site-symmetry symbol (1 → 3,
     m → 2, a polar point group → 1, any other → 0). Their sum is the
     dimension the basis must have. H's rigid translations (its polar
     directions) are (1/|R|)·Σ tr R over moyo's distinct rotations.
  2. **Per irrep (character formula).** χ of the displacement representation
     on F, computed here from F's elements: for each element, the atoms
     modulo T″ it leaves in place times tr W. Each irrep Γ the basis lists
     must carry m_Γ·n_Γ modes, where m_Γ = ⟨χ_Γ, χ⟩/⟨χ_Γ, χ_Γ⟩ counts its
     copies and n_Γ = (1/|H|)·Σ_H χ_Γ(h) is the dimension H fixes in one copy.
     Σ m_Γ·n_Γ must equal the Wyckoff count. The irreps' characters are the
     engine's (the irreps themselves are checked elsewhere); the counts are
     not.
  3. **Orthonormality and H-invariance** of every field on the parent's atoms
     modulo T″, with an action written in the test: the Gram matrix must be
     (N_core/N_child cell)·I, and D(h)u = u for every h ∈ H.
  4. **The gauge.** `supercellModeBasis` keeps the rigid translations: one
     mode per free coordinate. `irrepModeSet`, the set the PDF page's
     supercell route refines, uses buildSymmetryModes' **polar gauge**, which
     projects out the translations along H's polar directions. It must hold
     the Wyckoff count minus the polar dimension. Irrep by irrep, Γ loses
     m_V(Γ)·n_Γ modes, where m_V(Γ) is the number of copies of Γ in the
     vector representation (tr W_f). The m_V·n removed over the listed irreps
     must equal the polar dimension.
- **Tier 1** (`modeBasisDimension.test.ts`, in `npm test`, about 10 s):
  - the site-symmetry table (52 symbols);
  - moyo on the twelve parent structures alone;
  - negative controls: a dropped mode, a field H does not fix and a field of
    the wrong norm are each caught;
  - every class of Pm-3m 1×1×1 and 1×1×2, Fm-3m, R-3m and Cmcm 1×1×1,
    P6₃/mmc √3×√3×1, Pnma 1×1×2 and P2₁/c 2×2×2 (646 classes);
  - one known-gauge case pinned: R-3m → P3₁21. Its polar gauge keeps all 7
    modes; the default gauge keeps 6.
- **Tier 2** (`modeBasisDimension.tier2.test.ts`, opt-in
  `MATERIA_SUBGROUP_TIER2=1`; the same pattern as A3): twelve parents in
  1×1×1, 1×1×2 and 2×2×2, and P6₃/mmc in √3×√3×1, every class. Time limits:
  - a budget per parent (`MATERIA_SUBGROUP_TIER2_PARENT_MIN`, default 6
    minutes) and a run cap (`MATERIA_SUBGROUP_TIER2_CAP_MIN`, default and at
    most 30 minutes);
  - both are checked between classes and between bounds;
  - classes the time did not reach are listed, not failed.

  `MATERIA_SUBGROUP_TIER2_MODES_OUT=<file>` writes every class as JSON. The
  test keeps a list of known mismatches; it is empty.

## Evidence

Tier 2 on this machine (Node 24): 20.3 minutes, 12 858 classes, **0
mismatches**.
- Modes: 255 144 in supercellModeBasis and 249 683 in the polar-gauge sets.
- Child orbits counted: 133 432. Irrep rows checked against the character
  formula: 81 370. Irrep rows whose polar-gauge loss was checked: 4 856.
- Polar classes: 4 261 (polar dimension 1, 2 or 3).
- Largest Gram deviation: 2.4e-13. Largest H-invariance residual: 4.0e-13.
- The two free-coordinate counts (stabiliser and site-symmetry symbol)
  agreed for every orbit.

| Parent | 1×1×1 | 1×1×2 | 2×2×2 |
| --- | ---: | ---: | ---: |
| Pm-3m | 33 | 124 | 1427 |
| Fm-3m | 238 | 689 | 1195 of 2194 (time) |
| F-43m | 56 | 152 | 437 |
| Fd-3m (origin 2) | 99 | 184 | 226 of 642 (time) |
| Im-3m | 131 | 227 | 1306 |
| P6₃/mmc | 32 | 54 | 234 (√3×√3×1: 69) |
| R-3m (hexagonal axes) | 22 | 69 | 272 |
| I4/mmm | 118 | 214 | 1760 |
| P4/mmm | 27 | 118 | 2272 |
| Pnma | 16 | 27 | 143 |
| Cmcm | 67 | 118 | 623 |
| P2₁/c | 5 | 8 | 66 |

Classes checked per (parent, bound). Two bounds were cut by the per-parent
budget: Fm-3m 2×2×2 (999 classes not reached) and Fd-3m 2×2×2 (416 not
reached). Their core cells hold 256 and 448 atoms, and one class takes up to
5 s. A larger `MATERIA_SUBGROUP_TIER2_PARENT_MIN` reaches more of them
within the 30-minute cap. No bound was refused.

## Findings for the owner

1. **supercellModeBasis and irrepModeSet: no mismatch.** Every count, every
   irrep's count, orthonormality and H-invariance agree with the independent
   counts, in every class checked.
2. **The known gauge issue (buildSymmetryModes' default gauge, "sites") is
   wider than "some non-polar subgroups".** On the same realised children,
   the default gauge keeps fewer modes than the free coordinates minus H's
   translations in **2 946 of the 6 558 classes where it can differ**:
   - by 1 mode in 1 733 classes, by 2 in 748 and by 3 in 465;
   - 1 635 of these classes are non-polar and 1 311 are polar. A polar
     child loses its non-polar directions too: Pnma → P2₁2₁2₁ loses 3 of
     12 modes, Pnma → Pna2₁ 2 of 11, P2₁/c → P2₁ 2 of 8 (all counts after
     the translations are removed).

   The default gauge removes every direction that every child-site
   representative allows. That set also depends on which representative of
   each orbit the child lists: P2₁3's .3. orbits sit on different 3-fold
   axes. This is why the check counts the dropped modes directly instead of
   predicting them. On the supercell route the PDF page uses the polar
   gauge, so it is not affected.

   The page's same-cell t-subgroup route (`withSubgroup` in
   `src/app/pdfPage.ts`) calls `buildSymmetryModes(child, { seeds })` with
   the default gauge. 18 of the 1×1×1 t-subgroup classes above fall in this
   set:
   - Pnma → P2₁2₁2₁, Pmn2₁, Pmc2₁, Pna2₁, P2₁ and Pc;
   - Cmcm → Cmc2₁, P2₁ and Cc;
   - P6₃/mmc → Cmc2₁, Cc and P2₁;
   - Fd-3m → Cc;
   - P2₁/c → P2₁ and Pc.

   That route realises the child with its own code (`realizeSubgroup`),
   which this check does not run. Whether its children lose the same modes
   is not tested here. This is the frozen issue; nothing was changed.
3. Not a mismatch: the oracle's first version predicted the default gauge's
   count from moyo's orbit representatives. Those representatives are not
   the engine's, so the prediction flagged 8 classes (P2₁3, P4₁2₁2, P4₁22).
   The check now counts the default gauge's dropped modes directly, as in
   finding 2.

## What changes for users

Nothing: no app, engine or model-visible text changed.

## Not done

- The class representative is checked; other members of a class are
  conjugates, with the same counts.
- One structure per parent. Other Wyckoff choices change the numbers, not
  the method.
- The irreps' characters are the engine's. Whether they are the right
  irreps is THY-80's irrep checks (ISOTROPY oracle), not this one.
- Fm-3m and Fd-3m 2×2×2 are partly covered at the default budget (above).

## Checks

At the branch head: `npm run build` passes (no moyo in `dist`);
`npm run lint` passes; `npm test` (without `MATERIA_DATA_DIR`): 424 files
passed, 40 skipped; 3796 tests passed, 366 skipped. That is one file and 15
tests more than A3's branch, plus the tier-2 file and its 12 tests skipped.
Tier 1 takes about 10 s.

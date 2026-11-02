# WIP: Distortion modes grouped by k-point (paused for usage)

Branch `feat/modes-by-k`. The owner's request: in the 3D Model's Distortion modes panel, group the irreps by
k-point (chips), filter by parent site, Free all / Fix all per group, highlight the site in 3D.

## Done
- I read the code and settled the design. No code has changed yet. Tests: nothing new; main is unchanged.

## Findings that shape the build
- The panel is `src/app/ui/DistortionModesPanel.tsx`, wired in `src/app/PdfWorkbench.tsx` around line 1047. The arrows
  come from `shownMode.axes` → `StructureView displacements`.
- The per-row free/fix toggle is `ParameterPanel` → `onChange(id, {fixed})` → `onParamChange` → `withParameter`.
  The group toggle (`setGroupFree`) calls the same handler for each row except locked ones (`isLocked`, ParameterPanel.tsx:22).
  The bulk buttons should call `onParamChange(id, {fixed})` for each row in the group. Move `isLocked` to
  `parameterGroups.ts` so both use it (no duplicated logic).
- Modes by parent irrep (supercell children, decompositions, MATERIA mode CIFs) carry `mode.star` ("R", "M", "X")
  and `mode.irrep.{k, parentSite}`. ISODISTORT-file imports have no `star`. For those, use
  `starName(factorGroup(buildSpaceGroup(parent.number).operations), k)` and fall back to `formatK`.
- Same-cell activations (withSubgroup or withActivatedMode, e.g. P4mm) have no `irrep` and no `parent`. Each has
  `star` "Γ", and one mode can span several child sites (Sr, Ti, Oa, Ob). Planned fallback: group by element, where a
  mode belongs to each element it moves.
- Wyckoff: `assignWyckoff` only tabulates groups 1, 2, 14, 194, 216 and 225, so the Pm-3m parent sites have no letter.
  Adding 221 to the table would change the mode-CIF export (model-visible), so don't. Planned behaviour:
  - Show the element alone when it has one parent site (the owner's rule 2). For SrTiO3 the chips are then
    "Sr", "Ti", "O", not "O (3d)".
  - Show "O (4e)" when the letter is known, with the multiplicity from WYCKOFF_TABLE plus buildSpaceGroup.
  - Show the site label otherwise.
  The brief's "O (3d)" example conflicts with rule 2. Raise this with the owner.
- Probe: SrTiO3 → Pnma (first class) gives 6 modes. They are M·3 (O), R·7 (Ti), X·9 (Ti, O 1, O 2) and M·5 (O).
  amplitudeCells = {child 1, parent 4}.

## Left (next step first)
1. Write `src/app/ui/modeGroups.ts` (pure). It needs:
   - k groups: id, label via starShort, cell multiple = lcm of the k denominators, Γ first then by |k|.
   - site groups: id, label, title, childSites to highlight, modeIds.
   - `selectedModes`.
   - quadrature totals through `isodistortAmplitudes`.
   - bulk changes.
   Then write its tests: chips only for the child's k-points, site labels, per-k total = hypot of the members,
   and bulk equals the per-row toggles for SrTiO3 → Pnma and → R-3c (per k and per site).
2. Panel:
   - an "all" chip plus k chips, then site chips, both in a scrollable nowrap row (move the `Chip` of
     SubgroupsPanel into a shared `Chip.tsx`).
   - a summary line, result first, with Free all / Fix all and the per-site totals behind "?".
   - irrep headers recomputed over the filtered rows, each header still showing the irrep's full total.
3. Workbench: lift the filter state and reset it with modeSet. Clear the shown mode when the filter leaves it out.
   Restrict the arrows to the site's child sites.
4. StructureView: a `highlightSites` prop that dims the other atoms (opacity) or adds a halo, with a key string
   in the deps.
5. CHANGELOG and USER_GUIDE. Then typecheck, lint and the full suite.
6. Browser check at 1600×900 and 390×844, screenshots to the scratchpad `modes-k/`. Then the PR.

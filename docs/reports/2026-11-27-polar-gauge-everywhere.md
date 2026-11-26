# The symmetry-mode gauge removes only rigid translations

The mode basis built from a structure's own group (`buildSymmetryModes`)
projected out, by default, every direction all the listed orbit
representatives allow. A rigid translation of the whole structure is an exact
null of every scattering fit, but moving each representative by t moves the
orbit's other atoms by R·t: it is a rigid translation only when every
rotation fixes t. Where some rotation does not, the removed combination is a
real distortion, and up to 3 modes were missing. The verification of
2026-11-26 found 38 of 809 same-cell rows short (67 modes), among them
Pnma → P2₁2₁2₁ (9 of 12) and P2₁/c → P2₁ (6 of 8), and the loaded structure's
own modes short on FeSi-type P2₁3 (1 of 2) and SnS-type Pnma (2 of 4). The
owner chose to fix every route at once, with a migration for saved projects.

## What changed, and why

- **One gauge everywhere** (`buildSymmetryModes`,
  `src/core/crystal/distortionModes.ts`). The projected-out translations are
  always the group's polar directions, the null space of
  Σ_R (R − I)ᵀ(R − I). The "sites" gauge is removed, not just switched off,
  so no caller can keep it: the same-cell Activate routes (`withSubgroup` and
  `withActivatedMode` through `activateDisplacementMode`), Positions → Irreps
  (`symModesOf`), and the MCP tool `build_symmetry_modes` all get the fix
  without a call-site change. The option that is left, `gaugeBasis`, only
  picks how a basis of that one space is computed. The default takes the
  per-site intersection's basis where the intersection *is* the polar space.
  The intersection always contains it (a direction every rotation fixes is
  allowed at every site), so equal dimensions mean the same space. Where the
  intersection is larger, the rotations' basis is used. `"rotations"` is the
  former `gauge: "polar"` (decentring and supercell routes, unchanged).
  Why not one computation for everyone: computing the default's basis from
  the rotations moves the last bits of the mode vectors on 242 of the
  same-cell children where nothing was wrong (measured on main, every row of
  the 23 structures below), and the owner's rule is that nothing on main may
  move. The two bases span the same space, and the default's is the one
  those routes always had.
- **Saved projects** (`src/app/pdfModeBasis.ts`, called by the shell on open
  and on a history step, and by the PDF page on any workspace handed to it).
  A PDF project with positions as the structure's own mode amplitudes
  (Positions → Irreps, no parent, no activation) stores its values by row id
  and rebuilds the basis on open, so on an affected structure the old values
  would bind to other vectors. The file keeps the vectors in force
  (`refinement.bindings`). The saved displacement is rebuilt from them and
  expressed in the corrected basis, which spans everything the old one did,
  by the least squares the atomic ↔ irreps switch uses
  (`positionShiftValuesFor`). Values and initial values are both converted.
  The atoms are checked to land where they were (1e-10 Å). A file this cannot
  hold exactly is refused with the reason, and so is one with a tie on its
  mode rows (a tie cannot be re-expressed row by row); it is never rebound.
  Free/fixed is kept when every saved mode row shared it; a mix reopens with
  every mode row fixed. The last fit's result and boxcar scan refer to the
  old rows and are cleared. A workspace whose saved mode vectors are this
  build's, and every stored mode set (a parent decomposition, an activation,
  a mode CIF), opens as it is.
- **B2's count** (`independentModeCount.ts`): the default gauge's count was
  recorded where it could drop modes and listed, not failed; tier 1 asserted
  the drop (R-3m → P3₁21: 6 of 7). The field is now `defaultGauge`, computed
  on every class, and a class where it is not `expected − polar` fails. Tier
  1 asserts 7 of 7 and no gaps. This was its own commit; no other check
  changed.
- **Docs**: the LIMITATIONS "Not yet" note on the gauge is gone. A known
  issue says a same-cell activation saved before the fix keeps its set.

## Evidence

- **Exact recovery** (`src/app/pdfGaugeRecovery.test.ts`; synthetic neutron
  G(r) of the distorted child, 1.5–12 Å, every mode and the scale free):

  | Case | Modes (before → now) | Representable to (Å) | Rw at the parent | Rw after the fit (before → now) |
  | --- | --- | --- | --- | --- |
  | P2₁/c → P2₁, every site +0.05 Å along a | 6 → 8 | 0.050 → 1.2e-17 | 6.21 % | 4.59 % → 2.8e-12 % |
  | Pnma → P2₁2₁2₁, every site +0.05 Å along b | 9 → 12 | 0.050 → 6.8e-16 | 8.52 % | 3.50 % → 5.1e-13 % |
  | Pnma → P2₁2₁2₁, the parent's Gd x +0.05 Å | 9 → 12 | 0.0125 → 3e-35 | 12.77 % | 0.42 % → 4.2e-6 % |

  The fitted scale is 1 to 1e-8. The relative site positions match the
  truth to 4e-14, 5e-15 and 7e-5 Å; in the last case the fit stops at
  Rw 4e-8.
- **Offered = listed = independent** (`src/testSupport/sameCellModeCount.ts`).
  Every same-cell row of the 1×1×1 listing is activated as the view does, and
  the set's modes are compared with the row's count and with moyo's: the
  realised child plus two marker orbits, Σ over orbits of (1/|S|)·Σ tr W,
  minus the polar dimension, with no engine mode code. The structure's own
  modes are counted the same way. Tier 1 (`pdfSameCellModeCount.test.ts`,
  7 s) covers every row of P2₁/c, Pnma, P2₁3, SnS-type Pnma and Pa-3, and
  sampled rows of Cmcm, P6₃/mmc, Pm-3m and the demo. It fails on main's
  gauge for every affected parent. Tier 2 (`MATERIA_SUBGROUP_TIER2=1`,
  30-minute cap) covers every row of the 16 parents (B2's 12, Pa-3, FeSi,
  SnS, the GaTa4Se8 demo): 917 rows (809 with modes, 108 pinned) in
  6.0 min, **0 mismatches**, own modes right on all 16.
- **B2's count, stronger.** Tier 2 (`MATERIA_SUBGROUP_TIER2=1`) checked
  13 961 classes of THY-80's coverage in 18.5 min, with the default gauge's
  count now required to equal the polar one on every class: **0 mismatches,
  0 gaps**. Before, it dropped 1–3 real modes in 2 946 classes. Fm-3m and
  Fd-3m 2×2×2 were stopped by time, as before.
- **Saved projects** (`src/app/pdfModeBasis.test.ts`). The four fixtures in
  `src/app/fixtures/ownModeBasis/` were written by main 8003787 through the
  app's save path on synthetic structures. SnS-type Pnma (2 saved modes, one
  free and fitted, one fixed with its own initial value) reopens with 4
  modes, and FeSi-type P2₁3 (1 free) with 2. In both, the atom positions
  after reopen and after Reset differ from the file's by 0 (asserted
  < 1e-12 Å). G(r) is the same to 1e-12. Saving again and reopening converts
  nothing. The unaffected Pnma reopens as saved. The stored Pnma → P2₁2₁2₁
  activation (main's 9 modes) reopens with its set equal to the stored one,
  atoms unchanged. A tie, foreign sites and an unrepresentable vector are
  each refused.
- **Nothing else moved** (full-precision dumps, main 8003787 vs this branch,
  kept outside the repository). Every scripted eval run (good, stage scope,
  bad, fresh get_state and assess for every scenario, the extra failures, the
  misfit and impurity pages) is byte-identical once the record clock times
  are normalised. The second dump covers the GaTa4Se8 PDF demo (its page at
  the bundled values, Rw 8.12 %, its 3 own modes, the Irreps view, a refit
  in both position modes), every structure's own modes, the MCP tool and the
  Irreps page, and the 1×1×1 Subgroups listing with every same-cell Activate
  of 23 structures: B2's 12 parents, Pa-3, FeSi, SnS, the demo, Mn₃Ga,
  MnWO₄ and the five bundled CIFs. Of its 1441 keys, 1346 are identical to
  the last bit. The 95 that differ are all ones where main's set had fewer
  modes than this branch builds. Besides the synthetic parents, these are
  bundled real structures: MnWO₄ (P2/c) own modes 7 → 8, the Mn₃Ga 30 K
  nuclear CIF (P2₁/m) 6 → 8, the Mn₃Ga 350 K nuclear CIF (Cmcm) 3 → 4, and 14
  Activate rows of Mn₃Ga (e.g. P-3m1 2 → 3, Cmcm 3 → 4). The listings
  themselves are unchanged everywhere.

## What changes for users

- On an affected structure, Activate on a same-cell row and lower_symmetry
  now offer the modes the row lists (the Agent's lower_symmetry no longer
  says 12 in `list_subgroups` and 9 in `lowered.modes`). Positions → Irreps
  and `build_symmetry_modes` give every real mode. The Activate status line
  and the panel's acoustic-excluded count change their numbers there, not
  their wording.
- An affected PDF project saved with its own modes reopens on the full
  basis, with a notice: "Reopened on the corrected mode basis (4 modes; the
  file had 2): the atom positions are unchanged…". One that cannot be
  converted exactly is refused, and the notice gives the reason.
- A same-cell activation saved with a project keeps its set. On an affected
  row, activate it again for the full one.
- Nothing changes on any other structure.

## What it means for the validation

The eval replays and the GaTa4Se8 demo are bit-identical, and no pinned
result moved. Arms that lower the symmetry on an affected class now refine
the full basis. No model-visible tool description changed. With the fix,
`build_symmetry_modes`' statement (rigid translations, exactly unobservable,
so freeing every mode is well-posed) is true as written.

## Not done

- A same-cell activation stored in a project before the fix is not
  converted; its set is the saved one, by design (a stored set is reopened
  as it is).
- The refusal asks the user to reopen in the version that saved the file and
  set Positions to Atomic. Converting such a file to atomic positions here
  instead would be possible; that is the owner's call.

## Checks

At the branch head: `npm run build`, `npm run lint` and `npm test` pass
(parked as before: localHexMagneticGolden needs local data; realPowderXRD
and the magnetic-30k replay can exceed their wall-clock limits under load).
Tier 2 runs: the same-cell count (917 rows, 0 mismatches, 6.0 min) and
B2's count (13 961 classes, 0 mismatches, 18.5 min).

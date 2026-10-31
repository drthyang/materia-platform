# Subgroup engine, Phase 4: modes by parent irrep on supercells, decompose(parent, child), ISODISTORT mode CIFs

Linear THY-35, project "MATERIA subgroup engine". Decisions:
[ADRs 0001–0005](../adr/), ADR 0003 above all (ISODISTORT's phase, A_s and
A_p, mode-CIF interchange). Plan: phase 4 of the subgroup-engine plan. Builds
on [Phase 3](./2026-10-31-subgroup-engine-phase-3.md).

## What changed, and why

Phase 3 refined a supercell child in its own cell, but its positions were
the child's own symmetry-adapted displacements, kicked along one generic
symmetry-breaking field and labelled by number. A user could not see which
parent irrep a displacement belonged to, could not take a loaded supercell
structure apart against its parent, and could not check a result in
ISODISTORT. This phase does all three.

- **A child's displacive modes by parent irrep** (`irreps/supercellModes.ts`,
  `supercellModeBasis`). The parent's atoms modulo the core T″ of the bound
  carry the displacement representation of F = G/T″. The child's own fields
  are its sites' allowed shifts carried over their orbits and written on that
  cell. They are cut by:
  - the isotypic projector of every physically irreducible representation
    whose star has an arm in the dual of the child's lattice;
  - the local components of each parent orbit (the displacement's isotypic
    components under the site group, ISODISTORT's "[O:d]Eu" and "A2u").

  A Gram–Schmidt over the child's site shifts, in their order, gives each
  block an orthonormal basis. The basis is complete by construction, and
  checked: one mode per free coordinate, or the function throws.
  - Normalisation is buildSymmetryModes': 1 Å over the conventional child
    cell, in the child's cell, which the realisation builds from the parent's
    metric (unstrained, as ISODISTORT's normfactor requires).
  - A one-dimensional block is ISODISTORT's mode up to its sign.
  - Labels are generic (ADR 0004): "R irrep 8 of 10 · O", with a number when
    one irrep has several modes on one site.
- **Irrep numbers that do not depend on the bound** (`canonicalArm`). An
  irrep's number at a star depends on the arm it is induced from. The
  supercell view takes the first arm in the supercell's dual, so a
  decomposition, whose bound is the child's own lattice, could number the
  same irrep differently. The decomposition uses the star's first arm
  overall. For the default 2×2×2 bound of a cubic or hexagonal parent the
  two agree. An activation keeps the view's arms, so its labels are the
  view's.
- **The order parameter an activation kicks** (`orderParameterIrreps`). It is
  the fewest irreps whose modes together lower the parent to the child,
  searched over one, two and three irreps. Ties go first to the irrep the
  user activated from the irreps view (passed by its characters, so the arm
  does not matter), then to the fewest modes, then to the earliest irreps.
  - R-3c: the R irrep alone. Pnma: the two tilt irreps, an R and an M.
  - Each kicked mode starts free, at 0.05 Å in quadrature in all, with
    fixed distinct weights so that no special combination keeps a higher
    symmetry. The other modes start at 0, fixed.
  - This replaces the generic field as the activation's kick.
    `symmetryBreakingField` stays: the Phase 3 refinement tests use it.
- **decompose(parent, child)** (`irreps/decompose.ts`, `decomposeChild`),
  following ISODISTORT's method 4 and AMPLIMODES.
  - The child basis: parent lattice vectors whose lengths and angles match
    the child's cell within 12 % strain, det P_H the volume ratio, every
    child rotation a parent rotation. One basis is kept per orientation
    class.
  - The origin, on a 1/24 grid, is where every child operation is a parent
    operation.
  - The undistorted child is the parent realised in the child's own cell and
    setting, from the factor group of the child's lattice. Each of its sites
    is paired with the nearest child site of the same element and
    multiplicity, within 1.2 Å. A displacement that does not project onto
    the site's allowed shifts, by more than 0.02 Å, rejects the candidate.
  - A polar child's sliding origin is fixed by removing the mean
    displacement, as ISODISTORT does.
  - The amplitudes are the displacement's components on the modes, in the
    unstrained metric.
  - The result is a mode set on the child as loaded: its labels, sites and
    strained cell, the amplitudes seeded at the observed values.
- **The parent-CIF route by parent irrep** (`withParentModes`). The PDF page's
  "Load parent CIF…" now decomposes by parent irrep, supercell children
  included. Where decomposeChild cannot pair the two (a missing site, a
  setting outside its search), the page falls back to the same-lattice
  pairing of `buildDistortionModes` and says so. The MCP tool
  `build_distortion_modes` still calls `buildDistortionModes`, unchanged.
- **ISODISTORT mode CIF, export and import** (`export/modeCif.ts`,
  `parsers/modeCif.ts`).
  - The export writes ISODISTORT 6.12's tags: the modes with their A_s, the
    normfactors, the deltacoordinates and coordinate formulas, the matrix
    (deltacoords = matrix·(A_s·normfactor)), the parent cell and the parent
    to child transform.
  - The normfactor is ISODISTORT's: the mode vector times it sums to 1 Å²
    over the primitive child cell, in the unstrained metric.
  - MATERIA's own `_materia_*` items carry what an exact round trip needs:
    the generic labels and irreps, A, free state, axes, the undistorted
    positions, the amplitude cells and the parent.
  - The import reads ISODISTORT's own files too. It takes the labels, irreps,
    k-points and directions from them (CDML labels read from a file, as ADR
    0004 allows). It also reads MATERIA's.
- **On the PDF page**:
  - An activated supercell child lists its modes by parent irrep.
  - The 3D Model view's mode table groups the rows under their irrep, with
    the irrep's total A_s and A_p (ISODISTORT reports one per irrep), and
    has **Mode CIF ↓**.
  - The Subgroups view has **Load mode CIF…**. With the file's parent loaded,
    the file's child is fitted in its own cell and ✕ clear returns to the
    parent. With the file's child loaded, the modes go on it. Anything else
    is refused, with the reason.
  - Saved projects keep the new optional fields (each mode's irrep, the set's
    parent and child basis), and the project validator checks them.

## Evidence

All of the following are tests through the module interfaces, except the
oracle (an opt-in CI workflow) and the browser check.

| Check | Result |
| --- | --- |
| **Gate: amplitudes against ISOTROPY 9.6.1** (`modeAmplitudeOracle.test.ts`, the opt-in `isotropy-oracle.yml`, run at the PR's code: [run 41250092272](https://github.com/drthyang/materia-platform/actions/runs/41250092272)). Each case moves every site of a realised child by fixed pseudo-random amounts within its allowed shifts, strains the cell and relabels the sites, then hands it to decomposeChild. The reference uses ISOTROPY alone: for every irrep at the child's k-points and every parent Wyckoff site, DISPLAY DISTORTION (SHOW MICROSCOPIC VECTOR, SHOW CARTESIAN, the 2×2×2 or 2×2×1 cell) lists the irrep's isotypic subspace; the child's field projected onto it, over one primitive child cell, is ISODISTORT's A_s (ISODISTORT help) | **SrTiO₃ → R-3c**: O, ISOTROPY R5⁻ 0.328200 Å, MATERIA 0.328200 Å (diff 1.4e-15). **SrTiO₃ → Pnma** (Sr free, 7 modes): Sr X5⁻ 0.082601, Sr R4⁻ 0.307063, O M2⁺ 0.035809, O X5⁻ 0.060175, O R4⁻ 0.221826, O M3⁺ 0.258668, O R5⁻ 0.688746 Å; every one equal to ≤ 1.3e-14. **NiAs → MnP-type Pnma** (M point): Ni M2⁻ (two copies) 0.290300, As M2⁻ 0.135609, As GM5⁺ 0.346905 Å; ≤ 4.3e-14. Gate 1e-3 Å: **met**. ISOTROPY's labels are for Sr at 1a, the origin of `srtio3()`: its R5⁻ is the familiar R4⁺ tilt of the Ti-at-origin setting. The run's 13 isotropy-subgroup cases still agree |
| **A published ISODISTORT decomposition**: the ISODISTORT 6.12.2 mode CIF of the GSAS-II tutorial "k-vector search and ISODISTORT" (STO_Subgroup.cif, [GSAS-II-tutorials](https://github.com/AdvancedPhotonSource/GSAS-II-tutorials), MDtutorials/k_vec_isodistort/data): SrTiO₃, a = 3.899 Å, to P4/mmm at X, A_s = 0.10000 Å (Sr T1u) and −0.30000 Å (O A2u). Its numbers are entered by hand in the tests; the file is not in the repository | MATERIA decomposes its structure to \|A_s\| = 0.100024 Å (Sr) and 0.299963 Å (O), both on one X irrep, within the file's 5-decimal coordinates (gate 1e-3: **met**). MATERIA's exported normfactor for both modes is 0.0906780, ISODISTORT's 0.09068. The file's tags read back as its two modes, A_s 0.1 and −0.3 Å, the parent cells 2 from its transform a,c,−2b |
| Geometric tilts of SrTiO₃ (`decompose.test.ts`, built with no subgroup engine), handed over relabelled, re-represented and strained | Reproduced to 1e-12. a⁻a⁻a⁻ (φ = 0.07): A_s = √3·φ·a = 0.473456 Å, A_p = A_s/√2 = 0.334784 Å on the one R mode. a⁰a⁰c⁻ and a⁰a⁰c⁺: A_s 0.273350 Å. a⁻b⁺a⁻: the R and M amplitudes equal the norms of the a⁻_a⁻ and b⁺ parts to 1e-10 |
| The irreps are the right ones (`supercellModes.test.ts`) | Tilt fields built geometrically lie in one R mode (R-3c, I4/mcm) or one M mode (P4/mbm), the other amplitudes < 1e-12. Pnma: 7 modes in 5 irreps (X: Sr+O, M: O, M: O, R: O, R: Sr+O), the tilt split onto R and M with the parts' norms to 1e-12 |
| Complete and orthonormal | SrTiO₃'s children of 8 types (2×2×2); rock salt at L and W and NiAs at M and L (irreps up to dimension 6, over 30 children): one mode per free coordinate, orthonormal to 1e-9, every axis an allowed shift |
| **Gate: mode-CIF round trip exact** (`modeCif.test.ts`) | R-3c and Pnma children (strained, amplitudes set) and a decomposition: the structure, the undistorted positions, labels, irreps, axes, amplitudes, free state, amplitude cells and parent come back bit for bit, and so do the positions the amplitudes give |
| The page (`pdfModeCif.test.ts`, `pdfSupercellChild.test.ts`) | Parent-CIF route on a loaded R-3c child: 1 mode by parent irrep, A_s = √3·φ·a, Rw unchanged. Export from an activated child, import on the parent's page: the same structure, mode rows and Rw (1e-12); ✕ clear gives the parent's rows; saved and reopened, the same. Pnma activation: 7 modes in 5 irreps, the two tilt irreps kicked first at 0.05 Å in quadrature |
| **Browser check** (dev server from the branch, headless Chromium through playwright-core, synthetic SrTiO₃ and the neutron G(r) of its a⁻a⁻a⁻ tilt) | 15/15: R-3c activated from the R point (1 mode in 1 irrep, the order parameter R irrep 8 of 10); the 3D view shows the child ("R -3 c:H · 3 sites", the hexagonal cell drawn); the mode table's irrep row and mode row; a refinement, Rw 45.39 % → 1.18 %, A_s 0.47349 Å (the truth's √3·φ·a = 0.47346 Å); Mode CIF ↓; ✕ clear to the parent; the CIF re-imported, the same amplitude; saved, closed, reopened; ✕ clear; no page errors. A Pnma child from the lattice view: 7 modes under 5 irrep rows, M irrep 3 + R irrep 8 kicked, the 3D view "P n m a · 4 sites" |
| Phases 1–3 tests, the Subgroups page, the same-cell activations, the agent snapshots and evals | unchanged and passing |

## What changes for users

On the PDF page:

- **An activated supercell child refines its modes by parent irrep**. Each
  row is named by the parent's irrep and the site it moves ("R irrep 8 of
  10 · O"). The irreps that lower the parent to the child lead, kicked; the
  rest start at 0, fixed. The 3D Model table groups the rows by irrep with
  the irrep's total A_s and A_p.
- **Load parent CIF…** now works on a loaded supercell child too (a Pnma CIF
  against its cubic parent, say). The modes are by parent irrep and seeded
  at the observed amplitudes, and the message gives the basis found.
- **Mode CIF ↓** saves the child and its modes as an ISODISTORT mode CIF.
  **Load mode CIF…** reads one back, from MATERIA or from ISODISTORT.

Nothing the Agent or an MCP client reads changed: no tool, text or result.
If a user activates a supercell child or loads a mode CIF, the page the Agent
reads shows it, as it shows any structure the user loads.

## What it means for the validation

Nothing under the agent validation freeze changed: no agent text, tool
result, MCP output, skill, snapshot, `review_symmetry` output or frozen
report. `build_distortion_modes` and `build_symmetry_modes` are untouched
(the new fields are optional and only the new code sets them), and so are
both engines, so every validated fit is bit-identical. The refined parameter
keeps its unit, A over the conventional child cell (ADR 0003, Q15).

## Not done

- **Occupancy, strain and magnetic modes.** Displacive only, as the plan has
  it. A mode CIF's other kinds are listed as not read.
- **The basis inside a block with several copies of one irrep** is MATERIA's
  own (NiAs Ni's two M2⁻ modes, say). There, individual amplitudes differ
  from ISODISTORT's. Each irrep's total on each site agrees, which is what
  the oracle compares.
- **CDML labels** are not computed (ADR 0004). The export writes MATERIA's
  generic names in ISODISTORT's label shape ("Pm-3m[1/2,1/2,1/2]
  R_irrep8of10(a,a,a)[O:?:dsp]m1"), and the Wyckoff letter only where the
  repository's table has the group. An imported ISODISTORT file keeps its
  own labels.
- **A polar child's rigid translations** are projected out of the modes of
  the irrep they belong to, as buildSymmetryModes does, since they are a
  null direction of every fit. ISODISTORT keeps its per-site modes and fixes
  the origin instead, so on a polar child those modes' amplitudes differ;
  the irrep's total agrees.
- **decompose's search** allows 12 % strain, takes origins on a 1/24 grid,
  and needs every undistorted site paired. A child with vacancies falls back
  to the same-lattice route. The child's centring must be P, A, B, C, I, F or
  obverse R.
- **The powder page** has no Subgroups view, so it has neither mode-CIF
  loader nor parent-CIF route. A supercell child still reaches it as the CIF
  the PDF page exports.
- **Labels after a non-default bound**: an activation uses the view's arms,
  a decomposition the canonical one. For a bound whose supercell drops some
  arms (2×1×1, say), the same irrep can carry different numbers in the two.
- The isotropy analysis of rock salt's 12-dimensional W irrep (an existing
  cost) is slow; the engine tests keep to irreps up to dimension 6.
- Speed: every case here takes milliseconds to a second, the time going to
  the irreps of large stars.

## Checks

At the head of the PR: `npm run typecheck`, `npm run lint`, `npm run build`
and `npm test` (results in the PR). The opt-in ISOTROPY oracle ran on the
branch at c6334a9 ([run 41250092272](https://github.com/drthyang/materia-platform/actions/runs/41250092272)),
its log showing all 16 cases run and agreeing (13 isotropy-subgroup cases,
3 mode-amplitude cases).

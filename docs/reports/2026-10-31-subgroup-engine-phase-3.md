# Subgroup engine, Phase 3: supercell children realised in their own cell and refined

Linear THY-34, project "MATERIA subgroup engine". Decisions:
[ADRs 0001–0005](../adr/). Plan: phase 3 of the subgroup-engine plan
(supercell forward model). Builds on
[Phase 2](./2026-10-31-subgroup-engine-phase-2.md) and
[THY-48](./2026-10-31-thy48-subgroups-count-and-direction-symbols.md).

## What changed, and why

Phase 2 listed and named the cell-multiplying children of a supercell bound,
but nothing could refine them: the PDF and Rietveld engines take a structure
in a cell, and a child that loses parent translations needs its own cell.
This phase builds that structure. The seam is the existing structure model,
as the plan set it; neither engine changed.

- **Realisation** (`irreps/realisation.ts`, `realiseChild`). A child of the
  factor group (its elements, from the lattice or an isotropy subgroup) and
  its child basis (P_H, p_H) from `nameChild` give the child in its ITA
  standard setting:
  - **Operations**: each element {W|w} becomes {P⁻¹WP | P⁻¹(w + Wp − p)},
    in exact rational arithmetic. The elements are cosets of T″, and T″
    need not lie in the child's conventional lattice. A hexagonal R cell of
    volume 6 cannot hold 2ℤ³, so the images of the cosets modulo that
    lattice miss centring classes. The set is therefore closed under
    composition with T″'s translations added. A named child's set must be
    a tabulated setting of its IT number, or the realisation refuses. The
    child then takes the table's operations.
  - **Cell**: G_child = Pᵀ·G_parent·P from the parent's own metric,
    averaged over the child's rotations. The ties its symmetry imposes
    (a = b, γ = 120°) are snapped to exact values.
  - **Sites**: every image of every parent site in the child cell, split
    into orbits of the child's operations, with one child site per orbit.
    A site whose orbit stays whole keeps its label. A split one gets letter
    suffixes, as `realizeSubgroup` labels a same-cell child. The
    representative is the most standard-looking member: free coordinates on
    the fewest and earliest axes, so R-3c's oxygen reads (x, 0, ¼).
    Occupancy, isotope, oxidation state and disorder group carry over, and
    so does an isotropic B. An anisotropic U is rotated to the
    representative's image and transformed to the child's axes. The
    fractional covariance C = N·U·N goes to P⁻¹·W·C·Wᵀ·P⁻ᵀ.
  - **Atom correspondence**: every atom of the child cell, with the parent
    site, parent operation and parent lattice translation that place it
    (P·x + p = W·x_s + w + n, n integral). Phase 4 will read the parent
    displacement of each child atom from this list. The function checks
    that each parent site gives |orbit| × det P atoms, and that each child
    site's multiplicity is its share of them.
  - Riding hydrogens, distance restraints and the source's esds name the
    parent's sites and operations, so they are not carried. `dropped` lists
    them, and the activation message says so.
- **The symmetry-breaking kick** (`symmetryBreakingField`). At the parent's
  geometry χ² is stationary along every symmetry-breaking direction, so a fit
  started there never moves. The field is a generic vector of the child's
  allowed displacements. The parent's own displacements (carried into the
  child cell) and the child's rigid translations are projected out, and the
  result is normalised to 1 Å over the conventional child cell. Its weights
  are fixed, so the field is reproducible. It is null when the child allows
  no displacement the parent does not. One of the four R-3c classes below
  is such a child: every atom sits on a fixed position. This field is not
  the order parameter of one irrep. Modes by irrep in the child cell are
  phase 4 (THY-35).
- **ISODISTORT's amplitude cells for a supercell child**
  (`realisedAmplitudeCells`). A_s = A/√f_child as before. A_p divides by
  √(det P · f_parent), the parent primitive cells in the conventional child
  cell (ADR 0003). With det P = 1 this is the existing `amplitudeCells`.
- **PDF page** (`withSupercellChild`; `SupercellView`, `SubgroupsPanel`,
  `PdfWorkbench`). In the supercell view, a cell-multiplying child (irreps
  view and lattice view) now has **Activate** where the phase-3 note was.
  Activate realises the child from the current refined geometry and makes it
  the structure the page fits, in its own cell. The rows are the child's own:
  - cell and ADP rows from the child;
  - positions as the child's symmetry-adapted displacements, with the
    symmetry-breaking field leading, free from the 0.05 Å kick, and the
    rest at 0, fixed;
  - the setting-free rows (scale, Qdamp, …) carried over.

  This is the mechanism a same-cell activation already uses. The child's
  own modes are named by number and site, without the "@ Γ" that
  `buildSymmetryModes` writes: on a child that Γ is the child's, and would
  read as the parent's. **✕ clear** returns to the parent, and a saved
  project keeps the child, since the mode set holds it. The child's rows
  share ids with the parent's (`cell_a`, `B_Sr`) in another cell, so the
  mode set is marked as the child's own cell (`ownCell`, saved with the
  project), and moving the fit between child and parent (✕ clear, the
  Positions toggle) carries only the setting-free rows, as the activation
  does. The header's CIF
  export writes the child, which can be loaded on the powder page for
  Rietveld.

## Evidence

All of the following are tests through the module interfaces.

| Check | Result |
| --- | --- |
| **Gate: G(r) and \|F(H)\|² of a tilted supercell child against a sum over the whole supercell** (`workflow/supercellForwardModel.test.ts`). The tilt of cubic SrTiO₃ is built geometrically (Glazer's rotations, no subgroup engine) as one explicit 2×2×2 cubic cell of 40 atoms, O with an anisotropic U along its bond. The child is taken from the lattice, realised, tilted at its representatives and expanded by its own operations. \|F\|² for every H to \|H_i\| ≤ 3–4, neutron and X-ray, at the same scattering vector h′ = 2·P⁻ᵀH; G(r) by the PDFfit2 sum written out over every pair | a⁻a⁻a⁻ → R-3c: \|F\|² worst 1.6e-13 (484 reflections, 152 superlattice), G(r) 6.5e-14. a⁰a⁰c⁻ → I4/mcm: 1.9e-14, 7.2e-14. a⁰a⁰c⁺ → P4/mbm: 2.4e-14, 7.2e-14. a⁻b⁺a⁻ → Pnma: 3.9e-12 (432 superlattice), 4.4e-14. Gate 1e-9: **met** |
| At the parent's geometry the child is the parent (`irreps/realisation.test.ts`): \|F(H)\|² = (V_c/V_p)²·\|F_p(P⁻ᵀH)\|², every superlattice reflection zero, the same G(r), to 1e-9. Cases: SrTiO₃ → R-3c (irrep route), and Pnma, I4/mcm, P4/mbm, R-3c (lattice route); with O anisotropic and Sr at 0.9 occupancy for R-3c, I4/mcm, Imma and C2/c (every child tensor in its site's allowed span to 1e-12); rock salt's 27 L-point isotropy subgroup types (Fm-3m, a centred parent); NiAs (P6₃/mmc, both sites anisotropic with U12 = U11/2), 43 types of M- and L-point child down to P1, for the ADP transformation on non-orthogonal axes | all agree; the correspondence holds exactly (n integral, child operations to 1e-9) |
| **Gate: a perovskite tilt refines from the lattice route, PDF** (`workflow/supercellPdfRefinement.test.ts`). The truth is a geometric tilt in a strained cell with its own B values; neutron G(r) at 1.5–12 Å, noise 0.4 % of the peak (Rw 1.10 %). Every class of the type in the 2×2×2 lattice is realised at the cubic geometry, kicked, and refined (scale, cell, B, δ2, every allowed displacement) | **R-3c**: of 4 classes the truth's reaches the noise (Rw 1.083 %), and so does its ×4 isomorphic subgroup (1.068 %, 17 free against 8); the other two sit at 16.8 % and 18.0 %. O \|x − ½\| 0.03499 (truth 0.03500), a 5.5138 Å (5.5142), c 13.5547 Å (13.5544). **Pnma** (Sr moved on its mirror too): of 12 classes only the truth's reaches the noise (1.075 % against 1.107 %; next 2.77 %). Ti–O distances to 2.9e-4 Å, Ti–O–Ti angles to 0.026° |
| **Rietveld, superlattice reflections included** (`workflow/supercellRietveldRefinement.test.ts`). The same truths as a constant-wavelength neutron pattern (λ 1.54 Å, 2θ 15–135°, strongest peak 5·10⁴ counts, counting noise). The superlattice reflections (P⁻ᵀH not integral) are zero in the realised parent and present in the truth | **R-3c**: 15 superlattice families; the truth's class χ²ν 0.973, O \|x − ½\| 0.03500 (0.03500), angles to 0.001°; the two classes without the truth χ²ν ≈ 124. **Pnma**: 90 superlattice families; the truth's class χ²ν 0.972, the next of 12 at 20; distances to 2.8e-4 Å, angles to 0.014° |
| The PDF page (`app/pdfSupercellChild.test.ts`): Activate on the R-3c class of the tilt, and on a Pnma class | R-3c: the page fits R-3c on hexagonal axes (30 atoms, γ = 120°, two cell rows), O's x free at the 0.05 Å kick, A_s/A_p cells {3, 6}; the fit reaches the tilt (or its antiphase twin) at Rw < 1e-6; saved and reopened (through the project validator) it comes back with the child, every row and Rw; ✕ clear (also after reopening) and Constrained atomic return to the parent's own rows and its Rw, the refined scale kept; Irreps (modes) brings the child back. Pnma: one mode per free coordinate, only the leading one free, no mode labelled with a k-point |
| Phase 1 and 2 tests, the Subgroups page, the same-cell activation (`pdfSubgroupKick`, `subgroupsDecentring`) | unchanged and passing |

**Choosing among classes.** A same-type subgroup in a larger cell contains
the truth, so it fits as well with more parameters. The R-3c ×4 class does
so on the PDF side; on the powder side it reaches χ²ν 0.975. The tests
therefore keep what a crystallographer keeps: of the classes at the noise,
the one of highest symmetry (the smallest cell, then the fewest free
parameters). The lattice route offers every class, and the page leaves that
choice to the user.

**Speed.** The PDF refinements use the problem's analytic Jacobian columns
(every kind but the cell). The 4 R-3c classes take about 20 s and the 12
Pnma classes about 44 s (Node 22, one thread). The Rietveld cases take 2 s
and 21 s.

## What changes for users

On the PDF page's Subgroups view, a cell-multiplying child in the supercell
view now has **Activate** (it waits while another choice is in force, as
the other pickers do). Activate realises the child in its standard setting
and refines it there. The page's structure becomes the child, in its own
cell (R-3c on hexagonal axes, Pnma √2×2×√2), with:

- its cell rows;
- an ADP row per split site;
- its displacements as mode amplitudes, the symmetry-breaking ones leading
  from a small kick.

The other rows start fixed. The 3D Model view, the report (with A_s and A_p
over the child's cells) and the CIF export all show the child. For
Rietveld, export the child's CIF and load it on the powder page; the
superlattice reflections are then that cell's own. The supercell view's
note now says this.

Same-cell activations (Γ, decentring, the same-cell lattice) are unchanged.

## What it means for the validation

Nothing under the agent validation freeze changed: no agent text, tool
result, MCP output, skill, snapshot, `review_symmetry` output or frozen
report. The Agent has no activation tool. `withSupercellChild` adds a user
action on the PDF page and changes no existing one. If a user activates a
supercell child, the page the Agent reads shows that child, as it shows any
structure the user loads. Neither engine changed, so every validated fit is
bit-identical.

## Not done

- **Modes by irrep in the supercell** (phase 4, THY-35). The kick is a
  generic symmetry-breaking field, not one irrep's order parameter, and the
  modes are the child's own symmetry-adapted displacements, labelled by
  number and site. `decompose(parent, child)` and the ISODISTORT mode CIF
  come there too.
- **Rietveld from the powder page directly.** The powder page has no
  Subgroups view. A supercell child reaches it as the CIF the PDF page
  exports. The engine side is tested above.
- **Riding hydrogens and distance restraints** are not carried into a
  child (above); a child of a structure with them is refined without them.
- **Magnetic supercells** are out of scope here, as the plan has it.
- **Speed**: the lattice route refines every class, which takes about a
  minute for Pnma's 12 in a test. The page refines one class at a time, the
  one the user activates.

## Checks

At the head of the PR: `npm run typecheck`, `npm run lint`, `npm run build`
and `npm test` (results in the PR).

# Symmetry lowering

The vocabulary MATERIA uses for subgroups, irreducible representations and the distortions they describe: on the Subgroups page, in the subgroup engine and in the docs.

## Groups and cells

**Parent group**:
The space group of the loaded structure, written G.
_Avoid_: high-symmetry group, aristotype group

**Child group**:
A subgroup H of the parent group that a distortion lowers the symmetry to.
_Avoid_: daughter group, hettotype group

**t-subgroup**:
A child group that keeps every translation of the parent and loses point-group operations.
_Avoid_: translationengleiche subgroup (outside formal text)

**k-subgroup**:
A child group that keeps the parent's point group and loses translations; it is **decentring** when the conventional cell stays the same and **cell-multiplying** when it does not.
_Avoid_: klassengleiche subgroup (outside formal text)

**General subgroup**:
A child group that loses both translations and point-group operations.

**Supercell bound**:
The integer basis matrix P of the largest cell a subgroup search considers; it fixes which k-points and k-subgroups exist.
_Avoid_: supercell matrix

**Child basis**:
The transformation (P_H, p_H) from the parent cell to a child group's standard setting.

**Index**:
The number [G : H], the product of its point-group factor and its translation factor.

**Enantiomorphs**:
The two space-group types of a mirror-image pair, such as P4₁22 and P4₃22. An improper operation of the parent turns a child of one type into a child of the other, so one class of conjugate child groups can hold both; Bilbao's SUBGROUPS lists such a class twice, once per type.
_Avoid_: chiral pair

## Representations

**k-point**:
A wavevector of the parent's reciprocal space.

**Star**:
The orbit of a k-point under the parent's point group; each member is an **arm**.

**Little group**:
The elements of the parent group that leave a k-point unchanged up to a reciprocal-lattice vector, written G_k.

**Small representation**:
An irreducible representation of the little group whose translations act as the phase of their k-point.
_Avoid_: allowed irrep, small irrep

**Irrep**:
An irreducible representation of the full parent group, induced from a small representation over the star.
_Avoid_: using "irrep" for a small representation

**Physically irreducible representation**:
The real form of an irrep: the irrep itself when it is real, or an irrep joined with its complex conjugate when it is not.
_Avoid_: real irrep

**Image group**:
The finite group of matrices an irrep forms acting on its order-parameter space.

**Generic irrep label**:
MATERIA's name for an irrep: its k-point (Γ, X, L, …, or the vector where the point has no standard name here) and its place among the star's irreps, ordered by dimension, "X irrep 2 of 4"; a complex pair reads "irreps 3⊕4". Miller–Love (CDML) labels such as X3⁺ are only read from imported ISODISTORT mode CIFs and matched in the opt-in ISOTROPY oracle (ADR 0004).
_Avoid_: writing a generic label in CDML form (Γ1, X3); the magnetic page's old "Γ1, Γ2" at every k

**Magnetic irrep**:
An irrep of the parent group with time reversal acting as −1, the representation a magnetic order parameter transforms by; ISODISTORT writes it with an "m" (mX2⁺ for X2⁺). The magnetic page shows the space-group irrep's generic label.

**Magnetic representation**:
The representation Γ_mag of the little group on the Fourier coefficients of the magnetic atoms of one primitive cell; it decomposes into small representations with integral multiplicities, each copy carrying a set of **basis vectors**.
_Avoid_: magnetic irrep (for Γ_mag itself)

## Distortions

**Order-parameter direction**:
A vector in an irrep's order-parameter space, taken up to the image group's action, such as (a,0,0) or (a,a,a).
_Avoid_: branch

**Isotropy subgroup**:
The child group that leaves an order-parameter direction unchanged; the smallest is the **kernel**, the others are **epikernels**. For a magnetic irrep it is a magnetic space group: the operations of the little group, with or without time reversal, that keep the order parameter, named at k ≠ 0 in its **magnetic cell** (a type-IV group, whose anti-translations are the lattice translations with k-phase −1).

**Primary irrep**:
The irrep whose order parameter drives a distortion.

**Secondary irrep**:
An irrep allowed to appear in the same child group by coupling to the primary one.

**Symmetry mode**:
A basis displacement pattern of the child cell that belongs to one irrep.

**Mode amplitude**:
The size of a symmetry mode in Å, reported as A_s over the primitive child cell and A_p normalised to the parent cell.

**Decomposition**:
A child structure's distortion taken apart into the parent's symmetry modes, given the parent: the child basis and origin found, each child atom paired with its undistorted position, the displacements projected onto the modes by irrep.

**Mode CIF**:
ISODISTORT's CIF of a child structure with its symmetry modes: each mode's amplitude A_s and normfactor, and the matrix that turns amplitudes into coordinate shifts.
_Avoid_: distortion file (ISODISTORT's own page-state file)

**Orientation state**:
One conjugate of a child group; there are [G : N_G(H)] of them.

**Domain state**:
One coset of a child group; there are [G : H] of them.

**Realisation**:
The child structure built from the parent structure, a child group and its child basis, with the parent's Wyckoff orbits split.

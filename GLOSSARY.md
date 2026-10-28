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

## Distortions

**Order-parameter direction**:
A vector in an irrep's order-parameter space, taken up to the image group's action, such as (a,0,0) or (a,a,a).
_Avoid_: branch

**Isotropy subgroup**:
The child group that leaves an order-parameter direction unchanged; the smallest is the **kernel**, the others are **epikernels**.

**Primary irrep**:
The irrep whose order parameter drives a distortion.

**Secondary irrep**:
An irrep allowed to appear in the same child group by coupling to the primary one.

**Symmetry mode**:
A basis displacement pattern of the child cell that belongs to one irrep.

**Mode amplitude**:
The size of a symmetry mode in Å, reported as A_s over the primitive child cell and A_p normalised to the parent cell.

**Orientation state**:
One conjugate of a child group; there are [G : N_G(H)] of them.

**Domain state**:
One coset of a child group; there are [G : H] of them.

**Realisation**:
The child structure built from the parent structure, a child group and its child basis, with the parent's Wyckoff orbits split.

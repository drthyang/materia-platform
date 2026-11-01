# Magnetic symmetry analysis

To refine a magnetic structure, the workbench needs the moment arrangements that
symmetry allows for a propagation vector **k**. It finds them by two standard
routes, which both start from the little group of k and feed one moment model.

| | Route A — magnetic space groups | Route B — representation analysis |
| --- | --- | --- |
| Used by | FullProf, ISODISTORT, Bilbao k-SUBGROUPSMAG | Jana2020, BasIreps, SARAh |
| Gives | candidate Shubnikov groups and their allowed moments | irreps, their basis modes, and the group they imply |

What works and what is missing is listed under Symmetry and Magnetic structures
in [LIMITATIONS.md](./LIMITATIONS.md#symmetry). The tests are in
[VALIDATION.md](./VALIDATION.md), and [USER_GUIDE.md](./USER_GUIDE.md) explains
the magnetic page.

## Terms

| Term | Meaning |
| --- | --- |
| Little group G_k | The operations of the parent group G with Rᵀ·k ≡ k modulo a vector of the parent's reciprocal lattice. For a centred cell that lattice is a sublattice of the integer vectors, so MnO (Fm-3m, k = ½½½) has G_k = -3m, not m-3m. Their distinct rotations form the co-group Ḡ_k. |
| Grey group G_k·1′ | G_k with and without time reversal 1′: the paramagnetic symmetry. |
| Types I–IV | I: no time reversal. II: grey. III: time reversal on half the operations. IV: has an anti-translation, a lattice translation with time reversal. |
| Isotropy subgroup | The operations, with or without time reversal, that leave an order parameter unchanged. |
| Kernel, epikernel | The isotropy subgroup of an irrep in a generic direction (kernel) or a special one (epikernel). Only multidimensional irreps have epikernels. |

## Route A — magnetic space groups

**How it works**

A candidate is a subgroup of the grey group that lacks 1′ itself. Because the
enumeration keeps the parent lattice, each candidate is a pair (H, θ):

- H is a subgroup of G_k with every lattice and centring translation.
- θ marks time reversal on each rotation coset of H, read at the coset's
  representative g_i = {R_i|τ_i}. At k = 0 it is a homomorphism H → {±1}: the
  trivial θ gives type I, and any other θ gives type III.
- At a single-arm k ≠ 0, a lattice translation t carries the phase
  χ(t) = e^{2πi k·t} = ±1, and the pair is a group exactly when
  θ_i·θ_j = θ_ij·χ(t_ij) for every product g_i∘g_j = {I|t_ij}·g_ij. Where a screw
  or glide squares to a translation with χ = −1 (the c-glide of P2/c at
  k = (0,0,½), the 2₁ of Pnma at X, the 4₂ of P4₂/mnm and the 6₃ of P6₃/mmc at
  Z), no group contains that operation, and some groups are reached only by a
  θ that is not a homomorphism. The condition is solved over GF(2) as an
  inhomogeneous system: one particular solution plus the null space, or none.
  A two-arm k has complex phases; there θ stays a homomorphism, the real
  decoration of G_k the Fourier moment model uses, not a magnetic space group.

**Centred parents.** A lattice translation t multiplies a site's Fourier
coefficient by e^{−2πi k·t}, and a centring translation is a lattice
translation. Every consumer of the k-phase (allowed moments, cell expansion,
the structure factor, Route B) takes the returning translation relative to the
representative of the operation's rotation class and removes the centring part
([`centringOffsets`](../src/core/crystal/symmetry.ts)). For MnO, e^{2πi k·t} = −1
on each F centring: the centrings are anti-translations of the parent cell,
Mn(0,½,½) is antiparallel to Mn(0,0,0), and a single-arm satellite H + k needs H
in the F reciprocal lattice, so (³⁄₂,½,½) belongs to another arm of the star.
Route B counts one atom per primitive cell for the same reason. Whether k has
one arm or two is decided on that lattice too: k = (½,0,0) is self-conjugate in
a primitive cell and a two-arm k in a C-centred one
([`propagation.ts`](../src/core/magnetic/propagation.ts)).

Its index in the grey group is 2·|Ḡ_k| / |H̄|, where H̄ is the co-group of H. The
largest candidates have index 2 where a group closes on the whole of G_k, and
4 at the Z points above. A candidate is **maximal** when no other candidate
contains it (one of its groups inside one of the other's, with the same θ on
its cosets), which is containment, not index: a maximal group can sit at index
4, 6, 8 or 12. The magnetic page starts from the maximal groups that carry a
moment on the chosen ions, those no group above them gives one (the selection
of Bilbao's MAXMAGN): for MnO at k = 0, I4/mm′m′, R-3m′ and Im′m′m at indices 6,
8 and 12, while no index-2 group allows a moment on Mn.

Like k-SUBGROUPSMAG (Perez-Mato et al. 2015), the workbench lists every pair, not
only those of index 2 ([`subgroupLattice.ts`](../src/core/magnetic/subgroupLattice.ts)).
Subgroups come from breadth-first closure of generator sets, which is exhaustive,
and each θ from a linear system over GF(2). Conjugate candidates are one ordering
in different domains, so each conjugacy class is listed once, with its domain
count. Conjugation by g keeps each operation's θ, and the conjugate's θ on a
coset is read at that coset's representative, so it carries the k-phase of the
lattice vector between them.

**Supported**
- Checked against an independent oracle: every magnetic group compatible with k
  built from scratch in the magnetic cell and named by spglib, for 15 single-arm
  cases (P2/c, Pnma, P4₂/mnm, P4/mmm, Immm, P6/mmm, P6₃/mmc, Fm-3m and P2₁/m, at
  k = 0 and at zone-boundary k). Every candidate is a group, every conjugacy
  class is one of the oracle's with its domain count, none is missing, and the
  allowed moments on every split orbit agree
  ([`magneticGroupsOracle.test.ts`](../src/core/magnetic/magneticGroupsOracle.test.ts);
  the oracle is [`oracle.py`](../scripts/magnetic-groups/oracle.py)).
- Verified counts: 2/m gives 5 subgroups and 11 candidates, and mmm gives 16 and
  51. In 4mm, each pair of conjugate mirror subgroups forms one class with 2
  domains ([`subgroupLattice.test.ts`](../src/core/magnetic/subgroupLattice.test.ts)).
- At k = 0, P2₁/m gives four index-2 candidates, including the Mn₃Ga ground
  state P2₁′/m′ ([`magneticGroups.test.ts`](../src/core/magnetic/magneticGroups.test.ts)).
- MnO (Fm-3m, k = ½½½): G_k has 12 rotations, the -3m′ decoration allows only
  m ∥ [111], m ∥ [001] lives in 2′/m′, the 2×2×2 expansion obeys
  m(r) = m₀·(−1)^{x+y+z}, and the k-formalism |F_M|² matches the brute-force
  supercell sum ([`centredLattice.test.ts`](../src/core/magnetic/centredLattice.test.ts)).

**Not yet**
- Candidates over the whole star of k, and the groups of a two-arm k: the
  lattice keeps one arm and the parent lattice, its translations turned into
  anti-translations by the k-phase at a single-arm k (type IV, named in the
  magnetic cell; see BNS and OG labels).

### Allowed moment directions

An operation g sends an axial moment m to θ_g·det(R_g)·R_g·m. A site's allowed
moments solve e^{2πi k·L}·θ_g·det(R_g)·R_g·m = m for each g that maps the site
onto itself up to a lattice translation L. L is a vector of the parent's true
lattice, so an image on the site's own centred copy counts, and the centring
part of g is removed from L because its phase belongs to the lattice. The null
space gives the refinable modes
([`allowedMoments.ts`](../src/core/magnetic/allowedMoments.ts)).

For distinct ±k arms, the condition applies to the Fourier coefficient
S = ½(M^cos + i·M^sin). A mode with a nonzero sine part is then a helical or
elliptical coupling that symmetry forces.

### Split orbits

A k ≠ 0 little group or a lower-symmetry candidate can split a site's orbit. No
magnetic operation links the split orbits, so each is an independent sublattice
with its own modes. A split orbit with no allowed direction carries no moment.

The model identifies each sublattice by its orbit number, not by a stored
position, so the sublattice follows the refined site
([`orbitSplitting.test.ts`](../src/core/magnetic/orbitSplitting.test.ts)).

### Moment sizes

The model scales each mode to unit Cartesian length, so one unit of amplitude is
1 µ_B along the mode in any cell ([`momentModel.ts`](../src/core/magnetic/momentModel.ts)).
Crystal components would not do: the raw mode (−1, 1, 0) is √3 µ_B long in a
hexagonal cell. By default only symmetry constrains the amplitudes. Equal sizes
on different sublattices are a physical prior, not a symmetry requirement.

**The equal-|M| tie** adds that prior as an option, per element or across all
selected sites, with optional antiparallel flips. The sublattice with the most
modes is the reference:

- **Same mode geometry.** A sublattice shares the reference's amplitudes through
  its own modes.
- **One allowed mode.** Its amplitude is ±hypot(reference amplitudes). The
  reference's modes are first made orthonormal in the Cartesian metric, so the
  hypot is exactly |M|.

In Mn₃Ga, Cm′cm′ splits the Mn 6h orbit in two. Orbit 1 keeps the modes Mx and
Mx+2My, and orbit 2 follows |M(orbit 1)|
([`momentMagnitudeTie.test.ts`](../src/core/magnetic/momentMagnitudeTie.test.ts)).

**Not yet**
- Tying multi-mode sublattices of different geometry, which needs direction
  angles. They are reported as skipped.
- The derived tie for distinct ±k arms: a complex amplitude has no single size.
  Same-geometry sublattices still share amplitudes.

### Choosing among candidates

An ordered phase usually keeps a maximal subgroup of the paramagnetic group
(Landau theory, k-SUBGROUPSMAG practice, ITA Vol. A1). Test the maximal
candidates first, and descend the lattice only when none fits. The page opens
the index sections of the maximal groups that carry a moment.

Powder data often cannot separate symmetry-distinct models, because only the
moment component perpendicular to Q scatters and orientations are averaged
([direction ambiguity](../knowledge/magnetic_structure_symmetry_knowledge.md), §9).
Ties are therefore expected. The ranking calls fits tied when they are within
the noise of the best: Hamilton's test (Acta Cryst. 18 (1965) 502) at 5 %, so a
group with more moment parameters must lower χ² by more than the best fit's
noise gives them (an mPDF fit, which reports no χ², ties within 10⁻⁴ in Rw).
The page marks these ≈. Among them the ★ goes top-down: to a group none of the
others contains, then the lowest index, then the fewest moment parameters (the
rows its fit refines, every split orbit's modes counted and co-located ions
sharing one moment; [`momentParameters`](../src/app/magneticStep.ts)). At k = 0 the ranking refines the nuclear scale with the moments:
the magnetic peaks sit on the nuclear ones, and a scale refined without them
has taken part of their intensity.

On unpublished AWO₄ 6 K data with k = (½, 0, 0), five candidates tie within the
noise by Hamilton's test, with the nuclear model fixed: P_a2/c, P_S-1, P_ac, P_a2
and P_S1 (type IV, named in the 2a × b × c magnetic cell). The rule picks P_a2/c
(BNS 13.70), of index 2 with two moment parameters. Its moments are then refined
alone, against the same nuclear model held. The magnetic page ranks candidates by
this rule, as [USER_GUIDE.md](./USER_GUIDE.md) describes.

## BNS and OG labels

**How it works**

A magnetic group is its operation set, so naming one is exact matching of a
signature: rotation, translation modulo the lattice, and time reversal
([`bnsOg.ts`](../src/core/magnetic/bnsOg.ts)). A match gives the
Belov–Neronova–Smirnova (BNS) and Opechowski–Guccione (OG) numbers and symbol,
such as P2₁′/m′, BNS 11.54, OG 11.5.63. Otherwise the candidate keeps a label of
its primed operations, because a wrong symbol is worse than none.

**At k ≠ 0** a candidate's operations, listed in the parent cell, are not the
group of the ordered structure: a lattice translation with phase e^{2πi k·t} = −1
reverses every moment, so the group has anti-translations and is of type IV. Each
candidate is named from that group, written in the magnetic cell
(n₁a, n₂b, n₃c), nᵢ the denominator of kᵢ, the cell the mCIF exporter and the 3D
view use ([`magneticCell.ts`](../src/core/magnetic/magneticCell.ts)). Its
setting is reported against the parent cell. For P2/c at k = (½,0,0), the
candidate without time reversal in the parent cell (read alone, P2/c, 13.65)
is P_a2/c, BNS 13.70, in (2a, b, c; 0, 0, 0); the AWO₄ ground state (read
alone, the type-III P2/c′, 13.68) is P_a2/c too, in (2a, b, 2a+c; 3/4, 0, 0).
The isotropy subgroups of Route B and the report are named the same way.

[`gen_bns_og_table.py`](../scripts/gen_bns_og_table.py) generates the table:

- **Contents.** All 1651 groups: 230 of type I, 230 grey groups (type II), 674 of
  type III and 517 black-and-white lattices (type IV). For types I–III the OG and
  BNS symbols agree, and only the numbers differ; a type-IV group has its own OG
  symbol (P_a2/c is P_2a2/c). Type IV is stored as the unprimed coset
  representatives and the anti-translation, type II as the group without 1′.
- **Source.** ISO-MAG data (ISOTROPY Software Suite) via pymatgen-core, compiled
  from Litvin (2013) and Bradley & Cracknell (1972). No label is typed by hand.
- **Checks.** Every entry has an unprimed identity, the right primed count for
  its type, closure, a unique signature, and matching OG and BNS symbols for
  types I–III; a type-IV entry has exactly one anti-translation coset, and its
  compact form rebuilds the full operation set.
- **Setting.** Standard BNS: unique axis b with cell choice 1, hexagonal axes for
  trigonal groups, origin choice 2.

**Setting search.** Subgroups often come in non-standard settings, such as a
2-fold axis along a, an off-origin inversion centre, or a tetragonal subgroup
still written in its cubic parent's F cell. The search applies ITA basis
changes, R′ = P⁻¹RP and t′ = P⁻¹(Rp + t − p) (ITA Vol. A §1.5), and still
requires an exact match. It tries three families of cells, each with ¼-grid
origin shifts, and the label then reports the transformation used:

- The 24 proper signed axis permutations (det P = 1).
- Three orthohexagonal C-centred cells (det P = 2) composed with the
  permutations. These name orthorhombic and monoclinic subgroups of hexagonal
  parents, such as Cmcm and C2/m under P6₃/mmc.
- The other cells of a cubic lattice, in every orientation its point group
  allows. For a face-centred parent: the body-centred tetragonal cell
  ((a−b)/2, (a+b)/2, c), the obverse hexagonal cell of the rhombohedral
  sublattice ((−a+b)/2, (−b+c)/2, a+b+c), two C-centred monoclinic cells with
  the unique axis along a cube edge or a face diagonal, and the primitive
  rhombohedral cell (det P = ½, ¾, ½, ½ and ¼). For a primitive parent, or a
  parent given in rhombohedral axes: the obverse hexagonal cell
  (a−b, b−c, a+b+c) (det P = 3). These name the subgroups of Fm-3m that
  FindSpinGroup calls I4/mm′m′, R-3m′, Im′m′m and C2′/m′.

A cell with fractional basis vectors is used only when each of them is a
translation of the group, read off its operation list, so the transformed
translation group is exactly P⁻¹ of the old one. Before any origin shift is
tried, the transformed rotation set must match some tabulated group; this
keeps the search fast for candidates no setting can name.

When none of these families matches, and always for a group in its magnetic
cell, the search builds the group's own conventional cells. The standard cell
of a group is a conventional cell of its lattice of unprimed translations, with
its basis vectors along the symmetry directions (ITA Vol. A §2.1.3), so they are
read off the group itself, in the primitive basis of that lattice: the cube
edges, the 3-, 4- or 6-fold axis with a basis of the lattice plane normal to it,
the three 2-fold axes in every order, or the monoclinic 2-fold axis with small
unimodular bases of its normal plane (which reach the cell choices and
centrings of ITA). The origin shift is then solved, not searched: for a
generating set of the group, t + (R − I)·p ≡ t_E modulo the tabulated group's
lattice, a congruence solved exactly over the integers. The simplest cell that
matches is reported. The lattice, the isotropy result, the report and the mCIF
writer all use the search.

**Supported**
- All 1651 groups re-identify from their own operations. The four P2₁/c
  candidates get their numbers, and parents 14, 216 and 225 yield exactly their
  tabulated type-I and type-III groups ([`bnsOg.test.ts`](../src/core/magnetic/bnsOg.test.ts)).
- Every class of the 15 single-arm oracle cases, at k = 0 and at zone-boundary
  k, carries the BNS number and type spglib gives its group, every one of them
  named ([`magneticGroupsOracle.test.ts`](../src/core/magnetic/magneticGroupsOracle.test.ts)).
  The domains of one class can be enantiomorphs (P_c4₁ and P_c4₃ at the Z point
  of P4₂/mnm); the class is named by its representative.
- The search recovers an a-unique P2/m and an off-origin P-1, with primes kept.
  Under P6₃/mmc it names Cmcm and C2/m (Nos. 63 and 12) and type-III
  orthorhombic groups; its 56 setting-search labels are pinned by a snapshot
  ([`bnsOgSetting.test.ts`](../src/core/magnetic/bnsOgSetting.test.ts)).
- Under Fm-3m with k = 0 (MnO, Mn at 0,0,0) every subgroup candidate is named.
  A moment along [001], [111] or [110], or in a mirror plane, gives I4/mm′m′
  (BNS 139.537), R-3m′ (166.101), Im′m′m (71.536) and C2′/m′ (12.62), as
  FindSpinGroup does; the triclinic subgroups give P-1 and P1.
- A 3-fold group in rhombohedral axes, such as the -3m′ subgroup of Pm-3m,
  is named in hexagonal axes: R-3m′ in the cell (a−b, b−c, a+b+c).

**Not yet**
- The magnetic space groups of a two-arm k (2k not in the reciprocal lattice,
  such as (⅓,⅓,0)). Its candidates are real decorations of G_k for the Fourier
  moment model, not magnetic space groups: they are shown by their
  time-reversal pattern on G_k ("P-62′m′ (G_k decoration)"), with no BNS number
  and the note "not a magnetic space group label: two-arm k". The groups of
  such a structure need G_{±k} and the global phase in the supercell; the
  oracle fixture holds them for the two two-arm cases (113 classes each) as the
  reference for that step.
- A cell with basis coefficients beyond ±2 in the plane of a monoclinic or
  hexagonal axis is not tried; such a group keeps its primed-operation label.

## Route B — representation analysis

**How it works**

The magnetic representation Γ_mag = Γ_perm(k) ⊗ Γ_axial describes how G_k acts on
the atoms' moments. Its irreps carry the basis vectors, or magnetic modes, whose
amplitudes a refinement fits
([`magneticRepresentation.ts`](../src/core/magnetic/magneticRepresentation.ts)).

The character is χ_mag(g) = χ_axial(R_g)·Σ e^{2πi k·L}, over the atoms that g
returns to their own position up to a lattice translation L (Bertaut 1968). For
an axial vector, χ_axial(R) = det(R)·tr(R): +3 for E and inversion, −1 for a
2-fold axis or a mirror. An irrep Γ appears n = (1/|Ḡ_k|)·Σ χ_mag(g)·χ_Γ(g)*
times. Hand checks: P1 gives 3 × trivial, C2 gives A + 2B, and inversion gives
3 Ag and no Au.

### Irreps by construction, at any commensurate k

No irrep table is transcribed. The magnetic page takes the small
representations of G_k from the subgroup engine
([`representationAnalysis.ts`](../src/core/magnetic/representationAnalysis.ts),
on [ADR 0001](./adr/0001-compute-irreps-by-chain-induction.md)'s
[`spaceGroupIrreps.ts`](../src/core/crystal/irreps/spaceGroupIrreps.ts)):

- The engine builds the irreps of the whole group at the star of k, on G
  modulo the core of the magnetic cell, induced from the user's arm k. The
  top-left block of each irrep, on an operation of G_k, is its small
  representation Γ({R|v}) = e^{2πi k·v}·P(R), with P a projective irrep of the
  little co-group (chain induction). This covers non-abelian co-groups at
  k ≠ 0, and the projective representations a non-symmorphic group needs on
  the zone boundary.
- Γ_mag acts on the Fourier coefficients of the magnetic atoms of one
  primitive cell. An operation sending atom j to atom j′ plus the lattice
  vector L sends S_j to e^{2πi k·L}·det(R)·R·S_j. The multiplicities
  n = (1/|G_k|) Σ χ_mag(g)·χ_Γ(g)* come out integral, and the irreps account for
  every dimension of Γ_mag. The analysis throws when either fails.
- The basis vectors come from the transfer operators
  P_λ0 = (d/|G_k|) Σ_g Γ(g)*_λ0·Γ_mag(g). Each copy's d vectors transform by Γ
  exactly, which is checked too.
- At a single-arm k (−k ≡ k), the order parameter is real and lives in a
  physically irreducible representation. A real Γ is used in its real form, a
  complex one is realified with its conjugate, and a pseudoreal one is doubled.
- Labels are the engine's generic ones: "X irrep 2 of 4", or "k = (½, 0, 0)
  irrep 1 of 2" where the point has no standard name. The magnetic irrep that
  ISODISTORT calls mX2⁺ is the irrep X2⁺ with time reversal acting as −1.
  MATERIA shows the space-group irrep's generic label, never a CDML label
  ([ADR 0004](./adr/0004-generic-irrep-labels-in-the-app.md)).

| k, group | Small representations (dimensions) |
| --- | --- |
| k = (0, 0, ½), P6₃/mmc (Mn₃Ga; co-group 6/mmm, the 6₃ squared has phase −1) | 2, 2, 4 |
| X, Pnma (the 2₁ along a squared has phase −1) | 2, 2 |
| Z, P4₂/mnm | 2, 2, 2, 2 |
| L, Fm-3m (MnO; co-group -3m) | Γ_mag of Mn: a 1-dim irrep (m ∥ [111]) ⊕ a 2-dim one (m ⊥ [111]) |
| (½, 0, 0), P2/c (2f) | four 1-dim irreps, Γ_mag = 2 ⊕ 2 ⊕ 1 ⊕ 1 |

### Order-parameter directions and the isotropy subgroup

SARAh (Wills 2000) refines a combination of irreps. The workbench names the
magnetic group that a combination implies, then refines that group's allowed
modes.

A multidimensional irrep's group depends on the direction of its order
parameter. The directions are found by the image method, as the Subgroups page
finds them for displacive irreps (Stokes & Hatch 1988):

1. Take the image of G_k × {1, 1′}, with time reversal acting as −1. Its
   elements are θ·M(g).
2. Close the fixed spaces of these elements under intersection. Each subspace
   is a direction.
3. A subspace's stabilizer is its isotropy subgroup: the kernel for the whole
   space, an epikernel for the others.

One direction per class under G_k is listed, one-parameter directions first
and the generic one (the kernel) last. A combination's group is the
intersection of the chosen directions' groups. The group is named as a
candidate of Route A is: at k ≠ 0, the type-IV group of the magnetic cell
([`identifyCandidate`](../src/core/magnetic/magneticCell.ts)). The other irreps
whose order parameter the group allows too (secondary irreps) are listed with
it. Its allowed moments include their modes, so the moment model of a
multidimensional irrep's epikernel can have more freedom than the irrep's own
modes. For a one-dimensional irrep the two are the same.

The magnetic page models the group of the class that Route A lists. A
direction's group can be a conjugate of the listed one: the same order, in
another domain. The powder calculation reads each satellite family's |F_M|² at
one member (see [LIMITATIONS.md](./LIMITATIONS.md#magnetic-structures)), so two
domains of one class need not fit alike, and using the listed group keeps the
two routes' fits equal.

**Supported**
- On the 17 cases of the Route A oracle, every isotropy subgroup of every irrep
  and direction is a candidate of Route A. It carries the BNS number and type
  that spglib gives its group
  ([`representationAnalysis.test.ts`](../src/core/magnetic/representationAnalysis.test.ts)).
  For MnO at L, the 2-dim irrep along (a,−a) gives C_c2/c (BNS 15.90), the
  group of MnO's moments in the (111) planes. For Mn₃Ga at (0, 0, ½), irrep 2
  along (a,a) gives P_c-3m1 (BNS 164.90). For P2/c at (½, 0, 0), every irrep
  gives the type-IV P_a2/c (BNS 13.70), not the parent-cell P2/c′ (13.68).
- The previous abelian route still gives the same answers wherever it applied
  ([`representationAnalysisLegacy.test.ts`](../src/core/magnetic/representationAnalysisLegacy.test.ts)).
  On 15 cases it gives the same irreps by character, the same multiplicities,
  the same modes on the reference site, and the same isotropy subgroup for
  every real one-dimensional irrep. Its two wrong answers are listed: P2/c at
  (0, 0, ½), and Pnma at X, where ordinary irreps stood in for projective ones.
- On the synthetic Mn₃Ga page (P6₃/mmc, k = (0, 0, ½)), irrep 2 along (a,a)
  reaches the truth's group. Its moments fit to the same wR as that group's
  through the list ([`magneticStep.test.ts`](../src/app/magneticStep.test.ts)).

### Where Route B stops

| Case | Why there is no group |
| --- | --- |
| Two-arm k (−k ≢ k, such as (⅓, ⅓, 0)) | The irreps and their complex basis vectors are listed. Their magnetic groups need G_{±k} and the star, as on Route A. |
| Irreps with no modes on the chosen ions | The order is magnetically silent there (the irrep is not listed). |
| Incommensurate k | Only commensurate k (denominators up to 12) are analysed. |

## mCIF export in the right magnetic group

For k = 0 the mCIF is the parent cell in the chosen group. For a commensurate
k ≠ 0 it is the magnetic supercell in its own magnetic space group, not a P1 atom
list ([`supercellGroup.ts`](../src/core/magnetic/supercellGroup.ts)).

The writer re-expresses each parent operation in the supercell basis. It combines
each with every parent translation inside the cell, with and without time
reversal. It keeps an operation only if every atom lands on an atom of the same
kind carrying θ·det(R)·R·m.

A translation that flips every moment becomes an anti-translation in the
centring loop, so the group is type IV. One that changes the moments any other
way, as in a k = ⅓ sinusoid, is not a symmetry. The atom loop holds the
supercell's asymmetric unit.

The writer gives a BNS symbol only for a tabulated type-I or type-III match, and a
comment for a type-IV group. The candidate's own label would be wrong: for k ≠ 0
it names the parent-cell group.

For AWO₄ (P2/c, k = (½, 0, 0)), the group has 4 coset representatives, 2 centring
translations and a 9-site asymmetric unit. The file re-expands through the app's
parser to the arrangement on screen
([`supercellGroup.test.ts`](../src/core/magnetic/supercellGroup.test.ts)). For
MnO the 2×2×2 cell has 32 centring translations, 16 of them anti-translations,
with 12 representatives for m ∥ [111] and 4 for m ∥ [001]
([`centredLattice.test.ts`](../src/core/magnetic/centredLattice.test.ts)). Reading
these files in VESTA, Bilbao or GSAS-II is not yet tested.

## Open work (in order)

1. **The groups of a two-arm k**, on both routes: G_{±k}, the global phase and
   the star of k in the supercell (phase B3 of
   [PLAN_SUBGROUPS_AND_INCOMMENSURATE.md](./PLAN_SUBGROUPS_AND_INCOMMENSURATE.md)).
2. **Cosine and sine modes taken from the irreps** instead of the magnetic
   group, for a two-arm k.
3. **The powder average of a satellite family**, so that every domain of a
   class gives the same pattern (each family's |F_M|² is read at one member
   today).

[ROADMAP.md](./ROADMAP.md) (M3, M4) places this work among the other milestones.

## References

- Bertaut, E. F. (1968). *Acta Cryst.* **A24**, 217.
- Bilbao Crystallographic Server, magnetic section: <https://www.cryst.ehu.es/>.
- Bradley, C. J. & Cracknell, A. P. (1972). *The Mathematical Theory of Symmetry
  in Solids*.
- Campbell, B. J., Stokes, H. T., Tanner, D. E. & Hatch, D. M. (2006). *J. Appl.
  Cryst.* **39**, 607.
- Hermann, C. (1929). *Z. Kristallogr.* **69**, 533.
- *International Tables for Crystallography* Vol. A (§1.5) and Vol. A1,
  Wondratschek & Müller, eds.
- ISO-MAG magnetic group data, ISOTROPY Software Suite:
  <https://stokes.byu.edu/iso/magnetic_data.txt>.
- Izyumov, Yu. A., Naish, V. E. & Ozerov, R. P. (1991). *Neutron Diffraction of
  Magnetic Materials*.
- Litvin, D. B. (2013). *Magnetic Group Tables* (IUCr).
- Perez-Mato, J. M. et al. (2015). *Annu. Rev. Mater. Res.* **45**, 217.
- Rodríguez-Carvajal, J. & Bourée, F. (2012). BasIreps, *EPJ Web Conf.* **22**,
  00010.
- Serre, J.-P. (1977). *Linear Representations of Finite Groups* (Springer).
- Stokes, H. T. & Hatch, D. M. (1988). *Isotropy Subgroups of the 230
  Crystallographic Space Groups*.
- Wills, A. S. (2000). *Physica B* **276–278**, 680.

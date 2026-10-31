# Research — how ISOTROPY/ISODISTORT and the Bilbao server build subgroups, irreps, isotropy subgroups and modes

> **Status:** research note only, written 2026-10-26. No code changes. This is the
> background for a full MATERIA subgroup engine, supercells included: Track A-II
> and A-III of [PLAN_SUBGROUPS_AND_INCOMMENSURATE.md](../PLAN_SUBGROUPS_AND_INCOMMENSURATE.md),
> and the missing projective small representations noted in
> [MAGNETIC_SYMMETRY.md](../MAGNETIC_SYMMETRY.md) and `src/core/magnetic/irreps.ts`.
>
> **Sourcing rules.** Every claim cites a page or paper I opened. Where I saw only
> a bibliographic record (Crossref), the reference is marked **[not opened]** and
> nothing is claimed from its content. Anything I could not check is marked
> **[unverified]**. Statements marked **(derived)** follow algebraically from a
> cited definition. They are mine and are not quoted. IUCr journal pages, it.iucr.org
> and the Bilbao CGI programs sit behind a bot check (HTTP 403 or a Turnstile
> redirect), so for those I used author-hosted copies or tutorials.

## Sources used most

| Key | Source (opened) |
|---|---|
| SCC13 | Stokes, Campbell & Cordes (2013). Tabulation of irreducible representations of the crystallographic space groups and their superspace extensions. *Acta Cryst.* A69, 388–395. doi:10.1107/S0108767313007538 — [author reprint](https://iso.byu.edu/2013%20Stokes.pdf) |
| SvOC16 | Stokes, van Orden & Campbell (2016). *ISOSUBGROUP*: an internet tool for generating isotropy subgroups of crystallographic space groups. *J. Appl. Cryst.* 49, 1849–1853. doi:10.1107/S160057671601311X — [reprint](https://iso.byu.edu/2016%20Stokes.pdf) |
| CSTH06 | Campbell, Stokes, Tanner & Hatch (2006). *ISODISPLACE*: a web-based tool for exploring structural distortions. *J. Appl. Cryst.* 39, 607–614. doi:10.1107/S0021889806014075 — [reprint](https://iso.byu.edu/2006%20Campbell.pdf) |
| SHW91 | Stokes, Hatch & Wells (1991). Group-theoretical methods for obtaining distortions in crystals. *Phys. Rev. B* 43, 11010–11018. doi:10.1103/PhysRevB.43.11010 — [scan](https://iso.byu.edu/1991%20Stokes%20b.pdf) (pp. 11010–11012 read) |
| SHK87 | Stokes, Hatch & Kim (1987). Images of physically irreducible representations of the 230 space groups. *Acta Cryst.* A43, 81–84 — [scan](https://iso.byu.edu/1987%20Stokes%20b.pdf) (pp. 81–82 read) |
| HS85 | Hatch & Stokes (1985). Practical algorithm for identifying subgroups of space groups. *Phys. Rev. B* 31, 2908–2912. doi:10.1103/PhysRevB.31.2908 — [scan](https://iso.byu.edu/1985%20Hatch%20a.pdf) (pp. 2908–2911 read) |
| SH06 | Stokes & Hatch (2006). Introduction to isotropy subgroups and displacive phase transitions (unpublished notes) — [PDF](https://iso.byu.edu/2006%20Stokes.pdf) |
| ISO-help | [ISODISTORT help](https://iso.byu.edu/isodistorthelp.php), [version history](https://iso.byu.edu/isodistortversions.php), [ISOTROPY manual](https://iso.byu.edu/isotropy_doc.php), [ISO-IR](https://iso.byu.edu/irtables.php), [ISOTROPY for Linux](https://iso.byu.edu/isolinux.php) |
| E17 | Elcoro *et al.* (2017). Double crystallographic groups and their representations on the Bilbao Crystallographic Server. *J. Appl. Cryst.* 50, 1457–1477. doi:10.1107/S1600576717011712 — [arXiv:1706.09272v2](https://arxiv.org/abs/1706.09272) |
| ITA1-1.7 | Aroyo, Perez-Mato, Capillas & Wondratschek (2011). The Bilbao Crystallographic Server. *International Tables for Crystallography* Vol. A1, ch. 1.7, pp. 57–69 — [Bilbao-hosted copy](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) |
| SUB-tut | Elcoro, Perez-Mato & Aroyo. Tutorial on the program SUBGROUPS — [PDF](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf) |
| O09 | Orobengoa, Capillas, Aroyo & Perez-Mato (2009). *AMPLIMODES*: symmetry-mode analysis on the Bilbao Crystallographic Server. *J. Appl. Cryst.* 42, 820–833. doi:10.1107/S0021889809028064 — [Bilbao-hosted copy](https://www.cryst.ehu.eus/html/resources/bcs_workshop2022/AMPLIMODES.pdf) |
| PMOA10 | Perez-Mato, Orobengoa & Aroyo (2010). Mode crystallography of distorted structures. *Acta Cryst.* A66, 558–590. doi:10.1107/S0108767310016247 — [author preprint](https://www.cryst.ehu.eus/html/cryst/article/Mode_Crystallography.pdf) |
| AMP-tut | [AMPLIMODES tutorial](https://www.cryst.ehu.eus/cryst/tutorials/Tutorial-AMPLIMODES.pdf) |
| spgrep | [spgrep docs](https://spglib.github.io/spgrep/), [repo](https://github.com/spglib/spgrep), Shinohara, Togo & Tanaka (2023), *JOSS* 8, 5269, doi:10.21105/joss.05269 — [PDF](https://joss.theoj.org/papers/10.21105/joss.05269.pdf) |

A correction to the brief: spgrep is by **Kohei Shinohara**, Atsushi Togo and
Isao Tanaka ([JOSS PDF](https://joss.theoj.org/papers/10.21105/joss.05269.pdf)),
not Watanabe. H. Watanabe co-authored *qeirreps*, which the JOSS paper cites.

---

## 1. Subgroup enumeration

### 1.1 Vocabulary and the bound that makes enumeration finite

- **Hermann's theorem.** For any G > H of index [i] there is a unique intermediate
  group M with G > M > H. G > M is translationengleiche (a t-chain, so the point group
  drops) and M > H is klassengleiche (a k-chain, so translations are lost). The
  index factorises as [i] = [i_P]·[i_L], where [i_L] is the ratio of the
  primitive-cell volumes ([ITA1-1.7](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) §1.7.3.1.2).
  The point-group index is bounded: [i_P] ≤ 48. "The lattice index may have any value
  in principle" (*ibid.* §1.7.3.1.5). The set of k-subgroups is therefore infinite,
  and **every tool bounds [i_L]** in some way.
- **Isomorphic subgroups.** "Maximal subgroups of index higher than 4 have indices
  p, p² or p³, where p is a prime. They are isomorphic subgroups and are infinite
  in number." ITA1 lists them as parametric series, and gives those of index 2, 3 and 4
  individually (*ibid.* §1.7.2.2.2).
- **Decentring and cell-enlarging k-subgroups.** IT A sorts maximal
  k-subgroups into IIa (centring translations lost), IIb (conventional cell
  enlarged) and IIc (isomorphic) **[unverified: it.iucr.org refused automated
  access]**. For an engine the useful split is lattice-based. A decentring
  subgroup on the same conventional cell has [i_L] = f_G/f_H, and cell
  multiplication raises [i_L] above that **(derived**, with f the centring factor
  of [ITA1-1.7](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) footnote 1**)**.

### 1.2 Bilbao: database-driven, subgroup-first

| Program | What it enumerates | How it is bounded |
|---|---|---|
| [MAXSUB](https://www.cryst.ehu.eus/cryst/maxsub.html) | Maximal subgroups with index and (P,p), optionally the Wyckoff splittings | Non-isomorphic maximal subgroups, plus isomorphic ones of index 2, 3, 4 ([ITA1-1.7](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) §1.7.2.2.1) |
| SERIES | Maximal isomorphic subgroups | Listed up to index 27 (125 for cubic groups); generated online up to index 131 (*ibid.* §1.7.2.2.2) |
| [SUBGROUPGRAPH](https://www.cryst.ehu.eus/cryst/sg_graph_doc.html) | All chains of maximal subgroups G > Z₁ > … > H, the distinct H_j and their conjugacy classes | The user gives the index [G:H]. Built only on the ITA1 maximal-subgroup data of index 2–4: "the program has no access to the data on maximal isomorphic subgroups with indices higher than four" |
| HERMANN | Same as SUBGROUPGRAPH, factorised through the Hermann group M; written because SUBGROUPGRAPH "is not adequate for group–subgroup pairs of indices greater than 50" | Index ([ITA1-1.7](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) §1.7.3.1.2) |
| CELLSUB | All subgroups with [i_L] ≤ [(i_L)max], each classed as t-, k- or general | Lattice index. The form offers k-index 1, 2, 3, 4, 5, 6, 8, 9 ([CELLSUB](https://www.cryst.ehu.eus/cryst/cellsub.html); [ITA1-1.7](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) §1.7.3.1.4) |
| COMMONSUBS | Common subgroups of two or three groups | A maximum k-index and the formula units Z. The matching condition is [i₂] = [i₁](Z₁/Z₂)(\|P_G2\|/\|P_G1\|) (*ibid.* eq. 1.7.3.1; [form](https://www.cryst.ehu.eus/cryst/commonist.html)) |
| SUBGROUPS | All conjugacy classes of subgroups compatible with a given supercell, or a given set of k-vectors; a graph; filters (crystal system, point group, occupied Wyckoff positions, polar, Landau single-irrep) | The supercell or k-vectors entered. Running time is capped: with a large supercell "the maximum running time allocated for the program will be reached" ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)) |
| WYCKSPLIT | Splitting of Wyckoff orbits for a given (P,p) | n/a |

**SUBGROUPGRAPH's method** ([doc](https://www.cryst.ehu.eus/cryst/sg_graph_doc.html)).
The ITA1 data become a graph on 230 vertices. Each edge carries an index and a
set of (P,p). The chains G → H are the paths through the graph. The index is the
product of the edge indices, and the (P,p) of a chain is the product of the edge
matrices. Distinct H_j are found by transforming H's elements into G's basis and
comparing them. Conjugacy is then tested directly with elements of G. Whether
SUBGROUPS (supercell input) uses the graph or a direct construction is not stated
in the sources I opened **[unverified]**.

### 1.3 ISOTROPY: no general subgroup enumerator

The ISOTROPY tools never list "all subgroups for a supercell". Subgroups appear
only as **isotropy subgroups of irreps**, so the bound is the k-vector:

- The Stokes & Hatch (1988) book tabulates isotropy subgroups "induced at special
  k-points by a single irrep". They cannot all be tabulated, because "there are an
  infinite number of possible k-points" ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §2.2).
- In ISOTROPY, k-points off the symmetry points take rational parameters (`VALUE KVALUE`,
  "each value must be given as a ratio of two integers"). The subgroup data for k-lines
  and k-planes "are read from a special file", which the program offers to compute if
  it is missing ([manual](https://iso.byu.edu/isotropy_doc.php)).
- ISODISTORT has four search methods ([help](https://iso.byu.edu/isodistorthelp.php)).
  **Method 1** searches precomputed isotropy subgroups over all special k-points.
  **Method 2** picks a k-point (rational parameters a, b, g), an irrep and an OPD, with
  superposed irreps allowed. **Method 3** takes a point group or space-group type and a
  **supercell basis**, and "tests all orientations and origin shifts" over arbitrary
  k-points. This is the closest ISO analogue of Bilbao SUBGROUPS. **Method 4**
  decomposes an uploaded distorted structure.
- [COMSUBS](https://iso.byu.edu/comsubs.php) "finds possible paths in a reconstructive
  phase transition", following Stokes & Hatch, *Phys. Rev. B* 65, 144114 (2002) **[not opened]**.

**The ISO algebra for subgroups** ([HS85](https://iso.byu.edu/1985%20Hatch%20a.pdf), §III–IV),
which is directly implementable:

- *Characterisation* (after Senechal). A subgroup G′ < G is fixed by four things:
  a lattice T_G′ ⊆ T_G; an isogonal point group P_G′ ⊆ P_G; (A) R′T_G′ = T_G′ for
  every R′ ∈ P_G′; and (B) coset representatives {v_i + t_i | R_i} with
  v_i + R_i v_j − v_k + t_i + R_i t_j − t_k ∈ T_G′ whenever R_k = R_i R_j.
  The t_i matter only modulo T_G′, so for a fixed (T_G′, P_G′) this is a **finite**
  search over (T_G/T_G′)^|generators| **(derived)**.
- *Identification* (Steps 1–4). For each candidate standard group G^β with an
  isomorphic point group, map R′_i ↔ R^β_i and solve S D^β(R^β) = A⁻¹D^α(R^α)A S
  for a unimodular S with det S = +1. Then solve S v′_i − τ + R^β τ = v^β_i + t^β for
  the origin τ. For the isotropy subgroups at k-points of symmetry, |S_kj| ≤ 2 was
  always enough. This is the origin-shift search that `isotropyTree.ts` currently
  lacks ([PLAN A0](../PLAN_SUBGROUPS_AND_INCOMMENSURATE.md)).

### 1.4 Transformations (P,p) and standard settings

- **Convention.** (a′,b′,c′) = (a,b,c)P and O′ = O + p₁a + p₂b + p₃c. For a chain
  G > H, Bilbao's (P,p) "always describes the transformation from the reference
  (default) coordinate system of the group G" ([trmatrix](https://cryst.ehu.eus/cryst/trmatrix.html);
  [SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)). The new basis
  vectors are the **columns** of P, "not the rows!" (*ibid.*). From these
  definitions x′ = P⁻¹(x − p) and (W′,w′) = (P,p)⁻¹(W,w)(P,p) **(derived)**.
- **Bilbao differs from ITA1 here.** "In contrast to the data listed in IT A1, the
  matrix–column pairs (P,p) used by the programs of the server transform the
  standard basis of G to the standard basis of H"
  ([ITA1-1.7](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) §1.7.2.2.1).
- **Bilbao's default settings:** unique axis b, cell choice 1, hexagonal axes for
  R groups, origin choice 2 ([O09](https://www.cryst.ehu.eus/html/resources/bcs_workshop2022/AMPLIMODES.pdf) footnote 4;
  [SUBGROUPGRAPH doc](https://www.cryst.ehu.eus/cryst/sg_graph_doc.html)). SUBGROUPS
  lists each class with the (P,p) that brings the subgroup into **ITA standard setting**
  ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)).
- **ISO.** ISOSUBGROUP and ISODISTORT give the subgroup basis vectors in terms of the
  parent basis, and the origin in parent coordinates
  ([SvOC16](https://iso.byu.edu/2016%20Stokes.pdf) item 2). This is the same content as
  (P,p). ISOTROPY knows six settings and starts in `INTERNATIONAL NEW`
  ([manual](https://iso.byu.edu/isotropy_doc.php)). Since version 6.3.5, ISODISTORT
  transforms monoclinic and triclinic children "to nicer cell settings by default"
  ([versions](https://iso.byu.edu/isodistortversions.php)), so they are not always the ITA
  standard setting.

### 1.5 Conjugacy classes and domains

- A SUBGROUPS list is a list of **conjugacy classes**. The class-member view shows
  only the conjugates that keep the input supercell: conjugates "whose supercell does
  not coincide with the one of the input, are NOT shown". The class graph relates
  *classes*, "not … the specific subgroups that are listed as … representatives"
  ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)).
  *Added 2026-10-31 (THY-48):* the list's counts are entries per space-group type. A
  class of a chiral type holds both enantiomorphs (an improper operation of the parent
  turns P4₁22 into P4₃22) and appears twice. This reading reproduces all four of the
  tutorial's Fm-3m counts from MATERIA's conjugacy classes (§7).
- **Domains.** The index gives the number of domains. Its [i_L] factor counts antiphase
  domains, and its [i_P] factor counts twin (orientational) domains (*ibid.*;
  "the number of possible domains is equal to the index", [ISOTROPY manual](https://iso.byu.edu/isotropy_doc.php)).
  ISOSUBGROUP labels each domain with three integers: the external (lattice)
  orientation, the internal point-group orientation, and the translation domain
  ([SvOC16](https://iso.byu.edu/2016%20Stokes.pdf) item 5).

---

## 2. Irreps at arbitrary k

### 2.1 Little group, star and small representations

The two tool families use **opposite conventions**:

- ISO uses the row-vector action kR⁻¹. The little group is G^k = {{R|v} : kR⁻¹ ≡ k},
  and ISO writes D^k({R|v}) = exp(+2πi k·v) P^k(R) ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) eq. 1).
- Bilbao and spgrep put translations at Γ^k({1|t}) = exp(−ik·t)
  ([E17](https://arxiv.org/abs/1706.09272) eq. A1;
  [spgrep](https://spglib.github.io/spgrep/formulation/irreps/spacegroup_irreps.html)).

In the spgrep form, the little co-group is Ḡ^k = {R ∈ P : Rk ≡ k}, which in
fractional coordinates means R_fᵀk_f − k_f ∈ ℤ³. The small representation satisfies

  Γ(S_i,w_i) Γ(S_j,w_j) = exp(−ik·(w_i + S_i w_j − w_k)) Γ(S_k,w_k).

Writing Γ(R,v) = exp(−ik·v) D(R) gives a **projective representation of Ḡ^k**:

  D(S_i) D(S_j) = μ_k(S_i,S_j) D(S_iS_j),  μ_k(S_i,S_j) = exp(−i g_i·w_j),  g_i = S_i⁻¹k − k.

([spgrep, space-group irreps](https://spglib.github.io/spgrep/formulation/irreps/spacegroup_irreps.html).)
μ_k is trivial unless g_i ≠ 0 and w_j ≠ 0, so projective small representations
can arise only for **non-symmorphic** groups at the **BZ boundary** **(derived)**. This is
the case that `displaciveModes.ts` and `magnetic/irreps.ts` refuse today.

### 2.2 Induction to the full group

Choose coset representatives h_i of G with respect to G^k; they generate the
star k₁…k_d. The full irrep is block-monomial:

  D_{ij}(g) = D^k(h_i⁻¹ g h_j) if h_i⁻¹ g h_j ∈ G^k, and 0 otherwise

([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) eq. 7; [E17](https://arxiv.org/abs/1706.09272) eq. A7).
The dimension is (dim D^k) × |star|. Each block row and column holds exactly one
nonzero block. ISO also sorts the arms into ±k pairs (e = 1 or 2), so that
D({1|v}) is diagonal: block i is 𝟙·exp(±2πi k_i·v) ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) eq. 8).

### 2.3 How ISOTROPY gets them: tabulated, from Miller–Love and CDML

- "The IRs used by tools within the ISOTROPY software suite have always been based
  on the tables of Miller & Love (1967) and … Cracknell et al. (1979) (CDML)." ISO
  takes the little-group irreps from those tables and applies its own similarity
  transformations ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) §1).
- **2011 version, separated form.** D({R|v}) = T(v)P(R) (*ibid.* eq. 22). T(v) is
  analytic and block-diagonal, with blocks U_b(x_i) of cos and sin of 2πk_i·v (eq. 24).
  Only P(R), one matrix per point operator, has to be tabulated. This is what makes
  non-special k (lines, planes, general points) tabulable. The block form also shows
  which OPD components belong to which arm (§6).
- **Settings.** The matrices were built in CDML settings and are displayed in IT (2002)
  settings using D⁽²⁾(g⁽²⁾) = D⁽¹⁾(S⁻¹g⁽²⁾S) (eq. 32). After an origin change the
  translation part no longer has the T(v) form. For Pnnn in origin choice 2 the translation
  part tabulated for the glide x̄, y+½, z+½ is T(−½,½,½), where T(0,½,½) would
  normally be expected (§7.1, eqs. 33–35).
- **1988 vs 2011.** About 70 % of irreps differ from the 1988 matrices and about
  15 % from the 2007 ISO(3+1)D ones ([ISODISTORT help](https://iso.byu.edu/isodistorthelp.php)).
  The OPDs change with them. For P4₂2₁2 X₁ the 2011 matrices give (0,0,0,a) where
  1988 gave (a,0,ā,0) ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) eqs. 29–31).
  ISODISTORT made 2011 the default in v5.5 (June 2013) and dropped pre-2011 matrices
  in v6.1 (June 2014) ([versions](https://iso.byu.edu/isodistortversions.php)).
- **The data.** [ISO-IR](https://iso.byu.edu/irtables.php) offers four tables (PIR and
  CIR, each for rational k in 3D and for irrational k in (3+d)D superspace), each as
  `.xlsx` and as a zip holding a `.txt` data file and "sample Fortran source code which
  reads the data file and generates IR matrices".

### 2.4 How Bilbao gets them: computed by normal-subgroup induction

REPRES and Representations SG "calculate the irreps of space groups following the
algorithm based on a normal-subgroup induction method". The steps are: irreps of
T; their orbits under G; little groups and allowed (small) irreps; then induction
([E17](https://arxiv.org/abs/1706.09272) §III.A). The allowed irreps of G^k come from
the irreps of T by "climbing up" a **composition series**
G^k ⊳ H₁ ⊳ … ⊳ T whose factors are cyclic of prime order, in fact always "orders
2 or 3" (*ibid.* App. A, eq. A5). The induction formulae and a worked example
(P4bm, X) are in Aroyo, Kirov, Capillas, Perez-Mato & Wondratschek (2006), *Acta
Cryst.* A62, 115–128 **[not opened]**. Labels follow CDML and coincide with ISOTROPY
([REPRES](https://www.cryst.ehu.eus/rep/repres.html)). "The correct assignment of the
labels … is achieved with the help of the database of space-group irreps" of
SCC13 ([E17](https://arxiv.org/abs/1706.09272) §III.A, ref. 12). **Bilbao computes the
matrices but takes its labels from ISO-IR.** The REPRES help page reads only "There
is no help yet... Sorry." ([rep_help](https://www.cryst.ehu.eus/rep/rep_help.html)).

### 2.5 Labels and k-vector types

- **CDML labels.** A k-point label (one or two capitals) is followed by a numeral and
  possibly ±. Physically irreducible representations built from complex pairs
  concatenate two labels, such as Z1Z2 ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.2;
  [manual](https://iso.byu.edu/isotropy_doc.php)).
- **[KVEC](https://www.cryst.ehu.eus/cryst/get_kvec.html)** lists the k-vector types
  in three bases (primitive, conventional, ITA) and gives an "optimized" listing by
  reciprocal-space Wyckoff position. The paper is Aroyo *et al.* (2014), *Acta Cryst.*
  A70, 126–137 **[not opened]**. SUBGROUPS takes k-components in the **conventional**
  reciprocal basis for centred groups ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)).
- **Labels are not intrinsic.** "Even keeping a fixed specific choice of notation,
  the irrep label may change depending on the origin choice in the parent structure."
  Moving the perovskite origin from Zr to Sr turns R4+ into R5−. The label also depends
  on which k of the star is chosen, and on the setting ([PMOA10](https://www.cryst.ehu.eus/html/cryst/article/Mode_Crystallography.pdf)
  footnotes 7, 9; [SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf) ex. 3).
  ISODISPLACE likewise warns against comparing k or OPD labels across parent groups
  ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.2).

### 2.6 Reality: physically irreducible representations

- **Kinds.** An irrep is real (first kind), pseudoreal (second kind, D ≅ D* but with no
  real form) or complex (third kind, D ≇ D*). The Frobenius–Schur test is
  (1/|G|)Σ χ(g²) = 1, −1 or 0 ([E17](https://arxiv.org/abs/1706.09272) eq. 12, citing Herring,
  *Phys. Rev.* 52, 361 (1937) **[not opened]**).
- **Space-group form.** For D = D^{k,j}↑G the sum runs over the coset representatives
  {R_s|v_s} of G/T whose rotation takes k to a vector equivalent to −k:
  (1/|H_k|)Σ χ^{k,j}({R_s|v_s}²) ∈ {1, −1, 0} ([E17](https://arxiv.org/abs/1706.09272) eq. 13).
  spgrep gives the little-group version, which is nonzero only if 2k ≡ 0
  ([spgrep reality](https://spglib.github.io/spgrep/formulation/irreps/reality.html)).
- **Building the PIR.** For types 2 and 3, take D ⊕ D* and bring it to real form with
  S₂ = (1/√2)[[𝟙, 𝟙], [i𝟙, −i𝟙]] plus permutations ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf)
  eqs. 23, 49–52; [SH06](https://iso.byu.edu/2006%20Stokes.pdf) p. 3). Type-1 irreps need a
  further S₄ that ISO "determined on a case-by-case basis, a process that required a
  significant effort and involved a rather long history" ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) App. B2).
  spgrep gives a general algorithm instead. It finds a symmetric unitary intertwiner
  U with Γ(g)U = UΓ(g)* and det U = 1, then takes T = U^{1/2} with Γ′ = TΓT⁻¹
  ([spgrep reality](https://spglib.github.io/spgrep/formulation/irreps/reality.html)).
- **Defaults.** ISOTROPY's irrep labels are for physically irreducible representations,
  with complex pairs combined, such as Z1Z2 ([manual](https://iso.byu.edu/isotropy_doc.php)).
  Bilbao lists complex irreps and gives a reality index (1, −1, 0) after each label ([E17](https://arxiv.org/abs/1706.09272) §III).
  For distortions the PIR is what matters, because displacements are real.

### 2.7 Incommensurate k

ISO extends G to (3+d)-dimensional superspace. Phase shifts δ_i become internal
coordinates, and D_s({R_s|v,δ}) = Q(δ)P_s(R_s) ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) §§3–4, App. A).
ISODISTORT accepts up to three independent modulations, with irrational parameters
entered as decimals ([help](https://iso.byu.edu/isodistorthelp.php)). The general
superspace algorithm is in Stokes & Campbell, *Acta Cryst.* A73, 4–13 (2017)
**[not opened]**. I found nothing on whether Bilbao REPRES accepts irrational k
**[unverified]**. For MATERIA this stays out of scope: the commensurate engine comes
first, and incommensurate work is Track B.

---

## 3. Isotropy subgroups and order-parameter directions

### 3.1 Definitions and the image method

- **Isotropy subgroup.** For an irrep D and an OPD η, G_η = {g ∈ G : D(g)η = η}. Two
  OPDs are equivalent if η₂ = D(g)η₁, and their subgroups are then conjugate (they
  are domains). "For a given space-group IR, the list of inequivalent OPDs, and hence
  ISGs, is always finite" ([SvOC16](https://iso.byu.edu/2016%20Stokes.pdf) eqs. 1–4).
- **Kernel.** The kernel is the isotropy subgroup of the generic OPD, the operations
  mapped to 𝟙 ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §2.3; [SH06](https://iso.byu.edu/2006%20Stokes.pdf) p. 4).
- **Epikernel.** The intermediate, more symmetric isotropy subgroups are epikernels.
  The term comes from Ascher & Kobayashi (1977) **[not opened]**; MATERIA already uses
  it in [MAGNETIC_SYMMETRY.md](../MAGNETIC_SYMMETRY.md).
- **Image method.** G_η depends on D only through its **image** L = D(G), a finite
  matrix group. Compute the stabiliser L_η inside L, then pull back:
  G_η = D⁻¹(L_η) **(derived)**. More than 4000 PIRs at k-points of symmetry map onto
  only **132 images** ([SHK87](https://iso.byu.edu/1987%20Stokes%20b.pdf) abstract). This is why
  the tables close. ISOTROPY can display an irrep's image and its elements, attaches
  Landau and Lifshitz frequencies to images, and calls a transition "allowed to be
  continuous if the irrep is active and the order parameter is a possible minimum of
  the free energy expanded to fourth degree" ([manual](https://iso.byu.edu/isotropy_doc.php)).
- **Enumerating OPDs.** For each subgroup K of L, form the fixed space Fix(K). K is an
  isotropy subgroup when it is the full stabiliser of a generic vector of Fix(K). The
  OPD is Fix(K) with free parameters (a, b, …) **(derived; matches [SH06](https://iso.byu.edu/2006%20Stokes.pdf)
  example: Γ4⁻ of Pm-3m has the six invariant subspaces (a,0,0), (a,a,0), (a,a,a),
  (a,b,0), (a,a,b), (a,b,c))**.

### 3.2 How ISOTROPY tabulates them

The 1988 tables give the isotropy subgroups for special k
([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §2.2). The Linux distribution ships
`data_isotropy.txt`, `data_images.txt`, `data_irreps.txt`, `data_little.txt` and
others ([ISO Linux](https://iso.byu.edu/isolinux.php)). ISOSUBGROUP computes, for any
irrep or superposition: the OPD (with blocks per arm), the active k, the subgroup,
its basis and origin, the size (primitive-cell ratio), the index, Landau and
renormalisation-group continuity, the ferroic species (proper or improper), every
domain, and the secondary order parameters
([SvOC16](https://iso.byu.edu/2016%20Stokes.pdf) items 1–6). The worked example is
Pm-3m R3+: P1(a,0) gives I4/mmm (size 2, index 6); P2(0,a) gives I4/mcm with origin
(½,½,0); C1(a,b) gives Fmmm (index 12). Each comes with its SOP list (*ibid.* Fig. 3).

### 3.3 How ISODISTORT computes them for a given structure

- **Filter by physical type.** For a site h with site group H and site irrep Λ_j^H,
  the subduction frequency n_ijh = (1/|H|)Σ_{x∈H} χ*[Λ_i^G(x)] χ[Λ_j^H(x)] tells
  whether irrep Λ_i^G can carry displacements (Λ^H transforming as a polar vector),
  order–disorder (Λ^H = E^H) or strain (Γ irreps holding symmetric second-rank tensor
  parameters) ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.5).
- **Secondary irreps.** For an isotropy subgroup S,
  n_j = (1/|S|)Σ_{x∈S} χ[Λ_j^G(x)], summed over image elements. If n_j > 0, then Λ_j is
  primary or secondary for S (*ibid.*). "ISODISPLACE automatically couples all
  secondary order parameters" (§4.3).
- **CLIROPs.** Order parameters with the same local irrep at the same Wyckoff site
  get an "OP#" index, and their exact form depends on the irrep matrices chosen (§4.4).
- **Coupled primary irreps.** "The ISG that results from the superposition of multiple
  IRs is simply the intersection of the ISGs of the individual IRs"
  ([SvOC16](https://iso.byu.edu/2016%20Stokes.pdf) p. 1850). One domain is chosen per
  order parameter "by internal convention", and "different combinations of the
  contributing domains may lead to entirely different final distortion symmetries"
  ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.6). ISOTROPY writes coupled
  directions with domain numbers, such as P1(1)P4(3) ([manual](https://iso.byu.edu/isotropy_doc.php)).

### 3.4 Multi-k and multi-arm directions

In the 2011 block form, "the first en_k components of η describe distortions
belonging to k₁, the next en_k … to k₂ etc." ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) §6).
Two worked cases:

- **P4₂2₁2, X₁** (star k₁ = (0,½,0), k₂ = (½,0,0)). η = (0,0,a,0) involves only k₂ and
  gives P2₁ with a doubled. An equal mixture of the two arms gives C222 with a and b
  doubled (*ibid.* §6).
- **Pm-3m, X3+(a,b,0) at k = (½,0,0)** (three-arm star). The C1 OPD activates two of
  the three arms, for example (0,½,0) and (0,0,½), and gives Pban (size 4, index 24).
  All 24 domains are listed, with their own OPDs, active arms, bases and origins
  ([SvOC16](https://iso.byu.edu/2016%20Stokes.pdf) Fig. 2).

The perovskite case: R4+(a,a,0) gives Imma and M2+(a,0,0) gives P4/mbm. Coupled
as R4+M2+(a,a,0,0,0,b), they give Pnma. The same Pnma can also be reached through
the intermediate groups R4+ → Imma → X4−, or M2+ → P4/mbm → Z5+
([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.6, Fig. 3).

### 3.5 Bilbao's route: subgroup first, then irreps

SUBGROUPS lists the classes. **Get_irreps** then gives, for one subgroup, the parent
irreps compatible with it, the subspace each order parameter must lie in, and the
isotropy subgroup of each irrep. All of these are supergroups of the chosen subgroup.
A "Landau-type" filter keeps only the subgroups an irrep reaches on its own. For two
irreps, the subgroup reached is "the maximal subgroup in the graph that is a common
subgroup of the isotropy subgroups" ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)
ex. 1). The tutorial warns that Bilbao's irrep matrices "may differ from the one
chosen in that reference [ISOTROPY]", so its OPD symbols "[are] not necessarily the
same as in ISOTROPY" (*ibid.*).

---

## 4. Symmetry-mode bases

### 4.1 The projection algorithm (ISO; Bilbao inherits it through COPL)

From [SHW91](https://iso.byu.edu/1991%20Stokes%20b.pdf), eqs. 4–9 and 16–30:

1. Take a site r₀ with site group H and a local irrep Γ^H. SHW91 names three kinds
   of local distortion: displacements, changes in site occupation, and changes in
   the direction of magnetic dipoles.
2. Decompose G = Σ_m g_m H. For a supercell the sum runs over the cosets in G/T_k
   **(derived)**.
3. ψ^{Gj}_i = Σ_m θ(g_m) ψ^{Gj}_{im}, with ψ^{Gj}_{im} = Σ_{i′} D^G(g_m)*_{i′i} ψ^{Gj}_{i′1}
   and the single-site coefficients α^j_{i′k} = Σ_{h∈H} D^G(h)*_{i′j} D^H(h)_{k1}.
4. Linear independence of whole mode sets reduces to independence of the α vectors
   at the single site r₀ (eqs. 14–16).
5. The number of independent sets is n = (1/|H|)Σ_{h∈H} χ^G(h)* χ^H(h) (eq. 30).
6. For PIRs, run the test with the complex-IR basis (eqs. 21–29).

ISODISPLACE "uses the algorithm of Stokes et al. (1991) … to compute the linear
transformation from the irrep basis into the xyz basis"
([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.8). On the Bilbao side, AMPLIMODES
calls SYMMODES, and "the symmetry-mode calculation performed by SYMMODES is based on
the program COPL (Stokes & Hatch, 2002a)"
([O09](https://www.cryst.ehu.eus/html/resources/bcs_workshop2022/AMPLIMODES.pdf) p. 826). SYMMODES was
"developed in collaboration with H. Stokes and D. Hatch" ([SYMMODES](https://www.cryst.ehu.eus/cryst/symmodes.html)).
**Both tools therefore share the BYU projection core.**

### 4.2 ISODISTORT conventions

From [ISODISTORT help](https://iso.byu.edu/isodistorthelp.php) unless noted:

- **A_s:** "the square root of the sum of the squares of the mode-induced changes
  within the primitive supercell". **A_p = A_s·√(V_p/V_s)** is parent-normalised.
  **d_max** is the largest change of any atom (Å, μB, or o_max for occupancy).
- **normfactor:** a mode vector multiplied by it has a sum of squares over "all the
  atoms, not just the unique ones" of the supercell equal to 1. It is computed with
  the **unstrained** supercell basis B′.
- **Strain modes:** "the amplitude of a mode indicates the magnitude of the largest
  strain component in the mode". Normalisation was redefined in v5.5, and the
  missing CIF normfactors were added in v6.7.1 ([versions](https://iso.byu.edu/isodistortversions.php)).
- **Occupancy modes** are unitless with the same definition. **Magnetic and rotational
  modes** are in crystal-axis coordinates, with magnitudes ‖B·L⁻¹·m‖.
- **Labels** carry the parent atom with its Wyckoff site, the site-symmetry irrep (or
  "order" for occupancy), and the OPD branch. The full CSTH06 form is
  `Pm-3m[¼,¼,0]SM1(a,a,b,−b,0,0,c,c,0,0,0,0)[O:d]Eu_2(c)` ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.7).
- **Outputs:** a distortion CIF with the linear maps from amplitudes to coordinates,
  occupancies, moments and strains (ISODISTORT-specific tags), TOPAS `.str` and
  FullProf `.pcr` for refining amplitudes, the IR matrices, and a subgroup tree.
- **Method 4 (decomposition).** The basis comes from a drop-down of transformations
  whose cell parameters agree within ~10 % ("if the strains are large, the correct
  transformation may not appear"). All origin shifts are tried, and a sliding origin
  is fixed by minimising the mean displacement. Atoms are matched by nearest site, or
  by a "robust" search within a threshold that minimises the mean distance. Jobs
  stop after 30 minutes.

### 4.3 AMPLIMODES conventions

From [O09](https://www.cryst.ehu.eus/html/resources/bcs_workshop2022/AMPLIMODES.pdf) pp. 822–827 and
[AMP-tut](https://www.cryst.ehu.eus/cryst/tutorials/Tutorial-AMPLIMODES.pdf):

- **Reference structure.** The parent is transformed into the subgroup setting
  (TRANSTRU) with **idealised, unstrained** cell parameters. Displacements in Å "are
  calculated disregarding the strain"; strain is a separate component.
- **Pairing.** COMPSTRU maps each reference atom to the nearest atom of the same type,
  within a tolerance that defaults to **1 Å**. Manual pairing is asked for if that
  fails. For polar subgroups the origin is shifted to cancel any global translation.
- **Normalisation.** A = (Σ_{μ,i} mult(μ,i)|u(μ,i)|²)^{1/2}, and the basis modes are
  orthonormal with weight mult(μ,i), where mult is "the multiplicity within a
  **primitive unit cell for the space group H**". This is "not the conventional one of
  ITA for centred space groups" (eqs. 5–6, 9 and footnote 2). The tutorial checks a
  BaTiO₃ Amm2 mode summing to 1 Å² over the primitive cell
  ([AMP-tut](https://www.cryst.ehu.eus/cryst/tutorials/Tutorial-AMPLIMODES.pdf)). Each irrep gets an
  amplitude A_τ and a normalised polarisation vector.
- **Labels** follow "the notation used by ISOTROPY … essentially that of Cracknell et
  al. (1979)". Input must be in Bilbao default settings ([O09](https://www.cryst.ehu.eus/html/resources/bcs_workshop2022/AMPLIMODES.pdf) pp. 824, 826 and footnote 4).

### 4.4 Supercells: basis transform, Wyckoff splitting, atom correspondence

**WYCKSPLIT** ([ITA1-1.7](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial-Group_Subgroup.pdf) §1.7.4.1).
A general orbit O_G(X₀) splits into exactly [i] suborbits of the same multiplicity,
one for each right coset Hg_j. A special position splits by substituting its
parameters into the decomposed general orbit, then assigning each suborbit to an H
Wyckoff position by multiplicity, number of free parameters and fixed values. The
*mode* side uses the same coset decomposition as §4.1 step 2. The *correspondence*
side is pairing by tolerance (AMPLIMODES) or by mapping search (ISODISTORT).

### 4.5 A finding for MATERIA: the normalisation comment is contradicted

The header of [`distortionModes.ts`](../../src/core/crystal/distortionModes.ts) says
AMPLIMODES normalises "over its parent cell". **Both primary sources normalise over
the primitive cell of the subgroup H**, the child: ISODISTORT's A_s and AMPLIMODES's
eq. 6. Only ISODISTORT's *secondary* A_p is parent-normalised.

MATERIA weights with `siteMultiplicity` over `spaceGroup.operations`, which are
documented as "incl. centring" (`types.ts`). That makes MATERIA a
**conventional**-child-cell norm, so A_MATERIA = √f·A_s for a child with centring
factor f, and the two agree only for primitive children **(derived from the code
read; worth a unit test)**. This should be fixed or re-documented before amplitudes
are compared with ISODISTORT or AMPLIMODES output.

---

## 5. ISODISTORT and Bilbao compared

| | ISOTROPY / ISODISTORT | Bilbao (SUBGROUPS, Get_irreps, AMPLIMODES) |
|---|---|---|
| Philosophy | Irrep first: k → irrep → OPD → isotropy subgroup ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.1) | Subgroup first: supercell or index → classes → compatible irreps ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)) |
| Bound | k-point (special, or rational on lines and planes); Method 3 adds a supercell | Supercell or k-vectors; index; k-index; ITA1 index-2/3/4 maximal data |
| Irreps | Tabulated (ISO-IR, from Miller–Love/CDML), PIR by default | Computed by composition-series induction; labels matched to ISO-IR; complex with a reality index |
| Matrix form, OPD symbols | 2011 block form | May differ, so OPD symbols may not match ISO ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)) |
| Translation phase | exp(+2πi k·v), row k ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf)) | exp(−ik·t) ([E17](https://arxiv.org/abs/1706.09272)) |
| Settings | IT settings via transforms from CDML; user-chosen axes and origin; "nicer" monoclinic children | ITA defaults (b-unique, cell choice 1, hexagonal R, origin 2); subgroups given in standard setting |
| Amplitude | A_s (primitive supercell), plus A_p and d_max; strain as the largest component | Primitive cell of H, unstrained; strain separate |
| Outputs | Distortion and mode CIF, TOPAS, FullProf, ISOVIZ, domains, subgroup tree | Lists, graphs, Jmol HTML, FullProf/Jana use ([AMPLIMODES page](https://www.cryst.ehu.eus/cryst/amplimodes.html)) |

**Known disagreements and caveats users hit:**

1. The same physics carries different OPD symbols because the bases differ (above).
2. Labels change with the parent origin and the choice of k in the star
   ([PMOA10](https://www.cryst.ehu.eus/html/cryst/article/Mode_Crystallography.pdf) fn. 7, 9).
3. Mixing 1988 and 2011 ISO matrices changes the OPDs. SCC13 asks authors to state
   which version they used ([SCC13](https://iso.byu.edu/2013%20Stokes.pdf) §8).
4. The two datasets "distribute the Bloch phase differently between matrices and
   translations, so compare characters instead". So says the Crystalline.jl test of
   Bilbao against ISOTROPY little-group irreps
   ([test](https://github.com/thchr/Crystalline.jl/blob/master/test/bilbao_vs_isotropy.jl)).
   I did not check whether that test passes now.
5. **ISO-IR omits some k-points** in the representation domain outside the basic
   domain (Φ−Ω). There are 145 irreps across 20 space groups (WA, PA, HA, KA, PC
   points of SG 23, 24, 82, 121, 122, 143–145, 150, 152, 154, 157, 159, 174, 189, 190,
   197, 199, 217, 220) that Bilbao has and Crystalline.jl had to add by hand
   ([manual_lgirrep_additions.jl](https://github.com/thchr/Crystalline.jl/blob/master/data/irreps/lgs/manual_lgirrep_additions.jl)).
6. A SUBGROUPS class graph relates classes, not the listed representatives, and the
   member view hides conjugates that do not fit the supercell (§1.5).
7. Amplitudes normalised to A_s and A_p differ by √(V_s/V_p) (§4.2).

---

## 6. Algorithms for irreps at arbitrary commensurate k, for in-browser TypeScript

Notation: k-star {k_i}, and T_k = {t : k_i·t ∈ ℤ for all arms}, a sublattice that
the point group leaves invariant **(derived)**.

**(a) Finite group G/T_k.** Every irrep of the star factors through the finite group
F = G/T_k, of order |P|·[T:T_k] **(derived)**. For Pm-3m: R (one arm) has
[T:T_k] = 2 and |F| = 96; the M-star has 4 and 192; the X-star has 8 and 384
**(derived)**. In general [T:T_k] is the order of the group the arms generate modulo the
reciprocal lattice, at most N³ for a common denominator N. A general cubic star
with N = 6 can reach 216, so |F| can reach 10 368 **(derived)**.
- *Pros:* one uniform object for irreps, isotropy subgroups (subgroups of F), coupled
  multi-k analysis, and the HS85 subgroup conditions (which live in F).
- *Cons:* any |F|-dimensional regular-representation step is too large in a browser;
  you still need induction; the bases are not canonical.

**(b) Factor system and central extension of Ḡ^k.** Use μ_k from §2.1 (spgrep). Its
values lie in a finite cyclic group of roots of unity of some order m. Form the
extension {(R,z)} with (R₁,z₁)(R₂,z₂) = (R₁R₂, z₁z₂μ(R₁,R₂)), of order ≤ 48m. Take
its ordinary irreps on which z acts as the identity character, multiply by
exp(−ik·v), and induce with §2.2 **(derived construction; the projective-irrep
framing is spgrep's)**.
- *Pros:* tiny groups; works at any rational k, including lines and planes; maps
  exactly onto what MATERIA is missing.
- *Cons:* the bookkeeping of conventions (row or column k, phase sign, origin) is
  error-prone, so validate against ISO-IR characters.

**(c) Induction along a solvable chain ("Seitz-type").** Seitz (1936), *Ann. Math.*
37, 17, doi:10.2307/1968683 **[not opened]**; Neto (1973), *Acta Cryst.* A29,
464–472 **[not opened]**. This is what Bilbao does ([E17](https://arxiv.org/abs/1706.09272) App. A)
and what spgrep does by default (`method="Neto"`, a "fixed chain of subgroups of
little co-group", [core.py](https://github.com/spglib/spgrep/blob/develop/src/spgrep/core.py)).
At each prime-index step G/H ≅ ℤ_p, conjugate the projective irrep Δ
(Δ⁽ᵐ⁾(S) = μ(S,r^m)/μ(r^m,S_m)·Δ(S_m)). If the conjugates are inequivalent, Δ↑G is
irreducible and block-monomial. Otherwise find an intertwiner U with U^p = 1, and Δ
extends in p ways with Δ_q(r) = U/ω_q
([spgrep chain](https://spglib.github.io/spgrep/formulation/algorithm/irreps_from_chain.html)).
- *Pros:* deterministic, giving "unique irreps for given space groups"
  ([JOSS](https://joss.theoj.org/papers/10.21105/joss.05269.pdf)). That gives reproducible OPD
  labels. The linear algebra stays at dimension ≤ 6 per step.
- *Cons:* a chain has to be chosen per little co-group (spgrep follows ITA's chain);
  the intertwiner solve is numerical unless done exactly.

**(d) Random commutant of the (projective) regular representation.** Average a random
Hermitian H into H̃ = Σ_R Γ^reg(R) H Γ^reg(R⁻¹) and diagonalise. Each eigenspace is an
irrep. Completeness can be checked with Σd² = |G| and orthogonality
([spgrep regular](https://spglib.github.io/spgrep/formulation/algorithm/irreps_from_regular.html)).
- *Pros:* about 50 lines; a good test oracle.
- *Cons:* the basis is random, which is bad for stable OPDs; near-degenerate
  eigenvalues; the page states no tolerance control.

**(e) Dixon–Schneider characters.** GAP's `IrrDixonSchneider` computes the
irreducible characters, and needs class-multiplication coefficients. Matrices come
from Baum–Clausen for supersolvable groups, or from Dixon's method over the cyclotomics
([GAP manual ch. 71](https://docs.gap-system.org/doc/ref/chap71.html) §71.14, §71.16).
The papers are Dixon (1967), *Numer. Math.* 10, 446–450; Schneider (1990),
*J. Symb. Comput.* 9, 601–606; Dixon (1970), *Math. Comp.* 24, 707–712; Baum &
Clausen (1994), *Math. Comp.* 63, 351–359 — all **[not opened]**.
- *Pros:* exact characters, enough for mode counting, the reality test and label
  matching.
- *Cons:* no matrices, so no OPDs; too much machinery for groups of order ≤ ~600.

**Existing open implementations:**

| Package | Scope (opened) | License |
|---|---|---|
| spgrep | Linear, physically irreducible, and spinor projective irreps plus co-representations at any k, computed from spglib symmetry; symmetry-adapted bases ([README](https://github.com/spglib/spgrep)). Tests check representation property, unitarity, Σd² and uniqueness ([test_core.py](https://github.com/spglib/spgrep/blob/develop/tests/test_core.py)), not external tables. | BSD-3-Clause |
| spgrep-modulation | Isotropy subgroups on the fly and modulated supercells along OPDs from phonon modes ([repo](https://github.com/phonopy/spgrep-modulation)) | BSD-3-Clause |
| Spglib | Symmetry search, space-group type, Wyckoff, refinement, primitive cell, irreducible k-points — **no irreps** listed ([docs](https://spglib.readthedocs.io/en/stable/)) | BSD-3-Clause |
| phonopy | Irrep labels "at the Γ point … but not at non-Γ point"; primitive cell only ([IRREPS](https://phonopy.github.io/phonopy/setting-tags.html)) | not checked |
| IrRep | DFT symmetry eigenvalues using **Bilbao character tables**; the README shows no irrep generation of its own ([repo](https://github.com/stepan-tsirkin/irrep)) | GPL-3.0 |
| Crystalline.jl | Little-group irreps from **ISO-IR 2011** (CIR data), CDML labels, Herring criterion, `realify`; full irreps left to the user ([docs](https://thchr.github.io/Crystalline.jl/dev/irreps/)) | MIT ([LICENSE.md](https://github.com/thchr/Crystalline.jl/blob/master/LICENSE.md)) |
| SpaceGroupIrep | Mathematica database of Bradley–Cracknell irreps ([repo](https://github.com/goodluck1982/SpaceGroupIrep)) | GPL-3.0 |
| GAP | Character tables and irreducible representations of finite groups ([manual](https://docs.gap-system.org/doc/ref/chap71.html)) | GPL-2.0-or-later ([copyright](https://www.gap-system.org/copyright/)) |

**Recommendation for TypeScript in the browser:** use (b) and (c). Keep exact
rational arithmetic for operations, k, the factor system and cosets. That kernel
already exists in MATERIA's symmetry code and stays small: |Ḡ^k| ≤ 48. Build the
projective small irreps with spgrep-style chain induction, in complex Float64 with
snapping to exact roots of unity, then check them exactly on characters. Induce with
§2.2. Real forms come from the E17 eq. 13 test, with S₂ for types 2 and 3 and the
spgrep symmetric-intertwiner method for type 1. Use (a) only for the isotropy-subgroup
and supercell-subgroup layer, where F is the natural container. Use (d) as a
property-test oracle. Skip (e).

---

## 7. Validation resources and licensing

| Resource | Use | Terms (as checked) |
|---|---|---|
| ISO-IR `PIR_data.txt` and `CIR_data.txt`, 2011 version (about 55 MB, per [Crystalline.jl](https://github.com/thchr/Crystalline.jl/blob/master/data/misc/ISOTROPY/README.md)) | Characters and labels for every little-group irrep at special k and at parameterised k, compared character-wise | **No license on the page** ([ISO-IR](https://iso.byu.edu/irtables.php)); the paper is © IUCr ([reprint](https://iso.byu.edu/2013%20Stokes.pdf) cover). Treat as no permission to redistribute: fetch at test time, and ask Campbell before bundling. |
| ISOTROPY for Linux `iso.zip` (about 11 MB: the `iso` executable plus `data_isotropy.txt`, `data_images.txt`, `data_irreps.txt` …) | A CI oracle for isotropy subgroups, OPDs, bases and origins, and domains | No license on the page ([ISO Linux](https://iso.byu.edu/isolinux.php)); download in CI and do not vendor |
| Bilbao web outputs | Subgroup class counts and (P,p) | CC BY-NC-SA 4.0 badge on the program pages ([REPRES](https://www.cryst.ehu.eus/rep/repres.html), [MAXSUB](https://www.cryst.ehu.eus/cryst/maxsub.html)). The NC clause conflicts with shipping inside AGPL-3.0 MATERIA. Crystalline.jl ships captured Bilbao pages as separate release assets "under the Bilbao Crystallographic Server's CC BY-NC-SA 4.0 terms, rather than sitting inside an MIT-licensed repository" ([DATA-RELEASE.md](https://github.com/thchr/Crystalline.jl/blob/master/build/DATA-RELEASE.md)). The CGI programs sit behind a Turnstile bot check, so capture by hand. |
| spgrep (Python) | An oracle for projective irreps at arbitrary k; MATERIA can port its algorithm | BSD-3: compatible with AGPL-3.0 if attributed |
| Crystalline.jl `bilbao_vs_isotropy.jl` | A recipe for a cross-dataset character check | MIT code; the data inherit their sources' terms |

**Concrete golden cases from opened sources:**

- **Bilbao SUBGROUPS, class counts** ([SUB-tut](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf)):
  - Fm-3m, primitive supercell (½a−½b, ½a+½b, 2c): 99 subgroups (p. 3); 62 with "lowest
    crystal system" orthorhombic (p. 4); 20 down to point group mmm (p. 4, Fig. 1.1);
    31 Landau-type (p. 12). Pnma (2c, −½a+½b, −½a−½b; 0,¼,−¼) is reached by DT5.
    *Added 2026-10-31 (THY-48):* these are entries per space-group type, not conjugacy
    classes. There are 96 classes; the three of chiral type (P4₁/P4₃, P4₁22/P4₃22,
    P4₁2₁2/P4₃2₁2) are each listed twice, so 99 = 96 + 3. The other counts follow the
    same way: 62 = 60 + 2 (the "orthorhombic" filter keeps point groups containing
    222, mm2 or mmm, so 4/m, 4 and -4 drop out) and 31 = 28 + 3.
  - Pnma, supercell (a,b,2c): 11 classes; 4 maximal (Pca2₁, Pmc2₁, P2₁/c, P2₁/m); 8 polar.
  - Pm-3m, I-centred supercell (a+b, −a+b, 2c): 98 classes; 68 with 1a, 1b and 3d
    occupied; 10 maximal, two of them I4/mcm and differing in origin. R4+ alone gives
    6 classes, with P-1 as the kernel.
- **ISOSUBGROUP:** the Pm-3m Γ table (Fig. 1); R3+ with its SOPs (Fig. 3); X3+(a,b,0)
  with 24 domains in Pban (Fig. 2); the coupled mGM4+ ⊕ M3+ magnetic cases (Fig. 4)
  ([SvOC16](https://iso.byu.edu/2016%20Stokes.pdf)).
- **SCC13 matrices:** P4₂2₁2 X₁ (eqs. 27–28) and DT1 at β (eq. 25); Pnnn A₁ in origin
  choice 2 (eq. 35).
- **Mode counting:** BaTiO₃ Amm2 gives GM4− with amplitude 0.1649 Å and
  e = (0.174511, 0.758503, 0.253598, 0.574375)
  ([O09](https://www.cryst.ehu.eus/html/resources/bcs_workshop2022/AMPLIMODES.pdf) pp. 823–824). The
  2×1×1 cubic perovskite has 30 = 1·2+2·2+1·2+1·1+2·3+3·4+3·1 modes
  ([CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.8).

---

## Implications for MATERIA

**What a full engine needs** (each item maps onto PLAN Track A):

1. **A subgroup enumerator with supercells (A-II).** For a supercell sublattice T′
   take its point-group core T″ = ∩_R RT′ **(derived)**, and enumerate subgroups of G/T″ by the HS85
   conditions (A) and (B). Group them into conjugacy classes, and attach [i_P]·[i_L],
   (P,p) to standard setting, and domains. **Always bound the search** (by supercell,
   by k-star, or by [i_L] ≤ n, as CELLSUB does), and refuse above a measured ceiling.
2. **Standard-setting identification with an origin search,** by HS85 Steps 1–4. This
   removes the "point-group-only" fallback in `isotropyTree.ts`.
3. **Projective small irreps, induction and the PIR (A-III step 3).** This replaces
   the refusals in `displaciveModes.ts` and `magnetic/irreps.ts`.
4. **Isotropy subgroups by the image method.** Enumerate the subgroups of D(F), their
   fixed spaces and OPDs, pull back, identify, list domains, and find SOPs by
   n_j > 0. Coupled irreps are intersections, with domain choice made explicit.
5. **Modes by SHW91 site projection over G/T_k cosets,** carrying both A_s and A_p.
   Strain (largest-component amplitude), occupancy and magnetic come from the same
   machinery.
6. **Labels.** CDML labels cannot be computed; they come from a table. Match
   characters against ISO-IR at test time, or import them from ISODISTORT mode CIFs
   (PLAN A-III step 2, already planned). Until then, label honestly ("k = (½,½,½),
   irrep 4 of 10, real").

**Recommended route:** exact rational group kernel → central extension of Ḡ^k with
chain induction (spgrep "Neto"-style, deterministic) → block-monomial induction →
E17-style reality test and PIR → image-method isotropy subgroups in G/T_k → SHW91
modes. Port spgrep's algorithms (BSD-3), not its data. Bundle no ISO or Bilbao
tables.

**Validation sets:** ISO-IR CIR and PIR characters for all 230 groups (fetched in
CI); the ISOTROPY `iso` binary as a CI oracle for subgroups, OPDs and domains; the
Bilbao tutorial counts and the ISOSUBGROUP figures above as hand-written goldens;
spgrep as a Python oracle for projective irreps at arbitrary rational k; the existing
Pm-3m and Pnma subgroup goldens and the Γ_disp = 4T1u ⊕ T2u test.

**Risks:**

- **Conventions.** The phase sign, row vs column k and the origin can silently
  conjugate complex irreps or relabel them. Compare characters, never raw matrices.
- **Labels.** They depend on the origin and on the choice of k in the star.
- **Licensing.** ISO-IR and ISOTROPY data carry no license. Bilbao's NC clause bars
  bundling, and its bot wall blocks automation.
- **Combinatorics.** Supercell searches and coupled multi-k searches explode
  (ISODISTORT warns irrep tables "grow to tax or exceed the computer memory",
  [CSTH06](https://iso.byu.edu/2006%20Campbell.pdf) §4.9).
- **Numerics.** Degenerate eigenspaces and type-1 real forms; ISO needed case-by-case
  work for the latter.
- **Normalisation.** The current mode-amplitude normalisation (§4.5) does not match
  either tool for centred children.
- **Coverage.** Φ−Ω k-points are missing from ISO-IR (§5 item 5), and incommensurate k
  stays deferred to Track B.

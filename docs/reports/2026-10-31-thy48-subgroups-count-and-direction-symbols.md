# Bilbao's 99 for Fm-3m, and order-parameter directions that read as ISODISTORT's

Branch `claude/thy-48-classes-and-bases`, 2026-10-31. Linear THY-48, and the
"cleaner order-parameter bases" item left open by
[Phase 2](./2026-10-31-subgroup-engine-phase-2.md). Decisions:
[ADRs 0001–0005](../adr/).

## What changed, and why

### 1. What Bilbao's 99 counts (THY-48)

Phase 2 found 96 classes for Fm-3m in the supercell (½a−½b, ½a+½b, 2c) where
Bilbao's SUBGROUPS tutorial gives 99. The tutorial was read this time from
the server itself (L. Elcoro, J. M. Perez-Mato & M. I. Aroyo,
[Tutorial_SUBGROUPS.pdf](https://www.cryst.ehu.eus/html/cryst/tutorials/Tutorial_SUBGROUPS.pdf),
the PDF of 2018-08-16). The program's own form sits behind a Turnstile check
and was not used. The tutorial gives four counts for this case:

| Tutorial (page) | SUBGROUPS | MATERIA's conjugacy classes | + classes listed twice |
| --- | --- | --- | --- |
| all (p. 3) | 99 | 96 | 99 |
| "lowest crystal system" orthorhombic (p. 4) | 62 | 60 | 62 |
| down to point group mmm, Fig. 1.1 (p. 4) | 20 | 20, the same 20 types | 20 |
| Landau, one irrep (p. 12) | 31 | 28 | 31 |

MATERIA's enumeration is complete: a brute-force cyclic extension finds the
same 231 subgroups whose lattice is the supercell, in the same 96 classes
under G. Every published number follows from them under one rule, and none
follows without it. SUBGROUPS lists a class once per space-group type among
its members. Three of the 96 classes are of chiral type: P4₁/P4₃, P4₁22/P4₃22
and P4₁2₁2/P4₃2₁2. Fm-3m's inversion keeps the supercell and turns each
member into its mirror image, so each class holds both enantiomorphs, and
SUBGROUPS lists each of those classes twice. Two of the three are 422 and
contain 222 (62 = 60 + 2). P4₁ (point group 4) drops out of the orthorhombic
count, because that filter keeps the point groups that contain 222, mm2 or
mmm. All three are Landau-type (31 = 28 + 3). Other readings fail. Classes
under the supercell's stabilizer give 96. Classes under subsets of G
(translations, or coset representatives) give 129–131. Any reading that only
adds classes cannot give 62, below MATERIA's 69 tetragonal and orthorhombic
classes.

The tutorial's other cases have no chiral class, so both counts agree:
Pnma (a, b, 2c), 11 (p. 13), 4 maximal (p. 15), 8 polar (p. 15) and 6
Landau-type (p. 18); Pm-3m I-centred (a+b, −a+b, 2c), 98 (p. 21).

MATERIA keeps conjugacy classes under G. Its orientation and domain states,
[G : N_G(H)] and [G : H], count over the whole class, both enantiomorphs
included, and the ISOTROPY oracle compares classes too. A class now records
its `enantiomorph`, the other type named in standard setting with its own
(P_H, p_H). The Subgroups page's lattice view shows it on the class ("also
P 41 2 2 #91"). When the counts differ, the summary also gives SUBGROUPS'
count: "96 with the supercell's lattice (99 in Bilbao's SUBGROUPS,
enantiomorphs apart)". GLOSSARY gains *Enantiomorphs*.

### 2. Order-parameter directions that read as ISODISTORT's

Two causes, found by dumping every irrep's isotropy subgroups for all 230
groups in the conventional cell and for 15 parents in the 2×2×2 bound:

1. **The conjugate shown.** A class is shown by one conjugate: the one the
   parent's cell names directly when there is one, else the one with the
   simplest symbol. "Simplest" counted nonzero entries, then minus signs. So
   (a,3.732a) beat (a,-a), the same direction in another orientation. That
   accounts for every irrational symbol in the conventional cell (44, all
   one-parameter) and for Pm-3m's R3+. `simplicity` now counts coefficients
   that are not small fractions (n/d, d ≤ 6) first.
2. **The basis itself.** Fm-3m's 8-dimensional L irreps are induced from a
   2-dimensional small representation. Their real form came out turned by
   15° in every arm, so 6 of their 10 classes of one-parameter directions
   had no clean member at all. The W irreps and Fd-3m's (0,½,½) irreps had
   such classes too. The new `irreps/directionBasis.ts` rebuilds the basis
   from the directions (module comment):
   - It finds the arm blocks as the translations' isotypic subspaces.
   - It builds the first block's bases from the one-parameter directions
     inside it, each in turn as the seed.
   - It carries each basis to the other blocks along one of three rules: the
     induction's coset representatives, the factor group's first element, or
     the lowest-order coset representative.

   The current basis and the candidates are scored by their classes with no
   clean member. A basis changes only when a candidate scores strictly
   better. Signed-permutation irreps, whose directions are rational already,
   skip the search. Comparisons that differ only by rounding count as ties,
   so the choice never rests on floating-point noise; an early version did,
   and a test run caught it. The change is an orthogonal similarity applied
   to the physically irreducible representation in `irrepsOfStar`.
   Characters, image group and isotropy subgroups are unchanged.

`irreps/subspace.ts` now holds the subspace helpers isotropy.ts kept private
(moved verbatim), and `generatorsOf` moved to factorGroup.ts so both modules
can use it.

**Old → new, conventional cell (Phase 1's bound).** These are all 44 changes,
one class in each irrep. Every other symbol is unchanged.

| Child | Old → new | Parents (Γ unless marked) |
| --- | --- | --- |
| C2 #5 | (a,3.732a) → (a,-a) | P622, P6₁22, P6₅22, P6₂22, P6₄22, P6₃22, P-62m, P-62c |
| Cm #8 | (a,0.268a) → (a,-a) | P-31m |
| Cm #8 | (a,3.732a) → (a,-a) | P-3m1, R-3m, P6mm, P6₃mc, P-6m2 |
| Cc #9 | (a,0.268a) → (a,-a) | P-31c |
| Cc #9 | (a,3.732a) → (a,-a) | P-3c1, R-3c, P6cc, P6₃cm, P-6c2 |
| C2/m #12 | (a,-0.366a,a,1.366a) → (a,-a,a,-a) | R-3m at (0,0,1) |
| C2/m #12 | (a,3.732a) → (a,-a) | P6/mmm, P6₃/mmc |
| C2/c #15 | (a,3.732a) → (a,-a) | P6/mcc, P6₃/mcm |
| Cmm2 #35 | (a,0.268a) → (a,-a) | P6/mmm |
| Cmc2₁ #36 | (a,0.268a) → (a,-a) | P6₃/mcm, P6₃/mmc |
| Ccc2 #37 | (a,0.268a) → (a,-a) | P6/mcc |
| Amm2 #38 | (a,3.732a) → (a,-a) | P6/mmm, P6₃/mcm |
| Ama2 #40 | (a,3.732a) → (a,-a) | P6/mcc, P6₃/mmc |
| P4₂22 #93 | (a,0.268a) → (a,-a) | I432 at H |
| P-42m #111 | (a,3.732a) → (a,-a) | Pn-3m |
| P-42c #112 | (a,0.268a) → (a,-a) | I-43m at H |
| P-42c #112 | (a,3.732a) → (a,-a) | Pn-3n, Pm-3n |
| I-4m2 #119 | (a,3.732a) → (a,-a) | Fm-3m, Fd-3m |
| I-4c2 #120 | (a,3.732a) → (a,-a) | Fm-3c, Fd-3c |
| I-42d #122 | (a,3.732a) → (a,-a) | Ia-3d |
| P4₂/mmc #131 | (a,0.268a) → (a,-a) | Im-3m at H |

**2×2×2 bound.** Pm-3m's two 2-dimensional R irreps, R3+ among them: I4/mmm
and I4/mcm read (a,a) and (a,-a), one of them (a,0.268a) or (a,3.732a)
before. For R3+ these are the published (a,0) and (0,a) of SvOC16 Fig. 3 in
a basis turned by 45°. Fm-3m's
8-dimensional L irreps: C2/c (a,0.268a,0,0,0,0,0,0) → (a,0,0,0,0,0,0,0);
I4/mmm (a,3.732a,a,3.732a,-2.732a,2.732a,2.732a,-2.732a) → (a,0,a,0,a,0,-a,0);
I4₁/amd (a,0.268a,a,0.268a,a,0.268a,a,0.268a) → (a,0,a,0,a,0,a,0); and so on.
Only R-3m and R-3c keep √3/2-type coefficients. Fd-3m's L irreps change in
the same way. The W irreps of Fm-3m, Fd-3m and F-43m, and Fd-3m's (0,½,½)
irreps, had directions such as P-43m's (a,0,0,a,0.707a,0.707a). They now read
with 0 and ±a throughout.

## Evidence

Tests through the module interfaces:

| Check | Result |
| --- | --- |
| Bilbao, Fm-3m (½a−½b, ½a+½b, 2c): 99, 62, 20 (Fig. 1.1's types), 31 | 96 / 60 / 20 / 28 classes, 99 / 62 / 20 / 31 entries (`enantiomorph` 76/78, 91/95, 92/96); the it.todo is gone |
| Bilbao, Pnma (a, b, 2c): 11, 4 maximal, 8 polar, 6 Landau | all agree; no chiral class |
| Brute force against the HS85 search | Fm-3m added: the same 231 subgroups |
| Every one-parameter direction of the 230 groups in the conventional cell | written with 0 and ±a (2115 directions; 44 were not) |
| Pm-3m R, Fm-3m L, F-43m W (the bound's arm), R-3m (0,0,1), Fm-3m Γ | the symbols above, pinned; the F-43m W test fails on `main` |
| directionBasis on a turned irrep (Pm-3m R, Fm-3m L) | turned back; characters, D(x)D(y) = D(xy) and the isotropy classes unchanged |

Measured with scratch scripts that diff every irrep's isotropy subgroups
against `main` (not committed):

- **Conventional cell, all 230 groups.** 1750 irreps and 2951 classes, each
  class compared as its whole set of conjugate subgroups with its IT number,
  orientation and domain states and t·k: all identical. 44 representatives
  changed, all listed above. Irrational one-parameter symbols: 44 → 0. No
  basis changed at this bound.
- **2×2×2, all stars, 15 parents** (Pm-3m, Fm-3m, Im-3m, Fd-3m, Pm-3n, F-43m,
  Pn-3m, P6/mmm, P6₃/mmc, R-3m, R-3c, P4/mmm, I4/mmm, I4₁/amd, P-3m1). 497
  irreps and 4563 classes: all identical as sets of subgroups. Irrational
  one-parameter symbols: 200 → 46, and symbols of any dimension 487 → 106.
  The representative changed for 553 classes in 59 irreps, mostly where a
  basis was rebuilt. In 9 irreps (Fd-3m's W and (0,½,½), R-3c's (0,0,½) and
  (0,½,½)) a chiral class is now shown by a member of the other
  enantiomorphic type; the class is the same. A conjugate the parent's cell
  names directly never reads irrationally, before or after.
- **Cost.** `irrepsOfStar` takes longer only where a basis is searched. All
  stars of the 2×2×2 bound: Fm-3m 1.7 → 4.3 s (W 2.6 s), Fd-3m 1.6 → 6.6 s,
  Pm-3m 0.1 s either way. The isotropy analysis of those irreps takes longer
  than that (Fm-3m's 12-dimensional W, about 18 s).
- **ISOTROPY 9.6.1 oracle**, run on this branch at 42e92bf: 13/13 cases agree
  (Phase 1's 8 plus Pm-3m X, M, R and Fm-3m L, W), the same isotropy subgroups
  irrep by irrep
  ([run 41221374355](https://github.com/drthyang/materia-platform/actions/runs/41221374355)).
- **spgrep fixtures.** Compared by character, so unchanged; they pass.

## What changes for users

On the Subgroups page:

- The lattice view names both enantiomorphs on a class that holds them. Its
  summary gives Bilbao's SUBGROUPS count when it differs from MATERIA's.
- Order-parameter directions read with simple coefficients. Where the class
  is now shown by another conjugate, so are the child basis and origin that
  hovering the name shows, and the subgroup an Activate builds for a Γ irrep.
  These are equivalent domain states of the same child. For Fm-3m's I-4m2
  it is now the one with its 4-fold along c.
- Choosing a cell-multiplying k-point in the supercell view takes a few
  seconds longer for the large stars (Fm-3m's and Fd-3m's W, Fd-3m's (0,0,½)
  and (0,½,½)).

Nothing the Agent or an MCP client reads changed. `review_symmetry`, the
magnetic tools and the MCP registry do not use the irreps engine, and the
agent snapshots pass unchanged.

## What it means for the validation

Nothing under the freeze changed: no agent text, tool result, MCP output,
skill, snapshot or frozen report.

## Not done

- **The 46 directions still irrational at 2×2×2** fall into two kinds.
  - Eight-fold images (I4₁/amd and Fd-3m at (0,0,½)) are forced. Their two
    classes of mirror lines lie 22.5° apart, so one keeps √2 − 1 in any
    orthonormal basis.
  - Directions spread over three arms that a 3-fold permutes (the
    rhombohedral children at L; P3₁21 and P3₂21 at R-3m's and R-3c's
    (0,½,0) and (0,½,½)) keep √3/2-type coefficients in every basis the
    search tries. A basis carried by powers of that 3-fold might clean
    them; it is not tried.

  ISOTROPY's own image tables carry such constants too (1+√2, (1+√3)/2, …).
  LIMITATIONS says so.
- **The oracle compares IT numbers.** Where a chiral class holds both
  enantiomorphs, MATERIA and ISOTROPY may name it after different members.
  None of the 13 oracle cases has such a class. A future case could fail on
  the name alone, and the oracle could then treat a pair as one.
- **ISODISTORT's exact symbols.** MATERIA's bases are its own (ADR 0003).
  R3+ reads (a,a)/(a,-a) where ISODISTORT reads (a,0)/(0,a). Matching them
  would turn every such two-dimensional basis by 45° and change many clean
  symbols, so it is not done.

## Checks

At the head of the PR: `npm run typecheck`, `npm run lint`, `npm run build`
and `npm test` (3155 passed, 295 skipped, 0 failed at 42e92bf; the last
commit changes docs only).

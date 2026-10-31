# Subgroup engine, Phase 2: the supercell bound, the lattice inside it, and cell-multiplying irreps

Linear THY-33, project "MATERIA subgroup engine". Decisions: [ADRs 0001–0005](../adr/).
Research: [SUBGROUP_ENGINES.md](../research/SUBGROUP_ENGINES.md) §1, §3, §6, §7.

## What changed, and why

Phase 1 (#122) worked in G/ℤ³ only, so only the k-points that keep the conventional
cell were covered. Phase 2 adds a supercell bound, as ADR 0002 decided.

- **Supercell bound** (`irreps/supercell.ts`, `irreps/factorGroup.ts`).
  `factorGroup(ops, P)` builds F = G/T″, where T″ = ∩_R R·T′ is the point-group
  core of the supercell T′. The lattices are held exactly, as Hermite normal
  forms on a common (1/D)ℤ³ grid. P can be any integer matrix; rational and
  centred P are accepted too, as `{ P, centring }`. The app's default is
  2×2×2 conventional. With P = I the group is Phase 1's, element for element.
  The stars listed are those with an arm in T′'s dual.
- **Irreps** at Pm-3m X, M, R and Fm-3m L, W, X, and at every commensurate k
  in the bound. The construction is unchanged (chain induction). The
  representation self-check now runs over a generating set of F, which
  still proves a homomorphism and stays fast at 1536 elements.
- **Subgroup lattice** (`irreps/supercellLattice.ts`). This is the HS85
  search in G/T″. T_H runs over the subgroups of T/T″ that contain a
  conjugate of T′. The point group H̄ must leave T_H invariant (condition A).
  The lifts of H̄'s generators are checked one generator at a time
  (condition B, with backtracking). The output is conjugacy classes with
  their index split t·k, orientation and domain states, covering edges, the
  maximal flags, the cell-multiplying flag and the isomorphic flag. Each
  class is also marked when it has a member whose lattice is exactly the
  supercell: that is the list Bilbao's SUBGROUPS shows. The search is
  refused above a measured ceiling (|F| > 3072, or more than 60 000
  subgroups) rather than truncated.
- **Names with (P_H, p_H)** (`irreps/childSetting.ts`). A same-cell child is
  named as in Phase 1. A cell-multiplying child is first written in a reduced
  primitive cell of its own lattice. `standardSettingOf` then finds its
  conventional cell and origin, with origin grids down to 1/48 (a new
  option; the default grids are unchanged). The two transformations are
  composed.
- **Pa-3's other setting**: when no cell has matched, `standardSettingOf`
  now also tries the other cubic axis order. Pa-3 and Ia-3 lack the 4-fold
  that relates their two settings. The ISOTROPY oracle found a Pm-3m X child
  left unnamed because of this. The fallback runs only after every other
  cell has failed, so no existing name changes.
- **Isotropy subgroups** at the new k now report the active arms (the arms
  k_j with k_j·t ∈ ℤ on T_H) and a cell-multiplying flag. Image groups larger
  than 192 elements use an orbit-wise closure: one representative per orbit,
  intersected with each single fixed space. The 12-dimensional W irrep of
  Fm-3m has a faithful image of 1536 elements; it took more than 10 minutes
  with the full closure and now takes about 18 s. Images of 192 elements or
  fewer, which covers every Phase 1 case, keep the full closure. A cheap
  containment test now skips eigendecompositions in either route without
  changing which spaces are found or their order.
- **Order parameters** (`irreps/orderParameters.ts`):
  - `irrepsFor(child)`: the irreps a child allows (n_j > 0), each with its
    direction and isotropy subgroup, and whether that irrep alone reaches the
    child. This is Bilbao's Get_irreps.
  - `secondaryIrreps`.
  - `coupledIsotropy(H₁, H₂)`: H₁ ∩ gH₂g⁻¹ for every distinct conjugate of H₂,
    grouped into classes, with the domain choice g recorded.
- **Subgroups page** (`app/ui/SupercellView.tsx`): the supercell (presets,
  custom P, centring), a k-point selector, and the Irreps and Lattice views.
  Cell-multiplying children are listed and named, marked "supercell
  refinement arrives in phase 3". Activating them is not part of this phase
  (THY-34).

## Evidence

All of the following are tests run through the module interfaces.

| Check | Result |
| --- | --- |
| Bilbao SUBGROUPS, Pnma (a, b, 2c): 11 classes, 4 maximal (Pca2₁, Pmc2₁, P2₁/c, P2₁/m), 8 polar | agrees: 11, the same 4 maximal, 8 polar |
| Bilbao SUBGROUPS, Pm-3m I-centred (a+b, −a+b, 2c): 98 classes, 10 maximal, two I4/mcm at different origins | agrees: 98, 10, two I4/mcm |
| Bilbao SUBGROUPS, Fm-3m (½a−½b, ½a+½b, 2c): 99 classes, 20 down to point group mmm | 20 agrees; **96 of 99 in all: open** (`it.todo`) |
| HS85 search against brute-force cyclic extension (Pnma (a,b,2c), P4/mmm (a,b,2c), P4/mmm √2×√2×1) | identical subgroup sets |
| spgrep 0.8.0 small representations, by character | 19/19 (12 Phase 1 + Pm-3m X, M, R; Fm-3m L, W; Fd-3m L; Pnma (0,0,½)) |
| Published isotropy subgroups: Pm-3m R3+ → I4/mmm, I4/mcm, Fmmm; R4+ → 6 classes down to P-1; M3+ → P4/mbm; X3+ (a,b,0) → Pban, two arms, 24 domains; R4+ ⊕ M3+ → Pnma for one domain choice | all reproduced |
| ISOTROPY 9.6.1 oracle (opt-in workflow, run on the branch): the same isotropy subgroups irrep by irrep | 13/13: Phase 1's 8 plus Pm-3m X, M, R and Fm-3m L, W (W alone: 153 subgroups over 5 irreps). The first run found one Pm-3m X child unnamed: it was Pa-3 in its other cubic setting, which `standardSettingOf` now tries as a last fallback ([run 41196511449](https://github.com/drthyang/materia-platform/actions/runs/41196511449)) |
| Phase 1 tests (isotropy, irreps, spgrep, Subgroups page) | unchanged and passing |

On the Fm-3m total: the published sub-count (20 classes with point group ⊇ mmm)
agrees, and so do both other cases. Pnma (a,b,2c) is the case that fixed the
reading "a member's lattice is exactly the supercell": the reading "contains
it" gives 27 there. In the Fm-3m list the counts by point group are 4/mmm 8,
422 6, 4/m 4, 4mm 4, -42m 8, 4 3, -4 2, mmm 12, mm2 14, 222 8, 2/m 12, 2 6,
m 6, -1 2, 1 1. Taking the classes under the supercell's stabilizer instead of
G still gives 96. No nearby supercell gives 99. The tutorial could not be
re-read from this environment (www.cryst.ehu.eus was unreachable), so the
discrepancy stays open. It may come from what the summary's "99" counts.

## What changes for users

The PDF Subgroups page has a supercell view. A user can set a bound and then
see the irreps at cell-multiplying k-points with their isotropy subgroups, or
the subgroup lattice inside the bound. Every child is named in standard
setting; hovering a name shows its basis (P_H, p_H) from the parent's cell.
The note that cell-multiplying k-points "need a supercell (planned)" now
points to the view. Nothing activates yet. Phase 1's Γ and decentring
results, and their Activate buttons, are unchanged.

## What it means for the validation

Nothing under the agent validation freeze changed: no agent text, tool
result, MCP output, skill, snapshot, review_symmetry output or frozen report.
`identifySubgroup` without `standard` is untouched, and `standardSettingOf`
only gained an option that is off by default.

## Not done

- **Fm-3m 99 vs 96** (above): needs a look at the tutorial itself.
- **Cleaner order-parameter bases.** Some 2-dimensional real irreps are
  still written with irrational coefficients, for example R3+ (a, 0.268a)
  and Phase 1's R-3m case. A basis chosen from the one-parameter directions
  would fix these, but it changes symbols that Phase 1 pins, so it is
  deferred.
- **Activating cell-multiplying children** needs the supercell forward model
  (phase 3, THY-34).
- **Speed.** The lattice for Fm-3m in a 2×2×2-sized core (|F| = 1536) takes
  about 10 s, and naming all of its classes another 10 s. W's 12-dimensional
  irrep takes about 18 s. The page computes on request.

## Checks

At the head of the PR: `npm run build`, `npm run lint`, `npm run typecheck`, and
`npm test` (results in the PR).

# The symmetry review names a lost centring

Pull request [#PR](https://github.com/drthyang/web-refinement/pull/PR),
branch `claude/plan-4-11`, stacked on #83 (4.10, the candidates' order),
2026-10-19. Plan: [AGENT_PLAN.md](../AGENT_PLAN.md), 4.11 (approved, after
the core). Developed on the dev case `dev-cscl-wrong-centring` only.

## What was missing

The cell check flags forbidden reflections that carry intensity. At the end
of the method, `review_symmetry` lists the same-lattice (translationengleiche)
subgroups that allow them. When none did, it said "a lost centring … is
likelier", but no tool named the decentred groups or tested them. An ordered
crystal read with its sites averaged by a centring is the case: CsCl read as
body-centred puts Cs and Cl on one site of Im-3m. It shows exactly this way.
Every same-lattice subgroup keeps the centring, so none allows the h + k + l
odd reflections.

## What changed

| Change | Where |
| --- | --- |
| `decentredSubgroups`: the klassengleiche subgroups that keep every rotation and drop centring vectors. For each sub-centring (the identity alone, or one of F's face vectors), each point-group generator takes a translation from its centring coset; the group is closed and kept when it holds exactly that sub-centring. Index 2 from I, A, B, C; 4 from F to P; 3 from R. Named by the existing identifier, conjugate copies counted as domains | `core/diagnostics/symmetryReview.ts` |
| The review returns `decentred`, each with the observed forbidden reflections it allows and the vectors it lost, ordered as the candidates are (4.10) | `reviewSymmetry` |
| The reading: when no same-lattice subgroup allows them all and a decentred one does, it names that group. It says its model splits the sites the centring made one, that building it is the user's step, and that a second phase's lines are the other reading. When both kinds allow them, it names both | the same |
| The limits no longer say a lost centring is not enumerated. A larger cell still is not | the same |
| The live and MCP descriptions say so. MCP's contract pins `decentred` | `tools.ts`, `registry.ts` |

The enumeration matches the International Tables' maximal klassengleiche
subgroups by decentring:

| Parent | Decentred subgroups |
| --- | --- |
| Im-3m | Pm-3m, Pn-3n, Pm-3n, Pn-3m |
| I4/mmm | the eight: P4/mmm, P4/nnc, P4/mnc, P4/nmm, P4₂/mmc, P4₂/nnm, P4₂/mnm, P4₂/nmc |
| Cmcm | the eight: Pmcm, Pbnn, Pbnm, Pmcn, Pmnn, Pbcm, Pbcn, Pmnm |
| Fm-3m | Pm-3m, Pn-3m at index 4 |

Fm-3m has none at index 2: keeping one face vector breaks the cubic
rotations. The enumeration takes 11–55 ms for I and C groups and about 0.3 s
for Fm-3m. It runs only when forbidden reflections carry intensity.

## Known answers

| Case | Result |
| --- | --- |
| Core test: Im-3m with residual peaks at 1 0 0, 1 1 1, 2 1 0 | no same-lattice subgroup allows them; `decentred` holds Pm-3m (index 2, (½ ½ ½) lost), the only one allowing all three, and the reading names it |
| The dev case `dev-cscl-wrong-centring`, refined (scale, background, cell, B, zero) through MCP | Rw 17.9 %; 9 forbidden reflections with intensity; `decentred`: Pm-3m allows 9, Pn-3m 4, Pm-3n 3; the reading names Pm-3m |

The dev case is run here, not in CI: it simulates and refines a pattern. The
core test is the pin.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2379
tests (#83's 2378 and the new one), 265 skipped. The model-text snapshots
change by the description.

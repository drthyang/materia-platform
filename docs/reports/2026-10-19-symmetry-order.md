# The symmetry review's candidates by index

Pull request [#PR](https://github.com/drthyang/web-refinement/pull/PR),
branch `claude/plan-4-10`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 4.10.

`review_symmetry` lists the subgroups of the same lattice that allow the
forbidden reflections the refined fit leaves intensity at. Its description,
its reading and the symmetry-review skill say "smallest index first"; the
code sorted by how many of the observed reflections a subgroup allows, then
by index.

## What changed, and why

| Change | What it answers |
| --- | --- |
| The candidates are ordered by `orderCandidates` (`core/diagnostics/symmetryReview.ts`): those that allow every observed forbidden reflection first, then those that allow some, each smallest index first; at equal index, the one allowing more first | The text said smallest index first; among the subgroups that allow only some, a larger index allowing more came before a smaller one |

The subgroups that allow every reflection were already in index order (they
allow the same number), so the list the reading counts ("N subgroups allow
them all, smallest index first") is unchanged; the order of the partial ones,
and so which of them the list of eight keeps, is what moves. No tool text or
skill changes: they now say what the code does.

## Evidence

- `core/diagnostics/symmetryReview.test.ts`, "the order of the candidates":
  two that allow everything (index 4 and 2) and two that allow some (index 3
  allowing two, index 2 allowing one) come as index 2, 4, then 2, 3. `main`
  put the index-3 one before the index-2 one.
- The review's known cases (the F-43m candidate, Fd-3 keeping its d-glide, no
  candidate when nothing is forbidden) pass unchanged.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2378
tests (`main`'s 2377 and the new one), 265 skipped (live runs and
data-dependent suites).

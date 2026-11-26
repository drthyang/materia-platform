# Two eval scenarios on k-names, and a follow-up after lowering

THY-85, from the THY-73 live eval (2026-11-08). In that eval,
`pdf-lower-symmetry` (F-43m → P-42₁m in 1×1×2 on the GaTa₄Se₈ PDF demo)
only reached the X and W points. The engine's names for points on a line
of the Brillouin zone (Δ, Σ, Λ), which give the line's letter with the
point's coordinates, were never seen by a live model. Run 1 also lowered
correctly, then asked about the fit window and stopped, because the scripted
follow-up only answered a question asked before the lowering.

The owner chose to have both scenarios: one on a line point
(`pdf-line-k-subgroup`, Δ) and one on a subgroup reached only by a coupled
pair of points (`pdf-coupled-k-subgroup`, X irrep 5 + W irrep 1).

This change is to the eval harness only. No tool description, skill,
knowledge note, Copilot text or engine label changed.

## What changed, and why

**A new scenario, `pdf-line-k-subgroup`** (`src/agent/evals/scenarios.ts`).
It runs on the bundled GaTa₄Se₈ X-ray PDF demo (28-ID), the same page as
`pdf-lower-symmetry`. The user's message:

> Lower the symmetry to P-4c2 in a 1×1×2 cell (c doubled) and refine it.
> Which k-point and irrep of F-43m take the structure there?

The child was picked by asking the engine first (`list_subgroups` on the
page, bounds 1×1×2, 1×1×3, 2×2×1 and 2×2×2; 1×1×4 is above the search's
size limit). Line-point rows exist at every bound: Δ(0,0,½) and Σ(0,½,½) at
2×2×2, and Δ(0,0,⅓) and Δ(0,0,⅔) at 1×1×3. At 1×1×2, two rows are reached
by a single Δ irrep with no coupled irrep:

| Row | Group | Irreps | Modes | Variants |
| --- | --- | --- | --- | --- |
| `c24@1×1×2` | P-4c2 #116 | Δ(0,0,½) irrep 2 (a,0,0,a,0,0) | 18 | 2 |
| `c17@1×1×2` | P-4m2 #115 | Δ(0,0,½) irrep 1 (a,0,0,0,0,0) | 26 | 2 |

P-4c2 was chosen for three reasons:

- It is the only P-4c2 row within the 1×1×2 bound. P-4m2 also has a
  same-cell row, reached by X irrep 3.
- Both of its variants are reached by the same irrep. `lower_symmetry`
  labels the modes "Δ (0, 0, 1/2) irrep 2 of 4" for the default (`c24`) and
  for variant 2 (`c30`).
- It stays in the 1×1×2 cell, where one fit takes well under a second.

**A new check, `namesKIrrep`** (`src/agent/evals/checks.ts`). A reply must
name the line, its coordinates and the irrep number as the engine labels
them. The coordinates are needed because Δ is a line, not a point. A
coordinate may be written 1/2, ½ or 0.5. Up to 20 characters may fall
between the line's letter and the coordinates (for example "Δ at (0, 0,
0.5)"), and up to 30 between the coordinates and "irrep 2". A different
irrep number, a sum of irreps, the coordinates without the line, or the line
without its coordinates does not pass.

**The scripted follow-up takes a list** (`src/agent/evals/harness.ts`). Each
entry is tried in order after the messages and sent at most once. Both
lowering scenarios now use `LOWERING_FOLLOW_UPS`:

- `askedBeforeLowering` sends "Use the default variant, and go on." This
  text and its condition are unchanged.
- `askedAfterLowering` (new) sends "Refine it with the method's defaults,
  and go on." It is sent when the turn ends on an `ask_user` or on a reply
  with a question, after a successful lowering.

`pdf-lower-symmetry` gets the second answer too, because its run 1 stopped
on that question.

**A second scenario, `pdf-coupled-k-subgroup`**, on the same page. The
owner approved its wording. The target is P-42₁m #113 in the 1×1×2 cell,
the group of `pdf-lower-symmetry`. The engine reaches it only by the
coupled pair "X irrep 5 (0,0,a,-a,-a,a) + W irrep 1 (a,0,0,a,0,0)": class
`c45@1×1×2`, 44 modes, 4 variants. ISOTROPY gives the same pair. The labels
are the engine's: `list_subgroups` writes the row as above, and
`lower_symmetry` names the modes "X irrep 5 of 5" and "W irrep 1 of 4".
Unlike `pdf-lower-symmetry`, the user asks which k-points and irreps take
the structure there, so the reply is graded on naming them.

**A new check, `namesIrreps`** (`src/agent/evals/checks.ts`). One sentence
of a reply must name every irrep of the pair as the engine labels it:
"X irrep 5" and "W irrep 1", in either order. The order-parameter
directions and "of 5" / "of 4" are optional. The check fails when either
irrep is missing, when the two are in different sentences, when an irrep
number differs (X irrep 3, W irrep 2, X irrep 55), when the point is not
named (k = (0, 0, 1) irrep 5), and when any reply, in any sentence,
asserts Δ as the k-point ("Δ (0, 0, 1/2)", "Δ irrep 2", "the Δ line", or a
hedge such as "Δ or X"). ΔRw, ΔPDF, Δr and Δ-PDF do not count as Δ.

A correct exclusion of Δ does not fail. A mention of Δ is taken back only
when one of a fixed list of patterns stands right next to it, in the same
clause (the list is written beside the check):

- before Δ, with an optional "the" between: "not Δ", "no Δ", "isn't Δ" (any
  n't), "is not Δ", "never Δ", "rules out Δ", "ruled out Δ", "excludes Δ",
  "excluding Δ", "excluded: Δ";
- after it: "Δ … is ruled out", "Δ … is excluded", "Δ … does not apply".

Any other mention asserts Δ. A negation farther away or in another clause
("Not X alone, but Δ (0, 0, 1/2)") does not count, and a reply that excludes
Δ in one sentence and gives it as the answer in a later one fails.

### The first scenario's wording (approved by the owner)

- Message: "Lower the symmetry to P-4c2 in a 1×1×2 cell (c doubled) and
  refine it. Which k-point and irrep of F-43m take the structure there?"
- Follow-up before a lowering (unchanged): "Use the default variant, and go
  on."
- Follow-up after a lowering (new): "Refine it with the method's defaults,
  and go on."
- Checks, as named in a report:
  1. reads the method first (shared)
  2. lists the subgroups before lowering
  3. names the k-point and irrep as the engine labels them: Δ (0, 0, 1/2)
     irrep 2
  4. lowers the symmetry to P -4 c 2 #116, in its own cell, 1×1×2
  5. refines the lowered model
  6. asks for no CIF of the subgroup
  7. does not end on a promise to act

### The second scenario's wording (approved by the owner)

- Message: "Lower the symmetry to P-42₁m in a 1×1×2 cell (c doubled) and
  refine it. Which k-points and irreps of F-43m take the structure there?"
- Follow-ups: the same two as above (`LOWERING_FOLLOW_UPS`).
- Checks, as named in a report:
  1. reads the method first (shared)
  2. lists the subgroups before lowering
  3. names the k-points and irreps as the engine labels them: X irrep 5 +
     W irrep 1
  4. lowers the symmetry to P -4 21 m #113, in its own cell, 1×1×2
  5. refines the lowered model
  6. asks for no CIF of the subgroup
  7. does not end on a promise to act

## Evidence

All of it is offline: a scripted model, no key, no live run.

- `evals.test.ts`, scenario `pdf-line-k-subgroup`:
  - The good replay passes all seven checks, also with the tools offered by
    stage. It lists, lowers to the default, holds the cell, refines (Rw
    16.53 → 14.51), and names "Δ (0, 0, 1/2) irrep 2 of 4".
  - The bad replay does the same but says "reached by the X point, k = (0,
    0, 1), irrep 2". It fails the naming check.
  - Each replay takes about 0.4 s.
- `evals.test.ts`, scenario `pdf-coupled-k-subgroup`:
  - The good replay passes all seven checks, also with the tools offered by
    stage. It lists, says "reached only by X irrep 5 (0,0,a,-a,-a,a) and W
    irrep 1 (a,0,0,a,0,0) together", lowers to the default, holds the cell,
    fixes one mode of each pair that correlates at the kick (mode_16,
    mode_17) and refines (Rw 16.47 → 13.57; the first refine is refused for the two correlated pairs, as the tool says).
  - The bad replay names only "X irrep 5". It fails the naming check and
    passes the other six.
  - "catches a coupled pair named as the line point, or by another irrep":
    the good run with its answer changed to "Δ (0, 0, 1/2) irrep 2", or to
    "X irrep 3 + W irrep 1", fails the naming check alone.
- `evals.test.ts`, "answers a question after lowering with the method's
  defaults" (3 s):
  - A run that lowers and then asks about the fit window gets the new
    answer, and goes on to pass every check.
  - A run that asks before and after lowering gets both answers, in order.
  - On `pdf-lower-symmetry`, a reply that asks after lowering gets the same
    answer.
  - A run that ends on an answer hears nothing more.
- `graders.test.ts`, `namesKIrrep`: the engine's label passes when written
  with ½, 1/2 or 0.5. Irrep 1, "irreps 2⊕4", "k = (0, 0, 1/2), irrep 2",
  "the Δ line, irrep 2", the X point, and Δ (0, 0, 1/4) all fail.
- `graders.test.ts`, `namesIrreps`:
  - Passes: the pair with or without the directions, in either order, with
    "of 5" / "of 4", beside a ΔRw (4 replies); the pair with Δ excluded by
    each pattern of the list (7 replies).
  - Fails: one of the pair, the pair split over two sentences, another irrep
    number, the point unnamed, another point (8 replies); Δ asserted beside
    the right pair, as "Δ (0, 0, 1/2) irrep 2", "the Δ line", "Δ irrep 2", a
    hedge "Δ or X", or with a negation not next to it (7 replies); Δ
    excluded in one sentence and given as the answer in a later one.
- **Every existing scripted eval result is unchanged.** Every scripted run
  was dumped to the last bit (the good, stage-scope and bad replays, the
  extra failure replays, each page's fresh `get_state` and
  `assess_refinement`, and the misfit and impurity pages), first at `main`
  (7b415a8), then at this branch. After the wall-clock time was blanked, the
  166 keys of `main` are byte-identical on the branch. The only new keys are
  the four of `pdf-line-k-subgroup`. The dumps are kept outside the
  repository.
- **Again for the second scenario**, rebased onto `main` (6044d07): the dump
  at `main` and at the branch. The 166 keys of `main` are byte-identical on
  the branch; the only new keys are the four of each new scenario. The
  branch's dump is also byte-identical to the one taken before the Δ
  exclusion list was added, so the list changes no scripted result.

## What changes for users

Nothing in the app, the Copilot or MCP. In a live eval, the new scenario
runs, and a question after a lowering in either PDF lowering scenario gets
an answer instead of ending the run.

## What it means for the validation

Arm A's pinned results, the model-text snapshots and `docs/AGENT_TOOLS.md`
are unchanged. `docs/AGENT_EVALS.md` now states 64 of 72 checks shown to
catch their failure (it was 62 of 69). The three new checks are the two
naming checks, which the bad replays catch, and the P-4c2 lowering check,
which no replay fails yet. The second scenario's lowering check is the one
`pdf-lower-symmetry` already has.

## Not done

- **The live run waits for the owner.** No model has run either scenario.
- **Only Δ is covered.** Σ(0,½,½) rows exist at 2×2×2 (for example I-43m
  #217 in 2×2×2, Σ irrep 1). They were not tried, because a fit in that
  cell is slower. No Λ row appeared within the bounds probed.

## Checks

At the branch's head with the second scenario, rebased on `main`
(6044d07):

- `npm run build` and `npm run lint`: clean.
- `npm test` without `MATERIA_DATA_DIR`: 431 files passed, 42 skipped; 3885
  tests passed, 401 skipped, none failed (174 s).

At the branch's head, before this report's own commit (first scenario):

- `npm run build` and `npm run lint`: clean.
- `npm test` without `MATERIA_DATA_DIR`: 422 files passed, 38 skipped; 3770
  tests passed, 343 skipped, none failed (221 s).

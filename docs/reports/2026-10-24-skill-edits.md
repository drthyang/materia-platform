# The skill edits of the backlog

Pull request [#102](https://github.com/drthyang/materia-platform/pull/102),
branch `claude/materia-backlog` and the branches merged into it, 2026-10-24.
The skills are the owner's text. The code changes of M3, M4 and M7 left them
untouched and proposed wording for the owner's review; these commits apply
it, with the owner's revisions and the owner's own esd caveat.

## What changed

| Skill | Edit | Commit | Follows |
| --- | --- | --- | --- |
| `pdf-workflow`, `sc-workflow`, `my-rietveld-workflow` | The "Ask the user" bullet of the Gates: "In the app, put such a decision with `ask_user`: one question, the options as you would say them; the change itself still asks." | `cfecf94`, `150b6b5` | [M3b](./2026-10-24-clickable-choices.md) |
| `my-rietveld-workflow` | The written report: `summary` is a brief account, the approach in a sentence | `9fe6e18` | [M7](./2026-10-24-concise-reports.md) |
| `magnetic-analysis` | Nuclear first stays the standard. The exception is magnetic Bragg intensity comparable to the nuclear, on nuclear reflections (large moments; `k0Magnetic` on neutron data): the scale, background and cell, then k, with the misfit peaks included in the k-search or k = 0 set; Stage 4 refines positions, profile and B's with the moments | `bb8cbac`, revised in `1e97d0b` | [M4](./2026-10-24-strong-magnetic-peaks.md) |
| `my-rietveld-workflow` | The Magnetic bullet: hand off once the nuclear structure is refined as fully as the data allow. In the exception above, hand off before the positions; they, the profile and the ADPs refine with the moments in the joint step, by this method's order and rules. A nuclear-only fit of such data is not judged by the acceptance bar | `150b6b5`, revised in `1e97d0b` | M4 |
| `my-rietveld-workflow` | The Stopping rule ends with the esd caveat: esds understate the uncertainty when the residuals are serially correlated or the model is incomplete (GoF ≫ 1), and mean little on a bound or in a strongly correlated pair; judge those with `bayesian-check` and the physics | `9ac6cbd`, corrected in `c951738` | the owner |
| `magnetic-analysis` | The exception's evidence is described as "a simulated k = 0 test" instead of naming the compound, which a held-out scenario uses | `5d2310f` | `heldOut.test.ts` |

**Trims to stay within budget.** `my-rietveld-workflow` has a cap of 24 000
characters (0.4 of a 32 k local window), with its outline under 3 000. To fit
the additions, 21 sentences or clauses were cut, 830 characters in all. Each
one restated a rule that the skill states elsewhere, mostly in the Gates,
which the outline keeps whole. Some examples:

- "the largest shift below 0.1 esd and hasn't railed to a bound" in the
  Stage 1 intro, which the Gates' "block done" holds word for word;
- the GoF's definition in the acceptance bar, given in the Gates;
- "never change the model yourself" in the symmetry review, held by the
  Gates' "Ask the user";
- the pointer to `rietveld_notes`, which its References entry describes.

No threshold, gate or tool name changed.

## Evidence

- After the edits, `my-rietveld-workflow`'s body is 23 984 characters of
  24 000, as `skills.ts` measures it, with an outline of 2 989 of 3 000.
  `magnetic-analysis` is about 9 500 of 10 000. One intermediate draft put
  the outline at 3 004, and the lint failed it until another cut.
- The names the new text uses (`ask_user`, `find_unexplained_peaks`,
  `k0Magnetic`, `bayesian-check`) are real. The skill lint's tool check passes
  for every skill.
- `heldOut.test.ts` failed once `bb8cbac` named the held-out compound in
  `magnetic-analysis`, and passes after `5d2310f`. That test scans the skills
  and the knowledge notes, not `docs/`.
- `skills.test.ts`, `skillLint.test.ts`, `method.test.ts`,
  `modelText.test.ts`, the stage-0 and validation tests, `chat.test.ts`,
  `askUser.test.ts` and `strongMagneticPeaks.test.ts`: 140 of 140 before and
  after each round, with no snapshot change.

## What changes for users

The Agent reads the new rules: put a decision with `ask_user`, keep the
report's account brief, hand off at k = 0 when the magnetic intensity is
comparable to the nuclear, and do not trust an esd alone where it means
little.

## What it means for the validation

Arm B reads `my-rietveld-workflow` on every case, so arm B runs from here on
read the edited method. No case has a magnetic phase, so the k = 0 exception
does not come into play there. Arm A and arm C do not read skills.

## Not done

- `my-rietveld-workflow` is 16 characters under its cap. The next addition
  needs a cut.
- `sc-workflow` and `magnetic-analysis` remain drafts, not yet the user's
  method.

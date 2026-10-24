# Choices to click, and the Agent's own questions (`ask_user`)

Pull request [#102](https://github.com/drthyang/materia-platform/pull/102),
branches `claude/clickable-choices` (`3cf476d`) and `claude/ask-user-tool`
(`4c78c1a`, skills `cfecf94`), merged into `claude/materia-backlog`,
2026-10-24. Backlog item M3: the choices the conversation leaves to the user,
k-vectors among them, as buttons. M3b: a generic question tool, added at the
owner's decision (2026-10-24) although it changes the model-visible tool list
before the validation freeze ([AGENT_PLAN.md](../AGENT_PLAN.md), "Approval").

## What was wrong

- **Choices were prose only.** The k-search, the group ranking and the next
  steps return structured results. The model paraphrased them, and the user
  typed an answer back. Nothing in the transcript could be clicked but the
  card chips and Approve/Decline.
- **A k label did not read back as itself.** `set_propagation_vector` refused
  glyphs that `kLabel` prints: the minus sign U+2212 ("(¼ 0 −¼)") and ⅔ ¾ ⅙ ⅚.
  `kLabel` rounded anything outside its glyph table to three decimals, so a
  centred lattice's (0 0 4/3) read "(0 0 1.333)" and, copied back, set a k
  3.3 × 10⁻⁴ away from the search's.
- **A question the method leaves to the user had no form.** "Free the B's or
  the occupancies?" got no buttons, since no tool lists it.

## What changed

| Change | Where |
| --- | --- |
| `choicesFor` builds a choice set from a read tool's own result: the k found (complete matches first, ★ the search's simplest, up to 6), the groups ranked (best wR first, ★ the ranking's best, "within the noise" noted) and the next steps. Each option has a label, a detail line and the exact message a click sends: "Set the propagation vector to k = (1/2, 0, 0)." | `agent/choices.ts` (new) |
| The k set says what k is in: reciprocal-lattice units of the cell as loaded, "the conventional, centred cell, not the primitive one" for A, B, C, F, I, R | `kNote` |
| The executor attaches the set and the page's stamp to the activity entry. The model-visible result is unchanged | `executor.ts` |
| The drawer shows the last finished turn's set live. Earlier sets are superseded, and none shows while a turn runs or after a later change in the same turn. Native buttons (Tab, Enter, Space), ★ for the recommended one. "Another k… / Another group… / Something else…" puts an editable template in the message box | `AgentDrawer.tsx`, `workbench.css` |
| A click is checked again: no turn running, no user message since, the page's stamp unchanged. A stale set shows a notice and sends nothing | `useAgent.ts` `choose` |
| `set_propagation_vector` reads both minus signs and every glyph `kLabel` prints. `kLabel` prints an exact n/d (d ≤ 12) before falling back to decimals: (0 0 4/3) | `magneticTools.ts`, `kSearch.ts` |
| **`ask_user`** (M3b): a question with 2–6 options (unique labels, each with the message it sends), and an optional placeholder for "Something else…". It shows as a choice set without a ★, and ends the model's turn: later calls in that reply are answered "Not run" | `tools.ts` (`endsTurn`), `chat.ts`, `executor.ts` |
| Its text goes through `{{…}}` references (an unknown one is refused). The final-answer checks read the question, so a conclusion cannot ride on it past the evidence gate. A clicked option's numbers are not counted as the user's by the report's number audit | `executor.ts` `heard`, `chat.ts` |
| A change an option asks for still goes through its change tool and approval card | — |
| `pdf-workflow`'s and `sc-workflow`'s "Ask the user" bullets say to put such a decision with `ask_user` (`my-rietveld-workflow`'s, in [the skill edits](./2026-10-24-skill-edits.md)) | `.claude/skills/` |

`ask_user` is in-app only: no live tool is an MCP tool, and an MCP client has
its own way to ask its user.

## Evidence

- **Round trip.** Over 1000 searchable k (i/n with n ∈ {2, 3, 4, 6}, sign
  variants, integer cosets 0 and 1) go through the message and back through
  `set_propagation_vector` to within 10⁻¹²; the grid fractions are bitwise
  equal. The glyph and 4/3 tests fail on the old `kSearch.ts` and
  `magneticTools.ts`.
- **Through the executor** (`choicesFlow.test.ts`, the synthetic k = (0 0 ½)
  magnetic session): the ★ option is "k = (0 0 ½)", it sends "(0, 0, 1/2)",
  and every option's triple sets exactly its candidate's components. The
  stamp moves afterwards, so the old set goes stale.
- **`ask_user`** (`askUser.test.ts`, 13 tests): the schema's accept/reject
  table; the entry and its stamp on all three pages; a reply
  [get_state, ask_user, set_free] runs the first two, answers set_free "Not
  run", and makes one request; a failed `ask_user` does not end the turn;
  "The fit is excellent now." with `ask_user` after a refinement is sent back
  by the evidence gate; a clicked "…wR of 7.31 %." stays unverified in the
  report, the same words typed stay the user's. With the exclusion, the gate
  and the early return removed, 4 of the 13 fail.
- **In the browser**, headless Chromium with the Messages API mocked (no
  provider), `scripts/agent-choices-check.mjs` 18/18 and
  `scripts/agent-ask-user-check.mjs` 16/16. The clicked option, the user's
  bubble and the request's last user message are the same text. Tab and Enter
  reach the buttons. A superseded or stale set sends nothing. The question
  turn makes one request. A change after a click shows its approval card in
  Ask first. Both checks pass again at the merged head.

## What changes for users

The k, group and next-step results, and the Agent's own questions, come with
buttons that send exactly what the user could have typed. A typed answer
still works. Transcripts are not saved, so projects do not change.

## What it means for the validation

- M3 changes no tool text: the model-text snapshots are unchanged.
- M3b adds one tool to arms B and C. Both snapshots gain only the
  `### ask_user` section, the README count goes from 60 to 61 tools, and the
  tool table is regenerated. A prose question also ends a turn, so a
  scenario's flow is the same either way. Local-tier prompts grow by about
  1.5 k characters, and the 2026-10-12 tier numbers predate that.
- Arm A does not use the Agent: unchanged.

## Not done

- The stamp is the approval stamp. It does not cover the k-search's peak
  selection, so re-ticking peaks leaves a k set live (its k stay legal).
- `kText`, magnetic_state's current k and the approval-card line, still
  prints four significant figures. Display only.
- A user typing exactly an option's message while the question is open is
  treated as the click: its numbers are not counted as theirs.

## Checks

At `3cf476d`: build, lint, typecheck and `npm test` pass, 2510 tests, 253
skipped. At `4c78c1a`: 2523 tests, 253 skipped. At the backlog's merged head
(`23c1d88`): 2638 tests, 253 skipped, and both browser checks pass.

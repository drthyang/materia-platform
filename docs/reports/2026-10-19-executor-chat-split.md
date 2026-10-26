# The executor and the chat, each split by what it does (3.4)

Pull request [#100](https://github.com/drthyang/materia-platform/pull/100),
branch `claude/plan-3-4`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 3.4. The review found that `executor.ts`
held the dispatch, the approval flow, the firm rules, the correlation guard,
the record's notes and the report, and that `chat.ts` held the provider
transports, request sizing, the loop guards and the loop itself. Each was over
900 lines.

No behaviour change: no test changed, and the full suite passes as before.

## What moved

| From | To | What |
| --- | --- | --- |
| `executor.ts` (911 lines) | `executor.ts` (565) | The dispatch: a call routed to its handler; a change gated, planned, asked, checked again after its card, made as the agent, and answered (`changeOutcome`, `outcomeLine`); `allow_exception`'s approval |
| | `executorPolicy.ts` (142) | What holds a call back: the method gate (`methodGate`), the firm rules and the method's order (`firmRules`), the correlation guard before a refinement (`correlationGate`) and the pairs that developed during it (`developedCorrelations`), the symmetry review's gate (`symmetryNotYet`), a change approved on a page that changed (`staleReason`); `Refusal` and `RefusalKind` |
| | `executorRecord.ts` (354) | What a call leaves: the stages done (`syncStages`), a note (`addNote`), the readings kept in the record (`noteRead`: the cell, range, data and symmetry checks and the diagnoses), get_state's view of the record (`recordView`, `withoutMethod`), the report (`writeReport`), the answers kept by ref (`Answers`: `respond`, `readRef`) |
| `chat.ts` (968 lines) | `chat.ts` (452) | The loop: a message's turns, the stream, the stall and evidence checks on a final answer, the tool calls and their answers; a request built for the transport |
| | `chatTransport.ts` (180) | How a model is reached: `ChatConfig`, the client for each way in (`clientFor`), each one's errors in a sentence (`describeChatError`) |
| | `chatBudget.ts` (189) | How much a conversation may take: `runPolicy`, a request fitted to the window (`fitWindow`), and `PromptMeter`, the characters per token learned from the server's counts and the cut-prompt check (the chat's `readCount` and its four fields, now one object) |
| | `chatGuards.ts` (213) | The guards: `LoopGuard`, `RepeatWatch`, `stalledReply`, `announcedTool`, and what the app tells the model (`FROM_APP`) |

`executor.ts` and `chat.ts` re-export everything other modules imported from
them, so no caller changed. A stray comment left in `chat.ts` by the proxy
fix (#95), with no declaration under it, is gone.

## Evidence

- The full suite, unchanged: 2497 passed, 253 skipped. That is the same as
  the 2.3b branch this one starts from, and includes the executor's own tests
  (`executor.test.ts`, the call log, the page adapters), the chat's
  (`chat.test.ts`, `openaiCompat.test.ts`) and the eval harness's replays.
- `tsc -b`, eslint and the build are clean.
- Where the order of effects could have moved, it was kept:
  - The record's stages are read only for `refine` and `boxcar_scan`; `firmRules` takes them as a thunk.
  - The symmetry gate syncs the stages before it reads the fit's status, as before.
  - The stale check reads the stamp only for a page that is open and not busy.
  - The report's references are filled after the drawer paints "running".

## What changes for users

Nothing.

## What it means for the validation

Nothing moves. The local tier's loop guards and pruning are the same code in
new files (AGENT_PLAN's risk on local-model robustness).

## Not done

- `allow_exception` stays in the dispatch. It is an approval flow (it always
  asks the user) that writes an exception into the record, rather than a
  check that holds a call back.

## Checks

Full suite 2497 passed, 253 skipped. `tsc -b`, eslint and the build are clean.

# A live eval run stops at its time limit

In a live Agent eval run, a magnetic scenario sat about 40 minutes inside the
moments fit with restarts (`fitMomentsWithRestarts`, 36 free complex
components). The per-run timeout (`MATERIA_AGENT_EVAL_TIMEOUT_MIN`, which
was Vitest's per-test timeout) never fired: the fit is CPU-bound and holds
the thread, so no timer on that thread can run until it returns. Only an
outer limit ended the process, and with it the `_OUT` report, so nothing of
the run was kept (THY-71). The owner's rule is that every automated run ends
within 30 minutes, with a per-run timeout and an overall cap that stop it
loudly and keep what finished.

This change is in the eval harness only. No engine code moved: no deadline
or cap inside the moments fit, the refine loops, `src/core` or `src/app`, no
cap on free components or restarts, no refusal. Nothing the Copilot's model
reads changed.

## What changed, and why

- **Each live run is its own process** (`src/agent/evals/isolated.ts`).
  The test process starts a child Vitest on one file,
  `src/agent/evals/isolatedRun.test.ts`, which runs the one scenario with
  `runScenario`, exactly as the test process ran it (the same code through the
  same Vitest set-up and transforms). The test process only waits on the
  child, so its own timers stay free, and it kills the child's whole process
  group (Vitest's pool workers with it) at the first limit reached. A timer
  can stop a CPU-bound fit only from another process or thread; a worker
  thread would need the TypeScript and the `@/` paths loaded outside Vitest,
  so a child Vitest is the smaller and more faithful choice.
- **Two limits.** The run's own (`MATERIA_AGENT_EVAL_TIMEOUT_MIN`, default 20,
  as before), counted from when the child starts the scenario (its modules
  loaded), as Vitest's per-test timeout counted it; the child has 2 min to
  get there; and the **overall cap**
  (`MATERIA_AGENT_EVAL_CAP_MIN`, new, default 30), wall-clock from the start
  of the first run. Each run ends by whichever comes first. Once the cap is
  spent the runs not yet started are skipped and listed as not run.
- **A stopped run keeps what it did.** `runScenario` takes an optional
  observer (`onProgress`) that hears each message, reply, tool answer and
  notice, the tokens, and the call the run is in. The child appends it to a
  progress file as it goes; after a kill the parent reads the run so far back
  from it. The record of a stopped run: `outcome: "timeout"`, `limit` (`run`
  or `cap`), `during` (the call, e.g. `refine_moments({})`), the events, the
  notices, the tokens and the time, and one grade, `timeout`, failing, with
  the reason ("stopped at the run's limit of 20 min, during
  refine_moments({})"). A child that dies by itself is `outcome: "error"`
  with the end of its output. The observer only reads: with none (every
  other caller), the run is the one it was.
- **`live.test.ts`** runs each scenario through `LiveRuns` (the runs in order
  under the cap) and writes the `_OUT` report after every run, as well as at
  the end, so a process killed from outside still leaves what finished. The
  report gains `limits`, `capReached` and `notRun`; each run, `outcome`; each
  summary row, `timeout`, `error` and `notRun`. The printed summary adds a line
  starting `!!!` when the cap is reached, and one per stopped run as it
  happens.
- **`regrade.test.ts`** lists a run that did not finish as it was and does
  not score it again (its checks would read a conversation cut off).
- `transcript`, `tierFlags` and `calls` take any run with events and notices
  (a type widening, for the stopped runs).

## Evidence

**The kill, in CI** (`src/agent/evals/isolated.test.ts`, the scripted model,
no key, no network beyond this machine). The page of
`src/agent/evals/stuckScenarios.ts` is the Mn₃Ga demo whose Refine spins on
the CPU for ten minutes with no `await`, as the moments fit held the thread.

| Test | What it shows | Time (alone) |
| --- | --- | --- |
| stops a run held by CPU-bound page work at its own limit | 5 s limit: `outcome: "timeout"`, `limit: "run"`, `during: "refine({})"`, the grade "stopped at the run's limit of 5 s, during refine({})", 5 to 15 s in the run (not the loop's ten minutes); the conversation so far (the message, both replies, the method's and `get_state`'s answers); the model asked twice, never a third time | 6.8 s |
| stops the run going at the overall cap | 1.5 s cap, 60 min run limit: the first run stopped by the cap (`limit: "cap"`), the second not run and listed; `capReached`; the summary row counts 1 timeout and 1 not run; the saved run carries its outcome, flags and transcript | 1.5 s |
| brings a finished run back from its process | `misfits-not-extra-peaks`, its good replay, in the child and in the test process: the same saved run (every event, tool answer, record, report and grade), the run's time and the records' clock times aside | 2.1 s |
| reads the run so far back from its progress lines | a reply that grew, a notice, and a last line cut by the kill | < 0.01 s |

No child process is left after the tests (checked with `ps`). Under the
full suite's load the file takes about 13 s; four copies at once beside the
eval suite all passed. A first version, with a 2 s limit counted from the
child's spawn, failed once under the full suite's load: the limit ran out
before the stuck Refine was reached. The run's limit now counts from the
scenario's start, as Vitest's did, and the test gives it 5 s.

**A wiring check of `live.test.ts`** (by hand, not in CI): `MATERIA_AGENT_EVAL=1`
with the OpenAI-compatible transport pointed at a closed local port, two
scenarios, `_TIMEOUT_MIN=1`, `_CAP_MIN=1`: both runs finished in their
processes with the chat error, the summary printed, and `_OUT` held the new
fields; `regrade.test.ts` on that report with a timeout run added re-scored
the two finished runs and listed the timeout one, not scored.

**No number moved.** A temporary test (not in the repository) wrote every
scripted eval run of the suite in full: for each scenario with its data on
this machine, the good replay, the good replay with the tools by stage, and
the bad replay, then every `MORE_FAILURES` run, each as the `_OUT` report
keeps it (every event with every tool's full answer, the records, the
approvals asked, the notices, the reports with their audits, the grades, the
tier flags, the transcript, the turn count), every number as its float64 bits;
each scenario's fresh page through the Copilot's `get_state` and
`assess_refinement`; and the misfit and impurity pages' `find_unexplained_peaks`.
Two things are wall-clock, not page numbers, and are left out: the run's time
(`seconds`) and the time each Agent record was written (`at`). On `main`
(0578a85) run twice: identical. On the branch, after the first commit and at the head: identical, byte for byte (166 entries, 4.5 MB, SHA-256 `23ebcbd4…`).

The same good replays run through the child process (`LiveRuns`) on the
branch, compared with `main`'s in-process ones, at the head: all 39 identical (the 40th scenario's data are not on this machine).

## What changes for users

Nothing in the app, the Copilot or MCP. For whoever runs the live evals: a
run is stopped at its limit even while a fit holds the CPU, and is reported
as a `timeout` failure with its conversation so far; a live run ends within
the cap (30 min by default; raise `MATERIA_AGENT_EVAL_CAP_MIN` for a longer
deliberate run); the `_OUT` report has the fields above and is written after
every run. Each run starts a Vitest process, a second or two.

## What it means for the validation

Nothing moved. Arm A's pinned results, the model-text snapshots and
`docs/AGENT_TOOLS.md` are unchanged. The validation's own runner
(`src/agent/validation/run.ts`) still runs `runScenario` in its own process
and so has the same exposure to a CPU-bound fit; it is not changed here.

## Not done

- **The validation runner** (above) and the scripted CI replays keep running
  in the test process; the CI replays use Vitest's per-test timeouts, which a
  CPU-bound fit can outlast in the same way.
- **The moments fit itself** is unchanged: whether to cap free complex
  components or restarts, or to refuse such a fit, changes the method and is
  the owner's decision (THY-71's other idea).
- `_TIMEOUT_MIN` and `_CAP_MIN` take whole minutes (at least 1), as
  `_TIMEOUT_MIN` did.

## Checks

At the branch's head, before this report's own commit (which changes no code):

- `npm run build` and `npm run lint`: clean.
- `npm test` without the owner's local data: 422 files passed, 38 skipped;
  3763 tests passed, 342 skipped, none failed (187 s). On `main` the known,
  parked failures are `localHexMagneticGolden` (local data only) and
  `realPowderXRD`'s wall-clock under load; neither showed in this run.
- The before-and-after dump: identical (above).
- `git diff --stat` against `main`: 7 files under `src/agent/evals` (new:
  `isolated.ts`, `stuckScenarios.ts`, `isolated.test.ts`, the child's
  `isolatedRun.test.ts`; changed: `harness.ts`, `live.test.ts`,
  `regrade.test.ts`), `docs/AGENT_EVALS.md`, this report and its row,
  `CHANGELOG.md`. Nothing under `src/core`, `src/app`, the skills or the
  knowledge notes.

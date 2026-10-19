# AGENT_TOOLS.md checked against the code, and its repetition taken out

Pull request [#64](https://github.com/drthyang/web-refinement/pull/64), branch
`claude/tidy-agent-doc`, stacked on
[#63](https://github.com/drthyang/web-refinement/pull/63), 2026-10-18. Asked
for by the user: review the Agent's document, make sure it is correct, and
remove what it says twice. The document is
[AGENT_TOOLS.md](../AGENT_TOOLS.md): the MCP tools, the skills, and the in-app
Agent.

## What changed, and why

**Wrong or stale, against the code:**

| The document said | The code |
| --- | --- |
| One firm rule, "on both pages": no bare occupancy | Two rules (`method.ts`): no bare occupancy on all three pages, and the instrument's terms never with the thermal parameters on powder and PDF, with the alternation `refine` reports |
| "Auto-approve" skips the cards "for the rest of the session" | The drawer's switch is *Ask first* / *Auto*, and it goes back to *Ask first* on reload |
| The method's stages for powder and PDF only; powder starting at the cell check | Three pages; powder starts at the fit range (`method.ts`) |
| A local model's old results "replaced by a line naming the tool to call again" | They become digests (the tool, its ref, its key values, whether a change ran since), and a method shrinks to its outline with its Gates |
| `find_unexplained_peaks` calls a peak "on" a line within 0.5 % in d, "beside" within 2 % | Within the line's width (at most 0.5 %), and within three widths (at most 2 %) and on the line's own calculated intensity; a bump resolved from the line is unexplained |
| The record holds the cell check, the symmetry review, the exceptions, the kept measurements, the stages and the notes | Also the fit-range and data reads, the diagnoses, and where the fit started (`AgentRecordFile`) |
| The cell check finds a missing phase or a wrong cell; a forbidden-reflection flag is only a note | It also reads one factor on every d, a Le Bail fit that did not settle (to the Prefit) and a possible lost centring (#63) |
| The system prompt is "about 6 KB" | About 12 KB; the number is gone, since it changes |
| "All 58" tools take "about 58k characters" | 60 tools; the counts are gone, the point stays (with the instructions they fill more than half of a 32k window) |
| The stall example "Starting the Le Bail gate now." | The cell check is not a gate; the example is the prompt's own ("Starting the cell check now.") |
| Ten eval scenarios in a table, "53 of the 57" checks | 37 scenarios; AGENT_EVALS.md holds the table and the count |
| The loop guard stops a turn after "20 calls in a row that change nothing" | On a local model only, and it counts read calls (`stallStop`) |
| Planned skills `refine-structure`, `diagnose-fit`, `search-magnetic-space-groups`, the first with profile before positions | The Rietveld method, `diagnose_fit` and the magnetic-analysis skill cover them; only `choose-background` is left |
| Planned: an assessment for single-crystal data | The assessment has a single-crystal mode, used on the page |

**The tool lists.** The document listed the in-app tools by hand, under "read
tools", "change tools" and "powder page only". The lists left out 19 of the 60
(the single-crystal page's tools, `check_fit_range`, `allow_exception`,
`write_note`, `boxcar_scan`). They are replaced by a table generated from
`LIVE_TOOLS` (`src/agent/toolDoc.ts`, written by `npm run gen:tooldoc` with
the MCP table): every tool, its pages, and whether it runs at once, asks first,
always asks, or never asks. A test fails when the table drifts. The full
descriptions are the model-text snapshots, linked rather than repeated.

**Said twice, now said once:**

- the skills and progressive disclosure (the Skills section, and again in the
  in-app section);
- a local model's window (a "Long sessions" bullet, and a paragraph that
  contradicted it), now one section with Claude's context editing;
- the unexplained peaks (a bullet, and a paragraph on the plot marks);
- approval and undo, and "no tool sets a value" (three places);
- the registry test (three places);
- the stalls and the loops, now one section;
- the long paragraphs that restated the tool descriptions (the per-tool notes,
  the single-crystal page's tools), now what each tool computes, grouped by
  topic, with the usage advice left to the descriptions and the skills;
- the local-model anecdotes (a gemma4 check, the LM Studio truncation story),
  which AGENT_EVALS.md records with its results;
- the eval check count, which a test held in both AGENT_TOOLS.md and
  AGENT_EVALS.md; it now lives in AGENT_EVALS.md only, and the test checks it
  there.

## Evidence

- The prose outside the generated tables went from 7 697 words to 6 016, and
  the document now lists every in-app tool.
- Each claim in the table above was read against the source it names.
- The three links into the document from elsewhere (`#run-the-mcp-server`,
  `#how-data-travels`, `#the-in-app-agent`) still resolve.

## What changes for users

Nothing in the app or the tools. Readers of AGENT_TOOLS.md get a complete,
generated list of the in-app tools; contributors run `npm run gen:tooldoc`
after changing `src/agent/tools.ts` as well as `src/mcp/registry.ts`.

## What it means for the validation

Nothing: no model-visible text changed (the snapshots are unchanged).

## Not done

- The other Agent documents (AGENT_EVALS, AGENT_EXAMPLES, AGENT_REVIEW,
  AGENT_PLAN) were not reviewed in this change.
- The live tools' descriptions themselves stay as they are.

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2325
tests, 265 skipped.

# The refinement report: the summary first, the full record in an appendix

Pull request [#102](https://github.com/drthyang/materia-platform/pull/102),
branch `claude/concise-reports` (`b525ac2`, skill `9fe6e18`), merged into
`claude/materia-backlog`, 2026-10-24. Backlog item M7: make the reports
concise.

## What was wrong

Two functions build every report, `reportHtml` and `reportMarkdown`. The
Export menu calls them from `reportInputs.ts`, and the Agent's `write_report`
through `buildAgentReport`, which also audits the account's numbers. Before
any result, a report showed the History's steps, the method checklist and
every check, passed ones included. The single-crystal check table alone
carried about 2.5 k characters of resolution shells, analysis of variance and
data reading. The TOF profile table and the background rows sat in the main
body, and the account came last. The powder limit on the moment's direction
was the last sentence of a Conventions bullet.

## What changed

| Change | Where |
| --- | --- |
| The summary, in order: the analysis (the account, the open issues, "Checks to note" and a "Passed: …" line, the Bayesian check); Data & model; Fit; Local vs average; Structures; Magnetic, with its limits; **Other refined values** (free parameters not shown elsewhere, the background apart); Refinement details | `core/export/report.ts`, `reportMarkdown.ts` |
| **Appendix · the full record**: A. the analysis step by step (steps, method, every check, notes, model); B. every parameter; C. conventions and software (version, Agent model, engine cycles). In HTML each part is a closed `<details>`, opened for print | same |
| `powderMomentLimits`: the general powder statement, plus "only \|m\|" for a cubic crystal and "only the angle to the unique axis" for a uniaxial one, in the magnetic section. The sentence leaves the Conventions bullet (moved, not copied) | `app/reportInputs.ts` |
| `write_report`'s description (both arms): the account leads, the record is in the appendix; a short account (the result, how far to trust it, what is open, the approach in one sentence) | `agent/tools.ts` |
| `my-rietveld-workflow`'s report paragraph asks for a brief account, the approach in a sentence | `.claude/skills/` ([the skill edits](./2026-10-24-skill-edits.md)) |
| USER_GUIDE's report paragraph, AGENT_TOOLS' `write_report` paragraph | `docs/` |

What stays in the summary: the fit metrics; the cell and sites with esds;
phase fractions; k, the magnetic group and the moments with esds; every other
refined value with its esd; the open issues; the note checks that bear on
trust (correlations, convergence, agreement, residual peaks, serial
correlation, bond valence, symmetry review, cell check, largest outliers, the
single-crystal "Data" row); the Bayesian intervals; the engine's warnings;
the account; how to read an esd.

## Evidence

Real reports were generated headless through the Agent's tools and
`write_report`, and from the Export menu for the same state. The pages were
the two-phase POWGEN demo (4 refinements), the GaTa₄Se₈ PDF demo (2), the
synthetic magnetic page (k-search, ranking, moments, joint fit) and the
corundum single-crystal page (3).

- **Nothing lost.** On all 8 reports, every line the summary must keep is
  there verbatim before the appendix, and every moved line is in the appendix
  verbatim: 0 missing of 38–65 required and 15–67 moved per report. In
  Chromium the closed default view shows every required item and none of the
  moved ones. Print media equal the fully opened text, and the PDF printed
  from corundum holds the appendix.
- **Shorter**, default view:

  | Report (Agent) | Visible words | Markdown summary lines |
  | --- | --- | --- |
  | Powder | 1481 → 943 (−36 %) | 194 → 121 |
  | PDF | 890 → 659 (−26 %) | 152 → 98 |
  | Magnetic | 1270 → 885 (−30 %) | 175 → 113 |
  | Single crystal | 1443 → 949 (−34 %) | 138 → 99 |

  The Export-menu reports shrink by 9–21 %. The whole document grows by
  10–30 % in characters, because the summary repeats the noted checks and the
  other refined values that the appendix keeps in full.
- **Tests.** `core/export/report.test.ts`: 17 required items in the HTML and
  Markdown summaries, 11 moved items absent from the summary and present in
  the appendix, closed `<details>` with the print rule, and
  `powderMomentLimits` per crystal system. Two order assertions were updated,
  with every content assertion kept. `agent/report.test.ts` runs
  `write_report` on the three bundled demos and ties each check to the
  engine's own output. Removing "Other refined values" fails 2 of the 3.

## What changes for users

A report opens on the account, the open issues and the results. The steps,
the method, every check in detail, every parameter, the conventions and the
software are one click away, and in print. The formats (HTML, Markdown, CIF)
and saved projects are unchanged. The number audit is unchanged.

## What it means for the validation

Arms B and C see `write_report`'s new description; the model-text snapshots
change by it. The scoring does not read the report's layout, and arm A is
unchanged.

## Not done

- Single-crystal anisotropic U's are in the summary only as U_eq per site;
  the tensors with esds are in appendix B and the CIF. For the owner to
  confirm.
- Data & model (file, instrument, range, peak shape) stays in the summary as
  the data's identification. For the owner to confirm.
- `DETAIL_CHECKS` is a fixed list of names: a new diagnostic shows in the
  summary until it is listed there.

## Checks

At `b525ac2`: lint, typecheck and build pass; `npm test` 2503 tests, 253
skipped. At the backlog's merged head (`23c1d88`): 2638 tests, 253 skipped.

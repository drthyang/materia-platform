# The single-crystal page's operations in one module

Branch `claude/sc-page`, 2026-10-18. Plan: [AGENT_PLAN.md](../AGENT_PLAN.md),
1.2. From the architecture review's first candidate (the PDF and single-crystal
page modules); this is the first of its two changes, the PDF page the second.

The single-crystal page had two implementations: the workbench's React state
and handlers, and a hand-written copy in the Agent's headless page
(`testSupport/agentHeadless.ts`) that the evals and the scripted replays ran
on. The copy had drifted from the page, and the workbench's own handlers had
drifted from each other. Both now call one module.

## What changed, and why

| Change | What it answers |
| --- | --- |
| `app/singleCrystalPage.ts`: the page as a value (`SingleCrystalPageModel`: the structure and reflections as loaded, and every setting a project saves or the fit reads), each control a function that returns the next page (`withAdpModel`, `withHand`, `withTwinLaws`, `withMerged`, …), what the page derives read from `pageView` (the dataset fitted, the structure fitted, the spec, the comparisons, R_int), and Refine, Prefit / Escape minimum, the probe and the moment fit as requests to the compute client | One implementation of what the page does, which both adapters call |
| The workbench holds the page in one `useState`; each handler is `setModel(withX(…))` and records its History step as before. View state (the busy flag, the quality view, the selection, the supercell panel's form) stays in React | Nineteen `useState`s held the page's settings, and six handlers each rebuilt the parameter rows their own way |
| The headless page holds the same model in a variable, runs the fits through the app's compute client (in-thread), and keeps its page with each History step | The copy rebuilt an ADP switch from the structure as loaded (the inverted hand and the restraints lost), returned "cancelled" for Prefit, read the ADP model its own way, and `go_to_step` left it as it was |
| Save and reopen go through the module (`workspaceOf`, `singleCrystalPage(…, { restore })`) | The saved settings and the page's settings were listed twice |
| An ADP switch rebuilds the rows from the structure the fit uses | With the hydrogens riding, the workbench rebuilt the rows from the structure without its riding rules: the hydrogens' 28 position and B rows came back and the methyl torsion left |
| Another reflection file on the same structure (the page stays open: it is keyed on `<structure>-hkl`) rebuilds the rows and clears the omissions and the last fit (`withDataset`) | The page kept the old file's rows, its omissions and the old fit's result |
| The parameter panel's Reset button calls `onReset()` with nothing | Since 10 October (the 11th on the single-crystal page) the pages' `reset` takes the ids to reset, and the button passed its click event: `new Set(event)` threw, and Reset did nothing on the powder, PDF and single-crystal pages |

The Agent's `SingleCrystalAgentPort` is unchanged.

## Evidence

- **Tests that fail without the change** (`app/singleCrystalPage.test.ts`):
  inverting the hand and then switching the ADPs keeps the hand and the
  restraints, on the module and through the headless page (the old copy put
  the atoms back at the loaded hand); `go_to_step` on the headless page puts
  back the step's weights, range, reflections and rows (the old copy did
  nothing). Both failed on the old copy and pass now.
- **Tests that pin the rest**: riding then an ADP switch keeps the torsion and
  leaves the rows equal to the spec's; a magnetic model's rows and bindings
  survive a twin law, a merge, an ADP switch and another reflection file, and
  inverting under a magnetic model is refused; a twin law that stays keeps its
  fraction and a new one starts at 0.1; a page with every setting changed and
  a fit, saved to JSON and reopened, gives back every setting, every row, the
  last fit and the agreement (R1 and wR2 to 10 decimal places).
- **No existing test changed.** The single-crystal tool tests, the scripted
  evals (all 18 `sc-*` replays) and the reference tests pass on the headless
  page as they did on the copy.
- **The app behaves as on `main`, apart from the fixes.** Both builds were
  driven in a browser (Playwright, Chromium) with the same steps and the page's
  text compared after each:
  - On a synthetic corundum crystal (CIF + FullProf `.int`, written from
    `testSupport/scPages.ts`): load, Refine structure, the Becker–Coppens
    type I extinction model, Refine, the outlier filter, Refine, WGHT suggest,
    Refine, Escape minimum, X-ray, Refine. Identical text at every step.
  - Three scripted Agent replays (dev-server replays, no model calls), the
    page and the Agent's transcript compared at the end. Corundum: refine,
    free positions and B, the extinction model, `test_extinction`, an
    omission, the resolution range, the filter, the ADP switch, the suggested
    weights, Escape minimum. A chiral Ga complex (CIF + SHELX `.hkl`): X-ray,
    merge, an inversion twin, a DFIX, inversion of the hand, the ADP switch,
    weights, reset. A pyridyl complex: riding, the ADP switch, riding off.
    Identical, timings aside.
  - Reset: on `main` the page did not change (the click threw
    `TypeError: object is not iterable`, as the powder and PDF pages' consoles
    show); here it resets the values and clears the fit (the button reads
    Prefit again) on all three pages.
  - Riding then the ADP switch on the pyridyl complex: 102 rows on `main`
    (45 positions, 55 ADPs), 75 here (25 and 48).

## What changes for users

- **Reset works again** on the powder, PDF and single-crystal pages.
- **An ADP switch with the hydrogens riding** keeps them riding: their own
  rows stay out of the parameter panel and the torsion stays.
- **Another reflection file for the same structure** starts the page's fit
  afresh: the rows follow the new file (a batch scale comes or goes), the
  omissions and the last fit are cleared. The probe, the weights, the twin
  laws, the filter and the range stay.
- **For the Agent**, on the app's page: nothing. On the headless page (the
  evals): Prefit and Escape minimum run, the ADP switch keeps the hand and the
  restraints, `get_state`'s ADP model reads as the app's (`mixed` when only
  some heavy atoms carry a tensor), and `go_to_step` works.

## What it means for the validation

No validation case is a single crystal, so arm A's pinned results and the
validation set do not move. The single-crystal eval scenarios now run on the
app's own page operations, as the powder ones do since phase 1.

## Not done

- **The PDF page** keeps its own copy in the headless page (refines capped at
  4 iterations, no Prefit or posterior): the second change of this candidate,
  after a short round of questions on the PDF specifics.
- **The executor's approval stamp on this page** compares the parameters only
  (architecture review, candidate 3): an approval asked before a settings
  change can still run after it. The module makes the fix a one-liner (stamp
  the model), but it belongs to that candidate.
- **The supercell panel and the magnetic symmetry panel** keep their state in
  the component, as agreed: neither is part of the Agent's interface.

## Checks

At the branch head: `npm run build` (green), `npm run lint` (clean),
`npm run typecheck` (clean), `npm test`: 2311 tests passed in 277 files, 265 skipped (those that need the git-ignored `data/` or a live model).

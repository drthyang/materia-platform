# The powder page's loads on the page, its state one value

Pull request [#75](https://github.com/drthyang/web-refinement/pull/75),
branch `claude/powder-page-state`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 1.2. The architecture review's #7, as the
user answered its Q1–Q6. The shell (`app/App.tsx`) did the powder page's work
when a file came in: five loaders each rebuilt the parameter rows with rules of
their own, and 18 places in the shell, 12 in the workbench and one in the
headless page cleared the fit's result by hand after a change.

## What changed, and why

| Change | What it answers |
| --- | --- |
| **The page is one value** (`PowderPage` in `app/powderPage.ts`): the session, the instrument and the last fit's result. The shell holds it, the workbench and the Agent's headless page change it through the page's functions. A change that makes the fit out of date returns the page with its result cleared (`changed`, and every load); a fit puts its own (`withFit`); fixing, freeing or typing a value keeps it | Each change paired with its own `setPowderResult(null)`, which a new change could leave out |
| **The loads are the page's**: `withStructure` (a CIF, a magnetic CIF, a SHELX file), `withPattern` (new data), `withInstrument` (an instrument file), `withInstrumentConstants`. The shell parses each file and routes it | The rows rebuilt in five loaders, each with its own Lorentz flag, instrument and settings |
| **A CIF loaded onto data keeps them** and builds its rows on them, with the page's instrument. On a demo, or with no data, it starts from the CIF's synthetic pattern as before | Loading data before the CIF, as the Agent asks when there is no structure, then the CIF, replaced the data with a synthetic pattern |
| **New data start their own profile**: Lorentz on, and the microstrain model reset with the corrections. The rest as before: the structure where the last fit left it (now also from a multi-phase page's main phase), the added phases dropped, a magnetic model kept on show without its rows, a TOF instrument dropped for constant-wavelength data | The Lorentz flag of the old file; a microstrain menu showing "generalized" over isotropic rows |
| **A new instrument keeps the structure** where the last fit left it, as new data do; the profile, scale and background are seeded from the instrument, the magnetic rows kept | Data then instrument lost a refined structure that instrument then data kept |
| **The evals and the validation open their pages as the app does** (`openedPage`: the structure, the instrument, then the data), not with a builder of their own | "The page as the app opens it" was a second builder |
| The ILL and INSTRM=6 readers no longer build an instrument of their own for their rows; the rows are the default instrument's, which a test shows are the same | A sixth copy of the rule |

## Evidence

- **The loads** (`app/powderLoad.test.ts`, 12 tests): a CIF onto data keeps
  them and gives the same rows and curve in each of five orders of the three
  files; a magnetic CIF's model comes with it; new data turn Lorentz on, drop
  the microstrain model, corrections and phases, keep the main phase's
  refined cell, and keep a magnetic model without its rows; a TOF instrument
  goes for constant-wavelength data; a new instrument keeps the refined cell
  and the magnetic rows and seeds U from the file, and data and instrument
  after a fit give the same rows in either order; TOF data stay view-only
  without a TOF instrument, a CIF on them too; every change that makes the
  fit out of date clears the result, and a fit sets it.
- **The evals' pages are unchanged**: Example 3 opened through the loads has
  the rows, bindings and profile of the builder it replaces.
- **In the browser**, `main` and this branch, the same files
  (`examples/mcp`: the Mn₃Ga 30 K CIF, pattern and instrument), the page read
  from its autosaved project file after each step:

  | Step | `main` | This branch |
  | --- | --- | --- |
  | Data, then the CIF | the data replaced: a synthetic pattern of 500 points | the data kept: 6 251 points, 26 rows on them |
  | … then the instrument | the synthetic pattern, pseudo-Voigt from the file | 31 rows, the same rows and cell as CIF → instrument → data |
  | CIF, data, Refine (cell a 5.41988 Å), then the instrument | cell a back to the CIF's 5.42006 Å | cell a kept at 5.41988 Å; U from the file on both |
  | Microstrain "generalized" (9 Stephens rows), Refine, then the data again | the menu still "generalized", 0 Stephens rows | the menu "isotropic", 0 Stephens rows |
  | The Rietveld demo; reload; Restore | restored equal to the demo | the same |
  | A CIF on the demo | the CIF's synthetic pattern | the same |

  No page error on either, the PDF demo included.

## What changes for users

- Loading the data first and the CIF second keeps the data.
- A new instrument keeps the refined structure.
- New data start with the Lorentz factor on and the isotropic microstrain
  model; the menu shows what the rows are.
- Everything else loads as before.

## What it means for the validation

The validation's pages are opened by the app's own loads; their rows are
those of the builder they replace, so no case changes.

## Found on the way

Adding a phase to a fitted single-phase page puts the main phase's rows back
to the CIF's values: the multi-phase spec renames them `p0_…`, and the rows
are kept by id. It is the page's `withPhase`, not a load, so it is left for its
own change (suggested as a separate task).

## Checks

`npm run build`, `npm run lint` and `npm test` pass at the branch head: 2373
tests (`main`'s 2361 and the 12 new), 265 skipped (live runs and
data-dependent suites).

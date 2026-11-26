# The instrument follows the data's bank

The owner's requests, after [the default NOMAD parameters](./2026-11-21-nomad-default-instrument.md):
"make the instrument parameter of NOMAD related to the Bank selected" and
"highlight them to let users know it changed with the Bank selected". The rule
applies to every instrument file with several banks, the NOMAD default
included.

## What changed, and why

### A change of the data's bank switches the instrument's (`src/app/bankFollow.ts`, `src/app/App.tsx`)

When the Data card's bank chooser reads another bank of a GSAS histogram, or
a new data file is loaded (a multi-bank file opens on its bank 1), and the
loaded instrument file has the bank that pairs with it (by bank number,
checked against the DIFC the data file states within `DIFC_TOLERANCE`, 3 %,
as `bankChoice.matchingInstrumentBank` already did), the instrument switches
to it in the same History step: `followDataBank` reads the file again on that
bank through `powderPage.withInstrumentFile`, as the Instrument card's chooser
does. The instrument rows (difC, difA, Zero and the profile terms) take the
new bank's file values: the old bank's refined values are not carried over,
because they describe another detector. The structure stays where the last
fit left it, as with any new data. A default shipped with the app stays a
default.

The step is one: "Instrument bank N, following data bank N" for the chooser,
"Loaded data x.gsa, bank N · instrument bank N" for a new file. Undo returns
the previous data bank, the previous instrument bank and the rows as they
were, refined values included. A re-read of the same file in another unit
(the Data card's unit override) leaves the instrument as it is.

The Instrument card (highlighted) and the parameter card say "Instrument
switched to bank N with the data bank", and the rows the switch changed are
marked, until the next action: the mark belongs to the page the switch made,
and any change of the page ends it.

### A data bank the file has no bank for holds Refine

`bankChoice.uncoveredDataBank` (the condition of the card's existing "No
instrument bank for data bank N" line) decides. On such a bank nothing is
switched, and the page holds the old bank's parameters, which place the peaks
at the wrong d. Every fit to the data is off:

- the parameter card's Refine and Prefit / Escape min (with the reason as
  their title) and the Validation view's Refine;
- the magnetic step's Rank and Refine moments (the reason is shown beside
  Rank) and the Posterior tab's Sample;
- the Copilot's `refine`, `rank_magnetic_groups`, `refine_moments` and
  `sample_posterior`, refused before a card with get_state's `refineHeld`.

The Instrument card shows the reason in one line, "Refine is off: no
instrument bank for data bank 6, and another bank's calibration gives wrong
peak positions.", the details behind "?", a button **Load instrument for
bank 6…**, and the override: a chooser of the file's banks, each with its
difC and how far it is from the data's DIFC, opened on the closest
("Bank 1 · difC 1439.6 · 72 % from the data's DIFC (closest)" on the NOMAD
file's bank 6), and **Use bank 1's parameters as a starting point**. With no
DIFC in the data, the chooser opens on the bank the page holds.

Taking it puts the chosen bank's file values on the page (as the Instrument
card's chooser does) and keeps the choice with the file
(`rawInstrument.startingPointFor`, the data bank it was taken for; one
History step, "Bank 1's parameters as a starting point for data bank 6").
Every fit is then allowed, and a standing, highlighted warning says "Bank 1's
parameters, a starting point for data bank 6: refine DIFC and Zero, and
check the peak positions." on the Instrument card, in the Validation view,
in the report's instrument rows and in an exported bundle's README (after
the default's statement). A later switch to a covered bank, or another
instrument bank, drops it.

A one-bank file is held only when the data's own DIFC is more than 3 % from
the file's (the same rule as the existing line); data that state no DIFC are
never held by a one-bank file.

### The Validation view, the card's title, `get_state`

- The Validation view repeats the Instrument card's statements over the
  verdict: the default in use, Refine held, the starting point.
- `get_state` on a TOF page without an instrument reads "none loaded
  (time-of-flight data: peak positions need an instrument file)" in place of
  the constant-wavelength placeholder's "none loaded (default CW, λ = 1.54
  Å)", which constant-wavelength pages keep.
- A TOF page without an instrument shows "No instrument loaded" and "Load
  .instprm / .prm / .irf", with no status chip, not the constant-wavelength
  placeholder's "default" chip and "Constant wavelength · λ 1.54 Å". The default's title is "TOF · NOMAD ·
  default 2023A".
- The Instrument card's GSAS-II profile line is folded to "Profile as the
  file gives it, held."; the sentence on GSAS-II's default sample rows leads
  its "?" (`tofWidthNote.fileProfileCardNote`). The Copilot and the report
  read the unfolded line as before.

### A crash found on the way

On NOMAD data bank 6 with bank 5's parameters on the page (the instrument has
followed the data to bank 5, then the data go to bank 6), the data's TOF range
reads down to d = 0.04 Å, and the Validation view's fit diagnosis asked for
more reflections than the engine lists (`ReflectionLimitError`); the
workbench's error boundary then cleared the page. The same happened with the
default NOMAD parameters alone, with bank 5 chosen by hand. The view now reads the curves alone
when that limit is passed (no causes listed).

## What the Copilot reads (model-visible; the owner approves the wording)

`get_state`'s `instrument` gains up to three fields, each present only when
it applies, and a TOF page without an instrument gets a new line; nothing
else changes (the numbers below are the synthetic test file's):

- `defaultParameters` (a default shipped with the app in use): "Default NOMAD
  parameters (2023A calibration): the facility's file shipped with the app,
  not a calibration of this measurement; peak positions and widths are a
  first look until the user loads the instrument file for their own run
  cycle."
- `refineHeld` (a data bank the file lacks, no override): "Refine is held:
  data bank 6 has no bank in the instrument file (it has banks 1, 2, 3, 4,
  5), and bank 5's calibration, which the page holds, gives wrong peak
  positions (its difC 9912.1 is 1080 % from the data's DIFC 840.0). The user
  can load the instrument file for bank 6, choose a data bank the file
  covers, or choose on the Instrument card to start from another bank's
  parameters (the closest is bank 1's: difC 1439.6, 71 % from the data's DIFC
  840.0)." The same text is the refusal of `refine`, `rank_magnetic_groups`,
  `refine_moments` and `sample_posterior`.
- `startingPoint` (the override taken; the owner's wording): "Bank 1's
  parameters are the starting point for data bank 6, which the instrument
  file does not cover (the user's choice; bank 1's difC 1439.6 is 71 % from
  the data's DIFC 840.0): the TOF difC and Zero rows must be refined and the
  calculated peak positions checked against the observed ones; the
  peak-shape terms are bank 1's and may not match this bank's peak widths."
  Without a DIFC in the data the "; bank 1's difC …" part is left out; on
  constant-wavelength banks the rows read "the Zero row (and check the
  wavelength)".
- `instrument` on a TOF page without one: "none loaded (time-of-flight data:
  peak positions need an instrument file)" (before: "none loaded (default
  CW, λ = 1.54 Å)", which constant-wavelength pages keep).

## Evidence

- `src/app/bankFollow.test.ts` (17 tests): on the bundled NOMAD 2023A file,
  every switch between banks 1–5 (20 pairs, from rows refined away from the
  file) puts exactly the file's values of the new bank on the page, equal to
  GSAS-II's own reader's values (`nomad2023A.gsas2.json`) and to the page the
  default gives when clicked on that bank; the same for a made-up five-bank
  file; the History step and undo (data bank, instrument bank and refined
  rows back); bank 6 refuses, holds Refine, and the Copilot's `refine` is
  refused; the override's warning on the card, in the report and in
  `get_state`; the project field and its validator; the one-bank rule; a new
  data file following; the closest bank, the chooser's labels and the
  override on another bank; the magnetic step's and the posterior's
  refusals; the TOF get_state line; the bundle README; the Validation view's
  guard.
- `src/app/tofWidthNoteCard.test.ts` (3 tests): the folded card line.
- A dump of every scripted eval run (good, stage scope, bad, the pages'
  `get_state` and `assess_refinement`) and of the NOMAD bank pages (every
  data bank with no instrument, the default and a user's five-bank file, in
  both load orders, and every change of data bank), every number to the last
  bit: the eval runs are identical to `main`'s and to the branch before this
  change; the NOMAD pages' rows and instruments are identical, and their
  `get_state` differs only by the new fields above (35 pages
  `defaultParameters`, 7 pages on bank 6 also `refineHeld`) and their report
  by the "Instrument bank" row on bank 6.
- A local check in the browser with a published six-bank NOMAD data file
  (kept local, never in the repository): the default on data bank 1, then
  data banks 2, 3, 4, 5 and 1: each time the instrument followed to the same
  bank with that bank's file values, the card and 12–13 rows marked, Refine
  on, the step named; the next action cleared the marks. Data bank 6 kept
  bank 5, held Refine with the reason (the Validation view too), the override
  unlocked it with the warning on the card and in the Validation view, and
  four Backs returned the override, the hold, bank 5 and bank 1 with its rows.
  The same file loaded again opened on data bank 1 and the instrument
  followed from bank 3 to bank 1, in one step "Loaded data …, bank 1 ·
  instrument bank 1", marked. On bank 6 the chooser opened on bank 1 (difC
  1439.6, 72 % from the file's DIFC), the Posterior tab's Sample and the
  magnetic step's Rank were held with the reason, and the override put bank
  1 on the page and lifted the holds. No page error.

## What changes for users

- Choosing another data bank, or loading new data, changes the instrument
  bank with it, when the file has it; refined instrument values of the old
  bank are not kept.
- On a data bank the file lacks, Refine waits for a choice.
- A saved project gains one optional field (`rawInstrument.startingPointFor`).

## Not done

- MCP's own `refine_moments` and `sample_posterior` (outside the app) have
  no banks and are unchanged.
- Even the closest bank is far from NOMAD's sixth bank (72 % in difC): a
  starting point for DIFC and Zero to refine, not a calibration.

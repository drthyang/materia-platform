# Default NOMAD instrument parameters, offered and named while in use

The owner's request: "When load NOMAD multi-bank data and instrument
parameters, I want to have the pulldown list to select which bank I would like
to use for the refinement. We can save a default instrument parameters for
NOMAD but need to warn that users need to load the correct instrument
parameters."

The pulldowns exist ([2026-11-20 · instrument banks](./2026-11-20-instprm-banks.md)).
New here: the facility's NOMAD calibration file for run cycle 2023A is shipped
with the app and offered when NOMAD data are loaded without an instrument,
with a statement that stays for as long as it is in use.

Nothing the Copilot's model reads changes: no tool, tool description, skill,
prompt or snapshot file. No golden and no demo number moves.

## What changed, and why

### The file (`examples/instruments/nomad/`)

`NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm`: the GSAS-II
instrument parameter file of SNS NOMAD (BL-1B) for run cycle 2023A, from a
silicon NIST 640e calibration, as the beamline distributes it. Shipped byte
for byte, CRLF line ends included (`.gitattributes` marks it `-text`); no
value is corrected or reformatted. The `README.md` beside it gives the origin,
that it is the facility's file, that it belongs to one run cycle, that a
GSAS-II calibration assumes GSAS-II's default sample broadening, that it has
five banks (the beamline's note: "bank0 was not included due to poor
resolution and statistics"), and the oddity that its bank 1 states `2-theta`
150° and a 25 m flight path while NOMAD's first bank is near 15° (the page
uses neither field; the bank's difC agrees with the data's). Only this file is
shipped: no GSAS-II project, no data, no FullProf or Jana set.

### The data's instrument, from the file's own header (`src/parsers/instrumentRegistry.ts`)

`instrumentOfDataHeader(text)`. The rule: among the file's leading lines (up
to the first `BANK` record or the first line that starts with a number, and at
most 200 lines), a comment line `# Instrument: <value>` whose whole value is,
in any case, the name or an alias of an instrument in the registry (`NOMAD`,
`NOM`). The first such line decides.

Not enough: the name elsewhere in the header (a title, a sample name), a value
with more than the name in it (`NOMADIC`, `NOMAD at SNS`), a line that is not
a comment, a line after the data start, and the file's name (`NOM_…`, which
stays what it was: a guess for the card's label when an instrument file names
no instrument).

### The table of defaults (`src/app/defaultInstruments.ts`)

One row per instrument: an id (`nomad-2023A`), the registry's instrument name,
the run cycle, the file's name, and a function that imports the file's text
when asked. To add an instrument: a file under `examples/instruments/`, a
README, a row. Only NOMAD has a row.

The text is a chunk of its own in the build (2 469 bytes, 1.0 kB gzipped),
requested when the offer first appears and not before: the first load is
unchanged.

### The Instrument card

- **Before, and still the state before the click.** Time-of-flight data with
  no instrument are view-only: the plot shows the observed pattern with
  "Observed TOF pattern — view-only (load a TOF instrument with difC to
  refine).", and the Instrument card shows the chip "default", the title
  "Constant wavelength" and "λ 1.54 Å" (the page's built-in constant-wavelength
  placeholder, which is not applied to time-of-flight data). No generic TOF
  parameters are applied. None of this is changed.
- **The offer.** For time-of-flight data whose header names an instrument the
  table has, on a page with no instrument loaded, the card shows one button:
  **Use default NOMAD parameters (2023A)**, with the reason behind "?".
  Nothing is loaded without the click.
- **The click.** The bundled text goes through the page's own instrument-file
  load (`withInstrumentFile` in `src/app/powderPage.ts`, which the shell's
  **Load instrument…** now calls too): the same reader, the bank of the data
  on the page (by number, checked against the DIFC the data file states), the
  bank chooser, the profile rows as the file gives them and held, GSAS-II's
  default sample rows, one History step ("Loaded default NOMAD parameters
  (2023A), bank 3"). The page is equal, row for row, to the one a user gets by
  loading that file; the one difference is the default's id kept beside the
  text (`rawInstrument.bundledDefault`).
- **The standing statement.** While the instrument is a default, the card's
  chip reads "default file", its title "NOMAD · default 2023A", and its first
  line is "Default NOMAD parameters (2023A calibration): load the instrument
  file for your own run cycle." Behind "?": these are the facility's
  parameters for one run cycle and not a calibration of the measurement; the
  calibration changes between run cycles; a wrong one shifts peak positions
  and changes peak widths, and a fit can hide that in the cell, the zero and
  the sample broadening; the default is for a first look. It stays through a
  change of bank and through new data, and goes when the user loads an
  instrument file of their own.
- **A data bank the default does not cover.** With no instrument loaded and
  the data on such a bank, the card shows "No instrument bank for data bank 6:
  the default NOMAD parameters (2023A) have banks 1, 2, 3, 4, 5." and no
  button, and the click is refused the same way: no other bank's parameters
  are loaded in its place. With the default already on the page, a switch of
  the data to that bank gets the existing line ("No instrument bank for data
  bank 6: bank 3 is not its calibration."), as with any instrument file.
- **The cross-check stays on.** The default's bank is paired with the data's
  bank by number and checked against the data's DIFC, with the existing 3 %
  tolerance; a bank held against the data's gets the existing line and offer.

### The report, the bundles, the project

- **Report.** A row "Instrument parameters" directly under "Instrument" in
  "Data and model", with the statement and its reason, when a default is in
  use.
- **GSAS-II and FullProf bundles.** The README gains a paragraph "Instrument
  file: Default NOMAD parameters (2023A calibration), the facility's file
  shipped with MATERIA, not a file loaded for this measurement: …". The file
  itself ships in the bundle as any loaded instrument file does.
- **Project.** `rawInstrument` keeps the text, the bank and, new, the optional
  `bundledDefault` (the default's id). A project saved with the default opens
  without the bundle (the browser check counts the requests: none), with the
  statement. Older projects, and projects with a user's file, are unchanged.
  The History snapshot carries the same field, so back and forward move
  between "no instrument, the offer" and "the default, the statement".
- **Validation view.** It has no place for the instrument's provenance: it
  shows the verdict, the agreement, the misfit and the convergence, and
  nothing in it states that a fit was checked against the instrument. Nothing
  was added there; the statement is on the Instrument card, which stays in
  view beside it, and in the report. A line in the view is a choice left to
  the owner (below).

## Evidence

- `src/app/defaultInstruments.test.ts` (23 tests, synthetic data): the
  recognition rule and ten near misses; the offer only for recognised
  time-of-flight data without an instrument; the text fetched is the shipped
  file byte for byte; the page after the click equals the page after a user's
  load of that file, on each of the five banks; the bank follows the data's
  DIFC when the numbers disagree; the statement on the card, in the report's
  rows and in both READMEs, through a change of bank and new data, gone with a
  user's file; the uncovered bank; the project round trip and the validator;
  History back and forward.
- **GSAS-II's own reader.** `scripts/gsas2-read-instprm.py` (GSAS-II 5.11.0's
  `GSASIIfiles.ReadInstprm`) on the shipped file: no error, default bank 1,
  five banks of 20 values. Its output is kept as
  `src/testSupport/nomad2023A.gsas2.json`; the test compares all 100 values
  with the reader's text and the 18 numeric fields of each bank with what the
  page holds: all equal.
- **Browser**, local production build, synthetic NOMAD-style six-bank file
  (`NOMAD_STYLE_GSA` in `src/testSupport/instprmFixtures.ts`: made-up counts,
  round DIFC values) and a made-up five-bank `.instprm` as "the user's own":
  33 checks, no page error. The first load does not request the default's
  file; the offer; the click (statement, five banks, bank 1, no advice, one
  History step); back and forward; the two pulldowns and the offer of the
  matching bank; data bank 6 with and without the default; the report and
  both bundle READMEs; save, reload, open (bank 2, statement, no request for
  the bundled file); a user's file removes the statement; a `NOM_` file name
  without the header line gets no offer.
- **Local opt-in check** (never in the repository): a real six-bank NOMAD
  data file with the default, every data bank and every instrument bank in
  turn: the offer on banks 1 to 5, the uncovered line on bank 6, the
  statement and the profile line after each click, the existing lines when
  the banks do not belong together, no page error.

## What changes for users

- NOMAD data without an instrument file: one button on the Instrument card,
  and after the click a refinable page with a standing statement that the
  parameters are a default.
- Reports and exported bundles made with the default say so.
- A saved project gains one optional field on `rawInstrument`.
- Nothing changes for data of another instrument, for data that do not name
  NOMAD in their header, or for a session with an instrument file.

## What it means for the validation

Arm A's pinned results do not move: no golden, demo number or model-read
snapshot changes, and the bundled Mn₃Ga demos are POWGEN. The Copilot's state
and tools are unchanged, so arms B and C measure what they measured.

## Not done

- **What the Copilot reads** (model-read, so not changed here). `get_state`
  describes the instrument as "time of flight" with difC, difA and zero, and
  the profile as "Profile as the file gives it, held…": it does not say that
  the file is a bundled default, so the Copilot cannot repeat the statement
  or lower its confidence in the cell and the profile. The MCP tool
  `export_bundle` has no argument for the README's statement,
  and `parse_instrument` cannot be handed a default by name. Follow-up: a
  `source` field on `get_state`'s instrument and a line in the method.
- **The Validation view**: no line there (see above).
- **Other instruments, other run cycles**: one row, NOMAD 2023A.
- **The card before the click** still titles a time-of-flight page without an
  instrument "Constant wavelength · λ 1.54 Å" with the chip "default". It is
  the state before this change and was left as it is; "No instrument loaded"
  would be truer.
- The remaining open points of the two earlier reports (a joint fit of several
  banks; MCP tools without a bank argument).

## Checks

`npm run build`, `npm run lint` and `npm test` at the branch head: see the
pull request.

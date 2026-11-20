# Instrument files read as their programs read them; one bank at a time

An owner's question ("these are the GSAS-II instrument files from NOMAD, make
sure we parse them correctly") and an independent audit of the instrument
reader against GSAS-II 5.11.0 (THY-88 item 1) found the reader wrong, without
a message, on layouts that GSAS-II and FullProf write every day:

| File | Before | Now |
| --- | --- | --- |
| GSAS-II `.instprm` with several banks ("Save all profile": one `#Bank N:` block per bank) | every line of the file went into one table, so the **last** bank's values were used | every bank is read; the page opens on the data's bank, else on the first, as GSAS-II, and offers the others |
| GSAS-II `.instprm` with several `key:value` pairs on a line joined by `;` (GSAS-II's own default sets) | only the first pair of each line was read; the rest fell back to defaults | every pair is read |
| GSAS histogram (`.gsa`, `.gss`, `.fxye`) with several `BANK` records | the first bank was taken and nothing said so | the Data card offers the banks |
| FullProf `.irf`, `D2TOF` with three values (`Dtt1 Dtt2 Zero`) | the zero was read as the 1/d term and the zero left unset | read as FullProf documents it |
| FullProf `.irf` with `ZD2TOF` or `ZD2TOT` | refused ("neither a WAVE nor a D2TOF calibration") | read |
| FullProf `.irf` profile lines `SIGMA`, `GAMMA`, `ALFBE`, `TWOTH`, `TOFRG` | not read | read; mapped where the function of d is the same, named as not used where the page has no such term |

The page still holds one pattern and one instrument. A joint refinement of
several banks is a separate feature and is not started here.

Nothing the Copilot's model reads changes: no tool description, skill, prompt
or snapshot file. The time-of-flight profile, its numerics and the way
`sig-1` is treated on load are unchanged; the page now says what it does.

## What changed, and why

### The `.instprm` reader (`src/parsers/instrument.ts`)

`parseInstrumentFile(text)` returns every bank; `parseInstrumentParameters(text, bank?)`
returns one. The rules are GSAS-II's (`GSASIIfiles.ReadInstprm`, read in the
5.11.0 source):

- A line that starts with `#` and contains `Bank` is a bank header. Its
  number is the second blank-separated word of the text before the first
  colon; whatever follows the colon is ignored. (`#Bank 3: GSAS-II instrument
  parameter file; do not add/delete items!` is bank 3.)
- A file with no bank header is one bank; its number is its own `Bank` value.
- A line may hold several pairs joined by `;`. Line ends may be CRLF. Keys
  come in any order; of a repeated key the last value is kept (GSAS-II builds
  a dict). Of two blocks with the same bank number the first is kept.
- With no bank asked for, the lowest-numbered bank (`sorted(banklist)[0]`).
- A value between triple quotes (`pdabc`) runs over several lines: skipped,
  and noted.

Three things are more lenient than GSAS-II, on purpose, for hand-written
files: `key value` and `key=value` are accepted as before; a number may be
followed by other text; and a comment line is skipped wherever it stands.
GSAS-II stops reading a block at a `#` line after the first value, fails on
two comment lines in a row, and fails on any `#` line that contains `Bank`
without a number in the second word. A file with only one `#Bank N` block and
N ≠ 1 is refused by GSAS-II when no bank is asked for; it is read here.

Each bank now carries, beside the fields the page uses, `2-theta`, `fltPath`,
`Azimuth` and the Lorentzian `X`, `Y`, `Z` as raw values (`extras`), and every
`key:value` of the block as the file writes it (`texts`), so nothing in the
file is lost on read.

### FullProf `.irf` for time of flight

Sources: FullProf's release notes of 12 October 2003 ("Instrumental resolution
function (IRF) files have been implemented for TOF patterns", with the keyword
list and two example files), of 2004 (NPROF in the file; "in the lines
starting with the keyword D2TOF a third item … can be read representing the
zero point of the bank") and of 18 April 2011 (ZD2TOF, ZD2TOT); and the
FullProf manual (July 2001), appendix "CODFIL.pcr", LINE 14 and LINE 16
(positions), "Profile parameters-I, T.O.F", LINE 27 and LINE 30 (widths and
decays). Mantid's `LoadFullprofResolution` reads the same orders.

| Line | Values | Meaning |
| --- | --- | --- |
| `D2TOF` | `Dtt1 [Dtt2 [Zero]]` | NPROF 9: TOF = Zero + Dtt1·d + Dtt2·d² |
| `D2TOF` | `Dtt1 Dtt2 Dtt_1overD Zero` | the four-value line of newer files (POWGEN's): + Dtt_1overD/d |
| `ZD2TOF` | `Zero Dtt1 [Dtt2]` | the same, zero first |
| `D2TOT` | `Dtt1t Dtt2t x-cross Width [Zerot]` | NPROF 10, thermal neutrons: TOFt = Zerot + Dtt1t·d − Dtt2t/d, mixed with the epithermal line by ncross = ½ erfc(Width·(x-cross − 1/d)) |
| `ZD2TOT` | `Zerot Dtt1t Dtt2t [x-cross Width]` | the same, zero first |

So the trailing T is the thermal branch of NPROF 10's two-branch relation.
The page has one relation, TOF = Zero + difC·d + difA·d² + difB/d: NPROF 9's,
with Dtt1 = difC, Dtt2 = difA, Dtt_1overD = difB, in µs and Å, no conversion.

Three points are not settled by the documents alone, and the reader says in
the Instrument card's "?" which reading it took:

1. **The four-value `D2TOF`** is in none of the notes found. Its order comes
   from the comment line such files carry (`! Dtt1 Dtt2 Dtt_1overD Zero`) and
   from the column heading FullProf writes in its own `.pcr`
   (`Zero Dtt1 Dtt2 Dtt_1overd 2ThetaBank`). It was read this way before and
   still is; the bundled `examples/mcp/powgen_600k.irf` and the existing test
   do not move.
2. **A three-value `ZD2TOT` in a file that says NPROF 9** (per-bank files of
   this kind exist) has no documented meaning: the keyword belongs to NPROF
   10, the file has no crossover. It is read as Zero, Dtt1, Dtt2 of NPROF 9.
   Two pieces of evidence: FullProf, run with Res = 5 on such files, lists
   the values in its `.pcr` as Zero, Dtt1 and Dtt2 with Dtt_1overd = 0; and
   on a real five-bank set this reading agrees with a GSAS-II calibration of
   the same standard better than the thermal reading (−Dtt2t/d) on three
   banks, about as well on one, and worse on one low-angle bank where the
   difference is a tenth of the peak width either way. An NPROF 10 file with
   the thermal line alone is refused with a message; with both lines, the
   epithermal one is the calibration and the thermal branch is named as not
   used.
3. **Jana2006's use of these files** was not found documented. The files
   offered as Jana instrument files are FullProf `.irf` files with the
   three-value `D2TOF` and a comment line `! Dtt1t Dtt2t Zerot`, which is the
   order FullProf documents.

When the comment line directly above a calibration line names every column
and names as many as there are values, the names decide the order; else the
keyword and the count. A count FullProf does not document is an error.

Profile lines, mapped only where the function of d is the same in both
programs (FullProf manual; GSAS-II `GSASIImath.getTOFsig`, `getTOFalpha`,
`getTOFbeta`, `getTOFgamma`):

| FullProf | Function | GSAS-II | Page |
| --- | --- | --- | --- |
| `SIGMA Sig-2 Sig-1 Sig-0` | σ² = Sig-2·d⁴ + Sig-1·d² + Sig-0 (variance, µs²) | sig-2, sig-1, sig-0 (GSAS-II has also sig-q·d) | `sig2`, `sig1`, `sig0`, as read |
| `ALFBE alph0 beta0 alph1 beta1` | α = alph0 + alph1/d; β = beta0 + beta1/d⁴ (µs⁻¹) | alpha/d (no constant term); beta-0 + beta-1/d⁴ (+ beta-q/d²) | α₀ (a row the profile already had, 0 until now), α₁, β₀, β₁, as read |
| `GAMMA Gam-2 Gam-1 Gam-0` | Lorentzian FWHM γ = Gam-2·d² + Gam-1·d + Gam-0 (µs) | Y, X, Z | none: read, kept, named as not used |
| `TWOTH`, `TOFRG` | bank angle; TOF limits | 2-theta | read, not used |

An `ALFBE` line of four zeros is no peak shape (both rates zero): it is taken
as not given, the page starts from its generic α₁ = 1.5, β₀ = 0.02, and the
card says so. A tabulated profile (`LIST_SIG_GAM_ALF_BET…`) is not read and is
named. Banks separated by `END` are read as banks; the number in a
`! … Bank N` comment is a hint only. A `.pcr` is not accepted as an
instrument file (before or now).

`InstrumentParameters` gains one optional TOF field, `alpha0`; `powderSpec`
seeds the α₀ row from it (0 when absent, as before).

### One bank at a time (`src/app/bankChoice.ts`, the two cards)

- **Data card.** A GSAS histogram with several banks shows a chooser
  ("Bank 3 · 60 points · TOF 800–1012 µs"). It opens on bank 1 (the file's
  first bank when it has no bank 1). Choosing another bank reads the file
  again as new data: one History step. The comment lines some reductions
  write above each `BANK` record (`# Total flight path 30.1m, tth 20.0deg,
  DIFC 1215.5`) are read as optional metadata.
- **Instrument card.** A file with several banks shows a chooser
  ("Bank 3 · 2θ 75° · difC 6106"). It opens on the data's bank when the file
  has it, else on its lowest-numbered bank. Choosing another bank builds the
  profile rows again: one History step.
- **Pairing.** By bank number, checked against the DIFC the data file states
  when it states one: a same-numbered bank whose difC is more than 3 % off is
  not the data's, and the bank within 3 % is. The bank angle is not used
  (files describe their banks differently). When the instrument is not the
  data bank's, the card says so in one line and offers the right bank
  ("Data are bank 3; the instrument is bank 1." + **Use bank 3**); nothing is
  switched without the click. A data bank the file does not cover gets "No
  instrument bank for data bank 6: bank 1 is not its calibration." and no
  offer. A one-bank file (an `.irf`, a single `.instprm`) is checked the same
  way against the data's DIFC; its name and its header's bank number are
  never trusted.
- **The bank is kept with the file**: `rawData.bank` and `rawInstrument.bank`
  in the session, the History snapshot and the project file. Optional and
  additive: an older project opens unchanged, and for a multi-bank instrument
  file saved without the field the chooser shows the bank whose calibration
  the saved instrument has (the last one, which is what was applied).

### What the page does with the file's terms, and says

Confirmed in the code (`app/powderSpec.ts`, `core/workflow/structureRefinement.ts`,
`core/workflow/powder.ts`) and pinned by a test on the page's rows:

| Term | On load |
| --- | --- |
| difC, difA, difB | as read; rows held fixed |
| Zero | as read; the zero row, fixed on load (bounds ±50 µs once freed) |
| alpha | as read, as α₁ in α = α₀ + α₁/d; fixed on load (0 to 200 once freed) |
| alph0 (FullProf) | as read, as α₀; fixed on load (0 to 10 once freed) |
| beta-0, beta-1, beta-q | as read; fixed on load (β₀ 10⁻⁴ to 10, β_q ±10 once freed) |
| sig-0, sig-2, sig-q | as read, negative values included; fixed on load |
| sig-1 | **not used while the microstrain model is isotropic (the default) or uniaxial**: the row is absent, and a Gaussian microstrain of 1500 × 10⁻⁶, held fixed, takes the place of the d² term. Under the generalized model the row is there with the file's value |
| a negative σ² at a peak | set to 10⁻⁶ µs² |
| X, Y, Z (TOF); Gam-2, Gam-1, Gam-0 | read, not used: the TOF peak has no Lorentzian |
| Z (constant wavelength) | read, not used |
| 2-theta, fltPath, Azimuth, TWOTH, TOFRG | read, not used in the calculation |
| pdabc; LIST_… tables | not read |

A value outside a row's bounds stays as read while the row is fixed; a fit
that frees the row keeps it inside the bounds.

The Instrument card shows one line for what is left out ("Not used:
Lorentzian X, Y; sig-1."), with each term's treatment behind "?". This is a
message only: THY-88 items 2 and 3 (the Lorentzian, and what to do with
sig-1) remain the owner's choices.

### Corrections of fact

- `examples/mn3ga-350k/PG3_45598_Bank1.instprm`: GSAS-II could not read it
  (audit item 7, confirmed: `ValueError` in `ReadInstprm` both with and
  without a bank). Its second line, a `#` comment holding the word `Bank`,
  is read by GSAS-II as a bank header. The provenance now stands on the
  first line. No value changes: the page reads the same 19 numbers, GSAS-II
  now reads the file and returns the same 19, and the Mn₃Ga goldens pass
  unchanged.
- Comments that called the stored U, V, W "GSAS-II" coefficients
  (`core/diffraction/instrument.ts`, `core/workflow/apply.ts`,
  `core/workflow/structureRefinement.ts`) say what they are: FWHM², 8 ln 2
  times GSAS-II's variances.
- `docs/LIMITATIONS.md` listed Kα₂ doublets under "not yet"; they are drawn.
  It now also states the missing TOF Lorentzian and the one-bank limit.

## Evidence

Fixtures are synthetic (`src/testSupport/instprmFixtures.ts`): a five-bank
CRLF `.instprm` with the keys in a different order per bank, negative sig-0
and sig-1 and a large sig-q; `;`-joined files in the layout of GSAS-II's
default sets (written here, not copied); a one-bank file; a six-bank GSAS
histogram with per-bank comment lines and mixed line ends; FullProf `.irf`
files in each calibration form; a three-column TOF `.dat`.

- `src/parsers/instrumentBanks.test.ts` (12), `src/parsers/instrumentIrf.test.ts`
  (14), `src/app/bankChoice.test.ts` (22). On the old reader the five-bank
  file gives bank 5's difC where bank 1's is expected, the `;` file has no V,
  the `ZD2TOT` file is refused and the three-value `D2TOF` has no zero: each
  fails for the fault it names.
- GSAS-II's own reader, run by `scripts/gsas2-read-instprm.py`.
- Local opt-in checks on real multi-bank files, skipped without them
  (`MATERIA_INSTPRM_FILE`, `MATERIA_INSTPRM_GSAS2`, `MATERIA_GSA_FILE`,
  `MATERIA_IRF_DIRS`); the files and their numbers stay out of the
  repository. On a real five-bank `.instprm`: 5 banks, 90 values equal the
  file's text and GSAS-II's reader, the same default bank. On a six-bank
  data file with it: banks 1 to 5 pair by number with difC within 0.8 % of
  the data's DIFC; bank 6 has no instrument bank. On nine per-bank `.irf`
  files of the same instrument: each pairs with the `.instprm` bank of its
  difC to within 1 %, and 18 per-bank `.dat` files read as TOF with errors.
- Browser, local production build, 32 checks (demo, the synthetic five-bank
  file, default, switching, the two lines, undo and redo, the six-bank data
  file, the offer, save and reopen, a one-bank `.irf` against the right and
  the wrong data bank), no page error.

## What moves

- A multi-bank `.instprm` now opens on its first bank (or the data's), not
  its last. A project saved with such a file keeps the instrument it was
  saved with.
- A `;`-joined `.instprm` now gives every value.
- A FullProf `.irf` with a three-value `D2TOF` now has its zero as the zero,
  and nothing in the 1/d term. An `.irf` with `SIGMA` / `ALFBE` now starts
  from those values where it started from generic ones.
- The MCP tool `parse_instrument` returns the first bank of a multi-bank
  file, where it returned the last. It has no bank argument and its result
  does not name the bank (see below).
- No golden, demo number or model-read snapshot moves.

## Left open

- **MCP tools** (model-read, so not changed here): `parse_instrument` needs a
  `bank` argument and a result that names the bank and the banks on offer;
  `parse_powder_data` takes the first bank of a multi-bank histogram and has
  no `bank` argument either. Until then an MCP client gets bank 1 of each
  without being told. The in-app Copilot loads no files.
- **Exports**: the GSAS-II bundle ships a multi-bank `.instprm` verbatim and
  the FullProf bundle takes the first `2-theta` in the file, so a bundle made
  on a bank other than the first does not carry that bank's instrument.
- **A classic GSAS `.prm` with several banks**: the first bank's records are
  read, as before.
- THY-88 items 2 to 6: the TOF Lorentzian; sig-1 on load; the
  constant-wavelength asymmetry; the size and microstrain numbers; the
  remaining audit items.
- A joint refinement of several banks.

# Time-of-flight profile: every instrument-file term assigned (GSAS-II and FullProf files)

The request: with instrument files for GSAS-II, FullProf and Jana in hand,
"build parsers for them and make sure parameters are correctly assigned to the
instrument peak profile." The parsers are in
([2026-11-20 · instrument banks](./2026-11-20-instprm-banks.md)). This report
covers the profile. Two programs fitted to the same standard agree on the
calibration to a fraction of a per cent and disagree on how the width is split
between the terms, so the target is: **each file's parameters reproduce the
peak its own program calculates from them.**

**Done: both paths, end to end.** A GSAS-II `.instprm` that carries the profile
is evaluated with GSAS-II's function, and a FullProf `.irf` with FullProf's,
every term as the file gives it. The GSAS-II path is checked against GSAS-II
itself. **The FullProf path is not yet checked against a FullProf run**: it is
a transcription of FullProf's documented function, checked against an
independent evaluation of that transcription; a test case for the owner's
FullProf is prepared. The `.irf` files written for Jana are FullProf
resolution files and take the same path; nothing is known here of what Jana
calculates from them. **Not yet:** the Copilot's text; see section 6.

## 1. The three profiles, term by term

Units throughout: d in Å, time in µs, α and β in µs⁻¹, σ² a variance in µs²,
γ a Lorentzian FWHM in µs.

Sources. The app: `src/core/workflow/powder.ts` (`tofWidthsAt`,
`buildTofFilePeaks`), `src/core/diffraction/profile.ts` (`tofBackToBack`,
`imExpE1`), `src/app/powderSpec.ts` (`tofFileProfileOf`),
`src/core/workflow/structureRefinement.ts`. GSAS-II 5.11.0:
`GSASIIstrMath.py` (`GetReflPos`, `GetReflSigGamTOF`, `GetSampleSigGam`),
`GSASIImath.py` (`getTOFsig`, `getTOFgamma`, `getTOFalpha`, `getTOFbeta`),
`GSASIIpwd.py` (`getEpsVoigt`, `getWidthsTOF`) and its compiled peak routine.
FullProf: manual of July 2001, appendix "CODFIL.pcr", LINE 14, LINE 16,
LINE 27, LINE 27-2, LINE 30; the closed form of NPROF 9 as Mantid's
documentation transcribes it from the FullProf manual. GSAS manual
(26 Sept 2004), "TOF profile functions" 1 to 3.

| Term | GSAS-II | FullProf NPROF 9 | The app with a GSAS-II file | The app with a FullProf `.irf` |
| --- | --- | --- | --- | --- |
| Position | Zero + difC·d + difA·d² + difB/d | Zero + Dtt1·d + Dtt2·d² (newer files: + Dtt_1overD/d) | same (as before) | same (as before) |
| Position, NPROF 10 | none | two branches with a crossover | n/a | refused on reading, with that reason |
| Rise α(d) | alpha/d | alph0 + alph1/d | alpha as read; no α₀ row (GSAS-II has none); limits −1000 to 1000 | **alph0 and alph1 as read**; limits −100 to 1000 and −1000 to 1000 |
| Decay β(d) | beta-0 + beta-1/d⁴ + beta-q/d² | beta0 + beta1/d⁴ | as read | beta0, beta1 as read |
| Gaussian σ²(d) | sig-0 + sig-1·d² + sig-2·d⁴ + sig-q·d | Sig-0 + Sig-1·d² + Sig-2·d⁴ | **every term as read, sig-1 included**; no stand-in microstrain | **Sig-0, Sig-1, Sig-2 as read** |
| Lorentzian γ(d) | X·d + Y·d² + Z; a negative γ counts as none | Gam-1·d + Gam-2·d² + Gam-0 | **X, Y, Z as read**, rows of their own; a negative γ counts as none | **Gam-1, Gam-2, Gam-0 as read** (the rows X, Y, Z); a negative γ is taken as none and the card says where: the manual is silent on it |
| Sample microstrain | γ += 10⁻⁶·difC·d·Mustrain, Lorentzian by default; a new phase has 1000 | shifts in the `.pcr` | **a Lorentzian row in GSAS-II's definition, starting at 1000**, and a Gaussian row (σ = \|dT/dd\|·ε·d) at 0 | a Gaussian row at 0, nothing else (open: section 6) |
| Sample size | γ += 10⁻⁴·difC·d²/Size (µm); a new phase has 1 µm | shifts in the `.pcr` | **a row in GSAS-II's definition, starting at 1 µm** | none (open: section 6) |
| The peak | back-to-back exponentials ⊗ pseudo-Voigt (Thompson, Cox & Hastings for the total FWHM and η) | the same construction | **GSAS-II's function**, in double precision | **FullProf's function as documented**, in double precision; not yet checked against a FullProf run |
| σ² ≤ 0, α ≤ 0 or β ≤ 0 at a peak | no peak is defined | not documented | **the reflection is not drawn and is named**; a fit step that would cause it is rejected | the same |
| Peak range | 50·(2.355σ + 2γ)·(1 + 1/α) below, ·(1 + 1/β) above | Wdt FWHM, set in the `.pcr` | to where less than 0.02 % of the peak's area is left outside | the same |
| Tabulated profiles (`pdabc`, `LIST_…`) | used | used | not read, named | not read, named |

Both programs build the peak the same way. Their manuals print the argument p
of the Lorentzian part's first term differently (GSAS: TOF profile function 3,
with p "defined as in the second function", p = −αΔ + iαΓ/2; FullProf's
NPROF 9: p = αΔ + iαΓ/2), and the app evaluates a file with its own program's
function: `TofLorentzForm` in `core/diffraction/profile.ts`.

Two facts decide most of the design:

1. **GSAS-II always adds the sample's terms, and a new phase has them.** A
   GSAS-II calibration made with the default phase settings (Mustrain 1000,
   Size 1 µm, both Lorentzian, not refined) leaves an instrument file whose X
   and Y are what remained after those were taken out. Such a file can have a
   negative X, and it reproduces the standard only with the same sample terms
   beside it.
2. **FullProf adds shifts.** With an instrument resolution file, the `.pcr`
   holds shifts that FullProf adds to the file's values. An `.irf` is the
   instrument; the sample, and any correction made after the file was
   written, is in the `.pcr`.

## 2. What changed

- **The peak function** (`core/diffraction/profile.ts`). With a Lorentzian
  width the back-to-back exponentials are convolved with a pseudo-Voigt, in
  either program's form. The complex exponential integral is evaluated in
  double precision by its power series, a continued fraction and its
  asymptotic series, each where it loses no digits. Without a Lorentzian width
  the function is bit for bit what it was.
- **The reader** gives a GSAS-II TOF bank its X, Y, Z and names the program
  whose function the profile belongs to.
- **The rows** (`app/powderSpec.ts`, `core/workflow/structureRefinement.ts`).
  A GSAS-II file that carries the rise, the decay and the Gaussian width takes
  the new path: each term it gives is a row of kind `tofFileProfile` at the
  file's value, negative ones included, with limits wide enough for any file.
  Beside them, the sample: Lorentzian microstrain and size in GSAS-II's
  definitions, starting at GSAS-II's new-phase 1000 and 1 µm, and a Gaussian
  microstrain at 0. A session whose instrument gives no profile (a calibration
  alone, as the bundled POWGEN demo) and a saved project keep the rows they
  had.
- **A FullProf `.irf`** (NPROF 9) that carries ALFBE (not all zero) and SIGMA
  takes the same path in FullProf's form: alph0, alph1, beta0, beta1, Sig-0,
  Sig-1, Sig-2 and Gam-1, Gam-2, Gam-0 as read, held. The sample starts with a
  Gaussian microstrain row at 0 and no other row: FullProf keeps the sample
  in the `.pcr` as shifts, none by default, and which sample terms such a
  session should offer is the owner's to decide. An `.irf` that is a
  calibration alone, or whose ALFBE is four zeros, keeps the page's own
  profile, as before. NPROF 10 is refused, as before.
- **Held and free.** No stage frees a `tofFileProfile` row; the profile stage
  frees the sample's two Lorentzian rows and the zero. In the Copilot's method
  the sample's rows stand in the instrument group, where the peak-shape terms
  stood. σ₁² and the Gaussian microstrain are never free together: freeing one
  holds the other (`powderPage.withFixed`).
- **No floor** (`core/workflow/powder.ts`: `tofWidthsAt`, `tofWidthProblems`,
  `createTofWidthGuard`). Over the d-range of the loaded data only: where σ²,
  α or β is not positive the reflections are not drawn; the Instrument card
  names the d-range and the reflections; a fit step that would make a width
  invalid where it was valid is rejected as outside the model's domain. Valid
  everywhere in the data, nothing is said.
- **The Instrument card** says in one line that the profile is the file's and
  held, and that the sample rows start at GSAS-II's defaults, which a GSAS-II
  calibration assumes; the terms behind "?". For an `.irf`: "Profile as the
  file gives it, held, by FullProf's NPROF 9 function: its Lorentzian part and
  alph0 are not yet checked against a FullProf run, and it is not verified for
  Jana." Where a FullProf file's Lorentzian width comes out negative inside
  the data's range, a second line names the d-range and says it is taken as
  none.
- **The GSAS-II bundle** writes back what the profile uses: the session's bank
  of a multi-bank file (a multi-bank file went in verbatim before, so GSAS-II
  read its first bank), sig-1, X, Y, Z, and the sample's rows as each phase's
  Mustrain (with its Lorentzian fraction) and Size in `build_gpx.py`.
- **The FullProf bundle** writes the widths the fit used into the `.pcr`'s
  profile lines as totals (it names no resolution file): Sig-2, Sig-1, Sig-0,
  Gam-2, Gam-1, Gam-0, alph0, beta0, alph1, beta1, with the sample's terms
  added where FullProf adds them (the Gaussian microstrain in Sig-1; a GSAS-II
  session's Lorentzian microstrain in Gam-1 and its size in Gam-2). The
  original `.irf` ships beside it.
- **Across programs** the widths carry, since the two programs define them
  alike; each bundle's README says that the other program evaluates the
  Lorentzian part with its own function, so the peak is a starting point there
  and not the same peak, and names what has no place (alph0 in GSAS-II; sig-q
  in FullProf's documented lines).
- **Kept unit profiles** (`synthesizePattern`). A peak with a Lorentzian width
  costs about ten times the Gaussian form per point and is drawn over most of
  the pattern, and a fit that holds the instrument's profile asks for the same
  peaks with other intensities hundreds of times. Each such peak's values on
  the grid are computed once per centre, support and shape and summed in the
  same order with the same factors: the pattern is bit for bit the one
  computed directly.

## 3. Evidence

Synthetic and bundled public files only. `scripts/tof-profile/fixtures/` holds
a three-bank `.instprm` and three `.irf` files of invented numbers, chosen to
lie more than 30 % from every value of the same term in the real files this
work started from. The public file is
`examples/mn3ga-350k/PG3_45598_Bank1.instprm`. GSAS-II is 5.11.0, called
through its own Python. **FullProf is not installed: nothing here is a
FullProf run.**

### 3.1 The function

`core/diffraction/tofLorentz.test.ts`, against
`scripts/tof-profile/make_reference.py` (mpmath, 40 digits):

| Check | Result |
| --- | --- |
| Im[eᶻE₁(z)], 273 points across the three expansions | within 2 × 10⁻¹³ |
| The peak, both programs' forms, 3264 points each (α 0.03 to 25, β 0.008 to 0.8, σ 1 to 250, γ 0.01 to 150, offsets to 400 widths) | within 3 × 10⁻⁷ (the Gaussian part's erfc, which the function had before) |
| γ absent, 0 or negative | bit for bit the function as it was |
| γ → 0 | joins the Gaussian form to 10⁻¹¹ of the peak height |
| Area | 1 to 1.5 × 10⁻⁷; to 10⁻⁹ where the Lorentzian part is nearly all of it |
| First moment over ±2 × 10⁵ FWHM | the value each form implies, to 2 × 10⁻⁶ |
| Smoothness across the expansions' boundaries | no step above 10⁻¹⁰ of the height |

Point by point against GSAS-II's compiled routine
(`scripts/tof-profile/grid_check.py`: 3136 shapes, 128 576 points; α 0.02 to
30, β 0.004 to 1.2, σ 0.3 to 300, γ 0 to 300, offsets to 400 widths). The
"exact" column is a double-precision evaluation of the same construction in
Python. Differences as a fraction of the peak height:

| Where the point lies | Points | Routine − app | Routine − exact | App − exact |
| --- | --- | --- | --- | --- |
| erfc arguments below 6, within 100 σ of the peak | 29 715 | 2.6 × 10⁻⁵ | 2.6 × 10⁻⁵ | 9.9 × 10⁻⁸ |
| an erfc argument of 6 or above, within 100 σ | 83 642 | 3.9 × 10⁻³ | 3.9 × 10⁻³ | 1.0 × 10⁻⁷ |
| beyond 100 σ, σ ≥ 3 µs | 8 800 | 1.2 × 10⁻⁵ | 1.2 × 10⁻⁵ | 5 × 10⁻¹⁷ |
| beyond 100 σ, σ < 3 µs | 6 419 | 3.0 × 10⁻² | 3.0 × 10⁻² | 1.3 × 10⁻¹⁵ |

The same grid in FullProf's form, where no program routine can be called:
against the 40-digit evaluation at all 110 208 points with γ > 0, the app is
within 1.04 × 10⁻⁷ (relative, and of the peak height); the double-precision
reference is within 1.05 × 10⁻¹¹ of the 40-digit one.

The app is the double-precision evaluation to 10⁻⁷ everywhere. GSAS-II's
routine works in single precision; the app does not copy that, by decision.
The worst rows are at α·σ of 20 or more, and far out on the decay side of a
peak narrower than any real one.

### 3.2 Known truth

`core/workflow/tofKnownTruth.test.ts`: silicon on banks of the synthetic file,
calculated by GSAS-II itself (GSASIIscriptable: its structure factors, its
peak routine, its peak range) and by a Python reference that shares nothing
with the app or GSAS-II (`scripts/tof-profile/simulate_known_truth.py`),
refitted through the page's path with the file held; scale, cell, B and two
background terms free.

| Pattern | Noise-free: wR, largest difference | With counting noise: wR, goodness of fit, a, B, scale (esd from truth) |
| --- | --- | --- |
| GSAS-II, bank 2, new-phase sample terms | 0.059 %, 0.082 % of the top | 1.80 %, 1.006, −0.9, +2.9, +1.8 |
| GSAS-II, bank 3, Mustrain 2600 with 60 % Lorentzian, Size 0.25 µm | 0.006 %, 0.007 % | 2.75 %, 1.014, +0.5, +1.1, +0.1 |
| reference, bank 2, GSAS form | 0.0007 %, 0.0005 % | 1.77 %, 0.987, −1.2, −0.1, +0.7 |
| reference, bank 3, FullProf form, a Gaussian microstrain too | 0.0002 %, 0.0001 % | 2.70 %, 1.009, +0.5, +0.8, +0.6 |
| reference on synthetic `.irf` A (Gaussian microstrain 600), read by the page as an `.irf` | 0.0010 %, 0.0007 % | 2.99 %, 0.999, +0.1, +0.6, +0.5 |
| reference on synthetic `.irf` B (alph0 = 13, alph1 < 0, γ < 0 above 2.36 Å) | 0.0048 %, 0.0008 % | 7.86 %, 1.000, +1.7, −0.1, −1.0 |

Also, for the GSAS-II patterns: every reflection's position, α, β, σ² and γ
equal GSAS-II's own reflection table to 10⁻⁹ (2 × 10⁻³ where the Gaussian
share of the microstrain enters: GSAS-II takes difC there, the app \|dT/dd\|),
and the integrated intensities are GSAS-II's up to one constant, to 10⁻⁵.
Bank 2's 0.08 % is the first table's second row: α·σ is about 20 there.

### 3.3 The page's peak against each file's program

`scripts/tof-profile/compare.py`, six d-spacings from 0.6 to 3.1 Å; the
largest difference as a fraction of the program's peak height, before (main)
and after:

| File | Target | Before | After |
| --- | --- | --- | --- |
| synthetic `.instprm` bank 2 (sig-1 < 0, X < 0) | GSAS-II, new-phase sample terms | 6 to 38 % | 0.01 to 0.32 % |
| synthetic bank 3 | the same | 86 to 138 % | 0.00 to 0.06 % |
| bundled POWGEN `PG3_45598_Bank1.instprm` | the same | 5 to 52 % | 0.00 to 0.12 % |
| synthetic `.irf` A | FullProf's documented function, transcribed | 34 to 43 % | 4 to 6 × 10⁻⁶ % |
| synthetic `.irf` B (γ < 0 at long d) | the same | 48 to 66 % | 5 to 8 × 10⁻⁶ % |

The last two rows say that the page evaluates the transcription exactly; they
say nothing of FullProf until it is run.

### 3.4 The export, back in GSAS-II

`scripts/tof-profile/export_round_trip.py`: the session's GSAS-II bundle is
written out, its own `build_gpx.py` builds the project with GSAS-II, GSAS-II
calculates, and its pattern is compared with the page's after one scale and
one constant.

| Session | GSAS-II read back | Largest difference, rms (of the highest point) |
| --- | --- | --- |
| bank 3, Lorentzian microstrain 1560, Gaussian 441, size 0.25 µm | sig-1, X, Y, Z, difC of bank 3; Mustrain 2598.5 with fraction 0.6004; Size 0.25 | 0.067 %, 0.006 % |
| bank 2, new-phase sample terms | bank 2's terms; Mustrain 1000, fraction 1; Size 1 | 0.071 %, 0.011 % |

### 3.5 The page

`core/workflow/tofFileProfile.test.ts` (23 tests): the rows and their limits;
the stages; σ₁² and the Gaussian microstrain; the card's lines; the width rule
(bank 1 of the synthetic file has σ² < 0 below 0.603 Å: six reflections left
out and named; data above it: silence; a step into σ² < 0 rejected, the fit
converging to the true value); the occupancy and B columns against finite
differences with a Lorentzian width (3 × 10⁻¹⁰); the drawn range; the bundles;
the bundled demo's rows; and for the synthetic `.irf` files the rows (alph0 of
13 and a negative alph1 held inside their limits), the card's lines, the
negative Lorentzian width (γ < 0 above 2.36 Å: taken as none, named), σ² < 0
at both ends of the data (both ranges named, Si 1 1 1 among the reflections
left out), and both bundles of a FullProf session. The real files this work started from were run
locally through the same path; those numbers are with the owner.

## 4. What changes for users, and what it costs

- A session opened from a GSAS-II TOF `.instprm` starts on the file's profile,
  with the new rows. Public Mn₃Ga 350 K (`examples/mn3ga-350k`, the nuclear
  model, instrument held, scale and six background terms free): wR 10.77 %
  before, 7.99 % now.
- The Instrument card's "Not used: Lorentzian X, Y; sig-1." is gone for such a
  file; the line of section 2 stands there.
- **Time.** A peak with a Lorentzian width costs about ten times the
  Gaussian form per point, and its tails are drawn out to where less than
  0.02 % of its area is left outside (`TOF_LORENTZ_TAIL_FRACTION`), which on a
  POWGEN-size bank is most of the pattern for every reflection, as in GSAS-II.
  Computed afresh at every evaluation that made the public 350 K moment golden
  take 132 s where it took 15 s. With the unit profiles kept, the first
  evaluation pays that cost and the rest reuse it while the profile, the cell
  and the zero stand: the same golden's 280 evaluations hold two distinct sets
  of peaks. A fit that moves the cell or the zero, or frees a profile row,
  recomputes the peaks that moved. On the known-truth patterns, drawing to
  0.1 % in place of 0.02 % changes the agreement with GSAS-II's own patterns
  in the fourth digit and with the untruncated reference from 0.0007 to
  0.0023 % and 0.0002 to 0.0013 %; the setting is the owner's to choose and
  stands at 0.02 %.
- A session with no profile in its instrument is unchanged, bit for bit.

## 5. What it means for the validation

- **Unchanged**: the bundled POWGEN Mn₃Ga 600 K demo (wR 4.24 %), its snapshot
  tests, the magnetic demos on it, every saved-project fixture, the Copilot's
  model-text snapshots and replays (none went red).
- **Public Mn₃Ga 350 K goldens** (they load the bundled `.instprm`):
  `core/workflow/mn3ga350KGolden.test.ts` passes as written; its logged wR
  moved from 8.33 / 8.77 / 8.34 % (fit / zero moments / reference moments) to
  7.55 / 8.10 / 7.55 %. It frees the `tofProfile` kind, which such a session
  no longer has, so its profile is now the file's, held; with the sample's
  rows and the zero freed in its place it gives 7.11 / 7.41 / 7.19 %. The test
  is not edited. `workers/magneticMultiStartGolden.test.ts`,
  `core/diagnostics/backgroundTerms.test.ts` and `app/powgenBackground.test.ts`
  pass as written.
- **Local goldens on unpublished data**: one fails its bound and is not
  re-baselined (`core/workflow/localHexMagneticGolden.test.ts`); the local
  magnetic demo's saved solution now opens on the rows it was solved with, as
  a saved project does, and passes. Numbers with the owner.
- **Tests that pinned the earlier treatment** and were updated:
  `app/bankChoice.test.ts` (the rows on load), `parsers/instrumentBanks.test.ts`
  and `parsers/instrumentIrf.test.ts` (the reader's object, the rows and the
  card's line for a file that carries the profile).

## 6. Not done

- **A FullProf run.** The FullProf path rests on a transcription. The owner's
  run of the prepared test case will settle: the function itself (the
  Lorentzian part, alph0); the three-value `ZD2TOT` of an NPROF 9 file; what
  FullProf does with a negative Lorentzian width and with a negative
  variance; its peak range. Until then the card, the bundle's README and the
  docs carry "not yet checked against a FullProf run".
- **Which sample terms a FullProf session offers**, and where they start: the
  owner's decision. Today: a Gaussian microstrain row at 0.
- **Jana.** No document of Jana's time-of-flight profile was found.
- **The Copilot's text**: its settings readout, method text and knowledge file
  describe the TOF rows as they were. The fit-cause advice ("Refine TOF σ and
  β") reaches the Copilot through the report's judgment and still speaks of
  freeing the widths when a file gave the profile. The MCP `simulate_pattern`
  builds its TOF profile from the instrument directly and draws no Lorentzian
  part.
- **The cell and space-group gate and the Le Bail pre-fit** keep their own
  simplified TOF profile.
- **The sample's Lorentzian rows are one set for the pattern**, as the
  isotropic microstrain was; GSAS-II has one per phase.
- The app's own profile (no instrument profile) keeps its floors and its
  limits.
- An export from a session without a file profile leaves GSAS-II's sample
  terms at GSAS-II's defaults, which that session did not have.
- NPROF 10, tabulated profiles, TOF absorption, the 0.5 Å floor on modelled
  reflections, a joint refinement of several banks: separate items.

## 7. Checks

- `npm run build`, `npm run lint`, `npm test`: see the pull request.
- To rerun the comparisons (GSAS-II's Python with scipy; mpmath for
  `make_reference.py`): each script in `scripts/tof-profile/` states its
  command at its head; the app's side is the opt-in
  `src/core/workflow/tofProfileHarness.test.ts`
  (`MATERIA_TOF_PROFILE_JOB=<job.json>`).

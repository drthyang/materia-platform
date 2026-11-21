# DRAFT · Time-of-flight profile: every instrument-file term assigned

**Status: a plan, not a change.** Nothing in the app behaves differently at
this commit. The branch adds this report, an independent harness
(`scripts/tof-profile/`) and one opt-in test that writes down what the page
draws and fits today. The design choices below wait for the owner.

The request: with instrument files for GSAS-II, FullProf and Jana in hand,
"build parsers for them and make sure parameters are correctly assigned to the
instrument peak profile." The parsers are in
([2026-11-20 · instrument banks](./2026-11-20-instprm-banks.md)). What is left
is the profile: every term such a file carries must enter the time-of-flight
peak with the definition its program gives it, or be refused with a true
reason. Two programs fitted to the same standard agree on the calibration to a
fraction of a per cent and disagree on how the width is split between the
terms, so the target is: **each file's parameters reproduce the peak its own
program calculates from them.**

One point of design choice (a) is held back from this draft at the owner's
instruction and is in the private hand-back. The numbers given here for
GSAS-II files are against GSAS-II's own compiled routine, which is the target
either way.

## 1. The three profiles, term by term

Units throughout: d in Å, time in µs, α and β in µs⁻¹, σ² a variance in µs²,
γ a Lorentzian FWHM in µs.

Sources. The app: `src/core/workflow/powder.ts:105-140`,
`src/core/diffraction/profile.ts:227-266`, `src/app/powderSpec.ts:200-233`,
`src/core/workflow/structureRefinement.ts:352-383`,
`src/core/diffraction/anisoStrain.ts:254-262`. GSAS-II 5.11.0:
`GSASIIstrMath.py:3543` (position), `:3880-3887` (σ², γ), `:3262-3297` (sample
terms), `GSASIImath.py:5063-5139` (functions of d), `GSASIIpwd.py:852-869`,
`:1426-1434` and `sources/powsubs/epsvoigt.for` (the peak). FullProf: manual of
July 2001, appendix "CODFIL.pcr", LINE 14, LINE 16, LINE 27, LINE 27-2,
LINE 30; the closed form of NPROF 9 as Mantid's documentation transcribes it
from the FullProf manual (`NeutronBk2BkExpConvPVoigt`). GSAS manual
(26 Sept 2004), "TOF profile functions" 1 to 3.

| Term | The app today | GSAS-II | FullProf NPROF 9 | App against the programs |
| --- | --- | --- | --- | --- |
| Position | Zero + difC·d + difA·d² + difB/d | the same | Zero + Dtt1·d + Dtt2·d² (newer files: + Dtt_1overD/d) | **same** (difference 0 on every case measured) |
| Position, NPROF 10 | none | none | n·TOFe + (1 − n)·TOFt, TOFe = Zero + Dtt1·d, TOFt = Zerot + Dtt1t·d − Dtt2t/d, n = ½ erfc(Width·(x-cross − 1/d)) | **missing**, refused on reading with that reason |
| Rise α(d) | α₀ + α₁/d, floored at 10⁻⁶ | alpha/d | alph0 + alph1/d | **same** function. α₀ is bounded 0 to 10 and α₁ 0 to 200 once freed: a real file has an alph0 above that bound and a negative alph1 |
| Decay β(d) | β₀ + β₁/d⁴ + β_q/d², floored at 10⁻⁶ | beta-0 + beta-1/d⁴ + beta-q/d² | beta0 + beta1/d⁴ | **same** |
| Gaussian σ²(d) | sig0 + sig1·d² + sig2·d⁴ + sigQ·d, floored at 10⁻⁶ | sig-0 + sig-1·d² + sig-2·d⁴ + sig-q·d | Sig-0 + Sig-1·d² + Sig-2·d⁴ | **same** function, but **different on load**: with the default microstrain model the σ₁² row is absent, the file's sig-1 is not used, and a Gaussian microstrain of 1500 × 10⁻⁶ held fixed stands in for it |
| A negative σ² at a peak | set to 10⁻⁶ µs², no message | no peak is defined | not documented | **different**: silent |
| Lorentzian γ(d) | none | X·d + Y·d² + Z; a negative γ counts as zero | Gam-1·d + Gam-2·d² + Gam-0 | **missing**: read, kept, not used. The two programs' definitions are the same (X = Gam-1, Y = Gam-2, Z = Gam-0) |
| Sample microstrain | Gaussian, σ = \|dT/dd\|·ε·d, added to σ² | Lorentzian by default: γ += 10⁻⁶·difC·d·Mustrain; a Gaussian share (1 − mix) goes to σ² as (…)²/8 ln 2. **A new phase has Mustrain 1000** | σ² += DST·d² (Gaussian), γ += LStr·d (Lorentzian), as shifts in the `.pcr` | **different** shape and default |
| Sample size | none on TOF | γ += 10⁻⁴·difC·d²/Size (µm). **A new phase has Size 1 µm** | σ² += GSIZ·d⁴, γ += DSIZ·d² | **missing** |
| The peak | back-to-back exponentials ⊗ Gaussian, exact closed form (erfc) | back-to-back exponentials ⊗ pseudo-Voigt: total FWHM and η from Thompson, Cox & Hastings; (1 − η)·[⊗ Gaussian of that FWHM] + η·[⊗ Lorentzian of that FWHM, by the complex exponential integral] | the same construction | **same** when γ = 0; the Lorentzian part is **missing** |
| Peak range | ±20·(2.355σ + 1/α + 1/β), faded from 80 % | 50·(2.355σ + 2γ)·(1 + 1/α) below, ·(1 + 1/β) above | not documented | different; no effect on the area today (no Lorentzian tail) |
| Tabulated profiles (`pdabc`, `LIST_SIG_GAM_ALF_BET…`) | not read, named | used | used | **missing**, out of scope |

Two facts in this table were not in the audit or the reader report and decide
most of what follows:

1. **GSAS-II always adds the sample's terms, and a new phase has them.** A
   GSAS-II calibration made with the default phase settings (Mustrain 1000,
   Size 1 µm, both Lorentzian, not refined) leaves an instrument file whose X
   and Y are what remained after those were taken out. Such a file can have a
   negative X, and it reproduces the standard only with the same sample terms
   beside it. The peak GSAS-II calculates "from the file" is the file plus
   these two numbers.
2. **FullProf adds shifts.** With an instrument resolution file, the `.pcr`
   holds shifts that FullProf adds to the file's values (its own comment line
   reads "Instr. par. + shifts. Only shifts are refined"). An `.irf` is the
   instrument; the sample, and any correction to the instrument made after the
   file was written, is in the `.pcr`.

## 2. Measurements

Synthetic and bundled public files only. `scripts/tof-profile/fixtures/` holds
a three-bank `.instprm` and four `.irf` files with invented numbers that have
the features real files show (a negative sig-0, a negative sig-1 with a large
sig-q, a negative X, an alph0 above its bound, a negative alph1, a γ that
turns negative at long d). The public file is the bundled
`examples/mn3ga-350k/PG3_45598_Bank1.instprm`.

How: the opt-in test `src/core/workflow/tofProfileHarness.test.ts` runs the
page's own path (reader → `buildPowderSpec` → `placePeaks` →
`synthesizePattern`) and writes the peak at six d-spacings (0.6 to 3.1 Å) on a
4001-point grid. `scripts/tof-profile/compare.py` reads each file with its own
small reader, takes the widths by the program's functions of d, and gets the
target peak from GSAS-II's compiled routine (GSAS-II 5.11.0, called through
its Python) or, for FullProf, from a double-precision transcription of the
documented function. **FullProf is not installed: no FullProf run backs the
FullProf columns.** The exact Voigt convolution in `reference.py` is computed
two independent ways (Fourier inversion and real-space quadrature), which
agree to 2 × 10⁻¹⁶.

### 2.1 What the page draws today against the file's own program

Ranges over the six d-spacings. Height and FWHM are app ÷ program; the last
column is the largest difference as a fraction of the program's peak height.
Positions agree exactly in every row.

| File | Target | Height | FWHM | Centroid (µs) | Largest difference |
| --- | --- | --- | --- | --- | --- |
| synthetic `.instprm` bank 1 (large sig-1) | GSAS-II, new-phase sample terms | 1.31 to 3.49 | 0.26 to 0.78 | −0.5 to −0.1 | 31 to 249 % |
| synthetic bank 2 (sig-1 < 0, large sig-q) | the same | 1.11 to 1.30 | 0.89 to 1.02 | −3.6 to −0.2 | 11 to 30 % |
| synthetic bank 3 (X < 0) | the same | 0.79 to 1.11 | 1.03 to 1.39 | −3.7 to −0.5 | 15 to 22 % |
| bundled POWGEN `PG3_45598_Bank1.instprm` | the same | 0.48 to 0.97 | 1.10 to 2.84 | −3.4 to −2.4 | 5 to 52 % |
| the same four | GSAS-II, no sample terms | 0.22 to 3.38 | 0.26 to 5.81 | | 6 to 238 % |
| synthetic `.irf` A (low angle, Sig-0 < 0) | FullProf, documented | 1.33 to 2.59 | 0.33 to 0.76 | 0.0 | 33 to 165 % |
| synthetic `.irf` B | the same | 1.57 to 2.12 | 0.53 to 0.72 | +0.1 | 57 to 112 % |
| synthetic `.irf` C (alph0 = 27.5) | the same | 1.20 to 1.63 | 0.75 to 0.96 | +0.1 to +0.3 | 20 to 63 % |
| synthetic `.irf` D (γ < 0 at long d) | the same | 0.93 to 1.11 | 1.00 to 1.09 | 0.0 to +0.1 | 5 to 12 % |

The integrated area inside the window agrees to 0.0 to 2.4 %; the app's is the
larger, because the program's Lorentzian tails leave the window. Where γ > 0,
the documented pseudo-Voigt form differs from the exact Voigt convolution by
0.07 to 1.15 % of the peak height on the four `.irf` files.

On the owner's real files (a five-bank GSAS-II set, five FullProf and four
Jana files of one instrument, with a silicon standard per bank) the same
measurement and a one-phase silicon fit with each file's parameters held were
run locally. Those numbers are in the hand-back and stay out of the
repository.

### 2.2 A trial of the change (not committed)

To know what will move, the change was tried in a throw-away working tree: the
σ₁² row with the file's value and no stand-in microstrain; γ(d) from the
file; the pseudo-Voigt peak; for a GSAS-II file the new-phase sample terms.

- Against GSAS-II's routine the trial peak differs by at most 0.42 % of the
  peak height on the synthetic `.instprm` and 0.12 % on the bundled POWGEN
  file; against the FullProf transcription by less than 10⁻⁵.
- Public data, `examples/mn3ga-350k` (POWGEN bank 1, 2848 points, the nuclear
  model alone, instrument held at the file's values, scale and six background
  terms free):

  | Profile | wR |
  | --- | --- |
  | today, as loaded | 10.77 % |
  | the file's sig-1 alone (no Lorentzian) | 14.38 % |
  | every instrument term, no sample terms | 13.77 % |
  | every instrument term and GSAS-II's new-phase sample terms | 7.99 % |

  For scale: the golden test on these data frees the profile today and reaches
  about 9.1 %; the GSAS-II refinement the file comes from, with three phases
  and the magnetic model, reports 5.65 %. So the file alone, read as its
  program reads it, starts closer than today's refined profile ends. The
  second row is the warning for the order of work: sig-1 without the
  Lorentzian is worse than today.

## 3. Design choices, with a recommendation each

### (a) The Lorentzian part

**Recommended: each program's own pseudo-Voigt construction** (total FWHM and
η by Thompson, Cox & Hastings; the Gaussian part by the closed form the app
already has, at the total width; the Lorentzian part by the complex
exponential integral), selected by where the instrument file comes from.
**Not** the exact convolution of a Voigt with the exponentials: neither
program's parameters were refined against it, it differs from the
pseudo-Voigt form by up to about 1 % of the peak height, and it needs a
quadrature per point. The numerics are the app's own, in double precision.

The remaining point of (a) is in the private hand-back.

### (b) sig-1, and the sample

**Recommended:**

- The file's sig-1 is the instrument's σ₁² row, used as read, shown whenever
  the file gives it.
- The sample is separate and additive. The Gaussian microstrain row stays as
  it is defined (σ = \|dT/dd\|·ε·d) and starts at 0 when the file gives sig-1.
  A session with no profile in its instrument (the bundled POWGEN demo, a
  `.prm`, a calibration-only `.irf`) keeps today's stand-in of 1500 × 10⁻⁶,
  so nothing there moves.
- Two Lorentzian sample rows in GSAS-II's own definitions (microstrain
  × 10⁻⁶: γ += 10⁻⁶·difC·d·M; size in µm: γ += 10⁻⁴·difC·d²/S). For a GSAS-II
  file they start at GSAS-II's new-phase values, 1000 and 1 µm, held, because
  that is the peak GSAS-II calculates from the file (section 2.2: 13.77 %
  without them, 7.99 % with). For a FullProf file they start at none.
- σ₁² and the Gaussian microstrain have the same dependence on d (exactly,
  when difA = difB = 0). They are never free together: freeing one while the
  other is free is refused with that reason.
- A negative σ², α or β: no silent floor. On load the page works out where in
  the data's d-range the file gives σ² ≤ 0, α ≤ 0 or β ≤ 0 and says so in the
  Instrument card ("this file gives no peak width below d = 0.31 Å"), and the
  reflections there are left out of the calculation and named, not drawn with
  an invented width. In a fit, a step that takes any reflection inside the
  fit range to σ² ≤ 0, α ≤ 0 or β ≤ 0 is rejected as outside the model's
  domain (the engine already rejects such steps for a cell length ≤ 0). A
  negative γ counts as zero, as in GSAS-II; this is part of the definition
  and needs no message.

### (c) α₀ and the bounds

A value outside its bounds stays as read while held, and is pulled inside the
moment the row is freed: for alph0 = 25 that is a jump to 10. **Recommended:**
bounds wide enough for any file (α₀ −100 to 1000, α₁ −1000 to 1000, β₀ −10 to
100, β₁ and β_q ±10⁸, X, Y, Z ±10⁴), and the physical condition put where it
belongs, on the function: α(d) > 0 and β(d) > 0 at every reflection in range,
by the domain rule of (b). A coefficient's sign alone says nothing (a real file
has a negative alph1 with a positive α everywhere).

### (d) Refinable or fixed, and the rows shown

**Recommended:**

- Instrument rows are held on load, as now: difC, difA, difB, zero, α₀, α₁,
  β₀, β₁, β_q, σ₀², σ₁², σ₂², σ_q², and the new Lorentzian X, Y, Z (labelled
  with GSAS-II's letters and, in the "?", FullProf's Gam-1, Gam-2, Gam-0).
- New rows appear when the file gives the term: σ₁² when it has sig-1 or
  SIGMA, X, Y, Z when it has them or GAMMA (every GSAS-II TOF file does). A
  session without them shows today's table, so its snapshots and saved
  projects do not move. The alternative, every row always, is more uniform
  and moves every TOF snapshot.
- Sample rows (Gaussian microstrain; Lorentzian microstrain and size) are the
  ones a profile stage frees when the instrument file supplied the profile;
  the instrument rows then stay held unless the user frees them. With no
  profile in the file, the stage behaves as today.
- The Instrument card's line "Not used: Lorentzian X, Y; sig-1." goes; what is
  left out after this work (tabulated profiles, the NPROF 10 branch, a
  FullProf Sigma-Q, alphQ or betaQ) stays named.

### (e) The stored convention and the round trips

For time of flight the two programs define these terms alike, so **the values
are stored as read, with no conversion factor** (unlike the
constant-wavelength U, V, W): σ² terms as variances, X, Y, Z as FWHM, α and β
as rates. What differs is kept as one field of the session, the profile's
origin (GSAS-II, FullProf, or none), which decides the point of (a) held
back, the starting sample rows of (b), and which terms exist: α₀ is
FullProf's only; β_q and σ_q are GSAS-II's only.

- **GSAS-II in, GSAS-II out.** The exported `.instprm` gets every instrument
  row back, sig-1, X, Y and Z included (today it writes X = Y = Z = 0,
  `core/export/gsas2.ts:98`, and folds the microstrain into sig-1,
  `core/export/bundle.ts:225-226`). The sample rows go to the phase, in
  GSAS-II's numbers: the Lorentzian rows as they are; the Gaussian
  microstrain as Mustrain = 2.3548 × the row with mixing 0 (exact when
  difA = difB = 0; GSAS-II's sample terms use difC alone). Where the bundle
  has no place for a phase's sample terms, the fold into sig-1 stays and the
  bundle's note says so.
- **FullProf in, FullProf out.** The `.irf` keeps SIGMA, GAMMA and ALFBE as
  read. The sample rows go to the `.pcr` as FullProf's shifts: Gaussian
  strain DST = (difC·ε)², Lorentzian strain LStr = 10⁻⁶·difC·M. FullProf's
  size parameter goes through a size model whose function was not found
  documented: a nonzero size row is named as not exported.
- **Across programs.** α₀ ≠ 0 has no place in GSAS-II; β_q ≠ 0 or σ_q ≠ 0 has
  none in the documented FullProf lines. The export says which term did not
  carry and by how much it changes the peak; it does not drop it silently.

### (f) The cost in fit time

Measured in the trial, not optimised: with γ > 0 a fit takes 4 to 10 times as
long (public Mn₃Ga 350 K: 37 ms per iteration today, 155 ms with the
Lorentzian; the local silicon fits 5 to 10 times). With γ = 0 the path is
today's and costs nothing. The time is in two complex exponential integrals
per point per peak. **Recommended:** accept up to 5 times on a pattern of the
demo's size, and get there by evaluating the Lorentzian part only where
η > 10⁻⁴, by the series near the origin, the continued fraction elsewhere and
the asymptotic form in the far tail, and by one range rule for the Gaussian
part and a wider one for the Lorentzian tail. A budget test (section 4) keeps
it from growing.

## 4. Test plan

Known truth first: patterns made by an implementation that is not the app's.

1. **The integral and the peak.** Im[eᶻE₁(z)] against scipy over the region
   the peaks use, to 10⁻¹⁰; unit area; continuity across the region
   boundaries of the evaluation; γ → 0 joins the Gaussian form to 10⁻⁹;
   derivative columns continuous.
2. **Function identity.** For each fixture, the app's peak against values
   written by `scripts/tof-profile` (committed as JSON, so CI needs neither
   GSAS-II nor scipy): GSAS-II's routine to 0.5 % of the peak height, the
   FullProf transcription to 10⁻⁶.
3. **Refits.** Patterns of silicon and MnO simulated by GSAS-II itself from a
   synthetic `.instprm` (new-phase and non-default sample terms) and by
   `reference.py` for the FullProf form, with counting noise at a fixed seed,
   refitted in the app:
   - instrument held: scale, cell and B within 2 esd, integrated intensities
     within 0.5 %, goodness of fit near 1;
   - instrument freed from a perturbed start: σ₀², σ₁², σ₂², X, Y, α, β
     within 3 esd;
   - sample: a pattern simulated with added Gaussian microstrain, Lorentzian
     microstrain and size gives them back with the instrument held;
   - the degenerate pair of (b) is refused.
4. **No width.** A file with σ² ≤ 0 inside the data's range: the message
   names the interval, the reflections are left out and counted, a fit step
   into σ² ≤ 0 is rejected.
5. **Round trips.** File → app → export → the program's own reader
   (`scripts/gsas2-read-instprm.py`; the independent `.irf` reader of the
   harness): every instrument term identical; the sample terms where (e) puts
   them; across programs the note names what did not carry.
6. **Nothing moves where nothing should.** For an instrument without profile
   terms, the rows and the calculated pattern are bit-identical before and
   after (the bundled demo's wR of 4.24 % included). Written before the
   change.
7. **Local, opt-in, real standards** (numbers stay local): per bank, the
   silicon wR with the file held is within 0.5 % (absolute) of the program's
   own.
8. **Time.** A fit of fixed size with the Lorentzian on stays within the
   budget of (f).

## 5. What will move

Does not move, by the rule "no term in the file, no new row, same function":
the bundled POWGEN Mn₃Ga 600 K demo (wR 4.24 %; its instrument is a
calibration only), its snapshot and validation tests
(`app/powderSnapshot.test.ts`, `app/ui/powderValidation.test.ts`), the
magnetic demos on those data, `examples/mcp/powgen_600k.irf`, and saved
projects, which reopen with the rows they were saved with.

Moves:

- **Every session that loads a TOF instrument file with profile terms**: the
  starting profile is the file's. On the public Mn₃Ga 350 K example the wR
  as loaded goes from 10.77 % to 7.99 % (section 2.2). The 350 K goldens
  (`core/workflow/mn3ga350KGolden.test.ts`: about 9.1 % fitted, 9.35 % with
  zero moments, 9.13 % at the reference moments;
  `workers/magneticMultiStartGolden.test.ts`) keep their meaning; their
  numbers are re-measured, and they free the profile, which under (d) means
  the sample rows.
- **Local goldens** that load an `.instprm` and are skipped without the
  local data (`realLocalMagnetic*.test.ts`, `realLocalTofBanks.test.ts`,
  `realPowderTOF.test.ts`, `localHexMagneticGolden.test.ts`,
  `twoPhasePowgen.test.ts`): re-baselined locally.
- **Tests on the bundled 350 K instrument file through the page**
  (`app/powgenBackground.test.ts`, `core/diagnostics/backgroundTerms.test.ts`):
  to be re-run; what they pin (the background default, the term count) should
  hold, their seeds may shift.
- **Tests that pin today's treatment**: `core/workflow/tofMicrostrain.test.ts`,
  `tofSigQ.test.ts`, `stagedTofProfile.test.ts`, `app/powderSpec.test.ts`,
  `app/powderLoad.test.ts`, `app/bankChoice.test.ts` (the "Not used" line),
  `parsers/instrumentBanks.test.ts` and `instrumentIrf.test.ts` (the rows on
  load), `core/export/gsas2.test.ts`, `bundle.test.ts`, `fullprof.test.ts`,
  `exportConventions.test.ts`.
- **Docs**: `docs/LIMITATIONS.md` (lines 237 and 293-294),
  `docs/MICROSTRUCTURE.md` §5.1, `docs/VALIDATION.md` (new rows for the
  known-truth tests), `docs/COMPARISON.md`, the user guide, the changelog.
- **What the Copilot's model reads**: the settings readout in
  `src/agent/powderTools.ts`, `src/agent/method.ts`,
  `knowledge/powder_structural_refinement_knowledge.md` and the model-text
  snapshots describe the TOF rows and the microstrain. New rows and a changed
  default are visible to the model; eval replays recorded on a session with a
  profile-carrying instrument file would no longer match. This part waits for
  the owner's word.

## 6. Out of scope

- FullProf NPROF 10 (the thermal branch of the position, and its α and β
  mixing): refused on reading, as now.
- Tabulated profiles (`pdabc`, `LIST_…`), TOF absorption, the bank angle in
  the Lorentz factor, a joint refinement of several banks.
- Anisotropic broadening on TOF (the generalized model is Gaussian here and
  Lorentzian in GSAS-II).
- The d floor: no reflection below 0.5 Å is modelled
  (`core/workflow/powder.ts:86`), while low-angle banks have data well below
  it. Found while fitting; a separate item.
- Jana2006's own definitions. The files offered as Jana instrument files are
  FullProf `.irf` files; no Jana document was found, so nothing here says
  what Jana calculates from them.
- The size and microstrain numbers reported for constant wavelength, and the
  other audit items of THY-88.

## 7. Open, for the owner

1. A GSAS-II file starts with GSAS-II's new-phase sample terms (Lorentzian
   microstrain 1000, size 1 µm), shown as sample rows: yes?
2. The point of (a) held back: the wording that may go into public source and
   docs.
3. FullProf: one run on the synthetic `.irf` files (a `.pcr` can be prepared)
   would turn the transcription into a measurement, and would show what
   FullProf does with γ < 0 and σ² < 0.
4. Jana2006: a manual page or a refinement file that states its TOF profile.
5. Rows only when the file gives the term, or always.
6. A profile stage that frees the sample rows and holds a file's instrument
   rows: yes?
7. The model-read text: now, or held with the other model-visible changes.

## 8. Checks

- `npx tsc -b --noEmit` and `npx eslint` on the new test: clean. The test is
  skipped unless `MATERIA_TOF_PROFILE_JOB` is set; the suite is otherwise
  untouched.
- To rerun section 2.1 (GSAS-II's Python with scipy; about 20 s):

  ```
  cd scripts/tof-profile
  python compare.py job /tmp/tofp s1=gsas2:fixtures/synthetic_three_banks.instprm:1 \
    s2=gsas2:fixtures/synthetic_three_banks.instprm:2 s3=gsas2:fixtures/synthetic_three_banks.instprm:3 \
    pg3=gsas2:../../examples/mn3ga-350k/PG3_45598_Bank1.instprm \
    fa=fullprof:fixtures/synthetic_a_low_angle.irf fb=fullprof:fixtures/synthetic_b_mid_angle.irf \
    fc=fullprof:fixtures/synthetic_c_large_alph0.irf fd=fullprof:fixtures/synthetic_d_backscatter.irf
  (cd ../.. && MATERIA_TOF_PROFILE_JOB=/tmp/tofp/job.json npx vitest run src/core/workflow/tofProfileHarness.test.ts)
  python compare.py table /tmp/tofp
  ```

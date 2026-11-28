# Plan: split the constant-wavelength X, Y into instrument and sample terms

> **Status: design note. Nothing here is built. Every numbered QUESTION is a
> choice for the owner; my recommendation is given with it and all of them are
> collected in [section 13](#13-the-questions-collected).** Linear: no issue
> yet.
>
> The owner's decision (2026-11-28) on the architecture review's question
> about `profileX` / `profileY`: **"(c) Split, like GSAS-II"**. The closed pull
> request #211 (branch `fix/profile-xy-follow-bank`, head `790dd59a`) is folded
> into this plan; its kind mapping and its time-of-flight tests carry over.
>
> The owner's rule for this note: correctness is the highest priority. Where
> correctness conflicts with speed, cost, convenience or a bit-identical
> migration, this note chooses correctness and puts the trade-off as a
> question.
>
> Every number here comes from a formula, from running GSAS-II's own functions
> (v5.11.0, git `1dd43114`), or from invented values. No number comes from the
> owner's data. Line numbers are those of `main` at `118a9406`. What was
> verified, and how, is listed in [section 14](#14-what-was-verified-and-how).
>
> Style and decision format follow the THY-89 plan
> (`docs/PLAN_MULTI_BANK.md`, branch `docs/plan-multi-bank`) and
> `docs/plans/PREFERRED_ORIENTATION.md`.

## The proposal in short

- Today, on a constant-wavelength (CW) page, the instrument file's Lorentzian
  X and Y only give the starting values of two rows, and those two rows are
  also the page's only isotropic size and microstrain rows. A refined X or Y
  holds the instrument's and the sample's broadening together.
- The target is GSAS-II's model. The instrument file's X, Y and Z are
  instrument rows: held by default, and they follow the bank. Each phase has
  its own size and microstrain rows: the sample's, kept on a bank switch. The
  Lorentzian widths add, by GSAS-II's own equations.
- Four things found while checking, each a question below:
  - **GSAS-II's Mustrain does not mean the same on CW and on time of flight.**
    For the same Δd/d, the CW number is twice the time-of-flight number
    (calculated by hand and by running GSAS-II's function). With MATERIA's
    Stokes–Wilson ε this makes three conventions: GSAS-II (CW) = 2·Δd/d = 4·ε.
  - **A new phase in GSAS-II is not "no broadening".** Its defaults are Size
    1 µm and Mustrain 1000, which add between 0.007° and 0.12° of Lorentzian
    width from 10° to 120° 2θ. So "what GSAS-II calculates from the file" and
    "the file's X and Y alone" are two different patterns.
  - **Today's GSAS-II bundle of a CW fit does not reproduce the fit in
    GSAS-II.** It writes the refined X, Y and leaves each phase at GSAS-II's
    defaults, which GSAS-II adds on top. Each link was checked by running or
    reading; the whole chain has not been run end to end (section 9.1).
  - **A FullProf CW `.irf`'s Lorentzian X, Y, Z are read past.** The page then
    starts from a placeholder, X = 1.
- An old project is migrated by splitting each refined X and Y into the
  file's value (instrument) and the rest (sample). The calculated pattern is
  unchanged to round-off, about 10⁻¹⁵ of a width. It is not bit for bit:
  [section 4](#4-migration-of-old-projects) says why and what the
  bit-identical alternative costs.
- It needs a project schema version. The proposal is to join the single bump
  that already carries the preferred-orientation plan's texture block
  (THY-103) and the PDF mode vectors.

**Words used here.**

- **Instrument rows:** U, V, W, X, Y, Z, the zero and the asymmetry. They
  describe the diffractometer and come from its file.
- **Sample rows:** size and microstrain. They describe one phase of the
  sample.
- **Γ:** a full width at half maximum (FWHM). Γ_L is Lorentzian, Γ_G Gaussian.
- **Centidegree:** 0.01° of 2θ, the unit of GSAS-II's X, Y, Z.
- **D:** GSAS-II's Size, in µm. **M:** GSAS-II's Mustrain, in units of 10⁻⁶.
- **ε:** the Stokes–Wilson strain, β = 4·ε·tanθ.
- **Dark:** merged code that no page uses yet, so no number moves.

`GLOSSARY.md` has "instrument rows" and "sample rows" in neither sense yet.
The first step that changes the page adds them.

## 1. Today's model

### 1.1 Where X and Y come from, and where they go

- **The file.** A GSAS-II `.instprm` gives `X`, `Y` (kept as `x`, `y`) and
  `Z` (kept as a bank "extra", `lorentzZ`): `parsers/instrument.ts:676-677`,
  `:623-628`. A GSAS `.prm` gives LX, LY from `PRCF12`: `:355-383`. A FullProf
  CW `.irf` gives U, V, W only; its X, Y, Z on the same line are read past
  (`parseFullProfIrf`, `:257-275`).
- **The rows.** With a Caglioti profile the page builds two rows from them
  (`app/powderSpec.ts:311`, `core/workflow/structureRefinement.ts:456-468`):

  | Row id | Kind | Label | Starts at | Bounds | Panel group |
  |---|---|---|---|---|---|
  | `profX` | `profileX` | "size (Lorentzian X)" | the file's X, else 1 | 0 to 100 | Microstructure |
  | `profY` | `profileY` | "mustrain (Lorentzian Y)" | the file's Y, else 0 | −50 to 100 | Microstructure |

- There is no Z row. For a file whose Z is not zero the Instrument card says
  "Not used: Lorentzian Z." (`app/bankChoice.ts:304-308`).
- **Two classifications disagree.** The panel lists the two rows under
  Microstructure (`app/ui/parameterGroups.ts:19-20`). The spec builder holds
  them on load as instrument rows (`app/powderSpec.ts:38-41`). The Copilot's
  method counts them as instrument terms (`agent/method.ts:62-65`). A bank
  switch keeps them, because it reads the panel group
  (`app/bankKeep.ts:30-32`).
- **Several phases share them.** `profileX` and `profileY` are shared kinds:
  one value for every phase (`core/workflow/multiPhase.ts:31-38`,
  `app/multiPhaseSpec.ts:29-35`).

### 1.2 The physics, exactly

For each reflection (`core/workflow/powder.ts`, `placePeaks`, lines 710-820):

```
Γ_G = √(U·tan²θ + V·tanθ + W) / 100                    [degrees]   line 778
Γ_L = max(X/cosθ + Y·tanθ, 0) / 100                     [degrees]   line 786
(Γ, η) = Thompson–Cox–Hastings(Γ_G, Γ_L)
```

- U, V, W are in centidegree², as FWHM² (8 ln 2 times GSAS-II's variances;
  the reader converts). X and Y are in centidegrees, as FWHM. The `/100`
  turns centidegrees into the pattern's degrees
  (`core/diffraction/profile.ts:43-62`).
- The Lorentzian sum is floored at 0, and U·tan²θ + V·tanθ + W at 10⁻⁶
  centidegree².
- The Thompson–Cox–Hastings formula has the same coefficients as GSAS-II's
  (`profile.ts:77-90`; GSAS-II `sources/powsubs/psvoigt.for`, `COFT`, `COFN`).
- **The sample's broadening has no term of its own.** It sits inside X and Y.

### 1.3 How the page reads size and strain out of X and Y

- The readout and the report subtract the row's starting value and call the
  rest the sample's (`app/PowderWorkbench.tsx:1364-1377`,
  `app/reportInputs.ts:151-165`, `core/diagnostics/interpret.ts:66-76`):

  ```
  X_s = X − X_start      D = 18000·K·λ/(π·X_s)   [Å], K = 0.9
  Y_s = Y − Y_start      ε = π·Y_s/72000         [pure number]
  ```

  (`core/diffraction/microstructure.ts:86-87`). The report says "the
  instrument's X = …, Y = … subtracted".
- So the page already assumes the split, but only in the readout. Two cases
  go wrong today:
  - a file without X (the row starts at the placeholder 1): the placeholder is
    subtracted as if it were the instrument's;
  - a page built on stored values (`powderSession.ts:259-263`): the starting
    value is then the stored value, so the readout shows no sample broadening
    at all.
- The tooltip (`PowderWorkbench.tsx:1934`) and `docs/MICROSTRUCTURE.md:42`
  call ε·10⁶ "GSAS-II's microstrain". It is not: see
  [section 3](#3-units-and-conventions-of-the-sample-rows).

### 1.4 The anisotropic models today

- **Uniaxial microstrain** (`mustrainPerp`, `mustrainPar`, in centidegrees):
  both rows start from the file's Y (`structureRefinement.ts:598-604`). In the
  width, the uniaxial term replaces the whole isotropic Y·tanθ, the
  instrument's part included (`powder.ts:792-795`):
  `Γ_L += [Y_⊥ + (Y_∥ − Y_⊥)·cos²ψ]·tanθ/100 − Y·tanθ/100`.
- **Stephens microstrain** (`stephensStrain`): a Gaussian width added in
  quadrature to the Caglioti width (`powder.ts:779-784`). The isotropic Y
  stays.
- **Uniaxial size** (`anisoSizePerp`, `anisoSizePar`) exists in the core
  (`structureRefinement.ts:588-594`) and no page offers it.
- `core/export/report.ts:380` prints "×10⁻⁶" as the unit of `mustrainPerp`,
  `mustrainPar` and `stephensStrain`. The rows are in centidegrees and Å⁻⁴.
  (Already listed in the readable-equations work's deferred items.)

### 1.5 Time of flight is already split

Where the instrument file gives the profile, its X, Y, Z are instrument rows
(`tof_gamX`, `tof_gamY`, `tof_gamZ`, kind `tofFileProfile`, held, following
the bank). The sample has `tofSampleLorentz` (GSAS-II's Mustrain, ×10⁻⁶),
`tofSampleSize` (GSAS-II's Size, µm) and `tofSampleGauss`, which are kept
(`structureRefinement.ts:427-449`). Three differences from what is proposed
here for CW are named where they matter: the time-of-flight sample rows are
shared by all phases, they start at GSAS-II's new-phase defaults, and the
method counts them in the instrument group.

## 2. The target model

### 2.1 GSAS-II's equations (verified, section 14)

For a CW histogram h and a phase p (`GSASIIstrMath.py`, `getPowderProfile` →
`GetReflSigGamCW`, lines 3865-3878; `GetSampleSigGam`, lines 3192-3297):

```
γ  = X/cosθ + Y·tanθ + Z + S_γ·mx_S + M_γ·mx_M                 [centidegrees, FWHM]
σ² = U·tan²θ + V·tanθ + W + ( [S_γ·(1 − mx_S)]² + [M_γ·(1 − mx_M)]² ) / (8 ln 2)
                                                               [centidegree², variance]
S_γ = 1.8·λ / (π·D·cosθ)        D = Size in µm, λ in Å
M_γ = 0.018·M·tanθ / π          M = Mustrain in 10⁻⁶
```

- X, Y, Z, U, V, W belong to the histogram (the instrument). D, M and the two
  mixing coefficients belong to the phase on that histogram.
- **The Lorentzian widths add.** The Gaussian variances add.
- **The mixing coefficients** mx_S and mx_M ("LGmix") say what fraction of
  each sample width is Lorentzian. 1 is all Lorentzian, and it is the default.
  The rest goes into the Gaussian variance.
- **Floors:** γ and σ² are each floored at 0.001.
- **The units check by hand.** A Scherrer width with K = 1 is λ/(D·cosθ)
  radians. With D in µm (10⁴ Å) and the width in centidegrees (18000/π per
  radian): 18000·λ/(π·10⁴·D·cosθ) = 1.8·λ/(π·D·cosθ). ✓
- **A new phase's defaults** (`GSASIImath.py`, `SetDefaultDData`, line 6351):
  Size 1 µm, Mustrain 1000, both isotropic, both mixing coefficients 1.
- **The combination** into one pseudo-Voigt is Thompson–Cox–Hastings on
  2.35482·σ and γ (`GSASIIpwd.py`, `getgamFW`, line 966; `psvoigt.for`).
- **Peak fitting has no sample term.** GSAS-II's peak fit, the usual way to
  make an `.instprm` from a standard, uses U, V, W, X, Y, Z alone
  (`GSASIIpwd.py`, `getPeakProfile`, the CW branch near lines 1655-1666; `GSASIImath.py`,
  `getCWsig`, `getCWgam`, lines 4977-5009).

### 2.2 The same model in MATERIA

```
Γ_L = [ X_i/cosθ + Y_i·tanθ + Z_i  +  S_γ  +  M_γ ] / 100          [degrees]
Γ_G = √(U·tan²θ + V·tanθ + W) / 100                                [degrees]
S_γ = 1.8·λ / (π·D·cosθ)         M_γ = 0.018·M·tanθ / π           [centidegrees]
```

- In the first delivery both sample widths are all Lorentzian (mx = 1), as
  GSAS-II's defaults. The Gaussian share is a later step with its own
  question; the Gaussian line above then gains GSAS-II's two terms (in
  MATERIA's FWHM² they add without the 8 ln 2).
- With no sample broadening (M = 0 and no size term) the sum is today's
  expression plus exact zeros. So a page that has no sample broadening
  calculates today's pattern bit for bit. This is a gate, not a hope: the sum
  must be written so that it holds, and a test pins it.
- **Floors stay MATERIA's** (Γ_L ≥ 0, the Caglioti sum ≥ 10⁻⁶). GSAS-II's are
  0.001 each. They differ only where a width is essentially zero. The
  difference is stated in `docs/EQUATIONS.md`; the GSAS-II comparison of the
  validation step uses cases above both floors.

**Rows**

| Row | Kind | Group | From | On load | On a bank switch |
|---|---|---|---|---|---|
| `profX`, `profY` | `profileX`, `profileY` (kept, new meaning: instrument only) | Instrument / profile | the file's X, Y | held | follows the bank |
| `profZ` | `profileZ` (new) | Instrument / profile | the file's Z | held | follows the bank |
| microstrain, per phase | `cwSampleMustrain` (new) | Microstructure | the sample | held, at none | kept |
| size, per phase | `cwSampleSize` (new) | Microstructure | the sample | held, at none | kept |

- The instrument rows bind to the pattern. The sample rows bind to the phase,
  in a single-phase page too, so one routing serves one phase, several phases
  and, later, several banks (THY-89's decision Q4: "microstrain and size
  shared, one value per phase").
- `profX` and `profY` keep their ids and kinds. A tie, a History step or a
  tool call that names `profX` still finds a row. Their meaning changes with
  the schema version (section 11). Every place that reads `profileX` as
  "size" is changed in the same step; a census test lists them so none is
  missed (section 12, step 2).
- **A degenerate pair is never free together.** Instrument X and the size row
  have the same 1/cosθ form. Instrument Y and the microstrain row have the
  same tanθ form. The page refuses to free both of a pair, as it already does
  for σ₁² and the Gaussian microstrain on time of flight
  (`powderPage.withFixed`).
- A term the file does not give is 0, shown as "not in the file", held. The
  placeholder X = 1 goes away.

### QUESTION 1: does the constant term Z join the model?

GSAS-II's γ has Z (`GetReflSigGamCW`). MATERIA reads it and leaves it out.

- **(a) Add the Z row.** A file whose Z is not zero is then calculated as
  GSAS-II calculates it. Its fresh-load pattern changes; a file with Z = 0 is
  unaffected.
- **(b) Keep leaving it out**, with today's "Not used" line.

**Recommendation: (a).** Leaving out a term the file states is a wrong width.

### 2.3 Anisotropic models

GSAS-II has one size type and one microstrain type per phase: isotropic,
uniaxial, or (size) ellipsoidal / (microstrain) generalized. Each replaces
the isotropic term of the sample, never the instrument's X or Y.

- **Uniaxial microstrain.** In the target it replaces the sample's isotropic
  M_γ only. The instrument's Y stays. This changes today's behaviour, where
  the instrument's Y is taken out too (1.4).
- **The functions differ from GSAS-II's.** MATERIA interpolates linearly in
  cos²ψ. GSAS-II (`GetSampleSigGam`, "uniaxial") uses
  `M(hkl) = M_i·M_a / √((M_i·cosψ)² + (M_a·sinψ)²)` for the microstrain and
  `1/D(hkl) = √(sin²ψ/D_i² + cos²ψ/D_a²)` for the size. The two agree along
  the axis and across it, and nowhere between. GSAS (the older program) uses a
  third form, linear in cosφ (GSAS manual, pp. 162-164).
- **Stephens.** MATERIA adds a Gaussian width. GSAS-II's generalized model is
  Lorentzian by default (`M_γ = 0.018·d²·tanθ·√Σ/π`), replaces the isotropic
  term, and has other units for S_HKL. Whether MATERIA's invariants and
  GSAS-II's `MustrainCoeff` terms are the same basis is **not verified**.

### QUESTION 2: what happens to the uniaxial and generalized models now?

- **(a) Isotropic first.** The first delivery splits the isotropic terms.
  Uniaxial and Stephens keep today's functions, moved to the sample's side
  (the instrument's Y no longer removed), and stay "not carried" in the
  exports, as today. GSAS-II's forms come in a later step with their own
  questions and their own GSAS-II comparison.
- **(b) GSAS-II's uniaxial form now.** New and old uniaxial pages use
  GSAS-II's function. An old uniaxial project's calculated pattern changes
  and it must be refined again.
- **(c) Both forms.** Old uniaxial projects keep the linear form, labelled;
  new pages get GSAS-II's.

**Recommendation: (a).** No physics argument makes one interpolation right
and the other wrong; the reason to move is the GSAS-II comparison, and that
deserves its own step. Under (a) an old uniaxial project migrates exactly,
because the linear form splits exactly: Y_⊥ and Y_∥ each lose the file's Y,
which becomes the instrument row.

## 3. Units and conventions of the sample rows

### 3.1 Microstrain: three conventions, each a factor of 2 apart

For a Lorentzian strain width Γ = t·tanθ in radians of 2θ (t = π·Y/18000 for
a coefficient Y in centidegrees):

| Convention | Value for the same peak | Where |
|---|---|---|
| GSAS-II Mustrain on CW | 10⁶·t | `GetSampleSigGam`: M_γ = 0.018·M·tanθ/π |
| FWHM of Δd/d, ×10⁶ | 10⁶·t/2 | Bragg's law: Δ(2θ) = 2·tanθ·Δd/d |
| GSAS-II Mustrain on time of flight | 10⁶·t/2 (the FWHM of Δd/d) | `GetSampleSigGam`: M_γ = 10⁻⁶·difC·d·M |
| Stokes–Wilson ε, ×10⁶ (MATERIA's readout today) | 10⁶·t/4 | `microstructure.ts`: ε = π·Y/72000 |

- **GSAS-II's CW Mustrain is twice its time-of-flight Mustrain for the same
  Δd/d.** Checked by running `GetSampleSigGam` for both histogram types: a
  Δd/d of 10⁻³ (FWHM) is Mustrain 1000 on time of flight and 2000 on CW.
- The origin is the GSAS manual (2004, pp. 162-164), which writes
  Δ2θ = (Δd/d)·tanθ. Differentiating Bragg's law gives 2·tanθ.
- GSAS-II's help text calls Mustrain "Δd/d × 10⁶" for both. Whether its
  authors intend the difference is **not verified**.
- Example, Y_s = 5 centidegrees: GSAS-II (CW) 872.66; Δd/d 436.33; ε 218.17
  (all ×10⁻⁶).
- FullProf's "apparent strain" (in 10⁻⁴) is ½·β·d with β the integral
  breadth in reciprocal units, which is β(2θ)/(4·tanθ): the Stokes–Wilson
  form, on the integral breadth, not the FWHM (FullProf manual 2001, the
  microstructure file's header). For a Lorentzian, β = (π/2)·Γ.

### QUESTION 3: which number does the CW microstrain row hold?

- **(a) GSAS-II's CW Mustrain** (×10⁻⁶). The number goes into GSAS-II as it
  is. The same sample on a time-of-flight page shows half of it, as in GSAS-II
  itself. The label says "GSAS-II, CW"; the readout shows Δd/d and ε beside
  it, each with its definition.
- **(b) The FWHM of Δd/d** (×10⁻⁶). One meaning on CW and on time of flight
  inside MATERIA. GSAS-II's CW number is exactly twice the row (a factor of 2
  is exact in floating point), written by the export and shown beside the row.
- **(c) The Stokes–Wilson ε** (×10⁻⁶), today's readout. GSAS-II's CW number is
  exactly 4 times the row.

**Recommendation: (a).** Every validation of this work compares with GSAS-II,
and a row that is GSAS-II's own number cannot be converted wrongly. The
factor of 2 against the time-of-flight page is GSAS-II's own and is stated on
the page. (b) is the choice if one meaning across MATERIA's pages matters
more now; a later joint CW and time-of-flight fit will need one definition
either way, and that plan can settle it.

All three are the same model. Only the number shown differs.

### 3.2 Size: GSAS-II's Size, and the problem of "none"

- GSAS-II's Size D is in µm, a FWHM with Scherrer K = 1:
  D = 1.8·λ/(π·X_s) for a coefficient X_s in centidegrees.
- MATERIA's readout today uses K = 0.9 and prints nm. For X_s = 0.5 and
  λ = 1.5406 Å: GSAS-II 1.7654 µm; MATERIA's readout 1589 nm.
- **D cannot say "no size broadening".** That is D = ∞. And a fit cannot
  start from it: the width's derivative with respect to D is −S_γ/D, which is
  zero there. GSAS-II lives with this by starting every phase at 1 µm.
- A size row must be a property of the sample. A width coefficient in
  centidegrees is not: it is proportional to λ.

### QUESTION 4: what does the size row hold?

- **(a) D in µm, GSAS-II's number, and no row until size broadening is
  switched on.** Familiar, and the same as the time-of-flight row. It needs a
  per-phase switch (saved, kept on a bank switch, one more Copilot tool
  argument) and a starting value at switch-on, which changes the pattern at
  that moment.
- **(b) The inverse size 1/D in µm⁻¹, always present, 0 = none.** The width
  is linear in it (S_γ = 1.8·λ·(1/D)/(π·cosθ)), so 0 is an exact "none", a
  fit can leave 0, and a row starts at identity as every other optional term
  on the page does. It is a sample property. GSAS-II's Size is one division
  away and is shown beside the row, in the report and in the export.
- **(c) The width coefficient X_s in centidegrees, always present, 0 = none.**
  Closest to today's row and the only choice that allows a bit-identical
  migration. But it depends on the wavelength, so it is not a sample
  property.

**Recommendation: (b).** It is the only one that is both a sample property
and well-posed at "none". The cost is an unfamiliar row, met by always
showing D in µm beside it. If consistency with the time-of-flight row weighs
more, (a) is sound physics too. I do not recommend (c): the bit-identical
migration is bought with a row that means something different at another
wavelength.

### QUESTION 5: which Scherrer constant does the size readout use?

- **(a) GSAS-II's Size as it is (K = 1 on the FWHM), in µm,** named as such.
- **(b) Today's K = 0.9, in nm.**
- **(c) Both, each named.**

**Recommendation: (a)**, with the definition in the "?" text. One number, the
one GSAS-II would show. A reader who wants another K multiplies.

## 4. Migration of old projects

In a version-2 project a refined X or Y holds instrument and sample
together. The project also stores the instrument as read from its file
(`workspace.instrument`, with `x` and `y` when the file gave them), so the
original file is not needed to know the file's values.

### 4.1 The options

**A. Split by the file's values.** Instrument X = the file's X. The rest,
X_old − X_file, goes to the phase's size row; the same for Y and the
microstrain row. The total width is unchanged.

**B. Leave the old values in the instrument rows.** The sample rows are at
none.

**C. Ask on opening**, per project: A or B.

| | The calculated pattern at the saved values | A refit from the saved values | Meaning |
|---|---|---|---|
| **A**, sample rows as in Q3 and Q4 (a) or (b) | Round-off: the Lorentzian width differs by at most 6·10⁻¹⁶ of itself (200 000 invented cases for each of (a) and (b), double precision); the pseudo-Voigt width and η by the same order | The same minimum within the convergence tolerance; not the same iterates, because the size variable changed | Right where the excess over the file is the sample's |
| **A**, sample rows as width coefficients (Q4 (c)) | Bit for bit where X_file + X_s gives back X_old exactly. For random pairs of doubles it does in about 98 % and misses by one unit in the last place in about 2 % (2 000 000 pairs), so the migration would check the sum and adjust the sample value by one unit where needed | Bit for bit, with that check | The size row depends on λ |
| **B** | Bit for bit, always: the new sum is the old one plus exact zeros | Bit for bit | Wrong name: the "instrument" rows hold the sample's part too, and a bank switch replaces it with the new bank's file values |

- A's assertion, "the excess over the file is the sample's", is the one the
  page already makes: the readout and the report subtract the starting value
  and print the rest as size and strain (1.3). It is wrong where the file
  does not describe the instrument and X, Y were refined to make up for it.
  The migration cannot know which. So it says what it did, in the project's
  notes and once on the page, and the page can move a value back
  ("Count as instrument").
- **A uses `workspace.instrument`, not the rows' starting values.** A
  starting value is not always the file's (1.3).

### 4.2 Cases A cannot split

Each term (X and Y separately) falls back to B, with a note that names it:

- **The file gave no value** (a FullProf `.irf` read before its X, Y were
  read; an `.instprm` without X, Y). The old row started from the placeholder,
  and nothing says how much of it is the instrument's. The value stays in the
  instrument row, marked "instrument and sample not separated". Loading the
  instrument file again lets the page split it.
- **The refined value is below the file's.** The rest would be negative,
  which is no size and no strain. The refined value stays in the instrument
  row, marked "refined, differs from the file (file: …)".
- **The row is tied** to another by an expression.

### 4.3 What else the migration carries

- **Free or held.** Where A splits, the instrument row becomes held and the
  sample row takes the old row's free or held state. The model space is then
  the old one.
- **esds and correlations** of the last result move to the sample row, scaled
  by the same constant as the value. Correlations do not change under a
  positive scale.
- **Several phases.** Section 6.
- **Uniaxial microstrain.** Y_⊥ and Y_∥ each lose the file's Y (exact for the
  linear form, section 2.3). In version 2 the instrument's Y had no effect
  under this model (apart from a floor that acts only on a negative sum), so
  the instrument Y row is set to the file's value and the total is unchanged.
- **Stephens.** Unchanged; the isotropic Y splits as above.
- **History.** Each stored step is migrated by the same function, so Undo
  goes back to a migrated page. A test opens a version-2 project and steps
  through its whole history.
- **Starting values.** The instrument rows' Reset target is the file's value;
  a sample row's is none.

### QUESTION 6: how are old projects migrated?

- **(a) A, with B for the terms A cannot split** (4.2), a note saying what
  was done, and a way to move a value back.
- **(b) B for everything.** Bit for bit. The user splits by hand, or never.
- **(c) Ask on opening.**

**Recommendation: (a).** It keeps the pattern to 10⁻¹⁵, keeps the reported
size and strain where the report already put them, and makes the bank switch
right. (b) is bit-identical, but it leaves the defect this plan exists to
remove in every old project. This is the place where correctness and a
bit-identical migration conflict; the table above is the trade.

## 5. Defaults on a fresh load

### 5.1 The sample rows: none, or GSAS-II's defaults?

- GSAS-II gives a new phase Size 1 µm and Mustrain 1000. As width
  coefficients: Y_s = 5.73 centidegrees at any wavelength; X_s = 0.24
  (λ = 0.41 Å), 0.88 (1.54 Å), 1.38 (2.41 Å). Together they add this much
  Lorentzian FWHM:

  | 2θ | λ = 0.4138 Å | λ = 1.5406 Å |
  |---|---|---|
  | 10° | 0.007° | 0.014° |
  | 30° | 0.018° | 0.024° |
  | 60° | 0.036° | 0.043° |
  | 120° | 0.104° | 0.117° |

  On a high-resolution instrument whose peaks are a few thousandths of a
  degree wide, that is several times the peak width.
- **What do a file's X and Y stand for?** It depends on how the file was
  made, and the file does not say:
  - from GSAS-II's peak fit of a standard: the standard's whole Lorentzian
    width, with nothing taken out (2.1);
  - from a GSAS-II Rietveld fit of a standard with the phase left at its
    defaults: what is left after 1 µm and 1000;
  - a GSAS `.prm`: LX, LY of GSAS, which has no separate sample terms
    (GSAS manual pp. 162-164: the sample's part is "Y − Y_i").
- The time-of-flight page starts its sample rows at 1 µm and 1000 for a
  GSAS-II file (`powderSpec.ts:180-181`, `tofFileProfileOf`), on the second reading.

### QUESTION 7: where do the CW sample rows start?

- **(a) At none** (microstrain 0, no size term). The fresh-load pattern is
  the file's X, Y, Z alone: today's pattern bit for bit when Z = 0. Nothing
  unknown is claimed. The GSAS-II bundle then sets each phase's Size and
  Mustrain explicitly, so GSAS-II calculates the same pattern.
- **(b) At GSAS-II's new-phase defaults for a GSAS-II file**, as the
  time-of-flight page does. The page then shows what GSAS-II shows on import.
  Every CW fresh load with such a file changes, by the table above.

**Recommendation: (a).** Peak-fit files and GSAS `.prm` files hold totals, so
adding 1 µm and 1000 to them counts the standard's width twice; and the first
refinement frees the sample rows anyway. This differs from the
time-of-flight page's choice. I do not propose changing that here, but the
owner may want the two to agree: if so, say which way.

### 5.2 Which rows the staged method frees

Today the profile stage frees U, V, W, X, Y, the asymmetry and the zero
together (`structureRefinement.ts:890`).

### QUESTION 8: which rows does the CW profile stage free?

- **(a) U, V, W, the asymmetry and the zero as today, and the sample's size
  and microstrain rows in place of X and Y.** Instrument X, Y, Z stay held.
  Where the sample rows stay above zero this is today's model space under new
  names, so today's fits are reached again.
- **(b) The sample rows, the zero and the asymmetry; U, V, W held too**
  whenever the file gives them: the time-of-flight rule ("its rows are the
  instrument's own values and stay held"). Instrument terms are freed only by
  a diagnosis that the file does not describe the data.
- **(c) As today:** instrument X, Y free and the sample rows held.

**Recommendation: (a) now.** (b) is the stricter physics and may be where
this should end, but it changes what the Copilot's method does on every CW
case, and it is the owner's method. It deserves its own decision after the
split is in and validated. (c) keeps the defect.

### QUESTION 9: may a sample width go below zero?

Today Y may refine down to −50, and X down to 0 in total, which can be below
the file's X.

- **(a) No: both sample rows are bounded at 0.** Peaks narrower than the
  instrument file allows are then a finding ("the instrument file does not
  describe this setup: its Lorentzian terms are too wide"), and the remedy is
  to refine the instrument's X, Y deliberately. Fits that today end below the
  file's values will end differently.
- **(b) Yes: the microstrain row may go negative**, as Y does today.

**Recommendation: (a).** A negative size or strain has no meaning. Letting
the sample row absorb an instrument file's error is the mixing this plan
removes.

## 6. Several phases

- **Each phase has its own size and microstrain rows** (`p0_…`, `p1_…`), as
  GSAS-II has them. The instrument rows are shared, as today.
- **The magnetic phase uses its parent's rows.** Magnetic peaks are placed
  with the parent phase's sample rows and the pattern's instrument rows. A
  magnetic domain size of its own (a magnetic correlation length shorter than
  the crystallite) is real physics and is not in this plan.
- **Migration of a multi-phase project.** Version 2 has one shared X and Y.

### QUESTION 10: how does a shared X, Y become per-phase rows?

- **(a) Every phase gets the same value, and phases 2 and up are tied to
  phase 1.** The model is exactly the old one: one size, one strain. The user
  unties them to let the phases differ.
- **(b) Every phase gets the same value, untied.** Freeing them adds
  parameters the old fit did not have.

**Recommendation: (a).** The migration should not change the model.

### QUESTION 11: do the time-of-flight sample rows become per-phase too?

Today `tofSampleLorentz`, `tofSampleSize` and `tofSampleGauss` are shared by
all phases (`multiPhase.ts:31-38`). GSAS-II has them per phase, and THY-89's
Q4 says "one value per phase".

- **(a) Not in this plan.** A later step, with its own migration (it can use
  this plan's tie rule).
- **(b) In the same schema version as this plan.**

**Recommendation: (a)**, but decided now so that the schema version of
section 11 knows whether to carry it. It touches the time-of-flight model,
which this plan otherwise leaves alone.

## 7. Bank switch

On a switch between banks of one data file (`app/bankKeep.ts`,
`app/bankFollow.ts`):

- **Follows the bank:** U, V, W, X, Y, Z, the zero and the asymmetry. Each
  takes the new bank's file value, held, with that value as its Reset target:
  how U, V, W and the zero already behave. X, Y, Z need no special case any
  more: they are in the Instrument group, which `followsInstrument` reads.
  #211's `fileLorentzian` is not needed.
- **Kept:** every phase's size and microstrain rows, with value and free,
  held or tied state. They are sample properties in sample units, so they
  stay right if the new bank has another wavelength. (This is one reason for
  Q4's recommendation.)
- **A bank whose file has no X, Y or Z:** the instrument rows are 0, "not in
  the file". #211 kept the row in this case because the row also held the
  sample's part. That reason is gone.
- **When the instrument does not switch** (a one-bank instrument file, or a
  bank the file does not cover): the instrument rows return to the held
  file's values, as #202 already does for U, V, W.
- **History and Undo:** one step, "Data bank N → M, refinement values kept",
  as today. Undo restores the old bank's instrument rows as they were
  refined, with the data and the instrument.
- **Per-bank fit windows** (#207): unchanged.
- **Tests:** #211's four tests carry over with the new expectations: X, Y, Z
  from the new bank's file exactly; the sample rows bit-identical across the
  switch; Undo; a file without X, Y, Z.
- **Several banks at once (THY-89):** instrument rows per bank, sample rows
  per phase shared by the banks. This plan's routing (2.2) is that already.

## 8. Model-visible and user-visible strings

Everything in 8.1 and 8.2 is read by the Copilot and **needs the hub's
review before it merges.** The drafts assume the recommendations (Q3 (a),
Q4 (b)); they change with the answers. "…" stands for text that does not
change.

### 8.1 Rows, state and tools

| Where | Today | Draft |
|---|---|---|
| Row `profX` label (`structureRefinement.ts:462`) | "size (Lorentzian X)" | "Lorentzian X (instrument)" |
| Row `profY` label (`:463`) | "mustrain (Lorentzian Y)" | "Lorentzian Y (instrument)" |
| Row `profZ` (new) | none | "Lorentzian Z (instrument)" |
| Microstrain row (new) | none | "mustrain (×10⁻⁶, GSAS-II CW)" |
| Size row (new) | none | "size 1/D (µm⁻¹)" |
| Panel group of `profX`, `profY` (`parameterGroups.ts:19-20`) | Microstructure | Instrument / profile |
| `get_state` rows (`agent/report.ts:71-74` group names) | `profileX`, `profileY` → "profile" | unchanged for X, Y, Z; the new kinds → "microstrain", "size" |
| `get_state` instrument statements (`agent/powderTools.ts:634`) | none on CW | one line: "Instrument file gives U, V, W, X, Y, Z: held. The sample's broadening is each phase's mustrain and size rows." |
| `set_microstrain` description (`agent/tools.ts:896`) | "isotropic (Lorentzian Y), uniaxial (equatorial/axial about c), or generalized (…)" | "isotropic (the phase's mustrain row), uniaxial (…), or generalized (…)" |
| `interpret` tool description (`agent/tools.ts:750`) | "crystallite size and microstrain (powder)…" | unchanged; its numbers now come from the sample rows, no subtraction |
| MCP `mustrain` argument and the materials tool (`mcp/registry.ts:109`, `:191`) | as the two above | as the two above |

### 8.2 Diagnoses, refusals and skill text

| Where | Today | Draft |
|---|---|---|
| `fitDiagnosis.ts:250` | "…so U (and the Lorentzian Y, strain) matter most…" | "…so U (and the sample's mustrain) matter most…" |
| `fitDiagnosis.ts:251` | "…hold the Lorentzian X and Y at the instrument's values if they are free." | "…the instrument's X, Y, Z are held at the file's values; lower the sample's size and mustrain rows, to 0 if needed." |
| `fitDiagnosis.ts:276` | "A Lorentzian component is missing: free the Lorentzian X (size, 1/cosθ) and Y (strain, tanθ) with the Caglioti terms; a negative X or Y is unphysical, hold it at 0." | "A Lorentzian component is missing: free the sample's size (1/cosθ) and mustrain (tanθ) rows with the Caglioti terms." |
| `fitDiagnosis.ts:277` | "…the Lorentzian X or Y (or a fixed η) is too large…" | "…the sample's size or mustrain (or a fixed η) is too large; if both are 0, the instrument file's X, Y are too wide for these data." |
| `fitDiagnosis.ts:557`, `:559` | "…then the Lorentzian X (size) and Y (strain)…"; "…and the Lorentzian X are already free…" | "…then the sample's size and mustrain rows…"; "…and the size row are already free…" |
| `assessment.ts:180` | "The Lorentzian X (size, 1/cosθ) and Y (strain, tanθ) widths differ only in how they grow with angle… Refine Y (or X) alone…" | "The size (1/cosθ) and mustrain (tanθ) widths differ only in how they grow with angle… Refine the mustrain (or the size) alone…" |
| `assessment.ts:502-503`, `findingLines.ts:74-76` | "size (Lorentzian X) refined negative…"; "… → hold it at 0, refine U, V, W" | for the instrument rows: "Lorentzian X (instrument) refined negative…"; the sample rows cannot be negative (Q9) |
| New finding (Q9) | none | "Peaks are narrower than the instrument file's Lorentzian terms allow (size and mustrain at 0): the file does not describe this setup." |
| New refusal (2.2) | none | "Not run: Lorentzian X (instrument) and the size row are free together. They widen every peak in the same way (1/cosθ), so the data cannot tell them apart." (and the same for Y and mustrain) |
| `method.ts:62-65`, `:80` (groups) | `profileX`, `profileY` in the instrument group | Q12 below |
| `method.ts:386` | "…(σ₂² and σ_q² on TOF, U, X and Y at constant wavelength)…" | "…(σ₂² and σ_q² on TOF, U, V, W and the instrument's X, Y, Z at constant wavelength)…" |
| `.claude/skills/my-rietveld-workflow/notes.md`, "When the instrument file gives the TOF profile" | time of flight only | a CW paragraph: "At constant wavelength the file's X, Y, Z are the instrument's and stay held. The sample's broadening is each phase's size and mustrain rows; the profile stage frees those with U, V, W. Both at 0 with peaks still too wide in the model means the file does not describe the setup: say so." |
| `.claude/skills/magnetic-analysis/SKILL.md:119` | "CW U, V, W, X, Y, S/L, …" | "CW U, V, W, the sample's size and mustrain, S/L, …" |
| `core/diagnostics/__goldens__/agentVisibleText.json` (lines 804-882) | holds the old labels | re-baselined with the change |
| `agent/__snapshots__/model-text.arm-b.md`, `arm-c.md` | hold the tool descriptions | re-baselined with the change |

### QUESTION 12: in the Copilot's method, which group are the new sample rows in?

The method keeps three groups apart: instrument terms, thermal parameters,
and the sample's broadening ("the microstrain alone"). Today `profileX` and
`profileY` are instrument terms, and so are the time-of-flight sample rows
beside a file's profile ("the peak shape's share of the fit").

- **(a) The instrument group**, with the same note as on time of flight. The
  profile stage refines them with U, V, W, never with the thermal parameters
  or the positions. This is today's behaviour under the new names.
- **(b) The broadening group.** They are refined alone, after the instrument
  terms.

**Recommendation: (a).** It matches the time-of-flight rule and keeps the
method's results where they are. (b) is closer to the words of the rule, and
it is the owner's method: if (b), the staged order changes and Q8 follows it.

### 8.3 User-visible only

- The readout and its tooltip (`PowderWorkbench.tsx:1343-1377`, `:1934`): no
  subtraction; shows D (µm), GSAS-II's Mustrain, Δd/d and ε, each named. The
  wrong line "GSAS-II microstrain = LY·π/72000·10⁶ ppm" goes.
- The microstrain menu's hint (`:727`, `:2025`): "Isotropic is each phase's
  mustrain row…".
- The report (`app/reportInputs.ts:147-165`, `:363`; `core/export/report.ts`
  `KIND_UNIT`, `:374-382`, and the group list at `:420`): rows "Crystallite
  size" and "Microstrain" from the sample rows, with their definitions; new
  units for the new kinds; the wrong "×10⁻⁶" on `mustrainPerp`,
  `mustrainPar`, `stephensStrain` corrected. `reportMarkdownFrozen.ts` is
  frozen text and stays.
- The fit-cause cards (`app/ui/fitCauses.ts:206-207`, `:243`, `:303`): the
  same wording as 8.2.
- The Instrument card: "Not used: Lorentzian Z." goes (Q1). The Data card's
  bank "?" text gains "X, Y and Z follow the bank; size and mustrain stay".
- `docs/EQUATIONS.md` §8 and §10 (when #210 has merged),
  `docs/MICROSTRUCTURE.md`, `docs/USER_GUIDE.md`, `docs/PROJECT_FORMAT.md`,
  `docs/AGENT_TOOLS.md:631`, `GLOSSARY.md`, `CHANGELOG.md`.

## 9. Exports

### 9.1 GSAS-II

- **Today (a defect):** the bundle writes the refined X, Y into the
  `.instprm` (`core/export/gsas2.ts:188-192`, with Z = 0) and sets each
  phase's Size and Mustrain only on time of flight
  (`core/export/bundle.ts:498`). On CW the phases keep GSAS-II's defaults, so
  GSAS-II adds 1 µm and 1000 to widths that already hold the sample. The
  table of section 5 is the size of the error.
  - Run: a CW bundle from `refinementBundle` with X = 3.5, Y = 7.25 has
    `X:3.5`, `Y:7.25` in its `.instprm`, and neither its script nor its README
    mentions Size or Mustrain (a temporary test, not committed).
  - Run: a phase added to a CW histogram through GSAS-II's scriptable
    interface has Size `[1.0, 1.0, 1.0]` and Mustrain `[1000.0, 1000.0, 1.0]`.
  - Read and run: GSAS-II adds those to X and Y (section 2.1).
  - **Not run:** the whole chain, a bundle opened in GSAS-II and its widths
    compared with MATERIA's. Step 0 does that first.
- **Target:** the `.instprm` carries the instrument rows X, Y, Z.
  `build_gpx.py` sets, for each phase, `Size` (isotropic, D, Lorentzian) and
  `Mustrain` (isotropic, M, Lorentzian). A phase with no size term gets the
  existing "none" value (`GSAS2_NO_SIZE`, 10⁶ µm). The README states the
  values, as it does for time of flight, and says that an import through
  GSAS-II's own window starts from GSAS-II's defaults instead.
- **Round trip.** With Q3 (a) the Mustrain is the row's number. D is 1/row,
  one division. GSAS-II then computes the equations of 2.1, which are the
  ones MATERIA computed.

### QUESTION 13: is today's CW bundle fixed before the split?

- **(a) Now, in its own small pull request**, as the preferred-orientation
  bundle was (#208): on CW the script sets every phase to Mustrain 0 and no
  size, so GSAS-II's widths are the X, Y the fit used. The first task is to
  confirm the defect end to end, by opening a bundle in GSAS-II.
- **(b) With the split.**

**Recommendation: (a).** A bundle that gives wrong widths in GSAS-II should
not wait for a model change.

### 9.2 FullProf

- FullProf's CW Lorentzian is `H_L = X·tanθ + Y/cosθ` in degrees: its X is
  the strain term and its Y the size term, the reverse of GSAS-II
  (`core/export/fullprof.ts:22-24`, `:265-270`; FullProf manual 2001).
- With a resolution file (Res = 1) the `.irf` holds
  `H_G² = (U_i·tanθ + V_i)·tanθ + W_i` and `H_L = X_i·tanθ + Y_i/cosθ + Z_i`,
  and the `.pcr`'s U, X, Y are then the sample's strain and size. The manual
  says instrument and sample are treated "using the Voigt approximation", so
  Lorentzian widths add and Gaussian widths add in quadrature. **How FullProf's
  code adds them is not verified**: there is no source, and nothing was run.
- **Today:** the `.pcr` is written with Res = 0 and the total X, Y.
- **Target, first delivery:** the same, as totals:
  FullProf X = (Y_i + Y_s)/100, FullProf Y = (X_i + X_s)/100, where X_s and
  Y_s are the sample rows as width coefficients. FullProf's Res = 0 function
  has no constant term, so a non-zero Z is named as not carried. The README
  says the widths are totals.

### QUESTION 14: when does the FullProf bundle become an `.irf` plus a sample-only `.pcr`?

- **(a) After a check against the owner's FullProf run**, as the
  time-of-flight path waits for one. Until then, totals with Res = 0.
- **(b) Now**, from the manual alone.

**Recommendation: (a).**

### QUESTION 15: is the FullProf CW `.irf` reader fixed before the split?

Its X_i, Y_i, Z_i are read past today, and the page starts from X = 1.

- **(a) Now, in its own small pull request:** FullProf's X_i → Y, Y_i → X,
  Z_i → Z, each ×100. Fresh loads with a CW `.irf` change, and the pull
  request lists the change.
- **(b) With the split.**

**Recommendation: (a)**, for the same reason as Q13. Z has no row until the
split, so until then a non-zero Z_i gets the "Not used" line.

### 9.3 The guard test from #208

`core/export/bundleCarriesEveryKind.test.ts` requires every kind in
`EXPORTED_KINDS` to change both bundles. `profileX` and `profileY` stay.
`profileZ`, `cwSampleMustrain` and `cwSampleSize` join, each with a case:
a CW binding on a phase, two values, both bundles must differ. For FullProf
the sample rows differ through the totals. `exportConventions.test.ts` gains
the Size and Mustrain conversions with hand-calculated values.

## 10. Goldens, evals and demos

- **Dark steps** (section 12, steps 2 to 5): nothing moves. Gate: goldens and
  the scripted eval dump bit-identical, as #211 showed for its change (172
  tests, one sha256 with the time stamps blanked).
- **At the switch**, three kinds of change:
  1. **Text.** Row labels, groups and the tool text of section 8 change, so
     the two model-text snapshots, `agentVisibleText.json` and every snapshot
     that lists rows move. Reviewed by the hub.
  2. **Calculated patterns at loaded values.** Bit-identical, by the gate of
     2.2, for a file with Z = 0 and sample rows at none (Q7 (a)). A file with
     a non-zero Z moves (Q1). A FullProf `.irf` moves at Q15's pull request,
     not here.
  3. **Refined values.** The free set changes from {U, V, W, X, Y} to
     {U, V, W, size, mustrain}. Where both sample rows end above zero it is
     the same model space and the same minimum, reached by other iterates:
     numbers move at the convergence tolerance, not bit for bit. Where
     today's fit ends below the file's X or Y, or with a negative Y, the new
     fit ends on the bound with a finding (Q9), and wR is worse. Each such
     case is listed for the owner with both results before the goldens are
     replaced.
- **Can it be bit-identical?** The dark steps and the loaded patterns, yes.
  The refinements, no, unless Q4 (c) and Q6 (b) are both chosen, which this
  note advises against.
- **Where CW X, Y rows appear in tests** (found by search, not by running):
  `core/workflow/realPowderXRD.test.ts`, `gsasBenchmark.test.ts`,
  `microstructureRefinement.test.ts`, `obsCalc.test.ts`,
  `cellCheckResolution.test.ts`, `app/powderSpec.test.ts`,
  `app/ui/fitCauses.test.ts`, the diagnostics tests, `agent/report.test.ts`,
  `agent/correlationCheck.test.ts`, the two export tests. The complete list
  is the first product of step 2.
- **Bundled examples.** The synthetic CW example has no Caglioti profile and
  no X, Y rows. The Mn₃Ga, NOMAD and local magnetic examples are time of
  flight. So, as far as the search shows, no bundled demo's numbers move.
  **The owner's own CW projects** move as section 4 says.
- **Evals.** The scripted evals run locally in the step that changes the
  text. A local-model run follows. The paid re-baseline goes with the
  release, at the owner's call.

## 11. The schema version

The project format is at version 2 (`core/project/migrate.ts`,
`docs/PROJECT_FORMAT.md`). Two changes already wait for version 3, to be made
in one bump: the preferred-orientation plan's texture block (its Q15, step 4,
THY-103), and the PDF projects' mode vectors (each mode's displacement
vectors saved with its amplitude; already decided by the owner).

This plan is a third change of the same kind: it changes what `profX` and
`profY` mean and adds kinds. An old build must refuse such a file, so it
needs a version.

### 11.1 One bump for three migrations

- **Three independent sub-steps.** `migrateV2ToV3` is the composition of
  three pure functions on the raw document: `textureBlock`, `pdfModeVectors`,
  `cwSplit`. They touch disjoint parts (the corrections and the `po` row; the
  PDF workspace's mode rows; the powder workspace's CW profile rows), so their
  order does not matter. A test applies them in all six orders and gets one
  document.
- **Each has its own gate**, on version-2 files saved from `main` before the
  change: texture and mode vectors bit for bit; the CW split as section 4.
- **Each is built dark first.** Its core model, its migration function and
  its version-3 validator merge to `main` unused: the page still builds and
  saves version 2, and nothing moves.
- **One switch.** A short-lived branch `format-v3` collects the three page
  switches, one pull request each, each reviewed and checked against that
  branch. The branch merges to `main` once, with `PROJECT_SCHEMA_VERSION = 3`
  and the three sub-steps registered. `main` is deployed as it is merged, so
  it must never save a version-3 file that a later version-3 build would read
  differently. One merge guarantees that.
- **Order on the branch:** the PDF mode vectors (small, no powder code); the
  per-phase texture (THY-103, already decided); the CW split last (its
  questions are open and it has the most text). The texture and the CW split
  both change how per-phase powder rows are built, so they are done one after
  the other by one builder at a time.
- **If one of the three is late**, the owner can take it out of version 3 and
  give it version 4. The sub-steps are independent, so nothing else changes.
- **This changes two written plans**, which are updated when Q16 is answered:
  the preferred-orientation plan's step 4 ("Per-phase texture and the format
  version", THY-103) becomes a dark core plus a page switch on `format-v3`;
  and its Q15 note that each change gets its own version no longer holds for
  these three. THY-89's list of patterns keeps its own, later version.

### QUESTION 16: does the CW split join the single version-3 bump?

- **(a) Yes, as above:** three dark cores on `main`, one `format-v3` branch
  for the three page switches, one merge.
- **(b) Yes, but format first:** one pull request defines the version-3
  shapes and the three migrations, with adapters that map the new shapes back
  onto today's in-memory models; each page switches later in its own pull
  request. Smaller pieces on `main`; the adapters are extra code that is
  thrown away, and the CW adapter has to add the sample back into X and Y.
- **(c) No: its own version** (4), after version 3.

**Recommendation: (a).** One version, one re-baseline, no adapters. (c) if
the owner wants the texture work not to wait for this plan's questions.

## 12. Delivery in steps

Each step is one pull request with its gate. The author is a high-effort
builder; each pull request gets an independent review before it merges. Sizes
are builder-hours and are rough. Estimates on this project have run about two
times low: the sizes add up to 86 hours, so expect nearer 170.

0. **The GSAS-II bundle on CW** (4 h; Q13). Confirm the defect end to end by
   opening a bundle in GSAS-II; set each phase's Mustrain to 0 and Size to
   none.
   *Gate:* GSAS-II's calculated widths equal the X, Y the fit used, per
   reflection.
1. **The FullProf CW `.irf` reader** (3 h; Q15). *Gate:* the values equal the
   file's text; the moved fresh loads are listed.
2. **Census and fixtures** (4 h). A test that lists every place a CW X or Y
   row is read. Version-2 project fixtures saved from `main`: a file with X,
   Y; a file without; several phases; uniaxial; generalized; a refined value
   below the file's; a tied row; a page opened on stored values; a project
   with History. *Gate:* nothing moves.
3. **The model in the core, dark** (12 h). The new kinds, the widths of 2.2,
   the routing per phase, the magnetic peaks on the parent's rows, the
   never-free-together rule. *Gate:* goldens and eval dump bit-identical;
   with the sample at none, today's pattern bit for bit; GSAS-II's
   `GetSampleSigGam` and `GetReflSigGamCW` equations reproduced per
   reflection to 10⁻¹² on invented cases.
4. **Validation, dark** (14 h). A generator that imports nothing from the app
   plants a size and a microstrain on an instrument with X, Y, Z. *Gate:* both
   recovered within 2 esds; a negative control (none planted, both at 0
   within their esds); a GSAS-II refinement of the same data agrees within 2
   combined esds; the degenerate pairs refused. An illustrated report for the
   owner.
5. **Exports and migration, dark** (14 h). The GSAS-II script per phase, the
   FullProf totals, the guard test's new cases; `cwSplit` on the fixtures of
   step 2. *Gate:* the bundle opens in GSAS-II and its pattern equals
   MATERIA's; every fixture's pattern within 10⁻¹³ of its version-2 pattern,
   wR to every printed digit; the fallbacks of 4.2 each hit and named.
6. **The page switch, on `format-v3`** (16 h). The spec builder, the groups,
   the staged method (Q8), the bank switch (section 7), the readout and the
   report, the strings of section 8 as approved, History migration. *Gate:*
   #211's tests with the new expectations; the list of moved numbers and
   moved strings for the owner and the hub; browser checks at three widths.
7. **The Copilot** (10 h, and the eval budget). The method's groups (Q12),
   the skill text, the snapshots, the scripted evals, a local-model run.
   *Gate:* the evals pass; the paid re-baseline goes with the release, at the
   owner's call.
8. **MCP** (3 h). *Gate:* an MCP client builds, refines and exports a CW
   session with sample rows.
9. **Documents** (6 h). EQUATIONS, MICROSTRUCTURE, the user guide, the
   project format, the glossary, the changelog. Each earlier step updates
   what it changes; this step is the pass over the whole.

- Steps 0 and 1 are independent fixes and can start as soon as Q13 and Q15
  are answered.
- Steps 2 to 5 touch no screen and no saved file. The owner reads the
  validation report of step 4 before anything a user sees changes.
- Step 6 waits for the other two version-3 changes (section 11).
- **Later, each with its own questions:** GSAS-II's uniaxial and generalized
  forms (Q2); the Gaussian share of the sample widths (GSAS-II's mixing
  coefficients); the time-of-flight sample rows per phase (Q11); holding U,
  V, W by default (Q8 (b)); a magnetic domain size; the FullProf `.irf`
  bundle (Q14).
- **Conflicts:** `core/workflow/powder.ts` is also owned by the
  reflection-margin work and by the deferred equations comments. Step 3
  starts after those have merged.

## 13. The questions, collected

Ordered by what they hold up. Each line is the question and my
recommendation.

**Can be answered and built now, before the split**

- **Q13. Is today's CW GSAS-II bundle fixed before the split?** (a) Now, in
  its own small pull request.
- **Q15. Is the FullProf CW `.irf` reader fixed before the split?** (a) Now,
  in its own small pull request.

**Needed before step 3 (the model)**

- **Q1. Does the constant term Z join the model?** (a) Add the Z row.
- **Q3. Which number does the CW microstrain row hold?** (a) GSAS-II's CW
  Mustrain, with Δd/d and ε shown beside it.
- **Q4. What does the size row hold?** (b) The inverse size 1/D in µm⁻¹,
  always present, 0 = none, with D in µm shown beside it.
- **Q2. What happens to the uniaxial and generalized models now?**
  (a) Isotropic first; today's functions move to the sample's side; GSAS-II's
  forms later.
- **Q9. May a sample width go below zero?** (a) No: bounded at 0, with a
  finding.
- **Q11. Do the time-of-flight sample rows become per-phase too?** (a) Not in
  this plan.

**Needed before step 5 (migration)**

- **Q6. How are old projects migrated?** (a) Split by the file's values, with
  the old value left in the instrument row where that cannot be done, a note,
  and a way to move a value back.
- **Q10. How does a shared X, Y become per-phase rows?** (a) Every phase gets
  the same value, phases 2 and up tied to phase 1.
- **Q16. Does the CW split join the single version-3 bump?** (a) Yes: three
  dark cores, one `format-v3` branch, one merge.

**Needed before step 6 (the page)**

- **Q7. Where do the CW sample rows start?** (a) At none.
- **Q8. Which rows does the CW profile stage free?** (a) U, V, W, the
  asymmetry and the zero as today, and the sample rows in place of X and Y.
- **Q5. Which Scherrer constant does the size readout use?** (a) GSAS-II's
  Size as it is (K = 1 on the FWHM), in µm.
- **Q12. In the Copilot's method, which group are the new sample rows in?**
  (a) The instrument group, as on time of flight.

**Needed later**

- **Q14. When does the FullProf bundle become an `.irf` plus a sample-only
  `.pcr`?** (a) After a check against the owner's FullProf run.

## 14. What was verified, and how

**By running GSAS-II's own function** (v5.11.0; a script kept outside the
repository; invented inputs):

- `GSASIIstrMath.GetSampleSigGam`, CW: the Lorentzian width equals
  1.8·λ/(π·D·cosθ) + 0.018·M·tanθ/π to 12 digits for three cases
  (for example 2θ = 60°, λ = 1.5 Å, D = 1, M = 1000: 4.30036538429
  centidegrees), and the Gaussian variance is 0 when both mixing coefficients
  are 1.
- The mixing coefficients: with mx = 0 the variance is (S_γ² + M_γ²)/(8 ln 2);
  with mx_S = 0.3, mx_M = 0.7 both parts match the formulas of 2.1.
- Time of flight: width = 10⁻⁴·difC·d²/D + 10⁻⁶·difC·d·M.
- The factor of 2 between the CW and the time-of-flight Mustrain (3.1).

**By reading GSAS-II's source:**

- `GSASIIstrMath.py`, `getPowderProfile` → `GetReflSigGamCW`: X/cosθ +
  Y·tanθ + Z + the sample's width; the two floors of 0.001.
- `GSASIImath.py`, `SetDefaultDData`: the new-phase defaults.
- `GSASIImath.py`, `getCWsig`, `getCWgam`; `GSASIIpwd.py`, `getPeakProfile`:
  no sample term in the peak fit.
- `GSASIIpwd.py`, `getgamFW`; `sources/powsubs/psvoigt.for`: the
  Thompson–Cox–Hastings coefficients.
- `GetSampleSigGam`, "uniaxial" and "generalized": the forms of 2.3.

**By reading the manuals** (local copies; nothing run):

- GSAS manual (2004), pp. 162-164: Δ2θ = (Δd/d)·tanθ; S = (π/18000)·(Y − Y_i);
  p = 18000·K·λ/(π·X).
- FullProf manual (2001): the CW widths with their strain and size terms; the
  Res = 1 resolution function with X_i, Y_i, Z_i; the definition of apparent
  strain.

**By running GSAS-II's scriptable interface:** a phase added to a simulated
CW histogram gets Size 1 µm and Mustrain 1000 (`add_phase`,
`add_simulated_powder_histogram`, then the phase's `Histograms` entry).

**By running MATERIA's code** (a temporary test at `118a9406`, not
committed): the CW GSAS-II bundle's `.instprm`, script and README, as 9.1
says.

**By reading MATERIA's code** (`main` at `118a9406`): everything in section 1.

**By calculation in double precision** (invented values, not the app's
code): the round-off figures of section 4, and the tables of sections 3 and 5.

**Not verified:**

- The bundle defect end to end: its three links are run or read (9.1), but no
  bundle was opened in GSAS-II and compared (step 0 does it).
- Whether GSAS-II's authors intend the factor of 2 between CW and time of
  flight.
- How GSAS-II imports a GSAS `.prm` (whether LX, LY become X, Y unchanged).
- How FullProf's code combines an `.irf` with the `.pcr`'s widths; whether
  current FullProf versions still follow the 2001 manual.
- Whether MATERIA's Stephens invariants and GSAS-II's generalized terms are
  the same basis.
- The complete list of tests and evals that move (section 10): found by
  search.
- The width of any real instrument's peaks: the remark in 5.1 on
  high-resolution instruments is a general one, with no file read.

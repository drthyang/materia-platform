# Plan: Rietveld refinement over several banks (DRAFT)

> **Status: all questions decided (section 0, 2026-11-26/27). Nothing here is built.** Linear
> THY-89. Each numbered QUESTION is a choice for the owner; my recommendation
> is given with it and all of them are collected in [section 13](#13-the-questions-collected).
>
> Numbers in this document are round and illustrative (a time-of-flight
> instrument with five or six banks of about 3000 points each). No number comes
> from the owner's sample data.

## The proposal in short

- One structure is refined against all chosen banks at once: one residual, one
  least-squares fit, one set of esds, as GSAS-II does with several histograms.
- The structure and the sample are shared (cell, atoms, ADPs, occupancies,
  moments, phase fractions, microstrain, size). Each bank keeps its own scale,
  background, calibration, peak shape and fit range.
- Banks are weighted by their counting statistics alone (1/σ²), as GSAS-II and
  FullProf do by default. The page shows wR for each bank and for all together.
- The powder page holds a list of patterns, each with its instrument bank. A
  page with one pattern behaves exactly as today, and old projects open
  unchanged.
- It is delivered in small steps. The first two are the joint fit in the core
  and its validation against a known truth and against GSAS-II, before any
  screen changes.

Words used here: a **pattern** is one measured histogram with its own
instrument description; a **bank** is the pattern of one detector bank of a
time-of-flight instrument. `GLOSSARY.md` has neither word yet; the first step
adds them.

## 0. Decisions (2026-11-26)

Decided by the owner, or by the Session monitor under the owner's delegation
(scientific correctness first; the owner reviews where needed). These replace
the recommendations in the questions below where they differ.

**From the owner's request.** The user co-refines all five banks or a chosen
subset. Every bank has a weight factor, editable in the first delivery.

**Science and validation**

- **Q8 Weighting:** "equal weighted" means every bank's weight factor is 1, on
  top of its counting statistics (GSAS-II `wtFactor` = 1, FullProf equal
  `W_PAT`). χ², GoF and the esds then keep their statistical meaning. When a
  factor is changed, the page and the report state the factors, and say that
  the esds are no longer pure counting-statistics esds. No automatic balancing.
- **Q1:** one scale per bank.
- **Q2:** phase fractions shared across banks.
- **Q3:** calibrations held and the cell free, by default. "One reference bank
  held, the others' difC free" is an explicit choice. The cell is never freed
  together with every difC.
- **Q4:** microstrain and size shared, one value per phase.
- **Q5 Absorption (owner, 2026-11-27):** the NOMAD reduced data are
  corrected for sample absorption in reduction. So there is no absorption term
  in the fit, and the report says the data were corrected in reduction (not
  that "no absorption correction was applied"). A shared-μR correction for data
  that were not corrected stays a later step (step 12); it is not needed before
  first real use.
- **Q6:** no preferred orientation in the first delivery.
- **Q7:** excluded regions are out of scope.
- **Q9:** the overall GoF judges the fit. Each bank in a worse band is named
  beside it.
- **Q15:** all chosen banks from the first refinement. Best-bank-first is a
  user choice.
- **Q16:** profile terms for all banks with the structure held, then held while
  the structure refines.
- **Q17 and Q18:** a finding or a satellite counts when every covering bank that
  has the resolution and the counting statistics to see it at that size shows
  it.
  - A bank that cannot see it is not held against it, and the table says so
    ("seen in bank 1; banks 3–5 not sensitive enough at this size").
  - A feature that a sensitive bank does not show is flagged as a likely
    artefact.
- **Q19:** the banks that reach the magnetic peaks rank the groups. All chosen
  banks take part in the final moments fit.
- **Q23 First public case:** Mn₃O₄ on POWGEN. The owner's published NOMAD
  GaTa₄Se₈ 300 K data (Phys. Rev. Research 4, 033123 (2022)) stays a local
  file: it may be mentioned and shown in screenshots, never committed. It is
  the local real-data check.
- **Q24:** agreement with GSAS-II means the shared parameters within 2
  combined esds, with the per-bank wR side by side.

**UI, architecture and format**

- **Q10:** option A, a list of patterns in one powder session and one joint
  problem.
- **Q11:** a general list in the data model. Time-of-flight banks of one
  measurement are offered and validated now.
- **Q12:** this work gets its own format version.
- **Q13:** a tab per bank, plus a stacked "All" view on d.
- **Q14:** a multi-bank file opens on one bank. "Use several banks" adds the
  rest.
- **Q20:** the Copilot is off on multi-bank pages until its own step, with a
  plain note saying why.
- **Q21:** Copilot tools come later. Their wording goes to the owner.
- **Q22:** GSAS-II export first. FullProf after a check against the owner's
  FullProf run.

**Musts.**

- Agreement with GSAS-II on public multi-bank data is the proof.
- Each bank's parameters come from #179's NOMAD 2023A five-bank file, paired
  by bank number and checked against the data's DIFC.

**Order.** The gauge fix, then #179 with the bank follow, then Can lines, then
this work, one builder at a time.

## 1. What exists today, and what is missing

**What exists** (since the change described in
[reports/2026-11-20-instprm-banks.md](./reports/2026-11-20-instprm-banks.md)):

- A GSAS data file with several banks and a GSAS-II `.instprm` with several
  banks are both read completely. FullProf `.irf` files (one per bank) are read.
- The Data card and the Instrument card each offer the banks. The instrument
  bank follows the data bank by number, checked against the difC the data file
  states (3 % tolerance). A data bank with no instrument bank is named.
- The page refines **one** bank. Choosing another bank replaces the pattern.
- The time-of-flight profile is being completed in another branch (Lorentzian
  terms, sig-1, sample microstrain and size rows; THY-88). This plan assumes it
  has landed and does not change it.

**What is missing for a joint refinement:**

- The session, the project file, History, the compute worker, the reports, the
  exports, the Copilot and the MCP tools each hold exactly one pattern, one
  instrument, one background, one fit range and one wR.
- No builder makes one least-squares problem from several powder patterns.
- There is no time-of-flight absorption correction (the existing one is for
  constant wavelength only). Absorption depends on wavelength, so it differs
  between banks at the same d. See QUESTION 5.
- No reflection is calculated below d = 0.5 Å. High-angle banks of a
  total-scattering instrument carry data well below that. This is studied
  separately (THY-90); until it is settled each bank's fit range must stop
  above the floor.
- The page fits one window per pattern. There are no excluded regions inside a
  pattern.

**What already fits the job:**

- Every per-pattern row (scale, background, zero, calibration, peak shape)
  already names its pattern in its binding. Routing a row to its bank needs no
  new concept.
- The least-squares engine sees only a vector of observations, weights and a
  calculate function. A joint fit is a longer vector. The engine's recent
  work (the per-parameter step cap, esds that include held parameters) works on
  parameter names and carries over unchanged.
- The core already has a joint fit of one structure against several PDF
  datasets ([`buildMultiDatasetPdfProblem`](../src/core/workflow/pdf.ts)), and
  a powder fit of several phases against one pattern
  ([`buildMultiPhasePowderProblem`](../src/core/workflow/multiPhase.ts)). The
  joint powder builder follows both.
- The propagation-vector search works from d-spacings alone, so it does not
  care which bank a peak came from.

One caution on the precedent: the multi-dataset PDF fit exists in the core
only. The PDF page loads one dataset, and no worker, tool or screen calls that
builder. So there is a precedent for the mathematics and none for the screen.

## 2. The model: what is shared and what is per bank

The rule: what belongs to the sample is shared; what belongs to a detector
bank is per bank. The table gives the proposal and what the two reference
programs do. GSAS-II's entries were read in its source (version 5.11.0);
FullProf's in the owner's multi-pattern `.pcr` and FullProf's notes.

| Term | Proposed | GSAS-II | FullProf |
| --- | --- | --- | --- |
| Cell | shared | per phase | written with each pattern; kept equal |
| Positions, ADPs, occupancies | shared | per phase | per phase (one atom list) |
| Moments | shared | per phase | per phase |
| Phase fraction | shared (Q2) | per phase and histogram | a scale per phase and pattern |
| Scale | per bank (Q1) | per histogram | per phase and pattern |
| Background | per bank | per histogram | per pattern |
| Zero, difC, difA, difB | per bank, held from the file (Q3) | per histogram | per pattern, as shifts on the `.irf` |
| Peak shape (α, β, σ, Lorentzian) | per bank, held when a file gave it | per histogram | per pattern, `.irf` plus shifts |
| Sample microstrain, size | shared (Q4) | per phase and histogram | per phase and pattern |
| Absorption | none today (Q5) | per histogram | per pattern |
| Preferred orientation | later (Q6) | per phase and histogram | per phase and pattern |
| Fit range | per bank | per histogram | per pattern |
| Excluded regions | per bank, when built (Q7) | per histogram | per pattern |
| Weight of the bank | 1 (Q8) | a factor per histogram, default 1 | a weight per pattern |

Both programs make almost everything outside the atom list independent for
each histogram and leave it to the user to tie values together (GSAS-II by
constraints, FullProf by giving two parameters the same code). The proposal
shares the sample's terms from the start: a free copy per bank of something
the sample has only once lets each bank hide its own error in it.

**The physics, term by term**

- **Cell, positions, ADPs, occupancies, moments.** One sample, one structure.
  The magnetic form factor depends on d only, so the moments are the same in
  every bank.
- **Background.** Each bank sees its own air, can, inelastic and diffuse
  scattering. Always per bank: its own number of terms and, if wanted, its own
  basis.
- **Peak shape.** The moderator pulse and the bank's geometry set α, β, σ and
  the Lorentzian terms. They come from the instrument file per bank and stay
  held where the file gave them (the THY-88 decision).
- **Fit range.** Each bank is good over its own stretch of d. The range is a
  choice per bank.

### QUESTION 1: one scale per bank, or one overall scale?

In principle a perfectly normalized measurement has one scale: every bank
measures the same sample. In practice the banks differ by a few percent or
more after reduction (vanadium normalization, absorption, multiple scattering,
detector efficiency).

- **(a) One free scale per bank.** What GSAS-II and FullProf do. A
  normalization error of a bank goes into its scale and nowhere else. Cost:
  one more parameter per bank, and each scale trades with the ADPs within its
  bank.
- **(b) One overall scale with fixed ratios between banks.** Fewer parameters
  and a stronger hold on the ADPs. It is right only if the reduction's
  relative normalization is trusted to well under a percent. If it is not, the
  error goes into the ADPs and occupancies. It would also need the bank-angle
  factor of the Lorentz correction (sin θ), which the page leaves in the scale
  today.

**Recommendation: (a).** After a fit, the page can show the ratios between the
bank scales as a check on the reduction.

### QUESTION 2: phase fractions with several phases

- **(a) Shared.** One scale per bank and one fraction per phase, the same in
  every bank. A sample has one composition. With B banks and P phases this is
  B + P − 1 free scale rows.
- **(b) Free per phase and bank.** GSAS-II's and FullProf's default: B × P
  rows. The weight fraction of an impurity can then come out different in each
  bank, and something has to choose which one to report.

**Recommendation: (a).** A bank in which the minority phase fits visibly worse
then points at something real (absorption, a profile error), where (b) would
hide it. How the rows are written (absolute scales per bank, or one bank's
scale and ratios) does not change the fit and is settled when the rows are
built, with the owner seeing them.

### QUESTION 3: the shared cell against each bank's calibration

A line's position is TOF = Zero + difC·d + difA·d² + difB/d. A change of the
cell by a factor and of every bank's difC by the inverse factor leaves every
pattern unchanged. So the cell and all the difC values can never be free
together: it is an exact case of the owner's rule on correlated parameters.

A sample that sits slightly off the calibrated position changes each bank's
flight path and angle by a different fraction, so the banks then disagree on
the cell by small amounts. Back-scattering banks are the least sensitive.

- **(a) All calibrations held, cell free.** The instrument file is trusted.
  The cell comes mostly from the best-resolved bank. A bank whose lines are
  displaced shows it in its residual.
- **(b) One reference bank held, the other banks' difC free.** GSAS-II users'
  usual practice. It absorbs a sample offset, at one more free parameter for
  each bank beyond the reference; the cell then rests on the reference bank's
  calibration alone.
- **(c) A free zero per bank.** Small and safe on a wide d range, but a zero
  is not what a sample offset does to the lines.

**Recommendation: (a) by default**, with a per-bank reading of the line
positions (does this bank's residual show a shift?), and **(b) as an explicit
choice** when a bank disagrees, with the refusal rule that at least one bank's
difC is held while the cell is free. (c) stays as it is today: the zero row
exists per bank and is fixed on load.

### QUESTION 4: sample microstrain and size, shared or per bank?

The sample has one microstrain and one crystallite size. Each bank turns them
into a width in microseconds through its own difC (GSAS-II: microstrain width
∝ difC·d, size width ∝ difC·d²), so one value serves every bank with no
conversion by the user.

- **(a) Shared, one value per phase.** The physics. The joint fit then
  separates sample broadening from instrument broadening far better than one
  bank can, because the instrument part differs between banks and the sample
  part does not.
- **(b) Per bank.** GSAS-II's and FullProf's default. If a bank's instrument
  file is a little off, its own sample term absorbs the error and the fit
  looks better. The values then disagree between banks and none is the
  sample's.

**Recommendation: (a).** Offer (b) later only as a diagnostic ("refine this
bank's broadening separately and compare"): values that disagree say the
instrument file of that bank does not describe it.

### QUESTION 5: absorption

Neutron absorption grows with wavelength, and at one d each bank uses a
different wavelength (λ = 2d·sin θ). A back-scattering bank loses more
intensity at long d than a low-angle bank does at the same d. Within one bank
this looks like a smooth change of intensity with d, which trades with the
ADPs. Between banks it makes the same structure ask for different ADPs. The
page has no time-of-flight absorption term today.

Seeing the same d at different wavelengths is also the strength of a joint
fit: it is what separates a wavelength effect (absorption) from a d effect
(the ADPs), which one bank cannot do.

- **(a) No absorption term** (as today). Right when the reduction has already
  corrected for absorption, or the sample absorbs little. The free scale per
  bank takes the average loss; the d-dependent part is left in the residual
  and in the ADPs.
- **(b) One shared coefficient** (μR per ångström of wavelength), applied to
  each bank at its own angle, fixed from the composition and the can radius or
  refined at the corrections stage. The physical model.
- **(c) One free coefficient per bank.** GSAS-II's default. More freedom than
  the sample has; each trades with the shared ADPs.
- **(d) An overall B per bank** (FullProf's Bov per pattern). The common
  empirical substitute. It fits well and hides the true ADPs.

**Recommendation:** steps 1 to 9 of the delivery use **(a)**, and the report
says that no absorption correction was applied. Then **(b)** as its own step,
validated against GSAS-II. Two things the owner knows and the code cannot: is
the reduced data already corrected for absorption, and is (b) wanted before
the first real use?

(b) needs each bank's scattering angle. Instrument files do not always carry
a correct one, so the angle is checked against the calibration before it is
used: difC ≈ 505.56 · L · sin θ (L the total flight path in metres, θ half the
bank angle). A bank whose angle and difC disagree is named and not corrected.

### QUESTION 6: preferred orientation

Banks at different angles look at the sample along different directions, so
the effect of texture can differ between banks; how much depends on the
sample geometry. GSAS-II and FullProf give each histogram its own
March–Dollase ratio; a proper description is a texture model in spherical
harmonics, which the page does not have.

**Recommendation:** leave preferred orientation out of the first delivery. A
bank with texture is refused for the joint fit with a line saying so, until a
dataset needs it; then one ratio per bank on a shared axis, with a tie
offered.

### QUESTION 7: excluded regions inside a bank

The table lists them per bank, but the page has none today: one window per
pattern. With several banks a bad stretch of one bank can often be dropped by
shortening that bank's range, because another bank covers the same d.

**Recommendation:** not part of this work. If wanted, it is a small separate
feature (per pattern, in the project file), and it serves single-pattern
users as well.

## 3. The residual and the weighting

**The function minimized** is one sum over every point of every chosen bank:

χ² = Σ over banks b of f_b · Σ over points i of (y_obs − y_calc)² / σ²

with σ from the data file and f_b = 1. This is exactly GSAS-II's function: its
per-histogram weight factor (`wtFactor`) is f_b, default 1, and it adds
nothing that depends on the number of points. FullProf minimizes a weighted
sum of each pattern's χ² with weights (`W_PAT`) that it normalizes to sum to
one; equal by default. Whether FullProf also divides each pattern's χ² by its
number of points I could not confirm from a primary source; it is checked
before the FullProf comparison is written.

**The numbers reported**

- **wR of a bank**: √(Σ w·(y_obs − y_calc)² / Σ w·y_obs²) over that bank's
  fitted points. It does not depend on f_b.
- **Overall wR**: the same ratio with both sums taken over all banks. It is
  not the mean of the banks' values: each bank counts by its Σ w·y_obs², so a
  bank with high counts dominates it.
- **GoF**: √(χ² / (N − P)), N all fitted points, P all free parameters. One
  number for the fit.
- **Esds**: from the joint covariance, multiplied by the GoF, as today and as
  GSAS-II does. One badly fitted bank therefore widens every esd, including
  those of parameters it does not determine.
- **Per bank, beside wR**: the points fitted, the expected wR from the points
  alone (GSAS-II's `wRmin`), χ²/N of the bank, and the bank's share of the
  total χ². A GoF per bank would need a share of the parameters, which is
  arbitrary; χ²/N is honest.

**What a much larger bank does.** With statistical weights a bank pulls on
the shared parameters in proportion to its information: more points or
higher counts, more pull. That is correct when the misfit is noise. When the
GoF is well above 1 the misfit is mostly systematic (peak shape, background),
which does not shrink with counts. The high-count bank's profile error then
steers the structure, and its Σ w·y_obs² can be ten times another bank's.

### QUESTION 8: the weighting between banks

- **(a) Statistical weights only** (f_b = 1). The default of both programs,
  and the only choice for which χ², GoF and the esds keep their meaning.
- **(b) A weight factor per bank set by the user**, default 1, as GSAS-II's
  `wtFactor` and FullProf's `W_PAT`. Useful to stop one bank from steering the
  fit. The esds are then no longer those of the counting statistics, and the
  report must say so with the factors.
- **(c) Automatic balancing** (each bank scaled to equal weight, or to its
  χ²). It looks fair and has no statistical basis; the esds mean nothing.

**Recommendation: (a) in the first delivery, (b) later as a visible, reported
setting, never (c).** The honest remedy for a bank that steers the fit through
a profile error is to fix its profile or shorten its range, and the per-bank
share of χ² shows where to look.

### QUESTION 9: which number judges the fit?

The method's acceptance bands (excellent to 1.5, good to 2.5, fair to 4) are
written for one GoF.

**Recommendation:** the overall GoF decides, and every bank whose χ²/N falls
in a worse band than the overall value is named beside it ("good overall;
bank 2 fair"). History shows the overall wR.

## 4. Architecture

Two ways to hold several banks were worked through.

### Option A: a list of patterns inside one powder session

The session holds `patterns`, a list. Each entry carries its pattern, its
instrument bank, the original files, its background settings, its fit range
and whether it takes part. The parameter table stays one flat list: the shared
rows as today, and each bank's rows named with the bank ("Bank 3: scale") and
bound to that bank's pattern.

- **Problem builder.** One new builder loops over the chosen patterns. For
  each it routes the shared rows and that bank's own rows to the existing
  per-pattern calculation (the same peak builder, profile and background
  code as today) and writes the result into that bank's stretch of one long
  vector. Restraints follow at the end, as now. This is the shape of
  `buildMultiDatasetPdfProblem`. Several phases and the magnetic model use the
  same loop: the per-pattern calculation is what the single-pattern builders
  already do.
- **One bank stays today's code path.** A session with one pattern calls
  today's builders untouched, so nothing can move for existing users. A
  separate test shows the joint builder given one bank returns the same
  numbers bit for bit.
- **Jacobian, memory, time** (illustrative). Five banks × 3000 points are
  15 000 observations. With 20 shared and 8 per-bank free rows there are 60
  free parameters: the Jacobian is 15 000 × 60 numbers, about 7 MB. One
  calculation of one bank takes about 10 ms on a laptop today (a cubic cell of
  10 Å, about 300 reflections per bank above the 0.5 Å floor), so all banks
  take about 50 ms and a finite-difference Jacobian about 3 s on one thread,
  less on the worker pool. A bank's own row changes only that bank, so the
  other banks can be reused from the last calculation; this is an
  optimization to add only if a measurement asks for it. A low-symmetry cell
  or a lower d floor multiplies the reflections, and the time with them, by
  ten or more: to be measured in step 3, with the 30-minute rule for any
  automated run.
- **Engine.** No change to the least-squares core. It needs one small
  addition around it: the result should carry where each bank's stretch
  begins, so that per-bank agreement is computed from the same vector the fit
  used. The step cap, the staged guards and `esdWith` work on parameter names
  and are unaffected. The correlation refusal (|ρ| ≥ 0.95) is read from the
  joint covariance, which is where the cell–difC case of QUESTION 3 shows.
- **Compute worker.** The request and the evaluator description gain the list
  of patterns. The pool still splits the Jacobian by column across up to six
  workers; each worker builds the same joint problem. Live progress today
  assumes one pattern's points come first in the vector; it has to split the
  vector by bank.
- **Cost.** Everything that reads "the pattern" has to read "the patterns":
  the session and page model, the project file, History, the workbench, the
  reports and exports, the magnetic step, the Copilot's view, the MCP tools.
  The steps in section 12 take them one at a time.
- **Risks.** A wide change to a validated page, and the per-pattern
  calculation has to be lifted out of three validated builders (one phase,
  several phases, nuclear with magnetic) without changing a digit. Held down
  by keeping the one-pattern path as it is, by bit-for-bit tests on the
  existing goldens at every step, and by landing the core and its validation
  before any screen.

### Option B: several one-pattern sessions linked by shared parameters

Each bank is its own session, as today. A link declares which rows are the
same in all of them (cell, atoms, ADPs, …).

- **What it keeps.** Each bank's page, tools, checks and exports work as now.
  The first screen change is small.
- **What it still needs.** A joint fit is one least-squares problem whatever
  holds the data, so the joint builder of option A is needed anyway.
  Refining the sessions in turn is not a joint refinement: it converges slowly
  where banks share information, and its esds ignore the other banks.
- **What it adds.** Every change to the structure (an atom added, a tie, an
  antisite pair, a magnetic model, a change of space group) must be copied to
  every session and can drift. One History step becomes several sessions'
  snapshots. The project file holds one workspace today and would hold
  several. The Copilot's page port has one session.
- **Risks.** Two copies of the truth about the structure. Bugs of the kind
  "bank 2 still has the old occupancy tie" are silent and scientific.

### QUESTION 10: option A or option B?

**Recommendation: A.** The structure exists once, so it should be stored
once. B's saving is on the first screen only; it pays for it everywhere the
structure changes. A also reaches the roadmap's joint X-ray and neutron
refinement with the same data model (next question).

### QUESTION 11: "banks of one measurement" or "any patterns of one sample"?

The list can be general: each entry has its own radiation and instrument, so
a constant-wavelength X-ray pattern and a neutron pattern could share a
structure (a gate on the roadmap, M1). Or it can be limited to time-of-flight
banks of one measurement.

**Recommendation:** make the data model general (a list of patterns), and
limit what is offered, tested and validated in this plan to time-of-flight
banks of one measurement at one temperature. Mixed radiations need their own
physics choices (ADPs and scale across radiations, anomalous scattering) and
their own validation; they are not hidden in this work.

## 5. Project format and History

- **A new version, 3.** `patterns` replaces the single pattern, instrument,
  original files, background settings, fit range and data source in the powder
  block. A version 2 build refuses a version 3 file with a clear message, as
  the format rules require; adding an optional field instead would let an old
  build open a multi-bank project as one bank and refit it wrongly without a
  word.
- **Migration 2 → 3.** The single pattern becomes the one entry of the list.
  Parameter names, values and bindings do not change: the rows already name
  their pattern. No number is touched.
- **The guarantee, tested.** Saved version 2 projects (the fixtures, the
  demos and the goldens) open in the new build, show the same wR, and a
  refinement from them gives the same parameters and esds bit for bit as the
  build before the change.
- **History.** Each History step stores a snapshot of the workspace, and the
  migration today touches only the top of the file. It must also migrate every
  step, once, on load. Data are stored once per file by content today; the
  list must keep that for each bank, so that a step's snapshot points to a
  bank's data and does not copy it, and switching a bank in or out, or
  changing one bank's range, stays a small step.
- **History labels.** A joint fit is one step with the overall wR. Changes
  name their bank ("bank 3 fit range", "bank 6 left out").

### QUESTION 12: one new version or two?

THY-88 (size and microstrain in GSAS-II's definitions) also plans a new
format version.

**Recommendation:** keep them separate, each with its own migration and
tests; whichever merges first is version 3 and the other 4. One migration that
changes both the shape and the numbers would make "opens unchanged" hard to
prove for either.

## 6. The page

- **Loading.** Two ways, both needed. (1) One data file with several banks and
  one instrument file with several banks: what is read today. (2) One file per
  bank, the FullProf way (a `.dat` and an `.irf` each): an "Add pattern"
  control on the Data card, pairing each data file with its instrument file.
- **Choosing banks.** The Data card lists the banks with a tick each, its
  points, its d range and its instrument bank with the difC check. A bank with
  no instrument bank cannot be ticked and says why.
- **Plot.** A tab per bank and an "All" tab. A bank's tab is today's plot,
  with that bank's fit-range handles. "All" stacks the banks on one d axis, so
  a feature can be followed from bank to bank.
- **Parameter table.** Groups: Structure (shared), Sample (shared), then one
  group per bank holding its scale, background, zero and calibration, and peak
  shape. Bank groups fold. "Free the same rows in every bank" is one action.
- **Agreement.** The overall wR and GoF where they are now, and a small table
  per bank (points, wR, expected wR, χ²/N, share of χ²).
- **Fit ranges.** Per bank, in the bank's own unit, with a helper to apply one
  d range to every bank.

A sketch (numbers invented):

```
Data        file.gsa    [x] 1  [x] 2  [x] 3  [x] 4  [x] 5  [ ] 6 no instrument bank
Pattern     [ All | 1 | 2 | 3 | 4 | 5 ]        wR 6.1 %   GoF 2.3   (5 banks)
            +----------------------------------+    bank  points  wR %  chi2/N
            | bank 3: obs, calc, difference    |      1    2400    7.9    3.1
            | fit range handles of this bank   |      2    2600    6.4    2.4
            +----------------------------------+      3    2900    5.2    1.9
Parameters  > Structure (shared)  > Sample (shared)  > Bank 1  > Bank 2  ...
```

### QUESTION 13: tabs, or all banks stacked?

**Recommendation:** both, as above: tabs for working on a bank, "All" for
reading the fit as a whole. If only one is built first, tabs.

### QUESTION 14: what does a multi-bank file do on load?

- **(a) As today:** it opens on one bank. A control "Use several banks" lists
  the banks that have an instrument bank, all ticked.
- **(b) It opens on all paired banks at once.**

**Recommendation: (a).** Nothing changes for someone who wants one bank, and
the joint fit is one click away. The first refinement of five banks is also a
heavier thing to start without being asked.

## 7. The staged method with several banks

The owner's method carries over block by block. "Per bank" below means the
rows of every chosen bank, freed together unless said otherwise.

- **Stage 0, data and range.** Nothing is freed. For each bank: the axis and
  calibration checks, the pairing check, the fit range.
- **Stage 1, scale, background, cell.** Each bank's scale and background, and
  the shared cell. The calibrations are held (QUESTION 3).
- **Stage 2, positions.** Shared. A quick pass, as now.
- **Stage 3, profile.** Where a file gave a bank's profile: the shared sample
  terms. Where none did: that bank's α, β, σ terms and zero. The cell is held
  and the B values are fixed, as now.
- **Stage 4, ADPs.** Shared, alternating with the instrument group.
- **Stage 5, occupancy.** Shared. The guardrail is unchanged.
- **Stage 6, corrections.** Absorption, when built (QUESTION 5). Polish, as
  now.
- **Last, the symmetry review**, read over all banks (QUESTION 17).

**How the rules carry over**

- **Correlated parameters never together.** Measured on the joint covariance,
  so pairs across banks count. New exact cases the refusal must know: the
  cell with every bank's difC (Q3); with several phases, the phase fractions
  with every bank scale. The terms of one bank's background among themselves
  stay exempt, as one curve's terms are today.
- **The instrument's terms never with the B values or the positions.** "The
  instrument's terms" now means those of every bank. The alternation
  (instrument, B values, microstrain alone) is unchanged; it settles when no
  group moves by more than 0.3 esd.
- **The microstrain alone.** It is one shared row, so this rule gets easier,
  and better determined (Q4).
- **Symmetry questioned last.** Unchanged, and stronger: a leftover peak or a
  forbidden reflection must appear in every bank that covers its d and can
  resolve it.
- **Magnetic step: the moments refine with the nuclear model held.**
  Unchanged. The rounds that today alternate the moments with the scale and
  the background alternate them with every bank's scale and background, and
  the esds include all of those.
- **The final instrument pass.** As decided in THY-88: when a file gave a
  bank's profile, the pass frees the sample terms (shared) and holds the
  file's rows; when none did, it frees that bank's zero and every peak-shape
  term, never a subset.

### QUESTION 15: all banks from the first refinement, or the best bank first?

- **(a) All chosen banks from stage 1.** One path. The cell is set mostly by
  the sharpest bank anyway, and a bank that disagrees shows at once.
- **(b) The best-resolved bank alone for the cell and positions, the others
  added after.** Closer to how many people start. Two paths to maintain, and
  the first fit ignores the long d-spacings only the low-angle banks see.

**Recommendation: (a).** Leaving banks out by hand remains possible at any
time (the ticks).

### QUESTION 16: profile terms of several banks, together or bank by bank?

When no file gave the profile, each bank has about nine shape rows and a zero.
In stage 3 the cell is held and the B values are fixed, so the banks share no
free parameter: the fit of all banks together then gives the same result as
one bank after another, and the same esds.

**Recommendation:** all banks together, for that reason. The same holds for
the first scale-and-background fit. Once a shared row is free the banks are
coupled, and the blocks follow the table above.

### QUESTION 17: the cell check and the symmetry review over banks

Both read leftover peaks. Each bank has its own resolution and d range.

**Recommendation:** run them per bank and read them together. A finding
counts when every bank that covers that d and could resolve it shows it; a
peak seen in one bank and absent in another that should show it is reported
as that bank's ("seen in bank 2 only") and is not evidence about the
structure. This is a check one pattern cannot give.

## 8. The magnetic step over banks

Magnetic peaks sit at long d. On an instrument like NOMAD they fall mostly in
the low-angle banks, which reach long d with broad peaks (a few percent in
Δd/d, illustrative); the back-scattering banks stop near 1.5 to 2 Å and are
ten times sharper.

- **Peak search.** Today one residual gives one list. With banks: search each
  bank's residual, then merge by d into one list. Each merged peak keeps the
  banks that see it, its significance in each, and its position from the
  sharpest bank that sees it.
- **k-search.** Unchanged in the core: it takes d-spacings and weights. Two
  things need care. Its matching tolerance is the larger of 0.02 Å and 0.5 %
  of d today, which is tighter than a low-angle bank's peak width; the
  tolerance should come from each peak's own position uncertainty. And the calibration
  of a low-angle bank is usually the least certain, which moves every
  long-d peak together.
- **Ranking the magnetic groups.** Each candidate's moments are fitted with
  the nuclear model held and the candidates are compared by wR and by
  Hamilton's test. Banks with no magnetic intensity add nothing to the
  comparison and dilute it: their misfit enters every candidate's χ² alike.
- **k = 0.** The method refines the nuclear model at short d first, where the
  form factor has faded. With banks this is a d limit applied to every bank,
  which in practice leaves the low-angle banks nearly out; it is not a choice
  of banks.

### QUESTION 18: which peaks does the k-search take?

**Recommendation:** peaks from the merged list that every covering bank
confirms. A peak seen in only one of two banks that cover its d is shown,
marked, and left out by default (the user can include it), as peaks on
nuclear reflections are left out today.

### QUESTION 19: which banks does the magnetic analysis use?

- **(a) All chosen banks, everywhere.** One model and one residual from start
  to end. The ranking is diluted by banks that carry no magnetic signal.
- **(b) The "magnetic banks" for the ranking, all banks for the final
  refinement.** The magnetic banks are those whose fit range reaches at least
  one magnetic peak; the page proposes them and the user confirms. The
  ranking then compares candidates where they differ. The final moments and
  their esds come from all banks, one consistent model.
- **(c) The user picks the banks for the whole magnetic step.**

**Recommendation: (b).** In every case the wR gain over the nuclear-only fit
is shown per bank, so it is plain where the magnetic signal is.

## 9. The Copilot and the MCP tools

**The Copilot today** sees one pattern everywhere: one data block, one
instrument, one fit window, one background, one wR, one residual, one peak
table. No tool takes a bank.

**What it needs**

- The page state names the banks: for each, its range, points, wR and whether
  it takes part; and the overall agreement.
- The tools that act on one pattern take an optional bank: the fit range (set
  and check), the background, the instrument constants, the fit diagnosis and
  the leftover-peak search. One new tool chooses which banks take part.
- The method text (`my-rietveld-workflow`, `magnetic-analysis`) gains the
  per-bank stages of section 7 and the rules of section 8.
- The rule checks that count "the instrument's terms" must count every bank's.

**All of this is model-visible.** Tool descriptions and schemas are pinned by
snapshot files, and the method text is the owner's. Under the project's rules
a new tool, a changed description and a skill change each need the owner's
approval, then scripted eval scenarios (a good and a bad run for each: a
range set on the wrong bank, a bank's instrument terms refined with the B
values, a report that quotes one bank's wR as the fit's), a local-model run,
and the paid re-baseline that goes with a release. That makes the Copilot its
own late step.

**MCP tools.** `parse_powder_data` and `parse_instrument` have no bank
argument and return the first bank without naming it (already listed as open
in the banks report). They gain a bank argument and say which banks the file
holds. `refine_powder`, `refine_magnetic_powder`, `check_fit_range` and
`export_bundle` accept a list of patterns. MCP descriptions are not
snapshot-pinned, but the tool tables are generated and each tool's result
shape is tested.

### QUESTION 20: the Copilot before it knows banks

Between the page (step 5) and the Copilot (step 10) a multi-bank page exists
that the Copilot does not understand.

**Recommendation:** on a page with several banks the Copilot is switched off
with one line saying so, until its step lands. A Copilot acting on five banks
with a one-bank view would quote wrong numbers with confidence. On a page
with one bank nothing changes.

### QUESTION 21: a bank argument on existing tools, or new tools?

**Recommendation:** an optional `bank` on the existing tools, one new tool to
choose banks, and a per-bank block in the page state. Fewer tools for the
model to choose among; the cost is that every changed description is
re-approved and re-baselined, which new tools would need as well.

## 10. Reports and exports

- **Report.** A table per bank (bank, fitted d range, points, wR, expected
  wR, χ²/N, scale, background terms), the overall agreement, one figure per
  bank, and the shared structure table once. The text says which banks took
  part, how they were weighted and that no absorption correction was applied
  (until QUESTION 5 is built).
- **CIF.** The structure with the overall agreement, as now. Per-bank profile
  blocks (pdCIF) are not written today for one pattern and are not added
  here.
- **Pattern CSV.** One file per bank, or one file with a bank column.
- **GSAS-II bundle.** The original data and instrument files unchanged, and a
  script that adds one histogram per bank (GSAS-II's scripting interface takes
  the bank of the data file and of the instrument file), sets each bank's
  limits and background, and links the phase to every histogram. GSAS-II
  counts data banks by their position in the file, not by the number on the
  BANK line; the script must follow that. This also closes a gap left open
  today: a bundle made on a bank other than the first does not carry that
  bank's instrument.
- **FullProf bundle.** A multi-pattern `.pcr`, one data file per bank and one
  `.irf` per bank (the original when the user loaded one). The writer today
  produces the single-pattern layout; the multi-pattern layout is a different
  file, so this is a new writer. It can only be checked by running FullProf.

### QUESTION 22: both bundles at once?

**Recommendation:** the GSAS-II bundle first, checked by running GSAS-II
locally on the bundle; the FullProf bundle after it, with the owner running
FullProf on a prepared case as agreed for the profile work.

## 11. Validation plan

Three kinds of evidence, in this order.

### 11.1 Consistency checks (no outside data)

- **One bank.** The joint builder given one bank returns the single-pattern
  result bit for bit: the calculated pattern, χ², parameters, esds.
- **Order.** Permuting the banks changes nothing: χ², the shared parameters
  and their esds agree to rounding (a stated relative tolerance near 10⁻⁹;
  sums in a different order are not bit-identical).
- **Two copies of one bank.** The same pattern entered twice, each copy with
  its own scale and background: the same parameter values (to the
  convergence tolerance), χ² doubled, and each shared parameter's esd equal to
  the one-bank esd divided by √2 and multiplied by a small known factor from
  the degrees of freedom, √[(2N − 2P_s − 2P_b) / (2N − P_s − 2P_b)], with N
  the points of one copy, P_s the shared and P_b the per-bank free
  parameters. The test asserts this exact value, not only "about √2".
- **Independent blocks.** With every shared row held, the joint fit of all
  banks equals each bank fitted alone (parameters and esds).
- **Derivatives.** Analytic columns against finite differences over the long
  vector, as the existing gate does for one pattern.
- **A bank left out** is the same as that bank never loaded.

### 11.2 Known truth from an independent generator

- **A generator that imports nothing from the app's core**, as the existing
  moments validation has: its own structure factors and profile for three or
  more banks with different resolution, d range and count rate, seeded
  counting noise. The joint fit must recover the true structure: every
  parameter within about 3 esd on each seed, and over many seeds the scatter
  of (fitted − true)/esd close to 1.
- **GSAS-II as a second generator.** GSAS-II can simulate a time-of-flight
  histogram from an instrument bank; several banks from one structure give a
  truth made by another program with the same profile functions (once THY-88
  has landed). Noise is added with a fixed seed.
- **What the truth cases must include:** banks that overlap in d and banks
  that do not; one bank with ten times the counts of another (the weighting);
  a shared microstrain (QUESTION 4); a deliberately wrong calibration of one
  bank (it must show in that bank's residual and not as a wrong cell without
  warning); a magnetic case whose peaks sit in the low-angle banks only.

### 11.3 Against GSAS-II on public data

The same model refined in GSAS-II and in MATERIA from the same starting
point, compared parameter by parameter.

Candidates, all in GSAS-II's tutorial collection
(`AdvancedPhotonSource/GSAS-II-tutorials`), identified only; nothing large was
downloaded:

- **Mn₃O₄ at 10 K, POWGEN, two frames** ("Magnetic-V"): two data files with
  different d ranges, an instrument file for each, and GSAS-II's own project. Nuclear and magnetic. The best first case, and it serves
  section 8 as well.
- **SF₆ at 190 K, GEM** ("RMCProfile-I"): one data file with three banks and
  one instrument file with six, the true "one file, several banks" layout. Its
  data records use a GSAS layout the reader does not parse yet (`ALT`), and
  the plastic phase is poorly described by a simple model, so it is a reader
  and bookkeeping case more than a structure case.
- **A fluoride standard with CaF₂, POWGEN, two frames, with synchrotron X-ray
  data**
  ("TOF-CW Joint Refinement"): two phases; the neutron pair alone tests
  shared phase fractions (QUESTION 2), and the full set is the X-ray plus
  neutron case of QUESTION 11.

**Licence.** That repository's licence file is the GSAS-II open-source
licence (UChicago Argonne; royalty-free use and redistribution with the
notice kept). It does not speak of the data files separately, and GitHub
lists the licence as "other". Under the project's rule for reference data
(ADR 0005) the files stay out of this repository: an opt-in script fetches
them, and the comparison's numbers are written into the test with their
source.

**The owner's own files** (the NOMAD sample data and the silicon standard
with its five-bank FullProf and GSAS-II set) are used the same way as today's
local checks: opt-in, on the owner's machine, numbers never in the
repository.

### QUESTION 23: which public case first?

**Recommendation:** Mn₃O₄ on POWGEN, then the GEM file once the reader takes
its layout. A NOMAD dataset the owner is free to publish (a standard such as
silicon) would be the most relevant case of all, if one can be released.

### QUESTION 24: what counts as agreement with GSAS-II?

**Recommendation:** the method's existing bar: every shared structure
parameter within 2 combined esds, the esds themselves within a stated factor
(for example 20 %), and each bank's wR reported side by side. Equal wR is not
required: the backgrounds and the weighting details of the two programs
differ slightly even on one pattern.

## 12. Delivery in steps

Each step merges on its own, with its tests, and leaves the one-bank page
exactly as it was. Sizes are in builder-days and are rough. On this project
such estimates have run about two times low: the sizes below add up to 43
days, so expect nearer 85.

1. **The joint problem in the core** (3 days). The builder, the routing of
   rows to banks, several phases, the per-bank agreement. No caller yet.
   *Proves:* the residual and the model of section 2 are right (the checks of
   11.1).
2. **Known truth and the first GSAS-II comparison** (4 days). *Proves:* the
   joint fit recovers a truth it did not make, and agrees with GSAS-II (11.2,
   11.3).
3. **The compute path** (2 days). The worker request, the pool, the staged
   fit, progress per bank. *Proves:* the worker gives the core's result; time
   and memory are measured, not estimated.
4. **The session and the project file** (4 days). A list of patterns in the
   session, format version 3, History. *Proves:* old projects open unchanged
   and refit identically.
5. **The page** (6 days). Loading, choosing banks, tabs, parameter groups,
   per-bank agreement and ranges. *Proves:* a person can run a joint fit;
   browser checks at three widths.
6. **The method on the page** (3 days). The stages, the firm rules on the
   joint covariance, the per-bank checks. *Proves:* the staged path reaches
   the direct joint fit's result.
7. **Report, CSV and the GSAS-II bundle** (3 days). *Proves:* the bundle
   opens in GSAS-II and refines to the same result.
8. **The magnetic step over banks** (5 days). *Proves:* k, the ranking and
   the moments on the two-frame Mn₃O₄ case and on a truth case.
9. **The FullProf multi-pattern bundle** (3 days). *Proves:* the owner's
   FullProf run agrees.
10. **The Copilot** (5 days, and the eval budget). Tools, method text,
    snapshots, scripted evals, a local-model run. *Proves:* the Copilot
    handles banks; the paid re-baseline follows with the release.
11. **The MCP tools** (2 days). *Proves:* an MCP client can load, refine and
    export several banks.
12. **Time-of-flight absorption** (3 days), if QUESTION 5 says so. *Proves:*
    agreement with GSAS-II's correction.

- Steps 1 and 2 touch no screen and no saved file. The owner can read their
  results before anything a user sees is changed.
- Before step 1: the profile work of THY-88 merged. Step 4 and THY-88's own
  format change should not be in flight together (QUESTION 12). The d floor (THY-90)
  decides how far the high-angle banks' ranges can go, not whether this work
  can start.
- Each step updates the documents it changes: the user guide, LIMITATIONS,
  VALIDATION, the data model, the project format, the glossary.

## 13. The questions, collected

Ordered by what they hold up. Each line is the question and my recommendation.

**Needed before step 1 (the core)**

- **Q10. Option A or B?** A: a list of patterns in one session, one joint
  problem.
- **Q11. Banks only, or any patterns of one sample?** A general list in the
  data model; only time-of-flight banks of one measurement offered and
  validated here.
- **Q1. Scale.** One free scale per bank.
- **Q2. Phase fractions.** Shared across banks.
- **Q4. Sample microstrain and size.** Shared, one value per phase.
- **Q3. Cell against calibration.** Calibrations held and the cell free by
  default; "one reference bank held, the others' difC free" as an explicit
  choice; never the cell with every difC.
- **Q8. Weighting.** Statistical weights only at first; a user factor per
  bank later, reported; no automatic balancing.

**Needed before step 2 (validation)**

- **Q23. Public case.** Mn₃O₄ on POWGEN first; a releasable NOMAD standard if
  the owner has one.
- **Q24. Agreement with GSAS-II.** Shared parameters within 2 combined esds;
  per-bank wR side by side.
- **Q5. Absorption.** None in steps 1 to 9, stated in the report; then one
  shared coefficient. The owner to say whether the reduced data are already
  corrected, and whether the correction is wanted before first real use.

**Needed before step 4 (the project file)**

- **Q12. Format versions.** This work and THY-88's conversion get separate
  versions.

**Needed before step 5 (the page)**

- **Q14. Loading.** A multi-bank file opens on one bank as today; "Use
  several banks" adds the rest.
- **Q13. Plot.** A tab per bank and an "All" view stacked on d.
- **Q9. The number that judges the fit.** The overall GoF, with any worse bank
  named.
- **Q6. Preferred orientation.** Left out of the first delivery.
- **Q7. Excluded regions.** Not part of this work.
- **Q20. The Copilot meanwhile.** Off on a page with several banks until its
  own step.

**Needed before step 6 (the method)**

- **Q15. Start.** All chosen banks from the first refinement.
- **Q16. Profile terms of several banks.** All banks together while the
  shared rows are held.
- **Q17. Cell check and symmetry review.** Per bank, read together; a finding
  counts when every bank that could show it does.

**Needed before step 7 and later**

- **Q22. Bundles.** GSAS-II first, FullProf after with the owner's run.
- **Q18. Peaks for the k-search.** Those every covering bank confirms.
- **Q19. Banks for the magnetic analysis.** The magnetic banks for the
  ranking, all banks for the final moments.
- **Q21. Copilot tools.** An optional bank on existing tools, one new tool to
  choose banks.

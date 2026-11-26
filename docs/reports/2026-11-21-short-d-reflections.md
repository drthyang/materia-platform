# Reflections at short d: the 0.5 Å limit on time-of-flight data (DRAFT)

**Draft for the owner (THY-90). A study: no application code and no test
expectation is changed. Not yet in the index.**

MATERIA's powder calculation draws no reflection below d = 0.5 Å on
time-of-flight data. NOMAD banks record to about 0.25 Å, and a
silicon-standard check had to start its window at 0.52 Å. This report says
where the limit is, why, what a user gets today, whether the model is valid
below 0.5 Å, what a longer list costs, and the options.

All numbers here come from the bundled public Mn₃Ga data, from synthetic
patterns on a made-up bank (invented, round calibration numbers), and (added
2026-11-26) from the owner's published NOMAD GaTa₄Se₈ 300 K data, Phys. Rev.
Research 4, 033123 (2022). That file stays local and is not in the repository;
its numbers may be quoted.

## In short

- The limit is one constant, `TOF_DMIN_FLOOR = 0.5`, in
  `src/core/workflow/powder.ts`. It applies to time-of-flight patterns only.
  Constant-wavelength, d and Q patterns have no floor.
- It was written on the day time of flight arrived (2026-07-07) as a
  performance guard for the engine of that day. The three costs it guarded
  against have since been cut down. It is not a validity limit of any table.
- It is **not tied to the fit window**. Points below 0.5 Å stay in the fit and
  in wR, drawn with background only, and the page says nothing. A refinement
  then puts the missing Bragg intensity into the background and the ADPs.
- **The bundled demo is affected.** Its window starts at 0.414 Å. 160 of the
  398 reflection families inside its window are not drawn. With them the same
  parameters give wR 4.00 % instead of 4.24 %, a refinement gives 3.90 %, and
  B(Mn) moves by 3 esd.
- Below 0.5 Å the neutron nuclear model is valid. What is not valid everywhere
  is the peak function taken from an instrument file (its terms can turn
  negative when extrapolated), the magnetic form factor far below 0.5 Å, and
  the X-ray table below 0.25 Å.
- A longer list is cheap for small cells and expensive for large
  low-symmetry cells. It should follow the fit window, not the whole pattern.
- Recommended: option (b) below. The list goes to the short-d edge of the fit
  window, stops earlier only where the model is not valid, and the page says
  where it stops; points below that are left out of wR.

## Where the limits are

### The Rietveld page

| What | Where | Kind |
| --- | --- | --- |
| Reflection list, TOF | `src/core/workflow/powder.ts:86` (`TOF_DMIN_FLOOR = 0.5`), applied at `:100` in `tofDRange`: d_min = max(shortest d of the data, 0.5 Å) | a constant |
| Reflection list, TOF pattern with no calibration | `powder.ts:79`: d from 0.5 to 5 Å | a constant (a view-only page) |
| Reflection list, 2θ, d or Q axis | `powder.ts:66–77` (`dRange`): the data's own range | the data range, no floor |
| Everything that uses the list | `reflectionDRange` (`powder.ts:143`), called by the pattern (`:150`, `:201`), the analytic derivative columns (`:381`), the F_obs/F_calc table and R_Bragg (`obsCalc.ts:180`), the magnetic satellites (`magneticPowder.ts:134`, `:163`), the GPU evaluator (`workers/gpuPowderEvaluator.ts:56`) and the multi-phase problem (`multiPhase.ts`, through `createPeakBuilder`) | the same floor |
| Which part of the pattern sets the range | `tofDRange` reads the whole pattern's TOF extent, not the fit window | the data range |
| Fit window | `powderPointWeights` (`powder.ts:434`): zero weight outside the window. Default: the whole pattern (`app/PowderWorkbench.tsx:217`, `:379`) | the user's; not tied to the list |
| wR and GoF on the page | `app/powderPage.ts:770`, `:794`: every point in the window that is not excluded; a TOF point is skipped only where the calculated value is ≤ 0 (`:777`, `:801`). Below the floor the calculated value is the background, which is positive, so the points count | a side effect |
| Tick rows | `app/PowderWorkbench.tsx:473`: from 0.4 Å, on every axis type. `:903` the same on the magnetic page. `app/powderPage.ts:1000`: the reflections beside a residual peak, from 0.4 Å | a constant, and not the model's 0.5 |
| Wrong wavelength or difC check | `core/diagnostics/cellReading.ts:29`: reflections from 0.4 to 50 Å | a constant |
| Prefit (Le Bail) and the cell gate | `core/workflow/leBail.ts:185–206`, its own `dRange`: TOF goes to 0.95 × the data's shortest d (floor 0.001 Å). `cellSymmetryCheck.ts:205`: the gate reads d ≥ 0.7 Å by default and trims the pattern first | no floor in the Prefit; a default in the gate |
| Diagnostics that list reflections | `diagnostics/powderResidual.ts:113`, `diagnostics/fitRangeReading.ts:42`, `mcp/tools.ts:672`: the data's whole extent | the data range, no floor |
| Reflection generator | `core/diffraction/reflections.ts:91`, `:93`, `:34`: 6×10⁷ index triples, 300 000 families, index ≤ 2047. Above any of them an error; the list is never cut short | hard limits |
| Peak support | `core/diffraction/profile.ts:281`: ±20 widths, faded to zero. For TOF the width is 2.355σ + 1/α + 1/β (`powder.ts:136`) | a constant |
| k-search | `core/magnetic/kSearch.ts:100`: hkl half-range min(24, ⌈edge/d_min⌉ + 1), d_min = 0.95 × the smallest peak d given; `maxQ` off by default (`:97`). `satellitePositions` (`:423`): half-range at most 16 | hkl caps |
| Magnetic satellites | `core/magnetic/satellites.ts:167`, `:219–222`: the window `reflectionDRange` gives, so the 0.5 Å floor on TOF; the parent window is widened by \|k\| | the same floor |

So the audit note is right for constant wavelength: `dRange` builds the list
from the data's range. A time-of-flight pattern takes the other branch,
`tofDRange`, and that one applies `max(…, 0.5)`.

### PDF and single crystal

- **PDF.** No reflection list. The model is a real-space sum with
  Q-independent weights (neutron b; X-ray Z = f(0),
  `core/totalscattering/weights.ts`). Its limits are the data's Q_max
  (termination) and the r range. The magnetic PDF samples ⟨j0⟩ to
  Q = 25 Å⁻¹ (`core/magnetic/mpdf.ts:320`, a constant).
- **Single crystal.** The reflections are the data's own; nothing is
  generated for the fit. A resolution range is the user's
  (`singleCrystalRefinement.ts:359`, as SHELXL's SHEL). Form factors are
  evaluated at each reflection's sinθ/λ with no range check.
- **MCP.** `reflection_list` defaults to d ≥ 0.8 Å (`mcp/tools.ts:594`, an
  argument). The pattern tools use the same `reflectionDRange` as the page.

## Why 0.5 Å is there

Commit `0007c32` (2026-07-07, "Add time-of-flight profile refinement")
introduced the constant with this comment:

> Smallest d-spacing (Å) modelled for a TOF pattern. The data extends to very
> high Q (tiny d); enumerating every reflection there is pointless (the peaks
> overlap into the background) and costly, so the modelled range is floored.

The same commit made the Mn₃Ga POWGEN pattern the start-up example. That
pattern reaches 0.150 Å: 6 271 Mn₃Ga families against 204 above 0.5 Å. On
that day the generator scanned a cube of indices sized by the longest cell
edge, the pattern synthesis was points × peaks, and every evaluation
recomputed the structure factors. Since then:

- structure factors are cached while the geometry does not move (`257a671`,
  2026-07-12);
- a peak is summed only over its own support (`182fad7`, 2026-07-12);
- the generator is exact and never cuts a list short (`5bb2a9c`, 2026-10-02).

So it is a performance guard, not a validity limit and not an accident. Two
things about it were never checked:

1. **"The peaks overlap into the background."** With the bundled POWGEN
   instrument file's own terms, Mn₃Ga's lines at 0.5 Å are 2.1 widths apart:
   resolved. They merge near 0.4 Å (0.8 widths apart) and are a continuum at
   0.35 Å (0.3). Even merged, they are intensity above the background that
   has to be drawn (next section).
2. **The fit window.** The floor was never connected to it, and the tick
   rows written the same evening took 0.4 Å (`bd53fa2`).

The floor is in no user document. `docs/LIMITATIONS.md` says "Reflection
lists are complete: every (hkl) with d ≥ d_min".

## What a user gets today

Nothing on the page mentions the limit. Checked in the code and with the
page's own functions (`powderPageCurves`, `weightedR`, the Validation view),
headless; no browser run was made.

- **Drawn:** below 0.5 Å the calculated curve is the background alone. The
  tick rows continue to 0.4 Å, so between 0.4 and 0.5 Å there are ticks with
  no calculated peak under them. The reflection table has no row below 0.5 Å.
- **Counted:** every point inside the fit window counts in wR and GoF, and a
  fresh page's window is the whole pattern.
- **Said:** nothing. The Validation view shows the misfit as χ² in the
  shortest-d shells, and its hint for that reads "points to the ADPs or an
  absorption/roughness correction".

### Synthetic silicon on a made-up bank

Silicon (Fd-3m, a = 5.431 Å, B = 0.5 Å²) on an invented backscattering bank
(difC 9000, Δt/t 0.0009, d from 0.25 to 3.3 Å, 2869 points), flat background
300, strongest point 20 000 counts, counting noise. 771 points (27 %) and 250
of the 297 reflection families lie below 0.5 Å. Scale, four background
terms, a and B refined from the true values.

| Model | Window | wR | GoF | B (Å²), truth 0.500 | Background c₀, truth 300 |
| --- | --- | --- | --- | --- | --- |
| today (floor 0.5 Å) | whole pattern | 7.30 % | 1.52 | 0.540(9): 4.5 esd high | 304.9(7): 6.7 esd high |
| today (floor 0.5 Å) | from 0.52 Å | 4.55 % | 0.99 | 0.509(6) | 300.3(6) |
| floor 0.4 Å | whole pattern | 5.44 % | 1.13 | 0.530(6): 5.3 esd high | 302.1(5) |
| every reflection | whole pattern | 4.77 % | 0.99 | 0.506(5) | 300.0(5) |

- As loaded today, 66 % of χ² comes from the points below 0.5 Å, and the
  Validation view's shell 0.42–0.54 Å reads χ² per point 9.8.
- A lower fixed floor does not help: at 0.4 Å the bias is as large. What
  matters is that the list reaches the end of the window.
- Cutting the window at 0.52 Å (what the silicon check had to do) is
  unbiased. It costs precision: the esd of B is 0.0061 against 0.0046 with
  the whole pattern.
- The true Bragg counts by band: 0.4–0.5 Å carries 3.8 % of them (19 % of
  the background level on average), 0.3–0.4 Å 2.0 %, 0.25–0.3 Å 0.4 %.
- The Copilot's `check_fit_range`, run on today's refined page, proposes a
  window from 0.326 Å ("the reflections there have faded"). It does not know
  the floor: its window still holds 0.33–0.5 Å with nothing drawn there.

### The bundled Mn₃Ga + MnO demo

POWGEN, 600 K, 4613 points, d from 0.150 to 5.989 Å. The demo's fit window
is d 0.414–5.033 Å (3125 points). Inside it lie 345 Mn₃Ga and 53 MnO
families; the model draws 204 and 34.

| Model | Window | wR, demo values | wR refined (8 rows) | GoF | B(Mn), B(Ga) refined with x(Mn) (Å²) |
| --- | --- | --- | --- | --- | --- |
| today (floor 0.5 Å) | 0.414 Å | 4.2435 % | 4.2435 % | 3.23 | 1.093(30), 0.958(17) |
| today (floor 0.5 Å) | cut at 0.5 Å (2889 points) | 4.4008 % | 4.3145 % | 3.05 | 0.999(26), 0.926(15) |
| list to the window's edge | 0.414 Å | 3.9976 % | 3.9005 % | 2.97 | 1.014(25), 0.929(14) |

The two consistent treatments (cut the window, or draw the reflections)
agree on the B values. Today's values differ from them by about 3 esd for Mn
and 2 esd for Ga. The Mn₃Ga scale moves from 1.3795(56) to 1.3859(51); the
MnO fraction does not change at the digits shown.

## Is the model valid below 0.5 Å?

d = 0.5 Å is sinθ/λ = 1.0 Å⁻¹ (Q = 12.6 Å⁻¹); 0.25 Å is 2.0 Å⁻¹.

| Factor | Valid to | What the code does beyond | Source |
| --- | --- | --- | --- |
| Neutron scattering length | no limit: a constant | nothing to do | `core/scattering/neutron.ts`; Sears (1992) |
| Debye–Waller factor | no limit | exp(−B s²), B ≥ 0 by its bounds | `core/diffraction/structureFactor.ts:82` |
| TOF Lorentz factor d⁴ | no limit | — | `core/diffraction/intensity.ts:153` |
| March–Dollase, multiplicity | no limit | — | |
| TOF absorption, extinction | not modelled at any d (`LIMITATIONS.md`, "Not yet") | — | |
| X-ray form factor | sinθ/λ < 2.0 Å⁻¹ (d > 0.25 Å) | evaluates the four Gaussians anyway; f tends to the constant c | the table's own file (DABAX `f0_InterTables.dat`, pinned by `scripts/gen_xray_ff.py`): "only valid in the interval 0 ≤ sin(θ)/λ < 2.0 Å⁻¹" |
| Magnetic ⟨j0⟩ | stated range not found (below) | evaluates the three Gaussians anyway; three rows grow | `core/scattering/magnetic.ts`; ITC Vol. C §4.4.5 |
| TOF peak function | the d range the instrument file was fitted on | a non-positive β or σ² is set to 10⁻⁶ (`powder.ts:121–122`) | measured below |

**X-ray, checked.** The four-Gaussian table against Waasmaier & Kirfel
(1995; five Gaussians, stated valid from 0 to 6.0 Å⁻¹ in the DABAX
`f0_WaasKirf.dat` header) for O, Si, Mn, Ga, Se and Ta: within 0.3 % up to
1.5 Å⁻¹, within 0.9 % at 2.0 Å⁻¹, 3–11 % off at 2.5 Å⁻¹, 8–31 % at
3.0 Å⁻¹, up to a factor 2 at 4.0 Å⁻¹ (always too large, except Mn). The
constant-wavelength path has no floor, so X-ray data beyond 2.0 Å⁻¹ (a
short-wavelength I(Q) pattern beyond Q = 25 Å⁻¹) are computed with an
extrapolated table and nothing is said. GSAS-II uses the same four Gaussians
without a check (`GSASIIElem.ScatFac`).

**Magnetic, checked numerically; the range not confirmed.** The ITC text
that states the fit range of the ⟨j0⟩ approximation could not be reached
(IUCr pages refused, the ILL pages are gone). What the table does:

- At 1.0 Å⁻¹ (0.5 Å) \|⟨j0⟩\| ≤ 0.025 for all 97 ions, so f² ≤ 6×10⁻⁴ of its
  forward value. A 0.5 Å floor loses practically no magnetic intensity.
- The form does not decay to zero: it tends to its constant D.
- Three rows (Cr²⁺, Mn²⁺, Mn³⁺) have a negative exponent coefficient and
  grow. Mn²⁺: 0.027 at 2.0 Å⁻¹, 1.0 at 3.0 Å⁻¹, 73 at 4.0 Å⁻¹ (d = 0.125 Å).
  A list taken to 0.125 Å with a Mn²⁺ model would draw magnetic intensity that
  does not exist, held down only by the Debye–Waller factor.
- GSAS-II keeps magnetic reflections above a setting, "Magnetic reflection
  d-min": default 1.0 Å, and the field accepts nothing below 0.7 Å.

**TOF peak function, measured on the bundled POWGEN instrument file**
(`examples/mn3ga-350k/PG3_45598_Bank1.instprm`, GSAS-II's functions of d;
bin Δt/t = 0.0008):

| d (Å) | α (µs⁻¹) | β (µs⁻¹) | σ² (µs²) | Width (µs) | Bins per width | Mn₃Ga line spacing / width |
| --- | --- | --- | --- | --- | --- | --- |
| 1.0 | 0.133 | 0.068 | 167 | 41 | 2.3 | 6.5 |
| 0.5 | 0.267 | 0.156 | 1.70 | 9.4 | 1.0 | 2.1 |
| 0.4 | 0.333 | 0.144 | 4.54 | 10.9 | 1.5 | 0.82 |
| 0.35 | 0.381 | 0.083 | 5.34 | 14.7 | 2.3 | 0.34 |
| 0.32 | 0.416 | −0.005 | 5.31 | not a peak | | |
| 0.25 | 0.533 | −0.67 | 3.09 | not a peak | | |
| 0.20 | 0.666 | −2.5 | −0.79 | not a peak | | |

- This file's β is negative below 0.32 Å and its σ² below 0.21 Å. An
  instrument file is a fit over the d range of its standard; below that range
  its polynomials are an extrapolation.
- The code sets a non-positive β to 10⁻⁶ µs⁻¹: a decay length of 10⁶ µs. Such
  a peak is spread flat over the whole pattern, and its support covers every
  point, so it is also slow. On the bundled 350 K bank (4 611 points) one
  pattern takes 15 ms with the list to 0.33 Å, 69 ms to 0.30 Å, 270 ms to
  0.25 Å and 720 ms to 0.20 Å: the step is at 0.32 Å. GSAS-II's Rietveld
  path does not guard these terms either (`GetReflSigGamTOF`,
  `GetReflAlpBet`); there the user keeps the lower limit above the bad range.
- Bins: with the file's own terms a peak at 0.5 Å is one bin wide. The model
  takes the peak function at the bin centre and does not integrate over the
  bin. That is a limit of accuracy at short d on its own, at any floor.
- The page's default does not use the file's sig-1 (THY-88 item 3), so on a
  fresh page these widths differ. That choice is not part of this study.

## What other programs do

**GSAS-II 5.11.0** (`GSASIIstrIO.GetHistogramPhaseData`, read in the source):

- TOF: `dmin = limits[0]/difC`, the lower fit limit over difC. Constant
  wavelength: λ / (2 sin(upper limit / 2)).
- The list is every reflection with d ≥ dmin (`GenHLaue`); a reflection is
  kept when its position lies inside the limits.
- No fixed floor. The user's limits are the control, and the list follows
  them, not the data's extent.
- A magnetic phase: `dmin = max(dmin, MagDmin)`, default 1.0 Å, minimum 0.7 Å.
- A peak's range is 50 widths each side (`getWidthsTOF`).

FullProf and TOPAS were not checked.

## Cost of a longer list

Measured in node, one thread, the serial driver (the app spreads the
derivative columns over its worker pool, so its wall time is lower). The
machine was shared with other runs, so read the ratios before the absolute
times. "Per iteration" is one Levenberg–Marquardt cycle with its Jacobian.
Heap is what stays after a collection.

**Bundled Mn₃Ga + MnO demo** (4613 points, window 0.414 Å, 8 free rows):

| d_min (Å) | Families (Mn₃Ga + MnO) | Pattern (ms) | After a cell change (ms) | Per iteration (ms) |
| --- | --- | --- | --- | --- |
| 0.5 | 204 + 34 | 1.2 | 1.9 | 31 |
| 0.4 | 381 + 58 | 1.5 | 2.8 | 45 |
| 0.3 | 854 + 121 | 2.7 | 5.4 | 84 |
| 0.25 | 1 436 + 190 | 3.9 | 8.3 | 130 |
| 0.150 (the data's end) | 6 271 + 747 | 17 | 42 | 615 |

Below 0.414 Å the result does not change (the window ends there); only the
time does. A whole refinement of the demo took 0.10 s with the list to the
window and 1.2 s with the list to the data's end. The process held
317–323 MB from 0.5 to 0.25 Å (node's own baseline included) and 509 MB
with the list to 0.150 Å.

**Synthetic patterns on the made-up bank** (3639 points, d 0.125–3.3 Å):

| d_min (Å) | Si families | Si per iteration (7 rows) | GaTa₄Se₈ families | GaTa₄Se₈ pattern (ms) | GaTa₄Se₈ after an atom moves (ms) | GaTa₄Se₈ per iteration (16 rows) |
| --- | --- | --- | --- | --- | --- | --- |
| 0.5 | 47 | 18 ms | 282 | 2.6 | 8.3 | 0.31 s |
| 0.4 | 85 | 29 ms | 511 | 4.0 | 14.5 | 0.55 s |
| 0.3 | 180 | 53 ms | 1 139 | 8.2 | 32 | 1.2 s |
| 0.25 | 297 | 87 ms | 1 898 | 12.7 | 54 | 2.0 s |
| 0.2 | 546 | 0.16 s | 3 557 | 21 | 99 | 3.6 s |
| 0.15 | 1 230 | 0.35 s | 8 120 | 43 | 208 | 7.2 s |
| 0.125 | 2 065 | 0.57 s | 13 763 | 61 | 317 | 11.5 s |

Si is Fd-3m, a = 5.431 Å; GaTa₄Se₈ is the bundled CIF (F-43m, a = 10.363 Å,
52 atoms). Heap stayed under 10 MB for both.

**A made-up low-symmetry cell** (P2₁/c, 9 × 11 × 14 Å, β = 105°, 40 atoms,
49 free rows; 2869 points, d 0.25–3.3 Å):

| d_min (Å) | Families | Pattern (ms) | After an atom moves (ms) | Per iteration | Process memory at the end |
| --- | --- | --- | --- | --- | --- |
| 0.5 | 11 160 | 88 | 127 | 12 s | 0.5 GB |
| 0.4 | 21 878 | 160 | 243 | 26 s | 1.0 GB |
| 0.3 | 51 893 | 320 | 503 | 57 s | 1.6 GB |
| 0.25 | 89 624 | 528 | 871 | 88 s | 2.2 GB |

Below about 0.17 Å this cell passes 300 000 families and the generator
refuses the list (confirmed at 0.125 Å). The count follows 1/d³ as expected:
a factor 6 to 8 from 0.5 to 0.25 Å, 44 to 49 from 0.5 to 0.125 Å.

## What would move

Measured by running the tests with the constant changed in the scratch copy.
Neither run is option (b) exactly; they bracket it.

**Floor at 0.4 Å** (the whole suite: 447 files, 3 988 tests, 339 of them
skipped as local-only or opt-in; 5 minutes on 4 workers). 8 tests in 3 files
fail; everything else passes.

| File | Tests | What moves |
| --- | --- | --- |
| `src/app/powderSnapshot.test.ts` | 2 | the demo's pinned agreement at its saved values: wR 0.042435 → 0.039976, GoF "3.23" → "3.05" |
| `src/app/ui/powderValidation.test.ts` | 5 | the Validation view's text on the demo: "GoF 3.23", "Peak tails 70%", "Worst peaks 8 worst: 7% of χ²", "DW 0.56" |
| `src/app/powgenBackground.test.ts` | 1 | on the bundled 350 K bank, whole pattern: "log interpolation with three points fits at least as well as four Chebyshev terms" (8.896 % against 9.000 % when written) turns round, 8.40 % against 8.36 % |

The third row matters beyond its test: the evidence for POWGEN's default
background was taken with a third of the pattern not modelled. It should be
measured again under the option chosen.

**Floor off** (the 64 test files that touch time-of-flight data, each run
alone with a 3-minute limit; a whole-suite run was stopped at its 25-minute
cap with one worker still busy).

- The same two demo files fail (7 tests).
- `src/app/powgenBackground.test.ts` and
  `src/core/diagnostics/backgroundTerms.test.ts` do not finish in 3 minutes.
  Both refine the bundled 350 K bank with its own instrument file over the
  whole pattern, and run into the negative β below 0.32 Å (above).
- `src/mcp/host.test.ts`: one test passes its 5 s limit today and not then.
- The other 59 files pass, the GSAS-II golden on the 350 K magnetic
  structure factors (`mn3ga350KGolden.test.ts`) among them.

**Not moved** at 0.4 Å (the whole suite), nor among the time-of-flight
files with the floor off: the magnetic goldens, the single-crystal and PDF
tests, and the files the Copilot's model reads (`src/agent/__snapshots__`):
no tool text changes.

**Not measured; would move with the demo's number:**

- `src/examples/mn3gaPowgen.ts` (the snapshot's values and the comment that
  states wR 4.24 %, GoF 3.23), `src/app/demos.ts` ("wR 4.2%"), `README.md`
  (twice, once as a screenshot's alt text), `docs/USER_GUIDE.md` and
  `docs/DEMO_SCRIPT.md` (wR 4.24 %, GoF 3.23, MnO 3.33(7) wt %), the demo
  screenshots in `docs/media/`, and the demo video.
- The snapshot was made in the app (a MATERIA 0.5.0 project, 2026-11-03); it
  should be refined and saved there again, not edited by hand.
- The Agent's live evaluations and validation arms that open a
  time-of-flight page (the 350 K bank, `src/agent/evals/pages.ts`): their
  recorded wR values are baselines. A re-baseline is a paid run.

**Saved projects.** A project stores the rows and the last result (wR, esds,
the History summaries), not the curves. A time-of-flight project whose
window reaches below 0.5 Å reopens with the same rows; the curve and the
live wR on the page then differ from the stored result until it is refined
again. `docs/PROJECT_FORMAT.md` promises the same numbers on re-running a
saved project. To keep that across this change the project would record the
rule it was fitted with (an optional field; no schema bump).

**Fit times.** As in the cost tables. Under option (b) nothing changes for a
window that stays above 0.5 Å.

**Documents.** `docs/LIMITATIONS.md` (the "complete lists" sentence, the
Prefit, the gate) and `docs/USER_GUIDE.md`.

## Faults found on the way (described, not fixed)

1. **Points below the floor are fitted with nothing drawn.** The main
   finding. It biases any TOF refinement whose window reaches below 0.5 Å,
   the bundled demo included.
2. **The Copilot's `check_fit_range` does not know the floor** and can
   propose a window that starts below it.
3. **Tick rows start at 0.4 Å, the model at 0.5 Å**: ticks with no peak
   between them on TOF data, and no ticks below 0.4 Å on constant-wavelength
   data whose model does go lower.
4. **The Prefit (Le Bail) has no floor**: on the demo pattern it lists 7 286
   Mn₃Ga families (to 0.143 Å) where the Rietveld model lists 204. A large
   cell on data that reach well below 0.2 Å can pass the 300 000-family limit
   in the Prefit while the Rietveld model beside it would not.
5. **A non-positive β becomes a peak spread over the whole pattern**
   (`powder.ts:121`). It can happen above 0.5 Å too, with an instrument file
   whose β turns negative there or a refined β₁ that drives it negative.
   Nothing is said.
6. **The list covers the whole pattern when the window is narrower**: time
   spent on reflections no fitted point sees.
7. **X-ray form factors beyond 2.0 Å⁻¹** are extrapolated without a message
   (constant-wavelength path, single crystal).
8. **`LIMITATIONS.md` says the lists are complete**; on TOF data they stop at
   0.5 Å.

## Measured on published NOMAD data (added 2026-11-26)

The owner's published NOMAD GaTa₄Se₈ data at 300 K (Phys. Rev. Research 4,
033123 (2022); the file is local, not in the repository), with NOMAD's 2023A
five-bank instrument file. The banks were refined on the page as far as the
data allow: scale, four Chebyshev background terms, a, one isotropic U per site
and the free x of Ta, Se1 and Se2, alternating with sample microstrain and
size. The instrument file's profile and calibration were held.

**How much of each bank lies below the limit.** No reflection is calculated
there, so those points are fitted by the background alone:

| Bank | Points with d < 0.5 Å | Observed maxima there | Calculated maxima there | Rw, GoF after refinement |
| --- | --- | --- | --- | --- |
| 2 | 625 of 2999 | 118 | 0 | 4.41 %, 6.43 |
| 3 | 1182 of 2937 | 206 | 0 | 3.65 %, 10.84 |
| 4 | 1473 of 2906 | 228 | 0 | 3.39 %, 7.29 |
| 5 | 1640 of 2999 | 243 | 0 | 17.41 %, 43.84 |

- In bank 4, half the points and 228 observed peaks are outside the model. The
  structure is refined from the upper half of the pattern, and the background
  absorbs real lines.
- Bank 5 cannot be fitted with this model and instrument file: the U's sit on
  their bounds and the positions run away.
- The Validation view's "Lines no phase explains" (`diagnose_fit`'s
  excess detector) reports the sample's own uncalculated lines below 0.5 Å as
  extra peaks: bank 4, 8 to 10 of them at d 0.126–0.419 Å, each on 46–156
  GaTa₄Se₈ reflections within ±3 FWHM, the nearest 0.1–0.2 FWHM away. Bank 5
  has about 30. They survive refinement only because no refinement can reach
  that range. A detector or check that reads this range reads the floor, not
  the sample.
- Evidence (figures per bank, the detectors' marks, the d < 0.5 Å region
  shaded) is kept locally with the Can lines review (#194), which waits for
  this decision.

## Options

Each: accuracy first, then speed.

**(a) Reflections to the data's shortest d, always.**
- Accuracy: removes the bias where the model is valid. Below the instrument
  file's range the peak terms are extrapolated (β < 0 below 0.32 Å on the
  bundled POWGEN file), and far below 0.5 Å the Mn²⁺ form factor grows
  without bound. On data that reach 0.15 Å (the bundled POWGEN pattern) or
  less the result can be worse than today's.
- Speed: paid on the whole pattern whatever the window. The demo: 12 times
  slower for the same result. A bank to 0.125 Å: 44 to 49 times the
  reflections of today; GaTa₄Se₈ 11.5 s per iteration; a large low-symmetry
  cell is refused above 300 000 families.
- Not recommended as it stands.

**(b) Reflections to the short-d edge of the fit window, stopped earlier
only by a validity limit, and said on the page.** The list ends at the
largest of: the window's edge (less a margin of one peak support, so the
tails of the lines just outside are drawn); the d below which the current
peak terms give a non-positive β or σ²; 0.25 Å for X-rays; for magnetic
satellites the present 0.5 Å. Where the window still reaches below the
list's end, those points are left out of the fit and of wR, and one line on
the page says so with the reason. This is GSAS-II's rule plus the guards
GSAS-II leaves to the user.
- Accuracy: the list is complete over every fitted point, and no table or
  peak term is used outside its range. On the synthetic silicon this is the
  4.77 % row (B 0.506(5)); on the demo 3.90 %.
- Speed: follows the window. The demo's refinement 0.10 s against 0.08 s
  today. The user (or `check_fit_range`) trims the window when a pattern
  reaches far below its last visible lines.
- The fit window becomes the user's setting for the shortest d: option (d)
  without a new control.

**(c) Keep 0.5 Å, and say so.** Two forms:
- *Warn and leave the points below 0.5 Å out of the fit and wR.* Accuracy:
  unbiased (the "from 0.52 Å" row), but the data below 0.5 Å are not used:
  27 % of the synthetic bank's points, and esds about a third larger on B.
  Speed: unchanged. The demo still moves (its window is in effect cut at
  0.5 Å: 4.31 %).
- *Warn only.* Accuracy: the bias stays (4.5 esd on B in the silicon case,
  3 esd on the demo's B(Mn)); the user is told. Speed and every number
  unchanged. Only honest as a stop-gap.

**(d) A user setting, "shortest d modelled".** A number on the page, saved
in the project, with (b)'s or (c)'s rule as its default.
- Accuracy: as its default; the user can lower it into a range where the
  model is not valid, so the validity guards of (b) are still needed.
- Speed: the user's choice.
- A second control beside the fit window that says nearly the same thing.
  Worth it only if the owner wants the list and the window apart (for
  example reflections drawn below the window for display).

## Recommendation

**(b).** It removes the wrong numbers, uses the data the instrument records,
keeps the model inside what its tables and its peak function support, and
costs time only where the user asks for short d. It is one rule in one
function (`reflectionDRange` gets the window), the points' weights, and one
line of page text; the Prefit and the tick rows should then take the same
range.

If a smaller first step is wanted: (c) with the points left out. It is a few
lines, it stops the bias at once, and it moves only patterns whose window
reaches below 0.5 Å. The demo's number moves under either.

Separate from the choice, and wanted under any option: a guard and a message
for a non-positive β or σ² (fault 5).

## Questions for the owner

1. Is the fit window the right control for the shortest d (as GSAS-II's
   limits), or do you want a separate setting (option d)?
2. Points below what the model draws: leave them out of wR (recommended) or
   warn only?
3. A pattern that reaches far below its last visible lines (0.15 Å in the
   bundled POWGEN pattern, less on other banks): should a fresh page keep
   the whole pattern as its window (complete, slower: the GaTa₄Se₈ column
   above) or open with the window trimmed at a default d, and which?
4. Magnetic satellites: keep them at d ≥ 0.5 Å (nothing magnetic moves), or
   take GSAS-II's rule (a setting, default 1.0 Å)? And could you check ITC
   Vol. C §4.4.5 for the range the ⟨j0⟩ approximations were fitted over? I
   could not reach the text.
5. The demo's wR changes under every option except "warn only": 3.90 % with
   its reflections drawn, 4.31 % with its window cut at 0.5 Å. Which should
   it show? The number is in the README, the user guide, the demo script,
   the landing card, a screenshot and the demo video.
6. X-rays beyond 2.0 Å⁻¹: stop the list at 0.25 Å with a message
   (recommended), or change the table to Waasmaier–Kirfel (valid to
   6.0 Å⁻¹; every X-ray golden would move, by up to a few tenths of a
   percent in f for the six elements compared)?
7. Peaks one bin wide at short d are evaluated at the bin centre. Do you
   want bin-integrated peaks studied as its own item?

## How this was measured

- A scratch change in a clone made the constant switchable; it is not
  committed. Scratch scripts (not committed) ran the page's own functions in
  node: the bundled demo; synthetic silicon, GaTa₄Se₈ and a made-up
  monoclinic cell on a made-up bank; the peak terms of the bundled POWGEN
  instrument file; the X-ray table against the public Waasmaier–Kirfel
  table (ESRF DABAX `f0_WaasKirf.dat`); the ⟨j0⟩ table.
- GSAS-II 5.11.0 was read in its source, not run.
- Each timing case had a time limit; the longest (the monoclinic cell) took
  12 minutes. One automated run passed its cap: the whole suite with the
  floor off, stopped at 25 minutes and diagnosed (the negative β above).
- Not done: a browser run; FullProf and TOPAS; the ITC text for ⟨j0⟩; a
  constant-wavelength X-ray pattern beyond 2.0 Å⁻¹ refined end to end.
- No application code, test or expectation is changed by this report. The
  five test files named above pass at the branch head, run alone with the
  constant as it is.

# Reflections at short d follow the fit window (THY-90)

The owner's decisions of 2026-11-26 on the study of the 0.5 Å limit
(branch `study/short-d-reflections`, `docs/reports/2026-11-21-short-d-reflections.md`)
are built here. Every decision is the owner's; this report says how each was
built, what moved and what is left.

## What changed, and why

The study found that a time-of-flight pattern drew no reflection below
d = 0.5 Å, while every point of the fit window below it stayed in the fit and
in wR, drawn with the background alone. A refinement put the missing Bragg
intensity into the background and the ADPs (the bundled demo's B(Mn) by about
3 esd), and the page said nothing.

| Decision | Built as |
| --- | --- |
| Q1: the fit window sets the shortest d | `core/workflow/powder.ts` `reflectionRange`: on TOF the list reaches the window's short-d edge less one peak support (the d whose reflection's ±20-width support just reaches the edge, by fixed point), stopped earlier only where the peak terms give no peak (`tofWidthInvalidAt`, `profileValidFrom`). `TOF_DMIN_FLOOR` no longer applies to nuclear reflections. Every builder passes the window: `createPeakBuilder`, `buildPowderProblem`, `buildMultiPhasePowderProblem`, the magnetic problem's nuclear part, the GPU evaluator, the F_obs/F_calc table, the page's curves. |
| Q2: points below the drawn range are out of the fit and wR | `modelledFitRange` narrows the window the points are weighted in (the narrowest over the phases, from the starting values); the page scores wR, GoF and the point count over the same window (`app/shortD.ts` `scoredWindow`, used by `weightedR`, `curvesGoodnessOfFit`, `observationsIn` and the Validation view's mask). One line under the plot toolbar says how many points and why (`shortDNote`). |
| Q3: a fresh page fits the whole pattern, and suggests a trim | `core/workflow/lineResolution.ts` `resolvedDown`: near each d, the lines' effective number (ΣI)²/ΣI² at their calculated intensities, their mean spacing over the profile's own FWHM widened by the data's bin; the lines are resolved down to the first d where that is under 1. When the window's short-d edge is below 0.9 of that d, the page's line names it, and `check_fit_range` adds an `unresolved-lines` finding at the short-d end, so its proposed window cuts there (`core/diagnostics/dataRange.ts`). |
| Q4: magnetic satellites stay at d ≥ 0.5 Å | `magneticDRange`: the satellites' range as before THY-90 (the data's range, floored at 0.5 Å on TOF), in the magnetic problem, its curves and the F_obs/F_calc table. The refinement plot's magnetic tick row follows the satellites (0.4 → 0.5 Å on TOF); the magnetic page's own rows and the residual peaks' nuclear neighbours keep 0.4 Å. |
| Q5: demo materials | The snapshot re-made (below); README, user guide, demo script, landing card; the README screenshot retaken with the © line. No video in this repository shows the Mn₃Ga number (the one linked, `agent-demo.mp4`, is the PbSO₄ run), so no note was added here. |
| Q6: X-rays stop at 0.25 Å | `reflectionRange`: an X-ray list stops at `XRAY_FORM_FACTOR_DMIN` = 0.25 Å; the points within one peak support of it, and beyond, are left out, and the page says so. |
| Non-positive β or σ² | At the short-d end the list stops there (above). A step that makes the page's own TOF widths invalid inside the data is now rejected, as one on an instrument file's already was (`createTofWidthGuard`). |
| Prefit and tick rows | The Prefit's Le Bail list starts at the scored window's short-d edge on TOF (`leBail.ts` `dRange`, `fitRange` option) and fits the same points; each tick row is drawn over its phase's list (`tickDRanges`). |

Where the list stops for a validity limit, the points left out start at the
limit itself for the TOF peak terms (below it no peak is defined that could
reach above), and one peak support above 0.25 Å for X-rays (the lines below
exist; only their form factor is not known).

## Evidence

**Synthetic silicon on an invented bank** (the study's case: difC 9000,
Δt/t 0.0009, d 0.25–3.3 Å, 2869 points of which 771 below 0.5 Å, flat
background 300, counting noise; scale, four background terms, a and B refined
from the truth B = 0.5 Å², c₀ = 300):

| Window | Before: wR, GoF, B, c₀ | After |
| --- | --- | --- |
| whole pattern | 7.45 %, 1.55, 0.536(9), 303.6(7) | 4.83 %, 1.00, 0.506(5), 298.9(5) |
| from 0.52 Å | 4.65 %, 1.01, 0.508(6), 298.9(6) | the same to 12 digits |

**The bundled Mn₃Ga + MnO demo** (window 0.414–5.03 Å, 3125 points): see
"What changes for users".

**Published NOMAD GaTa₄Se₈ 300 K, banks 2–5** (Phys. Rev. Research 4, 033123
(2022); local data, not in the repository), with NOMAD's 2023A instrument
file, refined as in the Can lines gate (#194): scale, four Chebyshev terms, a,
then four cycles alternating the sample's microstrain and size with an
isotropic U per site and the free x of Ta, Se1 and Se2. Whole pattern, as a
fresh page opens.

| Bank | Before: Rw, GoF, points, families | After | Where the list stops |
| --- | --- | --- | --- |
| 2 | 4.41 %, 6.43, 2999, 285 | 3.77 %, 5.51, 2999, 1887 | 0.251 Å, the data's end |
| 3 | 3.65 %, 10.84, 2937, 282 | 3.03 %, 10.01, 2301, 1534 | 0.269 Å, σ² ≤ 0 below |
| 4 | 3.39 %, 7.29, 2906, 274 | 2.67 %, 6.26, 2361, 3123 | 0.209 Å, σ² ≤ 0 below |
| 5 | 17.41 %, 43.84, 2999, 268 | 17.41 %, 50.83, 2107, 1579 | 0.266 Å, β ≤ 0 below |

On bank 4, the best resolved, the U's fall from 0.0064–0.0081 Å² to
0.0048–0.0063 Å². On banks 2 and 3 several U's go to their bound (0) once the
merged short-d lines are fitted (bank 2: U(Ta), U(Se1), U(Se2); bank 3: U(Ga),
U(Se1)); bank 2's page suggests trimming its window at d 1.08 Å, where its
lines stop being resolved. Bank 5 cannot be fitted with this model and file,
before or after.

## What changes for users

- **The bundled demo: wR 4.24 % → 3.88 %, GoF 3.23 → 2.96.** Re-made through
  the page's own refine, with the steps its snapshot was made with (the B_iso
  of both phases and the Mn x, then the Mn₃Ga mustrain, then the eight rows,
  three cycles): B(Mn) 1.096 → 1.008(25) Å², B(Ga) 0.961 → 0.922(14) Å²,
  MnO 3.33(7) → 3.31(6) wt %. The eight rows alone from the old values give
  3.90 %, the study's number. Its Validation view: peak tails 70 → 76 % of χ²,
  the excesses at d 0.467 and 0.468 Å (the floor's own) gone, 7 → 1.
- **A line under the plot toolbar** on time-of-flight pages, and on X-ray
  pages that reach below 0.25 Å. On the demo: "Reflections down to d 0.399 Å,
  one peak support below the fit window's edge (0.414 Å)."
- **Speed follows the window.** A whole NOMAD bank (bank 4 above, the nine
  refinements of the gate, run alone): 32.6 s → 169.3 s, its list 274 → 3123
  families. A fresh page fits the whole pattern: the
  bundled POWGEN pattern to 0.150 Å takes about 15 ms per pattern against
  2 ms in the demo's window. The MCP `refine_powder` with no window refines
  that pattern to its end too (the MCP export test took 9.7 s, against under
  a second).
- **`get_state`** (`data.reflectionsTo`) and **`check_fit_range`**
  (`reflectionsTo`, and an `unresolved-lines` finding) carry the page's line.
- **Saved projects** reopen with their rows; a TOF project whose window
  reaches below 0.5 Å shows a different curve and wR until refined again.

## What it means for the validation

No agent snapshot (`src/agent/__snapshots__`) moved. The scripted eval
replays all pass (172), and their full-precision dump against main's own run
(66a82ec) differs in one scenario only, `file-profile-held` (a synthetic TOF
bank): its `get_state` carries the new line, "Reflections down to d 0.620 Å,
one peak support below the fit window's edge (0.620 Å)."; no number moves.
The live evaluations that open the 350 K POWGEN bank on its own instrument
file would move: its list now reaches 0.321 Å and 952 points below it leave
the fit. Their recorded wR are baselines a paid re-run would replace.

## Not done

- POWGEN's default background: on the 350 K bank, with the reflections its
  file's profile defines (to 0.321 Å), four Chebyshev terms now fit better than
  three log-interpolation points (5.771 % against 5.849 %); before, 8.896 %
  against 9.000 % the other way. The default is unchanged and is the owner's
  call.
- Just above a d where β turns zero the decay length is long, so the last few
  lines of the list carry long tails as the file gives them.
- A constant-wavelength list is the data's range: the lines just beyond the
  last point, whose tails reach into it, are not drawn (as before).
- `check_fit_range` on MCP, single-crystal X-ray form factors beyond
  2.0 Å⁻¹, Waasmaier–Kirfel (THY-92), bin-integrated peaks (THY-93).

## Checks

At the branch head (rebased on main 66a82ec): `npm run build` and `npm run
lint` clean; `npx vitest run`: 433 files and 3912 tests passed, 401 skipped,
one failure (a test that pins the demo's rows), re-baselined in its own commit
and passing alone. The MCP host and POWGEN background tests take longer than
before (the whole POWGEN pattern is refined to its end).

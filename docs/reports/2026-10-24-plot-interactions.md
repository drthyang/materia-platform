# The plots: a cursor readout, zoom about the cursor, pan, keys and touch

Pull request [#103](https://github.com/drthyang/materia-platform/pull/103),
branch `claude/plot-interactions` (`0016f42`, browser check `ca76861`), from
`claude/materia-backlog` at `23c1d88`, 2026-10-24. Backlog item M8: the
diffraction and PDF plots should zoom, pan and read out like a map.

## What was wrong

Every pattern and curve plot is hand-written React SVG. One component,
`WorkbenchPlot`, draws the powder pattern (CW and TOF, any display unit), the
G(r) fit with its partials, the mPDF and the magnetic step's residual peaks.
The PDF page's S(Q)/F(Q) view, `ReciprocalPanel`, had its own copy of the
same mechanics. Before any change, each input was checked by reading the code
and in headless Chromium on the bundled demos (the Mn₃Ga + MnO POWGEN TOF
pattern, 4 613 points; the GaTa₄Se₈ G(r)) and on a 100 000-point synthetic
TOF pattern:

| Input | Before |
| --- | --- |
| Hover | Nothing: no cursor line and no x or y readout. A Bragg tick had a native `<title>` after the browser's delay |
| Wheel | Ignored. Ctrl/⌘ + wheel and a trackpad pinch fell through to the browser's page zoom |
| Drag | A full-height rubber band zoomed x, y autoscaled to the obs in view. No pan anywhere |
| Double-click | Reset to the whole range. USER_GUIDE said "double-click to zoom out" |
| Keyboard | None: the SVG was not focusable and had no role or label |
| Buttons | "Zoom out" (×2) and "Reset zoom", shown only while zoomed |
| Zoom vs refinement | The reset was keyed on the x domain, so in d or Q a refined zero or difC moved the domain and reset the zoom. A new dataset with the same range did not reset it |
| Touch | `touch-action: none`: a vertical swipe over the 330×320 plot did not scroll the phone page. No pinch |
| Speed | Every obs point an SVG `<circle>` re-rendered on each view change. Demo: 4 134 nodes, a zoom 133–228 ms with 76–130 ms long tasks. 100 k points: 50 198 nodes, a zoom 1.8–3.3 s, long tasks up to 9.4 s |

The obs, calc, diff and tick bands are one SVG on one x scale, so they were
already aligned. Multi-bank TOF has no linked panels to align: a page holds
one bank.

## What changed

| Change | Where |
| --- | --- |
| The pure view maths: clamp, zoom about an anchor, clamped pan with the span kept, the wheel's zoom factor (capped at about 1.35× an event), a minimum span of 4 data steps, the nearest point for ascending or descending x, the readout's decimals (within ½ step), the ticks near x, decimation by pixel column | `visualization/plotView.ts` |
| One interaction hook for every curve plot: the x window and an optional y lock, rAF-coalesced; non-passive wheel (and Safari `gesture*`); pointer pan, Shift-box and two-finger pinch, with a 3 px click slop; keys; the "Use Ctrl + scroll to zoom" hint; whether a plain wheel should scroll the page | `app/ui/usePlotInteraction.ts` |
| The controls, always shown: − + y auto/fixed Reset, and the hint | `app/ui/PlotControls.tsx` |
| `WorkbenchPlot`: the series and the tick rows on a canvas under the SVG (same marks, colours and order), decimated per pixel column when dense; the SVG keeps axes, labels, handles, the spotlight, the Agent's ▽ marks, the cursor line and the ticks under the cursor. A readout beside the cursor line and a throttled `aria-live` copy. Focusable, labelled with the keys, a focus ring; `touch-action: pan-y`. The view resets on `viewKey` only | `app/ui/WorkbenchPlot.tsx`, `workbench.css` |
| `ReciprocalPanel` on the same hook, controls and readout (Q, S or F ± σ); its rubber band removed | `app/ui/ReciprocalPanel.tsx` |
| `viewKey`: the pattern and the unit on the powder page, the pattern on the PDF page | `PowderWorkbench.tsx`, `PdfWorkbench.tsx` |
| The browser check, its 100 000-point pattern and S(Q) generated from a fixed seed | `scripts/plot-interactions-check.mjs` |
| USER_GUIDE "Zoom, pan and the cursor readout", ARCHITECTURE, CHANGELOG | `docs/` |

The decisions, each in USER_GUIDE:

- **Double-click resets** to the whole range with y automatic, as the code
  already did and the S(Q) view does. Box zoom, pinch and + zoom in.
- **y autoscales** to the obs (± σ) in view, as before. A Shift-box at least
  20 px tall also fixes y to the box, and the **y auto / y fixed** button
  freezes or releases it. No y-wheel modifier.
- **Drag pans; Shift + drag box-zooms** (the old drag-to-zoom, behind Shift).
- A plain wheel zooms only where nothing around the plot scrolls (at
  1440×900 and above the workbench does not); otherwise it scrolls and shows
  the hint. A horizontal wheel or Shift + wheel pans.
- Keys: + and − zoom about the cursor (else the centre), ← and → pan 10 %,
  Shift + ← and → step one point, 0 resets, Esc hides the cursor.
- Touch: one finger scrolls vertically and pans horizontally, two pinch, a
  tap shows the readout.
- The zoom resets on a new dataset or a unit change, never on a refinement.

`src/core/**` is unchanged: the report figures, the exports, the Agent and
MCP tools and the project format (the view is not saved, as before).

## Evidence

The plan's 14 behaviours and their pass criteria were written before the
code, not to be weakened after the run. The final run in headless Chromium
on the pushed commit: **46/46 pass**, and `plotView.test.ts` 13/13.
Scenarios: the powder demo at 1440×900 (nothing scrolls) and at 1280×720
(the main pane scrolls), the PDF demo, an S(Q), the magnetic step, the 100 k
synthetic, and a phone with touch.

- **Zoom about the cursor.** The data x under the cursor moves 0 px over 5
  zooms in and 5 out at 30, 50 and 70 % of the width, by Ctrl + wheel, plain
  wheel, the pinch encoding, on the magnetic step, the scrolling layout, G(r)
  and S(Q).
- **Readout.** x is the nearest data point and is printed within ½ step;
  obs − calc = diff; on the 100 k pattern the readout's x and obs equal the
  file's row. Hovering the d 4.694 Å tick lists Mn3Ga (1 0 0), four more
  (hkl, d) agree with the hexagonal metric within 1 %, and a cursor far from
  every tick lists none.
- **Linked bands.** On a quarter-pixel canvas the calc and diff lines start
  0.5 px apart, both on the fit handle, after a zoom and after a pan.
- **Pan, reset, keys.** A drag past either end stays in range with the span
  kept. The button, a double-click and 0 each restore the whole range. A flat
  Shift-box zooms x to the box (±1 px) with y automatic, a tall one fixes y.
  Tab reaches the plot with a 2 px focus ring; the live region reads the
  cursor's point.
- **Clicks kept.** A tick click spotlights it and a second clears it; the fit
  handle drags without panning; the magnetic step's "Add peak from plot"
  takes the click.
- **Speed**, 40-step zoom and pan, input to the second frame after it (about
  33 ms is the floor):

  | Pattern | Zoom before | After: zoom p95 (max) | After: pan p95 | Long tasks after |
  | --- | --- | --- | --- | --- |
  | Demo, 4 613 points | 133–228 ms, long tasks 76–130 ms | 33.5 ms (37.6) | 33.6 ms | none |
  | Synthetic, 100 000 points | 1.8–3.3 s, long tasks to 9.4 s | 33.9 ms (46.2) | 33.5 ms | none |

- **Touch**, 390×844: a vertical swipe over the plot scrolls the page, a
  pinch zooms 3.7×, a horizontal drag pans, a tap shows the readout.
- **Same picture.** At full view the data area matches the old SVG to
  anti-aliasing: mean |Δ| 0.84/255 on the TOF demo and 1.4/255 on G(r), at
  0 px offset. No page errors in any scenario.

## What changes for users

Hovering a plot shows a cursor line and the point's x, obs, calc, diff and
background, with the reflections under the cursor. The wheel, a pinch, the
keys and the buttons zoom about the cursor, a drag pans, and refining no
longer loses the zoom in d or Q. **A drag that used to zoom now pans**:
Shift + drag is the box zoom. A zoomed series is clipped to the data area,
the controls are always shown, and the hint lines under the plots are
reworded. On a phone the plot no longer blocks the page's scroll. Large
patterns pan and zoom at frame rate.

## What it means for the validation

No tool, tool text or core module changed, so arm A, arms B and C and the
snapshots are unchanged.

## Not done

- **Safari's pinch** (`gesture*`) is implemented but untested: Chromium
  cannot send those events.
- **The Agent's ▽ marks** are drawn by unchanged SVG code, but the headless
  run had no Agent session to show them.
- **Zoom through a refinement in d** was checked with difC edited by hand
  (22585.8 → 22620), which moves the d domain as a refined difC would: the
  demo's calibration is locked and its TOF instrument has no zero row.
- For the owner: drag pans with Shift for the box (a pan/zoom mode toggle is
  the alternative, not recommended); double-click resets; y automatic with
  the tall box or the toggle to fix it. Each is a one-line change to flip.
- Not given the hook: the single-crystal Fo²/Fc² scatter, the posterior
  histograms, the boxcar, the history sparkline and the validation residual
  strip (the strip is the one candidate).

## Checks

At `0016f42`: lint, typecheck and build pass; `npm test` 312 files, 2628
tests passed, 276 skipped (2615 before, plus `plotView.test.ts`'s 13). After
merging `main` into the branch: lint passes, and the held-out, skill-lint and
docs-count tests pass.

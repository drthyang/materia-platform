# Demo QA

Every public demo, run end to end on the production build in a real browser,
so the demo runs with no errors. MATERIA is in feature freeze: this pass fixed
bugs and polish only, and changed nothing the Copilot's model reads.

| | |
| --- | --- |
| Date | 2026-11-07 |
| Build | `npm run build` of branch `demo-qa` at `bbd902d` (v0.5.0, `origin/main` `5d236a0` merged in), served by `vite preview` |
| Browser | Chrome 157.0.8103.38, headless, driven by `playwright-core` (the system Chrome; nothing downloaded) |
| Viewports | 1600×900 and 1280×800 (desktop), 390×844 (phone: `isMobile`, touch) |
| Inputs | The bundled public demos (Mn₃Ga POWGEN, GaTa₄Se₈ X-ray PDF) and a synthetic SrTiO₃ CIF + neutron G(r) written from `src/testSupport` by `scripts/write-srtio3-pdf.ts`. Nothing from `data/`. |
| Copilot | No API key, then a scripted model through Playwright's route interception. No model or provider was called. |
| Result | 19 of 19 steps pass: no page errors, no console errors or warnings, no failed requests, no broken states |

## Checklist

Each step ran at all three viewports (step 6 is the phone's own). "Slow" means
more than about 2 s for something the user waits on; work that runs in a
worker behind a progress line and a Cancel is listed with its time, not
counted as slow.

| # | Step | 1600×900 | 1280×800 | 390×844 |
| --- | --- | --- | --- | --- |
| 1 | Start page; each demo card opens and Close returns to the start; a CIF and a G(r) loaded by hand (synthetic SrTiO₃) route to the PDF page and Refine to Rw 0.01 % | pass | pass | pass |
| 2 | Rietveld on Mn₃Ga: Refine, Validation tab, Posterior Sample then Stop, the magnetic step (k-search, Rank 14 candidates, Refine moments, Continue), Report and mCIF export; the report opens | pass | pass | pass |
| 3 | PDF on GaTa₄Se₈: Refine; Subgroups Tree (and its detail) and List; the k chips; Find P-42₁m; Activate the 1×1×2 child | pass | pass | pass |
| 4 | 3D Model: the k-point chips, Expand/Collapse all (folded modes), the contribution chart's bar (arrows for one irrep), All in 3D, every bond style (sticks, ball-and-stick, thin lines), bond colour, Hide bonds; ✕ clear back to F-43m; Boxcar on its own range (2–14 Å), run, Use fit range; PDFgui / diffpy-CMI export (a zip) | pass | pass | pass |
| 5 | Copilot with no API key: the box says to add a key and stays disabled; Local proxy on a server without a key and on the static site (no proxy) each say why in a sentence. Scripted model: the refine call waits on its approval card (Ask first), Approve runs it; the context meter neutral, amber (Start fresh / Summarize) and red | pass | pass | pass |
| 6 | Phone: Refine from the bottom action bar; the Copilot opens as a sheet and closes; a Subgroups row opens its detail sheet with Activate on screen | — | — | pass |
| 7 | Save (`.materia.json`), Close, reopen it (same wR), Reset then Back / Forward (header buttons, or History's on a phone), the History menu, go back to the Refine step (its wR), Close through the dialog | pass | pass | pass |

### Timings (1600×900; the other viewports within ~10 %)

| Action | Time |
| --- | --- |
| Open the Mn₃Ga demo / the GaTa₄Se₈ demo | 0.3 s / 0.9–1.0 s |
| Refine: Mn₃Ga / GaTa₄Se₈ / SrTiO₃ | 0.2 s / 1.0 s / 0.2 s |
| Validation tab; Posterior Stop; k-search; Refine moments | 0.15 s; 0.04 s; 0.06 s; 0.2 s |
| Rank 14 magnetic candidates (background, progress and Cancel) | 18–29 s |
| Subgroups listing at 2×2×2 / 1×1×2 (worker, rows stream in) | 7.6–7.8 s / 3.6 s |
| Activate the 1×1×2 child; ✕ clear | 0.5 s; 0.4 s |
| Boxcar scan (8 boxes) | 0.6 s |
| Report / mCIF / PDFgui export; Save; reopen | 0.15 s / 0.08 s / 0.08 s; 0.04 s; 0.24 s |
| Copilot: Approve → refine → reply (scripted) | 0.25 s |

The local-only magnetic demo's probe (`localMagneticDemoAvailable`) asks for a
file under `data/`. `vite preview` answers it with the app's page (200), which
the probe reads as absent; GitHub Pages answers with a 404, which is expected
and harmless. The only 404 in the run is the one step 5 simulates on purpose
(the static site's missing proxy), listed as expected.

## Issues found and fixed

All in this branch (PR from `demo-qa`).

| Issue | Where | Fix | Commit |
| --- | --- | --- | --- |
| Chrome logged `[DOM] Password field is not contained in a form` whenever the Copilot's settings showed (every desktop and phone run) | `src/agent/ui/AgentDrawer.tsx` | The Anthropic and OpenAI key fields sit in a `KeyForm` that never submits (`display: contents`, so the layout is unchanged); test in `dockHeader.test.ts` | `67ebe0f` |
| The posterior table's R̂ header drew its hat beside the R (the sans header face) | `src/app/ui/PosteriorPanel.tsx` | The header cell in the mono face, as R̂max above the table | `73dce5c` |
| At 1280 px with the Copilot open, the Rietveld card's GoF ran under its view tabs (the title row measured its figures as if they could wrap) | `src/app/PowderWorkbench.tsx`, `src/app/PdfWorkbench.tsx` | The figures do not wrap, so the tabs take their own line when both do not fit, as the row was designed to; the QA script checks the row fits | `9727bd2` |

## Known remaining issues

Listed, not fixed: each is a feature, a larger change, or touches what the
Copilot's model reads.

- **✕ clear records no History step.** After ✕ clear the page is the parent
  again, but the header's last-step chip still names the child ("Supercell
  child: …") and History has no "back to the parent" step; Back from there
  skips to the step before the activation. The Copilot's `clear_subgroup`
  shares the handler. Recording a step would add a History entry the model
  reads in `get_state`, so it waits for the freeze to lift.
- **The exported mCIF does not name its BNS group.** The header's mCIF (and
  the 3D card's) writes the magnetic operations, complete, and the parent
  group, but not `_space_group_magn.name_bns`: the label is not passed to
  `magneticStructureToMcif`. Readers identify the group from the operations.
  Belongs with the mCIF work already queued.
- **Ranking magnetic candidates takes 18–29 s** for the 14 maximal
  candidates (one refinement each). It runs with progress and Cancel and the
  page stays usable. Speed work is parked (correctness first).
- **The Subgroups listing takes ~8 s at 2×2×2** (the default bound) and
  ~4 s at 1×1×2, in a worker, with rows streaming in under "so far".
- **Opening the GaTa₄Se₈ demo takes ~1 s** (once 2.2 s under load), mostly
  building the PDF page's model and its first G(r) on the main thread.
- **Narrow panels scroll sideways:** on the 3D Model view the site chips and
  the mode table (A_p, esd columns) scroll inside their boxes at 1280 px and
  on a supercell child at 1600 px. By design, but nothing hints at the scroll.
- `scripts/device-screenshots.mjs` waits for "Result: converged", which the
  page no longer shows (it says "converged · 2 cycles"); it times out.

## Re-running

```sh
npm ci
npm run build
node scripts/demo-qa.mjs [outDir]
```

It starts `vite preview` on port 4317 with no API key, writes the synthetic
SrTiO₃ inputs to `outDir/inputs` (once), and leaves in `outDir` a screenshot per
check (`<viewport>-<step>-<what>.png`), the downloads it checked,
`demo-qa.json` and `demo-qa.md` (pass/fail, issues, timings, notes). It exits
non-zero if any step fails. About 4 minutes. Every screenshot keeps the app's
© line: where the page's footer is out of view (a phone mid-page, a sheet), the
same line is pinned to the corner for the shot.

Options: `--base=<url>` to test a server already running (a dev server, or the
deployed site for steps that do not need the preview's proxy),
`--only=1600,390` for some viewports, `--steps=2,5` for some steps.
`CHROMIUM=/path/to/chrome` picks another browser.

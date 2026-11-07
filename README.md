# MATERIA

[![Live demo](https://img.shields.io/badge/demo-live-2563eb)](https://drthyang.github.io/materia-platform/)
[![Status: beta](https://img.shields.io/badge/status-public%20beta-d97706)](docs/LIMITATIONS.md)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-3c8c3c)](LICENSE)

**Crystal and magnetic structure refinement in the browser, built to be driven by people and by AI agents.**

MATERIA refines crystal structures against diffraction and total-scattering data in a web page, with
nothing to install and the data never leaving your machine. It runs Rietveld refinement of powder
patterns (X-ray and neutron, constant wavelength and time of flight, several phases), single-crystal F²
refinement, and real-space fits of the pair distribution function G(r), magnetic PDF included. For
magnetic order it goes from the peaks the nuclear model leaves, to the propagation vector k, to the
magnetic space groups that k allows, ranked against the data, to refined moments and an mCIF. Its own
subgroup engine builds the irreps, isotropy subgroups and subgroup lattice of a structure within a
supercell bound, so a lower-symmetry child, in the parent's cell or a larger one, can be activated and
refined by its distortion modes. The **MATERIA Copilot** puts a language model beside the analysis: it
reads the live page, follows your written method, and changes things only through the page's own
controls, asking first. One TypeScript engine backs the app, the Copilot and an MCP server.

<p align="center">
  <img src="docs/media/desktop.webp" alt="The Rietveld page: a two-phase Mn₃Ga and MnO fit of POWGEN time-of-flight neutron data, with observed, calculated and difference curves, a row of Bragg ticks for each phase, and the symmetry-allowed parameter table with esds" width="100%" />
</p>

## Quick start

**Online:** open **[drthyang.github.io/materia-platform](https://drthyang.github.io/materia-platform/)**.
The analysis runs in your browser.

**Locally** (Node 22, as CI uses):

```bash
git clone https://github.com/drthyang/materia-platform.git
cd materia-platform
npm ci
npm run dev        # then open http://localhost:5173/materia-platform/
```

| Command | What it does |
| --- | --- |
| `npm run test` | Unit, regression and scripted agent-eval tests (Vitest) |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint |
| `npm run build` · `npm run preview` | The production build, and a local server for it |
| `npm run mcp` | Build and serve the MCP server ([agent tools](docs/AGENT_TOOLS.md)) |

The Copilot needs a model. On the live site, paste an Anthropic API key in its settings (it stays in
your browser) or connect a local model on Ollama or LM Studio. With `npm run dev` or `npm run preview`,
put `ANTHROPIC_API_KEY` in `.env.local` and choose **Local proxy**, so the key never reaches the browser
([five ways to reach a model](docs/AGENT_TOOLS.md#five-ways-to-reach-a-model)).

## Try it in 2 minutes

Both demos are public data and open on a converged fit.

1. **Rietveld.** On the start page click **Rietveld · Mn₃Ga neutron TOF**, then **Refine**: a two-phase
   fit at wR 4.24 %, with the MnO impurity's weight fraction and its esd. **Validation** gives the
   verdict against the acceptance bar.
2. **The magnetic step.** Click **Magnetic analysis →**, **Include them in the k-search**,
   **Search k from … peaks**, then **Rank 14 candidates against the data** (20–30 s, with progress
   and Cancel). At 600 K the sample is paramagnetic, and the page says that no candidate improves on
   the nuclear-only fit.
3. **PDF and subgroups.** **Close**, open **PDF · GaTa₄Se₈ X-ray G(r)** and click **Refine**. Open
   **Subgroups**: the Tree of F-43m's maximal subgroups. Set **Supercell** to **1×1×2**, switch to
   **List**, type `P-42_1m` in **Find**, pick the 1×1×2 row and click **Activate**: the child refines
   in its own (a, a, 2c) cell.
4. **3D Model.** The modes fold by parent irrep, with a bar chart of each irrep's share of the
   distortion. Click a bar to draw that irrep's displacements as arrows.

A 5–10 minute walk-through with timings and fallbacks: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).
Every page and control, task by task: the [user guide](docs/USER_GUIDE.md).

## What's new in 0.5.0

**Subgroups: a Tree, a merged List, and Find.** The Subgroups view opens on the Tree of maximal
subgroups within the supercell bound (2×2×2 by default). Each row gives the cell, the domain states and
the irreps that reach it; the detail shows how you get there and what Activate will refine.

<p align="center">
  <img src="docs/media/subgroups-tree.webp" alt="The PDF page's Subgroups view on the GaTa₄Se₈ demo: on the left the Tree of F-43m's five maximal subgroups in a 2×2×2 bound, with k-point chips above it; P-43m #215 is selected, and its detail on the right gives a same-cell child with 4 domains and index 4, the path F-43m to P-43m by X irrep 1, and an Activate button" width="100%" />
</p>

**3D modes grouped by k-point and irrep, with a contribution chart.** After Activate, the 3D Model view
lists the child's distortion modes folded by parent irrep, filters them by k-point and site, and charts
each irrep's share of the distortion. Bonds draw as sticks, ball-and-stick or thin lines, or not at all.

<p align="center">
  <img src="docs/media/modes-3d.webp" alt="The 3D Model view after activating and refining the P-42₁m child of GaTa₄Se₈ in a 1×1×2 cell: the unit cell with green displacement arrows for X irrep 5 of 5, k-point and site chips, a bar chart giving X irrep 5 of 5 55.6 % and W irrep 1 of 4 44.4 % of the distortion, and the mode table with A, A_s and A_p for each irrep" width="100%" />
</p>

**The Copilot lowers the symmetry, and shows how full the model's window is.** `list_subgroups`,
`lower_symmetry` and `clear_subgroup` do what the Subgroups view does, through an approval card. A meter
by the message box gives the share of the model's context window in use.

<p align="center">
  <img src="docs/media/copilot-lower-symmetry.webp" alt="The Copilot docked beside the GaTa₄Se₈ PDF page, played by a scripted model (no model was called). The user asked to lower the symmetry to P-42₁m in a 1×1×2 cell; the Copilot has read the pdf-workflow skill and listed the subgroups, and waits on an approval card: Lower F-43m #216 to P-42₁m #113, 1×1×2, 24 domains, from X irrep 5 and W irrep 1, variant 1 of 4, with Approve and Decline. Ask first is selected, and the context meter reads 19 %" width="100%" />
</p>

**A phone layout.** Up to 640 px wide, Prefit, Refine and Cancel sit in a bar at the bottom of the
screen, the Copilot opens as a sheet, and a subgroup's detail as a full-screen sheet.

<p align="center">
  <img src="docs/media/phone.webp" alt="Four phone screens 390 px wide: the Mn₃Ga Rietveld pattern with Escape min and Refine in the bottom bar; the GaTa₄Se₈ Subgroups Tree with Prefit and Refine in the bottom bar; the P-43m subgroup detail as a full-screen sheet with Back, its two variants and Activate; and the Copilot as a sheet with a Refine approval card" width="100%" />
</p>

Also new: magnetic representation analysis at any commensurate k on the same engine, **Stop** for
posterior sampling, a Boxcar tab with its own range and starting point, and a PDFgui / diffpy-CMI
export. Two fixes change results: a powder magnetic line now sums every member of its family, so
domains of one group fit alike, and irrep numbers follow one documented order on every runtime.
Details and upgrade notes: [CHANGELOG](CHANGELOG.md#050---2026-11-07).

## What it does

| Track | Highlights |
| --- | --- |
| **Powder Rietveld** | CW and TOF, multi-phase, microstructure; GSAS-II, GSAS and FullProf instrument files; a FullProf / GSAS-II cross-check bundle |
| **Magnetic structures** | Magnetic peaks → k search → magnetic subgroups (BNS/OG) → moments; representation analysis at any commensurate k; commensurate and incommensurate single-k; mCIF |
| **Single crystal** | F² from hkl, SHELX and FullProf lists; extinction, twins, absolute structure |
| **PDF and mPDF** | Neutron and X-ray G(r), multi-phase and multi-dataset, magnetic PDF; boxcar scans; a PDFgui / diffpy-CMI export |
| **Subgroups** | Irreps, isotropy subgroups and the subgroup lattice within a supercell bound; a child refines in its own cell; modes by parent irrep, with ISODISTORT's A_s and A_p; ISODISTORT mode CIFs read and written |
| **Uncertainty** | Least-squares esds plus Bayesian posteriors (ensemble MCMC and NUTS), with Stop and Continue |

How it compares with GSAS-II, Jana2020 and FullProf: [docs/COMPARISON.md](docs/COMPARISON.md).

## How the Copilot stays safe

The Copilot works through the app, not beside it, and the rules that keep it in line are code, not a
prompt. Each item names where it lives; the full account is in [docs/AGENT_TOOLS.md](docs/AGENT_TOOLS.md).

- **Ask first or Auto, with approval cards.** A tool that only reads runs at once. A tool that changes
  the analysis first shows a card saying what it will do (*"Lower F-43m #216 to P-42₁m #113 · 1×1×2 ·
  24 domains"*), and nothing changes until you click **Approve**. **Auto** skips the cards and goes back
  to **Ask first** on reload. Some changes are always yours, even in Auto: lifting one of your
  method's firm rules, or setting an instrument constant such as the polarization. Each change is a
  History step tagged as the Copilot's and undone with ⌘Z. A change approved after the page moved under
  it is not run, and one that cannot run is refused before its card.
- **Your method as skills, its firm rules as gates.** Each page's method is a skill the Copilot must
  read before it may change anything. The rules that must not bend are enforced in
  [`method.ts`](src/agent/method.ts) and [`executorPolicy.ts`](src/agent/executorPolicy.ts):
  - **Correlated parameters never refine together.** Before it runs, `refine` measures the free set and
    refuses when two parameters correlate at |ρ| ≥ 0.95 or the data cannot determine a combination of
    them, naming the pair and the physical reason.
  - **The firm rules:** no occupancy freed with nothing but the scale to determine it; the instrument's
    terms never with the thermal parameters, or (on powder) with the positions; microstrain on its own.
    Only you lift one, through a card that always asks.
  - **The order:** the space group is questioned last (`review_symmetry` waits for a converged fit
    with the method's stages done). In the magnetic step the moments are fitted against the nuclear
    model held fixed, the magnetic refinement frees only the moments, and the report waits for the
    final instrument pass.
- **One run at a time.** A change is refused while a refinement runs, refinement and posterior sampling
  never run together, and `lower_symmetry` waits while a fit or the sampler runs. **Stop** cancels a
  running fit, and a call it reaches before acting is not run.
- **Every number in a report is audited.** The Copilot writes only the report's summary. Its decimal
  numbers are checked against the numbers the report computed
  ([`reportAudit.ts`](src/core/export/reportAudit.ts)); any that match none are marked and sent back
  for correction. Without the Copilot, a report's Result is composed from the app's own checks, never
  by a model.
- **No silent truncation, and a context meter.** The meter shows the share of the model's window in
  use: neutral below 70 %, amber from 70 % with **Start fresh** and **Summarize and continue**, red
  above 90 %. The chat says so when the app starts sending a local model older tool results as digests,
  when the API leaves older results out, and when a reply stops because the window filled.
- **Frozen agent-read strings and an eval suite.** Everything the model reads (the system prompt, the
  mode lines, every tool's description and input schema) is kept in the repository as snapshot files
  ([`model-text.arm-b.md`](src/agent/__snapshots__/model-text.arm-b.md)), so any change to it shows in
  a pull request's diff; in the current feature freeze none of it changes. Each of the
  [39 eval scenarios](docs/AGENT_EVALS.md#the-scenarios) is a request the Copilot once got wrong. CI
  replays every scenario with a scripted model, once as it should behave and once as it failed, to show
  that the checks catch the failure ([docs/AGENT_EVALS.md](docs/AGENT_EVALS.md)).

## Validation and evals

**The engine against reference programs.** Each row names what a result was checked against.
*Supported*: implemented and checked. *Approximate*: works, with a simplification to know. Tolerances
and tests are in [VALIDATION.md](docs/VALIDATION.md#external-comparisons), every gap in
[LIMITATIONS.md](docs/LIMITATIONS.md).

| Area | Case | Checked against | Result | Status |
| --- | --- | --- | --- | --- |
| Single crystal | Ga/Al hydride, Mo Kα, SHELXL's 142 parameters | SHELXL | R1 2.02 % (2.04 %); Flack x 0.435(11) (0.435(15)); Al share 0.844(2) (0.844(2)) | Supported |
| Magnetic intensities | Mn₃Ga 350 K, POWGEN neutron | GSAS-II | all 82 \|F_M\|² within ±5 % | Supported |
| Moments and group | Mn₃Ga 30 K, monoclinic cell | GSAS-II | \|M\| of three Mn sites to 0.01 μB; P2₁′/m′ | Supported |
| Magnetic group labels | MnO, every k = 0 subgroup of Fm-3m | FindSpinGroup | the same BNS labels | Supported |
| Magnetic groups at k ≠ 0 | 15 parents and k, 0 and zone boundary | an independent construction, named by spglib | every candidate a group; the same classes and BNS numbers | Supported |
| Subgroup lattice | Pnma, Pm-3m and Fm-3m in a supercell | Bilbao SUBGROUPS; brute-force enumeration | the same class counts (Pm-3m, I-centred 2c cell: 98 classes, 10 maximal); Fm-3m: the same 231 subgroups | Supported |
| Modes by irrep | SrTiO₃ → R-3c and Pnma; NiAs → MnP-type Pnma | ISOTROPY; ISODISTORT 6.12.2 mode CIFs | per-irrep A_s to 4e-14; A_s and normfactor as ISODISTORT writes them | Supported |
| Supercell child | four SrTiO₃ tilt systems | the whole supercell summed atom by atom | \|F\|² to 4e-12, G(r) to 7e-14 | Supported |
| Incommensurate k | DyMn₆Ge₆ conical spiral, PSI DMC | FullProf | γ = 0.16478(67) (0.16509(43)); the cone's k = 0 part is not modelled, so wR 19.9 % (11.3 %) | Approximate |
| PDF | Ni and MnO, X-ray G(r) | PDFfit2 1.6.0 | G_calc correlation 0.9998; refined cell within 2 mÅ | Supported |
| Magnetic PDF | MnO and its measured tutorial data | diffpy.mpdf | f(r) to 10⁻¹¹ of its peak; ordered scale 1.6716 (1.6685) | Supported |
| Posterior | the PDFfit2 Ni fit; exact Gaussian cases | LM esds; the exact posterior | posterior std / esd 0.95–1.01 | Approximate: correlated residuals ignored |
| Does the Copilot help? | 8 held-out simulated cases with known answers | the app alone, fixed scoring | the app alone is right on 3 of 8; the Copilot's runs are in progress | Not yet |

Reference values are in parentheses.

**The v0.5.0 eval gate.** Before the tag, eight live eval scenarios ran on Claude Haiku 5.5 and Claude
Sonnet 5.5, three runs each (four on Sonnet for two of them: 50 runs). After the fixes they led to, the
saved runs were re-scored with no model called, and the two scenarios the fixes touched were run live
again ([VALIDATION.md](docs/VALIDATION.md#the-v050-eval-gate-2026-11-07)):

| | Haiku 5.5 | Sonnet 5.5 |
| --- | --- | --- |
| All eight scenarios, re-scored | 22/24 (19 as run) | 23/26 (22 as run) |
| `pdf-lower-symmetry`, live re-run after the fixes | 3/3 | 3/3 |
| `full-refinement`, live re-run after the fixes | 2/3 | 3/3 |

The one failure in the re-run is the grader's, not the model's: the run converged at GoF 0.97, and a
check read a staging sentence as a refusal.

**What this shows, and what it doesn't.** The gate shows that on these eight scenarios both models
mostly do what an earlier failure taught the Copilot to do. It is a regression test of behaviour, on a
few runs per scenario. It does not show that the Copilot reaches better answers than the app used
without it. That question has its own protocol, on held-out simulated cases with known answers, and
its Copilot runs are not done yet (the last row of the table above;
[VALIDATION.md, "Does the Agent help?"](docs/VALIDATION.md#does-the-agent-help)). Separately, in ten
researcher rounds a crystallographer put the Copilot through analyses end to end, and what it got wrong
or could not do was fixed ([researcher rounds](docs/VALIDATION.md#researcher-rounds)).

## Documentation

| Read | For |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Every page and control, task by task |
| [Demo script](docs/DEMO_SCRIPT.md) | A 5–10 minute walk-through with timings and fallbacks |
| [Limitations](docs/LIMITATIONS.md) | What is supported, approximate or missing |
| [Validation](docs/VALIDATION.md) · [Agent evals](docs/AGENT_EVALS.md) | What is tested, and against what |
| [Agent tools](docs/AGENT_TOOLS.md) | The Copilot's tools and the MCP server |
| [Architecture](docs/ARCHITECTURE.md) | The layers, the source tree and the real-data regression |
| [All docs](docs/README.md) | Every document, by task |

## Status

**Public beta.** Validate results intended for publication against established tools; see
[limitations](docs/LIMITATIONS.md) and the [roadmap](docs/ROADMAP.md).

## License

[AGPL-3.0](LICENSE). If you run a modified version on a network server, you must make its source
available to its users (AGPL §13).

*This project is personal work, developed and maintained in my personal capacity.*

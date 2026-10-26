# MATERIA

[![Live demo](https://img.shields.io/badge/demo-live-2563eb)](https://drthyang.github.io/materia-platform/)
[![Status: beta](https://img.shields.io/badge/status-public%20beta-d97706)](docs/LIMITATIONS.md)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-3c8c3c)](LICENSE)

**Crystal and magnetic structure refinement in the browser, built to be driven by people and by AI agents.**
Rietveld, single-crystal F², magnetic structures and PDF/mPDF run on one TypeScript engine, with nothing
to install. The same engine backs the app, an in-app Copilot and an MCP server.

**▶ [Try it](https://drthyang.github.io/materia-platform/)**: the analysis runs on your machine. Two
demos open converged: a two-phase Mn₃Ga neutron TOF Rietveld fit and a GaTa₄Se₈ X-ray PDF fit.

<p align="center">
  <img src="docs/screenshots/desktop.png" alt="Two-phase Mn₃Ga + MnO Rietveld refinement of POWGEN time-of-flight data: observed/calculated/difference curves, per-phase Bragg ticks, and the symmetry-allowed parameter table with esds" width="100%" />
</p>

## Impact

- **One workflow for what usually takes several programs.** Powder and single crystal, X-ray and
  neutron (CW and TOF), nuclear and magnetic, reciprocal and real space, in a browser
  ([comparison with GSAS-II, Jana2020 and FullProf](docs/COMPARISON.md)).
- **Checked against the standard tools, on real data.** Each row names what a result was checked
  against. *Supported*: implemented and checked. *Approximate*: works, with a simplification to know.
  *Not yet*: not shown. Tolerances and tests are in [validation](docs/VALIDATION.md#external-comparisons),
  every gap in [limitations](docs/LIMITATIONS.md).

  | Area | Case | Checked against | Result | Status |
  | --- | --- | --- | --- | --- |
  | Single crystal | Ga/Al hydride, Mo Kα, SHELXL's 142 parameters | SHELXL | R1 2.02 % (2.04 %); Flack x 0.435(11) (0.435(15)); Al share 0.844(2) (0.844(2)) | Supported |
  | Powder Rietveld | GaNb₄Se₈, 28-ID synchrotron X-ray | GSAS-II | fit quality on the same data: wR 5.7 % (GSAS-II 7.34 %); refined values not compared | Supported |
  | Magnetic intensities | Mn₃Ga 350 K, POWGEN neutron | GSAS-II | all 82 \|F_M\|² within ±5 % | Supported |
  | Moments and group | Mn₃Ga 30 K, monoclinic cell | GSAS-II | \|M\| of three Mn sites to 0.01 μB; P2₁′/m′ | Supported |
  | Magnetic group labels | MnO, every k = 0 subgroup of Fm-3m | FindSpinGroup | the same BNS labels; types I and III only | Supported |
  | Incommensurate k | DyMn₆Ge₆ conical spiral, PSI DMC | FullProf | γ = 0.16478(67) (0.16509(43)); the cone's k = 0 part is not modelled, so wR 19.9 % (11.3 %) | Approximate |
  | PDF | Ni and MnO, X-ray G(r) | PDFfit2 1.6.0 | G_calc correlation 0.9998; refined cell within 2 mÅ | Supported |
  | Magnetic PDF | MnO and its measured tutorial data | diffpy.mpdf | f(r) to 10⁻¹¹ of its peak; ordered scale 1.6716 (1.6685) | Supported |
  | Posterior | the PDFfit2 Ni fit; exact Gaussian cases | LM esds; the exact posterior | posterior std / esd 0.95–1.01 | Approximate: correlated residuals ignored |
  | Does the Copilot help? | 8 held-out simulated cases with known answers | the app alone, fixed scoring | the app alone is right on 3 of 8; the Copilot's runs are in progress | Not yet |

  Reference values are in parentheses.
- **An AI analyst that shows its work.** The Copilot refines by your written method, and asks before
  every change, each one undoable. It reports with esds, and every number comes from the engine.
  Ten rounds with a crystallographer on real data shaped it
  ([researcher rounds](docs/VALIDATION.md#researcher-rounds)).
- **Agent-ready science.** An MCP server exposes the engine to any agent: parse → build →
  refine → assess → interpret ([agent tools](docs/AGENT_TOOLS.md)).

## What it does

| Track | Highlights |
| --- | --- |
| **Powder Rietveld** | CW and TOF, multi-phase, microstructure; GSAS-II, GSAS and FullProf instrument files; a FullProf / GSAS-II cross-check bundle |
| **Magnetic structures** | Magnetic peaks → k search → magnetic subgroups (BNS/OG) → moments; commensurate and incommensurate single-k; mCIF |
| **Single crystal** | F² from hkl, SHELX and FullProf lists; extinction, twins, absolute structure |
| **PDF and mPDF** | Neutron and X-ray G(r), multi-phase and multi-dataset, boxcar scans, symmetry modes, magnetic PDF |
| **Uncertainty** | Least-squares esds plus Bayesian posteriors (ensemble MCMC and NUTS) |

## The Copilot

**MATERIA Copilot** runs a model beside the analysis: a local one on Ollama or LM Studio, a cloud
model, or any OpenAI-compatible server.
It works on the powder page, its magnetic step, the single-crystal page and the PDF page. Your method
lives in skills it reads on demand, and its firm rules are code. Each eval scenario replays one of its
past failures in CI ([evals](docs/AGENT_EVALS.md)). Passing them does not show it beats the app alone;
a controlled study of that is in progress ([protocol](docs/VALIDATION.md#does-the-agent-help)).
[Watch the 96 s demo](docs/media/agent-demo.mp4).

## Status

**Public beta.** Validate results intended for publication against established tools; see
[limitations](docs/LIMITATIONS.md) and the [roadmap](docs/ROADMAP.md).

## Develop

```bash
npm install
npm run dev
npm run test
```

Architecture, layering and the real-data regression: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Every doc, by task: [docs/README.md](docs/README.md).

## License

[AGPL-3.0](LICENSE). If you run a modified version on a network server, you must make its source
available to its users (AGPL §13).

*This project is personal work, developed and maintained in my personal capacity.*

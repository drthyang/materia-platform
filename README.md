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
- **Checked against the standard tools, on real data** ([validation](docs/VALIDATION.md#external-comparisons)):

  | Case | MATERIA | Reference |
  | --- | --- | --- |
  | Ga/Al hydride single crystal, same 142 parameters | R1 2.02 % | SHELXL 2.04 % |
  | GaNb₄Se₈ synchrotron XRD, same data | wR 5.7 % | GSAS-II 7.34 % |
  | Mn₃Ga neutron magnetic intensities | all 82 reflections within ±5 % | GSAS-II |
  | DyMn₆Ge₆ incommensurate spiral | k = 0.16478(67) | FullProf 0.16509(43) |
  | Ni and MnO X-ray G(r) | correlation 0.9998 | PDFfit2 |
- **An AI analyst that shows its work.** The Copilot refines by your written method, and asks before
  every change, each one undoable. It reports with esds, and every number comes from the engine.
  Ten rounds with a crystallographer on real data shaped it
  ([researcher rounds](docs/VALIDATION.md#researcher-rounds)).
- **Agent-ready science.** An MCP server (41 tools) exposes the engine to any agent: parse → build →
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
It has 62 tools across the powder page, its magnetic step, the single-crystal page and the PDF page. Your method lives in
skills it reads on demand, and its firm rules are code. 38 eval scenarios replay its past failures in
CI ([evals](docs/AGENT_EVALS.md)). A controlled study of whether it beats the app alone is in progress
([protocol](docs/VALIDATION.md#does-the-agent-help)).
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

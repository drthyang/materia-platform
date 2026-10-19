# MATERIA Workbench

[![Live demo](https://img.shields.io/badge/demo-live-2563eb)](https://drthyang.github.io/materia-platform/)
[![Status: beta](https://img.shields.io/badge/status-public%20beta-d97706)](docs/LIMITATIONS.md)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-3c8c3c)](LICENSE)
[![Runs in the browser](https://img.shields.io/badge/runs-in%20your%20browser-6b6b6b)](https://drthyang.github.io/materia-platform/)

**Crystal and magnetic structure refinement that runs entirely in your browser,
built to be driven by people and by AI agents.**

**An Agent works the analysis with you.** Open it beside a powder, single-crystal or PDF fit and
a model of your choice — local on Ollama or LM Studio, or in the cloud — runs the refinement by
your written method, says why a fit is poor, names the phase behind an extra
peak, finds a magnetic structure, checks an unconvincing number with a Bayesian
posterior, and reports the result with esds. It asks before every change, or
works through the stages on its own in Auto. Its methods are skills it reads on
demand, its firm rules are code, and an eval suite replays the failures it once
had in CI. [How it works ↓](#the-agent)

**▶ Try it: [drthyang.github.io/materia-platform](https://drthyang.github.io/materia-platform/)** —
nothing to install, and the analysis runs on your machine (the Agent sends its
conversation only to the model you choose: nowhere else for a local model, to
the provider's API for a cloud one). Two demos open already converged: a two-phase Mn₃Ga
neutron TOF Rietveld fit and a GaTa₄Se₈ X-ray PDF fit.

<p align="center">
  <img src="docs/screenshots/desktop.png" alt="Two-phase Mn₃Ga + MnO Rietveld refinement of POWGEN time-of-flight data: observed/calculated/difference curves, per-phase Bragg ticks, and the symmetry-allowed parameter table with esds" width="100%" />
</p>

## Goals

- **Refinement an agent can reason about.** One pure TypeScript core backs the
  UI, the MCP tools and the in-app Agent, and returns what judgment needs —
  correlations, null directions, bounds — not only wR.
- **One workflow, nothing to install.** Powder and single crystal, X-ray and
  neutron (CW and TOF), nuclear and magnetic, reciprocal and real space, in a
  browser, beside GSAS-II, Jana2020 and FullProf ([comparison](docs/COMPARISON.md)).
- **Transparent by design.** A validation view, not wR alone, and results
  checked against established tools ([validation](docs/VALIDATION.md)).

## Features

| Track | What you get | Read more |
| --- | --- | --- |
| **Powder Rietveld** | CW and TOF, multi-phase, background, peak shape, microstructure; GSAS-II, GSAS and FullProf instrument files; one-click FullProf / GSAS-II cross-check bundle | [User guide](docs/USER_GUIDE.md) |
| **Magnetic structures** | Detect magnetic peaks → k-vector search → magnetic subgroups with BNS/OG labels → moment refinement; k = 0, commensurate and incommensurate single-k; mCIF export | [Magnetic symmetry](docs/MAGNETIC_SYMMETRY.md) |
| **Single crystal** | F² refinement from hkl, SHELX HKL and FullProf `.int` lists, extinction, twins and the absolute structure; the Agent works it too (absorption correction is in the core only, with no page control or Agent tool yet) | [Single crystal](docs/SINGLE_CRYSTAL.md) |
| **PDF and mPDF** | Neutron and X-ray G(r), multi-phase and multi-dataset, boxcar scans across r, symmetry-mode distortions, magnetic PDF; validated against PDFfit2 and diffpy.mpdf | [PDF roadmap](docs/PDF_MPDF_ROADMAP.md) |
| **Uncertainty** | Levenberg–Marquardt esds plus Bayesian posterior sampling (ensemble MCMC and NUTS) with convergence diagnostics | [Refinement engine](docs/REFINEMENT_ENGINE.md) |
| **In-app Agent** | A model of your choice beside the analysis — local on Ollama or LM Studio, or a cloud model — runs it by your method and discusses it; every change approved or undoable | [The Agent](#the-agent) |
| **Agent tools** | An MCP server over the same core (41 tools): parse → build → refine → assess → suggest → interpret | [Agent tools](docs/AGENT_TOOLS.md) |
| **Files** | Reads CIF/mCIF, hkl, `.int`, GSAS/FXYE/ILL/plain powder data, `.gr`/`.sq`/`.fq`; writes CIF/mCIF with esds, an HTML report, and a reopenable project file | [Project format](docs/PROJECT_FORMAT.md) |

## The Agent

**MATERIA Copilot**, the rail at the page's side, opens a model beside the analysis: one you run yourself on
Ollama or LM Studio, a cloud model (Anthropic's, through an API key or the
local proxy), or any server that speaks OpenAI's API (OpenAI, Gemini, vLLM, a
llama.cpp server). It reads the live page, judges the fit with the same tools
the MCP server exposes, and changes things through the page's own controls,
each change an undoable History step. **Ask first** puts every change on an
approval card; **Auto** works through the method's stages and stops when a
decision is yours.

Local models are experimental. The app sizes every request to the model's
window (old results shortened to a digest, a prompt that cannot fit refused,
never sent cut), offers it only the tools of the method's stage, and stops it
if it goes in circles; a model counts as supported once it passes the eval
suite's [local tier](docs/AGENT_EVALS.md#the-local-tier).

[![The Agent sets the fit range, refines PbSO₄ with the instrument's terms and the B values in turn, and writes its report](docs/media/agent-demo.png)](docs/media/agent-demo.mp4)

*[Watch the 96 s demo](docs/media/agent-demo.mp4): PbSO₄ against GSAS-II's D1A
tutorial data, refined by the method's stages to wR 3.87 %, with its report. The
numbers are computed live in the browser; the Agent's turns are a recorded live
run (Claude Opus 5.5), replayed, and labelled so.*

- **The whole analysis, talked through.** Fit range, cell check, the refinement
  stage by stage, why a fit is poor, which phase an extra peak is, bond
  valences, the magnetic structure, boxcar scans of a PDF, the single-crystal
  data, twins and the absolute structure; then a report with esds. It
  answers questions about the fit on screen. 60 tools across the powder page, its magnetic step, the
  single-crystal page and the PDF page.
- **Your method, as skills read on demand** ([`.claude/skills/`](.claude/skills)),
  so a local model with a 32k context can follow it. **Firm rules in code**: no
  change before the method is read, no refinement of a set correlated at
  |ρ| ≥ 0.95, no bare occupancy, the instrument's terms and the B values never
  together, the space group questioned last.
- **A report you can hand on**: every number from the engine and the History;
  the Agent's own account labelled, any number in it the engine did not compute
  underlined. A Bayesian check (`sample_posterior`) when a number is not
  convincing.
- **Tested on what it does.** 37 eval scenarios, each written against a failure
  a user or a researcher round found, replay the real chat loop in CI with a
  scripted model, as the Agent should behave and as it failed (50 of the 57
  checks are shown to catch a failure this way); real models run on demand.
  Ten researcher rounds on real data drove it; see
  [docs/AGENT_EVALS.md](docs/AGENT_EVALS.md) and
  [docs/VALIDATION.md](docs/VALIDATION.md#researcher-rounds).

More: [docs/AGENT_TOOLS.md](docs/AGENT_TOOLS.md) (every tool and rule),
[docs/AGENT_EXAMPLES.md](docs/AGENT_EXAMPLES.md) (worked MCP sessions).

## Status

**Public beta.** Results intended for publication must be validated against
established tools and expert judgment; what is supported, approximate, or
missing is listed in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Next up: the
star of k and multi-k structures, full representation analysis, and a
symmetry-constrained local-spin model for mPDF. The build order is in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Develop

```bash
npm install
npm run dev
npm run test
```

Build, lint, the real-data regression, and the layering rules are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

The full index, grouped by what you want to do, is
[docs/README.md](docs/README.md). Start with the
[user guide](docs/USER_GUIDE.md), and read the
[limitations](docs/LIMITATIONS.md) before you rely on a result.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version on a network server, you must make its source available to its users
(AGPL §13).

*This project is personal work, developed and maintained in my personal capacity.*

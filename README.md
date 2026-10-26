# MATERIA Workbench

[![Live demo](https://img.shields.io/badge/demo-live-2563eb)](https://drthyang.github.io/web-refinement/)
[![Status: beta](https://img.shields.io/badge/status-public%20beta-d97706)](docs/LIMITATIONS.md)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-3c8c3c)](LICENSE)
[![Runs in the browser](https://img.shields.io/badge/runs-in%20your%20browser-6b6b6b)](https://drthyang.github.io/web-refinement/)

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

**▶ Try it: [drthyang.github.io/web-refinement](https://drthyang.github.io/web-refinement/)** —
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
  checked against established tools ([what is checked against what](#what-is-checked-against-what)).

## Features

| Track | What you get | Read more |
| --- | --- | --- |
| **Powder Rietveld** | CW and TOF, multi-phase, background, peak shape, microstructure; GSAS-II, GSAS and FullProf instrument files; one-click FullProf / GSAS-II cross-check bundle | [User guide](docs/USER_GUIDE.md) |
| **Magnetic structures** | Detect magnetic peaks → k-vector search → magnetic subgroups with BNS/OG labels → moment refinement; k = 0, commensurate and incommensurate single-k; mCIF export | [Magnetic symmetry](docs/MAGNETIC_SYMMETRY.md) |
| **Single crystal** | F² refinement from hkl, SHELX HKL and FullProf `.int` lists, extinction, twins and the absolute structure; the Agent works it too (absorption correction is in the core only, with no page control or Agent tool yet) | [Single crystal](docs/SINGLE_CRYSTAL.md) |
| **PDF and mPDF** | Neutron and X-ray G(r), multi-phase and multi-dataset, boxcar scans across r, symmetry-mode distortions, magnetic PDF; validated against PDFfit2 and diffpy.mpdf | [PDF roadmap](docs/PDF_MPDF_ROADMAP.md) |
| **Uncertainty** | Levenberg–Marquardt esds plus Bayesian posterior sampling (ensemble MCMC and NUTS) with convergence diagnostics | [Refinement engine](docs/REFINEMENT_ENGINE.md) |
| **In-app Agent** | A model of your choice beside the analysis — local on Ollama or LM Studio, or a cloud model — runs it by your method and discusses it; every change approved or undoable | [The Agent](#the-agent) |
| **Agent tools** | An MCP server over the same core: parse → build → refine → assess → suggest → interpret | [Agent tools](docs/AGENT_TOOLS.md) |
| **Files** | Reads CIF/mCIF, hkl, `.int`, GSAS/FXYE/ILL/plain powder data, `.gr`/`.sq`/`.fq`; writes CIF/mCIF with esds, an HTML report, and a reopenable project file | [Project format](docs/PROJECT_FORMAT.md) |

## What is checked against what

A number is trusted only as far as it was checked against an independent
source. Each row names that source, the case and what agreed. **Supported**
means implemented and checked; **Approximate** means it works with a
simplification you should know; **Not yet** means not shown. The tolerances
and the tests are in [docs/VALIDATION.md](docs/VALIDATION.md); every gap is in
[docs/LIMITATIONS.md](docs/LIMITATIONS.md).

| Area | Checked against | Case | Result | Status |
| --- | --- | --- | --- | --- |
| Cell, multiplicities, scattering lengths | GSAS-II | Mn₃Ga + MnO, POWGEN neutron TOF | cell volumes to 0.01 Å³, reciprocal metric to 10⁻⁶, Wyckoff multiplicities exact | Supported |
| Powder Rietveld fit | GSAS-II | GaNb₄Se₈, 28-ID synchrotron X-ray | our staged fit reaches wR 5.7 % on the data GSAS-II fits to 7.34 % | Supported |
| Magnetic structure factor | GSAS-II | Mn₃Ga 350 K, POWGEN | \|F_M\|² of all 82 reflections within ±5 % at GSAS-II's moments | Supported |
| Magnetic moments and group | GSAS-II `.lst` and mCIF | Mn₃Ga 30 K, monoclinic cell | \|M\| of three Mn sites to 0.01 μB; P2₁′/m′ | Supported |
| Magnetic group labels | FindSpinGroup | MnO, every k = 0 subgroup of Fm-3m | the same BNS labels (types I and III; II and IV not yet) | Supported |
| Incommensurate k | FullProf | DyMn₆Ge₆ 11 K conical spiral, PSI DMC | γ = 0.16478(67) against 0.16509(43); the cone's k = 0 part is not modelled, so wR 19.9 % against 11.3 % | Approximate |
| Magnetic supercell reflections | FullProf files | Eu₃In₂Te₄, HB-3A single crystal | identical on every h, k, l, I, σ | Supported |
| Absorption correction | WinGX | Eu₃In₂Te₄ rod crystal, λ = 1.0 Å | transmission r ≈ 0.99 with a fitted μ; in the core only, no page control | Approximate |
| PDF | PDFfit2 1.6.0 | Ni and MnO, X-ray G(r) | G_calc correlation 0.9998; refined cell within 2 mÅ | Supported |
| Magnetic PDF | diffpy.mpdf | MnO (MAGNDATA 1.31) and its measured tutorial data | f(r) to 10⁻¹¹ of its peak; ordered scale 1.6716 against 1.6685 | Supported |
| Posterior sampling | the exact posterior; LM esds | linear-Gaussian problems; the PDFfit2 Ni fit | means within 0.12σ; posterior std / LM esd 0.95–1.01 | Approximate: correlated residuals not modelled |
| GPU structure factors | the f64 CPU path | Mn₃Ga, nuclear and magnetic | worst relative deviation 5 × 10⁻⁷; the same fit minimum | Approximate: f32 |
| Does the Agent help? | the app alone, scored by fixed rules | 8 held-out simulated cases with a known answer | the app alone is right on 3 of 8; the Agent's runs are not made yet | Not yet |

Some of these checks read real data that stay out of git, so CI skips them;
VALIDATION.md marks which.

## The Agent

The **Agent** button opens a model beside the analysis: one you run yourself on
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
  answers questions about the fit on screen, on the powder page, its magnetic
  step, the single-crystal page and the PDF page.
- **Your method, as skills read on demand** ([`.claude/skills/`](.claude/skills)),
  so a local model with a 32k context can follow it. **Firm rules in code**: no
  change before the method is read, no refinement of a set correlated at
  |ρ| ≥ 0.95, no bare occupancy, the instrument's terms and the B values never
  together, the space group questioned last.
- **A report you can hand on**: every number from the engine and the History;
  the Agent's own account labelled, any number in it the engine did not compute
  underlined. A Bayesian check (`sample_posterior`) when a number is not
  convincing.
- **Tested on its past failures.** Each eval scenario is a failure a user or a
  researcher round found. CI replays the real chat loop with a scripted model,
  once as the Agent should behave and once as it failed, so a check that
  cannot catch its failure shows. Real models run on demand. Ten researcher
  rounds on real data drove it; see [docs/AGENT_EVALS.md](docs/AGENT_EVALS.md)
  and [docs/VALIDATION.md](docs/VALIDATION.md#researcher-rounds). Passing the
  evals does not show that the Agent beats the app alone; that question has
  its own protocol, [not yet run](#what-is-checked-against-what).

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

---
name: bayesian-check
description: >-
  The Bayesian check of a converged refinement in MATERIA: sampling the posterior of the
  free parameters (ensemble MCMC, sample_posterior) when a refined number is not convincing —
  an esd as large as the value, a parameter on a bound (B at 0, an occupancy at 1), a strongly
  correlated pair, values that move between refinement paths at the same wR, or a physical
  claim resting on one parameter (an exchange fraction, a moment, a vacancy, a small
  distortion). Covers when to run it, what to free, how to read esdRatio, bounds and posterior
  correlations, convergence, and how to report credible intervals. Powder (nuclear, multi-phase,
  nuclear + magnetic) and PDF pages. NOT a way to choose between models, and NOT a fix for a
  misfit: it measures uncertainty within the model.
---

# The Bayesian check — when the numbers are not convincing

A least-squares esd is a linearization: the curvature of χ² at the minimum. It is honest
only when the posterior is close to Gaussian, the weights are true, and no bound is active.
MATERIA can drop the linearization: `sample_posterior` runs an affine-invariant ensemble
MCMC (Goodman–Weare stretch moves, the emcee algorithm) over the free parameters around the
refined values, with uniform priors inside each parameter's bounds, and reports what the
data actually determine. The theory is in
[refinement_fitting_algorithms_knowledge](../../../knowledge/refinement_fitting_algorithms_knowledge.md) §23.

## When to run it

After the refinement has converged (the sampler starts from the refined values and reads its
widths against their esds) and before you report, when any of these holds:

1. **An esd as large as the value**: |value| < 2 esd. Is the parameter determined at all?
2. **A parameter on or near a bound**: B at 0, an occupancy at 1, a moment at 0. The esd
   means nothing there; the posterior gives a one-sided limit ("B(Cr) < 0.4 Å² at 95 %").
3. **A strongly correlated pair** (|ρ| ≥ 0.9, below the 0.95 at which `refine` refuses the
   pair) that had to stay free together: the posterior shows the ridge the esds only hint at.
4. **Path dependence**: two refinement routes give values that differ by more than their esds
   at the same wR (Cr₂WO₆ at 150 K: B(W) 0.7 and 1.5 Å² by two routes).
5. **A claim resting on one number**: an antisite fraction, an ordered moment, a vacancy, a
   tilt or a local distortion. A number someone will build physics on deserves its
   distribution, not only its esd.

It is optional otherwise: on a clean fit it confirms the esds (esdRatio ≈ 1), which is worth
saying once in a final report.

## What it cannot do — say so

- **It does not choose between models.** It samples one model's parameters; it does not
  compute the evidence for one model over another. To ask whether a parameter is needed,
  look at its own interval: an exchange fraction whose 95 % interval reaches 0 is not
  required by the data. To compare structures, compare their fits on the same data.
- **It does not fix a misfit or a wrong model.** A wide posterior is the honest answer "the
  data do not determine this"; the remedies are a constraint (`tie_parameters`, on the powder
  page), a restraint, or better data (higher Q, another radiation or contrast).
- **It assumes independent residuals, like least squares.** With a systematic misfit — on
  powder, `diagnose_fit`'s Durbin–Watson d below its critical value Q_D — neighbouring residuals
  are correlated and the posterior is as overconfident as the esds. Report that limit with the intervals. On the PDF
  page every interval is approximate (G(r) points are Fourier-correlated).
- **The noise model.** The pages integrate out the overall σ scale (the "marginalized" model):
  the Bayesian counterpart of scaling the esds by the GoF. Say so when you report.

## How

1. **Free what the question needs, and its partners — then refine that set.** The
   parameters in question and everything that correlates with them stay free: the scale
   with occupancies and B's; the B's with each other and the positions; moments with the
   scale. Fixing a correlated partner conditions on it and makes the posterior falsely
   narrow. Fix the rest — usually the profile (U, V, W, X), the background, the cell and the
   zero — and refine once with exactly this free set: the posterior is read against that
   refinement's esds (the tool refuses a different set). The intervals are then conditional
   on what is held: the profile and the background do trade with the B values (the
   instrument–thermal guardrail of `my-rietveld-workflow`), so a B's interval with them fixed
   is narrower than with them free. Say so when you quote it. This matters for time: an ensemble chain mixes more slowly the more
   parameters it carries. On Cr₂WO₆ (1860 points) 20 free parameters had an autocorrelation
   time of ~600 steps and needed ~10⁴ steps; 8–10 need a few thousand.
2. **Sample**: `sample_posterior` (400 steps by default, up to 5000 a call). Not converged →
   `continue: true` until it is. Report only a converged run: R̂ < 1.05 and an ESS of at
   least max(100, 10 per free parameter). A run "close to converged" (R̂ < 1.1) can tell you
   whether a value is determined, not what to quote; intervals that no longer move between
   continues are the practical sign it is near.
3. **Read** each parameter:
   - esdRatio 0.67–1.5: the esd stands; quote value(esd).
   - esdRatio > 1.5: the esd understates the uncertainty; quote the median with its 68 %
     interval, asymmetric if it is: 0.012 (+0.006/−0.004).
   - esdRatio < 0.67: suspect the run (chains not mixed, a prior too tight) before either.
   - On a bound: quote the limit, "< q₉₇.₅ at 95 %".
   - A strong posterior correlation (the tool names those at |ρ| ≥ 0.8): the data fix a
     combination (a sum, a ratio) and not each alone; tie them, restrain one, or report the
     combination.
   - Two values that may or may not differ (two cations' B's, two occupancies, two
     moments): `compare: [["B_W1", "B_Cr1"]]` gives the posterior of the difference and the
     probability that the first is the larger. The data tell them apart only when that
     probability is beyond 0.975 (or below 0.025); otherwise one common value is the
     defensible model (`tie_parameters` on the powder page), and the difference is not a
     result.
4. **Act on it.** If a parameter turns out undetermined, constrain it (on the powder page,
   `tie_parameters` for alike atoms; on the PDF page, fix one of them), fix it at a physically
   sensible value and say so, or drop the claim it carried. If everything is determined, the esds stand and the check is one sentence.

## How to report

Value with its credible interval, the convergence and the setup, so the run can be
reproduced (McCluskey et al. 2023). The form (the numbers are illustrative):

> B(W) = B(Cr) = 0.44 Å² (68 % credible interval 0.36–0.52); posterior width / esd = 1.0.
> Ensemble MCMC, 12 walkers × 2000 steps (half burn-in), R̂max 1.03, ESS ≥ 400; uniform priors
> within the parameter bounds; noise scale marginalized.

Then say what it means for the structure: which numbers are determined, which are limits,
and which conclusions they support. In the app, `write_report` puts the last run in the
report — the intervals, the width against the esd and the convergence. A run on a focused
set, made before the final refinement, is labelled as such, with how far its values have
moved since in their esds: if they moved by more than about one, sample again.

## References

- [refinement_fitting_algorithms_knowledge](../../../knowledge/refinement_fitting_algorithms_knowledge.md) — §23, Bayesian posterior sampling: what a posterior gives that esds cannot, the likelihoods by data provenance, convergence evidence, esdRatio, and the literature (Fancher et al. 2016; McCluskey et al. 2023).

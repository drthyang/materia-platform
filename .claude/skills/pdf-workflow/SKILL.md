---
name: pdf-workflow
description: >-
  The user's real-space (small-box) refinement of a reduced pair distribution function G(r)
  in MATERIA: the long range first as the average baseline, then the correlated motion, then
  a local fit for a local distortion, and the symmetry last — driving the MATERIA PDF tools
  and the in-app Agent's PDF page. Use when the user asks to refine a PDF / G(r) dataset,
  decide what to free next on a PDF fit, or ask whether the local structure differs from the
  average one (boxcar scans). NOT for Rietveld (my-rietveld-workflow), magnetic PDF (mPDF),
  or big-box (RMC) modelling.
---

# PDF refinement workflow (MATERIA)

**Status: the user's method** (their interview, 2026-10-19): the order, the windows and the
goal. Where it is silent (occupancies, nanoparticles, the ADP tensor) the text is general
practice: ask before a judgment call it does not settle.

**The goal** is first to see whether the local structure differs from the average one.
Once that is known, finish and report.

The fit is a least-squares refinement of a structural model against G(r) over an r
window. Its agreement is **Rw**. The fit weights every point equally, so Rw is a relative
measure (compare fits of the same data, never across datasets), there is **no GoF**, and
the esds are not statistical — never quote them as Rietveld esds.

## Gates

The numbers and the stops in one place; each is explained at its stage below.

- **The data and the instrument first.** A reduction or convention that looks wrong (Qmax,
  the r range, a function other than G(r)): stop and ask.
- **Three windows, in order**: the long range (about 20–50 Å), the average baseline; down
  to the first peak (about 2–20 or 2–50 Å) for the correlated motion; the local range
  (about 2–10 or 2–15 Å). Start with these; change them by eye only when the fit shows a
  problem, and say why.
- **One block at a time**, each converged — `assess_refinement`'s largest shift below
  0.1 esd — with nothing at a bound. Never all the blocks together: the refinement is
  rarely stable. The user's strong advice, not a rule `refine` enforces.
- **Qdamp and Qbroad**: from a standard, held; at most refined at the very end for a small
  gain, and a large change is put to the user. With no standard, refined in the long range.
- **Firm rules** (`refine` refuses; only the user lifts one, with `allow_exception`):
  Qdamp and Qbroad never refine with the ADPs (alternate); no occupancy refines bare; no two
  free parameters that correlate at |ρ| ≥ 0.95.
- **One correlated-motion term** by default, δ1 or δ2; both only if the user asks, and
  never with `sratio`/`rcut`.
- **Rw** compares fits of the same data and window only; the esds are not statistical: a
  value that carries a conclusion gets its posterior.
- **Done** when the question is answered — the local structure the same as the average,
  or where it differs — then report.
- **Ask the user** before refining Qdamp or Qbroad against the sample, before a window
  this plan does not give, before lowering the symmetry, and on any judgment call this
  method does not settle. In the app, put such a decision
  with `ask_user`: one question, the options as you would say them; the change itself still asks.

## Stage 0 — Check the data and the instrument before the structure

1. The reduction sets what the fit can see: Qmax (real-space resolution, termination
   ripples), the r range, and the convention (G(r) here; see the reference if a file is in
   another). If the data card or `get_state` shows something unexpected, stop and ask.
2. **Qdamp and Qbroad describe the instrument**, not the sample. With a standard measured
   on the same instrument (Ni, Si; over MCP, `calibrate_qdamp`; in the app the user
   calibrates on the standard and loads its values), hold them: refined against the sample
   they absorb structure. Refine them at most at the very end, for a small improvement; if
   they move far from the standard's values, put it to the user. With no standard, they are
   refined in the long range (Stage 1). Never together with the ADPs (a firm rule in the
   app): Qbroad widens the peaks with r and Qdamp damps them with r, as the ADPs do, so each
   absorbs the other's error. The correlated-motion terms damp the near peaks too; the rule
   does not cover them, the correlation guardrail does.

## Stage 1 — The long range: the average baseline

Set the window (`set_fit_range`, which asks the user) to about 20–50 Å: beyond the near
neighbours, where the correlated motion no longer sharpens the peaks, so the fit sees the
average structure. The upper end is where the signal is still above the noise. Free each
block and refine (in the app, `set_free` then `refine`; over MCP, `refine_pdf`), and check
(`assess_refinement`) before the next:

1. **Scale + cell.**
2. **ADPs and positions**: one U per site (`get_state` gives the ADP model; a CIF with
   U_aniso columns loads a tensor per site even when the values are isotropic: switch with
   `set_adp_model` to isotropic first), and the positions the average group allows (the
   constrained coordinates, or the symmetry-mode amplitudes in irreps mode).
3. **Qdamp and Qbroad**, only with no standard, the ADPs fixed while they refine.

The result is the baseline the local fits are read against: note its window, its Rw, the
cell, the ADPs and the positions.

## Stage 2 — The correlated motion, down to the first peak

Widen the window to take in the near neighbours (about 2–20 Å, or 2–50 Å). Refine **one
correlated-motion term** with the scale, everything else held at the baseline: `delta2` at
low temperature, `delta1` at high (general practice; ask if unsure). Both only if the user
asks: `refine` refuses δ1 with δ2 when they correlate at |ρ| ≥ 0.95. Never with
`sratio`/`rcut`, which describe the same near-neighbour sharpening. A U going to 0 means the
near peaks are sharper than the model's: that is what this term is for, not a U of 0.

## Stage 3 — The local fit: positions at short range

Set the window to the local range (about 2–10 or 2–15 Å, smaller when the question is the
first shell). Fix the cell and the correlated-motion term; free the scale and the
**positions**, to see whether there is a local distortion. The ADPs stay held: free them
last and only a little, if the fit asks for it, and report how far they moved from the
baseline. A local distortion shows as **extra peaks** in the low-r residual (a split or a
shoulder the average model does not have) or as positions that move from the baseline. A
boxcar scan tells where across r it sets in.

## Local versus average structure — the boxcar scan

In the app, `boxcar_scan`; over MCP, `refine_pdf_boxcar`: the free parameters refined box by
box across r, each box seeded from the previous one. A parameter that drifts with r, or an
Rw that rises at low r, is the local-structure signal. Keep the free set small (scale, the
positions in question, the ADPs only if needed); a box holds less information than the
whole window. Pass it as the scan's own `free`: the page keeps its free set and its fit, so
the report afterwards matches them and carries the scan. When the question is a bond
length (a Jahn–Teller or off-centre distortion), name the site in `bonds`: each box then
gives that site's bond lengths in its own refined structure, so you compare lengths, not
coordinate shifts.

## The symmetry, last

Only once the local fit is done: when its extra peaks or positions cannot be fitted within
the average group, a lower symmetry is the next question — the user's, never yours to make.
A lower group is a new model, refined again from Stage 1.

## Occupancies and particle size (general practice)

**Occupancies last**, under the same guardrail as Rietveld: never bare; only with a site Σ
or a known composition tied (the PDF page holds a shared site's Σ by itself), or a second
contrast. `spdiameter` (the particle-size envelope) is for nanoparticles only, refined over
an r range that reaches the particle size. Heed the warnings `get_state` lists.

## When it's done

- **The question answered**: the local structure the same as the average, or where it
  differs (the window, the positions, the extra peaks) — then report.
- Rw stable when the window's ends move a little; nothing at a bound; no correlation
  refused or developed (the correlation guardrail of my-rietveld-workflow holds here too).
- Physical sanity: U_iso > 0, bond lengths and angles reasonable (`bond_geometry`).
- If the average structure is known (a Rietveld fit of the same sample), say where the
  local one agrees and where it differs.

Report each stage's window and Rw, the refined values with their (non-statistical) esds,
which terms were free in each, and whether Qdamp and Qbroad were held at the standard or
refined. When a value carries a conclusion (a local distortion, an ADP, a correlation
length), its posterior (`bayesian-check`; the noise scale is integrated out) is the better
uncertainty — approximate, since G(r) points are correlated.

In the app, `write_report` writes the analysis report once it is done: the page's numbers,
the History's steps, the checks and open issues, and your account in your own words, which
adds no number the tools did not give.

## References

Longer knowledge bases behind this method. Read one only when a question needs it.

- [`pdf_mcp_tool_map`](./mcp-tools.md) — the method's steps on the MATERIA MCP tools, for a fit driven over MCP.
- [`total_scattering_pdf_conventions`](../../../knowledge/total_scattering_pdf_conventions_knowledge.md) — which correlation function MATERIA fits (G(r)) and how it maps onto the other conventions in use, with the units, for importing and cross-checking data.
- [`refinement_fitting_algorithms`](../../../knowledge/refinement_fitting_algorithms_knowledge.md) — the least-squares engine: Levenberg–Marquardt, convergence and shift/esd, correlations and the SVD, restraints and esds.

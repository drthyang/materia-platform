# Skill interviews

A skill is the user's method in their own words (`.claude/skills/<name>/SKILL.md`),
read by the in-app Agent and by Claude Code alike. The Rietveld skill came from
interviewing its user; this page is the guide for the next interviews. Each
answer lands in one of three places:

- **the skill's text** — the order, the judgement calls, what to report;
- **code** — a firm rule the app enforces (`src/agent/method.ts`: refused
  until the user lifts it), or a stage of the method's checklist;
- **an eval scenario** (`src/agent/evals/scenarios.ts`) — a request the user
  makes and what a right answer does, so a later change cannot quietly break
  it.

Where each skill stands:

| Skill | Status | Interview |
| --- | --- | --- |
| `my-rietveld-workflow` | The user's method, from their interview | done |
| `symmetry-review` | The user's rule (the space group last, on evidence); the detail is drafted | [§4](#4-symmetry-review-symmetry-review-the-users-rule-drafted-detail) |
| `magnetic-analysis` | Draft from the app's workflow and the knowledge base | [§1](#1-powder-magnetic-structure-magnetic-analysis-draft) |
| `pdf-workflow` | Draft: general small-box practice | [§2](#2-pdf-pdf-workflow-draft) |
| `sc-workflow` | Draft: general single-crystal practice | [§3](#3-single-crystal-sc-workflow-draft) |
| `bayesian-check` | Draft: general practice, with the dev runs' examples; its text does not yet say it is a draft | [§5](#5-the-bayesian-check-bayesian-check-draft) |

A skill becomes the user's method when they have answered its interview and
seen the diff; until then the skill's status line says it is general
practice, and [VALIDATION.md](./VALIDATION.md#skills-arm-b-reads) says which
results it governs.

How to run one: ask a few questions at a time, starting from the draft where
there is one ("the draft says X — is that how you do it?"); ask for a recent
dataset the method was used on, and for one time it went wrong. Write the
answers into the skill in the user's terms, mark what is a firm rule, and add
a scenario for each failure they describe. Then show them the diff.

## 1. Powder magnetic structure (`magnetic-analysis`, draft)

The draft follows the app's workflow and the knowledge base. To confirm:

1. Before the magnetic step: must the nuclear structure come from data above
   the ordering temperature, or do you refine it on the ordered data? Which
   nuclear parameters stay fixed while the moments refine?
2. Finding k: do you trust the k-search, index by hand, or start from a known
   k (literature, a single-crystal result)? When several k fit a few
   satellites, how do you choose?
3. Groups or irreps: do you work with magnetic space groups (BNS) or with
   irreducible representations (SARAh / BasIreps style)? Always top-down from
   the maximal groups?
4. Choosing among groups the powder cannot tell apart: what decides — the
   fewest parameters, a single irrep, physics (anisotropy, a known moment
   direction in a related compound), another probe?
5. Moments: which ties do you use by default (equal moments on one element,
   one moment on a mixed site)? When do you allow a moment to differ between
   sublattices?
6. Checks you always make: the moment against the free-ion value, the form
   factor (which one: spin-only, ⟨j0⟩ + ⟨j2⟩ for rare earths), the ordering
   temperature trend?
7. Joint refinement: the order you free nuclear and magnetic parameters in,
   and what you hold fixed (scale against the moment?).
8. What you report, and what you refuse to report (a direction a cubic powder
   cannot fix; a domain population).
9. Firm rules: anything the Agent must never do on this step without asking you?

## 2. PDF (`pdf-workflow`, draft)

1. Instrument resolution: always Qdamp/Qbroad from a standard measured that
   day (Ni, Si), or refined on the sample when no standard exists?
2. The r range you fit by default, and when you fit a short range only.
3. One correlated-motion term: δ2 at low temperature, δ1 at high — your rule,
   or do you decide from the fit?
4. ADPs: isotropic first, anisotropic when? The same ADP for one element?
5. Boxcar scans: box width and step you use; what spread counts as the local
   structure differing from the average?
6. Nanoparticles: when do you free spdiameter, and with which shape?
7. What makes a PDF fit "done" for you (Rw alone is relative)?
8. Firm rules for the PDF page.

## 3. Single crystal (`sc-workflow`, draft)

The draft is general practice: SHELXL's order and checks as the page carries
them. To confirm:

1. Data: the draft reads the radiation first and asks when the file does not
   say. Which integration and absorption correction do you trust, and when do
   you reject data (a batch, a detector region) before refining?
2. Outliers: the draft omits one failed measurement at a time, by its indices
   and batch, after comparing it with its equivalents, and never by a σ
   cutoff. Is that your rule? Where do you draw the line between a failed
   measurement and the model's misfit?
3. The order: scale, then extinction; positions with the hydrogens riding;
   isotropic, then anisotropic when the data allow; occupancy only for a
   reason. Is that yours, and what tells you the data allow anisotropic ADPs?
4. Weights: the draft sets SHELXL's suggested scheme last, once the model is
   complete. Do you, or do you keep w = 1/σ² or a fixed published scheme?
5. Twinning and pseudo-symmetry: how you look for them, and when.
6. Done: the draft's criteria (shifts well below their esds, nothing at a
   bound, ADPs positive definite, bonds as the chemistry expects, the open
   questions named). What would you add: residual density, checkCIF alerts
   you accept?
7. Absolute structure: Flack, Parsons or Hooft, and what you report when the
   hand is not determined.
8. Magnetic single-crystal data: the same skill, or its own?
9. Firm rules: anything the Agent must never do on this page without asking.

## 4. Symmetry review (`symmetry-review`, the user's rule, drafted detail)

The rule is already the user's: the space group is changed last, when
everything else is refined. To make it theirs in detail:

1. What counts as "everything refined" for you — the stages in the checklist,
   or also corrections (texture, absorption) and a second phase?
2. The evidence you want before lowering the symmetry: forbidden reflections
   at what significance; split peaks; the misfit pattern?
3. How you test a lower group: refine it from the start, or start from the
   high-symmetry result with the distortion modes? The statistical test you
   use (Hamilton, an F-test, none)?
4. When you would rather report an open question than a lower symmetry.

## 5. The Bayesian check (`bayesian-check`, draft)

The draft is general practice, with the dev runs' examples (Cr₂WO₆'s two
routes). To confirm:

1. When you run it: the draft's five triggers (an esd as large as the value,
   a parameter on a bound, a correlated pair kept free, path dependence, a
   claim resting on one number). Do you run it on every final refinement, or
   only on these?
2. What to free: the draft frees the parameters in question and their
   correlated partners and fixes the profile, background, cell and zero. Is
   that your set?
3. Convergence: R̂ < 1.05 and an ESS of at least max(100, 10 per free
   parameter). Are these your thresholds?
4. Reading: the draft quotes value(esd) when the posterior width is 0.67–1.5
   esd, the median with its 68 % interval beyond that, and a one-sided limit
   at a bound. Do you quote 68 % or 95 % intervals?
5. Two values that may differ: the draft calls them different only beyond a
   probability of 0.975, and ties them otherwise. Is that your rule?
6. Priors and the noise model: uniform within the bounds, the σ scale
   integrated out. Would you ever use another prior?
7. What goes in the paper, and what stays in the notes.


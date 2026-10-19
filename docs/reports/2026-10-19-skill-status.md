# Which skills are the user's method

Pull request [#94](https://github.com/drthyang/web-refinement/pull/94),
branch `claude/plan-5-6`, on `main`, 2026-10-19. Plan:
[AGENT_PLAN.md](../AGENT_PLAN.md), 5.6 (SKILL_INTERVIEWS brought up to date:
single crystal has a draft skill; bayesian-check joins the list; the
validation report says which skills are the user's method and which are
drafts).

## What changed

- **[SKILL_INTERVIEWS.md](../SKILL_INTERVIEWS.md)** opens with each skill's
  status:
  - `my-rietveld-workflow` is the user's method, from their interview.
  - `symmetry-review` is the user's rule (the space group last, on evidence)
    with drafted detail.
  - `magnetic-analysis`, `pdf-workflow`, `sc-workflow` and `bayesian-check`
    are drafts.
- The single-crystal section said "no skill yet". Its questions now start
  from the `sc-workflow` draft, as the guide asks ("the draft says X — is that
  how you do it?"): the radiation read first, one failed measurement omitted
  at a time and never by a σ cutoff, the order of the stages, the weights
  last, the done criteria, the hand.
- `bayesian-check` gets its own interview: the five triggers, the free set,
  the convergence thresholds, 68 % or 95 % intervals, the 0.975 rule for two
  values, the priors.
- **[VALIDATION.md](../VALIDATION.md#skills-arm-b-reads)** gains "Skills arm B
  reads".
  - Every case is a powder pattern. Arm B must read `my-rietveld-workflow`,
    the page's method (the executor enforces it), and may read
    `symmetry-review` and `bayesian-check`.
  - A B result on the first measures the user's method. On the symmetry
    review it measures the user's rule, with general-practice detail; on the
    Bayesian check it measures general practice.
  - No case runs on the PDF or single-crystal page, and none has a magnetic
    phase.
  - Results keep the status they ran under when a skill later becomes the
    user's.

## Evidence

- The statuses are taken from:
  - each skill's own status line (`pdf-workflow` and `sc-workflow`: "general
    practice, not yet the user's method"; `magnetic-analysis`: "a first
    draft");
  - SKILL_INTERVIEWS' account of the Rietveld interview and of the symmetry
    rule;
  - `PAGE_METHOD` in `src/agent/skills.ts` for which skill each page must
    read.
- `bayesian-check` carries no status line. Nothing in its history records an
  interview, so it is listed as a draft.

## What changes for users

Only documentation. No skill text, tool or code changes.

## What it means for the validation

The arms, the cases and the scoring are unchanged. The reported B numbers
now say which method they measure.

## Not done

- `bayesian-check`'s text does not say it is a draft, as the other drafts'
  texts do. Adding that line is a skill change and waits for the user (with
  #63's skill drafts, or on its own).
- The interviews themselves are the user's to give.

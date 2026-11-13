# Device QA: layout fixes for phones, tablets and a docked Copilot

A pass over the live site (0.5.0, main at `56fffb2`) on phone, tablet and
desktop sizes found five failures and a handful of small cuts. This change
fixes them. The project is in a feature freeze: the change is layout and
display only. Nothing the model reads, no tool definition, no numeric and no
snapshot baseline changes.

Only the two bundled public demos were used (Mn₃Ga neutron TOF, GaTa₄Se₈
X-ray G(r)).

## What changed, and why

- **The local-demo probe runs in development builds only**
  (`src/app/localDemoGate.ts`, `src/app/App.tsx`). Every page load of the
  production site asked for `data/local-paths.json`, got a 404 and logged a
  console error. The module that probes for a developer's local data folder
  is now loaded only when `import.meta.env.DEV` is set. The gate is a
  build-time constant, so the production bundle carries neither the request
  nor the module.
- **The parameter table keeps its columns apart**
  (`src/app/ui/ParameterPanel.tsx`). Header and rows share one template,
  `minmax(0, 1fr) 88px 62px 56px` with a 6 px gap (was
  `1fr 104px 62px 62px`, no gap). With the Copilot docked (1210×834,
  1280×720) the label ran into the value box and the esd touched the "free"
  chip; on a phone the esd sat about 3 px from the chip.
- **The moment field shows its value whole**
  (`src/components/KSearchPanel.tsx`). In step 5 of the magnetic analysis the
  field cut a refined amplitude, which is stored as a 16-digit float. The
  field is 96 px wide and shows four decimals at rest and the stored value on
  focus. This is a display rule: the stored amplitude is never rounded.
- **A step title wraps** (`StepTitle` in `KSearchPanel.tsx`). The right-hand
  text of a step's title ("P6₃′/m′m′c · index 2") was cut at 402 px.
- **A subgroup tree row keeps its count**
  (`src/app/ui/SubgroupsPanel.tsx`). At 402 px a row cut "· N below" mid-word.
  The cell fact now shortens with an ellipsis (its full text in `title`), and
  the count is outside the clipped part.
- **Card titles wrap to two lines** (`cardHeadLabel` in `src/app/theme.ts`).
  "BAYESIAN POSTERIOR — FREE PARAMETERS" was cut mid-word on a phone.
- **The posterior table shows that it scrolls sideways**
  (`.wb-posterior-table` in `src/app/workbench.css`). On a phone the table is
  wider than its card, and nothing said so. An edge shadow marks a side that
  has more.
- **The reason "Magnetic PDF →" is disabled is behind a "?" badge**
  (`src/app/PdfWorkbench.tsx`). The reason was a hover title, which a touch
  user cannot open. The badge shows the same string. The string is used only
  by this page's UI; the Agent does not read it.

## Evidence

- **Tests.** `src/app/localDemoGate.test.ts`: with `DEV` off the gate is
  null and no fetch is made; with `DEV` on there is one fetch and a 404 reads
  as "not available". `src/components/momentShown.test.ts`: the rounding
  rule of the moment field.
- **The production bundle.** After the change it holds no occurrence of
  `local-paths.json`, `localMagneticDemo`, "Local magnetic demo" or the local
  demo's file names. All were in the bundle built from main.
- **Device runs** (Playwright 1.61.1 against `vite preview` of this branch;
  the same script as the run on the live site). WebKit at 402×874, 440×956,
  834×1210, 1210×834 and 1440×900 passes every step with no 404 and no
  console error. Chromium at 1280×720 and 1440×900 passes with only headless
  GPU warnings. The demo fits are unchanged: wR 4.24 % (Mn₃Ga), Rw 8.12 %
  (GaTa₄Se₈).
- **Measured gaps in the parameter table** (WebKit). Copilot docked at
  1210×834: label column 77 px, label to value box at least 10 px, labels not
  cut. Esd to chip at least 8.6 px on every size (was about 3 px, or
  touching). Phone label column 103 px (was 99 px).
- **Looked at, at native pixels**: the moment field at 402 px (WebKit) and
  1440 px (Chromium), the tree rows and the step title at 402 px, the
  posterior table's edge shadow and the card title at 402 px, the "?" badge
  beside the disabled button.

The last strengthening of the edge shadow (CSS only) was re-run on the
402×874 case alone.

## What changes for users

- No failed request and no console error on loading the live site.
- With the Copilot open, and on a phone, the parameter table's label, value,
  esd and chip no longer touch.
- A refined moment reads "0.415" at rest and in full when the field has
  focus.
- Tree rows, step titles and card titles are no longer cut mid-word on a
  phone.
- A touch user can see that the posterior table scrolls, and why
  "Magnetic PDF →" is disabled.

## What it means for the validation

Nothing moves. No snapshot file changed, the local gate in `src/agent` passes
unchanged, and no golden moved.

## Not done

- **Firefox** was not tested; it could not be launched in the test setup.
- **Known and left alone in the freeze**: touch-target sizes, the empty space
  in the 3D and demo cards, legend wrapping, ranked-row wrapping, and the
  Copilot's layout on a phone in landscape.
- Also seen, not changed: the posterior interval wraps at 440 px, and the
  Subgroups toolbar's spacing.

## Checks

- `npm run build`: passes.
- `npm run lint`: passes.
- `npm test`: 403 files pass and 35 are skipped; 3552 tests pass and 324 are
  skipped.

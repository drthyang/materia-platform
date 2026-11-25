# Layout pass 2: three cards on every page, a header that keeps its room, touch sizes

The second half of the v0.5.0 layout review (THY-69; items 1–8 and the
Structure card shipped in [#155](https://github.com/drthyang/materia-platform/pull/155)).
Layout, CSS and component structure only. Nothing the model reads changed: no
tool name or description, skill or knowledge text, Copilot result text,
`get_state` output or report text. No number changed, and no control's
behaviour, value, label or the state it writes.

Only the bundled public demos (Mn₃Ga neutron TOF, GaTa₄Se₈ X-ray G(r)) and the
eval suite's synthetic corundum (`scripts/write-corundum-sc.ts`) were used.

## Review first

Each item was looked at on `main` (`0578a85`, the production build under
`vite preview`) at 1600×900, 1280×800, iPad Pro 11 upright (834×1194) and held
sideways (1194×834), and iPhone 13 (390×844), in Chrome through
`playwright-core`. All thirteen reproduced, though two only in a narrower
form than the review's line:

- **Item 8** (the Copilot's name under its settings gear) did not reproduce
  in the iPad's upright sheet, which has room. It reproduced at the docked
  drawer's narrowest, 320px, which an iPad held sideways reaches: the Beta
  badge ran under the gear.
- **Item 9** (toggle labels wrapping inside their buttons at 1280px with the
  Copilot open) was found by measuring every button's text lines on every
  tab: the Boxcar plan's "low → high r" and "high → low r" broke in two. No
  other segmented control did.

## What changed, and why

1. **Three cards on every page** (`PdfWorkbench.tsx`,
   `SingleCrystalWorkbench.tsx`, `ui/SummaryCards.tsx`, `workbench.css`).
   The PDF page gets an **Instrument** card: Qmax from the data file, and the
   current Qdamp and Qbroad values (formatted as the parameter table formats
   them). The Qdamp and Qbroad rows still refine in the parameter table's
   Instrument group; Qmax leaves the Data card's line, so it is said once. The
   single-crystal page gets a **Data settings** card (item 2). The
   single-crystal working row takes the powder and PDF pages' 2 : 1 split
   (`repeat(3, 1fr)`, the first card two columns), so its edges line up with
   the cards above (it was 1.7 : 1, off by about 60px at 1280). A summary card
   may now have no load button; an invisible box of the button's size keeps
   its title on its neighbours' line.
2. **The single-crystal settings out of the Data card.** Source, mode, λ,
   extinction and WGHT (with suggest) move, unchanged, into Data settings:
   the same components, handlers, labels, tooltips and values. At 1280×800
   the Fo²/Fc² plot and the 3D model now start about 60px higher, the top
   row one card high; at 1600×900 both are whole above the fold.
3. **One split for Subgroups' Tree and List** (`ui/SubgroupsPanel.tsx`):
   `1.25fr : 1fr` for both (they were 1.4 : 1 and 1 : 1.05), so the detail
   pane no longer jumps sideways on a switch.
4. **Back / forward stay in the header** (`workbench.css`). They folded into
   the History popover at a 1280px shell although the row had room. Measured
   with them forced on: the one-row header holds them down to a 1101px shell
   (29px to spare at 1136), and the two-row band below has room too. They now
   fold only on a phone (≤700px), where the menus fill their row. Header
   heights at every width from 390 to 1600px are unchanged (75 / 117 / 133px
   with a mouse); on touch the pair is now the menus' 44px (it stood 2px
   taller).
5. **The current-step label takes two lines** (`ui/WorkbenchHeader.tsx`,
   `ui/HistoryPanel.tsx`, `workbench.css`). "Loaded corundum.int" and
   "Mn₃Ga + MnO POWGEN demo" were cut at 1600px; the label now wraps to two
   lines before it is cut, and its whole text is the chip's tooltip. The
   History list's rows keep one line.
6. **The data start under the legend** (`ui/WorkbenchPlot.tsx`). On the
   magnetic page's narrower pattern the legend row sat on the top y label
   ("1k") and the tallest peak ran through it. The y scale now starts under
   the legend's last row (and under the found-peak row when there is one), on
   every pattern plot. The x layout and the bands below the data are
   unchanged.
7. **Touch sizes** (`workbench.css`, coarse pointer only). A summary card's
   load button keeps its drawn size, its 44px hit area overhanging the card's
   padding, so the card's head is one line high instead of a menu button
   tall. A parameter group's head is 44px (was 61px: the "all" check's 44px
   label plus padding). The History steps (26px rows whose 44px buttons
   overlapped the next row) and the Subgroups list and tree rows (27px) are
   44px.
8. **The Copilot's head** (`agent/ui/AgentDrawer.tsx`, `workbench.css`): the
   name and Beta wrap (Beta under the name) and the name ends in an ellipsis
   before it reaches the settings and close buttons, which keep their size.
9. **A segment never wraps its own label** (`ui/SegmentedToggle.tsx`): a
   track short of room puts whole segments on a second line instead.
10. **Phone: the summary cards are one row that scrolls sideways**
    (`workbench.css`, below a 560px shell). Each card is 86% of the column so
    the next one peeks in, and the row snaps card by card. The plot moves up
    about 350px. A card the Copilot names still scrolls into view (its
    `scrollIntoView` scrolls the row too).
11. **Phone: the view tabs at one height** (`PowderWorkbench.tsx`,
    `PdfWorkbench.tsx`). The wR / GoF and Rw figures' line box was 2px taller
    than the title's, so the tabs sat 2px lower on those views; the figures
    now have line height 1. Measured on the iPhone 13: the tab strip starts
    20px under the title row on every view of both demos (22 or 20 before).
12. **The landing on an upright tablet or phone** (`PowderWorkbench.tsx`,
    `workbench.css`): the demo box takes its content's height instead of
    filling the column (about 650px on the iPad, the demos floating in its
    middle). Landscape screens keep the filled box.
13. **Phone tree rows** (`ui/SubgroupsPanel.tsx`): after the cell, the
    "n dom" and "n below" facts give way with an ellipsis, so they no longer
    run under the irrep badge, which the row then clipped.

## Evidence

- **Before and after**, the same scripted runs against `vite preview` of
  `main` and of this branch, at the five sizes above; the screenshots, one
  pair per item, are in the owner's local review folder (not in the repo).
- **Measurements** (the same scripts): header height and whether back /
  forward show at 17 widths, mouse and touch; the tab strip's offset on every
  view of both demos on the phone; row heights on the iPad (parameter group
  head 61 → 45px, Subgroups rows 27 → 44px, History rows 26 → 44px); the
  Copilot's name against the gear at the drawer's 320px; every button whose
  own text wraps, on every tab with the Copilot open at 1280px.
- **No horizontal scroll** on the phone (scroll width 390px of 390 on every
  page), **no console error or warning** in any run.

## What changes for users

The layout only: the third card on the PDF and single-crystal pages, the
single-crystal settings in their own card, back / forward in the header on a
laptop and tablet, a two-line step label, plots whose data start under the
legend, larger touch rows and smaller card heads on a tablet, and a sideways
row of source cards on a phone. Nothing the Copilot, MCP or a report reads.

## What it means for the validation

Nothing: no engine, golden, snapshot or model-visible text moved.

## Not done

- **The phone header keeps three rows** (brand; History, Save, Open, Close,
  Export; the technique and step chips with GPU). The menus (about 280px) and
  the chips (about 330px) each fill a 358px row, so a two-row header needs a
  structural choice: folding Save / Open / Close into one menu, or dropping
  the Rietveld | PDF indicator on a phone (the Data card and the plot's title
  say the same). Left for the owner.
- **The Copilot's card highlight on the single-crystal and PDF pages.** A
  card answers the Copilot's focus by its label in lower case, so "Data ·
  single crystal" and "Data · PDF G(r)" never matched the `data` focus that
  `set_radiation` and `set_extinction_model` name (before this change too);
  the new Data settings card does not match it either. The PDF page's new
  Instrument card does match `instrument`, as the powder page's does. Mapping
  the two data cards (and Data settings) to `data` is a small UI change, left
  for the owner since it changes what lights up during a Copilot run.

## Checks

`npm run build`, `npm run lint` and `npm test` at the branch head (see the
pull request).

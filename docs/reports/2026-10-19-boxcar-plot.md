# The boxcar plot gets the card

Branch `claude/tender-clarke-dov72x`, on `main`, 2026-10-19. A user report:
the boxcar result figure is squeezed and hard to see, and then that the
layout is broken on a phone in portrait. Phases 1, 2 and 4 of the plan made
for it: free height for the figure, use the figure's height better, and the
stacked layout. Phase 3 (an expanded view) is not in this change.

## What changed, and why

Measured before the change (the GaTa₄Se₈ demo's scan, 22 boxes of 5 Å), the
figure got 150 px of a 469 px card on a 1280×800 window, its minimum height,
and the track itself about 50 px of that: the plan bar, the toolbar, the chip
row and a caption line took ~245 px above it, the table took 2/5 of the rest,
and inside the figure a fixed 54 px Rw strip and 46 px of margins took the
remainder.

| Change | What it answers |
| --- | --- |
| **The plan folds after a run** into a one-line summary in the toolbar (`5 Å box · 1 Å step · low → high r · 22 boxes`), which opens the plan bar again. It stays open before the first run and while the plan cannot run | A two-line plan bar above every result, though it describes the next scan, not the one on screen |
| **The run's caption moves into the chip row**, beside the legend | A line of its own under the table |
| **The per-box table opens on demand** (`▸ box table`); closed, the plot takes the whole region | The plot and the table split 3 : 2 whatever the card's height |
| **A box is picked on the plot**: point at it for a card with its window, value ± esd, Rw and status; click it (or step with ← →, Esc to clear) to pick it. The line under the plot reads the picked box with its **Adopt** buttons; its row is highlighted in the table, and a table row picks it too | Adopt only in the table; the values only in the table or a slow native tooltip on a 3 px dot |
| **Export CSV beside Run**, the folded plan after it | On a phone the plan's summary took Run's row and pushed Export to a third |
| **One r axis** under the Rw strip, with r gridlines through both panels; the end boxes sit 10 px inside the axes | r ticks between the panels and the r title under the strip, 34 px of margin for it in the value panel |
| **The Rw strip scales** with the figure (20 % of it, 40–84 px) and has a labelled scale (`positiveTicks`); bars widen with the box spacing (4–16 px) and flag a diverged box | A fixed 54 px strip with no scale, 6 px bars whatever the spacing |
| **Ticks follow the room**: one y gridline per ~45 px, one r tick per ~80 px | Four y ticks and five r ticks at any size |
| **The figure stays mounted** when a track has no value yet | Its size observer was attached only if the first render drew the plot, so a track whose first boxes produced no value kept the 620×300 fallback (found reading the code, not reproduced) |

The layout math is `app/ui/boxcarLayout.ts`, pure and tested; the panel is
`app/ui/BoxcarPanel.tsx`.

### On a phone in portrait

Measured before the change on a 390×844 phone (Playwright, touch, the
Copilot rail frame): the shell scrolls, but the content column (`.wb-main`)
kept its desktop `min-height: 0` and was held to the shell's leftover (565 px
for 1065 px of content). The cards ran past it, and the footer, which follows
the column's box, sat at 769 px, across the PDF plot card (and between the
powder page's cards). On the PDF page the working row sits in the step's
`auto 1fr` grid, so its 1fr row was that leftover too: the plot card stayed at
its 380 px floor with 130–156 px of its content over the parameter card.

| Change | What it answers |
| --- | --- |
| **The column grows to its content** where the page scrolls as one document (`min-height: auto` in the whole-page scrolling query) | The footer across the cards on every page; the PDF plot card held to 380 px |
| **The boxcar figure gets a height of its own** when the cards stack: `clamp(220px, min(75vw, 80vh), 440px)` (`.wb-boxcar-plot`) | A stacked card takes its content's height, so the plot had no leftover to grow into and sat at its 160 px floor |
| **An open box table at its natural height** when stacked (`.wb-boxcar-table`) | A table scrolling inside a card inside a scrolling page |
| **The picked-box line wraps whole** to its own row on a phone (`flex: 1 1 280px`) | Squeezed beside the table toggle into a column a few words wide |
| **A view switcher that wraps fills the card's width**, its segments growing (`.wb-seg` with four or more segments, at a shell ≤ 520 px) | At 360 px, Boxcar alone on a second row of the card's view tabs |

## Evidence

- **Measured in the built app** (Playwright, Chromium, the demo's scan, the
  figure's bounding box):

  | Window | Figure before | Figure after | After, table open |
  | --- | --- | --- | --- |
  | 1920×1080 | 288 px | 561 px | 331 px |
  | 1440×900 | 194 px | 405 px | 237 px |
  | 1280×800 | 150 px | 313 px | 182 px |

  At 1280×800 the value panel is 194 px of the 313 (`trackLayout`), against
  ~50 px before. The card's content stays inside the card (scroll height
  equals client height) at all three sizes for one direction, and at
  1440×900 for both.
- **The interactions**, in the same run: the hover card names the box under
  the pointer and opens away from its point; a click shades the box's
  r-window and fills the readout; the table opens with the picked row
  highlighted and its header kept in view; the plan summary opens the plan bar.
  Both directions show paired bars, both passes in the card and the readout,
  an Adopt per pass and the gap in σ. No page error.
- **On phones and tablets** (touch, after a scan; card, figure, footer):

  | Window | Figure | Card overflow | Footer below the content |
  | --- | --- | --- | --- |
  | 390×844 portrait | 160 → 293 px | 130 → 0 px | yes (was across the card) |
  | 360×780 portrait | 270 px | 0 | yes |
  | 820×1180 iPad portrait | 440 px | 0 | yes |
  | 844×390 landscape | 312 px | 0 | yes |

  With the table open the card grows to hold it (0 overflow), and no page
  scrolls sideways. The PDF Refinement tab's card now holds its plot (547 px,
  0 overflow, was 380 px with 156 px over), and the powder page's footer
  follows its parameter card. The desktop measurements above are unchanged
  after these rules.
- **The layout's rules** (`app/ui/boxcarLayout.test.ts`): the panels never
  overlap; the value panel keeps ≥ 60 px at the 160 px minimum and ≥ 160 px at
  the laptop height; the strip's bounds; tick counts by size; the spacing,
  bar slot and pick reach; an Rw scale tick above zero where one interval
  rounds past the maximum.

## What changes for users

After a run the plan is a summary in the toolbar (click it to edit the next
scan), the table is behind `▸ box table`, and Adopt is under the plot for the
picked box (still in the table too). On a phone the footer follows the cards
on every page, the Boxcar figure is a readable size, and the PDF Refinement
tab's plot no longer runs over the parameters. The scan, its results, the CSV,
the project file and the Agent's tools are unchanged.

## What it means for the validation

Nothing: no computation changed.

## Not done

- **Phase 3**, an expanded view of the figure.
- On a phone the "?" of the Boxcar toolbar can take a row of its own, and the
  PDF Refinement tab's G(r) plot is cramped (the shared plot component, not
  this change).

## Checks

Before merging `main` (#75): `npm run build`, `npm run lint`, `npm run
typecheck` and `npm test` pass, 2371 tests, 265 skipped (live runs and
data-dependent suites).

With `main` merged: build, lint and typecheck pass. `npm test`: 2380 passed,
265 skipped, and 3 timed out on a loaded machine (the suite took 20 min, not
3.5, and the build inside one test 3 min, not 6 s). Each passes when run
again: the loop guard (1.8 s), the production build (33 s), and the
`vite.config` import (1.9 s here, 0.5 s on `main`). None of them touches this
change's files.

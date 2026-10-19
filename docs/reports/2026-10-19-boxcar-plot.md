# The boxcar plot gets the card

Branch `claude/tender-clarke-dov72x`, on `main`, 2026-10-19. A user report:
the boxcar result figure is squeezed and hard to see. Phases 1 and 2 of the
plan made for it: free height for the figure, then use the figure's height
better. Phase 3 (an expanded view) and phase 4 (the stacked phone layout) are
not in this change.

## What changed, and why

Measured before the change (the GaTa₄Se₈ demo's scan, 22 boxes of 5 Å), the
figure got 150 px of a 469 px card on a 1280×800 window, its minimum height,
and the track itself about 50 px of that: the plan bar, the toolbar, the chip
row and a caption line took ~245 px above it, the table took 2/5 of the rest,
and inside the figure a fixed 54 px Rw strip and 46 px of margins took the
remainder.

| Change | What it answers |
| --- | --- |
| **The plan folds after a run** into a one-line summary beside Run (`5 Å box · 1 Å step · low → high r · 22 boxes`), which opens the plan bar again. It stays open before the first run and while the plan cannot run | A two-line plan bar above every result, though it describes the next scan, not the one on screen |
| **The run's caption moves into the chip row**, beside the legend | A line of its own under the table |
| **The per-box table opens on demand** (`▸ box table`); closed, the plot takes the whole region | The plot and the table split 3 : 2 whatever the card's height |
| **A box is picked on the plot**: point at it for a card with its window, value ± esd, Rw and status; click it (or step with ← →, Esc to clear) to pick it. The line under the plot reads the picked box with its **Adopt** buttons; its row is highlighted in the table, and a table row picks it too | Adopt only in the table; the values only in the table or a slow native tooltip on a 3 px dot |
| **One r axis** under the Rw strip, with r gridlines through both panels; the end boxes sit 10 px inside the axes | r ticks between the panels and the r title under the strip, 34 px of margin for it in the value panel |
| **The Rw strip scales** with the figure (20 % of it, 40–84 px) and has a labelled scale (`positiveTicks`); bars widen with the box spacing (4–16 px) and flag a diverged box | A fixed 54 px strip with no scale, 6 px bars whatever the spacing |
| **Ticks follow the room**: one y gridline per ~45 px, one r tick per ~80 px | Four y ticks and five r ticks at any size |
| **The figure stays mounted** when a track has no value yet | Its size observer was attached only if the first render drew the plot, so a track whose first boxes produced no value kept the 620×300 fallback (found reading the code, not reproduced) |

The layout math is `app/ui/boxcarLayout.ts`, pure and tested; the panel is
`app/ui/BoxcarPanel.tsx`.

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
- **The layout's rules** (`app/ui/boxcarLayout.test.ts`): the panels never
  overlap; the value panel keeps ≥ 60 px at the 160 px minimum and ≥ 160 px at
  the laptop height; the strip's bounds; tick counts by size; the spacing,
  bar slot and pick reach; an Rw scale tick above zero where one interval
  rounds past the maximum.

## What changes for users

After a run the plan is a summary beside Run (click it to edit the next scan),
the table is behind `▸ box table`, and Adopt is under the plot for the picked
box (still in the table too). The scan, its results, the CSV, the project file
and the Agent's tools are unchanged.

## What it means for the validation

Nothing: no computation changed.

## Not done

- **Phase 3**, an expanded view of the figure.
- **Phase 4**, the stacked layout (phones, portrait tablets). The card there is
  capped at 380 px and the panel's content still runs past it (178 px on a
  390×844 phone, about as before): the card should grow to its content when
  the page stacks.

## Checks

`npm run build`, `npm run lint`, `npm run typecheck` and `npm test` pass at the
branch head: 2371 tests, 265 skipped (live runs and data-dependent suites).

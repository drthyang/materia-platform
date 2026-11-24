# Export for a MOTIF figure, and a cross-check of what MOTIF reads

MOTIF is the author's separate app for publication-quality crystal-structure
figures. It reads CIF, magnetic CIF (mCIF) and ISODISTORT mode CIFs. The
owner decided (2026-11-24) that MATERIA hands a refined structure to MOTIF as
a standard file, with no new format and no change to MATERIA's own 3D view.
A live "Open in MOTIF" button waits until MOTIF is published, so no MOTIF
address appears anywhere.

## What changed, and why

- **One Export entry, "For a MOTIF figure…"**, on the powder, PDF and
  single-crystal pages (`src/app/forMotif.ts`, wired in `App.tsx` and each
  workbench). It writes one file with the page's existing exporters:
  - a subgroup child in force whose modes go by parent irrep: the ISODISTORT
    mode CIF (`modeCifOf`, PDF page);
  - otherwise, a magnetic model with moments: the mCIF
    (`magneticStructureToMcif`, the magnetic cell for k ≠ 0);
  - otherwise: the refined CIF (`structureToCif`).
  It writes the first phase. Its **?** gives one line: which file it writes,
  that MOTIF opens it for a publication figure, and what is left out (other
  phases; moments on the single-crystal page, which has no mCIF export; an
  incommensurate modulation; the mode displacements when a magnetic model and a
  subgroup child are both on).
- **The header's Export menu takes a "?" per entry** (`ExportAction.help`,
  `WorkbenchHeader.tsx`), read when the menu opens so it follows the page. A
  click on the "?" does not start the download.

## Evidence: the cross-check

A private script, kept outside both repositories, ran MATERIA's own export
code on public or synthetic structures, read each file with MOTIF's own
reader (`readCif`, then its expansion of the atoms of one cell) and compared,
atom by atom, with MATERIA's own expansion of the model:

- atoms: element, label, occupancy and Cartesian position of every atom MOTIF
  builds in the cell, against `expandStructureAtoms` (nuclear, mode child) or
  `expandSpinField` (magnetic: the box the 3D view and the mCIF writer share);
- moments: every moment on every atom of the magnetic cell, as crystal-axis
  components and as a Cartesian vector, against MATERIA's `displayMoment`
  (the time-reversal sign included);
- displacements: every displacement MOTIF draws against the child's position
  less the undistorted (parentized) one, carried by each operation's rotation.

Tolerances follow the printed precision. The CIF and mCIF print fractional
coordinates to 5 decimals, cell lengths to 5 and angles to 4, moments and
occupancies to 4: positions within 6·10⁻⁶·(a + b + c) + 3·10⁻⁵ Å (1–2·10⁻⁴ Å
here), moments within 10⁻⁴ µB. The mode CIF prints full precision: 10⁻⁹. Each
file was also drawn once by MOTIF's renderer (headless SVG); all drew without
error.

| Case | Files | Atoms (max Δ) | Moments (max Δ) | Displacements (max Δ) | Result |
| --- | --- | --- | --- | --- | --- |
| a. Mn₃Ga demo, phase 1 (Mn₃Ga), CIF | 1 | 3.4·10⁻⁵ Å | — | — | pass |
| a. Mn₃Ga demo, phase 2 (MnO), CIF | 1 | 1.3·10⁻⁶ Å | — | — | pass |
| a. GaTa₄Se₈ PDF demo, CIF | 1 | 7.4·10⁻⁶ Å | — | — | pass |
| b. Mn₃Ga 350 K refined mCIF (published), loaded and written again | 1 | 1·10⁻¹⁵ Å | 1·10⁻¹⁶ µB | — | pass |
| b. Mn₃Ga k = 0, every magnetic group with a moment on Mn (Ga exact, finding 2) | 99 | 3.1·10⁻⁵ Å | 7.7·10⁻⁵ µB | — | 76 pass; 23 miss atoms (finding 1) |
| c. MnO, k = (½ ½ ½), C_c2/c | 1 | 9·10⁻¹⁶ Å | 5.5·10⁻⁵ µB | — | pass |
| c. MnWO₄-like (synthetic), k = (½ 0 0), every group | 11 | 2·10⁻¹⁵ Å | 5·10⁻¹⁶ µB | — | pass |
| d. P1 helix, k = (0 0 ¼), cosine ∥ a, sine ∥ b | 1 | 1·10⁻¹⁵ Å | 5·10⁻¹⁶ µB | — | pass |
| d. Mn₃Ga, k = (0 0 ¼), two arms, every group (Ga exact, finding 2) | 22 | 3.1·10⁻⁵ Å | 7.7·10⁻⁵ µB | — | pass |
| e. GaTa₄Se₈ P-42₁m 1×1×2, all 44 modes non-zero (25 secondary) | 1 | 2.5·10⁻¹⁵ Å | — | 2.9·10⁻¹⁵ Å | pass |
| e. SrTiO₃ a⁻a⁻a⁻ tilt (R-3c), 0.41 Å | 1 | 1.6·10⁻¹⁵ Å | — | 9.7·10⁻¹⁷ Å | pass |

A two-phase page: the header's CIF and this entry write the primary phase;
the second phase is written by the 3D card's own download. Each file holds one
data block, which is what MOTIF reads.

### Findings

1. **An mCIF at k = 0 in a magnetic group that splits an orbit leaves atoms
   out** (MATERIA's writer). At k = 0 the mCIF lists the parent's sites, plus
   an extra row for each split orbit that carries a moment
   (`withOrbitSites`, `src/core/export/cif.ts`), with the magnetic group's
   operations. An orbit with no moment (a non-magnetic atom, or a magnetic
   site whose moment the group forbids) gets no row, so any reader that
   expands the file by its operations, MOTIF included, builds fewer atoms
   than the structure has. In 23 of the 99 Mn₃Ga groups one Ga or two Mn
   atoms of the 8 were missing (one group: both); the moments of the atoms that are there agree.
   MOTIF reads the file correctly. The commensurate k ≠ 0 path writes the
   complete asymmetric unit of the magnetic cell and is not affected. Fixed
   separately in [#182](https://github.com/drthyang/materia-platform/pull/182)
   ([report](./2026-11-24-mcif-split-orbits.md)); this change is built on it.
2. **Mn₃Ga's Ga at (0.3333, 0.6667)** in the bundled CIF is 1/3 rounded. Two
   expansions that reach the same atom through different operations then
   differ by 10⁻⁴ in a coordinate, 5.4·10⁻⁴ Å. With Ga set to exactly
   (1/3, 2/3) the difference falls to the printed precision in every group
   (the table's rows); with the file's Ga, 6 of the 22 k = (0 0 ¼) groups and
   most k = 0 groups show it. This is the source
   file's rounding, not a fault of either side.
3. **An incommensurate k** has no finite magnetic cell. MATERIA writes the
   parent cell with the cosine amplitudes in the moment loop and k and the
   sine amplitudes as comments only. MOTIF refuses a file with modulation tags,
   but this one has none, so it draws the cosine amplitudes as a static
   structure without a word. The entry's **?** says the modulation is left
   out. MATERIA now also writes k in the standard `_parent_propagation_vector`
   loop ([report](./2026-11-24-mcif-incommensurate-k.md)); a warning on such
   files in MOTIF is a task for MOTIF itself.

## What changes for users

The Export menu has one more entry on every page, with a "?". Nothing else
changes: the other exports, the 3D view, the project file and everything the
Copilot or an MCP client reads are untouched.

## What it means for the validation

Nothing: no exporter changed, no pinned result or golden file moved.

## Not done

- MOTIF warning on an incommensurate file (finding 3): a task for MOTIF.
- The single-crystal page writes no mCIF, so with a magnetic model on the
  entry writes the CIF and says the moments are left out.
- The live "Open in MOTIF" button, when MOTIF is published.

## Checks

At the branch head: `npm run build` and `npm run lint` pass; `npm test`
passes (419 files, 3748 tests; 37 files skipped, the local-data and paid ones),
with no golden or snapshot moved.

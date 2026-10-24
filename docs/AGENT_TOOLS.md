# Agent tools, skills, and LLM-guided refinement

Every scientific capability of the workbench is a pure TypeScript function over
plain data in [`src/core/**`](../src/core). That makes the same functions usable
by an agent: an MCP server exposes them as tools, so an agent can run a
refinement and reason about the result, not just execute steps.

The layer grows with the science. A capability becomes a tool once it is
validated, milestone by milestone — never as an "agent mode" bolted on at the
end ([ROADMAP.md §5](./ROADMAP.md)).

## Run the MCP server

The server speaks MCP over stdio ([`src/mcp/`](../src/mcp)). One command
bundles the core and starts it, so a client always runs the current source:

```bash
npm run mcp                # = node scripts/build-mcp.mjs --serve
```

**Claude Code** picks the server up from the repository's
[`.mcp.json`](../.mcp.json) and asks once before starting it. Run
`npm install` first.

**Claude Desktop** and other clients need the absolute path. They often launch
servers in `/` or the home folder, so name the data folder too:

```json
{
  "mcpServers": {
    "materia": {
      "command": "node",
      "args": ["/abs/path/materia-platform/scripts/build-mcp.mjs", "--serve"],
      "env": { "MATERIA_ROOTS": "/abs/path/materia-platform" }
    }
  }
}
```

### How data travels

The tools pass whole domain objects. A parsed powder pattern is about 200 k
characters of JSON, and every refinement needs it back. A model cannot carry
that, so the transport ([`host.ts`](../src/mcp/host.ts),
[`refs.ts`](../src/mcp/refs.ts)) adds five things. The handlers never see them.

- **Refs.** The server stores every tool output. The response is a compact view:
  bulky parts come back as `{"ref": "#3/pattern", …summary}`. Any argument may
  be such a ref, and the server substitutes the stored value. Each object result
  also carries `"ref": "#n"` for the whole output. Inside a list, a ref to a list
  of records is spliced in, so
  `parameters: [{"ref": "#4/parameters"}, {"ref": "#9/parameters"}]` is the
  nuclear set followed by the magnetic one.
- **`path`.** The parse tools read a file on the server instead of taking its
  text. Whole-file fields, such as `export_bundle`'s `rawInstrument`, take
  `{"path": …}` the same way. Paths are confined to the data folders:
  `MATERIA_ROOTS` (a path list), else the working directory. File access stays
  off when that is `/` or the home folder.
- **`outDir`.** Tools that produce files write them into this folder, inside the
  data folders. An existing file is replaced only with `overwrite: true`, and a
  symlink is never written through.
- **`free`.** Refining tools take parameter ids or globs, such as
  `["scale", "bkg*", "cell_*"]`. Exactly those refine; every other parameter is
  held fixed. A pattern that matches nothing is an error that lists the ids.
- **`read_ref`.** It shows the value behind a ref, with `start`/`end` windows for
  long arrays.

Refining tools return `parameters` with the refined values, so one call's
output feeds the next without copying numbers. A test drives a whole powder
loop through a real MCP client and holds every message under a size budget
([`host.test.ts`](../src/mcp/host.test.ts)).

## Tools

Each tool is one capability: a pure JSON → JSON wrapper over tested core code;
multi-step procedures belong to skills ([the layer contract](#the-layer-contract)).

The tables below are generated from [`src/mcp/registry.ts`](../src/mcp/registry.ts)
by `npm run gen:tooldoc`. The full descriptions at the end are the text an agent
reads when it picks a tool.

<!-- TOOLS:BEGIN (generated — edit src/mcp/registry.ts, then npm run gen:tooldoc) -->
**Structure, data and instrument**

| Tool | What it does |
|---|---|
| `parse_structure` | Parse structure (CIF/mCIF) |
| `parse_powder_data` | Parse powder pattern |
| `parse_instrument` | Parse instrument file |
| `reflection_list` | Reflection list (hkl, d, multiplicity) |
| `bond_geometry` | Bond lengths (sanity check) |
| `analyze_site_symmetry` | Site symmetry, Wyckoff & refinable DOF |

**Powder refinement**

| Tool | What it does |
|---|---|
| `build_refinement` | Build refinement parameter set |
| `check_fit_range` | Check the fit range (the data's ends) |
| `check_cell_symmetry` | Check cell & space group (Le Bail sanity check) |
| `refine_powder` | Refine (constrained least squares) |
| `evaluate_pattern` | Evaluate pattern (no refinement) |
| `simulate_pattern` | Simulate pattern (structure only) |
| `review_symmetry` | Review the space group (last step) |
| `rank_next_parameters` | Rank next parameters (sensitivity) |

**Judging a refinement**

| Tool | What it does |
|---|---|
| `assess_refinement` | Assess refinement (expert judgment) |
| `suggest_next_steps` | Suggest next steps |
| `interpret_structure` | Interpret structure (materials science) |

**Magnetic structures**

| Tool | What it does |
|---|---|
| `find_unexplained_peaks` | Find unexplained residual peaks |
| `search_propagation_vector` | Search propagation vector k |
| `list_magnetic_subgroups` | List magnetic subgroup candidates |
| `allowed_moments` | Allowed moment directions per site |
| `build_magnetic_model` | Build symmetry-allowed magnetic model |
| `refine_magnetic_powder` | Refine nuclear + magnetic (staged) |

**Single crystal**

| Tool | What it does |
|---|---|
| `parse_single_crystal_data` | Parse single-crystal reflections |
| `write_single_crystal_data` | Write single-crystal .int |
| `expand_structure_supercell` | Expand structure to magnetic supercell |
| `build_modulated_moment_model` | Build k-modulated supercell moments |
| `merge_magnetic_supercell` | Merge nuclear + magnetic to supercell |

**Pair distribution function (PDF)**

| Tool | What it does |
|---|---|
| `parse_pdf_data` | Parse reduced PDF G(r) |
| `build_pdf_model` | Build PDF parameter set |
| `refine_pdf` | Refine against G(r) (real space) |
| `refine_pdf_boxcar` | Boxcar scan over r (PDF) |
| `sample_posterior` | Sample Bayesian posterior (MCMC) |
| `compute_partial_pdf` | Partial PDF decomposition |
| `calibrate_qdamp` | Calibrate Qdamp/Qbroad from a standard |

**Magnetic PDF**

| Tool | What it does |
|---|---|
| `build_mpdf_model` | Build magnetic-PDF parameter set |
| `refine_mpdf` | Refine magnetic PDF (real space) |
| `compute_mpdf_components` | Separate nuclear vs magnetic G(r) |

**Symmetry modes**

| Tool | What it does |
|---|---|
| `build_distortion_modes` | Build distortion-mode parameters |
| `build_symmetry_modes` | Enumerate symmetry modes from the space group |

**Export**

| Tool | What it does |
|---|---|
| `export_bundle` | Export cross-check bundle (FullProf / GSAS-II) |

<details>
<summary>Full descriptions — the text an agent reads for each tool</summary>

**`parse_structure`** — Parse CIF/mCIF text into a StructureModel (cell, sites, space group) and any magnetic model. The entry point: feed its `structure` to build_refinement / interpret_structure. The setting is never guessed: a CIF with no symmetry operations whose symbol or number fits several settings (e.g. "F d -3 m", origin choice 1 or 2) is an error listing them — pass the right one as `spaceGroupSetting`. A CIF with no symmetry at all is an error too; pass "P 1" only if it lists every atom in the cell (diffpy writes such files).

**`parse_powder_data`** — Auto-detect and parse powder data (xye/xy/dat/GSAS/FullProf/ILL). Returns the pattern, a summary (points, unit, range, radiation), and how the format was detected (source + confidence). Pass the instrument from parse_instrument so the radiation is right: X-ray or neutron, the wavelength, the polarization, and a lab tube's Kα₂ line.

**`parse_instrument`** — Parse an instrument-parameter file (GSAS-II .instprm, classic GSAS .prm, FullProf .irf) into a CW or TOF calibration. Pass the result to build_refinement/refine_powder so the wavelength and profile are right.

**`build_refinement`** — Build the SYMMETRY-ALLOWED parameter set, bindings, and profile for a structure + pattern. Only symmetry-allowed parameters are created, so an agent cannot free a forbidden one. Feed `parameters`/`bindings`/`profile` to refine_powder. The background is Chebyshev with 4 terms, except on POWGEN time-of-flight data (an instrument file that names POWGEN or PG3, or a data file named PG3_… with an instrument file naming no instrument): log interpolation with 3 points; `profile.backgroundType` says which, so pass it on to export_bundle.

**`check_fit_range`** — The first step of a refinement: read the pattern's two ends and propose the fit window, as the GSAS-II tutorials do. The long-d end starts just below the first reflection (background only) unless the data hold peaks there no phase explains — magnetic order or another phase, which stay in. The far end stops in a gap below what is not real data: counts that step up and stay at the last points (a detector's or scan's edge), points with no counts, a line cut by the last point, the short-d stretch where no peak stands out of the noise, or (with a converged `result`) a stretch the model misses more than anywhere just inside. Every cut lies in a gap between reflections; a cut of more than 15 % of the points is flagged `large` — the user's call. Returns `low` and `high` (verdict, `cut`, findings with the evidence, notes on the counting σ), `proposed` (the window on the pattern's axis, or null), `proposedD` (Å), `interior` (spikes, missing points no window removes), `reading` (the same in words, each end named) and, when the structure has next to no reflection in the axis's d range, `axisWarning` (the axis is likely in another unit, or the wavelength wrong: ask the user before refining). Pass the window on as `fitRange` to refine_powder and check_cell_symmetry.

**`check_cell_symmetry`** — A sanity check at the START of a refinement, not a gate: does the cell index every peak, and does the data respect the space group's systematic absences? A Le Bail fit refines the cell from peak positions alone (free intensities), with back-to-back-exponential peaks that widen with d on time-of-flight data; then it reads the leftover (≥ `significance` σ counts). On 2θ data it also refines a zero shift and the axial-divergence asymmetry, and draws a lab tube's Kα₂. `reading` says what the check found in the app's words (first a wrong wavelength or difC, from the pattern's own peaks: one factor on every d, which the Le Bail fit cannot follow). `unindexedPeaks` mean a wrong cell or lattice, or a missing phase — settle these first; pass known impurities as `extraPhases`. `shoulders` are small bumps (≤ 3 %) within a few widths of a strong line: a profile tail the simple Le Bail shape misses, not a phase, and not counted against the cell. `absences.violated` is a FLAG, not a verdict: before the structure is refined, profile misfit or an impurity line reads the same way. Do not change the space group on it — note it, refine the structure to the best, and question the group last with review_symmetry on the refined residual. `absences.untestable` lists forbidden reflections too close to an allowed one to judge. Only d ≥ `dMin` (0.7 Å) is read. It cannot catch a too-LARGE cell (a supercell indexes anything) or a group with too FEW absences — read `limits`. `passed` and `cell` (the Le Bail cell) are the result.

**`refine_powder`** — Run the deterministic Levenberg–Marquardt refinement of the FREED parameters (fix a parameter by setting its `fixed:true`). Returns refined values, esds, agreement (wR/GoF), the SVD/correlation/at-bound diagnostics, the observation count, and the residual — everything assess_refinement needs — plus `parameters`: the input set carrying the refined values, ready for the next block. The agent decides what to free; it never sets values.

**`assess_refinement`** — The judgment tool. Turn a refinement result into a structured expert read: a trust VERDICT (Toby GoF bands) plus ranked FINDINGS — dangerous correlations (with the physical reason), at-bound/unphysical parameters, ill-conditioning, over/under-parameterization, and UNEXPLAINED RESIDUAL PEAKS (the missing-phase / magnetic-order signal). Pass the refine_powder outputs straight in; a refine_pdf result is read in real space, without the GoF.

**`suggest_next_steps`** — The decision tool. Given an assessment, return ranked next ACTIONS (sequencing the constrained refinement — never inventing values): fix an unphysical value, hold an at-bound parameter, break a correlation, hunt an impurity/magnetic phase, or validate a good fit before extending it.

**`interpret_structure`** — The materials tool. Read a refined structure for engineering/discovery signals: crystallite size & microstrain (microstructure), partial occupancy (off-stoichiometry / vacancies / doping), large displacement parameters (disorder), magnetic order, and bond-length sanity — each paired with its materials meaning.

**`evaluate_pattern`** — Compute the calculated pattern and agreement (wR/GoF) at the CURRENT parameter values — no refinement. The cheap what-if tool: tweak a value, evaluate, compare. Pass a magnetic model to get the nuclear and magnetic components separately (what do the moments alone contribute?).

**`simulate_pattern`** — Simulate the powder pattern of a structure on an instrument before any data exists — planning, phase identification by eye, generating a reference. Grid defaults: CW 5–120° 2θ; TOF the d = 0.6–6 Å band of the calibration. Pass a magnetic model to include (and separate out) the magnetic contribution.

**`reflection_list`** — Unique hkl families with d-spacing and multiplicity for a structure, optionally with the instrument-frame position (2θ or TOF µs). Set absences:false to keep nuclear-extinct families — that is where AFM magnetic satellites live, and how you match an unexplained peak to a candidate hkl.

**`bond_geometry`** — Nearest-neighbour bond lengths (Å) up to a cutoff from the symmetry-expanded structure, sorted shortest first, and each cation's bond-valence sum against its oxidation state (oxides and fluorides; Brese & O'Keeffe R₀, b = 0.37 Å; the CIF type symbol gives the state, else the tabulated one closest to the sum is assumed). The physical-plausibility check after refining positions: an impossibly short contact, or a sum more than ~15 % from the valence, means the refinement went somewhere unphysical or the site holds another element.

**`analyze_site_symmetry`** — Per-site symmetry: for each atom, its Wyckoff label (e.g. "6h", for the built-in space groups), multiplicity, point-group site symmetry, and the symmetry-allowed refinable degrees of freedom — free positional coordinates (0–3), anisotropic-ADP components (0–6), and magnetic-moment components (0–3). The parameterization guardrail: read this BEFORE freeing coordinates or moments so you never fight a symmetry constraint — an atom on a fixed special position has 0 free coordinates, and a site with `allowedMomentComponents: 0` cannot carry a moment. Also reports the crystal's overall point group.

**`find_unexplained_peaks`** — Find peaks in the residual (obs − calc), classified against the model's lines — the impurity / magnetic-order signal, kept apart from misfits. `unexplained`: peaks on no phase's reflection or its tail (an impurity, the sample environment, magnetic satellites). `misfits`: peaks on or beside a known reflection — that reflection's intensity or shape not matched yet, which refining the structure, profile and corrections fixes; never an extra peak and never a reason to lower the symmetry. `k0Magnetic` is true when a neutron pattern of magnetic ions has its excess on nuclear lines at large d: the misfits may then be k = 0 magnetic order (give their d to search_propagation_vector). With per-point σ (refine_powder's residual carries it) a peak must stand 5σ above its own noise. Each peak has d, height, sigmas and the line it sits on or near; `reading` says what they mean.

**`review_symmetry`** — The LAST step of a Rietveld refinement, never the first: once scale, background, cell, positions, profile and ADPs are refined to convergence and the fit is still not good, read the refined residual at the reflections the primary phase's space group forbids. Returns the forbidden reflections that still carry intensity (`observedForbidden`), the same-lattice (translationengleiche) subgroups that allow them, smallest index first, with their domain counts (`candidates`), in a centred group the subgroups that drop a centring vector (`decentred`: an order the model averages, CsCl read as body-centred), and a `reading`. Intensity that differs on allowed reflections is what refinement fixes, never evidence against the group. A lower group is a new model refined again from the start, kept only if it fits these reflections without the misfit moving elsewhere — the user decides. A larger cell is not enumerated (read `limits`).

**`search_propagation_vector`** — Rank candidate commensurate propagation vectors k (denominators 2/3/4/6; in a monoclinic or triclinic cell the mixed-sign ones too, such as (¼ 0 −¼)) by how many unexplained peak d-spacings their satellites G ± k explain, each within 0.02 Å or 0.5 % of d, the hkl range sized from the cell. Every peak given counts: `maxQ` drops those above a |Q| only when passed. Feed the d values from find_unexplained_peaks; the winning k goes to list_magnetic_subgroups.

**`list_magnetic_subgroups`** — Enumerate the maximal magnetic subgroup candidates of the parent space group for a propagation vector k: conjugacy-class representatives with BNS identification, subgroup index, and domain count. The chosen candidate's `operations` feed allowed_moments and build_magnetic_model.

**`allowed_moments`** — The site-symmetry analysis: which moment directions the magnetic group allows on each site (null space of the magnetic stabilizer, with the k-phase). Dimension 0 = moment symmetry-forbidden; the basis spans exactly what a refinement may vary. Matches GSAS-II's per-site moment rules.

**`build_magnetic_model`** — Build the magnetic model + moment-mode parameters for chosen ion sites under a magnetic subgroup: amplitudes over the symmetry-ALLOWED directions only, co-located (occupancy-disorder) ions tied to one moment, split orbits as independent sublattices. The refinement cannot leave the allowed space by construction. For a k with two distinct arms (−k ≢ k: ¼-, ⅓-type or incommensurate) every mode carries a cosine AND a sine (quadrature) amplitude — complex Fourier coefficients, the representation helices/cycloids need (`fourier: true`); `phaseGaugeParameterId` names the one sine amplitude that must stay FIXED (the global modulation phase is unobservable). Read `propagation` for the k classification. `refineK: true` also appends the propagation vector as refinable rows (prop_k1..3, reciprocal-lattice units): only the components the little group of k leaves free (a component on the same symmetry line follows as a tie), capped at 0.005 r.l.u. per cycle and bounded between the half-integers around k; a self-conjugate k (0 or ½-type) or a special mode basis holds k fixed — read `kRefinement.notes`. Powder only: single-crystal and mPDF refinements keep k fixed. Feed the outputs to refine_magnetic_powder.

**`rank_next_parameters`** — The next-step diagnostic: rank the currently-FIXED parameter groups by the χ² improvement freeing them is expected to buy (Gauss–Newton estimate from probed Jacobian columns at the current values). Read `predictedWr` vs `wrNow` for absolute progress — on a converged model every group promises nothing. A LOCAL probe: align the pattern first; badly displaced peaks under-credit the cell/zero groups.

**`refine_magnetic_powder`** — Co-refine nuclear + magnetic against a powder pattern. Staged by default: scale + background converge with moments and profile held, then everything requested is freed — a flat co-refinement from a poor moment start can collapse the scale against exploding moments. Combine the nuclear parameters/bindings from build_refinement with the moment set from build_magnetic_model. Returns the result, the refined `parameters` (ready for the next call), the refined magnetic model, and separated nuclear/magnetic component curves. The moments have several local minima (magnetic intensity is quadratic in them), so a single run can land in the wrong one: pass `restarts` (e.g. 12) to restart the moments from kicked starts on the frozen nuclear model first; `multiStart` then reports the costs, the ±m-canonical answer, and any poorly determined moment directions.

**`parse_single_crystal_data`** — Parse single-crystal integrated intensities — a FullProf .int, a SHELX HKLF 4 .hkl, a .fcf CIF reflection loop, an SNS TOPAZ time-of-flight .hkl (each reflection with its own wavelength, 2θ, path length and run, detected from its columns), or a plain h k l I σ list — into a SingleCrystalDataset. The intensities are taken as corrected F² (Lorentz, polarization and absorption applied in data reduction), as every single-crystal program takes them. ALWAYS pass `name`: .int and .fcf are detected from the text, but HKLF 4 is fixed-column and looks exactly like a free-format list, so only the .hkl filename selects the column-exact reader (whitespace-splitting an HKLF 4 row reads σ as the intensity once F² ≥ 10000.00 fills its field). `format` reports which reader ran. Parse the nuclear and magnetic files, then merge_magnetic_supercell into one dataset for the magnetic refinement. A 0 0 0 row (the forward beam, not a Bragg reflection) is skipped by default — pass skipForwardBeam:false for a fundamental-indexed MAGNETIC file, where 0 0 0 is the satellite at k itself.

**`write_single_crystal_data`** — Serialize a SingleCrystalDataset to a FullProf .int file (h k l F² σ cod through the declared Fortran format). Pass kVectors + per-reflection kIndex for the propagation-vector variant (satellite = H + k_nv; pending external FullProf validation). Round-trips with parse_single_crystal_data.

**`expand_structure_supercell`** — Expand a nuclear structure into the magnetic supercell of a commensurate k — an exact geometric regrouping (full orbits explicit, replicated per cell, P1; positions/occupancies/ADPs verbatim). Pair with merge_magnetic_supercell: the merged reflections refine against this structure with the nuclear scaffold frozen. The refined scale becomes k_base/N² (N = cells per supercell), identically for nuclear and magnetic intensities.

**`build_modulated_moment_model`** — Build the k-modulated magnetic model on the expanded supercell: one amplitude per sublattice drives every replica of its parent site through cos(2πk·L + φ), so replica moments are tied by the modulation and magnetic ions sit exactly at the nuclear positions. Returns the expanded structure + magnetic model + parameters/bindings; add a scale and a magneticScale tied to it, then refine against the merged supercell dataset.

**`merge_magnetic_supercell`** — Merge a nuclear + magnetic single-crystal reflection pair (both indexed in the nuclear cell, the FullProf single-k convention where the magnetic file's h k l is the fundamental of a satellite at hkl+k) into one dataset in the magnetic supercell, where k becomes an integer reciprocal-lattice vector. Feed the result to a magnetic structure refinement. k must be commensurate and axis-diagonal.

**`parse_pdf_data`** — Parse a reduced pair-distribution-function file (.gr/.sq/.fq — diffpy PDFgetX3, PDFgetN or Mantid dialect) or a PDFgui fit export (.fgr) into a PdfPattern with its total-scattering metadata (Qmax, Qdamp, composition). For .fgr, `signal` picks the curve: 'observed' (default, Gcalc+Gdiff) or 'difference' (the fit residual — the mPDF signal for a neutron nuclear fit). When the file names no radiation the summary says `radiationAssumed: true` (read as X-ray): ask, and parse again with `scatteringType` if it is neutron data. The real-space entry point: feed `pattern` to build_pdf_model / refine_pdf.

**`build_pdf_model`** — Build the SYMMETRY-ALLOWED PDF parameter set for a structure (plus optional extra phases) against an observed G(r): the PDF scale (seeded to the least-squares optimum), the Qdamp/Qbroad instrument envelope (seeded from the header, fixed), correlated-motion δ1/δ2 and sratio/rcut, the particle-diameter envelope, and the symmetry-reduced cell/positions/ADPs/occupancies. Feed `parameters`/`bindings`/`restraints` to refine_pdf. CHECK `warnings`: it names any site with no displacement parameter (B_iso = 0, e.g. a CIF with no U_iso/B_iso column) — that gives delta-sharp G(r) peaks and a collapsed scale, so the fit converges on a meaningless model. Set a B_iso before refining.

**`refine_pdf`** — Run the deterministic least-squares PDF refinement of the FREED parameters against an observed G(r) — real-space Rietveld with uniform weights (G(r) errors are correlated; Rw is a relative indicator). Flat co-refinement or the staged sequence (scale → cell → ADP → δ1 → positions); single- or multi-phase; restrict with `fitRange` (low r below r_poly is reduction artifact). Returns refined values, esds, agreement, diagnostics, the refined `parameters` (ready for the next call), the r-space residual, and — in `warnings` — any correlated-motion model conflict or missing-ADP defect that makes the reported convergence meaningless.

**`refine_pdf_boxcar`** — Run a BOXCAR (sliding-window) PDF refinement: refit the freed parameters inside a fixed-width r-window slid across the data, each box seeded from the previous one, and report how every parameter drifts with the box center. This is the r-resolved read of a structure — a value that changes with the box center means the LOCAL structure (low r) differs from the AVERAGE one (high r), which a single whole-range fit averages away. Every box has exactly `width`; a trailing span too short for a full box is not fitted (reported in `warnings`). Each box is seeded from the previous one, which makes the series PATH-DEPENDENT — set `restarts` to re-search each box from randomly perturbed starts and keep the best, so a drift is not one box's local minimum inherited by the rest. Read a value only where its box fitted well (`boxes[].rWeighted`, `boxes[].status`) and where the esd is small compared with the drift — narrow boxes hold few points, so esds grow as the box shrinks. Hold Qdamp/Qbroad fixed: they are instrument constants, not functions of r.

**`build_mpdf_model`** — Build the magnetic-PDF (mPDF) parameter set: the nuclear PDF rows (scale seeded from the nuclear curve) plus the four mPDF rows — ordered scale, paramagnetic scale, magnetic peak σ, and the short-range-order correlation length ξ — and the symmetry-allowed moment modes from build_magnetic_model. The mPDF rows start FIXED because `mpdfOrdScale` is degenerate with the moment magnitude; free the moments OR the ordered scale, not both. Feed `parameters`/`bindings`/`magnetic` to refine_mpdf. COMMENSURATE k ONLY (every component a rational with denominator ≤ 12): an incommensurate k has no periodic spin box and is REJECTED, not approximated. CHECK `warnings`: non-neutron data, an empty spin field, and any site with no displacement parameter (B_iso = 0) all make the result meaningless.

**`refine_mpdf`** — Co-refine the nuclear G(r) and the magnetic d_mag(r) against one observed NEUTRON PDF — the real-space counterpart of refine_magnetic_powder (Frandsen & Billinge 2015 unnormalized mPDF, added into the same residual). Flat co-refinement or the staged sequence (scale → cell → ADP → δ1 → moments → positions); restrict with `fitRange`. Returns refined values, esds, agreement, diagnostics, the refined `parameters` (ready for the next call), the refined magnetic model, and separated nuclear/magnetic component curves. COMMENSURATE k ONLY — an incommensurate k is rejected (refine it against Bragg satellites with refine_magnetic_powder instead). X-ray patterns get no magnetic term (reported in `warnings`).

**`compute_mpdf_components`** — Split the calculated G(r) into its nuclear and magnetic parts at the CURRENT parameter values, without refining. Use it to check whether a candidate spin model produces enough magnetic signal to fit. `magneticFraction` is the RATIO peak|magnetic| / peak|nuclear| — 0.01 is 1%, and below about that the moments are effectively unconstrained by the data (a strongly magnetic neutron PDF runs 0.1–1). Always read it with `nuclearPeak`/`magneticPeak`: the ratio is reported as 0 when the nuclear peak is zero, which means a degenerate nuclear model, not weak magnetism.

**`sample_posterior`** — Draw Bayesian posterior samples over the FREED parameters of a PDF fit, or of a powder fit (pass build_refinement's `profile`, and `magnetic` for a nuclear + magnetic co-refinement), with an affine-invariant ensemble MCMC sampler — the full parameter distribution where refine_pdf / refine_powder give a point estimate. Run it when a refined value is not convincing: an esd as large as the value, a parameter on a bound, a strongly correlated pair, a value that moves between refinement paths at the same wR. Reports per-parameter median / 68% / 95% credible intervals, convergence diagnostics (R-hat, ESS, acceptance), sample correlations, `intervals` and `reading` (each parameter's verdict and the run read whole, as the app reads it: wait for convergence, the esds confirmed or not, a bound, a strong correlation), and — when `linearizedEsd` from a prior refine_pdf is supplied — `esdRatio` (posterior std / least-squares esd: ≈1 validates the esds, ≫1 means they were overconfident from correlation or non-Gaussianity). The default `marginalized` noise model integrates out the unknown G(r) error scale (uniform weights are not honest sigmas), so widths are meaningful. Run refine_pdf / refine_powder FIRST and seed `parameters` at the converged values. Bounded per call: if `converged` is false, pass the returned `resume` token to a follow-up call to continue the same chain.

**`compute_partial_pdf`** — Decompose the calculated G(r) for interpretation — which chemistry (element pair) or which phase makes which peak. Single phase → Faber–Ziman element-pair partials; with extraPhases → per-phase contributions. The curves sum exactly to the total calc.

**`calibrate_qdamp`** — Calibrate the instrument resolution envelope from a measured STANDARD (Ni / Si / LaB₆ — a sample with a known structure): frees only the PDF scale + Qdamp + Qbroad, holds the certified structure, and returns the calibrated constants (with esds) to carry into sample fits as fixed values.

**`build_distortion_modes`** — Decompose a low-symmetry CHILD structure against its high-symmetry PARENT (same lattice; origin shift searched automatically) into refinable DISTORTION-MODE amplitudes — the AMPLIMODES/ISODISTORT paradigm. Modes are tagged with their Brillouin-zone star (`star`: Γ, X, H, or a literal k) from the parent centerings the child breaks, and the observed distortion is split into one frozen (order-parameter) mode per star. Use `structure`/`parameters`/`bindings` with refine_pdf or refine_powder instead of per-coordinate positions: same engine, fewer and more informative parameters (the frozen modes come free).

**`build_symmetry_modes`** — Enumerate the symmetry-adapted displacement modes of a structure FROM ITS OWN SPACE GROUP — no parent/child CIF pair. Every asymmetric site contributes its symmetry-allowed shift directions, orthonormalized as whole-cell Å amplitudes seeded at 0 (activating modes never changes the curve; they enter fixed and are freed deliberately). Rigid-translation (acoustic) combinations — exactly unobservable in G(r) or |F|² — are projected out (`acousticExcluded`), so freeing every mode is always a well-posed fit. These are the symmetry-CONSERVING (Γ) modes: the same DOF as per-coordinate positions in a physically informative basis. Use `structure`/`parameters`/`bindings` with refine_pdf or refine_powder.

**`export_bundle`** — Write a refinement as the files another program needs to re-run it — the external cross-check. `target: "fullprof"` gives a .pcr (every phase) + XYDATA/.int data + README; `"gsas2"` gives one CIF per phase + .instprm + data + a GSASIIscriptable build_gpx.py (sets fit limits + background) + README. Everything goes out at its REFINED values, applied from `parameters`: structures, zero, peak shape, TOF calibration, preferred orientation, the background curve (pass `backgroundType` if not Chebyshev) and `fitRange`. Pass `result` for the esds and agreement factors in the CIF, and `extraPhases` to include the other phases of a multi-phase fit. Pass the original instrument file as `rawInstrument`: a single-bank GSAS-II .instprm is then patched with the refined profile (all other lines kept) and shipped with the untouched original. Scale factors do not transfer between programs — refine them first. Returns `files` (name + text).

</details>
<!-- TOOLS:END -->

**The judgment tools.** `assess_refinement`, `suggest_next_steps` and
`interpret_structure` turn a refinement result into a verdict, ranked next
actions and a materials reading. They are pure, tested core code in
[`src/core/diagnostics/`](../src/core/diagnostics), and the in-app Agent
calls the same functions on the live page ([below](#the-in-app-agent)).

**How the tools are tested.**
- [`registry.test.ts`](../src/mcp/registry.test.ts) enforces the layer
  contract below: the registry and the handlers match both ways, names and
  descriptions follow the conventions, every tool is called on canned inputs
  with the shape of its output pinned, and every registered tool appears in
  the table above.
- A simulate → evaluate loop checks the analysis tools without any data files
  ([`tools.test.ts`](../src/mcp/tools.test.ts)). The same file runs the whole
  expert loop on the real GaNb₄Se₈ dataset when the git-ignored `data/` folder
  is present.
- End-to-end agent loops for PDF and magnetic PDF use the registry only
  ([`pdfAgentLoop.test.ts`](../src/mcp/pdfAgentLoop.test.ts),
  [`mpdfAgentLoop.test.ts`](../src/mcp/mpdfAgentLoop.test.ts)).

Worked examples — a structure inspected before any data, a magnetic structure
solved from the peaks a nuclear fit leaves, and a PDF fit read for local versus
average structure — are in
[AGENT_EXAMPLES.md](./AGENT_EXAMPLES.md), with real runs and a test that
replays them.

## The layer contract

The agent surface has three layers. Each has one owner and one invariant, and
keeping those boundaries mechanical is what keeps the surface maintainable.

| Layer | Owns | Form | Invariant |
|---|---|---|---|
| **Tools** | one capability | a pure JSON → JSON handler plus schema, registered in [`src/mcp/registry.ts`](../src/mcp/registry.ts) | a handler never calls another handler; no sequencing, no judgment prose |
| **Skills** | an expert procedure | a `SKILL.md` that names tools | branches only on the *structured* outputs of the judgment tools |
| **Orchestration** | the conversation, files, when to invoke | the agent runtime (Claude Code, Claude Desktop, any MCP client), or the in-app Agent | outside the core; the Agent is a thin loop over the same tools |

Where a piece of work belongs:
- It must be correct every time → a core function, exposed as a tool. Example:
  the staged anti-collapse recipe inside `refine_magnetic_powder`.
- It is a known-good sequence with checkpoints → a skill.
- It needs the user's context → orchestration.

Anything that must be reliable moves **down** a layer; it is never encoded as
prompt text.

## Skills

A skill composes tools into an expert procedure. These ship in this repository:

- [`.claude/skills/my-rietveld-workflow/`](../.claude/skills/my-rietveld-workflow/SKILL.md),
  the maintainer's own powder Rietveld procedure: a sanity check of the cell, a
  fixed freeing sequence, acceptance criteria, and the space group reviewed
  last, only when everything else is refined. It covers constant-wavelength and TOF
  data, single- and multi-phase, and hands magnetic structures on to the
  magnetic-analysis flow.
- [`.claude/skills/pdf-workflow/`](../.claude/skills/pdf-workflow/SKILL.md), the
  small-box PDF procedure: instrument resolution from a standard, the freeing
  order, one correlated-motion term, boxcar scans for local versus average
  structure. General practice until the maintainer's own PDF method is written
  down.
- [`.claude/skills/magnetic-analysis/`](../.claude/skills/magnetic-analysis/SKILL.md),
  the powder magnetic structure procedure the Rietveld skill hands off to: k from
  the peaks the nuclear fit leaves, the magnetic space groups top-down, the
  moments, then nuclear and magnetic together, with the powder's limits. A first
  draft, to confirm with the maintainer.
- [`.claude/skills/symmetry-review/`](../.claude/skills/symmetry-review/SKILL.md),
  the last step of a Rietveld refinement, if at all: when the data ask for a
  lower space group, the alternatives to rule out, and how a lower group is
  tested — never before the structure is refined to the best its group allows.
- [`.claude/skills/sc-workflow/`](../.claude/skills/sc-workflow/SKILL.md), the
  single-crystal F² procedure: the data read before the model, the order of the
  free parameters, the weights last. General practice, not yet the maintainer's.
- [`.claude/skills/bayesian-check/`](../.claude/skills/bayesian-check/SKILL.md),
  when and how to sample the posterior of a refined number that is not
  convincing, and how to report its credible interval.

New skills come from interviewing the user; [SKILL_INTERVIEWS.md](./SKILL_INTERVIEWS.md)
is the guide, and says where each answer lands: the skill's text, a firm rule
in code, or an eval scenario.

The same files serve both agents. Claude Code loads them as skills in this
repository; the in-app Agent reads them through
[`src/agent/skills.ts`](../src/agent/skills.ts). Its system prompt carries only
each skill's name and description, and the Agent reads a skill whole with
`read_skill` when the task calls for it (progressive disclosure). A skill's
**References** section lists longer knowledge bases, and notes beside the skill
(its cases, its MCP tool map), as relative links
(`- [\`name\`](../../../knowledge/file.md) — what it covers`): Claude Code follows
the path, and the in-app Agent reads the reference by name. `skills.test.ts`
checks that every skill parses and every reference resolves.

A page's method opens with a **Gates** section: its numbers, its stopping rule
and what to ask the user, in one place. The skill lint
([`skillLint.test.ts`](../src/agent/skillLint.test.ts)) holds each skill to the
code: every tool it names exists on its pages (or is marked as MCP-only), every
gate number it quotes is the constant the code decides by
([`thresholds.ts`](../src/core/diagnostics/thresholds.ts)), every stage of the
page's method is named, and each method fits its share of a local model's
window, with an outline that keeps its Gates.

To add a skill, add a folder with a `SKILL.md` (frontmatter `name` and
`description`, then the procedure, then References). Nothing else changes: both
agents find it. A page's method skill is named in `PAGE_METHOD` (skills.ts).
One more is planned, `choose-background`: compare background bases and term
counts, and report which fits best without over-fitting.

## LLM-guided refinement

Refinement is an expert loop, not a black-box global optimization: never refine
everything at once, watch the correlations, free only symmetry-allowed
parameters. An LLM can drive that loop with the tools above:

```
observe   → evaluate_pattern → wR, GoF, residual shape, diagnostics
decide    → which parameters to free next / which stage / which background
act       → refine_powder(selected params, stage, fit range)
check     → converged? correlations acceptable? params at bounds? physical?
repeat / backtrack
```

Three things make this tractable here:
- The engine returns the signals a human refiner uses: correlations, near-null
  directions, at-bound parameters and the per-cycle χ²/wR history.
- The core enforces symmetry constraints, so an agent cannot free a forbidden
  parameter.
- The skills are the written method the agent follows, and the
  [`knowledge/`](../knowledge) notes they cite are the policy behind them.

**Guardrails.** The LLM plans and sequences; every numerical solve stays in the
deterministic Levenberg–Marquardt engine. The agent chooses what to free and
when, reads the diagnostics and explains them. It never invents parameter
values or bypasses the constrained least squares: no tool sets a parameter's
value. Replaying the same tool calls reproduces the result, and nothing counts
as validated until a test or an external comparison records it.

## The in-app Agent

The Agent puts a model of your choice — local on Ollama or LM Studio, or a
cloud model — beside the analysis open in the browser. It reads the live page,
judges the fit with the tools above, and makes changes through the page's own
controls. Open it from the **Copilot** rail at the page's side.

**Where it works.**
- The powder page (Rietveld), single- and multi-phase, with or without an
  applied magnetic model, and its magnetic analysis step: the propagation
  vector from the residual peaks, the magnetic space groups of the little
  group of k (ranked by a moments-only fit, the ★ to the maximal group with the
  fewest moment parameters among those within the noise of the best, by
  Hamilton's test), the moments fitted, and the model handed to the joint
  nuclear + magnetic refinement.
- The PDF page (a real-space fit of G(r)), single- and multi-phase, with or
  without an applied spin model. Rw is its agreement; the fit weights every
  point equally, so the answers carry no GoF and say the esds are not
  statistical.
- The single-crystal page (a fit to integrated F²): R1 over Fo² > 2σ, wR2
  and GooF over every reflection fitted (w = 1/σ² until SHELXL's weights are
  set), the cell fixed input from indexing.

Each page's method is one of the skills above (`my-rietveld-workflow`,
`pdf-workflow`, `sc-workflow`; the magnetic step's is `magnetic-analysis`).

### Its tools

One list ([`src/agent/tools.ts`](../src/agent/tools.ts)) serves every way in,
so a model sees the same names everywhere. Each tool names the pages it works
on; on another page it answers with an error that says so. Each definition
also holds the tool's facts (the History step it records, the cards it acts
on, where a local model is offered it, the evidence it gives a final answer),
and no other module keeps a list of tool names. The page-specific
handlers are [`powderTools.ts`](../src/agent/powderTools.ts),
[`pdfTools.ts`](../src/agent/pdfTools.ts),
[`scTools.ts`](../src/agent/scTools.ts) and
[`magneticTools.ts`](../src/agent/magneticTools.ts); the analysis tools are the
MCP handlers above, fed from what is on screen. The executor reaches the
handlers through one adapter per page ([`src/agent/pages/`](../src/agent/pages/)),
which also holds what differs by page: the agreement it shows, the analysis
the record is kept under, the references, the report's checks.

How a tool runs: **at once** when it changes nothing on the page (the reads;
`write_note` and `write_report`, which change the record, not the analysis;
and the magnetic step's `search_propagation_vector` and `rank_magnetic_groups`,
which fill its panel and change no fit); **asks first** for a change, which shows an approval card unless
the user switched the drawer from *Ask first* to *Auto* (back to *Ask first*
on reload); **always asks** for a change only the user may make, even in Auto.
A declined change returns `{"declined": true}`. Every change is a step in
History tagged `agent` (`HistoryStep.actor`), so ⌘Z or `go_to_step` undoes it,
and each is the page's own handler: the Agent's `refine` is the Refine button.
A change whose card was approved after the page moved under it (any setting
the Agent can change there: each page's stamp in
[`src/agent/pages/`](../src/agent/pages/)) is not run, and the model is told to
read the state again. Each change is planned before its card
([`src/agent/pages/plans.ts`](../src/agent/pages/plans.ts)): one that cannot run
(a window with max below min or outside the data, a scan of an anion's bonds,
a reflection kept that is not on the failed list, a refinement with nothing
free or of a view-only pattern) is refused before the card, not after the user
approved it.

<!-- LIVE_TOOLS:BEGIN (generated — edit src/agent/tools.ts, then npm run gen:tooldoc) -->
**Every page**

| Tool | Runs | What it does |
|---|---|---|
| `get_state` | at once | Read the analysis |
| `assess_refinement` | at once | Assess the fit |
| `structure_table` | at once | The refined structure |
| `bond_geometry` | at once | Bond lengths |
| `read_skill` | at once | Read a skill |
| `allow_exception` | always asks | Allow an exception to the method |
| `write_note` | at once | Note it for this analysis |
| `write_report` | at once | Write the analysis report |
| `read_ref` | at once | Read a stored value |
| `set_free` | asks first | Free or fix parameters |
| `set_adp_model` | asks first | Change the ADP model |
| `refine` | asks first | Refine |
| `reset_parameters` | asks first | Reset to starting values |
| `go_to_step` | asks first | Go to a step |
| `cancel_refinement` | never asks | Cancel the running refinement |

**Two pages**

| Tool | Pages | Runs | What it does |
|---|---|---|---|
| `suggest_next_steps` | powder, PDF | at once | Suggest next steps |
| `tie_parameters` | powder, single crystal | asks first | Tie parameters to one value |
| `sample_posterior` | powder, PDF | at once | Sample the Bayesian posterior |
| `interpret_structure` | powder, PDF | at once | Interpret the structure |
| `set_fit_range` | powder, PDF | asks first | Change the fit window |

**Powder page**

| Tool | Runs | What it does |
|---|---|---|
| `rank_next_parameters` | at once | Rank what to free next |
| `check_cell_symmetry` | at once | Check cell and space group |
| `check_fit_range` | at once | Check the fit range |
| `find_unexplained_peaks` | at once | Find unexplained peaks |
| `review_symmetry` | at once | Review the space group (last step) |
| `diagnose_fit` | at once | Diagnose the fit |
| `set_corrections` | asks first | Set the corrections |
| `add_antisite` | always asks | Add antisite disorder |
| `identify_peaks` | at once | Identify extra peaks |
| `add_known_phase` | always asks | Add a known phase |
| `set_instrument_constants` | always asks | Set X-ray instrument constants |
| `set_background` | asks first | Change the background |
| `set_microstrain` | asks first | Change the microstrain model |
| `set_site_ties` | asks first | Change the site ties |

**Powder page: the magnetic step**

| Tool | Runs | What it does |
|---|---|---|
| `magnetic_state` | at once | Read the magnetic analysis |
| `search_propagation_vector` | at once | Search the propagation vector |
| `set_propagation_vector` | asks first | Set the propagation vector |
| `select_magnetic_ions` | asks first | Choose the magnetic ions |
| `set_moment_ties` | asks first | Tie the moments |
| `rank_magnetic_groups` | at once | Rank the magnetic groups |
| `choose_magnetic_group` | asks first | Choose a magnetic group |
| `refine_moments` | asks first | Fit the moments |
| `show_magnetic_model` | asks first | Show the model on the refinement pattern |
| `continue_magnetic_refinement` | asks first | Refine nuclear and magnetic together |

**PDF page**

| Tool | Runs | What it does |
|---|---|---|
| `boxcar_scan` | asks first | Boxcar scan |

**Single-crystal page**

| Tool | Runs | What it does |
|---|---|---|
| `reflection_statistics` | at once | Read the reflection data |
| `reflection_equivalents` | at once | Compare a reflection's equivalents |
| `set_outlier_filter` | asks first | Set the outlier filter |
| `keep_reflections` | always asks | Keep failed measurements |
| `test_extinction` | asks first | Test the extinguished reflections |
| `omit_reflections` | asks first | Omit measurements |
| `set_radiation` | asks first | Set the radiation |
| `set_resolution_range` | asks first | Set the resolution range |
| `set_extinction_model` | asks first | Set the extinction model |
| `set_riding_hydrogens` | asks first | Ride the hydrogens |
| `merge_equivalents` | asks first | Merge the equivalents |
| `restrain_distances` | asks first | Restrain distances |
| `set_weighting` | asks first | Set the weighting scheme |
| `set_twin` | asks first | Set the twin law |
| `invert_structure` | asks first | Invert the structure |
<!-- LIVE_TOOLS:END -->

The full descriptions, as the model reads them with the skills and without
them, are the model-text snapshots in
[`src/agent/__snapshots__/`](../src/agent/__snapshots__), which a test keeps
current.

### What the code holds it to

- **The method first.** `read_skill` returns a skill whole, as Markdown (not
  cut to the ref budget), with the names of its references; with `reference`
  it returns one of them. Before its first change on a page, the Agent must
  have read that page's method in this conversation, and before the magnetic
  step's first change, `magnetic-analysis`; a change before that is refused
  with the call to make. Clearing the conversation resets it.
- **The firm rules are code** ([`src/agent/method.ts`](../src/agent/method.ts)),
  checked before the correlation probe. No occupancy refines bare, on any page:
  it needs a tie (on powder `set_site_ties`' Σ occ = 1 or hold composition; on
  single crystal `tie_parameters` `complement`; on PDF a shared site's Σ). The
  instrument's terms (the zero or TOF calibration, the peak shape and its
  asymmetry, Qdamp and Qbroad) never refine with the B values or ADPs, on the
  powder and PDF pages: the two groups alternate, and `refine` reports the
  `alternation`, settled once a cycle moves neither by more than 0.3 esd. Only
  the user lifts a rule: `allow_exception` (rule, reason) always asks, and the
  exception lasts until the data or the phases change.
- **No correlated parameters refined together.** Before the Agent's `refine`
  runs, and before the approval card appears, the page runs its own fit of the
  free set with no iterations (the port's `probe`): the normal matrix at the
  current values, over the same fit window, which gives the covariance the
  refinement would report without moving anything
  ([`src/core/diagnostics/correlationGuard.ts`](../src/core/diagnostics/correlationGuard.ts); the refusal's wording is [`src/agent/correlationCheck.ts`](../src/agent/correlationCheck.ts)). If
  two free parameters correlate at |ρ| ≥ 0.95, or the data cannot determine a
  combination of them at all (an SVD null direction, such as scale with every
  site occupancy), `refine` refuses and names them, with the physical reason
  for known pairs. The terms of one curve are exempt among themselves (the
  background coefficients, the Caglioti U, V, W of one FWHM²(θ)), and so are
  two occupancies tied by one restraint the user set; each against anything
  else still counts, as does the Lorentzian X ↔ Y. On the single-crystal page
  two more groups are listed rather than refused: the overall intensity terms
  (scale, extinction, batch scales), which every single-crystal program refines
  together, and the parameters of one disorder among themselves (SHELXL's PART
  1 and 2), which correlate near −1 by construction. A pair whose correlation a
  third free parameter carries (under 0.9 with every other free parameter held
  fixed, under 0.99 itself) is listed too, and `assess_refinement`, in the app
  and over MCP, notes rather than warns about the pairs the check lets through.
  A passing check puts the strongest remaining pair on the approval card. The check is measured on this
  data, so a pair the range separates (cell and zero over a wide 2θ range) is
  not refused. Pairs that tighten during the fit are listed in the outcome, and
  the next `refine` refuses them. The page's own Refine button is unchanged.
- **The cell check is a check, not a gate.** `check_cell_symmetry` never holds
  a refinement. Its reading sorts what it finds: one factor on every d (a
  wrong wavelength or difC), a peak no reflection indexes (a missing phase or
  a wrong cell), a Le Bail fit that did not settle (a start too far off: the
  Prefit), and intensity at forbidden reflections, which is a flag to note
  unless every flag is of the class the model's centring forbids (a possible
  lost centring, to put to the user).
- **The space group is questioned last.** `review_symmetry` reads the refined
  residual at the forbidden reflections and lists the same-lattice subgroups
  that allow those still carrying intensity (named, with their index and
  domain count). It refuses, naming the stages left, until scale, background,
  cell, positions, profile and ADPs have each been refined to convergence and
  the fit on screen is converged. Its result is a proposal for the user; a
  lower group is a new model, refined again from the start.
- **Misfits are not extra peaks.** `find_unexplained_peaks` keeps a residual
  peak only if it stands 5σ above that point's own uncertainty, and checks it
  against every phase's reflections: **on** one (within the line's width, at
  most 0.5 % in d), that reflection is calculated too weak; **beside** one
  (within three widths, at most 2 %) and on the line's own calculated
  intensity, its shoulder or tail (TOF peaks tail to larger d); both come back
  as `misfits`. Only a peak on no line, or resolved from it, is **unexplained**
  (an impurity, magnetic order, an unmodelled feature), counted and called an
  extra peak; `assess_refinement` reports the same split. The unexplained
  peaks are marked on the Rietveld plot with a filled ▽ (with `showMisfits`,
  the misfits too, hollow), each with a dashed guide, and listed under the plot
  (click to zoom; Clear). The marks go at the next refinement. Viewing only:
  no approval card, no History step.
- **The method's stages** are a checklist in the drawer and `get_state`'s
  `method`: on powder the fit range, the cell check, scale/background/cell,
  positions, profile, ADPs, then occupancy and corrections where the data call
  for them, and the symmetry review last; on PDF scale/cell, ADPs, correlated
  motion, positions, then occupancy and particle size; on single crystal the
  data, scale/extinction, twin fractions, positions, isotropic then
  anisotropic ADPs, and occupancy. A stage is done once a converged refinement
  had one of its parameters free, whoever ran it (the scale, refined with every
  stage, counts for the first only when nothing else is free), and stays done
  while it is on the History's path to the step on screen and each of its
  parameters holds the value the last refinement of it left: undo,
  `go_to_step`, a reset and a value typed in by hand take it back off. A
  refinement out of order runs, with a `methodNote` in its outcome.
- **The record** behind them (the reads of the fit range, the cell, the data
  and the symmetry, the diagnoses, where the fit started, the exceptions, the
  measurements kept at the user's word, the stages done, and the Agent's
  notes) is kept per analysis by the shell and saved with the project
  (`agent.records` in the project file; autosaved too). `get_state` lists the
  notes, so a later conversation or session starts from them.

### What some tools compute

- **`diagnose_fit`** ([`fitDiagnosis.ts`](../src/core/diagnostics/fitDiagnosis.ts))
  reads the residual cause by cause, each with its share of χ² and the action:
  peak width (the half-maximum widths of observed against calculated isolated
  lines), line shape (their Lorentzian fraction, read from height × FWHM ÷
  area), background (misfit where even a Lorentzian line of the observed width
  puts less than half a σ), peak positions (residual on one side of every
  peak), asymmetry (one-sided at low angle), width/shape (± lobes everywhere),
  intensity falling off with angle wrongly (ln(I_obs/I_calc) against
  sin²θ/λ²: a ΔB), texture (March–Dollase, averaged over each family's
  equivalents, fitted to the intensity misfit on each symmetry-distinct
  low-index axis; named only when shuffled misfits fit as well under 1 % of
  the time), and what is left for the structure; with the
  background-subtracted Rwp′, Durbin–Watson, χ² by d shell and the worst
  reflections. Once the Caglioti terms (and X) are all free and the widths
  agree within 10 %, a width/shape misfit is read as shape, not width. Its
  Durbin–Watson sentence is the report's.
- **`identify_peaks`** matches extra peaks against the sample environment (Al,
  V, Cu, steels, Nb, Pb), common holders and standards, and the impurities a
  synthesis leaves most often, each phase's lines computed for the pattern's
  radiation and allowed one d scale; candidates rank by the lines they explain
  (a line once, however many peaks sit on it), weighed by how plausible their
  cell is, and one whose strongest line is missing is called doubtful. A lead
  is named only when random peaks over the same range match a library phase as
  well less than 1 % of the time: 500 draws of as many peaks, each phase held
  to its own draws so a dense phase (corundum) needs more lines than a sparse
  one. `add_known_phase` adds a matched library phase
  (its cell, positions and B ≈ 0.5 Å²).
- **`sample_posterior`** runs the page's own Bayesian sampler, the ensemble
  MCMC of the Posterior view, over the free parameters of a converged fit;
  `continue: true` resumes the chain.
- **`write_report`** ([`report.ts`](../src/agent/report.ts)) builds the page's
  own report (Export ▾ → Report) with the analysis as it went: the History's
  steps on the path to the result, the method's checklist, the engine's checks
  ([`reportChecks.ts`](../src/agent/reportChecks.ts)) with the issues left
  open, the Bayesian check of the refinement on screen when one ran, and the
  Agent's notes. The Agent writes only `summary`; its decimal numbers are
  checked against the numbers the report computed
  ([`reportAudit.ts`](../src/core/export/reportAudit.ts)), and any that match
  none are underlined (HTML) or marked † (Markdown) and returned, so the Agent
  corrects them and writes again. The report opens in a viewer (Save HTML,
  Markdown, Print / PDF, CIF), and again from the drawer.
- **The magnetic step** publishes its controls as a handle on the powder port
  ([`magneticPort.ts`](../src/agent/magneticPort.ts)), so the Agent works it as
  the user does, and the page switches to it when a tool acts. Its last step
  hands the moment rows (and k's free components) to the refinement step,
  where `refine` fits nuclear and magnetic together.
- **`boxcar_scan`** refines the free parameters (or the scan's own `free` set,
  leaving the page's as they are) box by box across the fit window, each box
  seeded from the previous one, and returns each box's r range, Rw, values and
  esds, and each parameter's spread and its drift from the first box to the
  last in esds of that difference; `restarts` refines each box from that many
  perturbed starts as well, the seeded one kept (none unless asked). With
  `bonds`, each box's coordination shell in the structure it refined. The last
  scan goes into the report.
- **Units.** `get_state` lists the extent and fit window in each unit the
  pattern converts to (2θ, d, Q, TOF), with the full TOF calibration;
  `find_unexplained_peaks` gives each peak in d, Q and the data's own axis; and
  `set_fit_range` takes min/max in any of them, converted by the page with its
  own calibration. A model never converts by hand. A glob without a phase
  prefix (`pos_*`) matches every phase's rows of a multi-phase model.
- **Multi-phase:** after a refinement, `get_state` gives `phaseFractions`, each
  phase's weight fraction (Hill–Howard) with its esd and the basis it rests on.
- **On the PDF page** `assess_refinement` judges convergence, correlations,
  bounds and physical values, without the GoF verdict or the Bragg-peak
  residual scan.
- **On the single-crystal page**, the tools follow SHELXL's conventions:
  - *The data.* `reflection_statistics` reads merging (R_int, R_σ,
    redundancy, as SHELXL reports them and as `get_state` and the report
    quote them: in a non-centrosymmetric group the Friedel mates apart and the
    absences left out, the Laue class's R_int beside it), resolution and completeness by shell, whether the Friedel
    pairs were measured apart, the forbidden reflections measured at ≥ 3σ, and
    ⟨|E² − 1|⟩ (0.968 centrosymmetric, 0.736 not, lower for a twin; no test for
    a few sites on special positions), and how
    the data were measured (a Laue file's wavelength band, the batches, the
    transmission). `merge_equivalents` merges as MERG 2 (the Friedel opposites
    apart in a non-centrosymmetric group, the absences left out), while R_int,
    the statistics and the outliers still read the measurement (a file its
    data reduction merged already loses only its absences, and gives no
    R_int). A SHELX
    reflection file carries no radiation (it loads as neutron at 1.54 Å, or as
    X-rays at CELL's wavelength when a `.ins`/`.res` is the structure); a CIF
    that carries SHELXL's `.hkl` loads as the measurement, at its radiation. A
    `.ins`/`.res` loads as the structure, and what its refinement applied
    (TWIN, BASF, EXTI, WGHT, FVAR, AFIX, the hydrogens' U) is listed by
    `get_state` (`shelxInstructions`) and applied only when the Agent sets it.
  - *Outliers.* `assess_refinement` computes `failedMeasurements` (off by
    themselves at 6σ or more, their equivalents agreeing with the model), and
    `write_report` refuses while one is still fitted, neither left out
    (`omit_reflections`, SHELXL's OMIT h k l, with the reason) nor kept by the
    user (`keep_reflections`). `set_outlier_filter` is SHELX's wholesale OMIT
    at a |Fo² − Fc²|/σ cutoff, with `minExtinction` for a cut in y.
  - *Extinction.* `test_extinction` refines twice as probes, with and without
    the reflections of y below the cut (0.5 by default), and lists every free
    parameter that moves by more than 2 esd between them, the esd of the fit
    without them (leaving data out widens every esd); `set_extinction_model` switches
    between SHELXL's EXTI and Becker–Coppens type I or II (Gaussian or
    Lorentzian mosaic), as GSAS-II computes it; `set_resolution_range` limits
    the fit to a d range (SHELXL's SHEL), for a high-order refinement.
  - *Twins and the hand.* `reflection_statistics` lists each merohedral twin
    law (`twinLaws`) with the fraction Yeates' H-test reads for it: over the
    acentric pairs (h, R·h), ⟨|H|⟩ = ½ − α; in a centrosymmetric group, over
    all of them by the centric distribution, ⟨|H|⟩ = (2/π)(1 − 2α). `set_twin`
    adds a law as TWIN and BASF: the inversion (its fraction is the Flack x) or
    a 3×3 merohedral law, `withInversion` for both hands (TWIN R −4, the
    inverted domains summed into the Flack x with its esd from the
    covariance); a law that cannot twin the crystal is refused.
    `invert_structure` inverts the model (MOVE 1 1 1 −1, the space group to its
    enantiomorph, or the origin shifted where the group needs it).
    `assess_refinement`'s `absoluteStructure` gives Parsons' x from the Bijvoet
    pairs. In a polar group the fit holds the floating origin by SHELXL's
    restraint.
  - *Hydrogens, restraints, disorder.* `set_riding_hydrogens` rides them as
    AFIX does (43, 137, 147, 23, 13, 3), X–H at SHELXL's distance for the
    `temperature`, U_iso 1.2 or 1.5·U_eq or one refined U_iso per `sharedU`
    list; `refine` lets a hydrogen the data place refine its position while its
    U rides. `restrain_distances` adds DFIX and SADI, counted as SHELXL counts
    them. `tie_parameters` ties a disorder's occupancies (`complement`, 21/−21)
    and ADPs (`adp`, EADP).
  - *Weights.* `set_weighting` sets WGHT a b (on SHELXL's absolute scale), or
    the scheme SHELXL's criterion suggests for the model as it stands (each of
    ten Fc² bins' GooF nearest 1), re-evaluated at the fit's own Fc².
    `assess_refinement` adds the analysis of variance by intensity and by
    resolution (K and GooF per bin), the extinction reading, K and R1 by batch,
    the largest outliers read against their equivalents, and the tensors that
    are not positive definite.
  - *The fit and the results.* `refine` runs until every shift is below
    0.05 esd and answers with R1, wR2 and GooF before and after.
    `structure_table` gives U^ij and U_eq with esds and the cell with the
    structure file's esds (with `against: "loaded"`, each site against the
    structure as loaded), and `bond_geometry` each length's esd and, in a
    molecule, its rings' centroid contacts and its hydrogen bonds as HTAB finds
    them. The report's "Refinements compared" lists the last refinement under
    each set of conditions (extinction model, resolution range, omissions,
    filter, twin, hand, weighting scheme), so a test can be quoted; wR2 and
    GooF compare only under one weighting scheme, and the check says so when
    the entries differ in it. The report gives displacements as U (U_eq and
    U_iso, Å²), SHELXL's and the CIF's convention.

### Where the agent is

While the drawer is open, the shell writes the cards the agent is on to the
root element (`data-agent-focus`), and their edges breathe
([`src/agent/focus.ts`](../src/agent/focus.ts)). A card is "on" when:
- a running or waiting tool call acts on it (`refine` the parameters and the
  pattern, `check_cell_symmetry` the structure and the pattern, …);
- the latest reply names it in its last paragraph (for 8 s after the reply);
- the pointer is over a reply that names it.

### Long sessions

([`src/agent/contextWindow.ts`](../src/agent/contextWindow.ts)) With Claude,
the API clears old tool results once the prompt passes 60k tokens (context
editing), keeping the last six and every `read_skill` result; server-side
clearing is not an edit of the history the model's thinking is bound to. A
local server instead cuts a prompt longer than its window without a word, so
for Ollama, LM Studio and the OpenAI API every request is sized to the model's
window (`fitWindow` in [`chatBudget.ts`](../src/agent/chatBudget.ts)): the instructions,
the tools and room for the reply first; then the history, its old tool results
turned into digests (the tool, its ref, its key values, and whether a change
ran since; `read_ref` opens the whole) in batches, so the server's prompt cache
keeps the conversation; a skill read again keeps only its latest copy; when
nothing else is left, a method read before the latest shrinks to its outline,
its headings with its Gates section whole (`read_skill` gives it whole again).
A prompt that still cannot fit is refused with why, never sent cut, and the
reply is capped at the room left. Tokens are first counted at 3 characters
each, then measured from the server's own counts; once a server has counted a
whole prompt, a count far below the estimate means it cut one after all, and
nothing that reply asked for runs. The stored history is never touched.

### Stalls and loops

The chat loop watches for three ways a reply leaves the user waiting on
nothing: a reply that promises a call it does not make ("Starting the cell
check now."), an empty reply after a tool result, and "waiting for" a tool that
already answered. It then tells the model so and lets it go on, at most twice
per message, and says so in the conversation. A reply that asks the user or
stops at a gate is left alone. A reply (or its reasoning) that starts
repeating one phrase over and over is stopped, keeping the text up to the first
repeat so the conversation stays valid.

A model that loses track calls the same tool again and again. The chat
remembers each call, the state it ran at (a fingerprint of everything a tool
can change) and its answer: a call repeated at the same state with the same
answer gets a note from the app; the third is not run, and the turn stops with
where the analysis stands and what to tell the Agent; so do four repeats of any
kind, and, on a local model, 20 read calls in a row that change nothing.

### An answer without its evidence

A final answer is sent back to the model once, with what to run, and the
conversation says so ([`src/agent/evidence.ts`](../src/agent/evidence.ts)),
when it concludes:
- on the PDF page, about the local structure against the average one, with
  no boxcar scan;
- on the single-crystal page, about the hand, with no absolute-structure
  reading (`assess_refinement` or the report) taken after the last change of
  the fit;
- on any page, a grade of a fit that changed in this message, with no
  assessment after the change; or a grade two bands or more from the
  engine's verdict, or across the line between fair and good.

The rules read the message's calls with what each came to and whether the
fit on screen changed. A refused or declined change changes nothing, and a
reading or a scan counts only when it answered.

### Five ways to reach a model

| Mode | Where the model runs | Credentials | Works on |
|---|---|---|---|
| API key | the browser, with the Anthropic SDK | your Anthropic API key, kept in this browser | the dev server and the published site |
| Local proxy | the browser; the dev server forwards to the API | `ANTHROPIC_API_KEY` where the dev server runs (or `.env.local`) | `npm run dev`, `npm run preview` |
| Ollama | your Ollama server (a local model) | none | the dev server; the published site once Ollama allows its origin |
| LM Studio | your LM Studio server (a local model) | none | the dev server and the published site, with CORS on in LM Studio |
| OpenAI API | any server that speaks OpenAI's API: OpenAI, Gemini, vLLM, a llama.cpp server | that server's key, if it needs one, kept in this browser | wherever the server admits the page's origin |

- **API key.** Claude Opus 5.5 by default (Sonnet 5.5 and Haiku 5.5 on offer),
  adaptive thinking, streamed. Every turn stays on the chosen model: the API's
  refusal fallback to another model is an opt-in setting, and a turn another
  model answered is announced. The key is kept for the tab unless you tick
  Remember; it is never written to a project, autosave, or report. The system
  prompt carries the role and the index of skills, and is cached across turns.
- **Local proxy.** `<base>api/anthropic/` on the dev and preview servers
  ([`src/agent/proxy.ts`](../src/agent/proxy.ts)). The page sends its
  requests there, and the server adds the key from `ANTHROPIC_API_KEY` and
  forwards them to api.anthropic.com, so the key never reaches the browser.
  Only the app's own pages may use it. The static build has no proxy.
- **Ollama.** The same chat loop, tools and approvals drive a local model
  through Ollama's native `/api/chat`, translated to and from the Messages
  API ([`src/agent/ollamaNative.ts`](../src/agent/ollamaNative.ts)): it is
  the only Ollama endpoint that takes a context length, and Ollama cuts a
  prompt longer than its default context without a word. Each request asks
  for the context the model is loaded with, or 32k, or the smallest step of
  8k that holds the conversation, up to the model's maximum, and is refused
  with why when even that cannot hold it. The page talks to the server
  directly (default `http://localhost:11434`) and lists its models from
  `/api/tags`; models that cannot call tools are shown but not offered.
  Requests carry only plain headers, which Ollama's CORS rules admit, and only
  the fields Ollama reads (no caching, effort or fallback). Ollama's defaults
  allow pages on `localhost`; for the published site, start Ollama with
  `OLLAMA_ORIGINS` set to its address. The instructions alone are about 15k
  tokens, so pick a model with at least a 32k context. A smaller model follows
  a long method less reliably than a large one; Ask first is the guard.
- **LM Studio.** LM Studio 0.4.1 and later answer the same Messages API at
  `<server>/v1/messages` ([`src/agent/lmstudio.ts`](../src/agent/lmstudio.ts)),
  so it runs the same loop with the same plain headers and request fields as
  Ollama. The page talks to the server directly (default
  `http://localhost:1234`) and lists its language models from
  `/api/v1/models`, those trained for tool use first; LM Studio can offer tools
  to the others too, so they stay selectable with a note. LM Studio admits no
  other origin until **Enable CORS** is on in its server settings (or
  `lms server start --cors`), and its server has its own port, so this is
  needed even for the dev server. A model loads with the context length set
  for it in LM Studio, often far below what the Agent needs, and LM Studio cuts
  a prompt that does not fit from the middle. So before each message the Agent
  loads a model that is not loaded with 32k (`/api/v1/models/load`), and will
  not send to one loaded with less: it says how to reload it, and never
  unloads a copy another program may be using.
- **OpenAI API.** Any server that speaks OpenAI's API: a base URL (with its
  `/v1`), a key if it needs one (kept as Anthropic's is: for the tab, or with
  Remember; never in a project or a report), and a model from
  `<base>/models`. Chat goes through `<base>/chat/completions` with tools,
  translated to and from the Messages API by a fetch the SDK uses
  ([`src/agent/openaiCompat.ts`](../src/agent/openaiCompat.ts)), so the loop
  is the same. The model's context is the server's own when it says (vLLM's
  `max_model_len`, a llama.cpp server's `n_ctx`), else the one in the
  settings (32k by default). Presets: OpenAI, Gemini's OpenAI-compatible
  endpoint, vLLM, a llama.cpp server, or any other address.

**A local model's tools.** Every tool's description and schema goes with every
request, and together with the instructions they take more than half of a
32k-token window before the conversation begins. So a local model (and an
OpenAI-API model below a 128k context) is offered the core (the state, the
method, refs, notes, freeing and refining, undoing, the report), the page's
tools, and on the powder page those of the method's current and next stage;
what the user's words ask for (a magnetic structure, an impurity, the
symmetry…) and every tool it has used are added
([`src/agent/toolScope.ts`](../src/agent/toolScope.ts)).

### How it is tested

[`src/agent/`](../src/agent) tests run the tools on a real powder fit, a real
PDF fit and single-crystal pages (the refinement engine, the assessment),
the chat loop against a stand-in API that streams scripted turns (as Claude,
Ollama and LM Studio), the Ollama and LM Studio model listings against
stand-in servers, and the proxy against a stubbed upstream.

**The eval suite** ([`src/agent/evals/`](../src/agent/evals)) grades the
Agent's behaviour, not its code: each scenario is a page built from the
repository's own data, what the user says, what they approve, and the checks
the run must pass, run through the real chat loop, executor and tools with only
the model varying. Each guards against a failure that was found. In CI every
scenario is replayed with a scripted model twice: as the Agent should behave,
where every check passes, and as it behaved when the failure was found, where
the checks written against it must fail. Against a real model,
`MATERIA_AGENT_EVAL=1 ANTHROPIC_API_KEY=… npm run eval:agent` runs every
scenario. [AGENT_EVALS.md](./AGENT_EVALS.md) lists the scenarios and the
failure each guards against, the run's options, the local tier, and the
results.

## Planned

Tool slices, in priority order (names are provisional):

| Slice | Tools | Wraps |
|---|---|---|
| Exports and project files | `export_cif` / `export_mcif`, `generate_report`, `save_project` / `load_project` | `core/export`, `core/project` |
| Single-crystal refinement | `build_single_crystal_refinement`, `refine_single_crystal` | `workflow/singleCrystalRefinement` |
| Absorption | `attenuation_coefficient`, `transmission_correction`, `index_crystal_faces` (or one `correct_absorption`) | `core/absorption` |
| Microstructure | `extract_size_strain` | `diffraction/microstructure` |

Other planned work:
- One more worked example: a Rietveld refinement driven by the skill (the cell
  check, the freeing blocks, the symmetry review, the cross-check bundle).
- Expose `knowledge/*.md` as **MCP resources**, so an agent can read the domain
  knowledge the tools assume.
- Richer per-tool JSON schemas.
- An assessment variant for magnetic refinements.
- The Agent on the magnetic PDF step, through its own port; PDF symmetry
  modes as tools.

The order across the whole project is in [ROADMAP.md §5](./ROADMAP.md).

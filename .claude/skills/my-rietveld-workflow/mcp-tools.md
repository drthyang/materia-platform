# My Rietveld workflow — the MCP tool map

The method's steps on the MATERIA MCP tools, for a refinement driven over MCP. In the app
the powder page holds the inputs, and `set_free` with `refine` stand in for
`build_refinement` and `refine_powder`.

| Step | Tool |
|------|------|
| Load | `parse_structure`, `parse_powder_data`, `parse_instrument` |
| The fit range (first) | `check_fit_range` (the data's ends: where to start and stop; in the app, then `set_fit_range`) |
| Cell sanity check (start) | `check_cell_symmetry` (Le Bail cell, unindexed peaks, absence flags) |
| Build param set + staged plan | `build_refinement` |
| Run a refinement block | `refine_powder` |
| Judge a block / the fit | `assess_refinement` |
| Decide what's limiting the fit | `rank_next_parameters`, `suggest_next_steps` |
| Unexplained peaks against misfits | `find_unexplained_peaks` |
| Geometry / bonds sanity | `bond_geometry`, `interpret_structure` |
| Cross-check export | `export_bundle` (`fullprof` + `gsas2`, into `outDir`) |
| The written report (in the app) | `write_report` |
| Magnetic handoff | `build_magnetic_model`, `list_magnetic_subgroups`, `refine_magnetic_powder` |
| Symmetry review (last, if at all) | `review_symmetry` on the converged residual; then the `symmetry-review` skill |

**The cross-check bundles.** `export_bundle` with `target` `"fullprof"` and `"gsas2"`, the
refine call's `parameters` and `result`, the original instrument file as `rawInstrument`,
and an `outDir`; give the user the paths. The `.pcr` starts scale, background and the CW
peak shape from seeds — say so, since they must be freed in FullProf before the comparison
means anything.

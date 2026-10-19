# PDF workflow — the MCP tool map

The method's steps on the MATERIA MCP tools, for a fit driven over MCP. In the app the PDF
page holds the inputs, and `set_free` with `refine` stand in for `build_pdf_model` and
`refine_pdf`; `boxcar_scan` for `refine_pdf_boxcar`.

| Step | Tool |
|------|------|
| Load | `parse_structure`, `parse_pdf_data` |
| Build the model | `build_pdf_model` |
| Instrument resolution from a standard | `calibrate_qdamp` |
| Run a refinement block | `refine_pdf` |
| Local vs average | `refine_pdf_boxcar` |
| Partial PDFs (which pairs make a peak) | `compute_partial_pdf` |
| Judge a block / the fit | `assess_refinement` |
| Geometry / bonds sanity | `bond_geometry`, `interpret_structure` |
| The written report (in the app) | `write_report` |

# Mn₃Ga at 350 K, POWGEN (published data)

Neutron time-of-flight powder data of Mn₃Ga at 350 K from SNS POWGEN (run PG3_45598, bank 1), with the published refined structure. The data and structure are published. © 2026 Tsung-Han Yang.

- `PG3_45598_Bank1.fxye`, `PG3_45598_Bank1.instprm`: the pattern and its instrument parameters.
- `Mn3Ga-mag_53_350K_Final_ortho.cif`: the published refined structure (GSAS-II).
- `Mn3Ga_350K_workbench_refined.mcif`: MATERIA's refinement of it (BNS group C m′c m′).

The 350 K golden tests (`mn3ga350KGolden.test.ts`, `magneticMultiStartGolden.test.ts`) and the 350 K CIF parser tests read these files when the git-ignored `data/` folder has no copy (`src/testSupport/data.ts`), so they run in CI. `Mn3Ga_350K_nuclear.cif` is the published structure in its parent group C m c m with no moments, a starting model for a magnetic demo that finds the order from the data.

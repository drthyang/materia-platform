# GaTa₄Se₈ at 300 K, NOMAD bank 4 (published data)

Neutron time-of-flight powder data of GaTa₄Se₈ at 300 K from the NOMAD diffractometer, bank 4, the data of the bundled example "GaTa₄Se₈ neutron TOF" on MATERIA's landing page. The data are published:

T.-H. Yang et al., Phys. Rev. Research 4, 033123 (2022).

A portion of this research used resources at the Spallation Neutron Source, a DOE Office of Science User Facility operated by the Oak Ridge National Laboratory. NOMAD (BL-1B), IPTS-26313, run 160894, 300 K.

© 2026 Tsung-Han Yang.

## The file

`NOM_GaTa4Se8_at_300K_bank4.gsa` is bank 4 of the six-bank GSAS file `NOM_GaTa4Se8_at_300K.gsa` (FXYE: time of flight in µs, intensity, esd). It keeps the file's header and bank 4's own lines (its flight path, 2θ and DIFC comment, and the `BANK 4` record) and its 2999 data lines with every number as written; only the column padding and the line ends are made plain (one space between columns, LF). No other bank is in the repository. MATERIA reads 2906 points of it: the points with neither counts nor an esd are left out, as for any GSAS file.

## The instrument

The example uses bank 4 of the NOMAD 2023A instrument file that MATERIA ships as a default (`examples/instruments/nomad/`; its origin and limits are in `examples/instruments/nomad/README.md`). The file's profile and calibration rows are held at the file's values. The file belongs to run cycle 2023A; the Instrument card says so while it is in use.

## The refinement the example opens on

- Model: GaTa₄Se₈, F-43m, from the owner's model (origin at Ga, 4c; sites Ga1, Ta1, Se1, Se17), with an isotropic B per site.
- Window: the whole pattern, 1137–17339 µs. Below d 0.209 Å the instrument file gives no peak width (σ² ≤ 0), so no reflection is calculated there and those 545 points are left out of the fit and of wR: the fit counts 2361 points (d 0.209–1.92 Å).
- Background: Chebyshev, 7 terms.
- Refined: scale, background, cell a; the sample profile (Lorentzian microstrain and size; the Gaussian microstrain held at 0, as it correlates with the background); B per site; the three position modes. Staged: scale, background and a first, then the profile and the structure in turn, five times each.
- Result: status converged, no near-null direction. wR 2.50 %, GoF 5.89 (16 free rows).

| | value |
|---|---|
| a (Å) | 10.37571(10) |
| B Ga1 (Å²) | 0.35(5), U = 0.0044(6) |
| B Ta1 (Å²) | 0.353(19), U = 0.0045(2) |
| B Se1 (Å²) | 0.46(3), U = 0.0059(4) |
| B Se17 (Å²) | 0.42(3), U = 0.0053(4) |
| Lorentzian microstrain | 0, at its lower bound |
| size (µm) | 0.0383(9) |

The example opens with scale, background and a free and the other rows held at these values; Refine from there converges where it stands (wR 2.50 %, GoF 5.88 with those nine rows free).

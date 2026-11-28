# GaTa₄Se₈ at 300 K, NOMAD, six banks (published data)

Neutron time-of-flight powder data of GaTa₄Se₈ at 300 K from the NOMAD diffractometer, all six banks, the data of the bundled example "GaTa₄Se₈ neutron TOF" on MATERIA's landing page. The data are published:

T.-H. Yang et al., Phys. Rev. Research 4, 033123 (2022).

A portion of this research used resources at the Spallation Neutron Source, a DOE Office of Science User Facility operated by the Oak Ridge National Laboratory. NOMAD (BL-1B), IPTS-26313, run 160894, 300 K.

© 2026 Tsung-Han Yang.

## The file

`NOM_GaTa4Se8_at_300K.gsa` is the six-bank GSAS file (FXYE: time of flight in µs, intensity, esd) as written, byte for byte, line ends included. All six banks are included, 2999 data lines each; the refinement the example opens on is bank 4. The Data card's bank chooser lists banks 1–6, so another bank can be read from the example; the values on the page are kept on a switch, and no refinement of another bank is shipped. MATERIA reads 2906 points of bank 4: the points with neither counts nor an esd are left out, as for any GSAS file.

## The instrument

The example uses bank 4 of the NOMAD 2023A instrument file that MATERIA ships as a default (`examples/instruments/nomad/`; its origin and limits are in `examples/instruments/nomad/README.md`). The file's profile and calibration rows are held at the file's values. The file belongs to run cycle 2023A; the Instrument card says so while it is in use.

## The refinement the example opens on (bank 4)

- Model: GaTa₄Se₈, F-43m, from the owner's model (origin at Ga, 4c; sites Ga1, Ta1, Se1, Se2, where Se2 is the owner's "Se17"), with an isotropic B per site.
- Window: 3000–16000 µs (d 0.331–1.773 Å), 1785 points, the owner's choice. It lies above d 0.209 Å, below which the instrument file gives no peak width (σ² ≤ 0), so every point in it is fitted. The Instrument card still says "No peak width below d 0.209 Å": that note reads the whole data range, not the window.
- Two peaks that no phase explains, at 17209 and 17274 µs (d ≈ 1.91 Å, up to 9σ), lie outside the window. Each is one data point wide, narrower than this instrument's line width there, and they sit where the bank's points carry 3.4× the relative σ of the middle; what they are is not known.
- Background: Chebyshev, 7 terms.
- Refined: scale, background, cell a; the sample profile (Lorentzian microstrain and size; the Gaussian microstrain held at 0, as it correlates with the background); B per site; the three position modes. Staged: scale, background and a first, then the profile and the structure in turn, fifteen times each; the last structure stage moved nothing by more than 0.001 esd.
- Result: status converged, no near-null direction (the high correlations are among the background terms). wR 2.21 %, GoF 5.72 (16 free rows).

| | value |
|---|---|
| a (Å) | 10.37596(10) |
| B Ga1 (Å²) | 0.31(5), U = 0.0039(6) |
| B Ta1 (Å²) | 0.343(19), U = 0.0043(2) |
| B Se1 (Å²) | 0.44(3), U = 0.0056(4) |
| B Se2 (Å²) | 0.39(3), U = 0.0050(4) |
| Lorentzian microstrain | 424(79) |
| size (µm) | 0.0464(15) |

The example opens with scale, background and a free and the other rows held at these values; Refine from there converges where it stands (wR 2.21 %, GoF 5.71 with those nine rows free).

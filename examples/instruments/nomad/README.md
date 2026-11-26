# NOMAD default instrument parameters (run cycle 2023A)

`NOMAD_2023A_five_banks_Shifter_Si_640e_instrument_file.instprm` is the GSAS-II instrument parameter file of the NOMAD diffractometer (SNS, beamline BL-1B, Oak Ridge National Laboratory) for run cycle 2023A, from a calibration with the NIST silicon standard SRM 640e in the sample shifter. It is the file the beamline distributes in its 2023A documentation package for GSAS-II users.

It is the facility's file, not MATERIA's. It is shipped here unchanged, byte for byte (CRLF line ends included; `.gitattributes` keeps them), so that MATERIA can offer it as a default when NOMAD data are loaded without an instrument file. Only this file is shipped: no GSAS-II project, no data, no parameter sets for other programs.

## What to know before using it

- **One run cycle.** The calibration belongs to run cycle 2023A. Instrument calibrations change between run cycles: for data from any other cycle, use the instrument file the beamline gave you for that cycle. A wrong calibration shifts peak positions and changes peak widths, and a fit can hide that in the cell, the zero and the sample broadening. MATERIA says so on the Instrument card, in the report and in an exported bundle for as long as this default is in use.
- **Five banks.** The file has banks 1 to 5. The beamline's note with the file: "bank0 was not included due to poor resolution and statistics". A NOMAD data file with six banks therefore has one bank (the lowest-angle one, the sixth in a GSAS file) with no instrument bank here; MATERIA offers no default for it.
- **GSAS-II's sample broadening is assumed.** A GSAS-II calibration of this kind is refined with GSAS-II's default sample terms (size 1 µm, Lorentzian microstrain 1000 × 10⁻⁶) in place, so its profile values describe the instrument only together with them. MATERIA loads the profile rows as the file gives them and sets GSAS-II's default sample rows beside them.
- **A known oddity in bank 1.** The file's bank 1 states `2-theta:150.0` and `fltPath:25.0`, while NOMAD's first bank is at about 15° with a total flight path near 21.5 m. The values are left as they are. MATERIA uses neither field in the calculation; the bank's `difC` is consistent with the DIFC that NOMAD data files state for their first bank. The Instrument card's bank list shows "2θ 150°" for bank 1 for this reason.

## Use in MATERIA

`src/app/defaultInstruments.ts` lists the default instrument files, one row per instrument. The app reads this file only when the default is offered (it is not part of the first load), through the same reader as a file you load yourself, and keeps its text in the project.

"""Synthetic calibration standards for the instrument-calibration workflow, written to
src/testSupport/calibrationKnownTruth.json (read by src/app/instrumentCalibration.test.ts).

  python simulate_standards.py          (GSAS-II's Python; GSAS2_ROOT names GSAS-II)

GSAS-II itself calculates each pattern (GSASIIscriptable, no refinement cycle) from a known instrument
bank of the synthetic scripts/tof-profile/fixtures/synthetic_three_banks.instprm, with GSAS-II's
new-phase sample terms (size 1 um, Lorentzian microstrain 1000), on a flat background, with counting
noise from a fixed seed. The standards are at their certified 22.5 C cells:

  Si    NIST SRM 640e  a = 5.431179 A, Fd-3m (origin 2), Si on 8a, Uiso 0.0055 A^2 (synthetic)
  LaB6  NIST SRM 660c  a = 4.156826 A, Pm-3m, La on 1a, 11B on 6f (x, 1/2, 1/2), x = 0.1996,
                       Uiso(La) 0.0030, Uiso(B) 0.0035 A^2 (synthetic values, not literature)

Each case also holds a starting file: the truth bank with its calibrated terms moved off (difC by
3e-4, the zero by 3 us, difA, alpha, beta, sigma, X, Y by tens of percent), which the calibration
must bring back. The terms the calibration does not refine (difB, beta-q, sig-q, Z) are the truth's.
"""
import json
import os
import shutil
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tof-profile"))
import programs as prog  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "src", "testSupport", "calibrationKnownTruth.json")
INST = os.path.join(HERE, "..", "tof-profile", "fixtures", "synthetic_three_banks.instprm")
BACKGROUND = 40.0
STANDARDS = {
    "si640e": {"phase": "Si", "a": 5.431179, "sg": "F d -3 m:2", "sites": [("Si1", "Si", (0.125, 0.125, 0.125), 0.0055)]},
    "lab6660c": {"phase": "LaB6", "a": 4.156826, "sg": "P m -3 m", "sites": [("La1", "La", (0.0, 0.0, 0.0), 0.0030), ("B1", "B", (0.1996, 0.5, 0.5), 0.0035)], "isotope": {"B": "11"}},
}
# The starting file's offsets from the truth: (term, kind, amount); "rel" multiplies by 1 + amount.
OFFSETS = [("difC", "rel", 3e-4), ("Zero", "abs", 3.0), ("difA", "abs", 1.5), ("alpha", "rel", 0.3), ("beta-0", "rel", 0.25),
           ("beta-1", "abs", 0.004), ("sig-0", "abs", 15.0), ("sig-1", "rel", 0.3), ("sig-2", "rel", -0.2), ("X", "abs", 2.0), ("Y", "abs", -2.0)]
KEYS = ["Type", "Bank", "2-theta", "fltPath", "Azimuth", "Zero", "difC", "difA", "difB", "alpha", "beta-0", "beta-1", "beta-q",
        "sig-0", "sig-1", "sig-2", "sig-q", "X", "Y", "Z"]


def cif(std):
    s = STANDARDS[std]
    lines = [f"data_{s['phase']}"] + [f"_cell_length_{x} {s['a']}" for x in "abc"] + [f"_cell_angle_{x} 90" for x in ("alpha", "beta", "gamma")]
    lines += [f"_symmetry_space_group_name_H-M '{s['sg']}'", "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x",
              "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_occupancy", "_atom_site_U_iso_or_equiv"]
    lines += [f"{lab} {el} {x} {y} {z} 1 {u}" for lab, el, (x, y, z), u in s["sites"]]
    return "\n".join(lines) + "\n"


def bank_text(values, bank):
    out = [f"#Bank {bank}: GSAS-II instrument parameter file; do not add/delete items!"]
    for k in KEYS:
        v = values[k] if k != "Type" else "PNT"
        out.append(f"{k}:{v}")
    return "\n".join(out) + "\n"


def start_values(truth):
    s = dict(truth)
    for k, kind, amt in OFFSETS:
        s[k] = truth[k] * (1 + amt) if kind == "rel" else truth[k] + amt
    return s


def simulate(std, bank, dmin, dmax, peak_counts, seed):
    from GSASII import GSASIIscriptable as G2sc
    p = prog.read_instprm(INST, bank)
    lo, hi = prog.gsas2_terms(p, dmin)["pos"], prog.gsas2_terms(p, dmax)["pos"]
    work = tempfile.mkdtemp(prefix="calkt_")
    try:
        cf = os.path.join(work, "std.cif")
        open(cf, "w").write(cif(std))
        gpxfile = os.path.join(work, "std.gpx")
        gpx = G2sc.G2Project(newgpx=gpxfile)
        phase = gpx.add_phase(cf, phasename=STANDARDS[std]["phase"], fmthint="CIF")
        for el, iso in STANDARDS[std].get("isotope", {}).items():
            phase.data["General"]["Isotope"][el] = iso
        hist = gpx.add_simulated_powder_histogram("sim", INST, lo / 1000.0, hi / 1000.0, Tstep=4.0e-4, phases=[phase], scale=1.0, ibank=bank)
        for hap in phase.data["Histograms"].values():
            assert hap["Size"][1][0] == 1.0 and hap["Mustrain"][1][0] == 1000.0 and hap["Mustrain"][1][2] == 1.0, "new-phase sample terms"
        bk = hist.data["Background"][0]
        for i in range(3, len(bk)):
            bk[i] = 0.0
        gpx.data["Controls"]["data"]["max cyc"] = 0
        gpx.save()
        gpx.do_refinements([{}])
        gpx = G2sc.G2Project(gpxfile)
        hist = gpx.histograms()[0]
        x = np.array(hist.getdata("x"), float)
        yc = np.array(hist.getdata("ycalc"), float) - np.array(hist.getdata("background"), float)
        gen = gpx.phases()[0].data["General"]
        b_used = {el: {"isotope": gen["Isotope"][el], "SL": [float(v) for v in gen["Isotopes"][el][gen["Isotope"][el]]["SL"]]} for el in STANDARDS[std].get("isotope", {})}
    finally:
        shutil.rmtree(work, ignore_errors=True)
    y = yc * (peak_counts / yc.max()) + BACKGROUND
    rng = np.random.default_rng(seed)
    truth = {k: p.get(k, 0.0) for k in KEYS if k != "Type"}
    truth["Bank"] = float(bank)
    return {"standard": std, "bank": bank, "x": [round(float(v), 3) for v in x], "yNoisy": [int(v) for v in rng.poisson(np.maximum(y, 0))],
            "truth": truth, "startInstprm": bank_text(start_values(truth), bank), "dRange": [dmin, dmax], "gsas2Isotope": b_used}


def main():
    if prog.gsas2_module() is None:
        sys.exit("GSAS-II is not importable (GSAS2_ROOT)")
    cases = {
        "si640e_bank2": simulate("si640e", 2, 0.55, 3.2, 40000.0, 21),
        "si640e_bank3": simulate("si640e", 3, 0.55, 3.2, 40000.0, 22),
        "lab6660c_bank2": simulate("lab6660c", 2, 0.55, 4.2, 40000.0, 23),
        "lab6660c_bank3": simulate("lab6660c", 3, 0.55, 4.2, 40000.0, 24),
    }
    json.dump({"note": "written by scripts/instrument-calibration/simulate_standards.py; do not edit", "instrumentFile": "scripts/tof-profile/fixtures/synthetic_three_banks.instprm",
               "background": BACKGROUND, "standards": {k: {"cif": cif(k), "a": v["a"], "uiso": {lab: u for lab, _, _, u in v["sites"]}} for k, v in STANDARDS.items()},
               "cases": cases}, open(OUT, "w"), separators=(",", ":"))
    for k, c in cases.items():
        print(k, len(c["x"]), "points", c["x"][0], c["x"][-1], "max", max(c["yNoisy"]), c["gsas2Isotope"])


if __name__ == "__main__":
    main()

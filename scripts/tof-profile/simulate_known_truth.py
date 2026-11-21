"""Known-truth patterns for the time-of-flight profile, written to
src/testSupport/tofKnownTruth.json (read by src/core/workflow/tofKnownTruth.test.ts).

  python simulate_known_truth.py          (GSAS-II's Python with scipy; GSAS2_ROOT names GSAS-II)

Silicon (Fd-3m, a = 5.4310 A, Uiso = 0.0060 A^2: a public structure), on banks of the synthetic
fixtures/synthetic_three_banks.instprm.

  gsas2_*      calculated by GSAS-II itself (GSASIIscriptable, no refinement cycle) from the
               instrument file and the phase's sample terms: its own structure factors, its own
               peak routine, its own peak range.
  reference_*  calculated here, with nothing of GSAS-II or of the app: diamond-structure factors
               written out by hand, and the peak of reference.py, in each program's form.

Each case holds the abscissa, the calculated pattern on a flat background, and the same pattern
with counting noise from a fixed seed.
"""
import json
import math
import os
import shutil
import tempfile

import numpy as np

import programs as prog
import reference as ref

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "testSupport", "tofKnownTruth.json")
INST = os.path.join(HERE, "fixtures", "synthetic_three_banks.instprm")
A, UISO, B_SI = 5.4310, 0.0060, 4.1491       # A, A^2, fm (Sears 1992)
BACKGROUND = 40.0
CIF = f"""data_Si
_cell_length_a {A}
_cell_length_b {A}
_cell_length_c {A}
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M "F d -3 m:2"
loop_
_atom_site_type_symbol
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_U_iso_or_equiv
Si Si1 0.125 0.125 0.125 1 {UISO}
"""


def tof_range(p, dmin, dmax):
    return prog.gsas2_terms(p, dmin)["pos"], prog.gsas2_terms(p, dmax)["pos"]


def noisy(y, seed):
    rng = np.random.default_rng(seed)
    return rng.poisson(np.maximum(y, 0)).astype(float)


def gsas2_case(bank, size, mustrain, mix, peak_counts, seed):
    from GSASII import GSASIIscriptable as G2sc
    p = prog.read_instprm(INST, bank)
    lo, hi = tof_range(p, 0.62, 3.30)
    work = tempfile.mkdtemp(prefix="tofkt_")
    try:
        cif = os.path.join(work, "si.cif")
        open(cif, "w").write(CIF)
        gpxfile = os.path.join(work, "si.gpx")
        gpx = G2sc.G2Project(newgpx=gpxfile)
        phase = gpx.add_phase(cif, phasename="Si", fmthint="CIF")
        hist = gpx.add_simulated_powder_histogram("sim", INST, lo / 1000.0, hi / 1000.0, Tstep=4.0e-4, phases=[phase], scale=1.0, ibank=bank)
        for hap in phase.data["Histograms"].values():
            hap["Size"][1][0] = hap["Size"][1][1] = size
            hap["Mustrain"][1][0] = hap["Mustrain"][1][1] = mustrain
            hap["Mustrain"][1][2] = mix
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
        refl = np.array(hist.reflections()["Si"]["RefList"], float)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    y = yc * (peak_counts / yc.max()) + BACKGROUND
    return {"program": "gsas2", "bank": bank, "sample": {"size": size, "mustrain": mustrain, "mustrainMix": mix},
            "x": [round(float(v), 3) for v in x], "y": [float("%.8g" % v) for v in y], "yNoisy": [int(v) for v in noisy(y, seed)],
            "reflections": [{"h": int(r[0]), "k": int(r[1]), "l": int(r[2]), "d": float(r[4]), "pos": float(r[5]), "sig2": float(r[6]), "gam": float(r[7]),
                             "alpha": float(r[12]), "beta": float(r[13]), "intensity": float(r[9] * r[11])} for r in refl]}


def diamond_reflections(dmin, dmax):
    """(d, multiplicity * |F|^2 * d^4 * Debye-Waller) of silicon, by hand: F lattice (hkl all even or all
    odd), and of those |F|^2 = 64 b^2 for h+k+l = 4n, 32 b^2 for odd indices, 0 for h+k+l = 4n+2."""
    out = {}
    n = int(A / dmin) + 1
    for h in range(-n, n + 1):
        for k in range(-n, n + 1):
            for l in range(-n, n + 1):
                if (h, k, l) == (0, 0, 0) or len({h % 2, k % 2, l % 2}) != 1:
                    continue
                s = h + k + l
                f2 = 64.0 if (h % 2 == 0 and s % 4 == 0) else 32.0 if h % 2 else 0.0
                if f2 == 0.0:
                    continue
                d = A / math.sqrt(h * h + k * k + l * l)
                if not dmin <= d <= dmax:
                    continue
                dw = math.exp(-2 * (8 * math.pi**2 * UISO) / (4 * d * d))
                key = round(d, 9)
                out[key] = out.get(key, 0.0) + f2 * B_SI**2 * d**4 * dw
    return sorted(out.items())


def reference_case(bank, form, mustrain, size, gauss, peak_counts, seed):
    p = prog.read_instprm(INST, bank)
    lo, hi = tof_range(p, 0.62, 3.30)
    x = lo * np.exp(4.0e-4 * np.arange(int(math.log(hi / lo) / 4.0e-4) + 1))
    y = np.zeros_like(x)
    # The reflections inside the pattern's own d-range, as a refinement program takes them.
    for d, inten in diamond_reflections(0.62, 3.30):
        t = prog.gsas2_terms(p, d, size=size, mustrain=mustrain)
        sig2 = t["sig2"] + (abs(p["difC"] + 2 * p["difA"] * d - p["difB"] / d**2) * gauss * 1e-6 * d) ** 2
        y += inten * ref.b2b_pv(x - t["pos"], t["alpha"], t["beta"], sig2, max(t["gam"], 0.0), form=form)
    y = y * (peak_counts / y.max()) + BACKGROUND
    return {"program": "reference", "form": form, "bank": bank, "sample": {"size": size, "mustrain": mustrain, "mustrainMix": 1.0, "gauss": gauss},
            "x": [round(float(v), 3) for v in x], "y": [float("%.8g" % v) for v in y], "yNoisy": [int(v) for v in noisy(y, seed)]}


def main():
    cases = {}
    if prog.gsas2_module() is not None:
        cases["gsas2_bank2_new_phase"] = gsas2_case(2, 1.0, 1000.0, 1.0, 40000.0, 11)
        cases["gsas2_bank3_other_sample"] = gsas2_case(3, 0.25, 2600.0, 0.6, 40000.0, 12)
    else:
        print("GSAS-II is not importable: the gsas2_* cases are not written")
    cases["reference_bank2_gsas_form"] = reference_case(2, "gsas", 1000.0, 1.0, 0.0, 40000.0, 13)
    cases["reference_bank3_fullprof_form"] = reference_case(3, "fullprof", 1800.0, 0.5, 900.0, 40000.0, 14)
    json.dump({"note": "written by scripts/tof-profile/simulate_known_truth.py; do not edit", "structure": {"cif": CIF, "a": A, "uiso": UISO},
               "background": BACKGROUND, "instrumentFile": "scripts/tof-profile/fixtures/synthetic_three_banks.instprm", "cases": cases},
              open(OUT, "w"), separators=(",", ":"))
    for k, c in cases.items():
        print(k, len(c["x"]), "points", "max", max(c["y"]))


if __name__ == "__main__":
    main()

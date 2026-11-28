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
  reference_irf_*  the same on the synthetic FullProf resolution files, each read by this
               folder's own reader with FullProf's functions of d and FullProf's form of the peak
               (no FullProf run). A negative Lorentzian width counts as none.

Each case holds the abscissa, the calculated pattern on a flat background, and the same pattern
with counting noise from a fixed seed.

The patterns run from d = 0.62 to 3.30 A. Their reflection lists reach down to d = 0.40 A (D_LIST;
0.40 is nominal, each case's own end is given below and written to the file):
a measured pattern carries the tails of the lines below its first point, and a refinement that
lists the lines one peak support below its window (the app's rule, THY-90) draws them. Until
2026-11-28 the lists ended at 0.62 A, as GSAS-II takes them for a histogram that starts there, so
the truths had no line below their own end.
  gsas2_*      GSAS-II lists the reflections inside the limits of the histogram it is given. The
               histogram is simulated from d = 0.31 A (D_HIST), on the same grid (its start a whole
               number of steps below the pattern's), and the points below the pattern's start are
               dropped. GSAS-II itself puts the lower limit of a neutron TOF histogram that starts
               below d = 0.4 A at the time of flight of d = 0.4 A (GSASIIscriptable: the default
               'Limits'); nothing is set by hand. It then lists the lines above that limit divided
               by difC (GSASIIstrIO: dmin = limits[0]/difC, without difA or Zero), so its lists
               start a little off 0.40 A: at 0.3986 A on bank 2 (shortest line 12 6 2, 0.40038 A)
               and at 0.4015 A on bank 3 (12 6 2 is left out; shortest line 0.40480 A). It draws
               each line over its own peak range (50 FWHM each side, widened by the rise and the
               decay: GSASIIpwd.getWidthsTOF).
  reference_*  the sum runs over the lines with d >= D_LIST exactly (shortest line 12 6 2,
               0.40038 A, in all four); each is drawn over the whole pattern.

The file records what made it ("provenance"): the date, the command, the patterns' d-range, each
case's list (where it starts, its shortest line, how many d-spacings below the pattern's first point),
GSAS-II's commit, and the Python, numpy and scipy versions.
"""
import json
import math
import os
import platform
import shutil
import subprocess
import tempfile

import numpy as np

import programs as prog
import reference as ref

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "testSupport", "tofKnownTruth.json")
INST = os.path.join(HERE, "fixtures", "synthetic_three_banks.instprm")
A, UISO, B_SI = 5.4310, 0.0060, 4.1491       # A, A^2, fm (Sears 1992)
BACKGROUND = 40.0
D_MIN, D_MAX = 0.62, 3.30                     # A: the patterns' range
D_LIST = 0.40                                 # A: the reflection lists reach down to here: GSAS-II's default lower limit of a neutron TOF histogram
LISTS = []                                    # each case's list, in the order the cases are made (written to "provenance")
D_HIST = 0.31                                 # A: where the histogram GSAS-II is given starts (half of D_MIN; anywhere below D_LIST gives the same list)
T_STEP = 4.0e-4                               # deltaT/T of the GSAS-II and .instprm reference grids
GENERATED = "2026-11-28"                      # the day the committed file was made; change it when the file is remade
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
    lo, hi = tof_range(p, D_MIN, D_MAX)
    # The histogram GSAS-II is given starts `below` steps under the pattern, at or under d = D_HIST; the pattern's
    # own points are the same grid from `below` on. GSAS-II sets its lower limit, and so its list, at d = 0.4 A.
    below = int(math.ceil(math.log(lo / (p["difC"] * D_HIST)) / T_STEP))
    tmin = lo * math.exp(-below * T_STEP)
    work = tempfile.mkdtemp(prefix="tofkt_")
    try:
        cif = os.path.join(work, "si.cif")
        open(cif, "w").write(CIF)
        gpxfile = os.path.join(work, "si.gpx")
        gpx = G2sc.G2Project(newgpx=gpxfile)
        phase = gpx.add_phase(cif, phasename="Si", fmthint="CIF")
        hist = gpx.add_simulated_powder_histogram("sim", INST, tmin / 1000.0, hi / 1000.0, Tstep=T_STEP, phases=[phase], scale=1.0, ibank=bank)
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
        x = np.array(hist.getdata("x"), float)[below:]
        yc = (np.array(hist.getdata("ycalc"), float) - np.array(hist.getdata("background"), float))[below:]
        refl = np.array(hist.reflections()["Si"]["RefList"], float)
        limit = float(hist.data["Limits"][1][0])
    finally:
        shutil.rmtree(work, ignore_errors=True)
    # The pattern is the grid the shorter histogram had: it starts within one step of `lo` (GSAS-II's first point
    # of a histogram from `lo` is half a step above it).
    assert lo <= x[0] < lo * math.exp(T_STEP), (x[0], lo)
    assert D_LIST <= refl[:, 4].min() < D_LIST + 0.01, refl[:, 4].min()
    y = yc * (peak_counts / yc.max()) + BACKGROUND
    LISTS.append({"from": round(limit / p["difC"], 5), "shortestLine": round(float(refl[:, 4].min()), 5), "dSpacingsBelowPattern": len({round(float(d), 5) for d in refl[:, 4] if d < D_MIN}), "reflectionsBelowPattern": int((refl[:, 4] < D_MIN).sum()),
                  "rule": "GSAS-II: lower limit at the TOF of d = 0.4 A (%.2f us), list from limit/difC" % limit})
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


def reference_list(lines):
    """A reference case's list as the file records it: the lines with d >= D_LIST."""
    ds = [d for d, _ in lines]
    LISTS.append({"from": D_LIST, "shortestLine": round(min(ds), 5), "dSpacingsBelowPattern": sum(1 for d in ds if d < D_MIN), "rule": "reference: the lines with d >= %.2f A" % D_LIST})
    return lines


def reference_case(bank, form, mustrain, size, gauss, peak_counts, seed):
    p = prog.read_instprm(INST, bank)
    lo, hi = tof_range(p, D_MIN, D_MAX)
    x = lo * np.exp(T_STEP * np.arange(int(math.log(hi / lo) / T_STEP) + 1))
    y = np.zeros_like(x)
    # The reflections from D_LIST up (GSAS-II's own limit): those below the pattern's first point reach it with their tails.
    for d, inten in reference_list(diamond_reflections(D_LIST, D_MAX)):
        t = prog.gsas2_terms(p, d, size=size, mustrain=mustrain)
        sig2 = t["sig2"] + (abs(p["difC"] + 2 * p["difA"] * d - p["difB"] / d**2) * gauss * 1e-6 * d) ** 2
        y += inten * ref.b2b_pv(x - t["pos"], t["alpha"], t["beta"], sig2, max(t["gam"], 0.0), form=form)
    y = y * (peak_counts / y.max()) + BACKGROUND
    return {"program": "reference", "form": form, "bank": bank, "sample": {"size": size, "mustrain": mustrain, "mustrainMix": 1.0, "gauss": gauss},
            "x": [round(float(v), 3) for v in x], "y": [float("%.8g" % v) for v in y], "yNoisy": [int(v) for v in noisy(y, seed)]}


def reference_irf_case(fixture, gauss, peak_counts, seed, step=6.0e-4):
    path = os.path.join(HERE, "fixtures", fixture)
    p = prog.read_irf(path)
    lo, hi = prog.fullprof_terms(p, D_MIN)["pos"], prog.fullprof_terms(p, D_MAX)["pos"]
    x = lo * np.exp(step * np.arange(int(math.log(hi / lo) / step) + 1))
    y = np.zeros_like(x)
    for d, inten in reference_list(diamond_reflections(D_LIST, D_MAX)):
        t = prog.fullprof_terms(p, d)
        t["sig2"] += (abs(p["dtt1"] + 2 * p["dtt2"] * d) * gauss * 1e-6 * d) ** 2
        y += inten * prog.fullprof_peak(x - t["pos"], t)
    y = y * (peak_counts / y.max()) + BACKGROUND
    return {"program": "reference", "form": "fullprof", "instrument": "scripts/tof-profile/fixtures/" + fixture,
            "sample": {"gauss": gauss}, "x": [round(float(v), 3) for v in x], "y": [float("%.8g" % v) for v in y], "yNoisy": [int(v) for v in noisy(y, seed)]}


def provenance(names):
    """What made the file: the date it was made, the command, the d-ranges, each case's list, and the programs' versions."""
    out = {"generated": GENERATED, "command": "python simulate_known_truth.py (in scripts/tof-profile, GSAS-II's Python)",
           "patternD": [D_MIN, D_MAX], "listD": {"nominal": D_LIST, "cases": dict(zip(names, LISTS))},
           "python": platform.python_version(), "numpy": np.__version__}
    try:
        import scipy
        out["scipy"] = scipy.__version__
    except ImportError:
        pass
    if prog.gsas2_module() is not None:
        root = os.environ.get("GSAS2_ROOT", os.path.expanduser("~/.local/share/validation-engine/gsas2-env/GSAS-II"))
        try:
            out["gsas2Commit"] = subprocess.run(["git", "-C", root, "log", "-1", "--format=%H %cI"], capture_output=True, text=True, check=True).stdout.strip()
        except Exception:
            out["gsas2Commit"] = "unknown"
    return out


def main():
    cases = {}
    if prog.gsas2_module() is not None:
        cases["gsas2_bank2_new_phase"] = gsas2_case(2, 1.0, 1000.0, 1.0, 40000.0, 11)
        cases["gsas2_bank3_other_sample"] = gsas2_case(3, 0.25, 2600.0, 0.6, 40000.0, 12)
    else:
        print("GSAS-II is not importable: the gsas2_* cases are not written")
    cases["reference_bank2_gsas_form"] = reference_case(2, "gsas", 1000.0, 1.0, 0.0, 40000.0, 13)
    cases["reference_bank3_fullprof_form"] = reference_case(3, "fullprof", 1800.0, 0.5, 900.0, 40000.0, 14)
    cases["reference_irf_a"] = reference_irf_case("synthetic_a.irf", 600.0, 40000.0, 15)
    cases["reference_irf_b_negative_gamma"] = reference_irf_case("synthetic_b_negative_gamma.irf", 0.0, 40000.0, 16)
    json.dump({"note": "written by scripts/tof-profile/simulate_known_truth.py; do not edit", "provenance": provenance(list(cases)), "structure": {"cif": CIF, "a": A, "uiso": UISO},
               "background": BACKGROUND, "instrumentFile": "scripts/tof-profile/fixtures/synthetic_three_banks.instprm", "cases": cases},
              open(OUT, "w"), separators=(",", ":"))
    for k, c in cases.items():
        print(k, len(c["x"]), "points", "max", max(c["y"]))


if __name__ == "__main__":
    main()

"""The GSAS-II bundle back in GSAS-II: does GSAS-II, given what the app exports, calculate the
pattern the app calculates?

  python export_round_trip.py job <dir>      writes <dir>/roundtrip_job.json and its inputs
  (then:  MATERIA_TOF_PROFILE_JOB=<dir>/roundtrip_job.json npx vitest run src/core/workflow/tofProfileHarness.test.ts)
  python export_round_trip.py check <dir>    runs each bundle's build_gpx.py with GSAS-II, lets GSAS-II
                                             calculate (no refinement cycle), and compares the patterns
                                             after one scale factor and one constant

The session is silicon on bank 3 of fixtures/synthetic_three_banks.instprm with sample rows that
are not GSAS-II's defaults (a Lorentzian and a Gaussian microstrain, a size), so that every
exported term matters.
"""
import json
import math
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TRUTH = os.path.join(HERE, "..", "..", "src", "testSupport", "tofKnownTruth.json")
INST = os.path.join(HERE, "fixtures", "synthetic_three_banks.instprm")
SETS = {"bank3_mixed_sample": (3, {"tofSampleLorentz": 1560.0, "tofSampleGauss": 441.0, "tofSampleSize": 0.25}),
        "bank2_new_phase": (2, {})}


def cmd_job(d):
    d = os.path.abspath(d)
    os.makedirs(d, exist_ok=True)
    truth = json.load(open(TRUTH))
    cif = os.path.join(d, "si.cif")
    open(cif, "w").write(truth["structure"]["cif"])
    bundles = []
    for name, (bank, rows) in SETS.items():
        case = next(c for c in truth["cases"].values() if c["bank"] == bank and c["program"] == "gsas2")
        dat = os.path.join(d, name + ".dat")
        np.savetxt(dat, np.c_[case["x"], case["y"], np.sqrt(np.maximum(case["y"], 1))], fmt="%.6f")
        bundles.append({"name": name, "instrumentFile": INST, "bank": bank, "dataFile": dat, "cifFile": cif, "outDir": os.path.join(d, name),
                        "set": dict(rows, scale=1.0, bkg0=0.0, bkg1=0.0, B_Si1=8 * math.pi**2 * truth["structure"]["uiso"])})
    json.dump({"out": os.path.join(d, "roundtrip.json"), "bundles": bundles}, open(os.path.join(d, "roundtrip_job.json"), "w"))


def cmd_check(d):
    d = os.path.abspath(d)
    res = json.load(open(os.path.join(d, "roundtrip.json")))["bundles"]
    root = os.environ.get("GSAS2_ROOT", os.path.expanduser("~/.local/share/validation-engine/gsas2-env/GSAS-II"))
    sys.path.insert(0, root)
    from GSASII import GSASIIscriptable as G2sc
    for b in res:
        folder = os.path.join(d, b["name"])
        env = dict(os.environ, PYTHONPATH=root, PYTHONDONTWRITEBYTECODE="1")
        r = subprocess.run([sys.executable, "build_gpx.py"], cwd=folder, env=env, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            print(b["name"], "build_gpx.py failed:", r.stderr[-400:]); continue
        gpxfile = os.path.join(folder, b["name"] + ".gpx")
        gpx = G2sc.G2Project(gpxfile)
        hist = gpx.histograms()[0]
        inst = hist.data["Instrument Parameters"][0]
        hap = gpx.phases()[0].data["Histograms"][hist.name]
        bk = hist.data["Background"][0]
        hist.data["Background"][0] = ["chebyschev-1", False, 1, 0.0]
        gpx.data["Controls"]["data"]["max cyc"] = 0
        gpx.save()
        gpx.do_refinements([{}])
        gpx = G2sc.G2Project(gpxfile)
        hist = gpx.histograms()[0]
        x = np.array(hist.getdata("x"), float)
        yc = np.array(hist.getdata("ycalc"), float) - np.array(hist.getdata("background"), float)
        ours = np.interp(x, np.array(b["x"]), np.array(b["yCalc"]))
        m = (x > b["x"][0]) & (x < b["x"][-1])
        A = np.c_[yc[m], np.ones(m.sum())]
        k, c = np.linalg.lstsq(A, ours[m], rcond=None)[0]
        diff = np.abs(k * yc[m] + c - ours[m])
        print("%s: GSAS-II read from the bundle  sig-1 %.6g  X %.6g  Y %.6g  Z %.6g  difC %.6g  Mustrain %s  Size %s"
              % (b["name"], inst["sig-1"][1], inst["X"][1], inst["Y"][1], inst["Z"][1], inst["difC"][1], hap["Mustrain"][1], hap["Size"][1]))
        print("   GSAS-II's pattern from the bundle against the app's: largest difference %.4f %% of the highest point, rms %.4f %%; constant %.3g"
              % (100 * diff.max() / ours[m].max(), 100 * math.sqrt((diff**2).mean()) / ours[m].max(), c))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "job":
        cmd_job(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "check":
        cmd_check(sys.argv[2])
    else:
        sys.exit(__doc__)

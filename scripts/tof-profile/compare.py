"""What the app draws today from an instrument file against what the file's own program calculates.

  python compare.py job   <dir> <label>=<gsas2|fullprof>:<file>[:<bank>] ...   writes <dir>/job.json
  (then:  MATERIA_TOF_PROFILE_JOB=<dir>/job.json npx vitest run src/core/workflow/tofProfileHarness.test.ts)
  python compare.py table <dir>            reads <dir>/job.json and <dir>/materia.json, prints the table,
                                           writes <dir>/peaks.json

For a GSAS-II file the target is GSAS-II's own compiled routine (GSAS-II must be installed), with
the sample terms of a new phase (Size 1 um, Mustrain 1000, both Lorentzian) and, beside it, with
none. For a FullProf file it is the documented NPROF 9 function in a double-precision
transcription: no FullProf run.
"""
import json
import math
import os
import sys

import numpy as np

import programs as prog
import reference as ref

D_VALUES = [0.6, 0.8, 1.1, 1.6, 2.2, 3.1]


def parse_spec(s):
    label, rest = s.split("=", 1)
    parts = rest.split(":")
    return {"label": label, "program": parts[0], "file": os.path.abspath(parts[1]), "bank": int(parts[2]) if len(parts) > 2 else None}


def cmd_job(out_dir, specs):
    os.makedirs(out_dir, exist_ok=True)
    cases = [parse_spec(s) for s in specs]
    job = {"out": os.path.join(os.path.abspath(out_dir), "materia.json"), "cases": cases,
           "peaks": [dict(name=c["label"], instrumentFile=c["file"], d=D_VALUES, **({"bank": c["bank"]} if c["bank"] is not None else {})) for c in cases]}
    json.dump(job, open(os.path.join(out_dir, "job.json"), "w"), indent=1)


def versus(dt, y, target):
    """The app's peak y against a target on the same grid."""
    m, t = ref.metrics(dt, y), ref.metrics(dt, target)
    return {"height": m["height"] / t["height"], "fwhm": m["fwhm"] / t["fwhm"], "area": m["area"] / t["area"],
            "centroid": m["centroid"] - t["centroid"], "top": m["top"] - t["top"],
            "maxdiff": float(np.abs(y - target).max() / t["height"]), "target_fwhm": t["fwhm"]}


def cmd_table(out_dir):
    job = json.load(open(os.path.join(out_dir, "job.json")))
    res = json.load(open(job["out"]))
    rows = []
    for case, mp in zip(job["cases"], res["peaks"]):
        p = prog.read_instprm(case["file"], case["bank"] or 1) if case["program"] == "gsas2" else prog.read_irf(case["file"])
        print(f"\n== {case['label']} ({case['program']})   app rows: " + ", ".join(f"{k}={v['value']:.6g}" for k, v in mp["rows"].items()))
        for pd in mp["perD"]:
            if pd.get("noPeak"):
                print(f"d={pd['d']:4.2f}  the app draws no peak: the file gives no positive width here")
                continue
            d = pd["d"]
            dt = np.linspace(pd["dtMin"], pd["dtMax"], pd["n"])
            y = np.array(pd["y"])
            row = {"label": case["label"], "program": case["program"], "d": d,
                   "app": {"pos": pd["center"], "alpha": pd["alpha"], "beta": pd["beta"], "sig2": pd["sigma"] ** 2}}
            if case["program"] == "gsas2":
                t = prog.gsas2_terms(p, d)                       # a new phase's sample terms
                t0 = prog.gsas2_terms(p, d, size=None, mustrain=None)   # the instrument alone
                row["file"] = t
                if t["sig2"] <= 0 or t["alpha"] <= 0 or t["beta"] <= 0:
                    row["note"] = "the file gives sig2, alpha or beta <= 0 here: no peak to compare"
                else:
                    target = prog.gsas2_peak(dt, t)
                    row["target"] = "GSAS-II compiled routine"
                    row["vs_program"] = versus(dt, y, target)
                    row["vs_program_instrument_only"] = versus(dt, y, prog.gsas2_peak(dt, t0))
            else:
                t = prog.fullprof_terms(p, d)
                row["file"] = t
                if t["sig2"] <= 0 or t["alpha"] <= 0 or t["beta"] <= 0:
                    row["note"] = "the file gives sig2, alpha or beta <= 0 here: no peak to compare"
                else:
                    target = prog.fullprof_peak(dt, t)
                    row["target"] = "documented NPROF 9 function, transcribed (no FullProf run)"
                    row["vs_program"] = versus(dt, y, target)
                    sub = slice(None, None, 50)
                    ex = prog.exact_peak(dt[sub], t)
                    row["pseudo_voigt_vs_exact"] = float(np.abs(target[sub] - ex).max() / ex.max())
            row["position_difference"] = pd["center"] - row["file"]["pos"]
            rows.append(row)
            f = row["file"]
            head = (f"d={d:4.2f}  file: a={f['alpha']:.4g} b={f['beta']:.4g} sig2={f['sig2']:.5g} gam={f['gam']:.4g}"
                    + (f" (inst {f['gam_inst']:.4g} + sample {f['gam_sample']:.4g})" if "gam_inst" in f else "")
                    + f" | app: a={pd['alpha']:.4g} b={pd['beta']:.4g} sig2={pd['sigma']**2:.5g} | dpos={row['position_difference']:.2e}")
            if "vs_program" in row:
                v = row["vs_program"]
                head += (f"\n        app/program: height {v['height']:.3f} FWHM {v['fwhm']:.3f} area {v['area']:.4f} centroid {v['centroid']:+.2f} us"
                         f" maxdiff {100*v['maxdiff']:.1f} % of height")
                if "vs_program_instrument_only" in row:
                    w = row["vs_program_instrument_only"]
                    head += f"\n        without sample terms: height {w['height']:.3f} FWHM {w['fwhm']:.3f} maxdiff {100*w['maxdiff']:.1f} %"
                else:
                    head += f" | pseudo-Voigt form vs exact convolution {100*row['pseudo_voigt_vs_exact']:.2f} %"
            else:
                head += "\n        " + row["note"]
            print(head)
    json.dump(rows, open(os.path.join(out_dir, "peaks.json"), "w"), indent=1)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "job":
        cmd_job(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) == 3 and sys.argv[1] == "table":
        cmd_table(sys.argv[2])
    else:
        sys.exit(__doc__)

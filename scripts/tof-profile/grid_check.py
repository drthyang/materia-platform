"""The app's time-of-flight peak function, point by point, against GSAS-II's own compiled routine
and against a double-precision evaluation of the same construction (reference.b2b_pv, itself
checked against 40-digit values by the unit test).

  python grid_check.py job   <dir> [gsas|fullprof]   writes <dir>/grid_job.json (the grid, in one program's form)
  (then:  MATERIA_TOF_PROFILE_JOB=<dir>/grid_job.json npx vitest run src/core/workflow/tofProfileHarness.test.ts)
  python grid_check.py table <dir>     reads <dir>/grid.json, prints the worst differences and where

In FullProf's form there is no program routine to call: the comparison is with the double-precision
evaluation and, when mpmath is importable, with the 40-digit evaluation of make_reference.py at
every point.

The grid covers and exceeds what instrument files give: alpha 0.02 to 30 per microsecond, beta
0.004 to 1.2, sigma 0.3 to 300 microseconds, gamma 0 to 300, and 41 offsets from the peak
position out to 400 widths on each side.
"""
import json
import math
import os
import sys

import numpy as np

import programs as prog
import reference as ref

ALPHAS = np.geomspace(0.02, 30.0, 8)
BETAS = np.geomspace(0.004, 1.2, 7)
SIGMAS = np.geomspace(0.3, 300.0, 8)
GAMMAS = [0.0, 1e-4, 0.01, 0.3, 3.0, 30.0, 300.0]
STEPS = [-400, -120, -40, -15, -8, -5, -3.5, -2.5, -1.8, -1.3, -1.0, -0.75, -0.5, -0.35, -0.2, -0.1, -0.04, 0, 0.04, 0.1, 0.2, 0.35, 0.5, 0.75,
         1.0, 1.3, 1.8, 2.5, 3.5, 5, 8, 15, 40, 120, 400]


def offsets(alp, bet, sigma, gam):
    w = 2.3548 * sigma + gam
    return [k * w for k in STEPS] + [-6 / alp, -2 / alp, -0.5 / alp, 0.5 / bet, 2 / bet, 6 / bet]


def shapes(form="gsas"):
    out = []
    for a in ALPHAS:
        for b in BETAS:
            for s in SIGMAS:
                for g in GAMMAS:
                    out.append({"alpha": float(a), "beta": float(b), "sigma": float(s), "gamma": float(g), "form": form, "dt": offsets(a, b, s, g)})
    return out


def cmd_job(d, form="gsas"):
    os.makedirs(d, exist_ok=True)
    json.dump({"out": os.path.join(os.path.abspath(d), "grid.json"), "form": form, "shapes": shapes(form)}, open(os.path.join(d, "grid_job.json"), "w"))


def cmd_table(d):
    job = json.load(open(os.path.join(d, "grid_job.json")))
    res = json.load(open(job["out"]))["shapes"]
    form = job.get("form", "gsas")
    G2 = prog.gsas2_module() if form == "gsas" else None
    try:
        import make_reference as forty
    except ImportError:
        forty = None
    exact40 = []
    STOFW = 2.3548200450309493
    cols = {k: [] for k in ("alpha", "beta", "sigma", "gamma", "dt", "top", "app", "exact", "routine", "y1", "y2", "far")}
    for sh, y in zip(job["shapes"], res):
        a, b, s, g = sh["alpha"], sh["beta"], sh["sigma"], sh["gamma"]
        dt = np.array(sh["dt"]); y = np.array(y)
        peak = (lambda x: ref.b2b_pv(x, a, b, s * s, g, form=form)) if g > 0 else (lambda x: ref.b2b_gauss(x, a, b, s * s))
        exact = peak(dt)
        top = float(max(peak(np.linspace(-3 * s - g, 3 * s + g + 2 / b, 400)).max(), exact.max()))
        F = ref.tch(STOFW * s, g)[0] if g > 0 else STOFW * s
        sp = F / STOFW                                   # the Gaussian part's sigma
        if forty is not None and form == "fullprof":
            exact40.extend(float(forty.peak(t, a, b, s, g, form)) if g > 0 else float("nan") for t in dt)
        routine = np.asarray(G2.getEpsVoigt(0.0, a, b, s * s, g, dt)[0], float) if G2 is not None else np.full(len(dt), np.nan)
        n = len(dt)
        for k, v in (("alpha", [a] * n), ("beta", [b] * n), ("sigma", [s] * n), ("gamma", [g] * n), ("dt", dt), ("top", [top] * n), ("app", y), ("exact", exact),
                     ("routine", routine), ("y1", (a * sp * sp + dt) / (sp * math.sqrt(2))), ("y2", (b * sp * sp - dt) / (sp * math.sqrt(2))), ("far", (dt / sp) ** 2)):
            cols[k].extend(np.asarray(v, float).tolist())
    c = {k: np.array(v) for k, v in cols.items()}
    n = len(c["dt"])
    print(f"{len(res)} shapes, {n} points, {form} form")
    rel = np.abs(c["app"] - c["exact"]) / (np.abs(c["exact"]) + 1e-13 * c["top"])
    i = int(np.argmax(rel))
    where = lambda i: "alpha=%.3g beta=%.3g sigma=%.3g gamma=%.3g dt=%.4g" % (c["alpha"][i], c["beta"][i], c["sigma"][i], c["gamma"][i], c["dt"][i])
    print("app against the double-precision evaluation of the same construction:")
    print("  largest relative difference %.2e at %s" % (rel[i], where(i)))
    print("  largest difference over the peak height %.2e" % np.max(np.abs(c["app"] - c["exact"]) / c["top"]))
    print("  gamma = 0 (the function as it was): largest relative difference %.2e" % rel[c["gamma"] == 0].max())
    print("  gamma > 0: largest relative difference %.2e" % rel[c["gamma"] > 0].max())
    if exact40:
        e40 = np.array(exact40)
        ok40 = np.isfinite(e40)
        r40 = np.abs(c["app"] - e40)[ok40] / (np.abs(e40[ok40]) + 1e-13 * c["top"][ok40])
        k = int(np.argmax(r40))
        print("app against the 40-digit evaluation, gamma > 0 (%d points): largest relative difference %.2e at %s; over the peak height %.2e"
              % (ok40.sum(), r40[k], where(int(np.flatnonzero(ok40)[k])), (np.abs(c["app"] - e40)[ok40] / c["top"][ok40]).max()))
        d40 = np.abs(c["exact"] - e40)[ok40] / (np.abs(e40[ok40]) + 1e-13 * c["top"][ok40])
        print("the double-precision reference against the 40-digit evaluation: largest relative difference %.2e" % d40.max())
    if form != "gsas":
        return
    if G2 is None:
        print("GSAS-II is not installed: no comparison with its routine"); return
    ok = np.isfinite(c["routine"])
    ra = np.where(ok, np.abs(c["routine"] - c["app"]) / c["top"], 0)
    re = np.where(ok, np.abs(c["routine"] - c["exact"]) / c["top"], 0)
    ae = np.abs(c["app"] - c["exact"]) / c["top"]
    big = (c["y1"] >= 6) | (c["y2"] >= 6)          # an argument of erfc, y or z, is 6 or above
    far = c["far"] > 1e4                           # more than 100 sigma from the peak position
    print("GSAS-II's compiled routine (single precision), difference over the peak height, by where the point lies:")
    def line(label, sel):
        if not sel.any(): return
        j = int(np.argmax(np.where(sel, ra, -1)))
        print("  %-64s %6d points | routine - app %.1e | routine - exact %.1e | app - exact %.1e | worst at %s"
              % (label, sel.sum(), ra[sel].max(), re[sel].max(), ae[sel].max(), where(j)))
    line("all points", np.ones(n, bool))
    line("erfc arguments below 6 and |dt| below 100 sigma", ~big & ~far)
    line("an erfc argument 6 or above, |dt| below 100 sigma", big & ~far)
    line("|dt| above 100 sigma (far tail)", far)
    line("  far tail, sigma 3 us or more", far & (c["sigma"] >= 3))
    line("  far tail, sigma below 3 us", far & (c["sigma"] < 3))
    print("  points where the routine returned no number:", int((~ok).sum()))


if __name__ == "__main__":
    if len(sys.argv) in (3, 4) and sys.argv[1] == "job":
        cmd_job(sys.argv[2], *(sys.argv[3:4]))
    elif len(sys.argv) == 3 and sys.argv[1] == "table":
        cmd_table(sys.argv[2])
    else:
        sys.exit(__doc__)

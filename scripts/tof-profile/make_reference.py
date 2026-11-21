"""Reference values for the app's time-of-flight peak, written to
src/core/diffraction/tofProfileReference.json (read by tofLorentz.test.ts, so that the suite
needs neither Python nor GSAS-II).

  python make_reference.py            (needs mpmath; GSAS-II optional, GSAS2_ROOT names it)

  e1      Im[exp(z) E1(z)] at 40 digits (mpmath) over the region the peaks use
  peaks   the pseudo-Voigt construction of both programs, evaluated at 40 digits (mpmath):
          every special function exact, no single precision. For form "gsas" also the value
          GSAS-II's own compiled routine returns at the same point, when GSAS-II is installed.
"""
import json
import os

import mpmath as mp
import numpy as np

import programs as prog

mp.mp.dps = 40
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "core", "diffraction", "tofProfileReference.json")
STOFW = mp.sqrt(8 * mp.log(2))


def im_exp_e1(x, y):
    z = mp.mpc(x, y)
    return mp.im(mp.exp(z) * mp.e1(z))


def tch(fg, fl):
    F = (fg**5 + mp.mpf("2.69269") * fg**4 * fl + mp.mpf("2.42843") * fg**3 * fl**2 + mp.mpf("4.47163") * fg**2 * fl**3
         + mp.mpf("0.07842") * fg * fl**4 + fl**5) ** mp.mpf("0.2")
    r = fl / F
    return F, mp.mpf("1.36603") * r - mp.mpf("0.47719") * r * r + mp.mpf("0.11116") * r**3


def peak(dt, alp, bet, sigma, gam, form):
    """(1-eta) N [e^u erfc(y) + e^v erfc(z)] - (2 N eta/pi) {Im[e^p E1(p)] + Im[e^q E1(q)]}."""
    dt, alp, bet, sigma, gam = (mp.mpf(repr(float(v))) for v in (dt, alp, bet, sigma, gam))
    F, eta = tch(STOFW * sigma, gam)
    s2 = (F / STOFW) ** 2
    N = alp * bet / (2 * (alp + bet))
    u = alp / 2 * (alp * s2 + 2 * dt)
    v = bet / 2 * (bet * s2 - 2 * dt)
    y = (alp * s2 + dt) / mp.sqrt(2 * s2)
    z = (bet * s2 - dt) / mp.sqrt(2 * s2)
    g = N * (mp.exp(u) * mp.erfc(y) + mp.exp(v) * mp.erfc(z))
    p = mp.mpc((alp if form == "fullprof" else -alp) * dt, alp * F / 2)
    q = mp.mpc(-bet * dt, bet * F / 2)
    lor = -2 * N / mp.pi * (mp.im(mp.exp(p) * mp.e1(p)) + mp.im(mp.exp(q) * mp.e1(q)))
    return (1 - eta) * g + eta * lor


def offsets(alp, bet, sigma, gam):
    """Offsets from the peak position: the core, both exponential sides, and the far tails."""
    w = 2.3548 * sigma + gam
    core = [k * w for k in (-60, -12, -4, -1.5, -0.6, -0.2, 0, 0.2, 0.6, 1.5, 4, 12, 60, 400)]
    return core + [-3 / alp, 2 / bet, 7 / bet]


def main():
    e1 = []
    xs = [-600, -120, -49.9, -30, -12, -6.5, -5.9, -3, -1, -0.2, 0, 0.2, 1, 1.9, 2.1, 3, 8, 30, 49.9, 50.1, 300]
    ys = [1e-6, 1e-3, 0.05, 0.4, 1, 2.5, 3.9, 4.1, 6, 12, 40, 51, 400]
    for x in xs:
        for y in ys:
            e1.append([x, y, float(im_exp_e1(x, y))])
    G2 = prog.gsas2_module()
    peaks = []
    for alp in (0.03, 0.2, 2.0, 25.0):
        for bet in (0.008, 0.1, 0.8):
            for sigma in (1.0, 8.0, 60.0, 250.0):
                for gam in (0.01, 1.0, 20.0, 150.0):
                    dts = offsets(alp, bet, sigma, gam)
                    row = {"alpha": alp, "beta": bet, "sigma": sigma, "gamma": gam, "dt": dts,
                           "gsas": [float(peak(d, alp, bet, sigma, gam, "gsas")) for d in dts],
                           "fullprof": [float(peak(d, alp, bet, sigma, gam, "fullprof")) for d in dts]}
                    if G2 is not None:
                        vals = G2.getEpsVoigt(0.0, alp, bet, sigma * sigma, gam, np.array(dts, float))[0]
                        row["gsas2Routine"] = [float("%.8g" % v) for v in vals]
                    peaks.append(row)
    json.dump({"note": "written by scripts/tof-profile/make_reference.py; do not edit", "e1": e1, "peaks": peaks}, open(OUT, "w"), separators=(",", ":"))
    print("wrote", os.path.normpath(OUT), len(e1), "E1 values,", sum(len(r["dt"]) for r in peaks), "peak points per form")


if __name__ == "__main__":
    main()

"""Each program's own reading of its instrument file, and the peak it calculates from it.

Independent of the app's reader: a GSAS-II .instprm is read as key:value lines per '#Bank N' block,
a FullProf .irf by its keywords. The functions of d are the programs' own:

  GSAS-II 5.11 (GSASIImath.getTOFsig/getTOFgamma/getTOFalpha/getTOFbeta, GSASIIstrMath.GetReflPos,
  GetReflSigGamTOF, GetSampleSigGam):
      TOF = Zero + difC d + difA d^2 + difB/d
      alpha = alpha/d      beta = beta-0 + beta-1/d^4 + beta-q/d^2
      sig2 = sig-0 + sig-1 d^2 + sig-2 d^4 + sig-q d
      gam  = X d + Y d^2 + Z   (+ the sample: 1e-4 difC d^2/Size + 1e-6 difC d Mustrain, each
             Lorentzian by default; a new phase has Size 1 um and Mustrain 1000)
  FullProf (manual, July 2001: LINE 14, LINE 27, LINE 27-2, LINE 30; NPROF 9):
      TOF = Zero + Dtt1 d + Dtt2 d^2
      alpha = alph0 + alph1/d      beta = beta0 + beta1/d^4
      sig2 = Sig-2 d^4 + Sig-1 d^2 + Sig-0      gam = Gam-2 d^2 + Gam-1 d + Gam-0
"""
import math
import os
import re
import sys

import numpy as np

import reference as ref


def read_instprm(path, bank=None):
    """{bank number: {key: float}} of a GSAS-II .instprm; one bank when `bank` is given."""
    banks, cur, n = {}, None, None
    for raw in open(path).read().replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            m = re.match(r"#\s*Bank\s+(\d+)", line)
            if m:
                n = int(m.group(1)); cur = banks.setdefault(n, {})
            continue
        if cur is None:
            n = 1; cur = banks.setdefault(1, {})
        for pair in line.split(";"):
            if ":" not in pair:
                continue
            k, v = pair.split(":", 1)
            try:
                cur[k.strip()] = float(v)
            except ValueError:
                pass
    return banks[bank] if bank is not None else banks


def read_irf(path):
    """The keyword lines of a one-bank FullProf TOF .irf, as FullProf documents their order."""
    out = {}
    for raw in open(path).read().replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line or line.startswith("!"):
            continue
        w = line.split()
        key = w[0].upper()
        vals = []
        for t in w[1:]:
            try:
                vals.append(float(t))
            except ValueError:
                break
        out[key] = vals
    p = {"nprof": out.get("NPROF", [9])[0]}
    if "D2TOF" in out:
        v = out["D2TOF"] + [0, 0, 0]
        if len(out["D2TOF"]) == 4:
            p.update(dtt1=v[0], dtt2=v[1], dtt1overd=v[2], zero=v[3])
        else:
            p.update(dtt1=v[0], dtt2=v[1], dtt1overd=0.0, zero=v[2])
    elif "ZD2TOF" in out or "ZD2TOT" in out:   # zero first; a 3-value ZD2TOT under NPROF 9 read as Zero, Dtt1, Dtt2
        v = (out.get("ZD2TOF") or out.get("ZD2TOT")) + [0, 0]
        p.update(zero=v[0], dtt1=v[1], dtt2=v[2], dtt1overd=0.0)
    s = out.get("SIGMA", [0, 0, 0]); g = out.get("GAMMA", [0, 0, 0]); a = out.get("ALFBE", [0, 0, 0, 0])
    p.update(sig2=s[0], sig1=s[1], sig0=s[2], gam2=g[0], gam1=g[1], gam0=g[2], alph0=a[0], beta0=a[1], alph1=a[2], beta1=a[3])
    return p


def gsas2_terms(p, d, size=1.0, mustrain=1000.0):
    """Position and widths GSAS-II uses at d. size (um) and mustrain are the phase's isotropic
    sample terms with their default Lorentzian mixing; size=None, mustrain=None leaves them out."""
    g = lambda k: p.get(k, 0.0)
    pos = g("Zero") + g("difC") * d + g("difA") * d * d + g("difB") / d
    alp = g("alpha") / d
    bet = g("beta-0") + g("beta-1") / d**4 + g("beta-q") / d**2
    sig2 = g("sig-0") + g("sig-1") * d * d + g("sig-2") * d**4 + g("sig-q") * d
    gam_inst = g("X") * d + g("Y") * d * d + g("Z")
    gam_sample = (1e-4 * g("difC") * d * d / size if size else 0.0) + (1e-6 * g("difC") * d * mustrain if mustrain else 0.0)
    return {"pos": pos, "alpha": alp, "beta": bet, "sig2": sig2, "gam_inst": gam_inst, "gam_sample": gam_sample, "gam": gam_inst + gam_sample}


def fullprof_terms(p, d):
    pos = p["zero"] + p["dtt1"] * d + p["dtt2"] * d * d + p.get("dtt1overd", 0.0) / d
    return {"pos": pos, "alpha": p["alph0"] + p["alph1"] / d, "beta": p["beta0"] + p["beta1"] / d**4,
            "sig2": p["sig2"] * d**4 + p["sig1"] * d * d + p["sig0"], "gam": p["gam2"] * d * d + p["gam1"] * d + p["gam0"]}


_G2 = None


def gsas2_module():
    """GSAS-II's GSASIIpwd (for its compiled peak routine), or None when GSAS-II is not installed."""
    global _G2
    if _G2 is None:
        root = os.environ.get("GSAS2_ROOT", os.path.expanduser("~/.local/share/validation-engine/gsas2-env/GSAS-II"))
        try:
            sys.path.insert(0, root)
            from GSASII import GSASIIpwd
            _G2 = GSASIIpwd
        except Exception:
            _G2 = False
    return _G2 or None


def gsas2_peak(dt, t):
    """The peak GSAS-II calculates (its own compiled routine) for the terms t; unit intensity."""
    G2 = gsas2_module()
    if G2 is None:
        raise RuntimeError("GSAS-II is not importable (set GSAS2_ROOT)")
    return np.asarray(G2.getEpsVoigt(0.0, t["alpha"], t["beta"], t["sig2"], t["gam"], np.asarray(dt, float))[0], float)


def fullprof_peak(dt, t):
    """FullProf's documented NPROF 9 function (pseudo-Voigt form), transcribed: no FullProf run.
    A negative gamma counts as 0."""
    return ref.b2b_pv(dt, t["alpha"], t["beta"], t["sig2"], max(t["gam"], 0.0))


def exact_peak(dt, t):
    """Back-to-back exponentials (x) Voigt, no pseudo-Voigt approximation."""
    if t["gam"] <= 0:
        return ref.b2b_gauss(dt, t["alpha"], t["beta"], t["sig2"])
    return ref.b2b_voigt_exact(dt, t["alpha"], t["beta"], t["sig2"], t["gam"])

"""Independent double-precision references for the time-of-flight peak.

Written from the definitions, not from any program's code, so that when the app, GSAS-II and
FullProf's documented function disagree one can say which is off.

  b2b_gauss        back-to-back exponentials (x) Gaussian, closed form (Von Dreele, Jorgensen &
                   Windsor 1982, J. Appl. Cryst. 15, 581; GSAS TOF profile function 1)
  b2b_lorentz      back-to-back exponentials (x) Lorentzian, closed form with the complex
                   exponential integral, -(2N/pi){Im[e^p E1(p)] + Im[e^q E1(q)]},
                   q = -beta*dt + i*beta*F/2, and p as each program's manual prints it:
                   form="fullprof" (NPROF 9): p = alpha*dt + i*alpha*F/2;
                   form="gsas" (GSAS manual, TOF profile function 3, p as in function 2;
                   GSAS-II's function): p = -alpha*dt + i*alpha*F/2
  b2b_pv           the pseudo-Voigt construction of both programs: (1-eta)*b2b_gauss(F) +
                   eta*b2b_lorentz(F), F and eta from Thompson, Cox & Hastings (1987)
  b2b_voigt_exact  back-to-back exponentials (x) Voigt, by Fourier inversion (no pseudo-Voigt)
  b2b_voigt_direct the same by real-space quadrature (slow; a cross-check of the line above)

Units: dt in microseconds from the peak position, alpha and beta in 1/microsecond, sig2 in
microsecond^2 (a variance), gam in microseconds (a Lorentzian FWHM). All peaks have unit area.
"""
import math
import numpy as np
from scipy import integrate
from scipy.special import erfc, erfcx, exp1, wofz

STOFW = math.sqrt(8 * math.log(2))


def tch(fg, fl):
    """Total FWHM and eta from a Gaussian and a Lorentzian FWHM (Thompson, Cox & Hastings 1987)."""
    F = (fg**5 + 2.69269 * fg**4 * fl + 2.42843 * fg**3 * fl**2 + 4.47163 * fg**2 * fl**3
         + 0.07842 * fg * fl**4 + fl**5) ** 0.2
    r = fl / F
    return F, 1.36603 * r - 0.47719 * r * r + 0.11116 * r**3


def b2b_gauss(dt, alp, bet, sig2):
    dt = np.asarray(dt, float)
    s = math.sqrt(sig2)
    N = alp * bet / (2 * (alp + bet))
    g = np.exp(-dt * dt / (2 * sig2))

    def term(arg, rate, sign):
        out = np.empty_like(dt)
        pos = arg >= 0
        out[pos] = g[pos] * erfcx(arg[pos])
        out[~pos] = np.exp(0.5 * rate * (rate * sig2 + sign * 2 * dt[~pos])) * erfc(arg[~pos])
        return out

    y = (alp * sig2 + dt) / (s * math.sqrt(2))
    z = (bet * sig2 - dt) / (s * math.sqrt(2))
    return N * (term(y, alp, +1) + term(z, bet, -1))


def _im_exp_e1(z):
    """Im[exp(z) E1(z)], Im z > 0. Direct below |z| = 30, continued fraction above (exp overflows)."""
    z = np.asarray(z, complex)
    out = np.empty(z.shape, float)
    big = np.abs(z) > 30
    zs = z[~big]
    out[~big] = (np.exp(zs) * exp1(zs)).imag
    zb = z[big]
    if zb.size:
        b = zb + 1.0
        c = np.full(zb.shape, 1e300 + 0j)
        d = 1.0 / b
        h = d.copy()
        for i in range(1, 400):
            a = -i * i
            b = b + 2.0
            d = 1.0 / (a * d + b)
            c = b + a / c
            h = h * c * d
        # Near the negative real axis the fraction converges slowly: direct while exp does not underflow,
        # and beyond that the asymptotic series sum (-1)^k k!/z^(k+1), whose error is below exp(-|z|).
        near_cut = (zb.real < 0) & (np.abs(zb.imag) < 2)
        direct = near_cut & (np.abs(zb) <= 600)
        h[direct] = np.exp(zb[direct]) * exp1(zb[direct])
        far = near_cut & ~direct
        if far.any():
            zf = zb[far]
            term = 1.0 / zf
            total = term.copy()
            for k in range(1, 12):
                term = -k * term / zf
                total = total + term
            h[far] = total
        out[big] = h.imag
    return out


def b2b_lorentz(dt, alp, bet, fwhm, form="fullprof"):
    dt = np.asarray(dt, float)
    N = alp * bet / (2 * (alp + bet))
    p = (alp if form == "fullprof" else -alp) * dt + 1j * alp * fwhm / 2
    q = -bet * dt + 1j * bet * fwhm / 2
    return -2 * N / math.pi * (_im_exp_e1(p) + _im_exp_e1(q))


def b2b_pv(dt, alp, bet, sig2, gam, form="fullprof"):
    if gam <= 0:
        return b2b_gauss(dt, alp, bet, sig2)
    F, eta = tch(STOFW * math.sqrt(sig2), gam)
    return (1 - eta) * b2b_gauss(dt, alp, bet, (F / STOFW) ** 2) + eta * b2b_lorentz(dt, alp, bet, F, form)


def voigt(x, sig2, gam):
    s = math.sqrt(sig2)
    return wofz((x + 1j * gam / 2) / (s * math.sqrt(2))).real / (s * math.sqrt(2 * math.pi))


def b2b_voigt_exact(dt, alp, bet, sig2, gam):
    """E(t) = exp(alp t), t < 0; exp(-bet t), t > 0, times alp*bet/(alp+bet). Its transform is
    N'[1/(alp - ik) + 1/(bet + ik)]; the Voigt's is exp(-sig2 k^2/2 - gam |k|/2)."""
    dt = np.asarray(dt, float)
    out = np.empty_like(dt)
    kmax = 12.0 / math.sqrt(sig2)
    Nn = alp * bet / (alp + bet)
    for i, x in enumerate(dt):
        f = lambda k: (np.exp(-sig2 * k * k / 2 - gam * k / 2) * Nn * (1 / (alp - 1j * k) + 1 / (bet + 1j * k)) * np.exp(1j * k * x)).real
        out[i] = integrate.quad(f, 0, kmax, limit=2000, epsabs=1e-13, epsrel=1e-11)[0] / math.pi
    return out


def b2b_voigt_direct(dt, alp, bet, sig2, gam):
    dt = np.asarray(dt, float)
    Nn = alp * bet / (alp + bet)
    out = np.empty_like(dt)
    for i, x in enumerate(dt):
        a = integrate.quad(lambda t: math.exp(-alp * t) * voigt(x + t, sig2, gam), 0, np.inf, limit=800, epsabs=1e-14, epsrel=1e-10)[0]
        b = integrate.quad(lambda t: math.exp(-bet * t) * voigt(x - t, sig2, gam), 0, np.inf, limit=800, epsabs=1e-14, epsrel=1e-10)[0]
        out[i] = Nn * (a + b)
    return out


def metrics(x, y):
    """Height, FWHM, area and centroid of a sampled peak (x ascending, fine grid)."""
    i = int(np.argmax(y))
    h = float(y[i])
    left = np.interp(h / 2, y[: i + 1], x[: i + 1])
    right = np.interp(h / 2, y[i:][::-1], x[i:][::-1])
    area = float(np.trapezoid(y, x))
    return {"height": h, "fwhm": float(right - left), "area": area, "centroid": float(np.trapezoid(y * x, x) / area), "top": float(x[i])}

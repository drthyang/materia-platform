# My Rietveld workflow — the cases behind the rules

The method (SKILL.md) states each rule; this note keeps the user's cases and the longer
reasoning behind them, for when a question needs them.

## The fit range (Stage 0, step 2)

- **The short-d end.** On POWGEN's short-TOF end: "find a place where there are still peaks
  and put the lower limit into a convenient gap".
- **Peaks below the first reflection stay.** Cr₂WO₆ at 4 K: four peaks below the first
  nuclear reflection, the strongest 40σ — magnetic order, kept in the window and explained.
- **The counting σ at the ends.** PbSO₄ on D1A: one detector counts the last 6°, 3.2× the
  middle's relative σ.
- **Read the ends again after the first refinement.** PbSO₄: the last 0.8° sat 4.4σ above
  the model, more than anywhere just inside — which the data alone could not show.

## The background on POWGEN (Stage 1)

- **Logarithmic interpolation** (`logInterpolate`), its points evenly spaced in log TOF: the
  long-d end, where a TOF background rises steeply, gets the points it needs; a polynomial
  over the whole TOF range bends where the data do not.

## Unindexed peaks and the sample environment (Stage 0, step 3)

- Cr₂WO₆ at 150 K: weak lines at 62.4° and 73.5° were Al 111 and 200, shifted because the
  shields sit off the sample position.
- NAC on 11-BM held fluorite, an impurity a synthesis leaves.

## Stage 1: positions, the profile and the asymmetry

- **Positions are a quick pass.** On the GaNb4Se8 test the positions moved wR only
  18.4→17.6%, then the profile took it to 7.6% — normal.
- **Peak asymmetry.** On PbSO₄ (D1A) switching on the axial divergence (S/L, H/L) took wR
  from 12% to 6%.
- **The profile before the positions.** Fluorapatite on a Cu tube: lines 1.7× the
  instrument file's width, then η ≈ 0.8 — wR 37 → 18 → 9 %, with the positions barely
  moving until the shape was right.

## The instrument–thermal trade (the guardrail)

Wider or more Lorentzian peaks put intensity into tails that the background takes up at
high angle, and the B values' fall-off with angle gives it back; the zero and the asymmetry
shape the low-angle lines, which fix the scale the B values are measured against. Refined
together, each absorbs the other's error — a B gone negative while the profile widens, a
profile gone wrong while the B values look fine — and the esds hide it, because the trade
runs through the background and the scale rather than one clean pair.

When the instrument file does not describe the data — NAC on 11-BM: the 2009 profile was a
quarter too broad in its Gaussian part — its terms are refined, alternating with the B
values.

## Antisite disorder (the occupancy guardrail)

Cr₂WO₆: B(Cr) 0.0, B(W) 1.7 after the ADP stage — Cr's site scattered more and W's less
than the ordered model said: the two elements exchange.

## A GoF below 1 (the acceptance bar)

The GaNb4Se8 run landed GoF ≈ 0.46 — a good fit, but with generous σ's: the esds are
optimistic, and the weighting or the free-parameter count is what to check.

## Lab X-ray data (Stage 0, step 1)

The instrument file says which lines the tube gives: a Cu or Co tube without a
monochromator gives Kα₁ and Kα₂, and every reflection is drawn at both (the data card shows
"λ 1.5405 / 1.5443 Å (Kα₂ 0.5)"). A Kα₂ peak is never an extra peak. The polarization
fraction P of the Lorentz-polarization factor is an instrument constant the fit cannot
determine: it changes intensity with angle as the ADPs do, so every B moves with it at the
same wR (fluorapatite: P 0.7 → 0.5 lowered every B by ≈ 0.55 Å², and with 0.5 they matched
GSAS's own refinement of the data). Report the B values with the P they assume. If the
instrument file's P does not fit the setup the user describes (0.5 unpolarized; ≈ 0.56 for
Cu with a graphite monochromator), propose `set_instrument_constants` — it always asks the
user.

## The cell is only as good as the wavelength (Stage 0, step 1)

On constant-wavelength neutron data the wavelength is a calibration, not a constant: a cell
uniformly off by a fraction of a percent from the literature says the wavelength is (PbSO₄
on D1A: 0.13% small, λ ≈ 1.9115 Å rather than the nominal 1.909 Å). Quote such a cell as
uncalibrated, or calibrate λ against a standard or an X-ray cell.

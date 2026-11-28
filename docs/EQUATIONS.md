# Equations

The index of the physics in the code. Each equation is written here once, with
the function that implements it, its units, and its reference. Open this page
when you want to check one.

- Paths are relative to `src/`. A function is named `file.ts` `function`.
- "Copies" lists the other places where the same formula is typed, as far as
  a search of the code found them; it may not be complete. The copies are
  listed, not merged.
- "Test" names the test file that checks the function. "Independent" means the
  expected numbers come from another program or a closed form, not from this
  code.
- A reference is given only where it was sure. The ones not re-checked are in
  [References not re-checked](#references-not-re-checked).

The convention in the code: each physics function has one doc comment with the
equation in plain Unicode math, each symbol mapped to its variable, the units,
the reference, and "Also in:" for the copies. Hot loops (the single-crystal
kernel, the WGSL kernels, the TOF profile, the pattern synthesis, the pair
sums) carry comments only: no call, object or rename was added there.

`core/workflow/powder.ts` is not annotated yet (another change owns it). Its
equations are indexed here from a reading of the code; see
[Deferred](#deferred).

## Contents

1. [Symbols and units](#1-symbols-and-units)
2. [Cell geometry and the d ↔ x conversions](#2-cell-geometry-and-the-d--x-conversions)
3. [Scattering amplitudes](#3-scattering-amplitudes)
4. [Displacement (Debye–Waller) factors](#4-displacement-debyewaller-factors)
5. [Nuclear structure factor](#5-nuclear-structure-factor)
6. [Magnetic structure factor](#6-magnetic-structure-factor)
7. [Powder intensity and its corrections](#7-powder-intensity-and-its-corrections)
8. [Constant-wavelength peak profile](#8-constant-wavelength-peak-profile)
9. [Time-of-flight peak profile](#9-time-of-flight-peak-profile)
10. [Sample broadening: size and microstrain](#10-sample-broadening-size-and-microstrain)
11. [Background](#11-background)
12. [Single crystal](#12-single-crystal)
13. [PDF and mPDF](#13-pdf-and-mpdf)
14. [Agreement factors and statistics](#14-agreement-factors-and-statistics)
15. [Absorption](#15-absorption)
16. [Equations written more than once](#16-equations-written-more-than-once)
17. [One name, two units: `mustrainIso`](#17-one-name-two-units-mustrainiso)
18. [Deferred](#deferred)
19. [References not re-checked](#references-not-re-checked)

## 1. Symbols and units

| Symbol | Meaning | Unit | Usual variable |
| --- | --- | --- | --- |
| h, k, l | Miller indices (fractional for a magnetic satellite) | r.l.u. | `h`, `k`, `l` |
| d | d-spacing | Å | `d` |
| s | sinθ/λ = 1/(2d) | Å⁻¹ | `s`; `s2` is s² |
| Q | 2π/d = 4π·s | Å⁻¹ | `q` |
| θ, 2θ | Bragg angle, scattering angle | radians inside a function; 2θ in degrees as an argument (`twoThetaDeg`, `twoTheta`) | `theta` |
| λ | wavelength | Å | `wavelength` |
| T, t | time of flight | µs | `tof`, `center` |
| b | bound coherent neutron scattering length | fm | `amp`, `b` |
| f0, f′, f″ | X-ray form factor and anomalous terms | electrons | `f`, `fp`, `fpp` |
| F_N | nuclear structure factor | fm (neutron), electrons (X-ray) | `f`, `re`, `im` |
| F_M | magnetic structure factor (a complex vector) | fm | `vector`, `squared` |
| m, M, S | magnetic moment, Fourier coefficient | μ_B | `components`, `mCart` |
| p | magnetic scattering length per μ_B, 2.695 | fm/μ_B | `MAGNETIC_PREFACTOR` |
| B_iso | isotropic displacement parameter, 8π²·U_iso | Å² | `bIso` |
| U^ij | anisotropic displacement tensor (CIF `U_ij`) | Å² | `uAniso`, `u` |
| U, V, W | Caglioti coefficients (FWHM²) | centidegree² of 2θ | `caglioti.u/v/w` |
| X, Y | Lorentzian size and strain coefficients | centidegrees of 2θ | `lorentzian.x/y` |
| α, β | TOF rise and decay rates | µs⁻¹ | `alpha`, `beta` |
| σ, σ² | TOF Gaussian standard deviation, total variance at d | µs, µs² | `sigma`; `sig2` as a local variable. The field `tofProfile.sig2` is something else: σ₂², the coefficient of d⁴ ([§9](#9-time-of-flight-peak-profile)) |
| γ | TOF Lorentzian FWHM | µs | `gamma` |
| ε | microstrain Δd/d, a pure number | none | `epsilon`; see [§17](#17-one-name-two-units-mustrainiso) |
| G(r) | reduced pair distribution function | Å⁻² | `g` |
| ρ₀ | number density | Å⁻³ | `rho0` |

Two unit traps:

- `cagliotiFwhm` and `lorentzianFwhm` return **centidegrees** of 2θ. The
  caller divides by 100. The anisotropic size and strain functions return
  **degrees**.
- The structure-factor phase is exp(+2πi h·x). The neutron amplitude is
  conj(b), so absorption gives a positive imaginary part, as X-ray f″ does
  (`core/scattering/types.ts`).

## 2. Cell geometry and the d ↔ x conversions

### Metric tensors, volume, d-spacing

```
G_ij = a_i·a_j        G* = G⁻¹
V = a·b·c·√(1 − cos²α − cos²β − cos²γ + 2·cosα·cosβ·cosγ)
1/d² = hᵀ·G*·h = A11·h² + A22·k² + A33·l² + A12·hk + A13·hl + A23·kl
|Q| = 2π/d
```

- Code: `core/crystal/unitCell.ts` `metricTensor`, `reciprocalMetricTensor`,
  `cellVolume`, `reciprocalTensorA`, `inverseDSquared`, `dSpacing`,
  `qMagnitude`.
- Units: a, b, c in Å; α, β, γ in degrees; G in Å², G* in Å⁻², V in Å³.
  A12 = 2·G*12 (the factor 2 is folded in).
- Reference: International Tables for Crystallography Vol. B, ch. 1.1.
- Copies: 1/d² is typed again in three places, see
  [§16](#16-equations-written-more-than-once).
- Test: `core/crystal/unitCell.test.ts` (independent: values from a GSAS-II
  `.lst`).

### Bragg's law

```
λ = 2d·sinθ        2θ = 2·asin(λ/2d) + zero        d = λ / (2·sin((2θ − zero)/2))
```

- Code: `core/crystal/unitCell.ts` `braggTheta` (returns θ in **radians**);
  `core/diffraction/instrument.ts` `twoThetaFromD`, `dFromTwoTheta` (2θ and
  zero in **degrees**), `secondLineTwoTheta` (Kα₂: sinθ₂ = (λ₂/λ₁)·sinθ₁).
- Test: `core/diffraction/instrument.test.ts`.

### TOF ↔ d

```
T(d) = Zero + difC·d + difA·d² + difB/d
dT/dd = difC + 2·difA·d − difB/d²
d(T): Newton's method on T(d) − t = 0, from d = (t − Zero)/difC
```

- Code: `core/diffraction/instrument.ts` `tofFromD`, `dFromTof`.
- Units: T, Zero in µs; d in Å; difC in µs/Å; difA in µs/Å²; difB in µs·Å.
- Reference: GSAS-II (Toby & Von Dreele, J. Appl. Cryst. 46 (2013) 544).
- Copies: five more, see [§16](#16-equations-written-more-than-once).
- Test: `core/diffraction/instrument.test.ts`.

### Scattering vector, Cartesian

```
Q = 2π·(M⁻¹)ᵀ·(h, k, l)        M: fractional → Cartesian (a along x, b in the xy plane)
```

- Code: `core/magnetic/moment.ts` `qCartesian`, `qCartesianFor`;
  `core/crystal/unitCell.ts` `orthogonalizationMatrix`.
- Units: M in Å; Q in Å⁻¹.

## 3. Scattering amplitudes

### Neutron scattering length

```
a = conj(b) = b′ + i·b″        (the tables print b = b′ − i·b″)
```

- Code: `core/scattering/neutron.ts` `boundCoherentLength`, `neutronAmplitude`.
- Units: fm. Independent of s.
- Reference: Sears, Neutron News 3(3) (1992) 26–37.
- Test: `core/scattering/scattering.test.ts`;
  `core/diffraction/neutronSfValidation.test.ts` (independent: GSAS-II
  reflection lists).

### X-ray form factor (Cromer–Mann)

```
f0(s) = Σ_{i=1..4} a_i·exp(−b_i·s²) + c        f = f0(s) + f′ + i·f″
```

- Code: `core/scattering/xray.ts` `xrayFormFactor`;
  `core/scattering/dispersion.ts` `anomalousScattering` (f′, f″ at a
  laboratory line), added in `core/diffraction/scKernel.ts` `scPlan`
  (single crystal only).
- Units: a_i, c, f0, f′, f″ in electrons; b_i in Å²; s in Å⁻¹.
- Reference: Cromer & Mann, Acta Cryst. A24 (1968) 321; International Tables
  Vol. C, Table 6.1.1.4. f′, f″: Cromer & Liberman, Acta Cryst. A37 (1981) 267.
- Copies: `workers/gpuStructureFactor.ts` (WGSL `scatter`).
- Test: `core/scattering/scattering.test.ts` (f0(0) = Z),
  `core/scattering/dispersion.test.ts`.

### Magnetic form factor

```
⟨j0⟩(s) = A·exp(−a·s²) + B·exp(−b·s²) + C·exp(−c·s²) + D          (1 at s = 0)
⟨j2⟩(s) = [A·exp(−a·s²) + B·exp(−b·s²) + C·exp(−c·s²) + D]·s²     (0 at s = 0)
f(s) = ⟨j0⟩ + (2/g − 1)·⟨j2⟩                                      (dipole approximation)
```

- Code: `core/scattering/magnetic.ts` `magneticFormFactorJ0`,
  `magneticFormFactorJ2`, `magneticFormFactorDipole`.
- Units: dimensionless; a, b, c in Å²; s in Å⁻¹; g the Landé factor.
- Reference: P. J. Brown, International Tables Vol. C, §4.4.5. Dipole form:
  Lovesey (1984), Vol. 2 (equation number not re-checked).
- Copies: ⟨j0⟩ in `workers/gpuMagneticStructureFactor.ts` (WGSL); an average
  3d ⟨j0⟩ with fixed constants in `core/magnetic/mpdf.ts` `j0Profile` (the
  fallback of `diffpy.mpdf`).
- Note: the magnetic structure factor uses ⟨j0⟩ only (`table.j0`).
- Test: `core/scattering/scattering.test.ts`.

## 4. Displacement (Debye–Waller) factors

```
isotropic:    T = exp(−B_iso·s²)                       B_iso = 8π²·U_iso
anisotropic:  T = exp(−2π²·Σ_ij U^ij·h_i·h_j·a*_i·a*_j)
              = exp(−2π²(U11 h²a*² + U22 k²b*² + U33 l²c*² + 2U12 hk a*b* + 2U13 hl a*c* + 2U23 kl b*c*))
orbit image:  U′ = R·U·Rᵀ
U_eq = ⅓ Σ_ij U^ij·a*_i·a*_j·(a_i·a_j)
```

- Code: `core/diffraction/structureFactor.ts` `debyeWaller`,
  `anisotropicDebyeWaller`; `core/crystal/adp.ts` `rotateUAniso`,
  `uEquivalent`, `uIsoFromBIso`.
- Units: B, U in Å²; a*, b*, c* in Å⁻¹; T dimensionless. T multiplies the
  amplitude, so the intensity carries T².
- Reference: Trueblood et al., Acta Cryst. A52 (1996) 770; U_eq: Fischer &
  Tillmanns, Acta Cryst. C44 (1988) 775.
- Copies: four places in all, see [§16](#16-equations-written-more-than-once).
- Test: `core/diffraction/structureFactor.test.ts`,
  `core/crystal/adpRotation.test.ts`, `core/crystal/adp.test.ts`.

## 5. Nuclear structure factor

```
F_N(hkl) = Σ_sites occ·a(s)·Σ_orbit T·exp[2πi(h·x + k·y + l·z)]
∂F/∂occ_j = F_site,j / occ_j        ∂F/∂B_j = −s²·F_site,j
∂F/∂Δ (shift along v) = occ·a·T_iso·2πi·Σ e·(h′·v),   h′ = Rᵀh
```

- Code: `core/diffraction/structureFactor.ts` `nuclearStructureFactor`,
  `nuclearStructureFactorPartials`, `nuclearStructureFactorSquared`.
- Units: F_N in fm (neutron) or electrons (X-ray); |F_N|² in fm² or
  electrons². The orbit is each site's distinct positions, each once.
- Reference: International Tables for Crystallography Vol. B, ch. 1.2.
- Copies: `core/diffraction/scKernel.ts` `scStructureFactors` (with every
  derivative; hot loop); `workers/gpuStructureFactor.ts` (WGSL, f32).
- Test: `core/diffraction/structureFactor.test.ts` (closed form),
  `core/diffraction/neutronSfValidation.test.ts` and
  `core/diffraction/sfDiagnostic.test.ts` (independent: GSAS-II Fc²),
  `core/diffraction/scKernel.test.ts` (kernel against the named function).

## 6. Magnetic structure factor

```
p = γ_n·r_e/2 = 1.91304 × 2.81794 fm / 2 = 2.695 fm/μ_B
F_M(h) = p·Σ_moments occ·f(s)·Σ_images T·A·[M⊥^cos + i·a·M⊥^sin]·exp[2πi(h·r − a·k·c)]
M⊥ = M − q̂(M·q̂)
orbit image: m′ = θ·det(R)·R·m        (axial vector; θ the time-reversal sign)
|F_M|² = |F_x|² + |F_y|² + |F_z|²
powder line: I = Σ_{Q ∈ family} |F_M⊥(Q)|²
moment in cell n: m(n) = A′·(S^Re·cos φ + S^Im·sin φ),   φ = 2π k·n
```

- A is the two-arm factor: ½ when −k and k are distinct arms, 1 when k is
  self-conjugate (k = 0 included). a is +1 for the satellite H + k and −1 for
  H − k. A′ is the number of arms (2 or 1). c is the operation's centring
  translation.
- Code: `core/magnetic/structureFactor.ts` `MAGNETIC_PREFACTOR`,
  `magneticStructureFactorEvaluator`, `magneticStructureFactor`,
  `expandMagneticAtoms`; `core/magnetic/moment.ts` `perpendicularMoment`,
  `crystalComponentsToCartesian`; `core/magnetic/propagation.ts`
  `fourierArmFactor`; `core/magnetic/powderAverage.ts` `familySquared`;
  `core/magnetic/fourierMoment.ts` `fourierMagneticStructureFactor`,
  `momentInCell`.
- Units: moments in μ_B; F_M in fm; |F_M|² in fm², the scale of |F_N|².
- Reference: Halpern & Johnson, Phys. Rev. 55 (1939) 898; Squires,
  *Introduction to the Theory of Thermal Neutron Scattering*, ch. 7; Bertaut,
  Acta Cryst. A24 (1968) 217; Rodríguez-Carvajal, Physica B 192 (1993) 55.
- Copies: `core/magnetic/fourierMoment.ts` `fourierMagneticStructureFactor`
  (the same sum from explicit Fourier coefficients, no Debye–Waller factor);
  `workers/gpuMagneticStructureFactor.ts` (WGSL, real coefficients only).
  M⊥ is typed three times (`perpendicularMoment`, the evaluator's `perp`, the
  WGSL `mperp`).
- Test: `core/magnetic/prefactor.test.ts` (the constant),
  `core/magnetic/magnetic.test.ts`, `core/magnetic/afmStructureFactor.test.ts`,
  `core/magnetic/fourierMoment.test.ts`, `core/magnetic/powderAverage.test.ts`.

## 7. Powder intensity and its corrections

### Integrated intensity

```
I(hkl) = m·Lp·P_MD·|F_N|²·scale        then × A(μR, 2θ) × C(θ) at the peak's place
```

- Code: `core/diffraction/intensity.ts` `powderPeakIntensities`; the last two
  factors in `core/workflow/powder.ts` `placePeaks` through
  `core/diffraction/corrections.ts`.
- Units: m the multiplicity; |F_N|² in fm² or electrons²; the scale is free,
  so I is in the units of the data.

### Lorentz and polarization

```
neutron, CW:  L = 1/(sin²θ·cosθ)
X-ray, CW:    Lp = [(1 − P)·cos²2θ + P] / (sin²θ·cosθ)        P = 0.5: unpolarized
neutron, TOF: L = d⁴
```

- Code: `core/diffraction/intensity.ts` `lorentzPolarization`.
- Units: dimensionless on CW; Å⁴ on TOF (a relative factor).
- Reference: Buras & Gerward, Acta Cryst. A31 (1975) 372; Azároff, Acta
  Cryst. 8 (1955) 701; GSAS-II.
- Test: none of its own; it is exercised through the powder workflow tests
  (`core/workflow/tofKnownTruth.test.ts` for TOF).

### March–Dollase preferred orientation

```
P(α) = (r²·cos²α + sin²α/r)^(−3/2)        P_MD(hkl) = mean of P(α) over the Laue family
```

- Code: `core/diffraction/intensity.ts` `marchDollase`, `marchDollaseFamily`.
- Units: r dimensionless (1: no texture); α the angle between the reflection
  and the axis, from the reciprocal metric.
- Reference: Dollase, J. Appl. Cryst. 19 (1986) 267; the family mean as
  GSAS-II's GetPrefOri.
- Test: `core/diffraction/intensity.test.ts`.

### Cylinder absorption

```
μR ≤ 3:  A = exp(−T₀·μR − T₁·μR² − T₂·μR³ − T₃·μR⁴),   T₀ = 16/(3π)
μR > 3:  A = [(T₁ − T₄)/(1 + T₂·(μR − 3))^T₃ + T₄] / 100
```

- T₁ … T₄ are fitted functions of sin²θ (constants in the code).
- Code: `core/diffraction/intensity.ts` `cylinderAbsorption`.
- Units: μR dimensionless; A ≤ 1.
- Source: a port of GSAS-II's `Absorb`, cylinder branch. The fit is credited
  to Lobanov & Alte da Veiga in GSAS-II's source (GSASIIpwd.py).
- Test: `core/diffraction/intensity.test.ts`.

### Surface roughness

```
C(θ) = [SRA + (1 − SRA)·exp(−SRB/sinθ)] / [SRA + (1 − SRA)·exp(−SRB)]
```

- Code: `core/diffraction/intensity.ts` `surfaceRoughness`.
- Reference: Suortti, J. Appl. Cryst. 5 (1972) 325; GSAS-II `SurfaceRough`.

### Peak-position corrections (CW)

```
Δ2θ = zero + s·cosθ + t·sin2θ
```

- Code: `core/diffraction/corrections.ts` `displacement`, `transparency`;
  the zero in `core/workflow/powder.ts` `placePeaks`.
- Units: zero, s, t and Δ2θ in degrees of 2θ.
- Test: `core/diffraction/corrections.test.ts`.

## 8. Constant-wavelength peak profile

### Shapes

```
G(x) = (2/Γ)·√(ln2/π)·exp[−4 ln2·(x − x₀)²/Γ²]
L(x) = (Γ/2π) / [(x − x₀)² + (Γ/2)²]
pV(x) = η·L(x) + (1 − η)·G(x)
```

- Code: `core/diffraction/profile.ts` `gaussian`, `lorentzian`, `pseudoVoigt`.
- Units: x, x₀, Γ in the pattern's x unit; each shape has unit area.

### Widths

```
Caglioti:    Γ_G² = U·tan²θ + V·tanθ + W
Lorentzian:  Γ_L = X/cosθ + Y·tanθ
```

- Code: `core/diffraction/profile.ts` `cagliotiFwhm`, `lorentzianFwhm`.
- Units: the argument is 2θ in **degrees**. U, V, W in centidegree², X, Y in
  centidegrees; both functions return **centidegrees** and the caller divides
  by 100 (`core/workflow/powder.ts` `placePeaks`). U, V, W here are FWHM²:
  8 ln 2 times the variances in a GSAS-II file (`InstrumentParameters`).
- Reference: Caglioti, Paoletti & Ricci, Nucl. Instrum. 3 (1958) 223; the
  Lorentzian width as in GSAS (Larson & Von Dreele, LAUR 86-748).
- Copies: the Caglioti curve is typed again in `core/workflow/leBail.ts`
  `cwWidth` (in degrees², through `cagliotiOf`, which divides by 10⁴).
- Test: `core/diffraction/profile.test.ts`,
  `core/workflow/gsasBenchmark.test.ts` (independent, data-gated).

### Thompson–Cox–Hastings

```
Γ⁵ = Γ_G⁵ + 2.69269·Γ_G⁴Γ_L + 2.42843·Γ_G³Γ_L² + 4.47163·Γ_G²Γ_L³ + 0.07842·Γ_GΓ_L⁴ + Γ_L⁵
η  = 1.36603·(Γ_L/Γ) − 0.47719·(Γ_L/Γ)² + 0.11116·(Γ_L/Γ)³
```

- Code: `core/diffraction/profile.ts` `tchPseudoVoigt`.
- Units: one unit for the three widths (degrees on CW, µs on TOF).
- Reference: Thompson, Cox & Hastings, J. Appl. Cryst. 20 (1987) 79.

### Axial divergence (Finger–Cox–Jephcoat)

- Code: `core/diffraction/profile.ts` `fcjSubPeaks`: each peak becomes
  sub-peaks at Gauss–Legendre nodes between 2θ_min and 2θ, weighted by
  W/(h·cos2φ), eqs (1), (4)–(7) of the paper.
- Units: S/L, H/L dimensionless; angles in degrees.
- Reference: Finger, Cox & Jephcoat, J. Appl. Cryst. 27 (1994) 892.
- Test: `core/diffraction/profile.test.ts`.

## 9. Time-of-flight peak profile

### Back-to-back exponentials ⊗ Gaussian

```
H(Δ) = N·[e^u·erfc(y) + e^v·erfc(z)],        N = αβ / [2(α + β)]
u = (α/2)(ασ² + 2Δ)    y = (ασ² + Δ)/(σ√2)    v = (β/2)(βσ² − 2Δ)    z = (βσ² − Δ)/(σ√2)
```

### With a Lorentzian width γ > 0 (⊗ pseudo-Voigt)

```
Γ, η from Γ_G = 2√(2 ln 2)·σ and γ by Thompson–Cox–Hastings
H(Δ) = (1 − η)·N·[e^u·erfc(y) + e^v·erfc(z)]  −  (2Nη/π)·{Im[e^p·E₁(p)] + Im[e^q·E₁(q)]}
u, v, y, z at σ = Γ/2√(2 ln 2)
GSAS, GSAS-II:  p = −αΔ + iαΓ/2        FullProf:  p = +αΔ + iαΓ/2        q = −βΔ + iβΓ/2
```

- Code: `core/diffraction/profile.ts` `tofBackToBack`,
  `tofBackToBackPseudoVoigt`, `imExpE1` (Im[eᶻE₁(z)]), `erfc`, `erfcxNonneg`.
- Units: Δ = t − t_hkl in µs; α, β in µs⁻¹; σ in µs; γ, Γ in µs (FWHM); H in
  µs⁻¹ with unit area.
- Reference: Von Dreele, Jorgensen & Windsor, J. Appl. Cryst. 15 (1982) 581;
  the GSAS manual (Larson & Von Dreele, LAUR 86-748), TOF profile function 3;
  FullProf's NPROF 9; Abramowitz & Stegun 5.1.11, 5.1.22, 5.1.51 for E₁;
  Numerical Recipes §6.2 for erfc (error ≲ 1.2 × 10⁻⁷).
- Test: `core/diffraction/tofProfile.test.ts` (unit area, known values),
  `core/diffraction/tofLorentz.test.ts` (independent: 40-digit mpmath values
  and GSAS-II's compiled routine), `core/workflow/tofKnownTruth.test.ts`
  (independent: patterns from GSAS-II and from a separate Python reference).

### Widths at d

```
α = α₀ + α₁/d
β = β₀ + β₁/d⁴ + β_q/d²
σ² = σ₀² + σ₁²·d² + σ₂²·d⁴ + σ_q²·d  +  (|dT/dd|·ε·d)²
γ = X·d + Y·d² + Z  +  10⁻⁶·difC·d·M  +  10⁻⁴·difC·d²/S
```

- Code: `core/workflow/powder.ts` `tofWidthsAt` (an instrument file's
  profile: nothing is floored; a non-positive σ², α or β means no peak; a
  negative γ counts as 0) and `buildTofPeaks` (the app's own refinable
  profile: no γ; α, β and σ² each floored at 10⁻⁶).
- Units: α₀ in µs⁻¹; α₁ in Å/µs; β₀ in µs⁻¹; β₁ in Å⁴/µs; β_q in Å²/µs; the
  σ² coefficients in µs² per their power of d (`sig0`, `sig1`, `sig2`, `sigQ`
  are variances, not standard deviations); X in µs/Å, Y in µs/Å², Z in µs.
- **The 10⁻⁶ and 10⁻⁴ factors.** They are explained in the code at
  `core/export/bundle.ts` `pcrTofShape`, where the same terms are exported,
  and not yet at `tofWidthsAt` itself:
  - M is the sample's Lorentzian microstrain as the row holds it, GSAS-II's
    Mustrain, in units of 10⁻⁶. So 10⁻⁶·M is a strain Δd/d, 10⁻⁶·M·d is the
    width in d (Å), and difC (µs/Å) turns it into µs.
  - S is the sample's size as the row holds it, GSAS-II's Size, in µm.
    1 µm = 10⁴ Å. Size broadening is Δd = d²/D (Scherrer with K = 1), so with
    D = 10⁴·S Å the width is 10⁻⁴·d²/S Å, and difC turns it into µs.
  - The Gaussian term has no 10⁻⁶: `sampleGauss` on the applied model is
    already ε (the row × 10⁻⁶, converted in `core/workflow/apply.ts`). One
    function holds three sample rows in two conventions.
- **|dT/dd| or difC.** The Gaussian strain term maps d to T with
  |dT/dd| = |difC + 2·difA·d − difB/d²| (`core/diffraction/anisoStrain.ts`
  `isotropicStrainSigmaTof`, `stephensStrainSigmaTof`). The Lorentzian strain
  and size terms use difC, as GSAS-II's GetSampleSigGam does for all three.
  Between |dT/dd| and difC, the relative difference is (2·difA·d − difB/d²)/difC: about 1 % on NOMAD
  (difB = 0 in the 2023A file; 1 % at 2 Å in bank 4, up to 2 % at the longest
  d of banks 1 and 2). The
  planned change is under [Deferred](#deferred).
- Reference: GSAS-II `getTOFalpha`, `getTOFbeta`, `getTOFsig`, `getTOFgamma`,
  `GetSampleSigGam`; the FullProf manual.
- Copies: `core/workflow/leBail.ts` `tofShapeAt` (α, β, σ² for the Le Bail
  prefit); `core/workflow/powder.ts` `tofWidthInvalidAt`;
  `core/export/bundle.ts` `pcrTofShape`, `powderExtras`, `tofShapeFromParams`
  (the sample terms folded into the exported coefficients, with difC).
- Test: `core/workflow/tofFileProfile.test.ts`, `core/workflow/tofSigQ.test.ts`,
  `core/workflow/tofKnownTruth.test.ts` (independent).

### Peak support

- A peak is drawn within ±20 support widths of its centre and faded to zero
  over the outer fifth (`core/diffraction/profile.ts` `PEAK_WINDOW_FWHM`,
  `supportTaper`). A TOF peak with a Lorentzian part reaches further:
  `tofLorentzSupport`, X = η·Γ/(π·2 × 10⁻⁴).

## 10. Sample broadening: size and microstrain

### From the Lorentzian X, Y (CW)

```
D = 18000·K·λ/(π·X)   [Å]        ε = π·Y/72000   [pure number]
```

- Code: `core/diffraction/microstructure.ts` `extractSizeStrain`.
- Units: X, Y in centidegrees; λ in Å; K the Scherrer constant (0.9 by
  default). (π/18000)·X radians is K·λ/D; (π/18000)·Y radians is 4·ε.
- The two constants: the size constant 18000/π is GSAS's; ε = π·Y/72000 is the
  Stokes–Wilson strain, β = 4·ε·tanθ; GSAS-II's Mustrain for the same Y is
  10⁶·π·Y/18000, four times ε·10⁶.
- Reference: Scherrer (1918); Stokes & Wilson, Proc. Phys. Soc. 56 (1944)
  174–181; Williamson & Hall, Acta Metall. 1 (1953) 22.
- Test: `core/diffraction/microstructure.test.ts`.

### Williamson–Hall

```
β·cosθ = K·λ/D + 4·ε·sinθ
```

- Code: `core/diffraction/microstructure.ts` `williamsonHall`.
- Units: β in degrees of 2θ on input, radians inside; D in Å.

### Uniaxial size and strain (CW)

```
cos²ψ = (h·G*·t)² / [(h·G*·h)·(t·G*·t)]
Γ_size = [X_⊥ + (X_∥ − X_⊥)·cos²ψ] / (100·cosθ)
Γ_strain = [Y_⊥ + (Y_∥ − Y_⊥)·cos²ψ]·tanθ / 100
```

- Code: `core/diffraction/anisoSize.ts` `cos2Psi`, `uniaxialSizeFwhmDeg`,
  `uniaxialSizeDimensions`; `core/diffraction/anisoStrain.ts`
  `uniaxialStrainFwhmDeg`.
- Units: X, Y in centidegrees; both functions return **degrees** of 2θ.
- How each enters the fit (`core/workflow/powder.ts` `placePeaks`): the
  uniaxial size is ADDED to the isotropic Lorentzian width X/cosθ + Y·tanθ;
  the uniaxial strain REPLACES the isotropic Y·tanθ (it is added and Y·tanθ
  subtracted).
- Reference: Langford & Louër, Rep. Prog. Phys. 59 (1996) 131; GSAS-II's
  uniaxial models.
- Test: `core/diffraction/anisoSize.test.ts`,
  `core/diffraction/anisoStrain.test.ts`.

### Anisotropic microstrain (Stephens)

```
σ²(M) = Σ_{H+K+L=4} S_HKL·hᴴ·kᴷ·lᴸ,        M = 1/d²
CW:   Γ_G(2θ) = 2√(2 ln 2)·d²·√(σ²(M))·tanθ        [radians; returned in degrees]
TOF:  σ_T = |dT/dd|·½·d³·√(σ²(M))                   [µs, a standard deviation]
```

- Code: `core/diffraction/anisoStrain.ts` `quarticStrainInvariants` (the
  allowed S_HKL, from the Laue group), `strainVarianceM`,
  `stephensStrainFwhmDeg`, `stephensStrainSigmaTof`.
- Units: S_HKL in Å⁻⁴ as the rows hold them (no 10⁻⁶ factor in the code).
- Reference: Stephens, J. Appl. Cryst. 32 (1999) 281; Popa, J. Appl. Cryst.
  31 (1998) 176.
- The code uses |dT/dd| where GSAS-II uses difC; the relative difference is (2·difA·d − difB/d²)/difC: about 1 % on NOMAD
  (difB = 0 in the 2023A file; 1 % at 2 Å in bank 4, up to 2 % at the longest
  d of banks 1 and 2).
- Test: `core/diffraction/anisoStrain.test.ts`,
  `core/workflow/tofMicrostrain.test.ts`.

### Isotropic microstrain (TOF)

```
σ_T = |dT/dd|·ε·d = |difC + 2·difA·d − difB/d²|·ε·d        [µs, a standard deviation]
```

- Code: `core/diffraction/anisoStrain.ts` `isotropicStrainSigmaTof`.
- Units: ε a pure number, the standard deviation of Δd/d; see
  [§17](#17-one-name-two-units-mustrainiso).
- The code uses |dT/dd| where GSAS-II uses difC; the relative difference is (2·difA·d − difB/d²)/difC: about 1 % on NOMAD
  (difB = 0 in the 2023A file; 1 % at 2 Å in bank 4, up to 2 % at the longest
  d of banks 1 and 2).
- Test: `core/workflow/tofMicrostrain.test.ts`.

## 11. Background

```
Chebyshev:     b(x) = Σ_n c_n·T_n(t),   t = 2·(x − x_min)/(x_max − x_min) − 1
               T_0 = 1,  T_1 = t,  T_{n+1} = 2t·T_n − T_{n−1}
cosine:        b(x) = Σ_n c_n·cos(nπ·s),   s = (x − x_min)/(x_max − x_min)
power series:  b(x) = Σ_n c_n·tⁿ
interpolation: X_j = x_min + j·(x_max − x_min)/(N − 1)                      (linear)
               X_j = exp(ln x_min + j·(ln x_max − ln x_min)/(N − 1))        (log)
               b(x) = c_j + (c_{j+1} − c_j)·(x − X_j)/(X_{j+1} − X_j)
polynomial:    b(x) = Σ_n c_n·xⁿ                                            (x not normalized)
```

- Code: `core/diffraction/background.ts` `chebyshevBackground`,
  `cosineBackground`, `powerSeriesBackground`, `interpAnchors`,
  `linInterpolateBackground`, `logInterpolateBackground`,
  `polynomialBackground`, `evaluateBackground`; the starting values in
  `estimateBackground`.
- **The domain.** x_min and x_max are the smallest and largest x of the
  pattern's points, all of them, inside the fit range or not. Each caller
  finds them from the array it holds and passes them as arguments
  (`core/diffraction/profile.ts` `synthesizePattern` for the fit). They are
  not stored with the coefficients: the same coefficients on a pattern with
  other end points are another curve.
- Units: c_n in the units of y; t, s dimensionless; x in the pattern's unit.
- Reference: Abramowitz & Stegun, ch. 22 (Chebyshev polynomials of the first
  kind and their recurrence).
- Copies: the Chebyshev recurrence in `core/workflow/leBailPrefit.ts`
  (`cheb`); the interpolation points in `core/export/bundle.ts`
  `powderExtras`.
- Test: `core/diffraction/background.test.ts`.

## 12. Single crystal

```
Fc² = k·y·|F|²
SHELXL extinction:  y = [1 + 0.001·x·F²·λ³/sin2θ]^(−1/2)
Becker–Coppens:     y = [1 + 2p + A·p²/(1 + B·p)]^(−1/2),   p = Q·T̄·ψ
weights:            w = 1/[σ²(Fo²) + (a·P)² + b·P],   P = [max(Fo², 0) + 2·Fc²]/3
wR2 = √[Σ w(Fo² − Fc²)² / Σ w(Fo²)²]    R1 = Σ||Fo| − |Fc|| / Σ|Fo|    S = √[Σ w(Fo² − Fc²)²/(N − P)]
```

- Code: `core/diffraction/singleCrystalFactors.ts` `extinctionFactor`,
  `beckerCoppensFactor`, `shelxWeights`, `suggestShelxWeighting`,
  `singleCrystalAgreement`.
- Units: λ in Å; F² in fm² or electrons²; T̄ in cm; V in Å³.
- Reference: Sheldrick, Acta Cryst. A64 (2008) 112 and C71 (2015) 3; the
  SHELXL manual; Becker & Coppens, Acta Cryst. A30 (1974) 129, as GSAS-II
  computes it (`SCExtinction`).
- Test: `core/diffraction/singleCrystalFactors.test.ts`,
  `core/workflow/sc1b.test.ts`, `sc2b.test.ts`, `sc3a.test.ts`.

## 13. PDF and mPDF

### Real-space G(r)

```
G(r) = scale·E(r)·{ (1/(N⟨b⟩²)) Σ_pairs w_ij·𝒩(r; r_ij, σ_ij)/r_ij − 4π·r·ρ₀ }
σ_ij² = n̂ᵀ(U_i + U_j)n̂ · (1 − δ1/r_ij − δ2/r_ij² + Qbroad²·r_ij²)
E(r) = γ₀(r/d)·exp(−(r·Qdamp)²/2),   γ₀(x) = 1 − 3x/2 + x³/2 (x < 1)
```

- Code: `core/pdf/forwardModel.ts` `computeGofR`, `sphereEnvelope`;
  `core/pdf/pairEnumerator.ts` (pairs and n̂ᵀUn̂);
  `core/totalscattering/weights.ts` `compositionWeights`, `pairWeight`,
  `numberDensity`.
- Units: r, σ in Å; U in Å²; δ1 in Å; δ2 in Å²; Qdamp, Qbroad in Å⁻¹; b in fm
  (neutron) or Z (X-ray); ρ₀ in Å⁻³; G in Å⁻².
- Reference: Farrow et al., J. Phys.: Condens. Matter 19 (2007) 335219;
  Proffen & Billinge, J. Appl. Cryst. 32 (1999) 572.
- Copies: `core/pdf/partials.ts` `computePartialsGofR` and
  `core/pdf/gradients.ts` repeat the pair term in the same order.
- Test: `core/pdf/pdf.test.ts`, `core/pdf/pdffit2Golden.test.ts`
  (independent: PDFfit2), `core/pdf/partials.test.ts`.

### Termination at Qmax

```
G_t(r) = ∫ K(r − r′)·G(r′) dr′,        K(x) = sin(Qmax·x)/(π·x)
```

- Code: `core/pdf/termination.ts` `bandLimit`, `terminationMargin`.
- Units: Qmax in Å⁻¹; the grid step h in Å.
- Test: `core/pdf/termination.test.ts`.

### S(Q) → G(r)

```
G(r) = (2/π) ∫ F(Q)·M(Q)·sin(Q·r) dQ,        F(Q) = Q·[S(Q) − 1]
Lorch: M(Q) = sin(πQ/Qmax)/(πQ/Qmax)
Cov[G(r), G(r′)] = Σ_k σ_F,k²·φ_k(r)·φ_k(r′),   φ_k(r) = c_k·sin(Q_k·r)
```

- Code: `core/totalscattering/fourier.ts` `sineTransformOperator`,
  `sineTransform`, `sineTransformSigma`, `sineTransformCovariance`,
  `lorchModification`, `lowQIntegrals`.
- Units: Q in Å⁻¹; r in Å; F in Å⁻¹; G in Å⁻².
- Reference: Lorch, J. Phys. C 2 (1969) 229; the module header lists the rest.
- Test: `core/totalscattering/fourier.test.ts`,
  `core/totalscattering/pystogGolden.test.ts` (independent: pystog),
  `core/totalscattering/stogGolden.test.ts` (independent, data-gated).

### mPDF

```
f(r) = (3/2N) Σ_{i≠j} [A_ij·δ(r − r_ij)/r + B_ij·(r/r_ij³)·Θ(r_ij − r)] − 4π·r·ρ₀·m̄_net²
A_ij = (m_i·ŷ)(m_j·ŷ)/|ŷ|²        B_ij = 2(m_i·x̂)(m_j·x̂) − A_ij
d(r) = (K₁/2π)·[f ⊛ S](r) + paraScale·(−K₂/π)·S′(r)
K₁ = (2/3)·(γr₀/2)²        K₂ = (2/3)·(γr₀/2)²·⟨m²⟩
```

- Code: `core/magnetic/mpdf.ts` `computeNormalizedMpdf`,
  `computeUnnormalizedMpdf`, `formFactorEnvelope`, `enumerateSpinPairs`.
- Units: moments in μ_B; r in Å; f in μ_B²·Å⁻²; (γr₀/2)² in barn, so d(r) is
  in barn·μ_B²·Å⁻² (× 100 for fm²·μ_B²·Å⁻²).
- Reference: Frandsen, Yang & Billinge, Acta Cryst. A70 (2014) 3; Frandsen &
  Billinge, Acta Cryst. A71 (2015) 325; the code follows `diffpy.mpdf`.
- Test: `core/magnetic/mpdfGolden.test.ts` and `mnoGolden.test.ts`
  (independent: diffpy.mpdf).

## 14. Agreement factors and statistics

```
R = Σ|y_o − y_c| / Σ|y_o|        R_wp = √[Σ w(y_o − y_c)² / Σ w·y_o²]
R_exp = √[(N − P) / Σ w·y_o²]    GoF = R_wp/R_exp        χ²_red = GoF²
χ² = Σ w(y_o − y_c)²             esd_j = √(C_jj·χ²_red)
```

- Code: `core/refinement/factors.ts` `computeAgreementFactors`, `chiSquared`;
  `core/refinement/engine.ts` `esdsFrom`.
- N counts the points with a positive weight.
- Reference: Toby, Powder Diffr. 21 (2006) 67.
- Copies: `app/powderPage.ts` `weightedR` and `curvesGoodnessOfFit` (the page,
  over its own window); `core/diagnostics/powderValidation.ts`;
  `core/workflow/nextParameters.ts`. See
  [§16](#16-equations-written-more-than-once).
- Test: `core/refinement/factors.test.ts`.

```
Hamilton: F = (Δχ²/q) / (χ²_best/ν_best), against F(q, ν_best)
BIC = χ² + k·ln n
```

- Code: `core/diagnostics/hamilton.ts` `withinNoiseOfBest`;
  `core/diagnostics/backgroundTerms.ts`.
- Reference: Hamilton, Acta Cryst. 18 (1965) 502; Schwarz, Ann. Stat. 6
  (1978) 461.
- Test: `core/diagnostics/hamilton.test.ts`.

## 15. Absorption

```
A = (1/V) ∫_V exp(−μ·(L_in + L_out)) dV
σ_a(λ) = σ_a(2200 m/s)·λ/1.7982 Å
μ [cm⁻¹] = Σ_j N_j·[σ_a,j(λ) + σ_coh,j + σ_incoh,j] [barn] / V [Å³]
```

- Code: `core/absorption/transmission.ts` `transmissionFactor`;
  `core/scattering/neutronAbsorption.ts` `absorptionCrossSection`,
  `absorptionBreakdown`, `linearAbsorptionCoefficient`.
- Units: μ and the crystal's dimensions in reciprocal units (cm⁻¹ and cm);
  1 barn/Å³ = 1 cm⁻¹.
- Reference: International Tables Vol. C, ch. 6.3; Sears, Neutron News 3(3)
  (1992) 26.
- Test: `core/absorption/transmission.test.ts` (closed forms),
  `core/scattering/neutronAbsorption.test.ts`.

## 16. Equations written more than once

The copies are listed so that a check of one formula covers all of them. They
are not merged: a copy in a hot loop stays there by design, and a copy whose
arithmetic order differs would change the last bit of a result.

| Equation | Named function | Copies |
| --- | --- | --- |
| Debye–Waller, isotropic and anisotropic (4 places) | `core/diffraction/structureFactor.ts` `debyeWaller`, `anisotropicDebyeWaller` | `core/diffraction/scKernel.ts` `scStructureFactors` (hot); `workers/gpuStructureFactor.ts` WGSL `debyeWaller` (hot); `workers/gpuMagneticStructureFactor.ts` WGSL `debyeWaller` (hot) |
| TOF centre T(d) (6 places) | `core/diffraction/instrument.ts` `tofFromD` | same file `dFromTof` (Newton residual); `core/workflow/powder.ts` `buildTofFilePeaks`, `buildTofPeaks` (hot), `tofAt`; `core/workflow/leBail.ts` `dToX` |
| dT/dd (3 places) | `core/diffraction/instrument.ts` `dFromTof` | `core/diffraction/anisoStrain.ts` `stephensStrainSigmaTof`, `isotropicStrainSigmaTof` |
| Nuclear structure-factor sum (3 places) | `core/diffraction/structureFactor.ts` `nuclearStructureFactor` | `core/diffraction/scKernel.ts` (hot); `workers/gpuStructureFactor.ts` (hot) |
| Cromer–Mann f0 (2 places) | `core/scattering/xray.ts` `xrayFormFactor` | `workers/gpuStructureFactor.ts` WGSL `scatter` (hot) |
| ⟨j0⟩ (2 places) | `core/scattering/magnetic.ts` `magneticFormFactorJ0` | `workers/gpuMagneticStructureFactor.ts` (hot) |
| Magnetic structure-factor sum (3 places) | `core/magnetic/structureFactor.ts` `magneticStructureFactorEvaluator` (hot) | `core/magnetic/fourierMoment.ts` `fourierMagneticStructureFactor`; `workers/gpuMagneticStructureFactor.ts` (hot) |
| M⊥ = M − q̂(M·q̂) (3 places) | `core/magnetic/moment.ts` `perpendicularMoment` | the evaluator's `perp` (hot); WGSL `mperp` (hot) |
| 1/d² (4 places) | `core/crystal/unitCell.ts` `inverseDSquared` | `core/magnetic/structureFactor.ts` `magneticStructureFactorEvaluator` (hot); `core/diffraction/reflections.ts` `generateReflections` (hot); `core/magnetic/kSearch.ts` `reflectionTable` (with its gradient) |
| Bragg's law, 2θ → d (2 places) | `core/diffraction/instrument.ts` `dFromTwoTheta` | `core/workflow/powder.ts` `dAtX` |
| TOF widths α, β, σ² (4 places) | `core/workflow/powder.ts` `tofWidthsAt` | same file `buildTofPeaks` (hot), `tofWidthInvalidAt`; `core/workflow/leBail.ts` `tofShapeAt` |
| TOF sample terms 10⁻⁶·difC·d·M, 10⁻⁴·difC·d²/S, (difC·ε)²·d² (2 to 4 places) | `core/workflow/powder.ts` `tofWidthsAt` | `core/export/bundle.ts` `pcrTofShape`, `powderExtras`, `tofShapeFromParams`; `core/export/gsas2.ts` (the same widths as GSAS-II's one Mustrain) |
| Chebyshev map and recurrence (2 places) | `core/diffraction/background.ts` `chebyshevBackground` | `core/workflow/leBailPrefit.ts` (`cheb`) |
| Interpolation points X_j (2 places) | `core/diffraction/background.ts` `interpAnchors` | `core/export/bundle.ts` `powderExtras` (in log mode not an exact copy: the end points are computed, not set to x_min and x_max) |
| Caglioti curve (2 places) | `core/diffraction/profile.ts` `cagliotiFwhm` | `core/workflow/leBail.ts` `cwWidth` |
| PDF pair term (3 places) | `core/pdf/forwardModel.ts` `computeGofR` (hot) | `core/pdf/partials.ts` `computePartialsGofR`; `core/pdf/gradients.ts` |
| R_wp, R_exp, GoF (4 places) | `core/refinement/factors.ts` `computeAgreementFactors` | `app/powderPage.ts` `weightedR`, `curvesGoodnessOfFit`; `core/diagnostics/powderValidation.ts` `powderValidation` (R, R_wp, R_exp again, and their background-subtracted forms); `core/workflow/nextParameters.ts` `rankNextParameterGroups` (R_wp from χ²) |
| D = 18000·K·λ/(π·X) (2 places) | `core/diffraction/microstructure.ts` `extractSizeStrain` | `core/diffraction/anisoSize.ts` `uniaxialSizeDimensions` |
| 2√(2 ln 2) (several) | `core/diffraction/profile.ts` `FWHM_PER_SIGMA` | `core/diffraction/anisoStrain.ts` `SQRT_8LN2`; the rounded 2.3548 in `core/workflow/powder.ts` (support widths only) and `core/export/gsas2.ts` |

## 17. One name, two units: `mustrainIso`

The model computes with **ε = Δd/d, a pure number** (0.001 is 0.1 %). That is
the one name and unit for the physics.

The refinement row of the same name holds **10⁶·ε** (GSAS-II's Mustrain unit,
"×10⁻⁶"). `core/workflow/apply.ts` `applyParameters` converts once: row × 10⁻⁶
→ ε.

| Where | Holds | Unit |
| --- | --- | --- |
| `core/diffraction/anisoStrain.ts` `isotropicStrainSigmaTof` (`epsilon`) | ε | pure number |
| `core/workflow/apply.ts` `AppliedModel.mustrainIso` | ε | pure number |
| `core/workflow/apply.ts` `AppliedModel.tofFile.sampleGauss` | ε | pure number |
| `core/workflow/powder.ts` `buildTofPeaks`, `tofWidthInvalidAt` (`applied.mustrainIso`) | ε | pure number |
| `core/export/bundle.ts` `powderExtras` (`a.mustrainIso`) | ε | pure number |
| `core/workflow/apply.ts` `applyParameters` (`mustrainIsoMu`) | row value | ×10⁻⁶ |
| `core/workflow/structureRefinement.ts` row `mustrainIso` (label "mustrain (×10⁻⁶)") and the option `mustrainIso` | row value | ×10⁻⁶ |
| `core/workflow/structureRefinement.ts` rows `tofSampleGauss`, `tofSampleLorentz` | row value | ×10⁻⁶ |
| `app/powderSpec.ts` (`mustrainIso: resolution * 1e6`) | row value | ×10⁻⁶ |
| `core/export/bundle.ts` `tofShapeFromParams` (`mustrain`), `pcrTofShape` (`s.gauss`, `s.lorentz`) | row value | ×10⁻⁶ |
| `core/diagnostics/interpret.ts`, `app/PowderWorkbench.tsx` (the readout) | row value | ×10⁻⁶ |
| `core/export/report.ts` `KIND_UNIT.mustrainIso` | row value | ×10⁻⁶ |

The row has GSAS-II's Mustrain unit but is not GSAS-II's Mustrain number.
This ε is the standard deviation of Δd/d (it gives the Gaussian σ_T), and
GSAS-II's Mustrain is a FWHM: for a Gaussian strain GSAS-II's value is
2√(2 ln 2) ≈ 2.3548 times the row (`core/export/gsas2.ts` `gsas2SampleTerms`:
Mustrain = M_L + 2.3548·m_G).

Making the name say its unit (for example `strainEpsilon` on the applied model
and `mustrainPpm` for the row) is a rename in `apply.ts`, `powder.ts` and
`bundle.ts`. It was not done here: this change is comments only.

Related, found while reading (not changed; they are user-visible text):

- `core/export/report.ts` `KIND_UNIT` gives "×10⁻⁶" for `stephensStrain`,
  `mustrainPar` and `mustrainPerp`. In the code the Stephens S_HKL are in Å⁻⁴
  with no 10⁻⁶ factor, and the uniaxial Y_⊥, Y_∥ are in centidegrees
  (ε = π·Y/72000).
- The same table gives "µm" for `sampleDisplacement`. In the code the row is
  in degrees of 2θ (the shift is s·cosθ).
- The microstrain tooltip in `app/PowderWorkbench.tsx` ("GSAS-II microstrain =
  LY·π/72000·10⁶ ppm") and `docs/MICROSTRUCTURE.md` ("ε·10⁶ is GSAS-II's
  microstrain") attribute π/72000 to GSAS-II. GSAS-II's Mustrain for the same
  Y is 10⁶·π·Y/18000, four times the number shown.

## Deferred

Held until the TOF reflection-margin rule merges, because
`core/workflow/powder.ts` is not edited here:

- the doc comments for `tofWidthsAt`, `buildTofPeaks`, `buildTofFilePeaks`,
  `tofAt`, `tofWidthInvalidAt` and `placePeaks`, with the explanation of the
  10⁻⁶ and 10⁻⁴ factors given in [§9](#9-time-of-flight-peak-profile);
- the note on `mustrainIso` at its uses in `powder.ts`;
- the Gaussian TOF strain. The owner decided on 2026-11-28 that
  `isotropicStrainSigmaTof` and `stephensStrainSigmaTof` will use difC alone,
  as GSAS-II does, in place of |dT/dd|. It is a code change in
  `core/diffraction/anisoStrain.ts`, in a separate pull request; the size of
  the change is given in [§9](#9-time-of-flight-peak-profile).

## References not re-checked

These are in the code or in this page from an earlier note or from memory, and
were not checked against the source in this pass.

- Lovesey (1984), Vol. 2, "eq. 11.110" for the dipole form factor
  (`core/scattering/magnetic.ts`): the equation number.
- Buras & Gerward, Acta Cryst. A31 (1975) 372, for the TOF Lorentz factor:
  the volume and page are from memory.
- Abramowitz & Stegun item numbers 5.1.11, 5.1.22, 5.1.51 and Numerical
  Recipes §6.2, §6.3 (`core/diffraction/profile.ts`): as the code already
  cited them.
- The statement that GSAS-II's `GetSampleSigGam` uses difC for all three TOF
  sample terms: from the owner's note of 2026-11-28, not re-read in GSAS-II's
  source here.

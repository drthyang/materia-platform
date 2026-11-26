# Every domain of a nuclear subgroup child gives the same powder pattern and PDF

THY-80 item C2. A child H of a parent G has [G : H] domain states: one crystal
turned and shifted by the parent operations H does not keep. A powder
pattern and a PDF average over orientations, so every domain must give the
same calculated powder pattern and the same G(r). The magnetic version of
this check is THY-58's (`src/core/magnetic/powderAverage.test.ts`); this
change adds the nuclear one. It adds tests only: no engine code, no
model-visible text and no golden changed.

## What changed, and why

- **`src/core/crystal/irreps/validation/nuclearDomainsSupport.ts`** (test
  code; the app imports none of it) builds every domain of a child through
  the engine's own path:
  - the factor group F = G/T″ of the bound (`factorGroup`) and the child's
    class in the subgroup lattice that the Subgroups view and
    `list_subgroups` list (`supercellSubgroups`);
  - one coset representative g for each coset gH of F/H, so [G : H] domains
    (orientation states × translation states). The domain's subgroup is the
    conjugate gHg⁻¹, from F's multiplication table. The engine realises it in
    the ITA setting it picks for that conjugate (`realiseChild` with
    `nameChild`'s basis, not one derived from g), with its own mode basis
    (`supercellModeBasis`);
  - one random symmetry-allowed distortion of H. Seeded random amplitudes go on
    every displacive mode of H, 0.08 Å root mean square for each atom of the
    child cell. They give a field u on the parent's atoms modulo T″. The
    domain carries g·u: the atom at x moves to g·x, and its displacement turns
    by W_g (`atomAction`, F's own permutation of the atoms). Its amplitudes on
    the conjugate's modes are found by least squares. The residual checks that
    the conjugate's modes span g·u;
  - a random spontaneous strain of 0.5 %, averaged over H's rotations so that
    H keeps it. Domain g gets the parent metric W⁻ᵀ·G_s·W⁻¹, and each child gets
    Pᵀ·G·P. Fractional coordinates do not change. An anisotropic ADP keeps its
    fractional covariance;
  - the identity domain also goes through the mode set the PDF page builds
    (`irrepModeSet`). Its amplitudes are read off by the engine's
    interpolation (`positionShiftValuesFor`) and applied with
    `applyParameters`. The child must match the field-built one up to a
    rigid translation (the polar gauge drops that translation), with the same
    observables.
- What each domain is compared on, against the identity domain:
  - the powder lines (`generateReflections` × multiplicity × |F|², summed by
    d, neutron and X-ray);
  - the Rietveld engine's calculated constant-wavelength neutron profile
    (`buildStructureRefinement` + `powderCurves`, 2θ 10–130°);
  - G(r) (`computeGofR` on `expandStructureAtoms`, neutron and X-ray,
    1–14/16 Å, Qdamp, Qbroad and δ2 on).
- **Tolerance: 10⁻⁹, relative.** A line is compared with its own intensity,
  floored at 10⁻⁹ of the strongest line. A line in one list and not the
  other fails. A curve is compared with its maximum. Rounding gives 10⁻¹⁷ to
  3·10⁻¹¹, the largest on the weakest lines of the largest cells, where |F|²
  is a difference of large terms. A real error gives 10⁻³ or more: the
  negative controls below show it. 10⁻⁹ is two orders of magnitude from both.
- **`nuclearDomains.test.ts`, tier 1, in `npm test`**: seven cases at fixed
  seeds, plus two negative controls on Pnma. The controls check that the test
  sees mistakes. The first puts a domain's field on another orientation's
  realisation (a setting or atom-mapping error): lines 89 (relative), profile
  7·10⁻³, G(r) 4·10⁻². The second leaves a domain's strain unturned: the
  lines no longer coincide, profile 1·10⁻², G(r) 5·10⁻³.
- **`nuclearDomainsTier2.test.ts`, tier 2, opt-in**:
  `MATERIA_SUBGROUP_TIER2=1`, every case at seeds 1–5. The case limit is
  `MATERIA_SUBGROUP_TIER2_CASE_MIN` (default 5); a case past it stops between
  domains and fails as timed out, with what it did. The run cap is
  `MATERIA_SUBGROUP_TIER2_CAP_MIN` (default 30); the cases left at the cap
  are listed as not run. `MATERIA_SUBGROUP_TIER2_SEEDS` sets the number of
  seeds, and `MATERIA_SUBGROUP_TIER2_OUT` sets a path for a JSON summary. The
  limits act between domains: one domain takes at most a few seconds.
- **`nuclearDomainCases.ts`** holds the cases, on public or synthetic
  structures only: cubic SrTiO₃ (testSupport), the bundled GaTa₄Se₈ demo
  (published) and the Mn₃Ga demo. Each case picks its class by what the
  engine says of it: the Glazer tilt the realised child keeps
  (`tiltIsInvariant`), or the irreps of its mode basis.

## Evidence

The cases. "Domains" is [G : H] and the orientation states; "modes" is the
child's displacive modes.

| Parent | Child | Bound | Domains | Modes | Tier |
| --- | --- | --- | --- | --- | --- |
| SrTiO₃ Pm-3m | R-3c a⁻a⁻a⁻ | 2×2×2 | 8 / 4 | 1 | 1, 2 |
| SrTiO₃ Pm-3m | I4/mcm a⁰a⁰c⁻ | 2×2×2 | 6 / 3 | 1 | 2 |
| SrTiO₃ Pm-3m | Imma a⁻a⁻c⁰ | 2×2×2 | 12 / 6 | 3 | 2 |
| SrTiO₃ Pm-3m | P4/mbm a⁰a⁰c⁺ | 2×2×2 | 6 / 3 | 1 | 2 |
| SrTiO₃ Pm-3m | Pnma a⁻b⁺a⁻ | 2×2×2 | 24 / 6 | 7 | 1, 2 |
| SrTiO₃ Pm-3m (anisotropic O) | Pnma a⁻b⁺a⁻ | 2×2×2 | 24 / 6 | 7 | 2 |
| SrTiO₃ Pm-3m | P4mm Γ, polar | same cell | 6 / 3 | 4 | 1, 2 |
| SrTiO₃ Pm-3m | R3m Γ, polar | same cell | 8 / 4 | 4 | 2 |
| SrTiO₃ Pm-3m | Amm2 Γ, polar | same cell | 12 / 6 | 5 | 2 |
| GaTa₄Se₈ F-43m | P-42₁m, X5 + W1 | 1×1×2 | 24 / 6 | 44 | 1, 2 |
| GaTa₄Se₈ F-43m | P-4c2, Δ | 1×1×2 | 12 / 6 | 18 | 1, 2 |
| GaTa₄Se₈ F-43m | P-4c2, Δ, the other class | 1×1×2 | 12 / 6 | 19 | 2 |
| GaTa₄Se₈ F-43m | R3m Γ, polar | same cell | 4 / 4 | 10 | 1, 2 |
| GaTa₄Se₈ F-43m | P-42₁m, X5 | same cell | 12 / 6 | 22 | 2 |
| Mn₃Ga P6₃/mmc | Cmcm | same cell | 3 / 3 | 4 | 1, 2 |
| Mn₃Ga P6₃/mmc | P6₃mc Γ, polar | same cell | 2 / 1 | 3 | 2 |
| Mn₃Ga P6₃/mmc | Pnma | 2×2×1 | 6 / 3 | 8 | 2 |

Tier 1 runs 8 seeds and 105 domains, all within the tolerance, in about
20 s on a laptop. The worst difference is 2.7·10⁻¹¹ on the lines
(GaTa₄Se₈ P-42₁m), 1.3·10⁻¹³ on the profile and 3.1·10⁻¹⁴ on G(r). The
conjugates' modes span every g·u to 5·10⁻¹⁴, and the mode-set child is
the field-built one to 5·10⁻¹⁵ Å.

Tier 2 runs 17 cases × 5 seeds, 885 domains, all within the tolerance, in
4.0 min. The worst difference is 3.0·10⁻¹¹ on the lines (GaTa₄Se₈ P-42₁m
same cell; Mn₃Ga Pnma 2.8·10⁻¹¹), 2.1·10⁻¹³ on the profile and 4.0·10⁻¹⁴
on G(r). A run with a 0.5 min cap and a 3 s case limit stopped as it should:
six cases timed out, six were listed as not run (cap), and the summary was
printed.

**No domain gave a different pattern or PDF: there is no finding.**

One observation outside this check: the Mn₃Ga demo as loaded from its CIF
has Ga at (0.3333, 0.6667, ¾) and Mn at y = 2x − 1.1·10⁻⁴. The mode basis's
10⁻⁶ atom matching refuses both: `supercellModeBasis` throws "the parent's
operations do not map its atoms onto its atoms" for every Mn₃Ga class tried.
The cases here put both atoms exactly on their Wyckoff positions, as the
THY-58 test does for Mn. Whether the Subgroups view should tolerate a
4-decimal CIF is for the owner.

## What changes for users

Nothing. These are tests only.

## What it means for the validation

No pinned result moved. The nuclear domains are now checked as the
magnetic ones are (THY-58). The test covers the engine's conjugate
realisation (setting, origin, site split and order, ADP rotation), its mode
basis for each conjugate, the mode set and the powder and PDF engines on
each domain.

## Not done

- Occupancy and ADP modes, and strain as a mode: the distortion here is
  displacive, with a strain set directly on the cell.
- Domains are built from the lattice's classes. A row's variants in the
  list (the irreps that reach it) are not a separate path to a domain.
- Magnetic domains stay with THY-58.

## Checks

- `npm run build`: passes.
- `npm run lint`: passes.
- `npm test`: see the pull request for the summary line at the branch head.

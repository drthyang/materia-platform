# Single-crystal researcher rounds

Five rounds of the in-app Agent on the single-crystal page, each against real
data, with a critical crystallographer asking. Each round's report says what
the Agent did, what was wrong, and what was fixed or built, with an eval
scenario for each failure of the Agent's ([AGENT_EVALS.md](../AGENT_EVALS.md)).
The method the Agent follows is the `sc-workflow` skill
([.claude/skills/sc-workflow](../../.claude/skills/sc-workflow/SKILL.md)).

| Round | Data | Probe | What it tested | Final fit | Found and fixed or built | Evals |
| --- | --- | --- | --- | --- | --- | --- |
| [1](./round-1-sapphire.md) | sapphire, α-Al₂O₃ (GSAS-II tutorial, SNS TOPAZ) | neutron TOF Laue, 31 runs | λ-dependent extinction, failed measurements, batch scales, anisotropic ADPs | R1 4.10 %, wR2 11.35 %, GooF 2.35 (Becker–Coppens type I) | 13: TOPAZ reader, per-reflection extinction, batch scales, extinction cut, equivalents, OMIT h k l, outliers read against equivalents, Becker–Coppens, resolution range (SHEL), Refinements compared; fixes to the ADP seed, U_eq, statistics, convergence, the correlation guard | 6 |
| [2](./round-2-dipyridyl.md) | dipyridyl disulfide, C₁₀H₈N₂S₂ (GSAS-II tutorial, SHELXL's own .fcf) | X-ray, Mo Kα | reproducing a published SHELXL refinement: riding hydrogens, the weighting scheme, a refinement's listing, 254 parameters | R1 2.76 %, wR2 7.61 %, GooF 1.008 with SHELXL's WGHT (SHELXL: 2.86 %, 7.86 %, 1.041); S–S 2.0222(5) Å as SHELXL's | 17: the radiation and λ, a refinement's listing called so, riding hydrogens (AFIX 43/3) with exact derivatives, SHELXL's WGHT and its suggestion, analytic structure-factor derivatives (23 min → 16.5 s), the structure against the one loaded, bonds by atom, the report's covalent bonds and B_eq; fixes to the riding tool's reading, negative off-diagonal U, the method stages, the audit | 4 |

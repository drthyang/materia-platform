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

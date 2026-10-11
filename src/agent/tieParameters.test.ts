import { describe, it, expect } from "vitest";
import { parse_structure, simulate_pattern } from "@/mcp/tools";
import { buildSpecFor, keptRows, loadedSession } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";

/**
 * Equal-value ties through the Agent: Cr₂WO₆ (trirutile) on a λ = 2.4067 Å
 * neutron diffractometer, both metals at B = 0.5 Å². With the two B's tied the
 * common value refines with one esd, both sites report it, set_free skips the
 * follower, and a spec rebuild keeps the tie.
 */
const CIF = `data_cr2wo6
_cell_length_a 4.5753
_cell_length_b 4.5753
_cell_length_c 8.8537
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 42/m n m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
W1 W6+ 0 0 0 1 0.5
Cr1 Cr3+ 0 0 0.3330 1 0.5
O1 O2- 0.2985 0.2985 0 1 0.6
O2 O2- 0.3075 0.3075 0.3400 1 0.6
`;
const INSTRUMENT: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.4067, u: 3889, v: -6417, w: 3098, x: 0, y: 0 };

function simulated(): { pattern: PowderPattern; structure: ReturnType<typeof parse_structure>["structure"] } {
  const structure = parse_structure({ cif: CIF }).structure;
  const sim = simulate_pattern({ structure, instrument: INSTRUMENT, xMin: 8, xMax: 130, points: 1800 });
  const top = Math.max(...sim.curves.yCalc);
  let seed = 11;
  const u = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pattern: PowderPattern = {
    id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
    points: sim.curves.x.map((x, i) => {
      const y = (8000 * sim.curves.yCalc[i]!) / top + 60;
      return { x, yObs: y + Math.sqrt(y) * Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()), sigma: Math.sqrt(y) };
    }),
  };
  return { pattern, structure };
}

describe("tie_parameters through the Agent", () => {
  it("refines one B for two sites, reports it on both, and keeps the tie through a rebuild", async () => {
    const { pattern, structure } = simulated();
    const { port, session } = sessionPort(loadedSession(structure, pattern, INSTRUMENT), INSTRUMENT);
    const { ex, asked } = executor(fakeHost(port).host, true);
    const parse = (t: string): Record<string, unknown> => JSON.parse(t) as Record<string, unknown>;
    await ex.run("set_free", { free: ["scale", "bkg*", "cell_a", "cell_c", "pos_*", "B_*"] });
    await ex.run("refine", {});

    // Refused before anyone is asked: mixed kinds, a release of an untied row.
    expect((await ex.run("tie_parameters", { equal: ["B_W1", "occ_W1"] })).text).toMatch(/one kind/);
    expect((await ex.run("tie_parameters", { release: ["B_Cr1"] })).text).toMatch(/not held by a tie/);

    const tie = parse((await ex.run("tie_parameters", { equal: ["B_W1", "B_Cr1"] })).text);
    expect(tie.error).toBeUndefined();
    expect(asked.at(-1)!.preview).toBe("Tie B_Cr1 = B_W1 (one B refines)");
    const cr = session().powderParams.find((p) => p.id === "B_Cr1")!;
    expect(cr).toMatchObject({ fixed: true, expression: "= B_W1" });
    // Asked again: nothing to do.
    expect((await ex.run("tie_parameters", { equal: ["B_W1", "B_Cr1"] })).text).toMatch(/already tied/);
    // set_free with a glob skips the follower and says so.
    expect((await ex.run("set_free", { free: ["B_*"] })).text).toMatch(/skipped tied parameter B_Cr1|already in that state/);

    const refined = parse((await ex.run("refine", {})).text);
    expect(refined.refined).toBe(true);
    const b = (id: string): number => session().powderParams.find((p) => p.id === id)!.value;
    expect(b("B_Cr1")).toBeCloseTo(b("B_W1"), 10);
    const table = parse((await ex.run("structure_table", {})).text) as { phases: { sites: { label: string; adp: string }[] }[] };
    const adp = (label: string): string => table.phases[0]!.sites.find((s) => s.label === label)!.adp;
    // Both sites carry the common value and its esd; the truth (0.5) within 3 esd.
    expect(adp("Cr1")).toBe(adp("W1"));
    const m = adp("W1").match(/^B (-?[\d.]+)\((\d+)\)$/);
    expect(m).not.toBeNull();
    const decimals = m![1]!.split(".")[1]?.length ?? 0;
    const esd = Number(m![2]) / 10 ** decimals;
    expect(Math.abs(Number(m![1]) - 0.5)).toBeLessThan(3 * esd);

    // A spec rebuild (a settings change) keeps the tie; a rebuild without the leader releases it.
    const s = session();
    const spec = buildSpecFor(s.structure, s.extraPhases, s.pattern, INSTRUMENT, true, 6, s.siteTies, "isotropic");
    const rebuilt = keptRows(spec.params, s.powderParams);
    expect(rebuilt.find((p) => p.id === "B_Cr1")).toMatchObject({ expression: "= B_W1", fixed: true });
    const orphan = keptRows(spec.params.filter((p) => p.id !== "B_W1"), s.powderParams).find((p) => p.id === "B_Cr1")!;
    expect(orphan.expression).toBeUndefined();
    expect(orphan.fixed).toBe(true);

    // Released: the row is its own again, fixed at the common value.
    await ex.run("tie_parameters", { release: ["B_Cr1"] });
    expect(asked.at(-1)!.preview).toBe("Release the tie on B_Cr1");
    const free = session().powderParams.find((p) => p.id === "B_Cr1")!;
    expect(free.expression).toBeUndefined();
    expect(free.value).toBeCloseTo(b("B_W1"), 10);
  }, 120000);
});

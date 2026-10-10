import { describe, it, expect } from "vitest";
import { parse_structure, simulate_pattern } from "@/mcp/tools";
import { withAntisite } from "@/core/crystal/antisite";
import { loadedSession } from "@/app/powderSession";
import { executor, fakeHost, sessionPort } from "@/testSupport/agentHeadless";
import type { InstrumentParameters } from "@/core/diffraction/instrument";
import type { PowderPattern } from "@/core/diffraction/types";
import type { StructureModel } from "@/core/crystal/types";

/**
 * Antisite disorder through the Agent: Cr₂WO₆ (trirutile, P4₂/mnm) with 10 % of
 * the Cr site holding W (and 20 % of the W site Cr), on a λ = 2.4067 Å neutron
 * diffractometer (b_W 4.86 fm, b_Cr 3.64 fm). The ordered model leaves the W
 * site's B high and the Cr site's low; add_antisite and the four occupancies
 * under Σ occ = 1 and hold composition recover the exchange — within its esd,
 * which at Q ≤ 4.7 Å⁻¹ is large: the exchange trades with the B values.
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
W1 W6+ 0 0 0 1 0.3
Cr1 Cr3+ 0 0 0.3330 1 0.3
O1 O2- 0.2985 0.2985 0 1 0.4
O2 O2- 0.3075 0.3075 0.3400 1 0.4
`;
const INSTRUMENT: InstrumentParameters = { kind: "constantWavelength", radiationKind: "neutron", wavelength: 2.4067, u: 3889, v: -6417, w: 3098, x: 0, y: 0 };

function disordered(ordered: StructureModel, exchange: number): StructureModel {
  const s = withAntisite(ordered, "W1", "Cr1");
  // W: 2 × (1 − 2x) + 4 × x = 2; Cr: 2 × 2x + 4 × (1 − x) = 4.
  const occ: Record<string, number> = { W1: 1 - 2 * exchange, Cr_W1: 2 * exchange, Cr1: 1 - exchange, W_Cr1: exchange };
  return { ...s, sites: s.sites.map((site) => (site.label in occ ? { ...site, occupancy: occ[site.label]! } : site)) };
}

describe("antisite disorder through the Agent", () => {
  it("refines the exchange of a disordered Cr₂WO₆ under Σ occ = 1 and hold composition", async () => {
    const ordered = parse_structure({ cif: CIF }).structure;
    const sim = simulate_pattern({ structure: disordered(ordered, 0.1), instrument: INSTRUMENT, xMin: 8, xMax: 130, points: 1800 });
    const top = Math.max(...sim.curves.yCalc);
    let seed = 7;
    const u = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pattern: PowderPattern = {
      id: "p", name: "sim", xUnit: "twoTheta", radiation: { kind: "neutron", wavelength: 2.4067 }, wavelength: 2.4067,
      points: sim.curves.x.map((x, i) => {
        const y = (8000 * sim.curves.yCalc[i]!) / top + 60;
        return { x, yObs: y + Math.sqrt(y) * Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()), sigma: Math.sqrt(y) };
      }),
    };
    const { port, session } = sessionPort(loadedSession(ordered, pattern, INSTRUMENT), INSTRUMENT);
    const { ex, asked } = executor(fakeHost(port).host, "auto");
    const parse = (t: string): Record<string, unknown> => JSON.parse(t) as Record<string, unknown>;
    await ex.run("set_free", { free: ["scale", "bkg*", "cell_a", "cell_c", "pos_*", "B_*"] });
    await ex.run("refine", {});
    const b = (id: string): number => session().powderParams.find((p) => p.id === id)!.value;
    // The ordered model's signature: the W site's B pushed up, the Cr site's down.
    const gapOrdered = b("B_W1") - b("B_Cr1");
    expect(gapOrdered).toBeGreaterThan(0.2);

    expect((await ex.run("add_antisite", { siteA: "Cr1", siteB: "Cr1" })).text).toMatch(/both Cr/);
    await ex.run("add_antisite", { siteA: "W1", siteB: "Cr1" });
    expect(asked.at(-1)!.preview).toBe("Antisite W1 ⇄ Cr1: Cr on W1, W on Cr1, at occupancy 0 · Σ occ = 1 and hold composition on");
    expect(session().siteTies).toMatchObject({ occupancyToUnity: true, composition: true });
    expect(session().structure.sites.map((s) => s.label)).toEqual(["W1", "Cr1", "O1", "O2", "Cr_W1", "W_Cr1"]);
    // Asked again: already modelled.
    expect((await ex.run("add_antisite", { siteA: "W1", siteB: "Cr1" })).text).toMatch(/already in the structure/);

    await ex.run("set_free", { free: ["scale", "bkg*", "cell_a", "cell_c", "pos_*", "B_*", "occ_W1", "occ_Cr_W1", "occ_Cr1", "occ_W_Cr1"] });
    const r = parse((await ex.run("refine", {})).text);
    expect(r.refined).toBe(true);
    expect(Number(r.wR)).toBeLessThan(Number(r.wRBefore));
    // The exchange (W on the Cr site) within 2.5 esd of its 10 %, and clearly
    // above zero.
    const sites = (parse((await ex.run("structure_table", {})).text).phases as { sites: { label: string; occupancy: string }[] }[])[0]!.sites;
    const [, value, digits] = /^([\d.]+)\((\d+)\)$/.exec(sites.find((x) => x.label === "W_Cr1")!.occupancy)!;
    const decimals = value!.split(".")[1]?.length ?? 0;
    const esd = Number(digits) / 10 ** decimals;
    expect(Math.abs(Number(value) - 0.1)).toBeLessThan(2.5 * esd);
    expect(Number(value)).toBeGreaterThan(2 * esd);
    // The B values move toward each other; how far depends on cycles along a
    // flat valley — the exchange and the B values trade at this Q range.
    expect(b("B_W1") - b("B_Cr1")).toBeLessThan(gapOrdered);
  }, 120_000);
});

import { describe, it, expect } from "vitest";
import type { MagneticModel } from "@/core/magnetic/types";
import type { Vec3 } from "@/core/math/types";
import { magneticStructureToMcif } from "@/core/export/cif";
import { parseMagneticCif, readCifBlock } from "@/parsers/cif";
import { exampleStructure } from "@/examples/mn3ga";

/**
 * An incommensurate structure is written in its parent cell. Its k goes in the
 * standard `_parent_propagation_vector` loop (the one the supercell files use),
 * with decimal components that read back as the same double, next to the parent
 * space group. It is still not a (3+1)D superspace description.
 */

function model(k: Vec3): MagneticModel {
  return {
    id: "m", structureId: "mn3ga", propagation: [k],
    moments: [{ siteLabel: "Mn1", frame: "crystallographic", components: [1.5, 0, 0], sinComponents: [0, 1.5, 0] }],
  };
}

/**
 * The k the file's `_parent_propagation_vector` loop holds, as numbers. The
 * value is written BCS-style, `k1 [kx ky kz]`, unquoted (as the supercell files
 * write it). MATERIA's CIF tokenizer (CIF 1.1, no bracket lists) splits it at
 * the spaces, so the loop's tokens are joined back here.
 */
function kFromFile(text: string): number[] {
  const l = readCifBlock(text).loops.find((x) => x.headers.includes("_parent_propagation_vector.kxkykz"))!;
  expect(l.headers).toEqual(["_parent_propagation_vector.id", "_parent_propagation_vector.kxkykz"]);
  const m = /^k1 \[(\S+) (\S+) (\S+)\]$/.exec(l.rows.flat().join(" "))!;
  expect(m).not.toBeNull();
  return [m[1]!, m[2]!, m[3]!].map((x) => {
    expect(x).toMatch(/^-?\d+(\.\d+)?$/); // fixed decimal notation, no exponent, no fraction
    return Number(x);
  });
}

describe("incommensurate mCIF: k in the _parent_propagation_vector loop", () => {
  const s = exampleStructure();
  // The bundled CIF names the group by symbol only; give it its number so the IT_number line shows.
  const numbered = { ...s, spaceGroup: { ...s.spaceGroup, number: 194 } };

  it("writes the loop and the parent group; k reads back as the same double", () => {
    for (const k of [[0, 0, 1 / Math.PI], [0.137, -0.2718281828459045, Math.SQRT2 - 1], [Math.SQRT1_2 - 0.5, 1.234e-7, 0]] as Vec3[]) {
      const text = magneticStructureToMcif(numbered, model(k));
      expect(kFromFile(text)).toEqual(k.map((x) => (x === 0 ? 0 : x)));
      expect(text).toContain('_parent_space_group.name_H-M_alt  "P 63/m m c"');
      expect(text.match(/_parent_space_group\.name_H-M_alt/g)).toHaveLength(1);
      expect(text).toContain("_parent_space_group.IT_number     194");
      // No child transform (the cell is the parent cell) and no superspace tags.
      expect(text).not.toContain("child_transform");
      expect(text).not.toMatch(/superspace_|_cell_wave_vector|_atom_site_moment_Fourier/);
      // The existing comments stay.
      expect(text).toContain("a (3+1)D magnetic-superspace description is not emitted.");
      expect(text).toContain("# Fourier sine (quadrature) amplitudes");
    }
  });

  it("MATERIA's mCIF reader still reads the file; it does not read k from the loop (k comes back as 0)", () => {
    const k: Vec3 = [0, 0, 1 / Math.PI];
    const back = parseMagneticCif(magneticStructureToMcif(s, model(k)), "back");
    expect(back.structure.sites.map((x) => x.label)).toEqual(s.sites.map((x) => x.label));
    expect(back.magnetic!.moments.map((m) => m.siteLabel)).toEqual(["Mn1"]);
    // Known limit, listed for the owner: parseMagneticCif ignores _parent_propagation_vector
    // (and the sine amplitudes in the comments). Update this when the reader learns the loop.
    expect(back.magnetic!.propagation).toEqual([[0, 0, 0]]);
  });

  it("a k = 0 file carries no propagation-vector loop", () => {
    const text = magneticStructureToMcif(s, { ...model([0, 0, 0]), moments: [{ siteLabel: "Mn1", frame: "crystallographic", components: [1.5, 0, 0] }] });
    expect(text).not.toContain("_parent_propagation_vector");
  });
});

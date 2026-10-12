import { describe, expect, it } from "vitest";
import { withEsd } from "@/agent/structureTable";
import { formatWithEsd } from "@/core/export/cif";

describe("withEsd", () => {
  it("reads the su's leading digits before rounding it: 0.015 is two figures, 15", () => {
    // Rounding first made 0.015 → 0.02, one figure, and "0.43(2)".
    expect(withEsd(0.435, 0.015)).toBe("0.435(15)");
    expect(withEsd(0.18752, 0.00009)).toBe("0.18752(9)");
    expect(withEsd(8.46808, 0.0001)).toBe("8.46808(10)");
    expect(withEsd(0.2400, 0.0010)).toBe("0.2400(10)");
    expect(withEsd(1.234, 0.25)).toBe("1.2(3)");
  });

  it("agrees with the CIF writer, and caps the decimals", () => {
    for (const [v, u] of [[0.435, 0.015], [0.4293, 0.0009], [12.3456, 0.0196], [0.07, 0.0095], [3.1, 1.4]] as const) {
      expect(withEsd(v, u)).toBe(formatWithEsd(v, u, 6));
    }
    expect(withEsd(0.1234567891, 0.00000012, 6)).toBe("0.123457(1)");
    expect(withEsd(0.5, undefined)).toBe("0.50000");
  });
});

/**
 * k-vector names (THY-73): the CDML / Bradley–Cracknell labels of points and
 * lines of symmetry, in the conventional reciprocal basis of the ITA standard
 * setting, as Bilbao's KVEC lists them. The expected names are the published
 * convention; the Bilbao values typed below come from its KVEC help pages
 * (static, read 2026-11-08):
 *  - https://www.cryst.ehu.eus/cryst/help/examples_kvec.html — P321 (No. 150):
 *    the line DT (Δ) is 0, 0, z between Γ (z = 0) and A (z = 1/2); KA is
 *    (2/3, −1/3, 0); R3 (No. 146): a point of the LD line with primitive
 *    coefficients (1/4, 1/4, 1/4) is (0, 0, 3/4) in the basis dual to the
 *    conventional hexagonal cell;
 *  - https://www.cryst.ehu.eus/cryst/help/brillouin_zone_databases.html — the
 *    labels and coefficients are CDML's (Tables 3.9, 3.11), with conventional
 *    coefficients for centred lattices.
 * The THY-73 issue's own examples: F-43m (GaTa₄Se₈) "Δ (0,0,½)" and "Σ (0,½,½)";
 * fcc K (¾,¾,0) and U (¼,1,¼); P6₃/mmc (Mn₃Ga) A.
 */
import { describe, it, expect } from "vitest";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { canonicalStarArm, kVectorContext, kVectorName } from "@/core/crystal/irreps/kVectorNames";
import { vfrom, exactOp, iIsIdentity, vmod1, rat, vsub, type IMat, type RVec } from "@/core/crystal/irreps/rational";
import type { Vec3 } from "@/core/math/types";

function nameOf(setting: number | string, k: Vec3): string | null {
  const ctx = kVectorContext(buildSpaceGroup(setting).operations);
  const n = kVectorName(ctx, vfrom(k, 48));
  return n ? `${n.label}${n.kind === "line" ? " (line)" : ""}` : null;
}

describe("k-vector names, by Bravais lattice", () => {
  it("cP (Pm-3m, P-43m, P23): Γ X M R, lines Δ Σ Λ Z S T", () => {
    expect(nameOf(221, [0, 0, 0])).toBe("Γ");
    expect(nameOf(221, [0, 0.5, 0])).toBe("X");
    expect(nameOf(221, [0, 0, 0.5])).toBe("X");
    expect(nameOf(221, [0.5, 0.5, 0])).toBe("M");
    expect(nameOf(221, [0.5, 0, 0.5])).toBe("M");
    expect(nameOf(221, [0.5, 0.5, 0.5])).toBe("R");
    expect(nameOf(221, [0, 0, 0.25])).toBe("Δ (line)");
    expect(nameOf(221, [0, 0.75, 0])).toBe("Δ (line)");
    expect(nameOf(221, [0.25, 0.25, 0])).toBe("Σ (line)");
    expect(nameOf(221, [0.25, 0.25, 0.25])).toBe("Λ (line)");
    expect(nameOf(221, [0.25, 0.5, 0])).toBe("Z (line)");
    expect(nameOf(221, [0.25, 0.5, 0.25])).toBe("S (line)");
    expect(nameOf(221, [0.5, 0.5, 0.25])).toBe("T (line)");
    expect(nameOf(221, [0.25, 0.125, 0])).toBeNull(); // a plane
    expect(nameOf(215, [0.5, 0.5, 0])).toBe("M");
    expect(nameOf(195, [0, 0, 0.25])).toBe("Δ (line)");
    // Pm-3 (m-3): (u, u, 0) lies in the mirror plane z = 0, and keeps the holohedry's label.
    expect(nameOf(200, [0.25, 0.25, 0])).toBe("Σ (line)");
  });

  it("cF (Fm-3m, F-43m): Γ X L W K U, lines Δ Λ Σ Q; the issue's Δ (0,0,½) and Σ (0,½,½) on F-43m", () => {
    for (const sg of [225, 216]) {
      expect(nameOf(sg, [0, 0, 1])).toBe("X");
      expect(nameOf(sg, [1, 1, 0])).toBe("X"); // ≡ (0, 0, 1) modulo the F reciprocal lattice
      expect(nameOf(sg, [0.5, 0.5, 0.5])).toBe("L");
      expect(nameOf(sg, [0.5, 1, 0])).toBe("W");
      expect(nameOf(sg, [0.75, 0.75, 0])).toBe("K");
      expect(nameOf(sg, [0.25, 1, 0.25])).toBe("K"); // U is K's star: the star takes the first name
      expect(nameOf(sg, [0, 0, 0.5])).toBe("Δ (line)");
      expect(nameOf(sg, [0.25, 0.25, 0.25])).toBe("Λ (line)");
    }
    // The issue's Σ (0, ½, ½) on F-43m: CDML's labels hold in every class of the lattice (in Td the line lies in the mirror plane (u, u, w)).
    expect(nameOf(225, [0, 0.5, 0.5])).toBe("Σ (line)");
    expect(nameOf(216, [0, 0.5, 0.5])).toBe("Σ (line)");
    // The X–W line is not named (Bradley & Cracknell's Z is not CDML's label; the oracle, 2026-11-08).
    expect(nameOf(225, [0.25, 1, 0])).toBeNull();
    // F-43m has no inversion: −Λ is another star, left unnamed (not guessed).
    expect(nameOf(216, [-0.25, -0.25, -0.25])).toBeNull();
    expect(nameOf(225, [-0.25, -0.25, -0.25])).toBe("Λ (line)");
    // Fd-3m in either origin choice.
    expect(nameOf("F d -3 m:1", [0, 0, 1])).toBe("X");
    expect(nameOf("F d -3 m:2", [0.5, 1, 0])).toBe("W");
  });

  it("cI (Im-3m): Γ H N P, lines Δ Σ Λ D G", () => {
    expect(nameOf(229, [0, 0, 1])).toBe("H");
    expect(nameOf(229, [0.5, 0.5, 0])).toBe("N");
    expect(nameOf(229, [0.5, 0.5, 0.5])).toBe("P");
    expect(nameOf(229, [0, 0, 0.5])).toBe("Δ (line)");
    expect(nameOf(229, [0.25, 0.25, 0])).toBe("Σ (line)");
    expect(nameOf(229, [0.25, 0.25, 0.25])).toBe("Λ (line)");
    expect(nameOf(229, [0.5, 0.5, 0.25])).toBe("D (line)");
    expect(nameOf(229, [0.25, 0.75, 0])).toBe("G (line)");
    // I-43m has no inversion and no 2-fold along [1-10]: −P is another star, left unnamed.
    expect(nameOf(217, [0.5, 0.5, 0.5])).toBe("P");
    expect(nameOf(217, [-0.5, -0.5, -0.5])).toBeNull();
  });

  it("tP (P4/mmm, P4₂/mnm): Γ Z X M R A, lines Δ Σ Λ V W", () => {
    for (const sg of [123, "P 42/m n m"]) {
      expect(nameOf(sg, [0, 0, 0.5])).toBe("Z");
      expect(nameOf(sg, [0.5, 0, 0])).toBe("X");
      expect(nameOf(sg, [0.5, 0.5, 0])).toBe("M");
      expect(nameOf(sg, [0.5, 0, 0.5])).toBe("R");
      expect(nameOf(sg, [0.5, 0.5, 0.5])).toBe("A");
      expect(nameOf(sg, [0, 0, 0.25])).toBe("Λ (line)");
      expect(nameOf(sg, [0.25, 0, 0])).toBe("Δ (line)");
      expect(nameOf(sg, [0.5, 0.5, 0.25])).toBe("V (line)");
    }
  });

  it("oP (Pnma, and Pbnm brought to Pnma's axes): Γ X Y Z S U T R; lines Σ Δ Λ D C A B G H Q", () => {
    expect(nameOf(62, [0.5, 0, 0])).toBe("X");
    expect(nameOf(62, [0, 0.5, 0])).toBe("Y");
    expect(nameOf(62, [0, 0, 0.5])).toBe("Z");
    expect(nameOf(62, [0.5, 0.5, 0])).toBe("S");
    expect(nameOf(62, [0.5, 0, 0.5])).toBe("U");
    expect(nameOf(62, [0, 0.5, 0.5])).toBe("T");
    expect(nameOf(62, [0.5, 0.5, 0.5])).toBe("R");
    expect(nameOf(47, [0.25, 0, 0])).toBe("Σ (line)");
    expect(nameOf(47, [0.5, 0.25, 0])).toBe("D (line)");
    expect(nameOf(47, [0.5, 0.5, 0.25])).toBe("Q (line)");
    expect(nameOf(47, [0.5, 0.25, 0.5])).toBeNull(); // U–R: not named (Bradley & Cracknell's label is not CDML's; the oracle)
    // Pbnm's c is Pnma's b: its (0, 0, ½) is Pnma's Y.
    expect(nameOf("P b n m", [0, 0, 0.5])).toBe("Y");
  });

  it("hP (P6₃/mmc, P6/mmm, P321): Γ A K H M L, KA only where K and −K differ; Δ is (0, 0, z) between Γ and A (Bilbao, P321)", () => {
    for (const sg of [194, 191, 150]) {
      expect(nameOf(sg, [0, 0, 0.5])).toBe("A");
      expect(nameOf(sg, [1 / 3, 1 / 3, 0])).toBe("K");
      expect(nameOf(sg, [1 / 3, 1 / 3, 0.5])).toBe("H");
      expect(nameOf(sg, [0.5, 0, 0])).toBe("M");
      expect(nameOf(sg, [0.5, 0, 0.5])).toBe("L");
      expect(nameOf(sg, [0, 0, 0.25])).toBe("Δ (line)");
    }
    expect(nameOf(194, [2 / 3, -1 / 3, 0])).toBe("K"); // −K is K's star in 6/mmm
    expect(nameOf(150, [2 / 3, -1 / 3, 0])).toBe("KA"); // and not in 321 (Bilbao's KA (2/3, −1/3, 0))
    expect(nameOf(150, [2 / 3, -1 / 3, 0.5])).toBe("HA");
  });

  it("hR (R-3m, hexagonal axes, and on rhombohedral axes): T, L, F; no lines", () => {
    expect(nameOf("R -3 m:H", [0, 0, 1.5])).toBe("T");
    expect(nameOf("R -3 m:H", [0.5, 0, 0.5])).toBe("L");
    expect(nameOf("R -3 m:H", [-0.5, 0.5, 0.5])).toBe("L");
    expect(nameOf("R -3 m:H", [0, 0.5, 1])).toBe("F");
    expect(nameOf("R -3 m:H", [0, 0, 0.75])).toBeNull(); // the 3-fold line's labels depend on the axial ratio (Bilbao, R3)
    expect(nameOf("R -3 m:R", [0.5, 0.5, 0.5])).toBe("T");
  });

  it("lattices not named (aP, mP, mC, oC, oF, oI, tI): Γ only, coordinates elsewhere", () => {
    expect(nameOf(2, [0.5, 0, 0])).toBeNull();
    expect(nameOf(14, [0, 0.5, 0])).toBeNull();
    expect(nameOf(15, [0, 1, 0])).toBeNull();
    expect(nameOf(63, [0, 1, 0])).toBeNull();
    expect(nameOf(69, [0, 0, 1])).toBeNull();
    expect(nameOf(71, [0, 0, 1])).toBeNull();
    expect(nameOf(139, [0, 0, 1])).toBeNull();
    expect(nameOf(139, [0, 0, 0])).toBe("Γ");
  });
});

describe("the canonical arm", () => {
  const ctxOf = (sg: number): { rotations: IMat[]; centrings: RVec[] } => {
    const exact = buildSpaceGroup(sg).operations.map(exactOp);
    const centrings: RVec[] = [[rat(0), rat(0), rat(0)]];
    for (const e of exact) if (iIsIdentity(e.W)) {
      const c = vmod1(e.w);
      if (!centrings.some((q) => vsub(q, c).every((x) => x.n === 0))) centrings.push(c);
    }
    return { rotations: exact.map((e) => e.W), centrings };
  };
  it("is the same whichever arm is given: (0, 0, ½) for F-43m's Δ, (0, ½, ½) for its Σ", () => {
    const { rotations, centrings } = ctxOf(216);
    const fmt = (q: RVec): string => q.map((x) => `${x.n}/${x.d}`).join(",");
    for (const k of [[0, 0.5, 0], [0.5, 0, 0], [0, 0, -0.5], [0, 0, 1.5]] as Vec3[]) expect(fmt(canonicalStarArm(rotations, centrings, vfrom(k)))).toBe("0/1,0/1,1/2");
    for (const k of [[0.5, 0.5, 0], [0.5, 0, 0.5], [0, -0.5, 0.5]] as Vec3[]) expect(fmt(canonicalStarArm(rotations, centrings, vfrom(k)))).toBe("0/1,1/2,1/2");
  });
});

/**
 * The local X-ray PDF dataset (`LOCAL_DATA.xrayPdf`, 28-ID; unpublished;
 * data-gated, skips without the local data/ folder): the subgroup engine reaches the local P2₁3 from the cubic F-43m
 * parent by itself — the X-point irrep's isotropy subgroup (irrep route) and
 * a general subgroup of the same-cell lattice (lattice route) — and the
 * child's modes refine on the data. The references are realPdfData.test.ts's
 * fits over r = 2–10 Å with the PDFgui envelope: the cubic average, the
 * user's refined P2₁3 positions (positions held), and the distortion of that
 * state decomposed against the cubic parent. With every mode free from the
 * activation kick the fit goes below both.
 */
import { describe, it, expect } from "vitest";
import { dataExists, readData } from "@/testSupport/data";
import { LOCAL_DATA } from "@/testSupport/localData";
import * as tools from "@/mcp/tools";
import { buildPdfSpec } from "@/core/workflow/pdf";
import type { PdfPattern } from "@/core/diffraction/types";
import { buildDistortionModes, withDistortionModes } from "@/core/crystal/distortionModes";
import { activateIsotropySubgroup, decentringTerms } from "@/core/crystal/decentringModes";
import { irrepIsotropySubgroups } from "@/core/crystal/isotropySubgroups";
import { factorGroup } from "@/core/crystal/irreps/factorGroup";
import { sameCellSubgroups } from "@/core/crystal/irreps/sameCellLattice";
import { identifySubgroup } from "@/core/crystal/isotropyTree";

const XPDF_GR = `${LOCAL_DATA.xrayPdf.dir}/${LOCAL_DATA.xrayPdf.pattern}`;
const XPDF_CIF = `${LOCAL_DATA.xrd.dir}/${LOCAL_DATA.xrd.structure}`;
const P213_CIF = `${LOCAL_DATA.xrayPdf.dir}/${LOCAL_DATA.xrayPdf.localModel}`;

const trunc = (p: PdfPattern, rMax: number): PdfPattern => ({ ...p, points: p.points.filter((q) => q.r <= rMax) });

describe.skipIf(!dataExists(XPDF_GR) || !dataExists(XPDF_CIF) || !dataExists(P213_CIF))("local X-ray PDF — P2₁3 from the subgroup engine (X point), refined", () => {
  it("both routes reach P2₁3 in the cubic cell, and its 13 modes refine below the cubic average", async () => {
    const cubic = tools.parse_structure({ cif: readData(XPDF_CIF) }).structure;
    const p213 = tools.parse_structure({ cif: readData(P213_CIF) }).structure;
    expect(identifySubgroup(p213.spaceGroup.operations, p213.spaceGroup.operations, { standard: true }).number).toBe(198);

    // Irrep route: the six-dimensional X irrep, its isotropy subgroup P2₁3 (index 8 = 2·4).
    const x = decentringTerms(cubic).find((t) => t.term.irrep.dim === 6)!;
    expect(x.star.name).toBe("X");
    const sub = irrepIsotropySubgroups(cubic, x.term).find((s) => s.identity.number === 198)!;
    expect(sub.index).toEqual({ t: 2, k: 4 });
    // Lattice route: the same subgroup among the same-cell lattice's general subgroups.
    const key = (ops: readonly { xyz: string }[]): string => ops.map((o) => o.xyz).sort().join(";");
    const lattice = sameCellSubgroups(factorGroup(cubic.spaceGroup.operations));
    expect(lattice.some((n) => n.kind === "general" && key(n.operations) === key(sub.operations))).toBe(true);

    const act = activateIsotropySubgroup(cubic, x.term, sub.operations, "X → P2₁3", "X")!;
    expect(act.identity.number).toBe(198);
    expect(act.child.sites).toHaveLength(p213.sites.length);
    expect(act.modeSet.modes).toHaveLength(13);

    // Refine the child's 13 modes from the activation kick, with the PDFgui protocol's envelope.
    const pattern = trunc(tools.parse_pdf_data({ text: readData(XPDF_GR), filename: "g.gr" }).pattern, 12);
    const spec = buildPdfSpec(act.modeSet.parentized, pattern);
    const swapped = withDistortionModes({ params: spec.params, bindings: spec.bindings }, act.modeSet);
    const lead = act.modeSet.modes[0]!.id;
    const params = swapped.params.map((p) => {
      if (p.id === "qdamp") return { ...p, value: 0.0383 };
      if (p.id === "qbroad") return { ...p, value: 0.0472 };
      if (p.kind === "bIso" || p.id === "delta2") return { ...p, fixed: false };
      if (p.kind === "cellAngle") return { ...p, fixed: true };
      if (p.kind === "positionShift") return { ...p, value: p.id === lead ? 0.05 : 0, fixed: false };
      return p;
    });
    const refined = await tools.refine_pdf({
      structure: act.modeSet.parentized, pattern, parameters: params, bindings: swapped.bindings,
      restraints: spec.restraints, staged: true, fitRange: { min: 2.0, max: 10.0 }, maxIterations: 60,
    });
    const rw = refined.result.agreement.rWeighted ?? 1;
    const amplitudes = act.modeSet.modes.map((m) => refined.result.parameters[m.id] ?? 0);
    const total = Math.hypot(...amplitudes);
    console.log(`[subgroup engine P2₁3] ${refined.result.status} · Rw(2–10 Å)=${(rw * 100).toFixed(2)}% · |A|=${total.toFixed(4)} Å · lead ${amplitudes[0]!.toFixed(4)} Å`);
    expect(["converged", "stalled"]).toContain(refined.result.status);
    // Below the cubic average, near the 13-coordinate P2₁3 fit.
    expect(rw).toBeLessThan(0.0919);
    expect(rw).toBeLessThan(0.0798 + 0.01);
    // The distortion is the size of the user's refined P2₁3 state, decomposed against the cubic parent.
    const observed = buildDistortionModes(cubic, p213).totalAmplitude;
    expect(total).toBeGreaterThan(observed / 2);
    expect(total).toBeLessThan(observed * 2);
  }, 900000);
});

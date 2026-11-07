/**
 * Writes the synthetic SrTiO₃ PDF page the demo QA loads by hand: cubic
 * SrTiO₃ (Pm-3m, a = 3.905 Å, src/testSupport/perovskiteTilts.ts) as a CIF and
 * its neutron G(r) from MATERIA's own forward model (1.5–10 Å, Δr 0.05 Å,
 * Qdamp 0.03) as a two-column .gr. Synthetic: no measured or unpublished data.
 *
 * Usage:  npx vite-node scripts/write-srtio3-pdf.ts <outDir>
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { srtio3 } from "@/testSupport/perovskiteTilts";
import { structureToCif } from "@/core/export/cif";
import { computeGofR, makeRGrid } from "@/core/pdf/forwardModel";
import { expandStructureAtoms } from "@/core/diffraction/structureFactor";

const out = process.argv[2];
if (!out) throw new Error("usage: write-srtio3-pdf.ts <outDir>");
mkdirSync(out, { recursive: true });
const s = srtio3();
const r = makeRGrid(1.5, 10, 0.05);
const g = computeGofR(s.cell, expandStructureAtoms(s), r, { scatteringType: "neutron", scale: 1, qdamp: 0.03, qbroad: 0, delta1: 0, delta2: 0 });
const lines = ["# Synthetic SrTiO3 neutron G(r) (MATERIA forward model, Qdamp 0.03)", "# r(A) G(r)"];
r.forEach((ri, i) => lines.push(`${ri.toFixed(4)} ${g[i]!.toFixed(6)}`));
writeFileSync(join(out, "SrTiO3_synthetic.cif"), structureToCif(s));
writeFileSync(join(out, "SrTiO3_synthetic.gr"), lines.join("\n") + "\n");
console.log(join(out, "SrTiO3_synthetic.cif"), join(out, "SrTiO3_synthetic.gr"));

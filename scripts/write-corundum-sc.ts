/**
 * Writes the eval suite's single-crystal page (synthetic corundum with strong
 * extinction, src/testSupport/scPages.ts) as files the app can open: the
 * starting model as a CIF and the reflections as a FullProf .int list. The
 * dock's screenshots load them to play the single-crystal replay.
 *
 * Usage:  npx vite-node scripts/write-corundum-sc.ts <outDir>
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { corundumPage } from "@/testSupport/scPages";
import { structureToCif } from "@/core/export/cif";
import { write_single_crystal_data } from "@/mcp/tools";

const out = process.argv[2];
if (!out) throw new Error("usage: write-corundum-sc.ts <outDir>");
mkdirSync(out, { recursive: true });
const page = corundumPage({ extinction: 20 });
writeFileSync(join(out, "corundum.cif"), structureToCif(page.structure));
writeFileSync(join(out, "corundum.int"), write_single_crystal_data({ dataset: page.dataset, title: "Synthetic corundum (eval page)" }).text);
console.log(join(out, "corundum.cif"), join(out, "corundum.int"));

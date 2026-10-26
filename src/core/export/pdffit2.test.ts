import { describe, it, expect } from "vitest";
import type { StructureModel } from "@/core/crystal/types";
import type { PdfPattern } from "@/core/diffraction/types";
import type { ParameterKind, RefinementParameter } from "@/core/refinement/types";
import { buildSpaceGroup } from "@/core/crystal/spaceGroups";
import { exampleStructure } from "@/examples/mn3ga";
import { gata4se8PdfExample } from "@/examples/gata4se8Pdf";
import { buildMultiPhasePdfSpec, buildPdfSpec, pdfPhaseBindingsFor } from "@/core/workflow/pdf";
import { applyParameters } from "@/core/workflow/apply";
import { resolveTies } from "@/core/refinement/constraints";
import { distinctSiteOps } from "@/core/diffraction/structureFactor";
import { applyOperation } from "@/core/crystal/symmetry";
import { EIGHT_PI_SQUARED, rotateUAniso } from "@/core/crystal/adp";
import { isotropicUij, pdffitModel, pdffitNumber, pdffitStru, spcgrSymbol, type PdffitExportInput, type PdffitModel } from "@/core/export/pdffit2";
import { pdfDataGr, pdfguiBundle } from "@/core/export/pdfBundle";

/**
 * The PDFfit2 export: the parameter mapping and its units, the constraints of
 * every atom of the cell (checked here as PDFfit2 evaluates them, at perturbed
 * parameter values, against MATERIA's own model there — the same gate the
 * exporter passed against PDFfit2 1.6 itself), the .stru writer, the data file
 * and the bundle.
 */

// ---------------------------------------------------------------------------
// A formula as PDFfit2 evaluates one: numbers, @n, + − * /, brackets, cos/sin
// (the subset PDFfit2's parser and PDFgui's Python check share).

function evaluateFormula(formula: string, par: (n: number) => number): number {
  let i = 0;
  const s = formula.replace(/\s+/g, "");
  const peek = (): string => s[i] ?? "";
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = s[i++] === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (peek() === "*" || peek() === "/") v = s[i++] === "*" ? v * unary() : v / unary();
    return v;
  };
  const unary = (): number => (peek() === "-" ? (i++, -unary()) : peek() === "+" ? (i++, unary()) : atom());
  const atom = (): number => {
    if (peek() === "(") {
      i++;
      const v = expr();
      if (s[i++] !== ")") throw new Error(`unbalanced: ${formula}`);
      return v;
    }
    if (peek() === "@") {
      const m = /^@(\d+)/.exec(s.slice(i))!;
      i += m[0].length;
      return par(Number(m[1]));
    }
    const fn = /^(cos|sin)\(/.exec(s.slice(i));
    if (fn) {
      i += fn[1]!.length;
      const arg = atom();
      return fn[1] === "cos" ? Math.cos(arg) : Math.sin(arg);
    }
    const num = /^\d+(\.\d*)?([eE][-+]?\d+)?|^\.\d+([eE][-+]?\d+)?/.exec(s.slice(i));
    if (!num) throw new Error(`unexpected "${s.slice(i)}" in ${formula}`);
    i += num[0].length;
    return Number(num[0]);
  };
  const v = expr();
  if (i !== s.length) throw new Error(`trailing "${s.slice(i)}" in ${formula}`);
  return v;
}

// ---------------------------------------------------------------------------
// Cases

const pattern = (id: string, scatteringType: "xray" | "neutron", qmax = 25, step = 0.01): PdfPattern => ({
  id, name: id, scatteringType, qmax, qdamp: 0.03, qbroad: 0.01,
  points: Array.from({ length: 1500 }, (_, i) => ({ r: step * i, gObs: Math.sin(i / 7) })),
});

function freeAll(params: readonly RefinementParameter[], kinds: readonly ParameterKind[]): RefinementParameter[] {
  const set = new Set(kinds);
  return params.map((p) => (set.has(p.kind) && !p.expression ? { ...p, fixed: false } : { ...p }));
}

/** A monoclinic P2₁/c cell with a shared Fe/Co site (one position, one B, the Co occupancy tied to 1 − Fe's) and an anisotropic O. */
const mono = (): StructureModel => ({
  id: "mono", name: "Mono", cell: { a: 5.1, b: 6.2, c: 7.3, alpha: 90, beta: 103.5, gamma: 90 }, spaceGroup: buildSpaceGroup(14),
  sites: [
    { label: "Fe1", element: "Fe", position: [0.123, 0.234, 0.345], occupancy: 0.7, adp: { kind: "isotropic", bIso: 0.6 } },
    { label: "Co1", element: "Co", position: [0.123, 0.234, 0.345], occupancy: 0.3, adp: { kind: "isotropic", bIso: 0.6 } },
    { label: "O1", element: "O", position: [0.31, 0.12, 0.08], occupancy: 1, adp: { kind: "anisotropic", uAniso: [0.01, 0.012, 0.009, 0, 0.002, 0] } },
  ],
});
const triclinic = (): StructureModel => ({
  id: "tri", name: "Tri", cell: { a: 5.2, b: 5.9, c: 6.4, alpha: 84, beta: 97, gamma: 101 }, spaceGroup: buildSpaceGroup(2),
  sites: [
    { label: "Ni1", element: "Ni", position: [0.21, 0.32, 0.43], occupancy: 1, adp: { kind: "isotropic", bIso: 0.5 } },
    { label: "S1", element: "S", position: [0.61, 0.12, 0.83], occupancy: 1, adp: { kind: "isotropic", bIso: 0.7 } },
  ],
});

interface Case { readonly input: PdffitExportInput; readonly multi: boolean }

function caseOf(phases: readonly StructureModel[], pat: PdfPattern, kinds: readonly ParameterKind[], set: Record<string, number> = {}): Case {
  const multi = phases.length > 1;
  const spec = multi ? buildMultiPhasePdfSpec(phases, pat) : buildPdfSpec(phases[0]!, pat);
  const params = freeAll(spec.params, kinds).map((p) => (set[p.id] !== undefined ? { ...p, value: set[p.id]! } : p));
  return { multi, input: { phases: phases.map((s) => ({ structure: s, id: s.id })), params, bindings: spec.bindings, restraints: spec.restraints, pattern: pat, fitRange: { min: 1, max: 14 } } };
}

const ALL: readonly ParameterKind[] = ["pdfScale", "cellLength", "cellAngle", "bIso", "uAniso", "positionShift", "occupancy", "delta1", "delta2", "qdamp", "qbroad"];

function cases(): Record<string, Case> {
  const ex = gata4se8PdfExample();
  return {
    "cubic F-43m, anisotropic U modes": caseOf([ex.structure], { ...ex.pattern, points: ex.pattern.points.slice(1, 1501) }, ALL, ex.refinedParams),
    "hexagonal P63/mmc, isotropic B": caseOf([exampleStructure()], pattern("mn3ga", "neutron"), ALL),
    "monoclinic P21/c, a shared site, β refined": caseOf([mono()], pattern("mono", "xray"), ALL),
    "triclinic P-1, every angle refined": caseOf([triclinic()], pattern("tri", "xray"), ALL),
    "two phases": caseOf([exampleStructure(), { ...mono(), id: "mono2", name: "Mono2" }], pattern("two", "neutron"), ALL),
  };
}

/** MATERIA's own model of the cell at `values`: every image of every site, the cell, the phase and dataset terms. */
function materiaCell(c: Case, values: Record<string, number>) {
  const resolved = resolveTies(c.input.params, values);
  return c.input.phases.map((ph) => {
    const applied = applyParameters(ph.structure, c.multi ? pdfPhaseBindingsFor(c.input.bindings, ph.id) : c.input.bindings, resolved);
    const m = applied.model;
    const atoms = m.sites.flatMap((site) => distinctSiteOps(m.spaceGroup.operations, site.position).map((op) => ({
      xyz: applyOperation(op, site.position),
      u: site.adp.kind === "isotropic" ? isotropicUij(site.adp.bIso / EIGHT_PI_SQUARED, m.cell) : rotateUAniso(site.adp.uAniso, op.rotation),
      occ: site.occupancy,
    })));
    const cell = [m.cell.a, m.cell.b, m.cell.c, m.cell.alpha, m.cell.beta, m.cell.gamma];
    return { atoms, cell, pdf: applied.pdf! };
  });
}

/** Every PDFfit2 variable of a phase as the model's .stru and constraints give it, with the @ parameters at `at`. */
function pdffitVariables(model: PdffitModel, phase: number, at: (n: number) => number): Map<string, number> {
  const ph = model.phases[phase]!;
  const v = new Map<string, number>();
  ph.atoms.forEach((a, i) => {
    const n = i + 1;
    a.xyz.forEach((x, k) => v.set(`${"xyz"[k]}(${n})`, x));
    ["u11", "u22", "u33", "u12", "u13", "u23"].forEach((name, k) => v.set(`${name}(${n})`, a.u[k]!));
    v.set(`occ(${n})`, a.occupancy);
  });
  [ph.cell.a, ph.cell.b, ph.cell.c, ph.cell.alpha, ph.cell.beta, ph.cell.gamma].forEach((x, k) => v.set(`lat(${k + 1})`, x));
  for (const k of ["pscale", "delta1", "delta2", "sratio", "rcut", "spdiameter"] as const) v.set(k, ph[k]);
  for (const c of ph.constraints) v.set(c.variable, evaluateFormula(c.formula, at));
  return v;
}

const circular = (a: number, b: number): number => {
  const d = (((a - b) % 1) + 1) % 1;
  return Math.min(d, 1 - d);
};

// ---------------------------------------------------------------------------

describe("PDFfit2 export: the constraints follow MATERIA's model, atom by atom", () => {
  for (const [name, c] of Object.entries(cases())) {
    it(`${name}: at MATERIA's values and at perturbed ones, every variable of every atom`, () => {
      const model = pdffitModel(c.input);
      expect(model.parameters.length).toBe(c.input.params.filter((p) => !p.fixed && !p.expression).length);
      const values0: Record<string, number> = Object.fromEntries(c.input.params.map((p) => [p.id, p.value]));
      // Perturb every free parameter, deterministically.
      let seed = 7;
      const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const step: Partial<Record<ParameterKind, number>> = { positionShift: 0.003, uAniso: 0.0007, bIso: 0.08, cellLength: 0.01, cellAngle: 0.15, occupancy: 0.03, pdfScale: 0.01, delta1: 0.07, delta2: 0.09, qdamp: 0.001, qbroad: 0.001 };
      const perturbed = { ...values0 };
      for (const p of c.input.params) if (!p.fixed && !p.expression) perturbed[p.id] = p.value + (step[p.kind] ?? 0.001) * rand();
      for (const values of [values0, perturbed]) {
        const at = (n: number): number => {
          const p = model.parameters[n - 1]!;
          return values[p.id]! / p.factor;
        };
        const want = materiaCell(c, values);
        want.forEach((ph, i) => {
          const got = pdffitVariables(model, i, at);
          expect(model.phases[i]!.atoms).toHaveLength(ph.atoms.length);
          ph.atoms.forEach((a, k) => {
            const n = k + 1;
            a.xyz.forEach((x, j) => expect(circular(got.get(`${"xyz"[j]}(${n})`)!, x)).toBeLessThan(1e-12));
            ["u11", "u22", "u33", "u12", "u13", "u23"].forEach((u, j) => expect(Math.abs(got.get(`${u}(${n})`)! - a.u[j]!)).toBeLessThan(1e-14));
            expect(got.get(`occ(${n})`)).toBeCloseTo(a.occ, 12);
          });
          ph.cell.forEach((x, k) => expect(got.get(`lat(${k + 1})`)).toBeCloseTo(x, 12));
          expect(got.get("pscale")).toBeCloseTo(ph.pdf.scale, 12);
          expect(got.get("delta1")).toBeCloseTo(ph.pdf.delta1, 12);
          expect(got.get("delta2")).toBeCloseTo(ph.pdf.delta2, 12);
        });
        for (const dc of model.datasetConstraints) expect(evaluateFormula(dc.formula, at)).toBeCloseTo(want[0]!.pdf[dc.variable as "qdamp" | "qbroad"], 12);
      }
      // Every formula is in the subset both PDFfit2's parser and PDFgui's Python check take.
      for (const ph of model.phases) for (const con of ph.constraints) expect(con.formula).toMatch(/^[-+*/().@\deE]*(?:(?:cos|sin)\([-+*/().@\deE]*\)?[-+*/().@\deE]*)*$/);
    });
  }
});

describe("PDFfit2 export: the parameters in PDFfit2's units", () => {
  it("B is U_iso = B/8π², the scale is pscale (dscale 1), Qdamp/Qbroad the data set's; esds convert with the values", () => {
    const { input } = cases()["hexagonal P63/mmc, isotropic B"]!;
    const params = input.params.map((p) => (p.kind === "bIso" ? { ...p, esd: 0.04 } : p));
    const model = pdffitModel({ ...input, params });
    const b = model.parameters.find((p) => p.kind === "bIso")!;
    const row = params.find((p) => p.id === b.id)!;
    expect(b.factor).toBeCloseTo(EIGHT_PI_SQUARED, 12);
    expect(b.value).toBeCloseTo(row.value / EIGHT_PI_SQUARED, 14);
    expect(b.esd).toBeCloseTo(0.04 / EIGHT_PI_SQUARED, 14);
    expect(b.variable).toBe("Uiso");
    expect(model.parameters.find((p) => p.kind === "pdfScale")!.variable).toBe("pscale");
    expect(model.datasetConstraints.map((c) => c.variable)).toEqual(["qdamp", "qbroad"]);
    expect(model.stype).toBe("N");
    // Only the free rows are @ parameters; a fixed row is a number in the .stru.
    const fixed = pdffitModel({ ...input, params: input.params.map((p) => (p.kind === "qbroad" ? { ...p, fixed: true } : p)) });
    expect(fixed.datasetConstraints.map((c) => c.variable)).toEqual(["qdamp"]);
    expect(fixed.qbroad).toBeCloseTo(input.params.find((p) => p.kind === "qbroad")!.value, 14);
  });

  it("an isotropic U on a hexagonal cell is the tensor with U12 = U_iso/2, tied to one parameter", () => {
    const model = pdffitModel(cases()["hexagonal P63/mmc, isotropic B"]!.input);
    const ph = model.phases[0]!;
    const site = ph.atoms[0]!.site;
    const b = model.parameters.find((p) => p.kind === "bIso" && p.id === `B_${site}`)!;
    const atom = 1;
    const of = (v: string): string | undefined => ph.constraints.find((c) => c.variable === v)?.formula;
    expect(of(`u11(${atom})`)).toBe(`@${b.index}`);
    expect(of(`u12(${atom})`)).toBe(`0.5*@${b.index}`);
    expect(of(`u13(${atom})`)).toBeUndefined();
    expect(ph.atoms[atom - 1]!.u[3]).toBeCloseTo(ph.atoms[atom - 1]!.u[0] / 2, 15);
  });

  it("with a refined angle an isotropic off-diagonal U follows it through cos(x·π/180), never cosd (PDFgui checks formulas with Python's math)", () => {
    const model = pdffitModel(cases()["monoclinic P21/c, a shared site, β refined"]!.input);
    const beta = model.parameters.find((p) => p.kind === "cellAngle")!;
    const ph = model.phases[0]!;
    const fe = ph.atoms.findIndex((a) => a.site === "Fe1") + 1;
    const u13 = ph.constraints.find((c) => c.variable === `u13(${fe})`)!.formula;
    expect(u13).toContain(`(@${beta.index})*0.0174532925199433`);
    expect(u13).not.toMatch(/cosd|sind/);
    // The shared site: one position, one B, and the last occupancy 1 − the first's.
    const co = ph.atoms.findIndex((a) => a.site === "Co1") + 1;
    const occFe = model.parameters.find((p) => p.id === "occ_Fe1")!;
    expect(ph.constraints.find((c) => c.variable === `occ(${co})`)!.formula).toBe(`1-@${occFe.index}`);
    expect(ph.constraints.find((c) => c.variable === `x(${co})`)!.formula).toBe(ph.constraints.find((c) => c.variable === `x(${fe})`)!.formula);
  });

  it("a symmetry-tied position: each image's coordinates as the generator's shift through its operation", () => {
    const model = pdffitModel(cases()["cubic F-43m, anisotropic U modes"]!.input);
    const ta = model.parameters.find((p) => p.id === "pos_Ta1_0")!;
    const ph = model.phases[0]!;
    const images = ph.atoms.map((a, i) => ({ a, n: i + 1 })).filter(({ a }) => a.site === "Ta1");
    expect(images).toHaveLength(16);
    const forms = images.flatMap(({ n }) => ["x", "y", "z"].map((c) => ph.constraints.find((k) => k.variable === `${c}(${n})`)!.formula));
    // (x, x, x) and its images: x + v or −x + v' for every coordinate, the shift with a unit coefficient.
    for (const f of forms) expect(f).toMatch(new RegExp(`^0\\.\\d+[+-]@${ta.index}$`));
  });
});

describe("PDFfit2 export: what PDFfit2 cannot carry is said", () => {
  it("restraints, a free mPDF row and a magnetic term are named", () => {
    const { input } = cases()["hexagonal P63/mmc, isotropic B"]!;
    const restraint = { id: "r1", label: "Mn1 occupancy restraint", target: 1, sigma: 0.01, terms: [{ parameterId: input.params[0]!.id, coefficient: 1 }] };
    const mpdf: RefinementParameter = { id: "mpdfOrdScale", label: "mPDF ordered scale", kind: "mpdfOrdScale", value: 1, initialValue: 1, fixed: false };
    const model = pdffitModel({ ...input, restraints: [restraint], params: [...input.params, mpdf], bindings: [...input.bindings, { parameterId: "mpdfOrdScale", kind: "mpdfOrdScale", targetId: input.pattern.id }] });
    expect(model.notes.join(" ")).toMatch(/restraint .*PDFfit2 has no restraints/);
    expect(model.notes.join(" ")).toMatch(/magnetic \(mPDF\) term is not carried.*diffpy\.mpdf/);
    expect(model.parameters.some((p) => p.kind === "mpdfOrdScale")).toBe(false);
  });

  it("no termination where MATERIA applies none: a grid at its Nyquist step gets Qmax 0", () => {
    const at = pdffitModel({ ...cases()["triclinic P-1, every angle refined"]!.input, pattern: pattern("tri", "xray", Math.PI / 0.01 + 1) });
    expect(at.qmax).toBe(0);
    expect(at.qmaxIgnored).toBeGreaterThan(0);
    expect(pdffitModel(cases()["triclinic P-1, every angle refined"]!.input).qmax).toBe(25);
  });
});

describe("PDFfit2 files", () => {
  it("writes the .stru as diffpy.structure and PDFfit2 read it: the header, then six lines per atom of the cell", () => {
    const model = pdffitModel(cases()["cubic F-43m, anisotropic U modes"]!.input);
    const ph = model.phases[0]!;
    const stru = pdffitStru(ph).split("\n");
    expect(stru.slice(0, 10).map((l) => l.split(/\s+/)[0])).toEqual(["title", "format", "scale", "sharp", "spcgr", "cell", "dcell", "ncell", "atoms", "GA"]);
    expect(stru[1]).toBe("format pdffit");
    expect(stru[4]).toBe("spcgr   F-43m");
    // sharp is δ2, δ1, sratio, rcut.
    const sharp = stru[3]!.replace("sharp", "").split(",").map(Number);
    expect(sharp).toEqual([ph.delta2, ph.delta1, ph.sratio, ph.rcut].map((v) => Number(v.toFixed(8))));
    expect(stru[7]!.replace("ncell", "").split(",").map(Number)).toEqual([1, 1, 1, 52]);
    // Read the atoms back as PDFfit2 does: symbol x y z occ / esds / U11 U22 U33 / esds / U12 U13 U23 / esds.
    const tokens = stru.slice(9).join(" ").trim().split(/\s+/);
    expect(tokens.length).toBe(52 * 21);
    ph.atoms.forEach((a, i) => {
      const t = tokens.slice(21 * i, 21 * (i + 1));
      expect(t[0]).toBe(a.element.toUpperCase());
      a.xyz.forEach((x, k) => expect(Number(t[1 + k])).toBeCloseTo(x, 9));
      expect(Number(t[4])).toBeCloseTo(a.occupancy, 7);
      [0, 1, 2].forEach((k) => expect(Number(t[9 + k])).toBeCloseTo(a.u[k]!, 9));
      [3, 4, 5].forEach((k) => expect(Number(t[12 + k])).toBeCloseTo(a.u[k]!, 9));
    });
    expect(ph.atoms.every((a) => a.xyz.every((x) => x > -1e-6 && x < 1))).toBe(true);
  });

  it("names a monoclinic group by its short symbol and drops a setting suffix for the README", () => {
    expect(spcgrSymbol(mono()).symbol).toBe("P21/c");
    expect(spcgrSymbol({ ...mono(), spaceGroup: { ...mono().spaceGroup, hermannMauguin: "F d -3 m:2" } })).toEqual({ symbol: "Fd-3m", suffix: ":2" });
    expect(spcgrSymbol(exampleStructure()).symbol).toBe("P63/mmc");
  });

  it("writes the data as two columns under a header PDFgui reads, without r ≤ 0", () => {
    const { input } = cases()["hexagonal P63/mmc, isotropic B"]!;
    const model = pdffitModel(input);
    const lines = pdfDataGr(input.pattern, model).trim().split("\n");
    expect(lines.slice(0, 7)).toEqual(["# G(r) for PDFgui / diffpy-CMI (PDFfit2), written by MATERIA Workbench", "# stype=N  neutron scattering", "# qmax=25", `# qdamp=${pdffitNumber(model.qdamp)}`, `# qbroad=${pdffitNumber(model.qbroad)}`, "#### start data", "#L r(A) G(r)(A^-2)"]);
    const data = lines.slice(7).map((l) => l.split(" ").map(Number));
    expect(data.every((row) => row.length === 2)).toBe(true);
    expect(data).toHaveLength(input.pattern.points.length - 1); // r = 0 left out
    expect(data[0]).toEqual([0.01, Number(Math.sin(1 / 7).toPrecision(15))]);
    // PDFgui reads metadata off these patterns: nothing in the header may look like "x-ray" on neutron data, or "T =", or "x =".
    const header = lines.slice(0, 7).join("\n");
    expect(header).not.toMatch(/x-?ray|PDFgetX|\bT *=|\bx *=/i);
  });

  it("bundles the structure, the data, both scripts, the constraints and a README naming PDFgui / diffpy-CMI", () => {
    const c = cases()["cubic F-43m, anisotropic U modes"]!;
    const refined = c.input.phases.map((ph) => applyParameters(ph.structure, c.input.bindings, resolveTies(c.input.params, Object.fromEntries(c.input.params.map((p) => [p.id, p.value])))).model);
    const entries = pdfguiBundle({ ...c.input, refinedPhases: refined, rw: 0.0812, calc: c.input.pattern.points.map(() => 0), current: false, appVersion: "0.0.0" });
    expect(entries.map((e) => e.name)).toEqual(["GaTa4Se8.stru", "GaTa4Se8.cif", "GaTa4Se8.gr", "materia_fit.csv", "fit_pdffit2.py", "make_pdfgui_project.py", "constraints.txt", "README.txt"]);
    const file = (n: string): string => entries.find((e) => e.name === n)!.data as string;
    const model = pdffitModel(c.input);
    // The script carries every constraint and parameter, and the window as data points.
    const script = file("fit_pdffit2.py");
    expect(script.match(/^ {12}\("(?:x|y|z|u\d\d|occ|lat|pscale|delta)/gm)).toHaveLength(model.phases[0]!.constraints.length);
    expect(script).toContain(`RMIN, RMAX = ${pdffitNumber(model.rmin)}, ${pdffitNumber(model.rmax)}`);
    expect(script).toContain('STYPE = "X"');
    for (const p of model.parameters) expect(script).toContain(`    (${p.index}, ${JSON.stringify(p.label)}, ${JSON.stringify(p.variable)}, ${pdffitNumber(p.value)}, None),`);
    expect(file("make_pdfgui_project.py")).toContain("import fit_pdffit2 as model");
    expect(file("constraints.txt").split("\n").filter((l) => / = /.test(l))).toHaveLength(model.phases[0]!.constraints.length + model.datasetConstraints.length);
    const readme = file("README.txt");
    expect(readme).toContain("PDFgui / diffpy-CMI bundle for GaTa4Se8");
    expect(readme).toMatch(/Peak normalization — the one difference in the model/);
    expect(readme).not.toMatch(/GSAS|FullProf/);
    // The CSV holds MATERIA's curve over the window only.
    expect(file("materia_fit.csv").trim().split("\n")).toHaveLength(model.points + 1);
  });
});

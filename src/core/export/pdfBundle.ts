/**
 * The PDF page's cross-check bundle: a real-space G(r) refinement as the
 * files PDFgui and diffpy-CMI (both on the PDFfit2 engine) need to reproduce
 * it — the structure (`.stru`, the whole cell at MATERIA's values, and the
 * CIF in its space group), the data (`.gr`), a runnable PDFfit2 script that
 * refines exactly the parameters MATERIA refined and prints both results side
 * by side, a script that builds the PDFgui project, MATERIA's calculated curve
 * for the model check, every constraint, and a README with the conventions.
 * Pure: returns `ZipEntry[]`; the page zips and saves it.
 *
 * The mapping and its conventions are pdffit2.ts's. The PDFgui project (.ddp)
 * is a zip of pickled Python objects, which only PDFgui's own code writes
 * reliably: the bundle ships the script that has PDFgui write it
 * (make_pdfgui_project.py), as the GSAS-II bundle ships build_gpx.py.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { ParameterBinding, RefinementParameter } from "@/core/refinement/types";
import type { ZipEntry } from "@/core/export/zip";
import type { PdfPattern } from "@/core/diffraction/types";
import { structureToCif } from "@/core/export/cif";
import { pdfPhaseBindingsFor } from "@/core/workflow/pdf";
import { pdffitModel, pdffitNumber, pdffitStru, type PdffitExportInput, type PdffitModel, type PdffitParameter } from "@/core/export/pdffit2";

export interface PdfguiBundleInput extends PdffitExportInput {
  /** Base file name (default: the primary phase's name). */
  readonly name?: string;
  /** Each phase with the parameters applied (primary first), for its CIF. */
  readonly refinedPhases: readonly StructureModel[];
  /** MATERIA's Rw over the window (fraction), as the page shows it. */
  readonly rw: number;
  /** MATERIA's calculated G(r) on the data grid (the total, an mPDF term included). */
  readonly calc: readonly number[];
  /** With an mPDF term in the fit: the nuclear part of `calc`, which PDFfit2 reproduces. */
  readonly calcNuclear?: readonly number[];
  /** The spin model in the fit, when there is one: its group and k in words, and its mCIF. */
  readonly magnetic?: { readonly description: string; readonly mcif?: { readonly name: string; readonly text: string } } | null;
  /** The last refinement describes these values (its esds apply). */
  readonly current: boolean;
  /** How the positions refine: per-coordinate shifts or distortion-mode amplitudes. */
  readonly positionMode?: "atomic" | "irreps";
  readonly appVersion?: string;
}

/** Filesystem-safe base name. */
function sanitize(name: string): string {
  return name.normalize("NFKD").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "structure";
}

const SCRIPT = "fit_pdffit2.py";
const PROJECT_SCRIPT = "make_pdfgui_project.py";
const CALC = "materia_fit.csv";
const CONSTRAINTS = "constraints.txt";

/** The files of the bundle. */
export function pdfguiBundle(input: PdfguiBundleInput): ZipEntry[] {
  const model = pdffitModel(input);
  const primary = input.phases[0]!.structure;
  const name = sanitize(input.name ?? (primary.name || primary.id));
  const dataName = `${name}.gr`;
  const taken = new Set<string>([dataName, SCRIPT, PROJECT_SCRIPT, CALC, CONSTRAINTS, "README.txt", `${name}.ddp`]);
  const unique = (base: string, ext: string): string => {
    let out = `${base}${ext}`;
    for (let i = 2; taken.has(out); i++) out = `${base}_${i}${ext}`;
    taken.add(out);
    return out;
  };
  const files = model.phases.map((ph, i) => {
    const base = i === 0 ? name : sanitize(ph.name || `phase${i + 1}`);
    return { stru: unique(base, ".stru"), cif: unique(base, ".cif") };
  });
  const multi = input.phases.length > 1;
  const free = input.params.filter((p) => !p.fixed && !p.expression).length;
  const mcif = input.magnetic?.mcif ? { ...input.magnetic.mcif, name: unique(sanitize(input.magnetic.mcif.name.replace(/\.mcif$/i, "")), ".mcif") } : undefined;

  const entries: ZipEntry[] = [];
  model.phases.forEach((ph, i) => {
    entries.push({ name: files[i]!.stru, data: pdffitStru(ph) });
    const own = multi ? pdfPhaseBindingsFor(input.bindings, input.phases[i]!.id) : input.bindings;
    entries.push({
      name: files[i]!.cif,
      data: structureToCif(input.refinedPhases[i]!, {
        blockName: sanitize(ph.name),
        params: input.params as RefinementParameter[],
        bindings: own as ParameterBinding[],
        refinement: { rwp: input.rw * 100, nRef: model.points, nParam: free },
      }),
    });
  });
  if (mcif) entries.push({ name: mcif.name, data: mcif.text });
  entries.push({ name: dataName, data: pdfDataGr(input.pattern, model) });
  entries.push({ name: CALC, data: materiaFitCsv(input, model) });
  const scriptFiles = { title: name, dataName, phaseFiles: files.map((f) => f.stru), rw: input.rw, magnetic: !!input.magnetic, appVersion: input.appVersion };
  entries.push({ name: SCRIPT, data: pdffit2Script(model, scriptFiles) });
  entries.push({ name: PROJECT_SCRIPT, data: pdfguiProjectScript(name) });
  entries.push({ name: CONSTRAINTS, data: constraintsText(model, files) });
  entries.push({ name: "README.txt", data: pdfguiReadme(input, model, { name, dataName, files, free, mcif: mcif?.name }) });
  return entries;
}

// ---------------------------------------------------------------------------
// The data

/**
 * The observed G(r) as two columns, r (Å) and G (Å⁻²), under a header both
 * readers take: PDFfit2 skips the `#` lines (libpdffit2/pdf.cc
 * read_data_stream), PDFgui reads the scattering type ("x-ray" / "neutron"),
 * qmax, qdamp and qbroad off them (control/pdfdataset.py readStr). Two
 * columns, so both weight every point equally, as MATERIA does (a dG column
 * would weight by 1/dG²). qmax is the one MATERIA terminates with (0 when it
 * applies none on this grid). Nothing else goes in the header: PDFgui's
 * patterns would read a stray "x-ray" or "T =" in a file name as metadata.
 * A point at r ≤ 0 is left out: PDFfit2 divides by r (G(0) = 0 says nothing).
 */
export function pdfDataGr(pattern: PdfPattern, model: PdffitModel): string {
  const lines = [
    "# G(r) for PDFgui / diffpy-CMI (PDFfit2), written by MATERIA Workbench",
    model.stype === "N" ? "# stype=N  neutron scattering" : "# stype=X  x-ray scattering",
    `# qmax=${pdffitNumber(model.qmax)}`,
    `# qdamp=${pdffitNumber(model.qdamp)}`,
    `# qbroad=${pdffitNumber(model.qbroad)}`,
    "#### start data",
    "#L r(A) G(r)(A^-2)",
  ];
  for (const p of pattern.points) if (p.r > 0) lines.push(`${pdffitNumber(p.r)} ${pdffitNumber(p.gObs)}`);
  return `${lines.join("\n")}\n`;
}

/** MATERIA's curves over the fit window: r, G_obs, G_calc (and the nuclear part with an mPDF term), for the script's model check. */
function materiaFitCsv(input: PdfguiBundleInput, model: PdffitModel): string {
  const nuclear = input.calcNuclear;
  const rows: string[] = [nuclear ? "r,Gobs,Gcalc_MATERIA,Gcalc_MATERIA_nuclear" : "r,Gobs,Gcalc_MATERIA"];
  input.pattern.points.forEach((p, i) => {
    if (p.r < model.rmin - 1e-9 || p.r > model.rmax + 1e-9) return;
    rows.push([p.r, p.gObs, input.calc[i] ?? 0, ...(nuclear ? [nuclear[i] ?? 0] : [])].map(pdffitNumber).join(","));
  });
  return `${rows.join("\n")}\n`;
}

/** Every constraint, phase by phase, in the syntax PDFgui's Constraints tabs and PDFfit2 take. */
function constraintsText(model: PdffitModel, files: readonly { readonly stru: string }[]): string {
  const lines = [
    "# The constraints of MATERIA's refinement, for PDFgui (each phase's and the data set's Constraints",
    "# tab) or PDFfit2 (constrain(variable, formula)). Atom numbers are those of the .stru files;",
    "# @n are the parameters listed in README.txt, at MATERIA's values there.",
  ];
  model.phases.forEach((ph, i) => {
    lines.push("", `[phase ${i + 1}: ${ph.name} — ${files[i]!.stru}]`);
    if (ph.constraints.length === 0) lines.push("# none: every variable is held at the .stru's value");
    for (const c of ph.constraints) lines.push(`${c.variable} = ${c.formula}`);
  });
  lines.push("", "[data set]");
  if (model.datasetConstraints.length === 0) lines.push("# none: qdamp and qbroad are held");
  for (const c of model.datasetConstraints) lines.push(`${c.variable} = ${c.formula}`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// The PDFfit2 script

/** A Python string literal (JSON's escapes are Python's). */
const pyStr = (s: string): string => JSON.stringify(s);

interface ScriptFiles {
  readonly title: string;
  readonly dataName: string;
  readonly phaseFiles: readonly string[];
  readonly rw: number;
  readonly magnetic: boolean;
  readonly appVersion?: string | undefined;
}

/**
 * `fit_pdffit2.py`: loads the `.stru` and the `.gr`, sets every variable at
 * MATERIA's value (the scattering type, Qmax, Qdamp, Qbroad, the window, the
 * phase scale, δ1/δ2, sratio/rcut, the particle Ø, MATERIA's scattering
 * lengths), constrains exactly the parameters MATERIA refined, then (1)
 * evaluates the model at MATERIA's values with every parameter fixed — the
 * model check, against MATERIA's own curve — and (2) refines and prints Rw
 * and each parameter beside MATERIA's, the esds of both scaled by √χ²_red.
 * Standard library and diffpy.pdffit2 only. Its constants are what
 * make_pdfgui_project.py imports.
 */
export function pdffit2Script(model: PdffitModel, files: ScriptFiles): string {
  const phaseBlocks = model.phases.map((ph, i) => {
    const vars = (["pscale", "delta1", "delta2", "sratio", "rcut", "spdiameter"] as const).map((k) => `${pyStr(k)}: ${pdffitNumber(ph[k])}`).join(", ");
    const scat = Object.entries(ph.scattering).map(([el, v]) => `${pyStr(el)}: ${pdffitNumber(v)}`).join(", ");
    return [
      "    {",
      `        "name": ${pyStr(ph.name)},`,
      `        "stru": ${pyStr(files.phaseFiles[i]!)},`,
      `        "variables": {${vars}},`,
      `        "scattering": {${scat}},`,
      `        "constraints": [`,
      ...ph.constraints.map((c) => `            (${pyStr(c.variable)}, ${pyStr(c.formula)}),`),
      "        ],",
      `        "sites": [`,
      ...ph.sites.map((s) => `            (${pyStr(s.label)}, ${s.atom}, ${s.xyz.map(pdffitNumber).join(", ")}, ${s.refined ? "True" : "False"}),`),
      "        ],",
      "    },",
    ].join("\n");
  });
  const lines = [
    "#!/usr/bin/env python",
    "# -*- coding: utf-8 -*-",
    `"""Refine MATERIA's real-space model of ${files.title.replace(/"/g, "'")} in PDFfit2, and compare.`,
    "",
    "The same structure, data and fit window as MATERIA's refinement, with",
    "exactly the parameters MATERIA refined free (every atom of the cell tied",
    "to them by the symmetry, as in MATERIA) and the rest held at MATERIA's",
    "values. It first computes G(r) at MATERIA's values and compares it with",
    "MATERIA's curve (the model check), then refines and prints Rw and each",
    "parameter beside MATERIA's.",
    "",
    "Requires diffpy.pdffit2, the engine of PDFgui and of diffpy-CMI's",
    "small-box fits:   pip install diffpy.pdffit2",
    "              or  conda install -c conda-forge diffpy.pdffit2",
    `Run:   python ${SCRIPT}     (from any folder; it reads the files beside it)`,
    `Generated by MATERIA Workbench${files.appVersion ? ` ${files.appVersion}` : ""}; README.txt has the conventions.`,
    '"""',
    "",
    "import math",
    "import os",
    "import re",
    "import sys",
    "",
    "try:",
    "    from diffpy.pdffit2 import PdfFit, redirect_stdout",
    "    from diffpy.pdffit2 import __version__ as PDFFIT2_VERSION",
    "except ImportError:",
    '    sys.exit("diffpy.pdffit2 is not installed: pip install diffpy.pdffit2 "',
    '             "(or conda install -c conda-forge diffpy.pdffit2)")',
    "",
    "HERE = os.path.dirname(os.path.abspath(__file__))",
    "",
    "# ---- MATERIA's refinement, as PDFfit2 takes it (generated) -----------------",
    "",
    `TITLE = ${pyStr(files.title)}`,
    `DATA = ${pyStr(files.dataName)}`,
    `STYPE = ${pyStr(model.stype)}  # "X" x-ray, "N" neutron`,
    `QMAX = ${pdffitNumber(model.qmax)}  # termination Qmax (1/A); 0 = none, as in MATERIA on this grid`,
    `RMIN, RMAX = ${pdffitNumber(model.rmin)}, ${pdffitNumber(model.rmax)}  # the fit window: MATERIA's first and last fitted point`,
    `DATASET = {"qdamp": ${pdffitNumber(model.qdamp)}, "qbroad": ${pdffitNumber(model.qbroad)}, "dscale": 1}`,
    "DATASET_CONSTRAINTS = [",
    ...model.datasetConstraints.map((c) => `    (${pyStr(c.variable)}, ${pyStr(c.formula)}),`),
    "]",
    "",
    "# Each phase: its .stru (the whole cell at MATERIA's values), the phase",
    "# variables, MATERIA's scattering power per element (neutron b in fm, or the",
    "# X-ray f(0) in electrons), the constraints, and each site's first atom",
    "# with MATERIA's x, y, z.",
    "PHASES = [",
    ...phaseBlocks,
    "]",
    "",
    "# @n: MATERIA's parameter, the PDFfit2 variable it moves, MATERIA's value and",
    "# esd in PDFfit2's units (None: the last refinement does not describe the values).",
    "PARAMETERS = [",
    ...model.parameters.map((p) => `    (${p.index}, ${pyStr(p.label)}, ${pyStr(p.variable)}, ${pdffitNumber(p.value)}, ${p.esd !== undefined ? pdffitNumber(p.esd) : "None"}),`),
    "]",
    "",
    `MATERIA_RW = ${pdffitNumber(files.rw)}`,
    `MATERIA_CURVE = ${pyStr(CALC)}`,
    `MAGNETIC = ${files.magnetic ? "True  # MATERIA's fit has an mPDF term, which PDFfit2 cannot compute" : "False"}`,
    "",
    "# MATERIA's scattering lengths (True), or PDFfit2's own tables (False).",
    "USE_MATERIA_SCATTERING = True",
    "",
    "# ----------------------------------------------------------------------------",
    "",
    SCRIPT_BODY,
  ];
  return `${lines.join("\n")}\n`;
}

/** The fixed part of the script: configure, evaluate at MATERIA's values, refine, compare. */
const SCRIPT_BODY = String.raw`
def configure(pf):
    """Structure, data and constraints into one PdfFit, every parameter at MATERIA's value."""
    for ph in PHASES:
        pf.read_struct(os.path.join(HERE, ph["stru"]))
        for name, value in ph["variables"].items():
            pf.setvar(name, value)
        if USE_MATERIA_SCATTERING:
            for element, value in ph["scattering"].items():
                pf.set_scat(STYPE, element, value)
        for var, formula in ph["constraints"]:
            pf.constrain(var, formula)
    pf.read_data(os.path.join(HERE, DATA), STYPE, QMAX, DATASET["qdamp"])
    pf.setvar("qbroad", DATASET["qbroad"])
    pf.setvar("dscale", DATASET["dscale"])
    for var, formula in DATASET_CONSTRAINTS:
        pf.constrain(var, formula)
    for index, _label, _variable, value, _esd in PARAMETERS:
        pf.setpar(index, value)
    pf.pdfrange(1, RMIN, RMAX)


def parameter_esds(pf):
    """PDFfit2's esds, read off its results: the square roots of the covariance diagonal."""
    text = pf.save_res_string()
    block = text.split("Refinement parameters :")[-1]
    block = re.split(r"\n\s*-{20,}", block)[0]
    found = {}
    for m in re.finditer(r"(\d+):\s*(\S+)(?:\s+\(([^)]*)\))?", block):
        try:
            found[int(m.group(1))] = float(m.group(3)) if m.group(3) else 0.0
        except ValueError:
            found[int(m.group(1))] = float("nan")
    return found


def reduced_chi2(pf, nfree):
    """chi^2 / (N - P) over the window: the factor MATERIA scales its esds by."""
    obs, fit = pf.getpdf_obs(), pf.getpdf_fit()
    chi2 = sum((o - c) ** 2 for o, c in zip(obs, fit))
    return chi2 / max(1, len(obs) - nfree)


def with_esd(value, esd):
    """value(esd) in the last digits, as a CIF prints it."""
    if esd is None or not math.isfinite(esd) or esd <= 0:
        return "%.6g" % value
    decimals = min(10, max(0, 1 - int(math.floor(math.log10(esd)))))
    return "%.*f(%d)" % (decimals, value, round(esd * 10 ** decimals))


def read_materia_curve():
    path = os.path.join(HERE, MATERIA_CURVE)
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        head = fh.readline().strip().split(",")
        column = head.index("Gcalc_MATERIA_nuclear") if "Gcalc_MATERIA_nuclear" in head else head.index("Gcalc_MATERIA")
        return [(float(row[0]), float(row[column])) for row in (line.strip().split(",") for line in fh) if row and row[0]]


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", TITLE)
    log = open(os.path.join(HERE, safe + "_pdffit2.log"), "w")
    redirect_stdout(log)
    nfree = len(PARAMETERS)
    print("PDFfit2 %s cross-check of MATERIA's refinement of %s" % (PDFFIT2_VERSION, TITLE))
    print("  data %s: %s, Qmax %s 1/A, fit r = %g-%g A" % (DATA, "x-ray" if STYPE == "X" else "neutron", QMAX if QMAX else "none", RMIN, RMAX))
    print("  scattering lengths: %s" % ("MATERIA's (set_scat)" if USE_MATERIA_SCATTERING else "PDFfit2's tables"))
    if MAGNETIC:
        print("  NOTE: MATERIA's fit includes a magnetic (mPDF) term; PDFfit2 fits the nuclear model only,")
        print("        so its Rw cannot match. The model check compares with MATERIA's nuclear part.")

    # 1. The model at MATERIA's values: every parameter held, no refinement.
    pf0 = PdfFit()
    configure(pf0)
    if PARAMETERS:
        pf0.fixpar("ALL")
    pf0.refine()
    r0, g0 = pf0.getR(), pf0.getpdf_fit()
    print()
    print("Rw over the window (%d points)" % len(r0))
    print("  MATERIA                         %8.4f %%" % (100 * MATERIA_RW))
    print("  PDFfit2 at MATERIA's values     %8.4f %%   (no refinement: the model check)" % (100 * pf0.getrw()))
    curve = read_materia_curve()
    if curve is not None and len(curve) == len(r0):
        obs0 = pf0.getpdf_obs()
        diff = [p - m for p, (_r, m) in zip(g0, curve)]
        rms_d = math.sqrt(sum(d * d for d in diff) / len(diff))
        rms_o = math.sqrt(sum(o * o for o in obs0) / len(obs0))
        worst = max(range(len(diff)), key=lambda i: abs(diff[i]))
        print("  G_calc PDFfit2 - MATERIA: rms %.3g (%.2f %% of the rms G_obs), largest %.3g at r = %.3f A"
              % (rms_d, 100 * rms_d / rms_o if rms_o else 0.0, diff[worst], r0[worst]))
    elif curve is not None:
        print("  (%s does not match the window; the curve comparison is skipped)" % MATERIA_CURVE)

    if not PARAMETERS:
        print("\nMATERIA refined no parameter PDFfit2 computes: nothing to refine.")
        return

    # 2. The refinement: exactly MATERIA's free parameters.
    pf = PdfFit()
    configure(pf)
    pf.refine()
    scale = math.sqrt(reduced_chi2(pf, nfree))
    esd = parameter_esds(pf)
    print("  PDFfit2 refined                 %8.4f %%   (%d parameters)" % (100 * pf.getrw(), nfree))
    print()
    print(" @   parameter [PDFfit2]                  MATERIA            PDFfit2            diff/sigma")
    within = 0
    for index, label, variable, value, m_esd in PARAMETERS:
        p = pf.getpar(index)
        p_esd = esd.get(index, float("nan")) * scale
        sigma = math.sqrt((m_esd or 0.0) ** 2 + (p_esd if math.isfinite(p_esd) else 0.0) ** 2)
        z = (p - value) / sigma if sigma > 0 else float("nan")
        within += 1 if math.isfinite(z) and abs(z) <= 2 else 0
        name = "%s [%s]" % (label[:24], variable)
        print(" %-3d %-36s %-18s %-18s %s" % (index, name[:36], with_esd(value, m_esd), with_esd(p, p_esd), "%.1f" % z if math.isfinite(z) else "-"))
    print("  sigma: each program's esd scaled by sqrt(chi2_red), MATERIA's convention (PDFfit2's own are")
    print("  unscaled with uniform weights); diff/sigma over the two combined.")
    print("  %d of %d parameters agree within 2 combined esds." % (within, nfree))
    print("  Expect the cell to differ by a few esds: MATERIA gives each pair's Gaussian 1/r_ij, PDFfit2")
    print("  divides the sum by r, so its peaks lean toward low r by about sigma^2/r (README.txt).")

    shown = False
    for i, ph in enumerate(PHASES):
        pf.setphase(i + 1)
        for label, atom, x, y, z, refined in ph["sites"]:
            if not refined:
                continue
            if not shown:
                print()
                print(" refined positions, each site's first atom     MATERIA x, y, z               PDFfit2 x, y, z")
                shown = True
            got = [pf.getvar("%s(%d)" % (c, atom)) for c in "xyz"]
            print(" %-22s atom %-4d  %9.5f %9.5f %9.5f   %9.5f %9.5f %9.5f" % (("%s %s" % (ph["name"], label))[:22], atom, x, y, z, got[0], got[1], got[2]))

    pf.save_res(os.path.join(HERE, safe + "_pdffit2.res"))
    pf.save_pdf(1, os.path.join(HERE, safe + "_pdffit2.fgr"))
    for i, ph in enumerate(PHASES):
        pf.save_struct(i + 1, os.path.join(HERE, re.sub(r"\.stru$", "", ph["stru"]) + "_pdffit2_refined.stru"))
    print()
    print("Wrote %s_pdffit2.res, %s_pdffit2.fgr, the refined .stru and the engine log %s_pdffit2.log." % (safe, safe, safe))
    log.close()


if __name__ == "__main__":
    main()
`.trimStart();

/**
 * `make_pdfgui_project.py`: has PDFgui's own code (diffpy.pdfgui's
 * PDFGuiControl) build `<name>.ddp` from the bundle — the fit, its phase(s)
 * and data set, every constraint and the parameters at MATERIA's values,
 * read from fit_pdffit2.py — so PDFgui opens it ready to run.
 */
export function pdfguiProjectScript(name: string): string {
  return String.raw`#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build a PDFgui project of MATERIA's refinement: ${name}.ddp.

The fit, its phase(s), the data set, every constraint of fit_pdffit2.py and
the parameters at MATERIA's values, so that in PDFgui it is File > Open
Project, then Fits > Run Selected Fits. A .ddp holds pickled Python objects,
so PDFgui's own code writes it here, not MATERIA.

Requires diffpy.pdfgui:  pip install diffpy.pdfgui
                     or  conda install -c conda-forge diffpy.pdfgui
Run:   python ${PROJECT_SCRIPT}
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    from diffpy.pdfgui.control.constraint import Constraint
    from diffpy.pdfgui.control.parameter import Parameter
    from diffpy.pdfgui.control.pdfguicontrol import PDFGuiControl
except ImportError:
    sys.exit("diffpy.pdfgui is not installed: pip install diffpy.pdfgui "
             "(or conda install -c conda-forge diffpy.pdfgui)")

import fit_pdffit2 as model


def build(path):
    control = PDFGuiControl()
    fit = control.newFitting(model.TITLE)
    for ph in model.PHASES:
        stru = control.loadStructure(fit, os.path.join(HERE, ph["stru"]), name=ph["name"])
        for var, formula in ph["constraints"]:
            stru.constraints[var] = Constraint(formula)
    data = control.loadDataset(fit, os.path.join(HERE, model.DATA), name=model.DATA)
    data.stype = model.STYPE
    data.qmax = model.QMAX
    data.qdamp = model.DATASET["qdamp"]
    data.qbroad = model.DATASET["qbroad"]
    data.dscale = model.DATASET["dscale"]
    data.fitrmin = model.RMIN
    data.fitrmax = model.RMAX
    for var, formula in model.DATASET_CONSTRAINTS:
        data.constraints[var] = Constraint(formula)
    for index, label, _variable, value, _esd in model.PARAMETERS:
        par = Parameter(index, initial=value)
        par.name = label
        fit.parameters[index] = par
    control.save(path)
    return path


if __name__ == "__main__":
    out = build(os.path.join(HERE, model.TITLE + ".ddp"))
    print("Wrote %s: open it in PDFgui (File > Open Project) and run the fit (Fits > Run Selected Fits)." % os.path.basename(out))
    print("PDFgui uses PDFfit2's own scattering lengths; fit_pdffit2.py sets MATERIA's (README.txt).")
`;
}

// ---------------------------------------------------------------------------
// The README

const fmt = (x: number, d = 4): string => String(Number(x.toFixed(d)));

/** A parameter's MATERIA value with its esd, in PDFfit2's units. */
function valueText(p: PdffitParameter): string {
  if (p.esd === undefined || !(p.esd > 0)) return pdffitNumber(Number(p.value.toPrecision(8)));
  const decimals = Math.min(10, Math.max(0, 1 - Math.floor(Math.log10(p.esd))));
  return `${p.value.toFixed(decimals)}(${Math.round(p.esd * 10 ** decimals)})`;
}

function pdfguiReadme(
  input: PdfguiBundleInput,
  model: PdffitModel,
  r: { readonly name: string; readonly dataName: string; readonly files: readonly { readonly stru: string; readonly cif: string }[]; readonly free: number; readonly mcif: string | undefined },
): string {
  const { name, dataName, files } = r;
  const probe = model.stype === "N" ? "neutron" : "X-ray";
  const lines: string[] = [
    `PDFgui / diffpy-CMI bundle for ${name} — generated by MATERIA Workbench${input.appVersion ? ` ${input.appVersion}` : ""}.`,
    ``,
    ...wrap(`MATERIA refined ${model.phases.map((ph) => ph.name).join(" + ")} against ${probe} G(r) over r = ${fmt(model.rmin, 3)}–${fmt(model.rmax, 3)} Å (${model.points} points): Rw = ${(100 * input.rw).toFixed(2)} %, ${r.free} free parameter${r.free === 1 ? "" : "s"}. This bundle carries that model and the data to PDFfit2, the engine of PDFgui and of diffpy-CMI's small-box fits, so you can reproduce the result before you publish it.`, 92, "", ""),
    ``,
    `Files`,
  ];
  model.phases.forEach((ph, i) => {
    lines.push(
      ...wrap(`${files[i]!.stru} — ${ph.name}: the whole unit cell (${ph.atoms.length} atoms) in the PDFfit format, at MATERIA's values: cell, positions, U, occupancies, the scale, δ1, δ2, sratio, rcut${ph.spdiameter > 0 ? ", the particle diameter" : ""}.`, 92, "  ", "      "),
      ...wrap(`${files[i]!.cif} — the same structure in its space group (${ph.spaceGroup}${ph.settingSuffix ?? ""}), with esds: MATERIA's CIF.`, 92, "  ", "      "),
    );
  });
  if (r.mcif) lines.push(...wrap(`${r.mcif} — the spin model as an mCIF, for diffpy.mpdf (see Magnetic PDF).`, 92, "  ", "      "));
  lines.push(
    ...wrap(`${dataName} — the data: r (Å) and G(r) (Å⁻²) in two columns, so PDFfit2 weights every point equally, as MATERIA does. Its header gives PDFgui the scattering type, Qmax, Qdamp and Qbroad.`, 92, "  ", "      "),
    ...wrap(`${SCRIPT} — refines the model in PDFfit2 and compares it with MATERIA's (option A).`, 92, "  ", "      "),
    ...wrap(`${PROJECT_SCRIPT} — has PDFgui write the project ${name}.ddp (option B).`, 92, "  ", "      "),
    ...wrap(`${CONSTRAINTS} — every constraint, phase by phase (option C).`, 92, "  ", "      "),
    ...wrap(`${CALC} — MATERIA's G(r) over the fit window, for the script's model check.`, 92, "  ", "      "),
    ``,
    `A — the PDFfit2 script (recommended)`,
    `  pip install diffpy.pdffit2        (or: conda install -c conda-forge diffpy.pdffit2)`,
    `  python ${SCRIPT}`,
    ...wrap(`It reads the .stru and the .gr, sets the scattering type (${model.stype}), Qmax (${model.qmax > 0 ? `${pdffitNumber(model.qmax)} Å⁻¹` : "0: no termination"}), Qdamp, Qbroad, the fit window and every phase's scale, δ1, δ2, sratio, rcut, spdiameter, cell, positions, U and occupancies at MATERIA's values, with MATERIA's scattering lengths (USE_MATERIA_SCATTERING = False uses PDFfit2's tables). It constrains exactly the ${model.parameters.length} parameter${model.parameters.length === 1 ? "" : "s"} below and holds the rest. Then it (1) computes G(r) at MATERIA's values and compares it with MATERIA's curve, the model check, and (2) refines, and prints Rw and every parameter beside MATERIA's, with esds. It writes ${name}_pdffit2.res (PDFfit2's report), ${name}_pdffit2.fgr (the fit), the refined .stru and the engine's log.`, 92, "  ", "  "),
    ``,
    `B — a PDFgui project`,
    `  pip install diffpy.pdfgui         (or: conda install -c conda-forge diffpy.pdfgui)`,
    `  python ${PROJECT_SCRIPT}`,
    ...wrap(`It writes ${name}.ddp with PDFgui's own code: the fit, its phase${files.length > 1 ? "s" : ""}, the data set (${model.stype === "N" ? "neutron" : "X-ray"}, Qmax ${pdffitNumber(model.qmax)}, Qdamp, Qbroad, the fit range), every constraint and the parameters at MATERIA's values. In PDFgui: File > Open Project, then Fits > Run Selected Fits.`, 92, "  ", "  "),
    ``,
    `C — PDFgui by hand`,
    ...wrap(`Fits > New Fit; Phases > New Phase: load ${files.map((f) => f.stru).join(", ")} (a .cif works too, which PDFgui expands to the cell, but the atom numbers below are the .stru's); Data > New Data Set: load ${dataName}, and on its Configure tab check ${model.stype === "N" ? "Neutron" : "X-ray"}, Qmax ${pdffitNumber(model.qmax)}, Qdamp ${fmt(model.qdamp, 6)}, Qbroad ${fmt(model.qbroad, 6)} and the fit range ${pdffitNumber(model.rmin)}–${pdffitNumber(model.rmax)} Å at the data's step. Enter ${CONSTRAINTS} on each phase's and the data set's Constraints tab and the initial values below on the fit's Parameters tab, then Fits > Run Selected Fits. (PDFgui's Symmetry constraints, from the space group, tie the same atoms by coordinate; either way, refine only these parameters.)`, 92, "  ", "  "),
    ``,
    `Parameters MATERIA refined (@n in the scripts and PDFgui; MATERIA's value${input.current ? " and esd" : ""}, in PDFfit2's units)`,
  );
  if (model.parameters.length === 0) lines.push(`  none that PDFfit2 computes.`);
  for (const p of model.parameters) lines.push(`  @${String(p.index).padEnd(3)} ${p.label.padEnd(26)} ${p.meaning.padEnd(36)} ${valueText(p)}`);
  if (!input.current && model.parameters.length > 0) lines.push(`  (no esds: the values were not refined, or were edited after the last refinement)`);
  lines.push(
    ``,
    `Conventions (MATERIA → PDFfit2)`,
    ...bullets([
      "Scale: MATERIA's PDF scale is each phase's pscale; the data scale dscale is 1.",
      "ADPs: B (Å²) = 8π²·U. An isotropic site is U_cart = U_iso·I; PDFfit2 has no isotropic switch, so its six U^ij are that tensor (U11 = U22 = U33 = U_iso, U12 = U_iso·cos γ*, U13 = U_iso·cos β*, U23 = U_iso·cos α*), tied to one parameter @n = U_iso. U12 = 0 on a hexagonal cell would be anisotropic. Anisotropic sites: the CIF U^ij, each image of a site rotated by its operation (U′ = R·U·Rᵀ), the same convention in both programs.",
      "Peak width: σ² = σ′²(1 − δ1/r − δ2/r² + Qbroad²·r²) in both (PDFfit2's NEW_SHARP), σ′² the two atoms' U projected on the pair; sratio narrows the peaks below rcut.",
      "Envelopes: exp(−(r·Qdamp)²/2) in both; the sphere 1 − 3x/2 + x³/2, x = r/spdiameter, in both (0 = bulk).",
      "Weights: uniform in both (no dG column); Rw = √(Σ(G_obs − G_calc)²/Σ G_obs²) in both.",
      "Esds: MATERIA scales its covariance by χ²/(N − P); PDFfit2 does not with uniform weights. The script scales PDFfit2's by √χ²_red to compare like with like.",
      `Positions: MATERIA refines symmetry-adapted shifts${input.positionMode === "irreps" ? " (here distortion-mode amplitudes)" : ""}; each atom of the cell is its site's image, so x, y, z of every atom are formulas in the same shifts (R·axis per image), as PDFgui's symmetry constraints tie them by coordinate.`,
      `Scattering: neutron coherent lengths (fm) or the X-ray f(0) (electrons) per element; the script sets MATERIA's (${scatteringList(model)}), PDFgui keeps PDFfit2's (the X-ray atomic number, its own neutron table).`,
    ]),
    ``,
    `Where the two programs differ`,
    ...bullets([
      "Peak normalization — the one difference in the model. MATERIA gives each pair's Gaussian a factor 1/r_ij (the G(r) of an isotropic 3D Gaussian pair, its mirror term aside); PDFfit2 divides the sum of the Gaussians by r (a Gaussian radial distribution R(r), G = R/r). No setting reconciles them: each PDFfit2 peak leans toward low r by about σ²/r_ij. On MATERIA's GaTa4Se8 demo that is 1.2 % of the rms G(r), largest at low r, and a refined cell 75 ppm (3 esds) larger in PDFfit2; the other parameters agreed within their esds, and with PDFfit2's 1/r in MATERIA's model the two curves agree to 1e-6 of G(r).",
      `Qmax termination${model.qmax > 0 ? "" : " (not applied here: MATERIA applies none on this grid, and Qmax is 0)"}: MATERIA convolves the model with the exact sinc kernel on the data grid (a 6·2π/Qmax margin, the odd image below r = 0); PDFfit2 zeroes the Fourier components above Qmax of the curve over the fit range plus 6·2π/Qmax (an FFT, no odd image). On the demo a ripple of 0.07 % of the rms G(r) at the cutoff, which moves no peak.`,
      "PDFgui (B, C) fits the data resampled onto the fit range, so the Qmax ripple at the window's low end is computed without the points below it; the script reads the whole file and sets the window with pdfrange, as MATERIA computes it.",
      ...(model.qmaxIgnored !== undefined ? [`The data's Qmax (${pdffitNumber(model.qmaxIgnored)} Å⁻¹) is at or above the grid's Nyquist limit π/Δr, where the termination does nothing; MATERIA skips it, so the bundle sets Qmax 0.`] : []),
    ]),
  );
  const notes = [...model.notes];
  if (input.pattern.sourceKind === "sq" || input.pattern.sourceKind === "fq") notes.push(`The G(r) is MATERIA's sine transform of the ${input.pattern.sourceKind === "sq" ? "S(Q)" : "F(Q)"} you loaded; PDFgui and PDFfit2 take it as G(r).`);
  if (input.pattern.sourceKind === "fgr-diff") notes.push("The data are a PDFgui fit residual (the magnetic signal), not a total G(r): a nuclear PDFfit2 fit of it means nothing.");
  if (input.pattern.sourceKind === "fgr") notes.push("The data were rebuilt from a PDFgui fit file (G_obs = G_calc + G_diff).");
  if (input.pattern.radiationAssumed) notes.push("The original data file named no radiation; it was read as X-ray data. Check STYPE.");
  lines.push(``, `What does not carry over`);
  if (notes.length === 0) lines.push(`  Nothing else.`);
  lines.push(...bullets(notes));
  if (input.magnetic) {
    lines.push(
      ``,
      `Magnetic PDF`,
      ...wrap(`MATERIA's fit includes a magnetic (mPDF) term: ${input.magnetic.description}. PDFfit2 computes the nuclear G(r) only, so the script and PDFgui refine the nuclear model against data that still hold the magnetic signal, and their Rw cannot match MATERIA's; the model check compares with MATERIA's nuclear part. Reproduce the magnetic term in diffpy.mpdf (https://github.com/FrandsenGroup/diffpy.mpdf), on the nuclear fit's residual or co-refined with it in diffpy-CMI${r.mcif ? `, from the spin model in ${r.mcif}` : ""}. No mPDF script is written, because the parameters do not map one to one: diffpy.mpdf takes spin vectors S with g = 2, its own normalization (K1 = 2(γr₀/2)² by default) and a broadening from the atoms' U, while MATERIA refines moments m = gS with K1 = (2/3)(γr₀/2)², an ordered and a paramagnetic scale, a pair width and a correlation length. That mapping is to be set up by hand, not approximated.`, 92, "  ", "  "),
    );
  }
  lines.push(``);
  return lines.join("\n");
}

/** "Ga 30.9763, Ta 72.9537, Se 33.9885" from every phase. */
function scatteringList(model: PdffitModel): string {
  const all = new Map<string, number>();
  for (const ph of model.phases) for (const [el, v] of Object.entries(ph.scattering)) all.set(el, v);
  const unit = model.stype === "N" ? " fm" : "";
  return [...all].map(([el, v]) => `${el} ${fmt(v, 4)}${unit}`).join(", ");
}

const bullets = (items: readonly string[]): string[] => items.flatMap((t) => wrap(`- ${t}`, 92, "  ", "    "));

/** Word-wrap a paragraph for the README. */
function wrap(text: string, width: number, first: string, rest: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = first;
  let empty = true;
  for (const w of words) {
    if (!empty && line.length + 1 + w.length > width) {
      out.push(line);
      line = rest + w;
    } else {
      line = empty ? line + w : `${line} ${w}`;
    }
    empty = false;
  }
  if (!empty) out.push(line);
  return out;
}

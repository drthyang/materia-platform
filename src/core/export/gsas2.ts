/**
 * GSAS-II export pieces: the instrument-parameter file (`.instprm`) and the
 * `build_gpx.py` helper that assembles a real `.gpx` via GSASIIscriptable.
 *
 * A `.gpx` is a Python pickle of GSAS-II's internal data tree — impractical and
 * version-fragile to hand-write — so we emit the files GSAS-II *imports* (CIF
 * phase via the existing cif.ts, this `.instprm`, and data) plus a tiny script
 * that builds the `.gpx` with the official scriptable API. Script verified
 * against the GSASIIscriptable source (G2Project / add_phase /
 * add_powder_histogram / add_single_histogram / set_refinements 'Limits' and
 * 'Background' {type, refine, no. coeffs, coeffs} / save).
 *
 * The `.instprm` header warns "do not add/delete items!", so each instrument
 * Type emits exactly the key set GSAS-II expects (PXC / PNC / PNT), matching the
 * bundled instrument files. Pure string producers; saving/zipping are UI.
 *
 * Profile conventions (verified against GSASIImath getCWsig/getTOFsig/
 * getTOFbeta/getTOFalpha):
 *  - CW: σ² = U·tan²θ + V·tanθ + W (centideg², a Gaussian VARIANCE). MATERIA
 *    stores FWHM² (the instprm loader multiplies by 8 ln2), so U,V,W are divided
 *    by 8 ln2 on the way out. X, Y are FWHM in both (no conversion).
 *  - TOF: α = alpha/d; β = beta-0 + beta-1/d⁴ + beta-q/d²;
 *    σ² = sig-0 + sig-1·d² + sig-2·d⁴ + sig-q·d — the same terms MATERIA uses,
 *    so they map one-to-one. MATERIA's constant rise term α₀ has no GSAS-II
 *    counterpart (reported, not silently folded).
 */

import type { InstrumentParameters } from "@/core/diffraction/instrument";

const INSTPRM_HEADER = "#GSAS-II instrument parameter file; do not add/delete items!";

/** GSAS-II Gaussian variance σ² → MATERIA FWHM² (the instprm loader's factor). */
export const GSAS_SIG2_TO_FWHM2 = 8 * Math.log(2);

/** Instrument values keyed by their GSAS-II `.instprm` names (e.g. "U", "sig-1"). */
export type InstprmValues = Readonly<Record<string, number>>;

/** Serialize an instrument to a GSAS-II `.instprm`. `values` (GSAS-II keys,
 *  GSAS-II units — see {@link gsas2InstrumentValues}) override the defaults,
 *  e.g. with the refined profile. */
export function instrumentToInstprm(inst: InstrumentParameters, values: InstprmValues = {}): string {
  const rows: Array<[string, number | string]> =
    inst.kind === "tof" ? tofRows(inst) : cwRows(inst);
  const out = rows.map(([k, v]): [string, number | string] => [k, values[k] ?? v]);
  return [INSTPRM_HEADER, ...out.map(([k, v]) => `${k}:${v}`)].join("\n") + "\n";
}

function cwRows(inst: Extract<InstrumentParameters, { kind: "constantWavelength" }>): Array<[string, number | string]> {
  const xray = inst.radiationKind !== "neutron";
  // PXC (X-ray CW) and PNC (neutron CW) share the profile keys; PXC adds
  // Polariz. and Source. The model's U,V,W are FWHM² → back to GSAS-II σ².
  // A lab tube's doublet is Lam1, Lam2 and I(L2)/I(L1); a monochromatic beam is Lam.
  const k2 = xray ? inst.kAlpha2 : undefined;
  const rows: Array<[string, number | string]> = [
    ["Type", xray ? "PXC" : "PNC"],
    ["Bank", 1.0],
    ...(k2 ? [["Lam1", inst.wavelength], ["Lam2", k2.wavelength]] as Array<[string, number]> : [["Lam", inst.wavelength]] as Array<[string, number]>),
    ["Zero", inst.zero ?? 0],
  ];
  if (xray) rows.push(["Polariz.", inst.polarization ?? 0.5]);
  if (k2) rows.push(["I(L2)/I(L1)", k2.ratio]);
  rows.push(
    ["U", (inst.u ?? 0) / GSAS_SIG2_TO_FWHM2],
    ["V", (inst.v ?? 0) / GSAS_SIG2_TO_FWHM2],
    ["W", (inst.w ?? 0) / GSAS_SIG2_TO_FWHM2],
    ["X", inst.x ?? 0],
    ["Y", inst.y ?? 0],
    ["Z", 0],
    ["SH/L", 0.002],
    ["Azimuth", 0.0],
  );
  if (xray) rows.push(["Source", ""]);
  return rows;
}

function tofRows(inst: Extract<InstrumentParameters, { kind: "tof" }>): Array<[string, number | string]> {
  // PNT (neutron TOF): the full back-to-back-exponential + Gaussian σ key set
  // GSAS-II expects; the instrument's own calibration where it has one.
  // fltPath is derived from difC for a 90° bank (difC = 252.816·2 sinθ·L).
  const twoTheta = 90.0;
  const fltPath = inst.difC / (252.816 * 2 * Math.sin((twoTheta / 2) * (Math.PI / 180)));
  return [
    ["Type", "PNT"],
    ["Bank", 1.0],
    ["difC", inst.difC],
    ["difA", inst.difA ?? 0],
    ["difB", inst.difB ?? 0],
    ["Zero", inst.zero ?? 0],
    ["alpha", inst.alpha ?? 0],
    ["beta-0", inst.beta0 ?? 0],
    ["beta-1", inst.beta1 ?? 0],
    ["beta-q", inst.betaQ ?? 0],
    ["sig-0", inst.sig0 ?? 0],
    ["sig-1", inst.sig1 ?? 0],
    ["sig-2", inst.sig2 ?? 0],
    ["sig-q", inst.sigQ ?? 0],
    ["X", 0],
    ["Y", 0],
    ["Z", 0],
    ["2-theta", twoTheta],
    ["fltPath", Number(fltPath.toFixed(4))],
    ["Azimuth", 0.0],
  ];
}

/** The refined profile, in MATERIA's own conventions (what the fit used). */
export interface RefinedInstrumentProfile {
  /** Zero shift (2θ° CW, µs TOF). */
  readonly zero?: number;
  /** CW Caglioti FWHM² (centideg²). */
  readonly caglioti?: { readonly u: number; readonly v: number; readonly w: number };
  /** CW single Gaussian FWHM (degrees), when no Caglioti terms were used. */
  readonly peakWidth?: number;
  /** CW Lorentzian X (1/cosθ), Y (tanθ), centideg FWHM. */
  readonly lorentzian?: { readonly x: number; readonly y: number };
  /** CW FCJ axial divergence S/L, H/L. */
  readonly axial?: { readonly sl: number; readonly hl: number };
  /** TOF calibration. */
  readonly tof?: { readonly difC: number; readonly difA: number; readonly difB: number };
  /** TOF peak shape (σ² = sig0 + sig1·d² + sig2·d⁴ + sigQ·d; α = α₀ + α₁/d). */
  readonly tofProfile?: {
    readonly alpha0: number; readonly alpha1: number;
    readonly beta0: number; readonly beta1: number; readonly betaQ: number;
    readonly sig0: number; readonly sig1: number; readonly sig2: number; readonly sigQ: number;
    /** Lorentzian FWHM γ = gamX·d + gamY·d² + gamZ (µs; GSAS-II X, Y, Z), when the instrument file gives the profile. */
    readonly gamX?: number; readonly gamY?: number; readonly gamZ?: number;
  };
  /**
   * The sample's TOF broadening beside an instrument file's profile, as the
   * rows hold it: Gaussian microstrain (×10⁻⁶), Lorentzian microstrain (×10⁻⁶,
   * GSAS-II's Mustrain) and size (µm, GSAS-II's Size; absent: no size term).
   */
  readonly tofSample?: { readonly gauss: number; readonly lorentz: number; readonly size?: number };
  /** The program whose function the instrument file's profile was evaluated with. */
  readonly tofLorentzForm?: "gsas" | "fullprof";
}

/** GSAS-II's sample parameters for a phase on a TOF histogram (GSASIIstrMath.GetSampleSigGam). */
export interface Gsas2SampleTerms {
  /** Mustrain (×10⁻⁶): FWHM 10⁻⁶·difC·d·Mustrain, its fraction `mustrainMix` Lorentzian and the rest Gaussian. */
  readonly mustrain: number;
  readonly mustrainMix: number;
  /** Size (µm), Lorentzian: FWHM 10⁻⁴·difC·d²/Size. */
  readonly size: number;
}

/** A size GSAS-II takes as none: its width 10⁻⁴·difC·d²/Size is below 10⁻⁶ of any peak's. */
const GSAS2_NO_SIZE = 1e6;

/**
 * The sample rows as GSAS-II's one Mustrain with a mixing coefficient and its
 * Size. GSAS-II's microstrain width is W = 10⁻⁶·difC·d·Mustrain, of which the
 * fraction mx is a Lorentzian FWHM and (1 − mx) a Gaussian FWHM, so a
 * Lorentzian row M_L and a Gaussian row m_G (σ = 10⁻⁶·difC·d·m_G, FWHM
 * 2√(2 ln 2)·σ) are Mustrain = M_L + 2.3548·m_G with mx = M_L/Mustrain. Exact
 * when difA = difB = 0 (GSAS-II's sample terms use difC alone).
 */
export function gsas2SampleTerms(sample: NonNullable<RefinedInstrumentProfile["tofSample"]>): Gsas2SampleTerms {
  const gaussianFwhm = 2 * Math.sqrt(2 * Math.LN2) * Math.max(sample.gauss, 0);
  const mustrain = Math.max(sample.lorentz, 0) + gaussianFwhm;
  return {
    mustrain,
    mustrainMix: mustrain > 0 ? Math.max(sample.lorentz, 0) / mustrain : 1,
    size: sample.size !== undefined && sample.size > 0 ? sample.size : GSAS2_NO_SIZE,
  };
}

/**
 * Map the refined profile onto GSAS-II `.instprm` keys/units. Returns the values
 * plus notes for terms GSAS-II cannot express (so the README can say so instead
 * of silently changing the model).
 */
export function gsas2InstrumentValues(kind: "cw" | "tof", p: RefinedInstrumentProfile): { values: Record<string, number>; notes: string[] } {
  const values: Record<string, number> = {};
  const notes: string[] = [];
  if (p.zero !== undefined) values.Zero = p.zero;
  if (kind === "cw") {
    if (p.caglioti) {
      values.U = p.caglioti.u / GSAS_SIG2_TO_FWHM2;
      values.V = p.caglioti.v / GSAS_SIG2_TO_FWHM2;
      values.W = p.caglioti.w / GSAS_SIG2_TO_FWHM2;
    } else if (p.peakWidth !== undefined) {
      // A constant FWHM (degrees) → W alone, in centideg² variance.
      values.U = 0;
      values.V = 0;
      values.W = (p.peakWidth * 100) ** 2 / GSAS_SIG2_TO_FWHM2;
    }
    if (p.lorentzian) {
      values.X = p.lorentzian.x;
      values.Y = p.lorentzian.y;
      values.Z = 0;
    }
    if (p.axial) values["SH/L"] = Math.max(p.axial.sl + p.axial.hl, 0.002);
    return { values, notes };
  }
  if (p.tof) {
    values.difC = p.tof.difC;
    values.difA = p.tof.difA;
    values.difB = p.tof.difB;
  }
  const t = p.tofProfile;
  if (t) {
    values.alpha = t.alpha1;
    values["beta-0"] = t.beta0;
    values["beta-1"] = t.beta1;
    values["beta-q"] = t.betaQ;
    values["sig-0"] = t.sig0;
    values["sig-1"] = t.sig1;
    values["sig-2"] = t.sig2;
    values["sig-q"] = t.sigQ;
    // The Lorentzian widths of an instrument file's profile; the app's own refinable TOF profile has none.
    values.X = t.gamX ?? 0;
    values.Y = t.gamY ?? 0;
    values.Z = t.gamZ ?? 0;
    if (t.alpha0 !== 0) notes.push(`α₀ = ${t.alpha0} (constant rise-time term) has no GSAS-II key (GSAS-II α = alpha/d); omitted.`);
    if (p.tofLorentzForm === "fullprof") {
      notes.push("This fit used a FullProf resolution file, evaluated with FullProf's time-of-flight function. Its widths are written as GSAS-II's sig-0, sig-1, sig-2 and X, Y, Z (Gam-1, Gam-2, Gam-0), which mean the same; GSAS-II's function for the Lorentzian part is its own, so the peak is a starting point in GSAS-II, not the same peak: refine the profile there against a standard.");
    }
  }
  return { values, notes };
}

/**
 * Patch values into an existing `.instprm`, keeping every other line (and the
 * key order) verbatim. Only single-bank files are patched — a multi-bank file
 * returns `undefined` so the caller ships it untouched.
 */
export function patchInstprm(text: string, values: InstprmValues): string | undefined {
  const lines = text.split(/\r?\n/);
  const banks = lines.filter((l) => /^\s*Type\s*:/i.test(l)).length;
  if (banks !== 1 || lines.some((l) => /^\s*#\s*Bank\s*\d/i.test(l))) return undefined;
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_./-]+)(\s*:\s*)(.*)$/);
    if (!m || line.trim().startsWith("#")) return line;
    const key = m[2]!;
    const v = values[key];
    if (v === undefined) return line;
    return `${m[1]}${key}${m[3]}${v}`;
  });
  return out.join("\n");
}

export interface GpxScriptOptions {
  /** Output project filename, e.g. "MnO.gpx". */
  readonly gpxName: string;
  /** CIF phase file in the bundle (the main phase). */
  readonly cifFile: string;
  /** Phase name for GSAS-II. */
  readonly phaseName: string;
  /** Further phases (multi-phase fit): CIF file + phase name each. */
  readonly extraPhases?: readonly { readonly cifFile: string; readonly phaseName: string }[];
  /** Data file in the bundle. */
  readonly dataFile: string;
  /** `.instprm` file (powder only). */
  readonly instprmFile?: string;
  /** Powder or single-crystal histogram. */
  readonly histogramKind: "powder" | "single";
  /** Optional importer format hint for the data file (else GSAS-II auto-detects). */
  readonly dataFmthint?: string;
  /** Powder fit limits [low, high] in the data unit (2θ° or TOF µs). */
  readonly limits?: readonly [number, number];
  /** Powder background as GSAS-II "lin interpolate" values (evenly spaced
   *  across the fitted data, first to last point). */
  readonly background?: readonly number[];
  /** The sample's TOF broadening, set on every phase for this histogram. */
  readonly sample?: Gsas2SampleTerms;
  /** March–Dollase preferred orientation per phase, in phase order (main phase
   *  first, then `extraPhases`); an absent entry leaves GSAS-II's default (none). */
  readonly preferredOrientation?: readonly (Gsas2MarchDollase | undefined)[];
}

/**
 * A phase's March–Dollase texture as GSAS-II holds it: the HAP entry
 * 'Pref.Ori.' = ['MD', ratio, refine, [h, k, l], …] (GSASIIstrIO reads MD from
 * [1] and MDAxis from [3]). GSASIIstrMath.GetPrefOri averages
 * (MD²·cos²α + sin²α/MD)^(−3/2) over the Laue equivalents, α measured between
 * reciprocal vectors with the reciprocal metric — MATERIA's marchDollaseFamily.
 */
export interface Gsas2MarchDollase {
  /** The axis as reciprocal-lattice indices (h, k, l). */
  readonly axis: readonly [number, number, number];
  /** The March coefficient (1 = no texture). */
  readonly ratio: number;
}

/** Python float literal (finite, compact). */
function py(x: number): string {
  return Number.isFinite(x) ? String(Number(x.toPrecision(10))) : "0.0";
}

/**
 * Generate a `build_gpx.py` that assembles a `.gpx` from the bundle files via
 * GSASIIscriptable. Signatures verified against the GSAS-II source.
 */
export function buildGpxScript(opts: GpxScriptOptions): string {
  const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  const hint = opts.dataFmthint ? `, fmthint=${q(opts.dataFmthint)}` : "";
  const lines: string[] = [
    "#!/usr/bin/env python",
    '"""Assemble a GSAS-II project (.gpx) from this bundle.',
    "",
    "Requires GSAS-II installed (https://gsas-ii.readthedocs.io).",
    "Run from this folder:  python build_gpx.py",
    "Generated by MATERIA Workbench.",
    '"""',
    "try:",
    "    from GSASII import GSASIIscriptable as G2sc",
    "except ImportError:  # older installs expose it on the path directly",
    "    try:",
    "        import GSASIIscriptable as G2sc",
    "    except ImportError:",
    "        # Legacy gsas2full installs keep the code in a flat directory that",
    "        # is never added to sys.path; probe the usual spots before failing.",
    "        import os",
    "        import sys",
    "        _home = os.path.expanduser('~')",
    "        _env = os.environ.get('GSASII_HOME')",
    "        _candidates = (",
    "            [_env, os.path.join(_env, 'GSASII'), os.path.join(_env, 'GSAS-II')]",
    "            if _env else []",
    "        ) + [",
    "            os.path.join(_home, 'gsas2full', 'GSASII'),",
    "            os.path.join(_home, 'g2full', 'GSAS-II'),",
    "            os.path.join(_home, 'gsas2main', 'GSAS-II'),",
    "        ]",
    "        for _dir in _candidates:",
    "            if os.path.isfile(os.path.join(_dir, 'GSASIIscriptable.py')):",
    "                sys.path.insert(0, _dir)",
    "                break",
    "        else:",
    "            raise ImportError(",
    "                'GSAS-II not found; install it or set GSASII_HOME to the '",
    "                'directory containing GSASIIscriptable.py')",
    "        import GSASIIscriptable as G2sc",
    "",
    `gpx = G2sc.G2Project(newgpx=${q(opts.gpxName)})`,
    `phase = gpx.add_phase(${q(opts.cifFile)}, phasename=${q(opts.phaseName)}, fmthint='CIF')`,
  ];
  const extras = opts.extraPhases ?? [];
  extras.forEach((ph, i) => {
    lines.push(`phase${i + 2} = gpx.add_phase(${q(ph.cifFile)}, phasename=${q(ph.phaseName)}, fmthint='CIF')`);
  });
  const phaseVarList = ["phase", ...extras.map((_, i) => `phase${i + 2}`)];
  const phaseVars = phaseVarList.join(", ");
  if (opts.histogramKind === "single") {
    lines.push(`hist = gpx.add_single_histogram(${q(opts.dataFile)}, phase=phase${hint})`);
  } else {
    const iparams = opts.instprmFile ? `, ${q(opts.instprmFile)}` : "";
    lines.push(`hist = gpx.add_powder_histogram(${q(opts.dataFile)}${iparams}, phases=[${phaseVars}]${hint})`);
    if (opts.limits) {
      lines.push("", "# The fit range used in MATERIA.");
      lines.push(`hist.set_refinements({'Limits': [${py(opts.limits[0])}, ${py(opts.limits[1])}]})`);
    }
    if (opts.background && opts.background.length >= 3) {
      const coeffs = opts.background.map(py).join(", ");
      lines.push(
        "",
        "# MATERIA's refined background, sampled as GSAS-II 'lin interpolate' points",
        "# (evenly spaced from the first to the last fitted point); not refined yet.",
        "hist.set_refinements({'Background': {",
        "    'type': 'lin interpolate', 'refine': False,",
        `    'no. coeffs': ${opts.background.length},`,
        `    'coeffs': [${coeffs}],`,
        "}})",
      );
    }
  }
  if (opts.histogramKind !== "single" && opts.sample) {
    const s = opts.sample;
    lines.push(
      "",
      "# The sample's broadening as MATERIA used it, in GSAS-II's own parameters: Mustrain (x 1e-6) with its",
      "# Lorentzian fraction, and Size (um, Lorentzian). GSAS-II adds these to the instrument's widths.",
      `for _phase in (${phaseVars},):`,
      "    _hap = _phase.data['Histograms'][hist.name]",
      `    _hap['Mustrain'][0] = 'isotropic'`,
      `    _hap['Mustrain'][1][0] = _hap['Mustrain'][1][1] = ${py(s.mustrain)}`,
      `    _hap['Mustrain'][1][2] = ${py(s.mustrainMix)}`,
      `    _hap['Size'][0] = 'isotropic'`,
      `    _hap['Size'][1][0] = _hap['Size'][1][1] = ${py(s.size)}`,
      "    _hap['Size'][1][2] = 1.0",
    );
  }
  const poLines = opts.histogramKind === "single" ? [] : (opts.preferredOrientation ?? []).flatMap((po, i) => {
    const v = phaseVarList[i];
    if (!po || v === undefined) return [];
    const axis = po.axis.map((x) => (Number.isInteger(x) ? String(x) : py(x))).join(", ");
    return [
      `_po = ${v}.data['Histograms'][hist.name]['Pref.Ori.']`,
      `_po[0], _po[1], _po[2], _po[3] = 'MD', ${py(po.ratio)}, False, [${axis}]`,
    ];
  });
  if (poLines.length) {
    lines.push(
      "",
      "# MATERIA's refined March-Dollase preferred orientation: the ratio (1 = none) on an axis given as",
      "# reciprocal-lattice indices [h, k, l], as GSAS-II's 'MD' model holds it; not refined yet.",
      ...poLines,
    );
  }
  lines.push("", "gpx.save()", `print('Wrote ${opts.gpxName}')`);
  return lines.join("\n") + "\n";
}

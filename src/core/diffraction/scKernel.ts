/**
 * The single-crystal structure-factor kernel: F(hkl) for a fixed list of
 * reflections and, in the same pass, ∂F/∂p for the structural parameters a
 * refinement frees (position modes, U-tensor modes, B_iso, occupancy).
 *
 *   F(h) = Σ_sites occ·a(s)·Σ_orbit T·exp(2πi(h′·x + h·t)),   h′ = Rᵀh
 *
 * A single-crystal fit keeps the cell fixed, so everything that depends on the
 * reflections alone is computed once (`scPlan`): s² and each element's
 * scattering amplitude per reflection. The anisotropic factor of an orbit image
 * is read with the rotated index, exp(−2π² Σ U^ij h′_i h′_j a*_i a*_j), so the
 * tensor is never rotated. The derivatives come from the same sums:
 *
 *   ∂F/∂Δ (shift along v)   = occ·a·T_iso·2πi·Σ e·(h′·v)
 *   ∂F/∂c (U mode, basis b) = −2π²·occ·a·Σ e·Σ_k b_k·w_k(h′)
 *   ∂F/∂B                   = −s²·F_site,     ∂F/∂occ = F_site/occ
 *
 * with e = T·exp(iφ) per image. It reproduces `nuclearStructureFactor` to
 * round-off; one call with every derivative costs about two plain ones.
 */

import type { StructureModel } from "@/core/crystal/types";
import type { Radiation } from "@/core/diffraction/types";
import type { ScatteringTable } from "@/core/scattering/types";
import { distinctSiteOps } from "@/core/diffraction/structureFactor";
import { dSpacing, reciprocalMetricTensor } from "@/core/crystal/unitCell";
import { neutronTable } from "@/core/scattering/neutron";
import { xrayTable } from "@/core/scattering/xray";
import { anomalousScattering, dispersionLine } from "@/core/scattering/dispersion";

const TWO_PI = 2 * Math.PI;
const TWO_PI_SQ = 2 * Math.PI * Math.PI;

/** What does not change while a single-crystal model refines: the reflections, s², and each element's amplitude per reflection. */
export interface ScPlan {
  readonly n: number;
  readonly h: Int32Array;
  readonly k: Int32Array;
  readonly l: Int32Array;
  readonly s2: Float64Array;
  /** a*, b*, c* of the (fixed) cell. */
  readonly as: number;
  readonly bs: number;
  readonly cs: number;
  /** Scattering amplitude per reflection, by element (and isotope). */
  readonly amp: ReadonlyMap<string, { readonly re: Float64Array; readonly im: Float64Array }>;
  /** The line whose f′ and f″ the X-ray amplitudes carry (dispersion.ts); absent: none (neutrons, or no tabulated line). */
  readonly dispersion?: string;
}

const ampKey = (element: string, isotope?: number): string => (isotope !== undefined ? `${element}#${isotope}` : element);

/** The plan for a structure's sites and cell and a list of reflections. */
export function scPlan(model: StructureModel, radiation: Radiation, reflections: readonly { readonly h: number; readonly k: number; readonly l: number }[]): ScPlan {
  const table: ScatteringTable = radiation.kind === "xray" ? xrayTable : neutronTable;
  const n = reflections.length;
  const h = new Int32Array(n);
  const k = new Int32Array(n);
  const l = new Int32Array(n);
  const s2 = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = reflections[i]!;
    h[i] = r.h;
    k[i] = r.k;
    l[i] = r.l;
    const d = dSpacing(model.cell, r.h, r.k, r.l);
    s[i] = d === Infinity ? 0 : 1 / (2 * d);
    s2[i] = s[i]! * s[i]!;
  }
  // X-rays at a laboratory line: each element's f′ + i·f″ on its form factor.
  const line = radiation.kind === "xray" ? dispersionLine(radiation.wavelength) : null;
  const amp = new Map<string, { re: Float64Array; im: Float64Array }>();
  for (const site of model.sites) {
    const key = ampKey(site.element, site.isotope);
    if (amp.has(key)) continue;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const extra = line ? anomalousScattering(site.element, line) : { fp: 0, fpp: 0 };
    for (let i = 0; i < n; i++) {
      const a = table.amplitude(site.element, s[i]!, site.isotope);
      re[i] = a.re + extra.fp;
      im[i] = a.im + extra.fpp;
    }
    amp.set(key, { re, im });
  }
  const g = reciprocalMetricTensor(model.cell);
  return { n, h, k, l, s2, as: Math.sqrt(g[0][0]), bs: Math.sqrt(g[1][1]), cs: Math.sqrt(g[2][2]), amp, ...(line ? { dispersion: line.name } : {}) };
}

/** One derivative the kernel returns: of F with respect to a structural parameter acting on one site, times `scale` (1 when absent). */
export type ScDerivative = (
  | { readonly kind: "position"; readonly site: number; readonly axis: readonly [number, number, number] }
  | { readonly kind: "uMode"; readonly site: number; readonly basis: readonly [number, number, number, number, number, number] }
  | { readonly kind: "bIso"; readonly site: number }
  | { readonly kind: "occupancy"; readonly site: number }
) & { readonly scale?: number };

export interface ScKernelResult {
  /** F per reflection. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** ∂F/∂p per requested derivative, per reflection. */
  readonly dRe: readonly Float64Array[];
  readonly dIm: readonly Float64Array[];
}

/**
 * F for every reflection of the plan at the model's current positions, ADPs
 * and occupancies, and ∂F for each requested derivative. The model's sites are
 * the plan's (same order and elements); only their values move.
 */
export function scStructureFactors(plan: ScPlan, model: StructureModel, derivatives: readonly ScDerivative[] = []): ScKernelResult {
  const { n, as, bs, cs } = plan;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const dRe = derivatives.map(() => new Float64Array(n));
  const dIm = derivatives.map(() => new Float64Array(n));
  const ops = model.spaceGroup.operations;
  const sites = model.sites;
  // Per site: its orbit's operations (flattened), what is asked of it, and its scalars.
  const perSite = sites.map((site, j) => {
    const orbit = distinctSiteOps(ops, site.position);
    const rot = new Float64Array(orbit.length * 9);
    const tr = new Float64Array(orbit.length * 3);
    orbit.forEach((op, o) => {
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) rot[o * 9 + a * 3 + b] = op.rotation[a]![b]!;
        tr[o * 3 + a] = op.translation[a]!;
      }
    });
    const asked = derivatives.map((d, r) => [d, r] as const).filter(([d]) => d.site === j);
    const aniso = site.adp.kind === "anisotropic" ? site.adp.uAniso : null;
    return {
      nOps: orbit.length, rot, tr,
      x: site.position[0], y: site.position[1], z: site.position[2],
      occ: site.occupancy,
      b: site.adp.kind === "isotropic" ? site.adp.bIso : 0,
      u: aniso,
      amp: plan.amp.get(ampKey(site.element, site.isotope))!,
      asked,
      needPos: asked.some(([d]) => d.kind === "position"),
      needU: asked.some(([d]) => d.kind === "uMode"),
    };
  });
  // Per-site sums for the current reflection: Σe, Σe·h′ (3), Σe·w(h′) (6), each complex.
  const sh = new Float64Array(6);
  const sw = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    const h = plan.h[i]!;
    const k = plan.k[i]!;
    const l = plan.l[i]!;
    const s2 = plan.s2[i]!;
    let fRe = 0;
    let fIm = 0;
    for (const site of perSite) {
      let s0Re = 0;
      let s0Im = 0;
      if (site.needPos) sh.fill(0);
      if (site.needU) sw.fill(0);
      const u = site.u;
      for (let o = 0; o < site.nOps; o++) {
        const R = site.rot;
        const b9 = o * 9;
        // h′ = Rᵀh, and h·t.
        const hp = R[b9]! * h + R[b9 + 3]! * k + R[b9 + 6]! * l;
        const kp = R[b9 + 1]! * h + R[b9 + 4]! * k + R[b9 + 7]! * l;
        const lp = R[b9 + 2]! * h + R[b9 + 5]! * k + R[b9 + 8]! * l;
        const ht = h * site.tr[o * 3]! + k * site.tr[o * 3 + 1]! + l * site.tr[o * 3 + 2]!;
        const phase = TWO_PI * (hp * site.x + kp * site.y + lp * site.z + ht);
        let t = 1;
        let w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0;
        if (u) {
          w0 = hp * hp * as * as;
          w1 = kp * kp * bs * bs;
          w2 = lp * lp * cs * cs;
          w3 = 2 * hp * kp * as * bs;
          w4 = 2 * hp * lp * as * cs;
          w5 = 2 * kp * lp * bs * cs;
          t = Math.exp(-TWO_PI_SQ * (u[0] * w0 + u[1] * w1 + u[2] * w2 + u[3] * w3 + u[4] * w4 + u[5] * w5));
        }
        const eRe = t * Math.cos(phase);
        const eIm = t * Math.sin(phase);
        s0Re += eRe;
        s0Im += eIm;
        if (site.needPos) {
          sh[0]! += eRe * hp; sh[1]! += eIm * hp;
          sh[2]! += eRe * kp; sh[3]! += eIm * kp;
          sh[4]! += eRe * lp; sh[5]! += eIm * lp;
        }
        if (site.needU) {
          sw[0]! += eRe * w0; sw[1]! += eIm * w0;
          sw[2]! += eRe * w1; sw[3]! += eIm * w1;
          sw[4]! += eRe * w2; sw[5]! += eIm * w2;
          sw[6]! += eRe * w3; sw[7]! += eIm * w3;
          sw[8]! += eRe * w4; sw[9]! += eIm * w4;
          sw[10]! += eRe * w5; sw[11]! += eIm * w5;
        }
      }
      // q = occ·a·T_iso: the site's prefactor (complex amplitude).
      const tIso = u ? 1 : Math.exp(-site.b * s2);
      const qRe = site.occ * site.amp.re[i]! * tIso;
      const qIm = site.occ * site.amp.im[i]! * tIso;
      const siteRe = qRe * s0Re - qIm * s0Im;
      const siteIm = qRe * s0Im + qIm * s0Re;
      fRe += siteRe;
      fIm += siteIm;
      for (const [d, r] of site.asked) {
        let dr: number;
        let di: number;
        if (d.kind === "position") {
          // Σe·(h′·v), times 2πi, times q.
          const vRe = sh[0]! * d.axis[0] + sh[2]! * d.axis[1] + sh[4]! * d.axis[2];
          const vIm = sh[1]! * d.axis[0] + sh[3]! * d.axis[1] + sh[5]! * d.axis[2];
          // 2πi·(vRe + i·vIm) = 2π(−vIm + i·vRe)
          const gRe = -TWO_PI * vIm;
          const gIm = TWO_PI * vRe;
          dr = qRe * gRe - qIm * gIm;
          di = qRe * gIm + qIm * gRe;
        } else if (d.kind === "uMode") {
          if (!u) continue;
          const b = d.basis;
          const gRe = -TWO_PI_SQ * (sw[0]! * b[0] + sw[2]! * b[1] + sw[4]! * b[2] + sw[6]! * b[3] + sw[8]! * b[4] + sw[10]! * b[5]);
          const gIm = -TWO_PI_SQ * (sw[1]! * b[0] + sw[3]! * b[1] + sw[5]! * b[2] + sw[7]! * b[3] + sw[9]! * b[4] + sw[11]! * b[5]);
          dr = qRe * gRe - qIm * gIm;
          di = qRe * gIm + qIm * gRe;
        } else if (d.kind === "bIso") {
          if (u) continue;
          dr = -s2 * siteRe;
          di = -s2 * siteIm;
        } else {
          // ∂/∂occ: the site's sum without the occupancy.
          const aRe = site.amp.re[i]! * tIso;
          const aIm = site.amp.im[i]! * tIso;
          dr = aRe * s0Re - aIm * s0Im;
          di = aRe * s0Im + aIm * s0Re;
        }
        const f = d.scale ?? 1;
        dRe[r]![i] = f * dr;
        dIm[r]![i] = f * di;
      }
    }
    re[i] = fRe;
    im[i] = fIm;
  }
  return { re, im, dRe, dIm };
}

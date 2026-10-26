/**
 * Small dense complex square matrices (complex Float64) for representation
 * matrices: products, adjoints, traces, determinants, and snapping entries
 * to exact roots of unity. Sizes here are a dozen at most.
 */

import type { Complex } from "@/core/math/types";

/** An n×n complex matrix, row-major. */
export interface CMat {
  readonly n: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
}

export const czeros = (n: number): CMat => ({ n, re: new Float64Array(n * n), im: new Float64Array(n * n) });

export function cidentity(n: number): CMat {
  const m = czeros(n);
  for (let i = 0; i < n; i++) m.re[i * n + i] = 1;
  return m;
}

export function cscalar(z: Complex): CMat {
  const m = czeros(1);
  m.re[0] = z.re;
  m.im[0] = z.im;
  return m;
}

export const cget = (a: CMat, i: number, j: number): Complex => ({ re: a.re[i * a.n + j]!, im: a.im[i * a.n + j]! });

export function cmul(a: CMat, b: CMat): CMat {
  const n = a.n;
  if (b.n !== n) throw new Error("cmul: size mismatch");
  const out = czeros(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const ar = a.re[i * n + k]!;
      const ai = a.im[i * n + k]!;
      if (ar === 0 && ai === 0) continue;
      for (let j = 0; j < n; j++) {
        const br = b.re[k * n + j]!;
        const bi = b.im[k * n + j]!;
        out.re[i * n + j] = out.re[i * n + j]! + ar * br - ai * bi;
        out.im[i * n + j] = out.im[i * n + j]! + ar * bi + ai * br;
      }
    }
  }
  return out;
}

export function cadd(a: CMat, b: CMat): CMat {
  const out = czeros(a.n);
  for (let i = 0; i < a.re.length; i++) {
    out.re[i] = a.re[i]! + b.re[i]!;
    out.im[i] = a.im[i]! + b.im[i]!;
  }
  return out;
}

/** z·A for a complex scalar z. */
export function cscale(a: CMat, z: Complex): CMat {
  const out = czeros(a.n);
  for (let i = 0; i < a.re.length; i++) {
    out.re[i] = a.re[i]! * z.re - a.im[i]! * z.im;
    out.im[i] = a.re[i]! * z.im + a.im[i]! * z.re;
  }
  return out;
}

export function cconj(a: CMat): CMat {
  return { n: a.n, re: Float64Array.from(a.re), im: a.im.map((x) => -x) };
}

/** The conjugate transpose A†. */
export function cadjoint(a: CMat): CMat {
  const n = a.n;
  const out = czeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.re[j * n + i] = a.re[i * n + j]!;
      out.im[j * n + i] = -a.im[i * n + j]!;
    }
  }
  return out;
}

export function ctrace(a: CMat): Complex {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.n; i++) {
    re += a.re[i * a.n + i]!;
    im += a.im[i * a.n + i]!;
  }
  return { re, im };
}

/** The determinant, by LU decomposition with partial pivoting. */
export function cdet(a: CMat): Complex {
  const n = a.n;
  const re = Float64Array.from(a.re);
  const im = Float64Array.from(a.im);
  let dr = 1;
  let di = 0;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.hypot(re[r * n + c]!, im[r * n + c]!) > Math.hypot(re[p * n + c]!, im[p * n + c]!)) p = r;
    const pr = re[p * n + c]!;
    const pi = im[p * n + c]!;
    if (Math.hypot(pr, pi) < 1e-300) return { re: 0, im: 0 };
    if (p !== c) {
      for (let j = 0; j < n; j++) {
        [re[p * n + j], re[c * n + j]] = [re[c * n + j]!, re[p * n + j]!];
        [im[p * n + j], im[c * n + j]] = [im[c * n + j]!, im[p * n + j]!];
      }
      dr = -dr;
      di = -di;
    }
    [dr, di] = [dr * pr - di * pi, dr * pi + di * pr];
    const den = pr * pr + pi * pi;
    for (let r = c + 1; r < n; r++) {
      // f = a[r][c] / pivot
      const ar = re[r * n + c]!;
      const ai = im[r * n + c]!;
      const fr = (ar * pr + ai * pi) / den;
      const fi = (ai * pr - ar * pi) / den;
      for (let j = c; j < n; j++) {
        const br = re[c * n + j]!;
        const bi = im[c * n + j]!;
        re[r * n + j] = re[r * n + j]! - (fr * br - fi * bi);
        im[r * n + j] = im[r * n + j]! - (fr * bi + fi * br);
      }
    }
  }
  return { re: dr, im: di };
}

/** The largest entry modulus of A − B. */
export function cmaxDiff(a: CMat, b: CMat): number {
  let m = 0;
  for (let i = 0; i < a.re.length; i++) m = Math.max(m, Math.hypot(a.re[i]! - b.re[i]!, a.im[i]! - b.im[i]!));
  return m;
}

/** The largest entry modulus. */
export function cmaxAbs(a: CMat): number {
  let m = 0;
  for (let i = 0; i < a.re.length; i++) m = Math.max(m, Math.hypot(a.re[i]!, a.im[i]!));
  return m;
}

/** Copy `block` into `target` with its top-left corner at (i0, j0). */
export function csetBlock(target: CMat, i0: number, j0: number, block: CMat): void {
  for (let i = 0; i < block.n; i++) {
    for (let j = 0; j < block.n; j++) {
      target.re[(i0 + i) * target.n + j0 + j] = block.re[i * block.n + j]!;
      target.im[(i0 + i) * target.n + j0 + j] = block.im[i * block.n + j]!;
    }
  }
}

export const cmulC = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export function cdivC(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** The principal p-th root of z (z^{1/p}, the branch of the principal argument). */
export function cpow(z: Complex, p: number): Complex {
  const r = Math.hypot(z.re, z.im);
  const t = Math.atan2(z.im, z.re);
  const m = r ** p;
  return { re: m * Math.cos(t * p), im: m * Math.sin(t * p) };
}

/** The n-th root of z with the smallest angle (spgrep's nroot). */
export function nroot(z: Complex, n: number): Complex {
  const root = cpow(z, 1 / n);
  const r = Math.hypot(root.re, root.im);
  let angle = Math.atan2(root.im, root.re);
  angle -= Math.round((angle * n) / (2 * Math.PI)) * ((2 * Math.PI) / n);
  return { re: r * Math.cos(angle), im: r * Math.sin(angle) };
}

const ROOTS_24: readonly Complex[] = Array.from({ length: 24 }, (_, m) => ({ re: Math.cos((2 * Math.PI * m) / 24), im: Math.sin((2 * Math.PI * m) / 24) }));

/** Snap every entry within `tol` of 0 or of a 24th root of unity to it exactly (in place). */
export function csnap(a: CMat, tol = 1e-9): CMat {
  for (let i = 0; i < a.re.length; i++) {
    const x = a.re[i]!;
    const y = a.im[i]!;
    if (Math.hypot(x, y) < tol) {
      a.re[i] = 0;
      a.im[i] = 0;
      continue;
    }
    for (const z of ROOTS_24) {
      if (Math.hypot(x - z.re, y - z.im) < tol) {
        a.re[i] = Math.abs(z.re) < 1e-15 ? 0 : z.re;
        a.im[i] = Math.abs(z.im) < 1e-15 ? 0 : z.im;
        break;
      }
    }
  }
  return a;
}

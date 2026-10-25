/**
 * Real-space atom-pair enumeration for the PDF forward model.
 *
 * For each atom in the unit cell, list every neighbouring atom (over periodic
 * images) within `rMax`, returning the pair distance and the UNCORRELATED
 * mean-square displacement projected onto the bond direction — the ingredients
 * of each PDF peak (position and width). This generalizes `crystal/geometry.ts`
 * `bondLengths`, which dedups near-equal bonds and tiles only ±1 cell and so
 * must NOT be reused for a pair sum (PDF_MPDF_ROADMAP §2).
 *
 * The anisotropic ADP is projected via the Cartesian displacement tensor
 * `U_cart = M · (Ñ U Ñ) · Mᵀ` (M = orthogonalization matrix, Ñ = diag(a*,b*,c*),
 * U = CIF U^{ij}); the along-bond variance is then `n̂ᵀ(U_cart,i + U_cart,j)n̂`.
 * Isotropic sites use `U_cart = u_iso·I` exactly (no tensor conversion needed).
 */

import type { Mat3, Vec3 } from "@/core/math/types";
import type { UnitCell, DisplacementParameters } from "@/core/crystal/types";
import type { ExpandedAtom } from "@/core/diffraction/structureFactor";
import { orthogonalizationMatrix, reciprocalMetricTensor, fractionalToCartesian } from "@/core/crystal/unitCell";
import { mulVec, mulMat, transpose } from "@/core/math/mat3";
import { uIsoFromBIso } from "@/core/crystal/adp";

/** One ordered atom pair (origin i, neighbour image j) within `rMax`. */
export interface PdfPair {
  /** Interatomic distance r_ij (Å). */
  readonly rij: number;
  /** Index of the origin atom in the input list (for its scattering weight). */
  readonly i: number;
  /** Index of the neighbour atom in the input list. */
  readonly j: number;
  /** Uncorrelated along-bond mean-square displacement σ′² = n̂ᵀ(U_i+U_j)n̂ (Å²). */
  readonly msd: number;
  /** Cartesian bond unit vector n̂ = (cart_j + T − cart_i)/r_ij, components
   *  stored flat (non-optional keeps the pair objects monomorphic). Needed by
   *  the analytic-gradient pass (pdf/gradients.ts): d r/d(position) = n̂·Δu and
   *  the ADP projection derivative both live along the bond. */
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
}

/** Cartesian atomic displacement tensor U_cart (Å²) from a CIF ADP. */
export function cartesianAdpTensor(cell: UnitCell, adp: DisplacementParameters): Mat3 {
  if (adp.kind === "isotropic") {
    const u = uIsoFromBIso(adp.bIso);
    return [
      [u, 0, 0],
      [0, u, 0],
      [0, 0, u],
    ];
  }
  const [u11, u22, u33, u12, u13, u23] = adp.uAniso;
  const gStar = reciprocalMetricTensor(cell);
  const na = Math.sqrt(Math.max(gStar[0][0], 0));
  const nb = Math.sqrt(Math.max(gStar[1][1], 0));
  const nc = Math.sqrt(Math.max(gStar[2][2], 0));
  const n = [na, nb, nc] as const;
  const U: Mat3 = [
    [u11, u12, u13],
    [u12, u22, u23],
    [u13, u23, u33],
  ];
  // Ñ U Ñ : scale entry (i,j) by n_i n_j.
  const nUn: Mat3 = [
    [n[0] * n[0] * U[0][0], n[0] * n[1] * U[0][1], n[0] * n[2] * U[0][2]],
    [n[1] * n[0] * U[1][0], n[1] * n[1] * U[1][1], n[1] * n[2] * U[1][2]],
    [n[2] * n[0] * U[2][0], n[2] * n[1] * U[2][1], n[2] * n[2] * U[2][2]],
  ];
  const M = orthogonalizationMatrix(cell);
  return mulMat(mulMat(M, nUn), transpose(M));
}

/** Mean-square displacement along Cartesian unit vector n̂: n̂ᵀ U n̂. */
function msdAlong(uCart: Mat3, nHat: Vec3): number {
  return dotv(nHat, mulVec(uCart, nHat));
}

function dotv(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Atoms at exactly the same position with exactly the same ADP: the species of
 * a mixed or shared site, such as the six cations on one wolframite A site.
 * Their pairs differ only in the species weight, and the pair term is bilinear
 * in the weights, so a pair sum may run over one representative per group
 * carrying the group's summed weight (`groupedWeights`) — for (Co,Cu,Fe,Mn,Ni,Zn)WO₄
 * a third of the pairs. `rep[a]` is atom a's representative, the group's first
 * atom.
 */
export interface ColocatedGroups {
  readonly rep: Int32Array;
}

/** The co-located groups of `atoms`, or null when no two atoms coincide (the per-atom sum is then unchanged). */
export function colocatedGroups(atoms: readonly ExpandedAtom[]): ColocatedGroups | null {
  const rep = new Int32Array(atoms.length);
  const first = new Map<string, number>();
  let merged = false;
  for (let a = 0; a < atoms.length; a++) {
    const atom = atoms[a]!;
    const adp = atom.adp.kind === "isotropic" ? `i${atom.adp.bIso}` : `a${atom.adp.uAniso.join(",")}`;
    const key = `${atom.position[0]},${atom.position[1]},${atom.position[2]}|${adp}`;
    const r = first.get(key);
    if (r === undefined) {
      first.set(key, a);
      rep[a] = a;
    } else {
      rep[a] = r;
      merged = true;
    }
  }
  return merged ? { rep } : null;
}

/**
 * Enumerate all ordered atom pairs within `rMax` (Å) over periodic images.
 * With `groups`, only the representatives pair (indices stay those of `atoms`),
 * for a sum weighted by `groupedWeights`.
 */
export function enumeratePairs(cell: UnitCell, atoms: readonly ExpandedAtom[], rMax: number, groups?: ColocatedGroups | null): PdfPair[] {
  const M = orthogonalizationMatrix(cell);
  const cart: Vec3[] = atoms.map((a) => fractionalToCartesian(cell, a.position));
  const uCart: Mat3[] = atoms.map((a) => cartesianAdpTensor(cell, a.adp));

  // Lattice vectors (columns of M) and a generous per-axis image range.
  const aVec: Vec3 = [M[0][0], M[1][0], M[2][0]];
  const bVec: Vec3 = [M[0][1], M[1][1], M[2][1]];
  const cVec: Vec3 = [M[0][2], M[1][2], M[2][2]];
  const bodyDiag = len([aVec[0] + bVec[0] + cVec[0], aVec[1] + bVec[1] + cVec[1], aVec[2] + bVec[2] + cVec[2]]);
  const reach = rMax + bodyDiag;
  // Per-axis image counts from the reciprocal basis: t1 = a*·T, so any image
  // with |T| ≤ reach has |t1| ≤ |a*|·reach. Bounding with the axis LENGTH
  // (reach/|a|) instead would under-enumerate oblique cells — |a| ≥ 1/|a*|
  // (the (100) plane spacing), and e.g. a hexagonal cell needs ~15% more
  // images along a/b than reach/|a| suggests, dropping edge-of-window pairs
  // at unlucky window sizes. The extra shells this admits for orthogonal
  // cells hold no pairs within rMax, so results are unchanged there.
  const gStar = reciprocalMetricTensor(cell);
  const n1 = Math.ceil(reach * Math.sqrt(Math.max(gStar[0][0], 0)));
  const n2 = Math.ceil(reach * Math.sqrt(Math.max(gStar[1][1], 0)));
  const n3 = Math.ceil(reach * Math.sqrt(Math.max(gStar[2][2], 0)));

  const pairs: PdfPair[] = [];
  const rMaxSq = rMax * rMax;
  const members: number[] = [];
  for (let a = 0; a < atoms.length; a++) if (!groups || groups.rep[a] === a) members.push(a);
  for (let t1 = -n1; t1 <= n1; t1++) {
    for (let t2 = -n2; t2 <= n2; t2++) {
      for (let t3 = -n3; t3 <= n3; t3++) {
        const T = mulVec(M, [t1, t2, t3]);
        for (const i of members) {
          const ci = cart[i]!;
          for (const j of members) {
            const cj = cart[j]!;
            const dx = cj[0] + T[0] - ci[0];
            const dy = cj[1] + T[1] - ci[1];
            const dz = cj[2] + T[2] - ci[2];
            const r2 = dx * dx + dy * dy + dz * dz;
            if (r2 <= 1e-10 || r2 > rMaxSq) continue; // skip self; keep within rMax
            const rij = Math.sqrt(r2);
            const nHat: Vec3 = [dx / rij, dy / rij, dz / rij];
            const msd = msdAlong(uCart[i]!, nHat) + msdAlong(uCart[j]!, nHat);
            pairs.push({ rij, i, j, msd, nx: nHat[0], ny: nHat[1], nz: nHat[2] });
          }
        }
      }
    }
  }
  return pairs;
}

function len(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

// ---------------------------------------------------------------------------
// Compact pair lists. An object per pair costs ~100 B in a browser isolate
// (~170 B in node), and a long-range fit holds millions of them in every
// isolate of a tab (a 22-atom cell to 100 Å), while the isolates of one
// renderer share about 4 GB of heap. A pair is instead its lattice
// translation (per run of pairs) and a small atom-pair code; r, n̂ and the msd
// are recomputed from the float64 Cartesian positions and ADP tensors with the
// SAME expressions, in the SAME order, as `enumeratePairs`, so every value is
// bit-identical to its object. The kernels read pairs a chunk at a time.
// ---------------------------------------------------------------------------

/** A run of pairs in struct-of-arrays form; the arrays are reused between chunks. */
export interface PairChunk {
  length: number;
  readonly r: Float64Array;
  readonly msd: Float64Array;
  readonly nx: Float64Array;
  readonly ny: Float64Array;
  readonly nz: Float64Array;
  readonly i: Int32Array;
  readonly j: Int32Array;
}

/** Pairs in the canonical order of `enumeratePairs` (translations t1, t2, t3 ascending; then i, then j). */
export interface PairSource {
  /** Visit every pair, in order, one chunk at a time. */
  forEachChunk(visit: (chunk: PairChunk) => void): void;
}

/** Pairs per chunk: big enough to amortize the call, small enough to stay in cache. */
const CHUNK = 2048;

function newChunk(): PairChunk {
  return {
    length: 0,
    r: new Float64Array(CHUNK),
    msd: new Float64Array(CHUNK),
    nx: new Float64Array(CHUNK),
    ny: new Float64Array(CHUNK),
    nz: new Float64Array(CHUNK),
    i: new Int32Array(CHUNK),
    j: new Int32Array(CHUNK),
  };
}

/** A `PdfPair[]` read as a pair source (the values copied, so bit-identical). */
export function pairArraySource(pairs: readonly PdfPair[]): PairSource {
  return {
    forEachChunk(visit) {
      const c = newChunk();
      for (let start = 0; start < pairs.length; start += CHUNK) {
        const end = Math.min(pairs.length, start + CHUNK);
        for (let p = start; p < end; p++) {
          const pair = pairs[p]!;
          const k = p - start;
          c.r[k] = pair.rij;
          c.msd[k] = pair.msd;
          c.nx[k] = pair.nx;
          c.ny[k] = pair.ny;
          c.nz[k] = pair.nz;
          c.i[k] = pair.i;
          c.j[k] = pair.j;
        }
        c.length = end - start;
        visit(c);
      }
    },
  };
}

/** A pair list, or any source of the same pairs. */
export type PairsInput = readonly PdfPair[] | PairSource;

/** The pairs as a source (an array is wrapped). */
export function asPairSource(pairs: PairsInput): PairSource {
  return Array.isArray(pairs) ? pairArraySource(pairs as readonly PdfPair[]) : (pairs as PairSource);
}

/**
 * An r range to enumerate: pairs with `rMin ≤ r ≤ rMax`, plus every pair
 * below `rAlways` (so the few short pairs, whose width bound is the loosest,
 * are always present). `rMin` 0 and no `rAlways` is the whole list.
 */
export interface PairShell {
  readonly rMin: number;
  readonly rMax: number;
  readonly rAlways?: number;
}

/** The geometry a pair list is computed from, flattened for the inner loops. */
interface PairGeometry {
  readonly M: Mat3;
  readonly cart: Float64Array; // 3 per atom
  readonly u: Float64Array; // 9 per atom, row-major U_cart
  readonly members: Int32Array;
  readonly n: readonly [number, number, number];
  /** Upper bound of |c_j − c_i| over member pairs (translation pruning). */
  readonly spread: number;
}

function pairGeometry(cell: UnitCell, atoms: readonly ExpandedAtom[], rMax: number, groups?: ColocatedGroups | null): PairGeometry {
  // The same quantities, by the same calls, as enumeratePairs.
  const M = orthogonalizationMatrix(cell);
  const cartV: Vec3[] = atoms.map((a) => fractionalToCartesian(cell, a.position));
  const uCart: Mat3[] = atoms.map((a) => cartesianAdpTensor(cell, a.adp));
  const aVec: Vec3 = [M[0][0], M[1][0], M[2][0]];
  const bVec: Vec3 = [M[0][1], M[1][1], M[2][1]];
  const cVec: Vec3 = [M[0][2], M[1][2], M[2][2]];
  const bodyDiag = len([aVec[0] + bVec[0] + cVec[0], aVec[1] + bVec[1] + cVec[1], aVec[2] + bVec[2] + cVec[2]]);
  const reach = rMax + bodyDiag;
  const gStar = reciprocalMetricTensor(cell);
  const n1 = Math.ceil(reach * Math.sqrt(Math.max(gStar[0][0], 0)));
  const n2 = Math.ceil(reach * Math.sqrt(Math.max(gStar[1][1], 0)));
  const n3 = Math.ceil(reach * Math.sqrt(Math.max(gStar[2][2], 0)));
  const memberList: number[] = [];
  for (let a = 0; a < atoms.length; a++) if (!groups || groups.rep[a] === a) memberList.push(a);
  const cart = new Float64Array(3 * atoms.length);
  const u = new Float64Array(9 * atoms.length);
  for (let a = 0; a < atoms.length; a++) {
    cart[3 * a] = cartV[a]![0];
    cart[3 * a + 1] = cartV[a]![1];
    cart[3 * a + 2] = cartV[a]![2];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) u[9 * a + 3 * r + c] = uCart[a]![r]![c]!;
  }
  let spread = 0;
  for (const i of memberList) {
    for (const j of memberList) {
      const dx = cart[3 * j]! - cart[3 * i]!;
      const dy = cart[3 * j + 1]! - cart[3 * i + 1]!;
      const dz = cart[3 * j + 2]! - cart[3 * i + 2]!;
      spread = Math.max(spread, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  return { M, cart, u, members: Int32Array.from(memberList), n: [n1, n2, n3], spread };
}

/** n̂ᵀ·U·n̂ for the row-major tensor at `u[o…o+8]`, in msdAlong's operation order. */
function msdAlongFlat(u: Float64Array, o: number, nx: number, ny: number, nz: number): number {
  const v0 = u[o]! * nx + u[o + 1]! * ny + u[o + 2]! * nz;
  const v1 = u[o + 3]! * nx + u[o + 4]! * ny + u[o + 5]! * nz;
  const v2 = u[o + 6]! * nx + u[o + 7]! * ny + u[o + 8]! * nz;
  return nx * v0 + ny * v1 + nz * v2;
}

/**
 * The canonical enumeration, once: for every translation (t1, t2, t3) that
 * can hold a pair in `shell`, and every member pair (i, j), the squared
 * distance and the acceptance test of `enumeratePairs`. `onTranslation` sees
 * each translation before its pairs; `onPair` each accepted pair (a, b are
 * member indices). Translations that cannot reach the shell are skipped,
 * which never removes a pair (|c_j + T − c_i| lies within |T| ± spread).
 */
function scanPairs(
  g: PairGeometry,
  rMaxSq: number,
  shell: PairShell | undefined,
  onTranslation: (t1: number, t2: number, t3: number, T: Vec3) => void,
  onPair: (a: number, b: number, dx: number, dy: number, dz: number, r2: number) => void,
): void {
  const { M, cart, members } = g;
  const [n1, n2, n3] = g.n;
  const m = members.length;
  const lo = shell && shell.rMin > 0 ? shell.rMin : 0;
  const always = shell?.rAlways ?? 0;
  const loSq = lo * lo;
  const alwaysSq = always * always;
  // The shell's own upper edge (below rMax): pairs beyond it are kept only under rAlways.
  const hi = shell ? Math.min(shell.rMax, Math.sqrt(rMaxSq)) : Math.sqrt(rMaxSq);
  const hiSq = shell ? hi * hi : rMaxSq;
  // The pairs of translation T lie within |T| ± slack; a generous slack keeps
  // the pruning conservative under rounding.
  const slack = g.spread + 1e-6 * (1 + Math.sqrt(rMaxSq));
  const rTop = Math.max(hi, always);
  for (let t1 = -n1; t1 <= n1; t1++) {
    for (let t2 = -n2; t2 <= n2; t2++) {
      for (let t3 = -n3; t3 <= n3; t3++) {
        const T = mulVec(M, [t1, t2, t3]);
        const tLen = Math.sqrt(T[0] * T[0] + T[1] * T[1] + T[2] * T[2]);
        if (tLen - slack > rTop) continue; // every pair beyond the shell and rAlways
        if (tLen + slack < lo && tLen - slack >= always) continue; // every pair below the shell, none below rAlways
        onTranslation(t1, t2, t3, T);
        for (let a = 0; a < m; a++) {
          const i = members[a]!;
          const cix = cart[3 * i]!;
          const ciy = cart[3 * i + 1]!;
          const ciz = cart[3 * i + 2]!;
          for (let b = 0; b < m; b++) {
            const j = members[b]!;
            const dx = cart[3 * j]! + T[0] - cix;
            const dy = cart[3 * j + 1]! + T[1] - ciy;
            const dz = cart[3 * j + 2]! + T[2] - ciz;
            const r2 = dx * dx + dy * dy + dz * dz;
            if (r2 <= 1e-10 || r2 > rMaxSq) continue; // skip self; keep within rMax (enumeratePairs' test)
            if ((r2 < loSq || r2 > hiSq) && r2 >= alwaysSq) continue; // outside the shell
            onPair(a, b, dx, dy, dz, r2);
          }
        }
      }
    }
  }
}

/** Fill chunk slot k with one pair's values, by enumeratePairs' expressions. */
function writePair(c: PairChunk, k: number, g: PairGeometry, i: number, j: number, dx: number, dy: number, dz: number, r2: number): void {
  const rij = Math.sqrt(r2);
  const nx = dx / rij;
  const ny = dy / rij;
  const nz = dz / rij;
  c.r[k] = rij;
  c.msd[k] = msdAlongFlat(g.u, 9 * i, nx, ny, nz) + msdAlongFlat(g.u, 9 * j, nx, ny, nz);
  c.nx[k] = nx;
  c.ny[k] = ny;
  c.nz[k] = nz;
  c.i[k] = i;
  c.j[k] = j;
}

/**
 * The pairs within `rMax` (and `shell`), stored compactly: per run of pairs
 * sharing a translation, the translation (three Int16) and where the run ends;
 * per pair, a 1-, 2- or 4-byte atom-pair code. About 1–2 bytes a pair. The
 * values are recomputed on every read, bit-identical to `enumeratePairs`.
 */
export class CompactPairs implements PairSource {
  private constructor(
    private readonly g: PairGeometry,
    private readonly runT: Int16Array,
    private readonly runEnd: Uint32Array,
    private readonly codes: Uint8Array | Uint16Array | Uint32Array,
    readonly count: number,
  ) {}

  /** Bytes held by the list (the geometry snapshot included). */
  get bytes(): number {
    return this.runT.byteLength + this.runEnd.byteLength + this.codes.byteLength + this.g.cart.byteLength + this.g.u.byteLength + this.g.members.byteLength;
  }

  static build(cell: UnitCell, atoms: readonly ExpandedAtom[], rMax: number, groups?: ColocatedGroups | null, shell?: PairShell): CompactPairs {
    const g = pairGeometry(cell, atoms, rMax, groups);
    const m = g.members.length;
    if (m * m > 2 ** 32) throw new RangeError("too many atoms for a compact pair list");
    const Codes = m * m <= 256 ? Uint8Array : m * m <= 65536 ? Uint16Array : Uint32Array;
    let codes: Uint8Array | Uint16Array | Uint32Array = new Codes(1024);
    let runT = new Int16Array(3 * 256);
    let runEnd = new Uint32Array(256);
    let runs = 0;
    let count = 0;
    let pending: [number, number, number] | null = null;
    scanPairs(
      g,
      rMax * rMax,
      shell,
      (t1, t2, t3) => {
        pending = [t1, t2, t3];
      },
      (a, b) => {
        if (pending) {
          if (runs === runEnd.length) {
            const nt = new Int16Array(2 * runT.length);
            nt.set(runT);
            runT = nt;
            const ne = new Uint32Array(2 * runEnd.length);
            ne.set(runEnd);
            runEnd = ne;
          }
          runT[3 * runs] = pending[0];
          runT[3 * runs + 1] = pending[1];
          runT[3 * runs + 2] = pending[2];
          runs++;
          pending = null;
        }
        if (count === codes.length) {
          const nc = new Codes(2 * codes.length);
          nc.set(codes);
          codes = nc;
        }
        codes[count++] = a * m + b;
        runEnd[runs - 1] = count;
      },
    );
    return new CompactPairs(g, runT.slice(0, 3 * runs), runEnd.slice(0, runs), codes.slice(0, count), count);
  }

  forEachChunk(visit: (chunk: PairChunk) => void): void {
    const { g, runT, runEnd, codes } = this;
    const { M, cart, members } = g;
    const m = members.length;
    const c = newChunk();
    let k = 0;
    let p = 0;
    for (let run = 0; run < runEnd.length; run++) {
      const T = mulVec(M, [runT[3 * run]!, runT[3 * run + 1]!, runT[3 * run + 2]!]);
      const end = runEnd[run]!;
      for (; p < end; p++) {
        const code = codes[p]!;
        const a = Math.floor(code / m);
        const i = members[a]!;
        const j = members[code - a * m]!;
        const dx = cart[3 * j]! + T[0] - cart[3 * i]!;
        const dy = cart[3 * j + 1]! + T[1] - cart[3 * i + 1]!;
        const dz = cart[3 * j + 2]! + T[2] - cart[3 * i + 2]!;
        writePair(c, k++, g, i, j, dx, dy, dz, dx * dx + dy * dy + dz * dz);
        if (k === CHUNK) {
          c.length = k;
          visit(c);
          k = 0;
        }
      }
    }
    if (k > 0) {
      c.length = k;
      visit(c);
    }
  }
}

/**
 * The same pairs generated on every read and never stored: memory is one
 * chunk, whatever rMax. For lists beyond the storage budget
 * (`PAIR_STORE_BUDGET_BYTES`); the arithmetic and order are those of the
 * stored list.
 */
export function streamPairs(cell: UnitCell, atoms: readonly ExpandedAtom[], rMax: number, groups?: ColocatedGroups | null, shell?: PairShell): PairSource {
  const g = pairGeometry(cell, atoms, rMax, groups);
  return {
    forEachChunk(visit) {
      const c = newChunk();
      let k = 0;
      const members = g.members;
      scanPairs(
        g,
        rMax * rMax,
        shell,
        () => {},
        (a, b, dx, dy, dz, r2) => {
          writePair(c, k++, g, members[a]!, members[b]!, dx, dy, dz, r2);
          if (k === CHUNK) {
            c.length = k;
            visit(c);
            k = 0;
          }
        },
      );
      if (k > 0) {
        c.length = k;
        visit(c);
      }
    },
  };
}

/**
 * The storage budget of one compact pair list (bytes). A list projected
 * beyond it is generated chunk by chunk instead (`streamPairs`), so a fit's
 * pair memory stays bounded whatever its r range. At about 1–2 bytes a pair
 * this is tens of millions of pairs (a 22-atom cell to ~200 Å); streaming
 * costs one enumeration per evaluation.
 */
export const PAIR_STORE_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * Projected pair count within rMax (an upper estimate from the number
 * density: m² pairs per cell volume, with the sphere grown by the cell's
 * spread so the estimate does not fall short on small r).
 */
export function projectedPairCount(cell: UnitCell, atoms: readonly ExpandedAtom[], rMax: number, groups?: ColocatedGroups | null): number {
  let m = 0;
  for (let a = 0; a < atoms.length; a++) if (!groups || groups.rep[a] === a) m++;
  const M = orthogonalizationMatrix(cell);
  const v = Math.abs(M[0][0] * M[1][1] * M[2][2]);
  const R = rMax + 1;
  return v > 0 ? (m * m * (4 / 3) * Math.PI * R * R * R) / v : Infinity;
}

/** The pairs of `enumeratePairs`, stored compactly within the budget, streamed beyond it. */
export function pairSourceFor(
  cell: UnitCell,
  atoms: readonly ExpandedAtom[],
  rMax: number,
  groups?: ColocatedGroups | null,
  shell?: PairShell,
  budgetBytes = PAIR_STORE_BUDGET_BYTES,
): PairSource {
  let m = 0;
  for (let a = 0; a < atoms.length; a++) if (!groups || groups.rep[a] === a) m++;
  const codeBytes = m * m <= 256 ? 1 : m * m <= 65536 ? 2 : 4;
  const projected = projectedPairCount(cell, atoms, rMax, groups) * codeBytes;
  return projected > budgetBytes ? streamPairs(cell, atoms, rMax, groups, shell) : CompactPairs.build(cell, atoms, rMax, groups, shell);
}

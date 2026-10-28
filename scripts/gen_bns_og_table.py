#!/usr/bin/env python3
"""Generate `src/core/magnetic/bnsOgTable.ts` — the bundled standard BNS/OG
magnetic-space-group table — from the ISO-MAG-derived database shipped with
pymatgen-core (`pymatgen/symmetry/symm_data_magnetic.sqlite`).

Provenance (per the docs' "labels must come from an authority" rule):
the sqlite database is parsed from the raw ISO-MAG data file
(ISOTROPY Software Suite, https://stokes.byu.edu/iso/magnetic_data.txt,
used in pymatgen with permission from Prof. Branton Campbell, BYU), itself
compiled from D. B. Litvin, *Magnetic Group Tables* (IUCr, 2013) and
Bradley & Cracknell (1972). Nothing here is hand-transcribed.

Usage (any pymatgen-core wheel carries the database; pick one by platform):
    pip download --no-deps --only-binary=:all: --python-version 3.12 pymatgen-core -d /tmp/pmg
    unzip -o /tmp/pmg/pymatgen_core-*.whl 'pymatgen/symmetry/*' -d /tmp/pmg/x
    python3 scripts/gen_bns_og_table.py \
        /tmp/pmg/x/pymatgen/symmetry/symm_data_magnetic.sqlite \
        src/core/magnetic/bnsOgTable.ts

Scope: all 1651 magnetic space-group types — I (230 "colourless" groups,
M = G), II (230 grey groups, M = G + G1'), III (674 groups,
M = D + θ(G − D)) and IV (517 black-and-white lattices, M = D + {1|t0}'D,
t0 an anti-translation of the BNS cell). At k = 0 the candidate generator
produces types I and III; a commensurate single-arm k ≠ 0 gives type IV in
the magnetic cell. Type II is kept for completeness.

Storage is compact: types I and III list every coset representative with its
time reversal; type II lists G's representatives (the primed copies are the
same operations with 1'); type IV lists D's (unprimed) representatives and the
anti-translation t0 (the primed ones are t0' composed with them).

The script *verifies* every emitted entry before writing:
  - the identity is present and unprimed;
  - type I has no primed operations; type II carries every operation with
    and without time reversal; type III is primed on exactly half and has no
    primed pure translation; type IV is primed on exactly half, has exactly
    one anti-translation coset, and its primed operations are t0' times its
    unprimed ones (what the compact form relies on);
  - the full coset set (representatives x centring translations) is closed
    under composition, with time reversal composing homomorphically;
  - for types I-III the OG symbol equals the BNS symbol (asserted; only type
    IV stores an OG symbol of its own);
  - every entry has a distinct operation-set signature (mod lattice), i.e.
    the runtime lookup keyed on the op set is unambiguous.
"""

from __future__ import annotations

import hashlib
import sqlite3
import sys
from fractions import Fraction

MAGTYPES = (1, 2, 3, 4)
EXPECTED = {1: 230, 2: 230, 3: 674, 4: 517}

# ---------------------------------------------------------------------------
# Reading the database
# ---------------------------------------------------------------------------


def load_point_operators(cur: sqlite3.Cursor) -> dict[tuple[int, int], tuple[tuple[int, ...], str]]:
    """(hex, idx) -> (flattened 3x3 integer rotation, Jones-Faithful rotation string)."""
    out: dict[tuple[int, int], tuple[tuple[int, ...], str]] = {}
    for idx, hx, matrix, string in cur.execute("SELECT idx, hex, matrix, string FROM point_operators"):
        mat = tuple(int(float(v)) for v in matrix.split(","))
        assert len(mat) == 9
        out[(hx, idx)] = (mat, string)
    return out


def parse_symops(blob: bytes, hx: int, points):
    """6-byte records: [pointIdx+1, tx, ty, tz, denominator, timeReversal(1|255)].

    Returns (rotation, translation, timeReversal, rotationString) tuples.
    """
    ops = []
    for i in range(0, len(blob), 6):
        r = blob[i : i + 6]
        mat, string = points[(hx, r[0] - 1)]
        t = tuple(Fraction(r[j], r[4]) % 1 for j in range(1, 4))
        tr = 1 if r[5] == 1 else -1
        ops.append((mat, t, tr, string))
    return ops


def parse_lattice(blob: bytes) -> list[tuple[Fraction, Fraction, Fraction]]:
    """4-byte records: [x, y, z, denominator]. Fractional (centring) vectors only."""
    vecs = []
    for i in range(0, len(blob), 4):
        r = blob[i : i + 4]
        v = tuple(Fraction(r[j], r[3]) % 1 for j in range(3))
        if any(c != 0 for c in v):
            vecs.append(v)
    return vecs


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def expand(ops, centring):
    """Full coset list modulo integer lattice translations."""
    full = set()
    shifts = [(Fraction(0), Fraction(0), Fraction(0)), *centring]
    for mat, t, tr, _string in ops:
        for s in shifts:
            tt = tuple((t[i] + s[i]) % 1 for i in range(3))
            full.add((mat, tt, tr))
    return full


def compose(a, b):
    """(Ra,ta,tra) ∘ (Rb,tb,trb): rotation Ra·Rb, translation Ra·tb + ta (mod 1)."""
    ra, ta, tra = a
    rb, tb, trb = b
    rc = tuple(
        sum(ra[3 * i + k] * rb[3 * k + j] for k in range(3)) for i in range(3) for j in range(3)
    )
    tc = tuple((sum(ra[3 * i + k] * tb[k] for k in range(3)) + ta[i]) % 1 for i in range(3))
    return (rc, tc, tra * trb)


IDENTITY = (1, 0, 0, 0, 1, 0, 0, 0, 1)


ZERO = (Fraction(0), Fraction(0), Fraction(0))


def verify_group(label: str, magtype: int, ops, centring) -> frozenset:
    full = expand(ops, centring)
    ids = sorted(o[2] for o in full if o[0] == IDENTITY and o[1] == ZERO)
    assert ids == ([-1, 1] if magtype == 2 else [1]), f"{label}: identity missing or primed"
    primed = [o for o in full if o[2] == -1]
    anti = {o[1] for o in primed if o[0] == IDENTITY}
    if magtype == 1:
        assert not primed, f"{label}: type I must have no primed ops"
    elif magtype == 2:
        assert all((m, t, -tr) in full for m, t, tr in full), f"{label}: type II must carry every op both ways"
    else:
        assert len(primed) * 2 == len(full), f"{label}: type {magtype} must prime exactly half"
        if magtype == 3:
            assert not anti, f"{label}: type III has no anti-translation"
        else:
            assert anti, f"{label}: type IV needs an anti-translation"
    for a in full:
        for b in full:
            assert compose(a, b) in full, f"{label}: not closed under composition"
    return frozenset(full)


def compact(label: str, magtype: int, ops, centring):
    """The operations a row stores and the type-IV anti-translation (module doc)."""
    if magtype in (1, 3):
        return ops, None
    unprimed = [o for o in ops if o[2] == 1]
    if magtype == 2:
        assert len(unprimed) * 2 == len(ops), f"{label}: type II lists each op both ways"
        return unprimed, None
    antis = [o for o in ops if o[0] == IDENTITY and o[2] == -1]
    assert len(antis) == 1, f"{label}: one anti-translation representative"
    t0 = antis[0][1]
    shifted = expand([(m, tuple((t[i] + t0[i]) % 1 for i in range(3)), -1, s) for m, t, _tr, s in unprimed], centring)
    assert shifted == {o for o in expand(ops, centring) if o[2] == -1}, f"{label}: primed ops are not t0' times the unprimed ones"
    return unprimed, t0


# ---------------------------------------------------------------------------
# Emission
# ---------------------------------------------------------------------------


def frac_str(f: Fraction) -> str:
    return str(f.numerator) if f.denominator == 1 else f"{f.numerator}/{f.denominator}"


def op_string(mat_string: str, t, tr: int) -> str:
    """Magnetic Jones-Faithful string, e.g. 'x,-y+1/2,z,-1'."""
    comps = []
    for comp, f in zip(mat_string.split(","), t):
        comps.append(comp if f == 0 else f"{comp}+{frac_str(f)}")
    comps.append("-1" if tr == -1 else "1")
    return ",".join(comps)


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    db_path, out_path = sys.argv[1], sys.argv[2]

    with open(db_path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    db = sqlite3.connect(db_path)
    cur = db.cursor()
    points = load_point_operators(cur)

    rows = []
    signatures: dict[frozenset, str] = {}
    counts = {t: 0 for t in MAGTYPES}

    query = (
        "SELECT magtype, BNS1, BNS2, BNS_label, OG1, OG2, OG3, OG_label, BNS_symops, BNS_lattice "
        f"FROM space_groups WHERE magtype IN ({','.join('?' * len(MAGTYPES))}) ORDER BY OG3"
    )
    for magtype, bns1, bns2, bns_label, og1, og2, og3, og_label, symops, lattice in cur.execute(
        query, MAGTYPES
    ):
        if magtype != 4:
            assert og_label == bns_label, f"{bns_label}: OG symbol differs from BNS for type {magtype}"
        hx = 1 if 143 <= bns1 <= 194 else 0
        ops = parse_symops(symops, hx, points)
        centring = parse_lattice(lattice)
        sig = verify_group(bns_label, magtype, ops, centring)
        assert sig not in signatures, f"{bns_label}: duplicate op-set signature with {signatures[sig]}"
        signatures[sig] = bns_label
        counts[magtype] += 1

        stored, anti = compact(bns_label, magtype, ops, centring)
        op_strings = ";".join(op_string(string, t, tr) for _mat, t, tr, string in stored)
        centring_str = ";".join(",".join(frac_str(c) for c in v) for v in centring)
        anti_str = "" if anti is None else ",".join(frac_str(c) for c in anti)
        og_symbol = og_label if og_label != bns_label else ""
        rows.append(
            f'  [{magtype}, "{bns1}.{bns2}", "{bns_label}", "{og1}.{og2}.{og3}", "{og_symbol}", {bns1}, '
            f'"{op_strings}", "{centring_str}", "{anti_str}"],'
        )

    for t, n in EXPECTED.items():
        assert counts.get(t, 0) == n, f"expected {n} type-{t} groups, got {counts.get(t)}"

    header = f"""/**
 * Standard magnetic space groups: BNS/OG numbers and symbols with their full
 * operation sets in the standard BNS setting.
 *
 * GENERATED FILE - DO NOT EDIT BY HAND. Regenerate with
 * `scripts/gen_bns_og_table.py` (see that file for the exact commands).
 *
 * Source of truth: the ISO-MAG magnetic-group data (ISOTROPY Software Suite,
 * https://stokes.byu.edu/iso/magnetic_data.txt, H. T. Stokes & B. J. Campbell),
 * compiled from D. B. Litvin, *Magnetic Group Tables* (IUCr, 2013) and
 * Bradley & Cracknell (1972), as redistributed in pymatgen-core's
 * `symm_data_magnetic.sqlite` (used there with permission from
 * Prof. Branton Campbell, BYU; sha256 {digest[:16]}…). No label here is
 * hand-transcribed.
 *
 * Scope: all four types — I ({counts.get(1)} groups, M = G), II ({counts.get(2)} grey
 * groups, M = G + G1'), III ({counts.get(3)} groups, M = D + θ(G − D)) and IV
 * ({counts.get(4)} groups, M = D + {{1|t0}}'D). The k = 0 candidate generator
 * produces types I and III; a commensurate single-arm k ≠ 0 gives type IV in
 * the magnetic cell. For types I-III the OG symbol equals the BNS symbol
 * (verified at generation time) and is not stored; type IV stores its own. The
 * OG *number* always differs and is kept. Settings follow ISO-MAG conventions:
 * monoclinic unique axis b cell choice 1, hexagonal axes for trigonal groups,
 * origin choice 2 where applicable; a type-IV group is given in its BNS cell
 * (the lattice of its unprimed translations).
 *
 * Row layout (kept as compact tuples - this file is bundled):
 *   [magtype, bnsNumber, bnsSymbol, ogNumber, ogSymbol, parentNumber, ops, centring, anti]
 * - bnsSymbol uses ASCII conventions: `_1` for subscripts ("P2_1/c"), `-3`
 *   for roto-inversion bars ("Fm-3m"); see `formatMagneticSymbol`.
 * - ogSymbol: the OG symbol when it differs from the BNS one (type IV), else "".
 * - parentNumber: ITA number of the BNS family space group (the first part of
 *   the BNS number).
 * - ops: ';'-joined magnetic Jones-Faithful coset representatives
 *   ("x,-y+1/2,z,-1"), excluding centring translations. Types I and III list
 *   all of them; type II only the unprimed ones (each also carries 1'); type
 *   IV only the unprimed ones (the primed ones are anti' composed with them).
 * - centring: ';'-joined fractional centring vectors ("1/2,1/2,0"), "" if none.
 * - anti: the type-IV anti-translation ("1/2,0,0"), "" otherwise.
 * Generation verified per entry: identity unprimed, correct primed count for
 * the type, closure of the full coset set (with homomorphic time reversal),
 * the compact form reproducing the full set, and uniqueness of every entry's
 * operation-set signature.
 */

export type MagneticGroupRow = readonly [
  magtype: 1 | 2 | 3 | 4,
  bnsNumber: string,
  bnsSymbol: string,
  ogNumber: string,
  ogSymbol: string,
  parentNumber: number,
  ops: string,
  centring: string,
  anti: string,
];

export const MAGNETIC_GROUP_TABLE: readonly MagneticGroupRow[] = [
"""
    with open(out_path, "w") as fh:
        fh.write(header)
        fh.write("\n".join(rows))
        fh.write("\n];\n")
    print(f"wrote {out_path}: {len(rows)} groups ({counts})")


if __name__ == "__main__":
    main()

"""The magnetic-group oracle for MATERIA's subgroup lattice (THY-37).

For each reference case (a parent space group as MATERIA lists its operations,
a propagation vector k, the magnetic sites), this script builds EVERY magnetic
space group compatible with k independently of MATERIA, in the magnetic box
N = diag(n1, n2, n3) (n_i the denominator of k_i, the box MATERIA's mCIF
exporter and 3D view use), and names each one with spglib:

  * the groups: a subgroup H of the little co-group (closure of up to three
    generators), each generator lifted with its coset representative and a
    time-reversal sign, closed together with the box translations, each
    translation t signed by chi(t) = exp(2 pi i k.t) (an anti-translation when
    chi = -1); a lift set is kept when it closes to |H| x |T| operations
    without containing 1'. A two-arm k (2k not in the reciprocal lattice) keeps
    only the translations with k.t integer and lifts {R : R^T k = +-k} with a
    translation coset each;
  * classes under the little group (conjugation by its operations and the
    parent translations in the box);
  * the BNS / OG numbers and the type of each class from spglib's magnetic
    symmetry of three generic orbits (a general point and a generic moment
    each) expanded by the group;
  * maximality by containment among all compatible groups, and the
    MAXMAGN-like flag: allows a moment on the magnetic sites while no
    compatible supergroup does;
  * per magnetic site, the orbits the group splits its parent orbit into and
    the dimension of the moment the site symmetry allows on each.

Every group is keyed by a hash of its operation list in the box (rotation,
translation on the 1/48 grid, time reversal), the same key MATERIA's gate test
computes from its own candidates, so classes are compared exactly.

spglib is BSD-3-Clause (Togo, Shinohara & Tanaka, Sci. Technol. Adv. Mater.
Meth. 4 (2024) 2384822); it is not vendored, and the fixture is its output.

Run in a scratch venv (never committed):
    uv venv && uv pip install spglib numpy
    .venv/bin/python -I scripts/magnetic-groups/oracle.py \
        src/core/magnetic/fixtures/magnetic-oracle-input.json \
        src/core/magnetic/fixtures/magnetic-oracle.json
The input is written by `MAGNETIC_ORACLE_DUMP=1 npx vitest run
src/core/magnetic/magneticGroupsOracle.test.ts` from the committed cases
(src/testSupport/magneticOracleCases.ts).
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
import sys
from fractions import Fraction as F

import numpy as np
import spglib

D = 720  # common denominator of box translations
I3 = ((1, 0, 0), (0, 1, 0), (0, 0, 1))


def frac(x: float) -> F:
    f = F(x).limit_denominator(48)
    assert abs(float(f) - x) < 1e-6, x
    return f


def tint(x) -> int:
    q = F(x) * D
    if q.denominator != 1:
        raise ValueError(f"translation {x} not representable on 1/{D}")
    return int(q) % D


def matmul(A, B):
    return tuple(tuple(sum(A[i][m] * B[m][j] for m in range(3)) for j in range(3)) for i in range(3))


def matvec(A, v):
    return tuple(sum(A[i][m] * v[m] for m in range(3)) for i in range(3))


def det3(R):
    return (R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
            + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]))


def inv3(R):
    d = det3(R)
    c = lambda r1, c1, r2, c2: R[r1][c1] * R[r2][c2] - R[r1][c2] * R[r2][c1]
    adj = ((c(1, 1, 2, 2), -c(0, 1, 2, 2), c(0, 1, 1, 2)),
           (-c(1, 0, 2, 2), c(0, 0, 2, 2), -c(0, 0, 1, 2)),
           (c(1, 0, 2, 1), -c(0, 0, 2, 1), c(0, 0, 1, 1)))
    return tuple(tuple(adj[i][j] // d for j in range(3)) for i in range(3))


class Op:
    """A magnetic operation in the box: integer R, translation in 1/D units mod D, time reversal."""
    __slots__ = ("R", "t", "tr", "_k")

    def __init__(self, R, t, tr):
        self.R = R
        self.t = (t[0] % D, t[1] % D, t[2] % D)
        self.tr = tr
        self._k = (R, self.t, tr)

    def key(self):
        return self._k

    def skey(self):
        return (self.R, self.t)

    def __mul__(self, o):
        Rt = matvec(self.R, o.t)
        return Op(matmul(self.R, o.R), (Rt[0] + self.t[0], Rt[1] + self.t[1], Rt[2] + self.t[2]), self.tr * o.tr)

    def inv(self):
        Ri = inv3(self.R)
        t = matvec(Ri, self.t)
        return Op(Ri, (-t[0], -t[1], -t[2]), self.tr)

    def det(self):
        return det3(self.R)

    def tfloat(self):
        return np.array([x / D for x in self.t])


def group_key(ops) -> str:
    """The hash MATERIA's gate test computes: sorted 'R|t48|theta' strings, sha1, 16 hex digits."""
    rows = []
    for o in ops:
        t48 = []
        for x in o.t:
            q = F(x * 48, D)
            assert q.denominator == 1, "translation off the 1/48 grid"
            t48.append(int(q) % 48)
        rows.append(f"{','.join(str(v) for r in o.R for v in r)}|{','.join(map(str, t48))}|{o.tr}")
    return hashlib.sha1(";".join(sorted(rows)).encode()).hexdigest()[:16]


def chi(k, v):
    ph = 2 * math.pi * sum(float(k[i]) * float(v[i]) for i in range(3))
    return math.cos(ph), math.sin(ph)


def lattice_rows(cell, n=(1, 1, 1)):
    a, b, c = cell["a"] * n[0], cell["b"] * n[1], cell["c"] * n[2]
    al, be, ga = (math.radians(cell[x]) for x in ("alpha", "beta", "gamma"))
    va = [a, 0, 0]
    vb = [b * math.cos(ga), b * math.sin(ga), 0]
    cx = c * math.cos(be)
    cy = c * (math.cos(al) - math.cos(be) * math.cos(ga)) / math.sin(ga)
    cz = math.sqrt(max(c * c - cx * cx - cy * cy, 0))
    return np.array([va, vb, [cx, cy, cz]])


def identify(lattice, positions, types, magmoms, symprec=1e-2):
    ds = spglib.get_magnetic_symmetry_dataset((lattice, positions, types, magmoms), is_axial=True, symprec=symprec, mag_symprec=1e-3)
    if ds is None:
        return None
    t = spglib.get_magnetic_spacegroup_type(ds.uni_number)
    return {"bns": t.bns_number, "og": t.og_number, "type": t.type}


def generic_orbit_identify(ops, lattice, seed=7, norbits=3):
    """BNS of the group from three generic orbits of distinct types with generic moments."""
    rng = np.random.default_rng(seed)
    A = lattice.T
    pos, mom, typ = [], [], []
    for orb in range(norbits):
        x = rng.random(3) * 0.8 + 0.07
        m = rng.normal(size=3)
        seen = {}
        for o in ops:
            R = np.array(o.R, dtype=float)
            p = R @ x + o.tfloat()
            p = p - np.floor(p)
            mf = o.tr * o.det() * (R @ m)
            key = tuple(np.round(p, 6) % 1.0)
            if key in seen:
                if np.linalg.norm(seen[key] - mf) > 1e-6:
                    return {"error": "same point carries two moments: not a magnetic group"}
                continue
            seen[key] = mf
            pos.append(p)
            mom.append(A @ mf)
            typ.append(orb + 1)
    info = identify(lattice, np.array(pos), typ, np.array(mom))
    return info if info is not None else {"error": "spglib failed"}


def site_allowed(ops, p):
    rows = []
    for o in ops:
        R = np.array(o.R, dtype=float)
        q = R @ p + o.tfloat()
        d = q - p
        d -= np.round(d)
        if np.linalg.norm(d) < 2e-3:
            rows.append(o.tr * o.det() * R - np.eye(3))
    if not rows:
        return 3
    s = np.linalg.svd(np.vstack(rows), compute_uv=False)
    return 3 - int(np.sum(s > 1e-8))


def close_rots(gens):
    S = {I3, *gens}
    frontier = list(S)
    while frontier:
        new = []
        for a in list(S):
            for b in frontier:
                for c in (matmul(a, b), matmul(b, a)):
                    if c not in S:
                        S.add(c)
                        new.append(c)
        frontier = new
    return frozenset(S)


def point_subgroups(rots):
    rots = sorted(rots)
    subs = {frozenset({I3})}
    for r in (1, 2, 3):
        for gens in itertools.combinations(rots, r):
            subs.add(close_rots(gens))
    return sorted(subs, key=lambda s: -len(s))


def generators_of(H):
    gens, cur = [], frozenset({I3})
    for g in sorted(H):
        if g not in cur:
            gens.append(g)
            cur = close_rots(gens)
        if len(cur) == len(H):
            break
    return gens


def to_box(R, tau, n):
    Rb = [[F(R[i][j] * n[j], n[i]) for j in range(3)] for i in range(3)]
    for row in Rb:
        for v in row:
            assert v.denominator == 1, "rotation does not preserve the box"
    Rb = tuple(tuple(int(v) for v in row) for row in Rb)
    return Rb, tuple(tint(F(tau[i]) / n[i]) for i in range(3))


def box_translations(n):
    return [(i, j, l) for i in range(n[0]) for j in range(n[1]) for l in range(n[2])]


def run_case(data):
    k = [frac(x) for x in data["k"]]
    two_arm = bool(data["twoArms"])
    n = tuple(data["supercell"])
    centr = [[F(0), F(0), F(0)]]
    for c in data["centrings"]:
        cc = [frac(x) for x in c]
        if any(x != 0 for x in cc) and cc not in centr:
            centr.append(cc)
    trans = [tuple(F(t[i]) + c[i] for i in range(3)) for t in box_translations(n) for c in centr]

    def in_recip(v):
        if any(x.denominator != 1 for x in v):
            return False
        return all(sum(v[i] * c[i] for i in range(3)).denominator == 1 for c in centr)

    def keeps(R, sign):
        kp = [sum(R[j][i] * k[j] for j in range(3)) for i in range(3)]
        return in_recip([kp[i] - sign * k[i] for i in range(3)])

    reps = {}
    for o in data["parentOps"]:
        R = tuple(tuple(int(v) for v in row) for row in o["R"])
        if R in reps:
            continue
        if keeps(R, 1) or (two_arm and keeps(R, -1)):
            reps[R] = [frac(x) for x in o["t"]]
    cog = list(reps.keys())
    lat_box = lattice_rows(data["cell"], n)

    def box_op(R, tau, t, s):
        b = to_box(R, [tau[i] + t[i] for i in range(3)], n)
        return Op(b[0], b[1], s)

    T_ops, T_keys = [], set()
    for t in trans:
        re, im = chi(k, t)
        if abs(im) > 1e-9 or abs(abs(re) - 1) > 1e-9:
            continue
        if two_arm and re < 0:
            continue
        op = box_op(I3, [0, 0, 0], t, 1 if re > 0 else -1)
        if op.key() not in T_keys:
            T_keys.add(op.key())
            T_ops.append(op)
    pure_T = {o.t for o in T_ops}
    coset_t = [(F(0), F(0), F(0))]
    if two_arm:
        coset_t, seen_t = [], set()
        for t in trans:
            tb = box_op(I3, [0, 0, 0], t, 1).t
            cls = frozenset(((tb[0] + u[0]) % D, (tb[1] + u[1]) % D, (tb[2] + u[2]) % D) for u in pure_T)
            if cls not in seen_t:
                seen_t.add(cls)
                coset_t.append(t)

    groups, seen = [], set()
    for H in point_subgroups(cog):
        gens = generators_of(H)
        target = len(H) * len(T_ops)
        lifts = [[box_op(g, reps[g], t, s) for t in coset_t for s in (1, -1)] for g in gens]
        for choice in itertools.product(*lifts):
            S = {o.key(): o for o in T_ops}
            frontier = []
            for o in choice:
                if o.key() not in S:
                    S[o.key()] = o
                    frontier.append(o)
            bad = False
            while frontier and not bad:
                new = []
                cur = list(S.values())
                for a in cur:
                    for b in frontier:
                        for c in (a * b, b * a):
                            if c.key() not in S:
                                S[c.key()] = c
                                new.append(c)
                    if len(S) > target:
                        bad = True
                        break
                frontier = new
            if bad or len(S) != target:
                continue
            spatial = {}
            for o in S.values():
                if spatial.setdefault(o.skey(), o.tr) != o.tr:
                    bad = True  # contains 1'
                    break
            if bad:
                continue
            key = frozenset(S.keys())
            if key in seen:
                continue
            seen.add(key)
            groups.append((H, list(S.values()), key))

    conj = [box_op(R, tau, t, 1) for R, tau in reps.items() for t in trans]
    key_index = {g[2]: i for i, g in enumerate(groups)}
    assigned, classes = {}, []
    for gi, (H, ops, key) in enumerate(groups):
        if gi in assigned:
            continue
        cid = len(classes)
        members = set()
        for g in conj:
            gi_ = g.inv()
            j = key_index.get(frozenset((g * o * gi_).key() for o in ops))
            if j is not None:
                members.add(j)
                assigned[j] = cid
        classes.append(sorted(members))

    # Magnetic sites: each one's parent orbit in the box.
    ions = set(data["ions"])
    parent_box = [box_op(tuple(tuple(int(v) for v in row) for row in o["R"]), [frac(x) for x in o["t"]], t, 1)
                  for o in data["parentOps"] for t in trans]
    site_orbits = {}
    for s in data["sites"]:
        if s["label"] not in ions:
            continue
        x = np.array([float(s["position"][i]) / n[i] for i in range(3)])
        orbit = []
        for o in parent_box:
            p = np.array(o.R, dtype=float) @ x + o.tfloat()
            p = p - np.floor(p + 1e-9)
            if not any(np.linalg.norm((p - q + 0.5) % 1.0 - 0.5) < 2e-3 for q in orbit):
                orbit.append(p)
        site_orbits[s["label"]] = orbit

    def moment_dims(ops):
        out = {}
        for label, orbit in site_orbits.items():
            left = list(range(len(orbit)))
            dims = []
            while left:
                rep = orbit[left[0]]
                hit = set()
                for o in ops:
                    p = np.array(o.R, dtype=float) @ rep + o.tfloat()
                    p = p - np.floor(p + 1e-9)
                    for i in left:
                        if np.linalg.norm((p - orbit[i] + 0.5) % 1.0 - 0.5) < 2e-3:
                            hit.add(i)
                left = [i for i in left if i not in hit]
                dims.append(site_allowed(ops, rep))
            out[label] = sorted(dims, reverse=True)
        return out

    sizes = [len(g[2]) for g in groups]
    rows = []
    allows = []
    for cid, members in enumerate(classes):
        H, ops, key = groups[members[0]]
        dims = moment_dims(ops)
        allows.append(any(d > 0 for ds in dims.values() for d in ds))
        ident = generic_orbit_identify(ops, lat_box)
        # Each member named on its own: the domains of one class can be enantiomorphs
        # (P_c4_1 and P_c4_3), related by an improper operation of the little group.
        named = []
        if not two_arm:
            for j in members:
                mi = generic_orbit_identify(groups[j][1], lat_box)
                named.append([group_key(groups[j][1]), mi.get("bns"), mi.get("type")])
        rows.append({
            "index": 2 * len(cog) // len(H),
            "orderH": len(H),
            "domains": len(members),
            "bns": ident.get("bns"),
            "og": ident.get("og"),
            "type": ident.get("type"),
            **({"error": ident["error"]} if "error" in ident else {}),
            "moments": dims,
            "members": sorted(named),
        })
    for cid, members in enumerate(classes):
        mine = groups[members[0]][2]
        supers = [j for j in range(len(groups)) if sizes[j] > len(mine) and mine < groups[j][2]]
        rows[cid]["maximal"] = not supers
        rows[cid]["allowsMoment"] = allows[cid]
        rows[cid]["maxmagn"] = allows[cid] and not any(allows[assigned[j]] for j in supers)
    return {
        "id": data["id"],
        "k": data["k"],
        "twoArms": two_arm,
        "supercell": list(n),
        "cogroup": len(cog),
        "groups": len(groups),
        "classes": rows,
    }


def main() -> None:
    inp, out = sys.argv[1], sys.argv[2]
    cases = json.load(open(inp))["cases"]
    results = []
    for c in cases:
        r = run_case(c)
        print(f"{r['id']}: co-group {r['cogroup']}, {r['groups']} groups in {len(r['classes'])} classes", file=sys.stderr)
        results.append(r)
    head = {
        "source": (
            f"Generated by scripts/magnetic-groups/oracle.py with spglib {spglib.__version__} (BSD-3-Clause; "
            "Togo, Shinohara & Tanaka, Sci. Technol. Adv. Mater. Meth. 4 (2024) 2384822) from "
            "magnetic-oracle-input.json: every magnetic space group compatible with k built independently "
            "of MATERIA in the diagonal magnetic box and named by spglib from three generic orbits."
        ),
        "license": "BSD-3-Clause (spglib); fixture data are its output",
    }
    with open(out, "w") as f:
        f.write(json.dumps(head, ensure_ascii=False)[:-1] + ',\n "cases": [\n')
        f.write(",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in results))
        f.write("\n]}\n")


if __name__ == "__main__":
    main()

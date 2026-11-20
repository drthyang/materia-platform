"""Read a GSAS-II .instprm with GSAS-II's own reader (GSASIIfiles.ReadInstprm), every bank.

usage: python gsas2_read_instprm.py <file.instprm> [out.json]
Writes {"default": {...}, "banks": {"1": {key: value}, ...}, "errors": {...}} as JSON.
Values are GSAS-II's instrument dict entries (the first element of each [value, value, flag]).
"""
import json, sys, os
sys.dont_write_bytecode = True
ROOT = os.environ.get("GSAS2_ROOT", os.path.expanduser("~/.local/share/validation-engine/gsas2-env/GSAS-II"))
sys.path.insert(0, ROOT)
from GSASII import GSASIIfiles as G2fil

def read(lines, bank):
    nbank, (inst, ext) = G2fil.ReadInstprm(lines, bank, {})
    return nbank, {k: (v[0] if isinstance(v, (list, tuple)) else v) for k, v in inst.items()}, sorted(ext.keys())

path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
out = {"file": os.path.basename(path), "banks": {}, "errors": {}}
banks = []
for s in lines:
    if s[:1] == "#" and "Bank" in s:
        try:
            banks.append(int(s.split(":")[0].split()[1]))
        except Exception as e:  # GSAS-II itself fails on such a line
            out["errors"]["header"] = f"{type(e).__name__}: {e} on line {s.strip()!r}"
try:
    nb, d, ext = read(lines, None)
    out["default"] = {"bank": nb, "values": d, "extended": ext}
except Exception as e:
    out["errors"]["default"] = f"{type(e).__name__}: {e}"
for b in (banks or [1]):
    try:
        nb, d, ext = read(lines, b)
        out["banks"][str(b)] = d
    except Exception as e:
        out["errors"][str(b)] = f"{type(e).__name__}: {e}"
text = json.dumps(out, indent=1, sort_keys=True)
if len(sys.argv) > 2:
    open(sys.argv[2], "w").write(text)
else:
    print(text)

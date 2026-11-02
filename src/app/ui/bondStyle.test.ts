import { describe, expect, it } from "vitest";
import {
  BOND_SETTINGS_KEY,
  DEFAULT_BOND_SETTINGS,
  loadBondSettings,
  parseBondSettings,
  saveBondSettings,
  type BondSettings,
} from "@/app/ui/bondStyle";

function memoryStore(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("bond settings", () => {
  it("defaults to the sticks the view always drew", () => {
    expect(DEFAULT_BOND_SETTINGS).toEqual({ style: "sticks", color: "gray", hidden: false });
    expect(loadBondSettings(memoryStore())).toEqual(DEFAULT_BOND_SETTINGS);
    expect(loadBondSettings(null)).toEqual(DEFAULT_BOND_SETTINGS);
  });

  it("round-trips every style, color and hide through the session store", () => {
    const store = memoryStore();
    for (const style of ["sticks", "ball-and-stick", "lines"] as const) {
      for (const color of ["gray", "by-atom"] as const) {
        for (const hidden of [false, true]) {
          const s: BondSettings = { style, color, hidden };
          saveBondSettings(s, store);
          expect(loadBondSettings(store)).toEqual(s);
        }
      }
    }
    expect([...store.data.keys()]).toEqual([BOND_SETTINGS_KEY]);
  });

  it("keeps the default for anything missing, unknown or unreadable", () => {
    expect(parseBondSettings("not json")).toEqual(DEFAULT_BOND_SETTINGS);
    expect(parseBondSettings("42")).toEqual(DEFAULT_BOND_SETTINGS);
    expect(parseBondSettings(JSON.stringify({ style: "space-filling", color: "pink", hidden: "yes" }))).toEqual(DEFAULT_BOND_SETTINGS);
    expect(parseBondSettings(JSON.stringify({ hidden: true }))).toEqual({ ...DEFAULT_BOND_SETTINGS, hidden: true });
    expect(parseBondSettings(JSON.stringify({ style: "lines" }))).toEqual({ ...DEFAULT_BOND_SETTINGS, style: "lines" });
  });

  it("fails soft when storage throws", () => {
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
    };
    expect(loadBondSettings(blocked)).toEqual(DEFAULT_BOND_SETTINGS);
    expect(() => saveBondSettings({ style: "lines", color: "by-atom", hidden: true }, blocked)).not.toThrow();
  });
});

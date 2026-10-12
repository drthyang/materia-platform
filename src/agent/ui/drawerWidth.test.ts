import { describe, it, expect } from "vitest";
import { DRAWER_MAX, DRAWER_MIN, PAGE_MIN, clampDrawerWidth, readDrawerWidth, writeDrawerWidth } from "@/agent/ui/drawerWidth";
import { WIDTH_KEY } from "@/agent/storage";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("Agent drawer width", () => {
  it("keeps the page its share, and the drawer between its bounds", () => {
    expect(clampDrawerWidth(500, 1920)).toBe(500);
    expect(clampDrawerWidth(2000, 1920)).toBe(DRAWER_MAX);
    expect(clampDrawerWidth(100, 1920)).toBe(DRAWER_MIN);
    // A 1440px window: the page keeps PAGE_MIN (760), so the drawer stops at 680.
    expect(clampDrawerWidth(700, 1440)).toBe(1440 - PAGE_MIN);
    expect(PAGE_MIN).toBe(760);
    // A window too narrow for both never pushes the drawer under its floor.
    expect(clampDrawerWidth(700, 700)).toBe(DRAWER_MIN);
    expect(clampDrawerWidth(412.6, 1920)).toBe(413);
  });

  it("remembers a chosen width, forgets it on reset, and ignores junk", () => {
    const store = memory();
    expect(readDrawerWidth(store)).toBeNull();
    writeDrawerWidth(store, 512.4);
    expect(store.getItem(WIDTH_KEY)).toBe("512");
    expect(readDrawerWidth(store)).toBe(512);
    writeDrawerWidth(store, null);
    expect(readDrawerWidth(store)).toBeNull();
    for (const junk of ["wide", "12", "99999", ""]) {
      store.setItem(WIDTH_KEY, junk);
      expect(readDrawerWidth(store)).toBeNull();
    }
  });

  it("survives storage that throws (private mode, blocked site data)", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readDrawerWidth(broken)).toBeNull();
    expect(() => writeDrawerWidth(broken, 400)).not.toThrow();
  });
});

describe("where the drawer sits", () => {
  it("docks beside the page with room for both, and is a sheet under it on a portrait tablet or a phone", async () => {
    const { dockModeFor } = await import("@/agent/ui/drawerWidth");
    expect(dockModeFor(1440, 900)).toBe("docked");
    expect(dockModeFor(1920, 1080)).toBe("docked");
    expect(dockModeFor(1180, 820)).toBe("docked"); // iPad landscape
    expect(dockModeFor(820, 1180)).toBe("sheet"); // iPad portrait
    expect(dockModeFor(390, 844)).toBe("sheet"); // a phone
    expect(dockModeFor(950, 600)).toBe("docked");
    expect(dockModeFor(950, 1000)).toBe("sheet");
  });

  it("keeps the sheet between 30 % and 85 % of the window, remembers it, and lowers it so a card fits", async () => {
    const { clampSheet, readSheet, writeSheet, sheetFor, SHEET_DEFAULT } = await import("@/agent/ui/drawerWidth");
    expect(clampSheet(0.1)).toBe(0.3);
    expect(clampSheet(0.99)).toBe(0.85);
    expect(clampSheet(Number.NaN)).toBe(SHEET_DEFAULT);
    const store = memory();
    expect(readSheet(store)).toBeNull();
    writeSheet(store, 0.6234);
    expect(readSheet(store)).toBe(0.623);
    // A 500px card in a 400px page of a 1000px window: the sheet gives up 112px.
    expect(sheetFor(0.6, 500, 400, 1000)).toBeCloseTo(0.488, 6);
    expect(sheetFor(0.6, 300, 400, 1000)).toBe(0.6);
    // Too tall to fit even with the sheet at its minimum: the sheet stays (phone, the plot card).
    expect(sheetFor(0.35, 900, 400, 1000)).toBe(0.35);
    expect(sheetFor(0.46, 900, 400, 844)).toBe(0.46);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  it("docks beside the page on a phone held sideways, whatever its width", async () => {
    const { dockModeFor } = await import("@/agent/ui/drawerWidth");
    // Safari's visible area: iPhone 18 Pro and Pro Max, upright and sideways.
    expect(dockModeFor(402, 680)).toBe("sheet");
    expect(dockModeFor(440, 760)).toBe("sheet");
    expect(dockModeFor(874, 370)).toBe("docked");
    expect(dockModeFor(956, 410)).toBe("docked");
    // iPad Pro 11" and 13", upright and sideways.
    expect(dockModeFor(834, 1130)).toBe("sheet");
    expect(dockModeFor(1210, 760)).toBe("docked");
    expect(dockModeFor(1032, 1290)).toBe("docked");
    expect(dockModeFor(1376, 950)).toBe("docked");
    // The edges: 540 px tall still counts as short; a square window is portrait.
    expect(dockModeFor(800, 540)).toBe("docked");
    expect(dockModeFor(800, 541)).toBe("sheet");
    expect(dockModeFor(540, 540)).toBe("sheet");
  });

  it("says the same as SHEET_QUERY, read the way a browser reads it", async () => {
    const { dockModeFor, SHEET_QUERY } = await import("@/agent/ui/drawerWidth");
    // A small evaluator for the query's grammar: a comma is "or", `and` is
    // "and"; (max-width|min-height…: N px) and (orientation: …).
    const matches = (w: number, h: number): boolean =>
      SHEET_QUERY.split(",").some((clause) =>
        clause.trim().split(/\s+and\s+/).every((feature) => {
          const m = /^\((max-width|min-width|max-height|min-height|orientation):\s*([\w.]+?)(px)?\)$/.exec(feature.trim());
          if (!m) throw new Error(`unread feature ${feature}`);
          const [, name, raw] = m;
          if (name === "orientation") return raw === "portrait" ? h >= w : w > h;
          const v = Number(raw);
          return name === "max-width" ? w <= v : name === "min-width" ? w >= v : name === "max-height" ? h <= v : h >= v;
        }),
      );
    for (let w = 320; w <= 1500; w += 7) {
      for (let h = 300; h <= 1400; h += 11) {
        expect(matches(w, h), `${w}×${h}`).toBe(dockModeFor(w, h) === "sheet");
      }
    }
    // workbench.css lays the drawer and the rail out by the same query.
    const css = readFileSync(fileURLToPath(new URL("../../app/workbench.css", import.meta.url)), "utf8");
    for (const rule of [".wb-frame-agent", ".wb-frame-rail"]) {
      const at = css.indexOf(`  ${rule} {`);
      const media = css.lastIndexOf("@media ", at);
      expect(css.slice(media + 7, css.indexOf(" {", media)), rule).toBe(SHEET_QUERY);
    }
    // The edges themselves.
    for (const [w, h] of [[899, 540], [899, 541], [900, 541], [999, 1000], [1000, 1001], [540, 540]] as const) {
      expect(matches(w, h), `${w}×${h}`).toBe(dockModeFor(w, h) === "sheet");
    }
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

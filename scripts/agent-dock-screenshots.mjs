/**
 * The Agent dock at the five sizes it is designed for (THY-25): a 1440 and a
 * 1920 desktop, an iPad held landscape and upright, and a phone. For each it
 * checks that the drawer never covers the page (docked: beside it; sheet:
 * under it) and saves a screenshot, the drawer open on the Rietveld demo,
 * then the collapsed rail after a message.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/agent-dock-screenshots.mjs [baseUrl] [outDir]
 * CHROMIUM=/path/to/chrome overrides the browser (default: the one
 * Playwright installed under /opt/pw-browsers, else the system Chrome).
 */

import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5173/web-refinement/";
const OUT = process.argv[3] ?? new URL("../docs/screenshots/dock/", import.meta.url).pathname;

const SIZES = {
  "desktop-1440": { viewport: { width: 1440, height: 900 }, mode: "docked" },
  "desktop-1920": { viewport: { width: 1920, height: 1080 }, mode: "docked" },
  "ipad-landscape": { viewport: { width: 1180, height: 820 }, mode: "docked", hasTouch: true },
  "ipad-portrait": { viewport: { width: 820, height: 1180 }, mode: "sheet", hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, mode: "sheet", hasTouch: true, isMobile: true },
};

const executablePath = process.env.CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
  const failures = [];
  for (const [name, cfg] of Object.entries(SIZES)) {
    const context = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 2, hasTouch: !!cfg.hasTouch, isMobile: !!cfg.isMobile });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector("header");
    await page.getByRole("button", { name: "Demos ▾", exact: true }).click();
    await page.getByRole("button", { name: "Rietveld · Mn₃Ga neutron TOF", exact: true }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.waitForSelector("aside.wb-agent");
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const shell = r(".wb-shell");
      const agent = r("aside.wb-agent");
      return { shell: shell && { left: shell.left, right: shell.right, top: shell.top, bottom: shell.bottom, width: shell.width }, agent: agent && { left: agent.left, right: agent.right, top: agent.top, bottom: agent.bottom, width: agent.width, height: agent.height }, mode: document.querySelector("aside.wb-agent")?.getAttribute("data-mode") };
    });
    const ok = box.shell && box.agent && box.mode === cfg.mode && (cfg.mode === "docked" ? box.shell.right <= box.agent.left + 1 : box.shell.bottom <= box.agent.top + 1);
    if (!ok) failures.push(`${name}: ${JSON.stringify(box)}`);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: mode ${box.mode}, page ${Math.round(box.shell?.width ?? 0)} px wide, Agent ${Math.round(box.agent?.width ?? 0)}×${Math.round(box.agent?.height ?? 0)}`);
    await page.screenshot({ path: `${OUT}${name}.png` });
    await context.close();
  }
  await browser.close();
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

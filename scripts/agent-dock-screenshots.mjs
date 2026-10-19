/**
 * The Agent dock at the five sizes it is designed for (THY-25): a 1440 and a
 * 1920 desktop, an iPad held landscape and upright, and a phone. For each it
 * checks that the drawer never covers the page (docked: beside it; sheet:
 * under it) and saves a screenshot with a conversation in the drawer.
 *
 * The conversations are the eval suite's scripted replays, played by the dev
 * server (`?agentReplay=<id>`, src/agent/replay/): the real chat loop, tools
 * and page, with only the model scripted, so no key and no network. One per
 * page: a Rietveld refinement on the Mn₃Ga demo, a boxcar scan on the
 * GaTa₄Se₈ PDF demo, and the single-crystal page on the suite's synthetic
 * corundum (written to a temporary folder by write-corundum-sc.ts). Each is
 * shot at its first approval card, at its report if it writes one, and at
 * its end; then the collapsed rail.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/agent-dock-screenshots.mjs [baseUrl] [outDir]
 * CHROMIUM=/path/to/chrome overrides the browser (default: the one
 * Playwright installed under /opt/pw-browsers, else the system Chrome).
 */

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5173/materia-platform/";
const OUT = process.argv[3] ?? new URL("../docs/screenshots/dock/", import.meta.url).pathname;

const SIZES = {
  "desktop-1440": { viewport: { width: 1440, height: 900 }, mode: "docked" },
  "desktop-1920": { viewport: { width: 1920, height: 1080 }, mode: "docked" },
  "ipad-landscape": { viewport: { width: 1180, height: 820 }, mode: "docked", hasTouch: true },
  "ipad-portrait": { viewport: { width: 820, height: 1180 }, mode: "sheet", hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, mode: "sheet", hasTouch: true, isMobile: true },
};

/** The replays (src/agent/replay/demoReplays.ts) and the user's message in each. */
const REPLAYS = {
  "full-refinement": { page: "rietveld", message: "Run the full refinement to improve the quality of the fit." },
  "pdf-local-geometry": { page: "pdf", message: "Is the Ta coordination the same locally as on average? Write the report when you are done." },
  "sc-data-first": { page: "single-crystal", message: "Refine this crystal structure properly and report the result." },
};

const executablePath = process.env.CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

let scFiles = null;
function corundumFiles() {
  if (!scFiles) {
    const dir = mkdtempSync(join(tmpdir(), "materia-sc-"));
    execFileSync("npx", ["vite-node", "scripts/write-corundum-sc.ts", dir], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
    scFiles = { cif: join(dir, "corundum.cif"), data: join(dir, "corundum.int") };
  }
  return scFiles;
}

async function loadPage(page, kind) {
  if (kind === "single-crystal") {
    const { cif, data } = corundumFiles();
    await page.locator('label:has-text("Load CIF…") input[type=file]').first().setInputFiles(cif);
    await page.waitForTimeout(800);
    await page.locator('label:has-text("Load data…") input[type=file]').first().setInputFiles(data);
  } else {
    await page.getByRole("button", { name: "Demos ▾", exact: true }).click();
    const label = kind === "rietveld" ? "Rietveld · Mn₃Ga neutron TOF" : "PDF · GaTa₄Se₈ X-ray G(r)";
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  await page.waitForTimeout(1500);
}

/** A report the replay wrote opens over the page: shoot it, then close it. */
async function closeReport(page, shot) {
  const close = page.getByRole("button", { name: "Close the report" });
  if (!(await close.isVisible().catch(() => false))) return;
  if (shot) await page.screenshot({ path: shot });
  await close.click();
  await page.waitForTimeout(300);
}

/** Send the replay's message, approve each change, and shoot the first approval card. */
async function play(page, id, approvalShot) {
  const drawer = page.locator("aside.wb-agent");
  await drawer.getByRole("textbox", { name: "Message the Copilot" }).fill(REPLAYS[id].message);
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  let shot = !approvalShot;
  let idle = 0;
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    const approve = drawer.getByRole("button", { name: "Approve", exact: true }).first();
    if (await approve.isVisible().catch(() => false)) {
      idle = 0;
      if (!shot) {
        await approve.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await page.screenshot({ path: approvalShot });
        shot = true;
      }
      await approve.click();
    } else if (await drawer.getByRole("button", { name: "Stop", exact: true }).isVisible().catch(() => false)) {
      idle = 0;
    } else if (++idle >= 3) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`${id}: the replay did not finish in time`);
}

async function open(browser, cfg, id) {
  const context = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 2, hasTouch: !!cfg.hasTouch, isMobile: !!cfg.isMobile });
  const page = await context.newPage();
  await page.goto(`${BASE}?agentReplay=${id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("header");
  await loadPage(page, REPLAYS[id].page);
  await page.getByRole("button", { name: /^Open the Copilot/ }).click();
  await page.waitForSelector("aside.wb-agent");
  return { context, page };
}

async function layout(page) {
  return page.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const shell = r(".wb-shell");
    const agent = r("aside.wb-agent");
    return { shell: shell && { right: shell.right, bottom: shell.bottom, width: shell.width }, agent: agent && { left: agent.left, top: agent.top, width: agent.width, height: agent.height }, mode: document.querySelector("aside.wb-agent")?.getAttribute("data-mode") };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
  const failures = [];

  // Each page's replay at 1440: at its first approval card, and at its end.
  for (const id of Object.keys(REPLAYS)) {
    const { context, page } = await open(browser, SIZES["desktop-1440"], id);
    await play(page, id, `${OUT}replay-${id}-approval.png`);
    await page.waitForTimeout(600);
    await closeReport(page, `${OUT}replay-${id}-report.png`);
    await page.screenshot({ path: `${OUT}replay-${id}.png` });
    console.log(`ok   replay ${id}`);
    await context.close();
  }

  // The dock at each size, with the Rietveld replay played through.
  for (const [name, cfg] of Object.entries(SIZES)) {
    const { context, page } = await open(browser, cfg, "full-refinement");
    await play(page, "full-refinement", null);
    await page.waitForTimeout(600);
    await closeReport(page, null);
    const box = await layout(page);
    const ok = box.shell && box.agent && box.mode === cfg.mode && (cfg.mode === "docked" ? box.shell.right <= box.agent.left + 1 : box.shell.bottom <= box.agent.top + 1);
    if (!ok) failures.push(`${name}: ${JSON.stringify(box)}`);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: mode ${box.mode}, page ${Math.round(box.shell?.width ?? 0)} px wide, Agent ${Math.round(box.agent?.width ?? 0)}×${Math.round(box.agent?.height ?? 0)}`);
    await page.screenshot({ path: `${OUT}${name}.png` });
    if (name === "desktop-1440" || name === "phone") {
      await page.getByRole("button", { name: "Close the Copilot" }).click();
      await page.waitForSelector("aside.wb-agent-rail");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}rail-${name}.png` });
    }
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

/**
 * Regenerate the README screenshot (docs/screenshots/desktop.png).
 *
 * Drives the locally-installed Chrome via playwright-core (no browser
 * download) against a running dev server, runs a real refinement of the
 * bundled Mn₃Ga + MnO POWGEN dataset so the plots show a converged fit, and
 * captures the workbench at a full-HD desktop viewport (wide enough that no
 * panel is squeezed; the app is fluid up to 2560px, then scales on 4K).
 *
 * Only the bundled public demo is opened, never a local dataset, and every
 * shot keeps the app's © line: when the page's footer is out of view, the
 * same line is pinned to the corner for the shot.
 *
 * Usage:  npm run dev   (in another terminal; or npm run build && npm run preview)
 *         node scripts/device-screenshots.mjs [baseUrl] [--out=dir]
 * CHROMIUM=/path/to/chrome picks another browser.
 */

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "http://localhost:5173/materia-platform/";
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
const OUT = outArg ? `${outArg.replace(/\/$/, "")}/` : new URL("../docs/screenshots/", import.meta.url).pathname;

/** Full-HD desktop in CSS px; 2x scale for crisp README rendering. */
const DEVICES = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
};

async function preparePage(context) {
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("header");
  // The workbench opens clean; load the bundled Rietveld demo from its landing
  // card (it opens on the converged two-phase Mn₃Ga + MnO fit).
  await page.getByRole("button", { name: /Mn₃Ga neutron TOF/ }).click();
  const refine = page.getByRole("button", { name: "Refine", exact: true }).first();
  await refine.waitFor({ timeout: 30000 });
  // The public demo, and nothing local: its two phases are on the Structure card.
  await page.getByText("Mn3Ga + MnO").first().waitFor({ timeout: 15000 });
  // Run the refinement so the parameter table shows final values with esds
  // (converges in ~2 cycles from the seeded fit; wR ~4.2%). The result line
  // reads "converged · 2 cycles"; the button comes back when the run is done.
  await refine.click();
  await page.getByText(/converged · \d+ cycles?/).first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.trim() === "Refine");
    return !!b && !b.disabled;
  }, null, { timeout: 60000 });
  // Let the plot repaint with the final curves.
  await page.waitForTimeout(600);
  return page;
}

/** A screenshot that keeps the app's © line: pinned to the corner when the page's footer is out of view. */
async function shotWithCopyright(page, path) {
  const inView = await page.evaluate(() => {
    const el = [...document.querySelectorAll("footer span, footer")].find((e) => /© \d{4} Tsung-Han Yang/.test(e.textContent ?? ""));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom <= 0 || r.top >= innerHeight) return false;
    const top = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
    return !!top && (el.contains(top) || top.contains(el));
  });
  if (!inView) {
    await page.evaluate(() => {
      const tag = document.createElement("div");
      tag.id = "shot-copyright";
      tag.textContent = "© 2026 Tsung-Han Yang";
      Object.assign(tag.style, { position: "fixed", left: "8px", bottom: "8px", zIndex: "2147483647", font: "11px/1.4 system-ui, sans-serif", color: "#6b6357", background: "rgba(255,255,255,0.85)", padding: "2px 6px", borderRadius: "4px", pointerEvents: "none" });
      document.body.appendChild(tag);
    });
  }
  await page.screenshot({ path });
  if (!inView) await page.evaluate(() => document.getElementById("shot-copyright")?.remove());
  return inView ? "footer" : "pinned";
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const executablePath = process.env.CHROMIUM;
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });

  for (const [name, cfg] of Object.entries(DEVICES)) {
    const context = await browser.newContext(cfg);
    const page = await preparePage(context);

    // The groups with free rows (Scale, Background, Lattice) open on load,
    // so the shot shows the refined values with esds without a click.

    // Frame from the top of the page (the refine-wait may have scrolled).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    const where = await shotWithCopyright(page, `${OUT}${name}.png`);
    console.log(`captured ${name}.png (${cfg.viewport.width}×${cfg.viewport.height}@${cfg.deviceScaleFactor}x, © ${where === "footer" ? "in the footer" : "pinned to the corner"})`);
    await context.close();
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

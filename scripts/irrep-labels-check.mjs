/**
 * The irrep labels in a real browser against the ones Node gives (THY-64):
 * opens scripts/irrep-labels.html, which works out every label of
 * testSupport/irrepLabelFingerprints.ts with its irrep's fingerprint (the
 * ISOTROPY oracle's cases, SrTiO₃'s and GaTa₄Se₈'s parents, the Γ chip of the
 * 32 classes), and compares them with src/core/crystal/irreps/irrepLabels.golden.json.
 * Every case must read the same: the same label on the same irrep.
 *
 * Usage:  npx vite --port 5197   (in another terminal, from the branch)
 *         node scripts/irrep-labels-check.mjs [baseUrl]
 * BROWSERS=chrome,chromium,firefox,webkit picks the browsers (default all):
 * "chrome" is the installed Google Chrome, the others Playwright's own builds
 * (npx playwright-core install firefox webkit); one that does not launch is
 * skipped. CHROMIUM=/path/to/chrome adds one more. Chrome and Chromium run V8
 * as Node does; Firefox (SpiderMonkey) and WebKit (JavaScriptCore, Safari's
 * engine) have their own Math functions, the case that differs most.
 */
import { chromium, firefox, webkit } from "playwright-core";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5197/materia-platform/";
const golden = JSON.parse(readFileSync(new URL("../src/core/crystal/irreps/irrepLabels.golden.json", import.meta.url), "utf8"));
const wanted = (process.env.BROWSERS ?? "chrome,chromium,firefox,webkit").split(",");

const launches = [];
if (wanted.includes("chrome")) launches.push(["Google Chrome", chromium, { channel: "chrome" }]);
if (wanted.includes("chromium")) launches.push(["Playwright Chromium", chromium, {}]);
if (wanted.includes("firefox")) launches.push(["Playwright Firefox", firefox, {}]);
if (wanted.includes("webkit")) launches.push(["Playwright WebKit", webkit, {}]);
if (process.env.CHROMIUM) launches.push([process.env.CHROMIUM, chromium, { executablePath: process.env.CHROMIUM }]);

let failures = 0;
let ran = 0;
for (const [name, type, options] of launches) {
  let browser;
  try {
    browser = await type.launch(options);
  } catch (e) {
    console.log(`SKIP ${name}: ${String(e).split("\n")[0]}`);
    continue;
  }
  ran++;
  const before = failures;
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}scripts/irrep-labels.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.irrepFingerprints || window.irrepFingerprintsError, null, { timeout: 600_000 });
  const error = await page.evaluate(() => window.irrepFingerprintsError ?? null);
  if (error) throw new Error(`${name}: ${error}`);
  const got = await page.evaluate(() => window.irrepFingerprints);
  const agent = await page.evaluate(() => navigator.userAgent);
  console.log(`${name}: ${agent}`);
  let irreps = 0;
  for (const [key, want] of Object.entries(golden)) {
    const have = got[key];
    irreps += want.length;
    const same = Array.isArray(have) && have.length === want.length && have.every((x, i) => x === want[i]);
    if (!same) {
      failures++;
      console.log(`FAIL ${name} · ${key}\n  Node:    ${want.join(" | ")}\n  browser: ${(have ?? []).join(" | ")}`);
    }
  }
  const extra = Object.keys(got).filter((k) => !(k in golden));
  if (extra.length) {
    failures++;
    console.log(`FAIL ${name}: cases the golden does not have: ${extra.join(", ")}`);
  }
  if (errors.length) {
    failures++;
    console.log(`FAIL ${name}: page errors ${errors.join("; ")}`);
  }
  console.log(`${failures === before ? "PASS" : "FAIL"} ${name}: ${Object.keys(golden).length} cases, ${irreps} labels`);
  await browser.close();
}
if (ran === 0) {
  console.log("FAIL no browser could be launched");
  process.exit(1);
}
process.exit(failures === 0 ? 0 : 1);

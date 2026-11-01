/**
 * The magnetic page's representation analysis on the subgroup engine
 * (THY-36) in a real browser, on public and synthetic inputs only:
 *
 *  1. the Mn₃Ga neutron TOF demo (published POWGEN data, examples/mn3ga-350k):
 *     P6₃/mmc at k = (0, 0, ½), a non-abelian little co-group (6/mmm) on the
 *     zone boundary of a non-symmorphic group, whose small representations are
 *     projective (2, 2 and 4-dimensional). Irrep 2 along (a,a) must name the
 *     type-IV group P_c-3m1 (BNS 164.90) in its magnetic cell;
 *  2. a synthetic wolframite (P2/c, M on 2f; the files `wolframite-synthetic.cif`,
 *     `.xye` and `cw-neutron.instprm` in the inputs folder) at k = (½, 0, 0):
 *     every irrep's group is the type-IV P_a2/c (BNS 13.70), not the
 *     parent-cell P2/c′ (13.68).
 *
 * Usage:  npx vite --port 5191   (in another terminal, from the branch)
 *         node scripts/magnetic-irreps-check.mjs [baseUrl] [outDir] [inputsDir]
 * CHROMIUM=/path/to/chrome overrides the browser (default: Playwright's own).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5191/materia-platform/";
const OUT = process.argv[3] ?? "./thy36-ui/";
const INPUTS = process.argv[4] ?? join(OUT, "inputs");
mkdirSync(OUT, { recursive: true });
const executablePath = process.env.CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) });
const errors = [];

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("header");
  return page;
}

async function toMagnetic(page) {
  await page.getByRole("button", { name: "Magnetic analysis →" }).click();
  await page.getByRole("button", { name: "Set k", exact: true }).waitFor();
}

async function setK(page, k) {
  const setKButton = page.getByRole("button", { name: "Set k", exact: true });
  const inputs = setKButton.locator("xpath=..").locator("input");
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(k[i]);
  await setKButton.click();
  await page.waitForTimeout(800);
}

async function representationAnalysis(page) {
  await page.getByRole("button", { name: "Representation analysis", exact: true }).click();
  await page.getByText("Γ", { exact: false }).first().waitFor();
  await page.waitForTimeout(800);
}

const sectionOf = (page) => page.locator("section").filter({ hasText: "Magnetic space group" }).last();

// ── 1. Mn₃Ga demo, k = (0, 0, ½) ──────────────────────────────────────────
{
  const page = await openPage();
  await page.getByRole("button", { name: /Mn₃Ga neutron TOF/ }).click();
  await page.waitForTimeout(2500);
  await toMagnetic(page);
  await setK(page, ["0", "0", "1/2"]);
  await representationAnalysis(page);
  const section = sectionOf(page);
  const text = await section.innerText();
  check("Mn₃Ga k = (0,0,½): Γ_mag decomposes, no refusal", /Γ\s*mag\s*=/.test(text) && !/needs the projective/.test(text), text.split("\n").find((l) => /=/.test(l)) ?? "");
  check("three small representations: 2-, 2- and 4-dimensional", /irrep 1 of 3/.test(text) && /irrep 2 of 3/.test(text) && /irrep 3 of 3/.test(text) && /4-dim/.test(text));
  const select = section.getByRole("combobox", { name: /irrep 2 of 3/ });
  await select.selectOption({ label: "(a,a)" });
  await page.waitForTimeout(1500);
  const after = await section.innerText();
  check("irrep 2 along (a,a) names P_c-3m1, BNS 164.90, in its magnetic cell", /164\.90/.test(after) && /\(a, b, 2c;/.test(after), after.split("\n").find((l) => /BNS/.test(l)) ?? "");
  check("the group is in the class of the list's candidate 1", /candidate 1 of the list/.test(after));
  await section.screenshot({ path: join(OUT, "mn3ga-k00half-irreps.png") });
  const moments = page.locator("section").filter({ hasText: "Moments — refine & continue" }).last();
  check("step 5 offers the group's moments", await moments.isVisible().catch(() => false));
  await page.screenshot({ path: join(OUT, "mn3ga-k00half-page.png"), fullPage: false });
  await page.close();
}

// ── 2. Synthetic wolframite, k = (½, 0, 0) ────────────────────────────────
{
  const page = await openPage();
  const cif = page.locator('input[type=file][accept^=".cif"]').first();
  await cif.setInputFiles(join(INPUTS, "wolframite-synthetic.cif"));
  await page.waitForTimeout(1500);
  const inst = page.locator('input[type=file][accept^=".instprm"]').first();
  await inst.setInputFiles(join(INPUTS, "cw-neutron.instprm"));
  await page.waitForTimeout(1000);
  const data = page.locator('input[type=file][accept^=".xye"]').first();
  await data.setInputFiles(join(INPUTS, "wolframite-synthetic.xye"));
  await page.waitForTimeout(2500);
  await toMagnetic(page);
  await setK(page, ["1/2", "0", "0"]);
  await representationAnalysis(page);
  const section = sectionOf(page);
  const text = await section.innerText();
  check("wolframite k = (½,0,0): four one-dimensional irreps", /irrep 4 of 4/.test(text), text.split("\n").find((l) => /=/.test(l)) ?? "");
  const boxes = section.getByRole("checkbox");
  await boxes.nth(1).check();
  await page.waitForTimeout(1200);
  const after = await section.innerText();
  check("irrep 2 names the type-IV P_a2/c, BNS 13.70 (not P2/c′ 13.68)", /13\.70/.test(after) && !/13\.68/.test(after), after.split("\n").find((l) => /BNS/.test(l)) ?? "");
  check("the setting gives the magnetic cell from the parent cell", /\(2a, b, 2a\+c; 3\/4, 0, 0\)/.test(after));
  await section.screenshot({ path: join(OUT, "wolframite-khalf00-irreps.png") });
  // The group list names the same group.
  await page.getByRole("button", { name: "Magnetic space groups", exact: true }).click();
  await page.waitForTimeout(800);
  const list = await sectionOf(page).innerText();
  check("the group list reads P_a2/c 13.70 too", /13\.70/.test(list) && !/13\.68/.test(list));
  await sectionOf(page).screenshot({ path: join(OUT, "wolframite-khalf00-groups.png") });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

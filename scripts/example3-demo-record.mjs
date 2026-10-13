/**
 * Records the Example 3 animation (scripts/example3-demo.html, filled with the
 * replay that scripts/example3-demo.ts wrote) frame by frame in Chrome, then
 * encodes docs/media/agent-example3.gif (12 fps) and .mp4 (H.264, 24 fps).
 *
 * Usage:  node scripts/example3-demo-record.mjs <replay.json> [outDir=docs/media]
 * Needs Google Chrome (playwright-core, channel "chrome") and ffmpeg.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const [json, outDir = "docs/media"] = process.argv.slice(2);
if (!json) throw new Error("usage: example3-demo-record.mjs <replay.json> [outDir]");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FPS = 24;
const here = fileURLToPath(new URL(".", import.meta.url));

// Rounded to what a 646-px plot can show, so the page stays small.
const data = JSON.parse(readFileSync(json, "utf8"));
for (const fit of [data.nuclear, data.final]) {
  for (const [k, v] of Object.entries(fit.curves)) if (Array.isArray(v)) fit.curves[k] = v.map((y) => Math.round(y * 100) / 100);
}
const work = mkdtempSync(join(tmpdir(), "materia-ex3-frames-"));
const html = join(work, "example3.html");
writeFileSync(html, readFileSync(join(here, "example3-demo.html"), "utf8").replace("/*DATA*/null", JSON.stringify(data)));

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.addInitScript(() => { window.__capture = true; });
await page.goto(`file://${html}`);
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.DURATION);
// PREVIEW=5,12,24 writes stills at those times to outDir and stops.
if (process.env.PREVIEW) {
  for (const t of process.env.PREVIEW.split(",").map(Number)) {
    await page.evaluate((s) => window.render(s), t);
    await page.screenshot({ path: join(outDir, `preview-${t}.png`) });
  }
  await browser.close();
  process.exit(0);
}
const frames = Math.round(duration * FPS);
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.render(t), i / FPS);
  await page.screenshot({ path: join(work, `f${String(i).padStart(4, "0")}.png`) });
}
await browser.close();

mkdirSync(outDir, { recursive: true });
const gif = resolve(outDir, "agent-example3.gif");
const mp4 = resolve(outDir, "agent-example3.mp4");
const input = ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(work, "f%04d.png")];
execFileSync(FFMPEG, [...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", mp4]);
execFileSync(FFMPEG, [...input, "-vf", "fps=12,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", gif]);
const kept = join(tmpdir(), "materia-example3.html");
writeFileSync(kept, readFileSync(html));
rmSync(work, { recursive: true, force: true });
for (const f of [gif, mp4]) console.log(`${f}: ${(statSync(f).size / 1e6).toFixed(2)} MB, ${duration} s`);
console.log(`page: ${kept}`);

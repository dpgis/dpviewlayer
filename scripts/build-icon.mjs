#!/usr/bin/env node
/**
 * VS Code / vsce reject SVG extension icons — PNG is required.
 * Faithfully rasterize media/icon.svg → media/icon.png via Chromium.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(root, "media", "icon.svg");
const pngPath = path.join(root, "media", "icon.png");
const RENDER = 320;
const OUT = 128;

if (!fs.existsSync(svgPath)) {
  console.error("missing", svgPath);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

function findChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No Chrome/Chromium found (set CHROME_PATH)");
}

const svg = fs.readFileSync(svgPath, "utf8");
const inline = svg
  .replace(/<\?xml[^>]*>/i, "")
  .replace(/\swidth="[^"]*"/, ` width="${RENDER}"`)
  .replace(/\sheight="[^"]*"/, ` height="${RENDER}"`);

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  html, body {
    margin: 0; padding: 0;
    width: ${RENDER}px; height: ${RENDER}px;
    background: transparent; overflow: hidden;
  }
  svg { display: block; width: ${RENDER}px; height: ${RENDER}px; }
</style>
</head><body>${inline}</body></html>`;

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

const tmp = path.join(root, "media", ".icon-render.png");
try {
  const page = await browser.newPage();
  await page.setViewport({ width: RENDER, height: RENDER, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.waitForSelector("svg");
  await new Promise((r) => setTimeout(r, 150));
  const buf = await page.screenshot({
    type: "png",
    omitBackground: true,
    clip: { x: 0, y: 0, width: RENDER, height: RENDER },
  });
  fs.writeFileSync(tmp, buf);
  if (buf.length < 2000) {
    throw new Error(`SVG render too small (${buf.length} bytes) — check Chromium output`);
  }
  execFileSync(
    "python3",
    [
      "-c",
      `from PIL import Image
src = Image.open(${JSON.stringify(tmp)}).convert("RGBA")
src.resize((${OUT}, ${OUT}), Image.Resampling.LANCZOS).save(${JSON.stringify(pngPath)}, "PNG")
print("wrote", ${JSON.stringify(pngPath)}, "source", src.size, "bytes", ${buf.length})
`,
    ],
    { stdio: "inherit" },
  );
} finally {
  await browser.close();
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
}

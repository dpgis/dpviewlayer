#!/usr/bin/env node
/**
 * Headless CRS smoke: with-CRS reprojects on map CRS switch; no-CRS retags only.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

function buildBundle() {
  const esbuild = path.join(root, "node_modules/.bin/esbuild");
  const r = spawnSync(
    esbuild,
    [
      path.join(__dirname, "crs-harness.js"),
      "--bundle",
      "--outfile=" + path.join(__dirname, "crs-bundle.js"),
      "--format=iife",
      "--platform=browser",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
}

function contentType(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".tif") || p.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>CRS Smoke</title>
  <style>
    html, body { margin: 0; height: 100%; background: #111; color: #eee; font: 12px monospace; }
    #map { width: 800px; height: 800px; background: #222; }
    #out { padding: 12px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="map"></div>
  <pre id="out">running…</pre>
  <script src="./crs-bundle.js"></script>
  <script>
    runCrsSmoke().catch((e) => {
      const result = { ok: false, error: String(e && e.stack || e) };
      window.__SMOKE_RESULT__ = result;
      document.getElementById("out").textContent = JSON.stringify(result, null, 2);
      console.error(e);
    });
  </script>
</body>
</html>`;

async function main() {
  buildBundle();
  fs.writeFileSync(path.join(__dirname, "crs-index.html"), html);

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath;
    if (url === "/" || url === "/crs-index.html") filePath = path.join(__dirname, "crs-index.html");
    else if (url === "/crs-bundle.js") filePath = path.join(__dirname, "crs-bundle.js");
    else if (url.startsWith("/scripts/smoke/")) filePath = path.join(root, url.slice(1));
    else filePath = path.join(root, url.replace(/^\//, ""));
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end("not found " + url);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/crs-index.html`;

  const puppeteer = require("puppeteer-core");
  const executablePath =
    process.env.CHROME_PATH ||
    ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/snap/bin/chromium"].find((p) =>
      fs.existsSync(p),
    );

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  page.on("console", (msg) => console.error("[page]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.error("[pageerror]", err));

  await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });

  const result = await page
    .waitForFunction(() => window.__SMOKE_RESULT__ != null, { timeout: 90000 })
    .then(() => page.evaluate(() => window.__SMOKE_RESULT__));

  const shotPath = path.join(__dirname, "crs-smoke-result.png");
  await page.screenshot({ path: shotPath, fullPage: true });

  await browser.close();
  server.close();

  console.log(JSON.stringify(result, null, 2));
  console.log("screenshot:", shotPath);
  if (!result?.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

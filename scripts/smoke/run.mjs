#!/usr/bin/env node
/**
 * Headless smoke: menu groups + JPG→mask stack visibility using project test images.
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
      path.join(__dirname, "harness.js"),
      "--bundle",
      "--outfile=" + path.join(__dirname, "bundle.js"),
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

function menuPayload() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.contributes.menus["explorer/context"];
}

function contentType(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function main() {
  buildBundle();
  const menu = menuPayload();
  const html = fs
    .readFileSync(path.join(__dirname, "index.template.html"), "utf8")
    .replace("__MENU_JSON__", JSON.stringify(menu));
  fs.writeFileSync(path.join(__dirname, "index.html"), html);

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath;
    if (url === "/" || url === "/index.html") filePath = path.join(__dirname, "index.html");
    else if (url.startsWith("/scripts/smoke/")) filePath = path.join(root, url.slice(1));
    else if (url === "/bundle.js") filePath = path.join(__dirname, "bundle.js");
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
  const url = `http://127.0.0.1:${port}/`;

  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    console.error("puppeteer-core missing");
    process.exit(1);
  }

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
  page.setDefaultTimeout(60000);
  page.on("console", (msg) => console.error("[page]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.error("[pageerror]", err));

  await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });

  const result = await page.waitForFunction(
    () => window.__SMOKE_RESULT__ != null,
    { timeout: 60000 },
  ).then(() => page.evaluate(() => window.__SMOKE_RESULT__));

  const shotPath = path.join(__dirname, "smoke-result.png");
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

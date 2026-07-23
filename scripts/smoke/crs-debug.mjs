#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

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
if (r.status) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  console.log("REQ", url, "range=", req.headers.range || "-");
  let filePath;
  if (url === "/" || url === "/crs-index.html") filePath = path.join(__dirname, "crs-index.html");
  else if (url === "/crs-bundle.js") filePath = path.join(__dirname, "crs-bundle.js");
  else if (url.startsWith("/scripts/smoke/")) filePath = path.join(root, url.slice(1));
  else filePath = path.join(root, url.replace(/^\//, ""));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    console.log("404", filePath);
    res.writeHead(404);
    res.end("not found " + url);
    return;
  }
  const buf = fs.readFileSync(filePath);
  const range = req.headers.range;
  if (range) {
    const m = String(range).match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : buf.length - 1;
      const slice = buf.subarray(start, end + 1);
      res.writeHead(206, {
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${buf.length}`,
        "Content-Length": slice.length,
      });
      res.end(slice);
      return;
    }
  }
  res.writeHead(200, {
    "Content-Type": url.endsWith(".html")
      ? "text/html"
      : url.endsWith(".js")
        ? "text/javascript"
        : "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Content-Length": buf.length,
  });
  res.end(buf);
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const puppeteer = require("puppeteer-core");
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage();
page.on("console", (m) => console.error("CONSOLE", m.type(), m.text()));
page.on("pageerror", (e) => console.error("PAGEERROR", String(e)));
page.on("requestfailed", (req) => console.error("REQFAIL", req.url(), req.failure()?.errorText));
page.on("response", (res) => {
  if (res.status() >= 400) console.error("HTTP", res.status(), res.url());
});
await page.goto(`http://127.0.0.1:${port}/crs-index.html`, { waitUntil: "networkidle0" });
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const out = await page.evaluate(() => ({
    result: window.__SMOKE_RESULT__,
    text: document.getElementById("out")?.textContent?.slice(0, 1500),
  }));
  if (out.result) {
    console.log("RESULT", JSON.stringify(out.result, null, 2));
    break;
  }
  console.log("waiting…", i, out.text?.slice(0, 120));
}
await browser.close();
server.close();

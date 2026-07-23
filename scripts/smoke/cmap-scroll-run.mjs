#!/usr/bin/env node
/**
 * Headless check: many colormap rows must scroll inside .cmap-table-wrap,
 * not stretch .side / .side-tabs.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="/media/main.css" />
  <title>cmap scroll smoke</title>
</head>
<body class="render-paletted">
  <div class="main" id="main">
    <div class="map-wrap" id="map"></div>
    <div class="h-split" id="splitSide"></div>
    <aside class="side" id="side">
      <div class="side-top" id="sideTop">
        <div class="layer-head-row"><span class="layer-head-title">图层</span></div>
        <div class="file-panel"><ul class="file-list"><li class="file-item">mask.png</li></ul></div>
        <div class="side-header"><div class="side-geo"><div class="geo-row"><span class="geo-k">信息</span><span class="geo-v">test</span></div></div></div>
      </div>
      <div class="v-split" id="splitInfo"></div>
      <div class="side-tabs" id="sideTabs">
        <div class="tab-bar"><button type="button" class="tab-btn is-active">样式</button></div>
        <div class="tab-panel is-active" id="panelStyle">
          <div class="symbology">
            <div class="form-row form-row-full"><select class="field field-grow"><option>调色板/唯一值</option></select></div>
            <div id="panelPaletted" class="render-panel panel-paletted">
              <div class="form-row"><span class="form-label">波段</span><select class="field field-grow"><option>1</option></select></div>
              <div class="form-row"><span class="form-label">颜色渐变</span><select class="field field-grow"><option>Random</option></select></div>
              <div class="cmap-table-wrap" id="cmapWrap">
                <table class="cmap-table" id="cmapTable">
                  <thead><tr><th>值</th><th>颜色</th><th>标注</th></tr></thead>
                  <tbody id="cmapBody"></tbody>
                </table>
              </div>
              <div class="cmap-toolbar"><button type="button" class="btn">分类</button></div>
            </div>
          </div>
        </div>
      </div>
      <div class="map-section" id="mapSection">
        <div class="map-foot"><div class="map-head-row"><span class="map-head-title">地图</span></div></div>
        <div class="status-bar"><div class="status-hover">—</div></div>
      </div>
    </aside>
  </div>
  <script>
    const body = document.getElementById("cmapBody");
    let rows = "";
    for (let i = 0; i < 120; i++) {
      rows += '<tr><td>' + i + '</td><td style="background:#333;width:24px"></td><td>c' + i + '</td></tr>';
    }
    body.innerHTML = rows;
    const side = document.getElementById("side");
    const tabs = document.getElementById("sideTabs");
    const wrap = document.getElementById("cmapWrap");
    const measure = () => {
      const s = side.getBoundingClientRect();
      const t = tabs.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      window.__SMOKE_RESULT__ = {
        ok:
          wrap.scrollHeight > wrap.clientHeight + 20 &&
          wrap.clientHeight > 40 &&
          Math.abs(side.scrollHeight - side.clientHeight) < 2 &&
          t.height < s.height,
        side: { h: s.height, scrollH: side.scrollHeight, clientH: side.clientHeight },
        tabs: { h: t.height },
        wrap: {
          h: w.height,
          clientH: wrap.clientHeight,
          scrollH: wrap.scrollHeight,
          overflowY: getComputedStyle(wrap).overflowY,
        },
      };
    };
    requestAnimationFrame(() => requestAnimationFrame(measure));
  </script>
</body>
</html>`;

async function main() {
  fs.writeFileSync(path.join(__dirname, "cmap-scroll-index.html"), html);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath;
    if (url === "/" || url === "/cmap-scroll-index.html") {
      filePath = path.join(__dirname, "cmap-scroll-index.html");
    } else if (url.startsWith("/media/")) {
      filePath = path.join(root, url.slice(1));
    } else {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    const ct = filePath.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8";
    res.writeHead(200, { "Content-Type": ct });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  const puppeteer = require("puppeteer-core");
  const executablePath =
    process.env.CHROME_PATH ||
    ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/snap/bin/chromium"].find((p) =>
      fs.existsSync(p),
    );
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/cmap-scroll-index.html`, {
    waitUntil: "networkidle0",
  });
  const result = await page
    .waitForFunction(() => window.__SMOKE_RESULT__ != null, { timeout: 15000 })
    .then(() => page.evaluate(() => window.__SMOKE_RESULT__));
  const shot = path.join(__dirname, "cmap-scroll-result.png");
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  server.close();
  console.log(JSON.stringify(result, null, 2));
  console.log("screenshot:", shot);
  if (!result?.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

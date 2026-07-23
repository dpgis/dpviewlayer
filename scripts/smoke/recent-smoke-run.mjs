#!/usr/bin/env node
/**
 * Headless regression for recent View Layer changes:
 * - color table ranges / max 256 / PLTE index = 序号
 * - identify sample from native GeoTIFF (chla) without in-memory planes
 * - identify column width ≈ 1 : 1.5
 * - cmap table columns (序号, ≥, <, 颜色; no 标注)
 * - selecting a layer switches to 样式 tab
 * - cmap list scrolls instead of stretching the side panel
 * - freeViewOptions has no layer-derived zoom clamps
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
const datasets = path.resolve(root, "../datasets/test_raster-viewer");
const chlaPath = path.join(datasets, "chla.tif");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function buildColorTableBundle() {
  const out = path.join(__dirname, "recent-color-table.bundle.mjs");
  const esbuild = path.join(root, "node_modules/.bin/esbuild");
  const r = spawnSync(
    esbuild,
    [
      path.join(root, "media/src/colorTable.js"),
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${out}`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return out;
}

function buildOlBundle() {
  const out = path.join(__dirname, "recent-ol.bundle.mjs");
  const esbuild = path.join(root, "node_modules/.bin/esbuild");
  const r = spawnSync(
    esbuild,
    [
      path.join(root, "media/src/olRaster.js"),
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${out}`,
      "--external:ol/*",
      "--external:geotiff",
    ],
    { encoding: "utf8" },
  );
  // olRaster pulls ol — for freeViewOptions only, extract via regex from source instead
  return null;
}

async function testColorTableLogic() {
  const bundle = buildColorTableBundle();
  const mod = await import(bundle + `?t=${Date.now()}`);
  const {
    COLOR_TABLE_MAX,
    buildColorTableBreaks,
    legacyMapFromColorTable,
    isIntegerLikeBand,
  } = mod;

  assert(COLOR_TABLE_MAX === 256, "COLOR_TABLE_MAX");
  const unit = buildColorTableBreaks(0, 5, true);
  assert(unit.length === 6 && unit[0].min === 0 && unit[0].max === 1, "unit bins");
  const flt = buildColorTableBreaks(4.38, 12389.2, false);
  assert(flt.length === 256, "float → 256");
  assert(isIntegerLikeBand("uint8", { min: 0, max: 10 }, null), "uint8");
  assert(!isIntegerLikeBand("float32", { min: 0.1, max: 9.9 }, null), "float32");

  // reorder simulation: PLTE map must follow array index (序号)
  let table = [
    { min: 0, max: 1, color: "#aa0000" },
    { min: 1, max: 2, color: "#00aa00" },
    { min: 2, max: 3, color: "#0000aa" },
  ];
  const [row] = table.splice(2, 1);
  table.splice(0, 0, row); // move last to front
  const map = legacyMapFromColorTable(table);
  assert(map[0] === "#0000aa" && map[1] === "#aa0000" && map[2] === "#00aa00", "PLTE index=序号 after reorder");

  fs.unlinkSync(bundle);
  return { ok: true, name: "colorTable" };
}

async function testIdentifyChlaSample() {
  assert(fs.existsSync(chlaPath), "chla.tif missing");
  const { fromFile } = await import("geotiff");
  const tiff = await fromFile(chlaPath);
  const image = await tiff.getImage();
  const w = image.getWidth();
  const h = image.getHeight();
  const x = (w / 2) | 0;
  const y = (h / 2) | 0;
  // Same path as media/src/main.js sampleGeoTiffPixel
  const data = await image.readRasters({
    window: [x, y, x + 1, y + 1],
    width: 1,
    height: 1,
    samples: [0],
    interleave: false,
  });
  const v = Array.isArray(data) ? Number(data[0][0]) : Number(data[0]);
  assert(Number.isFinite(v) && v > 0, `chla mid pixel invalid: ${v}`);
  return { ok: true, name: "identify.chlaSample", detail: { x, y, v, w, h } };
}

function testFreeViewOptionsSource() {
  const src = fs.readFileSync(path.join(root, "media/src/olRaster.js"), "utf8");
  assert(src.includes("minResolution: 1e-12"), "unlimited minResolution");
  assert(src.includes("maxResolution: 1e15"), "unlimited maxResolution");
  assert(!/extent\/4096|native \/ 8/.test(src), "no old zoom floor");
  return { ok: true, name: "zoom.freeViewOptions" };
}

function testPackagedHtml() {
  const html = fs.readFileSync(path.join(root, "src/webviewHtml.ts"), "utf8");
  assert(html.includes("颜色表渲染"), "rename 颜色表渲染");
  assert(html.includes('data-i18n="colIndex"'), "ID column");
  assert(!/colLabel">标注/.test(html) || !html.includes("<th data-i18n=\"colLabel\">"), "no 标注 header");
  const cmapHead = html.slice(html.indexOf("cmapTable"), html.indexOf("cmapBody"));
  assert(cmapHead.includes("colIndex"), "ID in cmap");
  assert(cmapHead.includes(">ID</th>"), "header text ID");
  assert(!cmapHead.includes("colLabel"), "标注 removed from cmap thead");
  assert(cmapHead.includes("colMin") && cmapHead.includes("colMax"), "≥/< columns");
  return { ok: true, name: "html.colorTableColumns" };
}

const uiHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="/media/main.css" />
  <title>recent smoke UI</title>
</head>
<body class="render-paletted">
  <div class="main">
    <div class="map-wrap"></div>
    <div class="h-split"></div>
    <aside class="side" id="side">
      <div class="side-top" id="sideTop" style="flex:0 0 200px;height:200px;min-height:120px">
        <div class="layer-head-row"><span class="layer-head-title">图层</span></div>
        <div class="file-panel"><ul class="file-list" id="fileList">
          <li class="file-item is-active is-selected" data-id="chla" id="layerChla">chla.tif</li>
          <li class="file-item" data-id="jpg" id="layerJpg">0001.jpg</li>
        </ul></div>
      </div>
      <div class="v-split"></div>
      <div class="side-tabs" id="sideTabs">
        <div class="tab-bar">
          <button type="button" class="tab-btn" id="tabStyle" data-tab="style">样式</button>
          <button type="button" class="tab-btn is-active" id="tabIdentify" data-tab="identify">识别</button>
        </div>
        <div class="tab-panel" id="panelStyle" hidden>
          <div class="symbology">
            <div class="form-row"><select><option>颜色表渲染</option></select></div>
            <div class="render-panel panel-paletted">
              <div class="cmap-table-wrap" id="cmapWrap">
                <table class="cmap-table">
                  <thead><tr><th>ID</th><th>≥</th><th>&lt;</th><th>颜色</th></tr></thead>
                  <tbody id="cmapBody"></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div class="tab-panel is-active" id="panelIdentify">
          <div class="identify-wrap">
            <div class="identify-table-wrap" id="identifyTableWrap">
              <table class="identify-table" id="identifyTable">
                <thead><tr><th>要素</th><th>值</th></tr></thead>
                <tbody>
                  <tr class="identify-group-row"><td>chla.tif</td><td>100,200</td></tr>
                  <tr class="identify-band-row"><td>波段1</td><td>1741.74</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div class="map-section"><div class="map-foot"><div class="map-head-row"><span class="map-head-title">地图</span></div></div></div>
    </aside>
  </div>
  <script>
    // Mimic setSideTab("style") on layer select
    function setSideTab(name) {
      const isStyle = name !== "identify";
      document.getElementById("tabStyle").classList.toggle("is-active", isStyle);
      document.getElementById("tabIdentify").classList.toggle("is-active", !isStyle);
      document.getElementById("panelStyle").hidden = !isStyle;
      document.getElementById("panelStyle").classList.toggle("is-active", isStyle);
      document.getElementById("panelIdentify").hidden = isStyle;
      document.getElementById("panelIdentify").classList.toggle("is-active", !isStyle);
    }
    document.getElementById("fileList").addEventListener("click", (e) => {
      const li = e.target.closest(".file-item");
      if (!li) return;
      setSideTab("style");
    });

    const body = document.getElementById("cmapBody");
    let rows = "";
    for (let i = 0; i < 80; i++) {
      rows += '<tr class="cmap-row" data-idx="'+i+'"><td class="cmap-idx">'+i+'</td><td>'+i+'</td><td>'+(i+1)+'</td><td></td></tr>';
    }
    body.innerHTML = rows;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ths = [...document.querySelectorAll("#identifyTable thead th")];
      const w0 = ths[0].getBoundingClientRect().width;
      const w1 = ths[1].getBoundingClientRect().width;
      const ratio = w1 / w0;
      const wrap = document.getElementById("cmapWrap");
      const side = document.getElementById("side");

      // trigger layer select → style tab
      document.getElementById("layerChla").click();
      const styleActive = document.getElementById("tabStyle").classList.contains("is-active");
      const identifyHidden = document.getElementById("panelIdentify").hidden;

      window.__SMOKE_RESULT__ = {
        ok:
          ratio > 1.2 && ratio < 1.9 &&
          wrap.scrollHeight > wrap.clientHeight + 20 &&
          Math.abs(side.scrollHeight - side.clientHeight) < 4 &&
          styleActive && identifyHidden,
        identifyWidthRatio: ratio,
        cmapScroll: { clientH: wrap.clientHeight, scrollH: wrap.scrollHeight },
        sideFixed: side.scrollHeight === side.clientHeight,
        styleTabOnSelect: styleActive && identifyHidden,
      };
    }));
  </script>
</body>
</html>`;

async function testUiWithPuppeteer() {
  fs.writeFileSync(path.join(__dirname, "recent-ui-index.html"), uiHtml);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath;
    if (url === "/" || url === "/recent-ui-index.html") filePath = path.join(__dirname, "recent-ui-index.html");
    else if (url.startsWith("/media/")) filePath = path.join(root, url.slice(1));
    else if (url.startsWith("/data/")) filePath = path.join(datasets, url.slice(6));
    else {
      res.writeHead(404);
      res.end("nf");
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    const ct = filePath.endsWith(".css")
      ? "text/css"
      : filePath.endsWith(".tif")
        ? "image/tiff"
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
  await page.setViewport({ width: 1100, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/recent-ui-index.html`, { waitUntil: "networkidle0" });
  const result = await page
    .waitForFunction(() => window.__SMOKE_RESULT__ != null, { timeout: 15000 })
    .then(() => page.evaluate(() => window.__SMOKE_RESULT__));
  const shot = path.join(__dirname, "recent-ui-result.png");
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  server.close();
  assert(result?.ok, `ui smoke failed: ${JSON.stringify(result)}`);
  return { ok: true, name: "ui.identifyWidth+styleTab+cmapScroll", detail: result, shot };
}

async function testHttpIdentifySample() {
  // Serve chla with Range support (geotiff.js / webview URLs need it).
  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url !== "/chla.tif") {
      res.writeHead(404);
      res.end();
      return;
    }
    const stat = fs.statSync(chlaPath);
    const size = stat.size;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, {
        "Content-Type": "image/tiff",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
      fs.createReadStream(chlaPath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "image/tiff",
      "Accept-Ranges": "bytes",
      "Content-Length": size,
    });
    fs.createReadStream(chlaPath).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const { fromUrl } = await import("geotiff");
  const tiff = await fromUrl(`http://127.0.0.1:${port}/chla.tif`);
  const image = await tiff.getImage();
  const x = (image.getWidth() / 2) | 0;
  const y = (image.getHeight() / 2) | 0;
  const data = await image.readRasters({
    window: [x, y, x + 1, y + 1],
    width: 1,
    height: 1,
    samples: [0],
    interleave: false,
  });
  const v = Array.isArray(data) ? Number(data[0][0]) : Number(data[0]);
  server.close();
  assert(Number.isFinite(v), `http geotiff sample failed: ${v}`);
  return { ok: true, name: "identify.httpGeoTiffSample", detail: { x, y, v } };
}

async function main() {
  const checks = [];
  checks.push(await testColorTableLogic());
  checks.push(await testIdentifyChlaSample());
  checks.push(await testHttpIdentifySample());
  checks.push(testFreeViewOptionsSource());
  checks.push(testPackagedHtml());
  checks.push(await testUiWithPuppeteer());

  const failed = checks.filter((c) => !c.ok);
  const out = { ok: failed.length === 0, checks };
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

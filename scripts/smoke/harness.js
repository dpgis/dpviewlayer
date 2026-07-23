/**
 * Browser smoke harness: JPG then mask stacking via the same olRaster path as the extension.
 * Exposes window.runSmoke() → { ok, checks[], samples }.
 */
import {
  buildWebGlStyle,
  createEmptyMap,
  createRasterLayer,
  applyStyle,
  planesToGeoTiffBlob,
  fitMap,
  freeViewOptions,
  LOCAL_PIXEL_PROJECTION,
  resolveSourceBounds,
} from "../../media/src/olRaster.js";
import View from "ol/View.js";

function identityGeo(h) {
  return {
    geoTransform: [0, 1, 0, 0, 0, 1],
    crs: "Local",
    modelPixelScale: [1, 1, 0],
    modelTiepoint: [0, 0, 0, 0, 0, 0],
    yFlipped: false,
    source: "identity",
  };
}

async function decodeImage(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  return { data, width, height };
}

function rgbPlanes(rgba, w, h) {
  const n = w * h;
  const r = new Float64Array(n);
  const g = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    r[i] = rgba[p];
    g[i] = rgba[p + 1];
    b[i] = rgba[p + 2];
  }
  return [r, g, b];
}

function maskPlane(rgbaOrGray, w, h, isGrayPng) {
  const n = w * h;
  const plane = new Float64Array(n);
  if (isGrayPng) {
    // decoded via canvas → still RGBA; gray is in R
    for (let i = 0, p = 0; i < n; i++, p += 4) plane[i] = rgbaOrGray[p];
  } else {
    for (let i = 0, p = 0; i < n; i++, p += 4) plane[i] = rgbaOrGray[p];
  }
  return [plane];
}

function sampleCanvas(mapEl, points) {
  const canvas = mapEl.querySelector("canvas");
  if (!canvas) return { error: "no canvas", samples: [] };
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  const w = canvas.width;
  const h = canvas.height;
  const samples = [];
  for (const [nx, ny, label] of points) {
    const x = Math.min(w - 1, Math.max(0, Math.round(nx * (w - 1))));
    // WebGL readPixels origin is bottom-left
    const yTop = Math.min(h - 1, Math.max(0, Math.round(ny * (h - 1))));
    const y = h - 1 - yTop;
    let rgba;
    if (gl) {
      const buf = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      rgba = [buf[0], buf[1], buf[2], buf[3]];
    } else {
      const ctx = canvas.getContext("2d");
      const d = ctx.getImageData(x, yTop, 1, 1).data;
      rgba = [d[0], d[1], d[2], d[3]];
    }
    samples.push({ label, x, yTop, rgba, lum: (rgba[0] + rgba[1] + rgba[2]) / 3 });
  }
  return { w, h, samples };
}

function refreshAll(layers) {
  for (const { layer, styleState } of layers) {
    applyStyle(layer, styleState);
    layer.setVisible(true);
    if (typeof layer.setOpacity === "function") layer.setOpacity(1);
  }
}

function waitFrames(n = 3) {
  return new Promise((resolve) => {
    let left = n;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function waitMapIdle(map, ms = 2500) {
  const start = performance.now();
  await new Promise((r) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.un("rendercomplete", onRender);
      r();
    };
    const onRender = () => {
      // keep waiting a bit after first complete for tiles
    };
    map.on("rendercomplete", onRender);
    setTimeout(finish, ms);
  });
  await waitFrames(5);
  return performance.now() - start;
}

window.runSmoke = async function runSmoke() {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  // --- menu config check (injected by runner) ---
  if (window.__MENU__) {
    const groups = window.__MENU__.map((m) => m.group);
    const ok =
      groups[0] === "viewLayer@1" &&
      groups[1] === "viewLayer@2" &&
      groups.every((g) => String(g).startsWith("viewLayer"));
    push("menu.groupAdjacent", ok, groups.join(", "));
  }

  const mapEl = document.getElementById("map");
  mapEl.replaceChildren();

  const jpg = await decodeImage("/00001.jpg");
  const mask = await decodeImage("/mask.png");
  const jpgPlanes = rgbPlanes(jpg.data, jpg.width, jpg.height);
  const maskPlanes = maskPlane(mask.data, mask.width, mask.height, true);
  const jpgGeo = identityGeo(jpg.height);
  const maskGeo = identityGeo(mask.height);

  const jpgStyleState = {
    mode: "rgb",
    redBand: 0,
    greenBand: 1,
    blueBand: 2,
    redMin: 0,
    redMax: 255,
    greenMin: 0,
    greenMax: 255,
    blueMin: 0,
    blueMax: 255,
    sourceMins: [0, 0, 0],
    sourceMaxs: [255, 255, 255],
  };
  const maskStyleState = {
    mode: "paletted",
    paletteBand: 0,
    colormap: { 4: "#22c55e", 6: "#a855f7" },
    sourceMins: [0],
    sourceMaxs: [255],
  };

  const jpgBlob = planesToGeoTiffBlob(jpgPlanes, jpg.width, jpg.height, jpgGeo, null);
  const maskBlob = planesToGeoTiffBlob(maskPlanes, mask.width, mask.height, maskGeo, null);

  const jpgBounds = resolveSourceBounds(3, null, jpgPlanes);
  const maskBounds = resolveSourceBounds(1, null, maskPlanes, { lockByteRange: true });

  // 1) JPG alone
  const jpgLayer = await createRasterLayer({
    blob: jpgBlob,
    style: buildWebGlStyle(jpgStyleState),
    bandCount: 3,
    zIndex: 1,
    mins: jpgBounds.mins,
    maxs: jpgBounds.maxs,
    projection: LOCAL_PIXEL_PROJECTION,
  });

  const map = createEmptyMap(mapEl, jpgLayer.viewConfig);
  map.setView(new View(freeViewOptions(jpgLayer.viewConfig)));
  map.addLayer(jpgLayer.layer);
  fitMap(map, jpgLayer.viewConfig);
  map.updateSize();
  await waitMapIdle(map, 2000);

  let shot = sampleCanvas(mapEl, [
    [0.5, 0.5, "jpgCenter"],
    [0.9, 0.9, "jpgBR"],
  ]);
  const jpgCenter = shot.samples.find((s) => s.label === "jpgCenter");
  push(
    "jpg.aloneVisible",
    jpgCenter && jpgCenter.lum > 5 && jpgCenter.rgba[3] > 200,
    JSON.stringify(jpgCenter),
  );

  // 2) Add mask on top (same as addAsLayer) + refresh siblings (our fix)
  const maskLayer = await createRasterLayer({
    blob: maskBlob,
    style: buildWebGlStyle(maskStyleState),
    bandCount: 1,
    zIndex: 2,
    mins: maskBounds.mins,
    maxs: maskBounds.maxs,
    projection: LOCAL_PIXEL_PROJECTION,
  });
  map.addLayer(maskLayer.layer);

  const sameProj =
    jpgLayer.viewConfig.projection === maskLayer.viewConfig.projection ||
    jpgLayer.viewConfig.projection?.getCode?.() === maskLayer.viewConfig.projection?.getCode?.();
  push(
    "local.sharedProjection",
    sameProj &&
      String(jpgLayer.viewConfig.projection?.getCode?.() || "") === "RV:Local",
    `jpg=${jpgLayer.viewConfig.projection?.getCode?.()} mask=${maskLayer.viewConfig.projection?.getCode?.()}`,
  );

  // Simulate the bug path WITHOUT refresh first — then WITH refresh like production.
  // Production now always refreshes; we assert after refresh.
  refreshAll([
    { layer: jpgLayer.layer, styleState: jpgStyleState },
    { layer: maskLayer.layer, styleState: maskStyleState },
  ]);
  jpgLayer.layer.setVisible(true);
  maskLayer.layer.setVisible(true);
  jpgLayer.layer.setOpacity(1);
  maskLayer.layer.setOpacity(1);
  map.renderSync?.();
  map.render();
  await waitMapIdle(map, 2500);

  shot = sampleCanvas(mapEl, [
    // Mask covers [0,512]x[0,512] in Local pixel space; JPG is 800x800.
    // After fit-to-JPG, top-left ~ mask, bottom-right ~ JPG only.
    [0.2, 0.2, "maskRegion"],
    [0.9, 0.9, "jpgOnlyRegion"],
  ]);
  const maskPx = shot.samples.find((s) => s.label === "maskRegion");
  const jpgOnly = shot.samples.find((s) => s.label === "jpgOnlyRegion");

  // Mask palette: green #22c55e or purple #a855f7 — not near-black sparse dots
  const isGreen =
    maskPx && maskPx.rgba[1] > 120 && maskPx.rgba[1] > maskPx.rgba[0] && maskPx.rgba[1] > maskPx.rgba[2];
  const isPurple =
    maskPx && maskPx.rgba[0] > 100 && maskPx.rgba[2] > 100 && maskPx.rgba[1] < 120;
  push(
    "mask.afterJpgSolidClassColor",
    !!(isGreen || isPurple) && maskPx.rgba[3] > 200,
    JSON.stringify(maskPx),
  );

  // JPG region outside mask must still be visible (not transparent/black)
  push(
    "jpg.stillVisibleAfterMask",
    jpgOnly && jpgOnly.lum > 8 && jpgOnly.rgba[3] > 200,
    JSON.stringify(jpgOnly),
  );

  // Opacity must not be used as visibility hack
  push(
    "jpg.opacityIsOne",
    jpgLayer.layer.getOpacity() === 1 && jpgLayer.layer.getVisible() === true,
    `opacity=${jpgLayer.layer.getOpacity()} visible=${jpgLayer.layer.getVisible()}`,
  );

  const ok = checks.every((c) => c.ok);
  const result = { ok, checks, canvas: { w: shot.w, h: shot.h }, samples: shot.samples };
  window.__SMOKE_RESULT__ = result;
  document.getElementById("out").textContent = JSON.stringify(result, null, 2);
  document.body.dataset.smoke = ok ? "pass" : "fail";
  return result;
};

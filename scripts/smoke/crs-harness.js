/**
 * CRS policy smoke: with-CRS layers reproject on map CRS switch;
 * no-CRS layers retag (same affine numbers) — no coordinate reprojection.
 */
import {
  buildWebGlStyle,
  createEmptyMap,
  createRasterLayer,
  planesToGeoTiffBlob,
  freeViewOptions,
  resolveSourceBounds,
  normalizeEpsg,
} from "../../media/src/olRaster.js";
import { applyMapViewCrs, ensureProjection } from "../../media/src/mapCrs.js";
import { transformExtent } from "ol/proj.js";
import View from "ol/View.js";

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

async function waitMapIdle(map, ms = 2000) {
  await new Promise((r) => setTimeout(r, ms));
  await waitFrames(5);
}

function identityGeo(h) {
  return {
    geoTransform: [0, 1, 0, h || 0, 0, -1],
    crs: "Local",
    modelPixelScale: [1, 1, 0],
    modelTiepoint: [0, 0, 0, 0, h || 0, 0],
    yFlipped: true,
    source: "identity",
  };
}

function fileHasOwnCrs(g) {
  return g?.source === "geotiff" && !!normalizeEpsg(g?.crs);
}

function applyLayerCrsPolicy(g, mapCrs) {
  if (normalizeEpsg(g?.crs)) return g;
  return { ...g, crs: mapCrs || "EPSG:3857" };
}

function blobCrsForGeo(fileGeo, mapCrs) {
  if (fileGeo?.source === "geotiff") {
    const fileEpsg = normalizeEpsg(fileGeo.crs);
    if (fileEpsg) return `EPSG:${fileEpsg}`;
  }
  const mapEpsg = normalizeEpsg(mapCrs);
  return mapEpsg ? `EPSG:${mapEpsg}` : mapCrs || "EPSG:3857";
}

function projCode(p) {
  try {
    return String(p?.getCode?.() || p || "");
  } catch {
    return String(p || "");
  }
}

function nearly(a, b, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

function extentClose(a, b, eps = 1.0) {
  if (!a || !b || a.length < 4 || b.length < 4) return false;
  return a.every((v, i) => nearly(v, b[i], eps));
}

function sampleCenter(mapEl) {
  const canvas = mapEl.querySelector("canvas");
  if (!canvas) return null;
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  const w = canvas.width;
  const h = canvas.height;
  const x = Math.floor(w / 2);
  const y = Math.floor(h / 2);
  if (gl) {
    const buf = new Uint8Array(4);
    gl.readPixels(x, h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { rgba: [...buf], lum: (buf[0] + buf[1] + buf[2]) / 3 };
  }
  return null;
}

window.runCrsSmoke = async function runCrsSmoke() {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  let mapCrs = "EPSG:3857";
  ensureProjection(mapCrs);
  ensureProjection("EPSG:4326");
  ensureProjection("EPSG:32649");

  const mapEl = document.getElementById("map");
  mapEl.replaceChildren();

  // --- synthetic no-CRS RGB ---
  const w = 64;
  const h = 64;
  const n = w * h;
  const r = new Float64Array(n);
  const g = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = 200;
    g[i] = 40;
    b[i] = 40;
  }
  let noCrsGeo = applyLayerCrsPolicy(identityGeo(h), mapCrs);
  push("policy.noCrsAssignedMap", noCrsGeo.crs === "EPSG:3857", noCrsGeo.crs);
  push("policy.noCrsNotOwn", !fileHasOwnCrs(noCrsGeo), JSON.stringify(noCrsGeo));

  const noCrsExtentBefore = [0, 0, w, h]; // expected pixel-ish after encode (tie at top)
  const noCrsBlob3857 = planesToGeoTiffBlob(
    [r, g, b],
    w,
    h,
    noCrsGeo,
    blobCrsForGeo(noCrsGeo, mapCrs),
  );
  const noCrsBounds = resolveSourceBounds(3, null, [r, g, b]);
  const noCrsStyle = buildWebGlStyle({
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
    sourceMins: noCrsBounds.mins,
    sourceMaxs: noCrsBounds.maxs,
  });

  const noCrsLayer = await createRasterLayer({
    blob: noCrsBlob3857,
    style: noCrsStyle,
    bandCount: 3,
    zIndex: 1,
    mins: noCrsBounds.mins,
    maxs: noCrsBounds.maxs,
  });
  const noCrsNativeExtent = noCrsLayer.viewConfig.extent;
  const noCrsNativeProj = projCode(noCrsLayer.viewConfig.projection);
  push(
    "noCrs.taggedAsMapCrs",
    /3857/.test(noCrsNativeProj),
    noCrsNativeProj,
  );

  // --- geotiff with own CRS (fixture chla64 / EPSG:32649) ---
  const withGeo = {
    geoTransform: [574960, 10, 0, 3889850, 0, -10],
    crs: "EPSG:32649",
    modelPixelScale: [10, 10, 0],
    modelTiepoint: [0, 0, 0, 574960, 3889850, 0],
    yFlipped: true,
    source: "geotiff",
  };
  push("policy.withCrsOwn", fileHasOwnCrs(withGeo), withGeo.crs);
  push(
    "policy.withCrsKept",
    applyLayerCrsPolicy(withGeo, mapCrs).crs === "EPSG:32649",
    applyLayerCrsPolicy(withGeo, mapCrs).crs,
  );
  push(
    "policy.blobKeepsFileCrs",
    blobCrsForGeo(withGeo, mapCrs) === "EPSG:32649",
    blobCrsForGeo(withGeo, mapCrs),
  );

  const withResp = await fetch("/scripts/smoke/fixtures/chla64.tif");
  if (!withResp.ok) throw new Error(`fixture fetch failed: ${withResp.status}`);
  const withBlob = await withResp.blob();
  const withLayer = await createRasterLayer({
    blob: withBlob,
    style: buildWebGlStyle({
      mode: "gray",
      grayBand: 0,
      grayMin: 70,
      grayMax: 90,
      grayContrast: "none",
      grayRamp: "blackwhite",
      sourceMins: [70],
      sourceMaxs: [90],
    }),
    bandCount: 1,
    zIndex: 2,
    mins: [70],
    maxs: [90],
    // production blob with file CRS: GeoKeys from file, no forced projection
  });
  const withNativeProj = projCode(withLayer.viewConfig.projection);
  const withNativeExtent = withLayer.viewConfig.extent;
  push("withCrs.sourceIs32649", /32649/.test(withNativeProj), withNativeProj);
  push(
    "withCrs.extentInUtm",
    withNativeExtent &&
      withNativeExtent[0] > 500000 &&
      withNativeExtent[1] > 3000000,
    JSON.stringify(withNativeExtent),
  );

  // Map stays on mapCrs (3857), not layer CRS — even if createEmptyMap briefly
  // inherits the layer viewConfig (production path).
  const map = createEmptyMap(mapEl, withLayer.viewConfig);
  map.addLayer(noCrsLayer.layer);
  map.addLayer(withLayer.layer);
  map.updateSize();
  applyMapViewCrs(map, mapCrs, withLayer.viewConfig);
  push("map.stays3857OnOpen", /3857/.test(projCode(map.getView().getProjection())), projCode(map.getView().getProjection()));

  const expected4326Extent = transformExtent(withNativeExtent, "EPSG:32649", "EPSG:4326");
  const expected3857Extent = transformExtent(withNativeExtent, "EPSG:32649", "EPSG:3857");
  const expectedCenter3857 = [
    (expected3857Extent[0] + expected3857Extent[2]) / 2,
    (expected3857Extent[1] + expected3857Extent[3]) / 2,
  ];
  push(
    "reproject.mathOk",
    expected4326Extent[0] > 100 &&
      expected4326Extent[0] < 130 &&
      expected4326Extent[1] > 20 &&
      expected4326Extent[1] < 50,
    JSON.stringify(expected4326Extent),
  );

  // Tight stretch so float chla (~79) is visible under WebGL normalize
  withLayer.layer.setStyle(
    buildWebGlStyle({
      mode: "gray",
      grayBand: 0,
      grayMin: 70,
      grayMax: 90,
      grayContrast: "none",
      grayRamp: "blackwhite",
      sourceMins: [70],
      sourceMaxs: [90],
    }),
  );
  map.updateSize();
  await waitMapIdle(map, 2500);
  const sample3857 = sampleCenter(mapEl);
  push(
    "render.withCrsOpaqueIn3857",
    sample3857 && sample3857.rgba[3] > 200,
    JSON.stringify(sample3857),
  );

  // Center should be near reprojected UTM, not near pixel origin
  const center3857 = map.getView().getCenter();
  push(
    "map.fitReprojectedNotPixels",
    center3857 &&
      Math.abs(center3857[0] - expectedCenter3857[0]) < 5e5 &&
      Math.abs(center3857[1] - expectedCenter3857[1]) < 5e5 &&
      Math.abs(center3857[0]) > 1e6,
    JSON.stringify({ center3857, expectedCenter3857 }),
  );

  // ========== Switch map CRS to 4326 ==========
  // Production applyMapCrsChange:
  // - with CRS: do NOT rebuild
  // - no CRS: retag + rebuild
  mapCrs = "EPSG:4326";
  ensureProjection(mapCrs);

  // no-CRS: retag + rebuild (affine numbers unchanged)
  const noCrsExtentBeforeSwitch = noCrsLayer.viewConfig.extent.slice();
  noCrsGeo = { ...noCrsGeo, crs: mapCrs };
  const noCrsBlob4326 = planesToGeoTiffBlob(
    [r, g, b],
    w,
    h,
    noCrsGeo,
    blobCrsForGeo(noCrsGeo, mapCrs),
  );
  map.removeLayer(noCrsLayer.layer);
  const noCrsLayer2 = await createRasterLayer({
    blob: noCrsBlob4326,
    style: noCrsStyle,
    bandCount: 3,
    zIndex: 1,
    mins: noCrsBounds.mins,
    maxs: noCrsBounds.maxs,
  });
  map.addLayer(noCrsLayer2.layer);
  const noCrsAfterProj = projCode(noCrsLayer2.viewConfig.projection);
  const noCrsAfterExtent = noCrsLayer2.viewConfig.extent;
  push("noCrs.afterSwitchTagged4326", /4326/.test(noCrsAfterProj), noCrsAfterProj);
  push(
    "noCrs.extentNumbersUnchanged",
    extentClose(noCrsExtentBeforeSwitch, noCrsAfterExtent, 1e-6),
    JSON.stringify({ before: noCrsExtentBeforeSwitch, after: noCrsAfterExtent }),
  );
  // Must NOT be lon/lat-reprojected (pixel 64 must not become ~degrees of UTM area)
  push(
    "noCrs.notReprojectedToGeo",
    noCrsAfterExtent[2] < 1000 && noCrsAfterExtent[3] < 1000,
    JSON.stringify(noCrsAfterExtent),
  );

  // with-CRS: keep same layer object / same native extent; only map view changes
  const withExtentStill = withLayer.viewConfig.extent;
  push(
    "withCrs.nativeExtentUnchanged",
    extentClose(withNativeExtent, withExtentStill, 1e-6),
    JSON.stringify({ before: withNativeExtent, after: withExtentStill }),
  );
  push("withCrs.nativeStill32649", /32649/.test(projCode(withLayer.viewConfig.projection)), projCode(withLayer.viewConfig.projection));

  applyMapViewCrs(map, mapCrs, withLayer.viewConfig);
  push("map.switchedTo4326", /4326/.test(projCode(map.getView().getProjection())), projCode(map.getView().getProjection()));

  const center4326 = map.getView().getCenter();
  const expectedCenter4326 = [
    (expected4326Extent[0] + expected4326Extent[2]) / 2,
    (expected4326Extent[1] + expected4326Extent[3]) / 2,
  ];
  push(
    "withCrs.viewReprojectedTo4326",
    center4326 &&
      Math.abs(center4326[0] - expectedCenter4326[0]) < 2 &&
      Math.abs(center4326[1] - expectedCenter4326[1]) < 2,
    JSON.stringify({ center4326, expectedCenter4326, expected4326Extent }),
  );

  // Must NOT switch map to Local / RV:Local
  push(
    "map.neverLocal",
    !/local/i.test(projCode(map.getView().getProjection())),
    projCode(map.getView().getProjection()),
  );

  map.updateSize();
  await waitMapIdle(map, 2500);
  const sample4326 = sampleCenter(mapEl);
  push(
    "render.withCrsOpaqueIn4326",
    sample4326 && sample4326.rgba[3] > 200,
    JSON.stringify(sample4326),
  );

  // Switch back to 3857 — with-CRS still reprojects; no-CRS retag again
  mapCrs = "EPSG:3857";
  noCrsGeo = { ...noCrsGeo, crs: mapCrs };
  map.removeLayer(noCrsLayer2.layer);
  const noCrsLayer3 = await createRasterLayer({
    blob: planesToGeoTiffBlob([r, g, b], w, h, noCrsGeo, blobCrsForGeo(noCrsGeo, mapCrs)),
    style: noCrsStyle,
    bandCount: 3,
    zIndex: 1,
    mins: noCrsBounds.mins,
    maxs: noCrsBounds.maxs,
  });
  map.addLayer(noCrsLayer3.layer);
  applyMapViewCrs(map, mapCrs, withLayer.viewConfig);
  push("map.backTo3857", /3857/.test(projCode(map.getView().getProjection())), projCode(map.getView().getProjection()));
  const centerBack = map.getView().getCenter();
  push(
    "withCrs.reprojectBack3857",
    centerBack && Math.abs(centerBack[0] - expectedCenter3857[0]) < 5e5,
    JSON.stringify({ centerBack, expectedCenter3857 }),
  );
  push(
    "noCrs.extentStableAcrossSwitches",
    extentClose(noCrsNativeExtent, noCrsLayer3.viewConfig.extent, 1e-6),
    JSON.stringify({ first: noCrsNativeExtent, last: noCrsLayer3.viewConfig.extent }),
  );

  // Unused but keep for clarity in report
  void noCrsExtentBefore;

  const ok = checks.every((c) => c.ok);
  const result = {
    ok,
    checks,
    meta: {
      withNativeExtent,
      expected4326Extent,
      expected3857Extent,
      noCrsNativeExtent,
      noCrsAfterExtent,
    },
  };
  window.__SMOKE_RESULT__ = result;
  document.getElementById("out").textContent = JSON.stringify(result, null, 2);
  document.body.dataset.smoke = ok ? "pass" : "fail";
  return result;
};

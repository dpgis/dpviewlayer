import Map from "ol/Map.js";
import View from "ol/View.js";
import WebGLTile from "ol/layer/WebGLTile.js";
import ImageLayer from "ol/layer/Image.js";
import GeoTIFF from "ol/source/GeoTIFF.js";
import Static from "ol/source/ImageStatic.js";
import { getCenter } from "ol/extent.js";
import { addProjection, get as getProjection, Projection } from "ol/proj.js";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import { writeArrayBuffer } from "geotiff";
import { CONTINUOUS_RAMPS, interpolateStops } from "./colorRamps.js";

/**
 * Shared projection for non-georeferenced (Local) rasters.
 * Each GeoTIFF with ProjectedCSTypeGeoKey=32767 would otherwise get a null /
 * anonymous projection, so stacking JPG + mask fails to overlay correctly.
 */
export const LOCAL_PIXEL_PROJECTION = (() => {
  const code = "RV:Local";
  let p = getProjection(code);
  if (!p) {
    p = new Projection({
      code,
      units: "pixels",
      extent: [-1e12, -1e12, 1e12, 1e12],
      worldExtent: [-1e12, -1e12, 1e12, 1e12],
      metersPerUnit: 1,
      global: false,
    });
    addProjection(p);
  }
  return p;
})();

/** True when a projection is our Local pixel space (or unknown/null). */
export function isLocalPixelProjection(proj) {
  if (!proj) return true;
  try {
    const code = String(proj.getCode?.() || proj || "");
    if (!code) return true;
    if (/^RV:Local$/i.test(code)) return true;
    if (/local/i.test(code)) return true;
    if (/32767/.test(code)) return true;
    if (/^EPSG:0$/i.test(code)) return true;
    return false;
  } catch {
    return true;
  }
}

/** Compute map extent [minx, miny, maxx, maxy] from geo + pixel size. */
export function extentFromGeo(width, height, geo) {
  const sx = geo?.modelPixelScale?.[0] ?? 1;
  const sy = geo?.modelPixelScale?.[1] ?? 1;
  const x0 = geo?.modelTiepoint?.[3] ?? 0;
  const y0 = geo?.modelTiepoint?.[4] ?? height;
  const yFlipped = geo?.yFlipped !== false;
  if (yFlipped) {
    return [x0, y0 - height * sy, x0 + width * sx, y0];
  }
  return [x0, y0, x0 + width * sx, y0 + height * sy];
}

/**
 * Reconstruct data-space value from OL normalized band (0..1).
 * Source min/max must match GeoTIFF source normalize bounds.
 */
function rawBand(bandIndex1, srcMin, srcMax) {
  const lo = Number.isFinite(srcMin) ? srcMin : 0;
  const hi = Number.isFinite(srcMax) ? srcMax : 255;
  const span = hi - lo || 1;
  return ["+", ["*", ["band", bandIndex1], span], lo];
}

function sourceBound(state, bandIndex0, fallbackMin, fallbackMax) {
  const mins = state.sourceMins;
  const maxs = state.sourceMaxs;
  const min =
    Array.isArray(mins) && Number.isFinite(mins[bandIndex0])
      ? mins[bandIndex0]
      : fallbackMin;
  const max =
    Array.isArray(maxs) && Number.isFinite(maxs[bandIndex0])
      ? maxs[bandIndex0]
      : fallbackMax;
  return { min, max };
}

function stretchExpr(rawExpr, min, max, invert) {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : 255;
  const t = [
    "clamp",
    ["/", ["-", rawExpr, lo], Math.max(1e-9, hi - lo)],
    0,
    1,
  ];
  return invert ? ["-", 1, t] : t;
}

/**
 * Build OpenLayers WebGLTile style (style.color expression).
 * Coloring is done by the WebGL shader — not by pre-painting a canvas.
 *
 * Contrast note: OL has no built-in "percentage stretch" operator. Percentage /
 * stddev cuts are computed on the CPU into grayMin/grayMax (etc.), then applied
 * here as linear stretch in the color expression (same as QGIS cumulative cut).
 *
 * IMPORTANT: With normalize:true, ['band', i] is already 0..1 relative to the
 * source min/max. The `array` operator expects 0..1 channels; the `color`
 * operator expects 0..255 (passing 0..1 into `color` renders near-black).
 */
export function buildWebGlStyle(state) {
  const mode = state.mode || "gray";

  if (mode === "gray") {
    const bi0 = Number(state.grayBand) || 0;
    const bi = bi0 + 1;
    const sb = sourceBound(state, bi0, 0, 255);
    const raw = rawBand(bi, sb.min, sb.max);
    const ramp = state.grayRamp || "blackwhite";
    const invertBw = ramp === "whiteblack";
    let min = Number(state.grayMin);
    let max = Number(state.grayMax);
    if (!Number.isFinite(min)) min = sb.min;
    if (!Number.isFinite(max)) max = sb.max;
    if (max <= min) max = min + 1;
    // Always honor min/max (contrast dropdown only pre-fills these fields).
    let v = stretchExpr(raw, min, max, false);
    if (invertBw) v = ["-", 1, v];

    if (CONTINUOUS_RAMPS[ramp]) {
      const stops = interpolateStops(ramp, 0, 1, false);
      return {
        color: ["interpolate", ["linear"], v, ...stops],
      };
    }
    return { color: ["array", v, v, v, 1] };
  }

  if (mode === "rgb") {
    const channel = (sel, min, max) => {
      if (sel === "unset" || sel === "" || sel == null) return 0;
      const bi0 = Number(sel);
      const bi = bi0 + 1;
      const sb = sourceBound(state, bi0, 0, 255);
      const raw = rawBand(bi, sb.min, sb.max);
      let lo = Number(min);
      let hi = Number(max);
      if (!Number.isFinite(lo)) lo = sb.min;
      if (!Number.isFinite(hi)) hi = sb.max;
      if (hi <= lo) hi = lo + 1;
      // Always honor per-channel min/max (incl. contrast = "none").
      return stretchExpr(raw, lo, hi, false);
    };
    return {
      color: [
        "array",
        channel(state.redBand, state.redMin, state.redMax),
        channel(state.greenBand, state.greenMin, state.greenMax),
        channel(state.blueBand, state.blueMin, state.blueMax),
        1,
      ],
    };
  }

  // paletted / unique values — OL `palette` LUT indexed by class id (0..255).
  // Source is locked to 0..255 so class value V maps to V/255.
  const bi = (Number(state.paletteBand) || 0) + 1;
  const colors = new Array(256).fill("rgba(0,0,0,0)");
  // paletteOpacity: 0 = opaque, 100 = fully transparent (ArcGIS-style 透明度).
  const opacityPct = Number(state.paletteOpacity);
  const alpha = Number.isFinite(opacityPct)
    ? Math.max(0, Math.min(1, 1 - opacityPct / 100))
    : 1;
  const ids = Object.keys(state.colormap || {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255)
    .sort((a, b) => a - b);
  for (const id of ids) {
    const hex = state.colormap[id] ?? state.colormap[String(id)];
    if (!hex) continue;
    colors[id] = alpha >= 0.999 ? hex : colorWithAlpha(hex, alpha);
  }
  return {
    color: ["palette", ["round", rawBand(bi, 0, 255)], colors],
  };
}

/** Apply alpha to #rgb / #rrggbb / rgba() color strings. */
function colorWithAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  const s = String(color || "").trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+\s*)?\)$/i);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  return color;
}

/** True when every finite sample is an integer in [0, 255]. */
export function planesFitUint8(planes) {
  if (!planes?.length) return true;
  for (const plane of planes) {
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (!Number.isFinite(v)) continue;
      if (!Number.isInteger(v) || v < 0 || v > 255) return false;
    }
  }
  return true;
}

/**
 * Per-band min/max for GeoTIFF normalize + style reconstruction.
 * @param {{ lockByteRange?: boolean }} [opts] paletted masks lock 0..255
 */
export function resolveSourceBounds(bandCount, bandStats, planes, opts = {}) {
  const n = Math.max(1, bandCount || planes?.length || bandStats?.length || 1);
  if (opts.lockByteRange) {
    return {
      mins: Array(n).fill(0),
      maxs: Array(n).fill(255),
    };
  }
  const mins = [];
  const maxs = [];
  for (let b = 0; b < n; b++) {
    let lo = bandStats?.[b]?.min;
    let hi = bandStats?.[b]?.max;
    if ((!Number.isFinite(lo) || !Number.isFinite(hi)) && planes?.[b]) {
      lo = Infinity;
      hi = -Infinity;
      const p = planes[b];
      for (let i = 0; i < p.length; i++) {
        const v = p[i];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 255;
    }
    if (hi <= lo) hi = lo + 1;
    mins.push(lo);
    maxs.push(hi);
  }
  return { mins, maxs };
}

/** Build a single-level GeoTIFF ArrayBuffer from band planes (uint8 or float32). */
function encodePlanesLevel(planes, width, height, geo, crsCode, scaleFactor = 1) {
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`无效的栅格尺寸: width=${width}, height=${height}`);
  }
  const bandCount = planes.length;
  if (!bandCount) throw new Error("没有波段数据");
  const size = w * h;
  const baseSx = geo?.modelPixelScale?.[0] ?? 1;
  const baseSy = geo?.modelPixelScale?.[1] ?? 1;
  const f = Math.max(1, scaleFactor);
  const asFloat = !planesFitUint8(planes);
  const meta = {
    ImageWidth: w,
    ImageLength: h,
    width: w,
    height: h,
    SamplesPerPixel: bandCount,
    BitsPerSample: Array(bandCount).fill(asFloat ? 32 : 8),
    SampleFormat: Array(bandCount).fill(asFloat ? 3 : 1),
    PlanarConfiguration: 1,
    PhotometricInterpretation: bandCount >= 3 ? 2 : 1,
    ModelPixelScale: [baseSx * f, baseSy * f, 0],
    ModelTiepoint: geo?.modelTiepoint || [0, 0, 0, 0, (geo?.modelTiepoint?.[4] ?? h * f), 0],
    GTRasterTypeGeoKey: 1,
  };

  const code = normalizeEpsg(crsCode);
  if (code) {
    Object.assign(meta, geoKeysForEpsg(code));
  } else {
    Object.assign(meta, {
      GTModelTypeGeoKey: 1,
      ProjectedCSTypeGeoKey: 32767,
      GTCitationGeoKey: "Local",
    });
  }

  if (asFloat) {
    const flat = new Float32Array(size * bandCount);
    for (let i = 0; i < size; i++) {
      for (let b = 0; b < bandCount; b++) {
        const plane = planes[b];
        if (!plane || i >= plane.length) {
          flat[i * bandCount + b] = 0;
          continue;
        }
        const v = plane[i];
        flat[i * bandCount + b] = Number.isFinite(v) ? v : 0;
      }
    }
    return writeArrayBuffer(flat, meta);
  }

  for (let b = 0; b < bandCount; b++) {
    if (!planes[b] || planes[b].length < size) {
      throw new Error(
        `波段 ${b} 长度不足: ${planes[b]?.length ?? 0} < ${width}×${height}`,
      );
    }
  }

  const flat = new Uint8Array(size * bandCount);
  for (let i = 0; i < size; i++) {
    for (let b = 0; b < bandCount; b++) {
      const v = planes[b][i];
      flat[i * bandCount + b] = Number.isFinite(v)
        ? Math.max(0, Math.min(255, Math.round(v)))
        : 0;
    }
  }
  return writeArrayBuffer(flat, meta);
}

/** Pack band planes into a GeoTIFF blob (full resolution only). */
export function planesToGeoTiffBlob(planes, width, height, geo, crsCode = "EPSG:3857") {
  return new Blob([encodePlanesLevel(planes, width, height, geo, crsCode, 1)], {
    type: "image/tiff",
  });
}

/**
 * Downsample planes by 2×.
 * @param {'nearest'|'average'} mode nearest for class masks; average for continuous/RGB
 */
export function downsamplePlanes2x(planes, width, height, mode = "average") {
  const nw = Math.max(1, Math.floor(width / 2));
  const nh = Math.max(1, Math.floor(height / 2));
  const out = planes.map(() => new Float64Array(nw * nh));
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x0 = x * 2;
      const y0 = y * 2;
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const oi = y * nw + x;
      for (let b = 0; b < planes.length; b++) {
        const p = planes[b];
        if (mode === "nearest") {
          out[b][oi] = p[y0 * width + x0];
        } else {
          const s =
            p[y0 * width + x0] +
            p[y0 * width + x1] +
            p[y1 * width + x0] +
            p[y1 * width + x1];
          out[b][oi] = s / 4;
        }
      }
    }
  }
  return { planes: out, width: nw, height: nh };
}

/** Build overview factor chain: 2, 4, 8… while max side stays above minSize. */
export function pyramidFactors(width, height, minSize = 256) {
  const factors = [];
  let f = 2;
  let w = width;
  let h = height;
  while (Math.max(w, h) > minSize) {
    factors.push(f);
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    f *= 2;
    if (factors.length >= 8) break;
  }
  return factors;
}

/**
 * Encode full-res + overview GeoTIFF blobs for OL `url` + `overviews`.
 * (OL ignores overviews when using `blob` — must use object URLs.)
 */
export function planesToPyramidBlobs(
  planes,
  width,
  height,
  geo,
  crsCode = "EPSG:3857",
  { nearest = false, minSize = 256 } = {},
) {
  const mode = nearest ? "nearest" : "average";
  const full = encodePlanesLevel(planes, width, height, geo, crsCode, 1);
  const overviewBuffers = [];
  let curPlanes = planes;
  let cw = width;
  let ch = height;
  let factor = 1;
  const factors = pyramidFactors(width, height, minSize);
  for (const targetFactor of factors) {
    while (factor < targetFactor) {
      const next = downsamplePlanes2x(curPlanes, cw, ch, mode);
      curPlanes = next.planes;
      cw = next.width;
      ch = next.height;
      factor *= 2;
    }
    overviewBuffers.push(encodePlanesLevel(curPlanes, cw, ch, geo, crsCode, factor));
  }
  return {
    blob: new Blob([full], { type: "image/tiff" }),
    overviewBlobs: overviewBuffers.map((ab) => new Blob([ab], { type: "image/tiff" })),
    overviewCount: overviewBuffers.length,
  };
}

/** @returns {number|null} EPSG number or null for none/local */
export function normalizeEpsg(crsCode) {
  if (!crsCode || crsCode === "none" || crsCode === "local" || crsCode === "Local") {
    return null;
  }
  const m = String(crsCode)
    .trim()
    .match(/^(?:EPSG:)?(\d+)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function geoKeysForEpsg(epsg) {
  if (epsg === 4326 || epsg === 4490 || epsg === 4214) {
    return {
      GTModelTypeGeoKey: 2,
      GeographicTypeGeoKey: epsg,
      GeogCitationGeoKey: `EPSG:${epsg}`,
    };
  }
  return {
    GTModelTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: epsg,
    GTCitationGeoKey: `EPSG:${epsg}`,
  };
}

/** Create WebGLTile map (thin wrapper around createRasterLayer). */
export async function createOlMap(target, { url, blob, style, bandCount = 1, mins, maxs }) {
  const { layer, source, viewConfig } = await createRasterLayer({
    url,
    blob,
    style,
    bandCount,
    mins,
    maxs,
  });
  const map = createEmptyMap(target, viewConfig);
  map.addLayer(layer);
  return { map, layer, source, viewConfig };
}

/** Build a View that allows free pan and zoom-out beyond fit-to-window. */
export function freeViewOptions(viewConfig = {}) {
  const extent = viewConfig.extent;
  let maxResolution = viewConfig.maxResolution;
  let minResolution = viewConfig.minResolution;
  if (extent && Number.isFinite(extent[0])) {
    const w = Math.abs(extent[2] - extent[0]) || 1;
    const h = Math.abs(extent[3] - extent[1]) || 1;
    const fitish = Math.max(w, h);
    maxResolution = Math.max(maxResolution || 0, fitish * 64);
    const pixelish = Math.min(w, h) / 4096;
    minResolution = Math.min(minResolution || pixelish, pixelish);
  } else {
    maxResolution = maxResolution || 1e7;
    minResolution = minResolution || 1e-4;
  }
  return {
    projection: viewConfig.projection,
    center: viewConfig.center,
    resolution: viewConfig.resolution,
    zoom: viewConfig.zoom,
    constrainResolution: false,
    multiWorld: true,
    // false: updateSize on side-panel reflow must not keep zooming out.
    showFullExtent: false,
    maxResolution,
    minResolution,
  };
}

/** Empty map shell; layers are added with createRasterLayer + map.addLayer. */
export function createEmptyMap(target, viewConfig) {
  const map = new Map({
    target,
    layers: [],
    controls: [],
    interactions: defaultInteractions({
      doubleClickZoom: false,
      altShiftDragRotate: false,
      pinchRotate: false,
    }),
    view: new View(freeViewOptions(viewConfig || { center: [0, 0], zoom: 0 })),
  });
  return map;
}

/**
 * One GeoTIFF-backed WebGLTile layer.
 * Prefer `url` + `overviews` for pyramids (internal IFDs on URL also work).
 * For in-memory data, pass `blob` + optional `overviewBlobs` (converted to object URLs).
 *
 * Pass per-band `mins`/`maxs` for correct normalize (float / uint16 / stretch).
 * Omit them for native URL sources so OL can use GDAL STATISTICS_* or dtype defaults.
 * Paletted class masks should pass 0..255 so class ids are not remapped.
 */
export async function createRasterLayer({
  url,
  blob,
  overviewBlobs = [],
  overviews = [],
  style,
  bandCount = 1,
  zIndex = 0,
  mins,
  maxs,
  /** Force source/view projection (use LOCAL_PIXEL_PROJECTION for identity rasters). */
  projection = null,
}) {
  /** @type {string[]} */
  const objectUrls = [];
  const hasBounds =
    Array.isArray(mins) &&
    Array.isArray(maxs) &&
    mins.length > 0 &&
    maxs.length > 0 &&
    mins.every((v) => Number.isFinite(v)) &&
    maxs.every((v) => Number.isFinite(v));
  const boundOpts = hasBounds ? { min: mins, max: maxs } : {};

  let sourceInfo;
  const externalOvers = Array.isArray(overviews) ? overviews : [];
  if (blob && (overviewBlobs?.length || externalOvers.length)) {
    // OL only wires external overviews for URL sources — not blob.
    const mainUrl = URL.createObjectURL(blob);
    objectUrls.push(mainUrl);
    const ovrUrls = [
      ...(overviewBlobs || []).map((b) => {
        const u = URL.createObjectURL(b);
        objectUrls.push(u);
        return u;
      }),
      ...externalOvers,
    ];
    sourceInfo = { url: mainUrl, overviews: ovrUrls, ...boundOpts };
  } else if (blob) {
    // In-memory float blobs must have explicit bounds (dtype limits are unusable).
    sourceInfo = hasBounds
      ? { blob, ...boundOpts }
      : { blob, min: Array(bandCount).fill(0), max: Array(bandCount).fill(255) };
  } else if (url) {
    sourceInfo = {
      url,
      ...boundOpts,
      ...(externalOvers.length ? { overviews: [...externalOvers] } : {}),
    };
  } else {
    throw new Error("createRasterLayer: need url or blob");
  }

  const source = new GeoTIFF({
    sources: [sourceInfo],
    normalize: true,
    transition: 0,
    convertToRGB: false,
    interpolate: false,
    ...(projection ? { projection } : {}),
  });

  const layer = new WebGLTile({
    source,
    style,
    zIndex,
  });
  layer.set("rvKind", "geotiff");

  let viewConfig = await source.getView();
  // Keep Local layers on one shared projection so JPG + mask stack correctly.
  if (projection || isLocalPixelProjection(viewConfig?.projection)) {
    const proj = projection || LOCAL_PIXEL_PROJECTION;
    if (source.projection !== proj) source.projection = proj;
    viewConfig = { ...viewConfig, projection: proj };
  }
  // Re-apply after source.bandCount is known so the WebGL shader matches band layout.
  if (style) layer.setStyle(style);
  return { layer, source, viewConfig, objectUrls };
}

/**
 * PNG / JPEG / BMP via OpenLayers ImageStatic (browser decodes; no GeoTIFF wrap).
 * imageExtent is axis-aligned from geo scale + tiepoint.
 */
export function createStaticImageLayer({
  url,
  width,
  height,
  geo,
  crsCode = "EPSG:3857",
  zIndex = 0,
  interpolate = false,
}) {
  if (!url) throw new Error("createStaticImageLayer: need url");
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  if (!w || !h) throw new Error("createStaticImageLayer: need width/height");

  const extent = extentFromGeo(w, h, geo);
  let code = crsCode || "EPSG:3857";
  if (!/^EPSG:/i.test(String(code)) && /^\d+$/.test(String(code))) {
    code = `EPSG:${code}`;
  }
  const proj = getProjection(code) || code;

  const source = new Static({
    url,
    imageExtent: extent,
    projection: proj,
    interpolate: !!interpolate,
  });
  const layer = new ImageLayer({
    source,
    zIndex,
  });
  layer.set("rvKind", "static");

  const wExt = Math.abs(extent[2] - extent[0]) || 1;
  const hExt = Math.abs(extent[3] - extent[1]) || 1;
  const resolution = Math.max(wExt / 800, hExt / 600);

  return {
    layer,
    source,
    viewConfig: {
      projection: proj,
      extent,
      center: getCenter(extent),
      resolution,
    },
    objectUrls: [],
  };
}

/** True for formats that should use ImageStatic instead of GeoTIFF. */
export function isStaticImageFormat(format) {
  const f = String(format || "").toLowerCase();
  return f === "png" || f === "jpeg" || f === "jpg" || f === "bmp";
}

/** Revoke object URLs created for pyramid blobs. */
export function revokeLayerUrls(objectUrls) {
  if (!objectUrls?.length) return;
  for (const u of objectUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }
}

export function applyStyle(layer, state) {
  if (!layer) return;
  // ImageStatic layers show the file as-is; WebGL style does not apply.
  if (layer.get?.("rvKind") === "static") return;
  if (typeof layer.setStyle !== "function") return;
  // Accept either style-state or a pre-built WebGL style object.
  const built =
    state && typeof state === "object" && state.color
      ? state
      : buildWebGlStyle(state);
  const wasVisible = layer.getVisible();
  layer.setStyle(built);
  // setStyle can leave a hidden layer drawable — re-assert visibility only
  // (do not use setOpacity(0); that blanks sibling WebGL layers until click).
  if (!wasVisible) layer.setVisible(false);
}

export function fitMap(map, viewConfig) {
  if (!map) return;
  const view = map.getView();
  if (viewConfig?.extent) {
    view.fit(viewConfig.extent, { padding: [24, 24, 24, 24], nearest: true });
    return;
  }
  const extent = view.getProjection()?.getExtent?.();
  if (extent) view.fit(extent, { padding: [24, 24, 24, 24], nearest: true });
}

export function zoomPercent(map, viewConfig) {
  if (!map) return 100;
  const view = map.getView();
  const res = view.getResolution();
  if (!res) return 100;
  const extent = viewConfig?.extent || view.getProjection()?.getExtent?.();
  if (!extent) return 100;
  const size = map.getSize();
  if (!size) return 100;
  const fitRes = Math.max(
    (extent[2] - extent[0]) / Math.max(1, size[0] - 48),
    (extent[3] - extent[1]) / Math.max(1, size[1] - 48),
  );
  return Math.round((fitRes / res) * 100);
}

export { getCenter };

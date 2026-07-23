import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";
import { get as getProjection, transformExtent } from "ol/proj.js";
import View from "ol/View.js";
import { freeViewOptions } from "./olRaster.js";

/** Common extra defs (CGCS2000 etc.). 4326/3857 are built into OpenLayers. */
const EXTRA_DEFS = {
  4490: "+proj=longlat +ellps=GRS80 +no_defs +type=crs",
  // 3° GK zone 39 / CGCS2000 — common in China
  4547: "+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs",
  4548: "+proj=tmerc +lat_0=0 +lon_0=120 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs",
  4549: "+proj=tmerc +lat_0=0 +lon_0=123 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs",
  4550: "+proj=tmerc +lat_0=0 +lon_0=126 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs",
  3857: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs",
};

let registered = false;

export function ensureProj4Registered() {
  if (registered) return;
  for (const [code, def] of Object.entries(EXTRA_DEFS)) {
    try {
      proj4.defs(`EPSG:${code}`, def);
    } catch {
      /* ignore */
    }
  }
  register(proj4);
  registered = true;
}

/** Ensure EPSG:code is available to OpenLayers (via proj4 when needed). */
export function ensureProjection(crsCode) {
  ensureProj4Registered();
  if (!crsCode || crsCode === "none") return null;
  const code = crsCode.startsWith("EPSG:") ? crsCode : `EPSG:${crsCode}`;
  let proj = getProjection(code);
  if (proj) return proj;
  const num = code.replace(/^EPSG:/i, "");
  if (EXTRA_DEFS[num]) {
    proj4.defs(code, EXTRA_DEFS[num]);
    register(proj4);
    proj = getProjection(code);
    return proj || null;
  }
  // UTM WGS84 north 32601–32660 / south 32701–32760
  const n = Number(num);
  if (Number.isInteger(n) && n >= 32601 && n <= 32660) {
    const zone = n - 32600;
    proj4.defs(code, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
    register(proj4);
    return getProjection(code);
  }
  if (Number.isInteger(n) && n >= 32701 && n <= 32760) {
    const zone = n - 32700;
    proj4.defs(code, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
    register(proj4);
    return getProjection(code);
  }
  return null;
}

function projectionCode(proj) {
  try {
    return String(proj?.getCode?.() || "");
  } catch {
    return "";
  }
}

/** Local / non-EPSG layer — do not treat pixel extents as lon/lat. */
function isLocalProjection(proj) {
  const code = projectionCode(proj);
  if (!code) return true;
  if (/^RV:Local$/i.test(code)) return true;
  if (/local/i.test(code)) return true;
  if (/32767/.test(code)) return true;
  if (/^EPSG:0$/i.test(code)) return true;
  return false;
}

function extentArea(e) {
  if (!e || e.length < 4) return 0;
  const w = Math.abs(e[2] - e[0]);
  const h = Math.abs(e[3] - e[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 0;
  return w * h;
}

function extentsOverlap(a, b) {
  if (!a || !b) return false;
  const xOverlap = Math.min(a[2], b[2]) > Math.max(a[0], b[0]);
  const yOverlap = Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
  return xOverlap && yOverlap;
}

function safeTransformExtent(extent, fromProj, toProj) {
  if (!extent || !fromProj || !toProj) return null;
  try {
    const te = transformExtent(extent, fromProj, toProj);
    if (!te || te.some((v) => !Number.isFinite(v))) return null;
    return te;
  } catch {
    return null;
  }
}

/**
 * Switch map view projection.
 * Prefer preserving the current viewport when it still overlaps the layer after
 * reprojection; otherwise fit the layer's reprojected extent (never stay at a
 * bogus null-island view while the layer is elsewhere).
 * @param {string} mapCrs EPSG:xxxx
 */
export function applyMapViewCrs(map, mapCrs, layerNativeViewConfig) {
  if (!map) return;
  const code = mapCrs && mapCrs !== "none" ? mapCrs : "EPSG:3857";
  const proj = ensureProjection(code);
  if (!proj) {
    throw new Error(`无法注册坐标系 ${code}`);
  }
  const oldView = map.getView();
  const oldProj = oldView.getProjection();
  const layerProj = layerNativeViewConfig?.projection || null;
  const layerExtent = layerNativeViewConfig?.extent;

  // Layers still on Local (legacy / fallback): keep the *map* CRS and fit using
  // the same numeric extent (assigned-CRS policy — do not switch the map to Local).
  if (layerExtent && isLocalProjection(layerProj)) {
    map.setView(
      new View(
        freeViewOptions({
          projection: proj,
        }),
      ),
    );
    try {
      map.getView().fit(layerExtent, { padding: [24, 24, 24, 24], nearest: true });
    } catch {
      /* ignore */
    }
    map.updateSize();
    return;
  }

  const layerTe =
    layerExtent && layerProj && !isLocalProjection(layerProj)
      ? safeTransformExtent(layerExtent, layerProj, proj)
      : null;

  let viewTe = null;
  if (oldProj) {
    try {
      const size = map.getSize?.();
      const extent =
        size && size[0] > 0 && size[1] > 0
          ? oldView.calculateExtent(size)
          : oldView.calculateExtent?.([800, 800]);
      viewTe = safeTransformExtent(extent, oldProj, proj);
    } catch {
      viewTe = null;
    }
  }

  // Preserve viewport on CRS switch when it still covers the layer; otherwise
  // fit the layer (fixes first-open / wrong-center staying at [0,0]).
  let fitTarget = null;
  if (layerTe && viewTe && extentsOverlap(viewTe, layerTe) && extentArea(viewTe) > 0) {
    fitTarget = viewTe;
  } else if (layerTe) {
    fitTarget = layerTe;
  } else if (viewTe && extentArea(viewTe) > 0) {
    fitTarget = viewTe;
  }

  // Do not set View.extent to the layer AABB — that clamps pan/zoom math across
  // stacked layers with wildly different footprints (geo GeoTIFF + pixel JPG).
  map.setView(
    new View(
      freeViewOptions({
        projection: proj,
      }),
    ),
  );
  if (fitTarget) {
    try {
      map.getView().fit(fitTarget, { padding: [24, 24, 24, 24], nearest: true });
    } catch {
      /* ignore */
    }
  }
  map.updateSize();
}

export function formatMapCrsLabel(mapCrs) {
  if (!mapCrs || mapCrs === "none") return "EPSG:3857";
  return mapCrs.startsWith("EPSG:") ? mapCrs : `EPSG:${mapCrs}`;
}

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
  const num = code.replace("EPSG:", "");
  if (EXTRA_DEFS[num]) {
    proj4.defs(code, EXTRA_DEFS[num]);
    register(proj4);
    proj = getProjection(code);
  }
  return proj || null;
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

/**
 * Switch map view projection.
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

  // Non-georeferenced rasters: keep the layer's native (Local) view — tagging
  // pixel coords as EPSG:4326 caused black L-gutters after CRS switch.
  if (layerExtent && isLocalProjection(layerProj)) {
    const viewProj = layerProj || oldProj || proj;
    map.setView(
      new View(
        freeViewOptions({
          projection: viewProj,
          extent: layerExtent,
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

  let center = oldView.getCenter();
  let resolution = oldView.getResolution();
  if (oldProj && center) {
    try {
      const extent = oldView.calculateExtent?.(map.getSize?.());
      if (extent) {
        const te = transformExtent(extent, oldProj, proj);
        const layerTe =
          layerExtent && layerProj
            ? transformExtent(layerExtent, layerProj, proj)
            : layerExtent
              ? transformExtent(layerExtent, oldProj, proj)
              : te;
        map.setView(
          new View(
            freeViewOptions({
              projection: proj,
              extent: layerTe,
            }),
          ),
        );
        map.getView().fit(te, { padding: [24, 24, 24, 24], nearest: true });
        map.updateSize();
        return;
      }
    } catch {
      /* fall through */
    }
  }
  map.setView(
    new View(
      freeViewOptions({
        projection: proj,
        center: center || [0, 0],
        resolution: resolution || 1,
        extent: layerExtent,
      }),
    ),
  );
  if (layerExtent) {
    try {
      const from = layerProj || oldProj;
      const te = from ? transformExtent(layerExtent, from, proj) : layerExtent;
      map.getView().fit(te, { padding: [24, 24, 24, 24], nearest: true });
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

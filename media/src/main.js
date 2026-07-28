import {
  buildWebGlStyle,
  createEmptyMap,
  createRasterLayer,
  applyStyle,
  opacityFromStyleState,
  planesToGeoTiffBlob,
  planesToPyramidBlobs,
  PYRAMID_MIN_PIXELS,
  planesAreUint8,
  normalizeEpsg,
  fitMap,
  zoomPercent,
  extentFromGeo,
  revokeLayerUrls,
  resolveSourceBounds,
  LOCAL_PIXEL_PROJECTION,
  isLocalPixelProjection,
} from "./olRaster.js";
import { colorsForClasses, stretchRange } from "./colorRamps.js";
import {
  COLOR_TABLE_MAX,
  isIntegerLikeBand,
  resolveBandMinMax,
  buildColorTableBreaks,
  colorTableFromLegacyMap,
  legacyMapFromColorTable,
  serializeColorTable,
  parseColorTable,
  colorTableRangeConflicts,
  suggestInsertRange,
  formatBreak,
} from "./colorTable.js";
import { applyMapViewCrs, ensureProjection } from "./mapCrs.js";
import { transform as transformCoord, transformExtent } from "ol/proj.js";
import { fromUrl as geoTiffFromUrl } from "geotiff";

(() => {
  const payload = window.__RASTER_VIEWER__;
  if (!payload) return;

  // Suppress browser cut/copy/paste context menu in the webview (map + panels).
  document.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
    },
    true,
  );

  const vscodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

  const I18N = {
    zh: {
      renderGray: "单波段灰度",
      renderRgb: "多波段彩色",
      renderPaletted: "颜色表渲染",
      resample: "采样方式",
      resampleNearest: "最近邻",
      resampleLinear: "线性插值",
      grayBand: "灰度波段",
      colorRamp: "颜色梯度",
      rampBw: "黑到白",
      rampWb: "白到黑",
      minVal: "最小值",
      maxVal: "最大值",
      contrast: "对比度增强",
      contrastMinMax: "拉伸至极小极大",
      contrastPercent: "百分比线性拉伸",
      contrastStdDev: "均值±标准差",
      contrastNone: "无增强",
      percentCut: "百分比",
      stdDevN: "标准差倍数",
      rampInvert: "反转颜色渐变",
      paletteOpacity: "透明度",
      redBand: "红色波段",
      greenBand: "绿色波段",
      blueBand: "蓝色波段",
      classBand: "波段",
      paletteRamp: "颜色渐变",
      rampRandom: "Random colors",
      rampHash: "哈希色",
      bandUnset: "未设置",
      bandN: "波段",
      colValue: "值",
      colIndex: "ID",
      colMin: "≥",
      colMax: "<",
      colColor: "颜色",
      colLabel: "标注",
      classify: "分类",
      colorTableMax: "颜色表最多 256 项",
      colorTableOverlap: "区间不能与现有行相交",
      tipCmapDrag: "拖动调整颜色顺序（ID 仍为行号 0…N）",
      deleteAll: "全部删除",
      reloadCmap: "加载色表",
      saveCmap: "保存色表",
      savePlte: "另存为 PLTE",
      missingData: "缺少像素数据",
      tipReload: "从 JSON 文件加载色表",
      tipSave: "将色表保存为 JSON 文件",
      tipPlte: "按当前颜色表导出索引色 PNG；多波段使用颜色表所选波段",
      tipReset: "定位全图（适应窗口）",
      tipZoomNative: "按原图分辨率 1:1 显示",
      mapHead: "地图",
      clearLayers: "移除",
      tipClearLayers: "移除所选图层；Shift+点击作用于全部",
      tipEditAffine: "编辑仿射",
      tipAdd: "在选中行下方插入一行",
      tipRemove: "删除选中行",
      tipMore: "更多",
      tipRemoveFile: "移除",
      fileListEmpty: "右键文件「添加为图层」加入当前视图",
      tipReorder: "拖拽调整图层顺序",
      tipLocate: "定位全图；Shift+点击按 1:1 显示",
      tipVisibility: "显示/隐藏所选图层；Shift+点击作用于全部",
      tipZoomNativeItem: "按该图层原图分辨率 1:1 显示",
      tipHoverLock: "双击地图锁定/解锁地理坐标，便于复制",
      hoverLocked: "锁定",
      mapCrs: "地图坐标系",
      mapCrsCustom: "自定义…",
      mapCrsApply: "应用",
      affine: "仿射",
      layerList: "图层",
      tabStyle: "样式",
      tabIdentify: "识别",
      tabSettings: "设置",
      tipCollapseIdentify: "折叠识别",
      tipExpandIdentify: "展开识别",
      identifyEmpty: "在地图上点击以识别各图层像元值",
      identifyNoData: "无数据",
      identifyNotLoaded: "未加载像元",
      identifyOut: "不在范围内",
      identifyFeature: "要素",
      identifyValue: "值",
      statusGeo: "地理坐标",
    },
    en: {
      renderGray: "Singleband gray",
      renderRgb: "Multiband color",
      renderPaletted: "Color table",
      resample: "Resampling",
      resampleNearest: "Nearest neighbor",
      resampleLinear: "Linear",
      grayBand: "Gray band",
      colorRamp: "Color ramp",
      rampBw: "Black to white",
      rampWb: "White to black",
      minVal: "Min",
      maxVal: "Max",
      contrast: "Contrast enhancement",
      contrastMinMax: "Stretch to MinMax",
      contrastPercent: "Percentage linear stretch",
      contrastStdDev: "Mean ± std. deviation",
      contrastNone: "No enhancement",
      percentCut: "Percent",
      stdDevN: "Std. dev. multiplier",
      rampInvert: "Invert color ramp",
      paletteOpacity: "Transparency",
      redBand: "Red band",
      greenBand: "Green band",
      blueBand: "Blue band",
      classBand: "Band",
      paletteRamp: "Color ramp",
      rampRandom: "Random colors",
      rampHash: "Hash colors",
      bandUnset: "Not set",
      bandN: "Band",
      colValue: "Value",
      colIndex: "ID",
      colMin: "≥",
      colMax: "<",
      colColor: "Color",
      colLabel: "Label",
      classify: "Classify",
      colorTableMax: "Color table is limited to 256 rows",
      colorTableOverlap: "Range must not overlap existing rows",
      tipCmapDrag: "Drag to reorder colors (ID stays row index 0…N)",
      deleteAll: "Delete all",
      reloadCmap: "Load colormap",
      saveCmap: "Save colormap",
      savePlte: "Save as PLTE",
      missingData: "Missing pixel data",
      tipReload: "Load colormap from a JSON file",
      tipSave: "Save colormap to a JSON file",
      tipPlte: "Export indexed PNG from the color table; multi-band uses the selected palette band",
      tipReset: "Fit layer to view",
      tipZoomNative: "1:1 native resolution",
      mapHead: "Map",
      clearLayers: "Remove",
      tipClearLayers: "Remove selected layers; Shift+click applies to all",
      tipEditAffine: "Edit affine",
      tipAdd: "Insert a row below the selection",
      tipRemove: "Delete the selected row",
      tipMore: "More",
      tipRemoveFile: "Remove",
      fileListEmpty: "Right-click a file → Add as Layer",
      tipReorder: "Drag to reorder layers",
      tipLocate: "Zoom to layer; Shift+click for 1:1",
      tipVisibility: "Show/hide selected layers; Shift+click applies to all",
      tipZoomNativeItem: "1:1 native resolution for this layer",
      tipHoverLock: "Double-click map to lock/unlock geographic coordinates for copy",
      hoverLocked: "Locked",
      mapCrs: "Map CRS",
      mapCrsCustom: "Custom…",
      mapCrsApply: "Apply",
      affine: "Affine",
      layerList: "Layers",
      tabStyle: "Style",
      tabIdentify: "Identify",
      tabSettings: "Settings",
      tipCollapseIdentify: "Collapse identify",
      tipExpandIdentify: "Expand identify",
      identifyEmpty: "Click the map to identify band values for all layers",
      identifyNoData: "No data",
      identifyNotLoaded: "Pixels not loaded",
      identifyOut: "Outside extent",
      identifyFeature: "Feature",
      identifyValue: "Value",
      statusGeo: "Geographic",
    },
  };

  let lang = payload.uiLang === "en" ? "en" : "zh";
  let colormap = { ...(payload.colormap || {}) };
  /** @type {Array<{min:number,max:number,color:string}>} */
  let colorTable = (() => {
    const fromPayload = parseColorTable(payload.colorTable);
    if (fromPayload.length) return fromPayload;
    return colorTableFromLegacyMap(colormap, {});
  })();
  let labels = {};
  let selectedValue = null;
  /** Once user picks a render type in the UI, never auto-override it. */
  let userRenderMode = null;
  let renderMode =
    payload.defaultRender ||
    (Math.max(1, Number(payload.bands) || 1) >= 3 ? "rgb" : "gray");
  let initGeneration = 0;
  let activeFileId = payload.activeId || payload.id || payload.filePath || null;
  /** @type {Map<string, object>} */
  const fileUiState = new Map();
  /** @type {Array<{id:string,name:string,filePath:string}>} */
  let fileList = Array.isArray(payload.files) ? [...payload.files] : [];
  /** Map display CRS (always an EPSG code). */
  let mapCrs = "EPSG:3857";


  function pickDefaultRender(nBands, planes, stats) {
    if (nBands >= 3) return "rgb";
    const plane = planes[0];
    const s = stats[0];
    if (!plane || !s) return "gray";
    if (s.max - s.min >= 128) return "gray";
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (!Number.isFinite(v) || !Number.isInteger(v)) return "gray";
    }
    return "paletted";
  }

  const metaEl = document.getElementById("meta");
  const fileListEl = document.getElementById("fileList");
  const sideEl = document.getElementById("side");
  const sideTopEl = document.getElementById("sideTop");
  const splitInfoEl = document.getElementById("splitInfo");
  const splitIdentifyEl = document.getElementById("splitIdentify");
  const sideIdentifyEl = document.getElementById("sideIdentify");
  const btnToggleIdentify = document.getElementById("btnToggleIdentify");
  const mapSectionEl = document.getElementById("mapSection");
  const splitSideEl = document.getElementById("splitSide");
  const mainEl = document.getElementById("main");
  const statusBarEl = document.getElementById("statusBar");
  const hoverLockBadge = document.getElementById("hoverLockBadge");
  const mapCrsSelect = document.getElementById("mapCrsSelect");
  const mapCrsCustom = document.getElementById("mapCrsCustom");
  const KNOWN_MAP_CRS = ["EPSG:4326", "EPSG:3857", "EPSG:4490", "EPSG:4547"];
  const geoInfoEl = document.getElementById("geoInfo");
  const geoCrsLabelEl = document.getElementById("geoCrsLabel");
  const affineInput = document.getElementById("affineInput");
  const affineView = document.getElementById("affineView");
  const affineText = document.getElementById("affineText");
  const btnEditAffine = document.getElementById("btnEditAffine");
  /** Last applied affine text — blur only reapplies when changed. */
  let lastAppliedAffineText = "";
  let affineEditing = false;

  const cmapBody = document.getElementById("cmapBody");
  const mapEl = document.getElementById("map");
  const hoverEl = document.getElementById("hover");
  let hoverLocked = false;
  const zoomBadge = null;
  const resampleModeEl = document.getElementById("resampleMode");
  const renderTypeEl = document.getElementById("renderType");
  const grayBandEl = document.getElementById("grayBand");
  const grayRampEl = document.getElementById("grayRamp");
  const grayMinEl = document.getElementById("grayMin");
  const grayMaxEl = document.getElementById("grayMax");
  const grayContrastEl = document.getElementById("grayContrast");
  const redBandEl = document.getElementById("redBand");
  const greenBandEl = document.getElementById("greenBand");
  const blueBandEl = document.getElementById("blueBand");
  const redMinEl = document.getElementById("redMin");
  const redMaxEl = document.getElementById("redMax");
  const greenMinEl = document.getElementById("greenMin");
  const greenMaxEl = document.getElementById("greenMax");
  const blueMinEl = document.getElementById("blueMin");
  const blueMaxEl = document.getElementById("blueMax");
  const rgbContrastEl = document.getElementById("rgbContrast");
  const paletteBandEl = document.getElementById("paletteBand");
  const paletteRampEl = document.getElementById("paletteRamp");
  const btnRampInvertEl = document.getElementById("btnRampInvert");
  const paletteOpacityEl = document.getElementById("paletteOpacity");
  const paletteOpacityValEl = document.getElementById("paletteOpacityVal");
  const grayStretchOpts = document.getElementById("grayStretchOpts");
  const grayStretchLabel = document.getElementById("grayStretchLabel");
  const grayStretchParam = document.getElementById("grayStretchParam");
  const rgbStretchOpts = document.getElementById("rgbStretchOpts");
  const rgbStretchLabel = document.getElementById("rgbStretchLabel");
  const rgbStretchParam = document.getElementById("rgbStretchParam");
  let randomSeed = 1;

  const btnClassify = document.getElementById("btnClassify");
  const btnAddRow = document.getElementById("btnAddRow");
  const btnRemoveRow = document.getElementById("btnRemoveRow");
  const btnClearRows = document.getElementById("btnClearRows");
  const btnMore = document.getElementById("btnMore");
  const moreMenu = document.getElementById("moreMenu");
  const btnReload = document.getElementById("btnReloadCmap");
  const btnSave = document.getElementById("btnSaveCmap");
  const btnSavePlte = document.getElementById("btnSavePlte");
  const btnToggleVisibility = document.getElementById("btnToggleVisibility");
  const btnClearLayers = document.getElementById("btnClearLayers");
  const tabStyleEl = document.getElementById("tabStyle");
  const tabSettingsEl = document.getElementById("tabSettings");
  const panelStyleEl = document.getElementById("panelStyle");
  const panelSettingsEl = document.getElementById("panelSettings");
  const identifyEmptyEl = document.getElementById("identifyEmpty");
  const identifyTableWrap = document.getElementById("identifyTableWrap");
  const identifyBodyEl = document.getElementById("identifyBody");
  /** @type {Set<string>} collapsed layer ids in identify table */
  const identifyCollapsed = new Set();
  /** @type {Set<string>} multi-selected layer ids (Ctrl/Shift) */
  const selectedFileIds = new Set();
  /** Anchor id for Shift+click range selection */
  let selectionAnchorId = null;
  /** Explicit visibility overrides (works even before layer is in fileCache). */
  const layerVisibility = new Map();
  /** Serialize rasterReady/maskData inits so multi-file loads don't cancel each other. */
  const rasterLoadQueue = [];
  let rasterLoadBusy = false;
  /** maskData may arrive while another file is active — apply when that file loads. */
  const pendingMaskData = new Map();

  async function drainRasterLoadQueue() {
    if (rasterLoadBusy) return;
    rasterLoadBusy = true;
    try {
      while (rasterLoadQueue.length) {
        const item = rasterLoadQueue.shift();
        if (!item) continue;
        if (item.kind === "ready") {
          const msg = item.msg;
          const id = msg.id || msg.fileId || msg.filePath;
          const existing = id ? fileCache.get(id) : null;
          // Skip only when we already have a coherent layer for this kind.
          const layerOk =
            existing?.layer &&
            (!msg.kind || !existing.kind || existing.kind === msg.kind) &&
            !(msg.kind === "mask" && (existing.bandCount || 0) >= 3);
          if (layerOk) {
            if (msg.activate !== false && id) {
              await activateFile(id, { fit: false, keepSelection: false });
            }
            continue;
          }
          const wantActivate = msg.activate !== false;
          const prevActive = activeFileId;
          const prevSelected = keepSelectionSnapshot();
          if (activeFileId && id && activeFileId !== id) snapshotUiState();
          applyFilePayload(msg);
          // Inline indices (preferred) or pending maskData fallback.
          const pending = id ? pendingMaskData.get(id) : null;
          if (msg.indexBase64) {
            payload.indexBase64 = msg.indexBase64;
            payload.indexFormat = msg.indexFormat || "i32";
          } else if (pending?.indexBase64) {
            payload.indexBase64 = pending.indexBase64;
            payload.indexFormat = pending.indexFormat || "i32";
            if (pending.width) payload.width = pending.width;
            if (pending.height) payload.height = pending.height;
            pendingMaskData.delete(id);
          }
          if (payload.awaitIndices && !payload.indexBase64) {
            continue;
          }
          await init();
          if (!wantActivate && prevActive && prevActive !== activeFileId) {
            restoreSelectionAfterBackgroundLoad(prevActive, prevSelected);
          } else if (id) {
            await activateFile(id, { fit: false, keepSelection: false });
          }
        } else if (item.kind === "mask") {
          const msg = item.msg;
          const targetId = item.targetId || msg.fileId || activeFileId;
          if (!targetId || !msg.indexBase64) continue;
          pendingMaskData.set(targetId, msg);
          const cached = fileCache.get(targetId);
          // Use host kind only — never infer "image" from stale bandCount (JPG leftovers).
          const kind =
            cached?.kind ||
            (targetId === activeFileId ? payload.kind : null) ||
            null;
          if (kind === "image") continue;
          if (targetId === activeFileId || !cached?.layer) {
            payload.indexBase64 = msg.indexBase64;
            payload.indexFormat = msg.indexFormat || "i32";
            if (msg.width) payload.width = msg.width;
            if (msg.height) payload.height = msg.height;
            if (targetId) activeFileId = targetId;
            pendingMaskData.delete(targetId);
            await init();
            await activateFile(targetId, { fit: false, keepSelection: false });
          } else if (cached) {
            try {
              const w = msg.width || cached.width;
              const h = msg.height || cached.height;
              const values = decodeIndices(msg.indexBase64, msg.indexFormat || "i32", w * h);
              cached.bandPlanes = [values];
              cached.bandCount = 1;
              cached.bandStats = [computeStats(values)];
              cached.width = w;
              cached.height = h;
              pendingMaskData.delete(targetId);
              await rebuildLayerForFile(targetId);
            } catch (err) {
              console.error("maskData for", targetId, err);
            }
          }
        }
      }
    } finally {
      rasterLoadBusy = false;
      if (rasterLoadQueue.length) void drainRasterLoadQueue();
    }
  }

  function t(key) {
    return I18N[lang][key] || I18N.zh[key] || key;
  }

  function applyRenderModeUi() {
    document.body.classList.remove("render-gray", "render-rgb", "render-paletted");
    document.body.classList.add(`render-${renderMode}`);
    renderTypeEl.value = renderMode;
    syncStretchParamUi?.();
  }

  function applyI18n() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    if (btnToggleVisibility) {
      btnToggleVisibility.title = t("tipVisibility");
      btnToggleVisibility.setAttribute("aria-label", t("tipVisibility"));
    }
    if (btnClearLayers) {
      btnClearLayers.title = t("tipClearLayers");
      btnClearLayers.setAttribute("aria-label", t("clearLayers"));
    }
    if (btnEditAffine) {
      btnEditAffine.title = t("tipEditAffine");
      btnEditAffine.setAttribute("aria-label", t("tipEditAffine"));
    }
    btnReload.title = t("tipReload");
    btnSave.title = t("tipSave");
    btnSavePlte.title = t("tipPlte");
    btnAddRow.title = t("tipAdd");
    btnRemoveRow.title = t("tipRemove");
    btnMore.title = t("tipMore");
    if (btnRampInvertEl) {
      btnRampInvertEl.title = t("rampInvert");
      btnRampInvertEl.setAttribute("aria-label", t("rampInvert"));
    }
    fillBandSelects();
    updateMeta();
    renderFileList();
    syncMapCrsUi();
    syncHoverLockUi();
    syncIdentifyCollapseUi();
    if (renderMode === "paletted") renderCmapTable();
  }

  function identityAffine(_h = height || 0) {
    return [0, 1, 0, 0, 0, 1];
  }

  /** Build geo ref from GDAL GeoTransform (same rules as extension `fromGeoTransform`). */
  function geoFromTransform(gt, crs, source = "user") {
    const sx = Math.abs(gt[1]) || 1;
    const sy = Math.abs(gt[5]) || Math.abs(gt[4]) || 1;
    const yFlipped = gt[5] < 0;
    const crsOut =
      source === "identity" || !crs || crs === "Local" || crs === "Unknown"
        ? "Local"
        : crs;
    return {
      geoTransform: [...gt],
      crs: crsOut,
      modelPixelScale: [sx, sy, 0],
      modelTiepoint: [0, 0, 0, gt[0], gt[3], 0],
      yFlipped,
      source,
    };
  }

  function normalizeGeoRef(g, w = width, h = height) {
    if (!g) {
      return geoFromTransform(identityAffine(h || 0), "Local", "identity");
    }
    const crs =
      g.source === "identity" || !g.crs || g.crs === "Local" || g.crs === "Unknown"
        ? "Local"
        : g.crs;
    const gt = Array.isArray(g.geoTransform) && g.geoTransform.length >= 6
      ? g.geoTransform.map(Number)
      : identityAffine(h || g.modelTiepoint?.[4] || 0);
    if (!gt.every(Number.isFinite)) {
      return geoFromTransform(identityAffine(h || 0), crs, g.source || "identity");
    }
    // Prefer derived fields from GT so scale/tiepoint stay consistent when CRS defaulted
    const derived = geoFromTransform(gt, crs, g.source || "user");
    // Keep explicit scale/tiepoint if present and CRS was already valid EPSG
    if (normalizeEpsg(g.crs) && g.modelPixelScale && g.modelTiepoint) {
      return {
        ...derived,
        modelPixelScale: g.modelPixelScale,
        modelTiepoint: g.modelTiepoint,
        yFlipped: g.yFlipped !== false,
        source: g.source || derived.source,
      };
    }
    return derived;
  }

  function currentAffine() {
    const gt = geo?.geoTransform;
    if (Array.isArray(gt) && gt.length >= 6 && gt.every((n) => Number.isFinite(Number(n)))) {
      return gt.map(Number);
    }
    return identityAffine();
  }

  function currentCrs() {
    const c = geo?.crs;
    if (c) return c;
    return mapCrs || "EPSG:3857";
  }

  /**
   * Layer CRS policy:
   * - file has EPSG → keep it (OpenLayers reprojects into current map CRS)
   * - no CRS / Local → assign current map CRS (do not switch the map)
   */
  function applyLayerCrsPolicy(g, w = width, h = height) {
    const base = normalizeGeoRef(g, w, h);
    if (normalizeEpsg(base.crs)) return base;
    const crs = mapCrs || "EPSG:3857";
    return { ...base, crs };
  }

  function fileHasOwnCrs(g) {
    return g?.source === "geotiff" && !!normalizeEpsg(g?.crs);
  }

  function formatAffineNum(v) {
    if (!Number.isFinite(v)) return "NaN";
    if (Number.isInteger(v)) return String(v);
    const s = Number(v).toPrecision(12).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return s;
  }

  function formatAffineLine(gt) {
    const vals = gt || currentAffine();
    return vals.map(formatAffineNum).join(", ");
  }

  function parseAffineLine(text) {
    const parts = String(text || "")
      .trim()
      .split(/[,，\s]+/)
      .filter((s) => s.length > 0);
    if (parts.length !== 6) return null;
    const gt = parts.map(Number);
    if (!gt.every(Number.isFinite)) return null;
    return gt;
  }

  /** Decimal places for live geo coords from current view resolution. */
  function geoCoordDecimals() {
    const res = map?.getView()?.getResolution?.();
    if (!Number.isFinite(res) || res <= 0) return 6;
    // Aim ~100× finer than current resolution; keep enough digits for Local / projected / geographic.
    const d = Math.ceil(-Math.log10(res)) + 2;
    return Math.max(4, Math.min(12, d));
  }

  function formatGeoCoord(v) {
    if (!Number.isFinite(v)) return "—";
    return Number(v).toFixed(geoCoordDecimals());
  }

  function fillAffineInputs(gt) {
    const text = formatAffineLine(gt);
    lastAppliedAffineText = text;
    if (affineText) affineText.textContent = text;
    if (affineInput && document.activeElement !== affineInput) {
      affineInput.value = text;
    }
  }

  function setAffineEditMode(editing) {
    affineEditing = !!editing;
    if (affineView) {
      affineView.classList.toggle("hidden", affineEditing);
      affineView.hidden = affineEditing;
    }
    if (affineInput) {
      affineInput.classList.toggle("hidden", !affineEditing);
      affineInput.hidden = !affineEditing;
      if (affineEditing) {
        affineInput.value = lastAppliedAffineText || formatAffineLine();
        requestAnimationFrame(() => {
          affineInput.focus();
          affineInput.select();
        });
      }
    }
  }

  function readAffineInputs() {
    return parseAffineLine(affineInput?.value);
  }

  function pixelToGeo(col, row, gt, useCenter = true) {
    const c = useCenter ? col + 0.5 : col;
    const r = useCenter ? row + 0.5 : row;
    return {
      x: gt[0] + c * gt[1] + r * gt[2],
      y: gt[3] + c * gt[4] + r * gt[5],
    };
  }


  /** @type {Map<string, any>} per-file cache: planes, layer, geo, meta… */
  const fileCache = new Map();
  let dragFromId = null;

  function snapshotUiState() {
    if (!activeFileId) return;
    fileUiState.set(activeFileId, {
      renderMode,
      userRenderMode,
      colormap: { ...colormap },
      colorTable: serializeColorTable(colorTable),
      labels: { ...labels },
      selectedValue,
      resample: resampleModeEl?.value || "nearest",
      grayBand: grayBandEl.value,
      grayRamp: grayRampEl.value,
      grayMin: grayMinEl.value,
      grayMax: grayMaxEl.value,
      grayContrast: grayContrastEl.value,
      grayStretchParam: grayStretchParam?.value,
      redBand: redBandEl.value,
      greenBand: greenBandEl.value,
      blueBand: blueBandEl.value,
      redMin: redMinEl.value,
      redMax: redMaxEl.value,
      greenMin: greenMinEl.value,
      greenMax: greenMaxEl.value,
      blueMin: blueMinEl.value,
      blueMax: blueMaxEl.value,
      rgbContrast: rgbContrastEl.value,
      rgbStretchParam: rgbStretchParam?.value,
      paletteBand: paletteBandEl.value,
      paletteRamp: paletteRampEl.value,
      paletteOpacity: paletteOpacityEl?.value ?? "0",
      randomSeed,
    });
    const cached = fileCache.get(activeFileId);
    if (cached) {
      cached.bandPlanes = bandPlanes;
      cached.bandStats = bandStats;
      cached.bandCount = bandCount;
      cached.width = width;
      cached.height = height;
      cached.geo = geo;
      cached.rasterUrl = rasterUrl;
      cached.probeLabel = payload.probeLabel;
      cached.styleState = collectStyleState();
    }
  }

  function restoreUiState(id, defaults) {
    const st = fileUiState.get(id);
    if (!st) {
      userRenderMode = null;
      renderMode = defaults?.defaultRender || "gray";
      colormap = { ...(defaults?.colormap || {}) };
      const fromDefaults = parseColorTable(defaults?.colorTable);
      colorTable = fromDefaults.length
        ? fromDefaults
        : colorTableFromLegacyMap(colormap, {});
      labels = {};
      selectedValue = null;
      if (paletteRampEl) paletteRampEl.value = "random";
      if (paletteOpacityEl) paletteOpacityEl.value = "0";
      if (resampleModeEl) resampleModeEl.value = "nearest";
      syncPaletteOpacityLabel();
      return;
    }
    userRenderMode = st.userRenderMode;
    renderMode = st.renderMode || renderMode;
    colormap = { ...st.colormap };
    labels = { ...st.labels };
    colorTable = Array.isArray(st.colorTable) && st.colorTable.length
      ? parseColorTable(st.colorTable)
      : colorTableFromLegacyMap(colormap, labels);
    selectedValue = st.selectedValue;
    randomSeed = st.randomSeed || randomSeed;
    const assign = (el, v) => {
      if (el && v != null && v !== "") el.value = String(v);
    };
    assign(resampleModeEl, st.resample || "nearest");
    assign(grayBandEl, st.grayBand);
    assign(grayRampEl, st.grayRamp);
    assign(grayMinEl, st.grayMin);
    assign(grayMaxEl, st.grayMax);
    assign(grayContrastEl, st.grayContrast);
    assign(grayStretchParam, st.grayStretchParam);
    assign(redBandEl, st.redBand);
    assign(greenBandEl, st.greenBand);
    assign(blueBandEl, st.blueBand);
    assign(redMinEl, st.redMin);
    assign(redMaxEl, st.redMax);
    assign(greenMinEl, st.greenMin);
    assign(greenMaxEl, st.greenMax);
    assign(blueMinEl, st.blueMin);
    assign(blueMaxEl, st.blueMax);
    assign(rgbContrastEl, st.rgbContrast);
    assign(rgbStretchParam, st.rgbStretchParam);
    assign(paletteBandEl, st.paletteBand);
    assign(paletteRampEl, st.paletteRamp);
    assign(paletteOpacityEl, st.paletteOpacity ?? "0");
    syncPaletteOpacityLabel();
  }

  /** Reset style/settings UI after all layers are removed. */
  function resetStyleUiForEmptyView() {
    userRenderMode = null;
    renderMode = "gray";
    colormap = {};
    labels = {};
    colorTable = [];
    selectedValue = null;
    bandCount = 1;
    bandPlanes = [];
    bandStats = [];
    payload.probeLabel = "";
    payload.kind = undefined;
    payload.dtype = undefined;
    payload.defaultRender = undefined;
    payload.colormap = {};
    payload.colorTable = [];
    payload.bands = 1;
    payload.format = undefined;
    payload.width = undefined;
    payload.height = undefined;
    payload.geo = null;
    payload.rasterUrl = undefined;
    payload.overviewUrls = [];
    clearDecodePayload();

    if (resampleModeEl) resampleModeEl.value = "nearest";
    if (grayRampEl) grayRampEl.value = "blackwhite";
    if (grayContrastEl) grayContrastEl.value = "none";
    if (grayMinEl) grayMinEl.value = "";
    if (grayMaxEl) grayMaxEl.value = "";
    if (grayStretchParam) {
      grayStretchParam.value = "2";
      delete grayStretchParam.dataset.touched;
      delete grayStretchParam.dataset.touchedStd;
    }
    if (rgbContrastEl) rgbContrastEl.value = "none";
    if (redMinEl) redMinEl.value = "";
    if (redMaxEl) redMaxEl.value = "";
    if (greenMinEl) greenMinEl.value = "";
    if (greenMaxEl) greenMaxEl.value = "";
    if (blueMinEl) blueMinEl.value = "";
    if (blueMaxEl) blueMaxEl.value = "";
    if (rgbStretchParam) {
      rgbStretchParam.value = "2";
      delete rgbStretchParam.dataset.touched;
      delete rgbStretchParam.dataset.touchedStd;
    }
    if (paletteRampEl) paletteRampEl.value = "random";
    if (paletteOpacityEl) paletteOpacityEl.value = "0";
    syncPaletteOpacityLabel();
    fillBandSelects();
    applyRenderModeUi();
    renderCmapTable();
    setSideTab("style");
  }

  function syncLayerOrder() {
    const n = fileList.length;
    // Only adjust zIndex — never remove/re-add layers (that flashes the whole map).
    for (let i = 0; i < n; i++) {
      const layer = fileCache.get(fileList[i].id)?.layer;
      if (!layer) continue;
      const z = n - i;
      if (layer.getZIndex() !== z) layer.setZIndex(z);
    }
  }

  function reorderFiles(fromId, toId, placeAfter) {
    if (!fromId || !toId || fromId === toId) return;
    const from = fileList.findIndex((f) => f.id === fromId);
    const to = fileList.findIndex((f) => f.id === toId);
    if (from < 0 || to < 0) return;
    const [item] = fileList.splice(from, 1);
    let insert = fileList.findIndex((f) => f.id === toId);
    if (placeAfter) insert += 1;
    fileList.splice(insert, 0, item);
    syncLayerOrder();
    renderFileList();
    vscodeApi?.postMessage({ type: "reorderFiles", ids: fileList.map((f) => f.id) });
  }

  function layerActionIcon(kind) {
    if (kind === "handle") {
      return `<svg width="12" height="16" viewBox="0 0 10 14" aria-hidden="true"><circle cx="3" cy="3" r="1.35" fill="currentColor"/><circle cx="7" cy="3" r="1.35" fill="currentColor"/><circle cx="3" cy="7" r="1.35" fill="currentColor"/><circle cx="7" cy="7" r="1.35" fill="currentColor"/><circle cx="3" cy="11" r="1.35" fill="currentColor"/><circle cx="7" cy="11" r="1.35" fill="currentColor"/></svg>`;
    }
    if (kind === "locate") {
      return `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5a.75.75 0 0 1 .75.75v1.1a4.75 4.75 0 0 1 3.9 3.9h1.1a.75.75 0 0 1 0 1.5h-1.1a4.75 4.75 0 0 1-3.9 3.9v1.1a.75.75 0 0 1-1.5 0v-1.1a4.75 4.75 0 0 1-3.9-3.9H1.75a.75.75 0 0 1 0-1.5h1.1a4.75 4.75 0 0 1 3.9-3.9V2.25A.75.75 0 0 1 8 1.5zm0 3.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5zm0 2a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/></svg>`;
    }
    if (kind === "eye") {
      return `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 3c3.2 0 5.8 2.1 7 5-1.2 2.9-3.8 5-7 5S2.2 10.9 1 8c1.2-2.9 3.8-5 7-5zm0 1.5A3.5 3.5 0 1 0 8 11.5 3.5 3.5 0 0 0 8 4.5zm0 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>`;
    }
    if (kind === "eyeOff") {
      return `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.28 1.22a.75.75 0 0 1 1.06 0l12.44 12.44a.75.75 0 1 1-1.06 1.06l-2.2-2.2A7.7 7.7 0 0 1 8 13c-3.2 0-5.8-2.1-7-5a8.4 8.4 0 0 1 2.56-3.3L1.28 2.28a.75.75 0 0 1 0-1.06zM8 4.5c.4 0 .78.07 1.14.2L7.3 5.54A2 2 0 0 0 6.46 8.7L4.7 10.46C3.3 9.7 2.2 8.7 1.55 8 2.7 5.9 4.9 4.5 8 4.5zm6.45 1.2-1.6 1.6c.4.5.7 1.05.95 1.7-.85 1.85-2.5 3.2-4.7 3.7l-1.35-1.35c.4.12.82.2 1.25.2a3.5 3.5 0 0 0 3.45-2.95l1.7-1.7c.1.26.2.53.3.8z"/></svg>`;
    }
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/></svg>`;
  }

  function isLayerVisible(id) {
    if (layerVisibility.has(id)) return layerVisibility.get(id) !== false;
    const cached = fileCache.get(id);
    return cached?.visible !== false;
  }

  /** Visibility only — opacity is owned by styleState (transparency slider). */
  function applyOlLayerVisibility(layer, visible, styleState) {
    if (!layer) return;
    layer.setVisible(!!visible);
    if (typeof layer.setOpacity === "function") {
      layer.setOpacity(opacityFromStyleState(styleState));
    }
  }

  function setLayerVisibility(id, visible) {
    const v = !!visible;
    layerVisibility.set(id, v);
    const cached = fileCache.get(id);
    if (cached) {
      cached.visible = v;
      applyOlLayerVisibility(cached.layer, v, cached.styleState);
    }
    // Re-assert siblings — WebGL style rebuilds can revive hidden layers.
    assertAllLayerVisibility();
    map?.render?.();
  }

  function assertAllLayerVisibility() {
    for (const [fid, cached] of fileCache) {
      if (!cached?.layer) continue;
      const vis = isLayerVisible(fid);
      cached.visible = vis;
      applyOlLayerVisibility(cached.layer, vis, cached.styleState);
    }
  }

  /**
   * Attach GeoTIFF nodata alpha band indices so styles can punch transparent holes
   * in reprojected AABB padding (otherwise opaque black).
   */
  function styleStateWithAlpha(state, layer, dataBands) {
    const st = { ...(state || {}) };
    const n = Math.max(1, Number(dataBands) || Number(st.bandCount) || 1);
    st.bandCount = n;
    const sb = Number(layer?.getSource?.()?.bandCount);
    if (Number.isFinite(sb)) {
      st.sourceBandCount = sb;
      if (sb > n) st.alphaBand = sb;
      else delete st.alphaBand;
    }
    return st;
  }

  /**
   * Re-apply every layer's cached WebGL style after one layer's setStyle.
   * Without this, adding a mask can leave the JPG undrawn until the user clicks it.
   */
  function refreshAllCachedLayerStyles() {
    for (const [fid, cached] of fileCache) {
      if (!cached?.layer || !cached.styleState) continue;
      try {
        const st = styleStateWithAlpha(
          cached.styleState,
          cached.layer,
          cached.bandCount || cached.styleState.bandCount || 1,
        );
        cached.styleState = st;
        applyStyle(cached.layer, st);
      } catch (err) {
        console.error("refresh style", fid, err);
      }
      applyOlLayerVisibility(cached.layer, isLayerVisible(fid), cached.styleState);
    }
    map?.render?.();
  }

  function pruneSelection() {
    const valid = new Set(fileList.map((f) => f.id));
    for (const id of [...selectedFileIds]) {
      if (!valid.has(id)) selectedFileIds.delete(id);
    }
    if (selectionAnchorId && !valid.has(selectionAnchorId)) {
      selectionAnchorId = selectedFileIds.values().next().value || activeFileId || null;
    }
  }

  function selectedIdsOrdered() {
    pruneSelection();
    return fileList.map((f) => f.id).filter((id) => selectedFileIds.has(id));
  }

  function ensureSelectionHas(id) {
    if (!id) return;
    if (!selectedFileIds.size) {
      selectedFileIds.add(id);
      selectionAnchorId = id;
    }
  }

  function selectOnly(id) {
    selectedFileIds.clear();
    if (id) {
      selectedFileIds.add(id);
      selectionAnchorId = id;
    }
  }

  function selectRange(toId) {
    const ids = fileList.map((f) => f.id);
    const anchor = selectionAnchorId && ids.includes(selectionAnchorId)
      ? selectionAnchorId
      : activeFileId && ids.includes(activeFileId)
        ? activeFileId
        : ids[0];
    const a = ids.indexOf(anchor);
    const b = ids.indexOf(toId);
    if (a < 0 || b < 0) {
      selectOnly(toId);
      return;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    selectedFileIds.clear();
    for (let i = lo; i <= hi; i++) selectedFileIds.add(ids[i]);
  }

  function syncLayerHeadActions() {
    const ids = selectedIdsOrdered();
    const hasFiles = fileList.length > 0;
    const hasSel = ids.length > 0;
    if (btnClearLayers) btnClearLayers.disabled = !hasFiles;
    if (btnToggleVisibility) {
      btnToggleVisibility.disabled = !hasFiles;
      const scopeIds = hasSel ? ids : fileList.map((f) => f.id);
      const allVisible = scopeIds.length > 0 && scopeIds.every((id) => isLayerVisible(id));
      btnToggleVisibility.classList.toggle("is-off", hasFiles && !allVisible);
      btnToggleVisibility.innerHTML = (allVisible || !hasFiles)
        ? layerActionIcon("eye")
        : layerActionIcon("eyeOff");
    }
  }

  function toggleSelectedVisibility({ all = false } = {}) {
    const ids = all
      ? fileList.map((f) => f.id)
      : selectedIdsOrdered();
    if (!ids.length && fileList.length) {
      // Fallback: no selection → toggle active / all files
      ids.push(...(activeFileId ? [activeFileId] : fileList.map((f) => f.id)));
    }
    if (!ids.length) return;
    const next = !ids.every((id) => isLayerVisible(id));
    for (const id of ids) {
      layerVisibility.set(id, next);
      const cached = fileCache.get(id);
      if (cached) cached.visible = next;
      applyOlLayerVisibility(cached?.layer, next, cached?.styleState);
    }
    assertAllLayerVisibility();
    map?.render?.();
    renderFileList();
  }

  function renderFileList() {
    if (!fileListEl) return;
    pruneSelection();
    if (activeFileId) ensureSelectionHas(activeFileId);
    if (!fileList.length) {
      fileListEl.innerHTML = `<li class="file-list-empty">${t("fileListEmpty")}</li>`;
      selectedFileIds.clear();
      selectionAnchorId = null;
      syncLayerHeadActions();
      return;
    }
    fileListEl.innerHTML = fileList
      .map((f) => {
        const active = f.id === activeFileId ? " is-active" : "";
        const selected = selectedFileIds.has(f.id) ? " is-selected" : "";
        const visible = isLayerVisible(f.id);
        const hiddenCls = visible ? "" : " is-hidden-layer";
        const name = escapeAttr(f.name || f.id);
        return `<li class="file-item${active}${selected}${hiddenCls}" data-id="${escapeAttr(f.id)}" draggable="true" title="${escapeAttr(f.filePath || "")} — ${t("tipReorder")}">
          <span class="file-item-handle" aria-hidden="true">${layerActionIcon("handle")}</span>
          <span class="file-item-name">${name}</span>
          <span class="file-item-actions">
            <button type="button" class="file-item-btn" data-act="locate" data-id="${escapeAttr(f.id)}" title="${t("tipLocate")}">${layerActionIcon("locate")}</button>
          </span>
        </li>`;
      })
      .join("");

    fileListEl.querySelectorAll(".file-item").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const id = li.getAttribute("data-id");
        if (!id) return;
        const multi = e.ctrlKey || e.metaKey;
        const range = e.shiftKey;
        if (range && !multi) {
          selectRange(id);
        } else if (multi) {
          if (selectedFileIds.has(id)) {
            if (selectedFileIds.size <= 1) {
              /* keep at least one */
            } else {
              selectedFileIds.delete(id);
              if (id === activeFileId) {
                const next = selectedIdsOrdered()[0];
                selectionAnchorId = next || null;
                if (next) {
                  snapshotUiState();
                  void activateFile(next, { fit: false, requestIfMissing: true, keepSelection: true });
                  return;
                }
              }
              renderFileList();
              return;
            }
          } else {
            selectedFileIds.add(id);
            selectionAnchorId = id;
          }
        } else {
          selectOnly(id);
        }
        if (id !== activeFileId) {
          snapshotUiState();
          void activateFile(id, {
            fit: false,
            requestIfMissing: true,
            keepSelection: multi || range,
          });
        } else {
          setSideTab("style");
          renderFileList();
        }
      });
      li.addEventListener("dragstart", (e) => {
        dragFromId = li.getAttribute("data-id");
        li.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", dragFromId || "");
        } catch {
          /* ignore */
        }
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("is-dragging");
        fileListEl.querySelectorAll(".file-item").forEach((x) => x.classList.remove("drag-over"));
        dragFromId = null;
      });
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        li.classList.add("drag-over");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drag-over");
        const toId = li.getAttribute("data-id");
        const fromId = dragFromId || e.dataTransfer.getData("text/plain");
        if (!fromId || !toId) return;
        const rect = li.getBoundingClientRect();
        const placeAfter = e.clientY > rect.top + rect.height / 2;
        reorderFiles(fromId, toId, placeAfter);
      });
    });
    fileListEl.querySelectorAll(".file-item-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const act = btn.getAttribute("data-act");
        if (!id) return;
        if (act === "locate") {
          void locateFile(id, { native: !!(e.shiftKey || e.altKey) });
        }
      });
    });
    syncLayerHeadActions();
  }

  function removeFileLayer(id) {
    const cached = fileCache.get(id);
    revokeCachedLayerUrls(cached);
    if (cached?.layer && map) {
      map.removeLayer(cached.layer);
    }
    selectedFileIds.delete(id);
    layerVisibility.delete(id);
  }

  /** Reuse GeoTIFF encode output while band planes are unchanged (rebuild / resample). */
  const encodedPlanesCache = new WeakMap();

  function pyramidUseNearest(mode, planes) {
    if (mode === "paletted") return true;
    if ((planes?.length || 0) === 1) return true;
    return false;
  }

  /** All displays go through GeoTIFF + WebGLTile (planes blob or native TIFF URL). */
  function buildLayerSourceArgs(planes, w, h, g, url, overviewUrls, opts = {}) {
    const overs = Array.isArray(overviewUrls) ? overviewUrls : [];
    const crs = blobCrsForGeo(g);
    const nearest = !!opts.nearest;
    if (planes?.length) {
      const pixels = Math.max(0, Number(w) || 0) * Math.max(0, Number(h) || 0);
      const usePyramid = pixels > PYRAMID_MIN_PIXELS;
      const cacheKey = `${w}x${h}|${crs}|${nearest ? 1 : 0}|${usePyramid ? 1 : 0}`;
      let entry = encodedPlanesCache.get(planes);
      if (!entry || entry.key !== cacheKey) {
        const assumeUint8 = planesAreUint8(planes);
        const encOpts = { assumeUint8 };
        if (usePyramid) {
          const packed = planesToPyramidBlobs(planes, w, h, g, crs, {
            nearest,
            assumeUint8,
          });
          entry = {
            key: cacheKey,
            blob: packed.blob,
            overviewBlobs: packed.overviewBlobs,
            overviewCount: packed.overviewCount,
          };
        } else {
          entry = {
            key: cacheKey,
            blob: planesToGeoTiffBlob(planes, w, h, g, crs, encOpts),
            overviewBlobs: [],
            overviewCount: 0,
          };
        }
        encodedPlanesCache.set(planes, entry);
      }
      return {
        kind: "geotiff",
        blob: entry.blob,
        overviewBlobs: entry.overviewBlobs,
        url: null,
        overviews: overs,
        overviewCount: entry.overviewCount + overs.length,
      };
    }
    return {
      kind: "geotiff",
      blob: null,
      overviewBlobs: [],
      url: url || null,
      overviews: overs,
      overviewCount: overs.length,
    };
  }

  async function createLayerFromArgs(srcArgs, opts) {
    const {
      style,
      bandCount: nBands,
      zIndex,
      mins,
      maxs,
      geo: layerGeo,
      width: w,
      height: h,
      interpolate = false,
    } = opts;
    // Blob GeoTIFFs carry CRS in GeoKeys. Native URLs with embedded CRS: leave null
    // so OL reads the file CRS and reprojects to the map. Assigned (no-CRS) URL
    // layers must force the current map CRS.
    let projection = null;
    if (!srcArgs.blob) {
      if (!fileHasOwnCrs(layerGeo)) {
        projection =
          ensureProjection(layerGeo?.crs || mapCrs) ||
          ensureProjection(mapCrs) ||
          LOCAL_PIXEL_PROJECTION;
      }
    }
    const created = await createRasterLayer({
      url: srcArgs.url,
      blob: srcArgs.blob,
      overviewBlobs: srcArgs.overviewBlobs,
      overviews: srcArgs.overviews,
      style,
      bandCount: nBands,
      zIndex,
      mins,
      maxs,
      projection,
      interpolate: !!interpolate,
    });
    if (created.viewConfig && w && h) {
      const extent =
        created.viewConfig.extent || extentFromGeo(w, h, layerGeo);
      created.viewConfig = {
        ...created.viewConfig,
        ...(extent ? { extent } : {}),
        width: w,
        height: h,
      };
    }
    return created;
  }

  function styleInterpolate(style) {
    return style?.resample === "linear";
  }

  function layerSourceBounds(nBands, planes, stats, mode) {
    // Color-table mode uses real data range (range matching in style), not 0..255 lock.
    if (mode === "paletted") {
      return resolveSourceBounds(nBands, stats, planes);
    }
    // Blob-backed layers always need explicit bounds (especially float32).
    if (planes?.length) {
      return resolveSourceBounds(nBands, stats, planes);
    }
    // Native URL with host/PAM stats — still pass bounds so float stretch is correct.
    if (stats?.length && stats.some((s) => Number.isFinite(s?.min) && Number.isFinite(s?.max))) {
      return resolveSourceBounds(nBands, stats, null);
    }
    // Native URL: omit bounds so OL can use GDAL STATISTICS_* or dtype defaults.
    return null;
  }

  function bindActiveFromCache(cached) {
    bandPlanes = cached.bandPlanes || [];
    bandStats = cached.bandStats || [];
    bandCount = cached.bandCount || Math.max(1, bandPlanes.length);
    width = cached.width || 0;
    height = cached.height || 0;
    geo = cached.geo || null;
    rasterUrl = cached.rasterUrl || "";
    viewConfig = cached.viewConfig || null;
    rasterExtent = cached.rasterExtent || (viewConfig?.extent || extentFromGeo(width, height, geo));
    tileLayer = cached.layer || null;
    payload.probeLabel = cached.probeLabel || payload.probeLabel;
    payload.kind = cached.kind || payload.kind;
    payload.dtype = cached.dtype || payload.dtype;
    payload.defaultRender = cached.defaultRender || payload.defaultRender;
    payload.filePath = cached.filePath || payload.filePath;
    payload.bands = bandCount;
    payload.format = cached.format || payload.format;
    payload.width = width;
    payload.height = height;
    payload.geo = geo;
    payload.rasterUrl = rasterUrl;
    if (cached.colormap && !fileUiState.has(activeFileId)) {
      colormap = { ...cached.colormap };
      const fromCache = parseColorTable(cached.colorTable);
      if (fromCache.length) colorTable = fromCache;
    }
  }

  async function activateFile(id, { fit = false, requestIfMissing = false, keepSelection = false } = {}) {
    activeFileId = id;
    if (!keepSelection) selectOnly(id);
    else if (id) selectedFileIds.add(id);
    setSideTab("style");
    const cached = fileCache.get(id);
    if (!cached || !cached.layer) {
      renderFileList();
      // Always tell host — otherwise activeId stays on the previous JPG.
      vscodeApi?.postMessage({ type: "selectFile", id });
      if (requestIfMissing) vscodeApi?.postMessage({ type: "requestFile", id });
      return;
    }
    bindActiveFromCache(cached);
    restoreUiState(id, {
      defaultRender: cached.defaultRender,
      colormap: cached.colormap,
      colorTable: cached.colorTable,
    });
    // If UI state was never set (or lost), follow band count / host default.
    if (!userRenderMode) {
      if (bandPlanes.length) {
        renderMode = pickDefaultRender(bandCount, bandPlanes, bandStats);
      } else if (cached.defaultRender) {
        renderMode = cached.defaultRender;
      }
    }
    ready = bandPlanes.length > 0 || !!cached.layer;
    applyRenderModeUi();
    fillBandSelects();
    // Fill min/max from host PAM / plane stats (native GeoTIFF has no planes).
    setMinMaxInputsFromStats();
    ensureGrayStretchInputs();
    syncStretchParamUi();
    if (renderMode === "paletted") {
      if (!colorTable.length) classifyFromData(true);
      else renderCmapTable();
    }
    updateMeta();
    renderFileList();
    // Selection change must NOT call setStyle — WebGLTile rebuild flashes (incl. hidden layers).
    cached.styleState = collectStyleState();
    assertAllLayerVisibility();
    snapshotUiState();
    if (fit) fitToView();
    vscodeApi?.postMessage({ type: "selectFile", id });
  }

  function keepSelectionSnapshot() {
    return new Set(selectedFileIds);
  }

  /** After loading a background layer, restore prior active without host round-trip. */
  function restoreSelectionAfterBackgroundLoad(prevActive, prevSelected) {
    activeFileId = prevActive;
    selectedFileIds.clear();
    for (const id of prevSelected) selectedFileIds.add(id);
    if (prevActive) selectedFileIds.add(prevActive);
    const cached = fileCache.get(prevActive);
    if (cached?.layer) {
      bindActiveFromCache(cached);
      restoreUiState(prevActive, {
        defaultRender: cached.defaultRender,
        colormap: cached.colormap,
        colorTable: cached.colorTable,
      });
      ready = bandPlanes.length > 0 || !!cached.layer;
      applyRenderModeUi();
      fillBandSelects();
      syncStretchParamUi();
      updateMeta();
      cached.styleState = collectStyleState();
      for (const fid of fileCache.keys()) ensureLayerVisibility(fid);
    }
    renderFileList();
  }

  function ensureLayerVisibility(id) {
    const cached = id ? fileCache.get(id) : null;
    if (!cached?.layer) return;
    const vis = isLayerVisible(id);
    cached.visible = vis;
    applyOlLayerVisibility(cached.layer, vis, cached.styleState);
  }

  function clearDecodePayload() {
    payload.indexBase64 = undefined;
    payload._rgbaBase64 = undefined;
    payload._imageDataUrl = undefined;
    payload.maskDataUrl = undefined;
    payload.awaitIndices = false;
  }

  function applyFilePayload(msg) {
    const id = msg.id || msg.fileId || msg.filePath;
    if (id) activeFileId = id;
    // Drop previous file's decode buffers — stale indexBase64 made RGB look like the mask.
    clearDecodePayload();
    if (msg.probeLabel != null) payload.probeLabel = msg.probeLabel;
    if (msg.kind) payload.kind = msg.kind;
    if (msg.dtype) payload.dtype = msg.dtype;
    if (msg.defaultRender) payload.defaultRender = msg.defaultRender;
    if (msg.colormap) payload.colormap = msg.colormap;
    if (msg.colormapSource) payload.colormapSource = msg.colormapSource;
    if (msg.colormapPath) payload.colormapPath = msg.colormapPath;
    if (msg.filePath) payload.filePath = msg.filePath;
    if (msg.bands) payload.bands = msg.bands;
    if (msg.format) payload.format = msg.format;
    if (msg.width) payload.width = msg.width;
    if (msg.height) payload.height = msg.height;
    if (msg.geo) {
      geo = applyLayerCrsPolicy(msg.geo, msg.width || width, msg.height || height);
      payload.geo = geo;
    }
    if (msg.rasterUrl) {
      payload.rasterUrl = msg.rasterUrl;
      rasterUrl = msg.rasterUrl;
    }
    if (Array.isArray(msg.overviewUrls)) {
      payload.overviewUrls = msg.overviewUrls;
    }
    if (Array.isArray(msg.bandStats) && msg.bandStats.length) {
      payload.bandStats = msg.bandStats;
      bandStats = msg.bandStats.map((s) => ({
        min: Number(s.min),
        max: Number(s.max),
        mean: s.mean != null ? Number(s.mean) : undefined,
        stddev: s.stddev != null ? Number(s.stddev) : undefined,
      }));
    }
    payload.awaitIndices = !!msg.awaitIndices;
    if (msg.indexBase64) {
      payload.indexBase64 = msg.indexBase64;
      payload.indexFormat = msg.indexFormat || "i32";
    }
    // Do not wipe other layers — only reset active decode buffers for reload
    bandPlanes = [];
    if (!Array.isArray(msg.bandStats) || !msg.bandStats.length) {
      bandStats = [];
    }
    bandCount = Math.max(1, Number(payload.bands) || 1);
    // Unbind style target until this file's layer exists (avoids editing the previous JPG).
    tileLayer = null;
    ready = false;
    // Fresh open uses host defaultRender; keep per-file UI if we already have it.
    // Drop previous file's UI sticky mode when opening a file that has no saved state.
    restoreUiState(activeFileId, {
      defaultRender: msg.defaultRender || payload.defaultRender,
      colormap: msg.colormap || payload.colormap,
      colorTable: msg.colorTable || payload.colorTable,
    });
    if (!fileUiState.has(activeFileId)) {
      userRenderMode = null;
      renderMode = msg.defaultRender || payload.defaultRender || "gray";
    }
    if (!fileUiState.has(activeFileId) && (msg.colorTable || msg.colormap)) {
      colormap = { ...(msg.colormap || {}) };
      const fromMsg = parseColorTable(msg.colorTable);
      colorTable = fromMsg.length ? fromMsg : colorTableFromLegacyMap(colormap, {});
      syncColorTableLegacy();
    }
    updateMeta();
    renderFileList();
  }

  function updateMeta() {
    if (metaEl) metaEl.textContent = "";
    const gt = currentAffine();
    fillAffineInputs(gt);
    if (geoInfoEl) {
      let info = payload.probeLabel || "—";
      const cached = activeFileId ? fileCache.get(activeFileId) : null;
      const ovrN = cached?.overviewCount ?? (Array.isArray(payload.overviewUrls) ? payload.overviewUrls.length : 0);
      if (ovrN > 0) info += ` · 外部概览 ${ovrN}`;
      geoInfoEl.textContent = info;
    }
    if (geoCrsLabelEl) {
      geoCrsLabelEl.textContent = currentCrs() || "—";
      if (geo?.source === "identity") {
        geoCrsLabelEl.textContent += " [临时]";
      }
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- OpenLayers map: each file = one WebGLTile layer ----
  let map = null;
  let tileLayer = null;
  let viewConfig = null;
  let rasterExtent = null;
  let geo = payload.geo || null;
  let rasterUrl = payload.rasterUrl || "";
  let mapReady = false;
  let mapBuildId = 0;

  function ensureGrayStretchInputs() {
    const rawMin = grayMinEl?.value;
    const rawMax = grayMaxEl?.value;
    let min = Number(rawMin);
    let max = Number(rawMax);
    const minEmpty = rawMin === "" || rawMin == null;
    const maxEmpty = rawMax === "" || rawMax == null;
    const minBad = minEmpty || !Number.isFinite(min);
    const maxBad = maxEmpty || !Number.isFinite(max);
    const bi = Number(grayBandEl?.value) || 0;
    const s = bandStats[bi];
    // Stale 0..255 from old "none" stretch while data is float/uint16 — replace.
    const staleByteDefault =
      !minBad &&
      !maxBad &&
      min === 0 &&
      max === 255 &&
      s &&
      Number.isFinite(s.min) &&
      Number.isFinite(s.max) &&
      (s.min < 0 || s.max > 255 || !Number.isInteger(s.min) || !Number.isInteger(s.max));
    const orderBad = Number.isFinite(min) && Number.isFinite(max) && max <= min;
    if (minBad || maxBad || orderBad || staleByteDefault) {
      let dMin = 0;
      let dMax = 255;
      if (s && Number.isFinite(s.min) && Number.isFinite(s.max)) {
        dMin = s.min;
        dMax = s.max <= s.min ? s.min + 1 : s.max;
      }
      if (minBad || orderBad || staleByteDefault) min = dMin;
      if (maxBad || orderBad || staleByteDefault) max = dMax;
    }
    // Read-only: never rewrite inputs here (typing must allow clear → retype; blur restores).
    return { min, max };
  }

  function ensureChannelStretch(minEl, maxEl, bandSel) {
    const rawMin = minEl?.value;
    const rawMax = maxEl?.value;
    let min = Number(rawMin);
    let max = Number(rawMax);
    const minEmpty = rawMin === "" || rawMin == null;
    const maxEmpty = rawMax === "" || rawMax == null;
    const minBad = minEmpty || !Number.isFinite(min);
    const maxBad = maxEmpty || !Number.isFinite(max);
    const orderBad = Number.isFinite(min) && Number.isFinite(max) && max <= min;
    if (minBad || maxBad || orderBad) {
      const bi = bandSel === "unset" || bandSel === "" ? -1 : Number(bandSel);
      const s = bi >= 0 ? bandStats[bi] : null;
      let dMin = 0;
      let dMax = 255;
      if (s && Number.isFinite(s.min) && Number.isFinite(s.max)) {
        dMin = s.min;
        dMax = s.max <= s.min ? s.min + 1 : s.max;
      }
      if (minBad || orderBad) min = dMin;
      if (maxBad || orderBad) max = dMax;
    }
    // Read-only: never rewrite inputs here.
    return { min, max };
  }

  function collectStyleState() {
    // Ensure RGB mapping is always valid for multi-band display/stretch.
    if (renderMode === "rgb" && bandCount >= 3) {
      if (!redBandEl.value || redBandEl.value === "unset") redBandEl.value = "0";
      if (!greenBandEl.value || greenBandEl.value === "unset") greenBandEl.value = "1";
      if (!blueBandEl.value || blueBandEl.value === "unset") blueBandEl.value = "2";
    }
    const grayRange = ensureGrayStretchInputs();
    const redRange = ensureChannelStretch(redMinEl, redMaxEl, redBandEl?.value);
    const greenRange = ensureChannelStretch(greenMinEl, greenMaxEl, greenBandEl?.value);
    const blueRange = ensureChannelStretch(blueMinEl, blueMaxEl, blueBandEl?.value);
    const nBands = Math.max(1, bandCount || bandPlanes.length || 1);
    const bounds =
      layerSourceBounds(nBands, bandPlanes, bandStats, renderMode) ||
      (bandPlanes.length
        ? resolveSourceBounds(nBands, bandStats, bandPlanes)
        : null);
    const src = tileLayer?.getSource?.();
    const sourceBandCount = Number(src?.bandCount);
    return {
      mode: renderMode,
      resample: resampleModeEl?.value === "linear" ? "linear" : "nearest",
      grayBand: grayBandEl.value,
      grayMin: grayRange.min,
      grayMax: grayRange.max,
      grayContrast: grayContrastEl.value,
      grayRamp: grayRampEl.value,
      redBand: redBandEl.value,
      greenBand: greenBandEl.value,
      blueBand: blueBandEl.value,
      redMin: redRange.min,
      redMax: redRange.max,
      greenMin: greenRange.min,
      greenMax: greenRange.max,
      blueMin: blueRange.min,
      blueMax: blueRange.max,
      rgbContrast: rgbContrastEl.value,
      paletteBand: paletteBandEl.value,
      paletteOpacity: Number(paletteOpacityEl?.value) || 0,
      colormap,
      colorTable: serializeColorTable(colorTable),
      sourceMins: bounds?.mins,
      sourceMaxs: bounds?.maxs,
      bandCount: nBands,
      sourceBandCount: Number.isFinite(sourceBandCount) ? sourceBandCount : undefined,
      alphaBand: Number.isFinite(sourceBandCount) && sourceBandCount > nBands ? sourceBandCount : undefined,
    };
  }

  function mapToPixel(coord) {
    if (!coord || !width || !height || !rasterExtent) return null;
    let layerCoord = coord;
    const viewProj = map?.getView()?.getProjection?.();
    const layerProj = viewConfig?.projection;
    if (
      mapCrs &&
      viewProj &&
      layerProj &&
      viewProj !== layerProj
    ) {
      try {
        layerCoord = transformCoord(coord, viewProj, layerProj);
      } catch {
        /* keep map coord */
      }
    }
    const sx = (rasterExtent[2] - rasterExtent[0]) / width;
    const sy = (rasterExtent[3] - rasterExtent[1]) / height;
    const x = Math.floor((layerCoord[0] - rasterExtent[0]) / sx);
    const y = Math.floor((rasterExtent[3] - layerCoord[1]) / sy);
    return { x, y, mapX: coord[0], mapY: coord[1] };
  }

  function updateZoomBadge() {
    /* zoom percent removed from status bar */
  }

  function fitExtentToMap(extent, fromProj) {
    if (!map || !extent) return;
    const view = map.getView();
    const viewProj = view.getProjection?.();
    let te = extent;
    if (viewProj && fromProj && fromProj !== viewProj) {
      try {
        te = transformExtent(extent, fromProj, viewProj);
      } catch {
        /* keep */
      }
    }
    view.fit(te, { padding: [24, 24, 24, 24], nearest: true });
    updateZoomBadge();
  }

  function fitToView() {
    if (!map) return;
    if (viewConfig?.extent) {
      fitExtentToMap(viewConfig.extent, viewConfig.projection || map.getView()?.getProjection?.());
      return;
    }
    fitMap(map, viewConfig);
    updateZoomBadge();
  }

  /** Zoom so one image pixel ≈ one CSS pixel (native 1:1). Always centers on the layer. */
  function zoomToNative(targetId) {
    if (!map) return;
    const id = targetId || activeFileId;
    const cached = id ? fileCache.get(id) : null;
    const w = cached?.width || (id === activeFileId ? width : 0);
    const h = cached?.height || (id === activeFileId ? height : 0);
    if (!w || !h) return;
    const extent =
      cached?.rasterExtent ||
      cached?.viewConfig?.extent ||
      (id === activeFileId ? rasterExtent || viewConfig?.extent : null);
    if (!extent) return;
    const view = map.getView();
    const viewProj = view.getProjection?.();
    const fromProj = cached?.viewConfig?.projection || viewConfig?.projection || viewProj;
    let te = extent;
    if (viewProj && fromProj && fromProj !== viewProj) {
      try {
        te = transformExtent(extent, fromProj, viewProj);
      } catch {
        /* keep */
      }
    }
    const resX = Math.abs(te[2] - te[0]) / w;
    const resY = Math.abs(te[3] - te[1]) / h;
    if (!Number.isFinite(resX) || !Number.isFinite(resY) || resX <= 0 || resY <= 0) return;
    const resolution = (resX + resY) / 2;
    const center = [(te[0] + te[2]) / 2, (te[1] + te[3]) / 2];
    view.setCenter(center);
    view.setResolution(resolution);
    updateZoomBadge();
  }

  async function locateFile(id, { native = false } = {}) {
    if (!id) return;
    if (id !== activeFileId) {
      snapshotUiState();
      await activateFile(id, { fit: false, requestIfMissing: true });
    }
    if (native) {
      zoomToNative(id);
      return;
    }
    const cached = fileCache.get(id);
    const vc = cached?.viewConfig || (id === activeFileId ? viewConfig : null);
    const ext = vc?.extent || cached?.rasterExtent;
    if (ext) {
      fitExtentToMap(ext, vc?.projection || map?.getView()?.getProjection?.());
      return;
    }
    fitToView();
  }

  function syncHoverLockUi() {
    statusBarEl?.classList.toggle("is-locked", hoverLocked);
    if (hoverLockBadge) {
      hoverLockBadge.classList.toggle("hidden", !hoverLocked);
      hoverLockBadge.textContent = t("hoverLocked");
    }
    if (hoverEl) {
      hoverEl.title = t("tipHoverLock");
    }
  }

  function toggleHoverLock() {
    hoverLocked = !hoverLocked;
    syncHoverLockUi();
  }

  function setSideTab(name) {
    const tabs = [
      { name: "style", tab: tabStyleEl, panel: panelStyleEl },
      { name: "settings", tab: tabSettingsEl, panel: panelSettingsEl },
    ];
    const target = name === "settings" ? "settings" : "style";
    for (const item of tabs) {
      const on = item.name === target;
      item.tab?.classList.toggle("is-active", on);
      item.tab?.setAttribute("aria-selected", on ? "true" : "false");
      item.panel?.classList.toggle("is-active", on);
      if (item.panel) item.panel.hidden = !on;
    }
  }

  function isIdentifyCollapsed() {
    return !!sideIdentifyEl?.classList.contains("is-collapsed");
  }

  function syncIdentifyCollapseUi() {
    const collapsed = isIdentifyCollapsed();
    const tip = collapsed ? t("tipExpandIdentify") : t("tipCollapseIdentify");
    if (btnToggleIdentify) {
      btnToggleIdentify.title = tip;
      btnToggleIdentify.setAttribute("aria-label", tip);
      btnToggleIdentify.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    splitIdentifyEl?.classList.toggle("is-disabled", collapsed);
    splitIdentifyEl?.setAttribute("aria-disabled", collapsed ? "true" : "false");
  }

  function setIdentifyCollapsed(collapsed) {
    if (!sideIdentifyEl) return;
    const next = !!collapsed;
    const prev = isIdentifyCollapsed();
    sideIdentifyEl.classList.toggle("is-collapsed", next);
    if (!next && prev) {
      // Restoring expand: ensure a usable height.
      const cur = parseFloat(getComputedStyle(sideEl).getPropertyValue("--side-identify-h"));
      const head = identifyHeadH();
      if (!Number.isFinite(cur) || cur <= head + 8) {
        sideEl.style.setProperty("--side-identify-h", "160px");
      }
    }
    syncIdentifyCollapseUi();
    syncSideSplits();
  }

  function expandIdentifyPanel() {
    if (isIdentifyCollapsed()) setIdentifyCollapsed(false);
  }

  function mapCoordToLayerPixel(coord, cached) {
    if (!coord || !cached) return null;
    const w = cached.width;
    const h = cached.height;
    const extent = cached.rasterExtent || cached.viewConfig?.extent;
    if (!w || !h || !extent) return null;
    let layerCoord = coord;
    const viewProj = map?.getView()?.getProjection?.();
    const layerProj = cached.viewConfig?.projection;
    if (
      mapCrs &&
      viewProj &&
      layerProj &&
      viewProj !== layerProj
    ) {
      try {
        layerCoord = transformCoord(coord, viewProj, layerProj);
      } catch {
        /* keep */
      }
    }
    const sx = (extent[2] - extent[0]) / w;
    const sy = (extent[3] - extent[1]) / h;
    if (!sx || !sy) return null;
    const x = Math.floor((layerCoord[0] - extent[0]) / sx);
    const y = Math.floor((extent[3] - layerCoord[1]) / sy);
    return { x, y, w, h };
  }

  /** Cache geotiff.js readers by URL (native GeoTIFF / blob object URL). */
  const geoTiffReaderCache = new Map();

  async function openGeoTiffReader(url) {
    if (!url) throw new Error("missing geotiff url");
    let p = geoTiffReaderCache.get(url);
    if (!p) {
      p = geoTiffFromUrl(url).catch((err) => {
        geoTiffReaderCache.delete(url);
        throw err;
      });
      geoTiffReaderCache.set(url, p);
    }
    return p;
  }

  async function sampleGeoTiffPixel(url, x, y, nBands) {
    const tiff = await openGeoTiffReader(url);
    const image = await tiff.getImage();
    const iw = image.getWidth();
    const ih = image.getHeight();
    if (x < 0 || y < 0 || x >= iw || y >= ih) return null;
    const n = Math.max(1, Math.min(32, Number(nBands) || image.getSamplesPerPixel?.() || 1));
    const samples = Array.from({ length: n }, (_, i) => i);
    const data = await image.readRasters({
      window: [x, y, x + 1, y + 1],
      width: 1,
      height: 1,
      samples,
      interleave: false,
    });
    const bands = [];
    for (let b = 0; b < n; b++) {
      let v = NaN;
      if (Array.isArray(data)) {
        const plane = data[b];
        v = plane != null ? Number(plane[0]) : NaN;
      } else if (data && typeof data.length === "number") {
        v = Number(data[b] ?? data[0]);
      }
      bands.push({ index: b + 1, value: Number.isFinite(v) ? v : NaN });
    }
    return bands;
  }

  function layerSampleUrl(cached) {
    if (!cached) return "";
    if (cached.rasterUrl) return cached.rasterUrl;
    if (cached.objectUrls?.length) return cached.objectUrls[0];
    return "";
  }

  async function sampleLayerAt(coord, fileMeta, cached) {
    const id = fileMeta?.id || cached?.filePath || "";
    const name = fileMeta?.name || cached?.filePath || id || "—";
    const pix = mapCoordToLayerPixel(coord, cached);
    if (!pix) return { id, name, hit: false, reason: "noData", bands: [] };
    if (pix.x < 0 || pix.y < 0 || pix.x >= pix.w || pix.y >= pix.h) {
      return { id, name, hit: false, reason: "out", bands: [] };
    }

    if (cached?.bandPlanes?.length) {
      const i = pix.y * pix.w + pix.x;
      const bands = [];
      for (let b = 0; b < cached.bandPlanes.length; b++) {
        const plane = cached.bandPlanes[b];
        const v = plane && i >= 0 && i < plane.length ? plane[i] : NaN;
        bands.push({ index: b + 1, value: v });
      }
      return { id, name, hit: true, bands, pixel: pix };
    }

    // Native GeoTIFF (e.g. chla.tif): no in-memory planes — read one pixel via geotiff.js.
    const url = layerSampleUrl(cached);
    if (!url) return { id, name, hit: false, reason: "notLoaded", bands: [], pixel: pix };
    try {
      const nBands = cached.bandCount || cached.bandStats?.length || 1;
      const bands = await sampleGeoTiffPixel(url, pix.x, pix.y, nBands);
      if (!bands?.length) return { id, name, hit: false, reason: "noData", bands: [], pixel: pix };
      return { id, name, hit: true, bands, pixel: pix };
    } catch (err) {
      console.warn("identify sample", name, err);
      return { id, name, hit: false, reason: "notLoaded", bands: [], pixel: pix };
    }
  }

  function identifyReasonText(reason) {
    if (reason === "out") return t("identifyOut");
    if (reason === "notLoaded") return t("identifyNotLoaded");
    return t("identifyNoData");
  }

  function renderIdentifyResults(results) {
    if (!identifyBodyEl || !identifyEmptyEl || !identifyTableWrap) return;
    // Hide layers whose click is outside extent (previous behavior).
    const list = (results || []).filter((r) => r.reason !== "out");
    if (!list.length) {
      identifyEmptyEl.hidden = false;
      identifyTableWrap.hidden = true;
      identifyBodyEl.innerHTML = "";
      return;
    }
    identifyEmptyEl.hidden = true;
    identifyTableWrap.hidden = false;
    const parts = [];
    for (const r of list) {
      const collapsed = identifyCollapsed.has(r.id);
      const caret = r.hit && r.bands?.length ? (collapsed ? "▶" : "▼") : "";
      const pixText =
        r.pixel && Number.isFinite(r.pixel.x) && Number.isFinite(r.pixel.y)
          ? `${r.pixel.x}, ${r.pixel.y}`
          : r.hit
            ? "—"
            : identifyReasonText(r.reason);
      parts.push(
        `<tr class="identify-group-row${collapsed ? " is-collapsed" : ""}${r.hit ? "" : " is-miss"}" data-layer-id="${escapeAttr(r.id)}" data-act="toggle">` +
          `<td><span class="identify-feat"><span class="identify-caret" aria-hidden="true">${caret || ""}</span><span class="identify-name" title="${escapeAttr(r.name)}">${escapeHtml(r.name)}</span></span></td>` +
          `<td class="identify-pix">${escapeHtml(pixText)}</td>` +
        `</tr>`,
      );
      if (r.hit && r.bands?.length && !collapsed) {
        for (const b of r.bands) {
          const feat = `${t("bandN")}${b.index}`;
          parts.push(
            `<tr class="identify-band-row" data-layer-id="${escapeAttr(r.id)}">` +
              `<td>${escapeHtml(feat)}</td>` +
              `<td>${escapeHtml(formatNum(b.value))}</td>` +
            `</tr>`,
          );
        }
      }
    }
    identifyBodyEl.innerHTML = parts.join("");
    identifyBodyEl.querySelectorAll(".identify-group-row").forEach((tr) => {
      tr.addEventListener("click", () => {
        const id = tr.getAttribute("data-layer-id");
        if (!id) return;
        const row = (lastIdentifyResults || []).find((r) => r.id === id);
        if (!row?.hit || !row.bands?.length) return;
        if (identifyCollapsed.has(id)) identifyCollapsed.delete(id);
        else identifyCollapsed.add(id);
        renderIdentifyResults(lastIdentifyResults);
      });
    });
  }

  async function identifyAtCoordinate(coord) {
    const results = await Promise.all(
      fileList.map((f) => sampleLayerAt(coord, f, fileCache.get(f.id))),
    );
    lastIdentifyResults = results;
    renderIdentifyResults(results);
    expandIdentifyPanel();

    // Update status coords for active layer when unlocked
    if (!hoverLocked) {
      const pix = mapToPixel(coord);
      if (pix && pix.x >= 0 && pix.y >= 0 && pix.x < width && pix.y < height) {
        showHover(null, pix.x, pix.y, pix);
      } else {
        showHoverOutside(pix);
      }
    }
  }

  function wireMapEvents() {
    if (!map || map.__rasterEventsWired) return;
    map.__rasterEventsWired = true;
    map.on("pointermove", (evt) => {
      if (hoverLocked) return;
      if (evt.dragging) return;
      const coord = evt.coordinate;
      if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return;
      // No active raster (cleared layers / not ready): still show map-CRS coords.
      if (!ready || !width || !height || !rasterExtent) {
        showMapGeo(coord[0], coord[1]);
        return;
      }
      const pix = mapToPixel(coord);
      if (!pix || pix.x < 0 || pix.y < 0 || pix.x >= width || pix.y >= height) {
        showHoverOutside(pix || { mapX: coord[0], mapY: coord[1] });
        return;
      }
      showHover(evt, pix.x, pix.y, pix);
    });
    // Keep last coordinates when the pointer leaves the map viewport.
    map.on("moveend", updateZoomBadge);
    map.on("singleclick", (evt) => {
      if (!ready) return;
      void identifyAtCoordinate(evt.coordinate);
    });
    map.getViewport().addEventListener("dblclick", (e) => {
    e.preventDefault();
      toggleHoverLock();
    });
  }


  function dropGeoTiffReader(url) {
    if (url) geoTiffReaderCache.delete(url);
  }

  function revokeCachedLayerUrls(cached) {
    if (!cached) return;
    for (const u of cached.objectUrls || []) dropGeoTiffReader(u);
    if (cached.rasterUrl) dropGeoTiffReader(cached.rasterUrl);
    if (cached.objectUrls?.length) revokeLayerUrls(cached.objectUrls);
  }

  function normalizeMapCrsCode(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    return s.toUpperCase().startsWith("EPSG:") ? s.toUpperCase() : `EPSG:${s}`;
  }

  function showMapCrsSelectMode() {
    if (mapCrsSelect) {
      mapCrsSelect.classList.remove("hidden");
      mapCrsSelect.hidden = false;
    }
    if (mapCrsCustom) {
      mapCrsCustom.classList.add("hidden");
      mapCrsCustom.hidden = true;
    }
  }

  function showMapCrsCustomMode(prefill, { focus = true } = {}) {
    if (mapCrsSelect) {
      mapCrsSelect.classList.add("hidden");
      mapCrsSelect.hidden = true;
    }
    if (mapCrsCustom) {
      mapCrsCustom.classList.remove("hidden");
      mapCrsCustom.hidden = false;
      if (prefill != null) {
        mapCrsCustom.value = String(prefill).replace(/^EPSG:/i, "");
      }
    }
    if (focus) {
      // defer focus so select change finishes first
      requestAnimationFrame(() => {
        mapCrsCustom?.focus();
        mapCrsCustom?.select?.();
      });
    }
  }

  function resolvedMapCrs() {
    if (mapCrsCustom && !mapCrsCustom.hidden) {
      return normalizeMapCrsCode(mapCrsCustom.value) || mapCrs || "EPSG:3857";
    }
    if (!mapCrsSelect) return "EPSG:3857";
    if (mapCrsSelect.value === "custom") {
      return normalizeMapCrsCode(mapCrsCustom?.value) || mapCrs || "EPSG:3857";
    }
    return mapCrsSelect.value || "EPSG:3857";
  }

    /**
   * GeoTIFF GeoKeys for in-memory blobs:
   * - geotiff with its own EPSG → keep file CRS (map reprojects)
   * - otherwise → current map CRS (assigned / no CRS)
   */
  function blobCrsForGeo(fileGeo) {
    if (fileGeo?.source === "geotiff") {
      const fileEpsg = normalizeEpsg(fileGeo.crs);
      if (fileEpsg) return `EPSG:${fileEpsg}`;
    }
    const mapEpsg = normalizeEpsg(mapCrs);
    return mapEpsg ? `EPSG:${mapEpsg}` : mapCrs || "EPSG:3857";
  }

  function syncMapCrsUi() {
    if (!mapCrsSelect) return;
    if (KNOWN_MAP_CRS.includes(mapCrs)) {
      mapCrsSelect.value = mapCrs;
      showMapCrsSelectMode();
    } else if (mapCrs) {
      mapCrsSelect.value = "custom";
      showMapCrsCustomMode(mapCrs, { focus: false });
    } else {
      mapCrs = "EPSG:3857";
      mapCrsSelect.value = "EPSG:3857";
      showMapCrsSelectMode();
    }
  }

  async function rebuildLayerForFile(id) {
    const cached = fileCache.get(id);
    if (!cached?.bandPlanes?.length && !cached?.rasterUrl) return;
    const style = cached.styleState || (id === activeFileId ? collectStyleState() : null) || {
      mode: "gray",
      grayBand: 0,
      grayMin: 0,
      grayMax: 255,
      grayContrast: "none",
      grayRamp: "blackwhite",
      colormap: cached.colormap || {},
    };
    const nBands = Math.max(1, cached.bandCount || cached.bandPlanes?.length || 1);
    const srcArgs = buildLayerSourceArgs(
      cached.bandPlanes,
      cached.width,
      cached.height,
      cached.geo,
      cached.rasterUrl,
      cached.overviewUrls,
      { nearest: pyramidUseNearest(style.mode || "gray", cached.bandPlanes) },
    );
    if (!srcArgs.blob && !srcArgs.url) return;

    const zIndex = cached.layer?.getZIndex?.() ?? 0;
    revokeCachedLayerUrls(cached);
    if (cached.layer && map) map.removeLayer(cached.layer);
    const bounds = layerSourceBounds(
      nBands,
      cached.bandPlanes,
      cached.bandStats,
      style.mode || "gray",
    );
    const created = await createLayerFromArgs(srcArgs, {
      width: cached.width,
      height: cached.height,
      geo: cached.geo,
      style: buildWebGlStyle(style),
      bandCount: nBands,
      zIndex,
      mins: bounds?.mins,
      maxs: bounds?.maxs,
      interpolate: styleInterpolate(style),
    });
    if (map) map.addLayer(created.layer);
    cached.layer = created.layer;
    cached.source = created.source;
    cached.objectUrls = created.objectUrls || [];
    cached.overviewCount = srcArgs.overviewCount;
    cached.layerKind = srcArgs.kind;
    cached.viewConfig = created.viewConfig;
    cached.rasterExtent = created.viewConfig?.extent || extentFromGeo(cached.width, cached.height, cached.geo);
    cached.nativeViewConfig = created.viewConfig;
    cached.styleState = styleStateWithAlpha(style, created.layer, nBands);
    applyStyle(created.layer, cached.styleState);
    if (cached.visible === false || layerVisibility.get(id) === false) {
      applyOlLayerVisibility(created.layer, false, cached.styleState);
    } else {
      applyOlLayerVisibility(created.layer, true, cached.styleState);
    }
    if (id === activeFileId) {
      tileLayer = cached.layer;
      viewConfig = cached.viewConfig;
      rasterExtent = cached.rasterExtent;
    }
    refreshAllCachedLayerStyles();
  }

  async function applyMapCrsChange(nextCrs) {
    const prev = mapCrs;
    mapCrs = nextCrs || "EPSG:3857";
    try {
      if (!ensureProjection(mapCrs)) {
        throw new Error(`未支持的坐标系 ${mapCrs}`);
      }
    } catch (err) {
      mapCrs = prev;
      syncMapCrsUi();
      metaEl.textContent = String(err?.message || err);
      return;
    }
    syncMapCrsUi();
    // Map CRS switch:
    // - with file CRS → keep layer; OpenLayers reprojects into the new map CRS
    // - no CRS → retag as the new map CRS (same affine numbers, no reprojection) and rebuild
    for (const id of [...fileCache.keys()]) {
      try {
        const cached = fileCache.get(id);
        if (!cached || fileHasOwnCrs(cached.geo)) continue;
        cached.geo = { ...cached.geo, crs: mapCrs };
        if (id === activeFileId) geo = cached.geo;
        await rebuildLayerForFile(id);
      } catch (err) {
        console.error("rebuild layer", id, err);
      }
    }
    syncLayerOrder();
    if (!map) return;
    const active = fileCache.get(activeFileId);
    const native = active?.nativeViewConfig || active?.viewConfig || viewConfig;
    try {
      applyMapViewCrs(map, mapCrs, native);
    } catch (err) {
      console.error(err);
      metaEl.textContent = String(err?.message || err);
    }
    if (active) {
      viewConfig = active.viewConfig;
      rasterExtent = active.rasterExtent;
      tileLayer = active.layer;
    }
    // WebGLTile leaves a black L-gutter if size isn't refreshed after setView.
    map.updateSize();
    requestAnimationFrame(() => {
      map?.updateSize();
      fitToView();
      map?.updateSize();
    });
    updateMeta();
  }

  async function applyAffineChange() {
    const raw = String(affineInput?.value || "").trim();
    const gt = parseAffineLine(raw);
    if (!gt) {
      metaEl.textContent = "仿射系数无效，请输入 6 个逗号分隔的数字";
      fillAffineInputs(currentAffine());
      setAffineEditMode(false);
      return;
    }
    const nextText = formatAffineLine(gt);
    if (nextText === lastAppliedAffineText) {
      if (affineInput) affineInput.value = nextText;
      if (affineText) affineText.textContent = nextText;
      setAffineEditMode(false);
      return;
    }
    const crs = currentCrs();
    const src = geo?.source === "geotiff" ? "geotiff" : geo?.source === "worldfile" ? "worldfile" : "user";
    geo = geoFromTransform(gt, crs, src);
    payload.geo = geo;
    if (activeFileId && fileCache.has(activeFileId)) {
      const cached = fileCache.get(activeFileId);
      cached.geo = geo;
    }
    try {
      if (activeFileId) await rebuildLayerForFile(activeFileId);
      const active = fileCache.get(activeFileId);
      if (map && active) {
        viewConfig = active.viewConfig;
        rasterExtent = active.rasterExtent;
        tileLayer = active.layer;
        try {
          applyMapViewCrs(map, mapCrs, active.nativeViewConfig || active.viewConfig);
        } catch (err) {
          console.error(err);
        }
        fitToView();
      }
      lastAppliedAffineText = nextText;
      if (affineInput) affineInput.value = nextText;
      if (affineText) affineText.textContent = nextText;
      setAffineEditMode(false);
      updateMeta();
      if (metaEl) metaEl.textContent = "";
    } catch (err) {
      metaEl.textContent = String(err?.message || err);
      console.error(err);
      setAffineEditMode(false);
    }
  }

  async function ensureMap() {
    if (!mapEl || !width || !height || !activeFileId) return;
    // Snapshot before any await — UI may switch active file while GeoTIFF loads,
    // which used to register the new layer under the wrong fileCache key (mask→JPG).
    const fileId = activeFileId;
    const snapPlanes = bandPlanes;
    const snapStats = bandStats;
    const snapW = width;
    const snapH = height;
    const snapGeo = geo;
    const snapUrl = rasterUrl;
    const snapKind = payload.kind;
    const snapDtype = payload.dtype;
    const snapDefaultRender = payload.defaultRender;
    const snapFormat = payload.format;
    const snapProbe = payload.probeLabel;
    const snapPath = payload.filePath;
    const snapColormap = { ...colormap };
    const snapColorTable = serializeColorTable(colorTable);
    const snapMode = renderMode;
    const styleState = collectStyleState();
    const style = buildWebGlStyle(styleState);
    let nBands = Math.max(1, snapPlanes.length || Number(payload.bands) || 1);
    const overviewUrls = Array.isArray(payload.overviewUrls) ? payload.overviewUrls : [];
    const srcArgs = buildLayerSourceArgs(
      snapPlanes,
      snapW,
      snapH,
      snapGeo,
      snapUrl,
      overviewUrls,
      { nearest: pyramidUseNearest(snapMode, snapPlanes) },
    );
    if (snapPlanes.length) nBands = snapPlanes.length;
    if (!srcArgs.blob && !srcArgs.url) throw new Error(t("missingData"));
    if (srcArgs.blob && snapPlanes[0] && snapPlanes[0].length !== snapW * snapH) {
      throw new Error(
        `栅格数据与尺寸不匹配: ${snapPlanes[0].length} ≠ ${snapW}×${snapH}`,
      );
    }

    const zIndex = Math.max(0, fileList.length - fileList.findIndex((f) => f.id === fileId));
    const existing = fileCache.get(fileId);
    const srcBounds = layerSourceBounds(nBands, snapPlanes, snapStats, snapMode);
    const prevLock = existing?.styleState?.mode === "paletted";
    const nextLock = snapMode === "paletted";
    const prevResample = existing?.styleState?.resample || "nearest";
    const nextResample = styleState.resample || "nearest";
    const sourceChanged =
      !existing?.layer ||
      existing.bandPlanes !== snapPlanes ||
      existing.bandCount !== nBands ||
      existing.width !== snapW ||
      existing.height !== snapH ||
      existing.rasterUrl !== snapUrl ||
      prevLock !== nextLock ||
      prevResample !== nextResample;

    if (existing?.layer && map && !sourceChanged) {
      const nextStyle = styleState;
      const prevJson = JSON.stringify(existing.styleState || null);
      const nextJson = JSON.stringify(nextStyle);
      if (prevJson !== nextJson) {
        applyStyle(existing.layer, nextStyle);
      }
      existing.bandStats = snapStats;
      existing.geo = snapGeo;
      existing.overviewUrls = overviewUrls;
      existing.probeLabel = snapProbe;
      existing.styleState = nextStyle;
      existing.format = snapFormat;
      existing.kind = snapKind;
      existing.defaultRender = snapDefaultRender;
      if (activeFileId === fileId) {
        tileLayer = existing.layer;
        viewConfig = existing.viewConfig;
        rasterExtent = existing.rasterExtent || viewConfig?.extent;
      }
      mapReady = true;
      syncLayerOrder();
      refreshAllCachedLayerStyles();
      return;
    }

    const prevVisible = isLayerVisible(fileId);
    const prevZ = existing?.layer?.getZIndex?.() ?? zIndex;
    revokeCachedLayerUrls(existing);
    if (existing?.layer && map) map.removeLayer(existing.layer);

    const created = await createLayerFromArgs(srcArgs, {
      width: snapW,
      height: snapH,
      geo: snapGeo,
      style,
      bandCount: nBands,
      zIndex: prevZ,
      mins: srcBounds?.mins,
      maxs: srcBounds?.maxs,
      interpolate: styleInterpolate(styleState),
    });
    applyOlLayerVisibility(created.layer, prevVisible, styleState);

    // Re-apply style with nodata alpha once source.bandCount is known.
    const styled = styleStateWithAlpha(styleState, created.layer, nBands);
    applyStyle(created.layer, styled);

    if (!map) {
      map = createEmptyMap(mapEl, created.viewConfig);
      wireMapEvents();
      try {
        // Always keep / use the current map CRS. Layers with their own CRS reproject
        // into it; layers without CRS were already assigned mapCrs.
        if (!ensureProjection(mapCrs)) {
          mapCrs = "EPSG:3857";
          ensureProjection(mapCrs);
          syncMapCrsUi();
        }
        applyMapViewCrs(map, mapCrs, created.viewConfig);
      } catch (err) {
        console.error(err);
      }
    } else if (created.viewConfig && fileCache.size === 0) {
      try {
        applyMapViewCrs(map, mapCrs, created.viewConfig);
      } catch (err) {
        console.error(err);
      }
    }

    map.addLayer(created.layer);
    const layerExtent = created.viewConfig?.extent || extentFromGeo(snapW, snapH, snapGeo);
    mapReady = true;

    fileCache.set(fileId, {
      layer: created.layer,
      source: created.source,
      objectUrls: created.objectUrls || [],
      overviewCount: srcArgs.overviewCount,
      overviewUrls,
      layerKind: srcArgs.kind,
      viewConfig: created.viewConfig,
      nativeViewConfig: created.viewConfig,
      rasterExtent: layerExtent,
      bandPlanes: snapPlanes,
      bandStats: snapStats,
      bandCount: nBands,
      width: snapW,
      height: snapH,
      geo: snapGeo,
      rasterUrl: snapUrl,
      probeLabel: snapProbe,
      kind: snapKind,
      dtype: snapDtype,
      defaultRender: snapDefaultRender,
      filePath: snapPath,
      format: snapFormat,
      colormap: snapColormap,
      colorTable: snapColorTable,
      styleState: styled,
      visible: prevVisible,
    });
    layerVisibility.set(fileId, prevVisible);
    if (activeFileId === fileId) {
      tileLayer = created.layer;
      viewConfig = created.viewConfig;
      rasterExtent = layerExtent;
    }
    syncLayerOrder();
    refreshAllCachedLayerStyles();
    map.updateSize();
  }

  function formatNum(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  /** Latest per-band pixel values under cursor (active layer). */
  let lastHoverBandValues = null;
  /** Last identify sample across all layers. */
  let lastIdentifyResults = null;

  function showMapGeo(mx, my) {
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
    lastHoverBandValues = null;
    hoverEl.textContent = `${t("statusGeo")} ${formatGeoCoord(mx)}, ${formatGeoCoord(my)}`;
    hoverEl.classList.add("is-active");
  }

  function showHover(_e, x, y, pix) {
    const i = y * width + x;
    lastHoverBandValues = [];
    if (bandPlanes.length) {
      for (let b = 0; b < bandPlanes.length; b++) {
        lastHoverBandValues.push(bandValue(b, i));
      }
    }
    // Always show map-CRS coordinates (same as outside the raster).
    // pixelToGeo() is file CRS and disagrees with the map when reprojecting.
    showMapGeo(pix?.mapX, pix?.mapY);
  }

  /** Outside raster extent: geographic coords only. */
  function showHoverOutside(pix) {
    if (!pix || !Number.isFinite(pix.mapX) || !Number.isFinite(pix.mapY)) {
      // Keep last displayed coords (do not clear on invalid sample).
      return;
    }
    showMapGeo(pix.mapX, pix.mapY);
  }

  /** Reset coords (empty view). Not used on mouse leave or after clear — pointermove refills. */
  function hideHover() {
    if (hoverLocked) return;
    hoverEl.textContent = "—";
    hoverEl.classList.remove("is-active");
  }

  function clearLayers({ all = false } = {}) {
    if (!fileList.length) return;
    if (all) {
      for (const id of fileList.map((f) => f.id)) {
        removeFileLayer(id);
        fileUiState.delete(id);
        fileCache.delete(id);
      }
      fileList = [];
      activeFileId = null;
      selectedFileIds.clear();
      selectionAnchorId = null;
      bandPlanes = [];
      bandStats = [];
      ready = false;
      started = false;
      tileLayer = null;
      viewConfig = null;
      rasterExtent = null;
      width = 0;
      height = 0;
      renderFileList();
      resetStyleUiForEmptyView();
      updateMeta();
      // Keep last geo readout; pointermove continues via map with no layers.
      lastHoverBandValues = null;
      vscodeApi?.postMessage({ type: "clearAllFiles" });
      return;
    }
    const ids = selectedIdsOrdered();
    const targets = ids.length ? ids : activeFileId ? [activeFileId] : [];
    if (!targets.length) return;
    const removingActive = targets.includes(activeFileId);
    if (removingActive) snapshotUiState();
    for (const id of targets) {
      removeFileLayer(id);
      fileUiState.delete(id);
      fileCache.delete(id);
      vscodeApi?.postMessage({ type: "removeFile", id });
    }
    // fileList is updated by host via fileList message; optimistically drop locally
    fileList = fileList.filter((f) => !targets.includes(f.id));
    if (removingActive) {
      activeFileId = fileList[0]?.id || null;
      if (activeFileId) {
        selectOnly(activeFileId);
        void activateFile(activeFileId, { fit: false, requestIfMissing: true, keepSelection: true });
      } else {
        bandPlanes = [];
        bandStats = [];
        ready = false;
        tileLayer = null;
        width = 0;
        height = 0;
        rasterExtent = null;
        viewConfig = null;
        renderFileList();
        resetStyleUiForEmptyView();
        updateMeta();
      }
    } else {
      renderFileList();
    }
  }

  hideHover();
  btnToggleVisibility?.addEventListener("click", (e) => {
    toggleSelectedVisibility({ all: !!(e.shiftKey || e.altKey) });
  });
  btnClearLayers?.addEventListener("click", (e) => {
    clearLayers({ all: !!(e.shiftKey || e.altKey) });
  });

  function hexToRgb(hex) {
    const m = String(hex || "")
      .trim()
      .match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((x) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function defaultHashColor(id) {
    const hue = (Math.abs(Math.trunc(id)) * 47) % 360;
    return hslToRgb(hue / 360, 0.7, 0.5);
  }

  function randomColor(seed) {
    let x = Math.abs(Math.trunc(seed) * 1103515245 + 12345) >>> 0;
    const r = (x & 255);
    x = (x * 1103515245 + 12345) >>> 0;
    const g = (x & 255);
    x = (x * 1103515245 + 12345) >>> 0;
    const b = 80 + (x % 176);
    return [r, g, b];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = (t0) => {
      let t = t0;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [
      Math.round(hk(h + 1 / 3) * 255),
      Math.round(hk(h) * 255),
      Math.round(hk(h - 1 / 3) * 255),
    ];
  }

  function syncColorTableLegacy() {
    // PLTE export only: array index → hex (rows do not store id).
    colormap = legacyMapFromColorTable(colorTable);
    labels = {};
  }

  function colorForClass(id) {
    const row = colorTable[Number(id)];
    if (row?.color) {
      const rgb = hexToRgb(row.color);
      if (rgb) return rgb;
    }
    const hex = colormap[id] ?? colormap[String(id)];
    if (hex) {
      const rgb = hexToRgb(hex);
      if (rgb) return rgb;
    }
    return defaultHashColor(id);
  }

  function colorForNewClass(id) {
    const ramp = paletteRampEl.value || "random";
    const n = Math.max(1, colorTable.length || 1);
    const idxs = Array.from({ length: n }, (_, i) => i);
    if (!idxs.includes(Number(id))) idxs.push(Number(id));
    idxs.sort((a, b) => a - b);
    const map = colorsForClasses(idxs, ramp, { invert: false, seed: randomSeed });
    return map[Number(id)] || map[id] || "#808080";
  }

  /** One-shot: reverse current class colors (no persistent invert state). */
  function invertColormapColors() {
    if (colorTable.length < 2) return;
    const colors = colorTable.map((e) => e.color || "#808080");
    colors.reverse();
    colorTable = colorTable.map((e, i) => ({ ...e, color: colors[i] }));
    syncColorTableLegacy();
    renderCmapTable();
    render();
  }

  function moveColorTableRow(fromIdx, toIdx) {
    const from = Number(fromIdx);
    const to = Number(toIdx);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (from < 0 || from >= colorTable.length || to < 0 || to >= colorTable.length) return;
    if (from === to) return;
    const [row] = colorTable.splice(from, 1);
    colorTable.splice(to, 0, row);
    if (selectedValue === from) selectedValue = to;
    else if (selectedValue != null) {
      const s = Number(selectedValue);
      if (from < s && to >= s) selectedValue = s - 1;
      else if (from > s && to <= s) selectedValue = s + 1;
    }
    // Move DOM row in place; ID column is rewritten to positional 0…N (values themselves unchanged).
    if (cmapBody) {
      const rows = [...cmapBody.querySelectorAll(".cmap-row")];
      const tr = rows[from];
      const ref = rows[to];
      if (tr && ref) {
        if (from < to) ref.after(tr);
        else ref.before(tr);
        syncCmapRowIndices();
        syncCmapSelection();
      } else {
        renderCmapTable();
      }
    }
    syncColorTableLegacy();
    render();
  }

  function syncPaletteOpacityLabel() {
    if (!paletteOpacityValEl) return;
    const v = Math.max(0, Math.min(100, Number(paletteOpacityEl?.value) || 0));
    paletteOpacityValEl.textContent = `${v}%`;
    if (paletteOpacityEl) paletteOpacityEl.style.setProperty("--range-pct", `${v}%`);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("failed to load image"));
      img.src = src;
    });
  }

  function b64ToU8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function b64ToAligned(b64) {
    const u8 = b64ToU8(b64);
    const copy = new ArrayBuffer(u8.byteLength);
    new Uint8Array(copy).set(u8);
    return copy;
  }

  function decodeIndices(b64, format, expectedLen) {
    const buf = b64ToAligned(b64);
    if (format === "i32") {
      const i32 = new Int32Array(buf);
      if (expectedLen && i32.length !== expectedLen) {
        throw new Error(`像素数据长度异常 (i32 ${i32.length}≠${expectedLen})`);
      }
      return Float64Array.from(i32);
    }
    if (format === "f64") {
      const f64 = new Float64Array(buf);
      if (expectedLen && f64.length !== expectedLen) {
        throw new Error(`像素数据长度异常 (f64 ${f64.length}≠${expectedLen})`);
      }
      return f64;
    }
    const u8 = new Uint8Array(buf);
    if (expectedLen && u8.length !== expectedLen) {
      throw new Error(`像素数据长度异常 (u8 ${u8.length}≠${expectedLen})`);
    }
    return Float64Array.from(u8);
  }

  /** Encode a band plane for host-side PLTE export (i32 when safe, else f64). */
  function encodePlaneBase64(plane) {
    if (!plane?.length) return null;
    let useI32 = true;
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < -2147483648 ||
        v > 2147483647
      ) {
        useI32 = false;
        break;
      }
    }
    let bytes;
    let format;
    if (useI32) {
      const i32 = new Int32Array(plane.length);
      for (let i = 0; i < plane.length; i++) i32[i] = plane[i];
      bytes = new Uint8Array(i32.buffer, i32.byteOffset, i32.byteLength);
      format = "i32";
    } else {
      const f64 =
        plane instanceof Float64Array && plane.byteOffset === 0
          ? plane
          : Float64Array.from(plane);
      bytes = new Uint8Array(f64.buffer, f64.byteOffset, f64.byteLength);
      format = "f64";
    }
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunk, bytes.length)),
      );
    }
    return { base64: btoa(binary), format };
  }

  /** Band used for color-table / PLTE export. */
  function plteExportBandIndex() {
    if (renderMode === "paletted") return paletteBandIndex();
    if (renderMode === "gray") return Number(grayBandEl?.value) || 0;
    return 0;
  }

  let bandPlanes = [];
  let bandStats = [];
  let width = 0;
  let height = 0;
  let counts = new Map();
  let ready = false;
  let started = false;
  let bandCount = Math.max(1, Number(payload.bands) || 1);

  function bandValue(bandIndex, i) {
    if (bandIndex < 0 || bandIndex >= bandPlanes.length) return NaN;
    return bandPlanes[bandIndex][i];
  }

  function channelValue(selectEl, i) {
    const v = selectEl.value;
    if (v === "" || v === "unset") return NaN;
    return bandValue(Number(v), i);
  }

  function paletteBandIndex() {
    return Number(paletteBandEl.value) || 0;
  }

  function computeStats(plane) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 255;
    }
    return { min, max };
  }

  function collectUniqueValues() {
    counts = new Map();
    const plane = bandPlanes[paletteBandIndex()];
    if (!plane) return [];
    for (let i = 0; i < plane.length; i++) {
      const id = Math.trunc(plane[i]);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.keys()].sort((a, b) => a - b);
  }

  function ensureLabelsForIds(_ids) {
    /* ranges carry their own labels */
  }

  /** Auto-build color table when switching to color-table mode. */
  function syncColormapToRaster() {
    if (renderMode !== "paletted") return;
    if (colorTable.length) return;
    classifyFromData(true);
  }

  function classifyFromData(forceRecolor = true) {
    const bi = Number(paletteBandEl?.value) || 0;
    const plane = bandPlanes[bi];
    const stats = bandStats[bi];
    const { min, max } = resolveBandMinMax(stats, plane);
    const integerLike = isIntegerLikeBand(payload.dtype, stats, plane);
    const breaks = buildColorTableBreaks(min, max, integerLike);
    if (!breaks.length) {
      metaEl.textContent =
        lang === "zh" ? "无法根据波段最值生成颜色表" : "Cannot build color table from band range";
      return;
    }
    if (breaks.length > COLOR_TABLE_MAX) {
      metaEl.textContent = t("colorTableMax");
      return;
    }
    const ramp = paletteRampEl.value || "random";
    const idxs = breaks.map((_, i) => i);
    const assigned = colorsForClasses(idxs, ramp, { invert: false, seed: randomSeed });
    const prev = colorTable;
    colorTable = breaks.map((b, i) => {
      const old = prev[i];
      const color =
        !forceRecolor && old?.color
          ? old.color
          : assigned[i] || colorForNewClass(i);
      return { min: b.min, max: b.max, color };
    });
    syncColorTableLegacy();
    selectedValue = null;
    if (metaEl && /唯一值过多|Too many unique|无法根据|Cannot build|最多 256|limited to 256/i.test(metaEl.textContent || "")) {
      metaEl.textContent = "";
    }
    renderCmapTable();
    render();
  }

  function bumpRandomSeed() {
    randomSeed = (Date.now() ^ (randomSeed * 2654435761)) >>> 0 || 1;
  }

  function bandLabel(i) {
    return `${t("bandN")} ${i + 1}`;
  }

  function fillBandSelects() {
    const opts = [];
    for (let i = 0; i < bandCount; i++) {
      opts.push(`<option value="${i}">${bandLabel(i)}</option>`);
    }
    const optsHtml = opts.join("");
    const withUnset = `<option value="unset">${t("bandUnset")}</option>${optsHtml}`;
    const keep = (el, html, fallback) => {
      const prev = el.value;
      el.innerHTML = html;
      if ([...el.options].some((o) => o.value === prev)) el.value = prev;
      else el.value = fallback;
    };
    keep(grayBandEl, optsHtml, "0");
    keep(paletteBandEl, optsHtml, "0");
    keep(redBandEl, withUnset, bandCount >= 1 ? "0" : "unset");
    keep(greenBandEl, withUnset, bandCount >= 2 ? "1" : "unset");
    keep(blueBandEl, withUnset, bandCount >= 3 ? "2" : "unset");
  }

  function stretchOptsVisible(mode) {
    return mode === "percent" || mode === "stddev";
  }

  function syncStretchParamUi() {
    const gMode = grayContrastEl.value;
    const rMode = rgbContrastEl.value;
    if (grayStretchOpts) {
      grayStretchOpts.style.display = stretchOptsVisible(gMode) ? "" : "none";
      if (grayStretchLabel) {
        grayStretchLabel.setAttribute("data-i18n", gMode === "stddev" ? "stdDevN" : "percentCut");
        grayStretchLabel.textContent = t(gMode === "stddev" ? "stdDevN" : "percentCut");
      }
      if (grayStretchParam && gMode === "percent" && !grayStretchParam.dataset.touched) {
        grayStretchParam.value = "2";
      }
      if (grayStretchParam && gMode === "stddev" && !grayStretchParam.dataset.touchedStd) {
        grayStretchParam.value = "2";
      }
    }
    if (rgbStretchOpts) {
      rgbStretchOpts.style.display = stretchOptsVisible(rMode) ? "" : "none";
      if (rgbStretchLabel) {
        rgbStretchLabel.setAttribute("data-i18n", rMode === "stddev" ? "stdDevN" : "percentCut");
        rgbStretchLabel.textContent = t(rMode === "stddev" ? "stdDevN" : "percentCut");
      }
    }
  }

  function applyStretchToInputs(mode, plane, stats, minEl, maxEl, paramEl) {
    if (!minEl || !maxEl) return;
    // Native GeoTIFF often has host bandStats but no in-memory plane.
    if (!plane && !(stats && Number.isFinite(stats.min) && Number.isFinite(stats.max))) return;
    const m = mode || "none";
    const param = Number(paramEl?.value);
    const range = stretchRange(plane, stats, m, {
      percent: m === "percent" ? param : 2,
      stddev: m === "stddev" ? param : 2,
    });
    minEl.value = String(range.min);
    maxEl.value = String(range.max);
  }

  function setMinMaxInputsFromStats() {
    const gMode = grayContrastEl.value || "none";
    const bi = Number(grayBandEl.value) || 0;
    applyStretchToInputs(
      gMode,
      bandPlanes[bi],
      bandStats[bi],
      grayMinEl,
      grayMaxEl,
      grayStretchParam,
    );

    const rMode = rgbContrastEl.value || "none";
    applyStretchToInputs(
      rMode,
      bandPlanes[Number(redBandEl.value)],
      bandStats[Number(redBandEl.value)],
      redMinEl,
      redMaxEl,
      rgbStretchParam,
    );
    applyStretchToInputs(
      rMode,
      bandPlanes[Number(greenBandEl.value)],
      bandStats[Number(greenBandEl.value)],
      greenMinEl,
      greenMaxEl,
      rgbStretchParam,
    );
    applyStretchToInputs(
      rMode,
      bandPlanes[Number(blueBandEl.value)],
      bandStats[Number(blueBandEl.value)],
      blueMinEl,
      blueMaxEl,
      rgbStretchParam,
    );
    syncStretchParamUi();
  }

  function setPlanesFromRgba(rgba, w, h) {
    const n = w * h;
    const r = new Uint8Array(n);
    const g = new Uint8Array(n);
    const b = new Uint8Array(n);
    let rMin = 255;
    let rMax = 0;
    let gMin = 255;
    let gMax = 0;
    let bMin = 255;
    let bMax = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const rv = rgba[p];
      const gv = rgba[p + 1];
      const bv = rgba[p + 2];
      r[i] = rv;
      g[i] = gv;
      b[i] = bv;
      if (rv < rMin) rMin = rv;
      if (rv > rMax) rMax = rv;
      if (gv < gMin) gMin = gv;
      if (gv > gMax) gMax = gv;
      if (bv < bMin) bMin = bv;
      if (bv > bMax) bMax = bv;
    }
    bandPlanes = [r, g, b];
    bandCount = 3;
    bandStats = [
      { min: rMin, max: rMax <= rMin ? rMin + 1 : rMax },
      { min: gMin, max: gMax <= gMin ? gMin + 1 : gMax },
      { min: bMin, max: bMax <= bMin ? bMin + 1 : bMax },
    ];
  }

  function setPlanesFromMask(values) {
    bandPlanes = [values];
    bandCount = 1;
    bandStats = [computeStats(values)];
  }

  function sortedColormapIds() {
    return colorTable.map((_, i) => i);
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  /** ID is always positional 0…N-1; only rewrite data-idx / ID text after row moves. */
  function syncCmapRowIndices() {
    if (!cmapBody) return;
    cmapBody.querySelectorAll(".cmap-row").forEach((tr, i) => {
      tr.setAttribute("data-idx", String(i));
      tr.querySelectorAll("[data-idx]").forEach((el) => el.setAttribute("data-idx", String(i)));
      const idxTd = tr.querySelector(".cmap-idx");
      if (idxTd) idxTd.textContent = String(i);
    });
  }

  function syncCmapSelection() {
    if (!cmapBody) return;
    cmapBody.querySelectorAll(".cmap-row").forEach((tr, i) => {
      tr.classList.toggle("is-selected", selectedValue === i);
    });
  }

  function cmapRowHtml(e, i) {
    const hex = e.color || "#808080";
    const sel = selectedValue === i ? " is-selected" : "";
    return `<tr class="cmap-row${sel}" data-idx="${i}" draggable="true" title="${escapeAttr(t("tipCmapDrag"))}">
      <td class="cmap-idx" data-idx="${i}">${i}</td>
      <td><input type="number" class="cmap-min" data-idx="${i}" value="${escapeAttr(formatBreak(e.min))}" step="any" /></td>
      <td><input type="number" class="cmap-max" data-idx="${i}" value="${escapeAttr(formatBreak(e.max))}" step="any" /></td>
      <td class="cmap-color-cell"><button type="button" class="cmap-swatch" data-idx="${i}" style="background:${escapeAttr(hex)}" title="${escapeAttr(hex)}" aria-label="${escapeAttr(hex)}"></button></td>
    </tr>`;
  }

  let cmapDragFrom = null;
  let cmapUiBound = false;
  let cmapColorEditIdx = null;

  function closeCmapColorPop() {
    const pop = document.getElementById("cmapColorPop");
    if (!pop) return;
    pop.classList.add("hidden");
    pop.hidden = true;
    cmapColorEditIdx = null;
  }

  function openCmapColorPop(idx, anchorEl) {
    const pop = document.getElementById("cmapColorPop");
    const input = document.getElementById("cmapColorPopInput");
    const side = document.getElementById("side");
    if (!pop || !input || !colorTable[idx]) return;
    cmapColorEditIdx = idx;
    input.value = colorTable[idx].color || "#808080";
    pop.classList.remove("hidden");
    pop.hidden = false;

    // Anchor invisible host on the clicked swatch (no visible duplicate on the left).
    // Nudge left within the side panel so the native picker (opens rightward) stays visible.
    const sideRect = (side || document.body).getBoundingClientRect();
    const a = anchorEl.getBoundingClientRect();
    const pickerW = 240;
    const pad = 8;
    let left = a.left;
    let top = a.top + a.height / 2;
    if (sideRect.right - left < pickerW + pad) {
      left = Math.max(sideRect.left + pad, sideRect.right - pickerW - pad);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;

    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.focus();
    } catch {
      input.focus();
    }
  }

  function applyCmapColorFromPop() {
    const input = document.getElementById("cmapColorPopInput");
    if (!input || cmapColorEditIdx == null || !colorTable[cmapColorEditIdx]) return;
    const i = cmapColorEditIdx;
    const hex = input.value;
    colorTable[i] = { ...colorTable[i], color: hex };
    const sw = cmapBody?.querySelector(`.cmap-swatch[data-idx="${i}"]`);
    if (sw) {
      sw.style.background = hex;
      sw.title = hex;
      sw.setAttribute("aria-label", hex);
    }
    syncColorTableLegacy();
    render();
  }

  function ensureCmapUiBound() {
    if (!cmapBody || cmapUiBound) return;
    cmapUiBound = true;

    const popInput = document.getElementById("cmapColorPopInput");
    popInput?.addEventListener("input", () => applyCmapColorFromPop());
    popInput?.addEventListener("change", () => {
      applyCmapColorFromPop();
      closeCmapColorPop();
    });
    popInput?.addEventListener("blur", () => {
      // Native picker can blur briefly; delay close.
      setTimeout(() => {
        const pop = document.getElementById("cmapColorPop");
        if (pop && !pop.hidden && document.activeElement !== popInput) closeCmapColorPop();
      }, 150);
    });
    document.addEventListener(
      "pointerdown",
      (ev) => {
        const pop = document.getElementById("cmapColorPop");
        if (!pop || pop.hidden) return;
        if (pop.contains(ev.target) || ev.target.closest?.(".cmap-swatch")) return;
        closeCmapColorPop();
      },
      true,
    );

    cmapBody.addEventListener("click", (ev) => {
      const sw = ev.target.closest?.(".cmap-swatch");
      if (sw && cmapBody.contains(sw)) {
        ev.preventDefault();
        ev.stopPropagation();
        const i = Number(sw.getAttribute("data-idx"));
        if (Number.isFinite(i)) openCmapColorPop(i, sw);
        return;
      }
      const tr = ev.target.closest?.(".cmap-row");
      if (!tr || !cmapBody.contains(tr)) return;
      if (ev.target.closest("input,button")) return;
      selectedValue = Number(tr.getAttribute("data-idx"));
      syncCmapSelection();
    });

    cmapBody.addEventListener("dragstart", (ev) => {
      const tr = ev.target.closest?.(".cmap-row");
      if (!tr || !cmapBody.contains(tr)) return;
      if (ev.target.closest("input,button")) {
        ev.preventDefault();
        return;
      }
      cmapDragFrom = Number(tr.getAttribute("data-idx"));
      tr.classList.add("is-dragging");
      try {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", String(cmapDragFrom));
      } catch {
        /* ignore */
      }
    });

    cmapBody.addEventListener("dragend", (ev) => {
      const tr = ev.target.closest?.(".cmap-row");
      tr?.classList.remove("is-dragging");
      cmapBody.querySelectorAll(".cmap-row.drag-over").forEach((r) => r.classList.remove("drag-over"));
      cmapDragFrom = null;
    });

    cmapBody.addEventListener("dragover", (ev) => {
      const tr = ev.target.closest?.(".cmap-row");
      if (!tr || !cmapBody.contains(tr)) return;
      ev.preventDefault();
      try {
        ev.dataTransfer.dropEffect = "move";
      } catch {
        /* ignore */
      }
      tr.classList.add("drag-over");
    });

    cmapBody.addEventListener("dragleave", (ev) => {
      const tr = ev.target.closest?.(".cmap-row");
      if (!tr || !cmapBody.contains(tr)) return;
      if (tr.contains(ev.relatedTarget)) return;
      tr.classList.remove("drag-over");
    });

    cmapBody.addEventListener("drop", (ev) => {
      const tr = ev.target.closest?.(".cmap-row");
      if (!tr || !cmapBody.contains(tr)) return;
      ev.preventDefault();
      tr.classList.remove("drag-over");
      let from = cmapDragFrom;
      try {
        const raw = ev.dataTransfer.getData("text/plain");
        if (raw !== "" && Number.isFinite(Number(raw))) from = Number(raw);
      } catch {
        /* keep */
      }
      const to = Number(tr.getAttribute("data-idx"));
      moveColorTableRow(from, to);
    });

    const onBreakChange = (ev, key) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement)) return;
      const i = Number(el.getAttribute("data-idx"));
      const row = colorTable[i];
      if (!row) return;
      const v = Number(el.value);
      if (!Number.isFinite(v)) {
        el.value = formatBreak(row[key]);
        return;
      }
      const next = { ...row, [key]: v };
      if (!(next.max > next.min)) {
        el.value = formatBreak(row[key]);
        return;
      }
      if (colorTableRangeConflicts(colorTable, next.min, next.max, i)) {
        el.value = formatBreak(row[key]);
        metaEl.textContent = t("colorTableOverlap");
        return;
      }
      colorTable[i] = next;
      if (metaEl && metaEl.textContent === t("colorTableOverlap")) metaEl.textContent = "";
      syncColorTableLegacy();
      render();
    };
    cmapBody.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.classList.contains("cmap-min")) onBreakChange(ev, "min");
      else if (el.classList.contains("cmap-max")) onBreakChange(ev, "max");
    });
  }

  /** Full rebuild — classify / clear / invert / load. +/- and drag use incremental updates. */
  function renderCmapTable() {
    if (!cmapBody) return;
    ensureCmapUiBound();
    if (!colorTable.length) {
      cmapBody.innerHTML = "";
      return;
    }
    cmapBody.innerHTML = colorTable.map((e, i) => cmapRowHtml(e, i)).join("");
  }

  /** Like Excel: insert a row below the selection (append if none). */
  function insertColorTableRow() {
    if (colorTable.length >= COLOR_TABLE_MAX) {
      metaEl.textContent = t("colorTableMax");
      return;
    }
    ensureCmapUiBound();
    const sel =
      selectedValue != null &&
      Number.isFinite(Number(selectedValue)) &&
      selectedValue >= 0 &&
      selectedValue < colorTable.length
        ? Number(selectedValue)
        : colorTable.length - 1;
    const insertAt = sel < 0 ? 0 : sel + 1;
    const gap = suggestInsertRange(colorTable, insertAt);
    if (!gap || colorTableRangeConflicts(colorTable, gap.min, gap.max)) {
      metaEl.textContent = t("colorTableOverlap");
      return;
    }
    const entry = { min: gap.min, max: gap.max, color: colorForNewClass(insertAt) };
    colorTable.splice(insertAt, 0, entry);
    selectedValue = insertAt;
    if (metaEl && /相交|overlap/i.test(metaEl.textContent || "")) metaEl.textContent = "";

    const rows = cmapBody ? [...cmapBody.querySelectorAll(".cmap-row")] : [];
    if (cmapBody && rows.length === colorTable.length - 1) {
      const html = cmapRowHtml(entry, insertAt);
      if (insertAt <= 0 || !rows[insertAt - 1]) {
        cmapBody.insertAdjacentHTML("afterbegin", html);
      } else {
        rows[insertAt - 1].insertAdjacentHTML("afterend", html);
      }
      syncCmapRowIndices();
      syncCmapSelection();
    } else {
      renderCmapTable();
    }
    syncColorTableLegacy();
    render();
  }

  /** Like Excel: delete the selected row. */
  function removeSelectedColorTableRow() {
    if (!colorTable.length) return;
    if (
      selectedValue == null ||
      !Number.isFinite(Number(selectedValue)) ||
      selectedValue < 0 ||
      selectedValue >= colorTable.length
    ) {
      return;
    }
    const i = Number(selectedValue);
    colorTable.splice(i, 1);
    const rows = cmapBody ? [...cmapBody.querySelectorAll(".cmap-row")] : [];
    if (rows[i]) {
      rows[i].remove();
      syncCmapRowIndices();
    } else {
      renderCmapTable();
    }
    if (!colorTable.length) selectedValue = null;
    else if (i >= colorTable.length) selectedValue = colorTable.length - 1;
    else selectedValue = i; // stay on same position (now the next row)
    syncCmapSelection();
    syncColorTableLegacy();
    render();
  }

  async function rasterFromDataUrl(src) {
    const drawToCanvas = (source, w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(source, 0, 0);
      return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
    };

    if (typeof createImageBitmap === "function") {
      try {
        let blob;
        if (src.startsWith("data:")) {
          const res = await fetch(src);
          blob = await res.blob();
        } else {
          const res = await fetch(src);
          if (!res.ok) throw new Error("fetch failed");
          blob = await res.blob();
        }
        const bitmap = await createImageBitmap(blob);
        const w = bitmap.width;
        const h = bitmap.height;
        const out = drawToCanvas(bitmap, w, h);
        if (typeof bitmap.close === "function") bitmap.close();
        return out;
      } catch {
        /* fall back to Image() */
      }
    }

    const img = await loadImage(src);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return drawToCanvas(img, w, h);
  }

  async function init() {
    const gen = ++initGeneration;
    try {
      width = payload.width || width;
      height = payload.height || height;
      geo = applyLayerCrsPolicy(payload.geo || geo, width, height);
      payload.geo = geo;
      rasterUrl = payload.rasterUrl || rasterUrl;

      const wantRgb =
        payload.kind === "image" || Math.max(1, Number(payload.bands) || 1) >= 3;
      // Mask indices only for single-band masks — never reuse them for RGB/image files.
      if (
        payload.indexBase64 &&
        payload.width &&
        payload.height &&
        !wantRgb
      ) {
        width = payload.width;
        height = payload.height;
        setPlanesFromMask(
          decodeIndices(payload.indexBase64, payload.indexFormat || "i32", width * height),
        );
      } else if (payload._rgbaBase64 && payload.width && payload.height) {
        width = payload.width;
        height = payload.height;
        const buf = b64ToAligned(payload._rgbaBase64);
        const rgba = new Uint8ClampedArray(buf);
        if (rgba.length < width * height * 4) throw new Error("RGBA 数据长度异常");
        setPlanesFromRgba(rgba, width, height);
      } else if (payload._imageDataUrl || payload.maskDataUrl) {
        const src = payload._imageDataUrl || payload.maskDataUrl;
        const raster = await rasterFromDataUrl(src);
        if (gen !== initGeneration) return;
        width = raster.width;
        height = raster.height;
        if (wantRgb) {
          setPlanesFromRgba(raster.data, width, height);
        } else {
          const n = width * height;
          const plane = new Float64Array(n);
          const data = raster.data;
          for (let i = 0, p = 0; i < n; i++, p += 4) plane[i] = data[p];
          setPlanesFromMask(plane);
        }
      } else if (rasterUrl && payload.format && payload.format !== "tiff") {
        // PNG/JPEG/BMP → canvas decode → planes → GeoTIFF + WebGL style
        const raster = await rasterFromDataUrl(rasterUrl);
        if (gen !== initGeneration) return;
        width = raster.width;
        height = raster.height;
        if (wantRgb) {
          setPlanesFromRgba(raster.data, width, height);
      } else {
          const n = width * height;
          const plane = new Float64Array(n);
          const data = raster.data;
          for (let i = 0, p = 0; i < n; i++, p += 4) plane[i] = data[p];
          setPlanesFromMask(plane);
        }
      } else if (rasterUrl && payload.format === "tiff") {
        // Native GeoTIFF: still decode indices for classify/hover when available via maskData.
        if (!bandPlanes.length && payload.indexBase64) {
          setPlanesFromMask(
            decodeIndices(payload.indexBase64, payload.indexFormat || "i32", width * height),
          );
        }
      } else if (!bandPlanes.length) {
        throw new Error(t("missingData"));
      }

      if (gen !== initGeneration) return;
      if (!bandPlanes.length && !(payload.format === "tiff" && rasterUrl)) {
        throw new Error(t("missingData"));
      }

      if (!userRenderMode) {
        if (wantRgb) {
          renderMode = "rgb";
        } else if (bandPlanes.length) {
          renderMode = pickDefaultRender(bandCount, bandPlanes, bandStats);
        } else {
          renderMode = payload.defaultRender || "gray";
        }
      } else {
        renderMode = userRenderMode;
      }

      fillBandSelects();
      setMinMaxInputsFromStats();
      if (renderMode === "paletted") syncColormapToRaster();

      ready = true;
      applyRenderModeUi();
      applyI18n();
      if (renderMode === "paletted") renderCmapTable();
      setMinMaxInputsFromStats();
      ensureGrayStretchInputs();

      await ensureMap();
      if (gen !== initGeneration) return;
      // ensureMap already applied style on create / style-only refresh.
      // Calling render() → setStyle again flashes the whole WebGL canvas (explorer re-open).
      if (activeFileId) {
        const cached = fileCache.get(activeFileId);
        if (cached) cached.styleState = collectStyleState();
        snapshotUiState();
      }
      // Only auto-fit when this is the first map layer — refit on every add/reselect flashes.
      const layerCount = [...fileCache.values()].filter((c) => c.layer).length;
      if (layerCount <= 1) {
        requestAnimationFrame(() => fitToView());
      }
      started = true;
    } catch (err) {
      started = false;
      ready = false;
      mapReady = false;
      metaEl.textContent = String(err?.message || err);
      console.error(err);
    }
  }

  function render() {
    const cached = activeFileId ? fileCache.get(activeFileId) : null;
    const layer = cached?.layer;
    if (!layer) return;
    tileLayer = layer;
    ready = true;
    const st = collectStyleState();
    applyStyle(layer, st);
    if (cached) cached.styleState = st;
    // setStyle can blank sibling WebGL layers — re-apply all styles + visibility.
    refreshAllCachedLayerStyles();
    snapshotUiState();
  }

  function onRenderControlsChange() {
    render();
  }

  function onBandStatsBound(bandEl) {
    if (bandEl.value === "unset") return;
    const s = bandStats[Number(bandEl.value)];
    if (!s) return;
    if (bandEl === grayBandEl) {
      applyStretchToInputs(
        grayContrastEl.value || "none",
        bandPlanes[Number(bandEl.value)],
        s,
        grayMinEl,
        grayMaxEl,
        grayStretchParam,
      );
    } else if (bandEl === redBandEl) {
      applyStretchToInputs(rgbContrastEl.value || "none", bandPlanes[Number(bandEl.value)], s, redMinEl, redMaxEl, rgbStretchParam);
    } else if (bandEl === greenBandEl) {
      applyStretchToInputs(rgbContrastEl.value || "none", bandPlanes[Number(bandEl.value)], s, greenMinEl, greenMaxEl, rgbStretchParam);
    } else if (bandEl === blueBandEl) {
      applyStretchToInputs(rgbContrastEl.value || "none", bandPlanes[Number(bandEl.value)], s, blueMinEl, blueMaxEl, rgbStretchParam);
    }
  }

  resampleModeEl?.addEventListener("change", () => {
    if (!activeFileId) return;
    const st = collectStyleState();
    const cached = fileCache.get(activeFileId);
    if (cached) cached.styleState = st;
    snapshotUiState();
    // interpolate is a GeoTIFF source option — must rebuild the layer.
    void rebuildLayerForFile(activeFileId).then(() => {
      syncLayerOrder();
      map?.render?.();
    });
  });

  renderTypeEl.addEventListener("change", () => {
    userRenderMode = renderTypeEl.value;
    renderMode = userRenderMode;
    applyRenderModeUi();
    syncStretchParamUi();
    if (renderMode === "paletted") {
      if (!colorTable.length) classifyFromData(true);
      else renderCmapTable();
      updateMeta();
    }
    if (renderMode === "gray" || renderMode === "rgb") setMinMaxInputsFromStats();
    render();
  });

  grayBandEl.addEventListener("change", () => {
    onBandStatsBound(grayBandEl);
    onRenderControlsChange();
  });
  grayRampEl.addEventListener("change", onRenderControlsChange);
  grayContrastEl.addEventListener("change", () => {
    setMinMaxInputsFromStats();
    onRenderControlsChange();
  });
  grayStretchParam?.addEventListener("change", () => {
    grayStretchParam.dataset.touched = "1";
    if (grayContrastEl.value === "stddev") grayStretchParam.dataset.touchedStd = "1";
    setMinMaxInputsFromStats();
    onRenderControlsChange();
  });

  [redBandEl, greenBandEl, blueBandEl].forEach((el) => {
    el.addEventListener("change", () => {
      onBandStatsBound(el);
      onRenderControlsChange();
    });
  });

  /** Live-update only when both ends are valid; empty restore on blur. */
  function bindStretchPair(minEl, maxEl, defaultsFn) {
    const pairValid = () => {
      // Number("") === 0 — empty must not count as a typed value.
      const rawA = minEl?.value;
      const rawB = maxEl?.value;
      if (rawA === "" || rawB === "" || rawA == null || rawB == null) return false;
      const a = Number(rawA);
      const b = Number(rawB);
      return Number.isFinite(a) && Number.isFinite(b) && b > a;
    };
    const restoreIfNeeded = () => {
      const d = defaultsFn();
      const rawMin = minEl?.value;
      const rawMax = maxEl?.value;
      const min = Number(rawMin);
      const max = Number(rawMax);
      const minBad = rawMin === "" || rawMin == null || !Number.isFinite(min);
      const maxBad = rawMax === "" || rawMax == null || !Number.isFinite(max);
      if (minBad && minEl) minEl.value = String(d.min);
      if (maxBad && maxEl) maxEl.value = String(d.max);
      const a = Number(minEl?.value);
      const b = Number(maxEl?.value);
      if (!(Number.isFinite(a) && Number.isFinite(b) && b > a)) {
        if (minEl) minEl.value = String(d.min);
        if (maxEl) maxEl.value = String(d.max);
      }
    };
    const onInput = () => {
      if (!pairValid()) return;
      onRenderControlsChange();
    };
    const onBlur = () => {
      restoreIfNeeded();
      onRenderControlsChange();
    };
    minEl?.addEventListener("input", onInput);
    maxEl?.addEventListener("input", onInput);
    minEl?.addEventListener("blur", onBlur);
    maxEl?.addEventListener("blur", onBlur);
  }

  function stretchDefaultsForBand(bandSel) {
    const bi = bandSel === "unset" || bandSel === "" ? -1 : Number(bandSel);
    const s = bi >= 0 ? bandStats[bi] : null;
    if (s && Number.isFinite(s.min) && Number.isFinite(s.max)) {
      return { min: s.min, max: s.max <= s.min ? s.min + 1 : s.max };
    }
    return { min: 0, max: 255 };
  }

  bindStretchPair(grayMinEl, grayMaxEl, () => stretchDefaultsForBand(grayBandEl?.value));
  bindStretchPair(redMinEl, redMaxEl, () => stretchDefaultsForBand(redBandEl?.value));
  bindStretchPair(greenMinEl, greenMaxEl, () => stretchDefaultsForBand(greenBandEl?.value));
  bindStretchPair(blueMinEl, blueMaxEl, () => stretchDefaultsForBand(blueBandEl?.value));

  rgbContrastEl.addEventListener("change", () => {
    setMinMaxInputsFromStats();
    onRenderControlsChange();
  });
  rgbStretchParam?.addEventListener("change", () => {
    setMinMaxInputsFromStats();
    onRenderControlsChange();
  });

  paletteBandEl.addEventListener("change", () => {
    if (renderMode === "paletted") classifyFromData(true);
  });
  let paletteRampSnapshot = null;
  // Allow re-picking "Random colors" while already selected to reshuffle.
  paletteRampEl.addEventListener("mousedown", () => {
    paletteRampSnapshot = paletteRampEl.value;
    if ((paletteRampSnapshot || "random") === "random") {
      paletteRampEl.selectedIndex = -1;
    }
  });
  paletteRampEl.addEventListener("blur", () => {
    if (paletteRampEl.selectedIndex < 0 && paletteRampSnapshot != null) {
      paletteRampEl.value = paletteRampSnapshot;
    }
    paletteRampSnapshot = null;
  });
  paletteRampEl.addEventListener("change", () => {
    paletteRampSnapshot = null;
    syncStretchParamUi();
    if ((paletteRampEl.value || "random") === "random") bumpRandomSeed();
    if (renderMode === "paletted") classifyFromData(true);
  });
  btnRampInvertEl?.addEventListener("click", () => invertColormapColors());
  paletteOpacityEl?.addEventListener("input", () => {
    syncPaletteOpacityLabel();
    if (renderMode === "paletted") onRenderControlsChange();
  });
  paletteOpacityEl?.addEventListener("change", () => {
    syncPaletteOpacityLabel();
    if (renderMode === "paletted") onRenderControlsChange();
  });

  btnClassify.addEventListener("click", () => classifyFromData(true));
  btnAddRow.addEventListener("click", () => insertColorTableRow());
  btnRemoveRow.addEventListener("click", () => removeSelectedColorTableRow());
  btnClearRows.addEventListener("click", () => {
    colorTable = [];
    colormap = {};
    labels = {};
    selectedValue = null;
    renderCmapTable();
    render();
  });
  btnMore.addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => moreMenu.classList.add("hidden"));
  moreMenu.addEventListener("click", (e) => e.stopPropagation());

  btnSave.addEventListener("click", () => {
    moreMenu.classList.add("hidden");
    syncColorTableLegacy();
    vscodeApi?.postMessage({
      type: "saveColormap",
      colorTable: serializeColorTable(colorTable),
    });
  });
  btnReload.addEventListener("click", () => {
    moreMenu.classList.add("hidden");
    vscodeApi?.postMessage({ type: "reloadColormap" });
  });
  btnSavePlte.addEventListener("click", () => {
    moreMenu.classList.add("hidden");
    syncColorTableLegacy(); // PLTE slot = array index
    const exportBand = plteExportBandIndex();
    const plane = bandPlanes[exportBand];
    const packed = plane ? encodePlaneBase64(plane) : null;
    vscodeApi?.postMessage({
      type: "saveAsPlte",
      colorTable: serializeColorTable(colorTable),
      colormap,
      exportBand,
      width,
      height,
      indexBase64: packed?.base64 || payload.indexBase64,
      indexFormat: packed?.format || payload.indexFormat || "i32",
    });
  });

  applyRenderModeUi();
  syncPaletteOpacityLabel();
  renderFileList();

  const minSideTopH = 240; /* match --side-top-min: layers + info */
  const minSideTabsH = 300; /* match --side-tabs-min: style without inner scroll */
  const minSideIdentifyH = 120; /* match --side-identify-min */
  const minMapSectionH = 36; /* 地图 CRS 行 */
  const minStatusBarH = 28; /* 地理坐标行 */
  const identifyHeadH = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--side-identify-head")) ||
    36;

  function identifyOccupiedHeight() {
    if (isIdentifyCollapsed()) return identifyHeadH();
    const h =
      sideIdentifyEl?.getBoundingClientRect().height ||
      parseFloat(getComputedStyle(sideEl).getPropertyValue("--side-identify-h")) ||
      minSideIdentifyH;
    return Math.max(minSideIdentifyH, h);
  }

  function sideLayoutChrome() {
    // clientHeight shrinks when a vertical scrollbar appears — use the grid cell
    // (offsetParent / bounding rect of side) for layout math so mins stay stable.
    const viewH = sideEl?.clientHeight || sideEl?.getBoundingClientRect().height || 0;
    const mapSectionH =
      mapSectionEl?.getBoundingClientRect().height || minMapSectionH;
    const statusH =
      statusBarEl?.getBoundingClientRect().height || minStatusBarH;
    const splitInfoH = splitInfoEl?.getBoundingClientRect().height || 5;
    const splitIdH = splitIdentifyEl?.getBoundingClientRect().height || 5;
    const identifyH = identifyOccupiedHeight();
    const reserved = mapSectionH + statusH + splitInfoH + splitIdH + identifyH;
    const naturalUsable = Math.max(0, viewH - reserved);
    const minTopTabs = minSideTopH + minSideTabsH;
    // Viewport shorter than floors → .side scrolls; treat usable as the floor
    // so splitters stay enabled and sections are not crushed below mins.
    const needsScroll = naturalUsable < minTopTabs;
    const usableForTopTabs = needsScroll ? minTopTabs : naturalUsable;
    return {
      viewH,
      mapSectionH,
      statusH,
      splitInfoH,
      splitIdH,
      identifyH,
      usableForTopTabs,
      reserved,
      needsScroll,
      minTopTabs,
    };
  }

  function sideTopUsableBounds(minH = minSideTopH, maxFrac = 0.85) {
    const { usableForTopTabs, needsScroll } = sideLayoutChrome();
    const usableInView = usableForTopTabs;
    const minClamp = minH;
    if (needsScroll) {
      // Grow 图层 above its floor (adds scroll); 样式 keeps --side-tabs-min.
      const maxH = Math.max(
        minClamp + 48,
        Math.min(720, Math.floor((minSideTopH + minSideTabsH) * maxFrac)),
      );
      return {
        usableInView,
        minClamp,
        maxH,
        canResize: maxH > minClamp + 1,
        needsScroll: true,
      };
    }
    const roomForTabs = Math.max(0, usableInView - minSideTabsH);
    const maxH =
      usableInView >= minH + minSideTabsH
        ? Math.max(minClamp, Math.min(Math.floor(usableInView * maxFrac), roomForTabs))
        : minClamp;
    return {
      usableInView,
      minClamp,
      maxH,
      canResize: maxH > minClamp + 1,
      needsScroll: false,
    };
  }

  function identifyUsableBounds() {
    const { viewH, mapSectionH, statusH, splitInfoH, splitIdH, needsScroll } =
      sideLayoutChrome();
    const topH =
      sideTopEl?.getBoundingClientRect().height ||
      parseFloat(getComputedStyle(sideEl).getPropertyValue("--side-top-h")) ||
      minSideTopH;
    if (needsScroll) {
      const maxH = Math.max(
        minSideIdentifyH + 48,
        Math.min(480, Math.floor((minSideIdentifyH + minSideTabsH) * 0.7)),
      );
      return {
        usable: minSideIdentifyH + minSideTabsH,
        minClamp: minSideIdentifyH,
        maxH,
        canResize: maxH > minSideIdentifyH + 1,
        needsScroll: true,
      };
    }
    const usable = Math.max(
      0,
      viewH - mapSectionH - statusH - splitInfoH - splitIdH - topH,
    );
    // Leave at least min tabs; rest can go to identify.
    const maxH = Math.max(minSideIdentifyH, usable - minSideTabsH);
    return {
      usable,
      minClamp: minSideIdentifyH,
      maxH,
      canResize: maxH > minSideIdentifyH + 1,
      needsScroll: false,
    };
  }

  function sideTopRatio() {
    const r = Number(sideEl?.dataset.splitRatio);
    if (Number.isFinite(r) && r > 0.05 && r < 0.95) return r;
    return 0.5;
  }

  function identifyRatio() {
    const r = Number(sideEl?.dataset.identifyRatio);
    if (Number.isFinite(r) && r > 0.05 && r < 0.95) return r;
    return 0.35;
  }

  function syncSplitHandlesEnabled() {
    const topBounds = sideTopUsableBounds();
    splitInfoEl?.classList.toggle("is-disabled", !topBounds.canResize);
    splitInfoEl?.setAttribute("aria-disabled", topBounds.canResize ? "false" : "true");
    if (isIdentifyCollapsed()) {
      splitIdentifyEl?.classList.add("is-disabled");
      splitIdentifyEl?.setAttribute("aria-disabled", "true");
    } else {
      const idBounds = identifyUsableBounds();
      splitIdentifyEl?.classList.toggle("is-disabled", !idBounds.canResize);
      splitIdentifyEl?.setAttribute("aria-disabled", idBounds.canResize ? "false" : "true");
    }
  }

  /**
   * Keep 图层 / 样式 and 样式 / 识别 splits proportional when there is room.
   * 地图+坐标 stays below. Short windows: .side scrolls; floors are preserved.
   */
  function syncSideSplits() {
    if (!sideEl) return;
    const { usableInView, minClamp, maxH, needsScroll } = sideTopUsableBounds();
    let nextTop;
    if (needsScroll) {
      // Prefer user height / ratio within scroll-mode bounds; else floors.
      if (sideEl.dataset.splitUserSet === "1") {
        const cur = parseFloat(getComputedStyle(sideEl).getPropertyValue("--side-top-h"));
        nextTop = Number.isFinite(cur)
          ? Math.min(maxH, Math.max(minClamp, cur))
          : minClamp;
      } else {
        nextTop = Math.min(maxH, Math.max(minClamp, Math.round(usableInView * sideTopRatio())));
      }
    } else if (usableInView >= minSideTopH + minSideTabsH) {
      nextTop = Math.min(maxH, Math.max(minClamp, Math.round(usableInView * sideTopRatio())));
    } else {
      nextTop = minSideTopH;
      sideEl.dataset.splitRatio = sideEl.dataset.splitRatio || "0.5";
    }
    sideEl.style.setProperty("--side-top-h", `${Math.round(nextTop)}px`);

    if (!isIdentifyCollapsed()) {
      const idBounds = identifyUsableBounds();
      let nextId;
      if (idBounds.needsScroll) {
        if (sideEl.dataset.identifyUserSet === "1") {
          const cur = parseFloat(getComputedStyle(sideEl).getPropertyValue("--side-identify-h"));
          nextId = Number.isFinite(cur)
            ? Math.min(idBounds.maxH, Math.max(idBounds.minClamp, cur))
            : idBounds.minClamp;
        } else {
          nextId = Math.min(
            idBounds.maxH,
            Math.max(idBounds.minClamp, Math.round(idBounds.usable * identifyRatio())),
          );
        }
      } else if (idBounds.usable >= minSideIdentifyH + minSideTabsH) {
        nextId = Math.min(
          idBounds.maxH,
          Math.max(idBounds.minClamp, Math.round(idBounds.usable * identifyRatio())),
        );
        // Prefer user-set absolute height when present and still in range.
        if (sideEl.dataset.identifyUserSet === "1") {
          const cur = parseFloat(getComputedStyle(sideEl).getPropertyValue("--side-identify-h"));
          if (Number.isFinite(cur)) {
            nextId = Math.min(idBounds.maxH, Math.max(idBounds.minClamp, cur));
          }
        }
      } else {
        nextId = minSideIdentifyH;
        sideEl.dataset.identifyRatio = sideEl.dataset.identifyRatio || "0.35";
      }
      sideEl.style.setProperty("--side-identify-h", `${Math.round(nextId)}px`);
    }
    syncSplitHandlesEnabled();
    sideEl.classList.toggle("is-tight", !!sideLayoutChrome().needsScroll);
  }

  function wireVerticalSplit(handle, cssVar, minH, maxFrac, opts = {}) {
    if (!handle || !sideEl) return;
    const {
      getStartHeight,
      onMoveHeight,
      direction = 1, // 1: drag down grows target; -1: drag up grows target
    } = opts;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (handle.classList.contains("is-disabled")) return;
      e.preventDefault();
      handle.classList.add("is-dragging");
      handle.setPointerCapture?.(e.pointerId);
      const startY = e.clientY;
      const startH =
        (typeof getStartHeight === "function" ? getStartHeight() : null) ||
        parseFloat(getComputedStyle(sideEl).getPropertyValue(cssVar)) ||
        minH;
      const onMove = (ev) => {
        if (handle.classList.contains("is-disabled")) return;
        const next = onMoveHeight
          ? onMoveHeight(startH, ev.clientY - startY)
          : (() => {
              const { maxH, minClamp, canResize } = sideTopUsableBounds(minH, maxFrac);
              if (!canResize) return null;
              return Math.min(
                maxH,
                Math.max(minClamp, startH + direction * (ev.clientY - startY)),
              );
            })();
        if (next == null || !Number.isFinite(next)) return;
        sideEl.style.setProperty(cssVar, `${Math.round(next)}px`);
        if (cssVar === "--side-top-h") {
          const { usableInView } = sideTopUsableBounds(minH, maxFrac);
          if (usableInView > 0) sideEl.dataset.splitRatio = String(next / usableInView);
          sideEl.dataset.splitUserSet = "1";
        } else if (cssVar === "--side-identify-h") {
          const { usable } = identifyUsableBounds();
          if (usable > 0) sideEl.dataset.identifyRatio = String(next / usable);
          sideEl.dataset.identifyUserSet = "1";
        }
        syncSplitHandlesEnabled();
      };
      const onUp = (ev) => {
        handle.classList.remove("is-dragging");
        handle.releasePointerCapture?.(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        syncSideSplits();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  wireVerticalSplit(splitInfoEl, "--side-top-h", minSideTopH, 0.85);
  wireVerticalSplit(splitIdentifyEl, "--side-identify-h", minSideIdentifyH, 0.7, {
    getStartHeight: () => sideIdentifyEl?.getBoundingClientRect().height,
    direction: -1, // drag handle up → identify grows
    onMoveHeight: (startH, dy) => {
      if (isIdentifyCollapsed()) return null;
      const { maxH, minClamp, canResize } = identifyUsableBounds();
      if (!canResize) return null;
      return Math.min(maxH, Math.max(minClamp, startH - dy));
    },
  });
  syncIdentifyCollapseUi();
  syncSideSplits();
  requestAnimationFrame(() => syncSideSplits());

  // VS Code editor-group resize often won't fire window.resize; observe the panel.
  if (typeof ResizeObserver !== "undefined") {
    let resizeTick = 0;
    const onPanelResize = () => {
      if (resizeTick) return;
      resizeTick = requestAnimationFrame(() => {
        resizeTick = 0;
        syncSideSplits();
        map?.updateSize();
      });
    };
    const ro = new ResizeObserver(onPanelResize);
    if (sideEl) ro.observe(sideEl);
    if (mainEl) ro.observe(mainEl);
  }
  window.addEventListener("resize", () => {
    syncSideSplits();
    map?.updateSize();
  });

  function wireHorizontalSplit(handle, cssVar, minW, maxFrac) {
    if (!handle || !mainEl) return;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.classList.add("is-dragging");
      document.body.classList.add("is-resizing-side");
      handle.setPointerCapture?.(e.pointerId);
      const startX = e.clientX;
      const root = document.documentElement;
      const startW = parseFloat(getComputedStyle(root).getPropertyValue(cssVar)) || minW;
      const mainW = mainEl.getBoundingClientRect().width;
      const maxW = Math.max(minW, Math.floor(mainW * maxFrac));
      const onMove = (ev) => {
        const next = Math.min(maxW, Math.max(minW, startW + (startX - ev.clientX)));
        root.style.setProperty(cssVar, `${Math.round(next)}px`);
        map?.updateSize();
      };
      const onUp = (ev) => {
        handle.classList.remove("is-dragging");
        document.body.classList.remove("is-resizing-side");
        handle.releasePointerCapture?.(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        map?.updateSize();
        syncSideSplits();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
  wireHorizontalSplit(splitSideEl, "--side-width", 220, 0.65);

  /** Drag divider between 要素 / 值 columns (delegation survives applyI18n). */
  function wireIdentifyColResize() {
    const table = document.getElementById("identifyTable");
    if (!table || table.dataset.colResizeWired === "1") return;
    table.dataset.colResizeWired = "1";
    table.addEventListener("pointerdown", (ev) => {
      const handle = ev.target?.closest?.(".identify-col-resizer");
      if (!handle || ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const rect = table.getBoundingClientRect();
      const total = Math.max(1, rect.width);
      const minPct = 18;
      const maxPct = 78;
      handle.classList.add("is-dragging");
      document.body.classList.add("is-resizing-identify-col");
      handle.setPointerCapture?.(ev.pointerId);
      const onMove = (e) => {
        const x = e.clientX - rect.left;
        let pct = (x / total) * 100;
        pct = Math.max(minPct, Math.min(maxPct, pct));
        const pctStr = `${pct.toFixed(1)}%`;
        table.style.setProperty("--identify-feat-pct", pctStr);
        const featCol = table.querySelector(".identify-col-feat");
        const valCol = table.querySelector(".identify-col-val");
        if (featCol) featCol.style.width = pctStr;
        if (valCol) valCol.style.width = `calc(100% - ${pctStr})`;
      };
      const onUp = (e) => {
        handle.classList.remove("is-dragging");
        document.body.classList.remove("is-resizing-identify-col");
        try {
          handle.releasePointerCapture?.(e.pointerId);
        } catch {
          /* ignore */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
  wireIdentifyColResize();

  syncHoverLockUi();
  setSideTab("style");
  tabStyleEl?.addEventListener("click", () => setSideTab("style"));
  tabSettingsEl?.addEventListener("click", () => setSideTab("settings"));
  btnToggleIdentify?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIdentifyCollapsed(!isIdentifyCollapsed());
  });
  // Clicking the identify title row also toggles collapse (except interactive children).
  sideIdentifyEl?.querySelector(".identify-head-row")?.addEventListener("click", (e) => {
    if (e.target?.closest?.("button")) return;
    setIdentifyCollapsed(!isIdentifyCollapsed());
  });


  mapCrsSelect?.addEventListener("change", () => {
    if (mapCrsSelect.value === "custom") {
      showMapCrsCustomMode(mapCrsCustom?.value || "", { focus: true });
      return;
    }
    showMapCrsSelectMode();
    void applyMapCrsChange(mapCrsSelect.value);
  });
  mapCrsCustom?.addEventListener("blur", () => {
    if (mapCrsCustom.hidden) return;
    const next = normalizeMapCrsCode(mapCrsCustom.value);
    if (!next) {
      // empty → revert to last known / default select
      syncMapCrsUi();
      return;
    }
    void applyMapCrsChange(next).then(() => {
      syncMapCrsUi();
    });
  });
  mapCrsCustom?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      mapCrsCustom.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      syncMapCrsUi();
      mapCrsCustom.blur();
    }
  });
  affineInput?.addEventListener("blur", () => {
    if (!affineEditing) return;
    void applyAffineChange();
  });
  affineInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      affineInput.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      fillAffineInputs(currentAffine());
      setAffineEditMode(false);
    }
  });
  btnEditAffine?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAffineEditMode(true);
  });
  // Ensure default map CRS is registered / UI synced
  ensureProjection(mapCrs);
  syncMapCrsUi();
  setAffineEditMode(false);

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "fileList") {
      fileList = Array.isArray(msg.files) ? msg.files : [];
      const nextId = msg.activeId != null ? msg.activeId : activeFileId;
      syncLayerOrder();
      if (nextId && nextId !== activeFileId) {
        const cached = fileCache.get(nextId);
        if (cached?.layer) {
          void activateFile(nextId, { fit: false, keepSelection: false });
        } else {
          if (activeFileId) snapshotUiState();
          activeFileId = nextId;
          selectOnly(nextId);
          tileLayer = null;
          ready = false;
          renderFileList();
          vscodeApi?.postMessage({ type: "selectFile", id: nextId });
        }
      } else {
        if (nextId) {
          activeFileId = nextId;
          // Keep highlight in sync with host activeId (single-select).
          if (!selectedFileIds.has(nextId) || selectedFileIds.size !== 1) {
            selectOnly(nextId);
          }
        }
        renderFileList();
      }
      return;
    }
    if (msg.type === "activeFile" || msg.type === "activateFile") {
      const id = msg.id || msg.fileId;
      if (!id) return;
      snapshotUiState();
      void activateFile(id, { fit: false, requestIfMissing: true });
      return;
    }
    if (msg.type === "clearFile") {
      snapshotUiState();
      activeFileId = null;
      selectedFileIds.clear();
      selectionAnchorId = null;
      layerVisibility.clear();
      rasterLoadQueue.length = 0;
      pendingMaskData.clear();
      bandPlanes = [];
      bandStats = [];
      ready = false;
      started = false;
      payload.probeLabel = "";
      geo = null;
      width = 0;
      height = 0;
      rasterExtent = null;
      viewConfig = null;
      tileLayer = null;
      for (const id of [...fileCache.keys()]) removeFileLayer(id);
      fileCache.clear();
      // Keep empty map + view so pointermove can still show map-CRS coordinates.
      if (map) {
        mapReady = true;
        map.updateSize?.();
      }
      resetStyleUiForEmptyView();
      updateMeta();
      renderFileList();
      lastHoverBandValues = null;
      lastIdentifyResults = null;
      renderIdentifyResults([]);
      return;
    }
    if (msg.type === "openFile") {
      snapshotUiState();
      applyFilePayload(msg);
      return;
    }
    if (msg.type === "rasterReady") {
      rasterLoadQueue.push({ kind: "ready", msg });
      void drainRasterLoadQueue();
      return;
    }
    if (msg.type === "maskData" && msg.indexBase64) {
      const targetId = msg.fileId || activeFileId;
      if (targetId) pendingMaskData.set(targetId, msg);
      rasterLoadQueue.push({ kind: "mask", msg, targetId });
      void drainRasterLoadQueue();
      return;
    }
    if (msg.type === "imageRgba" && msg.rgbaBase64) {
      payload._rgbaBase64 = msg.rgbaBase64;
      if (msg.width) payload.width = msg.width;
      if (msg.height) payload.height = msg.height;
      void init();
      return;
    }
    if (msg.type === "imageDataUrl" && msg.dataUrl) {
      payload._imageDataUrl = msg.dataUrl;
      if (msg.width) payload.width = msg.width;
      if (msg.height) payload.height = msg.height;
      void init();
      return;
    }
    if (msg.type === "colormapLoaded" && (msg.colorTable || msg.colormap)) {
      colormap = { ...(msg.colormap || {}) };
      const fromMsg = parseColorTable(msg.colorTable);
      colorTable = fromMsg.length ? fromMsg : colorTableFromLegacyMap(colormap, {});
      syncColorTableLegacy();
      payload.colormapSource = "file";
      payload.colormapPath = msg.path || payload.colormapPath;
      renderCmapTable();
      render();
    }
    if (msg.type === "colormapSaved") {
      payload.colormapSource = "file";
      payload.colormapPath = msg.path || payload.colormapPath;
    }
  });

  // Handshake once (plus a short retry). Do NOT poll forever — that re-pushed every layer.
  {
    let asked = 0;
    const ask = () => {
      asked += 1;
      vscodeApi?.postMessage({ type: "ready" });
    };
    ask();
    setTimeout(() => {
      if (!started && asked < 3) ask();
    }, 200);
    setTimeout(() => {
      if (!started && asked < 3) ask();
    }, 600);
  }

  // Initial HTML may already include the active raster (set by host after open).
  if (fileList.length) renderFileList();
  if (payload.rasterUrl || payload.indexBase64 || payload.awaitIndices) {
    metaEl.textContent = lang === "zh" ? "加载中…" : "Loading…";
    // Payload already has URL/size (or indices follow via maskData)
    if ((payload.rasterUrl && payload.width && payload.height) || payload.indexBase64) {
    void init();
    }
  }
})();

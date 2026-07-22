import {
  buildWebGlStyle,
  createEmptyMap,
  createRasterLayer,
  applyStyle,
  planesToGeoTiffBlob,
  normalizeEpsg,
  fitMap,
  zoomPercent,
  extentFromGeo,
  freeViewOptions,
  revokeLayerUrls,
  resolveSourceBounds,
  LOCAL_PIXEL_PROJECTION,
  isLocalPixelProjection,
} from "./olRaster.js";
import { colorsForClasses, stretchRange } from "./colorRamps.js";
import { applyMapViewCrs, ensureProjection } from "./mapCrs.js";
import { transform as transformCoord, transformExtent } from "ol/proj.js";
import View from "ol/View.js";

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
      renderPaletted: "调色板/唯一值",
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
      colColor: "颜色",
      colLabel: "标注",
      classify: "分类",
      deleteAll: "全部删除",
      reloadCmap: "重载色表",
      saveCmap: "保存色表",
      savePlte: "另存为 PLTE",
      missingData: "缺少像素数据",
      tipReload: "重新读取 .vscode/raster-viewer.json",
      tipSave: "写入 .vscode/raster-viewer.json",
      tipPlte: "像素值不变，用当前色表生成索引色 PNG",
      tipReset: "定位全图（适应窗口）",
      tipZoomNative: "按原图分辨率 1:1 显示",
      locateMap: "定位地图",
      mapHead: "地图",
      clearLayers: "移除",
      tipClearLayers: "移除所选图层；Shift+点击作用于全部",
      tipEditAffine: "编辑仿射",
      tipAdd: "添加类别",
      tipRemove: "删除选中",
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
      renderPaletted: "Paletted/Unique values",
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
      colColor: "Color",
      colLabel: "Label",
      classify: "Classify",
      deleteAll: "Delete all",
      reloadCmap: "Reload colormap",
      saveCmap: "Save colormap",
      savePlte: "Save as PLTE",
      missingData: "Missing pixel data",
      tipReload: "Reload .vscode/raster-viewer.json",
      tipSave: "Write .vscode/raster-viewer.json",
      tipPlte: "Export indexed PNG with current colormap",
      tipReset: "Fit layer to view",
      tipZoomNative: "1:1 native resolution",
      locateMap: "Fit map",
      mapHead: "Map",
      clearLayers: "Remove",
      tipClearLayers: "Remove selected layers; Shift+click applies to all",
      tipEditAffine: "Edit affine",
      tipAdd: "Add class",
      tipRemove: "Remove selected",
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
  const btnResetView = document.getElementById("btnResetView");
  const btnToggleVisibility = document.getElementById("btnToggleVisibility");
  const btnClearLayers = document.getElementById("btnClearLayers");
  const tabStyleEl = document.getElementById("tabStyle");
  const tabIdentifyEl = document.getElementById("tabIdentify");
  const panelStyleEl = document.getElementById("panelStyle");
  const panelIdentifyEl = document.getElementById("panelIdentify");
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
    btnResetView.title = t("locateMap");
    btnResetView.setAttribute("aria-label", t("locateMap"));
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
    if (c && c !== "Local" && c !== "Unknown") return c;
    return mapCrs || "EPSG:3857";
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
    if (!Number.isFinite(res) || res <= 0) return 3;
    const d = Math.ceil(-Math.log10(res * 0.1));
    return Math.max(0, Math.min(12, d));
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
      labels: { ...labels },
      selectedValue,
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
      labels = {};
      selectedValue = null;
      if (paletteRampEl) paletteRampEl.value = "random";
      if (paletteOpacityEl) paletteOpacityEl.value = "0";
      syncPaletteOpacityLabel();
      return;
    }
    userRenderMode = st.userRenderMode;
    renderMode = st.renderMode || renderMode;
    colormap = { ...st.colormap };
    labels = { ...st.labels };
    selectedValue = st.selectedValue;
    randomSeed = st.randomSeed || randomSeed;
    const assign = (el, v) => {
      if (el && v != null && v !== "") el.value = String(v);
    };
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

  /** Prefer setVisible only — setOpacity(0) blanks sibling WebGLTile layers. */
  function applyOlLayerVisibility(layer, visible) {
    if (!layer) return;
    const v = !!visible;
    if (typeof layer.setOpacity === "function" && layer.getOpacity() !== 1) {
      layer.setOpacity(1);
    }
    layer.setVisible(v);
  }

  function setLayerVisibility(id, visible) {
    const v = !!visible;
    layerVisibility.set(id, v);
    const cached = fileCache.get(id);
    if (cached) {
      cached.visible = v;
      applyOlLayerVisibility(cached.layer, v);
    }
    // Re-assert siblings — WebGL style rebuilds can revive hidden layers.
    assertAllLayerVisibility();
  }

  function assertAllLayerVisibility() {
    for (const [fid, cached] of fileCache) {
      if (!cached?.layer) continue;
      const vis = isLayerVisible(fid);
      cached.visible = vis;
      applyOlLayerVisibility(cached.layer, vis);
    }
  }

  /**
   * Re-apply every layer's cached WebGL style after one layer's setStyle.
   * Without this, adding a mask can leave the JPG undrawn until the user clicks it.
   */
  function refreshAllCachedLayerStyles() {
    for (const [fid, cached] of fileCache) {
      if (!cached?.layer || !cached.styleState) continue;
      try {
        applyStyle(cached.layer, cached.styleState);
      } catch (err) {
        console.error("refresh style", fid, err);
      }
      applyOlLayerVisibility(cached.layer, isLayerVisible(fid));
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
      applyOlLayerVisibility(cached?.layer, next);
    }
    assertAllLayerVisibility();
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
    if (cached?.objectUrls) revokeLayerUrls(cached.objectUrls);
    if (cached?.layer && map) {
      map.removeLayer(cached.layer);
    }
    selectedFileIds.delete(id);
    layerVisibility.delete(id);
  }

  /** All displays go through GeoTIFF + WebGLTile (planes blob or native TIFF URL). */
  function buildLayerSourceArgs(planes, w, h, g, url, overviewUrls) {
    const overs = Array.isArray(overviewUrls) ? overviewUrls : [];
    const crs = blobCrsForGeo(g);
    if (planes?.length) {
      return {
        kind: "geotiff",
        blob: planesToGeoTiffBlob(planes, w, h, g, crs),
        overviewBlobs: [],
        url: null,
        overviews: overs,
        overviewCount: overs.length,
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
    const { style, bandCount: nBands, zIndex, mins, maxs, geo: layerGeo } = opts;
    const fileEpsg = normalizeEpsg(layerGeo?.crs || srcArgs.crs);
    // Identity / Local rasters must share one projection or they won't stack.
    const projection = fileEpsg ? null : LOCAL_PIXEL_PROJECTION;
    return createRasterLayer({
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
    });
  }

  function layerSourceBounds(nBands, planes, stats, mode) {
    // Paletted class masks must keep 0..255 so class ids are not remapped.
    if (mode === "paletted") {
      return resolveSourceBounds(nBands, stats, planes, { lockByteRange: true });
    }
    // Blob-backed layers always need explicit bounds (especially float32).
    if (planes?.length) {
      return resolveSourceBounds(nBands, stats, planes);
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
    }
  }

  async function activateFile(id, { fit = false, requestIfMissing = false, keepSelection = false } = {}) {
    activeFileId = id;
    if (!keepSelection) selectOnly(id);
    else if (id) selectedFileIds.add(id);
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
    // Restore may have left empty min/max; fill from stats if needed
    if (bandPlanes.length && (!grayMinEl.value || !grayMaxEl.value)) {
      setMinMaxInputsFromStats();
    }
    syncStretchParamUi();
    if (renderMode === "paletted") {
      if (!sortedColormapIds().length && bandPlanes.length) classifyFromData(true);
      else {
        ensureLabelsForIds(sortedColormapIds());
        renderCmapTable();
      }
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
    applyOlLayerVisibility(cached.layer, vis);
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
      geo = normalizeGeoRef(msg.geo, msg.width || width, msg.height || height);
      payload.geo = geo;
    }
    if (msg.rasterUrl) {
      payload.rasterUrl = msg.rasterUrl;
      rasterUrl = msg.rasterUrl;
    }
    if (Array.isArray(msg.overviewUrls)) {
      payload.overviewUrls = msg.overviewUrls;
    }
    payload.awaitIndices = !!msg.awaitIndices;
    if (msg.indexBase64) {
      payload.indexBase64 = msg.indexBase64;
      payload.indexFormat = msg.indexFormat || "i32";
    }
    // Do not wipe other layers — only reset active decode buffers for reload
    bandPlanes = [];
    bandStats = [];
    bandCount = Math.max(1, Number(payload.bands) || 1);
    // Unbind style target until this file's layer exists (avoids editing the previous JPG).
    tileLayer = null;
    ready = false;
    // Fresh open uses host defaultRender; keep per-file UI if we already have it.
    // Drop previous file's UI sticky mode when opening a file that has no saved state.
    restoreUiState(activeFileId, {
      defaultRender: msg.defaultRender || payload.defaultRender,
      colormap: msg.colormap || payload.colormap,
    });
    if (!fileUiState.has(activeFileId)) {
      userRenderMode = null;
      renderMode = msg.defaultRender || payload.defaultRender || "gray";
    }
    if (!fileUiState.has(activeFileId) && msg.colormap) {
      colormap = { ...msg.colormap };
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
      const crs = currentCrs();
      const src = geo?.source === "worldfile"
        ? "world file"
        : geo?.source === "geotiff"
          ? "GeoTIFF"
          : geo?.source === "identity"
            ? "默认"
            : geo?.source === "user"
              ? "用户"
              : "";
      geoCrsLabelEl.textContent = src ? `${crs} · ${src}` : crs;
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
    const empty = rawMin === "" || rawMax === "" || rawMin == null || rawMax == null;
    if (empty || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      const bi = Number(grayBandEl?.value) || 0;
      const s = bandStats[bi];
      if (s && Number.isFinite(s.min) && Number.isFinite(s.max)) {
        min = s.min;
        max = s.max <= s.min ? s.min + 1 : s.max;
        if (grayMinEl) grayMinEl.value = String(min);
        if (grayMaxEl) grayMaxEl.value = String(max);
      } else {
        min = 0;
        max = 255;
      }
    }
    return { min, max };
  }

  function ensureChannelStretch(minEl, maxEl, bandSel) {
    const rawMin = minEl?.value;
    const rawMax = maxEl?.value;
    let min = Number(rawMin);
    let max = Number(rawMax);
    const empty = rawMin === "" || rawMax === "" || rawMin == null || rawMax == null;
    if (empty || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      const bi = bandSel === "unset" || bandSel === "" ? -1 : Number(bandSel);
      const s = bi >= 0 ? bandStats[bi] : null;
      if (s && Number.isFinite(s.min) && Number.isFinite(s.max)) {
        min = s.min;
        max = s.max <= s.min ? s.min + 1 : s.max;
      } else {
        min = 0;
        max = 255;
      }
      if (minEl) minEl.value = String(min);
      if (maxEl) maxEl.value = String(max);
    }
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
    return {
      mode: renderMode,
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
      sourceMins: bounds?.mins,
      sourceMaxs: bounds?.maxs,
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
    const isStyle = name !== "identify";
    tabStyleEl?.classList.toggle("is-active", isStyle);
    tabIdentifyEl?.classList.toggle("is-active", !isStyle);
    if (tabStyleEl) tabStyleEl.setAttribute("aria-selected", isStyle ? "true" : "false");
    if (tabIdentifyEl) tabIdentifyEl.setAttribute("aria-selected", isStyle ? "false" : "true");
    panelStyleEl?.classList.toggle("is-active", isStyle);
    panelIdentifyEl?.classList.toggle("is-active", !isStyle);
    if (panelStyleEl) panelStyleEl.hidden = !isStyle;
    if (panelIdentifyEl) panelIdentifyEl.hidden = isStyle;
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

  function sampleLayerAt(coord, fileMeta, cached) {
    const id = fileMeta?.id || cached?.filePath || "";
    const name = fileMeta?.name || cached?.filePath || id || "—";
    if (!cached?.bandPlanes?.length) {
      return { id, name, hit: false, reason: "notLoaded", bands: [] };
    }
    const pix = mapCoordToLayerPixel(coord, cached);
    if (!pix) return { id, name, hit: false, reason: "noData", bands: [] };
    if (pix.x < 0 || pix.y < 0 || pix.x >= pix.w || pix.y >= pix.h) {
      return { id, name, hit: false, reason: "out", bands: [] };
    }
    const i = pix.y * pix.w + pix.x;
    const bands = [];
    for (let b = 0; b < cached.bandPlanes.length; b++) {
      const plane = cached.bandPlanes[b];
      const v = plane && i >= 0 && i < plane.length ? plane[i] : NaN;
      bands.push({ index: b + 1, value: v });
    }
    return { id, name, hit: true, bands, pixel: pix };
  }

  function renderIdentifyResults(results) {
    if (!identifyBodyEl || !identifyEmptyEl || !identifyTableWrap) return;
    const hits = (results || []).filter((r) => r.hit && r.bands?.length);
    if (!hits.length) {
      identifyEmptyEl.hidden = false;
      identifyTableWrap.hidden = true;
      identifyBodyEl.innerHTML = "";
      return;
    }
    identifyEmptyEl.hidden = true;
    identifyTableWrap.hidden = false;
    const parts = [];
    for (const r of hits) {
      const collapsed = identifyCollapsed.has(r.id);
      const caret = collapsed ? "▶" : "▼";
      const pixText =
        r.pixel && Number.isFinite(r.pixel.x) && Number.isFinite(r.pixel.y)
          ? `${r.pixel.x}, ${r.pixel.y}`
          : "—";
      parts.push(
        `<tr class="identify-group-row${collapsed ? " is-collapsed" : ""}" data-layer-id="${escapeAttr(r.id)}" data-act="toggle">` +
          `<td><span class="identify-caret">${caret}</span> ${escapeHtml(r.name)}</td>` +
          `<td class="identify-pix">${escapeHtml(pixText)}</td>` +
        `</tr>`,
      );
      if (!collapsed) {
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
        if (identifyCollapsed.has(id)) identifyCollapsed.delete(id);
        else identifyCollapsed.add(id);
        renderIdentifyResults(lastIdentifyResults);
      });
    });
  }

  function identifyAtCoordinate(coord) {
    const results = [];
    for (const f of fileList) {
      const cached = fileCache.get(f.id);
      results.push(sampleLayerAt(coord, f, cached));
    }
    lastIdentifyResults = results;
    renderIdentifyResults(results);
    setSideTab("identify");

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
      if (!ready || evt.dragging) {
        hideHover();
        return;
      }
      const pix = mapToPixel(evt.coordinate);
      if (!pix || pix.x < 0 || pix.y < 0 || pix.x >= width || pix.y >= height) {
        showHoverOutside(pix);
        return;
      }
      showHover(evt, pix.x, pix.y, pix);
    });
    map.getViewport().addEventListener("mouseout", () => {
      if (!hoverLocked) hideHover();
    });
    map.on("moveend", updateZoomBadge);
    map.on("singleclick", (evt) => {
      if (!ready) return;
      identifyAtCoordinate(evt.coordinate);
    });
    map.getViewport().addEventListener("dblclick", (e) => {
    e.preventDefault();
      toggleHoverLock();
    });
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
   * GeoTIFF GeoKeys for a layer:
   * - file has EPSG → write file CRS (OL reprojects to map view)
   * - Local/unknown → keep Local (never tag pixel coords as lon/lat / 4326)
   */
  function blobCrsForGeo(fileGeo) {
    const fileEpsg = normalizeEpsg(fileGeo?.crs);
    if (fileEpsg) return `EPSG:${fileEpsg}`;
    return null;
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
    );
    if (!srcArgs.blob && !srcArgs.url) return;

    const zIndex = cached.layer?.getZIndex?.() ?? 0;
    if (cached.objectUrls) revokeLayerUrls(cached.objectUrls);
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
    if (cached.visible === false || layerVisibility.get(id) === false) {
      applyOlLayerVisibility(created.layer, false);
    } else {
      applyOlLayerVisibility(created.layer, true);
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
    // Rebuild blob-backed layers so GeoKeys match display CRS
    for (const id of [...fileCache.keys()]) {
      try {
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
    const sourceChanged =
      !existing?.layer ||
      existing.bandPlanes !== snapPlanes ||
      existing.bandCount !== nBands ||
      existing.width !== snapW ||
      existing.height !== snapH ||
      existing.rasterUrl !== snapUrl ||
      prevLock !== nextLock;

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
    if (existing?.objectUrls) revokeLayerUrls(existing.objectUrls);
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
    });
    applyOlLayerVisibility(created.layer, prevVisible);

    if (!map) {
      map = createEmptyMap(mapEl, created.viewConfig);
      wireMapEvents();
      try {
        // Local pixel layers: keep RV:Local view. EPSG map CRS only for georeferenced files.
        if (isLocalPixelProjection(created.viewConfig?.projection)) {
          map.setView(new View(freeViewOptions(created.viewConfig)));
        } else {
          applyMapViewCrs(map, mapCrs, created.viewConfig);
        }
      } catch (err) {
        console.error(err);
      }
    } else if (created.viewConfig && fileCache.size === 0) {
      map.setView(new View(freeViewOptions(created.viewConfig)));
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
      styleState,
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

  function showHover(_e, x, y, pix) {
    const i = y * width + x;
    const gt = currentAffine();
    const g = pixelToGeo(x, y, gt, true);
    lastHoverBandValues = [];
    if (bandPlanes.length) {
      for (let b = 0; b < bandPlanes.length; b++) {
        lastHoverBandValues.push(bandValue(b, i));
      }
    }
    // Multi-layer: pixel coords belong in Identify; status bar shows geographic only.
    hoverEl.textContent = `${t("statusGeo")} ${formatGeoCoord(g.x)}, ${formatGeoCoord(g.y)}`;
    hoverEl.classList.add("is-active");
  }

  /** Outside raster extent: geographic coords only. */
  function showHoverOutside(pix) {
    if (!pix || !Number.isFinite(pix.mapX) || !Number.isFinite(pix.mapY)) {
      hideHover();
      return;
    }
    lastHoverBandValues = null;
    hoverEl.textContent = `${t("statusGeo")} ${formatGeoCoord(pix.mapX)}, ${formatGeoCoord(pix.mapY)}`;
    hoverEl.classList.add("is-active");
  }

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
      renderFileList();
      updateMeta();
      hideHover();
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
        renderFileList();
        updateMeta();
      }
    } else {
      renderFileList();
    }
  }

  hideHover();
  btnResetView.addEventListener("click", () => fitToView());
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

  function colorForClass(id) {
    const hex = colormap[id] ?? colormap[String(id)];
    if (hex) {
      const rgb = hexToRgb(hex);
      if (rgb) return rgb;
    }
    return defaultHashColor(id);
  }

  function colorForNewClass(id) {
    const ramp = paletteRampEl.value || "random";
    const ids = sortedColormapIds();
    const all = ids.includes(Number(id)) ? ids : [...ids, Number(id)].sort((a, b) => a - b);
    const map = colorsForClasses(all, ramp, { invert: false, seed: randomSeed });
    return map[Number(id)] || map[id] || "#808080";
  }

  /** One-shot: reverse current class colors (no persistent invert state). */
  function invertColormapColors() {
    const ids = sortedColormapIds();
    if (ids.length < 2) return;
    const colors = ids.map((id) => colormap[id] ?? colormap[String(id)] ?? "#808080");
    colors.reverse();
    // Object keys are always strings — never delete String(id) after writing id.
    const next = {};
    const nextLabels = { ...labels };
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      next[id] = colors[i];
      if (nextLabels[String(id)] == null) nextLabels[String(id)] = String(id);
    }
    colormap = next;
    labels = nextLabels;
    renderCmapTable();
    render();
  }

  function syncPaletteOpacityLabel() {
    if (!paletteOpacityValEl) return;
    const v = Math.max(0, Math.min(100, Number(paletteOpacityEl?.value) || 0));
    paletteOpacityValEl.textContent = `${v}%`;
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

  function ensureLabelsForIds(ids) {
    for (const id of ids) {
      const k = String(id);
      if (labels[k] == null) labels[k] = k;
      if (colormap[id] == null && colormap[k] == null) {
        colormap[id] = colorForNewClass(id);
      }
    }
  }

  /** Drop host-seeded placeholders; only for paletted masks (never continuous RGB). */
  function syncColormapToRaster() {
    if (renderMode !== "paletted" || !bandPlanes.length) return;
    const ids = collectUniqueValues();
    if (!ids.length) return;
    // Continuous imagery can yield hundreds of "classes" — never auto-expand the table.
    if (ids.length > 64) return;
    const existing = sortedColormapIds();
    const idSet = new Set(ids);
    const hasExtra = existing.some((id) => !idSet.has(id));
    const missing = ids.some((id) => colormap[id] == null && colormap[String(id)] == null);
    if (
      !existing.length ||
      missing ||
      (payload.colormapSource === "default" && (hasExtra || existing.length > ids.length))
    ) {
      classifyFromData();
    } else {
      ensureLabelsForIds(ids);
    }
  }

  function classifyFromData(forceRecolor = true) {
    const ids = collectUniqueValues();
    if (ids.length > 256) {
      metaEl.textContent =
        lang === "zh"
          ? "唯一值过多，无法作为调色板分类（请改用灰度/彩色）"
          : "Too many unique values for paletted mode";
      return;
    }
    const ramp = paletteRampEl.value || "random";
    const assigned = colorsForClasses(ids, ramp, { invert: false, seed: randomSeed });
    const nextMap = {};
    const nextLabels = {};
    for (const id of ids) {
      const prev = colormap[id] ?? colormap[String(id)];
      nextMap[id] = forceRecolor || !prev ? assigned[id] : prev;
      nextLabels[String(id)] = labels[String(id)] ?? String(id);
    }
    colormap = nextMap;
    labels = nextLabels;
    selectedValue = null;
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
    if (!plane || !minEl || !maxEl) return;
    const param = Number(paramEl?.value);
    const range = stretchRange(plane, stats, mode, {
      percent: mode === "percent" ? param : 2,
      stddev: mode === "stddev" ? param : 2,
    });
    minEl.value = String(range.min);
    maxEl.value = String(range.max);
  }

  function setMinMaxInputsFromStats() {
    const gMode = grayContrastEl.value || "none";
    const bi = Number(grayBandEl.value) || 0;
    applyStretchToInputs(gMode, bandPlanes[bi], bandStats[bi], grayMinEl, grayMaxEl, grayStretchParam);

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
    const r = new Float64Array(n);
    const g = new Float64Array(n);
    const b = new Float64Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      r[i] = rgba[p];
      g[i] = rgba[p + 1];
      b[i] = rgba[p + 2];
    }
    bandPlanes = [r, g, b];
    bandCount = 3;
    bandStats = bandPlanes.map(computeStats);
  }

  function setPlanesFromMask(values) {
    bandPlanes = [values];
    bandCount = 1;
    bandStats = [computeStats(values)];
  }

  function sortedColormapIds() {
    return Object.keys(colormap)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function renderCmapTable() {
    if (!cmapBody) return;
    const ids = sortedColormapIds();
    if (!ids.length) {
      cmapBody.innerHTML = "";
      return;
    }
    cmapBody.innerHTML = ids
      .map((id) => {
        const hex = colormap[id] ?? colormap[String(id)] ?? colorForNewClass(id);
        const lab = labels[String(id)] ?? String(id);
        const sel = selectedValue === id ? " is-selected" : "";
        return `<tr class="cmap-row${sel}" data-id="${id}">
          <td><input type="number" class="cmap-val" data-id="${id}" value="${id}" step="1" /></td>
          <td><input type="color" class="cmap-color" data-id="${id}" value="${hex}" /></td>
          <td><input type="text" class="cmap-label" data-id="${id}" value="${escapeAttr(lab)}" /></td>
        </tr>`;
      })
      .join("");

    cmapBody.querySelectorAll(".cmap-row").forEach((tr) => {
      tr.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;
        selectedValue = Number(tr.getAttribute("data-id"));
        renderCmapTable();
      });
    });
    cmapBody.querySelectorAll(".cmap-color").forEach((el) => {
      el.addEventListener("input", (e) => {
        const id = e.target.getAttribute("data-id");
        colormap[id] = e.target.value;
        colormap[Number(id)] = e.target.value;
        render();
      });
    });
    cmapBody.querySelectorAll(".cmap-label").forEach((el) => {
      el.addEventListener("change", (e) => {
        const id = e.target.getAttribute("data-id");
        labels[id] = e.target.value;
      });
    });
    cmapBody.querySelectorAll(".cmap-val").forEach((el) => {
      el.addEventListener("change", (e) => {
        const oldId = e.target.getAttribute("data-id");
        const newId = Number(e.target.value);
        if (!Number.isFinite(newId)) {
          e.target.value = oldId;
          return;
        }
        const hex = colormap[oldId] ?? colormap[Number(oldId)];
        const lab = labels[oldId] ?? String(oldId);
        delete colormap[oldId];
        delete colormap[Number(oldId)];
        delete labels[oldId];
        colormap[newId] = hex;
        labels[String(newId)] = lab;
        if (selectedValue === Number(oldId)) selectedValue = newId;
        renderCmapTable();
        render();
      });
    });
  }

  async function rasterFromDataUrl(src) {
    const img = await loadImage(src);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  }

  async function init() {
    const gen = ++initGeneration;
    try {
      width = payload.width || width;
      height = payload.height || height;
      geo = normalizeGeoRef(payload.geo || geo, width, height);
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
      if (bandPlanes.length) syncColormapToRaster();

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

  renderTypeEl.addEventListener("change", () => {
    userRenderMode = renderTypeEl.value;
    renderMode = userRenderMode;
    applyRenderModeUi();
    syncStretchParamUi();
    if (renderMode === "paletted") {
      if (!sortedColormapIds().length && bandPlanes.length) classifyFromData(true);
      else {
        ensureLabelsForIds(sortedColormapIds());
        renderCmapTable();
      }
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
  [grayMinEl, grayMaxEl, redMinEl, redMaxEl, greenMinEl, greenMaxEl, blueMinEl, blueMaxEl].forEach(
    (el) => {
      el?.addEventListener("change", onRenderControlsChange);
      el?.addEventListener("input", onRenderControlsChange);
    },
  );
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
    if (renderMode === "paletted" && bandPlanes.length) classifyFromData(true);
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
  btnAddRow.addEventListener("click", () => {
    const ids = sortedColormapIds();
    const next = ids.length ? Math.max(...ids) + 1 : 0;
    colormap[next] = colorForNewClass(next);
    labels[String(next)] = String(next);
    selectedValue = next;
    renderCmapTable();
    render();
  });
  btnRemoveRow.addEventListener("click", () => {
    if (selectedValue == null) return;
    delete colormap[selectedValue];
    delete colormap[String(selectedValue)];
    delete labels[String(selectedValue)];
    selectedValue = null;
    renderCmapTable();
    render();
  });
  btnClearRows.addEventListener("click", () => {
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
    vscodeApi?.postMessage({ type: "saveColormap", colormap });
  });
  btnReload.addEventListener("click", () => {
    moreMenu.classList.add("hidden");
    vscodeApi?.postMessage({ type: "reloadColormap" });
  });
  btnSavePlte.addEventListener("click", () => {
    moreMenu.classList.add("hidden");
    vscodeApi?.postMessage({
      type: "saveAsPlte",
      colormap,
      indexBase64: payload.indexBase64,
    });
  });

  applyRenderModeUi();
  syncPaletteOpacityLabel();
  renderFileList();

  const minSideTopH = 280; /* match --side-top-min: map + layers + info */
  const minSideTabsH = 280; /* match --side-tabs-min */

  function sideTopUsableBounds(minH = minSideTopH, maxFrac = 0.85) {
    const viewH = sideEl?.clientHeight || sideEl?.getBoundingClientRect().height || 0;
    const statusH = statusBarEl?.getBoundingClientRect().height || 0;
    const splitH = splitInfoEl?.getBoundingClientRect().height || 5;
    const usableInView = Math.max(0, viewH - statusH - splitH);
    // Never shrink below content floors — short windows scroll .side instead.
    const minClamp = minH;
    const roomForTabs = Math.max(0, usableInView - minSideTabsH);
    const maxH =
      usableInView >= minH + minSideTabsH
        ? Math.max(minClamp, Math.min(Math.floor(usableInView * maxFrac), roomForTabs))
        : minClamp;
    return { sideH: viewH, usable: Math.max(usableInView, minH + minSideTabsH), usableInView, minClamp, maxH };
  }

  function sideTopRatio() {
    const r = Number(sideEl?.dataset.splitRatio);
    if (Number.isFinite(r) && r > 0.05 && r < 0.95) return r;
    return 0.5;
  }

  /**
   * Keep top/bottom split proportional when there is room.
   * When the viewport is shorter than content floors, lock mins and let .side scroll.
   */
  function syncSideTopSplit() {
    if (!sideEl) return;
    const { usableInView, minClamp, maxH } = sideTopUsableBounds();
    let next;
    if (usableInView >= minSideTopH + minSideTabsH) {
      next = Math.min(maxH, Math.max(minClamp, Math.round(usableInView * sideTopRatio())));
    } else {
      // Window too short to show both blocks — keep usable heights, scroll the panel.
      next = minSideTopH;
      sideEl.dataset.splitRatio = sideEl.dataset.splitRatio || "0.5";
    }
    sideEl.style.setProperty("--side-top-h", `${Math.round(next)}px`);
  }

  function wireVerticalSplit(handle, cssVar, minH, maxFrac) {
    if (!handle || !sideEl) return;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.classList.add("is-dragging");
      handle.setPointerCapture?.(e.pointerId);
      const startY = e.clientY;
      const startH =
        sideTopEl?.getBoundingClientRect().height ||
        parseFloat(getComputedStyle(sideEl).getPropertyValue(cssVar)) ||
        minH;
      const onMove = (ev) => {
        const { usableInView, maxH, minClamp } = sideTopUsableBounds(minH, maxFrac);
        // Drag only reshapes when both blocks fit; otherwise keep floors.
        if (usableInView < minSideTopH + minSideTabsH) return;
        const next = Math.min(maxH, Math.max(minClamp, startH + (ev.clientY - startY)));
        sideEl.style.setProperty(cssVar, `${Math.round(next)}px`);
        sideEl.dataset.splitRatio = String(next / usableInView);
        sideEl.dataset.splitUserSet = "1";
      };
      const onUp = (ev) => {
        handle.classList.remove("is-dragging");
        handle.releasePointerCapture?.(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        syncSideTopSplit();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  wireVerticalSplit(splitInfoEl, "--side-top-h", minSideTopH, 0.85);
  syncSideTopSplit();
  requestAnimationFrame(() => syncSideTopSplit());

  // VS Code editor-group resize often won't fire window.resize; observe the panel.
  if (typeof ResizeObserver !== "undefined") {
    let resizeTick = 0;
    const onPanelResize = () => {
      if (resizeTick) return;
      resizeTick = requestAnimationFrame(() => {
        resizeTick = 0;
        syncSideTopSplit();
        map?.updateSize();
      });
    };
    const ro = new ResizeObserver(onPanelResize);
    if (sideEl) ro.observe(sideEl);
    if (mainEl) ro.observe(mainEl);
  }
  window.addEventListener("resize", () => {
    syncSideTopSplit();
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
        syncSideTopSplit();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
  wireHorizontalSplit(splitSideEl, "--side-width", 220, 0.65);
  syncHoverLockUi();
  setSideTab("style");
  tabStyleEl?.addEventListener("click", () => setSideTab("style"));
  tabIdentifyEl?.addEventListener("click", () => setSideTab("identify"));


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
      for (const id of [...fileCache.keys()]) removeFileLayer(id);
      fileCache.clear();
      if (map) {
        map.setTarget(null);
        map = null;
        tileLayer = null;
        viewConfig = null;
        mapReady = false;
      }
      updateMeta();
      renderFileList();
      hideHover();
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
    if (msg.type === "colormapLoaded" && msg.colormap) {
      colormap = { ...msg.colormap };
      labels = {};
      ensureLabelsForIds(sortedColormapIds());
      payload.colormapSource = "workspace";
      payload.colormapPath = msg.path || payload.colormapPath;
      renderCmapTable();
      render();
    }
    if (msg.type === "colormapSaved") {
      payload.colormapSource = "workspace";
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

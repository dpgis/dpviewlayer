import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { formatProbeSummary, type ImageProbeOk } from "./imageProbe";
import {
  decodeBmpMask,
  decodePngMask,
  decodeTiffMask,
  valuesToBase64,
  valuesToInt32Base64,
  type MaskDecodeResult,
} from "./maskDecode";
import { encodeIndexedPng, rgbToHex, type Rgb } from "./pngCodec";
import { buildWebviewHtml, type WebviewPayload } from "./webviewHtml";
import {
  defaultColormapSaveUri,
  loadColormapFromPath,
  saveColormapToPath,
} from "./workspaceConfig";
import { t, uiLang } from "./l10n";
import {
  identityGeoRef,
  readGeoTiffGeo,
  readWorldFile,
  type GeoRef,
} from "./geo";
import {
  assertRasterOpenable,
  findOverviewPaths,
  isRasterTooLarge,
} from "./overviews";
import { resolveRasterBandStats, type BandStat } from "./bandStats";
import { loadGeotiff } from "./geotiffLoader";

export type OpenMaskOptions = {
  context: vscode.ExtensionContext;
  uri: vscode.Uri;
  probe: ImageProbeOk;
  /** If true, always create a brand-new view instead of using the active one. */
  newView?: boolean;
  /** Add into this session (e.g. multi-view pick / drag onto a specific panel). */
  sessionId?: string;
};

export type OpenMaskResult = {
  ok: boolean;
  sessionId?: string;
};

export type SessionInfo = {
  id: string;
  title: string;
  fileCount: number;
  activeName: string | null;
};

type FileEntry = {
  id: string;
  uri: vscode.Uri;
  probe: ImageProbeOk;
  width: number;
  height: number;
  bands: number;
  dtype: string;
  kind: "mask" | "image";
  format: ImageProbeOk["format"];
  defaultRender: "gray" | "rgb" | "paletted";
  geo: GeoRef;
  probeLabel: string;
  indexBase64?: string;
  indexFormat?: "i32" | "f64";
  values?: Float64Array;
  colormap: Record<number, Rgb>;
  /** Ordered color-table rows; ID = index (not stored on rows). */
  colorTable: Array<{ min: number; max: number; color: string }>;
  colormapSource: WebviewPayload["colormapSource"];
  colormapPath: string;
  /** Absolute paths to external overview files (*.ovr) */
  overviewPaths: string[];
  /** Per-band min/max for stretch (PAM / overview / decode). */
  bandStats?: BandStat[];
};

type Session = {
  id: string;
  context: vscode.ExtensionContext;
  panel: vscode.WebviewPanel;
  files: FileEntry[];
  activeId: string | null;
  sub: vscode.Disposable;
  viewStateSub: vscode.Disposable;
  /** After webview reload, host may need to (re)push rasters once. */
  needsFilePush: boolean;
};

const sessions = new Map<string, Session>();
let activeSessionId: string | null = null;
let viewSeq = 0;

function mapToHexRecord(map: Record<number, Rgb>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) out[k] = rgbToHex(v);
  return out;
}

function parseMsgColormap(raw: Record<string, unknown> | undefined): Record<number, Rgb> {
  const map: Record<number, Rgb> = {};
  for (const [k, hex] of Object.entries(raw || {})) {
    const id = Number(k);
    const m = String(hex).match(/^#?([0-9a-fA-F]{6})$/);
    if (!m || !Number.isFinite(id)) continue;
    const n = parseInt(m[1], 16);
    map[id] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return map;
}

function parseMsgColorTable(
  raw: unknown,
): Array<{ min: number; max: number; color: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ min: number; max: number; color: string }> = [];
  for (const e of raw.slice(0, 256)) {
    if (!e || typeof e !== "object") continue;
    const row = e as Record<string, unknown>;
    const min = Number(row.min);
    const max = Number(row.max);
    const hex = String(row.color || "");
    const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min) || !m) continue;
    out.push({ min, max, color: `#${m[1].toLowerCase()}` });
  }
  return out;
}

function colormapFromColorTable(
  table: Array<{ min: number; max: number; color: string }>,
): Record<number, Rgb> {
  const map: Record<number, Rgb> = {};
  for (let i = 0; i < table.length; i++) {
    const m = table[i].color.match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) continue;
    const n = parseInt(m[1], 16);
    map[i] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return map;
}

function hexToRgbTuple(hex: string): Rgb | undefined {
  const m = String(hex || "").match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Build indexed PNG payload from color-table rows.
 * - Unit integer classes [v,v+1): keep pixel values; PLTE[v]=color (unchanged indices).
 * - Otherwise: remap each pixel into matching row index 0…N-1.
 */
function buildPlteExport(
  table: Array<{ min: number; max: number; color: string }>,
  pixels: Float64Array,
  width: number,
  height: number,
): { map: Record<number, Rgb>; indices: Uint8Array } | { error: string } {
  if (!table.length) return { error: "颜色表为空，无法导出 PLTE" };
  const need = width * height;
  if (!Number.isFinite(need) || need <= 0) return { error: "无效的图像尺寸" };
  if (pixels.length < need) {
    return {
      error: `像素数据长度与宽高不匹配（${pixels.length} < ${width}×${height}）`,
    };
  }
  const unitIds = table.every(
    (e) =>
      Number.isInteger(e.min) &&
      e.max === e.min + 1 &&
      e.min >= 0 &&
      e.min <= 255,
  );
  if (unitIds) {
    const map: Record<number, Rgb> = {};
    for (const e of table) {
      const rgb = hexToRgbTuple(e.color);
      if (rgb) map[e.min] = rgb;
    }
    const u8 = new Uint8Array(need);
    for (let i = 0; i < need; i++) {
      const v = pixels[i];
      if (!Number.isInteger(v) || v < 0 || v > 255) {
        return {
          error: "另存为 PLTE 仅支持类别值在 0–255 的 mask（当前存在超范围值）",
        };
      }
      u8[i] = v;
    }
    return { map, indices: u8 };
  }

  // Continuous / irregular ranges: remapped index = matching row (0…N-1).
  if (table.length > 256) return { error: "颜色表超过 256 行，无法导出 PLTE" };
  const map: Record<number, Rgb> = {};
  for (let i = 0; i < table.length; i++) {
    const rgb = hexToRgbTuple(table[i].color);
    if (rgb) map[i] = rgb;
  }
  const u8 = new Uint8Array(need);
  for (let i = 0; i < need; i++) {
    const v = pixels[i];
    let idx = 0;
    let hit = false;
    for (let r = 0; r < table.length; r++) {
      const e = table[r];
      if (v >= e.min && v < e.max) {
        idx = r;
        hit = true;
        break;
      }
    }
    if (!hit) {
      if (v < table[0].min) idx = 0;
      else idx = table.length - 1;
    }
    u8[i] = idx;
  }
  return { map, indices: u8 };
}

function decodeIndexBase64(
  b64: string,
  format: string | undefined,
  expectedLen: number,
): Float64Array {
  const u8 = Buffer.from(String(b64), "base64");
  const copy = Buffer.alloc(u8.length);
  u8.copy(copy);
  if (format === "f64") {
    const f64 = new Float64Array(
      copy.buffer,
      copy.byteOffset,
      Math.floor(copy.byteLength / 8),
    );
    return f64.length >= expectedLen ? f64 : Float64Array.from(f64);
  }
  if (format === "u8") {
    return Float64Array.from(copy.subarray(0, Math.min(copy.length, expectedLen)));
  }
  const i32 = new Int32Array(
    copy.buffer,
    copy.byteOffset,
    Math.floor(copy.byteLength / 4),
  );
  return Float64Array.from(i32);
}

/** Read one band of a GeoTIFF when in-memory indices were skipped (float / large / RGB). */
async function loadGeoTiffBandPixels(
  filePath: string,
  bandIndex = 0,
): Promise<{
  width: number;
  height: number;
  values: Float64Array;
}> {
  const geotiff = await loadGeotiff();
  const tiff = await geotiff.fromFile(filePath);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const sampleCount = image.getSamplesPerPixel?.() ?? 1;
  const bi = Math.max(0, Math.min(Math.trunc(Number(bandIndex) || 0), Math.max(0, sampleCount - 1)));
  const data = await image.readRasters({
    samples: [bi],
    interleave: false,
  });
  const plane = (Array.isArray(data) ? data[0] : data) as ArrayLike<number>;
  const values = new Float64Array(width * height);
  const n = Math.min(values.length, plane.length);
  for (let i = 0; i < n; i++) values[i] = Number(plane[i]);
  return { width, height, values };
}

function relativeConfigLabel(configPath: string | undefined): string {
  if (!configPath) return "";
  return vscode.workspace.asRelativePath(vscode.Uri.file(configPath));
}

function decodeMask(uri: vscode.Uri, probe: ImageProbeOk): MaskDecodeResult {
  if (probe.format === "png") return decodePngMask(uri.fsPath);
  if (probe.format === "tiff") return decodeTiffMask(uri.fsPath);
  if (probe.format === "bmp") return decodeBmpMask(uri.fsPath);
  throw new Error("单波段 JPEG 请使用浏览器解码路径");
}

function pickDefaultRender(
  bands: number,
  values?: Float64Array,
  bandStats?: BandStat[],
): "gray" | "rgb" | "paletted" {
  if (bands >= 3) return "rgb";
  if (values && values.length) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v) || !Number.isInteger(v)) return "gray";
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || max - min >= 128) return "gray";
    return "paletted";
  }
  const s = bandStats?.[0];
  if (s && Number.isFinite(s.min) && Number.isFinite(s.max)) {
    // Continuous float / wide range → gray stretch, not unique-value palette.
    if (s.max - s.min >= 128) return "gray";
    if (!Number.isInteger(s.min) || !Number.isInteger(s.max)) return "gray";
  }
  return "gray";
}

async function resolveGeo(uri: vscode.Uri, probe: ImageProbeOk): Promise<GeoRef> {
  const world = readWorldFile(uri.fsPath);
  if (world) return world;
  if (probe.format === "tiff") {
    const embedded = await readGeoTiffGeo(uri.fsPath);
    if (embedded) return embedded;
  }
  return identityGeoRef(probe.width, probe.height);
}

function fileIdFor(uri: vscode.Uri): string {
  return uri.fsPath;
}

/** Prefer compact i32 when all values are safe integers; otherwise f64. */
function packMaskIndices(values: Float64Array, dtype: string): {
  indexBase64: string;
  indexFormat: "i32" | "f64";
} {
  if (dtype === "float32" || dtype === "float64") {
    return { indexBase64: valuesToBase64(values), indexFormat: "f64" };
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
      return { indexBase64: valuesToBase64(values), indexFormat: "f64" };
    }
  }
  return { indexBase64: valuesToInt32Base64(values), indexFormat: "i32" };
}

async function buildFileEntry(uri: vscode.Uri, probe: ImageProbeOk): Promise<FileEntry> {
  const isImage = probe.kind === "image";
  let width = probe.width;
  let height = probe.height;
  let values: Float64Array | undefined;
  let indexBase64: string | undefined;
  let indexFormat: "i32" | "f64" | undefined;
  let dtype = probe.dtype;
  let bandStats: BandStat[] | undefined;
  const overviewPaths = findOverviewPaths(uri.fsPath);

  // Large continuous / float GeoTIFFs: open via URL + stats, skip full CPU decode
  // (25M+ float64 + base64 would stall the webview).
  const large = isRasterTooLarge(probe.width, probe.height);
  const largeTiff = probe.format === "tiff" && large;
  const floatDtype = dtype === "float32" || dtype === "float64";
  const largeMaskRaster =
    large && !isImage && (probe.format === "png" || probe.format === "bmp");
  const skipFullDecode =
    largeTiff ||
    largeMaskRaster ||
    (probe.format === "tiff" && floatDtype && !isImage);

  if (!isImage && probe.format !== "jpeg" && !skipFullDecode) {
    try {
      const decoded = decodeMask(uri, probe);
      width = decoded.width;
      height = decoded.height;
      values = decoded.values;
      dtype = decoded.dtype;
      const packed = packMaskIndices(decoded.values, dtype);
      indexBase64 = packed.indexBase64;
      indexFormat = packed.indexFormat;
      bandStats = [statsFromValues(decoded.values)];
    } catch {
      /* still open via URL */
    }
  }

  if (!bandStats?.length) {
    bandStats = await resolveRasterBandStats(uri.fsPath, {
      bands: Math.max(1, probe.bands === 4 ? 3 : probe.bands),
      format: probe.format,
    });
  }

  const colormap: Record<number, Rgb> = {};
  const colorTable: Array<{ min: number; max: number; color: string }> = [];
  const colormapSource: WebviewPayload["colormapSource"] = "default";
  const colormapPath = "";

  const bands = Math.max(1, probe.bands === 4 ? 3 : probe.bands);
  const defaultRender = pickDefaultRender(bands, values, bandStats);
  const geo = await resolveGeo(uri, probe);
  // CRS is shown in the map CRS control; keep probe label to georef source only.
  const geoLabel =
    geo.source === "worldfile"
      ? " · world file"
      : geo.source === "geotiff"
        ? " · GeoTIFF"
        : "";
  return {
    id: fileIdFor(uri),
    uri,
    probe,
    width,
    height,
    bands,
    dtype,
    kind: isImage ? "image" : "mask",
    format: probe.format,
    defaultRender,
    geo,
    probeLabel: formatProbeSummary({ ...probe, dtype, width, height }) + geoLabel,
    indexBase64,
    indexFormat,
    values,
    colormap,
    colorTable,
    colormapSource,
    colormapPath,
    overviewPaths,
    bandStats,
  };
}

function statsFromValues(values: Float64Array): BandStat {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 255 };
  return { min, max: max <= min ? min + 1 : max };
}

function entryToPayload(panel: vscode.WebviewPanel, entry: FileEntry): WebviewPayload {
  const rasterUrl = panel.webview.asWebviewUri(entry.uri).toString();
  const overviewUrls = (entry.overviewPaths || [])
    .map((p) => panel.webview.asWebviewUri(vscode.Uri.file(p)).toString());
  return {
    id: entry.id,
    kind: entry.kind,
    defaultRender: entry.defaultRender,
    uiLang: uiLang(),
    bands: entry.bands,
    format: entry.format,
    rasterUrl,
    overviewUrls,
    geo: {
      geoTransform: entry.geo.geoTransform,
      crs: entry.geo.crs,
      modelPixelScale: entry.geo.modelPixelScale,
      modelTiepoint: entry.geo.modelTiepoint,
      yFlipped: entry.geo.yFlipped,
      source: entry.geo.source,
    },
    dtype: entry.dtype,
    probeLabel: entry.probeLabel,
    width: entry.width,
    height: entry.height,
    indexBase64: undefined,
    indexFormat: entry.indexFormat || "i32",
    awaitIndices: !!entry.indexBase64,
    colormap: mapToHexRecord(entry.colormap),
    colorTable: entry.colorTable || [],
    colormapSource: entry.colormapSource,
    colormapPath: relativeConfigLabel(entry.colormapPath) || entry.colormapPath,
    filePath: entry.uri.fsPath,
    bandStats: entry.bandStats,
  };
}

function fileListMessage(s: Session) {
  return {
    type: "fileList" as const,
    files: s.files.map((f) => ({
      id: f.id,
      name: path.basename(f.uri.fsPath),
      filePath: f.uri.fsPath,
    })),
    activeId: s.activeId,
  };
}

function rootsEqual(a: readonly vscode.Uri[] | undefined, b: readonly vscode.Uri[]): boolean {
  if (!a || a.length !== b.length) return false;
  const as = new Set(a.map((u) => u.fsPath));
  return b.every((u) => as.has(u.fsPath));
}

function baseLocalRoots(context: vscode.ExtensionContext): vscode.Uri[] {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
  const dirs = new Map<string, vscode.Uri>();
  dirs.set(mediaRoot.fsPath, mediaRoot);
  for (const folder of vscode.workspace.workspaceFolders || []) {
    dirs.set(folder.uri.fsPath, folder.uri);
  }
  return [...dirs.values()];
}

function refreshLocalRoots(s: Session): boolean {
  const dirs = new Map<string, vscode.Uri>();
  for (const u of baseLocalRoots(s.context)) {
    dirs.set(u.fsPath, u);
  }
  for (const f of s.files) {
    const d = vscode.Uri.file(path.dirname(f.uri.fsPath));
    dirs.set(d.fsPath, d);
  }
  const next = [...dirs.values()];
  const prev = s.panel.webview.options.localResourceRoots;
  if (rootsEqual(prev, next)) return false;
  // Changing localResourceRoots reloads the webview — schedule a one-shot file push.
  s.needsFilePush = true;
  s.panel.webview.options = {
    enableScripts: true,
    localResourceRoots: next,
  };
  return true;
}

function pushFile(
  s: Session,
  entry: FileEntry,
  opts: { activate?: boolean } = {},
) {
  const payload = entryToPayload(s.panel, entry);
  const activate = opts.activate !== false;
  // Put indices on rasterReady so mask loads in one message (avoids race with maskData).
  s.panel.webview.postMessage({
    type: "rasterReady",
    fileId: entry.id,
    id: entry.id,
    rasterUrl: payload.rasterUrl,
    overviewUrls: payload.overviewUrls || [],
    width: entry.width,
    height: entry.height,
    format: payload.format,
    bands: entry.bands,
    geo: payload.geo,
    probeLabel: entry.probeLabel,
    kind: entry.kind,
    dtype: entry.dtype,
    defaultRender: entry.defaultRender,
    colormap: payload.colormap,
    colorTable: payload.colorTable || [],
    colormapSource: entry.colormapSource,
    colormapPath: relativeConfigLabel(entry.colormapPath) || entry.colormapPath,
    filePath: entry.uri.fsPath,
    indexBase64: entry.indexBase64,
    indexFormat: entry.indexFormat || "i32",
    awaitIndices: false,
    bandStats: entry.bandStats,
    activate,
  });
}

/** Push every file once: background layers first, active last. */
function pushAllFiles(s: Session) {
  s.panel.webview.postMessage(fileListMessage(s));
  for (const f of s.files) {
    if (f.id !== s.activeId) pushFile(s, f, { activate: false });
  }
  const active = s.files.find((f) => f.id === s.activeId);
  if (active) pushFile(s, active, { activate: true });
  s.needsFilePush = false;
}

function pushActiveFile(s: Session) {
  const entry = s.files.find((f) => f.id === s.activeId);
  if (!entry) return;
  s.panel.webview.postMessage(fileListMessage(s));
  pushFile(s, entry);
}

function activeEntry(s: Session): FileEntry | undefined {
  return s.files.find((f) => f.id === s.activeId);
}

function updatePanelTitle(s: Session) {
  const entry = activeEntry(s);
  if (entry) {
    s.panel.title = path.basename(entry.uri.fsPath);
    return;
  }
  const n = [...sessions.values()].indexOf(s) + 1;
  const name = t().appName;
  s.panel.title = n > 1 ? `${name} ${n}` : name;
}

function getActiveSession(): Session | null {
  if (activeSessionId && sessions.has(activeSessionId)) {
    return sessions.get(activeSessionId)!;
  }
  const first = sessions.values().next().value as Session | undefined;
  if (first) {
    activeSessionId = first.id;
    return first;
  }
  return null;
}

function setActiveSession(s: Session) {
  activeSessionId = s.id;
}

function disposeSession(s: Session) {
  s.sub.dispose();
  s.viewStateSub.dispose();
  sessions.delete(s.id);
  if (activeSessionId === s.id) {
    activeSessionId = sessions.keys().next().value ?? null;
  }
  refreshHasOpenViewContext();
}

export function hasOpenView(): boolean {
  return sessions.size > 0;
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()].map((s) => {
    const active = s.files.find((f) => f.id === s.activeId);
    return {
      id: s.id,
      title: s.panel.title || t().appName,
      fileCount: s.files.length,
      activeName: active ? path.basename(active.uri.fsPath) : null,
    };
  });
}

function getSessionById(id: string | undefined): Session | null {
  if (!id) return null;
  return sessions.get(id) ?? null;
}

function refreshHasOpenViewContext() {
  void vscode.commands.executeCommand("setContext", "viewLayer.hasOpenView", sessions.size > 0);
}

function wireMessages(s: Session) {
  return s.panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg !== "object") return;
    try {
      if (msg.type === "ready") {
        // Only sync the list on repeated ready (webview used to poll → mass re-push → selection thrash).
        s.panel.webview.postMessage(fileListMessage(s));
        if (s.needsFilePush && s.files.length) {
          pushAllFiles(s);
        }
      } else if (msg.type === "selectFile" && msg.id) {
        const id = String(msg.id);
        if (!s.files.some((f) => f.id === id)) return;
        if (s.activeId === id) {
          updatePanelTitle(s);
          return;
        }
        s.activeId = id;
        updatePanelTitle(s);
        // Do not echo activeFile back — webview already switched; echoing caused selection loops.
      } else if (msg.type === "requestFile" && msg.id) {
        const id = String(msg.id);
        if (!s.files.some((f) => f.id === id)) return;
        s.activeId = id;
        updatePanelTitle(s);
        pushActiveFile(s);
      } else if (msg.type === "reorderFiles" && Array.isArray(msg.ids)) {
        const byId = new Map(s.files.map((f) => [f.id, f]));
        const next: FileEntry[] = [];
        for (const id of msg.ids.map(String)) {
          const f = byId.get(id);
          if (f) {
            next.push(f);
            byId.delete(id);
          }
        }
        for (const f of byId.values()) next.push(f);
        s.files = next;
        s.panel.webview.postMessage(fileListMessage(s));
      } else if (msg.type === "removeFile" && msg.id) {
        const id = String(msg.id);
        const idx = s.files.findIndex((f) => f.id === id);
        if (idx < 0) return;
        s.files.splice(idx, 1);
        if (!s.files.length) {
          s.activeId = null;
          s.panel.webview.postMessage(fileListMessage(s));
          s.panel.webview.postMessage({ type: "clearFile" });
          updatePanelTitle(s);
          return;
        }
        if (s.activeId === id) {
          s.activeId = s.files[Math.min(idx, s.files.length - 1)].id;
        }
        refreshLocalRoots(s);
        updatePanelTitle(s);
        pushActiveFile(s);
      } else if (msg.type === "clearAllFiles") {
        s.files = [];
        s.activeId = null;
        refreshLocalRoots(s);
        updatePanelTitle(s);
        s.panel.webview.postMessage(fileListMessage(s));
        s.panel.webview.postMessage({ type: "clearFile" });
      } else if (msg.type === "newView") {
        createNewView(s.context);
      } else if (msg.type === "saveColormap") {
        const entry = activeEntry(s);
        if (!entry) return;
        const table = parseMsgColorTable(msg.colorTable);
        if (!table.length) {
          void vscode.window.showWarningMessage("颜色表为空，无法保存");
          return;
        }
        const dest = await vscode.window.showSaveDialog({
          defaultUri: defaultColormapSaveUri(entry.uri, entry.colormapPath || undefined),
          filters: { JSON: ["json"] },
          saveLabel: "保存色表",
        });
        if (!dest) return;
        const target = saveColormapToPath(dest.fsPath, table);
        entry.colorTable = table;
        entry.colormap = colormapFromColorTable(table);
        entry.colormapPath = target;
        entry.colormapSource = "file";
        const label = relativeConfigLabel(target) || target;
        void vscode.window.showInformationMessage(`已保存色表: ${label}`);
        s.panel.webview.postMessage({
          type: "colormapSaved",
          path: label,
          fileId: entry.id,
        });
      } else if (msg.type === "reloadColormap") {
        const entry = activeEntry(s);
        if (!entry) return;
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "加载色表",
          filters: { JSON: ["json"] },
          defaultUri: defaultColormapSaveUri(entry.uri, entry.colormapPath || undefined),
        });
        if (!picked?.length) return;
        let loaded;
        try {
          loaded = loadColormapFromPath(picked[0].fsPath);
        } catch (e) {
          void vscode.window.showWarningMessage(`色表读取失败: ${String(e)}`);
          return;
        }
        if (!loaded.colorTable.length) {
          void vscode.window.showWarningMessage("所选文件中没有有效的 colorTable");
          return;
        }
        entry.colormap = loaded.colormap;
        entry.colorTable = loaded.colorTable;
        entry.colormapPath = loaded.path;
        entry.colormapSource = "file";
        const label = relativeConfigLabel(loaded.path) || loaded.path;
        s.panel.webview.postMessage({
          type: "colormapLoaded",
          colormap: mapToHexRecord(loaded.colormap),
          colorTable: loaded.colorTable,
          path: label,
          fileId: entry.id,
        });
      } else if (msg.type === "saveAsPlte") {
        const entry = activeEntry(s);
        if (!entry) return;
        const table = parseMsgColorTable(msg.colorTable);
        if (!table.length) {
          void vscode.window.showWarningMessage("颜色表为空，无法导出 PLTE");
          return;
        }
        let width = Number(msg.width) || entry.width;
        let height = Number(msg.height) || entry.height;
        let pix = entry.values;
        const exportBand = Math.max(0, Math.trunc(Number(msg.exportBand) || 0));
        const fmt = String(msg.indexFormat || entry.indexFormat || "i32");
        // Prefer the webview's current (palette/gray) band plane — works for RGB too.
        if (msg.indexBase64 && width && height) {
          try {
            pix = decodeIndexBase64(String(msg.indexBase64), fmt, width * height);
          } catch (e) {
            void vscode.window.showWarningMessage(`解析像素索引失败: ${String(e)}`);
            return;
          }
        }
        if (!pix && entry.format === "tiff") {
          try {
            void vscode.window.setStatusBarMessage("正在读取 GeoTIFF 像素以导出 PLTE…", 5000);
            const loaded = await loadGeoTiffBandPixels(entry.uri.fsPath, exportBand);
            pix = loaded.values;
            width = loaded.width;
            height = loaded.height;
          } catch (e) {
            void vscode.window.showWarningMessage(
              `无法读取 GeoTIFF 像素: ${String(e)}`,
            );
            return;
          }
        }
        if (!pix && (entry.format === "png" || entry.format === "bmp")) {
          try {
            // Single-band decode; for RGB PNG the webview should already have sent a plane.
            const decoded = decodePngMask(entry.uri.fsPath);
            pix = decoded.values;
            width = decoded.width;
            height = decoded.height;
          } catch (e) {
            void vscode.window.showWarningMessage(`无法读取 PNG 像素: ${String(e)}`);
            return;
          }
        }
        if (!pix || !width || !height) {
          void vscode.window.showWarningMessage(
            "当前图像无法导出为索引色 PNG（缺少像素数据；请先用「颜色表渲染」分类）",
          );
          return;
        }
        const built = buildPlteExport(table, pix, width, height);
        if ("error" in built) {
          void vscode.window.showWarningMessage(built.error);
          return;
        }
        const { map, indices: u8 } = built;
        const base = path.basename(entry.uri.fsPath).replace(/\.[^.]+$/, "");
        const defaultUri = vscode.Uri.file(
          path.join(path.dirname(entry.uri.fsPath), `${base}.plte.png`),
        );
        const dest = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { PNG: ["png"] },
          saveLabel: "另存为 PLTE PNG",
        });
        if (!dest) return;
        const buf = encodeIndexedPng(width, height, u8, map);
        fs.writeFileSync(dest.fsPath, buf);
        void vscode.window.showInformationMessage(
          `已另存为索引色 PNG（PLTE）: ${vscode.workspace.asRelativePath(dest)}`,
        );
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`${t().appName}: ${String(e)}`);
    }
  });
}

async function addFileToSession(
  s: Session,
  uri: vscode.Uri,
  probe: ImageProbeOk,
): Promise<FileEntry | null> {
  const id = fileIdFor(uri);
  const existing = s.files.find((f) => f.id === id);
  if (existing) {
    s.activeId = existing.id;
    return existing;
  }
  const entry = await buildFileEntry(uri, probe);
  const check = await assertRasterOpenable({
    width: entry.width,
    height: entry.height,
    format: entry.format,
    filePath: uri.fsPath,
    overviewPaths: entry.overviewPaths,
  });
  if (!check.ok) {
    void vscode.window.showErrorMessage(check.reason);
    return null;
  }
  // List index 0 = top of side panel + highest map zIndex.
  s.files.unshift(entry);
  s.activeId = entry.id;
  return entry;
}

function createPanel(context: vscode.ExtensionContext, title: string): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel(
    "viewLayer.panel",
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: baseLocalRoots(context),
    },
  );
}

function emptyPayload(): WebviewPayload {
  return {
    bands: 1,
    colormap: {},
    colorTable: [],
    colormapSource: "default",
    filePath: "",
    uiLang: uiLang(),
    files: [],
    activeId: null,
  };
}

/** Create an empty View Layer tab (independent file list / map CRS). */
export function createNewView(context: vscode.ExtensionContext): Session {
  viewSeq += 1;
  const id = `view-${viewSeq}`;
  const name = t().appName;
  const title = sessions.size === 0 ? name : `${name} ${viewSeq}`;
  const panel = createPanel(context, title);
  const s: Session = {
    id,
    context,
    panel,
    files: [],
    activeId: null,
    sub: { dispose() {} },
    viewStateSub: { dispose() {} },
    needsFilePush: false,
  };
  s.sub = wireMessages(s);
  s.viewStateSub = panel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active) setActiveSession(s);
  });
  panel.onDidDispose(() => disposeSession(s));
  panel.webview.html = buildWebviewHtml(panel.webview, context.extensionUri, emptyPayload());
  sessions.set(id, s);
  setActiveSession(s);
  refreshHasOpenViewContext();
  panel.reveal(vscode.ViewColumn.Active, false);
  return s;
}

/**
 * Open / add a raster into a viewer session.
 * - `newView: true` → always a fresh panel
 * - `sessionId` → that panel (multi-view pick)
 * - else → active session, or create one if none
 */
export async function openMaskPreview(opts: OpenMaskOptions): Promise<OpenMaskResult> {
  const { context, uri, probe } = opts;

  let createdFresh = false;
  let s: Session;
  if (opts.newView) {
    s = createNewView(context);
    createdFresh = true;
  } else {
    const byId = getSessionById(opts.sessionId);
    const existing = byId ?? getActiveSession();
    if (existing) {
      s = existing;
    } else {
      s = createNewView(context);
      createdFresh = true;
    }
  }

  setActiveSession(s);
  const beforeCount = s.files.length;
  const alreadyOpen = s.files.some((f) => f.id === fileIdFor(uri));
  const entry = await addFileToSession(s, uri, probe);
  if (!entry) {
    if (createdFresh && s.files.length === 0) {
      s.panel.dispose();
    }
    return { ok: false };
  }
  // Prefer not to change localResourceRoots (it reloads the webview and drops layers).
  const rootsChanged = refreshLocalRoots(s);
  updatePanelTitle(s);

  // Already in this view: only switch selection — do not re-push / re-decode (map flash).
  if (alreadyOpen && !rootsChanged && !createdFresh) {
    if (!s.panel.visible) {
      s.panel.reveal(s.panel.viewColumn ?? vscode.ViewColumn.Active, true);
    }
    s.panel.webview.postMessage(fileListMessage(s));
    s.panel.webview.postMessage({ type: "activateFile", id: entry.id });
    return { ok: true, sessionId: s.id };
  }

  // Keep explorer focus when adding from context menu.
  s.panel.reveal(s.panel.viewColumn ?? vscode.ViewColumn.Active, true);

  const mustSetHtml = createdFresh || beforeCount === 0 || rootsChanged;
  if (mustSetHtml) {
    s.needsFilePush = true;
    const payload = entryToPayload(s.panel, entry);
    s.panel.webview.html = buildWebviewHtml(s.panel.webview, context.extensionUri, {
      ...payload,
      files: s.files.map((f) => ({
        id: f.id,
        name: path.basename(f.uri.fsPath),
        filePath: f.uri.fsPath,
      })),
      activeId: entry.id,
    });
    // One-shot push after boot (ready also pushes at most once via needsFilePush).
    setTimeout(() => {
      if (!s.needsFilePush) return;
      pushAllFiles(s);
    }, 80);
  } else {
    pushActiveFile(s);
  }
  return { ok: true, sessionId: s.id };
}

import * as vscode from "vscode";

export type WebviewPayload = {
  id?: string;
  kind?: "mask" | "image";
  defaultRender?: "gray" | "rgb" | "paletted";
  uiLang?: "zh" | "en";
  bands: number;
  format?: "png" | "jpeg" | "tiff" | "bmp";
  /** vscode webview URI for the raster file (GeoTIFF preferred) */
  rasterUrl?: string;
  /** External overview GeoTIFF URLs (e.g. *.ovr) for OL pyramid */
  overviewUrls?: string[];
  /** World-file / GeoTIFF / identity affine */
  geo?: {
    /** GDAL GeoTransform [gt0..gt5]; default identity 0,1,0,0,0,1 */
    geoTransform?: [number, number, number, number, number, number];
    crs?: string;
    modelPixelScale: [number, number, number];
    modelTiepoint: [number, number, number, number, number, number];
    yFlipped?: boolean;
    source?: string;
  };
  maskDataUrl?: string;
  dtype?: string;
  probeLabel?: string;
  width?: number;
  height?: number;
  indexBase64?: string;
  indexFormat?: "i32" | "f64" | "u8";
  awaitIndices?: boolean;
  colormap: Record<string, string>;
  /** Ordered rows; ID = array index (not stored). */
  colorTable?: Array<{ min: number; max: number; color: string }>;
  colormapSource: "workspace" | "default";
  colormapPath?: string;
  filePath: string;
  /** Host-computed per-band min/max (PAM / overview / decode). */
  bandStats?: Array<{ min: number; max: number; mean?: number; stddev?: number }>;
  /** Multi-file list (initial / empty shell) */
  files?: Array<{ id: string; name: string; filePath: string }>;
  activeId?: string | null;
};

export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  payload: WebviewPayload,
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.css"));
  const olStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "ol.css"));
  const nonce = getNonce();
  const data = JSON.stringify(payload).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; media-src ${webview.cspSource} blob:; connect-src ${webview.cspSource} blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; worker-src ${webview.cspSource} blob:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <link rel="stylesheet" href="${olStyleUri}" />
  <title>View Layer</title>
</head>
<body>
  <div class="main" id="main">
    <div class="map-wrap" id="map"></div>
    <div class="h-split" id="splitSide" role="separator" aria-orientation="vertical" title="拖动调整宽度"></div>
    <aside class="side" id="side">
      <div class="side-top" id="sideTop">
        <div class="layer-head-row">
          <span class="layer-head-title" data-i18n="layerList">图层</span>
          <div class="layer-head-actions">
            <button type="button" id="btnToggleVisibility" class="icon-btn" title="显示/隐藏所选图层；Shift+点击作用于全部" aria-label="显示/隐藏所选图层">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor" d="M8 3c3.2 0 5.8 2.1 7 5-1.2 2.9-3.8 5-7 5S2.2 10.9 1 8c1.2-2.9 3.8-5 7-5zm0 1.5A3.5 3.5 0 1 0 8 11.5 3.5 3.5 0 0 0 8 4.5zm0 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
              </svg>
            </button>
            <button type="button" id="btnClearLayers" class="icon-btn" title="移除所选图层；Shift+点击作用于全部" aria-label="移除图层">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor" d="M6 2h4l.5 1H14v1H2V3h3.5L6 2zm1 4v6H6V6h1zm3 0v6H9V6h1zm2.5-1H3.5l.7 9.1A1 1 0 0 0 5.2 15h5.6a1 1 0 0 0 1-.9L12.5 5z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="file-panel" id="filePanel">
          <ul id="fileList" class="file-list" aria-label="图层列表"></ul>
        </div>
        <div class="side-header" id="sideHeader">
          <div id="meta" class="side-meta"></div>
          <div class="geo-block side-geo" id="geoBlock">
            <div class="geo-row">
              <span class="geo-k">信息</span>
              <span class="geo-v" id="geoInfo">—</span>
            </div>
            <div class="geo-row geo-row-affine" id="affineRow">
              <span class="geo-k" data-i18n="affine">仿射</span>
              <div class="affine-view" id="affineView">
                <span class="geo-v affine-text" id="affineText">—</span>
                <button type="button" id="btnEditAffine" class="geo-edit-btn" title="编辑仿射" aria-label="编辑仿射">
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                    <path fill="currentColor" d="M11.7 1.3a1.5 1.5 0 0 1 2.1 2.1L5.4 12 2 13.2 3.2 9.8l8.5-8.5zM10.6 3.5 3.9 10.2l-.4 1.5 1.5-.4 6.7-6.7-.7-.7z"/>
                  </svg>
                </button>
              </div>
              <input
                id="affineInput"
                class="field field-affine-line hidden"
                type="text"
                hidden
                spellcheck="false"
                autocomplete="off"
                title="GDAL GeoTransform：6 个数，逗号分隔"
                placeholder="0, 1, 0, 0, 0, 1"
              />
            </div>
            <div class="geo-row">
              <span class="geo-k">坐标系</span>
              <span class="geo-v" id="geoCrsLabel">—</span>
            </div>
          </div>
        </div>
      </div>

      <div class="v-split" id="splitInfo" role="separator" aria-orientation="horizontal" title="拖动调整图层/样式高度"></div>

      <div class="side-tabs" id="sideTabs">
        <div class="tab-bar" role="tablist">
          <button type="button" class="tab-btn is-active" id="tabStyle" role="tab" aria-selected="true" data-tab="style" data-i18n="tabStyle">样式</button>
          <button type="button" class="tab-btn" id="tabIdentify" role="tab" aria-selected="false" data-tab="identify" data-i18n="tabIdentify">识别</button>
        </div>
        <div class="tab-panel is-active" id="panelStyle" role="tabpanel">
          <div class="symbology">
            <div class="form-row form-row-full">
              <select id="renderType" class="field field-grow" title="渲染类型">
                <option value="gray" data-i18n="renderGray">单波段灰度</option>
                <option value="rgb" data-i18n="renderRgb">多波段彩色</option>
                <option value="paletted" data-i18n="renderPaletted">颜色表渲染</option>
              </select>
            </div>

        <div id="panelGray" class="render-panel panel-gray">
          <div class="form-row">
            <span class="form-label" data-i18n="grayBand">灰度波段</span>
            <select id="grayBand" class="field field-grow band-select"></select>
          </div>
          <div class="form-row">
            <span class="form-label" data-i18n="colorRamp">颜色梯度</span>
            <select id="grayRamp" class="field field-grow">
              <option value="blackwhite" data-i18n="rampBw">黑到白</option>
              <option value="whiteblack" data-i18n="rampWb">白到黑</option>
              <option value="blues">Blues</option>
              <option value="cividis">Cividis</option>
              <option value="greens">Greens</option>
              <option value="greys">Greys</option>
              <option value="magma">Magma</option>
              <option value="mako">Mako</option>
              <option value="rdgy">RdGy</option>
              <option value="reds">Reds</option>
              <option value="rocket">Rocket</option>
              <option value="spectral">Spectral</option>
              <option value="turbo">Turbo</option>
              <option value="viridis">Viridis</option>
            </select>
          </div>
          <div class="form-row form-row-minmax">
            <label class="minmax-item">
              <span class="minmax-label" data-i18n="minVal">最小值</span>
              <input id="grayMin" class="field field-num" type="number" step="any" />
            </label>
            <label class="minmax-item">
              <span class="minmax-label" data-i18n="maxVal">最大值</span>
              <input id="grayMax" class="field field-num" type="number" step="any" />
            </label>
          </div>
          <div class="form-row">
            <span class="form-label" data-i18n="contrast">对比度增强</span>
            <select id="grayContrast" class="field field-grow">
              <option value="none" data-i18n="contrastNone" selected>无增强</option>
              <option value="minmax" data-i18n="contrastMinMax">拉伸至极小极大</option>
              <option value="percent" data-i18n="contrastPercent">百分比线性拉伸</option>
              <option value="stddev" data-i18n="contrastStdDev">均值±标准差</option>
            </select>
          </div>
          <div class="form-row" id="grayStretchOpts">
            <span class="form-label" id="grayStretchLabel" data-i18n="percentCut">百分比</span>
            <input id="grayStretchParam" class="field field-num" type="number" step="any" value="2" min="0" max="49" />
          </div>
        </div>

        <div id="panelRgb" class="render-panel panel-rgb">
          <div class="channel-block">
            <div class="form-row">
              <span class="form-label" data-i18n="redBand">红色波段</span>
              <select id="redBand" class="field field-grow band-select"></select>
            </div>
            <div class="form-row form-row-minmax form-indent">
              <label class="minmax-item">
                <span class="minmax-label" data-i18n="minVal">最小值</span>
                <input id="redMin" class="field field-num" type="number" step="any" />
              </label>
              <label class="minmax-item">
                <span class="minmax-label" data-i18n="maxVal">最大值</span>
                <input id="redMax" class="field field-num" type="number" step="any" />
              </label>
            </div>
          </div>
          <div class="channel-block">
            <div class="form-row">
              <span class="form-label" data-i18n="greenBand">绿色波段</span>
              <select id="greenBand" class="field field-grow band-select"></select>
            </div>
            <div class="form-row form-row-minmax form-indent">
              <label class="minmax-item">
                <span class="minmax-label" data-i18n="minVal">最小值</span>
                <input id="greenMin" class="field field-num" type="number" step="any" />
              </label>
              <label class="minmax-item">
                <span class="minmax-label" data-i18n="maxVal">最大值</span>
                <input id="greenMax" class="field field-num" type="number" step="any" />
              </label>
            </div>
          </div>
          <div class="channel-block">
            <div class="form-row">
              <span class="form-label" data-i18n="blueBand">蓝色波段</span>
              <select id="blueBand" class="field field-grow band-select"></select>
            </div>
            <div class="form-row form-row-minmax form-indent">
              <label class="minmax-item">
                <span class="minmax-label" data-i18n="minVal">最小值</span>
                <input id="blueMin" class="field field-num" type="number" step="any" />
              </label>
              <label class="minmax-item">
                <span class="minmax-label" data-i18n="maxVal">最大值</span>
                <input id="blueMax" class="field field-num" type="number" step="any" />
              </label>
            </div>
          </div>
          <div class="form-row">
            <span class="form-label" data-i18n="contrast">对比度增强</span>
            <select id="rgbContrast" class="field field-grow">
              <option value="none" data-i18n="contrastNone" selected>无增强</option>
              <option value="minmax" data-i18n="contrastMinMax">拉伸至极小极大</option>
              <option value="percent" data-i18n="contrastPercent">百分比线性拉伸</option>
              <option value="stddev" data-i18n="contrastStdDev">均值±标准差</option>
            </select>
          </div>
          <div class="form-row" id="rgbStretchOpts">
            <span class="form-label" id="rgbStretchLabel" data-i18n="percentCut">百分比</span>
            <input id="rgbStretchParam" class="field field-num" type="number" step="any" value="2" min="0" max="49" />
          </div>
        </div>

        <div id="panelPaletted" class="render-panel panel-paletted">
          <div class="form-row">
            <span class="form-label" data-i18n="classBand">波段</span>
            <select id="paletteBand" class="field field-grow band-select"></select>
          </div>
          <div class="form-row">
            <span class="form-label" data-i18n="paletteRamp">颜色渐变</span>
            <select id="paletteRamp" class="field field-grow">
              <option value="random" data-i18n="rampRandom">Random colors</option>
              <option value="blues">Blues</option>
              <option value="cividis">Cividis</option>
              <option value="greens">Greens</option>
              <option value="greys">Greys</option>
              <option value="magma">Magma</option>
              <option value="mako">Mako</option>
              <option value="rdgy">RdGy</option>
              <option value="reds">Reds</option>
              <option value="rocket">Rocket</option>
              <option value="spectral">Spectral</option>
              <option value="turbo">Turbo</option>
              <option value="viridis">Viridis</option>
            </select>
          </div>
          <div class="form-row">
            <span class="form-label" data-i18n="paletteOpacity">透明度</span>
            <input
              id="paletteOpacity"
              class="field-range"
              type="range"
              min="0"
              max="100"
              step="1"
              value="0"
            />
            <span id="paletteOpacityVal" class="field-suffix">0%</span>
          </div>
          <div class="cmap-table-wrap">
            <table class="cmap-table" id="cmapTable">
              <thead>
                <tr>
                  <th data-i18n="colIndex">ID</th>
                  <th data-i18n="colMin">≥</th>
                  <th data-i18n="colMax">&lt;</th>
                  <th data-i18n="colColor">颜色</th>
                </tr>
              </thead>
              <tbody id="cmapBody"></tbody>
            </table>
          </div>
          <div class="cmap-toolbar">
            <button type="button" id="btnClassify" class="btn" data-i18n="classify">分类</button>
            <button type="button" id="btnAddRow" class="btn btn-icon" title="+">+</button>
            <button type="button" id="btnRemoveRow" class="btn btn-icon" title="-">−</button>
            <button type="button" id="btnClearRows" class="btn" data-i18n="deleteAll">全部删除</button>
            <button
              type="button"
              id="btnRampInvert"
              class="btn btn-icon btn-ramp-invert"
              title="反转颜色渐变"
              aria-label="反转颜色渐变"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 1.25 11.5 5H9.25v3.25h-2.5V5H4.5L8 1.25zm0 13.5L4.5 11h2.25V7.75h2.5V11H11.5L8 14.75z"
                />
              </svg>
            </button>
            <div class="menu-wrap">
              <button type="button" id="btnMore" class="btn btn-icon" title="…">…</button>
              <div id="moreMenu" class="menu hidden" role="menu">
                <button type="button" id="btnReloadCmap" class="menu-item" data-i18n="reloadCmap">重载色表</button>
                <button type="button" id="btnSaveCmap" class="menu-item" data-i18n="saveCmap">保存色表</button>
                <button type="button" id="btnSavePlte" class="menu-item" data-i18n="savePlte">另存为 PLTE</button>
              </div>
            </div>
          </div>
        </div>
          </div>
        </div>
        <div class="tab-panel" id="panelIdentify" role="tabpanel" hidden>
          <div class="identify-wrap">
            <div id="identifyEmpty" class="identify-empty" data-i18n="identifyEmpty">在地图上点击以识别各图层像元值</div>
            <div class="identify-table-wrap" id="identifyTableWrap" hidden>
              <table class="identify-table" id="identifyTable">
                <colgroup>
                  <col class="identify-col-feat" />
                  <col class="identify-col-val" />
                </colgroup>
                <thead>
                  <tr>
                    <th class="identify-th-feat">
                      <span data-i18n="identifyFeature">要素</span>
                      <span class="identify-col-resizer" id="identifyColResizer" role="separator" aria-orientation="vertical" title="拖动调节列宽"></span>
                    </th>
                    <th><span data-i18n="identifyValue">值</span></th>
                  </tr>
                </thead>
                <tbody id="identifyBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="map-section" id="mapSection">
      <div class="map-foot" id="mapFoot">
        <div class="map-head-row">
          <span class="map-head-title" data-i18n="mapHead">地图</span>
          <div class="map-head-actions">
            <div class="map-crs-control" id="mapCrsControl" title="地图显示坐标系">
              <select id="mapCrsSelect" class="field field-crs" aria-label="地图坐标系">
                <option value="EPSG:3857" selected>EPSG:3857</option>
                <option value="EPSG:4326">EPSG:4326</option>
                <option value="EPSG:4490">EPSG:4490</option>
                <option value="EPSG:4547">EPSG:4547</option>
                <option value="custom" data-i18n="mapCrsCustom">自定义…</option>
              </select>
              <input
                id="mapCrsCustom"
                class="field field-crs hidden"
                type="text"
                hidden
                spellcheck="false"
                autocomplete="off"
                placeholder="EPSG:4548"
                aria-label="自定义地图坐标系"
              />
            </div>
          </div>
        </div>
      </div>
      <div class="status-bar" id="statusBar">
        <span id="hoverLockBadge" class="status-lock hidden" title="坐标已锁定，可复制；再双击地图解锁">锁定</span>
        <div id="hover" class="status-hover" aria-live="polite" tabindex="0">—</div>
      </div>
      </div>
    </aside>
  </div>
  <div id="cmapColorPop" class="cmap-color-pop hidden" hidden>
    <input type="color" id="cmapColorPopInput" value="#808080" />
  </div>
  <script nonce="${nonce}">window.__RASTER_VIEWER__ = ${data};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

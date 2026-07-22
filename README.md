# 栅格查看器（Raster Viewer）

VS Code / Cursor 里的**图像查看器**，同时适用于 **GIS 栅格预览**。

支持 PNG / JPEG / BMP / TIFF / GeoTIFF：普通图片可快速浏览与叠图；带地理参考的数据可按地图坐标查看、拉伸与调色。渲染基于 OpenLayers WebGLTile。

## 能做什么

- 作为日常图像查看器打开常见栅格格式
- 预览遥感 / 分类 mask / RGB 影像（含 GeoTIFF、world file）
- 灰度、多波段彩色、调色板（唯一值）样式与对比度拉伸
- 多图层叠加、透明度、识别像元、仿射与显示 CRS

## 安装

```bash
cd raster-viewer && npm install && npm run package
```

在 VS Code / Cursor 中「从 VSIX 安装」生成的 `raster-viewer-*.vsix`。

```bash
npm run compile   # 递增版本 + 打包 webview + tsc
npm run smoke     # 本地叠层冒烟测试（可选）
```

## 打开方式

- 资源管理器 / 编辑器标题右键 → **在新视图中打开** / **添加为图层**
- 命令面板 → **栅格查看器: 在新视图中打开** / **添加为图层** / **新建空视图**

不再占用默认编辑器：点文件不会自动抢开，需通过上述命令打开。

## 支持格式

| 格式 | 单波段 | 多波段 |
|------|--------|--------|
| PNG | 灰度 / 索引色 | RGB / RGBA |
| TIFF / GeoTIFF | uint/int 8/16/32 | RGB / RGBA（8-bit） |
| JPEG / BMP | 单波段 | 24/32-bit 彩色 |

## 渲染与样式

- **单波段灰度** / **多波段彩色** / **调色板（唯一值）**
- 对比度：无增强、MinMax、百分比截断、均值±标准差
- 调色板：Random colors（每次选择换一批色）、渐变色带、反转、透明度
- 色表可读写工作区配置，或导出索引色 PNG（PLTE）

## 地图与地理参考

- 地图显示 CRS（含自定义 EPSG）
- 仿射：GDAL GeoTransform，默认 `0,1,0,0,0,1`
- 自动读取 world file / GeoTIFF 内嵌地理参考；无地理参考时使用 Local 像素坐标

## 图层

同一视图可叠加多个文件。新图层叠在最上方。

| 操作 | 说明 |
|------|------|
| 单击 / Ctrl / Shift | 单选、加减选、范围选 |
| 拖拽 | 调整叠放顺序 |
| 显示/隐藏、移除 | 支持多选；Shift 可作用于全部 |
| 定位 | 适应全图；Shift+点击按原图 1:1 分辨率 |

## 识别

在地图上单击，侧栏「识别」列出各图层在该点的波段像元值。

## 金字塔 / 大图

插件**不创建** overview。打开前检查旁侧同名概览（如 `*.tif.ovr`、`*.ovr`）：

- **GeoTIFF**：使用内建金字塔；旁侧 `.ovr` 会作为外部 overview
- **PNG / JPEG / BMP**：内存 GeoTIFF 全分辨率显示（外部 `.ovr` 不参与）
- **无概览且总像素 > 2500 万**：拒绝打开，提示先创建 ovr

## 工作区色表

路径：`.vscode/raster-viewer.json`

```json
{
  "colors": {
    "0": "#e6194b",
    "1": [60, 180, 75],
    "4": "#4363d8",
    "6": [255, 225, 25]
  }
}
```

## 命令

| 命令 | 说明 |
|------|------|
| `rasterViewer.openInNewView` | 在新视图中打开选中栅格 |
| `rasterViewer.addAsLayer` | 添加到已有视图（无视图则新建；多视图时选择目标） |
| `rasterViewer.newView` | 新建空视图 |

## TODO

- [ ] **添加矢量支持**（如 GeoJSON / Shapefile 等，与栅格叠置显示）
- [ ] 更多栅格格式与dtype覆盖
- [ ] 大图性能与外部 overview 体验优化

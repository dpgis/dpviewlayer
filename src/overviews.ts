import * as fs from "fs";
import * as path from "path";
import { loadGeotiff } from "./geotiffLoader";

/** Soft limit: GeoTIFF above this needs pyramid overviews. Non-TIFF is not limited. */
export const LARGE_MAX_PIXELS = 36_000_000;

export function isRasterTooLarge(width: number, height: number): boolean {
  return width * height > LARGE_MAX_PIXELS;
}

/**
 * External GDAL overviews: `file.tif.ovr`, `file.png.ovr`, etc.
 */
export function findOverviewPaths(filePath: string): string[] {
  const abs = path.resolve(filePath);
  const out: string[] = [];
  for (const cand of [`${abs}.ovr`, `${abs}.OVR`]) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) out.push(cand);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * GeoTIFF with internal SubIFD / ReducedResolution overviews (from gdaladdo -r … without .ovr).
 */
export async function hasInternalOverviews(filePath: string): Promise<boolean> {
  try {
    const { fromFile } = await loadGeotiff();
    const tiff = await fromFile(filePath);
    const n = await tiff.getImageCount();
    return n > 1;
  } catch {
    return false;
  }
}

/**
 * Gate large rasters: only GeoTIFF must have overviews when over LARGE_MAX_PIXELS.
 * PNG / JPEG / BMP are never blocked by size (OpenLayers decodes them as images).
 */
export async function assertRasterOpenable(opts: {
  width: number;
  height: number;
  format: string;
  filePath: string;
  overviewPaths?: string[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (opts.format !== "tiff") return { ok: true };
  if (!isRasterTooLarge(opts.width, opts.height)) return { ok: true };
  const external = (opts.overviewPaths?.length ? opts.overviewPaths : findOverviewPaths(opts.filePath)).length > 0;
  if (external) return { ok: true };
  if (await hasInternalOverviews(opts.filePath)) return { ok: true };
  return {
    ok: false,
    reason:
      `GeoTIFF 过大（${opts.width}×${opts.height}，超过 ${LARGE_MAX_PIXELS.toLocaleString()} 像素）且未检测到金字塔概览。` +
      `请先用 gdaladdo 生成内部或外部概览后再打开，例如：\n` +
      `gdaladdo -r average "${opts.filePath}" 2 4 8 16`,
  };
}

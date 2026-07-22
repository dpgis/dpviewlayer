import * as fs from "fs";
import * as path from "path";

/** Total pixels beyond this → need pyramid/ovr (or reject for static images). */
export const LARGE_MAX_PIXELS = 25_000_000;

export function isRasterTooLarge(width: number, height: number): boolean {
  const w = Math.max(0, width | 0);
  const h = Math.max(0, height | 0);
  if (!w || !h) return false;
  return w * h > LARGE_MAX_PIXELS;
}

/**
 * Find GDAL-style external overview files next to a raster.
 * Common patterns: `file.tif.ovr`, `file.png.ovr`, `file.ovr`.
 */
export function findOverviewPaths(imagePath: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const abs = path.resolve(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) out.push(abs);
    } catch {
      /* ignore */
    }
  };
  // GDAL default: append .ovr to full filename
  add(`${imagePath}.ovr`);
  const ext = path.extname(imagePath);
  if (ext) {
    // Also try replacing extension: name.ovr
    add(imagePath.slice(0, -ext.length) + ".ovr");
  }
  return out;
}

/** True if GeoTIFF contains reduced-resolution IFDs (internal pyramid). */
export async function hasInternalOverviews(filePath: string): Promise<boolean> {
  try {
    const { fromFile } = await import("geotiff");
    const tiff = await fromFile(filePath);
    const count = await tiff.getImageCount();
    if (count <= 1) return false;
    const first = await tiff.getImage(0);
    const fw = first.getWidth();
    const fh = first.getHeight();
    for (let i = 1; i < count; i++) {
      const img = await tiff.getImage(i);
      const fd = (img as { fileDirectory?: { NewSubfileType?: number } }).fileDirectory || {};
      const sub = Number(fd.NewSubfileType || 0);
      // bit 0 = ReducedImage
      if ((sub & 1) === 1) return true;
      if (img.getWidth() < fw || img.getHeight() < fh) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export const LARGE_RASTER_MSG = "图片太大，加载不了，创建ovr后再试";

/**
 * Allow open if small, or TIFF with external .ovr / internal overviews.
 * PNG/JPEG/BMP use ImageStatic (full decode) — external .ovr does not help.
 * Plugin never creates pyramids.
 */
export async function assertRasterOpenable(opts: {
  width: number;
  height: number;
  format: string;
  filePath: string;
  overviewPaths: string[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isRasterTooLarge(opts.width, opts.height)) return { ok: true };
  const fmt = (opts.format || "").toLowerCase();
  if (fmt === "tiff" || fmt === "tif") {
    if (opts.overviewPaths.length > 0) return { ok: true };
    if (await hasInternalOverviews(opts.filePath)) return { ok: true };
  }
  return { ok: false, reason: LARGE_RASTER_MSG };
}

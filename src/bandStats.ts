import * as fs from "fs";
import * as path from "path";
import { loadGeotiff } from "./geotiffLoader";

export type BandStat = { min: number; max: number; mean?: number; stddev?: number };

/** Parse GDAL PAM `.aux.xml` STATISTICS_* for band 1..N. */
export function readPamBandStats(rasterPath: string): BandStat[] | undefined {
  const auxPath = `${rasterPath}.aux.xml`;
  if (!fs.existsSync(auxPath)) return undefined;
  try {
    const xml = fs.readFileSync(auxPath, "utf8");
    const bands: BandStat[] = [];
    const bandRe =
      /<PAMRasterBand\b[^>]*\bband="(\d+)"[^>]*>([\s\S]*?)<\/PAMRasterBand>/gi;
    let m: RegExpExecArray | null;
    const byBand = new Map<number, BandStat>();
    while ((m = bandRe.exec(xml))) {
      const band = Number(m[1]);
      const body = m[2];
      const min = Number(
        body.match(/STATISTICS_MINIMUM["\s>]*>([^<]+)/i)?.[1] ??
          body.match(/key="STATISTICS_MINIMUM">([^<]+)/i)?.[1],
      );
      const max = Number(
        body.match(/STATISTICS_MAXIMUM["\s>]*>([^<]+)/i)?.[1] ??
          body.match(/key="STATISTICS_MAXIMUM">([^<]+)/i)?.[1],
      );
      const mean = Number(
        body.match(/STATISTICS_MEAN["\s>]*>([^<]+)/i)?.[1] ??
          body.match(/key="STATISTICS_MEAN">([^<]+)/i)?.[1],
      );
      const stddev = Number(
        body.match(/STATISTICS_STDDEV["\s>]*>([^<]+)/i)?.[1] ??
          body.match(/key="STATISTICS_STDDEV">([^<]+)/i)?.[1],
      );
      if (Number.isFinite(min) && Number.isFinite(max)) {
        byBand.set(band, {
          min,
          max,
          mean: Number.isFinite(mean) ? mean : undefined,
          stddev: Number.isFinite(stddev) ? stddev : undefined,
        });
      }
    }
    // Also handle flat MDI without wrapping when only one band
    if (!byBand.size) {
      const min = Number(xml.match(/key="STATISTICS_MINIMUM">([^<]+)/i)?.[1]);
      const max = Number(xml.match(/key="STATISTICS_MAXIMUM">([^<]+)/i)?.[1]);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        byBand.set(1, { min, max });
      }
    }
    const maxBand = Math.max(0, ...byBand.keys());
    for (let b = 1; b <= maxBand; b++) {
      const s = byBand.get(b);
      if (s) bands.push(s);
    }
    return bands.length ? bands : undefined;
  } catch {
    return undefined;
  }
}

/** Approximate min/max: prefer a mid overview, then refine with a strided full-res sample. */
export async function sampleGeoTiffBandStats(
  filePath: string,
  bandCount = 1,
  maxPixels = 2_000_000,
): Promise<BandStat[] | undefined> {
  try {
    const { fromFile } = await loadGeotiff();
    const tiff = await fromFile(filePath);
    const count = await tiff.getImageCount();
    if (count < 1) return undefined;

    const full = await tiff.getImage(0);
    const nBands = Math.max(1, bandCount || 1);
    const samples = Array.from({ length: nBands }, (_, i) => i);

    // Strided read of full-res (overview averages destroy true min/max).
    const fw = full.getWidth();
    const fh = full.getHeight();
    const target = Math.max(1, Math.floor(Math.sqrt(maxPixels)));
    const stepX = Math.max(1, Math.ceil(fw / target));
    const stepY = Math.max(1, Math.ceil(fh / target));
    const out: BandStat[] = Array.from({ length: nBands }, () => ({
      min: Infinity,
      max: -Infinity,
    }));

    for (let y0 = 0; y0 < fh; y0 += stepY * 64) {
      const y1 = Math.min(fh, y0 + stepY * 64);
      // Read a horizontal strip then stride inside it
      const data = await full.readRasters({
        window: [0, y0, fw, y1],
        samples,
        interleave: false,
      });
      const stripH = y1 - y0;
      for (let b = 0; b < nBands; b++) {
        const plane = data[b] as ArrayLike<number>;
        for (let sy = 0; sy < stripH; sy += stepY) {
          const row = sy * fw;
          for (let x = 0; x < fw; x += stepX) {
            const v = plane[row + x];
            if (!Number.isFinite(v)) continue;
            if (v < out[b].min) out[b].min = v;
            if (v > out[b].max) out[b].max = v;
          }
        }
      }
    }

    for (const s of out) {
      if (!Number.isFinite(s.min) || !Number.isFinite(s.max)) return undefined;
      if (s.max <= s.min) s.max = s.min + 1;
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Prefer PAM sidecar, then overview sample. */
export async function resolveRasterBandStats(
  filePath: string,
  opts: { bands?: number; format?: string } = {},
): Promise<BandStat[] | undefined> {
  const pam = readPamBandStats(filePath);
  if (pam?.length) return pam;
  const fmt = String(opts.format || path.extname(filePath)).toLowerCase();
  if (fmt.includes("tif")) {
    return sampleGeoTiffBandStats(filePath, opts.bands || 1);
  }
  return undefined;
}

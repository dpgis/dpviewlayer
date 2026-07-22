import * as fs from "fs";
import * as path from "path";

/** GDAL GeoTransform: X = gt0 + col*gt1 + row*gt2; Y = gt3 + col*gt4 + row*gt5 */
export type GeoTransform = [number, number, number, number, number, number];

export type GeoRef = {
  /** GDAL affine coefficients (always 6 numbers). */
  geoTransform: GeoTransform;
  /** Human-readable CRS, e.g. EPSG:4326 or Local */
  crs: string;
  /** [sx, sy, sz] — derived for OL extent helpers */
  modelPixelScale: [number, number, number];
  /** [i, j, k, x, y, z] — derived for OL extent helpers */
  modelTiepoint: [number, number, number, number, number, number];
  /** true if row increases as map Y decreases (typical north-up) */
  yFlipped: boolean;
  source: "geotiff" | "worldfile" | "identity";
};

const WORLD_EXTS: Record<string, string[]> = {
  ".tif": [".tfw", ".tifw", ".wld"],
  ".tiff": [".tfw", ".tiffw", ".wld"],
  ".png": [".pgw", ".pngw", ".wld"],
  ".jpg": [".jgw", ".jpgw", ".wld"],
  ".jpeg": [".jgw", ".jpegw", ".wld"],
  ".bmp": [".bpw", ".bmpw", ".wld"],
};

/** Default when no world file / GeoTIFF tags: 1px = 1 map unit, origin top-left. */
export const IDENTITY_GEOTRANSFORM: GeoTransform = [0, 1, 0, 0, 0, 1];

/**
 * Identity affine for coordinates (GDAL: 0,1,0,0,0,1).
 */
export function identityGeoRef(_width = 0, _height = 0): GeoRef {
  // Non-georeferenced: Local — never tag pixel coords as EPSG:3857/4326.
  return fromGeoTransform([...IDENTITY_GEOTRANSFORM], "Local", "identity");
}

export function fromGeoTransform(
  gt: GeoTransform,
  crs: string,
  source: GeoRef["source"],
): GeoRef {
  const sx = Math.abs(gt[1]) || 1;
  const sy = Math.abs(gt[5]) || Math.abs(gt[4]) || 1;
  const yFlipped = gt[5] < 0;
  const crsOut =
    source === "identity" || !crs || crs === "Local" || crs === "Unknown"
      ? "Local"
      : crs;
  return {
    geoTransform: [...gt] as GeoTransform,
    crs: crsOut,
    modelPixelScale: [sx, sy, 0],
    modelTiepoint: [0, 0, 0, gt[0], gt[3], 0],
    yFlipped,
    source,
  };
}

/** @deprecated use identityGeoRef */
export function pixelGeoRef(width: number, height: number): GeoRef {
  return identityGeoRef(width, height);
}

/**
 * ESRI world file (6 lines): A D B E C F
 * → GDAL GT = [C - A/2, A, B, F - E/2, D, E] when C/F are pixel centers.
 */
export function readWorldFile(imagePath: string): GeoRef | undefined {
  const ext = path.extname(imagePath).toLowerCase();
  const candidates = WORLD_EXTS[ext] || [".wld"];
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, ext);
  const paths: string[] = [];
  for (const w of candidates) {
    paths.push(path.join(dir, base + w));
    paths.push(path.join(dir, base + w.toUpperCase()));
  }
  paths.push(path.join(dir, base + ext[0] + "w"));
  paths.push(path.join(dir, path.basename(imagePath) + "w"));

  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    try {
      const lines = fs
        .readFileSync(p, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length < 6) continue;
      const A = Number(lines[0]);
      const D = Number(lines[1]);
      const B = Number(lines[2]);
      const E = Number(lines[3]);
      const C = Number(lines[4]);
      const F = Number(lines[5]);
      if (![A, D, B, E, C, F].every(Number.isFinite)) continue;
      // World file C,F = center of UL pixel → GDAL origin at UL corner
      const gt: GeoTransform = [C - A / 2, A, B, F - E / 2, D, E];
      return fromGeoTransform(gt, "EPSG:3857", "worldfile");
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Read embedded GeoTIFF geotransform + CRS via geotiff.js (optional). */
export async function readGeoTiffGeo(filePath: string): Promise<GeoRef | undefined> {
  try {
    const { fromArrayBuffer } = await import("geotiff");
    const buf = fs.readFileSync(filePath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const tiff = await fromArrayBuffer(ab);
    const image = await tiff.getImage();
    // geotiff typings vary by version — access tags loosely
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img = image as any;
    const fileDir = (img.fileDirectory || {}) as Record<string, unknown>;
    const scale = fileDir.ModelPixelScale as number[] | undefined;
    const tie = fileDir.ModelTiepoint as number[] | undefined;
    const trans = fileDir.ModelTransformation as number[] | undefined;

    let gt: GeoTransform | undefined;
    if (trans && trans.length >= 16) {
      // 4x4 row-major → GT approx
      gt = [trans[3], trans[0], trans[1], trans[7], trans[4], trans[5]];
    } else if (scale && scale.length >= 2 && tie && tie.length >= 6) {
      const sx = scale[0];
      const sy = -Math.abs(scale[1]); // GeoTIFF ModelPixelScale Y is usually positive; GT5 negative for north-up
      const x0 = tie[3] - tie[0] * sx;
      const y0 = tie[4] - tie[1] * sy;
      gt = [x0, sx, 0, y0, 0, sy];
    }

    if (!gt || !gt.every(Number.isFinite)) return undefined;

    let crs = "EPSG:3857";
    try {
      const geoKeys = (typeof img.getGeoKeys === "function" ? img.getGeoKeys() : null) as Record<
        string,
        unknown
      > | null;
      if (geoKeys) {
        const epsg =
          geoKeys.ProjectedCSTypeGeoKey ||
          geoKeys.GeographicTypeGeoKey ||
          geoKeys.ProjectedCRSGeoKey ||
          geoKeys.GeodeticCRSGeoKey;
        if (typeof epsg === "number" && epsg > 0 && epsg !== 32767) {
          crs = `EPSG:${epsg}`;
        } else if (typeof geoKeys.GTCitationGeoKey === "string") {
          const c = String(geoKeys.GTCitationGeoKey).trim();
          if (c) crs = c;
        } else if (typeof geoKeys.GeogCitationGeoKey === "string") {
          const c = String(geoKeys.GeogCitationGeoKey).trim();
          if (c) crs = c;
        }
      }
    } catch {
      /* ignore CRS parse */
    }

    return fromGeoTransform(gt, crs, "geotiff");
  } catch {
    return undefined;
  }
}

export function pixelToGeo(
  col: number,
  row: number,
  gt: GeoTransform,
  useCenter = true,
): { x: number; y: number } {
  const c = useCenter ? col + 0.5 : col;
  const r = useCenter ? row + 0.5 : row;
  return {
    x: gt[0] + c * gt[1] + r * gt[2],
    y: gt[3] + c * gt[4] + r * gt[5],
  };
}

export function formatGeoTransform(gt: GeoTransform): string {
  return gt.map((v) => formatAffineNum(v)).join(", ");
}

function formatAffineNum(v: number): string {
  if (!Number.isFinite(v)) return "NaN";
  if (Number.isInteger(v)) return String(v);
  const s = v.toPrecision(12).replace(/\.?0+$/, "");
  return s;
}

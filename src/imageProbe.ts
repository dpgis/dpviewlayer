import * as fs from "fs";
import * as path from "path";

export type MaskDtype =
  | "uint8"
  | "int8"
  | "uint16"
  | "int16"
  | "uint32"
  | "int32"
  | "float32"
  | "float64";

export type ImageProbeOk = {
  ok: true;
  /** mask = class/label raster; image = normal photo (RGB/RGBA) */
  kind: "mask" | "image";
  format: "png" | "jpeg" | "tiff" | "bmp";
  width: number;
  height: number;
  bands: number;
  bitDepth: 8 | 16 | 32 | 64;
  dtype: MaskDtype;
  mime: string;
  /** PNG color type when format is png */
  pngColorType?: 0 | 2 | 3 | 4 | 6;
};

export type ImageProbeFail = {
  ok: false;
  reason: string;
};

export type ImageProbeResult = ImageProbeOk | ImageProbeFail;

const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".bmp",
]);

export function isLikelyImagePath(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

/** Probe mask (single-band integer) or normal RGB/RGBA image. */
export function probeSingleBandByteImage(filePath: string): ImageProbeResult {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: "文件不存在" };
  }
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return { ok: false, reason: "无法读取文件" };
  }
  if (buf.length < 16) {
    return { ok: false, reason: "文件过小，不是有效图片" };
  }

  if (isPng(buf)) return probePng(buf);
  if (isJpeg(buf)) return probeJpeg(buf);
  if (isTiff(buf)) return probeTiff(buf);
  if (isBmp(buf)) return probeBmp(buf);

  return {
    ok: false,
    reason: "不支持的格式（仅 PNG / JPEG / TIFF / BMP）",
  };
}

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isTiff(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  const le = buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00;
  const be = buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a;
  return le || be;
}

function isBmp(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d;
}

function probePng(buf: Buffer): ImageProbeResult {
  if (buf.length < 33) return { ok: false, reason: "PNG 头不完整" };
  const len = buf.readUInt32BE(8);
  const type = buf.subarray(12, 16).toString("ascii");
  if (type !== "IHDR" || len < 13) return { ok: false, reason: "无效 PNG（缺少 IHDR）" };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];

  // Mask: gray / indexed
  if (colorType === 0 || colorType === 3) {
    if (colorType === 3 && bitDepth !== 8) {
      return { ok: false, reason: `索引色 PNG 需要 8-bit（当前 bit depth=${bitDepth}）` };
    }
    if (colorType === 0 && bitDepth !== 8 && bitDepth !== 16) {
      return { ok: false, reason: `灰度 PNG 仅支持 8/16-bit（当前 bit depth=${bitDepth}）` };
    }
    if (colorType === 3) {
      let i = 8 + 12 + len;
      let hasPlte = false;
      while (i + 12 <= buf.length) {
        const clen = buf.readUInt32BE(i);
        const ctype = buf.subarray(i + 4, i + 8).toString("ascii");
        if (ctype === "PLTE" && clen >= 3 && clen % 3 === 0) hasPlte = true;
        if (ctype === "IEND") break;
        i += 12 + clen;
      }
      if (!hasPlte) return { ok: false, reason: "索引色 PNG 缺少 PLTE 调色板" };
    }
    const depth = (bitDepth === 16 ? 16 : 8) as 8 | 16;
    return {
      ok: true,
      kind: "mask",
      format: "png",
      width,
      height,
      bands: 1,
      bitDepth: depth,
      dtype: depth === 16 ? "uint16" : "uint8",
      mime: "image/png",
      pngColorType: colorType as 0 | 3,
    };
  }

  // Normal image: RGB / RGBA / gray+alpha
  if (colorType === 2 || colorType === 6 || colorType === 4) {
    if (bitDepth !== 8) {
      return { ok: false, reason: `彩色 PNG 仅支持 8-bit（当前 bit depth=${bitDepth}）` };
    }
    const bands = colorType === 2 ? 3 : colorType === 6 ? 4 : 2;
    return {
      ok: true,
      kind: "image",
      format: "png",
      width,
      height,
      bands,
      bitDepth: 8,
      dtype: "uint8",
      mime: "image/png",
      pngColorType: colorType as 2 | 4 | 6,
    };
  }

  return {
    ok: false,
    reason: `不支持的 PNG color type=${colorType}`,
  };
}

function probeJpeg(buf: Buffer): ImageProbeResult {
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      const precision = buf[i + 4];
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      const nf = buf[i + 9];
      if (precision !== 8) {
        return { ok: false, reason: `JPEG 仅支持 8-bit（precision=${precision}）` };
      }
      if (nf === 1) {
        return {
          ok: true,
          kind: "mask",
          format: "jpeg",
          width,
          height,
          bands: 1,
          bitDepth: 8,
          dtype: "uint8",
          mime: "image/jpeg",
        };
      }
      if (nf === 3 || nf === 4) {
        return {
          ok: true,
          kind: "image",
          format: "jpeg",
          width,
          height,
          bands: nf,
          bitDepth: 8,
          dtype: "uint8",
          mime: "image/jpeg",
        };
      }
      return { ok: false, reason: `不支持的 JPEG 分量数=${nf}` };
    }
    if (marker === 0xda) break;
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) break;
    i += 2 + segLen;
  }
  return { ok: false, reason: "无法解析 JPEG 头" };
}

function probeTiff(buf: Buffer): ImageProbeResult {
  const le = buf[0] === 0x49;
  const ru16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const ru32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const ifdOffset = ru32(4);
  if (ifdOffset + 2 > buf.length) return { ok: false, reason: "无效 TIFF" };

  const numEntries = ru16(ifdOffset);
  let width = 0;
  let height = 0;
  let samplesPerPixel = 1;
  let bitsPerSample = 0;
  let sampleFormat = 1;

  for (let e = 0; e < numEntries; e++) {
    const off = ifdOffset + 2 + e * 12;
    if (off + 12 > buf.length) break;
    const tag = ru16(off);
    const type = ru16(off + 2);
    const count = ru32(off + 4);
    const valueOff = off + 8;
    const valueAsShort = () => {
      if (type === 3 && count === 1) return ru16(valueOff);
      if (type === 3 && count > 1) {
        const ptr = ru32(valueOff);
        if (ptr + 2 <= buf.length) return ru16(ptr);
      }
      if (type === 4 && count === 1) return ru32(valueOff);
      return ru16(valueOff);
    };

    if (tag === 256) width = valueAsShort();
    if (tag === 257) height = valueAsShort();
    if (tag === 277) samplesPerPixel = valueAsShort();
    if (tag === 258) {
      if (count === 1) {
        bitsPerSample = valueAsShort();
      } else {
        const ptr = type === 3 && count > 2 ? ru32(valueOff) : valueOff;
        bitsPerSample = ru16(ptr);
        for (let c = 1; c < count; c++) {
          if (ru16(ptr + c * 2) !== bitsPerSample) {
            return { ok: false, reason: "TIFF 各波段位深不一致" };
          }
        }
      }
    }
    if (tag === 339) sampleFormat = valueAsShort();
  }

  if (!width || !height) return { ok: false, reason: "无法读取 TIFF 宽高" };

  if (![8, 16, 32, 64].includes(bitsPerSample)) {
    return {
      ok: false,
      reason: `不支持的位深（TIFF BitsPerSample=${bitsPerSample}，需要 8/16/32/64）`,
    };
  }
  if (![1, 2, 3].includes(sampleFormat)) {
    return {
      ok: false,
      reason: `不支持的 SampleFormat=${sampleFormat}（需要 uint=1、int=2 或 float=3）`,
    };
  }
  if (sampleFormat === 3 && bitsPerSample !== 32 && bitsPerSample !== 64) {
    return {
      ok: false,
      reason: `浮点 TIFF 仅支持 32/64-bit（当前 BitsPerSample=${bitsPerSample}）`,
    };
  }
  if (sampleFormat !== 3 && bitsPerSample === 64) {
    return {
      ok: false,
      reason: `整型 TIFF 不支持 64-bit（BitsPerSample=${bitsPerSample}）`,
    };
  }

  const depth = bitsPerSample as 8 | 16 | 32 | 64;
  let dtype: MaskDtype;
  if (sampleFormat === 3) {
    dtype = depth === 64 ? "float64" : "float32";
  } else {
    const signed = sampleFormat === 2;
    if (depth === 8) dtype = signed ? "int8" : "uint8";
    else if (depth === 16) dtype = signed ? "int16" : "uint16";
    else dtype = signed ? "int32" : "uint32";
  }

  // Multi-band → image (OpenLayers GeoTIFF URL / RGB style)
  if (samplesPerPixel >= 2) {
    return {
      ok: true,
      kind: "image",
      format: "tiff",
      width,
      height,
      bands: samplesPerPixel,
      bitDepth: depth === 64 ? 64 : (depth as 8 | 16 | 32),
      dtype,
      mime: "image/tiff",
    };
  }

  return {
    ok: true,
    kind: "mask",
    format: "tiff",
    width,
    height,
    bands: 1,
    bitDepth: depth === 64 ? 64 : (depth as 8 | 16 | 32),
    dtype,
    mime: "image/tiff",
  };
}

function probeBmp(buf: Buffer): ImageProbeResult {
  if (buf.length < 34) return { ok: false, reason: "BMP 头不完整" };
  const dibSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  const height = Math.abs(buf.readInt32LE(22));
  const planes = buf.readUInt16LE(26);
  const bitCount = buf.readUInt16LE(28);
  if (planes !== 1) {
    return { ok: false, reason: `无效 BMP（planes=${planes}）` };
  }
  if (dibSize < 40) return { ok: false, reason: "不支持的 BMP DIB 头" };

  if (bitCount === 8) {
    return {
      ok: true,
      kind: "mask",
      format: "bmp",
      width,
      height,
      bands: 1,
      bitDepth: 8,
      dtype: "uint8",
      mime: "image/bmp",
    };
  }
  if (bitCount === 24 || bitCount === 32) {
    return {
      ok: true,
      kind: "image",
      format: "bmp",
      width,
      height,
      bands: bitCount === 24 ? 3 : 4,
      bitDepth: 8,
      dtype: "uint8",
      mime: "image/bmp",
    };
  }
  return {
    ok: false,
    reason: `不支持的 BMP bitCount=${bitCount}`,
  };
}

export function formatProbeSummary(r: ImageProbeOk): string {
  if (r.kind === "image") {
    const ch = r.bands === 4 ? "RGBA" : r.bands === 3 ? "RGB" : `${r.bands}ch`;
    return `${r.format.toUpperCase()} ${r.width}×${r.height} · ${ch}`;
  }
  return `${r.format.toUpperCase()} ${r.width}×${r.height} · 1×${r.dtype}`;
}

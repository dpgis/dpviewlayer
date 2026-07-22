import * as fs from "fs";
import * as zlib from "zlib";
import * as UTIF from "utif2";

export type MaskDtype =
  | "uint8"
  | "int8"
  | "uint16"
  | "int16"
  | "uint32"
  | "int32"
  | "float32"
  | "float64";

export type MaskDecodeResult = {
  width: number;
  height: number;
  /** Per-pixel values (class ids or continuous). */
  values: Float64Array;
  dtype: MaskDtype;
};

function dtypeOf(bits: number, signed: boolean, floating: boolean): MaskDtype {
  if (floating) {
    if (bits === 32) return "float32";
    if (bits === 64) return "float64";
    throw new Error(`不支持的浮点位深 bits=${bits}`);
  }
  if (bits === 8) return signed ? "int8" : "uint8";
  if (bits === 16) return signed ? "int16" : "uint16";
  if (bits === 32) return signed ? "int32" : "uint32";
  throw new Error(`不支持的位深 bits=${bits}`);
}

function tagNum(t: Record<string, unknown>, name: string, fallback = 0): number {
  const v = t[name];
  if (Array.isArray(v) && v.length) return Number(v[0]);
  if (typeof v === "number") return v;
  return fallback;
}

/** Decode single-band TIFF (uint/int/float 8/16/32/64) via utif2. */
export function decodeTiffMask(filePath: string): MaskDecodeResult {
  const buf = fs.readFileSync(filePath);
  const le = buf[0] === 0x49 && buf[1] === 0x49;
  if (!(le || (buf[0] === 0x4d && buf[1] === 0x4d))) {
    throw new Error("不是有效 TIFF");
  }

  const ifds = UTIF.decode(buf) as Array<Record<string, unknown> & { width?: number; height?: number; data?: Uint8Array }>;
  if (!ifds.length) throw new Error("TIFF 无图像目录");
  const ifd = ifds[0];
  UTIF.decodeImage(buf, ifd);

  const width = ifd.width || tagNum(ifd, "t256");
  const height = ifd.height || tagNum(ifd, "t257");
  const bits = tagNum(ifd, "t258", 8);
  const samples = tagNum(ifd, "t277", 1);
  const sampleFormat = tagNum(ifd, "t339", 1); // 1=uint, 2=int, 3=float
  const raw = ifd.data;

  if (!width || !height) throw new Error("无法读取 TIFF 宽高");
  if (samples !== 1) throw new Error(`不是单波段 TIFF（SamplesPerPixel=${samples}）`);
  if (![1, 2, 3].includes(sampleFormat)) {
    throw new Error(`不支持的 SampleFormat=${sampleFormat}（需要 1=uint、2=int 或 3=float）`);
  }
  const floating = sampleFormat === 3;
  if (floating && bits !== 32 && bits !== 64) {
    throw new Error(`浮点 TIFF 仅支持 32/64-bit（当前 BitsPerSample=${bits}）`);
  }
  if (!floating && ![8, 16, 32].includes(bits)) {
    throw new Error(`不支持的 TIFF 位深 BitsPerSample=${bits}（需要 8/16/32）`);
  }
  if (!raw) throw new Error("TIFF 像素解码失败");

  const signed = sampleFormat === 2;
  const dtype = dtypeOf(bits, signed, floating);
  const n = width * height;
  const values = new Float64Array(n);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bytes = bits / 8;
  if (raw.byteLength < n * bytes) {
    throw new Error("TIFF 像素数据长度不足");
  }

  for (let i = 0; i < n; i++) {
    const o = i * bytes;
    if (floating) {
      values[i] = bits === 64 ? dv.getFloat64(o, le) : dv.getFloat32(o, le);
    } else if (bits === 8) {
      values[i] = signed ? dv.getInt8(o) : dv.getUint8(o);
    } else if (bits === 16) {
      values[i] = signed ? dv.getInt16(o, le) : dv.getUint16(o, le);
    } else {
      values[i] = signed ? dv.getInt32(o, le) : dv.getUint32(o, le);
    }
  }

  return { width, height, values, dtype };
}

/** Decode PNG gray (8/16) or indexed (8) to per-pixel values. */
export function decodePngMask(filePath: string): MaskDecodeResult {
  const buf = fs.readFileSync(filePath);
  return decodePngMaskBuffer(buf);
}

export function decodePngMaskBuffer(buf: Buffer): MaskDecodeResult {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) throw new Error("不是有效 PNG");

  const chunks: { type: string; data: Buffer }[] = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    const data = buf.subarray(i + 8, i + 8 + len);
    chunks.push({ type, data: Buffer.from(data) });
    i += 12 + len;
    if (type === "IEND") break;
  }

  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) throw new Error("缺少 IHDR");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];

  if (colorType !== 0 && colorType !== 3) {
    throw new Error(`需要灰度或索引色 PNG（type 0/3），当前 type=${colorType}`);
  }
  if (colorType === 3 && bitDepth !== 8) {
    throw new Error(`索引色 PNG 仅支持 8-bit，当前 bit depth=${bitDepth}`);
  }
  if (colorType === 0 && bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`灰度 PNG 仅支持 8/16-bit，当前 bit depth=${bitDepth}`);
  }

  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const inflated = zlib.inflateSync(idat);
  const bpp = bitDepth === 16 ? 2 : 1;
  const stride = width * bpp;
  const expected = height * (1 + stride);
  if (inflated.length < expected) throw new Error("PNG 像素数据不完整");

  const n = width * height;
  const values = new Float64Array(n);
  let src = 0;
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const out = new Uint8Array(stride);

    for (let x = 0; x < stride; x++) {
      const raw = row[x];
      const left = x >= bpp ? out[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let val = 0;
      switch (filter) {
        case 0:
          val = raw;
          break;
        case 1:
          val = (raw + left) & 255;
          break;
        case 2:
          val = (raw + up) & 255;
          break;
        case 3:
          val = (raw + Math.floor((left + up) / 2)) & 255;
          break;
        case 4:
          val = (raw + paeth(left, up, upLeft)) & 255;
          break;
        default:
          throw new Error(`不支持的 PNG filter=${filter}`);
      }
      out[x] = val;
    }

    if (bitDepth === 8) {
      for (let x = 0; x < width; x++) values[y * width + x] = out[x];
    } else {
      for (let x = 0; x < width; x++) {
        const o = x * 2;
        values[y * width + x] = (out[o] << 8) | out[o + 1];
      }
    }
    prev = out;
  }

  return {
    width,
    height,
    values,
    dtype: bitDepth === 16 ? "uint16" : "uint8",
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode BMP 8-bit indexed/gray as uint8 values. */
export function decodeBmpMask(filePath: string): MaskDecodeResult {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error("不是有效 BMP");
  const dataOff = buf.readUInt32LE(10);
  const dib = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const height = Math.abs(heightRaw);
  const bottomUp = heightRaw > 0;
  const bitCount = buf.readUInt16LE(28);
  if (bitCount !== 8) throw new Error(`BMP 仅支持 8-bit，当前 ${bitCount}`);
  if (dib < 40) throw new Error("不支持的 BMP DIB");

  const rowSize = Math.floor((bitCount * width + 31) / 32) * 4;
  const values = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const srcY = bottomUp ? height - 1 - y : y;
    const rowOff = dataOff + srcY * rowSize;
    for (let x = 0; x < width; x++) {
      values[y * width + x] = buf[rowOff + x];
    }
  }
  return { width, height, values, dtype: "uint8" };
}

export type RgbaDecodeResult = {
  width: number;
  height: number;
  /** RGBA8888 row-major */
  rgba: Uint8Array;
};

/** Decode RGB/RGBA TIFF to RGBA8888 via utif2. */
export function decodeTiffRgba(filePath: string): RgbaDecodeResult {
  const buf = fs.readFileSync(filePath);
  const ifds = UTIF.decode(buf) as Array<
    Record<string, unknown> & { width?: number; height?: number; data?: Uint8Array }
  >;
  if (!ifds.length) throw new Error("TIFF 无图像目录");
  const ifd = ifds[0];
  UTIF.decodeImage(buf, ifd);
  const width = ifd.width || tagNum(ifd, "t256");
  const height = ifd.height || tagNum(ifd, "t257");
  const samples = tagNum(ifd, "t277", 3);
  const raw = ifd.data;
  if (!width || !height || !raw) throw new Error("TIFF 彩色图解码失败");

  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  if (raw.length >= n * 4) {
    rgba.set(raw.subarray(0, n * 4));
  } else if (raw.length >= n * 3) {
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      rgba[i * 4] = raw[p];
      rgba[i * 4 + 1] = raw[p + 1];
      rgba[i * 4 + 2] = raw[p + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    throw new Error(`TIFF 彩色像素长度不足（samples=${samples}, bytes=${raw.length}）`);
  }
  return { width, height, rgba };
}

export function rgbaToBase64(rgba: Uint8Array): string {
  return Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).toString("base64");
}

export function valuesToBase64(values: Float64Array): string {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64");
}

/** Pack class values as Int32 LE for compact webview transfer. */
export function valuesToInt32Base64(values: Float64Array): string {
  const i32 = new Int32Array(values.length);
  for (let i = 0; i < values.length; i++) i32[i] = values[i] | 0;
  return Buffer.from(i32.buffer).toString("base64");
}

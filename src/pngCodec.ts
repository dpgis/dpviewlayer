import * as fs from "fs";
import * as zlib from "zlib";

export type Rgb = [number, number, number];

export type PngIndexDecode = {
  width: number;
  height: number;
  /** One byte per pixel: gray value or palette index (class id) */
  indices: Uint8Array;
  colorType: 0 | 3;
  bitDepth: 8;
};

type Chunk = { type: string; data: Buffer };

function readChunks(buf: Buffer): Chunk[] {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) {
    throw new Error("不是有效 PNG");
  }
  const chunks: Chunk[] = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    const data = buf.subarray(i + 8, i + 8 + len);
    chunks.push({ type, data: Buffer.from(data) });
    i += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Decode 8-bit grayscale (type 0) or indexed (type 3) PNG to per-pixel indices. */
export function decodePngIndices(filePath: string): PngIndexDecode {
  const buf = fs.readFileSync(filePath);
  return decodePngIndicesBuffer(buf);
}

export function decodePngIndicesBuffer(buf: Buffer): PngIndexDecode {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) throw new Error("缺少 IHDR");

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  if (bitDepth !== 8) throw new Error(`需要 8-bit PNG，当前 bit depth=${bitDepth}`);
  if (colorType !== 0 && colorType !== 3) {
    throw new Error(`需要灰度或索引色 PNG（type 0/3），当前 type=${colorType}`);
  }

  const plte = chunks.find((c) => c.type === "PLTE");
  if (colorType === 3) {
    if (!plte || plte.data.length < 3 || plte.data.length % 3 !== 0) {
      throw new Error("索引色 PNG 缺少有效 PLTE");
    }
    // PLTE colors are ignored for viewing — only indices matter
  }

  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const inflated = zlib.inflateSync(idat);
  const stride = width; // 8-bit, 1 sample
  const expected = height * (1 + stride);
  if (inflated.length < expected) {
    throw new Error("PNG 像素数据不完整");
  }

  const indices = new Uint8Array(width * height);
  let src = 0;
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const out = new Uint8Array(stride);

    for (let x = 0; x < stride; x++) {
      const raw = row[x];
      const left = x > 0 ? out[x - 1] : 0;
      const up = prev[x];
      const upLeft = x > 0 ? prev[x - 1] : 0;
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
      indices[y * width + x] = val;
    }
    prev = out;
  }

  return {
    width,
    height,
    indices,
    colorType: colorType as 0 | 3,
    bitDepth: 8,
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

/** Encode indices as 8-bit grayscale PNG (for webview fallback / export). */
export function encodeGrayPng(width: number, height: number, indices: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // gray
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0; // filter None
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (1 + width) + 1);
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Save-as indexed PNG: pixel bytes unchanged (class ids), PLTE from colormap.
 * Missing colors default to black.
 */
export function encodeIndexedPng(
  width: number,
  height: number,
  indices: Uint8Array,
  colormap: Record<number, Rgb>,
): Buffer {
  if (indices.length !== width * height) {
    throw new Error("indices 长度与宽高不匹配");
  }
  let maxId = 0;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] > maxId) maxId = indices[i];
  }
  for (const k of Object.keys(colormap)) {
    const id = Number(k);
    if (Number.isFinite(id) && id > maxId) maxId = id;
  }
  const palSize = Math.min(256, Math.max(maxId + 1, 1));
  const plteData = Buffer.alloc(palSize * 3);
  for (let i = 0; i < palSize; i++) {
    const rgb = colormap[i] ?? ([0, 0, 0] as Rgb);
    plteData[i * 3] = rgb[0];
    plteData[i * 3 + 1] = rgb[1];
    plteData[i * 3 + 2] = rgb[2];
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3; // indexed
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0;
    for (let x = 0; x < width; x++) {
      const v = indices[y * width + x];
      raw[y * (1 + width) + 1 + x] = v < palSize ? v : 0;
    }
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("PLTE", plteData),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

export type ColormapFile = {
  /** value -> #rrggbb or [r,g,b] */
  colors: Record<string, string | number[]>;
  labels?: Record<string, string>;
};

export function loadColormapFile(filePath: string): Record<number, Rgb> {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ColormapFile | Record<string, string | number[]>;
  const colors = "colors" in raw && raw.colors ? raw.colors : (raw as Record<string, string | number[]>);
  const out: Record<number, Rgb> = {};
  for (const [k, v] of Object.entries(colors)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    const rgb = parseColor(v);
    if (rgb) out[id] = rgb;
  }
  return out;
}

export function saveColormapFile(filePath: string, map: Record<number, Rgb>) {
  const colors: Record<string, string> = {};
  for (const [k, rgb] of Object.entries(map)) {
    colors[k] = rgbToHex(rgb as Rgb);
  }
  const body: ColormapFile = { colors };
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2) + "\n", "utf8");
}

export function parseColor(v: string | number[]): Rgb | undefined {
  if (Array.isArray(v) && v.length >= 3) {
    return [clampByte(v[0]), clampByte(v[1]), clampByte(v[2])];
  }
  if (typeof v === "string") {
    const s = v.trim();
    const m = s.match(/^#?([0-9a-fA-F]{6})$/);
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m3 = s.match(/^#?([0-9a-fA-F]{3})$/);
    if (m3) {
      const a = m3[1];
      return [
        parseInt(a[0] + a[0], 16),
        parseInt(a[1] + a[1], 16),
        parseInt(a[2] + a[2], 16),
      ];
    }
  }
  return undefined;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => clampByte(x).toString(16).padStart(2, "0"))
      .join("")
  );
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
}

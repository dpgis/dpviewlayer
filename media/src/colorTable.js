/** Color-table ranges: each row is half-open [min, max) i.e. >= min && < max.
 *  Row ID is never stored — it is always the array index (0…N-1).
 */

export const COLOR_TABLE_MAX = 256;

/**
 * @typedef {{ min: number, max: number, color: string }} ColorTableEntry
 */

/** Strip to persistable fields only (no id / label). */
export function serializeColorTable(table) {
  const rows = Array.isArray(table) ? table.slice(0, COLOR_TABLE_MAX) : [];
  const out = [];
  for (const e of rows) {
    const min = Number(e?.min);
    const max = Number(e?.max);
    const color = String(e?.color || "").trim();
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min) || !color) continue;
    out.push({ min, max, color });
  }
  return out;
}

/** Parse saved array (or ignore junk). ID = position. */
export function parseColorTable(raw) {
  if (!Array.isArray(raw)) return [];
  return serializeColorTable(raw);
}

/** Half-open [min, max) overlap test. */
export function rangesOverlap(a, b) {
  const a0 = Number(a?.min);
  const a1 = Number(a?.max);
  const b0 = Number(b?.min);
  const b1 = Number(b?.max);
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false;
  if (!(a1 > a0) || !(b1 > b0)) return false;
  return a0 < b1 && b0 < a1;
}

/**
 * True if [min,max) intersects any row except excludeIndex.
 * @param {Array<{min:number,max:number}>} table
 * @param {number} min
 * @param {number} max
 * @param {number} [excludeIndex]
 */
export function colorTableRangeConflicts(table, min, max, excludeIndex = -1) {
  const probe = { min: Number(min), max: Number(max) };
  if (!Number.isFinite(probe.min) || !Number.isFinite(probe.max) || !(probe.max > probe.min)) {
    return true;
  }
  const rows = Array.isArray(table) ? table : [];
  for (let i = 0; i < rows.length; i++) {
    if (i === excludeIndex) continue;
    if (rangesOverlap(probe, rows[i])) return true;
  }
  return false;
}

/**
 * Suggest a non-overlapping [min,max) for inserting at insertAt (before current row insertAt).
 * Returns null if there is no free gap.
 */
export function suggestInsertRange(table, insertAt) {
  const rows = Array.isArray(table) ? table : [];
  const at = Math.max(0, Math.min(rows.length, Number(insertAt) || 0));
  const prev = at > 0 ? rows[at - 1] : null;
  const next = at < rows.length ? rows[at] : null;

  if (!prev && !next) return { min: 0, max: 1 };

  if (!prev) {
    const hi = Number(next.min);
    if (!Number.isFinite(hi)) return null;
    const lo = Number.isInteger(hi) ? hi - 1 : hi - Math.max(Math.abs(hi) * 1e-6, 1e-6);
    if (!(hi > lo)) return null;
    if (colorTableRangeConflicts(rows, lo, hi)) return null;
    return { min: lo, max: hi };
  }

  if (!next) {
    const lo = Number(prev.max);
    if (!Number.isFinite(lo)) return null;
    const hi = Number.isInteger(lo) ? lo + 1 : lo + Math.max(Math.abs(lo) * 1e-6, 1);
    if (colorTableRangeConflicts(rows, lo, hi)) return null;
    return { min: lo, max: hi };
  }

  const lo = Number(prev.max);
  const hi = Number(next.min);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;
  // Prefer a unit step inside the gap when possible.
  let max = hi;
  if (Number.isInteger(lo) && hi >= lo + 1) max = lo + 1;
  else if (hi > lo) max = Math.min(hi, lo + Math.max((hi - lo) / 2, Number.EPSILON));
  if (!(max > lo) || colorTableRangeConflicts(rows, lo, max)) return null;
  return { min: lo, max };
}

/** True for integer-like dtypes / stats (byte, int, …). */
export function isIntegerLikeBand(dtype, stats, plane) {
  const dt = String(dtype || "").toLowerCase();
  if (
    /^(u?int\d*|byte|uint8|int8|uint16|int16|uint32|int32|int64|uint64)$/.test(dt) ||
    dt.includes("int") ||
    dt === "byte"
  ) {
    return true;
  }
  if (stats && Number.isFinite(stats.min) && Number.isFinite(stats.max)) {
    if (Number.isInteger(stats.min) && Number.isInteger(stats.max)) return true;
  }
  if (plane?.length) {
    let seen = 0;
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (!Number.isFinite(v)) continue;
      if (!Number.isInteger(v)) return false;
      if (++seen >= 64) return true;
    }
    return seen > 0;
  }
  return false;
}

/** Resolve data min/max from stats and/or plane. */
export function resolveBandMinMax(stats, plane) {
  let lo = Number(stats?.min);
  let hi = Number(stats?.max);
  if (plane?.length) {
    let pLo = Infinity;
    let pHi = -Infinity;
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (!Number.isFinite(v)) continue;
      if (v < pLo) pLo = v;
      if (v > pHi) pHi = v;
    }
    if (Number.isFinite(pLo) && Number.isFinite(pHi)) {
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        lo = pLo;
        hi = pHi;
      } else {
        lo = Math.min(lo, pLo);
        hi = Math.max(hi, pHi);
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 255 };
  if (hi < lo) return { min: hi, max: lo };
  if (hi === lo) return { min: lo, max: lo + 1 };
  return { min: lo, max: hi };
}

/**
 * Build half-open ranges for color-table classify.
 * Integer + (max-min+1) <= 256 → one bin per value (>=v <v+1).
 * Else → 256 equal bins over [min, max].
 * @returns {{ min: number, max: number }[]}
 */
export function buildColorTableBreaks(min, max, integerLike) {
  const lo0 = Number(min);
  const hi0 = Number(max);
  const lo = Number.isFinite(lo0) ? lo0 : 0;
  let hi = Number.isFinite(hi0) ? hi0 : lo + 1;
  if (hi <= lo) hi = lo + 1;

  if (integerLike) {
    const iLo = Math.trunc(lo);
    const iHi = Math.trunc(hi);
    const count = iHi - iLo + 1;
    if (count >= 1 && count <= COLOR_TABLE_MAX) {
      const out = [];
      for (let v = iLo; v <= iHi; v++) {
        out.push({ min: v, max: v + 1 });
      }
      return out;
    }
  }

  const n = COLOR_TABLE_MAX;
  const span = hi - lo;
  const step = span / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lo + i * step;
    // Last bin extends a hair past hi so value === hi still matches < max.
    const b = i === n - 1 ? hi + Math.abs(span || 1) * 1e-12 : lo + (i + 1) * step;
    out.push({ min: a, max: b });
  }
  return out;
}

/** Legacy `{ id: hex }` → unit ranges `[id, id+1)` (order by numeric key). */
export function colorTableFromLegacyMap(colormap, _labels = {}) {
  if (!colormap || typeof colormap !== "object") return [];
  const ids = Object.keys(colormap)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .slice(0, COLOR_TABLE_MAX);
  return ids.map((id) => {
    const hex = colormap[id] ?? colormap[String(id)] ?? "#808080";
    return {
      min: id,
      max: id + 1,
      color: String(hex),
    };
  });
}

/**
 * Derive PLTE / legacy map at export time only: array index → hex.
 * Does not mean rows store an id field.
 */
export function legacyMapFromColorTable(table) {
  const out = {};
  const rows = serializeColorTable(table);
  for (let i = 0; i < rows.length; i++) {
    out[i] = rows[i].color;
  }
  return out;
}

export function formatBreak(v) {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  const s = v.toPrecision(8);
  return String(Number(s));
}

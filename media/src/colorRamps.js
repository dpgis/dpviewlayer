/** QGIS-like continuous color ramps (stop colors as #rrggbb). */

export const CONTINUOUS_RAMPS = {
  blues: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  cividis: ["#00224e", "#123570", "#3b496c", "#575d6d", "#7f7c70", "#a59c74", "#cfc98a", "#ffe945"],
  greens: ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"],
  greys: ["#ffffff", "#d9d9d9", "#969696", "#525252", "#000000"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  mako: ["#0b0405", "#382a54", "#417d8b", "#62c6a7", "#def5e5"],
  rdgy: ["#67001f", "#d6604d", "#f7f7f7", "#878787", "#1a1a1a"],
  reds: ["#fff5f0", "#fcbba1", "#fb6a4a", "#cb181d", "#67000d"],
  rocket: ["#03051a", "#4a0d3c", "#a11a4d", "#e45a31", "#f6d746", "#fafdfe"],
  spectral: ["#9e0142", "#f46d43", "#fee08b", "#abdda4", "#3288bd", "#5e4fa2"],
  turbo: ["#30123b", "#4662d7", "#1ae4b6", "#a2fc3c", "#faba39", "#e4460a", "#7a0403"],
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
};

export const RAMP_OPTIONS = [
  { id: "random", label: "Random colors", continuous: false },
  { id: "blues", label: "Blues", continuous: true },
  { id: "cividis", label: "Cividis", continuous: true },
  { id: "greens", label: "Greens", continuous: true },
  { id: "greys", label: "Greys", continuous: true },
  { id: "magma", label: "Magma", continuous: true },
  { id: "mako", label: "Mako", continuous: true },
  { id: "rdgy", label: "RdGy", continuous: true },
  { id: "reds", label: "Reds", continuous: true },
  { id: "rocket", label: "Rocket", continuous: true },
  { id: "spectral", label: "Spectral", continuous: true },
  { id: "turbo", label: "Turbo", continuous: true },
  { id: "viridis", label: "Viridis", continuous: true },
];

function parseHex(hex) {
  const m = String(hex)
    .trim()
    .match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Sample a continuous ramp at t in [0,1]. */
export function sampleRamp(rampId, t, invert = false) {
  const stops = CONTINUOUS_RAMPS[rampId];
  if (!stops || !stops.length) return "#808080";
  let u = Math.max(0, Math.min(1, Number(t) || 0));
  if (invert) u = 1 - u;
  if (stops.length === 1) return stops[0];
  const x = u * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= stops.length - 1) return stops[stops.length - 1];
  const a = parseHex(stops[i]);
  const b = parseHex(stops[i + 1]);
  return toHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}

/** Assign colors to sorted class ids from a ramp (or random). */
export function colorsForClasses(ids, rampId, { invert = false, seed = 1 } = {}) {
  const out = {};
  const n = ids.length;
  if (!n) return out;
  if (rampId === "random") {
    let x = (Math.abs(seed) >>> 0) || 1;
    const rnd = () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x;
    };
    const colors = ids.map(() => {
      const r = rnd() & 255;
      const g = rnd() & 255;
      const b = 64 + (rnd() % 192);
      return toHex(r, g, b);
    });
    if (invert) colors.reverse();
    ids.forEach((id, i) => {
      out[id] = colors[i];
    });
    return out;
  }
  ids.forEach((id, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    out[id] = sampleRamp(rampId, t, invert);
  });
  return out;
}

/** Stops for OpenLayers interpolate: [v0, color0, v1, color1, ...] over [min,max]. */
export function interpolateStops(rampId, min, max, invert = false) {
  const stops = CONTINUOUS_RAMPS[rampId];
  if (!stops || !stops.length) {
    return [min, "#000000", max, "#ffffff"];
  }
  const lo = Number(min);
  const hi = Number(max);
  const span = hi - lo || 1;
  const seq = invert ? [...stops].reverse() : stops;
  const out = [];
  for (let i = 0; i < seq.length; i++) {
    const t = seq.length === 1 ? 0 : i / (seq.length - 1);
    out.push(lo + span * t, seq[i]);
  }
  return out;
}

/** Approximate percentile on a numeric plane (finite values only). */
export function percentile(plane, p) {
  const vals = [];
  for (let i = 0; i < plane.length; i++) {
    const v = plane[i];
    if (Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return NaN;
  vals.sort((a, b) => a - b);
  const pct = Math.max(0, Math.min(100, p));
  const idx = ((vals.length - 1) * pct) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return vals[lo];
  const f = idx - lo;
  return vals[lo] * (1 - f) + vals[hi] * f;
}

export function meanStd(plane) {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < plane.length; i++) {
    const v = plane[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  if (!n) return { mean: 0, std: 1 };
  const mean = sum / n;
  let acc = 0;
  for (let i = 0; i < plane.length; i++) {
    const v = plane[i];
    if (!Number.isFinite(v)) continue;
    const d = v - mean;
    acc += d * d;
  }
  return { mean, std: Math.sqrt(acc / n) || 1 };
}

/**
 * True when stats look like 8-bit display data (JPG/PNG/byte mask).
 * Float / uint16 / scientific rasters must not fall back to 0..255.
 */
export function isByteLikeStats(stats) {
  if (!stats) return false;
  const lo = Number(stats.min);
  const hi = Number(stats.max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  if (lo < 0 || hi > 255) return false;
  // Float in 0..1 or continuous fractional range → not byte display
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false;
  return true;
}

function resolveStats(plane, stats) {
  if (stats && Number.isFinite(stats.min) && Number.isFinite(stats.max)) {
    return {
      min: stats.min,
      max: stats.max === stats.min ? stats.min + 1 : stats.max,
      mean: stats.mean,
      stddev: stats.stddev,
    };
  }
  if (plane?.length) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max: max <= min ? min + 1 : max };
    }
  }
  return { min: 0, max: 255 };
}

/**
 * Compute stretch min/max for a plane.
 * mode: none|minmax|percent|stddev
 *
 * "none" (无增强): byte-like → 0..255; otherwise use data stats (not 0..255).
 * Native GeoTIFF often has PAM stats only (no in-memory plane) — percent/stddev
 * still work via min/max span or STATISTICS_MEAN/STDDEV.
 */
export function stretchRange(plane, stats, mode, { percent = 2, stddev = 2 } = {}) {
  const s = resolveStats(plane, stats);
  if (mode === "none") {
    if (isByteLikeStats(s)) return { min: 0, max: 255 };
    return { min: s.min, max: s.max };
  }
  if (mode === "percent") {
    const p = Math.max(0, Math.min(49.9, Number(percent) || 2));
    if (plane?.length) {
      const lo = percentile(plane, p);
      const hi = percentile(plane, 100 - p);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
        return { min: s.min, max: s.max === s.min ? s.min + 1 : s.max };
      }
      return { min: lo, max: hi };
    }
    // No plane: approximate cumulative cut from min/max (PAM / host stats).
    const span = s.max - s.min;
    if (!(span > 0)) return { min: s.min, max: s.max === s.min ? s.min + 1 : s.max };
    return { min: s.min + span * (p / 100), max: s.max - span * (p / 100) };
  }
  if (mode === "stddev") {
    const n = Math.max(0.1, Number(stddev) || 2);
    let mean;
    let std;
    if (plane?.length) {
      ({ mean, std } = meanStd(plane));
    } else if (Number.isFinite(s.mean) && Number.isFinite(s.stddev) && s.stddev > 0) {
      mean = s.mean;
      std = s.stddev;
    } else {
      mean = (s.min + s.max) / 2;
      std = Math.max((s.max - s.min) / 4, 1e-9);
    }
    return { min: mean - n * std, max: mean + n * std };
  }
  // minmax
  return { min: s.min, max: s.max === s.min ? s.min + 1 : s.max };
}

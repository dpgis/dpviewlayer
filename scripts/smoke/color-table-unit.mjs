#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const out = path.join(__dirname, "color-table-unit.bundle.mjs");
const esbuild = path.join(root, "node_modules/.bin/esbuild");
const r = spawnSync(
  esbuild,
  [
    path.join(root, "media/src/colorTable.js"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${out}`,
  ],
  { encoding: "utf8" },
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

const {
  COLOR_TABLE_MAX,
  buildColorTableBreaks,
  isIntegerLikeBand,
  colorTableFromLegacyMap,
  rangesOverlap,
  colorTableRangeConflicts,
  suggestInsertRange,
} = await import(out);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(COLOR_TABLE_MAX === 256, "max 256");

const unit = buildColorTableBreaks(0, 5, true);
assert(unit.length === 6, `unit bins got ${unit.length}`);
assert(unit[0].min === 0 && unit[0].max === 1, JSON.stringify(unit[0]));
assert(unit[5].min === 5 && unit[5].max === 6, JSON.stringify(unit[5]));

const wideInt = buildColorTableBreaks(0, 1000, true);
assert(wideInt.length === 256, `wide int → 256 got ${wideInt.length}`);

const flt = buildColorTableBreaks(4.38, 12389, false);
assert(flt.length === 256, `float → 256 got ${flt.length}`);
assert(Math.abs(flt[0].min - 4.38) < 1e-6, "float start");
assert(flt[255].max > 12389, "float last covers max");

assert(isIntegerLikeBand("uint8", { min: 0, max: 10 }, null), "uint8");
assert(!isIntegerLikeBand("float32", { min: 0.1, max: 9.9 }, null), "float32");

const legacy = colorTableFromLegacyMap({ 2: "#ff0000", 4: "#00ff00" }, { 2: "a" });
assert(legacy.length === 2 && legacy[0].min === 2 && legacy[0].max === 3, JSON.stringify(legacy));

assert(rangesOverlap({ min: 0, max: 2 }, { min: 1, max: 3 }), "overlap mid");
assert(!rangesOverlap({ min: 0, max: 1 }, { min: 1, max: 2 }), "touching half-open ok");
assert(colorTableRangeConflicts([{ min: 0, max: 1 }, { min: 2, max: 3 }], 0.5, 2.5), "conflict");
assert(!colorTableRangeConflicts([{ min: 0, max: 1 }, { min: 2, max: 3 }], 1, 2), "gap ok");

const packed = [
  { min: 0, max: 1, color: "#000" },
  { min: 1, max: 2, color: "#111" },
];
assert(suggestInsertRange(packed, 1) == null, "no gap between contiguous");
const gapped = [
  { min: 0, max: 1, color: "#000" },
  { min: 5, max: 6, color: "#111" },
];
const mid = suggestInsertRange(gapped, 1);
assert(mid && mid.min === 1 && mid.max === 2, JSON.stringify(mid));
const end = suggestInsertRange(gapped, 2);
assert(end && end.min === 6 && end.max === 7, JSON.stringify(end));

console.log(JSON.stringify({ ok: true, unit: unit.length, wideInt: wideInt.length, flt: flt.length }, null, 2));
fs.unlinkSync(out);

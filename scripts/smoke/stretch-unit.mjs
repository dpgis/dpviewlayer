#!/usr/bin/env node
/** Unit checks for stretchRange default min/max (float vs byte). */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const out = path.join(__dirname, "stretch-unit.bundle.mjs");
const esbuild = path.join(root, "node_modules/.bin/esbuild");
const r = spawnSync(
  esbuild,
  [
    path.join(root, "media/src/colorRamps.js"),
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

const { stretchRange, isByteLikeStats } = await import(out);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const chla = { min: 4.3815956115723, max: 12389.20703125 };
const noneChla = stretchRange(null, chla, "none");
assert(
  Math.abs(noneChla.min - chla.min) < 1e-6 && Math.abs(noneChla.max - chla.max) < 1e-6,
  `float none should use PAM stats, got ${JSON.stringify(noneChla)}`,
);

const byte = { min: 0, max: 255 };
const noneByte = stretchRange(null, byte, "none");
assert(noneByte.min === 0 && noneByte.max === 255, `byte none should stay 0..255, got ${JSON.stringify(noneByte)}`);

assert(!isByteLikeStats(chla), "chla should not be byte-like");
assert(isByteLikeStats(byte), "0..255 int should be byte-like");

const minmax = stretchRange(null, chla, "minmax");
assert(Math.abs(minmax.min - chla.min) < 1e-6 && Math.abs(minmax.max - chla.max) < 1e-6, "minmax");

const chlaFull = {
  min: 4.3815956115723,
  max: 12389.20703125,
  mean: 1597.1107806698,
  stddev: 1943.3985340124,
};
const pct = stretchRange(null, chlaFull, "percent", { percent: 2 });
assert(pct.min > chlaFull.min && pct.max < chlaFull.max, `percent approx got ${JSON.stringify(pct)}`);
const sd = stretchRange(null, chlaFull, "stddev", { stddev: 2 });
assert(
  Math.abs(sd.min - (chlaFull.mean - 2 * chlaFull.stddev)) < 1e-6 &&
    Math.abs(sd.max - (chlaFull.mean + 2 * chlaFull.stddev)) < 1e-6,
  `stddev PAM got ${JSON.stringify(sd)}`,
);

console.log(JSON.stringify({ ok: true, noneChla, noneByte, minmax, pct, sd }, null, 2));
fs.unlinkSync(out);

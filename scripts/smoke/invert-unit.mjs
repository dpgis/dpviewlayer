#!/usr/bin/env node
/** Unit checks for palette invert (no browser). */
function invertColormap(colormap) {
  const ids = Object.keys(colormap)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (ids.length < 2) return { ...colormap };
  const colors = ids.map((id) => colormap[id] ?? colormap[String(id)] ?? "#808080");
  colors.reverse();
  const next = {};
  for (let i = 0; i < ids.length; i++) next[ids[i]] = colors[i];
  return next;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const before = { 4: "#22c55e", 6: "#a855f7" };
const after = invertColormap(before);
assert(Object.keys(after).length === 2, `expected 2 keys, got ${JSON.stringify(after)}`);
assert(after[4] === "#a855f7", `class 4 should become purple, got ${after[4]}`);
assert(after[6] === "#22c55e", `class 6 should become green, got ${after[6]}`);
const twice = invertColormap(after);
assert(twice[4] === "#22c55e" && twice[6] === "#a855f7", "double invert should restore");

// Regression: old bug emptied the map
function invertBuggy(colormap) {
  const ids = Object.keys(colormap).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const colors = ids.map((id) => colormap[id] ?? "#808080");
  colors.reverse();
  const next = { ...colormap };
  for (let i = 0; i < ids.length; i++) {
    next[ids[i]] = colors[i];
    delete next[String(ids[i])];
  }
  return next;
}
assert(Object.keys(invertBuggy(before)).length === 0, "sanity: old bug still empties");

console.log(JSON.stringify({ ok: true, before, after, twice }, null, 2));

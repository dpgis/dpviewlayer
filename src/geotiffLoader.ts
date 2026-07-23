/**
 * Host-side geotiff access.
 * The npm `geotiff` package cannot be `require()`d from a VSIX (ESM-only deps,
 * and node_modules/geotiff is excluded by .vscodeignore). We ship a CJS bundle
 * at `out/vendor/geotiff.cjs` instead (built by `npm run build:geotiff`).
 */
export type GeotiffModule = typeof import("geotiff");

export async function loadGeotiff(): Promise<GeotiffModule> {
  // Relative to compiled out/geotiffLoader.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./vendor/geotiff.cjs") as GeotiffModule;
}

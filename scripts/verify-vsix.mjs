#!/usr/bin/env node
/**
 * Unpack a VSIX and prove the extension host graph loads (catches missing utif2 etc.).
 * Usage: node scripts/verify-vsix.mjs [path-to.vsix]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vsix =
  process.argv[2] ||
  path.join(root, `dpviewlayer-${JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version}.vsix`);

if (!fs.existsSync(vsix)) {
  console.error("missing vsix:", vsix);
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rv-vsix-"));
try {
  execSync(`unzip -q -o "${vsix}" -d "${dir}"`, { stdio: "inherit" });
  const ext = path.join(dir, "extension");
  const utif = path.join(ext, "node_modules", "utif2");
  if (!fs.existsSync(utif)) {
    console.error("FAIL: VSIX missing node_modules/utif2 (do not package with --no-dependencies)");
    process.exit(2);
  }
  const mock = path.join(dir, "mock-vscode.js");
  fs.writeFileSync(
    mock,
    `
class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.scheme = 'file'; this.path = fsPath; }
  static file(p) { return new Uri(require('path').resolve(p)); }
  static joinPath(base, ...parts) { return Uri.file(require('path').join(base.fsPath, ...parts)); }
  toString() { return 'file://' + this.fsPath; }
}
module.exports = {
  Uri,
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel() {
      return {
        webview: {
          html: '', options: {}, cspSource: 'csp',
          asWebviewUri: (u) => ({ toString: () => 'w:' + u.fsPath }),
          postMessage() {}, onDidReceiveMessage: () => ({ dispose() {} }),
        },
        onDidDispose: () => ({ dispose() {} }),
        onDidChangeViewState: () => ({ dispose() {} }),
        reveal() {}, dispose() {},
      };
    },
    showErrorMessage() {}, showWarningMessage() {}, setStatusBarMessage: () => ({ dispose() {} }),
  },
  commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
  workspace: {
    workspaceFolders: [],
    getWorkspaceFolder: () => undefined,
    getConfiguration: () => ({ get: () => undefined }),
    asRelativePath: (u) => require('path').basename(typeof u === 'string' ? u : u.fsPath),
  },
  env: { language: 'en' },
};
`,
  );

  const requireFromExt = createRequire(path.join(ext, "package.json"));
  const Module = requireFromExt("module");
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === "vscode") return mock;
    return orig.call(this, request, parent, isMain, options);
  };

  // Must load from extension dir so node_modules/utif2 resolves.
  process.chdir(ext);
  requireFromExt("./out/previewPanel.js");
  console.log("OK: previewPanel loads from", path.basename(vsix));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

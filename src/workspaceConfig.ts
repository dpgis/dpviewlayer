import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { loadColormapFile, saveColormapFile, type Rgb } from "./pngCodec";

const CONFIG_REL = path.join(".vscode", "raster-viewer.json");

/** Absolute path to workspace colormap config, if a folder is open for this file. */
export function resolveRasterViewerConfigPath(resource: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(resource);
  if (!folder) return undefined;
  return path.join(folder.uri.fsPath, CONFIG_REL);
}

/** Read colormap from `.vscode/raster-viewer.json`. */
export function loadWorkspaceColormap(resource: vscode.Uri): {
  colormap: Record<number, Rgb>;
  path?: string;
  source: "workspace" | "default";
} {
  const configPath = resolveRasterViewerConfigPath(resource);
  if (!configPath || !fs.existsSync(configPath)) {
    return { colormap: {}, source: "default" };
  }
  return {
    colormap: loadColormapFile(configPath),
    path: configPath,
    source: "workspace",
  };
}

/** Write colormap to `.vscode/raster-viewer.json` (creates `.vscode` if needed). */
export function saveWorkspaceColormap(
  resource: vscode.Uri,
  map: Record<number, Rgb>,
): string {
  const folder = vscode.workspace.getWorkspaceFolder(resource);
  if (!folder) {
    throw new Error("需要打开工作区文件夹才能写入 .vscode/raster-viewer.json");
  }
  const configPath = path.join(folder.uri.fsPath, CONFIG_REL);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  saveColormapFile(configPath, map);
  return configPath;
}

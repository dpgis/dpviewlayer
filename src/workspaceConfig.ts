import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  loadColormapDocument,
  saveColormapDocument,
  type Rgb,
} from "./pngCodec";

const CONFIG_REL = path.join(".vscode", "dpviewlayer.json");

export type WorkspaceColorTableRow = { min: number; max: number; color: string };

/** Absolute path to workspace colormap config, if a folder is open for this file. */
export function resolveViewLayerConfigPath(resource: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(resource);
  if (!folder) return undefined;
  return path.join(folder.uri.fsPath, CONFIG_REL);
}

/** Read color table from `.vscode/dpviewlayer.json` (ID = array index, not stored). */
export function loadWorkspaceColormap(resource: vscode.Uri): {
  colorTable: WorkspaceColorTableRow[];
  colormap: Record<number, Rgb>;
  path?: string;
  source: "workspace" | "default";
} {
  const configPath = resolveViewLayerConfigPath(resource);
  if (!configPath || !fs.existsSync(configPath)) {
    return { colorTable: [], colormap: {}, source: "default" };
  }
  const doc = loadColormapDocument(configPath);
  return {
    colorTable: doc.colorTable,
    colormap: doc.colormap,
    path: configPath,
    source: "workspace",
  };
}

/** Write color table array to `.vscode/dpviewlayer.json` (no id field). */
export function saveWorkspaceColormap(
  resource: vscode.Uri,
  colorTable: WorkspaceColorTableRow[],
): string {
  const folder = vscode.workspace.getWorkspaceFolder(resource);
  if (!folder) {
    throw new Error("需要打开工作区文件夹才能写入 .vscode/dpviewlayer.json");
  }
  const configPath = path.join(folder.uri.fsPath, CONFIG_REL);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  saveColormapDocument(configPath, colorTable);
  return configPath;
}

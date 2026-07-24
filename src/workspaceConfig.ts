import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  loadColormapDocument,
  saveColormapDocument,
  type Rgb,
} from "./pngCodec";

export type WorkspaceColorTableRow = { min: number; max: number; color: string };

/** Suggest a default colormap JSON path next to the raster (or last used file). */
export function defaultColormapSaveUri(
  resource: vscode.Uri,
  lastPath?: string,
): vscode.Uri {
  if (lastPath && path.isAbsolute(lastPath)) {
    return vscode.Uri.file(lastPath);
  }
  const base = path.basename(resource.fsPath).replace(/\.[^.]+$/, "");
  return vscode.Uri.file(
    path.join(path.dirname(resource.fsPath), `${base}.colormap.json`),
  );
}

/** Read color table from an absolute JSON path (ID = array index, not stored). */
export function loadColormapFromPath(filePath: string): {
  colorTable: WorkspaceColorTableRow[];
  colormap: Record<number, Rgb>;
  path: string;
} {
  const doc = loadColormapDocument(filePath);
  return {
    colorTable: doc.colorTable,
    colormap: doc.colormap,
    path: filePath,
  };
}

/** Write color table array to an absolute JSON path (no id field). */
export function saveColormapToPath(
  filePath: string,
  colorTable: WorkspaceColorTableRow[],
): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  saveColormapDocument(filePath, colorTable);
  return filePath;
}

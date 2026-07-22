import * as vscode from "vscode";

/** Prefer Chinese unless the VS Code UI language is English. */
export function isEnglishUi(): boolean {
  return vscode.env.language.toLowerCase().startsWith("en");
}

export function uiLang(): "zh" | "en" {
  return isEnglishUi() ? "en" : "zh";
}

const MSG = {
  zh: {
    localOnly: "栅格查看器仅支持本地文件",
    pickImage: "请选择图片文件（PNG / JPEG / TIFF / BMP）",
    cannotOpen: (reason: string) => `栅格查看器无法打开该文件。\n${reason}`,
    openLabel: "打开栅格",
    pickViewTitle: "选择目标视图",
    pickView: "将图层添加到哪个 Raster Viewer？",
    viewEmpty: "空视图",
    viewFileCount: (n: number) => `${n} 个图层`,
  },
  en: {
    localOnly: "Raster Viewer only supports local files",
    pickImage: "Please choose an image (PNG / JPEG / TIFF / BMP)",
    cannotOpen: (reason: string) => `Raster Viewer cannot open this file.\n${reason}`,
    openLabel: "Open raster",
    pickViewTitle: "Choose target view",
    pickView: "Add layer(s) to which Raster Viewer?",
    viewEmpty: "Empty view",
    viewFileCount: (n: number) => `${n} layer(s)`,
  },
} as const;

export function t() {
  return MSG[uiLang()];
}

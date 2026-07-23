import * as vscode from "vscode";
import { isLikelyImagePath, probeSingleBandByteImage } from "./imageProbe";
import {
  createNewView,
  listSessions,
  openMaskPreview,
  type SessionInfo,
} from "./previewPanel";
import { t } from "./l10n";

/**
 * - Explorer click uses the normal editor (no default Custom Editor).
 * - Context menu: open in new view / add as layer.
 */
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "viewLayer.openInNewView",
      async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        await openUris(context, resolveUris(uri, uris), "newView");
      },
    ),
    vscode.commands.registerCommand(
      "viewLayer.addAsLayer",
      async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        await openUris(context, resolveUris(uri, uris), "addLayer");
      },
    ),
    vscode.commands.registerCommand("viewLayer.newView", () => {
      createNewView(context);
    }),
  );
}

function resolveUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
  if (Array.isArray(uris) && uris.length) return uris.filter(Boolean);
  if (uri) return [uri];
  return [];
}

type OpenMode = "newView" | "addLayer";

async function openUris(
  context: vscode.ExtensionContext,
  uris: vscode.Uri[],
  mode: OpenMode,
): Promise<void> {
  let targets = uris;
  if (!targets.length) {
    const picked = await pickImages();
    if (!picked?.length) return;
    targets = picked;
  }

  let sessionId: string | undefined;
  if (mode === "addLayer") {
    const chosen = await pickTargetSession();
    if (chosen === "cancelled") return;
    sessionId = chosen?.id;
  }

  let first = true;
  for (const u of targets) {
    const ok = await tryOpenViewLayer(context, u, {
      newView: mode === "newView" && first,
      sessionId: mode === "newView" ? (first ? undefined : sessionId) : sessionId,
    });
    if (ok.sessionId) sessionId = ok.sessionId;
    first = false;
  }
}

async function pickTargetSession(): Promise<SessionInfo | null | "cancelled"> {
  const sessions = listSessions();
  if (sessions.length === 0) return null; // caller will create a view
  if (sessions.length === 1) return sessions[0];

  const msg = t();
  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({
      label: s.title,
      description: s.fileCount ? msg.viewFileCount(s.fileCount) : msg.viewEmpty,
      detail: s.activeName || undefined,
      session: s,
    })),
    {
      placeHolder: msg.pickView,
      title: msg.pickViewTitle,
    },
  );
  if (!picked) return "cancelled";
  return picked.session;
}

export async function tryOpenViewLayer(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  opts: { newView?: boolean; sessionId?: string } = {},
): Promise<{ ok: boolean; sessionId?: string }> {
  const msg = t();
  if (uri.scheme !== "file") {
    void vscode.window.showWarningMessage(msg.localOnly);
    return { ok: false };
  }
  if (!isLikelyImagePath(uri.fsPath)) {
    void vscode.window.showWarningMessage(msg.pickImage);
    return { ok: false };
  }

  const probe = probeSingleBandByteImage(uri.fsPath);
  if (!probe.ok) {
    void vscode.window.showWarningMessage(msg.cannotOpen(probe.reason));
    return { ok: false };
  }

  const result = await openMaskPreview({
    context,
    uri,
    probe,
    newView: opts.newView,
    sessionId: opts.sessionId,
  });
  return result;
}

async function pickImages(): Promise<vscode.Uri[] | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: {
      Images: ["png", "jpg", "jpeg", "tif", "tiff", "bmp"],
    },
    openLabel: t().openLabel,
  });
  return picked;
}

export function deactivate() {}

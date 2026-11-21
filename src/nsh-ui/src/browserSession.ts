// What ties the browser to the session around it (wave 22): an agent page
// the open session opened presents in that session's inspector, a picked
// page element lands in the composer, and a workspace's HTML file previews
// through the workspace's device.
//
// `browserStore.ts` is also loaded by the native shell's actuator before the
// app state exists, so it takes these as hooks; this module installs them
// when the Browser tool's module loads (App.tsx imports it at startup).

import { readFileContent } from "./api";
import { entryDeviceId, windowShellId } from "./bridge";
import {
  HTML_PREVIEW_MAX_BYTES,
  htmlPreview,
  htmlPreviewNotice,
  installBrowserSessionHooks,
} from "./browserStore";
import { localizeHostError, tr } from "./i18n";
import {
  activeScene,
  activeSessionDevice,
  activeSessionId,
  activeWorkspaceKey,
  composerText,
  navigateScene,
  openInAuxPane,
  workspaces,
} from "./state";
import { compactLayout } from "./theme";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** Whether a page the agent of `sessionId` opened belongs in the inspector now. */
export function sessionShowsAgentPage(sessionId: string | null): boolean {
  if (!sessionId || compactLayout() || activeScene() !== "sessions") return false;
  if (activeSessionId() !== sessionId) return false;
  const device = activeSessionDevice();
  return !device || device === entryDeviceId();
}

function insertIntoComposer(text: string): void {
  composerText.update(current => `${current}${current && !/\s$/.test(current) ? " " : ""}${text} `);
}

/** Whether a workspace file lives on this desktop (not a remote host or another device). */
function fileIsOnThisDesktop(deviceId: string | null): boolean {
  if (windowShellId() !== "nsh-desktop") return false;
  return !deviceId || deviceId === entryDeviceId();
}

/**
 * Opens a workspace's HTML file in the browser (the inspector beside a
 * session, else the Browser tool). Reads it through the workspace's device.
 */
export async function openHtmlPreview(options: {
  path: string;
  workspaceId?: string | null;
  deviceId?: string | null;
  inInspector?: boolean;
}): Promise<void> {
  const workspaceId = options.workspaceId ?? activeWorkspaceKey()?.workspaceId ?? null;
  const deviceId = options.deviceId ?? activeWorkspaceKey()?.deviceId ?? null;
  const name = options.path.replace(/\\/g, "/").split("/").pop() || options.path;
  htmlPreviewNotice.set(null);
  if (options.inInspector && !compactLayout()) openInAuxPane("browser");
  else navigateScene("browser");
  let html: string;
  try {
    html = (await readFileContent(workspaceId ?? "", options.path)) ?? "";
  } catch (error) {
    htmlPreview.set(null);
    htmlPreviewNotice.set(tr("browser.preview.readFailed", { error: localizeHostError(errorText(error)) }));
    return;
  }
  if (html.length > HTML_PREVIEW_MAX_BYTES) {
    htmlPreview.set(null);
    htmlPreviewNotice.set(tr("browser.preview.tooLarge", { name }));
    return;
  }
  htmlPreview.set({
    path: options.path,
    name,
    html,
    onThisDesktop: fileIsOnThisDesktop(deviceId) && !workspaceIsRemote(workspaceId),
    workspaceId,
    deviceId,
  });
}

/** A remote workspace (SSH, Docker, WSL) keeps its files on another host. */
function workspaceIsRemote(workspaceId: string | null): boolean {
  if (!workspaceId) return false;
  const workspace = workspaces().find(item => item.id === workspaceId);
  return (workspace?.workspaceKind ?? "").toLowerCase() === "remote";
}


installBrowserSessionHooks({
  agentPageOpened: sessionId => {
    if (sessionShowsAgentPage(sessionId)) openInAuxPane("browser");
  },
  insertIntoComposer,
  previewLocalHtml: path => openHtmlPreview({ path, inInspector: activeScene() !== "browser" }),
});

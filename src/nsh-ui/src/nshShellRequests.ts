// The native shell's answers to the backend. In the native desktop the window,
// tray, notifications, clipboard, login item and the app's lifecycle belong to
// the NSH shell, yet backend commands act on them too (`quit_app`,
// `send_system_notification`, the launch-at-login option, an agent's clipboard
// write, the updater's restart). The backend asks with a `host://shell-request`
// event; this module runs the operation with `nsh` / `nsh/desktop` and answers
// with `host_shell_respond`. It announces the operations it runs once
// (`host_shell_attach`), so the backend refuses anything else loudly instead of
// waiting for an answer that never comes.
//
// Only the in-process native desktop installs it: the backend publishes these
// events to its owner scope alone, and a browser tab has no shell to offer.

import { Buffer } from "buffer";
import { Clipboard } from "nsh";
import { Application } from "nsh/desktop";
import { entryDeviceId, fleetActive } from "./bridge";
import { openWorkspaceById } from "./api";
import { focusPane, loadWorkspaces, navigateScene, selectSession, selectWorkspace, workspaces } from "./state";
import { mainWindow } from "./nshDesktopShell";
import { BROWSER_SHELL_OPERATIONS, markBrowserActuatorInstalled } from "./browserStore";
import { PET_SHELL_OPERATIONS } from "./desktopPresence"; // wave22-p3
import type { WindowShell } from "./windowShell";

export interface ShellRequest {
  id: number;
  op: string;
  args?: unknown;
}

export interface NshShellRequestDeps {
  shell: WindowShell;
  invokeCommand<T>(action: string, request?: Record<string, unknown>): Promise<T>;
  listenEvent<T>(event: string, listener: (payload: T) => void): () => void;
}

export const SHELL_REQUEST_EVENT = "host://shell-request";

type Operation = (args: Record<string, unknown>, deps: NshShellRequestDeps) => Promise<unknown>;

function mainWindowFacts(): { isFullscreen: boolean; isMaximized: boolean } {
  let mode: string | undefined;
  try {
    mode = mainWindow()?.state()?.mode;
  } catch {
    mode = undefined;
  }
  return { isFullscreen: mode === "fullScreen", isMaximized: mode === "maximized" };
}

/** `file:` URLs from the clipboard as local paths. */
export function fileUrlToPath(url: string): string {
  if (!url.startsWith("file://")) return url;
  let path = url.slice("file://".length);
  // `file://localhost/...` and `file:///...` both name a local path.
  if (path.startsWith("localhost/")) path = path.slice("localhost".length);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the undecoded text: a path with a stray `%` is still a path.
  }
  // Windows: `file:///C:/x` -> `C:/x`.
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

function showMainWindow(): void {
  const win = mainWindow();
  if (!win) throw new Error("The main window is not available");
  win.show();
  win.focus();
}

const OPERATIONS: Record<string, Operation> = {
  "window.show": async () => {
    showMainWindow();
    return null;
  },
  "session.openLocal": async args => {
    const { sessionId, workspaceId } = args;
    if (typeof sessionId !== "string" || !sessionId || typeof workspaceId !== "string" || !workspaceId) {
      throw new Error("A local session and workspace are required");
    }
    const deviceId = entryDeviceId() ?? "";
    if (fleetActive() && !deviceId) throw new Error("The local desktop identity is unavailable");
    if (!fleetActive() && !workspaces().some(ws => ws.id === workspaceId)) {
      await openWorkspaceById({ id: workspaceId });
      await loadWorkspaces();
      if (!workspaces().some(ws => ws.id === workspaceId)) throw new Error("Failed to open the local workspace");
    }
    showMainWindow();
    selectWorkspace(workspaceId, { deviceId, loadSessions: false });
    selectSession(sessionId, deviceId, workspaceId);
    focusPane(0);
    navigateScene("sessions");
    return null;
  },
  "window.hide": async (_args, deps) => {
    await deps.shell.hideAfterCloseRequest();
    return null;
  },
  "window.toggleFullscreen": async (_args, deps) => {
    await deps.shell.toggleFullscreen();
    return mainWindowFacts();
  },
  "app.quit": async () => {
    Application.quit();
    return null;
  },
  "app.restart": async () => {
    Application.restart();
    return null;
  },
  "tray.setUnreadCount": async (args, deps) => {
    const count = typeof args.count === "number" && args.count > 0 ? Math.floor(args.count) : 0;
    await deps.shell.setTrayUnreadCount(count);
    return null;
  },
  "notification.show": async (args, deps) => {
    const title = typeof args.title === "string" ? args.title : "";
    if (!title) throw new Error("A notification needs a title");
    await deps.shell.showSystemNotification(title, typeof args.body === "string" ? args.body : "");
    return null;
  },
  "clipboard.readFiles": async () => {
    const urls = await Clipboard.readFiles();
    return { paths: urls.map(fileUrlToPath).filter(path => Boolean(path)) };
  },
  "clipboard.readImage": async () => {
    const image = await Clipboard.readImage();
    if (!image) return { base64: null, mimeType: null };
    const response = await fetch(image.url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mimeType: response.headers.get("content-type") ?? null,
    };
  },
  "clipboard.writeImage": async args => {
    const dataUrl = typeof args.dataUrl === "string" ? args.dataUrl : "";
    if (!dataUrl.startsWith("data:image/")) throw new Error("A clipboard image must be a data: URL");
    await Clipboard.writeImage(dataUrl);
    return null;
  },
  "loginItem.get": async () => Application.launchAtLogin(),
  "loginItem.set": async args => {
    await Application.setLaunchAtLogin(args.enabled === true);
    return null;
  },
  // embedded browser (wave 4): the backend's pages are this shell's web views.
  ...BROWSER_SHELL_OPERATIONS,
  // desktop pet window (wave22-p3): `show/hide/resize_agent_companion_desktop_pet`.
  ...PET_SHELL_OPERATIONS,
};

/** The operations this shell runs, as it announces them to the backend. */
export const SHELL_OPERATIONS: readonly string[] = Object.keys(OPERATIONS).sort();

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** Runs one request and answers it; never throws. */
export async function answerShellRequest(request: ShellRequest, deps: NshShellRequestDeps): Promise<void> {
  const id = Number(request?.id);
  if (!Number.isFinite(id)) return;
  const operation = OPERATIONS[request.op];
  let reply: Record<string, unknown>;
  if (!operation) {
    reply = { id, ok: false, error: `unsupported_in_native_host: shell operation ${request.op}` };
  } else {
    try {
      const args = request.args && typeof request.args === "object" ? (request.args as Record<string, unknown>) : {};
      const value = await operation(args, deps);
      reply = { id, ok: true, value: value ?? null };
    } catch (error) {
      reply = { id, ok: false, error: errorText(error) };
    }
  }
  try {
    await deps.invokeCommand<null>("host_shell_respond", reply);
  } catch (error) {
    console.warn(`Failed to answer shell request ${request.op}`, error);
  }
}

/**
 * Listens to the backend's shell requests and announces the operations. The
 * returned function stops listening.
 */
export function startNshShellRequests(deps: NshShellRequestDeps): () => void {
  markBrowserActuatorInstalled();
  const stop = deps.listenEvent<ShellRequest>(SHELL_REQUEST_EVENT, request => {
    void answerShellRequest(request, deps);
  });
  void deps
    .invokeCommand<{ ops?: string[] }>("host_shell_attach", { ops: [...SHELL_OPERATIONS] })
    .catch(error => {
      // An older backend without the channel: its own commands keep refusing
      // what needs the shell, which the UI already reports.
      console.warn("The backend did not take the native shell channel", error);
    });
  return stop;
}

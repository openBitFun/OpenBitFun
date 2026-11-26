// The shell around the UI: the window, its title bar, the application menu,
// the tray, OS notifications and the local pickers. It is the client's own
// machine, never the backend's — a WebSocket client keeps its shell while its
// backend runs elsewhere — so it is apart from `BackendConnection`.
//
// Two shells exist: `createHostPageShell` (this file) drives the Tauri window
// through `host.js` and the desktop's own Tauri commands, as the web build
// always did; `createNshDesktopShell` (`nshDesktopShell.ts`) drives a native
// NSH window with `nsh/desktop`.

import { host } from "nsh";

/** What the shell reports about the window it draws in. */
export interface WindowChromeState {
  native?: boolean;
  platform?: string;
  overlayTrafficLights?: boolean;
  isFullscreen?: boolean;
}

/** Where the shell writes window facts the chrome lays itself out by. */
export interface WindowChromeSink {
  setNative(native: boolean): void;
  setPlatform(platform: string): void;
  /** macOS traffic lights over the app's own title bar. */
  setOverlayTitlebar(overlay: boolean): void;
  setFullscreen(fullscreen: boolean): void;
  setMaximized(maximized: boolean): void;
  /** Widths the system's window controls take at each end of the bar; `null` when unknown. */
  setTitleBarInsets(insets: { left: number; right: number } | null): void;
  /** The system draws minimize / maximize / close itself. */
  setSystemWindowControls(system: boolean): void;
}

/** What the UI's menus and tray run. */
export interface ShellActions {
  newSession(): void;
  openFolder(): void;
  newWorkspace(): void;
  openSettings(): void;
  toggleSidebar(): void;
  about(): void;
  markAllRead(): void;
  /** Opens the Inbox (the desktop pet's press; wave22-p3). */
  openInbox?(): void;
  /** Opens Settings › Pet (the desktop pet's menu; wave22-p3). */
  openPetSettings?(): void;
}

/** File filter group for native OS file dialogs. */
export interface FileDialogFilter {
  name?: string;
  extensions: string[];
}

/** Options for native OS file open/save dialogs (desktop runner). */
export interface FileDialogOptions {
  mode: "open" | "save";
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  filters?: FileDialogFilter[];
}

export interface WindowShell {
  /** `host-page`: the Tauri webview; `nsh-desktop`: a native NSH window; `browser`: a tab of a backend-served page; `mobile`: the phone app. */
  readonly id: "host-page" | "nsh-desktop" | "browser" | "mobile";
  /** Drag regions are declared on views (`desktop={{ windowDrag }}`) instead of started on press. */
  readonly nativeDragRegions: boolean;
  /** The app's own updater commands answer here. */
  readonly inAppUpdates: boolean;
  /** Shell shortcuts its application menu carries, which the page must not bind again. */
  readonly menuShortcutIds: ReadonlySet<string>;
  /** Reads the window's facts once and keeps them current. Call while rendering. */
  probe(sink: WindowChromeSink): Promise<void>;
  startDrag(): void;
  toggleMaximize(): void;
  minimize(): void;
  close(): void;
  toggleFullscreen(): Promise<void>;
  isFocused(): Promise<boolean>;
  /** The local folder picker; rejects where none exists, resolves `null` on cancel. */
  pickDirectory(options: { title: string; defaultPath?: string }): Promise<string | null>;
  /** Native OS file open/save dialog returning local filesystem path(s), or `null` on cancel. */
  pickFileDialog?(options: FileDialogOptions): Promise<string | string[] | null>;
  /** This window's own build version, when the shell knows it; `null` defers to the backend's `ready()`. */
  appVersion(): Promise<string | null>;
  /** The user asked to close the main window. */
  onCloseRequest(handler: () => void): () => void;
  /** Hides the window after a close request (macOS keeps the app running). */
  hideAfterCloseRequest(): Promise<void>;
  minimizeToTray(): Promise<void>;
  quit(): Promise<void>;
  /** Builds the application menu and the tray around `actions`. Call while rendering. */
  startIntegration(actions: ShellActions): () => void;
  setTrayUnreadCount(count: number): Promise<void>;
  /** Shows an OS notification; resolves without one where the shell has none. */
  showSystemNotification(title: string, body: string): Promise<void>;
}

interface HostReply<T> {
  ok: boolean;
  value?: T;
  error?: string;
  transport?: string;
}

export interface HostPageShellDeps {
  invokeCommand<T>(action: string, request?: Record<string, unknown>): Promise<T>;
  listenEvent<T>(event: string, listener: (payload: T) => void): () => void;
  noteTransport(kind: string | undefined): void;
}

/**
 * The Tauri webview's shell. Window calls go to `host.js`; the close, tray and
 * fullscreen decisions are the desktop's own Tauri commands.
 */
export function createHostPageShell(deps: HostPageShellDeps): WindowShell {
  let native = false;
  let probed: Promise<void> | null = null;

  function hostCall<T>(name: string, args: unknown = {}): Promise<HostReply<T> | undefined> {
    return host.call<HostReply<T>>(name, args);
  }

  async function probeWindowControls(sink: WindowChromeSink): Promise<void> {
    try {
      const reply = await hostCall<boolean>("openbitfun.windowIsMaximized");
      if (reply?.ok === true) sink.setMaximized(reply.value === true);
      await hostCall<boolean>("openbitfun.windowWatchResize");
      deps.listenEvent<{ maximized?: boolean; fullscreen?: boolean }>("window://resized", payload => {
        sink.setMaximized(payload?.maximized === true);
        if (typeof payload?.fullscreen === "boolean") sink.setFullscreen(payload.fullscreen);
      });
    } catch {
      // An older host module has no frame-state bridge; the glyph stays at "maximize".
    }
  }

  async function probeOnce(sink: WindowChromeSink): Promise<void> {
    try {
      const reply = await hostCall<WindowChromeState>("openbitfun.windowChrome");
      deps.noteTransport(reply?.transport);
      if (!reply || reply.ok !== true || !reply.value) return;
      native = reply.value.native === true;
      const platform = typeof reply.value.platform === "string" ? reply.value.platform : "";
      sink.setNative(native);
      sink.setPlatform(platform);
      // Windows and Linux build the Tauri window with `decorations(false)`.
      sink.setSystemWindowControls(platform === "macos");
      if (native && platform !== "" && platform !== "macos") void probeWindowControls(sink);
      const overlay = reply.value.overlayTrafficLights === true;
      sink.setOverlayTitlebar(overlay);
      sink.setFullscreen(reply.value.isFullscreen === true);
      if (overlay) {
        deps.listenEvent<unknown>("window://fullscreen-chrome", payload => {
          const next = parseFullscreenPhase(payload);
          if (next !== null) sink.setFullscreen(next);
        });
      }
    } catch {
      // Headless test harnesses and older hosts do not expose windowChrome; stay at 0 inset.
    }
  }

  return {
    id: "host-page",
    nativeDragRegions: false,
    inAppUpdates: true,
    menuShortcutIds: new Set<string>(),
    probe(sink) {
      if (!probed) probed = probeOnce(sink);
      return probed;
    },
    startDrag() {
      void hostCall("openbitfun.windowDrag").catch(() => undefined);
    },
    toggleMaximize() {
      void hostCall("openbitfun.windowToggleMaximize").catch(() => undefined);
    },
    minimize() {
      void hostCall("openbitfun.windowMinimize").catch(() => undefined);
    },
    // The desktop answers a close with `openbitfun_main_window_close_requested`.
    close() {
      void hostCall("openbitfun.windowClose").catch(() => undefined);
    },
    async toggleFullscreen() {
      await deps.invokeCommand<unknown>("toggle_main_window_fullscreen", {});
    },
    async isFocused() {
      try {
        const reply = await hostCall<boolean>("openbitfun.windowFocused");
        return reply?.ok === true ? reply.value !== false : true;
      } catch {
        return true;
      }
    },
    async pickDirectory(options) {
      const reply = await hostCall<string | null>("openbitfun.pickDirectory", options);
      deps.noteTransport(reply?.transport);
      if (!reply || reply.ok !== true) {
        throw new Error(reply?.error || "The folder picker is not available");
      }
      return typeof reply.value === "string" && reply.value ? reply.value : null;
    },
    async appVersion() {
      try {
        const reply = await hostCall<string | null>("openbitfun.appVersion");
        return reply?.ok === true && typeof reply.value === "string" && reply.value ? reply.value : null;
      } catch {
        return null;
      }
    },
    onCloseRequest(handler) {
      return deps.listenEvent<unknown>("openbitfun_main_window_close_requested", () => handler());
    },
    async hideAfterCloseRequest() {
      await deps.invokeCommand<unknown>("hide_main_window_after_close_request");
    },
    async minimizeToTray() {
      await deps.invokeCommand<unknown>("minimize_to_tray", {});
    },
    async quit() {
      await deps.invokeCommand<unknown>("quit_app", {});
    },
    startIntegration(actions) {
      // The Tauri menu bar (macOS) asks the page for these, as it asks `AppLayout.tsx`.
      const stops = [
        deps.listenEvent<unknown>("openbitfun_menu_open_project", () => actions.openFolder()),
        deps.listenEvent<unknown>("openbitfun_menu_new_project", () => actions.newWorkspace()),
        deps.listenEvent<unknown>("openbitfun_menu_about", () => actions.about()),
        // The tray's "Mark all as read" forwards the intent; this surface owns read receipts.
        deps.listenEvent<unknown>("tray://mark-all-read", () => actions.markAllRead()),
      ];
      // The tray is built after the first paint, as the desktop's own frontend does,
      // so it never delays the window. A host without a tray answers an error, which
      // is not this surface's to report.
      let trayTimer: ReturnType<typeof setTimeout> | null = null;
      let disposed = false;
      void (probed ?? Promise.resolve()).then(() => {
        if (disposed || !native) return;
        trayTimer = setTimeout(() => {
          trayTimer = null;
          void deps.invokeCommand<unknown>("initialize_tray_after_startup", {}).catch(error => {
            console.warn("Deferred tray initialization failed", error);
          });
        }, 400);
      });
      return () => {
        disposed = true;
        stops.forEach(stop => stop());
        if (trayTimer !== null) clearTimeout(trayTimer);
      };
    },
    async setTrayUnreadCount(count) {
      if (!native) return;
      // The tray is this machine's even while a peer is driven (controller local).
      await deps.invokeCommand<unknown>("set_tray_unread_count", { count });
    },
    async showSystemNotification(title, body) {
      await deps.invokeCommand<unknown>("send_system_notification", { title, body });
    },
  };
}

function parseFullscreenPhase(payload: unknown): boolean | null {
  const phase =
    typeof payload === "string"
      ? payload
      : payload && typeof payload === "object" && typeof (payload as { phase?: unknown }).phase === "string"
        ? (payload as { phase: string }).phase
        : null;
  if (phase === "entering" || phase === "fullscreen") return true;
  if (phase === "exiting" || phase === "windowed") return false;
  return null;
}

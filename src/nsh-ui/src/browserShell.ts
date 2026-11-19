// The shell of a browser tab showing a backend-served page (`servedBackend.ts`).
//
// The tab is the client's own window: there is no application menu, tray,
// window chrome or folder picker to drive, and the backend's window commands
// (`toggle_main_window_fullscreen`, `quit_app`, the tray) belong to the
// backend's machine, so this shell never sends them. What a tab cannot do is
// refused with a reason, never faked.

import type { WindowShell } from "./windowShell";

function unsupported(what: string): Promise<never> {
  return Promise.reject(new Error(`${what} is not available in a browser tab`));
}

export function createBrowserShell(): WindowShell {
  return {
    id: "browser",
    nativeDragRegions: false,
    // Updates are the backend machine's; a tab never installs them.
    inAppUpdates: false,
    menuShortcutIds: new Set<string>(),
    async probe(sink) {
      sink.setNative(false);
      sink.setPlatform("web");
      sink.setOverlayTitlebar(false);
      sink.setSystemWindowControls(true);
      sink.setTitleBarInsets(null);
    },
    startDrag() {},
    toggleMaximize() {},
    minimize() {},
    close() {},
    async toggleFullscreen() {
      const doc = (globalThis as { document?: { fullscreenElement?: unknown; documentElement?: { requestFullscreen?: () => Promise<void> }; exitFullscreen?: () => Promise<void> } }).document;
      if (!doc?.documentElement?.requestFullscreen) return;
      if (doc.fullscreenElement) await doc.exitFullscreen?.();
      else await doc.documentElement.requestFullscreen();
    },
    async isFocused() {
      const doc = (globalThis as { document?: { hasFocus?: () => boolean } }).document;
      return typeof doc?.hasFocus === "function" ? doc.hasFocus() : true;
    },
    pickDirectory() {
      // The folders a session opens live on the backend's machine.
      return unsupported("Choosing a folder on this device");
    },
    async appVersion() {
      return null;
    },
    onCloseRequest() {
      return () => undefined;
    },
    hideAfterCloseRequest() {
      return unsupported("Hiding the window");
    },
    minimizeToTray() {
      return unsupported("The tray");
    },
    quit() {
      return unsupported("Quitting the backend");
    },
    startIntegration() {
      return () => undefined;
    },
    async setTrayUnreadCount() {},
    async showSystemNotification() {},
  };
}

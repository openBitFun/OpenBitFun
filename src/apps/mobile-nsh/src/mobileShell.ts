// The shell of the OpenBitFun phone app (iOS and Android).
//
// The phone is a frontend-only controller: it has no desktop window chrome,
// application menu, tray, folder picker or desktop updater. Installing this
// shell prevents the shared UI from falling back to the legacy page-host shell
// (`createHostPageShell`), which would otherwise send desktop-only commands
// (`quit_app`, `minimize_to_tray`, `miniapp_presentation`) to the remote entry.

import { lifecycle, Notifications, platform } from "nsh";
import type { WindowShell } from "../../../nsh-ui/src/windowShell";

function unsupported(what: string): Promise<never> {
  return Promise.reject(new Error(`${what} is not available on mobile`));
}

export function createMobileShell(): WindowShell {
  let notificationPermissionAsked = false;

  return {
    id: "mobile",
    nativeDragRegions: false,
    // Updates are distributed by the mobile store, never the remote desktop's updater.
    inAppUpdates: false,
    menuShortcutIds: new Set<string>(),
    async probe(sink) {
      sink.setNative(false);
      sink.setPlatform(platform.os);
      sink.setOverlayTitlebar(false);
      sink.setSystemWindowControls(true);
      sink.setTitleBarInsets(null);
    },
    startDrag() {},
    toggleMaximize() {},
    minimize() {},
    close() {},
    toggleFullscreen() {
      return unsupported("Fullscreen");
    },
    async isFocused() {
      return lifecycle() === "active";
    },
    pickDirectory() {
      return unsupported("Choosing a local folder");
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
      return unsupported("Quitting the remote backend");
    },
    startIntegration() {
      return () => undefined;
    },
    async setTrayUnreadCount() {},
    async showSystemNotification(title, body) {
      try {
        let permission = await Notifications.permission();
        if (permission === "default" && !notificationPermissionAsked) {
          notificationPermissionAsked = true;
          permission = await Notifications.requestPermission();
        }
        if (permission !== "granted") return;
        await Notifications.show({ id: `openbitfun-${Date.now()}`, title, body });
      } catch {
        // Notification capability denied or unavailable on this device.
      }
    },
  };
}

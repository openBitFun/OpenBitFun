// The native NSH shell: the main window, its title bar, the application menu,
// the tray and OS notifications, all through `nsh/desktop` and `nsh`. Nothing
// here talks to the backend; a client whose backend runs elsewhere keeps this
// shell unchanged. The desktop presence windows (cards, the pet) are started
// from here and talk to this device's backend themselves (`desktopPresence.tsx`).

import { effect, Notifications, platform, signal } from "nsh";
import { Application, isAvailable, Menu, Tray, Window, type MenuItem, type WindowRef } from "nsh/desktop";
import { startDesktopPresence } from "./desktopPresence";
import { tr } from "./i18n";
import { effectiveKeystroke, SHORTCUT_DEFINITIONS } from "./shortcutsStore";
import type { ShellActions, WindowChromeSink, WindowShell } from "./windowShell";

export interface NshDesktopShellDeps {
  /**
   * The folder picker. NSH has a file picker but no folder picker, so the
   * native host supplies one; without it the picker is refused with a reason.
   */
  pickDirectory?: (options: { title: string; defaultPath?: string }) => Promise<string | null>;
  /**
   * The menu-bar / tray icon (a template image). It is an asset of the app that
   * packages the shell (NSH keeps assets inside the app's directory), so the
   * host passes it in; without one no tray item is shown.
   */
  trayIcon?: string;
}

/** The shell shortcuts the application menu carries (ids of `SHELL_SHORTCUTS` in `App.tsx`). */
const MENU_SHORTCUT_IDS = new Set<string>(["chat.newSession", "scene.openSettings", "panel.toggleLeft"]);

/**
 * The app's main window: the one `mount` opens for the root (id `"main"`).
 * Reactive, and `null` until that window has opened (NSH 0.7 opens it after
 * the root renders).
 */
export function mainWindow(): WindowRef | null {
  try {
    return Window.get("main");
  } catch {
    return null;
  }
}

function showMainWindow(): void {
  const win = mainWindow();
  if (!win) return;
  win.show();
  win.focus();
}

export function createNshDesktopShell(deps: NshDesktopShellDeps = {}): WindowShell {
  const os = platform.os;
  const closeHandlers = new Set<() => void>();
  const trayUnread = signal(0);
  let closeListenerAttached = false;
  let notificationPermissionAsked = false;
  let stopNotificationPress: (() => void) | null = null;

  function requestClose(): void {
    if (closeHandlers.size === 0) {
      // Nothing decides for the page: closing is the platform's default.
      mainWindow()?.close();
      return;
    }
    for (const handler of [...closeHandlers]) handler();
  }

  function attachCloseListener(win: WindowRef): void {
    if (closeListenerAttached) return;
    closeListenerAttached = true;
    // The page answers the close button (tray, quit, ask), as the desktop asks
    // `AppLayout.tsx`; the window therefore stays open until it decides.
    win.set({ closeOnPress: false });
    win.on("closePress", () => requestClose());
  }

  function menuShortcut(id: string, fallback: string): string {
    const def = SHORTCUT_DEFINITIONS.find(item => item.id === id);
    return def ? effectiveKeystroke(def) : fallback;
  }

  function buildApplicationMenu(actions: ShellActions): MenuItem[] {
    return [
      {
        label: tr("product.name"),
        submenu: [
          { label: tr("shell.about.title"), onSelect: () => actions.about() },
          { type: "separator" },
          { label: tr("shell.menu.settings"), shortcut: menuShortcut("scene.openSettings", "mod+,"), onSelect: () => actions.openSettings() },
          { type: "separator" },
          os === "macos" && { label: tr("shell.menu.hide"), role: "hide" },
          os === "macos" && { label: tr("shell.menu.hideOthers"), role: "hideOthers" },
          os === "macos" && { label: tr("shell.menu.showAll"), role: "showAll" },
          os === "macos" && { type: "separator" },
          { label: tr("shell.menu.quit"), role: "quit" },
        ],
      },
      {
        label: tr("shell.menu.file"),
        submenu: [
          { label: tr("nav.newSession"), shortcut: menuShortcut("chat.newSession", "mod+n"), onSelect: () => actions.newSession() },
          { label: tr("nav.newWorkspace"), onSelect: () => actions.newWorkspace() },
          { label: tr("shell.openFolder"), shortcut: "mod+o", onSelect: () => actions.openFolder() },
        ],
      },
      {
        // The editing roles act on the focused text field: they are what gives
        // every input Command-C / Command-V natively.
        label: tr("shell.menu.edit"),
        submenu: [
          { label: tr("shell.menu.undo"), role: "undo" },
          { label: tr("shell.menu.redo"), role: "redo" },
          { type: "separator" },
          { label: tr("shell.menu.cut"), role: "cut" },
          { label: tr("common.copy"), role: "copy" },
          { label: tr("common.paste"), role: "paste" },
          { label: tr("shell.menu.selectAll"), role: "selectAll" },
        ],
      },
      {
        label: tr("shell.menu.view"),
        submenu: [
          { label: tr("nav.toggleSidebar"), shortcut: menuShortcut("panel.toggleLeft", "mod+b"), onSelect: () => actions.toggleSidebar() },
          { type: "separator" },
          { label: tr("shell.fullscreen"), role: "toggleFullScreen" },
        ],
      },
      {
        label: tr("shell.menu.window"),
        submenu: [
          { label: tr("shell.window.minimize"), role: "minimize" },
          { label: tr("shell.menu.zoom"), role: "zoom" },
          { type: "separator" },
          // Command-W closes the current tab (`tab.close`), so the window takes Shift.
          { label: tr("shell.menu.closeWindow"), shortcut: "mod+shift+w", onSelect: () => requestClose() },
        ],
      },
    ];
  }

  function buildTrayMenu(actions: ShellActions): MenuItem[] {
    const unread = trayUnread();
    return [
      {
        label:
          unread > 0 ? tr("shell.tray.markAllReadCount", { count: unread }) : tr("shell.tray.markAllRead"),
        disabled: unread === 0,
        onSelect: () => actions.markAllRead(),
      },
      { type: "separator" },
      { label: tr("shell.tray.show"), onSelect: () => showMainWindow() },
      {
        label: tr("nav.newSession"),
        onSelect: () => {
          showMainWindow();
          actions.newSession();
        },
      },
      { type: "separator" },
      { label: tr("shell.tray.restart"), onSelect: () => Application.restart() },
      { label: tr("shell.menu.quit"), onSelect: () => Application.quit() },
    ];
  }

  return {
    id: "nsh-desktop",
    nativeDragRegions: true,
    // The native backend runs the app's own update channel for this bundle
    // (`backend_protocol/native_commands/update.rs`).
    inAppUpdates: true,
    menuShortcutIds: MENU_SHORTCUT_IDS,
    async probe(sink: WindowChromeSink) {
      sink.setNative(isAvailable);
      sink.setPlatform(isAvailable ? os : "");
      // The root's window registers after the app mounts (NSH 0.7): the shell
      // attaches to it when it appears instead of giving up on the first look.
      effect(() => {
        const win = mainWindow();
        if (!win) return;
        attachCloseListener(win);
        const bar = win.titleBar();
        const state = win.state();
        // The title bar is hidden (nsh.json `window.titleBar`): the system's
        // controls sit inside the app's own bar and say how wide they are.
        sink.setTitleBarInsets({ left: bar.left, right: bar.right });
        sink.setOverlayTitlebar(os === "macos" && bar.left > 0);
        sink.setSystemWindowControls(os === "macos" || bar.right > 0 || bar.height === 0);
        sink.setFullscreen(state?.mode === "fullScreen");
        sink.setMaximized(state?.mode === "maximized");
      });
    },
    // Drag regions are declared on the bars (`desktop={{ windowDrag: true }}`).
    startDrag() {},
    toggleMaximize() {
      const win = mainWindow();
      if (!win) return;
      win.setMode(win.state()?.mode === "maximized" ? "normal" : "maximized");
    },
    minimize() {
      mainWindow()?.minimize();
    },
    close() {
      requestClose();
    },
    async toggleFullscreen() {
      const win = mainWindow();
      if (!win) throw new Error("The window is not available");
      win.setMode(win.state()?.mode === "fullScreen" ? "normal" : "fullScreen");
    },
    async isFocused() {
      return mainWindow()?.state()?.focused ?? true;
    },
    async pickDirectory(options) {
      if (!deps.pickDirectory) throw new Error("unsupported_in_native_host: pickDirectory");
      return deps.pickDirectory(options);
    },
    async appVersion() {
      return null;
    },
    onCloseRequest(handler) {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },
    async hideAfterCloseRequest() {
      mainWindow()?.hide();
    },
    // The tray icon stays; the window comes back from it or from the Dock.
    async minimizeToTray() {
      mainWindow()?.hide();
    },
    async quit() {
      Application.quit();
    },
    startIntegration(actions) {
      if (!isAvailable) return () => undefined;
      // Desktop cards and the companion pet: floating windows of this app,
      // installed here so they outlive scenes and never exist elsewhere.
      const stopPresence = startDesktopPresence({
        showMain: () => showMainWindow(),
        openInbox: () => {
          showMainWindow();
          actions.openInbox?.();
        },
        openPetSettings: () => {
          showMainWindow();
          (actions.openPetSettings ?? actions.openSettings)();
        },
      });
      effect(() => Menu.setApplicationMenu(buildApplicationMenu(actions)));
      effect(() => {
        if (!deps.trayIcon) return;
        Tray.set({
          icon: deps.trayIcon,
          tooltip: tr("product.name"),
          menu: buildTrayMenu(actions),
          // macOS opens the menu on a click, as menu bar extras do; elsewhere a
          // click brings the window back and the secondary click opens the menu.
          onClick: os === "macos" ? undefined : () => showMainWindow(),
        });
      });
      return () => {
        stopPresence();
        stopNotificationPress?.();
        stopNotificationPress = null;
        Menu.setApplicationMenu(null);
        Tray.set(null);
      };
    },
    async setTrayUnreadCount(count) {
      trayUnread.set(count);
    },
    async showSystemNotification(title, body) {
      let permission = await Notifications.permission();
      if (permission === "default" && !notificationPermissionAsked) {
        notificationPermissionAsked = true;
        permission = await Notifications.requestPermission();
      }
      if (permission !== "granted") return;
      // A pressed notification brings the window back.
      stopNotificationPress ??= Notifications.on("press", () => showMainWindow());
      await Notifications.show({ id: `openbitfun-${Date.now()}`, title, body });
    },
  };
}

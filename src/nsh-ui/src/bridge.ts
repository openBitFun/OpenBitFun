// The app-side bridge: the only door from the scenes and stores to a backend
// and to the shell around the window. Scenes never call `host` directly.
//
// Two things are injected before the app mounts, each with a default:
// - the backend connection (`installBackendConnection`): by default the legacy
//   page host (`host.js`: Tauri IPC in the desktop webview, fixtures elsewhere);
//   the native desktop installs its in-process connection instead.
// - the window shell (`installWindowShell`): by default the Tauri webview's;
//   the native desktop installs the NSH desktop shell.

import { computed, signal } from "nsh";
import {
  errorMessageOf,
  type BackendConnection,
  type BackendEvent,
  type ConnectionState,
  type TransportKind,
} from "./backendConnection";
import { createHostPageConnection } from "./hostPageConnection";
import {
  DROP_EVENT,
  decodePeerReply,
  isOwnerOnlyEvent,
  peerRouteFor,
  scopeEventToSurface,
  staysOnController,
} from "./peerRouting";
import { peerScope } from "./peerState";
import { createTextChunkCoalescer, TEXT_CHUNK_EVENT } from "./textChunkCoalescer";
import {
  createHostPageShell,
  type ShellActions,
  type WindowChromeSink,
  type WindowShell,
} from "./windowShell";

export type { TransportKind, ConnectionState } from "./backendConnection";
export type { WindowChromeState, ShellActions } from "./windowShell";
export { decodePeerReply, PEER_EVENT_SOURCE_KEY, PEER_EVENT_WRAPPED_PAYLOAD_KEY } from "./peerRouting";

// ── Backend connection ───────────────────────────────────────────────────────

const pageConnection = createHostPageConnection();
const activeConnection = signal<BackendConnection>(pageConnection);

const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
let channelOpen = false;
let stopEvents: (() => void) | null = null;

/** The wire the installed connection uses; the legacy page host reports `tauri` or `dev`. */
export const transport = computed<TransportKind>(() => activeConnection().kind);
/** Where the backend connection stands. */
export const connectionState = computed<ConnectionState>(() => activeConnection().state());
/** Why the connection failed or is reconnecting; `""` otherwise. */
export const connectionError = computed<string>(() => activeConnection().error());

export function transportKind(): TransportKind {
  return transport();
}

/** The installed connection, for code that must read its `ready()` or `lastSeq()`. */
export function backendConnection(): BackendConnection {
  return activeConnection();
}

/**
 * Replaces the backend connection. Call it before the app mounts (the native
 * desktop entry does); an already open event channel moves to the new one.
 */
export function installBackendConnection(connection: BackendConnection): void {
  const previous = activeConnection();
  if (previous === connection) return;
  stopEvents?.();
  stopEvents = null;
  for (const event of eventListeners.keys()) previous.unwatch?.(event);
  activeConnection.set(connection);
  textChunks.clear();
  if (channelOpen) {
    stopEvents = connection.subscribe(deliverBatch);
    for (const event of eventListeners.keys()) connection.watch?.(event);
  }
  // Starting is the connection's; reading it here moves its state off `connecting`.
  void connection.ready().catch(() => undefined);
}

// ── Peer Device Mode over OBP (mesh) ─────────────────────────────────────────
//
// While a mesh peer is driven, its backend is a second connection: registry
// `Proxied` commands and every non-owner event go there, `ControllerLocal`
// commands and owner-only events stay on `activeConnection`.

const peerConnection = signal<BackendConnection | null>(null);
let stopPeerEvents: (() => void) | null = null;

/** The connection to the driven mesh peer's backend, or `null`. */
export function activePeerConnection(): BackendConnection | null {
  return peerConnection();
}

/**
 * Makes `connection` the data backend for every `Proxied` command and event
 * (`null` returns this surface to this machine's backend). The caller sets the
 * peer scope in the same step.
 */
export function installPeerConnection(connection: BackendConnection | null): void {
  if (peerConnection() === connection) return;
  stopPeerEvents?.();
  stopPeerEvents = null;
  peerTextChunks.clear();
  peerConnection.set(connection);
  if (connection && channelOpen) stopPeerEvents = connection.subscribe(deliverPeerBatch);
}

/** True while this surface's data backend is a mesh peer. */
function drivingMeshPeer(): boolean {
  return peerConnection() !== null && peerScope()?.transport === "mesh";
}

async function runCommand<T>(
  action: string,
  args: Record<string, unknown> | undefined,
  positional: boolean,
): Promise<T> {
  const peer = peerConnection();
  if (peer && peerScope()?.transport === "mesh" && !staysOnController(action)) {
    try {
      return (await peer.invoke(action, args, { positional })) as T;
    } catch (error) {
      if (errorMessageOf(error)) throw error;
      throw new Error(`${action} failed on the peer`);
    }
  }
  const connection = activeConnection();
  // backend-owned: Peer Device Mode is a routing decision the UI still makes (`peerRouting.ts`).
  const route = peerRouteFor(peerScope(), action, args, positional);
  if (route) {
    let raw: unknown;
    try {
      raw = await connection.invoke(route.command, route.args, { positional: true });
    } catch (error) {
      if (errorMessageOf(error)) throw error;
      throw new Error(`${route.command} failed for ${action}`);
    }
    return decodePeerReply<T>(action, raw);
  }
  try {
    return (await connection.invoke(action, args, { positional })) as T;
  } catch (error) {
    if (errorMessageOf(error)) throw error;
    throw new Error(`${action} failed`);
  }
}

/**
 * Runs one backend command. Every desktop command takes a single `request`
 * object, so callers pass the request body and never the transport envelope.
 *
 * While this surface drives a peer, the command goes to that device unless the
 * Product Operation Registry keeps it on the controller (account, relay, window
 * and updater work). Peer Device Mode never falls back to local product data.
 */
export function invokeCommand<T>(action: string, request?: Record<string, unknown>): Promise<T> {
  return runCommand<T>(action, request === undefined || request === null ? undefined : { request }, false);
}

/**
 * Runs a command whose Tauri signature is not the `request` struct (the account
 * and device commands take positional arguments), passing the arguments as they
 * are.
 *
 * The positional commands that drive a session belong to whichever host runs the
 * turn — `submit_user_answers` must reach the tool future that is waiting, and an
 * MCP or ACP server is started where its files are. So this takes the same peer
 * route as `invokeCommand`, only with the arguments unwrapped: a peer host reads
 * `request` when it exists and the top-level object otherwise.
 */
export function invokeRawCommand<T>(action: string, params?: Record<string, unknown>): Promise<T> {
  return runCommand<T>(action, params ?? undefined, true);
}

function deliverToListeners(event: string, payload: unknown): void {
  const listeners = eventListeners.get(event);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(payload);
    } catch (error) {
      console.error(`event listener failed for ${event}`, error);
    }
  }
}

function dispatchEvent(event: string, payload: unknown, peerDeviceId?: string): void {
  if (drivingMeshPeer()) {
    // This machine's backend keeps only what belongs to its owner; the peer's
    // stream carries the product state the surface renders.
    if (isOwnerOnlyEvent(event)) deliverToListeners(event, payload);
    return;
  }
  const listeners = eventListeners.get(event);
  if (!listeners) return;
  // backend-owned: local and peer streams are told apart by the source tag.
  const scoped = scopeEventToSurface(
    event,
    payload,
    peerDeviceId,
    peerScope()?.deviceId ?? null,
    transport() !== "dev",
  );
  if (scoped === DROP_EVENT) return;
  for (const listener of [...listeners]) {
    try {
      listener(scoped);
    } catch (error) {
      console.error(`event listener failed for ${event}`, error);
    }
  }
}

// Wires that deliver every chunk as emitted get the same per-frame merge `host.js` does.
const textChunks = createTextChunkCoalescer((event, payload) => dispatchEvent(event, payload));

function deliverBatch(batch: readonly BackendEvent[]): void {
  const merge = activeConnection().coalescesTextChunks !== true;
  for (const item of batch) {
    if (merge) textChunks.push(item.event, item.payload);
    else dispatchEvent(item.event, item.payload, item.peerDeviceId);
  }
}

/** A mesh peer's events: never owner-only (its backend withholds them), never tagged. */
function dispatchPeerEvent(event: string, payload: unknown): void {
  if (!drivingMeshPeer() || isOwnerOnlyEvent(event)) return;
  deliverToListeners(event, payload);
}

const peerTextChunks = createTextChunkCoalescer(dispatchPeerEvent);

function deliverPeerBatch(batch: readonly BackendEvent[]): void {
  for (const item of batch) peerTextChunks.push(item.event, item.payload);
}

/** Opens the single backend event channel. Safe to call more than once. */
export function openHostEventChannel(): void {
  if (channelOpen) return;
  channelOpen = true;
  stopEvents = activeConnection().subscribe(deliverBatch);
  const peer = peerConnection();
  if (peer && !stopPeerEvents) stopPeerEvents = peer.subscribe(deliverPeerBatch);
}

/** Subscribes one backend event; the returned function unsubscribes. */
export function listenEvent<T>(event: string, listener: (payload: T) => void): () => void {
  openHostEventChannel();
  let listeners = eventListeners.get(event);
  if (!listeners) {
    listeners = new Set();
    eventListeners.set(event, listeners);
    activeConnection().watch?.(event);
  }
  const entry = listener as (payload: unknown) => void;
  listeners.add(entry);
  return () => {
    const current = eventListeners.get(event);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) {
      eventListeners.delete(event);
      if (event === TEXT_CHUNK_EVENT) textChunks.clear();
      activeConnection().unwatch?.(event);
    }
  };
}

// ── Window shell ─────────────────────────────────────────────────────────────

let shell: WindowShell = createHostPageShell({
  invokeCommand,
  listenEvent,
  noteTransport: kind => {
    if (kind === "tauri" || kind === "dev") pageConnection.noteTransport(kind);
  },
});
let windowChromeProbe: Promise<void> | null = null;

/** Replaces the window shell. Call it before the app mounts. */
export function installWindowShell(next: WindowShell): void {
  shell = next;
  windowChromeProbe = null;
}

/** True only in a native macOS window whose traffic lights sit over the app's bar. */
export const macOverlayTitlebar = signal<boolean>(false);
/** True while the native macOS window is entering or inside fullscreen mode. */
export const windowFullscreen = signal<boolean>(false);
/** The host platform the window chrome probe reported (`macos`, `windows`, `linux`). */
export const windowPlatform = signal<string>("");
/** True when the page runs inside a native desktop window (not fixtures). */
export const nativeWindow = signal<boolean>(false);
/** True while the native window is maximized (Windows/Linux frame controls). */
export const windowMaximized = signal<boolean>(false);
/** Widths the system's window controls take inside a hidden title bar; `null` when the shell does not say. */
const titleBarInsets = signal<{ left: number; right: number } | null>(null);
/** The system draws minimize / maximize / close (macOS always; a native NSH window everywhere). */
const systemWindowControls = signal<boolean>(false);

/** Left inset in px required to keep top-bar chrome clear of macOS traffic lights. */
export const trafficLightInsetPx = computed<number>(() => {
  if (windowFullscreen()) return 0;
  const insets = titleBarInsets();
  if (insets) return insets.left > 0 ? Math.ceil(insets.left) + 8 : 0;
  return macOverlayTitlebar() ? 78 : 0;
});
/** Right inset in px the system's window controls take inside the app's bar (Windows, GTK). */
export const windowControlsRightInsetPx = computed<number>(() => {
  const right = titleBarInsets()?.right ?? 0;
  return !windowFullscreen() && right > 0 ? Math.ceil(right) : 0;
});
/**
 * Windows and Linux build the Tauri window with `decorations(false)`, so the page
 * draws minimize / maximize / close itself; macOS keeps its traffic lights, and
 * a native NSH window keeps the system's controls on every platform.
 */
export const pageDrawsWindowControls = computed<boolean>(
  () => nativeWindow() && windowPlatform() !== "" && windowPlatform() !== "macos" && !systemWindowControls(),
);

const chromeSink: WindowChromeSink = {
  setNative: value => nativeWindow.set(value),
  setPlatform: value => windowPlatform.set(value),
  setOverlayTitlebar: value => macOverlayTitlebar.set(value),
  setFullscreen: value => windowFullscreen.set(value),
  setMaximized: value => windowMaximized.set(value),
  setTitleBarInsets: value => titleBarInsets.set(value),
  setSystemWindowControls: value => systemWindowControls.set(value),
};

/**
 * Probes the window chrome once and keeps it current. Call it while the app
 * renders: a native shell ties its window listeners to the component.
 */
export function initWindowChrome(): Promise<void> {
  if (!windowChromeProbe) windowChromeProbe = shell.probe(chromeSink).catch(() => undefined);
  return windowChromeProbe;
}

/** The title bar regions are declared on views (`desktop={{ windowDrag }}`), not started on press. */
/** Which shell draws this UI (`host-page`, `nsh-desktop` or `browser`). */
export function windowShellId(): WindowShell["id"] {
  return shell.id;
}

export function usesNativeDragRegions(): boolean {
  return shell.nativeDragRegions;
}

/** Shell shortcuts the native application menu carries; the page does not bind them again. */
export function shellMenuShortcutIds(): ReadonlySet<string> {
  return shell.menuShortcutIds;
}

/** The app's own updater answers in this window. */
export function inAppUpdatesAvailable(): boolean {
  return nativeWindow() && shell.inAppUpdates;
}

/** Minimizes the native window. No-op off a native window. */
export function minimizeWindow(): void {
  shell.minimize();
}

/** Asks the native window to close; the close request handler decides what happens. */
export function closeWindow(): void {
  shell.close();
}

/** Starts a native window drag when clicking empty titlebar chrome. No-op off a native window. */
export function startWindowDrag(): void {
  shell.startDrag();
}

/** Toggles window maximize/zoom on titlebar double-click. No-op off a native window. */
export function toggleWindowMaximize(): void {
  shell.toggleMaximize();
}

/** Enters or leaves full screen; rejects with the shell's reason. */
export function toggleWindowFullscreen(): Promise<void> {
  return shell.toggleFullscreen();
}

/** Whether the page (and so the window) has keyboard focus; `true` when unknown. */
export function isWindowFocused(): Promise<boolean> {
  return shell.isFocused();
}

/**
 * Opens the native folder picker on this machine. Resolves the chosen path, or
 * `null` when the user cancelled. Rejects when no native picker exists (fixtures,
 * plain browser) so the caller can say so instead of silently doing nothing.
 */
export function pickLocalDirectory(options: { title: string; defaultPath?: string }): Promise<string | null> {
  return shell.pickDirectory(options);
}

/** This window's own build version (never a peer's); `null` when nothing reports one. */
export async function controllerAppVersion(): Promise<string | null> {
  try {
    const fromShell = await shell.appVersion();
    if (fromShell) return fromShell;
    return (await activeConnection().ready()).version;
  } catch {
    return null;
  }
}

/** The user asked to close the main window; returns the unsubscriber. */
export function onMainWindowCloseRequest(handler: () => void): () => void {
  return shell.onCloseRequest(handler);
}

/** Hides the main window after a close request (macOS keeps running). */
export function hideMainWindowAfterCloseRequest(): Promise<void> {
  return shell.hideAfterCloseRequest();
}

/** Hides the main window behind the tray. */
export function minimizeMainWindowToTray(): Promise<void> {
  return shell.minimizeToTray();
}

/** Quits the application. */
export function quitApplication(): Promise<void> {
  return shell.quit();
}

/** Builds the application menu and the tray around `actions`. Call while rendering. */
export function startShellIntegration(actions: ShellActions): () => void {
  return shell.startIntegration(actions);
}

/** The unread count the tray shows. */
export function setTrayUnreadCount(count: number): Promise<void> {
  return shell.setTrayUnreadCount(count);
}

/** An OS notification, where the shell has them. */
export function showSystemNotification(title: string, body: string): Promise<void> {
  return shell.showSystemNotification(title, body);
}

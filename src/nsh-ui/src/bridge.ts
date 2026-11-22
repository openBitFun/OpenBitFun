// The app-side bridge: the only door from the scenes and stores to a backend
// and to the shell around the window. Scenes never call `host` directly.
//
// Two things are injected before the app mounts, each with a default:
// - the backend connection (`installBackendConnection`): by default the legacy
//   page host (`host.js`: Tauri IPC in the desktop webview, fixtures elsewhere);
//   the native desktop installs its in-process connection instead.
// - the window shell (`installWindowShell`): by default the Tauri webview's;
//   the native desktop installs the NSH desktop shell.

import { computed, effect, signal, untracked } from "nsh";
import {
  errorMessageOf,
  type BackendConnection,
  type BackendEvent,
  type ConnectionState,
  type TransportKind,
} from "./backendConnection";
import {
  advanceFleetCursor,
  EVENTS_DROPPED_EVENT as FLEET_EVENTS_DROPPED,
  fleetCursorHasSeen,
  type FleetCursor,
  type FleetHelloAnswer,
} from "./fleetTypes";
import type { FleetOwnerEntity } from "./generated/peerSurface";
import { createHostPageConnection } from "./hostPageConnection";
import { fleetRouteFor } from "./peerRouting";
import { createTextChunkCoalescer, TEXT_CHUNK_EVENT, type TextChunkCoalescer } from "./textChunkCoalescer";
import {
  createHostPageShell,
  type ShellActions,
  type WindowChromeSink,
  type WindowShell,
} from "./windowShell";

export type { TransportKind, ConnectionState } from "./backendConnection";
export type { WindowChromeState, ShellActions } from "./windowShell";

// ── Backend connection ───────────────────────────────────────────────────────

const pageConnection = createHostPageConnection();
const activeConnection = signal<BackendConnection>(pageConnection);
// (The page host is never a fleet entry; `watchReadyFleet` runs for installed connections.)

/** What an event listener learns besides the payload. */
export interface EventMeta {
  /**
   * The device the event comes from: the frame's origin on a fleet stream, the
   * entry's own device id for its untagged events, and `""` on a connection
   * without the fleet layer (one backend, one device).
   */
  origin: string;
  /** The origin's backend instance, when the stream names it. */
  originInstance: string | null;
  /** The origin's own seq, when the stream numbers events. */
  seq: number | null;
}

/** Options of one command call. */
export interface InvokeCommandOptions {
  /**
   * The device that runs the command on a fleet connection. Omitted, the owner
   * of the id the command acts on is used, else the device context. Ignored on
   * a connection without the fleet layer.
   */
  target?: string | null;
}

type EventListener = (payload: unknown, meta: EventMeta) => void;

const eventListeners = new Map<string, Set<EventListener>>();
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

// ── Fleet ────────────────────────────────────────────────────────────────────
//
// A backend whose handshake answered `fleet` is a fleet entry: every account
// device is reached through it (`fleet_call`), and its stream tags events with
// their origin device. A backend without it is an older host, and the UI keeps
// today's single-device behavior.

/** The `fleet` member of a connection's ready info (for wires without a live hello). */
const readyFleet = signal<FleetHelloAnswer | null>(null);
/** The entry device id other code learned (the navigator's own row, the entry candidate). */
const entryDeviceHint = signal<string | null>(null);

/** The fleet answer of the installed connection, or `null` (an older backend). */
export const fleetHello = computed<FleetHelloAnswer | null>(() => {
  const connection = activeConnection();
  return connection.fleet?.() ?? readyFleet();
});

/** True while the installed connection is a fleet entry. */
export const fleetActive = computed<boolean>(() => fleetHello() !== null);

/** The entry's own device id: its hello's, else what the fleet index or the entry walker said. */
export const entryDeviceId = computed<string | null>(() => fleetHello()?.deviceId ?? entryDeviceHint());

/** Records the entry's device id when the handshake did not name it (fleet store, entry walker). */
export function noteFleetEntryDevice(deviceId: string | null): void {
  if (entryDeviceHint() !== deviceId) entryDeviceHint.set(deviceId);
}

let readDeviceContext: () => string | null = () => null;
const ownerLookups: Partial<Record<FleetOwnerEntity, (id: string) => string | null>> = {};

function resolveOwner(entity: FleetOwnerEntity, id: string): string | null {
  return ownerLookups[entity]?.(id) ?? null;
}

/** The state module tells the bridge which device the UI is looking at (the default target). */
export function setFleetDeviceContextReader(reader: () => string | null): void {
  readDeviceContext = reader;
}

/**
 * Tells the bridge which device owns an id of one entity kind (the fleet store
 * for sessions and workspaces, the terminal store for terminals), so a command
 * acting on it is addressed to that device.
 */
export function setFleetOwnerLookup(entity: FleetOwnerEntity, lookup: (id: string) => string | null): void {
  ownerLookups[entity] = lookup;
}

/** The device a command runs on by default: the device context, else the entry. */
export function fleetDeviceContext(): string | null {
  return readDeviceContext() || entryDeviceId();
}

let readyFleetSettled = false;

function watchReadyFleet(connection: BackendConnection): void {
  readyFleet.set(null);
  readyFleetSettled = false;
  if (connection.fleet) return;
  void connection.ready().then(
    info => {
      if (activeConnection() !== connection) return;
      readyFleet.set(info.fleet ?? null);
      readyFleetSettled = true;
    },
    () => {
      if (activeConnection() === connection) readyFleetSettled = true;
    },
  );
}

const HANDSHAKE_WAIT_MS = 30_000;

/**
 * Whether the installed connection has yet to say if it is a fleet entry, so a
 * command is addressed the right way from the first call. Only connections
 * whose calls wait for their handshake anyway are waited for (a WebSocket or
 * entry walker before its hello, the native host before its ready info); the
 * page host and an idle controller connection answer at once, as before.
 */
export function fleetHandshakePending(): boolean {
  const connection = activeConnection();
  return connection.fleet
    ? connection.fleet() === null && connection.state() === "connecting"
    : (connection.kind === "native" || connection.kind === "mesh") && !readyFleetSettled;
}

/** Resolves once `fleetHandshakePending()` is over (or after the handshake wait). */
export async function settleFleetHandshake(): Promise<void> {
  if (!fleetHandshakePending()) return;
  const connection = activeConnection();
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    connection.ready().then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, HANDSHAKE_WAIT_MS);
    }),
  ]);
  if (timer !== null) clearTimeout(timer);
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
  stopFleetEventPoll();
  for (const event of eventListeners.keys()) previous.unwatch?.(event);
  activeConnection.set(connection);
  entryDeviceHint.set(null);
  watchReadyFleet(connection);
  clearTextChunks();
  if (channelOpen) {
    stopEvents = connection.subscribe(deliverBatch);
    for (const event of eventListeners.keys()) connection.watch?.(event);
    startFleetEventPollIfNeeded();
  }
  // Starting is the connection's; reading it here moves its state off `connecting`.
  void connection.ready().catch(() => undefined);
}

async function invokeOn(
  connection: BackendConnection,
  command: string,
  args: Record<string, unknown> | undefined,
  positional: boolean,
  failure: string,
): Promise<unknown> {
  try {
    return await connection.invoke(command, args, { positional });
  } catch (error) {
    if (errorMessageOf(error)) throw error;
    throw new Error(failure);
  }
}

async function runCommand<T>(
  action: string,
  args: Record<string, unknown> | undefined,
  positional: boolean,
  options: InvokeCommandOptions | undefined,
): Promise<T> {
  if (fleetHandshakePending()) await settleFleetHandshake();
  const connection = activeConnection();
  if (fleetActive()) {
    const route = fleetRouteFor(action, args, {
      target: options?.target ?? null,
      ownerOf: resolveOwner,
      deviceContext: fleetDeviceContext,
    });
    if (route) return (await invokeOn(connection, route.command, route.args, false, `${action} failed`)) as T;
    return (await invokeOn(connection, action, args, positional, `${action} failed`)) as T;
  }
  return (await invokeOn(connection, action, args, positional, `${action} failed`)) as T;
}

/**
 * Runs one backend command. Every desktop command takes a single `request`
 * object, so callers pass the request body and never the transport envelope.
 *
 * On a fleet connection the command is addressed to a device (`options.target`,
 * else the owner of the id it acts on, else the device context) and sent as
 * `fleet_call`; the entry's own fleet verbs and controller-local commands go
 * plain. Without the fleet layer there is one backend and one device. The
 * command never falls back to local product data.
 */
export function invokeCommand<T>(
  action: string,
  request?: Record<string, unknown>,
  options?: InvokeCommandOptions,
): Promise<T> {
  return runCommand<T>(action, request === undefined || request === null ? undefined : { request }, false, options);
}

/**
 * Runs a command whose Tauri signature is not the `request` struct (the account
 * and device commands take positional arguments), passing the arguments as they
 * are.
 *
 * The positional commands that drive a session belong to whichever host runs the
 * turn — `submit_user_answers` must reach the tool future that is waiting, and an
 * MCP or ACP server is started where its files are. So this takes the same
 * routes as `invokeCommand`, only with the arguments unwrapped.
 */
export function invokeRawCommand<T>(
  action: string,
  params?: Record<string, unknown>,
  options?: InvokeCommandOptions,
): Promise<T> {
  return runCommand<T>(action, params ?? undefined, true, options);
}

function metaOf(origin: string | undefined, originInstance?: string, seq?: number): EventMeta {
  return {
    origin: origin || (fleetActive() ? (entryDeviceId() ?? "") : ""),
    originInstance: originInstance ?? null,
    seq: typeof seq === "number" ? seq : null,
  };
}

function deliverToListeners(event: string, payload: unknown, meta: EventMeta): void {
  const listeners = eventListeners.get(event);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(payload, meta);
    } catch (error) {
      console.error(`event listener failed for ${event}`, error);
    }
  }
}

function dispatchEvent(event: string, payload: unknown, item?: Omit<BackendEvent, "event" | "payload">): void {
  if (fleetActive()) {
    // A fleet stream is attributed by origin; nothing is filtered out here.
    deliverToListeners(event, payload, metaOf(item?.origin, item?.originInstance, item?.seq));
    return;
  }
  deliverToListeners(event, payload, metaOf(undefined, undefined, item?.seq));
}

// Wires that deliver every chunk as emitted get the same per-frame merge `host.js`
// does, one merge per origin (a fleet stream has no order across origins).
const textChunksByOrigin = new Map<string, TextChunkCoalescer>();

function textChunksFor(origin: string, originInstance: string | undefined): TextChunkCoalescer {
  const key = `${origin}\u0000${originInstance ?? ""}`;
  let coalescer = textChunksByOrigin.get(key);
  if (!coalescer) {
    coalescer = createTextChunkCoalescer((event, payload) =>
      dispatchEvent(event, payload, origin ? { origin, ...(originInstance ? { originInstance } : {}) } : undefined),
    );
    textChunksByOrigin.set(key, coalescer);
  }
  return coalescer;
}

function clearTextChunks(): void {
  for (const coalescer of textChunksByOrigin.values()) coalescer.clear();
  textChunksByOrigin.clear();
}

/**
 * Text chunks go through the per-origin merge; every other event releases that
 * origin's pending chunks first and is delivered with its own seq and origin.
 */
function deliverItem(item: BackendEvent, merge: boolean): void {
  if (!merge) {
    dispatchEvent(item.event, item.payload, item);
    return;
  }
  if (item.event === TEXT_CHUNK_EVENT) {
    textChunksFor(item.origin ?? "", item.originInstance).push(item.event, item.payload);
    return;
  }
  textChunksByOrigin.get(`${item.origin ?? ""}\u0000${item.originInstance ?? ""}`)?.flush();
  dispatchEvent(item.event, item.payload, item);
}

function deliverBatch(batch: readonly BackendEvent[]): void {
  const merge = activeConnection().coalescesTextChunks !== true;
  for (const item of batch) deliverItem(item, merge);
}

// ── Peer origins on the native desktop ───────────────────────────────────────
//
// The native desktop's in-process stream carries only its own events. On a
// fleet entry it long-polls `fleet_events {cursor, waitMs}` for every other
// origin; the cursor is per origin and drops what was already delivered.

const FLEET_EVENTS_WAIT_MS = 25_000;
let fleetPoll: { stop(): void } | null = null;

function stopFleetEventPoll(): void {
  fleetPoll?.stop();
  fleetPoll = null;
}

function startFleetEventPollIfNeeded(): void {
  const connection = activeConnection();
  if (fleetPoll || !channelOpen || connection.kind !== "native" || !fleetActive()) return;
  let stopped = false;
  fleetPoll = { stop: () => (stopped = true) };
  const cursor: FleetCursor = {};
  void (async () => {
    let backoffMs = 250;
    while (!stopped && activeConnection() === connection && fleetActive()) {
      let answer: { events?: unknown };
      try {
        answer = ((await connection.invoke(
          "fleet_events",
          { request: { cursor, waitMs: FLEET_EVENTS_WAIT_MS } },
          { positional: false },
        )) ?? {}) as { events?: unknown };
        backoffMs = 250;
      } catch (error) {
        if (stopped) return;
        console.warn(`Fleet event poll failed: ${errorMessageOf(error)}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs = Math.min(10_000, backoffMs * 2);
        continue;
      }
      if (stopped || activeConnection() !== connection) return;
      const self = entryDeviceId();
      const frames: BackendEvent[] = [];
      for (const raw of Array.isArray(answer.events) ? answer.events : []) {
        const frame = (raw ?? {}) as Record<string, unknown>;
        const origin = typeof frame.origin === "string" ? frame.origin : "";
        const instance = typeof frame.originInstance === "string" ? frame.originInstance : "";
        if (!origin || typeof frame.event !== "string" || origin === self) continue;
        const seq = typeof frame.seq === "number" ? frame.seq : undefined;
        if (seq !== undefined && frame.event === FLEET_EVENTS_DROPPED) {
          // The origin skipped ahead: its cursor restarts at the notice's own seq.
          cursor[origin] = { instanceId: instance, seq };
        } else if (seq !== undefined) {
          if (fleetCursorHasSeen(cursor, origin, instance, seq)) continue;
          advanceFleetCursor(cursor, origin, instance, seq);
        }
        frames.push({ event: frame.event, payload: frame.payload ?? null, origin, originInstance: instance, seq });
      }
      for (const item of frames) deliverItem(item, true);
    }
  })();
}

// The poll follows the fleet answer, which a native connection reports through `ready()`.
effect(() => {
  const active = fleetActive();
  untracked(() => {
    if (active) startFleetEventPollIfNeeded();
    else stopFleetEventPoll();
  });
});

/** Opens the single backend event channel. Safe to call more than once. */
export function openHostEventChannel(): void {
  if (channelOpen) return;
  channelOpen = true;
  stopEvents = activeConnection().subscribe(deliverBatch);
  startFleetEventPollIfNeeded();
}

/**
 * Subscribes one backend event; the returned function unsubscribes. The
 * listener's second argument says which device the event comes from.
 */
export function listenEvent<T>(event: string, listener: (payload: T, meta: EventMeta) => void): () => void {
  openHostEventChannel();
  let listeners = eventListeners.get(event);
  if (!listeners) {
    listeners = new Set();
    eventListeners.set(event, listeners);
    activeConnection().watch?.(event);
  }
  const entry = listener as EventListener;
  listeners.add(entry);
  return () => {
    const current = eventListeners.get(event);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) {
      eventListeners.delete(event);
      if (event === TEXT_CHUNK_EVENT) clearTextChunks();
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

import { computed, host, signal } from "nsh";
import { PEER_CONTROLLER_LOCAL_COMMANDS } from "./generated/peerSurface";
import { peerScope } from "./peerState";

/** Which host answered: the desktop backend, or the development fixtures. */
export type TransportKind = "tauri" | "dev";

interface HostReply<T> {
  ok: boolean;
  value?: T;
  error?: string;
  transport?: TransportKind;
}

interface HostEventEnvelope {
  event: string;
  payload: unknown;
  /** Optional peer device attribution for forwarded peer events. */
  peerDeviceId?: string;
}

export interface WindowChromeState {
  native?: boolean;
  platform?: string;
  overlayTrafficLights?: boolean;
  isFullscreen?: boolean;
}

const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
let channelOpen = false;
let windowChromeInitialized = false;

/** The transport the last answered call used; the shell shows it. */
export const transport = signal<TransportKind>("dev");

/** True only in a native macOS Tauri window with native overlay traffic lights. */
export const macOverlayTitlebar = signal<boolean>(false);
/** True while the native macOS window is entering or inside fullscreen mode. */
export const windowFullscreen = signal<boolean>(false);
/** Left inset in px required to keep top-bar chrome clear of macOS traffic lights. */
export const trafficLightInsetPx = computed<number>(() =>
  macOverlayTitlebar() && !windowFullscreen() ? 78 : 0,
);

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

/**
 * Probes host window-chrome capabilities once and subscribes to macOS native
 * fullscreen phase events. Gracefully no-ops in headless tests and plain browsers.
 */
export async function initWindowChrome(): Promise<void> {
  if (windowChromeInitialized) return;
  windowChromeInitialized = true;
  try {
    const reply = await host.call<HostReply<WindowChromeState>>("openbitfun.windowChrome", {});
    if (reply?.transport && reply.transport !== transport()) transport.set(reply.transport);
    if (!reply || reply.ok !== true || !reply.value) return;
    const overlay = reply.value.overlayTrafficLights === true;
    macOverlayTitlebar.set(overlay);
    windowFullscreen.set(reply.value.isFullscreen === true);
    if (overlay) {
      listenEvent<unknown>("window://fullscreen-chrome", payload => {
        const next = parseFullscreenPhase(payload);
        if (next !== null) windowFullscreen.set(next);
      });
    }
  } catch {
    // Headless test harnesses and older hosts do not expose windowChrome; stay at 0 inset.
  }
}

/** Starts a native window drag when clicking empty titlebar chrome. No-op off native Tauri. */
export function startWindowDrag(): void {
  void host.call<HostReply<boolean>>("openbitfun.windowDrag", {}).catch(() => undefined);
}

/** Toggles window maximize/zoom on titlebar double-click. No-op off native Tauri. */
export function toggleWindowMaximize(): void {
  void host.call<HostReply<boolean>>("openbitfun.windowToggleMaximize", {}).catch(() => undefined);
}

export function transportKind(): TransportKind {
  return transport();
}

/** Payload key injected by the Rust controller on re-emitted Peer DeviceEvents. */
export const PEER_EVENT_SOURCE_KEY = "__openbitfunSourceDeviceId";
/** Wrapper key used when a peer payload is not a JSON object. */
export const PEER_EVENT_WRAPPED_PAYLOAD_KEY = "__openbitfunSourcePayload";

const SURFACE_SCOPED_EVENTS = new Set<string>([
  "terminal_event",
  "terminal-output",
  "terminal-exit",
  "terminal-closed",
  "relay://session-gap",
  "relay://session-ready",
  "session-record",
  "session-state",
  "file-system-changed",
  "file-watch-status-changed",
  "permission://event",
  "account://settings-applied",
  "ai://model-catalog-updated",
  "session_title_generated",
  "workspace-catalog-changed",
  "host-catalog-changed",
  "cron://jobs-changed",
]);

function isSurfaceScopedEvent(event: string): boolean {
  return (
    SURFACE_SCOPED_EVENTS.has(event) ||
    event.startsWith("agentic://") ||
    event.startsWith("backend-event-")
  );
}

function readSourceDeviceId(payload: unknown, fallback?: string): string | null {
  if (payload && typeof payload === "object") {
    const tagged = (payload as Record<string, unknown>)[PEER_EVENT_SOURCE_KEY];
    if (typeof tagged === "string" && tagged.length > 0) return tagged;
  }
  return typeof fallback === "string" && fallback.length > 0 ? fallback : null;
}

function unwrapSurfacePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  if (!(PEER_EVENT_SOURCE_KEY in record)) return payload;
  if (PEER_EVENT_WRAPPED_PAYLOAD_KEY in record) {
    return record[PEER_EVENT_WRAPPED_PAYLOAD_KEY];
  }
  const { [PEER_EVENT_SOURCE_KEY]: _source, ...rest } = record;
  return rest;
}

/**
 * Runs one backend command. Every desktop command takes a single `request`
 * object, so callers pass the request body and never the transport envelope.
 *
 * While this surface drives a peer, the command goes to that device unless the
 * Product Operation Registry keeps it on the controller (account, relay, window
 * and updater work). Peer Device Mode never falls back to local product data.
 */
export async function invokeCommand<T>(
  action: string,
  request?: Record<string, unknown>,
): Promise<T> {
  const peer = peerScope();
  if (peer && !PEER_CONTROLLER_LOCAL_COMMANDS.has(action)) {
    const reply = await host.call<HostReply<string>>(
      "openbitfun.invoke",
      {
        action: "account_device_rpc",
        raw: {
          targetDeviceId: peer.deviceId,
          commandJson: JSON.stringify({
            cmd: "host_invoke",
            command: action,
            args: { request: request ?? null },
          }),
          timeoutMs: null,
        },
      },
      { timeout: 0 },
    );
    if (reply?.transport && reply.transport !== transport()) transport.set(reply.transport);
    if (!reply || reply.ok !== true) {
      throw new Error(reply?.error || `account_device_rpc failed for ${action}`);
    }
    return decodePeerReply<T>(action, reply.value);
  }
  // A command may legitimately outlive the 30 s host default (agent creation,
  // large file reads on a remote workspace), so the bridge waits.
  const reply = await host.call<HostReply<T>>(
    "openbitfun.invoke",
    { action, request: request ?? null },
    { timeout: 0 },
  );
  if (reply?.transport && reply.transport !== transport()) transport.set(reply.transport);
  if (!reply || reply.ok !== true) {
    throw new Error(reply?.error || `${action} failed`);
  }
  return reply.value as T;
}

/**
 * Reads one `host_invoke_result` envelope a peer host returned. The transport
 * failure and the host's own refusal stay distinct messages.
 */
export function decodePeerReply<T>(action: string, raw: unknown): T {
  let envelope: { resp?: string; ok?: boolean; value?: unknown; error?: string; message?: string };
  try {
    envelope =
      typeof raw === "string"
        ? (JSON.parse(raw) as typeof envelope)
        : ((raw ?? {}) as typeof envelope);
  } catch {
    throw new Error(`The peer sent an unreadable reply to ${action}`);
  }
  if (envelope.resp === "error") {
    throw new Error(envelope.message || `The peer refused ${action}`);
  }
  if (envelope.resp !== "host_invoke_result") {
    throw new Error(`The peer answered ${action} with ${envelope.resp ?? "no envelope"}`);
  }
  if (envelope.ok !== true) {
    throw new Error(envelope.error || `The peer refused ${action}`);
  }
  return envelope.value as T;
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
export async function invokeRawCommand<T>(
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const peer = peerScope();
  if (peer && !PEER_CONTROLLER_LOCAL_COMMANDS.has(action)) {
    const reply = await host.call<HostReply<string>>(
      "openbitfun.invoke",
      {
        action: "account_device_rpc",
        raw: {
          targetDeviceId: peer.deviceId,
          commandJson: JSON.stringify({
            cmd: "host_invoke",
            command: action,
            args: params ?? null,
          }),
          timeoutMs: null,
        },
      },
      { timeout: 0 },
    );
    if (reply?.transport && reply.transport !== transport()) transport.set(reply.transport);
    if (!reply || reply.ok !== true) {
      throw new Error(reply?.error || `account_device_rpc failed for ${action}`);
    }
    return decodePeerReply<T>(action, reply.value);
  }
  const reply = await host.call<HostReply<T>>(
    "openbitfun.invoke",
    { action, raw: params ?? null },
    { timeout: 0 },
  );
  if (reply?.transport && reply.transport !== transport()) transport.set(reply.transport);
  if (!reply || reply.ok !== true) {
    throw new Error(reply?.error || `${action} failed`);
  }
  return reply.value as T;
}

/** Opens the single host event channel. Safe to call more than once. */
export function openHostEventChannel(): void {
  if (channelOpen) return;
  channelOpen = true;
  host.on<HostEventEnvelope>("openbitfun.event", envelope => {
    if (!envelope || typeof envelope.event !== "string") return;
    let payload = envelope.payload;
    if (isSurfaceScopedEvent(envelope.event)) {
      const sourceDeviceId = readSourceDeviceId(payload, envelope.peerDeviceId);
      const activePeerId = peerScope()?.deviceId ?? null;
      // Real Rust tags every re-emitted peer event with `__openbitfunSourceDeviceId`
      // (`remote_connect_api::PEER_EVENT_SOURCE_KEY`) and leaves local host events
      // untagged (`null`). On native Tauri transport, enforce strict surface match so
      // local and peer streams never bleed into each other; in dev/headless mocks
      // without the Rust controller tagger, still enforce tags whenever present.
      if (transport() === "tauri") {
        if (sourceDeviceId !== activePeerId) return;
      } else if (sourceDeviceId !== null && sourceDeviceId !== activePeerId) {
        return;
      }
      payload = unwrapSurfacePayload(payload);
    }
    const listeners = eventListeners.get(envelope.event);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`event listener failed for ${envelope.event}`, error);
      }
    }
  });
}

/** Subscribes one backend event; the returned function unsubscribes. */
export function listenEvent<T>(event: string, listener: (payload: T) => void): () => void {
  openHostEventChannel();
  let listeners = eventListeners.get(event);
  if (!listeners) {
    listeners = new Set();
    eventListeners.set(event, listeners);
    void host.call("openbitfun.listen", { event }).catch(() => undefined);
  }
  const entry = listener as (payload: unknown) => void;
  listeners.add(entry);
  return () => {
    const current = eventListeners.get(event);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) {
      eventListeners.delete(event);
      void host.call("openbitfun.unlisten", { event }).catch(() => undefined);
    }
  };
}

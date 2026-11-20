// Peer Device Mode: this surface drives another same-account device.
//
// Two transports, negotiated per device when the user picks it:
// - `mesh`: the device runs a version on the account mesh and advertises
//   `obp_v1` + `mesh_v1` (`mesh_list_devices`). This machine's backend opens an
//   authenticated OBP link to it (`peer_link_connect`) and the bridge makes
//   that link this surface's data backend (`meshPeerConnection.ts`): calls go
//   straight to the peer's dispatch and its events stream live.
// - `relay`: an older device. The controller keeps its own window, account and
//   relay calls, and sends the product commands to the target host over
//   `account_device_rpc` HostInvoke.
// A device seen on the mesh is never driven over the old relay, even when the
// mesh cannot reach it for a moment: that state is reported instead.
//
// Nothing here falls back to this machine's data: a peer that is offline, does
// not answer, or refuses a command reports that state, because silently showing
// local sessions as another device's is how a user edits the wrong machine.

import { Storage, computed } from "nsh";
import {
  activePeerConnection,
  backendConnection,
  decodePeerReply,
  installPeerConnection,
  invokeCommand,
  invokeRawCommand,
} from "./bridge";
import { errorMessageOf } from "./backendConnection";
import { tr } from "./i18n";
import { loadLocalDeviceId } from "./devicePrefsStore";
import {
  PEER_LINK_CONNECT,
  PEER_LINK_DISCONNECT,
  createMeshPeerConnection,
  type MeshPeerConnection,
  type PeerLinkInfo,
} from "./meshPeerConnection";
import { peerBusy, peerError, peerReconnecting, peerScope, type PeerScope, type PeerTransport } from "./peerState";

interface PingReply {
  host_type?: string;
  host_ui_ready?: boolean;
  capabilities?: Record<string, unknown>;
}

/** One row of `mesh_list_devices`. */
export interface MeshDeviceEntry {
  deviceId: string;
  name?: string | null;
  virtualIp?: string;
  reachable: boolean;
  path?: string;
  latencyMs?: number;
  obpProtocol?: number;
  capabilities?: string[];
  backendVersion?: string;
  error?: string;
}

/** The capabilities a device must advertise for the OBP-on-mesh path. */
export const MESH_PEER_CAPABILITIES = ["obp_v1", "mesh_v1"] as const;

export type PeerTransportDecision =
  | { transport: "mesh"; entry: MeshDeviceEntry }
  | { transport: "relay"; reason: string }
  | { transport: "refused"; message: string };

/**
 * Picks the transport for `deviceId`. `meshDevices` is this machine's mesh
 * list, or `null` when this machine runs no mesh (an older or Tauri host,
 * signed out of the mesh). Only devices of a version that joins the mesh are
 * ever in it, so a device in the list — or one remembered from it — is a new
 * device and is never sent to the old relay.
 */
export function choosePeerTransport(input: {
  deviceId: string;
  meshDevices: readonly MeshDeviceEntry[] | null;
  meshError?: string;
  rememberedOnMesh: boolean;
  label: string;
}): PeerTransportDecision {
  const entry = input.meshDevices?.find(device => device.deviceId === input.deviceId) ?? null;
  if (entry) {
    const capabilities = entry.capabilities ?? [];
    if (entry.reachable && MESH_PEER_CAPABILITIES.every(capability => capabilities.includes(capability))) {
      return { transport: "mesh", entry };
    }
    if (!entry.reachable) {
      return {
        transport: "refused",
        message: `peer_mesh_unreachable: ${input.label} is on the device mesh but its backend did not answer${entry.error ? ` (${entry.error})` : ""}; try again in a moment`,
      };
    }
    return {
      transport: "refused",
      message: `peer_mesh_protocol: ${input.label} speaks a newer device protocol than this app; update OpenBitFun here`,
    };
  }
  if (input.rememberedOnMesh) {
    return {
      transport: "refused",
      message:
        input.meshDevices === null
          ? `peer_mesh_local_unavailable: ${input.label} is reached over the device mesh, which is not running on this machine${input.meshError ? ` (${input.meshError})` : ""}`
          : `peer_mesh_offline: ${input.label} is not on the device mesh right now; check that it is running and signed in`,
    };
  }
  return {
    transport: "relay",
    reason: input.meshDevices === null ? "this machine runs no device mesh" : "the device is not on the mesh",
  };
}

/** The user-facing sentence for a refusal code from `choosePeerTransport`. */
export function peerRefusalText(message: string, label: string): string {
  const code = message.split(":")[0];
  switch (code) {
    case "peer_mesh_unreachable":
      return tr("peer.meshUnreachable", { label });
    case "peer_mesh_protocol":
      return tr("peer.meshProtocol", { label });
    case "peer_mesh_local_unavailable":
      return tr("peer.meshLocalUnavailable", { label });
    case "peer_mesh_offline":
      return tr("peer.meshOffline", { label });
    default:
      return message;
  }
}

/** Which transport drives the peer, said in the UI (reactive inside bindings). */
export function peerTransportLabel(scope: PeerScope): string {
  if (scope.transport !== "mesh") return tr("peer.transportRelay", { label: scope.label });
  const route =
    scope.meshPath === "p2p"
      ? tr("peer.routeDirect")
      : scope.meshPath === "relayed"
        ? tr("peer.routeRelayed")
        : tr("peer.routeUnknown");
  return typeof scope.latencyMs === "number"
    ? tr("peer.transportMeshLatency", { route, ms: String(Math.max(1, Math.round(scope.latencyMs))) })
    : tr("peer.transportMesh", { route });
}

// ── Devices seen on the mesh (controller-local memory) ───────────────────────

export const MESH_DEVICES_STORAGE_KEY = "openbitfun.mesh-devices.v1";
/** A device not seen on the mesh for this long may be an older install again. */
const MESH_MEMORY_MS = 14 * 24 * 60 * 60 * 1000;

async function readMeshMemory(): Promise<Record<string, number>> {
  try {
    const raw = await Storage.getItem(MESH_DEVICES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

async function rememberMeshDevices(entries: readonly MeshDeviceEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const memory = await readMeshMemory();
  const now = Date.now();
  for (const entry of entries) memory[entry.deviceId] = now;
  for (const [id, at] of Object.entries(memory)) if (now - at > MESH_MEMORY_MS) delete memory[id];
  try {
    await Storage.setItem(MESH_DEVICES_STORAGE_KEY, JSON.stringify(memory));
  } catch (error) {
    console.warn(`Could not remember mesh devices: ${errorMessageOf(error)}`);
  }
}

async function rememberedOnMesh(deviceId: string): Promise<boolean> {
  const at = (await readMeshMemory())[deviceId];
  return typeof at === "number" && Date.now() - at <= MESH_MEMORY_MS;
}

/** This machine's mesh list, or `null` with the reason when it runs no mesh. */
export async function readMeshDevices(): Promise<{ devices: MeshDeviceEntry[] | null; error: string }> {
  try {
    const devices = await invokeCommand<MeshDeviceEntry[]>("mesh_list_devices");
    const list = Array.isArray(devices) ? devices : [];
    void rememberMeshDevices(list);
    return { devices: list, error: "" };
  } catch (error) {
    return { devices: null, error: errorMessageOf(error) };
  }
}

// ── Legacy relay path ────────────────────────────────────────────────────────

/** The handshake's capability map, kept to the booleans it actually states. */
function capabilitiesOf(ping: PingReply | null): Record<string, boolean> {
  const advertised: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(ping?.capabilities ?? {})) {
    if (typeof value === "boolean") advertised[name] = value;
  }
  return advertised;
}

async function enterRelayPeer(deviceId: string, label: string): Promise<boolean> {
  const controller = (await loadLocalDeviceId()) ?? "";
  const ping = await invokePeer<PingReply>(deviceId, "peer_mode_ping", {
    controller_device_id: controller,
  });
  if (ping?.host_ui_ready === false) {
    peerError.set(`${label} is still starting; try again once its window is ready`);
    return false;
  }
  await invokePeer(deviceId, "peer_control_attach", { controller_device_id: controller });
  peerScope.set({
    deviceId,
    label,
    hostKind: typeof ping?.host_type === "string" ? ping.host_type : "unknown",
    capabilityCount: Object.keys(ping?.capabilities ?? {}).length,
    hostUiReady: true,
    capabilities: capabilitiesOf(ping),
    transport: "relay",
  });
  return true;
}

// ── Mesh path ────────────────────────────────────────────────────────────────

function meshScope(deviceId: string, label: string, info: PeerLinkInfo, entry: MeshDeviceEntry | null): PeerScope {
  const capabilities: Record<string, boolean> = {};
  for (const capability of info.hostCapabilities ?? []) capabilities[capability] = true;
  return {
    deviceId,
    label,
    hostKind: "desktop",
    capabilityCount: Object.keys(capabilities).length,
    hostUiReady: true,
    capabilities,
    transport: "mesh",
    meshPath: info.meshPath ?? entry?.path,
    latencyMs: info.latencyMs ?? entry?.latencyMs,
    backendVersion: info.backend?.version ?? entry?.backendVersion,
  };
}

async function openMeshLink(
  deviceId: string,
  label: string,
  entry: MeshDeviceEntry | null,
): Promise<{ scope: PeerScope; connection: MeshPeerConnection }> {
  // `peer_link_connect` is controller-local: it runs on this machine's backend.
  const info = await invokeCommand<PeerLinkInfo>(PEER_LINK_CONNECT, { deviceId });
  const connection = createMeshPeerConnection(backendConnection(), deviceId, info);
  return { scope: meshScope(deviceId, label, info, entry), connection };
}

function adoptMeshLink(scope: PeerScope, connection: MeshPeerConnection): void {
  const previous = activePeerConnection() as MeshPeerConnection | null;
  // Scope and data backend switch together, so no event or command sees one
  // without the other.
  peerScope.set(scope);
  installPeerConnection(connection);
  if (previous && previous !== connection) {
    previous.close();
    if (previous.deviceId !== connection.deviceId) {
      void invokeCommand(PEER_LINK_DISCONNECT, { deviceId: previous.deviceId }).catch(error =>
        console.warn(`Could not close the previous peer link: ${errorMessageOf(error)}`),
      );
    }
  }
}

/** The mesh link's state while a mesh peer is driven; `null` otherwise. */
export const meshLinkState = computed(() => {
  const connection = activePeerConnection();
  return connection && peerScope()?.transport === "mesh" ? connection.state() : null;
});
/** Why the mesh link is reconnecting or failed; `""` otherwise. */
export const meshLinkError = computed(() => {
  const connection = activePeerConnection();
  return connection && peerScope()?.transport === "mesh" ? connection.error() : "";
});

/** The transport the last `enterPeer` picked (for the UI and tests). */
export let lastPeerTransport: PeerTransport | null = null;

/**
 * Attaches to `deviceId`. A failure leaves the surface on this machine and
 * says why, instead of half-entering peer mode.
 */
export async function enterPeer(deviceId: string, label: string): Promise<boolean> {
  if (peerBusy()) return false;
  peerBusy.set(true);
  peerError.set("");
  try {
    const mesh = await readMeshDevices();
    const decision = choosePeerTransport({
      deviceId,
      meshDevices: mesh.devices,
      meshError: mesh.error,
      rememberedOnMesh: await rememberedOnMesh(deviceId),
      label,
    });
    if (decision.transport === "refused") {
      console.warn(`Peer Device Mode refused: device=${deviceId}, reason=${decision.message.split(":")[0]}`);
      peerError.set(peerRefusalText(decision.message, label));
      return false;
    }
    if (decision.transport === "mesh") {
      const { scope, connection } = await openMeshLink(deviceId, label, decision.entry);
      adoptMeshLink(scope, connection);
      lastPeerTransport = "mesh";
      console.info(`Peer Device Mode over the device mesh: device=${deviceId}, path=${scope.meshPath ?? "unknown"}`);
      return true;
    }
    console.info(`Peer Device Mode over the legacy relay: device=${deviceId}, reason=${decision.reason}`);
    const entered = await enterRelayPeer(deviceId, label);
    if (entered) lastPeerTransport = "relay";
    return entered;
  } catch (error) {
    peerError.set(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    peerBusy.set(false);
  }
}

/**
 * Re-runs the handshake for the device already being driven. A link can drop
 * without either side asking, so a command that fails is worth one fresh
 * attach before the surface tells the user the device is gone. It never leaves
 * peer mode on failure: the scope stays so the banner can offer the retry.
 */
export async function reconnectPeer(): Promise<boolean> {
  const scope = peerScope();
  if (!scope || peerBusy() || peerReconnecting()) return false;
  peerReconnecting.set(true);
  peerError.set("");
  try {
    if (scope.transport === "mesh") {
      const { scope: next, connection } = await openMeshLink(scope.deviceId, scope.label, null);
      adoptMeshLink({ ...next, label: scope.label }, connection);
      return true;
    }
    const controller = (await loadLocalDeviceId()) ?? "";
    const ping = await invokePeer<PingReply>(scope.deviceId, "peer_mode_ping", {
      controller_device_id: controller,
    });
    await invokePeer(scope.deviceId, "peer_control_attach", { controller_device_id: controller });
    peerScope.set({
      ...scope,
      hostKind: typeof ping?.host_type === "string" ? ping.host_type : scope.hostKind,
      capabilityCount: Object.keys(ping?.capabilities ?? {}).length,
      capabilities: capabilitiesOf(ping),
    });
    return true;
  } catch (error) {
    peerError.set(
      `${scope.label} did not answer again: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  } finally {
    peerReconnecting.set(false);
  }
}

/**
 * Leaves peer mode. A detach that cannot be delivered is reported but does not
 * keep this surface pointed at a host it can no longer drive.
 */
export async function leavePeer(): Promise<void> {
  const scope = peerScope();
  if (!scope || peerBusy()) return;
  peerBusy.set(true);
  peerError.set("");
  try {
    if (scope.transport === "mesh") {
      const connection = activePeerConnection() as MeshPeerConnection | null;
      peerScope.set(null);
      installPeerConnection(null);
      connection?.close();
      await invokeCommand(PEER_LINK_DISCONNECT, { deviceId: scope.deviceId });
      return;
    }
    await invokePeer(scope.deviceId, "peer_control_detach", {
      controller_device_id: (await loadLocalDeviceId()) ?? "",
    });
  } catch (error) {
    peerError.set(
      `Detach did not reach ${scope.label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    peerScope.set(null);
    peerBusy.set(false);
  }
}

/**
 * Runs one command on a legacy (relay) target host. It bypasses the scope's
 * routing, so the handshake can reach a device that is not the selected one yet.
 */
export async function invokePeer<T>(
  deviceId: string,
  action: string,
  request: Record<string, unknown> | null,
): Promise<T> {
  const reply = await invokeRawCommand<string>("account_device_rpc", {
    targetDeviceId: deviceId,
    commandJson: JSON.stringify({ cmd: "host_invoke", command: action, args: { request } }),
    timeoutMs: null,
  });
  return decodePeerReply<T>(action, reply);
}

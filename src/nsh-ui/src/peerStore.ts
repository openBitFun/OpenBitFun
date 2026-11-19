// Peer Device Mode: this surface drives another same-account device.
//
// The controller keeps its own window, account and relay calls, and sends the
// product commands to the target host over `account_device_rpc` HostInvoke.
// Nothing here falls back to this machine's data: a peer that is offline, does
// not answer, or refuses a command reports that state, because silently showing
// local sessions as another device's is how a user edits the wrong machine.

import { decodePeerReply, invokeRawCommand } from "./bridge";
import { loadLocalDeviceId } from "./devicePrefsStore";
import { peerBusy, peerError, peerReconnecting, peerScope } from "./peerState";

interface PingReply {
  host_type?: string;
  host_ui_ready?: boolean;
  capabilities?: Record<string, unknown>;
}

/** The handshake's capability map, kept to the booleans it actually states. */
function capabilitiesOf(ping: PingReply | null): Record<string, boolean> {
  const advertised: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(ping?.capabilities ?? {})) {
    if (typeof value === "boolean") advertised[name] = value;
  }
  return advertised;
}

/**
 * Attaches to `deviceId`: handshake first, then the control link the host uses
 * to route approvals back. A failure leaves the surface on this machine and
 * says why, instead of half-entering peer mode.
 */
export async function enterPeer(deviceId: string, label: string): Promise<boolean> {
  if (peerBusy()) return false;
  peerBusy.set(true);
  peerError.set("");
  try {
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
    });
    return true;
  } catch (error) {
    peerError.set(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    peerBusy.set(false);
  }
}

/**
 * Re-runs the handshake for the device already being driven. The relay can drop a
 * peer without either side asking, so a command that fails is worth one fresh
 * attach before the surface tells the user the device is gone. It never leaves
 * peer mode on failure: the scope stays so the banner can offer the retry.
 */
export async function reconnectPeer(): Promise<boolean> {
  const scope = peerScope();
  if (!scope || peerBusy() || peerReconnecting()) return false;
  peerReconnecting.set(true);
  peerError.set("");
  try {
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
 * Runs one command on the target host. It bypasses the scope's routing, so the
 * handshake can reach a device that is not the selected one yet.
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

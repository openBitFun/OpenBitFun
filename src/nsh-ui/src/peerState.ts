// Peer Device Mode state on its own, so the transport can read the scope without
// importing the store that drives it (the store calls the transport).

import { signal } from "nsh";

export interface PeerScope {
  deviceId: string;
  /** The alias or name the device list shows. */
  label: string;
  /** `desktop` or `cli`, as the host reported it in its handshake. */
  hostKind: string;
  /** How many capabilities the host advertised. */
  capabilityCount: number;
  /** Whether the host said its window is ready to answer. */
  hostUiReady: boolean;
  /**
   * The patterns the host advertised, kept as booleans. A missing key is a host
   * that did not advertise it, which is not the same as one that said no.
   */
  capabilities: Record<string, boolean>;
}

/** What a host advertised in its handshake; `undefined` when it said nothing. */
export function peerSupports(capability: string): boolean | undefined {
  const scope = peerScope();
  if (!scope) return undefined;
  const value = scope.capabilities[capability];
  return typeof value === "boolean" ? value : undefined;
}

/** The device this surface drives, or `null` while it drives this machine. */
export const peerScope = signal<PeerScope | null>(null);
/** A refusal or transport failure from the last peer attempt. */
export const peerError = signal<string>("");
/** True while a handshake or detach is in flight. */
export const peerBusy = signal(false);
/** True while this surface is re-attaching after the link went quiet. */
export const peerReconnecting = signal(false);

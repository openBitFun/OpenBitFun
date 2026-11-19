// The browser/phone listener of this backend (OBP over WebSocket): status,
// the LAN switch, one-time pairing QR codes and paired-client revocation.
// Every command here is `ControllerLocal`: a paired phone or browser is
// refused by the backend, so this surface shows the refusal instead of a card.

import { openUrl, signal } from "nsh";
import { invokeCommand } from "./bridge";
import { errorMessageOf } from "./backendConnection";

export interface ObpPairedClient {
  id: string;
  name: string;
  createdAtMs: number;
  lastSeenAtMs: number | null;
  connected: boolean;
}

export interface ObpStatus {
  available: boolean;
  unavailableReason?: string;
  protocol: number;
  webUi: boolean;
  loopbackUrl: string | null;
  ownerUrl: string | null;
  lan: {
    enabled: boolean;
    running: boolean;
    port: number | null;
    urls: string[];
    fingerprint: string | null;
    error?: string;
  };
  pairedClients: ObpPairedClient[];
  ownerConnections: number;
  pairedConnections: number;
}

export interface ObpPairingOffer {
  qrPayload: string;
  url: string;
  fingerprint: string;
  expiresAtMs: number;
}

export const obpStatus = signal<ObpStatus | null>(null);
/** Why the status could not be read (an older host, a paired client's scope). */
export const obpError = signal("");
export const obpBusy = signal(false);
export const obpPairing = signal<ObpPairingOffer | null>(null);

/** An older backend has no listener commands at all. */
function describe(error: unknown): string {
  const message = errorMessageOf(error);
  if (message.startsWith("unsupported_in_native_host: obp_") || /unknown|not found|not allowed/i.test(message)) {
    return "obp_update_host";
  }
  if (message.startsWith("forbidden_for_scope:") || message.includes("is local-only")) return "obp_owner_only";
  return message;
}

export async function loadObpStatus(): Promise<void> {
  try {
    obpStatus.set(await invokeCommand<ObpStatus>("obp_get_status"));
    obpError.set("");
  } catch (error) {
    obpStatus.set(null);
    obpError.set(describe(error));
  }
}

async function run(action: () => Promise<void>): Promise<void> {
  if (obpBusy()) return;
  obpBusy.set(true);
  try {
    await action();
    obpError.set("");
  } catch (error) {
    obpError.set(describe(error));
  } finally {
    obpBusy.set(false);
  }
}

export function setObpLanEnabled(enabled: boolean): Promise<void> {
  return run(async () => {
    if (!enabled) obpPairing.set(null);
    obpStatus.set(await invokeCommand<ObpStatus>("obp_set_lan_enabled", { enabled }));
  });
}

export function createObpPairing(): Promise<void> {
  return run(async () => {
    obpPairing.set(await invokeCommand<ObpPairingOffer>("obp_create_pairing", {}));
  });
}

export function revokeObpClient(clientId: string): Promise<void> {
  return run(async () => {
    obpStatus.set(await invokeCommand<ObpStatus>("obp_revoke_paired_client", { clientId }));
  });
}

export function openOwnerBrowser(): Promise<void> {
  return run(async () => {
    const url = obpStatus()?.ownerUrl;
    if (!url) throw new Error("obp_no_loopback");
    await openUrl(url);
  });
}

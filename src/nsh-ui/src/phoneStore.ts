// Devices › Use on phone: a phone or browser opens this backend's UI.
//
// Two routes, both the same NSH UI over OBP with the `paired-client` scope:
// - same network: the LAN listener and its one-time QR (`obp_create_pairing`);
// - anywhere: the phone joins the account's device mesh with the EasyTier app
//   (`mesh_phone_join_info`: network name, secret, peer) and pairs with the
//   mesh listener's QR (`obp_create_pairing {via: "mesh"}`).
// The old relay and `mobile-web` are not used by either route. Every command
// here is `ControllerLocal`, so a paired phone or a peer-driven backend refuses
// them and this store reports which state the surface is in, never a fake QR.

import { signal } from "nsh";
import { errorMessageOf } from "./backendConnection";
import { invokeCommand } from "./bridge";
import type { ObpPairingOffer } from "./obpStore";

export type PhoneRoute = "lan" | "mesh";

export interface MeshPhoneJoinInfo {
  networkName: string;
  networkSecret: string;
  peers: string[];
  easytierVersion: string;
  deviceId?: string;
  virtualIp?: string;
  obpPort?: number;
  webUi: boolean;
}

/** Which tab the panel shows. */
export const phoneRoute = signal<PhoneRoute>("lan");
/** The EasyTier join values; `null` until read or when unavailable. */
export const phoneJoinInfo = signal<MeshPhoneJoinInfo | null>(null);
/** Why the join values are unavailable (a code from `describePhoneError`). */
export const phoneJoinError = signal("");
/** The network secret is shown (and its QR drawn) only after the user asks. */
export const phoneSecretRevealed = signal(false);
/** The current one-time QR per route. */
export const phonePairing = signal<{ route: PhoneRoute; offer: ObpPairingOffer } | null>(null);
export const phonePairingError = signal("");
export const phoneBusy = signal(false);

/**
 * Error text to a stable code the panel translates. Unknown text passes
 * through so a real backend failure is shown as it is.
 */
export function describePhoneError(error: unknown): string {
  const message = errorMessageOf(error);
  if (/^unsupported_in_native_host: (mesh_|obp_)/.test(message) || /unknown command|not found|not allowed/i.test(message)) {
    return "phone_update_host";
  }
  if (message.startsWith("forbidden_for_scope:") || message.includes("is local-only")) return "phone_owner_only";
  if (message.startsWith("mesh_signed_out")) return "phone_mesh_signed_out";
  if (message.startsWith("obp_lan_disabled")) return "phone_lan_off";
  if (message.startsWith("obp_no_lan_address")) return "phone_no_lan_address";
  if (message.startsWith("obp_unavailable")) return "phone_obp_unavailable";
  if (message.startsWith("mesh_unavailable") || message.startsWith("mesh_unsupported")) {
    return `phone_mesh_unavailable:${message}`;
  }
  return message;
}

/** Reads what the EasyTier app needs. Never logs the secret. */
export async function loadPhoneJoinInfo(): Promise<void> {
  try {
    phoneJoinInfo.set(await invokeCommand<MeshPhoneJoinInfo>("mesh_phone_join_info"));
    phoneJoinError.set("");
  } catch (error) {
    phoneJoinInfo.set(null);
    phoneJoinError.set(describePhoneError(error));
  }
}

/** Mints a one-time pairing QR for `route` (five minutes, single use). */
export async function createPhonePairing(route: PhoneRoute): Promise<void> {
  if (phoneBusy()) return;
  phoneBusy.set(true);
  phonePairingError.set("");
  try {
    const offer = await invokeCommand<ObpPairingOffer>("obp_create_pairing", { via: route });
    phonePairing.set({ route, offer });
  } catch (error) {
    phonePairing.set(null);
    phonePairingError.set(describePhoneError(error));
  } finally {
    phoneBusy.set(false);
  }
}

/** Switches the tab; a QR minted for the other route is dropped. */
export function selectPhoneRoute(route: PhoneRoute): void {
  phoneRoute.set(route);
  phonePairingError.set("");
  if (phonePairing()?.route !== route) phonePairing.set(null);
  if (route === "mesh") void loadPhoneJoinInfo();
}

/**
 * The join values as an EasyTier config fragment (TOML keys of
 * `easytier-core --config-file`), for a QR scanner or a paste.
 */
export function joinConfigText(info: MeshPhoneJoinInfo): string {
  const quote = (value: string) => JSON.stringify(value);
  const lines = [
    "[network_identity]",
    `network_name = ${quote(info.networkName)}`,
    `network_secret = ${quote(info.networkSecret)}`,
  ];
  for (const peer of info.peers) lines.push("", "[[peer]]", `uri = ${quote(peer)}`);
  return lines.join("\n");
}

/** Forgets the secret, the QR and the reveal (the scene was left). */
export function resetPhonePanel(): void {
  phoneSecretRevealed.set(false);
  phonePairing.set(null);
  phonePairingError.set("");
}

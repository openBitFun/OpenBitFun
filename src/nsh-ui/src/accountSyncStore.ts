// Account settings sync (Settings › Account and the Preferences caption).
//
// Display only. The backend owns sync (which settings travel, how the
// account's devices exchange them peer to peer, how a conflict resolves; no
// server keeps them) and reports its state through
// `account_settings_sync_status` and the `account://settings-sync-state`
// event; this store keeps the latest answer. When account values land on this
// device the backend sends `account://settings-applied`, and the surface
// re-reads what it draws from the host (appearance, font, content width, send
// policy; the locale listens on its own in `state.ts`).
//
// A host without the commands has no account sync: the caption hides and the
// Account page says so.

import { signal } from "nsh";
import { invokeCommand, listenEvent } from "./bridge";
import { syncContentWidthFromHost } from "./contentWidthStore";
import { loadFontPreference } from "./fontPreferenceStore";
import { loadSendPolicy } from "./sendPolicyStore";
import { syncAppearanceFromHost } from "./themeStore";

export const SETTINGS_SYNC_STATE_EVENT = "account://settings-sync-state";
export const SETTINGS_APPLIED_EVENT = "account://settings-applied";

/** The phase the backend reports; an unknown value draws as unavailable. */
export type AccountSyncPhase =
  | "off"
  | "signed_out"
  | "syncing"
  | "synced"
  | "offline"
  | (string & {});

/** Mirror of `settings_sync::SyncStatus` (camelCase). */
export interface AccountSyncStatus {
  enabled?: boolean;
  phase?: AccountSyncPhase;
  pending?: number;
  lastSyncedAtMs?: number | null;
  /** The account's other devices that sync, and how many are online. */
  peers?: number;
  peersOnline?: number;
  /** Whether "Synced with your account" applies (the backend decides). */
  active?: boolean;
  groups?: string[];
}

export type AccountSyncLoad = "idle" | "loading" | "ready" | "unsupported" | "failed";

export const accountSync = signal<AccountSyncStatus | null>(null);
export const accountSyncLoad = signal<AccountSyncLoad>("idle");
export const accountSyncBusy = signal(false);
export const accountSyncNote = signal("");

function isUnknownCommand(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /not found|unknown command|no answer for|unsupported/i.test(text);
}

let subscribed = false;
const appliedListeners = new Set<(keys: string[]) => void>();

/** Runs `listener` after account values were applied on this device. */
export function onAccountSettingsApplied(listener: (keys: string[]) => void): () => void {
  appliedListeners.add(listener);
  return () => appliedListeners.delete(listener);
}

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  listenEvent<AccountSyncStatus>(SETTINGS_SYNC_STATE_EVENT, payload => {
    if (payload && typeof payload === "object") {
      accountSync.set(payload);
      accountSyncLoad.set("ready");
    }
  });
  listenEvent<{ keys?: unknown }>(SETTINGS_APPLIED_EVENT, payload => {
    const keys = Array.isArray(payload?.keys) ? payload.keys.map(String) : [];
    for (const listener of appliedListeners) {
      try {
        listener(keys);
      } catch (error) {
        console.warn(`Applying account settings failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
}

/** Reads the backend's sync state (and subscribes to its changes once). */
export async function loadAccountSync(): Promise<void> {
  subscribe();
  if (accountSyncLoad() === "idle") accountSyncLoad.set("loading");
  try {
    const status = await invokeCommand<AccountSyncStatus>("account_settings_sync_status", {});
    accountSync.set(status ?? null);
    accountSyncLoad.set("ready");
    accountSyncNote.set("");
  } catch (error) {
    accountSync.set(null);
    accountSyncLoad.set(isUnknownCommand(error) ? "unsupported" : "failed");
    accountSyncNote.set(error instanceof Error ? error.message : String(error));
  }
}

/** Turns account sync on or off for this device; the backend answers the new state. */
export async function setAccountSyncEnabled(enabled: boolean): Promise<void> {
  if (accountSyncBusy()) return;
  accountSyncBusy.set(true);
  try {
    const status = await invokeCommand<AccountSyncStatus>("account_settings_sync_set", { enabled });
    accountSync.set(status ?? null);
    accountSyncNote.set("");
  } catch (error) {
    accountSyncNote.set(error instanceof Error ? error.message : String(error));
  } finally {
    accountSyncBusy.set(false);
  }
}

/** Whether the Preferences pages say "Synced with your account". */
export function accountSyncCaptionShown(): boolean {
  return accountSync()?.active === true;
}

let initialized = false;

/**
 * Reads the sync state, and re-reads what this surface draws from the host
 * whenever account values were applied on the device.
 */
export function initAccountSync(): void {
  if (initialized) return;
  initialized = true;
  onAccountSettingsApplied(() => {
    void syncAppearanceFromHost();
    void loadFontPreference();
    void syncContentWidthFromHost();
    void loadSendPolicy();
  });
  void loadAccountSync();
}

// Desktop control permissions (wave 22 P5). The device in the settings scope
// answers `computer_use_get_status` with its own permission rows (kind, state,
// whether it can still ask, the system pane); a device without desktop
// automation (a CLI host, a phone) refuses the command and the page says so.
// Requests and the system settings pane run on that device.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";

export type ComputerPermissionState = "granted" | "required" | "session_required" | "not_required" | "unavailable";

export interface ComputerPermissionRow {
  kind: string;
  state: ComputerPermissionState | string;
  requestable: boolean;
  settingsUrl?: string | null;
  detail?: string;
}

export interface ComputerUseStatus {
  enabled: boolean;
  platform: string;
  permissions: ComputerPermissionRow[];
}

export const computerUseStatus = signal<ComputerUseStatus | null>(null);
export const computerUseState = signal<"loading" | "ready" | "unsupported" | "failed">("loading");
export const computerUseNotice = signal("");
export const computerUseBusy = signal<string | null>(null);

function readStatus(raw: unknown): ComputerUseStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const permissions = (value.permissions ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(permissions.permissions) ? permissions.permissions : [];
  return {
    enabled: value.computerUseEnabled === true,
    platform: typeof permissions.platform === "string" ? permissions.platform : "",
    permissions: rows
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map(row => ({
        kind: String(row.kind ?? ""),
        state: String(row.state ?? "unavailable"),
        requestable: row.requestable === true,
        settingsUrl: typeof row.settings_url === "string" ? row.settings_url : null,
        ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
      }))
      .filter(row => row.kind !== ""),
  };
}

/** Whether an error says the device has no desktop automation at all. */
function unsupportedError(message: string): boolean {
  return /computer_use_get_status|not available|unsupported|no answer|not implemented|no handler/i.test(message);
}

export async function loadComputerUseStatus(): Promise<void> {
  computerUseState.set("loading");
  try {
    const status = readStatus(await invokeCommand<unknown>("computer_use_get_status"));
    computerUseStatus.set(status);
    computerUseState.set(status ? "ready" : "unsupported");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    computerUseStatus.set(null);
    computerUseState.set(unsupportedError(message) ? "unsupported" : "failed");
    computerUseNotice.set(unsupportedError(message) ? "" : message);
  }
}

/** Asks the OS for one permission on the device; the row shows what it reports afterwards. */
export async function requestComputerPermission(kind: string): Promise<void> {
  computerUseBusy.set(kind);
  try {
    await invokeCommand<unknown>("computer_use_request_permission", { kind });
    computerUseNotice.set("");
  } catch (error) {
    computerUseNotice.set(error instanceof Error ? error.message : String(error ?? ""));
  } finally {
    computerUseBusy.set(null);
    await loadComputerUseStatus();
  }
}

/** The system settings pane the backend opens for a permission kind. */
export function systemSettingsPane(kind: string): string {
  return kind === "screen_recording" ? "screen_capture" : kind;
}

export async function openComputerUseSettings(kind: string): Promise<void> {
  try {
    await invokeCommand<unknown>("computer_use_open_system_settings", { pane: systemSettingsPane(kind) });
    computerUseNotice.set("");
  } catch (error) {
    computerUseNotice.set(error instanceof Error ? error.message : String(error ?? ""));
  }
}

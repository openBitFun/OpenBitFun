// Shared device-scope & host-locality helpers.
//
// Determines whether a command or workspace runs on this client machine vs
// on a remote fleet peer or through a browser/phone controller.

import { entryDeviceId, fleetActive, windowShellId } from "../bridge";
import { controllerPort } from "../controller/controllerPort";
import { fleetDeviceById } from "../fleetStore";
import { deviceContext } from "../state";

/**
 * True when this client is a native desktop shell talking to its own in-process
 * backend (not a browser/phone controller and not scoped to a remote peer).
 */
export function isDeviceOnThisMachine(targetDeviceId?: string | null): boolean {
  if (controllerPort() !== null) return false;
  const shellId = windowShellId();
  if (shellId !== "nsh-desktop" && shellId !== "host-page") return false;
  if (!fleetActive()) return true;
  const effective = targetDeviceId !== undefined ? (targetDeviceId ?? "") : deviceContext();
  if (!effective) return true;
  const entry = entryDeviceId();
  if (entry && effective === entry) return true;
  if (fleetDeviceById(effective)?.isClientDevice === true) return true;
  return !entry;
}

/** True when the target device (default: current `deviceContext()`) is remote to this client. */
export function isRemotePeerContext(targetDeviceId?: string | null): boolean {
  return !isDeviceOnThisMachine(targetDeviceId);
}

/** True when desktop-only native window/explorer shells are available on this client. */
export function isDesktopLocalShell(): boolean {
  if (controllerPort() !== null) return false;
  const shellId = windowShellId();
  return shellId === "nsh-desktop" || shellId === "host-page";
}

/** Stable device-scope prefix for per-device store caches and watch keys. */
export function currentDeviceScopeKey(): string {
  return deviceContext() || "local";
}

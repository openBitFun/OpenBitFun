// Device presentation preferences: which devices the sidebar shows, and in what
// order. They are controller-local, so they live in this app's storage under the
// same keys the React surface's zustand stores persist, and the envelope is the
// same `{ state, version }` shape: a user who switches surfaces keeps one set of
// preferences, and a file either surface wrote still parses here.

import { Storage, signal } from "nsh";
import { invokeRawCommand } from "./bridge";

export const VISIBILITY_STORAGE_KEY = "openbitfun.sidebar-device-visibility.v1";
export const ORDER_STORAGE_KEY = "openbitfun.device-order.v1";

/** Hide flags by device id; a device with no entry stays visible. */
export const hiddenDevices = signal<Record<string, boolean>>({});
/** Device ids in the order the user arranged; unranked devices keep their default order after them. */
export const deviceOrder = signal<string[]>([]);
/** This machine's device id: the default order puts it first, and Peer Device Mode attaches with it. */
export const localDeviceId = signal<string | null>(null);

let localDeviceLookup: Promise<string | null> | null = null;

/**
 * The id this machine reports. The account host is asked once per app run: the
 * answer does not change while the window is open, and the device list, the
 * default order and the peer handshake all read it.
 */
export function loadLocalDeviceId(): Promise<string | null> {
  if (!localDeviceLookup) {
    localDeviceLookup = invokeRawCommand<Record<string, unknown>>("remote_connect_get_device_info")
      .then(info => {
        const record = (info ?? {}) as Record<string, unknown>;
        const id = ["deviceId", "device_id", "id"]
          .map(key => record[key])
          .find(value => typeof value === "string" && value) as string | undefined;
        localDeviceId.set(id ?? null);
        return id ?? null;
      })
      .catch(() => {
        // Without it the order falls back to presence and name, and the peer
        // handshake simply sends no controller id; nothing else changes.
        localDeviceId.set(null);
        return null;
      });
  }
  return localDeviceLookup;
}

export async function loadDevicePreferences(): Promise<void> {
  const [hiddenRaw, orderRaw] = await Promise.all([
    readItem(VISIBILITY_STORAGE_KEY),
    readItem(ORDER_STORAGE_KEY),
  ]);
  hiddenDevices.set(parseHidden(hiddenRaw));
  deviceOrder.set(parseOrder(orderRaw));
}

async function readItem(key: string): Promise<string | null> {
  try {
    return await Storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Both readers accept the persisted envelope, a bare object, or nothing at all: a
 * preference file that an older build or another surface wrote must not throw.
 */
function parseHidden(raw: string | null): Record<string, boolean> {
  const value = parseState(raw, "hidden");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const hidden: Record<string, boolean> = {};
  for (const [id, flag] of Object.entries(value as Record<string, unknown>)) {
    if (typeof flag === "boolean" && id.trim()) hidden[id] = flag;
  }
  return hidden;
}

function parseOrder(raw: string | null): string[] {
  const value = parseState(raw, "order");
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() && !ids.includes(entry)) ids.push(entry);
  }
  return ids;
}

function parseState(raw: string | null, field: string): unknown {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const state = (parsed as { state?: unknown }).state;
    if (state && typeof state === "object") return (state as Record<string, unknown>)[field] ?? null;
    return parsed[field] ?? null;
  } catch {
    return null;
  }
}

async function writeItem(key: string, state: Record<string, unknown>): Promise<void> {
  try {
    await Storage.setItem(key, JSON.stringify({ state, version: 0 }));
  } catch {
    // Storage is a preference cache: a full or unavailable store must not break the scene.
  }
}

export function setDeviceVisible(deviceId: string, visible: boolean): void {
  const next = { ...hiddenDevices(), [deviceId]: !visible };
  hiddenDevices.set(next);
  void writeItem(VISIBILITY_STORAGE_KEY, { hidden: next });
}

export function toggleDeviceVisible(deviceId: string): void {
  setDeviceVisible(deviceId, hiddenDevices()[deviceId] === true);
}

/**
 * Moves one device next to another, as a drag would. The arranged ids come from
 * the caller because only it knows which devices are currently listed.
 */
export function moveDevice(
  deviceId: string,
  targetId: string,
  placement: "before" | "after",
  visibleIds: string[],
): void {
  if (deviceId === targetId) return;
  if (!visibleIds.includes(deviceId) || !visibleIds.includes(targetId)) return;
  const ranked = [...deviceOrder()];
  for (const id of visibleIds) {
    if (!ranked.includes(id)) ranked.push(id);
  }
  const combined = ranked.filter(id => id !== deviceId);
  const targetIndex = combined.indexOf(targetId);
  if (targetIndex < 0) return;
  combined.splice(targetIndex + (placement === "after" ? 1 : 0), 0, deviceId);
  deviceOrder.set(combined);
  void writeItem(ORDER_STORAGE_KEY, { order: combined });
}

/** Default order is this device first, then online devices, then by name. */
export function sortDevices<T extends { id: string; name: string; alias?: string; online: boolean }>(
  items: T[],
  localId: string | null,
): T[] {
  const defaults = [...items].sort((left, right) => {
    if ((left.id === localId) !== (right.id === localId)) return left.id === localId ? -1 : 1;
    if (left.online !== right.online) return left.online ? -1 : 1;
    const leftName = left.alias || left.name;
    const rightName = right.alias || right.name;
    return leftName.localeCompare(rightName) || left.id.localeCompare(right.id);
  });
  const ranks = new Map(deviceOrder().map((id, index) => [id, index]));
  const fallback = deviceOrder().length;
  return defaults.sort(
    (left, right) => (ranks.get(left.id) ?? fallback) - (ranks.get(right.id) ?? fallback),
  );
}

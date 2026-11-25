// The fleet index as the UI shows it: every account device, its workspaces and
// their newest sessions (`fleet_navigator`), and every pending prompt
// (`fleet_prompts`), read from the entry this UI is connected through.
//
// Display only. The backend orders the devices, workspaces and sessions,
// computes the totals and the action gates, and says which device is in which
// state; this store keeps the latest answer and refreshes it when the entry
// says the index or the prompts changed. A delta (`full: false`) replaces the
// changed devices by id; when it could change the backend's order (a new
// device, or a device whose state or name changed) the store reads the full
// view once more instead of placing rows itself. Nothing is merged, sorted or
// counted here.
//
// On a connection without the fleet layer (an older backend) nothing here
// runs: the navigator stays `null` and the UI keeps its single-device lists.

import { computed, effect, signal, untracked } from "nsh";
import {
  entryDeviceId,
  fleetActive,
  fleetHello,
  invokeCommand,
  listenEvent,
  fleetDeviceContext,
  noteFleetEntryDevice,
  setFleetOwnerLookup,
} from "./bridge";
import { errorMessageOf } from "./backendConnection";
import {
  FLEET_INDEX_CHANGED_EVENT,
  FLEET_PROMPTS_CHANGED_EVENT,
  type FleetDevice,
  type FleetNavigator,
  type FleetPrompt,
  type FleetPromptsResponse,
  type FleetSession,
  type FleetTotals,
  type FleetWorkspace,
  type WorkspaceKey,
} from "./fleetTypes";

/** The latest whole navigator view (backend order and totals), or `null` before the first read. */
export const fleetNavigator = signal<FleetNavigator | null>(null);
/** The latest prompt tray, or `null` before the first read. */
export const fleetPrompts = signal<FleetPromptsResponse | null>(null);
/** Why the last navigator or prompts read failed; `""` otherwise. */
export const fleetStoreError = signal("");

/** The devices in the backend's order. */
export const fleetDevices = computed<FleetDevice[]>(() => fleetNavigator()?.devices ?? []);
/** The fleet-wide totals as the backend counted them. */
export const fleetTotals = computed<FleetTotals | null>(() => fleetNavigator()?.totals ?? null);
/** The pending prompts in the backend's order. */
export const fleetPromptList = computed<FleetPrompt[]>(() => fleetPrompts()?.prompts ?? []);

/**
 * Why the fleet view is not available: `entry_without_fleet` when the connected
 * backend answered its handshake without the fleet layer (an older entry: the
 * UI shows that one device and may suggest updating it). `null` on a fleet entry.
 */
export const fleetUnavailable = computed<"entry_without_fleet" | null>(() =>
  fleetActive() ? null : "entry_without_fleet",
);

export function fleetDeviceById(deviceId: string | null | undefined): FleetDevice | null {
  if (!deviceId) return null;
  return fleetDevices().find(device => device.deviceId === deviceId) ?? null;
}

export function fleetWorkspaceByKey(key: WorkspaceKey | null | undefined): FleetWorkspace | null {
  if (!key) return null;
  return fleetDeviceById(key.deviceId)?.workspaces.find(item => item.workspaceId === key.workspaceId) ?? null;
}

/**
 * O(1) lookups over the navigator's session rows, rebuilt only when `fleetDevices()`
 * changes: the first device that lists a session id owns it (the backend's device
 * order), and every row is reachable by `"<deviceId>/<sessionId>"`.
 */
const fleetSessionIndex = computed<{ owners: Map<string, string>; rows: Map<string, FleetSession> }>(() => {
  const owners = new Map<string, string>();
  const rows = new Map<string, FleetSession>();
  for (const device of fleetDevices()) {
    for (const workspace of device.workspaces) {
      for (const session of workspace.sessions) {
        if (!owners.has(session.sessionId)) owners.set(session.sessionId, device.deviceId);
        const key = `${device.deviceId}/${session.sessionId}`;
        if (!rows.has(key)) rows.set(key, session);
      }
    }
  }
  return { owners, rows };
});

/** Session id → the first indexed device that lists it (the index behind `fleetSessionOwner`). */
export function fleetSessionOwners(): ReadonlyMap<string, string> {
  return fleetSessionIndex().owners;
}

/** The device whose index row holds `sessionId`, or `null` when no indexed device lists it. */
export function fleetSessionOwner(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  return fleetSessionIndex().owners.get(sessionId) ?? null;
}

/** The index row of one session on one device. */
export function fleetSessionRow(deviceId: string, sessionId: string): FleetSession | null {
  return fleetSessionIndex().rows.get(`${deviceId}/${sessionId}`) ?? null;
}

/**
 * The device owning a workspace id: workspace ids are unique per device only,
 * so an id listed on more than one device has no single owner (`null`).
 */
export function fleetWorkspaceOwner(workspaceId: string | null | undefined): string | null {
  if (!workspaceId) return null;
  const owners = fleetDevices().filter(device => device.workspaces.some(item => item.workspaceId === workspaceId));
  return owners.length === 1 ? owners[0]!.deviceId : null;
}

// ── Reads ────────────────────────────────────────────────────────────────────

let navigatorInFlight: Promise<void> | null = null;
let navigatorAgain = false;
let fullRequested = false;

function needsFullRead(current: FleetNavigator, delta: FleetNavigator): boolean {
  const byId = new Map(current.devices.map(device => [device.deviceId, device]));
  return delta.devices.some(device => {
    const held = byId.get(device.deviceId);
    return !held || held.state !== device.state || held.name !== device.name || held.isClientDevice !== device.isClientDevice;
  });
}

function applyDelta(current: FleetNavigator, delta: FleetNavigator): FleetNavigator {
  const changed = new Map(delta.devices.map(device => [device.deviceId, device]));
  const removed = new Set(delta.removedDeviceIds ?? []);
  return {
    revision: delta.revision,
    full: true,
    devices: current.devices
      .filter(device => !removed.has(device.deviceId))
      .map(device => changed.get(device.deviceId) ?? device),
    removedDeviceIds: [],
    totals: delta.totals,
  };
}

function noteEntryFromNavigator(view: FleetNavigator): void {
  // The native desktop is the client's own machine; its row names the entry.
  if (fleetHello()?.deviceId) return;
  const own = view.devices.find(device => device.isClientDevice);
  if (own && !entryDeviceId()) noteFleetEntryDevice(own.deviceId);
}

async function readNavigator(full: boolean): Promise<void> {
  const current = fleetNavigator();
  const since = !full && current ? current.revision : undefined;
  const answer = await invokeCommand<FleetNavigator>(
    "fleet_navigator",
    since === undefined ? {} : { sinceRevision: since },
  );
  if (!answer || !Array.isArray(answer.devices)) throw new Error("fleet_navigator answered without devices");
  const held = fleetNavigator();
  if (answer.full !== false || !held) {
    fleetNavigator.set({ ...answer, removedDeviceIds: answer.removedDeviceIds ?? [] });
  } else if (needsFullRead(held, answer)) {
    await readNavigator(true);
    return;
  } else {
    fleetNavigator.set(applyDelta(held, answer));
  }
  noteEntryFromNavigator(fleetNavigator()!);
  fleetStoreError.set("");
}

/**
 * Reads the navigator: a delta after the held revision, or the full view
 * (`full`, or nothing held yet). Concurrent calls share one read and run one
 * more after it, so the latest change is never lost.
 */
export async function refreshFleetNavigator(options?: { full?: boolean }): Promise<void> {
  if (!fleetActive()) return;
  if (navigatorInFlight) {
    navigatorAgain = true;
    if (options?.full) fullRequested = true;
    return navigatorInFlight;
  }
  let full = options?.full === true;
  navigatorInFlight = (async () => {
    try {
      do {
        navigatorAgain = false;
        const wantFull = full || fullRequested;
        fullRequested = false;
        full = false;
        try {
          await readNavigator(wantFull);
        } catch (error) {
          fleetStoreError.set(errorMessageOf(error));
          console.warn(`Fleet navigator read failed: ${errorMessageOf(error)}`);
        }
      } while (navigatorAgain && fleetActive());
    } finally {
      navigatorInFlight = null;
    }
  })();
  return navigatorInFlight;
}

let promptsInFlight: Promise<void> | null = null;
let promptsAgain = false;

/** Reads the prompt tray (the entry answers it whole). */
export async function refreshFleetPrompts(): Promise<void> {
  if (!fleetActive()) return;
  if (promptsInFlight) {
    promptsAgain = true;
    return promptsInFlight;
  }
  promptsInFlight = (async () => {
    try {
      do {
        promptsAgain = false;
        try {
          const answer = await invokeCommand<FleetPromptsResponse>("fleet_prompts", {});
          fleetPrompts.set({ revision: answer?.revision ?? 0, prompts: Array.isArray(answer?.prompts) ? answer.prompts : [] });
          fleetStoreError.set("");
        } catch (error) {
          fleetStoreError.set(errorMessageOf(error));
          console.warn(`Fleet prompts read failed: ${errorMessageOf(error)}`);
        }
      } while (promptsAgain && fleetActive());
    } finally {
      promptsInFlight = null;
    }
  })();
  return promptsInFlight;
}

/** Drops the held views (the connection moved to an entry with another index, or lost fleet). */
export function resetFleetStore(): void {
  fleetNavigator.set(null);
  fleetPrompts.set(null);
  fleetStoreError.set("");
}

let started = false;

/**
 * Starts following the fleet index once per app: the first full reads, then a
 * delta read on every `fleet://index-changed` and a prompts read on every
 * `fleet://prompts-changed`. Safe to call on any connection; on one without the
 * fleet layer the reads are skipped.
 */
export function startFleetStore(): void {
  if (started) return;
  started = true;
  setFleetOwnerLookup("session", fleetSessionOwner);
  // Workspace ids repeat across devices: the device context wins when it lists the id.
  setFleetOwnerLookup("workspace", id => {
    const context = fleetDeviceContext();
    if (context && fleetDeviceById(context)?.workspaces.some(item => item.workspaceId === id)) return context;
    return fleetWorkspaceOwner(id);
  });
  listenEvent<{ revision?: number }>(FLEET_INDEX_CHANGED_EVENT, payload => {
    const held = fleetNavigator()?.revision;
    if (typeof payload?.revision === "number" && held !== undefined && payload.revision <= held) return;
    void refreshFleetNavigator();
  });
  listenEvent<{ revision?: number }>(FLEET_PROMPTS_CHANGED_EVENT, payload => {
    const held = fleetPrompts()?.revision;
    if (typeof payload?.revision === "number" && held !== undefined && payload.revision <= held) return;
    void refreshFleetPrompts();
  });
  // The fleet answer arrives with the handshake (or the native ready info),
  // possibly after this runs, and changes when the client moves to another entry.
  let wasActive = false;
  effect(() => {
    const active = fleetActive();
    if (active === wasActive) return;
    wasActive = active;
    untracked(() => {
      if (active) {
        void refreshFleetNavigator({ full: true });
        void refreshFleetPrompts();
      } else {
        resetFleetStore();
      }
    });
  });
}

/** Re-reads both views from scratch (a new entry, or a gap in the index events). */
export async function rehydrateFleetStore(): Promise<void> {
  if (!fleetActive()) return;
  await Promise.allSettled([refreshFleetNavigator({ full: true }), refreshFleetPrompts()]);
}

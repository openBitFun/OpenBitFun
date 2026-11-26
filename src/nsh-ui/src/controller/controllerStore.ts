// The controller shell's state: sign in (email, then code), the account's
// devices, and the device this window drives. Every fact comes from the
// installed `ControllerPort`; this store only remembers what the shell shows.
//
// After sign-in nothing asks the user which device to use: the shell connects
// to the device this page was opened for (the web handoff), or to the one
// `pickUiSourceDevice` ranks first, and tries the next one when a connection
// fails. The device list appears only when none can be used (none online,
// every one too old) or when the user asks for it (Switch device).

import { signal } from "nsh";
import { installBackendConnection } from "../bridge";
import { FLEET_PROTOCOL_VERSION, type FleetCursor } from "../fleetTypes";
import { fleetEntryCandidates, withFleetFailover } from "./fleetEntry";
import { currentLocale } from "../i18n";
import {
  controllerErrorCode,
  controllerPort,
  ControllerError,
  type ControllerAccount,
  type ControllerCodeChallenge,
  type ControllerConnection,
  type ControllerDevice,
  type ControllerErrorCode,
  type ControllerUiUpdate,
} from "./controllerPort";

/**
 * `opening`: connecting to a device, or leaving this page for a device's own
 * UI (`controllerOpening` names the device; `null` while going back to the list).
 */
export type ControllerPhase = "starting" | "email" | "code" | "opening" | "devices" | "connected";

export interface ControllerFailure {
  code: ControllerErrorCode;
  message: string;
  retryAfterSeconds: number | null;
  /** What it is about (a UI file), when the code has one. */
  detail: string | null;
}

export const controllerPhase = signal<ControllerPhase>("starting");
export const controllerAccount = signal<ControllerAccount | null>(null);
export const controllerChallenge = signal<ControllerCodeChallenge | null>(null);
export const controllerDevices = signal<ControllerDevice[] | null>(null);
export const controllerBusy = signal(false);
export const controllerFailure = signal<ControllerFailure | null>(null);
/** The device being connected now (its row shows progress). */
export const controllerConnecting = signal<string | null>(null);
/** The device this window drives. */
export const controllerDevice = signal<ControllerDevice | null>(null);
/** How long the last connect took (shown in the device bar). */
export const controllerConnectMs = signal<number | null>(null);
/** The device being opened while the phase is `opening` (`null`: going back to the list). */
export const controllerOpening = signal<ControllerDevice | null>(null);
/** Newer web UI bundle ready to load without forcibly interrupting the active tab. */
export const controllerUiUpdate = signal<ControllerUiUpdate | null>(null);
/** True while applying a web UI update (navigating to the new bundle). */
export const controllerUiUpdating = signal(false);

let connection: ControllerConnection | null = null;
let stopUiEventWatch: (() => void) | null = null;
let uiCheckTimer: ReturnType<typeof setTimeout> | null = null;
let uiCheckInFlight = false;
let dismissedUiBundleId: string | null = null;
/** The device this page was opened for, until the first device list is read. */
let launchDevice: string | null = null;
/** Pick nothing at the first device list (the user asked to see it, or a UI failed). */
let launchShowsDevices = false;
/** Why the previous page came back (a UI file failed), shown on the first list. */
let launchFailure: ControllerFailure | null = null;

function failure(error: unknown): ControllerFailure {
  return {
    code: controllerErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
    retryAfterSeconds: error instanceof ControllerError ? error.retryAfterSeconds : null,
    detail: error instanceof ControllerError ? error.detail : null,
  };
}

/** Compares two dotted versions (`1.0.12` > `1.0.9`); a missing one is the oldest. */
function compareVersions(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const left = a.split(/[.+-]/);
  const right = b.split(/[.+-]/);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = Number.parseInt(left[index] ?? "0", 10);
    const y = Number.parseInt(right[index] ?? "0", 10);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      const x2 = left[index] ?? "";
      const y2 = right[index] ?? "";
      if (x2 !== y2) return x2 < y2 ? -1 : 1;
    } else if (x !== y) {
      return x - y;
    }
  }
  return 0;
}

/** Lower is closer: the Link route the port reported, unknown last. */
const ROUTE_RANK: Record<string, number> = {
  direct_lan: 0,
  direct_ipv6: 1,
  direct_ipv4: 1,
  relayed_peer: 2,
  relayed_server: 3,
};

function routeRank(device: ControllerDevice): number {
  return device.route ? (ROUTE_RANK[device.route] ?? 4) : 5;
}

/**
 * The device whose UI this page loads and drives, among those not yet tried.
 * When the backend supplies ranked `entryCandidates`, that server/native order
 * is respected verbatim (display-only); only older hosts without
 * `entryCandidates` fall back to version/route ranking. `null` when none is left.
 */
export function pickUiSourceDevice(
  devices: readonly ControllerDevice[],
  tried: ReadonlySet<string> = new Set(),
  rankedIds?: readonly string[] | null,
): ControllerDevice | null {
  const candidates = devices.filter(device => device.connectable && !device.unavailable && !tried.has(device.deviceId));
  if (rankedIds && rankedIds.length > 0) {
    const byId = new Map(candidates.map(device => [device.deviceId, device]));
    for (const id of rankedIds) {
      const match = byId.get(id);
      if (match) return match;
    }
  }
  candidates.sort(
    (a, b) =>
      compareVersions(b.clientVersion, a.clientVersion) ||
      routeRank(a) - routeRank(b) ||
      Number(b.online) - Number(a.online),
  );
  return candidates[0] ?? null;
}

async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
  if (controllerBusy()) return undefined;
  controllerBusy.set(true);
  controllerFailure.set(null);
  try {
    return await work();
  } catch (error) {
    const reason = failure(error);
    controllerFailure.set(reason);
    if (reason.code === "signed_out" && controllerPhase() !== "email" && controllerPhase() !== "code") {
      controllerAccount.set(null);
      controllerPhase.set("email");
    }
    return undefined;
  } finally {
    controllerBusy.set(false);
  }
}

/** Restores a signed-in session and opens a device (or shows the email step). */
export async function startController(): Promise<void> {
  const port = controllerPort();
  if (!port) return;
  controllerPhase.set("starting");
  try {
    const launch = port.launchState ? await port.launchState() : null;
    launchDevice = launch?.deviceId ?? null;
    launchShowsDevices = launch?.showDevices === true || launch?.failure != null;
    launchFailure = launch?.failure ? failure(launch.failure) : null;
    const account = await port.restore();
    controllerAccount.set(account);
    if (account) {
      await openUiSourceDevice();
    } else {
      if (launchFailure) controllerFailure.set(launchFailure);
      launchFailure = null;
      controllerPhase.set("email");
    }
  } catch (error) {
    controllerFailure.set(failure(error));
    controllerPhase.set("email");
  }
}

/**
 * Reads the account's devices and connects to the UI source: the device this
 * page was opened for, else `pickUiSourceDevice`'s choice, then the next one
 * while connections fail. Ends on the device list when none can be used.
 */
async function openUiSourceDevice(): Promise<void> {
  const port = controllerPort();
  if (!port) return;
  controllerOpening.set(null);
  controllerPhase.set("opening");
  const devices = await run(() => port.listDevices());
  if (!devices) {
    controllerPhase.set(controllerAccount() ? "devices" : "email");
    return;
  }
  controllerDevices.set(devices);
  if (launchShowsDevices) {
    launchShowsDevices = false;
    launchDevice = null;
    if (launchFailure) controllerFailure.set(launchFailure);
    launchFailure = null;
    controllerPhase.set("devices");
    return;
  }
  const ranked = await fleetEntryCandidates(port);
  const tried = new Set<string>();
  const first = launchDevice ? devices.find(device => device.deviceId === launchDevice && device.connectable) : undefined;
  launchDevice = null;
  let next: ControllerDevice | null = first ?? pickUiSourceDevice(devices, tried, ranked);
  let tooOld = 0;
  while (next) {
    tried.add(next.deviceId);
    const outcome = await connectControllerDevice(next, { fromList: false, rankedCandidates: ranked });
    if (outcome === "connected" || outcome === "away") return;
    const reason = controllerFailure();
    if (reason?.code === "signed_out") return;
    // This page itself must be reloaded: another device would not help.
    if (reason?.code === "page_outdated") break;
    if (reason?.code === "device_ui_unavailable") tooOld += 1;
    next = pickUiSourceDevice(devices, tried, ranked);
  }
  if (tried.size > 1 && tooOld === tried.size) {
    controllerFailure.set({
      code: "device_ui_unavailable",
      message: "Every online device is too old to open in a browser",
      retryAfterSeconds: null,
      detail: "all",
    });
  }
  controllerPhase.set(controllerAccount() ? "devices" : "email");
}

export async function requestControllerCode(email: string): Promise<void> {
  const port = controllerPort();
  if (!port) return;
  const challenge = await run(() => port.requestCode(email.trim(), { locale: currentLocale() }));
  if (challenge) {
    controllerChallenge.set(challenge);
    controllerPhase.set("code");
  }
}

export async function verifyControllerCode(code: string): Promise<void> {
  const port = controllerPort();
  const challenge = controllerChallenge();
  if (!port || !challenge) return;
  const account = await run(() => port.verifyCode(challenge, code.replace(/\s+/g, "")));
  if (account) {
    controllerAccount.set(account);
    controllerChallenge.set(null);
    await openUiSourceDevice();
  }
}

/** Back to the email step (another address, or a code that expired). */
export function restartControllerSignIn(): void {
  controllerChallenge.set(null);
  controllerFailure.set(null);
  controllerPhase.set("email");
}

export async function refreshControllerDevices(): Promise<void> {
  const port = controllerPort();
  if (!port) return;
  const devices = await run(() => port.listDevices());
  if (devices) controllerDevices.set(devices);
}

export type ConnectOutcome = "connected" | "away" | "failed";

function stopUiUpdateWatch(): void {
  if (uiCheckTimer !== null) {
    clearTimeout(uiCheckTimer);
    uiCheckTimer = null;
  }
  stopUiEventWatch?.();
  stopUiEventWatch = null;
  controllerUiUpdate.set(null);
  controllerUiUpdating.set(false);
}

/**
 * Checks whether the active device or its fleet now advertises a newer web UI
 * bundle than this page is running (e.g. after `openbitfun update` restarted
 * the CLI daemon or a peer device rejoined on a newer build).
 */
export async function checkControllerUiUpdate(): Promise<void> {
  const port = controllerPort();
  const active = connection;
  if (!port?.checkUiUpdate || !active || active.state() !== "connected" || uiCheckInFlight) return;
  uiCheckInFlight = true;
  try {
    const update = await port.checkUiUpdate(active);
    if (connection !== active) return;
    if (!update) {
      controllerUiUpdate.set(null);
      return;
    }
    if (dismissedUiBundleId === update.bundleId) return;
    controllerUiUpdate.set(update);
  } finally {
    uiCheckInFlight = false;
  }
}

function scheduleControllerUiUpdateCheck(delayMs = 800): void {
  if (uiCheckTimer !== null) clearTimeout(uiCheckTimer);
  uiCheckTimer = setTimeout(() => {
    uiCheckTimer = null;
    void checkControllerUiUpdate();
  }, delayMs);
}

export function dismissControllerUiUpdate(): void {
  const current = controllerUiUpdate();
  if (current) dismissedUiBundleId = current.bundleId;
  controllerUiUpdate.set(null);
}

export async function applyControllerUiUpdate(): Promise<void> {
  const current = controllerUiUpdate();
  if (!current || controllerUiUpdating()) return;
  controllerUiUpdating.set(true);
  try {
    await current.apply();
  } catch (error) {
    controllerUiUpdating.set(false);
    const reason = failure(error);
    controllerFailure.set(reason);
    if (reason.code === "signed_out") {
      controllerAccount.set(null);
      controllerPhase.set("email");
    }
  }
}

function startUiUpdateWatch(active: ControllerConnection): void {
  stopUiUpdateWatch();
  if (!controllerPort()?.checkUiUpdate) return;
  stopUiEventWatch = active.subscribe(events => {
    if (connection !== active) return;
    for (const item of events) {
      if (item.event === "fleet://digest-changed" || item.event === "backend://events-dropped") {
        scheduleControllerUiUpdateCheck();
        return;
      }
    }
  });
}

/**
 * Connects to `device` and places its UI: here, or this page leaves for the
 * device's own UI. A failure stays in `controllerFailure`; from the list
 * (`fromList`, the default) the list stays, otherwise the caller decides.
 */
export async function connectControllerDevice(
  device: ControllerDevice,
  options: { fromList?: boolean; rankedCandidates?: readonly string[] | null } = {},
): Promise<ConnectOutcome> {
  const port = controllerPort();
  if (!port || controllerConnecting()) return "failed";
  const fromList = options.fromList !== false;
  controllerConnecting.set(device.deviceId);
  controllerFailure.set(null);
  if (!fromList) {
    controllerOpening.set(device);
    controllerPhase.set("opening");
  }
  const started = Date.now();
  let opened: ControllerConnection | null = null;
  try {
    // A fleet hello with a cursor the entry walker keeps if this device is lost.
    const cursor: FleetCursor = {};
    opened = await port.connect(device.deviceId, { fleet: { protocol: FLEET_PROTOCOL_VERSION, cursor } });
    const placement = port.placeUi ? await port.placeUi(opened) : ({ kind: "here" } as const);
    if (placement.kind === "away") {
      // This page leaves for the device's own UI, which connects again.
      opened.close();
      opened = null;
      controllerOpening.set(device);
      controllerPhase.set("opening");
      await placement.open();
      return "away";
    }
    stopUiUpdateWatch();
    connection?.close();
    connection = await withFleetFailover(port, device.deviceId, opened, cursor, options.rankedCandidates);
    startUiUpdateWatch(connection);
    controllerConnectMs.set(Date.now() - started);
    installBackendConnection(connection);
    controllerDevice.set(device);
    controllerPhase.set("connected");
    return "connected";
  } catch (error) {
    opened?.close();
    const reason = failure(error);
    controllerFailure.set(reason);
    if (reason.code === "signed_out") {
      controllerAccount.set(null);
      controllerPhase.set("email");
    } else if (fromList) {
      controllerPhase.set("devices");
    }
    return "failed";
  } finally {
    controllerConnecting.set(null);
  }
}

/** Leaves the device (back to the list); the window stops driving it. */
export async function leaveControllerDevice(): Promise<void> {
  const port = controllerPort();
  stopUiUpdateWatch();
  connection?.close();
  connection = null;
  installBackendConnection(createIdleConnection());
  controllerDevice.set(null);
  if (port?.leave) {
    controllerOpening.set(null);
    controllerPhase.set("opening");
    const leaving = await port.leave().catch(() => false);
    if (leaving) return;
  }
  controllerPhase.set("devices");
  await refreshControllerDevices();
}

export async function signOutController(): Promise<void> {
  const port = controllerPort();
  if (!port) return;
  stopUiUpdateWatch();
  connection?.close();
  connection = null;
  installBackendConnection(createIdleConnection());
  await run(() => port.signOut());
  controllerAccount.set(null);
  controllerDevices.set(null);
  controllerDevice.set(null);
  // A device's UI page goes back to the launcher, which asks for sign-in.
  if (port.leave && (await port.leave().catch(() => false))) {
    controllerOpening.set(null);
    controllerPhase.set("opening");
    return;
  }
  controllerPhase.set("email");
}

/**
 * The backend connection of a controller that drives no device yet: every
 * command is refused with a sentence instead of reaching fixtures.
 */
export function createIdleConnection() {
  const refusal = () => Promise.reject(new Error("Pick a device first"));
  return {
    kind: "websocket" as const,
    invoke: refusal,
    subscribe: () => () => undefined,
    ready: () => new Promise<never>(() => undefined),
    state: () => "connecting" as const,
    error: () => "",
    lastSeq: () => null,
  };
}

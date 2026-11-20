// The controller shell's state: sign in (email, then code), the account's
// devices, and the device this window drives. Every fact comes from the
// installed `ControllerPort`; this store only remembers what the shell shows.

import { signal } from "nsh";
import { installBackendConnection } from "../bridge";
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
} from "./controllerPort";

export type ControllerPhase = "starting" | "email" | "code" | "devices" | "connected";

export interface ControllerFailure {
  code: ControllerErrorCode;
  message: string;
  retryAfterSeconds: number | null;
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

let connection: ControllerConnection | null = null;

function failure(error: unknown): ControllerFailure {
  return {
    code: controllerErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
    retryAfterSeconds: error instanceof ControllerError ? error.retryAfterSeconds : null,
  };
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

/** Restores a signed-in session (or shows the email step). */
export async function startController(): Promise<void> {
  const port = controllerPort();
  if (!port) return;
  controllerPhase.set("starting");
  try {
    const account = await port.restore();
    controllerAccount.set(account);
    controllerPhase.set(account ? "devices" : "email");
    if (account) await refreshControllerDevices();
  } catch (error) {
    controllerFailure.set(failure(error));
    controllerPhase.set("email");
  }
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
    controllerPhase.set("devices");
    await refreshControllerDevices();
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

export async function connectControllerDevice(device: ControllerDevice): Promise<void> {
  const port = controllerPort();
  if (!port || controllerConnecting()) return;
  controllerConnecting.set(device.deviceId);
  controllerFailure.set(null);
  const started = Date.now();
  try {
    const opened = await port.connect(device.deviceId);
    connection?.close();
    connection = opened;
    controllerConnectMs.set(Date.now() - started);
    installBackendConnection(opened);
    controllerDevice.set(device);
    controllerPhase.set("connected");
  } catch (error) {
    const reason = failure(error);
    controllerFailure.set(reason);
    if (reason.code === "signed_out") {
      controllerAccount.set(null);
      controllerPhase.set("email");
    }
  } finally {
    controllerConnecting.set(null);
  }
}

/** Leaves the device (back to the list); the window stops driving it. */
export async function leaveControllerDevice(): Promise<void> {
  connection?.close();
  connection = null;
  installBackendConnection(createIdleConnection());
  controllerDevice.set(null);
  controllerPhase.set("devices");
  await refreshControllerDevices();
}

export async function signOutController(): Promise<void> {
  const port = controllerPort();
  if (!port) return;
  connection?.close();
  connection = null;
  installBackendConnection(createIdleConnection());
  await run(() => port.signOut());
  controllerAccount.set(null);
  controllerDevices.set(null);
  controllerDevice.set(null);
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

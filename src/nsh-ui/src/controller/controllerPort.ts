// The controller port: what a client without a backend of its own (a browser on
// the OpenBitFun domain, the NSH phone app) needs to drive the account's devices.
//
// The port is a transport and identity adapter, never a product backend: the
// account, the device list and every reason a device cannot be reached come from
// the server (or the native Link module); the controller shell only draws them.
// Two implementations exist:
//
// - `web` (`webController.ts`): HTTPS to the domain's gateway API, the browser's
//   device key in the page's WebCrypto/IndexedDB, and an end-to-end encrypted OBP
//   channel through the gateway's WebSocket pipe.
// - `native` (the phone app): the same calls over its native module, Link
//   embedded, the device key in the platform keystore.
//
// Keep this file free of browser and platform types: both implementations and
// the shell compile against it.

import type { AccountIdentity } from "../accountIdentity";
import type { BackendConnection } from "../backendConnection";
import type { FleetHello } from "../fleetTypes";

/** Which implementation a port is. */
export type ControllerKind = "web" | "native";

/** The signed-in account, as the server reports it. */
export interface ControllerAccount {
  /** The account id (the identity authority's `accountId`). Never shown. */
  accountId: string;
  /** Who is signed in, as every surface shows it; `null` when the server named no one. */
  identity: AccountIdentity | null;
  /** This controller's own device id in the account's device directory. */
  deviceId: string;
}

/** A verification code the server sent. Hand it back to `verifyCode` unchanged. */
export interface ControllerCodeChallenge {
  /** Opaque handle of the pending sign-in (the port's, not a secret to show). */
  challengeId: string;
  /** The address the code went to, as the server normalized it. */
  email: string;
  /** How many digits the code has. */
  codeLength: number;
  /** Seconds before another code may be requested. */
  retryAfterSeconds: number;
  /** When the pending sign-in expires (epoch milliseconds), when known. */
  expiresAt: number | null;
}

/**
 * One device of the account the controller may drive. Every field is the
 * server's: the shell sorts nothing out and decides nothing about reachability.
 */
export interface ControllerDevice {
  deviceId: string;
  /** The name to show (the user's alias when set). */
  name: string;
  /** Directory kind (`desktop`, `cli`, ...), when known. */
  kind: string | null;
  /** Operating system label, when known. */
  os: string | null;
  /** Device model, when known. */
  model: string | null;
  /** The OpenBitFun build the device last reported. */
  clientVersion: string | null;
  /** Whether the server sees the device online now. */
  online: boolean;
  /** Last time the server saw it (epoch milliseconds). */
  lastSeenAt: number | null;
  /** Whether `connect` may be tried now. */
  connectable: boolean;
  /**
   * Why it cannot be connected (`offline`, `update_required`, ...) and the
   * server's sentence for it; `null` while connectable.
   */
  unavailable: { code: string; message: string } | null;
  /**
   * The Link route (`direct_lan`, `direct_ipv4`, `direct_ipv6`, `relayed_peer`,
   * `relayed_server`) when the port knows it; `null` otherwise (the web port
   * goes through the server and has no route of its own).
   */
  route: string | null;
}

/** How `connect` opens the connection. */
export interface ControllerConnectOptions {
  /**
   * Hello as a fleet client with this vector cursor (shared: the connection
   * advances it). A port that cannot pass it connects plainly.
   */
  fleet?: FleetHello;
}

/** A live backend connection to one device. */
export interface ControllerConnection extends BackendConnection {
  /** The device this connection drives. */
  readonly deviceId: string;
  /** Closes the connection for good (no reconnect). */
  close(): void;
}

/** Stable failure codes a port rejects with; the shell maps them to copy. */
export type ControllerErrorCode =
  /** The email address was refused. */
  | "invalid_email"
  /** The code was wrong, expired or used up. */
  | "invalid_code"
  /** Too many attempts; `retryAfterSeconds` says when to retry. */
  | "rate_limited"
  /** The session ended (signed out elsewhere, revoked, expired). */
  | "signed_out"
  /** The device is not reachable now (offline, network trouble). */
  | "unreachable"
  /** The device or the server cannot do this (an older build). */
  | "unsupported"
  /** The service is unavailable; retry later. */
  | "unavailable"
  /** The request never reached the server. */
  | "network"
  /**
   * The device ships no web UI, or is too old to hand one out
   * (`ui_bundle_unavailable`, or no `ui_bundle_manifest` command).
   */
  | "device_ui_unavailable"
  /** The device's UI manifest is newer than this page reads; reload the page. */
  | "page_outdated"
  /** A file of the device's UI failed verification (`detail` names it); nothing ran. */
  | "ui_verification_failed"
  /** A file of the device's UI could not be loaded (`detail` names it). */
  | "ui_load_failed";

/** The error every port method rejects with. `message` is the server's sentence. */
export class ControllerError extends Error {
  readonly code: ControllerErrorCode;
  readonly retryAfterSeconds: number | null;
  /** What the failure is about (the file of a UI that failed verification), when the code has one. */
  readonly detail: string | null;

  constructor(
    code: ControllerErrorCode,
    message: string,
    retryAfterSeconds: number | null = null,
    detail: string | null = null,
  ) {
    super(message);
    this.name = "ControllerError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.detail = detail;
  }
}

/** Reads the code of any rejection a port produced (`unavailable` for anything else). */
export function controllerErrorCode(error: unknown): ControllerErrorCode {
  if (error instanceof ControllerError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "invalid_email":
    case "invalid_code":
    case "rate_limited":
    case "signed_out":
    case "unreachable":
    case "unsupported":
    case "unavailable":
    case "network":
    case "device_ui_unavailable":
    case "page_outdated":
    case "ui_verification_failed":
    case "ui_load_failed":
      return code;
    default:
      return "unavailable";
  }
}

/**
 * Where a connected device's UI runs. `here`: this page drives it (a native
 * app, or a page that already runs the device's own UI). `away`: the device
 * ships another UI, and `open()` leaves this page for it.
 */
export type ControllerUiPlacement = { kind: "here" } | { kind: "away"; open(): Promise<void> };

/** How this page was started, beyond the signed-in session. */
export interface ControllerLaunchState {
  /** The device this page was opened for (the web handoff), to connect straight away. */
  deviceId: string | null;
  /** The user asked to see the device list (Switch device), so pick nothing. */
  showDevices: boolean;
  /** Why the previous page came back here (a UI file failed), to show first. */
  failure: ControllerError | null;
}

export interface ControllerPort {
  readonly kind: ControllerKind;
  /** The account this controller is still signed in to, or `null`. */
  restore(): Promise<ControllerAccount | null>;
  /** Sends a sign-in code to `email`. `locale` is the email's language (`en-US`, `zh-CN`, ...). */
  requestCode(email: string, options?: { locale?: string }): Promise<ControllerCodeChallenge>;
  /** Completes the sign-in with the code, registering this controller's device key. */
  verifyCode(challenge: ControllerCodeChallenge, code: string): Promise<ControllerAccount>;
  /** Signs this controller out (its device credential is revoked; other devices stay signed in). */
  signOut(): Promise<void>;
  /** The account's devices, as the server lists them. */
  listDevices(): Promise<ControllerDevice[]>;
  /**
   * Opens an authenticated OBP connection to `deviceId`. Resolves once the
   * device answered `hello`; rejects with a `ControllerError` otherwise.
   */
  connect(deviceId: string, options?: ControllerConnectOptions): Promise<ControllerConnection>;
  /**
   * The account's runtime hosts this client may enter the fleet through, best
   * first, as the server (the gateway's `entryCandidates`) or the native module
   * ranked them. A port without it (an older server or module) connects to one
   * device as before (`controller/fleetEntry.ts`).
   */
  entryCandidates?(): Promise<string[]>;
  /** How this page was started; a port without one starts plainly. */
  launchState?(): Promise<ControllerLaunchState>;
  /**
   * Where the UI of the device behind `connection` runs; a port without one
   * always drives the device here. Rejects with a `ControllerError`
   * (`device_ui_unavailable`, `page_outdated`, `unsupported`, ...).
   */
  placeUi?(connection: ControllerConnection): Promise<ControllerUiPlacement>;
  /**
   * Leaves the device for the device list. Resolves `true` when the page
   * itself goes away for that (a device's UI page goes back to the launcher).
   */
  leave?(): Promise<boolean>;
}

let installed: ControllerPort | null = null;

/**
 * Installs the controller port before the app mounts (the phone app's entry,
 * or `servedBackend.ts` for a page the domain served). The UI shows the
 * controller shell when one is installed.
 */
export function installControllerPort(port: ControllerPort | null): void {
  installed = port;
}

/** The installed controller port, if this client is a controller. */
export function controllerPort(): ControllerPort | null {
  return installed;
}

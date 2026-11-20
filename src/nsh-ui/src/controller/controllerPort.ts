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

import type { BackendConnection } from "../backendConnection";

/** Which implementation a port is. */
export type ControllerKind = "web" | "native";

/** The signed-in account, as the server reports it. */
export interface ControllerAccount {
  /** The account id (the identity authority's `accountId`). */
  accountId: string;
  /** The verified email of an email-code account; `null` for other sign-ins. */
  email: string | null;
  /** The account's handle, when the server reports one. */
  login: string | null;
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
  | "network";

/** The error every port method rejects with. `message` is the server's sentence. */
export class ControllerError extends Error {
  readonly code: ControllerErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(code: ControllerErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ControllerError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
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
      return code;
    default:
      return "unavailable";
  }
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
  connect(deviceId: string): Promise<ControllerConnection>;
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

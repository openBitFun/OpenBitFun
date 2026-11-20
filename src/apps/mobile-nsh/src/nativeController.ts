// The controller port of the NSH phone app, over its native module
// (`openbitfun/mobile`, `src/apps/mobile-nsh/native`): email-code sign-in
// through the account APIs every OpenBitFun device uses, the device key in the
// platform keystore, OpenBitFun Link joined as a controller node, and OBP to a
// device over a Link stream with the account-device handshake.
//
// Display-only: every fact (account, devices, routes, why a device cannot be
// reached) comes from the module; this file only adapts its JSON strings to the
// port's types. A device connection is the generic JSON wire the desktop's
// in-process backend also speaks, so the UI cannot tell the two apart.

import { Controller } from "openbitfun/mobile";
import { errorMessageOf } from "../../../nsh-ui/src/backendConnection";
import { createJsonWireConnection } from "../../../nsh-ui/src/jsonWireConnection";
import {
  ControllerError,
  installControllerPort,
  type ControllerAccount,
  type ControllerCodeChallenge,
  type ControllerConnection,
  type ControllerDevice,
  type ControllerErrorCode,
  type ControllerPort,
} from "../../../nsh-ui/src/controller/controllerPort";

const PORT_CODES: readonly ControllerErrorCode[] = [
  "invalid_email",
  "invalid_code",
  "rate_limited",
  "signed_out",
  "unreachable",
  "unsupported",
  "unavailable",
  "network",
];

/** The module rejects port calls with `<code>: <sentence>`. */
export function nativePortError(reason: unknown): ControllerError {
  const text = errorMessageOf(reason);
  const split = text.indexOf(": ");
  const prefix = split > 0 ? text.slice(0, split) : "";
  if ((PORT_CODES as readonly string[]).includes(prefix)) {
    return new ControllerError(prefix as ControllerErrorCode, text.slice(split + 2));
  }
  return new ControllerError("unavailable", text);
}

async function portCall<T>(call: () => Promise<string>, read: (value: unknown) => T): Promise<T> {
  let text: string;
  try {
    text = await call();
  } catch (reason) {
    throw nativePortError(reason);
  }
  return read(text === "" ? null : JSON.parse(text));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readAccount(value: unknown): ControllerAccount | null {
  const item = record(value);
  const accountId = text(item.accountId);
  const deviceId = text(item.deviceId);
  if (!accountId || !deviceId) return null;
  return { accountId, email: text(item.email), login: text(item.login), deviceId };
}

function readChallenge(value: unknown): ControllerCodeChallenge {
  const item = record(value);
  return {
    challengeId: text(item.challengeId) ?? "",
    email: text(item.email) ?? "",
    codeLength: count(item.codeLength) ?? 8,
    retryAfterSeconds: count(item.retryAfterSeconds) ?? 0,
    expiresAt: count(item.expiresAt),
  };
}

export function readDevices(value: unknown): ControllerDevice[] {
  if (!Array.isArray(value)) return [];
  const out: ControllerDevice[] = [];
  for (const raw of value) {
    const item = record(raw);
    const deviceId = text(item.deviceId);
    if (!deviceId) continue;
    const unavailable = record(item.unavailable);
    out.push({
      deviceId,
      name: text(item.name) ?? deviceId,
      kind: text(item.kind),
      os: text(item.os),
      model: text(item.model),
      clientVersion: text(item.clientVersion),
      online: item.online === true,
      lastSeenAt: count(item.lastSeenAt),
      connectable: item.connectable === true,
      unavailable: text(unavailable.code)
        ? { code: text(unavailable.code)!, message: text(unavailable.message) ?? "" }
        : null,
      route: text(item.route),
    });
  }
  return out;
}

async function connect(deviceId: string): Promise<ControllerConnection> {
  let handle: number;
  try {
    handle = await Controller.connect(deviceId);
  } catch (reason) {
    throw nativePortError(reason);
  }
  let closed = false;
  const wire = createJsonWireConnection(
    {
      invoke: (command, argsJson) =>
        closed ? Promise.reject(new Error("the device connection was closed")) : Controller.invoke(handle, command, argsJson),
      nextEvents: afterSeq =>
        closed
          ? Promise.resolve("[]")
          : afterSeq === undefined
            ? Controller.nextEvents(handle, null)
            : Controller.nextEvents(handle, afterSeq),
      ready: () => Controller.hello(handle),
    },
    { kind: "mesh" },
  );
  return {
    ...wire,
    kind: wire.kind,
    deviceId,
    close() {
      if (closed) return;
      closed = true;
      void Controller.disconnect(handle).catch(() => undefined);
    },
  };
}

/** The phone app's controller port. */
export const nativeController: ControllerPort = {
  kind: "native",
  restore: () => portCall(() => Controller.restore(), readAccount),
  requestCode: (email, options) => portCall(() => Controller.requestCode(email, options?.locale ?? null), readChallenge),
  verifyCode: (challenge, code) =>
    portCall(
      () => Controller.verifyCode(challenge.challengeId, code),
      value => {
        const account = readAccount(value);
        if (!account) throw new ControllerError("unavailable", "The sign-in finished without an account.");
        return account;
      },
    ),
  async signOut() {
    try {
      await Controller.signOut();
    } catch (reason) {
      throw nativePortError(reason);
    }
  },
  listDevices: () => portCall(() => Controller.listDevices(), readDevices),
  connect,
};

installControllerPort(nativeController);

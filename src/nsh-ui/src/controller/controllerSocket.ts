// The browser end of a device connection: an `ObpSocket` over the page realm's
// end-to-end channel (`host.js`, `openbitfun.controller.*`).
//
// The page realm holds the device key, opens the gateway WebSocket, runs the
// `obp-e2e-v1` handshake and encrypts every record; this realm only sees the
// plain OBP JSON-RPC messages, so `webSocketConnection.ts` (hello, resume,
// reconnect, credit) runs over it unchanged. Each reconnect is a new pipe and a
// new handshake.

import { host } from "nsh";
import type { ObpSocket, ObpSocketFactory } from "../webSocketConnection";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

interface HostReply<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface SocketEvent {
  id: string;
  type: "open" | "message" | "close";
  data?: string;
  code?: number;
  reason?: string;
}

const live = new Map<string, ControllerSocket>();
let channelOpen = false;
let nextSocket = 1;

function openChannel(): void {
  if (channelOpen) return;
  channelOpen = true;
  host.on<SocketEvent>("openbitfun.controller.socket", event => {
    if (!event || typeof event.id !== "string") return;
    live.get(event.id)?.deliver(event);
  });
}

/** Calls a page-realm controller function; rejects with its error text. */
export async function callController<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const reply = await host.call<HostReply<T>>(`openbitfun.controller.${name}`, args ?? {}, { timeout: 0 });
  if (!reply || !reply.ok) throw new Error(reply?.error || `openbitfun.controller.${name} failed`);
  return reply.value as T;
}

class ControllerSocket implements ObpSocket {
  readyState = CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  readonly id: string;
  private readonly onFirstClose: ((code: number, reason: string) => void) | undefined;

  constructor(id: string, onFirstClose?: (code: number, reason: string) => void) {
    this.id = id;
    this.onFirstClose = onFirstClose;
  }

  deliver(event: SocketEvent): void {
    if (event.type === "open") {
      this.readyState = OPEN;
      this.onopen?.(event);
    } else if (event.type === "message") {
      this.onmessage?.({ data: event.data ?? "" });
    } else if (event.type === "close") {
      this.closed(event.code ?? 1006, event.reason ?? "");
    }
  }

  closed(code: number, reason: string): void {
    if (this.readyState === CLOSED) return;
    const wasOpen = this.readyState === OPEN || this.readyState === CLOSING;
    this.readyState = CLOSED;
    live.delete(this.id);
    if (!wasOpen) this.onFirstClose?.(code, reason);
    this.onclose?.({ code, reason });
  }

  send(data: string): void {
    if (this.readyState !== OPEN) throw new Error("The device connection is not open");
    void callController("send", { id: this.id, text: data }).catch(() => undefined);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSING;
    void callController("close", { id: this.id, code: code ?? 1000, reason: reason ?? "" }).catch(() =>
      this.closed(code ?? 1000, reason ?? ""),
    );
  }
}

export interface ControllerSocketOptions {
  /** The device to reach (the gateway path's last segment). */
  deviceId: string;
  /** The device's directory X25519 key (standard base64), for the handshake. */
  devicePublicKey: string;
  /** Called when a socket closes before it opened (refused, unreachable). */
  onRefused?: (code: number, reason: string) => void;
}

/** A socket factory for `createWebSocketConnection` over the end-to-end channel. */
export function controllerSocketFactory(options: ControllerSocketOptions): ObpSocketFactory {
  openChannel();
  return (url: string) => {
    const id = `controller-${nextSocket++}`;
    const socket = new ControllerSocket(id, options.onRefused);
    live.set(id, socket);
    callController("open", {
      id,
      url,
      target: options.deviceId,
      targetPublicKey: options.devicePublicKey,
    }).catch(error => socket.closed(4500, error instanceof Error ? error.message : String(error)));
    return socket;
  };
}

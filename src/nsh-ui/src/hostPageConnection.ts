// The legacy page-host connection: NSH's `host` channel into `host.js`, which
// forwards to Tauri IPC inside the desktop webview or answers from development
// fixtures in a plain browser and in the headless tests.
//
// It keeps the envelopes `host.js` and the test hosts read — `{ action, request }`
// for a `request` command, `{ action, raw }` for a positional one — and turns
// them into the generic `BackendConnection`. `host.js` already merges text
// chunks per frame, so the bridge does not merge them again.

import { host, signal } from "nsh";
import type {
  BackendConnection,
  BackendEvent,
  BackendInfo,
  ConnectionState,
  InvokeOptions,
  TransportKind,
} from "./backendConnection";

interface HostReply<T> {
  ok: boolean;
  value?: T;
  error?: string;
  transport?: TransportKind;
}

interface HostEventEnvelope {
  event: string;
  payload: unknown;
  peerDeviceId?: string;
}

export interface HostPageConnection extends BackendConnection {
  /** The wire the page host reported last (`tauri` inside the desktop, `dev` on fixtures). */
  readonly kind: TransportKind;
  /** Records the wire a page-host reply reported. */
  noteTransport(kind: TransportKind | undefined): void;
}

export function createHostPageConnection(): HostPageConnection {
  const kind = signal<TransportKind>("dev");
  const state = signal<ConnectionState>("connected");
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  let channelOpen = false;
  let lastSeq: number | null = null;

  function noteTransport(next: TransportKind | undefined): void {
    if (next && next !== kind()) kind.set(next);
  }

  function openChannel(): void {
    if (channelOpen) return;
    channelOpen = true;
    host.on<HostEventEnvelope>("openbitfun.event", envelope => {
      if (!envelope || typeof envelope.event !== "string") return;
      const item: BackendEvent = { event: envelope.event, payload: envelope.payload };
      if (typeof envelope.peerDeviceId === "string") item.peerDeviceId = envelope.peerDeviceId;
      const seq = (envelope as { seq?: unknown }).seq;
      if (typeof seq === "number") {
        item.seq = seq;
        lastSeq = seq;
      }
      for (const subscriber of [...subscribers]) subscriber([item]);
    });
  }

  return {
    get kind() {
      return kind();
    },
    coalescesTextChunks: true,
    noteTransport,
    async invoke(command: string, args: Record<string, unknown> | undefined, options?: InvokeOptions) {
      // A command may legitimately outlive the 30 s host default (agent creation,
      // large file reads on a remote workspace), so the call waits.
      const envelope = options?.positional
        ? { action: command, raw: args ?? null }
        : { action: command, request: args?.request ?? null };
      const reply = await host.call<HostReply<unknown>>("openbitfun.invoke", envelope, { timeout: 0 });
      noteTransport(reply?.transport);
      if (!reply || reply.ok !== true) throw new Error(reply?.error || "");
      return reply.value;
    },
    subscribe(onEvents) {
      openChannel();
      subscribers.add(onEvents);
      return () => {
        subscribers.delete(onEvents);
      };
    },
    async ready(): Promise<BackendInfo> {
      return { version: null, platform: null, dataDir: null };
    },
    state: () => state(),
    error: () => "",
    lastSeq: () => lastSeq,
    watch(event: string) {
      openChannel();
      void host.call("openbitfun.listen", { event }).catch(() => undefined);
    },
    unwatch(event: string) {
      void host.call("openbitfun.unlisten", { event }).catch(() => undefined);
    },
  };
}

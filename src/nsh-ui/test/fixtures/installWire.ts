// Test stand-in for the native desktop entry (`src/apps/desktop-nsh/src/nativeTransport.ts`):
// the same JSON wire connection and NSH desktop shell, with the wire carried over
// the test's host channel instead of the in-process `openbitfun/native` module.
//
// `openbitfun.wireInvoke` / `openbitfun.wireReady` / `openbitfun.wirePickDirectory` are host calls the test
// answers; event batches arrive as `openbitfun.wireEvents` host events (names under the `openbitfun.*` grant) and are handed out
// by the long-polled `nextEvents`, exactly as the native module hands them out.

import { host } from "nsh";
import { installBackendConnection, installWindowShell } from "../../src/bridge";
import { createJsonWireConnection } from "../../src/jsonWireConnection";
import { createNshDesktopShell } from "../../src/nshDesktopShell";

const queued: string[] = [];
let waiting: ((batch: string) => void) | null = null;

host.on<string>("openbitfun.wireEvents", batch => {
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(batch);
  } else {
    queued.push(batch);
  }
});

installBackendConnection(
  createJsonWireConnection(
    {
      invoke: (command, argsJson) => host.call<string>("openbitfun.wireInvoke", { command, argsJson }, { timeout: 0 }),
      nextEvents: () => {
        const next = queued.shift();
        if (next !== undefined) return Promise.resolve(next);
        return new Promise<string>(resolve => {
          waiting = resolve;
        });
      },
      ready: () => host.call<string>("openbitfun.wireReady", {}, { timeout: 0 }),
    },
    { kind: "native" },
  ),
);

installWindowShell(
  createNshDesktopShell({
    pickDirectory: async options => {
      const text = await host.call<string>("openbitfun.wirePickDirectory", options);
      const value: unknown = text ? JSON.parse(text) : null;
      return typeof value === "string" && value ? value : null;
    },
  }),
);

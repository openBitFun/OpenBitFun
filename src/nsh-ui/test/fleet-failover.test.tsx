// Entry failover for a browser or phone: the walker tries the backend's
// ranked candidates, says the hello's vector cursor, fails the calls in flight
// with `entry_lost` when an entry goes away, moves to the next candidate with
// the same cursor, and re-hydrates only the origins the new entry could not
// resume. Trouble is reported only when every candidate failed.

import { expect, test } from "nsh/test";
import { signal } from "nsh";
import type { BackendEvent, ConnectionState } from "../src/backendConnection";
import { fleetActive, installBackendConnection, entryDeviceId } from "../src/bridge";
import { installBackendResync } from "../src/backendResync";
import { createJsonWireConnection } from "../src/jsonWireConnection";
import type { ControllerConnection } from "../src/controller/controllerPort";
import { createFleetEntryConnection, ENTRY_CHANGED_REASON, withFleetFailover } from "../src/controller/fleetEntry";
import type { ControllerPort } from "../src/controller/controllerPort";
import {
  advanceFleetCursor,
  fleetErrorKind,
  type FleetCursor,
  type FleetHello,
  type FleetHelloAnswer,
} from "../src/fleetTypes";

interface FakeEntry extends ControllerConnection {
  calls: Array<{ command: string; args: Record<string, unknown> | undefined }>;
  hello: FleetHello;
  /** Delivers frames the way a fleet socket does: the shared cursor advances first. */
  emit(frames: Array<{ origin: string; originInstance: string; seq: number; event: string; payload?: unknown }>): void;
  /** The socket dropped: pending calls fail with the socket's own sentence. */
  drop(): void;
  closed: boolean;
}

function fakeEntry(deviceId: string, hello: FleetHello, answer: FleetHelloAnswer): FakeEntry {
  const state = signal<ConnectionState>("connected");
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  const pending: Array<{ command: string; reject(error: Error): void }> = [];
  const calls: FakeEntry["calls"] = [];
  const entry: FakeEntry = {
    kind: "websocket",
    deviceId,
    hello,
    calls,
    closed: false,
    invoke(command, args) {
      calls.push({ command, args });
      if (command === "hang") {
        return new Promise((_resolve, reject) => pending.push({ command, reject }));
      }
      if (command === "fleet_navigator") return Promise.resolve({ revision: 1, full: true, devices: [], removedDeviceIds: [], totals: { running: 0, waiting: 0, unread: 0 } });
      if (command === "fleet_prompts") return Promise.resolve({ revision: 1, prompts: [] });
      return Promise.resolve({ ranOn: deviceId, command });
    },
    subscribe(onEvents) {
      subscribers.add(onEvents);
      return () => subscribers.delete(onEvents);
    },
    ready: async () => ({ version: "9.9.9", platform: "linux", dataDir: null, fleet: answer }),
    state: () => state(),
    error: () => (state() === "connected" ? "" : "The backend connection closed (1006)"),
    lastSeq: () => null,
    fleet: () => answer,
    emit(frames) {
      const fresh: BackendEvent[] = [];
      for (const frame of frames) {
        advanceFleetCursor(hello.cursor, frame.origin, frame.originInstance, frame.seq);
        fresh.push({ event: frame.event, payload: frame.payload ?? {}, seq: frame.seq, origin: frame.origin, originInstance: frame.originInstance });
      }
      for (const subscriber of [...subscribers]) subscriber(fresh);
    },
    drop() {
      state.set("reconnecting");
      for (const call of pending.splice(0)) call.reject(new Error(`The connection to the backend closed before \`${call.command}\` answered`));
    },
    close() {
      entry.closed = true;
    },
  };
  return entry;
}

const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

test("losing the entry fails the call in flight with entry_lost and resumes on the next candidate with the cursor", async () => {
  const opened: FakeEntry[] = [];
  const answers: Record<string, FleetHelloAnswer> = {
    "dev-a": { protocol: 1, cursorState: {} },
    "dev-b": { protocol: 1, cursorState: { "dev-a": "resumed", "dev-x": "resumed", "dev-y": "dropped" } },
  };
  const helloCursors: Array<{ deviceId: string; cursor: FleetCursor }> = [];
  const connection = createFleetEntryConnection({
    candidates: ["dev-a", "dev-b"],
    connect: async (deviceId, hello) => {
      // What the hello carried at the moment it was sent.
      helloCursors.push({ deviceId, cursor: JSON.parse(JSON.stringify(hello.fleet.cursor)) as FleetCursor });
      const entry = fakeEntry(deviceId, hello.fleet, answers[deviceId]!);
      opened.push(entry);
      return entry;
    },
  });
  const seen: BackendEvent[] = [];
  connection.subscribe(batch => seen.push(...batch));
  await connection.ready();
  expect(connection.entryDeviceId()).toBe("dev-a");
  // The candidate is the entry when its hello does not name itself.
  expect(connection.fleet()?.deviceId).toBe("dev-a");

  const a = opened[0]!;
  a.emit([
    { origin: "dev-a", originInstance: "a-1", seq: 41, event: "agentic://text-chunk" },
    { origin: "dev-x", originInstance: "x-1", seq: 5, event: "agentic://text-chunk" },
    { origin: "dev-y", originInstance: "y-1", seq: 12, event: "agentic://text-chunk" },
  ]);
  const inFlight = connection.invoke("hang", { request: {} });
  const outcome = inFlight.then(
    () => "resolved",
    (error: Error) => error.message,
  );
  const states: string[] = [];
  const watcher = setInterval(() => states.push(connection.state()), 5);
  a.drop();
  const message = await outcome;
  expect(message.startsWith("entry_lost:")).toBe(true);
  expect(fleetErrorKind(message)).toBe("entry_lost");
  await tick();
  clearInterval(watcher);

  // The next candidate got the same vector cursor in its hello.
  expect(helloCursors.map(item => item.deviceId)).toEqual(["dev-a", "dev-b"]);
  expect(helloCursors[0]!.cursor).toEqual({});
  expect(helloCursors[1]!.cursor).toEqual({
    "dev-a": { instanceId: "a-1", seq: 41 },
    "dev-x": { instanceId: "x-1", seq: 5 },
    "dev-y": { instanceId: "y-1", seq: 12 },
  });
  expect(a.closed).toBe(true);
  expect(connection.entryDeviceId()).toBe("dev-b");
  expect(connection.state()).toBe("connected");
  // The user was never told: no `failed` state on the way.
  expect(states.includes("failed")).toBe(false);
  expect(connection.allFailed()).toBe(false);
  // Only the origin the new entry could not resume is re-hydrated.
  const drops = seen.filter(item => item.event === "backend://events-dropped");
  expect(drops.map(item => item.payload)).toEqual([{ origin: "dev-y", reason: ENTRY_CHANGED_REASON }]);
  // A call after the switch runs through the new entry; nothing was retried.
  expect(await connection.invoke("get_config", { request: {} })).toEqual({ ranOn: "dev-b", command: "get_config" });
  expect(opened[1]!.calls.map(call => call.command)).toEqual(["get_config"]);
  connection.close();
});

test("every candidate failing is the only failure the client reports", async () => {
  const tried: string[] = [];
  const connection = createFleetEntryConnection({
    candidates: ["dev-a", "dev-b", "dev-c"],
    connect: async deviceId => {
      tried.push(deviceId);
      throw new Error(`unreachable: ${deviceId} did not answer`);
    },
  });
  const failure = await connection.ready().then(
    () => "",
    (error: Error) => error.message,
  );
  expect(tried).toEqual(["dev-a", "dev-b", "dev-c"]);
  expect(failure).toBe("unreachable: dev-c did not answer");
  expect(connection.state()).toBe("failed");
  expect(connection.allFailed()).toBe(true);
  const call = await connection.invoke("get_config", {}).then(
    () => "",
    (error: Error) => error.message,
  );
  expect(call).toBe("unreachable: dev-c did not answer");
  connection.close();
});

test("after a switch the UI re-hydrates only the dropped origin and stays in fleet mode", async () => {
  const opened: FakeEntry[] = [];
  const answers: Record<string, FleetHelloAnswer> = {
    "dev-a": { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    "dev-b": { protocol: 1, cursorState: { "dev-x": "resumed", "dev-y": "dropped" }, deviceId: "dev-b" },
  };
  const connection = createFleetEntryConnection({
    candidates: ["dev-a", "dev-b"],
    connect: async (deviceId, hello) => {
      const entry = fakeEntry(deviceId, hello.fleet, answers[deviceId]!);
      opened.push(entry);
      return entry;
    },
  });
  installBackendConnection(connection);
  await connection.ready();
  installBackendResync();
  expect(fleetActive()).toBe(true);
  expect(entryDeviceId()).toBe("dev-a");
  opened[0]!.emit([{ origin: "dev-y", originInstance: "y-1", seq: 3, event: "agentic://text-chunk" }]);
  opened[0]!.drop();
  await tick(250);
  expect(entryDeviceId()).toBe("dev-b");
  expect(fleetActive()).toBe(true);
  const b = opened[1]!;
  const targets = (command: string) =>
    b.calls
      .filter(call => call.command === "fleet_call")
      .map(call => (call.args as { request: { target?: string; command: string } }).request)
      .filter(request => request.command === command)
      .map(request => request.target ?? null);
  // The dropped origin's prompts are read from that device, and from no other.
  expect(targets("list_pending_permission_requests")).toEqual(["dev-y"]);
  // The fleet index is read again through the new entry.
  expect(b.calls.some(call => call.command === "fleet_navigator")).toBe(true);
  connection.close();
});

test("the controller keeps the device it opened as the first entry, and an older server or device keeps a plain link", async () => {
  const cursor: FleetCursor = {};
  const hello: FleetHello = { protocol: 1, cursor };
  const connects: string[] = [];
  const port = (candidates: string[] | null) =>
    ({
      kind: "web",
      ...(candidates ? { entryCandidates: async () => candidates } : {}),
      connect: async (deviceId: string, options?: { fleet?: FleetHello }) => {
        connects.push(deviceId);
        return fakeEntry(deviceId, options?.fleet ?? hello, { protocol: 1, cursorState: {} });
      },
    }) as unknown as ControllerPort;

  const opened = fakeEntry("dev-ui", hello, { protocol: 1, cursorState: {} });
  const wrapped = await withFleetFailover(port(["dev-b", "dev-ui"]), "dev-ui", opened, cursor);
  expect(wrapped === opened).toBe(false);
  expect(wrapped.deviceId).toBe("dev-ui");
  // The opened connection was reused: nothing was dialed yet.
  expect(connects).toEqual([]);
  expect(await wrapped.invoke("get_config", {})).toEqual({ ranOn: "dev-ui", command: "get_config" });
  opened.drop();
  await tick(150);
  expect(connects).toEqual(["dev-b"]);
  expect(wrapped.deviceId).toBe("dev-b");
  expect(await wrapped.invoke("get_config", {})).toEqual({ ranOn: "dev-b", command: "get_config" });
  wrapped.close();

  // An older server ranks nothing; an older device answers without `fleet`.
  const plain = fakeEntry("dev-ui", hello, { protocol: 1, cursorState: {} });
  expect((await withFleetFailover(port(null), "dev-ui", plain, cursor)) === plain).toBe(true);
  expect((await withFleetFailover(port([]), "dev-ui", plain, cursor)) === plain).toBe(true);
  const old = { ...fakeEntry("dev-old", hello, { protocol: 1, cursorState: {} }), fleet: () => null };
  expect((await withFleetFailover(port(["dev-b"]), "dev-old", old, cursor)) === old).toBe(true);
});

test("transient disconnect across all candidates retries with backoff, refreshes candidates, and supports retry()", async () => {
  let online = false;
  let candidateList = ["dev-a", "dev-b"];
  const opened: FakeEntry[] = [];
  const connection = createFleetEntryConnection({
    candidates: candidateList,
    minRetryMs: 25,
    maxRetryMs: 60,
    maxAutoRetries: 3,
    refreshCandidates: async () => candidateList,
    connect: async (deviceId, hello) => {
      if (opened.length > 0 && !online) throw new Error(`unreachable: ${deviceId}`);
      const entry = fakeEntry(deviceId, hello.fleet, { protocol: 1, cursorState: {}, deviceId });
      opened.push(entry);
      return entry;
    },
  });
  await connection.ready();
  expect(connection.entryDeviceId()).toBe("dev-a");

  // Drop entry while every candidate is briefly unreachable: stays reconnecting and recovers automatically.
  opened[0]!.drop();
  await tick(15);
  expect(connection.state()).toBe("reconnecting");
  expect(connection.allFailed()).toBe(false);

  candidateList = ["dev-c", "dev-a"];
  online = true;
  await tick(100);
  expect(connection.state()).toBe("connected");
  expect(connection.entryDeviceId()).toBe("dev-c");

  // Exhaust auto-retries -> enters failed; explicit retry() recovers cleanly.
  online = false;
  opened[1]!.drop();
  await tick(260);
  expect(connection.state()).toBe("failed");
  expect(connection.allFailed()).toBe(true);

  online = true;
  connection.retry();
  await tick(40);
  expect(connection.state()).toBe("connected");
  expect(connection.allFailed()).toBe(false);
  connection.close();
});

test("single-candidate transient drop preserves the underlying connection reconnect loop", async () => {
  const state = signal<ConnectionState>("connected");
  let retried = 0;
  let closed = false;
  const single: ControllerConnection = {
    kind: "websocket",
    deviceId: "dev-solo",
    invoke: async command => ({ ranOn: "dev-solo", command }),
    subscribe: () => () => undefined,
    ready: async () => ({ version: "2.0.0", platform: "macos", dataDir: null, fleet: { protocol: 1, cursorState: {}, deviceId: "dev-solo" } }),
    state: () => state(),
    error: () => (state() === "connected" ? "" : "socket dropped"),
    lastSeq: () => null,
    fleet: () => ({ protocol: 1, cursorState: {}, deviceId: "dev-solo" }),
    retry() {
      retried += 1;
      state.set("connected");
    },
    close() {
      closed = true;
    },
  };
  const connection = createFleetEntryConnection({
    candidates: ["dev-solo"],
    connect: async () => single,
  });
  await connection.ready();
  state.set("reconnecting");
  await tick(20);
  expect(closed).toBe(false);
  expect(connection.state()).toBe("reconnecting");
  connection.retry();
  await tick(20);
  expect(retried).toBe(1);
  expect(connection.state()).toBe("connected");
  connection.close();
});

test("jsonWireConnection exposes fleet(), advances shared FleetCursor, works with withFleetFailover, and preserves plain events-dropped", async () => {
  const sharedCursor: FleetCursor = {};
  const batches: string[] = [
    JSON.stringify([
      { seq: 10, origin: "dev-a", originInstance: "a-1", event: "agentic://text-chunk", payload: {} },
      { seq: 12, event: "agentic://tool-event", payload: { n: 12 } },
      // Plain-stream restart with lower seq: events-dropped resets lastSeq so seq 4 passes.
      { seq: 3, event: "backend://events-dropped", payload: { reason: "backend_restarted" } },
      { seq: 4, event: "agentic://tool-event", payload: { n: 4 } },
    ]),
  ];
  let resolveWait: ((value: string) => void) | undefined;
  const wire = createJsonWireConnection(
    {
      invoke: async command => JSON.stringify({ ran: command }),
      nextEvents: async () => {
        const next = batches.shift();
        if (next) return next;
        return new Promise<string>(resolve => {
          resolveWait = resolve;
        });
      },
      ready: async () =>
        JSON.stringify({
          version: "2.0.0",
          platform: "ios",
          dataDir: null,
          fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
        }),
    },
    { kind: "mesh", fleetCursor: sharedCursor },
  );
  await wire.ready();
  expect(wire.fleet()).toEqual({ protocol: 1, cursorState: {}, deviceId: "dev-a" });
  const received: BackendEvent[] = [];
  wire.subscribe(batch => received.push(...batch));
  await tick(30);
  expect(sharedCursor).toEqual({ "dev-a": { instanceId: "a-1", seq: 10 } });
  expect(received.map(e => `${e.event}:${e.seq}`)).toEqual([
    "agentic://text-chunk:10",
    "agentic://tool-event:12",
    "backend://events-dropped:3",
    "agentic://tool-event:4",
  ]);
  const opened: ControllerConnection = { ...wire, deviceId: "dev-a" };
  const port = {
    kind: "native",
    entryCandidates: async () => ["dev-a", "dev-b"],
    connect: async (deviceId: string, opts?: { fleet?: FleetHello }) =>
      fakeEntry(deviceId, opts?.fleet ?? { protocol: 1, cursor: sharedCursor }, { protocol: 1, cursorState: {}, deviceId }),
  } as unknown as ControllerPort;
  const wrapped = await withFleetFailover(port, "dev-a", opened, sharedCursor);
  expect(wrapped === opened).toBe(false);
  expect(wrapped.deviceId).toBe("dev-a");
  wrapped.close();
  if (resolveWait) resolveWait("[]");
});

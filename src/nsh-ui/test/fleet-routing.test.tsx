// Fleet routing from the UI side: on a fleet entry every product command is
// addressed to a device (`fleet_call {target, command, args}`), the target
// coming from the caller, the owner of the id the command acts on, or the
// device context; the entry's own fleet verbs and controller-local commands
// stay plain; and an older backend (no `fleet` in its hello) keeps plain calls.

import { expect, open, test } from "nsh/test";
// `state.ts` and `sessionStatusStore.ts` import each other; the app loads the
// status store first, and so does this test.
import "../src/sessionStatusStore";
import type { BackendConnection, BackendEvent } from "../src/backendConnection";
import {
  fleetActive,
  installBackendConnection,
  invokeCommand,
  invokeRawCommand,
  listenEvent,
  type EventMeta,
} from "../src/bridge";
import { fleetNavigator, refreshFleetNavigator, resetFleetStore } from "../src/fleetStore";
import type { FleetHelloAnswer, FleetNavigator } from "../src/fleetTypes";
import { fleetOwnerKeyOf, fleetRouteFor, isFleetPlainCommand } from "../src/peerRouting";
import { activeSessionKey, activeWorkspaceKey, deviceContext, selectSession, sessionKey } from "../src/state";
import { showAllSessions, createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

const NAVIGATOR: FleetNavigator = {
  revision: 4,
  full: true,
  // The same workspace id on two devices stays two rows.
  devices: [
    fleetDeviceRow("dev-a", "Studio", [
      { workspaceId: "ws-1", name: "OpenBitFun", rootPath: "/repo", sessions: [fleetSessionRow("dev-a", "ws-1", "s-a1", "Plan the release")] },
    ]),
    fleetDeviceRow("dev-b", "builder", [
      { workspaceId: "ws-1", name: "OpenBitFun", rootPath: "/home/b/repo", sessions: [fleetSessionRow("dev-b", "ws-1", "s-b1", "Build on Linux")] },
    ]),
  ] as unknown as FleetNavigator["devices"],
  removedDeviceIds: [],
  totals: { running: 0, waiting: 0, unread: 0 },
};

interface FakeConnection extends BackendConnection {
  calls: Array<{ command: string; args: Record<string, unknown> | undefined }>;
  push(batch: BackendEvent[]): void;
}

/** A connected backend whose hello answered `fleet` (or, with `null`, did not). */
function fakeConnection(fleet: FleetHelloAnswer | null, navigator: FleetNavigator = NAVIGATOR): FakeConnection {
  const calls: FakeConnection["calls"] = [];
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  return {
    kind: "websocket",
    calls,
    async invoke(command, args) {
      calls.push({ command, args });
      if (command === "fleet_navigator") return navigator;
      if (command === "fleet_prompts") return { revision: 1, prompts: [] };
      return { ran: command };
    },
    subscribe(onEvents) {
      subscribers.add(onEvents);
      return () => subscribers.delete(onEvents);
    },
    ready: async () => ({ version: "9.9.9", platform: "linux", dataDir: null, ...(fleet ? { fleet } : {}) }),
    state: () => "connected",
    error: () => "",
    lastSeq: () => null,
    fleet: () => fleet,
    push(batch) {
      for (const subscriber of [...subscribers]) subscriber(batch);
    },
  };
}

const ENTRY: FleetHelloAnswer = { protocol: 1, cursorState: {}, deviceId: "dev-a" };

/** The last call that ran `command`, plain or wrapped in `fleet_call` (background reads interleave). */
function lastCall(connection: FakeConnection, command: string) {
  const matches = connection.calls.filter(
    call =>
      call.command === command ||
      (call.command === "fleet_call" &&
        (call.args as { request?: { command?: string } } | undefined)?.request?.command === command),
  );
  return matches[matches.length - 1]!;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test("routing table: owner ids are read at the registry path; fleet verbs and controller-local commands stay plain", () => {
  expect(isFleetPlainCommand("fleet_navigator")).toBe(true);
  expect(isFleetPlainCommand("fleet_call")).toBe(true);
  expect(isFleetPlainCommand("account_status")).toBe(true);
  expect(isFleetPlainCommand("peer_link_connect")).toBe(true);
  expect(isFleetPlainCommand("get_session_transcript_view")).toBe(false);
  expect(fleetOwnerKeyOf("get_session_transcript_view", { request: { session_id: "s-1" } })).toEqual({
    entity: "session",
    id: "s-1",
  });
  expect(fleetOwnerKeyOf("get_session_transcript_view", { request: {} })).toBe(null);
  const context = { ownerOf: (_entity: string, id: string) => (id === "s-b1" ? "dev-b" : null), deviceContext: () => "dev-a" };
  // The owner of the session wins over the device context; an explicit target wins over both.
  expect(fleetRouteFor("get_session_transcript_view", { request: { session_id: "s-b1" } }, context)?.args).toEqual({
    request: { target: "dev-b", command: "get_session_transcript_view", args: { request: { session_id: "s-b1" } } },
  });
  expect(
    fleetRouteFor("get_session_transcript_view", { request: { session_id: "s-b1" } }, { ...context, target: "dev-c" })?.args,
  ).toMatchObject({ request: { target: "dev-c" } });
  expect(fleetRouteFor("get_config", { request: { path: "x" } }, context)?.args).toMatchObject({ request: { target: "dev-a" } });
  // No target known: the entry resolves or refuses (`fleet_target_required`).
  expect(fleetRouteFor("get_config", undefined, { ownerOf: () => null, deviceContext: () => null })?.args).toEqual({
    request: { command: "get_config", args: {} },
  });
  expect(fleetRouteFor("account_status", undefined, context)).toBe(null);
});

test("on a fleet entry the target comes from the device context, the owner, or the caller", async () => {
  const connection = fakeConnection(ENTRY);
  installBackendConnection(connection);
  await connection.ready();
  expect(fleetActive()).toBe(true);
  resetFleetStore();
  await refreshFleetNavigator({ full: true });
  expect(fleetNavigator()?.devices.map(device => device.deviceId)).toEqual(["dev-a", "dev-b"]);
  // The state module selected the entry's workspace on its own; let that finish.
  await settle();

  // Nothing selected: the entry itself is the context.
  activeWorkspaceKey.set(null);
  expect(deviceContext()).toBe("dev-a");
  await invokeCommand("get_config", { path: "ai.models" });
  expect(lastCall(connection, "get_config")).toEqual({
    command: "fleet_call",
    args: { request: { target: "dev-a", command: "get_config", args: { request: { path: "ai.models" } } } },
  });

  // Selecting a workspace on another device moves the context there.
  activeWorkspaceKey.set({ deviceId: "dev-b", workspaceId: "ws-1" });
  expect(deviceContext()).toBe("dev-b");
  await invokeCommand("get_config", { path: "ai.models" });
  expect(lastCall(connection, "get_config").args).toMatchObject({ request: { target: "dev-b", command: "get_config" } });
  // `ws-1` exists on both devices: the context's own row wins, never a guess.
  await invokeCommand("list_persisted_sessions_page", { workspace_id: "ws-1", limit: 50 });
  expect(lastCall(connection, "list_persisted_sessions_page").args).toMatchObject({
    request: { target: "dev-b", command: "list_persisted_sessions_page" },
  });
  // A session id names its owner, whatever the context is.
  await invokeCommand("get_session_transcript_view", { session_id: "s-a1", workspace_id: "ws-1" });
  expect(lastCall(connection, "get_session_transcript_view").args).toMatchObject({
    request: { target: "dev-a", command: "get_session_transcript_view", args: { request: { session_id: "s-a1" } } },
  });
  // An explicit target (a prompt answered on its origin) wins.
  await invokeRawCommand("submit_user_answers", { toolId: "t1", answers: { "0": "Yes" }, sessionId: "s-b1" }, { target: "dev-a" });
  expect(lastCall(connection, "submit_user_answers")).toEqual({
    command: "fleet_call",
    args: {
      request: {
        target: "dev-a",
        command: "submit_user_answers",
        args: { toolId: "t1", answers: { "0": "Yes" }, sessionId: "s-b1" },
      },
    },
  });
  // Per-device keys keep the two `ws-1` sessions apart.
  expect(sessionKey("s-b1", "dev-b")).toBe("dev-b/s-b1");
  activeWorkspaceKey.set(null);
});

test("opening a session in another workspace (a dispatch job's worktree) selects that workspace and reads its transcript there", async () => {
  const navigator: FleetNavigator = {
    ...NAVIGATOR,
    devices: [
      fleetDeviceRow("dev-a", "Studio", [
        { workspaceId: "ws-1", name: "repo", rootPath: "/repo", sessions: [fleetSessionRow("dev-a", "ws-1", "s-a1", "Plan the release")] },
        {
          workspaceId: "ws-job",
          name: "repo-54957b04",
          rootPath: "/worktrees/repo-54957b04",
          sessions: [fleetSessionRow("dev-a", "ws-job", "s-job", "Add NOTE.md")],
        },
      ]),
      fleetDeviceRow("dev-b", "builder", [
        { workspaceId: "ws-1", name: "repo", rootPath: "/home/b/repo", sessions: [fleetSessionRow("dev-b", "ws-1", "s-b1", "Build")] },
      ]),
    ] as unknown as FleetNavigator["devices"],
  };
  const connection = fakeConnection(ENTRY, navigator);
  installBackendConnection(connection);
  await connection.ready();
  resetFleetStore();
  await refreshFleetNavigator({ full: true });
  await settle();
  activeWorkspaceKey.set({ deviceId: "dev-b", workspaceId: "ws-1" });

  // A job card names only the session and its device.
  selectSession("s-job", "dev-a");
  expect(activeWorkspaceKey()).toEqual({ deviceId: "dev-a", workspaceId: "ws-job" });
  expect(activeSessionKey()).toBe("dev-a/s-job");
  await settle();
  expect(lastCall(connection, "get_session_transcript_view").args).toMatchObject({
    request: { target: "dev-a", args: { request: { session_id: "s-job", workspace_id: "ws-job" } } },
  });

  // A caller that knows the workspace (an All sessions row) names it.
  selectSession("s-a1", "dev-a", "ws-1");
  expect(activeWorkspaceKey()).toEqual({ deviceId: "dev-a", workspaceId: "ws-1" });
  await settle();
  expect(lastCall(connection, "get_session_transcript_view").args).toMatchObject({
    request: { args: { request: { session_id: "s-a1", workspace_id: "ws-1" } } },
  });
  activeWorkspaceKey.set(null);
});

test("controller-local commands and the entry's own fleet verbs go out plain", async () => {
  const connection = fakeConnection(ENTRY);
  installBackendConnection(connection);
  await connection.ready();
  await invokeCommand("account_status");
  expect(lastCall(connection, "account_status")).toEqual({ command: "account_status", args: undefined });
  await invokeCommand("fleet_navigator", { sinceRevision: 3 });
  expect(lastCall(connection, "fleet_navigator")).toEqual({ command: "fleet_navigator", args: { request: { sinceRevision: 3 } } });
  await invokeCommand("mesh_list_devices");
  expect(lastCall(connection, "mesh_list_devices").command).toBe("mesh_list_devices");
  const wrapped = connection.calls
    .filter(call => call.command === "fleet_call")
    .map(call => (call.args as { request: { command: string } }).request.command);
  expect(wrapped.filter(isFleetPlainCommand)).toEqual([]);
});

test("events carry their origin; the entry's untagged events are the entry's", async () => {
  const connection = fakeConnection(ENTRY);
  installBackendConnection(connection);
  await connection.ready();
  const seen: Array<{ payload: unknown; meta: EventMeta }> = [];
  const stop = listenEvent<unknown>("test://fleet-origin", (payload, meta) => seen.push({ payload, meta }));
  connection.push([
    { event: "test://fleet-origin", payload: { n: 1 }, seq: 7, origin: "dev-b", originInstance: "b-1" },
    { event: "test://fleet-origin", payload: { n: 2 }, seq: 9 },
  ]);
  stop();
  expect(seen).toEqual([
    { payload: { n: 1 }, meta: { origin: "dev-b", originInstance: "b-1", seq: 7 } },
    { payload: { n: 2 }, meta: { origin: "dev-a", originInstance: null, seq: 9 } },
  ]);
});

test("an older backend (no fleet in its hello) gets plain calls and single-device keys", async () => {
  const connection = fakeConnection(null);
  installBackendConnection(connection);
  await connection.ready();
  await settle();
  connection.calls.length = 0;
  expect(fleetActive()).toBe(false);
  expect(deviceContext()).toBe("");
  await invokeCommand("get_config", { path: "ai.models" });
  await invokeCommand("get_session_transcript_view", { session_id: "s-a1" });
  await invokeRawCommand("submit_user_answers", { toolId: "t1", answers: {}, sessionId: "s-a1" }, { target: "dev-b" });
  expect(connection.calls.some(call => call.command.startsWith("fleet_"))).toBe(false);
  expect(lastCall(connection, "get_config")).toEqual({ command: "get_config", args: { request: { path: "ai.models" } } });
  expect(lastCall(connection, "get_session_transcript_view").command).toBe("get_session_transcript_view");
  expect(lastCall(connection, "submit_user_answers")).toEqual({
    command: "submit_user_answers",
    args: { toolId: "t1", answers: {}, sessionId: "s-a1" },
  });
  const metas: EventMeta[] = [];
  const stop = listenEvent<unknown>("test://plain-origin", (_payload, meta) => metas.push(meta));
  connection.push([{ event: "test://plain-origin", payload: {}, seq: 3 }]);
  stop();
  expect(metas).toEqual([{ origin: "", originInstance: null, seq: 3 }]);
  expect(sessionKey("s-a1")).toBe("/s-a1");
});

test("the shared UI over a fleet entry addresses every product command and lists the context device's rows", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 2,
      full: true,
      devices: [
        fleetDeviceRow("dev-a", "Studio", [
          {
            workspaceId: "workspace-1",
            name: "OpenBitFun",
            rootPath: "/repo",
            isHostCurrent: true,
            sessions: [fleetSessionRow("dev-a", "workspace-1", "session-1", "NSH skeleton")],
          },
        ]),
        fleetDeviceRow("dev-b", "builder", [
          {
            workspaceId: "workspace-1",
            name: "OpenBitFun",
            rootPath: "/home/b/repo",
            sessions: [fleetSessionRow("dev-b", "workspace-1", "session-b", "Build on Linux")],
          },
        ]),
      ],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app, "NSH skeleton");
  await app.waitUntil(() => host.fleetCalls.length > 0);
  // The hello asked for the fleet layer with a (fresh) vector cursor.
  expect(host.hellos[0]?.fleet).toEqual({ protocol: 1, cursor: {} });
  expect(host.pageHostCalls).toEqual([]);
  // Every call is a fleet verb, a controller-local command, or a fleet_call.
  const plain = host.calls.filter(call => call.command !== "fleet_call").map(call => call.command);
  expect(plain.filter(command => !isFleetPlainCommand(command))).toEqual([]);
  // The context is the entry's own device: every addressed call names it.
  expect([...new Set(host.fleetCalls.map(call => call.target))]).toEqual(["dev-a"]);
  // The entry streams the context device in full (`fleet_subscribe`).
  const follows = host.calls.filter(call => call.command === "fleet_subscribe").map(call => call.args.request);
  expect(follows[follows.length - 1]).toEqual({ follow: { "dev-a": { all: true } } });
  // The other device's same-id workspace does not leak into this device's rows:
  // its session is listed once, as its own device's.
  expect(app.texts().filter(text => text === "Build on Linux").length).toBeLessThanOrEqual(1);
});

test("the entry streams the account's cloud node too, so its turns and job cards reach this client", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 2,
      full: true,
      devices: [
        fleetDeviceRow("cloud-1", "OpenBitFun", [], { hostKind: "cloud", hostCapabilities: ["fleet_v1", "superagent_v1"] }),
        fleetDeviceRow("dev-a", "Studio", [
          {
            workspaceId: "workspace-1",
            name: "OpenBitFun",
            rootPath: "/repo",
            isHostCurrent: true,
            sessions: [fleetSessionRow("dev-a", "workspace-1", "session-1", "NSH skeleton")],
          },
        ]),
      ],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app, "NSH skeleton");
  await app.waitUntil(() =>
    host.calls.some(
      call =>
        call.command === "fleet_subscribe" &&
        Boolean((call.args.request as { follow?: Record<string, unknown> } | undefined)?.follow?.["cloud-1"]),
    ),
  );
  const follows = host.calls.filter(call => call.command === "fleet_subscribe").map(call => call.args.request);
  expect(follows[follows.length - 1]).toEqual({ follow: { "dev-a": { all: true }, "cloud-1": { all: true } } });
});

test("the shared UI over an older entry sends no fleet_call and keeps today's lists", async () => {
  const backend = createBackend();
  const host = fleetObpHost(backend, { fleet: null });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await showAllSessions(app, "NSH skeleton");
  expect(host.calls.some(call => call.command === "fleet_call")).toBe(false);
  expect(host.calls.some(call => call.command === "fleet_navigator")).toBe(false);
  expect(host.calls.some(call => call.command === "get_workspace_navigator")).toBe(true);
});

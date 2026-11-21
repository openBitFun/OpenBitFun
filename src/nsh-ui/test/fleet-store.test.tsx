// The fleet store: the navigator and prompt views as the entry answers them,
// refreshed on `fleet://index-changed` / `fleet://prompts-changed` with
// `{sinceRevision}`. A delta replaces the changed devices by id; a delta that
// could change the backend's order (a new device, a state or name change) is
// followed by one full read. Nothing is sorted, merged or counted here.

import { expect, test } from "nsh/test";
import type { BackendConnection, BackendEvent } from "../src/backendConnection";
import { installBackendConnection } from "../src/bridge";
import {
  fleetDevices,
  fleetNavigator,
  fleetPromptList,
  fleetSessionOwner,
  fleetTotals,
  fleetUnavailable,
  refreshFleetNavigator,
  refreshFleetPrompts,
  resetFleetStore,
  startFleetStore,
} from "../src/fleetStore";
import type { FleetHelloAnswer, FleetNavigator } from "../src/fleetTypes";
import { fleetDeviceRow, fleetSessionRow } from "./support";

type Answer = (command: string, request: Record<string, unknown>) => unknown;

interface ScriptedEntry extends BackendConnection {
  requests: Array<{ command: string; request: Record<string, unknown> }>;
  push(batch: BackendEvent[]): void;
}

function scriptedEntry(fleet: FleetHelloAnswer | null, answer: Answer): ScriptedEntry {
  const requests: ScriptedEntry["requests"] = [];
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  return {
    kind: "websocket",
    requests,
    async invoke(command, args) {
      const request = ((args ?? {}) as { request?: Record<string, unknown> }).request ?? {};
      requests.push({ command, request });
      return answer(command, request);
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
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

function device(id: string, name: string, sessions: string[], extra: Record<string, unknown> = {}) {
  return fleetDeviceRow(
    id,
    name,
    [{ workspaceId: "ws-1", name: "repo", rootPath: "/repo", sessions: sessions.map(s => fleetSessionRow(id, "ws-1", s, s)) }],
    extra,
  ) as unknown as FleetNavigator["devices"][number];
}

function view(revision: number, devices: FleetNavigator["devices"], full = true, removed: string[] = []): FleetNavigator {
  return { revision, full, devices, removedDeviceIds: removed, totals: { running: revision, waiting: 0, unread: 1 } };
}

function navigatorReads(entry: ScriptedEntry) {
  return entry.requests.filter(item => item.command === "fleet_navigator").map(item => item.request);
}

test("deltas replace changed devices in place and keep the backend's order and totals", async () => {
  // Answers by `sinceRevision`, the way the entry's projection does.
  const answers: Record<string, FleetNavigator> = {
    full: view(1, [device("dev-a", "Studio", ["s1"]), device("dev-b", "builder", ["s2"]), device("dev-c", "nas", [])]),
    "1": view(2, [device("dev-b", "builder", ["s2", "s3"])], false),
    "2": view(3, [], false, ["dev-c"]),
  };
  const entry = scriptedEntry(ENTRY, (command, request) => {
    if (command === "fleet_prompts") return { revision: 1, prompts: [] };
    if (command !== "fleet_navigator") return null;
    const since = request.sinceRevision;
    return answers[since === undefined ? "full" : String(since)] ?? view(Number(since), [], false);
  });
  installBackendConnection(entry);
  await entry.ready();
  resetFleetStore();
  startFleetStore();
  await refreshFleetNavigator({ full: true });
  expect(fleetDevices().map(item => item.deviceId)).toEqual(["dev-a", "dev-b", "dev-c"]);
  expect(fleetUnavailable()).toBe(null);

  entry.requests.length = 0;
  entry.push([{ event: "fleet://index-changed", payload: { revision: 2, deviceIds: ["dev-b"] } }]);
  await tick();
  expect(navigatorReads(entry)).toEqual([{ sinceRevision: 1 }]);
  // dev-b was replaced where it stood; the totals are the delta's, not recounted.
  expect(fleetDevices().map(item => item.deviceId)).toEqual(["dev-a", "dev-b", "dev-c"]);
  expect(fleetDevices()[1]!.workspaces[0]!.sessions.map(item => item.sessionId)).toEqual(["s2", "s3"]);
  expect(fleetTotals()).toEqual({ running: 2, waiting: 0, unread: 1 });
  expect(fleetNavigator()?.revision).toBe(2);
  expect(fleetSessionOwner("s3")).toBe("dev-b");

  // A removal drops the device.
  entry.push([{ event: "fleet://index-changed", payload: { revision: 3, deviceIds: ["dev-c"] } }]);
  await tick();
  expect(fleetDevices().map(item => item.deviceId)).toEqual(["dev-a", "dev-b"]);

  // A hint for a revision already held is not read again.
  entry.requests.length = 0;
  entry.push([{ event: "fleet://index-changed", payload: { revision: 3, deviceIds: [] } }]);
  await tick();
  expect(navigatorReads(entry)).toEqual([]);
});

test("a delta that could reorder devices (new device, state change) is followed by a full read", async () => {
  let fullReads = 0;
  const entry = scriptedEntry(ENTRY, (command, request) => {
    if (command === "fleet_prompts") return { revision: 1, prompts: [] };
    if (command !== "fleet_navigator") return null;
    if (request.sinceRevision === undefined) {
      fullReads += 1;
      return fullReads === 1
        ? view(10, [device("dev-a", "Studio", []), device("dev-b", "builder", [])])
        : fullReads === 2
          ? // The backend put the new device first: its order is kept as sent.
            view(11, [device("dev-new", "alpha", []), device("dev-a", "Studio", []), device("dev-b", "builder", [])])
          : view(12, [device("dev-a", "Studio", []), device("dev-new", "alpha", []), device("dev-b", "builder", [], { state: "offline" })]);
    }
    if (request.sinceRevision === 10) return view(11, [device("dev-new", "alpha", [])], false);
    if (request.sinceRevision === 11) return view(12, [device("dev-b", "builder", [], { state: "offline" })], false);
    return view(Number(request.sinceRevision), [], false);
  });
  installBackendConnection(entry);
  await entry.ready();
  resetFleetStore();
  startFleetStore();
  await refreshFleetNavigator({ full: true });
  expect(fullReads).toBe(1);

  entry.push([{ event: "fleet://index-changed", payload: { revision: 11, deviceIds: ["dev-new"] } }]);
  await tick();
  expect(fullReads).toBe(2);
  expect(fleetDevices().map(item => item.deviceId)).toEqual(["dev-new", "dev-a", "dev-b"]);

  entry.push([{ event: "fleet://index-changed", payload: { revision: 12, deviceIds: ["dev-b"] } }]);
  await tick();
  expect(fullReads).toBe(3);
  expect(fleetDevices().map(item => `${item.deviceId}:${item.state}`)).toEqual([
    "dev-a:online",
    "dev-new:online",
    "dev-b:offline",
  ]);
});

test("prompts are re-read on prompts-changed, in the backend's order", async () => {
  let revision = 1;
  const prompts = () => ({
    revision,
    prompts: [
      { deviceId: "dev-b", workspaceId: "ws-1", sessionId: "s2", kind: "permission", promptId: `p${revision}`, revision, title: "Run tests", payloadTruncated: false, answerable: true },
      { deviceId: "dev-a", workspaceId: "ws-1", sessionId: "s1", kind: "question", promptId: "q1", revision: 1, title: "Ship it?", payloadTruncated: false, answerable: false, unanswerableReason: "question_answer_unsupported" },
    ],
  });
  const entry = scriptedEntry(ENTRY, command => {
    if (command === "fleet_prompts") return prompts();
    if (command === "fleet_navigator") return view(1, []);
    return null;
  });
  installBackendConnection(entry);
  await entry.ready();
  resetFleetStore();
  startFleetStore();
  await refreshFleetPrompts();
  expect(fleetPromptList().map(item => item.promptId)).toEqual(["p1", "q1"]);
  revision = 2;
  entry.push([{ event: "fleet://prompts-changed", payload: { revision: 2, deviceId: "dev-b" } }]);
  await tick();
  expect(fleetPromptList().map(item => `${item.deviceId}:${item.promptId}`)).toEqual(["dev-b:p2", "dev-a:q1"]);
  expect(fleetPromptList()[1]!.unanswerableReason).toBe("question_answer_unsupported");
});

test("an older entry has no fleet view and is never asked for one", async () => {
  const entry = scriptedEntry(null, () => null);
  installBackendConnection(entry);
  await entry.ready();
  resetFleetStore();
  startFleetStore();
  await refreshFleetNavigator({ full: true });
  await refreshFleetPrompts();
  entry.push([{ event: "fleet://index-changed", payload: { revision: 9, deviceIds: [] } }]);
  await tick();
  expect(fleetNavigator()).toBe(null);
  expect(fleetUnavailable()).toBe("entry_without_fleet");
  expect(entry.requests.filter(item => item.command.startsWith("fleet_"))).toEqual([]);
});

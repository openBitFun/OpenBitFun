// The sidebar derivation is shared and structurally shared: `deviceTree()` is
// built once per change of what it reads,
// and a rebuild hands back the same row objects (and the same list) for rows
// whose fields did not change, so keyed lists redraw only what changed. The
// fleet session index answers owner and row lookups without scanning, and the
// shell layout is written once a drag holds still, with a flush for the last one.

import { Storage } from "nsh";
import { expect, test } from "nsh/test";
import type { BackendConnection, BackendEvent } from "../src/backendConnection";
import { installBackendConnection } from "../src/bridge";
import {
  fleetSessionOwner,
  fleetSessionRow as indexedFleetSessionRow,
  refreshFleetNavigator,
  resetFleetStore,
  startFleetStore,
} from "../src/fleetStore";
import type { FleetHelloAnswer, FleetNavigator } from "../src/fleetTypes";
import { deviceTree } from "../src/deviceTree";
import { reuseRows } from "../src/rowReuse";
import {
  SHELL_LAYOUT_PERSIST_DELAY_MS,
  SHELL_LAYOUT_STORAGE_KEY,
  flushShellLayout,
  loadShellLayout,
  activeWorkspaceKey,
  navWidth,
  persistShellLayout,
  runningTurns,
  sessions,
  setNavWidth,
  workspaces,
} from "../src/state";
import { fleetDeviceRow, fleetSessionRow } from "./support";

interface ScriptedEntry extends BackendConnection {
  push(batch: BackendEvent[]): void;
}

function scriptedEntry(fleet: FleetHelloAnswer | null, answer: (command: string, request: Record<string, unknown>) => unknown): ScriptedEntry {
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  return {
    kind: "websocket",
    async invoke(command, args) {
      return answer(command, ((args ?? {}) as { request?: Record<string, unknown> }).request ?? {});
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

function device(id: string, name: string, sessions: Array<[string, string]>): FleetNavigator["devices"][number] {
  return fleetDeviceRow(
    id,
    name,
    [{ workspaceId: "ws-1", name: "repo", rootPath: `/${id}/repo`, sessions: sessions.map(([s, title]) => fleetSessionRow(id, "ws-1", s, title)) }],
  ) as unknown as FleetNavigator["devices"][number];
}

function view(revision: number, devices: FleetNavigator["devices"], full = true): FleetNavigator {
  return { revision, full, devices, removedDeviceIds: [], totals: { running: 0, waiting: 0, unread: 0 } };
}

test("reuseRows keeps unchanged rows and the list itself", () => {
  const a = { id: "a", title: "A" };
  const b = { id: "b", title: "B" };
  const previous = [a, b];
  expect(reuseRows(previous, [{ id: "a", title: "A" }, { id: "b", title: "B" }], row => row.id)).toBe(previous);
  const changed = reuseRows(previous, [{ id: "a", title: "A" }, { id: "b", title: "B2" }], row => row.id);
  expect(changed).not.toBe(previous);
  expect(changed[0]).toBe(a);
  expect(changed[1]).not.toBe(b);
  expect(changed[1]!.title).toBe("B2");
  // A reorder keeps the row objects but is a new list.
  const reordered = reuseRows(previous, [{ id: "b", title: "B" }, { id: "a", title: "A" }], row => row.id);
  expect(reordered).not.toBe(previous);
  expect(reordered[0]).toBe(b);
  expect(reordered[1]).toBe(a);
});

test("the device tree reuses unchanged rows across navigator reads; the index answers owners", async () => {
  const answers: Record<string, FleetNavigator> = {
    full: view(1, [
      device("dev-a", "Studio", [["s1", "Plan the release"]]),
      device("dev-b", "builder", [["s2", "Build on Linux"], ["s3", "Bump deps"]]),
    ]),
    // dev-a again with the same rows (new objects); dev-b with s3 renamed.
    "1": view(2, [
      device("dev-a", "Studio", [["s1", "Plan the release"]]),
      device("dev-b", "builder", [["s2", "Build on Linux"], ["s3", "Bump all deps"]]),
    ], false),
    // Only an unrelated resend of dev-a: nothing the tree shows changed.
    "2": view(3, [device("dev-a", "Studio", [["s1", "Plan the release"]])], false),
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

  const tree1 = deviceTree();
  expect(tree1.map(node => node.deviceId)).toEqual(["dev-a", "dev-b"]);
  // Reading twice without a change is the same list (one build shared by every reader).
  expect(deviceTree()).toBe(tree1);
  expect(fleetSessionOwner("s3")).toBe("dev-b");
  expect(indexedFleetSessionRow("dev-b", "s3")?.title).toBe("Bump deps");
  expect(indexedFleetSessionRow("dev-a", "s3")).toBe(null);

  entry.push([{ event: "fleet://index-changed", payload: { revision: 2, deviceIds: ["dev-a", "dev-b"] } }]);
  await tick();
  const tree2 = deviceTree();
  expect(tree2).not.toBe(tree1);
  // dev-a did not change: the very same node; dev-b's untouched session row is kept.
  expect(tree2[0]).toBe(tree1[0]);
  expect(tree2[1]).not.toBe(tree1[1]);
  expect(tree2[1]!.workspaces[0]!.sessions[0]).toBe(tree1[1]!.workspaces[0]!.sessions[0]);
  expect(tree2[1]!.workspaces[0]!.sessions[1]!.title).toBe("Bump all deps");
  expect(indexedFleetSessionRow("dev-b", "s3")?.title).toBe("Bump all deps");

  entry.push([{ event: "fleet://index-changed", payload: { revision: 3, deviceIds: ["dev-a"] } }]);
  await tick();
  // A new navigator view with the same content keeps the tree as it was.
  expect(deviceTree()).toBe(tree2);

});

test("the shell layout is written once it holds still, with the last value", async () => {
  await loadShellLayout();
  const stored = async () => {
    const raw = await Storage.getItem(SHELL_LAYOUT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { navWidth?: number }).navWidth : undefined;
  };
  const before = await stored();
  // A drag: one layout change per frame.
  for (const width of [250, 260, 270, 280, 290]) {
    setNavWidth(width);
    persistShellLayout();
    await tick(10);
  }
  const final = navWidth();
  expect(final).toBe(290);
  // Still within the quiet period: nothing written yet.
  expect(await stored()).toBe(before);
  await tick(SHELL_LAYOUT_PERSIST_DELAY_MS + 100);
  expect(await stored()).toBe(final);

  // A change followed by a flush (window close, app going inactive) is written at once.
  setNavWidth(300);
  persistShellLayout();
  await flushShellLayout();
  expect(await stored()).toBe(navWidth());
  expect(navWidth()).toBe(300);
});

test("on a single host a session's status change rebuilds only that session's row", async () => {
  const entry = scriptedEntry(null, () => null);
  installBackendConnection(entry);
  await entry.ready();
  workspaces.set([{ id: "ws-1", name: "repo", rootPath: "/repo" }]);
  activeWorkspaceKey.set({ deviceId: "", workspaceId: "ws-1" });
  sessions.set([
    { sessionId: "s1", sessionName: "Plan the release", workspaceId: "ws-1", lastActiveAt: 1763000000000 },
    { sessionId: "s2", sessionName: "Build on Linux", workspaceId: "ws-1", lastActiveAt: 1763000000000 },
  ]);
  const tree1 = deviceTree();
  const rows1 = tree1[0]!.workspaces[0]!.sessions;
  expect(rows1.map(row => row.sessionId)).toEqual(["s1", "s2"]);
  expect(rows1[0]!.mark).not.toBe("working");

  runningTurns.set({ "/s1": "turn-1" });
  const tree2 = deviceTree();
  const rows2 = tree2[0]!.workspaces[0]!.sessions;
  expect(rows2[0]).not.toBe(rows1[0]);
  expect(rows2[0]!.mark).toBe("working");
  expect(rows2[1]).toBe(rows1[1]);

  // An unrelated change (a running turn's id) keeps every row and the list.
  runningTurns.set({ "/s1": "turn-2" });
  expect(deviceTree()).toBe(tree2);
});

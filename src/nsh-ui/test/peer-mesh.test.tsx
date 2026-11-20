// Peer Device Mode over OBP on the account mesh: negotiation, routing, live
// events, resume and the legacy relay fallback for older devices.

import { expect, open, test } from "nsh/test";
import type { BackendConnection, BackendEvent } from "../src/backendConnection";
import { createMeshPeerConnection, type PeerLinkInfo } from "../src/meshPeerConnection";
import { LEGACY_RELAY_TRANSPORT_COMMANDS, isOwnerOnlyEvent, staysOnController } from "../src/peerRouting";
import { choosePeerTransport, type MeshDeviceEntry } from "../src/peerStore";
import { createDeviceBackend, withMeshPeerFixtures } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

const MESH_LINUX: MeshDeviceEntry = {
  deviceId: "device-linux",
  name: "builder",
  virtualIp: "10.126.126.2",
  reachable: true,
  path: "p2p",
  latencyMs: 2.4,
  obpProtocol: 1,
  capabilities: ["obp_v1", "resume", "credit_ack", "coalesce_text", "mesh_v1"],
  backendVersion: "1.0.11",
};

test("negotiation: mesh devices use OBP, older devices the relay, and a mesh device never falls back", () => {
  const pick = (input: Partial<Parameters<typeof choosePeerTransport>[0]>) =>
    choosePeerTransport({
      deviceId: "device-linux",
      meshDevices: [MESH_LINUX],
      rememberedOnMesh: false,
      label: "builder",
      ...input,
    }).transport;
  expect(pick({})).toBe("mesh");
  // An older device never joins the mesh: the legacy path keeps it working.
  expect(pick({ meshDevices: [] })).toBe("relay");
  // This machine runs no mesh (an older or Tauri host): legacy too.
  expect(pick({ meshDevices: null })).toBe("relay");
  // A device on the mesh whose backend does not answer is reported, not relayed.
  expect(pick({ meshDevices: [{ ...MESH_LINUX, reachable: false, error: "timed out" }] })).toBe("refused");
  // A device seen on the mesh before stays on it even while it is missing.
  expect(pick({ meshDevices: [], rememberedOnMesh: true })).toBe("refused");
  expect(pick({ meshDevices: null, rememberedOnMesh: true })).toBe("refused");
  // A mesh device without the OBP capability is a newer protocol: refused, not relayed.
  expect(pick({ meshDevices: [{ ...MESH_LINUX, capabilities: ["mesh_v2"] }] })).toBe("refused");
});

test("routing is registry-driven: controller-local commands and owner-only events stay here", () => {
  for (const local of ["peer_link_call", "peer_link_events", "mesh_list_devices", "account_login", "obp_create_pairing"]) {
    expect(staysOnController(local)).toBe(true);
  }
  for (const proxied of ["list_persisted_sessions_page", "load_session_turns", "start_dialog_turn"]) {
    expect(staysOnController(proxied)).toBe(false);
  }
  for (const owner of ["account://login-state", "mesh://status-changed", "host://shell-request", "window://x"]) {
    expect(isOwnerOnlyEvent(owner)).toBe(true);
  }
  for (const product of ["agentic://text-chunk", "backend://events-dropped", "terminal_event"]) {
    expect(isOwnerOnlyEvent(product)).toBe(false);
  }
});

/** A local backend that answers `peer_link_events` from a script. */
function scriptedLocal(batches: Array<Record<string, unknown>>) {
  const polls: Array<Record<string, unknown>> = [];
  const calls: Array<{ command: string; args: unknown }> = [];
  const local: BackendConnection = {
    kind: "native",
    async invoke(command, args) {
      const request = ((args ?? {}) as { request?: Record<string, unknown> }).request ?? {};
      if (command === "peer_link_events") {
        polls.push(request);
        const next = batches.shift();
        if (next) return next;
        await new Promise(resolve => setTimeout(resolve, 40));
        return { instanceId: "i2", state: "connected", events: [] };
      }
      calls.push({ command, args });
      return { echoed: command };
    },
    subscribe: () => () => undefined,
    ready: async () => ({ version: "1", platform: "macos", dataDir: null }),
    state: () => "connected",
    error: () => "",
    lastSeq: () => null,
  };
  return { local, polls, calls };
}

const LINK: PeerLinkInfo = {
  deviceId: "device-linux",
  transport: "mesh",
  state: "connected",
  capabilities: ["obp_v1", "mesh_v1"],
  backend: { version: "1.0.11", platform: "linux", instanceId: "i1" },
};

test("the mesh connection resumes after the peer's own seq and follows a restarted peer", async () => {
  const chunk = (seq: number, text: string) => ({ seq, event: "agentic://text-chunk", payload: { text } });
  const { local, polls, calls } = scriptedLocal([
    { instanceId: "i1", state: "connected", events: [chunk(5, "a"), chunk(6, "b")] },
    // A replay of what was already applied is not delivered twice.
    { instanceId: "i1", state: "connected", events: [chunk(6, "b"), chunk(7, "c")] },
    { instanceId: "i1", state: "reconnecting", error: "peer_reconnecting: dropped", events: [] },
    // The peer backend restarted: its seq begins again after a drop notice.
    {
      instanceId: "i2",
      state: "connected",
      events: [{ event: "backend://events-dropped", payload: { reason: "backend_restarted" } }, chunk(1, "d")],
    },
  ]);
  const connection = createMeshPeerConnection(local, "device-linux", LINK, { waitMs: 50 });
  const seen: BackendEvent[] = [];
  connection.subscribe(batch => seen.push(...batch));
  const deadline = Date.now() + 3000;
  while (polls.length < 6 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  connection.close();

  expect(seen.map(item => (item.payload as { text?: string; reason?: string }).text ?? "drop")).toEqual([
    "a",
    "b",
    "c",
    "drop",
    "d",
  ]);
  // The first poll names the instance; later ones resume after the last peer seq.
  expect(polls[0]).toMatchObject({ deviceId: "device-linux", instanceId: "i1" });
  expect(polls[0]!.afterSeq).toBeUndefined();
  expect(polls[1]).toMatchObject({ afterSeq: 6, instanceId: "i1" });
  expect(polls[2]).toMatchObject({ afterSeq: 7 });
  // After the restart the cursor belongs to the new instance.
  expect(polls[4]).toMatchObject({ afterSeq: 1, instanceId: "i2" });
  // Polling is all the stream does: no call was made for it.
  expect(calls).toEqual([]);
});

test("calls go to the peer with the Tauri args unchanged", async () => {
  const { local, calls } = scriptedLocal([]);
  const connection = createMeshPeerConnection(local, "device-linux", LINK, { waitMs: 50 });
  expect(await connection.invoke("load_session_turns", { request: { session_id: "s1" } })).toEqual({
    echoed: "peer_link_call",
  });
  expect(await connection.invoke("submit_user_answers", { toolId: "t", answers: {}, sessionId: "s" })).toEqual({
    echoed: "peer_link_call",
  });
  expect(calls).toEqual([
    {
      command: "peer_link_call",
      args: { request: { deviceId: "device-linux", command: "load_session_turns", args: { request: { session_id: "s1" } } } },
    },
    {
      command: "peer_link_call",
      args: {
        request: {
          deviceId: "device-linux",
          command: "submit_user_answers",
          args: { toolId: "t", answers: {}, sessionId: "s" },
        },
      },
    },
  ]);
});

test("a mesh peer is driven over OBP with live tokens and never touches the old relay", async () => {
  const backend = createDeviceBackend({ onlineDevices: [{ deviceId: "device-mac" }] });
  const mesh = withMeshPeerFixtures(backend, { meshDevices: [MESH_LINUX] });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("builder");
  // Only the mesh says it is online (relay presence does not): Use is offered.
  await app.press("device-use-device-linux");
  await app.waitFor("peer session on device-linux");
  // The surface says which transport it uses.
  await app.waitFor("Live over the device mesh (direct, 2 ms)");

  // The peer's data came through the OBP link.
  expect(mesh.peerCalls.some(call => call.command === "list_persisted_sessions_page")).toBe(true);
  // Controller-local work stayed here (never inside a peer call).
  expect(mesh.peerCalls.some(call => staysOnController(call.command))).toBe(false);

  await app.press("peer session on device-linux >> nth=0");
  await app.waitFor("answer from device-linux");

  // Live token streaming: the peer's chunks render as they arrive.
  const peerEvent = (event: string, payload: Record<string, unknown>) => ({
    event,
    payload: { sessionId: "device-linux-session", turnId: "turn-mesh", ...payload },
  });
  mesh.pushPeerEvents([peerEvent("agentic://dialog-turn-started", {})]);
  mesh.pushPeerEvents([peerEvent("agentic://text-chunk", { roundId: "r1", text: "Streaming over" })]);
  await app.waitFor("Streaming over");
  mesh.pushPeerEvents([peerEvent("agentic://text-chunk", { roundId: "r1", text: " the mesh." })]);
  await app.waitFor("Streaming over the mesh.");

  // A local product event does not leak into the peer's surface.
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "device-linux-session", turnId: "turn-mesh", roundId: "r1", text: " LOCAL LEAK" },
  });
  mesh.pushPeerEvents([peerEvent("agentic://text-chunk", { roundId: "r1", text: " Done." })]);
  await app.waitFor("Streaming over the mesh. Done.");
  expect(app.texts().some(text => text.includes("LOCAL LEAK"))).toBe(false);

  // The event stream resumed after the peer's own seq.
  expect(mesh.eventPolls.some(poll => typeof poll.afterSeq === "number" && poll.afterSeq > 100)).toBe(true);

  // Leaving closes the link and returns to this machine.
  await app.press("leave-peer");
  await app.waitUntil(() => mesh.disconnected.includes("device-linux"));

  // New to new: no old relay transport command was ever sent.
  const relayCalls = backend.calls.filter(call => LEGACY_RELAY_TRANSPORT_COMMANDS.has(call.action));
  expect(relayCalls.map(call => call.action)).toEqual([]);
});

test("an older device keeps the legacy relay path and the surface says so", async () => {
  const backend = createDeviceBackend({ onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }] });
  const mesh = withMeshPeerFixtures(backend, { meshDevices: [] });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("peer session on device-linux");
  await app.waitFor("Over the legacy relay: builder runs an older OpenBitFun");
  expect(backend.calls.some(call => call.action === "account_device_rpc")).toBe(true);
  expect(backend.calls.some(call => call.action === "peer_link_connect")).toBe(false);
  expect(mesh.peerCalls).toEqual([]);
});

test("a mesh device the mesh cannot reach is reported, never relayed", async () => {
  const backend = createDeviceBackend({ onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }] });
  withMeshPeerFixtures(backend, {
    meshDevices: [{ ...MESH_LINUX, reachable: false, error: "mesh_unreachable: timed out" }],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("builder is on the device mesh but its backend did not answer. Try again in a moment.");
  expect(backend.calls.some(call => LEGACY_RELAY_TRANSPORT_COMMANDS.has(call.action))).toBe(false);
});

// The backend protocol (OBP) over WebSocket, from the UI side: the generic
// connection against a fake socket (handshake, calls, events, ack, resume,
// re-hydration, refusals), and the shared UI mounted as a backend-served page
// (`fixtures/obpApp.tsx`) driving the simulated backend without ever touching
// the page host's fixtures.

import { expect, open, test } from "nsh/test";
import { endpointUrl, servedBackendParams } from "../src/servedBackend";
import { createWebSocketConnection, type ObpSocket } from "../src/webSocketConnection";
import type { BackendEvent } from "../src/backendConnection";
import { showAllSessions, openSession, createBackend, createDeviceBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface FakeSocket extends ObpSocket {
  url: string;
  sent: Array<Record<string, unknown>>;
  accept(): void;
  push(frame: Record<string, unknown>): void;
  drop(code?: number, reason?: string): void;
}

function fakeSockets() {
  const sockets: FakeSocket[] = [];
  const factory = (url: string): ObpSocket => {
    const socket: FakeSocket = {
      url,
      sent: [],
      readyState: 0,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data: string) {
        socket.sent.push(JSON.parse(data) as Record<string, unknown>);
      },
      close(code?: number, reason?: string) {
        socket.drop(code ?? 1000, reason ?? "");
      },
      accept() {
        (socket as { readyState: number }).readyState = 1;
        socket.onopen?.({});
      },
      push(frame) {
        socket.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", ...frame }) });
      },
      drop(code = 1006, reason = "") {
        if (socket.readyState === 3) return;
        (socket as { readyState: number }).readyState = 3;
        socket.onclose?.({ code, reason });
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, factory };
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

function helloResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 0,
    result: {
      protocol: 1,
      scope: "owner",
      capabilities: ["obp_v1", "resume", "credit_ack"],
      registryDigest: "fnv1a64:test",
      lastSeq: 0,
      creditBytes: 1048576,
      backend: { version: "9.9.9", platform: "linux", instanceId: "instance-a", dataDir: "/data" },
      ...overrides,
    },
  };
}

function eventFrame(seq: number, event: string, payload: unknown = {}) {
  return { method: "event", params: { seq, event, payload } };
}

test("handshake, calls with the backend's own errors, and events in order with acks", async () => {
  const { sockets, factory } = fakeSockets();
  const connection = createWebSocketConnection({ url: "ws://backend/obp", createSocket: factory, minBackoffMs: 5 });
  const batches: BackendEvent[][] = [];
  connection.subscribe(events => batches.push([...events]));
  expect(connection.state()).toBe("connecting");

  const socket = sockets[0];
  expect(socket.url).toBe("ws://backend/obp");
  socket.accept();
  const hello = socket.sent[0];
  expect(hello.method).toBe("hello");
  expect(hello.params).toMatchObject({ protocol: 1, ack: true });

  // A command waits for the handshake instead of racing it.
  const echoed = connection.invoke("get_config", { request: { path: "x" } });
  await tick();
  expect(socket.sent.length).toBe(1);
  socket.push(helloResult({ lastSeq: 4 }));
  expect(connection.state()).toBe("connected");
  expect(connection.scope()).toBe("owner");
  expect(await connection.ready()).toEqual({ version: "9.9.9", platform: "linux", dataDir: "/data" });
  await tick();
  const call = socket.sent[1];
  expect(call.method).toBe("call");
  expect(call.params).toEqual({ command: "get_config", args: { request: { path: "x" } } });
  socket.push({ id: call.id, result: { value: 1 } });
  expect(await echoed).toEqual({ value: 1 });

  const failing = connection.invoke("delete_session", { request: {} });
  await tick();
  socket.push({ id: socket.sent[2].id, error: { code: -32000, message: "session is running" } });
  let message = "";
  await failing.catch(error => (message = (error as Error).message));
  expect(message).toBe("session is running");

  // Events after the hello cursor arrive once each, then are acknowledged.
  socket.push(eventFrame(5, "agentic://tool-event", { n: 5 }));
  socket.push(eventFrame(5, "agentic://tool-event", { n: 5 }));
  socket.push(eventFrame(6, "agentic://tool-event", { n: 6 }));
  expect(batches.map(batch => batch[0].seq)).toEqual([5, 6]);
  expect(connection.lastSeq()).toBe(6);
  await tick(60);
  const ack = socket.sent.find(frame => frame.method === "ack");
  expect(ack?.params).toEqual({ seq: 6 });
  connection.close();
});

test("a dropped socket reconnects, resumes after the last seq, and fails pending calls loudly", async () => {
  const { sockets, factory } = fakeSockets();
  const connection = createWebSocketConnection({ url: "ws://backend/obp", createSocket: factory, minBackoffMs: 5 });
  const seen: BackendEvent[] = [];
  connection.subscribe(events => seen.push(...events));
  sockets[0].accept();
  sockets[0].push(helloResult({ lastSeq: 10 }));
  sockets[0].push(eventFrame(11, "agentic://tool-event"));

  const inFlight = connection.invoke("list_sessions", { request: {} });
  await tick();
  sockets[0].drop(1006);
  let message = "";
  await inFlight.catch(error => (message = (error as Error).message));
  expect(message).toContain("closed before `list_sessions` answered");
  expect(connection.state()).toBe("reconnecting");

  await tick(20);
  expect(sockets.length).toBe(2);
  sockets[1].accept();
  expect(sockets[1].sent[0].params).toMatchObject({ lastSeq: 11, instanceId: "instance-a" });
  sockets[1].push(helloResult({ lastSeq: 12 }));
  expect(connection.state()).toBe("connected");
  // The replay may repeat what was delivered; the new seq passes.
  sockets[1].push(eventFrame(11, "agentic://tool-event"));
  sockets[1].push(eventFrame(12, "agentic://tool-event"));
  expect(seen.map(item => item.seq)).toEqual([11, 12]);

  // A restarted backend numbers from scratch: events-dropped replaces the cursor.
  sockets[1].push(eventFrame(3, "backend://events-dropped", { afterSeq: 12, resumeSeq: 4, reason: "backend_restarted" }));
  sockets[1].push(eventFrame(4, "agentic://tool-event"));
  expect(seen.map(item => `${item.event}:${item.seq}`).slice(-2)).toEqual([
    "backend://events-dropped:3",
    "agentic://tool-event:4",
  ]);
  connection.close();
});

test("refusals are final: protocol mismatch, revoked pairing", async () => {
  const mismatch = fakeSockets();
  const old = createWebSocketConnection({ url: "ws://backend/obp", createSocket: mismatch.factory, minBackoffMs: 5 });
  mismatch.sockets[0].accept();
  mismatch.sockets[0].push({ id: 0, error: { code: -32005, message: "this backend speaks OBP version 2" } });
  let readyError = "";
  await old.ready().catch(error => (readyError = (error as Error).message));
  expect(readyError).toBe("this backend speaks OBP version 2");
  expect(old.state()).toBe("failed");
  let invokeError = "";
  await old.invoke("get_config", {}).catch(error => (invokeError = (error as Error).message));
  expect(invokeError).toBe("this backend speaks OBP version 2");
  await tick(30);
  expect(mismatch.sockets.length).toBe(1);

  const revoked = fakeSockets();
  const phone = createWebSocketConnection({ url: "wss://lan/obp", createSocket: revoked.factory, minBackoffMs: 5 });
  revoked.sockets[0].accept();
  revoked.sockets[0].push(helloResult({ scope: "paired-client" }));
  expect(phone.scope()).toBe("paired-client");
  revoked.sockets[0].drop(4003, "credential revoked");
  expect(phone.state()).toBe("failed");
  expect(phone.error()).toContain("revoked");
  await tick(30);
  expect(revoked.sockets.length).toBe(1);
});

test("a refused upgrade asks the session endpoint and says the page has no session", async () => {
  const { sockets, factory } = fakeSockets();
  const connection = createWebSocketConnection({
    url: "ws://backend/obp",
    createSocket: factory,
    minBackoffMs: 50,
    probeSession: async () => ({ authorized: false }),
  });
  sockets[0].drop(1006);
  await tick(5);
  expect(connection.state()).toBe("failed");
  expect(connection.error()).toContain("no session");
  connection.close();
});

test("the served page's parameters name the endpoint", () => {
  expect(servedBackendParams({})).toBe(null);
  expect(servedBackendParams({ obp: { path: "/obp", protocol: 1 } })).toEqual({ url: null, path: "/obp", protocol: 1 });
  expect(endpointUrl({ url: "wss://192.168.1.5:47611/obp" }, null)).toBe("wss://192.168.1.5:47611/obp");
  expect(endpointUrl({ path: "/obp" }, "https://192.168.1.5:47611/index.html")).toBe("wss://192.168.1.5:47611/obp");
  expect(endpointUrl({ path: "/obp" }, "http://127.0.0.1:47610/")).toBe("ws://127.0.0.1:47610/obp");
  expect(endpointUrl({ path: "/obp" }, null)).toBe(null);
});

/** Plays the backend behind the socket: `hello`, `call` from the simulated backend, `obp_*`. */
function obpHost(backend: ReturnType<typeof createBackend>) {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const pageHostCalls: unknown[] = [];
  // A current backend: no LAN block in the status, the LAN switch retired.
  const status = () => ({
    available: true,
    protocol: 1,
    webUi: true,
    loopbackUrl: "http://127.0.0.1:47610/",
    ownerUrl: "http://127.0.0.1:47610/?token=t",
    pairedClients: [{ id: "c1", name: "iPhone browser", createdAtMs: 1, lastSeenAtMs: null, connected: true }],
    ownerConnections: 1,
    pairedConnections: 1,
    accountDeviceConnections: 0,
    meshPort: 47612,
  });
  const answerObp = (command: string, _args: Record<string, unknown>): unknown => {
    if (command === "obp_get_status") return status();
    if (command === "obp_revoke_paired_client") return { ...status(), pairedClients: [] };
    return undefined;
  };
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.obpSend": (data: unknown) => {
      const frame = JSON.parse((data as { frame: string }).frame) as Record<string, unknown>;
      if (frame.method === "hello") return [JSON.stringify({ jsonrpc: "2.0", ...helloResult() })];
      if (frame.method !== "call") return [];
      const params = frame.params as { command: string; args: Record<string, unknown> };
      calls.push(params);
      const obp = answerObp(params.command, params.args);
      if (obp !== undefined) return [JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: obp })];
      const keys = Object.keys(params.args);
      const requestShape = keys.length === 0 || (keys.length === 1 && keys[0] === "request");
      const reply = backend.handlers["openbitfun.invoke"](
        requestShape ? { action: params.command, request: params.args.request ?? null } : { action: params.command, raw: params.args },
      ) as { ok: boolean; value?: unknown; error?: string };
      const body = reply.ok
        ? { result: reply.value ?? null }
        : { error: { code: -32000, message: reply.error ?? `${params.command} failed` } };
      return [JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...body })];
    },
    "openbitfun.invoke": (data: unknown) => {
      pageHostCalls.push(data);
      return { ok: false, error: "the page host must not be used" };
    },
    "openbitfun.listen": (data: unknown) => {
      pageHostCalls.push(data);
      return { ok: true };
    },
  };
  return { handlers, calls, pageHostCalls };
}

test("a backend-served page drives the backend over OBP and never the page host's fixtures", async () => {
  const backend = createBackend();
  const host = obpHost(backend);
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });

  await showAllSessions(app, "NSH skeleton");
  expect(host.pageHostCalls).toEqual([]);
  expect(host.calls.length).toBeGreaterThan(0);
  expect(backend.actions()).toEqual(host.calls.filter(call => !call.command.startsWith("obp_")).map(call => call.command));

  // Streamed events reach the scenes.
  await openSession(app, "NSH skeleton >> nth=0");
  await app.waitFor("Message");
  await app.host.send("openbitfun.obpFrames", [
    JSON.stringify({
      jsonrpc: "2.0",
      method: "event",
      params: {
        seq: 1,
        event: "backend-event-toolawaitinguserinput",
        payload: {
          toolId: "tool-obp",
          sessionId: "session-1",
          questions: {
            questions: [{ question: "Ship it now?", header: "Deploy", multiSelect: false, options: [{ label: "Yes", description: "" }] }],
            responseHostNowMs: 1,
            responseDeadlineMs: 0,
          },
        },
      },
    }),
  ]);
  await app.waitFor("Deploy: Ship it now?");
  expect(host.pageHostCalls).toEqual([]);
});

test("Devices lists paired devices and revokes one; no LAN switch", async () => {
  const backend = createDeviceBackend();
  const host = obpHost(backend);
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });

  await showAllSessions(app, "NSH skeleton");
  // Browsers that drive this computer are listed in Settings › Account › Devices and chat apps.
  await app.press("Settings");
  await app.press("Devices and chat apps");
  await app.waitFor("label:obp-pairing-card");
  await app.waitFor("Browser on this computer");
  await app.waitFor("text:http://127.0.0.1:47610/");
  await app.waitFor("iPhone browser");
  expect(app.shows("label:obp-lan-toggle")).toBe(false);
  expect(app.shows("label:obp-pair-device")).toBe(false);

  await app.press("label:obp-revoke-c1");
  await app.waitFor("label:obp-revoke-confirm-dialog");
  expect(host.calls.some(call => call.command === "obp_revoke_paired_client")).toBe(false);
  await app.press("label:obp-revoke-confirm");
  await app.waitUntil(() => host.calls.some(call => call.command === "obp_revoke_paired_client"));
  expect(host.calls.find(call => call.command === "obp_revoke_paired_client")?.args).toEqual({ request: { clientId: "c1" } });
  expect(host.calls.some(call => call.command === "obp_set_lan_enabled")).toBe(false);
});

// Spaces everywhere (wave 22, P4; tauri-gap §1.4, §4.3): a Space opens inside
// the app on every client and its frame's calls run on the Space's device
// through `miniapp_inline`; versions, customization drafts and grants run
// there too; the account catalog lists Spaces on other devices; Library ›
// Spaces has the quiet "Apps | Cards | Market | Submissions" switch.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, type Backend } from "./support";
import { SpaceFrameSession, SPACE_FRAME_SHIM, spaceDeliverScript } from "../src/spaceFrame";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "macos" as const };

const BOARD = {
  id: "space-board",
  name: "Release Tracker",
  description: "Tracks release blockers.",
  icon: "layout-grid",
  category: "developer",
  tags: [],
  version: 3,
  created_at: 1763000000000,
  updated_at: 1763100000000,
  runtime_profile: "compatibility",
  permissions: { fs: { read: ["."], write: [] }, node: { enabled: true } },
  permission_badges: ["filesystem", "node_worker"],
};

interface SpacesState {
  inline: Array<Record<string, unknown>>;
  draftSynced: boolean;
}

function withSpaces(backend: Backend, state: SpacesState): Backend {
  const original = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown>; raw?: Record<string, unknown> };
    const action = args.action ?? "";
    const request = (args.request ?? args.raw ?? {}) as Record<string, any>;
    const record = () => backend.calls.push({ action, request: args.request ?? args.raw, raw: "raw" in args });
    const ok = (value: unknown) => {
      record();
      return { ok: true, value, transport: "dev" };
    };
    switch (action) {
      case "list_miniapps":
        return ok([BOARD]);
      case "miniapp_worker_list_running":
        return ok([]);
      case "get_miniapp_versions":
        return ok([1, 2, 3]);
      case "miniapp_account_catalog":
        return ok({
          scope: "account",
          thisDevice: "desk",
          apps: [
            { appId: "space-board", name: "Release Tracker", description: "", icon: "", category: "", version: 3, updatedAt: 3, runtimeProfile: "compatibility", needsDevice: true, installedHere: true, devices: [{ deviceId: "desk", version: 3, updatedAt: 3 }, { deviceId: "laptop-1", version: 2, updatedAt: 2 }] },
            { appId: "space-far", name: "Garden Log", description: "Plant notes", icon: "", category: "", version: 1, updatedAt: 1, runtimeProfile: "compatibility", needsDevice: false, installedHere: false, devices: [{ deviceId: "laptop-1", version: 1, updatedAt: 1 }] },
          ],
        });
      case "miniapp_inline": {
        state.inline.push(request);
        if (request.method === "open") {
          const id = String(request.params?.appId ?? "");
          return ok({
            instance: { instanceId: `inst-${id}` },
            view: { viewId: `view-${id}`, kind: "tab" },
            app: { id, name: id === "space-far" ? "Garden Log" : "Release Tracker", compiled_html: "<main>Space</main>", runtime_profile: "compatibility" },
            locale: "en-US",
            appearanceMode: "dark",
          });
        }
        if (request.method === "poll") return ok({ events: [], cursor: 0 });
        return ok(null);
      }
      case "rollback_miniapp":
        return ok({ ...BOARD, version: request.version });
      case "miniapp_create_draft":
        return ok({ app_id: "space-board", draft_id: "d-1", source_version: 3, status: "active", draft_root: "/drafts/space-board/d-1", created_at: 1, updated_at: 1 });
      case "miniapp_sync_draft_from_fs":
        state.draftSynced = true;
        return ok({ app_id: "space-board", draft_id: "d-1", source_version: 3, status: "active", draft_root: "/drafts/space-board/d-1", created_at: 1, updated_at: 2 });
      case "miniapp_permission_diff_for_draft":
        return ok({ high_risk: true, added: ["shell: git"], expanded: [], removed: [] });
      case "miniapp_apply_draft":
        return ok({ ...BOARD, version: 4 });
      case "miniapp_discard_draft":
      case "grant_miniapp_workspace":
        return ok(null);
      default:
        return original(data);
    }
  };
  return backend;
}

async function openSpaces(app: Awaited<ReturnType<typeof open>>): Promise<void> {
  await app.waitFor("Library");
  if (!app.shows("library-tab-spaces")) await app.press("Library");
  await app.press("library-tab-spaces");
  await app.waitFor("Release Tracker");
}

test("frame bridge: SDK calls become miniapp_inline rpc on the device, locale is local, agent requests are claimed and answered", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const delivered: unknown[] = [];
  let polls = 0;
  let ready = false;
  const session = new SpaceFrameSession("space-board", "/work/repo", {
    invoke: async (method, params) => {
      calls.push({ method, params });
      if (method === "open")
        return {
          instance: { instanceId: "inst-1" },
          view: { viewId: "view-1" },
          app: { name: "Release Tracker", compiled_html: "<main>Space</main>" },
          locale: "zh-CN",
          appearanceMode: "light",
        };
      if (method === "ready") ready = true;
      if (method === "poll") {
        if (!ready) {
          await new Promise(resolve => setTimeout(resolve, 5));
          return { events: [], cursor: 0 };
        }
        polls += 1;
        if (polls === 1)
          return { events: [{ sequence: 1, event: "agentRequest", payload: { requestId: "r-1", method: "observe", schemaVersion: "agent.v1" } }], cursor: 1 };
        if (polls === 2) return { events: [{ sequence: 2, event: "worker:event", payload: { event: "tick", data: 1 } }], cursor: 2 };
        await new Promise(resolve => setTimeout(resolve, 20));
        return { events: [], cursor: 2 };
      }
      if (method === "agentClaim") return { accepted: true };
      if (method === "rpc") return { ok: true, echo: params.method };
      return null;
    },
    deliver: message => delivered.push(message),
    pollWaitMs: 0,
  });
  await session.open("light");
  const opened = calls.find(call => call.method === "open")!;
  expect(opened.params).toMatchObject({ appId: "space-board", workspacePath: "/work/repo", shellCapabilities: ["miniapp_agent_bridge_v1"], appearanceMode: "light" });
  expect(String(opened.params.nonce).length >= 16).toBe(true);
  expect(session.bootstrap()?.html).toBe("<main>Space</main>");

  await session.pageLoaded();
  expect(session.status()).toBe("ready");
  expect(calls.find(call => call.method === "ready")?.params).toMatchObject({ instanceId: "inst-1", viewId: "view-1", nonce: opened.params.nonce });

  // worker.call from the page: one rpc on the device, the answer goes back by id.
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "rpc-7", method: "worker.call", params: { method: "status", params: {} } }));
  const rpc = calls.find(call => call.method === "rpc")!;
  expect(rpc.params).toMatchObject({
    instanceId: "inst-1",
    viewId: "view-1",
    method: "worker.call",
    params: { method: "status", params: {} },
  });
  expect(delivered).toContainEqual({ jsonrpc: "2.0", id: "rpc-7", result: { ok: true, echo: "worker.call" } });

  // Locale comes from the device's bootstrap, without a round trip.
  const before = calls.length;
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "l-1", method: "openbitfun/request-locale" }));
  expect(calls.length).toBe(before);
  expect(delivered).toContainEqual({ jsonrpc: "2.0", id: "l-1", result: { locale: "zh-CN" } });

  // A dialog needs the desktop Shell: refused with a reason, never faked.
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "d-1", method: "dialog.open", params: {} }));
  const refusal = delivered.find(item => (item as { id?: string }).id === "d-1") as { error?: { message: string } };
  expect(refusal.error?.message ?? "").toContain("own window");

  // The polled agent request was claimed and forwarded into the page …
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(calls.some(call => call.method === "agentClaim" && call.params.requestId === "r-1")).toBe(true);
  expect(delivered).toContainEqual({ type: "openbitfun:miniapp-agent-request", schemaVersion: "agent.v1", requestId: "r-1", method: "observe" });
  expect(session.agentLog()[0]).toMatchObject({ requestId: "r-1", method: "observe", outcome: "pending" });
  // … and the page's answer goes back with what it declared.
  await session.receive(JSON.stringify({ type: "openbitfun:miniapp-agent-ready", capabilities: ["observe", "act"], actions: ["next"] }));
  await session.receive(JSON.stringify({ type: "openbitfun:miniapp-agent-response", requestId: "r-1", ok: true, value: { state: 1 } }));
  expect(calls.find(call => call.method === "agentResponse")?.params).toMatchObject({
    requestId: "r-1",
    ok: true,
    value: { state: 1 },
    capabilities: ["observe", "act"],
    actions: ["next"],
  });
  expect(session.agentLog()[0].outcome).toBe("answered");
  for (let i = 0; i < 50 && polls < 3; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  expect(delivered).toContainEqual({ type: "openbitfun:event", event: "worker:event", payload: { event: "tick", data: 1 } });

  await session.close();
  expect(calls.some(call => call.method === "close")).toBe(true);
});

test("frame bridge: another screen taking the view over is reported, not retried", async () => {
  const session = new SpaceFrameSession("space-board", null, {
    invoke: async method => {
      if (method === "open") return { instance: { instanceId: "i" }, view: { viewId: "v" }, app: { compiled_html: "<p>x</p>" } };
      if (method === "poll") throw new Error("MiniApp shell identity mismatch");
      return null;
    },
    deliver: () => undefined,
    pollWaitMs: 0,
  });
  await session.open();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(session.status()).toBe("replaced");
});

test("frame shim: the page posts through window.nsh and receives from itself", () => {
  expect(SPACE_FRAME_SHIM).toContain("window.nsh.postMessage");
  expect(SPACE_FRAME_SHIM).toContain('Object.defineProperty(window, "parent"');
  expect(spaceDeliverScript({ id: 1 })).toBe('window.__obfSpaceDeliver && window.__obfSpaceDeliver({"id":1});true;');
});

test("spaces: a Space opens inside the app, versions roll back, and a draft shows its permission diff before apply", async () => {
  const state: SpacesState = { inline: [], draftSynced: false };
  const backend = withSpaces(createBackend(), state);
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSpaces(app);

  // The quiet switch: Apps | Cards | Market | Submissions (no Published: Pages stay off in 2.0).
  expect(app.shows("label:spaces-view-library")).toBe(true);
  expect(app.shows("label:spaces-view-cards")).toBe(true);
  expect(app.texts()).not.toContain("Published");

  // The account's Spaces on other devices.
  await app.waitFor("On your other devices");
  expect(app.shows("label:space-elsewhere-space-far")).toBe(true);

  await app.press("label:space-open-space-board");
  await app.waitFor("label:space-page");
  await app.waitUntil(() => state.inline.some(call => call.method === "open"));
  const opened = state.inline.find(call => call.method === "open")!;
  expect(opened.params).toMatchObject({ appId: "space-board", shellCapabilities: ["miniapp_agent_bridge_v1"] });
  await app.waitFor("label:space-frame");

  // Versions… → Restore calls rollback_miniapp on the Space's device.
  await app.press("label:space-page-more");
  await app.press("label:space-page-versions");
  await app.waitFor("label:space-rollback-1");
  await app.press("label:space-rollback-1");
  await app.waitUntil(() => backend.calls.some(call => call.action === "rollback_miniapp"));
  expect(backend.calls.find(call => call.action === "rollback_miniapp")?.request).toMatchObject({ appId: "space-board", version: 1 });

  // Customize…: a draft, then its permission diff, and only then Apply.
  await app.press("label:space-page-more");
  await app.press("label:space-page-customize");
  await app.press("label:space-draft-start");
  await app.waitFor("/drafts/space-board/d-1");
  expect(app.shows("label:space-draft-apply")).toBe(false);
  await app.press("label:space-draft-review");
  await app.waitFor("label:space-draft-diff");
  expect(state.draftSynced).toBe(true);
  expect(app.texts()).toContain("shell: git");
  expect(backend.calls.some(call => call.action === "miniapp_apply_draft")).toBe(false);
  await app.press("label:space-draft-apply");
  await app.waitUntil(() => backend.calls.some(call => call.action === "miniapp_apply_draft"));
  expect(backend.calls.find(call => call.action === "miniapp_apply_draft")?.request).toMatchObject({ appId: "space-board", draftId: "d-1" });

  // One device without the fleet layer: nothing to move the Space to.
  await app.press("label:space-page-more");
  expect(app.shows("label:space-page-run-laptop-1")).toBe(false);
  await app.press("label:space-page-more");

  // Back closes the view on the device.
  await app.press("label:space-page-back");
  await app.waitUntil(() => state.inline.some(call => call.method === "close"));
  await app.waitFor("Release Tracker");
});

test("spaces: the Cards tab holds the device's cards", async () => {
  const backend = withSpaces(createBackend(), { inline: [], draftSynced: false });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSpaces(app);
  expect(app.shows("label:cards-section")).toBe(false);
  await app.press("label:spaces-view-cards");
  await app.waitFor("label:cards-section");
});

test("spaces: on a phone a Space opens inside the app too", async () => {
  const state: SpacesState = { inline: [], draftSynced: false };
  const backend = withSpaces(createBackend(), state);
  const app = await open("../App.tsx", { ...PHONE, host: { handlers: backend.handlers } });
  await openSpaces(app);
  await app.press("label:space-open-space-board");
  await app.waitFor("label:space-frame");
  expect(state.inline[0]).toMatchObject({ method: "open", params: { appId: "space-board" } });
});

test("spaces over the fleet: a Space on another device opens there, and one with device capabilities can move", async () => {
  const state: SpacesState = { inline: [], draftSynced: false };
  const backend = withSpaces(createBackend(), state);
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "desk" },
    navigator: {
      revision: 1,
      full: true,
      devices: [
        fleetDeviceRow("desk", "Desk Mac", [], { hostKind: "desktop" }),
        fleetDeviceRow("laptop-1", "Travel Laptop", [], { hostKind: "desktop" }),
      ],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await openSpaces(app);
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "miniapp_account_catalog"));
  expect(host.fleetCalls.find(call => call.command === "miniapp_account_catalog")?.target).toBe("desk");

  // Garden Log lives on the laptop: its view opens there, by name.
  await app.waitFor("label:space-elsewhere-space-far");
  expect(app.texts()).toContain("Travel Laptop");
  await app.press("label:space-elsewhere-space-far");
  await app.waitUntil(() => host.fleetCalls.some(call => call.command === "miniapp_inline"));
  const openFar = host.fleetCalls.find(call => call.command === "miniapp_inline")!;
  expect(openFar.target).toBe("laptop-1");
  expect((openFar.args.request as Record<string, any>).params.appId).toBe("space-far");
  // A workspace path of this device is never handed to another one.
  expect((openFar.args.request as Record<string, any>).params.workspacePath ?? null).toBe(null);
  await app.press("label:space-page-back");

  // Release Tracker uses files and its worker: "Run on Travel Laptop" moves it.
  await app.press("label:space-open-space-board");
  await app.waitUntil(() =>
    host.fleetCalls.some(call => call.command === "miniapp_inline" && (call.args.request as Record<string, any>).params.appId === "space-board"),
  );
  await app.press("label:space-page-more");
  await app.press("label:space-page-run-laptop-1");
  await app.waitUntil(() =>
    host.fleetCalls.some(
      call =>
        call.command === "miniapp_inline" &&
        call.target === "laptop-1" &&
        (call.args.request as Record<string, any>).method === "open" &&
        (call.args.request as Record<string, any>).params.appId === "space-board",
    ),
  );
});

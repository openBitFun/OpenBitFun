// Standalone native NSH windows for Spaces (MiniApps).
// Verifies both window-mode `SpaceFrameSession` adapters (native file dialogs,
// path grants, message dialog, clipboard, notifications, chat composer, and
// private RPC isolation) and real headless NSH secondary window orchestration
// over `host://shell-request` (`miniapp.window.open` / `focus` / `close`).

import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";
import { SpaceFrameSession } from "../src/spaceFrame";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

test("window-mode SpaceFrameSession supports full desktop adapters and blocks private RPCs", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const delivered: unknown[] = [];
  const openedUrls: string[] = [];
  const notifications: Array<{ title: string; body: string }> = [];
  const chatClaims: Array<Record<string, unknown>> = [];
  const focusedSessions: string[] = [];
  let clipboardText = "initial clipboard";

  const session = new SpaceFrameSession("ppt-live", "/work/slides", {
    kind: "window",
    invoke: async (method, params) => {
      calls.push({ method, params });
      if (method === "open") {
        return {
          presentationCapabilities: [
            "miniapp_custom_chrome_v1",
            "miniapp_chat_snapshot_v1",
            "miniapp_agent_bridge_v1",
          ],
          instance: { instanceId: "inst-win-1" },
          view: { viewId: "view-win-1", kind: "window" },
          app: {
            name: "PPT Live",
            compiled_html: "<main>Deck</main>",
            chrome: { titlebar: { title: "Deck Studio", actions: [{ id: "export", label: "Export", icon: "download" }] } },
          },
          locale: "en-US",
          appearanceMode: "dark",
        };
      }
      if (method === "poll") {
        await new Promise(resolve => setTimeout(resolve, 25));
        return { events: [], cursor: 0 };
      }
      if (method === "rpc") return { ok: true, echoed: params.method };
      return null;
    },
    deliver: message => delivered.push(message),
    openUrl: url => openedUrls.push(url),
    readClipboard: async () => clipboardText,
    writeClipboard: text => {
      clipboardText = text;
    },
    showNotification: async (title, body) => {
      notifications.push({ title, body });
    },
    pickFileDialog: async options => (options.mode === "save" ? "/tmp/out.pptx" : ["/tmp/a.png", "/tmp/b.png"]),
    showMessageDialog: async () => true,
    chat: {
      claim: params => chatClaims.push(params),
      focusSession: async sessionId => {
        focusedSessions.push(sessionId);
      },
      release: () => undefined,
      clearSession: () => undefined,
      setDraft: () => undefined,
      complete: () => null,
    },
    pollWaitMs: 0,
  });

  await session.open("dark");
  const openCall = calls.find(call => call.method === "open")!;
  expect(openCall.params).toMatchObject({
    appId: "ppt-live",
    workspacePath: "/work/slides",
    kind: "window",
    shellCapabilities: ["miniapp_custom_chrome_v1", "miniapp_chat_snapshot_v1", "miniapp_agent_bridge_v1"],
  });
  expect(session.bootstrap()?.chrome?.titlebar?.title).toBe("Deck Studio");
  expect(session.bootstrap()?.chrome?.titlebar?.actions?.[0]?.id).toBe("export");

  // Untrusted content cannot call private host RPCs directly.
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "priv-1", method: "grantSelectedPath", params: { path: "/etc/passwd" } }));
  const privErr = delivered.find(item => (item as { id?: string }).id === "priv-1") as { error?: { message: string } };
  expect(privErr.error?.message).toContain("Private MiniApp host operation");

  // dialog.open authorizes, runs native OS picker, grants each selected path, and returns paths.
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "dlg-1", method: "dialog.open", params: { multiple: true } }));
  expect(delivered).toContainEqual({ jsonrpc: "2.0", id: "dlg-1", result: ["/tmp/a.png", "/tmp/b.png"] });
  const grants = calls.filter(call => call.method === "rpc" && call.params.method === "grantSelectedPath");
  expect(grants.map(item => (item.params.params as { path: string }).path)).toEqual(["/tmp/a.png", "/tmp/b.png"]);

  // dialog.save grants the chosen save path and returns a single string.
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "dlg-2", method: "dialog.save", params: { defaultPath: "deck.pptx" } }));
  expect(delivered).toContainEqual({ jsonrpc: "2.0", id: "dlg-2", result: "/tmp/out.pptx" });

  // dialog.message, clipboard.readText, mailto external link, notifications, revealInFolder, chat.*
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "msg-1", method: "dialog.message", params: { title: "Saved", message: "Done" } }));
  expect(delivered).toContainEqual({ jsonrpc: "2.0", id: "msg-1", result: true });

  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "clip-1", method: "clipboard.readText" }));
  expect(delivered).toContainEqual({ jsonrpc: "2.0", id: "clip-1", result: "initial clipboard" });

  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "url-1", method: "system.openExternal", params: { url: "mailto:hi@openbitfun.com" } }));
  expect(openedUrls).toEqual(["mailto:hi@openbitfun.com"]);

  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "notif-1", method: "notifications.system", params: { title: "Export ready", body: "deck.pptx" } }));
  expect(notifications).toEqual([{ title: "Export ready", body: "deck.pptx" }]);

  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "rev-1", method: "system.revealInFolder", params: { path: "/tmp/out.pptx" } }));
  expect(calls.some(call => call.method === "rpc" && call.params.method === "system.revealInFolder")).toBe(true);

  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "chat-1", method: "chat.claimComposer", params: { title: "Deck Assistant" } }));
  await session.receive(JSON.stringify({ jsonrpc: "2.0", id: "chat-2", method: "chat.focusSession", params: { sessionId: "sess-9" } }));
  expect(chatClaims).toHaveLength(1);
  expect(focusedSessions).toEqual(["sess-9"]);

  await session.close();
  expect(calls.some(call => call.method === "close")).toBe(true);
});

test("native desktop shell announces miniapp.window.* ops and opens/closes a real NSH secondary window", async () => {
  const backend = createBackend();
  const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];
  let seq = 0;
  let nextId = 800;

  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.wireReady": () => JSON.stringify({ version: "2.0.0", platform: "macos", dataDir: "/tmp/openbitfun-test" }),
    "openbitfun.wirePickDirectory": () => "null",
    "openbitfun.wirePickFileDialog": () => "null",
    "openbitfun.wireInvoke": (data: unknown) => {
      const { command, argsJson } = data as { command: string; argsJson: string };
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      invokes.push({ command, args });
      if (command === "host_shell_attach" || command === "host_shell_respond") return "null";
      if (command === "miniapp_inline") {
        const req = (args.request ?? {}) as { method?: string; params?: Record<string, unknown> };
        if (req.method === "open") {
          return JSON.stringify({
            presentationCapabilities: ["miniapp_custom_chrome_v1", "miniapp_chat_snapshot_v1", "miniapp_agent_bridge_v1"],
            instance: { instanceId: "inst-notes" },
            view: { viewId: "view-notes", kind: "window" },
            app: {
              id: "notes",
              name: "Quick Notes",
              compiled_html: "<main>Notes</main>",
              chrome: { titlebar: { title: "Quick Notes", actions: [{ id: "sync", label: "Sync", icon: "refresh" }] } },
            },
            locale: "en-US",
            appearanceMode: "dark",
          });
        }
        if (req.method === "poll") return JSON.stringify({ events: [], cursor: 0 });
        if (req.method === "permissions") return JSON.stringify([]);
        return "null";
      }
      const keys = Object.keys(args);
      const requestShape = keys.length === 0 || (keys.length === 1 && keys[0] === "request");
      const reply = backend.handlers["openbitfun.invoke"](
        requestShape ? { action: command, request: args.request ?? null } : { action: command, raw: args },
      ) as { ok: boolean; value?: unknown; error?: string };
      if (!reply.ok) throw new Error(reply.error ?? `${command} failed`);
      return JSON.stringify(reply.value ?? null);
    },
    "openbitfun.invoke": () => ({ ok: false, error: "the page host must not be used" }),
  };

  function shellRequest(op: string, args: Record<string, unknown>): { batch: string; id: number } {
    const id = nextId++;
    seq += 1;
    return { batch: JSON.stringify([{ seq, event: "host://shell-request", payload: { id, op, args } }]), id };
  }

  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers } });
  await app.waitUntil(() => invokes.some(call => call.command === "host_shell_attach"));
  const ops = ((invokes.find(call => call.command === "host_shell_attach")?.args.request ?? {}) as { ops?: string[] }).ops ?? [];
  for (const op of ["miniapp.window.open", "miniapp.window.focus", "miniapp.window.close"]) {
    expect(ops).toContain(op);
  }

  // Open standalone MiniApp window via shell request.
  const openReq = shellRequest("miniapp.window.open", {
    appId: "notes",
    name: "Quick Notes",
    workspacePath: null,
    launchId: "launch-notes",
  });
  await app.host.send("openbitfun.wireEvents", openReq.batch);
  await app.waitUntil(() =>
    invokes.some(call => call.command === "host_shell_respond" && (call.args.request as { id?: number }).id === openReq.id),
  );
  const openReply = invokes.find(
    call => call.command === "host_shell_respond" && (call.args.request as { id?: number }).id === openReq.id,
  )?.args.request as { ok?: boolean; value?: { windowId?: string } };
  expect(openReply.ok).toBe(true);
  const windowId = openReply.value?.windowId ?? "miniapp-window-launch-notes";
  await app.waitUntil(() => app.window(windowId).state() !== null);

  // Verify `miniapp_inline` opened with `kind: "window"`.
  await app.waitUntil(() =>
    invokes.some(
      call =>
        call.command === "miniapp_inline" &&
        (call.args.request as { method?: string; params?: { kind?: string } }).method === "open" &&
        (call.args.request as { params?: { kind?: string } }).params?.kind === "window",
    ),
  );

  // Close the standalone MiniApp window via shell request -> sends `miniapp_inline close` and closes window.
  const closeReq = shellRequest("miniapp.window.close", { appId: "notes", workspacePath: null });
  await app.host.send("openbitfun.wireEvents", closeReq.batch);
  await app.waitUntil(() =>
    invokes.some(
      call => call.command === "miniapp_inline" && (call.args.request as { method?: string }).method === "close",
    ),
  );
  await app.waitUntil(() => app.window(windowId).state() === null);
});

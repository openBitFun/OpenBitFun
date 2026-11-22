// The embedded browser of the native desktop. The test plays the Rust
// backend: it answers the browser commands the scene sends and, as
// `native_browser.rs` does, asks the NSH shell to act on the page with
// `host://shell-request` (`browser.create`, `browser.navigate`,
// `browser.evaluate`, `browser.input`, ...). The pages are the stand-in web
// views of `fixtures/installFakeBrowser.ts`, since the headless host shows
// none.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost, fleetSessionRow, openSession, openToolScene } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "macos" as const };
const BROWSER_COMMANDS = new Set([
  "browser_webview_create",
  "browser_webview_navigate",
  "browser_webview_reload",
  "browser_webview_eval",
  "browser_webview_set_agent_target_state",
  "browser_webview_report_page_load",
]);

interface ShellReply {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

function browserBackendHost(options: Parameters<typeof createBackend>[0] = {}) {
  const backend = createBackend(options);
  const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];
  const fake: Array<{ label: string; action: string; [key: string]: unknown }> = [];
  const queued: Array<{ op: string; args: Record<string, unknown> }> = [];
  let seq = 0;
  let nextId = 100;
  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.wireReady": () => JSON.stringify({ version: "9.8.7", platform: "macos", dataDir: "/tmp/openbitfun-test" }),
    "openbitfun.wirePickDirectory": () => "null",
    "openbitfun.fakeBrowser": (data: unknown) => {
      fake.push(data as { label: string; action: string });
      return null;
    },
    "openbitfun.wireInvoke": (data: unknown) => {
      const { command, argsJson } = data as { command: string; argsJson: string };
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      invokes.push({ command, args });
      if (BROWSER_COMMANDS.has(command)) {
        const request = (args.request ?? {}) as Record<string, unknown>;
        // What the backend asks the shell for each command.
        if (command === "browser_webview_create") queued.push({ op: "browser.create", args: request });
        if (command === "browser_webview_navigate") queued.push({ op: "browser.navigate", args: request });
        if (command === "browser_webview_reload") queued.push({ op: "browser.reload", args: request });
        if (command === "browser_webview_eval") queued.push({ op: "browser.inject", args: request });
        return "null";
      }
      if (command === "host_shell_attach" || command === "host_shell_respond") return "null";
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
  const replies = () =>
    invokes
      .filter(call => call.command === "host_shell_respond")
      .map(call => call.args.request as ShellReply);
  return {
    handlers,
    invokes,
    fake,
    queued,
    replies,
    /** One `nextEvents` batch carrying a backend event. */
    event(name: string, payload: unknown): string {
      seq += 1;
      return JSON.stringify([{ seq, event: name, payload }]);
    },
    /** One `nextEvents` batch carrying shell requests. */
    requests(items: Array<{ op: string; args: Record<string, unknown> }>): { batch: string; ids: number[] } {
      const ids: number[] = [];
      const batch = JSON.stringify(
        items.map(item => {
          const id = nextId++;
          ids.push(id);
          seq += 1;
          return { seq, event: "host://shell-request", payload: { id, op: item.op, args: item.args } };
        }),
      );
      return { batch, ids };
    },
  };
}

type Wire = ReturnType<typeof browserBackendHost>;
type App = Awaited<ReturnType<typeof open>>;

/** Sends shell requests as the backend does and waits for the shell's answers. */
async function ask(app: App, wire: Wire, items: Array<{ op: string; args: Record<string, unknown> }>): Promise<ShellReply[]> {
  const { batch, ids } = wire.requests(items);
  await app.host.send("openbitfun.wireEvents", batch);
  await app.waitUntil(() => ids.every(id => wire.replies().some(reply => reply.id === id)));
  return ids.map(id => wire.replies().find(reply => reply.id === id) as ShellReply);
}

/** Forwards what the backend queued for the shell (the command side effects). */
async function pump(app: App, wire: Wire): Promise<ShellReply[]> {
  const items = wire.queued.splice(0);
  return items.length ? ask(app, wire, items) : [];
}

function reports(wire: Wire, label: string) {
  return wire.invokes
    .filter(call => call.command === "browser_webview_report_page_load")
    .map(call => call.args.request as { label: string; event: string; url: string; title?: string | null })
    .filter(report => report.label === label);
}

test("the Browser scene opens its page through the backend and the shell actuates an agent sequence", async () => {
  const wire = browserBackendHost();
  const app = await open("./fixtures/browserApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });
  await openSession(app, "NSH skeleton");

  // The shell announces the browser operations with the others.
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));
  const attach = wire.invokes.find(call => call.command === "host_shell_attach");
  const ops = (attach?.args.request as { ops?: string[] } | undefined)?.ops ?? [];
  for (const op of ["browser.create", "browser.navigate", "browser.evaluate", "browser.input", "browser.state", "browser.close"]) {
    expect(ops).toContain(op);
  }

  await openToolScene(app, "browser");
  await app.waitFor("browser-toolbar");
  // The user's page is created by the backend command, as the React scene does.
  await app.waitUntil(() => wire.invokes.some(call => call.command === "browser_webview_create"));
  const create = wire.invokes.find(call => call.command === "browser_webview_create")?.args.request as {
    label: string;
    url: string;
    width: number;
  };
  expect(create.label).toBe("embedded-browser-view-1");
  expect(create.url).toBe("https://openbitfun.com/");
  expect(create.width).toBeGreaterThan(1);
  const [created] = await pump(app, wire);
  expect(created.ok).toBe(true);
  const label = create.label;
  await app.waitFor(`browser-page-${label}`);
  // The page reports its load to the backend, and becomes the agent's target.
  await app.waitUntil(() => reports(wire, label).some(report => report.event === "finished"));
  expect(reports(wire, label).map(report => report.event)).toEqual(["started", "finished"]);
  expect(reports(wire, label)[1].title).toBe("Fake openbitfun.com");
  await app.waitUntil(() =>
    wire.invokes.some(
      call =>
        call.command === "browser_webview_set_agent_target_state" &&
        (call.args.request as { label?: string; active?: boolean }).label === label &&
        (call.args.request as { active?: boolean }).active === true,
    ),
  );

  // The address bar navigates through the backend.
  await app.press("Clear address");
  await app.type("browser-address", "example.com");
  await app.keyboard.press("Enter");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "browser_webview_navigate"));
  expect(wire.invokes.find(call => call.command === "browser_webview_navigate")?.args.request).toEqual({
    label,
    url: "https://example.com",
  });
  await pump(app, wire);
  await app.waitUntil(() => wire.fake.some(item => item.action === "load" && item.src === "https://example.com"));
  await app.waitUntil(() => reports(wire, label).filter(report => report.event === "finished").length === 2);

  // Back goes through `browser_webview_eval`, as in React.
  await app.press("browser-back");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "browser_webview_eval"));
  expect((wire.invokes.find(call => call.command === "browser_webview_eval")?.args.request as { script: string }).script).toBe(
    "history.back()",
  );
  await pump(app, wire);
  await app.waitUntil(() => wire.fake.some(item => item.action === "inject"));

  // An agent-style sequence, as `native_browser.rs` drives it: navigate,
  // read the title, click, read the page state.
  const [navigated] = await ask(app, wire, [{ op: "browser.navigate", args: { label, url: "https://example.org/" } }]);
  expect(navigated.ok).toBe(true);
  await app.waitUntil(() => reports(wire, label).some(report => report.url === "https://example.org/" && report.event === "finished"));
  const [title] = await ask(app, wire, [
    { op: "browser.evaluate", args: { label, script: "(async () => document.title)()", timeoutMs: 5000 } },
  ]);
  expect(title).toEqual({ id: title.id, ok: true, value: { ok: true, value: "Fake example.org" } });
  const [thrown] = await ask(app, wire, [{ op: "browser.evaluate", args: { label, script: "throw new Error('x')" } }]);
  expect(thrown.value).toEqual({ ok: false, code: "ERR_NSH_WEBVIEW_SCRIPT", message: "boom" });
  // The page is on screen, so the click is the user's own (trusted).
  const [clicked] = await ask(app, wire, [{ op: "browser.input", args: { label, input: { type: "click", x: 12, y: 34 } } }]);
  expect(clicked.value).toEqual({ delivered: true });
  expect(wire.fake.filter(item => item.action === "input").map(item => item.input)).toEqual([{ type: "click", x: 12, y: 34 }]);
  const [state] = await ask(app, wire, [{ op: "browser.state", args: { label } }]);
  expect(state.value).toMatchObject({ url: "https://example.org/", title: "Fake example.org", presented: true });

  // Unknown pages and labels are refused, never guessed.
  const [missing, invalid] = await ask(app, wire, [
    { op: "browser.state", args: { label: "embedded-browser-panel-view-gone" } },
    { op: "browser.evaluate", args: { label: "main", script: "1" } },
  ]);
  expect(missing).toEqual({ id: missing.id, ok: true, value: null });
  expect(invalid.ok).toBe(false);
  expect(String(invalid.error)).toContain("invalid browser webview label");
});

test("an agent's page lives hidden, takes DOM input instead of trusted input, and can be presented", async () => {
  const wire = browserBackendHost();
  const app = await open("./fixtures/browserApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));

  // The backend opens an agent page while the Browser scene is not shown.
  const agent = "embedded-browser-panel-view-builtin-browser-open-1-1";
  const [created] = await ask(app, wire, [
    {
      op: "browser.create",
      args: { label: agent, url: "https://example.com/", conversationId: "session-1", width: 1024, height: 768 },
    },
  ]);
  expect(created.ok).toBe(true);
  await app.waitUntil(() => reports(wire, agent).some(report => report.event === "finished"));
  // Hidden: a click is left to the backend's DOM events.
  const [input] = await ask(app, wire, [{ op: "browser.input", args: { label: agent, input: { type: "click", x: 1, y: 2 } } }]);
  expect(input.value).toEqual({ delivered: false });
  const [title] = await ask(app, wire, [{ op: "browser.evaluate", args: { label: agent, script: "document.title" } }]);
  expect(title.value).toEqual({ ok: true, value: "Fake example.com" });

  // The open event presents it in the scene, next to the user's own page.
  await app.host.send(
    "openbitfun.wireEvents",
    wire.event("agentic://open-built-in-browser", { targetId: agent, sessionId: "session-1" }),
  );
  await openToolScene(app, "browser");
  await app.waitFor("browser-toolbar");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "browser_webview_create"));
  await pump(app, wire);
  await app.waitFor("browser-pages");
  await app.press("browser-pages");
  await app.waitFor(`browser-page-option-${agent}`);
  await app.press(`browser-page-option-${agent}`);
  await app.waitUntil(() =>
    wire.invokes.some(
      call =>
        call.command === "browser_webview_set_agent_target_state" &&
        (call.args.request as { label?: string }).label === agent,
    ),
  );
  const [state] = await ask(app, wire, [{ op: "browser.state", args: { label: agent } }]);
  expect(state.value).toMatchObject({ presented: true });

  // The backend closes the page: it leaves the layer.
  await ask(app, wire, [{ op: "browser.close", args: { label: agent } }]);
  await app.waitUntil(() => !app.shows(`browser-page-${agent}`));
  const [gone] = await ask(app, wire, [{ op: "browser.state", args: { label: agent } }]);
  expect(gone.value).toBeNull();
});

test("a window without web views reads the device's page instead of opening one of its own", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await openToolScene(app, "browser");
  await app.waitFor("browser-live-view");
  expect(app.shows("browser-toolbar")).toBe(false);
  expect(backend.actions()).toContain("browser_webview_capture_preview");
  expect(backend.actions()).not.toContain("browser_webview_create");
});

test("the inspector's Browser tab sits beside the session and an agent page of that session presents there", async () => {
  const wire = browserBackendHost();
  const app = await open("./fixtures/browserApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));

  // The header's Browser toggle opens the fourth inspector tab, not a scene.
  await app.press("session-tool-browser");
  await app.waitFor("aux-tab-browser");
  expect(app.shows("aux-tab-changes") || app.shows("aux-tab-git")).toBe(true);
  await app.waitFor("browser-toolbar");
  expect(app.shows("tool-pane-header")).toBe(false);
  await app.waitUntil(() => wire.invokes.some(call => call.command === "browser_webview_create"));
  await pump(app, wire);
  const user = "embedded-browser-view-1";
  await app.waitUntil(() => reports(wire, user).some(report => report.event === "finished"));

  // Closing the inspector, then the session's agent opens a page: it presents beside the session.
  await app.press("aux-close");
  await app.waitUntil(() => !app.shows("aux-tab-browser"));
  const agent = "embedded-browser-panel-view-builtin-browser-open-2-1";
  await ask(app, wire, [
    { op: "browser.create", args: { label: agent, url: "https://example.org/", conversationId: "session-1", width: 1024, height: 768 } },
  ]);
  await app.host.send(
    "openbitfun.wireEvents",
    wire.event("agentic://open-built-in-browser", { targetId: agent, sessionId: "session-1" }),
  );
  await app.waitFor("aux-tab-browser");
  await app.waitFor("browser-toolbar");
  await app.waitUntil(() => app.value("browser-address") === "https://example.org/");
  const [state] = await ask(app, wire, [{ op: "browser.state", args: { label: agent } }]);
  expect(state.value).toMatchObject({ presented: true });

  // Another session's agent page does not take the inspector over.
  await app.press("aux-close");
  const other = "embedded-browser-panel-view-builtin-browser-open-2-2";
  await ask(app, wire, [
    { op: "browser.create", args: { label: other, url: "https://example.net/", conversationId: "session-2", width: 1024, height: 768 } },
  ]);
  await app.host.send(
    "openbitfun.wireEvents",
    wire.event("agentic://open-built-in-browser", { targetId: other, sessionId: "session-2" }),
  );
  await app.waitUntil(() => app.texts().length > 0);
  expect(app.shows("aux-tab-browser")).toBe(false);
});

test("the element picker puts the clicked element into the composer as a reference", async () => {
  const wire = browserBackendHost();
  const app = await open("./fixtures/browserApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));
  await app.press("session-tool-browser");
  await app.waitFor("browser-toolbar");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "browser_webview_create"));
  await pump(app, wire);
  const label = "embedded-browser-view-1";
  await app.waitUntil(() => reports(wire, label).some(report => report.event === "finished"));

  await app.press("browser-more");
  await app.press("browser-pick-element");
  // The picker runs in the page with a result, like `browser.evaluate`.
  await app.waitUntil(() =>
    wire.fake.some(item => item.action === "evaluate" && String(item.script).includes("__openbitfunPicker")),
  );
  await app.waitUntil(() => (app.value("composer") ?? "").includes("#element"));
  expect(app.value("composer")).toBe("#element `main > button.primary` “Sign in” (https://openbitfun.com/) ");
  expect(app.shows("browser-picking")).toBe(false);
  // Nothing is sent: the reference waits in the composer.
  expect(wire.invokes.some(call => call.command === "submit_user_message")).toBe(false);
});

test("a local HTML file typed into the address previews through the workspace and closes back to the page", async () => {
  const wire = browserBackendHost({
    fileContent: { "/repo/site/index.html": "<!DOCTYPE html><html><body><h1>Hello preview</h1></body></html>" },
  });
  const app = await open("./fixtures/browserApp.tsx", { ...DESKTOP, host: { handlers: wire.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));
  await openToolScene(app, "browser");
  await app.waitFor("browser-toolbar");
  await app.waitUntil(() => wire.invokes.some(call => call.command === "browser_webview_create"));
  await pump(app, wire);

  await app.press("Clear address");
  await app.type("browser-address", "file:///repo/site/index.html");
  await app.keyboard.press("Enter");
  await app.waitFor("browser-html-preview");
  // Read through the workspace's device (a remote workspace routes there), never loaded as a page.
  const read = wire.invokes.find(call => call.command === "read_file_content")?.args.request as { filePath: string };
  expect(read.filePath).toBe("/repo/site/index.html");
  expect(wire.invokes.some(call => call.command === "browser_webview_navigate")).toBe(false);
  expect(app.texts()).toContain("/repo/site/index.html");
  const [hidden] = await ask(app, wire, [{ op: "browser.state", args: { label: "embedded-browser-view-1" } }]);
  expect(hidden.value).toMatchObject({ presented: false });

  await app.press("browser-preview-close");
  await app.waitFor("browser-toolbar");
  const [shown] = await ask(app, wire, [{ op: "browser.state", args: { label: "embedded-browser-view-1" } }]);
  expect(shown.value).toMatchObject({ presented: true });
});

/** A host page whose backend answers the live view as a desktop holding `pages` does. */
function liveViewBackend(answer: (request: Record<string, unknown>) => unknown) {
  const backend = createBackend();
  const captures: Array<Record<string, unknown>> = [];
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action, request } = data as { action: string; request?: Record<string, unknown> | null };
    if (action === "browser_webview_capture_preview") {
      captures.push(request ?? {});
      return { ok: true, value: answer(request ?? {}) };
    }
    return invoke(data);
  };
  return { backend, captures };
}

test("a phone shows the session device's page as a read-only live view, polled only while it is on screen", async () => {
  const { backend, captures } = liveViewBackend(request =>
    request.conversationId === "session-1"
      ? {
          status: "snapshot",
          label: "embedded-browser-panel-view-1",
          url: "https://example.com/live",
          title: "Live",
          html: "<!DOCTYPE html><html><head></head><body><h1>Live</h1></body></html>",
          viewportWidth: 1024,
          viewportHeight: 768,
          capturedAtMs: 1,
        }
      : { status: "noPage" },
  );
  const app = await open("../App.tsx", { ...PHONE, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.press("thread-actions-trigger");
  await app.press("session-browser-live");
  await app.waitFor("browser-live-view");
  await app.waitFor("browser-live-frame");
  // The copy of the session's page, with its address and a way out to a real browser.
  expect(captures[0]).toEqual({ conversationId: "session-1" });
  expect(app.texts()).toContain("https://example.com/live");
  expect(app.texts().some(text => text.startsWith("Live view from "))).toBe(true);
  expect(app.shows("browser-live-open")).toBe(true);
  // No address bar, no back or reload: it never pretends to be the page.
  expect(app.shows("browser-toolbar")).toBe(false);
  expect(app.shows("browser-address")).toBe(false);
  expect(backend.actions()).not.toContain("browser_webview_create");

  // About every 2 s while visible.
  await app.waitUntil(() => captures.length >= 2, { timeout: 6000 });

  // Leaving the view stops the reads.
  await app.press("phone-back");
  await app.waitUntil(() => !app.shows("browser-live-view"));
  const seen = captures.length;
  await new Promise(resolve => setTimeout(resolve, 2600));
  expect(captures.length).toBe(seen);
});

test("the live view says what is missing instead of drawing an empty page", async () => {
  let reply: unknown = { status: "noPage" };
  const { backend } = liveViewBackend(() => reply);
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await openToolScene(app, "browser");
  await app.waitFor("browser-live-empty");
  expect(app.texts().some(text => text.startsWith("No page is open on "))).toBe(true);
  expect(app.texts()).toContain("When an agent in this session opens a page, it shows here.");

  // A page too large to copy keeps its address and the way out.
  reply = { status: "tooLarge", label: "embedded-browser-view-1", url: "https://example.com/big", title: "Big" };
  await app.waitUntil(() => app.texts().includes("This page is too large to show here."), { timeout: 6000 });
  expect(app.texts()).toContain("https://example.com/big");
});

test("an older desktop without the live view request gets an update sentence", async () => {
  const backend = createBackend();
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action } = data as { action: string };
    if (action === "browser_webview_capture_preview") {
      return { ok: false, error: "invalid args `request` for command `browser_webview_capture_preview`: missing field `label`" };
    }
    return invoke(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await openToolScene(app, "browser");
  await app.waitFor("browser-live-empty");
  expect(app.texts().some(text => text.startsWith("Update OpenBitFun on "))).toBe(true);
  // Terminal outdated response stops the live-view poll loop instead of retrying every 2 s.
  let captureCount = 0;
  const wrapped = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action } = data as { action: string };
    if (action === "browser_webview_capture_preview") captureCount += 1;
    return wrapped(data);
  };
  await new Promise(resolve => setTimeout(resolve, 2400));
  expect(captureCount).toBe(0);
});

const DEVICE_SETTINGS = "./fixtures/settingsApp.tsx";

function settingsFleet() {
  return {
    revision: 2,
    full: true,
    devices: [
      fleetDeviceRow("dev-a", "MacBook", [
        {
          workspaceId: "workspace-1",
          name: "OpenBitFun",
          rootPath: "/repo",
          isHostCurrent: true,
          sessions: [fleetSessionRow("dev-a", "workspace-1", "session-1", "NSH skeleton")],
        },
      ]),
      fleetDeviceRow(
        "dev-b",
        "linux-box",
        [{ workspaceId: "workspace-2", name: "infra", rootPath: "/srv/infra", isHostCurrent: true, sessions: [] }],
        { hostKind: "cli" },
      ),
    ],
    removedDeviceIds: [],
    totals: { running: 0, waiting: 0, unread: 0 },
  };
}

test("Settings shows the user's own Chrome and connects through the browser's consent page", async () => {
  const backend = createBackend();
  const base = backend.handlers["openbitfun.invoke"];
  const sent: Array<{ action: string; target: string | null; request: unknown }> = [];
  let connected = false;
  let attempts = 0;
  // eslint-disable-next-line prefer-const
  let host: ReturnType<typeof fleetObpHost>;
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action, request } = data as { action?: string; request?: unknown };
    const target = host?.fleetCalls.at(-1)?.target ?? null;
    if (!action?.startsWith("browser_control_") || action === "browser_control_list_browsers") return base(data);
    sent.push({ action, target, request });
    // A CLI device has no browser to control.
    if (target === "dev-b") return { ok: false, error: `${action} is not available on this host: no browser or OS automation` };
    switch (action) {
      case "browser_control_get_status":
        return {
          ok: true,
          value: {
            cdpAvailable: connected,
            defaultCdpSupported: true,
            defaultCdpEnabled: connected,
            setupUrl: "chrome://inspect/#remote-debugging",
            browserReady: connected,
            browserKind: "chrome",
            browserVersion: connected ? "Chrome/142" : null,
            port: 9222,
            pageCount: connected ? 3 : 0,
          },
        };
      case "browser_control_enable_default_cdp":
        attempts += 1;
        // The first attempt opens the browser's own consent page; the second connects.
        if (attempts === 1) {
          return {
            ok: true,
            value: { success: false, status: "requires_user_profile_setup", browserKind: "chrome", setupUrl: "chrome://inspect/#remote-debugging" },
          };
        }
        connected = true;
        return { ok: true, value: { success: true, status: "connected_user_profile", browserKind: "chrome" } };
      case "browser_control_disconnect":
        connected = false;
        return { ok: true, value: { success: true, status: "disconnected", browserKind: "chrome" } };
      default:
        return { ok: false, error: `unexpected ${action}` };
    }
  };
  host = fleetObpHost(backend, { fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" }, navigator: settingsFleet() });
  const app = await open(DEVICE_SETTINGS, { ...DESKTOP, host: { handlers: host.handlers } });
  await app.waitFor("nav-settings-page-desktop-control");
  await app.press("nav-settings-page-desktop-control");
  await app.waitFor("external-browser-section");
  await app.waitFor("external-browser-state");
  expect(app.texts()).toContain("Not connected");
  expect(sent[0]).toMatchObject({ action: "browser_control_get_status", request: { port: 9222 } });

  // Chrome keeps remote debugging as its own setting: the host opens its consent page.
  await app.press("external-browser-connect");
  await app.waitFor("external-browser-outcome-setup");
  expect(app.texts()).toContain("Allow remote debugging on the page Google Chrome opened, then connect again.");
  expect(app.shows("external-browser-copy-setup")).toBe(true);

  await app.press("external-browser-connect");
  await app.waitFor("external-browser-outcome-connected");
  await app.waitUntil(() => app.texts().includes("Connected"));
  expect(app.texts()).toContain("Google Chrome · 3 tabs");
  expect(sent.filter(call => call.action === "browser_control_enable_default_cdp")).toHaveLength(2);

  await app.press("external-browser-disconnect");
  await app.waitFor("external-browser-outcome-disconnected");
  await app.waitUntil(() => app.texts().includes("Not connected"));
});

test("over the fleet, a browser's live view asks the device that runs the session", async () => {
  const { backend, captures } = liveViewBackend(() => ({
    status: "snapshot",
    label: "embedded-browser-panel-view-1",
    url: "https://example.com/fleet",
    title: "Fleet",
    html: "<!DOCTYPE html><html><head></head><body>Fleet</body></html>",
    viewportWidth: 1024,
    viewportHeight: 768,
    capturedAtMs: 1,
  }));
  const host = fleetObpHost(backend, { fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" }, navigator: settingsFleet() });
  const app = await open("./fixtures/obpApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("session-tool-browser");
  await app.press("session-tool-browser");
  await app.waitFor("browser-live-frame");
  // A `fleet_call` addressed to the session's device, never a page this client opens.
  const call = host.fleetCalls.find(item => item.command === "browser_webview_capture_preview");
  expect(call?.target).toBe("dev-a");
  expect((call?.args.request as { conversationId?: string } | undefined)?.conversationId).toBe("session-1");
  expect(captures.length).toBeGreaterThan(0);
  expect(app.texts()).toContain("Live view from MacBook");
  expect(host.fleetCalls.some(item => item.command === "browser_webview_create")).toBe(false);
});

// The embedded browser of the native desktop. The test plays the Rust
// backend: it answers the browser commands the scene sends and, as
// `native_browser.rs` does, asks the NSH shell to act on the page with
// `host://shell-request` (`browser.create`, `browser.navigate`,
// `browser.evaluate`, `browser.input`, ...). The pages are the stand-in web
// views of `fixtures/installFakeBrowser.ts`, since the headless host shows
// none.

import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
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

function browserBackendHost() {
  const backend = createBackend();
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
  await app.waitFor("NSH skeleton");

  // The shell announces the browser operations with the others.
  await app.waitUntil(() => wire.invokes.some(call => call.command === "host_shell_attach"));
  const attach = wire.invokes.find(call => call.command === "host_shell_attach");
  const ops = (attach?.args.request as { ops?: string[] } | undefined)?.ops ?? [];
  for (const op of ["browser.create", "browser.navigate", "browser.evaluate", "browser.input", "browser.state", "browser.close"]) {
    expect(ops).toContain(op);
  }

  await app.press("Browser");
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
  await app.waitFor("NSH skeleton");
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
  await app.press("Browser");
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

test("a window without web views shows the browser as unavailable and creates no page", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("Browser");
  await app.waitFor("browser-unavailable");
  expect(app.texts()).toContain("The browser is not available here");
  expect(app.texts()).toContain(
    "The embedded browser runs in the OpenBitFun desktop app. Pages cannot be shown in this window.",
  );
  expect(backend.actions()).not.toContain("browser_webview_create");
});

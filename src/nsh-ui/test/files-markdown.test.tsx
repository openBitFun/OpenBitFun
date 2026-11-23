// Documents in the Files pane (wave 22 P1): Markdown Preview | Edit with the
// visual editor and its fidelity guard, the source editor on request, save and
// conflict through `write_file_content`, inline AI over `editor_ai_*`, the
// HTML preview, and PDFs (a web view in the desktop app, "open elsewhere" in a
// browser tab or on the phone).
import { expect, open, test } from "nsh/test";
import { createBackend, openToolScene, type Backend, type BackendOptions } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "web" as const };

const FILES = [
  { name: "README.md", path: "/repo/README.md", isDirectory: false },
  { name: "notes.md", path: "/repo/notes.md", isDirectory: false },
  { name: "page.md", path: "/repo/page.md", isDirectory: false },
  { name: "index.html", path: "/repo/index.html", isDirectory: false },
  { name: "manual.pdf", path: "/repo/manual.pdf", isDirectory: false, size: 2048 },
];

const TEXT: Record<string, string> = {
  "/repo/README.md": "# Project\n\nMarkdown preview from the host.",
  // Front matter: the visual editor would rewrite it, so it opens as source.
  "/repo/notes.md": "---\ntitle: Notes\n---\n\n# Notes\n\nKept as written.\n",
  // Raw HTML: the same.
  "/repo/page.md": '<div align="center">Centered</div>\n\nBody text.\n',
  "/repo/index.html": "<!doctype html><html><body><h1>Hello page</h1></body></html>\n",
  "/repo/manual.pdf": "JVBERi0xLjQK",
};

interface DocHarness {
  handlers: Record<string, (data: unknown) => unknown>;
  writes: Array<{ workspaceId?: string; filePath: string; content: string; expectedHash?: string }>;
  calls: Array<{ action: string; payload: Record<string, unknown> }>;
  /** Another writer changes a file on disk. */
  externalWrite(path: string, text: string): void;
}

function documentsBackend(options: BackendOptions = {}): DocHarness {
  const base: Backend = createBackend({ files: FILES, fileContent: TEXT, ...options });
  const text: Record<string, string> = { ...TEXT, ...(options.fileContent ?? {}) };
  const versions: Record<string, number> = {};
  const writes: DocHarness["writes"] = [];
  const calls: DocHarness["calls"] = [];
  const original = base.handlers["openbitfun.invoke"];
  const handlers = {
    ...base.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
      const action = args.action ?? "";
      const payload = ((args.request ?? args.raw) ?? {}) as Record<string, unknown>;
      calls.push({ action, payload });
      switch (action) {
        case "read_file_content": {
          const path = String(payload.filePath ?? "");
          if (path in text) return { ok: true, value: text[path], transport: "dev" };
          return original(data);
        }
        case "get_file_metadata": {
          const path = String(payload.path ?? "");
          if (path in text) {
            return {
              ok: true,
              value: { path, modified: versions[path] ?? 1_700_000_000_000, size: text[path].length },
              transport: "dev",
            };
          }
          return original(data);
        }
        case "write_file_content": {
          const filePath = String(payload.filePath ?? "");
          const content = String(payload.content ?? "");
          if (typeof payload.expectedHash === "string") {
            const actual = crypto.createHash("sha256").update(text[filePath] ?? "").digest("hex");
            if (actual !== payload.expectedHash) {
              return { ok: false, error: "FILE_CONFLICT: File changed after it was read; refresh before saving", transport: "dev" };
            }
          }
          text[filePath] = content;
          versions[filePath] = (versions[filePath] ?? 1_700_000_000_000) + 1;
          writes.push({
            workspaceId: typeof payload.workspaceId === "string" ? payload.workspaceId : undefined,
            filePath,
            content,
            ...(typeof payload.expectedHash === "string" ? { expectedHash: payload.expectedHash } : {}),
          });
          return { ok: true, value: null, transport: "dev" };
        }
        case "editor_ai_stream":
        case "editor_ai_cancel":
        case "open_html_file_in_browser":
          return { ok: true, value: action === "editor_ai_stream" ? { ok: true } : null, transport: "dev" };
        default:
          return original(data);
      }
    },
  };
  return {
    handlers,
    writes,
    calls,
    externalWrite(path, value) {
      text[path] = value;
      versions[path] = (versions[path] ?? 1_700_000_000_000) + 1000;
    },
  };
}

/** The same backend over the native desktop's wire and NSH shell (`fixtures/nativeApp.tsx`). */
function overNativeWire(harness: DocHarness): Record<string, (data: unknown) => unknown> {
  return {
    ...harness.handlers,
    "openbitfun.wireReady": () => JSON.stringify({ version: "9.8.7", platform: "macos", dataDir: "/tmp/openbitfun-test" }),
    "openbitfun.wirePickDirectory": () => "null",
    "openbitfun.wireInvoke": (data: unknown) => {
      const { command, argsJson } = data as { command: string; argsJson: string };
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      if (command === "host_shell_attach" || command === "host_shell_respond") return "null";
      const keys = Object.keys(args);
      const requestShape = keys.length === 0 || (keys.length === 1 && keys[0] === "request");
      const reply = harness.handlers["openbitfun.invoke"](
        requestShape ? { action: command, request: args.request ?? null } : { action: command, raw: args },
      ) as { ok: boolean; value?: unknown; error?: string };
      if (!reply.ok) throw new Error(reply.error ?? `${command} failed`);
      return JSON.stringify(reply.value ?? null);
    },
  };
}

async function openFiles(app: Awaited<ReturnType<typeof open>>): Promise<void> {
  await app.waitFor("nav-library");
  await openToolScene(app, "files");
  await app.waitFor("Explorer");
}

test("Markdown opens as a preview, edits visually and saves the serialized Markdown", async () => {
  const backend = documentsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);

  await app.press("README.md");
  await app.waitFor("file-markdown-preview");
  await app.waitFor("Markdown preview from the host.");
  // The rendered preview, not the source.
  expect(app.texts().join("\n")).not.toContain("# Project");

  // Edit is the visual editor: the heading is a heading, not "# ".
  await app.press("file-edit");
  await app.waitFor("file-editor");
  expect(app.shows("doc-source-fallback")).toBe(false);
  await app.type("file-editor", "Intro ");
  await app.waitFor("Unsaved changes");

  // Preview keeps the draft and shows it rendered; Edit comes back to it.
  await app.press("file-preview");
  await app.waitFor("file-markdown-preview");
  await app.waitFor("Intro Project");
  expect(app.shows("Unsaved changes")).toBe(true);
  await app.press("file-edit");
  await app.waitFor("file-editor");

  await app.press("file-save");
  await app.waitFor("Saved README.md");
  expect(backend.writes).toHaveLength(1);
  expect(backend.writes[0]).toMatchObject({ workspaceId: "workspace-1", filePath: "/repo/README.md" });
  expect(backend.writes[0].content).toBe("# Intro Project\n\nMarkdown preview from the host.\n");
  expect(backend.writes[0].expectedHash).toMatch(/^[0-9a-f]{64}$/);
  // A saved Markdown file goes back to its preview.
  await app.waitFor("file-markdown-preview");
});

test("Mermaid blocks and display formulas render from bundled renderers in a web view island and fall back to source", async () => {
  const backend = documentsBackend({
    fileContent: {
      ...TEXT,
      "/repo/README.md": "# Diagram\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$\nE = mc^2\n$$\n\nInline $a+b$ here.\n",
    },
  });
  const app = await open("../WebApp.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);
  await app.press("README.md");
  await app.waitFor("file-markdown-preview");
  // `WebApp.tsx` registers the renderers this directory ships; they are read on demand.
  await app.waitFor("doc-mermaid-view");
  await app.waitFor("doc-math-view");
  await app.waitFor("a+b");
  // The headless host runs no page, so nothing draws: after the timeout the source shows.
  await app.wait(8500);
  await app.waitFor("doc-mermaid-source");
  await app.waitFor("doc-math-source");
  expect(app.shows("doc-mermaid-view")).toBe(false);
  expect(app.texts().join("\n")).toContain("graph TD; A-->B");
}, 30000);

test("an entry that registered no renderers shows diagrams and formulas as their source", async () => {
  const backend = documentsBackend({
    fileContent: { ...TEXT, "/repo/README.md": "# Diagram\n\n```mermaid\ngraph TD; A-->B\n```\n" },
  });
  // `App.tsx` alone: the native and web entries register their own copies.
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);
  await app.press("README.md");
  await app.waitFor("doc-mermaid-source");
  expect(app.shows("doc-mermaid-view")).toBe(false);
});

test("the fidelity guard opens front matter and raw HTML as source, and Edit as source is one menu away", async () => {
  const backend = documentsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);

  await app.press("notes.md");
  await app.waitFor("file-tab-notes.md");
  await app.press("file-edit");
  await app.waitFor("doc-source-fallback");
  await app.waitFor("This file uses Markdown the visual editor can't keep exactly, so it opens as source.");
  expect(app.value("file-editor")).toBe(TEXT["/repo/notes.md"]);
  // The source editor saves exactly what was typed.
  await app.type("file-editor", "Draft ");
  await app.press("file-save");
  await app.waitFor("Saved notes.md");
  expect(backend.writes[0].content).toContain("---\ntitle: Notes\n---");

  await app.press("page.md");
  await app.waitFor("file-tab-page.md");
  await app.press("file-edit");
  await app.waitFor("doc-source-fallback");
  expect(app.value("file-editor")).toBe(TEXT["/repo/page.md"]);

  // A file the visual editor keeps: the user still may choose the source.
  await app.press("README.md");
  await app.waitFor("file-tab-README.md");
  await app.press("file-edit");
  await app.waitFor("file-doc-menu");
  await app.press("file-doc-menu");
  await app.press("doc-edit-source");
  await app.waitUntil(() => app.value("file-editor") === TEXT["/repo/README.md"]);
  expect(app.shows("doc-source-fallback")).toBe(false);
  await app.press("file-doc-menu");
  await app.press("doc-edit-visual");
  await app.waitUntil(() => app.value("file-editor") !== TEXT["/repo/README.md"]);
});

test("a visual save that finds a newer disk copy still stops at the conflict banner", async () => {
  const backend = documentsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);

  await app.press("README.md");
  await app.waitFor("file-markdown-preview");
  await app.press("file-edit");
  await app.waitFor("file-editor");
  await app.type("file-editor", "Mine ");
  backend.externalWrite("/repo/README.md", "# Agent rewrote this\n");
  await app.press("file-save");
  await app.waitFor("file-conflict-overwrite");
  expect(backend.writes).toHaveLength(0);
  await app.press("file-conflict-overwrite");
  await app.waitFor("Saved README.md");
  expect(backend.writes).toHaveLength(1);
  expect(backend.writes[0].content).toContain("Mine Project");
  expect(backend.writes[0].expectedHash).toBeUndefined();
});

test("inline AI asks the document's device and inserts the answer as Markdown", async () => {
  const backend = documentsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);

  await app.press("README.md");
  await app.waitFor("file-markdown-preview");
  await app.press("file-edit");
  await app.waitFor("file-editor");
  await app.press("file-doc-menu");
  await app.press("doc-ask-ai");
  await app.waitFor("doc-ai-input");
  await app.type("doc-ai-input", "Add a one-line summary");
  await app.press("doc-ai-send");

  await app.waitUntil(() => backend.calls.some(call => call.action === "editor_ai_stream"));
  const stream = backend.calls.find(call => call.action === "editor_ai_stream")!.payload;
  const requestId = String(stream.requestId ?? "");
  expect(requestId).toMatch(/^editor-ai-/);
  expect(String(stream.prompt)).toContain("Request: Add a one-line summary");
  expect(String(stream.prompt)).toContain("Markdown preview from the host.");

  // An answer for another request is not this one's.
  await app.host.send("openbitfun.event", {
    event: "editor-ai://text-chunk",
    payload: { requestId: "editor-ai-other", text: "Not mine" },
  });
  await app.host.send("openbitfun.event", {
    event: "editor-ai://text-chunk",
    payload: { requestId, text: "**Summary:** " },
  });
  await app.host.send("openbitfun.event", {
    event: "editor-ai://completed",
    payload: { requestId, fullText: "**Summary:** a tidy project.", finishReason: "stop" },
  });
  await app.waitFor("doc-ai-answer");
  expect(app.texts().join("\n")).not.toContain("Not mine");
  await app.press("doc-ai-insert");
  await app.waitFor("Unsaved changes");
  await app.press("file-save");
  await app.waitFor("Saved README.md");
  // Inserted at the caret (the start of the document), as Markdown.
  expect(backend.writes[0].content).toContain("**Summary:** a tidy project.");
  expect(backend.writes[0].content).toContain("Markdown preview from the host.");

  // A failed answer says why, in the panel, and inserts nothing.
  await app.press("file-edit");
  await app.waitFor("file-editor");
  await app.press("file-doc-menu");
  await app.press("doc-ask-ai");
  await app.type("doc-ai-input", "Again");
  await app.press("doc-ai-send");
  await app.waitUntil(() => backend.calls.filter(call => call.action === "editor_ai_stream").length === 2);
  const second = String(backend.calls.filter(call => call.action === "editor_ai_stream")[1].payload.requestId);
  await app.host.send("openbitfun.event", {
    event: "editor-ai://error",
    payload: { requestId: second, error: "AI call failed: no model" },
  });
  await app.waitFor("doc-ai-error");
  expect(app.enabled("doc-ai-insert")).toBe(false);
});

test("HTML previews in a script-free web view; a browser tab is not offered the device's system browser", async () => {
  const backend = documentsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);

  await app.press("index.html");
  await app.waitFor("file-tab-index.html");
  await app.waitUntil(() => app.texts().some(text => text.includes("Hello page")));
  // The source is the default; the preview is one tab away.
  await app.waitFor("file-html-preview");
  expect(app.shows("file-html-view")).toBe(false);
  await app.press("file-html-preview");
  await app.waitFor("file-html-view");
  await app.press("file-html-source");
  await app.waitFor("file-html-view", { state: "gone" });
  // This page is not the desktop app: opening the OS browser of the device is not its to offer.
  expect(app.shows("file-open-in-browser")).toBe(false);
});

test("a PDF is a web view in the desktop app, read from its device as base64", async () => {
  const backend = documentsBackend();
  const app = await open("./fixtures/nativeApp.tsx", { ...DESKTOP, host: { handlers: overNativeWire(backend) } });
  await openFiles(app);

  await app.press("manual.pdf");
  await app.waitFor("file-pdf-view");
  const read = backend.calls.find(call => call.action === "read_file_content" && call.payload.filePath === "/repo/manual.pdf");
  expect(read?.payload).toMatchObject({ workspaceId: "workspace-1", encoding: "base64" });

  // The desktop app offers the system browser for a local HTML file of this device.
  await app.press("index.html");
  await app.waitFor("file-open-in-browser");
  await app.press("file-open-in-browser");
  await app.waitUntil(() => backend.calls.some(call => call.action === "open_html_file_in_browser"));
  expect(backend.calls.find(call => call.action === "open_html_file_in_browser")?.payload).toEqual({
    path: "/repo/index.html",
  });
});

test("a PDF in a browser tab says where to open it and reads no bytes", async () => {
  const backend = documentsBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);

  await app.press("manual.pdf");
  await app.waitFor("PDFs preview in the desktop app. Open this one there or in another PDF viewer.");
  expect(app.shows("file-pdf-view")).toBe(false);
  expect(
    backend.calls.some(call => call.action === "read_file_content" && call.payload.filePath === "/repo/manual.pdf"),
  ).toBe(false);
});

test("a remote workspace's document saves through its own workspace id", async () => {
  const backend = documentsBackend({
    openedWorkspaces: [
      { id: "ws-remote", name: "prod", rootPath: "/repo", workspaceKind: "remote" },
    ],
    currentWorkspaceId: "ws-remote",
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openFiles(app);

  await app.press("README.md");
  await app.waitFor("file-markdown-preview");
  await app.press("file-edit");
  await app.waitFor("file-editor");
  await app.type("file-editor", "Remote ");
  await app.press("file-save");
  await app.waitFor("Saved README.md");
  expect(backend.writes[0]).toMatchObject({ workspaceId: "ws-remote", filePath: "/repo/README.md" });
  expect(backend.writes[0].content).toContain("Remote Project");
  const reads = backend.calls.filter(call => call.action === "read_file_content");
  expect(reads.every(call => call.payload.workspaceId === "ws-remote")).toBe(true);
});

test("phone: the document pane is full screen with the same Preview | Edit", async () => {
  const backend = documentsBackend();
  const app = await open("../App.tsx", { ...PHONE, width: 1440, height: 900, host: { handlers: backend.handlers } });
  await openFiles(app);
  await app.setViewport(PHONE.width, PHONE.height);
  await app.waitFor("README.md");
  await app.press("README.md");
  await app.waitFor("file-markdown-preview");
  await app.waitFor("file-edit");
  await app.press("file-edit");
  await app.waitFor("file-editor");
  await app.type("file-editor", "Phone ");
  // Preview | Edit sit in the path strip on a narrow pane, so Save keeps its room.
  await app.press("file-save");
  await app.waitUntil(() => backend.writes.length === 1);
  expect(backend.writes[0].content).toContain("Phone Project");
  await app.waitFor("file-markdown-preview");
});

test("workspaceUtils handles POSIX roots, Windows drives, remote backslashes, prefix boundaries, and markdown links", async () => {
  const {
    dirnameOfPath,
    fileUrlToPath,
    isPathAtOrUnder,
    isRemoteWorkspace,
    joinWorkspacePath,
    resolveWorkspaceMarkdownLink,
  } = await import("../src/shared/workspaceUtils");

  expect(dirnameOfPath("/README.md")).toBe("/");
  expect(dirnameOfPath("/")).toBe("/");
  expect(dirnameOfPath("C:\\foo")).toBe("C:\\");
  expect(dirnameOfPath("C:\\")).toBe("C:\\");
  // Remote POSIX workspaces treat `\` as a literal filename character, never a separator.
  expect(dirnameOfPath("/srv/app/a\\b.txt", true)).toBe("/srv/app");
  expect(joinWorkspacePath("C:\\repo", "src/main.rs", false)).toBe("C:\\repo\\src\\main.rs");
  // Prefix matching requires a separator boundary.
  expect(isPathAtOrUnder("/srv/app-v2", "/srv/app", true)).toBe(false);
  expect(isPathAtOrUnder("/srv/app/src", "/srv/app", true)).toBe(true);
  // Windows file:// URLs drop the leading slash before the drive letter.
  expect(fileUrlToPath("file:///C:/Users/me/my%20doc.md")).toBe("C:/Users/me/my doc.md");
  // Markdown links resolve mailto:, file://, computer://, and relative paths with line suffixes.
  expect(resolveWorkspaceMarkdownLink("mailto:ops@example.com", "/repo", false)).toEqual({
    kind: "external",
    target: "mailto:ops@example.com",
  });
  expect(resolveWorkspaceMarkdownLink("file:///repo/docs/guide.md#L12", "/repo", false)).toEqual({
    kind: "workspace",
    target: "/repo/docs/guide.md",
  });
  expect(resolveWorkspaceMarkdownLink("../src/app.ts:42", "/repo/docs", true)).toEqual({
    kind: "workspace",
    target: "/repo/src/app.ts",
  });
  // Unified remote workspace classification across remote, remote_ssh, docker, wsl, assistant.
  expect(isRemoteWorkspace({ id: "1", rootPath: "/srv", workspaceKind: "remote_ssh" })).toBe(true);
  expect(isRemoteWorkspace({ id: "2", rootPath: "/srv", workspaceKind: "docker" })).toBe(true);
  expect(isRemoteWorkspace({ id: "3", rootPath: "/srv", workspaceKind: "wsl" })).toBe(true);
  expect(isRemoteWorkspace({ id: "4", rootPath: "/home/a", workspaceKind: "assistant" })).toBe(false);
});

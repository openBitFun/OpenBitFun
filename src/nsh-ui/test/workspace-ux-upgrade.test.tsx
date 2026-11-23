// Regression suite covering the 7-item workspace UX upgrade:
// 1. Dual 2-session split view + 4-zone layout (Sidebar + 2 Sessions + AuxPane) + bottom-docked AuxPane
// 2. Removal of clipboard Attach paperclip button
// 3. Styled file attachment chips + long-paste auto-save to <workspace>/.openbitfun/pasted/
// 4. Compact square composer image thumbnails (no filename text) + Image Lightbox (composer & transcript)
// 5. Simplified `...` menu without Open tabs / hidden caches, `/goal` & `/btw` in slash commands
// 6. Complete `/` slash commands + searchable Skills (`get_mode_skill_configs` -> `[$SkillName] `) + `/usage`
// 7. `@` immediate workspace files & folders browsing (`explorer_get_children`), folder drill-down, live search, and styled chips

import { expect, open, test } from "nsh/test";
import { createBackend, openSession } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

type Handler = (request: Record<string, unknown>) => unknown;

function withCommands(backend: ReturnType<typeof createBackend>, handlers: Record<string, Handler>) {
  const sent: Record<string, Array<Record<string, unknown>>> = {};
  const base = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown>; raw?: Record<string, unknown> };
    const action = args.action ?? "";
    const handler = handlers[action];
    if (!handler) return base(data);
    const request = (args.request ?? args.raw ?? {}) as Record<string, unknown>;
    (sent[action] ??= []).push(request);
    try {
      return { ok: true, value: handler(request), transport: "dev" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), transport: "dev" };
    }
  };
  return sent;
}

test("dual 2-session split view streams concurrently, coexists with right AuxPane (4 zones), and docks AuxPane to bottom", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  // Open split view from `...` menu: Pane 0 + Pane 1 display two distinct sessions simultaneously.
  await app.press("thread-actions-trigger");
  await app.press("session-split-open");
  await app.waitFor("id:primary-session-pane");
  await app.waitFor("id:secondary-session-pane");
  await app.waitFor("Port the terminal.");
  expect(app.shows("session-split-handle")).toBe(true);
  expect(app.texts()).toContain("Port the session list.");
  expect(app.texts()).toContain("Port the terminal.");

  // Open right AuxPane (Files) while split view is active -> all 4 zones coexist simultaneously!
  await app.press("session-tool-files");
  await app.waitFor("aux-split-handle-right");
  expect(app.shows("id:primary-session-pane")).toBe(true);
  expect(app.shows("id:secondary-session-pane")).toBe(true);
  expect(app.shows("aux-dock-toggle")).toBe(true);

  // Send a message from Pane 1 AND stream chunks into BOTH Pane 0 and Pane 1 concurrently.
  await app.type("secondary-composer", "Check terminal status");
  await app.press("secondary-send-turn");
  await app.waitUntil(() =>
    backend.calls.some(
      c => c.action === "submit_user_message" && (c.request as Record<string, unknown>)?.sessionId === "session-2",
    ),
  );

  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-1", turnId: "t-live-1", userInput: "Ping primary" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-started",
    payload: { sessionId: "session-2", turnId: "t-live-2", userInput: "Check terminal status" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-1", turnId: "t-live-1", roundId: "r-p1", text: "Primary live stream OK" },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: "session-2", turnId: "t-live-2", roundId: "r-p2", text: "Secondary live stream OK" },
  });
  await app.waitFor("Primary live stream OK");
  await app.waitFor("Secondary live stream OK");

  // Dock AuxPane to the bottom (top/bottom stacked layout) and verify horizontal split handle.
  await app.press("aux-dock-toggle");
  await app.waitFor("aux-split-handle-bottom");
  expect(app.shows("id:primary-session-pane")).toBe(true);
  expect(app.shows("id:secondary-session-pane")).toBe(true);

  // Toggle AuxPane back to right.
  await app.press("aux-dock-toggle");
  await app.waitFor("aux-split-handle-right");

  // Close Pane 1 -> returns to single-pane mode and releases Pane 1 content.
  await app.press("session-pane-close-1");
  await app.waitFor("id:secondary-session-pane", { state: "gone" });
  expect(app.texts()).not.toContain("Secondary live stream OK");
});

test("long text paste (>50 lines or >1000 chars) auto-saves to .openbitfun/pasted/ and attaches a styled chip", async () => {
  const backend = createBackend();
  const sent = withCommands(backend, {
    create_directory: () => null,
    write_file_content: () => null,
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Message");

  // Short paste stays inline in the composer and writes nothing to disk.
  await app.paste("composer", { text: "short snippet" });
  await app.waitUntil(() => app.value("composer") === "short snippet");
  expect(sent.write_file_content ?? []).toHaveLength(0);

  // Clear and paste >50 lines: auto-saved into `<workspace>/.openbitfun/pasted/pasted-*.txt`.
  await app.clear("composer");
  const longText = Array.from({ length: 55 }, (_, i) => `log line ${i + 1}: payload entry`).join("\n");
  await app.paste("composer", { text: longText });

  await app.waitUntil(() => (sent.write_file_content ?? []).length === 1);
  expect(sent.create_directory?.[0]).toMatchObject({
    workspaceId: "workspace-1",
    path: "/repo/.openbitfun/pasted",
  });
  const writeReq = sent.write_file_content![0]!;
  expect(String(writeReq.filePath)).toMatch(/^\/repo\/\.openbitfun\/pasted\/pasted-\d{8}-\d{6}-[0-9a-f]{4}\.txt$/);
  expect(writeReq.content).toBe(longText);
  // Composer input stays clean (not flooded with 55 lines) and renders the pasted file identically to normal file chips (TXT badge + filename, no line-count badge).
  expect(app.value("composer")).toBe("");
  expect(app.texts()).toContain("TXT");
  expect(app.texts().some(t => /^pasted-\d{8}-\d{6}-[0-9a-f]{4}$/.test(t))).toBe(true);
  expect(app.texts().some(t => /lines|行/.test(t))).toBe(false);

  // Sending serializes the styled chip as `#file:.openbitfun/pasted/...`.
  await app.type("composer", "Analyze these logs");
  await app.press("Send");
  const submitted = backend.calls.find(c => c.action === "submit_user_message")?.request as Record<string, unknown>;
  expect(String(submitted?.text)).toMatch(/^Analyze these logs #file:\.openbitfun\/pasted\/pasted-.*\.txt$/);
});

test("transcript and composer images open click-to-preview Image Lightbox while hiding composer filenames", async () => {
  const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=";
  const backend = createBackend();
  withCommands(backend, {
    get_session_transcript_view: () => ({
      sessionId: "session-1",
      mode: "full",
      hasEarlier: false,
      turns: [
        {
          turnId: "turn-img-1",
          turnIndex: 0,
          kind: "user_dialog",
          status: "done",
          settled: true,
          user: {
            id: "u-img-1",
            text: "Look at this mockup",
            timestampMs: 1763150000000,
            images: [{ name: "mockup.png", dataUrl: TINY_PNG }],
          },
          items: [{ kind: "text", id: "ans-1", roundIndex: 0, text: "Looks great!" }],
          startTimeMs: 1763150000000,
          assistantTimestampMs: 1763150001000,
        },
      ],
    }),
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("user-image-mockup.png");

  // Clicking an image in the conversation transcript opens the lightbox.
  await app.press("user-image-mockup.png");
  await app.waitFor("image-lightbox-dialog");
  await app.press("image-lightbox-close");
  await app.waitFor("image-lightbox-dialog", { state: "gone" });

  // Pasting an image into composer renders a compact square thumbnail WITHOUT filename text
  // and clicking it opens the lightbox too.
  expect(app.shows("Attach")).toBe(false);
  await app.paste("composer", { uris: ["file:///tmp/design-draft.png"] });
  await app.waitFor("attachment-preview-attachment-drop-1");
  expect(app.texts()).not.toContain("design-draft.png");
  await app.press("attachment-preview-attachment-drop-1");
  await app.waitFor("image-lightbox-dialog");
  await app.press("image-lightbox-close");
  await app.waitFor("image-lightbox-dialog", { state: "gone" });
});

test("slash menu includes /goal, /btw, /review, /usage and searchable Skills inserting [$SkillName]", async () => {
  const backend = createBackend();
  const sent = withCommands(backend, {
    get_mode_skill_configs: () => [
      { key: "code-review", name: "code-review", description: "Audit diffs for correctness", enabled: true },
      { key: "release-notes", name: "release-notes", description: "Draft changelog notes", enabled: true },
      { key: "disabled-skill", name: "disabled-skill", description: "Hidden when disabled", enabled: false },
    ],
    get_session_usage_report: () => ({
      summary: { total_input_tokens: 1200, total_output_tokens: 450, total_tokens: 1650 },
    }),
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Message");

  // Typing `/` loads slash skills lazily and lists built-in commands + enabled skills (excluding disabled skills).
  await app.type("composer", "/");
  await app.waitUntil(() => (sent.get_mode_skill_configs ?? []).length > 0);
  await app.waitFor("slash-command-goal");
  await app.waitFor("slash-skill-code-review");
  expect(app.shows("slash-command-btw")).toBe(true);
  expect(app.shows("slash-command-review")).toBe(true);
  expect(app.shows("slash-command-usage")).toBe(true);
  expect(app.shows("slash-skill-disabled-skill")).toBe(false);

  // Filtering by skill name narrows and inserts `[$code-review] ` into the composer.
  await app.clear("composer");
  await app.type("composer", "/code-rev");
  await app.waitFor("slash-skill-code-review");
  await app.press("slash-skill-code-review");
  expect(app.value("composer")).toBe("[$code-review] ");

  // Running `/usage` calls `get_session_usage_report` with snake_case keys and surfaces totals.
  await app.clear("composer");
  await app.type("composer", "/usage");
  await app.press("Send");
  await app.waitUntil(() => (sent.get_session_usage_report ?? []).length === 1);
  expect(sent.get_session_usage_report?.[0]).toMatchObject({
    session_id: "session-1",
    workspace_id: "workspace-1",
    workspace_path: "/repo",
  });
  expect(backend.actions()).not.toContain("submit_user_message");
});

test("@ mention immediately lists workspace files & folders, drills into folders, searches, and attaches chips", async () => {
  const backend = createBackend();
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  const browseCalls: Array<Record<string, unknown>> = [];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action === "explorer_get_children") {
      const req = (args.request ?? {}) as Record<string, unknown>;
      browseCalls.push(req);
      if (req.path === "/repo/docs") {
        return {
          ok: true,
          value: [
            { path: "/repo/docs/guide.md", name: "guide.md", isDirectory: false },
          ],
          transport: "dev",
        };
      }
      return {
        ok: true,
        value: [
          { path: "/repo/node_modules", name: "node_modules", isDirectory: true },
          { path: "/repo/.git", name: ".git", isDirectory: true },
          { path: "/repo/docs", name: "docs", isDirectory: true },
          { path: "/repo/README.md", name: "README.md", isDirectory: false },
          { path: "/repo/main.rs", name: "main.rs", isDirectory: false },
        ],
        transport: "dev",
      };
    }
    return baseInvoke(data);
  };

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("Message");

  // Bare `@` immediately browses workspace root via `explorer_get_children` and hides noisy dirs.
  await app.type("composer", "Check @");
  await app.waitFor("mention-option-docs");
  expect(app.shows("mention-option-README.md")).toBe(true);
  expect(app.shows("mention-browse-docs")).toBe(true);
  expect(app.shows("mention-option-node_modules")).toBe(false);
  expect(app.shows("mention-option-.git")).toBe(false);

  // Drill into `docs/` folder, see `guide.md`, then navigate back up.
  await app.press("mention-browse-docs");
  await app.waitFor("mention-option-guide.md");
  await app.press("mention-browse-up");
  await app.waitFor("mention-option-README.md");

  // Selecting a folder removes `@` and attaches a styled folder chip (`#dir:docs`).
  await app.press("mention-option-docs");
  await app.waitFor("file-attachment-docs");
  expect(app.value("composer")).toBe("Check ");
  await app.press("Send");
  const submitted = backend.calls.find(c => c.action === "submit_user_message")?.request as Record<string, unknown>;
  expect(submitted?.text).toBe("Check #dir:docs");
});

test("split view keeps TurnJumpRail in both Primary and Secondary panes with unified composer parity", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("turn-jump-rail");

  // Open dual-session split: BOTH Primary and Secondary panes keep TurnJumpRail and share unified controls.
  await app.press("thread-actions-trigger");
  await app.press("session-split-open");
  await app.waitFor("id:secondary-session-pane");
  await app.waitFor("secondary-turn-jump-rail");
  expect(app.shows("turn-jump-rail")).toBe(true);
  expect(app.shows("secondary-turn-jump-rail")).toBe(true);
  expect(app.shows("id:secondary-session-header")).toBe(true);
  expect(app.shows("secondary-composer-plus")).toBe(true);
  expect(app.shows("secondary-agent-picker")).toBe(true);
  expect(app.shows("secondary-bot-capsule-trigger")).toBe(true);
  expect(app.shows("secondary-send-turn")).toBe(true);

  // Closing split view leaves Primary TurnJumpRail intact.
  await app.press("session-pane-close-1");
  await app.waitFor("id:secondary-session-pane", { state: "gone" });
  expect(app.shows("turn-jump-rail")).toBe(true);
});

test("/btw opens unified right-side ephemeral split pane with workspace context, multi-turn, and TurnJumpRail", async () => {
  const backend = createBackend();
  const btwRequests: Array<Record<string, unknown>> = [];
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action === "btw_ask_stream") {
      btwRequests.push(args.request ?? {});
      return { ok: true, value: { ok: true }, transport: "dev" };
    }
    if (args.action === "btw_cancel") {
      return { ok: true, value: { ok: true }, transport: "dev" };
    }
    return baseInvoke(data);
  };

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSession(app, "NSH skeleton");
  await app.waitFor("turn-jump-rail");

  // Trigger /btw with a question -> opens unified side-by-side split pane (NOT a modal),
  // keeps Primary TurnJumpRail visible, and dispatches `btw_ask_stream` with workspace context.
  await app.type("composer", "/btw What does this session do?");
  await app.press("Send");
  await app.waitFor("id:side-question-pane");
  expect(app.shows("turn-jump-rail")).toBe(true);
  expect(app.shows("id:primary-session-pane")).toBe(true);
  expect(app.shows("side-question-compact-sheet")).toBe(false);

  await app.waitUntil(() => btwRequests.length === 1);
  expect(btwRequests[0]).toMatchObject({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath: "/repo",
    question: "What does this session do?",
  });
  const firstChildId = String(btwRequests[0]?.childSessionId ?? "");
  expect(firstChildId).toMatch(/^btw_session_/);

  // Stream a reply into the ephemeral split pane.
  await app.host.send("openbitfun.event", {
    event: "agentic://text-chunk",
    payload: { sessionId: firstChildId, text: "It ports the session list to NSH." },
  });
  await app.host.send("openbitfun.event", {
    event: "agentic://dialog-turn-completed",
    payload: { sessionId: firstChildId },
  });
  await app.waitFor("It ports the session list to NSH.");

  // Multi-turn follow-up reuses the same ephemeral child session ID and activates BTW's TurnJumpRail.
  await app.type("side-question-input", "Any blockers?");
  await app.press("side-question-ask");
  await app.waitUntil(() => btwRequests.length === 2);
  expect(btwRequests[1]?.childSessionId).toBe(firstChildId);
  await app.waitFor("btw-turn-jump-rail");

  // Closing the split pane discards ephemeral state cleanly.
  await app.press("side-question-close");
  await app.waitFor("id:side-question-pane", { state: "gone" });
  expect(app.shows("turn-jump-rail")).toBe(true);
});

test("Frameless ImageLightbox and FilesScene image preview share 25% step zoom, percentage, and Copy toolbar", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Message");

  // Paste an image and open frameless lightbox -> shared floating bottom toolbar with 25% steps & Copy.
  await app.paste("composer", { uris: ["file:///tmp/shot.png"] });
  await app.waitFor("attachment-preview-attachment-drop-1");
  await app.press("attachment-preview-attachment-drop-1");
  await app.waitFor("image-lightbox-dialog");
  expect(app.shows("image-viewer-toolbar")).toBe(true);
  expect(app.shows("image-zoom-out")).toBe(true);
  expect(app.shows("image-zoom-in")).toBe(true);
  expect(app.shows("image-zoom-percent")).toBe(true);
  expect(app.shows("image-zoom-actual")).toBe(true);
  expect(app.shows("image-lightbox-copy")).toBe(true);
  expect(app.shows("100%")).toBe(true);

  await app.press("image-zoom-in");
  await app.waitFor("125%");
  expect(app.shows("image-zoom-fit")).toBe(true);

  await app.press("image-zoom-out");
  await app.waitFor("100%");
  await app.press("image-zoom-out");
  await app.waitFor("75%");

  await app.press("image-lightbox-close");
  await app.waitFor("image-lightbox-dialog", { state: "gone" });

  // Open Files inspector -> compact explorer rows & clicking an image renders the exact same shared toolbar.
  await app.press("session-tool-files");
  await app.waitFor("explorer-row-README.md");
  await app.waitFor("explorer-row-logo.png");
  await app.press("explorer-row-logo.png");
  await app.waitFor("image-viewer-toolbar");
  expect(app.shows("image-zoom-in")).toBe(true);
  expect(app.shows("image-zoom-out")).toBe(true);
  expect(app.shows("image-zoom-percent")).toBe(true);
  expect(app.shows("image-lightbox-copy")).toBe(true);
  await app.press("image-zoom-in");
  await app.waitFor("125%");
});

test("split pane focus switches on clicking anywhere in either pane, and bottom-docked AuxPane uses wide side-by-side Files layout", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openSession(app, "NSH skeleton");
  await app.waitFor("Port the session list.");

  // Open split view: Pane 1 starts focused with its top highlight bar active.
  await app.press("thread-actions-trigger");
  await app.press("session-split-open");
  await app.waitFor("id:secondary-session-pane");
  await app.waitFor("id:secondary-pane-active-bar");
  expect(app.shows("id:primary-pane-active-bar")).toBe(false);

  // Clicking Pane 0's header switches the top highlight bar immediately.
  await app.press("primary-pane-focus");
  await app.waitFor("id:primary-pane-active-bar");
  expect(app.shows("id:secondary-pane-active-bar")).toBe(false);

  // Clicking Pane 1's transcript content switches the top highlight bar back to Pane 1.
  await app.press("Port the terminal.");
  await app.waitFor("id:secondary-pane-active-bar");
  expect(app.shows("id:primary-pane-active-bar")).toBe(false);

  // Clicking Pane 0's transcript content switches the top highlight bar back to Pane 0.
  await app.press("Port the session list.");
  await app.waitFor("id:primary-pane-active-bar");
  expect(app.shows("id:secondary-pane-active-bar")).toBe(false);

  // Close split pane, open Files in right AuxPane -> narrow stacked mode (< 600px), then dock to bottom -> wide side-by-side.
  await app.press("session-pane-close-1");
  await app.waitFor("id:secondary-session-pane", { state: "gone" });
  await app.press("session-tool-files");
  await app.waitFor("explorer-row-README.md");
  await app.press("explorer-row-README.md");
  await app.waitFor("files-stack-back");

  // Dock AuxPane to bottom: width >= 600px switches Files automatically to side-by-side explorer | preview!
  await app.press("aux-dock-toggle");
  await app.waitFor("Resize explorer pane");
  expect(app.shows("files-stack-back")).toBe(false);
  expect(app.shows("explorer-row-README.md")).toBe(true);
});

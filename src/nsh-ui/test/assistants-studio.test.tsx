import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

type Recorded = { action: string; payload: Record<string, unknown>; raw: boolean };

const SEEDED_IDENTITY =
  "---\nname: Muse\ncreature: Fox\nvibe: Calm\navatar: joystick-ink-mint\nemoji: \"🦊\"\nmood: bright\n---\n\n# Who I am\n\nSeeded persona body.\n";

/**
 * The host's `set_assistant_identity` as far as these tests need it: each given
 * field's frontmatter line is replaced (or appended), everything else stays.
 * The real rewrite (quoting, multi-line values, missing frontmatter) is the
 * backend's and is covered by its Rust tests.
 */
function applyIdentityPatch(content: string, patch: Record<string, unknown>): string {
  let next = content;
  for (const field of ["name", "creature", "vibe", "avatar", "emoji"]) {
    const value = patch[field];
    if (typeof value !== "string") continue;
    const line = value ? `${field}: ${value}` : `${field}:`;
    const pattern = new RegExp(`^${field}:.*$`, "m");
    next = pattern.test(next) ? next.replace(pattern, line) : next.replace(/\n---\n/, `\n${line}\n---\n`);
  }
  return next;
}

/** An assistant host with one primary assistant, its IDENTITY.md and two sessions. */
function assistantHost() {
  const base = createBackend();
  const originalInvoke = base.handlers["openbitfun.invoke"];
  const recorded: Recorded[] = [];
  const files: Record<string, string> = {
    "/tmp/assistants/asst-1/IDENTITY.md": SEEDED_IDENTITY,
  };
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
    const action = args.action ?? "";
    const raw = Object.prototype.hasOwnProperty.call(args, "raw");
    const payload = ((raw ? args.raw : args.request) ?? {}) as Record<string, unknown>;
    recorded.push({ action, payload, raw });
    const reply = (value: unknown) => ({ ok: true, value, transport: "dev" });
    if (action === "get_assistant_workspaces") {
      return reply([
        {
          id: "asst-1",
          name: "Muse",
          rootPath: "/tmp/assistants/asst-1",
          workspaceKind: "assistant",
          identity: { name: "Muse", vibe: "Calm", creature: "Fox", avatar: "joystick-ink-mint", emoji: "🦊" },
        },
        {
          id: "asst-2",
          name: "Scout",
          rootPath: "/tmp/assistants/asst-2",
          workspaceKind: "assistant",
          identity: { name: "Scout", emoji: "🔎" },
        },
      ]);
    }
    if (action === "get_primary_assistant_workspace") return reply({ id: "asst-1" });
    if (action === "read_file_content") {
      const filePath = String(payload.filePath ?? "");
      if (filePath in files) return reply(files[filePath]);
      return { ok: false, error: `File does not exist: ${filePath}`, transport: "dev" };
    }
    if (action === "write_file_content") {
      files[String(payload.filePath ?? "")] = String(payload.content ?? "");
      return reply(null);
    }
    if (action === "set_assistant_identity") {
      const path = `/tmp/assistants/${String(payload.workspaceId ?? "")}/IDENTITY.md`;
      const content = applyIdentityPatch(files[path] ?? "", payload);
      files[path] = content;
      return reply({ workspace: { id: payload.workspaceId }, content });
    }
    if (action === "list_persisted_sessions_page" && payload.workspace_id === "asst-1") {
      return reply({
        sessions: [
          { sessionId: "asst-s-1", sessionName: "Morning plan", lastActiveAt: Date.now() - 60_000, messageCount: 4 },
          { sessionId: "asst-s-2", sessionName: "Trip notes", lastActiveAt: Date.now() - 3_600_000, messageCount: 2 },
        ],
        totalTopLevelCount: 2,
        hasMore: false,
      });
    }
    if (action === "load_session_turns" && payload.workspace_id === "asst-1") return reply([]);
    if (action === "set_active_workspace") return reply(null);
    return originalInvoke(data);
  };
  return { backend: base, recorded, files };
}

test("the assistants list puts the primary assistant first and offers delete only for the others", async () => {
  const { backend } = assistantHost();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.waitFor("assistant-card-asst-1");

  expect(app.texts()).toContain("Calm · Fox");
  // An assistant without a vibe says so, as the desktop's card does.
  expect(app.texts()).toContain("An assistant waiting to be defined");
  // With fewer than three assistants the list offers a create row.
  expect(app.shows("assistants-create-card")).toBe(true);
  await app.press("assistants-create-card");
  await app.waitFor("new-assistant-modal");
  await app.press("modal-close");
  await app.waitFor("new-assistant-modal", { state: "gone" });

  // The primary assistant cannot be deleted; the other one can.
  await app.press("assistant-actions-asst-1");
  await app.waitFor("assistant-delete-asst-1");
  expect(app.enabled("assistant-delete-asst-1")).toBe(false);
  await app.keyboard.press("escape");
  await app.waitFor("assistant-delete-asst-1", { state: "gone" });

  await app.press("assistant-card-asst-2");
  await app.waitFor("assistant-actions-asst-2");
  await app.press("assistant-actions-asst-2");
  await app.waitFor("assistant-delete-asst-2");
  expect(app.enabled("assistant-delete-asst-2")).toBe(true);
  await app.keyboard.press("escape");
  await app.waitFor("assistant-delete-asst-2", { state: "gone" });
});

test("the primary assistant leads the list even when the host lists it last", async () => {
  const { backend } = assistantHost();
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string };
    if (args.action === "get_primary_assistant_workspace") return { ok: true, value: { id: "asst-2" }, transport: "dev" };
    return invoke(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.waitFor("assistant-primary-dot-asst-2");
  const texts = app.texts();
  expect(texts.indexOf("Scout")).toBeLessThan(texts.indexOf("Calm · Fox"));
});

test("the assistant page edits the name in place and the avatar from the picker", async () => {
  const { backend, recorded, files } = assistantHost();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.press("assistant-card-asst-1");
  await app.waitFor("assistant-name-edit");

  // Return saves the typed name into IDENTITY.md and nothing else changes.
  await app.press("assistant-name-edit");
  await app.waitFor("assistant-name-input");
  await app.clear("assistant-name-input");
  await app.type("assistant-name-input", "Muse Prime");
  await app.submit("assistant-name-input");
  await app.waitUntil(() => files["/tmp/assistants/asst-1/IDENTITY.md"]!.includes("name: Muse Prime"));
  expect(files["/tmp/assistants/asst-1/IDENTITY.md"]).toBe(
    SEEDED_IDENTITY.replace("name: Muse\n", "name: Muse Prime\n"),
  );
  await app.waitFor("Muse Prime");
  // The host rewrites the document; this surface sends only the changed field.
  const write = recorded.find(item => item.action === "set_assistant_identity");
  expect(write?.raw).toBe(false);
  expect(write?.payload).toEqual({ workspaceId: "asst-1", name: "Muse Prime" });
  expect(recorded.some(item => item.action === "write_file_content")).toBe(false);

  // Pressing the name again and leaving it unchanged writes nothing.
  const writesBefore = recorded.filter(item => item.action === "set_assistant_identity").length;
  await app.press("assistant-name-edit");
  await app.submit("assistant-name-input");
  await app.waitFor("assistant-name-edit");
  expect(recorded.filter(item => item.action === "set_assistant_identity").length).toBe(writesBefore);


  // An emoji clears the artwork preset so the emoji is what shows.
  await app.press("assistant-avatar-change");
  await app.waitFor("assistant-avatar-picker");
  expect(app.shows("Choose an avatar")).toBe(true);
  await app.press("assistant-avatar-emoji-0");
  await app.waitUntil(() => files["/tmp/assistants/asst-1/IDENTITY.md"]!.includes('emoji: 🧭'));
  expect(recorded.filter(item => item.action === "set_assistant_identity").pop()?.payload).toEqual({
    workspaceId: "asst-1",
    avatar: "",
    emoji: "🧭",
  });
  const afterEmoji = files["/tmp/assistants/asst-1/IDENTITY.md"]!;
  expect(afterEmoji).toContain("\navatar:\n");
  expect(afterEmoji).toContain("mood: bright");
  expect(afterEmoji).toContain("# Who I am\n\nSeeded persona body.");
  await app.waitFor("assistant-avatar-picker", { state: "gone" });

  // A custom symbol keeps its first character only.
  await app.press("assistant-avatar-change");
  await app.clear("assistant-avatar-custom");
  await app.type("assistant-avatar-custom", "🐙🐙");
  await app.press("assistant-avatar-custom-apply");
  await app.waitUntil(() => files["/tmp/assistants/asst-1/IDENTITY.md"]!.includes("emoji: 🐙\n"));

  // The official artwork sets the preset id and keeps the emoji.
  await app.press("assistant-avatar-change");
  await app.press("assistant-avatar-preset-joystick-ink-mint");
  await app.waitUntil(() => files["/tmp/assistants/asst-1/IDENTITY.md"]!.includes("avatar: joystick-ink-mint"));
  expect(files["/tmp/assistants/asst-1/IDENTITY.md"]).toContain("emoji: 🐙\n");
});

test("a failed identity write says so and the next read restores the host's value", async () => {
  const { backend, recorded } = assistantHost();
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string };
    if (args.action === "set_assistant_identity") return { ok: false, error: "Permission denied", transport: "dev" };
    return invoke(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.press("assistant-card-asst-1");
  await app.press("assistant-name-edit");
  await app.clear("assistant-name-input");
  await app.type("assistant-name-input", "Nope");
  await app.submit("assistant-name-input");
  await app.waitFor("Could not save Permission denied. Check file or system access permissions.");
  // The page re-read the host's list, so the stored name is back.
  await app.waitFor("assistant-name-edit");
  await app.waitUntil(() => recorded.filter(item => item.action === "get_assistant_workspaces").length >= 2);
  await app.waitFor("Muse");
});

test("the assistant page lists the assistant's own sessions and opens one in Sessions", async () => {
  const { backend, recorded } = assistantHost();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.press("assistant-card-asst-1");
  await app.press("assistant-tab-sessions");
  await app.waitFor("Morning plan");
  expect(app.shows("Trip notes")).toBe(true);
  const list = recorded.find(
    item => item.action === "list_persisted_sessions_page" && item.payload.workspace_id === "asst-1",
  );
  expect(list?.raw).toBe(false);
  expect(list?.payload).toMatchObject({ workspace_id: "asst-1", limit: 30 });

  await app.press("assistant-session-asst-s-2");
  await app.waitUntil(() =>
    recorded.some(item => item.action === "get_session_transcript_view" && item.payload.session_id === "asst-s-2"),
  );
  expect(recorded.some(item => item.action === "set_active_workspace" && item.payload.workspaceId === "asst-1")).toBe(
    true,
  );
});

test("an assistant without sessions says so, and a refused list says why", async () => {
  const { backend } = assistantHost();
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: { workspace_id?: string } };
    if (args.action === "list_persisted_sessions_page" && args.request?.workspace_id === "asst-2") {
      return { ok: false, error: "Workspace is not open", transport: "dev" };
    }
    return invoke(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.press("assistant-card-asst-2");
  await app.press("assistant-tab-sessions");
  await app.waitFor("Could not load sessions: Workspace is not open");
});

test("home shows the desktop personal overview's five usage metrics", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Home");
  await app.waitFor("Total Tokens");
  for (const label of ["Total Tokens", "Peak Daily Tokens", "Requests (30d)", "Longest Streak", "Current Streak"]) {
    expect(app.shows(label)).toBe(true);
  }
});

test("an older host without set_assistant_identity asks for an update instead of editing the file here", async () => {
  const { backend, recorded } = assistantHost();
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string };
    if (args.action === "set_assistant_identity") {
      return { ok: false, error: "Command not found: set_assistant_identity", transport: "dev" };
    }
    return invoke(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.press("assistant-card-asst-1");
  await app.press("assistant-name-edit");
  await app.clear("assistant-name-input");
  await app.type("assistant-name-input", "Muse Prime");
  await app.submit("assistant-name-input");
  await app.waitUntil(() =>
    app.texts().some(text => text.includes("This host cannot change an assistant's identity from here.")),
  );
  expect(recorded.some(item => item.action === "write_file_content")).toBe(false);
});

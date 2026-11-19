import { expect, open, test } from "nsh/test";
import { createBackend, createDeviceBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface HandlerOverrideContext {
  baseInvoke: (data: unknown) => unknown;
}

function wrapBackend(
  base: ReturnType<typeof createBackend>,
  override: (
    action: string,
    payload: Record<string, unknown>,
    raw: boolean,
    ctx: HandlerOverrideContext,
  ) => unknown | undefined,
) {
  const originalInvoke = base.handlers["openbitfun.invoke"];
  const recorded: Array<{ action: string; payload: Record<string, unknown>; raw: boolean }> = [];
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
    const action = args.action ?? "";
    const isRaw = Object.prototype.hasOwnProperty.call(args, "raw");
    const payload = ((isRaw ? args.raw : args.request) ?? {}) as Record<string, unknown>;
    recorded.push({ action, payload, raw: isRaw });
    try {
      const handled = override(action, payload, isRaw, {
        baseInvoke: originalInvoke,
      });
      if (handled !== undefined) {
        return handled;
      }
      return originalInvoke(data);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  return { backend: base, recorded };
}

test("home displays ecosystem counts, 5-metric bar, 6-month heatmap, spaces, ssh shortcuts, starters, and launches quick prompt", async () => {
  const base = createBackend();
  const dueSoonAt = Date.now() + 2 * 60 * 60 * 1000;
  const { recorded } = wrapBackend(base, (action, payload, isRaw) => {
    if (action === "account_status") {
      expect(isRaw).toBe(true);
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_github_info") {
      expect(isRaw).toBe(true);
      return { ok: true, value: null, transport: "dev" };
    }
    if (action === "get_latest_insights") {
      expect(isRaw).toBe(true);
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "get_assistant_workspaces") {
      expect(isRaw).toBe(true);
      return {
        ok: true,
        value: [
          { id: "asst-1", name: "Muse", rootPath: "/tmp/assistants/asst-1" },
          { id: "asst-2", name: "Scout", rootPath: "/tmp/assistants/asst-2" },
        ],
        transport: "dev",
      };
    }
    if (action === "list_subagents") {
      expect(isRaw).toBe(false);
      return {
        ok: true,
        value: [
          { id: "researcher", name: "Researcher", subagentSource: "user" },
        ],
        transport: "dev",
      };
    }
    if (action === "get_skill_configs") {
      expect(isRaw).toBe(true);
      expect(payload).toEqual({
        forceRefresh: false,
        includeDiagnostics: false,
        workspaceId: null,
        workspacePath: null,
      });
      return {
        ok: true,
        value: [
          { key: "skill-a", name: "Skill A", enabled: true },
          { key: "skill-b", name: "Skill B", enabled: true },
          { key: "skill-c", name: "Skill C", enabled: false },
        ],
        transport: "dev",
      };
    }
    if (action === "list_cron_jobs") {
      expect(isRaw).toBe(false);
      return {
        ok: true,
        value: [
          {
            id: "cron-due",
            name: "Morning Digest",
            enabled: true,
            schedule: { kind: "every", everyMs: 3600_000 },
            state: { nextRunAtMs: dueSoonAt, lastRunStatus: "ok" },
          },
          {
            id: "cron-paused",
            name: "Weekly Cleanup",
            enabled: false,
            schedule: { kind: "cron", expr: "0 2 * * 0" },
            state: {},
          },
        ],
        transport: "dev",
      };
    }
    if (action === "list_miniapps") {
      expect(isRaw).toBe(true);
      return {
        ok: true,
        value: [{ id: "space-focus", name: "Focus Board", description: "Daily sprint tracker" }],
        transport: "dev",
      };
    }
    if (action === "miniapp_worker_list_running") {
      expect(isRaw).toBe(true);
      return { ok: true, value: ["space-focus"], transport: "dev" };
    }
    if (action === "ssh_list_saved_connections") {
      expect(isRaw).toBe(true);
      return {
        ok: true,
        value: [
          {
            id: "ssh-build",
            name: "Build Linux",
            host: "10.0.0.8",
            port: 22,
            username: "dev",
            authType: { type: "Agent" },
          },
        ],
        transport: "dev",
      };
    }
    if (action === "ssh_list_config_hosts") {
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "ssh_list_wsl_distributions") {
      return { ok: true, value: { supported: false, distributions: [] }, transport: "dev" };
    }
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");

  await app.press("Home");
  await app.waitFor("Personal Agent Studio");
  await app.waitFor("Morning Digest");
  await app.waitFor("Build Linux");
  await app.waitFor("Focus Board");

  const texts = app.texts();
  expect(texts).toContain("Personal Assistants");
  expect(texts).toContain("Agent Team");
  expect(texts).toContain("8");
  expect(texts).toContain("Skills");
  expect(texts).toContain("Routines");
  expect(texts).toContain("Spaces");
  expect(texts).toContain("2 enabled");
  expect(texts).toContain("1 active schedules");
  expect(texts).toContain("1 running");
  expect(texts).toContain("Total Tokens");
  expect(texts).toContain("Peak Daily Tokens");
  expect(texts).toContain("Requests (30d)");
  expect(texts).toContain("Longest Streak");
  expect(texts).toContain("Current Streak");
  expect(texts).toContain("6-Month Activity");
  expect(texts).toContain("120K");
  expect(texts).toContain("42");
  expect(texts).toContain("run_command");

  const usageCall = recorded.find(
    c => c.action === "get_token_usage_statistics" && c.payload.timeRange === "last30Days",
  );
  expect(usageCall).toBeDefined();
  expect(usageCall?.raw).toBe(false);
  expect(usageCall?.payload.granularity).toBe("day");
  expect(
    recorded.some(c => c.action === "get_token_usage_statistics" && c.payload.timeRange === "custom"),
  ).toBe(true);

  // Home Workspace & SSH shortcuts open the real Tauri workspace / SSH modals.
  await app.press("home-new-workspace");
  await app.waitFor("new-workspace-modal");
  await app.press("modal-close");
  await app.waitFor("new-workspace-modal", { state: "gone" });

  await app.press("home-connect-ssh");
  await app.waitFor("ssh-connection-modal");
  await app.press("modal-close");
  await app.waitFor("ssh-connection-modal", { state: "gone" });

  // Starter SelectDropdown populates quick prompt input, then user edits and asks.
  await app.press("home-starter-select");
  await app.waitFor("home-starter-changes");
  await app.press("home-starter-changes");
  expect(app.value("home-quick-prompt")).toBe(
    "Summarize the recent changes and open tasks in this workspace.",
  );

  await app.clear("home-quick-prompt");
  await app.type("home-quick-prompt", "Summarize recent commits");
  await app.press("home-quick-ask");
  await app.waitUntil(() => recorded.some(c => c.action === "submit_user_message"));

  const turnCall = recorded.find(c => c.action === "submit_user_message");
  expect(turnCall?.payload).toMatchObject({
    sessionId: "session-1",
    text: "Summarize recent commits",
    workspaceId: "workspace-1",
  });
});

test("home github auth runs device flow in modal with openUrl, poll status, and sign out", async () => {
  const base = createBackend();
  let pollStep = 0;
  let signedIn = false;

  const { recorded } = wrapBackend(base, (action, payload, isRaw) => {
    if (action === "account_status") {
      return {
        ok: true,
        value: signedIn
          ? { logged_in: true, user_id: "user-42" }
          : { logged_in: false, user_id: null },
        transport: "dev",
      };
    }
    if (action === "account_github_info") {
      return {
        ok: true,
        value: signedIn
          ? {
              user: { githubId: 42, login: "octocat", avatarUrl: "" },
              email: "octocat@example.com",
              isAdmin: false,
            }
          : null,
        transport: "dev",
      };
    }
    if (action === "account_github_start") {
      expect(isRaw).toBe(true);
      return {
        ok: true,
        value: {
          userCode: "WXYZ-5678",
          verificationUri: "https://github.com/login/device",
          deviceCode: "device-code-99",
          interval: 5,
        },
        transport: "dev",
      };
    }
    if (action === "account_github_poll") {
      expect(isRaw).toBe(false);
      expect(payload).toMatchObject({ deviceCode: "device-code-99" });
      pollStep += 1;
      if (pollStep === 1) {
        return { ok: true, value: { status: "pending" }, transport: "dev" };
      }
      signedIn = true;
      return { ok: true, value: { status: "authorized" }, transport: "dev" };
    }
    if (action === "account_logout") {
      expect(isRaw).toBe(true);
      signedIn = false;
      return { ok: true, value: null, transport: "dev" };
    }
    if (
      action === "get_latest_insights" ||
      action === "get_assistant_workspaces" ||
      action === "list_cron_jobs" ||
      action === "list_miniapps" ||
      action === "miniapp_worker_list_running" ||
      action === "ssh_list_saved_connections"
    ) {
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "get_skill_configs") {
      return { ok: true, value: [], transport: "dev" };
    }
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");

  await app.press("Home");
  await app.waitFor("home-github-sign-in");
  await app.press("home-github-sign-in");

  // Opens GitHub Device Auth ModalDialog.
  await app.waitFor("WXYZ-5678");
  expect(app.openedUrls()).toContain("https://github.com/login/device");

  // First poll stays pending inside modal.
  await app.press("home-github-poll");
  await app.waitFor("Authorization is pending. Finish confirming in GitHub, then poll again.");

  // Second poll authorizes, closes modal, and loads GitHub profile.
  await app.press("home-github-poll");
  await app.waitFor("Welcome back, octocat");
  expect(app.texts()).toContain("@octocat");

  // Sign out lives in the quiet account menu and returns to unauthenticated state.
  await app.press("home-account-menu");
  await app.waitFor("home-github-sign-out");
  await app.press("home-github-sign-out");
  await app.waitFor("home-github-sign-in");
  expect(recorded.some(c => c.action === "account_logout" && c.raw)).toBe(true);
});

test("home insights studio lists reports, opens markdown reader modal, and generates 30-day insights", async () => {
  const base = createBackend();
  let generationAttempt = 0;

  const { recorded } = wrapBackend(base, (action, payload, isRaw) => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_github_info") {
      return { ok: true, value: null, transport: "dev" };
    }
    if (action === "get_latest_insights") {
      expect(isRaw).toBe(true);
      return {
        ok: true,
        value: [
          {
            path: "/insights/report-nov.json",
            generated_at: 1763000000,
            total_sessions: 14,
            analyzed_sessions: 12,
            total_messages: 180,
            days_covered: 30,
            date_range: { start: "2026-10-19", end: "2026-11-18" },
          },
        ],
        transport: "dev",
      };
    }
    if (action === "load_insights_report") {
      expect(isRaw).toBe(false);
      expect(payload).toEqual({ path: "/insights/report-nov.json" });
      return {
        ok: true,
        value: {
          generated_at: 1763000000,
          days_covered: 30,
          total_sessions: 14,
          analyzed_sessions: 12,
          total_messages: 180,
          date_range: { start: "2026-10-19", end: "2026-11-18" },
          at_a_glance: {
            whats_working: "Fast iteration across NSH scenes.",
            whats_hindering: "Occasional stale test mocks.",
            quick_wins: "Reuse studio primitives.",
            looking_ahead: "Automate routine health checks.",
          },
          big_wins: [
            { title: "Unified Tokens", description: "Consistent dark/light palette.", impact: "High" },
          ],
        },
        transport: "dev",
      };
    }
    if (action === "generate_insights") {
      expect(isRaw).toBe(false);
      expect(payload).toMatchObject({ days: 30 });
      generationAttempt += 1;
      if (generationAttempt === 1) {
        return { ok: false, error: "No chat model configured for insights" };
      }
      return {
        ok: true,
        value: {
          path: "/insights/report-new.json",
          days_covered: 30,
          markdown: "# Fresh 30-Day Synthesis\n\nVelocity improved across **14 sessions**.",
        },
        transport: "dev",
      };
    }
    if (
      action === "get_assistant_workspaces" ||
      action === "list_cron_jobs" ||
      action === "list_miniapps" ||
      action === "miniapp_worker_list_running" ||
      action === "ssh_list_saved_connections"
    ) {
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "get_skill_configs") {
      return { ok: true, value: [], transport: "dev" };
    }
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");

  await app.press("Home");
  await app.waitFor("30-Day Insights");

  // Load existing report from list -> opens full Markdown ModalDialog reader.
  await app.press("home-insight-report-0");
  await app.waitFor("At a Glance");
  const loadedText = app.texts().join("\n");
  expect(loadedText).toContain("Fast iteration across NSH scenes.");
  expect(loadedText).toContain("Unified Tokens");

  // Close Markdown modal before triggering generation on the Home surface.
  await app.press("modal-close");
  await app.waitFor("At a Glance", { state: "gone" });

  // Failed generation surfaces error loudly without losing report list.
  await app.press("home-generate-insights");
  await app.waitFor("No chat model configured for insights");

  // Generate again and verify fresh Markdown opens cleanly in reader modal.
  await app.press("home-generate-insights");
  await app.waitFor("Fresh 30-Day Synthesis");
  const allText = app.texts().join("\n");
  expect(allText).toContain("Velocity improved across");
  expect(allText).not.toContain("# Fresh 30-Day Synthesis");
  expect(recorded.filter(c => c.action === "generate_insights")).toHaveLength(2);
});

test("home degrades gracefully when one ecosystem pulse command fails", async () => {
  const base = createBackend({ usage: null });
  wrapBackend(base, action => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_github_info") {
      return { ok: true, value: null, transport: "dev" };
    }
    if (action === "get_latest_insights") {
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "get_assistant_workspaces") {
      return { ok: true, value: [{ id: "a1", name: "Muse", rootPath: "/tmp/a1" }], transport: "dev" };
    }
    if (action === "get_skill_configs") {
      return { ok: false, error: "Command not found: get_skill_configs" };
    }
    if (action === "list_cron_jobs") {
      return { ok: true, value: [], transport: "dev" };
    }
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");

  await app.press("Home");
  await app.waitFor("Personal Agent Studio");
  await app.waitFor("This host does not support usage statistics.");

  const texts = app.texts();
  expect(texts).toContain("Unavailable");
  // Agent Team & Assistants still show real counts despite Skills, Spaces & Usage failing.
  expect(texts).toContain("1");
  expect(texts).toContain("7");
});

test("assistants scene supports modal creation, dropdown CRUD, persona studio edit/preview/save/reset, and quick chat", async () => {
  const base = createBackend();
  let assistantList = [
    {
      id: "asst-1",
      name: "Muse",
      rootPath: "/tmp/assistants/asst-1",
      assistantId: "muse",
      workspaceKind: "assistant",
      identity: { name: "Muse", vibe: "Calm & precise" },
    },
  ];
  let primaryId = "asst-1";
  const files: Record<string, string> = {
    "/tmp/assistants/asst-1/IDENTITY.md": "# Muse\n\nPrimary studio assistant.",
    "/tmp/assistants/asst-1/SOUL.md": "# Soul\n\nConcise and helpful.",
    "/tmp/assistants/asst-2/IDENTITY.md": "# Atlas\n\nSecond assistant.",
  };

  const { recorded } = wrapBackend(base, (action, payload, isRaw) => {
    if (action === "get_assistant_workspaces") {
      expect(isRaw).toBe(true);
      return { ok: true, value: assistantList, transport: "dev" };
    }
    if (action === "get_primary_assistant_workspace") {
      expect(isRaw).toBe(false);
      const found = assistantList.find(item => item.id === primaryId) ?? null;
      return { ok: true, value: found, transport: "dev" };
    }
    if (action === "create_assistant_workspace") {
      expect(isRaw).toBe(false);
      const created = {
        id: "asst-2",
        name: "Atlas",
        rootPath: "/tmp/assistants/asst-2",
        assistantId: "atlas",
        workspaceKind: "assistant",
        identity: { name: "Atlas", vibe: "Researcher" },
      };
      assistantList = [...assistantList, created];
      return { ok: true, value: created, transport: "dev" };
    }
    if (action === "set_primary_assistant_workspace") {
      expect(isRaw).toBe(false);
      primaryId = String(payload.workspaceId ?? "");
      return { ok: true, value: assistantList.find(i => i.id === primaryId), transport: "dev" };
    }
    if (action === "reset_assistant_workspace") {
      expect(isRaw).toBe(false);
      const id = String(payload.workspaceId ?? "");
      files[`/tmp/assistants/${id}/IDENTITY.md`] = "# Default Assistant\n\nReset template.";
      return { ok: true, value: assistantList.find(i => i.id === id), transport: "dev" };
    }
    if (action === "delete_assistant_workspace") {
      expect(isRaw).toBe(false);
      const id = String(payload.workspaceId ?? "");
      assistantList = assistantList.filter(i => i.id !== id);
      return { ok: true, value: null, transport: "dev" };
    }
    if (action === "read_file_content") {
      const filePath = String(payload.filePath ?? "");
      if (filePath in files) {
        return { ok: true, value: files[filePath], transport: "dev" };
      }
      return { ok: false, error: `File does not exist: ${filePath}` };
    }
    if (action === "write_file_content") {
      expect(isRaw).toBe(false);
      const filePath = String(payload.filePath ?? "");
      files[filePath] = String(payload.content ?? "");
      return { ok: true, value: null, transport: "dev" };
    }
    if (action === "reset_workspace_persona_files") {
      expect(isRaw).toBe(false);
      const wsPath = String(payload.workspacePath ?? "");
      files[`${wsPath}/IDENTITY.md`] = "# Default Identity\n\nRestored persona.";
      files[`${wsPath}/SOUL.md`] = "# Default Soul\n\nRestored soul.";
      files[`${wsPath}/USER.md`] = "# User Profile\n\nRestored user.";
      return { ok: true, value: null, transport: "dev" };
    }
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");

  // The list sits beside the selected assistant's persona studio.
  await app.press("Assistants");
  await app.waitFor("assistant-card-asst-1");
  expect(app.texts()).toContain("Calm & precise");
  await app.press("assistant-card-asst-1");
  await app.waitFor("/tmp/assistants/asst-1/IDENTITY.md");

  // Primary assistant's Delete item is disabled inside its DropdownMenu.
  await app.press("assistant-actions-asst-1");
  await app.waitFor("assistant-delete-asst-1");
  expect(app.enabled("assistant-delete-asst-1")).toBe(false);
  await app.keyboard.press("escape");
  await app.waitFor("assistant-delete-asst-1", { state: "gone" });

  // The Persona tab edits IDENTITY.md first.
  expect(app.value("persona-editor-input")).toBe("# Muse\n\nPrimary studio assistant.");

  // Edit IDENTITY.md and save with POSIX path.
  await app.clear("persona-editor-input");
  await app.type("persona-editor-input", "# Muse Studio\n\nUpdated **identity** doc.");
  expect(app.value("persona-editor-input")).toBe("# Muse Studio\n\nUpdated **identity** doc.");
  await app.press("persona-save");
  expect(recorded.some(c => c.action === "write_file_content")).toBe(true);
  await app.waitFor("Saved IDENTITY.md");
  expect(files["/tmp/assistants/asst-1/IDENTITY.md"]).toBe(
    "# Muse Studio\n\nUpdated **identity** doc.",
  );

  // Live Markdown preview renders TextView without raw markdown hashes.
  await app.press("persona-preview-toggle");
  await app.waitFor("Muse Studio");
  expect(app.texts().join("\n")).not.toContain("# Muse Studio");
  await app.press("persona-preview-toggle");

  // Switch to SOUL.md, edit and save.
  await app.press("persona-tab-SOUL.md");
  await app.waitFor("/tmp/assistants/asst-1/SOUL.md");
  expect(app.value("persona-editor-input")).toBe("# Soul\n\nConcise and helpful.");
  await app.clear("persona-editor-input");
  await app.type("persona-editor-input", "# Soul v2\n\nDirect and grounded.");
  await app.press("persona-save");
  await app.waitFor("Saved SOUL.md");
  expect(files["/tmp/assistants/asst-1/SOUL.md"]).toBe("# Soul v2\n\nDirect and grounded.");

  // Missing USER.md degrades gracefully to an empty draft.
  await app.press("persona-tab-USER.md");
  await app.waitFor("USER.md does not exist yet — save to create it.");
  expect(app.value("persona-editor-input")).toBe("");

  // Reset persona files via InlineConfirmBar.
  await app.press("persona-reset-files");
  await app.waitFor("Confirm reset files");
  await app.press("Confirm reset files");
  await app.waitFor("Persona files reset to defaults.");
  expect(app.value("persona-editor-input")).toBe("# User Profile\n\nRestored user.");

  // A new assistant is created and its studio opens.
  await app.press("assistants-new");
  await app.waitFor("assistants-create-confirm");
  await app.press("assistants-create-confirm");
  await app.waitFor("assistant-actions-asst-2");

  await app.press("assistant-actions-asst-2");
  await app.waitFor("assistant-set-primary-asst-2");
  await app.press("assistant-set-primary-asst-2");
  await app.waitFor("Updated primary assistant.");

  await app.press("assistant-actions-asst-2");
  await app.waitFor("assistant-delete-asst-2");
  expect(app.enabled("assistant-delete-asst-2")).toBe(false);
  await app.keyboard.press("escape");
  await app.waitFor("assistant-delete-asst-2", { state: "gone" });

  await app.press("assistant-card-asst-1");
  await app.waitFor("assistant-actions-asst-1");

  await app.press("assistant-actions-asst-1");
  await app.waitFor("assistant-reset-asst-1");
  await app.press("assistant-reset-asst-1");
  await app.waitFor("Confirm reset");
  await app.press("Confirm reset");
  await app.waitFor("Assistant workspace reset to defaults.");

  await app.press("assistant-actions-asst-1");
  await app.waitFor("assistant-delete-asst-1");
  expect(app.enabled("assistant-delete-asst-1")).toBe(true);
  await app.press("assistant-delete-asst-1");
  await app.waitFor("Confirm delete");
  await app.press("Confirm delete");
  await app.waitFor("Deleted assistant workspace.");
  expect(app.texts()).not.toContain("Muse");

  // Message remaining assistant ("Atlas") directly from Persona Studio quick bar.
  await app.type("assistant-quick-prompt", "Draft my daily agenda");
  await app.press("assistant-quick-send");
  await app.waitUntil(() => recorded.some(c => c.action === "submit_user_message"));

  const createSessionCall = recorded.find(
    c => c.action === "create_session" && c.payload.workspaceId === "asst-2",
  );
  expect(createSessionCall?.payload).toMatchObject({
    workspaceId: "asst-2",
    workspacePath: "/tmp/assistants/asst-2",
    agentType: "Claw",
  });
  const turnCall = recorded.find(
    c => c.action === "submit_user_message" && c.payload.workspaceId === "asst-2",
  );
  expect(turnCall?.payload).toMatchObject({
    text: "Draft my daily agenda",
    agentType: "Claw",
  });
});

test("home and assistants handle peer device mode boundaries and degrade loudly when peer lacks commands", async () => {
  const base = createDeviceBackend({
    devices: [
      { deviceId: "device-mac", deviceName: "studio", platform: "macos", alias: "Studio" },
      { deviceId: "device-linux", deviceName: "builder", platform: "linux" },
    ],
    onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }],
  });

  const { recorded } = wrapBackend(base, (action, payload, _isRaw, ctx) => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: true, user_id: "local-user" }, transport: "dev" };
    }
    if (action === "account_github_info") {
      return {
        ok: true,
        value: { user: { githubId: 7, login: "local-dev", avatarUrl: "" }, isAdmin: false },
        transport: "dev",
      };
    }
    if (action === "get_latest_insights") {
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "account_device_rpc") {
      const env = JSON.parse(String(payload.commandJson ?? payload.command_json ?? "{}")) as {
        cmd?: string;
        command?: string;
        args?: Record<string, unknown>;
      };
      if (env.command === "list_cron_jobs") {
        return {
          ok: true,
          value: JSON.stringify({
            resp: "host_invoke_result",
            ok: true,
            value: [
              {
                id: "peer-cron-1",
                name: "Peer Sync",
                enabled: true,
                schedule: { kind: "every", everyMs: 60000 },
                state: {},
              },
            ],
          }),
          transport: "dev",
        };
      }
      if (env.command === "get_skill_configs") {
        return {
          ok: true,
          value: JSON.stringify({
            resp: "host_invoke_result",
            ok: false,
            error: "device-linux does not implement get_skill_configs",
          }),
          transport: "dev",
        };
      }
      if (env.command === "get_assistant_workspaces") {
        return {
          ok: true,
          value: JSON.stringify({
            resp: "host_invoke_result",
            ok: false,
            error: "device-linux does not implement get_assistant_workspaces",
          }),
          transport: "dev",
        };
      }
      return ctx.baseInvoke({ action, raw: payload });
    }
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");

  // Enter Peer Device Mode targeting builder.
  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("Use >> nth=0");
  await app.waitFor("Driving builder (desktop): sessions, files, terminals and settings come from that device");

  // Home keeps account & insights on controller while ecosystem reads from Peer.
  await app.press("Home");
  await app.waitFor("Welcome back, local-dev");
  await app.waitFor(
    "Personal account and local AI insights belong to this machine; ecosystem counts and sessions below read from builder.",
  );

  // Peer routed routines (1) and modes (2), while unsupported skills/assistants degrade cleanly.
  expect(app.texts()).toContain("1 active schedules");
  expect(app.texts()).toContain("Unavailable");
  const peerActions = base.peerInvocations.map(item => item.action);
  expect(peerActions).not.toContain("account_status");
  expect(peerActions).not.toContain("account_github_info");
  expect(peerActions).not.toContain("get_latest_insights");
  expect(recorded.some(c => c.action === "account_github_info")).toBe(true);

  // Assistants degrades loudly in Peer mode when peer refuses get_assistant_workspaces.
  await app.press("Assistants");
  await app.waitFor("Peer: builder");
  await app.waitFor("Assistants unavailable");
  expect(app.texts()).toContain("device-linux does not implement get_assistant_workspaces");
});

test("home and assistants repaint when switching between dark and light color schemes", async () => {
  const base = createBackend();
  wrapBackend(base, action => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_github_info") {
      return { ok: true, value: null, transport: "dev" };
    }
    if (
      action === "get_latest_insights" ||
      action === "list_cron_jobs" ||
      action === "list_miniapps" ||
      action === "miniapp_worker_list_running" ||
      action === "ssh_list_saved_connections"
    ) {
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "get_skill_configs") {
      return { ok: true, value: [], transport: "dev" };
    }
    if (action === "get_assistant_workspaces") {
      return {
        ok: true,
        value: [{ id: "asst-1", name: "Muse", rootPath: "/tmp/assistants/asst-1" }],
        transport: "dev",
      };
    }
    if (action === "get_primary_assistant_workspace") {
      return {
        ok: true,
        value: { id: "asst-1", name: "Muse", rootPath: "/tmp/assistants/asst-1" },
        transport: "dev",
      };
    }
    if (action === "read_file_content") {
      return { ok: true, value: "# Muse\n\nLight and dark theme check.", transport: "dev" };
    }
    return undefined;
  });

  const app = await open("../App.tsx", {
    ...DESKTOP,
    colorScheme: "dark",
    host: { handlers: base.handlers },
  });
  await app.waitFor("OpenBitFun");

  await app.press("Home");
  await app.waitFor("Personal Agent Studio");
  const darkHomeHeadingColor = app.spanStyle("Welcome back").color;

  await app.press("Assistants");
  await app.waitFor("assistant-card-asst-1");
  const darkAssistantsRailColor = app.spanStyle("An assistant waiting to be defined").color;
  const darkAssistantsHeadingColor = app.spanStyle("Muse >> nth=1").color;

  await app.press("Settings");
  // Settings opens on General; the scheme lives on the Appearance page.
  await app.press("nav-settings-page-appearance");
  await app.waitFor("appearance-light");
  await app.press("appearance-light");
  await app.waitFor("Showing the light scheme");

  // Settings swaps the navigation panel for its own page list; its Back returns to the app's.
  if (!app.shows("Home")) await app.press("Back");
  await app.press("Home");
  await app.waitFor("Personal Agent Studio");
  expect(app.spanStyle("Welcome back").color).not.toBe(darkHomeHeadingColor);

  await app.press("Assistants");
  await app.waitFor("assistant-card-asst-1");
  expect(app.spanStyle("An assistant waiting to be defined").color).not.toBe(darkAssistantsRailColor);
  expect(app.spanStyle("Muse >> nth=1").color).not.toBe(darkAssistantsHeadingColor);
});

test("creating a named assistant rewrites only the IDENTITY.md frontmatter name and keeps the seeded body", async () => {
  const base = createBackend();
  let assistantList: Array<Record<string, unknown>> = [];
  const seeded =
    "---\nname: Claw\ncreature: Fox\nvibe: Calm\navatar:\nemoji: \"🦊\"\n---\n\n# Who I am\n\nSeeded persona body.\n";
  const files: Record<string, string> = {};

  const { recorded } = wrapBackend(base, action => {
    if (action === "get_assistant_workspaces") {
      return { ok: true, value: assistantList, transport: "dev" };
    }
    if (action === "get_primary_assistant_workspace") {
      return { ok: true, value: null, transport: "dev" };
    }
    if (action === "create_assistant_workspace") {
      const created = {
        id: "asst-9",
        name: "Claw",
        rootPath: "/tmp/assistants/asst-9",
        workspaceKind: "assistant",
      };
      files["/tmp/assistants/asst-9/IDENTITY.md"] = seeded;
      assistantList = [...assistantList, created];
      return { ok: true, value: created, transport: "dev" };
    }
    return undefined;
  });
  const originalInvoke = base.handlers["openbitfun.invoke"];
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action === "read_file_content") {
      const filePath = String(args.request?.filePath ?? "");
      return filePath in files
        ? { ok: true, value: files[filePath], transport: "dev" }
        : { ok: false, error: `File does not exist: ${filePath}` };
    }
    if (args.action === "write_file_content") {
      files[String(args.request?.filePath ?? "")] = String(args.request?.content ?? "");
      return { ok: true, value: null, transport: "dev" };
    }
    return originalInvoke(data);
  };

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.waitFor("assistants-new");
  await app.press("assistants-new");
  await app.waitFor("new-assistant-name-input");
  await app.type("new-assistant-name-input", "Nova: Night Owl");
  await app.press("assistants-create-confirm");
  await app.waitUntil(() =>
    (files["/tmp/assistants/asst-9/IDENTITY.md"] ?? "").includes("Night Owl"),
  );

  expect(files["/tmp/assistants/asst-9/IDENTITY.md"]).toBe(
    "---\nname: \"Nova: Night Owl\"\ncreature: Fox\nvibe: Calm\navatar:\nemoji: \"🦊\"\n---\n\n# Who I am\n\nSeeded persona body.\n",
  );
  // The seeded file is read before it is written; nothing replaces the body.
  const reads = recorded.filter(c => c.action === "create_assistant_workspace");
  expect(reads.length).toBe(1);
});

test("home insights take the day range and model the desktop offers and reveal the HTML report", async () => {
  const base = createBackend();
  const { recorded } = wrapBackend(base, action => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "get_latest_insights") return { ok: true, value: [], transport: "dev" };
    if (action === "generate_insights") {
      return {
        ok: true,
        value: {
          days_covered: 7,
          total_sessions: 3,
          html_report_path: "/insights/report-week.html",
          at_a_glance: { whats_working: "Short loops." },
        },
        transport: "dev",
      };
    }
    if (action === "reveal_in_explorer") return { ok: true, value: null, transport: "dev" };
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Home");
  await app.waitFor("home-generate-insights");
  await app.press("home-insights-days");
  await app.press("home-insights-days-7");
  await app.press("home-insights-model");
  await app.press("home-insights-model-fast");
  await app.press("home-generate-insights");
  await app.waitFor("insights-show-html");
  expect(recorded.find(c => c.action === "generate_insights")?.payload).toEqual({
    days: 7,
    modelId: "fast",
  });
  await app.press("insights-show-html");
  await app.waitUntil(() => recorded.some(c => c.action === "reveal_in_explorer"));
  expect(recorded.find(c => c.action === "reveal_in_explorer")?.payload).toEqual({
    path: "/insights/report-week.html",
  });
});

test("an assistant workspace opens and closes on the host from its studio header", async () => {
  const base = createBackend();
  const { recorded } = wrapBackend(base, action => {
    if (action === "get_assistant_workspaces") {
      return {
        ok: true,
        value: [
          { id: "asst-7", name: "Nova", rootPath: "/tmp/assistants/asst-7", workspaceKind: "assistant", identity: { emoji: "🦉" } },
        ],
        transport: "dev",
      };
    }
    if (action === "get_primary_assistant_workspace") return { ok: true, value: null, transport: "dev" };
    if (action === "read_file_content") return { ok: true, value: "# Nova", transport: "dev" };
    if (action === "set_active_workspace") return { ok: true, value: null, transport: "dev" };
    if (action === "close_workspace") return { ok: true, value: null, transport: "dev" };
    return undefined;
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Assistants");
  await app.waitFor("assistant-open-asst-7");
  // The saved emoji is the avatar, as on the desktop.
  expect(app.texts()).toContain("🦉");
  await app.press("assistant-open-asst-7");
  await app.waitUntil(() => recorded.some(c => c.action === "set_active_workspace"));
  expect(recorded.find(c => c.action === "set_active_workspace")?.payload).toMatchObject({ workspaceId: "asst-7" });
  await app.waitFor("assistant-close-asst-7");
  await app.press("assistant-close-asst-7");
  await app.waitUntil(() => recorded.some(c => c.action === "close_workspace"));
  expect(recorded.find(c => c.action === "close_workspace")?.payload).toMatchObject({ workspaceId: "asst-7" });
});

test("home and assistants switch to the compact single-column layout at phone width", async () => {
  const base = createBackend();
  const { recorded } = wrapBackend(base, action => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_github_info") return { ok: true, value: null, transport: "dev" };
    if (action === "get_latest_insights") return { ok: true, value: [], transport: "dev" };
    if (action === "get_assistant_workspaces") {
      return {
        ok: true,
        value: [
          { id: "asst-1", name: "Muse", rootPath: "/tmp/assistants/asst-1", workspaceKind: "assistant" },
          { id: "asst-2", name: "Scout", rootPath: "/tmp/assistants/asst-2", workspaceKind: "assistant" },
        ],
        transport: "dev",
      };
    }
    if (action === "get_primary_assistant_workspace") {
      return { ok: true, value: { id: "asst-1", name: "Muse", rootPath: "/tmp/assistants/asst-1" }, transport: "dev" };
    }
    if (action === "read_file_content") return { ok: true, value: "# Persona", transport: "dev" };
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("OpenBitFun");
  await app.press("Home");
  await app.waitFor("Personal Agent Studio");
  const desktopTitle = Number(app.spanStyle("Welcome back").fontSize);

  // Phone width: the shell's sidebar is put away and Home reads its own laid-out width.
  await app.setViewport(390, 844);
  // The shell folds its sidebar away at phone width (or overlays it); make sure Home is uncovered.
  if (app.shows("compact-drawer-scrim")) await app.press("compact-drawer-scrim");
  await app.waitUntil(() => Number(app.spanStyle("Welcome back").fontSize) < desktopTitle);
  await app.waitFor("Your studio");
  // Studio rows stay reachable and navigate; the launchpad keeps its one primary action.
  await app.type("home-quick-prompt", "Plan my day");
  expect(app.enabled("home-quick-ask")).toBe(true);
  await app.press("home-new-workspace");
  await app.waitFor("new-workspace-modal");
  await app.press("modal-close");
  await app.waitFor("new-workspace-modal", { state: "gone" });

  // Assistants: the list is the landing; a row opens the persona studio with a back control.
  await app.press("home-card-assistants");
  await app.waitFor("assistant-card-asst-2");
  expect(app.shows("persona-editor-input")).toBe(false);
  await app.press("assistant-card-asst-2");
  await app.waitFor("/tmp/assistants/asst-2/IDENTITY.md");
  expect(app.shows("assistant-card-asst-1")).toBe(false);
  await app.press("assistants-back");
  await app.waitFor("assistant-card-asst-1");
  expect(recorded.some(c => c.action === "get_assistant_workspaces")).toBe(true);
});

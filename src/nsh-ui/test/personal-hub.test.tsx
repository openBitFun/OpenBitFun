import { expect, open, test } from "nsh/test";
import { showDevices, composePersonalOverview, createBackend, createDeviceBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

/** Settings › Account › Activity: the old Home heatmap, totals and insights (visual spec §4.9). */
async function openActivity(app: Awaited<ReturnType<typeof open>>): Promise<void> {
  await app.press("Settings");
  await app.press("nav-settings-page-activity");
  await app.waitFor("activity-insights");
}

/** Assistants is a Library tab (visual spec §4.8): open the Library, then the tab. */
async function openAssistants(app: Awaited<ReturnType<typeof open>>): Promise<void> {
  await app.waitFor("Library");
  if (!app.shows("library-tab-assistants")) await app.press("Library");
  await app.press("library-tab-assistants");
}

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
      // The host composes Home's overview from its own section owners; this fake
      // host composes it from the section commands the test overrides.
      if (action === "get_personal_overview") {
        // A host older than the command refuses it before any section runs.
        const own = originalInvoke(data) as { ok?: boolean };
        if (!own?.ok) return own;
        const self = base.handlers["openbitfun.invoke"];
        const value = composePersonalOverview((command, request, raw) => {
          const reply = self(raw ? { action: command, raw: request } : { action: command, request }) as {
            ok?: boolean;
            value?: unknown;
            error?: string;
          };
          if (!reply?.ok) throw new Error(reply?.error ?? `${command} failed`);
          return reply.value;
        });
        return { ok: true, value, transport: "dev" };
      }
      return originalInvoke(data);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  return { backend: base, recorded };
}

// Sign-in lives on the sidebar account row now (Home is gone).
test("account sign-in runs the host's browser flow in the dialog, polls its status, and signs out", async () => {
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
    if (action === "account_identity") {
      // The backend's projection: a GitHub account shows its login.
      return {
        ok: true,
        value: signedIn
          ? { provider: "github", accountId: "42", displayName: "octocat", initial: "O" }
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
  await app.waitFor("nav-library");

  await app.press("label:account-row");
  await app.press("label:sidebar-account-sign-in");
  // Email is the in-app sign-in; GitHub is the secondary one, in the browser.
  await app.press("label:account-auth-github");

  // The host's browser sign-in shows its code in the dialog and opens the page.
  await app.waitFor("WXYZ-5678");
  expect(app.openedUrls()).toContain("https://github.com/login/device");

  // The first check stays pending; the second authorizes and the account row names the account.
  await app.press("home-github-poll");
  await app.waitUntil(() => recorded.filter(c => c.action === "account_github_poll").length >= 1);
  await app.press("home-github-poll");
  await app.waitFor("text:octocat");

  // Sign out lives in the account menu and returns to the signed-out row.
  await app.press("label:account-row");
  await app.press("label:account-menu-sign-out");
  await app.waitFor("text:Sign in");
  expect(recorded.some(c => c.action === "account_logout" && c.raw)).toBe(true);
});

test("Account › Activity lists insights reports, opens the reader, and generates a 30-day report", async () => {
  const base = createBackend();
  let generationAttempt = 0;

  const { recorded } = wrapBackend(base, (action, payload, isRaw) => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_identity") {
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
  await app.waitFor("nav-library");

  await openActivity(app);
  await app.waitFor("30-Day Insights");

  // Load existing report from list -> opens full Markdown ModalDialog reader.
  await app.press("activity-insight-report-0");
  await app.waitFor("At a Glance");
  const loadedText = app.texts().join("\n");
  expect(loadedText).toContain("Fast iteration across NSH scenes.");
  expect(loadedText).toContain("Unified Tokens");

  // Close the reader before generating from the Activity page.
  await app.press("modal-close");
  await app.waitFor("At a Glance", { state: "gone" });

  // Failed generation surfaces error loudly without losing report list.
  await app.press("activity-generate-insights");
  await app.waitFor("No chat model configured for insights");
  expect(app.shows("activity-insight-report-0")).toBe(true);

  // Generate again and verify fresh Markdown opens cleanly in reader modal.
  await app.press("activity-generate-insights");
  await app.waitFor("Fresh 30-Day Synthesis");
  const allText = app.texts().join("\n");
  expect(allText).toContain("Velocity improved across");
  expect(allText).not.toContain("# Fresh 30-Day Synthesis");
  expect(recorded.filter(c => c.action === "generate_insights")).toHaveLength(2);
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
  await app.waitFor("nav-library");

  // The list sits beside the selected assistant's persona studio.
  await openAssistants(app);
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

  // The Persona tab edits IDENTITY.md first, in the visual editor; the source
  // editor is one press away and stays chosen across the persona documents.
  await app.waitFor("persona-source-toggle");
  await app.press("persona-source-toggle");
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

  // A new assistant is created from the list's primary button and its studio opens.
  await app.press("assistants-back");
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

  await app.press("assistants-back");
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
  await app.waitFor("assistant-delete-confirm-asst-1");
  await app.press("assistant-delete-confirm-asst-1");
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

test("assistants repaint when switching between dark and light color schemes", async () => {
  const base = createBackend();
  wrapBackend(base, action => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_identity") {
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
  await app.waitFor("nav-library");

  await openAssistants(app);
  await app.waitFor("assistant-card-asst-1");
  const darkAssistantsRailColor = app.spanStyle("An assistant waiting to be defined").color;
  // In the Library an open assistant replaces the list.
  await app.press("assistant-card-asst-1");
  await app.waitFor("assistants-back");
  // The studio header's name (the persona document below shows its heading too).
  const darkAssistantsHeadingColor = app.spanStyle("Muse >> nth=0").color;

  await app.press("Settings");
  // Settings opens on General; the scheme lives on the Appearance page.
  await app.press("nav-settings-page-appearance");
  await app.waitFor("appearance-follow-system");
  await app.press("appearance-follow-system");
  await app.waitFor("appearance-swatch-openbitfun-light");
  await app.press("appearance-swatch-openbitfun-light");
  await app.waitFor("Showing the light scheme");

  // Settings swaps the navigation panel for its own page list; its Back returns to the app's.
  if (!app.shows("Library")) await app.press("Back");
  await openAssistants(app);
  await app.waitFor("assistant-card-asst-1");
  expect(app.spanStyle("An assistant waiting to be defined").color).not.toBe(darkAssistantsRailColor);
  await app.press("assistant-card-asst-1");
  await app.waitFor("assistants-back");
  expect(app.spanStyle("Muse >> nth=0").color).not.toBe(darkAssistantsHeadingColor);
});

test("creating a named assistant rewrites only the IDENTITY.md frontmatter name and keeps the seeded body", async () => {
  const base = createBackend();
  let assistantList: Array<Record<string, unknown>> = [];
  const seeded =
    "---\nname: Claw\ncreature: Fox\nvibe: Calm\navatar:\nemoji: \"🦊\"\n---\n\n# Who I am\n\nSeeded persona body.\n";
  const files: Record<string, string> = {};

  const { recorded } = wrapBackend(base, (action, payload) => {
    if (action === "get_assistant_workspaces") {
      return { ok: true, value: assistantList, transport: "dev" };
    }
    if (action === "get_primary_assistant_workspace") {
      return { ok: true, value: null, transport: "dev" };
    }
    if (action === "create_assistant_workspace") {
      // The host names the new assistant itself (wave 4); this fixture stands in
      // for its IDENTITY.md rewrite.
      const name = String(payload.name ?? "");
      const created = {
        id: "asst-9",
        name: name || "Claw",
        rootPath: "/tmp/assistants/asst-9",
        workspaceKind: "assistant",
        identity: { name: name || "Claw" },
      };
      files["/tmp/assistants/asst-9/IDENTITY.md"] = name
        ? seeded.replace("name: Claw\n", `name: ${JSON.stringify(name)}\n`)
        : seeded;
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
  await app.waitFor("nav-library");
  await openAssistants(app);
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
  // The name travels with the create call; this surface no longer rewrites the file.
  const creates = recorded.filter(c => c.action === "create_assistant_workspace");
  expect(creates.length).toBe(1);
  expect(creates[0]?.payload).toMatchObject({ name: "Nova: Night Owl" });
  expect(recorded.some(c => c.action === "write_file_content")).toBe(false);
});

test("Account › Activity insights take the day range and model the desktop offers and reveal the HTML report", async () => {
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
  await app.waitFor("nav-library");
  await openActivity(app);
  await app.waitFor("activity-generate-insights");
  await app.press("activity-insights-days");
  await app.press("activity-insights-days-7");
  await app.press("activity-insights-model");
  await app.press("activity-insights-model-fast");
  await app.press("activity-generate-insights");
  await app.waitFor("insights-show-html");
  const generatePayload = recorded.find(c => c.action === "generate_insights")?.payload as Record<string, unknown> | undefined;
  expect(generatePayload).toMatchObject({
    days: 7,
    modelId: "fast",
  });
  expect(typeof generatePayload?.generationId).toBe("string");
  expect(String(generatePayload?.generationId ?? "").length).toBeGreaterThan(0);
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
  await app.waitFor("nav-library");
  await openAssistants(app);
  await app.waitFor("assistant-card-asst-7");
  // The saved emoji is the avatar, as on the desktop.
  expect(app.texts()).toContain("🦉");
  await app.press("assistant-card-asst-7");
  await app.waitFor("assistant-open-asst-7");
  await app.press("assistant-open-asst-7");
  await app.waitUntil(() => recorded.some(c => c.action === "set_active_workspace"));
  expect(recorded.find(c => c.action === "set_active_workspace")?.payload).toMatchObject({ workspaceId: "asst-7" });
  await app.waitFor("assistant-close-asst-7");
  await app.press("assistant-close-asst-7");
  await app.waitUntil(() => recorded.some(c => c.action === "close_workspace"));
  expect(recorded.find(c => c.action === "close_workspace")?.payload).toMatchObject({ workspaceId: "asst-7" });
});

test("assistants switch to the compact single-column layout at phone width", async () => {
  const base = createBackend();
  const { recorded } = wrapBackend(base, action => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_identity") return { ok: true, value: null, transport: "dev" };
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
  await app.waitFor("nav-library");

  // Phone width: the shell's sidebar is put away.
  await app.setViewport(390, 844);
  if (app.shows("compact-drawer-scrim")) await app.press("compact-drawer-scrim");
  // The open conversation stays as the phone's pushed page; its back control leads to the tabs.
  if (app.shows("session-back")) await app.press("session-back");

  // Assistants: the list is the landing; a row opens the persona studio with a back control.
  await openAssistants(app);
  await app.waitFor("assistant-card-asst-2");
  expect(app.shows("persona-editor-input")).toBe(false);
  await app.press("assistant-card-asst-2");
  await app.waitFor("/tmp/assistants/asst-2/IDENTITY.md");
  expect(app.shows("assistant-card-asst-1")).toBe(false);
  await app.press("assistants-back");
  await app.waitFor("assistant-card-asst-1");
  expect(recorded.some(c => c.action === "get_assistant_workspaces")).toBe(true);
});

// view models (wave 4)

test("Account › Activity asks for an update when the device is older than the activity view model", async () => {
  const base = createBackend({ personalOverview: false, usageActivityCommand: false });
  const { recorded } = wrapBackend(base, action => {
    if (action === "account_status") {
      return { ok: true, value: { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_identity" || action === "get_latest_insights") {
      return { ok: true, value: action === "get_latest_insights" ? [] : null, transport: "dev" };
    }
    return undefined;
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("nav-library");
  await openActivity(app);
  await app.waitFor("Update OpenBitFun on this device to see its activity.");
  expect(app.shows("settings-activity-heatmap")).toBe(false);
  expect(recorded.some(call => call.action === "get_token_usage_activity")).toBe(true);
  // No client copy of the host's activity runs against an older device.
  for (const command of ["get_token_usage_statistics", "get_personal_overview"]) {
    expect(recorded.some(call => call.action === command)).toBe(false);
  }
});

test("the workspace navigator selection comes from the host projection", async () => {
  const base = createBackend({
    openedWorkspaces: [
      { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
      { id: "workspace-3", name: "Docs", rootPath: "/docs", workspaceKind: "local" },
    ],
    currentWorkspaceId: "workspace-3",
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  // The workspaces are listed under this device in All sessions › By device.
  await showDevices(app);
  await app.waitFor("Docs");
  const reads = base.calls.filter(call => call.action === "get_workspace_navigator");
  expect(reads.length).toBeGreaterThan(0);
  // The host's current workspace is selected without a client merge of three lists.
  expect(base.calls.some(call => call.action === "get_opened_workspaces")).toBe(false);
  expect(base.calls.some(call => call.action === "get_current_workspace")).toBe(false);
  // The selection was the host's own, so no switch was sent back.
  expect(base.calls.some(call => call.action === "set_active_workspace")).toBe(false);
});

test("an older host without the workspace navigator says so instead of merging lists here", async () => {
  const base = createBackend({ workspaceNavigator: false });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor(
    "Update OpenBitFun on this device to list its workspaces; its version is too old to provide workspace navigation.",
  );
  expect(base.calls.some(call => call.action === "get_opened_workspaces")).toBe(false);
});

test("Account › Activity insights preserves partial_report metadata and persona saves pass expectedHash", async () => {
  const base = createBackend();
  const { recorded } = wrapBackend(base, (action, payload) => {
    if (action === "get_latest_insights") return { ok: true, value: [], transport: "dev" };
    if (action === "generate_insights") {
      return {
        ok: true,
        value: {
          days_covered: 7,
          total_sessions: 5,
          analyzed_sessions: 3,
          failed_sections: 2,
          partial_report: true,
          at_a_glance: { whats_working: "Fast builds." },
        },
        transport: "dev",
      };
    }
    if (action === "get_assistant_workspaces") {
      return {
        ok: true,
        value: [
          { id: "asst-hash", name: "Nova", rootPath: "/tmp/assistants/asst-hash", workspaceKind: "assistant", identity: { emoji: "🦉" } },
        ],
        transport: "dev",
      };
    }
    if (action === "read_file_content") {
      return { ok: true, value: "# Soul\nOriginal text", transport: "dev" };
    }
    if (action === "write_file_content") {
      void payload;
      return { ok: true, value: null, transport: "dev" };
    }
    return undefined;
  });

  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("nav-library");
  await openActivity(app);
  await app.waitFor("activity-generate-insights");
  await app.press("activity-generate-insights");
  await app.waitFor("text:Partial report: 2 report sections failed to generate.");
  expect(recorded.some(c => c.action === "generate_insights" && typeof (c.payload as Record<string, unknown>)?.generationId === "string")).toBe(true);
});

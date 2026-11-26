import { expect, open, test } from "nsh/test";
import { openSession, openToolScene, showDevices, type BackendOptions, createBackend, createDeviceBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface WorkbenchBackendOptions extends BackendOptions {
  /** Shells the host already runs (`terminal_list`), e.g. one an agent started. */
  terminalSessions?: Array<Record<string, unknown>>;
  subscriptions?: Array<Record<string, unknown>>;
  /** `list_subscription_account_instances`; absent means an older host without it. */
  subscriptionInstances?: Array<Record<string, unknown>>;
  subscriptionQuotas?: Record<string, Record<string, unknown>>;
}

interface ExtendedHarness {
  handlers: Record<string, (data: unknown) => unknown>;
  /** The base fixture's records: every command it answered and every config write. */
  calls: Array<{ action: string; request: unknown }>;
  settingsWrites: Array<{ path: string; value: unknown }>;
  fileWrites: Array<{
    workspaceId?: string;
    workspacePath?: string;
    filePath: string;
    content: string;
    expectedHash?: string;
  }>;
  formStateWrites: Array<Record<string, unknown>>;
  configuredBots: Array<Record<string, unknown>>;
  startedConnections: Array<{ method: string; lan_ip?: unknown }>;
  stoppedConnections: Array<string | null>;
  stopBotCount: () => number;
  weixinQrStarts: () => number;
  /** Every `remote_connect_weixin_qr_poll` request, in order. */
  weixinPolls: Array<Record<string, unknown>>;
  /** Every `remote_connect_set_allowed` value, in order. */
  allowedWrites: boolean[];
  /** Every device id an `account_delete_device` named, in order. */
  deletedDevices: string[];
  verboseWrites: boolean[];
  modelDiscoveryCalls: Array<Record<string, unknown>>;
  connectionTestCalls: Array<Record<string, unknown>>;
  savedModelLists: Array<Array<Record<string, unknown>>>;
  quotaCalls: Array<Record<string, unknown>>;
  /** Another writer (an agent, a second editor) changes a file on disk. */
  externalWrite: (path: string, text: string) => void;
}

function createWorkbenchBackend(
  options: WorkbenchBackendOptions = {},
  deviceMode = false,
): ExtendedHarness {
  const base = deviceMode ? createDeviceBackend(options) : createBackend(options);
  const originalInvoke = base.handlers["openbitfun.invoke"];

  const filesText: Record<string, string> = { ...(options.fileContent ?? {}) };
  const fileVersions: Record<string, number> = {};
  const fileWrites: ExtendedHarness["fileWrites"] = [];
  const formStateWrites: Array<Record<string, unknown>> = [];
  const configuredBots: Array<Record<string, unknown>> = [];
  const startedConnections: Array<{ method: string; lan_ip?: unknown }> = [];
  const stoppedConnections: Array<string | null> = [];
  const verboseWrites: boolean[] = [];
  const modelDiscoveryCalls: Array<Record<string, unknown>> = [];
  const connectionTestCalls: Array<Record<string, unknown>> = [];
  const savedModelLists: Array<Array<Record<string, unknown>>> = [];
  const quotaCalls: Array<Record<string, unknown>> = [];

  let stopBotCalls = 0;
  let weixinQrCalls = 0;
  let remoteControlAllowed = true;
  const deletedDevices: string[] = [];
  const allowedWrites: boolean[] = [];
  const weixinPolls: Array<Record<string, unknown>> = [];
  let botVerbose = false;
  let botConnected: string | null = null;
  let formState: Record<string, unknown> = {
    telegram_bot_token: "",
    feishu_app_id: "",
    feishu_app_secret: "",
  };

  const handlers: Record<string, (data: unknown) => unknown> = {
    ...base.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
      const action = args.action ?? "";
      const hasRaw = Object.prototype.hasOwnProperty.call(args, "raw");
      const payload = ((hasRaw ? args.raw : args.request) ?? {}) as Record<string, unknown>;

      switch (action) {
        case "write_file_content": {
          if (hasRaw) throw new Error("write_file_content must use invokeCommand");
          const filePath = String(payload.filePath ?? "");
          const content = String(payload.content ?? "");
          // The host checks `expectedHash` against the file under its write lock
          // and refuses a stale save with the typed FILE_CONFLICT error.
          if (typeof payload.expectedHash === "string") {
            const current = Object.prototype.hasOwnProperty.call(filesText, filePath)
              ? filesText[filePath]
              : ((originalInvoke({ action: "read_file_content", request: { filePath } }) as { value?: unknown })?.value);
            const actual =
              typeof current === "string" ? crypto.createHash("sha256").update(current).digest("hex") : "";
            if (actual !== payload.expectedHash) {
              return { ok: false, error: "FILE_CONFLICT: File changed after it was read; refresh before saving", transport: "dev" };
            }
          }
          filesText[filePath] = content;
          fileVersions[filePath] = (fileVersions[filePath] ?? 1_700_000_000_000) + 1;
          fileWrites.push({
            workspaceId: typeof payload.workspaceId === "string" ? payload.workspaceId : undefined,
            workspacePath: typeof payload.workspacePath === "string" ? payload.workspacePath : undefined,
            filePath,
            content,
            ...(typeof payload.expectedHash === "string" ? { expectedHash: payload.expectedHash } : {}),
          });
          return { ok: true, value: null, transport: "dev" };
        }
        case "terminal_list": {
          if (!options.terminalSessions) return originalInvoke(data);
          return { ok: true, value: options.terminalSessions, transport: "dev" };
        }
        case "get_file_metadata": {
          const path = String(payload.path ?? "");
          if (fileVersions[path] !== undefined && filesText[path] !== undefined) {
            return {
              ok: true,
              value: { path, modified: fileVersions[path], size: filesText[path].length },
              transport: "dev",
            };
          }
          return originalInvoke(data);
        }
        case "read_file_content": {
          const filePath = String(payload.filePath ?? "");
          if (Object.prototype.hasOwnProperty.call(filesText, filePath)) {
            return { ok: true, value: filesText[filePath], transport: "dev" };
          }
          return originalInvoke(data);
        }
        case "list_ai_models_by_config": {
          if (hasRaw) throw new Error("list_ai_models_by_config must use invokeCommand");
          const cfg = (payload.config ?? {}) as Record<string, unknown>;
          modelDiscoveryCalls.push(cfg);
          return {
            ok: true,
            value: [
              {
                id: "gpt-4.1",
                display_name: "GPT-4.1",
                owned_by: "openai",
                context_window: 1000000,
                max_tokens: 500000,
              },
              {
                id: "o3-mini",
                name: "o3-mini",
                owned_by: "openai",
                context_window: 200000,
                max_tokens: 100000,
              },
            ],
            transport: "dev",
          };
        }
        case "test_ai_config_connection": {
          if (hasRaw) throw new Error("test_ai_config_connection must use invokeCommand");
          const cfg = (payload.config ?? {}) as Record<string, unknown>;
          connectionTestCalls.push(cfg);
          return {
            ok: true,
            value: {
              success: true,
              response_time_ms: 142,
              model_response: "OK",
            },
            transport: "dev",
          };
        }
        case "list_subscription_accounts": {
          return {
            ok: true,
            value: options.subscriptions ?? [],
            transport: "dev",
          };
        }
        case "list_subscription_account_instances": {
          if (!options.subscriptionInstances) return originalInvoke(data);
          if (!hasRaw) throw new Error("list_subscription_account_instances takes no request wrapper");
          return { ok: true, value: options.subscriptionInstances, transport: "dev" };
        }
        case "get_subscription_account_quota": {
          if (hasRaw) throw new Error("get_subscription_account_quota must use invokeCommand");
          quotaCalls.push(payload);
          const key = String(payload.accountId ?? "");
          const quota =
            options.subscriptionQuotas?.[key] ?? options.subscriptionQuotas?.[String(payload.provider ?? "")] ?? null;
          return { ok: true, value: quota, transport: "dev" };
        }
        case "set_config": {
          const path = String(payload.path ?? payload.key ?? "");
          if (path === "ai.models" && Array.isArray(payload.value)) {
            savedModelLists.push(payload.value as Array<Record<string, unknown>>);
          }
          return originalInvoke(data);
        }
        case "remote_connect_status": {
          if (!hasRaw) throw new Error("remote_connect_status takes no request wrapper");
          return {
            ok: true,
            // The 2.0 shape: the retired relay fields stay, always empty.
            value: {
              connections: [],
              relay_connected: false,
              relay_url: null,
              active_method: null,
              clients: [],
              bot_connected: botConnected,
              bot_verbose_mode: botVerbose,
              remote_control_allowed: remoteControlAllowed,
            },
            transport: "dev",
          };
        }
        case "remote_connect_get_methods": {
          if (!hasRaw) throw new Error("remote_connect_get_methods takes no request wrapper");
          return {
            ok: true,
            value: [
              { id: "bot_feishu", name: "Feishu Bot", available: true, description: "Via Feishu messenger" },
              { id: "bot_telegram", name: "Telegram Bot", available: true, description: "Via Telegram" },
              { id: "bot_weixin", name: "WeChat (Weixin)", available: true, description: "Via WeChat iLink bot" },
            ],
            transport: "dev",
          };
        }
        case "remote_connect_get_form_state": {
          if (!hasRaw) throw new Error("remote_connect_get_form_state takes no request wrapper");
          return { ok: true, value: formState, transport: "dev" };
        }
        case "remote_connect_set_form_state": {
          if (hasRaw) throw new Error("remote_connect_set_form_state must use request wrapper");
          formState = { ...payload };
          formStateWrites.push({ ...payload });
          return { ok: true, value: null, transport: "dev" };
        }
        case "remote_connect_configure_bot": {
          if (hasRaw) throw new Error("remote_connect_configure_bot must use request wrapper");
          configuredBots.push({ ...payload });
          return { ok: true, value: null, transport: "dev" };
        }
        case "remote_connect_start": {
          if (hasRaw) throw new Error("remote_connect_start must use request wrapper");
          const method = String(payload.method ?? "");
          // The retired LAN field is no longer sent.
          startedConnections.push({ method, ...("lan_ip" in payload ? { lan_ip: payload.lan_ip } : {}) });
          if (!method.startsWith("bot_")) {
            return { ok: false, error: "RELAY_METHOD_RETIRED: unsupported: the OpenBitFun relay was retired in OpenBitFun 2.0" };
          }
          if (method === "bot_telegram") {
            botConnected = "Telegram(@openbitfun_bot)";
          } else if (method === "bot_feishu") {
            botConnected = "Feishu(cli_feishu_1)";
          }
          return {
            ok: true,
            value: {
              method,
              qr_url: null,
              qr_data: null,
              bot_pairing_code: method.startsWith("bot_") ? "PAIR-1234" : null,
              bot_link: method === "bot_telegram" ? "https://t.me/openbitfun_bot" : null,
              pairing_state: "waiting_for_scan",
            },
            transport: "dev",
          };
        }
        case "remote_connect_stop": {
          if (hasRaw) throw new Error("remote_connect_stop must use request wrapper");
          const method = typeof payload.method === "string" ? payload.method : null;
          stoppedConnections.push(method);
          return { ok: true, value: null, transport: "dev" };
        }
        case "remote_connect_stop_bot": {
          if (!hasRaw) throw new Error("remote_connect_stop_bot takes no request wrapper");
          stopBotCalls += 1;
          botConnected = null;
          return { ok: true, value: null, transport: "dev" };
        }
        case "remote_connect_weixin_qr_start": {
          if (hasRaw) throw new Error("remote_connect_weixin_qr_start must use request wrapper");
          weixinQrCalls += 1;
          return {
            ok: true,
            value: {
              session_key: "wx-qr-1",
              qr_image_url: "https://weixin.example/qr/wx-qr-1",
              message: "Scan QR code with WeChat",
            },
            transport: "dev",
          };
        }
        case "account_delete_device": {
          if (!hasRaw) throw new Error("account_delete_device takes positional targetDeviceId");
          deletedDevices.push(String(payload.targetDeviceId ?? ""));
          return { ok: true, value: null, transport: "dev" };
        }
        case "remote_connect_set_allowed": {
          if (hasRaw) throw new Error("remote_connect_set_allowed must use request wrapper");
          remoteControlAllowed = payload.allowed === true;
          allowedWrites.push(remoteControlAllowed);
          return { ok: true, value: null, transport: "dev" };
        }
        case "remote_connect_weixin_qr_poll": {
          if (hasRaw) throw new Error("remote_connect_weixin_qr_poll must use request wrapper");
          weixinPolls.push({ ...payload });
          return {
            ok: true,
            value: payload.verify_code
              ? { status: "scanned", message: "Confirm on your phone" }
              : { status: "need_verify_code", message: "Enter the number shown in WeChat" },
            transport: "dev",
          };
        }
        case "remote_connect_get_bot_verbose_mode": {
          if (!hasRaw) throw new Error("remote_connect_get_bot_verbose_mode takes no request wrapper");
          return { ok: true, value: botVerbose, transport: "dev" };
        }
        case "remote_connect_set_bot_verbose_mode": {
          if (!hasRaw) throw new Error("remote_connect_set_bot_verbose_mode takes positional verbose");
          botVerbose = payload.verbose === true;
          verboseWrites.push(botVerbose);
          return { ok: true, value: null, transport: "dev" };
        }
        default:
          return originalInvoke(data);
      }
    },
  };

  return {
    handlers,
    calls: base.calls,
    settingsWrites: base.settingsWrites,
    fileWrites,
    formStateWrites,
    configuredBots,
    startedConnections,
    stoppedConnections,
    stopBotCount: () => stopBotCalls,
    weixinQrStarts: () => weixinQrCalls,
    weixinPolls,
    allowedWrites,
    deletedDevices,
    verboseWrites,
    modelDiscoveryCalls,
    connectionTestCalls,
    savedModelLists,
    quotaCalls,
    externalWrite: (path: string, text: string) => {
      filesText[path] = text;
      fileVersions[path] = (fileVersions[path] ?? 1_700_000_000_000) + 1000;
    },
  };
}

test("files scene edits code and markdown files, tracks open tabs, uses dropdown actions, and supports AuxPane compact mode", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openToolScene(app, "files");
  await app.waitFor("Explorer");
  await app.waitFor("workbench-switch-files");
  await app.waitFor("workbench-switch-terminal");
  await app.press("main.rs");
  await app.waitFor("fn main() {");
  await app.waitFor("file-tab-main.rs");
  // The host watcher is registered on the root, as the desktop explorer does.
  await app.waitFor("LF");

  // Code opens straight into the editor: nothing to save until the text changes.
  expect(app.texts()).not.toContain("Save file");
  await app.type("file-editor", "// edited\n");
  await app.waitFor("Unsaved changes");
  await app.waitFor("Save file");

  // Discard returns to the disk copy without writing.
  await app.press("file-discard");
  await app.waitUntil(() => !app.texts().includes("Unsaved changes"));
  expect(backend.fileWrites).toHaveLength(0);

  // A draft survives switching to another tab and back.
  await app.type("file-editor", "// edited\n");
  await app.waitFor("Unsaved changes");
  await app.press("README.md");
  await app.waitFor("Markdown preview from the host.");
  await app.waitFor("file-tab-dirty-main.rs");
  await app.press("file-tab-main.rs");
  await app.waitFor("Unsaved changes");
  await app.press("file-save");
  await app.waitFor("Saved main.rs");

  expect(backend.fileWrites).toHaveLength(1);
  expect(backend.fileWrites[0]).toMatchObject({
    workspaceId: "workspace-1",
    workspacePath: "/repo",
    filePath: "/repo/main.rs",
  });
  expect(backend.fileWrites[0].content).toContain("// edited");
  // The save names the disk text it was edited against; the host enforces it.
  expect(backend.fileWrites[0].expectedHash).toMatch(/^[0-9a-f]{64}$/);

  // Markdown opens directly editable in visual Preview and stays editable after Save.
  await app.press("README.md");
  await app.waitFor("Markdown preview from the host.");
  await app.waitFor("file-tab-README.md");
  await app.waitFor("file-editor");
  await app.type("file-editor", "More notes.\n");
  await app.press("file-save");
  await app.waitFor("Saved README.md");
  expect(backend.fileWrites).toHaveLength(2);

  // A save that finds a newer disk copy stops and asks; Overwrite writes anyway.
  await app.type("file-editor", "Mine.\n");
  backend.externalWrite("/repo/README.md", "# Agent rewrote this\n");
  await app.press("file-save");
  await app.waitFor("file-conflict-overwrite");
  expect(backend.fileWrites).toHaveLength(2);
  await app.press("file-conflict-overwrite");
  await app.waitFor("Saved README.md");
  expect(backend.fileWrites).toHaveLength(3);
  expect(backend.fileWrites[2].content).toContain("Mine.");
  // Overwrite is the user's choice to replace the newer copy: it sends no hash.
  expect(backend.fileWrites[2].expectedHash).toBeUndefined();

  // A clean open file follows its disk copy when the watcher reports a change.
  backend.externalWrite("/repo/README.md", "# Reloaded from the watcher\n");
  await app.host.send("openbitfun.event", {
    event: "file-system-changed",
    payload: [{ path: "/repo/README.md", kind: "modify", timestamp: 1 }],
  });
  await app.waitFor("Reloaded from the watcher");

  // Closing a dirty tab asks first; Discard and close drops the draft unwritten.
  await app.press("file-tab-main.rs");
  await app.waitUntil(() => app.texts().some(text => text.startsWith("fn main()")));
  await app.type("file-editor", "// scratch\n");
  await app.waitFor("Unsaved changes");
  await app.hover("file-tab-main.rs");
  await app.press("close-file-tab-main.rs");
  await app.waitFor("Discard and close");
  await app.press("Discard and close");
  await app.waitUntil(() => !app.shows("file-tab-main.rs"));
  expect(backend.fileWrites).toHaveLength(3);

  // File actions dropdown creates a new file and confirms delete.
  await app.press("file-actions-menu");
  await app.press("New file");
  await app.type("entry-name", "notes.txt");
  await app.press("Save");
  await app.waitFor("notes.txt");

  await app.press("file-actions-menu");
  await app.press("Delete");
  await app.waitFor("file-delete-confirm");
  await app.press("file-delete-confirm");

  // A session's inspector mounts FilesScene in compact mode when its tool toggle is pressed.
  await openSession(app, "NSH skeleton");
  await app.press("session-tool-files");
  await app.waitFor("Explorer");
});

test("files and git stack list then detail with a back control when the scene is narrow", async () => {
  const backend = createWorkbenchBackend();
  // A trusted repository for the Git half; everything else is the workbench host.
  const diffRequests: Array<Record<string, unknown>> = [];
  const gitAnswers: Record<string, (payload: Record<string, unknown>) => unknown> = {
    git_is_repository: () => true,
    git_get_repository_trust: () => ({
      state: "trusted",
      repositoryPath: "/repo",
      detail: null,
      manualCommand: null,
    }),
    git_get_diff: payload => {
      diffRequests.push(payload);
      return "diff --git a/main.rs b/main.rs\n--- a/main.rs\n+++ b/main.rs\n@@ -1 +1 @@\n-old\n+new staged line";
    },
    git_get_branches: () => [],
    git_get_commits: () => [],
    git_get_graph: () => ({ nodes: [], maxLane: 0 }),
    git_list_worktrees: () => [],
  };
  const workbenchInvoke = backend.handlers["openbitfun.invoke"];
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
      const answer = gitAnswers[args.action ?? ""];
      if (!answer) return workbenchInvoke(data);
      const payload = ((args.raw ?? args.request) ?? {}) as Record<string, unknown>;
      return { ok: true, value: answer(payload), transport: "dev" };
    },
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers } });

  await openToolScene(app, "files");
  await app.waitFor("Explorer");
  // Wide: explorer and preview sit side by side, no back control.
  expect(app.shows("files-stack-back")).toBe(false);

  await app.setViewport(560, 900);
  // Narrow: the list is the whole view until a file is opened.
  await app.waitFor("README.md");
  expect(app.shows("files-stack-back")).toBe(false);
  await app.press("main.rs");
  await app.waitFor("files-stack-back");
  await app.waitUntil(() => app.texts().some(text => text.startsWith("fn main()")));
  expect(app.shows("explorer-row-README.md")).toBe(false);

  // Back returns to the list; the open tab survives.
  await app.press("files-stack-back");
  await app.waitFor("explorer-row-README.md");
  expect(app.shows("files-stack-back")).toBe(false);
  expect(app.texts().some(text => text.startsWith("fn main()"))).toBe(false);

  // Git: a pressed change pushes its diff with the same request; back returns to the list.
  await app.setViewport(1440, 900);
  // The tool switcher of the full-width header (visual spec §4.10) names Git "Changes".
  await app.press("workbench-switch-git");
  await app.waitFor("Working Copy");
  await app.setViewport(560, 900);
  await app.waitFor("label:git-staged-main.rs");
  expect(app.shows("label:git-stack-back")).toBe(false);
  await app.press("label:git-staged-main.rs");
  await app.waitFor("label:git-stack-back");
  expect(app.shows("label:git-commit-message")).toBe(false);
  expect(diffRequests.at(-1)).toMatchObject({ params: { files: ["/repo/main.rs"], staged: true } });
  await app.press("label:git-stack-back");
  await app.waitFor("label:git-commit-message");
  expect(app.shows("label:git-stack-back")).toBe(false);
});

test("devices scene configures Telegram/Feishu bots and starts WeChat QR via modals; the 1.x relay row is gone", async () => {
  const backend = createWorkbenchBackend({}, true);
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
  });

  // Chat apps live in Settings › Account › Devices and chat apps.
  await app.press("Settings");
  await app.press("Devices and chat apps");
  await app.waitFor("label:channels-section");
  await app.waitFor("Not connected");
  // Detailed replies are a chat-app setting: without a connected bot they say what they need.
  expect(app.shows("text:Available once a chat app is connected.")).toBe(true);

  // Open Telegram channel modal, configure & start, then close modal.
  await app.press("channel-toggle-telegram");
  await app.type("connector-telegram-token", "tg-bot-token-123");
  await app.press("connector-telegram-connect");
  // The first connection waits for the Remote Connect disclaimer, as on the desktop.
  await app.waitFor("remote-disclaimer-agree");
  expect(backend.configuredBots.length).toBe(0);
  await app.press("remote-disclaimer-agree");
  await app.waitFor("Connected · @openbitfun_bot");
  expect(backend.configuredBots.at(-1)).toMatchObject({
    bot_type: "telegram",
    bot_token: "tg-bot-token-123",
  });
  expect(backend.startedConnections).toContainEqual({ method: "bot_telegram" });
  await app.press("text:Done");
  // The connected app's row offers Disconnect instead of Connect; the others keep Connect.
  expect(app.shows("channel-toggle-telegram")).toBe(false);
  expect(app.shows("channel-toggle-feishu")).toBe(true);

  // Stop bot from the connected app's own row; the confirmation is a toast, not a banner.
  await app.press("connector-bot-stop");
  await app.waitFor("channel-toggle-telegram");
  expect(backend.stopBotCount()).toBe(1);

  // Open Feishu channel modal, configure & start, then close modal.
  await app.press("channel-toggle-feishu");
  await app.type("connector-feishu-app-id", "cli_app_1");
  await app.type("connector-feishu-app-secret", "sec_feishu_1");
  await app.press("connector-feishu-connect");
  await app.waitFor("Connected · cli_feishu_1");
  expect(backend.configuredBots.at(-1)).toMatchObject({
    bot_type: "feishu",
    app_id: "cli_app_1",
    app_secret: "sec_feishu_1",
  });
  expect(backend.startedConnections).toContainEqual({ method: "bot_feishu" });
  await app.press("text:Done");

  // Open WeChat channel modal & start QR, then close modal.
  await app.press("channel-toggle-weixin");
  await app.press("connector-weixin-qr-start");
  await app.waitFor("text:https://weixin.example/qr/wx-qr-1");
  expect(backend.weixinQrStarts()).toBe(1);
  // A non-image QR payload is drawn as a QR code, as the desktop does.
  expect(app.shows("connector-weixin-qr")).toBe(true);
  // need_verify_code asks for the number and sends it with the next poll only.
  await app.press("connector-weixin-qr-poll");
  await app.waitFor("connector-weixin-verify-code");
  expect(backend.weixinPolls.at(-1)).toMatchObject({ session_key: "wx-qr-1", verify_code: null });
  await app.type("connector-weixin-verify-code", "4821");
  await app.press("connector-weixin-verify-submit");
  await app.waitFor("Confirm on your phone");
  expect(backend.weixinPolls.at(-1)).toMatchObject({ session_key: "wx-qr-1", verify_code: "4821" });
  await app.press("text:Done");

  // Whether other devices may control this one.
  await app.press("remote-control-allowed");
  await app.waitUntil(() => backend.allowedWrites.length === 1);
  expect(backend.allowedWrites).toEqual([false]);

  // Detailed replies toggle (a bot is connected now); its confirmation is a toast.
  expect(app.shows("text:Besides the answer, bots also send a short summary of the agent's thinking.")).toBe(true);
  await app.press("connector-bot-verbose");
  await app.waitUntil(() => backend.verboseWrites.length === 1);
  expect(backend.verboseWrites).toEqual([true]);

  // The 1.x mobile web relay is retired in 2.0, and the OBP paired-client card stays hidden when no paired clients exist.
  expect(app.shows("channel-toggle-relay")).toBe(false);
  expect(app.shows("obp-pairing-card")).toBe(false);
  expect(backend.startedConnections.every(item => item.method.startsWith("bot_"))).toBe(true);
  expect(backend.stoppedConnections).toEqual([]);
});

test("chat app modal errors stay scoped to the modal that caused them", async () => {
  const backend = createWorkbenchBackend({}, true);
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const { action } = data as { action?: string };
    if (action === "remote_connect_configure_bot") {
      return { ok: false, error: "feishu credentials rejected", transport: "dev" };
    }
    return baseInvoke(data);
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.press("Settings");
  await app.press("Devices and chat apps");
  await app.waitFor("label:channels-section");

  await app.press("channel-toggle-feishu");
  await app.type("connector-feishu-app-id", "cli_bad");
  await app.type("connector-feishu-app-secret", "sec_bad");
  await app.press("connector-feishu-connect");
  await app.waitFor("remote-disclaimer-agree");
  await app.press("remote-disclaimer-agree");
  await app.waitFor("text:feishu credentials rejected");
  await app.press("text:Done");

  // Opening WeChat starts with a clean modal — no stale Feishu error bleeds across.
  await app.press("channel-toggle-weixin");
  await app.waitFor("connector-weixin-qr-start");
  expect(app.shows("text:feishu credentials rejected")).toBe(false);
});


test("settings opens on General, renders one page at a time, and finds a field by search", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    colorScheme: "dark",
    host: { handlers: backend.handlers },
  });

  await app.press("Settings");
  // General is the first page, as on the desktop; other pages are not mounted.
  // A Preferences page says it syncs with the account instead of listing features.
  await app.waitFor("settings-synced");
  await app.waitFor("Interface language");
  expect(app.texts()).not.toContain("Showing the dark scheme");
  expect(app.shows("mcp-add")).toBe(false);

  // Consumer settings never expose raw dotted config key paths in visible text.
  const generalTexts = app.texts().join("\n");
  expect(generalTexts).not.toContain("app.auto_update");
  expect(generalTexts).not.toContain("app.telemetry");

  // The settings list holds the Preferences, Account and Device scopes.
  await app.waitFor("nav-settings-page-models");
  await app.press("nav-settings-page-models");
  await app.waitFor("Model pools");
  await app.waitFor("Default models");
  expect(app.texts()).not.toContain("Interface language");

  await app.press("nav-settings-page-appearance");
  await app.waitFor("Showing the dark scheme");
  expect(app.texts()).not.toContain("Model pools");

  // Search matches a field label on another page and opens that page.
  await app.type("settings-search", "scrollback");
  await app.waitFor("settings-search-hit-field-terminal-scrollback");
  await app.press("settings-search-hit-field-terminal-scrollback");
  await app.waitFor("Maximum lines preserved in terminal scroll history");
  expect(app.value("terminal-scrollback")).toBe("1000");
});

test("a narrow settings scene lists the pages first, pushes one full width and goes back", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.waitFor("Interface language");
  // Wide: the page itself, no in-scene page list and no pages switcher.
  expect(app.shows("settings-compact-page-models")).toBe(false);
  expect(app.shows("settings-compact-pages")).toBe(false);

  await app.setViewport(560, 900);
  await app.waitFor("settings-compact-page-models");
  // The open page's description is not drawn while the list is shown.
  expect(app.texts()).not.toContain("Language, account, startup, updates and notifications.");

  // A page row pushes that page with a pages switcher (no stacked duplicate back chevron).
  await app.press("settings-compact-page-models");
  await app.waitFor("add-model");
  await app.waitFor("settings-compact-pages");
  expect(app.shows("settings-compact-back")).toBe(false);
  expect(app.shows("settings-compact-page-models")).toBe(false);

  // Switcher returns to the list; the page is no longer drawn.
  await app.press("settings-compact-pages");
  await app.waitFor("settings-compact-page-general");
  expect(app.shows("add-model")).toBe(false);

  // Widening again shows the selected page beside the navigation.
  await app.setViewport(1440, 900);
  await app.waitFor("add-model");
  expect(app.shows("settings-compact-pages")).toBe(false);
});

test("typed text that is not saved holds a page change until it is saved or discarded", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-workspace");
  await app.clear("worktree-branch-prefix");
  await app.type("worktree-branch-prefix", "team/");
  await app.waitFor("worktree-branch-prefix-save");

  // Leaving asks first; keep editing stays on the page with the text intact.
  await app.press("nav-settings-page-editor");
  await app.waitFor("Unsaved changes");
  await app.press("settings-unsaved-keep");
  expect(app.value("worktree-branch-prefix")).toBe("team/");

  // Save writes the typed value, then the page changes.
  await app.press("nav-settings-page-editor");
  await app.press("settings-unsaved-save");
  await app.waitFor("Font size inside code and markdown previews");
  const prefixWrite = (await backend.handlers["openbitfun.invoke"]({
    action: "get_config",
    request: { path: "app.worktrees.branchPrefix" },
  })) as { value?: unknown };
  expect(prefixWrite.value).toBe("team/");

  // Discard drops the typed value and changes the page without a write.
  await app.press("nav-settings-page-workspace");
  await app.clear("worktree-branch-prefix");
  await app.type("worktree-branch-prefix", "tmp/");
  await app.press("nav-settings-page-terminal");
  await app.waitFor("Unsaved changes");
  await app.press("settings-unsaved-discard");
  await app.waitFor("Maximum lines preserved in terminal scroll history");
  await app.press("nav-settings-page-workspace");
  expect(app.value("worktree-branch-prefix")).toBe("team/");

  // A typed number saves itself when the field loses focus, so leaving asks nothing.
  await app.press("nav-settings-page-editor");
  await app.clear("editor-tab-size");
  await app.type("editor-tab-size", "7");
  await app.keyboard.press("tab");
  await app.waitUntil(() =>
    backend.settingsWrites.some(write => write.path === "editor.tab_size" && write.value === 7),
  );
  await app.press("nav-settings-page-terminal");
  await app.waitFor("Maximum lines preserved in terminal scroll history");
  expect(app.shows("Unsaved changes")).toBe(false);
});

test("subscription quotas are read per account slot and drawn from the host's meters", async () => {
  const backend = createWorkbenchBackend({
    subscriptionInstances: [
      {
        account_id: "codex-account-3f8a1c52-9d4e-4b7a-8f21-5c6d7e8f9a0b",
        is_default: true,
        enabled: true,
        account: {
          provider: "codex",
          display_label: "Codex",
          account: "dev@example.com",
          connected: true,
          suggested_format: "responses",
          suggested_base_url: "",
          suggested_model: "",
        },
      },
    ],
    subscriptionQuotas: {
      "codex-account-3f8a1c52-9d4e-4b7a-8f21-5c6d7e8f9a0b": {
        account_id: "codex-account-3f8a1c52-9d4e-4b7a-8f21-5c6d7e8f9a0b",
        provider: "codex",
        state: "known",
        plan: "Pro",
        windows: [
          { id: "primary", duration_seconds: 18000, used_percent: 30 },
          { id: "secondary", duration_seconds: 604800, used_percent: 80 },
        ],
      },
    },
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("models-tab-subscriptions");
  await app.press("models-tab-subscriptions");
  await app.waitFor("Codex");
  // The quota is asked for by the account slot id, never by the email.
  expect(backend.quotaCalls.at(-1)).toMatchObject({
    provider: "codex",
    accountId: "codex-account-3f8a1c52-9d4e-4b7a-8f21-5c6d7e8f9a0b",
  });
  await app.waitFor("5-hour window · 70% left");
  await app.waitFor("Weekly · 20% left");
});

test("settings scene resolves model URL preview, tests connections, discovers remote models, and caps batch max_tokens", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("AI models");

  // Test an existing saved model row directly.
  await app.press("model-test-model-1");
  await app.waitFor("Connected · 142 ms");
  expect(backend.connectionTestCalls).toHaveLength(1);

  // Open Add Model modal and inspect live request URL resolution across formats.
  await app.press("add-model");
  await app.waitFor("Add AI model");

  await app.type("model-base-url", "https://proxy.example/v1");
  await app.waitFor("text:Request URL: https://proxy.example/v1/chat/completions");

  await app.press("model-format-anthropic");
  await app.waitFor("text:Request URL: https://proxy.example/v1/messages");

  await app.press("model-format-responses");
  await app.waitFor("text:Request URL: https://proxy.example/v1/responses");

  await app.press("model-format-gemini");
  await app.waitFor("text:Request URL: https://proxy.example/v1/v1beta/models/{model}:streamGenerateContent?alt=sse");

  await app.press("model-format-openai");
  await app.type("model-api-key", "sk-demo-key");
  await app.type("model-model-name", "gpt-4.1");

  // Test transient draft connection inside modal.
  await app.press("model-draft-test");
  await app.waitFor("Connected · 142 ms");
  expect(backend.connectionTestCalls).toHaveLength(2);

  // Detect models from remote /models endpoint.
  await app.press("model-detect-btn");
  await app.waitFor("2 models detected — open Quick Add Models to pick one or batch-import.");
  expect(backend.modelDiscoveryCalls).toHaveLength(1);
  expect(backend.modelDiscoveryCalls[0]).toMatchObject({
    provider: "openai",
    base_url: "https://proxy.example/v1",
    api_key: "sk-demo-key",
  });
  // The host derives the request URL from the base URL and format.
  expect(backend.modelDiscoveryCalls[0].request_url).toBeUndefined();

  // Open Quick Add Models discovery modal and batch-add 2 models.
  await app.press("settings-model-select");
  await app.waitFor("Discover & add models");
  await app.waitFor("GPT-4.1");
  await app.waitFor("o3-mini");

  await app.press("model-discovery-option-o3-mini");
  await app.waitFor("2 selected");
  await app.press("model-discovery-confirm");
  await app.waitFor("Added 2 models The output limit was lowered to what the context window allows.");

  // One batch intent; the host clamps each output limit to its window.
  const upserts = backend.calls.filter(call => call.action === "ai_model_upsert");
  expect(upserts).toHaveLength(1);
  expect((upserts[0].request as { models: unknown[] }).models).toHaveLength(2);
  const savedBatch = (backend.settingsWrites.filter(write => write.path === "ai.models").at(-1)?.value ??
    []) as Array<Record<string, unknown>>;
  const gpt41 = savedBatch.find(entry => entry.model_name === "gpt-4.1");
  const o3Mini = savedBatch.find(entry => entry.model_name === "o3-mini");
  // The host's ceiling: 1,000,000 * 0.4 = 400,000; 200,000 * 0.4 = 80,000.
  expect(gpt41).toMatchObject({ context_window: 1000000, max_tokens: 400000 });
  expect(o3Mini).toMatchObject({ context_window: 200000, max_tokens: 80000 });
});

test("settings scene renders subscription quotas and switches OpenBitFun appearance presets via theme gallery", async () => {
  const backend = createWorkbenchBackend({
    subscriptions: [
      {
        provider: "openai_codex",
        display_label: "OpenAI Codex",
        account: "dev@example.com",
        connected: true,
      },
    ],
    subscriptionQuotas: {
      openai_codex: {
        account_id: "dev@example.com",
        provider: "openai_codex",
        state: "healthy",
        plan: "Pro",
        primary_window: {
          label: "5h window",
          remaining_percent: 72,
          reset_at: "2h",
        },
      },
    },
  });
  const app = await open("../App.tsx", {
    ...DESKTOP,
    colorScheme: "dark",
    host: { handlers: backend.handlers },
  });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("models-tab-subscriptions");
  await app.press("models-tab-subscriptions");
  await app.waitFor("AI subscriptions");
  await app.waitFor("OpenAI Codex");
  await app.waitFor("5h window · 72% left · resets 2h");
  // A host without account instances has one slot per provider, named by the
  // provider key: the quota is never asked for by the account's email.
  expect(backend.quotaCalls.at(-1)).toMatchObject({ provider: "openai_codex", accountId: "openai_codex" });

  // Turn off Follow System to reveal the 3×3 theme gallery and pick Monochrome.
  await app.press("nav-settings-page-appearance");
  await app.waitFor("appearance-follow-system");
  await app.press("appearance-follow-system");
  await app.waitFor("appearance-swatch-openbitfun-monochrome");
  await app.press("appearance-swatch-openbitfun-monochrome");
  await app.waitFor("Showing the light scheme");

  // Switching preset back to Dark updates resolved scheme cleanly.
  await app.press("appearance-swatch-openbitfun-dark");
  await app.waitFor("Showing the dark scheme");
});

test("terminal scene keeps theme canvas background in light scheme and manages shell launch menu and profiles modal", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    colorScheme: "light",
    host: { handlers: backend.handlers },
  });

  await openToolScene(app, "terminal");
  await app.waitFor("workbench-switch-terminal");
  await app.waitFor("shell 1");
  expect(app.texts()).not.toContain("running");

  await app.press("New terminal with shell…");
  await app.press("New terminal");
  await app.waitFor("shell 2");
  await app.press("profiles-toggle");
  await app.waitFor("Terminal Profiles");
  await app.type("profile-name", " Watch");
  await app.type("profile-command", "pnpm test");
  await app.press("profile-save");
  await app.waitFor("Saved Terminal 1 Watch");
  await app.waitFor("Open Terminal 1 Watch");
  await app.waitFor("default shell · pnpm test");
});


test("terminal tab menus rename and clear the clicked shell without changing the active shell", async () => {
  const app = await open("./fixtures/terminalScene.tsx", { platform: "windows", width: 850, height: 650 });
  await app.waitFor("terminal-1 %");
  await app.press("New shell");
  await app.waitFor("terminal-2 %");
  expect(app.layout("terminal-rename-tab")).toBe(null);
  expect(app.layout("terminal-clear")).toBe(null);

  await app.rightClick("label:terminal-tab-shell 1");
  await app.press("terminal-rename-tab");
  await app.clear("terminal-rename-input");
  await app.type("terminal-rename-input", "Build log");
  await app.submit("terminal-rename-input");
  await app.waitFor("label:terminal-tab-Build log");
  await app.waitFor("terminal-2 %");

  await app.rightClick("label:terminal-tab-Build log");
  await app.press("terminal-clear");
  await app.waitFor("terminal-2 %");
  await app.press("label:terminal-tab-Build log");
  expect(app.layout("terminal-1 %")).toBe(null);
  expect(app.layout("terminal-2 %")).toBe(null);

  await app.setViewport(540, 650);
  await app.waitFor("terminal-compact-menu");
  await app.longPress("label:terminal-tab-shell 2");
  await app.press("terminal-clear");
  await app.press("label:terminal-tab-shell 2");
  expect(app.layout("terminal-2 %")).toBe(null);
});

test("two long terminal tabs fit beside the narrow and full toolbars", async () => {
  const titles = ["first", "second"].map(name => `wsp@desktop:/projects/worktrees/test-approval/${name}`);
  const backend = createWorkbenchBackend({
    terminalSessions: titles.map((name, index) => ({
      id: `terminal-${index}`,
      name,
      workspaceId: "workspace-1",
      status: "Running",
    })),
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openToolScene(app, "terminal");
  await app.waitFor(titles[1]);

  await app.host.send("openbitfun.event", {
    event: "terminal_event",
    payload: { type: "Exit", payload: { session_id: "terminal-0", exit_code: 7 } },
  });

  for (const [width, toolbarControl] of [[559, "terminal-compact-menu"], [820, "New terminal with shell…"]] as const) {
    await app.setViewport(width, DESKTOP.height);
    await app.waitFor(toolbarControl);
    await app.waitFor("exited (7)");
    expect(app.texts()).not.toContain("running");
    for (const [index, title] of titles.entries()) {
      const label = app.layout(`label:terminal-tab-${title}`);
      const close = app.layout(`label:× >> nth=${index}`);
      if (!label || !close) throw new Error(`Missing terminal tab at width ${width}`);
      expect(label.clipped).toBe(false);
      expect(close.clipped).toBe(false);
      expect(label.x + label.width).toBeLessThanOrEqual(close.x);
    }
  }

  const title = titles[0];
  await app.hover(`label:terminal-tab-${title}`);
  const tooltip = `text:${title} · exited (7)`;
  await app.waitFor(tooltip);
  const wrapped = app.layout(tooltip);
  const singleLine = app.layout(`text:${title}`);
  if (!wrapped || !singleLine) throw new Error("Missing terminal title or tooltip");
  expect(wrapped.height).toBeGreaterThan(singleLine.height);
  expect(wrapped.clipped).toBe(false);
});


test("terminal scene attaches the shells the host already runs for the workspace and closes a background shell in one click", async () => {
  const backend = createWorkbenchBackend({
    terminalSessions: [
      {
        id: "agent-term-1",
        name: "cargo test",
        workspaceId: "workspace-1",
        status: "Running",
        source: "agent",
        shellType: "Zsh",
        cwd: "/repo",
        cols: 120,
        rows: 32,
      },
      {
        id: "other-term-9",
        name: "elsewhere",
        workspaceId: "workspace-2",
        status: "Running",
        source: "manual",
        shellType: "Zsh",
        cwd: "/srv/app",
        cols: 120,
        rows: 32,
      },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await openToolScene(app, "terminal");
  // The agent's shell for this workspace is attached instead of a new one being started;
  // the other workspace's shell stays out of this list.
  await app.waitFor("cargo test");
  await app.waitFor("Agent");
  expect(app.texts()).not.toContain("elsewhere");
  expect(app.texts()).not.toContain("shell 1");

  await app.rightClick("label:terminal-tab-cargo test");
  await app.press("terminal-clear");
  await app.press("New shell");
  await app.waitFor("shell 2");
  await app.press("× >> nth=0");
  await app.waitUntil(() => !app.texts().includes("cargo test"));
  expect(backend.calls.filter(call => call.action === "terminal_close").map(call => call.request))
    .toEqual([{ sessionId: "agent-term-1" }]);
  await app.waitFor("terminal-1 %");

  await app.press("×");
  await app.waitFor("No active shell");
});


test("a subscription provider signs in through the host's login session", async () => {
  let signedIn = false;
  const backend = createWorkbenchBackend({
    subscriptions: [
      { provider: "codex", display_label: "Codex", account: null, connected: false, login_methods: ["browser", "device"] },
    ],
  });
  const loginCalls: Array<{ action: string; request: Record<string, unknown> }> = [];
  const invoke = backend.handlers["openbitfun.invoke"];
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: Record<string, unknown>; raw?: unknown };
      const action = args.action ?? "";
      if (action === "start_subscription_login" || action === "get_subscription_login_status") {
        if (!args.request) throw new Error(`${action} takes a request struct`);
        loginCalls.push({ action, request: args.request });
        if (action === "start_subscription_login") {
          return {
            ok: true,
            value: {
              provider: "codex",
              session_id: args.request.sessionId,
              method: "device",
              authorization_url: "https://auth.example/device",
              user_code: "ABCD-1234",
              instructions: "Enter the code in the browser",
            },
            transport: "dev",
          };
        }
        signedIn = true;
        return {
          ok: true,
          value: { provider: "codex", session_id: args.request.sessionId, status: "authorized" },
          transport: "dev",
        };
      }
      if (
        action === "logout_subscription_account_instance" ||
        action === "logout_subscription_account"
      ) {
        if (!args.request) throw new Error(`${action} takes a request struct`);
        loginCalls.push({ action, request: args.request });
        signedIn = false;
        return { ok: true, value: { provider: "codex", logged_out: true }, transport: "dev" };
      }
      if (action === "list_subscription_accounts" && signedIn) {
        return {
          ok: true,
          value: [{ provider: "codex", display_label: "Codex", account: "dev@example.com", connected: true }],
          transport: "dev",
        };
      }
      return invoke(data);
    },
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("models-tab-subscriptions");
  await app.press("models-tab-subscriptions");
  await app.waitFor("Codex");
  await app.press("subscription-connect-codex");
  await app.waitFor("Code: ABCD-1234");
  const start = loginCalls.find(call => call.action === "start_subscription_login");
  expect(start?.request).toMatchObject({ provider: "codex" });
  expect(String(start?.request.sessionId ?? "")).not.toBe("");
  // The status poll settles the session and the list is read again.
  await app.waitFor("Signed in", { timeout: 6000 });
  expect(loginCalls.some(call => call.action === "get_subscription_login_status")).toBe(true);
  await app.waitFor("dev@example.com");

  // Connected subscription slots expose Sign out backed by logout_subscription_account_instance / logout_subscription_account.
  await app.waitFor("subscription-signout-codex");
  await app.press("subscription-signout-codex");
  await app.waitUntil(() =>
    loginCalls.some(
      call =>
        call.action === "logout_subscription_account_instance" ||
        call.action === "logout_subscription_account",
    ),
  );
});

test("settings models page uses segmented sub-tabs, provider accordions, and compact subscription cards", async () => {
  const models = [
    {
      id: "m-openai",
      name: "GPT-5",
      provider: "openai",
      model_name: "gpt-5",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-1",
      enabled: true,
      category: "general_chat",
      capabilities: ["text_chat"],
    },
    {
      id: "m-anthropic",
      name: "Claude Sonnet",
      provider: "anthropic",
      model_name: "claude-sonnet-4",
      base_url: "https://api.anthropic.com",
      api_key: "sk-2",
      enabled: true,
      category: "general_chat",
      capabilities: ["text_chat"],
    },
    {
      id: "m-deepseek",
      name: "DeepSeek R1",
      provider: "openai",
      model_name: "deepseek-reasoner",
      base_url: "https://api.deepseek.com/v1",
      api_key: "sk-3",
      enabled: false,
      category: "general_chat",
      capabilities: ["text_chat"],
    },
    {
      id: "m-gemini",
      name: "Gemini Pro",
      provider: "gemini",
      model_name: "gemini-2.5-pro",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
      api_key: "sk-4",
      enabled: true,
      category: "general_chat",
      capabilities: ["text_chat"],
    },
  ];
  const backend = createWorkbenchBackend();
  const baseInvoke = backend.handlers["openbitfun.invoke"];
  const handlers = {
    ...backend.handlers,
    "openbitfun.invoke": (data: unknown) => {
      const { action, request } = data as { action?: string; request?: Record<string, unknown> };
      if (action === "get_config" && request?.path === "ai.models") {
        return { ok: true, value: models, transport: "dev" };
      }
      if (action === "get_config" && request?.path === "ai.default_models") {
        return { ok: true, value: { primary: "m-openai" }, transport: "dev" };
      }
      if (action === "list_subscription_accounts" || action === "list_subscription_account_instances") {
        return {
          ok: true,
          value: [
            { account_id: "codex", provider: "codex", display_label: "Codex", account: "dev@example.com", connected: true },
            { account_id: "claude", provider: "claude", display_label: "Claude", connected: false },
            { account_id: "gemini", provider: "gemini", display_label: "Gemini", connected: false },
          ],
          transport: "dev",
        };
      }
      return baseInvoke(data);
    },
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers } });

  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("models-tab-models");
  await app.waitFor("models-tab-subscriptions");
  await app.waitFor("models-tab-pools");
  await app.waitFor("models-tab-network");

  // Default models hides secondary capability slots behind a disclosure row.
  await app.waitFor("default-model-primary");
  await app.waitFor("default-model-fast");
  expect(app.shows("default-model-economy")).toBe(false);
  await app.press("default-models-more-slots");
  await app.waitFor("default-model-economy");

  // With 4 provider groups (>3), only the primary provider group expands by default.
  await app.waitFor("GPT-5");
  expect(app.shows("model-enabled-m-openai")).toBe(true);
  expect(app.shows("model-enabled-m-gemini")).toBe(false);

  // Searching auto-expands matching provider groups.
  await app.type("models-filter-search", "Gemini");
  await app.waitFor("model-enabled-m-gemini");
  expect(app.shows("model-enabled-m-openai")).toBe(false);
  await app.clear("models-filter-search");

  // Per-provider quick-add pre-fills format and baseUrl for that group.
  await app.press("provider-add-model-anthropic-api.anthropic.com");
  await app.waitFor("model-editor-modal");
  expect(app.value("model-base-url")).toBe("https://api.anthropic.com");
  await app.press("model-editor-cancel");

  // Switching to Subscriptions isolates connected accounts and available providers cleanly.
  await app.press("models-tab-subscriptions");
  await app.waitFor("subscription-signout-codex");
  await app.waitFor("subscription-connect-claude");
  await app.waitFor("subscription-connect-gemini");
  expect(app.shows("add-model")).toBe(false);
});

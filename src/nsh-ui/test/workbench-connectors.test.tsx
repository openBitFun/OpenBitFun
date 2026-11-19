import { expect, open, test } from "nsh/test";
import { type BackendOptions, createBackend, createDeviceBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface WorkbenchBackendOptions extends BackendOptions {
  subscriptions?: Array<Record<string, unknown>>;
  subscriptionQuotas?: Record<string, Record<string, unknown>>;
}

interface ExtendedHarness {
  handlers: Record<string, (data: unknown) => unknown>;
  fileWrites: Array<{ workspaceId?: string; workspacePath?: string; filePath: string; content: string }>;
  formStateWrites: Array<Record<string, unknown>>;
  configuredBots: Array<Record<string, unknown>>;
  startedConnections: Array<{ method: string; lan_ip: string | null }>;
  stoppedConnections: Array<string | null>;
  stopBotCount: () => number;
  weixinQrStarts: () => number;
  verboseWrites: boolean[];
  modelDiscoveryCalls: Array<Record<string, unknown>>;
  connectionTestCalls: Array<Record<string, unknown>>;
  savedModelLists: Array<Array<Record<string, unknown>>>;
}

function createWorkbenchBackend(
  options: WorkbenchBackendOptions = {},
  deviceMode = false,
): ExtendedHarness {
  const base = deviceMode ? createDeviceBackend(options) : createBackend(options);
  const originalInvoke = base.handlers["openbitfun.invoke"];

  const filesText: Record<string, string> = { ...(options.fileContent ?? {}) };
  const fileWrites: ExtendedHarness["fileWrites"] = [];
  const formStateWrites: Array<Record<string, unknown>> = [];
  const configuredBots: Array<Record<string, unknown>> = [];
  const startedConnections: Array<{ method: string; lan_ip: string | null }> = [];
  const stoppedConnections: Array<string | null> = [];
  const verboseWrites: boolean[] = [];
  const modelDiscoveryCalls: Array<Record<string, unknown>> = [];
  const connectionTestCalls: Array<Record<string, unknown>> = [];
  const savedModelLists: Array<Array<Record<string, unknown>>> = [];

  let stopBotCalls = 0;
  let weixinQrCalls = 0;
  let botVerbose = false;
  let botConnected: string | null = null;
  let formState: Record<string, unknown> = {
    telegram_bot_token: "",
    feishu_app_id: "",
    feishu_app_secret: "",
  };
  let lanConnected = false;
  let serverConnected = false;

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
          filesText[filePath] = content;
          fileWrites.push({
            workspaceId: typeof payload.workspaceId === "string" ? payload.workspaceId : undefined,
            workspacePath: typeof payload.workspacePath === "string" ? payload.workspacePath : undefined,
            filePath,
            content,
          });
          return { ok: true, value: null, transport: "dev" };
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
        case "get_subscription_account_quota": {
          const provider = String(payload.provider ?? "");
          const quota = options.subscriptionQuotas?.[provider] ?? null;
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
            value: {
              connections: [
                {
                  method: "lan",
                  relay_connected: lanConnected,
                  relay_url: lanConnected ? "http://192.168.1.42:8787/pair" : null,
                  clients: [],
                },
                {
                  method: "openbitfun_server",
                  relay_connected: serverConnected,
                  relay_url: serverConnected ? "https://relay.example/pair/dev-1" : null,
                  clients: [],
                },
              ],
              relay_connected: lanConnected || serverConnected,
              relay_url: serverConnected
                ? "https://relay.example/pair/dev-1"
                : lanConnected
                  ? "http://192.168.1.42:8787/pair"
                  : null,
              active_method: serverConnected ? "openbitfun_server" : lanConnected ? { lan: { ip: null } } : null,
              clients: [],
              bot_connected: botConnected,
              bot_verbose_mode: botVerbose,
            },
            transport: "dev",
          };
        }
        case "remote_connect_get_methods": {
          if (!hasRaw) throw new Error("remote_connect_get_methods takes no request wrapper");
          return {
            ok: true,
            value: [
              { id: "lan", name: "LAN", available: true, description: "Same local network" },
              {
                id: "openbitfun_server",
                name: "OpenBitFun Server",
                available: true,
                description: "Official OpenBitFun relay",
              },
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
          const lanIp = typeof payload.lan_ip === "string" ? payload.lan_ip : null;
          startedConnections.push({ method, lan_ip: lanIp });
          if (method === "bot_telegram") {
            botConnected = "Telegram(@openbitfun_bot)";
          } else if (method === "bot_feishu") {
            botConnected = "Feishu(cli_feishu_1)";
          } else if (method === "lan") {
            lanConnected = true;
          } else if (method === "openbitfun_server") {
            serverConnected = true;
          }
          return {
            ok: true,
            value: {
              method,
              qr_url:
                method === "lan"
                  ? "http://192.168.1.42:8787/pair"
                  : method === "openbitfun_server"
                    ? "https://relay.example/pair/dev-1"
                    : null,
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
          if (!method || method === "lan") lanConnected = false;
          if (!method || method === "openbitfun_server") serverConnected = false;
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
    fileWrites,
    formStateWrites,
    configuredBots,
    startedConnections,
    stoppedConnections,
    stopBotCount: () => stopBotCalls,
    weixinQrStarts: () => weixinQrCalls,
    verboseWrites,
    modelDiscoveryCalls,
    connectionTestCalls,
    savedModelLists,
  };
}

test("files scene edits code and markdown files, tracks open tabs, uses dropdown actions, and supports AuxPane compact mode", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Files");
  await app.waitFor("Explorer");
  await app.waitFor("workbench-switch-files");
  await app.waitFor("workbench-switch-terminal");
  await app.press("main.rs");
  await app.waitFor("fn main() {");
  await app.waitFor("file-tab-main.rs");

  // Begin live edit and verify toolbar swaps to Save file / Discard edit.
  await app.press("file-edit");
  await app.waitFor("Editing");
  await app.waitFor("Save file");
  await app.waitFor("Discard edit");

  // Discard cancels editing without calling write_file_content.
  await app.press("file-discard");
  await app.waitFor("Edit file");
  expect(backend.fileWrites).toHaveLength(0);

  // Edit again, type into the editor, and save.
  await app.press("file-edit");
  await app.waitFor("Save file");
  await app.type("file-editor", "// edited\n");
  await app.press("file-save");
  await app.waitFor("Saved main.rs");

  expect(backend.fileWrites).toHaveLength(1);
  expect(backend.fileWrites[0]).toMatchObject({
    workspaceId: "workspace-1",
    workspacePath: "/repo",
    filePath: "/repo/main.rs",
  });
  expect(backend.fileWrites[0].content).toContain("// edited");

  // Open second file, verify tab bar accumulates both tabs, and edit Markdown.
  await app.press("README.md");
  await app.waitFor("Markdown preview from the host.");
  await app.waitFor("file-tab-README.md");
  await app.press("file-edit");
  await app.waitFor("Save file");
  await app.press("file-save");
  await app.waitFor("Saved README.md");
  expect(backend.fileWrites).toHaveLength(2);

  // Close the first tab cleanly via its close IconButton.
  await app.press("close-file-tab-main.rs");
  expect(app.texts()).not.toContain("fn main() {");

  // File actions dropdown creates a new file and confirms delete.
  await app.press("file-actions-menu");
  await app.press("New file");
  await app.type("entry-name", "notes.txt");
  await app.press("Save");
  await app.waitFor("notes.txt");

  await app.press("file-actions-menu");
  await app.press("Delete");
  await app.waitFor("Confirm delete");
  await app.press("Confirm delete");

  // Sessions AuxPane mounts FilesScene in compact mode when toggled.
  await app.press("Sessions");
  await app.press("aux-pane-toggle");
  await app.waitFor("Explorer");
});

test("devices scene configures Telegram/Feishu bots, starts WeChat QR, and starts/stops relays via modals", async () => {
  const backend = createWorkbenchBackend({}, true);
  const app = await open("../App.tsx", {
    ...DESKTOP,
    host: { handlers: backend.handlers },
  });

  await app.press("Devices");
  await app.waitFor("Messaging Channels");
  await app.waitFor("No bot connected");

  // Open Telegram channel modal, configure & start, then close modal.
  await app.press("channel-toggle-telegram");
  await app.type("connector-telegram-token", "tg-bot-token-123");
  await app.press("connector-telegram-connect");
  await app.waitFor("Active bot: Telegram(@openbitfun_bot)");
  expect(backend.configuredBots.at(-1)).toMatchObject({
    bot_type: "telegram",
    bot_token: "tg-bot-token-123",
  });
  expect(backend.startedConnections).toContainEqual({ method: "bot_telegram", lan_ip: null });
  await app.press("Done");

  // Stop bot
  await app.press("connector-bot-stop");
  await app.waitFor("No bot connected");
  expect(backend.stopBotCount()).toBe(1);

  // Open Feishu channel modal, configure & start, then close modal.
  await app.press("channel-toggle-feishu");
  await app.type("connector-feishu-app-id", "cli_app_1");
  await app.type("connector-feishu-app-secret", "sec_feishu_1");
  await app.press("connector-feishu-connect");
  await app.waitFor("Active bot: Feishu(cli_feishu_1)");
  expect(backend.configuredBots.at(-1)).toMatchObject({
    bot_type: "feishu",
    app_id: "cli_app_1",
    app_secret: "sec_feishu_1",
  });
  expect(backend.startedConnections).toContainEqual({ method: "bot_feishu", lan_ip: null });
  await app.press("Done");

  // Open WeChat channel modal & start QR, then close modal.
  await app.press("channel-toggle-weixin");
  await app.press("connector-weixin-qr-start");
  await app.waitFor("text:https://weixin.example/qr/wx-qr-1");
  expect(backend.weixinQrStarts()).toBe(1);
  await app.press("Done");

  // Verbose bot mode toggle
  await app.press("connector-bot-verbose");
  expect(backend.verboseWrites).toEqual([true]);

  // Open LAN / Server Relay modal & start/stop relays
  await app.press("channel-toggle-relay");
  await app.type("connector-lan-ip", "192.168.1.42");
  await app.press("connector-lan-start");
  await app.waitFor("LAN active · Server idle");
  await app.waitFor("text:http://192.168.1.42:8787/pair");
  expect(backend.startedConnections).toContainEqual({ method: "lan", lan_ip: "192.168.1.42" });

  await app.press("connector-copy-url");
  expect(app.clipboard()).toBe("http://192.168.1.42:8787/pair");

  await app.press("connector-lan-stop");
  await app.waitFor("LAN relay stopped");
  await app.waitFor("Start LAN Relay");
  expect(backend.stoppedConnections).toContain("lan");

  // Server Relay start & stop
  await app.press("connector-server-start");
  await app.waitFor("LAN idle · Server active");
  expect(backend.startedConnections).toContainEqual({ method: "openbitfun_server", lan_ip: null });

  await app.press("connector-server-stop");
  await app.waitFor("OpenBitFun Server relay stopped");
  await app.waitFor("Start Server Relay");
  expect(backend.stoppedConnections).toContain("openbitfun_server");
  await app.press("Done");
});

test("devices scene marks connectors controller-local on peer, uses device dropdown & rename modal, and opens dispatch modal", async () => {
  const backend = createWorkbenchBackend(
    { onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }] },
    true,
  );
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Devices");
  await app.waitFor("builder");

  // Peer row overflow dropdown: rename modal sets a device alias.
  await app.press("device-actions-device-linux");
  await app.press("device-rename-device-linux");
  await app.waitFor("Rename Device");
  await app.type("device-alias", "gpu-box");
  await app.press("Save");
  await app.waitFor("gpu-box");

  // Open New Detached Dispatch Job modal and close it cleanly.
  await app.press("New job");
  await app.waitFor("New Detached Dispatch Job");
  await app.press("Cancel");

  // Driving a peer marks Messaging Channels controller-local.
  await app.press("device-use-device-linux");
  await app.waitFor("peer session on device-linux");

  await app.press("Devices");
  await app.waitFor("Controller local");
  expect(app.texts().join("\n")).toContain("Connectors manage this controller machine");
});

test("settings scene defaults to All sections and filters via NavPanel settings categories", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    colorScheme: "dark",
    host: { handlers: backend.handlers },
  });

  await app.press("Settings");
  await app.waitFor("All sections");
  await app.waitFor("Appearance");
  await app.waitFor("Showing the dark scheme");
  await app.waitFor("AI models");
  await app.waitFor("MCP servers");
  await app.waitFor("Usage");

  // Consumer settings never expose raw dotted config key paths in visible text.
  const allTexts = app.texts().join("\n");
  expect(allTexts).not.toContain("app.auto_update");
  expect(allTexts).not.toContain("app.telemetry");
  expect(allTexts).not.toContain("editor.font_size");
  expect(allTexts).not.toContain("memories.max_unused_days");

  // Filter to Models & Pools only via App.tsx NavPanel SettingsNavBlock.
  await app.press("nav-settings-cat-models");
  await app.waitFor("Model pools");
  expect(app.texts()).not.toContain("Showing the dark scheme");
  expect(app.texts()).not.toContain("MCP servers");
  expect(app.texts()).not.toContain("Log files");

  // Filter to MCP & Web Search only.
  await app.press("nav-settings-cat-mcp");
  await app.waitFor("MCP servers");
  await app.waitFor("Web search");
  expect(app.texts()).not.toContain("Model pools");

  // Switch back to All sections and verify sections return.
  await app.press("nav-settings-cat-all");
  await app.waitFor("Appearance");
  await app.waitFor("AI models");
  await app.waitFor("MCP servers");
  await app.waitFor("Log files");
});

test("settings scene resolves model URL preview, tests connections, discovers remote models, and caps batch max_tokens", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.press("Settings");
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

  await app.press("model-format-response");
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
    request_url: "https://proxy.example/v1/chat/completions",
    api_key: "sk-demo-key",
  });

  // Open Quick Add Models discovery modal and batch-add 2 models.
  await app.press("settings-model-select");
  await app.waitFor("Discover & add models");
  await app.waitFor("GPT-4.1");
  await app.waitFor("o3-mini");

  await app.press("model-discovery-option-o3-mini");
  await app.waitFor("2 selected");
  await app.press("model-discovery-confirm");
  await app.waitFor("Added 2 models");

  const savedBatch = backend.savedModelLists.at(-1) ?? [];
  const gpt41 = savedBatch.find(entry => entry.model_name === "gpt-4.1");
  const o3Mini = savedBatch.find(entry => entry.model_name === "o3-mini");
  // Safe 40% ceiling of context_window: 1,000,000 * 0.4 = 400,000; 200,000 * 0.4 = 80,000.
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
  await app.waitFor("AI subscriptions");
  await app.waitFor("OpenAI Codex");
  await app.waitFor("5h window · 72% left · resets 2h");

  // Select light preset directly from the 3×3 theme gallery.
  await app.press("appearance-swatch-openbitfun-monochrome");
  await app.waitFor("Showing the light scheme");

  // Switching scheme back to Dark updates resolved scheme cleanly.
  await app.press("appearance-dark");
  await app.waitFor("Showing the dark scheme");
});

test("terminal scene keeps theme canvas background in light scheme and manages shell SelectDropdown and profiles modal", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", {
    ...DESKTOP,
    colorScheme: "light",
    host: { handlers: backend.handlers },
  });

  await app.press("Terminal");
  await app.waitFor("workbench-switch-terminal");
  await app.waitFor("running");
  await app.waitFor("shell 1");

  // Select shell via SelectDropdown, then open Terminal Profiles modal.
  await app.press("shell-picker");
  await app.press("shell-option-default");
  await app.press("profiles-toggle");
  await app.waitFor("Terminal Profiles");
  await app.type("profile-name", " Watch");
  await app.type("profile-command", "pnpm test");
  await app.press("profile-save");
  await app.waitFor("Saved Terminal 1 Watch");
  await app.waitFor("Open Terminal 1 Watch");
  await app.waitFor("default shell · pnpm test");
});

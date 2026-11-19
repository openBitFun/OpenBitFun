// A simulated OpenBitFun desktop backend for the headless tests.
//
// The tests play the embedding host: they answer `openbitfun.invoke` exactly as
// `host.js` forwards it to Tauri, so the scenes, the transport and the request
// shapes are the production ones. What the tests replace is only the native
// process, which they cannot start here.

export interface BackendCall {
  action: string;
  request: unknown;
  raw: boolean;
}

export interface BackendOptions {
  sessions?: Array<{
    sessionId: string;
    sessionName: string;
    lastActiveAt?: number;
    lastUpdated?: number;
    messageCount?: number;
    status?: string;
    persistedStatus?: string;
    modelName?: string;
    agentType?: string;
  }>;
  files?: Array<{ name: string; path: string; isDirectory: boolean; children?: unknown[] }>;
  fileContent?: Record<string, string>;
  configs?: Record<string, unknown>;
  /** One job the controller's index already knows about. */
  dispatchJob?: Record<string, unknown>;
  /** The target's event log for that job, replayed page by page from a cursor. */
  dispatchEvents?: Array<Record<string, unknown>>;
  /** Events one `dispatch_status` page may carry; the target's own page limit. */
  dispatchPageSize?: number;
  /** Permissions the target is waiting on while the job is not terminal. */
  dispatchPermissions?: Array<Record<string, unknown>>;
  /** The state reported before any `jobState` event has been replayed. */
  dispatchState?: string;
  /** The usage dashboard's answer; `null` means this host does not offer it. */
  usage?: Record<string, unknown> | null;
  /**
   * The answer to the fixed six-month activity read. `null` means the host takes
   * the range read and refuses this one, which must cost only the heatmap.
   */
  usageActivity?: Record<string, unknown> | null;
  /** The ACP client list; `null` means this host has no ACP commands. */
  acpClients?: Array<Record<string, unknown>> | null;
  /** What the requirement probe answers. */
  acpProbes?: Array<Record<string, unknown>>;
  /** Config paths the host refuses to read, as an older file would. */
  absentConfigs?: string[];
  devices?: Array<Record<string, unknown>>;
  onlineDevices?: Array<Record<string, unknown>>;
  /** The host answers `manage_dialog_queue`; without it the surface keeps its own list. */
  hostQueue?: boolean;
  /**
   * Whether that host advertises `supportsReorder`; `null` omits the field, which
   * is what a build predating reorder answers.
   */
  hostQueueReorder?: boolean | null;
  /** Rows the fixture host reports as held back, by turn id, with the reason. */
  hostQueueBlocked?: Record<string, string>;
  /** What a peer advertises in `peer_mode_ping`; the default is a desktop with a queue. */
  peerCapabilities?: Record<string, boolean>;
  /** The host answers `get_web_search_credential_status` with this. */
  searchCredentialConfigured?: boolean;
  /** What `get_runtime_logging_info` answers; `null` means the host has no such command. */
  runtimeLogging?: Record<string, unknown> | null;
  /** Questions the session mailbox reports as still waiting; `null` means no such command. */
  pendingQuestions?: Array<Record<string, unknown>> | null;
  /** Whether the vault starts with a decision-model key stored. */
  decisionKeyConfigured?: boolean;
  /** The agent catalogue; `null` means this host has no `get_available_modes`. */
  agentModes?: Array<Record<string, unknown>> | null;
  /** `false` makes the host refuse `search_files`, as a build without it would. */
  fileSearch?: boolean;
  /**
   * The `font` document the host stores; `null` means it stores none, which is
   * what a fresh install answers. Absent means the default (14 px).
   */
  fontPreference?: Record<string, unknown> | null;
  /**
   * The answer to `get_local_models_dev_catalogs`; `null` means this host does not
   * offer the command, which is what a build predating the picker answers.
   */
  modelCatalog?: Record<string, unknown> | null;
  /**
   * The host's message hits; `null` means this host has no
   * `search_session_content`, which the search field has to survive.
   */
  sessionSearch?: Array<Record<string, unknown>> | null;
  /**
   * The reasoning setting `get_session_model_target` reports for a session.
   * `undefined` (the default) makes the fixture omit the field, which is how a
   * host older than it answers.
   */
  sessionReasoningPreset?: string | null;
  /**
   * The answer to `project_ai_model_reasoning_catalog`; `null` means this host
   * does not offer the command, and the composer then draws no reasoning control.
   */
  reasoningCatalog?: Record<string, unknown> | null;
}

interface HostQueueRow {
  sessionId: string;
  turnId: string;
  content: string;
  status: string;
}

export interface Backend {
  calls: BackendCall[];
  actions(): string[];
  /** Every `set_config` request, in order. */
  settingsWrites: Array<{ path: string; value: unknown }>;
  /** Every `save_web_search_credential` request, in order. */
  credentialWrites: Array<{ provider: string; secret: string }>;
  /** Every provider whose key a `clear_web_search_credential` removed. */
  clearedCredentials: string[];
  /** Every decision-model key the vault was asked to store, in order. */
  decisionKeyWrites: string[];
  /** How many times the decision-model key was removed. */
  decisionKeyClears: () => number;
  /** Every `save_mcp_json_config` request, in order. */
  mcpSaves: Array<{ jsonConfig: string; expectedFingerprint: string }>;
  /** The MCP document the host currently stores, parsed. */
  mcpDocument: () => unknown;
  /** Makes the next save carry a stale fingerprint, as a concurrent edit would. */
  changeMcpDocumentElsewhere: () => void;
  /** Moves the remote OAuth session this host reports, as the flow does. */
  setMcpOAuthSession: (session: Record<string, unknown> | null) => void;
  /** Every `update_mcp_remote_auth` value the host accepted, in order. */
  mcpAuthWrites: Array<{ serverId: string; authorizationValue: string }>;
  /** Every server id a `clear_mcp_remote_auth` cleared, in order. */
  mcpAuthClears: string[];
  /** The last `dispatch_submit` request, or `null`. */
  submittedDispatch: () => unknown;
  /** Every job id a `dispatch_cancel` named, in order. */
  cancelledJobs: string[];
  /** Every `dispatch_answer` request, in order. */
  dispatchAnswers: Array<{ jobId: string; requestId: string; reply: string }>;
  /** Every `dispatch_append` request, in order. */
  dispatchAppends: Array<{ jobId: string; content: string }>;
  /** Every `dispatch_continue` request, in order. */
  dispatchContinues: Array<{ jobId: string; turnId: string; prompt: string }>;
  /** Every job id a `dispatch_sync_result` named, in order. */
  dispatchSyncs: string[];
  /** Every `get_token_usage_statistics` request, in order. */
  usageRequests: Array<Record<string, unknown>>;
  /** Every `update_session_mode` request the host accepted, in order. */
  sessionModeWrites: Array<{ sessionId: string; modeId: string; workspaceId?: string }>;
  /** Every `save_acp_json_config` payload, in order. */
  acpSaves: string[];
  /** Every `install_acp_client_cli` client id, in order. */
  acpInstalls: string[];
  /** Every path a `reveal_in_explorer` asked to show, in order. */
  reveals: string[];
  /** Every `start_user_question_interaction` request, in order. */
  questionStarts: Array<{ sessionId: string; toolId: string }>;
  /** Every `submit_user_answers` request, in order. */
  userAnswers: Array<{ toolId: string; answers: Record<string, unknown>; sessionId: string }>;
  /** Every command a Device RPC envelope carried, with its arguments. */
  peerInvocations: Array<{ action: string; args: Record<string, unknown> }>;
  /** Every `manage_dialog_queue` reorder the host accepted, in order. */
  queueReorders: Array<{ turnId: string; beforeTurnId: string | null; expectedRevision: number }>;
  handlers: Record<string, (data: unknown) => unknown>;
}

const DEFAULT_RUNTIME_LOGGING = {
  effectiveLevel: "info",
  sessionLogDir: "/tmp/openbitfun/logs/session-1",
  earlyStartupLogPath: "/tmp/openbitfun/logs/session-1/early.log",
  appLogPath: "/tmp/openbitfun/logs/session-1/app.log",
  flowChatLogPath: "/tmp/openbitfun/logs/session-1/flow-chat.log",
  previousUnexpectedExit: null,
};

const DEFAULT_ACP_CLIENTS = [
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp"],
    enabled: true,
    readonly: false,
    status: "running",
    permissionMode: "ask",
    toolName: "run_opencode_agent",
    sessionCount: 2,
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "npx",
    args: ["--yes", "@agentclientprotocol/codex-acp@latest"],
    enabled: false,
    readonly: false,
    status: "stopped",
    permissionMode: "ask",
    toolName: "run_codex_agent",
    sessionCount: 0,
  },
];

const DEFAULT_ACP_PROBES = [
  {
    id: "opencode",
    tool: { name: "opencode", installed: true, version: "0.9.1", path: "/usr/local/bin/opencode" },
    adapter: { name: "adapter", installed: true, version: "1.2.0", path: "/tmp/adapter" },
    runnable: true,
    notes: [],
  },
  {
    id: "codex",
    tool: { name: "npx", installed: true, version: "10.2.0", path: "/usr/local/bin/npx" },
    adapter: { name: "codex-acp", installed: false, error: "not installed" },
    runnable: false,
    notes: ["The codex-acp adapter is not installed"],
  },
];

export const DEFAULT_USAGE = {
  totalRequests: 42,
  unknownUsageRequests: 1,
  failedRequests: 2,
  totalTokens: 120_000,
  totalInputTokens: 90_000,
  totalOutputTokens: 30_000,
  totalCachedTokens: 40_000,
  totalCacheWriteTokens: 5_000,
  totalCacheReportedInputTokens: 80_000,
  byModel: [
    { key: "m-primary", name: "primary-large", providerName: "openai", requests: 30, tokens: 100_000, cacheHitRate: 0.5 },
    { key: "m-small", name: "small-model", providerName: null, requests: 12, tokens: 20_000, cacheHitRate: null },
  ],
  byGroup: [],
  byEndpoint: [],
  trend: [
    { bucket: "2026-01-01T00:00:00Z", inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 100 },
    { bucket: "2026-01-02T00:00:00Z", inputTokens: 2_000, outputTokens: 700, cacheReadTokens: 200 },
  ],
  granularity: "day",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The answer to the fixed six-month activity read: two busy days inside any
 * window and one bucket far outside it, so a projection that forgets the window
 * shows the wrong total.
 */
const DEFAULT_ACTIVITY = {
  ...DEFAULT_USAGE,
  totalTokens: 4_000,
  trend: [
    { bucket: new Date(Date.now() - 3 * DAY_MS).toISOString(), inputTokens: 1_000, outputTokens: 500 },
    { bucket: new Date(Date.now() - 2 * DAY_MS).toISOString(), inputTokens: 2_000, outputTokens: 500 },
    { bucket: "2020-01-01T00:00:00Z", inputTokens: 100_000, outputTokens: 0 },
  ],
  granularity: "day",
};

const DEFAULT_SESSIONS = [
  {
    sessionId: "session-1",
    sessionName: "NSH skeleton",
    lastUpdated: 1763000000000,
    messageCount: 4,
    agentType: "Standard",
  },
  {
    sessionId: "session-2",
    sessionName: "Terminal migration",
    lastUpdated: 1762900000000,
    messageCount: 9,
    modelName: "session-only-model",
  },
  {
    sessionId: "session-3",
    sessionName: "Old experiment",
    lastUpdated: 1762800000000,
    messageCount: 2,
    persistedStatus: "archived",
  },
];

/**
 * The agent catalogue: the four execution profiles the harness control draws,
 * then the agents this workspace can run, one of them external.
 */
const DEFAULT_AGENT_MODES = [
  { id: "Minimal", name: "Minimal", description: "Read-mostly edits with the smallest tool set." },
  { id: "Standard", name: "Standard", description: "The default profile." },
  { id: "Ultimate", name: "Ultimate", description: "The widest tool set, for long tasks." },
  { id: "Creative", name: "Creative", description: "Explores alternatives before editing." },
  { id: "DeepResearch", name: "Deep research", description: "Builds a report from several sources." },
  { id: "opencode", name: "OpenCode", description: "A configured external agent.", source: "external" },
  // An agent the host resolves but the desktop never switches a session to.
  { id: "Claw", name: "Claw", description: "Runs in assistant workspaces." },
];

const DEFAULT_FILES = [
  {
    name: "docs",
    path: "/repo/docs",
    isDirectory: true,
    children: [{ name: "guide.md", path: "/repo/docs/guide.md", isDirectory: false }],
  },
  { name: "README.md", path: "/repo/README.md", isDirectory: false },
  { name: "main.rs", path: "/repo/main.rs", isDirectory: false },
  { name: "logo.png", path: "/repo/logo.png", isDirectory: false },
  { name: "demo.mp4", path: "/repo/demo.mp4", isDirectory: false },
  { name: "huge.mp4", path: "/repo/huge.mp4", isDirectory: false, size: 48 * 1024 * 1024 },
];

const DEFAULT_CONTENT: Record<string, string> = {
  "/repo/README.md": "# Project\n\nMarkdown preview from the host.",
  "/repo/docs/guide.md": "# Guide\n\nSecond document.",
  "/repo/main.rs": "fn main() {\n    println!(\"hello\");\n}\n",
  // Media is read as base64, the way the host serves bytes to a preview.
  "/repo/logo.png": "iVBORw0KGgoAAAANSUhEUg==",
  "/repo/demo.mp4": "AAAAIGZ0eXBpc29t",
};

const DEFAULT_CONFIGS: Record<string, unknown> = {
  editor: { font_size: 14, tab_size: 4, word_wrap: "off", line_numbers: "on", minimap: { enabled: true } },
  terminal: { font_size: 14, scrollback: 1000, cursor_style: "block" },
  "app.logging.level": "info",
  "app.close_button_behavior": "minimize_to_tray",
  "app.notifications.dialog_completion_notify": true,
  "app.notifications.permission_request_notify": false,
  app: {
    language: "en-US",
    auto_update: true,
    telemetry: false,
    confirm_on_exit: true,
    restore_windows: true,
    // Two keys the user remapped; this front end shows the count, not an editor.
    keybindings: { "tab.close": "Mod+W", "session.new": "Mod+N" },
  },
  "app.ai_experience": {
    enable_session_title_generation: true,
    enable_workspace_search: false,
    quick_actions: [
      { id: "commit", label: "Commit", prompt: "Commit all current code changes", enabled: true },
      { id: "create_pr", label: "Create PR", prompt: "Create a Pull Request", enabled: false },
    ],
  },
  // A policy that asks the user, with one allow rule and a chat approval model.
  tool_permissions: {    policy: {
      preset: "ask",
      rules: [{ action: "run_command", resource: "git status", effect: "allow" }],
    },
    interaction: { auto_approve_ask: false },
    approval: {
      strategy: "interactive",
      model_kind: "chat",
      chat_model_id: "",
      timeout_ms: 30000,
      on_ask: "user",
      on_error: "ask",
    },
  },
  "memories.generate_memories": true,
  "memories.use_memories": true,
  "memories.generate_for_btw_sessions": false,
  "memories.external_context_policy": "clear_tool_results",
  "memories.max_unused_days": 30,
  "memories.max_raw_memories_for_consolidation": 64,
  // The document the memory fields that live in an object are read from, so a
  // write patches the same shape the host stores.
  memories: {
    generate_memories: true,
    generate_for_btw_sessions: false,
    use_memories: true,
    external_context_policy: "clear_tool_results",
    max_raw_memories_for_consolidation: 64,
    max_unused_days: 30,
    max_rollout_age_days: 10,
    max_rollouts_per_startup: 5,
    max_rollouts_scan_limit: 2000,
    min_rollout_idle_hours: 6,
    phase1_max_concurrency: 1,
    extract_model: null,
    consolidation_model: null,
  },
  "app.prevent_sleep": false,
  "app.logging.include_sensitive_diagnostics": false,
  "app.hooks.enabled": true,
  "app.hooks.project_hooks_enabled": false,
  "ai.computer_use_enabled": true,
  "ai.browser_control_auto_connect_on_startup": false,
  "ai.browser_control_preferred_browser": "",
  "app.flow_chat.show_permission_mode_control": true,
  "app.flow_chat.auto_show_selection_toolbar": true,
  "app.flow_chat.send_during_turn": "immediate",
  "app.ai_experience.voice_input.enabled": true,
  "app.ai_experience.voice_input.default_language": "auto",
  "app.ai_experience.voice_input.max_recording_seconds": 60,
  "app.ai_experience.voice_input.microphone_device_id": "",
  "app.worktrees.rootPath": "~/.openbitfun/worktrees",
  "app.worktrees.branchPrefix": "openbitfun/",
  "app.worktrees.copyLocalChanges": false,
  "app.worktrees.autoDeleteEnabled": true,
  "app.worktrees.autoDeleteLimit": 15,
  // The document the desktop page writes whole; an unknown provider field is kept.
  "ai.web_search": {
    provider: "exa_search_api",
    providers: {
      exa_search_api: { credentialId: "exa-search-api" },
      tavily: { credentialId: "tavily-search-api" },
      deepseek: { credentialId: "deepseek-search-api" },
      keenable: { credentialId: "keenable-search-api" },
      openbitfun_search_http: {
        endpoint: "",
        auth: { mode: "none", credentialId: "openbitfun-search-http", headerName: "" },
      },
    },
  },
  "ai.enable_deferred_tool_loading": true,
  "ai.subagent_max_concurrency": 4,
  "ai.subagent_batch_execution_policy": "force_parallel",
  "ai.tool_presentation_mode": "native",
  // The serde shape of `TaskModelSelection`: a unit variant, and a struct one.
  "ai.task_models": {
    session_title: { Fixed: { model_id: "model-1" } },
    git_commit: "Inherit",
  },
  "ai.models": [
    {
      id: "model-1",
      name: "Configured model",
      provider: "openai",
      model_name: "gpt-4.1-mini",
      base_url: "https://api.openai.com/v1",
      request_url: "https://api.openai.com/v1/chat/completions",
      api_key: "sk-configured",
      enabled: true,
      category: "general_chat",
      capabilities: ["text_chat"],
    },
  ],
  // The default roles automatic approval offers before any concrete model id.
  "ai.default_models": { primary: "model-1" },
  "ai.decision_model": { model_name: "jev-latest", endpoint: "https://api.typesafe.ai/v1/systemone" },
};

const DEFAULT_MODEL_CATALOG = {
  provider_catalog: {
    revision: "fixture-1",
    source: "bundle",
    providers: [
      {
        id: "anthropic",
        name: "Anthropic",
        description: "Claude models",
        requires_api_key: true,
        endpoints: [
          {
            id: "anthropic-default",
            base_url: "https://api.anthropic.com/v1",
            api_format: "anthropic",
            label: "Anthropic",
            is_default: true,
            trusted_for_auto_detection: true,
          },
        ],
        models: [
          {
            id: "claude-sonnet-4",
            display_name: "Claude Sonnet 4",
            recommended: true,
            limits: { context: 200_000, output: 8_000 },
            capabilities: { chat: true, tool_call: true, reasoning: true, attachment: true },
          },
          {
            // A model the catalog knows but gives no limits, so the picker must
            // leave the form's limit fields alone instead of writing zeroes.
            id: "claude-haiku-4",
            display_name: "Claude Haiku 4",
            recommended: false,
            capabilities: { chat: true, tool_call: true, reasoning: false, attachment: false },
          },
        ],
      },
      {
        id: "moonshot",
        name: "Moonshot",
        description: "Kimi models",
        requires_api_key: true,
        endpoints: [
          {
            id: "moonshot-default",
            base_url: "https://api.moonshot.cn/v1",
            api_format: "openai",
            label: "Moonshot",
            is_default: true,
            trusted_for_auto_detection: true,
          },
        ],
        models: [
          {
            id: "kimi-k2",
            display_name: "Kimi K2",
            recommended: true,
            limits: { context: 128_000, output: 4_000 },
            capabilities: { chat: true, tool_call: true, reasoning: true, attachment: false },
          },
        ],
      },
    ],
  },
};

/** The presets a model's provider compiles its reasoning into, as the host reports them. */
const DEFAULT_REASONING_CATALOG = {
  status: "known",
  default_preset: "low",
  presets: [
    { id: "low", label: "Low", order: 0, actions: [{ type: "effort", value: "low" }], source: "models_dev" },
    { id: "high", label: "High", order: 1, actions: [{ type: "effort", value: "high" }], source: "models_dev" },
  ],
};

/** What the host's message search answers before a query narrows it. */
const DEFAULT_SESSION_HITS = [
  {
    kind: "message",
    matchedField: "content",
    sessionId: "session-2",
    sessionTitle: "Terminal migration",
    turnId: "turn-1",
    snippet: "Terminal is wired to terminal_create.",
    archived: false,
    updatedAtMs: 1762900000000,
    score: 2,
  },
  {
    kind: "message",
    matchedField: "content",
    sessionId: "session-1",
    sessionTitle: "NSH skeleton",
    turnId: "turn-2",
    snippet: "Planned, then edited the imports.",
    archived: false,
    updatedAtMs: 1763000000000,
    score: 1,
  },
];

const TURNS: Record<string, unknown[]> = {
  "session-1": [
    {
      id: "turn-1",
      userMessage: { id: "user-1", content: "Port the session list." },
      modelRounds: [
        {
          assistantMessage: {
            id: "a-1",
            content: "Rendered with a virtualized list.",
            toolCalls: [{ toolName: "read_file", arguments: { path: "src/web-ui/src/app/NavPanel.tsx" } }],
          },
        },
      ],
    },
    {
      id: "turn-2",
      userMessage: { id: "user-2", content: "Add the plan and fix the imports." },
      modelRounds: [
        {
          assistantMessage: {
            id: "a-2",
            content: "Planned, then edited.",
            toolCalls: [
              {
                toolName: "todo_write",
                arguments: {
                  todos: [
                    { content: "Read the panel", status: "completed" },
                    { content: "Move the list", status: "in_progress" },
                    { content: "Delete the old table", status: "pending" },
                  ],
                },
              },
              {
                toolName: "edit",
                arguments: {
                  file_path: "/repo/main.rs",
                  old_string: "fn main() {\n    println!(\"hello\");\n}",
                  new_string: "fn main() {\n    println!(\"hello, cards\");\n}",
                },
              },
            ],
          },
        },
      ],
    },
  ],
  "session-2": [
    {
      id: "turn-1",
      userMessage: { id: "user-1", content: "Port the terminal." },
      modelRounds: [{ assistantMessage: { id: "a-1", content: "Terminal is wired to terminal_create." } }],
    },
    {
      // A reply as a model writes one: a heading, inline code and emphasis, a
      // fenced block and a link, which the transcript shows as Markdown.
      id: "turn-2",
      userMessage: { id: "user-2", content: "Show the plan." },
      modelRounds: [
        {
          // The reasoning a model streamed beside its answer is stored with it.
          thinkingItems: [
            {
              id: "think-1",
              content: "Weigh the two options before writing anything.",
              reasoningKind: "reasoning",
              isStreaming: false,
              isCollapsed: true,
              timestamp: 1,
            },
          ],
          assistantMessage: {
            id: "a-2",
            content:
              "## Plan\n\nRun `pnpm run check` first, then **fix** the rest.\n\n```rust\nlet rows = load();\n```\n\nSee [the docs](https://example.com/docs) for more.",
          },
        },
      ],
    },
  ],
};

interface VirtualEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

function parentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}

function entryName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/**
 * A mutable directory map the file commands act on, so a create, rename or
 * delete in a test changes what the next `explorer_get_children` returns the way
 * the host would.
 */
function buildVirtualFs(
  root: string,
  files: Array<{ name: string; path: string; isDirectory: boolean; size?: number; children?: unknown[] }>,
) {
  const byDirectory = new Map<string, VirtualEntry[]>();
  const put = (directory: string, entry: VirtualEntry) => {
    const list = byDirectory.get(directory) ?? [];
    if (!list.some(item => item.path === entry.path)) list.push(entry);
    byDirectory.set(directory, list);
  };
  const walk = (
    directory: string,
    children: Array<{ name: string; path: string; isDirectory: boolean; size?: number; children?: unknown[] }>,
  ) => {
    for (const child of children ?? []) {
      put(directory, {
        name: child.name || entryName(child.path),
        path: child.path,
        isDirectory: Boolean(child.isDirectory),
        // A listing carries the size, so a preview can decide before reading bytes.
        ...(typeof child.size === "number" ? { size: child.size } : {}),
      });
      if (child.isDirectory) {
        byDirectory.set(child.path, byDirectory.get(child.path) ?? []);
        walk(
          child.path,
          (child.children ?? []) as Array<{
            name: string;
            path: string;
            isDirectory: boolean;
            size?: number;
            children?: unknown[];
          }>,
        );
      }
    }
  };
  byDirectory.set(root, []);
  walk(root, files);
  return byDirectory;
}

/**
 * Answers a Peer Device Mode HostInvoke envelope the way a target host does:
 * the handshake first, then whatever command the controller routes. The peer's
 * own workspace and session names are deliberately unlike the local fixtures, so
 * a test can tell which machine answered.
 */
function answerPeerHostInvoke(
  targetDeviceId: string,
  command: { cmd?: string; command?: string; args?: Record<string, unknown> },
  capabilities: Record<string, boolean> = { dialog_queue_v1: true, cancel_tool: true },
  record?: (action: string, args: Record<string, unknown>) => void,
): string {
  const action = command?.command ?? "";
  const args = (command?.args ?? {}) as Record<string, unknown>;
  // A peer host reads `request` when it exists and the top-level object otherwise,
  // which is how a positional command arrives here.
  const request = (args.request ?? args) as Record<string, unknown>;
  record?.(action, args);
  const envelope = (value: unknown) =>
    JSON.stringify({ resp: "host_invoke_result", ok: true, value });
  switch (action) {
    case "peer_mode_ping":
      return envelope({
        host_type: "desktop",
        host_ui_ready: true,
        capabilities,
      });
    case "peer_control_attach":
    case "peer_control_detach":
      return envelope(null);
    case "get_opened_workspaces":
    case "get_recent_workspaces":
      return envelope([
        {
          id: `${targetDeviceId}-workspace`,
          name: `peer workspace on ${targetDeviceId}`,
          rootPath: "/srv/peer",
          workspaceKind: "local",
        },
      ]);
    case "list_persisted_sessions_page":
      return envelope({
        sessions: [
          {
            sessionId: `${targetDeviceId}-session`,
            sessionName: `peer session on ${targetDeviceId}`,
            lastUpdated: 1763200000000,
            messageCount: 1,
            workspaceId: `${targetDeviceId}-workspace`,
          },
        ],
        totalTopLevelCount: 1,
        loadedTopLevelCount: 1,
        hasMore: false,
      });
    case "load_session_turns":
      return envelope([
        {
          id: `${targetDeviceId}-turn`,
          turnId: `${targetDeviceId}-turn`,
          userMessage: { id: "peer-user", content: `question asked on ${targetDeviceId}` },
          modelRounds: [
            { assistantMessage: { id: "peer-assistant", content: `answer from ${targetDeviceId}` } },
          ],
        },
      ]);
    case "explorer_get_children":
      return envelope([{ name: "peer.txt", path: "/srv/peer/peer.txt", isDirectory: false }]);
    case "get_available_modes":
      // The peer's own catalogue: a profile the local host also has, and one only
      // it resolves, so a test can tell whose agents the composer is showing.
      return envelope([
        { id: "Standard", name: "Standard", description: "The default profile." },
        { id: "peer-agent", name: `peer agent on ${targetDeviceId}`, description: "Runs on the peer." },
      ]);
    case "get_session_interaction_mailbox":
      // The peer owns the mailbox of the session it runs.
      return envelope({
        sessionId: String(request.sessionId ?? ""),
        userQuestions: { revision: 1, questions: [] },
        permissions: { requests: [] },
      });
    case "start_user_question_interaction":
    case "submit_user_answers":
      // Positional on the peer too; `request` above already fell back to `args`.
      return envelope(null);
    default:
      return JSON.stringify({
        resp: "host_invoke_result",
        ok: false,
        error: `${targetDeviceId} does not implement ${action}`,
      });
  }
}

export function createBackend(options: BackendOptions = {}): Backend {
  const calls: BackendCall[] = [];
  // Sessions carry their agent binding, so a switch shows up in the next read the
  // way the host reports it.
  let sessions: Array<Record<string, unknown>> = options.sessions ?? DEFAULT_SESSIONS;
  const files = options.files ?? DEFAULT_FILES;
  const content = options.fileContent ?? DEFAULT_CONTENT;
  const fs = buildVirtualFs("/repo", files);
  const settingsWrites: Array<{ path: string; value: unknown }> = [];
  const initialAppConfig = (options.configs ?? DEFAULT_CONFIGS).app;
  let currentLanguage =
    initialAppConfig &&
    typeof initialAppConfig === "object" &&
    typeof (initialAppConfig as Record<string, unknown>).language === "string"
      ? String((initialAppConfig as Record<string, unknown>).language)
      : "en-US";
  // The web-search key lives in the vault, not in the config: the fixture keeps
  // the two apart so a test can see which command a secret travelled in.
  const credentialWrites: Array<{ provider: string; secret: string }> = [];
  let decisionKeyConfigured = options.decisionKeyConfigured === true;
  const decisionKeyWrites: string[] = [];
  let decisionKeyCleared = 0;
  const clearedCredentials: string[] = [];
  let credentialConfigured = options.searchCredentialConfigured ?? false;
  let submitted: unknown = null;
  const cancelledJobs: string[] = [];
  const dispatchAnswers: Array<{ jobId: string; requestId: string; reply: string }> = [];
  const dispatchAppends: Array<{ jobId: string; content: string }> = [];
  const dispatchContinues: Array<{ jobId: string; turnId: string; prompt: string }> = [];
  const dispatchSyncs: string[] = [];
  const usageRequests: Array<Record<string, unknown>> = [];
  const sessionModeWrites: Array<{ sessionId: string; modeId: string; workspaceId?: string }> = [];
  const acpSaves: string[] = [];
  const acpInstalls: string[] = [];
  const reveals: string[] = [];
  // The log folder the fixture host reports, and how it ends its run.
  const runtimeLogging = options.runtimeLogging === undefined ? DEFAULT_RUNTIME_LOGGING : options.runtimeLogging;
  // Blocking user questions: the mailbox answer, and everything this surface sent.
  let pendingQuestions = options.pendingQuestions === undefined ? [] : options.pendingQuestions;
  const questionStarts: Array<{ sessionId: string; toolId: string }> = [];
  const userAnswers: Array<{ toolId: string; answers: Record<string, unknown>; sessionId: string }> = [];
  // Everything sent inside a Device RPC envelope, with the arguments as the peer
  // received them: the shape a positional command must not get wrong.
  const peerInvocations: Array<{ action: string; args: Record<string, unknown> }> = [];
  let acpJsonText = '{\n  "acpClients": {}\n}';
  let acpRows = [...(options.acpClients ?? DEFAULT_ACP_CLIENTS)];
  let terminalCount = 0;
  // The host holds queued messages; the fixture keeps the same shape so the
  // surface's list is the host's answer rather than its own bookkeeping.
  const hostQueue: HostQueueRow[] = [];
  // Every mutation bumps the revision, so a reorder that names a stale one is
  // refused here exactly as the runtime refuses it.
  let queueRevision = 0;
  const queueReorders: Array<{ turnId: string; beforeTurnId: string | null; expectedRevision: number }> = [];
  // Model pools belong to the host too: `save_model_pool` with an empty id is how
  // a new one is created, and the host allocates the id it returns.
  const poolRows: Array<{ id: string; name: string; strategy: string; member_model_ids: string[] }> = [];
  let poolSeq = 1;
  // A session's reasoning setting is host state, written together with its model.
  // `null` is the model's own default, and `undefined` is a host too old to report
  // the field at all.
  let sessionReasoningPreset: string | null | undefined = options.sessionReasoningPreset;
  const reasoningCatalogFixture =
    options.reasoningCatalog === undefined ? undefined : options.reasoningCatalog;

  /** The host's own models.dev projection; `null` makes the command absent. */
  const modelCatalogFixture =
    options.modelCatalog === undefined ? DEFAULT_MODEL_CATALOG : options.modelCatalog;

  function poolDocument(): unknown {
    return { version: 1, pools: poolRows.map(row => ({ ...row, member_model_ids: [...row.member_model_ids] })) };
  }

  function answerPools(action: string, request: unknown): unknown {
    const payload = (request ?? {}) as {
      pool?: { id?: string; name?: string; strategy?: string; member_model_ids?: string[] };
      poolId?: string;
    };
    switch (action) {
      case "get_model_pools":
        return poolDocument();
      case "save_model_pool": {
        const pool = payload.pool ?? {};
        const members = Array.isArray(pool.member_model_ids) ? pool.member_model_ids : [];
        const existing = poolRows.find(row => row.id === pool.id);
        if (existing) {
          existing.name = String(pool.name ?? existing.name);
          existing.strategy = String(pool.strategy ?? existing.strategy);
          existing.member_model_ids = members;
        } else {
          poolRows.push({
            id: `pool-${poolSeq++}`,
            name: String(pool.name ?? "Pool"),
            strategy: String(pool.strategy ?? "ordered"),
            member_model_ids: members,
          });
        }
        return poolDocument();
      }
      case "delete_model_pool": {
        const index = poolRows.findIndex(row => row.id === payload.poolId);
        if (index >= 0) poolRows.splice(index, 1);
        return poolDocument();
      }
      case "get_model_pool_status":
        return (poolRows.find(row => row.id === payload.poolId)?.member_model_ids ?? []).map(modelId => ({
          modelId,
          status: modelId === "model-1" ? "cooling_down" : "available",
          ...(modelId === "model-1" ? { reason: "rate limited" } : {}),
        }));
      default:
        return poolDocument();
    }
  }

  function unsupported(action: string): never {
    throw new Error(`${action} is not available on this host`);
  }
  // MCP: the runtime list, the stored document and its fingerprint all live on the
  // host and move together, so a test can see which command changed what. The
  // document keeps a field no form draws, which a configuration write must not drop.
  const mcpRows: Array<Record<string, unknown>> = [
    {
      id: "fs-server",
      name: "Filesystem",
      status: "Connected",
      transport: "stdio",
      enabled: true,
      autoStart: true,
      command: "npx",
      commandAvailable: true,
      startSupported: true,
    },
    {
      id: "remote-docs",
      name: "Docs",
      status: "Stopped",
      transport: "streamable-http",
      enabled: false,
      autoStart: false,
      url: "https://docs.example/mcp",
      startSupported: true,
      statusMessage: "not started yet",
      oauthEnabled: true,
      authConfigured: false,
    },
  ];
  let mcpDocumentText = JSON.stringify(
    {
      mcpServers: {
        "fs-server": {
          command: "npx",
          args: ["-y", "fs-mcp"],
          enabled: true,
          autoStart: true,
          transport: "stdio",
          keepMe: "unknown field",
        },
        "remote-docs": {
          url: "https://docs.example/mcp",
          transport: "streamable-http",
          enabled: false,
          oauthEnabled: true,
        },
      },
    },
    null,
    2,
  );
  let mcpFingerprint = 1;
  const mcpSaves: Array<{ jsonConfig: string; expectedFingerprint: string }> = [];
  // The remote OAuth session the host holds for one server, and what the
  // authorization writes did. A test moves the session with `setMcpOAuthSession`.
  let mcpOAuthSession: Record<string, unknown> | null = null;
  const mcpAuthWrites: Array<{ serverId: string; authorizationValue: string }> = [];
  const mcpAuthClears: string[] = [];
  // The resources one connected server publishes; the browser reads them per URI.
  const mcpResourceRows = [
    {
      uri: "memo://notes",
      name: "Notes",
      title: "Team notes",
      description: "Weekly notes",
      mimeType: "text/markdown",
    },
    { uri: "memo://config", name: "Config", mimeType: "application/json" },
    { uri: "memo://logo", name: "Logo", mimeType: "image/png" },
  ];

  function mcpRow(id: string): Record<string, unknown> | undefined {
    return mcpRows.find(row => row.id === id);
  }

  function mcpStatusOf(id: string): string {
    return String(mcpRows.find(row => row.id === id)?.status ?? "Stopped");
  }
  function mcpSetStatus(id: string, status: string): void {
    const row = mcpRows.find(entry => entry.id === id);
    if (row) row.status = status;
  }

  function answerMcp(action: string, request: unknown, positional: boolean): unknown {
    const body = (request ?? {}) as {
      serverId?: string;
      jsonConfig?: string;
      expectedFingerprint?: string;
      authorizationValue?: string;
      resourceUri?: string;
    };
    // The simulated host rejects a call whose argument shape does not match the
    // command's real signature, the way Tauri does.
    const positionalCommands = new Set([
      "save_mcp_json_config",
      "start_mcp_server",
      "stop_mcp_server",
      "restart_mcp_server",
    ]);
    if (positionalCommands.has(action) !== positional) {
      throw new Error(`${action} does not take ${positional ? "positional" : "a request"} arguments`);
    }
    switch (action) {
      case "get_mcp_servers":
        return mcpRows;
      case "load_mcp_json_config":
        return { jsonConfig: mcpDocumentText, fingerprint: `fp-${mcpFingerprint}` };
      case "save_mcp_json_config": {
        const expected = String(body.expectedFingerprint ?? "");
        if (expected !== `fp-${mcpFingerprint}`) {
          // The host refuses a write based on a document that moved under it.
          throw new Error("MCP configuration changed; reload before saving");
        }
        mcpSaves.push({ jsonConfig: String(body.jsonConfig ?? ""), expectedFingerprint: expected });
        mcpDocumentText = String(body.jsonConfig ?? "");
        mcpFingerprint += 1;
        return null;
      }
      case "start_mcp_server":
        mcpSetStatus(String(body.serverId ?? ""), "Connected");
        return null;
      case "stop_mcp_server":
        mcpSetStatus(String(body.serverId ?? ""), "Stopped");
        return null;
      case "restart_mcp_server":
        mcpSetStatus(String(body.serverId ?? ""), "Connected");
        return null;
      case "list_mcp_resources": {
        // What one connected server publishes: text, json, and a binary entry the
        // browser must report as binary rather than decode.
        return mcpResourceRows;
      }
      case "read_mcp_resource": {
        const uri = String(body.resourceUri ?? "");
        if (uri === "memo://notes") {
          return {
            contents: [{ uri, mimeType: "text/markdown", content: "# Notes\n\nHello from the server." }],
          };
        }
        if (uri === "memo://config") {
          return {
            contents: [
              { uri, mimeType: "application/json", content: "{\n  \"retries\": 2\n}" },
              { uri, mimeType: "text/plain", content: "second block" },
            ],
          };
        }
        if (uri === "memo://logo") {
          return { contents: [{ uri, mimeType: "image/png", blob: "iVBORw0KGgoAAAANSUhEUg==" }] };
        }
        return { contents: [] };
      }
      case "delete_mcp_server": {
        if (positional) throw new Error("delete_mcp_server takes a request object");
        const id = String(body.serverId ?? "");
        const index = mcpRows.findIndex(row => row.id === id);
        if (index >= 0) mcpRows.splice(index, 1);
        const parsed = JSON.parse(mcpDocumentText) as { mcpServers?: Record<string, unknown> };
        if (parsed.mcpServers) delete parsed.mcpServers[id];
        mcpDocumentText = JSON.stringify(parsed, null, 2);
        mcpFingerprint += 1;
        return null;
      }
      case "start_mcp_remote_oauth": {
        const id = String(body.serverId ?? "");
        mcpOAuthSession = {
          serverId: id,
          status: "awaitingBrowser",
          authorizationUrl: "https://auth.example/authorize?state=abc123",
          redirectUri: "http://127.0.0.1:45871/oauth/callback",
          message: "Waiting for the browser",
        };
        return mcpOAuthSession;
      }
      case "get_mcp_remote_oauth_session": {
        const id = String(body.serverId ?? "");
        return mcpOAuthSession && mcpOAuthSession.serverId === id ? mcpOAuthSession : null;
      }
      case "cancel_mcp_remote_oauth":
        if (mcpOAuthSession) mcpOAuthSession = { ...mcpOAuthSession, status: "cancelled" };
        return null;
      case "update_mcp_remote_auth": {
        const id = String(body.serverId ?? "");
        mcpAuthWrites.push({ serverId: id, authorizationValue: String(body.authorizationValue ?? "") });
        const row = mcpRow(id);
        if (row) row.authConfigured = true;
        return null;
      }
      case "clear_mcp_remote_auth": {
        const id = String(body.serverId ?? "");
        mcpAuthClears.push(id);
        const row = mcpRow(id);
        if (row) row.authConfigured = false;
        return null;
      }
      default:
        return mcpStatusOf(String(body.serverId ?? ""));
    }
  }

  /**
   * The target's event log, read the way `dispatch_status` reads it: the cursor
   * is "everything up to here is applied", a page carries at most the target's
   * page limit, and a cursor beyond the log is the reset signal.
   */
  function answerDispatchStatus(payload: Record<string, unknown>): unknown {
    const log = options.dispatchEvents ?? [];
    const requestCursor = Number(payload.cursor ?? 0);
    if (requestCursor > log.length) {
      return {
        state: String(options.dispatchState ?? "running"),
        cursor: 0,
        events: [],
        pendingPermissions: [],
        cursorReset: true,
        historyTruncated: false,
        eventLogComplete: true,
        omittedEventCount: 0,
      };
    }
    const pageSize = options.dispatchPageSize ?? 4;
    const events = log.slice(requestCursor, requestCursor + pageSize);
    const cursor = requestCursor + events.length;
    // The state the job reached by the end of this page.
    let state = String(options.dispatchState ?? "running");
    for (const event of log.slice(0, cursor)) {
      if (event.type === "jobState" && typeof event.state === "string") state = event.state;
    }
    const terminal = state === "succeeded" || state === "failed" || state === "cancelled";
    return {
      state,
      cursor,
      events,
      pendingPermissions: terminal ? [] : (options.dispatchPermissions ?? []),
      cursorReset: false,
      historyTruncated: false,
      eventLogComplete: true,
      omittedEventCount: 0,
    };
  }

  function answerHostQueue(request: unknown): unknown {    const payload = (request ?? {}) as {
      sessionId?: string;
      action?: string;
      message?: { turnId?: string; content?: string; displayContent?: string };
      turnId?: string;
      beforeTurnId?: string | null;
      expectedRevision?: number;
    };
    const sessionId = String(payload.sessionId ?? "");
    switch (payload.action) {
      case "list":
        return snapshot(sessionId);
      case "submit": {
        const turnId = String(payload.message?.turnId ?? "");
        hostQueue.push({
          sessionId,
          turnId,
          content: String(payload.message?.displayContent ?? payload.message?.content ?? ""),
          status: "queued",
        });
        queueRevision += 1;
        return snapshot(sessionId);
      }
      case "cancel": {
        const index = hostQueue.findIndex(row => row.turnId === payload.turnId);
        if (index >= 0) {
          hostQueue.splice(index, 1);
          queueRevision += 1;
        }
        return snapshot(sessionId);
      }
      case "promote": {
        const row = hostQueue.find(entry => entry.turnId === payload.turnId);
        if (row) {
          row.status = "started";
          queueRevision += 1;
        }
        return snapshot(sessionId);
      }
      case "reorder": {
        // A stale revision is refused, so a client that forgot to re-read the
        // snapshot fails here rather than silently overwriting another change.
        const turnId = String(payload.turnId ?? "");
        const beforeTurnId = payload.beforeTurnId ?? null;
        if (payload.expectedRevision !== queueRevision) {
          throw new Error(`stale queue revision ${String(payload.expectedRevision)}`);
        }
        queueReorders.push({ turnId, beforeTurnId, expectedRevision: queueRevision });
        const from = hostQueue.findIndex(row => row.sessionId === sessionId && row.turnId === turnId);
        if (from >= 0) {
          const [moving] = hostQueue.splice(from, 1);
          const before = beforeTurnId === null
            ? -1
            : hostQueue.findIndex(row => row.sessionId === sessionId && row.turnId === beforeTurnId);
          if (before < 0) hostQueue.push(moving);
          else hostQueue.splice(before, 0, moving);
          queueRevision += 1;
        }
        return snapshot(sessionId);
      }
      default:
        return snapshot(sessionId);
    }
  }

  function snapshot(sessionId: string): unknown {
    const blocked = options.hostQueueBlocked ?? {};
    const items = hostQueue
      .filter(row => row.sessionId === sessionId)
      .map(row => ({
        turnId: row.turnId,
        displayContent: row.content,
        previewTruncated: false,
        attachmentCount: 0,
        agentType: "Standard",
        createdAtMs: 0,
        status: blocked[row.turnId] ? "blocked" : row.status,
        reason: blocked[row.turnId] ?? null,
        targetTurnId: null,
        steeringId: null,
      }));
    const reorder = options.hostQueueReorder === undefined ? true : options.hostQueueReorder;
    return {
      sessionId,
      queueEpoch: "epoch-1",
      revision: queueRevision,
      activeTurnId: null,
      items,
      ...(reorder === null ? {} : { supportsReorder: reorder }),
      capacity: 20,
      used: items.length,
      receipt: null,
    };
  }

  function answer(action: string, request: unknown, positional = false): unknown {
    const payload = (request ?? {}) as Record<string, unknown>;
    switch (action) {
      case "get_opened_workspaces":
        return [
          { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
        ];
      case "get_recent_workspaces":
        return [
          { id: "workspace-1", name: "OpenBitFun", rootPath: "/repo", workspaceKind: "local" },
          { id: "workspace-2", name: "remote-host", rootPath: "/srv/app", workspaceKind: "remote" },
        ];
      case "set_active_workspace":
        return null;
      case "list_persisted_sessions_page":
        return {
          sessions: sessions.map(session => ({ ...session, workspaceId: "workspace-1" })),
          totalTopLevelCount: sessions.length,
          loadedTopLevelCount: sessions.length,
          hasMore: false,
        };
      case "load_session_turns": {
        const sessionId = (request as { session_id?: string })?.session_id ?? "";
        return TURNS[sessionId] ?? [];
      }
      case "get_configs":
        return options.configs ?? { appearance: { theme: "dark" }, editor: { fontSize: 13 } };
      case "set_config": {
        const path = String(payload.path ?? "");
        settingsWrites.push({ path, value: payload.value });
        if (path === "app" && payload.value && typeof payload.value === "object") {
          const lang = (payload.value as Record<string, unknown>).language;
          if (typeof lang === "string" && lang.trim()) currentLanguage = lang;
        } else if (path === "app.language" && typeof payload.value === "string" && payload.value.trim()) {
          currentLanguage = payload.value;
        }
        return null;
      }
      case "i18n_get_current_language":
        return currentLanguage;
      case "i18n_set_language": {
        const lang = String(payload.language ?? "").trim();
        if (lang) currentLanguage = lang;
        return `Language switched to: ${currentLanguage}`;
      }
      case "get_web_search_credential_status": {
        const provider = String(payload.provider ?? "");
        return { provider, configured: credentialConfigured };
      }
      case "save_web_search_credential": {
        const provider = String(payload.provider ?? "");
        credentialWrites.push({ provider, secret: String(payload.secret ?? "") });
        credentialConfigured = true;
        return { provider, configured: true };
      }
      case "clear_web_search_credential": {
        const provider = String(payload.provider ?? "");
        clearedCredentials.push(provider);
        credentialConfigured = false;
        return { provider, configured: false };
      }
      case "get_decision_model_credential_status":
        return { configured: decisionKeyConfigured };
      case "save_decision_model_credential": {
        decisionKeyWrites.push(String(payload.secret ?? ""));
        decisionKeyConfigured = true;
        return { configured: true };
      }
      case "clear_decision_model_credential": {
        decisionKeyCleared += 1;
        decisionKeyConfigured = false;
        return { configured: false };
      }
      case "get_config": {
        const path = (request as { path?: string })?.path ?? "";
        if (path === "font" && options.fontPreference !== undefined) {
          if (options.fontPreference === null) {
            throw new Error(`Failed to get config: Not found: Config path 'font' not found`);
          }
          return options.fontPreference;
        }
        const configs = options.configs ?? DEFAULT_CONFIGS;
        if (options.absentConfigs?.includes(path)) {
          throw new Error(`Failed to get config: Not found: Config path '${path}' not found`);
        }
        if (!(path in configs)) throw new Error(`Config path '${path}' not found`);
        return configs[path];
      }
      case "get_file_tree":
        return files;
      case "explorer_get_children": {
        const path = String(payload.path ?? "");
        const entries = fs.get(path);
        if (!entries) throw new Error(`Directory does not exist: ${path}`);
        return [...entries].sort((left, right) => {
          if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
          return left.name.localeCompare(right.name);
        });
      }
      case "create_file":
      case "create_directory": {
        const path = String(payload.path ?? "");
        const directory = parentDirectory(path);
        const list = fs.get(directory);
        if (!list) throw new Error(`Directory does not exist: ${directory}`);
        const isDirectory = action === "create_directory";
        list.push({ name: entryName(path), path, isDirectory });
        if (isDirectory) fs.set(path, []);
        return null;
      }
      case "delete_file":
      case "delete_directory": {
        const path = String(payload.path ?? "");
        const directory = parentDirectory(path);
        const list = fs.get(directory);
        if (list) fs.set(directory, list.filter(entry => entry.path !== path));
        fs.delete(path);
        return null;
      }
      case "rename_file": {
        const oldPath = String(payload.oldPath ?? "");
        const newPath = String(payload.newPath ?? "");
        const directory = parentDirectory(oldPath);
        const list = fs.get(directory) ?? [];
        for (const entry of list) {
          if (entry.path !== oldPath) continue;
          entry.path = newPath;
          entry.name = entryName(newPath);
        }
        const moved = fs.get(oldPath);
        if (moved) {
          fs.delete(oldPath);
          fs.set(newPath, moved);
        }
        return null;
      }
      case "search_files": {
        if (options.fileSearch === false) {
          throw new Error("Command not found: search_files");
        }
        const pattern = String(payload.pattern ?? "").toLowerCase();
        const matches: VirtualEntry[] = [];
        for (const entries of fs.values()) {
          for (const entry of entries) {
            if (entry.name.toLowerCase().includes(pattern)) matches.push(entry);
          }
        }
        if (payload.searchContent === true) {
          // Content mode reports one row per matching line, with its preview.
          const hits: Record<string, unknown>[] = [];
          for (const [path, body] of Object.entries(content)) {
            body.split("\n").forEach((line, index) => {
              if (!line.toLowerCase().includes(pattern)) return;
              hits.push({
                path,
                name: entryName(path),
                is_directory: false,
                match_type: "Content",
                line_number: index + 1,
                preview_inside: line,
              });
            });
          }
          return hits;
        }
        return matches.map(entry => ({ path: entry.path, name: entry.name }));
      }
      case "create_session": {
        const agentType = String(payload.agentType ?? "Standard");
        // The new session is in the catalogue the surface reloads, with no turn yet.
        sessions = [
          {
            sessionId: "session-new",
            sessionName: String(payload.sessionName ?? "New session"),
            lastUpdated: 1763100000000,
            messageCount: 0,
            agentType,
          },
          ...sessions,
        ];
        return { sessionId: "session-new", sessionName: String(payload.sessionName ?? "New session"), agentType };
      }
      case "get_available_modes": {
        if (options.agentModes === null) {
          throw new Error("Command not found: get_available_modes");
        }
        return options.agentModes ?? DEFAULT_AGENT_MODES;
      }
      case "update_session_mode": {
        // The host rebinds the session and reports the new binding on the next read.
        const sessionId = String(payload.sessionId ?? "");
        const modeId = String(payload.modeId ?? "");
        if (!modeId.trim()) throw new Error("session mode must not be empty");
        sessionModeWrites.push({
          sessionId,
          modeId,
          ...(payload.workspaceId ? { workspaceId: String(payload.workspaceId) } : {}),
        });
        sessions = sessions.map(row => (row.sessionId === sessionId ? { ...row, agentType: modeId } : row));
        return null;
      }
      case "copy_session": {
        // The copy shows up in the next catalog read, as the host would list it.
        sessions = [
          { sessionId: "session-copy", sessionName: "NSH skeleton (copy)", lastUpdated: 1763100000000, messageCount: 4 },
          ...sessions,
        ];
        return { session_id: "session-copy", session_name: "NSH skeleton (copy)", agent_type: "Standard" };
      }
      case "start_dialog_turn":
        return { success: true, message: "started" };
      case "interrupt_dialog_turn":
      case "cancel_dialog_turn":
        return null;
      case "steer_dialog_turn":
        return { success: true, steeringId: "steering-1" };
      case "manage_dialog_queue":
        return options.hostQueue ? answerHostQueue(request) : unsupported("manage_dialog_queue");
      case "get_model_pools":
      case "save_model_pool":
      case "delete_model_pool":
      case "get_model_pool_status":
        return answerPools(action, request);
      case "get_mcp_servers":
      case "load_mcp_json_config":
      case "save_mcp_json_config":
      case "start_mcp_server":
      case "stop_mcp_server":
      case "restart_mcp_server":
      case "delete_mcp_server":
      case "get_mcp_server_status":
      case "start_mcp_remote_oauth":
      case "get_mcp_remote_oauth_session":
      case "cancel_mcp_remote_oauth":
      case "update_mcp_remote_auth":
      case "clear_mcp_remote_auth":
      case "list_mcp_resources":
      case "read_mcp_resource":
        return answerMcp(action, request, positional);
      case "account_device_rpc": {
        // Real Rust `account_device_rpc(target_device_id, command_json, timeout_ms)` uses
        // default Tauri v2 camelCase positional args (`targetDeviceId`, `commandJson`).
        const targetDeviceId = String(payload.targetDeviceId ?? payload.target_device_id ?? "");
        const envelope = JSON.parse(String(payload.commandJson ?? payload.command_json ?? "{}")) as {
          cmd?: string;
          command?: string;
          args?: Record<string, unknown>;
        };
        if (envelope.cmd !== "host_invoke") {
          throw new Error(`unsupported device command ${envelope.cmd ?? "none"}`);
        }
        return answerPeerHostInvoke(
          targetDeviceId,
          envelope,
          options.peerCapabilities,
          (action, args) => peerInvocations.push({ action, args }),
        );
      }
      case "dispatch_list_targets":
        return [
          { kind: "local", displayName: "Local" },
          {
            kind: "ssh",
            connectionId: "conn-1",
            displayName: "build-box",
            description: "/srv/api",
            online: true,
          },
          { kind: "ssh", connectionId: "conn-2", displayName: "old-box", online: false },
        ];
      case "dispatch_list_jobs":
        // The controller's own index: the state is the last observed one.
        return [options.dispatchJob].filter(Boolean);
      case "dispatch_submit":
        submitted = request;
        return { jobId: payload.jobId, sessionId: payload.sessionId, state: "queued" };
      case "dispatch_cancel":
        cancelledJobs.push(String(payload.jobId));
        return { cancelled: true };
      case "dispatch_status":
        return answerDispatchStatus(payload);
      case "dispatch_answer": {
        const requestId = String(payload.requestId ?? "");
        dispatchAnswers.push({
          jobId: String(payload.jobId ?? ""),
          requestId,
          reply: String(payload.reply ?? ""),
        });
        // Answering resolves the mailbox entry, as the target does.
        if (options.dispatchPermissions) {
          options.dispatchPermissions = options.dispatchPermissions.filter(
            request => String(request.requestId ?? "") !== requestId,
          );
        }
        return { resolved: true };
      }
      case "dispatch_append":
        dispatchAppends.push({ jobId: String(payload.jobId ?? ""), content: String(payload.content ?? "") });
        return { accepted: true, messageId: String(payload.messageId ?? "") };
      case "dispatch_continue":
        dispatchContinues.push({
          jobId: String(payload.jobId ?? ""),
          turnId: String(payload.turnId ?? ""),
          prompt: String(payload.prompt ?? ""),
        });
        return {
          accepted: true,
          jobId: String(payload.jobId ?? ""),
          sessionId: "session-1",
          turnId: String(payload.turnId ?? ""),
          state: "running",
        };
      case "dispatch_sync_result":
        dispatchSyncs.push(String(payload.jobId ?? ""));
        return { jobId: String(payload.jobId ?? ""), synced: true, headCommit: "0123456789abcdef" };
      case "get_acp_clients":
        if (options.acpClients === null) throw new Error("ACP client service not initialized");
        return acpRows;
      case "probe_acp_client_requirements":
        return options.acpProbes ?? DEFAULT_ACP_PROBES;
      case "load_acp_json_config":
        return acpJsonText;
      case "save_acp_json_config": {
        // Positional: the text arrives at the top level, not inside `request`.
        if (!positional) throw new Error("save_acp_json_config takes positional arguments");
        const text = String(payload.jsonConfig ?? "");
        acpSaves.push(text);
        acpJsonText = text;
        return null;
      }
      case "install_acp_client_cli":
        acpInstalls.push(String(payload.clientId ?? ""));
        return null;
      case "stop_acp_client":
        acpRows = acpRows.map(row =>
          row.id === String(payload.clientId ?? "") ? { ...row, status: "stopped" } : row,
        );
        return null;
      case "get_token_usage_statistics": {
        usageRequests.push(payload);
        if (options.usage === null) {
          // An older Peer host refuses the command with its own marker.
          throw new Error(
            "token_usage_statistics_unsupported: The connected Peer host does not support usage statistics",
          );
        }
        // The six-month activity read is the same command over a fixed window.
        if (payload.timeRange === "custom") {
          if (options.usageActivity === null) {
            throw new Error("the host answered the range but not the activity window");
          }
          return options.usageActivity ?? DEFAULT_ACTIVITY;
        }
        return options.usage ?? DEFAULT_USAGE;
      }
      case "get_session_interaction_mailbox": {
        if (pendingQuestions === null) throw new Error("Command not found: get_session_interaction_mailbox");
        const sessionId = String(payload.sessionId ?? "");
        return {
          sessionId,
          userQuestions: { revision: 1, questions: pendingQuestions },
          permissions: { requests: [] },
        };
      }
      case "start_user_question_interaction": {
        questionStarts.push({
          sessionId: String(payload.sessionId ?? ""),
          toolId: String(payload.toolId ?? ""),
        });
        return null;
      }
      case "submit_user_answers": {
        // Positional: tool id and answers are separate arguments, not one request.
        if (!positional) throw new Error("submit_user_answers takes positional arguments");
        const toolId = String(payload.toolId ?? "");
        const answers = (payload.answers ?? {}) as Record<string, unknown>;
        userAnswers.push({ toolId, answers, sessionId: String(payload.sessionId ?? "") });
        // An answered question leaves the mailbox, as the Runtime drops its channel.
        pendingQuestions = (pendingQuestions ?? []).filter(entry => String(entry.toolId) !== toolId);
        return null;
      }
      case "get_runtime_logging_info":
        if (runtimeLogging === null) throw new Error("Command not found: get_runtime_logging_info");
        return runtimeLogging ?? DEFAULT_RUNTIME_LOGGING;
      case "reveal_in_explorer":
        // Structured request: the path is the only field.
        reveals.push(String(payload.path ?? ""));
        return null;
      case "export_diagnostics_bundle":
        // The surface reveals the returned path itself, so it lands in `reveals`
        // through `reveal_in_explorer` rather than from here.
        return { bundlePath: "/tmp/openbitfun/logs/diagnostics/openbitfun-diagnostics.zip" };
      case "subscribe_permission_requests":
        return null;
      case "list_pending_permission_requests":
        return [
          {
            requestId: "perm-1",
            action: "run_command",
            resources: ["cargo test -p openbitfun-desktop"],
            sessionId: "session-1",
            agentId: "standard",
          },
        ];
      case "respond_permission":
        return null;
      case "archive_session":
      case "unarchive_session":
      case "delete_persisted_session":
      case "fork_session":
      case "account_update_device_alias":
      case "save_session_metadata":
        return null;
      case "get_local_models_dev_catalogs":
        if (modelCatalogFixture === null) throw new Error("Command not found: get_local_models_dev_catalogs");
        return modelCatalogFixture;
      case "search_session_content": {
        if (options.sessionSearch === null) throw new Error("Command not found: search_session_content");
        const query = String(payload.query ?? "").toLowerCase();
        const hits = (options.sessionSearch ?? DEFAULT_SESSION_HITS).filter(hit =>
          `${String(hit.sessionTitle ?? "")} ${String(hit.snippet ?? "")}`.toLowerCase().includes(query),
        );
        return { hits, truncated: false };
      }
      case "get_ai_model_catalog":
        return {
          version: 1,
          models: [
            {
              id: "cfg-primary",
              name: "Primary model",
              provider: "openai",
              // The same model `ai.models` stores, because the reasoning catalog is
              // projected from that entry's endpoint and reasoning block.
              model_name: "gpt-4.1-mini",
              enabled: true,
              capabilities: ["chat", "tool_call"],
            },
            {
              id: "cfg-fast",
              name: "Fast model",
              provider: "openai",
              model_name: "fast-small",
              enabled: true,
              capabilities: ["chat"],
            },
            {
              id: "cfg-image",
              name: "Image model",
              provider: "openai",
              model_name: "image-only",
              enabled: true,
              capabilities: ["image_generation"],
            },
          ],
          default_models: { primary: "gpt-4.1-mini" },
        };
      case "update_session_model":
        // The host validates the pair, so a preset that arrives without its model
        // is refused there; here the write is only remembered for the next read.
        if (Object.prototype.hasOwnProperty.call(payload, "reasoningPreset")) {
          sessionReasoningPreset = (payload.reasoningPreset as string | null) ?? null;
        }
        return null;
      case "get_session_model_target":
        return {
          sessionId: String(payload.sessionId ?? ""),
          selection: { kind: "model", model_ref: "gpt-4.1-mini" },
          ...(sessionReasoningPreset === undefined ? {} : { reasoningPreset: sessionReasoningPreset }),
        };
      case "project_ai_model_reasoning_catalog": {
        if (reasoningCatalogFixture === null) {
          throw new Error("Command not found: project_ai_model_reasoning_catalog");
        }
        return reasoningCatalogFixture ?? DEFAULT_REASONING_CATALOG;
      }
      case "paste_files": {        const sources = (payload.sourcePaths as string[] | undefined) ?? [];
        const target = String(payload.targetDirectory ?? "");
        const list = fs.get(target);
        if (!list) throw new Error(`Target directory does not exist: ${target}`);
        for (const source of sources) {
          const name = entryName(source);
          const path = `${target}/${name}`;
          if (!list.some(entry => entry.path === path)) {
            list.push({ name, path, isDirectory: false });
          }
        }
        return { successCount: sources.length, directoryCount: 0, failedFiles: [] };
      }
      case "git_get_status":
        return {
          staged: [{ path: "/repo/main.rs", status: "M", index_status: "M", workdir_status: null }],
          unstaged: [
            { path: "/repo/docs/guide.md", status: "M", index_status: null, workdir_status: "M" },
          ],
          untracked: ["/repo/logo.png"],
          conflicts: [],
          current_branch: "main",
          ahead: 0,
          behind: 0,
        };
      case "git_get_diff": {
        const files = (payload.params as { files?: string[] })?.files ?? [];
        return [
          `diff --git a${files[0] ?? ""} b${files[0] ?? ""}`,
          `--- a${files[0] ?? ""}`,
          `+++ b${files[0] ?? ""}`,
          "@@ -1,3 +1,4 @@",
          " fn main() {",
          "-    println!(\"hello\");",
          "+    println!(\"hello, diff\");",
          "+    // reviewed",
          " }",
          "",
        ].join("\n");
      }
      case "read_file_content": {
        const path = (request as { filePath?: string })?.filePath ?? "";
        const body = content[path];
        if (body === undefined) throw new Error(`no fixture content for ${path}`);
        return body;
      }
      case "terminal_create": {
        // Each call is a new shell, the way the host numbers them.
        terminalCount += 1;
        return { id: `terminal-${terminalCount}`, name: "zsh", workspaceId: "workspace-1" };
      }
      case "terminal_get_history": {
        if (!positional) {
          throw new Error("terminal_get_history takes positional arguments (sessionId, afterOffset), not { request }");
        }
        const id = String((request as { sessionId?: string })?.sessionId ?? "");
        return { data: `${id} % `, cursor: 7, nextOffset: 7, truncated: false, cols: 120, rows: 32 };
      }
      case "terminal_get_shells":
        return [
          { shellType: "Zsh", id: "shell-zsh", name: "zsh", path: "/bin/zsh", version: "5.9", available: true },
          { shellType: "Bash", id: "shell-bash", name: "bash", path: "/bin/bash", version: "3.2", available: true },
          { shellType: "Fish", id: "shell-fish", name: "fish", path: "/opt/fish", available: false },
        ];
      case "terminal_write":
      case "terminal_resize":
      case "terminal_close":
        return null;
      default:
        throw new Error(`the simulated backend has no answer for ${action}`);
    }
  }

  const handlers: Record<string, (data: unknown) => unknown> = {
    "openbitfun.invoke": (data: unknown) => {
      const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
      const action = args.action ?? "";
      const raw = Object.prototype.hasOwnProperty.call(args, "raw");
      calls.push({ action, request: raw ? args.raw : args.request, raw });
      try {
        const value = answer(action, raw ? args.raw : args.request, raw);
        return { ok: true, value, transport: "dev" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    "openbitfun.listen": () => ({ ok: true, transport: "dev" }),
    "openbitfun.unlisten": () => ({ ok: true, transport: "dev" }),
  };

  return {
    calls,
    actions: () => calls.map(call => call.action),
    settingsWrites,
    credentialWrites,
    decisionKeyWrites,
    decisionKeyClears: () => decisionKeyCleared,
    clearedCredentials,
    mcpSaves,
    mcpDocument: () => JSON.parse(mcpDocumentText),
    changeMcpDocumentElsewhere: () => {
      mcpFingerprint += 1;
    },
    setMcpOAuthSession: (session: Record<string, unknown> | null) => {
      mcpOAuthSession = session;
    },
    mcpAuthWrites,
    mcpAuthClears,
    submittedDispatch: () => submitted,
    cancelledJobs,
    dispatchAnswers,
    dispatchAppends,
    dispatchContinues,
    dispatchSyncs,
    usageRequests,
    sessionModeWrites,
    acpSaves,
    acpInstalls,
    reveals,
    questionStarts,
    userAnswers,
    peerInvocations,
    queueReorders,
    handlers,
  };
}

/** The device commands are answered outside `request`, like their Tauri signature. */
export function createDeviceBackend(options: BackendOptions = {}): Backend {
  const backend = createBackend(options);
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; raw?: unknown };
    if (args.action === "account_list_devices") {
      return {
        ok: true,
        value:
          options.devices ??
          [
            { deviceId: "device-mac", deviceName: "studio", platform: "macos", alias: "Studio" },
            { deviceId: "device-linux", deviceName: "builder", platform: "linux" },
          ],
        transport: "dev",
      };
    }
    if (args.action === "account_online_devices") {
      return { ok: true, value: options.onlineDevices ?? [{ deviceId: "device-mac" }], transport: "dev" };
    }
    if (args.action === "remote_connect_get_device_info") {
      // The default order puts this machine first; "device-mac" is it in the fixtures.
      return { ok: true, value: { device_id: "device-mac", device_name: "studio" }, transport: "dev" };
    }
    if (args.action === "account_update_device_alias") {
      return invoke(data);
    }
    return invoke(data);
  };
  return backend;
}

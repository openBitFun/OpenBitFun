// Host module of the OpenBitFun NSH frontend.
//
// The NSH engine runs inside the OpenBitFun desktop window but in its own
// JavaScript realm, so it cannot see `window.__TAURI__` itself. This module is
// the page-side half of the bridge and is the only place that talks to the
// native host:
//
//   host.call("openbitfun.invoke", { action, request })  -> Tauri IPC, one command
//   host.call("openbitfun.listen", { event })           -> subscribe a backend event
//   host.call("openbitfun.unlisten", { event })         -> release it
//   player event "openbitfun.event"                     -> { event, payload }
//
// `nsh package --target web` copies this file into the site as host.<digest>.js
// and the page runs `createHost(player)` before the app starts.
//
// Without a native host (a plain browser during `nsh run --target web`, or a
// headless `nsh test`) every call answers from the fixtures below, so the whole
// shell is developable and testable without the desktop binary.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function normalizeDevLocale(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase().replace(/_/g, "-");
  if (
    lower === "zh-tw" ||
    lower === "zh-hk" ||
    lower === "zh-mo" ||
    lower === "zh-hant" ||
    lower.startsWith("zh-hant-")
  ) {
    return "zh-TW";
  }
  if (
    lower === "zh" ||
    lower === "zh-cn" ||
    lower === "zh-sg" ||
    lower === "zh-hans" ||
    lower.startsWith("zh-hans-") ||
    lower.startsWith("zh-")
  ) {
    return "zh-CN";
  }
  if (lower === "en" || lower === "en-us" || lower.startsWith("en-")) {
    return "en-US";
  }
  return null;
}

function readDevUrlLocale() {
  try {
    const search =
      globalThis.location && typeof globalThis.location.search === "string"
        ? globalThis.location.search
        : "";
    if (!search) return null;
    const params = new URLSearchParams(search);
    return normalizeDevLocale(params.get("lang") || params.get("locale"));
  } catch {
    return null;
  }
}

function readDevUrlAuthLoggedOut() {
  try {
    const search =
      globalThis.location && typeof globalThis.location.search === "string"
        ? globalThis.location.search
        : "";
    if (!search) return false;
    const params = new URLSearchParams(search);
    const raw = (params.get("auth") || "").trim().toLowerCase();
    return raw === "logged_out" || raw === "loggedout" || raw === "signed_out" || raw === "false";
  } catch {
    return false;
  }
}

function payloadOf(args) {
  if (!args || typeof args !== "object") return {};
  if (args.request !== undefined && args.request !== null) return args.request;
  if (args.raw !== undefined && args.raw !== null) return args.raw;
  return {};
}

function defaultPersonaContent(fileName, workspaceLabel) {
  const name = workspaceLabel || "Personal Assistant";
  switch (fileName) {
    case "IDENTITY.md":
      return `# Identity\n\n- **Name**: ${name}\n- **Role**: Autonomous engineering & research partner\n- **Tone**: Calm, direct, and verification-first\n`;
    case "SOUL.md":
      return `# Soul\n\n1. Prioritize clarity over ceremony.\n2. Surface uncertainties and trade-offs explicitly before mutating shared state.\n3. Keep every remote or unattended action safe and reversible.\n`;
    case "USER.md":
      return `# User Preferences\n\n- Preferred language: English\n- Code style: Explicit types, concise diffs, no silent fallbacks\n- Daily digest window: 09:00 local time\n`;
    case "SKILL.md":
      return `---\nname: studio-skill\ndescription: Guided workflow skill fixture for the Personal Agent Studio.\n---\n\n# Overview\n\nUse this skill to inspect context, verify invariants, and summarize outcomes cleanly.\n`;
    default:
      return `# OpenBitFun\n\nThis content comes from the NSH development fixture, not from the host.\n`;
  }
}

const DEV_SESSION_TURNS = {
  "dev-session-1": [
    {
      id: "turn-1",
      turnId: "turn-1",
      turnIndex: 0,
      sessionId: "dev-session-1",
      timestamp: 1763023200000,
      userMessage: {
        id: "user-1",
        content: "Summarize today's highlights across my notes and AI consumer tools.",
        timestamp: 1763023200000,
      },
      modelRounds: [
        {
          id: "round-1",
          turnId: "turn-1",
          roundIndex: 0,
          timestamp: 1763023201000,
          effectiveModelName: "Studio Primary",
          durationMs: 1180,
          thinkingItems: [],
          toolItems: [],
          textItems: [
            {
              id: "text-1",
              content:
                "Here is today's brief across your saved notes and consumer AI tools:\n\n- **Local-first companions**: Minimal matte surfaces with collapsible side drawers are replacing multi-bar dashboards so conversations stay calm and legible.\n- **Voice & quick capture**: Single-line capsule composers with inline attachment and mention triggers keep capture under two seconds.\n- **Scheduled digests**: Morning workspace briefings and diff watchdogs are queued for 09:00 local time.\n\nWant me to turn any of these into a recurring morning routine?",
              isStreaming: false,
              isMarkdown: true,
              orderIndex: 0,
              timestamp: 1763023202000,
            },
          ],
        },
      ],
      status: "completed",
    },
    {
      id: "turn-2",
      turnId: "turn-2",
      turnIndex: 1,
      sessionId: "dev-session-1",
      timestamp: 1763023960000,
      userMessage: {
        id: "user-2",
        content: "Help me pick a crisp focus for this afternoon's session.",
        timestamp: 1763023960000,
      },
      modelRounds: [
        {
          id: "round-2",
          turnId: "turn-2",
          roundIndex: 0,
          timestamp: 1763023961000,
          effectiveModelName: "Studio Primary",
          durationMs: 940,
          thinkingItems: [
            {
              id: "think-1",
              content: "Reviewed open routines, workspace notes, and pending git changes to suggest three focused options.",
              reasoningKind: "reasoning",
              isStreaming: false,
              isCollapsed: true,
              orderIndex: 0,
              timestamp: 1763023961000,
            },
          ],
          toolItems: [],
          textItems: [
            {
              id: "text-2",
              content:
                "Three calm, high-leverage blocks for this afternoon:\n\n1. **Finish persona tuning** — refine `SOUL.md` and `IDENTITY.md` for your primary assistant.\n2. **Review staged UI changes** — inspect the working copy diff and record a clean commit.\n3. **Test Telegram handoff** — send a quick prompt from your phone over the active bot channel.",
              isStreaming: false,
              isMarkdown: true,
              orderIndex: 1,
              timestamp: 1763023962000,
            },
          ],
        },
      ],
      status: "completed",
    },
  ],
  "dev-session-2": [
    {
      id: "turn-3",
      turnId: "turn-3",
      turnIndex: 0,
      sessionId: "dev-session-2",
      timestamp: 1763010000000,
      userMessage: {
        id: "user-3",
        content: "Pull the action items out of docs/notes.md.",
        timestamp: 1763010000000,
      },
      modelRounds: [
        {
          id: "round-3",
          turnId: "turn-3",
          roundIndex: 0,
          timestamp: 1763010001000,
          effectiveModelName: "Studio Primary",
          durationMs: 760,
          thinkingItems: [],
          toolItems: [],
          textItems: [
            {
              id: "text-3",
              content:
                "From `docs/notes.md`, there are two open items:\n\n- Verify both dark charcoal and warm alabaster palettes across all 12 scenes.\n- Keep all remote workspace and Peer Device guards degrading cleanly.",
              isStreaming: false,
              isMarkdown: true,
              orderIndex: 0,
              timestamp: 1763010002000,
            },
          ],
        },
      ],
      status: "completed",
    },
  ],
  "dev-session-3": [
    {
      id: "turn-4",
      turnId: "turn-4",
      timestamp: 1762980000000,
      userMessage: {
        id: "user-4",
        content: "Draft a relaxed two-day coastal weekend itinerary with light driving.",
        timestamp: 1762980000000,
      },
      modelRounds: [
        {
          id: "round-4",
          assistantMessage: {
            id: "assistant-4",
            content:
              "### Coastal Weekend Plan\n\n- **Saturday morning**: Coastal trail walk, bakery coffee stop, and tide-pool overlook before noon.\n- **Saturday afternoon**: Waterfront bookshop browse and early dinner near the harbor.\n- **Sunday**: Slow breakfast, botanical garden loop, and an unhurried drive back by 4 PM.",
          },
        },
      ],
    },
  ],
  "dev-session-4": [
    {
      id: "turn-5",
      turnId: "turn-5",
      timestamp: 1762940000000,
      userMessage: {
        id: "user-5",
        content: "Review repository architecture boundaries at a glance.",
        timestamp: 1762940000000,
      },
      modelRounds: [
        {
          id: "round-5",
          assistantMessage: {
            id: "assistant-5",
            content:
              "Dependencies flow strictly downward from `interfaces` -> `assembly` -> `adapters` -> `services` -> `execution` -> `contracts`. UI scenes in `src/nsh-ui` remain transport-agnostic through `src/bridge.ts` and `host.js`.",
          },
        },
      ],
    },
  ],
  "dev-session-notes-1": [
    {
      id: "turn-notes-1",
      turnId: "turn-notes-1",
      timestamp: 1763015000000,
      userMessage: {
        id: "user-notes-1",
        content: "Capture the key takeaways from this week's reading.",
        timestamp: 1763015000000,
      },
      modelRounds: [
        {
          id: "round-notes-1",
          assistantMessage: {
            id: "assistant-notes-1",
            content:
              "Key takeaways saved to `journal.md`:\n\n- Calm ambient interfaces keep attention on one conversation at a time.\n- Progressive disclosure lets technical depth stay one click away without crowding the canvas.",
          },
        },
      ],
    },
  ],
};

const devRecentOnlyWorkspaces = [
  {
    id: "dev-workspace-remote",
    name: "build-host",
    rootPath: "/srv/app",
    workspaceKind: "remote",
    connectionId: "dev-ssh-1",
    sshHost: "build-host",
    lastAccessed: 1762000000000,
  },
];

const devWorkspaces = [
  {
    id: "dev-workspace-openbitfun",
    name: "OpenBitFun",
    rootPath: "/workspace/demo",
    workspaceKind: "local",
    lastAccessed: 1763024000000,
  },
  {
    id: "dev-workspace-notes",
    name: "Personal Notes",
    rootPath: "/workspace/notes",
    workspaceKind: "local",
    lastAccessed: 1763015000000,
  },
];

let activeWorkspaceId = "dev-workspace-openbitfun";

let devSessions = [
  {
    sessionId: "dev-session-1",
    sessionName: "Daily AI consumer tools digest",
    lastUpdated: 1763024000000,
    createdAt: 1763020000000,
    messageCount: 4,
    workspaceId: "dev-workspace-openbitfun",
    agentType: "Standard",
    modelName: "gpt-4.1-mini",
    status: "completed",
  },
  {
    sessionId: "dev-session-2",
    sessionName: "Summarize desktop notes",
    lastUpdated: 1763010000000,
    createdAt: 1763008000000,
    messageCount: 2,
    workspaceId: "dev-workspace-openbitfun",
    agentType: "Standard",
    modelName: "gpt-4.1-mini",
    status: "completed",
  },
  {
    sessionId: "dev-session-3",
    sessionName: "Plan weekend trip",
    lastUpdated: 1762980000000,
    createdAt: 1762978000000,
    messageCount: 2,
    workspaceId: "dev-workspace-openbitfun",
    agentType: "Creative",
    modelName: "gpt-4.1-mini",
    status: "completed",
  },
  {
    sessionId: "dev-session-4",
    sessionName: "Review repository architecture",
    lastUpdated: 1762940000000,
    createdAt: 1762938000000,
    messageCount: 2,
    workspaceId: "dev-workspace-openbitfun",
    agentType: "Standard",
    modelName: "gpt-4.1-mini",
    status: "completed",
  },
  {
    sessionId: "dev-session-5",
    sessionName: "Archived research scratchpad",
    lastUpdated: 1762800000000,
    createdAt: 1762790000000,
    messageCount: 2,
    workspaceId: "dev-workspace-openbitfun",
    agentType: "Minimal",
    modelName: "gpt-4.1-mini",
    persistedStatus: "archived",
    status: "archived",
  },
  {
    sessionId: "dev-session-notes-1",
    sessionName: "Weekly reading notes",
    lastUpdated: 1763015000000,
    createdAt: 1763012000000,
    messageCount: 2,
    workspaceId: "dev-workspace-notes",
    agentType: "Creative",
    modelName: "gpt-4.1-mini",
    status: "completed",
  },
];

let devMcpServers = [];
let devMcpJsonConfig = "{\n  \"mcpServers\": {}\n}";
let devMcpFingerprint = 1;
let devAcpJsonConfig = "{\n  \"acpClients\": {}\n}\n";

let devConfigs = {
  "appearance.theme": "dark",
  "appearance.language": "en-US",
  "terminal.defaultShell": "/bin/zsh",
  "editor.fontSize": 13,
  app: {
    language: "en-US",
    auto_update: true,
    telemetry: false,
    confirm_on_exit: true,
    restore_windows: true,
    keybindings: { "session.new": "Mod+N" },
  },
  "app.language": "en-US",
  "app.logging.level": "info",
  "app.prevent_sleep": false,
  "app.logging.include_sensitive_diagnostics": false,
  "app.hooks.enabled": true,
  "app.hooks.project_hooks_enabled": false,
  "app.flow_chat": {
    default_mode_strategy: "follow_last",
    last_mode_id: "Standard",
    auto_show_selection_toolbar: true,
    send_during_turn: "queue",
  },
  "app.ai_experience": {
    enable_session_title_generation: true,
    enable_workspace_search: true,
    quick_actions: [
      { id: "commit", label: "Commit", prompt: "Commit all current code changes", enabled: true },
      { id: "create_pr", label: "Create PR", prompt: "Create a Pull Request", enabled: true },
    ],
  },
  "app.worktrees.rootPath": "~/.openbitfun/worktrees",
  "app.worktrees.branchPrefix": "openbitfun/",
  "app.worktrees.copyLocalChanges": false,
  "app.worktrees.autoDeleteEnabled": true,
  "app.worktrees.autoDeleteLimit": 15,
  editor: { fontSize: 13, font_size: 14, tab_size: 4, word_wrap: "off", line_numbers: "on" },
  terminal: { defaultShell: "/bin/zsh", font_size: 14, scrollback: 1000, cursor_style: "block" },
  font: { uiSize: { level: "default" } },
  "ai.models": [
    {
      id: "model-1",
      name: "Studio Primary",
      provider: "openai",
      model_name: "gpt-4.1-mini",
      base_url: "https://api.openai.com/v1",
      request_url: "https://api.openai.com/v1/chat/completions",
      enabled: true,
      category: "general_chat",
      capabilities: ["text_chat", "chat"],
      context_window: 128000,
      max_tokens: 16384,
    },
    {
      id: "model-2",
      name: "Studio Reasoning",
      provider: "openai",
      model_name: "o3-mini",
      base_url: "https://api.openai.com/v1",
      request_url: "https://api.openai.com/v1/chat/completions",
      enabled: true,
      category: "general_chat",
      capabilities: ["text_chat", "chat", "reasoning"],
      context_window: 200000,
      max_tokens: 65536,
    },
  ],
  "ai.default_models": { primary: "model-1", fast: "model-1" },
  "ai.task_models": {
    session_title: { Fixed: { model_id: "model-1" } },
    git_commit: "Inherit",
  },
  "ai.web_search": {
    provider: "exa_mcp_free",
    providers: {
      exa_mcp_free: {},
      tavily: { credentialId: "tavily-search-api" },
    },
  },
  "ai.decision_model": { model_name: "gpt-4.1-mini", endpoint: "https://api.openai.com/v1" },
  "ai.enable_deferred_tool_loading": true,
  "ai.subagent_max_concurrency": 4,
  "ai.swarm_max_concurrency": 4,
  "ai.subagent_batch_execution_policy": "force_parallel",
  "ai.tool_presentation_mode": "native",
  "ai.computer_use_enabled": true,
  "ai.browser_control_auto_connect_on_startup": false,
  "ai.browser_control_preferred_browser": "",
  tool_permissions: {
    policy: {
      preset: "ask",
      rules: [{ action: "run_command", resource: "git status", effect: "allow" }],
    },
    interaction: { auto_approve_ask: false },
    approval: {
      strategy: "interactive",
      model_kind: "chat",
      chat_model_id: "fast",
      timeout_ms: 30000,
      on_ask: "user",
      on_error: "ask",
    },
  },
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
};

const devFiles = {
  "/workspace/demo": [
    { name: "src", path: "/workspace/demo/src", isDirectory: true },
    { name: "docs", path: "/workspace/demo/docs", isDirectory: true },
    { name: "README.md", path: "/workspace/demo/README.md", isDirectory: false, size: 1280 },
  ],
  "/workspace/demo/src": [
    { name: "web-ui", path: "/workspace/demo/src/web-ui", isDirectory: true },
    { name: "nsh-ui", path: "/workspace/demo/src/nsh-ui", isDirectory: true },
  ],
  "/workspace/demo/src/nsh-ui": [
    { name: "App.tsx", path: "/workspace/demo/src/nsh-ui/App.tsx", isDirectory: false, size: 4200 },
  ],
  "/workspace/demo/src/web-ui": [],
  "/workspace/demo/docs": [
    { name: "notes.md", path: "/workspace/demo/docs/notes.md", isDirectory: false, size: 640 },
  ],
  "/workspace/notes": [
    { name: "journal.md", path: "/workspace/notes/journal.md", isDirectory: false, size: 512 },
  ],
};

const devFileContents = {
  "/workspace/demo/README.md":
    "# OpenBitFun\n\nPersonal Agent Studio running on the NSH web target fixture host.\n",
  "/workspace/demo/docs/notes.md":
    "# Studio Notes\n\n- Verify dark matte charcoal and warm alabaster palettes.\n- Exercise Sessions, Assistants, Agents, Skills, Routines, Git, and Spaces.\n",
  "/workspace/notes/journal.md":
    "# Personal Journal\n\n- Keep the daily workspace smooth and distraction-free.\n",
  "/workspace/demo/src/nsh-ui/App.tsx":
    "// Development fixture preview\nexport function AppPreview() {\n  return null;\n}\n",
  "/workspace/assistants/nova/IDENTITY.md": defaultPersonaContent("IDENTITY.md", "Nova"),
  "/workspace/assistants/nova/SOUL.md": defaultPersonaContent("SOUL.md", "Nova"),
  "/workspace/assistants/nova/USER.md": defaultPersonaContent("USER.md", "Nova"),
  "/workspace/assistants/atlas/IDENTITY.md": defaultPersonaContent("IDENTITY.md", "Atlas Researcher"),
  "/workspace/assistants/atlas/SOUL.md": defaultPersonaContent("SOUL.md", "Atlas Researcher"),
  "/workspace/assistants/atlas/USER.md": defaultPersonaContent("USER.md", "Atlas Researcher"),
  "/workspace/skills/code-review-coach/SKILL.md":
    "---\nname: code-review-coach\ndescription: Reviews staged diffs for invariants, edge cases, and test coverage.\n---\n\n# Code Review Coach\n\nInspect changed files, trace callers, and flag silent fallbacks.\n",
  "/workspace/demo/.openbitfun/skills/release-checklist/SKILL.md":
    "---\nname: release-checklist\ndescription: Validates build gates, changelogs, and compatibility contracts before release.\n---\n\n# Release Checklist\n\nRun focused verification gates and confirm upgrade compatibility.\n",
  "/builtin/skills/research-synthesis/SKILL.md":
    "---\nname: research-synthesis\ndescription: Synthesizes architectural notes and open questions into structured briefs.\n---\n\n# Research Synthesis\n\nCross-reference sources and organize findings clearly.\n",
};

// Assistants state
let devAssistants = [
  {
    id: "dev-assistant-nova",
    name: "Nova",
    rootPath: "/workspace/assistants/nova",
    workspaceType: "normal",
    workspaceKind: "assistant",
    assistantId: "nova",
    languages: ["markdown"],
    openedAt: "2026-11-01T09:00:00Z",
    lastAccessed: "2026-11-18T12:00:00Z",
    description: "Primary personal assistant for planning, writing, and daily synthesis.",
    tags: ["primary", "personal"],
    relatedPaths: [],
  },
  {
    id: "dev-assistant-atlas",
    name: "Atlas Researcher",
    rootPath: "/workspace/assistants/atlas",
    workspaceType: "normal",
    workspaceKind: "assistant",
    assistantId: "atlas",
    languages: ["markdown"],
    openedAt: "2026-11-10T10:00:00Z",
    lastAccessed: "2026-11-17T18:00:00Z",
    description: "Deep literature & codebase investigator with calm structured reports.",
    tags: ["research"],
    relatedPaths: [],
  },
];
let primaryAssistantId = "dev-assistant-nova";
let assistantSeq = 3;

// Agents & Subagents state
const ALL_AGENT_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "WebSearch",
  "WebFetch",
  "Task",
  "TodoWrite",
  "Skill",
];

const devBuiltinModes = [
  { id: "Minimal", name: "Minimal", description: "Read-mostly edits.", source: "builtin", isReadonly: false, toolCount: 5, defaultTools: ["Read", "Grep", "Glob", "Edit", "TodoWrite"] },
  { id: "Standard", name: "Standard", description: "The default profile.", source: "builtin", isReadonly: false, toolCount: 9, defaultTools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "WebSearch", "Task", "TodoWrite"] },
  { id: "Ultimate", name: "Ultimate", description: "The widest tool set.", source: "builtin", isReadonly: false, toolCount: 11, defaultTools: [...ALL_AGENT_TOOLS] },
  { id: "Creative", name: "Creative", description: "Explores alternatives.", source: "builtin", isReadonly: false, toolCount: 8, defaultTools: ["Read", "Write", "Edit", "Grep", "Glob", "WebSearch", "Task", "Skill"] },
  { id: "DeepResearch", name: "Deep research", description: "Builds a report.", source: "builtin", isReadonly: true, toolCount: 5, defaultTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"] },
];

const devCustomModes = [
  {
    agentId: "StudioArchitect",
    kind: "mode",
    name: "Studio Architect",
    description: "Designs cross-platform systems and boundary contracts.",
    prompt: "Focus on clean layers, explicit contracts, and zero regressions.",
    tools: ["Read", "Grep", "Glob", "WebSearch", "TodoWrite"],
    readonly: true,
    review: false,
    model: "primary",
    path: "/workspace/agents/StudioArchitect.md",
    userContextPolicy: [],
    level: "user",
    source: "user",
  },
];

const devAgentProfiles = {
  Minimal: {
    profile_id: "Minimal",
    enabled_tools: ["Read", "Grep", "Glob", "Edit", "TodoWrite"],
    default_tools: ["Read", "Grep", "Glob", "Edit", "TodoWrite"],
    disabled_user_skills: [],
    enabled_user_skills: [],
  },
  Standard: {
    profile_id: "Standard",
    enabled_tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "WebSearch", "Task", "TodoWrite"],
    default_tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "WebSearch", "Task", "TodoWrite"],
    disabled_user_skills: [],
    enabled_user_skills: [],
  },
  Ultimate: {
    profile_id: "Ultimate",
    enabled_tools: [...ALL_AGENT_TOOLS],
    default_tools: [...ALL_AGENT_TOOLS],
    disabled_user_skills: [],
    enabled_user_skills: [],
  },
  Creative: {
    profile_id: "Creative",
    enabled_tools: ["Read", "Write", "Edit", "Grep", "Glob", "WebSearch", "Task", "Skill"],
    default_tools: ["Read", "Write", "Edit", "Grep", "Glob", "WebSearch", "Task", "Skill"],
    disabled_user_skills: [],
    enabled_user_skills: [],
  },
};

const devSubagents = [
  {
    key: "builtin:Explore",
    id: "Explore",
    name: "Explore",
    description: "Fast read-only repository explorer for locating symbols and tracing flows.",
    prompt: "Explore the codebase quickly using read-only search tools.",
    isReadonly: true,
    isReview: false,
    toolCount: 3,
    defaultTools: ["Read", "Grep", "Glob"],
    defaultEnabled: true,
    effectiveEnabled: true,
    source: "builtin",
    subagentSource: "builtin",
    model: "fast",
    supportsFollowUp: true,
  },
  {
    key: "builtin:CodeReviewer",
    id: "CodeReviewer",
    name: "Code Reviewer",
    description: "Audits changes for correctness, edge cases, and boundary discipline.",
    prompt: "Inspect diffs and verify invariants before approval.",
    isReadonly: true,
    isReview: true,
    toolCount: 4,
    defaultTools: ["Read", "Grep", "Glob", "Bash"],
    defaultEnabled: true,
    effectiveEnabled: true,
    source: "builtin",
    subagentSource: "builtin",
    model: "primary",
    supportsFollowUp: true,
  },
  {
    key: "user:ReleaseShepherd",
    id: "ReleaseShepherd",
    name: "Release Shepherd",
    description: "Prepares release notes, checks gates, and summarizes deployment readiness.",
    prompt: "Coordinate verification gates and compile clean release summaries.",
    isReadonly: false,
    isReview: false,
    toolCount: 5,
    defaultTools: ["Read", "Write", "Edit", "Grep", "Bash"],
    defaultEnabled: true,
    effectiveEnabled: true,
    source: "user",
    subagentSource: "user",
    level: "user",
    path: "/workspace/subagents/ReleaseShepherd.md",
    model: "primary",
    modelIsExplicit: true,
    supportsFollowUp: true,
  },
  {
    key: "project:DocsCurator",
    id: "DocsCurator",
    name: "Docs Curator",
    description: "Keeps architecture documents and surface parity tables accurate.",
    prompt: "Audit documentation against implemented code.",
    isReadonly: false,
    isReview: false,
    toolCount: 4,
    defaultTools: ["Read", "Write", "Edit", "Glob"],
    defaultEnabled: true,
    effectiveEnabled: true,
    source: "project",
    subagentSource: "project",
    level: "project",
    path: "/workspace/demo/.openbitfun/subagents/DocsCurator.md",
    model: "fast",
    modelIsExplicit: true,
    supportsFollowUp: false,
  },
];

// Skills & Marketplace state
const devSkills = [
  {
    key: "user:code-review-coach",
    name: "code-review-coach",
    description: "Reviews staged diffs for invariants, edge cases, and test coverage.",
    path: "/workspace/skills/code-review-coach",
    entryFile: "SKILL.md",
    level: "user",
    sourceSlot: "openbitfun-user",
    sourceId: "openbitfun",
    sourceLabel: "OpenBitFun",
    dirName: "code-review-coach",
    isBuiltin: false,
    isShadowed: false,
    allowUserInvocation: true,
  },
  {
    key: "project:release-checklist",
    name: "release-checklist",
    description: "Validates build gates, changelogs, and compatibility contracts before release.",
    path: "/workspace/demo/.openbitfun/skills/release-checklist",
    entryFile: "SKILL.md",
    level: "project",
    sourceSlot: "openbitfun-project",
    sourceId: "openbitfun",
    sourceLabel: "OpenBitFun",
    dirName: "release-checklist",
    isBuiltin: false,
    isShadowed: false,
    allowUserInvocation: true,
  },
  {
    key: "builtin:research-synthesis",
    name: "research-synthesis",
    description: "Synthesizes architectural notes and open questions into structured briefs.",
    path: "/builtin/skills/research-synthesis",
    entryFile: "SKILL.md",
    level: "user",
    sourceSlot: "openbitfun-system",
    sourceId: "openbitfun",
    sourceLabel: "Built-in",
    dirName: "research-synthesis",
    isBuiltin: true,
    isShadowed: false,
    allowUserInvocation: true,
  },
];

let disabledUserSkillKeys = [];
let disabledProjectSkillKeys = [];

const devMarketSkills = [
  {
    id: "changelog-writer",
    name: "Changelog Writer",
    description: "Drafts structured release notes from commit ranges and pull requests.",
    source: "openbitfun/skills",
    installs: 1420,
    url: "https://example.invalid/skills/changelog-writer",
    installId: "openbitfun/skills@changelog-writer",
    marketName: "OpenBitFun Registry",
  },
  {
    id: "security-audit",
    name: "Security Audit",
    description: "Scans workspaces for secret leaks, unsafe process spawns, and boundary violations.",
    source: "openbitfun/skills",
    installs: 2890,
    url: "https://example.invalid/skills/security-audit",
    installId: "openbitfun/skills@security-audit",
    marketName: "OpenBitFun Registry",
  },
  {
    id: "api-docgen",
    name: "API Doc Generator",
    description: "Builds typed reference docs from Rust and TypeScript service contracts.",
    source: "community/skills",
    installs: 980,
    url: "https://example.invalid/skills/api-docgen",
    installId: "community/skills@api-docgen",
    marketName: "Community",
  },
  {
    id: "triage-assistant",
    name: "Issue Triage Assistant",
    description: "Categorizes incoming bug reports and maps them to owning subsystems.",
    source: "community/skills",
    installs: 745,
    url: "https://example.invalid/skills/triage-assistant",
    installId: "community/skills@triage-assistant",
    marketName: "Community",
  },
];

// Cron / Routines state
function buildDefaultCronJobs() {
  const now = Date.now();
  return [
    {
      id: "cron-morning-digest",
      name: "Morning Workspace Digest",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      payload: { text: "Summarize unread threads, pending reviews, and workspace changes." },
      enabled: true,
      reportPolicy: "always",
      target: {
        kind: "workspace",
        workspace: {
          workspaceId: "dev-workspace-openbitfun",
          workspacePath: "/workspace/demo",
        },
        launch: { agentType: "Standard", modelId: null },
      },
      createdAtMs: now - 7 * DAY_MS,
      configUpdatedAtMs: now - DAY_MS,
      updatedAtMs: now - HOUR_MS,
      state: {
        nextRunAtMs: now + 2 * HOUR_MS,
        lastTriggerAtMs: now - 22 * HOUR_MS,
        lastRunStartedAtMs: now - 22 * HOUR_MS,
        lastRunFinishedAtMs: now - 22 * HOUR_MS + 18000,
        lastDurationMs: 18000,
        lastRunStatus: "ok",
        lastError: null,
        activeTurnId: null,
        consecutiveFailures: 0,
        coalescedRunCount: 0,
      },
    },
    {
      id: "cron-diff-watchdog",
      name: "Uncommitted Diff Watchdog",
      schedule: { kind: "every", everyMs: 6 * HOUR_MS },
      payload: { text: "Check git diff for accidental debug logs or missing tests." },
      enabled: true,
      reportPolicy: "conditional",
      target: {
        kind: "workspace",
        workspace: {
          workspaceId: "dev-workspace-openbitfun",
          workspacePath: "/workspace/demo",
        },
        launch: { agentType: "Minimal", modelId: null },
      },
      createdAtMs: now - 5 * DAY_MS,
      configUpdatedAtMs: now - 2 * DAY_MS,
      updatedAtMs: now - 3 * HOUR_MS,
      state: {
        nextRunAtMs: now + 5 * HOUR_MS,
        lastTriggerAtMs: now - HOUR_MS,
        lastRunStartedAtMs: now - HOUR_MS,
        lastRunFinishedAtMs: now - HOUR_MS + 9400,
        lastDurationMs: 9400,
        lastRunStatus: "ok",
        lastError: null,
        activeTurnId: null,
        consecutiveFailures: 0,
        coalescedRunCount: 0,
      },
    },
    {
      id: "cron-weekly-audit",
      name: "Weekly Dependency Audit",
      schedule: { kind: "cron", expr: "0 10 * * 1", tz: "UTC" },
      payload: { text: "Review outdated packages and verify boundary checks." },
      enabled: false,
      reportPolicy: "inherit",
      target: {
        kind: "workspace",
        workspace: {
          workspaceId: "dev-workspace-openbitfun",
          workspacePath: "/workspace/demo",
        },
        launch: { agentType: "DeepResearch", modelId: null },
      },
      createdAtMs: now - 14 * DAY_MS,
      configUpdatedAtMs: now - 3 * DAY_MS,
      updatedAtMs: now - 3 * DAY_MS,
      state: {
        nextRunAtMs: now + 4 * DAY_MS,
        lastTriggerAtMs: null,
        lastRunStatus: null,
        lastError: null,
        activeTurnId: null,
        consecutiveFailures: 0,
        coalescedRunCount: 0,
      },
    },
  ];
}

const devCronJobs = buildDefaultCronJobs();
let cronSeq = 1;

// Git Workbench state
let devGitTrusted = true;
const devGitStatus = {
  staged: [{ path: "src/nsh-ui/src/theme.ts", status: "M", index_status: "M", workdir_status: " " }],
  unstaged: [
    { path: "src/nsh-ui/App.tsx", status: "M", index_status: " ", workdir_status: "M" },
    { path: "README.md", status: "M", index_status: " ", workdir_status: "M" },
  ],
  untracked: ["docs/notes.md"],
  conflicts: [],
  current_branch: "feat/personal-agent-studio",
  ahead: 1,
  behind: 0,
};

const devGitBranches = [
  {
    name: "feat/personal-agent-studio",
    current: true,
    remote: false,
    upstream: "origin/feat/personal-agent-studio",
    ahead: 1,
    behind: 0,
    last_commit: "a1b2c3d",
    last_commit_date: "2026-11-18T11:30:00Z",
  },
  {
    name: "main",
    current: false,
    remote: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    last_commit: "9f8e7d6",
    last_commit_date: "2026-11-17T19:15:00Z",
  },
  {
    name: "origin/main",
    current: false,
    remote: true,
    ahead: 0,
    behind: 0,
    last_commit: "9f8e7d6",
    last_commit_date: "2026-11-17T19:15:00Z",
  },
];

const devGitCommits = [
  {
    hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    short_hash: "a1b2c3d",
    message: "feat(nsh): add Personal Agent Studio shell and design tokens",
    author: "Studio User",
    author_email: "studio@example.com",
    date: "2026-11-18T11:30:00Z",
    parents: ["9f8e7d6c5b4a3928172635445566778899aabbcc"],
    additions: 142,
    deletions: 18,
    files_changed: 5,
  },
  {
    hash: "9f8e7d6c5b4a3928172635445566778899aabbcc",
    short_hash: "9f8e7d6",
    message: "docs(nsh): align peer device capability table",
    author: "Studio User",
    author_email: "studio@example.com",
    date: "2026-11-17T19:15:00Z",
    parents: ["11223344556677889900aabbccddeeff00112233"],
    additions: 36,
    deletions: 12,
    files_changed: 2,
  },
  {
    hash: "11223344556677889900aabbccddeeff00112233",
    short_hash: "1122334",
    message: "chore: initialize workspace session state fixtures",
    author: "Studio User",
    author_email: "studio@example.com",
    date: "2026-11-16T15:00:00Z",
    parents: [],
    additions: 84,
    deletions: 0,
    files_changed: 3,
  },
];

function buildGitDiff(filePath, staged) {
  const path = filePath || "src/nsh-ui/App.tsx";
  const label = staged ? "index" : "working tree";
  return [
    `diff --git a/${path} b/${path}`,
    `index 1122334..a1b2c3d 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -12,4 +12,5 @@`,
    ` // Context (${label})`,
    ` export function studioHeader() {`,
    `-  return "Workspace";`,
    `+  return "Personal Agent Studio";`,
    ` }`,
    `+// Verified reactive palette binding`,
  ].join("\n");
}

function isRemoteWorkspaceRequested(req) {
  const wsId = req && (req.workspaceId || req.workspace_id);
  if (typeof wsId === "string" && wsId.startsWith("dev-workspace-remote")) return true;
  const repoPath = req && req.repositoryPath;
  if (typeof repoPath === "string" && repoPath.startsWith("/srv")) return true;
  return devWorkspaces.some(
    w => w.workspaceKind === "remote" && (w.id === wsId || w.rootPath === repoPath),
  );
}

// Git Worktrees state
const devGitWorktrees = [
  {
    path: "/workspace/demo",
    branch: "feat/personal-agent-studio",
    head: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80910",
    isMain: true,
    isLocked: false,
    isPrunable: false,
  },
  {
    path: "/workspace/demo-worktrees/perf-audit",
    branch: "chore/perf-audit",
    head: "9f8e7d6c5b4a3928172635445566778899aabbcc",
    isMain: false,
    isLocked: false,
    isPrunable: false,
  },
];

// SSH & Remote Workspaces state
const devSshConnections = [
  {
    id: "dev-ssh-1",
    name: "build-host",
    host: "10.24.8.14",
    port: 22,
    username: "builder",
    authType: { type: "PrivateKey", keyPath: "~/.ssh/id_ed25519" },
    defaultWorkspace: "/srv/app",
    lastConnected: Date.now() - 2 * HOUR_MS,
  },
  {
    id: "dev-ssh-2",
    name: "gpu-box",
    host: "10.24.8.42",
    port: 2222,
    username: "research",
    authType: { type: "Agent" },
    defaultWorkspace: "/srv/models",
    lastConnected: Date.now() - DAY_MS,
  },
];

const devSshConnectedIds = new Set(["dev-ssh-1"]);
let devActiveRemoteWorkspace = null;

const devSshConfigHosts = [
  {
    host: "prod-bastion",
    hostname: "203.0.113.10",
    port: 22,
    user: "deploy",
    identityFile: "~/.ssh/prod_ed25519",
    agent: true,
  },
  {
    host: "staging-api",
    hostname: "203.0.113.25",
    port: 22,
    user: "ops",
    proxyJump: "prod-bastion",
  },
];

const devDockerContainers = [
  {
    id: "cnt-openbitfun-dev",
    name: "openbitfun-dev",
    image: "ghcr.io/openbitfun/dev:latest",
    status: "Up 3 hours",
    state: "running",
  },
  {
    id: "cnt-postgres-vec",
    name: "pg-vector",
    image: "pgvector/pgvector:pg16",
    status: "Up 2 days",
    state: "running",
  },
];

const devRemoteDirs = {
  "/": [
    { name: "srv", path: "/srv", isDir: true, isFile: false, isSymlink: false, permissions: "drwxr-xr-x" },
    { name: "workspace", path: "/workspace", isDir: true, isFile: false, isSymlink: false, permissions: "drwxr-xr-x" },
  ],
  "/srv": [
    { name: "app", path: "/srv/app", isDir: true, isFile: false, isSymlink: false, permissions: "drwxr-xr-x" },
    { name: "models", path: "/srv/models", isDir: true, isFile: false, isSymlink: false, permissions: "drwxr-xr-x" },
  ],
  "/srv/app": [
    { name: "src", path: "/srv/app/src", isDir: true, isFile: false, isSymlink: false, permissions: "drwxr-xr-x" },
    { name: "docs", path: "/srv/app/docs", isDir: true, isFile: false, isSymlink: false, permissions: "drwxr-xr-x" },
    { name: "package.json", path: "/srv/app/package.json", isDir: false, isFile: true, isSymlink: false, size: 1420, permissions: "-rw-r--r--" },
  ],
  "/srv/app/src": [
    { name: "server.ts", path: "/srv/app/src/server.ts", isDir: false, isFile: true, isSymlink: false, size: 3240, permissions: "-rw-r--r--" },
  ],
  "/srv/app/docs": [],
  "/srv/models": [
    { name: "weights.json", path: "/srv/models/weights.json", isDir: false, isFile: true, isSymlink: false, size: 512, permissions: "-rw-r--r--" },
  ],
};

const devPortForwards = [
  {
    id: "pf-1",
    connectionId: "dev-ssh-1",
    direction: "local",
    label: "API Dev Server",
    description: "API Dev Server",
    localHost: "127.0.0.1",
    localPort: 8080,
    remoteHost: "127.0.0.1",
    remotePort: 8080,
    activeConnections: 1,
    totalConnections: 4,
  },
];
let portForwardSeq = 2;
let remoteWorkspaceSeq = 1;

function normalizeRemoteDirPath(rawPath) {
  const clean = String(rawPath || "/srv").replace(/\\/g, "/").replace(/\/+/g, "/");
  if (clean.length > 1 && clean.endsWith("/")) return clean.slice(0, -1);
  return clean || "/";
}

function parentRemoteDir(path) {
  const norm = normalizeRemoteDirPath(path);
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return "/";
  return norm.slice(0, idx);
}

function toSavedAuthType(auth) {
  if (!auth || typeof auth !== "object") return { type: "Password" };
  if (auth.type === "PrivateKey") {
    return {
      type: "PrivateKey",
      keyPath: String(auth.keyPath || "~/.ssh/id_ed25519"),
      ...(auth.certificatePath ? { certificatePath: String(auth.certificatePath) } : {}),
    };
  }
  if (auth.type === "Agent") {
    return {
      type: "Agent",
      ...(auth.keyFingerprint ? { keyFingerprint: String(auth.keyFingerprint) } : {}),
      ...(auth.fallbackKeyPath ? { fallbackKeyPath: String(auth.fallbackKeyPath) } : {}),
    };
  }
  if (auth.type === "KeyboardInteractive") return { type: "KeyboardInteractive" };
  if (auth.type === "None") return { type: "None" };
  return { type: "Password" };
}

/** The dev host's day-keyed activity grid (UTC days), shaped like `get_token_usage_activity`. */
function devUsageActivity(nowMs) {
  const today = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  const start = today - 182 * DAY_MS;
  const offset = (new Date(start).getUTCDay() + 6) % 7;
  const gridStart = start - offset * DAY_MS;
  const weekCount = Math.ceil(((today - start) / DAY_MS + 1 + offset) / 7);
  const totals = new Map();
  for (const point of buildCustomUsageTrend(nowMs)) {
    const day = point.bucket.slice(0, 10);
    totals.set(day, (totals.get(day) || 0) + point.inputTokens + point.outputTokens);
  }
  const days = [];
  for (let index = 0; index < weekCount * 7; index += 1) {
    const time = gridStart + index * DAY_MS;
    const date = new Date(time);
    const key = date.toISOString().slice(0, 10);
    const inRange = time >= start && time <= today;
    days.push({ date: key, month: date.getUTCMonth() + 1, dayOfMonth: date.getUTCDate(), tokens: inRange ? totals.get(key) || 0 : 0, level: 0, inRange });
  }
  const peak = days.reduce((max, day) => Math.max(max, day.tokens), 0);
  for (const day of days) day.level = day.tokens > 0 && peak > 0 ? Math.min(4, Math.max(1, Math.ceil((day.tokens / peak) * 4))) : 0;
  const monthHeaders = [];
  days.forEach((day, index) => {
    if (day.inRange && day.dayOfMonth === 1 && Math.floor(index / 7) + 3 <= weekCount) {
      monthHeaders.push({ weekIndex: Math.floor(index / 7), month: day.month });
    }
  });
  const active = days.filter(day => day.inRange && day.tokens > 0);
  return {
    timeZone: "UTC",
    months: 6,
    startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(today).toISOString().slice(0, 10),
    weekCount,
    days,
    monthHeaders,
    totalTokens: days.reduce((sum, day) => sum + day.tokens, 0),
    peakTokens: peak,
    activeDays: active.length,
    longestStreak: 0,
    currentStreak: 0,
  };
}

function buildCustomUsageTrend(nowMs) {
  const points = [];
  for (let offset = 175; offset >= 0; offset -= 1) {
    // Realistic weekday/weekend rhythm with varied activity intensity levels.
    const dayDate = new Date(nowMs - offset * DAY_MS);
    const weekday = dayDate.getUTCDay();
    if (weekday === 0 && offset % 3 !== 0) continue;
    const wave = ((offset * 17 + weekday * 13) % 9) + 1;
    if (wave <= 2 && offset > 7) continue;
    const inputTokens = wave * 14500;
    const outputTokens = wave * 4200;
    const cacheReadTokens = wave * 5800;
    points.push({
      bucket: dayDate.toISOString(),
      inputTokens,
      outputTokens,
      cacheReadTokens,
    });
  }
  return points;
}

// Spaces / MiniApps state
const devMiniApps = [
  {
    id: "space-focus-timer",
    name: "Focus Studio",
    description: "Deep-work pomodoro timer with ambient session log summaries.",
    icon: "timer",
    category: "Productivity",
    tags: ["focus", "routine"],
    version: 3,
    created_at: 1762400000000,
    updated_at: 1763000000000,
    permissions: { fs: { read: ["notes/*"] }, ai: { enabled: true } },
    source: {
      html: "<main id=\"app\"><h1>Focus Studio</h1></main>",
      css: "main { font-family: system-ui; padding: 16px; }",
      ui_js: "export function mount(root) { root.dataset.ready = 'true'; }",
      esm_dependencies: [],
      worker_js: "export async function tick() { return { remainingSec: 1500 }; }",
      npm_dependencies: [],
    },
    compiled_html: "<!doctype html><html><body>Focus Studio</body></html>",
    ai_context: {
      original_prompt: "Create a calm focus timer space that logs completed blocks.",
      iteration_history: ["Initial timer UI", "Added session summary hook"],
    },
  },
  {
    id: "space-release-board",
    name: "Release Readiness",
    description: "Interactive gate tracker for cross-surface verification and compatibility.",
    icon: "check",
    category: "Engineering",
    tags: ["qa", "release"],
    version: 2,
    created_at: 1762500000000,
    updated_at: 1762950000000,
    permissions: { fs: { read: ["docs/*"] }, host: { clipboard_write: true } },
    source: {
      html: "<main id=\"board\"><h2>Release Gates</h2></main>",
      css: "main { padding: 16px; }",
      ui_js: "export function renderGates() { return ['nsh check', 'capabilities:check']; }",
      esm_dependencies: [],
      worker_js: "",
      npm_dependencies: [],
    },
    compiled_html: "<!doctype html><html><body>Release Readiness</body></html>",
    ai_context: {
      original_prompt: "Build a release readiness checklist space.",
      iteration_history: ["Added capability check item"],
    },
  },
  {
    id: "space-research-canvas",
    name: "Research Canvas",
    description: "Side-by-side literature comparison board powered by workspace notes.",
    icon: "book",
    category: "Knowledge",
    tags: ["research", "markdown"],
    version: 1,
    created_at: 1762600000000,
    updated_at: 1762850000000,
    permissions: { fs: { read: ["docs/*"] }, ai: { enabled: true } },
    source: {
      html: "<main id=\"canvas\"><h2>Research Canvas</h2></main>",
      css: "main { padding: 16px; }",
      ui_js: "export function loadCards() { return []; }",
      esm_dependencies: [],
      worker_js: "",
      npm_dependencies: [],
    },
    compiled_html: "<!doctype html><html><body>Research Canvas</body></html>",
    ai_context: {
      original_prompt: "Organize research notes into comparison columns.",
      iteration_history: [],
    },
  },
];
let runningMiniAppWorkers = ["space-focus-timer"];

// miniapp market (wave 5): the dev catalogue, origins and submissions.
const devMarketOwner = { githubId: 1, login: "openbitfun", avatarUrl: "" };
const devMarketListings = [
  {
    listingId: "lst-standup",
    slug: "standup-board",
    name: "Standup Board",
    description: "A daily standup board that reads yesterday's commits and drafts your update.",
    icon: "layout-grid",
    category: "productivity",
    tags: ["team", "git"],
    owner: devMarketOwner,
    latestRelease: 3,
    minOpenBitFunVersion: "1.0.0",
    permissions: { fs: { read: ["{workspace}"] }, ai: { enabled: true } },
    screenshotUrls: [],
    ratingAverage: 4.6,
    ratingCount: 18,
    favoriteCount: 42,
    downloadCount: 1280,
    publishedAt: 1760000000000,
    changelog: "Groups commits by author and links pull requests.",
    license: { spdxExpression: "MIT" },
    repositoryUrl: "https://github.com/openbitfun/standup-board",
    releases: [
      { releaseId: "rel-standup-3", listingId: "lst-standup", releaseNumber: 3, minOpenBitFunVersion: "1.0.0", changelog: "", packageSha256: "a3", packageSize: 1024, reviewBundleHash: "", permissions: {}, publishedAt: 1760000000000, yanked: false },
      { releaseId: "rel-standup-2", listingId: "lst-standup", releaseNumber: 2, minOpenBitFunVersion: "1.0.0", changelog: "", packageSha256: "a2", packageSize: 1024, reviewBundleHash: "", permissions: {}, publishedAt: 1750000000000, yanked: false },
    ],
  },
  {
    listingId: "lst-weather",
    slug: "weather-glance",
    name: "Weather Glance",
    description: "Today's forecast for the cities you care about.",
    icon: "globe",
    category: "utilities",
    tags: ["weather"],
    owner: devMarketOwner,
    latestRelease: 1,
    minOpenBitFunVersion: "1.0.0",
    permissions: { net: { allow: ["api.open-meteo.com"] } },
    screenshotUrls: [],
    ratingAverage: 4.1,
    ratingCount: 7,
    favoriteCount: 12,
    downloadCount: 310,
    publishedAt: 1758000000000,
    changelog: "First release.",
    license: { spdxExpression: "Apache-2.0" },
    releases: [
      { releaseId: "rel-weather-1", listingId: "lst-weather", releaseNumber: 1, minOpenBitFunVersion: "1.0.0", changelog: "", packageSha256: "b1", packageSize: 900, reviewBundleHash: "", permissions: {}, publishedAt: 1758000000000, yanked: false },
    ],
  },
];
const devMarketOrigins = {};
const devMarketSubmissions = [
  { submissionId: "sub-1", slug: "focus-timer", name: "Focus Timer", icon: "box", releaseNumber: 2, status: "submitted", createdAt: 1761000000000, updatedAt: 1761000000000 },
  { submissionId: "sub-2", slug: "regex-lab", name: "Regex Lab", icon: "regex", releaseNumber: 1, status: "rejected", rejectionReason: "The package asks for shell access it does not use.", createdAt: 1759000000000, updatedAt: 1759500000000 },
];

// Remote Connect & Messaging Bots state
let remoteFormState = {
  telegram_bot_token: "",
  feishu_app_id: "",
  feishu_app_secret: "",
  weixin_ilink_token: "",
  weixin_base_url: "",
  weixin_bot_account_id: "",
};
let remoteBotConnected = "Telegram(@openbitfun_bot)";
let remoteBotVerboseMode = false;
const remoteMethods = [
  { id: "bot_feishu", name: "Feishu Bot", available: true, description: "Via Feishu messenger" },
  { id: "bot_telegram", name: "Telegram Bot", available: true, description: "Via Telegram" },
  { id: "bot_weixin", name: "WeChat (Weixin)", available: true, description: "Via WeChat iLink bot" },
];

// Account & Insights state. `account_identity` answers the backend's identity
// projection (an email account shows its email).
const devEmailIdentity = {
  provider: "email",
  accountId: "email-424201",
  displayName: "studio@example.com",
  initial: "S",
};
let devIdentity = devEmailIdentity;
let devAccountLoggedIn = true;
let devAccountSyncEnabled = true;

const DEV_SETTINGS_DESCRIPTOR = {
  "ai.browser_control_auto_connect_on_startup": { constrained: true, default: false, type: "boolean" },
  "ai.browser_control_preferred_browser": { constrained: false, default: "" },
  "ai.computer_use_enabled": { constrained: true, default: true, type: "boolean" },
  "ai.enable_deferred_tool_loading": { constrained: true, default: true, type: "boolean" },
  "ai.proxy.enabled": { constrained: false, default: false },
  "ai.proxy.password": { constrained: false, default: null },
  "ai.proxy.url": { constrained: false, default: "" },
  "ai.proxy.username": { constrained: false, default: null },
  "ai.stream_idle_timeout_secs": { constrained: true, default: 600, maximum: 86400, minimum: 1, nullable: true, type: "integer" },
  "ai.stream_ttft_timeout_secs": { constrained: true, default: 600, maximum: 86400, minimum: 1, nullable: true, type: "integer" },
  "ai.subagent_batch_execution_policy": { constrained: true, default: "force_parallel", enum: ["safe_only", "force_parallel", "serial"], type: "string" },
  "ai.subagent_max_concurrency": { constrained: true, default: 5, maximum: 32, minimum: 1, type: "integer" },
  "ai.swarm_max_concurrency": { constrained: true, default: 16, maximum: 64, minimum: 1, type: "integer" },
  "ai.tool_execution_timeout_secs": { constrained: true, default: null, maximum: 86400, minimum: 1, nullable: true, type: "integer" },
  "ai.tool_presentation_mode": { constrained: true, default: "native", enum: ["native", "ptc", "ptc_python"], type: "string" },
  "ai.user_question_timeout_secs": { constrained: false, default: 180 },
  "app.ai_experience.enable_git_commit_coauthor": { constrained: false, default: true },
  "app.ai_experience.enable_prompt_suggestion": { constrained: false, default: true },
  "app.ai_experience.enable_session_title_generation": { constrained: false, default: true },
  "app.ai_experience.enable_workspace_search": { constrained: false, default: false },
  "app.ai_experience.voice_input.default_language": { constrained: false, default: "auto" },
  "app.ai_experience.voice_input.enabled": { constrained: false, default: true },
  "app.ai_experience.voice_input.max_recording_seconds": { constrained: false, default: 60 },
  "app.ai_experience.voice_input.microphone_device_id": { constrained: false, default: "" },
  "app.auto_update": { constrained: true, default: true, type: "boolean" },
  "app.close_button_behavior": { constrained: true, default: "minimize_to_tray", enum: ["ask", "minimize_to_tray", "quit"], type: "string" },
  "app.flow_chat.auto_show_selection_toolbar": { constrained: true, default: true, type: "boolean" },
  "app.hooks.enabled": { constrained: false, default: true },
  "app.hooks.project_hooks_enabled": { constrained: false, default: false },
  "app.logging.include_sensitive_diagnostics": { constrained: true, default: false, type: "boolean" },
  "app.logging.level": { constrained: true, default: "debug", enum: ["error", "warn", "info", "debug", "trace", "off"], type: "string" },
  "app.notifications.dialog_completion_notify": { constrained: true, default: true, type: "boolean" },
  "app.notifications.permission_request_notify": { constrained: true, default: true, type: "boolean" },
  "app.prevent_sleep": { constrained: false, default: false },
  "app.worktrees.autoDeleteEnabled": { constrained: true, default: true, type: "boolean" },
  "app.worktrees.autoDeleteLimit": { constrained: true, default: 15, maximum: 100, minimum: 1, type: "integer" },
  "app.worktrees.branchPrefix": { constrained: true, default: "openbitfun/", maxLength: 200, minLength: 1, type: "string" },
  "app.worktrees.copyLocalChanges": { constrained: true, default: false, type: "boolean" },
  "app.worktrees.rootPath": { constrained: true, default: "~/.openbitfun/worktrees", maxLength: 4096, minLength: 1, type: "string" },
  "editor.font_size": { constrained: true, default: 14, maximum: 32, minimum: 10, type: "integer" },
  "editor.line_numbers": { constrained: true, default: "on", enum: ["on", "off", "relative", "interval"], type: "string" },
  "editor.minimap.enabled": { constrained: true, default: true, type: "boolean" },
  "editor.tab_size": { constrained: true, default: 4, maximum: 8, minimum: 1, type: "integer" },
  "editor.word_wrap": { constrained: true, default: "off", enum: ["off", "on", "wordWrapColumn", "bounded"], type: "string" },
  "memories.consolidation_model": { constrained: false, default: null },
  "memories.external_context_policy": { constrained: false, default: "clear_tool_results" },
  "memories.extract_model": { constrained: false, default: null },
  "memories.generate_for_btw_sessions": { constrained: false, default: false },
  "memories.generate_memories": { constrained: false, default: false },
  "memories.max_raw_memories_for_consolidation": { constrained: false, default: 64 },
  "memories.max_rollout_age_days": { constrained: false, default: 10 },
  "memories.max_rollouts_per_startup": { constrained: false, default: 2 },
  "memories.max_rollouts_scan_limit": { constrained: false, default: 2000 },
  "memories.max_unused_days": { constrained: false, default: 30 },
  "memories.min_rollout_idle_hours": { constrained: false, default: 6 },
  "memories.phase1_max_concurrency": { constrained: false, default: 1 },
  "memories.use_memories": { constrained: false, default: false },
  "terminal.cursor_style": { constrained: false, default: "block" },
  "terminal.font_size": { constrained: false, default: 14 },
  "terminal.scrollback": { constrained: false, default: 1000 },
};

const devInsightsReports = [
  {
    meta: {
      generated_at: 1763000000000,
      total_sessions: 28,
      analyzed_sessions: 24,
      date_range: { start: "2026-10-19", end: "2026-11-18" },
      path: "/workspace/demo/.openbitfun/insights/2026-11-18.json",
      total_messages: 342,
      days_covered: 30,
      total_hours: 19.5,
      top_goals: ["NSH UI migration", "Remote surface parity", "Automated verification"],
      languages: ["TypeScript", "Rust", "Markdown"],
      session_usage: {
        input_tokens: 420000,
        output_tokens: 95000,
        total_tokens: 515000,
        turns_with_usage: 140,
        output_reported_turns: 140,
        total_turns: 152,
      },
      generation_usage: {
        input_tokens: 18000,
        output_tokens: 4200,
        total_tokens: 22200,
        reasoning_tokens: 1200,
        cached_input_tokens: 6000,
        cache_creation_input_tokens: 0,
        model_calls: 3,
        reported_model_calls: 3,
      },
      generation_models: ["gpt-4.1-mini"],
    },
    report: {
      generated_at: 1763000000000,
      date_range: { start: "2026-10-19", end: "2026-11-18" },
      total_sessions: 28,
      analyzed_sessions: 24,
      total_messages: 342,
      days_covered: 30,
      session_usage: {
        input_tokens: 420000,
        output_tokens: 95000,
        total_tokens: 515000,
        turns_with_usage: 140,
        output_reported_turns: 140,
        total_turns: 152,
      },
      generation_usage: {
        input_tokens: 18000,
        output_tokens: 4200,
        total_tokens: 22200,
        reasoning_tokens: 1200,
        cached_input_tokens: 6000,
        cache_creation_input_tokens: 0,
        model_calls: 3,
        reported_model_calls: 3,
      },
      generation_models: ["gpt-4.1-mini"],
      stats: {
        total_hours: 19.5,
        msgs_per_day: 11.4,
        top_tools: [["Read", 184], ["Edit", 96], ["Bash", 64]],
        top_goals: [["NSH UI migration", 14], ["Git workbench", 6], ["Cron routines", 4]],
        outcomes: { completed: 21, partial: 3 },
        satisfaction: { high: 20, medium: 4 },
        session_types: { implementation: 16, review: 8 },
        languages: { TypeScript: 19, Rust: 5 },
        hour_counts: { 9: 6, 10: 8, 14: 10 },
        agent_types: { Standard: 18, Ultimate: 6 },
        response_time_buckets: { "0-5s": 90, "5-15s": 50 },
        median_response_time_secs: 4.2,
        avg_response_time_secs: 6.1,
        friction: { "Missing fixture": 2 },
        success: { "First-pass tests": 19 },
        tool_errors: { timeout: 1 },
        total_lines_added: 1840,
        total_lines_removed: 410,
        total_files_modified: 42,
      },
      at_a_glance: {
        whats_working: "Focused scene-level stores and headless NSH tests catch wire-shape drift immediately.",
        whats_hindering: "Occasional positional vs request-struct mismatches across desktop commands.",
        quick_wins: "Schedule a morning diff audit routine to flag uncommitted theme drift early.",
        looking_ahead: "Unify personal assistant persona files with scheduled workspace summaries.",
      },
      interaction_style: {
        narrative: "Short, iterative specifications paired with targeted automated verification after each edit.",
        key_patterns: ["Reactive signal bindings", "Contract-first host wrappers", "Explicit remote degradation"],
      },
      project_areas: [
        { name: "Personal Agent Studio UI", session_count: 14, description: "Unified 12-scene NSH shell with Obsidian Carbon & Daylight Alabaster tokens." },
        { name: "Remote & Peer Transport", session_count: 6, description: "Controller-local guards and HostInvoke envelope routing." },
      ],
      wins_intro: "Strong momentum across UI primitives and multi-scene parity.",
      big_wins: [
        { title: "Zero-import page host bridge", description: "Self-contained dev fixtures simulate all 12 desktop scenes in plain browsers.", impact: "Instant browser preview" },
      ],
      friction_intro: "Minor friction around remote capability boundaries.",
      friction_categories: [
        { category: "Command shape checks", count: 2, description: "Positional vs wrapped request parameters.", examples: ["git_get_graph"], suggestion: "Verify Rust signatures before wiring stores." },
      ],
      suggestions: {
        openbitfun_md_additions: [],
        features_to_try: [
          { feature: "Routines Calendar", description: "Automate morning workspace digests.", example_usage: "Every day at 09:00", benefit: "Saves 15m/day" },
        ],
        usage_patterns: [],
      },
      horizon_intro: "Next opportunities for autonomous collaboration.",
      on_the_horizon: [
        { title: "Proactive PR & Diff Briefings", whats_possible: "Pair Git Workbench diffs with morning Cron summaries.", how_to_try: "Create a routine targeting Standard mode.", copyable_prompt: "Summarize uncommitted changes and open branches." },
      ],
      fun_ending: {
        headline: "24 sessions shipped with zero raw pixel font sizes.",
        detail: "Every control scales uniformly with the host font preference.",
      },
      html_report_path: null,
    },
  },
];

let insightsSeq = 2;
let devSessionSeq = 10;
let devTerminalSeq = 1;
const devTerminalProfiles = {};
function devTerminalProfilesAnswer(workspaceId) {
  return { workspaceId, profiles: devTerminalProfiles[workspaceId] || [], maxProfiles: 20 };
}
const devTerminalBuffers = {};

function isDevAssistantWorkspace(workspaceId, workspacePath) {
  const id = String(workspaceId || "").trim();
  const path = String(workspacePath || "").trim();
  const all = [...devWorkspaces, ...devAssistants];
  const match = (id ? all.find(w => w.id === id) : null) || (path ? all.find(w => w.rootPath === path) : null);
  return Boolean(match && String(match.workspaceKind || "").toLowerCase() === "assistant");
}

const DEV_FIXTURES = {
  // Workspaces & Sessions
  get_opened_workspaces: () => devWorkspaces,
  // Recent rows the host remembers but has not opened; reopening one moves it to
  // the opened list, as `open_workspace` by id does on the desktop.
  get_recent_workspaces: () => [...devWorkspaces, ...devRecentOnlyWorkspaces],
  get_current_workspace: () => devWorkspaces.find(w => w.id === activeWorkspaceId) || null,
  remove_recent_workspace: args => {
    const req = payloadOf(args);
    const idx = devRecentOnlyWorkspaces.findIndex(w => w.id === String(req.workspaceId || ""));
    if (idx >= 0) devRecentOnlyWorkspaces.splice(idx, 1);
    return null;
  },
  update_workspace_info: args => {
    const req = payloadOf(args);
    const ws = devWorkspaces.find(w => w.id === String(req.workspaceId || ""));
    if (!ws) throw new Error(`Workspace not found: ${String(req.workspaceId || "")}`);
    if (typeof req.name === "string" && req.name.trim()) ws.name = req.name.trim();
    return ws;
  },
  reveal_in_explorer: () => {
    throw new Error("The development host has no file manager");
  },
  reveal_session_storage_directory: () => {
    throw new Error("The development host has no file manager");
  },
  export_session_transcript: args => {
    const req = payloadOf(args);
    return {
      sessionId: String(req.session_id || ""),
      transcriptPath: `/tmp/openbitfun-dev/${String(req.session_id || "session")}.md`,
      generatedAt: Date.now(),
    };
  },
  open_workspace: args => {
    const req = payloadOf(args);
    if (req.workspaceId) {
      const id = String(req.workspaceId);
      const opened = devWorkspaces.find(w => w.id === id);
      if (opened) {
        activeWorkspaceId = id;
        return opened;
      }
      const idx = devRecentOnlyWorkspaces.findIndex(w => w.id === id);
      if (idx < 0) throw new Error(`Workspace not found: ${id}`);
      const [record] = devRecentOnlyWorkspaces.splice(idx, 1);
      devWorkspaces.push(record);
      activeWorkspaceId = id;
      return record;
    }
    const rootPath = String(req.path || "").trim();
    if (!rootPath) throw new Error("Workspace path is required");
    const existing = devWorkspaces.find(w => w.rootPath === rootPath);
    if (existing) {
      activeWorkspaceId = existing.id;
      return existing;
    }
    const parts = rootPath.split("/").filter(Boolean);
    const created = {
      id: `dev-workspace-${devWorkspaces.length + 1}`,
      name: parts[parts.length - 1] || rootPath,
      rootPath,
      workspaceKind: "local",
      lastAccessed: Date.now(),
    };
    devWorkspaces.push(created);
    activeWorkspaceId = created.id;
    return created;
  },
  set_active_workspace: args => {
    const req = payloadOf(args);
    if (req.workspaceId) activeWorkspaceId = String(req.workspaceId);
    return null;
  },
  close_workspace: args => {
    const req = payloadOf(args);
    const wsId = String(req.workspaceId || "");
    const idx = devWorkspaces.findIndex(w => w.id === wsId);
    if (idx >= 0) {
      devWorkspaces.splice(idx, 1);
      if (devActiveRemoteWorkspace && devActiveRemoteWorkspace.workspaceId === wsId) {
        devActiveRemoteWorkspace = null;
      }
      if (activeWorkspaceId === wsId) {
        activeWorkspaceId = devWorkspaces[0] ? devWorkspaces[0].id : "";
      }
    }
    return null;
  },
  list_persisted_sessions_page: args => {
    const req = payloadOf(args);
    const wsId = req.workspace_id || activeWorkspaceId;
    const rows = devSessions.filter(s => !wsId || s.workspaceId === wsId);
    return {
      sessions: rows,
      totalTopLevelCount: rows.length,
      loadedTopLevelCount: rows.length,
      hasMore: false,
    };
  },
  load_session_turns: args => {
    const req = payloadOf(args);
    return DEV_SESSION_TURNS[req.session_id] || [];
  },
  // transcript view (wave 4): the dev host projects its fixture turns the way
  // the backend's transcript view does (full window, no cursor).
  get_session_transcript_view: args => {
    const req = payloadOf(args);
    const sessionId = req.session_id || req.sessionId;
    const turns = (DEV_SESSION_TURNS[sessionId] || []).map((turn, position) => {
      const items = [];
      let durationMs = 0;
      let model;
      (turn.modelRounds || []).forEach((round, roundIndex) => {
        if (round.effectiveModelName) model = round.effectiveModelName;
        if (typeof round.durationMs === "number") durationMs += round.durationMs;
        const ordered = [];
        let seq = 0;
        for (const item of round.thinkingItems || []) {
          if (item.content) ordered.push({ order: item.orderIndex, seq: seq++, item: { kind: "thinking", id: item.id, roundIndex, text: item.content } });
        }
        for (const item of round.textItems || []) {
          if (item.content) ordered.push({ order: item.orderIndex, seq: seq++, item: { kind: "text", id: item.id, roundIndex, text: item.content } });
        }
        for (const item of round.toolItems || []) {
          const result = item.toolResult || {};
          ordered.push({
            order: item.orderIndex,
            seq: seq++,
            item: {
              kind: "tool",
              roundIndex,
              tool: {
                id: item.id,
                name: item.toolName,
                input: (item.toolCall || {}).input ?? null,
                status: item.status || (item.toolResult ? "completed" : "running"),
                ...(typeof result.success === "boolean" ? { success: result.success } : {}),
                ...(result.result !== undefined ? { result: result.result } : {}),
                ...(typeof item.durationMs === "number" ? { durationMs: item.durationMs } : {}),
                startMs: item.startTime || 0,
              },
            },
          });
        }
        ordered.sort((left, right) => (left.order ?? 1e9) - (right.order ?? 1e9) || left.seq - right.seq);
        for (const entry of ordered) items.push(entry.item);
      });
      return {
        turnId: turn.turnId || turn.id,
        turnIndex: typeof turn.turnIndex === "number" ? turn.turnIndex : position,
        kind: "user_dialog",
        status: "done",
        settled: true,
        user: { id: turn.userMessage.id, text: turn.userMessage.content, timestampMs: turn.userMessage.timestamp || 0 },
        items,
        ...(model ? { effectiveModel: model } : {}),
        ...(durationMs ? { durationMs } : {}),
        startTimeMs: turn.timestamp || 0,
        assistantTimestampMs: turn.timestamp || 0,
      };
    });
    return { sessionId, mode: "full", turns, hasEarlier: false };
  },
  create_session: args => {
    const req = payloadOf(args);
    const sessionId = `dev-session-${devSessionSeq++}`;
    const workspaceId = req.workspaceId || req.workspace_id || activeWorkspaceId;
    const assistant = isDevAssistantWorkspace(workspaceId, req.workspacePath || req.workspace_path);
    const created = {
      sessionId,
      sessionName: req.sessionName || "New thread",
      lastUpdated: Date.now(),
      createdAt: Date.now(),
      messageCount: 0,
      workspaceId,
      agentType: assistant ? "Claw" : (req.agentType || "Standard"),
      modelName: "gpt-4.1-mini",
      status: "active",
    };
    devSessions.unshift(created);
    DEV_SESSION_TURNS[sessionId] = [];
    return created;
  },
  save_session_metadata: args => {
    const req = payloadOf(args);
    const id = req.session_id || req.sessionId;
    const found = devSessions.find(s => s.sessionId === id);
    if (found && typeof req.session_name === "string") found.sessionName = req.session_name;
    return null;
  },
  archive_session: args => {
    const req = payloadOf(args);
    const id = req.session_id || req.sessionId;
    const found = devSessions.find(s => s.sessionId === id);
    if (found) found.persistedStatus = "archived";
    return null;
  },
  unarchive_session: args => {
    const req = payloadOf(args);
    const id = req.session_id || req.sessionId;
    const found = devSessions.find(s => s.sessionId === id);
    if (found) found.persistedStatus = "active";
    return null;
  },
  delete_persisted_session: args => {
    const req = payloadOf(args);
    const id = req.session_id || req.sessionId;
    devSessions = devSessions.filter(s => s.sessionId !== id);
    return null;
  },
  fork_session: args => {
    const req = payloadOf(args);
    const sessionId = `dev-session-${devSessionSeq++}`;
    const src = devSessions.find(s => s.sessionId === (req.session_id || req.sessionId));
    const forked = {
      sessionId,
      sessionName: `${src ? src.sessionName : "Thread"} (fork)`,
      lastUpdated: Date.now(),
      createdAt: Date.now(),
      messageCount: src ? src.messageCount : 0,
      workspaceId: req.workspace_id || activeWorkspaceId,
      agentType: src ? src.agentType : "Standard",
      modelName: "gpt-4.1-mini",
      status: "active",
    };
    devSessions.unshift(forked);
    DEV_SESSION_TURNS[sessionId] = [...(DEV_SESSION_TURNS[src?.sessionId] || [])];
    return forked;
  },
  copy_session: args => {
    const req = payloadOf(args);
    const sessionId = `dev-session-${devSessionSeq++}`;
    const src = devSessions.find(s => s.sessionId === (req.session_id || req.sessionId));
    const copied = {
      sessionId,
      sessionName: `${src ? src.sessionName : "Thread"} (copy)`,
      lastUpdated: Date.now(),
      createdAt: Date.now(),
      messageCount: src ? src.messageCount : 0,
      workspaceId: req.workspace_id || activeWorkspaceId,
      agentType: src ? src.agentType : "Standard",
      modelName: "gpt-4.1-mini",
      status: "active",
    };
    devSessions.unshift(copied);
    DEV_SESSION_TURNS[sessionId] = [...(DEV_SESSION_TURNS[src?.sessionId] || [])];
    return copied;
  },
  get_ai_model_catalog: () => ({
    models: devConfigs["ai.models"] || [],
    defaultModels: devConfigs["ai.default_models"] || {},
  }),
  get_session_model_target: args => {
    const req = payloadOf(args);
    const sid = String(req.sessionId || "");
    const found = devSessions.find(s => s.sessionId === sid);
    const modelRef = (found && found.modelName) || "model-1";
    return {
      sessionId: sid,
      selection: { kind: "model", model_ref: modelRef },
      reasoningPreset: null,
    };
  },
  project_ai_model_reasoning_catalog: () => ({ status: "known", default_preset: null, presets: [] }),
  subscribe_permission_requests: () => null,
  list_pending_permission_requests: () => [],
  get_session_interaction_mailbox: args => {
    const req = payloadOf(args);
    return {
      sessionId: String(req.sessionId || ""),
      userQuestions: { revision: 1, questions: [] },
      permissions: { requests: [] },
    };
  },

  // Config
  get_configs: () => ({
    ...devConfigs,
    app: { ...devConfigs.app },
  }),
  get_config: args => {
    const req = payloadOf(args);
    const path = req.path;
    if (path === "app") {
      return { ...devConfigs.app };
    }
    if (path === "app.language") {
      return devConfigs.app.language;
    }
    if (!(path in devConfigs)) {
      // A dotted leaf resolves inside the document that holds it, as on the host.
      const segments = String(path || "").split(".");
      for (let cut = segments.length - 1; cut > 0; cut -= 1) {
        const parent = segments.slice(0, cut).join(".");
        if (!(parent in devConfigs)) continue;
        let node = devConfigs[parent];
        for (const segment of segments.slice(cut)) {
          node = node && typeof node === "object" && !Array.isArray(node) ? node[segment] : undefined;
        }
        if (node !== undefined) return node;
        break;
      }
      throw new Error(`Config path '${path}' not found`);
    }
    return devConfigs[path];
  },
  set_config: args => {
    const req = payloadOf(args);
    if (!req.path) return null;
    if (req.path === "app" && req.value && typeof req.value === "object") {
      const nextApp = { ...devConfigs.app, ...req.value };
      if (typeof nextApp.language === "string") {
        const canonical = normalizeDevLocale(nextApp.language) || nextApp.language;
        nextApp.language = canonical;
        devConfigs["app.language"] = canonical;
        devConfigs["appearance.language"] = canonical;
      }
      devConfigs.app = nextApp;
      return null;
    }
    if (req.path === "app.language" || req.path === "appearance.language") {
      const canonical = normalizeDevLocale(req.value) || String(req.value || "en-US");
      devConfigs.app = { ...devConfigs.app, language: canonical };
      devConfigs["app.language"] = canonical;
      devConfigs["appearance.language"] = canonical;
      return null;
    }
    devConfigs[req.path] = req.value;
    return null;
  },

  // Agents & Modes
  get_available_modes: () => [
    ...devBuiltinModes,
    ...devCustomModes.map(m => ({
      id: m.agentId,
      name: m.name,
      description: m.description,
      source: m.level,
      isReadonly: m.readonly,
      toolCount: m.tools.length,
      defaultTools: m.tools,
    })),
  ],
  // session policy (wave 3)
  get_session_mode_catalog: args => {
    const req = payloadOf(args);
    const allRows = DEV_FIXTURES.get_available_modes(args);
    const session = devSessions.find(s => s.sessionId === req.sessionId);
    const started = Boolean(session) && Number(session.messageCount || 0) > 0;
    const assistant = isDevAssistantWorkspace(
      req.workspaceId || (session && session.workspaceId),
      req.workspacePath,
    );
    if (assistant) {
      const clawRow = allRows.find(row => String(row.id || "").toLowerCase() === "claw");
      const switchable = !started || String((session && session.agentType) || "").toLowerCase() === "claw";
      return {
        entries: [
          {
            id: "Claw",
            label: (clawRow && clawRow.name) || "Claw",
            description: (clawRow && clawRow.description) || "Personal assistant for daily tasks",
            profile: false,
            switchable,
          },
        ],
        defaultModeId: "Claw",
        ...(session ? { sessionModeId: session.agentType || "Claw", sessionStarted: started } : {}),
      };
    }
    const profiles = ["Minimal", "Standard", "Ultimate", "Creative"];
    const rows = allRows.filter(row => row.id.toLowerCase() !== "claw");
    const entries = [
      ...profiles.flatMap(name => rows.filter(row => row.id === name)),
      ...rows.filter(row => !profiles.includes(row.id)),
    ].map(row => ({
      id: row.id,
      label: row.name || row.id,
      description: row.description || "",
      profile: profiles.includes(row.id),
      switchable: !started || row.id === (session && session.agentType),
    }));
    return {
      entries,
      defaultModeId: "Standard",
      ...(session ? { sessionModeId: session.agentType || "Standard", sessionStarted: started } : {}),
    };
  },
  list_session_commands: () => [
    { id: "compact", command: "/compact", labelKey: "chat.slash.compact", description: "Summarize the conversation to free context", idleOnly: true, available: true },
    { id: "init", command: "/init", labelKey: "chat.slash.init", description: "Generate or update AGENTS.md for this workspace", idleOnly: true, available: true },
    { id: "reload", command: "/reload", labelKey: "chat.slash.reload", description: "Reload skills and project instructions", idleOnly: false, available: true, args: ["skills", "instructions"] },
  ],
  execute_session_command: args => {
    const req = payloadOf(args);
    const outcome = { compact: "compaction_started", init: "init_started", reload: "reloaded" }[req.id];
    if (!outcome) throw new Error(`unknown_session_command: ${req.id}`);
    return { id: req.id, outcome };
  },
  mark_session_seen: () => ({ changed: true }),
  update_session_mode: args => {
    const req = payloadOf(args);
    const session = devSessions.find(s => s.sessionId === req.sessionId);
    const assistant = isDevAssistantWorkspace(
      req.workspaceId || (session && session.workspaceId),
      req.workspacePath,
    );
    const isClawSession = Boolean(session && String(session.agentType || "").toLowerCase() === "claw");
    if ((assistant || isClawSession) && String(req.modeId || "").trim().toLowerCase() !== "claw") {
      throw new Error(`session_mode_locked: assistant workspaces only support Claw; cannot switch to ${req.modeId}`);
    }
    if (session && req.modeId) {
      session.agentType = String(req.modeId).trim().toLowerCase() === "claw" ? "Claw" : req.modeId;
    }
    return null;
  },
  list_subagents: args => {
    const req = payloadOf(args);
    if (req.source) return devSubagents.filter(s => s.subagentSource === req.source || s.source === req.source);
    return devSubagents;
  },
  list_agent_tool_names: () => [...ALL_AGENT_TOOLS],
  get_agent_profile_configs: () => ({ ...devAgentProfiles }),
  set_agent_profile_config: args => {
    const req = payloadOf(args);
    const id = String(req.agentId || "");
    if (!id) throw new Error("agentId is required");
    const cfg = req.config || {};
    const existing = devAgentProfiles[id] || {
      profile_id: id,
      enabled_tools: [],
      default_tools: [],
      disabled_user_skills: [],
      enabled_user_skills: [],
    };
    devAgentProfiles[id] = {
      ...existing,
      enabled_tools: Array.isArray(cfg.enabled_tools) ? cfg.enabled_tools : existing.enabled_tools,
      disabled_user_skills: Array.isArray(cfg.disabled_user_skills)
        ? cfg.disabled_user_skills
        : existing.disabled_user_skills,
      enabled_user_skills: Array.isArray(cfg.enabled_user_skills)
        ? cfg.enabled_user_skills
        : existing.enabled_user_skills,
    };
    return `Agent profile for '${id}' set successfully`;
  },
  reset_agent_profile_config: args => {
    const req = payloadOf(args);
    const id = String(req.agentId || "");
    if (devAgentProfiles[id]) {
      devAgentProfiles[id] = {
        ...devAgentProfiles[id],
        enabled_tools: [...devAgentProfiles[id].default_tools],
        disabled_user_skills: [],
        enabled_user_skills: [],
      };
    }
    return `Agent profile for '${id}' reset successfully`;
  },
  get_custom_agent_detail: args => {
    const req = payloadOf(args);
    const id = String(req.agentId || "");
    const found = devCustomModes.find(m => m.agentId === id);
    if (found) return found;
    const sub = devSubagents.find(s => s.id === id);
    if (sub) {
      return {
        agentId: sub.id,
        kind: "subagent",
        name: sub.name,
        description: sub.description,
        prompt: sub.prompt || "",
        tools: [...(sub.defaultTools || [])],
        readonly: Boolean(sub.isReadonly),
        review: Boolean(sub.isReview),
        model: sub.model || "primary",
        path: sub.path || `/workspace/subagents/${sub.id}.md`,
        userContextPolicy: [],
        level: sub.subagentSource === "project" ? "project" : "user",
      };
    }
    throw new Error(`Custom agent '${id}' not found`);
  },
  create_custom_agent: args => {
    const req = payloadOf(args);
    const kind = req.kind === "subagent" ? "subagent" : "mode";
    const id = String(req.id || "").trim();
    const level = req.level === "project" ? "project" : "user";
    if (!id) throw new Error("Id cannot be empty");
    if (kind === "subagent") {
      const tools = Array.isArray(req.tools) ? req.tools : ["Read", "Grep", "Glob"];
      devSubagents.push({
        key: `${level}:${id}`,
        id,
        name: req.name || id,
        description: req.description || "",
        prompt: req.prompt || "",
        isReadonly: Boolean(req.readonly),
        isReview: Boolean(req.review),
        toolCount: tools.length,
        defaultTools: tools,
        defaultEnabled: true,
        effectiveEnabled: true,
        source: level,
        subagentSource: level,
        level,
        path: `/workspace/${level}/subagents/${id}.md`,
        model: req.model || "primary",
        modelIsExplicit: Boolean(req.model),
        supportsFollowUp: true,
      });
      return null;
    }
    devCustomModes.push({
      agentId: id,
      kind: "mode",
      name: req.name || id,
      description: req.description || "",
      prompt: req.prompt || "",
      tools: Array.isArray(req.tools) ? req.tools : ["Read", "Grep", "Glob"],
      readonly: Boolean(req.readonly),
      review: Boolean(req.review),
      model: req.model || "primary",
      path: `/workspace/${level}/agents/${id}.md`,
      userContextPolicy: [],
      level,
      source: level,
    });
    return null;
  },
  update_custom_agent: args => {
    const req = payloadOf(args);
    const id = String(req.agentId || "");
    const idx = devCustomModes.findIndex(m => m.agentId === id);
    if (idx >= 0) {
      devCustomModes[idx] = {
        ...devCustomModes[idx],
        name: req.name ?? devCustomModes[idx].name,
        description: req.description ?? devCustomModes[idx].description,
        prompt: req.prompt ?? devCustomModes[idx].prompt,
        tools: Array.isArray(req.tools) ? req.tools : devCustomModes[idx].tools,
        readonly: req.readonly !== undefined ? Boolean(req.readonly) : devCustomModes[idx].readonly,
        model: req.model ?? devCustomModes[idx].model,
      };
    }
    return null;
  },
  delete_custom_agent: args => {
    const req = payloadOf(args);
    const id = String(req.agentId || "");
    const idx = devCustomModes.findIndex(m => m.agentId === id);
    if (idx >= 0) devCustomModes.splice(idx, 1);
    return null;
  },
  reload_custom_agents: () => null,
  get_subagent_detail: args => {
    const req = payloadOf(args);
    const id = String(req.subagentId || "");
    const sub = devSubagents.find(s => s.id === id);
    if (!sub) throw new Error(`Subagent '${id}' not found`);
    return {
      subagentId: sub.id,
      name: sub.name,
      description: sub.description,
      prompt: sub.prompt || "Carry out assigned tasks concisely.",
      tools: [...(sub.defaultTools || [])],
      readonly: Boolean(sub.isReadonly),
      review: Boolean(sub.isReview),
      enabled: sub.effectiveEnabled !== false,
      model: sub.model || "primary",
      path: sub.path || `/workspace/subagents/${sub.id}.md`,
      level: sub.subagentSource === "project" ? "project" : "user",
    };
  },
  create_subagent: args => {
    const req = payloadOf(args);
    const name = String(req.name || req.id || "").trim();
    const id = String(req.id || name.replace(/\s+/g, "-")).trim();
    const level = req.level === "project" ? "project" : "user";
    const tools = Array.isArray(req.tools) ? req.tools : ["Read", "Grep", "Glob"];
    devSubagents.push({
      key: `${level}:${id}`,
      id,
      name: name || id,
      description: req.description || "",
      prompt: req.prompt || "",
      isReadonly: Boolean(req.readonly),
      isReview: Boolean(req.review),
      toolCount: tools.length,
      defaultTools: tools,
      defaultEnabled: true,
      effectiveEnabled: true,
      source: level,
      subagentSource: level,
      level,
      path: `/workspace/${level}/subagents/${id}.md`,
      model: req.model || "primary",
      modelIsExplicit: Boolean(req.model),
      supportsFollowUp: true,
    });
    return null;
  },
  update_subagent: args => {
    const req = payloadOf(args);
    const id = String(req.subagentId || "");
    const sub = devSubagents.find(s => s.id === id);
    if (sub) {
      if (req.name) sub.name = req.name;
      if (req.description !== undefined) sub.description = req.description;
      if (req.prompt !== undefined) sub.prompt = req.prompt;
      if (Array.isArray(req.tools)) {
        sub.defaultTools = req.tools;
        sub.toolCount = req.tools.length;
      }
      if (req.readonly !== undefined) sub.isReadonly = Boolean(req.readonly);
      if (req.review !== undefined) sub.isReview = Boolean(req.review);
      if (req.model !== undefined) sub.model = req.model;
    }
    return null;
  },
  delete_subagent: args => {
    const req = payloadOf(args);
    const id = String(req.subagentId || "");
    const idx = devSubagents.findIndex(s => s.id === id);
    if (idx >= 0) devSubagents.splice(idx, 1);
    return null;
  },
  reload_subagents: () => null,
  update_subagent_config: args => {
    const req = payloadOf(args);
    const id = String(req.subagentId || "");
    const sub = devSubagents.find(s => s.id === id);
    let availabilityUpdated = false;
    let modelUpdated = false;
    if (sub) {
      if (typeof req.enabled === "boolean") {
        sub.effectiveEnabled = req.enabled;
        availabilityUpdated = true;
      }
      if (req.clearModelOverride) {
        sub.model = "primary";
        sub.modelIsExplicit = false;
        modelUpdated = true;
      } else if (typeof req.model === "string") {
        sub.model = req.model;
        sub.modelIsExplicit = true;
        modelUpdated = true;
      }
    }
    return { availabilityUpdated, modelUpdated };
  },

  // Assistants & Persona Studio
  get_assistant_workspaces: () => [...devAssistants],
  get_primary_assistant_workspace: () => devAssistants.find(a => a.id === primaryAssistantId) || null,
  create_assistant_workspace: args => {
    const num = assistantSeq++;
    const slug = `assistant-${num}`;
    const rootPath = `/workspace/assistants/${slug}`;
    const requestedName = String(payloadOf(args).name || "").trim();
    const created = {
      id: `dev-assistant-${num}`,
      name: requestedName || `Assistant ${num}`,
      identity: { name: requestedName || `Assistant ${num}` },
      rootPath,
      workspaceType: "normal",
      workspaceKind: "assistant",
      assistantId: slug,
      languages: ["markdown"],
      openedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      description: "Fresh personal assistant workspace ready for persona customization.",
      tags: ["assistant"],
      relatedPaths: [],
    };
    devAssistants.push(created);
    devWorkspaces.push(created);
    activeWorkspaceId = created.id;
    devFileContents[`${rootPath}/IDENTITY.md`] = defaultPersonaContent("IDENTITY.md", created.name);
    devFileContents[`${rootPath}/SOUL.md`] = defaultPersonaContent("SOUL.md", created.name);
    devFileContents[`${rootPath}/USER.md`] = defaultPersonaContent("USER.md", created.name);
    return created;
  },
  // assistant identity (wave 4): the host rewrites only the given IDENTITY.md fields.
  set_assistant_identity: args => {
    const req = payloadOf(args);
    const assistant = devAssistants.find(a => a.id === req.workspaceId);
    if (!assistant) throw new Error(`Workspace not found: ${req.workspaceId}`);
    const path = `${assistant.rootPath}/IDENTITY.md`;
    let content = devFileContents[path] || "---\n---\n";
    const identity = { ...(assistant.identity || {}) };
    for (const field of ["name", "creature", "vibe", "avatar", "emoji"]) {
      if (typeof req[field] !== "string") continue;
      const value = req[field].replace(/\s+/g, " ").trim();
      const line = value ? `${field}: ${JSON.stringify(value)}` : `${field}:`;
      const pattern = new RegExp(`^${field}\\s*:.*$`, "m");
      content = pattern.test(content) ? content.replace(pattern, line) : content.replace(/\n---\n/, `\n${line}\n---\n`);
      identity[field] = value || undefined;
    }
    devFileContents[path] = content;
    assistant.identity = identity;
    if (identity.name) assistant.name = identity.name;
    return { workspace: { ...assistant }, content };
  },
  set_primary_assistant_workspace: args => {
    const req = payloadOf(args);
    const target = devAssistants.find(a => a.id === req.workspaceId);
    if (!target) throw new Error(`Assistant workspace not found: ${req.workspaceId}`);
    primaryAssistantId = target.id;
    return target;
  },
  delete_assistant_workspace: args => {
    const req = payloadOf(args);
    if (req.workspaceId === primaryAssistantId) {
      throw new Error("Cannot delete the primary assistant workspace");
    }
    devAssistants = devAssistants.filter(a => a.id !== req.workspaceId);
    return null;
  },
  reset_assistant_workspace: args => {
    const req = payloadOf(args);
    const target = devAssistants.find(a => a.id === req.workspaceId);
    if (!target) throw new Error(`Assistant workspace not found: ${req.workspaceId}`);
    devFileContents[`${target.rootPath}/IDENTITY.md`] = defaultPersonaContent("IDENTITY.md", target.name);
    devFileContents[`${target.rootPath}/SOUL.md`] = defaultPersonaContent("SOUL.md", target.name);
    devFileContents[`${target.rootPath}/USER.md`] = defaultPersonaContent("USER.md", target.name);
    return target;
  },
  write_file_content: args => {
    const req = payloadOf(args);
    const filePath = String(req.filePath || "");
    if (!filePath) throw new Error("filePath is required");
    devFileContents[filePath] = String(req.content ?? "");
    return null;
  },
  reset_workspace_persona_files: args => {
    const req = payloadOf(args);
    const rootPath = String(req.workspacePath || "");
    const target = devAssistants.find(a => a.id === req.workspaceId || a.rootPath === rootPath);
    const label = target ? target.name : "Assistant";
    if (rootPath) {
      devFileContents[`${rootPath}/IDENTITY.md`] = defaultPersonaContent("IDENTITY.md", label);
      devFileContents[`${rootPath}/SOUL.md`] = defaultPersonaContent("SOUL.md", label);
      devFileContents[`${rootPath}/USER.md`] = defaultPersonaContent("USER.md", label);
    }
    return null;
  },

  // Files
  get_file_tree: () => [
    {
      name: "src",
      path: "/workspace/demo/src",
      isDirectory: true,
      children: [
        { name: "web-ui", path: "/workspace/demo/src/web-ui", isDirectory: true, children: [] },
        { name: "nsh-ui", path: "/workspace/demo/src/nsh-ui", isDirectory: true, children: [] },
      ],
    },
    {
      name: "docs",
      path: "/workspace/demo/docs",
      isDirectory: true,
      children: [{ name: "notes.md", path: "/workspace/demo/docs/notes.md", isDirectory: false, size: 640 }],
    },
    { name: "README.md", path: "/workspace/demo/README.md", isDirectory: false, size: 1280 },
  ],
  explorer_get_children: args => {
    const req = payloadOf(args);
    return devFiles[req.path] || [];
  },
  create_directory: args => {
    const req = payloadOf(args);
    const dirPath = normalizeRemoteDirPath(req.path || "");
    if (!dirPath) throw new Error("Directory path is required");
    const parent = parentRemoteDir(dirPath);
    const name = dirPath.split("/").filter(Boolean).pop() || dirPath;
    if (!devFiles[dirPath]) devFiles[dirPath] = [];
    if (!devFiles[parent]) devFiles[parent] = [];
    if (!devFiles[parent].some(entry => entry.path === dirPath)) {
      devFiles[parent].unshift({ name, path: dirPath, isDirectory: true });
    }
    return null;
  },
  delete_file: args => {
    const req = payloadOf(args);
    const filePath = String(req.filePath || req.path || "");
    if (!filePath) return null;
    delete devFileContents[filePath];
    const parent = parentRemoteDir(filePath);
    if (Array.isArray(devFiles[parent])) {
      devFiles[parent] = devFiles[parent].filter(entry => entry.path !== filePath);
    }
    const uIdx = devGitStatus.untracked.indexOf(filePath);
    if (uIdx >= 0) devGitStatus.untracked.splice(uIdx, 1);
    return null;
  },
  get_app_version: () => "2.0.0-dev",
  get_system_info: () => ({
    osType: "macos",
    platform: "darwin",
    arch: "aarch64",
    homeDir: "/workspace",
    username: "studio-user",
  }),
  search_files: args => {
    const req = payloadOf(args);
    const q = String(req.pattern || "").toLowerCase();
    const allPaths = [
      { name: "README.md", path: "/workspace/demo/README.md", isDirectory: false },
      { name: "notes.md", path: "/workspace/demo/docs/notes.md", isDirectory: false },
      { name: "App.tsx", path: "/workspace/demo/src/nsh-ui/App.tsx", isDirectory: false },
    ];
    return allPaths.filter(item => !q || item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q));
  },
  search_session_content: args => {
    const req = payloadOf(args);
    const q = String(req.query || "").toLowerCase();
    return {
      hits: devSessions
        .filter(s => !q || s.sessionName.toLowerCase().includes(q))
        .map(s => ({
          kind: "message",
          matchedField: "content",
          sessionId: s.sessionId,
          sessionTitle: s.sessionName,
          turnId: "turn-1",
          snippet: `Matched "${req.query || ""}" in ${s.sessionName}`,
          archived: false,
          updatedAtMs: s.lastUpdated,
          score: 1,
        })),
    };
  },
  read_file_content: args => {
    const req = payloadOf(args);
    const filePath = String(req.filePath || "");
    if (filePath && Object.prototype.hasOwnProperty.call(devFileContents, filePath)) {
      return devFileContents[filePath];
    }
    const base = filePath.split("/").pop() || "README.md";
    if (base === "IDENTITY.md" || base === "SOUL.md" || base === "USER.md" || base === "SKILL.md") {
      return defaultPersonaContent(base, "Personal Agent Studio");
    }
    return defaultPersonaContent("README.md");
  },

  // Skills & Marketplace
  get_skill_configs: args => {
    const req = payloadOf(args);
    const skills = devSkills.map(s => ({ ...s }));
    if (req.includeDiagnostics) {
      return { skills, diagnostics: [], importOperationsVersion: 3 };
    }
    return skills;
  },
  get_global_skill_settings: () => ({
    globallyDisabledUserSkillKeys: [...disabledUserSkillKeys],
    globallyDisabledProjectSkillKeys: [...disabledProjectSkillKeys],
    directSkillManagementVersion: 1,
  }),
  set_global_skill_disabled: args => {
    const req = payloadOf(args);
    const skillKey = String(req.skillKey || "");
    const disabled = Boolean(req.disabled);
    const targetSkill = devSkills.find(s => s.key === skillKey);
    const isProject = targetSkill ? targetSkill.level === "project" : skillKey.startsWith("project:");
    const list = isProject ? disabledProjectSkillKeys : disabledUserSkillKeys;
    const idx = list.indexOf(skillKey);
    if (disabled && idx < 0) list.push(skillKey);
    if (!disabled && idx >= 0) list.splice(idx, 1);
    return null;
  },
  validate_skill_path: args => {
    const req = payloadOf(args);
    const rawPath = String(req.path || "").trim();
    if (!rawPath) {
      return { valid: false, error: "Skill folder path cannot be empty." };
    }
    const name = rawPath.split("/").filter(Boolean).pop() || "custom-skill";
    return {
      valid: true,
      name,
      description: `Validated skill package from ${rawPath}`,
    };
  },
  add_skill: args => {
    const req = payloadOf(args);
    const sourcePath = String(req.sourcePath || "").trim();
    const level = req.level === "project" ? "project" : "user";
    const name = String(req.targetName || sourcePath.split("/").filter(Boolean).pop() || "custom-skill");
    const key = `${level}:${name}`;
    if (!devSkills.some(s => s.key === key)) {
      const destPath =
        level === "project" ? `/workspace/demo/.openbitfun/skills/${name}` : `/workspace/skills/${name}`;
      devSkills.push({
        key,
        name,
        description: `Local skill imported from ${sourcePath || destPath}.`,
        path: destPath,
        entryFile: "SKILL.md",
        level,
        sourceSlot: level === "project" ? "openbitfun-project" : "openbitfun-user",
        sourceId: "openbitfun",
        sourceLabel: "OpenBitFun",
        dirName: name,
        isBuiltin: false,
        isShadowed: false,
        allowUserInvocation: true,
      });
      devFileContents[`${destPath}/SKILL.md`] = defaultPersonaContent("SKILL.md", name);
    }
    return `Installed skill '${name}'`;
  },
  delete_skill: args => {
    const req = payloadOf(args);
    const key = String(req.skillKey || "");
    const idx = devSkills.findIndex(s => s.key === key);
    if (idx >= 0) devSkills.splice(idx, 1);
    disabledUserSkillKeys = disabledUserSkillKeys.filter(k => k !== key);
    disabledProjectSkillKeys = disabledProjectSkillKeys.filter(k => k !== key);
    return `Deleted skill '${key}'`;
  },
  list_skill_market: args => {
    const req = payloadOf(args);
    const q = String(req.query || "").trim().toLowerCase();
    const limit = typeof req.limit === "number" ? req.limit : 30;
    const filtered = devMarketSkills
      .filter(item => !q || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q))
      .slice(0, limit);
    return req.includeDiagnostics ? { skills: filtered, sourceErrors: [] } : filtered;
  },
  search_skill_market: args => {
    const req = payloadOf(args);
    const q = String(req.query || "").trim().toLowerCase();
    const limit = typeof req.limit === "number" ? req.limit : 30;
    const filtered = devMarketSkills
      .filter(
        item =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q),
      )
      .slice(0, limit);
    return req.includeDiagnostics ? { skills: filtered, sourceErrors: [] } : filtered;
  },
  download_skill_market: args => {
    const req = payloadOf(args);
    const pkg = String(req.package || "");
    const level = req.level === "project" ? "project" : "user";
    const match = devMarketSkills.find(m => m.installId === pkg || m.id === pkg || m.name === pkg);
    const name = match ? match.id : pkg.split("@").pop() || "market-skill";
    const key = `${level}:${name}`;
    if (!devSkills.some(s => s.key === key)) {
      const destPath =
        level === "project" ? `/workspace/demo/.openbitfun/skills/${name}` : `/workspace/skills/${name}`;
      devSkills.push({
        key,
        name,
        description: match ? match.description : `Marketplace skill ${pkg}`,
        path: destPath,
        entryFile: "SKILL.md",
        level,
        sourceSlot: level === "project" ? "openbitfun-project" : "openbitfun-user",
        sourceId: "openbitfun",
        sourceLabel: "Market",
        installationSource: pkg,
        dirName: name,
        isBuiltin: false,
        isShadowed: false,
        allowUserInvocation: true,
      });
      devFileContents[`${destPath}/SKILL.md`] =
        `---\nname: ${name}\ndescription: ${match ? match.description : "Downloaded skill"}\n---\n\n# ${match ? match.name : name}\n\nInstalled from ${pkg}.\n`;
    }
    return {
      package: pkg,
      level,
      installedSkills: [name],
      output: `Installed ${name} into ${level}`,
    };
  },

  // Routines / Scheduled Cron Jobs
  notify_cron_host_ready: () => null,
  // routines + assistant (wave 4): dev stand-ins for the host scheduler's answers.
  validate_cron_job_draft: args => {
    const req = payloadOf(args);
    const issues = [];
    if (!String(req.name || "").trim()) issues.push({ field: "name", code: "name_required", message: "name" });
    if (!String((req.payload || {}).text || "").trim()) {
      issues.push({ field: "payload", code: "payload_required", message: "payload" });
    }
    return { valid: issues.length === 0, issues };
  },
  preview_cron_occurrences: args => {
    const req = payloadOf(args);
    const from = Number(req.fromMs || Date.now());
    const to = Number(req.toMs || from + 7 * 24 * HOUR_MS);
    const count = Number(req.count || 96);
    const runsOf = schedule => {
      const step = schedule && schedule.kind === "every" ? Math.max(60_000, Number(schedule.everyMs) || 0) : 24 * HOUR_MS;
      const runs = [];
      for (let at = from + step; at <= to && runs.length < count; at += step) runs.push(at);
      return runs;
    };
    const jobs = req.schedule && !req.jobIds
      ? []
      : devCronJobs.filter(job => job.enabled).map(job => ({ jobId: job.id, valid: true, occurrences: runsOf(job.schedule), truncated: false }));
    return {
      ...(req.schedule ? { schedule: { valid: true, occurrences: runsOf(req.schedule).slice(0, 3), truncated: false } } : {}),
      jobs,
    };
  },
  list_cron_jobs: () => devCronJobs.map(j => ({ ...j, state: { ...j.state } })),
  create_cron_job: args => {
    const req = payloadOf(args);
    const now = Date.now();
    const job = {
      id: `cron-dev-${cronSeq++}`,
      name: String(req.name || "New Routine"),
      schedule: req.schedule || { kind: "every", everyMs: 6 * HOUR_MS },
      payload: req.payload || { text: "" },
      enabled: req.enabled !== false,
      reportPolicy: req.reportPolicy || "inherit",
      target: req.target || {
        kind: "workspace",
        workspace: { workspaceId: activeWorkspaceId, workspacePath: "/workspace/demo" },
        launch: { agentType: "Standard", modelId: null },
      },
      createdAtMs: now,
      configUpdatedAtMs: now,
      updatedAtMs: now,
      state: {
        nextRunAtMs: now + 3 * HOUR_MS,
        lastRunStatus: null,
        lastError: null,
        activeTurnId: null,
        consecutiveFailures: 0,
        coalescedRunCount: 0,
      },
    };
    devCronJobs.unshift(job);
    return job;
  },
  update_cron_job: args => {
    const req = payloadOf(args);
    const idx = devCronJobs.findIndex(j => j.id === req.jobId);
    if (idx < 0) throw new Error(`Cron job not found: ${req.jobId}`);
    const prev = devCronJobs[idx];
    const updated = {
      ...prev,
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.schedule !== undefined ? { schedule: req.schedule } : {}),
      ...(req.payload !== undefined ? { payload: req.payload } : {}),
      ...(req.enabled !== undefined ? { enabled: Boolean(req.enabled) } : {}),
      ...(req.reportPolicy !== undefined ? { reportPolicy: req.reportPolicy } : {}),
      ...(req.target !== undefined ? { target: req.target } : {}),
      configUpdatedAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    devCronJobs[idx] = updated;
    return updated;
  },
  delete_cron_job: args => {
    const req = payloadOf(args);
    const idx = devCronJobs.findIndex(j => j.id === req.jobId);
    if (idx >= 0) {
      devCronJobs.splice(idx, 1);
      return true;
    }
    return false;
  },

  // Git Workbench
  git_is_repository: () => true,
  git_get_repository_trust: args => {
    const req = payloadOf(args);
    return {
      state: devGitTrusted ? "trusted" : "trust_required",
      repositoryPath: req.repositoryPath || "/workspace/demo",
      detail: devGitTrusted ? null : "Repository requires safe.directory confirmation",
      manualCommand: devGitTrusted ? null : "git config --global --add safe.directory /workspace/demo",
    };
  },
  git_trust_repository: args => {
    const req = payloadOf(args);
    devGitTrusted = true;
    return {
      state: "trusted",
      repositoryPath: req.repositoryPath || "/workspace/demo",
      alreadyTrusted: false,
      addedEntries: [req.repositoryPath || "/workspace/demo"],
      detail: null,
      manualCommand: null,
    };
  },
  git_get_status: () => ({
    staged: [...devGitStatus.staged],
    unstaged: [...devGitStatus.unstaged],
    untracked: [...devGitStatus.untracked],
    conflicts: [...devGitStatus.conflicts],
    current_branch: devGitStatus.current_branch,
    ahead: devGitStatus.ahead,
    behind: devGitStatus.behind,
  }),
  git_get_diff: args => {
    const req = payloadOf(args);
    const params = req.params || {};
    const file = (Array.isArray(params.files) && params.files[0]) || params.filePath || "src/nsh-ui/App.tsx";
    return buildGitDiff(file, Boolean(params.staged));
  },
  git_add_files: args => {
    const req = payloadOf(args);
    const params = req.params || {};
    const targets = params.all
      ? [...devGitStatus.unstaged.map(f => f.path), ...devGitStatus.untracked]
      : Array.isArray(params.files)
        ? params.files
        : [];
    for (const filePath of targets) {
      const uIdx = devGitStatus.unstaged.findIndex(f => f.path === filePath);
      if (uIdx >= 0) {
        const entry = devGitStatus.unstaged.splice(uIdx, 1)[0];
        if (!devGitStatus.staged.some(f => f.path === filePath)) {
          devGitStatus.staged.push({ path: entry.path, status: entry.status, index_status: "M", workdir_status: " " });
        }
      }
      const tIdx = devGitStatus.untracked.indexOf(filePath);
      if (tIdx >= 0) {
        devGitStatus.untracked.splice(tIdx, 1);
        if (!devGitStatus.staged.some(f => f.path === filePath)) {
          devGitStatus.staged.push({ path: filePath, status: "A", index_status: "A", workdir_status: " " });
        }
      }
    }
    return { success: true, message: `Staged ${targets.length} file(s)` };
  },
  git_reset_files: args => {
    const req = payloadOf(args);
    const params = req.params || req;
    const files = Array.isArray(params.files) ? params.files : [];
    const staged = params.staged !== false;
    for (const filePath of files) {
      if (staged) {
        const sIdx = devGitStatus.staged.findIndex(f => f.path === filePath);
        if (sIdx >= 0) {
          const entry = devGitStatus.staged.splice(sIdx, 1)[0];
          if (entry.status === "A") {
            if (!devGitStatus.untracked.includes(filePath)) devGitStatus.untracked.push(filePath);
          } else if (!devGitStatus.unstaged.some(f => f.path === filePath)) {
            devGitStatus.unstaged.push({ path: filePath, status: entry.status, index_status: " ", workdir_status: "M" });
          }
        }
      } else {
        const uIdx = devGitStatus.unstaged.findIndex(f => f.path === filePath);
        if (uIdx >= 0) devGitStatus.unstaged.splice(uIdx, 1);
        const cIdx = devGitStatus.conflicts.findIndex(f => f.path === filePath);
        if (cIdx >= 0) devGitStatus.conflicts.splice(cIdx, 1);
      }
    }
    return {
      success: true,
      message: staged ? `Unstaged ${files.length} file(s)` : `Discarded changes in ${files.length} file(s)`,
    };
  },
  git_commit: args => {
    const req = payloadOf(args);
    const params = req.params || {};
    const message = String(params.message || "").trim();
    if (!message) return { success: false, error: "Commit message is empty" };
    const hash = Math.random().toString(16).slice(2).padEnd(40, "0").slice(0, 40);
    const commit = {
      hash,
      short_hash: hash.slice(0, 7),
      message,
      author: "Studio User",
      author_email: "studio@example.com",
      date: new Date().toISOString(),
      parents: devGitCommits[0] ? [devGitCommits[0].hash] : [],
      additions: 18,
      deletions: 4,
      files_changed: Math.max(1, devGitStatus.staged.length),
    };
    if (params.amend && devGitCommits.length > 0) {
      devGitCommits[0] = { ...devGitCommits[0], message };
    } else {
      devGitCommits.unshift(commit);
      devGitStatus.ahead += 1;
    }
    devGitStatus.staged = [];
    return { success: true, message: `Committed ${commit.short_hash}` };
  },
  git_push: () => {
    devGitStatus.ahead = 0;
    return { success: true, message: `Pushed to origin/${devGitStatus.current_branch}` };
  },
  git_pull: () => {
    devGitStatus.behind = 0;
    return { success: true, message: "Already up to date." };
  },
  // git liveness (wave 4): the dev host has no watcher; the lease answers the
  // status now and nothing is pushed later.
  git_watch_status: args => {
    const req = payloadOf(args);
    return {
      workspaceId: req.workspaceId || "",
      repositoryPath: req.repositoryPath || "",
      revision: 0,
      status: DEV_FIXTURES.git_get_status(),
      mode: "watch",
      event: "git://status-changed",
    };
  },
  git_unwatch_status: () => true,
  git_discard_files: args => {
    const req = payloadOf(args);
    const files = Array.isArray(req.files) ? req.files : [];
    for (const filePath of files) {
      const untracked = devGitStatus.untracked.indexOf(filePath);
      if (untracked >= 0) {
        if (!req.includeUntracked) {
          throw new Error(`Refusing to delete untracked files without includeUntracked: ${filePath}`);
        }
        devGitStatus.untracked.splice(untracked, 1);
      }
      devGitStatus.staged = devGitStatus.staged.filter(f => f.path !== filePath);
      devGitStatus.unstaged = devGitStatus.unstaged.filter(f => f.path !== filePath);
      devGitStatus.conflicts = devGitStatus.conflicts.filter(path => path !== filePath);
    }
    return { success: true, data: { restore: files } };
  },
  git_commit_and_checkout: args => {
    const req = payloadOf(args);
    if (devGitStatus.conflicts.length > 0) {
      throw new Error("Resolve the merge conflicts in the working copy before switching branches.");
    }
    devGitStatus.staged = [];
    devGitStatus.unstaged = devGitStatus.unstaged.filter(f => !(req.files || []).includes(f.path));
    devGitStatus.current_branch = req.targetBranch || devGitStatus.current_branch;
    return { success: true, data: { committed: true, branch: req.targetBranch } };
  },
  quick_commit_message: () => ({
    title: "feat(nsh): update studio workspace components",
    body: null,
    footer: null,
    full_message: "feat(nsh): update studio workspace components",
    fullMessage: "feat(nsh): update studio workspace components",
    commit_type: "Feat",
    scope: "nsh",
    confidence: 0.92,
    changes_summary: { files_changed: 2, total_additions: 24, total_deletions: 6 },
  }),
  generate_commit_message: () => ({
    title: "feat(nsh): update studio workspace components",
    body: "Refine theme tokens and interactive workbench views.",
    footer: null,
    full_message:
      "feat(nsh): update studio workspace components\n\nRefine theme tokens and interactive workbench views.",
    fullMessage:
      "feat(nsh): update studio workspace components\n\nRefine theme tokens and interactive workbench views.",
    commit_type: "Feat",
    scope: "nsh",
    confidence: 0.94,
    changes_summary: { files_changed: 2, total_additions: 24, total_deletions: 6 },
  }),
  git_get_enhanced_branches: args => {
    const req = payloadOf(args);
    return req.includeRemote === false ? devGitBranches.filter(b => !b.remote) : [...devGitBranches];
  },
  git_get_branches: args => {
    const req = payloadOf(args);
    return req.includeRemote === false ? devGitBranches.filter(b => !b.remote) : [...devGitBranches];
  },
  git_checkout_branch: args => {
    const req = payloadOf(args);
    const branchName = String(req.branchName || "");
    const target = devGitBranches.find(b => b.name === branchName);
    if (!target) return { success: false, error: `Branch '${branchName}' not found` };
    for (const branch of devGitBranches) {
      branch.current = branch.name === branchName;
    }
    devGitStatus.current_branch = branchName;
    return { success: true, message: `Switched to branch '${branchName}'` };
  },
  git_create_branch: args => {
    const req = payloadOf(args);
    const branchName = String(req.branchName || "").trim();
    if (!branchName) return { success: false, error: "Branch name is required" };
    if (devGitBranches.some(b => b.name === branchName)) {
      return { success: false, error: `Branch '${branchName}' already exists` };
    }
    const checkout = req.checkout !== false;
    if (checkout) {
      for (const b of devGitBranches) b.current = false;
      devGitStatus.current_branch = branchName;
    }
    devGitBranches.unshift({
      name: branchName,
      current: checkout,
      remote: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      last_commit: devGitCommits[0] ? devGitCommits[0].short_hash : "0000000",
      last_commit_date: new Date().toISOString(),
    });
    return { success: true, message: `Created branch '${branchName}'` };
  },
  git_delete_branch: args => {
    const req = payloadOf(args);
    const branchName = String(req.branchName || "");
    const idx = devGitBranches.findIndex(b => b.name === branchName && !b.remote);
    if (idx < 0) return { success: false, error: `Branch '${branchName}' not found` };
    if (devGitBranches[idx].current) return { success: false, error: "Cannot delete the checked-out branch" };
    devGitBranches.splice(idx, 1);
    return { success: true, message: `Deleted branch '${branchName}'` };
  },
  git_get_commits: args => {
    const req = payloadOf(args);
    const params = req.params || {};
    const limit = Number(params.maxCount || params.max_count || 40);
    return devGitCommits.slice(0, limit);
  },
  git_get_graph: args => {
    const req = payloadOf(args);
    if (isRemoteWorkspaceRequested(req)) {
      throw new Error("Git graph is not supported for remote SSH workspaces yet");
    }
    const maxCount = Number(req.maxCount || 40);
    const nodes = devGitCommits.slice(0, maxCount).map((c, idx) => ({
      hash: c.hash,
      message: c.message,
      fullMessage: c.message,
      authorName: c.author,
      authorEmail: c.author_email,
      timestamp: Date.parse(c.date) || Date.now(),
      parents: c.parents,
      children: idx > 0 ? [devGitCommits[idx - 1].hash] : [],
      refs:
        idx === 0
          ? [{ name: devGitStatus.current_branch, refType: "branch", isCurrent: true, isHead: true }]
          : idx === 1
            ? [{ name: "main", refType: "branch", isCurrent: false, isHead: false }]
            : [],
      lane: 0,
      forkingLanes: [],
      mergingLanes: [],
      passingLanes: [],
    }));
    return {
      nodes,
      maxLane: 0,
      currentBranch: devGitStatus.current_branch,
    };
  },
  git_list_worktrees: args => {
    const req = payloadOf(args);
    if (isRemoteWorkspaceRequested(req)) {
      throw new Error("Git worktrees are not supported for remote SSH workspaces");
    }
    return devGitWorktrees.map(wt => ({ ...wt }));
  },
  git_add_worktree: args => {
    const req = payloadOf(args);
    if (isRemoteWorkspaceRequested(req)) {
      throw new Error("Git worktrees are not supported for remote SSH workspaces");
    }
    const branch = String(req.branch || "").trim();
    if (!branch) throw new Error("Branch name is required");
    const slug = branch.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
    const wtPath = `/workspace/demo-worktrees/${slug}`;
    const created = {
      path: wtPath,
      branch,
      head: devGitCommits[0] ? devGitCommits[0].short_hash : "a1b2c3d",
      isMain: false,
      isLocked: false,
      isPrunable: false,
    };
    devGitWorktrees.push(created);
    if (req.createBranch !== false && !devGitBranches.some(b => b.name === branch)) {
      devGitBranches.push({
        name: branch,
        current: false,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        last_commit: created.head,
        last_commit_date: new Date().toISOString(),
      });
    }
    return created;
  },
  git_remove_worktree: args => {
    const req = payloadOf(args);
    const worktreePath = String(req.worktreePath || "");
    const idx = devGitWorktrees.findIndex(w => w.path === worktreePath);
    if (idx < 0) return { success: false, error: `Worktree not found: ${worktreePath}` };
    if (devGitWorktrees[idx].isMain) {
      return { success: false, error: "Cannot remove the main worktree" };
    }
    devGitWorktrees.splice(idx, 1);
    return { success: true, message: `Removed worktree ${worktreePath}` };
  },

  // Spaces / MiniApps
  list_miniapps: () =>
    devMiniApps.map(({ source: _source, compiled_html: _compiled, ai_context: _ai, ...meta }) => meta),
  miniapp_worker_list_running: () => [...runningMiniAppWorkers],
  miniapp_worker_stop: args => {
    const req = payloadOf(args);
    runningMiniAppWorkers = runningMiniAppWorkers.filter(id => id !== req.appId);
    return null;
  },
  get_miniapp: args => {
    const req = payloadOf(args);
    const found = devMiniApps.find(app => app.id === req.appId);
    if (!found) throw new Error(`MiniApp '${req.appId}' not found`);
    return found;
  },
  get_miniapp_versions: args => {
    const req = payloadOf(args);
    const found = devMiniApps.find(app => app.id === req.appId);
    if (!found) return [];
    return Array.from({ length: found.version }, (_, idx) => idx + 1);
  },
  delete_miniapp: args => {
    const req = payloadOf(args);
    const idx = devMiniApps.findIndex(app => app.id === req.appId);
    if (idx >= 0) devMiniApps.splice(idx, 1);
    runningMiniAppWorkers = runningMiniAppWorkers.filter(id => id !== req.appId);
    return null;
  },

  // miniapp market (wave 5): a small catalogue so Spaces > Market is live in a
  // plain browser. The install answers the host's permission refusal first.
  miniapp_market_browse: args => {
    const req = payloadOf(args);
    const query = String(req.query || "").toLowerCase();
    const category = String(req.category || "all");
    const items = devMarketListings
      .filter(item => category === "all" || item.category === category)
      .filter(item => !query || `${item.name} ${item.description}`.toLowerCase().includes(query))
      .map(({ releases: _releases, changelog: _changelog, license: _license, ...summary }) => summary);
    return { items };
  },
  miniapp_market_get_listing: args => {
    const req = payloadOf(args);
    const found = devMarketListings.find(item => item.slug === req.slug);
    if (!found) throw new Error(JSON.stringify({ code: "not_found", message: "Listing not found." }));
    return found;
  },
  miniapp_market_installed_status: args => {
    const req = payloadOf(args);
    const appId = Object.keys(devMarketOrigins).find(id => devMarketOrigins[id].listingId === req.listingId);
    if (!appId) return null;
    return { appId, appVersion: 1, permissions: {}, origin: devMarketOrigins[appId], localOverride: false };
  },
  miniapp_market_installed_origins: () => ({ ...devMarketOrigins }),
  miniapp_market_set_favorite: args => {
    const req = payloadOf(args);
    const found = devMarketListings.find(item => item.slug === req.slug);
    if (!found) throw new Error("Listing not found.");
    if (Boolean(req.enabled) !== Boolean(found.isFavorited)) found.favoriteCount += req.enabled ? 1 : -1;
    found.isFavorited = Boolean(req.enabled);
    return { count: found.favoriteCount, isFavorited: found.isFavorited };
  },
  miniapp_market_set_rating: args => {
    const req = payloadOf(args);
    const found = devMarketListings.find(item => item.slug === req.slug);
    if (!found) throw new Error("Listing not found.");
    if (found.myRating == null && req.value != null) found.ratingCount += 1;
    found.myRating = req.value == null ? undefined : req.value;
    return { average: found.ratingAverage, count: found.ratingCount, myRating: found.myRating ?? null };
  },
  miniapp_market_list_submissions: () => devMarketSubmissions.map(item => ({ ...item })),
  miniapp_market_withdraw_submission: args => {
    const req = payloadOf(args);
    const found = devMarketSubmissions.find(item => item.submissionId === req.submissionId);
    if (!found) throw new Error("Submission not found.");
    found.status = "withdrawn";
    return { ...found };
  },
  miniapp_market_install: args => {
    const req = payloadOf(args);
    const found = devMarketListings.find(item => item.slug === req.slug);
    if (!found) throw new Error("Listing not found.");
    if ((found.permissions.net?.allow?.length || 0) > 0 && !req.confirmPermissions) {
      throw new Error(`Permission confirmation required: net.allow:${found.permissions.net.allow.join(",")}`);
    }
    const appId = req.existingAppId || `market-${found.slug}`;
    const release = found.releases[0];
    devMarketOrigins[appId] = {
      listingId: found.listingId,
      releaseId: release.releaseId,
      releaseNumber: release.releaseNumber,
      packageSha256: release.packageSha256,
    };
    const app = {
      id: appId,
      name: found.name,
      description: found.description,
      icon: found.icon,
      category: found.category,
      tags: found.tags,
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      permissions: found.permissions,
      runtime_profile: "compatibility",
      source: { html: "<div>Market Space</div>", css: "", ui_js: "", worker_js: "" },
    };
    if (!devMiniApps.some(item => item.id === appId)) devMiniApps.push(app);
    return { app, origin: devMarketOrigins[appId], updated: Boolean(req.existingAppId), permissionDiff: { added: [], expanded: [] } };
  },
  miniapp_market_inspect_package: args => {
    const req = payloadOf(args);
    if (!String(req.path || "").toLowerCase().endsWith(".bfminiapp")) throw new Error("Select a .bfminiapp package.");
    return {
      name: "Imported Space",
      description: "A Space from a local package.",
      packageSha256: "9f2c4a7d1e0b3c5a9f2c4a7d1e0b3c5a",
      permissions: {},
      permissionDiff: { added: [], expanded: [] },
    };
  },
  miniapp_market_import_package: args => {
    const req = payloadOf(args);
    const app = {
      id: `imported-${devMiniApps.length + 1}`,
      name: "Imported Space",
      description: `Imported from ${req.path}`,
      icon: "box",
      category: "other",
      tags: [],
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      permissions: {},
      runtime_profile: "compatibility",
      source: { html: "<div>Imported</div>", css: "", ui_js: "", worker_js: "" },
    };
    devMiniApps.push(app);
    return app;
  },

  // Workbench (round 4): disk identity, the file watcher, the terminal list and
  // commit inspection, so the scenes are live in a plain browser too.
  get_file_metadata: args => {
    const req = payloadOf(args);
    const filePath = String(req.path || "");
    const body = Object.prototype.hasOwnProperty.call(devFileContents, filePath) ? devFileContents[filePath] : "";
    return { path: filePath, modified: 1700000000000, size: String(body).length, isFile: true, isDir: false };
  },
  start_file_watch: () => null,
  stop_file_watch: () => null,
  retry_file_watch: () => null,
  get_file_watch_status: () => ({ healthy: true, watchedPaths: [], failure: null }),
  terminal_list: () => [],
  terminal_send_command: args => {
    const req = payloadOf(args);
    if (req.sessionId && req.command) {
      devTerminalBuffers[req.sessionId] = (devTerminalBuffers[req.sessionId] || "") + `${String(req.command)}\r\n$ `;
    }
    return null;
  },
  git_get_changed_files: () => [
    { path: "src/main.rs", old_path: null, status: "modified" },
    { path: "README.md", old_path: null, status: "modified" },
  ],

  // Terminal
  // remote link + terminal profiles (wave 4): profiles kept per workspace id, as the host does.
  get_terminal_profiles: args => devTerminalProfilesAnswer(payloadOf(args).workspaceId),
  upsert_terminal_profile: args => {
    const req = payloadOf(args);
    const rows = devTerminalProfiles[req.workspaceId] || [];
    const profile = req.profile || {};
    const name = String(profile.name || "").trim();
    if (!name) throw new Error("terminal_profile_name_required: a profile needs a name");
    if (rows.some(row => row.name === name && row.id !== profile.id)) {
      throw new Error(`terminal_profile_name_taken: a profile named ${name} already exists`);
    }
    const id = profile.id || `tp_dev_${devTerminalSeq++}`;
    const row = {
      id,
      name,
      shellId: String(profile.shellId || ""),
      shellType: String(profile.shellType || ""),
      startupCommand: String(profile.startupCommand || "").trim(),
    };
    devTerminalProfiles[req.workspaceId] = profile.id ? rows.map(r => (r.id === id ? row : r)) : [...rows, row];
    return { ...devTerminalProfilesAnswer(req.workspaceId), id };
  },
  delete_terminal_profile: args => {
    const req = payloadOf(args);
    devTerminalProfiles[req.workspaceId] = (devTerminalProfiles[req.workspaceId] || []).filter(r => r.id !== req.profileId);
    return devTerminalProfilesAnswer(req.workspaceId);
  },
  import_terminal_profiles: args => {
    const req = payloadOf(args);
    const rows = devTerminalProfiles[req.workspaceId] || [];
    let imported = 0;
    for (const p of req.profiles || []) {
      if (!p.name || rows.some(r => r.name === p.name)) continue;
      rows.push({ ...p, id: p.id || `tp_dev_${devTerminalSeq++}` });
      imported += 1;
    }
    devTerminalProfiles[req.workspaceId] = rows;
    return { ...devTerminalProfilesAnswer(req.workspaceId), imported, skipped: (req.profiles || []).length - imported };
  },
  terminal_get_shells: () => [
    { id: "zsh", name: "Zsh", shellType: "Zsh", path: "/bin/zsh", version: "5.9", available: true },
    { id: "bash", name: "Bash", shellType: "Bash", path: "/bin/bash", version: "5.2", available: true },
  ],
  terminal_create: args => {
    const req = payloadOf(args);
    const id = `dev-terminal-${devTerminalSeq++}`;
    devTerminalBuffers[id] = "OpenBitFun Studio dev shell (fixture)\r\n$ ";
    return { id, name: req.shellType || "zsh", workspaceId: req.workspaceId || activeWorkspaceId };
  },
  terminal_get_history: args => {
    const req = payloadOf(args);
    const data = devTerminalBuffers[req.sessionId] || "";
    return { data, cursor: data.length, nextOffset: data.length, truncated: false, cols: 80, rows: 24 };
  },
  terminal_write: args => {
    const req = payloadOf(args);
    if (req.sessionId && req.data) {
      devTerminalBuffers[req.sessionId] = (devTerminalBuffers[req.sessionId] || "") + String(req.data);
    }
    return null;
  },
  terminal_resize: () => null,
  terminal_close: () => null,

  // Devices, Remote Connect & Messaging Bots
  account_list_devices: () => {
    if (!devAccountLoggedIn) {
      throw new Error("not logged in");
    }
    return [
      { deviceId: "dev-device-mac", deviceName: "studio-mac", platform: "macos", alias: "Studio", online: true, presence: "directory", is_local: true },
      { deviceId: "dev-device-remote", deviceName: "build-host", platform: "linux", online: false, presence: "offline", is_local: false },
    ];
  },
  remote_connect_get_device_info: () => ({
    device_id: "dev-device-mac",
    device_name: "studio-mac",
    device_alias: "Studio",
    device_os: "macos",
    mac_address: "00:00:00:00:00:00",
  }),
  // The 2.0 shape: the retired relay fields stay, always empty.
  remote_connect_status: () => ({
    connections: [],
    relay_connected: false,
    relay_url: null,
    active_method: null,
    clients: [],
    bot_connected: remoteBotConnected,
    bot_verbose_mode: remoteBotVerboseMode,
  }),
  remote_connect_get_methods: () => remoteMethods,
  remote_connect_get_form_state: () => ({ ...remoteFormState }),
  remote_connect_set_form_state: args => {
    const req = payloadOf(args);
    remoteFormState = { ...remoteFormState, ...req };
    return null;
  },
  remote_connect_start: args => {
    const req = payloadOf(args);
    const method = String(req.method || "");
    if (method === "bot_telegram" || method === "bot_feishu" || method === "bot_weixin") {
      remoteBotConnected = method.replace("bot_", "");
      return {
        method,
        qr_data: null,
        qr_svg: null,
        qr_url: null,
        bot_pairing_code: "OBF-7492",
        bot_link: "https://example.invalid/bot-pair",
        pairing_state: "connected",
      };
    }
    throw new Error(
      "RELAY_METHOD_RETIRED: unsupported: the OpenBitFun relay was retired in OpenBitFun 2.0",
    );
  },
  remote_connect_stop: () => null,
  remote_connect_configure_bot: args => {
    const req = payloadOf(args);
    const botType = String(req.bot_type || "");
    if (botType === "telegram") {
      remoteFormState.telegram_bot_token = String(req.bot_token || "");
      remoteBotConnected = "telegram";
    } else if (botType === "feishu") {
      remoteFormState.feishu_app_id = String(req.app_id || "");
      remoteFormState.feishu_app_secret = String(req.app_secret || "");
      remoteBotConnected = "feishu";
    } else if (botType === "weixin") {
      remoteFormState.weixin_ilink_token = String(req.weixin_ilink_token || "");
      remoteFormState.weixin_base_url = String(req.weixin_base_url || "");
      remoteFormState.weixin_bot_account_id = String(req.weixin_bot_account_id || "");
      remoteBotConnected = "weixin";
    }
    return null;
  },
  remote_connect_stop_bot: () => {
    remoteBotConnected = null;
    return null;
  },
  remote_connect_weixin_qr_start: () => ({
    session_key: "weixin-qr-dev-1",
    qr_image_url: "https://example.invalid/weixin/qr-dev.png",
    message: "Scan this QR code with WeChat to link the bot.",
  }),
  remote_connect_weixin_qr_poll: () => ({
    status: "confirmed",
    message: "WeChat bot paired in development fixture.",
    qr_image_url: null,
    ilink_token: "demo-weixin-ilink-token",
    bot_account_id: "wx-bot-demo-1",
    base_url: "https://ilinkai.weixin.qq.com",
  }),
  remote_connect_get_bot_verbose_mode: () => remoteBotVerboseMode,
  remote_connect_set_bot_verbose_mode: args => {
    const req = payloadOf(args);
    remoteBotVerboseMode = Boolean(req.verbose);
    return null;
  },

  // Account & Insights
  account_identity: () => (devAccountLoggedIn ? devIdentity : null),
  account_email_start: args => {
    const req = payloadOf(args);
    return {
      challengeId: "email-challenge-dev-1",
      email: String(req.email ?? "").trim().toLowerCase(),
      codeLength: 8,
      retryAfterSeconds: 60,
      expiresAt: Date.now() + 600000,
    };
  },
  account_email_verify: () => {
    devAccountLoggedIn = true;
    devIdentity = devEmailIdentity;
    return { identity: devIdentity };
  },
  account_github_start: () => ({
    transactionId: "github-tx-dev-1",
    userCode: "OBF7-429A",
    verificationUri: "https://github.com/login/device",
    authorizationUrl: "https://github.com/login/device",
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    pollIntervalSeconds: 2,
  }),
  account_github_poll: () => {
    devAccountLoggedIn = true;
    devIdentity = { provider: "github", accountId: "424201", displayName: "studio-user", initial: "S" };
    return { status: "authorized" };
  },
  account_status: () => ({
    logged_in: devAccountLoggedIn,
    loggedIn: devAccountLoggedIn,
    user_id: devAccountLoggedIn ? "acc-studio-demo" : null,
    userId: devAccountLoggedIn ? "acc-studio-demo" : null,
  }),
  account_logout: () => {
    devAccountLoggedIn = false;
    return null;
  },
  account_settings_sync_status: () => ({
    enabled: devAccountSyncEnabled,
    phase: !devAccountLoggedIn ? "signed_out" : devAccountSyncEnabled ? "synced" : "off",
    pending: 0,
    lastSyncedAtMs: devAccountLoggedIn ? Date.now() - 60000 : null,
    peers: devAccountLoggedIn ? 2 : 0,
    peersOnline: devAccountLoggedIn ? 1 : 0,
    active: devAccountLoggedIn && devAccountSyncEnabled,
    groups: ["preferences", "permissions"],
  }),
  account_settings_sync_set: args => {
    const req = payloadOf(args);
    devAccountSyncEnabled = req.enabled === true;
    return DEV_FIXTURES.account_settings_sync_status();
  },
  obp_get_status: () => ({
    available: true,
    protocol: 1,
    webUi: true,
    loopbackUrl: "http://127.0.0.1:47610/",
    ownerUrl: "http://127.0.0.1:47610/?token=dev",
    pairedClients: [],
    ownerConnections: 1,
    pairedConnections: 0,
    accountDeviceConnections: devAccountLoggedIn ? 1 : 0,
    meshPort: 47612,
  }),
  get_settings_schema: args => {
    const req = payloadOf(args);
    const paths = Array.isArray(req.paths) ? req.paths.map(String) : Object.keys(DEV_SETTINGS_DESCRIPTOR);
    const fields = {};
    for (const path of paths) {
      if (DEV_SETTINGS_DESCRIPTOR[path]) fields[path] = DEV_SETTINGS_DESCRIPTOR[path];
    }
    return { catalogDigest: "dev", fields };
  },
  get_latest_insights: () => devInsightsReports.map(entry => entry.meta),
  load_insights_report: args => {
    const req = payloadOf(args);
    const match = devInsightsReports.find(entry => entry.meta.path === req.path);
    if (!match) throw new Error(`Insights report not found: ${req.path}`);
    return match.report;
  },
  generate_insights: args => {
    const req = payloadOf(args);
    const days = Number(req.days || 30);
    const now = Date.now();
    const base = devInsightsReports[0];
    const generatedPath = `/workspace/demo/.openbitfun/insights/generated-${insightsSeq++}.json`;
    const meta = {
      ...base.meta,
      generated_at: now,
      days_covered: days,
      path: generatedPath,
    };
    const report = {
      ...base.report,
      generated_at: now,
      days_covered: days,
    };
    devInsightsReports.unshift({ meta, report });
    return report;
  },
  cancel_insights_generation: () => null,

  // Usage, AI Discovery, Subscriptions, SSH/Remote Workspaces & Settings fixtures
  get_token_usage_statistics: args => {
    const req = payloadOf(args);
    const nowMs = Date.now();
    const isCustom = req.timeRange === "custom";
    const trend = isCustom
      ? buildCustomUsageTrend(nowMs)
      : [
          { bucket: new Date(nowMs - 4 * DAY_MS).toISOString(), inputTokens: 16200, outputTokens: 5400, cacheReadTokens: 7000 },
          { bucket: new Date(nowMs - 3 * DAY_MS).toISOString(), inputTokens: 21800, outputTokens: 7600, cacheReadTokens: 9200 },
          { bucket: new Date(nowMs - 2 * DAY_MS).toISOString(), inputTokens: 38000, outputTokens: 14200, cacheReadTokens: 16000 },
          { bucket: new Date(nowMs - DAY_MS).toISOString(), inputTokens: 51200, outputTokens: 21100, cacheReadTokens: 25000 },
        ];
    return {
      totalRequests: 42,
      unknownUsageRequests: 0,
      failedRequests: 1,
      totalTokens: 124500,
      totalInputTokens: 89200,
      totalOutputTokens: 35300,
      totalCachedTokens: 41000,
      totalCacheWriteTokens: 4500,
      totalCacheReportedInputTokens: 82000,
      byModel: [
        { key: "model-1", name: "Studio Primary", providerName: "openai", requests: 42, tokens: 124500, cacheHitRate: 0.5 },
      ],
      byGroup: [{ key: "Standard", name: "Standard", requests: 30, tokens: 88000 }],
      byEndpoint: [{ key: "chat", name: "/v1/chat/completions", requests: 42, tokens: 124500 }],
      trend,
      granularity: req.granularity || "day",
    };
  },
  // view models (wave 4): dev answers shaped like the backend view models.
  get_token_usage_activity: () => devUsageActivity(Date.now()),
  get_workspace_navigator: args => {
    const req = payloadOf(args);
    const opened = devWorkspaces.slice();
    const openedIds = new Set(opened.map(w => w.id));
    const recent = [...devWorkspaces, ...devRecentOnlyWorkspaces].filter(
      (w, index, list) => !openedIds.has(w.id) && list.findIndex(other => other.id === w.id) === index,
    );
    const selected = typeof req.selectedId === "string" ? req.selectedId : "";
    if (selected && openedIds.has(selected)) return { opened, recent, selectedId: selected, selection: "kept" };
    if (activeWorkspaceId && openedIds.has(activeWorkspaceId)) {
      return { opened, recent, selectedId: activeWorkspaceId, selection: "host_current" };
    }
    if (opened.length > 0) return { opened, recent, selectedId: opened[0].id, selection: "first_opened" };
    return { opened, recent, selectedId: null, selection: "none", ...(recent[0] ? { reopenCandidateId: recent[0].id } : {}) };
  },
  get_personal_overview: () => {
    const ready = value => ({ status: "ready", value });
    const now = Date.now();
    const jobs = DEV_FIXTURES.list_cron_jobs();
    const skills = DEV_FIXTURES.get_skill_configs({});
    const skillList = Array.isArray(skills) ? skills : Array.isArray(skills && skills.skills) ? skills.skills : [];
    const running = new Set(DEV_FIXTURES.miniapp_worker_list_running());
    const spaces = DEV_FIXTURES.list_miniapps().map(app => ({
      id: app.id,
      name: app.name || app.id,
      description: app.description || "",
      icon: app.icon || "shapes",
      running: running.has(app.id),
    }));
    const usage = DEV_FIXTURES.get_token_usage_statistics({ request: { timeRange: "custom", granularity: "day" } });
    return {
      assistants: ready({ count: DEV_FIXTURES.get_assistant_workspaces().length }),
      skills: ready({
        count: skillList.length,
        enabled: skillList.filter(skill => skill.enabled !== false && skill.disabled !== true).length,
      }),
      routines: ready({
        count: jobs.length,
        enabled: jobs.filter(job => job.enabled !== false).length,
        dueSoon: jobs
          .filter(job => job.enabled !== false && job.state && typeof job.state.nextRunAtMs === "number")
          .filter(job => job.state.nextRunAtMs >= now - 3600000 && job.state.nextRunAtMs <= now + DAY_MS)
          .sort((a, b) => a.state.nextRunAtMs - b.state.nextRunAtMs)
          .map(job => ({
            id: job.id,
            name: job.name || job.id,
            nextRunAtMs: job.state.nextRunAtMs,
            lastRunStatus: job.state.lastRunStatus,
            schedule: job.schedule,
          })),
      }),
      spaces: ready({ count: spaces.length, running: spaces.filter(item => item.running).length, items: spaces }),
      ssh: ready({ connections: DEV_FIXTURES.ssh_list_saved_connections() }),
      usage: ready({
        days: 30,
        totalTokens: usage.totalTokens,
        totalRequests: usage.totalRequests,
        inputTokens: usage.totalInputTokens,
        outputTokens: usage.totalOutputTokens,
        cachedTokens: usage.totalCachedTokens,
        failedRequests: usage.failedRequests,
        topModelName: usage.byModel[0] ? usage.byModel[0].name : "",
      }),
      activity: ready(devUsageActivity(now)),
    };
  },
  get_local_models_dev_catalogs: () => ({
    provider_catalog: {
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          endpoints: [
            { base_url: "https://api.openai.com/v1", api_format: "openai", label: "Global API" },
          ],
          models: [
            { id: "gpt-4.1", display_name: "GPT-4.1", limits: { context: 1047576, output: 32768 } },
            { id: "gpt-4.1-mini", display_name: "GPT-4.1 mini", limits: { context: 1047576, output: 32768 } },
            { id: "o3-mini", display_name: "o3-mini", limits: { context: 200000, output: 100000 } },
          ],
        },
        {
          id: "anthropic",
          name: "Anthropic",
          endpoints: [
            { base_url: "https://api.anthropic.com", api_format: "anthropic", label: "Anthropic API" },
          ],
          models: [
            { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5", limits: { context: 200000, output: 16384 } },
          ],
        },
        {
          id: "gemini",
          name: "Google Gemini",
          endpoints: [
            { base_url: "https://generativelanguage.googleapis.com", api_format: "gemini", label: "Gemini API" },
          ],
          models: [
            { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", limits: { context: 1048576, output: 65536 } },
          ],
        },
      ],
    },
  }),
  list_ai_models_by_config: args => {
    const req = payloadOf(args);
    const cfg = req.config || {};
    const fmt = String(cfg.format || cfg.provider || "openai").toLowerCase();
    if (fmt.includes("anthropic")) {
      return [
        {
          id: "claude-sonnet-4-5",
          display_name: "Claude Sonnet 4.5",
          owned_by: "anthropic",
          context_window: 200000,
          max_tokens: 16384,
          capabilities: ["text", "image", "function_calling"],
        },
        {
          id: "claude-opus-4-1",
          display_name: "Claude Opus 4.1",
          owned_by: "anthropic",
          context_window: 200000,
          max_tokens: 32000,
          capabilities: ["text", "image", "reasoning", "function_calling"],
        },
      ];
    }
    if (fmt.includes("gemini")) {
      return [
        {
          id: "gemini-2.5-pro",
          display_name: "Gemini 2.5 Pro",
          owned_by: "google",
          context_window: 1048576,
          max_tokens: 65536,
          capabilities: ["text", "image", "reasoning", "function_calling"],
        },
        {
          id: "gemini-2.5-flash",
          display_name: "Gemini 2.5 Flash",
          owned_by: "google",
          context_window: 1048576,
          max_tokens: 65536,
          capabilities: ["text", "image", "function_calling"],
        },
      ];
    }
    return [
      {
        id: "gpt-4.1",
        display_name: "GPT-4.1",
        owned_by: "openai",
        context_window: 1047576,
        max_tokens: 32768,
        capabilities: ["text", "image", "function_calling"],
      },
      {
        id: "gpt-4.1-mini",
        display_name: "GPT-4.1 mini",
        owned_by: "openai",
        context_window: 1047576,
        max_tokens: 32768,
        capabilities: ["text", "image", "function_calling"],
      },
      {
        id: "o3-mini",
        display_name: "o3-mini",
        owned_by: "openai",
        context_window: 200000,
        max_tokens: 100000,
        capabilities: ["text", "reasoning", "function_calling"],
      },
    ];
  },
  test_ai_config_connection: args => {
    const req = payloadOf(args);
    const cfg = req.config || {};
    const name = cfg.model_name || cfg.name || "model";
    return {
      success: true,
      response_time_ms: 142,
      responseTimeMs: 142,
      model_response: "OK",
      message: `Connected to ${name} · 142 ms`,
    };
  },
  list_subscription_accounts: () => [
    {
      provider: "openai",
      display_label: "Codex / ChatGPT Plus",
      account: "studio-user@example.com",
      connected: true,
      suggested_format: "responses",
    },
    {
      provider: "anthropic",
      display_label: "Claude Pro",
      account: null,
      connected: false,
      suggested_format: "anthropic",
    },
  ],
  get_subscription_account_quota: args => {
    const req = payloadOf(args);
    const provider = String(req.provider || "openai");
    return {
      account_id: String(req.accountId || provider),
      provider,
      state: "active",
      plan: "Plus",
      allowed: true,
      has_credits: true,
      primary_window: {
        label: "5-hour window",
        used_percent: 24,
        remaining_percent: 76,
        reset_at: new Date(Date.now() + 2 * HOUR_MS).toISOString(),
      },
      secondary_window: {
        label: "Weekly",
        used_percent: 18,
        remaining_percent: 82,
        reset_at: new Date(Date.now() + 4 * DAY_MS).toISOString(),
      },
    };
  },
  ssh_list_saved_connections: () => devSshConnections.map(c => ({ ...c })),
  ssh_save_connection: args => {
    const req = payloadOf(args);
    const cfg = req.config || req;
    const saved = {
      id: String(cfg.id || `dev-ssh-${devSshConnections.length + 1}`),
      name: String(cfg.name || cfg.host || "remote-host"),
      host: String(cfg.host || "127.0.0.1"),
      port: Number(cfg.port) || 22,
      username: String(cfg.username || "builder"),
      authType: toSavedAuthType(cfg.auth),
      ...(cfg.defaultWorkspace ? { defaultWorkspace: String(cfg.defaultWorkspace) } : {}),
      ...(cfg.proxyJump ? { proxyJump: String(cfg.proxyJump) } : {}),
      ...(cfg.proxyCommand ? { proxyCommand: String(cfg.proxyCommand) } : {}),
      ...(cfg.container ? { container: cfg.container } : {}),
      ...(cfg.wsl ? { wsl: cfg.wsl } : {}),
      ...(cfg.options ? { options: cfg.options } : {}),
      lastConnected: Date.now(),
    };
    const idx = devSshConnections.findIndex(c => c.id === saved.id);
    if (idx >= 0) devSshConnections[idx] = { ...devSshConnections[idx], ...saved };
    else devSshConnections.push(saved);
    return null;
  },
  ssh_delete_connection: args => {
    const req = payloadOf(args);
    const id = String(req.connectionId || "");
    const idx = devSshConnections.findIndex(c => c.id === id);
    if (idx >= 0) devSshConnections.splice(idx, 1);
    devSshConnectedIds.delete(id);
    return null;
  },
  ssh_has_stored_password: args => {
    const req = payloadOf(args);
    return String(req.connectionId || "") === "dev-ssh-1";
  },
  ssh_test_connection: args => {
    const req = payloadOf(args);
    const cfg = req.config || req;
    const hostLabel = String(cfg.name || cfg.host || "remote-host");
    const steps = [
      { id: "dns", label: `Resolve ${cfg.host || hostLabel}`, success: true },
      { id: "tcp", label: `TCP handshake (port ${cfg.port || 22})`, success: true },
      { id: "auth", label: "Authenticate SSH session", success: true },
      { id: "shell", label: "Probe remote home directory", success: true },
    ];
    return {
      success: true,
      latencyMs: 38,
      stages: steps,
      steps,
      serverInfo: {
        osType: "linux",
        hostname: hostLabel,
        homeDir: cfg.defaultWorkspace || "/srv",
        os: "Linux 6.8",
        arch: "x86_64",
      },
    };
  },
  ssh_connect: args => {
    const req = payloadOf(args);
    const cfg = req.config || req;
    const id = String(cfg.id || `dev-ssh-${Date.now()}`);
    devSshConnectedIds.add(id);
    return {
      success: true,
      connectionId: id,
      serverInfo: {
        osType: "linux",
        hostname: String(cfg.name || cfg.host || "build-host"),
        homeDir: cfg.defaultWorkspace || "/srv",
        os: "Linux 6.8",
        arch: "x86_64",
      },
    };
  },
  ssh_disconnect: args => {
    const req = payloadOf(args);
    devSshConnectedIds.delete(String(req.connectionId || ""));
    return null;
  },
  ssh_is_connected: args => {
    const req = payloadOf(args);
    return devSshConnectedIds.has(String(req.connectionId || ""));
  },
  // remote link + terminal profiles (wave 4): the dev host reports links as up.
  remote_workspace_ensure_connected: args => {
    const req = payloadOf(args);
    const connectionId = String(req.connectionId || "");
    devSshConnectedIds.add(connectionId);
    return { link: { connectionId, state: "connected", revision: Date.now() }, activated: false };
  },
  remote_workspace_link_states: () => [],
  ssh_get_server_info: args => {
    const req = payloadOf(args);
    const saved = devSshConnections.find(c => c.id === req.connectionId);
    return {
      osType: "linux",
      hostname: saved ? saved.name : "build-host",
      homeDir: saved && saved.defaultWorkspace ? saved.defaultWorkspace : "/srv",
      os: "Linux 6.8",
      arch: "x86_64",
    };
  },
  ssh_list_config_hosts: () => devSshConfigHosts.map(h => ({ ...h })),
  ssh_get_config: args => {
    const req = payloadOf(args);
    const host = String(req.host || "");
    const found = devSshConfigHosts.find(h => h.host === host);
    return found ? { found: true, config: { ...found } } : { found: false };
  },
  ssh_list_docker_containers: () => devDockerContainers.map(c => ({ ...c })),
  ssh_list_wsl_distributions: () => ({ supported: false, distributions: [] }),
  remote_read_dir: args => {
    const req = payloadOf(args);
    const dirPath = normalizeRemoteDirPath(req.path || "/srv");
    return (devRemoteDirs[dirPath] || []).map(entry => ({ ...entry }));
  },
  remote_exists: args => {
    const req = payloadOf(args);
    const target = normalizeRemoteDirPath(req.path || "");
    if (devRemoteDirs[target]) return true;
    const parent = parentRemoteDir(target);
    return (devRemoteDirs[parent] || []).some(entry => entry.path === target);
  },
  remote_create_dir: args => {
    const req = payloadOf(args);
    const target = normalizeRemoteDirPath(req.path || "");
    if (!target) throw new Error("Remote path is required");
    const parent = parentRemoteDir(target);
    const name = target.split("/").filter(Boolean).pop() || target;
    if (!devRemoteDirs[target]) devRemoteDirs[target] = [];
    if (!devRemoteDirs[parent]) devRemoteDirs[parent] = [];
    if (!devRemoteDirs[parent].some(entry => entry.path === target)) {
      devRemoteDirs[parent].unshift({
        name,
        path: target,
        isDir: true,
        isFile: false,
        isSymlink: false,
        permissions: "drwxr-xr-x",
      });
    }
    return null;
  },
  remote_rename: args => {
    const req = payloadOf(args);
    const oldPath = normalizeRemoteDirPath(req.oldPath || "");
    const newPath = normalizeRemoteDirPath(req.newPath || "");
    const parent = parentRemoteDir(oldPath);
    const entries = devRemoteDirs[parent] || [];
    const target = entries.find(e => e.path === oldPath);
    if (target && newPath) {
      target.path = newPath;
      target.name = newPath.split("/").filter(Boolean).pop() || newPath;
    }
    if (devRemoteDirs[oldPath]) {
      devRemoteDirs[newPath] = devRemoteDirs[oldPath];
      delete devRemoteDirs[oldPath];
    }
    return null;
  },
  remote_remove: args => {
    const req = payloadOf(args);
    const target = normalizeRemoteDirPath(req.path || "");
    const parent = parentRemoteDir(target);
    if (Array.isArray(devRemoteDirs[parent])) {
      devRemoteDirs[parent] = devRemoteDirs[parent].filter(e => e.path !== target);
    }
    delete devRemoteDirs[target];
    return null;
  },
  open_remote_workspace: args => {
    const req = payloadOf(args);
    const remotePath = normalizeRemoteDirPath(req.remotePath || "/srv/app");
    const connectionId = String(req.connectionId || "dev-ssh-1");
    const connectionName = String(req.connectionName || "build-host");
    const sshHost = req.sshHost ? String(req.sshHost) : connectionName;
    const existing = devWorkspaces.find(
      w => w.workspaceKind === "remote" && w.rootPath === remotePath,
    );
    if (existing) {
      existing.connectionId = connectionId;
      existing.connectionName = connectionName;
      existing.sshHost = sshHost;
      existing.lastAccessed = Date.now();
      activeWorkspaceId = existing.id;
      devActiveRemoteWorkspace = {
        workspaceId: existing.id,
        connectionId,
        connectionName,
        remotePath,
        sshHost,
      };
      return existing;
    }
    const dirName = remotePath.split("/").filter(Boolean).pop() || remotePath;
    const created = {
      id: `dev-workspace-remote-${remoteWorkspaceSeq++}`,
      name: `${dirName} [${connectionName}]`,
      rootPath: remotePath,
      workspaceKind: "remote",
      connectionId,
      connectionName,
      sshHost,
      lastAccessed: Date.now(),
    };
    devWorkspaces.push(created);
    if (!devFiles[remotePath]) {
      devFiles[remotePath] = (devRemoteDirs[remotePath] || []).map(e => ({
        name: e.name,
        path: e.path,
        isDirectory: e.isDir,
        size: e.size,
      }));
    }
    activeWorkspaceId = created.id;
    devActiveRemoteWorkspace = {
      workspaceId: created.id,
      connectionId,
      connectionName,
      remotePath,
      sshHost,
    };
    return created;
  },
  remote_open_workspace: args => {
    const req = payloadOf(args);
    const remotePath = normalizeRemoteDirPath(req.remotePath || "/srv/app");
    const connectionId = String(req.connectionId || "dev-ssh-1");
    const saved = devSshConnections.find(c => c.id === connectionId);
    const connectionName = saved ? saved.name : "build-host";
    if (!devWorkspaces.some(w => w.workspaceKind === "remote" && w.rootPath === remotePath)) {
      const dirName = remotePath.split("/").filter(Boolean).pop() || remotePath;
      devWorkspaces.push({
        id: `dev-workspace-remote-${remoteWorkspaceSeq++}`,
        name: `${dirName} [${connectionName}]`,
        rootPath: remotePath,
        workspaceKind: "remote",
        connectionId,
        connectionName,
        sshHost: saved ? saved.host : connectionName,
        lastAccessed: Date.now(),
      });
    }
    devActiveRemoteWorkspace = {
      connectionId,
      connectionName,
      remotePath,
      sshHost: saved ? saved.host : undefined,
    };
    return null;
  },
  remote_close_workspace: () => {
    devActiveRemoteWorkspace = null;
    return null;
  },
  remote_remove_workspace: args => {
    const req = payloadOf(args);
    const targetPath = normalizeRemoteDirPath(req.remotePath || "");
    const idx = devWorkspaces.findIndex(
      w => w.workspaceKind === "remote" && w.connectionId === req.connectionId && w.rootPath === targetPath,
    );
    if (idx >= 0) devWorkspaces.splice(idx, 1);
    return null;
  },
  remote_get_workspace_info: () => devActiveRemoteWorkspace,
  ssh_list_port_forwards: args => {
    const req = payloadOf(args);
    if (req.connectionId) {
      return devPortForwards.filter(p => p.connectionId === req.connectionId).map(p => ({ ...p }));
    }
    return devPortForwards.map(p => ({ ...p }));
  },
  ssh_list_remote_listening_ports: () => [
    { port: 8080, bindAddress: "127.0.0.1", process: "node", pid: 4120 },
    { port: 5432, bindAddress: "127.0.0.1", process: "postgres", pid: 1842 },
    { port: 3000, bindAddress: "0.0.0.0", process: "vite", pid: 5033 },
  ],
  ssh_start_port_forward: args => {
    const req = payloadOf(args);
    const remotePort = Number(req.remotePort);
    const localPort = Number(req.localPort) || remotePort;
    const forward = {
      id: `pf-${portForwardSeq++}`,
      connectionId: String(req.connectionId || "dev-ssh-1"),
      direction: "local",
      ...(req.label ? { label: String(req.label) } : {}),
      ...(req.description ? { description: String(req.description) } : {}),
      localHost: req.exposeOnLan ? "0.0.0.0" : "127.0.0.1",
      localPort,
      remoteHost: String(req.remoteHost || "127.0.0.1"),
      remotePort,
      activeConnections: 0,
      totalConnections: 0,
    };
    devPortForwards.push(forward);
    return forward;
  },
  ssh_stop_port_forward: args => {
    const req = payloadOf(args);
    const idx = devPortForwards.findIndex(p => p.id === req.forwardId);
    if (idx >= 0) devPortForwards.splice(idx, 1);
    return null;
  },
  dispatch_list_targets: () => [{ id: "local", displayName: "Studio Mac", kind: "local" }],
  dispatch_list_jobs: () => [],
  get_mcp_servers: () => devMcpServers.map(row => ({ ...row })),
  load_mcp_json_config: () => ({
    jsonConfig: devMcpJsonConfig,
    fingerprint: `dev-mcp-fp-${devMcpFingerprint}`,
  }),
  save_mcp_json_config: args => {
    const req = payloadOf(args);
    const expected = String(req.expectedFingerprint || "");
    if (expected && expected !== `dev-mcp-fp-${devMcpFingerprint}`) {
      throw new Error("MCP configuration changed; reload before saving");
    }
    devMcpJsonConfig = String(req.jsonConfig || "{\n  \"mcpServers\": {}\n}");
    devMcpFingerprint += 1;
    return null;
  },
  start_mcp_server: args => {
    const req = payloadOf(args);
    const row = devMcpServers.find(s => s.id === req.serverId);
    if (row) row.status = "Connected";
    return null;
  },
  stop_mcp_server: args => {
    const req = payloadOf(args);
    const row = devMcpServers.find(s => s.id === req.serverId);
    if (row) row.status = "Stopped";
    return null;
  },
  restart_mcp_server: args => {
    const req = payloadOf(args);
    const row = devMcpServers.find(s => s.id === req.serverId);
    if (row) row.status = "Connected";
    return null;
  },
  delete_mcp_server: args => {
    const req = payloadOf(args);
    const id = String(req.serverId || "");
    const idx = devMcpServers.findIndex(s => s.id === id);
    if (idx >= 0) devMcpServers.splice(idx, 1);
    try {
      const parsed = JSON.parse(devMcpJsonConfig);
      if (parsed && parsed.mcpServers && id in parsed.mcpServers) {
        delete parsed.mcpServers[id];
        devMcpJsonConfig = JSON.stringify(parsed, null, 2);
        devMcpFingerprint += 1;
      }
    } catch {
      // Keep raw JSON if user edited invalid syntax.
    }
    return null;
  },
  list_mcp_resources: () => [],
  read_mcp_resource: () => ({ contents: [] }),
  get_acp_clients: () => [],
  probe_acp_client_requirements: () => [],
  load_acp_json_config: () => devAcpJsonConfig,
  save_acp_json_config: args => {
    const req = payloadOf(args);
    devAcpJsonConfig = String(req.jsonConfig ?? "{\n  \"acpClients\": {}\n}\n");
    return { ok: true };
  },
  stop_acp_client: () => ({ ok: true }),
  install_acp_client_cli: () => ({ ok: true }),
  i18n_get_current_language: () => devConfigs.app.language,
  i18n_set_language: args => {
    const req = payloadOf(args);
    const raw = typeof req.language === "string" ? req.language : typeof req.locale === "string" ? req.locale : "";
    const canonical = normalizeDevLocale(raw) || raw || "en-US";
    devConfigs.app = { ...devConfigs.app, language: canonical };
    devConfigs["app.language"] = canonical;
    devConfigs["appearance.language"] = canonical;
    return null;
  },
  update_session_model: args => {
    const req = payloadOf(args);
    const sessionId = String(req.sessionId || req.session_id || "");
    const modelName = String(req.modelName || req.model_name || "");
    const session = devSessions.find(s => s.sessionId === sessionId);
    if (session && modelName) session.modelName = modelName;
    return null;
  },
  get_model_pools: () => ({ version: 1, pools: [] }),
  get_runtime_logging_info: () => ({
    effectiveLevel: "info",
    sessionLogDir: "/workspace/demo/.openbitfun/logs",
    appLogPath: "/workspace/demo/.openbitfun/logs/app.log",
    previousUnexpectedExit: null,
  }),
  get_web_search_credential_status: () => ({ configured: false }),
  get_decision_model_credential_status: () => ({ configured: false }),
};

// ── UI-B OpenBitFun conversation (wave 15) ───────────────────────────────────
//
// The cloud node's `superagent_*` answers for the development page: one
// conversation with three live jobs (visual spec §4.3), Working now and the
// history groups. A send appends the message and a short reply in place; the
// tests drive the live events themselves.
const devSuperagent = (() => {
  const now = Date.now();
  const MIN = 60 * 1000;
  const gate = (allowed, reason) => (allowed ? { allowed: true } : { allowed: false, reason });
  const cards = {
    "job-build": {
      jobId: "job-build", deviceId: "dev-linux", deviceName: "linux-box", os: "linux", hostKind: "cli",
      title: "Build release 1.2", state: "done", branch: "release/1.2",
      diffStat: { filesChanged: 2, insertions: 3, deletions: 1, files: [], truncated: false },
      sessionId: "session-1", updatedMs: now - 4 * MIN, seen: false,
      actions: { openTranscript: gate(true), message: gate(true), cancel: gate(false, "job_terminal"), publish: gate(true), answer: gate(false, "no_pending_prompt") },
    },
    "job-test-mac": {
      jobId: "job-test-mac", deviceId: "dev-mac", deviceName: "mac-mini", os: "macos", hostKind: "desktop",
      title: "Test release 1.2", state: "blocked", stateReason: "prompt_pending", branch: "release/1.2",
      pendingPrompt: { requestId: "perm-e2e", toolName: "Bash", title: "pnpm e2e", more: 0, kind: "permission", payload: { action: "bash", resources: ["pnpm e2e"] } },
      sessionId: "session-2", updatedMs: now - 10 * 1000,
      actions: { openTranscript: gate(true), message: gate(true), cancel: gate(true), publish: gate(false, "job_not_finished"), answer: gate(true) },
    },
    "job-test-linux": {
      jobId: "job-test-linux", deviceId: "dev-linux", deviceName: "linux-box", os: "linux", hostKind: "cli",
      title: "Test release 1.2", state: "working", branch: "release/1.2", summaryLine: "cargo test 812/1400",
      lastAnswer: { promptId: "perm-cargo", answeredBy: "superagent", decision: "once", atMs: now - 2 * MIN, detail: "cargo test --workspace" },
      sessionId: "session-1", updatedMs: now - 2 * MIN,
      actions: { openTranscript: gate(true), message: gate(true), cancel: gate(true), publish: gate(false, "job_not_finished"), answer: gate(false, "no_pending_prompt") },
    },
    "job-test-win": {
      jobId: "job-test-win", deviceId: "dev-win", deviceName: "win-pc", os: "windows", hostKind: "desktop",
      title: "Test release 1.2", state: "queued", stateReason: "waiting_for_device",
      summaryLine: "Starts when it's online, expires in 23 h", updatedMs: now - 1 * MIN,
      actions: { openTranscript: gate(false, "waiting_for_device"), message: gate(false, "waiting_for_device"), cancel: gate(true), publish: gate(false, "job_not_finished"), answer: gate(false, "no_pending_prompt") },
    },
  };
  const conversations = {
    "conv-release": {
      id: "conv-release", title: "Release 1.2", updatedMs: now - MIN, rollup: "needs_you", unread: false,
      turn: { id: "turn-3", step: "model_round", rounds: 3 },
      messages: [
        { id: "m1", role: "user", text: "Build on the linux box, then test it on all three.", atMs: now - 9 * MIN, clientMessageId: "dev-c1" },
        { id: "m2", role: "assistant", text: "Building on linux-box first. I'll start the tests when it passes.", atMs: now - 9 * MIN },
        { id: "m3", role: "jobs", jobIds: ["job-build"], atMs: now - 9 * MIN },
        { id: "m4", role: "assistant", text: "Build passed. Testing on three machines.", atMs: now - 4 * MIN, citations: [{ jobId: "job-build", label: "Build release 1.2" }] },
        { id: "m5", role: "jobs", jobIds: ["job-test-mac", "job-test-linux", "job-test-win"], atMs: now - 4 * MIN },
      ],
    },
    "conv-812": { id: "conv-812", title: "Fix #812", updatedMs: now - 30 * MIN, rollup: "working", unread: false, turn: null, messages: [] },
    "conv-deps": { id: "conv-deps", title: "Bump deps", updatedMs: now - 26 * 60 * MIN, rollup: "unread", unread: true, turn: null, messages: [] },
    "conv-docs": { id: "conv-docs", title: "Docs pass", updatedMs: now - 30 * 60 * MIN, rollup: "none", unread: false, turn: null, messages: [] },
  };
  const row = conversation => ({
    id: conversation.id, title: conversation.title, updatedMs: conversation.updatedMs,
    status: conversation.turn ? "running" : "idle", rollup: conversation.rollup, unread: conversation.unread,
  });
  let seq = 0;
  // The Super Agent model picker: every device with its models (the cloud
  // node's order), and each conversation's pick (absent: Auto).
  const superagentModelDevices = [
    { deviceId: "dev-mac", name: "MacBook Pro", hostKind: "desktop", online: true,
      models: [{ modelId: "model-1", displayName: "Claude Sonnet", provider: "anthropic", primary: true }, { modelId: "model-2", displayName: "GPT-5", provider: "openai" }] },
    { deviceId: "dev-linux", name: "build-box", hostKind: "cli", online: false, unavailableReason: "device_offline",
      models: [{ modelId: "model-srv", displayName: "Qwen", provider: "openai", primary: true }] },
  ];
  const modelSelectionOf = conversation => {
    const pick = conversation && conversation.model;
    if (!pick) return { mode: "auto" };
    const device = superagentModelDevices.find(item => item.deviceId === pick.deviceId);
    const model = device && device.models.find(item => item.modelId === pick.modelId);
    return {
      mode: "pinned",
      deviceId: pick.deviceId,
      deviceName: device ? device.name : undefined,
      modelId: pick.modelId,
      modelName: model ? model.displayName : undefined,
      ...(device && device.unavailableReason ? { unavailableReason: device.unavailableReason } : {}),
    };
  };
  const fixtures = {
    superagent_status: () => ({
      enabled: true, signedIn: devAccountLoggedIn, deviceId: "cloud-dev", name: "Super Agent", hostKind: "cloud",
      placeholder: "Ask Super Agent…",
      suggestions: devAccountLoggedIn ? ["Run the tests on all my devices", "Update deps", "Summarize today's work"] : [],
      workingNow: devAccountLoggedIn
        ? { needsYou: [cards["job-test-mac"]], working: [cards["job-test-linux"], cards["job-test-win"]] }
        : { needsYou: [], working: [] },
      models: devAccountLoggedIn ? superagentModelDevices : [],
    }),
    superagent_enable: () => ({ enabled: true }),
    superagent_disable: () => ({ enabled: false }),
    superagent_list_conversations: () => ({
      groups: devAccountLoggedIn
        ? [
            { id: "today", rows: [row(conversations["conv-release"]), row(conversations["conv-812"])] },
            { id: "yesterday", rows: [row(conversations["conv-deps"]), row(conversations["conv-docs"])] },
          ].map(group => ({ ...group, rows: group.rows.filter(item => conversations[item.id]) })).filter(group => group.rows.length > 0)
        : [],
      nextCursor: null,
      timeZone: "UTC",
    }),
    superagent_get_conversation: args => {
      const req = payloadOf(args);
      const conversation = conversations[req.conversationId || req.id];
      if (!conversation) throw new Error("not_found: no such conversation");
      const ids = new Set(conversation.messages.flatMap(message => message.jobIds || []));
      return {
        conversation: { id: conversation.id, title: conversation.title, updatedMs: conversation.updatedMs, turn: conversation.turn, model: modelSelectionOf(conversation) },
        messages: conversation.messages,
        cursor: 0,
        hasMore: false,
        cards: [...ids].map(id => cards[id]).filter(Boolean),
      };
    },
    superagent_send: args => {
      const req = payloadOf(args);
      let conversation = req.conversationId ? conversations[req.conversationId] : null;
      if (!conversation) {
        const id = `conv-dev-${++seq}`;
        conversation = { id, title: String(req.message || "").slice(0, 48), updatedMs: Date.now(), rollup: "none", unread: false, turn: null, messages: [] };
        conversations[id] = conversation;
      }
      if (req.model !== undefined) conversation.model = req.model || null;
      const duplicate = conversation.messages.some(message => message.clientMessageId === req.clientMessageId);
      if (!duplicate) {
        conversation.messages.push({ id: `m-dev-${++seq}`, role: "user", text: String(req.message || ""), atMs: Date.now(), clientMessageId: req.clientMessageId });
        conversation.messages.push({ id: `m-dev-${++seq}`, role: "assistant", text: "On it. I'll report back here as the jobs finish.", atMs: Date.now() });
      }
      conversation.turn = { id: `turn-dev-${seq}`, step: "done", rounds: 1 };
      conversation.updatedMs = Date.now();
      return { conversationId: conversation.id, messageId: `m-dev-${seq}`, turnId: `turn-dev-${seq}`, duplicate };
    },
    superagent_set_model: args => {
      const req = payloadOf(args);
      const conversation = conversations[req.conversationId];
      if (!conversation) throw new Error("not_found: no such conversation");
      if (Boolean(req.deviceId) !== Boolean(req.modelId)) throw new Error("invalid_request: pick a device and a model, or Auto");
      conversation.model = req.deviceId ? { deviceId: req.deviceId, modelId: req.modelId } : null;
      return { conversationId: conversation.id, model: modelSelectionOf(conversation) };
    },
    superagent_cancel_turn: args => {
      const conversation = conversations[payloadOf(args).conversationId];
      if (conversation && conversation.turn) conversation.turn = { ...conversation.turn, step: "cancelled" };
      return { cancelled: true };
    },
    superagent_job_action: args => {
      const req = payloadOf(args);
      const card = cards[req.jobId];
      if (!card) throw new Error("not_found: no such job");
      if (req.action === "cancel") {
        cards[req.jobId] = { ...card, state: "cancelled", stateReason: undefined, updatedMs: Date.now(), pendingPrompt: undefined };
        return { cancelled: true, card: cards[req.jobId] };
      }
      if (req.action === "message") return { jobId: req.jobId, outcome: card.state === "working" ? "steered" : "started" };
      if (req.action === "refresh") return { card };
      throw new Error(`invalid_request: unknown job action '${req.action}'`);
    },
    superagent_rename_conversation: args => {
      const req = payloadOf(args);
      const conversation = conversations[req.conversationId];
      if (!conversation) throw new Error("not_found: no such conversation");
      conversation.title = String(req.title || "").slice(0, 120);
      return { conversationId: conversation.id, title: conversation.title };
    },
    superagent_delete_conversation: args => {
      const req = payloadOf(args);
      delete conversations[req.conversationId];
      return { deleted: true, jobsLeftRunning: 0 };
    },
    superagent_delete_data: () => ({ deleted: true, jobsCancelled: 0, jobsLeftRunning: 0 }),
  };
  return fixtures;
})();
Object.assign(DEV_FIXTURES, devSuperagent);
// ── end UI-B OpenBitFun conversation (wave 15) ───────────────────────────────

// ── wave22-p5 session and settings parity (dev fixtures) ─────────────────────
// The goal, background commands, MCP prompts, desktop-control permissions, the
// workspace icon and settings export, as a desktop answers them.
const devP5Goals = {};
Object.assign(DEV_FIXTURES, {
  get_session_thread_goal: args => ({ goal: devP5Goals[payloadOf(args).sessionId] ?? null }),
  activate_session_goal: args => {
    const req = payloadOf(args);
    devP5Goals[req.sessionId] = { goalId: `goal-${req.sessionId}`, sessionId: req.sessionId, objective: req.userHint, status: "active", tokensUsed: 0 };
    return { success: true, goal: devP5Goals[req.sessionId] };
  },
  update_session_thread_goal_objective: args => {
    const req = payloadOf(args);
    devP5Goals[req.sessionId] = { ...(devP5Goals[req.sessionId] ?? {}), objective: req.objective, status: "active" };
    return devP5Goals[req.sessionId];
  },
  set_session_thread_goal_status: args => {
    const req = payloadOf(args);
    devP5Goals[req.sessionId] = { ...(devP5Goals[req.sessionId] ?? {}), status: req.status };
    return devP5Goals[req.sessionId];
  },
  clear_session_thread_goal: args => {
    delete devP5Goals[payloadOf(args).sessionId];
    return null;
  },
  list_background_command_activities: () => ({ activities: [] }),
  list_mcp_prompts: () => [],
  computer_use_get_status: () => ({
    computerUseEnabled: false,
    accessibilityGranted: false,
    screenCaptureGranted: true,
    permissions: {
      platform: "macos",
      process_id: 1,
      prompts_requested: false,
      permissions: [
        { kind: "accessibility", state: "required", requestable: true, settings_url: "x-apple.systempreferences:", detail: "Lets agents click and type for you." },
        { kind: "screen_recording", state: "granted", requestable: false, settings_url: null, detail: "Lets agents see the screen." },
      ],
    },
  }),
  computer_use_request_permission: () => null,
  computer_use_open_system_settings: () => null,
  get_workspace_icon: args => ({
    workspaceId: payloadOf(args).workspaceId,
    icon: { version: 1, revision: 0, mode: "default", color: "default", glyph: "default" },
    imageUnavailable: false,
    supportedGlyphs: ["default", "code", "learning", "design", "documents", "research", "web", "mobile", "games", "data", "business", "tools", "travel", "food", "fitness", "music", "reading", "home", "finance", "photography", "pets", "nature", "shopping", "movies"],
  }),
  set_workspace_icon: args => ({ workspaceId: payloadOf(args).workspaceId, icon: { version: 1, revision: 1, mode: "default", color: "default", glyph: payloadOf(args).icon?.glyph }, imageUnavailable: false }),
  export_config: () => ({ product_id: "openbitfun", format_version: 1, config: {}, export_timestamp: "2026-11-21T00:00:00Z", version: "2.0.0" }),
  import_config: () => ({ success: true, errors: [], warnings: [] }),
});
// ── end wave22-p5 ─────────────────────────────────────────────────────────────
// ── wave22-p2 browser (dev fixtures) ─────────────────────────────────────────
// A desktop's agent page as its live view copy, and the user's own Chrome, as
// a desktop answers them.
const devP2BrowserPage = `<!DOCTYPE html><html><head><meta name="viewport" content="width=1024"><style>
body{font:15px -apple-system,Helvetica,sans-serif;margin:0;color:#1f2023}
header{display:flex;gap:24px;align-items:center;padding:16px 32px;border-bottom:1px solid #e5e5e5}
header b{font-size:18px} nav span{margin-right:16px;color:#08798a}
main{padding:32px;max-width:760px} h1{font-size:28px;margin:0 0 12px} p{line-height:24px;color:#4a4c52}
.card{border:1px solid #e5e5e5;border-radius:12px;padding:16px;margin-top:16px}
button{background:#08798a;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px}
</style></head><body><header><b>Acme Docs</b><nav><span>Guides</span><span>API</span><span>Pricing</span></nav></header>
<main><h1>Deploying with Acme</h1><p>Connect your repository, pick a region and press Deploy. Every push to main builds a preview.</p>
<div class="card"><p>Region: Frankfurt · Plan: Team</p><button>Deploy now</button></div></main></body></html>`;
let devP2BrowserConnected = true;
Object.assign(DEV_FIXTURES, {
  browser_webview_capture_preview: () => ({
    status: "snapshot",
    label: "embedded-browser-panel-view-dev-1",
    url: "https://docs.acme.dev/deploy",
    title: "Deploying with Acme",
    html: devP2BrowserPage,
    viewportWidth: 1024,
    viewportHeight: 768,
    capturedAtMs: Date.now(),
  }),
  browser_control_get_status: () => ({
    cdpAvailable: devP2BrowserConnected,
    defaultCdpSupported: true,
    defaultCdpEnabled: devP2BrowserConnected,
    setupUrl: "chrome://inspect/#remote-debugging",
    browserReady: devP2BrowserConnected,
    browserKind: "chrome",
    browserVersion: devP2BrowserConnected ? "Chrome/142" : null,
    port: 9222,
    pageCount: devP2BrowserConnected ? 3 : 0,
  }),
  browser_control_enable_default_cdp: () => {
    devP2BrowserConnected = true;
    return { success: true, status: "connected_user_profile", browserKind: "chrome" };
  },
  browser_control_launch: () => {
    devP2BrowserConnected = true;
    return { success: true, status: "launched", browserKind: "chrome" };
  },
  browser_control_disconnect: () => {
    devP2BrowserConnected = false;
    return { success: true, status: "disconnected", browserKind: "chrome" };
  },
});
// ── end wave22-p2 ─────────────────────────────────────────────────────────────


// ── Browser controller (page realm): device key and the end-to-end channel ──
//
// A page the OpenBitFun domain serves drives the account's devices through the
// server gateway (`wss://<domain>/obp/<deviceId>`), a byte pipe into the
// account's Link network. The device key lives here, in the page's WebCrypto
// (X25519, non-extractable) and IndexedDB, never in the app realm. Inside the
// pipe this module runs OBP's end-to-end channel (`obp-e2e-v1`, see
// `src/apps/desktop/src/backend_protocol/ws/e2e.rs`): the account-device proof
// over the pair key both devices derive from their directory keys, bound to
// fresh X25519 ephemeral keys, then AES-256-GCM records. The gateway sees only
// ciphertext. The app realm gets plain OBP JSON-RPC text messages:
//
//   host.call("openbitfun.controller.key")                  -> { deviceId, publicKey }
//   host.call("openbitfun.controller.forgetKey")
//   host.call("openbitfun.controller.open", { id, url, target, targetPublicKey })
//   host.call("openbitfun.controller.send", { id, text })
//   host.call("openbitfun.controller.close", { id, code, reason })
//   player event "openbitfun.controller.socket"             -> { id, type: open|message|close, ... }

const CONTROLLER_DB = "openbitfun-controller";
const CONTROLLER_STORE = "keys";
const CONTROLLER_KEY_ID = "device";
const E2E_MAGIC = "OBPE2E1\n";
const E2E_FINGERPRINT_PREFIX = "obp-e2e-v1:";
const E2E_KEYS_INFO = "obp-e2e-v1 keys";
const DEVICE_KDF_SALT = "OpenBitFun Relay v1.0.0 device key";
const HANDSHAKE_KEY_DOMAIN = "OpenBitFun OBP mesh v1 handshake key";
const E2E_RECORD_MAX = 34 * 1024 * 1024;
const E2E_WS_CHUNK = 256 * 1024;
const E2E_HANDSHAKE_TIMEOUT_MS = 30000;

// Made on first use: the headless test runtime that loads this module has no
// TextEncoder, and only a controller page needs one.
const utf8 = {
  encode(text) {
    return new TextEncoder().encode(text);
  },
};
const fromUtf8 = {
  decode(bytes) {
    return new TextDecoder().decode(bytes);
  },
};

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function base64ToBytes(text) {
  const normalized = String(text).trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compareBytes(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length - b.length;
}

function controllerSubtle() {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle || typeof indexedDB === "undefined") {
    throw new Error(
      "controller_unsupported: this browser cannot keep a device key (a secure page with WebCrypto and IndexedDB is required)",
    );
  }
  return subtle;
}

function openControllerDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTROLLER_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CONTROLLER_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB is unavailable"));
  });
}

async function controllerDbRun(mode, run) {
  const db = await openControllerDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CONTROLLER_STORE, mode);
      const request = run(transaction.objectStore(CONTROLLER_STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

let controllerKeyPromise = null;

/** This browser's device key: created once, kept non-extractable in IndexedDB. */
function controllerDeviceKey() {
  if (!controllerKeyPromise) {
    controllerKeyPromise = (async () => {
      const subtle = controllerSubtle();
      const stored = await controllerDbRun("readonly", store => store.get(CONTROLLER_KEY_ID));
      if (stored && stored.privateKey && stored.publicKey && stored.deviceId) return stored;
      let pair;
      try {
        pair = await subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
      } catch {
        throw new Error("controller_unsupported: this browser has no X25519 key support; update it");
      }
      const id = new Uint8Array(16);
      crypto.getRandomValues(id);
      const record = {
        deviceId: `web-${Array.from(id, byte => byte.toString(16).padStart(2, "0")).join("")}`,
        privateKey: pair.privateKey,
        publicKey: bytesToBase64(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))),
        createdAt: Date.now(),
      };
      try {
        // `add` refuses when another tab stored its key first; that one wins.
        await controllerDbRun("readwrite", store => store.add(record, CONTROLLER_KEY_ID));
        return record;
      } catch {
        const winner = await controllerDbRun("readonly", store => store.get(CONTROLLER_KEY_ID));
        if (winner && winner.privateKey) return winner;
        throw new Error("controller_unsupported: this browser could not store its device key");
      }
    })();
    controllerKeyPromise.catch(() => {
      controllerKeyPromise = null;
    });
  }
  return controllerKeyPromise;
}

async function forgetControllerKey() {
  controllerKeyPromise = null;
  await controllerDbRun("readwrite", store => store.delete(CONTROLLER_KEY_ID));
}

async function hmacSha256(subtle, key, message) {
  const imported = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", imported, message));
}

async function hkdfSha256(subtle, ikm, salt, info, bits) {
  const imported = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, imported, bits));
}

async function x25519Shared(subtle, privateKey, publicRaw) {
  const peer = await subtle.importKey("raw", publicRaw, { name: "X25519" }, true, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: peer }, privateKey, 256));
  if (shared.every(byte => byte === 0)) throw new Error("the device key is invalid");
  return shared;
}

/** The device pair key (`device_crypto::derive_message_key`). */
async function devicePairKey(subtle, key, targetPublicKey) {
  const peer = base64ToBytes(targetPublicKey);
  if (peer.length !== 32) throw new Error("the device key is invalid");
  const local = base64ToBytes(key.publicKey);
  const shared = await x25519Shared(subtle, key.privateKey, peer);
  const ordered = compareBytes(local, peer) < 0 ? concatBytes(local, peer) : concatBytes(peer, local);
  return hkdfSha256(subtle, shared, utf8.encode(DEVICE_KDF_SALT), ordered, 256);
}

/** `openbitfun_link::handshake` proof over the mesh claims. */
async function meshProof(subtle, handshakeKey, role, claims) {
  const message = [
    "obp-mesh-v1",
    role,
    claims.client,
    claims.server,
    claims.fingerprint,
    String(claims.time),
    claims.nonce,
  ].join("\n");
  return bytesToBase64Url(await hmacSha256(subtle, handshakeKey, utf8.encode(message)));
}

function e2eNonce(counter) {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(counter));
  return nonce;
}

function lengthPrefixed(body) {
  const framed = new Uint8Array(4 + body.length);
  new DataView(framed.buffer).setUint32(0, body.length);
  framed.set(body, 4);
  return framed;
}

// ── Device UI bundles (page realm): the launcher's half of the UI loader ──
//
// A browser runs the exact web UI a device ships (`web/ui-loader.js`, a
// Service Worker under `/app/b/`). After the app realm read the device's
// manifest over the end-to-end channel (`ui_bundle_manifest`):
//
//   host.call("openbitfun.controller.prepareBundle", { manifest, deviceId }) -> { bundleId }
//     registers the loader, which checks the manifest, recomputes its id and stores it
//   host.call("openbitfun.controller.launch", { bundleId, deviceId })
//     writes the handoff and opens /app/b/<bundleId>/index.html#device=<deviceId>
//   host.call("openbitfun.controller.page") -> { handoff, showDevices, uiError }
//   host.call("openbitfun.controller.leave")
//     a device's UI page goes back to the launcher's device list
//
// Handoff v1 is a frozen cross-version contract: sessionStorage
// `obf.controller.handoff.v1` = `{ "v": 1, "deviceId", "at": <ms> }`. Readers
// ignore fields they do not know; writers only ever add fields.

const CONTROLLER_HANDOFF_KEY = "obf.controller.handoff.v1";
const UI_LOADER_STORE_MESSAGE = "obf-ui-store";
const UI_LOADER_TIMEOUT_MS = 15000;
const BUNDLE_PAGE_PATH = /^(.*\/)b\/([0-9a-f]{64})\/(?:[^/]+\/)*[^/]*$/;
const BUNDLE_ID = /^[0-9a-f]{64}$/;

/** The handoff v1 in `storage`, or `null` when there is none or it is not v1. */
export function readControllerHandoff(storage) {
  let text = null;
  try {
    text = storage ? storage.getItem(CONTROLLER_HANDOFF_KEY) : null;
  } catch {
    return null;
  }
  if (!text) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.v !== 1) return null;
  if (typeof value.deviceId !== "string" || !value.deviceId) return null;
  return { ...value, at: typeof value.at === "number" ? value.at : null };
}

/** Writes handoff v1 for `deviceId`. */
export function writeControllerHandoff(storage, deviceId, now = Date.now()) {
  const handoff = { v: 1, deviceId, at: now };
  storage.setItem(CONTROLLER_HANDOFF_KEY, JSON.stringify(handoff));
  return handoff;
}

/** `{ launcher, bundleId }` when `location` is a device UI page under `<launcher>b/<bundleId>/`. */
export function bundlePageOf(location) {
  if (!location || typeof location.pathname !== "string") return null;
  const match = BUNDLE_PAGE_PATH.exec(location.pathname);
  if (!match) return null;
  return { launcher: `${location.origin}${match[1]}`, bundleId: match[2] };
}

/** The `#nsh-params` a device UI page served by the loader runs with. */
export function bundlePageParams(location) {
  const page = bundlePageOf(location);
  if (!page) return null;
  const socket = location.protocol === "http:" ? "ws:" : "wss:";
  return {
    controller: {
      api: `${location.origin}/obp/api/v1`,
      gateway: `${socket}//${location.host}/obp`,
      uiBundleId: page.bundleId,
      bundlePage: true,
    },
  };
}

/** The one-shot fragment parameters (`#device=`, `#ui-error=`, `#switch=1`). */
function fragmentParams(location) {
  const hash = location && typeof location.hash === "string" ? location.hash.replace(/^#/, "") : "";
  try {
    return new URLSearchParams(hash);
  } catch {
    return new URLSearchParams();
  }
}

/** What a page realm knows about how this page was started. */
export function controllerPageState(location, storage) {
  const page = bundlePageOf(location);
  const fragment = fragmentParams(location);
  const hashDevice = fragment.get("device");
  let handoff = null;
  if (page) {
    const stored = readControllerHandoff(storage);
    if (hashDevice) {
      // Explicit `#device=` wins over a stale handoff for another device; preserve
      // full v1 handoff metadata when both agree on the same device.
      handoff = stored && stored.deviceId === hashDevice ? stored : { v: 1, deviceId: hashDevice, at: null };
    } else {
      handoff = stored;
    }
  }
  const reason = fragment.get("ui-error");
  return {
    handoff,
    showDevices: fragment.get("switch") === "1",
    uiError: reason ? { reason, file: fragment.get("file") || null, bundleId: fragment.get("bundle") || null } : null,
  };
}

/** Gives a device UI page its controller parameters before the app starts. */
function installBundlePageParams() {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  if (document.getElementById("nsh-params")) return;
  const params = bundlePageParams(location);
  if (!params) return;
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = "nsh-params";
  script.textContent = JSON.stringify(params);
  document.head.appendChild(script);
}

/** Leaves a device UI page for the launcher, naming what failed (`#ui-error=`). */
function failBundlePage(page, reason, file) {
  const fragment = new URLSearchParams({ "ui-error": reason, file, bundle: page.bundleId });
  location.replace(`${page.launcher}#${fragment.toString()}`);
}

/**
 * Hands the NSH runtime a realm iframe the UI loader controls (device UI pages only).
 *
 * The coupling, in one place: NSH 0.6.1, `browser.<hash>/runtime.js`,
 * `createBrowserHost().run()` makes its app realm with
 * `document.createElement("iframe")`, appends it with
 * `(document.body ?? document.documentElement).append(frame)`, then reads
 * `frame.contentWindow.document` at once and loads `bootstrap.js` into it.
 * Chrome does not give such an `about:blank` iframe the page's Service Worker,
 * so its scripts would bypass the loader. So this function loads a blank page
 * inside the loader's scope (`.obf-realm.html`, which the loader answers),
 * checks that the iframe is controlled, and returns it from the runtime's first
 * `createElement("iframe")`. The runtime's `append` of it is skipped, since
 * moving an iframe reloads it. `guardBundleRealm` fails the page loudly when
 * the runtime builds its realm any other way. Upstream request: the NSH
 * runtime should load its realm from an in-scope URL, or through the parent.
 */
async function prepareBundleRealm(page) {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the interface realm did not load")), UI_LOADER_TIMEOUT_MS);
    frame.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    frame.src = new URL(".obf-realm.html", `${page.launcher}b/${page.bundleId}/`).href;
    document.body.append(frame);
  });
  let controlled = false;
  try {
    controlled = Boolean(frame.contentWindow.navigator.serviceWorker.controller);
  } catch {
    controlled = false;
  }
  if (!controlled) {
    frame.remove();
    throw new Error("the interface realm is not served by the interface loader; nothing was run");
  }
  const createElement = document.createElement;
  const parent = frame.parentNode;
  const append = parent.append;
  document.createElement = function createRealmOnce(name, options) {
    if (String(name).toLowerCase() !== "iframe") return createElement.call(this, name, options);
    document.createElement = createElement;
    parent.append = function appendKeepingRealm(...nodes) {
      if (!nodes.includes(frame)) return append.apply(this, nodes);
      parent.append = append;
      const others = nodes.filter(node => node !== frame);
      if (others.length) return append.apply(this, others);
    };
    return frame;
  };
  return frame;
}

/**
 * Fails a device UI page loudly when anything of its bundle did not come
 * through the loader: a resource under the bundle's address, in the page, its
 * realm or any other same-origin frame, fetched without the worker
 * (`workerStart` 0).
 */
function guardBundleRealm(page, realm) {
  const scope = `${page.launcher}b/${page.bundleId}/`;
  let failed = false;
  const fail = file => {
    if (failed) return;
    failed = true;
    failBundlePage(page, "verification", file);
  };
  const watch = view => {
    if (!view || typeof view.PerformanceObserver !== "function") return;
    const observer = new view.PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.name.startsWith(scope) && entry.workerStart === 0) fail(entry.name.slice(scope.length));
      }
    });
    observer.observe({ type: "resource", buffered: true });
  };
  // Another same-origin frame (a widget's `srcdoc`, a realm built some other
  // way) is watched too: loading this bundle's files there without the
  // worker fails the page. Intercept `createElement` / `createElementNS` with
  // an O(1) tag check instead of running a permanent whole-DOM MutationObserver.
  const checkFrame = node => {
    if (node === realm || !node || node.nodeName !== "IFRAME" || node.__obfWatched) return;
    node.__obfWatched = true;
    const watchFrame = () => {
      try {
        watch(node.contentWindow);
      } catch {
        // A cross-origin frame loads nothing of this bundle.
      }
    };
    watchFrame();
    node.addEventListener("load", watchFrame);
  };
  watch(window);
  watch(realm.contentWindow);
  for (const node of document.querySelectorAll("iframe")) checkFrame(node);
  const origCreateElement = document.createElement;
  document.createElement = function watchCreatedElement(name, options) {
    const el = origCreateElement.call(this, name, options);
    if (el && el.nodeName === "IFRAME") checkFrame(el);
    return el;
  };
  if (typeof document.createElementNS === "function") {
    const origCreateElementNS = document.createElementNS;
    document.createElementNS = function watchCreatedElementNS(ns, name, options) {
      const el = origCreateElementNS.call(this, ns, name, options);
      if (el && el.nodeName === "IFRAME") checkFrame(el);
      return el;
    };
  }
}

/** Device UI pages only: refuses an uncontrolled page and readies the realm. */
async function prepareBundlePage() {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  const page = bundlePageOf(location);
  if (!page) return;
  if (!document.body && document.readyState === "loading") {
    await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  if (!document.body) return;
  const container = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!container || !container.controller) {
    throw new Error("This page must be opened through OpenBitFun's interface loader; open it again from the launcher");
  }
  let realm;
  try {
    realm = await prepareBundleRealm(page);
  } catch (error) {
    failBundlePage(page, "verification", ".obf-realm.html");
    throw error;
  }
  guardBundleRealm(page, realm);
  try {
    // Clear the boot-loop guard once the bundle page started under its worker.
    sessionStorage.removeItem("obf.ui.boot");
  } catch {
    // sessionStorage unavailable; harmless.
  }
}

/** The launcher this page belongs to (`https://<domain>/app/`). */
function launcherUrl() {
  const page = bundlePageOf(location);
  if (page) return page.launcher;
  return new URL(".", document.baseURI || location.href).href;
}

function uiLoaderWorker(registration) {
  return new Promise((resolve, reject) => {
    if (registration.active && registration.active.state === "activated") {
      resolve(registration.active);
      return;
    }
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) {
      reject(new Error("the UI loader did not install"));
      return;
    }
    if (worker.state === "activated") {
      resolve(worker);
      return;
    }
    const finish = (err, value) => {
      clearTimeout(timer);
      if (typeof worker.removeEventListener === "function") {
        worker.removeEventListener("statechange", onStateChange);
      }
      if (err) reject(err);
      else resolve(value);
    };
    const onStateChange = () => {
      if (worker.state === "activated") {
        finish(null, worker);
      } else if (worker.state === "redundant") {
        if (registration.active && registration.active.state === "activated") {
          finish(null, registration.active);
        } else {
          finish(new Error("the UI loader was replaced while starting"));
        }
      }
    };
    const timer = setTimeout(() => finish(new Error("the UI loader did not start in time")), UI_LOADER_TIMEOUT_MS);
    worker.addEventListener("statechange", onStateChange);
  });
}

function askUiLoader(worker, message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("the UI loader did not answer"));
    }, UI_LOADER_TIMEOUT_MS);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data || { ok: false, error: "the UI loader answered nothing" });
    };
    worker.postMessage(message, [channel.port2]);
  });
}

async function prepareUiBundle(args) {
  const { manifest, deviceId } = args || {};
  if (!manifest || typeof manifest !== "object" || typeof deviceId !== "string" || !deviceId) {
    throw new Error("ui_bundle_invalid: openbitfun.controller.prepareBundle needs a manifest and a device");
  }
  const container = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!container) {
    throw new Error(
      "controller_unsupported: this browser cannot open a device's interface here (Service Workers are off, for example in a private window)",
    );
  }
  const launcher = launcherUrl();
  let registration;
  try {
    registration = await container.register(new URL("ui-loader.js", launcher).href, {
      scope: new URL("b/", launcher).href,
      updateViaCache: "none",
    });
  } catch (error) {
    throw new Error(`ui_loader_failed: the UI loader could not be installed (${error && error.message ? error.message : error})`);
  }
  const worker = await uiLoaderWorker(registration);
  const answer = await askUiLoader(worker, { type: UI_LOADER_STORE_MESSAGE, manifest, deviceId });
  if (!answer.ok || typeof answer.bundleId !== "string") throw new Error(answer.error || "ui_bundle_invalid: no bundle id");
  return { bundleId: answer.bundleId };
}

function launchUiBundle(args) {
  const { bundleId, deviceId } = args || {};
  if (typeof bundleId !== "string" || !BUNDLE_ID.test(bundleId) || typeof deviceId !== "string" || !deviceId) {
    throw new Error("ui_bundle_invalid: openbitfun.controller.launch needs a bundle id and a device");
  }
  try {
    writeControllerHandoff(sessionStorage, deviceId);
  } catch {
    throw new Error("controller_unsupported: this browser cannot hand the device over to its interface (sessionStorage is off)");
  }
  const target = new URL(`b/${bundleId}/index.html`, launcherUrl());
  target.hash = `device=${encodeURIComponent(deviceId)}`;
  // The launcher steps aside: Back from the device's UI leaves OpenBitFun.
  location.replace(target.href);
  return true;
}

function leaveUiBundle() {
  try {
    sessionStorage.removeItem(CONTROLLER_HANDOFF_KEY);
  } catch {
    // Nothing stored.
  }
  location.assign(`${launcherUrl()}#switch=1`);
  return true;
}

function readControllerPage() {
  const state = controllerPageState(location, typeof sessionStorage !== "undefined" ? sessionStorage : null);
  // One-shot fragments of the launcher: a reload shows the plain launcher.
  if (!bundlePageOf(location) && (state.uiError || state.showDevices)) {
    try {
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    } catch {
      // The address keeps the fragment; harmless.
    }
  }
  return state;
}

function createController(player) {
  const sockets = new Map();

  function emit(id, payload) {
    player.hostEvent("openbitfun.controller.socket", { id, ...payload });
  }

  function finish(socket, code, reason) {
    if (socket.finished) return;
    socket.finished = true;
    if (socket.timer) clearTimeout(socket.timer);
    socket.timer = null;
    // Drop queued chunks immediately so large ArrayBuffers are never retained after close.
    socket.chunks = [];
    socket.chunkOffset = 0;
    socket.bufferedBytes = 0;
    sockets.delete(socket.id);
    const ws = socket.ws;
    socket.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState <= 1) ws.close(1000, "closed");
      } catch {
        // Already closing.
      }
    }
    emit(socket.id, { type: "close", code, reason });
  }

  function sendBytes(socket, bytes) {
    for (let offset = 0; offset < bytes.length; offset += E2E_WS_CHUNK) {
      socket.ws.send(bytes.subarray(offset, Math.min(bytes.length, offset + E2E_WS_CHUNK)));
    }
  }

  async function sealRecord(socket, type, payload) {
    const subtle = controllerSubtle();
    const plaintext = concatBytes(new Uint8Array([type]), payload);
    const nonce = e2eNonce(socket.sendCounter);
    socket.sendCounter += 1;
    const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, socket.sendKey, plaintext));
    return lengthPrefixed(sealed);
  }

  /** Queues one encrypted record; records leave in order. */
  function queueRecord(socket, type, payload) {
    socket.outbound = socket.outbound
      .then(async () => {
        if (socket.finished || !socket.sendKey) return;
        const framed = await sealRecord(socket, type, payload);
        if (!socket.finished) sendBytes(socket, framed);
      })
      .catch(error => finish(socket, 4500, `channel_failed: ${error && error.message ? error.message : error}`));
  }

  async function handleServerHello(socket, body) {
    const subtle = controllerSubtle();
    let answer;
    try {
      answer = JSON.parse(fromUtf8.decode(body));
    } catch {
      throw new Error("unsupported: the device answered something other than the browser channel; update OpenBitFun there");
    }
    if (answer && typeof answer.error === "string") {
      const code = answer.error === "not_account_device" ? 4403 : answer.error === "mesh_signed_out" ? 4404 : 4401;
      finish(socket, code, `${answer.error}: ${answer.message || "the device refused the connection"}`);
      return;
    }
    const serverClaims = {
      ...socket.claims,
      fingerprint: `${E2E_FINGERPRINT_PREFIX}${socket.eph}:${answer.eph}`,
    };
    const expected = await meshProof(subtle, socket.handshakeKey, "server", serverClaims);
    if (typeof answer.proof !== "string" || answer.proof !== expected) {
      finish(socket, 4403, "impostor: the device could not prove it is your device");
      return;
    }
    const shared = await x25519Shared(subtle, socket.ephemeral.privateKey, base64ToBytes(answer.eph));
    const okm = await hkdfSha256(
      subtle,
      shared,
      socket.handshakeKey,
      utf8.encode(`${E2E_KEYS_INFO}\n${socket.proof}\n${answer.proof}`),
      512,
    );
    socket.sendKey = await subtle.importKey("raw", okm.slice(0, 32), "AES-GCM", false, ["encrypt"]);
    socket.receiveKey = await subtle.importKey("raw", okm.slice(32, 64), "AES-GCM", false, ["decrypt"]);
    okm.fill(0);
    shared.fill(0);
    socket.ready = true;
    if (socket.timer) clearTimeout(socket.timer);
    socket.timer = null;
    emit(socket.id, {
      type: "open",
      protocol: typeof answer.protocol === "number" ? answer.protocol : null,
      capabilities: Array.isArray(answer.capabilities) ? answer.capabilities : [],
    });
  }

  async function handleRecord(socket, body) {
    if (!socket.ready) {
      await handleServerHello(socket, body);
      return;
    }
    const subtle = controllerSubtle();
    const nonce = e2eNonce(socket.receiveCounter);
    socket.receiveCounter += 1;
    const plaintext = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, socket.receiveKey, body));
    const type = plaintext[0];
    const payload = plaintext.subarray(1);
    if (type === 1) {
      emit(socket.id, { type: "message", data: fromUtf8.decode(payload) });
    } else if (type === 3) {
      queueRecord(socket, 4, payload.slice());
    } else if (type === 5) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const code = payload.length >= 2 ? view.getUint16(0) : 1000;
      finish(socket, code, payload.length > 2 ? fromUtf8.decode(payload.subarray(2)) : "closed by the device");
    }
  }

  /** Reads the leading big-endian uint32 record length across queued chunks in O(1). */
  function peekRecordLength(socket) {
    const first = socket.chunks[0];
    if (first && first.length - socket.chunkOffset >= 4) {
      return new DataView(first.buffer, first.byteOffset + socket.chunkOffset, 4).getUint32(0);
    }
    const header = new Uint8Array(4);
    let written = 0;
    let idx = 0;
    let offset = socket.chunkOffset;
    while (written < 4 && idx < socket.chunks.length) {
      const chunk = socket.chunks[idx];
      const take = Math.min(4 - written, chunk.length - offset);
      header.set(chunk.subarray(offset, offset + take), written);
      written += take;
      idx += 1;
      offset = 0;
    }
    return new DataView(header.buffer).getUint32(0);
  }

  /** Consumes `count` bytes from the front of the chunk queue into one fresh Uint8Array in O(count). */
  function takeBytes(socket, skip, length) {
    let remainingSkip = skip;
    while (remainingSkip > 0 && socket.chunks.length > 0) {
      const head = socket.chunks[0];
      const avail = head.length - socket.chunkOffset;
      if (remainingSkip < avail) {
        socket.chunkOffset += remainingSkip;
        socket.bufferedBytes -= remainingSkip;
        remainingSkip = 0;
      } else {
        socket.chunks.shift();
        socket.chunkOffset = 0;
        socket.bufferedBytes -= avail;
        remainingSkip -= avail;
      }
    }
    const out = new Uint8Array(length);
    let written = 0;
    while (written < length && socket.chunks.length > 0) {
      const head = socket.chunks[0];
      const avail = head.length - socket.chunkOffset;
      const take = Math.min(length - written, avail);
      out.set(head.subarray(socket.chunkOffset, socket.chunkOffset + take), written);
      written += take;
      socket.bufferedBytes -= take;
      if (take === avail) {
        socket.chunks.shift();
        socket.chunkOffset = 0;
      } else {
        socket.chunkOffset += take;
      }
    }
    if (socket.bufferedBytes === 0) {
      socket.chunks = [];
      socket.chunkOffset = 0;
    }
    return out;
  }

  /** Splits the byte stream into records in O(N) without retaining consumed ArrayBuffers. */
  function receiveBytes(socket, chunk) {
    if (chunk.length > 0) {
      socket.chunks.push(chunk);
      socket.bufferedBytes += chunk.length;
    }
    for (;;) {
      if (socket.bufferedBytes < 4) return;
      const length = peekRecordLength(socket);
      if (length > E2E_RECORD_MAX) {
        finish(socket, 4500, "channel_failed: an oversized record");
        return;
      }
      if (socket.bufferedBytes < 4 + length) return;
      const body = takeBytes(socket, 4, length);
      socket.inbound = socket.inbound
        .then(() => (socket.finished ? undefined : handleRecord(socket, body)))
        .catch(error =>
          finish(socket, 4500, `channel_failed: ${error && error.message ? error.message : error}`),
        );
    }
  }

  async function open(args) {
    const { id, url, target, targetPublicKey } = args || {};
    if (typeof id !== "string" || typeof url !== "string" || typeof target !== "string") {
      throw new Error("openbitfun.controller.open needs id, url and target");
    }
    const subtle = controllerSubtle();
    const key = await controllerDeviceKey();
    const pair = await devicePairKey(subtle, key, targetPublicKey);
    const handshakeKey = await hmacSha256(subtle, pair, utf8.encode(HANDSHAKE_KEY_DOMAIN));
    pair.fill(0);
    const ephemeral = await subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    const eph = bytesToBase64Url(new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey)));
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const claims = {
      client: key.deviceId,
      server: target,
      fingerprint: `${E2E_FINGERPRINT_PREFIX}${eph}`,
      time: Date.now(),
      nonce: bytesToBase64Url(nonceBytes),
    };
    const proof = await meshProof(subtle, handshakeKey, "client", claims);
    const socket = {
      id,
      ws: null,
      finished: false,
      ready: false,
      chunks: [],
      chunkOffset: 0,
      bufferedBytes: 0,
      inbound: Promise.resolve(),
      outbound: Promise.resolve(),
      sendCounter: 0,
      receiveCounter: 0,
      sendKey: null,
      receiveKey: null,
      handshakeKey,
      ephemeral,
      eph,
      claims,
      proof,
      timer: null,
    };
    sockets.set(id, socket);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    socket.ws = ws;
    socket.timer = setTimeout(
      () => finish(socket, 4408, "timeout: the device did not answer in time"),
      E2E_HANDSHAKE_TIMEOUT_MS,
    );
    ws.onopen = () => {
      const hello = utf8.encode(
        JSON.stringify({
          v: 1,
          device: claims.client,
          target: claims.server,
          time: claims.time,
          nonce: claims.nonce,
          eph,
          proof,
        }),
      );
      sendBytes(socket, concatBytes(utf8.encode(E2E_MAGIC), lengthPrefixed(hello)));
    };
    ws.onmessage = event => {
      if (socket.finished) return;
      if (event.data instanceof ArrayBuffer) receiveBytes(socket, new Uint8Array(event.data));
    };
    ws.onerror = () => undefined;
    ws.onclose = event => {
      if (socket.finished) return;
      if (!socket.ready && event.code === 1000) {
        // The pipe opened and the device hung up without the browser
        // channel's answer: a device on a build before it.
        finish(socket, 4426, "unsupported: OpenBitFun on that device is too old for browser control; update it");
        return;
      }
      finish(socket, event.code || 1006, event.reason || "the connection to the gateway closed");
    };
    return { deviceId: key.deviceId };
  }

  return {
    async key() {
      const key = await controllerDeviceKey();
      return { deviceId: key.deviceId, publicKey: key.publicKey };
    },
    forgetKey: forgetControllerKey,
    prepareBundle: prepareUiBundle,
    launch: launchUiBundle,
    leave: leaveUiBundle,
    page: readControllerPage,
    open,
    send(args) {
      const socket = args && sockets.get(args.id);
      if (!socket || !socket.ready) return false;
      queueRecord(socket, 1, utf8.encode(String(args.text)));
      return true;
    },
    close(args) {
      const socket = args && sockets.get(args.id);
      if (!socket) return false;
      const code = typeof args.code === "number" ? args.code : 1000;
      if (socket.ready) {
        const reason = utf8.encode(typeof args.reason === "string" ? args.reason : "");
        const payload = new Uint8Array(2 + reason.length);
        new DataView(payload.buffer).setUint16(0, code);
        payload.set(reason, 2);
        queueRecord(socket, 5, payload);
        socket.outbound.then(() => finish(socket, code, args.reason || "closed"));
      } else {
        finish(socket, code, args.reason || "closed");
      }
      return true;
    },
  };
}

export async function createHost(player) {
  const tauri = globalThis.__TAURI__;
  const core = tauri && tauri.core;
  const eventApi = tauri && tauri.event;
  const windowApi = tauri && tauri.window;
  const native = Boolean(core && typeof core.invoke === "function");
  const transport = native ? "tauri" : "dev";

  if (!native) {
    // Before the start script reads `#nsh-params` and the runtime makes its realm.
    installBundlePageParams();
    await prepareBundlePage();
    const urlLocale = readDevUrlLocale();
    if (urlLocale) {
      devConfigs.app = { ...devConfigs.app, language: urlLocale };
      devConfigs["app.language"] = urlLocale;
      devConfigs["appearance.language"] = urlLocale;
    }
    if (readDevUrlAuthLoggedOut()) {
      devAccountLoggedIn = false;
    }
  }

  const navPlatform =
    typeof navigator !== "undefined"
      ? String(
          (navigator.userAgentData && navigator.userAgentData.platform) ||
            navigator.platform ||
            navigator.userAgent ||
            "",
        )
      : "";
  const isMac = /mac/i.test(navPlatform);
  const isWindows = /win/i.test(navPlatform);
  const platform = isMac ? "macos" : isWindows ? "windows" : "linux";

  const unlisteners = new Map();
  const controller = createController(player);
  /** In-flight `eventApi.listen()` registrations, preventing duplicate listeners & leaks. */
  const pendingListeners = new Map();

  // Per-frame coalescing queue for `agentic://text-chunk` (strictly flushed
  // before any non-text-chunk event to guarantee ordering while keeping WASM
  // event crossings at <= 1 batch per animation frame / <= 24ms).
  const TEXT_CHUNK_EVENT = "agentic://text-chunk";
  const TEXT_CHUNK_MAX_LATENCY_MS = 24;
  let pendingTextChunks = [];
  let flushRafId = null;
  let flushTimerId = null;

  function fail(error) {
    let message =
      typeof error === "string" ? error : error && error.message ? error.message : String(error);
    // A command whose Rust error type is a struct (external sources report
    // `{ code, detail, retryable }`) rejects with a plain object; keep its fields
    // as JSON so the app can read the code instead of "[object Object]".
    if (error && typeof error === "object" && !error.message) {
      try {
        message = JSON.stringify(error);
      } catch {
        // Keep the String() form when the object cannot be serialized.
      }
    }
    return { ok: false, error: message, transport };
  }

  function currentTauriWindow() {
    if (!native || !windowApi || typeof windowApi.getCurrentWindow !== "function") return null;
    try {
      return windowApi.getCurrentWindow();
    } catch {
      return null;
    }
  }

  function cancelScheduledTextFlush() {
    if (flushRafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(flushRafId);
    }
    flushRafId = null;
    if (flushTimerId !== null) {
      clearTimeout(flushTimerId);
    }
    flushTimerId = null;
  }

  function flushPendingTextChunks() {
    cancelScheduledTextFlush();
    if (pendingTextChunks.length === 0) return;
    const batch = pendingTextChunks;
    pendingTextChunks = [];
    for (let index = 0; index < batch.length; index += 1) {
      player.hostEvent("openbitfun.event", {
        event: TEXT_CHUNK_EVENT,
        payload: batch[index].payload,
      });
    }
  }

  function scheduleTextFlush() {
    if (flushRafId !== null || flushTimerId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      flushRafId = requestAnimationFrame(() => {
        flushRafId = null;
        flushPendingTextChunks();
      });
    }
    flushTimerId = setTimeout(() => {
      flushTimerId = null;
      flushPendingTextChunks();
    }, TEXT_CHUNK_MAX_LATENCY_MS);
  }

  function textChunkFieldOf(payload) {
    if (typeof payload.text === "string") return "text";
    if (typeof payload.delta === "string") return "delta";
    if (typeof payload.content === "string") return "content";
    if (typeof payload.chunk === "string") return "chunk";
    return null;
  }

  function textChunkKeyOf(payload) {
    return [
      payload.__openbitfunSourceDeviceId ?? "",
      payload.sessionId ?? payload.session_id ?? "",
      payload.turnId ?? payload.turn_id ?? "",
      payload.roundId ?? payload.round_id ?? "",
      payload.attemptId ?? payload.attempt_id ?? "",
      payload.contentType ?? "",
      payload.reasoningKind ?? "",
    ].join("\u0000");
  }

  function forwardNativeEvent(event, payload) {
    if (event === TEXT_CHUNK_EVENT && payload && typeof payload === "object") {
      const field = textChunkFieldOf(payload);
      if (field) {
        const key = textChunkKeyOf(payload);
        const last = pendingTextChunks[pendingTextChunks.length - 1];
        if (last && last.key === key && last.field === field && last.payload.isThinkingEnd !== true) {
          // Same as src/textChunkCoalescer.ts: the merged chunk keeps its newest
          // delivery cursor and the cursor span of every part it merged.
          if (typeof payload.__openbitfunRuntimeEventCursor === "number") {
            const before = String(last.payload[field]).length;
            const spans = Array.isArray(last.payload.__openbitfunChunkSpans)
              ? last.payload.__openbitfunChunkSpans
              : typeof last.payload.__openbitfunRuntimeEventCursor === "number"
                ? [[last.payload.__openbitfunRuntimeEventCursor, before]]
                : [];
            spans.push([payload.__openbitfunRuntimeEventCursor, before + String(payload[field]).length]);
            last.payload.__openbitfunChunkSpans = spans;
            last.payload.__openbitfunRuntimeEventCursor = payload.__openbitfunRuntimeEventCursor;
          }
          last.payload[field] += payload[field];
          if (payload.isThinkingEnd === true) {
            last.payload.isThinkingEnd = true;
            flushPendingTextChunks();
            return;
          }
        } else {
          pendingTextChunks.push({ key, field, payload: { ...payload } });
          if (payload.isThinkingEnd === true) {
            flushPendingTextChunks();
            return;
          }
        }
        scheduleTextFlush();
        return;
      }
    }
    // Guarantee strict causal ordering: any tool/round/completion/history event
    // must see every text/thinking chunk that preceded it.
    if (pendingTextChunks.length > 0) {
      flushPendingTextChunks();
    }
    player.hostEvent("openbitfun.event", { event, payload });
  }

  async function invokeNative(action, request) {
    try {
      const value =
        request === null || request === undefined
          ? await core.invoke(action)
          : await core.invoke(action, { request });
      return { ok: true, value, transport };
    } catch (error) {
      return fail(error);
    }
  }

  // Account and device commands take positional arguments instead of the single
  // `request` object, so their arguments are forwarded unwrapped.
  async function invokeNativeRaw(action, raw) {
    try {
      const value =
        raw === null || raw === undefined ? await core.invoke(action) : await core.invoke(action, raw);
      return { ok: true, value, transport };
    } catch (error) {
      return fail(error);
    }
  }

  function invokeFixture(action, args) {
    if (action === "start_dialog_turn") {
      return startDevDialogTurn(payloadOf(args));
    }
    if (action === "interrupt_dialog_turn" || action === "cancel_dialog_turn") {
      return stopDevDialogTurn(payloadOf(args));
    }
    // session policy (wave 3): the dev host starts a turn for every message (it
    // runs one turn at a time) and stops through the same dev path.
    if (action === "submit_user_message") {
      const req = payloadOf(args);
      const turnId = String(req.turnId || `dev-turn-${devTurnSeq + 1}`);
      const started = startDevDialogTurn({ sessionId: req.sessionId, userInput: req.text, turnId });
      return started.ok ? { ok: true, value: { outcome: "started", turnId }, transport } : started;
    }
    if (action === "stop_dialog_turn") {
      const req = payloadOf(args);
      const stopped = stopDevDialogTurn(req);
      return stopped.ok
        ? { ok: true, value: { turnId: String(req.dialogTurnId || ""), method: "interrupted" }, transport }
        : stopped;
    }
    const fixture = DEV_FIXTURES[action];
    if (!fixture) {
      return { ok: false, error: `The development host has no fixture for ${action}`, transport };
    }
    try {
      return { ok: true, value: fixture(args || {}), transport };
    } catch (error) {
      return fail(error);
    }
  }

  let devTurnSeq = 10;
  /** Active dev-fixture turn timers keyed by `${sessionId}:${turnId}` for clean cancellation. */
  const devTurnTimers = new Map();

  function cancelDevTurnTimers(key, sessionId) {
    const timers = devTurnTimers.get(key);
    if (timers) {
      for (let i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
      devTurnTimers.delete(key);
      return;
    }
    if (!sessionId) return;
    const prefix = `${sessionId}:`;
    for (const [activeKey, activeTimers] of [...devTurnTimers.entries()]) {
      if (!activeKey.startsWith(prefix)) continue;
      for (let i = 0; i < activeTimers.length; i += 1) clearTimeout(activeTimers[i]);
      devTurnTimers.delete(activeKey);
    }
  }

  function startDevDialogTurn(req) {
    const sessionId = String(req.sessionId || req.session_id || "");
    const userInput = String(req.userInput || req.user_input || "").trim();
    if (!sessionId || !userInput) {
      return fail("start_dialog_turn requires sessionId and userInput");
    }
    const turnId = String(req.turnId || `dev-turn-${++devTurnSeq}`);
    const roundId = `dev-round-${devTurnSeq}`;
    const attemptId = `${roundId}:attempt:1`;
    const toolId = `dev-tool-${devTurnSeq}`;
    const timerKey = `${sessionId}:${turnId}`;
    cancelDevTurnTimers(timerKey, sessionId);

    const startedAt = Date.now();
    const isBrowserDom = typeof window !== "undefined" && typeof document !== "undefined";
    const pace = isBrowserDom ? 1 : 0.12;
    const at = ms => (isBrowserDom ? ms : Math.max(4, Math.round(ms * pace)));

    const thinkingChunks = [
      "Inspecting workspace layout and active session context. ",
      "Mapping relevant modules and checking streaming frame-pacing invariants. ",
      "Structuring a concise Markdown summary with verification details and a typed code snippet.",
    ];
    const fullThinking = thinkingChunks.join("");

    // Realistic bursty multi-chunk Markdown answer (mix of small deltas & bursty
    // paragraphs, headings, bullets, inline code, and a fenced TypeScript block).
    const replyChunks = [
      "### Response Overview\n\n",
      `Acknowledged in **dev fixture mode**: `,
      `"${userInput}".\n\n`,
      "Here is how the ",
      "streaming pipeline ",
      "keeps frames ",
      "smooth at 60fps:\n\n",
      "- **Decoupled per-round signals**: ",
      "`agentEvents.ts` isolates live text ",
      "and thinking channels ",
      "so structural `liveTurn` ",
      "state never clones per token.\n",
      "- **Adaptive rAF drain**: ",
      "bursty chunks from `host.js` ",
      "drain smoothly on display ",
      "VSync with grapheme-safe ",
      "boundaries and zero data loss.\n",
      "- **Cached Markdown styles**: ",
      "`createMarkdownStyles()` reuses ",
      "frozen theme style objects ",
      "across every streamed frame.\n\n",
      "```ts\n",
      "export function paceFrame(",
      "backlog: number",
      "): number {\n",
      "  return Math.min(2200, 120 + backlog * 3.5);\n",
      "}\n",
      "```\n\n",
      "Persisted into `DEV_SESSION_TURNS` ",
      "as real Rust `ModelRoundData` (`textItems`), ",
      "followed by `agentic://session-history-changed`.",
    ];
    const fullReply = replyChunks.join("");
    const chunkCadenceMs = [
      22, 18, 44, 16, 20, 26, 48, 18, 22, 16, 52, 20, 18, 24, 42, 16, 22, 18, 46, 20, 18, 34,
      16, 22, 40, 18, 20, 28, 18, 24, 22,
    ];

    const timers = [];
    const schedule = (delayMs, fn) => {
      timers.push(setTimeout(fn, delayMs));
    };

    schedule(at(16), () => {
      forwardNativeEvent("agentic://dialog-turn-started", {
        sessionId,
        turnId,
        userInput,
        originalUserInput: userInput,
      });
      forwardNativeEvent("agentic://model-round-started", {
        sessionId,
        turnId,
        roundId,
        roundIndex: 0,
        effectiveModelName: "Studio Primary",
      });
    });

    thinkingChunks.forEach((chunk, idx) => {
      const isLast = idx === thinkingChunks.length - 1;
      schedule(at(36 + idx * 38), () => {
        forwardNativeEvent("agentic://text-chunk", {
          sessionId,
          turnId,
          roundId,
          attemptId,
          contentType: "thinking",
          reasoningKind: "reasoning",
          text: chunk,
          ...(isLast ? { isThinkingEnd: true } : {}),
        });
      });
    });

    schedule(at(175), () => {
      forwardNativeEvent("agentic://tool-event", {
        sessionId,
        turnId,
        roundId,
        attemptId,
        toolEvent: {
          event_type: "Started",
          tool_id: toolId,
          tool_name: "Read",
          params: { file_path: "/workspace/demo/README.md" },
        },
      });
    });

    schedule(at(245), () => {
      forwardNativeEvent("agentic://tool-event", {
        sessionId,
        turnId,
        roundId,
        attemptId,
        toolEvent: {
          event_type: "Progress",
          tool_id: toolId,
          tool_name: "Read",
          message: "Inspecting workspace context…",
        },
      });
    });

    schedule(at(325), () => {
      forwardNativeEvent("agentic://tool-event", {
        sessionId,
        turnId,
        roundId,
        attemptId,
        toolEvent: {
          event_type: "Completed",
          tool_id: toolId,
          tool_name: "Read",
          duration_ms: 150,
        },
      });
    });

    let cursorMs = 360;
    replyChunks.forEach((chunk, idx) => {
      const targetMs = cursorMs;
      cursorMs += chunkCadenceMs[idx % chunkCadenceMs.length];
      schedule(at(targetMs), () => {
        forwardNativeEvent("agentic://text-chunk", {
          sessionId,
          turnId,
          roundId,
          attemptId,
          text: chunk,
        });
      });
    });

    const completeMs = cursorMs + 40;
    schedule(at(completeMs), () => {
      const durationMs = Math.max(120, Date.now() - startedAt);
      forwardNativeEvent("agentic://model-round-completed", {
        sessionId,
        turnId,
        roundId,
        hasToolCalls: true,
        durationMs,
        effectiveModelName: "Studio Primary",
      });
      forwardNativeEvent("agentic://dialog-turn-completed", {
        sessionId,
        turnId,
        durationMs,
        success: true,
        hasFinalResponse: true,
      });
    });

    schedule(at(completeMs + 65), () => {
      devTurnTimers.delete(timerKey);
      const list = DEV_SESSION_TURNS[sessionId] || (DEV_SESSION_TURNS[sessionId] = []);
      const durationMs = Math.max(120, Date.now() - startedAt);
      list.push({
        id: turnId,
        turnId,
        turnIndex: list.length,
        sessionId,
        timestamp: startedAt,
        userMessage: { id: `user-${turnId}`, content: userInput, timestamp: startedAt },
        modelRounds: [
          {
            id: roundId,
            turnId,
            roundIndex: 0,
            timestamp: startedAt + 30,
            effectiveModelName: "Studio Primary",
            durationMs,
            thinkingItems: [
              {
                id: `think-${turnId}`,
                content: fullThinking,
                reasoningKind: "reasoning",
                isStreaming: false,
                isCollapsed: true,
                orderIndex: 0,
                timestamp: startedAt + 60,
              },
            ],
            toolItems: [
              {
                id: toolId,
                toolName: "Read",
                toolCall: { id: toolId, input: { file_path: "/workspace/demo/README.md" } },
                toolResult: { result: { ok: true }, success: true, durationMs: 150 },
                status: "completed",
                orderIndex: 1,
                timestamp: startedAt + 180,
              },
            ],
            textItems: [
              {
                id: `text-${turnId}`,
                content: fullReply,
                isStreaming: false,
                isMarkdown: true,
                orderIndex: 2,
                timestamp: Date.now(),
              },
            ],
          },
        ],
        status: "completed",
      });
      const session = devSessions.find(s => s.sessionId === sessionId);
      if (session) {
        session.messageCount = (session.messageCount || 0) + 1;
        session.lastActiveAt = Date.now();
        session.lastUpdated = session.lastActiveAt;
        if (!session.sessionName || /^New (session|thread)$/i.test(session.sessionName)) {
          const derived = userInput.length > 36 ? `${userInput.slice(0, 36)}…` : userInput;
          session.sessionName = derived;
          forwardNativeEvent("session_title_generated", {
            sessionId,
            title: derived,
            method: "dev",
            timestamp: Date.now(),
          });
        }
      }
      forwardNativeEvent("agentic://session-history-changed", {
        sessionId,
        settledTurnId: turnId,
      });
    });

    devTurnTimers.set(timerKey, timers);
    return { ok: true, value: { success: true, message: "Dialog turn started" }, transport };
  }

  function stopDevDialogTurn(req) {
    const sessionId = String(req.sessionId || req.session_id || "");
    const turnId = String(req.dialogTurnId || req.turnId || req.turn_id || "");
    const timerKey = `${sessionId}:${turnId}`;
    cancelDevTurnTimers(timerKey, sessionId);
    if (sessionId) {
      forwardNativeEvent("agentic://dialog-turn-cancelled", { sessionId, turnId });
    }
    return { ok: true, value: null, transport };
  }

  async function listenTo(event) {
    if (unlisteners.has(event)) return { ok: true, transport };
    const inflight = pendingListeners.get(event);
    if (inflight) {
      inflight.cancelled = false;
      return inflight.promise;
    }
    if (!native || !eventApi || typeof eventApi.listen !== "function") {
      // The development host has no backend events; keep the subscription so
      // the app's listeners stay on one code path.
      unlisteners.set(event, () => {});
      return { ok: true, transport };
    }
    const entry = { cancelled: false, promise: null };
    entry.promise = (async () => {
      try {
        const unlisten = await eventApi.listen(event, message => {
          forwardNativeEvent(event, message.payload);
        });
        pendingListeners.delete(event);
        if (entry.cancelled) {
          try {
            unlisten();
          } catch {
            // Best-effort cleanup of a listener cancelled while registering.
          }
          return { ok: true, transport };
        }
        unlisteners.set(event, unlisten);
        return { ok: true, transport };
      } catch (error) {
        pendingListeners.delete(event);
        return fail(error);
      }
    })();
    pendingListeners.set(event, entry);
    return entry.promise;
  }

  function unlistenFrom(event) {
    const inflight = pendingListeners.get(event);
    if (inflight) {
      inflight.cancelled = true;
    }
    const unlisten = unlisteners.get(event);
    if (!unlisten) return { ok: true, transport };
    unlisteners.delete(event);
    if (event === TEXT_CHUNK_EVENT) {
      cancelScheduledTextFlush();
      pendingTextChunks = [];
    }
    try {
      unlisten();
    } catch (error) {
      return fail(error);
    }
    return { ok: true, transport };
  }

  async function readWindowChrome() {
    const overlayTrafficLights = native && isMac;
    let isFullscreen = false;
    const win = currentTauriWindow();
    if (win && typeof win.isFullscreen === "function") {
      try {
        isFullscreen = Boolean(await win.isFullscreen());
      } catch {
        isFullscreen = false;
      }
    }
    if (overlayTrafficLights) {
      await listenTo("window://fullscreen-chrome");
    }
    return {
      ok: true,
      value: { native, platform, overlayTrafficLights, isFullscreen },
      transport,
    };
  }

  async function dragNativeWindow() {
    const win = currentTauriWindow();
    if (!win || typeof win.startDragging !== "function") {
      return { ok: true, value: false, transport };
    }
    try {
      const [maximized, fullscreen] = await Promise.all([
        typeof win.isMaximized === "function" ? win.isMaximized().catch(() => false) : false,
        typeof win.isFullscreen === "function" ? win.isFullscreen().catch(() => false) : false,
      ]);
      if (maximized || fullscreen) return { ok: true, value: false, transport };
      await win.startDragging();
      return { ok: true, value: true, transport };
    } catch (error) {
      return fail(error);
    }
  }

  async function toggleMaximizeNativeWindow() {
    const win = currentTauriWindow();
    if (!win) {
      return { ok: true, value: false, transport };
    }
    try {
      // `src/apps/desktop/capabilities/default.json` grants `allow-is-maximized`,
      // `allow-maximize`, and `allow-unmaximize` (NOT `allow-toggle-maximize`),
      // matching `src/web-ui/src/app/hooks/useWindowControls.ts`.
      if (
        typeof win.isMaximized === "function" &&
        typeof win.unmaximize === "function" &&
        typeof win.maximize === "function"
      ) {
        const maximized = await win.isMaximized();
        if (maximized) await win.unmaximize();
        else await win.maximize();
        return { ok: true, value: true, transport };
      }
      if (typeof win.toggleMaximize === "function") {
        await win.toggleMaximize();
        return { ok: true, value: true, transport };
      }
      return { ok: true, value: false, transport };
    } catch (error) {
      return fail(error);
    }
  }

  async function minimizeNativeWindow() {
    const win = currentTauriWindow();
    if (!win || typeof win.minimize !== "function") return { ok: true, value: false, transport };
    try {
      await win.minimize();
      return { ok: true, value: true, transport };
    } catch (error) {
      return fail(error);
    }
  }

  // `close()` raises the native close request; the desktop prevents it and emits
  // `openbitfun_main_window_close_requested`, which the app answers (tray, quit, ask).
  async function closeNativeWindow() {
    const win = currentTauriWindow();
    if (!win || typeof win.close !== "function") return { ok: true, value: false, transport };
    try {
      await win.close();
      return { ok: true, value: true, transport };
    } catch (error) {
      return fail(error);
    }
  }

  async function readNativeMaximized() {
    const win = currentTauriWindow();
    if (!win || typeof win.isMaximized !== "function") return { ok: true, value: false, transport };
    try {
      return { ok: true, value: Boolean(await win.isMaximized()), transport };
    } catch (error) {
      return fail(error);
    }
  }

  // Windows/Linux frames are drawn by the page (`decorations(false)`), so the
  // maximize glyph follows the window manager's own state on every resize.
  let resizeWatch = null;
  async function watchNativeResize() {
    if (resizeWatch) return { ok: true, value: true, transport };
    const win = currentTauriWindow();
    if (!win || typeof win.onResized !== "function") return { ok: true, value: false, transport };
    let timer = null;
    resizeWatch = { stop: null };
    try {
      resizeWatch.stop = await win.onResized(() => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(async () => {
          timer = null;
          let maximized = false;
          let fullscreen = false;
          try {
            maximized = typeof win.isMaximized === "function" ? Boolean(await win.isMaximized()) : false;
            fullscreen = typeof win.isFullscreen === "function" ? Boolean(await win.isFullscreen()) : false;
          } catch {
            // The window is closing or hidden; the next resize reports again.
          }
          player.hostEvent("openbitfun.event", {
            event: "window://resized",
            payload: { maximized, fullscreen },
          });
        }, 120);
      });
      return { ok: true, value: true, transport };
    } catch (error) {
      resizeWatch = null;
      return fail(error);
    }
  }

  function readPageFocused() {
    const focused =
      typeof document !== "undefined" && typeof document.hasFocus === "function"
        ? Boolean(document.hasFocus()) && document.visibilityState !== "hidden"
        : true;
    return { ok: true, value: focused, transport };
  }

  // This window's own build, as `@tauri-apps/api/app` `getVersion()` reads it; it
  // never follows a peer, unlike the proxied `get_app_version` command.
  async function readControllerVersion() {
    if (!native) return { ok: true, value: null, transport };
    try {
      const version = await core.invoke("plugin:app|version");
      return { ok: true, value: typeof version === "string" ? version : null, transport };
    } catch (error) {
      return fail(error);
    }
  }

  // The dialog plugin's `open`, as `@tauri-apps/plugin-dialog` invokes it.
  async function pickNativeDirectory(args) {
    if (!native) {
      return fail("The development host has no native folder picker");
    }
    const options = { directory: true, multiple: false };
    if (args && typeof args.title === "string" && args.title) options.title = args.title;
    if (args && typeof args.defaultPath === "string" && args.defaultPath) options.defaultPath = args.defaultPath;
    try {
      const selected = await core.invoke("plugin:dialog|open", { options });
      const path = typeof selected === "string" && selected.length > 0 ? selected : null;
      return { ok: true, value: path, transport };
    } catch (error) {
      return fail(error);
    }
  }

  return {
    async call(name, args) {
      switch (name) {
        case "openbitfun.transport":
          return { ok: true, value: { transport }, transport };
        case "openbitfun.windowChrome":
          return readWindowChrome();
        case "openbitfun.windowDrag":
          return dragNativeWindow();
        case "openbitfun.windowToggleMaximize":
          return toggleMaximizeNativeWindow();
        case "openbitfun.windowMinimize":
          return minimizeNativeWindow();
        case "openbitfun.windowClose":
          return closeNativeWindow();
        case "openbitfun.windowIsMaximized":
          return readNativeMaximized();
        case "openbitfun.windowWatchResize":
          return watchNativeResize();
        case "openbitfun.windowFocused":
          return readPageFocused();
        case "openbitfun.pickDirectory":
          return pickNativeDirectory(args);
        case "openbitfun.appVersion":
          return readControllerVersion();
        case "openbitfun.invoke": {
          if (!args || typeof args.action !== "string") {
            return fail("openbitfun.invoke needs an action");
          }
          if (Object.prototype.hasOwnProperty.call(args, "raw")) {
            return native ? invokeNativeRaw(args.action, args.raw) : invokeFixture(args.action, args);
          }
          return native
            ? invokeNative(args.action, args.request)
            : invokeFixture(args.action, args);
        }
        case "openbitfun.controller.key":
        case "openbitfun.controller.forgetKey":
        case "openbitfun.controller.open":
        case "openbitfun.controller.send":
        case "openbitfun.controller.close":
        case "openbitfun.controller.prepareBundle":
        case "openbitfun.controller.launch":
        case "openbitfun.controller.leave":
        case "openbitfun.controller.page": {
          const operation = name.slice("openbitfun.controller.".length);
          try {
            return { ok: true, value: await controller[operation](args), transport };
          } catch (error) {
            return fail(error);
          }
        }
        case "openbitfun.listen":
          return args && typeof args.event === "string"
            ? listenTo(args.event)
            : fail("openbitfun.listen needs an event");
        case "openbitfun.unlisten":
          return args && typeof args.event === "string"
            ? unlistenFrom(args.event)
            : fail("openbitfun.unlisten needs an event");
        default:
          throw new Error(`no host function ${name}`);
      }
    },
  };
}

// Settings values and writes.
//
// Reads are per config path, because `get_configs` fails the whole batch when a
// single path is missing on the host. Every field is a dotted leaf path
// (`app.auto_update`, `editor.font_size`, `memories.extract_model`), and a write
// replaces that one value through `set_config`. Nothing here patches a snapshot
// of a parent object read at load time: such a write would put back every
// sibling as it was when the page opened, reverting what another section or
// surface changed since (the quick-action list in `app.ai_experience`, the
// interface language in `app`).

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import {
  SUPPORTED_LOCALES,
  currentLocale,
  localeMeta,
  normalizeLocale,
  onAppLocalePersisted,
  setAppLocale,
  tr,
  type AppLocale,
  type MessageKey,
} from "./i18n";
import { errorText, invokeSettingsMutation } from "./settingsMutations";
import { currentDeviceScopeKey } from "./shared/deviceScope";
import { runStep } from "./state";

export type FieldKind = "boolean" | "select" | "number" | "text" | "model";

export interface FieldOption {
  value: string;
  label: string;
  labelKey?: MessageKey;
}

export interface FieldSpec {
  /** Stable id, used as the control's accessibility label. */
  id: string;
  label: string;
  labelKey?: MessageKey;
  /** The dotted leaf config path the value lives at. */
  path: string;
  /**
   * Legacy: a dotted field inside `path`. Read and written as the leaf
   * `${path}.${field}`, never by patching the parent object.
   */
  field?: string;
  kind: FieldKind;
  options?: FieldOption[];
  min?: number;
  max?: number;
  /**
   * A number the host keeps as `Option`: an empty field or 0 stores `null`
   * ("no limit"), and the stepper offers to clear it.
   */
  clearable?: boolean;
  /** A secret text value (a proxy password): drawn masked. */
  masked?: boolean;
  /** Extra words the settings search matches besides the label and description. */
  keywords?: string[];
  /** A select whose choices the host lists (its installed browsers), read when drawn. */
  dynamicOptions?: () => FieldOption[];
  /** The option an empty stored string stands for. */
  emptyMeans?: string;
  /** The label of the empty choice a `model` field needs: what "no override" means. */
  emptyLabel?: string;
  emptyLabelKey?: MessageKey;
  hint?: string;
  hintKey?: MessageKey;
  /** Concise friendly description key rendered under the row label. */
  descriptionKey?: MessageKey;
  /** Domain-specific input placeholder for `text` and `number` fields. */
  placeholder?: string;
  placeholderKey?: MessageKey;
  /** Short measurement unit label for numeric inputs (e.g. `s`, `px`, `days`). */
  unit?: string;
  unitKey?: MessageKey;
  /** Paths older hosts may not have; a missing one without a default is unavailable. */
  optional?: boolean;
  /**
   * What the host does when the path is absent. A field with a default stays
   * writable: the value shown is the product's own default, and the first write
   * creates the path.
   */
  defaultValue?: string | number | boolean;
  /**
   * A typed settings command that writes this value instead of a leaf
   * `set_config` (`{ [requestKey]: value }`, sent to the device in context).
   */
  mutation?: { command: string; requestKey: string };
}

/** The settings pages, mirroring the desktop's settings registry. */
export type SettingsPageId =
  | "general"
  | "appearance"
  | "input"
  | "shortcuts"
  | "pet"
  | "profile"
  | "devices"
  | "openbitfun"
  | "activity"
  | "archived"
  | "models"
  | "session-memory"
  | "execution"
  | "permissions"
  | "editor"
  | "terminal"
  | "workspace"
  | "external-import"
  | "web-search"
  | "desktop-control"
  | "mcp"
  | "external-agents"
  | "automation"
  | "usage"
  | "diagnostics";

export interface SettingsSection {
  id: string;
  title: string;
  titleKey?: MessageKey;
  /** The settings page that draws this section. */
  page: SettingsPageId;
  fields: FieldSpec[];
}

/**
 * Writable `app.language` field spec. Writing this field updates `currentLocale`,
 * persists to `Storage`, syncs native NSH widgets, and merges `language` into
 * the host's `app` config object so sibling keys survive.
 */
export const APP_LANGUAGE_FIELD: FieldSpec = {
  id: "app-language",
  label: "Interface language",
  labelKey: "settings.language.title",
  path: "app",
  field: "language",
  kind: "select",
  options: SUPPORTED_LOCALES.map(entry => ({
    value: entry.id,
    label: entry.nativeName,
  })),
  hint: "Switch the display language immediately across all scenes and save to your app settings.",
  hintKey: "settings.language.hint",
  optional: true,
  defaultValue: "en-US",
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    // This device's switches for the OpenBitFun cloud agent (config path
    // `superagent`); both are on unless they are exactly `false`.
    id: "superagent-device",
    title: "Super Agent",
    titleKey: "obf.toggle",
    page: "permissions",
    fields: [
      {
        id: "superagent-allow-auto-approval",
        label: "Let Super Agent answer for me",
        labelKey: "perm.agentAnswers",
        descriptionKey: "perm.agentAnswersBody",
        path: "superagent.allowAutoApproval",
        kind: "boolean",
        mutation: { command: "set_superagent_settings", requestKey: "allowAutoApproval" },
        optional: true,
        defaultValue: true,
        keywords: ["openbitfun", "super agent", "approve", "superagent"],
      },
      {
        id: "superagent-accept-dispatch",
        label: "Accept jobs from Super Agent",
        labelKey: "perm.acceptJobs",
        descriptionKey: "perm.acceptJobsBody",
        path: "superagent.acceptDispatch",
        kind: "boolean",
        mutation: { command: "set_superagent_settings", requestKey: "acceptDispatch" },
        optional: true,
        defaultValue: true,
        keywords: ["openbitfun", "super agent", "jobs", "superagent"],
      },
    ],
  },
  {
    id: "general",
    title: "Startup",
    titleKey: "settings.section.startup",
    page: "general",
    fields: [
      {
        id: "close-button",
        label: "Close button",
        labelKey: "settings.field.closeButton",
        descriptionKey: "settings.field.closeButtonDesc",
        path: "app.close_button_behavior",
        kind: "select",
        options: [
          { value: "minimize_to_tray", label: "Minimize to tray", labelKey: "settings.opt.minimizeToTray" },
          { value: "quit", label: "Quit", labelKey: "settings.opt.quit" },
          { value: "ask", label: "Ask", labelKey: "settings.opt.ask" },
        ],
        optional: true,
        keywords: ["window", "tray", "quit"],
      },
      {
        id: "notify-dialog-completion",
        label: "Notify when a dialog turn finishes",
        labelKey: "settings.field.notifyDialogCompletion",
        descriptionKey: "settings.field.notifyDialogCompletionDesc",
        path: "app.notifications.dialog_completion_notify",
        kind: "boolean",
        optional: true,
        keywords: ["notification"],
      },
      {
        id: "notify-permission-request",
        label: "Notify on permission requests",
        labelKey: "settings.field.notifyPermissionRequest",
        descriptionKey: "settings.field.notifyPermissionRequestDesc",
        path: "app.notifications.permission_request_notify",
        kind: "boolean",
        optional: true,
        keywords: ["notification", "approval"],
      },
      // `telemetry`, `confirm_on_exit` and `restore_windows` are stored on the
      // host but nothing reads them, so they are not drawn.
      {
        id: "auto-update",
        label: "Check for updates automatically",
        labelKey: "settings.field.autoUpdate",
        descriptionKey: "settings.field.autoUpdateDesc",
        path: "app.auto_update",
        kind: "boolean",
        optional: true,
        keywords: ["update", "upgrade"],
      },
      {
        id: "prevent-sleep",
        label: "Keep the computer awake",
        labelKey: "settings.field.preventSleep",
        descriptionKey: "settings.field.preventSleepDesc",
        path: "app.prevent_sleep",
        kind: "boolean",
        optional: true,
        keywords: ["sleep", "awake"],
      },
    ],
  },
  {
    id: "input",
    title: "Input",
    titleKey: "settings.section.input",
    page: "input",
    fields: [
      {
        id: "selection-toolbar",
        label: "Show excerpt actions after selecting text",
        labelKey: "settings.field.selectionToolbar",
        descriptionKey: "settings.field.selectionToolbarDesc",
        path: "app.flow_chat.auto_show_selection_toolbar",
        kind: "boolean",
        optional: true,
        keywords: ["selection", "excerpt", "toolbar"],
      },
      {
        id: "voice-input",
        label: "Voice input in the composer",
        labelKey: "settings.field.voiceInput",
        path: "app.ai_experience.voice_input.enabled",
        kind: "boolean",
        optional: true,
        hint: "Runs on this machine through the host's speech service",
        hintKey: "settings.field.voiceInputHint",
        keywords: ["voice", "speech", "dictation"],
      },
      {
        id: "voice-language",
        label: "Voice language",
        labelKey: "settings.field.voiceLanguage",
        path: "app.ai_experience.voice_input.default_language",
        kind: "select",
        optional: true,
        options: [
          { value: "auto", label: "Detect automatically", labelKey: "settings.opt.voiceAuto" },
          { value: "zh", label: "Chinese", labelKey: "settings.opt.voiceZh" },
          { value: "en", label: "English", labelKey: "settings.opt.voiceEn" },
          { value: "yue", label: "Cantonese", labelKey: "settings.opt.voiceYue" },
          { value: "ja", label: "Japanese", labelKey: "settings.opt.voiceJa" },
          { value: "ko", label: "Korean", labelKey: "settings.opt.voiceKo" },
        ],
        hint: "auto follows the language you speak",
        hintKey: "settings.field.voiceLanguageHint",
        keywords: ["voice", "language"],
      },
      {
        id: "voice-max-seconds",
        label: "Longest recording (s)",
        labelKey: "settings.field.voiceMaxSeconds",
        descriptionKey: "settings.field.voiceMaxSecondsDesc",
        path: "app.ai_experience.voice_input.max_recording_seconds",
        kind: "number",
        min: 5,
        max: 300,
        optional: true,
        placeholder: "60 (5–300)",
        placeholderKey: "settings.placeholder.voiceMaxSeconds",
        unit: "s",
        unitKey: "settings.unit.seconds",
      },
      {
        id: "voice-microphone",
        label: "Microphone",
        labelKey: "settings.field.voiceMicrophone",
        path: "app.ai_experience.voice_input.microphone_device_id",
        kind: "text",
        optional: true,
        placeholder: "Default microphone",
        placeholderKey: "settings.placeholder.voiceMicrophone",
        hint: "Empty uses the system default input",
        hintKey: "settings.field.voiceMicrophoneHint",
      },
    ],
  },
  {
    id: "session",
    title: "Session",
    titleKey: "settings.section.session",
    page: "session-memory",
    fields: [
      {
        id: "session-title-generation",
        label: "Let the model name new sessions",
        labelKey: "settings.field.sessionTitleGeneration",
        descriptionKey: "settings.field.sessionTitleGenerationDesc",
        path: "app.ai_experience.enable_session_title_generation",
        kind: "boolean",
        optional: true,
        keywords: ["title", "name"],
      },
      {
        id: "prompt-suggestion",
        label: "Suggest the next message",
        labelKey: "settings.field.promptSuggestion",
        descriptionKey: "settings.field.promptSuggestionDesc",
        path: "app.ai_experience.enable_prompt_suggestion",
        kind: "boolean",
        optional: true,
        keywords: ["suggestion", "next input"],
      },
    ],
  },
  {
    id: "editor",
    title: "Editor",
    titleKey: "settings.section.editor",
    page: "editor",
    fields: [
      {
        id: "editor-font-size",
        label: "Font size",
        labelKey: "settings.field.editorFontSize",
        descriptionKey: "settings.field.editorFontSizeDesc",
        path: "editor.font_size",
        kind: "number",
        optional: true,
        unit: "px",
        unitKey: "settings.unit.px",
      },
      {
        id: "editor-tab-size",
        label: "Tab size",
        labelKey: "settings.field.editorTabSize",
        descriptionKey: "settings.field.editorTabSizeDesc",
        path: "editor.tab_size",
        kind: "number",
        optional: true,
        unit: "spaces",
        unitKey: "settings.unit.spaces",
        keywords: ["indent"],
      },
      {
        id: "editor-word-wrap",
        label: "Word wrap",
        labelKey: "settings.field.editorWordWrap",
        descriptionKey: "settings.field.editorWordWrapDesc",
        path: "editor.word_wrap",
        kind: "select",
        optional: true,
        options: [
          { value: "off", label: "Off", labelKey: "settings.opt.off" },
          { value: "on", label: "On", labelKey: "settings.opt.on" },
          { value: "bounded", label: "Bounded", labelKey: "settings.opt.bounded" },
        ],
      },
      {
        id: "editor-line-numbers",
        label: "Line numbers",
        labelKey: "settings.field.editorLineNumbers",
        descriptionKey: "settings.field.editorLineNumbersDesc",
        path: "editor.line_numbers",
        kind: "select",
        optional: true,
        options: [
          { value: "on", label: "On", labelKey: "settings.opt.on" },
          { value: "off", label: "Off", labelKey: "settings.opt.off" },
          { value: "relative", label: "Relative", labelKey: "settings.opt.relative" },
        ],
      },
      {
        id: "editor-minimap",
        label: "Minimap",
        labelKey: "settings.field.editorMinimap",
        descriptionKey: "settings.field.editorMinimapDesc",
        path: "editor.minimap.enabled",
        kind: "boolean",
        optional: true,
      },
    ],
  },
  {
    id: "terminal",
    title: "Terminal",
    titleKey: "settings.section.terminal",
    page: "terminal",
    fields: [
      {
        id: "terminal-font-size",
        label: "Font size",
        labelKey: "settings.field.terminalFontSize",
        descriptionKey: "settings.field.terminalFontSizeDesc",
        path: "terminal.font_size",
        kind: "number",
        min: 10,
        max: 24,
        optional: true,
        placeholder: "14 (10–24)",
        placeholderKey: "settings.placeholder.terminalFontSize",
        unit: "px",
        unitKey: "settings.unit.px",
      },
      {
        id: "terminal-scrollback",
        label: "Scrollback (lines)",
        labelKey: "settings.field.terminalScrollback",
        descriptionKey: "settings.field.terminalScrollbackDesc",
        path: "terminal.scrollback",
        kind: "number",
        min: 100,
        max: 100000,
        optional: true,
        placeholder: "1000 (100–100000)",
        placeholderKey: "settings.placeholder.terminalScrollback",
        unit: "lines",
        unitKey: "settings.unit.lines",
      },
      {
        id: "terminal-cursor-style",
        label: "Cursor",
        labelKey: "settings.field.terminalCursorStyle",
        descriptionKey: "settings.field.terminalCursorStyleDesc",
        path: "terminal.cursor_style",
        kind: "select",
        optional: true,
        // xterm's cursor styles; `line` is not one of them.
        options: [
          { value: "block", label: "Block", labelKey: "settings.opt.block" },
          { value: "underline", label: "Underline", labelKey: "settings.opt.underline" },
          { value: "bar", label: "Bar", labelKey: "settings.opt.bar" },
        ],
      },
    ],
  },
  {
    id: "workspace",
    title: "Worktrees",
    titleKey: "settings.section.workspace",
    page: "workspace",
    fields: [
      // `app.worktrees` is stored in camelCase by the worktree service, and the
      // Product Operation Registry names these same keys.
      {
        id: "worktree-root",
        label: "Worktree folder",
        labelKey: "settings.field.worktreeRoot",
        descriptionKey: "settings.field.worktreeRootDesc",
        path: "app.worktrees.rootPath",
        kind: "text",
        optional: true,
        placeholder: "~/.openbitfun/worktrees",
        placeholderKey: "settings.placeholder.worktreeRoot",
        keywords: ["worktree", "isolation"],
      },
      {
        id: "worktree-branch-prefix",
        label: "Worktree branch prefix",
        labelKey: "settings.field.worktreeBranchPrefix",
        descriptionKey: "settings.field.worktreeBranchPrefixDesc",
        path: "app.worktrees.branchPrefix",
        kind: "text",
        optional: true,
        placeholder: "openbitfun/",
        placeholderKey: "settings.placeholder.worktreeBranchPrefix",
        keywords: ["branch"],
      },
      {
        id: "worktree-copy-changes",
        label: "Copy local changes into a new worktree",
        labelKey: "settings.field.worktreeCopyChanges",
        descriptionKey: "settings.field.worktreeCopyChangesDesc",
        path: "app.worktrees.copyLocalChanges",
        kind: "boolean",
        optional: true,
      },
      {
        id: "worktree-auto-delete",
        label: "Delete old worktrees automatically",
        labelKey: "settings.field.worktreeAutoDelete",
        descriptionKey: "settings.field.worktreeAutoDeleteDesc",
        path: "app.worktrees.autoDeleteEnabled",
        kind: "boolean",
        optional: true,
      },
      {
        id: "worktree-auto-delete-limit",
        label: "Worktrees to keep",
        labelKey: "settings.field.worktreeAutoDeleteLimit",
        descriptionKey: "settings.field.worktreeAutoDeleteLimitDesc",
        path: "app.worktrees.autoDeleteLimit",
        kind: "number",
        optional: true,
        unit: "items",
        unitKey: "settings.unit.count",
      },
    ],
  },
  {
    id: "workspace-search",
    title: "Workspace search",
    titleKey: "settings.section.workspaceSearch",
    page: "workspace",
    fields: [
      {
        id: "workspace-search",
        label: "Accelerated workspace search",
        labelKey: "settings.field.workspaceSearch",
        descriptionKey: "settings.field.workspaceSearchDesc",
        path: "app.ai_experience.enable_workspace_search",
        kind: "boolean",
        optional: true,
        keywords: ["search", "index", "files"],
      },
    ],
  },
  {
    id: "git",
    title: "Git",
    titleKey: "settings.section.git",
    page: "workspace",
    fields: [
      {
        id: "commit-coauthor",
        label: "Attribute commits to OpenBitFun",
        labelKey: "settings.field.commitCoauthor",
        path: "app.ai_experience.enable_git_commit_coauthor",
        kind: "boolean",
        optional: true,
        hint: "Adds the co-author trailer the desktop uses to generated commit messages",
        hintKey: "settings.field.commitCoauthorHint",
        keywords: ["git", "commit", "co-author"],
      },
    ],
  },
  {
    id: "ai-execution",
    title: "AI execution",
    titleKey: "settings.section.aiExecution",
    page: "execution",
    fields: [
      {
        id: "deferred-tool-loading",
        label: "Load tool schemas on demand",
        labelKey: "settings.field.deferredToolLoading",
        descriptionKey: "settings.field.deferredToolLoadingDesc",
        path: "ai.enable_deferred_tool_loading",
        kind: "boolean",
        optional: true,
      },
      {
        id: "subagent-concurrency",
        label: "Parallel subagents",
        labelKey: "settings.field.subagentConcurrency",
        descriptionKey: "settings.field.subagentConcurrencyDesc",
        path: "ai.subagent_max_concurrency",
        kind: "number",
        optional: true,
        unit: "max",
        unitKey: "settings.unit.concurrent",
      },
      {
        id: "swarm-concurrency",
        label: "Parallel swarm members",
        labelKey: "settings.field.swarmConcurrency",
        descriptionKey: "settings.field.swarmConcurrencyDesc",
        path: "ai.swarm_max_concurrency",
        kind: "number",
        optional: true,
        unit: "max",
        unitKey: "settings.unit.concurrent",
      },
      {
        id: "subagent-batch-policy",
        label: "Subagent batch",
        labelKey: "settings.field.subagentBatchPolicy",
        descriptionKey: "settings.field.subagentBatchPolicyDesc",
        path: "ai.subagent_batch_execution_policy",
        kind: "select",
        options: [
          { value: "force_parallel", label: "Force parallel", labelKey: "settings.opt.forceParallel" },
          { value: "safe_only", label: "Only when read-only", labelKey: "settings.opt.safeOnly" },
          { value: "serial", label: "Serial", labelKey: "settings.opt.serial" },
        ],
        optional: true,
      },
      {
        // `Option<u64>` on the host: `None` (the default) waits indefinitely.
        id: "tool-execution-timeout",
        label: "Tool timeout (s)",
        labelKey: "settings.field.toolExecutionTimeout",
        descriptionKey: "settings.field.toolExecutionTimeoutDesc",
        path: "ai.tool_execution_timeout_secs",
        kind: "number",
        optional: true,
        clearable: true,
        defaultValue: undefined,
        unit: "s",
        unitKey: "settings.unit.seconds",
      },
      {
        // `Option<u32>`: null or zero waits indefinitely; 180 by default.
        id: "user-question-timeout",
        label: "Waiting for an answer (s)",
        labelKey: "settings.field.userQuestionTimeout",
        descriptionKey: "settings.field.userQuestionTimeoutDesc",
        path: "ai.user_question_timeout_secs",
        kind: "number",
        min: 10,
        max: 3600,
        optional: true,
        clearable: true,
        placeholder: "180 (10–3600)",
        placeholderKey: "settings.placeholder.userQuestionTimeout",
        unit: "s",
        unitKey: "settings.unit.seconds",
      },
      {
        id: "tool-presentation-mode",
        label: "Tool presentation",
        labelKey: "settings.field.toolPresentationMode",
        path: "ai.tool_presentation_mode",
        kind: "select",
        options: [
          { value: "native", label: "Native calls", labelKey: "settings.opt.nativeCalls" },
          { value: "ptc", label: "Program (TypeScript)", labelKey: "settings.opt.ptcTs" },
          { value: "ptc_python", label: "Program (Python)", labelKey: "settings.opt.ptcPy" },
        ],
        hint: "A session keeps the mode it was created with",
        hintKey: "settings.field.toolPresentationModeHint",
        optional: true,
      },
    ],
  },
  {
    id: "network",
    title: "Network",
    titleKey: "settings.section.network",
    page: "models",
    fields: [
      {
        id: "proxy-enabled",
        label: "Use a proxy for model requests",
        labelKey: "settings.field.proxyEnabled",
        descriptionKey: "settings.field.proxyEnabledDesc",
        path: "ai.proxy.enabled",
        kind: "boolean",
        optional: true,
        keywords: ["proxy", "network"],
      },
      {
        id: "proxy-url",
        label: "Proxy address",
        labelKey: "settings.field.proxyUrl",
        path: "ai.proxy.url",
        kind: "text",
        optional: true,
        placeholder: "http://127.0.0.1:7890",
        keywords: ["proxy"],
      },
      {
        id: "proxy-username",
        label: "Proxy user name",
        labelKey: "settings.field.proxyUsername",
        path: "ai.proxy.username",
        kind: "text",
        optional: true,
        defaultValue: "",
        placeholderKey: "settings.placeholder.optional",
      },
      {
        id: "proxy-password",
        label: "Proxy password",
        labelKey: "settings.field.proxyPassword",
        path: "ai.proxy.password",
        kind: "text",
        masked: true,
        optional: true,
        defaultValue: "",
        placeholderKey: "settings.placeholder.optional",
      },
      {
        // `Option<u64>`, 600 by default; empty waits indefinitely.
        id: "stream-idle-timeout",
        label: "Stream idle timeout (s)",
        labelKey: "settings.field.streamIdleTimeout",
        descriptionKey: "settings.field.streamIdleTimeoutDesc",
        path: "ai.stream_idle_timeout_secs",
        kind: "number",
        optional: true,
        clearable: true,
        unit: "s",
        unitKey: "settings.unit.seconds",
        keywords: ["timeout", "stream"],
      },
      {
        id: "stream-ttft-timeout",
        label: "First token timeout (s)",
        labelKey: "settings.field.streamTtftTimeout",
        descriptionKey: "settings.field.streamTtftTimeoutDesc",
        path: "ai.stream_ttft_timeout_secs",
        kind: "number",
        optional: true,
        clearable: true,
        unit: "s",
        unitKey: "settings.unit.seconds",
        keywords: ["timeout", "first token"],
      },
    ],
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    titleKey: "settings.section.diagnostics",
    page: "diagnostics",
    fields: [
      {
        id: "logging-level",
        label: "Log level",
        labelKey: "settings.field.loggingLevel",
        descriptionKey: "settings.field.loggingLevelDesc",
        path: "app.logging.level",
        kind: "select",
        options: [
          { value: "trace", label: "Trace", labelKey: "settings.opt.trace" },
          { value: "debug", label: "Debug", labelKey: "settings.opt.debug" },
          { value: "info", label: "Info", labelKey: "settings.opt.info" },
          { value: "warn", label: "Warn", labelKey: "settings.opt.warn" },
          { value: "error", label: "Error", labelKey: "settings.opt.error" },
        ],
        keywords: ["log"],
      },
      {
        id: "logging-sensitive",
        label: "Include sensitive payloads in diagnostics",
        labelKey: "settings.field.loggingSensitive",
        descriptionKey: "settings.field.loggingSensitiveDesc",
        path: "app.logging.include_sensitive_diagnostics",
        kind: "boolean",
        optional: true,
      },
    ],
  },
  {
    id: "memory",
    title: "Session memory",
    titleKey: "settings.section.memory",
    page: "session-memory",
    fields: [
      {
        id: "generate-memories",
        label: "Extract memories from sessions",
        labelKey: "settings.field.generateMemories",
        descriptionKey: "settings.field.generateMemoriesDesc",
        path: "memories.generate_memories",
        kind: "boolean",
        optional: true,
        keywords: ["memory", "remember"],
      },
      {
        id: "use-memories",
        label: "Include memories in prompts",
        labelKey: "settings.field.useMemories",
        descriptionKey: "settings.field.useMemoriesDesc",
        path: "memories.use_memories",
        kind: "boolean",
        optional: true,
        keywords: ["memory", "recall"],
      },
      {
        id: "memory-btw-sessions",
        label: "Learn from background sessions",
        labelKey: "settings.field.memoryBtwSessions",
        descriptionKey: "settings.field.memoryBtwSessionsDesc",
        path: "memories.generate_for_btw_sessions",
        kind: "boolean",
        optional: true,
      },
      {
        id: "memory-external-context",
        label: "Sessions that used external context",
        labelKey: "settings.field.memoryExternalContext",
        descriptionKey: "settings.field.memoryExternalContextDesc",
        path: "memories.external_context_policy",
        kind: "select",
        options: [
          { value: "clear_tool_results", label: "Keep, clear the tool results", labelKey: "settings.opt.clearToolResults" },
          { value: "allow", label: "Keep as-is", labelKey: "settings.opt.keepAsIs" },
          { value: "skip_session", label: "Skip extracting", labelKey: "settings.opt.skipExtracting" },
        ],
        optional: true,
      },
      {
        id: "memory-max-unused-days",
        label: "Forget after (days)",
        labelKey: "settings.field.memoryMaxUnusedDays",
        descriptionKey: "settings.field.memoryMaxUnusedDaysDesc",
        path: "memories.max_unused_days",
        kind: "number",
        min: 1,
        max: 3650,
        optional: true,
        placeholder: "30 (1–3650)",
        placeholderKey: "settings.placeholder.memoryMaxUnusedDays",
        unit: "days",
        unitKey: "settings.unit.days",
      },
      {
        id: "memory-consolidation-batch",
        label: "Memories per consolidation",
        labelKey: "settings.field.memoryConsolidationBatch",
        descriptionKey: "settings.field.memoryConsolidationBatchDesc",
        path: "memories.max_raw_memories_for_consolidation",
        kind: "number",
        min: 1,
        max: 512,
        optional: true,
        placeholder: "64 (1–512)",
        placeholderKey: "settings.placeholder.memoryConsolidationBatch",
        unit: "items",
        unitKey: "settings.unit.memories",
      },
      {
        id: "memory-extract-model",
        label: "Model that extracts memories",
        labelKey: "settings.field.memoryExtractModel",
        descriptionKey: "settings.field.memoryExtractModelDesc",
        path: "memories.extract_model",
        kind: "model",
        emptyLabel: "Follow the primary model",
        emptyLabelKey: "settings.field.memoryExtractModelEmpty",
        optional: true,
        defaultValue: "",
      },
      {
        id: "memory-consolidation-model",
        label: "Model that consolidates memories",
        labelKey: "settings.field.memoryConsolidationModel",
        descriptionKey: "settings.field.memoryConsolidationModelDesc",
        path: "memories.consolidation_model",
        kind: "model",
        emptyLabel: "Follow the extraction model",
        emptyLabelKey: "settings.field.memoryConsolidationModelEmpty",
        optional: true,
        defaultValue: "",
      },
      {
        id: "memory-idle-hours",
        label: "A session must be idle for (hours)",
        labelKey: "settings.field.memoryIdleHours",
        descriptionKey: "settings.field.memoryIdleHoursDesc",
        path: "memories.min_rollout_idle_hours",
        kind: "number",
        min: 1,
        max: 48,
        placeholder: "6 (1–48)",
        placeholderKey: "settings.placeholder.memoryIdleHours",
        unit: "h",
        unitKey: "settings.unit.hours",
        optional: true,
      },
      {
        id: "memory-rollout-age-days",
        label: "Extract from sessions no older than (days)",
        labelKey: "settings.field.memoryRolloutAgeDays",
        descriptionKey: "settings.field.memoryRolloutAgeDaysDesc",
        path: "memories.max_rollout_age_days",
        kind: "number",
        min: 0,
        max: 3650,
        // The host refuses a window longer than the retention it extracts into.
        placeholder: "10 (0–3650)",
        placeholderKey: "settings.placeholder.memoryRolloutAgeDays",
        unit: "days",
        unitKey: "settings.unit.days",
        optional: true,
      },
      {
        id: "memory-rollouts-per-startup",
        label: "Sessions extracted per startup",
        labelKey: "settings.field.memoryRolloutsPerStartup",
        descriptionKey: "settings.field.memoryRolloutsPerStartupDesc",
        path: "memories.max_rollouts_per_startup",
        kind: "number",
        min: 1,
        max: 128,
        placeholder: "2 (1–128)",
        placeholderKey: "settings.placeholder.memoryRolloutsPerStartup",
        unit: "sessions",
        unitKey: "settings.unit.sessions",
        optional: true,
      },
      {
        id: "memory-rollouts-scan-limit",
        label: "Sessions scanned per startup",
        labelKey: "settings.field.memoryRolloutsScanLimit",
        descriptionKey: "settings.field.memoryRolloutsScanLimitDesc",
        path: "memories.max_rollouts_scan_limit",
        kind: "number",
        min: 1,
        max: 50000,
        placeholder: "2000 (1–50000)",
        placeholderKey: "settings.placeholder.memoryRolloutsScanLimit",
        unit: "sessions",
        unitKey: "settings.unit.sessions",
        optional: true,
      },
      {
        id: "memory-phase1-concurrency",
        label: "Extraction concurrency",
        labelKey: "settings.field.memoryPhase1Concurrency",
        descriptionKey: "settings.field.memoryPhase1ConcurrencyDesc",
        path: "memories.phase1_max_concurrency",
        kind: "number",
        min: 1,
        max: 16,
        placeholder: "1 (1–16)",
        placeholderKey: "settings.placeholder.memoryPhase1Concurrency",
        unit: "max",
        unitKey: "settings.unit.concurrent",
        optional: true,
      },
    ],
  },
  {
    id: "tools",
    title: "Desktop control",
    titleKey: "settings.page.desktopControl",
    page: "desktop-control",
    fields: [
      {
        id: "computer-use",
        label: "Allow computer use",
        labelKey: "settings.field.computerUse",
        path: "ai.computer_use_enabled",
        kind: "boolean",
        hint: "The host still asks for its own system consent",
        hintKey: "settings.field.computerUseHint",
        optional: true,
        keywords: ["computer use", "desktop"],
      },
      {
        id: "browser-control-auto-connect",
        label: "Reattach the browser at launch",
        labelKey: "settings.field.browserControlAutoConnect",
        path: "ai.browser_control_auto_connect_on_startup",
        kind: "boolean",
        hint: "The browser forgets its approval when it restarts",
        hintKey: "settings.field.browserControlAutoConnectHint",
        optional: true,
        keywords: ["browser"],
      },
      {
        // The choices are the browsers the host reports (`browser_control_list_browsers`).
        id: "preferred-browser",
        label: "Preferred browser",
        labelKey: "settings.field.preferredBrowser",
        path: "ai.browser_control_preferred_browser",
        kind: "select",
        defaultValue: "default",
        emptyMeans: "default",
        dynamicOptions: () => browserOptions(),
        hint: "The browser agents open and drive",
        hintKey: "settings.field.preferredBrowserPick",
        optional: true,
        keywords: ["browser", "chrome"],
      },
    ],
  },
  {
    id: "agent-hooks",
    title: "Agent hooks",
    titleKey: "settings.section.agentHooks",
    page: "automation",
    fields: [
      {
        id: "hooks-enabled",
        label: "Run native agent hooks",
        labelKey: "settings.field.hooksEnabled",
        descriptionKey: "settings.field.hooksEnabledDesc",
        path: "app.hooks.enabled",
        kind: "boolean",
        optional: true,
        keywords: ["hooks"],
      },
      {
        id: "hooks-project",
        label: "Honor project hook files",
        labelKey: "settings.field.hooksProject",
        path: "app.hooks.project_hooks_enabled",
        kind: "boolean",
        hint: "A project hook file runs commands from the checked-out repository",
        hintKey: "settings.field.hooksProjectHint",
        optional: true,
      },
    ],
  },
];

/** The leaf config path a field reads and writes. */
export function leafPath(spec: Pick<FieldSpec, "path" | "field">): string {
  return spec.field ? `${spec.path}.${spec.field}` : spec.path;
}

/** The section that owns a field, by id. */
export function sectionOfField(spec: FieldSpec): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find(section => section.fields.some(field => field.id === spec.id));
}

/** Reactive localized title for a settings section. */
export function sectionTitle(section: SettingsSection): string {
  return section.titleKey ? tr(section.titleKey) : section.title;
}

/** Reactive localized label for a settings field. */
export function fieldLabel(spec: FieldSpec): string {
  return spec.labelKey ? tr(spec.labelKey) : spec.label;
}

/** Reactive localized hint/description for a settings field. */
export function fieldHint(spec: FieldSpec): string | undefined {
  if (spec.hintKey) return tr(spec.hintKey);
  if (spec.descriptionKey) return tr(spec.descriptionKey);
  return spec.hint;
}

/** Reactive localized empty-choice label for a `model` settings field. */
export function fieldEmptyLabel(spec: FieldSpec): string | undefined {
  if (spec.emptyLabelKey) return tr(spec.emptyLabelKey);
  return spec.emptyLabel;
}

/** Reactive localized label for a select option. */
export function optionLabel(option: FieldOption): string {
  return option.labelKey ? tr(option.labelKey) : option.label;
}

/** Reactive localized domain-specific placeholder for a `text` or `number` field. */
export function fieldPlaceholder(spec: FieldSpec): string {
  if (spec.placeholderKey) return tr(spec.placeholderKey);
  if (spec.placeholder) return spec.placeholder;
  const fallback = defaultForField(spec);
  if (fallback !== undefined && fallback !== "") {
    return String(fallback);
  }
  return tr("settings.field.newValuePlaceholder");
}

/** Reactive localized unit suffix for a numeric field, when applicable. */
export function fieldUnit(spec: FieldSpec): string | undefined {
  if (spec.unitKey) return tr(spec.unitKey);
  return spec.unit;
}

/** Values by config path; `undefined` means the host does not have that path. */
export const settingsValues = signal<Record<string, unknown>>({});
export const settingsLoaded = signal(false);
/** A page-level message (the interface language); field notices go to their section. */
export const settingsNotice = signal("");
/** The latest outcome of a write, by the id of the section that owns the field. */
export const sectionNotices = signal<Record<string, string>>({});
/** Fields with a write in flight, by field id, so the row can show it is saving. */
export const savingFields = signal<Record<string, boolean>>({});

export function sectionNotice(sectionId: string): string {
  return sectionNotices()[sectionId] ?? "";
}

export function setSectionNotice(sectionId: string, message: string): void {
  sectionNotices.update(current => ({ ...current, [sectionId]: message }));
}

export function fieldSaving(spec: FieldSpec): boolean {
  return savingFields()[spec.id] === true;
}

function noticeFor(spec: FieldSpec, message: string): void {
  const section = sectionOfField(spec);
  if (section) setSectionNotice(section.id, message);
  else settingsNotice.set(message);
}

// Keep cached `settingsValues()["app"]` in sync whenever `setAppLocale(...)`
// switches language from any surface (Settings, Sidebar, TopBar).
onAppLocalePersisted((locale, persistedApp) => {
  settingsValues.update(values => {
    if (persistedApp) {
      return { ...values, app: persistedApp };
    }
    const existing = values["app"];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      return values;
    }
    return {
      ...values,
      app: { ...(existing as Record<string, unknown>), language: locale },
    };
  });
});

/** The current value of a field, or `undefined` when the host lacks it. */
export function fieldValue(spec: FieldSpec): unknown {
  return settingsValues()[leafPath(spec)];
}

/** Whether the host stores no value for this field at all. */
export function fieldMissing(spec: FieldSpec): boolean {
  return fieldValue(spec) === undefined;
}

/** What the row shows: the stored value, or the default the host applies instead. */
export function fieldDisplay(spec: FieldSpec): unknown {
  const stored = fieldValue(spec);
  return stored === undefined ? defaultForField(spec) : stored;
}

/**
 * Active canonical interface language. Reflects `currentLocale()` reactively so
 * switching language updates the Settings control immediately.
 */
export function appLanguageValue(): AppLocale {
  return currentLocale();
}

/**
 * Persists a new interface language via `setAppLocale(...)`, merging into the
 * host's `app` config cleanly and updating `settingsNotice`.
 */
export async function writeAppLanguage(locale: string): Promise<void> {
  const canonical = normalizeLocale(locale);
  if (!canonical) return;
  await runStep(async () => {
    const persisted = await setAppLocale(canonical, { persistHost: true });
    settingsNotice.set(
      persisted
        ? tr("settings.notice.languageSaved", { label: localeMeta(canonical).nativeName })
        : tr("settings.notice.languageNotPersisted"),
    );
  });
}

function readNestedPath(rootDoc: unknown, segments: readonly string[]): unknown {
  let node: unknown = rootDoc;
  for (const segment of segments) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Deduplicates concurrent `loadSettingsValues` calls targeting the same device. */
const settingsLoadInFlight = new Map<string, Promise<void>>();

export function loadSettingsValues(): Promise<void> {
  const deviceKey = currentDeviceScopeKey();
  const existing = settingsLoadInFlight.get(deviceKey);
  if (existing) return existing;

  const flight = runLoadSettingsValues(deviceKey).finally(() => {
    if (settingsLoadInFlight.get(deviceKey) === flight) {
      settingsLoadInFlight.delete(deviceKey);
    }
  });
  settingsLoadInFlight.set(deviceKey, flight);
  return flight;
}

async function runLoadSettingsValues(deviceKey: string): Promise<void> {
  // Collect all leaf paths and their top-level parent sections (`app`, `ai`,
  // `memories`, `editor`, `terminal`, `superagent`). Reading the 6 parent
  // documents once resolves all nested leaves on real hosts (instead of 63
  // individual `get_config` RPCs); only leaves absent from a parent document
  // fall back to a leaf read (e.g. flat mock fixtures or sparse legacy configs).
  const leafPaths = new Set<string>();
  const optional = new Set<string>();
  const rootSections = new Set<string>(["app"]);
  for (const section of SETTINGS_SECTIONS) {
    for (const field of section.fields) {
      const path = leafPath(field);
      leafPaths.add(path);
      if (field.optional) optional.add(path);
      const root = path.split(".")[0];
      if (root) rootSections.add(root);
    }
  }
  await runStep(async () => {
    const entries: Record<string, unknown> = {};
    const rootDocs: Record<string, unknown> = {};
    await Promise.all(
      [...rootSections].map(async root => {
        try {
          rootDocs[root] = await getConfig(root, true);
        } catch {
          rootDocs[root] = undefined;
        }
      }),
    );
    entries["app"] = rootDocs["app"];

    const missingLeaves: string[] = [];
    for (const path of leafPaths) {
      const segments = path.split(".");
      const root = segments[0] ?? "";
      const doc = rootDocs[root];
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        const resolved = readNestedPath(doc, segments.slice(1));
        if (resolved !== undefined) {
          entries[path] = resolved;
          continue;
        }
      }
      missingLeaves.push(path);
    }

    if (missingLeaves.length > 0) {
      await Promise.all(
        missingLeaves.map(async path => {
          try {
            entries[path] = await getConfig(path, optional.has(path));
          } catch {
            entries[path] = undefined;
          }
        }),
      );
    }

    // Drop stale results if the user switched device scope while this read was in flight.
    if (currentDeviceScopeKey() !== deviceKey) return;
    settingsValues.set(entries);
    await loadSettingsDescriptor([...leafPaths], deviceKey);
    if (currentDeviceScopeKey() !== deviceKey) return;
    settingsLoaded.set(true);
  });
}

/** One field as `get_settings_schema` describes it. */
export interface SettingsFieldDescriptor {
  type?: string;
  nullable?: boolean;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  /** Absent when the config has no value at that path by default. */
  default?: unknown;
  /** Whether the host enforces `type` / `enum` / bounds on write. */
  constrained?: boolean;
}

/** `null` until read; `false` when the host cannot describe its settings. */
export const settingsDescriptor = signal<Record<string, SettingsFieldDescriptor> | false | null>(null);

/** Per-device schema overrides so `SETTINGS_SECTIONS` is never mutated in place. */
const deviceDescriptors = signal<Record<string, Record<string, SettingsFieldDescriptor>>>({});

function descriptorForField(spec: FieldSpec): SettingsFieldDescriptor | undefined {
  const byDevice = deviceDescriptors()[currentDeviceScopeKey()];
  if (byDevice) return byDevice[leafPath(spec)];
  const current = settingsDescriptor();
  return current && typeof current === "object" ? current[leafPath(spec)] : undefined;
}

/**
 * Records host-supplied bounds and defaults per device without mutating the
 * shared `SETTINGS_SECTIONS` table, so switching fleet devices never leaks one
 * device's limits or defaults onto another.
 */
export function applySettingsDescriptor(
  fields: Record<string, SettingsFieldDescriptor>,
  deviceKey: string = currentDeviceScopeKey(),
): void {
  const snapshot: Record<string, SettingsFieldDescriptor> = { ...fields };
  deviceDescriptors.update(current => ({ ...current, [deviceKey]: snapshot }));
  if (deviceKey === currentDeviceScopeKey()) {
    settingsDescriptor.set(snapshot);
  }
}

async function loadSettingsDescriptor(paths: string[], deviceKey: string): Promise<void> {
  try {
    const answer = await invokeSettingsMutation<{ fields?: Record<string, SettingsFieldDescriptor> }>(
      "get_settings_schema",
      { paths },
    );
    if (currentDeviceScopeKey() !== deviceKey) return;
    const fields = answer?.fields && typeof answer.fields === "object" ? answer.fields : {};
    applySettingsDescriptor(fields, deviceKey);
  } catch (error) {
    if (currentDeviceScopeKey() !== deviceKey) return;
    // An older host stores the values but cannot say their limits or defaults;
    // clear any stale descriptor for this device instead of drawing guessed limits.
    deviceDescriptors.update(current => {
      if (!(deviceKey in current)) return current;
      const next = { ...current };
      delete next[deviceKey];
      return next;
    });
    settingsDescriptor.set(false);
    settingsNotice.set(errorText(error));
  }
}

/** The floor a field accepts for the active device (schema override or static spec). */
export function minForField(spec: FieldSpec): number | undefined {
  const described = descriptorForField(spec);
  if (described?.constrained && typeof described.minimum === "number") return described.minimum;
  return spec.min;
}

/** The ceiling a field accepts for the active device (schema override or static spec). */
export function maxForField(spec: FieldSpec): number | undefined {
  const described = descriptorForField(spec);
  if (described?.constrained && typeof described.maximum === "number") return described.maximum;
  return spec.max;
}

/** The fallback default a field uses when unset on the active device. */
export function defaultForField(spec: FieldSpec): string | number | boolean | undefined {
  if (spec.defaultValue !== undefined) return spec.defaultValue;
  const fallback = descriptorForField(spec)?.default;
  if (typeof fallback === "string" || typeof fallback === "number" || typeof fallback === "boolean") {
    return fallback;
  }
  return undefined;
}

/**
 * The host's own refusal of a memory window longer than the retention it runs
 * inside, shown in this surface's language.
 */
function localizedWriteError(error: unknown): string {
  const message = errorText(error);
  if (/rollout age must not exceed/i.test(message)) return tr("settings.notice.memoryWindowRefusal");
  return message;
}

/**
 * Writes one field's leaf path. The row shows that it is saving while the write
 * is in flight, and the outcome goes to the notice of the section that owns it.
 */
export async function writeField(spec: FieldSpec, value: unknown): Promise<boolean> {
  if (leafPath(spec) === "app.language") {
    await writeAppLanguage(String(value ?? ""));
    return true;
  }
  const path = leafPath(spec);
  let ok = false;
  savingFields.update(current => ({ ...current, [spec.id]: true }));
  try {
    await runStep(async () => {
      try {
        if (spec.mutation) {
          // The device applies its own rule and stores the section; the row shows what was asked.
          await invokeSettingsMutation(spec.mutation.command, { [spec.mutation.requestKey]: value });
        } else {
          await setConfig(path, value);
        }
        settingsValues.update(values => ({ ...values, [path]: value }));
        noticeFor(spec, tr("settings.notice.savedField", { label: fieldLabel(spec) }));
        ok = true;
      } catch (error) {
        noticeFor(spec, localizedWriteError(error));
      }
    });
  } finally {
    savingFields.update(current => {
      const next = { ...current };
      delete next[spec.id];
      return next;
    });
  }
  return ok;
}

/**
 * The general application options the desktop sets through product control
 * (`setting.application.general`): launch at login, keep awake and automatic
 * updates. They apply on the host at once (a login item, a power assertion, the
 * updater), which a bare config write does not, so the General page uses the
 * same command the desktop's page does.
 */
export type GeneralControlOption = "launch-at-login" | "prevent-sleep" | "auto-update";

/** `null` until asked; `false` when the host has no product control for this. */
export const generalControlValues = signal<Record<string, unknown> | false | null>(null);
export const generalControlSaving = signal<GeneralControlOption | null>(null);
let generalControlLoading = false;

export function generalControlValue(option: GeneralControlOption): boolean | undefined {
  const values = generalControlValues();
  if (!values) return undefined;
  const value = values[option];
  return typeof value === "boolean" ? value : undefined;
}

export async function loadGeneralControl(force = false): Promise<void> {
  if (generalControlLoading || (!force && generalControlValues() !== null)) return;
  generalControlLoading = true;
  try {
    const result = await invokeCommand<{ currentOptionValues?: Record<string, unknown> }>("product_control_invoke", {
      action: "get",
      capabilityId: "setting.application.general",
    });
    const values = result?.currentOptionValues;
    generalControlValues.set(values && typeof values === "object" ? values : false);
  } catch {
    // An older host, a peer without the command, or the dev fixtures: the page
    // falls back to the config leaves and says what it cannot set.
    generalControlValues.set(false);
  } finally {
    generalControlLoading = false;
  }
}

export async function setGeneralControl(option: GeneralControlOption, value: boolean): Promise<void> {
  generalControlSaving.set(option);
  try {
    await invokeCommand("product_control_invoke", {
      action: "configure",
      capabilityId: "setting.application.general",
      optionId: option,
      value,
    });
    generalControlValues.update(current => (current ? { ...current, [option]: value } : current));
    setSectionNotice("general", tr("settings.notice.savedField", { label: tr(GENERAL_CONTROL_LABELS[option]) }));
  } catch (error) {
    setSectionNotice("general", error instanceof Error ? error.message : String(error));
  } finally {
    generalControlSaving.set(null);
  }
}

export const GENERAL_CONTROL_LABELS: Record<GeneralControlOption, MessageKey> = {
  "launch-at-login": "settings.field.launchAtLogin",
  "prevent-sleep": "settings.field.preventSleep",
  "auto-update": "settings.field.autoUpdate",
};

/** The memory actions the desktop's memory section offers beside its fields. */
export const memoryActionBusy = signal<"open" | "reset" | null>(null);
export const memoryResetPending = signal(false);

/** Shows the memory folder in the host's file manager (`get_memory_paths`). */
export async function openMemoryFolder(): Promise<void> {
  memoryActionBusy.set("open");
  try {
    const paths = await invokeRawCommand<{ memoriesRootDir?: string; memories_root_dir?: string }>(
      "get_memory_paths",
      {},
    );
    const folder = paths?.memoriesRootDir ?? paths?.memories_root_dir ?? "";
    if (!folder) throw new Error(tr("settings.memory.noFolder"));
    await invokeCommand("reveal_in_explorer", { path: folder });
  } catch (error) {
    setSectionNotice("memory", error instanceof Error ? error.message : String(error));
  } finally {
    memoryActionBusy.set(null);
  }
}

/** Clears every stored memory and the extraction state (`reset_memory`); settings stay. */
export async function resetMemory(): Promise<void> {
  memoryResetPending.set(false);
  memoryActionBusy.set("reset");
  try {
    await invokeRawCommand("reset_memory", {});
    setSectionNotice("memory", tr("settings.memory.resetDone"));
  } catch (error) {
    setSectionNotice("memory", error instanceof Error ? error.message : String(error));
  } finally {
    memoryActionBusy.set(null);
  }
}

/** The browsers the host can drive, as `browser_control_list_browsers` lists them. */
export const browserChoices = signal<Array<{ value: string; label: string; installed: boolean }> | null>(null);
let browserChoicesLoadingFor: string | null = null;
let browserChoicesLoadedFor: string | null = null;

export async function loadBrowserChoices(force = false): Promise<void> {
  const deviceKey = currentDeviceScopeKey();
  if (!force && (browserChoicesLoadingFor === deviceKey || (browserChoicesLoadedFor === deviceKey && browserChoices() !== null))) {
    return;
  }
  browserChoicesLoadingFor = deviceKey;
  if (browserChoicesLoadedFor !== deviceKey) {
    browserChoices.set(null);
  }
  try {
    const result = await invokeRawCommand<{ options?: Array<{ value?: string; label?: string; installed?: boolean }> }>(
      "browser_control_list_browsers",
      {},
    );
    if (currentDeviceScopeKey() !== deviceKey) return;
    const options = Array.isArray(result?.options) ? result.options : [];
    browserChoices.set(
      options
        .filter(option => option && typeof option.value === "string" && option.value)
        .map(option => ({
          value: String(option.value),
          label: String(option.label ?? option.value),
          installed: option.installed !== false,
        })),
    );
    browserChoicesLoadedFor = deviceKey;
  } catch {
    if (currentDeviceScopeKey() !== deviceKey) return;
    // A host without browser control offers the system default only.
    browserChoices.set([]);
    browserChoicesLoadedFor = deviceKey;
  } finally {
    if (browserChoicesLoadingFor === deviceKey) {
      browserChoicesLoadingFor = null;
    }
  }
}

function browserOptions(): FieldOption[] {
  void loadBrowserChoices();
  const listed = browserChoices() ?? [];
  const rows: FieldOption[] = listed.map(option => ({
    value: option.value,
    label: option.installed ? option.label : tr("settings.field.browserNotInstalled", { name: option.label }),
  }));
  if (!rows.some(row => row.value === "default")) {
    rows.unshift({ value: "default", label: tr("settings.field.browserDefault") });
  }
  return rows;
}

/** `SpeechModelStatus` (core-types `speech.rs`), camelCase on the wire. */
export interface SpeechModelStatus {
  modelId: string;
  displayName: string;
  description?: string;
  languages?: string[];
  state: "not_installed" | "downloading" | "installed" | "verifying" | "corrupt" | "deleting" | "error" | string;
  installedBytes?: number;
  expectedBytes?: number;
  progress?: { downloadedBytes: number; totalBytes: number; percent: number } | null;
  error?: string | null;
}

/**
 * The local speech models the composer's voice input runs on. They live on the
 * machine this window runs on (`speech_*` is controller-local), so the list is
 * this machine's even while another device is driven.
 * `null` until read; `false` when the host has no speech service.
 */
export const speechModels = signal<SpeechModelStatus[] | false | null>(null);
export const speechNotice = signal("");
let speechLoading = false;
let speechListening = false;

function upsertSpeechModel(status: SpeechModelStatus | null | undefined): void {
  if (!status || typeof status.modelId !== "string") return;
  speechModels.update(current => {
    const list = Array.isArray(current) ? current : [];
    const index = list.findIndex(model => model.modelId === status.modelId);
    if (index < 0) return [...list, status];
    const next = [...list];
    next[index] = { ...next[index], ...status };
    return next;
  });
}

export async function loadSpeechModels(force = false): Promise<void> {
  if (speechLoading || (!force && speechModels() !== null)) return;
  speechLoading = true;
  if (!speechListening) {
    speechListening = true;
    listenEvent<{ status?: SpeechModelStatus }>("speech://model-download-progress", payload =>
      upsertSpeechModel(payload?.status),
    );
    listenEvent<SpeechModelStatus>("speech://model-status-changed", payload => upsertSpeechModel(payload));
  }
  try {
    const result = await invokeRawCommand<{ models?: SpeechModelStatus[] }>("speech_list_models", {});
    speechModels.set(Array.isArray(result?.models) ? result.models : []);
  } catch {
    speechModels.set(false);
  } finally {
    speechLoading = false;
  }
}

export async function downloadSpeechModel(modelId: string): Promise<void> {
  speechNotice.set("");
  upsertSpeechModel({ ...(findSpeechModel(modelId) ?? { modelId, displayName: modelId }), state: "downloading" });
  try {
    const status = await invokeCommand<SpeechModelStatus>("speech_download_model", { modelId });
    upsertSpeechModel(status);
  } catch (error) {
    speechNotice.set(error instanceof Error ? error.message : String(error));
    void loadSpeechModels(true);
  }
}

export async function cancelSpeechModelDownload(modelId: string): Promise<void> {
  try {
    const status = await invokeCommand<SpeechModelStatus>("speech_cancel_model_download", { modelId });
    upsertSpeechModel(status);
  } catch (error) {
    speechNotice.set(error instanceof Error ? error.message : String(error));
  }
}

function findSpeechModel(modelId: string): SpeechModelStatus | undefined {
  const list = speechModels();
  return Array.isArray(list) ? list.find(model => model.modelId === modelId) : undefined;
}

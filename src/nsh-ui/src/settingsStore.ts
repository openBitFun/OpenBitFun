// Settings values and writes.
//
// Reads are per config path, because `get_configs` fails the whole batch when a
// single path is missing on the host. Writes go back through `set_config`: a
// scalar path writes the value, and a field inside an object config reads the
// object, patches the field and writes the object back, which is the shape the
// desktop stores.

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
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
  /** Config path the value lives under. */
  path: string;
  /** Dotted field inside that object; absent when the path itself is the value. */
  field?: string;
  kind: FieldKind;
  options?: FieldOption[];
  min?: number;
  max?: number;
  /**
   * A ceiling another stored value sets, such as a rollout window that cannot
   * outlive the retention it runs inside. Read at write time, so raising the
   * retention first is what makes a larger window legal.
   */
  maxPath?: { path: string; field?: string };
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
}

export interface SettingsSection {
  id: string;
  title: string;
  titleKey?: MessageKey;
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
    id: "general",
    title: "Application",
    titleKey: "settings.section.general",
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
      },
      {
        id: "notify-dialog-completion",
        label: "Notify when a dialog turn finishes",
        labelKey: "settings.field.notifyDialogCompletion",
        descriptionKey: "settings.field.notifyDialogCompletionDesc",
        path: "app.notifications.dialog_completion_notify",
        kind: "boolean",
        optional: true,
      },
      {
        id: "notify-permission-request",
        label: "Notify on permission requests",
        labelKey: "settings.field.notifyPermissionRequest",
        descriptionKey: "settings.field.notifyPermissionRequestDesc",
        path: "app.notifications.permission_request_notify",
        kind: "boolean",
        optional: true,
      },
      {
        id: "auto-update",
        label: "Check for updates automatically",
        labelKey: "settings.field.autoUpdate",
        descriptionKey: "settings.field.autoUpdateDesc",
        path: "app",
        field: "auto_update",
        kind: "boolean",
        optional: true,
      },
      {
        id: "telemetry",
        label: "Send usage telemetry",
        labelKey: "settings.field.telemetry",
        descriptionKey: "settings.field.telemetryDesc",
        path: "app",
        field: "telemetry",
        kind: "boolean",
        optional: true,
      },
      {
        id: "confirm-on-exit",
        label: "Confirm before quitting",
        labelKey: "settings.field.confirmOnExit",
        descriptionKey: "settings.field.confirmOnExitDesc",
        path: "app",
        field: "confirm_on_exit",
        kind: "boolean",
        optional: true,
      },
      {
        id: "restore-windows",
        label: "Restore windows at launch",
        labelKey: "settings.field.restoreWindows",
        descriptionKey: "settings.field.restoreWindowsDesc",
        path: "app",
        field: "restore_windows",
        kind: "boolean",
        optional: true,
      },
      // A leaf path, so a toggle writes that one value instead of the whole object.
      {
        id: "prevent-sleep",
        label: "Keep the computer awake",
        labelKey: "settings.field.preventSleep",
        descriptionKey: "settings.field.preventSleepDesc",
        path: "app.prevent_sleep",
        kind: "boolean",
        optional: true,
        defaultValue: false,
      },
    ],
  },
  {
    id: "input",
    title: "Input",
    titleKey: "settings.section.input",
    fields: [
      // Leaf paths throughout: `app.flow_chat` and `app.ai_experience` hold values
      // this surface does not draw, so a whole-object write would drop them.
      {
        id: "selection-toolbar",
        label: "Show excerpt actions after selecting text",
        labelKey: "settings.field.selectionToolbar",
        descriptionKey: "settings.field.selectionToolbarDesc",
        path: "app.flow_chat.auto_show_selection_toolbar",
        kind: "boolean",
        optional: true,
        defaultValue: true,
      },
      {
        id: "voice-input",
        label: "Voice input in the composer",
        labelKey: "settings.field.voiceInput",
        path: "app.ai_experience.voice_input.enabled",
        kind: "boolean",
        optional: true,
        defaultValue: true,
        hint: "Runs on this machine through the host's speech service",
        hintKey: "settings.field.voiceInputHint",
      },
      {
        id: "voice-language",
        label: "Voice language",
        labelKey: "settings.field.voiceLanguage",
        path: "app.ai_experience.voice_input.default_language",
        kind: "text",
        optional: true,
        defaultValue: "auto",
        placeholder: "auto, zh-CN, en-US",
        placeholderKey: "settings.placeholder.voiceLanguage",
        hint: "auto follows the language you speak",
        hintKey: "settings.field.voiceLanguageHint",
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
        defaultValue: 60,
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
        defaultValue: "",
        placeholder: "Default microphone",
        placeholderKey: "settings.placeholder.voiceMicrophone",
        hint: "Empty uses the system default input",
        hintKey: "settings.field.voiceMicrophoneHint",
      },
    ],
  },
  {
    id: "ai-experience",
    title: "AI experience",
    titleKey: "settings.section.aiExperience",
    fields: [
      {
        id: "session-title-generation",
        label: "Let the model name new sessions",
        labelKey: "settings.field.sessionTitleGeneration",
        descriptionKey: "settings.field.sessionTitleGenerationDesc",
        path: "app.ai_experience",
        field: "enable_session_title_generation",
        kind: "boolean",
        optional: true,
      },
      {
        id: "workspace-search",
        label: "Accelerated workspace search",
        labelKey: "settings.field.workspaceSearch",
        descriptionKey: "settings.field.workspaceSearchDesc",
        path: "app.ai_experience",
        field: "enable_workspace_search",
        kind: "boolean",
        optional: true,
      },
      {
        // A leaf path: `app.ai_experience` also holds the quick-action list, and
        // this switch has no reason to read-modify-write that whole object.
        id: "commit-coauthor",
        label: "Attribute commits to OpenBitFun",
        labelKey: "settings.field.commitCoauthor",
        path: "app.ai_experience.enable_git_commit_coauthor",
        kind: "boolean",
        optional: true,
        defaultValue: true,
        hint: "Adds the co-author trailer the desktop uses to generated commit messages",
        hintKey: "settings.field.commitCoauthorHint",
      },
    ],
  },
  {
    id: "editor",
    title: "Editor",
    titleKey: "settings.section.editor",
    fields: [
      {
        id: "editor-font-size",
        label: "Font size",
        labelKey: "settings.field.editorFontSize",
        descriptionKey: "settings.field.editorFontSizeDesc",
        path: "editor",
        field: "font_size",
        kind: "number",
        min: 10,
        max: 24,
        placeholder: "14 (10–24)",
        placeholderKey: "settings.placeholder.editorFontSize",
        unit: "px",
        unitKey: "settings.unit.px",
      },
      {
        id: "editor-tab-size",
        label: "Tab size",
        labelKey: "settings.field.editorTabSize",
        descriptionKey: "settings.field.editorTabSizeDesc",
        path: "editor",
        field: "tab_size",
        kind: "number",
        min: 1,
        max: 8,
        placeholder: "4 (1–8)",
        placeholderKey: "settings.placeholder.editorTabSize",
        unit: "spaces",
        unitKey: "settings.unit.spaces",
      },
      {
        id: "editor-word-wrap",
        label: "Word wrap",
        labelKey: "settings.field.editorWordWrap",
        descriptionKey: "settings.field.editorWordWrapDesc",
        path: "editor",
        field: "word_wrap",
        kind: "select",
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
        path: "editor",
        field: "line_numbers",
        kind: "select",
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
        path: "editor",
        field: "minimap.enabled",
        kind: "boolean",
      },
    ],
  },
  {
    id: "terminal",
    title: "Terminal",
    titleKey: "settings.section.terminal",
    fields: [
      {
        id: "terminal-font-size",
        label: "Font size",
        labelKey: "settings.field.terminalFontSize",
        descriptionKey: "settings.field.terminalFontSizeDesc",
        path: "terminal",
        field: "font_size",
        kind: "number",
        min: 10,
        max: 24,
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
        path: "terminal",
        field: "scrollback",
        kind: "number",
        min: 100,
        max: 100000,
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
        path: "terminal",
        field: "cursor_style",
        kind: "select",
        options: [
          { value: "block", label: "Block", labelKey: "settings.opt.block" },
          { value: "line", label: "Line", labelKey: "settings.opt.line" },
          { value: "bar", label: "Bar", labelKey: "settings.opt.bar" },
        ],
      },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    titleKey: "settings.section.workspace",
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
        defaultValue: "~/.openbitfun/worktrees",
        placeholder: "~/.openbitfun/worktrees",
        placeholderKey: "settings.placeholder.worktreeRoot",
      },
      {
        id: "worktree-branch-prefix",
        label: "Worktree branch prefix",
        labelKey: "settings.field.worktreeBranchPrefix",
        descriptionKey: "settings.field.worktreeBranchPrefixDesc",
        path: "app.worktrees.branchPrefix",
        kind: "text",
        optional: true,
        defaultValue: "openbitfun/",
        placeholder: "openbitfun/",
        placeholderKey: "settings.placeholder.worktreeBranchPrefix",
      },
      {
        id: "worktree-copy-changes",
        label: "Copy local changes into a new worktree",
        labelKey: "settings.field.worktreeCopyChanges",
        descriptionKey: "settings.field.worktreeCopyChangesDesc",
        path: "app.worktrees.copyLocalChanges",
        kind: "boolean",
        optional: true,
        defaultValue: false,
      },
      {
        id: "worktree-auto-delete",
        label: "Delete old worktrees automatically",
        labelKey: "settings.field.worktreeAutoDelete",
        descriptionKey: "settings.field.worktreeAutoDeleteDesc",
        path: "app.worktrees.autoDeleteEnabled",
        kind: "boolean",
        optional: true,
        defaultValue: true,
      },
      {
        id: "worktree-auto-delete-limit",
        label: "Worktrees to keep",
        labelKey: "settings.field.worktreeAutoDeleteLimit",
        descriptionKey: "settings.field.worktreeAutoDeleteLimitDesc",
        path: "app.worktrees.autoDeleteLimit",
        kind: "number",
        min: 0,
        max: 100,
        optional: true,
        defaultValue: 15,
        placeholder: "15 (0–100)",
        placeholderKey: "settings.placeholder.worktreeAutoDeleteLimit",
        unit: "items",
        unitKey: "settings.unit.count",
      },
    ],
  },
  {
    id: "ai-execution",
    title: "AI execution",
    titleKey: "settings.section.aiExecution",
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
        min: 1,
        max: 64,
        optional: true,
        placeholder: "4 (1–64)",
        placeholderKey: "settings.placeholder.subagentConcurrency",
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
        min: 1,
        max: 64,
        optional: true,
        placeholder: "4 (1–64)",
        placeholderKey: "settings.placeholder.swarmConcurrency",
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
        id: "tool-execution-timeout",
        label: "Tool timeout (s)",
        labelKey: "settings.field.toolExecutionTimeout",
        descriptionKey: "settings.field.toolExecutionTimeoutDesc",
        path: "ai.tool_execution_timeout_secs",
        kind: "number",
        min: 10,
        max: 3600,
        optional: true,
        placeholder: "120 (10–3600)",
        placeholderKey: "settings.placeholder.toolExecutionTimeout",
        unit: "s",
        unitKey: "settings.unit.seconds",
      },
      {
        id: "user-question-timeout",
        label: "Waiting for an answer (s)",
        labelKey: "settings.field.userQuestionTimeout",
        descriptionKey: "settings.field.userQuestionTimeoutDesc",
        path: "ai.user_question_timeout_secs",
        kind: "number",
        min: 10,
        max: 3600,
        optional: true,
        placeholder: "300 (10–3600)",
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
    id: "diagnostics",
    title: "Diagnostics",
    titleKey: "settings.section.diagnostics",
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
      },
      {
        id: "logging-sensitive",
        label: "Include sensitive payloads in diagnostics",
        labelKey: "settings.field.loggingSensitive",
        descriptionKey: "settings.field.loggingSensitiveDesc",
        path: "app.logging.include_sensitive_diagnostics",
        kind: "boolean",
        optional: true,
        defaultValue: false,
      },
    ],
  },
  {
    id: "memory",
    title: "Session memory",
    titleKey: "settings.section.memory",
    fields: [
      {
        id: "generate-memories",
        label: "Extract memories from sessions",
        labelKey: "settings.field.generateMemories",
        descriptionKey: "settings.field.generateMemoriesDesc",
        path: "memories.generate_memories",
        kind: "boolean",
        defaultValue: true,
        optional: true,
      },
      {
        id: "use-memories",
        label: "Include memories in prompts",
        labelKey: "settings.field.useMemories",
        descriptionKey: "settings.field.useMemoriesDesc",
        path: "memories.use_memories",
        kind: "boolean",
        defaultValue: true,
        optional: true,
      },
      {
        id: "memory-btw-sessions",
        label: "Learn from background sessions",
        labelKey: "settings.field.memoryBtwSessions",
        descriptionKey: "settings.field.memoryBtwSessionsDesc",
        path: "memories.generate_for_btw_sessions",
        kind: "boolean",
        defaultValue: false,
        optional: true,
      },
      {
        id: "memory-external-context",
        label: "Sessions that used external context",
        labelKey: "settings.field.memoryExternalContext",
        descriptionKey: "settings.field.memoryExternalContextDesc",
        path: "memories.external_context_policy",
        kind: "select",
        defaultValue: "clear_tool_results",
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
        path: "memories",
        field: "extract_model",
        kind: "model",
        emptyLabel: "Follow the primary model",
        emptyLabelKey: "settings.field.memoryExtractModelEmpty",
        optional: true,
      },
      {
        id: "memory-consolidation-model",
        label: "Model that consolidates memories",
        labelKey: "settings.field.memoryConsolidationModel",
        descriptionKey: "settings.field.memoryConsolidationModelDesc",
        path: "memories",
        field: "consolidation_model",
        kind: "model",
        emptyLabel: "Follow the extraction model",
        emptyLabelKey: "settings.field.memoryConsolidationModelEmpty",
        optional: true,
      },
      {
        id: "memory-idle-hours",
        label: "A session must be idle for (hours)",
        labelKey: "settings.field.memoryIdleHours",
        descriptionKey: "settings.field.memoryIdleHoursDesc",
        path: "memories",
        field: "min_rollout_idle_hours",
        kind: "number",
        min: 1,
        max: 48,
        defaultValue: 6,
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
        path: "memories",
        field: "max_rollout_age_days",
        kind: "number",
        min: 0,
        max: 3650,
        // The desktop caps this at the retention window, because a rollout that
        // outlived the memory it produced would extract into a deleted window.
        maxPath: { path: "memories", field: "max_unused_days" },
        defaultValue: 10,
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
        path: "memories",
        field: "max_rollouts_per_startup",
        kind: "number",
        min: 1,
        max: 128,
        defaultValue: 5,
        placeholder: "5 (1–128)",
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
        path: "memories",
        field: "max_rollouts_scan_limit",
        kind: "number",
        min: 1,
        max: 50000,
        defaultValue: 2000,
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
        path: "memories",
        field: "phase1_max_concurrency",
        kind: "number",
        min: 1,
        max: 16,
        defaultValue: 1,
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
    title: "Tools",
    titleKey: "settings.section.tools",
    fields: [
      {
        id: "computer-use",
        label: "Allow computer use",
        labelKey: "settings.field.computerUse",
        path: "ai.computer_use_enabled",
        kind: "boolean",
        defaultValue: true,
        hint: "The host still asks for its own system consent",
        hintKey: "settings.field.computerUseHint",
        optional: true,
      },
      {
        id: "browser-control-auto-connect",
        label: "Reattach the browser at launch",
        labelKey: "settings.field.browserControlAutoConnect",
        path: "ai.browser_control_auto_connect_on_startup",
        kind: "boolean",
        defaultValue: false,
        hint: "The browser forgets its approval when it restarts",
        hintKey: "settings.field.browserControlAutoConnectHint",
        optional: true,
      },
      {
        id: "preferred-browser",
        label: "Preferred browser",
        labelKey: "settings.field.preferredBrowser",
        path: "ai.browser_control_preferred_browser",
        kind: "text",
        defaultValue: "",
        placeholder: "e.g. Chrome, Edge",
        placeholderKey: "settings.placeholder.preferredBrowser",
        hint: "Empty uses the system default",
        hintKey: "settings.field.preferredBrowserHint",
        optional: true,
      },
    ],
  },
  {
    id: "agent-hooks",
    title: "Agent hooks",
    titleKey: "settings.section.agentHooks",
    fields: [
      {
        id: "hooks-enabled",
        label: "Run native agent hooks",
        labelKey: "settings.field.hooksEnabled",
        descriptionKey: "settings.field.hooksEnabledDesc",
        path: "app.hooks.enabled",
        kind: "boolean",
        defaultValue: false,
        optional: true,
      },
      {
        id: "hooks-project",
        label: "Honor project hook files",
        labelKey: "settings.field.hooksProject",
        path: "app.hooks.project_hooks_enabled",
        kind: "boolean",
        defaultValue: false,
        hint: "A project hook file runs commands from the checked-out repository",
        hintKey: "settings.field.hooksProjectHint",
        optional: true,
      },
    ],
  },
];

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
  if (spec.defaultValue !== undefined && spec.defaultValue !== "") {
    return String(spec.defaultValue);
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
export const settingsNotice = signal("");

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

function readField(source: unknown, field: string | undefined): unknown {
  if (!field) return source;
  let current: unknown = source;
  for (const segment of field.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function patchObject(source: Record<string, unknown>, field: string, value: unknown): Record<string, unknown> {
  const segments = field.split(".");
  const next: Record<string, unknown> = { ...source };
  let node = next;
  for (const segment of segments.slice(0, -1)) {
    const child = node[segment];
    node[segment] = child && typeof child === "object" ? { ...(child as Record<string, unknown>) } : {};
    node = node[segment] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
  return next;
}

/** The current value of a field, or `undefined` when the host lacks it. */
export function fieldValue(spec: FieldSpec): unknown {
  const source = settingsValues()[spec.path];
  return readField(source, spec.field);
}

/** Whether the host stores no value for this field at all. */
export function fieldMissing(spec: FieldSpec): boolean {
  return fieldValue(spec) === undefined;
}

/** What the row shows: the stored value, or the default the host applies instead. */
export function fieldDisplay(spec: FieldSpec): unknown {
  const stored = fieldValue(spec);
  return stored === undefined ? spec.defaultValue : stored;
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
    await setAppLocale(canonical, { persistHost: true });
    settingsNotice.set(tr("settings.notice.languageSaved", { label: localeMeta(canonical).nativeName }));
  });
}

export async function loadSettingsValues(): Promise<void> {
  const paths = new Set<string>(["app"]);
  for (const section of SETTINGS_SECTIONS) {
    for (const field of section.fields) paths.add(field.path);
  }
  const optional = new Set<string>();
  for (const section of SETTINGS_SECTIONS) {
    for (const field of section.fields) if (field.optional) optional.add(field.path);
  }
  await runStep(async () => {
    const entries: Record<string, unknown> = {};
    await Promise.all(
      [...paths].map(async path => {
        try {
          entries[path] = await getConfig(path, optional.has(path));
        } catch {
          entries[path] = undefined;
        }
      }),
    );
    settingsValues.set(entries);
    settingsLoaded.set(true);
  });
}

/**
 * The ceiling a field actually accepts: a stored sibling value can lower the
 * spec's own maximum, as the rollout window is capped by the retention it runs
 * inside.
 */
export function maxForField(spec: FieldSpec): number | undefined {
  const own = spec.max ?? Number.POSITIVE_INFINITY;
  if (!spec.maxPath) return spec.max;
  const document = settingsValues()[spec.maxPath.path];
  const base = document && typeof document === "object" ? (document as Record<string, unknown>) : {};
  const sibling = Number(spec.maxPath.field ? base[spec.maxPath.field] : document);
  return Number.isFinite(sibling) ? Math.min(own, sibling) : spec.max;
}

/**
 * The check the desktop's own memory page makes before it writes: a rollout
 * window that reaches past the retention it extracts into would produce memories
 * that are deleted on arrival, so the host refuses it and so does this page.
 *
 * The two values are read from the stored document, with the leaf paths as a
 * fallback, because this page reaches one of them through the document and the
 * other through its own config path.
 */
function memoryWindowRefusal(spec: FieldSpec, value: unknown): string | null {
  const field =
    spec.path === "memories"
      ? spec.field
      : spec.path === "memories.max_unused_days"
        ? "max_unused_days"
        : undefined;
  if (field !== "max_unused_days" && field !== "max_rollout_age_days") return null;
  const document = settingsValues()["memories"];
  const base = document && typeof document === "object" ? (document as Record<string, unknown>) : {};
  const stored = (name: string): unknown => base[name] ?? settingsValues()[`memories.${name}`];
  const age = Number(field === "max_rollout_age_days" ? value : stored("max_rollout_age_days"));
  const unused = Number(field === "max_unused_days" ? value : stored("max_unused_days"));
  if (!Number.isFinite(age) || !Number.isFinite(unused)) return null;
  if (age > unused) {
    return tr("settings.notice.memoryWindowRefusal");
  }
  return null;
}

export async function writeField(spec: FieldSpec, value: unknown): Promise<void> {
  if ((spec.path === "app" && spec.field === "language") || spec.path === "app.language") {
    await writeAppLanguage(String(value ?? ""));
    return;
  }
  const refusal = memoryWindowRefusal(spec, value);
  if (refusal) {
    settingsNotice.set(refusal);
    return;
  }
  await runStep(async () => {
    const current = settingsValues()[spec.path];
    let next: unknown = value;
    if (spec.field) {
      const base = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
      next = patchObject(base, spec.field, value);
    }
    await setConfig(spec.path, next);
    settingsValues.update(values => ({ ...values, [spec.path]: next }));
    settingsNotice.set(tr("settings.notice.savedField", { label: fieldLabel(spec) }));
  });
}

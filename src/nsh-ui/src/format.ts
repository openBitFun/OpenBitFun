/** Text, date, duration, and count helpers shared by the scenes. */

import type { TranscriptItemView, TranscriptToolView, TranscriptTurnView } from "./api";
import { currentLocale, tr, type AppLocale, type MessageKey } from "./i18n";

/**
 * Readers over the host's transcript view (`get_session_transcript_view`).
 *
 * The host projects persisted turns once for every client: the user's message as
 * written, then thinking, answer text and tool calls in the order they happened,
 * subagent work nested under the call that started it. These helpers only pick
 * what a scene draws from that view; they never re-order, filter or infer.
 */
function viewOf(turn: unknown): TranscriptTurnView | null {
  if (!turn || typeof turn !== "object") return null;
  const record = turn as Partial<TranscriptTurnView>;
  return Array.isArray(record.items) && record.user && typeof record.user === "object"
    ? (record as TranscriptTurnView)
    : null;
}

/** A short summary of what a turn said (its user and answer text, not its reasoning). */
export function turnToText(turn: unknown, limit = 400): string {
  const parts = turnParts(turn).filter(part => part.role !== "thinking");
  const text = parts
    .map(part => part.text.replace(/\uE200visualize\uE202[\s\S]*?\uE201/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export interface TurnPart {
  role: "user" | "assistant" | "other" | "thinking";
  text: string;
  /** What a thinking block is, when the host said: reasoning, or a summary of it. */
  reasoningKind?: "reasoning" | "summary";
}

/** The readable parts of one turn, in the view's order: the user, then thinking and answers. */
export function turnParts(turn: unknown): TurnPart[] {
  const view = viewOf(turn);
  if (!view) return [];
  const parts: TurnPart[] = [];
  if (view.user.text.trim()) parts.push({ role: "user", text: view.user.text });
  for (const item of view.items) {
    if (item.kind === "thinking" && item.text.trim()) {
      parts.push({ role: "thinking", text: item.text, ...(item.reasoningKind ? { reasoningKind: item.reasoningKind } : {}) });
    } else if (item.kind === "text" && item.text.trim()) {
      parts.push({ role: "assistant", text: item.text });
    }
  }
  return parts;
}

/** One tool invocation a turn made, ready for a card. */
export interface ToolCallView {
  id?: string;
  name: string;
  detail: string;
  /** The arguments as they were, so a card can read the ones it understands. */
  input?: unknown;
  /** Persisted execution status (e.g. `completed`, `error`, `running`, `cancelled`). */
  status?: string;
  /** Whether the tool succeeded, when a `toolResult` is present. */
  success?: boolean;
  /** Error message returned by a failed tool call. */
  error?: string;
  /** Tool execution result payload, when persisted. */
  result?: unknown;
  /** What the model was told the result was, when the host kept it apart. */
  resultForAssistant?: string;
  /** `result` is a preview; `detailTurn` is where it is read whole from. */
  detailOmitted?: boolean;
  detailTurn?: TranscriptTurnView;
  /** What the host counted from the whole input of an edit or write. */
  diffStats?: { added: number; removed: number };
  /** Tool execution duration in milliseconds, when persisted. */
  durationMs?: number;
  /** What a subagent the call started did, as the host nested it. */
  subagentItems?: TranscriptItemView[];
  /** A GenerativeUI call's source as it streamed (`GenUIStream`), before its arguments closed. */
  genuiStream?: { source: string; title?: string; format: string };
}

function summarizeInput(value: unknown, limit = 160): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > limit ? `${value.slice(0, limit)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") {
    // Build a bounded preview without `JSON.stringify`-ing multi-kilobyte file
    // contents or nested payloads for every collapsed tool card on mount.
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    let total = 0;
    for (const key of Object.keys(record)) {
      const entry = record[key];
      let rendered: string;
      if (typeof entry === "string") {
        const snippet = entry.length > 80 ? `${entry.slice(0, 80)}…` : entry;
        rendered = `${key}: ${snippet}`;
      } else if (typeof entry === "number" || typeof entry === "boolean") {
        rendered = `${key}: ${entry}`;
      } else if (entry === null || entry === undefined) {
        continue;
      } else if (Array.isArray(entry)) {
        rendered = `${key}: [${entry.length}]`;
      } else {
        rendered = `${key}: {…}`;
      }
      parts.push(rendered);
      total += rendered.length + 2;
      if (total >= limit || parts.length >= 4) break;
    }
    const joined = parts.join(", ");
    return joined.length > limit ? `${joined.slice(0, limit)}…` : joined;
  }
  return "";
}

/** A tool item of the view as a card reads it. */
export function toolCallOf(tool: TranscriptToolView, turn?: TranscriptTurnView): ToolCallView {
  const preview = typeof tool.inputPreview === "string" && tool.inputPreview.trim() ? tool.inputPreview.trim() : "";
  return {
    ...(tool.id ? { id: tool.id } : {}),
    name: tool.name,
    detail: preview || summarizeInput(tool.input),
    ...(tool.input === undefined || tool.input === null ? {} : { input: tool.input }),
    ...(tool.status ? { status: tool.status } : {}),
    ...(typeof tool.success === "boolean" ? { success: tool.success } : {}),
    ...(tool.error ? { error: tool.error } : {}),
    ...(tool.result === undefined || tool.result === null ? {} : { result: tool.result }),
    ...(tool.resultForAssistant ? { resultForAssistant: tool.resultForAssistant } : {}),
    ...(tool.detailOmitted && turn ? { detailOmitted: true, detailTurn: turn } : {}),
    ...(tool.diffStats ? { diffStats: tool.diffStats } : {}),
    ...(typeof tool.durationMs === "number" ? { durationMs: tool.durationMs } : {}),
    ...(tool.subagentItems?.length ? { subagentItems: tool.subagentItems } : {}),
  };
}

/** The tool calls a turn made, in order. */
export function toolCallsOf(turn: unknown): ToolCallView[] {
  const view = viewOf(turn);
  if (!view) return [];
  return view.items.flatMap(item => (item.kind === "tool" ? [toolCallOf(item.tool)] : []));
}

/**
 * One non-text process step that can fold into a collapsed activity group: a
 * reasoning block or a tool call, kept in chronological order.
 */
export type FoldedProcessItem =
  | {
      kind: "thinking";
      key: string;
      text: string;
      reasoningKind?: "reasoning" | "summary";
      live?: boolean;
      /** Set for live rounds so collapsed groups read streaming text lazily on expand. */
      roundId?: string;
    }
  | { kind: "tool"; key: string; call: ToolCallView };

/**
 * One thing a reader sees in a turn, in the order it happened: a stretch of the
 * answer, a block of reasoning, a tool call, or a run of consecutive non-text
 * items (thinking and tool calls) folded into one collapsible row.
 */
export type TranscriptItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string; reasoningKind?: "reasoning" | "summary"; live?: boolean; roundId?: string }
  | { kind: "tool"; key: string; call: ToolCallView }
  | { kind: "explore"; key: string; items: FoldedProcessItem[]; calls: ToolCallView[] };

/**
 * The turn's items as the transcript draws them. Keys are the host's item ids,
 * so a re-read never remounts an opened card; a thinking block keeps its
 * turn-plus-index key so its disclosure stays bounded and stable.
 */
export function turnItems(turn: unknown): TranscriptItem[] {
  const view = viewOf(turn);
  if (!view) return [];
  const cached = turnItemsCache.get(view);
  if (cached) return cached;
  const items = readTurnItems(view);
  turnItemsCache.set(view, items);
  return items;
}

/**
 * A turn the host answered is replaced, never edited, so what it draws is read
 * once: a long transcript re-projects on every page of older turns.
 */
const turnItemsCache = new WeakMap<TranscriptTurnView, TranscriptItem[]>();

function readTurnItems(view: TranscriptTurnView): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (let index = 0; index < view.items.length; index += 1) {
    const item = view.items[index]!;
    if (item.kind === "text") {
      if (!item.text.trim()) continue;
      items.push({ kind: "text", key: `text:${item.id || `${view.turnId}-${index}`}`, text: item.text });
      continue;
    }
    if (item.kind === "thinking") {
      if (!item.text.trim()) continue;
      items.push({
        kind: "thinking",
        key: `${view.turnId}|thinking|${index}`,
        text: item.text,
        ...(item.reasoningKind ? { reasoningKind: item.reasoningKind } : {}),
      });
      continue;
    }
    const call = toolCallOf(item.tool, view);
    items.push({ kind: "tool", key: `tool:${item.tool.id || `${view.turnId}-${index}-${item.tool.name}`}`, call });
  }
  return groupExploreItems(items);
}

/** The tool names that only look around: reading, searching and listing. */
export function isExploreTool(name: string): boolean {
  const lower = name.toLowerCase().replace(/[^a-z]/g, "");
  return (
    lower === "read" ||
    lower === "readfile" ||
    lower === "grep" ||
    lower === "glob" ||
    lower === "ls" ||
    lower === "listdir" ||
    lower === "listdirectory" ||
    lower === "findfiles" ||
    lower === "searchfiles" ||
    lower === "codebasesearch" ||
    lower === "websearch" ||
    lower === "webfetch" ||
    lower === "viewimage"
  );
}

const NON_FOLDABLE_TOOL_NAMES = new Set(["GenerativeUI", "generative_ui", "GenUI"]);

/**
 * Whether a tool call can join a collapsed non-text activity run. GenerativeUI
 * surfaces, failed/rejected calls, and tools awaiting user confirmation stay
 * visible at top level so errors and user-facing actions are never hidden.
 */
export function isFoldableToolCall(call: ToolCallView): boolean {
  if (NON_FOLDABLE_TOOL_NAMES.has(call.name)) return false;
  const status = (call.status ?? "").toLowerCase();
  if (
    Boolean(call.error) ||
    call.success === false ||
    status === "failed" ||
    status === "error" ||
    status === "rejected" ||
    status === "confirmation" ||
    status === "awaiting_confirmation"
  ) {
    return false;
  }
  const normalized = call.name.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "askuserquestion" && (status === "running" || status === "waiting" || status === "in_progress")) {
    return false;
  }
  return true;
}

/**
 * Folds two or more consecutive non-text items (thinking blocks and foldable
 * tool calls, with no visible text between them) into one collapsed group row.
 * Failed/rejected calls, pending approvals, and GenerativeUI cards break the
 * run and remain visible on their own.
 */
export function groupExploreItems(items: TranscriptItem[]): TranscriptItem[] {
  const grouped: TranscriptItem[] = [];
  let run: FoldedProcessItem[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const firstTool = run.find(entry => entry.kind === "tool");
      const calls = run.flatMap(entry => (entry.kind === "tool" ? [entry.call] : []));
      grouped.push({
        kind: "explore",
        key: `explore:${(firstTool ?? run[0]!).key}`,
        items: run,
        calls,
      });
    } else {
      grouped.push(...run);
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === "thinking") {
      run.push(item);
      continue;
    }
    if (item.kind === "tool" && isFoldableToolCall(item.call)) {
      run.push(item);
      continue;
    }
    if (item.kind === "explore") {
      run.push(...item.items);
      continue;
    }
    flush();
    grouped.push(item);
  }
  flush();
  return grouped;
}

/** Counts what an explore group did: files read and searches run. */
export function exploreCounts(calls: ToolCallView[]): { reads: number; searches: number } {
  let reads = 0;
  let searches = 0;
  for (const call of calls) {
    const lower = call.name.toLowerCase();
    if (lower.includes("read")) reads += 1;
    else searches += 1;
  }
  return { reads, searches };
}

export interface ActivityCounts {
  reads: number;
  searches: number;
  commands: number;
  edits: number;
  otherTools: number;
  thinkings: number;
  totalTools: number;
}

const READ_TOOL_NAMES = new Set(["read", "readfile", "webfetch", "viewimage"]);
const SEARCH_TOOL_NAMES = new Set(["grep", "glob", "ls", "listdir", "listdirectory", "findfiles", "searchfiles", "codebasesearch", "websearch"]);
const COMMAND_TOOL_NAMES = new Set(["bash", "execcommand", "runcode", "runcommand", "shell", "exec", "terminal", "writestdin", "execcontrol"]);
const EDIT_TOOL_NAMES = new Set(["edit", "editfile", "multiedit", "strreplace", "strreplaceeditor", "searchreplace", "applypatch", "write", "writefile", "createfile", "delete", "deletefile"]);

/** Breaks down a folded non-text activity group by operation category. */
export function activityCounts(items: readonly FoldedProcessItem[]): ActivityCounts {
  let reads = 0;
  let searches = 0;
  let commands = 0;
  let edits = 0;
  let otherTools = 0;
  let thinkings = 0;
  for (const item of items) {
    if (item.kind === "thinking") {
      thinkings += 1;
      continue;
    }
    const call = item.call;
    if (call.name.startsWith("mcp__")) {
      otherTools += 1;
      continue;
    }
    const normalized = call.name.toLowerCase().replace(/[^a-z]/g, "");
    if (READ_TOOL_NAMES.has(normalized)) reads += 1;
    else if (SEARCH_TOOL_NAMES.has(normalized)) searches += 1;
    else if (COMMAND_TOOL_NAMES.has(normalized)) commands += 1;
    else if (EDIT_TOOL_NAMES.has(normalized)) edits += 1;
    else if (diffOf(call.input) !== null) edits += 1;
    else if (commandOf(call.input)) commands += 1;
    else otherTools += 1;
  }
  return {
    reads,
    searches,
    commands,
    edits,
    otherTools,
    thinkings,
    totalTools: reads + searches + commands + edits + otherTools,
  };
}

/** Why a persisted turn did not finish, when the host recorded it. */
export interface TurnFailure {
  message: string;
  status: string;
  detail?: Record<string, unknown>;
}

export function turnFailureOf(turn: unknown): TurnFailure | null {
  const view = viewOf(turn);
  if (!view) return null;
  const error = (view.error ?? "").trim();
  const failed = view.status === "failed";
  const cancelled = view.status === "cancelled";
  if (!error && !failed && !cancelled) return null;
  return {
    message: error,
    status: failed || (error && !cancelled) ? "failed" : view.status,
    ...(view.errorDetail ? { detail: view.errorDetail } : {}),
  };
}

/** The model the turn's last round ran on, as the host recorded it. */
export function turnEffectiveModel(turn: unknown): string | null {
  return viewOf(turn)?.effectiveModel?.trim() || null;
}

/** The turn's duration in milliseconds, as the host recorded or summed it. */
export function turnDurationMs(turn: unknown): number | null {
  const duration = viewOf(turn)?.durationMs;
  return typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/** True when the turn holds any answer, reasoning or tool call. */
export function turnHasAssistantContent(turn: unknown): boolean {
  return (viewOf(turn)?.items.length ?? 0) > 0;
}

/** A checklist item a tool call carries (a todo list or a plan). */
export interface TodoCardItem {
  text: string;
  state: "done" | "active" | "pending";
}

const TODO_LIST_KEYS = ["todos", "plan", "items", "steps", "tasks"];
const TODO_TEXT_KEYS = ["content", "text", "title", "step", "task", "description", "subject"];
const DONE_STATES = new Set(["completed", "complete", "done", "finished", "closed"]);
const ACTIVE_STATES = new Set(["in_progress", "in-progress", "active", "running", "current", "started"]);

/**
 * The checklist a tool call's arguments describe, if they describe one. Tool
 * names differ between agents, so the shape decides: a list of items that each
 * carry text and a state is a checklist wherever it sits in the arguments.
 */
export function todosOf(input: unknown): TodoCardItem[] {
  const lists = findTodoLists(input, 0);
  if (!lists.length) return [];
  // The longest list is the plan; a nested one is usually part of it.
  const list = lists.reduce((best, current) => (current.length > best.length ? current : best), lists[0]);
  return list;
}

function findTodoLists(value: unknown, depth: number): TodoCardItem[][] {
  if (depth > 3 || !value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const found: TodoCardItem[][] = [];
  for (const key of TODO_LIST_KEYS) {
    const candidate = record[key];
    if (!Array.isArray(candidate)) continue;
    const items: TodoCardItem[] = [];
    for (const entry of candidate) {
      const item = todoItemOf(entry);
      if (item) items.push(item);
    }
    if (items.length) found.push(items);
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") found.push(...findTodoLists(child, depth + 1));
  }
  return found;
}

function todoItemOf(entry: unknown): TodoCardItem | null {
  if (typeof entry === "string") return entry.trim() ? { text: entry.trim(), state: "pending" } : null;
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  let text = "";
  for (const key of TODO_TEXT_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      text = candidate.trim();
      break;
    }
  }
  if (!text) return null;
  const rawState = String(record.status ?? record.state ?? record.progress ?? "").toLowerCase();
  const done =
    record.completed === true ||
    record.done === true ||
    DONE_STATES.has(rawState) ||
    record.checked === true;
  if (done) return { text, state: "done" };
  return { text, state: ACTIVE_STATES.has(rawState) ? "active" : "pending" };
}

/** An edit a tool call makes: a before/after pair, or a patch it was given. */
export type DiffCard = { oldText: string; newText: string } | { patch: string };

const OLD_TEXT_KEYS = ["old_string", "oldString", "old_text", "oldText", "before", "search"];
const NEW_TEXT_KEYS = ["new_string", "newString", "new_text", "newText", "after", "replace"];
const PATCH_KEYS = ["patch", "diff", "unifiedDiff", "unified_diff"];

export function diffOf(input: unknown): DiffCard | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of PATCH_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.includes("@@")) return { patch: candidate };
  }
  const oldText = firstString(record, OLD_TEXT_KEYS);
  const newText = firstString(record, NEW_TEXT_KEYS);
  if (oldText !== null && newText !== null) return { oldText, newText };
  return null;
}

/** The file a tool call works on, when its arguments name one. */
export function pathOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  return firstString(input as Record<string, unknown>, [
    "file_path",
    "filePath",
    "path",
    "file",
    "target_file",
    "targetFile",
  ]);
}

/** The command a tool call runs, when its arguments carry one. */
export function commandOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  return firstString(input as Record<string, unknown>, ["command", "cmd", "script", "shell"]);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

const EN_MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const EN_MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS_MON_FIRST: Record<AppLocale, ReadonlyArray<string>> = {
  "en-US": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  "zh-CN": ["一", "二", "三", "四", "五", "六", "日"],
  "zh-TW": ["一", "二", "三", "四", "五", "六", "日"],
};

const WEEKDAYS_SUN_FIRST: Record<AppLocale, ReadonlyArray<string>> = {
  "en-US": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  "zh-CN": ["日", "一", "二", "三", "四", "五", "六"],
  "zh-TW": ["日", "一", "二", "三", "四", "五", "六"],
};

function isCjkLocale(locale: AppLocale): boolean {
  return locale === "zh-CN" || locale === "zh-TW";
}

function toValidDate(value?: number | Date): Date | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatTimestamp(value?: number): string {
  if (!value || !Number.isFinite(value)) return "";
  const date = toValidDate(value);
  if (!date) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isCjkLocale(currentLocale())) {
    return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${hhmm}`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm}`;
}

/** Locale-aware calendar date string (e.g. `Nov 19, 2026` or `2026年11月19日`). */
export function formatDate(value?: number | Date): string {
  const date = toValidDate(value);
  if (!date) return "";
  const locale = currentLocale();
  if (isCjkLocale(locale)) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${EN_MONTHS_SHORT[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Deterministic 24-hour `HH:mm` clock string. */
export function formatTime(value?: number | Date): string {
  const date = toValidDate(value);
  if (!date) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Locale-aware relative time for both past (`5m ago` / `5 分钟前`) and future
 * (`in 2h` / `2 小时后`) timestamps, falling back to `formatDate` beyond 14 days.
 */
export function formatRelativeTime(value?: number, nowMs: number = Date.now()): string {
  if (!value || !Number.isFinite(value) || !Number.isFinite(nowMs)) return "";
  const diffMs = value - nowMs;
  const absSec = Math.round(Math.abs(diffMs) / 1000);
  const past = diffMs <= 0;

  if (absSec < 45) return tr("format.justNow");
  if (absSec < 60) {
    return past
      ? tr("format.secondsAgo", { count: absSec })
      : tr("format.inSeconds", { count: absSec });
  }
  const absMin = Math.round(absSec / 60);
  if (absMin < 60) {
    return past
      ? tr("format.minutesAgo", { count: absMin })
      : tr("format.inMinutes", { count: absMin });
  }
  const absHours = Math.round(absMin / 60);
  if (absHours < 24) {
    return past
      ? tr("format.hoursAgo", { count: absHours })
      : tr("format.inHours", { count: absHours });
  }
  const absDays = Math.round(absHours / 24);
  if (absDays <= 14) {
    return past
      ? tr("format.daysAgo", { count: absDays })
      : tr("format.inDays", { count: absDays });
  }
  return formatDate(value);
}

/**
 * Locale-aware duration formatter following OpenBitFun's carry policy: rounded
 * seconds carry cleanly into minutes, and rounded minutes carry cleanly into
 * hours (never rendering `1h 60m` or `0m 60s`).
 */
export function formatDuration(durationMs?: number | null): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }
  if (durationMs < 1000) {
    return tr("format.durationMs", { count: Math.round(durationMs) });
  }
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return tr("format.durationSec", { count: totalSeconds });
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return remSeconds === 0
      ? tr("format.durationMin", { count: totalMinutes })
      : tr("format.durationMinSec", { minutes: totalMinutes, seconds: remSeconds });
  }
  const roundedTotalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(roundedTotalMinutes / 60);
  const remMinutes = roundedTotalMinutes % 60;
  return remMinutes === 0
    ? tr("format.durationHour", { count: hours })
    : tr("format.durationHourMin", { hours, minutes: remMinutes });
}

/** Locale-aware month/year heading for calendar widgets (`November 2026` / `2026年11月`). */
export function formatMonthYear(year: number, monthIndex0: number): string {
  const safeIndex = ((monthIndex0 % 12) + 12) % 12;
  const locale = currentLocale();
  const month = isCjkLocale(locale) ? `${safeIndex + 1}月` : EN_MONTHS_LONG[safeIndex];
  return tr("format.monthYear", { year, month });
}

/** Short weekday column labels in the active locale. */
export function weekdayShortLabels(mondayFirst = true): ReadonlyArray<string> {
  const locale = currentLocale();
  return mondayFirst ? WEEKDAYS_MON_FIRST[locale] : WEEKDAYS_SUN_FIRST[locale];
}

/**
 * Formats a count with thousands grouping and resolves the singular/plural
 * message key in the active locale (reactive via `tr(...)`).
 */
export function formatPlural(count: number, oneKey: MessageKey, otherKey: MessageKey): string {
  const formatted = formatCount(count) || "0";
  return tr(count === 1 ? oneKey : otherKey, { count: formatted });
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

export function extensionOf(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

/** A byte count in the unit a person would say it in. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

/** Whether the preview panel should render the file as Markdown. */
export function isMarkdownFile(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path));
}

/**
 * A count with thousands separators aligned with `locales.json` (`,` grouping
 * across `en-US`, `zh-CN`, and `zh-TW`), keeping rendering deterministic across
 * host runtimes.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Read `currentLocale()` lightly so reactive callers follow locale contract.
  void currentLocale();
  const rounded = Math.round(value);
  const digits = String(Math.abs(rounded));
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ",";
    grouped += digits[index];
  }
  return rounded < 0 ? `-${grouped}` : grouped;
}

/** A token count a reader can take in at a glance: 1200 → `1.2K`. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) {
    const scaled = value / 1000;
    return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)}K`;
  }
  const scaled = value / 1_000_000;
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)}M`;
}

/** A 0..1 ratio as a percentage, or `null` when there is nothing to divide. */
export function formatPercent(ratio: number | null, digits = 0): string {
  if (ratio === null || !Number.isFinite(ratio)) return "";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** The date part of an ISO timestamp, for a trend bucket label. */
export function formatBucket(iso: string, hourly: boolean): string {
  if (!iso) return "";
  const date = toValidDate(new Date(iso));
  if (!date) return iso;
  const pad = (input: number) => String(input).padStart(2, "0");
  if (isCjkLocale(currentLocale())) {
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    return hourly ? `${monthDay} ${pad(date.getHours())}:00` : monthDay;
  }
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return hourly ? `${monthDay} ${pad(date.getHours())}:00` : monthDay;
}


/** A settled reply longer than this many characters opens as a preview. */
export const LARGE_MARKDOWN_CHARS = 12_000;

/**
 * Where to cut a long markdown reply for its preview: prefers the last blank
 * line before `budget` outside a code fence; if none exists (e.g. a giant code
 * block, table, or log dump without blank lines), falls back to the last line
 * break before `budget` (or `budget` itself) so oversized text never bypasses
 * preview truncation and stalls native TextView layout.
 */
export function markdownPreviewCut(text: string, budget = 4_000): number {
  if (text.length <= budget) return text.length;
  let inFence = false;
  let lastSafe = -1;
  let lastNewline = -1;
  let index = 0;
  while (index < text.length && index <= budget) {
    const lineEnd = text.indexOf("\n", index);
    const end = lineEnd === -1 ? text.length : lineEnd;
    if (end <= budget && end > 0) lastNewline = end;
    const line = text.slice(index, end);
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && line.trim() === "" && index > 0) lastSafe = index;
    index = end + 1;
  }
  if (lastSafe > 0) return lastSafe;
  if (lastNewline > 0) return lastNewline;
  return budget;
}

/**
 * Slices a markdown reply to `cut` and closes any unclosed code fence left
 * open by a hard preview cut, so native Markdown parsing stays balanced.
 */
export function markdownPreviewSlice(text: string, cut: number): string {
  const slice = text.slice(0, cut);
  let openFence: string | null = null;
  let index = 0;
  while (index < slice.length) {
    const lineEnd = slice.indexOf("\n", index);
    const end = lineEnd === -1 ? slice.length : lineEnd;
    const match = /^\s*(```+|~~~+)/.exec(slice.slice(index, end));
    if (match) {
      const marker = match[1]!;
      if (openFence === null) openFence = marker;
      else if (marker[0] === openFence[0] && marker.length >= openFence.length) openFence = null;
    }
    if (lineEnd === -1) break;
    index = lineEnd + 1;
  }
  return openFence ? `${slice}\n${openFence}` : slice;
}

/** How many lines a text has, for "Show N more lines" labels. */
export function lineCountOf(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1;
  return count;
}

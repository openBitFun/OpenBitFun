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
  try {
    const text = JSON.stringify(value);
    if (!text) return "";
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return "";
  }
}

/** A tool item of the view as a card reads it. */
export function toolCallOf(tool: TranscriptToolView): ToolCallView {
  return {
    ...(tool.id ? { id: tool.id } : {}),
    name: tool.name,
    detail: summarizeInput(tool.input),
    ...(tool.input === undefined || tool.input === null ? {} : { input: tool.input }),
    ...(tool.status ? { status: tool.status } : {}),
    ...(typeof tool.success === "boolean" ? { success: tool.success } : {}),
    ...(tool.error ? { error: tool.error } : {}),
    ...(tool.result === undefined || tool.result === null ? {} : { result: tool.result }),
    ...(tool.resultForAssistant ? { resultForAssistant: tool.resultForAssistant } : {}),
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
 * One thing a reader sees in a turn, in the order it happened: a stretch of the
 * answer, a block of reasoning, a tool call, or a run of exploring tool calls
 * (reads, searches, listings) folded into one row.
 */
export type TranscriptItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string; reasoningKind?: "reasoning" | "summary"; live?: boolean }
  | { kind: "tool"; key: string; call: ToolCallView }
  | { kind: "explore"; key: string; calls: ToolCallView[] };

/**
 * The turn's items as the transcript draws them. Keys are the host's item ids,
 * so a re-read never remounts an opened card; a thinking block keeps its
 * turn-plus-text key so its disclosure survives the live-to-persisted swap.
 */
export function turnItems(turn: unknown): TranscriptItem[] {
  const view = viewOf(turn);
  if (!view) return [];
  const items: TranscriptItem[] = view.items.map((item, index) => {
    if (item.kind === "text") {
      return { kind: "text", key: `text:${item.id || `${view.turnId}-${index}`}`, text: item.text };
    }
    if (item.kind === "thinking") {
      return {
        kind: "thinking",
        key: `${view.turnId}|thinking|${index}`,
        text: item.text,
        ...(item.reasoningKind ? { reasoningKind: item.reasoningKind } : {}),
      };
    }
    const call = toolCallOf(item.tool);
    return { kind: "tool", key: `tool:${item.tool.id || `${view.turnId}-${index}-${item.tool.name}`}`, call };
  });
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
    lower === "searchfiles" ||
    lower === "codebasesearch"
  );
}

/**
 * Folds two or more consecutive exploring tool calls into one `explore` item, the
 * way the desktop collapses an agent looking around into "Explored …". A failed
 * call stays out of a group so its error is never hidden behind a summary.
 */
export function groupExploreItems(items: TranscriptItem[]): TranscriptItem[] {
  const grouped: TranscriptItem[] = [];
  let run: Array<{ kind: "tool"; key: string; call: ToolCallView }> = [];
  const flush = () => {
    if (run.length >= 2) {
      grouped.push({ kind: "explore", key: `explore:${run[0].key}`, calls: run.map(entry => entry.call) });
    } else {
      grouped.push(...run);
    }
    run = [];
  };
  for (const item of items) {
    if (
      item.kind === "tool" &&
      isExploreTool(item.call.name) &&
      !item.call.error &&
      item.call.success !== false
    ) {
      run.push(item);
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
 * Where to cut a long markdown reply for its preview: at the last blank line
 * before `budget` that is outside a code fence, so the preview never ends in an
 * open fence. Returns the text's length when no cut is needed or none is safe.
 */
export function markdownPreviewCut(text: string, budget = 4_000): number {
  if (text.length <= budget) return text.length;
  let inFence = false;
  let lastSafe = -1;
  let index = 0;
  while (index < text.length && index <= budget) {
    const lineEnd = text.indexOf("\n", index);
    const end = lineEnd === -1 ? text.length : lineEnd;
    const line = text.slice(index, end);
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && line.trim() === "" && index > 0) lastSafe = index;
    index = end + 1;
  }
  return lastSafe > 0 ? lastSafe : text.length;
}

/** How many lines a text has, for "Show N more lines" labels. */
export function lineCountOf(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1;
  return count;
}

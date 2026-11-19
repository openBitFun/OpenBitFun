/** Text, date, duration, and count helpers shared by the scenes. */

import { currentLocale, tr, type AppLocale, type MessageKey } from "./i18n";

const TEXT_KEYS = ["content", "text", "message", "markdown"];

/**
 * Sessions are persisted Turns: a Turn nests a user message, model rounds and
 * tool activity. The MVP summary view only needs the readable text, so walk the
 * record defensively and collect the strings a reader would recognise.
 */
export function turnToText(turn: unknown, limit = 400): string {
  // A summary is what the reader said in the turn: a model's reasoning notes are
  // its own working, so they are not part of it.
  const parts = turnParts(turn).filter(part => part.role !== "thinking");
  const text = parts.map(part => part.text).join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export interface TurnPart {
  role: "user" | "assistant" | "other" | "thinking";
  text: string;
  /** What a thinking block is, when the host said: reasoning, or a summary of it. */
  reasoningKind?: "reasoning" | "summary";
}

interface OrderedRoundPart {
  part: TurnPart;
  orderIndex?: number;
  /** Fallback priority when `orderIndex` is omitted (thinking before assistant text). */
  kindOrder: number;
  seq: number;
}

function readOrderIndex(record: Record<string, unknown>): number | undefined {
  const raw = record.orderIndex ?? record.order_index;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readReasoningKind(record: Record<string, unknown>): "reasoning" | "summary" | undefined {
  const raw = record.reasoningKind ?? record.reasoning_kind;
  if (raw === "summary") return "summary";
  if (raw === "reasoning") return "reasoning";
  return undefined;
}

/**
 * Splits one persisted Turn into the parts a reader sees, so the transcript can
 * style the user's line and the assistant's reply differently. Supports both the
 * real Rust `DialogTurnData` / `ModelRoundData` shape (`textItems`,
 * `thinkingItems`, `orderIndex`) and legacy/fixture `assistantMessage` records.
 */
export function turnParts(turn: unknown): TurnPart[] {
  const parts: TurnPart[] = [];
  if (!turn || typeof turn !== "object") return parts;
  const record = turn as Record<string, unknown>;

  const user = (record.userMessage ?? record.user_message) as Record<string, unknown> | undefined;
  const userText = typeof user?.content === "string" ? user.content : "";
  if (userText.trim()) parts.push({ role: "user", text: userText });

  const rounds = record.modelRounds ?? record.model_rounds;
  if (Array.isArray(rounds)) {
    for (const round of rounds) {
      if (!round || typeof round !== "object") continue;
      const roundRecord = round as Record<string, unknown>;
      const roundParts: OrderedRoundPart[] = [];
      let seq = 0;

      const thinking = roundRecord.thinkingItems ?? roundRecord.thinking_items;
      if (Array.isArray(thinking)) {
        for (const item of thinking) {
          if (!item || typeof item !== "object") continue;
          const entry = item as Record<string, unknown>;
          const text = typeof entry.content === "string" ? entry.content : "";
          if (!text.trim()) continue;
          const kind = readReasoningKind(entry);
          roundParts.push({
            part: { role: "thinking", text, ...(kind ? { reasoningKind: kind } : {}) },
            orderIndex: readOrderIndex(entry),
            kindOrder: 0,
            seq: seq++,
          });
        }
      }

      // Real Rust `ModelRoundData` persists assistant markdown chunks in `textItems`.
      const textItems = roundRecord.textItems ?? roundRecord.text_items;
      let addedTextItem = false;
      if (Array.isArray(textItems)) {
        for (const item of textItems) {
          if (!item || typeof item !== "object") continue;
          const entry = item as Record<string, unknown>;
          const text = typeof entry.content === "string" ? entry.content : "";
          if (!text.trim()) continue;
          addedTextItem = true;
          roundParts.push({
            part: { role: "assistant", text },
            orderIndex: readOrderIndex(entry),
            kindOrder: 1,
            seq: seq++,
          });
        }
      }

      // Backward-compatible fallback for legacy records and test fixtures.
      if (!addedTextItem) {
        const assistant = (roundRecord.assistantMessage ?? roundRecord.assistant_message) as
          | Record<string, unknown>
          | undefined;
        const text = typeof assistant?.content === "string" ? assistant.content : "";
        if (text.trim()) {
          roundParts.push({
            part: { role: "assistant", text },
            orderIndex: undefined,
            kindOrder: 1,
            seq: seq++,
          });
        }
      }

      const hasExplicitOrder = roundParts.some(entry => entry.orderIndex !== undefined);
      if (hasExplicitOrder) {
        roundParts.sort((left, right) => {
          if (left.orderIndex !== undefined && right.orderIndex !== undefined && left.orderIndex !== right.orderIndex) {
            return left.orderIndex - right.orderIndex;
          }
          if (left.orderIndex !== undefined && right.orderIndex === undefined) return -1;
          if (left.orderIndex === undefined && right.orderIndex !== undefined) return 1;
          if (left.kindOrder !== right.kindOrder) return left.kindOrder - right.kindOrder;
          return left.seq - right.seq;
        });
      }

      for (const entry of roundParts) {
        parts.push(entry.part);
      }
    }
  }

  if (parts.length === 0) {
    const fallback: string[] = [];
    collectText(turn, fallback, 0);
    const text = fallback.join(" ").replace(/\s+/g, " ").trim();
    if (text) parts.push({ role: "other", text });
  }
  return parts;
}

function collectText(value: unknown, parts: string[], depth: number): void {
  if (depth > 6 || parts.join(" ").length > 4000) return;
  if (typeof value === "string") {
    if (value.trim()) parts.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of TEXT_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) parts.push(candidate.trim());
  }
  for (const [key, child] of Object.entries(record)) {
    if (TEXT_KEYS.includes(key)) continue;
    if (child && typeof child === "object") collectText(child, parts, depth + 1);
  }
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
  /** Tool execution duration in milliseconds, when persisted. */
  durationMs?: number;
  /** Original round insertion order, when persisted. */
  orderIndex?: number;
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

/**
 * The tool calls a persisted Turn holds. Supports real Rust `ModelRoundData.toolItems`
 * (with nested `toolCall.input` and `toolResult`) as well as legacy `toolCalls` /
 * `tool_calls` arrays on the turn or round.
 */
export function toolCallsOf(turn: unknown): ToolCallView[] {
  const collected: Array<{ view: ToolCallView; roundIdx: number; orderIndex?: number; seq: number }> = [];
  if (!turn || typeof turn !== "object") return [];
  const seenKeys = new Set<string>();
  let seq = 0;

  const push = (raw: unknown, roundIdx: number) => {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    const nestedCall = (record.toolCall ?? record.tool_call) as Record<string, unknown> | undefined;
    const nestedResult = (record.toolResult ?? record.tool_result) as Record<string, unknown> | undefined;

    const name =
      record.toolName ??
      record.tool_name ??
      nestedCall?.toolName ??
      nestedCall?.tool_name ??
      record.name ??
      record.tool;
    if (typeof name !== "string" || !name) return;

    const id =
      typeof record.id === "string" && record.id
        ? record.id
        : typeof nestedCall?.id === "string" && nestedCall.id
          ? nestedCall.id
          : undefined;
    const input =
      nestedCall?.input ??
      nestedCall?.arguments ??
      record.arguments ??
      record.input ??
      record.parameters ??
      record.params ??
      record.toolInput;
    const detail = summarizeInput(input);
    const key = id ? `id:${id}` : `${name}\u0000${detail}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    const status = typeof record.status === "string" ? record.status : undefined;
    const success = typeof nestedResult?.success === "boolean" ? nestedResult.success : undefined;
    const error =
      typeof nestedResult?.error === "string" && nestedResult.error
        ? nestedResult.error
        : typeof record.error === "string" && record.error
          ? record.error
          : undefined;
    const result = nestedResult?.result ?? record.result;
    const rawDuration = nestedResult?.durationMs ?? nestedResult?.duration_ms ?? record.durationMs ?? record.duration_ms;
    const durationMs = typeof rawDuration === "number" && Number.isFinite(rawDuration) ? rawDuration : undefined;
    const orderIndex = readOrderIndex(record);

    collected.push({
      view: {
        ...(id ? { id } : {}),
        name,
        detail,
        ...(input === undefined ? {} : { input }),
        ...(status ? { status } : {}),
        ...(success !== undefined ? { success } : {}),
        ...(error ? { error } : {}),
        ...(result === undefined ? {} : { result }),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(orderIndex !== undefined ? { orderIndex } : {}),
      },
      roundIdx,
      orderIndex,
      seq: seq++,
    });
  };

  const collectFrom = (container: unknown, roundIdx: number) => {
    if (!container || typeof container !== "object") return;
    const record = container as Record<string, unknown>;
    for (const key of ["toolItems", "tool_items", "toolCalls", "tool_calls"]) {
      const list = record[key];
      if (Array.isArray(list)) for (const item of list) push(item, roundIdx);
    }
  };

  collectFrom(turn, -1);
  const rounds = (turn as Record<string, unknown>).modelRounds ?? (turn as Record<string, unknown>).model_rounds;
  if (Array.isArray(rounds)) {
    rounds.forEach((round, roundIdx) => {
      collectFrom(round, roundIdx);
      if (round && typeof round === "object") {
        collectFrom((round as Record<string, unknown>).assistantMessage, roundIdx);
      }
    });
  }

  collected.sort((left, right) => {
    if (left.roundIdx !== right.roundIdx) return left.roundIdx - right.roundIdx;
    if (left.orderIndex !== undefined && right.orderIndex !== undefined && left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }
    return left.seq - right.seq;
  });

  return collected.map(entry => entry.view);
}

/** Resolves the effective model name recorded on a persisted turn's rounds or metadata. */
export function turnEffectiveModel(turn: unknown): string | null {
  if (!turn || typeof turn !== "object") return null;
  const record = turn as Record<string, unknown>;
  const rounds = record.modelRounds ?? record.model_rounds;
  if (Array.isArray(rounds)) {
    for (let index = rounds.length - 1; index >= 0; index -= 1) {
      const round = rounds[index];
      if (!round || typeof round !== "object") continue;
      const r = round as Record<string, unknown>;
      const candidate =
        r.effectiveModelName ??
        r.effective_model_name ??
        r.modelName ??
        r.model_name ??
        r.model;
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  const top =
    record.effectiveModelName ??
    record.effective_model_name ??
    record.modelName ??
    record.model_name ??
    record.model;
  return typeof top === "string" && top.trim() ? top.trim() : null;
}

/** Resolves a persisted turn's total duration in milliseconds, summing rounds if needed. */
export function turnDurationMs(turn: unknown): number | null {
  if (!turn || typeof turn !== "object") return null;
  const record = turn as Record<string, unknown>;
  const direct = record.durationMs ?? record.duration_ms;
  if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;
  const rounds = record.modelRounds ?? record.model_rounds;
  if (!Array.isArray(rounds)) return null;
  let total = 0;
  let found = false;
  for (const round of rounds) {
    if (!round || typeof round !== "object") continue;
    const r = round as Record<string, unknown>;
    const ms = r.durationMs ?? r.duration_ms;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
      total += ms;
      found = true;
    }
  }
  return found ? total : null;
}

/** True when a persisted turn contains any assistant text, thinking, or tool call items. */
export function turnHasAssistantContent(turn: unknown): boolean {
  const parts = turnParts(turn);
  if (parts.some(part => part.role === "assistant" || part.role === "thinking")) return true;
  return toolCallsOf(turn).length > 0;
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


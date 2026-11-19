// Scheduled agent routines (cron jobs) store and calendar projection.

import { computed, signal } from "nsh";
import { invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { formatMonthYear, formatTimestamp } from "./format";
import { tr } from "./i18n";
import { peerScope, peerSupports } from "./peerState";
import { activeWorkspace, activeWorkspaceId, workspaces } from "./state";
import { pushToast } from "./ui/overlays";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number | null }
  | { kind: "cron"; expr: string; tz?: string | null };

export interface CronWorkspaceRef {
  workspaceId?: string | null;
  workspacePath: string;
  remoteConnectionId?: string | null;
  remoteSshHost?: string | null;
}

export type CronJobTarget =
  | { kind: "session"; sessionId: string; workspace: CronWorkspaceRef }
  | {
      kind: "workspace";
      workspace: CronWorkspaceRef;
      launch: { agentType: string; modelId?: string | null };
    };

export type CronRunStatus = "queued" | "running" | "ok" | "error" | "cancelled";

export interface CronJobState {
  nextRunAtMs?: number | null;
  lastRunStartedAtMs?: number | null;
  lastRunFinishedAtMs?: number | null;
  lastDurationMs?: number | null;
  lastRunStatus?: CronRunStatus | string | null;
  lastError?: string | null;
  consecutiveFailures?: number;
}

export type RoutineReportPolicy = "inherit" | "always" | "conditional";

export interface CronJobRecord {
  id: string;
  name: string;
  schedule: CronSchedule;
  payload: { text: string };
  reportPolicy?: string;
  enabled: boolean;
  target: CronJobTarget;
  createdAtMs: number;
  updatedAtMs: number;
  state: CronJobState;
}

export type RoutineFilter = "all" | "active" | "paused";
export type RoutineScheduleKind = "every" | "cron" | "at";

export interface RoutineDraft {
  editingJobId: string | null;
  name: string;
  scheduleKind: RoutineScheduleKind;
  everyMinutes: string;
  cronExpr: string;
  cronTz: string;
  atIso: string;
  prompt: string;
  workspaceId: string;
  agentType: string;
  reportPolicy: RoutineReportPolicy;
  enabled: boolean;
  preservedTarget: CronJobTarget | null;
}

export interface RoutineOccurrence {
  job: CronJobRecord;
  atMs: number;
  dayKey: string;
  timeLabel: string;
}

export interface CalendarCell {
  dayKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  occurrenceCount: number;
}

const MONTH_NAMES = [
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

export const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const routines = signal<CronJobRecord[]>([]);
export const routinesBusy = signal(false);
export const routinesError = signal("");
export const routinesNotice = signal("");
export const routineFilter = signal<RoutineFilter>("all");
export const confirmingDeleteRoutineId = signal<string | null>(null);
export const editorOpen = signal(false);
export const routineDraft = signal<RoutineDraft>(makeEmptyDraft());
export const routineFormError = signal("");

const initialNow = new Date();
export const calendarYear = signal(initialNow.getFullYear());
export const calendarMonth = signal(initialNow.getMonth());
export const selectedCalendarDay = signal<string>(dateKeyOf(initialNow));

let cronHostReadySignaledFor: string | null = null;

export function routineReportPolicySupported(): boolean {
  if (peerScope() && peerSupports("background_result_delivery_v1") === false) {
    return false;
  }
  return true;
}

export function routinePeerDeliveryNotice(): string {
  const scope = peerScope();
  if (!scope) return "";
  if (peerSupports("background_result_delivery_v1") === false) {
    return `Connected peer ${scope.label} does not advertise background_result_delivery_v1; reportPolicy is omitted from routine mutations.`;
  }
  return "";
}

function defaultAtIso(): string {
  const future = new Date(Date.now() + 3600_000);
  return future.toISOString().slice(0, 16) + ":00Z";
}

function makeEmptyDraft(): RoutineDraft {
  const ws = activeWorkspace() ?? workspaces()[0] ?? null;
  return {
    editingJobId: null,
    name: "",
    scheduleKind: "every",
    everyMinutes: "30",
    cronExpr: "0 9 * * 1-5",
    cronTz: "",
    atIso: defaultAtIso(),
    prompt: "",
    workspaceId: ws?.id ?? "",
    agentType: "Standard",
    reportPolicy: "inherit",
    enabled: true,
    preservedTarget: null,
  };
}

function readStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") return val;
  }
  return "";
}

function readNum(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return null;
}

function normalizeSchedule(raw: unknown): CronSchedule {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = String(rec.kind ?? "every").toLowerCase();
  if (kind === "cron") {
    const tz = readStr(rec, "tz");
    return {
      kind: "cron",
      expr: readStr(rec, "expr") || "0 9 * * *",
      ...(tz ? { tz } : {}),
    };
  }
  if (kind === "at") {
    return {
      kind: "at",
      at: readStr(rec, "at") || new Date().toISOString(),
    };
  }
  const everyMs = readNum(rec, "everyMs", "every_ms") ?? 1_800_000;
  const anchorMs = readNum(rec, "anchorMs", "anchor_ms");
  return {
    kind: "every",
    everyMs: Math.max(1000, everyMs),
    ...(anchorMs !== null ? { anchorMs } : {}),
  };
}

function normalizeTarget(raw: unknown): CronJobTarget {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = String(rec.kind ?? "workspace").toLowerCase();
  const wsRaw = (rec.workspace && typeof rec.workspace === "object"
    ? rec.workspace
    : {}) as Record<string, unknown>;
  const workspace: CronWorkspaceRef = {
    workspaceId: readStr(wsRaw, "workspaceId", "workspace_id") || null,
    workspacePath: readStr(wsRaw, "workspacePath", "workspace_path"),
    ...(readStr(wsRaw, "remoteConnectionId", "remote_connection_id")
      ? { remoteConnectionId: readStr(wsRaw, "remoteConnectionId", "remote_connection_id") }
      : {}),
    ...(readStr(wsRaw, "remoteSshHost", "remote_ssh_host")
      ? { remoteSshHost: readStr(wsRaw, "remoteSshHost", "remote_ssh_host") }
      : {}),
  };
  if (kind === "session") {
    return {
      kind: "session",
      sessionId: readStr(rec, "sessionId", "session_id"),
      workspace,
    };
  }
  const launchRaw = (rec.launch && typeof rec.launch === "object"
    ? rec.launch
    : {}) as Record<string, unknown>;
  return {
    kind: "workspace",
    workspace,
    launch: {
      agentType: readStr(launchRaw, "agentType", "agent_type") || "Standard",
      modelId: readStr(launchRaw, "modelId", "model_id") || null,
    },
  };
}

function normalizeJob(raw: Record<string, unknown>): CronJobRecord {
  const payloadRaw = (raw.payload && typeof raw.payload === "object"
    ? raw.payload
    : {}) as Record<string, unknown>;
  const stateRaw = (raw.state && typeof raw.state === "object"
    ? raw.state
    : {}) as Record<string, unknown>;
  return {
    id: readStr(raw, "id", "jobId", "job_id"),
    name: readStr(raw, "name") || "Untitled routine",
    schedule: normalizeSchedule(raw.schedule),
    payload: {
      text: readStr(payloadRaw, "text") || readStr(raw, "prompt"),
    },
    reportPolicy: readStr(raw, "reportPolicy", "report_policy") || undefined,
    enabled: raw.enabled !== false,
    target: normalizeTarget(raw.target),
    createdAtMs: readNum(raw, "createdAtMs", "created_at_ms") ?? Date.now(),
    updatedAtMs: readNum(raw, "updatedAtMs", "updated_at_ms") ?? Date.now(),
    state: {
      nextRunAtMs: readNum(stateRaw, "nextRunAtMs", "next_run_at_ms"),
      lastRunStartedAtMs: readNum(stateRaw, "lastRunStartedAtMs", "last_run_started_at_ms"),
      lastRunFinishedAtMs: readNum(stateRaw, "lastRunFinishedAtMs", "last_run_finished_at_ms"),
      lastDurationMs: readNum(stateRaw, "lastDurationMs", "last_duration_ms"),
      lastRunStatus: readStr(stateRaw, "lastRunStatus", "last_run_status") || null,
      lastError: readStr(stateRaw, "lastError", "last_error") || null,
      consecutiveFailures: readNum(stateRaw, "consecutiveFailures", "consecutive_failures") ?? 0,
    },
  };
}

export function dateKeyOf(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTimeHHMM(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatMonthTitle(year: number, month: number): string {
  return formatMonthYear(year, month);
}

export function formatScheduleSummary(schedule: CronSchedule): string {
  if (schedule.kind === "every") {
    const mins = Math.round(schedule.everyMs / 60_000);
    if (mins < 1) {
      const secs = Math.max(1, Math.round(schedule.everyMs / 1000));
      return tr("routines.scheduleEverySec", { count: secs });
    }
    if (mins < 60) return tr("routines.scheduleEveryMin", { count: mins });
    const hours = mins / 60;
    if (Number.isInteger(hours) && hours < 24) {
      return tr("routines.scheduleEveryHour", { count: hours });
    }
    if (mins % 1440 === 0) return tr("routines.scheduleEveryDay", { count: mins / 1440 });
    return tr("routines.scheduleEveryMin", { count: mins });
  }
  if (schedule.kind === "cron") {
    return schedule.tz
      ? tr("routines.scheduleCronTz", { expr: schedule.expr, tz: schedule.tz })
      : tr("routines.scheduleCron", { expr: schedule.expr });
  }
  const parsed = Date.parse(schedule.at);
  return tr("routines.scheduleOnce", {
    time: Number.isFinite(parsed) ? formatTimestamp(parsed) : schedule.at,
  });
}

export function routineTargetLabel(job: CronJobRecord): string {
  if (job.target.kind === "session") {
    return tr("routines.targetSession", {
      id: job.target.sessionId || tr("routines.targetBound"),
    });
  }
  const path = job.target.workspace.workspacePath;
  const wsName =
    workspaces().find(w => w.id === job.target.workspace.workspaceId)?.name ||
    (path ? path.split("/").filter(Boolean).pop() || path : tr("nav.workspaceFallback"));
  return `${wsName} / ${job.target.launch.agentType || "Standard"}`;
}

// --- Cron field parser for calendar & 24h occurrence projection ---

const CRON_MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const CRON_DOW_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function expandCronAlias(expr: string): string {
  const trimmed = expr.trim();
  switch (trimmed.toLowerCase()) {
    case "@yearly":
    case "@annually":
      return "0 0 1 1 *";
    case "@monthly":
      return "0 0 1 * *";
    case "@weekly":
      return "0 0 * * 0";
    case "@daily":
    case "@midnight":
      return "0 0 * * *";
    case "@hourly":
      return "0 * * * *";
    default:
      return trimmed;
  }
}

function parseCronToken(
  token: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number | null {
  const lower = token.trim().toLowerCase();
  if (names && lower in names) return names[lower];
  if (!/^\d+$/.test(lower)) return null;
  let num = Number(lower);
  if (max === 6 && num === 7) num = 0;
  if (num < min || num > max) return null;
  return num;
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): { values: Set<number>; wildcard: boolean } | null {
  const trimmed = field.trim();
  if (!trimmed) return null;
  const wildcard = trimmed === "*";
  const values = new Set<number>();
  for (const part of trimmed.split(",")) {
    const slashParts = part.trim().split("/");
    if (slashParts.length > 2) return null;
    const rangePart = slashParts[0].trim();
    const step = slashParts.length === 2 ? Number(slashParts[1].trim()) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;

    let start = min;
    let end = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const bounds = rangePart.split("-");
        if (bounds.length !== 2) return null;
        const a = parseCronToken(bounds[0], min, max, names);
        const b = parseCronToken(bounds[1], min, max, names);
        if (a === null || b === null || a > b) return null;
        start = a;
        end = b;
      } else {
        const single = parseCronToken(rangePart, min, max, names);
        if (single === null) return null;
        start = single;
        end = slashParts.length === 2 ? max : single;
      }
    }
    for (let v = start; v <= end; v += step) {
      values.add(v);
    }
  }
  return values.size > 0 ? { values, wildcard } : null;
}

export function parseCronExpression(expr: string): {
  minutes: number[];
  hours: number[];
  doms: Set<number>;
  domWildcard: boolean;
  months: Set<number>;
  dows: Set<number>;
  dowWildcard: boolean;
} | null {
  const expanded = expandCronAlias(expr);
  const parts = expanded.split(/\s+/).filter(Boolean);
  // Support 5-field (m h dom mon dow) or 6-field (sec m h dom mon dow)
  const fields = parts.length === 6 ? parts.slice(1) : parts;
  if (fields.length !== 5) return null;
  const minField = parseCronField(fields[0], 0, 59);
  const hourField = parseCronField(fields[1], 0, 23);
  const domField = parseCronField(fields[2], 1, 31);
  const monField = parseCronField(fields[3], 1, 12, CRON_MONTH_MAP);
  const dowField = parseCronField(fields[4], 0, 6, CRON_DOW_MAP);
  if (!minField || !hourField || !domField || !monField || !dowField) return null;
  return {
    minutes: [...minField.values].sort((a, b) => a - b),
    hours: [...hourField.values].sort((a, b) => a - b),
    doms: domField.values,
    domWildcard: domField.wildcard,
    months: monField.values,
    dows: dowField.values,
    dowWildcard: dowField.wildcard,
  };
}

export function expandRoutineOccurrences(
  job: CronJobRecord,
  rangeStartMs: number,
  rangeEndMs: number,
  maxCount = 96,
): number[] {
  const hits: number[] = [];
  const push = (ms: number) => {
    if (ms >= rangeStartMs && ms <= rangeEndMs && !hits.includes(ms)) {
      hits.push(ms);
    }
  };

  if (job.state.nextRunAtMs) {
    push(job.state.nextRunAtMs);
  }

  const schedule = job.schedule;
  if (schedule.kind === "at") {
    const ms = Date.parse(schedule.at);
    if (Number.isFinite(ms)) push(ms);
    return hits.sort((a, b) => a - b);
  }

  if (schedule.kind === "every") {
    const step = Math.max(60_000, schedule.everyMs);
    const anchor = schedule.anchorMs ?? job.state.nextRunAtMs ?? job.createdAtMs ?? rangeStartMs;
    let cursor = anchor;
    if (cursor < rangeStartMs) {
      const k = Math.ceil((rangeStartMs - cursor) / step);
      cursor += k * step;
    } else if (cursor > rangeEndMs) {
      const k = Math.ceil((cursor - rangeEndMs) / step);
      cursor -= k * step;
    }
    while (cursor >= rangeStartMs && cursor - step >= rangeStartMs) {
      cursor -= step;
    }
    while (cursor <= rangeEndMs && hits.length < maxCount) {
      push(cursor);
      cursor += step;
    }
    return hits.sort((a, b) => a - b);
  }

  const parsed = parseCronExpression(schedule.expr);
  if (!parsed) return hits.sort((a, b) => a - b);

  // Cap minute slots per day to keep dense crons like "* * * * *" fast in UI projection.
  const dayCursor = new Date(rangeStartMs);
  dayCursor.setHours(0, 0, 0, 0);
  const endDay = new Date(rangeEndMs);
  endDay.setHours(23, 59, 59, 999);

  while (dayCursor.getTime() <= endDay.getTime() && hits.length < maxCount) {
    const month = dayCursor.getMonth() + 1;
    const dom = dayCursor.getDate();
    const dow = dayCursor.getDay();
    if (parsed.months.has(month)) {
      const domOk = parsed.doms.has(dom);
      const dowOk = parsed.dows.has(dow);
      const dayMatches =
        parsed.domWildcard && parsed.dowWildcard
          ? true
          : parsed.domWildcard
            ? dowOk
            : parsed.dowWildcard
              ? domOk
              : domOk || dowOk;

      if (dayMatches) {
        const y = dayCursor.getFullYear();
        const m = dayCursor.getMonth();
        for (const hour of parsed.hours) {
          for (const minute of parsed.minutes) {
            const slotMs = new Date(y, m, dom, hour, minute, 0, 0).getTime();
            if (slotMs >= rangeStartMs && slotMs <= rangeEndMs) {
              push(slotMs);
              if (hits.length >= maxCount) break;
            }
          }
          if (hits.length >= maxCount) break;
        }
      }
    }
    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  return hits.sort((a, b) => a - b);
}

export const filteredRoutines = computed<CronJobRecord[]>(() => {
  const filter = routineFilter();
  const list = routines();
  if (filter === "active") return list.filter(job => job.enabled);
  if (filter === "paused") return list.filter(job => !job.enabled);
  return list;
});

export const activeRoutineCount = computed(() => routines().filter(job => job.enabled).length);

export const dueNext24Hours = computed<RoutineOccurrence[]>(() => {
  const now = Date.now();
  const end = now + 24 * 60 * 60 * 1000;
  const items: RoutineOccurrence[] = [];
  for (const job of routines()) {
    if (!job.enabled) continue;
    const nextTimes = expandRoutineOccurrences(job, now, end, 4);
    if (nextTimes.length === 0) continue;
    const nextAt = nextTimes[0];
    items.push({
      job,
      atMs: nextAt,
      dayKey: dateKeyOf(new Date(nextAt)),
      timeLabel: formatTimeHHMM(nextAt),
    });
  }
  return items.sort((a, b) => a.atMs - b.atMs);
});

const monthOccurrencesByDay = computed<Record<string, RoutineOccurrence[]>>(() => {
  const year = calendarYear();
  const month = calendarMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const byDay: Record<string, RoutineOccurrence[]> = {};

  for (const job of routines()) {
    if (!job.enabled) continue;
    const times = expandRoutineOccurrences(job, startMs, endMs, 96);
    for (const atMs of times) {
      const dayKey = dateKeyOf(new Date(atMs));
      const list = byDay[dayKey] ?? [];
      list.push({
        job,
        atMs,
        dayKey,
        timeLabel: formatTimeHHMM(atMs),
      });
      byDay[dayKey] = list;
    }
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => a.atMs - b.atMs);
  }
  return byDay;
});

export const calendarCells = computed<CalendarCell[]>(() => {
  const year = calendarYear();
  const month = calendarMonth();
  const firstOfMonth = new Date(year, month, 1);
  // Monday-first grid: Monday=0 .. Sunday=6
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalSlots = startOffset + daysInMonth > 35 ? 42 : 35;
  const todayKey = dateKeyOf(new Date());
  const selectedKey = selectedCalendarDay();
  const map = monthOccurrencesByDay();

  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalSlots; i += 1) {
    const current = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dayKey = dateKeyOf(current);
    cells.push({
      dayKey,
      dayNumber: current.getDate(),
      inCurrentMonth: current.getMonth() === month,
      isToday: dayKey === todayKey,
      isSelected: dayKey === selectedKey,
      occurrenceCount: (map[dayKey] ?? []).length,
    });
  }
  return cells;
});

export const selectedDayOccurrences = computed<RoutineOccurrence[]>(() => {
  return monthOccurrencesByDay()[selectedCalendarDay()] ?? [];
});

export function stepCalendarMonth(delta: number): void {
  const next = new Date(calendarYear(), calendarMonth() + delta, 1);
  calendarYear.set(next.getFullYear());
  calendarMonth.set(next.getMonth());
}

export function jumpCalendarToday(): void {
  const today = new Date();
  calendarYear.set(today.getFullYear());
  calendarMonth.set(today.getMonth());
  selectedCalendarDay.set(dateKeyOf(today));
}

export function selectCalendarDay(dayKey: string): void {
  selectedCalendarDay.set(dayKey);
}

// --- Host actions & subscriptions ---

export function ensureCronHostReady(): void {
  const scopeKey = peerScope()?.deviceId ?? "local";
  if (cronHostReadySignaledFor === scopeKey) return;
  cronHostReadySignaledFor = scopeKey;
  void invokeRawCommand<unknown>("notify_cron_host_ready", {}).catch(() => undefined);
}

export function subscribeRoutinesChanged(): () => void {
  return listenEvent("cron://jobs-changed", () => {
    void loadRoutines();
  });
}

export async function loadRoutines(): Promise<void> {
  routinesBusy.set(true);
  routinesError.set("");
  try {
    const raw = await invokeCommand<Array<Record<string, unknown>>>("list_cron_jobs", {});
    const list = (Array.isArray(raw) ? raw : []).map(item => normalizeJob(item ?? {}));
    routines.set(list);
  } catch (error) {
    routinesError.set(error instanceof Error ? error.message : String(error));
  } finally {
    routinesBusy.set(false);
  }
}

export async function toggleRoutineEnabled(job: CronJobRecord): Promise<void> {
  routinesBusy.set(true);
  routinesError.set("");
  try {
    const includePolicy = routineReportPolicySupported() && Boolean(job.reportPolicy);
    const updated = await invokeCommand<Record<string, unknown>>("update_cron_job", {
      jobId: job.id,
      name: job.name,
      schedule: job.schedule,
      payload: { text: job.payload.text },
      enabled: !job.enabled,
      ...(includePolicy ? { reportPolicy: job.reportPolicy } : {}),
      target: job.target,
    });
    if (updated && typeof updated === "object" && (updated.id || updated.jobId)) {
      const normalized = normalizeJob(updated);
      routines.update(list => list.map(row => (row.id === job.id ? normalized : row)));
    } else {
      await loadRoutines();
    }
    const statusMsg = `${job.name} ${!job.enabled ? "resumed" : "paused"}`;
    routinesNotice.set(statusMsg);
    pushToast(statusMsg, "success");
  } catch (error) {
    routinesError.set(error instanceof Error ? error.message : String(error));
  } finally {
    routinesBusy.set(false);
  }
}

export function openCreateRoutineDraft(): void {
  routineFormError.set("");
  routinesNotice.set("");
  routineDraft.set(makeEmptyDraft());
  editorOpen.set(true);
}

export function openEditRoutineDraft(job: CronJobRecord): void {
  routineFormError.set("");
  routinesNotice.set("");
  let scheduleKind: RoutineScheduleKind = "every";
  let everyMinutes = "30";
  let cronExpr = "0 9 * * 1-5";
  let cronTz = "";
  let atIso = defaultAtIso();

  if (job.schedule.kind === "every") {
    scheduleKind = "every";
    everyMinutes = String(Math.max(1, Math.round(job.schedule.everyMs / 60_000)));
  } else if (job.schedule.kind === "cron") {
    scheduleKind = "cron";
    cronExpr = job.schedule.expr;
    cronTz = job.schedule.tz ?? "";
  } else {
    scheduleKind = "at";
    atIso = job.schedule.at;
  }

  const wsId =
    job.target.workspace.workspaceId ||
    workspaces().find(w => w.rootPath === job.target.workspace.workspacePath)?.id ||
    activeWorkspaceId() ||
    "";
  const agentType =
    job.target.kind === "workspace" ? job.target.launch.agentType || "Standard" : "Standard";
  const rawPolicy = job.reportPolicy;
  const reportPolicy: RoutineReportPolicy =
    rawPolicy === "always" || rawPolicy === "conditional" ? rawPolicy : "inherit";

  routineDraft.set({
    editingJobId: job.id,
    name: job.name,
    scheduleKind,
    everyMinutes,
    cronExpr,
    cronTz,
    atIso,
    prompt: job.payload.text,
    workspaceId: wsId,
    agentType,
    reportPolicy,
    enabled: job.enabled,
    preservedTarget: job.target.kind === "session" ? job.target : null,
  });
  editorOpen.set(true);
}

export function updateRoutineDraft(patch: Partial<RoutineDraft>): void {
  routineDraft.update(current => ({ ...current, ...patch }));
}

export function closeRoutineEditor(): void {
  routineFormError.set("");
  editorOpen.set(false);
}

export async function saveRoutineDraft(): Promise<void> {
  const draft = routineDraft();
  const name = draft.name.trim();
  const text = draft.prompt.trim();
  if (!name) {
    routineFormError.set("Routine name is required.");
    return;
  }
  if (!text) {
    routineFormError.set("Prompt text is required.");
    return;
  }

  let schedule: CronSchedule;
  if (draft.scheduleKind === "every") {
    const mins = Number(draft.everyMinutes.trim());
    if (!Number.isFinite(mins) || mins <= 0) {
      routineFormError.set("Interval minutes must be a positive number.");
      return;
    }
    schedule = { kind: "every", everyMs: Math.round(mins * 60_000) };
  } else if (draft.scheduleKind === "cron") {
    const expr = draft.cronExpr.trim();
    if (!parseCronExpression(expr)) {
      routineFormError.set("Enter a valid 5-field cron expression (e.g. 0 9 * * 1-5).");
      return;
    }
    const tz = draft.cronTz.trim();
    schedule = { kind: "cron", expr, ...(tz ? { tz } : {}) };
  } else {
    const at = draft.atIso.trim();
    if (!at || !Number.isFinite(Date.parse(at))) {
      routineFormError.set("Enter a valid ISO-8601 timestamp.");
      return;
    }
    schedule = { kind: "at", at };
  }

  const wsRecord =
    workspaces().find(w => w.id === draft.workspaceId) ??
    activeWorkspace() ??
    workspaces()[0] ??
    null;

  if (!draft.preservedTarget && !wsRecord) {
    routineFormError.set("Select a target workspace for this routine.");
    return;
  }

  const target: CronJobTarget = draft.preservedTarget
    ? draft.preservedTarget
    : {
        kind: "workspace",
        workspace: {
          workspaceId: wsRecord!.id,
          workspacePath: wsRecord!.rootPath,
        },
        launch: {
          agentType: draft.agentType.trim() || "Standard",
          modelId: null,
        },
      };

  const includeReportPolicy = routineReportPolicySupported();
  const reportPolicyPayload = includeReportPolicy && draft.reportPolicy
    ? { reportPolicy: draft.reportPolicy }
    : {};

  routineFormError.set("");
  routinesBusy.set(true);
  routinesError.set("");
  try {
    if (draft.editingJobId) {
      const updated = await invokeCommand<Record<string, unknown>>("update_cron_job", {
        jobId: draft.editingJobId,
        name,
        schedule,
        payload: { text },
        enabled: draft.enabled,
        ...reportPolicyPayload,
        target,
      });
      if (updated && typeof updated === "object" && (updated.id || updated.jobId)) {
        const normalized = normalizeJob(updated);
        routines.update(list =>
          list.map(row => (row.id === draft.editingJobId ? normalized : row)),
        );
      } else {
        await loadRoutines();
      }
      const updatedMsg = `Updated routine "${name}"`;
      routinesNotice.set(updatedMsg);
      pushToast(updatedMsg, "success");
    } else {
      const created = await invokeCommand<Record<string, unknown>>("create_cron_job", {
        name,
        schedule,
        payload: { text },
        enabled: draft.enabled,
        ...reportPolicyPayload,
        target,
      });
      if (created && typeof created === "object" && (created.id || created.jobId)) {
        const normalized = normalizeJob(created);
        routines.update(list => [normalized, ...list]);
      } else {
        await loadRoutines();
      }
      const createdMsg = `Created routine "${name}"`;
      routinesNotice.set(createdMsg);
      pushToast(createdMsg, "success");
    }
    editorOpen.set(false);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    routineFormError.set(errMsg);
    pushToast(errMsg, "error");
  } finally {
    routinesBusy.set(false);
  }
}

export function requestDeleteRoutine(jobId: string): void {
  confirmingDeleteRoutineId.set(jobId);
}

export function cancelDeleteRoutine(): void {
  confirmingDeleteRoutineId.set(null);
}

export async function confirmDeleteRoutine(jobId: string): Promise<void> {
  routinesBusy.set(true);
  routinesError.set("");
  try {
    await invokeCommand<boolean>("delete_cron_job", { jobId });
    routines.update(list => list.filter(item => item.id !== jobId));
    confirmingDeleteRoutineId.set(null);
    if (routineDraft().editingJobId === jobId) {
      editorOpen.set(false);
    }
    routinesNotice.set("Routine deleted");
    pushToast("Routine deleted", "success");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    routinesError.set(errMsg);
    pushToast(errMsg, "error");
  } finally {
    routinesBusy.set(false);
  }
}

// Scheduled agent routines (cron jobs) store and calendar projection.

import { computed, signal } from "nsh";
import { fleetActive, invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { formatMonthYear, formatTimestamp } from "./format";
import { tr } from "./i18n";
import { isCommandUnavailable } from "./hostCommands";
import { currentDeviceScopeKey } from "./shared/deviceScope";
import { basenameOfPath, isRemoteWorkspace } from "./shared/workspaceUtils";
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
  /** Preserved remote SSH metadata when editing an existing remote-workspace routine. */
  remoteConnectionId?: string | null;
  remoteSshHost?: string | null;
  /** A new session per run in the workspace, or one existing session (the desktop's two targets). */
  targetKind?: "workspace" | "session";
  sessionId?: string;
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

let cronHostReadySignaled = false;

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
    targetKind: "workspace",
    sessionId: "",
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
  const isRemote = Boolean(job.target.workspace.remoteConnectionId || job.target.workspace.remoteSshHost);
  const wsName =
    workspaces().find(w => w.id === job.target.workspace.workspaceId)?.name ||
    (path ? basenameOfPath(path, isRemote) || path : tr("nav.workspaceFallback"));
  return `${wsName} / ${job.target.launch.agentType || "Standard"}`;
}

// --- Run previews: the host's scheduler answers, this surface only lays them out ---
//
// Cron parsing used to live here and disagreed with the scheduler (aliases,
// day-of-week numbering, the host's zone). `preview_cron_occurrences` answers
// from the scheduler's own code, so the editor, the calendar and "due in the
// next 24 hours" show what the host will run. A host without the command gets
// an explicit "update the host" notice and only the run it reports itself
// (`state.nextRunAtMs`); nothing is derived here.

interface HostOccurrencePreview {
  valid?: boolean;
  issue?: { field?: string; code?: string; message?: string } | null;
  occurrences?: number[];
  truncated?: boolean;
}

interface HostJobOccurrencePreview extends HostOccurrencePreview {
  jobId?: string;
}

interface HostPreviewResponse {
  schedule?: HostOccurrencePreview | null;
  jobs?: HostJobOccurrencePreview[];
}

/** Host run times per job id for the calendar month on screen. */
export const monthOccurrences = signal<Record<string, number[]>>({});
/** Host run times per job id for the next 24 hours. */
export const dueOccurrences = signal<Record<string, number[]>>({});
/** The host (or peer) has no `preview_cron_occurrences`: previews need a host update. */
export const routinePreviewUnavailable = signal(false);

export type DraftPreviewState = "idle" | "loading" | "valid" | "invalid" | "unavailable";
export interface DraftSchedulePreview {
  state: DraftPreviewState;
  occurrences: number[];
  /** The scheduler's issue code (`invalid_cron`, `interval_positive`, ...). */
  issueCode: string;
  issueMessage: string;
}
export const draftSchedulePreview = signal<DraftSchedulePreview>({
  state: "idle",
  occurrences: [],
  issueCode: "",
  issueMessage: "",
});

function isPreviewUnavailable(error: unknown, command: string): boolean {
  return isCommandUnavailable(error, command);
}

function occurrencesByJob(response: HostPreviewResponse | null | undefined): Record<string, number[]> {
  const byJob: Record<string, number[]> = {};
  for (const row of response?.jobs ?? []) {
    if (!row?.jobId) continue;
    byJob[row.jobId] = (row.occurrences ?? []).filter(ms => typeof ms === "number" && Number.isFinite(ms));
  }
  return byJob;
}

/** Only the run the host reported itself, for a host without previews. */
function reportedRunsIn(startMs: number, endMs: number): Record<string, number[]> {
  const byJob: Record<string, number[]> = {};
  for (const job of routines()) {
    const next = job.state.nextRunAtMs;
    if (job.enabled && typeof next === "number" && next >= startMs && next <= endMs) byJob[job.id] = [next];
  }
  return byJob;
}

function calendarWindow(): { startMs: number; endMs: number } {
  const year = calendarYear();
  const month = calendarMonth();
  return {
    startMs: new Date(year, month, 1, 0, 0, 0, 0).getTime(),
    endMs: new Date(year, month + 1, 0, 23, 59, 59, 999).getTime(),
  };
}

let occurrenceTicket = 0;

/** Re-reads the host's run times for the calendar month and the next 24 hours. */
export async function refreshRoutineOccurrences(): Promise<void> {
  const ticket = ++occurrenceTicket;
  const month = calendarWindow();
  const now = Date.now();
  const dayEnd = now + 24 * 60 * 60 * 1000;
  if (routinePreviewUnavailable()) {
    monthOccurrences.set(reportedRunsIn(month.startMs, month.endMs));
    dueOccurrences.set(reportedRunsIn(now, dayEnd));
    return;
  }
  try {
    const [monthResponse, dueResponse] = await Promise.all([
      invokeCommand<HostPreviewResponse>("preview_cron_occurrences", {
        fromMs: month.startMs,
        toMs: month.endMs,
        count: 96,
      }),
      invokeCommand<HostPreviewResponse>("preview_cron_occurrences", {
        fromMs: now,
        toMs: dayEnd,
        count: 4,
      }),
    ]);
    if (ticket !== occurrenceTicket) return;
    monthOccurrences.set(occurrencesByJob(monthResponse));
    dueOccurrences.set(occurrencesByJob(dueResponse));
  } catch (error) {
    if (ticket !== occurrenceTicket) return;
    if (isPreviewUnavailable(error, "preview_cron_occurrences")) {
      routinePreviewUnavailable.set(true);
      monthOccurrences.set(reportedRunsIn(month.startMs, month.endMs));
      dueOccurrences.set(reportedRunsIn(now, dayEnd));
      return;
    }
    console.warn(`Failed to preview routine runs: ${error instanceof Error ? error.message : String(error)}`);
    monthOccurrences.set({});
    dueOccurrences.set({});
  }
}

/** The schedule the draft describes, as the host's `CronSchedule`. Input conversion only. */
export function draftSchedule(draft: RoutineDraft): CronSchedule {
  if (draft.scheduleKind === "every") {
    const mins = Number(draft.everyMinutes.trim());
    return { kind: "every", everyMs: Number.isFinite(mins) && mins > 0 ? Math.round(mins * 60_000) : 0 };
  }
  if (draft.scheduleKind === "cron") {
    const tz = draft.cronTz.trim();
    return { kind: "cron", expr: draft.cronExpr.trim(), ...(tz ? { tz } : {}) };
  }
  return { kind: "at", at: draft.atIso.trim() };
}

/** The editor's localized sentence for a scheduler issue code. */
export function routineIssueText(code: string, fallback: string): string {
  switch (code) {
    case "name_required":
      return tr("routines.store.nameRequired");
    case "payload_required":
      return tr("routines.store.promptRequired");
    case "interval_positive":
      return tr("routines.store.intervalPositive");
    case "invalid_cron":
      return tr("routines.store.cronInvalid");
    case "invalid_timezone":
      return tr("routines.issueInvalidTimezone");
    case "invalid_timestamp":
      return tr("routines.store.timestampInvalid");
    case "no_future_run":
      return tr("routines.issueNoFutureRun");
    default:
      return fallback;
  }
}

let draftPreviewTicket = 0;
let draftPreviewTimer: ReturnType<typeof setTimeout> | null = null;

/** Asks the host to preview the draft's next runs (debounced while typing). */
export function scheduleDraftPreview(delayMs = 250): void {
  if (draftPreviewTimer) clearTimeout(draftPreviewTimer);
  if (routinePreviewUnavailable()) {
    draftSchedulePreview.set({ state: "unavailable", occurrences: [], issueCode: "", issueMessage: "" });
    return;
  }
  draftSchedulePreview.update(prev => ({ ...prev, state: "loading" }));
  draftPreviewTimer = setTimeout(() => {
    draftPreviewTimer = null;
    void refreshDraftPreview();
  }, delayMs);
}

export async function refreshDraftPreview(): Promise<void> {
  const ticket = ++draftPreviewTicket;
  const schedule = draftSchedule(routineDraft());
  try {
    const response = await invokeCommand<HostPreviewResponse>("preview_cron_occurrences", {
      schedule,
      count: 3,
    });
    if (ticket !== draftPreviewTicket) return;
    const preview = response?.schedule;
    if (preview?.valid) {
      draftSchedulePreview.set({
        state: "valid",
        occurrences: preview.occurrences ?? [],
        issueCode: "",
        issueMessage: "",
      });
    } else {
      draftSchedulePreview.set({
        state: "invalid",
        occurrences: [],
        issueCode: preview?.issue?.code ?? "",
        issueMessage: preview?.issue?.message ?? "",
      });
    }
  } catch (error) {
    if (ticket !== draftPreviewTicket) return;
    if (isPreviewUnavailable(error, "preview_cron_occurrences")) {
      routinePreviewUnavailable.set(true);
      draftSchedulePreview.set({ state: "unavailable", occurrences: [], issueCode: "", issueMessage: "" });
      return;
    }
    draftSchedulePreview.set({
      state: "invalid",
      occurrences: [],
      issueCode: "",
      issueMessage: error instanceof Error ? error.message : String(error),
    });
  }
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
  const byJob = dueOccurrences();
  const items: RoutineOccurrence[] = [];
  for (const job of routines()) {
    if (!job.enabled) continue;
    const nextAt = byJob[job.id]?.[0];
    if (typeof nextAt !== "number") continue;
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
  const byJob = monthOccurrences();
  const byDay: Record<string, RoutineOccurrence[]> = {};
  for (const job of routines()) {
    if (!job.enabled) continue;
    for (const atMs of byJob[job.id] ?? []) {
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
  void refreshRoutineOccurrences();
}

export function jumpCalendarToday(): void {
  const today = new Date();
  calendarYear.set(today.getFullYear());
  calendarMonth.set(today.getMonth());
  selectedCalendarDay.set(dateKeyOf(today));
  void refreshRoutineOccurrences();
}

export function selectCalendarDay(dayKey: string): void {
  selectedCalendarDay.set(dayKey);
}

// --- Host actions & subscriptions ---

const cronHostReadyDevices = new Set<string>();

export function ensureCronHostReady(): void {
  const scope = currentDeviceScopeKey();
  if (cronHostReadyDevices.has(scope)) return;
  cronHostReadyDevices.add(scope);
  routinePreviewUnavailable.set(false);
  void invokeRawCommand<unknown>("notify_cron_host_ready", {}).catch(() => undefined);
}

export function subscribeRoutinesChanged(): () => void {
  return listenEvent("cron://jobs-changed", (_payload, meta) => {
    if (fleetActive() && meta.origin && meta.origin !== currentDeviceScopeKey()) return;
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
    void refreshRoutineOccurrences();
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
    const includePolicy = Boolean(job.reportPolicy);
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
      void refreshRoutineOccurrences();
    } else {
      await loadRoutines();
    }
    const statusMsg = !job.enabled
      ? tr("routines.store.resumed", { name: job.name })
      : tr("routines.store.paused", { name: job.name });
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
  scheduleDraftPreview(0);
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
    targetKind: job.target.kind,
    sessionId: job.target.kind === "session" ? job.target.sessionId : "",
    remoteConnectionId: job.target.workspace.remoteConnectionId ?? null,
    remoteSshHost: job.target.workspace.remoteSshHost ?? null,
  });
  editorOpen.set(true);
  scheduleDraftPreview(0);
}

const SCHEDULE_DRAFT_FIELDS: ReadonlyArray<keyof RoutineDraft> = [
  "scheduleKind",
  "everyMinutes",
  "cronExpr",
  "cronTz",
  "atIso",
];

export function updateRoutineDraft(patch: Partial<RoutineDraft>): void {
  routineDraft.update(current => ({ ...current, ...patch }));
  if (SCHEDULE_DRAFT_FIELDS.some(field => field in patch)) scheduleDraftPreview();
}

export function closeRoutineEditor(): void {
  routineFormError.set("");
  editorOpen.set(false);
}

export async function saveRoutineDraft(): Promise<void> {
  const draft = routineDraft();
  const name = draft.name.trim();
  const text = draft.prompt.trim();
  const schedule = draftSchedule(draft);

  // The scheduler's own rules decide; a host without the check still refuses
  // an invalid job in create/update, whose error is shown as it comes.
  try {
    const verdict = await invokeCommand<{
      valid?: boolean;
      issues?: Array<{ code?: string; message?: string }>;
    }>("validate_cron_job_draft", { name, payload: { text }, schedule });
    const issue = verdict?.valid === false ? verdict.issues?.[0] : undefined;
    if (issue) {
      routineFormError.set(routineIssueText(issue.code ?? "", issue.message ?? ""));
      return;
    }
  } catch (error) {
    if (!isCommandUnavailable(error, "validate_cron_job_draft")) {
      routineFormError.set(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  const wsRecord =
    workspaces().find(w => w.id === draft.workspaceId) ??
    activeWorkspace() ??
    workspaces()[0] ??
    null;

  if (!draft.preservedTarget && !wsRecord) {
    routineFormError.set(tr("routines.store.selectWorkspace"));
    return;
  }

  if (!draft.preservedTarget && draft.targetKind === "session" && !(draft.sessionId ?? "").trim()) {
    routineFormError.set(tr("routines.store.selectSession"));
    return;
  }

  const wsIsRemote = isRemoteWorkspace(wsRecord);
  const remoteConnectionId = wsIsRemote ? (wsRecord?.connectionId ?? draft.remoteConnectionId ?? undefined) : undefined;
  const remoteSshHost = wsIsRemote ? (wsRecord?.sshHost ?? draft.remoteSshHost ?? undefined) : undefined;
  const workspaceRef: CronWorkspaceRef | null = wsRecord
    ? {
        workspaceId: wsRecord.id,
        workspacePath: wsRecord.rootPath,
        ...(remoteConnectionId ? { remoteConnectionId } : {}),
        ...(remoteSshHost ? { remoteSshHost } : {}),
      }
    : null;

  const target: CronJobTarget = draft.preservedTarget
    ? draft.preservedTarget
    : draft.targetKind === "session"
      ? {
          kind: "session",
          sessionId: (draft.sessionId ?? "").trim(),
          workspace: workspaceRef!,
        }
      : {
          kind: "workspace",
          workspace: workspaceRef!,
          launch: {
            agentType: draft.agentType.trim() || "Standard",
            modelId: null,
          },
        };

  const reportPolicyPayload = draft.reportPolicy
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
        void refreshRoutineOccurrences();
      } else {
        await loadRoutines();
      }
      const updatedMsg = tr("routines.store.updated", { name });
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
        void refreshRoutineOccurrences();
      } else {
        await loadRoutines();
      }
      const createdMsg = tr("routines.store.created", { name });
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
    routinesNotice.set(tr("routines.store.deleted"));
    pushToast(tr("routines.store.deleted"), "success");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    routinesError.set(errMsg);
    pushToast(errMsg, "error");
  } finally {
    routinesBusy.set(false);
  }
}

// State and backend actions for the Personal Hub Home overview (`PersonalOverview`).
//
// Account identity (`account_*`) and AI Insights (`*_insights*`) are
// controller-local on this machine even while driving a Peer. Ecosystem pulse
// calls (`get_assistant_workspaces`, `get_available_modes`, `list_subagents`,
// `get_skill_configs`, `list_cron_jobs`, `list_miniapps`, `ssh_list_saved_connections`,
// `get_token_usage_statistics`) target the active host (or Peer) and catch
// errors independently so older hosts degrade gracefully.

import { Clipboard, computed, openUrl, signal } from "nsh";
import { invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { formatCount, formatTimestamp, formatTokens } from "./format";
import { localizeHostError, tr } from "./i18n";
import { peerScope } from "./peerState";
import { pendingPermissions } from "./permissionStore";
import { savedConnections, type SavedConnection } from "./sshRemoteStore";
import { isCommandUnavailable } from "./hostCommands";
import {
  readUsageActivity,
  type UsageActivityCell,
  type UsageActivityView,
} from "./usageActivity";
import {
  activeWorkspaceId,
  navigateScene,
  runningTurns,
  selectSession,
  sessions,
  startQuickPromptInSession,
} from "./state";

const MONTH_NAMES = [
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

export interface GitHubIdentityView {
  login: string;
  avatarUrl: string;
  email: string;
  githubId: number | null;
  accountId: string;
}

export interface GitHubDeviceFlowState {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  transactionId: string;
  intervalSeconds: number;
  status: "pending" | "authorized" | "expired";
}

export interface DueRoutineView {
  id: string;
  name: string;
  scheduleSummary: string;
  nextRunAtMs: number;
  nextRunText: string;
  lastRunStatus: string;
}

export interface UsageTrendPointView {
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface HomeUsageSummary {
  totalTokens: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  failedRequests: number;
  topModelName: string;
  trend: UsageTrendPointView[];
}

/** Peak and streaks of the activity window, as the host counted them. */
export interface OverviewUsageMetrics {
  peakTokens: number;
  longestStreak: number;
  currentStreak: number;
}

export type UsageActivityDayCell = UsageActivityCell;

export interface UsageActivityGridData {
  days: UsageActivityDayCell[];
  weekCount: number;
  totalTokens: number;
  activeDays: number;
  monthHeaders: Array<{ weekIndex: number; label: string }>;
}

export interface HomeSpaceItemView {
  id: string;
  name: string;
  description: string;
  icon: string;
  running: boolean;
}

export interface InsightsReportMetaView {
  path: string;
  title: string;
  generatedAtMs: number;
  generatedAtText: string;
  dateRangeLabel: string;
  totalSessions: number;
  analyzedSessions: number;
  totalMessages: number;
  daysCovered: number;
  topGoals: string[];
}

export interface InsightsReportView {
  path: string;
  title: string;
  subtitle: string;
  markdown: string;
  /** The HTML rendering the host wrote beside the report, when it wrote one. */
  htmlPath: string;
}

/** The ranges and models the desktop's insights generator offers. */
export const INSIGHTS_DAY_OPTIONS = [7, 14, 30, 90] as const;
export const insightsDays = signal<number>(30);
/** `primary` or `fast`, the model slot the generator runs on. */
export const insightsModel = signal<"primary" | "fast">("primary");

export const homeQuickPrompt = signal("");
export const homeQuickBusy = signal(false);

export const accountStatus = signal<{ loggedIn: boolean; userId: string | null } | null>(null);
export const githubUser = signal<GitHubIdentityView | null>(null);
export const githubAuthFlow = signal<GitHubDeviceFlowState | null>(null);
export const authLoading = signal(false);
export const authNotice = signal("");
export const authError = signal("");

export const homePulseLoading = signal(false);
export const assistantsCount = signal<number | null>(null);
export const assistantsPulseNote = signal("");
export const agentsCount = signal<number | null>(null);
export const modesCount = signal<number | null>(null);
export const subagentsCount = signal<number>(0);
export const agentsPulseNote = signal("");
export const skillsCount = signal<number | null>(null);
export const skillsEnabledCount = signal<number | null>(null);
export const skillsPulseNote = signal("");
export const routinesCount = signal<number | null>(null);
export const routinesEnabledCount = signal<number | null>(null);
export const dueSoonRoutines = signal<DueRoutineView[]>([]);
export const routinesPulseNote = signal("");

export const spacesCount = signal<number | null>(null);
export const spacesRunningCount = signal<number>(0);
export const installedSpaces = signal<HomeSpaceItemView[]>([]);
export const spacesPulseNote = signal("");

export const homeSavedSshConnections = signal<SavedConnection[]>([]);
export const homeSshNote = signal("");

export const usageSummary = signal<HomeUsageSummary | null>(null);
export const usagePulseNote = signal("");
/** The host's day-keyed heatmap (`get_token_usage_activity`); `null` until read. */
export const homeUsageActivity = signal<UsageActivityView | null>(null);
export const usageActivityStatus = signal<"loading" | "ready" | "unsupported" | "failed">("loading");
export const usageActivityNote = signal("");
export const selectedActivityCell = signal<UsageActivityDayCell | null>(null);

export const insightsMetas = signal<InsightsReportMetaView[]>([]);
export const insightsLoading = signal(false);
export const insightsGenerating = signal(false);
export const insightsProgress = signal("");
export const insightsNotice = signal("");
export const insightsError = signal("");
export const activeInsightsReport = signal<InsightsReportView | null>(null);
export const selectedInsightsPath = signal("");
export const insightsModalOpen = signal(false);

export const isAccountSignedIn = computed(
  () => githubUser() !== null || accountStatus()?.loggedIn === true,
);

export const homeSshList = computed<SavedConnection[]>(() =>
  savedConnections().length > 0 ? savedConnections() : homeSavedSshConnections(),
);

export const overviewUsageMetrics = computed<OverviewUsageMetrics>(() => {
  const activity = homeUsageActivity();
  return {
    peakTokens: activity?.peakTokens ?? 0,
    longestStreak: activity?.longestStreak ?? 0,
    currentStreak: activity?.currentStreak ?? 0,
  };
});

/** The host's grid with month labels; no day is re-keyed or rescaled here. */
export const usageActivityGrid = computed<UsageActivityGridData>(() => {
  const activity = homeUsageActivity();
  if (!activity) return { days: [], weekCount: 0, totalTokens: 0, activeDays: 0, monthHeaders: [] };
  return {
    days: activity.days,
    weekCount: activity.weekCount,
    totalTokens: activity.totalTokens,
    activeDays: activity.activeDays,
    monthHeaders: activity.monthHeaders.map(header => ({
      weekIndex: header.weekIndex,
      label: MONTH_NAMES[header.monthIndex] ?? "",
    })),
  };
});

let lastPulsePeerKey: string | undefined;
let lastModesKey: string | undefined;
let pulseTicket = 0;
let modesTicket = 0;
let insightsTicket = 0;
let subscribedEvents = false;
let silentPollInFlight = false;

export type AccountAuthChangeListener = (signedIn: boolean) => void;

const accountAuthListeners = new Set<AccountAuthChangeListener>();

/**
 * Subscribes to account sign-in, sign-out, and host identity-changed events so
 * scenes (DevicesScene, SidebarDeviceSwitcher, etc.) can refresh device lists
 * cleanly without circular imports.
 */
export function onAccountAuthChanged(listener: AccountAuthChangeListener): () => void {
  accountAuthListeners.add(listener);
  return () => {
    accountAuthListeners.delete(listener);
  };
}

function notifyAccountAuthChanged(signedIn: boolean): void {
  for (const listener of [...accountAuthListeners]) {
    try {
      listener(signedIn);
    } catch {
      // Never let one observer block other account listeners.
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function parseTimestampMs(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function ensureHomeEventSubscriptions(): void {
  if (subscribedEvents) return;
  subscribedEvents = true;
  listenEvent<Record<string, unknown>>("insights-progress", payload => {
    if (!insightsGenerating()) return;
    const record = asRecord(payload);
    const stage = readString(record, ["stage"]);
    const message = readString(record, ["message"]);
    const current = readNumber(record, ["current"]);
    const total = readNumber(record, ["total"]);
    const progressCount =
      current !== null && total !== null && total > 0 ? ` (${current}/${total})` : "";
    const line = [stage, message].filter(Boolean).join(": ");
    if (line || progressCount) {
      insightsProgress.set(`${line || "Generating insights"}${progressCount}`);
    }
  });
  listenEvent<Record<string, unknown>>("account-identity-changed", () => {
    void loadAccountState().then(() => {
      notifyAccountAuthChanged(isAccountSignedIn());
    });
  });
  listenEvent<Record<string, unknown>>("account://login-state", () => {
    void loadAccountState().then(() => {
      notifyAccountAuthChanged(isAccountSignedIn());
    });
  });
}

function parseGitHubUser(raw: Record<string, unknown> | null): GitHubIdentityView | null {
  if (!raw) return null;
  const userObj = asRecord(raw.user);
  const source = Object.keys(userObj).length > 0 ? userObj : raw;
  const login = readString(source, ["login", "username", "name", "handle"]);
  const accountId = readString(source, ["accountId", "account_id"]);
  const githubId = readNumber(source, ["githubId", "github_id"]);
  if (!login && !accountId && githubId === null) return null;
  return {
    login: login || accountId || `github-${githubId ?? 0}`,
    avatarUrl: readString(source, ["avatarUrl", "avatar_url"]),
    email: readString(raw, ["email"]) || readString(source, ["email"]),
    githubId,
    accountId,
  };
}

export async function loadAccountState(): Promise<void> {
  ensureHomeEventSubscriptions();
  const [statusRes, infoRes] = await Promise.allSettled([
    invokeRawCommand<{
      logged_in?: boolean;
      loggedIn?: boolean;
      user_id?: string | null;
      userId?: string | null;
    }>("account_status", {}),
    invokeRawCommand<Record<string, unknown> | null>("account_github_info", {}),
  ]);

  if (statusRes.status === "fulfilled" && statusRes.value) {
    const raw = statusRes.value;
    const loggedIn = Boolean(raw.logged_in ?? raw.loggedIn);
    const userId =
      typeof raw.user_id === "string"
        ? raw.user_id
        : typeof raw.userId === "string"
          ? raw.userId
          : null;
    accountStatus.set({ loggedIn, userId });
  } else if (statusRes.status === "rejected") {
    accountStatus.set(null);
  }

  if (infoRes.status === "fulfilled") {
    githubUser.set(parseGitHubUser(infoRes.value ?? null));
  } else {
    githubUser.set(null);
  }
}

export async function startGitHubSignIn(): Promise<void> {
  if (authLoading()) return;
  authLoading.set(true);
  authError.set("");
  authNotice.set("");
  try {
    const res = asRecord(await invokeRawCommand<Record<string, unknown>>("account_github_start", {}));
    const userCode = readString(res, ["userCode", "user_code"]);
    const verificationUri = readString(res, [
      "verificationUri",
      "verification_uri",
      "authorizationUrl",
      "authorization_url",
    ]);
    const deviceCode = readString(res, ["deviceCode", "device_code"]);
    const transactionId = readString(res, ["transactionId", "transaction_id"]);
    const intervalSeconds =
      readNumber(res, ["interval", "pollIntervalSeconds", "poll_interval_seconds"]) ?? 5;

    if (!deviceCode && !transactionId) {
      throw new Error(tr("auth.missingVerificationCode"));
    }

    githubAuthFlow.set({
      userCode,
      verificationUri,
      deviceCode,
      transactionId,
      intervalSeconds,
      status: "pending",
    });

    if (verificationUri) {
      try {
        await openUrl(verificationUri);
      } catch {
        authNotice.set(tr("auth.openUrlFallback"));
      }
    }
  } catch (error) {
    authError.set(localizeHostError(error));
  } finally {
    authLoading.set(false);
  }
}

export async function openGitHubVerificationUrl(): Promise<void> {
  const uri = githubAuthFlow()?.verificationUri;
  if (!uri) return;
  try {
    await openUrl(uri);
  } catch (error) {
    authNotice.set(tr("auth.openBrowserFailed", { error: localizeHostError(error) }));
  }
}

export function copyGitHubUserCode(): void {
  const code = githubAuthFlow()?.userCode;
  if (!code) return;
  void Clipboard.writeText(code).then(
    () => authNotice.set(tr("auth.codeCopied", { code })),
    () => authNotice.set(tr("auth.codeCopyFailed")),
  );
}

export type GitHubPollOutcome = "authorized" | "pending" | "expired" | "error" | "idle";

export async function pollGitHubSignIn(opts?: {
  silent?: boolean;
}): Promise<GitHubPollOutcome> {
  const flow = githubAuthFlow();
  const silent = Boolean(opts?.silent);
  if (!flow || authLoading() || (silent && silentPollInFlight)) return "idle";
  if (silent) {
    silentPollInFlight = true;
  } else {
    authLoading.set(true);
    authError.set("");
    authNotice.set("");
  }
  try {
    const requestPayload: Record<string, unknown> =
      flow.transactionId && !flow.deviceCode
        ? { transactionId: flow.transactionId }
        : flow.deviceCode && !flow.transactionId
          ? { deviceCode: flow.deviceCode }
          : { deviceCode: flow.deviceCode, transactionId: flow.transactionId };

    const res = await invokeCommand<{ status: string }>("account_github_poll", requestPayload);
    // Guard against cancellation while the poll request was in flight.
    if (!githubAuthFlow()) return "idle";
    const status = String(res?.status ?? "pending").toLowerCase();
    if (status === "authorized") {
      githubAuthFlow.set(null);
      authError.set("");
      authNotice.set(tr("auth.signedInNotice"));
      await loadAccountState();
      notifyAccountAuthChanged(true);
      return "authorized";
    }
    if (status === "expired") {
      githubAuthFlow.set({ ...flow, status: "expired" });
      authError.set(tr("auth.codeExpired"));
      return "expired";
    }
    githubAuthFlow.set({ ...flow, status: "pending" });
    if (!silent) {
      authNotice.set(tr("auth.pollPending"));
    }
    return "pending";
  } catch (error) {
    if (!silent) {
      authError.set(localizeHostError(error));
    }
    return "error";
  } finally {
    if (silent) {
      silentPollInFlight = false;
    } else {
      authLoading.set(false);
    }
  }
}

export function cancelGitHubSignIn(): void {
  githubAuthFlow.set(null);
  authError.set("");
  authNotice.set("");
}

export async function signOutAccount(): Promise<void> {
  if (authLoading()) return;
  authLoading.set(true);
  authError.set("");
  authNotice.set("");
  try {
    await invokeRawCommand<unknown>("account_logout", {});
    githubUser.set(null);
    accountStatus.set({ loggedIn: false, userId: null });
    githubAuthFlow.set(null);
    authNotice.set(tr("auth.signedOutNotice"));
    notifyAccountAuthChanged(false);
  } catch (error) {
    authError.set(localizeHostError(error));
  } finally {
    authLoading.set(false);
  }
}

function summarizeCronSchedule(scheduleRaw: unknown): string {
  const schedule = asRecord(scheduleRaw);
  const kind = readString(schedule, ["kind"]).toLowerCase();
  if (kind === "every") {
    const everyMs = readNumber(schedule, ["everyMs", "every_ms"]) ?? 0;
    if (everyMs >= 86_400_000 && everyMs % 86_400_000 === 0) {
      return tr("routines.scheduleEveryDay", { count: Math.round(everyMs / 86_400_000) });
    }
    if (everyMs >= 3_600_000) {
      return tr("routines.scheduleEveryHour", { count: Math.round(everyMs / 3_600_000) });
    }
    if (everyMs >= 60_000) {
      return tr("routines.scheduleEveryMin", { count: Math.round(everyMs / 60_000) });
    }
    if (everyMs > 0) {
      return tr("routines.scheduleEverySec", { count: Math.max(1, Math.round(everyMs / 1000)) });
    }
    return tr("routines.scheduleRepeating");
  }
  if (kind === "cron") {
    const expr = readString(schedule, ["expr"]);
    return expr ? tr("routines.scheduleCron", { expr }) : tr("routines.scheduleCronFallback");
  }
  if (kind === "at") {
    const at = readString(schedule, ["at"]);
    const parsed = at ? Date.parse(at) : Number.NaN;
    return at
      ? tr("routines.scheduleOnce", { time: Number.isFinite(parsed) ? formatTimestamp(parsed) : at })
      : tr("routines.scheduleOnceFallback");
  }
  return tr("routines.scheduleGeneric");
}

/** The host's due-soon routines (enabled, due within the last hour or next day, soonest first). */
function readDueRoutines(raw: unknown): DueRoutineView[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((entry, index) => {
    const job = asRecord(entry);
    const id = readString(job, ["id"]) || `routine-${index + 1}`;
    const nextRunAtMs = readNumber(job, ["nextRunAtMs"]) ?? 0;
    const rawSchedule = job.schedule;
    return {
      id,
      name: readString(job, ["name"]) || id,
      get scheduleSummary() {
        return summarizeCronSchedule(rawSchedule);
      },
      nextRunAtMs,
      get nextRunText() {
        return formatTimestamp(nextRunAtMs) || tr("common.soon");
      },
      lastRunStatus: readString(job, ["lastRunStatus"]),
    };
  });
}

/** `{status, value?, error?}` of one overview section. */
function readSection(raw: unknown): { ready: boolean; value: Record<string, unknown>; error: string } {
  const section = asRecord(raw);
  const status = readString(section, ["status"]);
  return {
    ready: status === "ready",
    value: asRecord(section.value),
    error: status === "ready" ? "" : readString(section, ["error"]) || status || "unavailable",
  };
}

export async function loadAgentModesPulse(
  workspaceId: string | null,
  expectedPeerId: string | null = peerScope()?.deviceId ?? null,
): Promise<void> {
  const ticket = ++modesTicket;
  if (!workspaceId) {
    agentsCount.set(null);
    modesCount.set(null);
    subagentsCount.set(0);
    agentsPulseNote.set("Open a workspace to inspect agents");
    return;
  }
  try {
    const [modesRes, subagentsRes] = await Promise.allSettled([
      invokeCommand<unknown[]>("get_available_modes", { workspaceId }),
      invokeCommand<unknown[]>("list_subagents", { workspaceId }),
    ]);
    if (ticket !== modesTicket || (peerScope()?.deviceId ?? null) !== expectedPeerId) return;

    if (modesRes.status === "rejected") {
      agentsCount.set(null);
      modesCount.set(null);
      subagentsCount.set(0);
      agentsPulseNote.set(errorMessage(modesRes.reason));
      return;
    }

    const modeList = Array.isArray(modesRes.value) ? modesRes.value : [];
    let visibleSubagents = 0;
    if (subagentsRes.status === "fulfilled" && Array.isArray(subagentsRes.value)) {
      visibleSubagents = subagentsRes.value.filter(raw => {
        const rec = asRecord(raw);
        const src = readString(rec, ["subagentSource", "source"]);
        const vis = asRecord(rec.visibility);
        return src !== "external" && vis.showInGlobalRegistry !== false;
      }).length;
    }
    modesCount.set(modeList.length);
    subagentsCount.set(visibleSubagents);
    agentsCount.set(modeList.length + visibleSubagents);
    agentsPulseNote.set("");
  } catch (error) {
    if (ticket !== modesTicket || (peerScope()?.deviceId ?? null) !== expectedPeerId) return;
    agentsCount.set(null);
    modesCount.set(null);
    subagentsCount.set(0);
    agentsPulseNote.set(errorMessage(error));
  }
}

/**
 * Reads Home's overview in one call. The host counts, filters and keys every
 * section (`get_personal_overview`); each section carries its own status, so a
 * failing owner leaves its note and the others still draw. A host older than
 * the command gets one "update the host" note instead of eight client reads.
 */
export async function loadEcosystemPulse(force = false): Promise<void> {
  const peerId = peerScope()?.deviceId ?? null;
  const peerKey = peerId ?? "__local__";
  if (!force && lastPulsePeerKey === peerKey) return;
  lastPulsePeerKey = peerKey;

  const ticket = ++pulseTicket;
  homePulseLoading.set(true);

  if (force) {
    assistantsPulseNote.set("");
    skillsPulseNote.set("");
    routinesPulseNote.set("");
    spacesPulseNote.set("");
    usagePulseNote.set("");
    usageActivityNote.set("");
    homeSshNote.set("");
  }

  const timeZone = resolveTimeZone();
  let overview: Record<string, unknown> | null = null;
  let failure = "";
  let outdated = false;
  try {
    overview = asRecord(
      await invokeCommand<unknown>("get_personal_overview", { timeZone, activityMonths: 6 }),
    );
  } catch (error) {
    failure = errorMessage(error);
    outdated = isCommandUnavailable(error, "get_personal_overview");
  }

  if (ticket !== pulseTicket || (peerScope()?.deviceId ?? null) !== peerId) {
    return;
  }

  const unreadable = outdated ? tr("home.overviewHostOutdated") : failure;
  const section = (key: string) =>
    overview ? readSection(overview[key]) : { ready: false, value: {}, error: unreadable };

  const assistants = section("assistants");
  assistantsCount.set(assistants.ready ? readNumber(assistants.value, ["count"]) ?? 0 : null);
  assistantsPulseNote.set(assistants.error);

  const skills = section("skills");
  skillsCount.set(skills.ready ? readNumber(skills.value, ["count"]) ?? 0 : null);
  skillsEnabledCount.set(skills.ready ? readNumber(skills.value, ["enabled"]) ?? 0 : null);
  skillsPulseNote.set(skills.error);

  const routines = section("routines");
  routinesCount.set(routines.ready ? readNumber(routines.value, ["count"]) ?? 0 : null);
  routinesEnabledCount.set(routines.ready ? readNumber(routines.value, ["enabled"]) ?? 0 : null);
  dueSoonRoutines.set(routines.ready ? readDueRoutines(routines.value.dueSoon) : []);
  routinesPulseNote.set(routines.error);

  const spaces = section("spaces");
  const spaceItems: HomeSpaceItemView[] = spaces.ready
    ? (Array.isArray(spaces.value.items) ? spaces.value.items : []).map((item, index) => {
        const rec = asRecord(item);
        const id = readString(rec, ["id"]) || `space-${index + 1}`;
        return {
          id,
          name: readString(rec, ["name"]) || id,
          description: readString(rec, ["description"]),
          icon: readString(rec, ["icon"]) || "shapes",
          running: rec.running === true,
        };
      })
    : [];
  spacesCount.set(spaces.ready ? readNumber(spaces.value, ["count"]) ?? spaceItems.length : null);
  spacesRunningCount.set(spaces.ready ? readNumber(spaces.value, ["running"]) ?? 0 : 0);
  installedSpaces.set(spaceItems);
  spacesPulseNote.set(spaces.error);

  const ssh = section("ssh");
  homeSavedSshConnections.set(
    ssh.ready && Array.isArray(ssh.value.connections)
      ? (ssh.value.connections as SavedConnection[])
      : [],
  );
  homeSshNote.set(ssh.error);

  const usage = section("usage");
  if (usage.ready) {
    usageSummary.set({
      totalTokens: readNumber(usage.value, ["totalTokens"]) ?? 0,
      totalRequests: readNumber(usage.value, ["totalRequests"]) ?? 0,
      inputTokens: readNumber(usage.value, ["inputTokens"]) ?? 0,
      outputTokens: readNumber(usage.value, ["outputTokens"]) ?? 0,
      cachedTokens: readNumber(usage.value, ["cachedTokens"]) ?? 0,
      failedRequests: readNumber(usage.value, ["failedRequests"]) ?? 0,
      topModelName: readString(usage.value, ["topModelName"]),
      trend: [],
    });
    usagePulseNote.set("");
  } else {
    usageSummary.set(null);
    usagePulseNote.set(
      usage.error.includes("token_usage_statistics_unsupported")
        ? "This host does not support usage statistics."
        : usage.error,
    );
  }

  const activity = section("activity");
  if (activity.ready) {
    homeUsageActivity.set(readUsageActivity(activity.value));
    usageActivityStatus.set("ready");
    usageActivityNote.set("");
  } else {
    homeUsageActivity.set(null);
    const unsupported =
      outdated || activity.error.includes("token_usage_statistics_unsupported");
    usageActivityStatus.set(unsupported ? "unsupported" : "failed");
    usageActivityNote.set(
      activity.error.includes("token_usage_statistics_unsupported")
        ? "This host does not support usage statistics."
        : activity.error,
    );
  }

  homePulseLoading.set(false);
}

function parseInsightsMeta(raw: unknown, index: number): InsightsReportMetaView {
  const rec = asRecord(raw);
  const path = readString(rec, ["path"]) || `report-${index + 1}`;
  const generatedMs = parseTimestampMs(rec.generated_at ?? rec.generatedAt) ?? 0;
  const generatedAtText = generatedMs > 0 ? formatTimestamp(generatedMs) : "";
  const dateRange = asRecord(rec.date_range ?? rec.dateRange);
  const start = readString(dateRange, ["start"]);
  const end = readString(dateRange, ["end"]);
  const dateRangeLabel = start && end ? `${start} to ${end}` : start || end;
  const totalSessions = readNumber(rec, ["total_sessions", "totalSessions"]) ?? 0;
  const analyzedSessions = readNumber(rec, ["analyzed_sessions", "analyzedSessions"]) ?? 0;
  const totalMessages = readNumber(rec, ["total_messages", "totalMessages"]) ?? 0;
  const daysCovered = readNumber(rec, ["days_covered", "daysCovered", "days"]) ?? 0;
  const topGoalsRaw = rec.top_goals ?? rec.topGoals;
  const topGoals = Array.isArray(topGoalsRaw)
    ? topGoalsRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const explicitTitle = readString(rec, ["title"]);
  const title =
    explicitTitle || (daysCovered > 0 ? `${daysCovered}-Day Insights` : "AI Insights Report");

  return {
    path,
    title,
    generatedAtMs: generatedMs,
    generatedAtText,
    dateRangeLabel,
    totalSessions,
    analyzedSessions,
    totalMessages,
    daysCovered,
    topGoals,
  };
}

function formatInsightsReport(raw: Record<string, unknown>, fallbackPath = ""): InsightsReportView {
  const path = readString(raw, ["path"]) || fallbackPath;
  const daysCovered = readNumber(raw, ["days_covered", "daysCovered", "days"]) ?? 0;
  const dateRange = asRecord(raw.date_range ?? raw.dateRange);
  const start = readString(dateRange, ["start"]);
  const end = readString(dateRange, ["end"]);
  const totalSessions = readNumber(raw, ["total_sessions", "totalSessions"]);
  const analyzedSessions = readNumber(raw, ["analyzed_sessions", "analyzedSessions"]);
  const totalMessages = readNumber(raw, ["total_messages", "totalMessages"]);
  const generatedMs = parseTimestampMs(raw.generated_at ?? raw.generatedAt);

  const explicitTitle = readString(raw, ["title"]);
  const title =
    explicitTitle ||
    (daysCovered > 0 ? `${daysCovered}-Day Insights Report` : "AI Insights Report");

  const subtitleParts: string[] = [];
  if (start && end) subtitleParts.push(`${start} to ${end}`);
  if (analyzedSessions !== null && totalSessions !== null) {
    subtitleParts.push(`${formatCount(analyzedSessions)}/${formatCount(totalSessions)} sessions`);
  }
  if (totalMessages !== null) subtitleParts.push(`${formatCount(totalMessages)} messages`);
  if (generatedMs) {
    const ts = formatTimestamp(generatedMs);
    if (ts) subtitleParts.push(ts);
  }
  const subtitle = subtitleParts.join(" · ");

  const directMarkdown = readString(raw, ["markdown", "content", "reportMarkdown"]);
  if (directMarkdown) {
    return {
      path,
      title,
      subtitle,
      markdown: directMarkdown,
      htmlPath: readString(raw, ["html_report_path", "htmlReportPath"]),
    };
  }

  const lines: string[] = [];
  lines.push(`# ${title}`);
  if (subtitle) lines.push(`_${subtitle}_`);

  const summary = readString(raw, ["summary"]);
  if (summary) {
    lines.push("", summary);
  }

  const atAGlance = asRecord(raw.at_a_glance ?? raw.atAGlance);
  const working = readString(atAGlance, ["whats_working", "whatsWorking"]);
  const hindering = readString(atAGlance, ["whats_hindering", "whatsHindering"]);
  const quickWins = readString(atAGlance, ["quick_wins", "quickWins"]);
  const lookingAhead = readString(atAGlance, ["looking_ahead", "lookingAhead"]);
  if (working || hindering || quickWins || lookingAhead) {
    lines.push("", "## At a Glance");
    if (working) lines.push(`- **What is working:** ${working}`);
    if (hindering) lines.push(`- **What is hindering:** ${hindering}`);
    if (quickWins) lines.push(`- **Quick wins:** ${quickWins}`);
    if (lookingAhead) lines.push(`- **Looking ahead:** ${lookingAhead}`);
  }

  const style = asRecord(raw.interaction_style ?? raw.interactionStyle);
  const narrative = readString(style, ["narrative"]);
  const keyPatterns = Array.isArray(style.key_patterns ?? style.keyPatterns)
    ? ((style.key_patterns ?? style.keyPatterns) as unknown[]).filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  if (narrative || keyPatterns.length > 0) {
    lines.push("", "## Interaction Style");
    if (narrative) lines.push("", narrative);
    for (const pattern of keyPatterns) {
      lines.push(`- ${pattern}`);
    }
  }

  const areas = Array.isArray(raw.project_areas ?? raw.projectAreas)
    ? ((raw.project_areas ?? raw.projectAreas) as unknown[])
    : [];
  if (areas.length > 0) {
    lines.push("", "## Project Areas");
    for (const item of areas) {
      const area = asRecord(item);
      const name = readString(area, ["name"]);
      const count = readNumber(area, ["session_count", "sessionCount"]);
      const desc = readString(area, ["description"]);
      if (!name && !desc) continue;
      const countText = count !== null ? ` (${formatCount(count)} sessions)` : "";
      lines.push(`- **${name || "Area"}**${countText}${desc ? `: ${desc}` : ""}`);
    }
  }

  const wins = Array.isArray(raw.big_wins ?? raw.bigWins)
    ? ((raw.big_wins ?? raw.bigWins) as unknown[])
    : [];
  if (wins.length > 0) {
    lines.push("", "## Big Wins");
    for (const item of wins) {
      const win = asRecord(item);
      const winTitle = readString(win, ["title"]);
      const desc = readString(win, ["description"]);
      const impact = readString(win, ["impact"]);
      if (!winTitle && !desc) continue;
      lines.push(`- **${winTitle || "Win"}**: ${desc}${impact ? ` _(${impact})_` : ""}`);
    }
  }

  const frictions = Array.isArray(raw.friction_categories ?? raw.frictionCategories)
    ? ((raw.friction_categories ?? raw.frictionCategories) as unknown[])
    : [];
  if (frictions.length > 0) {
    lines.push("", "## Friction Points");
    for (const item of frictions) {
      const fr = asRecord(item);
      const cat = readString(fr, ["category"]);
      const count = readNumber(fr, ["count"]);
      const desc = readString(fr, ["description"]);
      const suggestion = readString(fr, ["suggestion"]);
      lines.push(
        `- **${cat || "Category"}**${count !== null ? ` (${formatCount(count)})` : ""}: ${desc}${suggestion ? ` — Suggestion: ${suggestion}` : ""}`,
      );
    }
  }

  const horizon = Array.isArray(raw.on_the_horizon ?? raw.onTheHorizon)
    ? ((raw.on_the_horizon ?? raw.onTheHorizon) as unknown[])
    : [];
  if (horizon.length > 0) {
    lines.push("", "## On the Horizon");
    for (const item of horizon) {
      const row = asRecord(item);
      const itemTitle = readString(row, ["title"]);
      const possible = readString(row, ["whats_possible", "whatsPossible"]);
      const how = readString(row, ["how_to_try", "howToTry"]);
      lines.push(`- **${itemTitle || "Workflow"}**: ${possible}${how ? ` (${how})` : ""}`);
    }
  }

  const funEnding = asRecord(raw.fun_ending ?? raw.funEnding);
  const funHeadline = readString(funEnding, ["headline"]);
  const funDetail = readString(funEnding, ["detail"]);
  if (funHeadline || funDetail) {
    lines.push("", `## ${funHeadline || "Closing Note"}`, "", funDetail);
  }

  const markdown = lines.join("\n").trim() || "No structured report content was returned.";
  const htmlPath = readString(raw, ["html_report_path", "htmlReportPath"]);
  return { path, title, subtitle, markdown, htmlPath };
}

export async function loadLatestInsights(): Promise<void> {
  ensureHomeEventSubscriptions();
  const ticket = ++insightsTicket;
  insightsLoading.set(true);
  insightsError.set("");
  try {
    const rawList = await invokeRawCommand<Array<Record<string, unknown>>>("get_latest_insights", {});
    if (ticket !== insightsTicket) return;
    const rows = (Array.isArray(rawList) ? rawList : [])
      .map((item, idx) => parseInsightsMeta(item, idx))
      .sort((a, b) => b.generatedAtMs - a.generatedAtMs);
    insightsMetas.set(rows);
  } catch (error) {
    if (ticket !== insightsTicket) return;
    insightsError.set(errorMessage(error));
  } finally {
    if (ticket === insightsTicket) {
      insightsLoading.set(false);
    }
  }
}

export async function openInsightsReport(path: string, openModal = true): Promise<void> {
  if (!path) return;
  selectedInsightsPath.set(path);
  insightsLoading.set(true);
  insightsError.set("");
  insightsNotice.set("");
  try {
    const report = asRecord(
      await invokeCommand<Record<string, unknown>>("load_insights_report", { path }),
    );
    activeInsightsReport.set(formatInsightsReport(report, path));
    if (openModal) {
      insightsModalOpen.set(true);
    }
  } catch (error) {
    insightsError.set(errorMessage(error));
  } finally {
    insightsLoading.set(false);
  }
}

export function closeInsightsModal(): void {
  insightsModalOpen.set(false);
}

export async function generateInsightsReport(
  days: number = insightsDays(),
  modelId: string = insightsModel(),
): Promise<void> {
  ensureHomeEventSubscriptions();
  if (insightsGenerating()) return;
  insightsGenerating.set(true);
  insightsError.set("");
  insightsNotice.set("");
  insightsProgress.set(tr("home.store.insightsAnalyzing", { days: String(days) }));
  try {
    const report = asRecord(
      await invokeCommand<Record<string, unknown>>("generate_insights", {
        days,
        ...(modelId ? { modelId } : {}),
      }),
    );
    if (!insightsGenerating()) return;
    const view = formatInsightsReport(report);
    activeInsightsReport.set(view);
    if (view.path) selectedInsightsPath.set(view.path);
    insightsNotice.set(tr("home.store.insightsGenerated", { days: String(days) }));
    insightsModalOpen.set(true);
    void loadLatestInsights();
  } catch (error) {
    if (!insightsGenerating()) return;
    insightsError.set(errorMessage(error));
  } finally {
    insightsGenerating.set(false);
    insightsProgress.set("");
  }
}

/**
 * Shows the report's HTML file in the system file manager. The file lives on
 * the host that generated it, so a Peer's report cannot be opened here.
 */
export async function revealInsightsHtml(path: string): Promise<void> {
  if (!path) return;
  if (peerScope()) {
    insightsError.set(tr("home.insightsHtmlPeerUnsupported"));
    return;
  }
  try {
    await invokeCommand<unknown>("reveal_in_explorer", { path });
  } catch (error) {
    insightsError.set(errorMessage(error));
  }
}

export async function cancelInsights(): Promise<void> {
  if (!insightsGenerating()) return;
  try {
    await invokeRawCommand<unknown>("cancel_insights_generation", {});
  } catch (error) {
    insightsError.set(errorMessage(error));
  } finally {
    insightsGenerating.set(false);
    insightsProgress.set("");
    insightsNotice.set(tr("home.store.insightsCancelled"));
  }
}

export async function refreshHomeAll(): Promise<void> {
  const wsId = activeWorkspaceId();
  const peerId = peerScope()?.deviceId ?? null;
  await Promise.all([
    loadAccountState(),
    loadEcosystemPulse(true),
    loadAgentModesPulse(wsId, peerId),
    loadLatestInsights(),
  ]);
}

/** Called from HomeScene mount/scope effect so peer or workspace switches refresh cleanly. */
export function syncHomeScope(
  peerId: string | null,
  workspaceId: string | null,
  force = false,
): void {
  ensureHomeEventSubscriptions();
  const peerKey = peerId ?? "__local__";
  const modesKey = `${peerKey}::${workspaceId ?? ""}`;
  if (force || lastPulsePeerKey !== peerKey) {
    if (lastPulsePeerKey !== peerKey) {
      assistantsCount.set(null);
      agentsCount.set(null);
      modesCount.set(null);
      subagentsCount.set(0);
      skillsCount.set(null);
      skillsEnabledCount.set(null);
      routinesCount.set(null);
      routinesEnabledCount.set(null);
      dueSoonRoutines.set([]);
      spacesCount.set(null);
      spacesRunningCount.set(0);
      installedSpaces.set([]);
      homeSavedSshConnections.set([]);
      usageSummary.set(null);
      homeUsageActivity.set(null);
      usageActivityStatus.set("loading");
      selectedActivityCell.set(null);
    }
    void loadAccountState();
    void loadLatestInsights();
    void loadEcosystemPulse(true);
  }
  if (force || lastModesKey !== modesKey) {
    lastModesKey = modesKey;
    void loadAgentModesPulse(workspaceId, peerId);
  }
}

export async function submitHomeQuickPrompt(): Promise<void> {
  const prompt = homeQuickPrompt().trim();
  if (!prompt || homeQuickBusy()) return;
  homeQuickBusy.set(true);
  try {
    homeQuickPrompt.set("");
    await startQuickPromptInSession(prompt);
  } finally {
    homeQuickBusy.set(false);
  }
}

export function jumpToSessions(sessionId?: string): void {
  if (sessionId && sessions().some(item => item.sessionId === sessionId)) {
    selectSession(sessionId);
  }
  navigateScene("sessions");
}

export function formatHomeUsageLine(summary: HomeUsageSummary): string {
  const tokensText = formatTokens(summary.totalTokens) || "0";
  const reqText = formatCount(summary.totalRequests) || "0";
  const inText = formatTokens(summary.inputTokens) || "0";
  const outText = formatTokens(summary.outputTokens) || "0";
  const cachedText = formatTokens(summary.cachedTokens) || "0";
  return `${tokensText} tokens · ${reqText} requests · ${inText} in / ${outText} out · ${cachedText} cached`;
}

export function activeTurnEntries(): Array<{ sessionId: string; turnId: string; sessionName: string }> {
  const known = sessions();
  return Object.entries(runningTurns()).map(([sessionId, turnId]) => ({
    sessionId,
    turnId,
    sessionName: known.find(item => item.sessionId === sessionId)?.sessionName || sessionId,
  }));
}

export function pendingPermissionCount(): number {
  return pendingPermissions().length;
}

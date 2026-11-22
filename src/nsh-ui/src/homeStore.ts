// Account state and Account › Activity: the signed-in identity and its
// sign-in/sign-out actions (`account_*`), the usage totals and six-month
// heatmap from `get_personal_overview` (its `usage` and `activity` sections),
// and AI Insights (`*_insights*`). The Personal Hub Home screen that used to
// draw these was replaced by the OpenBitFun conversation (wave 15); its
// ecosystem pulse, quick prompt and shortcuts are gone.
//
// Account identity and Insights are controller-local on this machine even
// while driving a Peer; the overview read targets the active host and degrades
// per section, so an older host costs only the part it lacks.

import { Clipboard, computed, openUrl, signal } from "nsh";
import { readAccountIdentity, type AccountIdentity } from "./accountIdentity";
import { invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { formatCount, formatTimestamp, formatTokens } from "./format";
import { currentLocale, localizeHostError, tr } from "./i18n";
import { isCommandUnavailable } from "./hostCommands";
import {
  readUsageActivity,
  type UsageActivityCell,
  type UsageActivityView,
} from "./usageActivity";

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

/** A code the host's email sign-in sent (`account_email_start`). */
export interface EmailSignInChallenge {
  challengeId: string;
  /** The address the code went to, as the service normalized it. */
  email: string;
  codeLength: number;
  /** When another code may be requested (epoch ms). */
  resendAt: number;
}

export interface GitHubDeviceFlowState {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  transactionId: string;
  intervalSeconds: number;
  status: "pending" | "authorized" | "expired";
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
  /** True when the host reported failed sections or fewer analyzed than total sessions. */
  partialReport?: boolean;
  /** Number of report sections that failed during generation. */
  failedSections?: number;
}

/** The ranges and models the desktop's insights generator offers. */
export const INSIGHTS_DAY_OPTIONS = [7, 14, 30, 90] as const;
export const insightsDays = signal<number>(30);
/** `primary` or `fast`, the model slot the generator runs on. */
export const insightsModel = signal<"primary" | "fast">("primary");

export const accountStatus = signal<{ loggedIn: boolean; userId: string | null } | null>(null);
/** Who is signed in on this host, as the backend projects it (`account_identity`). */
export const accountIdentity = signal<AccountIdentity | null>(null);
export const githubAuthFlow = signal<GitHubDeviceFlowState | null>(null);
/** The host's email sign-in waiting for its code; `null` on the email step. */
export const emailChallenge = signal<EmailSignInChallenge | null>(null);
export const authLoading = signal(false);
export const authNotice = signal("");
export const authError = signal("");

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
  () => accountIdentity() !== null || accountStatus()?.loggedIn === true,
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

let activityLoaded = false;
let activityTicket = 0;
let insightsTicket = 0;
let subscribedEvents = false;
let silentPollInFlight = false;

export type AccountAuthChangeListener = (signedIn: boolean) => void;

const accountAuthListeners = new Set<AccountAuthChangeListener>();

/**
 * Subscribes to account sign-in, sign-out, and host identity-changed events so
 * scenes (the device page, All sessions, etc.) can refresh device lists
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

export async function loadAccountState(): Promise<void> {
  ensureHomeEventSubscriptions();
  const [statusRes, infoRes] = await Promise.allSettled([
    invokeRawCommand<{
      logged_in?: boolean;
      loggedIn?: boolean;
      user_id?: string | null;
      userId?: string | null;
    }>("account_status", {}),
    invokeRawCommand<Record<string, unknown> | null>("account_identity", {}),
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
    accountIdentity.set(readAccountIdentity(infoRes.value));
  } else {
    accountIdentity.set(null);
  }
}

/**
 * The words for a failed email sign-in step. The host answers
 * `<code>: <sentence>` (`invalid_email`, `invalid_code`, `rate_limited`,
 * `unsupported`, `network`, `unavailable`); the code picks the copy.
 */
function emailSignInError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const code = /^([a-z_]+):/.exec(raw.trim())?.[1] ?? "";
  switch (code) {
    case "invalid_email":
      return tr("signin.errEmail");
    case "invalid_code":
      return tr("signin.errCode");
    case "rate_limited":
      return tr("controller.error.rateLimited");
    case "network":
      return tr("signin.errNetwork");
    case "unsupported":
      return tr("signin.errUnsupported");
    default:
      return localizeHostError(raw.replace(/^[a-z_]+:\s*/, ""));
  }
}

/** Sends a sign-in code to `email` (also "send a new code"); the code step follows. */
export async function requestEmailCode(email: string): Promise<void> {
  if (authLoading() || !email.trim()) return;
  authLoading.set(true);
  authError.set("");
  authNotice.set("");
  try {
    const answer = asRecord(
      await invokeCommand<Record<string, unknown>>("account_email_start", {
        email: email.trim(),
        locale: currentLocale(),
      }),
    );
    const challengeId = readString(answer, ["challengeId"]);
    if (!challengeId) throw new Error("unavailable: The sign-in service answered unexpectedly.");
    const retry = readNumber(answer, ["retryAfterSeconds"]) ?? 60;
    emailChallenge.set({
      challengeId,
      email: readString(answer, ["email"]) || email.trim(),
      codeLength: readNumber(answer, ["codeLength"]) ?? 8,
      resendAt: Date.now() + Math.max(0, retry) * 1000,
    });
  } catch (error) {
    authError.set(emailSignInError(error));
  } finally {
    authLoading.set(false);
  }
}

/** Completes the email sign-in with the code; the host finishes the account session. */
export async function verifyEmailCode(code: string): Promise<boolean> {
  const challenge = emailChallenge();
  const typed = code.replace(/\s+/g, "");
  if (!challenge || authLoading() || !typed) return false;
  authLoading.set(true);
  authError.set("");
  try {
    const answer = asRecord(
      await invokeCommand<Record<string, unknown>>("account_email_verify", {
        challengeId: challenge.challengeId,
        code: typed,
      }),
    );
    emailChallenge.set(null);
    accountIdentity.set(readAccountIdentity(answer.identity));
    await loadAccountState();
    notifyAccountAuthChanged(true);
    return true;
  } catch (error) {
    authError.set(emailSignInError(error));
    return false;
  } finally {
    authLoading.set(false);
  }
}

/** Back to the email step (another address, or the dialog closed). */
export function cancelEmailSignIn(): void {
  emailChallenge.set(null);
  authError.set("");
  authNotice.set("");
}

export async function startGitHubSignIn(): Promise<void> {
  if (authLoading()) return;
  emailChallenge.set(null);
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
    accountIdentity.set(null);
    emailChallenge.set(null);
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

/**
 * Reads Account › Activity in one call: the `usage` totals and the six-month
 * `activity` heatmap of `get_personal_overview`. The host counts and keys
 * every section and each carries its own status, so one failing section
 * leaves its note and the other still draws. A host older than the command
 * gets one "update the host" note.
 */
export async function loadAccountActivity(force = false): Promise<void> {
  if (!force && activityLoaded) return;
  activityLoaded = true;
  const ticket = ++activityTicket;
  if (force) {
    usagePulseNote.set("");
    usageActivityNote.set("");
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

  if (ticket !== activityTicket) return;

  const unreadable = outdated ? tr("home.overviewHostOutdated") : failure;
  const section = (key: string) =>
    overview ? readSection(overview[key]) : { ready: false, value: {}, error: unreadable };

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
}

/** Reads everything Account › Activity draws: the identity, the totals and heatmap, and the latest insights. */
export async function refreshAccountActivity(): Promise<void> {
  ensureHomeEventSubscriptions();
  await Promise.all([loadAccountState(), loadAccountActivity(true), loadLatestInsights()]);
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
  const failedSections = readNumber(raw, ["failed_sections", "failedSections"]) ?? 0;
  const partialReport =
    raw.partial_report === true ||
    raw.partialReport === true ||
    failedSections > 0 ||
    (analyzedSessions !== null && totalSessions !== null && analyzedSessions < totalSessions);
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
  if (partialReport) {
    subtitleParts.push(
      failedSections > 0 ? `Partial report (${formatCount(failedSections)} failed sections)` : "Partial report",
    );
  }
  if (generatedMs) {
    const ts = formatTimestamp(generatedMs);
    if (ts) subtitleParts.push(ts);
  }
  const subtitle = subtitleParts.join(" · ");

  const partialBanner = partialReport
    ? failedSections > 0
      ? `> Partial report: ${formatCount(failedSections)} report section${failedSections === 1 ? "" : "s"} failed to generate.`
      : "> Partial report: some sessions could not be analyzed."
    : "";

  const directMarkdown = readString(raw, ["markdown", "content", "reportMarkdown"]);
  if (directMarkdown) {
    const markdownWithPartial =
      partialBanner && !/partial report/i.test(directMarkdown)
        ? `${partialBanner}\n\n${directMarkdown}`
        : directMarkdown;
    return {
      path,
      title,
      subtitle,
      markdown: markdownWithPartial,
      htmlPath: readString(raw, ["html_report_path", "htmlReportPath"]),
      partialReport,
      failedSections,
    };
  }

  const lines: string[] = [];
  lines.push(`# ${title}`);
  if (subtitle) lines.push(`_${subtitle}_`);
  if (partialBanner) {
    lines.push("", partialBanner);
  }

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
  return { path, title, subtitle, markdown, htmlPath, partialReport, failedSections };
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

let activeInsightsGenerationId: string | null = null;

export async function generateInsightsReport(
  days: number = insightsDays(),
  modelId: string = insightsModel(),
): Promise<void> {
  ensureHomeEventSubscriptions();
  if (insightsGenerating()) return;
  const generationId = `insights-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  activeInsightsGenerationId = generationId;
  insightsGenerating.set(true);
  insightsError.set("");
  insightsNotice.set("");
  insightsProgress.set(tr("home.store.insightsAnalyzing", { days: String(days) }));
  try {
    const report = asRecord(
      await invokeCommand<Record<string, unknown>>("generate_insights", {
        days,
        ...(modelId ? { modelId } : {}),
        generationId,
      }),
    );
    if (!insightsGenerating() || activeInsightsGenerationId !== generationId) return;
    const view = formatInsightsReport(report);
    activeInsightsReport.set(view);
    if (view.path) selectedInsightsPath.set(view.path);
    insightsNotice.set(tr("home.store.insightsGenerated", { days: String(days) }));
    insightsModalOpen.set(true);
    void loadLatestInsights();
  } catch (error) {
    if (!insightsGenerating() || activeInsightsGenerationId !== generationId) return;
    insightsError.set(errorMessage(error));
  } finally {
    if (activeInsightsGenerationId === generationId) {
      activeInsightsGenerationId = null;
      insightsGenerating.set(false);
      insightsProgress.set("");
    }
  }
}

/**
 * Shows the report's HTML file in the system file manager. The file lives on
 * the host that generated it, so a Peer's report cannot be opened here.
 */
export async function revealInsightsHtml(path: string): Promise<void> {
  if (!path) return;
  try {
    await invokeCommand<unknown>("reveal_in_explorer", { path });
  } catch (error) {
    insightsError.set(errorMessage(error));
  }
}

export async function cancelInsights(): Promise<void> {
  if (!insightsGenerating()) return;
  const generationId = activeInsightsGenerationId;
  activeInsightsGenerationId = null;
  try {
    await invokeCommand<unknown>(
      "cancel_insights_generation",
      generationId ? { generationId } : {},
    );
  } catch (error) {
    insightsError.set(errorMessage(error));
  } finally {
    insightsGenerating.set(false);
    insightsProgress.set("");
    insightsNotice.set(tr("home.store.insightsCancelled"));
  }
}

export function formatHomeUsageLine(summary: HomeUsageSummary): string {
  const tokensText = formatTokens(summary.totalTokens) || "0";
  const reqText = formatCount(summary.totalRequests) || "0";
  const inText = formatTokens(summary.inputTokens) || "0";
  const outText = formatTokens(summary.outputTokens) || "0";
  const cachedText = formatTokens(summary.cachedTokens) || "0";
  return `${tokensText} tokens · ${reqText} requests · ${inText} in / ${outText} out · ${cachedText} cached`;
}

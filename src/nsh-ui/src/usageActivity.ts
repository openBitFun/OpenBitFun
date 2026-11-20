// The usage activity heatmap, as the host computes it.
//
// `get_token_usage_activity` keys every usage record into a calendar day of one
// IANA zone, lays the days on a Monday-first week grid, scales the five shades
// and counts the streaks. Home and the Usage page both read it here, so the two
// mark the same cells: nothing below re-keys, rescales or recounts a day. A host
// older than the command gets an explicit "update the host" state instead of a
// client-side projection of trend buckets.

import { invokeCommand } from "./bridge";
import { isCommandUnavailable } from "./hostCommands";

export const USAGE_ACTIVITY_COMMAND = "get_token_usage_activity";
/** The desktop's activity panel covers this many calendar months. */
export const USAGE_ACTIVITY_MONTHS = 6;

export interface UsageActivityCell {
  /** `YYYY-MM-DD` of the calendar day, in the zone the host keyed it in. */
  key: string;
  /** 0-based, for month labels. */
  monthIndex: number;
  dayOfMonth: number;
  tokens: number;
  /** 0 for a quiet day, 4 for the busiest day in the window. */
  level: 0 | 1 | 2 | 3 | 4;
  /** False for the leading and trailing padding cells of the grid. */
  inRange: boolean;
}

export interface UsageActivityView {
  timeZone: string;
  startDate: string;
  endDate: string;
  weekCount: number;
  days: UsageActivityCell[];
  /** The week column each labelled month starts in; `monthIndex` is 0-based. */
  monthHeaders: Array<{ weekIndex: number; monthIndex: number }>;
  totalTokens: number;
  peakTokens: number;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
}

/** Why the grid is missing: the host lacks the command, or it failed. */
export class UsageActivityUnavailable extends Error {
  constructor(
    readonly reason: "host_outdated" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/**
 * The IANA zone the host keys days in. `Date` carries no zone, so the resolved
 * zone name is the only source; it is a value handed to the host, not a date
 * this surface formats.
 */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads the host's answer; every number is the host's. */
export function readUsageActivity(raw: unknown): UsageActivityView {
  const value = record(raw);
  const days = (Array.isArray(value.days) ? value.days : []).map(entry => {
    const day = record(entry);
    const level = Math.max(0, Math.min(4, Math.round(num(day.level)))) as UsageActivityCell["level"];
    return {
      key: String(day.date ?? ""),
      monthIndex: Math.max(0, num(day.month) - 1),
      dayOfMonth: num(day.dayOfMonth),
      tokens: num(day.tokens),
      level,
      inRange: day.inRange === true,
    };
  });
  const monthHeaders = (Array.isArray(value.monthHeaders) ? value.monthHeaders : []).map(entry => {
    const header = record(entry);
    return { weekIndex: num(header.weekIndex), monthIndex: Math.max(0, num(header.month) - 1) };
  });
  return {
    timeZone: String(value.timeZone ?? ""),
    startDate: String(value.startDate ?? ""),
    endDate: String(value.endDate ?? ""),
    weekCount: num(value.weekCount),
    days,
    monthHeaders,
    totalTokens: num(value.totalTokens),
    peakTokens: num(value.peakTokens),
    activeDays: num(value.activeDays),
    longestStreak: num(value.longestStreak),
    currentStreak: num(value.currentStreak),
  };
}

/** One read of the heatmap in this surface's zone. */
export async function fetchUsageActivity(months = USAGE_ACTIVITY_MONTHS): Promise<UsageActivityView> {
  const timeZone = localTimeZone();
  try {
    const raw = await invokeCommand<unknown>(USAGE_ACTIVITY_COMMAND, {
      months,
      includeSubagent: true,
      ...(timeZone ? { timeZone } : {}),
    });
    return readUsageActivity(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCommandUnavailable(error, USAGE_ACTIVITY_COMMAND)) {
      throw new UsageActivityUnavailable("host_outdated", message);
    }
    throw new UsageActivityUnavailable("failed", message);
  }
}

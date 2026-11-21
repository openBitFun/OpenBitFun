// Session goal (wave 22 P5). A goal is a fact of the session on the device
// that runs it: `get_session_thread_goal` reads it, `activate_session_goal`
// sets the objective (the same path `/goal <objective>` takes), and
// `agentic://thread-goal-updated` carries every change the runtime makes
// (accounting, continuation, completion). This store keeps the backend's
// answer per session and decides nothing: status words, budgets and the end of
// a goal all come from the runtime.

import { signal } from "nsh";
import { fleetActive, invokeCommand, listenEvent, type InvokeCommandOptions } from "./bridge";
import { isMissingCommand } from "./settingsMutations";

export type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

/** The runtime's `ThreadGoal`, as it serializes it (camelCase). Fields stay optional: newer hosts add more. */
export interface SessionGoal {
  goalId?: string;
  sessionId?: string;
  objective: string;
  status: GoalStatus | string;
  tokenBudget?: number | null;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  updatedAt?: number;
}

/** Where a session lives: its device (fleet) and owning workspace. */
export interface GoalTarget {
  sessionId: string;
  deviceId: string;
  workspaceId?: string | null;
}

/** Goals by `"<deviceId>/<sessionId>"`; `null` = the host has none, absent = not read yet. */
export const sessionGoals = signal<Record<string, SessionGoal | null>>({});
/** Sessions whose host predates the goal commands. */
export const goalUnsupported = signal<Record<string, boolean>>({});
export const goalBusy = signal(false);

function keyOf(target: Pick<GoalTarget, "sessionId" | "deviceId">): string {
  return `${target.deviceId}/${target.sessionId}`;
}

function routeOf(target: GoalTarget): InvokeCommandOptions | undefined {
  return fleetActive() && target.deviceId ? { target: target.deviceId } : undefined;
}

function requestOf(target: GoalTarget, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: target.sessionId,
    ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    ...extra,
  };
}

/** Reads a goal object off the wire; anything without an objective is "no goal". */
export function readGoal(raw: unknown): SessionGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const objective = typeof value.objective === "string" ? value.objective : "";
  if (!objective.trim()) return null;
  return {
    objective,
    status: typeof value.status === "string" ? value.status : "active",
    ...(typeof value.goalId === "string" ? { goalId: value.goalId } : {}),
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    ...(typeof value.tokenBudget === "number" ? { tokenBudget: value.tokenBudget } : {}),
    ...(typeof value.tokensUsed === "number" ? { tokensUsed: value.tokensUsed } : {}),
    ...(typeof value.timeUsedSeconds === "number" ? { timeUsedSeconds: value.timeUsedSeconds } : {}),
    ...(typeof value.updatedAt === "number" ? { updatedAt: value.updatedAt } : {}),
  };
}

function store(key: string, goal: SessionGoal | null): void {
  sessionGoals.set({ ...sessionGoals(), [key]: goal });
}

export function goalOf(target: Pick<GoalTarget, "sessionId" | "deviceId">): SessionGoal | null {
  return sessionGoals()[keyOf(target)] ?? null;
}

export function goalIsUnsupported(target: Pick<GoalTarget, "sessionId" | "deviceId">): boolean {
  return goalUnsupported()[keyOf(target)] === true;
}

/** Whether the goal is still being worked toward (the runtime's `is_active`). */
export function goalIsActive(goal: SessionGoal | null): boolean {
  return goal !== null && (goal.status === "active" || goal.status === "budgetLimited");
}

/** Reads the session's goal from its device. A host without the command is remembered as unsupported. */
export async function loadSessionGoal(target: GoalTarget): Promise<void> {
  const key = keyOf(target);
  try {
    const answer = await invokeCommand<{ goal?: unknown }>("get_session_thread_goal", requestOf(target), routeOf(target));
    store(key, readGoal(answer?.goal));
  } catch (error) {
    if (isMissingCommand(error, "get_session_thread_goal")) {
      goalUnsupported.set({ ...goalUnsupported(), [key]: true });
    }
    // An unreadable goal draws nothing; the session itself stays usable.
  }
}

/** Sets (or replaces) the session's objective; the runtime starts working toward it. */
export async function setSessionGoal(target: GoalTarget, objective: string): Promise<void> {
  const text = objective.trim();
  if (!text) return;
  goalBusy.set(true);
  try {
    const answer = await invokeCommand<{ goal?: unknown }>(
      "activate_session_goal",
      requestOf(target, { userHint: text }),
      routeOf(target),
    );
    store(keyOf(target), readGoal(answer?.goal));
  } finally {
    goalBusy.set(false);
  }
}

/** Edits the objective of the goal the session already has. */
export async function updateSessionGoalObjective(target: GoalTarget, objective: string): Promise<void> {
  const text = objective.trim();
  if (!text) return;
  goalBusy.set(true);
  try {
    const answer = await invokeCommand<unknown>(
      "update_session_thread_goal_objective",
      requestOf(target, { objective: text }),
      routeOf(target),
    );
    const goal = readGoal(answer);
    if (goal) store(keyOf(target), goal);
    else await loadSessionGoal(target);
  } finally {
    goalBusy.set(false);
  }
}

/** Pauses, resumes or completes the goal; the host validates the status. */
export async function setSessionGoalStatus(target: GoalTarget, status: "active" | "paused" | "complete"): Promise<void> {
  goalBusy.set(true);
  try {
    const answer = await invokeCommand<unknown>(
      "set_session_thread_goal_status",
      requestOf(target, { status }),
      routeOf(target),
    );
    const goal = readGoal(answer);
    if (goal) store(keyOf(target), goal);
    else await loadSessionGoal(target);
  } finally {
    goalBusy.set(false);
  }
}

export async function clearSessionGoal(target: GoalTarget): Promise<void> {
  goalBusy.set(true);
  try {
    await invokeCommand<unknown>("clear_session_thread_goal", requestOf(target), routeOf(target));
    store(keyOf(target), null);
  } finally {
    goalBusy.set(false);
  }
}

let subscribed = false;

/** Follows the runtime's goal updates for every session this client has read. */
export function subscribeGoalEvents(): void {
  if (subscribed) return;
  subscribed = true;
  listenEvent<{ sessionId?: string; goal?: unknown }>("agentic://thread-goal-updated", (payload, meta) => {
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
    if (!sessionId) return;
    store(`${meta.origin}/${sessionId}`, readGoal(payload?.goal));
  });
}

/** Test seam: forgets every goal and the subscription flag. */
export function resetGoalStore(): void {
  sessionGoals.set({});
  goalUnsupported.set({});
}

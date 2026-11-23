// What the composer shows about the session beyond its text: the permission mode
// the next tool call runs under, and how full the model's context window is.
//
// Permission mode: `get_session_permission_mode` answers the session's own
// choice (`null` when it follows the user-level default, which
// `permissionPolicyStore` reads) and a one-off override of the running turn.
// A press writes `update_session_permission_mode`; while a turn runs the same
// choice also goes to `update_active_turn_permission_mode`, so the running turn
// picks it up at its next model round, as the desktop's composer does. A host
// without the commands (older build, plain Peer) hides the pill instead of
// pretending a mode was set.
//
// Context usage: `agentic://token-usage-updated` reports the tokens the last
// request sent and the window it ran in; ACP agents report
// `agentic://acp-context-usage-updated` instead. Nothing is estimated here — a
// session without either reading shows no ring.

import { signal } from "nsh";
import { invokeCommand, listenEvent } from "./bridge";
import { tr } from "./i18n";
import { ensurePermissions, permissionMode, type PermissionMode } from "./permissionPolicyStore";
import { activeSessionId, activeWorkspaceId, activeWorkspaceRoot, runningTurnId } from "./state";

export interface SessionPermissionState {
  /** The session's own choice; `null` follows the default. */
  mode: PermissionMode | null;
  /** The running turn's one-off override, when there is one. */
  turnMode: PermissionMode | null;
}

export const sessionPermissionModes = signal<Record<string, SessionPermissionState>>({});
/** `false` once a host refused the read: the pill is then not drawn. */
export const permissionModeSupported = signal<boolean | null>(null);
export const permissionModeNotice = signal("");
export const permissionModePickerOpen = signal(false);

function modeOf(value: unknown): PermissionMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "ask") return "ask";
  if (normalized === "auto" || normalized === "auto_approve" || normalized === "autoapprove") return "auto";
  if (normalized === "full_access" || normalized === "fullaccess") return "full_access";
  return null;
}

function adopt(sessionId: string, reply: unknown): void {
  const record = (reply && typeof reply === "object" ? reply : {}) as Record<string, unknown>;
  sessionPermissionModes.update(current => ({
    ...current,
    [sessionId]: {
      mode: modeOf(record.mode),
      turnMode: modeOf(record.turnMode ?? record.turn_mode),
    },
  }));
}

function scope(options?: { workspaceId?: string | null; workspacePath?: string | null }): Record<string, unknown> {
  const workspaceId = options?.workspaceId !== undefined ? options.workspaceId : activeWorkspaceId();
  const workspacePath = options?.workspacePath !== undefined ? options.workspacePath : activeWorkspaceRoot();
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspacePath ? { workspacePath } : {}),
  };
}

export async function loadSessionPermissionMode(
  sessionId: string | null,
  options?: { workspaceId?: string | null; workspacePath?: string | null; turnId?: string | null },
): Promise<void> {
  if (!sessionId) return;
  ensurePermissions();
  try {
    const turnId = options?.turnId !== undefined ? options.turnId : runningTurnId();
    const reply = await invokeCommand<unknown>("get_session_permission_mode", {
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...scope(options),
    });
    adopt(sessionId, reply);
    permissionModeSupported.set(true);
  } catch {
    permissionModeSupported.set(false);
  }
}

/** The mode the next tool call of a session runs under. */
export function effectivePermissionMode(sessionId: string | null): PermissionMode {
  const state = sessionId ? sessionPermissionModes()[sessionId] : undefined;
  return state?.turnMode ?? state?.mode ?? permissionMode() ?? "ask";
}

/** Whether the session follows the user-level default rather than its own choice. */
export function followsDefaultMode(sessionId: string | null): boolean {
  const state = sessionId ? sessionPermissionModes()[sessionId] : undefined;
  return !state?.mode && !state?.turnMode;
}

export async function chooseSessionPermissionMode(
  mode: PermissionMode | null,
  options?: { sessionId?: string | null; workspaceId?: string | null; workspacePath?: string | null; turnId?: string | null },
): Promise<void> {
  const sessionId = options?.sessionId !== undefined ? options.sessionId : activeSessionId();
  if (!sessionId) return;
  permissionModePickerOpen.set(false);
  permissionModeNotice.set("");
  const turnId = options?.turnId !== undefined ? options.turnId : runningTurnId();
  try {
    adopt(
      sessionId,
      await invokeCommand<unknown>("update_session_permission_mode", {
        sessionId,
        mode,
        ...(turnId ? { turnId } : {}),
        ...scope(options),
      }),
    );
    if (turnId) {
      adopt(
        sessionId,
        await invokeCommand<unknown>("update_active_turn_permission_mode", {
          sessionId,
          turnId,
          mode,
          ...scope(options),
        }),
      );
    }
  } catch (error) {
    permissionModeNotice.set(
      tr("chat.permissionMode.notSaved", { reason: error instanceof Error ? error.message : String(error) }),
    );
  }
}

export interface ContextUsage {
  used: number;
  max: number | null;
  output?: number;
  cached?: number;
  model?: string;
}

/** Session id → the last context reading the host sent for it. */
export const contextUsage = signal<Record<string, ContextUsage>>({});

function num(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

let subscribed = false;

export function subscribeContextUsage(): void {
  if (subscribed) return;
  subscribed = true;
  listenEvent<Record<string, unknown>>("agentic://token-usage-updated", payload => {
    if (!payload) return;
    const sessionId = String(payload.sessionId ?? payload.session_id ?? "");
    if (!sessionId) return;
    if (payload.isSubagent === true || payload.is_subagent === true) return;
    const used = num(payload, "inputTokens", "input_tokens");
    if (used === undefined) return;
    const max = num(payload, "maxContextTokens", "max_context_tokens") ?? null;
    const model = payload.effectiveModelName ?? payload.effective_model_name;
    contextUsage.update(current => ({
      ...current,
      [sessionId]: {
        used,
        max,
        ...(num(payload, "outputTokens", "output_tokens") !== undefined
          ? { output: num(payload, "outputTokens", "output_tokens") }
          : {}),
        ...(num(payload, "cachedTokens", "cached_tokens") !== undefined
          ? { cached: num(payload, "cachedTokens", "cached_tokens") }
          : {}),
        ...(typeof model === "string" && model ? { model } : {}),
      },
    }));
  });
  listenEvent<Record<string, unknown>>("agentic://acp-context-usage-updated", payload => {
    if (!payload) return;
    const sessionId = String(payload.sessionId ?? payload.session_id ?? "");
    const used = num(payload, "used");
    if (!sessionId || used === undefined) return;
    const size = num(payload, "size");
    contextUsage.update(current => ({ ...current, [sessionId]: { used, max: size && size > 0 ? size : null } }));
  });
}

/** Seeds a session's ring from the reading its metadata persisted, until a live one arrives. */
export function seedContextUsage(sessionId: string, persisted: unknown, maxFallback: number | null): void {
  if (!persisted || typeof persisted !== "object" || contextUsage()[sessionId]) return;
  const record = persisted as Record<string, unknown>;
  const used = num(record, "inputTokens", "input_tokens");
  if (used === undefined) return;
  contextUsage.update(current => ({ ...current, [sessionId]: { used, max: maxFallback } }));
}

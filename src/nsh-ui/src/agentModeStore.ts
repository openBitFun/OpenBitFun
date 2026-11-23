// The agent a session runs as: one of the four built-in execution profiles, or an
// agent the host configured itself, external ACP agents included.
//
// The host owns all of it. `get_session_mode_catalog` answers the entries in the
// order every composer draws them (profiles first, retired and assistant-only ids
// left out, aliases resolved), which of them the session may switch to — a
// session that already ran a turn keeps its agent — and the default a new session
// starts as, resolved from the `app.flow_chat` preference. `update_session_mode`
// refuses to rebind a started session (`session_mode_locked`) and records the pick
// as `last_mode_id`. This store only mirrors the answer for the composer.
//
// A host older than the catalog command still answers `get_available_modes`; its
// rows are drawn as the host lists them, with a notice that ordering and defaults
// need a newer host, instead of this surface re-deriving the rules.

import { computed, signal } from "nsh";
import {
  getAvailableModes,
  getSessionModeCatalog,
  updateSessionMode,
  type SessionModeCatalogEntry,
} from "./api";
import { tr } from "./i18n";
import { isCommandUnavailable as isMissingCommand } from "./hostCommands";
import {
  DEFAULT_AGENT_TYPE,
  activeSessionId,
  activeWorkspaceId,
  activeWorkspaceRoot,
  agentTypeOf,
  chosenAgentType,
  createSessionInWorkspace,
  onSessionSwitch,
  onWorkspaceChanged,
  runStep,
  sessionAgentTypes,
  sessionKey,
  sessionStarted,
  sessions,
  workspaces,
} from "./state";

export interface AgentChoice {
  id: string;
  label: string;
  description: string;
  /** One of the four built-in profiles rather than a configured or external agent. */
  profile: boolean;
  /** Whether the open session can be bound to this agent now (host decision). */
  switchable: boolean;
}

export const agentChoices = signal<AgentChoice[]>([]);
/** Whether the host answered the catalogue; a host without the command keeps this false. */
export const agentCatalogAnswered = signal(false);
export const agentCatalogNotice = signal("");
export const agentPickerOpen = signal(false);
/** A mode whose press needs a new session, because this one already started. */
export const pendingAgentSession = signal<string | null>(null);
export const agentNotice = signal("");
/** Whether the host said the open session already started (its agent is fixed). */
export const catalogSessionStarted = signal<boolean | null>(null);

export const agentProfiles = computed<AgentChoice[]>(() =>
  agentChoices().filter(choice => choice.profile));
export const agentAgents = computed<AgentChoice[]>(() =>
  agentChoices().filter(choice => !choice.profile));

/** Whether the open session's agent is fixed: the host's word, else the row's turn count. */
export const activeSessionStarted = computed(() => {
  const fromHost = catalogSessionStarted();
  return fromHost ?? sessionStarted(activeSessionId());
});

/**
 * Whether this workspace offers only one agent (e.g. an Assistant workspace
 * locked to Claw) and the open session or draft already uses it.
 */
export const agentModeLockedToSingle = computed(() => {
  if (!agentCatalogAnswered()) return false;
  const choices = agentChoices();
  if (choices.length !== 1) return false;
  return agentIdsMatch(agentTypeOf(activeSessionId()), choices[0].id);
});

/** Two agent ids name the same agent when they differ only by case or spacing. */
export function agentIdsMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** What to show for an agent, falling back to its id when the host does not list it. */
export function agentLabel(agentType: string): string {
  const id = (agentType ?? "").trim();
  if (!id) return DEFAULT_AGENT_TYPE;
  const listed = agentChoices().find(choice => agentIdsMatch(choice.id, id));
  return listed ? listed.label : id;
}

function choiceOf(entry: SessionModeCatalogEntry): AgentChoice {
  return {
    id: entry.id,
    label: entry.label || entry.id,
    description: entry.description ?? "",
    profile: entry.profile === true,
    switchable: entry.switchable !== false,
  };
}

/** The catalogue key the last read answered: workspace and open session. */
let catalogueKey: string | null = null;
let loadingKey: string | null = null;
/** An explicit pick made with no session open, recorded once a session takes it. */
let pendingModeRecord: string | null = null;

function keyOf(workspaceId: string, sessionId: string | null): string {
  return `${workspaceId}\u0000${sessionId ?? ""}`;
}

/** Returns the active session only when it belongs to `workspaceId`. */
function sessionIdForWorkspace(workspaceId: string): string | null {
  if (activeWorkspaceId() !== workspaceId) return null;
  const sid = activeSessionId();
  if (!sid) return null;
  const row = sessions().find(item => item.sessionId === sid);
  if (row?.workspaceId && row.workspaceId !== workspaceId) return null;
  return sid;
}

/**
 * Reads the catalogue for the open workspace and session. The composer asks on
 * mount and whenever either changes; a repeated call for the same pair is free.
 */
export function ensureAgentModes(): void {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return;
  const key = keyOf(workspaceId, sessionIdForWorkspace(workspaceId));
  if (key === catalogueKey || key === loadingKey) return;
  void loadAgentModes(workspaceId);
}

/** Re-reads the catalogue, for a host that failed the first time or just changed. */
export function reloadAgentModes(): void {
  catalogueKey = null;
  agentCatalogNotice.set("");
  ensureAgentModes();
}

export async function loadAgentModes(workspaceId: string): Promise<string | null> {
  const sessionId = sessionIdForWorkspace(workspaceId);
  const key = keyOf(workspaceId, sessionId);
  loadingKey = key;
  const root = workspaces().find(item => item.id === workspaceId)?.rootPath || activeWorkspaceRoot();
  try {
    const catalog = await getSessionModeCatalog({
      workspaceId,
      ...(root ? { workspacePath: root } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
    // A read for a workspace the user already left must not publish.
    if (activeWorkspaceId() !== workspaceId) return null;
    const sameSession = sessionIdForWorkspace(workspaceId) === sessionId;
    if (sameSession) {
      catalogueKey = key;
      catalogSessionStarted.set(sessionId ? catalog.sessionStarted === true : null);
    }
    const entries = (catalog.entries ?? []).map(choiceOf);
    agentChoices.set(entries);
    if (
      pendingModeRecord !== null &&
      !entries.some(entry => agentIdsMatch(entry.id, pendingModeRecord!))
    ) {
      pendingModeRecord = null;
    }
    const pendingSwitch = pendingAgentSession();
    if (pendingSwitch && !entries.some(entry => agentIdsMatch(entry.id, pendingSwitch))) {
      pendingAgentSession.set(null);
    }
    // Sync the default whenever no session is open without a valid draft pick,
    // or whenever the previously chosen agent is not in this workspace's catalog
    // (for example switching between a project workspace and an Assistant workspace).
    if (catalog.defaultModeId) {
      const chosenInCatalog = entries.some(entry => agentIdsMatch(entry.id, chosenAgentType()));
      if ((!sessionId && pendingModeRecord === null) || (entries.length > 0 && !chosenInCatalog)) {
        chosenAgentType.set(catalog.defaultModeId);
      }
    }
    agentCatalogAnswered.set(true);
    agentCatalogNotice.set("");
    if (agentModeLockedToSingle()) {
      agentPickerOpen.set(false);
    }
    return catalog.defaultModeId ?? null;
  } catch (error) {
    if (activeWorkspaceId() !== workspaceId) return null;
    if (sessionIdForWorkspace(workspaceId) === sessionId) {
      catalogueKey = key;
    }
    if (isMissingCommand(error, "get_session_mode_catalog")) {
      await loadLegacyModes(workspaceId, root);
      return null;
    }
    agentChoices.set([]);
    catalogSessionStarted.set(null);
    agentCatalogAnswered.set(false);
    agentCatalogNotice.set(
      tr("sessions.agentCatalogUnavailable", { error: error instanceof Error ? error.message : String(error) }),
    );
    return null;
  } finally {
    if (loadingKey === key) loadingKey = null;
  }
}

/** An older host: its rows as listed, with a notice that the rules need an update. */
async function loadLegacyModes(workspaceId: string, root: string): Promise<void> {
  try {
    const rows = await getAvailableModes(workspaceId, root || undefined);
    if (activeWorkspaceId() !== workspaceId) return;
    agentChoices.set(
      (rows ?? [])
        .filter(row => typeof row?.id === "string" && row.id.trim())
        .map(row => ({
          id: row.id.trim(),
          label: (row.name ?? "").trim() || row.id.trim(),
          description: (row.description ?? "").trim(),
          profile: false,
          switchable: true,
        })),
    );
    catalogSessionStarted.set(null);
    agentCatalogAnswered.set(true);
    agentCatalogNotice.set(tr("sessions.agentCatalogHostUpdate"));
  } catch (error) {
    if (activeWorkspaceId() !== workspaceId) return;
    agentChoices.set([]);
    agentCatalogAnswered.set(false);
    agentCatalogNotice.set(
      tr("sessions.agentCatalogUnavailable", { error: error instanceof Error ? error.message : String(error) }),
    );
  }
}

/** Kept for callers that read the preference; the catalogue now carries the default. */
export async function loadAgentPreference(): Promise<void> {
  reloadAgentModes();
}

/**
 * The press behind one agent row. A session the host reports as switchable to
 * that agent takes it outright; otherwise the press asks for a new session, since
 * the host refuses to rebind a transcript produced under another agent.
 */
export async function chooseAgentMode(modeId: string): Promise<void> {
  const id = modeId.trim();
  if (!id) return;
  agentPickerOpen.set(false);
  agentNotice.set("");
  const sessionId = activeSessionId();
  if (!sessionId) {
    // A draft choice; the host records it when a session is created with it.
    chosenAgentType.set(id);
    pendingModeRecord = id;
    return;
  }
  if (agentIdsMatch(agentTypeOf(sessionId), id)) return;
  const choice = agentChoices().find(entry => agentIdsMatch(entry.id, id));
  if (choice ? !choice.switchable : activeSessionStarted()) {
    pendingAgentSession.set(id);
    return;
  }
  await bindSessionAgent(sessionId, id);
}

async function bindSessionAgent(sessionId: string, modeId: string): Promise<boolean> {
  const workspaceId = sessions().find(row => row.sessionId === sessionId)?.workspaceId || activeWorkspaceId();
  let bound = false;
  await runStep(async () => {
    try {
      await updateSessionMode({
        sessionId,
        modeId,
        ...(workspaceId ? { workspaceId } : {}),
        includeInternal: false,
      });
      sessionAgentTypes.update(current => ({ ...current, [sessionKey(sessionId)]: modeId }));
      sessions.update(current =>
        current.map(row => (row.sessionId === sessionId ? { ...row, agentType: modeId } : row)));
      chosenAgentType.set(modeId);
      bound = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("session_mode_locked")) {
        // Another client started the session meanwhile; offer a new one instead.
        pendingAgentSession.set(modeId);
        reloadAgentModes();
        return;
      }
      agentNotice.set(message);
    }
  });
  return bound;
}

/** Confirms the press a started session cannot honour: a new session in that agent. */
export async function startSessionAs(modeId: string): Promise<void> {
  const id = modeId.trim();
  pendingAgentSession.set(null);
  if (!id) return;
  chosenAgentType.set(id);
  pendingModeRecord = id;
  await createSessionInWorkspace(`${agentLabel(id)} session`, id);
}

// A session created from an explicit pick binds that agent through the host,
// which records it as the next default (`last_mode_id`) for every client.
onSessionSwitch((phase, sessionId) => {
  if (phase !== "enter" || !sessionId || !pendingModeRecord) return;
  const id = pendingModeRecord;
  if (!agentIdsMatch(agentTypeOf(sessionId), id) || sessionStarted(sessionId)) return;
  pendingModeRecord = null;
  void bindSessionAgent(sessionId, id);
});

// Clear the previous workspace's mode catalogue immediately on workspace/device
// switch so project modes never linger or open while an Assistant (or remote
// device) catalogue is still loading.
onWorkspaceChanged(() => {
  catalogueKey = null;
  pendingModeRecord = null;
  agentChoices.set([]);
  agentCatalogAnswered.set(false);
  agentCatalogNotice.set("");
  agentPickerOpen.set(false);
  pendingAgentSession.set(null);
  agentNotice.set("");
  catalogSessionStarted.set(null);
});

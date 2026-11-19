// The agent a session runs as: one of the four built-in execution profiles, or an
// agent the host configured itself, external ACP agents included.
//
// The host owns the catalogue (`get_available_modes`) and every session's binding
// (`update_session_mode`). This store mirrors both for the composer, and it keeps
// the one preference both surfaces share: the desktop's harness control stores
// `default_mode_strategy` / `default_mode_id` / `last_mode_id` in `app.flow_chat`,
// so a choice made in either surface is the default in the other.

import { computed, signal } from "nsh";
import {
  getAvailableModes,
  getConfig,
  setConfig,
  updateSessionMode,
  type AgentMode,
} from "./api";
import {
  DEFAULT_AGENT_TYPE,
  activeSessionId,
  activeWorkspaceId,
  activeWorkspaceRoot,
  agentTypeOf,
  chosenAgentType,
  createSessionInWorkspace,
  runStep,
  sessionAgentTypes,
  sessionStarted,
  sessions,
} from "./state";

/** The four built-in profiles, in the order the desktop's harness control lists them. */
export const HARNESS_PROFILES = ["Minimal", "Standard", "Ultimate", "Creative"];

/** Where both surfaces keep the harness preference. */
const PREFERENCE_PATH = "app.flow_chat";

/** Mode ids the desktop never takes as a default, because they are not execution levels. */
const INELIGIBLE_IDS = new Set(["claw", "multitask", "plan"]);
/**
 * Ids an older surface may still store for the profiles it renamed. A mode the
 * host reports under one of these names is the same execution level.
 */
const PROFILE_ALIASES: Record<string, string> = {
  agentic: "standard",
  balanced: "standard",
  ultra: "ultimate",
};

export interface AgentChoice {
  id: string;
  label: string;
  description: string;
  /** One of the four built-in profiles rather than a configured or external agent. */
  profile: boolean;
}

export const agentChoices = signal<AgentChoice[]>([]);
/** Whether the host answered the catalogue; a host without the command keeps this false. */
export const agentCatalogAnswered = signal(false);
export const agentCatalogNotice = signal("");
export const agentPickerOpen = signal(false);
/** A mode whose press needs a new session, because this one already started. */
export const pendingAgentSession = signal<string | null>(null);
export const agentNotice = signal("");

export const agentProfiles = computed<AgentChoice[]>(() =>
  agentChoices().filter(choice => choice.profile));
export const agentAgents = computed<AgentChoice[]>(() =>
  agentChoices().filter(choice => !choice.profile));

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

/** The built-in profile an id names, tolerating case and the retired names above. */
function profileOf(id: string): string | null {
  const key = id.trim().toLowerCase();
  const alias = PROFILE_ALIASES[key] ?? key;
  return HARNESS_PROFILES.find(profile => profile.toLowerCase() === alias) ?? null;
}

/**
 * The catalogue in the order the control draws it: the four profiles first, in
 * their own order, then the rest in the order the host resolved them. A profile
 * the host does not list stays out, because an older host may not know one, and
 * so do the modes the desktop refuses to switch a session to — Claw belongs to
 * assistant workspaces, and `multitask` / `plan` are retired ids an older peer may
 * still advertise.
 */
function choicesOf(rows: AgentMode[]): AgentChoice[] {
  const seen = new Set<string>();
  const mapped: AgentChoice[] = [];
  for (const row of rows ?? []) {
    const rawId = typeof row?.id === "string" ? row.id.trim() : "";
    if (!rawId) continue;
    const key = rawId.toLowerCase();
    if (seen.has(key) || INELIGIBLE_IDS.has(key)) continue;
    seen.add(key);
    const profile = profileOf(rawId);
    mapped.push({
      id: profile ?? rawId,
      label: (row?.name ?? "").trim() || profile || rawId,
      description: (row?.description ?? "").trim(),
      profile: profile !== null,
    });
  }
  const profiles = HARNESS_PROFILES.flatMap(name =>
    mapped.filter(choice => choice.profile && agentIdsMatch(choice.id, name)));
  return [...profiles, ...mapped.filter(choice => !choice.profile)];
}

/**
 * The default a stored preference names, in the desktop's own terms: `fixed` reads
 * the pinned mode, and every other strategy follows the last one used. An id the
 * desktop never takes as a default is refused here as well, and a profile stored
 * under an older name comes back as the profile the host now lists.
 */
function eligibleAgentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || INELIGIBLE_IDS.has(id.toLowerCase())) return null;
  return profileOf(id) ?? id;
}

let preferenceRequested = false;
let catalogueWorkspace: string | null = null;
let catalogueLoading = false;

/**
 * Reads the preference once and the workspace's catalogue once per workspace. The
 * composer asks on mount and whenever the workspace changes; repeated calls are
 * free, so a scene that renders again does not ask the host twice.
 */
export function ensureAgentModes(): void {
  if (!preferenceRequested) {
    preferenceRequested = true;
    void loadAgentPreference();
  }
  const workspaceId = activeWorkspaceId();
  if (!workspaceId || catalogueLoading || catalogueWorkspace === workspaceId) return;
  void loadAgentModes(workspaceId);
}

/** Re-reads the catalogue, for a host that failed the first time or just changed. */
export function reloadAgentModes(): void {
  catalogueWorkspace = null;
  agentCatalogNotice.set("");
  ensureAgentModes();
}

export async function loadAgentModes(workspaceId: string): Promise<void> {
  catalogueLoading = true;
  const root = activeWorkspaceRoot();
  try {
    const rows = await getAvailableModes(workspaceId, root || undefined);
    // A read for a workspace the user already left must not publish its rows.
    if (activeWorkspaceId() !== workspaceId) return;
    catalogueWorkspace = workspaceId;
    agentChoices.set(choicesOf(rows));
    agentCatalogAnswered.set(true);
    agentCatalogNotice.set("");
  } catch (error) {
    if (activeWorkspaceId() !== workspaceId) return;
    catalogueWorkspace = workspaceId;
    agentChoices.set([]);
    agentCatalogAnswered.set(false);
    agentCatalogNotice.set(
      `This host does not offer an agent catalogue: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    catalogueLoading = false;
  }
}

/** Reads the harness preference both surfaces keep in `app.flow_chat`. */
export async function loadAgentPreference(): Promise<void> {
  try {
    const stored = (await getConfig(PREFERENCE_PATH, true)) as Record<string, unknown> | null;
    const fixed = eligibleAgentType(stored?.default_mode_id);
    const last = eligibleAgentType(stored?.last_mode_id);
    const strategy = typeof stored?.default_mode_strategy === "string"
      ? stored.default_mode_strategy
      : "";
    const chosen = strategy === "fixed" ? fixed ?? last : last ?? fixed;
    if (chosen) chosenAgentType.set(chosen);
  } catch {
    // A host that stores nothing keeps this surface on Standard, which is its default.
  }
}

/** Remembers the pick the way the desktop does, so the next launch starts there. */
function rememberAgentType(agentType: string): void {
  const id = eligibleAgentType(agentType);
  if (!id) return;
  void setConfig(`${PREFERENCE_PATH}.last_mode_id`, id).catch(() => undefined);
}

/**
 * The press behind one agent row. A session that has not started takes the agent
 * outright; one that already ran a turn keeps the agent it started with, so the
 * press asks for a new session instead of rebinding a transcript that was
 * produced under another agent — the desktop's rule, enforced in its UI because
 * the runtime would accept the rebind silently.
 */
export async function chooseAgentMode(modeId: string): Promise<void> {
  const id = modeId.trim();
  if (!id) return;
  agentPickerOpen.set(false);
  agentNotice.set("");
  const sessionId = activeSessionId();
  if (!sessionId) {
    chosenAgentType.set(id);
    rememberAgentType(id);
    return;
  }
  if (agentIdsMatch(agentTypeOf(sessionId), id)) return;
  if (sessionStarted(sessionId)) {
    pendingAgentSession.set(id);
    return;
  }
  await bindSessionAgent(sessionId, id);
}

async function bindSessionAgent(sessionId: string, modeId: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  const workspacePath = activeWorkspaceRoot();
  await runStep(async () => {
    try {
      await updateSessionMode({
        sessionId,
        modeId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspacePath ? { workspacePath } : {}),
        includeInternal: false,
      });
      sessionAgentTypes.update(current => ({ ...current, [sessionId]: modeId }));
      sessions.update(current =>
        current.map(row => (row.sessionId === sessionId ? { ...row, agentType: modeId } : row)));
      chosenAgentType.set(modeId);
      rememberAgentType(modeId);
    } catch (error) {
      agentNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

/** Confirms the press a started session cannot honour: a new session in that agent. */
export async function startSessionAs(modeId: string): Promise<void> {
  const id = modeId.trim();
  pendingAgentSession.set(null);
  if (!id) return;
  chosenAgentType.set(id);
  rememberAgentType(id);
  await createSessionInWorkspace(`${agentLabel(id)} session`, id);
}

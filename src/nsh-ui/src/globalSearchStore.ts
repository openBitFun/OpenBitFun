// The one search field over what this run can reach: the sessions of the active
// workspace by name, the host's message hits (`search_session_content`) across
// every opened workspace, the active workspace's files (`search_files`), the
// opened and recent workspaces and assistants, and this surface's own commands
// behind a leading `>`. Settings sections are added by the shell, which owns the
// settings navigation.
//
// Two rules matter here: typing is debounced because the message and file reads
// are host round trips, and every run takes a ticket so a late answer from an
// older query cannot overwrite a newer one. A failing source is collected into
// `searchNotice` and the other groups still render. A remote workspace's files
// are not searched (the host's file search walks this machine's disk); that is
// said in the notice instead of returning an empty group.

import { searchWorkspaceFiles, type WorkspaceRecord } from "./api";
import { invokeCommand } from "./bridge";
import { tr } from "./i18n";
import {
  activeWorkspace,
  activeWorkspaceId,
  createSessionInWorkspace,
  isSessionArchived,
  loadSessions,
  navigateScene,
  openRecentWorkspace,
  recentWorkspaces,
  runStep,
  selectSession,
  selectWorkspace,
  sessions,
  workspaces,
  type SceneId,
} from "./state";
import { openFileAt } from "./fileStore";
import { signal } from "nsh";

export type SearchItemKind =
  | "command"
  | "session"
  | "message"
  | "file"
  | "workspace"
  | "assistant"
  | "setting";

export interface SearchItem {
  /** Unique across kinds, so a list key stays stable while results change. */
  id: string;
  kind: SearchItemKind;
  label: string;
  detail: string;
  /** A session id, a file path, a workspace id, or the scene a command switches to. */
  target: string;
  /** The workspace a session or message hit belongs to, when it is not the active one. */
  workspaceId?: string;
  /** The turn a message hit was found in. */
  turnId?: string;
}

/** The scenes a `>` command can reach, in the sidebar's own order. */
const COMMAND_SCENES: ReadonlyArray<SceneId> = [
  "home",
  "sessions",
  "assistants",
  "agents",
  "skills",
  "routines",
  "files",
  "git",
  "terminal",
  "spaces",
  "devices",
  "settings",
];

const NEW_SESSION_COMMAND = "command:new-session";

export const searchOpen = signal(false);
export const searchQuery = signal("");
export const searchBusy = signal(false);
export const searchItems = signal<SearchItem[]>([]);
export const searchNotice = signal("");

/**
 * The turn a message hit pointed at, for the session scene to scroll to once the
 * transcript is loaded; it clears the request after acting on it.
 */
export const searchRevealTurn = signal<{ sessionId: string; turnId: string } | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// A late answer from an older query must not overwrite a newer one, so every run
// takes a ticket and only the newest may write.
let runTicket = 0;

function commandLabel(scene: SceneId): { label: string; detail: string } {
  switch (scene) {
    case "home":
      return { label: tr("search.cmdHome"), detail: tr("search.cmdHomeDetail") };
    case "sessions":
      return { label: tr("search.cmdSessions"), detail: tr("search.cmdSessionsDetail") };
    case "assistants":
      return { label: tr("search.cmdAssistants"), detail: tr("search.cmdAssistantsDetail") };
    case "agents":
      return { label: tr("search.cmdAgents"), detail: tr("search.cmdAgentsDetail") };
    case "skills":
      return { label: tr("search.cmdSkills"), detail: tr("search.cmdSkillsDetail") };
    case "routines":
      return { label: tr("search.cmdRoutines"), detail: tr("search.cmdRoutinesDetail") };
    case "files":
      return { label: tr("search.cmdFiles"), detail: tr("search.cmdFilesDetail") };
    case "git":
      return { label: tr("search.cmdGit"), detail: tr("search.cmdGitDetail") };
    case "terminal":
      return { label: tr("search.cmdTerminal"), detail: tr("search.cmdTerminalDetail") };
    case "spaces":
      return { label: tr("search.cmdSpaces"), detail: tr("search.cmdSpacesDetail") };
    case "devices":
      return { label: tr("search.cmdDevices"), detail: tr("search.cmdDevicesDetail") };
    default:
      return { label: tr("search.cmdSettings"), detail: tr("search.cmdSettingsDetail") };
  }
}

function commandItems(query: string): SearchItem[] {
  const needle = query.trim().toLowerCase();
  const scenes = COMMAND_SCENES.map(scene => ({ scene, ...commandLabel(scene) }))
    .filter(
      entry => !needle || entry.label.toLowerCase().includes(needle) || entry.scene.includes(needle),
    )
    .map(entry => ({
      id: `command:${entry.scene}`,
      kind: "command" as const,
      label: entry.label,
      detail: entry.detail,
      target: entry.scene,
    }));
  const createLabel = tr("search.cmdNewSession");
  const create =
    !needle ||
    createLabel.toLowerCase().includes(needle) ||
    "new session".includes(needle) ||
    "create".includes(needle)
      ? [
          {
            id: NEW_SESSION_COMMAND,
            kind: "command" as const,
            label: createLabel,
            detail: tr("search.cmdNewSessionDetail"),
            target: "",
          },
        ]
      : [];
  return [...create, ...scenes];
}

function sessionNameItems(query: string): SearchItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return sessions()
    .filter(session => (session.sessionName ?? "").toLowerCase().includes(needle))
    .slice(0, 8)
    .map(session => ({
      id: `session:${session.sessionId}`,
      kind: "session" as const,
      label: session.sessionName || session.sessionId,
      detail: isSessionArchived(session)
        ? tr("search.sessionArchivedDetail")
        : tr("search.sessionDetail", { count: session.messageCount ?? 0 }),
      target: session.sessionId,
    }));
}

function workspaceName(ws: WorkspaceRecord): string {
  const named = ws.name?.trim();
  if (named) return named;
  const normalized = ws.rootPath.replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) || ws.rootPath : ws.rootPath;
}

function isAssistant(ws: WorkspaceRecord): boolean {
  return (ws.workspaceKind ?? "").toLowerCase().includes("assistant");
}

function workspaceItems(query: string): SearchItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const opened = workspaces().map(ws => ({ ws, recent: false }));
  const recent = recentWorkspaces().map(ws => ({ ws, recent: true }));
  return [...opened, ...recent]
    .filter(({ ws }) => {
      const name = workspaceName(ws).toLowerCase();
      return name.includes(needle) || ws.rootPath.toLowerCase().includes(needle);
    })
    .slice(0, 10)
    .map(({ ws, recent: isRecent }) => ({
      id: `${isAssistant(ws) ? "assistant" : "workspace"}:${ws.id}`,
      kind: isAssistant(ws) ? ("assistant" as const) : ("workspace" as const),
      label: workspaceName(ws),
      detail: isRecent ? tr("search.recentDetail", { path: ws.rootPath }) : ws.rootPath,
      target: ws.id,
    }));
}

function isRemoteWorkspace(ws: WorkspaceRecord | null | undefined): boolean {
  if (!ws) return false;
  const kind = (ws.workspaceKind ?? "").toLowerCase();
  if (kind.includes("assistant")) return false;
  return Boolean(ws.connectionId) || kind === "remote" || kind.includes("ssh") || kind.includes("docker");
}

/** The host's own message hits, from every opened workspace: one row per match inside a turn. */
async function messageItems(query: string): Promise<SearchItem[]> {
  if (!query.trim()) return [];
  const active = activeWorkspace();
  const targets = [
    ...(active ? [active] : []),
    ...workspaces().filter(ws => ws.id !== active?.id),
  ].slice(0, 6);
  const perWorkspace = await Promise.all(
    targets.map(async ws => {
      const answer = await invokeCommand<{ hits?: unknown[] }>("search_session_content", {
        workspaceId: ws.id,
        workspacePath: ws.rootPath,
        query,
        limit: 8,
        includeArchived: false,
      });
      const hits = Array.isArray(answer?.hits) ? answer.hits : [];
      return hits
        .filter((hit): hit is Record<string, unknown> => Boolean(hit) && typeof hit === "object")
        .map(hit => {
          const snippet = String(hit.snippet ?? "").replace(/\s+/g, " ").trim();
          const other = ws.id !== active?.id;
          return {
            id: `message:${ws.id}:${String(hit.sessionId ?? "")}:${String(hit.turnId ?? "")}:${snippet.slice(0, 40)}`,
            kind: "message" as const,
            label: String(hit.sessionTitle ?? hit.sessionId ?? tr("search.sessionFallback")),
            detail: other ? `${workspaceName(ws)} · ${snippet}` : snippet,
            target: String(hit.sessionId ?? ""),
            workspaceId: ws.id,
            turnId: typeof hit.turnId === "string" ? hit.turnId : undefined,
          };
        })
        .filter(item => item.target !== "");
    }),
  );
  return perWorkspace.flat().slice(0, 12);
}

async function fileItems(query: string): Promise<SearchItem[]> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId || !query.trim()) return [];
  const rows = await searchWorkspaceFiles(workspaceId, query);
  return (Array.isArray(rows) ? rows : [])
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .slice(0, 8)
    .map(row => ({
      id: `file:${String(row.path ?? "")}`,
      kind: "file" as const,
      label: String(row.name ?? row.path ?? ""),
      detail: String(row.path ?? ""),
      target: String(row.path ?? ""),
    }))
    .filter(item => item.target !== "");
}

/**
 * Runs the query against every source this surface has. A source that fails says
 * so once under the list instead of failing the whole search: the other groups
 * are still answers the user can act on.
 */
export async function runGlobalSearch(query: string): Promise<void> {
  const ticket = ++runTicket;
  const text = query.trim();
  if (!text) {
    searchItems.set([]);
    searchNotice.set("");
    searchBusy.set(false);
    return;
  }
  if (text.startsWith(">")) {
    // A command query never leaves this surface, so it answers at once.
    searchItems.set(commandItems(text.slice(1)));
    searchNotice.set("");
    searchBusy.set(false);
    return;
  }
  searchBusy.set(true);
  const failures: string[] = [];
  const settle = async <T>(run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  };
  const remote = isRemoteWorkspace(activeWorkspace());
  const [messages, files] = await Promise.all([
    settle(() => messageItems(text)),
    remote ? Promise.resolve([] as SearchItem[]) : settle(() => fileItems(text)),
  ]);
  if (ticket !== runTicket) return;
  searchItems.set([
    ...sessionNameItems(text),
    ...messages,
    ...files,
    ...workspaceItems(text),
  ]);
  const notices: string[] = [];
  if (remote) notices.push(tr("search.remoteFilesUnsupported"));
  if (failures.length) notices.push(tr("search.someSourcesFailed", { error: failures[0] }));
  searchNotice.set(notices.join(" "));
  searchBusy.set(false);
}

export function setSearchQuery(text: string): void {
  searchQuery.set(text);
  if (debounceTimer) clearTimeout(debounceTimer);
  // Typing is a stream, so the search waits for a pause instead of spending one
  // host round trip per keystroke.
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runGlobalSearch(searchQuery());
  }, 220);
}

export function openGlobalSearch(seed = ""): void {
  searchOpen.set(true);
  searchQuery.set(seed);
  searchItems.set([]);
  searchNotice.set("");
  // A `>` command list is what an empty field is useful for.
  searchItems.set(commandItems(seed));
  // A character that opened the panel from the sidebar field is a query already,
  // so it is searched instead of being dropped.
  if (seed !== "") setSearchQuery(seed);
}

export function closeGlobalSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  runTicket += 1;
  searchOpen.set(false);
  searchQuery.set("");
  searchItems.set([]);
  searchNotice.set("");
  searchBusy.set(false);
}

/** Runs a hit: the same navigation the sidebar and the scenes already use. */
export async function runSearchItem(item: SearchItem): Promise<void> {
  closeGlobalSearch();
  if (item.kind === "command") {
    if (item.id === NEW_SESSION_COMMAND) {
      await createSessionInWorkspace(tr("nav.newSession"));
      navigateScene("sessions");
      return;
    }
    navigateScene(item.target as SceneId);
    return;
  }
  if (item.kind === "workspace" || item.kind === "assistant") {
    const recent = recentWorkspaces().find(ws => ws.id === item.target);
    if (recent) await openRecentWorkspace(recent);
    else selectWorkspace(item.target);
    navigateScene(item.kind === "assistant" ? "assistants" : "sessions");
    return;
  }
  if (item.kind === "file") {
    navigateScene("files");
    await openFileAt(item.target);
    return;
  }
  // A hit in another opened workspace switches to it first; its catalogue loads
  // with the switch.
  if (item.workspaceId && item.workspaceId !== activeWorkspaceId()) {
    selectWorkspace(item.workspaceId);
  }
  await runStep(async () => {
    await loadSessions();
  });
  navigateScene("sessions");
  selectSession(item.target);
  if (item.kind === "message" && item.turnId) {
    searchRevealTurn.set({ sessionId: item.target, turnId: item.turnId });
  }
}

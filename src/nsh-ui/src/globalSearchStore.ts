// The one search field over what this run can reach: the sessions of the active
// workspace (by name, and inside their turns through `search_session_content`),
// the workspace's files through `search_files`, and this surface's own commands
// behind a leading `>`.
//
// The desktop's panel is a federated search over five providers (workspaces,
// assistants, agents, skills, interactive capabilities); the providers outside
// this MVP's areas are not ported, so a hit never comes from a page this surface
// does not draw. Its `Cmd+K` trigger is also not reachable: NSH exposes keys only
// on an input, so the panel opens from the sidebar's own search field.

import { searchWorkspaceFiles } from "./api";
import { invokeCommand } from "./bridge";
import {
  activeWorkspace,
  activeWorkspaceId,
  createSessionInWorkspace,
  isSessionArchived,
  loadSessions,
  navigateScene,
  runStep,
  selectSession,
  sessions,
  type SceneId,
} from "./state";
import { openFileAt } from "./fileStore";
import { signal } from "nsh";

export type SearchItemKind = "session" | "message" | "file" | "command";

export interface SearchItem {
  /** Unique across kinds, so a list key stays stable while results change. */
  id: string;
  kind: SearchItemKind;
  label: string;
  detail: string;
  /** A session id, a file path, or the scene a command switches to. */
  target: string;
}

/** The scenes a `>` command can reach, in the sidebar's own order. */
const COMMAND_TARGETS: ReadonlyArray<{ scene: SceneId; label: string; detail: string }> = [
  { scene: "home", label: "Go to Home", detail: "Switch to the personal agent studio overview" },
  { scene: "sessions", label: "Go to Sessions", detail: "Switch to the session list" },
  { scene: "assistants", label: "Go to Assistants", detail: "Switch to assistants" },
  { scene: "agents", label: "Go to Agents", detail: "Switch to agents" },
  { scene: "skills", label: "Go to Skills", detail: "Switch to skills" },
  { scene: "routines", label: "Go to Routines", detail: "Switch to routines" },
  { scene: "files", label: "Go to Files", detail: "Switch to files and preview" },
  { scene: "git", label: "Go to Git", detail: "Switch to source control" },
  { scene: "terminal", label: "Go to Terminal", detail: "Switch to the terminal" },
  { scene: "spaces", label: "Go to Spaces", detail: "Switch to spaces" },
  { scene: "devices", label: "Go to Devices", detail: "Switch to devices and pairing" },
  { scene: "settings", label: "Go to Settings", detail: "Switch to settings" },
];

const NEW_SESSION_COMMAND = "command:new-session";

export const searchOpen = signal(false);
export const searchQuery = signal("");
export const searchBusy = signal(false);
export const searchItems = signal<SearchItem[]>([]);
export const searchNotice = signal("");

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// A late answer from an older query must not overwrite a newer one, so every run
// takes a ticket and only the newest may write.
let runTicket = 0;

function commandItems(query: string): SearchItem[] {
  const needle = query.trim().toLowerCase();
  const scenes = COMMAND_TARGETS.filter(
    entry => !needle || entry.label.toLowerCase().includes(needle) || entry.scene.includes(needle),
  ).map(entry => ({
    id: `command:${entry.scene}`,
    kind: "command" as const,
    label: entry.label,
    detail: entry.detail,
    target: entry.scene,
  }));
  const create =
    !needle || "new session".includes(needle) || "create".includes(needle)
      ? [
          {
            id: NEW_SESSION_COMMAND,
            kind: "command" as const,
            label: "New session",
            detail: "Start a session in this workspace",
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
        ? "Session · archived"
        : `Session · ${session.messageCount ?? 0} messages`,
      target: session.sessionId,
    }));
}

/** The host's own message hits: one row per match inside a turn. */
async function messageItems(query: string): Promise<SearchItem[]> {
  const workspace = activeWorkspace();
  if (!workspace || !query.trim()) return [];
  const answer = await invokeCommand<{ hits?: unknown[] }>("search_session_content", {
    workspaceId: workspace.id,
    workspacePath: workspace.rootPath,
    query,
    limit: 8,
    includeArchived: false,
  });
  const hits = Array.isArray(answer?.hits) ? answer.hits : [];
  return hits
    .filter((hit): hit is Record<string, unknown> => Boolean(hit) && typeof hit === "object")
    .map(hit => ({
      id: `message:${String(hit.sessionId ?? "")}:${String(hit.turnId ?? "")}:${String(hit.snippet ?? "").slice(0, 40)}`,
      kind: "message" as const,
      label: String(hit.sessionTitle ?? hit.sessionId ?? "Session"),
      detail: String(hit.snippet ?? "").replace(/\s+/g, " ").trim(),
      target: String(hit.sessionId ?? ""),
    }))
    .filter(item => item.target !== "");
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
  const [messages, files] = await Promise.all([
    settle(() => messageItems(text)),
    settle(() => fileItems(text)),
  ]);
  if (ticket !== runTicket) return;
  searchItems.set([...sessionNameItems(text), ...messages, ...files]);
  searchNotice.set(
    failures.length ? `Some sources did not answer: ${failures[0]}` : "",
  );
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
      await createSessionInWorkspace("New session");
      navigateScene("sessions");
      return;
    }
    navigateScene(item.target as SceneId);
    return;
  }
  if (item.kind === "file") {
    navigateScene("files");
    await openFileAt(item.target);
    return;
  }
  // A session or a message hit both open the session; the message's own turn is
  // not scrolled to, because the transcript of an unloaded session arrives after
  // the open, not before it.
  await runStep(async () => {
    await loadSessions();
  });
  navigateScene("sessions");
  selectSession(item.target);
}

// References in the message: the token a workspace file or directory becomes when
// the user points the agent at it.
//
// The wire shape is the desktop composer's: a tag travels inside the message text
// (`#file:<name>`, `#dir:<name>`), and the runtime does not expand it, so the agent
// resolves the name with its own tools. What this store owns is finding the name —
// the workspace's file names, through the same `search_files` read the Files scene
// searches with — and putting the tag where the user is typing.

import { signal } from "nsh";
import type { InputRef } from "nsh";
import {
  executeSessionCommand,
  getDirectoryChildren,
  listSessionCommands,
  searchWorkspaceFiles,
  type WorkspaceEntry,
} from "./api";
import { addFileAttachment, toRelativeWorkspacePath } from "./attachmentStore";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { tr, type MessageKey } from "./i18n";
import {
  activeSessionId,
  activeWorkspaceId,
  activeWorkspaceRoot,
  composerText,
  sessions,
} from "./state";
import { isCommandUnavailable as isMissingCommand } from "./hostCommands";

/** One row of the picker: a path the host reported, split into what a row shows. */
export interface MentionHit {
  path: string;
  name: string;
  directory: boolean;
  relativePath?: string;
}

export const mentionOpen = signal(false);
export const mentionQuery = signal("");
export const mentionBrowseDir = signal("");
export const mentionHits = signal<MentionHit[]>([]);
export const mentionSearched = signal(false);
export const mentionLoading = signal(false);
export const mentionNotice = signal("");
/** The host matched more names than the panel draws. */
export const mentionTruncated = signal(false);
/**
 * The panel was opened by typing `@` in the message, so the query lives in the
 * composer itself and the panel draws no field of its own: the desktop keeps the
 * caret where the user is typing too.
 */
export const mentionInline = signal(false);

/** Long enough to type through, short enough that the list follows the query. */
const SEARCH_DEBOUNCE_MS = 140;
/** Max rows drawn inside the scrollable mention popover. */
const RESULT_LIMIT = 24;
const IGNORED_BROWSE_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  "__pycache__",
  ".next",
  ".turbo",
]);

let debounceTimer: number | null = null;
/** Monotonic token for browse/search requests so slower answers never overwrite newer ones. */
let mentionReqSeq = 0;

function effectiveMentionWorkspaceId(): string | null {
  const direct = activeWorkspaceId();
  if (direct) return direct;
  const sid = activeSessionId();
  if (!sid) return null;
  const row = sessions().find(item => item.sessionId === sid);
  return row?.workspaceId || null;
}

/** The tag for one row, in the shape the desktop composer writes it. */
export function mentionToken(hit: MentionHit): string {
  const ref = hit.relativePath || hit.name;
  return `#${hit.directory ? "dir" : "file"}:${ref} `;
}

export function openMention(): void {
  mentionNotice.set("");
  mentionQuery.set("");
  mentionBrowseDir.set("");
  mentionHits.set([]);
  mentionSearched.set(false);
  mentionTruncated.set(false);
  mentionInline.set(false);
  mentionOpen.set(true);
  void loadMentionDirectory("");
}

export function closeMention(): void {
  mentionOpen.set(false);
  mentionInline.set(false);
  mentionQuery.set("");
  mentionBrowseDir.set("");
  syncedText = null;
  syncedCaret = -1;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** The `@…` the caret sits in, when the `@` opens a word. */
export interface MentionTrigger {
  /** Where the `@` is, in the composer's text. */
  start: number;
  /** Where the caret is, which is where the token ends: the token is what the caret
   * has just typed, so it never extends past it. */
  end: number;
  query: string;
}

/**
 * The mention being typed at `caret`, or `null`. A mention starts the message or
 * follows whitespace, and runs to the caret without another space or `@` in it —
 * the same shape the desktop's composer reads.
 */
export function mentionTriggerAt(text: string, caret: number): MentionTrigger | null {
  const limit = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, limit);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: before.length - query.length - 1, end: before.length, query };
}

/**
 * Follows the composer's text and caret: a typed `@` opens the panel with workspace
 * root browsing immediately on bare `@` and live file/folder search as the user types.
 */
export function syncInlineMention(text: string, caret: number, fromSelectionOnly = false): void {
  // Selection reports while clicking a popover row keep the active token intact so the row press succeeds.
  if (fromSelectionOnly && text === syncedText && mentionOpen() && mentionInline()) {
    const triggerAtCaret = mentionTriggerAt(text, caret);
    if (!triggerAtCaret) return;
  }
  if (text === syncedText && caret === syncedCaret) return;
  syncedText = text;
  syncedCaret = caret;
  const trigger = mentionTriggerAt(text, caret);
  if (!trigger) {
    inlineToken = null;
    if (mentionOpen() && mentionInline()) closeMention();
    return;
  }
  inlineToken = { start: trigger.start, end: trigger.end };
  const wasOpen = mentionOpen();
  if (!wasOpen) {
    mentionNotice.set("");
    mentionHits.set([]);
    mentionSearched.set(false);
    mentionTruncated.set(false);
    mentionBrowseDir.set("");
    mentionOpen.set(true);
  }
  mentionInline.set(true);
  if (!wasOpen || mentionQuery() !== trigger.query) {
    setMentionQuery(trigger.query);
  }
}

export function browseMentionDir(dirPath: string): void {
  if (!mentionOpen()) return;
  mentionBrowseDir.set(dirPath);
  mentionQuery.set("");
  mentionNotice.set("");
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  void loadMentionDirectory(dirPath);
}

export function browseMentionParent(): void {
  const current = mentionBrowseDir().replace(/[\\/]+$/, "");
  const root = activeWorkspaceRoot().replace(/[\\/]+$/, "");
  if (!current || current === root) return;
  const lastSep = Math.max(current.lastIndexOf("/"), current.lastIndexOf("\\"));
  if (lastSep <= 0) {
    browseMentionDir("");
    return;
  }
  const parent = current.slice(0, lastSep);
  if (root && !parent.startsWith(root)) {
    browseMentionDir("");
    return;
  }
  browseMentionDir(parent === root ? "" : parent);
}

async function loadMentionDirectory(dirPath: string): Promise<void> {
  const workspaceId = effectiveMentionWorkspaceId();
  const root = activeWorkspaceRoot().replace(/[\\/]+$/, "");
  if (!workspaceId || !mentionOpen()) return;
  const target = dirPath || root;
  if (!target) return;
  const seq = ++mentionReqSeq;
  mentionLoading.set(true);
  mentionNotice.set("");
  try {
    const raw = await getDirectoryChildren(workspaceId, target);
    if (seq !== mentionReqSeq || !mentionOpen()) return;
    const entries: WorkspaceEntry[] = Array.isArray(raw) ? raw : [];
    const atRoot = !dirPath || dirPath === root;
    const filtered = entries.filter(entry => {
      const name = (entry.name || entry.path.split(/[\\/]/).filter(Boolean).pop() || "").trim();
      if (!name) return false;
      if (atRoot && entry.isDirectory && IGNORED_BROWSE_DIRS.has(name)) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return (a.name || a.path).localeCompare(b.name || b.path, undefined, { sensitivity: "base" });
    });
    const hits: MentionHit[] = filtered.slice(0, RESULT_LIMIT).map(entry => {
      const name = entry.name || entry.path.split(/[\\/]/).filter(Boolean).pop() || entry.path;
      return {
        path: entry.path,
        name,
        directory: Boolean(entry.isDirectory),
        relativePath: toRelativeWorkspacePath(entry.path, root) ?? name,
      };
    });
    mentionHits.set(hits);
    mentionTruncated.set(filtered.length > hits.length);
    mentionSearched.set(false);
  } catch {
    if (seq !== mentionReqSeq) return;
    mentionHits.set([]);
    mentionTruncated.set(false);
  } finally {
    if (seq === mentionReqSeq) mentionLoading.set(false);
  }
}

/**
 * Types the query. Empty query immediately lists the active workspace (or browsed directory)
 * files & folders; non-empty query searches workspace filenames & folders with debounce.
 */
export function setMentionQuery(query: string): void {
  mentionQuery.set(query);
  mentionNotice.set("");
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  const trimmed = query.trim();
  if (!trimmed) {
    mentionSearched.set(false);
    mentionTruncated.set(false);
    void loadMentionDirectory(mentionBrowseDir());
    return;
  }
  // Drop unfiltered root-browse rows immediately when transitioning into search
  // so stale non-matching files never linger while the search debounce settles.
  if (!mentionSearched()) {
    mentionHits.set([]);
    mentionTruncated.set(false);
    mentionLoading.set(true);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void searchMentions(trimmed);
  }, SEARCH_DEBOUNCE_MS);
}

async function searchMentions(query: string): Promise<void> {
  const workspaceId = effectiveMentionWorkspaceId();
  if (!workspaceId || !mentionOpen()) return;
  const seq = ++mentionReqSeq;
  mentionLoading.set(true);
  try {
    const reply = await searchWorkspaceFiles(workspaceId, query, {
      searchContent: false,
      maxResults: RESULT_LIMIT + 6,
    });
    if (seq !== mentionReqSeq || !mentionOpen() || effectiveMentionWorkspaceId() !== workspaceId) return;
    const rows = rowsOf(reply);
    const hits = hitsOf(rows, query);
    mentionHits.set(hits);
    mentionTruncated.set(rows.length > hits.length);
    mentionSearched.set(true);
  } catch (error) {
    if (seq !== mentionReqSeq) return;
    mentionHits.set([]);
    mentionTruncated.set(false);
    mentionSearched.set(true);
    mentionNotice.set(
      `This host cannot search its files: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (seq === mentionReqSeq) mentionLoading.set(false);
  }
}

/** The host's rows: `search_files` answers a list, and a host that wraps it says `results`. */
function rowsOf(reply: unknown): unknown[] {
  if (Array.isArray(reply)) return reply;
  const record = (reply ?? {}) as Record<string, unknown>;
  return Array.isArray(record.results) ? record.results : [];
}

/** The host's rows, one per path, with workspace root applied and exact/prefix matches ranked first. */
function hitsOf(rows: unknown[], query = ""): MentionHit[] {
  const root = activeWorkspaceRoot().replace(/[\\/]+$/, "");
  const hits: MentionHit[] = [];
  const seen = new Set<string>();
  const q = query.trim().toLowerCase();
  for (const row of rows) {
    const record = (row ?? {}) as Record<string, unknown>;
    const raw = record.path ?? record.filePath ?? record.file ?? record.name;
    if (typeof raw !== "string" || !raw) continue;
    const directory = record.is_directory === true || record.isDirectory === true;
    const path = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw) || !root ? raw : `${root}/${raw}`;
    if (seen.has(path)) continue;
    seen.add(path);
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? raw;
    const relativePath = toRelativeWorkspacePath(path, root) ?? name;
    hits.push({ path, name, directory, relativePath });
  }
  if (q) {
    const score = (hit: MentionHit) => {
      const lowerName = hit.name.toLowerCase();
      if (lowerName === q) return 0;
      if (lowerName.startsWith(q)) return 1;
      if (lowerName.includes(q)) return 2;
      return 3;
    };
    hits.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }
  return hits.slice(0, RESULT_LIMIT);
}

let inlineToken: { start: number; end: number } | null = null;
let syncedText: string | null = null;
let syncedCaret = -1;

/**
 * Attaches the chosen file/folder as a styled `FileAttachment` chip in the composer
 * and strips the inline `@query` token (if triggered inline) instead of dumping raw `#file:` text.
 */
export function insertMention(hit: MentionHit, composer: InputRef | undefined): void {
  const replacing = mentionInline() ? inlineToken : null;
  inlineToken = null;
  closeMention();
  const root = activeWorkspaceRoot();
  addFileAttachment({
    name: hit.name,
    path: hit.path,
    relativePath: hit.relativePath || toRelativeWorkspacePath(hit.path, root) || hit.name,
    isDirectory: hit.directory,
    source: hit.directory ? "folder" : "file",
  });
  if (replacing) {
    const text = composerText();
    const before = text.slice(0, replacing.start);
    const after = text.slice(replacing.end);
    const next = before && after && !/\s$/.test(before) && !/^\s/.test(after) ? `${before} ${after}` : `${before}${after}`;
    composerText.set(next);
  }
  composer?.focus();
}

// Slash commands & Skills. A composer that holds `/name` (no space yet) opens the
// command + skills list; pressing a row or sending the exact command runs it instead
// of starting a plain turn.

export interface SlashCommand {
  id: string;
  command: string;
  /** The catalog key the host names; `description` is its English fallback. */
  labelKey: string;
  description: string;
  /** Commands that start or rewrite a turn wait until the running one ends. */
  idleOnly: boolean;
  /** Whether the host would run it right now. */
  available: boolean;
  args: string[];
  /** True for client-local / 2.0-wired composer commands that execute directly in nsh-ui. */
  local?: boolean;
  /** Optional usage hint displayed right beside the command (e.g. `[question]`). */
  argHint?: string;
}

export interface SlashSkillItem {
  name: string;
  description: string;
  argumentHint?: string;
  key?: string;
}

/** Client-local and 2.0-wired slash commands always discoverable in the `/` menu (1.0.12 parity). */
export const LOCAL_SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
  {
    id: "model",
    command: "/model",
    labelKey: "sessions.model",
    description: "Switch model",
    idleOnly: false,
    available: true,
    args: [],
    local: true,
    argHint: "[name]",
  },
  {
    id: "goal",
    command: "/goal",
    labelKey: "sessions.slashGoalDesc",
    description: "Set, pause, resume, or clear the session goal",
    idleOnly: false,
    available: true,
    args: ["clear", "pause", "resume", "edit"],
    local: true,
    argHint: "[objective | clear | pause | resume]",
  },
  {
    id: "btw",
    command: "/btw",
    labelKey: "sessions.slashBtwDesc",
    description: "Ask a side question without interrupting the turn",
    idleOnly: false,
    available: true,
    args: [],
    local: true,
    argHint: "[question]",
  },
  {
    id: "review",
    command: "/review",
    labelKey: "sessions.slashReviewDesc",
    description: "Launch a code review on current changes",
    idleOnly: false,
    available: true,
    args: [],
    local: true,
    argHint: "[strict] [focus]",
  },
  {
    id: "usage",
    command: "/usage",
    labelKey: "sessions.slashUsageDesc",
    description: "Show token usage for this session",
    idleOnly: false,
    available: true,
    args: [],
    local: true,
  },
];

/** The commands the host offers for the open session; empty until it answers. */
export const sessionCommandList = signal<SlashCommand[]>([]);
/** Set when the host has no session commands, so `/` explains instead of listing. */
export const sessionCommandsUnsupported = signal(false);
/** Active mode's user-invocable skills searchable right inside `/`. */
export const slashSkills = signal<SlashSkillItem[]>([]);

let commandsKey: string | null = null;
let skillsKey: string | null = null;
const SLASH_SKILL_NAME_RE = /^[A-Za-z][\w:-]*$/;

function mergedSlashCommands(): SlashCommand[] {
  const host = sessionCommandList();
  const seen = new Set(host.map(entry => entry.id));
  const local = LOCAL_SLASH_COMMANDS.filter(entry => !seen.has(entry.id));
  return [...host, ...local];
}

/** Reads the host's command list for a session; repeated calls for it are free. */
export async function loadSessionCommands(sessionId: string | null, force = false): Promise<void> {
  const key = sessionId ?? "";
  if (!force && key === commandsKey) return;
  commandsKey = key;
  try {
    const rows = await listSessionCommands(sessionId);
    if (commandsKey !== key) return;
    sessionCommandList.set(
      (rows ?? []).map(row => ({
        id: String(row.id),
        command: row.command || `/${row.id}`,
        labelKey: row.labelKey ?? "",
        description: row.description ?? "",
        idleOnly: row.idleOnly === true,
        available: row.available !== false,
        args: Array.isArray(row.args) ? row.args : [],
      })),
    );
    sessionCommandsUnsupported.set(false);
  } catch (error) {
    if (commandsKey !== key) return;
    sessionCommandList.set([]);
    sessionCommandsUnsupported.set(isMissingCommand(error, "list_session_commands"));
  }
}

/** Loads enabled user-invocable skills for the active mode/workspace so `/` can search & insert `[$Skill]`. */
export async function loadSlashSkills(
  modeId: string,
  workspaceId: string | null,
  workspacePath: string,
  force = false,
): Promise<void> {
  const key = `${modeId}|${workspaceId ?? ""}|${workspacePath}`;
  if (!force && key === skillsKey) return;
  skillsKey = key;
  try {
    let raw: unknown;
    try {
      raw = await invokeRawCommand<unknown>("get_mode_skill_configs", {
        modeId: modeId || "Standard",
        forceRefresh: force,
        includeDiagnostics: false,
        workspaceId: workspaceId || undefined,
        workspacePath: workspacePath || undefined,
      });
    } catch {
      raw = await invokeCommand<unknown>("get_skill_configs", {
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspacePath ? { workspacePath } : {}),
      });
    }
    if (skillsKey !== key) return;
    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { skills?: unknown[] } | null)?.skills)
        ? (raw as { skills: unknown[] }).skills
        : [];
    const seen = new Set<string>();
    const items: SlashSkillItem[] = [];
    for (const row of rows) {
      const rec = (row ?? {}) as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      if (!name || !SLASH_SKILL_NAME_RE.test(name)) continue;
      if (rec.enabled === false || rec.disabled === true) continue;
      if (rec.selectedForRuntime === false || rec.selected_for_runtime === false) continue;
      if (rec.effectiveEnabled === false || rec.effective_enabled === false) continue;
      if (rec.globallyEnabled === false || rec.globally_enabled === false) continue;
      if (rec.allowUserInvocation === false || rec.allow_user_invocation === false) continue;
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      items.push({
        name,
        description: typeof rec.description === "string" ? rec.description.trim() : "",
        argumentHint:
          typeof rec.argumentHint === "string"
            ? rec.argumentHint.trim() || undefined
            : typeof rec.argument_hint === "string"
              ? rec.argument_hint.trim() || undefined
              : undefined,
        key: typeof rec.key === "string" ? rec.key : undefined,
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    slashSkills.set(items);
  } catch {
    if (skillsKey !== key) return;
    slashSkills.set([]);
  }
}

/** The label a row shows: the client catalog's text when it has the key. */
export function slashCommandLabel(command: SlashCommand): string {
  const key = command.labelKey as MessageKey;
  const text = command.labelKey ? tr(key) : "";
  return text && text !== command.labelKey ? text : command.description;
}

/** The command list the composer's text asks for, or `null` when it is not a slash token. */
export function slashCommandsFor(text: string, running: boolean): SlashCommand[] | null {
  if (!text.startsWith("/") || /\s/.test(text)) return null;
  const query = text.slice(1).toLowerCase();
  return mergedSlashCommands().filter(entry => {
    if (running && entry.idleOnly) return false;
    const cmd = entry.command.slice(1).toLowerCase();
    if (cmd.startsWith(query) || cmd.includes(query)) return true;
    if (entry.id === "reload" && "reload-skills".startsWith(query)) return true;
    return false;
  });
}

/** Matching enabled skills for a leading `/query` token, ranked exact > prefix > substring. */
export function slashSkillsFor(text: string): SlashSkillItem[] {
  if (!text.startsWith("/") || /\s/.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  const list = slashSkills();
  if (!query) return list.slice(0, 12);
  const scored: Array<{ item: SlashSkillItem; rank: number }> = [];
  for (const item of list) {
    const lowerName = item.name.toLowerCase();
    const lowerDesc = item.description.toLowerCase();
    let rank = -1;
    if (lowerName === query) rank = 0;
    else if (lowerName.startsWith(query)) rank = 1;
    else if (lowerName.includes(query)) rank = 2;
    else if (lowerDesc.includes(query)) rank = 3;
    if (rank >= 0) scored.push({ item, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" }));
  return scored.slice(0, 12).map(s => s.item);
}

/** Replaces the leading `/query` token with the runtime-honored `[$<skillName>] ` token. */
export function insertSlashSkill(skill: SlashSkillItem, composer: InputRef | undefined): void {
  const token = `[$${skill.name}] `;
  composerText.set(token);
  composer?.focus();
}

/** The command a whole message names (`/reload skills`, `/reload-skills`, `/model claude`, `/goal ...`), if offered. */
export function parseSlashCommand(text: string): { command: SlashCommand; arg: string } | null {
  const trimmed = text.trim();
  const match = /^\/([a-z_-]+)(?:\s+([\s\S]+))?$/i.exec(trimmed);
  if (!match) return null;
  let id = match[1]!.toLowerCase();
  let rawArg = (match[2] ?? "").trim();
  if (id === "reload-skills") {
    id = "reload";
    rawArg = "skills";
  }
  const command = mergedSlashCommands().find(entry => entry.id === id);
  if (!command) return null;
  if (command.local) {
    return { command, arg: rawArg };
  }
  if (/\s/.test(rawArg)) return null;
  const arg = rawArg.toLowerCase();
  if (arg && !command.args.includes(arg)) return null;
  return { command, arg };
}

const STARTED_MESSAGES: Record<string, MessageKey> = {
  compaction_started: "chat.slash.compactStarted",
  init_started: "chat.slash.initStarted",
  reloaded: "chat.slash.reloaded",
};

/** Runs a slash command for a session through the host and returns what to tell the user. */
export async function runSlashCommand(
  sessionId: string,
  command: SlashCommand,
  arg = "",
): Promise<{ ok: boolean; message: string; outcome?: string }> {
  const workspaceId = activeWorkspaceId();
  try {
    const result = await executeSessionCommand({
      sessionId,
      id: command.id,
      ...(arg ? { arg } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    });
    const key = STARTED_MESSAGES[result?.outcome ?? ""];
    return { ok: true, message: key ? tr(key) : command.command, outcome: result?.outcome };
  } catch (error) {
    if (isMissingCommand(error, "execute_session_command")) {
      return { ok: false, message: tr("chat.slash.hostUpdateRequired") };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

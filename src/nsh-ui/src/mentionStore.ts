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
import { executeSessionCommand, listSessionCommands, searchWorkspaceFiles } from "./api";
import { tr, type MessageKey } from "./i18n";
import { activeWorkspaceId, activeWorkspaceRoot, composerText } from "./state";
import { isCommandUnavailable as isMissingCommand } from "./hostCommands";

/** One row of the picker: a path the host reported, split into what a row shows. */
export interface MentionHit {
  path: string;
  name: string;
  directory: boolean;
}

export const mentionOpen = signal(false);
export const mentionQuery = signal("");
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
const SEARCH_DEBOUNCE_MS = 150;
/** What the panel draws without a scrolling list of its own. */
const RESULT_LIMIT = 8;

let debounceTimer: number | null = null;
/** The query of the read in flight, so a slower answer cannot overwrite a newer one. */
let pendingQuery = "";

/** The tag for one row, in the shape the desktop composer writes it. */
export function mentionToken(hit: MentionHit): string {
  return `#${hit.directory ? "dir" : "file"}:${hit.name} `;
}

export function openMention(): void {
  mentionNotice.set("");
  mentionQuery.set("");
  mentionHits.set([]);
  mentionSearched.set(false);
  mentionTruncated.set(false);
  mentionInline.set(false);
  mentionOpen.set(true);
}

export function closeMention(): void {
  mentionOpen.set(false);
  mentionInline.set(false);
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
 * Follows the composer's text and caret: a typed `@` opens the panel with the
 * query the user is writing, and the panel closes once that token is gone
 * (a space, a deleted `@`, a caret moved elsewhere).
 */
/**
 * Follows the composer's text and caret: a typed `@` opens the panel with the
 * query the user is writing, and the panel closes once that token is gone (a
 * space, a deleted `@`).
 *
 * A caret report that comes with the text unchanged changes nothing: the widget
 * reports the caret when a press moves the focus too, and the one thing that must
 * not happen then is the token being forgotten just before a row replaces it.
 */
export function syncInlineMention(text: string, caret: number): void {
  if (text === syncedText) return;
  syncedText = text;
  const trigger = mentionTriggerAt(text, caret);
  if (!trigger) {
    inlineToken = null;
    if (mentionOpen() && mentionInline()) closeMention();
    return;
  }
  inlineToken = { start: trigger.start, end: trigger.end };
  if (!mentionOpen()) {
    mentionNotice.set("");
    mentionHits.set([]);
    mentionSearched.set(false);
    mentionTruncated.set(false);
    mentionOpen.set(true);
  }
  mentionInline.set(true);
  if (mentionQuery() !== trigger.query) setMentionQuery(trigger.query);
}

/**
 * Types the query. The host is asked once the typing settles: a search per
 * keystroke would answer a list the user has already moved past, and the files
 * scene's own search box is the only other reader of that command here.
 */
export function setMentionQuery(query: string): void {
  mentionQuery.set(query);
  mentionNotice.set("");
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  const trimmed = query.trim();
  if (!trimmed) {
    mentionHits.set([]);
    mentionSearched.set(false);
    mentionTruncated.set(false);
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void searchMentions(trimmed);
  }, SEARCH_DEBOUNCE_MS);
}

async function searchMentions(query: string): Promise<void> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId || !mentionOpen()) return;
  pendingQuery = query;
  mentionLoading.set(true);
  try {
    const reply = await searchWorkspaceFiles(workspaceId, query);
    // The workspace or the query may have moved on while the host answered.
    if (pendingQuery !== query || !mentionOpen() || activeWorkspaceId() !== workspaceId) return;
    const rows = rowsOf(reply);
    const hits = hitsOf(rows);
    mentionHits.set(hits);
    mentionTruncated.set(rows.length > hits.length);
    mentionSearched.set(true);
  } catch (error) {
    if (pendingQuery !== query) return;
    mentionHits.set([]);
    mentionTruncated.set(false);
    mentionSearched.set(true);
    mentionNotice.set(
      `This host cannot search its files: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (pendingQuery === query) mentionLoading.set(false);
  }
}

/** The host's rows: `search_files` answers a list, and a host that wraps it says `results`. */
function rowsOf(reply: unknown): unknown[] {
  if (Array.isArray(reply)) return reply;
  const record = (reply ?? {}) as Record<string, unknown>;
  return Array.isArray(record.results) ? record.results : [];
}

/** The host's rows, one per path, with the workspace root applied to a relative one. */
function hitsOf(rows: unknown[]): MentionHit[] {
  const root = activeWorkspaceRoot().replace(/[\\/]+$/, "");
  const hits: MentionHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = (row ?? {}) as Record<string, unknown>;
    const raw = record.path ?? record.filePath ?? record.file ?? record.name;
    if (typeof raw !== "string" || !raw) continue;
    const directory = record.is_directory === true || record.isDirectory === true;
    const path = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw) || !root ? raw : `${root}/${raw}`;
    if (seen.has(path)) continue;
    seen.add(path);
    // A content hit reports a line; the reference is still the file.
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? raw;
    hits.push({ path, name, directory });
    if (hits.length >= RESULT_LIMIT) break;
  }
  return hits;
}

/**
 * The `@…` the panel was opened on, so pressing a row replaces exactly that token.
 * It is kept from the edit that opened (or last grew) the token rather than read
 * from the caret at press time: a widget's last caret report can be older than what
 * is on screen, and replacing the wrong range would cut the message apart.
 */
let inlineToken: { start: number; end: number } | null = null;
/** The composer text the panel was last synchronised with. */
let syncedText: string | null = null;

/**
 * Puts a row's tag in the message. The composer's widget inserts it as the user's
 * own edit at the caret and reports the new text back through `onChange`; without
 * a widget (the headless runtime has none) the same tag is appended to the text
 * this surface sends, so the reference is in the message either way. A mention
 * typed as `@…` is replaced by its tag rather than left in front of it.
 */
export function insertMention(hit: MentionHit, composer: InputRef | undefined): void {
  const token = mentionToken(hit);
  const replacing = mentionInline() ? inlineToken : null;
  inlineToken = null;
  closeMention();
  const text = composerText();
  if (replacing) {
    // The composer is a controlled field, so the replacement is the text itself:
    // asking the widget to select and insert would depend on its caret report
    // being the one the user's typing left behind.
    composerText.set(`${text.slice(0, replacing.start)}${token}${text.slice(replacing.end)}`);
    composer?.focus();
    return;
  }
  if (composer) {
    composer.focus();
    composer.insertText(token);
    return;
  }
  composerText.set(`${text}${token}`);
}

// Slash commands. A composer that holds only `/name` (no space yet) opens the
// command list; pressing a row or sending the exact command runs it instead of
// starting a turn. The list and the commands are the host's
// (`list_session_commands` / `execute_session_command`), the same ones the IM
// bots offer, so `/compact` means the same thing whichever client typed it.

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
}

/** The commands the host offers for the open session; empty until it answers. */
export const sessionCommandList = signal<SlashCommand[]>([]);
/** Set when the host has no session commands, so `/` explains instead of listing. */
export const sessionCommandsUnsupported = signal(false);

let commandsKey: string | null = null;

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
  return sessionCommandList().filter(
    entry => entry.command.slice(1).startsWith(query) && (!running || !entry.idleOnly),
  );
}

/** The command a whole message names (`/reload skills` included), if the host offers it. */
export function parseSlashCommand(text: string): { command: SlashCommand; arg: string } | null {
  const trimmed = text.trim();
  const match = /^\/([a-z_]+)(?:\s+(\S+))?$/i.exec(trimmed);
  if (!match) return null;
  const command = sessionCommandList().find(entry => entry.id === match[1].toLowerCase());
  if (!command) return null;
  const arg = (match[2] ?? "").toLowerCase();
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

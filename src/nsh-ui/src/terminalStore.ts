// Terminal sessions for the whole app run. A scene rebuild must not create a
// second shell on the host, and switching tabs must restore what a shell already
// printed, so the sessions and their scrollback live here rather than in the
// scene component.

import { computed, signal } from "nsh";
import {
  closeTerminal,
  createTerminal,
  getTerminalHistory,
  listTerminalShells,
  resizeTerminal,
  writeTerminal,
  type TerminalShell,
} from "./api";
import { invokeCommand, listenEvent, setFleetOwnerLookup } from "./bridge";
import { Storage } from "nsh";
import { activeWorkspaceId, deviceContext } from "./state";

/**
 * The host emits `terminal_event` with `{ type, payload }`: `Data` carries the
 * bytes a shell printed, `Exit` ends it. `terminal-output` is a different,
 * remote-only notification that carries no bytes and needs a history pull.
 */
interface TerminalEventPayload {
  type?: string;
  payload?: {
    session_id?: string;
    data?: string | number[];
    exit_code?: number | null;
    title?: string;
  };
}

export interface TerminalTab {
  id: string;
  title: string;
  status: string;
  /** Structured exit code emitted by `Exit` events (null when absent). */
  exitCode?: number | null;
  /** What this shell has printed, so a tab switch can draw it again. */
  buffer: string;
  /**
   * A tab somebody named (a profile's name) keeps that name; a tab started without
   * one follows the title the shell sets, which is what the desktop shows too.
   */
  named: boolean;
  /** The workspace the shell belongs to; tabs show per workspace (null: any). */
  workspaceId?: string | null;
  /** The host reports an agent started this shell (`source: "agent"`). */
  agentCreated?: boolean;
  /** Where the host's scrollback ended at the last read, for delta replays. */
  nextOffset?: number;
  /**
   * The device the shell runs on (`""` without the fleet layer). Terminals are
   * keyed `(deviceId, id)`: a shell shows only while its device is the context.
   */
  deviceId?: string;
}

/** Upper bound on in-memory scrollback per terminal tab (prevents unbounded growth). */
const MAX_BUFFER_CHARS = 200_000;

function trimBuffer(text: string): string {
  if (text.length <= MAX_BUFFER_CHARS) return text;
  const sliced = text.slice(text.length - MAX_BUFFER_CHARS);
  const newline = sliced.indexOf("\n");
  return newline >= 0 && newline < 4096 ? sliced.slice(newline + 1) : sliced;
}

function decodeBinaryPayload(data: unknown): string {
  if (typeof data === "string") {
    if (!data) return "";
    // Real Rust `TerminalEvent::BinaryData` may send base64 or raw text.
    try {
      if (typeof atob === "function") {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        if (typeof TextDecoder === "function") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        return binary;
      }
    } catch {
      return data;
    }
    return data;
  }
  if (Array.isArray(data) && data.length > 0) {
    const bytes = new Uint8Array(data.map(v => Number(v) & 0xff));
    if (typeof TextDecoder === "function") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }
  return "";
}

export const terminalTabs = signal<TerminalTab[]>([]);
/** The tabs of the active workspace on the device context: a shell runs in one workspace and shows there. */
export const visibleTerminalTabs = computed<TerminalTab[]>(() => {
  const workspaceId = activeWorkspaceId();
  const device = deviceContext();
  return terminalTabs().filter(
    tab =>
      (tab.deviceId ?? "") === device && (!tab.workspaceId || !workspaceId || tab.workspaceId === workspaceId),
  );
});

// A command acting on a terminal goes to the device that runs it.
setFleetOwnerLookup("terminal", id => {
  const device = deviceContext();
  const tabs = terminalTabs().filter(tab => tab.id === id);
  const tab = tabs.find(item => (item.deviceId ?? "") === device) ?? tabs[0];
  return tab?.deviceId || null;
});
/** A running shell waiting for the user to confirm closing it. */
export const confirmingCloseTerminal = signal<string | null>(null);
/** The tab whose name is being edited. */
export const renamingTerminal = signal<string | null>(null);
/** The tab on screen; also the session input and resize go to. */
export const terminalId = signal<string | null>(null);
export const terminalStatus = signal<string>("idle");
export const terminalMessage = signal<string>("");
/** The active tab record (or null when no tab is selected). */
export const activeTerminalTab = computed<TerminalTab | null>(() => {
  const id = terminalId();
  if (!id) return null;
  return terminalTabs().find(tab => tab.id === id) ?? null;
});
/** The shells this host reports; a host without shell detection answers with none. */
export const terminalShells = signal<TerminalShell[]>([]);
/** The shell the next `New shell` starts, by the discovered shell's own id. */
export const selectedShellId = signal<string | null>(null);
export const shellPickerOpen = signal(false);

/**
 * The chosen shell is a preference of this surface, kept on the device: the host
 * would otherwise start its default every time the window opens.
 */
const SHELL_STORAGE_KEY = "openbitfun.nsh.terminal-shell.v1";

let outputWriter: ((data: string) => void) | null = null;
let resetter: (() => void) | null = null;
let starting = false;
let subscribed = false;

/** Pending PTY data coalesced per animation frame (eliminates per-chunk array clones). */
const pendingPtyData = new Map<string, string>();
let ptyFlushRafId: number | null = null;

function flushPendingPtyData(): void {
  if (ptyFlushRafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(ptyFlushRafId);
  }
  ptyFlushRafId = null;
  if (pendingPtyData.size === 0) return;
  const batch = new Map(pendingPtyData);
  pendingPtyData.clear();

  const activeId = terminalId();
  terminalTabs.update(current => {
    let changed = false;
    const next = current.map(tab => {
      const chunk = batch.get(tab.id);
      if (!chunk) return tab;
      changed = true;
      return { ...tab, buffer: trimBuffer(tab.buffer + chunk) };
    });
    return changed ? next : current;
  });

  if (activeId) {
    const activeChunk = batch.get(activeId);
    if (activeChunk) outputWriter?.(activeChunk);
  }
}

function enqueuePtyChunk(id: string, chunk: string): void {
  if (!chunk) return;
  pendingPtyData.set(id, (pendingPtyData.get(id) ?? "") + chunk);
  if (typeof requestAnimationFrame === "function") {
    if (ptyFlushRafId === null) {
      ptyFlushRafId = requestAnimationFrame(() => {
        ptyFlushRafId = null;
        flushPendingPtyData();
      });
    }
    return;
  }
  // Headless test runtimes without rAF flush immediately for determinism.
  flushPendingPtyData();
}

/** Connects the terminal view to the host; the view forwards its output and reset. */
export function attachTerminalWriter(writer: (data: string) => void, reset: () => void): void {
  outputWriter = writer;
  resetter = reset;
}

function updateTab(id: string, patch: Partial<TerminalTab>): void {
  terminalTabs.update(current => current.map(tab => (tab.id === id ? { ...tab, ...patch } : tab)));
  const active = terminalTabs().find(tab => tab.id === terminalId());
  if (active && active.id === id && patch.status) terminalStatus.set(patch.status);
}

function subscribeOutput(): void {
  if (subscribed) return;
  subscribed = true;
  // A remote shell's output notice carries no bytes: pull what is new.
  listenEvent<{ session_id?: string; sessionId?: string }>("terminal-output", (event, meta) => {
    const id = event?.sessionId ?? event?.session_id;
    if (id && terminalTabs().some(tab => tab.id === id && (tab.deviceId ?? "") === meta.origin)) void resyncTerminal(id);
  });
  listenEvent<TerminalEventPayload>("terminal_event", (event, meta) => {
    const payload = event?.payload;
    if (!payload?.session_id) return;
    const id = payload.session_id;
    // Only the shell of the device that emitted it (terminal ids repeat across devices).
    const tab = terminalTabs().find(item => item.id === id && (item.deviceId ?? "") === meta.origin);
    if (!tab) return;
    if (event?.type === "Data" && typeof payload.data === "string" && payload.data) {
      enqueuePtyChunk(id, payload.data);
      return;
    }
    if (event?.type === "BinaryData" && payload.data !== undefined) {
      const decoded = decodeBinaryPayload(payload.data);
      if (decoded) enqueuePtyChunk(id, decoded);
      return;
    }
    // Flush any buffered PTY chunks before state transitions (`Exit` / `TitleChanged`).
    flushPendingPtyData();
    if (event?.type === "Exit") {
      const code = typeof payload.exit_code === "number" ? payload.exit_code : null;
      const status = code !== null ? `exited (${code})` : "exited";
      updateTab(id, { status, exitCode: code });
      if (terminalId() === id) {
        terminalStatus.set("exited");
        // Exit status is surfaced through the localized §4.10 bottom bar, not raw English text.
        terminalMessage.set("");
      }
      return;
    }
    if (event?.type === "TitleChanged" && typeof payload.title === "string") {
      applyTerminalTitle(id, payload.title);
    }
  });
}

/**
 * A shell's own title (`vim notes.md`, the ssh host it is in). A tab the user named
 * is left alone, so a profile keeps the name it was saved under.
 */
export function applyTerminalTitle(id: string, title: string): void {
  const next = title.trim();
  if (!next) return;
  const tab = terminalTabs().find(item => item.id === id);
  if (!tab || tab.named || tab.title === next) return;
  updateTab(id, { title: next });
}

async function replayHistory(sessionId: string): Promise<void> {
  try {
    const history = await getTerminalHistory(sessionId);
    if (typeof history?.nextOffset === "number") updateTab(sessionId, { nextOffset: history.nextOffset });
    if (!history?.data) return;
    flushPendingPtyData();
    const tab = terminalTabs().find(item => item.id === sessionId);
    if (!tab) return;
    const existing = tab.buffer;
    if (!existing) {
      updateTab(sessionId, { buffer: trimBuffer(history.data) });
      if (terminalId() === sessionId) outputWriter?.(history.data);
      return;
    }
    // Deduplicate against live `Data` chunks that arrived while `terminal_get_history`
    // was in flight so initial shell prompts are never drawn twice.
    if (existing === history.data || existing.startsWith(history.data)) {
      return;
    }
    if (history.data.endsWith(existing)) {
      const merged = trimBuffer(history.data);
      updateTab(sessionId, { buffer: merged });
      if (terminalId() === sessionId) {
        resetter?.();
        outputWriter?.(merged);
      }
      return;
    }
    const merged = trimBuffer(history.data + existing);
    updateTab(sessionId, { buffer: merged });
    if (terminalId() === sessionId) {
      resetter?.();
      outputWriter?.(merged);
    }
  } catch {
    // A host that has no replay for this session still gets live output.
  }
}

/** The plain shell type name a discovered shell reports, when it is a plain one. */
export function shellTypeOf(shellId: string | null): string {
  if (!shellId) return "";
  const type = terminalShells().find(entry => entry.id === shellId)?.type.trim() ?? "";
  return /^[A-Za-z]+$/.test(type) ? type : "";
}

/**
 * Opens a shell from a saved profile: the profile's shell, then its startup
 * command typed into the shell as if the user had typed it.
 */
export async function openProfile(
  workspaceId: string | null,
  workingDirectory: string,
  profile: { name: string; shellId: string; shellType: string; startupCommand: string },
): Promise<void> {
  const opened = await openTerminal(workspaceId, workingDirectory, {
    shellId: profile.shellId || undefined,
    shellType: profile.shellType || undefined,
    title: profile.name,
  });
  if (!opened) return;
  const command = profile.startupCommand.trim();
  if (!command) return;
  // The host types the command and its newline itself, the way the desktop
  // starts a profile; an older host without the command gets the keystrokes.
  try {
    await invokeCommand<unknown>("terminal_send_command", { sessionId: opened, command });
  } catch {
    await writeTerminal(opened, `${command}\r`);
  }
}

/** Opens one more shell for the workspace and puts it on screen. */
export async function openTerminal(
  workspaceId: string | null,
  workingDirectory: string,
  override?: { shellId?: string; shellType?: string; title?: string },
): Promise<string | null> {
  if (starting) return null;
  starting = true;
  subscribeOutput();
  const index = visibleTerminalTabs().length + 1;
  if (!terminalShells().length) await loadTerminalShells();
  const shellId = override?.shellId ?? selectedShellId() ?? "";
  const shell = terminalShells().find(entry => entry.id === shellId);
  try {
    const session = await createTerminal({
      ...(workspaceId ? { workspaceId } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(shell ? shellRequestFor(shell) : {}),
      // A profile names a shell the host may no longer report; the plain type is
      // what the host still accepts then.
      ...(!shell && override?.shellType ? { shellType: override.shellType } : {}),
      cols: lastSize.cols,
      rows: lastSize.rows,
    });
    terminalTabs.update(current => [
      ...current,
      {
        id: session.id,
        title: override?.title || shell?.name || `shell ${index}`,
        status: "running",
        buffer: "",
        named: Boolean(override?.title),
        workspaceId: workspaceId ?? null,
        deviceId: deviceContext(),
      },
    ]);
    selectTerminal(session.id);
    await replayHistory(session.id);
    return session.id;
  } catch (error) {
    terminalMessage.set(error instanceof Error ? error.message : String(error));
    if (!terminalTabs().length) terminalStatus.set("failed");
    return null;
  } finally {
    starting = false;
  }
}

/**
 * `terminal_create` takes the discovered shell by its stable id, and the type as
 * well when the host named a plain variant: `Custom("...")` is a Rust debug name
 * the enum cannot deserialize back, so it is left out.
 */
export function shellRequestFor(shell: TerminalShell): { shellId?: string; shellType?: string } {
  const type = shell.type.trim();
  return {
    ...(shell.id ? { shellId: shell.id } : {}),
    ...(/^[A-Za-z]+$/.test(type) ? { shellType: type } : {}),
  };
}

/**
 * Reads the host's shells once, and the shell the last run left selected. The
 * first shell waits for this list: a stored shell id is only usable once the
 * shells it names are known.
 */
export function loadTerminalShells(): Promise<void> {
  if (!shellsLoad) shellsLoad = readShells();
  return shellsLoad;
}

let shellsLoad: Promise<void> | null = null;

async function readShells(): Promise<void> {
  const saved = await readStoredShellId();
  if (saved) selectedShellId.set(saved);
  try {
    const shells = await listTerminalShells();
    // A shell the host reports as unavailable is not offered, and a stored choice
    // that no longer exists falls back to the host's default.
    terminalShells.set(shells.filter(shell => shell.id && shell.available !== false));
  } catch {
    // Shell detection is not required to run a shell: the host's default works.
    terminalShells.set([]);
  }
}

async function readStoredShellId(): Promise<string | null> {
  try {
    const raw = await Storage.getItem(SHELL_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function chooseShell(shellId: string | null): void {
  selectedShellId.set(shellId);
  shellPickerOpen.set(false);
  if (!shellId) {
    void Storage.removeItem(SHELL_STORAGE_KEY).catch(() => undefined);
    return;
  }
  void Storage.setItem(SHELL_STORAGE_KEY, shellId).catch(() => undefined);
}

export function selectedShellLabel(): string {
  const id = selectedShellId();
  if (!id) return "default shell";
  return terminalShells().find(entry => entry.id === id)?.name || id;
}

/** Draws one tab: its own scrollback replaces whatever the view held. */
export function selectTerminal(id: string): void {
  flushPendingPtyData();
  const tab = terminalTabs().find(item => item.id === id);
  if (!tab) return;
  terminalId.set(id);
  terminalStatus.set(tab.status.toLowerCase().startsWith("exited") ? "exited" : tab.status);
  terminalMessage.set("");
  resetter?.();
  if (tab.buffer) outputWriter?.(tab.buffer);
  // A shell that was off screen still has the size it had then: give it the
  // view's size, or its output wraps at the old width.
  if (lastSizeKnown) void resizeTerminal(id, lastSize.cols, lastSize.rows).catch(() => undefined);
  // A shell this surface attached to (an agent's) has no scrollback here yet.
  if (!tab.buffer && tab.nextOffset === undefined) void replayHistory(id);
}

/** One shell for the workspace, created on first use. */
export async function ensureTerminal(workspaceId: string | null, workingDirectory: string): Promise<void> {
  if (starting) return;
  await reattachTerminals(workspaceId);
  const visible = visibleTerminalTabs();
  if (visible.length) {
    if (!visible.some(tab => tab.id === terminalId())) selectTerminal(visible[visible.length - 1].id);
    return;
  }
  terminalStatus.set("starting");
  await openTerminal(workspaceId, workingDirectory);
}

const attachedWorkspaces = new Set<string>();

/**
 * Picks up the shells the host already runs for this workspace — an agent's, or
 * the ones a previous window opened — the way the desktop's terminal panel lists
 * `terminal_list`. Each is attached once and replays its scrollback when shown.
 */
export async function reattachTerminals(workspaceId: string | null): Promise<void> {
  const device = deviceContext();
  const attachKey = `${device}/${workspaceId ?? ""}`;
  if (!workspaceId || attachedWorkspaces.has(attachKey)) return;
  attachedWorkspaces.add(attachKey);
  subscribeOutput();
  let sessions: Array<Record<string, unknown>>;
  try {
    const raw = await invokeCommand<Array<Record<string, unknown>>>("terminal_list");
    sessions = Array.isArray(raw) ? raw : [];
  } catch {
    // An older host without the list keeps the shells this surface opens.
    return;
  }
  const known = new Set(terminalTabs().filter(tab => (tab.deviceId ?? "") === device).map(tab => tab.id));
  const added: TerminalTab[] = [];
  for (const session of sessions) {
    const id = typeof session?.id === "string" ? session.id : "";
    const owner = session.workspaceId ?? session.workspace_id;
    if (!id || known.has(id) || owner !== workspaceId) continue;
    const status = String(session.status ?? "running").toLowerCase();
    added.push({
      id,
      title: String(session.name ?? "") || `shell ${visibleTerminalTabs().length + added.length + 1}`,
      status: /exit|stop|dead|closed/.test(status) ? "exited" : "running",
      buffer: "",
      named: false,
      workspaceId,
      agentCreated: String(session.source ?? "").toLowerCase() === "agent",
      deviceId: device,
    });
  }
  if (added.length) terminalTabs.update(current => [...current, ...added]);
}

/**
 * Catches a shell up after a gap (a remote output notice, a reconnect): reads
 * only what the host printed after the last offset this surface has, and
 * replays the whole scrollback when the host says that window was trimmed.
 */
export async function resyncTerminal(sessionId: string): Promise<void> {
  const tab = terminalTabs().find(item => item.id === sessionId);
  if (!tab) return;
  if (tab.nextOffset === undefined) {
    await replayHistory(sessionId);
    return;
  }
  try {
    const page = await getTerminalHistory(sessionId, tab.nextOffset);
    if (!page) return;
    if (page.truncated) {
      updateTab(sessionId, { buffer: "", nextOffset: undefined });
      if (terminalId() === sessionId) resetter?.();
      await replayHistory(sessionId);
      return;
    }
    updateTab(sessionId, { nextOffset: page.nextOffset });
    if (page.data) enqueuePtyChunk(sessionId, page.data);
  } catch {
    // The live stream still delivers; the next notice tries again.
  }
}

/** Clears what the view shows (the shell and its process keep running). */
export function clearTerminalView(): void {
  const id = terminalId();
  if (!id) return;
  flushPendingPtyData();
  updateTab(id, { buffer: "" });
  resetter?.();
}

export function renameTerminalTab(id: string, title: string): void {
  renamingTerminal.set(null);
  const next = title.trim();
  if (!next) return;
  updateTab(id, { title: next, named: true });
}

/** Closing a running shell asks first: it ends whatever runs in it. */
export function requestCloseTerminalTab(id: string): void {
  const tab = terminalTabs().find(item => item.id === id);
  if (tab && tab.status === "running") {
    confirmingCloseTerminal.set(id);
    return;
  }
  void closeTerminalTab(id);
}

export function cancelCloseTerminal(): void {
  confirmingCloseTerminal.set(null);
}

let lastSize = { cols: 120, rows: 32 };
let lastSizeKnown = false;

export async function closeTerminalTab(id: string): Promise<void> {
  if (confirmingCloseTerminal() === id) confirmingCloseTerminal.set(null);
  pendingPtyData.delete(id);
  const remaining = terminalTabs().filter(tab => tab.id !== id);
  terminalTabs.set(remaining);
  await closeTerminal(id).catch(() => undefined);
  if (terminalId() !== id) return;
  const next = visibleTerminalTabs()[visibleTerminalTabs().length - 1];
  terminalId.set(null);
  resetter?.();
  if (next) {
    selectTerminal(next.id);
    return;
  }
  terminalStatus.set("closed");
  terminalMessage.set("");
}

/**
 * Forgets the shells this surface was showing without closing them on the host.
 * Switching to another device leaves those shells running on the machine that
 * owns them; closing them would kill work the user did not ask to stop.
 */
export function forgetTerminals(): void {
  if (ptyFlushRafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(ptyFlushRafId);
  }
  ptyFlushRafId = null;
  pendingPtyData.clear();
  attachedWorkspaces.clear();
  terminalTabs.set([]);
  terminalId.set(null);
  terminalStatus.set("idle");
  terminalMessage.set("");
  resetter?.();
}

export function sendTerminalInput(data: string): void {
  const id = terminalId();
  if (!id) return;
  void writeTerminal(id, data).catch(error => {
    terminalMessage.set(error instanceof Error ? error.message : String(error));
  });
}

export function sendTerminalResize(cols: number, rows: number): void {
  if (cols > 0 && rows > 0) {
    lastSize = { cols, rows };
    lastSizeKnown = true;
  }
  const id = terminalId();
  if (!id) return;
  void resizeTerminal(id, cols, rows).catch(() => undefined);
}

/** Closes the tab on screen, and with it the shell it runs. */
export async function stopTerminal(): Promise<void> {
  const id = terminalId();
  if (!id) return;
  await closeTerminalTab(id);
}

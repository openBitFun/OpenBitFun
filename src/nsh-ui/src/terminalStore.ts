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
import { currentDeviceScopeKey } from "./shared/deviceScope";
import { errorMessageOf } from "./shared/errorUtils";
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

interface ScrollbackRing {
  chunks: string[];
  totalChars: number;
}

/** Non-reactive per-tab scrollback rings keyed by `(deviceId, id)` so 60 Hz output never clones `terminalTabs`. */
const scrollbackRings = new Map<string, ScrollbackRing>();

/** Monotonic version bumped on PTY flushes for lightweight observers without rebuilding `terminalTabs`. */
export const terminalOutputVersion = signal(0);

function terminalTabKey(deviceId: string | undefined, id: string): string {
  return `${deviceId ?? ""}/${id}`;
}

function trimBuffer(text: string): string {
  if (text.length <= MAX_BUFFER_CHARS) return text;
  const sliced = text.slice(text.length - MAX_BUFFER_CHARS);
  const newline = sliced.indexOf("\n");
  return newline >= 0 && newline < 4096 ? sliced.slice(newline + 1) : sliced;
}

function appendScrollback(key: string, chunk: string): void {
  if (!chunk) return;
  let ring = scrollbackRings.get(key);
  if (!ring) {
    ring = { chunks: [], totalChars: 0 };
    scrollbackRings.set(key, ring);
  }
  if (chunk.length >= MAX_BUFFER_CHARS) {
    const trimmed = trimBuffer(chunk);
    ring.chunks = trimmed ? [trimmed] : [];
    ring.totalChars = trimmed.length;
    return;
  }
  ring.chunks.push(chunk);
  ring.totalChars += chunk.length;
  while (ring.totalChars > MAX_BUFFER_CHARS && ring.chunks.length > 1) {
    const dropped = ring.chunks.shift()!;
    ring.totalChars -= dropped.length;
  }
  if (ring.totalChars > MAX_BUFFER_CHARS && ring.chunks.length === 1) {
    const trimmed = trimBuffer(ring.chunks[0]!);
    ring.chunks[0] = trimmed;
    ring.totalChars = trimmed.length;
  }
}

function setScrollback(key: string, text: string): void {
  if (!text) {
    scrollbackRings.delete(key);
    return;
  }
  const trimmed = trimBuffer(text);
  scrollbackRings.set(key, { chunks: trimmed ? [trimmed] : [], totalChars: trimmed.length });
}

/** Returns the buffered scrollback text for one terminal tab on demand. */
export function getTerminalScrollback(id: string, deviceId: string = deviceContext()): string {
  const ring = scrollbackRings.get(terminalTabKey(deviceId, id));
  if (!ring || ring.chunks.length === 0) return "";
  if (ring.chunks.length === 1) return ring.chunks[0]!;
  const joined = ring.chunks.join("");
  ring.chunks = [joined];
  ring.totalChars = joined.length;
  return joined;
}

function findTab(id: string, deviceId?: string): TerminalTab | undefined {
  const tabs = terminalTabs();
  if (deviceId !== undefined) {
    return tabs.find(item => item.id === id && (item.deviceId ?? "") === deviceId);
  }
  const currentDevice = deviceContext();
  return (
    tabs.find(item => item.id === id && (item.deviceId ?? "") === currentDevice) ??
    tabs.find(item => item.id === id)
  );
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
  const device = deviceContext();
  return (
    terminalTabs().find(tab => tab.id === id && (tab.deviceId ?? "") === device) ??
    terminalTabs().find(tab => tab.id === id) ??
    null
  );
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

/** Pending PTY data coalesced per animation frame, keyed by `(deviceId, id)`. */
const pendingPtyData = new Map<string, string[]>();
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
  const activeKey = activeId ? terminalTabKey(deviceContext(), activeId) : null;
  let activeChunk = "";

  for (const [key, parts] of batch) {
    const chunk = parts.length === 1 ? parts[0]! : parts.join("");
    if (!chunk) continue;
    appendScrollback(key, chunk);
    if (key === activeKey) {
      activeChunk = chunk;
    }
  }

  terminalOutputVersion.update(v => v + 1);
  if (activeChunk) outputWriter?.(activeChunk);
}

function enqueuePtyChunk(id: string, chunk: string, deviceId: string = deviceContext()): void {
  if (!chunk) return;
  const key = terminalTabKey(deviceId, id);
  const existing = pendingPtyData.get(key);
  if (existing) existing.push(chunk);
  else pendingPtyData.set(key, [chunk]);
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

function updateTab(id: string, patch: Partial<TerminalTab>, deviceId?: string): void {
  const targetDevice = deviceId ?? deviceContext();
  terminalTabs.update(current =>
    current.map(tab =>
      tab.id === id && (deviceId === undefined || (tab.deviceId ?? "") === targetDevice)
        ? { ...tab, ...patch }
        : tab,
    ),
  );
  const active = findTab(terminalId() ?? "");
  if (active && active.id === id && (deviceId === undefined || (active.deviceId ?? "") === targetDevice) && patch.status) {
    terminalStatus.set(patch.status);
  }
}

function subscribeOutput(): void {
  if (subscribed) return;
  subscribed = true;
  // A remote shell's output notice carries no bytes: pull what is new (single-flight).
  listenEvent<{ session_id?: string; sessionId?: string }>("terminal-output", (event, meta) => {
    const id = event?.sessionId ?? event?.session_id;
    if (id && findTab(id, meta.origin)) void resyncTerminal(id, meta.origin);
  });
  listenEvent<TerminalEventPayload>("terminal_event", (event, meta) => {
    const payload = event?.payload;
    if (!payload?.session_id) return;
    const id = payload.session_id;
    // Only the shell of the device that emitted it (terminal ids repeat across devices).
    const tab = findTab(id, meta.origin);
    if (!tab) return;
    if (event?.type === "Data" && typeof payload.data === "string" && payload.data) {
      enqueuePtyChunk(id, payload.data, meta.origin);
      return;
    }
    if (event?.type === "BinaryData" && payload.data !== undefined) {
      const decoded = decodeBinaryPayload(payload.data);
      if (decoded) enqueuePtyChunk(id, decoded, meta.origin);
      return;
    }
    // Flush any buffered PTY chunks before state transitions (`Exit` / `TitleChanged`).
    flushPendingPtyData();
    if (event?.type === "Exit") {
      const code = typeof payload.exit_code === "number" ? payload.exit_code : null;
      const status = code !== null ? `exited (${code})` : "exited";
      updateTab(id, { status, exitCode: code }, meta.origin);
      if (terminalId() === id && (tab.deviceId ?? "") === deviceContext()) {
        terminalStatus.set("exited");
        // Exit status is surfaced through the localized §4.10 bottom bar, not raw English text.
        terminalMessage.set("");
      }
      return;
    }
    if (event?.type === "TitleChanged" && typeof payload.title === "string") {
      applyTerminalTitle(id, payload.title, meta.origin);
    }
  });
}

/**
 * A shell's own title (`vim notes.md`, the ssh host it is in). A tab the user named
 * is left alone, so a profile keeps the name it was saved under.
 */
export function applyTerminalTitle(id: string, title: string, deviceId?: string): void {
  const next = title.trim();
  if (!next) return;
  const tab = findTab(id, deviceId);
  if (!tab || tab.named || tab.title === next) return;
  updateTab(id, { title: next }, tab.deviceId ?? "");
}

async function replayHistory(sessionId: string, deviceId: string = deviceContext()): Promise<void> {
  const key = terminalTabKey(deviceId, sessionId);
  try {
    const history = await getTerminalHistory(sessionId);
    if (typeof history?.nextOffset === "number") updateTab(sessionId, { nextOffset: history.nextOffset }, deviceId);
    if (!history?.data) return;
    flushPendingPtyData();
    const tab = findTab(sessionId, deviceId);
    if (!tab) return;
    const isActive = terminalId() === sessionId && deviceContext() === deviceId;
    const existing = getTerminalScrollback(sessionId, deviceId);
    if (!existing) {
      setScrollback(key, history.data);
      if (isActive) outputWriter?.(history.data);
      return;
    }
    // Deduplicate against live `Data` chunks that arrived while `terminal_get_history`
    // was in flight so initial shell prompts are never drawn twice.
    if (existing === history.data || existing.startsWith(history.data)) {
      return;
    }
    if (history.data.endsWith(existing)) {
      setScrollback(key, history.data);
      if (isActive) {
        resetter?.();
        outputWriter?.(getTerminalScrollback(sessionId, deviceId));
      }
      return;
    }
    setScrollback(key, history.data + existing);
    if (isActive) {
      resetter?.();
      outputWriter?.(getTerminalScrollback(sessionId, deviceId));
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
  const device = deviceContext();
  const index = visibleTerminalTabs().length + 1;
  if (!terminalShells().length || shellsLoadedForDevice !== currentDeviceScopeKey()) {
    await loadTerminalShells();
  }
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
        deviceId: device,
      },
    ]);
    selectTerminal(session.id);
    await replayHistory(session.id, device);
    return session.id;
  } catch (error) {
    terminalMessage.set(errorMessageOf(error));
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
 * Reads the host's shells per device, and the shell the last run left selected.
 * Switching `deviceContext()` reloads shells for the new device instead of
 * reusing a stale global promise from another OS/host.
 */
const shellsLoadByDevice = new Map<string, Promise<void>>();
let shellsLoadedForDevice: string | null = null;

export function loadTerminalShells(force = false): Promise<void> {
  const deviceKey = currentDeviceScopeKey();
  if (force) {
    shellsLoadByDevice.delete(deviceKey);
  }
  let flight = shellsLoadByDevice.get(deviceKey);
  if (!flight) {
    flight = readShells(deviceKey).finally(() => {
      if (shellsLoadByDevice.get(deviceKey) === flight && shellsLoadedForDevice !== deviceKey) {
        shellsLoadByDevice.delete(deviceKey);
      }
    });
    shellsLoadByDevice.set(deviceKey, flight);
  }
  return flight;
}

async function readShells(deviceKey: string): Promise<void> {
  const saved = await readStoredShellId();
  if (saved && currentDeviceScopeKey() === deviceKey) selectedShellId.set(saved);
  try {
    const shells = await listTerminalShells();
    if (currentDeviceScopeKey() !== deviceKey) return;
    // A shell the host reports as unavailable is not offered, and a stored choice
    // that no longer exists falls back to the host's default.
    terminalShells.set(shells.filter(shell => shell.id && shell.available !== false));
    shellsLoadedForDevice = deviceKey;
  } catch {
    if (currentDeviceScopeKey() !== deviceKey) return;
    // Shell detection is not required to run a shell: the host's default works.
    terminalShells.set([]);
    shellsLoadedForDevice = deviceKey;
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
  const tab = findTab(id);
  if (!tab) return;
  const tabDevice = tab.deviceId ?? "";
  terminalId.set(id);
  terminalStatus.set(tab.status.toLowerCase().startsWith("exited") ? "exited" : tab.status);
  terminalMessage.set("");
  resetter?.();
  const buffered = getTerminalScrollback(id, tabDevice);
  if (buffered) outputWriter?.(buffered);
  // A shell that was off screen still has the size it had then: give it the
  // view's size, or its output wraps at the old width.
  if (lastSizeKnown) void resizeTerminal(id, lastSize.cols, lastSize.rows).catch(() => undefined);
  // A shell this surface attached to (an agent's) has no scrollback here yet.
  if (!buffered && tab.nextOffset === undefined) void replayHistory(id, tabDevice);
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

const resyncInFlight = new Map<string, Promise<void>>();
const resyncAgain = new Set<string>();

/**
 * Catches a shell up after a gap (a remote output notice, a reconnect): reads
 * only what the host printed after the last offset this surface has, and
 * replays the whole scrollback when the host says that window was trimmed.
 * Single-flight per `(deviceId, sessionId)` so concurrent notices never read
 * the same `nextOffset` and duplicate output.
 */
export function resyncTerminal(sessionId: string, deviceId?: string): Promise<void> {
  const tab = findTab(sessionId, deviceId);
  if (!tab) return Promise.resolve();
  const tabDevice = tab.deviceId ?? "";
  const key = terminalTabKey(tabDevice, sessionId);
  const existing = resyncInFlight.get(key);
  if (existing) {
    resyncAgain.add(key);
    return existing;
  }
  const run = (async () => {
    try {
      await runResyncTerminalOnce(sessionId, tabDevice);
    } finally {
      resyncInFlight.delete(key);
      if (resyncAgain.delete(key)) {
        void resyncTerminal(sessionId, tabDevice);
      }
    }
  })();
  resyncInFlight.set(key, run);
  return run;
}

async function runResyncTerminalOnce(sessionId: string, deviceId: string): Promise<void> {
  const tab = findTab(sessionId, deviceId);
  if (!tab) return;
  if (tab.nextOffset === undefined) {
    await replayHistory(sessionId, deviceId);
    return;
  }
  try {
    const page = await getTerminalHistory(sessionId, tab.nextOffset);
    if (!page) return;
    const key = terminalTabKey(deviceId, sessionId);
    if (page.truncated) {
      setScrollback(key, "");
      updateTab(sessionId, { nextOffset: undefined }, deviceId);
      if (terminalId() === sessionId && deviceContext() === deviceId) resetter?.();
      await replayHistory(sessionId, deviceId);
      return;
    }
    updateTab(sessionId, { nextOffset: page.nextOffset }, deviceId);
    if (page.data) enqueuePtyChunk(sessionId, page.data, deviceId);
  } catch {
    // The live stream still delivers; the next notice tries again.
  }
}

/** Clears what the view shows (the shell and its process keep running). */
export function clearTerminalView(): void {
  const id = terminalId();
  if (!id) return;
  flushPendingPtyData();
  const tab = findTab(id);
  const tabDevice = tab?.deviceId ?? deviceContext();
  setScrollback(terminalTabKey(tabDevice, id), "");
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
  const tab = findTab(id);
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
  const target = findTab(id);
  const tabDevice = target?.deviceId ?? deviceContext();
  const key = terminalTabKey(tabDevice, id);
  pendingPtyData.delete(key);
  scrollbackRings.delete(key);
  resyncAgain.delete(key);
  const remaining = terminalTabs().filter(tab => !(tab.id === id && (tab.deviceId ?? "") === tabDevice));
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
  scrollbackRings.clear();
  resyncAgain.clear();
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

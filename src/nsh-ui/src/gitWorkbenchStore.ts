// Git Workbench state and Tauri command orchestration.

import { computed, effect, lifecycle, signal } from "nsh";
import { type GitFileStatus, type GitStatus, type WorkspaceRecord } from "./api";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { subscribeWorkspaceFileChanges } from "./fileStore";
import { gitLiveMode, holdGitStatusLive, renewGitStatusLive, type GitStatusChange } from "./gitStatusLive";
import { isCommandUnavailable } from "./hostCommands";
import { tr } from "./i18n";
import { currentDeviceScopeKey } from "./shared/deviceScope";
import { isRemoteWorkspace } from "./shared/workspaceUtils";
import { activeWorkspace, startQuickPromptInSession } from "./state";
import { pushToast } from "./ui/overlays";

export type GitRepoState = "idle" | "probing" | "trust_required" | "not_a_repository" | "trusted" | "error";
export type GitTab = "working" | "branches" | "history" | "worktrees";

export interface GitTrustReport {
  state: string;
  repositoryPath?: string | null;
  detail?: string | null;
  manualCommand?: string | null;
}

export interface GitBranchRow {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string | null;
  ahead: number;
  behind: number;
  lastCommit?: string | null;
  lastCommitDate?: string | null;
}

export interface GitCommitRow {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parents: string[];
}

export interface GitGraphRefInfo {
  name: string;
  refType: string;
  isCurrent: boolean;
  isHead: boolean;
}

export interface GitGraphNodeInfo {
  hash: string;
  lane: number;
  forkingLanes: number[];
  mergingLanes: number[];
  passingLanes: number[];
  refs: GitGraphRefInfo[];
}

export interface SelectedGitFile {
  path: string;
  staged: boolean;
  kind: "staged" | "unstaged" | "untracked" | "conflict";
}

export interface DiscardTarget {
  path: string;
  kind: "staged" | "unstaged" | "untracked" | "conflict";
}

export interface GitWorktreeRow {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  isLocked: boolean;
  isPrunable: boolean;
}

interface GitOpResult {
  success?: boolean;
  message?: string;
  error?: string;
}

export const gitRepoState = signal<GitRepoState>("idle");
export const gitTrustReport = signal<GitTrustReport | null>(null);
export const gitTab = signal<GitTab>("working");
export const gitBusy = signal(false);
export const gitActionBusy = signal(false);
export const gitError = signal("");
export const gitNotice = signal("");

export const gitStatus = signal<GitStatus | null>(null);
export const workingFileFilter = signal("");
export const selectedGitFile = signal<SelectedGitFile | null>(null);
export const selectedGitDiff = signal("");
export const selectedGitDiffNote = signal("");
export const diffLoading = signal(false);
export const confirmingDiscardFile = signal<DiscardTarget | null>(null);

export const gitCommitMessage = signal("");
export const gitCommitAmend = signal(false);
export const gitAiGenerating = signal(false);

export const gitBranches = signal<GitBranchRow[]>([]);
export const newBranchOpen = signal(false);
export const newBranchName = signal("");
export const newBranchStartPoint = signal("");
export const confirmingDeleteBranch = signal<string | null>(null);

export const gitCommits = signal<GitCommitRow[]>([]);
export const gitGraphByHash = signal<Record<string, GitGraphNodeInfo>>({});
export const gitGraphMaxLane = signal(0);
export const gitGraphNote = signal("");
export const gitGraphRemoteUnsupported = signal(false);

export const HISTORY_PAGE_SIZE = 50;
export const gitHistoryHasMore = signal(false);
export const gitHistoryLoadingMore = signal(false);
export const historyFilter = signal("");
export const branchFilter = signal("");
export const confirmingForceDeleteBranch = signal<string | null>(null);

/** The checkout git refused because local changes would be overwritten. */
export interface BranchSwitchBlocker {
  targetBranch: string;
  /** Set when the switch creates `targetBranch` from a remote-tracking branch. */
  startPoint?: string;
  files: string[];
  kind: "tracked" | "untracked";
}
export const branchSwitchBlocker = signal<BranchSwitchBlocker | null>(null);
export const switchCommitMessage = signal("");

/** Paths checked in the working-copy list for a batch stage / unstage. */
export const checkedGitPaths = signal<string[]>([]);

export interface GitChangedFileRow {
  path: string;
  oldPath: string | null;
  status: string;
}

export const selectedCommit = signal<GitCommitRow | null>(null);
export const commitFiles = signal<GitChangedFileRow[]>([]);
export const commitFilesLoading = signal(false);
export const commitFilesNote = signal("");
export const selectedCommitFile = signal<string | null>(null);
export const commitFileDiff = signal("");
export const commitFileDiffLoading = signal(false);
export const confirmingCommitReset = signal<{ hash: string; mode: "soft" | "mixed" | "hard" } | null>(null);

export const gitWorktrees = signal<GitWorktreeRow[]>([]);
export const gitWorktreeNote = signal("");
export const gitWorktreeRemoteUnsupported = signal(false);
export const addWorktreeModalOpen = signal(false);
export const newWorktreeBranch = signal("");
export const newWorktreeCreateBranch = signal(true);
export const confirmingRemoveWorktree = signal<string | null>(null);

function isRemoteWs(ws: WorkspaceRecord | null): boolean {
  return isRemoteWorkspace(ws);
}

let currentScopeKey = "";
let probeTicket = 0;

function readStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") return val;
  }
  return "";
}

function readNum(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return 0;
}

function normalizeStatus(raw: Record<string, unknown> | null): GitStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const mapFiles = (arr: unknown): GitFileStatus[] =>
    (Array.isArray(arr) ? arr : []).map(item => {
      const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        path: readStr(rec, "path"),
        status: readStr(rec, "status") || "M",
        index_status: (rec.index_status as string | null | undefined) ?? null,
        workdir_status: (rec.workdir_status as string | null | undefined) ?? null,
      };
    }).filter(f => Boolean(f.path));
  const mapPaths = (arr: unknown): string[] =>
    (Array.isArray(arr) ? arr : []).filter((v): v is string => typeof v === "string" && Boolean(v));
  return {
    staged: mapFiles(raw.staged),
    unstaged: mapFiles(raw.unstaged),
    untracked: mapPaths(raw.untracked),
    conflicts: mapPaths(raw.conflicts),
    current_branch: readStr(raw, "current_branch", "currentBranch") || "HEAD",
    ahead: readNum(raw, "ahead"),
    behind: readNum(raw, "behind"),
  };
}

function normalizeBranch(raw: Record<string, unknown>): GitBranchRow {
  return {
    name: readStr(raw, "name"),
    current: raw.current === true,
    remote: raw.remote === true,
    upstream: readStr(raw, "upstream") || null,
    ahead: readNum(raw, "ahead"),
    behind: readNum(raw, "behind"),
    lastCommit: readStr(raw, "lastCommit", "last_commit") || null,
    lastCommitDate: readStr(raw, "lastCommitDate", "last_commit_date") || null,
  };
}

function normalizeCommit(raw: Record<string, unknown>): GitCommitRow {
  const hash = readStr(raw, "hash");
  return {
    hash,
    shortHash: readStr(raw, "shortHash", "short_hash") || hash.slice(0, 7),
    message: readStr(raw, "message"),
    author: readStr(raw, "author", "authorName", "author_name") || "Unknown",
    authorEmail: readStr(raw, "authorEmail", "author_email"),
    date: readStr(raw, "date"),
    parents: Array.isArray(raw.parents)
      ? raw.parents.filter((p): p is string => typeof p === "string")
      : [],
  };
}

function normalizeGraphNode(raw: Record<string, unknown>): GitGraphNodeInfo | null {
  const hash = readStr(raw, "hash");
  if (!hash) return null;
  const toNums = (val: unknown) =>
    Array.isArray(val) ? val.filter((n): n is number => typeof n === "number") : [];
  const refsRaw = Array.isArray(raw.refs) ? raw.refs : [];
  const refs: GitGraphRefInfo[] = refsRaw.map(r => {
    const rec = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return {
      name: readStr(rec, "name"),
      refType: readStr(rec, "refType", "ref_type") || "branch",
      isCurrent: rec.isCurrent === true || rec.is_current === true,
      isHead: rec.isHead === true || rec.is_head === true,
    };
  }).filter(r => Boolean(r.name));
  return {
    hash,
    lane: readNum(raw, "lane"),
    forkingLanes: toNums(raw.forkingLanes ?? raw.forking_lanes),
    mergingLanes: toNums(raw.mergingLanes ?? raw.merging_lanes),
    passingLanes: toNums(raw.passingLanes ?? raw.passing_lanes),
    refs,
  };
}

export function displayRepoFilePath(path: string): string {
  const root = activeWorkspace()?.rootPath ?? "";
  if (!root) return path;
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }
  if (path.startsWith(`${normalizedRoot}\\`)) {
    return path.slice(normalizedRoot.length + 1);
  }
  return path;
}

function normalizeWorktree(raw: Record<string, unknown>): GitWorktreeRow {
  return {
    path: readStr(raw, "path"),
    branch: readStr(raw, "branch") || null,
    head: readStr(raw, "head"),
    isMain: raw.isMain === true || raw.is_main === true,
    isLocked: raw.isLocked === true || raw.is_locked === true,
    isPrunable: raw.isPrunable === true || raw.is_prunable === true,
  };
}

export const totalWorkingChanges = computed(() => {
  const st = gitStatus();
  if (!st) return 0;
  return (
    st.staged.length +
    st.unstaged.length +
    st.untracked.length +
    (st.conflicts?.length ?? 0)
  );
});

function clearGitState(): void {
  gitTrustReport.set(null);
  gitError.set("");
  gitNotice.set("");
  gitStatus.set(null);
  workingFileFilter.set("");
  selectedGitFile.set(null);
  selectedGitDiff.set("");
  selectedGitDiffNote.set("");
  confirmingDiscardFile.set(null);
  gitBranches.set([]);
  newBranchOpen.set(false);
  confirmingDeleteBranch.set(null);
  gitCommits.set([]);
  gitGraphByHash.set({});
  gitGraphMaxLane.set(0);
  gitGraphNote.set("");
  gitGraphRemoteUnsupported.set(false);
  gitWorktrees.set([]);
  gitWorktreeNote.set("");
  gitWorktreeRemoteUnsupported.set(false);
  addWorktreeModalOpen.set(false);
  confirmingRemoveWorktree.set(null);
  gitHistoryHasMore.set(false);
  historyFilter.set("");
  branchFilter.set("");
  confirmingForceDeleteBranch.set(null);
  branchSwitchBlocker.set(null);
  switchCommitMessage.set("");
  checkedGitPaths.set([]);
  clearSelectedCommit();
}

export function workspaceScopeKey(ws: WorkspaceRecord | null): string {
  const deviceKey = currentDeviceScopeKey();
  if (!ws) return `${deviceKey}::none`;
  return `${deviceKey}::${ws.id}::${ws.rootPath}::${ws.workspaceKind ?? "local"}`;
}

export async function syncGitWorkspace(ws: WorkspaceRecord | null): Promise<void> {
  const key = workspaceScopeKey(ws);
  if (key === currentScopeKey && gitRepoState() !== "idle") {
    if (ws) {
      await refreshGitWorkbench();
    }
    return;
  }
  currentScopeKey = key;
  clearGitState();
  if (!ws) {
    gitRepoState.set("idle");
    return;
  }
  await probeAndLoadGit(ws);
}

export async function probeAndLoadGit(ws: WorkspaceRecord | null = activeWorkspace()): Promise<void> {
  if (!ws) {
    gitRepoState.set("idle");
    return;
  }
  const ticket = ++probeTicket;
  gitBusy.set(true);
  gitError.set("");
  if (gitRepoState() === "idle") {
    gitRepoState.set("probing");
  }
  try {
    const isRepo = await invokeCommand<boolean>("git_is_repository", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
    });
    if (ticket !== probeTicket) return;

    if (!isRepo) {
      gitRepoState.set("not_a_repository");
      gitTrustReport.set({
        state: "not_a_repository",
        repositoryPath: ws.rootPath,
      });
      return;
    }

    const trust = await invokeCommand<GitTrustReport>("git_get_repository_trust", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
    });
    if (ticket !== probeTicket) return;

    gitTrustReport.set(trust ?? null);
    const trustState = String(trust?.state ?? "trusted");
    if (trustState === "trust_required") {
      gitRepoState.set("trust_required");
      return;
    }
    if (trustState === "not_a_repository") {
      gitRepoState.set("not_a_repository");
      return;
    }

    gitRepoState.set("trusted");
    // A repository that just became readable (trusted, initialized) is leased now.
    renewGitStatusLive();
    await refreshGitAll(ws, ticket);
  } catch (error) {
    if (ticket !== probeTicket) return;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("git_repository_untrusted")) {
      gitRepoState.set("trust_required");
      gitTrustReport.set({
        state: "trust_required",
        repositoryPath: ws.rootPath,
        detail: message,
      });
    } else {
      gitRepoState.set("error");
      gitError.set(message);
    }
  } finally {
    if (ticket === probeTicket) {
      gitBusy.set(false);
    }
  }
}

export async function trustCurrentRepository(): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const outcome = await invokeCommand<Record<string, unknown>>("git_trust_repository", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
    });
    const nextState = String(outcome?.state ?? "");
    if (nextState === "trusted") {
      gitNotice.set("Repository added to Git safe.directory");
      await probeAndLoadGit(ws);
      return;
    }
    gitTrustReport.set({
      state: nextState || "trust_required",
      repositoryPath: readStr(outcome ?? {}, "repositoryPath") || ws.rootPath,
      detail: readStr(outcome ?? {}, "detail") || "Trust decision could not be applied automatically.",
      manualCommand: readStr(outcome ?? {}, "manualCommand") || null,
    });
    gitRepoState.set("trust_required");
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export async function initializeRepositoryWithAgent(): Promise<void> {
  const ws = activeWorkspace();
  const root = ws?.rootPath ?? "";
  await startQuickPromptInSession(
    `Initialize a Git repository in ${root || "this workspace"}, add a sensible .gitignore, and summarize the initial repository status.`,
    "Standard",
  );
}

async function refreshGitAll(ws: WorkspaceRecord, ticket: number): Promise<void> {
  await Promise.all([
    loadGitStatus(ws, ticket),
    loadGitBranches(ws, ticket),
    loadGitHistory(ws, ticket),
    loadGitWorktrees(ws, ticket),
  ]);
}

export async function refreshGitWorkbench(): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  if (gitRepoState() !== "trusted") {
    await probeAndLoadGit(ws);
    return;
  }
  const ticket = ++probeTicket;
  gitBusy.set(true);
  gitError.set("");
  try {
    await refreshGitAll(ws, ticket);
  } finally {
    if (ticket === probeTicket) gitBusy.set(false);
  }
}

async function loadGitStatus(ws: WorkspaceRecord, ticket: number): Promise<void> {
  try {
    const raw = await invokeCommand<Record<string, unknown> | null>("git_get_status", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
    });
    if (ticket !== probeTicket) return;
    await applyGitStatus(ws, normalizeStatus(raw));
  } catch (error) {
    if (ticket !== probeTicket) return;
    gitError.set(error instanceof Error ? error.message : String(error));
  }
}

async function applyGitStatus(ws: WorkspaceRecord, normalized: GitStatus | null): Promise<void> {
  {
    gitStatus.set(normalized);
    if (!normalized) return;

    const currentSel = selectedGitFile();
    const stillExists =
      currentSel &&
      ((currentSel.kind === "staged" && normalized.staged.some(f => f.path === currentSel.path)) ||
        (currentSel.kind === "unstaged" && normalized.unstaged.some(f => f.path === currentSel.path)) ||
        (currentSel.kind === "untracked" && normalized.untracked.includes(currentSel.path)) ||
        (currentSel.kind === "conflict" && (normalized.conflicts ?? []).includes(currentSel.path)));

    if (stillExists && currentSel) {
      await loadFileDiff(ws, currentSel);
      return;
    }

    const first: SelectedGitFile | null =
      normalized.unstaged[0]
        ? { path: normalized.unstaged[0].path, staged: false, kind: "unstaged" }
        : normalized.staged[0]
          ? { path: normalized.staged[0].path, staged: true, kind: "staged" }
          : normalized.conflicts?.[0]
            ? { path: normalized.conflicts[0], staged: false, kind: "conflict" }
            : normalized.untracked[0]
              ? { path: normalized.untracked[0], staged: false, kind: "untracked" }
              : null;

    selectedGitFile.set(first);
    if (first) {
      await loadFileDiff(ws, first);
    } else {
      selectedGitDiff.set("");
      selectedGitDiffNote.set("");
    }
  }
}

// ── Live refresh ────────────────────────────────────────────────────────────

/**
 * Applies a status read without disturbing the screen: nothing changes unless
 * the repository did. A changed branch or ahead/behind count also re-reads
 * branches and history, since a commit or checkout made elsewhere moved them.
 */
async function applyQuietStatus(ws: WorkspaceRecord, next: GitStatus | null, ticket: number): Promise<void> {
  const previous = gitStatus();
  if (JSON.stringify(next) === JSON.stringify(previous)) return;
  const headMoved =
    !previous ||
    !next ||
    previous.current_branch !== next.current_branch ||
    previous.ahead !== next.ahead ||
    previous.behind !== next.behind ||
    previous.staged.length > next.staged.length;
  await applyGitStatus(ws, next);
  if (headMoved && ticket === probeTicket) {
    void loadGitBranches(ws, ticket);
    void loadGitHistory(ws, ticket);
  }
}

/** One quiet status read (window focus, or a host that does not push status). */
export async function refreshGitStatusQuietly(): Promise<boolean> {
  const ws = activeWorkspace();
  if (!ws || gitRepoState() !== "trusted" || gitActionBusy() || gitBusy()) return true;
  if (workspaceScopeKey(ws) !== currentScopeKey) return true;
  const ticket = probeTicket;
  let raw: Record<string, unknown> | null;
  try {
    raw = await invokeCommand<Record<string, unknown> | null>("git_get_status", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
    });
  } catch {
    return false;
  }
  if (ticket !== probeTicket || workspaceScopeKey(activeWorkspace()) !== currentScopeKey) return true;
  await applyQuietStatus(ws, normalizeStatus(raw), ticket);
  return true;
}

/** A status the host pushed (`git://status-changed`) for the watched repository. */
function applyPushedStatus(change: GitStatusChange): void {
  const ws = activeWorkspace();
  if (!ws || ws.id !== change.workspaceId || gitRepoState() !== "trusted") return;
  if (change.deviceId && change.deviceId !== currentDeviceScopeKey()) return;
  if (workspaceScopeKey(ws) !== currentScopeKey) return;
  // The running action re-reads when it finishes; a pushed status in between
  // would only repaint twice.
  if (gitActionBusy() || gitBusy()) return;
  void applyQuietStatus(ws, normalizeStatus(change.status as unknown as Record<string, unknown> | null), probeTicket);
}

let quietRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleQuietRefresh(delay = 250): void {
  if (quietRefreshTimer !== null) clearTimeout(quietRefreshTimer);
  quietRefreshTimer = setTimeout(() => {
    quietRefreshTimer = null;
    void refreshGitStatusQuietly();
  }, delay);
}

let liveRefreshInstalled = false;

function installLiveRefresh(): void {
  if (liveRefreshInstalled) return;
  liveRefreshInstalled = true;
  // A host that does not push status still re-reads on a disk change the
  // explorer watch reports, and returning from background refreshes once.
  subscribeWorkspaceFileChanges(() => {
    if (gitLiveMode() === "unsupported") scheduleQuietRefresh();
  });
  let lastState = lifecycle();
  effect(() => {
    const nextState = lifecycle();
    if (lastState !== "active" && nextState === "active") {
      scheduleQuietRefresh(0);
    }
    lastState = nextState;
  });
}

/**
 * The Git scene's lease on live status: the host publishes every change
 * (`git://status-changed`), so this surface never polls.
 */
export function holdGitStatusWatch(): () => void {
  installLiveRefresh();
  return holdGitStatusLive(applyPushedStatus);
}

/** Why the status on screen is not live, empty when it is. */
export function gitLiveNotice(): string {
  return gitLiveMode() === "unsupported" ? tr("git.live.hostOutdated") : "";
}

async function loadFileDiff(ws: WorkspaceRecord, target: SelectedGitFile): Promise<void> {
  diffLoading.set(true);
  selectedGitDiffNote.set("");
  try {
    const patch = await invokeCommand<string>("git_get_diff", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: { files: [target.path], staged: target.staged },
    });
    if (selectedGitFile()?.path !== target.path || selectedGitFile()?.staged !== target.staged) {
      return;
    }
    // The host draws an untracked file as all additions; an older host
    // answers empty and the note below says why.
    const text = typeof patch === "string" ? patch : "";
    selectedGitDiff.set(text);
    if (!text.trim()) {
      selectedGitDiffNote.set(
        target.kind === "untracked"
          ? "Untracked file has no diff against HEAD yet. Stage it to inspect its additions."
          : "No line diff reported for this file.",
      );
    }
  } catch (error) {
    if (selectedGitFile()?.path === target.path) {
      selectedGitDiff.set("");
      selectedGitDiffNote.set(error instanceof Error ? error.message : String(error));
    }
  } finally {
    diffLoading.set(false);
  }
}

export async function selectGitFile(target: SelectedGitFile): Promise<void> {
  const ws = activeWorkspace();
  selectedGitFile.set(target);
  if (!ws) return;
  await loadFileDiff(ws, target);
}

export async function stageGitFiles(paths: string[], all = false): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  if (!all && paths.length === 0) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_add_files", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: { files: all ? [] : paths, all },
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || "Failed to stage files");
      return;
    }
    gitNotice.set(all ? "Staged all changes" : `Staged ${displayRepoFilePath(paths[0])}`);
    await loadGitStatus(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export async function unstageGitFiles(paths: string[]): Promise<void> {
  const ws = activeWorkspace();
  if (!ws || paths.length === 0) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_reset_files", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      files: paths,
      staged: true,
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || "Failed to unstage files");
      return;
    }
    gitNotice.set(
      paths.length === 1 ? `Unstaged ${displayRepoFilePath(paths[0])}` : `Unstaged ${paths.length} files`,
    );
    await loadGitStatus(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export function requestDiscardGitFile(target: DiscardTarget): void {
  confirmingDiscardFile.set(target);
}

export function cancelDiscardGitFile(): void {
  confirmingDiscardFile.set(null);
}

export async function confirmDiscardGitFile(): Promise<void> {
  const target = confirmingDiscardFile();
  if (!target) return;
  await discardGitFile(target);
}

export async function discardGitFile(target: DiscardTarget): Promise<void> {
  const ws = activeWorkspace();
  if (!ws || !target.path) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    // The host decides per path: restore to HEAD, drop a staged addition, or
    // delete an untracked file (only with the explicit consent below).
    const res = await invokeCommand<GitOpResult>("git_discard_files", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      files: [target.path],
      includeUntracked: target.kind === "untracked",
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || tr("git.discard.failed"));
      return;
    }
    confirmingDiscardFile.set(null);
    const msg =
      target.kind === "untracked"
        ? tr("git.discard.deletedUntracked", { path: displayRepoFilePath(target.path) })
        : tr("git.discard.discarded", { path: displayRepoFilePath(target.path) });
    gitNotice.set(msg);
    pushToast(msg, "success");
    await loadGitStatus(ws, probeTicket);
  } catch (error) {
    const msg = isCommandUnavailable(error, "git_discard_files")
      ? tr("git.discard.hostOutdated")
      : error instanceof Error
        ? error.message
        : String(error);
    gitError.set(msg);
    pushToast(msg, "error");
  } finally {
    gitActionBusy.set(false);
  }
}

export async function generateAiCommitMessage(): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  if (isRemoteWs(ws)) {
    gitError.set(tr("git.remoteAiCommitUnsupported"));
    return;
  }
  gitAiGenerating.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    let reply: Record<string, unknown>;
    try {
      reply = await invokeCommand<Record<string, unknown>>("quick_commit_message", {
        repoPath: ws.rootPath,
      });
    } catch {
      reply = await invokeCommand<Record<string, unknown>>("generate_commit_message", {
        repoPath: ws.rootPath,
      });
    }
    const full = readStr(reply ?? {}, "fullMessage", "full_message");
    const title = readStr(reply ?? {}, "title");
    const body = readStr(reply ?? {}, "body");
    const msg = readStr(reply ?? {}, "message");
    const composed = full || [title, body].filter(Boolean).join("\n\n") || msg;
    if (!composed.trim()) {
      gitError.set("AI commit generator returned an empty message.");
      return;
    }
    gitCommitMessage.set(composed.trim());
    gitNotice.set("Generated commit message with AI");
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitAiGenerating.set(false);
  }
}

export async function commitStagedChanges(): Promise<void> {
  const ws = activeWorkspace();
  const message = gitCommitMessage().trim();
  if (!ws || !message) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_commit", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: { message, amend: gitCommitAmend() },
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || "Commit failed");
      return;
    }
    gitCommitMessage.set("");
    gitCommitAmend.set(false);
    gitNotice.set("Committed changes");
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export async function pullCurrentBranch(): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_pull", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: { remote: null, branch: null, rebase: false },
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || "Pull failed");
      return;
    }
    gitNotice.set(res?.message || "Pulled latest changes");
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export async function pushCurrentBranch(): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    // A branch without an upstream is published by the host (`push -u` to
    // origin, or the only remote), the way the desktop does.
    const res = await invokeCommand<GitOpResult & { data?: { published?: boolean; remote?: string; branch?: string } }>(
      "git_push",
      {
        workspaceId: ws.id,
        repositoryPath: ws.rootPath,
        params: { remote: null, branch: null, force: false, set_upstream: false },
        publishIfNoUpstream: true,
      },
    );
    if (res && res.success === false) {
      gitError.set(pushFailure(res.error || res.message || tr("git.push.failed")));
      return;
    }
    gitNotice.set(
      res?.data?.published
        ? tr("git.push.published", { branch: res.data.branch ?? "", remote: res.data.remote ?? "" })
        : res?.message || tr("git.push.pushed"),
    );
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(pushFailure(error instanceof Error ? error.message : String(error)));
  } finally {
    gitActionBusy.set(false);
  }
}

/** A host that ignored `publishIfNoUpstream` (older build) fails with git's own "no upstream" text. */
function pushFailure(message: string): string {
  return /no upstream branch|has no upstream/i.test(message) ? tr("git.push.publishHostOutdated") : message;
}

async function loadGitBranches(ws: WorkspaceRecord, ticket: number): Promise<void> {
  try {
    // The plain list carries every field the branch rows show. The enhanced one
    // test-merges each local branch into HEAD, which keeps a core busy for
    // seconds in a repository with many branches, on every open and HEAD move.
    const raw = await invokeCommand<Array<Record<string, unknown>>>("git_get_branches", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      includeRemote: true,
    });
    if (ticket !== probeTicket) return;
    gitBranches.set(
      (Array.isArray(raw) ? raw : [])
        .map(item => normalizeBranch(item ?? {}))
        .filter(b => Boolean(b.name)),
    );
  } catch (error) {
    if (ticket !== probeTicket) return;
    gitError.set(error instanceof Error ? error.message : String(error));
  }
}

export async function checkoutGitBranch(branchName: string): Promise<void> {
  const ws = activeWorkspace();
  if (!ws || !branchName) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  branchSwitchBlocker.set(null);
  try {
    // A remote-tracking branch checks out as a local branch that tracks it.
    const remote = gitBranches().find(branch => branch.name === branchName && branch.remote);
    const localName = remote ? localNameForRemoteBranch(branchName) : branchName;
    const hasLocal = gitBranches().some(branch => !branch.remote && branch.name === localName);
    let res: GitOpResult | null;
    let failure = "";
    try {
      res =
        remote && !hasLocal
          ? await invokeCommand<GitOpResult>("git_create_branch", {
              workspaceId: ws.id,
              repositoryPath: ws.rootPath,
              branchName: localName,
              startPoint: branchName,
            })
          : await invokeCommand<GitOpResult>("git_checkout_branch", {
              workspaceId: ws.id,
              repositoryPath: ws.rootPath,
              branchName: localName,
            });
    } catch (error) {
      res = null;
      failure = error instanceof Error ? error.message : String(error);
    }
    if (res && res.success === false) failure = res.error || res.message || `Failed to checkout ${localName}`;
    if (failure) {
      const overwrite = parseCheckoutOverwriteFailure(failure);
      if (overwrite) {
        const files = overwrite.files.length > 0 ? overwrite.files : changedPathsOf(gitStatus());
        branchSwitchBlocker.set({
          targetBranch: localName,
          ...(remote && !hasLocal ? { startPoint: branchName } : {}),
          files,
          kind: overwrite.kind,
        });
        return;
      }
      gitError.set(
        failure.toLowerCase().includes("resolve your current index first")
          ? "Resolve the merge conflicts in the working copy before switching branches."
          : failure,
      );
      return;
    }
    gitNotice.set(`Checked out ${localName}`);
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export function openCreateBranchModal(): void {
  newBranchName.set("");
  newBranchStartPoint.set("");
  gitError.set("");
  newBranchOpen.set(true);
}

export function closeCreateBranchModal(): void {
  newBranchOpen.set(false);
}

export async function createGitBranch(): Promise<void> {
  const ws = activeWorkspace();
  const branchName = newBranchName().trim();
  if (!ws || !branchName) return;
  const startPoint = newBranchStartPoint().trim() || null;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_create_branch", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      branchName,
      startPoint,
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || `Failed to create ${branchName}`);
      return;
    }
    newBranchName.set("");
    newBranchStartPoint.set("");
    newBranchOpen.set(false);
    gitNotice.set(`Created and checked out ${branchName}`);
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export async function deleteGitBranch(branchName: string, force = false): Promise<void> {
  const ws = activeWorkspace();
  if (!ws || !branchName) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_delete_branch", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      branchName,
      force,
    });
    if (res && res.success === false) {
      const message = res.error || res.message || `Failed to delete ${branchName}`;
      // git refuses `-d` for a branch whose commits are not merged anywhere:
      // ask again for a force delete instead of leaving a raw error.
      if (!force && /not fully merged/i.test(message)) {
        confirmingDeleteBranch.set(null);
        confirmingForceDeleteBranch.set(branchName);
        return;
      }
      gitError.set(message);
      return;
    }
    confirmingDeleteBranch.set(null);
    confirmingForceDeleteBranch.set(null);
    gitNotice.set(`Deleted branch ${branchName}`);
    await loadGitBranches(ws, probeTicket);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!force && /not fully merged/i.test(message)) {
      confirmingDeleteBranch.set(null);
      confirmingForceDeleteBranch.set(branchName);
    } else {
      gitError.set(message);
    }
  } finally {
    gitActionBusy.set(false);
  }
}

async function loadGitHistory(ws: WorkspaceRecord, ticket: number, append = false): Promise<void> {
  const skip = append ? gitCommits().length : 0;
  // A refresh keeps as many commits as were already on screen.
  const count = append ? HISTORY_PAGE_SIZE : Math.max(HISTORY_PAGE_SIZE, gitCommits().length);
  try {
    const commitsRaw = await invokeCommand<Array<Record<string, unknown>>>("git_get_commits", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: skip > 0 ? { max_count: count, skip } : { max_count: count },
    });
    if (ticket !== probeTicket) return;
    const page = (Array.isArray(commitsRaw) ? commitsRaw : []).map(item => normalizeCommit(item ?? {}));
    gitHistoryHasMore.set(page.length >= count);
    if (append) {
      const known = new Set(gitCommits().map(commit => commit.hash));
      gitCommits.set([...gitCommits(), ...page.filter(commit => !known.has(commit.hash))]);
    } else {
      gitCommits.set(page);
    }
    const selected = selectedCommit();
    if (selected && !gitCommits().some(commit => commit.hash === selected.hash)) clearSelectedCommit();
  } catch (error) {
    if (ticket !== probeTicket) return;
    gitError.set(error instanceof Error ? error.message : String(error));
  }

  // Never call git_get_graph on remote workspaces (unsupported by backend SSH runner).
  if (isRemoteWs(ws)) {
    gitGraphByHash.set({});
    gitGraphMaxLane.set(0);
    gitGraphRemoteUnsupported.set(true);
    gitGraphNote.set("");
    return;
  }

  gitGraphRemoteUnsupported.set(false);
  gitGraphNote.set("");
  try {
    const graphRaw = await invokeRawCommand<{
      nodes?: Array<Record<string, unknown>>;
      maxLane?: number;
      max_lane?: number;
    }>("git_get_graph", {
      repositoryPath: ws.rootPath,
      workspaceId: ws.id,
      maxCount: Math.max(HISTORY_PAGE_SIZE, gitCommits().length),
      branchName: null,
    });
    if (ticket !== probeTicket) return;
    const map: Record<string, GitGraphNodeInfo> = {};
    for (const rawNode of Array.isArray(graphRaw?.nodes) ? graphRaw.nodes : []) {
      const node = normalizeGraphNode(rawNode ?? {});
      if (node) map[node.hash] = node;
    }
    gitGraphByHash.set(map);
    gitGraphMaxLane.set(Number(graphRaw?.maxLane ?? graphRaw?.max_lane ?? 0) || 0);
  } catch (error) {
    if (ticket !== probeTicket) return;
    gitGraphByHash.set({});
    gitGraphMaxLane.set(0);
    const msg = error instanceof Error ? error.message : String(error);
    gitGraphNote.set(`Commit lane graph unavailable on this host (${msg}).`);
  }
}

export async function loadGitWorktrees(ws: WorkspaceRecord, ticket: number): Promise<void> {
  if (isRemoteWs(ws)) {
    gitWorktrees.set([]);
    gitWorktreeRemoteUnsupported.set(true);
    gitWorktreeNote.set("");
    return;
  }

  gitWorktreeRemoteUnsupported.set(false);
  gitWorktreeNote.set("");
  try {
    const raw = await invokeCommand<Array<Record<string, unknown>>>("git_list_worktrees", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
    });
    if (ticket !== probeTicket) return;
    gitWorktrees.set(
      (Array.isArray(raw) ? raw : [])
        .map(item => normalizeWorktree(item ?? {}))
        .filter(item => Boolean(item.path)),
    );
  } catch (error) {
    if (ticket !== probeTicket) return;
    gitWorktrees.set([]);
    const msg = error instanceof Error ? error.message : String(error);
    gitWorktreeNote.set(`Worktrees unavailable on this host (${msg}).`);
  }
}

export function openAddWorktreeModal(): void {
  newWorktreeBranch.set("");
  newWorktreeCreateBranch.set(true);
  gitError.set("");
  addWorktreeModalOpen.set(true);
}

export function closeAddWorktreeModal(): void {
  addWorktreeModalOpen.set(false);
}

export async function addGitWorktree(): Promise<void> {
  const ws = activeWorkspace();
  const branch = newWorktreeBranch().trim();
  if (!ws || !branch) return;
  if (isRemoteWs(ws)) {
    gitWorktreeRemoteUnsupported.set(true);
    gitError.set(tr("git.remoteWorktreeUnsupported"));
    return;
  }
  const createBranch = newWorktreeCreateBranch();
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    await invokeCommand<Record<string, unknown>>("git_add_worktree", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      branch,
      createBranch,
    });
    newWorktreeBranch.set("");
    addWorktreeModalOpen.set(false);
    const msg = `Created worktree for branch ${branch}`;
    gitNotice.set(msg);
    pushToast(msg, "success");
    await Promise.all([
      loadGitWorktrees(ws, probeTicket),
      loadGitBranches(ws, probeTicket),
    ]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    gitError.set(msg);
    pushToast(msg, "error");
  } finally {
    gitActionBusy.set(false);
  }
}

export function requestRemoveWorktree(worktreePath: string): void {
  confirmingRemoveWorktree.set(worktreePath);
}

export function cancelRemoveWorktree(): void {
  confirmingRemoveWorktree.set(null);
}

export async function removeGitWorktree(worktreePath: string, force = false): Promise<void> {
  const ws = activeWorkspace();
  if (!ws || !worktreePath) return;
  if (isRemoteWs(ws)) {
    gitWorktreeRemoteUnsupported.set(true);
    gitError.set(tr("git.remoteWorktreeUnsupported"));
    return;
  }
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_remove_worktree", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      worktreePath,
      force,
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || `Failed to remove worktree ${worktreePath}`);
      return;
    }
    confirmingRemoveWorktree.set(null);
    const msg = `Removed worktree ${worktreePath}`;
    gitNotice.set(msg);
    pushToast(msg, "success");
    await Promise.all([
      loadGitWorktrees(ws, probeTicket),
      loadGitBranches(ws, probeTicket),
    ]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    gitError.set(msg);
    pushToast(msg, "error");
  } finally {
    gitActionBusy.set(false);
  }
}

// ── Branch switching, upstream, history paging and commit inspection ──────────

const CHECKOUT_OVERWRITE_HEADERS: Array<{ kind: "tracked" | "untracked"; text: string }> = [
  { kind: "tracked", text: "your local changes to the following files would be overwritten by checkout:" },
  {
    kind: "untracked",
    text: "the following untracked working tree files would be overwritten by checkout:",
  },
];

/**
 * Reads git's (C-locale) checkout diagnostic: which files block the switch. The
 * same text comes back from a local and a remote repository. Ported from the
 * desktop's `branchSwitchFailure.ts`.
 */
export function parseCheckoutOverwriteFailure(
  error: string | null | undefined,
): { kind: "tracked" | "untracked"; files: string[] } | null {
  if (!error?.trim()) return null;
  const lines = error.replace(/\r\n/g, "\n").split("\n");
  const headerIndex = lines.findIndex(line =>
    CHECKOUT_OVERWRITE_HEADERS.some(header => line.toLowerCase().includes(header.text)),
  );
  if (headerIndex < 0) return null;
  const header = CHECKOUT_OVERWRITE_HEADERS.find(candidate =>
    lines[headerIndex].toLowerCase().includes(candidate.text),
  );
  if (!header) return null;
  const files: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:please\s|aborting\.?$|error:|fatal:)/i.test(trimmed)) break;
    files.push(trimmed);
  }
  return { kind: header.kind, files: [...new Set(files)] };
}

function changedPathsOf(status: GitStatus | null): string[] {
  if (!status) return [];
  return [
    ...new Set([
      ...status.staged.map(file => file.path),
      ...status.unstaged.map(file => file.path),
      ...status.untracked,
      ...(status.conflicts ?? []),
    ]),
  ];
}

/** `origin/feat/x` checks out as `feat/x`. */
export function localNameForRemoteBranch(name: string): string {
  const slash = name.indexOf("/");
  return slash > 0 ? name.slice(slash + 1) : name;
}

export function dismissBranchSwitchBlocker(): void {
  branchSwitchBlocker.set(null);
  switchCommitMessage.set("");
}

/**
 * Commit & switch: the host stages the files that block the checkout, commits
 * them and retries the switch as one operation (refusing first while conflicts
 * are unresolved) — the desktop's way out of the overwrite failure, without a
 * stash.
 */
export async function commitAndSwitchBranch(): Promise<void> {
  const ws = activeWorkspace();
  const blocker = branchSwitchBlocker();
  const message = switchCommitMessage().trim();
  if (!ws || !blocker || !message) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<
      GitOpResult & { data?: { committed?: boolean; blockingFiles?: string[]; blockingKind?: string | null } }
    >("git_commit_and_checkout", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      message,
      files: blocker.files,
      targetBranch: blocker.targetBranch,
      ...(blocker.startPoint ? { startPoint: blocker.startPoint } : {}),
    });
    switchCommitMessage.set("");
    if (res && res.success === false) {
      const files = res.data?.blockingFiles ?? [];
      if (res.data?.committed && files.length > 0) {
        // Committed, but something else still blocks the switch.
        branchSwitchBlocker.set({
          ...blocker,
          files,
          kind: res.data.blockingKind === "untracked" ? "untracked" : "tracked",
        });
      } else {
        branchSwitchBlocker.set(null);
      }
      gitError.set(res.error || res.message || tr("git.switch.failed"));
    } else {
      branchSwitchBlocker.set(null);
      gitNotice.set(tr("git.switch.committedAndSwitched", { branch: blocker.targetBranch }));
    }
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(
      isCommandUnavailable(error, "git_commit_and_checkout")
        ? tr("git.switch.hostOutdated")
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    gitActionBusy.set(false);
  }
}

export function cancelForceDeleteBranch(): void {
  confirmingForceDeleteBranch.set(null);
}

/** Amend starts from the commit being amended, the way `git commit --amend` does. */
export function setCommitAmend(next: boolean): void {
  gitCommitAmend.set(next);
  if (next && !gitCommitMessage().trim()) {
    const last = gitCommits()[0];
    if (last?.message) gitCommitMessage.set(last.message.trim());
  }
}

export function toggleCheckedGitPath(path: string): void {
  checkedGitPaths.update(current =>
    current.includes(path) ? current.filter(item => item !== path) : [...current, path],
  );
}

export function setCheckedGitPaths(paths: string[]): void {
  checkedGitPaths.set([...new Set(paths)]);
}

export async function stageCheckedGitPaths(): Promise<void> {
  const status = gitStatus();
  const staged = new Set(status?.staged.map(file => file.path) ?? []);
  const paths = checkedGitPaths().filter(path => !staged.has(path));
  if (paths.length === 0) return;
  await stageGitFiles(paths);
  checkedGitPaths.update(current => current.filter(path => !paths.includes(path)));
}

export async function unstageCheckedGitPaths(): Promise<void> {
  const staged = new Set(gitStatus()?.staged.map(file => file.path) ?? []);
  const paths = checkedGitPaths().filter(path => staged.has(path));
  if (paths.length === 0) return;
  await unstageGitFiles(paths);
  checkedGitPaths.update(current => current.filter(path => !paths.includes(path)));
}

export async function loadMoreGitHistory(): Promise<void> {
  const ws = activeWorkspace();
  if (!ws || gitHistoryLoadingMore() || !gitHistoryHasMore()) return;
  gitHistoryLoadingMore.set(true);
  try {
    await loadGitHistory(ws, probeTicket, true);
  } finally {
    gitHistoryLoadingMore.set(false);
  }
}

/** The empty tree: what a root commit is compared against. */
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function commitRange(commit: GitCommitRow): { source: string; target: string } {
  return {
    source: commit.parents[0] ?? (commit.parents.length === 0 ? EMPTY_TREE_HASH : `${commit.hash}^`),
    target: commit.hash,
  };
}

export function clearSelectedCommit(): void {
  selectedCommit.set(null);
  commitFiles.set([]);
  commitFilesNote.set("");
  selectedCommitFile.set(null);
  commitFileDiff.set("");
  confirmingCommitReset.set(null);
}

/** Opens one commit: its files (`git_get_changed_files` against its first parent). */
export async function selectCommit(commit: GitCommitRow): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  if (selectedCommit()?.hash === commit.hash) return;
  clearSelectedCommit();
  selectedCommit.set(commit);
  commitFilesLoading.set(true);
  try {
    const raw = await invokeCommand<Array<Record<string, unknown>>>("git_get_changed_files", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: commitRange(commit),
    });
    if (selectedCommit()?.hash !== commit.hash) return;
    const rows = (Array.isArray(raw) ? raw : [])
      .map(item => {
        const rec = (item ?? {}) as Record<string, unknown>;
        return {
          path: readStr(rec, "path"),
          oldPath: readStr(rec, "old_path", "oldPath") || null,
          status: readStr(rec, "status") || "modified",
        };
      })
      .filter(row => Boolean(row.path));
    commitFiles.set(rows);
    if (rows[0]) void selectCommitFile(rows[0].path);
  } catch (error) {
    if (selectedCommit()?.hash !== commit.hash) return;
    commitFilesNote.set(error instanceof Error ? error.message : String(error));
  } finally {
    if (selectedCommit()?.hash === commit.hash) commitFilesLoading.set(false);
  }
}

export async function selectCommitFile(path: string): Promise<void> {
  const ws = activeWorkspace();
  const commit = selectedCommit();
  if (!ws || !commit) return;
  selectedCommitFile.set(path);
  commitFileDiffLoading.set(true);
  try {
    const patch = await invokeCommand<string>("git_get_diff", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: { ...commitRange(commit), files: [path] },
    });
    if (selectedCommitFile() !== path || selectedCommit()?.hash !== commit.hash) return;
    commitFileDiff.set(typeof patch === "string" ? patch : "");
  } catch (error) {
    if (selectedCommitFile() !== path) return;
    commitFileDiff.set("");
    commitFilesNote.set(error instanceof Error ? error.message : String(error));
  } finally {
    if (selectedCommitFile() === path) commitFileDiffLoading.set(false);
  }
}

export async function cherryPickCommit(commit: GitCommitRow): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_cherry_pick", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      commitHash: commit.hash,
      noCommit: false,
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || `Failed to cherry-pick ${commit.shortHash}`);
      return;
    }
    const msg = `Cherry-picked ${commit.shortHash}`;
    gitNotice.set(msg);
    pushToast(msg, "success");
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

export function requestCommitReset(hash: string, mode: "soft" | "mixed" | "hard"): void {
  confirmingCommitReset.set({ hash, mode });
}

export function cancelCommitReset(): void {
  confirmingCommitReset.set(null);
}

export async function confirmCommitReset(): Promise<void> {
  const ws = activeWorkspace();
  const pending = confirmingCommitReset();
  if (!ws || !pending) return;
  gitActionBusy.set(true);
  gitError.set("");
  gitNotice.set("");
  try {
    const res = await invokeCommand<GitOpResult>("git_reset_to_commit", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      commitHash: pending.hash,
      mode: pending.mode,
    });
    confirmingCommitReset.set(null);
    if (res && res.success === false) {
      gitError.set(res.error || res.message || "Reset failed");
      return;
    }
    const msg = `Reset (${pending.mode}) to ${pending.hash.slice(0, 7)}`;
    gitNotice.set(msg);
    pushToast(msg, "success");
    clearSelectedCommit();
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}


// Git Workbench state and Tauri command orchestration.

import { computed, signal } from "nsh";
import { deleteWorkspaceFile, type GitFileStatus, type GitStatus, type WorkspaceRecord } from "./api";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { peerScope } from "./peerState";
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

export const gitWorktrees = signal<GitWorktreeRow[]>([]);
export const gitWorktreeNote = signal("");
export const addWorktreeModalOpen = signal(false);
export const newWorktreeBranch = signal("");
export const newWorktreeCreateBranch = signal(true);
export const confirmingRemoveWorktree = signal<string | null>(null);

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

function resolveRepoFilePath(rootPath: string, filePath: string): string {
  if (filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return filePath;
  }
  const cleanRoot = rootPath.replace(/[\\/]+$/, "");
  const cleanRel = filePath.replace(/^[\\/]+/, "");
  return cleanRoot ? `${cleanRoot}/${cleanRel}` : cleanRel;
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
  gitWorktrees.set([]);
  gitWorktreeNote.set("");
  addWorktreeModalOpen.set(false);
  confirmingRemoveWorktree.set(null);
}

export function workspaceScopeKey(ws: WorkspaceRecord | null): string {
  if (!ws) return `${peerScope()?.deviceId ?? "local"}::none`;
  return `${peerScope()?.deviceId ?? "local"}::${ws.id}::${ws.rootPath}::${ws.workspaceKind ?? "local"}`;
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
    const normalized = normalizeStatus(raw);
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
  } catch (error) {
    if (ticket !== probeTicket) return;
    gitError.set(error instanceof Error ? error.message : String(error));
  }
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
    if (target.kind === "untracked") {
      const fullPath = resolveRepoFilePath(ws.rootPath, target.path);
      await deleteWorkspaceFile(ws.id, fullPath);
      confirmingDiscardFile.set(null);
      const msg = `Deleted untracked file ${displayRepoFilePath(target.path)}`;
      gitNotice.set(msg);
      pushToast(msg, "success");
      await loadGitStatus(ws, probeTicket);
      return;
    }

    if (target.kind === "staged") {
      const unstageRes = await invokeCommand<GitOpResult>("git_reset_files", {
        workspaceId: ws.id,
        repositoryPath: ws.rootPath,
        files: [target.path],
        staged: true,
      });
      if (unstageRes && unstageRes.success === false) {
        gitError.set(unstageRes.error || unstageRes.message || "Failed to unstage file before discarding");
        return;
      }
    }

    const res = await invokeCommand<GitOpResult>("git_reset_files", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      files: [target.path],
      staged: false,
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || "Failed to discard changes");
      return;
    }
    confirmingDiscardFile.set(null);
    const msg = `Discarded changes in ${displayRepoFilePath(target.path)}`;
    gitNotice.set(msg);
    pushToast(msg, "success");
    await loadGitStatus(ws, probeTicket);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    gitError.set(msg);
    pushToast(msg, "error");
  } finally {
    gitActionBusy.set(false);
  }
}

export async function generateAiCommitMessage(): Promise<void> {
  const ws = activeWorkspace();
  if (!ws) return;
  if (ws.workspaceKind === "remote" || Boolean(ws.connectionId)) {
    gitError.set(
      "AI commit message generation requires a local repository path and is not yet supported on remote workspaces.",
    );
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
    const res = await invokeCommand<GitOpResult>("git_push", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: { remote: null, branch: null, force: false, set_upstream: false },
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || "Push failed");
      return;
    }
    gitNotice.set(res?.message || "Pushed branch to remote");
    await refreshGitAll(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

async function loadGitBranches(ws: WorkspaceRecord, ticket: number): Promise<void> {
  try {
    let raw: Array<Record<string, unknown>>;
    try {
      raw = await invokeCommand<Array<Record<string, unknown>>>("git_get_enhanced_branches", {
        workspaceId: ws.id,
        repositoryPath: ws.rootPath,
        includeRemote: true,
      });
    } catch {
      raw = await invokeCommand<Array<Record<string, unknown>>>("git_get_branches", {
        workspaceId: ws.id,
        repositoryPath: ws.rootPath,
        includeRemote: true,
      });
    }
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
  try {
    const res = await invokeCommand<GitOpResult>("git_checkout_branch", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      branchName,
    });
    if (res && res.success === false) {
      gitError.set(res.error || res.message || `Failed to checkout ${branchName}`);
      return;
    }
    gitNotice.set(`Checked out ${branchName}`);
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
      gitError.set(res.error || res.message || `Failed to delete ${branchName}`);
      return;
    }
    confirmingDeleteBranch.set(null);
    gitNotice.set(`Deleted branch ${branchName}`);
    await loadGitBranches(ws, probeTicket);
  } catch (error) {
    gitError.set(error instanceof Error ? error.message : String(error));
  } finally {
    gitActionBusy.set(false);
  }
}

async function loadGitHistory(ws: WorkspaceRecord, ticket: number): Promise<void> {
  try {
    const commitsRaw = await invokeCommand<Array<Record<string, unknown>>>("git_get_commits", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      params: { max_count: 40 },
    });
    if (ticket !== probeTicket) return;
    gitCommits.set(
      (Array.isArray(commitsRaw) ? commitsRaw : []).map(item => normalizeCommit(item ?? {})),
    );
  } catch (error) {
    if (ticket !== probeTicket) return;
    gitError.set(error instanceof Error ? error.message : String(error));
  }

  // Never call git_get_graph on remote workspaces (unsupported by backend SSH runner).
  if (ws.workspaceKind === "remote") {
    gitGraphByHash.set({});
    gitGraphMaxLane.set(0);
    gitGraphNote.set(
      "Commit lane graphs are available on local workspaces only. Showing linear commit history for this remote workspace.",
    );
    return;
  }

  gitGraphNote.set("");
  try {
    const graphRaw = await invokeRawCommand<{
      nodes?: Array<Record<string, unknown>>;
      maxLane?: number;
      max_lane?: number;
    }>("git_get_graph", {
      repositoryPath: ws.rootPath,
      workspaceId: ws.id,
      maxCount: 40,
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
  if (ws.workspaceKind === "remote") {
    gitWorktrees.set([]);
    gitWorktreeNote.set(
      "Git worktrees are supported on local workspaces only. Remote SSH worktrees are not available yet.",
    );
    return;
  }

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
  if (ws.workspaceKind === "remote") {
    gitError.set("Git worktrees are not supported for remote SSH workspaces.");
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
  if (ws.workspaceKind === "remote") {
    gitError.set("Git worktrees are not supported for remote SSH workspaces.");
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

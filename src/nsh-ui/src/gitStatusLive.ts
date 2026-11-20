// Live Git status, pushed by the backend.
//
// The backend owns Git liveness: `git_watch_status` leases a repository and
// returns its status with a revision, and the backend then publishes
// `git://status-changed` whenever that status actually changed (filesystem and
// `.git` metadata events for a local repository, one backend poll for an SSH
// workspace, and right after every mutating Git command). Every view that shows
// Git state (the Git workbench, the Files tree decorations) holds a lease here
// and re-renders from the pushed status; nothing in this surface polls.
//
// A host without `git_watch_status` (older desktop, CLI peer) gets an explicit
// `unsupported` mode: the views say the status is not live there and offer
// Refresh; they never fall back to a timer.

import { signal } from "nsh";
import type { GitStatus, WorkspaceRecord } from "./api";
import { invokeCommand, listenEvent } from "./bridge";
import { isCommandUnavailable } from "./hostCommands";
import { activeWorkspace, onWorkspaceChanged } from "./state";

export const GIT_STATUS_CHANGED_EVENT = "git://status-changed";

export interface GitStatusChange {
  workspaceId: string;
  repositoryPath: string;
  revision: number;
  status: GitStatus | null;
  /** `watch`, `poll`, `operation` or `snapshot` (the lease's first answer). */
  cause: string;
}

interface WatchSnapshot {
  workspaceId?: string;
  repositoryPath?: string;
  revision?: number;
  status?: GitStatus | null;
  error?: string;
  mode?: string;
}

/** `idle` (nothing watched), `live` (the host pushes changes) or `unsupported` (older host). */
export type GitLiveMode = "idle" | "live" | "unsupported";
export const gitLiveMode = signal<GitLiveMode>("idle");

/** One lease id per page: watching twice from this surface is one lease on the host. */
const WATCHER_ID = `nsh-git-${Math.random().toString(36).slice(2, 10)}`;

type Listener = (change: GitStatusChange) => void;
const listeners = new Set<Listener>();
let watched: { workspaceId: string; repositoryPath: string } | null = null;
let lastRevision = -1;
let installed = false;
let leaseTicket = 0;

function deliver(change: GitStatusChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      // One view's failure must not starve the others.
    }
  }
}

function matchesWatched(workspaceId: unknown, repositoryPath: unknown): boolean {
  if (!watched) return false;
  if (typeof workspaceId === "string" && workspaceId === watched.workspaceId) return true;
  return typeof repositoryPath === "string" && repositoryPath === watched.repositoryPath;
}

function install(): void {
  if (installed) return;
  installed = true;
  listenEvent<Record<string, unknown>>(GIT_STATUS_CHANGED_EVENT, payload => {
    if (!payload || typeof payload !== "object") return;
    if (!matchesWatched(payload.workspaceId, payload.repositoryPath)) return;
    const revision = typeof payload.revision === "number" ? payload.revision : 0;
    // Revisions only grow; an older or repeated one was already rendered.
    if (revision <= lastRevision) return;
    lastRevision = revision;
    deliver({
      workspaceId: String(payload.workspaceId ?? watched?.workspaceId ?? ""),
      repositoryPath: String(payload.repositoryPath ?? watched?.repositoryPath ?? ""),
      revision,
      status: (payload.status as GitStatus | null | undefined) ?? null,
      cause: typeof payload.cause === "string" ? payload.cause : "watch",
    });
  });
  // Events were lost (slow client) or the backend restarted (its revisions
  // start over): take the lease again, which answers the status now.
  listenEvent<unknown>("backend://events-dropped", () => {
    if (listeners.size === 0) return;
    watched = null;
    lastRevision = -1;
    void watchWorkspace(activeWorkspace());
  });
  // A different workspace (or peer) is a different repository.
  onWorkspaceChanged(() => {
    if (listeners.size > 0) void watchWorkspace(activeWorkspace());
  });
}

async function unwatchCurrent(): Promise<void> {
  const previous = watched;
  watched = null;
  lastRevision = -1;
  if (!previous || gitLiveMode() !== "live") return;
  try {
    await invokeCommand<boolean>("git_unwatch_status", { ...previous, watcherId: WATCHER_ID });
  } catch {
    // The host may be gone; its lease ends with it.
  }
}

async function watchWorkspace(ws: WorkspaceRecord | null): Promise<void> {
  const ticket = ++leaseTicket;
  if (watched && ws && watched.workspaceId === ws.id && watched.repositoryPath === ws.rootPath) return;
  await unwatchCurrent();
  if (!ws || ticket !== leaseTicket) {
    if (!ws) gitLiveMode.set("idle");
    return;
  }
  watched = { workspaceId: ws.id, repositoryPath: ws.rootPath };
  let snapshot: WatchSnapshot | null;
  try {
    snapshot = await invokeCommand<WatchSnapshot>("git_watch_status", {
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      watcherId: WATCHER_ID,
    });
  } catch (error) {
    if (ticket !== leaseTicket) return;
    if (isCommandUnavailable(error, "git_watch_status")) {
      gitLiveMode.set("unsupported");
    } else {
      // Not a repository or not trusted yet: the views show that state; the
      // lease is retried when they reload.
      watched = null;
      gitLiveMode.set("idle");
    }
    return;
  }
  if (ticket !== leaseTicket) return;
  gitLiveMode.set("live");
  const revision = typeof snapshot?.revision === "number" ? snapshot.revision : 0;
  if (snapshot?.status && revision > lastRevision) {
    lastRevision = revision;
    deliver({
      workspaceId: ws.id,
      repositoryPath: ws.rootPath,
      revision,
      status: snapshot.status,
      cause: "snapshot",
    });
  } else {
    lastRevision = Math.max(lastRevision, revision);
  }
}

/**
 * A view's lease on live Git status for the active workspace. `listener` gets
 * every status the host publishes; the returned function ends the lease (the
 * last one releases the host's watch).
 */
export function holdGitStatusLive(listener: Listener): () => void {
  install();
  listeners.add(listener);
  if (listeners.size === 1 || !watched) void watchWorkspace(activeWorkspace());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    if (listeners.size === 0) {
      leaseTicket += 1;
      void unwatchCurrent().then(() => {
        if (listeners.size === 0) gitLiveMode.set("idle");
      });
    }
  };
}

/** Re-takes the lease (after a repository was trusted or initialized). */
export function renewGitStatusLive(): void {
  if (listeners.size === 0) return;
  if (gitLiveMode() === "live" && watched) return;
  watched = null;
  void watchWorkspace(activeWorkspace());
}

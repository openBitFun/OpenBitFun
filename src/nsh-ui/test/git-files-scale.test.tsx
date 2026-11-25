// Git status and the file tree at scale: status reads compare by the backend's
// fingerprint (by content against a host that predates it), a burst of disk
// changes refreshes the tree in one cache write, and a working copy of
// hundreds of files is virtualized while checking and selecting all stay exact.

import { effect } from "nsh";
import { expect, open, test } from "nsh/test";
import { sameGitStatus, type GitStatus, type WorkspaceEntry } from "../src/api";
import type { BackendConnection, BackendEvent } from "../src/backendConnection";
import { installBackendConnection } from "../src/bridge";
import { dirChildren, ensureWorkspaceWatch, gitStatus, loadDirectory, loadGitStatus } from "../src/fileStore";
import { activeWorkspaceKey, workspaces } from "../src/state";
import { createBackend, openToolScene } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

function status(extra: Partial<GitStatus> = {}): GitStatus {
  return {
    staged: [],
    unstaged: [{ path: "/repo/a.rs", status: "M", index_status: null, workdir_status: "M" }],
    untracked: [],
    conflicts: [],
    current_branch: "main",
    ahead: 0,
    behind: 0,
    ...extra,
  };
}

test("status reads compare by fingerprint, and by content when the host sends none", () => {
  // Both fingerprinted: the fingerprint decides, the content is not walked.
  expect(sameGitStatus(status({ fingerprint: "aa" }), status({ fingerprint: "aa" }))).toBe(true);
  expect(sameGitStatus(status({ fingerprint: "aa" }), status({ fingerprint: "bb" }))).toBe(false);
  // An older host sends no fingerprint: equal content is equal, any change is not.
  expect(sameGitStatus(status(), status())).toBe(true);
  expect(sameGitStatus(status(), status({ current_branch: "dev" }))).toBe(false);
  expect(sameGitStatus(status(), status({ untracked: ["/repo/new.txt"] }))).toBe(false);
  // One side without a fingerprint (the host was updated mid-session): by content.
  expect(sameGitStatus(status({ fingerprint: "aa" }), status())).toBe(false);
  expect(sameGitStatus(null, null)).toBe(true);
  expect(sameGitStatus(status(), null)).toBe(false);
});

interface ScriptedHost extends BackendConnection {
  requests: Array<{ command: string; request: Record<string, unknown> }>;
  push(batch: BackendEvent[]): void;
}

function scriptedHost(answer: (command: string, request: Record<string, unknown>) => unknown): ScriptedHost {
  const requests: ScriptedHost["requests"] = [];
  const subscribers = new Set<(events: readonly BackendEvent[]) => void>();
  return {
    kind: "websocket",
    requests,
    async invoke(command, args) {
      const request = ((args ?? {}) as { request?: Record<string, unknown> }).request ?? {};
      requests.push({ command, request });
      return answer(command, request);
    },
    subscribe(onEvents) {
      subscribers.add(onEvents);
      return () => subscribers.delete(onEvents);
    },
    ready: async () => ({ version: "9.9.9", platform: "linux", dataDir: null }),
    state: () => "connected",
    error: () => "",
    lastSeq: () => null,
    fleet: () => null,
    push(batch) {
      for (const subscriber of [...subscribers]) subscriber(batch);
    },
  };
}

test("a burst of disk changes refreshes the tree in one write, and an unchanged status keeps its object", async () => {
  const root = "/scale";
  const listing: Record<string, WorkspaceEntry[]> = {
    [root]: ["a", "b", "c"].map(name => ({ name, path: `${root}/${name}`, isDirectory: true })),
  };
  for (const name of ["a", "b", "c"]) {
    listing[`${root}/${name}`] = [{ name: "one.txt", path: `${root}/${name}/one.txt`, isDirectory: false }];
  }
  let statusAnswer: Record<string, unknown> = { ...status(), fingerprint: "f1" };
  const host = scriptedHost(command => {
    switch (command) {
      case "explorer_get_children":
        return null;
      case "git_get_status":
        return statusAnswer;
      default:
        return null;
    }
  });
  // Answers the listing by path (the request carries it).
  const invoke = host.invoke.bind(host);
  host.invoke = async (command, args) => {
    if (command === "explorer_get_children") {
      const path = String(((args ?? {}) as { request?: { path?: string } }).request?.path ?? "");
      host.requests.push({ command, request: { path } });
      return (listing[path] ?? []).map(entry => ({ ...entry }));
    }
    return invoke(command, args);
  };
  installBackendConnection(host);
  workspaces.set([{ id: "ws-scale", name: "scale", rootPath: root }]);
  activeWorkspaceKey.set({ deviceId: "", workspaceId: "ws-scale" });
  ensureWorkspaceWatch();

  for (const path of [root, `${root}/a`, `${root}/b`, `${root}/c`]) await loadDirectory(path);
  expect(Object.keys(dirChildren()).sort()).toEqual([root, `${root}/a`, `${root}/b`, `${root}/c`]);

  let writes = 0;
  effect(() => {
    dirChildren();
    writes += 1;
  });
  const before = writes;

  // Three directories change in one burst.
  for (const name of ["a", "b", "c"]) {
    listing[`${root}/${name}`].push({ name: "two.txt", path: `${root}/${name}/two.txt`, isDirectory: false });
  }
  host.push(
    ["a", "b", "c"].map(name => ({
      event: "file-system-changed",
      payload: [{ path: `${root}/${name}/two.txt`, kind: "create" }],
    })),
  );
  await tick(300);
  await tick();
  expect(writes - before).toBe(1);
  for (const name of ["a", "b", "c"]) {
    expect(dirChildren()[`${root}/${name}`].map(entry => entry.name)).toEqual(["one.txt", "two.txt"]);
  }
  // Every changed directory was read once, together.
  const reads = host.requests.filter(r => r.command === "explorer_get_children").slice(-3);
  expect(reads.map(r => r.request.path).sort()).toEqual([`${root}/a`, `${root}/b`, `${root}/c`]);

  // A burst that changed no listing (a file's content) writes nothing.
  const steady = writes;
  host.push([{ event: "file-system-changed", payload: [{ path: `${root}/a/one.txt`, kind: "modify" }] }]);
  await tick(300);
  await tick();
  expect(writes).toBe(steady);

  // Same fingerprint: the tree's status object is kept (no re-decoration);
  // a new fingerprint replaces it.
  await loadGitStatus();
  const first = gitStatus();
  expect(first?.fingerprint).toBe("f1");
  statusAnswer = { ...status(), fingerprint: "f1" };
  await loadGitStatus({ quiet: true });
  expect(gitStatus()).toBe(first);
  statusAnswer = { ...status({ untracked: ["/scale/new.txt"] }), fingerprint: "f2" };
  await loadGitStatus({ quiet: true });
  expect(gitStatus()?.untracked).toEqual(["/scale/new.txt"]);

  // An older host (no fingerprint) still compares by content.
  statusAnswer = { ...status({ untracked: ["/scale/new.txt"] }) };
  await loadGitStatus({ quiet: true });
  const legacy = gitStatus();
  statusAnswer = { ...status({ untracked: ["/scale/new.txt"] }) };
  await loadGitStatus({ quiet: true });
  expect(gitStatus()).toBe(legacy);
  statusAnswer = { ...status({ untracked: [] }) };
  await loadGitStatus({ quiet: true });
  expect(gitStatus()?.untracked).toEqual([]);
});

const MANY = 300;

test("300 changed files: rows are virtualized, and checking, select all and staging stay exact", async () => {
  const backend = createBackend();
  const unstaged = Array.from({ length: MANY }, (_, i) => ({
    path: `/repo/gen/file-${String(i).padStart(3, "0")}.ts`,
    status: "M",
    index_status: null,
    workdir_status: "M",
  }));
  const staged: Array<Record<string, unknown>> = [];
  const added: string[][] = [];
  const base = backend.handlers["openbitfun.invoke"];
  const snapshot = () => ({
    staged: [...staged],
    unstaged: unstaged.filter(file => !staged.some(s => s.path === file.path)),
    untracked: [],
    conflicts: [],
    current_branch: "main",
    ahead: 0,
    behind: 0,
    fingerprint: `fp-${staged.length}`,
  });
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    const request = args.request ?? {};
    switch (args.action) {
      case "git_is_repository":
        return { ok: true, value: true, transport: "dev" };
      case "git_get_repository_trust":
        return { ok: true, value: { state: "trusted", repositoryPath: "/repo", detail: null, manualCommand: null }, transport: "dev" };
      case "git_get_status":
        return { ok: true, value: snapshot(), transport: "dev" };
      case "git_watch_status":
        return {
          ok: true,
          value: { workspaceId: request.workspaceId, repositoryPath: request.repositoryPath, revision: 0, status: snapshot(), mode: "watch", event: "git://status-changed" },
          transport: "dev",
        };
      case "git_add_files": {
        const files = ((request.params ?? {}) as { files?: string[] }).files ?? [];
        added.push(files);
        for (const path of files) staged.push({ path, status: "M", index_status: "M", workdir_status: null });
        return { ok: true, value: { success: true, message: "Staged" }, transport: "dev" };
      }
      default:
        return base(data);
    }
  };
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openToolScene(app, "git");
  await app.waitFor("Working Copy");
  await app.waitFor("file-000.ts");

  // Only the rows near the viewport exist.
  expect(app.shows("file-299.ts")).toBe(false);
  // The list is laid out at its full length in the scene's scroll view: the
  // last rows are reached by scrolling it, and the first ones are let go.
  // Past the list's length whatever a row measures: a scroll stops at the end.
  await app.scroll("label:git-unstaged-gen/file-000.ts", 40 * MANY);
  await app.waitFor("file-299.ts");
  expect(app.shows("file-000.ts")).toBe(false);
  await app.scroll("label:git-unstaged-gen/file-299.ts", -40 * MANY);
  await app.waitFor("file-000.ts");

  // Check one row, then select every visible change: 300, each once.
  await app.hover("label:git-unstaged-gen/file-000.ts");
  await app.press("label:git-check-gen/file-000.ts");
  await app.waitFor("1 selected");
  await app.press("label:git-select-all");
  await app.waitFor("300 selected");
  // Unchecking one row takes exactly that row out.
  await app.press("label:git-check-gen/file-001.ts");
  await app.waitFor("299 selected");

  await app.press("label:git-stage-selected");
  await app.waitUntil(() => added.length === 1);
  expect(added[0]).toHaveLength(MANY - 1);
  expect(new Set(added[0]).size).toBe(MANY - 1);
  expect(added[0]).not.toContain("/repo/gen/file-001.ts");
  expect(added[0]).toContain("/repo/gen/file-299.ts");
  // The staged files leave the selection; the one left unchecked was never in it.
  await app.waitUntil(() => !app.shows("label:git-batch-bar"));
});

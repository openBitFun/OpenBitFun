import { expect, open, test } from "nsh/test";
import { createBackend, createDeviceBackend, type BackendOptions } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

interface WorkbenchFixtures {
  cronReadyRejects?: boolean;
  cronJobs?: Array<Record<string, unknown>>;
  gitIsRepo?: boolean;
  gitTrustState?: "trusted" | "trust_required" | "not_a_repository";
  gitTrustOutcomeState?: "trusted" | "trust_required";
  quickCommitFails?: boolean;
  enhancedBranchesFails?: boolean;
  miniapps?: Array<Record<string, unknown>>;
  runningWorkers?: string[];
}

function createWorkbenchBackend(
  baseOptions: BackendOptions = {},
  fx: WorkbenchFixtures = {},
  useDeviceBackend = false,
) {
  const base = useDeviceBackend ? createDeviceBackend(baseOptions) : createBackend(baseOptions);
  const originalInvoke = base.handlers["openbitfun.invoke"];

  const now = Date.now();
  let cronJobs: Array<Record<string, unknown>> = fx.cronJobs ?? [
    {
      id: "cron-1",
      name: "Daily PR Triage",
      schedule: { kind: "every", everyMs: 30 * 60_000, anchorMs: now + 15 * 60_000 },
      payload: { text: "Check open pull requests and report blockers." },
      reportPolicy: "conditional",
      enabled: true,
      target: {
        kind: "workspace",
        workspace: { workspaceId: "workspace-1", workspacePath: "/repo" },
        launch: { agentType: "Standard", modelId: null },
      },
      createdAtMs: now - 3600_000,
      updatedAtMs: now - 1800_000,
      state: {
        nextRunAtMs: now + 15 * 60_000,
        lastRunStatus: "ok",
      },
    },
    {
      id: "cron-session-1",
      name: "Session Watcher",
      schedule: { kind: "every", everyMs: 60 * 60_000, anchorMs: now + 45 * 60_000 },
      payload: { text: "Summarize progress in the pinned session." },
      reportPolicy: "inherit",
      enabled: false,
      target: {
        kind: "session",
        sessionId: "session-1",
        workspace: { workspaceId: "workspace-1", workspacePath: "/repo" },
      },
      createdAtMs: now - 7200_000,
      updatedAtMs: now - 3600_000,
      state: {
        lastRunStatus: "error",
        lastError: "Timed out waiting for response",
      },
    },
  ];
  let cronSeq = 2;

  let gitIsRepo = fx.gitIsRepo ?? true;
  let gitTrustState = fx.gitTrustState ?? "trusted";
  let gitStatusState: Record<string, unknown> = {
    staged: [{ path: "/repo/main.rs", status: "M", index_status: "M", workdir_status: null }],
    unstaged: [{ path: "/repo/docs/guide.md", status: "M", index_status: null, workdir_status: "M" }],
    untracked: ["/repo/scratch.txt"],
    conflicts: ["/repo/conflict.txt"],
    current_branch: "main",
    ahead: 2,
    behind: 1,
  };
  let branches: Array<Record<string, unknown>> = [
    { name: "main", current: true, remote: false, upstream: "origin/main", ahead: 2, behind: 1, last_commit: "abc123456789" },
    { name: "feat/studio", current: false, remote: false, upstream: null, ahead: 0, behind: 0, last_commit: "def987654321" },
    { name: "origin/main", current: false, remote: true, upstream: null, ahead: 0, behind: 0, last_commit: "abc123456789" },
  ];
  let worktrees: Array<Record<string, unknown>> = [
    { path: "/repo", branch: "main", head: "abc1234567890000", isMain: true, isLocked: false, isPrunable: false },
    { path: "/repo-wt-hotfix", branch: "hotfix/login", head: "def9876543210000", isMain: false, isLocked: false, isPrunable: false },
  ];
  const commits: Array<Record<string, unknown>> = [
    {
      hash: "abc1234567890000",
      short_hash: "abc1234",
      message: "feat(nsh): wire studio workbench",
      author: "Studio Bot",
      author_email: "bot@openbitfun.dev",
      date: "2026-11-18 12:00:00",
      parents: ["0001112223334444"],
    },
    {
      hash: "0001112223334444",
      short_hash: "0001112",
      message: "chore: initial repo",
      author: "Studio Bot",
      author_email: "bot@openbitfun.dev",
      date: "2026-11-17 09:00:00",
      parents: [],
    },
  ];

  let miniapps: Array<Record<string, unknown>> = fx.miniapps ?? [
    {
      id: "space-board",
      name: "Release Tracker",
      description: "Tracks release blockers and PR health.",
      icon: "layout-grid",
      category: "developer",
      tags: ["git", "release"],
      version: 2,
      created_at: 1763000000000,
      updated_at: 1763100000000,
      runtime_profile: "compatibility",
      permissions: {
        fs: { read: ["."], write: [] },
        node: { enabled: true },
        ai: { enabled: true },
      },
      source: {
        html: "<div id=\"app\">Release Board</div>",
        css: "#app { padding: 12px; }",
        ui_js: "console.log('release board ready');",
        worker_js: "export async function status() { return { ok: true }; }",
      },
      ai_context: {
        original_prompt: "Create a release readiness tracker Space.",
        iteration_history: ["v1 initial", "v2 added checks"],
      },
    },
    {
      id: "space-notes",
      name: "Focus Pad",
      description: "Minimal scratchpad for daily plans.",
      icon: "file-text",
      category: "productivity",
      tags: ["notes"],
      version: 1,
      created_at: 1762900000000,
      updated_at: 1762950000000,
      runtime_profile: "market_strict",
      permissions: {},
      source: {
        html: "<main>Focus Pad</main>",
        css: "",
        ui_js: "",
        worker_js: "",
      },
    },
  ];
  let runningWorkers: string[] = [...(fx.runningWorkers ?? ["space-board"])];

  function handleWorkbenchAction(
    action: string,
    payload: Record<string, unknown>,
    isRaw: boolean,
  ): { handled: boolean; value?: unknown; error?: string } {
    switch (action) {
      case "notify_cron_host_ready":
        if (fx.cronReadyRejects) return { handled: true, error: "Command not found: notify_cron_host_ready" };
        return { handled: true, value: null };
      case "list_cron_jobs":
        return { handled: true, value: cronJobs };
      case "create_cron_job": {
        const created = {
          id: `cron-created-${cronSeq++}`,
          name: payload.name,
          schedule: payload.schedule,
          payload: payload.payload,
          ...(payload.reportPolicy !== undefined ? { reportPolicy: payload.reportPolicy } : {}),
          enabled: payload.enabled !== false,
          target: payload.target,
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
          state: { nextRunAtMs: Date.now() + 10 * 60_000, lastRunStatus: null },
        };
        cronJobs = [created, ...cronJobs];
        return { handled: true, value: created };
      }
      case "update_cron_job": {
        const jobId = String(payload.jobId ?? "");
        const existing = cronJobs.find(j => j.id === jobId);
        if (!existing) return { handled: true, error: `Unknown cron job ${jobId}` };
        const updated = {
          ...existing,
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.schedule !== undefined ? { schedule: payload.schedule } : {}),
          ...(payload.payload !== undefined ? { payload: payload.payload } : {}),
          ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
          ...(payload.reportPolicy !== undefined ? { reportPolicy: payload.reportPolicy } : {}),
          ...(payload.target !== undefined ? { target: payload.target } : {}),
          updatedAtMs: Date.now(),
        };
        cronJobs = cronJobs.map(j => (j.id === jobId ? updated : j));
        return { handled: true, value: updated };
      }
      case "delete_cron_job": {
        const jobId = String(payload.jobId ?? "");
        cronJobs = cronJobs.filter(j => j.id !== jobId);
        return { handled: true, value: true };
      }

      case "git_is_repository":
        return { handled: true, value: gitIsRepo };
      case "git_get_repository_trust":
        return {
          handled: true,
          value: {
            state: gitTrustState,
            repositoryPath: String(payload.repositoryPath ?? "/repo"),
            detail:
              gitTrustState === "trust_required"
                ? "fatal: detected dubious ownership in repository at '/repo'"
                : null,
            manualCommand:
              gitTrustState === "trust_required"
                ? "git config --global --add safe.directory /repo"
                : null,
          },
        };
      case "git_trust_repository": {
        const outcome = fx.gitTrustOutcomeState ?? "trusted";
        gitTrustState = outcome;
        return {
          handled: true,
          value: {
            state: outcome,
            alreadyTrusted: false,
            repositoryPath: String(payload.repositoryPath ?? "/repo"),
            addedEntries: outcome === "trusted" ? ["/repo"] : [],
            detail: outcome === "trusted" ? null : "Read-only gitconfig",
            manualCommand: outcome === "trusted" ? null : "git config --global --add safe.directory /repo",
          },
        };
      }
      case "git_get_status":
        return { handled: true, value: gitStatusState };
      case "git_get_diff": {
        const params = (payload.params ?? {}) as { files?: string[]; staged?: boolean };
        const target = params.files?.[0] ?? "file";
        return {
          handled: true,
          value: [
            `diff --git a/${target} b/${target}`,
            `--- a/${target}`,
            `+++ b/${target}`,
            "@@ -1,2 +1,2 @@",
            " line one",
            "-old line",
            `+new ${params.staged ? "staged" : "working"} line`,
          ].join("\n"),
        };
      }
      case "git_add_files": {
        const params = (payload.params ?? {}) as { files?: string[]; all?: boolean };
        const toStage = params.all
          ? [
              ...(gitStatusState.unstaged as Array<{ path: string }>).map(f => f.path),
              ...(gitStatusState.untracked as string[]),
            ]
          : (params.files ?? []);
        const staged = [...(gitStatusState.staged as Array<Record<string, unknown>>)];
        for (const path of toStage) {
          if (!staged.some(s => s.path === path)) {
            staged.push({ path, status: "M", index_status: "M", workdir_status: null });
          }
        }
        gitStatusState = {
          ...gitStatusState,
          staged,
          unstaged: (gitStatusState.unstaged as Array<{ path: string }>).filter(
            f => !toStage.includes(f.path),
          ),
          untracked: (gitStatusState.untracked as string[]).filter(p => !toStage.includes(p)),
          conflicts: (gitStatusState.conflicts as string[]).filter(p => !toStage.includes(p)),
        };
        return { handled: true, value: { success: true, message: "Staged" } };
      }
      case "git_reset_files": {
        if (payload.params !== undefined) {
          return { handled: true, error: "git_reset_files expects flat files/staged, not params wrapper" };
        }
        const files = (payload.files as string[]) ?? [];
        const stagedMode = payload.staged !== false;
        if (stagedMode) {
          const staged = (gitStatusState.staged as Array<{ path: string }>).filter(
            f => !files.includes(f.path),
          );
          const unstaged = [...(gitStatusState.unstaged as Array<Record<string, unknown>>)];
          for (const path of files) {
            if (!unstaged.some(u => u.path === path)) {
              unstaged.push({ path, status: "M", index_status: null, workdir_status: "M" });
            }
          }
          gitStatusState = { ...gitStatusState, staged, unstaged };
          return { handled: true, value: { success: true, message: "Unstaged" } };
        }
        gitStatusState = {
          ...gitStatusState,
          unstaged: (gitStatusState.unstaged as Array<{ path: string }>).filter(
            f => !files.includes(f.path),
          ),
          conflicts: (gitStatusState.conflicts as string[]).filter(p => !files.includes(p)),
        };
        return { handled: true, value: { success: true, message: "Discarded" } };
      }
      case "delete_file": {
        const targetPath = String(payload.path ?? "");
        gitStatusState = {
          ...gitStatusState,
          untracked: (gitStatusState.untracked as string[]).filter(p => p !== targetPath),
        };
        return { handled: true, value: null };
      }
      case "quick_commit_message":
        if (fx.quickCommitFails) return { handled: true, error: "quick_commit_message unavailable" };
        return {
          handled: true,
          value: {
            title: "feat(studio): polish working copy diff",
            body: "Stage and commit cleanly.",
            fullMessage: "feat(studio): polish working copy diff\n\nStage and commit cleanly.",
          },
        };
      case "generate_commit_message":
        return {
          handled: true,
          value: {
            title: "chore(git): fallback generated commit",
            fullMessage: "chore(git): fallback generated commit",
          },
        };
      case "git_commit":
        gitStatusState = { ...gitStatusState, staged: [] };
        return { handled: true, value: { success: true, message: "Committed" } };
      case "git_pull":
        gitStatusState = { ...gitStatusState, behind: 0 };
        return { handled: true, value: { success: true, message: "Pulled" } };
      case "git_push":
        gitStatusState = { ...gitStatusState, ahead: 0 };
        return { handled: true, value: { success: true, message: "Pushed" } };
      case "git_get_enhanced_branches":
        if (fx.enhancedBranchesFails) return { handled: true, error: "enhanced branches unsupported" };
        return { handled: true, value: branches };
      case "git_get_branches":
        return { handled: true, value: branches };
      case "git_checkout_branch": {
        const target = String(payload.branchName ?? "");
        branches = branches.map(b => ({ ...b, current: b.name === target }));
        gitStatusState = { ...gitStatusState, current_branch: target };
        return { handled: true, value: { success: true } };
      }
      case "git_create_branch": {
        const name = String(payload.branchName ?? "");
        branches = [
          ...branches.map(b => ({ ...b, current: false })),
          { name, current: true, remote: false, upstream: null, ahead: 0, behind: 0, last_commit: "abc123456789" },
        ];
        gitStatusState = { ...gitStatusState, current_branch: name };
        return { handled: true, value: { success: true } };
      }
      case "git_delete_branch": {
        const name = String(payload.branchName ?? "");
        branches = branches.filter(b => b.name !== name);
        return { handled: true, value: { success: true } };
      }
      case "git_get_commits":
        return { handled: true, value: commits };
      case "git_get_graph":
        if (!isRaw) return { handled: true, error: "git_get_graph requires raw positional args" };
        if (String(payload.workspaceId ?? "") === "workspace-2") {
          return { handled: true, error: "Git graph is not supported for remote SSH workspaces yet" };
        }
        return {
          handled: true,
          value: {
            maxLane: 2,
            currentBranch: String(gitStatusState.current_branch ?? "main"),
            nodes: [
              {
                hash: "abc1234567890000",
                lane: 0,
                forkingLanes: [],
                mergingLanes: [1],
                passingLanes: [],
                refs: [{ name: "main", refType: "branch", isCurrent: true, isHead: true }],
              },
              {
                hash: "0001112223334444",
                lane: 1,
                forkingLanes: [0],
                mergingLanes: [],
                passingLanes: [],
                refs: [],
              },
            ],
          },
        };
      case "git_list_worktrees":
        if (String(payload.workspaceId ?? "") === "workspace-2") {
          return { handled: true, error: "Git worktrees are not supported for remote SSH workspaces yet" };
        }
        return { handled: true, value: worktrees };
      case "git_add_worktree": {
        const branch = String(payload.branch ?? "");
        const createBranch = payload.createBranch !== false;
        const created = {
          path: `/repo-${branch.replace(/\//g, "-")}`,
          branch,
          head: "abc1234567890000",
          isMain: false,
          isLocked: false,
          isPrunable: false,
        };
        worktrees = [...worktrees, created];
        if (createBranch && !branches.some(b => b.name === branch)) {
          branches = [
            ...branches,
            { name: branch, current: false, remote: false, upstream: null, ahead: 0, behind: 0, last_commit: "abc123456789" },
          ];
        }
        return { handled: true, value: created };
      }
      case "git_remove_worktree": {
        const wtPath = String(payload.worktreePath ?? "");
        worktrees = worktrees.filter(wt => wt.path !== wtPath);
        return { handled: true, value: { success: true } };
      }

      case "list_miniapps":
        return {
          handled: true,
          value: miniapps.map(({ source: _src, ai_context: _ai, ...meta }) => meta),
        };
      case "miniapp_worker_list_running":
        return { handled: true, value: runningWorkers };
      case "miniapp_worker_stop": {
        const appId = String(payload.appId ?? "");
        runningWorkers = runningWorkers.filter(id => id !== appId);
        return { handled: true, value: null };
      }
      case "get_miniapp": {
        if (isRaw) return { handled: true, error: "get_miniapp takes a request struct, not raw" };
        const appId = String(payload.appId ?? "");
        const found = miniapps.find(m => m.id === appId);
        if (!found) return { handled: true, error: `MiniApp ${appId} not found` };
        return { handled: true, value: found };
      }
      case "get_miniapp_versions": {
        if (!isRaw) return { handled: true, error: "get_miniapp_versions takes positional args" };
        const appId = String(payload.appId ?? "");
        const found = miniapps.find(m => m.id === appId);
        const maxVer = Number(found?.version ?? 1);
        const vers: number[] = [];
        for (let v = 1; v <= maxVer; v += 1) vers.push(v);
        return { handled: true, value: vers };
      }
      case "delete_miniapp": {
        if (!isRaw) return { handled: true, error: "delete_miniapp takes positional args" };
        const appId = String(payload.appId ?? "");
        miniapps = miniapps.filter(m => m.id !== appId);
        runningWorkers = runningWorkers.filter(id => id !== appId);
        return { handled: true, value: null };
      }
      default:
        return { handled: false };
    }
  }

  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown; raw?: unknown };
    const action = args.action ?? "";
    const isRaw = Object.prototype.hasOwnProperty.call(args, "raw");
    const payload = ((isRaw ? args.raw : args.request) ?? {}) as Record<string, unknown>;

    if (action === "account_device_rpc") {
      const envelope = JSON.parse(String(payload.commandJson ?? payload.command_json ?? "{}")) as {
        cmd?: string;
        command?: string;
        args?: Record<string, unknown>;
      };
      const peerAction = envelope.command ?? "";
      const peerArgs = (envelope.args ?? {}) as Record<string, unknown>;
      const hasRequest = Object.prototype.hasOwnProperty.call(peerArgs, "request");
      const peerPayload = ((hasRequest ? peerArgs.request : peerArgs) ?? {}) as Record<string, unknown>;
      const res = handleWorkbenchAction(peerAction, peerPayload, !hasRequest);
      if (res.handled) {
        base.calls.push({ action, request: payload, raw: isRaw });
        base.peerInvocations.push({ action: peerAction, args: peerArgs });
        return {
          ok: true,
          value: JSON.stringify({
            resp: "host_invoke_result",
            ok: !res.error,
            ...(res.error ? { error: res.error } : { value: res.value }),
          }),
          transport: "dev",
        };
      }
      return originalInvoke(data);
    }

    const res = handleWorkbenchAction(action, payload, isRaw);
    if (res.handled) {
      base.calls.push({ action, request: isRaw ? args.raw : args.request, raw: isRaw });
      if (res.error) return { ok: false, error: res.error, transport: "dev" };
      return { ok: true, value: res.value, transport: "dev" };
    }
    return originalInvoke(data);
  };

  return {
    ...base,
    pushCronJobFromHost: (job: Record<string, unknown>) => {
      cronJobs = [job, ...cronJobs];
    },
  };
}

test("routines: loads schedules, renders 24h & calendar, creates/edits/toggles/deletes, and reacts to cron://jobs-changed", async () => {
  const backend = createWorkbenchBackend({}, { cronReadyRejects: true });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Routines");
  await app.press("Routines");
  await app.waitFor("Daily PR Triage");

  expect(backend.actions()).toContain("notify_cron_host_ready");
  expect(backend.actions()).toContain("list_cron_jobs");
  expect(app.texts()).toContain("1 active");
  expect(app.texts()).toContain("Due in Next 24 Hours");

  // Filter tabs: Paused shows Session Watcher only in All Routines
  await app.press("Paused");
  expect(app.texts()).toContain("Session Watcher");
  expect(app.shows("label:routine-toggle-cron-1")).toBe(false);
  await app.press("All");
  await app.waitFor("label:routine-toggle-cron-1");

  // Calendar navigation & day selection
  await app.press("label:routines-cal-next");
  await app.press("label:routines-cal-today");
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const targetDay = `${y}-${m}-15`;
  await app.press(`label:routines-day-${targetDay}`);
  await app.waitFor(`Scheduled for ${targetDay}`);

  // Create a new Cron routine inside ModalDialog with SelectDropdown
  await app.press("label:routines-new");
  await app.waitFor("label:routine-name-input");
  await app.type("label:routine-name-input", "Morning Digest");
  await app.press("label:routine-schedule-kind");
  await app.press("Cron Expression (5-field)");
  await app.clear("label:routine-cron-expr");
  await app.type("label:routine-cron-expr", "30 9 * * *");
  await app.type("label:routine-prompt-input", "Summarize overnight CI status.");
  await app.press("label:routine-policy-select");
  await app.press("Always report results");
  await app.press("label:routine-save");

  await app.waitFor("Morning Digest");
  const createCall = backend.calls.find(c => c.action === "create_cron_job");
  expect(createCall?.raw).toBe(false);
  expect(createCall?.request).toMatchObject({
    name: "Morning Digest",
    schedule: { kind: "cron", expr: "30 9 * * *" },
    payload: { text: "Summarize overnight CI status." },
    reportPolicy: "always",
    enabled: true,
    target: {
      kind: "workspace",
      workspace: { workspaceId: "workspace-1", workspacePath: "/repo" },
      launch: { agentType: "Standard", modelId: null },
    },
  });

  // Edit existing session-target job via more DropdownMenu and verify session target preserved
  await app.press("label:routine-more-cron-session-1");
  await app.press("label:routine-edit-cron-session-1");
  await app.waitFor("Pinned Session Target Preserved");
  await app.clear("label:routine-name-input");
  await app.type("label:routine-name-input", "Session Watcher Updated");
  await app.press("label:routine-save");
  await app.waitFor("Session Watcher Updated");
  const updateSessionCall = backend.calls.find(
    c =>
      c.action === "update_cron_job" &&
      (c.request as Record<string, unknown>)?.jobId === "cron-session-1",
  );
  expect(updateSessionCall?.request).toMatchObject({
    jobId: "cron-session-1",
    name: "Session Watcher Updated",
    target: { kind: "session", sessionId: "session-1" },
  });

  // Toggle enabled switch on Daily PR Triage
  await app.press("label:routine-toggle-cron-1");
  const toggleCall = backend.calls.find(
    c =>
      c.action === "update_cron_job" &&
      (c.request as Record<string, unknown>)?.jobId === "cron-1",
  );
  expect(toggleCall?.request).toMatchObject({ jobId: "cron-1", enabled: false });

  // Delete routine via more DropdownMenu + InlineConfirmBar
  await app.press("label:routine-more-cron-session-1");
  await app.press("label:routine-delete-cron-session-1");
  await app.waitFor("Delete routine");
  await app.press("Delete routine");
  const deleteCall = backend.calls.find(c => c.action === "delete_cron_job");
  expect(deleteCall?.request).toMatchObject({ jobId: "cron-session-1" });
  expect(app.texts()).not.toContain("Session Watcher Updated");

  // Host pushes cron://jobs-changed -> reloads list_cron_jobs
  backend.pushCronJobFromHost({
    id: "cron-from-event",
    name: "Agent Created Cron",
    schedule: { kind: "every", everyMs: 600_000 },
    payload: { text: "Verify logs." },
    enabled: true,
    target: {
      kind: "workspace",
      workspace: { workspaceId: "workspace-1", workspacePath: "/repo" },
      launch: { agentType: "Minimal", modelId: null },
    },
    state: {},
  });
  await app.host.send("openbitfun.event", {
    event: "cron://jobs-changed",
    payload: { reason: "created", jobId: "cron-from-event" },
  });
  await app.waitFor("Agent Created Cron");
});

test("routines: Peer Device Mode omits reportPolicy when background_result_delivery_v1 is false", async () => {
  const backend = createWorkbenchBackend(
    {
      onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }],
      peerCapabilities: { background_result_delivery_v1: false },
    },
    {},
    true,
  );
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Devices");
  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("Driving builder (desktop): sessions, files, terminals and settings come from that device");

  await app.press("Routines");
  await app.waitFor("Daily PR Triage");
  expect(app.texts().some(t => t.includes("background_result_delivery_v1"))).toBe(true);

  await app.press("label:routines-new");
  await app.type("label:routine-name-input", "Peer Routine");
  await app.type("label:routine-prompt-input", "Check peer health.");
  await app.press("label:routine-save");
  await app.waitFor("Peer Routine");

  const peerCreate = backend.peerInvocations.find(inv => inv.action === "create_cron_job");
  expect(peerCreate).toBeDefined();
  const req = (peerCreate?.args as { request?: Record<string, unknown> })?.request ?? {};
  expect(Object.prototype.hasOwnProperty.call(req, "reportPolicy")).toBe(false);
});

test("git: trust_required recovery and not_a_repository initialize with agent", async () => {
  const trustBackend = createWorkbenchBackend({}, { gitTrustState: "trust_required" });
  const app1 = await open("../App.tsx", { ...DESKTOP, host: { handlers: trustBackend.handlers } });
  await app1.waitFor("Git");
  await app1.press("Git");
  await app1.waitFor("Repository Trust Required");
  expect(app1.texts()).toContain("git config --global --add safe.directory /repo");

  await app1.press("label:git-trust-repo");
  await app1.waitFor("Working Copy");
  expect(trustBackend.actions()).toContain("git_trust_repository");
  expect(app1.texts()).toContain("main");

  const emptyBackend = createWorkbenchBackend({}, { gitIsRepo: false });
  const app2 = await open("../App.tsx", { ...DESKTOP, host: { handlers: emptyBackend.handlers } });
  await app2.waitFor("Git");
  await app2.press("Git");
  await app2.waitFor("Not a Git repository");

  await app2.press("Initialize with Agent");
  await app2.waitFor("label:composer");
  expect(emptyBackend.actions()).toContain("start_dialog_turn");

  const readonlyTrustBackend = createWorkbenchBackend(
    {},
    { gitTrustState: "trust_required", gitTrustOutcomeState: "trust_required" },
  );
  const app3 = await open("../App.tsx", { ...DESKTOP, host: { handlers: readonlyTrustBackend.handlers } });
  await app3.waitFor("Git");
  await app3.press("Git");
  await app3.waitFor("Repository Trust Required");
  await app3.press("label:git-trust-repo");
  await app3.waitFor("Read-only gitconfig");
  expect(app3.texts()).toContain("git config --global --add safe.directory /repo");
});

test("git: working copy stage/unstage/discard/AI commit, branches, worktrees, history remote skip, and compact AuxPane", async () => {
  const backend = createWorkbenchBackend({}, { quickCommitFails: true, enhancedBranchesFails: true });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Git");
  await app.press("Git");
  await app.waitFor("Working Copy");
  expect(app.texts()).toContain("docs/guide.md");
  expect(app.texts()).toContain("main.rs");
  expect(app.texts()).toContain("scratch.txt");
  expect(app.texts()).toContain("conflict.txt");

  // Select staged file to inspect staged diff, then unstage & discard working/untracked changes
  await app.press("label:git-staged-main.rs");
  const stagedDiffCall = backend.calls.find(
    c =>
      c.action === "git_get_diff" &&
      ((c.request as { params?: { files?: string[]; staged?: boolean } })?.params?.staged === true),
  );
  expect(stagedDiffCall?.request).toMatchObject({
    params: { files: ["/repo/main.rs"], staged: true },
  });

  // Discard unstaged modification via git_reset_files (staged: false)
  await app.press("label:git-discard-docs/guide.md");
  await app.waitFor("Discard");
  await app.press("Discard");
  const discardCall = backend.calls.find(
    c =>
      c.action === "git_reset_files" &&
      (c.request as { staged?: boolean })?.staged === false,
  );
  expect(discardCall?.request).toEqual({
    workspaceId: "workspace-1",
    repositoryPath: "/repo",
    files: ["/repo/docs/guide.md"],
    staged: false,
  });

  // Discard untracked file via delete_file
  await app.press("label:git-discard-scratch.txt");
  await app.waitFor("Delete");
  await app.press("Delete");
  expect(backend.calls.find(c => c.action === "delete_file")?.request).toMatchObject({
    workspaceId: "workspace-1",
    path: "/repo/scratch.txt",
  });

  // Unstage staged file, re-stage conflict, then Stage all
  await app.press("label:git-unstage-main.rs");
  expect(
    backend.calls.some(
      c =>
        c.action === "git_reset_files" &&
        (c.request as { staged?: boolean; files?: string[] })?.staged === true &&
        (c.request as { files?: string[] })?.files?.[0] === "/repo/main.rs",
    ),
  ).toBe(true);

  await app.press("label:git-stage-all");
  expect(
    backend.calls.some(
      c =>
        c.action === "git_add_files" &&
        (c.request as { params?: { all?: boolean } })?.params?.all === true,
    ),
  ).toBe(true);

  // AI commit message (fallback from quick_commit_message to generate_commit_message) + Amend + Commit
  await app.press("label:git-generate-message");
  await app.waitFor("Generated commit message with AI");
  expect(backend.actions()).toContain("quick_commit_message");
  expect(backend.actions()).toContain("generate_commit_message");

  await app.press("label:git-commit-amend");
  await app.press("label:git-commit-submit");
  expect(backend.calls.find(c => c.action === "git_commit")?.request).toMatchObject({
    workspaceId: "workspace-1",
    repositoryPath: "/repo",
    params: { message: "chore(git): fallback generated commit", amend: true },
  });

  // Toolbar Pull, Push & SelectDropdown quick branch switch
  await app.press("label:git-pull");
  await app.press("label:git-push");
  expect(backend.actions()).toContain("git_pull");
  expect(backend.actions()).toContain("git_push");

  await app.press("label:git-branch-switcher");
  await app.press("label:git-branch-option-feat/studio");
  expect(backend.calls.find(c => c.action === "git_checkout_branch")?.request).toMatchObject({
    branchName: "feat/studio",
  });

  // Create Branch modal from toolbar + Branches tab checkout & delete
  await app.press("label:git-new-branch-toolbar");
  await app.type("label:git-new-branch-name", "feat/nsh-git");
  await app.press("label:git-create-branch-submit");
  await app.press("Branches");
  await app.waitFor("feat/nsh-git");
  expect(backend.calls.find(c => c.action === "git_create_branch")?.request).toMatchObject({
    branchName: "feat/nsh-git",
  });

  await app.press("label:git-checkout-main");
  await app.press("label:git-delete-branch-feat/studio");
  await app.press("Delete branch");
  expect(backend.calls.find(c => c.action === "git_delete_branch")?.request).toMatchObject({
    branchName: "feat/studio",
    force: false,
  });

  // Worktrees tab: list, add via ModalDialog, remove via InlineConfirmBar
  await app.press("Worktrees");
  await app.waitFor("hotfix/login");
  expect(backend.actions()).toContain("git_list_worktrees");

  await app.press("label:git-add-worktree-open");
  await app.type("label:git-worktree-branch-name", "feat/wt-test");
  await app.press("label:git-add-worktree-submit");
  await app.waitFor("/repo-feat-wt-test");
  expect(backend.calls.find(c => c.action === "git_add_worktree")?.request).toMatchObject({
    workspaceId: "workspace-1",
    repositoryPath: "/repo",
    branch: "feat/wt-test",
    createBranch: true,
  });

  await app.press("label:git-remove-worktree-/repo-wt-hotfix");
  await app.waitFor("Remove worktree");
  await app.press("Remove worktree");
  expect(backend.calls.find(c => c.action === "git_remove_worktree")?.request).toMatchObject({
    workspaceId: "workspace-1",
    repositoryPath: "/repo",
    worktreePath: "/repo-wt-hotfix",
    force: false,
  });

  // History tab on local workspace calls git_get_graph and shows lane badges
  await app.press("History");
  await app.waitFor("feat(nsh): wire studio workbench");
  expect(app.texts()).toContain("L0");

  const localGraphCalls = backend.calls.filter(c => c.action === "git_get_graph").length;
  const localWorktreeCalls = backend.calls.filter(c => c.action === "git_list_worktrees").length;
  expect(localGraphCalls).toBeGreaterThan(0);
  expect(localWorktreeCalls).toBeGreaterThan(0);

  // Switch to remote workspace: NEVER call git_get_graph or git_list_worktrees for remote-host!
  await app.press("label:workspace-row-workspace-2");
  await app.waitFor("Commit lane graphs are available on local workspaces only. Showing linear commit history for this remote workspace.");
  expect(backend.calls.filter(c => c.action === "git_get_graph").length).toBe(localGraphCalls);
  expect(app.texts()).toContain("feat(nsh): wire studio workbench");

  await app.press("Worktrees");
  await app.waitFor("Git worktrees are supported on local workspaces only. Remote SSH worktrees are not available yet.");
  expect(backend.calls.filter(c => c.action === "git_list_worktrees").length).toBe(localWorktreeCalls);

  // Switch back to local workspace + Sessions and open GitScene inside AuxPane compact split
  await app.press("label:workspace-row-workspace-1");
  await app.press("Sessions");
  await app.waitFor("label:topbar-aux-git");
  await app.press("label:topbar-aux-git");
  await app.waitFor("label:git-branch-switcher");
  expect(app.texts()).toContain("Changes");
  expect(app.texts()).toContain("Worktrees");
});

test("spaces: lists miniapps, inspects details/versions/source in ModalDialog, stops worker, deletes via DropdownMenu, and launches Ultimate agent", async () => {
  const backend = createWorkbenchBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Spaces");
  await app.press("Spaces");
  await app.waitFor("Release Tracker");
  expect(app.texts()).toContain("Focus Pad");
  expect(app.texts().some(t => t.includes("1 active workers"))).toBe(true);
  expect(app.texts().some(t => t.includes("desktop host shell"))).toBe(true);

  // Open Inspector ModalDialog -> checks get_miniapp (invokeCommand) & get_miniapp_versions (invokeRawCommand)
  await app.press("label:space-inspect-space-board");
  await app.waitFor("Create a release readiness tracker Space.");
  expect(app.texts()).toContain("v2");
  expect(app.texts()).toContain("Node/Bun Worker");
  expect(app.texts()).toContain("<div id=\"app\">Release Board</div>");

  const getMiniAppCall = backend.calls.find(c => c.action === "get_miniapp");
  expect(getMiniAppCall?.raw).toBe(false);
  expect(getMiniAppCall?.request).toMatchObject({ appId: "space-board" });

  await app.press("Worker JS");
  await app.waitFor("export async function status() { return { ok: true }; }");

  // Stop worker from Inspector footer & close ModalDialog
  await app.press("label:space-inspector-stop");
  await app.waitUntil(() => !app.shows("label:space-inspector-stop"));
  expect(backend.calls.find(c => c.action === "miniapp_worker_stop")?.request).toMatchObject({
    appId: "space-board",
  });
  await app.press("label:space-inspector-close");

  // Delete Space via card more DropdownMenu + InlineConfirmBar, then inspect remaining Space
  await app.press("label:space-more-space-board");
  await app.press("label:space-menu-delete-space-board");
  await app.waitFor("Delete");
  await app.press("Delete");
  expect(backend.calls.find(c => c.action === "delete_miniapp")?.request).toMatchObject({
    appId: "space-board",
  });
  expect(app.texts()).not.toContain("Release Tracker");

  await app.press("label:space-inspect-space-notes");
  await app.waitFor("Minimal scratchpad for daily plans.");
  expect(app.texts()).toContain("<main>Focus Pad</main>");
  await app.press("label:space-inspector-close");

  // Hero launchpad -> Create with Agent (Ultimate)
  await app.type("label:spaces-prompt-input", "A Pomodoro focus timer with audio chime");
  await app.press("label:spaces-create-agent");
  await app.waitFor("label:composer");
  const turnCall = backend.calls.find(c => c.action === "start_dialog_turn");
  expect(turnCall?.request).toMatchObject({
    agentType: "Ultimate",
  });
  expect(String((turnCall?.request as Record<string, unknown>)?.userInput ?? "")).toContain(
    "Pomodoro focus timer",
  );
});

test("spaces: shows Peer Device Mode notice when driving a peer", async () => {
  const backend = createWorkbenchBackend(
    { onlineDevices: [{ deviceId: "device-mac" }, { deviceId: "device-linux" }] },
    {},
    true,
  );
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });

  await app.waitFor("Devices");
  await app.press("Devices");
  await app.waitFor("builder");
  await app.press("device-use-device-linux");
  await app.waitFor("Driving builder (desktop): sessions, files, terminals and settings come from that device");

  await app.press("Spaces");
  await app.waitFor("Release Tracker");
  expect(app.texts().some(t => t.includes("Driving peer device builder"))).toBe(true);
});

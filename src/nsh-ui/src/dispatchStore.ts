// Detached dispatch: a job submitted to another host (an SSH target or a
// same-account device) that owns it from then on, while this window only
// observes.
//
// The target is the authority. Nothing about a job is cached here beyond what
// the last read returned, and a job's id and session id are minted on this
// surface because the submit request requires both before the target creates
// them.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { activeSessionId, activeWorkspaceRoot, agentTypeOf, runStep } from "./state";

/** The targets the host can dispatch to, as `dispatch_list_targets` reports them. */
export interface DispatchTarget {
  kind: string;
  connectionId?: string;
  deviceId?: string;
  displayName: string;
  description?: string;
  online?: boolean;
}

/** One job in the controller's own index, as `dispatch_list_jobs` reports it. */
export interface DispatchJob {
  jobId: string;
  sessionId: string;
  promptPreview: string;
  title?: string;
  state: string;
  workspacePath: string;
  target: { kind?: string; displayName?: string; connectionId?: string; deviceId?: string };
  createdAt?: string;
  updatedAt?: string;
}

export const dispatchTargets = signal<DispatchTarget[]>([]);
export const dispatchJobs = signal<DispatchJob[]>([]);
/** `null` until the host has been asked; `false` means it has no dispatch at all. */
export const dispatchSupported = signal<boolean | null>(null);
export const dispatchNotice = signal("");
/** The target the form submits to, by its key; the first target until one is picked. */
export const dispatchTargetKey = signal<string | null>(null);
export const dispatchWorkspacePath = signal("");
export const dispatchPrompt = signal("");
export const dispatchApprovalPolicy = signal("auto");
export const dispatchFormOpen = signal(false);

/**
 * `dispatch_submit` refuses anything else. The desktop offers the same three:
 * `auto` lets the target decide, `reject-and-report` fails instead of asking a
 * human nobody is watching, `remote` asks this window.
 */
export const DISPATCH_APPROVAL_POLICIES: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: "auto", label: "Auto", hint: "The target approves what its policy allows" },
  { value: "reject-and-report", label: "Reject", hint: "Fails instead of waiting for an answer" },
  { value: "remote", label: "Ask me", hint: "Prompts come back to this window" },
];

let loaded = false;

/** A stable key for a target: its kind plus the id the host gave it. */
export function targetKey(target: DispatchTarget): string {
  if (target.kind === "ssh") return `ssh:${target.connectionId ?? ""}`;
  if (target.kind === "device") return `device:${target.deviceId ?? ""}`;
  return "local";
}

export function selectedTarget(): DispatchTarget | null {
  const key = dispatchTargetKey();
  return dispatchTargets().find(target => targetKey(target) === key) ?? dispatchTargets()[0] ?? null;
}

/** The `target` object `dispatch_submit` and `dispatch_list_jobs` take. */
export function targetRequest(target: DispatchTarget): Record<string, unknown> {
  if (target.kind === "ssh" && target.connectionId) {
    return { kind: "ssh", connectionId: target.connectionId, workspacePath: dispatchWorkspacePath().trim() };
  }
  if (target.kind === "device" && target.deviceId) {
    return { kind: "device", deviceId: target.deviceId, workspacePath: dispatchWorkspacePath().trim() };
  }
  return { kind: "local" };
}

function readableJobs(value: unknown): DispatchJob[] {
  const rows = Array.isArray(value) ? value : [];
  const result: DispatchJob[] = [];
  for (const entry of rows) {
    const record = entry as Partial<DispatchJob> & { lastState?: string; id?: string };
    const jobId = typeof record.jobId === "string" ? record.jobId : typeof record.id === "string" ? record.id : "";
    if (!jobId) continue;
    result.push({
      jobId,
      sessionId: typeof record.sessionId === "string" ? record.sessionId : "",
      promptPreview: typeof record.promptPreview === "string" ? record.promptPreview : "",
      title: typeof record.title === "string" ? record.title : undefined,
      // The index keeps the state under `lastState`; a target's own list may
      // report it as `state`.
      state: typeof record.lastState === "string" ? record.lastState : typeof record.state === "string" ? record.state : "unknown",
      workspacePath: typeof record.workspacePath === "string" ? record.workspacePath : "",
      target: (record.target ?? {}) as DispatchJob["target"],
      createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    });
  }
  return result;
}

/** Reads the targets and the jobs once; the scene calls this on every render. */
export function ensureDispatch(): void {
  if (loaded) return;
  loaded = true;
  void loadDispatchTargets();
  void refreshDispatchJobs();
}

export async function loadDispatchTargets(): Promise<void> {
  await runStep(async () => {
    try {
      const targets = await invokeCommand<DispatchTarget[]>("dispatch_list_targets", {});
      const usable = (Array.isArray(targets) ? targets : []).filter(target => typeof target?.kind === "string");
      dispatchTargets.set(usable);
      dispatchSupported.set(true);
      if (!dispatchTargetKey()) {
        const first = usable.find(target => target.kind !== "local") ?? usable[0];
        if (first) dispatchTargetKey.set(targetKey(first));
      }
    } catch {
      // A host without the dispatch commands keeps the panel out of the way.
      dispatchSupported.set(false);
      dispatchTargets.set([]);
    }
  });
}

export async function refreshDispatchJobs(): Promise<void> {
  await runStep(async () => {
    try {
      // No target: the controller's own index, which covers every target.
      const jobs = await invokeCommand<unknown>("dispatch_list_jobs", {});
      dispatchJobs.set(readableJobs(jobs));
    } catch {
      dispatchJobs.set([]);
    }
  });
}

export function openDispatchForm(): void {
  dispatchFormOpen.set(true);
  dispatchNotice.set("");
  if (!dispatchWorkspacePath()) dispatchWorkspacePath.set(activeWorkspaceRoot());
}

/** Mints the ids the submit request needs before the target owns them. */
function mintId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function submitDispatch(): Promise<void> {
  const target = selectedTarget();
  const prompt = dispatchPrompt().trim();
  if (!target) {
    dispatchNotice.set("No dispatch target is available from this host");
    return;
  }
  if (target.kind !== "local" && !dispatchWorkspacePath().trim()) {
    dispatchNotice.set("A remote target needs the workspace path on that host");
    return;
  }
  if (!prompt) {
    dispatchNotice.set("A job needs a prompt");
    return;
  }
  await runStep(async () => {
    try {
      await invokeCommand<unknown>("dispatch_submit", {
        target: targetRequest(target),
        jobId: mintId("job"),
        sessionId: mintId("session"),
        // The agent the composer is on, which is what the job would run as here.
        agentType: agentTypeOf(activeSessionId()),
        prompt,
        approvalPolicy: dispatchApprovalPolicy(),
        ...(activeWorkspaceRoot() ? { sourceWorkspacePath: activeWorkspaceRoot() } : {}),
      });
      dispatchPrompt.set("");
      dispatchNotice.set(`Submitted to ${target.displayName}`);
      await refreshDispatchJobs();
      // A local job is not detached, so this is the only place it shows up.
      dispatchFormOpen.set(false);
    } catch (error) {
      dispatchNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

export async function cancelDispatch(jobId: string): Promise<void> {
  await runStep(async () => {
    try {
      await invokeCommand<unknown>("dispatch_cancel", { jobId });
      dispatchNotice.set("Cancel requested");
      await refreshDispatchJobs();
    } catch (error) {
      dispatchNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

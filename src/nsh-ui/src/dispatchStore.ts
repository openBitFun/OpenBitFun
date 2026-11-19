// Detached dispatch: a job submitted to another host (an SSH target or a
// same-account device) that owns it from then on, while this window only
// observes.
//
// The target is the authority. Nothing about a job is cached here beyond what
// the last read returned, and a job's id and session id are minted on this
// surface because the submit request requires both before the target creates
// them.

import { signal } from "nsh";
import { getConfig } from "./api";
import { invokeCommand } from "./bridge";
import { tr } from "./i18n";
import { activeSessionId, activeWorkspaceId, activeWorkspaceRoot, agentTypeOf, runStep } from "./state";

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
/** Per-job options `dispatch_submit` takes beside the prompt (the desktop's dialog offers the same). */
export const dispatchIncludeUncommitted = signal(false);
export const dispatchBaseRef = signal("HEAD");
export const dispatchTitle = signal("");
export const dispatchModel = signal("");

export interface DispatchProbeState {
  /** The target key this answer is for. */
  key: string;
  status: "checking" | "ready" | "not-ready" | "failed";
  message: string;
  availableModels: string[];
  defaultModel: string;
}

/** The readiness of the selected target; Submit stays off until it is `ready`. */
export const dispatchProbe = signal<DispatchProbeState | null>(null);
let probeGeneration = 0;

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
  dispatchBaseRef.set("HEAD");
  dispatchTitle.set("");
  dispatchModel.set("");
  dispatchIncludeUncommitted.set(false);
  // The baseline copies local changes the way the worktree setting says, as on the desktop.
  void getConfig("app.worktrees", true)
    .then(settings => {
      const record = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
      dispatchIncludeUncommitted.set(record.copyLocalChanges === true);
    })
    .catch(() => undefined);
  void probeDispatchTarget();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

/**
 * Asks the selected target whether it can run a detached job. The controller
 * host decides readiness from the shared dispatch contract (protocol version and
 * required capabilities) and answers `ready`, a `reason` code and the
 * `missingCapabilities`; this surface only words the verdict. A controller host
 * older than that verdict says it needs an update rather than being judged by a
 * copy of the contract kept here. A local target needs no probe; probe failures
 * keep Submit off with the reason on screen.
 */
export async function probeDispatchTarget(): Promise<void> {
  const target = selectedTarget();
  const generation = ++probeGeneration;
  if (!target) {
    dispatchProbe.set(null);
    return;
  }
  const key = targetKey(target);
  if (target.kind === "local") {
    dispatchProbe.set({ key, status: "ready", message: "", availableModels: [], defaultModel: "" });
    return;
  }
  dispatchProbe.set({ key, status: "checking", message: "", availableModels: [], defaultModel: "" });
  try {
    // The target checks out its own worktree, so the probe sends no path.
    const request =
      target.kind === "ssh"
        ? { kind: "ssh", connectionId: target.connectionId ?? "", workspacePath: "" }
        : { kind: "device", deviceId: target.deviceId ?? "", workspacePath: "" };
    const probe = await invokeCommand<Record<string, unknown>>("dispatch_probe_target", { target: request });
    if (generation !== probeGeneration) return;
    const record = probe && typeof probe === "object" ? probe : {};
    const protocol =
      record.protocol && typeof record.protocol === "object"
        ? (record.protocol as Record<string, unknown>)
        : null;
    const protocolError = typeof record.protocolError === "string" ? record.protocolError : "";
    const reason = typeof record.reason === "string" ? record.reason : "";
    const missing = stringList(record.missingCapabilities);
    let message = "";
    if (typeof record.ready !== "boolean") {
      // A controller host that predates the readiness verdict.
      message = tr("devices.dispatchHostUpdateRequired");
    } else if (!record.ready) {
      if (reason === "cli_missing") {
        message = tr("devices.dispatchCliMissing");
      } else if (reason === "capabilities_missing" && missing.length > 0) {
        message = tr("devices.dispatchCapabilitiesMissing", { list: missing.join(", ") });
      } else if (reason === "incompatible" && !protocolError) {
        message = tr("devices.dispatchProtocolMismatch", {
          version: String(protocol?.protocolVersion ?? "?"),
          expected: String(record.expectedProtocolVersion ?? "?"),
        });
      } else {
        message = protocolError || reason || tr("devices.dispatchHostUpdateRequired");
      }
    }
    dispatchProbe.set({
      key,
      status: message ? "not-ready" : "ready",
      message,
      availableModels: stringList(protocol?.availableModels),
      defaultModel: typeof protocol?.defaultModel === "string" ? protocol.defaultModel : "",
    });
  } catch (error) {
    if (generation !== probeGeneration) return;
    dispatchProbe.set({
      key,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      availableModels: [],
      defaultModel: "",
    });
  }
}

/** Selects a target and checks it again. */
export function chooseDispatchTarget(key: string): void {
  dispatchTargetKey.set(key);
  dispatchModel.set("");
  void probeDispatchTarget();
}

/** Whether the probe answered `ready` for the target the form shows. */
export function dispatchTargetReady(): boolean {
  const target = selectedTarget();
  const probe = dispatchProbe();
  return Boolean(target && probe && probe.key === targetKey(target) && probe.status === "ready");
}

/** Mints the ids the submit request needs before the target owns them. */
function mintId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function submitDispatch(): Promise<void> {
  const target = selectedTarget();
  const prompt = dispatchPrompt().trim();
  if (!target) {
    dispatchNotice.set(tr("devices.dispatchNoTarget"));
    return;
  }
  if (!dispatchTargetReady()) {
    dispatchNotice.set(dispatchProbe()?.message || tr("devices.dispatchNotReady"));
    return;
  }
  if (target.kind !== "local" && !dispatchWorkspacePath().trim()) {
    dispatchNotice.set(tr("devices.dispatchNeedsPath"));
    return;
  }
  if (!prompt) {
    dispatchNotice.set(tr("devices.dispatchNeedsPrompt"));
    return;
  }
  const title = dispatchTitle().trim();
  const model = dispatchModel().trim();
  const workspaceId = activeWorkspaceId();
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
        baseRef: dispatchBaseRef().trim() || "HEAD",
        includeUncommitted: dispatchIncludeUncommitted(),
        ...(title ? { title } : {}),
        ...(model ? { model } : {}),
        ...(activeWorkspaceRoot() ? { sourceWorkspacePath: activeWorkspaceRoot() } : {}),
        ...(workspaceId ? { sourceWorkspaceId: workspaceId } : {}),
      });
      dispatchPrompt.set("");
      dispatchTitle.set("");
      dispatchNotice.set(tr("devices.dispatchSubmitted", { name: target.displayName }));
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
      dispatchNotice.set(tr("devices.dispatchCancelRequested"));
      await refreshDispatchJobs();
    } catch (error) {
      dispatchNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}

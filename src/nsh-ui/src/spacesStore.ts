// Spaces (MiniApps) hub state and host IPC operations.

import { computed, signal } from "nsh";
import { invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { tr } from "./i18n";
import { peerScope } from "./peerState";
import { activeWorkspace, startQuickPromptInSession } from "./state";
import { pushToast } from "./ui/overlays";

export interface SpaceMeta {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  runtimeProfile: string;
  permissions: Record<string, unknown>;
}

export interface SpaceSource {
  html: string;
  css: string;
  uiJs: string;
  workerJs: string;
}

export interface SpaceVersionEntry {
  version: string;
  label: string;
}

export interface SpaceDetail extends SpaceMeta {
  source: SpaceSource;
  originalPrompt: string;
  iterationHistory: string[];
}

export type SpaceSourceTab = "html" | "css" | "ui_js" | "worker_js";

export const spaces = signal<SpaceMeta[]>([]);
export const runningSpaceWorkers = signal<string[]>([]);
export const selectedSpaceId = signal<string | null>(null);
export const selectedSpaceDetail = signal<SpaceDetail | null>(null);
export const selectedSpaceVersions = signal<SpaceVersionEntry[]>([]);
export const spaceSourceTab = signal<SpaceSourceTab>("html");
export const spacePrompt = signal("");
export const spacesBusy = signal(false);
export const spaceInspectorBusy = signal(false);
export const spacesError = signal("");
export const spacesNotice = signal("");
export const confirmingDeleteSpaceId = signal<string | null>(null);
/** True until the first catalogue read of this scope has answered. */
export const spacesInitialLoad = signal(true);
export const spaceCreating = signal(false);

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

function normalizeSpaceMeta(raw: Record<string, unknown>): SpaceMeta {
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string" && Boolean(t))
    : [];
  const permissions =
    raw.permissions && typeof raw.permissions === "object"
      ? (raw.permissions as Record<string, unknown>)
      : {};
  return {
    id: readStr(raw, "id", "appId", "app_id"),
    name: readStr(raw, "name") || tr("spaces.untitled"),
    description: readStr(raw, "description"),
    icon: readStr(raw, "icon"),
    category: readStr(raw, "category") || "general",
    tags,
    version: readNum(raw, "version") || 1,
    createdAt: readNum(raw, "created_at", "createdAt"),
    updatedAt: readNum(raw, "updated_at", "updatedAt"),
    runtimeProfile: readStr(raw, "runtime_profile", "runtimeProfile") || "compatibility",
    permissions,
  };
}

function normalizeSpaceDetail(raw: Record<string, unknown>): SpaceDetail {
  const meta = normalizeSpaceMeta(raw);
  const srcRaw = (raw.source && typeof raw.source === "object"
    ? raw.source
    : {}) as Record<string, unknown>;
  const aiCtx = (raw.ai_context && typeof raw.ai_context === "object"
    ? raw.ai_context
    : raw.aiContext && typeof raw.aiContext === "object"
      ? raw.aiContext
      : {}) as Record<string, unknown>;
  const iterRaw = aiCtx.iteration_history ?? aiCtx.iterationHistory;
  return {
    ...meta,
    source: {
      html: readStr(srcRaw, "html"),
      css: readStr(srcRaw, "css"),
      uiJs: readStr(srcRaw, "ui_js", "uiJs"),
      workerJs: readStr(srcRaw, "worker_js", "workerJs"),
    },
    originalPrompt: readStr(aiCtx, "original_prompt", "originalPrompt"),
    iterationHistory: Array.isArray(iterRaw)
      ? iterRaw.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function normalizeVersions(raw: unknown): SpaceVersionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    if (typeof item === "number") {
      return { version: String(item), label: `v${item}` };
    }
    if (typeof item === "string") {
      return { version: item, label: item.startsWith("v") ? item : `v${item}` };
    }
    const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const ver = readStr(rec, "version", "id") || String(readNum(rec, "version") || idx + 1);
    const label = readStr(rec, "label", "summary") || (ver.startsWith("v") ? ver : `v${ver}`);
    return { version: ver, label };
  });
}

export function summarizeSpacePermissions(permissions: Record<string, unknown>): string[] {
  const badges: string[] = [];
  const fs = permissions.fs as { read?: unknown[]; write?: unknown[] } | undefined;
  if (fs && ((Array.isArray(fs.read) && fs.read.length > 0) || (Array.isArray(fs.write) && fs.write.length > 0))) {
    badges.push("Filesystem");
  }
  const shell = permissions.shell as { allow?: unknown[] } | undefined;
  if (shell && Array.isArray(shell.allow) && shell.allow.length > 0) {
    badges.push("Shell");
  }
  const net = permissions.net as { allow?: unknown[] } | undefined;
  if (net && Array.isArray(net.allow) && net.allow.length > 0) {
    badges.push("Network");
  }
  const node = permissions.node as { enabled?: boolean } | undefined;
  if (node?.enabled) {
    badges.push("Node/Bun Worker");
  }
  const ai = permissions.ai as { enabled?: boolean } | undefined;
  if (ai?.enabled) {
    badges.push("AI Bridge");
  }
  const agent = permissions.agent as { enabled?: boolean } | undefined;
  if (agent?.enabled) {
    badges.push("Agent Bridge");
  }
  return badges.length > 0 ? badges : ["Sandboxed UI"];
}

export const runningWorkerSet = computed(() => new Set(runningSpaceWorkers()));

export const selectedSpaceSourceCode = computed(() => {
  const detail = selectedSpaceDetail();
  if (!detail) return "";
  const tab = spaceSourceTab();
  if (tab === "css") return detail.source.css || `/* ${tr("spaces.noCss")} */`;
  if (tab === "ui_js") return detail.source.uiJs || `// ${tr("spaces.noUiJs")}`;
  if (tab === "worker_js") return detail.source.workerJs || `// ${tr("spaces.noWorkerJs")}`;
  return detail.source.html || `<!-- ${tr("spaces.noHtml")} -->`;
});

export function spacesPeerNotice(): string {
  const scope = peerScope();
  if (!scope) return "";
  return tr("spaces.peerNotice", { label: scope.label, hostKind: scope.hostKind });
}

export async function loadSpaces(): Promise<void> {
  spacesBusy.set(true);
  spacesError.set("");
  try {
    const [rawList, rawWorkers] = await Promise.all([
      invokeRawCommand<Array<Record<string, unknown>>>("list_miniapps", {}),
      invokeRawCommand<string[]>("miniapp_worker_list_running", {}).catch(() => [] as string[]),
    ]);
    const normalized = (Array.isArray(rawList) ? rawList : [])
      .map(item => normalizeSpaceMeta(item ?? {}))
      .filter(item => Boolean(item.id));
    spaces.set(normalized);
    runningSpaceWorkers.set(Array.isArray(rawWorkers) ? rawWorkers.filter(Boolean) : []);

    const currentId = selectedSpaceId();
    if (currentId && !normalized.some(s => s.id === currentId)) {
      selectedSpaceId.set(null);
      selectedSpaceDetail.set(null);
      selectedSpaceVersions.set([]);
    }
  } catch (error) {
    spacesError.set(error instanceof Error ? error.message : String(error));
  } finally {
    spacesBusy.set(false);
    spacesInitialLoad.set(false);
  }
}

async function refreshRunningWorkers(): Promise<void> {
  try {
    const raw = await invokeRawCommand<string[]>("miniapp_worker_list_running", {});
    runningSpaceWorkers.set(Array.isArray(raw) ? raw.filter(Boolean) : []);
  } catch {
    // An older host without the worker list keeps the last known set.
  }
}

function eventAppId(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    return readStr(rec, "id", "appId", "app_id");
  }
  return "";
}

/**
 * Follows the host's MiniApp catalogue events the way the desktop's catalogue
 * sync does: created / updated / deleted re-read the list, worker restarts and
 * stops move the running set. Returns the unsubscribe.
 */
export function subscribeSpaceEvents(): () => void {
  const offs = [
    listenEvent<unknown>("miniapp-created", () => void loadSpaces()),
    listenEvent<unknown>("miniapp-updated", () => void loadSpaces()),
    listenEvent<unknown>("miniapp-deleted", payload => {
      const id = eventAppId(payload);
      if (id) runningSpaceWorkers.update(ids => ids.filter(item => item !== id));
      void loadSpaces();
    }),
    listenEvent<unknown>("miniapp-worker-restarted", payload => {
      const id = eventAppId(payload);
      if (id) {
        runningSpaceWorkers.update(ids => (ids.includes(id) ? ids : [...ids, id]));
      } else {
        void refreshRunningWorkers();
      }
    }),
    listenEvent<unknown>("miniapp-worker-stopped", payload => {
      const id = eventAppId(payload);
      if (id) {
        runningSpaceWorkers.update(ids => ids.filter(item => item !== id));
      } else {
        void refreshRunningWorkers();
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

export async function inspectSpace(appId: string): Promise<void> {
  if (!appId) return;
  if (selectedSpaceId() !== appId) {
    spaceSourceTab.set("html");
  }
  selectedSpaceId.set(appId);
  spaceInspectorBusy.set(true);
  spacesError.set("");
  confirmingDeleteSpaceId.set(null);
  try {
    const [detailRaw, versionsRaw] = await Promise.all([
      invokeCommand<Record<string, unknown>>("get_miniapp", { appId }),
      invokeRawCommand<Array<number | Record<string, unknown>>>("get_miniapp_versions", {
        appId,
      }).catch(() => [] as Array<number | Record<string, unknown>>),
    ]);
    if (selectedSpaceId() !== appId) return;
    selectedSpaceDetail.set(normalizeSpaceDetail(detailRaw ?? {}));
    selectedSpaceVersions.set(normalizeVersions(versionsRaw));
  } catch (error) {
    if (selectedSpaceId() === appId) {
      spacesError.set(error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (selectedSpaceId() === appId) {
      spaceInspectorBusy.set(false);
    }
  }
}

export function closeSpaceInspector(): void {
  selectedSpaceId.set(null);
  selectedSpaceDetail.set(null);
  selectedSpaceVersions.set([]);
  confirmingDeleteSpaceId.set(null);
}

export async function stopSpaceWorker(appId: string): Promise<void> {
  if (!appId) return;
  spacesBusy.set(true);
  spacesError.set("");
  spacesNotice.set("");
  try {
    await invokeRawCommand<unknown>("miniapp_worker_stop", { appId });
    runningSpaceWorkers.update(ids => ids.filter(id => id !== appId));
    const refreshed = await invokeRawCommand<string[]>("miniapp_worker_list_running", {}).catch(
      () => runningSpaceWorkers(),
    );
    runningSpaceWorkers.set(Array.isArray(refreshed) ? refreshed : []);
    const name = spaces().find(item => item.id === appId)?.name ?? appId;
    const msg = tr("spaces.workerStopped", { name });
    spacesNotice.set(msg);
    pushToast(msg, "success");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    spacesError.set(errMsg);
    pushToast(errMsg, "error");
  } finally {
    spacesBusy.set(false);
  }
}

export function requestDeleteSpace(appId: string): void {
  confirmingDeleteSpaceId.set(appId);
}

export function cancelDeleteSpace(): void {
  confirmingDeleteSpaceId.set(null);
}

export async function confirmDeleteSpace(appId: string): Promise<void> {
  if (!appId) return;
  spacesBusy.set(true);
  spacesError.set("");
  spacesNotice.set("");
  try {
    await invokeRawCommand<unknown>("delete_miniapp", { appId });
    confirmingDeleteSpaceId.set(null);
    spaces.update(list => list.filter(s => s.id !== appId));
    runningSpaceWorkers.update(ids => ids.filter(id => id !== appId));
    if (selectedSpaceId() === appId) {
      selectedSpaceId.set(null);
      selectedSpaceDetail.set(null);
      selectedSpaceVersions.set([]);
    }
    spacesNotice.set(tr("spaces.deleted"));
    pushToast(tr("spaces.deleted"), "success");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    spacesError.set(errMsg);
    pushToast(errMsg, "error");
  } finally {
    spacesBusy.set(false);
  }
}

/**
 * Why "Create with Agent" cannot start here, or "" when it can. The desktop
 * starts MiniApp creation as a Creative session in the active workspace and
 * refuses without a workspace or on a remote one (the Creative toolchain
 * writes MiniApp bundles on this machine).
 */
export function spaceCreationBlockedReason(): string {
  const workspace = activeWorkspace();
  if (!workspace) return tr("spaces.createNoWorkspace");
  if (workspace.workspaceKind === "remote") return tr("spaces.createRemoteUnsupported");
  return "";
}

export async function createSpaceWithAgent(): Promise<void> {
  const prompt = spacePrompt().trim();
  if (spaceCreating()) return;
  const blocked = spaceCreationBlockedReason();
  if (blocked) {
    spacesError.set(blocked);
    pushToast(blocked, "error");
    return;
  }
  spaceCreating.set(true);
  spacesError.set("");
  try {
    await startQuickPromptInSession(prompt ? tr("spaces.createPrompt", { prompt }) : "", "Creative");
    spacePrompt.set("");
    pushToast(tr("spaces.createStarted"), "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spacesError.set(tr("spaces.createFailed", { error: message }));
    pushToast(tr("spaces.createFailed", { error: message }), "error");
  } finally {
    spaceCreating.set(false);
  }
}

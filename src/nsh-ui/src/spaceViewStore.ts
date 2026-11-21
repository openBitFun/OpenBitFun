// Spaces everywhere (wave 22, P4; tauri-gap §1.4, §4.3): the account's
// MiniApp list, the Space page that opens an app inside the app on every
// client, and its versions, customization drafts, grants and the agent's
// "operate this Space" requests.
//
// Placement facts come from the backend: `miniapp_account_catalog` answers the
// account's apps with the devices each is installed on (the account replica;
// no server keeps it). A Space opens on a device that has it, by default the
// device in context, and every call of its frame runs there
// (`miniapp_inline`, `spaceFrame.ts`). Versions, drafts, storage and grants
// stay on that device.

import { computed, Clipboard, openUrl, signal } from "nsh";
import { invokeCommand, invokeRawCommand, listenEvent, windowShellId } from "./bridge";
import { fleetActive, entryDeviceId } from "./bridge";
import { tr } from "./i18n";
import { activeWorkspace, deviceContext, openLibrary } from "./state";
import { resolvedScheme } from "./theme";
import { pushToast } from "./ui/overlays";
import { SpaceFrameSession, spaceDeliverScript } from "./spaceFrame";
import { spacesView } from "./miniAppMarketStore";

export interface CatalogDevice {
  deviceId: string;
  version: number;
  updatedAt: number;
}

export interface CatalogApp {
  appId: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: number;
  updatedAt: number;
  runtimeProfile: string;
  needsDevice: boolean;
  installedHere: boolean;
  devices: CatalogDevice[];
}

export interface AccountCatalog {
  scope: "account" | "device";
  thisDevice: string;
  apps: CatalogApp[];
}

/** The catalog of the device in context; `null` until read or on an older host. */
export const accountCatalog = signal<AccountCatalog | null>(null);
/** The device in context does not know `miniapp_account_catalog` (older build). */
export const accountCatalogUnsupported = signal(false);

/** Apps of the account installed only on other devices (the backend's flag). */
export const spacesElsewhere = computed<CatalogApp[]>(() => (accountCatalog()?.apps ?? []).filter(app => !app.installedHere));

function unknownCommand(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown (command|action)|not (a )?registered|unsupported command|no handler/i.test(message);
}

export async function loadAccountCatalog(): Promise<void> {
  try {
    const answer = await invokeCommand<AccountCatalog>("miniapp_account_catalog", {});
    accountCatalog.set(answer && Array.isArray(answer.apps) ? answer : null);
    accountCatalogUnsupported.set(false);
  } catch (error) {
    accountCatalog.set(null);
    accountCatalogUnsupported.set(unknownCommand(error));
  }
}

// The Space page

export interface OpenSpace {
  appId: string;
  name: string;
  /** The device the Space runs on (`""` without the fleet layer). */
  deviceId: string;
  /** Devices that have it, newest first (the catalog's order). */
  devices: string[];
  needsDevice: boolean;
  workspacePath: string | null;
}

export const openSpace = signal<OpenSpace | null>(null);
export const spaceSession = signal<SpaceFrameSession | null>(null);
/** The mounted frame's delivery function (set by `MiniAppFrame`). */
let frameDeliver: ((script: string) => void) | null = null;
const pendingDeliveries: string[] = [];

export function attachFrame(deliver: ((script: string) => void) | null): void {
  frameDeliver = deliver;
  if (deliver) for (const script of pendingDeliveries.splice(0)) deliver(script);
}

function deliver(message: unknown): void {
  const script = spaceDeliverScript(message);
  if (frameDeliver) frameDeliver(script);
  else if (pendingDeliveries.length < 64) pendingDeliveries.push(script);
}

function route(deviceId: string): { target: string } | undefined {
  return deviceId ? { target: deviceId } : undefined;
}

/**
 * Why a Space cannot open here, or "". Its worker, storage and grants run on
 * its device, so a remote workspace (whose files live elsewhere) is refused by
 * the backend; the page says so before asking.
 */
export function spaceOpenBlockedReason(): string {
  if ((activeWorkspace()?.workspaceKind ?? "").toLowerCase() === "remote") return tr("spaces.p4.remoteWorkspace");
  return "";
}

function workspaceForDevice(deviceId: string): string | null {
  const workspace = activeWorkspace();
  if (!workspace || (workspace.workspaceKind ?? "").toLowerCase() === "remote") return null;
  // A workspace path is a fact of its device; never hand it to another one.
  if (fleetActive() && deviceId && deviceId !== deviceContext()) return null;
  return workspace.rootPath || null;
}

/** Opens a Space inside the app, on `deviceId` (default: the device in context). */
export function openSpacePage(input: {
  appId: string;
  name: string;
  deviceId?: string;
  devices?: string[];
  needsDevice?: boolean;
}): SpaceFrameSession {
  const deviceId = input.deviceId ?? deviceContext();
  const current = openSpace();
  const existing = spaceSession();
  if (existing && current && current.appId === input.appId && current.deviceId === deviceId && existing.status() !== "closed") {
    return existing;
  }
  closeSpacePage();
  const devices = input.devices && input.devices.length > 0 ? input.devices : deviceId ? [deviceId] : [];
  const workspacePath = workspaceForDevice(deviceId);
  openSpace.set({
    appId: input.appId,
    name: input.name,
    deviceId,
    devices,
    needsDevice: input.needsDevice === true,
    workspacePath,
  });
  const session = new SpaceFrameSession(input.appId, workspacePath, {
    invoke: (method, params) => invokeCommand<unknown>("miniapp_inline", { method, params }, route(deviceId)),
    deliver,
    openUrl: url => void openUrl(url).catch(() => undefined),
    writeClipboard: text => void Clipboard.writeText(text).catch(() => undefined),
  });
  spaceSession.set(session);
  void session.open(resolvedScheme());
  void loadSpaceVersions();
  return session;
}

/** Runs the open Space on another device that has it. */
export function moveSpaceTo(deviceId: string): void {
  const current = openSpace();
  if (!current || current.deviceId === deviceId) return;
  openSpacePage({ ...current, deviceId });
}

export function closeSpacePage(): void {
  const session = spaceSession();
  spaceSession.set(null);
  openSpace.set(null);
  attachFrame(null);
  pendingDeliveries.length = 0;
  spaceVersions.set([]);
  spaceSheet.set(null);
  spaceDraft.set(null);
  spaceDraftDiff.set(null);
  if (session) void session.close();
}

/** Reopens the frame after it moved away or failed. */
export function reopenSpace(): void {
  const current = openSpace();
  if (!current) return;
  spaceSession.set(null);
  openSpacePage(current);
}

/** "Open in window" on a desktop over its own backend (the MiniApp Shell). */
export function spaceWindowAvailable(): boolean {
  const shell = windowShellId();
  if (shell !== "nsh-desktop" && shell !== "host-page") return false;
  const space = openSpace();
  if (!space) return false;
  return !fleetActive() || !space.deviceId || space.deviceId === entryDeviceId();
}

// Sheets on the Space page

export type SpaceSheet = "versions" | "customize" | "permissions";
export const spaceSheet = signal<SpaceSheet | null>(null);
export const spaceSheetBusy = signal(false);
export const spaceSheetError = signal("");

function failSheet(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  spaceSheetError.set(message);
}

export function openSpaceSheet(sheet: SpaceSheet): void {
  spaceSheetError.set("");
  spaceSheet.set(sheet);
}

/** Versions the device keeps for the open Space, newest first. */
export const spaceVersions = signal<number[]>([]);

export async function loadSpaceVersions(): Promise<void> {
  const space = openSpace();
  if (!space) return;
  try {
    const raw = await invokeRawCommand<unknown[]>("get_miniapp_versions", { appId: space.appId }, route(space.deviceId));
    if (openSpace()?.appId !== space.appId) return;
    const versions = (Array.isArray(raw) ? raw : [])
      .map(item => (typeof item === "number" ? item : Number((item as Record<string, unknown>)?.version)))
      .filter(value => Number.isFinite(value));
    spaceVersions.set(versions);
  } catch {
    spaceVersions.set([]);
  }
}

export async function rollbackSpace(version: number): Promise<void> {
  const space = openSpace();
  if (!space || spaceSheetBusy()) return;
  spaceSheetBusy.set(true);
  spaceSheetError.set("");
  try {
    await invokeRawCommand<unknown>("rollback_miniapp", { appId: space.appId, version }, route(space.deviceId));
    spaceSheet.set(null);
    pushToast(tr("spaces.p4.rolledBack", { version }), "success");
    void loadSpaceVersions();
  } catch (error) {
    failSheet(error);
  } finally {
    spaceSheetBusy.set(false);
  }
}

/** Grants the Space the workspace it runs in, on its device. */
export async function grantSpaceWorkspace(): Promise<void> {
  const space = openSpace();
  if (!space || spaceSheetBusy()) return;
  spaceSheetBusy.set(true);
  spaceSheetError.set("");
  try {
    await invokeRawCommand<unknown>("grant_miniapp_workspace", { appId: space.appId }, route(space.deviceId));
    pushToast(tr("spaces.p4.workspaceGranted"), "success");
  } catch (error) {
    failSheet(error);
  } finally {
    spaceSheetBusy.set(false);
  }
}

// Customization drafts

export interface SpaceDraft {
  draftId: string;
  sourceVersion: number;
  status: string;
  draftRoot: string;
}

export interface SpacePermissionDiff {
  highRisk: boolean;
  added: string[];
  expanded: string[];
  removed: string[];
}

export const spaceDraft = signal<SpaceDraft | null>(null);
export const spaceDraftDiff = signal<SpacePermissionDiff | null>(null);

function readDraft(raw: Record<string, unknown> | null): SpaceDraft | null {
  if (!raw) return null;
  const draftId = String(raw.draft_id ?? raw.draftId ?? "");
  if (!draftId) return null;
  return {
    draftId,
    sourceVersion: Number(raw.source_version ?? raw.sourceVersion ?? 0),
    status: String(raw.status ?? ""),
    draftRoot: String(raw.draft_root ?? raw.draftRoot ?? ""),
  };
}

function readDiff(raw: Record<string, unknown> | null): SpacePermissionDiff {
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  return {
    highRisk: raw?.high_risk === true || raw?.highRisk === true,
    added: list(raw?.added),
    expanded: list(raw?.expanded),
    removed: list(raw?.removed),
  };
}

function draftRequest(): Record<string, unknown> | null {
  const space = openSpace();
  const draft = spaceDraft();
  if (!space || !draft) return null;
  return { appId: space.appId, draftId: draft.draftId, workspacePath: space.workspacePath, appearanceMode: resolvedScheme() };
}

/** Starts a customization draft (a copy the agent or the user edits). */
export async function startSpaceDraft(): Promise<void> {
  const space = openSpace();
  if (!space || spaceSheetBusy()) return;
  spaceSheetBusy.set(true);
  spaceSheetError.set("");
  spaceDraftDiff.set(null);
  try {
    const raw = await invokeCommand<Record<string, unknown>>(
      "miniapp_create_draft",
      { appId: space.appId, workspacePath: space.workspacePath, appearanceMode: resolvedScheme() },
      route(space.deviceId),
    );
    spaceDraft.set(readDraft(raw));
  } catch (error) {
    failSheet(error);
  } finally {
    spaceSheetBusy.set(false);
  }
}

/** Reads the draft's edits from disk and the permission change applying it makes. */
export async function reviewSpaceDraft(): Promise<void> {
  const request = draftRequest();
  const space = openSpace();
  if (!request || !space || spaceSheetBusy()) return;
  spaceSheetBusy.set(true);
  spaceSheetError.set("");
  try {
    const synced = await invokeCommand<Record<string, unknown>>("miniapp_sync_draft_from_fs", request, route(space.deviceId));
    spaceDraft.set(readDraft(synced) ?? spaceDraft());
    const diff = await invokeCommand<Record<string, unknown>>("miniapp_permission_diff_for_draft", request, route(space.deviceId));
    spaceDraftDiff.set(readDiff(diff));
  } catch (error) {
    failSheet(error);
  } finally {
    spaceSheetBusy.set(false);
  }
}

/** Applies the reviewed draft (only after its permission change was shown). */
export async function applySpaceDraft(): Promise<void> {
  const request = draftRequest();
  const space = openSpace();
  if (!request || !space || !spaceDraftDiff() || spaceSheetBusy()) return;
  spaceSheetBusy.set(true);
  spaceSheetError.set("");
  try {
    await invokeCommand<unknown>("miniapp_apply_draft", request, route(space.deviceId));
    spaceDraft.set(null);
    spaceDraftDiff.set(null);
    spaceSheet.set(null);
    pushToast(tr("spaces.p4.draftApplied"), "success");
    void loadSpaceVersions();
  } catch (error) {
    failSheet(error);
  } finally {
    spaceSheetBusy.set(false);
  }
}

export async function discardSpaceDraft(): Promise<void> {
  const request = draftRequest();
  const space = openSpace();
  if (!request || !space || spaceSheetBusy()) return;
  spaceSheetBusy.set(true);
  spaceSheetError.set("");
  try {
    await invokeCommand<unknown>("miniapp_discard_draft", request, route(space.deviceId));
    spaceDraft.set(null);
    spaceDraftDiff.set(null);
  } catch (error) {
    failSheet(error);
  } finally {
    spaceSheetBusy.set(false);
  }
}

// The agent's "operate this Space" requests (desktop over its own backend)

/** What the agent asked for that only this window could answer. */
export interface SpaceAgentRequest {
  requestId: string;
  action: "open" | "execute";
  appId: string;
  name: string;
  at: number;
  outcome: "pending" | "answered" | "refused";
  detail?: string;
}

export const spaceAgentRequests = signal<SpaceAgentRequest[]>([]);
const AGENT_REQUEST_LIMIT = 20;
const AGENT_OPEN_WAIT_MS = 20_000;

function noteAgentRequest(entry: SpaceAgentRequest): void {
  spaceAgentRequests.update(list => [entry, ...list.filter(item => item.requestId !== entry.requestId)].slice(0, AGENT_REQUEST_LIMIT));
}

async function reportAgent(requestId: string, success: boolean, result: unknown, error?: string): Promise<void> {
  spaceAgentRequests.update(list =>
    list.map(item => (item.requestId === requestId ? { ...item, outcome: success ? "answered" : "refused", detail: error } : item)),
  );
  await invokeCommand<unknown>(
    "report_miniapp_web_result",
    { requestId, success, result: success ? result : null, error: success ? null : error },
  ).catch(() => undefined);
}

function waitForReady(session: SpaceFrameSession, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const started = Date.now();
    const tick = () => {
      const status = session.status();
      if (status === "ready" && (session.agentReady() || Date.now() - started > 3000)) return resolve(true);
      if (status === "failed" || status === "closed" || status === "released" || status === "replaced") return resolve(false);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function handleAgentRequest(payload: Record<string, any>): Promise<void> {
  const requestId = String(payload?.requestId ?? "");
  const action = payload?.action === "open" ? "open" : "execute";
  if (!requestId) return;
  const appId = String(payload?.appId ?? payload?.command?.appId ?? payload?.command?.app_id ?? "");
  const name = String(payload?.name ?? appId);
  noteAgentRequest({ requestId, action, appId, name, at: Date.now(), outcome: "pending" });
  if (action !== "open" || !appId) {
    // A bound in-product view answers through its Shell bridge; reaching the
    // UI here means no Space view is mounted for this command.
    await reportAgent(requestId, false, null, "SURFACE_UNAVAILABLE: open the Space first; the in-product view answers through its agent bridge");
    return;
  }
  openLibrary("spaces");
  spacesView.set("library");
  const session = openSpacePage({ appId, name, deviceId: fleetActive() ? (entryDeviceId() ?? "") : "" });
  const ready = await waitForReady(session, AGENT_OPEN_WAIT_MS);
  const boot = session.bootstrap();
  if (!ready || !boot) {
    await reportAgent(requestId, false, null, `SURFACE_UNAVAILABLE: ${session.error() || "the Space did not open in time"}`);
    return;
  }
  await reportAgent(requestId, true, {
    appId,
    instanceId: boot.instanceId,
    strictRuntime: boot.strictRuntime,
    width: null,
    height: null,
    capabilities: [],
    bridgeCapabilities: [],
    declaredActions: [],
    presentation: "window",
  });
}

/**
 * The agent's MiniApp surface on a desktop over its own backend: answers
 * `agentic://miniapp-web-request` by opening the Space inside the app. Its
 * requests then reach the frame through the Shell bridge. Phones, browsers and
 * a desktop driving another device never attach (the backend reports the
 * surface unavailable there).
 */
export function installSpaceAgentSurface(): () => void {
  const shell = windowShellId();
  if (shell !== "nsh-desktop") return () => undefined;
  const off = listenEvent<Record<string, any>>("agentic://miniapp-web-request", payload => void handleAgentRequest(payload));
  void invokeCommand<unknown>("mark_miniapp_web_surface_ready", { ready: true }).catch(() => undefined);
  return () => {
    off();
    void invokeCommand<unknown>("mark_miniapp_web_surface_ready", { ready: false }).catch(() => undefined);
  };
}

// Workspace actions (ux-redesign §3.6: a workspace row in All sessions › By
// device): the ⋯ menu that replaced the old sidebar's workspace menu, and the
// rename and assistant reset/delete dialogs it opens.
//
// Display only: each action is one backend command for the workspace's own
// device. A workspace of the device whose workspace list is loaded here (a
// backend without the fleet layer, or the current device context) keeps the
// `state.ts` / `sshRemoteStore.ts` actions so the open lists update in place;
// a workspace of another device is reached with an explicit `fleet_call`
// target and the navigator is read again. File-manager and SSH-connection
// actions belong to the machine this window runs on and say so elsewhere.

import { Clipboard, signal, Text, View, type JSX } from "nsh";
import { revealInExplorer, type WorkspaceRecord } from "../api";
import { fleetActive, invokeCommand, invokeRawCommand, listenEvent, pickLocalDirectory, windowShellId } from "../bridge";
import { controllerPort } from "../controller/controllerPort";
import { fleetDeviceById, refreshFleetNavigator } from "../fleetStore";
import { formatBytes } from "../format";
import { localizeHostError, tr } from "../i18n";
import {
  closeWorkspaceRecord,
  connectionStatuses,
  disconnectSsh,
  openPortForwardModal,
  openRemoteFileBrowser,
  openSshConnectionModal,
} from "../sshRemoteStore";
import {
  closeWorkspace,
  deviceContext,
  loadWorkspaces,
  navigateScene,
  renameWorkspace,
  selectWorkspace,
  workspaces,
} from "../state";
import { openTerminal } from "../terminalStore";
import {
  compactLayout,
  fontMono,
  layout,
  palette,
  radii,
  space,
  textStyle,
  touchSlop,
} from "../theme";
import { Icon, type IconName } from "./icons";
import { pressTransition, tactileActiveStyle } from "./motion";
import { sessionIsOnThisMachine } from "./sessionActions";
import { ModalDialog, pushToast, type DropdownMenuItem } from "./overlays";
import { Button, focusRingStyle, IconButton, InlineBanner, SkeletonBlock, TextField } from "./primitives";

/** A workspace anywhere on the account. `deviceId` is `""` on a backend without the fleet layer. */
export interface WorkspaceActionTarget {
  workspaceId: string;
  deviceId: string;
  name: string;
  /** POSIX for remote roots; never split with host path rules. */
  rootPath: string;
  kind?: string;
  sshHost?: string;
}

const renameTarget = signal<WorkspaceActionTarget | null>(null);
const renameDraft = signal("");
const renameBusy = signal(false);
const renameError = signal("");
const assistantTarget = signal<(WorkspaceActionTarget & { action: "reset" | "delete" }) | null>(null);
const assistantBusy = signal(false);

function errorText(error: unknown): string {
  return localizeHostError(error instanceof Error ? error.message : String(error ?? ""));
}

function isAssistant(target: WorkspaceActionTarget): boolean {
  return (target.kind ?? "").toLowerCase().includes("assistant");
}

function isRemoteKind(kind: string | undefined, record?: WorkspaceRecord): boolean {
  const value = (kind ?? record?.workspaceKind ?? "").toLowerCase();
  if (value.includes("assistant")) return false;
  return Boolean(
    record?.connectionId?.trim() ||
      value === "remote" ||
      value.includes("ssh") ||
      value.includes("remote") ||
      value.includes("docker") ||
      value.includes("container") ||
      value.includes("wsl"),
  );
}

/** The loaded record of a workspace of the current device context (or the only backend), else `undefined`. */
function loadedRecord(target: WorkspaceActionTarget): WorkspaceRecord | undefined {
  if (fleetActive() && target.deviceId !== deviceContext()) return undefined;
  return workspaces().find(item => item.id === target.workspaceId);
}

function routeOptions(target: WorkspaceActionTarget): { target: string } | undefined {
  return fleetActive() && target.deviceId ? { target: target.deviceId } : undefined;
}

function focus(target: WorkspaceActionTarget): void {
  selectWorkspace(target.workspaceId, fleetActive() ? { deviceId: target.deviceId } : undefined);
}

async function copyPath(path: string): Promise<void> {
  try {
    await Clipboard.writeText(path);
    pushToast(tr("shell.ws.pathCopied"), "success");
  } catch (error) {
    pushToast(tr("shell.ws.copyPathFailed", { error: errorText(error) }), "error");
  }
}

async function reveal(target: WorkspaceActionTarget): Promise<void> {
  try {
    await revealInExplorer(target.rootPath, target.workspaceId);
  } catch (error) {
    pushToast(tr("shell.ws.revealFailed", { error: errorText(error) }), "error");
  }
}

async function rename(target: WorkspaceActionTarget, name: string): Promise<boolean> {
  const next = name.trim();
  if (!next || next === target.name) return true;
  renameBusy.set(true);
  renameError.set("");
  try {
    if (loadedRecord(target)) {
      await renameWorkspace(target.workspaceId, next);
    } else {
      await invokeCommand<unknown>("update_workspace_info", { workspaceId: target.workspaceId, name: next }, routeOptions(target));
    }
    if (fleetActive()) void refreshFleetNavigator();
    return true;
  } catch (error) {
    const message = errorText(error);
    renameError.set(message);
    pushToast(message, "error");
    return false;
  } finally {
    renameBusy.set(false);
  }
}

async function close(target: WorkspaceActionTarget): Promise<void> {
  try {
    const record = loadedRecord(target);
    if (record?.connectionId) {
      await closeWorkspaceRecord(target.workspaceId);
    } else if (record) {
      await closeWorkspace(target.workspaceId);
    } else {
      await invokeCommand<unknown>("close_workspace", { workspaceId: target.workspaceId }, routeOptions(target));
    }
    if (fleetActive()) void refreshFleetNavigator();
  } catch (error) {
    pushToast(errorText(error), "error");
  }
}

async function runAssistantAction(): Promise<void> {
  const target = assistantTarget();
  if (!target || assistantBusy()) return;
  assistantBusy.set(true);
  try {
    const command = target.action === "reset" ? "reset_assistant_workspace" : "delete_assistant_workspace";
    await invokeCommand<unknown>(command, { workspaceId: target.workspaceId }, routeOptions(target));
    pushToast(
      target.action === "reset"
        ? tr("shell.ws.assistantReset", { name: target.name })
        : tr("shell.ws.assistantDeleted", { name: target.name }),
      "success",
    );
    assistantTarget.set(null);
    if (fleetActive()) void refreshFleetNavigator();
    else await loadWorkspaces();
  } catch (error) {
    pushToast(errorText(error), "error");
  } finally {
    assistantBusy.set(false);
  }
}

/**
 * The workspace ⋯ menu: start work here, then rename and the path, then the
 * SSH connection (workspaces of this machine's SSH connections), the assistant
 * reset/delete, and Close last.
 */
export function workspaceMenuItems(
  target: WorkspaceActionTarget,
  options: { onNewSession: () => void },
): DropdownMenuItem[] {
  const key = target.workspaceId;
  const record = loadedRecord(target);
  const remote = isRemoteKind(target.kind, record);
  const local = sessionIsOnThisMachine(target) && !remote;
  const assistant = isAssistant(target);
  const items: DropdownMenuItem[] = [
    {
      id: `workspace-new-session-${key}`,
      label: tr("workspace.newSession"),
      icon: "plus",
      accessibilityLabel: `workspace-menu-new-session-${key}`,
      onSelect: options.onNewSession,
    },
    {
      id: `workspace-new-terminal-${key}`,
      label: tr("shell.ws.newTerminal"),
      icon: "terminal-square",
      accessibilityLabel: `workspace-menu-new-terminal-${key}`,
      onSelect: () => {
        focus(target);
        navigateScene("terminal");
        void openTerminal(target.workspaceId, target.rootPath);
      },
    },
    {
      id: `workspace-open-files-${key}`,
      label: tr("shell.ws.openFiles"),
      icon: "folder-open",
      accessibilityLabel: `workspace-menu-open-files-${key}`,
      onSelect: () => {
        focus(target);
        navigateScene("files");
      },
    },
    {
      id: `workspace-rename-${key}`,
      label: tr("common.renameEllipsis"),
      icon: "edit",
      separator: true,
      accessibilityLabel: `workspace-menu-rename-${key}`,
      onSelect: () => {
        renameDraft.set(target.name);
        renameError.set("");
        renameTarget.set(target);
      },
    },
    {
      id: `workspace-copy-path-${key}`,
      label: tr("shell.ws.copyPath"),
      icon: "copy",
      accessibilityLabel: `workspace-menu-copy-path-${key}`,
      onSelect: () => void copyPath(target.rootPath),
    },
    {
      id: `workspace-reveal-${key}`,
      label: tr("workspace.reveal"),
      icon: "external-link",
      disabled: !local,
      hint: local ? undefined : tr("workspace.revealOnlyHere"),
      accessibilityLabel: `workspace-menu-reveal-${key}`,
      onSelect: () => void reveal(target),
    },
  ];
  const connectionId = record?.connectionId;
  if (connectionId) {
    const host = (record?.sshHost ?? target.sshHost ?? "").trim() || undefined;
    const connected = connectionStatuses()[connectionId] === "connected";
    items.push(
      {
        id: `workspace-remote-browse-${key}`,
        label: tr("nav.browseRemoteFiles"),
        icon: "folder",
        separator: true,
        accessibilityLabel: `workspace-menu-remote-browse-${key}`,
        onSelect: () =>
          void openRemoteFileBrowser(connectionId, target.rootPath, { connectionName: target.name, sshHost: host }),
      },
      {
        id: `workspace-port-forward-${key}`,
        label: tr("nav.portForwardingEllipsis"),
        icon: "network",
        accessibilityLabel: `workspace-menu-port-forward-${key}`,
        onSelect: () => void openPortForwardModal(connectionId, host ?? target.name),
      },
      {
        id: `workspace-ssh-${key}`,
        label: connected ? tr("nav.disconnectSsh") : tr("nav.manageSshConnection"),
        icon: "server",
        accessibilityLabel: `workspace-menu-ssh-${key}`,
        onSelect: () => {
          if (connected) void disconnectSsh(connectionId);
          else void openSshConnectionModal(connectionId);
        },
      },
    );
  }
  // wave22-p5: the workspace icon (any workspace, on its own device) and file
  // transfer for an SSH workspace of this machine (the local side is a path here).
  items.push({
    id: `workspace-icon-${key}`,
    label: tr("workspaceIcon.menu"),
    icon: "palette",
    separator: true,
    accessibilityLabel: `workspace-menu-icon-${key}`,
    onSelect: () => void openWorkspaceIcon(target),
  });
  if (connectionId && transferAvailableHere(target)) {
    items.push(
      {
        id: `workspace-upload-${key}`,
        label: tr("transfer.uploadMenu"),
        icon: "upload",
        accessibilityLabel: `workspace-menu-upload-${key}`,
        onSelect: () => openTransfer(target, connectionId, "upload"),
      },
      {
        id: `workspace-download-${key}`,
        label: tr("transfer.downloadMenu"),
        icon: "download",
        accessibilityLabel: `workspace-menu-download-${key}`,
        onSelect: () => openTransfer(target, connectionId, "download"),
      },
    );
  }
  if (assistant) {
    items.push(
      {
        id: `workspace-reset-assistant-${key}`,
        label: tr("shell.ws.resetAssistant"),
        icon: "undo",
        separator: true,
        accessibilityLabel: `workspace-menu-reset-assistant-${key}`,
        onSelect: () => assistantTarget.set({ ...target, action: "reset" }),
      },
      {
        id: `workspace-delete-assistant-${key}`,
        label: tr("shell.ws.deleteAssistant"),
        icon: "trash",
        danger: true,
        accessibilityLabel: `workspace-menu-delete-assistant-${key}`,
        onSelect: () => assistantTarget.set({ ...target, action: "delete" }),
      },
    );
  }
  items.push({
    id: `workspace-close-${key}`,
    label: tr("nav.closeWorkspace"),
    icon: "close",
    danger: !assistant,
    separator: !assistant,
    accessibilityLabel: `workspace-menu-close-${key}`,
    onSelect: () => void close(target),
  });
  return items;
}

/** Rename and assistant reset/delete confirmations; mounted once by the shell. */
export function WorkspaceActionDialogs(): JSX.Element {
  const submitRename = async () => {
    const target = renameTarget();
    if (!target || renameBusy()) return;
    const next = renameDraft().trim();
    if (!next) return;
    if (next === target.name) {
      renameTarget.set(null);
      return;
    }
    const ok = await rename(target, next);
    if (ok && renameTarget()?.workspaceId === target.workspaceId) {
      renameTarget.set(null);
    }
  };
  return (
    <>
      <ModalDialog
        open={Boolean(renameTarget())}
        title={tr("shell.ws.renameTitle")}
        size="sm"
        accessibilityLabel="workspace-rename-modal"
        onClose={() => {
          if (!renameBusy()) renameTarget.set(null);
        }}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="md"
              disabled={renameBusy()}
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => renameTarget.set(null)}
            />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="md"
              loading={renameBusy()}
              disabled={renameBusy() || !renameDraft().trim()}
              accessibilityLabel="workspace-rename-save"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => void submitRename()}
            />
          </View>
        }
      >
        <View style={{ gap: space.sm }}>
          <TextField
            autoFocus
            label={tr("shell.ws.nameLabel")}
            value={renameDraft()}
            disabled={renameBusy()}
            accessibilityLabel="workspace-rename-input"
            onChange={value => {
              renameDraft.set(value);
              if (renameError()) renameError.set("");
            }}
            onSubmit={() => void submitRename()}
          />
          <If when={renameError()}>
            {err => <InlineBanner tone="danger" message={err()} />}
          </If>
        </View>
      </ModalDialog>
      <ModalDialog
        open={Boolean(assistantTarget())}
        title={
          assistantTarget()?.action === "delete"
            ? tr("shell.ws.deleteAssistantTitle", { name: assistantTarget()?.name ?? "" })
            : tr("shell.ws.resetAssistantTitle", { name: assistantTarget()?.name ?? "" })
        }
        size="sm"
        accessibilityLabel="assistant-action-modal"
        onClose={() => {
          if (!assistantBusy()) assistantTarget.set(null);
        }}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("common.cancel")}
              variant="secondary"
              size="md"
              disabled={assistantBusy()}
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => assistantTarget.set(null)}
            />
            <Button
              label={assistantTarget()?.action === "delete" ? tr("common.delete") : tr("shell.ws.resetConfirm")}
              variant="danger"
              size="md"
              loading={assistantBusy()}
              disabled={assistantBusy()}
              accessibilityLabel="assistant-action-confirm"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => void runAssistantAction()}
            />
          </View>
        }
      >
        <View style={{ gap: space.sm }}>
          <Text style={textStyle("body", { color: palette().textSecondary })}>
            {assistantTarget()?.action === "delete"
              ? tr("shell.ws.deleteAssistantMessage")
              : tr("shell.ws.resetAssistantMessage")}
          </Text>
          <Text
            style={{
              ...textStyle("mono", { color: palette().textMuted }),
              fontFamily: fontMono,
              numberOfLines: 2,
              textOverflow: "ellipsis-middle",
            }}
          >
            {assistantTarget()?.rootPath ?? ""}
          </Text>
        </View>
      </ModalDialog>
      <WorkspaceIconDialog />
      <TransferDialog />
    </>
  );
}

// ── wave22-p5: workspace icon ─────────────────────────────────────────────────
//
// The icon is the workspace's own record on its device: `get_workspace_icon`
// answers it with the glyphs that host offers (`supportedGlyphs`, an additive
// capability), and `set_workspace_icon` stores a choice against the revision
// read. Colors are not offered: state is the only color in this UI, so a
// choice keeps the color the record already has.

interface WorkspaceIconView {
  revision: number;
  color: string;
  glyph: string;
  supportedGlyphs: string[];
}

const iconTarget = signal<WorkspaceActionTarget | null>(null);
const iconView = signal<WorkspaceIconView | null>(null);
const iconChoice = signal("");
const iconBusy = signal(false);
const iconNotice = signal("");

/** A glyph id (the host's stable project categories) as the icon this UI draws for it. */
const GLYPH_ICONS: Record<string, IconName> = {
  default: "folder",
  code: "code",
  learning: "bulb",
  design: "palette",
  documents: "file-text",
  research: "search",
  web: "globe",
  mobile: "smartphone",
  games: "star",
  data: "database",
  business: "bar-chart",
  tools: "wrench",
  travel: "compass",
  food: "flame",
  fitness: "activity",
  music: "waveform",
  reading: "notes",
  home: "home",
  finance: "hash",
  photography: "image",
  pets: "sparkles",
  nature: "sun",
  shopping: "package",
  movies: "play",
};

export function workspaceGlyphIcon(glyph: string | undefined | null): IconName {
  return GLYPH_ICONS[glyph ?? ""] ?? "folder";
}

function readIconSnapshot(raw: unknown): WorkspaceIconView | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const icon = (value.icon ?? {}) as Record<string, unknown>;
  return {
    revision: typeof icon.revision === "number" ? icon.revision : 0,
    color: typeof icon.color === "string" && icon.color ? icon.color : "default",
    glyph: typeof icon.glyph === "string" && icon.glyph ? icon.glyph : "default",
    supportedGlyphs: Array.isArray(value.supportedGlyphs) ? value.supportedGlyphs.map(String) : [],
  };
}

async function readIcon(target: WorkspaceActionTarget): Promise<void> {
  const answer = await invokeCommand<unknown>(
    "get_workspace_icon",
    { workspaceId: target.workspaceId },
    routeOptions(target),
  );
  const view = readIconSnapshot(answer);
  iconView.set(view);
  iconChoice.set(view?.glyph ?? "default");
}

export async function openWorkspaceIcon(target: WorkspaceActionTarget): Promise<void> {
  iconTarget.set(target);
  iconView.set(null);
  iconNotice.set("");
  try {
    await readIcon(target);
  } catch (error) {
    iconNotice.set(errorText(error));
  }
}

function newRequestId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  return typeof random === "function" ? random() : `icon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function saveWorkspaceIcon(): Promise<void> {
  const target = iconTarget();
  const view = iconView();
  if (!target || !view || iconBusy()) return;
  iconBusy.set(true);
  try {
    await invokeCommand<unknown>(
      "set_workspace_icon",
      {
        workspaceId: target.workspaceId,
        expectedRevision: view.revision,
        requestId: newRequestId(),
        icon: { kind: "default", color: view.color, glyph: iconChoice() },
      },
      routeOptions(target),
    );
    pushToast(tr("workspaceIcon.saved", { name: target.name }), "success");
    iconTarget.set(null);
    if (fleetActive()) void refreshFleetNavigator();
  } catch (error) {
    // A stale revision means another client changed it: show the current icon.
    iconNotice.set(errorText(error));
    await readIcon(target).catch(() => undefined);
  } finally {
    iconBusy.set(false);
  }
}

function GlyphTile(props: { glyph: string }) {
  const selected = () => iconChoice() === props.glyph;
  return (
    <View
      role="button"
      accessibilityLabel={`workspace-icon-glyph-${props.glyph}`}
      accessibilityState={{ selected: selected() }}
      hitSlop={touchSlop(space.x4l)}
      onPress={() => iconChoice.set(props.glyph)}
      style={{
        width: compactLayout() ? layout.touchTarget : space.x4l,
        height: compactLayout() ? layout.touchTarget : space.x4l,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: selected() ? palette().borderStrong : palette().borderSubtle,
        backgroundColor: selected() ? palette().panelHover : palette().canvas,
        cursor: "pointer",
        ...pressTransition(),
      }}
      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.95)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon name={workspaceGlyphIcon(props.glyph)} size={20} color={selected() ? palette().text : palette().textSecondary} />
    </View>
  );
}

const ICON_SKELETON_TILES = Array.from({ length: 12 }, (_, idx) => idx);

function WorkspaceIconDialog(): JSX.Element {
  const unsupported = () => iconView() !== null && (iconView()?.supportedGlyphs.length ?? 0) === 0;
  const loading = () => Boolean(iconTarget()) && iconView() === null && !iconNotice();
  const deviceName = () => {
    const target = iconTarget();
    return (target?.deviceId ? fleetDeviceById(target.deviceId)?.name : "") || "";
  };
  return (
    <ModalDialog
      open={Boolean(iconTarget())}
      title={tr("workspaceIcon.title", { name: iconTarget()?.name ?? "" })}
      size="md"
      accessibilityLabel="workspace-icon-modal"
      onClose={() => iconTarget.set(null)}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="md"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => iconTarget.set(null)}
          />
          <Button
            label={tr("common.save")}
            variant="primary"
            size="md"
            loading={iconBusy()}
            disabled={!iconView() || unsupported() || iconChoice() === iconView()?.glyph}
            accessibilityLabel="workspace-icon-save"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => void saveWorkspaceIcon()}
          />
        </View>
      }
    >
      <View style={{ gap: space.md }}>
        <If when={loading()}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Each of={ICON_SKELETON_TILES} key={idx => String(idx)}>
              {() => (
                <SkeletonBlock
                  width={compactLayout() ? layout.touchTarget : space.x4l}
                  height={compactLayout() ? layout.touchTarget : space.x4l}
                  borderRadius={radii.md}
                />
              )}
            </Each>
          </View>
        </If>
        <If when={unsupported()}>
          <Text style={textStyle("body", { color: palette().textSecondary })}>
            {deviceName() ? tr("workspaceIcon.updateDevice", { device: deviceName() }) : tr("workspaceIcon.updateHere")}
          </Text>
        </If>
        <If when={!unsupported() && iconView() !== null}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Each of={iconView()?.supportedGlyphs ?? []} key={glyph => glyph}>
              {glyph => <GlyphTile glyph={glyph()} />}
            </Each>
          </View>
          <Text style={textStyle("caption", { color: palette().textMuted })}>
            {tr("workspaceIcon.hint")}
          </Text>
        </If>
        <If when={iconNotice()}>
          {notice => <InlineBanner tone="danger" message={notice()} />}
        </If>
      </View>
    </ModalDialog>
  );
}

// ── wave22-p5: file transfer for SSH workspaces ───────────────────────────────
//
// `remote_upload_from_local_path` / `remote_download_to_local_path` stream
// between the SSH host and a path on the machine that holds the connection, so
// they are offered only where that machine is the one this window runs on.
// Progress comes as `upload_progress` / `download_progress` events by transfer
// id, and `cancel_transfer` stops one at the next chunk.

type TransferDirection = "upload" | "download";

interface TransferTarget {
  workspace: WorkspaceActionTarget;
  connectionId: string;
  direction: TransferDirection;
}

const transferTarget = signal<TransferTarget | null>(null);
const transferLocal = signal("");
const transferRemote = signal("");
const transferId = signal("");
const transferProgress = signal<{ done: number; total: number } | null>(null);
const transferNotice = signal("");

/** Whether this window can name a local path for the workspace's connection. */
export function transferAvailableHere(target: WorkspaceActionTarget): boolean {
  if (controllerPort() || windowShellId() === "browser") return false;
  return sessionIsOnThisMachine(target);
}

function posixBase(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  return cleaned.slice(cleaned.lastIndexOf("/") + 1);
}

/** The last segment of a local path on any OS (`/` or `\`). */
function localBase(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  return cleaned.slice(Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\")) + 1);
}

function joinLocal(dir: string, name: string): string {
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}${separator}${name}`;
}

function joinPosix(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function openTransfer(workspace: WorkspaceActionTarget, connectionId: string, direction: TransferDirection): void {
  transferTarget.set({ workspace, connectionId, direction });
  transferLocal.set("");
  transferRemote.set(workspace.rootPath);
  transferId.set("");
  transferProgress.set(null);
  transferNotice.set("");
}

async function chooseLocalFolder(): Promise<void> {
  try {
    const picked = await pickLocalDirectory({ title: tr("transfer.chooseFolder") });
    if (picked) transferLocal.set(picked);
  } catch (error) {
    transferNotice.set(errorText(error));
  }
}

let progressStops: Array<() => void> = [];

function followProgress(id: string): void {
  progressStops.forEach(stop => stop());
  const onProgress = (payload: Record<string, unknown> | null) => {
    if (!payload || payload.transferId !== id) return;
    const done = Number(payload.uploaded ?? payload.downloaded ?? 0);
    const total = Number(payload.total ?? 0);
    transferProgress.set({ done, total });
  };
  progressStops = [
    listenEvent<Record<string, unknown> | null>("upload_progress", onProgress),
    listenEvent<Record<string, unknown> | null>("download_progress", onProgress),
  ];
}

async function startTransfer(): Promise<void> {
  const target = transferTarget();
  const local = transferLocal().trim();
  const remote = transferRemote().trim();
  if (!target || !local || !remote || transferId()) return;
  const id = `transfer-${newRequestId()}`;
  transferId.set(id);
  transferProgress.set({ done: 0, total: 0 });
  transferNotice.set("");
  followProgress(id);
  const route = routeOptions(target.workspace);
  try {
    if (target.direction === "upload") {
      const remotePath = joinPosix(remote, localBase(local));
      await invokeRawCommand<unknown>(
        "remote_upload_from_local_path",
        { connectionId: target.connectionId, localPath: local, remotePath, transferId: id },
        route,
      );
      pushToast(tr("transfer.uploaded", { name: localBase(local) }), "success");
    } else {
      const localPath = joinLocal(local, posixBase(remote));
      await invokeRawCommand<unknown>(
        "remote_download_to_local_path",
        { connectionId: target.connectionId, remotePath: remote, localPath, transferId: id },
        route,
      );
      pushToast(tr("transfer.downloaded", { name: posixBase(remote) }), "success");
    }
    transferTarget.set(null);
  } catch (error) {
    transferNotice.set(errorText(error));
  } finally {
    transferId.set("");
    progressStops.forEach(stop => stop());
    progressStops = [];
  }
}

async function cancelTransfer(): Promise<void> {
  const id = transferId();
  const target = transferTarget();
  if (!id || !target) {
    transferTarget.set(null);
    return;
  }
  await invokeRawCommand<unknown>("cancel_transfer", { transferId: id }, routeOptions(target.workspace)).catch(
    () => undefined,
  );
}

function progressPercent(): number {
  const progress = transferProgress();
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.done / progress.total) * 100)));
}

function progressText(): string {
  const progress = transferProgress();
  if (!progress) return "";
  if (progress.total <= 0) return tr("transfer.starting");
  const pct = tr("transfer.progress", { percent: progressPercent() });
  return `${pct} · ${formatBytes(progress.done)} / ${formatBytes(progress.total)}`;
}

function TransferDialog(): JSX.Element {
  const upload = () => transferTarget()?.direction === "upload";
  const running = () => transferId() !== "";
  return (
    <ModalDialog
      open={Boolean(transferTarget())}
      title={upload() ? tr("transfer.uploadTitle", { name: transferTarget()?.workspace.name ?? "" }) : tr("transfer.downloadTitle", { name: transferTarget()?.workspace.name ?? "" })}
      size="md"
      accessibilityLabel="workspace-transfer-modal"
      closeOnBackdropPress={!running()}
      onClose={() => {
        if (running()) void cancelTransfer();
        else transferTarget.set(null);
      }}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Button
            label={running() ? tr("transfer.stop") : tr("common.cancel")}
            variant="secondary"
            size="md"
            accessibilityLabel="workspace-transfer-cancel"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => void cancelTransfer()}
          />
          <Button
            label={upload() ? tr("transfer.upload") : tr("transfer.download")}
            variant="primary"
            size="md"
            loading={running()}
            disabled={running() || !transferLocal().trim() || !transferRemote().trim()}
            accessibilityLabel="workspace-transfer-start"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => void startTransfer()}
          />
        </View>
      }
    >
      <View style={{ gap: space.md }}>
        <TextField
          label={upload() ? tr("transfer.localSource") : tr("transfer.localFolder")}
          hint={upload() ? tr("transfer.localSourceHint") : undefined}
          value={transferLocal()}
          monospace={true}
          disabled={running()}
          accessibilityLabel="workspace-transfer-local"
          onChange={value => transferLocal.set(value)}
          onSubmit={() => void startTransfer()}
          trailing={
            <IconButton
              icon="folder-open"
              size="sm"
              disabled={running()}
              tooltip={tr("transfer.chooseFolder")}
              accessibilityLabel="workspace-transfer-choose"
              onPress={() => void chooseLocalFolder()}
            />
          }
        />
        <TextField
          label={upload() ? tr("transfer.remoteFolder") : tr("transfer.remoteSource")}
          value={transferRemote()}
          monospace={true}
          disabled={running()}
          accessibilityLabel="workspace-transfer-remote"
          onChange={value => transferRemote.set(value)}
          onSubmit={() => void startTransfer()}
        />
        <If when={progressText()}>
          <View style={{ gap: space.xs }}>
            <If when={(transferProgress()?.total ?? 0) > 0}>
              <View
                style={{
                  height: 4,
                  borderRadius: radii.pill,
                  backgroundColor: palette().surfaceTertiary,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: `${progressPercent()}%`,
                    height: "100%",
                    borderRadius: radii.pill,
                    backgroundColor: palette().accent,
                  }}
                />
              </View>
            </If>
            <Text style={{ ...textStyle("caption", { color: palette().textMuted, tabular: true }) }}>{progressText()}</Text>
          </View>
        </If>
        <If when={transferNotice()}>
          {notice => <InlineBanner tone="danger" message={notice()} />}
        </If>
      </View>
    </ModalDialog>
  );
}

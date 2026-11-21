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
import { fleetActive, invokeCommand } from "../bridge";
import { refreshFleetNavigator } from "../fleetStore";
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
import { fontMono, palette, space, textStyle } from "../theme";
import { sessionIsOnThisMachine } from "./sessionActions";
import { ModalDialog, pushToast, type DropdownMenuItem } from "./overlays";
import { Button, TextField } from "./primitives";

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

async function rename(target: WorkspaceActionTarget, name: string): Promise<void> {
  const next = name.trim();
  if (!next || next === target.name) return;
  try {
    if (loadedRecord(target)) {
      await renameWorkspace(target.workspaceId, next);
    } else {
      await invokeCommand<unknown>("update_workspace_info", { workspaceId: target.workspaceId, name: next }, routeOptions(target));
    }
    if (fleetActive()) void refreshFleetNavigator();
  } catch (error) {
    pushToast(errorText(error), "error");
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
  const submitRename = () => {
    const target = renameTarget();
    renameTarget.set(null);
    if (target) void rename(target, renameDraft());
  };
  return (
    <>
      <ModalDialog
        open={Boolean(renameTarget())}
        title={tr("shell.ws.renameTitle")}
        size="sm"
        accessibilityLabel="workspace-rename-modal"
        onClose={() => renameTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button label={tr("common.cancel")} variant="secondary" size="sm" onPress={() => renameTarget.set(null)} />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="sm"
              disabled={!renameDraft().trim()}
              accessibilityLabel="workspace-rename-save"
              onPress={submitRename}
            />
          </View>
        }
      >
        <TextField
          autoFocus
          label={tr("shell.ws.nameLabel")}
          value={renameDraft()}
          accessibilityLabel="workspace-rename-input"
          onChange={value => renameDraft.set(value)}
          onSubmit={() => submitRename()}
        />
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
        onClose={() => assistantTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button label={tr("common.cancel")} variant="secondary" size="sm" onPress={() => assistantTarget.set(null)} />
            <Button
              label={assistantTarget()?.action === "delete" ? tr("common.delete") : tr("shell.ws.resetConfirm")}
              variant="danger"
              size="sm"
              loading={assistantBusy()}
              accessibilityLabel="assistant-action-confirm"
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
    </>
  );
}

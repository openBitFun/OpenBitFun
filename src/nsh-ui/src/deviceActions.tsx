// A device's own actions, offered by its row in the session tree (sidebar and
// phone session list): new workspace or terminal there, its SSH connections and
// settings, renaming, the jobs this computer sent, and what to run when it
// needs an update. What the account's devices are and what they allow is the
// backend's (the fleet navigator row and its action gates, and
// `fleet_device_detail` for the update instructions).

import { Clipboard, signal, Text, View, type JSX } from "nsh";
import { entryDeviceId, fleetActive, invokeCommand } from "./bridge";
import { fleetDeviceById } from "./fleetStore";
import { isCommandUnavailable } from "./hostCommands";
import { tr } from "./i18n";
import { removeAccountDevice, saveDeviceAlias } from "./accountDevicesStore";
import { controllerPort } from "./controller/controllerPort";
import type { DeviceTreeNode } from "./deviceTree";
import { DeviceJobsSheet, deviceJobsAvailable, openDeviceJobs } from "./scenes/DeviceJobsPanel";
import { openNewWorkspaceModal, openSshConnectionModal } from "./sshRemoteStore";
import { activeWorkspace, navigateScene, selectDeviceContext } from "./state";
import { openTerminal } from "./terminalStore";
import { compactLayout, layout, palette, radii, space, textStyle } from "./theme";
import { deviceException, stateColor } from "./ui/fleet";
import { ModalDialog, pushToast, type DropdownMenuItem } from "./ui/overlays";
import { Button, TextField } from "./ui/primitives";

/** `fleet_device_detail`'s update block (served by newer entries; every field optional). */
interface DeviceUpdate {
  version?: string;
  command?: string;
}

const renameTarget = signal<{ deviceId: string; name: string } | null>(null);
const renameDraft = signal("");
const updateTarget = signal<{ deviceId: string; name: string; reason?: string } | null>(null);
const updateDetail = signal<DeviceUpdate | null>(null);
const detailUnsupportedEntries = new Set<string>();

async function onDevice(node: DeviceTreeNode): Promise<void> {
  if (fleetActive() && node.deviceId) await selectDeviceContext(node.deviceId);
}

function offline(node: DeviceTreeNode): boolean {
  return deviceException(node.state) === "offline";
}

/** Whether the device may get a new workspace (its action gate, else: it answers). */
export function deviceCanCreateWorkspace(node: DeviceTreeNode): { allowed: boolean; reason?: string } {
  const gate = fleetDeviceById(node.deviceId)?.actions?.createWorkspace;
  return gate ?? { allowed: !offline(node) };
}

/** Opens the new-workspace sheet (folder, SSH, container, WSL) on the device. */
export async function newWorkspaceOn(node: DeviceTreeNode): Promise<void> {
  await onDevice(node);
  await openNewWorkspaceModal();
}

async function newTerminalOn(node: DeviceTreeNode): Promise<void> {
  await onDevice(node);
  const workspace = activeWorkspace();
  await openTerminal(workspace?.id ?? null, workspace?.rootPath ?? "");
  navigateScene("terminal");
}

async function sshConnectionsOf(node: DeviceTreeNode): Promise<void> {
  await onDevice(node);
  await openSshConnectionModal();
}

function settingsOf(node: DeviceTreeNode): void {
  void onDevice(node).then(() => navigateScene("settings"));
}

function copyDeviceId(deviceId: string): void {
  void Clipboard.writeText(deviceId).then(
    () => pushToast(tr("device.idCopied"), "success"),
    () => pushToast(tr("error.unsupported"), "error"),
  );
}

async function openUpdate(node: DeviceTreeNode): Promise<void> {
  updateDetail.set(null);
  updateTarget.set({ deviceId: node.deviceId, name: node.name, reason: fleetDeviceById(node.deviceId)?.stateReason });
  const entryKey = entryDeviceId() ?? "default";
  if (!fleetActive() || detailUnsupportedEntries.has(entryKey)) return;
  try {
    const answer = await invokeCommand<{ update?: DeviceUpdate }>("fleet_device_detail", { deviceId: node.deviceId });
    if (updateTarget()?.deviceId === node.deviceId) updateDetail.set(answer?.update ?? null);
  } catch (error) {
    if (isCommandUnavailable(error, "fleet_device_detail")) detailUnsupportedEntries.add(entryKey);
    else console.warn(`fleet_device_detail failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The device row's ⋯ menu. */
export function deviceMenuItems(node: DeviceTreeNode): DropdownMenuItem[] {
  const id = node.deviceId || "local";
  const unreachable = deviceException(node.state) !== null;
  const create = deviceCanCreateWorkspace(node);
  const items: DropdownMenuItem[] = [];
  if (deviceException(node.state) === "update_required") {
    items.push({
      id: `device-update-${id}`,
      label: tr("device.updateNeeded"),
      icon: "download",
      accessibilityLabel: `device-update-${id}`,
      onSelect: () => void openUpdate(node),
    });
  }
  items.push(
    {
      id: `device-new-workspace-${id}`,
      label: tr("device.newWorkspace"),
      icon: "folder-plus",
      accessibilityLabel: `device-new-workspace-${id}`,
      disabled: !create.allowed,
      hint: create.allowed ? undefined : create.reason,
      separator: items.length > 0,
      onSelect: () => void newWorkspaceOn(node),
    },
    {
      id: `device-new-terminal-${id}`,
      label: tr("device.newTerminal"),
      icon: "terminal",
      accessibilityLabel: `device-new-terminal-${id}`,
      disabled: unreachable,
      onSelect: () => void newTerminalOn(node),
    },
    {
      id: `device-ssh-${id}`,
      label: tr("device.ssh"),
      icon: "server",
      accessibilityLabel: `device-ssh-${id}`,
      disabled: unreachable,
      onSelect: () => void sshConnectionsOf(node),
    },
  );
  // The jobs this computer sent: controller-local commands, so only this desktop draws them.
  if ((node.isClient || !fleetActive()) && !controllerPort() && !compactLayout() && deviceJobsAvailable()) {
    items.push({
      id: `device-jobs-${id}`,
      label: tr("deviceJobs.title"),
      icon: "inbox",
      accessibilityLabel: `device-jobs-${id}`,
      onSelect: () => openDeviceJobs(),
    });
  }
  items.push({
    id: `device-settings-${id}`,
    label: tr("device.settingsFor", { device: node.name }),
    icon: "settings",
    accessibilityLabel: `device-settings-${id}`,
    disabled: offline(node),
    separator: true,
    onSelect: () => settingsOf(node),
  });
  if (fleetActive() && node.deviceId) {
    items.push(
      {
        id: `device-rename-${id}`,
        label: tr("device.menuRename"),
        icon: "edit",
        accessibilityLabel: `device-menu-rename-${id}`,
        onSelect: () => {
          renameDraft.set(node.name);
          renameTarget.set({ deviceId: node.deviceId, name: node.name });
        },
      },
      {
        id: `device-copy-id-${id}`,
        label: tr("device.copyId"),
        icon: "copy",
        accessibilityLabel: `device-menu-copy-id-${id}`,
        onSelect: () => copyDeviceId(node.deviceId),
      },
    );
    if (!node.isClient) {
      items.push({
        id: `device-remove-${id}`,
        label: tr("device.remove"),
        icon: "trash",
        danger: true,
        separator: true,
        confirmDelete: true,
        confirmAccessibilityLabel: `device-remove-confirm-${id}`,
        accessibilityLabel: `device-menu-remove-${id}`,
        onSelect: () => void removeAccountDevice(node.deviceId, node.name),
      });
    }
  }
  return items;
}

function RenameDialog(): JSX.Element {
  const canSave = () => {
    const target = renameTarget();
    const trimmed = renameDraft().trim();
    return Boolean(target) && trimmed.length > 0 && trimmed !== target!.name;
  };
  const submit = () => {
    const target = renameTarget();
    if (!target || !canSave()) return;
    renameTarget.set(null);
    void saveDeviceAlias(target.deviceId, renameDraft().trim());
  };
  return (
    <ModalDialog
      open={renameTarget() !== null}
      size="sm"
      title={tr("device.menuRename")}
      onClose={() => renameTarget.set(null)}
      footer={
        <>
          <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => renameTarget.set(null)} />
          <Button
            label={tr("common.save")}
            variant="primary"
            size="md"
            disabled={!canSave()}
            accessibilityLabel="device-rename-save"
            onPress={submit}
          />
        </>
      }
    >
      <TextField
        value={renameDraft()}
        onChange={value => renameDraft.set(value)}
        onSubmit={submit}
        accessibilityLabel="device-rename-field"
        autoFocus
      />
    </ModalDialog>
  );
}

function UpdateDialog(): JSX.Element {
  const copy = (command: string) => {
    void Clipboard.writeText(command).then(
      () => pushToast(tr("device.commandCopied"), "success"),
      () => pushToast(tr("error.unsupported"), "error"),
    );
  };
  return (
    <ModalDialog
      open={updateTarget() !== null}
      size="sm"
      title={updateTarget()?.name ?? ""}
      accessibilityLabel="device-update-dialog"
      onClose={() => updateTarget.set(null)}
      footer={<Button label={tr("common.close")} variant="secondary" size="md" onPress={() => updateTarget.set(null)} />}
    >
      <View style={{ gap: space.md }}>
        <Text style={textStyle("body", { color: stateColor("needs_you") })}>
          {updateDetail()?.version
            ? tr("device.needsVersion", { version: updateDetail()!.version! })
            : updateTarget()?.reason || tr("device.updateNeeded")}
        </Text>
        <If when={updateDetail()?.command ?? ""}>
          {command => (
            <View style={{ gap: space.xs }}>
              <Text style={textStyle("caption")}>{tr("device.runCommand")}</Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingVertical: space.chip,
                  paddingHorizontal: space.sm,
                  borderRadius: radii.sm,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Text style={{ ...textStyle("mono"), flex: 1, minWidth: 0, userSelect: "text" }}>{command()}</Text>
                <Button
                  label={tr("common.copy")}
                  leadingIcon="copy"
                  variant="ghost"
                  size={compactLayout() ? "md" : "xs"}
                  accessibilityLabel="device-copy-update-command"
                  style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                  onPress={() => copy(command())}
                />
              </View>
            </View>
          )}
        </If>
      </View>
    </ModalDialog>
  );
}

/** The dialogs the device menu opens; mounted once by the shell. */
export function DeviceActionDialogs(): JSX.Element {
  return (
    <>
      <RenameDialog />
      <UpdateDialog />
      <If when={!controllerPort()}>
        <DeviceJobsSheet />
      </If>
    </>
  );
}

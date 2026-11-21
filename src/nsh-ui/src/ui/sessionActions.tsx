// Session actions (visual spec §4.5 `session.*`, ux-redesign §3.3 and §3.6):
// the ⋯ menu a session row in All sessions and the session header share, and
// the rename and delete dialogs it opens. One target names the session
// anywhere on the account: its device, workspace and id.
//
// Display only: every action is one backend command, routed to the device that
// owns the session (`fleet_call` by the session's owner key, or the explicit
// target). A session in the open workspace goes through the same `state.ts`
// actions the session view uses, so the open catalogue updates in place; any
// other row calls the command and lets the next index event redraw it. "Show
// storage folder" opens a file manager, so it is offered only for a session on
// the machine this window runs on, and says why otherwise.

import { Clipboard, signal, Text, View, type JSX } from "nsh";
import { archiveSession, deletePersistedSession, revealInExplorer, unarchiveSession } from "../api";
import { entryDeviceId, fleetActive, invokeCommand } from "../bridge";
import { controllerPort } from "../controller/controllerPort";
import { fleetDeviceById, refreshFleetNavigator } from "../fleetStore";
import { localizeHostError, tr } from "../i18n";
import {
  activeWorkspaceId,
  activeWorkspaceKey,
  archiveSessionRow,
  deleteSessionRow,
  renameSession,
  sessions,
} from "../state";
import { palette, space, textStyle } from "../theme";
import { ModalDialog, pushToast, type DropdownMenuItem } from "./overlays";
import { Button, TextField } from "./primitives";

/** A session anywhere on the account. `deviceId` is `""` on a backend without the fleet layer. */
export interface SessionActionTarget {
  sessionId: string;
  deviceId: string;
  workspaceId: string;
  title: string;
  archived?: boolean;
}

const renameTarget = signal<SessionActionTarget | null>(null);
const renameDraft = signal("");
const deleteTarget = signal<SessionActionTarget | null>(null);
const deleteBusy = signal(false);

function errorText(error: unknown): string {
  return localizeHostError(error instanceof Error ? error.message : String(error ?? ""));
}

/** Whether the session is a row of the open workspace's catalogue (the session view's own list). */
function inOpenCatalogue(target: SessionActionTarget): boolean {
  if (!target.workspaceId || target.workspaceId !== activeWorkspaceId()) return false;
  if (fleetActive() && (activeWorkspaceKey()?.deviceId ?? "") !== target.deviceId) return false;
  return sessions().some(row => row.sessionId === target.sessionId);
}

function routeOptions(target: SessionActionTarget): { target: string } | undefined {
  return fleetActive() && target.deviceId ? { target: target.deviceId } : undefined;
}

/** After a change to a row outside the open catalogue: the navigator answers the new state. */
function afterRemoteChange(): void {
  if (fleetActive()) void refreshFleetNavigator();
}

/**
 * Whether the session's folder is on the machine this window runs on. A
 * browser or phone has no file manager for it, and on a fleet entry only this
 * device's sessions qualify.
 */
export function sessionIsOnThisMachine(target: Pick<SessionActionTarget, "deviceId">): boolean {
  if (controllerPort()) return false;
  if (!fleetActive() || !target.deviceId) return true;
  return target.deviceId === entryDeviceId() || fleetDeviceById(target.deviceId)?.isClientDevice === true;
}

export async function setSessionArchived(target: SessionActionTarget, archived: boolean): Promise<void> {
  try {
    if (inOpenCatalogue(target)) {
      await archiveSessionRow(target.sessionId, archived);
    } else {
      await (archived ? archiveSession : unarchiveSession)(target.sessionId, target.workspaceId);
      afterRemoteChange();
    }
    pushToast(
      archived
        ? tr("session.archivedToast", { title: target.title })
        : tr("session.restoredToast", { title: target.title }),
      "info",
    );
  } catch (error) {
    pushToast(errorText(error), "error");
  }
}

export async function renameSessionTarget(target: SessionActionTarget, name: string): Promise<void> {
  const next = name.trim();
  if (!next || next === target.title) return;
  try {
    if (inOpenCatalogue(target)) {
      await renameSession(target.sessionId, next);
    } else {
      await invokeCommand<unknown>(
        "update_session_title",
        { sessionId: target.sessionId, title: next, workspaceId: target.workspaceId },
        routeOptions(target),
      );
      afterRemoteChange();
    }
  } catch (error) {
    pushToast(errorText(error), "error");
  }
}

export async function deleteSessionTarget(target: SessionActionTarget): Promise<void> {
  try {
    if (inOpenCatalogue(target)) {
      await deleteSessionRow(target.sessionId);
    } else {
      await deletePersistedSession(target.sessionId, target.workspaceId);
      afterRemoteChange();
    }
  } catch (error) {
    pushToast(errorText(error), "error");
  }
}

function copySessionId(target: SessionActionTarget): void {
  void Clipboard.writeText(target.sessionId).then(
    () => pushToast(tr("session.idCopied"), "success"),
    () => pushToast(tr("error.unsupported"), "error"),
  );
}

async function revealSessionStorage(target: SessionActionTarget): Promise<void> {
  try {
    await invokeCommand<unknown>(
      "reveal_session_storage_directory",
      { workspace_id: target.workspaceId, session_id: target.sessionId },
      routeOptions(target),
    );
  } catch (error) {
    pushToast(tr("shell.session.openStorageFailed", { error: errorText(error) }), "error");
  }
}

/** Writes the session's Markdown transcript on its device; a local file is shown in the file manager. */
async function exportSessionMarkdown(target: SessionActionTarget): Promise<void> {
  try {
    const exported = await invokeCommand<{ transcriptPath?: string; transcript_path?: string }>(
      "export_session_transcript",
      { session_id: target.sessionId, workspace_id: target.workspaceId, tools: true },
      routeOptions(target),
    );
    const path = exported?.transcriptPath ?? exported?.transcript_path ?? "";
    pushToast(tr("shell.session.exported", { title: target.title }), "success");
    if (path && sessionIsOnThisMachine(target)) {
      await revealInExplorer(path, target.workspaceId).catch(() => undefined);
    }
  } catch (error) {
    pushToast(tr("shell.session.exportFailed", { error: errorText(error) }), "error");
  }
}

export function openSessionRename(target: SessionActionTarget): void {
  renameDraft.set(target.title);
  renameTarget.set(target);
}

export function openSessionDelete(target: SessionActionTarget): void {
  deleteTarget.set(target);
}

/**
 * The session ⋯ menu: Rename…, Archive (Restore when archived), Copy session
 * ID, Export as Markdown, Show storage folder, then Delete… last (spec §3 Menus).
 * `omit` drops items a surface already offers elsewhere.
 */
export function sessionMenuItems(
  target: SessionActionTarget,
  options?: { omit?: ReadonlyArray<"rename" | "archive" | "delete"> },
): DropdownMenuItem[] {
  const omit = new Set(options?.omit ?? []);
  const key = target.sessionId;
  const local = sessionIsOnThisMachine(target);
  const items: DropdownMenuItem[] = [];
  if (!omit.has("rename")) {
    items.push({
      id: `session-rename-${key}`,
      label: tr("session.rename"),
      icon: "edit",
      accessibilityLabel: `session-menu-rename-${key}`,
      onSelect: () => openSessionRename(target),
    });
  }
  if (!omit.has("archive")) {
    items.push({
      id: `session-archive-${key}`,
      label: target.archived ? tr("sessions.restore") : tr("session.archive"),
      icon: target.archived ? "undo" : "layers",
      accessibilityLabel: `session-menu-archive-${key}`,
      onSelect: () => void setSessionArchived(target, !target.archived),
    });
  }
  items.push(
    {
      id: `session-copy-id-${key}`,
      label: tr("session.copyId"),
      icon: "copy",
      separator: items.length > 0,
      accessibilityLabel: `session-menu-copy-id-${key}`,
      onSelect: () => copySessionId(target),
    },
    {
      id: `session-export-${key}`,
      label: tr("shell.session.exportMarkdown"),
      icon: "download",
      accessibilityLabel: `session-menu-export-${key}`,
      onSelect: () => void exportSessionMarkdown(target),
    },
    {
      id: `session-storage-${key}`,
      label: tr("session.revealStorage"),
      icon: "folder-open",
      disabled: !local,
      hint: local ? undefined : tr("session.revealOnlyHere"),
      accessibilityLabel: `session-menu-storage-${key}`,
      onSelect: () => void revealSessionStorage(target),
    },
  );
  if (!omit.has("delete")) {
    items.push({
      id: `session-delete-${key}`,
      label: tr("session.delete"),
      icon: "trash",
      danger: true,
      separator: true,
      accessibilityLabel: `session-menu-delete-${key}`,
      onSelect: () => openSessionDelete(target),
    });
  }
  return items;
}

/** The rename and delete dialogs the session menu opens; mounted once by the shell. */
export function SessionActionDialogs(): JSX.Element {
  const submitRename = () => {
    const target = renameTarget();
    renameTarget.set(null);
    if (target) void renameSessionTarget(target, renameDraft());
  };
  const confirmDelete = () => {
    const target = deleteTarget();
    if (!target || deleteBusy()) return;
    deleteBusy.set(true);
    void deleteSessionTarget(target).finally(() => {
      deleteBusy.set(false);
      deleteTarget.set(null);
    });
  };
  return (
    <>
      <ModalDialog
        open={Boolean(renameTarget())}
        title={tr("session.renameTitle")}
        size="sm"
        accessibilityLabel="session-rename-modal"
        onClose={() => renameTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button label={tr("common.cancel")} variant="secondary" size="sm" onPress={() => renameTarget.set(null)} />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="sm"
              disabled={!renameDraft().trim()}
              accessibilityLabel="session-rename-save"
              onPress={submitRename}
            />
          </View>
        }
      >
        <TextField
          autoFocus
          label={tr("session.nameLabel")}
          value={renameDraft()}
          accessibilityLabel="session-rename-input"
          onChange={value => renameDraft.set(value)}
          onSubmit={() => submitRename()}
        />
      </ModalDialog>
      <ModalDialog
        open={Boolean(deleteTarget())}
        title={tr("session.deleteTitle", { title: deleteTarget()?.title ?? "" })}
        size="sm"
        accessibilityLabel="session-delete-modal"
        onClose={() => deleteTarget.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Button label={tr("common.cancel")} variant="secondary" size="sm" onPress={() => deleteTarget.set(null)} />
            <Button
              label={tr("common.delete")}
              variant="danger"
              size="sm"
              loading={deleteBusy()}
              accessibilityLabel="session-delete-confirm"
              onPress={confirmDelete}
            />
          </View>
        }
      >
        <Text style={textStyle("body", { color: palette().textSecondary })}>{tr("session.deleteBody")}</Text>
      </ModalDialog>
    </>
  );
}

// State and backend actions for the Personal Assistants nursery & Persona Studio.
//
// Assistant workspaces and their persona documents (`IDENTITY.md`, `SOUL.md`,
// `USER.md`) belong to whichever host this surface is currently driving (this
// machine or the active Peer). All file paths join with POSIX separators so
// remote and peer Linux/macOS targets never receive backslashes.

import { computed, signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { formatTimestamp } from "./format";
import { peerScope } from "./peerState";
import {
  navigateScene,
  selectWorkspace,
  startQuickPromptInSession,
  workspaces,
} from "./state";

export const PERSONA_FILES = ["IDENTITY.md", "SOUL.md", "USER.md"] as const;
export type PersonaFileName = (typeof PERSONA_FILES)[number];

export interface AssistantIdentityView {
  name: string;
  creature: string;
  vibe: string;
  avatar: string;
  emoji: string;
}

export interface AssistantWorkspaceView {
  id: string;
  name: string;
  rootPath: string;
  assistantId: string;
  workspaceKind: string;
  description: string;
  lastAccessedText: string;
  identity: AssistantIdentityView;
}

export const assistants = signal<AssistantWorkspaceView[]>([]);
export const primaryAssistantId = signal<string | null>(null);
export const selectedAssistantId = signal<string | null>(null);
export const assistantsLoading = signal(false);
export const assistantsBusy = signal(false);
export const assistantsError = signal("");
export const assistantsNotice = signal("");
export const confirmingAssistantAction = signal<{ id: string; kind: "reset" | "delete" } | null>(
  null,
);

export const activePersonaFile = signal<PersonaFileName>("IDENTITY.md");
export const personaDraft = signal("");
export const personaOriginal = signal("");
export const personaLoading = signal(false);
export const personaSaving = signal(false);
export const personaPreview = signal(false);
export const personaError = signal("");
export const personaNotice = signal("");
export const confirmingPersonaReset = signal(false);
export const personaReloadToken = signal(0);
export const assistantQuickPrompt = signal("");
export const assistantQuickSending = signal(false);
export const newAssistantModalOpen = signal(false);
export const newAssistantNameInput = signal("");

export const selectedAssistant = computed<AssistantWorkspaceView | null>(
  () => assistants().find(item => item.id === selectedAssistantId()) ?? null,
);

export const selectedAssistantRoot = computed<string>(
  () => selectedAssistant()?.rootPath ?? "",
);

export const personaDirty = computed(() => personaDraft() !== personaOriginal());

let lastScopePeerKey: string | undefined;
let listTicket = 0;
let fileReadTicket = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTimestampMs(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isMissingFileError(error: unknown): boolean {
  const message = errorMessage(error);
  return /does not exist|no such file|not found|no fixture content|enoent/i.test(message);
}

/** Joins an assistant workspace root and persona filename with POSIX slashes only. */
export function joinPersonaFilePath(rootPath: string, fileName: PersonaFileName): string {
  const normalized = rootPath.replace(/\\/g, "/");
  if (normalized === "/") return `/${fileName}`;
  const trimmed = normalized.replace(/\/+$/, "");
  return trimmed ? `${trimmed}/${fileName}` : fileName;
}

function mapAssistant(raw: unknown, index: number): AssistantWorkspaceView {
  const rec = asRecord(raw);
  const identityRaw = asRecord(rec.identity);
  const id = readString(rec, ["id", "workspaceId", "workspace_id"]) || `assistant-${index + 1}`;
  const identityName = readString(identityRaw, ["name"]);
  const assistantId = readString(rec, ["assistantId", "assistant_id"]);
  const name = readString(rec, ["name"]) || identityName || assistantId || id;
  const rootPath = readString(rec, ["rootPath", "root_path"]);
  const workspaceKind = readString(rec, ["workspaceKind", "workspace_kind"]) || "assistant";
  const lastAccessedMs = parseTimestampMs(rec.lastAccessed ?? rec.last_accessed);

  return {
    id,
    name,
    rootPath,
    assistantId,
    workspaceKind,
    description: readString(rec, ["description"]) || readString(identityRaw, ["vibe", "creature"]),
    lastAccessedText: lastAccessedMs ? formatTimestamp(lastAccessedMs) : "",
    identity: {
      name: identityName || name,
      creature: readString(identityRaw, ["creature"]),
      vibe: readString(identityRaw, ["vibe"]),
      avatar: readString(identityRaw, ["avatar"]),
      emoji: readString(identityRaw, ["emoji"]),
    },
  };
}

function ensureAssistantInWorkspaces(assistant: AssistantWorkspaceView): void {
  if (!workspaces().some(item => item.id === assistant.id)) {
    workspaces.update(current => [
      ...current,
      {
        id: assistant.id,
        name: assistant.name,
        rootPath: assistant.rootPath,
        workspaceKind: assistant.workspaceKind || "assistant",
      },
    ]);
  }
}

export async function loadAssistants(preferredSelectId?: string): Promise<void> {
  const expectedPeerId = peerScope()?.deviceId ?? null;
  const ticket = ++listTicket;
  assistantsLoading.set(true);
  assistantsError.set("");

  try {
    const [listRes, primaryRes] = await Promise.allSettled([
      invokeRawCommand<Array<Record<string, unknown>>>("get_assistant_workspaces", {}),
      invokeCommand<Record<string, unknown> | null>("get_primary_assistant_workspace", {}),
    ]);

    if (ticket !== listTicket || (peerScope()?.deviceId ?? null) !== expectedPeerId) return;

    if (listRes.status === "rejected") {
      assistants.set([]);
      primaryAssistantId.set(null);
      selectedAssistantId.set(null);
      assistantsError.set(errorMessage(listRes.reason));
      return;
    }

    const mapped = (Array.isArray(listRes.value) ? listRes.value : []).map((item, index) =>
      mapAssistant(item, index),
    );
    assistants.set(mapped);

    let primaryId: string | null = null;
    if (primaryRes.status === "fulfilled" && primaryRes.value) {
      const candidate = readString(asRecord(primaryRes.value), [
        "id",
        "workspaceId",
        "workspace_id",
      ]);
      if (candidate) primaryId = candidate;
    }
    if (!primaryId) {
      const flagged = (Array.isArray(listRes.value) ? listRes.value : []).find(item => {
        const rec = asRecord(item);
        return rec.isPrimary === true || rec.is_primary === true;
      });
      if (flagged) {
        primaryId = readString(asRecord(flagged), ["id", "workspaceId", "workspace_id"]) || null;
      }
    }
    primaryAssistantId.set(primaryId);

    const currentSelected = selectedAssistantId();
    const nextSelected =
      (preferredSelectId && mapped.some(item => item.id === preferredSelectId)
        ? preferredSelectId
        : null) ??
      (currentSelected && mapped.some(item => item.id === currentSelected)
        ? currentSelected
        : null) ??
      (primaryId && mapped.some(item => item.id === primaryId) ? primaryId : null) ??
      mapped[0]?.id ??
      null;

    selectedAssistantId.set(nextSelected);
  } finally {
    if (ticket === listTicket) {
      assistantsLoading.set(false);
    }
  }
}

export function syncAssistantsScope(peerId: string | null, force = false): void {
  const peerKey = peerId ?? "__local__";
  const peerChanged = lastScopePeerKey !== undefined && lastScopePeerKey !== peerKey;
  if (!force && !peerChanged && lastScopePeerKey === peerKey && assistants().length > 0) return;
  if (peerChanged) {
    // Switching between local and Peer drops all host-specific assistant state.
    assistants.set([]);
    primaryAssistantId.set(null);
    selectedAssistantId.set(null);
    confirmingAssistantAction.set(null);
    confirmingPersonaReset.set(false);
    personaDraft.set("");
    personaOriginal.set("");
    personaError.set("");
    personaNotice.set("");
    assistantsNotice.set("");
    newAssistantModalOpen.set(false);
    newAssistantNameInput.set("");
  }
  lastScopePeerKey = peerKey;
  void loadAssistants();
}

export function selectAssistant(workspaceId: string): void {
  if (selectedAssistantId() === workspaceId) return;
  selectedAssistantId.set(workspaceId);
  confirmingAssistantAction.set(null);
  confirmingPersonaReset.set(false);
  personaError.set("");
  personaNotice.set("");
}

export function selectPersonaFile(fileName: PersonaFileName): void {
  if (activePersonaFile() === fileName) return;
  activePersonaFile.set(fileName);
  confirmingPersonaReset.set(false);
  personaError.set("");
  personaNotice.set("");
}

export function togglePersonaPreview(): void {
  personaPreview.update(value => !value);
}

export function setPersonaDraftText(text: string): void {
  personaDraft.set(text);
  personaNotice.set("");
}

export async function loadPersonaFile(
  assistant: AssistantWorkspaceView,
  fileName: PersonaFileName,
): Promise<void> {
  const expectedPeerId = peerScope()?.deviceId ?? null;
  const ticket = ++fileReadTicket;
  personaLoading.set(true);
  personaError.set("");
  personaNotice.set("");

  if (!assistant.rootPath) {
    personaDraft.set("");
    personaOriginal.set("");
    personaLoading.set(false);
    personaError.set("Assistant workspace has no root path.");
    return;
  }

  const filePath = joinPersonaFilePath(assistant.rootPath, fileName);
  try {
    const content = await invokeCommand<string>("read_file_content", {
      workspaceId: assistant.id,
      workspacePath: assistant.rootPath,
      filePath,
    });
    if (ticket !== fileReadTicket || (peerScope()?.deviceId ?? null) !== expectedPeerId) return;
    const text = typeof content === "string" ? content : "";
    personaDraft.set(text);
    personaOriginal.set(text);
  } catch (error) {
    if (ticket !== fileReadTicket || (peerScope()?.deviceId ?? null) !== expectedPeerId) return;
    if (isMissingFileError(error)) {
      personaDraft.set("");
      personaOriginal.set("");
      personaNotice.set(`${fileName} does not exist yet — save to create it.`);
    } else {
      personaDraft.set("");
      personaOriginal.set("");
      personaError.set(errorMessage(error));
    }
  } finally {
    if (ticket === fileReadTicket) {
      personaLoading.set(false);
    }
  }
}

export async function savePersonaFile(): Promise<void> {
  const assistant = selectedAssistant();
  if (!assistant || personaSaving()) return;
  const fileName = activePersonaFile();
  const content = personaDraft();
  const filePath = joinPersonaFilePath(assistant.rootPath, fileName);

  personaSaving.set(true);
  personaError.set("");
  personaNotice.set("");
  try {
    await invokeCommand<unknown>("write_file_content", {
      workspaceId: assistant.id,
      workspacePath: assistant.rootPath,
      filePath,
      content,
    });
    personaOriginal.set(content);
    personaNotice.set(`Saved ${fileName}`);
    if (fileName === "IDENTITY.md") {
      void loadAssistants(assistant.id);
    }
  } catch (error) {
    personaError.set(errorMessage(error));
  } finally {
    personaSaving.set(false);
  }
}

export function openNewAssistantModal(): void {
  newAssistantNameInput.set("");
  assistantsError.set("");
  newAssistantModalOpen.set(true);
}

export function closeNewAssistantModal(): void {
  if (assistantsBusy()) return;
  newAssistantModalOpen.set(false);
}

export async function createAssistant(customName = newAssistantNameInput()): Promise<void> {
  if (assistantsBusy()) return;
  assistantsBusy.set(true);
  assistantsError.set("");
  assistantsNotice.set("");
  try {
    const created = asRecord(
      await invokeCommand<Record<string, unknown>>("create_assistant_workspace", {}),
    );
    const createdId = readString(created, ["id", "workspaceId", "workspace_id"]) || undefined;
    const createdRoot = readString(created, ["rootPath", "root_path"]);
    const trimmedName = customName.trim();
    if (trimmedName && createdId && createdRoot) {
      await invokeCommand<unknown>("write_file_content", {
        workspaceId: createdId,
        workspacePath: createdRoot,
        filePath: joinPersonaFilePath(createdRoot, "IDENTITY.md"),
        content: `# ${trimmedName}\n\nPersonal AI companion workspace.\n`,
      });
    }
    newAssistantModalOpen.set(false);
    newAssistantNameInput.set("");
    await loadAssistants(createdId);
    assistantsNotice.set("Created new assistant workspace.");
  } catch (error) {
    assistantsError.set(errorMessage(error));
  } finally {
    assistantsBusy.set(false);
  }
}

export async function setPrimaryAssistant(workspaceId: string): Promise<void> {
  if (assistantsBusy()) return;
  assistantsBusy.set(true);
  assistantsError.set("");
  assistantsNotice.set("");
  try {
    await invokeCommand<Record<string, unknown>>("set_primary_assistant_workspace", {
      workspaceId,
    });
    primaryAssistantId.set(workspaceId);
    await loadAssistants(workspaceId);
    assistantsNotice.set("Updated primary assistant.");
  } catch (error) {
    assistantsError.set(errorMessage(error));
  } finally {
    assistantsBusy.set(false);
  }
}

export function requestAssistantConfirm(id: string, kind: "reset" | "delete"): void {
  confirmingAssistantAction.set({ id, kind });
}

export function cancelAssistantConfirm(): void {
  confirmingAssistantAction.set(null);
}

export async function executeAssistantConfirm(): Promise<void> {
  const pending = confirmingAssistantAction();
  if (!pending || assistantsBusy()) return;
  assistantsBusy.set(true);
  assistantsError.set("");
  assistantsNotice.set("");
  try {
    if (pending.kind === "reset") {
      await invokeCommand<Record<string, unknown>>("reset_assistant_workspace", {
        workspaceId: pending.id,
      });
      confirmingAssistantAction.set(null);
      await loadAssistants(pending.id);
      const current = selectedAssistant();
      if (current && current.id === pending.id) {
        await loadPersonaFile(current, activePersonaFile());
      }
      assistantsNotice.set("Assistant workspace reset to defaults.");
    } else {
      await invokeCommand<unknown>("delete_assistant_workspace", {
        workspaceId: pending.id,
      });
      confirmingAssistantAction.set(null);
      await loadAssistants();
      assistantsNotice.set("Deleted assistant workspace.");
    }
  } catch (error) {
    assistantsError.set(errorMessage(error));
  } finally {
    assistantsBusy.set(false);
  }
}

export async function resetSelectedPersonaFiles(): Promise<void> {
  const assistant = selectedAssistant();
  if (!assistant || personaSaving()) return;
  personaSaving.set(true);
  personaError.set("");
  personaNotice.set("");
  try {
    await invokeCommand<unknown>("reset_workspace_persona_files", {
      workspaceId: assistant.id,
      workspacePath: assistant.rootPath,
    });
    confirmingPersonaReset.set(false);
    await loadPersonaFile(assistant, activePersonaFile());
    personaNotice.set("Persona files reset to defaults.");
    void loadAssistants(assistant.id);
  } catch (error) {
    personaError.set(errorMessage(error));
  } finally {
    personaSaving.set(false);
  }
}

export function chatWithAssistant(assistant: AssistantWorkspaceView): void {
  ensureAssistantInWorkspaces(assistant);
  selectWorkspace(assistant.id);
  navigateScene("sessions");
}

export async function sendQuickPromptToAssistant(): Promise<void> {
  const assistant = selectedAssistant();
  const prompt = assistantQuickPrompt().trim();
  if (!assistant || !prompt || assistantQuickSending()) return;
  assistantQuickSending.set(true);
  personaError.set("");
  try {
    ensureAssistantInWorkspaces(assistant);
    selectWorkspace(assistant.id);
    assistantQuickPrompt.set("");
    await startQuickPromptInSession(prompt, "Claw");
  } catch (error) {
    personaError.set(errorMessage(error));
  } finally {
    assistantQuickSending.set(false);
  }
}

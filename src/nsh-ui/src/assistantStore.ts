// State and backend actions for the Personal Assistants nursery & Persona Studio.
//
// Assistant workspaces and their persona documents (`IDENTITY.md`, `SOUL.md`,
// `USER.md`) belong to whichever host this surface is currently driving (this
// machine or the active Peer). All file paths join with POSIX separators so
// remote and peer Linux/macOS targets never receive backslashes.

import { computed, signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { tr } from "./i18n";
import { isCommandUnavailable } from "./hostCommands";

/** The `IDENTITY.md` frontmatter fields the page edits; the host rewrites the document. */
export type IdentityField = "name" | "avatar" | "emoji";
import { formatTimestamp } from "./format";
import { peerScope } from "./peerState";
import { listSessions, setActiveWorkspace, type SessionSummary } from "./api";
import {
  activeWorkspaceId,
  closeWorkspace,
  loadSessions,
  loadWorkspaces,
  navigateScene,
  selectSession,
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
    personaError.set(tr("assistants.store.noRootPath"));
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
      personaNotice.set(tr("assistants.store.fileMissing", { file: fileName }));
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
    personaNotice.set(tr("assistants.store.savedFile", { file: fileName }));
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
    const trimmedName = customName.replace(/\s+/g, " ").trim();
    // The host writes the name into the new assistant's IDENTITY.md.
    const created = asRecord(
      await invokeCommand<Record<string, unknown>>(
        "create_assistant_workspace",
        trimmedName ? { name: trimmedName } : {},
      ),
    );
    const createdId = readString(created, ["id", "workspaceId", "workspace_id"]) || undefined;
    const createdName = readString(asRecord(created.identity), ["name"]);
    // An older host ignores `name` and keeps the seeded default: say so instead of
    // rewriting its IDENTITY.md from here.
    const nameIgnored = Boolean(trimmedName && createdId && createdName !== trimmedName);
    newAssistantModalOpen.set(false);
    newAssistantNameInput.set("");
    await loadAssistants(createdId);
    assistantsNotice.set(
      nameIgnored ? tr("assistants.store.nameNeedsHostUpdate") : tr("assistants.store.created"),
    );
    // The desktop opens the new assistant's page, so its identity is set next.
    if (createdId) openAssistantConfig(createdId);
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
    assistantsNotice.set(tr("assistants.store.primaryUpdated"));
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
      assistantsNotice.set(tr("assistants.store.workspaceReset"));
    } else {
      await invokeCommand<unknown>("delete_assistant_workspace", {
        workspaceId: pending.id,
      });
      confirmingAssistantAction.set(null);
      await loadAssistants();
      assistantsNotice.set(tr("assistants.store.deleted"));
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
    personaNotice.set(tr("assistants.store.personaReset"));
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

/** Assistant workspaces the host currently has open (the desktop's Open / Close). */
export const assistantWorkspaceBusy = signal<string | null>(null);

export function isAssistantWorkspaceOpen(id: string): boolean {
  return workspaces().some(item => item.id === id);
}

/** Opens the assistant's workspace on the host and makes it the active one. */
export async function openAssistantWorkspace(assistant: AssistantWorkspaceView): Promise<void> {
  if (assistantWorkspaceBusy()) return;
  assistantWorkspaceBusy.set(assistant.id);
  assistantsError.set("");
  try {
    await setActiveWorkspace(assistant.id);
    await loadWorkspaces();
    ensureAssistantInWorkspaces(assistant);
    selectWorkspace(assistant.id, { syncHost: false });
  } catch (error) {
    assistantsError.set(tr("assistants.openFailed", { error: errorMessage(error) }));
  } finally {
    assistantWorkspaceBusy.set(null);
  }
}

/** Closes the assistant's workspace on the host; the assistant itself stays. */
export async function closeAssistantWorkspace(assistant: AssistantWorkspaceView): Promise<void> {
  if (assistantWorkspaceBusy()) return;
  assistantWorkspaceBusy.set(assistant.id);
  assistantsError.set("");
  try {
    await closeWorkspace(assistant.id);
  } catch (error) {
    assistantsError.set(tr("assistants.closeFailed", { error: errorMessage(error) }));
  } finally {
    assistantWorkspaceBusy.set(null);
  }
}

// ---------------------------------------------------------------------------
// Gallery and configuration page (the desktop's NurseryGallery and
// AssistantConfigPage): the scene opens on the gallery, a card opens one
// assistant's page, and the page edits the avatar and name in IDENTITY.md,
// opens the three persona documents and lists the assistant's sessions.
// ---------------------------------------------------------------------------

export type AssistantView = "gallery" | "config";
export const assistantView = signal<AssistantView>("gallery");

/** The desktop's official avatar preset ids (artwork drawn by `AssistantAvatar`). */
export const ASSISTANT_AVATAR_PRESETS = ["joystick-ink-mint"] as const;

/** The emoji avatars the desktop's picker offers, in its order. */
export const ASSISTANT_EMOJI_PRESETS = [
  "🧭",
  "💼",
  "🧠",
  "🛠️",
  "🔎",
  "✍️",
  "📚",
  "🎨",
  "📊",
  "🧪",
  "🚀",
  "🤖",
  "🧑‍💻",
  "🗂️",
  "💡",
  "🛡️",
] as const;

export type IdentitySaveStatus = "idle" | "saving" | "saved" | "error";
export const identitySaveStatus = signal<IdentitySaveStatus>("idle");
export const identitySaveError = signal("");
export const editingAssistantName = signal(false);
export const assistantNameDraft = signal("");
export const avatarPickerOpen = signal(false);
export const avatarCustomInput = signal("");
/** The persona document open in the editor dialog, or `null` while it is closed. */
export const personaEditorFile = signal<PersonaFileName | null>(null);

export type AssistantSessionsState = "idle" | "loading" | "ready" | "error";
export const assistantSessions = signal<SessionSummary[]>([]);
export const assistantSessionsState = signal<AssistantSessionsState>("idle");
export const assistantSessionsError = signal("");
let sessionsTicket = 0;
let identityWriteQueue: Promise<void> = Promise.resolve();

/** Opens one assistant's configuration page. */
export function openAssistantConfig(workspaceId: string): void {
  selectAssistant(workspaceId);
  editingAssistantName.set(false);
  avatarPickerOpen.set(false);
  personaEditorFile.set(null);
  identitySaveStatus.set("idle");
  identitySaveError.set("");
  assistantView.set("config");
}

/** Returns to the gallery; the selection stays so the page reopens where it was. */
export function openAssistantGallery(): void {
  editingAssistantName.set(false);
  avatarPickerOpen.set(false);
  personaEditorFile.set(null);
  confirmingAssistantAction.set(null);
  assistantView.set("gallery");
}

/** The assistants in gallery order: the primary first, the rest as the host listed them. */
export function galleryAssistants(): AssistantWorkspaceView[] {
  const primary = primaryAssistantId();
  const list = assistants();
  return [...list.filter(item => item.id === primary), ...list.filter(item => item.id !== primary)];
}

/**
 * Writes identity fields into the assistant's IDENTITY.md: the stored document
 * is read again right before the write and only the given fields change, so an
 * edit made elsewhere since the page opened survives. Writes run one after
 * another in the order they were asked for.
 */
export function saveIdentityFields(
  assistant: AssistantWorkspaceView,
  patch: Partial<Record<IdentityField, string>>,
): Promise<void> {
  // The page shows the new value at once; the host's list catches up on reload.
  assistants.update(list =>
    list.map(item =>
      item.id === assistant.id
        ? {
            ...item,
            name: patch.name !== undefined && patch.name.trim() ? patch.name.trim() : item.name,
            identity: {
              ...item.identity,
              ...(patch.name !== undefined ? { name: patch.name.trim() || item.identity.name } : {}),
              ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
              ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
            },
          }
        : item,
    ),
  );
  const run = identityWriteQueue.then(async () => {
    identitySaveStatus.set("saving");
    identitySaveError.set("");
    try {
      // The host rewrites only these fields of IDENTITY.md, keeping the rest and
      // the body, and tells every client through `workspace-identity-changed`.
      const result = asRecord(
        await invokeCommand<Record<string, unknown>>("set_assistant_identity", {
          workspaceId: assistant.id,
          ...patch,
        }),
      );
      const next = typeof result.content === "string" ? result.content : null;
      identitySaveStatus.set("saved");
      // The persona editor shows IDENTITY.md too; keep it in step when it is clean.
      if (
        next !== null &&
        activePersonaFile() === "IDENTITY.md" &&
        !personaDirty() &&
        selectedAssistantId() === assistant.id
      ) {
        personaDraft.set(next);
        personaOriginal.set(next);
      }
    } catch (error) {
      identitySaveStatus.set("error");
      identitySaveError.set(
        isCommandUnavailable(error, "set_assistant_identity")
          ? tr("assistants.store.identityNeedsHostUpdate")
          : errorMessage(error),
      );
      void loadAssistants(assistant.id);
    }
  });
  identityWriteQueue = run.catch(() => undefined);
  return run;
}

export function beginAssistantNameEdit(): void {
  const assistant = selectedAssistant();
  if (!assistant) return;
  assistantNameDraft.set(assistant.identity.name || assistant.name);
  editingAssistantName.set(true);
}

export function cancelAssistantNameEdit(): void {
  editingAssistantName.set(false);
}

/** Saves the typed name (Return or leaving the field); an unchanged name writes nothing. */
export async function commitAssistantNameEdit(): Promise<void> {
  if (!editingAssistantName()) return;
  editingAssistantName.set(false);
  const assistant = selectedAssistant();
  if (!assistant) return;
  const next = assistantNameDraft().replace(/\s+/g, " ").trim();
  if (next === (assistant.identity.name || assistant.name)) return;
  await saveIdentityFields(assistant, { name: next });
}

export function toggleAvatarPicker(): void {
  const assistant = selectedAssistant();
  avatarCustomInput.set(firstGrapheme(assistant?.identity.emoji ?? ""));
  avatarPickerOpen.update(open => !open);
}

/** The official artwork: sets `avatar` to the preset id and keeps the emoji. */
export async function chooseAvatarPreset(presetId: string): Promise<void> {
  const assistant = selectedAssistant();
  if (!assistant) return;
  avatarPickerOpen.set(false);
  await saveIdentityFields(assistant, { avatar: presetId });
}

/** An emoji avatar: clears the preset so the emoji is what shows. */
export async function chooseAvatarEmoji(emoji: string): Promise<void> {
  const assistant = selectedAssistant();
  const value = firstGrapheme(emoji);
  if (!assistant || !value) return;
  avatarPickerOpen.set(false);
  avatarCustomInput.set(value);
  await saveIdentityFields(assistant, { avatar: "", emoji: value });
}

export function submitCustomAvatar(): Promise<void> {
  return chooseAvatarEmoji(avatarCustomInput());
}

function firstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: "grapheme" },
    ) => { segment: (text: string) => Iterable<{ segment: string }> };
  }).Segmenter;
  if (Segmenter) {
    const first = new Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next();
    return first.done ? "" : first.value.segment;
  }
  return Array.from(trimmed)[0] ?? "";
}

/** Opens one persona document in the editor dialog. */
export function openPersonaEditor(fileName: PersonaFileName): void {
  selectPersonaFile(fileName);
  personaPreview.set(false);
  personaEditorFile.set(fileName);
  personaReloadToken.update(value => value + 1);
}

export function closePersonaEditor(): void {
  personaEditorFile.set(null);
  confirmingPersonaReset.set(false);
}

/** Reads the assistant workspace's own sessions, newest first, as the desktop's page lists them. */
export async function loadAssistantSessions(assistant: AssistantWorkspaceView): Promise<void> {
  const expectedPeerId = peerScope()?.deviceId ?? null;
  const ticket = ++sessionsTicket;
  assistantSessionsState.set("loading");
  assistantSessionsError.set("");
  try {
    const page = await listSessions(assistant.id, 30);
    if (ticket !== sessionsTicket || (peerScope()?.deviceId ?? null) !== expectedPeerId) return;
    assistantSessions.set(page.sessions ?? []);
    assistantSessionsState.set("ready");
  } catch (error) {
    if (ticket !== sessionsTicket) return;
    assistantSessions.set([]);
    assistantSessionsError.set(errorMessage(error));
    assistantSessionsState.set("error");
  }
}

/** Opens one of the assistant's sessions in the Sessions scene. */
export async function openAssistantSession(assistant: AssistantWorkspaceView, sessionId: string): Promise<void> {
  ensureAssistantInWorkspaces(assistant);
  if (activeWorkspaceId() !== assistant.id) {
    selectWorkspace(assistant.id);
    await loadSessions();
  }
  navigateScene("sessions");
  selectSession(sessionId);
}

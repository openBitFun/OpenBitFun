// The Inbox: everything that waits on you, from every device (visual spec §4.4,
// ux-redesign §3.4 and §7), and the one place a prompt is answered from.
//
// Display only. The backend groups and orders the items and counts the badge
// (`fleet_attention`); this store keeps its latest answer. An entry without
// `fleet_attention` (an older backend) still has `fleet_prompts`: its prompts
// become the "Needs you" group in the backend's order, and the badge is the
// navigator's `waiting` total. A backend without the fleet layer has neither;
// the session view still shows its own prompts (`permissionStore`,
// `userQuestionStore`), answered through the same `answerPrompt`.
//
// Answering routes to the device whose runtime asked: `respond_permission` /
// `submit_user_answers` with `target = deviceId`, or `dispatch_target_answer`
// for a Detached Dispatch job (`answerRoute: "dispatch"`). An answered item
// holds "Answered on {device}" for `ANSWERED_HOLD_MS`, then leaves; an item the
// backend dropped while it was on screen (answered on another client) does the
// same instead of vanishing.

import { computed, effect, signal, untracked } from "nsh";
import { errorMessageOf } from "./backendConnection";
import { connectionState, fleetActive, invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { fleetDeviceById, fleetPromptList, fleetPrompts, fleetTotals } from "./fleetStore";
import {
  FLEET_ENTRY_LOST,
  fleetErrorKind,
  type FleetActionGate,
  type FleetPrompt,
} from "./fleetTypes";
import { tr } from "./i18n";

/** How long an answered item holds before it leaves (spec §2.6). */
export const ANSWERED_HOLD_MS = 1600;

export const FLEET_ATTENTION_CHANGED_EVENT = "fleet://attention-changed";

export type AttentionKind = "permission" | "question" | "failure" | "done" | (string & {});
export type AttentionGroupId = "needs_you" | "done" | "failed" | (string & {});

/** Where an item comes from: a device's session or job, or an OpenBitFun conversation (`deviceId: "cloud"`). */
export interface AttentionSource {
  deviceId: string;
  workspaceId?: string;
  sessionId?: string;
  conversationId?: string;
  jobId?: string;
}

/** One backend item (`fleet_attention`). Every field is the backend's. */
export interface AttentionEntry {
  itemId: string;
  kind: AttentionKind;
  source: AttentionSource;
  title: string;
  detail?: string;
  /** The device's name as the backend projects it (`"OpenBitFun"` for the cloud). */
  deviceName?: string;
  hostKind?: string;
  /** A prompt item carries its `FleetPrompt` (the answer goes to its device). */
  prompt?: FleetPrompt;
  answerable?: boolean;
  reason?: string;
  ageMs?: number;
  unread?: boolean;
  actions?: Record<string, FleetActionGate>;
}

export interface AttentionGroup {
  id: AttentionGroupId;
  items: AttentionEntry[];
}

/** `fleet_attention {sinceRevision?}`. */
export interface AttentionView {
  revision: number;
  groups: AttentionGroup[];
  /** The needs-you count the sidebar pill and the phone tab badge draw. */
  badge: number;
}

/** The latest `fleet_attention` answer; `null` before the first read or on a backend without it. */
export const attentionView = signal<AttentionView | null>(null);
/** `false` once the entry answered `fleet_attention` as unknown (an older backend). */
export const attentionServed = signal<boolean | null>(null);
/** Why the last read failed; `""` otherwise. */
export const attentionError = signal("");

/** The ⌘I sheet (UI-A mounts `InboxSheet` and binds the shortcut). */
export const inboxSheetOpen = signal(false);

export function toggleInboxSheet(open?: boolean): void {
  inboxSheetOpen.set(open ?? !inboxSheetOpen());
}

function promptEntry(prompt: FleetPrompt): AttentionEntry {
  const device = fleetDeviceById(prompt.deviceId);
  return {
    itemId: `${prompt.deviceId}/${prompt.promptId}`,
    kind: prompt.kind,
    source: {
      deviceId: prompt.deviceId,
      workspaceId: prompt.workspaceId,
      sessionId: prompt.sessionId,
      ...(prompt.jobId ? { jobId: prompt.jobId } : {}),
    },
    title: sessionTitleOf(prompt) || prompt.title,
    deviceName: device?.name,
    hostKind: device?.hostKind,
    prompt,
    answerable: prompt.answerable,
    reason: prompt.unanswerableReason,
  };
}

/** The title of the session a prompt belongs to, as the navigator lists it. */
function sessionTitleOf(prompt: FleetPrompt): string {
  const device = fleetDeviceById(prompt.deviceId);
  for (const workspace of device?.workspaces ?? []) {
    const row = workspace.sessions.find(session => session.sessionId === prompt.sessionId);
    if (row) return row.title;
  }
  return "";
}

/**
 * The groups the Inbox draws: the backend's `fleet_attention` groups, or, on an
 * entry without it, the prompt tray as one "Needs you" group.
 */
export const attentionGroups = computed<AttentionGroup[]>(() => {
  const view = attentionView();
  if (view) return view.groups;
  if (!fleetActive() || !fleetPrompts()) return [];
  const prompts = fleetPromptList();
  return prompts.length ? [{ id: "needs_you", items: prompts.map(promptEntry) }] : [];
});

/** The needs-you count from the backend (sidebar pill, phone tab badge). */
export const inboxBadge = computed<number>(() => {
  const view = attentionView();
  if (view) return Math.max(0, view.badge | 0);
  return fleetTotals()?.waiting ?? 0;
});

// ── Reads ────────────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null;
let again = false;

function isUnknownCommand(error: unknown): boolean {
  const message = errorMessageOf(error).toLowerCase();
  return (
    message.includes("unknown command") ||
    message.includes("unknown_command") ||
    message.includes("not found") ||
    message.includes("no fixture") ||
    message.includes("unsupported")
  );
}

async function readAttention(): Promise<void> {
  const answer = await invokeCommand<AttentionView>("fleet_attention", {});
  if (!answer || !Array.isArray(answer.groups)) throw new Error("fleet_attention answered without groups");
  attentionView.set({
    revision: typeof answer.revision === "number" ? answer.revision : 0,
    groups: answer.groups.map(group => ({ id: group.id, items: Array.isArray(group.items) ? group.items : [] })),
    badge: typeof answer.badge === "number" ? answer.badge : 0,
  });
  attentionServed.set(true);
  attentionError.set("");
}

/** Reads the Inbox once more (one read in flight; a change during it reads again). */
export async function refreshAttention(): Promise<void> {
  if (!fleetActive() || attentionServed() === false) return;
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        again = false;
        try {
          await readAttention();
        } catch (error) {
          if (isUnknownCommand(error)) {
            attentionServed.set(false);
            attentionView.set(null);
            return;
          }
          attentionError.set(errorMessageOf(error));
          console.warn(`Inbox read failed: ${errorMessageOf(error)}`);
        }
      } while (again && fleetActive());
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Marks the Done and Failed items read (`fleet_attention_mark_read`). */
export async function markAllAttentionRead(): Promise<void> {
  const view = attentionView();
  if (!view) return;
  try {
    await invokeCommand<unknown>("fleet_attention_mark_read", { revision: view.revision });
  } catch (error) {
    attentionError.set(errorMessageOf(error));
  }
  void refreshAttention();
}

let started = false;

/** Follows the Inbox once per app: the first read, then a read on every change event. */
export function startAttentionStore(): void {
  if (started) return;
  started = true;
  listenEvent<{ revision?: number }>(FLEET_ATTENTION_CHANGED_EVENT, payload => {
    const held = attentionView()?.revision;
    if (typeof payload?.revision === "number" && held !== undefined && payload.revision <= held) return;
    void refreshAttention();
  });
  // A prompt change also changes the Inbox; a backend that serves the view says so with its own event.
  listenEvent<unknown>("fleet://prompts-changed", () => {
    if (attentionServed()) void refreshAttention();
  });
  let wasActive = false;
  effect(() => {
    const active = fleetActive();
    if (active === wasActive) return;
    wasActive = active;
    untracked(() => {
      if (active) {
        attentionServed.set(null);
        void refreshAttention();
      } else {
        attentionView.set(null);
        attentionServed.set(null);
      }
    });
  });
  // Answers held while offline go out on reconnect.
  effect(() => {
    if (connectionState() !== "connected") return;
    untracked(() => void flushHeldAnswers());
  });
}

// ── Answering ────────────────────────────────────────────────────────────────

export type PermissionReply = "once" | "always" | "reject";

/** What the user answered: a permission reply, or the question answers keyed by question index. */
export type PromptAnswer =
  | { kind: "permission"; reply: PermissionReply }
  | { kind: "question"; answers: Record<string, string | string[]> };

/** Where one prompt's answer stands on this client. */
export type PromptPhase =
  /** Sent; waiting for the device. */
  | "answering"
  /** The device took it (or it was answered elsewhere): "Answered on {device}". */
  | "answered"
  /** Held until the connection is back ("Will send when you're back online"). */
  | "held"
  /** The prompt changed while the answer was held: "This changed. Review it again." */
  | "changed"
  /** The call was lost with the entry: "Couldn't confirm. Try again." */
  | "unconfirmed"
  /** The device refused it; `error` says why. */
  | "error";

export interface PromptStatus {
  phase: PromptPhase;
  /** The reply being sent (to show progress on its button). */
  reply?: string;
  error?: string;
  /** The words of an answered item ("Answered on mac-mini"). */
  answeredLabel?: string;
  revision?: number;
}

/** A prompt's identity: prompt ids are unique per device only. */
export function promptKey(prompt: Pick<FleetPrompt, "deviceId" | "promptId">): string {
  return `${prompt.deviceId}/${prompt.promptId}`;
}

export const promptStatuses = signal<Record<string, PromptStatus>>({});

export function promptStatus(prompt: Pick<FleetPrompt, "deviceId" | "promptId">): PromptStatus | null {
  return promptStatuses()[promptKey(prompt)] ?? null;
}

function setStatus(key: string, status: PromptStatus | null): void {
  promptStatuses.update(current => {
    const next = { ...current };
    if (status) next[key] = status;
    else delete next[key];
    return next;
  });
}

/** The device name a prompt names in "Answered on {device}". */
export function promptDeviceName(prompt: Pick<FleetPrompt, "deviceId">): string {
  return fleetDeviceById(prompt.deviceId)?.name ?? "";
}

function answeredLabelOf(prompt: FleetPrompt): string {
  const device = promptDeviceName(prompt);
  return device ? tr("answered.onDevice", { device }) : tr("answered.here");
}

const held = new Map<string, { prompt: FleetPrompt; answer: PromptAnswer }>();
const listeners = new Set<(prompt: FleetPrompt, answer: PromptAnswer) => void>();

/** Lets a store drop its own copy of a prompt once its device took the answer. */
export function onPromptAnswered(listener: (prompt: FleetPrompt, answer: PromptAnswer) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function send(prompt: FleetPrompt, answer: PromptAnswer): Promise<void> {
  const target = prompt.deviceId ? { target: prompt.deviceId } : undefined;
  if (answer.kind === "permission") {
    if (prompt.answerRoute === "dispatch" && prompt.jobId) {
      // The CLI dispatch runner reads the arguments as they are (camelCase, strict).
      await invokeRawCommand<unknown>(
        "dispatch_target_answer",
        { jobId: prompt.jobId, requestId: prompt.promptId, reply: answer.reply },
        target,
      );
      return;
    }
    await invokeCommand<unknown>("respond_permission", { requestId: prompt.promptId, reply: answer.reply }, target);
    return;
  }
  // Positional on the host: `tool_id`, `answers` (and the session) are separate arguments.
  await invokeRawCommand<unknown>(
    "submit_user_answers",
    { toolId: prompt.promptId, answers: answer.answers, sessionId: prompt.sessionId },
    target,
  );
}

function scheduleRelease(key: string): void {
  setTimeout(() => {
    const status = promptStatuses()[key];
    if (status?.phase === "answered") setStatus(key, null);
  }, ANSWERED_HOLD_MS + 400);
}

/**
 * Answers one prompt on the device that asked. Resolves `true` once the device
 * took it; the item then holds "Answered on {device}" and the caller may raise
 * the toast. Never throws: a failure is the prompt's status.
 */
export async function answerPrompt(
  prompt: FleetPrompt,
  answer: PromptAnswer,
  sender: (prompt: FleetPrompt, answer: PromptAnswer) => Promise<void> = send,
): Promise<boolean> {
  const key = promptKey(prompt);
  const current = promptStatuses()[key];
  if (current?.phase === "answering" || current?.phase === "answered") return false;
  if (connectionState() !== "connected" && fleetActive()) {
    held.set(key, { prompt, answer });
    setStatus(key, { phase: "held", revision: prompt.revision });
    return false;
  }
  setStatus(key, {
    phase: "answering",
    reply: answer.kind === "permission" ? answer.reply : "answer",
    revision: prompt.revision,
  });
  try {
    await sender(prompt, answer);
    setStatus(key, { phase: "answered", answeredLabel: answeredLabelOf(prompt), revision: prompt.revision });
    for (const listener of listeners) listener(prompt, answer);
    scheduleRelease(key);
    return true;
  } catch (error) {
    if (fleetErrorKind(error) === FLEET_ENTRY_LOST) {
      setStatus(key, { phase: "unconfirmed", revision: prompt.revision });
    } else {
      setStatus(key, { phase: "error", error: errorMessageOf(error), revision: prompt.revision });
    }
    return false;
  }
}

/** Clears a failed or changed status so the controls draw again. */
export function resetPromptStatus(prompt: Pick<FleetPrompt, "deviceId" | "promptId">): void {
  held.delete(promptKey(prompt));
  setStatus(promptKey(prompt), null);
}

async function flushHeldAnswers(): Promise<void> {
  if (held.size === 0) return;
  const entries = [...held.entries()];
  held.clear();
  for (const [key, { prompt, answer }] of entries) {
    const live = fleetActive() ? fleetPromptList().find(item => promptKey(item) === key) : prompt;
    if (!live) {
      // Gone while offline: someone else answered it.
      setStatus(key, { phase: "answered", answeredLabel: answeredLabelOf(prompt) });
      scheduleRelease(key);
      continue;
    }
    if (live.revision !== prompt.revision) {
      setStatus(key, { phase: "changed", revision: live.revision });
      continue;
    }
    setStatus(key, null);
    await answerPrompt(live, answer);
  }
}

/**
 * Marks a prompt that left the backend's list while it was drawn as answered
 * elsewhere, so it fades to "Answered on {device}" instead of vanishing.
 */
export function noteAnsweredElsewhere(prompt: FleetPrompt): void {
  const key = promptKey(prompt);
  if (promptStatuses()[key]?.phase === "answered") return;
  setStatus(key, { phase: "answered", answeredLabel: answeredLabelOf(prompt), revision: prompt.revision });
  scheduleRelease(key);
}

/** Test hook: forgets held answers and statuses. */
export function resetAttentionForTests(): void {
  held.clear();
  promptStatuses.set({});
  attentionView.set(null);
  attentionServed.set(null);
  attentionError.set("");
  inboxSheetOpen.set(false);
}

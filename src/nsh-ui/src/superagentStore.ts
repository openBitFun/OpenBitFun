// The OpenBitFun conversation (visual spec §4.2 and §4.3, ux-redesign §3.1,
// §3.2 and §7, superagent-design §8).
//
// Display only. The cloud node owns the conversation, the job cards, their
// states, reasons and allowed actions, the history list and its groups; this
// store keeps its latest answers and applies the events it pushes
// (`superagent://turn-delta`, `superagent://card-changed`). It never sorts,
// merges, counts or decides a state.
//
// Routing: on a fleet entry every `superagent_*` command is a `fleet_call` to
// the cloud node, the navigator's device with `hostKind: "cloud"`. An entry
// without the fleet layer gets the command plainly (the development page's
// fixtures answer it; a host that does not know it answers "unavailable").
// Nothing falls back to local data.
//
// Sending is idempotent: one `clientMessageId` per message, reused when the
// same text is sent again after a failure, so a retry never asks twice.

import { batch, effect, signal, untracked } from "nsh";
import { errorMessageOf } from "./backendConnection";
import { fleetActive, invokeCommand, listenEvent } from "./bridge";
import { fleetDevices } from "./fleetStore";
import { FLEET_DEVICE_OFFLINE, fleetErrorKind, type FleetPrompt } from "./fleetTypes";
import { accountStatus } from "./homeStore";
import { currentLocale, isAuthRequiredError } from "./i18n";
import { localTimeZone } from "./usageActivity";

export const SUPERAGENT_TURN_DELTA_EVENT = "superagent://turn-delta";
export const SUPERAGENT_CARD_CHANGED_EVENT = "superagent://card-changed";

// ── Wire shapes (mirrors of `openbitfun_product_domains::superagent::dto` and the cloud node's answers) ──

/** The job state the cloud node projects; an unknown value draws as idle. */
export type SuperagentJobState =
  | "queued"
  | "working"
  | "blocked"
  | "idle"
  | "done"
  | "failed"
  | "cancelled"
  | (string & {});

export interface JobActionGate {
  allowed: boolean;
  reason?: string;
}

export interface JobCardActions {
  openTranscript?: JobActionGate;
  message?: JobActionGate;
  cancel?: JobActionGate;
  publish?: JobActionGate;
  answer?: JobActionGate;
}

export interface JobDiffStat {
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

export interface JobPendingPrompt {
  requestId: string;
  toolName?: string;
  title?: string;
  more?: number;
  /** Additive: the prompt kind (`permission` by default). */
  kind?: string;
  /** Additive: the prompt payload as the device reported it. */
  payload?: unknown;
}

export interface JobAnswerNote {
  promptId?: string;
  /** `superagent` or `user`. */
  answeredBy?: string;
  /** `once`, `always`, `reject`, or `answered` for a question. */
  decision?: string;
  atMs?: number;
  /** Additive: the answer text of a question. */
  answer?: string;
  /** Additive: what was answered (a command, the question), shown under Details. */
  detail?: string;
}

/** The backend-projected card of one dispatched job. */
export interface JobCard {
  jobId: string;
  deviceId: string;
  deviceName: string;
  os?: string;
  hostKind?: string;
  title: string;
  state: SuperagentJobState;
  /** A stable reason code (snake_case) or a sentence. */
  stateReason?: string;
  branch?: string;
  label?: string;
  diffStat?: JobDiffStat | null;
  pendingPrompt?: JobPendingPrompt | null;
  lastAnswer?: JobAnswerNote | null;
  actions?: JobCardActions;
  /** Additive: the job's session on its device (Open goes there). */
  sessionId?: string;
  /** Additive: one live line (`cargo test 812/1400`). */
  summaryLine?: string;
  /** Additive: when the card last changed (its age). */
  updatedMs?: number;
  /** Additive: a finished job the user has seen (its check loses its color). */
  seen?: boolean;
}

export type ConversationRollup = "needs_you" | "working" | "unread" | "failed" | "none" | (string & {});

export interface ConversationSummary {
  id: string;
  title: string;
  updatedMs?: number;
  /** The cloud node's turn status (`idle`, `running`, `parked`, `failed`). */
  status?: string;
  /** The row's one mark, as the backend rolls it up. */
  rollup?: ConversationRollup;
  unread?: boolean;
}

export interface ConversationGroup {
  /** `today`, `yesterday`, `week`, `older`, or a label the backend sends as is. */
  id: string;
  label?: string;
  rows: ConversationSummary[];
}

export interface ConversationCitation {
  jobId: string;
  label?: string;
}

/** One transcript item. `jobs` (or a tool item with `jobIds`) is a stack of cards. */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "card" | "jobs" | (string & {});
  text?: string;
  atMs?: number;
  jobIds?: string[];
  citations?: ConversationCitation[];
  /** A notice card from the cloud node (`no_holder`, `quota_reached`, `model_failed` ...). */
  card?: { kind?: string } & Record<string, unknown>;
  clientMessageId?: string;
}

export interface ConversationTurn {
  id: string;
  /** `model_round`, `tools`, `parked`, `done`, `failed`, `cancelled`. */
  step: string;
  rounds?: number;
}

export interface ConversationView {
  conversation: { id: string; title: string; updatedMs?: number; turn?: ConversationTurn | null };
  messages: ConversationMessage[];
  cursor?: number;
  hasMore?: boolean;
  cards: JobCard[];
}

export interface WorkingNow {
  needsYou: JobCard[];
  working: JobCard[];
}

export interface SuperagentStatus {
  enabled: boolean;
  signedIn?: boolean;
  available?: boolean;
  reason?: string;
  placeholder?: string;
  suggestions?: string[];
  workingNow?: WorkingNow;
  deviceId?: string;
  name?: string;
}

// ── State ────────────────────────────────────────────────────────────────────

/** What the composer can do: send, or say why not (spec §4.2 signed-out / off / unavailable). */
export type SuperagentPhase = "loading" | "ready" | "signed_out" | "off" | "unavailable";

/** Why OpenBitFun is unavailable, as a stable code the scene words. */
export type SuperagentUnavailableReason =
  | "unreachable"
  | "not_provisioned"
  | "update_required"
  | "no_holder"
  | "other";

export const superagentPhase = signal<SuperagentPhase>("loading");
export const superagentUnavailable = signal<{ reason: SuperagentUnavailableReason; detail: string } | null>(null);
export const superagentStatus = signal<SuperagentStatus | null>(null);

/** The open conversation; `null` is a new conversation. */
export const activeConversationId = signal<string | null>(null);
/** The open conversation as the cloud node answered it last. */
export const conversationView = signal<ConversationView | null>(null);
export const conversationLoading = signal(false);
export const conversationError = signal("");

/** Every card the open conversation (and Working now) knows, by job id: live updates replace them in place. */
export const jobCards = signal<Record<string, JobCard>>({});

/** Text streamed for the running model round, until the persisted message replaces it. */
export const liveReply = signal("");
/** The step of the running turn (`model_round`, `tools`, `parked`), or "" when none runs. */
export const turnStep = signal("");

/** The message being sent, drawn as the user's bubble until the conversation lists it. */
export const pendingSend = signal<{ text: string; clientMessageId: string; conversationId: string | null } | null>(null);
export const sendError = signal("");
export const composerDraft = signal("");

export const conversationGroups = signal<ConversationGroup[]>([]);
export const conversationsCursor = signal<string | number | null>(null);
export const conversationsLoaded = signal(false);
export const conversationsError = signal("");

/** The card a citation chip asked to show; the scene scrolls to it and highlights it. */
export const citedJobId = signal<string | null>(null);

/** Steer outcomes by job id (`steered`, `queued`, or an error line). */
export const steerOutcomes = signal<Record<string, { kind: "sent" | "queued" | "error"; text?: string }>>({});

const FINISHED_STEPS = new Set(["", "done", "failed", "cancelled"]);

/** Whether a turn runs in the open conversation (the composer's send becomes Stop). */
export function turnRunning(): boolean {
  return !FINISHED_STEPS.has(turnStep());
}

// ── Routing ──────────────────────────────────────────────────────────────────

/** The cloud node's device id on a fleet entry; `undefined` off the fleet. */
function cloudTarget(): string | undefined {
  if (!fleetActive()) return undefined;
  return fleetDevices().find(device => device.hostKind === "cloud")?.deviceId;
}

class SuperagentUnreachable extends Error {}

function call<T>(command: string, request: Record<string, unknown> = {}): Promise<T> {
  if (fleetActive()) {
    const target = cloudTarget();
    if (!target) return Promise.reject(new SuperagentUnreachable("superagent_unreachable"));
    return invokeCommand<T>(command, request, { target });
  }
  return invokeCommand<T>(command, request);
}

function unavailableReasonOf(error: unknown): SuperagentUnavailableReason {
  if (error instanceof SuperagentUnreachable) return "unreachable";
  const message = errorMessageOf(error);
  if (fleetErrorKind(error) === FLEET_DEVICE_OFFLINE) return "unreachable";
  if (message.startsWith("superagent_not_provisioned")) return "not_provisioned";
  if (message.startsWith("no_holder")) return "no_holder";
  if (/unknown command|no fixture|unsupported|not served/i.test(message)) return "update_required";
  return "other";
}

// ── Reads ────────────────────────────────────────────────────────────────────

function cardList(value: unknown): JobCard[] {
  return Array.isArray(value) ? (value.filter(card => card && typeof card === "object" && card.jobId) as JobCard[]) : [];
}

function mergeCards(cards: JobCard[]): void {
  if (cards.length === 0) return;
  jobCards.update(current => {
    const next = { ...current };
    for (const card of cards) next[card.jobId] = card;
    return next;
  });
}

/** Reads `superagent_status`: whether the composer can send, the suggestions, Working now. */
let statusTicket = 0;

/**
 * A failed read is tried again a few times (2 s, 5 s, 10 s): the entry's
 * link to the cloud node reconnects when this client starts following it,
 * and a read in flight at that moment fails although the node is fine.
 */
const STATUS_RETRY_MS = [2000, 5000, 10000];
let statusRetries = 0;

function retryStatusLater(ticket: number): void {
  if (statusRetries >= STATUS_RETRY_MS.length) return;
  const delay = STATUS_RETRY_MS[statusRetries++];
  setTimeout(() => {
    if (ticket === statusTicket) void refreshSuperagentStatus();
  }, delay);
}

export async function refreshSuperagentStatus(): Promise<void> {
  const ticket = ++statusTicket;
  if (!fleetActive() && accountStatus()?.loggedIn === false) {
    batch(() => {
      superagentStatus.set(null);
      superagentUnavailable.set(null);
      superagentPhase.set("signed_out");
    });
    return;
  }
  try {
    const status = await call<SuperagentStatus>("superagent_status", { locale: currentLocale() });
    if (ticket !== statusTicket) return;
    statusRetries = 0;
    const workingNow = status?.workingNow;
    batch(() => {
      superagentStatus.set(status ?? null);
      if (workingNow) mergeCards([...cardList(workingNow.needsYou), ...cardList(workingNow.working)]);
      if (status?.signedIn === false) {
        superagentUnavailable.set(null);
        superagentPhase.set("signed_out");
      } else if (status?.available === false) {
        superagentUnavailable.set({ reason: "other", detail: status.reason ?? "" });
        superagentPhase.set("unavailable");
      } else if (status?.enabled === false) {
        superagentUnavailable.set(null);
        superagentPhase.set("off");
      } else {
        superagentUnavailable.set(null);
        superagentPhase.set("ready");
      }
    });
  } catch (error) {
    if (ticket !== statusTicket) return;
    batch(() => {
      superagentStatus.set(null);
      if (isAuthRequiredError(error)) {
        superagentUnavailable.set(null);
        superagentPhase.set("signed_out");
      } else {
        superagentUnavailable.set({ reason: unavailableReasonOf(error), detail: errorMessageOf(error) });
        superagentPhase.set("unavailable");
        retryStatusLater(ticket);
      }
    });
  }
}

interface ConversationsAnswer {
  conversations?: ConversationSummary[];
  groups?: ConversationGroup[];
  nextCursor?: string | number | null;
}

function groupsOf(answer: ConversationsAnswer | null | undefined): ConversationGroup[] {
  if (Array.isArray(answer?.groups)) {
    return answer.groups.filter(group => group && Array.isArray(group.rows));
  }
  // A cloud node without groups: one unlabeled group in its own order.
  const rows = Array.isArray(answer?.conversations) ? answer.conversations : [];
  return rows.length > 0 ? [{ id: "", rows }] : [];
}

/** The history read: the client's zone, so "Today" is the user's today. */
function historyRequest(): Record<string, unknown> {
  const timeZone = localTimeZone();
  return timeZone ? { timeZone } : {};
}

/** Reads the conversation history (the sidebar slot). */
let conversationsRetries = 0;

export async function refreshConversations(): Promise<void> {
  try {
    const answer = await call<ConversationsAnswer>("superagent_list_conversations", historyRequest());
    conversationsRetries = 0;
    batch(() => {
      conversationGroups.set(groupsOf(answer));
      conversationsCursor.set(answer?.nextCursor ?? null);
      conversationsLoaded.set(true);
      conversationsError.set("");
    });
  } catch (error) {
    batch(() => {
      conversationsLoaded.set(true);
      conversationsError.set(errorMessageOf(error));
    });
    // Tried again by itself like the status read (a reconnecting link).
    if (!isAuthRequiredError(error) && conversationsRetries < STATUS_RETRY_MS.length) {
      setTimeout(() => void refreshConversations(), STATUS_RETRY_MS[conversationsRetries++]);
    }
  }
}

/** "Show more": the next page the backend offered, appended in its order. */
export async function loadMoreConversations(): Promise<void> {
  const cursor = conversationsCursor();
  if (cursor === null || cursor === "") return;
  try {
    const answer = await call<ConversationsAnswer>("superagent_list_conversations", { ...historyRequest(), cursor });
    const more = groupsOf(answer);
    batch(() => {
      conversationGroups.update(current => {
        const next = current.map(group => ({ ...group, rows: [...group.rows] }));
        for (const group of more) {
          const last = next[next.length - 1];
          if (last && last.id === group.id) last.rows.push(...group.rows);
          else next.push(group);
        }
        return next;
      });
      conversationsCursor.set(answer?.nextCursor ?? null);
    });
  } catch (error) {
    conversationsError.set(errorMessageOf(error));
  }
}

let conversationTicket = 0;

/** Reads the open conversation (its items, cards and running turn). */
export async function refreshConversation(): Promise<void> {
  const id = activeConversationId();
  if (!id) return;
  const ticket = ++conversationTicket;
  if (!conversationView() || conversationView()?.conversation.id !== id) conversationLoading.set(true);
  try {
    const view = await call<ConversationView>("superagent_get_conversation", { conversationId: id });
    if (ticket !== conversationTicket || activeConversationId() !== id) return;
    const messages = Array.isArray(view?.messages) ? view.messages : [];
    batch(() => {
      conversationView.set({
        conversation: view?.conversation ?? { id, title: "" },
        messages,
        cursor: view?.cursor,
        hasMore: view?.hasMore,
        cards: cardList(view?.cards),
      });
      mergeCards(cardList(view?.cards));
      turnStep.set(view?.conversation?.turn?.step ?? "");
      liveReply.set("");
      conversationError.set("");
      const pending = pendingSend();
      if (pending && messages.some(message => message.clientMessageId === pending.clientMessageId)) {
        pendingSend.set(null);
      }
    });
  } catch (error) {
    if (ticket !== conversationTicket) return;
    conversationError.set(errorMessageOf(error));
  } finally {
    if (ticket === conversationTicket) conversationLoading.set(false);
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

/** Starts a new conversation (sidebar ✎, ⌘N, phone top bar). */
export function newConversation(): void {
  batch(() => {
    activeConversationId.set(null);
    conversationView.set(null);
    conversationError.set("");
    liveReply.set("");
    turnStep.set("");
    sendError.set("");
    citedJobId.set(null);
    if (pendingSend()?.conversationId !== null) pendingSend.set(null);
  });
  void refreshSuperagentStatus();
}

/** Opens one conversation from the history. */
export function openConversation(id: string): void {
  if (activeConversationId() === id && conversationView()) return;
  batch(() => {
    activeConversationId.set(id);
    conversationView.set(null);
    conversationError.set("");
    liveReply.set("");
    turnStep.set("");
    sendError.set("");
    citedJobId.set(null);
  });
  void refreshConversation();
}

// ── Actions ──────────────────────────────────────────────────────────────────

let clientSeq = 0;

function newClientMessageId(): string {
  clientSeq += 1;
  return `ui-${Date.now().toString(36)}-${clientSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sends the composer's text to OpenBitFun. The same text sent again after a
 * failure keeps its `clientMessageId`, so the cloud node answers it once.
 */
export async function sendToSuperagent(text?: string): Promise<boolean> {
  const message = (text ?? composerDraft()).trim();
  if (!message || superagentPhase() !== "ready") return false;
  const conversationId = activeConversationId();
  const previous = pendingSend();
  const clientMessageId =
    previous && previous.text === message && previous.conversationId === conversationId
      ? previous.clientMessageId
      : newClientMessageId();
  batch(() => {
    pendingSend.set({ text: message, clientMessageId, conversationId });
    sendError.set("");
    composerDraft.set("");
    turnStep.set("model_round");
  });
  try {
    const answer = await call<{ conversationId?: string; turnId?: string }>("superagent_send", {
      ...(conversationId ? { conversationId } : {}),
      message,
      clientMessageId,
    });
    const id = answer?.conversationId ?? conversationId;
    if (id && id !== activeConversationId()) {
      batch(() => {
        activeConversationId.set(id);
        if (pendingSend()) pendingSend.set({ text: message, clientMessageId, conversationId: id });
      });
    }
    void refreshConversation();
    void refreshConversations();
    return true;
  } catch (error) {
    batch(() => {
      sendError.set(errorMessageOf(error));
      turnStep.set("");
      // Give the text back so the user can send it again with the same id.
      if (!composerDraft()) composerDraft.set(message);
    });
    return false;
  }
}

/** Stops the running turn; jobs it started keep running on their devices. */
export async function cancelTurn(): Promise<void> {
  const id = activeConversationId();
  if (!id) return;
  try {
    await call<unknown>("superagent_cancel_turn", { conversationId: id });
    turnStep.set("cancelled");
    void refreshConversation();
  } catch (error) {
    sendError.set(errorMessageOf(error));
  }
}

/** Stops one job (no confirm for one job). Resolves `true` once the cloud node took it. */
export async function stopJob(jobId: string): Promise<boolean> {
  try {
    const answer = await call<{ card?: JobCard }>("superagent_job_action", { jobId, action: "cancel" });
    if (answer?.card?.jobId) mergeCards([answer.card]);
    return true;
  } catch (error) {
    steerOutcomes.update(current => ({ ...current, [jobId]: { kind: "error", text: errorMessageOf(error) } }));
    return false;
  }
}

/** Steers one job with a line of text; the host answers started, steered or queued. */
export async function steerJob(jobId: string, text: string): Promise<boolean> {
  const message = text.trim();
  if (!message) return false;
  try {
    const answer = await call<{ outcome?: string; card?: JobCard }>("superagent_job_action", {
      jobId,
      action: "message",
      text: message,
      clientMessageId: newClientMessageId(),
    });
    if (answer?.card?.jobId) mergeCards([answer.card]);
    steerOutcomes.update(current => ({
      ...current,
      [jobId]: { kind: answer?.outcome === "queued" ? "queued" : "sent" },
    }));
    return true;
  } catch (error) {
    steerOutcomes.update(current => ({ ...current, [jobId]: { kind: "error", text: errorMessageOf(error) } }));
    return false;
  }
}

export function clearSteerOutcome(jobId: string): void {
  steerOutcomes.update(current => {
    if (!(jobId in current)) return current;
    const next = { ...current };
    delete next[jobId];
    return next;
  });
}

export async function enableSuperagent(): Promise<void> {
  try {
    await call<unknown>("superagent_enable", {});
  } catch (error) {
    superagentUnavailable.set({ reason: unavailableReasonOf(error), detail: errorMessageOf(error) });
    superagentPhase.set("unavailable");
    return;
  }
  await refreshSuperagentStatus();
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await call<unknown>("superagent_rename_conversation", { conversationId: id, title });
  await Promise.allSettled([refreshConversations(), activeConversationId() === id ? refreshConversation() : null]);
}

export async function deleteConversation(id: string): Promise<void> {
  await call<unknown>("superagent_delete_conversation", { conversationId: id });
  if (activeConversationId() === id) newConversation();
  await refreshConversations();
}

/**
 * The prompt a blocked card waits on, as the Inbox knows it (same device,
 * same job), or one built from the card's own `pendingPrompt`.
 */
export function cardPrompt(card: JobCard, prompts: FleetPrompt[]): FleetPrompt | null {
  if (card.state !== "blocked" || !card.pendingPrompt) return null;
  const known = prompts.find(prompt => prompt.jobId === card.jobId && prompt.deviceId === card.deviceId);
  if (known) return known;
  const pending = card.pendingPrompt;
  return {
    deviceId: card.deviceId,
    workspaceId: "",
    sessionId: card.sessionId ?? "",
    kind: pending.kind ?? "permission",
    promptId: pending.requestId,
    revision: 0,
    title: pending.title ?? card.title,
    toolName: pending.toolName,
    payload: pending.payload,
    payloadTruncated: false,
    answerable: card.actions?.answer?.allowed !== false,
    unanswerableReason: card.actions?.answer?.reason,
    answerRoute: "dispatch",
    jobId: card.jobId,
  };
}

// ── Events ───────────────────────────────────────────────────────────────────

interface TurnDelta {
  conversationId?: string;
  turnId?: string | null;
  step?: string | null;
  text?: string | null;
  messageCount?: number;
}

interface CardChanged {
  conversationId?: string;
  card?: JobCard;
  deleted?: boolean;
}

let conversationRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleConversationRefresh(): void {
  if (conversationRefreshTimer) return;
  conversationRefreshTimer = setTimeout(() => {
    conversationRefreshTimer = null;
    void refreshConversation();
  }, 60);
}

function onTurnDelta(payload: TurnDelta): void {
  if (!payload) return;
  const open = activeConversationId();
  if (payload.conversationId && payload.conversationId === open) {
    if (typeof payload.text === "string" && payload.text) {
      batch(() => {
        liveReply.update(current => current + payload.text);
        if (payload.step) turnStep.set(payload.step);
      });
    } else {
      if (payload.step) turnStep.set(payload.step);
      scheduleConversationRefresh();
    }
  }
  if (typeof payload.text !== "string" || !payload.text) {
    // A step change moves the history row's mark.
    void refreshConversations();
    void refreshSuperagentStatus();
  }
}

function onCardChanged(payload: CardChanged): void {
  if (payload?.deleted) {
    batch(() => {
      jobCards.set({});
      conversationGroups.set([]);
    });
    newConversation();
    void refreshConversations();
    return;
  }
  const card = payload?.card;
  if (!card?.jobId) return;
  mergeCards([card]);
  void refreshSuperagentStatus();
}

let started = false;

/**
 * Starts following the cloud node once per app: the first reads, the two
 * event streams, and a fresh read when the cloud node appears in the fleet
 * index or the account signs in or out.
 */
export function startSuperagentStore(): void {
  if (started) return;
  started = true;
  listenEvent<TurnDelta>(SUPERAGENT_TURN_DELTA_EVENT, payload => onTurnDelta(payload));
  listenEvent<CardChanged>(SUPERAGENT_CARD_CHANGED_EVENT, payload => onCardChanged(payload));
  let lastKey: string | null = null;
  effect(() => {
    const key = `${fleetActive() ? "fleet" : "plain"}:${cloudTarget() ?? ""}:${accountStatus()?.loggedIn ?? "?"}`;
    if (key === lastKey) return;
    lastKey = key;
    untracked(() => {
      void refreshSuperagentStatus();
      void refreshConversations();
      if (activeConversationId()) void refreshConversation();
    });
  });
}

/** Test hook: forgets everything the store holds. */
export function resetSuperagentStoreForTests(): void {
  statusRetries = 0;
  conversationsRetries = 0;
  batch(() => {
    superagentPhase.set("loading");
    superagentUnavailable.set(null);
    superagentStatus.set(null);
    activeConversationId.set(null);
    conversationView.set(null);
    jobCards.set({});
    liveReply.set("");
    turnStep.set("");
    pendingSend.set(null);
    sendError.set("");
    composerDraft.set("");
    conversationGroups.set([]);
    conversationsCursor.set(null);
    conversationsLoaded.set(false);
    citedJobId.set(null);
    steerOutcomes.set({});
  });
}

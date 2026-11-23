// AskUserQuestion prompts.
//
// A question is a blocking interaction like a permission prompt: the agent's tool
// call waits for an answer, and until one arrives the turn cannot finish. The host
// keeps that wait in a mailbox per session, so this store reads the mailbox when a
// session opens (recovering questions whose event was missed) and answers through
// the same positional command the desktop surface uses.
//
// The payload shape comes from the Runtime's own DTOs: `questions` is
// `{ questions: [{question, header, options: [{label, description}], multiSelect}],
// responseHostNowMs, responseDeadlineMs }`, and the answer map is keyed by the
// question's index as a string, holding a label or a list of labels.

import { tr } from "./i18n";
import { signal } from "nsh";
import { fleetActive, invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { activeSessionDevice, activeSessionId, deviceOfSession, reportError } from "./state";

export interface QuestionOptionView {
  label: string;
  description: string;
}

export interface QuestionView {
  question: string;
  header: string;
  multiSelect: boolean;
  options: QuestionOptionView[];
}

export interface QuestionPrompt {
  toolId: string;
  sessionId: string;
  /** The device whose runtime asked (`EventMeta.origin`; `""` without the fleet layer). */
  deviceId: string;
  questions: QuestionView[];
  /** The host's own deadline, when it set one; 0 means it waits for an answer. */
  deadlineMs: number;
  /**
   * Local wall-clock timestamp (ms) calibrated once from `(responseDeadlineMs - responseHostNowMs)`
   * so client/host clock skew never distorts the countdown; 0 when no countdown runs.
   */
  localDeadlineMs: number;
  /** True once the user begins interacting with this prompt (pausing the host timeout). */
  interactionStarted: boolean;
  /** A draft per question: a label, or the labels of a multi-select answer. */
  answers: Record<string, string | string[]>;
  /** Free text per question, used when the picked label is "Other". */
  others: Record<string, string>;
  error: string;
  submitting: boolean;
  /** When this prompt entered the store, so a slow mailbox read cannot drop it. */
  seenAt: number;
}

export const questionPrompts = signal<QuestionPrompt[]>([]);
/** The label the desktop surface adds for a typed answer. */
const OTHER_LABEL = "Other";

let listening = false;
/** Arrival order of prompts, so a mailbox read can tell "already known" from "new". */
let arrivals = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readQuestions(payload: unknown): QuestionView[] {
  const record = asRecord(payload);
  const list = Array.isArray(record.questions) ? record.questions : [];
  return list.flatMap((candidate): QuestionView[] => {
    const question = asRecord(candidate);
    if (typeof question.question !== "string" && typeof question.header !== "string") return [];
    const options = Array.isArray(question.options) ? question.options : [];
    return [
      {
        question: typeof question.question === "string" ? question.question : "",
        header: typeof question.header === "string" ? question.header : "",
        multiSelect: question.multiSelect === true,
        options: options.flatMap((option): QuestionOptionView[] => {
          const entry = asRecord(option);
          if (typeof entry.label !== "string") return [];
          return [
            {
              label: entry.label,
              description: typeof entry.description === "string" ? entry.description : "",
            },
          ];
        }),
      },
    ];
  });
}

function readDeadlineTiming(
  payload: unknown,
  started: boolean,
): { deadlineMs: number; localDeadlineMs: number } {
  if (started) return { deadlineMs: 0, localDeadlineMs: 0 };
  const record = asRecord(payload);
  const deadline = record.responseDeadlineMs ?? record.response_deadline_ms;
  if (typeof deadline !== "number" || !Number.isFinite(deadline) || deadline <= 0) {
    return { deadlineMs: 0, localDeadlineMs: 0 };
  }
  const hostNow = record.responseHostNowMs ?? record.response_host_now_ms;
  const remainingMs =
    typeof hostNow === "number" && Number.isFinite(hostNow) && hostNow > 0
      ? Math.max(0, deadline - hostNow)
      : Math.max(0, deadline - Date.now());
  return {
    deadlineMs: deadline,
    localDeadlineMs: Date.now() + remainingMs,
  };
}

function toPrompt(
  toolId: string,
  sessionId: string,
  questions: unknown,
  deviceId: string,
  started = false,
): QuestionPrompt | null {
  const views = readQuestions(questions);
  if (views.length === 0) return null;
  const { deadlineMs, localDeadlineMs } = readDeadlineTiming(questions, started);
  return {
    toolId,
    sessionId,
    deviceId,
    questions: views,
    deadlineMs,
    localDeadlineMs,
    interactionStarted: started,
    answers: {},
    others: {},
    error: "",
    submitting: false,
    seenAt: ++arrivals,
  };
}

/** A prompt's identity: tool ids are unique per device's runtime only. */
function promptKey(prompt: { toolId: string; deviceId: string }): string {
  return `${prompt.deviceId}/${prompt.toolId}`;
}

function upsert(prompt: QuestionPrompt): void {
  const key = promptKey(prompt);
  questionPrompts.update(current => {
    const existing = current.find(item => promptKey(item) === key);
    if (!existing) return [...current, prompt];
    // A republished question keeps whatever the user already picked.
    if (existing.questions.length === prompt.questions.length) return current;
    return current.map(item => (promptKey(item) === key ? prompt : item));
  });
}

function drop(key: string): void {
  questionPrompts.update(current => current.filter(item => promptKey(item) !== key));
}

/** The prompt a tool id names: the open session's device first, then any device. */
function findPrompt(toolId: string): QuestionPrompt | undefined {
  const all = questionPrompts();
  return (
    all.find(item => item.toolId === toolId && item.deviceId === activeSessionDevice()) ??
    all.find(item => item.toolId === toolId)
  );
}

/**
 * Tells the host that the user began interacting with this question, which
 * pauses/cancels the host's unattended auto-timeout deadline (`user_questions.rs::start_interaction`).
 * Must ONLY be called on actual user interaction (selecting an option or typing),
 * never automatically on question arrival — otherwise unattended auto-timeout breaks.
 */
const interactionStarted = new Set<string>();

async function startInteraction(prompt: QuestionPrompt): Promise<void> {
  const key = promptKey(prompt);
  if (interactionStarted.has(key)) return;
  interactionStarted.add(key);
  try {
    await invokeCommand<unknown>(
      "start_user_question_interaction",
      { sessionId: prompt.sessionId, toolId: prompt.toolId },
      prompt.deviceId ? { target: prompt.deviceId } : undefined,
    );
  } catch {
    // An older host has no such command; the question is still answerable.
  }
}

/** Drops a single pending question prompt when its tool finishes, times out, or is cancelled. */
export function dropQuestionByToolId(toolId: string, deviceId?: string): void {
  if (!toolId) return;
  questionPrompts.update(current =>
    current.filter(item => {
      if (item.toolId !== toolId) return true;
      if (deviceId !== undefined && item.deviceId !== deviceId) return true;
      interactionStarted.delete(promptKey(item));
      return false;
    }),
  );
}

/** Drops every pending question prompt belonging to a session (e.g. when the turn stops or ends). */
export function clearQuestionsForSession(sessionId: string | null | undefined, deviceId?: string): void {
  if (!sessionId) return;
  questionPrompts.update(current =>
    current.filter(item => {
      if (item.sessionId !== sessionId) return true;
      if (deviceId !== undefined && item.deviceId !== deviceId) return true;
      interactionStarted.delete(promptKey(item));
      return false;
    }),
  );
}

/** Subscribes once, and seeds from the mailbox of whichever session is opened. */
export async function startQuestionPrompts(): Promise<void> {
  if (listening) return;
  listening = true;
  listenEvent<Record<string, unknown>>("backend-event-toolawaitinguserinput", (payload, meta) => {
    const value = asRecord(asRecord(payload).value ?? payload);
    // Real Rust `BackendEvent::ToolAwaitingUserInput` serializes snake_case
    // (`tool_id`, `session_id`); also accept camelCase from fixtures/newer bridges.
    const toolId =
      typeof value.tool_id === "string"
        ? value.tool_id
        : typeof value.toolId === "string"
          ? value.toolId
          : "";
    const sessionId =
      typeof value.session_id === "string"
        ? value.session_id
        : typeof value.sessionId === "string"
          ? value.sessionId
          : "";
    if (!toolId) return;
    const prompt = toPrompt(toolId, sessionId, value.questions, meta.origin, false);
    if (!prompt) return;
    upsert(prompt);
  });
}

/**
 * Drops cached prompts: every one (a host this surface just left, the legacy
 * Peer Device switch), or only one device's (`origin`, a gap in its events;
 * its mailbox is read again when its session opens or re-hydrates).
 */
export function resetQuestionPrompts(origin?: string): void {
  if (origin !== undefined && fleetActive()) {
    questionPrompts.update(current => current.filter(item => item.deviceId !== origin));
    for (const key of [...interactionStarted]) if (key.startsWith(`${origin}/`)) interactionStarted.delete(key);
    return;
  }
  questionPrompts.set([]);
  interactionStarted.clear();
}

/**
 * Reads the host's mailbox for one session. This is the recovery path: a question
 * asked while this surface was on another session, or before it loaded, is
 * otherwise invisible and the turn stays stuck.
 */
export async function loadQuestionMailbox(sessionId: string, deviceId?: string): Promise<void> {
  if (!sessionId) return;
  const device = deviceId ?? (sessionId === activeSessionId() ? activeSessionDevice() : deviceOfSession(sessionId));
  // Prompts that arrive while this read is in flight are newer than the snapshot.
  const startedAt = arrivals;
  try {
    const snapshot = asRecord(
      await invokeCommand<unknown>(
        "get_session_interaction_mailbox",
        { sessionId },
        device ? { target: device } : undefined,
      ),
    );
    const mailbox = asRecord(snapshot.userQuestions ?? snapshot.user_questions);
    const pending = Array.isArray(mailbox.questions) ? mailbox.questions : [];
    const readToolId = (entry: unknown): string => {
      const rec = asRecord(entry);
      if (typeof rec.toolId === "string") return rec.toolId;
      if (typeof rec.tool_id === "string") return rec.tool_id;
      return "";
    };
    const known = new Set(pending.map(readToolId));
    // Questions of other sessions are not this surface's to show, and one asked
    // while this read was in flight is kept: the snapshot simply cannot know it.
    questionPrompts.update(current =>
      current.filter(
        item =>
          item.sessionId !== sessionId ||
          item.deviceId !== device ||
          item.seenAt > startedAt ||
          known.has(item.toolId),
      ),
    );
    for (const entry of pending) {
      const record = asRecord(entry);
      const toolId = readToolId(entry);
      if (!toolId) continue;
      const alreadyStarted = record.interactionStarted === true || record.interaction_started === true;
      const prompt = toPrompt(toolId, sessionId, record.questions, device, alreadyStarted);
      if (!prompt) continue;
      if (alreadyStarted) interactionStarted.add(promptKey(prompt));
      upsert(prompt);
    }
  } catch {
    // A host without the mailbox keeps the event path only.
  }
}

function patch(toolId: string, change: (prompt: QuestionPrompt) => QuestionPrompt): void {
  const target = findPrompt(toolId);
  if (!target) return;
  const key = promptKey(target);
  questionPrompts.update(current =>
    current.map(item => (promptKey(item) === key ? change(item) : item)),
  );
}

function markUserInteracted(toolId: string): void {
  const target = findPrompt(toolId);
  if (!target) return;
  void startInteraction(target);
}

export function toggleQuestionOption(toolId: string, index: number, label: string): void {
  markUserInteracted(toolId);
  patch(toolId, prompt => {
    const question = prompt.questions[index];
    if (!question) return prompt;
    const key = String(index);
    if (question.multiSelect) {
      const current = Array.isArray(prompt.answers[key]) ? (prompt.answers[key] as string[]) : [];
      const next = current.includes(label)
        ? current.filter(value => value !== label)
        : [...current, label];
      return {
        ...prompt,
        interactionStarted: true,
        localDeadlineMs: 0,
        answers: { ...prompt.answers, [key]: next },
        error: "",
      };
    }
    return {
      ...prompt,
      interactionStarted: true,
      localDeadlineMs: 0,
      answers: { ...prompt.answers, [key]: label },
      error: "",
    };
  });
}

export function setQuestionOther(toolId: string, index: number, text: string): void {
  markUserInteracted(toolId);
  patch(toolId, prompt => ({
    ...prompt,
    interactionStarted: true,
    localDeadlineMs: 0,
    others: { ...prompt.others, [String(index)]: text },
    error: "",
  }));
}

function isAnswered(prompt: QuestionPrompt, index: number): boolean {
  const answer = prompt.answers[String(index)];
  const other = (prompt.others[String(index)] ?? "").trim();
  if (Array.isArray(answer)) {
    if (answer.length === 0) return false;
    // "Other" carries no label of its own; the typed text is the answer.
    return answer.some(value => value !== OTHER_LABEL || other.length > 0);
  }
  if (typeof answer !== "string" || answer === "") return false;
  return answer !== OTHER_LABEL || other.length > 0;
}

export function canSubmitQuestion(prompt: QuestionPrompt): boolean {
  return prompt.questions.every((_question, index) => isAnswered(prompt, index));
}

/**
 * Sends the answers in the shape the Runtime expects: question index as the key,
 * the label (or labels) as the value, with a typed "Other" answer standing in for
 * the label the surface added.
 */
function buildAnswers(prompt: QuestionPrompt): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};
  prompt.questions.forEach((_question, index) => {
    const key = String(index);
    const answer = prompt.answers[key];
    const other = (prompt.others[key] ?? "").trim();
    if (Array.isArray(answer)) {
      const values = answer.flatMap(value =>
        value === OTHER_LABEL ? (other ? [other] : []) : [value],
      );
      if (values.length > 0) answers[key] = values;
      return;
    }
    if (typeof answer !== "string" || answer === "") return;
    answers[key] = answer === OTHER_LABEL ? other : answer;
  });
  return answers;
}

export async function submitQuestion(toolId: string): Promise<void> {
  const prompt = findPrompt(toolId);
  if (!prompt || prompt.submitting) return;
  if (!canSubmitQuestion(prompt)) {
    patch(toolId, item => ({ ...item, error: tr("chat.question.answerAll") }));
    return;
  }
  patch(toolId, item => ({ ...item, submitting: true, error: "" }));
  try {
    // Positional: `tool_id` and `answers` are separate arguments on the host, not
    // one request struct.
    // The answer goes to the device whose tool future is waiting.
    await invokeRawCommand(
      "submit_user_answers",
      { toolId, answers: buildAnswers(prompt), sessionId: prompt.sessionId },
      prompt.deviceId ? { target: prompt.deviceId } : undefined,
    );
    drop(promptKey(prompt));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    patch(toolId, item => ({ ...item, submitting: false, error: message }));
    reportError(message);
  }
}

/** The prompts this surface should show for one session. */
export function questionsForSession(sessionId: string | null): QuestionPrompt[] {
  if (!sessionId) return [];
  const device = sessionId === activeSessionId() ? activeSessionDevice() : null;
  return questionPrompts().filter(
    prompt => prompt.sessionId === sessionId && (device === null || prompt.deviceId === device),
  );
}

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
import { invokeCommand, invokeRawCommand, listenEvent } from "./bridge";
import { reportError } from "./state";

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
  questions: QuestionView[];
  /** The host's own deadline, when it set one; 0 means it waits for an answer. */
  deadlineMs: number;
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

function readDeadline(payload: unknown): number {
  const record = asRecord(payload);
  const deadline = record.responseDeadlineMs ?? record.response_deadline_ms;
  return typeof deadline === "number" && Number.isFinite(deadline) ? deadline : 0;
}

function toPrompt(toolId: string, sessionId: string, questions: unknown): QuestionPrompt | null {
  const views = readQuestions(questions);
  if (views.length === 0) return null;
  return {
    toolId,
    sessionId,
    questions: views,
    deadlineMs: readDeadline(questions),
    answers: {},
    others: {},
    error: "",
    submitting: false,
    seenAt: ++arrivals,
  };
}

function upsert(prompt: QuestionPrompt): void {
  questionPrompts.update(current => {
    const existing = current.find(item => item.toolId === prompt.toolId);
    if (!existing) return [...current, prompt];
    // A republished question keeps whatever the user already picked.
    if (existing.questions.length === prompt.questions.length) return current;
    return current.map(item => (item.toolId === prompt.toolId ? prompt : item));
  });
}

function drop(toolId: string): void {
  questionPrompts.update(current => current.filter(item => item.toolId !== toolId));
}

/**
 * The host starts an unattended-answer deadline only once a surface reports that
 * it is showing the question. Without this the question waits forever with no
 * timeout, which is worse for a remote controller than a deadline. A question can
 * be read twice — the event and the mailbox — so it is reported once per tool.
 */
const interactionStarted = new Set<string>();

async function startInteraction(prompt: QuestionPrompt): Promise<void> {
  if (interactionStarted.has(prompt.toolId)) return;
  interactionStarted.add(prompt.toolId);
  try {
    await invokeCommand<unknown>("start_user_question_interaction", {
      sessionId: prompt.sessionId,
      toolId: prompt.toolId,
    });
  } catch {
    // An older host has no such command; the question is still answerable.
  }
}

/** Subscribes once, and seeds from the mailbox of whichever session is opened. */
export async function startQuestionPrompts(): Promise<void> {
  if (listening) return;
  listening = true;
  listenEvent<Record<string, unknown>>("backend-event-toolawaitinguserinput", payload => {
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
    const prompt = toPrompt(toolId, sessionId, value.questions);
    if (!prompt) return;
    upsert(prompt);
    void startInteraction(prompt);
  });
}

/** Drops prompts cached from a host this surface just left (e.g. Peer Device switch). */
export function resetQuestionPrompts(): void {
  questionPrompts.set([]);
  interactionStarted.clear();
}

/**
 * Reads the host's mailbox for one session. This is the recovery path: a question
 * asked while this surface was on another session, or before it loaded, is
 * otherwise invisible and the turn stays stuck.
 */
export async function loadQuestionMailbox(sessionId: string): Promise<void> {
  if (!sessionId) return;
  // Prompts that arrive while this read is in flight are newer than the snapshot.
  const startedAt = arrivals;
  try {
    const snapshot = asRecord(await invokeCommand<unknown>("get_session_interaction_mailbox", { sessionId }));
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
          item.sessionId !== sessionId || item.seenAt > startedAt || known.has(item.toolId),
      ),
    );
    for (const entry of pending) {
      const record = asRecord(entry);
      const toolId = readToolId(entry);
      if (!toolId) continue;
      const prompt = toPrompt(toolId, sessionId, record.questions);
      if (!prompt) continue;
      upsert(prompt);
      if (record.interactionStarted !== true && record.interaction_started !== true) {
        void startInteraction(prompt);
      }
    }
  } catch {
    // A host without the mailbox keeps the event path only.
  }
}

function patch(toolId: string, change: (prompt: QuestionPrompt) => QuestionPrompt): void {
  questionPrompts.update(current =>
    current.map(item => (item.toolId === toolId ? change(item) : item)),
  );
}

export function toggleQuestionOption(toolId: string, index: number, label: string): void {
  patch(toolId, prompt => {
    const question = prompt.questions[index];
    if (!question) return prompt;
    const key = String(index);
    if (question.multiSelect) {
      const current = Array.isArray(prompt.answers[key]) ? (prompt.answers[key] as string[]) : [];
      const next = current.includes(label)
        ? current.filter(value => value !== label)
        : [...current, label];
      return { ...prompt, answers: { ...prompt.answers, [key]: next }, error: "" };
    }
    return { ...prompt, answers: { ...prompt.answers, [key]: label }, error: "" };
  });
}

export function setQuestionOther(toolId: string, index: number, text: string): void {
  patch(toolId, prompt => ({
    ...prompt,
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
  const prompt = questionPrompts().find(item => item.toolId === toolId);
  if (!prompt || prompt.submitting) return;
  if (!canSubmitQuestion(prompt)) {
    patch(toolId, item => ({ ...item, error: tr("chat.question.answerAll") }));
    return;
  }
  patch(toolId, item => ({ ...item, submitting: true, error: "" }));
  try {
    // Positional: `tool_id` and `answers` are separate arguments on the host, not
    // one request struct.
    await invokeRawCommand("submit_user_answers", {
      toolId,
      answers: buildAnswers(prompt),
      sessionId: prompt.sessionId,
    });
    drop(toolId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    patch(toolId, item => ({ ...item, submitting: false, error: message }));
    reportError(message);
  }
}

/** The prompts this surface should show for one session. */
export function questionsForSession(sessionId: string | null): QuestionPrompt[] {
  if (!sessionId) return [];
  return questionPrompts().filter(prompt => prompt.sessionId === sessionId);
}

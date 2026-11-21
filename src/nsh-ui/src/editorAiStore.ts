// Inline AI in the Markdown document editor, over the backend's ephemeral
// `editor_ai_stream` / `editor_ai_cancel` commands.
//
// The device that owns the document answers: the command goes through the
// bridge like every file command, so a phone or a browser drives the model of
// the device the workspace lives on. The backend creates no session and keeps
// nothing; it streams `editor-ai://text-chunk`, then `editor-ai://completed` or
// `editor-ai://error`, each carrying the request id this store made. The store
// only holds the answer until the user inserts or discards it.

import { signal } from "nsh";
import { invokeCommand, listenEvent } from "./bridge";

export type InlineAiStatus = "streaming" | "ready" | "failed";

export interface InlineAiState {
  /** The editor (document) the answer belongs to. */
  documentKey: string;
  requestId: string;
  /** What the user asked. */
  instruction: string;
  status: InlineAiStatus;
  /** The answer so far (the whole answer once ready). */
  text: string;
  /** The host's own words when it failed. */
  error: string | null;
  /** Whether the answer replaces a selection or goes in at the caret. */
  replacesSelection: boolean;
}

/** The open answer, if any; one document asks at a time. */
export const inlineAi = signal<InlineAiState | null>(null);

/** The editor whose "Ask AI" field is open, with what it was opened over. */
export const inlineAiComposer = signal<{ documentKey: string; selection: string } | null>(null);

interface TextChunkEvent {
  requestId?: string;
  text?: string;
}
interface CompletedEvent {
  requestId?: string;
  fullText?: string;
}
interface ErrorEvent {
  requestId?: string;
  error?: string;
}

let unlisten: Array<() => void> = [];
let requestSeq = 0;

function stopListening(): void {
  for (const off of unlisten) {
    try {
      off();
    } catch {
      // A listener that is already gone has nothing to stop.
    }
  }
  unlisten = [];
}

function updateFor(requestId: string, change: (state: InlineAiState) => InlineAiState): void {
  inlineAi.update(current => (current && current.requestId === requestId ? change(current) : current));
}

/** Most of the document the prompt carries; the rest is cut around the caret. */
const PROMPT_DOCUMENT_CHARS = 12000;

export interface InlineAiPromptInput {
  instruction: string;
  documentName: string;
  document: string;
  selection: string;
}

/**
 * The prompt `editor_ai_stream` takes. The backend adds its own system prompt
 * ("return only the requested document content"); this names the document,
 * the passage and what the user asked.
 */
export function buildInlineAiPrompt(input: InlineAiPromptInput): string {
  const doc = input.document.length > PROMPT_DOCUMENT_CHARS
    ? `${input.document.slice(0, PROMPT_DOCUMENT_CHARS)}\n…`
    : input.document;
  const lines = [
    `You are editing the Markdown document "${input.documentName}".`,
    input.selection.trim()
      ? "Rewrite the selected passage as the request asks. Return only the Markdown that replaces it."
      : "Write what the request asks for, to insert at the cursor. Return only the Markdown to insert.",
    "Keep the document's language and style.",
    "",
    `Request: ${input.instruction.trim()}`,
  ];
  if (input.selection.trim()) {
    lines.push("", "Selected passage:", "<<<", input.selection, ">>>");
  }
  lines.push("", "Document:", "<<<", doc, ">>>");
  return lines.join("\n");
}

/** Opens the "Ask AI" field of one editor. */
export function openInlineAiComposer(documentKey: string, selection: string): void {
  inlineAiComposer.set({ documentKey, selection });
}

export function closeInlineAiComposer(): void {
  inlineAiComposer.set(null);
}

/** Asks the document's device for an answer and streams it into `inlineAi`. */
export async function askInlineAi(
  documentKey: string,
  prompt: InlineAiPromptInput,
): Promise<void> {
  if (!prompt.instruction.trim()) return;
  await cancelInlineAi();
  requestSeq += 1;
  const requestId = `editor-ai-${Date.now().toString(36)}-${requestSeq}`;
  inlineAi.set({
    documentKey,
    requestId,
    instruction: prompt.instruction.trim(),
    status: "streaming",
    text: "",
    error: null,
    replacesSelection: Boolean(prompt.selection.trim()),
  });
  unlisten = [
    listenEvent<TextChunkEvent>("editor-ai://text-chunk", payload => {
      if (payload?.requestId !== requestId || typeof payload.text !== "string") return;
      const chunk = payload.text;
      updateFor(requestId, state => ({ ...state, text: state.text + chunk }));
    }),
    listenEvent<CompletedEvent>("editor-ai://completed", payload => {
      if (payload?.requestId !== requestId) return;
      updateFor(requestId, state => ({
        ...state,
        status: "ready",
        text: typeof payload.fullText === "string" && payload.fullText ? payload.fullText : state.text.trim(),
      }));
      stopListening();
    }),
    listenEvent<ErrorEvent>("editor-ai://error", payload => {
      if (payload?.requestId !== requestId) return;
      updateFor(requestId, state => ({ ...state, status: "failed", error: String(payload.error ?? "") }));
      stopListening();
    }),
  ];
  try {
    await invokeCommand<unknown>("editor_ai_stream", {
      requestId,
      prompt: buildInlineAiPrompt(prompt),
    });
  } catch (error) {
    updateFor(requestId, state => ({
      ...state,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    stopListening();
  }
}

/** Stops a running answer on its device and forgets it. */
export async function cancelInlineAi(): Promise<void> {
  const current = inlineAi();
  stopListening();
  inlineAi.set(null);
  if (!current || current.status !== "streaming") return;
  try {
    await invokeCommand<unknown>("editor_ai_cancel", { requestId: current.requestId });
  } catch {
    // The answer is dropped here either way; a host that already finished has nothing to cancel.
  }
}

/** The answer was inserted: forget it without cancelling anything. */
export function finishInlineAi(): void {
  stopListening();
  inlineAi.set(null);
  inlineAiComposer.set(null);
}

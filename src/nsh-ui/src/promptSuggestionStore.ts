// Per-session next-input prompt suggestion state.
//
// After a completed turn, the host generates one plain-text next-input
// suggestion, persists it onto `SessionMetadata.lastPromptSuggestion`, and
// emits `agentic://prompt-suggestion`. Opening a session after a restart or
// device switch hydrates the persisted suggestion from
// `get_session_transcript_view`.

import { signal } from "nsh";
import { getConfig, type TranscriptPromptSuggestion, type TranscriptTurnView } from "./api";
import { deviceContext } from "./state";

export interface PromptSuggestionEntry {
  sourceTurnId: string;
  suggestion: string;
}

const PROMPT_SUGGESTION_CONFIG_PATH = "app.ai_experience.enable_prompt_suggestion";

/** `"<deviceId>/<sessionId>"` → last prompt suggestion for that session. */
export const promptSuggestions = signal<Record<string, PromptSuggestionEntry>>({});

/** Tracks whether `app.ai_experience.enable_prompt_suggestion` is enabled (defaults to true). */
export const promptSuggestionsEnabled = signal<boolean>(true);

let configHydrated = false;

function suggestionKey(sessionId: string, deviceId?: string): string {
  const scope = deviceId ?? deviceContext();
  return `${scope}/${sessionId}`;
}

/** Reads `app.ai_experience.enable_prompt_suggestion` once on startup so disabled hosts hide suggestions immediately. */
export function ensurePromptSuggestionSettingLoaded(): void {
  if (configHydrated) return;
  configHydrated = true;
  void getConfig(PROMPT_SUGGESTION_CONFIG_PATH, true)
    .then(raw => {
      if (typeof raw === "boolean") {
        setPromptSuggestionsEnabled(raw);
      }
    })
    .catch(() => {
      // Hosts without this config path default to enabled, matching Rust `.unwrap_or(true)`.
    });
}

/** Updates enablement live (e.g. when Settings toggles `app.ai_experience.enable_prompt_suggestion`). */
export function setPromptSuggestionsEnabled(enabled: boolean): void {
  promptSuggestionsEnabled.set(enabled);
  if (!enabled) {
    promptSuggestions.set({});
  }
}

/** Records a live `agentic://prompt-suggestion` event for a session. */
export function setPromptSuggestion(
  sessionId: string,
  sourceTurnId: string,
  rawSuggestion: string,
  deviceId?: string,
): void {
  if (!promptSuggestionsEnabled()) return;
  const suggestion = rawSuggestion.trim();
  const turnId = sourceTurnId.trim();
  if (!sessionId || !turnId || !suggestion) return;
  const key = suggestionKey(sessionId, deviceId);
  promptSuggestions.update(current => {
    const existing = current[key];
    if (existing && existing.sourceTurnId === turnId && existing.suggestion === suggestion) {
      return current;
    }
    return {
      ...current,
      [key]: { sourceTurnId: turnId, suggestion },
    };
  });
}

/**
 * Hydrates or reconciles the session's suggestion from `get_session_transcript_view`.
 *
 * - When the host returns a persisted `promptSuggestion`, store it.
 * - When the host returns none, drop any cached suggestion whose `sourceTurnId`
 *   no longer matches the latest settled completed turn (e.g. after rollback or
 *   another surface running a newer turn), while preserving a live suggestion
 *   that arrived for the current latest completed turn on older hosts that do
 *   not project `promptSuggestion` yet.
 */
/** `TranscriptTurnView.status` is `"done"` in 2.0 (or `"completed"` on legacy shapes). */
export function isCompletedTurnStatus(status: string | undefined): boolean {
  return status === "done" || status === "completed";
}

export function hydratePromptSuggestionFromTranscript(
  sessionId: string,
  persisted: TranscriptPromptSuggestion | null | undefined,
  latestTurn: TranscriptTurnView | undefined,
  deviceId?: string,
): void {
  if (!sessionId) return;
  if (!promptSuggestionsEnabled()) {
    clearPromptSuggestion(sessionId, deviceId);
    return;
  }
  const persistedText = persisted?.suggestion?.trim() ?? "";
  const persistedTurnId = persisted?.sourceTurnId?.trim() ?? "";
  if (persistedText && persistedTurnId) {
    setPromptSuggestion(sessionId, persistedTurnId, persistedText, deviceId);
    return;
  }
  const key = suggestionKey(sessionId, deviceId);
  const existing = promptSuggestions()[key];
  if (!existing) return;
  if (
    !latestTurn ||
    latestTurn.turnId !== existing.sourceTurnId ||
    !isCompletedTurnStatus(latestTurn.status)
  ) {
    clearPromptSuggestion(sessionId, deviceId);
  }
}

export function clearPromptSuggestion(sessionId: string | null | undefined, deviceId?: string): void {
  if (!sessionId) return;
  const key = suggestionKey(sessionId, deviceId);
  promptSuggestions.update(current => {
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });
}

export function promptSuggestionForSession(
  sessionId: string | null | undefined,
  deviceId?: string,
): PromptSuggestionEntry | null {
  if (!sessionId || !promptSuggestionsEnabled()) return null;
  return promptSuggestions()[suggestionKey(sessionId, deviceId)] ?? null;
}

export function resetPromptSuggestions(): void {
  promptSuggestions.set({});
}

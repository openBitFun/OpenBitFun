// Composer voice input (dictation) and the voice-call entry.
//
// The desktop's React composer recorded microphone audio with `getUserMedia`
// and streamed PCM to the host's speech service (`speech_start_input_session`,
// `speech_append_audio_chunk`, `speech_finish_input_session`) so a local or
// cloud model transcribed it. An NSH window cannot capture raw microphone audio,
// so that path is not available here. What NSH does offer is the system's own
// speech recognizer (`Speech`: macOS and iOS, or a recognizer the embedding app
// provides). Dictation therefore runs on the system recognizer, in the language
// the voice settings name, and says so; where no recognizer exists the button
// explains why instead of disappearing silently.
//
// Full-duplex voice calls (`speech_start_realtime_session` and the realtime
// audio commands) need live microphone capture and audio streaming in both
// directions; with the call enabled in the host's settings the composer shows
// the entry and states that this desktop UI cannot place the call yet.
//
// The settings come from the host config (`app.ai_experience.voice_input`,
// `app.voice_call.enabled`); the Settings page owns writing them.

import { signal, Speech, type SpeechSession } from "nsh";
import { getConfig } from "./api";
import { tr } from "./i18n";
import { settingsValues } from "./settingsStore";

export type VoicePhase = "idle" | "starting" | "listening" | "finishing";

/** What dictation is doing now. */
export const voicePhase = signal<VoicePhase>("idle");
/** The transcript so far while listening. */
export const voiceTranscript = signal("");
/** Why the last attempt did not produce text, in the user's language; `""` when it did. */
export const voiceNotice = signal("");
/** Whether a system recognizer exists here; `null` until asked. */
export const voiceRecognizerAvailable = signal<boolean | null>(null);

interface VoiceInputConfig {
  enabled?: boolean;
  default_language?: string;
}

const voiceConfig = signal<VoiceInputConfig | null>(null);
const voiceCallEnabledConfig = signal<boolean | null>(null);
let configRead: Promise<void> | null = null;

/** Reads the voice settings once; the Settings page keeps `settingsValues` current after that. */
export function ensureVoiceSettings(): Promise<void> {
  if (!configRead) {
    configRead = (async () => {
      const [input, call] = await Promise.allSettled([
        getConfig("app.ai_experience.voice_input", true),
        getConfig("app.voice_call.enabled", true),
      ]);
      if (input.status === "fulfilled" && input.value && typeof input.value === "object") {
        voiceConfig.set(input.value as VoiceInputConfig);
      }
      if (call.status === "fulfilled" && typeof call.value === "boolean") voiceCallEnabledConfig.set(call.value);
      if (voiceRecognizerAvailable() === null) {
        try {
          voiceRecognizerAvailable.set(await Speech.available());
        } catch {
          voiceRecognizerAvailable.set(false);
        }
      }
    })();
  }
  return configRead;
}

/** Forgets the read so the next composer mount reads again (a peer switch, a test). */
export function resetVoiceSettings(): void {
  configRead = null;
  voiceConfig.set(null);
  voiceCallEnabledConfig.set(null);
}

/** Whether the composer offers dictation: the host's switch, on by default as the host's own default is. */
export function voiceInputEnabled(): boolean {
  const live = settingsValues()["app.ai_experience.voice_input.enabled"];
  if (typeof live === "boolean") return live;
  return voiceConfig()?.enabled !== false;
}

/** Whether the user turned voice calls on (off unless enabled, as the host defaults it). */
export function voiceCallEnabled(): boolean {
  return voiceCallEnabledConfig() === true;
}

/** The BCP 47 tag for the configured voice language; `null` lets the system choose. */
export function voiceLanguageTag(): string | null {
  const live = settingsValues()["app.ai_experience.voice_input.default_language"];
  const value = typeof live === "string" ? live : voiceConfig()?.default_language ?? "auto";
  switch (value) {
    case "zh":
      return "zh-CN";
    case "en":
      return "en-US";
    case "yue":
      return "zh-HK";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    default:
      return null;
  }
}

function noticeFor(error: string): string {
  switch (error) {
    case "not-allowed":
      return tr("voice.error.notAllowed");
    case "no-speech":
      return tr("voice.error.noSpeech");
    case "audio-capture":
      return tr("voice.error.audioCapture");
    case "network":
      return tr("voice.error.network");
    case "language-not-supported":
      return tr("voice.error.language");
    case "unavailable":
      return tr("voice.unavailable");
    default:
      return tr("voice.error.failed");
  }
}

let session: SpeechSession | null = null;
let cancelled = false;
/** What to do with the final transcript once the session ends. */
let completion: ((text: string) => void) | null = null;

/**
 * Starts dictation. `deliver` receives the final transcript (trimmed, non-empty)
 * once the user finishes; cancelling drops it.
 */
export function startVoiceInput(deliver: (text: string) => void): void {
  if (voicePhase() !== "idle") return;
  voiceNotice.set("");
  voiceTranscript.set("");
  if (voiceRecognizerAvailable() === false) {
    voiceNotice.set(tr("voice.unavailable"));
    return;
  }
  completion = deliver;
  cancelled = false;
  voicePhase.set("starting");
  let started: SpeechSession;
  try {
    started = Speech.start({ lang: voiceLanguageTag(), interim: true });
  } catch (error) {
    voicePhase.set("idle");
    completion = null;
    const code = (error as { code?: string } | null)?.code;
    voiceNotice.set(code === "ERR_ACCESS_DENIED" ? tr("voice.error.notAllowed") : tr("voice.error.failed"));
    console.warn(`Voice input could not start: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  session = started;
  started.on("start", () => {
    if (session === started) voicePhase.set("listening");
  });
  started.on("result", result => {
    if (session === started) voiceTranscript.set(result.text);
  });
  started.on("end", end => {
    if (session !== started) return;
    session = null;
    const deliverText = completion;
    completion = null;
    voicePhase.set("idle");
    const text = (end.text || voiceTranscript()).trim();
    voiceTranscript.set("");
    if (cancelled) {
      cancelled = false;
      return;
    }
    if (end.error && !(end.error === "no-speech" && text)) {
      voiceNotice.set(noticeFor(end.error));
      return;
    }
    if (!text) {
      voiceNotice.set(tr("voice.error.noSpeech"));
      return;
    }
    deliverText?.(text);
  });
}

/** Stops listening; the recognizer finishes what it heard and the transcript is delivered. */
export function finishVoiceInput(deliver?: (text: string) => void): void {
  if (!session) return;
  if (deliver) completion = deliver;
  voicePhase.set("finishing");
  session.stop();
}

/** Ends dictation without delivering anything. */
export function cancelVoiceInput(): void {
  if (!session) return;
  completion = null;
  cancelled = true;
  session.abort();
}

/** The voice-call entry's answer: this window cannot capture live audio. */
export function explainVoiceCallUnsupported(): void {
  voiceNotice.set(tr("voice.callUnsupported"));
}

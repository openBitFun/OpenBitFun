// Composer dictation over the system recognizer, and the voice-call entry that
// states this window cannot place a call.
import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

type Backend = ReturnType<typeof createBackend>;

/** Answers the voice config reads the way a host with these settings would. */
function withVoiceConfig(backend: Backend, voiceInput: Record<string, unknown>, voiceCall: boolean): void {
  const base = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: Record<string, unknown> };
    if (args.action === "get_config" && args.request?.path === "app.ai_experience.voice_input") {
      return { ok: true, value: voiceInput, transport: "dev" };
    }
    if (args.action === "get_config" && args.request?.path === "app.voice_call.enabled") {
      return { ok: true, value: voiceCall, transport: "dev" };
    }
    return base(data);
  };
}

async function openSession(backend: Backend) {
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");
  return app;
}

test("dictation fills the composer in the configured language", async () => {
  const backend = createBackend();
  withVoiceConfig(backend, { enabled: true, default_language: "zh" }, false);
  const app = await openSession(backend);
  await app.type("composer", "Draft:");

  await app.press("voice-input");
  expect(app.speechRequests()[0]).toMatchObject({ lang: "zh-CN", interim: true });
  await app.waitFor("Listening…");
  await app.hear("add a test");
  await app.waitFor("add a test");
  await app.press("voice-insert");
  await app.waitUntil(() => app.value("composer") === "Draft: add a test");
  expect(app.shows("label:voice-dictation")).toBe(false);
  // Nothing is sent until the user sends.
  expect(backend.actions()).not.toContain("submit_user_message");
});

test("dictate and send submits the transcript as a message", async () => {
  const backend = createBackend();
  withVoiceConfig(backend, { enabled: true, default_language: "auto" }, false);
  const app = await openSession(backend);

  await app.press("voice-input");
  expect(app.speechRequests()[0]?.lang ?? null).toBeNull();
  await app.hear("summarize the diff");
  await app.press("voice-send");
  await app.waitUntil(() => backend.actions().includes("submit_user_message"));
  expect(backend.calls.find(call => call.action === "submit_user_message")?.request).toMatchObject({
    text: "summarize the diff",
  });
});

test("a refused microphone and a cancelled dictation are told apart", async () => {
  const backend = createBackend();
  withVoiceConfig(backend, { enabled: true }, false);
  const app = await openSession(backend);

  await app.press("voice-input");
  await app.hear("never mind");
  await app.press("voice-cancel");
  await app.waitUntil(() => !app.shows("label:voice-dictation"));
  expect(app.value("composer")).toBe("");
  expect(app.shows("label:voice-notice")).toBe(false);

  await app.press("voice-input");
  await app.endSpeech("not-allowed");
  await app.waitFor("label:voice-notice");
  expect(app.texts().join("\n")).toContain("Microphone or speech recognition access was denied.");
});

test("voice input off hides the button; an enabled voice call says why it cannot start", async () => {
  const backend = createBackend();
  withVoiceConfig(backend, { enabled: false }, true);
  const app = await openSession(backend);
  expect(app.shows("label:voice-input")).toBe(false);
  await app.press("voice-call");
  await app.waitFor("label:voice-notice");
  expect(app.texts().join("\n")).toContain("Voice calls need live microphone audio");
  expect(backend.actions()).not.toContain("speech_start_realtime_session");
});

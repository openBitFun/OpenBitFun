// Model labels (wave 23): every list a configured model appears in reads it as
// the host labels it (the model first, then its provider, numbered when two of
// one device read the same), never as the configuration's own name, which is
// usually the provider's. Settings > Models and its pickers included.

import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

const MODELS = [
  { id: "m-a", name: "OpenAI", provider: "openai", model_name: "gpt-5", enabled: true, category: "general_chat", capabilities: ["text_chat"], base_url: "", api_key: "" },
  { id: "m-b", name: "OpenAI", provider: "openai", model_name: "gpt-5", enabled: true, category: "general_chat", capabilities: ["text_chat"], base_url: "", api_key: "" },
  { id: "m-c", name: "Google Gemini", provider: "gemini", model_name: "gemini-2.5-pro", enabled: true, category: "general_chat", capabilities: ["text_chat"], base_url: "", api_key: "" },
];

/** The host's catalog of `MODELS`, labelled as `label_configured_models` labels them. */
const LABELS: Record<string, { label: string; detail: string }> = {
  "m-a": { label: "gpt-5", detail: "OpenAI #1" },
  "m-b": { label: "gpt-5", detail: "OpenAI #2" },
  "m-c": { label: "gemini-2.5-pro", detail: "Google Gemini" },
};

function labelledBackend() {
  const backend = createBackend();
  const invoke = backend.handlers["openbitfun.invoke"];
  backend.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: { path?: string } };
    if (args.action === "get_config" && args.request?.path === "ai.models") {
      return { ok: true, transport: "dev", value: MODELS };
    }
    if (args.action === "get_ai_model_catalog") {
      return {
        ok: true,
        transport: "dev",
        value: {
          version: 1,
          models: MODELS.map(model => ({ ...model, ...LABELS[model.id] })),
          default_models: { primary: "m-a" },
        },
      };
    }
    return invoke(data);
  };
  return backend;
}

test("Settings > Models leads each row with the model and follows with its provider, twins numbered", async () => {
  const backend = labelledBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.press("Settings");
  await app.press("nav-settings-page-models");
  await app.waitFor("text:OpenAI #2");
  expect(app.shows("text:OpenAI #1")).toBe(true);
  expect(app.shows("text:gemini-2.5-pro")).toBe(true);
  expect(app.shows("text:Google Gemini")).toBe(true);
  expect(app.texts().filter(text => text === "gpt-5").length).toBeGreaterThanOrEqual(2);
  // The configuration's name alone no longer stands for the model.
  expect(app.texts()).not.toContain("OpenAI");
});

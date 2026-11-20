// Reads the GenUI application a GenerativeUI tool call carries, wherever it is
// at: the host's tool result (`app`, `app_state`) once the call completed, the
// call's `createSurface` arguments, or the `GenUIStream` source while the
// arguments are still streaming. Nothing is derived beyond picking the fields.

import type { ToolCallView } from "../format";

export interface GenUIDocument {
  kind: "openui-lang" | "html-document";
  /** OpenUI Lang source, or the document's HTML. */
  content: string;
  /** A free document's CSS, when it has one. */
  css?: string;
  /** A free document's script; never run by this surface. */
  script?: string;
  title: string;
  /** Initial state values (`updateDataModel.values`, the declared defaults). */
  values: Record<string, unknown>;
  /** The source is still arriving. */
  streaming: boolean;
}

export const GENUI_TOOL_NAMES = new Set(["GenerativeUI", "generative_ui", "GenUI"]);

export function isGenUICall(call: ToolCallView): boolean {
  return GENUI_TOOL_NAMES.has(call.name);
}

function record(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function messagesOf(input: unknown): Record<string, unknown>[] {
  const args = record(input);
  if (!args) return [];
  let messages = args.messages;
  if (typeof messages === "string") {
    try {
      messages = JSON.parse(messages);
    } catch {
      return [];
    }
  }
  return Array.isArray(messages) ? messages.flatMap(message => (record(message) ? [record(message)!] : [])) : [];
}

/** Declared state defaults: `{ name: { type, default } }`. */
function stateDefaults(state: unknown): Record<string, unknown> {
  const declared = record(state);
  if (!declared) return {};
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(declared)) {
    const spec = record(entry);
    if (spec && "default" in spec) out[name] = spec.default;
  }
  return out;
}

function documentOf(app: Record<string, unknown>, values: Record<string, unknown>, streaming: boolean): GenUIDocument | null {
  const source = record(app.source);
  if (!source) return null;
  const title = typeof app.title === "string" ? app.title : "";
  const seeded = { ...stateDefaults(app.state), ...values };
  if (source.kind === "openui-lang" && typeof source.content === "string") {
    return { kind: "openui-lang", content: source.content, title, values: seeded, streaming };
  }
  if (source.kind === "html-document" && typeof source.html === "string") {
    return {
      kind: "html-document",
      content: source.html,
      ...(typeof source.css === "string" && source.css ? { css: source.css } : {}),
      ...(typeof source.script === "string" && source.script ? { script: source.script } : {}),
      title,
      values: seeded,
      streaming,
    };
  }
  return null;
}

/** The application a GenerativeUI call carries, or `null` before any source arrived. */
export function genuiDocumentOf(call: ToolCallView, running: boolean): GenUIDocument | null {
  const result = record(call.result);
  const app = result ? record(result.app) : null;
  if (app) {
    const values = record(result?.app_state) ?? record(result?.appState) ?? {};
    const fromResult = documentOf(app, values, false);
    if (fromResult) return fromResult;
  }
  const messages = messagesOf(call.input);
  const surface = messages.map(message => record(message.createSurface)).find(Boolean) ?? null;
  if (surface) {
    const values: Record<string, unknown> = {};
    for (const message of messages) {
      const update = record(message.updateDataModel);
      if (!update) continue;
      Object.assign(values, stateDefaults(update.state), record(update.values) ?? {});
    }
    const fromInput = documentOf(surface, values, running);
    if (fromInput) return fromInput;
  }
  const stream = call.genuiStream;
  if (stream && stream.source) {
    return {
      kind: "openui-lang",
      content: stream.source,
      title: stream.title ?? "",
      values: {},
      streaming: running,
    };
  }
  return null;
}

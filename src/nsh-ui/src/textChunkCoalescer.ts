// Per-frame merging of `agentic://text-chunk` for wires that deliver every
// chunk as it was emitted.
//
// It is the same algorithm `host.js` runs for the legacy page host (that file
// cannot import, so it keeps its own copy; `test/transport.test.tsx` holds the
// two to the same output): consecutive chunks of one stream (same source
// device, session, turn, round, attempt, content type and reasoning kind, same
// text field) are concatenated and released once per animation frame or after
// 24 ms; a thinking-end chunk releases at once; and any other event releases
// every pending chunk before itself, so a tool, round or completion event
// always sees the text that preceded it.

export const TEXT_CHUNK_EVENT = "agentic://text-chunk";
const TEXT_CHUNK_MAX_LATENCY_MS = 24;

type TextField = "text" | "delta" | "content" | "chunk";

interface PendingChunk {
  key: string;
  field: TextField;
  payload: Record<string, unknown>;
}

export interface TextChunkCoalescer {
  /** Takes one event in emission order; `emit` receives what is released. */
  push(event: string, payload: unknown): void;
  /** Releases every pending chunk now. */
  flush(): void;
  /** Drops pending chunks (their listener went away). */
  clear(): void;
}

function textChunkFieldOf(payload: Record<string, unknown>): TextField | null {
  if (typeof payload.text === "string") return "text";
  if (typeof payload.delta === "string") return "delta";
  if (typeof payload.content === "string") return "content";
  if (typeof payload.chunk === "string") return "chunk";
  return null;
}

function textChunkKeyOf(payload: Record<string, unknown>): string {
  return [
    payload.__openbitfunSourceDeviceId ?? "",
    payload.sessionId ?? payload.session_id ?? "",
    payload.turnId ?? payload.turn_id ?? "",
    payload.roundId ?? payload.round_id ?? "",
    payload.attemptId ?? payload.attempt_id ?? "",
    payload.contentType ?? "",
    payload.reasoningKind ?? "",
  ].join("\u0000");
}

export function createTextChunkCoalescer(
  emit: (event: string, payload: unknown) => void,
): TextChunkCoalescer {
  let pending: PendingChunk[] = [];
  let frameId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  function cancelScheduled(): void {
    if (frameId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frameId);
    frameId = null;
    if (timerId !== null) clearTimeout(timerId);
    timerId = null;
  }

  function flush(): void {
    cancelScheduled();
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (const entry of batch) emit(TEXT_CHUNK_EVENT, entry.payload);
  }

  function schedule(): void {
    if (frameId !== null || timerId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      frameId = requestAnimationFrame(() => {
        frameId = null;
        flush();
      });
    }
    timerId = setTimeout(() => {
      timerId = null;
      flush();
    }, TEXT_CHUNK_MAX_LATENCY_MS);
  }

  function push(event: string, payload: unknown): void {
    if (event === TEXT_CHUNK_EVENT && payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const field = textChunkFieldOf(record);
      if (field) {
        const key = textChunkKeyOf(record);
        const last = pending[pending.length - 1];
        if (last && last.key === key && last.field === field && last.payload.isThinkingEnd !== true) {
          last.payload[field] = String(last.payload[field]) + String(record[field]);
          if (record.isThinkingEnd === true) {
            last.payload.isThinkingEnd = true;
            flush();
            return;
          }
        } else {
          pending.push({ key, field, payload: { ...record } });
          if (record.isThinkingEnd === true) {
            flush();
            return;
          }
        }
        schedule();
        return;
      }
    }
    // Causal order: anything that is not a mergeable chunk sees every chunk before it.
    if (pending.length > 0) flush();
    emit(event, payload);
  }

  function clear(): void {
    cancelScheduled();
    pending = [];
  }

  return { push, flush, clear };
}

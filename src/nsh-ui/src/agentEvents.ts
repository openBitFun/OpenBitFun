// Follows a running dialog turn and real-time session lifecycle events.
//
// The transcript does not poll: the host reports streaming chunks, tool events,
// model rounds, turn lifecycle, durable history persistence fences, and title
// generation. Chunks belonging to another session are ignored for the active
// transcript view while per-session running status is tracked for every row.
//
// Streaming performance architecture:
// - Structural turn/round/tool state (`liveTurn`) NEVER clones or notifies on
//   steady-state text/thinking chunks.
// - Each round owns decoupled fine-grained reactive text & thinking channels
//   (`roundTextSignal`, `roundThinkingSignal`, `hasLiveRoundText`,
//   `hasLiveRoundThinking`), and `LiveModelRound.text` / `.thinking` are
//   enumerable reactive getters backed by those channels for seamless
//   compatibility.
// - In live browser / Tauri webview sessions (`platform.os === "web"`), bursty
//   token arrivals drain smoothly on `requestAnimationFrame` with backlog-aware
//   adaptive pacing and grapheme/fence-safe boundaries inside a single `batch()`
//   per display frame. Headless tests flush synchronously for 100% determinism.
// - Lifecycle boundaries (round/turn completion, cancellation, interruption,
//   failure, tool events, attempt superseding) flush or clear buffered text
//   immediately with zero data loss.

import {
  batch,
  computed,
  lifecycle,
  platform,
  reduceMotion,
  signal,
  type Accessor,
  type Signal,
} from "nsh";
import type { RunningTurnSnapshot } from "./api";
import { listenEvent } from "./bridge";
import { loadQueueForSession } from "./queueStore";
import { markSessionFailed, markSessionSeen } from "./sessionStatusStore";
import {
  activeSessionId,
  activeWorkspaceId,
  bindPendingTurnId,
  clearPendingTurn,
  clearStreamedText,
  loadTurns,
  onRunningTurnSnapshot,
  onSessionSwitch,
  onStreamCleared,
  patchSessionTitle,
  pendingTurnState,
  refreshSessionsSilently,
  removeSessionFromEvent,
  runningTurnId,
  runningTurns,
  sessionTurns,
  setPendingTurn,
  streamText,
  thinkingText,
  turnError,
  upsertSessionFromEvent,
} from "./state";

export interface LiveToolItem {
  toolId: string;
  toolName: string;
  effectiveToolName?: string;
  status: "queued" | "waiting" | "running" | "confirmation" | "completed" | "failed" | "cancelled";
  input?: unknown;
  detail: string;
  progressMessage?: string;
  error?: string;
  durationMs?: number;
  /** The tool's `Completed` result payload, drawn in the expanded card. */
  result?: unknown;
  /** The text the model was given back, when the host reports it apart from `result`. */
  resultForAssistant?: string;
  /** A GenerativeUI call's OpenUI source so far, from `GenUIStream` deltas. */
  genuiStream?: { source: string; title?: string; format: string; seq: number };
  /**
   * How much of the round's answer text had arrived when the tool first appeared.
   * The transcript cuts the round's text at this offset, so text written before a
   * tool call stays above its card and text written after it stays below.
   */
  textOffset?: number;
}

export interface LiveModelRound {
  roundId: string;
  roundIndex: number;
  attemptId?: string;
  effectiveModelName?: string;
  thinking: string;
  reasoningKind?: "reasoning" | "summary";
  text: string;
  tools: LiveToolItem[];
  completed: boolean;
  durationMs?: number;
}

export interface LiveTurnState {
  sessionId: string;
  turnId: string | null;
  userText: string;
  rounds: LiveModelRound[];
  /** True between `dialog-turn-completed` and the durable disk-persistence fence. */
  settling: boolean;
}

interface LiveRoundMeta {
  roundId: string;
  roundIndex: number;
  attemptId?: string;
  effectiveModelName?: string;
  reasoningKind?: "reasoning" | "summary";
  tools: LiveToolItem[];
  completed: boolean;
  durationMs?: number;
}

interface RoundStreamChannel {
  /** Full received text from the host (ground truth, never drops characters). */
  target: string;
  /** UTF-16 offset currently revealed into `displayed`. */
  revealed: number;
  /** Plain mirror of `displayed()` for O(1) untracked reads inside `agentEvents`. */
  displayedText: string;
  /** Fractional character carry across animation frames. */
  carry: number;
  /** Reactive displayed text signal bound by UI views. */
  displayed: Signal<string>;
  /** Coarse boolean guard so `<If>` mounts once instead of re-evaluating per frame. */
  hasAny: Signal<boolean>;
}

interface RoundStreamEntry {
  readonly roundId: string;
  readonly text: RoundStreamChannel;
  readonly thinking: RoundStreamChannel;
}

interface GraphemeSegment {
  index: number;
  segment: string;
}

interface GraphemeSegmenter {
  segment(text: string): Iterable<GraphemeSegment>;
}

type GraphemeSegmenterCtor = new (
  locale?: string | string[],
  options?: { granularity: "grapheme" },
) => GraphemeSegmenter;

/** Adaptive smooth-drain tuning constants (60Hz / 120Hz display aligned). */
const FRAME_BUDGET_MS = 16.67;
const MAX_FRAME_DT_MS = 64;
const DRAIN_SAFETY_FALLBACK_MS = 48;

const TEXT_BASE_CHARS_PER_SEC = 120;
const TEXT_ACCEL_PER_BACKLOG = 3.5;
const TEXT_MAX_CHARS_PER_SEC = 2200;

const THINKING_BASE_CHARS_PER_SEC = 180;
const THINKING_ACCEL_PER_BACKLOG = 4.5;
const THINKING_MAX_CHARS_PER_SEC = 2600;

const NORMAL_BACKLOG_THRESHOLD = 260;
const NORMAL_MAX_CHARS_PER_FRAME = 24;
const HEAVY_MAX_CHARS_PER_FRAME = 96;

/** Structured live rounds & tools for the active session's in-flight/settling turn. */
export const liveTurn = signal<LiveTurnState | null>(null);

/**
 * Monotonic tick incremented at most once per painted streaming frame (and on
 * structural live-turn / tool / round transitions). Scenes should track this
 * signal in their auto-scroll effect rather than subscribing to `liveTurn()`,
 * `streamText()`, and `thinkingText()` separately.
 */
export const streamScrollTick = signal<number>(0);

/** True while any buffered live text or thinking is still smoothly draining. */
export const isStreamDraining = signal<boolean>(false);

/** Coarse boolean guards so scene `<If>` checks don't re-evaluate on every token. */
export const hasLiveText = computed<boolean>(() => streamText().length > 0);
export const hasLiveThinking = computed<boolean>(() => thinkingText().length > 0);
export const hasLiveTools = computed<boolean>(() => {
  const live = liveTurn();
  return Boolean(live?.rounds.some(round => round.tools.length > 0));
});
export const hasLiveContent = computed<boolean>(
  () => hasLiveText() || hasLiveThinking() || hasLiveTools(),
);
export const liveTools = computed<LiveToolItem[]>(() => {
  const live = liveTurn();
  return live ? live.rounds.flatMap(round => round.tools) : [];
});

/** Decoupled per-round reactive text/thinking channels keyed by `roundId`. */
const roundStreams = new Map<string, RoundStreamEntry>();
/** Ordered round IDs matching `liveTurn().rounds` for O(1)/allocation-free flat sync. */
let roundOrder: string[] = [];

let drainRafId: number | null = null;
let drainFallbackTimerId: ReturnType<typeof setTimeout> | null = null;
let lastDrainFrameMs: number | null = null;
let smoothingOverride: boolean | null = null;
let cachedSegmenter: GraphemeSegmenter | null | undefined;

function nowTimestampMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function getGraphemeSegmenter(): GraphemeSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    const Ctor = (Intl as typeof Intl & { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
    cachedSegmenter = Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/**
 * Snaps a UTF-16 reveal offset forward to a safe grapheme and Markdown
 * micro-token boundary in O(step) time so streaming never splits an emoji,
 * surrogate pair, escape sequence, or fenced code opener mid-frame.
 */
function safeStreamingRevealEnd(
  target: string,
  requestedEnd: number,
  knownBoundary: number,
): number {
  const len = target.length;
  if (knownBoundary >= len) return len;
  const clamped = Math.max(knownBoundary + 1, Math.min(len, Math.floor(requestedEnd)));
  if (clamped >= len) return len;

  let end = snapGraphemeEnd(target, clamped, knownBoundary);
  if (end >= len) return len;

  const lastChar = target.charCodeAt(end - 1);
  // Keep fenced code openers (```lang\n) atomic to prevent inline-code flicker.
  if (lastChar === 96 /* ` */ && target.charCodeAt(end) === 96) {
    let ticks = 1;
    while (end < len && target.charCodeAt(end) === 96 && ticks < 3) {
      end += 1;
      ticks += 1;
    }
    if (ticks >= 3) {
      const nlIdx = target.indexOf("\n", end);
      if (nlIdx !== -1 && nlIdx - end <= 24) {
        end = nlIdx + 1;
      }
    }
  } else if (lastChar === 92 /* \ */) {
    end = snapGraphemeEnd(target, Math.min(len, end + 1), knownBoundary);
  } else if (
    (lastChar === 42 /* * */ || lastChar === 95 /* _ */ || lastChar === 126 /* ~ */) &&
    target.charCodeAt(end) === lastChar
  ) {
    end = Math.min(len, end + 1);
  }

  return Math.max(knownBoundary + 1, Math.min(len, end));
}

function snapGraphemeEnd(target: string, requestedEnd: number, knownBoundary: number): number {
  const len = target.length;
  if (requestedEnd >= len) return len;
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    // Slice only a tiny lookahead window rather than the entire remaining string.
    const windowEnd = Math.min(len, requestedEnd + 32);
    const slice = target.slice(knownBoundary, windowEnd);
    const localTarget = requestedEnd - knownBoundary;
    for (const part of segmenter.segment(slice)) {
      const partEnd = part.index + part.segment.length;
      if (partEnd >= localTarget) {
        return Math.min(len, knownBoundary + partEnd);
      }
    }
    return Math.min(len, windowEnd);
  }

  // O(1) surrogate-pair / variation-selector / ZWJ safe fallback.
  let end = requestedEnd;
  const prev = target.charCodeAt(end - 1);
  if (prev >= 0xd800 && prev <= 0xdbff && end < len) {
    end += 1;
  }
  while (end < len) {
    const next = target.charCodeAt(end);
    if (next === 0x200d) {
      // Zero-width joiner binds the following code point into the same cluster.
      end += 1;
      if (end < len) {
        const joined = target.charCodeAt(end);
        end += joined >= 0xd800 && joined <= 0xdbff && end + 1 < len ? 2 : 1;
      }
      continue;
    }
    if ((next >= 0xfe00 && next <= 0xfe0f) || (next >= 0x0300 && next <= 0x036f)) {
      end += 1;
      continue;
    }
    break;
  }
  return Math.min(len, end);
}

function shouldCoalesceToFrame(): boolean {
  if (typeof requestAnimationFrame !== "function") return false;
  if (smoothingOverride !== null) return smoothingOverride;
  // Live browser dev mode and packaged Tauri desktop WebView both run on
  // NSH's web target (`platform.os === "web"`). Headless `nsh test` simulates
  // `macos`/`ios` and expects synchronous chunk updates without waiting for rAF.
  return platform.os === "web";
}

function shouldSmoothStream(): boolean {
  if (!shouldCoalesceToFrame()) return false;
  if (smoothingOverride === true) return true;
  if (reduceMotion()) return false;
  if (lifecycle() === "background") return false;
  return true;
}

/**
 * Overrides automatic smooth-drain detection (pass `null` to restore default
 * runtime detection). Primarily useful for tests or diagnostics.
 */
export function setStreamingSmoothingEnabled(enabled: boolean | null): void {
  smoothingOverride = enabled;
}

function createChannel(): RoundStreamChannel {
  return {
    target: "",
    revealed: 0,
    displayedText: "",
    carry: 0,
    displayed: signal<string>(""),
    hasAny: signal<boolean>(false),
  };
}

function ensureRoundStream(roundId: string): RoundStreamEntry {
  let entry = roundStreams.get(roundId);
  if (!entry) {
    entry = {
      roundId,
      text: createChannel(),
      thinking: createChannel(),
    };
    roundStreams.set(roundId, entry);
  }
  return entry;
}

function resetChannel(channel: RoundStreamChannel): void {
  channel.target = "";
  channel.revealed = 0;
  channel.carry = 0;
  if (channel.displayedText !== "") {
    channel.displayedText = "";
    channel.displayed.set("");
  }
  if (channel.hasAny()) {
    channel.hasAny.set(false);
  }
}

function commitChannelImmediate(channel: RoundStreamChannel): boolean {
  const target = channel.target;
  channel.carry = 0;
  if (channel.revealed === target.length && channel.displayedText === target) {
    return false;
  }
  channel.revealed = target.length;
  channel.displayedText = target;
  channel.displayed.set(target);
  const nonEmpty = target.length > 0;
  if (channel.hasAny() !== nonEmpty) {
    channel.hasAny.set(nonEmpty);
  }
  return true;
}

function advanceChannel(
  channel: RoundStreamChannel,
  dtMs: number,
  smooth: boolean,
  isThinking: boolean,
): boolean {
  const target = channel.target;
  const targetLen = target.length;
  if (channel.revealed >= targetLen) {
    channel.carry = 0;
    if (channel.displayedText !== target) {
      channel.revealed = targetLen;
      channel.displayedText = target;
      channel.displayed.set(target);
      const nonEmpty = targetLen > 0;
      if (channel.hasAny() !== nonEmpty) channel.hasAny.set(nonEmpty);
      return true;
    }
    return false;
  }

  if (!smooth) {
    return commitChannelImmediate(channel);
  }

  const backlog = targetLen - channel.revealed;
  const baseRate = isThinking ? THINKING_BASE_CHARS_PER_SEC : TEXT_BASE_CHARS_PER_SEC;
  const accel = isThinking ? THINKING_ACCEL_PER_BACKLOG : TEXT_ACCEL_PER_BACKLOG;
  const maxRate = isThinking ? THINKING_MAX_CHARS_PER_SEC : TEXT_MAX_CHARS_PER_SEC;
  const charsPerSec = Math.min(maxRate, baseRate + backlog * accel);

  const maxStep =
    backlog > NORMAL_BACKLOG_THRESHOLD
      ? Math.min(HEAVY_MAX_CHARS_PER_FRAME, Math.ceil(backlog / 8))
      : NORMAL_MAX_CHARS_PER_FRAME;

  channel.carry = Math.min(backlog + maxStep, channel.carry + (charsPerSec * dtMs) / 1000);
  const step = Math.min(backlog, Math.floor(channel.carry), maxStep);
  if (step <= 0) return false;

  const nextRevealed = safeStreamingRevealEnd(target, channel.revealed + step, channel.revealed);
  const actualAdvanced = nextRevealed - channel.revealed;
  channel.carry = Math.max(0, channel.carry - actualAdvanced);
  channel.revealed = nextRevealed;

  const nextText = nextRevealed >= targetLen ? target : target.slice(0, nextRevealed);
  channel.displayedText = nextText;
  channel.displayed.set(nextText);
  if (!channel.hasAny() && nextText.length > 0) {
    channel.hasAny.set(true);
  }
  return true;
}

function clearDrainSchedule(): void {
  if (drainRafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(drainRafId);
  }
  drainRafId = null;
  if (drainFallbackTimerId !== null) {
    clearTimeout(drainFallbackTimerId);
  }
  drainFallbackTimerId = null;
}

function hasAnyPendingBacklog(): boolean {
  for (const entry of roundStreams.values()) {
    if (
      entry.text.revealed < entry.text.target.length ||
      entry.thinking.revealed < entry.thinking.target.length
    ) {
      return true;
    }
  }
  return false;
}

function bumpScrollTick(): void {
  streamScrollTick.update(n => n + 1);
}

function syncFlatStreamSignals(updateText = true, updateThinking = true): void {
  const count = roundOrder.length;
  if (count === 0) {
    if (updateText && streamText() !== "") streamText.set("");
    if (updateThinking && thinkingText() !== "") thinkingText.set("");
    return;
  }

  // O(1) allocation-free fast path for the common single-round turn.
  if (count === 1) {
    const only = roundStreams.get(roundOrder[0]);
    if (updateText) {
      const nextText = only ? only.text.displayedText : "";
      if (streamText() !== nextText) streamText.set(nextText);
    }
    if (updateThinking) {
      const nextThinking = only ? only.thinking.displayedText : "";
      if (thinkingText() !== nextThinking) thinkingText.set(nextThinking);
    }
    return;
  }

  if (updateText) {
    let combined = "";
    for (let i = 0; i < count; i += 1) {
      const part = roundStreams.get(roundOrder[i])?.text.displayedText ?? "";
      if (!part) continue;
      combined = combined ? `${combined}\n\n${part}` : part;
    }
    if (streamText() !== combined) streamText.set(combined);
  }

  if (updateThinking) {
    let combined = "";
    for (let i = 0; i < count; i += 1) {
      const part = roundStreams.get(roundOrder[i])?.thinking.displayedText ?? "";
      if (!part) continue;
      combined = combined ? `${combined}\n\n${part}` : part;
    }
    if (thinkingText() !== combined) thinkingText.set(combined);
  }
}

function drainFrame(nowMs: number, forceAll = false): void {
  clearDrainSchedule();

  const smooth = !forceAll && shouldSmoothStream();
  const prevMs = lastDrainFrameMs;
  lastDrainFrameMs = nowMs;
  const dtMs =
    prevMs === null
      ? FRAME_BUDGET_MS
      : Math.min(MAX_FRAME_DT_MS, Math.max(4, nowMs - prevMs));

  let anyTextChanged = false;
  let anyThinkingChanged = false;
  let remaining = false;

  batch(() => {
    for (const entry of roundStreams.values()) {
      if (advanceChannel(entry.thinking, dtMs, smooth, true)) {
        anyThinkingChanged = true;
      }
      if (entry.thinking.revealed < entry.thinking.target.length) {
        remaining = true;
      }

      if (advanceChannel(entry.text, dtMs, smooth, false)) {
        anyTextChanged = true;
      }
      if (entry.text.revealed < entry.text.target.length) {
        remaining = true;
      }
    }

    if (anyTextChanged || anyThinkingChanged) {
      syncFlatStreamSignals(anyTextChanged, anyThinkingChanged);
      bumpScrollTick();
    }

    if (isStreamDraining() !== remaining) {
      isStreamDraining.set(remaining);
    }
  });

  if (remaining) {
    scheduleDrainFrame();
  } else {
    lastDrainFrameMs = null;
  }
}

function scheduleDrainFrame(): void {
  if (drainRafId !== null || drainFallbackTimerId !== null) return;
  if (!isStreamDraining()) {
    isStreamDraining.set(true);
  }
  if (typeof requestAnimationFrame === "function") {
    drainRafId = requestAnimationFrame(() => {
      drainRafId = null;
      drainFrame(nowTimestampMs(), false);
    });
  }
  // Safety fallback if the WebView throttles rAF while occluded or unfocused.
  drainFallbackTimerId = setTimeout(() => {
    drainFallbackTimerId = null;
    drainFrame(nowTimestampMs(), false);
  }, DRAIN_SAFETY_FALLBACK_MS);
}

/**
 * Immediately drains all pending buffered streaming text and thinking into
 * reactive signals and cancels any scheduled drain frame. Guaranteed zero data
 * loss on round/turn completion, tool transitions, cancellation, or tests.
 */
export function flushStreamingBuffers(): void {
  clearDrainSchedule();
  lastDrainFrameMs = null;
  if (roundStreams.size === 0) {
    if (isStreamDraining()) isStreamDraining.set(false);
    return;
  }
  let anyTextChanged = false;
  let anyThinkingChanged = false;
  batch(() => {
    for (const entry of roundStreams.values()) {
      if (commitChannelImmediate(entry.thinking)) anyThinkingChanged = true;
      if (commitChannelImmediate(entry.text)) anyTextChanged = true;
    }
    if (anyTextChanged || anyThinkingChanged) {
      syncFlatStreamSignals(anyTextChanged, anyThinkingChanged);
      bumpScrollTick();
    }
    if (isStreamDraining()) {
      isStreamDraining.set(false);
    }
  });
}

function flushRoundChannelImmediate(roundId: string, kind: "text" | "thinking"): void {
  const entry = roundStreams.get(roundId);
  if (!entry) return;
  const channel = kind === "thinking" ? entry.thinking : entry.text;
  if (channel.revealed >= channel.target.length && channel.displayedText === channel.target) {
    return;
  }
  batch(() => {
    if (commitChannelImmediate(channel)) {
      syncFlatStreamSignals(kind === "text", kind === "thinking");
      bumpScrollTick();
    }
    if (!hasAnyPendingBacklog()) {
      clearDrainSchedule();
      lastDrainFrameMs = null;
      if (isStreamDraining()) isStreamDraining.set(false);
    }
  });
}

/** Returns the fine-grained reactive displayed-text accessor for a live round. */
export function roundTextSignal(roundId: string): Accessor<string> {
  return ensureRoundStream(roundId).text.displayed;
}

/** Returns the fine-grained reactive displayed-thinking accessor for a live round. */
export function roundThinkingSignal(roundId: string): Accessor<string> {
  return ensureRoundStream(roundId).thinking.displayed;
}

/** Reactive reader for a live round's displayed text (tracks only that round). */
export function getLiveRoundText(roundId: string): string {
  return ensureRoundStream(roundId).text.displayed();
}

/** Reactive reader for a live round's displayed thinking (tracks only that round). */
export function getLiveRoundThinking(roundId: string): string {
  return ensureRoundStream(roundId).thinking.displayed();
}

/** Coarse boolean reactive guard for whether a live round has any displayed text. */
export function hasLiveRoundText(roundId: string): boolean {
  return ensureRoundStream(roundId).text.hasAny();
}

/** Coarse boolean reactive guard for whether a live round has any displayed thinking. */
export function hasLiveRoundThinking(roundId: string): boolean {
  return ensureRoundStream(roundId).thinking.hasAny();
}

function makeLiveRound(meta: LiveRoundMeta, entry: RoundStreamEntry): LiveModelRound {
  const round: Record<string, unknown> = {
    roundId: meta.roundId,
    roundIndex: meta.roundIndex,
    tools: meta.tools,
    completed: meta.completed,
  };
  if (meta.attemptId !== undefined) round.attemptId = meta.attemptId;
  if (meta.effectiveModelName !== undefined) round.effectiveModelName = meta.effectiveModelName;
  if (meta.reasoningKind !== undefined) round.reasoningKind = meta.reasoningKind;
  if (meta.durationMs !== undefined) round.durationMs = meta.durationMs;

  // Enumerable reactive getters keep existing `round().text` / `round().thinking`
  // bindings decoupled from `liveTurn` structural updates!
  Object.defineProperties(round, {
    text: {
      enumerable: true,
      configurable: true,
      get(): string {
        return entry.text.displayed();
      },
    },
    thinking: {
      enumerable: true,
      configurable: true,
      get(): string {
        return entry.thinking.displayed();
      },
    },
  });
  return round as unknown as LiveModelRound;
}

function extractRoundMeta(round: LiveModelRound): LiveRoundMeta {
  return {
    roundId: round.roundId,
    roundIndex: round.roundIndex,
    ...(round.attemptId !== undefined ? { attemptId: round.attemptId } : {}),
    ...(round.effectiveModelName !== undefined
      ? { effectiveModelName: round.effectiveModelName }
      : {}),
    ...(round.reasoningKind !== undefined ? { reasoningKind: round.reasoningKind } : {}),
    tools: round.tools,
    completed: round.completed,
    ...(round.durationMs !== undefined ? { durationMs: round.durationMs } : {}),
  };
}

interface TextChunkPayload {
  sessionId?: string;
  session_id?: string;
  turnId?: string;
  turn_id?: string;
  roundId?: string;
  round_id?: string;
  attemptId?: string;
  attempt_id?: string;
  text?: string;
  delta?: string;
  content?: string;
  chunk?: string;
  /** `thinking` for a reasoning model's notes, which the host sends here too. */
  contentType?: string;
  reasoningKind?: "reasoning" | "summary";
  isThinkingEnd?: boolean;
}

interface TurnEventPayload {
  sessionId?: string;
  session_id?: string;
  turnId?: string;
  turn_id?: string;
  userInput?: string;
  user_input?: string;
  originalUserInput?: string;
  reason?: string;
  message?: string;
  error?: string;
}

interface ModelRoundEventPayload {
  sessionId?: string;
  session_id?: string;
  turnId?: string;
  turn_id?: string;
  roundId?: string;
  round_id?: string;
  roundIndex?: number;
  effectiveModelName?: string;
  durationMs?: number;
  diagnostic?: { attemptId?: string; attempt_id?: string };
}

interface ToolEventEnvelope {
  sessionId?: string;
  session_id?: string;
  turnId?: string;
  turn_id?: string;
  roundId?: string;
  round_id?: string;
  attemptId?: string;
  attempt_id?: string;
  toolEvent?: Record<string, unknown>;
  tool_event?: Record<string, unknown>;
}

interface SessionHistoryChangedPayload {
  sessionId?: string;
  session_id?: string;
  settledTurnId?: string;
  settled_turn_id?: string;
}

interface SessionTitleGeneratedPayload {
  sessionId?: string;
  session_id?: string;
  title?: string;
}

interface SessionCreatedPayload {
  sessionId?: string;
  session_id?: string;
  sessionName?: string;
  session_name?: string;
  agentType?: string;
  agent_type?: string;
  workspaceId?: string;
  workspace_id?: string;
}

function sessionOf(payload: { sessionId?: string; session_id?: string } | null | undefined): string {
  const id = payload?.sessionId ?? payload?.session_id;
  return typeof id === "string" ? id : "";
}

function turnOf(payload: { turnId?: string; turn_id?: string } | null | undefined): string | null {
  const id = payload?.turnId ?? payload?.turn_id;
  return typeof id === "string" && id ? id : null;
}

function roundOf(payload: { roundId?: string; round_id?: string } | null | undefined): string {
  const id = payload?.roundId ?? payload?.round_id;
  return typeof id === "string" && id ? id : "__default__";
}

function attemptOf(
  payload: { attemptId?: string; attempt_id?: string } | null | undefined,
): string | undefined {
  const id = payload?.attemptId ?? payload?.attempt_id;
  return typeof id === "string" && id ? id : undefined;
}

function summarizeLiveInput(value: unknown, limit = 160): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > limit ? `${value.slice(0, limit)}…` : value;
  try {
    const text = JSON.stringify(value);
    if (!text) return "";
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return "";
  }
}

/** Attempt IDs superseded by provider retries; late chunks with these IDs are ignored. */
const supersededAttempts = new Set<string>();
/** Sessions whose ended turn waits for the host's view to report it settled. */
const settlingTurns = new Map<string, { turnId: string | null }>();

/**
 * A running turn of a session that is not on screen. Its events keep landing here
 * as plain data (no signals), so opening the session again restores exactly what
 * streamed while it was away instead of an empty transcript that only fills in
 * after the turn ends.
 */
interface ParkedRound {
  meta: LiveRoundMeta;
  text: string;
  thinking: string;
}

interface ParkedTurn {
  sessionId: string;
  turnId: string | null;
  userText: string;
  rounds: ParkedRound[];
}

const parkedTurns = new Map<string, ParkedTurn>();

/** When each running turn started, from `dialog-turn-started` (or first seen). */
const turnStarts = new Map<string, number>();

/** When the turn running in a session started, for the composer's elapsed clock. */
export function turnStartedAt(sessionId: string): number | undefined {
  return turnStarts.get(sessionId);
}

/** True when an event names a session other than the open one. */
function isOtherSession(payload: { sessionId?: string; session_id?: string } | null | undefined): boolean {
  const id = sessionOf(payload);
  return Boolean(id) && id !== activeSessionId();
}

function parkedTurnFor(sessionId: string, turnId: string | null): ParkedTurn {
  const existing = parkedTurns.get(sessionId);
  if (existing && (!turnId || !existing.turnId || existing.turnId === turnId)) {
    if (turnId && !existing.turnId) existing.turnId = turnId;
    return existing;
  }
  const created: ParkedTurn = { sessionId, turnId, userText: "", rounds: [] };
  parkedTurns.set(sessionId, created);
  return created;
}

function parkedRoundFor(
  turn: ParkedTurn,
  roundId: string,
  defaults?: { roundIndex?: number; effectiveModelName?: string; attemptId?: string },
): ParkedRound {
  let round = turn.rounds.find(item => item.meta.roundId === roundId);
  if (!round) {
    round = {
      meta: {
        roundId,
        roundIndex: defaults?.roundIndex ?? turn.rounds.length,
        ...(defaults?.attemptId ? { attemptId: defaults.attemptId } : {}),
        ...(defaults?.effectiveModelName ? { effectiveModelName: defaults.effectiveModelName } : {}),
        tools: [],
        completed: false,
      },
      text: "",
      thinking: "",
    };
    turn.rounds.push(round);
  }
  return round;
}

/** Snapshots the open session's running turn before another session replaces it on screen. */
function parkActiveTurn(sessionId: string | null): void {
  if (!sessionId) return;
  const live = liveTurn();
  if (!live || live.sessionId !== sessionId || live.settling) return;
  if (!runningTurns()[sessionId] && !runningTurnId()) return;
  flushStreamingBuffers();
  const pending = pendingTurnState();
  parkedTurns.set(sessionId, {
    sessionId,
    turnId: live.turnId,
    userText: live.userText || (pending && pending.sessionId === sessionId ? pending.userText : ""),
    rounds: live.rounds.map(round => {
      const entry = roundStreams.get(round.roundId);
      return {
        meta: extractRoundMeta(round),
        text: entry?.text.target ?? "",
        thinking: entry?.thinking.target ?? "",
      };
    }),
  });
}

/** Puts a parked turn back on screen when its session is opened again. */
function restoreParkedTurn(sessionId: string | null): void {
  if (!sessionId) return;
  const parked = parkedTurns.get(sessionId);
  if (!parked) return;
  parkedTurns.delete(sessionId);
  if (!runningTurns()[sessionId]) return;
  batch(() => {
    clearAllRoundStreams();
    const rounds: LiveModelRound[] = [];
    for (const round of parked.rounds) {
      const entry = ensureRoundStream(round.meta.roundId);
      entry.text.target = round.text;
      entry.thinking.target = round.thinking;
      commitChannelImmediate(entry.text);
      commitChannelImmediate(entry.thinking);
      roundOrder.push(round.meta.roundId);
      rounds.push(makeLiveRound(round.meta, entry));
    }
    liveTurn.set({
      sessionId,
      turnId: parked.turnId,
      userText: parked.userText,
      rounds,
      settling: false,
    });
    if (parked.userText) {
      setPendingTurn(sessionId, parked.userText, parked.turnId ?? undefined);
    }
    syncFlatStreamSignals(true, true);
    bumpScrollTick();
  });
}

/** Routes one event of a session that is not on screen into its parked turn. */
function parkEvent(kind: "chunk" | "roundStarted" | "roundCompleted" | "superseded" | "tool", payload: Record<string, unknown>): void {
  const sessionId = sessionOf(payload as { sessionId?: string });
  if (!sessionId) return;
  const turnId = turnOf(payload as { turnId?: string }) ?? runningTurns()[sessionId] ?? null;
  const roundId = roundOf(payload as { roundId?: string });
  const turn = parkedTurnFor(sessionId, turnId);
  switch (kind) {
    case "chunk": {
      const chunkPayload = payload as TextChunkPayload;
      const chunk = chunkPayload.text ?? chunkPayload.delta ?? chunkPayload.content ?? chunkPayload.chunk ?? "";
      if (!chunk) return;
      const attemptId = attemptOf(chunkPayload);
      const round = parkedRoundFor(turn, roundId, { attemptId });
      if (chunkPayload.contentType === "thinking") {
        round.thinking += chunk;
        if (chunkPayload.reasoningKind) round.meta = { ...round.meta, reasoningKind: chunkPayload.reasoningKind };
      } else {
        round.text += chunk;
      }
      return;
    }
    case "roundStarted": {
      const roundPayload = payload as ModelRoundEventPayload;
      const round = parkedRoundFor(turn, roundId, {
        roundIndex: roundPayload.roundIndex,
        effectiveModelName: roundPayload.effectiveModelName,
      });
      round.meta = {
        ...round.meta,
        ...(typeof roundPayload.roundIndex === "number" ? { roundIndex: roundPayload.roundIndex } : {}),
        ...(roundPayload.effectiveModelName ? { effectiveModelName: roundPayload.effectiveModelName } : {}),
        completed: false,
      };
      return;
    }
    case "roundCompleted": {
      const roundPayload = payload as ModelRoundEventPayload;
      const round = parkedRoundFor(turn, roundId);
      round.meta = {
        ...round.meta,
        completed: true,
        ...(typeof roundPayload.durationMs === "number" ? { durationMs: roundPayload.durationMs } : {}),
      };
      return;
    }
    case "superseded": {
      const round = turn.rounds.find(item => item.meta.roundId === roundId);
      if (!round) return;
      round.text = "";
      round.thinking = "";
      round.meta = { ...round.meta, tools: [], attemptId: undefined };
      return;
    }
    case "tool": {
      const envelope = payload as ToolEventEnvelope;
      const rawTool = envelope.toolEvent ?? envelope.tool_event;
      if (!rawTool || typeof rawTool !== "object") return;
      const round = parkedRoundFor(turn, roundId, { attemptId: attemptOf(envelope) });
      round.meta = applyToolEvent(round.meta, rawTool, round.text.length);
      return;
    }
  }
}

/** Forgets every parked turn, which is right only when the machine being read changes. */
export function resetParkedTurns(): void {
  parkedTurns.clear();
}

function clearAllRoundStreams(): void {
  clearDrainSchedule();
  lastDrainFrameMs = null;
  for (const entry of roundStreams.values()) {
    resetChannel(entry.text);
    resetChannel(entry.thinking);
  }
  roundStreams.clear();
  roundOrder = [];
  if (isStreamDraining()) {
    isStreamDraining.set(false);
  }
}

export function resetLiveTurn(): void {
  batch(() => {
    clearAllRoundStreams();
    liveTurn.set(null);
  });
  supersededAttempts.clear();
  settlingTurns.clear();
}

function ensureLiveTurn(sessionId: string, turnId: string | null): LiveTurnState {
  const current = liveTurn();
  if (
    current &&
    current.sessionId === sessionId &&
    (!turnId || !current.turnId || current.turnId === turnId)
  ) {
    if (turnId && !current.turnId) {
      return { ...current, turnId };
    }
    return current;
  }
  // Starting a brand-new turn replaces any leftover per-round buffers.
  if (roundStreams.size > 0) {
    clearAllRoundStreams();
  }
  const pending = pendingTurnState();
  return {
    sessionId,
    turnId,
    userText: pending && pending.sessionId === sessionId ? pending.userText : "",
    rounds: [],
    settling: false,
  };
}

function upsertRoundMeta(
  state: LiveTurnState,
  roundId: string,
  updater: (meta: LiveRoundMeta) => LiveRoundMeta,
  defaults?: { roundIndex?: number; effectiveModelName?: string; attemptId?: string },
): LiveTurnState {
  const entry = ensureRoundStream(roundId);
  const index = state.rounds.findIndex(item => item.roundId === roundId);
  if (index >= 0) {
    const updatedMeta = updater(extractRoundMeta(state.rounds[index]));
    const rounds = [...state.rounds];
    rounds[index] = makeLiveRound(updatedMeta, entry);
    return { ...state, rounds };
  }
  const createdMeta = updater({
    roundId,
    roundIndex: defaults?.roundIndex ?? state.rounds.length,
    ...(defaults?.attemptId ? { attemptId: defaults.attemptId } : {}),
    ...(defaults?.effectiveModelName ? { effectiveModelName: defaults.effectiveModelName } : {}),
    tools: [],
    completed: false,
  });
  if (!roundOrder.includes(roundId)) {
    roundOrder.push(roundId);
  }
  return { ...state, rounds: [...state.rounds, makeLiveRound(createdMeta, entry)] };
}

/** Clears the running mark of whichever session the event names. */
function endTurn(payload: TurnEventPayload | null): void {
  const sessionId = sessionOf(payload);
  if (!sessionId) return;
  turnStarts.delete(sessionId);
  runningTurns.update(current => {
    if (!(sessionId in current)) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
}

/**
 * Swaps the live stream for the persisted record once the host says the turn is
 * final. The host's transcript view marks a turn `settled` when it persisted a
 * terminal status; until then the streamed output stays on screen. Nothing here
 * counts items or retries on a timer:
 * - `dialog-turn-completed` is emitted before the host persists the turn, so its
 *   read may find the turn still running; the durable fence
 *   (`agentic://session-history-changed` with `settledTurnId`) reads again.
 * - cancelled, interrupted and failed turns are persisted before their event
 *   (`afterPersist`), so their read is final: a turn the host never recorded
 *   (cancelled before it existed) has nothing left to wait for.
 */
async function settleCompletedTurn(sessionId: string, turnId: string | null, afterPersist: boolean): Promise<void> {
  if (!sessionId || activeSessionId() !== sessionId) return;
  const effectiveTurnId = turnId ?? settlingTurns.get(sessionId)?.turnId ?? liveTurn()?.turnId ?? null;

  const loaded = await loadTurns(sessionId, { silent: true });
  if (activeSessionId() !== sessionId) return;
  // A failed read keeps what streamed visible; the next read settles it.
  if (loaded === null) return;

  const matched = effectiveTurnId
    ? loaded.find(turn => turn.turnId === effectiveTurnId)
    : loaded[loaded.length - 1];
  const ready = matched ? matched.settled : afterPersist;
  if (!ready) return;

  settlingTurns.delete(sessionId);
  batch(() => {
    clearAllRoundStreams();
    liveTurn.set(null);
    clearStreamedText();
    clearPendingTurn(sessionId);
  });
  markSessionSeen(sessionId, Date.now());
  void refreshSessionsSilently();
}

/**
 * After a re-read outside the turn lifecycle (re-hydration after dropped
 * events), gives way to the persisted record when the view reports the live
 * turn settled: its terminal events may be among the ones that were lost.
 */
export function settleLiveTurnFromView(sessionId: string): void {
  const live = liveTurn();
  if (!live?.turnId || live.sessionId !== sessionId || activeSessionId() !== sessionId) return;
  const matched = sessionTurns().find(turn => turn.turnId === live.turnId);
  if (!matched?.settled) return;
  settlingTurns.delete(sessionId);
  batch(() => {
    if (runningTurnId() === live.turnId) runningTurnId.set(null);
    clearAllRoundStreams();
    liveTurn.set(null);
    clearStreamedText();
    clearPendingTurn(sessionId);
  });
}

function applyToolEvent(
  round: LiveRoundMeta,
  rawToolEvent: Record<string, unknown>,
  textOffset = 0,
): LiveRoundMeta {
  const eventType = String(rawToolEvent.event_type ?? rawToolEvent.eventType ?? "");
  const toolId = String(rawToolEvent.tool_id ?? rawToolEvent.toolId ?? "");
  const toolName = String(rawToolEvent.tool_name ?? rawToolEvent.toolName ?? "");
  const effectiveToolName =
    typeof rawToolEvent.effective_tool_name === "string"
      ? rawToolEvent.effective_tool_name
      : typeof rawToolEvent.effectiveToolName === "string"
        ? rawToolEvent.effectiveToolName
        : undefined;
  if (!toolId && !toolName) return round;

  const key = toolId || toolName;
  const existingIdx = round.tools.findIndex(item => item.toolId === key);
  const existing: LiveToolItem =
    existingIdx >= 0
      ? round.tools[existingIdx]
      : {
          toolId: key,
          toolName: effectiveToolName || toolName || "tool",
          ...(effectiveToolName ? { effectiveToolName } : {}),
          status: "running",
          detail: "",
          textOffset,
        };

  let next: LiveToolItem = {
    ...existing,
    ...(toolName ? { toolName: effectiveToolName || toolName } : {}),
    ...(effectiveToolName ? { effectiveToolName } : {}),
  };

  switch (eventType) {
    case "EarlyDetected":
    case "ParamsPartial":
      next = {
        ...next,
        status: existing.status === "completed" ? "completed" : "running",
        ...(typeof rawToolEvent.params === "string" && rawToolEvent.params
          ? { detail: summarizeLiveInput(rawToolEvent.params) }
          : {}),
      };
      break;
    case "GenUIStream": {
      // The decoded OpenUI source of a GenerativeUI call, delta by delta; `reset`
      // starts the source over (a new message), `seq` drops a repeated delta.
      const seq = typeof rawToolEvent.seq === "number" ? rawToolEvent.seq : -1;
      const previous = existing.genuiStream;
      if (previous && !rawToolEvent.reset && seq >= 0 && seq <= previous.seq) return round;
      const text = typeof rawToolEvent.text === "string" ? rawToolEvent.text : "";
      const title = typeof rawToolEvent.title === "string" && rawToolEvent.title ? rawToolEvent.title : previous?.title;
      next = {
        ...next,
        status: existing.status === "completed" ? "completed" : "running",
        genuiStream: {
          source: rawToolEvent.reset || !previous ? text : previous.source + text,
          format: typeof rawToolEvent.format === "string" ? rawToolEvent.format : "openui-lang",
          seq,
          ...(title ? { title } : {}),
        },
      };
      break;
    }
    case "Queued":
      next = { ...next, status: "queued" };
      break;
    case "Waiting":
      next = { ...next, status: "waiting" };
      break;
    case "Started":
      next = {
        ...next,
        status: "running",
        ...(rawToolEvent.params !== undefined
          ? { input: rawToolEvent.params, detail: summarizeLiveInput(rawToolEvent.params) }
          : {}),
      };
      break;
    case "Progress":
      next = {
        ...next,
        status: "running",
        ...(typeof rawToolEvent.message === "string"
          ? { progressMessage: rawToolEvent.message }
          : {}),
      };
      break;
    case "ConfirmationNeeded":
      next = {
        ...next,
        status: "confirmation",
        ...(rawToolEvent.params !== undefined
          ? { input: rawToolEvent.params, detail: summarizeLiveInput(rawToolEvent.params) }
          : {}),
      };
      break;
    case "Confirmed":
      next = { ...next, status: "running" };
      break;
    case "Rejected":
    case "Cancelled":
      next = {
        ...next,
        status: "cancelled",
        ...(typeof rawToolEvent.reason === "string" ? { error: rawToolEvent.reason } : {}),
      };
      break;
    case "Completed": {
      const resultForAssistant =
        rawToolEvent.result_for_assistant ?? rawToolEvent.resultForAssistant;
      next = {
        ...next,
        status: "completed",
        ...(rawToolEvent.result !== undefined ? { result: rawToolEvent.result } : {}),
        ...(typeof resultForAssistant === "string" && resultForAssistant
          ? { resultForAssistant }
          : {}),
        ...(typeof rawToolEvent.duration_ms === "number"
          ? { durationMs: rawToolEvent.duration_ms }
          : {}),
      };
      break;
    }
    case "Failed":
      next = {
        ...next,
        status: "failed",
        ...(typeof rawToolEvent.error === "string" ? { error: rawToolEvent.error } : {}),
        ...(typeof rawToolEvent.duration_ms === "number"
          ? { durationMs: rawToolEvent.duration_ms }
          : {}),
      };
      break;
    default:
      return round;
  }

  const tools =
    existingIdx >= 0
      ? round.tools.map((item, idx) => (idx === existingIdx ? next : item))
      : [...round.tools, next];
  return { ...round, tools };
}

/**
 * A turn of a session that is not on screen ended: its parked stream is dropped
 * (the persisted turn is what opening it shows now) and, when asked, its queue is
 * read again so a locally held message still starts. Returns whether the event
 * belonged to another session.
 */
function finishOtherSessionTurn(payload: TurnEventPayload | null, drain: boolean): boolean {
  if (!payload || !isOtherSession(payload)) return false;
  const sessionId = sessionOf(payload);
  parkedTurns.delete(sessionId);
  // The host drains its own queue; the rows follow.
  if (drain) void loadQueueForSession(sessionId, true);
  return true;
}

// --- Running-turn hydration ------------------------------------------------
//
// A surface that opens a session while a turn runs (it connected late, reopened
// the session, or lost events) did not see that turn start. The transcript view
// then carries `runningTurn`: the host runtime journal's projection of the turn
// as the same `agentic://*` events the live wire delivers, plus the delivery
// cursor they reached. Those events are replayed through the very handlers the
// live wire uses, and live events the snapshot already covered (cursor at or
// below it, same stream) are dropped, so the turn continues without gaps or
// repeats. The `agentic://*` events stay the live channel: they are what the
// per-frame text merge and the smooth reveal are built on.

const RUNTIME_CURSOR_KEY = "__openbitfunRuntimeEventCursor";
const RUNTIME_STREAM_KEY = "__openbitfunRuntimeStreamId";
/** Set by the text-chunk merge: `[cursor, end offset]` of each merged chunk. */
const CHUNK_SPANS_KEY = "__openbitfunChunkSpans";

type AgentEventHandler = (payload: never) => void;
const agentEventHandlers = new Map<string, AgentEventHandler>();
/** Per session, the delivery position a replayed snapshot already covered. */
const replayFloors = new Map<string, { streamId: string; cursor: number }>();
/** Turns this surface followed live from their `dialog-turn-started`. */
const followedTurns = new Set<string>();
let replayingSnapshot = false;

/**
 * Whether a live event is new to this surface: anything without a cursor, from
 * another stream, or past the replay floor is; a text chunk merged across the
 * floor keeps only the text after it.
 */
function admitLiveEvent(event: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  const floor = replayFloors.get(sessionOf(record as { sessionId?: string }));
  if (!floor) return payload;
  const cursor = record[RUNTIME_CURSOR_KEY];
  if (typeof cursor !== "number" || record[RUNTIME_STREAM_KEY] !== floor.streamId) return payload;
  if (cursor <= floor.cursor) return null;
  const spans = record[CHUNK_SPANS_KEY];
  if (event !== "agentic://text-chunk" || !Array.isArray(spans)) return payload;
  let cut = 0;
  for (const span of spans) {
    if (Array.isArray(span) && typeof span[0] === "number" && typeof span[1] === "number" && span[0] <= floor.cursor) {
      cut = Math.max(cut, span[1]);
    }
  }
  if (cut === 0) return payload;
  const field = (["text", "delta", "content", "chunk"] as const).find(key => typeof record[key] === "string");
  if (!field) return payload;
  return { ...record, [field]: String(record[field]).slice(cut) };
}

function onAgentEvent<T>(event: string, handler: (payload: T) => void): void {
  agentEventHandlers.set(event, handler as AgentEventHandler);
  listenEvent<T>(event, payload => {
    const admitted = admitLiveEvent(event, payload);
    if (admitted === null) return;
    handler(admitted as T);
  });
}

/** Forgets which turns were followed from their start: events may have been lost. */
export function forgetFollowedTurns(): void {
  followedTurns.clear();
}

/**
 * Puts the open session's running turn on screen from a transcript read's
 * snapshot, unless this surface has been following that very turn since it
 * started.
 */
export function hydrateRunningTurn(sessionId: string, snapshot: RunningTurnSnapshot): void {
  const turnId = snapshot.activeTurnId;
  if (!turnId || activeSessionId() !== sessionId) return;
  const live = liveTurn();
  if (followedTurns.has(turnId) && live?.sessionId === sessionId && live.turnId === turnId) return;
  replayingSnapshot = true;
  try {
    batch(() => {
      clearAllRoundStreams();
      liveTurn.set(null);
    });
    parkedTurns.delete(sessionId);
    for (const event of snapshot.events ?? []) {
      const handler = agentEventHandlers.get(event.eventName);
      if (handler) (handler as (payload: unknown) => void)(event.payload);
    }
    flushStreamingBuffers();
  } finally {
    replayingSnapshot = false;
  }
  replayFloors.set(sessionId, { streamId: snapshot.streamId, cursor: snapshot.cursor });
  // The snapshot carries the turn's start, so it counts as followed from now on.
  followedTurns.add(turnId);
}

let subscribed = false;

export function subscribeAgentEvents(): void {
  if (subscribed) return;
  subscribed = true;

  onStreamCleared(() => {
    resetLiveTurn();
  });

  onSessionSwitch((phase, sessionId) => {
    if (phase === "leave") parkActiveTurn(sessionId);
    else if (phase === "enter") restoreParkedTurn(sessionId);
    else resetParkedTurns();
  });

  onRunningTurnSnapshot(hydrateRunningTurn);

  onAgentEvent<TextChunkPayload>("agentic://text-chunk", payload => {
    if (!payload) return;
    const attemptId = attemptOf(payload);
    if (attemptId && supersededAttempts.has(attemptId)) return;
    if (isOtherSession(payload)) {
      parkEvent("chunk", payload as Record<string, unknown>);
      return;
    }

    const isThinking = payload.contentType === "thinking";
    const roundId = roundOf(payload);
    const chunk = payload.text ?? payload.delta ?? payload.content ?? payload.chunk ?? "";
    if (!chunk) {
      if (isThinking && payload.isThinkingEnd === true) {
        flushRoundChannelImmediate(roundId, "thinking");
      }
      return;
    }

    const sessionId = sessionOf(payload) || activeSessionId() || "";
    const turnId = turnOf(payload) ?? runningTurnId();
    const current = liveTurn();
    const sameLiveTurn =
      current !== null &&
      current.sessionId === sessionId &&
      (!turnId || !current.turnId || current.turnId === turnId);
    const existingRound = sameLiveTurn
      ? current.rounds.find(item => item.roundId === roundId)
      : undefined;

    // Only touch structural `liveTurn` when turn/round/metadata actually changes —
    // NEVER on steady-state streaming chunks!
    const needsStructuralUpdate =
      !sameLiveTurn ||
      (Boolean(turnId) && current.turnId !== turnId) ||
      !existingRound ||
      (Boolean(attemptId) && existingRound.attemptId !== attemptId) ||
      (isThinking &&
        Boolean(payload.reasoningKind) &&
        existingRound.reasoningKind !== payload.reasoningKind);

    const applyChunk = () => {
      if (needsStructuralUpdate) {
        const base = ensureLiveTurn(sessionId, turnId);
        const updated = upsertRoundMeta(
          base,
          roundId,
          meta => ({
            ...meta,
            ...(attemptId ? { attemptId } : {}),
            ...(isThinking && payload.reasoningKind
              ? { reasoningKind: payload.reasoningKind }
              : {}),
          }),
          { attemptId },
        );
        liveTurn.set(updated);
      }

      const entry = ensureRoundStream(roundId);
      if (isThinking) {
        entry.thinking.target += chunk;
        if (payload.isThinkingEnd === true) {
          if (commitChannelImmediate(entry.thinking)) {
            syncFlatStreamSignals(false, true);
            bumpScrollTick();
          }
          return;
        }
      } else {
        // When answer text starts arriving, crisply finish any buffered thinking.
        if (entry.thinking.revealed < entry.thinking.target.length) {
          if (commitChannelImmediate(entry.thinking)) {
            syncFlatStreamSignals(false, true);
          }
        }
        entry.text.target += chunk;
      }

      if (!shouldCoalesceToFrame()) {
        // Headless test runtime: reveal immediately inside this batch for 100% determinism.
        const channel = isThinking ? entry.thinking : entry.text;
        if (commitChannelImmediate(channel)) {
          syncFlatStreamSignals(!isThinking, isThinking);
          bumpScrollTick();
        }
        return;
      }

      scheduleDrainFrame();
    };

    batch(applyChunk);
  });

  onAgentEvent<ModelRoundEventPayload>("agentic://model-round-started", payload => {
    if (!payload) return;
    if (isOtherSession(payload)) {
      parkEvent("roundStarted", payload as Record<string, unknown>);
      return;
    }
    flushStreamingBuffers();
    const sessionId = sessionOf(payload) || activeSessionId() || "";
    const turnId = turnOf(payload) ?? runningTurnId();
    const roundId = roundOf(payload);
    batch(() => {
      const base = ensureLiveTurn(sessionId, turnId);
      const updated = upsertRoundMeta(
        base,
        roundId,
        meta => ({
          ...meta,
          ...(typeof payload.roundIndex === "number" ? { roundIndex: payload.roundIndex } : {}),
          ...(typeof payload.effectiveModelName === "string" && payload.effectiveModelName
            ? { effectiveModelName: payload.effectiveModelName }
            : {}),
          completed: false,
        }),
        {
          roundIndex: payload.roundIndex,
          effectiveModelName: payload.effectiveModelName,
        },
      );
      liveTurn.set(updated);
      bumpScrollTick();
    });
  });

  onAgentEvent<ModelRoundEventPayload>("agentic://model-round-completed", payload => {
    if (!payload) return;
    if (isOtherSession(payload)) {
      parkEvent("roundCompleted", payload as Record<string, unknown>);
      return;
    }
    flushStreamingBuffers();
    const current = liveTurn();
    if (!current) return;
    const roundId = roundOf(payload);
    batch(() => {
      const updated = upsertRoundMeta(current, roundId, meta => ({
        ...meta,
        completed: true,
        ...(typeof payload.effectiveModelName === "string" && payload.effectiveModelName
          ? { effectiveModelName: payload.effectiveModelName }
          : {}),
        ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
      }));
      liveTurn.set(updated);
      bumpScrollTick();
    });
  });

  onAgentEvent<ModelRoundEventPayload>("agentic://model-round-attempt-superseded", payload => {
    if (!payload) return;
    const failedAttempt = payload.diagnostic?.attemptId ?? payload.diagnostic?.attempt_id;
    if (typeof failedAttempt === "string" && failedAttempt) {
      supersededAttempts.add(failedAttempt);
    }
    if (isOtherSession(payload)) {
      parkEvent("superseded", payload as Record<string, unknown>);
      return;
    }
    const current = liveTurn();
    if (!current) return;
    const roundId = roundOf(payload);
    batch(() => {
      const entry = roundStreams.get(roundId);
      if (entry) {
        resetChannel(entry.thinking);
        resetChannel(entry.text);
      }
      const updated = upsertRoundMeta(current, roundId, meta => ({
        ...meta,
        tools: [],
        attemptId: undefined,
      }));
      liveTurn.set(updated);
      syncFlatStreamSignals(true, true);
      if (!hasAnyPendingBacklog()) {
        clearDrainSchedule();
        lastDrainFrameMs = null;
        if (isStreamDraining()) isStreamDraining.set(false);
      }
    });
  });

  onAgentEvent<ToolEventEnvelope>("agentic://tool-event", payload => {
    if (!payload) return;
    const attemptId = attemptOf(payload);
    if (attemptId && supersededAttempts.has(attemptId)) return;
    if (isOtherSession(payload)) {
      parkEvent("tool", payload as Record<string, unknown>);
      return;
    }
    const rawTool = payload.toolEvent ?? payload.tool_event;
    if (!rawTool || typeof rawTool !== "object") return;
    // Preserve strict causal ordering: text emitted before a tool call must
    // finish revealing before the tool card appears beneath it.
    flushStreamingBuffers();
    const sessionId = sessionOf(payload) || activeSessionId() || "";
    const turnId = turnOf(payload) ?? runningTurnId();
    const roundId = roundOf(payload);
    batch(() => {
      const base = ensureLiveTurn(sessionId, turnId);
      const updated = upsertRoundMeta(
        base,
        roundId,
        meta => applyToolEvent(meta, rawTool, ensureRoundStream(roundId).text.target.length),
        { attemptId },
      );
      liveTurn.set(updated);
      bumpScrollTick();
    });
  });

  onAgentEvent<TurnEventPayload>("agentic://dialog-turn-started", payload => {
    const running = turnOf(payload);
    const sessionId = sessionOf(payload);
    if (running && !replayingSnapshot) followedTurns.add(running);
    if (sessionId) turnStarts.set(sessionId, Date.now());
    if (sessionId) {
      runningTurns.update(current => {
        const next = { ...current };
        if (running) next[sessionId] = running;
        else delete next[sessionId];
        return next;
      });
    }
    const userInput =
      typeof payload?.originalUserInput === "string" && payload.originalUserInput
        ? payload.originalUserInput
        : typeof payload?.userInput === "string" && payload.userInput
          ? payload.userInput
          : typeof payload?.user_input === "string" && payload.user_input
            ? payload.user_input
            : undefined;
    if (sessionId && sessionId !== activeSessionId()) {
      parkedTurns.set(sessionId, { sessionId, turnId: running, userText: userInput ?? "", rounds: [] });
      return;
    }
    const targetSession = sessionId || activeSessionId() || "";
    settlingTurns.delete(targetSession);
    batch(() => {
      clearStreamedText();
      if (targetSession && running) {
        bindPendingTurnId(targetSession, running, userInput);
      }
      runningTurnId.set(running);
      liveTurn.set({
        sessionId: targetSession,
        turnId: running,
        userText: userInput ?? pendingTurnState()?.userText ?? "",
        rounds: [],
        settling: false,
      });
      bumpScrollTick();
    });
  });

  onAgentEvent<TurnEventPayload>("agentic://dialog-turn-completed", payload => {
    endTurn(payload);
    if (finishOtherSessionTurn(payload, true)) return;
    // Flush ALL remaining buffered text immediately so nothing is lost before
    // `hasLiveContent()` is checked or disk persistence swaps in.
    flushStreamingBuffers();
    const sessionId = sessionOf(payload) || activeSessionId() || "";
    const completedTurnId = turnOf(payload) ?? runningTurnId();
    batch(() => {
      runningTurnId.set(null);
      // CRITICAL: do NOT clear streamed text synchronously! Keep live content on
      // screen while `coordinator.rs` finishes disk persistence and `loadTurns()`
      // / `agentic://session-history-changed` confirms the persisted turn.
      const currentLive = liveTurn();
      if (currentLive) {
        liveTurn.set({ ...currentLive, settling: true });
      }
    });
    if (sessionId) {
      settlingTurns.set(sessionId, { turnId: completedTurnId });
      void settleCompletedTurn(sessionId, completedTurnId, false);
      // The host drains its own queue; the rows follow.
      void loadQueueForSession(sessionId, true);
    }
  });

  onAgentEvent<SessionHistoryChangedPayload>("agentic://session-history-changed", payload => {
    const sessionId = sessionOf(payload);
    const settledTurnId =
      typeof payload?.settledTurnId === "string"
        ? payload.settledTurnId
        : typeof payload?.settled_turn_id === "string"
          ? payload.settled_turn_id
          : null;
    if (!sessionId) return;
    if (sessionId === activeSessionId()) {
      if (settlingTurns.has(sessionId) || liveTurn()?.settling) {
        void settleCompletedTurn(sessionId, settledTurnId, true);
      } else if (!runningTurnId()) {
        // External or detached update landed on the active session.
        void loadTurns(sessionId, { silent: true });
      }
    }
    void refreshSessionsSilently();
  });

  onAgentEvent<TurnEventPayload>("agentic://dialog-turn-cancelled", payload => {
    endTurn(payload);
    if (finishOtherSessionTurn(payload, true)) return;
    flushStreamingBuffers();
    const sessionId = sessionOf(payload) || activeSessionId() || "";
    const turnId = turnOf(payload) ?? runningTurnId();
    runningTurnId.set(null);
    if (sessionId) {
      settlingTurns.set(sessionId, { turnId });
      void settleCompletedTurn(sessionId, turnId, true);
      // The host drains its own queue; the rows follow.
      void loadQueueForSession(sessionId, true);
    } else {
      clearStreamedText();
    }
  });

  onAgentEvent<TurnEventPayload>("agentic://dialog-turn-interrupted", payload => {
    endTurn(payload);
    if (finishOtherSessionTurn(payload, false)) return;
    flushStreamingBuffers();
    const sessionId = sessionOf(payload) || activeSessionId() || "";
    const turnId = turnOf(payload) ?? runningTurnId();
    runningTurnId.set(null);
    if (sessionId) {
      settlingTurns.set(sessionId, { turnId });
      void settleCompletedTurn(sessionId, turnId, true);
    } else {
      clearStreamedText();
    }
  });

  onAgentEvent<TurnEventPayload>("agentic://dialog-turn-recovered", payload => {
    const sessionId = sessionOf(payload);
    const turnId = turnOf(payload);
    if (sessionId && turnId) {
      runningTurns.update(current => ({ ...current, [sessionId]: turnId }));
      if (!turnStarts.has(sessionId)) turnStarts.set(sessionId, Date.now());
    }
    if (sessionId && sessionId !== activeSessionId()) return;
    if (turnId) runningTurnId.set(turnId);
  });

  onAgentEvent<TurnEventPayload>("agentic://dialog-turn-failed", payload => {
    endTurn(payload);
    const failedSession = sessionOf(payload);
    if (failedSession) markSessionFailed(failedSession);
    if (finishOtherSessionTurn(payload, true)) return;
    flushStreamingBuffers();
    const sessionId = failedSession || activeSessionId() || "";
    const turnId = turnOf(payload) ?? runningTurnId();
    const message = payload?.error ?? payload?.message ?? payload?.reason;
    batch(() => {
      runningTurnId.set(null);
      if (typeof message === "string" && message.trim()) {
        turnError.set(message.trim());
      }
      bumpScrollTick();
    });
    if (sessionId) {
      settlingTurns.set(sessionId, { turnId });
      void settleCompletedTurn(sessionId, turnId, true);
      // A failed turn must not strand the queue behind it.
      // The host drains its own queue; the rows follow.
      void loadQueueForSession(sessionId, true);
    } else {
      clearStreamedText();
      clearPendingTurn();
    }
  });

  // Real Rust emits `"session_title_generated"` (without the `agentic://` prefix).
  onAgentEvent<SessionTitleGeneratedPayload>("session_title_generated", payload => {
    const sessionId = sessionOf(payload);
    const title = typeof payload?.title === "string" ? payload.title.trim() : "";
    if (!sessionId || !title) return;
    patchSessionTitle(sessionId, title);
  });

  onAgentEvent<SessionCreatedPayload>("agentic://session-created", payload => {
    const sessionId = sessionOf(payload);
    if (!sessionId) return;
    const wsId = payload?.workspaceId ?? payload?.workspace_id;
    const activeWs = activeWorkspaceId();
    if (wsId && activeWs && wsId !== activeWs) return;
    upsertSessionFromEvent({
      sessionId,
      sessionName:
        (typeof payload?.sessionName === "string" && payload.sessionName) ||
        (typeof payload?.session_name === "string" && payload.session_name) ||
        "New session",
      agentType:
        (typeof payload?.agentType === "string" && payload.agentType) ||
        (typeof payload?.agent_type === "string" && payload.agent_type) ||
        undefined,
      workspaceId: wsId || activeWs || undefined,
      status: "active",
      persistedStatus: "active",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      lastUpdated: Date.now(),
      messageCount: 0,
    });
  });

  onAgentEvent<TurnEventPayload>("agentic://session-deleted", payload => {
    const sessionId = sessionOf(payload);
    if (!sessionId) return;
    removeSessionFromEvent(sessionId);
  });
}
